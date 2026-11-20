import argparse
import csv
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request as HTTPRequest
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, model_validator

from evsched import ALGORITHMS, Request, compare, create_request, generate_requests, solve, validate_instance, worked_example


ROOT = Path(__file__).resolve().parent


class Settings(BaseModel):
    ports: int = Field(default=4, ge=1, le=32, strict=True)
    tariff: float = Field(default=18, ge=0, le=1000, allow_inf_nan=False)
    energy_cost: float = Field(default=9, ge=0, le=1000, allow_inf_nan=False)


class Booking(BaseModel):
    model_config = ConfigDict(extra="ignore")
    request_id: int = Field(ge=1, strict=True)
    arrival_min: int = Field(ge=0, lt=1440, strict=True)
    duration_min: int = Field(gt=0, le=1440, strict=True)
    energy_kwh: float = Field(gt=0, le=1000, allow_inf_nan=False)
    surge_mult: float = Field(ge=1, le=10, allow_inf_nan=False)
    deadline_min: int | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def validate_slot(self):
        finish = self.arrival_min + self.duration_min
        if finish > 1440:
            raise ValueError("Slot must finish by midnight")
        if self.deadline_min is not None and self.deadline_min != finish:
            raise ValueError("Deadline must equal start plus duration in the fixed-slot model")
        return self


class StateEdit(BaseModel):
    revision: int = Field(ge=1, strict=True)
    settings: Settings
    requests: list[Booking] = Field(max_length=2000)


class Generate(BaseModel):
    revision: int = Field(ge=1, strict=True)
    count: int = Field(default=150, ge=0, le=2000, strict=True)
    seed: int = Field(default=2026, ge=0, le=2**32 - 1, strict=True)
    max_surge: float = Field(default=2.5, ge=1, le=10, allow_inf_nan=False)
    settings: Settings = Field(default_factory=Settings)


class Run(BaseModel):
    revision: int = Field(ge=1, strict=True)
    algorithm: str = "optimal"


def deserialize(rows):
    return [Request(**{k: row[k] for k in Request.__dataclass_fields__}) for row in rows]


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created TEXT NOT NULL, payload TEXT NOT NULL)")
            initial = {"revision": 1, "settings": Settings().model_dump(),
                       "source": {"kind": "synthetic", "seed": 2026, "max_surge": 2.5},
                       "requests": [r.to_dict() for r in generate_requests()]}
            db.execute("INSERT OR IGNORE INTO state VALUES (1, ?)", (json.dumps(initial),))

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.execute("PRAGMA busy_timeout = 15000")
        return db

    def read(self):
        with self.connect() as db:
            return json.loads(db.execute("SELECT payload FROM state WHERE id=1").fetchone()[0])

    def replace(self, revision, requests, settings, source):
        validate_instance(requests, settings.ports)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = json.loads(db.execute("SELECT payload FROM state WHERE id=1").fetchone()[0])
            if current["revision"] != revision:
                raise HTTPException(409, "The station changed in another tab. Reload before saving.")
            state = {"revision": revision + 1, "settings": settings.model_dump(),
                     "source": source, "requests": [r.to_dict() for r in requests]}
            db.execute("UPDATE state SET payload=? WHERE id=1", (json.dumps(state),))
        return state

    def save_run(self, result):
        with self.connect() as db:
            db.execute("INSERT INTO runs VALUES (?, ?, ?)",
                       (result["id"], result["created"], json.dumps(result)))
            db.execute("DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY created DESC LIMIT 30)")

    def get_run(self, run_id):
        with self.connect() as db:
            row = db.execute("SELECT payload FROM runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Schedule not found")
        return json.loads(row[0])


def create_app(db_path=None):
    api = FastAPI(title="Volt", version="1.0.0")
    store = Store(db_path or Path(os.getenv("VOLT_DATA_DIR", ROOT / "data")) / "volt.db")
    api.state.store = store

    @api.exception_handler(ValueError)
    async def invalid_input(_, error):
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @api.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'")
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @api.get("/api/health")
    def health():
        return {"status": "ok", "app": "Volt"}

    @api.get("/api/state")
    def state():
        return store.read()

    @api.put("/api/state")
    def update(payload: StateEdit):
        settings = payload.settings
        requests = [create_request(r.request_id, r.arrival_min, r.duration_min,
                                   r.energy_kwh, r.surge_mult, settings.tariff,
                                   settings.energy_cost) for r in payload.requests]
        return store.replace(payload.revision, requests, settings, {"kind": "custom"})

    @api.post("/api/generate")
    def generate(payload: Generate):
        requests = generate_requests(payload.count, payload.seed, payload.max_surge,
                                     payload.settings.tariff, payload.settings.energy_cost)
        return store.replace(payload.revision, requests, payload.settings,
                             {"kind": "synthetic", "seed": payload.seed, "max_surge": payload.max_surge})

    @api.post("/api/import")
    async def import_csv(request: HTTPRequest, revision: int):
        body = await request.body()
        if len(body) > 1_000_000:
            raise HTTPException(413, "CSV must be smaller than 1 MB")
        try:
            rows = list(csv.DictReader(io.StringIO(body.decode("utf-8-sig"))))
            if not rows or len(rows) > 2000:
                raise ValueError("CSV must contain 1 to 2,000 requests")
            bookings = []
            for row in rows:
                fields = {k: int(row[k]) for k in ("request_id", "arrival_min", "duration_min")}
                fields.update({k: float(row[k]) for k in ("energy_kwh", "surge_mult")})
                if row.get("deadline_min"):
                    fields["deadline_min"] = int(row["deadline_min"])
                bookings.append(Booking(**fields))
        except (KeyError, ValueError, UnicodeError, csv.Error) as error:
            raise HTTPException(422, "Invalid CSV. Use the downloaded request template; " + str(error)[:180]) from error
        settings = Settings(**store.read()["settings"])
        requests = [create_request(r.request_id, r.arrival_min, r.duration_min, r.energy_kwh,
                                   r.surge_mult, settings.tariff, settings.energy_cost) for r in bookings]
        return store.replace(revision, requests, settings, {"kind": "imported"})

    @api.get("/api/requests.csv")
    def export_requests():
        return csv_response(store.read()["requests"], "volt-requests.csv")

    @api.get("/api/algorithms")
    def algorithms():
        return ALGORITHMS

    @api.post("/api/optimize")
    def optimize(payload: Run):
        state = store.read()
        if state["revision"] != payload.revision:
            raise HTTPException(409, "The station changed. Reload before optimizing.")
        requests = deserialize(state["requests"])
        ports = state["settings"]["ports"]
        if payload.algorithm in ("search", "subsets") and len(requests) > 14:
            raise HTTPException(422, "Use at most 14 requests for interactive brute-force runs")
        selected = solve(requests, ports, payload.algorithm, True)
        comparisons = compare(requests, ports)
        result = {"id": uuid4().hex, "created": datetime.now(timezone.utc).isoformat(),
                  "revision": state["revision"], "source": state["source"], "settings": state["settings"],
                  "requests": state["requests"], "selected": selected, "comparison": comparisons}
        store.save_run(result)
        return result

    @api.post("/api/example")
    def example(payload: Run):
        return store.replace(payload.revision, worked_example(), Settings(ports=1),
                             {"kind": "example", "description": "Report appendix A; illustrative weights"})

    @api.get("/api/runs")
    def history():
        with store.connect() as db:
            runs = [json.loads(row[0]) for row in db.execute("SELECT payload FROM runs ORDER BY created DESC")]
        return [{"id": r["id"], "created": r["created"], "revision": r["revision"],
                 "profit_inr": r["selected"]["profit_inr"], "name": r["selected"]["name"],
                 "accepted": r["selected"]["accepted"], "ports": r["settings"]["ports"]} for r in runs]

    @api.get("/api/runs/{run_id}")
    def get_run(run_id: str):
        return store.get_run(run_id)

    @api.get("/api/runs/{run_id}/export")
    def export_run(run_id: str, format: Literal["csv", "json"] = "csv"):
        result = store.get_run(run_id)
        if format == "json":
            return Response(json.dumps(result, indent=2), media_type="application/json",
                            headers={"Content-Disposition": 'attachment; filename="volt-schedule.json"'})
        accepted = {r["request_id"]: r["port"] for r in result["selected"]["schedule"]}
        rows = [{**r, "status": "accepted" if r["request_id"] in accepted else "rejected",
                 "port": accepted.get(r["request_id"], "")} for r in result["requests"]]
        return csv_response(rows, "volt-schedule.csv", ["request_id", "arrival_min", "duration_min",
                            "energy_kwh", "surge_mult", "profit_inr", "deadline_min", "status", "port"])

    @api.post("/api/lab/verify")
    def verify():
        from run_experiments import verify_correctness
        return verify_correctness(search_count=40, subset_count=15, daily_count=5)

    @api.post("/api/lab/sensitivity")
    def sensitivity():
        state = store.read()
        requests = deserialize(state["requests"])
        return [{"ports": k, "optimal": solve(requests, k)["profit_inr"],
                 "fcfs": solve(requests, k, "fcfs")["profit_inr"]} for k in range(1, 9)]

    @api.post("/api/lab/benchmark")
    def benchmark():
        from run_experiments import benchmark_algorithms
        return benchmark_algorithms([50, 100, 250, 500, 1000], repeats=3)

    @api.get("/")
    def landing():
        return FileResponse(ROOT / "static" / "index.html")

    @api.get("/console")
    def console():
        return FileResponse(ROOT / "static" / "console.html")

    api.mount("/static", StaticFiles(directory=ROOT / "static", check_dir=False), name="static")
    return api


def csv_response(rows, filename, fields=None):
    output = io.StringIO(newline="")
    fields = fields or ["request_id", "arrival_min", "duration_min", "energy_kwh", "surge_mult",
                        "profit_inr", "deadline_min"]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return Response(output.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


app = create_app()


if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser(description="Start the Volt station console")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port)
