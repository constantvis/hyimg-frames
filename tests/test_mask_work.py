"""The image studio's masks the Photoshop way (owner 2026-10-07: «it's pretty confusing»), Chromium and WebKit:

- with a selection and the mask targeted, ⌫ hides there and ⇧⌫ shows, on a picture's mask, a Raw Editor layer's and the master Mask, and
  the picture changes in the next frame (it did nothing on the master Mask and on a Raw Editor layer's mask: ⌫ only knew picture layers);
- ⌘I inverts the targeted mask, else the layer's pixels; ⇧⌘I inverts the selection;
- Contract/Expand and Smooth under Properties › Mask change the mask's edge, live, one step to undo each;
- the mask plate stands at the bottom centre over the dock while a mask is targeted: how the mask shows (overlay, on black, on white, black
  and white, off), ✓ and Esc leave it; the targeted thumbnail is outlined.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_mask_work.py
  FRAMES_SHOTS=<folder> also saves screenshots in both themes
"""
import pytest

from editor_kit import add_adj, ENGINES, MASKA, PIXELS, PX, center, focus, frame_tick, pick, rect_sel, settle, shot, start
from test_imgframe import hy  # noqa: F401  (the fixture)


def near(a, b, d=8): return all(abs(p - q) <= d for p, q in zip(a, b))


@pytest.mark.parametrize("engine", ENGINES)
def test_delete_fills_the_targeted_mask_and_cmd_i(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        a, b = fr.evaluate(PIXELS)
        pick(fr, b); fr.evaluate("() => __ed.S.ids.length && hyEdK.addMask(false)"); settle(fr)
        assert fr.evaluate("() => __ed.S.editMask") and fr.evaluate(f"() => !!__ed.byId('{b}').mask")
        before = fr.evaluate(PX, [750, 300])
        rect_sel(fr, 700, 200, 850, 450)   # the left half of b, lower part
        focus(page, fr); page.keyboard.press("Backspace"); frame_tick(fr)
        assert fr.evaluate(MASKA, [b, .2, .8]) == 0 and fr.evaluate(MASKA, [b, .8, .8]) == 255 and fr.evaluate(MASKA, [b, .2, .2]) == 255
        after = fr.evaluate(PX, [750, 300])
        assert near(after, [255, 255, 255, 255]) and not near(before, after), (before, after)   # the white paper shows at once
        page.keyboard.press("Shift+Backspace"); frame_tick(fr)
        assert fr.evaluate(MASKA, [b, .2, .8]) == 255 and near(fr.evaluate(PX, [750, 300]), before)
        # ⌘I on the targeted mask: inverted; ⇧⌘I: the selection inverted
        page.keyboard.press("Meta+i"); frame_tick(fr)
        assert fr.evaluate(MASKA, [b, .5, .5]) == 0
        page.keyboard.press("Meta+i")
        sel_at = """([x, y]) => { const c = document.createElement('canvas'); c.width = c.height = 1; const s = hyEdK.sel();
          c.getContext('2d').drawImage(s.c, Math.floor(x * s.k), Math.floor(y * s.k), 1, 1, 0, 0, 1, 1); return c.getContext('2d').getImageData(0, 0, 1, 1).data[3]; }"""
        assert fr.evaluate(sel_at, [750, 300]) == 255 and fr.evaluate(sel_at, [100, 100]) == 0
        page.keyboard.press("Meta+Shift+i")
        assert fr.evaluate(sel_at, [750, 300]) == 0 and fr.evaluate(sel_at, [100, 100]) == 255
        # ⌘I on a layer (no mask targeted): its pixels inverted; an original says it is locked (its file never changes), a copy inverts
        fr.evaluate("() => __ed.deselect()"); pick(fr, b); page.keyboard.press("Meta+i")
        assert fr.evaluate(f"() => __ed.byId('{b}').c._v") == fr.evaluate(f"() => __ed.byId('{b}').src.v0")
        fr.evaluate(f"() => {{ __ed.byId('{b}').mask = null; hyEdK.duplicate(); }}"); settle(fr)
        px0 = fr.evaluate(PX, [980, 20]); page.keyboard.press("Meta+i"); frame_tick(fr)
        px1 = fr.evaluate(PX, [980, 20]); assert near(px1[:3], [255 - v for v in px0[:3]], 3), (px0, px1)
        page.keyboard.press("Meta+z"); frame_tick(fr); assert near(fr.evaluate(PX, [980, 20]), px0, 2)
        # a Raw Editor layer's mask and the master Mask take ⌫ too
        adj = add_adj(fr, mask=True); rect_sel(fr, 0, 0, 500, 450); focus(page, fr); page.keyboard.press("Backspace")
        assert fr.evaluate(MASKA, [adj, .2, .5]) == 0 and fr.evaluate(MASKA, [adj, .8, .5]) == 255
        adj2 = add_adj(fr); fr.evaluate("() => hyEdK.addMask(true)")
        assert fr.evaluate(MASKA, [adj2, .2, .5]) == 255 and fr.evaluate(MASKA, [adj2, .8, .5]) == 0, "Reveal Selection on a Raw Editor layer (it threw)"
        pick(fr, "main_mask", True); page.keyboard.press("Backspace"); frame_tick(fr)
        assert fr.evaluate(MASKA, ["main_mask", .2, .5]) == 0 and fr.evaluate(PX, [100, 200])[3] == 0, "the master Mask hides there at once"
        assert not errors, errors
        browser.close()


GROW = """([id, v, key]) => { const s = [...document.querySelectorAll('#pbody .hy-slider')].find(e => e.textContent.includes(key)); const i = s.querySelector('input');
  i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return __ed.byId(id).mask; }"""
LOOKA = """([id, x]) => { const n = __ed.byId(id), m = n.mask, L = hyEdK.maskLook(m, m.c.width / Math.abs(n.w)), c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d'); g.drawImage(L, Math.floor(x * L.width), Math.floor(L.height / 2), 1, 1, 0, 0, 1, 1); return g.getImageData(0, 0, 1, 1).data[3]; }"""


@pytest.mark.parametrize("engine", ENGINES)
def test_contract_expand_smooth_and_the_mask_plate(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        a, b = fr.evaluate(PIXELS)
        pick(fr, b); fr.evaluate("() => hyEdK.addMask(false)"); rect_sel(fr, 700, 0, 850, 450)
        focus(page, fr); page.keyboard.press("Backspace"); fr.evaluate("() => __ed.deselect()")   # b's left half hidden: its edge at x = 850
        fr.evaluate("() => __ed.showPanel('props')"); settle(fr)
        T = fr.evaluate("() => hyEdK.W.mask")
        n0 = fr.evaluate("() => __ed.S.undo.length")
        # Expand by 30 px: 20 px left of the edge now shows; Contract by 30: 20 px right of it hides
        assert fr.evaluate(LOOKA, [b, 130 / 300]) == 0
        fr.evaluate(GROW, [b, 30, T["grow"]]); frame_tick(fr)
        assert fr.evaluate(LOOKA, [b, 130 / 300]) > 200 and fr.evaluate(f"() => __ed.byId('{b}').mask.grow") == 30
        assert near(fr.evaluate(PX, [830, 300])[:3], fr.evaluate(PX, [950, 300])[:3], 60), "the picture shows to the new edge"
        fr.evaluate(GROW, [b, -30, T["grow"]]); frame_tick(fr)
        assert fr.evaluate(LOOKA, [b, 170 / 300]) < 50 and fr.evaluate(LOOKA, [b, 250 / 300]) == 255
        # Smooth (Select and Mask's): the contour goes round, a thin notch (4 px hidden at x = 900) fills, the edge stays crisp
        fr.evaluate(GROW, [b, 0, T["grow"]]); rect_sel(fr, 900, 0, 904, 450); focus(page, fr)
        page.keyboard.press("Backspace"); fr.evaluate("() => __ed.deselect()")
        assert fr.evaluate(LOOKA, [b, 201 / 300]) == 0
        fr.evaluate(GROW, [b, 20, T["smooth"]]); frame_tick(fr)
        assert fr.evaluate(LOOKA, [b, 201 / 300]) > 200, "the notch is smoothed away"
        assert fr.evaluate(LOOKA, [b, 146 / 300]) < 30 and fr.evaluate(LOOKA, [b, 154 / 300]) > 225, "the long edge stays where it was, crisp"
        assert fr.evaluate(LOOKA, [b, 20 / 300]) == 0 and fr.evaluate(LOOKA, [b, 280 / 300]) == 255
        assert fr.evaluate("() => __ed.S.undo.length") == n0 + 5, "one step for each gesture (four slider moves and the notch)"
        # the plate: bottom centre over the dock, the targeted thumbnail outlined
        pick(fr, b, True); frame_tick(fr); settle(fr, 400)
        plate = fr.evaluate("""() => { const r = document.querySelector('#mplate hy-plate').getBoundingClientRect(); return {
           on: document.getElementById('mplate').classList.contains('on'), x: r.left + r.width / 2, b: r.bottom, w: innerWidth, h: innerHeight }; }""")
        dock = page.evaluate("""() => { const r = document.getElementById('dock').getBoundingClientRect(), f = document.querySelector('.ifed iframe').getBoundingClientRect();
           return { x: r.left + r.width / 2 - f.left, t: r.top - f.top }; }""")
        assert plate["on"] and abs(plate["x"] - dock["x"]) < 2 and 0 < dock["t"] - plate["b"] < 30, (plate, dock)
        assert fr.evaluate(f"() => document.querySelector('#rows .lr[data-id=\"{b}\"] .tb2.msk').classList.contains('edit')")
        for mode in ("black", "white", "bw", "off", "red"):
            fr.locator(f"#mplate hy-segmented button[value={mode}]").click(); settle(fr, 80)
            assert fr.evaluate("() => __ed.S.film ? __ed.S.maskShow : 'off'") == mode
        fr.locator("#mplate hy-segmented button[value=black]").click(); frame_tick(fr)
        shot(page, f"mask-plate-{engine}-dark.png")
        fr.evaluate("() => { document.documentElement.dataset.theme = 'light'; }"); page.evaluate("() => { document.documentElement.dataset.theme = 'light'; }"); settle(fr, 300)
        shot(page, f"mask-plate-{engine}-light.png")
        fr.locator("#mplate hy-button").click(); settle(fr)
        assert not fr.evaluate("() => __ed.S.editMask") and not fr.evaluate("() => document.getElementById('mplate').classList.contains('on')")
        pick(fr, b, True); focus(page, fr); page.keyboard.press("Escape"); settle(fr)
        assert not fr.evaluate("() => __ed.S.editMask"), "Esc leaves the mask"
        assert fr.evaluate(f"() => __ed.byId('{b}').mask.grow") == 0 and fr.evaluate(f"() => __ed.byId('{b}').mask.smooth") == 20
        doc = fr.evaluate("() => __ed.docJSON()")
        mb = next(l for l in doc["layers"] if l["id"] == b)["mask"]; assert mb.get("smooth") == 20, mb
        assert not errors, errors
        browser.close()
