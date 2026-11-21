# Volt

EV charging station slot profit maximization, built in Python for Design and Analysis of Algorithms. Volt chooses which fixed bookings to accept and assigns them to identical charging ports without overlaps.

A blue-and-gold landing page leads directly into the station console. The console includes an interactive schedule, request editing and CSV import, greedy comparisons, algorithm traces, correctness checks, sensitivity analysis, timing benchmarks, and locally saved runs. The visual direction follows [Pageloop](https://www.pageloop.ai/); Volt uses its own branding and charging illustration.

## Run

Python 3.11 or newer is required. The app was verified on Python 3.14.5.

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python app.py
```

macOS or Linux:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

Open **http://127.0.0.1:8000**. Use `python app.py --port 8001` if port 8000 is occupied. Run commands through the virtual environment's Python, or activate it first.

The first console visit generates 150 synthetic requests with seed 2026 and solves the four-port day. Subsequent visits restore the most recent run matching the current demand. No Node build, account, API key, cloud service, or GPU is needed. All fonts and artwork are served locally.

## A three-minute demonstration

1. Toggle FCFS and Optimal on the landing page: the report's example improves from ₹170 to ₹240.
2. Enter the console. Inspect scheduled profit, gain over FCFS, vehicles served, and 24-hour port utilization. Select any timeline session to inspect its exact slot and port.
3. Open **Algorithm lab → Load report example**. The one-port DP table reproduces Appendix A: R1, R5 and R4 earn ₹240. The local-choice and final-traceback columns explain why a temporary DP choice can be absent from the final answer.
4. Change to two ports and optimize. The lab now shows minimum-cost flow: time nodes, forward arcs, augmentations, residual reverse arcs and profit changes.
5. Run **Correctness**, **Port sensitivity**, and **Runtime** in the lab. These execute Python algorithms; the UI does not fabricate results.
6. Edit a request or import a CSV. Existing output is invalidated until the station is optimized again. Run history retains the original inputs and results of the last 30 runs.

The console uses a horizontal top navigation with Overview, Port Schedule, Requests, Algo Lab and Run History. A twelve-step guided tour opens on the first console visit and can be replayed from the ? button; it spotlights the map, hub loading, the schedule, requests, the lab and run history. Station settings are available from the controls button at the top right. Price changes recompute every request's profit.

Overview holds the Delhi NCR network map: six synthetic charging hubs, each with its own ports, demand and surge ceiling. Every hub shows its optimal profit, gain over FCFS and utilization, computed by the same Python solvers; select a hub and load it to replace the current demand, optimize, and jump to Port Schedule. Port Schedule shows the profit, gain, vehicles served and utilization cards and draws each accepted session as a small car parked in a bay that spans its exact slot. Plan setup and algorithm comparisons sit behind expandable controls, with a port-focus selector on the schedule. Requests use ten-row pages, status filters and sorting, with edit and import tools. The DP explorer steps through one decision at a time; the full table and flow paths expand on demand. Run History supports filtering, sorting, and comparing two saved runs side by side. CSV exports follow the displayed schedule, and full run JSON is available in the lab.

## Algorithms and data structures

| Method | Implementation | Data structures |
| --- | --- | --- |
| Single-port optimum | Weighted interval scheduling DP | Sorted finish times, binary-search predecessors, prefix DP array, traceback |
| Multi-port optimum | Minimum-cost flow with successive shortest paths | Time-expanded residual graph, paired edge arrays, DAG potentials, Dijkstra min-heap |
| FCFS, highest profit, profit density, earliest finish | Sorted first-fit admission | Sort keys, exact rational density, minute occupancy bitsets |
| Physical port assignment | Interval coloring in start order | Availability array and best-fit free-port selection |
| Search oracle | Depth-first branch and bound | Sorted port availability, suffix-profit upper bound |
| Subset oracle | Exhaustive subset enumeration | Bit masks and independently sorted overlap events |

Read [ALGORITHMS.md](ALGORITHMS.md) for recurrence, correctness arguments, complexity, assumptions, and a viva guide. The scheduling library uses only Python's standard library; there is no external optimizer hiding the DSA implementation.

## Simple project layout

```text
app.py                 FastAPI routes, validation, SQLite persistence, local server
evsched.py             Request model, generator, all algorithms and metrics
evaluate.py            JSON command-line interface for external evaluation
run_experiments.py     Correctness, quality, capacity, surge, demand and timing
make_figs.py           Matplotlib figures from recorded experiment results
static/                Two HTML pages, CSS, JavaScript, illustration and local font
tests/                 Algorithm, API and UI integration tests
results.json           Actual full-run measurements and the one-day case study
figs/                  Ten regenerated experiment figures
```

`data/volt.db` is created automatically and ignored by Git. Set `VOLT_DATA_DIR` to use a different local data directory. Mutations use revision checks so another tab cannot silently overwrite newer input. Saved runs hold immutable snapshots. The server binds to loopback and accepts localhost hosts; this is a local academic application, without multi-user authentication.

## Verify and reproduce

Install the development dependencies in the same virtual environment:

```powershell
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\python run_experiments.py
.\.venv\Scripts\python make_figs.py
```

Use `--quick` for a smaller experiment run and `--output artifacts/quick-results.json` to preserve the committed full results. Figure input and output paths are configurable with `make_figs.py --input ... --output ...`.

The automated Python suite passes **141 tests** across Ubuntu and Windows on Python 3.11 and 3.14. A separate GitHub Actions job checks the console interactions against an isolated running API, including port focus, sorting, the DP explorer and saved-run comparison.

The committed full experiment used 40 days, seeds 40000–40039, 150 requests/day, four ports, tariff ₹18/kWh, energy cost ₹9/kWh, and maximum surge 2.5. It passed **1,850** exact-solver checks: 1,500 against branch and bound, 150 against subset enumeration, and 200 full-day DP-versus-flow comparisons.

| Method | Measured mean daily profit |
| --- | ---: |
| Optimal flow | ₹43,193 |
| FCFS | ₹34,253 |
| Highest profit | ₹39,605 |
| Profit density | ₹38,951 |
| Earliest finish | ₹31,783 |

These are actual synthetic results from this implementation, not copied report measurements. The generator uses Python's seeded `random.Random`; it does not promise bit-for-bit agreement with the report's original generator. Timings depend on hardware and background load. Solver timing includes sorting, graph construction and traceback; it excludes assignment, validation, HTTP, and UI work.

An optional DOM integration test exercises the actual running API without a browser. Start the server with an isolated data directory because this test changes its dataset:

```powershell
$env:VOLT_DATA_DIR = "$PWD\.qa\station"
.\.venv\Scripts\python app.py
```

In another terminal:

```powershell
npm install --prefix .qa --no-audit --no-fund jsdom
node tests/ui_smoke.cjs
```

The DOM test verifies application behavior, not rendered appearance. Live browser visual QA was blocked by the computer-use service during implementation. Responsive breakpoints, reduced-motion rules, keyboard-operable dialogs and session controls are implemented, but pixel-level rendering remains unverified. The console uses static SVG, gradients and brief interaction transitions; it has no WebGL, canvas animation, continuous animation loops or backdrop filters.

To let the test start and stop its own isolated server:

```powershell
$env:VOLT_TEST_START_SERVER = "1"
$env:VOLT_PYTHON = "$PWD\.venv\Scripts\python.exe"
$env:VOLT_TEST_URL = "http://127.0.0.1:8002"
node tests/ui_smoke.cjs
```

## CSV and JSON evaluation

Download the current request CSV from Requests to get the import format. Required columns:

```csv
request_id,arrival_min,duration_min,energy_kwh,surge_mult
1,480,45,24,1.5
2,500,30,18,2
3,525,45,26,1.8
```

Times are integer minutes since midnight; start + duration must be at most 1440. IDs must be unique. An optional `deadline_min` must equal start + duration. Imported `profit_inr` is ignored and recomputed. The console accepts up to 2,000 requests, 32 ports and 1 MB CSV files. The algorithm library supports larger experiments independently.

`evaluate.py` reads a JSON file, or one JSON object from stdin, and emits JSON to stdout. It accepts `requests` in the CSV schema, `settings` containing `ports`, `tariff`, and `energy_cost`, and an optional `algorithm`. Without `algorithm` it compares the optimum and all four greedy methods. Invalid inputs produce a nonzero exit code and a JSON error on stderr.

```powershell
.\.venv\Scripts\python evaluate.py examples/requests.json
```

This provides a dependency-free adapter for an external evaluation harness. **AEGIS-specific execution is not claimed**: the supplied report and repository do not identify an AEGIS distribution, configuration, or interface. The pure Python functions and JSON CLI expose the inputs and outputs needed for a course-specific wrapper.

Interactive API documentation is at `/docs`. Main routes: `GET /api/state`, `GET /api/hubs`, `PUT /api/state`, `POST /api/generate`, `POST /api/import?revision=...`, `POST /api/optimize`, `GET /api/runs`, and `GET /api/runs/{id}/export?format=json`.

## Model boundary

The objective is total net profit, not number of drivers served or fairness. Requests are rigid half-open intervals, all are known in advance, ports are identical, and surge rates are supplied inputs. Flexible windows, online decisions, connector compatibility, shared power limits, live payments and hardware control are outside this project. This optimum applies only to the stated model. Synthetic demand and assumed prices do not establish performance at a real charging station.

Inter is distributed under its [SIL Open Font License](static/FONT-LICENSE.txt). The charging illustration and application code are project assets. The attached report was used as the requirements source and was not modified or uploaded.
