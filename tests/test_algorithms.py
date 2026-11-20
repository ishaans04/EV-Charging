from random import Random

import pytest

from evsched import Request, compare, create_request, generate_requests, max_overlap, solve, worked_example


def random_instance(seed, size=9):
    rng = Random(seed)
    return [Request(i + 1, rng.randrange(0, 30), rng.randrange(1, 20), 10, 1,
                    rng.randrange(-20, 200)) for i in range(size)]


def test_report_worked_example():
    results = compare(worked_example(), 1)
    assert [r["profit_inr"] for r in results] == [240, 170, 170, 220, 190]
    result = solve(worked_example(), 1, "dp", True)
    assert {r["request_id"] for r in result["schedule"]} == {1, 5, 4}
    assert result["trace"]["rows"][-1]["optimal"] == 240


@pytest.mark.parametrize("seed", range(120))
def test_exact_solvers_against_independent_oracles(seed):
    requests = random_instance(seed)
    ports = seed % 4 + 1
    oracle = solve(requests, ports, "subsets")["profit_inr"]
    assert solve(requests, ports, "search")["profit_inr"] == oracle
    result = solve(requests, ports, "flow")
    assert result["profit_inr"] == oracle
    if ports == 1:
        assert solve(requests, 1, "dp")["profit_inr"] == oracle
    for method in ("fcfs", "profit", "density", "eft"):
        assert solve(requests, ports, method)["profit_inr"] <= oracle


@pytest.mark.parametrize("method", ["dp", "flow", "fcfs", "profit", "density", "eft", "search", "subsets"])
def test_touching_slots_losses_duplicates_and_empty(method):
    requests = [Request(1, 0, 30, 10, 1, 10), Request(2, 30, 30, 10, 1, 20),
                Request(3, 0, 60, 10, 1, -5)]
    result = solve(requests, 1, method)
    assert result["profit_inr"] == 30
    assert result["accepted"] == 2
    assert solve([], 1, method)["profit_inr"] == 0
    with pytest.raises(ValueError, match="unique"):
        solve([requests[0], requests[0]], 1, method)


def test_capacity_monotonicity_and_trace():
    requests = generate_requests(150)
    totals = [solve(requests, k)["profit_inr"] for k in range(1, 9)]
    assert totals == sorted(totals)
    assert solve(requests, 1, "flow")["profit_inr"] == totals[0]
    result = solve(requests, 4, "flow", True)
    assert sum(a["profit_change"] for a in result["trace"]["augmentations"]) == result["profit_inr"]
    assert sum(a["units"] for a in result["trace"]["augmentations"]) == 4
    for port in range(1, 5):
        slots = [r for r in result["schedule"] if r["port"] == port]
        assert all(a["deadline_min"] <= b["arrival_min"] for a, b in zip(slots, slots[1:]))


def test_reproducible_generator_and_profit():
    requests = generate_requests(500, seed=42)
    assert requests == generate_requests(500, seed=42)
    assert requests != generate_requests(500, seed=43)
    for r in requests:
        assert 360 <= r.arrival_min <= 1380
        assert r.arrival_min % 5 == r.duration_min % 5 == 0
        assert r.deadline_min <= 1440
        assert r.profit_inr == round(r.energy_kwh * (18 * r.surge_mult - 9))
    assert create_request(1, 0, 30, 24, 2).profit_inr == 648


def test_invalid_inputs_and_oracle_bounds():
    for args in [(1, 0, 0, 10, 1, 10), (1, 1430, 30, 10, 1, 10),
                 (1, 0, 30, float("nan"), 1, 10), (1, 0, 30, 10, .5, 10)]:
        with pytest.raises(ValueError):
            Request(*args)
    for ports in (0, -1, 129, 1.5):
        with pytest.raises(ValueError):
            solve([], ports)
    with pytest.raises(ValueError):
        solve([], 2, "dp")
    with pytest.raises(ValueError):
        solve(generate_requests(19), 2, "subsets")
    assert max_overlap([Request(1, 0, 10, 10, 1, 1), Request(2, 10, 10, 10, 1, 1)]) == 1
