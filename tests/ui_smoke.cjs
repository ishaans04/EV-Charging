const assert = require("node:assert/strict");
const { JSDOM, VirtualConsole } = require("../.qa/node_modules/jsdom");
const base = process.env.VOLT_TEST_URL || "http://127.0.0.1:8000";
const errors = [];
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
  return JSDOM.fromURL(`${base}${path}`, {
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
}

async function main() {
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
  $("#history-content [data-run]").click();
  await waitFor(
    () => idle() && !$("#view-overview").classList.contains("hidden"),
    "history inspector",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  dom.window.close();
  console.log(
    "UI integration passed: landing toggle, initialization, generation, request editing, DP trace, session inspector, port change, flow, verification, sensitivity, benchmark, history.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
