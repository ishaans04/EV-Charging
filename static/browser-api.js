// GitHub Pages build only. Answers the console's /api/... calls inside the
// browser: Python (evsched.py, volt_service.py) runs in a Web Worker and each
// visitor's station and saved runs live in their own IndexedDB.
(() => {
  const version =
    new URL(document.currentScript.src).searchParams.get("v") || "dev";
  const worker = new Worker(
    new URL(`py-worker.js?v=${version}`, document.currentScript.src),
  );
  const pending = new Map();
  let nextId = 0;
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(JSON.parse(data.result));
  };
  worker.onerror = (event) => {
    for (const job of pending.values())
      job.reject(new Error(event.message || "The solver stopped."));
    pending.clear();
  };
  const python = (op, payload) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, payload });
    });

  // Loading panel while Python downloads (first visit) or starts (cached).
  const overlay = document.createElement("div");
  overlay.className = "boot-overlay";
  overlay.setAttribute("role", "status");
  overlay.innerHTML =
    '<div class="boot-card"><span class="boot-spinner" aria-hidden="true"></span><strong>Starting the solver…</strong><small>Loading Python in your browser. The first visit takes a few seconds; later visits are faster.</small></div>';
  const showOverlay = () => {
    if (!overlay.isConnected) document.body.append(overlay);
  };
  const ready = python("ping").then(
    () => overlay.remove(),
    (error) => {
      showOverlay();
      overlay.querySelector(".boot-card").innerHTML =
        `<strong>Could not start the solver.</strong><small>${String(error.message).slice(0, 160)}. Check your connection and reload.</small><button type="button" class="button primary small" onclick="location.reload()">Reload</button>`;
      throw error;
    },
  );
  const slow = setTimeout(showOverlay, 250);
  ready.finally(() => clearTimeout(slow)).catch(() => {});

  // IndexedDB: one record for the station, one store for saved runs.
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open("volt", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("kv");
      request.result.createObjectStore("runs", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const store = async (name, mode, work) => {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(name, mode);
      const result = work(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error);
    });
  };
  const getState = () => store("kv", "readonly", (s) => s.get("state"));
  const putState = (state) =>
    store("kv", "readwrite", (s) => s.put(state, "state"));
  const allRuns = async () =>
    (await store("runs", "readonly", (s) => s.getAll())).sort((a, b) =>
      b.created.localeCompare(a.created),
    );

  async function call(op, payload) {
    await ready;
    const reply = await python(op, payload);
    if (!reply.ok) throw Object.assign(new Error(reply.detail), reply);
    return reply.data;
  }
  async function station() {
    const saved = await getState();
    if (saved) return saved;
    const state = await call("initial");
    await putState(state);
    return state;
  }
  let hubCache = { key: null, data: null };

  async function route(path, options) {
    const url = new URL(path, location.href);
    const method = (options.method || "GET").toUpperCase();
    const body =
      typeof options.body === "string" && url.pathname !== "/api/import"
        ? JSON.parse(options.body)
        : {};
    const at = (route) => url.pathname === route;
    if (at("/api/health")) return { status: "ok", app: "Volt" };
    if (at("/api/state") && method === "GET") return station();
    if (
      (at("/api/state") && method === "PUT") ||
      at("/api/generate") ||
      at("/api/example") ||
      at("/api/import")
    ) {
      const state = await station();
      const op = at("/api/state")
        ? "update"
        : at("/api/generate")
          ? "generate"
          : at("/api/example")
            ? "example"
            : "import";
      const next = await call(
        op,
        op === "import"
          ? {
              state,
              revision: Number(url.searchParams.get("revision")),
              text: options.body,
            }
          : { state, body },
      );
      await putState(next);
      return next;
    }
    if (at("/api/optimize")) {
      const run = await call("optimize", { state: await station(), body });
      await store("runs", "readwrite", (s) => s.put(run));
      const old = (await allRuns()).slice(30);
      if (old.length)
        await store("runs", "readwrite", (s) =>
          old.forEach((r) => s.delete(r.id)),
        );
      return run;
    }
    if (at("/api/runs"))
      return (await allRuns()).map((run) => ({
        id: run.id,
        created: run.created,
        revision: run.revision,
        profit_inr: run.selected.profit_inr,
        name: run.selected.name,
        accepted: run.selected.accepted,
        ports: run.settings.ports,
      }));
    const runPath = url.pathname.match(/^\/api\/runs\/([0-9a-f]+)(\/export)?$/);
    if (runPath) {
      const run = await store("runs", "readonly", (s) => s.get(runPath[1]));
      if (!run) throw Object.assign(new Error("Schedule not found"), { status: 404 });
      return run;
    }
    if (at("/api/hubs")) {
      const { settings } = await station();
      const key = `${settings.tariff}/${settings.energy_cost}`;
      if (hubCache.key !== key)
        hubCache = { key, data: await call("hubs", { settings }) };
      return hubCache.data;
    }
    if (at("/api/lab/sensitivity"))
      return call("sensitivity", { state: await station() });
    if (at("/api/lab/verify")) return call("verify");
    if (at("/api/lab/benchmark")) return call("benchmark");
    if (at("/api/algorithms")) return call("algorithms");
    throw Object.assign(new Error("Not found"), { status: 404 });
  }

  // Operations run one at a time, like requests to a single server.
  let queue = Promise.resolve();
  window.voltLocalApi = (path, options = {}) => {
    const result = queue.then(() => route(path, options));
    queue = result.catch(() => {});
    return result.then(
      (data) => ({ status: 200, data }),
      (error) => ({
        status: error.status || 500,
        data: { detail: error.detail || error.message },
      }),
    );
  };

  // The two server download links become in-browser downloads.
  const save = (text, type, name) => {
    const href = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  document.addEventListener(
    "click",
    async (event) => {
      const link = event.target.closest("a[href^='/api/']");
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      const url = new URL(link.getAttribute("href"), location.href);
      try {
        if (url.pathname === "/api/requests.csv") {
          const state = await station();
          save(await call("requests_csv", { state }), "text/csv", "volt-requests.csv");
          return;
        }
        const { data, status } = await window.voltLocalApi(url.pathname);
        if (status !== 200) throw new Error(data.detail);
        if (url.searchParams.get("format") === "json")
          save(JSON.stringify(data, null, 2), "application/json", "volt-schedule.json");
        else save(await call("run_csv", { run: data }), "text/csv", "volt-schedule.csv");
      } catch (error) {
        alert(`Download failed: ${error.message}`);
      }
    },
    true,
  );
})();
