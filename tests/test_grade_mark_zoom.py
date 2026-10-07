"""The colour grade's card mark is one icon at every zoom (owner 2026-10-06: «рассинхрон в иконке цвета, как будто она по непонятным
причинам переключается»: close up the card showed the hue disc, further out the far view drew an older plain wheel). The card's element
and the far view's canvas both show ui/icons.js hyGradeIcon: the hue disc for a grade that works, the plain wheel at half strength for a
grade switched off; the plate follows the board's mark law (26 px at most, 14 at least, k from the card's short side, the ♥'s size),
and no two plates of a card overlap. A card at 3 zooms, the near one an element, the 2 far ones the far view. Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_grade_mark_zoom.py
  FRAMES_SHOTS=<folder> also saves the 3 zooms
"""
import time

import pytest

from test_grade import ENGINES, GRADED
from test_imgframe import WEBKIT, hy, open_board, shot  # noqa: F401  (hy is the fixture)

# the element's plates on the card: name, rect, icon
DOM = """id => [...document.querySelectorAll(`#items [data-id="${id}"] > .mk`)].filter(m => { const s = getComputedStyle(m); return s.display !== 'none' && +s.opacity > .9; })
  .map(m => { const r = m.getBoundingClientRect(); return { n: [...m.classList].find(c => c.startsWith('mk-') && c !== 'mk-tr' && c !== 'mk-tl' && c !== 'mk-br' && c !== 'mk-bl'),
    x: r.x, y: r.y, w: r.width, h: r.height, icon: m.dataset.icon || null, paths: m.querySelectorAll('svg path').length }; })"""
# the far view's plates of the card (its law and geometry, mkFit and mkGeo, as lodDots draws them) and, at the grade's icon, how many of its
# pixels are coloured (the hue disc) and how many are bright (the plain wheel's white line)
FAR = """id => { const it = board.items[id], el = EL.get(id), r = $('#lodd').getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const ih = itemH(it), sw = it.w * cam.z, sh = ih * cam.z, f = { kind: false, kindW: 0, fav: true, note: !!NOTEDOT.get(id), crop: !!it.crop, dup: false, grade: el.classList.contains('graded'), hs: false };
  const fit = mkFit(sw, sh, f), x0 = (it.x - cam.x) * cam.z, y0 = (it.y - cam.y) * cam.z, Q = mkGeo(x0, y0, x0 + sw, y0 + sh, fit, f), out = { k: fit.k, plates: [] };
  for (const n of ['fav', 'grade', 'crop', 'note']) { const q = Q[n]; if (!q || !q.on) continue; const x = q.sx < 0 ? q.ax - q.d : q.ax, y = q.ay; out.plates.push({ n, x: x + r.left, y: y + r.top, w: q.d, h: q.d }); }
  const q = Q.grade; if (q && q.on) {
    const s = q.d * .66, cx = q.ax - q.d / 2, cy = q.ay + q.d / 2, g = $('#lodd').getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(Math.round((cx - s / 2) * dpr), Math.round((cy - s / 2) * dpr), Math.max(1, Math.round(s * dpr)), Math.max(1, Math.round(s * dpr))).data;
    let col = 0, bright = 0; for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx - mn > 90) col++; if (mn > 120) bright++; }
    out.col = col; out.bright = bright; }
  return out; }"""


def apart(ps):
    """no two plates overlap (the note's dot included)"""
    for i, a in enumerate(ps):
        for b in ps[i + 1:]:
            if a["x"] < b["x"] + b["w"] - .5 and b["x"] < a["x"] + a["w"] - .5 and a["y"] < b["y"] + b["h"] - .5 and b["y"] < a["y"] + a["h"] - .5:
                return False, (a, b)
    return True, None


def law(sw, sh):
    return max(14 / 26, min(1, min(sw, sh) * .25 / 26))


@pytest.mark.parametrize("engine", ENGINES)
def test_one_grade_icon_at_every_zoom(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        # b1 (a tall card) liked, cropped, graded, with a note lying on it: the dot top left, ♥ grade crop top right
        page.evaluate("""() => { const b = snap(); board.items.b1.grade = { contrast: 40 }; board.items.b1.crop = [0, 0, 1, .95];
          board.items.n1 = { type: 'note', text: 'a note', x: 760, y: 100, w: 120, fs: 12, color: 'blue' }; commit(b);
          const m = byPath.get('pics/b.jpg'); if (m) m.feedback = { fav: true }; sel = new Set(); render(); }""")
        page.wait_for_function(GRADED)
        for off in (False, True):
            if off:
                page.evaluate("() => { const b = snap(); board.items.b1.grade = { contrast: 40, bypass: 1 }; commit(b); sel = new Set(); render(); }")
            for z in (0.6, 0.35, 0.28):   # the near one an element, the far view from a median card under 110 px; smaller, the law lets the grade go first
                page.evaluate(f"() => {{ cam.z = {z}; cam.x = 500; cam.y = -100; renderCam(); render(); }}")
                page.wait_for_timeout(1300)
                lod = page.evaluate("() => LOD.on")
                assert lod == (z < 0.5), (z, lod)   # the median card 300 wide: the far view under 110 px on screen
                shot(page, f"mark-zoom-{engine}-{'off' if off else 'on'}-{z}.png")
                sw, sh = page.evaluate("() => { const it = board.items.b1; return [it.w * cam.z, itemH(it) * cam.z]; }")
                if not lod:
                    ps = page.evaluate(DOM, "b1"); gr = next(m for m in ps if m["n"] == "mk-grade"); fv = next(m for m in ps if m["n"] == "mk-fav")
                    assert gr["icon"] == ("off" if off else "on") and (gr["paths"] == 0 if off else gr["paths"] >= 60), gr
                    plates = [m for m in ps if m["n"] != "mk-note"]
                else:
                    far = page.evaluate(FAR, "b1"); ps = far["plates"]; gr = next(m for m in ps if m["n"] == "grade"); fv = next(m for m in ps if m["n"] == "fav")
                    if off: assert far["col"] == 0 and far["bright"] > 3, far     # the plain wheel, white, no hues
                    else: assert far["col"] > 8, far                            # the hue disc
                    plates = [m for m in ps if m["n"] != "note"]
                # the law: the grade's plate is the ♥'s, 26 px × k, k at most the card's share and at least 14/26
                k = gr["w"] / 26
                assert abs(gr["w"] - fv["w"]) < .6 and abs(gr["w"] - gr["h"]) < .6, (z, gr, fv)
                assert 14 / 26 - .01 <= k <= law(sw, sh) + .01, (z, k, sw, sh)
                ok, pair = apart(ps); assert ok, (z, pair)
                assert len(plates) == 3, (z, ps)   # ♥ grade crop: none left at these sizes
        assert not errors, errors
        browser.close()
