"""The one rule for typed numbers (owner 2026-10-05: «1239px + 10 = 1249px, 100px + 10% = 110px»): a plain number sets, text that starts
with + - * / works on the current value, a whole sum works, 0-10 is an exact negative. Checked in the editor (parseExpr) and in both
copies of colorgrade.js (parseEntry), run by node.

  python3 -m pytest tests/test_numbers.py
"""
import json, re, shutil, subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
CONCEPTS = HERE.parent.parent / "Concepts/html"
NODE = shutil.which("node")
# (text, current, base, expected); None = refused (the field shakes and keeps its value)
CASES = [
    ("1239", 50, 100, 1239), ("800px", 50, 100, 800), ("1239+10", 0, 100, 1249), ("1239px + 10", 0, 100, 1249), ("100+10%", 0, 100, 110),
    ("+10", 1239, 100, 1249), ("-10", 1239, 100, 1229), ("+10%", 100, 100, 110), ("-10%", 100, 100, 90), ("*2", 30, 100, 60), ("/2", 30, 100, 15),
    ("50%", 30, 4000, 2000), ("0-10", 30, 100, -10), ("−10", 30, 100, 20), ("2,5", 0, 100, 2.5), ("800/2", 0, 100, 400), ("10*3+5", 0, 100, 35),
    ("+15°", 30, 100, 45), ("++5", 10, 100, None), ("=5", 10, 100, None), ("abc", 10, 100, None), ("/0", 10, 100, None), ("", 10, 100, None),
    ("5+", 10, 100, None),
]


def js_fn(path, name):
    s = Path(path).read_text()
    m = re.search(r"^( *)function " + name + r"\(", s, re.M)
    assert m, f"{name} not in {path}"
    a = m.start(); b = s.index("\n" + m.group(1) + "}\n", a) + len(m.group(1)) + 2
    return s[a:b]


def run(fn_src, name, cases):
    prog = fn_src + f"\nconst C = {json.dumps([c[:3] for c in cases])};\nconsole.log(JSON.stringify(C.map(([t, c, b]) => {{ const v = {name}(t, c, b); return v == null || Number.isNaN(v) ? null : v; }})));"
    out = subprocess.run([NODE, "-e", prog], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.mark.skipif(not NODE, reason="no node")
@pytest.mark.parametrize("where", ["editor", "colorgrade", "concepts-colorgrade", "concepts-editor"])
def test_number_rule(where):
    path, name = {"editor": (HERE / "editor/index.html", "parseExpr"), "colorgrade": (HERE / "editor/colorgrade.js", "parseEntry"),
                  "concepts-colorgrade": (CONCEPTS / "_lib/colorgrade.js", "parseEntry"), "concepts-editor": (CONCEPTS / "editor-a/index.html", "parseExpr")}[where]
    if not path.is_file(): pytest.skip(f"no {path}")
    got = run(js_fn(path, name), name, CASES)
    for (t, c, b, want), g in zip(CASES, got):
        assert (g is None and want is None) or (g is not None and want is not None and abs(g - want) < 1e-9), (where, t, c, b, want, g)
