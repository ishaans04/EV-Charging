const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
const integer = (value) => new Intl.NumberFormat("en-IN").format(value);
const time = (minute) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const labels = {
  dp: "Dynamic programming",
  flow: "Minimum-cost flow",
  fcfs: "First come, first served",
  profit: "Highest profit",
  density: "Profit per minute",
  eft: "Earliest finish",
  search: "Branch and bound",
  subsets: "Subset enumeration",
};
let station = null;
let activeRun = null;
let shownMethod = null;
let currentView = "overview";
let page = 0;
let busy = false;
let toastTimer;
let labRevision = null;
let timelinePort = "all";
let savedRuns = [];
const comparedRuns = new Set();
let hubs = [];
let hubKey = null;
let selectedHub = null;
let confirmingHub = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = data.detail || `Request failed (${response.status})`;
    if (Array.isArray(message))
      message = message
        .map((item) => `${item.loc.slice(1).join(".")}: ${item.msg}`)
        .join("; ");
    if (response.status === 409)
      message += " Refresh the page to load the latest state.";
    throw new Error(message);
  }
  return data;
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.remove("hidden");
  $("#toast").classList.toggle("error", error);
  toastTimer = setTimeout(
    () => $("#toast").classList.add("hidden"),
    error ? 9000 : 4200,
  );
}

async function action(button, task) {
  if (busy) return;
  busy = true;
  const markup = button?.innerHTML;
  const controls = $$("button,input,select");
  const disabledBefore = controls.map((control) => control.disabled);
  controls.forEach((control) => {
    control.disabled = true;
  });
  if (button) button.textContent = "Working…";
  document.body.setAttribute("aria-busy", "true");
  try {
    await task();
  } catch (error) {
    const dialog = $$("dialog[open]").find((item) =>
      item.querySelector(".form-error"),
    );
    if (dialog) dialog.querySelector(".form-error").textContent = error.message;
    else notify(error.message, true);
  } finally {
    controls.forEach((control, i) => {
      control.disabled = disabledBefore[i];
    });
    if (button) button.innerHTML = markup;
    busy = false;
    document.body.removeAttribute("aria-busy");
    if (station) renderStation();
  }
}

function selectedResult() {
  if (!activeRun) return null;
  if (shownMethod === activeRun.selected.algorithm) return activeRun.selected;
  return (
    activeRun.comparison.find((result) => result.algorithm === shownMethod) ||
    activeRun.selected
  );
}

function currentResult() {
  return activeRun && station && activeRun.revision === station.revision
    ? selectedResult()
    : null;
}

function setView(view, focus = false) {
  currentView = view;
  $(".heading-actions").classList.toggle(
    "hidden",
    ["requests", "history"].includes(view),
  );
  $("#planning-controls").classList.toggle(
    "hidden",
    ["requests", "history"].includes(view),
  );
  $("#open-generate").classList.toggle("hidden", view === "lab");
  const metadata = {
    overview: [
      "YOUR NETWORK, AT A GLANCE",
      "Your charging network.",
      "Pick a hub on the map, load it, and watch the optimizer plan its day.",
      "Overview",
    ],
    schedule: [
      "YOUR STATION, PORT BY PORT",
      "Your charging day.",
      "Inspect each port, open any car for its booking, and compare the results.",
      "Port schedule",
    ],
    requests: [
      "THE DEMAND BEHIND YOUR DAY",
      "Charging requests.",
      "Review and adjust your station’s bookings.",
      "Requests",
    ],
    lab: [
      "DESIGN & ANALYSIS OF ALGORITHMS",
      "Explore the algorithms.",
      "Follow one decision at a time.",
      "Algorithm lab",
    ],
    history: [
      "YOUR PREVIOUS DECISIONS",
      "Your saved runs.",
      "Inspect a saved schedule or compare two runs.",
      "Run history",
    ],
  };
  $$(".view-panel").forEach((panel) =>
    panel.classList.toggle("hidden", panel.id !== `view-${view}`),
  );
  $$(".console-nav button").forEach((button) => {
    const selected = button.dataset.view === view;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const [eyebrow, title, subtitle, breadcrumb] = metadata[view];
  $("#page-eyebrow").textContent = eyebrow;
  $("#page-title").textContent = title;
  $("#page-subtitle").textContent = subtitle;
  $("#breadcrumb-current").textContent = breadcrumb;
  document.title = `Volt · ${breadcrumb}`;
  window.history.replaceState(null, "", `/console#${view}`);
  if (view === "requests") renderRequestTable();
  if (view === "history")
    loadHistory().catch((error) => notify(error.message, true));
  if (focus) {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    $("#workspace").focus({ preventScroll: true });
  }
}

function configureMethods() {
  if (!station) return;
  const select = $("#algorithm");
  [...select.options].forEach((option) => {
    option.disabled =
      (option.value === "dp" && station.settings.ports !== 1) ||
      (["search", "subsets"].includes(option.value) &&
        station.requests.length > 14);
  });
  if (select.selectedOptions[0]?.disabled) select.value = "optimal";
}

function renderStation() {
  if (!station) return;
  $("#ports").value = station.settings.ports;
  $("#request-count").textContent = station.requests.length;
  const source =
    station.source.kind === "synthetic"
      ? `Seed ${station.source.seed}`
      : station.source.kind === "example"
        ? "Report example"
        : "Custom demand";
  $("#dataset-meta").textContent =
    `${integer(station.requests.length)} requests · ${source} · Revision ${station.revision}`;
  $(".synthetic-badge").textContent =
    station.source.kind === "synthetic"
      ? "Synthetic data"
      : station.source.kind === "example"
        ? "Illustrative example"
        : "Custom data";
  $("#connection-state").textContent = "Saved locally";
  configureMethods();
  $("#plan-summary").textContent =
    `${station.settings.ports} port${station.settings.ports === 1 ? "" : "s"} · ${$("#algorithm").selectedOptions[0].textContent.split(" · ")[0]}`;
  renderResults();
  renderRequestTable();
  loadHubs().catch((error) => notify(error.message, true));
}

const shortMoney = (value) =>
  Math.abs(value) >= 1000
    ? `₹${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k`
    : money(value);

function currentHub() {
  if (!station || station.source.kind !== "synthetic") return null;
  return (
    hubs.find(
      (hub) =>
        hub.seed === station.source.seed &&
        hub.max_surge === station.source.max_surge &&
        hub.ports === station.settings.ports &&
        hub.count === station.requests.length,
    ) || null
  );
}

async function loadHubs() {
  const key = `${station.settings.tariff}/${station.settings.energy_cost}`;
  if (key !== hubKey) {
    hubKey = key;
    hubs = await api("/api/hubs");
  }
  renderHubs();
}

// Static scenery for the stylised Delhi NCR map: river, ring roads,
// highways and district names. Built once; only the markers change.
const hubScenery = `<defs><pattern id="hub-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#dfe7f2"/></pattern></defs><rect width="640" height="360" rx="14" fill="#f8fafd"/><rect width="640" height="360" rx="14" fill="url(#hub-dots)"/><path d="M430 0C418 60 452 96 440 150S468 236 452 290 470 340 476 360" fill="none" stroke="#d6e5f7" stroke-width="12" stroke-linecap="round"/><text class="hub-river" x="452" y="70" transform="rotate(78 452 70)">Yamuna</text><ellipse cx="330" cy="180" rx="118" ry="84" fill="none" stroke="#e4ebf5" stroke-width="4"/><ellipse cx="320" cy="190" rx="212" ry="140" fill="none" stroke="#edf1f8" stroke-width="3" stroke-dasharray="10 8"/><path d="M352 150 214 238 150 284 70 360M352 150 494 238 600 300M150 178 214 238M352 150 372 236" fill="none" stroke="#e7edf6" stroke-width="5" stroke-linecap="round"/><text class="hub-region" x="300" y="98">NEW DELHI</text><text class="hub-region" x="28" y="262">GURUGRAM</text><text class="hub-region" x="540" y="214">NOIDA</text>`;

function renderHubs() {
  if (!hubs.length) return;
  const live = currentHub();
  if (!selectedHub || !hubs.some((hub) => hub.id === selectedHub))
    selectedHub = (live || hubs[0]).id;
  const total = hubs.reduce((sum, hub) => sum + hub.profit_inr, 0);
  const fcfs = hubs.reduce((sum, hub) => sum + hub.fcfs_inr, 0);
  $("#hub-count").textContent = `${hubs.length} hubs`;
  $("#hub-subtitle").textContent =
    `${money(total)} optimal daily profit across the network · ${fcfs ? `+${((total / fcfs - 1) * 100).toFixed(1)}% over first come, first served` : "no FCFS baseline"}`;
  let svg = `<svg class="hub-svg" viewBox="0 0 640 360" role="group" aria-label="Delhi NCR charging hubs"><title>Charging hubs. Select one to see its optimal day.</title>${hubScenery}`;
  const anchor = hubs.find((hub) => hub.id === selectedHub);
  hubs.forEach((hub) => {
    if (hub !== anchor)
      svg += `<line x1="${anchor.x}" y1="${anchor.y}" x2="${hub.x}" y2="${hub.y}" stroke="#c9a85a" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="3 5"/>`;
  });
  hubs.forEach((hub) => {
    const selected = hub.id === selectedHub;
    const halo = 11 + hub.ports * 2.2;
    const label = `${hub.name}, ${hub.area}. ${hub.ports} ports. Optimal ${money(hub.profit_inr)}.${hub === live ? " Loaded station." : ""}`;
    const meta = `${shortMoney(hub.profit_inr)} · ${hub.ports} ports`;
    const nameWidth = Math.max(hub.name.length * 6.4, meta.length * 5.6) + 18;
    svg += `<g class="hub${selected ? " selected" : ""}" role="button" tabindex="0" data-hub="${hub.id}" aria-pressed="${selected}" aria-label="${escapeHTML(label)}"><title>${escapeHTML(label)}</title><circle class="hub-halo" cx="${hub.x}" cy="${hub.y}" r="${halo}"/><circle class="hub-core" cx="${hub.x}" cy="${hub.y}" r="8"/>${hub === live ? `<circle cx="${hub.x + halo * 0.7}" cy="${hub.y - halo * 0.7}" r="4.5" fill="#4f9c74" stroke="#fff" stroke-width="2"/>` : ""}<rect class="hub-tag" x="${hub.x - nameWidth / 2}" y="${hub.y + halo + 4}" width="${nameWidth}" height="34" rx="8"/><text class="hub-name" x="${hub.x}" y="${hub.y + halo + 18}" text-anchor="middle">${escapeHTML(hub.name)}</text><text class="hub-meta" x="${hub.x}" y="${hub.y + halo + 32}" text-anchor="middle">${meta}</text></g>`;
  });
  $("#hub-map").innerHTML = svg + "</svg>";
  renderHubDetail(anchor, live);
}

function renderHubDetail(hub, live) {
  const isLive = hub === live;
  const share = hub.profit_inr ? (hub.fcfs_inr / hub.profit_inr) * 100 : 100;
  const custom = station.source.kind !== "synthetic";
  const cta = isLive
    ? `<button class="button secondary" type="button" disabled>Loaded in the console</button>`
    : confirmingHub
      ? `<p class="hub-warning">This replaces your ${custom ? "edited or imported" : "current"} ${integer(station.requests.length)} requests.</p><div class="hub-actions"><button class="button primary" type="button" data-load-hub="${hub.id}">Replace and optimize</button><button class="button secondary" type="button" data-cancel-hub>Cancel</button></div>`
      : `<button class="button primary" type="button" data-load-hub="${hub.id}">Load this hub</button>`;
  $("#hub-detail").innerHTML =
    `<span class="eyebrow">${escapeHTML(hub.area.toUpperCase())}</span><div class="hub-detail-title"><h3>${escapeHTML(hub.name)}</h3>${isLive ? '<span class="pill hub-live">Live</span>' : ""}</div><dl class="hub-stats"><div><dt>Optimal profit</dt><dd>${money(hub.profit_inr)}</dd></div><div><dt>Gain over FCFS</dt><dd class="positive">${hub.gain_percent === null ? "—" : `+${hub.gain_percent.toFixed(1)}%`}</dd></div><div><dt>Vehicles served</dt><dd>${hub.accepted} / ${hub.count}</dd></div><div><dt>Utilization</dt><dd>${hub.utilization.toFixed(1)}%</dd></div><div><dt>Ports</dt><dd>${hub.ports}</dd></div><div><dt>Peak surge</dt><dd>${hub.max_surge.toFixed(1)}×</dd></div></dl><div class="hub-bars" aria-hidden="true"><span>Optimal</span><i style="width:100%"></i><span>FCFS</span><i class="fcfs" style="width:${share.toFixed(1)}%"></i></div>${cta}<p class="hub-note">Seed ${hub.seed} · ${hub.count} synthetic requests · current station prices</p>`;
}

function selectHub(id) {
  if (!hubs.some((hub) => hub.id === id)) return;
  confirmingHub = false;
  selectedHub = id;
  renderHubs();
}

async function loadHub(id) {
  const hub = hubs.find((item) => item.id === id);
  if (!hub) return;
  const next = await api("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      revision: station.revision,
      settings: { ...station.settings, ports: hub.ports },
      count: hub.count,
      seed: hub.seed,
      max_surge: hub.max_surge,
    }),
  });
  confirmingHub = false;
  invalidate(next);
  await optimize();
  notify(
    `${hub.name} loaded. ${activeRun.selected.accepted} sessions, ${money(activeRun.selected.profit_inr)} profit.`,
  );
}

function invalidate(nextState, message) {
  station = nextState;
  activeRun = null;
  shownMethod = null;
  page = 0;
  if (labRevision !== null) {
    $("#sensitivity-result").innerHTML =
      '<div class="empty-state"><h3>Your demand changed.</h3><p>Run the analysis again for the current revision.</p></div>';
    labRevision = null;
  }
  renderStation();
  if (message) notify(message);
}

function renderResults() {
  const result = selectedResult();
  const notice = $("#workspace-notice");
  const historical = activeRun && activeRun.revision !== station.revision;
  notice.classList.toggle("hidden", !!activeRun && !historical);
  notice.textContent = historical
    ? `Viewing saved revision ${activeRun.revision}. The current station is revision ${station.revision}. Optimize to return to the current day.`
    : "Your demand is ready. Optimize the schedule to see what your station can earn.";
  if (!result) {
    ["profit", "gain", "served", "utilization"].forEach(
      (key) => ($(`#metric-${key}`).textContent = "—"),
    );
    $("#metric-profit-caption").textContent = "Ready when you are";
    $("#metric-gain-caption").textContent = "Compare the same demand";
    $("#metric-served-caption").textContent =
      "Every selected session, assigned";
    $("#comparison-chart").innerHTML =
      '<p class="muted">Your comparison will appear after optimization.</p>';
    $("#schedule-method").innerHTML = "<option>No schedule yet</option>";
    $("#schedule-method").disabled = true;
    $("#export-schedule").disabled = true;
    $("#schedule-status").textContent = "Ready to plan";
    $("#schedule-subtitle").textContent =
      "One clear timeline. Every session in its place.";
    $("#schedule-runtime").textContent = "";
    $("#timeline").innerHTML =
      '<div class="empty-state"><span class="empty-icon">⌁</span><h3>Your next great schedule starts here.</h3><p>Run the optimizer to find the best use of your ports.</p></div>';
    renderTrace();
    return;
  }
  const baseline = activeRun.comparison.find(
    (row) => row.algorithm === "fcfs",
  ).profit_inr;
  const gain = baseline ? (result.profit_inr / baseline - 1) * 100 : null;
  const delta = result.profit_inr - baseline;
  $("#metric-profit").textContent = money(result.profit_inr);
  $("#metric-profit-caption").textContent = result.exact
    ? "Exact optimum for these fixed slots"
    : "Heuristic schedule · compare with optimum";
  $("#metric-gain").textContent =
    gain === null ? "—" : `${gain >= 0 ? "+" : ""}${gain.toFixed(1)}%`;
  $("#metric-gain-caption").textContent = baseline
    ? `${money(Math.abs(delta))} ${delta >= 0 ? "more" : "less"} than first come, first served`
    : "FCFS profit is zero; percentage undefined";
  $("#metric-gain-caption").classList.toggle("positive", delta >= 0);
  $("#metric-served").textContent =
    `${result.accepted} / ${activeRun.requests.length}`;
  $("#metric-served-caption").textContent =
    `${result.rejected} requests declined · ${result.ports} ports`;
  $("#metric-utilization").textContent = `${result.utilization.toFixed(1)}%`;
  $("#schedule-status").textContent = result.exact
    ? "Exact optimum"
    : "Greedy baseline";
  $("#schedule-subtitle").textContent =
    `${result.name} · ${result.accepted} sessions · ${result.ports} charging ports`;
  $("#schedule-validation").textContent =
    "Verified · No overlaps · Every session meets its deadline";
  $("#schedule-runtime").textContent =
    `${result.runtime_ms.toFixed(2)} ms solver time`;
  $("#schedule-method").disabled = false;
  $("#export-schedule").disabled = false;
  const options = [...activeRun.comparison];
  if (!options.some((row) => row.algorithm === activeRun.selected.algorithm))
    options.unshift(activeRun.selected);
  $("#schedule-method").innerHTML = options
    .map(
      (row) =>
        `<option value="${row.algorithm}">${escapeHTML(labels[row.algorithm])}${row.exact ? " · Optimal" : ""}</option>`,
    )
    .join("");
  $("#schedule-method").value = result.algorithm;
  const optimum = activeRun.comparison[0].profit_inr;
  $("#comparison-chart").innerHTML = activeRun.comparison
    .map((row) => {
      const share = optimum ? (row.profit_inr / optimum) * 100 : 100;
      return `<div class="comparison-row"><span class="comparison-name">${row.exact ? "Optimal" : escapeHTML(labels[row.algorithm])}</span><div class="comparison-bar-track"><div class="comparison-bar" style="width:${share}%"></div></div><span class="comparison-value">${money(row.profit_inr)}<span class="comparison-share">${share.toFixed(1)}% of optimal</span></span></div>`;
    })
    .join("");
  drawTimeline(result);
  renderTrace();
}

function drawTimeline(result) {
  if (timelinePort !== "all" && Number(timelinePort) > result.ports)
    timelinePort = "all";
  $("#timeline-port").innerHTML =
    '<option value="all">All ports</option>' +
    Array.from(
      { length: result.ports },
      (_, i) =>
        `<option value="${i + 1}">Port ${String(i + 1).padStart(2, "0")}</option>`,
    ).join("");
  $("#timeline-port").value = timelinePort;
  const schedule = result.schedule.filter(
    (request) =>
      timelinePort === "all" || request.port === Number(timelinePort),
  );
  if (!schedule.length) {
    $("#timeline").innerHTML =
      `<div class="empty-state"><span class="empty-icon">⌁</span><h3>${result.schedule.length ? "A little breathing room on this port." : "No profitable sessions to schedule."}</h3><p>${result.schedule.length ? "Choose another port or return to the full station view." : "Add requests or review station prices. The empty schedule earns ₹0."}</p></div>`;
    return;
  }
  const start = Math.min(
    360,
    Math.floor(Math.min(...activeRun.requests.map((r) => r.arrival_min)) / 60) *
      60,
  );
  const end = 1440,
    width = 1100,
    left = 84,
    right = 22,
    top = 43,
    rowHeight = 64;
  const ports =
    timelinePort === "all"
      ? Array.from({ length: result.ports }, (_, i) => i + 1)
      : [Number(timelinePort)];
  const height = top + ports.length * rowHeight + 16;
  const x = (value) =>
    left + ((value - start) / (end - start)) * (width - left - right);
  let svg = `<svg class="timeline-svg" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeHTML(result.name)} charging schedule"><title>Charging schedule. Select a session for its booking details.</title>`;
  [
    [480, 660],
    [1020, 1260],
  ].forEach(([a, b]) => {
    const from = Math.max(start, a);
    if (from < b)
      svg += `<rect x="${x(from)}" y="${top - 7}" width="${x(b) - x(from)}" height="${ports.length * rowHeight}" fill="#f8f7ef" opacity=".7"/>`;
  });
  for (let tick = start; tick <= end; tick += 120) {
    svg += `<text x="${x(tick)}" y="19" text-anchor="${tick === end ? "end" : "middle"}">${time(tick)}</text><line x1="${x(tick)}" x2="${x(tick)}" y1="${top - 7}" y2="${height - 16}" stroke="#e8edf6" stroke-dasharray="2 5"/>`;
  }
  ports.forEach((port, index) => {
    const y = top + index * rowHeight;
    svg += `<text class="port-label" x="5" y="${y + 25}">Port ${String(port).padStart(2, "0")}</text><line x1="${left}" x2="${width - right}" y1="${y + 49}" y2="${y + 49}" stroke="#eef2f8"/>`;
  });
  schedule.forEach((request) => {
    const y = top + ports.indexOf(request.port) * rowHeight + 4;
    const slotX = x(request.arrival_min);
    const slotWidth = Math.max(
      2,
      x(request.deadline_min) - x(request.arrival_min) - 2,
    );
    const [color, tint] =
      request.surge_mult >= 2
        ? ["#c4a45d", "#f6efdc"]
        : request.surge_mult >= 1.65
          ? ["#8d87bc", "#ecebf6"]
          : ["#7f9fda", "#e8eefa"];
    const text = `R${request.request_id} · ${time(request.arrival_min)}–${time(request.deadline_min)} · ${money(request.profit_inr)} · Port ${request.port}`;
    const carWidth = Math.min(slotWidth, 60);
    const spare = slotWidth - carWidth;
    const extra =
      spare >= 30
        ? `<text class="bay-label" x="${slotX + slotWidth - 6}" y="${y + 22}" text-anchor="end">${spare >= 46 ? "⚡ " : ""}${request.duration_min}m</text>`
        : "";
    svg += `<g class="slot" role="button" tabindex="0" data-session="${request.request_id}" aria-label="${escapeHTML(text)}"><title>${escapeHTML(text)}</title><rect class="bay" x="${slotX}" y="${y}" width="${slotWidth}" height="35" rx="7" fill="${tint}"/>${car(slotX, y, carWidth, color)}${extra}${carWidth >= 38 ? `<text class="session-label" x="${slotX + carWidth / 2}" y="${y + 25}" text-anchor="middle">R${request.request_id}</text>` : ""}</g>`;
  });
  $("#timeline").innerHTML = svg + "</svg>";
}

// A small side-view car facing right (towards later times). Pure SVG paths,
// so a full day of sessions costs no more to draw than plain boxes.
function car(left, top, width, color) {
  const w = Math.max(width, 8);
  const bottom = top + 29,
    body = top + (w < 22 ? 17 : 14),
    roof = top + (w < 22 ? 9 : 4);
  const corner = Math.min(5, w / 5);
  const at = (share) => (left + w * share).toFixed(1);
  const wheel = Math.max(2.5, Math.min(5, w / 7));
  const wheelInset = Math.max(wheel + 1.5, w * 0.22);
  let shape =
    `<path class="car-body" fill="${color}" d="M${left + corner} ${bottom}H${left + w - corner}Q${left + w} ${bottom} ${left + w} ${bottom - corner}V${body + 4}Q${left + w} ${body} ${left + w - 4} ${body - 0.5}L${at(0.74)} ${body - 1}L${at(0.6)} ${roof}H${at(0.3)}L${at(0.16)} ${body - 1}L${left + 3} ${body}Q${left} ${body + 1} ${left} ${body + 4}V${bottom - corner}Q${left} ${bottom} ${left + corner} ${bottom}Z"/>`;
  if (w >= 22) {
    shape += `<path fill="#fff" opacity=".6" d="M${at(0.235)} ${body - 1.5}L${at(0.32)} ${roof + 2.5}H${at(0.44)}V${body - 1.5}ZM${at(0.48)} ${body - 1.5}V${roof + 2.5}H${at(0.585)}L${at(0.67)} ${body - 1.5}Z"/><rect x="${left + w - 4.5}" y="${body + 2}" width="3" height="2.5" rx="1" fill="#fff8de"/><rect x="${left + 1}" y="${body + 2}" width="2.5" height="2.5" rx="1" fill="#f3c6c6"/>`;
  }
  [left + wheelInset, left + w - wheelInset].forEach((cx) => {
    shape += `<circle cx="${cx.toFixed(1)}" cy="${bottom}" r="${wheel}" fill="#2b4266"/><circle cx="${cx.toFixed(1)}" cy="${bottom}" r="${(wheel * 0.38).toFixed(1)}" fill="#dfe6f1"/>`;
  });
  return shape;
}

function renderRequestTable() {
  if (!station) return;
  const result = currentResult();
  const accepted = new Set(result?.schedule.map((row) => row.request_id) || []);
  const search = $("#request-search")
    .value.trim()
    .toLowerCase()
    .replace(/^r/, "");
  const filter = $("#request-filter").value;
  const rows = station.requests
    .map((request) => ({
      ...request,
      status: result
        ? accepted.has(request.request_id)
          ? "accepted"
          : "rejected"
        : "unplanned",
    }))
    .filter(
      (request) =>
        String(request.request_id).includes(search) &&
        (filter === "all" || request.status === filter),
    )
    .sort((a, b) => {
      const sort = $("#request-sort").value;
      return (
        (sort === "profit"
          ? b.profit_inr - a.profit_inr
          : sort === "duration"
            ? a.duration_min - b.duration_min
            : a.arrival_min - b.arrival_min) || a.request_id - b.request_id
      );
    });
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  page = Math.min(page, pages - 1);
  const slice = rows.slice(page * 10, page * 10 + 10);
  $("#request-rows").innerHTML = slice.length
    ? slice
        .map(
          (request) =>
            `<tr><td>R${request.request_id}</td><td><strong>${time(request.arrival_min)} – ${time(request.deadline_min)}</strong><small>${request.duration_min} minute session</small></td><td><strong>${request.energy_kwh.toFixed(1)} kWh</strong><small>${request.surge_mult.toFixed(2)}× surge</small></td><td>${money(request.profit_inr)}</td><td><span class="pill status-${request.status}">${request.status[0].toUpperCase() + request.status.slice(1)}</span></td><td><button type="button" class="edit-button" data-edit="${request.request_id}" aria-label="Edit request R${request.request_id}">Edit</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6"><div class="empty-state"><h3>No requests here yet.</h3><p>Add a booking, generate demand, or adjust your filters.</p></div></td></tr>';
  $("#filter-count").textContent = `${rows.length} matching requests`;
  $("#page-description").textContent = rows.length
    ? `${page * 10 + 1}–${Math.min((page + 1) * 10, rows.length)} of ${rows.length} requests`
    : "0 requests";
  $("#prev-page").disabled = page === 0;
  $("#next-page").disabled = page >= pages - 1;
}

function renderTrace() {
  const result = activeRun?.selected;
  if (!result) {
    $("#trace-title").textContent = "Inside the solver";
    $("#trace-subtitle").textContent =
      "Optimize a day to inspect its algorithm trace.";
    $("#trace-content").innerHTML =
      '<div class="empty-state"><span class="empty-icon">∑</span><h3>Follow the decision.</h3><p>Load the report example for an eight-request DP walkthrough.</p></div>';
    return;
  }
  $("#trace-title").textContent = `Inside ${result.name.toLowerCase()}`;
  $("#trace-subtitle").textContent =
    `${result.accepted} sessions selected · ${money(result.profit_inr)} total profit`;
  $("#trace-complexity").textContent = result.complexity;
  if (result.algorithm === "dp") {
    const chosen = new Set(result.schedule.map((r) => r.request_id));
    const rows = result.trace.rows.slice(0, 300);
    $("#trace-content").innerHTML =
      loopDiagram(
        [
          ["sort", "Sort by finish", "earliest deadline first", `${integer(result.trace.rows.length)} requests`],
          ["search", "Binary search", "last booking that fits", "pred(j) in O(log n)"],
          ["choose", "Take or skip", "keep the better total", "OPT(j) = max(take, skip)"],
          ["trace", "Traceback", "walk back the choices", `${chosen.size} selected`],
        ],
        "repeat for every request j",
      ) +
      (rows.length
        ? `<div class="dp-controls"><label class="trace-range-label" for="trace-step"><span>Decision</span><output id="trace-step-value"></output></label><input id="trace-step" type="range" min="1" max="${rows.length}" value="${rows.length}" aria-label="Dynamic programming decision"><button type="button" class="button primary small" data-dp="play">▶ Play decisions</button></div><div class="dp-stage"><div class="dp-window" id="dp-window"></div><div id="trace-focus" class="trace-focus dp-choice"></div></div><div class="dp-curve" id="dp-curve"></div>`
        : "") +
      `<details class="trace-table-details"><summary>Full DP table <span>＋</span></summary><div class="trace-table-scroll"><table class="data-table"><thead><tr><th>j</th><th>Request</th><th>pred(j)</th><th>Include / ₹</th><th>Exclude / ₹</th><th>OPT(j) / ₹</th><th>Local choice</th><th>Traceback</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.j}</td><td>R${row.request_id}</td><td>${row.predecessor}</td><td>${row.include}</td><td>${row.exclude}</td><td>${row.optimal}</td><td><span class="trace-decision ${row.take ? "" : "skip"}">${row.take ? "Take" : "Skip"}</span></td><td>${chosen.has(row.request_id) ? "Selected" : "—"}</td></tr>`).join("")}</tbody></table></div></details><p class="footnote">A local choice improves a prefix; traceback identifies the final set. ${result.trace.rows.length > 300 ? "Showing the first 300 states. Export JSON for the complete trace." : "Ties skip the current request, matching the report."}</p>`;
    if (rows.length) updateTraceStep(rows.length);
  } else if (
    result.algorithm === "flow" &&
    result.trace.augmentations.every((row) => row.segments)
  ) {
    renderFlowTrace(result);
  } else if (result.algorithm === "flow") {
    $("#trace-content").innerHTML =
      `<div class="trace-formula">Request arc: capacity = 1, cost = −profit · Send k units of flow</div><div class="flow-summary"><span><strong>${result.trace.nodes}</strong>time nodes</span><span><strong>${result.trace.arcs}</strong>forward arcs</span><span><strong>${result.trace.augmentations.length}</strong>augmentations</span></div>${result.trace.augmentations.map((row) => `<details class="flow-step" ${row.iteration === 1 ? "open" : ""}><summary><span class="flow-step-number">${row.iteration}</span><strong>Dijkstra search · ${row.units} unit${row.units === 1 ? "" : "s"} routed</strong><span class="flow-value">+${money(row.profit_change)}</span></summary><p>Total flow ${row.flow}/${result.ports} · ${row.reverse_arcs} reverse arcs<br>Path: ${row.path_minutes.slice(0, 35).map(time).join(" → ")}${row.path_minutes.length > 35 ? " …" : ""}</p></details>`).join("")}<p class="footnote">Open an augmentation to explore its path. Reverse arcs allow previous choices to be exchanged; Dijkstra uses non-negative reduced costs.</p>`;
  } else {
    const detail =
      result.algorithm === "search"
        ? `Branch and bound visited ${integer(result.trace.visited)} states, pruning branches that could not improve the best answer.`
        : result.algorithm === "subsets"
          ? `The oracle independently enumerated ${integer(result.trace.subsets)} subsets and checked maximum overlap.`
          : "This heuristic orders requests by its local rule and finds a port free for the whole slot. It can miss more valuable combinations.";
    $("#trace-content").innerHTML =
      `<div class="empty-state"><span class="empty-icon">${result.exact ? "✓" : "≋"}</span><h3>${escapeHTML(result.name)}</h3><p>${detail}</p></div>`;
  }
  $("#trace-content").insertAdjacentHTML(
    "beforeend",
    `<a class="button secondary small trace-export" href="/api/runs/${activeRun.id}/export?format=json" download>Export run JSON</a>`,
  );
}

// Minimum-cost flow as routes. Each Dijkstra search pushes one unit of flow
// (one more charger) from the first time node to the last. Waiting moves
// along the road, a taken booking hops above it, and a booking handed back
// through a reverse arc dips below it.
let routeIndex = 0;
let routeTimers = [];
const routeColors = ["#557bc9", "#8d87bc", "#c9a85a", "#5fa88a", "#c97b6b", "#6fa3c9"];
const flowStages = [
  ["graph", "Time graph", "nodes & arcs"],
  ["dijkstra", "Dijkstra", "most profitable route"],
  ["push", "Push one unit", "one more charger"],
  ["residual", "Residual update", "reverse arcs allow swaps"],
];

function renderFlowTrace(result) {
  routeIndex = 0;
  const routes = result.trace.augmentations;
  const stats = {
    graph: `${integer(result.trace.nodes)} nodes · ${integer(result.trace.arcs)} arcs`,
    dijkstra: "min-heap · reduced costs",
    push: `${routes.length} route${routes.length === 1 ? "" : "s"} for ${result.ports} port${result.ports === 1 ? "" : "s"}`,
    residual: "potentials keep costs ≥ 0",
  };
  $("#trace-content").innerHTML =
    loopDiagram(
      flowStages.map(([key, title, hint]) => [key, title, hint, stats[key]]),
      "repeat once per port",
    ) +
    `<div class="route-controls"><div class="route-step"><button type="button" class="icon-button" data-route="prev" aria-label="Previous route">‹</button><span id="route-label" aria-live="polite"></span><button type="button" class="icon-button" data-route="next" aria-label="Next route">›</button></div><button type="button" class="button primary small" data-route="play">▶ Play routes</button></div>` +
    `<div class="route-summary" id="route-summary"></div>` +
    `<div class="route-map" id="route-map"></div>` +
    `<div class="route-legend"><span><i class="legend-road"></i>Waiting on the time line</span><span><i class="legend-take"></i>Booking taken</span><span><i class="legend-undo"></i>Booking handed back</span><span><i class="legend-dot"></i>One unit of flow</span></div>` +
    `<div class="route-stack" id="route-stack"></div>` +
    `<p class="footnote">Dijkstra runs on reduced costs (cost − potential difference), so every arc is non-negative and the shortest path is the most profitable route. Reverse arcs let a later route hand a booking back so an earlier route can be rearranged.</p>`;
  drawRoutes(result, true);
}

function drawRoutes(result, animate) {
  routeTimers.forEach(clearTimeout);
  routeTimers = [];
  const routes = result.trace.augmentations;
  const route = routes[routeIndex];
  const total = routes.reduce((sum, row) => sum + row.profit_change, 0);
  $("#route-label").textContent = `Route ${routeIndex + 1} of ${routes.length}`;
  $('[data-route="prev"]').disabled = routeIndex === 0;
  $('[data-route="next"]').disabled = routeIndex === routes.length - 1;
  const takes = route.segments.filter((s) => s.kind === "take");
  const undos = route.segments.filter((s) => s.kind === "undo");
  const note =
    route.profit_change <= 0
      ? "No booking is left that adds profit, so this unit of flow simply waits along the time line."
      : routeIndex === 0
        ? "Dijkstra finds the single most profitable chain of non-overlapping bookings through the day: what one charger would earn alone."
        : undos.length
          ? `Dijkstra found a better plan by handing ${undos.length === 1 ? "a booking" : `${undos.length} bookings`} back from an earlier route (red, below the road), so the earlier route can be rearranged around this one.`
          : "Given the earlier routes, Dijkstra finds the best extra chain of bookings for one more charger. No earlier choice had to change.";
  $("#route-summary").innerHTML =
    `<div class="route-gain" style="--route:${routeColors[routeIndex % routeColors.length]}"><span>Route ${routeIndex + 1} adds</span><strong>+${money(route.profit_change)}</strong></div><dl class="route-facts"><div><dt>Bookings taken</dt><dd>${takes.length}</dd></div><div><dt>Handed back</dt><dd>${undos.length}</dd></div><div><dt>Flow sent</dt><dd>${route.flow} / ${result.ports}</dd></div></dl><p>${note}</p>`;

  const all = [...activeRun.requests];
  const start = Math.min(
    360,
    Math.floor(Math.min(...all.map((r) => r.arrival_min)) / 60) * 60,
  );
  const width = 1100,
    left = 96,
    right = 22,
    top = 30,
    laneHeight = routes.length > 6 ? 74 : 98;
  const x = (minute) =>
    left + ((Math.max(start, minute) - start) / (1440 - start)) * (width - left - right);
  const height = top + routes.length * laneHeight + 6;
  const undone = new Map();
  routes.slice(0, routeIndex + 1).forEach((row) =>
    row.segments
      .filter((s) => s.kind === "undo")
      .forEach((s) => undone.set(s.request_id, row.iteration)),
  );
  let svg = `<svg class="route-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Augmenting routes found by Dijkstra"><title>Routes found by Dijkstra. Gold arcs above the road are bookings taken; red arcs below are bookings handed back.</title>`;
  for (let tick = start; tick <= 1440; tick += 180)
    svg += `<text class="route-tick" x="${x(tick)}" y="14" text-anchor="${tick === 1440 ? "end" : "middle"}">${time(tick)}</text>`;
  let motion = "";
  let motionLength = 0;
  routes.forEach((row, lane) => {
    const road = top + lane * laneHeight + laneHeight * 0.6;
    const color = routeColors[lane % routeColors.length];
    const state =
      lane < routeIndex ? "past" : lane === routeIndex ? "current" : "future";
    svg += `<g class="route-lane ${state}"><text class="route-name" x="4" y="${road - 6}">Route ${lane + 1}</text><text class="route-value" x="4" y="${road + 11}">${lane <= routeIndex ? `+${money(row.profit_change)}` : "waiting"}</text><line class="route-road" x1="${left}" x2="${width - right}" y1="${road}" y2="${road}"/>`;
    if (lane > routeIndex) {
      svg += "</g>";
      return;
    }
    let d = `M${x(row.segments[0].from).toFixed(1)} ${road}`;
    let travelled = 0;
    const pieces = row.segments.map((segment) => {
      const x1 = x(segment.from),
        x2 = x(segment.to),
        span = Math.abs(x2 - x1);
      let path, length;
      if (segment.kind === "take" || segment.kind === "undo") {
        const lift =
          segment.kind === "take"
            ? -Math.min(laneHeight * 0.46, 10 + span * 0.35)
            : Math.min(laneHeight * 0.3, 8 + span * 0.25);
        path = `Q${((x1 + x2) / 2).toFixed(1)} ${(road + lift * 2).toFixed(1)} ${x2.toFixed(1)} ${road}`;
        length = span + Math.abs(lift) * 1.6;
      } else if (segment.kind === "undo-idle") {
        path = `Q${((x1 + x2) / 2).toFixed(1)} ${road + 10} ${x2.toFixed(1)} ${road}`;
        length = span + 6;
      } else {
        path = `L${x2.toFixed(1)} ${road}`;
        length = span;
      }
      const piece = { segment, x1, x2, path, length, from: travelled };
      travelled += length;
      d += path;
      return piece;
    });
    const drawTime = 2600;
    pieces.forEach(({ segment, x1, x2, path, length, from }) => {
      const timing =
        animate && state === "current"
          ? ` style="transition-delay:${Math.round((from / travelled) * drawTime)}ms;transition-duration:${Math.max(40, Math.round((length / travelled) * drawTime))}ms"`
          : "";
      const kind =
        segment.kind === "take" && undone.has(segment.request_id) && undone.get(segment.request_id) > lane + 1
          ? "swapped"
          : segment.kind;
      const label =
        segment.kind === "take"
          ? `R${segment.request_id} taken · ${time(segment.from)}–${time(segment.to)} · +${money(segment.profit_inr)}${kind === "swapped" ? ` · handed back by route ${undone.get(segment.request_id)}` : ""}`
          : segment.kind === "undo"
            ? `R${segment.request_id} handed back · −${money(segment.profit_inr)} for this route`
            : `Waiting ${time(Math.min(segment.from, segment.to))}–${time(Math.max(segment.from, segment.to))}`;
      svg += `<path class="route-seg seg-${kind}" pathLength="1" d="M${x1.toFixed(1)} ${road}${path}" style="--route:${color}"${timing}><title>${escapeHTML(label)}</title></path>`;
      if (
        (segment.kind === "take" || segment.kind === "undo") &&
        Math.abs(x2 - x1) > 30
      )
        svg += `<text class="route-arc-label ${segment.kind}" x="${((x1 + x2) / 2).toFixed(1)}" y="${segment.kind === "take" ? (road - Math.min(laneHeight * 0.46, 10 + Math.abs(x2 - x1) * 0.35) - 4).toFixed(1) : (road + Math.min(laneHeight * 0.3, 8 + Math.abs(x2 - x1) * 0.25) + 12).toFixed(1)}" text-anchor="middle">${segment.kind === "undo" ? "↺ " : ""}R${segment.request_id}</text>`;
    });
    if (state === "current") {
      motion = d;
      motionLength = travelled;
    }
    svg += "</g>";
  });
  if (motion)
    svg += `<g class="flow-dot" visibility="hidden" aria-hidden="true"><circle r="9" class="flow-dot-halo"/><circle r="4.5" class="flow-dot-core"/><animateMotion dur="2.6s" begin="indefinite" fill="freeze" path="${motion}"/></g>`;
  const map = $("#route-map");
  map.innerHTML = svg + "</svg>";
  const share = (row) => (total > 0 ? Math.max(0, row.profit_change) / total : 0);
  $("#route-stack").innerHTML =
    `<div class="route-stack-bar">${routes.map((row, i) => `<span class="${i <= routeIndex ? "on" : ""}" style="flex-grow:${share(row)};--route:${routeColors[i % routeColors.length]}" title="Route ${i + 1}: +${money(row.profit_change)}"></span>`).join("")}</div><div class="route-stack-labels"><span>${money(routes.slice(0, routeIndex + 1).reduce((sum, row) => sum + row.profit_change, 0))} of ${money(total)} after ${routeIndex + 1} route${routeIndex ? "s" : ""}</span><span>Total = optimal profit</span></div>`;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  setStage(null);
  if (!animate || reduce || !motionLength) {
    map.querySelectorAll(".current .route-seg").forEach((p) => p.classList.add("drawn"));
    return;
  }
  setStage("dijkstra");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      map.querySelectorAll(".current .route-seg").forEach((p) => p.classList.add("drawn"));
      const motionElement = map.querySelector(".flow-dot animateMotion");
      if (motionElement?.beginElement) {
        motionElement.beginElement();
        motionElement.parentElement.removeAttribute("visibility");
      }
    }),
  );
  routeTimers.push(
    setTimeout(() => setStage("push"), 2700),
    setTimeout(() => setStage("residual"), 3300),
    setTimeout(() => setStage(null), 4200),
  );
}

function setStage(key) {
  $$(".flow-stage").forEach((stage) =>
    stage.classList.toggle("active", stage.dataset.stage === key),
  );
}

function stepRoute(kind) {
  const result = activeRun?.selected;
  if (!result?.trace?.augmentations?.length) return;
  const last = result.trace.augmentations.length - 1;
  if (kind === "play") {
    routeTimers.forEach(clearTimeout);
    routeIndex = 0;
    const playNext = () => {
      drawRoutes(result, true);
      if (routeIndex < last)
        routeTimers.push(
          setTimeout(() => {
            routeIndex++;
            playNext();
          }, 3500),
        );
    };
    playNext();
    return;
  }
  routeIndex = Math.min(last, Math.max(0, routeIndex + (kind === "next" ? 1 : -1)));
  drawRoutes(result, true);
}

document.addEventListener("click", (event) => {
  const control = event.target.closest("[data-route]");
  if (control) stepRoute(control.dataset.route);
});

function loopDiagram(stages, repeat) {
  const icons = {
    sort: "⇅",
    search: "⌕",
    choose: "⚖",
    trace: "↩",
    graph: "◇",
    dijkstra: "⌖",
    push: "+1",
    residual: "↺",
  };
  return `<div class="flow-loop">${stages
    .map(
      ([key, title, hint, stat], i) =>
        `${i ? '<svg class="flow-arrow" viewBox="0 0 40 12" aria-hidden="true"><path d="M2 6h32m-6-5 6 5-6 5"/></svg>' : ""}<div class="flow-stage" data-stage="${key}"><span class="flow-stage-icon" aria-hidden="true">${icons[key]}</span><strong>${title}</strong><small>${hint}</small><em>${stat}</em></div>`,
    )
    .join(
      "",
    )}<div class="flow-repeat" aria-hidden="true"><svg viewBox="0 0 400 26" preserveAspectRatio="none"><path d="M392 2v10a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V6m-5 5 5-6 5 6"/></svg><span>${repeat}</span></div></div>`;
}

// Dynamic programming explorer: the bookings around decision j, the take
// versus skip comparison, and OPT(j) growing across all decisions.
let dpTimer = 0;

function updateTraceStep(value) {
  const result = activeRun?.selected;
  const rows = result?.trace.rows?.slice(0, 300);
  const row = rows?.[Number(value) - 1];
  if (!row) return;
  const byId = new Map(activeRun.requests.map((r) => [r.request_id, r]));
  const chosen = new Set(result.schedule.map((r) => r.request_id));
  const j = row.j;
  $("#trace-step-value").textContent = `${j} / ${rows.length}`;
  const previous = row.predecessor ? rows[row.predecessor - 1].optimal : 0;
  const profit = row.include - previous;
  const best = Math.max(row.include, row.exclude, 1);
  $("#trace-focus").innerHTML =
    `<h3>R${row.request_id} · ${row.take ? "Take" : "Skip"}</h3><p>Compatible prefix: ${row.predecessor} · best so far ${money(row.optimal)}</p>` +
    `<div class="dp-option ${row.take ? "win" : ""}"><div class="dp-option-head"><span>Take R${row.request_id}</span><strong>${money(row.include)}</strong></div><div class="dp-bar"><i class="dp-own" style="width:${(Math.max(0, profit) / best) * 100}%"></i><i class="dp-prev" style="width:${(Math.max(0, previous) / best) * 100}%"></i></div><small>${money(profit)} for R${row.request_id} + OPT(${row.predecessor}) ${money(previous)}</small></div>` +
    `<div class="dp-option ${row.take ? "" : "win"}"><div class="dp-option-head"><span>Skip R${row.request_id}</span><strong>${money(row.exclude)}</strong></div><div class="dp-bar"><i class="dp-prev" style="width:${(Math.max(0, row.exclude) / best) * 100}%"></i></div><small>keep OPT(${j - 1}), the best of the first ${j - 1}</small></div>`;

  const windowRows = rows.slice(Math.max(0, j - 10), j);
  const slots = windowRows.map((r) => byId.get(r.request_id));
  const lo = Math.min(...slots.map((r) => r.arrival_min));
  const hi = Math.max(...slots.map((r) => r.arrival_min + r.duration_min));
  const width = 640,
    left = 52,
    right = 16,
    barHeight = 20,
    gap = 6,
    top = 26;
  const x = (m) =>
    left + ((m - lo) / Math.max(1, hi - lo)) * (width - left - right);
  const current = byId.get(row.request_id);
  const height = top + windowRows.length * (barHeight + gap) + 6;
  const edge = x(current.arrival_min);
  let svg = `<svg class="dp-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bookings sorted by finish time around decision ${j}"><title>Blue bookings finish before R${row.request_id} starts; grey ones overlap it.</title><line class="dp-boundary" x1="${edge}" x2="${edge}" y1="${top - 8}" y2="${height - 2}"/><text class="dp-boundary-label" x="${edge > width - 150 ? edge - 4 : edge + 4}" y="${top - 12}" text-anchor="${edge > width - 150 ? "end" : "start"}">R${row.request_id} starts ${time(current.arrival_min)}</text>`;
  windowRows.forEach((r, i) => {
    const slot = slots[i];
    const kind =
      r.j === j ? "current" : r.j <= row.predecessor ? "fits" : "overlap";
    const y = top + i * (barHeight + gap);
    const x1 = x(slot.arrival_min),
      x2 = x(slot.arrival_min + slot.duration_min);
    const state =
      kind === "fits"
        ? "finishes before it starts"
        : kind === "overlap"
          ? "overlaps it"
          : "current decision";
    svg += `<g class="dp-row ${kind}"><title>R${r.request_id} · ${time(slot.arrival_min)}–${time(slot.arrival_min + slot.duration_min)} · ${money(slot.profit_inr)} · ${state}</title><text class="dp-j" x="4" y="${y + 14}">j=${r.j}</text><rect x="${x1.toFixed(1)}" y="${y}" width="${Math.max(3, x2 - x1).toFixed(1)}" height="${barHeight}" rx="6"/>${x2 - x1 > 34 ? `<text class="dp-label" x="${((x1 + x2) / 2).toFixed(1)}" y="${y + 14}" text-anchor="middle">R${r.request_id}</text>` : ""}${chosen.has(r.request_id) ? `<circle class="dp-selected" cx="${Math.min(width - 6, x2 + 8).toFixed(1)}" cy="${y + barHeight / 2}" r="3.5"/>` : ""}</g>`;
  });
  $("#dp-window").innerHTML =
    svg +
    `</svg><div class="dp-key"><span><i class="fits"></i>Fits before</span><span><i class="overlap"></i>Overlaps</span><span><i class="current"></i>Decision j</span><span><i class="selected"></i>In final answer</span></div>`;

  const cw = 1100,
    ch = 110,
    cl = 6,
    cr = 6,
    ct = 12,
    cb = 8;
  const peak = Math.max(1, rows[rows.length - 1].optimal);
  const cx = (k) => cl + (k / rows.length) * (cw - cl - cr);
  const cy = (v) => ct + (1 - Math.max(0, v) / peak) * (ch - ct - cb);
  const steps = (list) =>
    list.reduce(
      (path, r, k) =>
        `${path}H${cx(k + 1).toFixed(1)}V${cy(r.optimal).toFixed(1)}`,
      `M${cx(0)} ${cy(0)}`,
    );
  $("#dp-curve").innerHTML =
    `<div class="dp-curve-head"><span>OPT(j) as each decision is made</span><strong>${money(row.optimal)}</strong></div><svg class="dp-curve-svg" viewBox="0 0 ${cw} ${ch}" preserveAspectRatio="none" role="img" aria-label="Best profit after each decision"><path class="dp-curve-all" d="${steps(rows)}"/><path class="dp-curve-done" d="${steps(rows.slice(0, j))}"/><line class="dp-curve-now" x1="${cx(j)}" x2="${cx(j)}" y1="2" y2="${ch}"/></svg><div class="dp-curve-axis"><span>j = 1</span><span>j = ${rows.length}</span></div>`;
  $$("#trace-content .flow-stage").forEach((stage) =>
    stage.classList.toggle(
      "active",
      stage.dataset.stage === (j === rows.length ? "trace" : "choose"),
    ),
  );
}

function playDecisions(button) {
  const input = $("#trace-step");
  if (!input) return;
  if (dpTimer) {
    clearTimeout(dpTimer);
    dpTimer = 0;
    button.textContent = "▶ Play decisions";
    return;
  }
  const max = Number(input.max);
  const delay = Math.max(60, Math.min(900, 9000 / max));
  let j = Number(input.value) >= max ? 1 : Number(input.value) + 1;
  button.textContent = "❚❚ Pause";
  const tick = () => {
    if (!document.body.contains(input)) {
      dpTimer = 0;
      return;
    }
    input.value = String(j);
    updateTraceStep(j);
    if (j >= max) {
      dpTimer = 0;
      button.textContent = "▶ Play decisions";
      return;
    }
    j++;
    dpTimer = setTimeout(tick, delay);
  };
  tick();
}

document.addEventListener("click", (event) => {
  const control = event.target.closest('[data-dp="play"]');
  if (control) playDecisions(control);
});

function openDialog(id) {
  const dialog = $(id);
  const error = dialog.querySelector(".form-error");
  if (error) error.textContent = "";
  dialog.showModal();
}

function requestPreview() {
  const form = $("#request-form");
  const [hour, minute] = form.elements.start.value.split(":").map(Number);
  const deadline =
    hour * 60 + minute + Number(form.elements.duration_min.value);
  const value =
    Number(form.elements.energy_kwh.value) *
    (station.settings.tariff * Number(form.elements.surge_mult.value) -
      station.settings.energy_cost);
  $("#request-preview").textContent =
    `Leave by ${Number.isFinite(deadline) ? time(deadline) : "—"} · Estimated profit ${Number.isFinite(value) ? money(value) : "—"}`;
}

function editRequest(id = null) {
  const request = station.requests.find((r) => r.request_id === id);
  const form = $("#request-form");
  form.reset();
  form.elements.request_id.value =
    request?.request_id ||
    Math.max(0, ...station.requests.map((r) => r.request_id)) + 1;
  form.elements.start.value = time(request?.arrival_min ?? 540);
  ["duration_min", "energy_kwh", "surge_mult"].forEach((key) => {
    if (request) form.elements[key].value = request[key];
  });
  $("#request-dialog-label").textContent = request
    ? `BOOKING R${id}`
    : "NEW BOOKING";
  $("#request-dialog-title").textContent = request
    ? "Fine-tune this booking."
    : "Make room for a new arrival.";
  $("#delete-request").classList.toggle("hidden", !request);
  requestPreview();
  openDialog("#request-dialog");
}

async function saveState(
  requests = station.requests,
  settings = station.settings,
) {
  const nextState = await api("/api/state", {
    method: "PUT",
    body: JSON.stringify({ revision: station.revision, requests, settings }),
  });
  invalidate(nextState, "Changes saved. Optimize to update the schedule.");
}

async function optimize() {
  const algorithm = $("#algorithm").value;
  activeRun = await api("/api/optimize", {
    method: "POST",
    body: JSON.stringify({ revision: station.revision, algorithm }),
  });
  shownMethod = activeRun.selected.algorithm;
  renderStation();
  notify(
    `${activeRun.selected.exact ? "Optimal schedule" : "Schedule"} ready. ${activeRun.selected.accepted} sessions, ${money(activeRun.selected.profit_inr)} profit.`,
  );
}

async function loadHistory() {
  savedRuns = await api("/api/runs");
  for (const id of comparedRuns)
    if (!savedRuns.some((run) => run.id === id)) comparedRuns.delete(id);
  renderHistory();
}

function renderHistory() {
  const filter = $("#history-filter").value;
  const exact = (run) =>
    ![
      "First come, first served",
      "Highest profit",
      "Profit per minute",
      "Earliest finish",
    ].includes(run.name);
  const runs = savedRuns
    .filter(
      (run) =>
        filter === "all" || (filter === "exact" ? exact(run) : !exact(run)),
    )
    .sort((a, b) =>
      $("#history-sort").value === "profit"
        ? b.profit_inr - a.profit_inr
        : new Date(b.created) - new Date(a.created),
    );
  $("#history-content").innerHTML = runs.length
    ? `<div class="history-list">${runs.map((run) => `<article class="run-card"><input type="checkbox" data-compare="${run.id}" aria-label="Select ${escapeHTML(run.name)} run from ${escapeHTML(new Date(run.created).toLocaleString("en-IN"))} for comparison" ${comparedRuns.has(run.id) ? "checked" : ""}><div><h3>${escapeHTML(run.name)}</h3><p><time datetime="${run.created}">${escapeHTML(new Date(run.created).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</time> · Revision ${run.revision} · ${run.ports} ports</p></div><div class="run-card-profit"><strong>${money(run.profit_inr)}</strong><small>${run.accepted} sessions served</small></div><button class="history-open" type="button" data-run="${run.id}">Inspect run</button></article>`).join("")}</div>`
    : '<div class="empty-state"><span class="empty-icon">◷</span><h3>No saved runs here yet.</h3><p>Optimize a day or change the method filter to see your saved decisions.</p></div>';
  $("#compare-count").textContent = `${comparedRuns.size}/2`;
  $("#compare-runs").disabled = comparedRuns.size !== 2;
}

async function compareSavedRuns() {
  const runs = await Promise.all(
    [...comparedRuns].map((id) => api(`/api/runs/${id}`)),
  );
  if (runs.length !== 2) return;
  const demandKey = (run) =>
    JSON.stringify(
      [...run.requests]
        .sort((a, b) => a.request_id - b.request_id)
        .map((request) => [
          request.request_id,
          request.arrival_min,
          request.duration_min,
          request.energy_kwh,
          request.surge_mult,
        ]),
    );
  const sameDemand = demandKey(runs[0]) === demandKey(runs[1]);
  const rows = [
    ["Profit", ...runs.map((run) => money(run.selected.profit_inr))],
    [
      "Vehicles served",
      ...runs.map((run) => `${run.selected.accepted} / ${run.requests.length}`),
    ],
    ["Ports", ...runs.map((run) => run.settings.ports)],
    [
      "Utilization",
      ...runs.map((run) => `${run.selected.utilization.toFixed(1)}%`),
    ],
    ["Tariff / kWh", ...runs.map((run) => money(run.settings.tariff))],
    ["Revision", ...runs.map((run) => run.revision)],
  ];
  $("#history-comparison").innerHTML =
    `<p class="comparison-note">${sameDemand ? "Both runs use the same request set. Compare the effect of their settings and scheduling method." : "These runs use different request sets. Treat their outcomes as separate planning scenarios."}</p><table class="data-table run-comparison-table"><thead><tr><th>Metric</th>${runs.map((run) => `<th>${escapeHTML(run.selected.name)}</th>`).join("")}</tr></thead><tbody>${rows.map(([label, ...values]) => `<tr><td>${label}</td>${values.map((value) => `<td><strong>${value}</strong></td>`).join("")}</tr>`).join("")}<tr><td>Schedule</td>${runs.map((run) => `<td><button class="button secondary small" type="button" data-run="${run.id}">Inspect run</button></td>`).join("")}</tr></tbody></table>`;
  openDialog("#history-compare-dialog");
}

function showSession(id) {
  const request = selectedResult()?.schedule.find(
    (row) => row.request_id === id,
  );
  if (!request) return;
  $("#session-details").innerHTML =
    `<div class="dialog-heading"><span class="eyebrow">ACCEPTED BOOKING</span><button type="button" class="close-button" data-close aria-label="Close dialog">×</button></div><h2>Request R${id}</h2><p>A complete session on Port ${request.port}, finishing by the driver’s strict deadline.</p><dl class="session-grid"><div><dt>Booking slot</dt><dd>${time(request.arrival_min)}–${time(request.deadline_min)}</dd></div><div><dt>Duration</dt><dd>${request.duration_min} minutes</dd></div><div><dt>Energy</dt><dd>${request.energy_kwh.toFixed(1)} kWh</dd></div><div><dt>Surge</dt><dd>${request.surge_mult.toFixed(2)}×</dd></div><div><dt>Net profit</dt><dd>${money(request.profit_inr)}</dd></div><div><dt>Port assignment</dt><dd>Port ${String(request.port).padStart(2, "0")}</dd></div></dl><button class="button secondary" type="button" data-close>Back to schedule</button>`;
  openDialog("#session-dialog");
}

function chart(rows, series, valueKey, xLabel, valueLabel) {
  const width = 900,
    height = 280,
    left = 75,
    right = 30,
    top = 25,
    bottom = 45;
  const maximum =
    Math.max(1, ...rows.flatMap((row) => series.map((item) => row[item.key]))) *
    1.1;
  const x = (index) =>
    left + (index / (rows.length - 1)) * (width - left - right);
  const y = (value) => top + (1 - value / maximum) * (height - top - bottom);
  let content = `<svg class="lab-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(valueLabel)} by ${escapeHTML(xLabel)}"><title>${escapeHTML(valueLabel)} by ${escapeHTML(xLabel)}. Data is also available in the table below.</title>`;
  for (let i = 0; i <= 4; i++) {
    const value = (maximum * i) / 4;
    content += `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#e5ecf6"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${maximum > 100 ? integer(Math.round(value)) : value.toFixed(1)}</text>`;
  }
  rows.forEach((row, i) => {
    content += `<text x="${x(i)}" y="${height - 16}" text-anchor="middle">${row[valueKey]}</text>`;
  });
  series.forEach((item) => {
    content += `<polyline fill="none" stroke="${item.color}" stroke-width="2.5" points="${rows.map((row, i) => `${x(i)},${y(row[item.key])}`).join(" ")}"/>`;
    rows.forEach((row, i) => {
      content += `<circle cx="${x(i)}" cy="${y(row[item.key])}" r="4" fill="${item.color}"><title>${row[valueKey]} ${escapeHTML(xLabel)}: ${row[item.key].toFixed(2)} ${escapeHTML(valueLabel)}</title></circle>`;
    });
  });
  return (
    content +
    '</svg><div class="lab-chart-legend">' +
    series
      .map(
        (item) =>
          `<span><i style="background:${item.color}"></i>${item.label}</span>`,
      )
      .join("") +
    "</div>"
  );
}

$$("[data-view]").forEach((button) =>
  button.addEventListener("click", () => setView(button.dataset.view, true)),
);
for (let n = 1; n <= 32; n++)
  $("#ports").add(new Option(`${n} port${n === 1 ? "" : "s"}`, n));
$("#ports").addEventListener("change", (event) =>
  action(null, async () => {
    const ports = Number(event.target.value);
    try {
      await saveState(station.requests, { ...station.settings, ports });
    } finally {
      $("#ports").value = station.settings.ports;
    }
  }),
);
$("#optimize").addEventListener("click", () =>
  action($("#optimize"), async () => {
    await optimize();
    if (currentView === "overview") setView("schedule", true);
  }),
);
$("#open-generate").addEventListener("click", () =>
  openDialog("#generate-dialog"),
);
function openSettings() {
  if (!station) return;
  const form = $("#settings-form");
  form.elements.tariff.value = station.settings.tariff;
  form.elements.energy_cost.value = station.settings.energy_cost;
  openDialog("#settings-dialog");
}
$("#settings-shortcut").addEventListener("click", openSettings);
document.addEventListener("click", (event) => {
  const close = event.target.closest("[data-close]");
  if (close) close.closest("dialog").close();
  const edit = event.target.closest("[data-edit]");
  if (edit && !busy) editRequest(Number(edit.dataset.edit));
  const session = event.target.closest("[data-session]");
  if (session) showSession(Number(session.dataset.session));
  const hub = event.target.closest("[data-hub]");
  if (hub) selectHub(hub.dataset.hub);
  if (event.target.closest("[data-cancel-hub]")) {
    confirmingHub = false;
    renderHubs();
  }
  const load = event.target.closest("[data-load-hub]");
  if (load && !busy) {
    if (station.source.kind !== "synthetic" && !confirmingHub) {
      confirmingHub = true;
      renderHubs();
    } else
      action(load, async () => {
        await loadHub(load.dataset.loadHub);
        setView("schedule", true);
      });
  }
  const history = event.target.closest("[data-run]");
  if (history)
    action(history, async () => {
      history.closest("dialog")?.close();
      activeRun = await api(`/api/runs/${history.dataset.run}`);
      shownMethod = activeRun.selected.algorithm;
      renderResults();
      renderRequestTable();
      setView("schedule", true);
    });
});
document.addEventListener("keydown", (event) => {
  const session = event.target.closest?.("[data-session]");
  if (session && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    showSession(Number(session.dataset.session));
  }
  const hub = event.target.closest?.("[data-hub]");
  if (hub && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    selectHub(hub.dataset.hub);
    $(`[data-hub="${hub.dataset.hub}"]`)?.focus();
  }
});
$$("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  }),
);
$("#generate-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  action(form.querySelector("[type=submit]"), async () => {
    const next = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        revision: station.revision,
        settings: station.settings,
        count: Number(values.count),
        seed: Number(values.seed),
        max_surge: Number(values.max_surge),
      }),
    });
    invalidate(next, "A fresh charging day is ready.");
    $("#generate-dialog").close();
  });
});
$("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  action(form.querySelector("[type=submit]"), async () => {
    await saveState(station.requests, {
      ...station.settings,
      tariff: Number(form.elements.tariff.value),
      energy_cost: Number(form.elements.energy_cost.value),
    });
    $("#settings-dialog").close();
  });
});
$("#add-request").addEventListener("click", () => editRequest());
$("#request-form").addEventListener("input", requestPreview);
$("#request-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  action(form.querySelector("[type=submit]"), async () => {
    const [hour, minute] = form.elements.start.value.split(":").map(Number);
    const request = {
      request_id: Number(form.elements.request_id.value),
      arrival_min: hour * 60 + minute,
      duration_min: Number(form.elements.duration_min.value),
      energy_kwh: Number(form.elements.energy_kwh.value),
      surge_mult: Number(form.elements.surge_mult.value),
    };
    if (request.arrival_min + request.duration_min > 1440)
      throw new Error("The session must finish by midnight.");
    const requests = station.requests.filter(
      (row) => row.request_id !== request.request_id,
    );
    requests.push(request);
    await saveState(requests);
    $("#request-dialog").close();
  });
});
$("#delete-request").addEventListener("click", () =>
  action($("#delete-request"), async () => {
    const id = Number($("#request-form").elements.request_id.value);
    await saveState(station.requests.filter((row) => row.request_id !== id));
    $("#request-dialog").close();
  }),
);
$("#request-search").addEventListener("input", () => {
  page = 0;
  renderRequestTable();
});
$("#request-filter").addEventListener("change", () => {
  page = 0;
  renderRequestTable();
});
$("#prev-page").addEventListener("click", () => {
  page--;
  renderRequestTable();
});
$("#next-page").addEventListener("click", () => {
  page++;
  renderRequestTable();
});
$("#import-button").addEventListener("click", () => $("#csv-file").click());
$("#csv-file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  action($("#import-button"), async () => {
    if (file.size > 1000000) throw new Error("CSV must be smaller than 1 MB.");
    const next = await api(`/api/import?revision=${station.revision}`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: await file.text(),
    });
    invalidate(
      next,
      "CSV imported. Profit has been recalculated from station prices.",
    );
  }).finally(() => {
    event.target.value = "";
  });
});
$("#schedule-method").addEventListener("change", (event) => {
  shownMethod = event.target.value;
  renderResults();
  renderRequestTable();
});
$("#export-schedule").addEventListener("click", () => {
  if (!activeRun) return;
  const result = selectedResult();
  const selected = new Map(
    result.schedule.map((row) => [row.request_id, row.port]),
  );
  const fields = [
    "request_id",
    "arrival_min",
    "duration_min",
    "deadline_min",
    "energy_kwh",
    "surge_mult",
    "profit_inr",
    "status",
    "port",
  ];
  const rows = activeRun.requests.map((row) => ({
    ...row,
    status: selected.has(row.request_id) ? "accepted" : "rejected",
    port: selected.get(row.request_id) || "",
  }));
  const csv = [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => row[field]).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `volt-${result.algorithm}-schedule.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function selectLab(tab) {
  $$("[data-lab]").forEach((item) => {
    const selected = item.dataset.lab === tab;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  ["trace", "verify", "sensitivity", "benchmark"].forEach((key) =>
    $(`#lab-${key}`).classList.toggle("hidden", key !== tab),
  );
}
$$("[data-lab]").forEach((button) =>
  button.addEventListener("click", () => selectLab(button.dataset.lab)),
);
$(".lab-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = $$("[data-lab]");
  const current = tabs.indexOf(document.activeElement);
  if (current < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[next].focus();
  selectLab(tabs[next].dataset.lab);
});
$("#worked-example").addEventListener("click", () =>
  action($("#worked-example"), async () => {
    const next = await api("/api/example", {
      method: "POST",
      body: JSON.stringify({ revision: station.revision }),
    });
    invalidate(next);
    $("#algorithm").value = "dp";
    await optimize();
    selectLab("trace");
  }),
);
$("#verify-button").addEventListener("click", () =>
  action($("#verify-button"), async () => {
    const result = await api("/api/lab/verify", { method: "POST" });
    $("#verify-result").innerHTML =
      `<div class="verification-success"><span>✓</span><div><h3>${result.passed} checks. All passed.</h3><p>Every exact answer agreed with an independent method.</p></div></div><div class="verify-checks"><span>✓ ${result.checks.search} branch-and-bound checks</span><span>✓ ${result.checks.subsets} subset checks</span><span>✓ ${result.checks.dp_vs_flow} DP / flow checks</span></div><p class="footnote">These checks verify algorithm agreement on seeded cases; they are not a proof. The correctness arguments are in ALGORITHMS.md.</p>`;
  }),
);
$("#sensitivity-button").addEventListener("click", () =>
  action($("#sensitivity-button"), async () => {
    const rows = await api("/api/lab/sensitivity", { method: "POST" });
    labRevision = station.revision;
    $("#sensitivity-result").innerHTML =
      chart(
        rows,
        [
          { key: "optimal", label: "Optimal", color: "#557bc9" },
          { key: "fcfs", label: "FCFS", color: "#c9ab62" },
        ],
        "ports",
        "ports",
        "profit / ₹",
      ) +
      `<table class="data-table"><thead><tr><th>Ports</th><th>Optimal / ₹</th><th>FCFS / ₹</th><th>Extra optimal profit / ₹</th></tr></thead><tbody>${rows.map((row, i) => `<tr><td>${row.ports}</td><td>${money(row.optimal)}</td><td>${money(row.fcfs)}</td><td>${i ? money(row.optimal - rows[i - 1].optimal) : "—"}</td></tr>`).join("")}</tbody></table><p class="footnote">Station revision ${labRevision}. Same fixed slots and prices; one day, not a statistical average.</p>`;
  }),
);
$("#benchmark-button").addEventListener("click", () =>
  action($("#benchmark-button"), async () => {
    const rows = await api("/api/lab/benchmark", { method: "POST" });
    $("#benchmark-result").innerHTML =
      chart(
        rows,
        [
          { key: "dp", label: "DP · 1 port", color: "#557bc9" },
          { key: "flow", label: "Flow · 4 ports", color: "#8d87bc" },
          { key: "fcfs", label: "FCFS · 4 ports", color: "#c9ab62" },
        ],
        "n",
        "requests",
        "runtime / ms",
      ) +
      `<table class="data-table"><thead><tr><th>Requests</th><th>DP / ms</th><th>Flow / ms</th><th>FCFS / ms</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${integer(row.n)}</td><td>${row.dp.toFixed(3)}</td><td>${row.flow.toFixed(3)}</td><td>${row.fcfs.toFixed(3)}</td></tr>`).join("")}</tbody></table><p class="footnote">Best of three solver-only wall-clock measurements. Graph construction and traceback are included; port assignment, HTTP and rendering are excluded. Input seeds = 90000 + n.</p>`;
  }),
);
$("#refresh-history").addEventListener("click", () =>
  action($("#refresh-history"), loadHistory),
);

// Guided tour: a spotlight and a step card, shown once per browser and
// replayable from the ? button. Positions are measured only when a step
// opens or the window scrolls/resizes; nothing runs in the background.
const tourSteps = [
  {
    view: "overview",
    title: "Welcome to Volt",
    text: "Volt decides which charging bookings a station should accept and which port each car uses, so the day earns the most profit. This short guide shows you where everything is.",
  },
  {
    view: "overview",
    target: "#hub-map",
    title: "Pick a charging hub",
    text: "Each dot is a hub in Delhi NCR with its own ports and demand. Click one to see its optimal profit, gain over first come, first served and utilization.",
  },
  {
    view: "overview",
    target: "#hub-detail",
    title: "Load it into the console",
    text: "Press “Load this hub”. Volt replaces the current demand with that hub’s day, optimizes it and opens Port Schedule.",
  },
  {
    view: "overview",
    target: ".heading-actions",
    title: "Generate or optimize",
    text: "Make a fresh synthetic day, or run the optimizer again after you change ports, prices or requests.",
  },
  {
    view: "overview",
    target: "#planning-controls",
    title: "Plan setup",
    text: "Open this to change the number of ports or choose a method: dynamic programming, minimum-cost flow, the greedy rules or brute force.",
  },
  {
    view: "schedule",
    target: ".metric-grid",
    title: "Read the result",
    text: "Port Schedule starts with the day’s profit, the gain over first come, first served, vehicles served and port utilization.",
  },
  {
    view: "schedule",
    target: "#timeline",
    title: "Every car is a booking",
    text: "Each row is a charging port. A bay spans the booked slot and the car parks at its arrival time. Click any car for its energy, surge and profit, or use Focus to show one port.",
  },
  {
    view: "schedule",
    target: ".algorithm-comparison",
    title: "Compare the algorithms",
    text: "Expand this to see how the four greedy rules score against the exact optimum on the same day.",
  },
  {
    view: "requests",
    target: '[data-view="requests"]',
    title: "Requests",
    text: "Search, sort, edit or add bookings, or import your own CSV. Any change clears the old schedule until you optimize again.",
  },
  {
    view: "lab",
    target: '[data-view="lab"]',
    title: "Algo Lab",
    text: "Step through the DP table or the flow augmentations, then run correctness checks, port sensitivity and runtime benchmarks on the real solvers.",
  },
  {
    view: "history",
    target: '[data-view="history"]',
    title: "Run History",
    text: "Your last 30 runs are saved locally with their inputs. Inspect one, or tick two and compare them side by side.",
  },
  {
    view: "overview",
    target: "#tour-button",
    title: "You’re ready",
    text: "Start with a hub on the map. You can replay this guide any time from the ? button.",
  },
];
let tourIndex = -1;
let tourFrame = 0;
const tourStorageKey = "volt-tour-complete";

function tourSeen() {
  try {
    return window.localStorage.getItem(tourStorageKey) === "1";
  } catch {
    return true;
  }
}

function startTour() {
  if (tourIndex >= 0) return;
  for (const dialog of $$("dialog[open]")) dialog.close();
  const layer = document.createElement("div");
  layer.className = "tour-layer";
  layer.innerHTML =
    '<div class="tour-spotlight" aria-hidden="true"></div><div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text"><div class="tour-top"><span class="eyebrow" id="tour-progress"></span><button type="button" class="tour-skip" data-tour="end">Skip guide</button></div><h2 id="tour-title"></h2><p id="tour-text"></p><div class="tour-dots" aria-hidden="true"></div><div class="tour-actions"><button type="button" class="button secondary small" data-tour="back">Back</button><button type="button" class="button primary small" data-tour="next">Next</button></div></div>';
  document.body.append(layer);
  layer.querySelector(".tour-dots").innerHTML = tourSteps
    .map(() => "<i></i>")
    .join("");
  tourIndex = 0;
  showTourStep();
}

function endTour() {
  if (tourIndex < 0) return;
  tourIndex = -1;
  $(".tour-layer")?.remove();
  try {
    window.localStorage.setItem(tourStorageKey, "1");
  } catch {}
  $("#tour-button").focus();
}

function showTourStep() {
  const step = tourSteps[tourIndex];
  if (currentView !== step.view) setView(step.view);
  const last = tourIndex === tourSteps.length - 1;
  $("#tour-progress").textContent =
    `STEP ${tourIndex + 1} OF ${tourSteps.length}`;
  $("#tour-title").textContent = step.title;
  $("#tour-text").textContent = step.text;
  $$(".tour-dots i").forEach((dot, i) =>
    dot.classList.toggle("active", i === tourIndex),
  );
  $('[data-tour="back"]').disabled = tourIndex === 0;
  $('[data-tour="next"]').textContent = last ? "Start exploring" : "Next";
  const target = step.target && $(step.target);
  target?.scrollIntoView?.({ block: "center", behavior: "auto" });
  placeTour();
  $('[data-tour="next"]').focus();
}

function placeTour() {
  const layer = $(".tour-layer");
  if (!layer) return;
  const step = tourSteps[tourIndex];
  const card = layer.querySelector(".tour-card");
  const spot = layer.querySelector(".tour-spotlight");
  const target = step.target && $(step.target);
  const box = target?.getBoundingClientRect();
  const width = window.innerWidth,
    height = window.innerHeight;
  const cardWidth = Math.min(360, width - 32);
  const cardHeight = card.offsetHeight || 230;
  card.style.width = `${cardWidth}px`;
  if (!box || !box.width) {
    Object.assign(spot.style, {
      top: `${height / 2}px`,
      left: `${width / 2}px`,
      width: "0px",
      height: "0px",
    });
    card.style.left = `${(width - cardWidth) / 2}px`;
    card.style.top = `${Math.max(16, (height - cardHeight) / 2)}px`;
    return;
  }
  const pad = 8;
  const top = Math.max(8, box.top - pad),
    bottom = Math.min(height - 8, box.bottom + pad);
  Object.assign(spot.style, {
    top: `${top}px`,
    left: `${box.left - pad}px`,
    width: `${box.width + pad * 2}px`,
    height: `${Math.max(0, bottom - top)}px`,
  });
  let cardTop = bottom + 14;
  if (cardTop + cardHeight > height - 12) cardTop = top - 14 - cardHeight;
  if (cardTop < 12) cardTop = Math.max(12, height - cardHeight - 16);
  card.style.top = `${cardTop}px`;
  card.style.left = `${Math.min(
    Math.max(16, box.left + box.width / 2 - cardWidth / 2),
    width - cardWidth - 16,
  )}px`;
}

function moveTour(delta) {
  const next = tourIndex + delta;
  if (next < 0) return;
  if (next >= tourSteps.length) return endTour();
  tourIndex = next;
  showTourStep();
}

$("#tour-button").addEventListener("click", startTour);
document.addEventListener("click", (event) => {
  const control = event.target.closest("[data-tour]");
  if (!control) return;
  const kind = control.dataset.tour;
  if (kind === "end") endTour();
  else moveTour(kind === "next" ? 1 : -1);
});
document.addEventListener("keydown", (event) => {
  if (tourIndex < 0) return;
  if (event.key === "Escape") {
    event.preventDefault();
    endTour();
  } else if (event.key === "ArrowRight") moveTour(1);
  else if (event.key === "ArrowLeft") moveTour(-1);
  else if (event.key === "Tab") {
    const controls = $$(".tour-card button:not(:disabled)");
    const index = controls.indexOf(document.activeElement);
    event.preventDefault();
    controls[
      (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
    ]?.focus();
  }
});
["resize", "scroll"].forEach((type) =>
  window.addEventListener(
    type,
    () => {
      if (tourIndex < 0 || tourFrame) return;
      tourFrame = requestAnimationFrame(() => {
        tourFrame = 0;
        placeTour();
      });
    },
    { passive: true },
  ),
);

async function initialize() {
  try {
    station = await api("/api/state");
    const runs = await api("/api/runs");
    const latest = runs.find((run) => run.revision === station.revision);
    if (latest) {
      activeRun = await api(`/api/runs/${latest.id}`);
      shownMethod = activeRun.selected.algorithm;
    }
    renderStation();
    const view = window.location.hash.slice(1);
    setView(
      ["overview", "schedule", "requests", "lab", "history"].includes(view)
        ? view
        : "overview",
    );
    if (!activeRun) await action($("#optimize"), optimize);
    if (!tourSeen()) startTour();
  } catch (error) {
    $("#connection-state").textContent = "Connection lost";
    notify(`Could not load Volt. ${error.message}`, true);
  }
}
$("#algorithm").addEventListener("change", () => {
  $("#plan-summary").textContent =
    `${station.settings.ports} port${station.settings.ports === 1 ? "" : "s"} · ${$("#algorithm").selectedOptions[0].textContent.split(" · ")[0]}`;
});
$("#timeline-port").addEventListener("change", (event) => {
  timelinePort = event.target.value;
  const result = selectedResult();
  if (result) drawTimeline(result);
});
$("#request-sort").addEventListener("change", () => {
  page = 0;
  renderRequestTable();
});
$("#history-filter").addEventListener("change", renderHistory);
$("#history-sort").addEventListener("change", renderHistory);
$("#compare-runs").addEventListener("click", () =>
  action($("#compare-runs"), compareSavedRuns),
);
document.addEventListener("input", (event) => {
  if (event.target.id === "trace-step") updateTraceStep(event.target.value);
});
document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-compare]");
  if (!checkbox) return;
  if (checkbox.checked && comparedRuns.size >= 2) {
    checkbox.checked = false;
    notify("Choose two runs at a time.");
    return;
  }
  if (checkbox.checked) comparedRuns.add(checkbox.dataset.compare);
  else comparedRuns.delete(checkbox.dataset.compare);
  $("#compare-count").textContent = `${comparedRuns.size}/2`;
  $("#compare-runs").disabled = comparedRuns.size !== 2;
});
initialize();
