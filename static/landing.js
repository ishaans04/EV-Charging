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

// ---------------------------------------------------------------------------
// Landing intro. An EV drives across the headline and unveils it line by
// line, U-turns, then parks at the Volt charger and charges. Every moving
// part is a transform, opacity or clip-path animation, and nothing keeps
// running once the car is charged. Any click, key or scroll skips to the end.
// ---------------------------------------------------------------------------
const intro = (() => {
  const page = document.body;
  const lines = [
    document.querySelector("#hero-line-1"),
    document.querySelector("#hero-line-2"),
  ];
  const charger = document.querySelector(".charger-art");
  if (!lines[0] || !lines[1] || !charger) return null;
  const reduce = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const canAnimate = typeof page.animate === "function";
  const svgNS = "http://www.w3.org/2000/svg";

  const car = document.createElement("button");
  car.type = "button";
  car.className = "intro-car";
  car.setAttribute("aria-label", "Replay the charging animation");
  car.title = "Replay the drive";
  car.innerHTML =
    '<svg viewBox="0 0 160 56" aria-hidden="true"><defs><linearGradient id="ev-body" x2="0" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#eef2fa"/><stop offset="1" stop-color="#c3d0e7"/></linearGradient><linearGradient id="ev-glass" x2="1" y2="1"><stop stop-color="#34569b"/><stop offset="1" stop-color="#122858"/></linearGradient><linearGradient id="ev-beam"><stop stop-color="#fff6c8" stop-opacity=".85"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></linearGradient></defs>' +
    '<ellipse cx="80" cy="53" rx="72" ry="4" fill="#0d1f4d" opacity=".22"/><path class="beam" d="m153 32 46-9v24z" fill="url(#ev-beam)"/>' +
    '<path d="M10 41c-1-6 2-9 10-10.5L40 27c12-11 24-16 42-16 17 0 28 4 39 13l20 3.5c9 1.5 13 4.5 13 9.5v4c0 3-2 4-5 4H14c-3 0-4-1-4-4z" fill="url(#ev-body)" stroke="#b7c5de" stroke-width=".8"/>' +
    '<path d="M46 27c10-9 20-12.5 36-12.5 13 0 22 3 31 10.5z" fill="url(#ev-glass)"/><path d="M82 14.5v12" stroke="#eef2fa" stroke-width="2.2"/>' +
    '<path d="M22 33.5h125" stroke="#e3bc51" stroke-width="1.6"/><path d="M84 28v15M50 29v14" stroke="#c3cee2" stroke-width=".8"/>' +
    '<path d="m146 30.5 7 2.5-1 2-8-1.5z" fill="#fff6c8"/><path d="m11 33 9-1.2v2.7L11 36z" fill="#e5767a"/><circle class="charge-port" cx="136" cy="37" r="2.2"/>' +
    '<circle cx="36" cy="45" r="11" fill="#1b2b52"/><circle cx="124" cy="45" r="11" fill="#1b2b52"/>' +
    [36, 124]
      .map(
        (cx) =>
          `<g class="wheel"><circle cx="${cx}" cy="45" r="9.5" fill="#142650"/><circle cx="${cx}" cy="45" r="6" fill="#c9d6ec"/><path d="M${cx} 39.5v11M${cx - 5.5} 45h11" stroke="#7f95bb" stroke-width="1.8"/><circle cx="${cx}" cy="45" r="2" fill="#142650"/></g>`,
      )
      .join("") +
    '</svg><span class="charge-hud" aria-hidden="true"><b>⚡</b><span class="charge-text">Charging 0%</span><span class="charge-meter"><i></i></span></span>';
  page.append(car);
  const hudText = car.querySelector(".charge-text");
  const meter = car.querySelector(".charge-meter i");

  const cable = document.createElementNS(svgNS, "svg");
  cable.setAttribute("class", "intro-cable");
  cable.setAttribute("width", "1");
  cable.setAttribute("height", "1");
  cable.setAttribute("aria-hidden", "true");
  const wire = document.createElementNS(svgNS, "path");
  cable.append(wire);

  let running = [];
  let chargeFrame = 0;
  let state = "idle";

  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      right: rect.right + window.scrollX,
      width: rect.width,
      height: rect.height,
    };
  };
  // A pose is the car's left/top in page pixels, its scale, and its facing:
  // 1 drives right, -1 drives left, values near 0 show it mid-turn.
  const pose = ({ x, y, s, d }) =>
    `translate(${(x + (160 * s * (1 - d)) / 2).toFixed(1)}px, ${y.toFixed(1)}px) scale(${(d * s).toFixed(3)}, ${s.toFixed(3)})`;

  // Parking spot in front of the charger, mapped from its 440 x 430 viewBox.
  function parking() {
    const art = box(charger);
    const k = Math.min(art.width / 440, art.height / 430) || 1;
    const ox = art.left + (art.width - 440 * k) / 2;
    const oy = art.top + (art.height - 430 * k) / 2;
    const s = (196 * k) / 160;
    const x = ox + 16 * k;
    const y = oy + 386 * k - 54.5 * s;
    return {
      x,
      y,
      s,
      d: 1,
      k,
      plug: { x: ox + 143 * k, y: oy + 244 * k },
      port: { x: x + 136 * s, y: y + 37 * s },
    };
  }

  function layCable(park) {
    const { plug, port, k } = park;
    const sag = Math.max(plug.y, port.y) + 36 * k;
    wire.setAttribute(
      "d",
      `M${plug.x.toFixed(1)} ${plug.y.toFixed(1)}Q${((plug.x + port.x) / 2).toFixed(1)} ${sag.toFixed(1)} ${port.x.toFixed(1)} ${port.y.toFixed(1)}`,
    );
    wire.style.strokeWidth = `${Math.max(3, 9 * k)}`;
    if (!cable.isConnected) page.append(cable);
  }

  function setCharge(value) {
    meter.style.setProperty("--charge", value.toFixed(3));
    hudText.textContent =
      value >= 1 ? "100% · Charged" : `Charging ${Math.round(value * 100)}%`;
  }

  const skipEvents = ["pointerdown", "keydown", "wheel", "touchstart"];
  function skip(event) {
    if (event.target?.closest?.(".intro-car")) return;
    if (state === "driving" || state === "charging") settle();
  }
  function listen() {
    skipEvents.forEach((type) =>
      window.addEventListener(type, skip, { passive: true }),
    );
  }
  function stopListening() {
    skipEvents.forEach((type) => window.removeEventListener(type, skip));
  }

  function stopAll() {
    for (const animation of running) animation.cancel();
    running = [];
    cancelAnimationFrame(chargeFrame);
  }

  // Final scene: headline shown, car parked, cable connected, fully charged.
  function settle() {
    stopAll();
    page.classList.add("intro-done");
    const park = parking();
    car.style.transform = pose(park);
    car.classList.remove("driving", "charging");
    car.classList.add("charged");
    charger.classList.add("charging");
    layCable(park);
    wire.style.strokeDasharray = "";
    setCharge(1);
    state = "parked";
    stopListening();
  }

  function charge() {
    state = "charging";
    car.classList.remove("driving");
    car.classList.add("charging");
    charger.classList.add("charging");
    layCable(parking());
    const length = wire.getTotalLength?.() || 0;
    if (length) {
      wire.style.strokeDasharray = `${length}`;
      running.push(
        wire.animate(
          [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
          { duration: 450, easing: "ease-out", fill: "both" },
        ),
      );
    }
    const start = performance.now() + 450;
    const step = (now) => {
      const value = Math.min(1, Math.max(0, (now - start) / 1700));
      setCharge(1 - (1 - value) ** 2);
      if (value < 1) chargeFrame = requestAnimationFrame(step);
      else settle();
    };
    chargeFrame = requestAnimationFrame(step);
  }

  function play() {
    stopAll();
    if (reduce || !canAnimate) return settle();
    page.classList.remove("intro-done");
    charger.classList.remove("charging");
    car.classList.remove("charging", "charged");
    cable.remove();
    setCharge(0);
    const lineHeight =
      parseFloat(getComputedStyle(lines[0].parentElement).lineHeight) || 70;
    const [one, two] = lines.map(box);
    const park = parking();
    const wrapped =
      one.height > lineHeight * 1.4 ||
      two.height > lineHeight * 1.4 ||
      window.innerWidth < 700;
    const s = Math.min(
      1.35,
      Math.max(0.55, (Math.min(one.height, lineHeight) * 0.78) / 56),
    );
    const speed = Math.max(0.75, Math.min(1.25, window.innerWidth / 1400)); // px per ms
    const frames = [];
    const at = (time, where, easing = "linear") =>
      frames.push({ time, transform: pose(where), easing });
    const clip = (line, from, delay, duration) =>
      running.push(
        line.animate(
          [{ clipPath: from }, { clipPath: "inset(-25% -6% -35% -6%)" }],
          { delay, duration, easing: "linear", fill: "both" },
        ),
      );
    const fromLeft = "inset(-25% 100% -35% -6%)";
    const fromRight = "inset(-25% -6% -35% 100%)";
    let time = 250;
    let reveal;
    if (wrapped) {
      // Narrow screens: lines slide open, the car drives straight to the pump.
      clip(lines[0], fromLeft, 150, 700);
      clip(lines[1], fromRight, 650, 700);
      reveal = 1350;
      const start = { x: -180 * park.s - 40, y: park.y, s: park.s, d: 1 };
      at(0, start);
      time = reveal - 250;
      at(time, start, "cubic-bezier(.25,.7,.3,1)");
      time += Math.max(1000, (park.x - start.x) / speed);
    } else {
      const y1 = one.top + one.height * 0.52 - 28 * s;
      const y2 = two.top + two.height * 0.52 - 28 * s;
      const a = { x: one.left - 160 * s - 40, y: y1, s, d: 1 };
      const b = { x: one.right + 8, y: y1, s, d: 1 };
      at(0, a);
      at(time, a);
      // Line one opens just behind the car's windscreen as it drives right.
      const edgeStart = (one.left - (a.x + 160 * s * 0.65)) / speed;
      clip(lines[0], fromLeft, time + edgeStart, one.width / speed);
      time += (b.x - a.x) / speed;
      at(time, b, "cubic-bezier(.4,0,.6,1)");
      const turn = {
        x: Math.max(one.right, two.right) + 30,
        y: (y1 + y2) / 2,
        s,
        d: 0.06,
      };
      time += 330;
      at(time, turn, "cubic-bezier(.4,0,.6,1)");
      const c = { x: two.right - 56 * s, y: y2, s, d: -1 };
      time += 330;
      at(time, c);
      // Line two opens from the right as the car heads back left.
      const d = { x: two.left - 160 * s - 40, y: y2, s, d: -1 };
      clip(lines[1], fromRight, time, two.width / speed);
      time += (c.x - d.x) / speed;
      at(time, d, "cubic-bezier(.45,0,.55,1)");
      reveal = time;
      const swing = {
        x: d.x - 70,
        y: (y2 + park.y) / 2,
        s: (s + park.s) / 2,
        d: 0.04,
      };
      time += 520;
      at(time, swing, "cubic-bezier(.45,0,.55,1)");
      const approach = {
        x: park.x - 170 * park.s,
        y: park.y,
        s: park.s,
        d: 1,
      };
      time += 640;
      at(time, approach, "cubic-bezier(.2,.6,.35,1)");
      time += 620;
    }
    at(time, park);
    const total = time;
    running.push(
      car.animate(
        frames.map((frame) => ({
          transform: frame.transform,
          offset: frame.time / total,
          easing: frame.easing,
        })),
        { duration: total, fill: "both" },
      ),
    );
    car.style.transform = pose(park);
    car.classList.add("driving");
    state = "driving";
    listen();
    const shown = window.setTimeout(
      () => page.classList.add("intro-done"),
      reveal,
    );
    const parked = window.setTimeout(() => {
      if (state === "driving") charge();
    }, total);
    // Follow the car down if its parking spot is below the visible page,
    // unless the visitor has already scrolled.
    const startScroll = window.scrollY;
    const follow = window.setTimeout(() => {
      const bottom = park.y + 70 * park.s;
      if (window.scrollY === startScroll && bottom > startScroll + window.innerHeight)
        window.scrollTo({
          top: bottom + 24 - window.innerHeight,
          behavior: "smooth",
        });
    }, reveal);
    running.push(
      { cancel: () => clearTimeout(shown) },
      { cancel: () => clearTimeout(parked) },
      { cancel: () => clearTimeout(follow) },
    );
  }

  car.addEventListener("click", () => {
    if (state === "driving" || state === "charging") return settle();
    window.scrollTo({ top: 0, behavior: "auto" });
    play();
  });
  let resizeFrame = 0;
  window.addEventListener(
    "resize",
    () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (state !== "idle") settle();
      });
    },
    { passive: true },
  );
  return { play, settle };
})();

const startIntro = () => intro?.play();
if (document.fonts?.ready) document.fonts.ready.then(startIntro, startIntro);
else startIntro();

// Floating cards lean gently towards a mouse pointer.
if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  document.querySelectorAll(".floating-card").forEach((card) => {
    let frame = 0;
    let pointer = null;
    card.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      pointer = event;
      card.classList.add("tilting");
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = card.getBoundingClientRect();
        const dx = (pointer.clientX - rect.left) / rect.width - 0.5;
        const dy = (pointer.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty("--ry", `${(dx * 10).toFixed(2)}deg`);
        card.style.setProperty("--rx", `${(-dy * 8).toFixed(2)}deg`);
      });
    });
    card.addEventListener("pointerleave", () => {
      cancelAnimationFrame(frame);
      frame = 0;
      card.classList.remove("tilting");
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  });
