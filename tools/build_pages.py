"""Build the GitHub Pages site: the same pages and assets as the server, with
relative links, plus the Python modules the browser runs through Pyodide.

    python tools/build_pages.py            # writes _site/
    python -m http.server -d _site 8080    # preview at http://localhost:8080
"""

import argparse
from hashlib import sha256
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PYTHON_MODULES = ("evsched.py", "run_experiments.py", "volt_service.py")


def relative(markup, version, assets):
    for name in assets:
        markup = markup.replace(f'"/static/{name}"', f'"static/{name}?v={version}"')
    return (markup.replace('"/static/', '"static/')
            .replace('href="/console"', 'href="console.html"')
            .replace('href="/"', 'href="./"'))


def build(output):
    output = Path(output)
    if output.exists():
        shutil.rmtree(output)
    static = ROOT / "static"
    shutil.copytree(static, output / "static")
    (output / "py").mkdir()
    for name in PYTHON_MODULES:
        shutil.copy2(ROOT / name, output / "py" / name)
    digest = sha256()
    for path in sorted([*static.iterdir(), *(ROOT / name for name in PYTHON_MODULES)]):
        if path.is_file():
            digest.update(path.name.encode() + path.read_bytes())
    version = digest.hexdigest()[:12]

    landing = (static / "index.html").read_text(encoding="utf-8")
    (output / "index.html").write_text(
        relative(landing, version, ("style.css", "landing.js")), encoding="utf-8")

    console = (static / "console.html").read_text(encoding="utf-8")
    script = '<script src="/static/console.js" defer></script>'
    if script not in console:
        raise SystemExit("console.html no longer loads console.js as expected")
    console = console.replace(
        script, '<script src="/static/browser-api.js" defer></script>\n    ' + script)
    (output / "console.html").write_text(
        relative(console, version, ("style.css", "console.css", "browser-api.js", "console.js")),
        encoding="utf-8")
    (output / ".nojekyll").write_text("", encoding="utf-8")
    return version


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", default=ROOT / "_site")
    args = parser.parse_args()
    print(f"Built {args.output} (version {build(args.output)})")
