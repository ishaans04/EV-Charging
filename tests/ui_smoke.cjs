const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("../.qa/node_modules/jsdom");
const base = process.env.VOLT_TEST_URL || "http://127.0.0.1:8000";
const errors = [];
const pages = [];
let ownedServer;
let serverOutput = "";
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(error.message));

async function waitFor(predicate, message, timeout = 15000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout)
      throw new Error(`Timed out: ${message}; ${errors.join("; ")}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function open(path) {
  const dom = await JSDOM.fromURL(`${base}${path}`, {
    resources: "usable",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = (url, options) => fetch(new URL(url, base), options);
      window.HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute("open", "");
      };
      window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute("open");
      };
    },
  });
  pages.push(dom);
  return dom;
}

async function main() {
  if (process.env.VOLT_TEST_START_SERVER === "1") {
    const root = path.resolve(__dirname, "..");
    ownedServer = spawn(
      process.env.VOLT_PYTHON || "python",
      ["app.py", "--port", new URL(base).port || "8000"],
      {
        cwd: root,
        env: {
          ...process.env,
          VOLT_DATA_DIR: path.join(root, ".qa", `ui-station-${process.pid}`),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    ownedServer.stdout.on("data", (chunk) => {
      serverOutput += chunk;
    });
    ownedServer.stderr.on("data", (chunk) => {
      serverOutput += chunk;
    });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (ownedServer.exitCode !== null)
        throw new Error(`Test server exited: ${serverOutput}`);
      try {
        ready = (await fetch(`${base}/api/health`)).ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready)
      throw new Error(`Test server did not become ready: ${serverOutput}`);
  }
  const landing = await open("/");
  await waitFor(
    () => landing.window.document.readyState === "complete",
    "landing load",
  );
  landing.window.document.querySelector('[data-demo="fcfs"]').click();
  assert.equal(
    landing.window.document.querySelector("#demo-profit").textContent,
    "₹170",
  );
  landing.window.document.querySelector('[data-demo="optimal"]').click();
  assert.equal(
    landing.window.document.querySelector("#demo-profit").textContent,
    "₹240",
  );
  landing.window.close();
  const dom = await open("/console");
  const window = dom.window;
  const $ = (selector) => window.document.querySelector(selector);
  const idle = () => !window.document.body.hasAttribute("aria-busy");
  const submit = (selector) =>
    $(selector).dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
  await waitFor(
    () =>
      $("#connection-state").textContent === "Saved locally" &&
      $("#metric-profit").textContent !== "—" &&
      idle(),
    "initial optimization",
  );
  assert.ok($("#timeline .slot"));
  assert.equal($(".sidebar"), null);
  assert.equal($(".sidebar-note"), null);
  assert.equal(
    $(".console-topbar .console-nav").querySelectorAll("[data-view]").length,
    4,
  );
  assert.equal($(".planning-settings").open, false);
  assert.equal($(".algorithm-comparison").open, false);
  assert.ok($("#request-rows").querySelectorAll("tr").length <= 10);
  $("#timeline-port").value = "1";
  $("#timeline-port").dispatchEvent(
    new window.Event("change", { bubbles: true }),
  );
  assert.ok(
    [...window.document.querySelectorAll("#timeline .slot")].every((slot) =>
      slot.getAttribute("aria-label").endsWith("Port 1"),
    ),
  );
  $("#timeline-port").value = "all";
  $("#timeline-port").dispatchEvent(
    new window.Event("change", { bubbles: true }),
  );
  assert.equal($("#schedule-method").disabled, false);
  assert.equal($("#export-schedule").disabled, false);
  $("#open-generate").click();
  assert.equal($("#generate-dialog").open, true);
  $("#generate-form").elements.count.value = "8";
  $("#generate-form").elements.seed.value = "99";
  submit("#generate-form");
  await waitFor(
    () => idle() && !$("#generate-dialog").open,
    "generate form submission",
  );
  assert.equal($("#request-count").textContent, "8");
  assert.equal($("#metric-profit").textContent, "—");
  $('[data-view="requests"]').click();
  assert.ok($(".heading-actions").classList.contains("hidden"));
  assert.equal($("#view-requests thead").querySelectorAll("th").length, 6);
  $("#request-sort").value = "profit";
  $("#request-sort").dispatchEvent(
    new window.Event("change", { bubbles: true }),
  );
  const profits = [...$("#request-rows").querySelectorAll("tr")].map((row) =>
    Number(row.children[3].textContent.replace(/[^0-9-]/g, "")),
  );
  assert.deepEqual(
    profits,
    [...profits].sort((a, b) => b - a),
  );
  $("#add-request").click();
  $("#request-form").elements.start.value = "21:00";
  $("#request-form").elements.duration_min.value = "45";
  submit("#request-form");
  await waitFor(() => idle() && !$("#request-dialog").open, "new request");
  assert.equal($("#request-count").textContent, "9");
  $("#request-search").value = "R9";
  $("#request-search").dispatchEvent(
    new window.Event("input", { bubbles: true }),
  );
  assert.equal($("#request-rows").querySelectorAll("tr").length, 1);
  assert.match($("#request-rows").textContent, /R9/);
  $('[data-edit="9"]').click();
  $("#request-form").elements.start.value = "23:50";
  submit("#request-form");
  await waitFor(
    () => idle() && $("#request-dialog .form-error").textContent.length > 0,
    "invalid deadline feedback",
  );
  assert.equal($("#request-dialog").open, true);
  $("#request-form").elements.start.value = "21:00";
  $("#request-form").elements.energy_kwh.value = "30";
  submit("#request-form");
  await waitFor(
    () => idle() && !$("#request-dialog").open,
    "edit existing booking",
  );
  assert.match($("#request-rows").textContent, /30.0 kWh/);
  $("#settings-shortcut").click();
  $("#settings-form").elements.tariff.value = "20";
  submit("#settings-form");
  await waitFor(
    () => idle() && !$("#settings-dialog").open,
    "station repricing",
  );
  assert.match($("#request-rows").textContent, /630/);
  $('[data-edit="9"]').click();
  $("#delete-request").click();
  await waitFor(() => idle() && !$("#request-dialog").open, "request removal");
  assert.equal($("#request-count").textContent, "8");
  $("#request-search").value = "";
  $("#request-search").dispatchEvent(
    new window.Event("input", { bubbles: true }),
  );
  $('[data-view="lab"]').click();
  $('[data-lab="verify"]').click();
  $("#worked-example").click();
  await waitFor(
    () => idle() && $("#metric-profit").textContent === "₹240",
    "report worked example",
  );
  assert.equal($("#ports").value, "1");
  assert.equal($("#lab-trace").classList.contains("hidden"), false);
  assert.equal($("#trace-content").querySelectorAll("tbody tr").length, 8);
  const traceExport = await fetch(
    new URL($("#trace-content .trace-export").getAttribute("href"), base),
  );
  assert.equal((await traceExport.json()).selected.profit_inr, 240);
  assert.match($("#trace-content").textContent, /240/);
  $("#trace-step").value = "1";
  $("#trace-step").dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal($("#trace-step-value").textContent, "1 / 8");
  assert.match($("#trace-focus").textContent, /R6/);
  assert.equal($(".trace-table-details").open, false);
  $("#timeline .slot").dispatchEvent(
    new window.Event("click", { bubbles: true }),
  );
  assert.equal($("#session-dialog").open, true);
  assert.match($("#session-details").textContent, /Request R/);
  $("#session-dialog [data-close]").click();
  $("#ports").value = "2";
  $("#ports").dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(
    () => idle() && $("#metric-profit").textContent === "—",
    "port change invalidates schedule",
  );
  assert.equal($("#algorithm").value, "optimal");
  $("#optimize").click();
  await waitFor(
    () => idle() && $("#metric-profit").textContent !== "—",
    "two port flow solve",
  );
  assert.match($("#trace-title").textContent, /flow/);
  assert.ok($("#timeline .slot"));
  $('[data-lab="verify"]').click();
  $("#verify-button").click();
  await waitFor(
    () => idle() && $("#verify-result").textContent.includes("60 checks"),
    "interactive correctness",
  );
  $('[data-lab="sensitivity"]').click();
  $("#sensitivity-button").click();
  await waitFor(
    () =>
      idle() &&
      $("#sensitivity-result").querySelectorAll("tbody tr").length === 8,
    "port sensitivity",
  );
  $('[data-lab="benchmark"]').click();
  $("#benchmark-button").click();
  await waitFor(
    () =>
      idle() &&
      $("#benchmark-result").querySelectorAll("tbody tr").length === 5,
    "runtime benchmark",
  );
  $('[data-view="history"]').click();
  await waitFor(() => $("#history-content [data-run]"), "saved run history");
  const choices = [...window.document.querySelectorAll("[data-compare]")];
  assert.ok(choices.length >= 2);
  choices[0].click();
  choices[1].click();
  assert.equal($("#compare-runs").disabled, false);
  $("#compare-runs").click();
  await waitFor(
    () => idle() && $("#history-compare-dialog").open,
    "saved run comparison",
  );
  assert.match($("#history-comparison").textContent, /same request set/);
  assert.equal($("#history-comparison thead").querySelectorAll("th").length, 3);
  $("#history-compare-dialog [data-close]").click();
  $("#history-content [data-run]").click();
  await waitFor(
    () => idle() && !$("#view-overview").classList.contains("hidden"),
    "history inspector",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  dom.window.close();
  console.log(
    "UI integration passed: top navigation, port focus, request sorting and editing, DP explorer, flow, verification, sensitivity, benchmark, saved-run comparison and inspection; landing unchanged.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    if (serverOutput) console.error(serverOutput);
    process.exitCode = 1;
  })
  .finally(() => {
    pages.forEach((page) => page.window.close());
    ownedServer?.kill();
  });
