# Volt — EV Charging Station Slot Profit Maximization

A Design and Analysis of Algorithms project. Volt decides which charging requests a station should accept, and which port each car uses, so that the day earns the most profit with no two cars on the same port at the same time.

**Live site: https://ishaans04.github.io/Volt/**

## The real-world problem

With the rise of electric vehicles, public charging stations face overlapping charging requests. Drivers want different charging durations, are willing to pay different surge rates, and have strict deadlines to leave. A station has a limited number of ports, so it cannot serve everyone. It must accept a subset of vehicles that maximizes profit without overlapping port usage.

Volt models each request as a fixed time slot with a profit:

```
profit = energy_kwh × (tariff × surge_multiplier − energy_cost)
```

and solves the resulting problem exactly:

- **One port:** weighted interval scheduling with dynamic programming.
- **k ports:** minimum-cost flow on a time-expanded graph, using Dijkstra's algorithm.
- **Baselines:** four greedy rules (first come first served, highest profit, profit per minute, earliest finish) to show how much the exact methods gain.

On the default day (150 requests, 4 ports) the optimum earns **₹37,625**, **20.3% more** than first come, first served.

## Try it

Open **https://ishaans04.github.io/Volt/**. Nothing to install: the site runs the project's Python algorithms inside your browser, and your station and saved runs stay in your own browser. The first visit takes a few seconds while Python loads; later visits open in about a second.

1. **Landing page** — an electric car drives across the headline and parks at the charger. Toggle *First come, first served* and *Optimal* on the right-hand card: the report's example improves from ₹170 to ₹240.
2. **Overview** — the Delhi NCR network map. Six charging hubs, each with its own ports, demand and surge, show their optimal profit and gain over first come, first served. Pick one and press **Load this hub**.
3. **Port Schedule** — profit, gain, vehicles served and utilization, then the day's plan: every accepted booking is a car parked in a bay spanning its exact slot. Click any car for its details.
4. **Requests** — search, sort, edit or add bookings, or import your own CSV.
5. **Algo Lab** — watch the algorithms work:
   - *Minimum-cost flow*: a loop diagram (time graph → Dijkstra → push one unit → residual update) and one road per Dijkstra route. Bookings taken arc above the road; bookings handed back through reverse arcs dip below it.
   - *Dynamic programming* (**Load report example**): step through each decision, see which bookings fit before it, and compare *take* against *skip* while OPT(j) grows.
   - *Correctness*, *Port sensitivity* and *Runtime* run the real solvers.
6. **Run History** — every optimization is saved; compare any two side by side.

A guided tour opens on the first visit and can be replayed from the **?** button.

## Algorithms and data structures

| Method | Implementation | Data structures | Time |
| --- | --- | --- | --- |
| Single-port optimum | Weighted interval scheduling DP | Sorted finish times, binary-search predecessors, prefix DP array, traceback | O(n log n) |
| Multi-port optimum | Minimum-cost flow, successive shortest paths | Time-expanded residual graph, paired edge arrays, DAG potentials, Dijkstra min-heap | O(k n log n) |
| Greedy baselines | Sorted first-fit admission | Sort keys, exact rational density, minute-occupancy bitsets | O(n log n + nkB) |
| Port assignment | Interval colouring in start order | Availability array, best-fit free port | O(nk) |
| Search oracle | Depth-first branch and bound | Sorted port availability, suffix-profit upper bound | exponential |
| Subset oracle | Exhaustive subset enumeration | Bit masks, sorted overlap events | O(2ⁿ n log n) |

The scheduling library (`evsched.py`) uses only Python's standard library; no external optimizer hides the algorithms. [ALGORITHMS.md](ALGORITHMS.md) covers the recurrence, correctness arguments, complexity, assumptions and a viva guide.

## Results

A full experiment over 40 synthetic days (seeds 40000–40039, 150 requests a day, 4 ports, tariff ₹18/kWh, energy cost ₹9/kWh, maximum surge 2.5):

| Method | Mean daily profit |
| --- | ---: |
| Optimal (minimum-cost flow) | ₹43,193 |
| Highest profit | ₹39,605 |
| Profit per minute | ₹38,951 |
| First come, first served | ₹34,253 |
| Earliest finish | ₹31,783 |

The exact solvers passed **1,850** independent checks: 1,500 against branch and bound, 150 against subset enumeration and 200 full-day DP-versus-flow comparisons. These are measured results from this implementation on synthetic demand; `figs/` holds the generated charts and `results.json` the raw numbers.

## Run locally

Python 3.11 or newer.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python app.py
```

On macOS or Linux use `.venv/bin/python` instead. Open **http://127.0.0.1:8000** (use `--port 8001` if 8000 is busy). The local version runs a FastAPI server with SQLite storage in `data/volt.db`, and adds interactive API documentation at `/docs`.

## How the live site works

GitHub Pages only serves files, so the browser does the computing. A background Web Worker loads [Pyodide](https://pyodide.org) (Python compiled to WebAssembly) and runs the same `evsched.py`, `run_experiments.py` and `volt_service.py` the server uses. Each visitor's station and runs are kept in their browser's IndexedDB. Every push to `main` rebuilds and deploys the site through `.github/workflows/pages.yml`.

Preview the static build:

```powershell
.\.venv\Scripts\python tools/build_pages.py
.\.venv\Scripts\python -m http.server -d _site 8080
```

## Project layout

```text
evsched.py             Request model, demand generator, every algorithm and metric
volt_service.py        Station operations shared by the server and the browser build
app.py                 FastAPI server, validation and SQLite storage for local use
run_experiments.py     Correctness, quality, capacity, surge, demand and timing experiments
make_figs.py           Charts from recorded experiment results
evaluate.py            JSON command-line interface
static/                Landing page, console, styles, scripts, illustration and font
tools/build_pages.py   Builds the GitHub Pages site
tests/                 Algorithm, API, browser-service and UI tests
figs/, results.json    Experiment charts and measurements
```

## Tests and experiments

```powershell
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\python run_experiments.py
.\.venv\Scripts\python make_figs.py
```

146 automated tests run on Ubuntu and Windows with Python 3.11 and 3.14, including a check that the browser build gives the same answers as the server. A separate job drives the console against a running server (`tests/ui_smoke.cjs`). `run_experiments.py --quick` runs a smaller experiment.

## Data formats

Import requests as CSV (download the current requests from the Requests tab for a template):

```csv
request_id,arrival_min,duration_min,energy_kwh,surge_mult
1,480,45,24,1.5
2,500,30,18,2
3,525,45,26,1.8
```

Times are whole minutes after midnight, and every session must finish by midnight (1440). IDs must be unique. Profit is always recomputed from the station's prices. The console accepts up to 2,000 requests, 32 ports and 1 MB files.

`evaluate.py` reads the same requests as JSON, with `settings` (`ports`, `tariff`, `energy_cost`) and an optional `algorithm`, and prints the result as JSON:

```powershell
.\.venv\Scripts\python evaluate.py examples/requests.json
```

## Scope

The objective is total net profit, not the number of drivers served or fairness. Requests are fixed half-open intervals known in advance, ports are identical, and surge rates are given inputs. Flexible windows, online arrivals, connector types, shared power limits and payments are outside this project. Demand and prices are synthetic, so results describe the model, not a real station.

The Inter font is used under the [SIL Open Font License](static/FONT-LICENSE.txt).
