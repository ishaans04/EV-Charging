// Runs Volt's Python modules in a background thread for the GitHub Pages
// build. Pyodide (CPython compiled to WebAssembly) is cached by the browser
// after the first visit; nothing is installed on the visitor's computer.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
const MODULES = ["evsched.py", "run_experiments.py", "volt_service.py"];

importScripts(`${PYODIDE}pyodide.js`);

const ready = (async () => {
  const pyodide = await loadPyodide({ indexURL: PYODIDE });
  const version = new URL(self.location.href).searchParams.get("v") || "";
  for (const name of MODULES) {
    const response = await fetch(new URL(`../py/${name}?v=${version}`, self.location.href));
    if (!response.ok) throw new Error(`Could not load ${name} (${response.status})`);
    pyodide.FS.writeFile(`/home/pyodide/${name}`, await response.text());
  }
  pyodide.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  return pyodide.pyimport("volt_service").browser_call;
})();

self.onmessage = async ({ data: { id, op, payload } }) => {
  try {
    const call = await ready;
    if (op === "ping") return self.postMessage({ id, result: '{"ok": true, "data": null}' });
    self.postMessage({ id, result: call(op, JSON.stringify(payload ?? {})) });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
