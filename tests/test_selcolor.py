"""Photoshop's Selective Color in Raw Editor (owner 2026-10-07), on a real canvas with a disposable library (Chromium and WebKit): the
WebGL pass and the JS of editor/selcolor.js give the same pixels as an independent Python reference of the maths (nine ranges, four
inks, Relative and Absolute) and the facts read off Photoshop (red keeps 255 when Reds lose cyan, grey is in no colour range, Neutrals'
Black darkens grey, Absolute moves white where Relative cannot). The section is the app's on the board and in the image studio: range
swatches, the app's signed sliders with colour tracks, Relative / Absolute, Photoshop's Russian words, its eye; it lives in the grade
(one step to undo, copied and pasted with it), the card and the studio's composite show it, the files never change.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_selcolor.py
  FRAMES_SHOTS=<folder> also saves screenshots (the section in both themes)
"""
import random, time
from pathlib import Path

import pytest

from test_grade import GRADED
from test_grade_eyes import SAME_AS
from test_imgframe import SHOTS, WEBKIT, hy, open_board, sha, shot  # noqa: F401 (hy is the fixture)
from test_select_tool import PIXELS, open_editor

ENGINES = ["chromium", "webkit"]
RANGES = ["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"]
RU = ["Красные", "Желтые", "Зеленые", "Голубые", "Синие", "Пурпурные", "Белые", "Нейтральные", "Черные"]


# ---------------------------------------------------------------- the reference, written apart from selcolor.js
def weights(c):
    r, g, b = c; mx, mn = max(c), min(c); md = sorted(c)[1]
    return {"reds": mx - md if r == mx else 0, "yellows": md - mn if b == mn else 0, "greens": mx - md if g == mx else 0,
            "cyans": md - mn if r == mn else 0, "blues": mx - md if b == mx else 0, "magentas": md - mn if g == mn else 0,
            "whites": max(0, mn - .5) * 2, "neutrals": 1 - abs(mx - .5) - abs(mn - .5), "blacks": max(0, .5 - mx) * 2}


def ref(rgb, sc):
    c = [v / 255 for v in rgb]; w = weights(c); d = [0, 0, 0]
    for k, o in sc.items():
        if k == "abs" or w[k] <= 0: continue
        ink = [max(-1, min(1, o.get(i, 0) / 100)) for i in "cmyk"]
        for ch in range(3):
            t = (-1 - ink[ch]) * ink[3] - ink[ch]
            if not sc.get("abs"): t *= 1 - c[ch]
            d[ch] += min(1 - c[ch], max(-c[ch], t)) * w[k]
    return [round(min(1, max(0, c[i] + d[i])) * 255) for i in range(3)]


def rnd_case(seed, abs_):
    r = random.Random(seed); o = {"abs": abs_}
    for k in r.sample(RANGES, 4): o[k] = {i: r.randrange(-100, 101) for i in "cmyk"}
    return o


CASES = {
    "reds-relative": {"reds": {"c": -60, "m": 20, "y": 10, "k": 15}},
    "reds-absolute": {"abs": 1, "reds": {"c": -60, "m": 20, "y": 10, "k": 15}},
    "neutrals-black": {"neutrals": {"k": 20}},
    "whites-blacks": {"abs": 1, "whites": {"c": 40, "y": -30}, "blacks": {"m": -50, "k": -40}},
    "every-range": {k: {"c": 25, "m": -25, "y": 40, "k": 10} for k in RANGES},
    "random-relative": rnd_case(3, 0),
    "random-absolute": rnd_case(4, 1),
}


def pixels():
    rnd = random.Random(11); px = [[rnd.randrange(256) for _ in range(3)] for _ in range(220)]
    px += [[255, 40, 40], [200, 60, 60], [128, 128, 128], [255, 255, 255], [0, 0, 0], [20, 20, 20], [240, 240, 228], [0, 0, 255], [255, 255, 0]]
    return px


RENDER = """async ([px, sc]) => {
  const CG = await __grade.loadCG(); const n = px.length, c = document.createElement('canvas'); c.width = n; c.height = 1;
  const x = c.getContext('2d'), id = x.createImageData(n, 1); px.forEach((p, i) => { id.data.set([p[0], p[1], p[2], 255], i * 4); }); x.putImageData(id, 0, 0);
  const g = CG.normalize({ sc }), R = CG.createRenderer(), out = R.render(c, g, document.createElement('canvas')), d = out.getContext('2d').getImageData(0, 0, n, 1).data; R.destroy();
  const gl = [], js = []; for (let i = 0; i < n; i++) { gl.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]); js.push(HySelColor.apply(px[i].map(v => v / 255), g.sc).map(v => Math.round(v * 255))); }
  return { gl, js }; }"""


@pytest.mark.parametrize("engine", ENGINES)
def test_selective_color_maths_webgl_and_js_match_the_reference(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    px = pixels()
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        for name, case in CASES.items():
            got = page.evaluate(RENDER, [px, case])
            for i, q in enumerate(px):
                want = ref(q, case)
                assert max(abs(a - b) for a, b in zip(got["js"][i], want)) <= 1, (name, q, got["js"][i], want)
                assert max(abs(a - b) for a, b in zip(got["gl"][i], want)) <= 2, (name, engine, q, got["gl"][i], want)
        # the facts, by hand: a pure red has no cyan, so Reds −100 % Cyan keeps R at 255; on (200, 60, 60) −50 % raises R (Relative by
        # half its cyan: 215, Absolute by half the range, kept to 255: 230); a grey is in no colour range; Neutrals +20 % Black darkens
        # grey (Relative 103, Absolute 77); Relative cannot change white, Absolute can
        one = lambda q, case: page.evaluate(RENDER, [[q], case])["gl"][0]   # noqa: E731
        assert one([255, 40, 40], {"reds": {"c": -100}}) == [255, 40, 40]
        r1, r2 = one([200, 60, 60], {"reds": {"c": -50}}), one([200, 60, 60], {"abs": 1, "reds": {"c": -50}})
        assert abs(r1[0] - 215) <= 1 and abs(r2[0] - 230) <= 1 and r1[1:] == [60, 60] == r2[1:], (r1, r2)
        assert one([128, 128, 128], {"reds": {"c": 100, "m": -100, "y": 100, "k": 100}}) == [128, 128, 128]
        g1, g2 = one([128, 128, 128], {"neutrals": {"k": 20}}), one([128, 128, 128], {"abs": 1, "neutrals": {"k": 20}})
        assert all(abs(v - 103) <= 1 for v in g1) and all(abs(v - 77) <= 1 for v in g2), (g1, g2)
        assert one([255, 255, 255], {"whites": {"c": 50}}) == [255, 255, 255] and abs(one([255, 255, 255], {"abs": 1, "whites": {"c": 50}})[0] - 128) <= 1
        assert not errors, errors
        browser.close()


def element_shot(loc, name):
    if SHOTS: Path(SHOTS).mkdir(parents=True, exist_ok=True); loc.screenshot(path=str(Path(SHOTS) / name))


def open_section(page, root):
    """Raw Editor's Selective Color open (the other sections closed) and scrolled to, in the panel under root"""
    page.evaluate("""root => { document.querySelectorAll(root + ' .hcg-sec.open').forEach(s => s.classList.remove('open'));
      const s = document.querySelector(root + ' .hcg-sec[data-id=sc]'); s.classList.add('open'); }""", root)
    time.sleep(0.5)
    page.evaluate("root => document.querySelector(root + ' .hcg-sec[data-id=sc]').scrollIntoView({ block: 'start' })", root); time.sleep(0.2)
    return page.locator(f"{root} .hcg-sec[data-id=sc]")


LOOK = """s => ({ title: s.querySelector('.hcg-head .t').textContent, full: s.querySelector('.hcg-head').title, cut: (e => e.scrollWidth > e.clientWidth + 1)(s.querySelector('.hcg-head .t')),
  sw: [...s.querySelectorAll('.hcg-sw')].map(b => b.getAttribute('aria-label')), name: s.querySelector('.hcg-hsn').textContent,
  sl: [...s.querySelectorAll('.hy-slider')].map(w => [w.querySelector('input').getAttribute('aria-label'), w.classList.contains('grad'), w.dataset.center,
    +w.querySelector('input').min, +w.querySelector('input').max, !!w.style.getPropertyValue('--hy-sl-grad')]),
  seg: [...s.querySelectorAll('.hcg-seg button')].map(b => [b.textContent, b.classList.contains('on')]), icon: s.querySelectorAll('.hcg-head svg.ic *').length })"""
SL = [[w, True, "0", -100, 100, True] for w in ("Голубой", "Пурпурный", "Желтый", "Черный")]


def set_ink(loc, ink, v):
    loc.evaluate(f"s => {{ const i = s.querySelector('[data-sc={ink}] input'); i.value = {v}; i.dispatchEvent(new Event('input', {{ bubbles: true }})); }}")


@pytest.mark.parametrize("engine", ENGINES)
def test_selective_color_on_the_board(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    before = {q: sha(lib / q) for q in ("pics/a.png", "pics/b.jpg", "pics/big.jpg")}
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate("sel = new Set(['a1']); render(); fit()"); time.sleep(0.5)
        page.locator('.tidy button.ic[aria-label="Raw Editor"]').click()
        page.wait_for_selector("#hcgp.in .hcg", timeout=10000); time.sleep(0.3)
        sec = open_section(page, "#hcgp")
        # Photoshop's Russian words (the title shorter, as «Тон и насыщенность»: the full name did not fit the panel, it is the tooltip), nine
        # swatches, the app's signed sliders with colour tracks, Relative chosen; the section's own icon
        look = sec.evaluate(LOOK)
        assert look["title"] == "Выборочный цвет" and look["full"] == "Выборочная коррекция цвета" and not look["cut"], look
        assert look["sw"] == RU and look["name"] == "Красные" and look["sl"] == SL, look
        assert look["seg"] == [["Относительно", True], ["Абсолютно", False]] and look["icon"] >= 4, look
        assert not page.evaluate("() => window.__tMiss.filter(k => k.startsWith('frames::'))"), page.evaluate("() => __tMiss")
        for theme in ("dark", "light"):
            page.evaluate(f"() => {{ document.documentElement.dataset.theme = '{theme}'; }}"); time.sleep(0.4)
            element_shot(page.locator("#hcgp"), f"selcolor-board-{engine}-{theme}.png"); shot(page, f"selcolor-board-page-{engine}-{theme}.png")
        page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")
        # Reds −60 % Cyan: on the card at once, in the grade, one step to undo once it rests
        s0 = page.evaluate("past.length")
        set_ink(sec, "c", -60)
        page.wait_for_function("() => board.items.a1.grade?.sc?.reds?.c === -60", timeout=5000)
        page.wait_for_function(f"() => past.length === {s0 + 1} && !__grade.P.before && !dirty", timeout=10000)
        page.wait_for_function(GRADED); page.wait_for_function("() => !!document.querySelector('#items [data-id=a1] > canvas.grd')")
        assert page.evaluate(SAME_AS, ["a1", {"sc": {"reds": {"c": -60}}}]) < 2 and page.evaluate(SAME_AS, ["a1", {}]) > 2
        assert sec.evaluate("s => s.querySelector('.hcg-sw[data-range=reds]').classList.contains('mod') && !s.querySelector('.hcg-sw[data-range=blues]').classList.contains('mod')")
        # another range has its own values; Absolute for all of them, one more step
        sec.locator(".hcg-sw[data-range=neutrals]").click()
        assert sec.locator(".hcg-hsn").inner_text() == "Нейтральные" and sec.evaluate("s => +s.querySelector('[data-sc=c] input').value") == 0
        set_ink(sec, "k", 25)
        page.wait_for_function("() => board.items.a1.grade?.sc?.neutrals?.k === 25", timeout=5000)
        page.wait_for_function(f"() => past.length === {s0 + 2} && !__grade.P.before", timeout=10000)
        sec.locator(".hcg-seg button", has_text="Абсолютно").click()
        page.wait_for_function("() => board.items.a1.grade?.sc?.abs === 1", timeout=5000)
        page.wait_for_function(f"() => past.length === {s0 + 3} && !__grade.P.before", timeout=10000)
        page.wait_for_function(GRADED)
        g = {"sc": {"abs": 1, "reds": {"c": -60}, "neutrals": {"k": 25}}}
        assert page.evaluate(SAME_AS, ["a1", g]) < 2
        shot(page, f"selcolor-board-{engine}-absolute.png")
        # its eye: off, the card is its picture again and the values stay; ⌘Z puts it back on
        sec.locator(".hcg-head .ey").click()
        page.wait_for_function("() => board.items.a1.grade?.off?.sc === 1 && board.items.a1.grade?.sc?.abs === 1", timeout=3000)
        page.wait_for_function("() => !document.querySelector('#items [data-id=a1] > canvas.grd')", timeout=5000)
        page.wait_for_function("() => !__grade.P.before", timeout=5000)
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => !board.items.a1.grade?.off?.sc", timeout=3000)
        page.wait_for_function(GRADED); page.wait_for_function("() => !!document.querySelector('#items [data-id=a1] > canvas.grd')")
        # ⌘Z again takes back Absolute alone, and the panel follows
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => { const g = board.items.a1.grade; return !!g && !!g.sc && !g.sc.abs && !!g.sc.neutrals && g.sc.neutrals.k === 25; }", timeout=3000)
        page.wait_for_function("() => document.querySelector('#hcgp .hcg-sec[data-id=sc] .hcg-seg button.on').dataset.k === 'Relative'", timeout=3000)
        # copied and pasted with the grade
        page.keyboard.press("Escape"); page.wait_for_function("() => !document.querySelector('#hcgp')", timeout=5000)
        page.evaluate("() => { __grade.copyGrade('a1'); __grade.pasteGrade(['b1']); }")
        page.wait_for_function("() => board.items.b1.grade?.sc?.reds?.c === -60 && board.items.b1.grade?.sc?.neutrals?.k === 25", timeout=5000)
        page.wait_for_function("() => !dirty", timeout=10000)
        assert page.evaluate("() => JSON.stringify(board.items.b1.grade) === JSON.stringify(board.items.a1.grade)")
        assert {q: sha(lib / q) for q in before} == before
        assert not errors, errors
        browser.close()


RENDERED = """() => { const c = __ed.renderDoc(0.2), x = c.getContext('2d', { willReadFrequently: true }), d = x.getImageData(0, 0, c.width, c.height).data, out = [];
  for (let y = 2; y < c.height; y += 7) for (let i = 2; i < c.width; i += 7) { const o = (y * c.width + i) * 4; if (d[o + 3] === 255) out.push([d[o], d[o + 1], d[o + 2]]); } return out; }"""


@pytest.mark.parametrize("engine", ENGINES)
def test_selective_color_in_the_image_studio(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_editor(p, port, engine)
        fr.wait_for_timeout(900)
        ids = fr.evaluate(PIXELS)
        fr.evaluate("(ids) => { __ed.S.ids = [ids[0]]; __ed.refresh(); __ed.setTab('g1', 'adj'); }", ids); fr.wait_for_timeout(400)
        fr.click("#padj .adjnew"); fr.wait_for_timeout(600)
        sec = open_section(fr, "#padj")
        look = sec.evaluate(LOOK)
        assert look["title"] == "Выборочный цвет" and look["full"] == "Выборочная коррекция цвета" and not look["cut"], look
        assert look["sw"] == RU and look["sl"] == SL and [w for w, _ in look["seg"]] == ["Относительно", "Абсолютно"], look
        for theme in ("dark", "light"):
            page.evaluate(f"() => {{ document.documentElement.dataset.theme = '{theme}'; }}"); fr.wait_for_timeout(450)
            element_shot(fr.locator("#padj"), f"selcolor-studio-{engine}-{theme}.png")
        page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")
        base = fr.evaluate(RENDERED)
        fr.evaluate("() => { __ed.S.undo.length = 0; __ed.S.redo.length = 0; }")
        # Reds +80 % Cyan and Blues −50 % Yellow, Absolute: the composite under the layer changes by the same maths
        set_ink(sec, "c", 80)
        sec.locator(".hcg-sw[data-range=blues]").click(); set_ink(sec, "y", -50)
        sec.locator(".hcg-seg button", has_text="Абсолютно").click()
        fr.wait_for_timeout(900)
        sc = fr.evaluate("() => __ed.byId(__ed.S.ids[0]).params.sc")
        assert sc["abs"] == 1 and sc["reds"]["c"] == 80 and sc["blues"]["y"] == -50, sc
        assert 1 <= fr.evaluate("() => __ed.S.undo.length") <= 3
        got = fr.evaluate(RENDERED)
        want = [ref(q, {"abs": 1, "reds": {"c": 80}, "blues": {"y": -50}}) for q in base]
        assert len(got) == len(base) > 50
        moved = sum(1 for a, b in zip(base, got) if max(abs(x - y) for x, y in zip(a, b)) > 8)
        bad = [(q, g_, w) for q, g_, w in zip(base, got, want) if max(abs(x - y) for x, y in zip(g_, w)) > 3]
        assert moved > len(base) // 4 and not bad, (moved, len(base), bad[:5])
        # undo takes it all back to the picture as it was
        n = fr.evaluate("() => __ed.S.undo.length")
        for _ in range(n): page.keyboard.press("Meta+z"); fr.wait_for_timeout(250)
        fr.wait_for_timeout(500)
        assert not fr.evaluate("() => { const p = __ed.byId(__ed.S.ids[0]).params; return HySelColor.used(p.sc && HyColorGrade.normalize(p).sc); }")
        again = fr.evaluate(RENDERED)
        assert all(max(abs(x - y) for x, y in zip(a, b)) <= 2 for a, b in zip(base, again))
        assert not errors, errors
        browser.close()
