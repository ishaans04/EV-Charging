from bisect import bisect_left, bisect_right
from dataclasses import asdict, dataclass
from fractions import Fraction
from heapq import heappop, heappush
from math import ceil, isfinite, log
from random import Random
from time import perf_counter


TARIFF = 18.0
ENERGY_COST = 9.0


@dataclass(frozen=True, slots=True)
class Request:
    request_id: int
    arrival_min: int
    duration_min: int
    energy_kwh: float
    surge_mult: float
    profit_inr: int

    def __post_init__(self):
        if type(self.request_id) is not int or self.request_id < 1:
            raise ValueError("Request ID must be a positive integer")
        if type(self.arrival_min) is not int or type(self.duration_min) is not int:
            raise ValueError("Times must be whole minutes")
        if not 0 <= self.arrival_min < self.deadline_min <= 1440:
            raise ValueError("Each slot must have positive duration and fit within one day")
        if not isfinite(self.energy_kwh) or not 0 < self.energy_kwh <= 1000:
            raise ValueError("Energy must be between 0 and 1,000 kWh")
        if not isfinite(self.surge_mult) or not 1 <= self.surge_mult <= 10:
            raise ValueError("Surge must be between 1 and 10")
        if type(self.profit_inr) is not int or abs(self.profit_inr) > 10**9:
            raise ValueError("Profit must be an integer within one billion rupees")

    @property
    def deadline_min(self):
        return self.arrival_min + self.duration_min

    def to_dict(self):
        return {**asdict(self), "deadline_min": self.deadline_min}


def create_request(request_id, arrival_min, duration_min, energy_kwh, surge_mult,
                   tariff=TARIFF, energy_cost=ENERGY_COST):
    if not all(isfinite(v) and 0 <= v <= 1000 for v in (tariff, energy_cost)):
        raise ValueError("Tariff and energy cost must be finite and between 0 and 1,000")
    profit = int(round(energy_kwh * (tariff * surge_mult - energy_cost)))
    return Request(request_id, arrival_min, duration_min, energy_kwh, surge_mult, profit)


def generate_requests(n=150, seed=2026, max_surge=2.5, tariff=TARIFF, energy_cost=ENERGY_COST):
    if type(n) is not int or not 0 <= n <= 100000:
        raise ValueError("Request count must be between 0 and 100,000")
    if not isfinite(max_surge) or not 1 <= max_surge <= 10:
        raise ValueError("Maximum surge must be between 1 and 10")
    rng = Random(seed)
    requests = []
    while len(requests) < n:
        draw = rng.random()
        arrival = rng.gauss(540, 60) if draw < .25 else (
            rng.gauss(1110, 90) if draw < .65 else rng.uniform(360, 1380))
        start = round(arrival / 5) * 5
        if not 360 <= start <= 1380:
            continue
        energy = round(min(60, max(8, rng.lognormvariate(log(24), .45))), 2)
        power = rng.choices([25, 35, 50], [.3, .3, .4])[0]
        duration = max(15, min(150, ceil((energy / power * 60 + 5) / 5) * 5))
        if start + duration > 1440:
            continue
        willingness = rng.betavariate(2, 3)
        if 480 <= start < 660 or 1020 <= start < 1260:
            willingness = min(1, willingness * 1.4)
        surge = round(1 + (max_surge - 1) * willingness, 3)
        requests.append(create_request(len(requests) + 1, start, duration, energy,
                                       surge, tariff, energy_cost))
    return requests


def worked_example():
    slots = [(20, 40, 90), (90, 120, 60), (10, 70, 30), (80, 130, 80),
             (40, 80, 70), (10, 30, 60), (0, 60, 90), (50, 110, 40)]
    return [Request(i + 1, s, f - s, 10, 1, p) for i, (s, f, p) in enumerate(slots)]


def validate_instance(requests, ports):
    if type(ports) is not int or not 1 <= ports <= 128:
        raise ValueError("Ports must be between 1 and 128")
    if len({r.request_id for r in requests}) != len(requests):
        raise ValueError("Request IDs must be unique")


def max_overlap(requests):
    events = sorted([(r.arrival_min, 1) for r in requests] +
                    [(r.deadline_min, -1) for r in requests])
    current = peak = 0
    for _, delta in events:
        current += delta
        peak = max(peak, current)
    return peak


def dp_single_port(requests, trace=False):
    order = sorted(range(len(requests)), key=lambda i: (
        requests[i].deadline_min, requests[i].arrival_min, requests[i].request_id))
    finishes = [requests[i].deadline_min for i in order]
    predecessors = [bisect_right(finishes, requests[i].arrival_min) for i in order]
    opt = [0] * (len(order) + 1)
    taken = [False] * len(order)
    rows = []
    for j, i in enumerate(order):
        include = requests[i].profit_inr + opt[predecessors[j]]
        taken[j] = include > opt[j]
        opt[j + 1] = max(opt[j], include)
        if trace:
            rows.append({"j": j + 1, "request_id": requests[i].request_id,
                         "predecessor": predecessors[j], "include": include,
                         "exclude": opt[j], "optimal": opt[j + 1], "take": taken[j]})
    chosen = []
    j = len(order)
    while j:
        if taken[j - 1]:
            chosen.append(order[j - 1])
            j = predecessors[j - 1]
        else:
            j -= 1
    return chosen, {"rows": rows, "states": len(order) + 1}


def flow_k_ports(requests, ports, trace=False):
    validate_instance(requests, ports)
    if not requests:
        return [], {"nodes": 0, "arcs": 0, "augmentations": []}
    times = sorted({r.arrival_min for r in requests} | {r.deadline_min for r in requests})
    index = {t: i for i, t in enumerate(times)}
    adjacency = [[] for _ in times]
    to, capacity, cost = [], [], []

    def add_edge(u, v, cap, weight):
        edge = len(to)
        adjacency[u].append(edge)
        adjacency[v].append(edge + 1)
        to.extend((v, u))
        capacity.extend((cap, 0))
        cost.extend((weight, -weight))
        return edge

    for j in range(len(times) - 1):
        add_edge(j, j + 1, ports, 0)
    request_edges = [add_edge(index[r.arrival_min], index[r.deadline_min], 1,
                              -r.profit_inr) for r in requests]
    infinity = float("inf")
    potential = [infinity] * len(times)
    potential[0] = 0
    for u in range(len(times)):
        for edge in adjacency[u]:
            if capacity[edge] and to[edge] > u:
                potential[to[edge]] = min(potential[to[edge]], potential[u] + cost[edge])
    flow = 0
    augmentations = []
    while flow < ports:
        distance = [infinity] * len(times)
        parent = [-1] * len(times)
        distance[0] = 0
        queue = [(0, 0)]
        while queue:
            dist, u = heappop(queue)
            if dist != distance[u]:
                continue
            for edge in adjacency[u]:
                if not capacity[edge]:
                    continue
                v = to[edge]
                candidate = dist + cost[edge] + potential[u] - potential[v]
                if candidate < distance[v]:
                    distance[v] = candidate
                    parent[v] = edge
                    heappush(queue, (candidate, v))
        if parent[-1] == -1:
            raise RuntimeError("Flow network unexpectedly has no source-to-sink path")
        for v, dist in enumerate(distance):
            if dist < infinity:
                potential[v] += dist
        push = ports - flow
        v = len(times) - 1
        path = []
        while v:
            edge = parent[v]
            push = min(push, capacity[edge])
            path.append(edge)
            v = to[edge ^ 1]
        for edge in path:
            capacity[edge] -= push
            capacity[edge ^ 1] += push
        flow += push
        if trace:
            augmentations.append({"iteration": len(augmentations) + 1, "units": push,
                                  "flow": flow, "profit_change": -sum(cost[e] for e in path) * push,
                                  "path_minutes": [times[0]] + [times[to[e]] for e in reversed(path)],
                                  "reverse_arcs": sum(e % 2 for e in path)})
    chosen = [i for i, e in enumerate(request_edges) if capacity[e] == 0]
    return chosen, {"nodes": len(times), "arcs": len(to) // 2,
                    "augmentations": augmentations}


def assign_ports(requests, chosen, ports):
    free_at = [0] * ports
    assignment = {}
    for i in sorted(chosen, key=lambda i: (requests[i].arrival_min,
                                          requests[i].deadline_min, requests[i].request_id)):
        available = [p for p in range(ports) if free_at[p] <= requests[i].arrival_min]
        if not available:
            raise ValueError("Selected requests exceed port capacity")
        port = max(available, key=lambda p: (free_at[p], -p))
        free_at[port] = requests[i].deadline_min
        assignment[i] = port + 1
    return assignment


def greedy(requests, ports, rule="fcfs"):
    keys = {
        "fcfs": lambda r: (r.arrival_min, r.deadline_min, r.request_id),
        "profit": lambda r: (-r.profit_inr, r.arrival_min, r.request_id),
        "density": lambda r: (-Fraction(r.profit_inr, r.duration_min), r.arrival_min, r.request_id),
        "eft": lambda r: (r.deadline_min, r.arrival_min, r.request_id),
    }
    if rule not in keys:
        raise ValueError("Unknown greedy rule")
    occupied = [0] * ports
    chosen = []
    for i in sorted(range(len(requests)), key=lambda i: keys[rule](requests[i])):
        r = requests[i]
        if r.profit_inr <= 0:
            continue
        mask = ((1 << r.duration_min) - 1) << r.arrival_min
        for p in range(ports):
            if not occupied[p] & mask:
                occupied[p] |= mask
                chosen.append(i)
                break
    return chosen, {}


def brute_force_subsets(requests, ports):
    validate_instance(requests, ports)
    if len(requests) > 18:
        raise ValueError("Subset oracle is limited to 18 requests")
    best, chosen = 0, []
    for mask in range(1 << len(requests)):
        subset = [i for i in range(len(requests)) if mask >> i & 1]
        profit = sum(requests[i].profit_inr for i in subset)
        if profit > best and max_overlap([requests[i] for i in subset]) <= ports:
            best, chosen = profit, subset
    return chosen, {"subsets": 1 << len(requests)}


def brute_force_search(requests, ports):
    validate_instance(requests, ports)
    if len(requests) > 24:
        raise ValueError("Search oracle is limited to 24 requests")
    order = sorted(range(len(requests)), key=lambda i: (
        requests[i].arrival_min, requests[i].deadline_min, requests[i].request_id))
    suffix = [0] * (len(order) + 1)
    for j in range(len(order) - 1, -1, -1):
        suffix[j] = suffix[j + 1] + max(0, requests[order[j]].profit_inr)
    best, result, visited = 0, [], 0

    def visit(j, free_at, value, selected):
        nonlocal best, result, visited
        visited += 1
        if value + suffix[j] <= best:
            return
        if j == len(order):
            best, result = value, selected[:]
            return
        i = order[j]
        r = requests[i]
        if r.profit_inr > 0 and free_at[0] <= r.arrival_min:
            selected.append(i)
            visit(j + 1, tuple(sorted((*free_at[1:], r.deadline_min))),
                  value + r.profit_inr, selected)
            selected.pop()
        visit(j + 1, free_at, value, selected)

    visit(0, (0,) * ports, 0, [])
    return result, {"visited": visited}


ALGORITHMS = {
    "optimal": {"name": "Optimal", "complexity": "O(k n log n)", "exact": True},
    "dp": {"name": "Dynamic programming", "complexity": "O(n log n)", "exact": True},
    "flow": {"name": "Minimum-cost flow", "complexity": "O(k n log n)", "exact": True},
    "fcfs": {"name": "First come, first served", "complexity": "O(n log n + n k B)", "exact": False},
    "profit": {"name": "Highest profit", "complexity": "O(n log n + n k B)", "exact": False},
    "density": {"name": "Profit per minute", "complexity": "O(n log n + n k B)", "exact": False},
    "eft": {"name": "Earliest finish", "complexity": "O(n log n + n k B)", "exact": False},
    "search": {"name": "Branch and bound", "complexity": "O(2^n n log k)", "exact": True},
    "subsets": {"name": "Subset enumeration", "complexity": "O(2^n n log n)", "exact": True},
}


def solve(requests, ports=4, algorithm="optimal", trace=False):
    validate_instance(requests, ports)
    if algorithm not in ALGORITHMS:
        raise ValueError("Unknown algorithm")
    selected_algorithm = ("dp" if ports == 1 else "flow") if algorithm == "optimal" else algorithm
    if selected_algorithm == "dp" and ports != 1:
        raise ValueError("Dynamic programming supports exactly one port")
    start = perf_counter()
    if selected_algorithm == "dp":
        chosen, details = dp_single_port(requests, trace)
    elif selected_algorithm == "flow":
        chosen, details = flow_k_ports(requests, ports, trace)
    elif selected_algorithm == "search":
        chosen, details = brute_force_search(requests, ports)
    elif selected_algorithm == "subsets":
        chosen, details = brute_force_subsets(requests, ports)
    else:
        chosen, details = greedy(requests, ports, selected_algorithm)
    elapsed = (perf_counter() - start) * 1000
    assignment = assign_ports(requests, chosen, ports)
    if max_overlap([requests[i] for i in chosen]) > ports:
        raise RuntimeError("Solver produced an infeasible result")
    schedule = [{**requests[i].to_dict(), "port": assignment[i]} for i in
                sorted(chosen, key=lambda i: (requests[i].arrival_min, requests[i].request_id))]
    return {"algorithm": selected_algorithm, "name": ALGORITHMS[selected_algorithm]["name"],
            "exact": ALGORITHMS[selected_algorithm]["exact"],
            "complexity": ALGORITHMS[selected_algorithm]["complexity"],
            "profit_inr": sum(requests[i].profit_inr for i in chosen),
            "accepted": len(chosen), "rejected": len(requests) - len(chosen), "ports": ports,
            "utilization": sum(requests[i].duration_min for i in chosen) / (ports * 1440) * 100,
            "runtime_ms": round(elapsed, 4), "schedule": schedule, "trace": details}


def compare(requests, ports=4):
    results = [solve(requests, ports, method) for method in
               ("optimal", "fcfs", "profit", "density", "eft")]
    optimum = results[0]["profit_inr"]
    baseline = results[1]["profit_inr"]
    for result in results:
        result["optimal_percent"] = result["profit_inr"] / optimum * 100 if optimum else 100.0
        result["gain_fcfs_percent"] = (result["profit_inr"] / baseline - 1) * 100 if baseline else None
    return results
