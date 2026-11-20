import argparse
import json
from pathlib import Path
import sys

from evsched import compare, create_request, solve


def evaluate(payload):
    settings = payload.get("settings", {})
    ports = settings.get("ports", payload.get("ports", 4))
    tariff = settings.get("tariff", 18)
    cost = settings.get("energy_cost", 9)
    requests = []
    for row in payload["requests"]:
        if "deadline_min" in row and row["deadline_min"] != row["arrival_min"] + row["duration_min"]:
            raise ValueError("Deadline must equal start plus duration")
        requests.append(create_request(row["request_id"], row["arrival_min"], row["duration_min"],
                                       row["energy_kwh"], row["surge_mult"], tariff, cost))
    algorithm = payload.get("algorithm")
    return {"ports": ports, "requests": len(requests), "results":
            [solve(requests, ports, algorithm, True)] if algorithm else compare(requests, ports)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JSON interface for external algorithm evaluation")
    parser.add_argument("input", nargs="?", type=Path)
    args = parser.parse_args()
    try:
        payload = json.loads(args.input.read_text(encoding="utf-8") if args.input else sys.stdin.read())
        print(json.dumps(evaluate(payload), separators=(",", ":")))
    except (ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
