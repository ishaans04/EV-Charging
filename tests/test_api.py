import csv
import io

from fastapi.testclient import TestClient
import pytest

from app import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "volt.db")) as session:
        yield session


def test_station_run_persistence_exports_and_stale_revision(client):
    state = client.get("/api/state").json()
    assert len(state["requests"]) == 150
    payload = {"revision": state["revision"], "count": 12, "seed": 42,
               "settings": {"ports": 2, "tariff": 18, "energy_cost": 9}}
    response = client.post("/api/generate", json=payload)
    assert response.status_code == 200
    state = response.json()
    assert client.post("/api/generate", json=payload).status_code == 409
    response = client.post("/api/optimize", json={"revision": state["revision"], "algorithm": "optimal"})
    assert response.status_code == 200
    run = response.json()
    assert run["selected"]["exact"]
    assert client.get("/api/runs").json()[0]["id"] == run["id"]
    assert client.get(f"/api/runs/{run['id']}").json() == run
    export = client.get(f"/api/runs/{run['id']}/export")
    rows = list(csv.DictReader(io.StringIO(export.text)))
    assert len(rows) == 12
    assert sum(r["status"] == "accepted" for r in rows) == run["selected"]["accepted"]
    assert client.get(f"/api/runs/{run['id']}/export?format=json").json() == run
    second = TestClient(create_app(client.app.state.store.path))
    assert second.get("/api/state").json() == state


def test_edit_import_validation_and_server_profit(client):
    state = client.get("/api/state").json()
    booking = {"request_id": 1, "arrival_min": 480, "duration_min": 30,
               "energy_kwh": 24, "surge_mult": 2, "profit_inr": 999999}
    payload = {"revision": state["revision"], "settings": state["settings"], "requests": [booking]}
    response = client.put("/api/state", json=payload)
    assert response.status_code == 200
    state = response.json()
    assert state["requests"][0]["profit_inr"] == 648
    exported = client.get("/api/requests.csv").text
    imported = client.post(f"/api/import?revision={state['revision']}", content=exported)
    assert imported.status_code == 200
    state = imported.json()
    payload["revision"] = state["revision"]
    payload["requests"] = [booking, booking]
    assert client.put("/api/state", json=payload).status_code == 422
    booking["deadline_min"] = 600
    payload["requests"] = [booking]
    assert client.put("/api/state", json=payload).status_code == 422
    assert client.post(f"/api/import?revision={state['revision']}", content="bad\n1").status_code == 422
    assert client.post("/api/optimize", json={"revision": state["revision"], "algorithm": "subsets"}).status_code == 200


def test_limits_and_bad_algorithms(client):
    revision = client.get("/api/state").json()["revision"]
    for algorithm in ("dp", "invalid", "subsets", "search"):
        assert client.post("/api/optimize", json={"revision": revision, "algorithm": algorithm}).status_code == 422
    assert client.post("/api/generate", json={"revision": revision, "count": 2001}).status_code == 422
    assert client.get("/api/runs/missing").status_code == 404
    assert client.get("/api/health").json()["status"] == "ok"


def test_report_example_repricing_and_origin_protection(client):
    state = client.get("/api/state").json()
    example = client.post("/api/example", json={"revision": state["revision"]}).json()
    assert example["settings"]["ports"] == 1
    result = client.post("/api/optimize", json={"revision": example["revision"], "algorithm": "dp"}).json()
    assert result["selected"]["profit_inr"] == 240
    assert len(result["selected"]["trace"]["rows"]) == 8
    payload = {"revision": example["revision"], "requests": example["requests"], "settings": example["settings"]}
    repriced = client.put("/api/state", json=payload).json()
    assert [r["profit_inr"] for r in repriced["requests"]] == [r["profit_inr"] for r in example["requests"]]
    blocked = client.post("/api/generate", json={"revision": repriced["revision"]},
                          headers={"Origin": "https://unrelated.example"})
    assert blocked.status_code == 403
    allowed = client.post("/api/generate", json={"revision": repriced["revision"], "count": 0},
                          headers={"Origin": "http://testserver"})
    assert allowed.status_code == 200
    empty = client.post("/api/optimize", json={"revision": allowed.json()["revision"]}).json()
    assert empty["selected"]["profit_inr"] == 0
    assert client.get(f"/api/runs/{empty['id']}/export").text.startswith("request_id,")


def test_pages_assets_and_headers(client):
    for path in ("/", "/console", "/static/console.js", "/static/console.css", "/static/inter.woff2"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert client.get("/api/state").headers["Cache-Control"] == "no-store"


def test_console_uses_versioned_assets_and_disables_stale_caching(client):
    response = client.get("/console")
    version = response.headers["X-Volt-UI"]
    assert len(version) == 16
    assert 'class="sidebar"' not in response.text
    assert 'class="topbar-inner"' in response.text
    for name in ("console.css", "console.js"):
        url = f"/static/{name}?v={version}"
        assert url in response.text
        asset = client.get(url)
        assert asset.status_code == 200
        assert asset.headers["Cache-Control"] == "no-store"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Pragma"] == "no-cache"
    assert response.headers["Expires"] == "0"
    assert client.get("/console?refresh=1").headers["X-Volt-UI"] == version


def test_console_asset_update_changes_browser_cache_key(client, tmp_path, monkeypatch):
    directory = tmp_path / "static"
    directory.mkdir()
    (directory / "console.html").write_text(
        '<link href="/static/console.css"><script src="/static/console.js"></script>', encoding="utf-8")
    (directory / "console.css").write_text("body { color: blue; }", encoding="utf-8")
    (directory / "console.js").write_text("const version = 1;", encoding="utf-8")
    monkeypatch.setattr("app.ROOT", tmp_path)
    first = client.get("/console")
    (directory / "console.css").write_text("body { color: green; }", encoding="utf-8")
    second = client.get("/console")
    assert first.headers["X-Volt-UI"] != second.headers["X-Volt-UI"]
    assert f'?v={first.headers["X-Volt-UI"]}' not in second.text
    assert f'?v={second.headers["X-Volt-UI"]}' in second.text
