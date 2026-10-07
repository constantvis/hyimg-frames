"""The frame editor's sliders are the app's one slider (owner 2026-10-06: «why are the sliders everywhere not the same as in 3D»): the
mask panel's Field (density, feather: the label inside, the number at its right, one history step for a gesture) and the colour
grading panel's rows (signed ones fill from zero, colour tracks show along the bottom edge, a double click puts the default back, a typed
«+10» adds, ⇧ and an arrow move ten steps). Measured in the real editor page: the thin line sits on the value's place within 1 px.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_sliders.py
  FRAMES_SHOTS=<folder> also saves screenshots
"""
import math
import time

import pytest

from test_imgframe import ITEMS, SHOTS, WEBKIT, closed, editor, hy, open_board, shot  # noqa: F401  (hy is the fixture)

GEOM = """sel => { const w = typeof sel === 'string' ? document.querySelector(sel) : sel; const f = w.querySelector('.hy-slider-f').getBoundingClientRect(),
  t = w.querySelector('.hy-slider-t').getBoundingClientRect(), r = w.getBoundingClientRect(), i = w.querySelector('input[type=range]');
  return { fill: f.right, fillLeft: f.left, line: (t.left + t.right) / 2, left: r.left, right: r.right, v: +i.value, min: +i.min, max: +i.max,
  end: w.classList.contains('sm') ? 1 : r.height * .1 + 1 }; }"""   # the line's clamp inside the round ends (ui/slider.css --hy-sl-end)


def at_value(g, share):
    return min(max(g["left"] + (g["right"] - g["left"]) * share, g["left"] + g["end"]), g["right"] - g["end"])


def open_editor(p, port, engine):
    browser, page, errors = open_board(p, port, engine)
    page.evaluate("sel = new Set(['a1', 'b1']); render(); fit()"); time.sleep(0.6)
    page.keyboard.press("Alt+Meta+KeyG")
    page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
    fid = page.evaluate("() => Object.entries(board.items).find(([k, it]) => it.type === 'imgframe')[0]")
    page.wait_for_timeout(1200)
    page.dblclick(f".plg[data-id='{fid}']")
    return browser, page, editor(page), errors


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_editor_sliders_are_the_apps_one(hy, engine):
    if engine == "webkit" and not WEBKIT:
        pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_editor(p, port, engine)
        page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }"); fr.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")   # the app's dark theme, the screenshots' one
        # --- the mask panel's Field, in the editor's own page: density (linear, %) and feather (square-root curve, px)
        fr.evaluate("""() => {
          const { S, Field } = __ed; window.__m = { density: 40, feather: 100 }; S.undo.length = 0;
          const box = document.createElement('div'); box.id = '__t'; box.style.cssText = 'position:fixed;left:40px;top:80px;width:300px;z-index:99;display:flex;flex-direction:column;gap:8px;background:var(--panel)';
          box.append(Field('Density', { min: 0, max: 100, unit: '%', get: () => __m.density, set: v => { __m.density = v; S.dirty = true; }, hist: 'density' }).el,
                     Field('Feather', { min: 0, max: 250, sq: true, unit: 'px', get: () => __m.feather, set: v => { __m.feather = v; S.dirty = true; }, hist: 'feather' }).el);
          document.body.append(box); }""")
        sel = lambda k: f"#__t .hy-slider:nth-child({k})"
        shot(page, f"sliders-mask-{engine}.png")
        for k, curve in ((1, False), (2, True)):
            for share in (0, 0.25, 0.5, 0.9, 1):
                fr.evaluate("([s, share]) => { const i = document.querySelector(s + ' input'); const lo = +i.min, hi = +i.max; const p = s.endsWith('(2)') ? share * share : share; i.value = lo + (hi - lo) * p; i.dispatchEvent(new Event('input', { bubbles: true })); }", [sel(k), share])
                g = fr.evaluate(GEOM, sel(k))
                assert abs(g["line"] - at_value(g, share)) <= 1.01, (k, share, g)
                assert abs(g["fill"] - (g["left"] + (g["right"] - g["left"]) * share)) <= 1.01, ("the fill ends where the line is", k, share, g)
        # a drag on density: one undo step, the value follows the pointer; the number types "+10" with the editor's one rule
        off = page.evaluate("() => { const w = document.querySelector('.ifed iframe').getBoundingClientRect(); return [w.left, w.top]; }")
        box = fr.evaluate("s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }", sel(1))
        x0, y, w = off[0] + box[0], off[1] + box[1] + box[3] / 2, box[2]
        fr.evaluate("() => { __m.density = 40; document.querySelector('#__t .hy-slider input').value = 40; document.querySelector('#__t .hy-slider input').dispatchEvent(new Event('input')); __ed.S.undo.length = 0; }")
        page.mouse.move(x0 + w * 0.4, y); page.mouse.down(); page.mouse.move(x0 + w * 0.6, y, steps=5); page.mouse.move(x0 + w * 0.9, y, steps=5); page.mouse.up()
        v = fr.evaluate("() => __m.density"); assert 85 <= v <= 95, v
        assert fr.evaluate("() => __ed.S.undo.length") == 1, "one history step for one gesture"
        fr.click("#__t .hy-slider:nth-child(1) .hy-slider-v")
        page.keyboard.type("-10"); page.keyboard.press("Enter")
        assert fr.evaluate("() => __m.density") == v - 10, "−10 takes ten away"
        assert fr.evaluate("() => __ed.S.undo.length") == 2
        # --- the colour grading panel: the same slider, signed ones from zero, colour tracks, defaults back, ⇧ ten steps
        fr.evaluate("""() => {
          const old = document.getElementById('__t'); if (old) old.remove();
          const c = document.createElement('div'); c.id = '__cg'; c.style.cssText = 'position:fixed;left:20px;top:20px;width:320px;height:760px;z-index:99';
          document.body.append(c); window.__cgv = null; window.__cgn = 0;
          window.__cgp = HyColorGrade.createPanel(c, HyColorGrade.defaults(), p => { __cgv = p; __cgn++; }, { theme: 'inherit' });
          c.querySelectorAll('.hcg-sec').forEach(s => s.classList.add('open')); }""")
        time.sleep(0.5)
        names = fr.evaluate("() => [...document.querySelectorAll('#__cg .hy-slider')].map(w => w.querySelector('input').dataset.k)")   # the English name (aria-label is in the page's language)
        assert {"Temp", "Tint", "Exposure", "Sharpening", "Vibrance"} <= set(names) and len(names) > 30, names
        assert fr.evaluate("() => document.querySelectorAll('#__cg .hcg-trk, #__cg .hcg-thumb').length") == 0, "the old track is gone"
        shot(page, f"sliders-grading-{engine}.png")
        slider = lambda name: f'#__cg .hy-slider:has(input[data-k="{name}"])'
        for name, kind in (("Temp", "grad"), ("Clarity", "signed"), ("Sharpening", "plain")):
            fr.evaluate("s => document.querySelector(s).scrollIntoView({ block: 'center' })", slider(name)); time.sleep(0.15)
            lo, hi = fr.evaluate("s => { const i = document.querySelector(s + ' input'); return [+i.min, +i.max]; }", slider(name))
            for share in (0, 0.25, 0.5, 0.9, 1):
                fr.evaluate("([s, share]) => { const i = document.querySelector(s + ' input'); i.value = +i.min + (+i.max - +i.min) * share; i.dispatchEvent(new Event('input', { bubbles: true })); }", [slider(name), share])
                g = fr.evaluate(GEOM, slider(name))
                assert abs(g["line"] - at_value(g, share)) <= 1.01, (name, share, g)
                if kind == "signed":   # the fill runs from the zero tick to the value
                    zero = g["left"] + (g["right"] - g["left"]) * (0 - lo) / (hi - lo)
                    assert abs(g["fillLeft"] - min(zero, g["left"] + (g["right"] - g["left"]) * share)) <= 1.01 and abs(g["fill"] - max(zero, g["left"] + (g["right"] - g["left"]) * share)) <= 1.01, (name, share, g, zero)
        assert fr.evaluate("() => getComputedStyle(document.querySelector('#__cg .hy-slider.grad'), '::before').height") == "5px"
        assert fr.evaluate("s => getComputedStyle(document.querySelector(s + ' .hy-slider-f')).display", slider("Temp")) == "none"
        # a drag on Sharpening changes the panel's value and emits; ⇧← moves ten; a double click puts the default back
        fr.evaluate("s => document.querySelector(s).scrollIntoView({ block: 'center' })", slider("Sharpening")); time.sleep(0.2)
        box = fr.evaluate("s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }", slider("Sharpening"))
        x0, y, w = off[0] + box[0], off[1] + box[1] + box[3] / 2, box[2]
        fr.evaluate("s => { const i = document.querySelector(s + ' input'); i.value = 0; i.dispatchEvent(new Event('input', { bubbles: true })); }", slider("Sharpening")); page.wait_for_timeout(150)
        n0 = fr.evaluate("() => __cgn")
        page.mouse.move(x0 + w * 0.2, y); page.mouse.down(); page.mouse.move(x0 + w * 0.5, y, steps=5); page.mouse.move(x0 + w * 0.7, y, steps=5); page.mouse.up()
        page.wait_for_timeout(120)
        val = lambda: fr.evaluate("() => __cgp.get().sharpening")
        assert fr.evaluate("() => __cgn") > n0 and 65 < val() < 85, val()   # the press does not jump: 0.5 of the width from 0 is half the range
        fr.evaluate("s => document.querySelector(s + ' input').focus()", slider("Sharpening"))
        before = val(); page.keyboard.press("Shift+ArrowLeft"); assert abs(val() - (before - 10)) < 1e-6, (before, val())
        page.keyboard.press("ArrowRight"); assert abs(val() - (before - 9)) < 1e-6
        page.mouse.dblclick(x0 + w * 0.5, y); page.wait_for_timeout(150)
        assert val() == 0, "a double click puts the default back"
        # a typed «+10» adds ten (the panel's rule), the number is the slider's own field
        fr.click(slider("Sharpening") + " .hy-slider-v"); page.keyboard.type("+10"); page.keyboard.press("Enter"); page.wait_for_timeout(120)
        assert val() == 10, val()
        assert not errors, errors
        browser.close()
