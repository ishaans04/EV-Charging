const demo = {
  optimal: {
    profit: 240,
    gain: "+41.2% profit",
    sessions: [
      [20, 40, "R1"],
      [40, 80, "R5"],
      [80, 130, "R4"],
    ],
    caption: "Three sessions. Zero overlaps. Maximum value.",
  },
  fcfs: {
    profit: 170,
    gain: "Baseline",
    sessions: [
      [0, 60, "R7"],
      [80, 130, "R4"],
    ],
    caption: "Two sessions. An early arrival blocks better choices.",
  },
};
document.querySelectorAll("[data-demo]").forEach((button) =>
  button.addEventListener("click", () => {
    const selected = demo[button.dataset.demo];
    document.querySelectorAll("[data-demo]").forEach((item) => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    document.querySelector("#demo-profit").textContent = `₹${selected.profit}`;
    document.querySelector("#demo-gain").textContent = selected.gain;
    document.querySelector("#demo-caption").textContent = selected.caption;
    document.querySelector("#demo-timeline").innerHTML = selected.sessions
      .map(
        ([start, end, id]) =>
          `<i style="left:${(start / 130) * 100}%;width:${((end - start) / 130) * 100}%">${id}</i>`,
      )
      .join("");
    document
      .querySelector("#demo-timeline")
      .setAttribute("aria-label", `${button.textContent.trim()} schedule`);
  }),
);
document.addEventListener("keydown", (event) => {
  if (
    event.key.toLowerCase() === "v" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  )
    window.location.assign("/console");
});
