import json
import re

from fastapi.testclient import TestClient
import pytest

from app import create_app
from tools.build_pages import build
from volt_service import browser_call


def call(op, **payload):
    return json.loads(browser_call(op, json.dumps(payload)))


def ok(op, **payload):
    reply = call(op, **payload)
    assert reply["ok"], reply
    return reply["data"]


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "volt.db")) as session:
        yield session


def test_browser_service_matches_the_server(client):
    state = ok("initial")
    assert state == client.get("/api/state").json()
    run = ok("optimize", state=state, body={"revision": 1, "algorithm": "optimal"})
    server = client.post("/api/optimize", json={"revision": 1, "algorithm": "optimal"}).json()
    for key in ("selected", "comparison"):
        for result in (run, server):
            for row in [result[key]] if key == "selected" else result[key]:
                row.pop("runtime_ms")
        assert run[key] == server[key]
    assert ok("hubs", settings=state["settings"]) == client.get("/api/hubs").json()
    assert ok("sensitivity", state=state) == client.post("/api/lab/sensitivity").json()
    assert ok("requests_csv", state=state) == client.get("/api/requests.csv").text
    assert ok("run_csv", run=server) == client.get(f"/api/runs/{server['id']}/export").text


def test_browser_service_edits_imports_and_revision_checks():
    state = ok("initial")
    body = {"revision": 1, "count": 12, "seed": 42, "max_surge": 2,
            "settings": {"ports": 2, "tariff": 18, "energy_cost": 9}}
    generated = ok("generate", state=state, body=body)
    assert generated["revision"] == 2 and len(generated["requests"]) == 12
    stale = call("generate", state=generated, body=body)
    assert stale["status"] == 409 and not stale["ok"]
    csv_text = "request_id,arrival_min,duration_min,energy_kwh,surge_mult\n1,480,45,24,1.5\n2,500,30,18,2\n"
    imported = ok("import", state=generated, revision=2, text=csv_text)
    assert imported["source"] == {"kind": "imported"} and imported["requests"][0]["profit_inr"] == 432
    bad = call("import", state=imported, revision=3, text="request_id\n1\n")
    assert bad["status"] == 422 and bad["detail"].startswith("Invalid CSV")
    edit = {"revision": 3, "settings": {"ports": 1, "tariff": 20, "energy_cost": 9},
            "requests": [{"request_id": 9, "arrival_min": 60, "duration_min": 30,
                          "energy_kwh": 10, "surge_mult": 1}]}
    edited = ok("update", state=imported, body=edit)
    assert edited["requests"][0]["profit_inr"] == 110 and edited["settings"]["ports"] == 1
    for broken in ({"arrival_min": 1430}, {"surge_mult": 0.5}, {"request_id": True}):
        reply = call("update", state=edited, body={**edit, "revision": 4,
                                                   "requests": [{**edit["requests"][0], **broken}]})
        assert reply["status"] == 422
    example = ok("example", state=edited, body={"revision": 4})
    run = ok("optimize", state=example, body={"revision": 5, "algorithm": "dp"})
    assert run["selected"]["profit_inr"] == 240
    assert call("optimize", state=example, body={"revision": 4})["status"] == 409
    assert ok("verify")["passed"] == 60
    assert len(ok("benchmark")) == 5


def test_pages_build_uses_relative_links_and_ships_python(tmp_path):
    version = build(tmp_path / "site")
    site = tmp_path / "site"
    for page in ("index.html", "console.html"):
        markup = (site / page).read_text(encoding="utf-8")
        assert not re.search(r'(href|src)="/(?!api/)', markup), page
        assert f"?v={version}" in markup
    console = (site / "console.html").read_text(encoding="utf-8")
    assert console.index("browser-api.js") < console.index("console.js")
    assert 'href="console.html"' in (site / "index.html").read_text(encoding="utf-8")
    for name in ("evsched.py", "run_experiments.py", "volt_service.py"):
        assert (site / "py" / name).exists()
    assert (site / "static" / "py-worker.js").exists() and (site / ".nojekyll").exists()
