import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch
import numpy as np

from evsched import compare, generate_requests, worked_example


BLUE, GOLD, PURPLE, GREEN, GREY = "#2b58bf", "#d5ae43", "#8a7aae", "#448f77", "#9aabc5"
COLORS = [BLUE, GREY, GOLD, PURPLE, GREEN]


def render(results, destination):
    destination.mkdir(parents=True, exist_ok=True)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "axes.titleweight": "medium", "figure.facecolor": "white",
                         "axes.labelcolor": "#334565", "text.color": "#243858",
                         "xtick.color": "#596c87", "ytick.color": "#596c87"})

    def save(fig, name):
        fig.savefig(destination / name, dpi=170, bbox_inches="tight")
        plt.close(fig)

    requests = [r for seed in results["config"]["seeds"] for r in generate_requests(150, seed)]
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6), layout="constrained")
    hours = np.arange(6, 24)
    counts = [sum(h * 60 <= r.arrival_min < (h + 1) * 60 for r in requests) / results["config"]["days"] for h in hours]
    surges = [np.mean([r.surge_mult for r in requests if h * 60 <= r.arrival_min < (h + 1) * 60]) for h in hours]
    axes[0].bar(hours, counts, color=BLUE, width=.75)
    axes[0].set(xlabel="Start hour", ylabel="Mean requests per day", title="Synthetic demand has two peaks")
    axes[1].plot(hours, surges, color=GOLD, marker="o", markersize=4)
    axes[1].set(xlabel="Start hour", ylabel="Mean accepted surge input", title="Willingness to pay by booking hour")
    save(fig, "demand.png")

    fig, axes = plt.subplots(1, 3, figsize=(12, 3.3), layout="constrained")
    for ax, values, label, color in zip(axes, ([r.duration_min for r in requests], [r.energy_kwh for r in requests], [r.surge_mult for r in requests]), ("Duration / minutes", "Requested energy / kWh", "Surge multiplier"), (BLUE, GOLD, PURPLE)):
        ax.hist(values, bins=22, color=color, edgecolor="white", linewidth=.5)
        ax.set(xlabel=label, ylabel="Requests")
    fig.suptitle("Assumed demand distributions")
    save(fig, "distributions.png")

    example = compare(worked_example(), 1)
    fig, ax = plt.subplots(figsize=(11, 4), layout="constrained")
    for row, result in enumerate(example):
        for r in result["schedule"]:
            ax.barh(row, r["duration_min"], left=r["arrival_min"], height=.55, color=COLORS[row], edgecolor="white")
            ax.text(r["arrival_min"] + r["duration_min"] / 2, row, f"R{r['request_id']}", ha="center", va="center", color="white", fontsize=9)
    ax.set(yticks=range(5), yticklabels=[f"{r['name']}  |  INR {r['profit_inr']}" for r in example], xlabel="Minutes from start of example", title="Report example: a local rule can miss the best combination")
    ax.invert_yaxis()
    save(fig, "greedy_example.png")

    times = [0, 20, 40, 60, 80, 100, 120]
    fig, ax = plt.subplots(figsize=(11, 3.6), layout="constrained")
    for i, t in enumerate(times):
        ax.scatter(i, 0, s=210, color=BLUE, zorder=3)
        ax.text(i, -.24, str(t), ha="center", fontsize=10)
        if i:
            ax.annotate("", (i - .1, 0), (i - .9, 0), arrowprops={"arrowstyle": "->", "color": GREY, "lw": 1.6})
    arcs = [(0, 2, 90), (1, 4, 130), (2, 3, 60), (3, 5, 100), (4, 6, 80)]
    for i, (a, b, p) in enumerate(arcs):
        radius = -.45 - .18 * (i % 2)
        ax.add_patch(FancyArrowPatch((a, .08), (b, .08), connectionstyle=f"arc3,rad={radius}", arrowstyle="->", mutation_scale=12, color=GOLD, lw=1.7))
        ax.text((a + b) / 2, .55 + .22 * (i % 2), f"cap 1, cost -{p}", ha="center", fontsize=8, color="#947421")
    ax.text(3, -.58, "Idle arcs: capacity k, cost 0. Send k units from first to last time node.", ha="center", fontsize=10)
    ax.set(xlim=(-.4, 6.4), ylim=(-.8, 1.4), title="Time-expanded minimum-cost flow network · illustrative intervals")
    ax.axis("off")
    save(fig, "flow_network.png")

    quality = results["quality"]
    fig, ax = plt.subplots(figsize=(9, 4.8), layout="constrained")
    ax.bar(range(5), [r["mean_profit"] for r in quality], yerr=[r["sd_profit"] for r in quality], color=COLORS, capsize=4)
    ax.set(xticks=range(5), xticklabels=["Optimal", "FCFS", "Profit", "Density", "Earliest finish"], ylabel="Daily profit / INR", title=f"Four ports · 150 requests · {results['config']['days']} simulated days")
    ax.text(.99, .97, "Error bars: one standard deviation", transform=ax.transAxes, ha="right", va="top", fontsize=9, color="#6d7e95")
    save(fig, "profit_comparison.png")

    fig, axes = plt.subplots(1, 2, figsize=(11, 4), layout="constrained")
    capacity = results["capacity"]
    for method in range(1, 5):
        axes[0].plot([r["ports"] for r in capacity], [r["methods"][method]["mean_profit"] / r["methods"][0]["mean_profit"] * 100 for r in capacity], marker="o", markersize=4, color=COLORS[method], label=quality[method]["name"])
    axes[0].set(xlabel="Charging ports", ylabel="Percent of optimal profit", title="Capacity reduces the cost of a greedy rule")
    axes[0].legend(fontsize=8)
    optimal = [r["methods"][0]["mean_profit"] for r in capacity]
    axes[1].bar(range(2, 9), np.diff(optimal), color=BLUE)
    axes[1].set(xlabel="Port added", ylabel="Additional mean profit / INR", title="The value of another port")
    save(fig, "capacity.png")

    fig, axes = plt.subplots(1, 2, figsize=(11, 4), layout="constrained")
    for ax, data, key, label in ((axes[0], results["surge"], "max_surge", "Maximum surge multiplier"), (axes[1], results["demand"], "n", "Requests per day")):
        gains = [(r["methods"][0]["mean_profit"] / r["methods"][1]["mean_profit"] - 1) * 100 for r in data]
        ax.plot([r[key] for r in data], gains, marker="o", color=BLUE)
        ax.set(xlabel=label, ylabel="Gain over FCFS / %")
    fig.suptitle("How demand and willingness to pay change the value of optimization")
    save(fig, "sensitivity.png")

    fig, axes = plt.subplots(1, 2, figsize=(11, 4), layout="constrained")
    for key, label, color in (("dp", "DP · 1 port", BLUE), ("flow", "Flow · 4 ports", PURPLE), ("fcfs", "FCFS · 4 ports", GOLD)):
        axes[0].loglog([r["n"] for r in results["timing_ms"]], [r[key] for r in results["timing_ms"]], marker="o", label=label, color=color)
    axes[0].set(xlabel="Requests", ylabel="Solver time / ms", title="Polynomial solvers · best of three")
    axes[0].legend(fontsize=8)
    axes[1].semilogy([r["n"] for r in results["brute_timing_ms"]], [r["subsets"] for r in results["brute_timing_ms"]], marker="o", color=GOLD)
    axes[1].set(xlabel="Requests", ylabel="Subset oracle time / ms", title="Exhaustive subsets · one run")
    save(fig, "runtime.png")

    case = results["case_study"]
    fig, axes = plt.subplots(2, 1, figsize=(12, 5.6), layout="constrained", sharex=True)
    for ax, result in zip(axes, (case["methods"][1], case["methods"][0])):
        for r in result["schedule"]:
            color = GOLD if r["surge_mult"] >= 2 else PURPLE if r["surge_mult"] >= 1.65 else BLUE
            ax.barh(r["port"], r["duration_min"] / 60, left=r["arrival_min"] / 60, height=.65, color=color, edgecolor="white", linewidth=.5)
        ax.axvspan(8, 11, color=GOLD, alpha=.08)
        ax.axvspan(17, 21, color=GOLD, alpha=.08)
        ax.set(yticks=range(1, 5), ylabel="Port", title=f"{result['name']} · INR {result['profit_inr']:,} · {result['accepted']} sessions", xlim=(6, 24))
    axes[1].set(xlabel="Hour of day", xticks=range(6, 25, 2))
    fig.suptitle("One synthetic day · 120 requests · seed 2026")
    save(fig, "case_schedule.png")

    fig, ax = plt.subplots(figsize=(11, 3.8), layout="constrained")
    for offset, method, color in ((-.2, case["methods"][1], GREY), (.2, case["methods"][0], BLUE)):
        values = [sum(r["profit_inr"] for r in method["schedule"] if h * 60 <= r["arrival_min"] < (h + 1) * 60) for h in hours]
        ax.bar(hours + offset, values, width=.4, color=color, label=method["name"])
    ax.set(xlabel="Session start hour", ylabel="Scheduled profit / INR", title="Where the optimal schedule earns more")
    ax.legend(fontsize=9)
    save(fig, "case_hourly_profit.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Render reproducible figures from Volt results")
    parser.add_argument("--input", type=Path, default=Path("results.json"))
    parser.add_argument("--output", type=Path, default=Path("figs"))
    args = parser.parse_args()
    render(json.loads(args.input.read_text(encoding="utf-8")), args.output)
    print(f"Saved figures to {args.output}")
