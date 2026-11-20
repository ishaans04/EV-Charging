import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
from random import Random
from statistics import mean, stdev

from evsched import Request, compare, generate_requests, solve


def verify_correctness(search_count=1500, subset_count=150, daily_count=200):
    checked = {"search": 0, "subsets": 0, "dp_vs_flow": 0}
    for seed in range(max(search_count, subset_count)):
        rng = Random(70000 + seed)
        n = rng.randrange(0, 15 if seed < search_count else 11)
        requests = [Request(i + 1, rng.randrange(0, 300), rng.randrange(1, 100),
                            10, 1, rng.randrange(-30, 500)) for i in range(n)]
        ports = seed % 4 + 1
        exact = solve(requests, ports, "flow")["profit_inr"]
        if seed < search_count:
            expected = solve(requests, ports, "search")["profit_inr"]
            if expected != exact:
                raise RuntimeError(f"Search disagreement at seed {70000 + seed}")
            checked["search"] += 1
        if seed < subset_count:
            small = requests[:10]
            expected = solve(small, ports, "subsets")["profit_inr"]
            if expected != solve(small, ports, "flow")["profit_inr"]:
                raise RuntimeError(f"Subset disagreement at seed {70000 + seed}")
            checked["subsets"] += 1
    for seed in range(daily_count):
        requests = generate_requests(150, 80000 + seed)
        if solve(requests, 1, "dp")["profit_inr"] != solve(requests, 1, "flow")["profit_inr"]:
            raise RuntimeError(f"DP/flow disagreement at seed {80000 + seed}")
        checked["dp_vs_flow"] += 1
    return {"passed": sum(checked.values()), "failed": 0, "checks": checked,
            "search_seed_start": 70000, "daily_seed_start": 80000}


def benchmark_algorithms(sizes=None, repeats=3):
    sizes = sizes or [100, 500, 1000, 5000, 10000, 50000]
    rows = []
    for n in sizes:
        requests = generate_requests(n, 90000 + n)
        row = {"n": n}
        for method, ports in (("dp", 1), ("flow", 4), ("fcfs", 4)):
            row[method] = min(solve(requests, ports, method)["runtime_ms"] for _ in range(repeats))
        rows.append(row)
    return rows


def summarize(days):
    return [{"algorithm": days[0][j]["algorithm"], "name": days[0][j]["name"],
             "mean_profit": mean(day[j]["profit_inr"] for day in days),
             "sd_profit": stdev(day[j]["profit_inr"] for day in days) if len(days) > 1 else 0,
             "mean_accepted": mean(day[j]["accepted"] for day in days),
             "mean_utilization": mean(day[j]["utilization"] for day in days)} for j in range(5)]


def run(days=40, quick=False):
    seeds = list(range(40000, 40000 + days))
    correctness = verify_correctness(80, 20, 10) if quick else verify_correctness()
    print(f"Correctness: {correctness['passed']} checks passed", flush=True)
    quality = summarize([compare(generate_requests(150, seed), 4) for seed in seeds])
    capacity = []
    for ports in range(1, 9):
        summary = summarize([compare(generate_requests(150, seed), ports) for seed in seeds])
        capacity.append({"ports": ports, "methods": summary})
    print("Capacity comparison complete", flush=True)
    surge = []
    for maximum in (1, 1.5, 2, 2.5, 3):
        summary = summarize([compare(generate_requests(150, seed, maximum), 4) for seed in seeds])
        surge.append({"max_surge": maximum, "methods": summary})
    demand = []
    for n in (40, 80, 120, 160, 200, 250, 300):
        summary = summarize([compare(generate_requests(n, seed), 4) for seed in seeds])
        demand.append({"n": n, "methods": summary})
    print("Sensitivity comparison complete", flush=True)
    timing = benchmark_algorithms([100, 500, 1000, 5000] if quick else None)
    brute_timing = []
    for n in ((8, 10, 12) if quick else (10, 12, 14, 16, 18)):
        requests = generate_requests(n, 90000 + n)
        brute_timing.append({"n": n, "subsets": solve(requests, 1, "subsets")["runtime_ms"]})
    case_requests = generate_requests(120, 2026)
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "python": platform.python_version(),
            "platform": platform.platform(), "mode": "quick" if quick else "full",
            "config": {"days": days, "seeds": seeds, "requests": 150, "ports": 4,
                       "tariff": 18, "energy_cost": 9, "max_surge": 2.5,
                       "generator": "Python random.Random; synthetic assumptions from report"},
            "correctness": correctness, "quality": quality, "capacity": capacity,
            "surge": surge, "demand": demand, "timing_ms": timing, "brute_timing_ms": brute_timing,
            "case_study": {"seed": 2026, "requests": [r.to_dict() for r in case_requests],
                           "methods": compare(case_requests, 4)}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reproduce Volt's algorithm evaluation")
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("results.json"))
    args = parser.parse_args()
    result = run(days=4 if args.quick else 40, quick=args.quick)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Saved {args.output}", flush=True)
