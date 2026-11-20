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
