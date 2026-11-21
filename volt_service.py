"""Station operations shared by the FastAPI server and the browser build.

Everything here uses only the standard library, so the GitHub Pages version
can run it unchanged inside the visitor's browser (Pyodide). The browser
keeps state and saved runs in IndexedDB and passes them in; these functions
return the next state or a new run and never touch storage themselves.
"""

import csv
from datetime import datetime, timezone
from functools import lru_cache
import io
import json
from math import isfinite
from uuid import uuid4

from evsched import (ALGORITHMS, Request, compare, create_request, generate_requests, solve,
                     validate_instance, worked_example)

# Delhi NCR charging hubs. Each hub is a reproducible synthetic station:
# its own port count, demand size, surge ceiling and seed. Map x/y are
# positions on the console's 640 x 360 stylised map, not real coordinates.
HUBS = [
    {"id": "connaught", "name": "Connaught Place", "area": "Central Delhi", "x": 352, "y": 150,
     "ports": 4, "count": 150, "seed": 2026, "max_surge": 2.5},
    {"id": "aerocity", "name": "Aerocity", "area": "IGI Airport", "x": 214, "y": 238,
     "ports": 6, "count": 220, "seed": 3101, "max_surge": 3.0},
    {"id": "cybercity", "name": "Cyber City", "area": "Gurugram", "x": 150, "y": 284,
     "ports": 5, "count": 190, "seed": 3202, "max_surge": 2.8},
    {"id": "nehru", "name": "Nehru Place", "area": "South Delhi", "x": 372, "y": 236,
     "ports": 3, "count": 110, "seed": 3303, "max_surge": 2.2},
    {"id": "noida", "name": "Noida Sector 18", "area": "Noida", "x": 494, "y": 238,
     "ports": 3, "count": 120, "seed": 3404, "max_surge": 2.3},
    {"id": "dwarka", "name": "Dwarka", "area": "South West Delhi", "x": 150, "y": 178,
     "ports": 2, "count": 80, "seed": 3505, "max_surge": 1.8},
]
REQUEST_FIELDS = ["request_id", "arrival_min", "duration_min", "energy_kwh", "surge_mult",
                  "profit_inr", "deadline_min"]


class ApiError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@lru_cache(maxsize=16)
def hub_summaries(tariff, energy_cost):
    summaries = []
    for hub in HUBS:
        requests = generate_requests(hub["count"], hub["seed"], hub["max_surge"], tariff, energy_cost)
        best = solve(requests, hub["ports"])
        fcfs = solve(requests, hub["ports"], "fcfs")
        summaries.append({**hub, "profit_inr": best["profit_inr"], "fcfs_inr": fcfs["profit_inr"],
                          "accepted": best["accepted"], "utilization": best["utilization"],
                          "gain_percent": (best["profit_inr"] / fcfs["profit_inr"] - 1) * 100
                          if fcfs["profit_inr"] else None})
    return summaries


# Validation mirrors the server's pydantic models.
def _integer(value, name, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ApiError(422, f"{name} must be a whole number from {low} to {high}")
    return value


def _number(value, name, low, high, above=False):
    if type(value) not in (int, float) or not isfinite(value) or value > high or \
            (value <= low if above else value < low):
        raise ApiError(422, f"{name} must be {'above' if above else 'at least'} {low} and at most {high}")
    return float(value)


def settings_from(data):
    data = data or {}
    if not isinstance(data, dict):
        raise ApiError(422, "Settings must be an object")
    return {"ports": _integer(data.get("ports", 4), "Ports", 1, 32),
            "tariff": _number(data.get("tariff", 18), "Tariff", 0, 1000),
            "energy_cost": _number(data.get("energy_cost", 9), "Energy cost", 0, 1000)}


def booking_from(data):
    if not isinstance(data, dict):
        raise ApiError(422, "Each request must be an object")
    try:
        booking = {"request_id": _integer(data.get("request_id"), "Request ID", 1, 10**12),
                   "arrival_min": _integer(data.get("arrival_min"), "Start", 0, 1439),
                   "duration_min": _integer(data.get("duration_min"), "Duration", 1, 1440),
                   "energy_kwh": _number(data.get("energy_kwh"), "Energy", 0, 1000, above=True),
                   "surge_mult": _number(data.get("surge_mult"), "Surge", 1, 10)}
    except ApiError as error:
        raise ApiError(422, f"Request {data.get('request_id', '?')}: {error.detail}") from None
    finish = booking["arrival_min"] + booking["duration_min"]
    if finish > 1440:
        raise ApiError(422, "Slot must finish by midnight")
    deadline = data.get("deadline_min")
    if deadline is not None and deadline != finish:
        raise ApiError(422, "Deadline must equal start plus duration in the fixed-slot model")
    return booking


def priced(bookings, settings):
    return [create_request(b["request_id"], b["arrival_min"], b["duration_min"], b["energy_kwh"],
                           b["surge_mult"], settings["tariff"], settings["energy_cost"]) for b in bookings]


def deserialize(rows):
    return [Request(**{k: row[k] for k in Request.__dataclass_fields__}) for row in rows]


def _revision(value):
    return _integer(value, "Revision", 1, 10**12)


def initial_state():
    return {"revision": 1, "settings": settings_from({}),
            "source": {"kind": "synthetic", "seed": 2026, "max_surge": 2.5},
            "requests": [r.to_dict() for r in generate_requests()]}


def replace(state, revision, requests, settings, source):
    validate_instance(requests, settings["ports"])
    if state["revision"] != revision:
        raise ApiError(409, "The station changed in another tab. Reload before saving.")
    return {"revision": revision + 1, "settings": settings, "source": source,
            "requests": [r.to_dict() for r in requests]}


def update_state(state, body):
    settings = settings_from(body.get("settings"))
    rows = body.get("requests")
    if not isinstance(rows, list) or len(rows) > 2000:
        raise ApiError(422, "Requests must be a list of at most 2,000 bookings")
    return replace(state, _revision(body.get("revision")), priced([booking_from(r) for r in rows], settings),
                   settings, {"kind": "custom"})


def generate_day(state, body):
    settings = settings_from(body.get("settings"))
    count = _integer(body.get("count", 150), "Request count", 0, 2000)
    seed = _integer(body.get("seed", 2026), "Seed", 0, 2**32 - 1)
    max_surge = _number(body.get("max_surge", 2.5), "Maximum surge", 1, 10)
    requests = generate_requests(count, seed, max_surge, settings["tariff"], settings["energy_cost"])
    return replace(state, _revision(body.get("revision")), requests, settings,
                   {"kind": "synthetic", "seed": seed, "max_surge": max_surge})


def import_csv(state, revision, text):
    if len(text.encode("utf-8")) > 1_000_000:
        raise ApiError(413, "CSV must be smaller than 1 MB")
    try:
        rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
        if not rows or len(rows) > 2000:
            raise ValueError("CSV must contain 1 to 2,000 requests")
        bookings = []
        for row in rows:
            fields = {k: int(row[k]) for k in ("request_id", "arrival_min", "duration_min")}
            fields.update({k: float(row[k]) for k in ("energy_kwh", "surge_mult")})
            if row.get("deadline_min"):
                fields["deadline_min"] = int(row["deadline_min"])
            bookings.append(booking_from(fields))
    except (KeyError, ValueError, TypeError, csv.Error, ApiError) as error:
        detail = error.detail if isinstance(error, ApiError) else str(error)
        raise ApiError(422, "Invalid CSV. Use the downloaded request template; " + detail[:180]) from None
    settings = settings_from(state["settings"])
    return replace(state, _revision(revision), priced(bookings, settings), settings, {"kind": "imported"})


def optimize(state, body):
    if state["revision"] != body.get("revision"):
        raise ApiError(409, "The station changed. Reload before optimizing.")
    algorithm = body.get("algorithm", "optimal")
    requests = deserialize(state["requests"])
    if algorithm in ("search", "subsets") and len(requests) > 14:
        raise ApiError(422, "Use at most 14 requests for interactive brute-force runs")
    selected = solve(requests, state["settings"]["ports"], algorithm, True)
    return {"id": uuid4().hex, "created": datetime.now(timezone.utc).isoformat(),
            "revision": state["revision"], "source": state["source"], "settings": state["settings"],
            "requests": state["requests"], "selected": selected,
            "comparison": compare(requests, state["settings"]["ports"])}


def load_example(state, body):
    return replace(state, _revision(body.get("revision")), worked_example(), settings_from({"ports": 1}),
                   {"kind": "example", "description": "Report appendix A; illustrative weights"})


def run_summary(run):
    return {"id": run["id"], "created": run["created"], "revision": run["revision"],
            "profit_inr": run["selected"]["profit_inr"], "name": run["selected"]["name"],
            "accepted": run["selected"]["accepted"], "ports": run["settings"]["ports"]}


def sensitivity(state):
    requests = deserialize(state["requests"])
    return [{"ports": k, "optimal": solve(requests, k)["profit_inr"],
             "fcfs": solve(requests, k, "fcfs")["profit_inr"]} for k in range(1, 9)]


def csv_text(rows, fields=None):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields or REQUEST_FIELDS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def run_csv(run):
    accepted = {r["request_id"]: r["port"] for r in run["selected"]["schedule"]}
    rows = [{**r, "status": "accepted" if r["request_id"] in accepted else "rejected",
             "port": accepted.get(r["request_id"], "")} for r in run["requests"]]
    return csv_text(rows, REQUEST_FIELDS + ["status", "port"])


def browser_call(op, payload_json):
    """Single entry point for the browser worker: JSON in, JSON out."""
    payload = json.loads(payload_json)
    try:
        if op == "initial":
            data = initial_state()
        elif op == "update":
            data = update_state(payload["state"], payload["body"])
        elif op == "generate":
            data = generate_day(payload["state"], payload["body"])
        elif op == "import":
            data = import_csv(payload["state"], payload["revision"], payload["text"])
        elif op == "optimize":
            data = optimize(payload["state"], payload["body"])
        elif op == "example":
            data = load_example(payload["state"], payload["body"])
        elif op == "hubs":
            settings = settings_from(payload["settings"])
            data = hub_summaries(settings["tariff"], settings["energy_cost"])
        elif op == "sensitivity":
            data = sensitivity(payload["state"])
        elif op == "verify":
            from run_experiments import verify_correctness
            data = verify_correctness(search_count=40, subset_count=15, daily_count=5)
        elif op == "benchmark":
            from run_experiments import benchmark_algorithms
            data = benchmark_algorithms([50, 100, 250, 500, 1000], repeats=3)
        elif op == "requests_csv":
            data = csv_text(payload["state"]["requests"])
        elif op == "run_csv":
            data = run_csv(payload["run"])
        elif op == "algorithms":
            data = ALGORITHMS
        else:
            raise ApiError(404, "Unknown operation")
        return json.dumps({"ok": True, "data": data})
    except ApiError as error:
        return json.dumps({"ok": False, "status": error.status, "detail": error.detail})
    except (ValueError, KeyError, TypeError) as error:
        return json.dumps({"ok": False, "status": 422, "detail": str(error)})
