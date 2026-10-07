"""The image studio's Layers the Photoshop way (owner 2026-10-07), Chromium and WebKit:

- ⌥-click on the line between two rows clips the upper layer to the lower one and releases it, a Raw Editor layer too (the list skipped
  every adjustment layer as the upper one, so a Raw Editor layer never clipped); ⌥ shows the line with the clip mark;
- a clipped row's mark is the registry's «clipped» arrow, pointing down to its base;
- the master Raw Editor and Mask stand under a «Master layers» band on top: they do not move, nothing goes above them, they do not clip
  and nothing clips to them;
- ⌥-drag of a row leaves a copy where it drops; a drag of a mask's thumbnail onto another layer moves the mask, with ⌥ copies it; one
  step each;
- a row's colour: the right click starts with the note colours, a click colours every chosen row, saved with the layer, one step to undo.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_layers_work.py
  FRAMES_SHOTS=<folder> also saves screenshots in both themes
"""
import pytest

from editor_kit import add_adj, ENGINES, MASKA, PIXELS, center, labels, pick, rect_sel, settle, shot, start, focus
from test_imgframe import hy  # noqa: F401  (the fixture)

ORDER = "() => __ed.root.map(n => n.id)"
UNDO = "() => __ed.S.undo.length"


def row(fr, id): return f"#rows .lr[data-id='{id}']"


def line_under(fr, id):
    b = fr.locator(row(fr, id)).bounding_box(); return b["x"] + 80, b["y"] + b["height"]


def drag(page, fr, frm, to, alt=False, steps=8):
    page.mouse.move(*frm)
    if alt: page.keyboard.down("Alt")
    page.mouse.down(); page.mouse.move(frm[0], frm[1] + 8, steps=2); page.mouse.move(*to, steps=steps); settle(fr, 80)
    page.mouse.up()
    if alt: page.keyboard.up("Alt")
    settle(fr)


@pytest.mark.parametrize("engine", ENGINES)
def test_clip_by_the_line_master_rows_and_alt_drag(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        a, b = fr.evaluate(PIXELS)
        pick(fr, b)
        adj = add_adj(fr); settle(fr)
        # ⌥ over the line under the Raw Editor row: the clip line shows; a click clips it to b, another releases it
        x, y = line_under(fr, adj); page.mouse.move(x, y); page.keyboard.down("Alt"); page.mouse.move(x + 2, y); settle(fr, 100)
        assert fr.evaluate("() => document.getElementById('cliph').classList.contains('on')")
        shot(page, f"layers-clip-line-{engine}.png")
        page.mouse.down(); page.mouse.up(); page.keyboard.up("Alt"); settle(fr)
        assert fr.evaluate(f"() => __ed.byId('{adj}').clip") is True
        # the mark of a clipped row is the registry's «clipped» arrow (it points down to the base), the base's name underlined
        same = fr.evaluate(f"""() => {{ const s = document.querySelector("{row(fr, adj)} .clp svg"),
          r = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); r.innerHTML = HY_TOOL_IC.clipped; return s && s.innerHTML === r.innerHTML; }}""")
        assert same and fr.evaluate(f"""() => document.querySelector("{row(fr, b)} .nm").classList.contains('base')""")
        shot(page, f"layers-clipped-{engine}.png")
        x, y = line_under(fr, adj); page.mouse.move(x, y); page.keyboard.down("Alt"); page.mouse.down(); page.mouse.up(); page.keyboard.up("Alt"); settle(fr)
        assert fr.evaluate(f"() => __ed.byId('{adj}').clip") is False
        # the master rows: a band of their own on top; the line under the master Mask clips nothing; ⌥⌘G on a master does nothing
        band = fr.evaluate("() => [...document.querySelectorAll('#rows .mgrp .lr')].map(r => r.dataset.id)")
        assert band == ["main_grade", "main_mask"], band
        assert fr.evaluate("() => !!document.querySelector('#rows .mgrp .mgh svg') && !document.querySelector('#rows .mgrp .pin svg[data-ic=pin]')")
        x, y = line_under(fr, "main_mask")
        assert fr.evaluate(f"""() => {{ const r = document.querySelector("{row(fr, 'main_mask')}").getBoundingClientRect(); return hyEdK.clipPairAt(r.bottom); }}""") is None
        pick(fr, "main_mask", True); focus(page, fr); page.keyboard.press("Alt+Meta+g"); settle(fr)
        assert not fr.evaluate("() => __ed.byId('main_mask').clip")
        order0 = fr.evaluate(ORDER)
        drag(page, fr, center(fr, row(fr, "main_mask") + " .nm"), center(fr, row(fr, a) + " .nm"))
        assert fr.evaluate(ORDER) == order0, "a master row does not move"
        pick(fr, a); drag(page, fr, center(fr, row(fr, a) + " .nm"), center(fr, row(fr, "main_grade") + " .nm"))
        assert fr.evaluate("() => __ed.root.slice(-2).map(n => n.id)") == ["main_grade", "main_mask"], "nothing goes above the masters"
        # ⌥-drag: a copy of b goes under a, b stays where it was; one step to undo
        pick(fr, b); n0, u0 = len(fr.evaluate(ORDER)), fr.evaluate(UNDO)
        bb = fr.locator(row(fr, a)).bounding_box()
        drag(page, fr, center(fr, row(fr, b) + " .nm"), (bb["x"] + 80, bb["y"] + bb["height"] - 4), alt=True)
        order = fr.evaluate(ORDER)
        assert len(order) == n0 + 1 and b in order and order.index(b) > order.index(a) and order[0] not in (a, b), order
        assert fr.evaluate(UNDO) == u0 + 1
        page.keyboard.press("Meta+z"); settle(fr); assert len(fr.evaluate(ORDER)) == n0
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ENGINES)
def test_mask_thumbnail_drag_and_row_colours(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        a, b = fr.evaluate(PIXELS)
        pick(fr, b); fr.evaluate("() => hyEdK.addMask(false)"); rect_sel(fr, 700, 0, 850, 450)
        focus(page, fr); page.keyboard.press("Backspace"); fr.evaluate("() => __ed.deselect()")   # b's mask: its left half hidden (x < 850)
        # drag b's mask onto a: it moves (b has none, a has it, the hidden part where it was in the document: past a's right edge, so a shows all)
        u0 = fr.evaluate(UNDO)
        drag(page, fr, center(fr, row(fr, b) + " .tb2.msk"), center(fr, row(fr, a) + " .nm"))
        assert fr.evaluate(f"() => !__ed.byId('{b}').mask && !!__ed.byId('{a}').mask") and fr.evaluate(UNDO) == u0 + 1
        page.keyboard.press("Meta+z"); settle(fr)
        assert fr.evaluate(f"() => !!__ed.byId('{b}').mask && !__ed.byId('{a}').mask")
        # ⌥: a copy; b keeps its own; the copy is the same mask in the document (a hidden where b's was: nowhere over a, so set one on b's
        # place by moving a under b first is not needed: compare b's mask and its copy back on b's twin)
        drag(page, fr, center(fr, row(fr, b) + " .tb2.msk"), center(fr, row(fr, a) + " .nm"), alt=True)
        assert fr.evaluate(f"() => !!__ed.byId('{b}').mask && !!__ed.byId('{a}').mask")
        assert fr.evaluate(MASKA, [b, .2, .5]) == 0 and fr.evaluate(MASKA, [a, .5, .5]) == 255
        # ⌥-click on the thumbnail (no drag): the mask alone, again: back
        x, y = center(fr, row(fr, b) + " .tb2.msk"); page.keyboard.down("Alt"); page.mouse.click(x, y); page.keyboard.up("Alt"); settle(fr)
        assert fr.evaluate("() => [__ed.S.film, __ed.S.maskShow, __ed.S.editMask]") == [True, "bw", True]
        page.keyboard.down("Alt"); page.mouse.click(x, y); page.keyboard.up("Alt"); settle(fr)
        assert fr.evaluate("() => __ed.S.maskShow") != "bw"
        # colours: the right click on a row starts with the swatches; on two chosen rows a colour goes to both, one step
        fr.evaluate(f"() => {{ __ed.S.ids = ['{a}', '{b}']; __ed.S.editMask = false; __ed.refresh(); }}"); settle(fr)
        fr.locator(row(fr, a) + " .nm").click(button="right"); settle(fr)
        assert fr.evaluate("() => document.querySelector('#menu').firstElementChild.classList.contains('msw')")
        assert fr.evaluate("() => document.querySelectorAll('#menu .msw [data-color]').length") == 9
        shot(page, f"layers-colour-menu-{engine}.png")
        u0 = fr.evaluate(UNDO)
        fr.locator("#menu .msw [data-color=green]").click(); settle(fr)
        assert fr.evaluate(f"() => [__ed.byId('{a}').color, __ed.byId('{b}').color]") == ["green", "green"] and fr.evaluate(UNDO) == u0 + 1
        assert fr.evaluate(f"""() => {{ const r = document.querySelector("{row(fr, a)}");
          return r.classList.contains('hy-rc') && getComputedStyle(r).getPropertyValue('--hy-rc').trim(); }}""") == "#7fd49b"
        doc = fr.evaluate("() => __ed.docJSON()"); assert {l["id"]: l.get("color") for l in doc["layers"]} == {a: "green", b: "green"}
        fr.evaluate("() => __ed.S.ids = []"); fr.evaluate("() => __ed.refresh()"); settle(fr)
        shot(page, f"layers-coloured-{engine}-dark.png")
        page.evaluate("() => { document.documentElement.dataset.theme = 'light'; }"); fr.evaluate("() => { document.documentElement.dataset.theme = 'light'; }"); settle(fr, 300)
        shot(page, f"layers-coloured-{engine}-light.png")
        page.keyboard.press("Meta+z"); settle(fr)
        assert fr.evaluate(f"() => [__ed.byId('{a}').color || '', __ed.byId('{b}').color || '']") == ["", ""]
        # the master rows' right click: what does not apply is grey with its reason, nothing hidden
        fr.locator(row(fr, "main_grade") + " .nm").click(button="right"); settle(fr)
        L = labels(fr); grey = [l for l in L if l[2]]
        assert grey and all(l[2] for l in grey) and any(l[0] for l in L if not l[2]), L
        page.keyboard.press("Escape")
        assert not errors, errors
        browser.close()
