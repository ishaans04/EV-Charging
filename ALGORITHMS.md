# Volt algorithm guide

## Model

Request i has a start sᵢ, duration dᵢ, strict deadline fᵢ = sᵢ + dᵢ, requested energy eᵢ and an input surge multiplier mᵢ. It occupies [sᵢ, fᵢ). Its integer net profit is pᵢ = round(eᵢ(Tmᵢ − c)). The empty schedule is valid and earns zero, so loss-making sessions can be skipped.

Choose a subset maximizing Σpᵢ subject to at most k accepted intervals active at every instant. A session finishing at t does not conflict with a session starting at t. Overlap sweeps process ends before starts at equal times.

All solver results pass through `assign_ports`. Start-time interval coloring gives each interval a free physical port; the implementation chooses the available port that most recently became free. If overlap depth is at most k, a free port must exist: at most k−1 earlier sessions can still be active when the next one starts. This proves that the capacity constraint suffices for a valid assignment.

## Single-port dynamic programming

`dp_single_port` sorts by `(finish, start, request_id)`. For each j, `bisect_right` returns the number pred(j) of intervals finishing no later than j starts. Since every duration is positive, the predecessor prefix ends before j.

```text
OPT(0) = 0
OPT(j) = max(OPT(j−1), pⱼ + OPT(pred(j)))
```

An optimal solution either omits j, leaving the first j−1 requests, or includes j and can use only the compatible predecessor prefix. The induction hypothesis supplies optimal solutions for both smaller prefixes. Both candidates are achievable, so their maximum is exactly optimal. Traceback follows a take decision to its predecessor; otherwise it moves back one state. Ties skip j, making the output deterministic.

Sorting and n binary searches cost O(n log n); table construction and traceback cost O(n). Space is O(n). This recurrence solves one port only; the application rejects multi-port DP requests rather than claiming repeated single-port DP is globally optimal.

## Minimum-cost flow

`flow_k_ports` builds one node per distinct start or end time. Consecutive nodes get an idle arc of capacity k and cost zero. Each request gets an arc from its start node to its end node with capacity one and cost −pᵢ. Every forward edge is paired with a reverse residual edge using `edge ^ 1`.

Send exactly k units of flow from the earliest to latest time. A path represents one port's chronological schedule. Integral capacities admit integral flow; a capacity-one request arc is used either once or not at all. Thus k paths yield a feasible accepted set. Conversely, every feasible k-port schedule can be turned into k such paths with idle arcs between bookings. Path cost is negative accepted profit. Minimizing flow cost therefore maximizes profit.

Initial forward arcs form a DAG, so one chronological relaxation pass computes shortest-path potentials despite negative request costs. Dijkstra then uses reduced cost `cost(u,v) + potential(u) − potential(v)`. Residual edges on shortest paths become zero-reduced-cost, allowing exchanges of previously selected requests. After each full Dijkstra pass, reachable potentials are increased by the computed distances. The next reduced costs stay nonnegative.

Each augmentation pushes the minimum of remaining required flow and path bottleneck. Every augmentation sends at least one unit, so there are at most k searches. The graph has at most 2n nodes and 3n−1 forward arcs, giving O(k n log n) time and O(n) graph storage. Empty inputs are handled separately. The implementation does not stop Dijkstra at the sink: it finishes distances before updating all reachable potentials.

## Four greedy baselines

`greedy` orders requests by one of four rules and accepts a request if a physical port is free for its entire interval:

| Rule | Primary order | Deterministic tie order |
| --- | --- | --- |
| FCFS | Increasing start | Finish, ID |
| Profit | Decreasing profit | Start, ID |
| Density | Decreasing profit/duration | Start, ID |
| Earliest finish | Increasing deadline | Start, ID |

Density uses `Fraction` so nearly equal ratios are compared exactly. A Python integer represents each port's 1,440-minute occupancy bitmap. The mask for [s,f) has d consecutive set bits shifted by s. Admission checks `occupied & mask == 0`; acceptance sets the bits with OR. This checks the whole interval even when profit-ordered requests arrive out of time order.

For B machine words spanning a day, runtime is O(n log n + n k B), and storage is O(n + k B). The fixed 1,440-minute horizon keeps B small. These bounds explicitly account for arbitrary-size integer operations. No GPU or external scheduling library is used.

First-fit admission can fragment port histories for requests considered out of chronological order. The baselines intentionally preserve the report's first-fit behavior. The selected subset is then independently recolored in start order. This recoloring preserves the accepted subset and total profit; it does not turn a greedy rule into an optimum.

## Report counterexample

| Request | Start | Finish | Profit |
| --- | ---: | ---: | ---: |
| R1 | 20 | 40 | 90 |
| R2 | 90 | 120 | 60 |
| R3 | 10 | 70 | 30 |
| R4 | 80 | 130 | 80 |
| R5 | 40 | 80 | 70 |
| R6 | 10 | 30 | 60 |
| R7 | 0 | 60 | 90 |
| R8 | 50 | 110 | 40 |

One port yields FCFS 170, profit 170, density 220, earliest finish 190, and exact DP/flow 240. The exact subset is R1 + R5 + R4. A local decision can block a more valuable combination, so the greedy exchange argument for maximum cardinality does not establish maximum weighted profit.

The interactive report example derives illustrative energy as p/9 at tariff 18, cost 9 and multiplier 1. This preserves the report's arbitrary weights while keeping the application's profit formula consistent. These are teaching values, separate from the realistic-range synthetic generator.

## Independent verification

`brute_force_subsets` enumerates all 2ⁿ subsets, computes each profit and independently checks interval overlap. It costs O(2ⁿ n log n) time and O(n) working space. The library caps it at 18 requests; the UI caps it at 14.

`brute_force_search` walks requests in start order and branches on accepting or skipping. Available ports are identical, so one canonical free-port choice suffices. An upper bound adds all remaining positive profits; if even that cannot improve the best answer, the branch is pruned. Worst-case time remains exponential, O(2ⁿ (n + k log k)) including copied solutions and sorted port-state updates. Recursion keeps O(n(n+k)) space as a conservative bound. The library caps it at 24 requests; the UI caps it at 14.

The full recorded run checks 1,500 small random instances against search, 150 against subset enumeration and 200 generated full days comparing single-port DP and flow. Automated tests additionally cover endpoint reuse, losses, invalid slots, duplicate IDs, trace profit accounting, deterministic generation, capacity monotonicity, API persistence, stale revisions and CSV round trips. Agreement is strong implementation evidence; the structural arguments above establish exactness within the model.

## Demand and experiments

`generate_requests` uses its own seeded `random.Random`. Starts use the report's 25% morning Gaussian, 40% evening Gaussian and 35% uniform background mixture. Energy is clipped log-normal demand, and vehicle limits are 25/35/50 kW. Duration includes five minutes of overhead, rounded up to five-minute slots. Off-day or after-midnight draws are rejected and redrawn. Surge uses Beta(2,3), boosted in the report's peak windows.

`run_experiments.py` writes observations rather than hardcoded outcomes: mean and standard deviation across days, capacity from one to eight ports, five surge settings, seven demand settings, best-of-three solver timings, exhaustive-search timings, and a four-port case-study schedule. `make_figs.py` renders ten scientific figure files from those observations. The committed `results.json` records seeds, host platform, Python version and all case-study inputs and schedules.

All profits use Python's nearest-integer `round`, including ties-to-even. The public API recalculates profit from prices, energy and surge. Direct library `Request` objects may carry independent weights for algorithm testing. Metrics use net accepted profit, accepted count, and accepted minutes divided by k × 1440 for utilization. Gain percentages are undefined when FCFS profit is zero; the UI displays a dash rather than dividing by zero.

## Viva prompts

- **Why half-open intervals?** A port can be reused at exactly the previous departure time.
- **Why binary search in DP?** Compatible finishes form a sorted prefix; linear predecessor scans would increase runtime to quadratic.
- **Why negative arc cost?** Minimizing the sum of −profit is equivalent to maximizing total profit.
- **Why residual reverse arcs?** They let a later augmenting path undo and replace an earlier choice.
- **Why potentials?** Dijkstra requires nonnegative edge weights; reduced costs preserve shortest-path ordering while meeting that condition.
- **Why two oracles?** They use independent feasibility and search logic, reducing the chance of a shared implementation error.
- **Does higher utilization imply higher profit?** No. The objective weights value, not occupied minutes or number served.
- **Why is the flexible-window version excluded?** Choosing start times within release/deadline windows changes the problem; even single-machine feasibility is strongly NP-complete in general.
- **Is this a live EV controller?** No. It is an offline fixed-slot allocation and analysis application with synthetic inputs.
