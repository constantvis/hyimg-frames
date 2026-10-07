"""Photoshop's Hue/Saturation in the colour grading (owner 2026-10-06), on a real canvas with a disposable library (Chromium and WebKit):
the WebGL pass and the panel's JS give the same pixels as an independent Python reference of the maths (Master and per range, a moved
range, Colorize); the section is the app's: the Preset menu, the range swatches, the app's sliders with colour tracks (signed ones from
zero, Colorize's 0…360 and 0…100), the Russian words; the eyedropper picks a range from a click on the picture, + widens it, − narrows it;
the Before-After bars' marks drag the range; it all lives in the card's grade (one step to undo) and the files never change.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_huesat.py
  FRAMES_SHOTS=<folder> also saves screenshots
"""
import colorsys, random, time

import pytest

from test_imgframe import WEBKIT, hy, open_board, sha, shot   # noqa: F401 (hy is the fixture)

ENGINES = ["chromium", "webkit"]
RANGES = ["reds", "yellows", "greens", "cyans", "blues", "magentas"]


# ---------------------------------------------------------------- the reference, written apart from colorgrade.js
def hs_defaults():
    o = {"colorize": 0, "ch": 0, "cs": 25, "cl": 0, "master": {"hue": 0, "sat": 0, "light": 0}}
    for i, k in enumerate(RANGES):
        c = 60 * i; o[k] = {"hue": 0, "sat": 0, "light": 0, "r": [c - 45, c - 15, c + 15, c + 45]}
    return o


def hs_of(p):
    o = hs_defaults()
    for k, v in p.items():
        if isinstance(v, dict): o[k].update(v)
        else: o[k] = v
    return o


def ps_sat(c, inc):
    mx, mn = max(c), min(c); d = mx - mn
    if d <= 0 or not inc: return c
    v = mx + mn; L = v / 2; S = d / v if L < .5 else d / (2 - v)
    if inc > 0:
        a = S if inc + S >= 1 else 1 - inc; a = 1 / a - 1
        return [x + (x - L) * a for x in c]
    return [L + (x - L) * (1 + inc) for x in c]


def step(c, hue, sat, light):
    if hue:
        h, l, s = colorsys.rgb_to_hls(*c)
        if s > 0: c = list(colorsys.hls_to_rgb(((h * 360 + hue) % 360) / 360, l, s))
    if sat: c = [min(1, max(0, x)) for x in ps_sat(c, sat)]
    if light: c = [x * (1 - light) + light if light > 0 else x * (1 + light) for x in c]
    return c


def weight(h, r):
    a, b, c, d = r; x = a + (h - a) % 360
    if x < b: return (x - a) / (b - a)
    if x <= c: return 1
    if x < d: return (d - x) / (d - c)
    return 0


def ref(rgb, hs):
    c = [v / 255 for v in rgb]
    if hs["colorize"]:
        L = .299 * c[0] + .587 * c[1] + .114 * c[2]
        c = list(colorsys.hls_to_rgb(hs["ch"] / 360, L, hs["cs"] / 100))
        c = step(c, 0, 0, hs["cl"] / 100)
    else:
        d = max(c) - min(c)
        if d > 0:
            h = colorsys.rgb_to_hls(*c)[0] * 360; grey = min(1, d * 255 / 2)
            for k in RANGES:
                o = hs[k]
                if not (o["hue"] or o["sat"] or o["light"]): continue
                w = weight(h, o["r"]) * grey
                if w > 0:
                    t = step(c, o["hue"], o["sat"] / 100, o["light"] / 100); c = [x + (y - x) * w for x, y in zip(c, t)]
        m = hs["master"]; c = step(c, m["hue"], m["sat"] / 100, m["light"] / 100)
    return [round(min(1, max(0, x)) * 255) for x in c]


CASES = {
    "master": {"master": {"hue": 40, "sat": 30, "light": -20}},
    "master-less": {"master": {"sat": -60, "light": 35}},
    "master-full": {"master": {"hue": -120, "sat": 100}},
    "ranges": {"reds": {"hue": 30, "sat": 50, "light": 10}, "blues": {"hue": -60, "sat": -40, "light": -30}},
    "moved-range": {"yellows": {"sat": 80, "hue": 20, "r": [20, 50, 70, 120]}, "master": {"light": 10}},
    "colorize": {"colorize": 1, "ch": 200, "cs": 40, "cl": 15},
}


def pixels():
    rnd = random.Random(7); px = [[rnd.randrange(256) for _ in range(3)] for _ in range(220)]
    px += [[round(v * 255) for v in colorsys.hsv_to_rgb(h / 36, 1, 1)] for h in range(36)]   # every 10° at full colour
    px += [[g, g, g] for g in (0, 40, 128, 200, 255)] + [[128, 129, 128], [250, 20, 10], [5, 5, 200]]
    return px


RENDER = """async ([px, hs]) => {
  const CG = await __grade.loadCG(); const n = px.length, c = document.createElement('canvas'); c.width = n; c.height = 1;
  const x = c.getContext('2d'), id = x.createImageData(n, 1); px.forEach((p, i) => { id.data.set([p[0], p[1], p[2], 255], i * 4); }); x.putImageData(id, 0, 0);
  const R = CG.createRenderer(), out = R.render(c, CG.normalize({ hs }), document.createElement('canvas')), d = out.getContext('2d').getImageData(0, 0, n, 1).data; R.destroy();
  const g = [], j = []; for (let i = 0; i < n; i++) { g.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]); j.push(CG.hsApply(px[i].map(v => v / 255), CG.normalize({ hs }).hs).map(v => Math.round(v * 255))); }
  return { gl: g, js: j }; }"""


@pytest.mark.parametrize("engine", ENGINES)
def test_hue_saturation_maths_webgl_and_js_match_the_reference(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    px = pixels()
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        for name, case in CASES.items():
            hs = hs_of(case)
            got = page.evaluate(RENDER, [px, case])
            for i, q in enumerate(px):
                want = ref(q, hs)
                assert max(abs(a - b) for a, b in zip(got["js"][i], want)) <= 1, (name, q, got["js"][i], want)
                assert max(abs(a - b) for a, b in zip(got["gl"][i], want)) <= 2, (name, engine, q, got["gl"][i], want)
        # by hand, the facts the owner reads off Photoshop: a pure red turned 120° is green; Reds −100 leaves blue alone and makes red grey;
        # a grey is in no range; Lightness +100 is white, −100 black; Colorize keeps the picture's luminosity in the new hue
        one = lambda q, case: page.evaluate(RENDER, [[q], case])["gl"][0]
        assert one([255, 0, 0], {"master": {"hue": 120}}) == [0, 255, 0]
        assert one([0, 0, 255], {"reds": {"sat": -100}}) == [0, 0, 255] and all(abs(v - 127.5) <= 1 for v in one([255, 0, 0], {"reds": {"sat": -100}}))
        assert one([90, 90, 90], {"reds": {"hue": 90, "sat": 100, "light": 80}}) == [90, 90, 90]
        assert one([30, 140, 220], {"master": {"light": 100}}) == [255, 255, 255] and one([30, 140, 220], {"master": {"light": -100}}) == [0, 0, 0]
        sep = one([128, 128, 128], {"colorize": 1, "ch": 35, "cs": 25})
        assert sep[0] > sep[1] > sep[2] and abs((sep[0] + sep[1] + sep[2]) / 3 - 128) < 6, sep
        assert not errors, errors
        browser.close()


def hs_panel(page):
    """the board's grading panel open on a1, its Hue/Saturation section open and scrolled to"""
    page.evaluate("sel = new Set(['b1']); render(); fit()"); time.sleep(0.5)
    page.locator('.tidy button.ic[aria-label="Raw Editor"]').click()
    page.wait_for_selector("#hcgp.in .hcg", timeout=10000)
    page.evaluate("() => { document.querySelector('#hcgp .hcg-sec[data-id=basic]').classList.remove('open'); document.querySelector('#hcgp .hcg-sec[data-id=hs]').classList.add('open'); }")
    time.sleep(0.5)
    page.evaluate("() => document.querySelector('#hcgp .hcg-sec[data-id=hs]').scrollIntoView({ block: 'start' })"); time.sleep(0.2)
    return page.locator("#hcgp .hcg-sec[data-id=hs]")


@pytest.mark.parametrize("engine", ENGINES)
def test_hue_saturation_panel_presets_ranges_eyedropper_and_bars(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    before = {q: sha(lib / q) for q in ("pics/a.png", "pics/b.jpg", "pics/big.jpg")}
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        sec = hs_panel(page)
        # the section in Photoshop's Russian words, the app's sliders with colour tracks, signed ones from zero
        assert sec.locator(".hcg-head .t").inner_text() == "Тон и насыщенность"   # short enough not to be cut (owner 2026-10-07)
        names = sec.evaluate("s => [...s.querySelectorAll('.hy-slider')].map(w => [w.querySelector('input').getAttribute('aria-label'), w.classList.contains('grad'), w.dataset.center, +w.querySelector('input').min, +w.querySelector('input').max, !!w.style.getPropertyValue('--hy-sl-grad')])")
        assert names == [["Цветовой тон", True, "0", -180, 180, True], ["Насыщенность", True, "0", -100, 100, True], ["Яркость", True, "0", -100, 100, True]], names
        sw = sec.evaluate("s => [...s.querySelectorAll('.hcg-sw')].map(b => b.getAttribute('aria-label'))")
        assert sw == ["Все", "Красные", "Желтые", "Зеленые", "Голубые", "Синие", "Пурпурные"], sw
        assert sec.locator(".hcg-sel span").inner_text() == "По умолчанию"
        assert sec.locator(".hcg-ck").inner_text().strip() == "Тонирование"
        assert sec.evaluate("s => s.querySelectorAll('[data-pick]').length") == 3
        assert not page.evaluate("() => window.__tMiss.filter(k => k.startsWith('frames::'))"), page.evaluate("() => __tMiss")
        # the theme's both looks, the section as the owner sees it
        for theme in ("dark", "light"):
            page.evaluate(f"() => {{ document.documentElement.dataset.theme = '{theme}'; }}"); time.sleep(0.35)
            shot(page, f"hs-1-{engine}-section-{theme}.png")
        page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")
        # a slider: the master's saturation, live on the card, one step to undo once it rests
        val = lambda w: page.evaluate("w => __grade.P.inst.get().hs" + w)
        sec.evaluate("s => { const i = s.querySelector('[data-hs=sat] input'); i.value = 40; i.dispatchEvent(new Event('input', { bubbles: true })); }")
        page.wait_for_function("() => board.items.b1.grade && board.items.b1.grade.hs && board.items.b1.grade.hs.master.sat === 40", timeout=5000)
        page.wait_for_function("() => past.length && !dirty", timeout=10000)
        assert sec.locator(".hcg-sel span").inner_text() == "Заказной"
        # Presets: Sepia is Colorize at 35°, 25; Hue then goes 0…360 and Saturation 0…100, the ranges step aside
        sec.locator(".hcg-sel").click()
        page.locator("#hcgp .hcg-hsm.open button", has_text="Сепия").click()
        page.wait_for_function("() => { const h = board.items.b1.grade && HyColorGrade.normalize(board.items.b1.grade).hs; return !!h && h.colorize === 1 && h.ch === 35 && h.cs === 25 && h.master.sat === 0; }", timeout=5000)
        rng = sec.evaluate("s => [...s.querySelectorAll('.hy-slider input')].map(i => [+i.min, +i.max, +i.value, i.closest('.hy-slider').dataset.center ?? null])")
        assert rng == [[0, 360, 35, None], [0, 100, 25, None], [-100, 100, 0, "0"]], rng
        assert sec.evaluate("s => s.querySelector('.hcg-ck').classList.contains('on') && s.querySelector('.hcg-hsr').classList.contains('dis')")
        shot(page, f"hs-2-{engine}-sepia-colorize.png")
        sec.locator(".hcg-sel").click(); page.locator("#hcgp .hcg-hsm.open button", has_text="По умолчанию").click()
        page.wait_for_function("() => !board.items.b1.grade || !board.items.b1.grade.hs", timeout=5000)
        # a range: its own values; the swatch shows it is changed
        sec.locator('.hcg-sw[aria-label="Синие"]').click()
        assert sec.locator(".hcg-hsn").inner_text() == "Синие"
        sec.evaluate("s => { const i = s.querySelector('[data-hs=hue] input'); i.value = -50; i.dispatchEvent(new Event('input', { bubbles: true })); }")
        page.wait_for_function("() => board.items.b1.grade && board.items.b1.grade.hs.blues.hue === -50", timeout=5000)
        assert sec.evaluate("s => s.querySelector('.hcg-sw[aria-label=\"Синие\"]').classList.contains('mod')")
        sec.locator('.hcg-sw[aria-label="Все"]').click()
        assert sec.evaluate("s => +s.querySelector('[data-hs=hue] input').value") == 0, "Master has its own hue"
        # the eyedropper: a click on the picture (b.jpg: blue at its top) picks the blue range and centres it on that hue
        sec.locator('[data-pick=set]').click()
        assert page.evaluate("() => document.documentElement.classList.contains('hcgpick')")
        box = page.locator("#items [data-id=b1]").bounding_box()
        px_, py_ = box["x"] + box["width"] * 0.1, max(box["y"], 0) + 30
        rgb = page.evaluate("""([x, y]) => { const img = document.querySelector('#items [data-id=b1] img'), r = img.getBoundingClientRect(), c = document.createElement('canvas'); c.width = c.height = 1;
          const g = c.getContext('2d'); g.drawImage(img, Math.floor((x - r.left) / r.width * img.naturalWidth), Math.floor((y - r.top) / r.height * img.naturalHeight), 1, 1, 0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); }""",
                            [px_, py_])
        page.mouse.click(px_, py_)
        h = colorsys.rgb_to_hls(*[v / 255 for v in rgb])[0] * 360
        k = min(RANGES, key=lambda q: abs((h - 60 * RANGES.index(q) + 180) % 360 - 180))   # Master picks the nearest range
        page.wait_for_function(f"() => __grade.P.inst.hs.range === '{k}'", timeout=5000, polling=100)
        r = page.evaluate(f"() => __grade.P.inst.get().hs.{k}.r")
        assert abs((r[1] + r[2]) / 2 - round(h)) <= 1 and r[2] - r[1] == 30 and r[1] - r[0] == 30, (r, h, rgb)
        assert not page.evaluate("() => document.documentElement.classList.contains('hcgpick')")
        # + widens the inner range to a hue past it, − narrows it to leave a hue inside out
        m = (r[1] + r[2]) / 2
        page.evaluate("([q]) => __grade.P.inst.hs.pick(q, 'add')", [[round(v * 255) for v in colorsys.hls_to_rgb(((m + 40) % 360) / 360, .5, 1)]])
        r2 = page.evaluate(f"() => __grade.P.inst.get().hs.{k}.r")
        assert abs(r2[2] - (m + 40)) <= 1 and r2[3] - r2[2] == 30 and r2[1] == r[1], (r, r2)
        page.evaluate("([q]) => __grade.P.inst.hs.pick(q, 'sub')", [[round(v * 255) for v in colorsys.hls_to_rgb(((m + 30) % 360) / 360, .5, 1)]])
        r3 = page.evaluate(f"() => __grade.P.inst.get().hs.{k}.r")
        assert r3[1] == r2[1] and abs(r3[2] - (m + 29)) <= 1, (r2, r3)
        # the Before-After bars: the inner right mark dragged right widens the range, the middle moves all four
        page.evaluate("() => document.querySelector('#hcgp .hcg-ba').scrollIntoView({ block: 'center' })"); time.sleep(0.3)
        cb = sec.locator(".hcg-ba canvas").bounding_box()
        rr = page.evaluate(f"() => __grade.P.inst.get().hs.{k}.r"); lo = (rr[1] + rr[2]) / 2 - 180
        xs = [cb["x"] + (v - lo) / 360 * cb["width"] for v in rr]
        y = cb["y"] + 22
        page.mouse.move(xs[2], y); page.mouse.down(); page.mouse.move(xs[2] + cb["width"] * 20 / 360, y, steps=6); page.mouse.up()
        r4 = page.evaluate(f"() => __grade.P.inst.get().hs.{k}.r")
        assert abs(r4[2] - (rr[2] + 20)) <= 2 and r4[1] == rr[1] and r4[0] == rr[0], (rr, r4)
        mid = (xs[1] + xs[2]) / 2
        page.mouse.move(mid, y); page.mouse.down(); page.mouse.move(mid - cb["width"] * 30 / 360, y, steps=6); page.mouse.up()
        r5 = page.evaluate(f"() => __grade.P.inst.get().hs.{k}.r")
        assert all(abs(a - (b - 30)) <= 2 for a, b in zip(r5, r4)), (r4, r5)
        rd = sec.locator(".hcg-ba .rd").inner_text()
        assert "°/" in rd and "\\" in rd, rd
        shot(page, f"hs-3-{engine}-before-after.png")
        # a double click on the bars puts the range back
        page.mouse.dblclick(mid, y)
        c0 = 60 * RANGES.index(k); assert page.evaluate(f"() => __grade.P.inst.get().hs.{k}.r") == [c0 - 45, c0 - 15, c0 + 15, c0 + 45]
        # it is the card's grade: kept on the board item, one step to undo
        page.wait_for_function("() => !dirty", timeout=10000)
        page.keyboard.press("Escape"); page.wait_for_function("() => !document.querySelector('#hcgp')", timeout=5000)
        assert page.evaluate("() => board.items.b1.grade.hs.blues.hue") == -50
        assert {q: sha(lib / q) for q in before} == before
        assert not errors, errors
        browser.close()
