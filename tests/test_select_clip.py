"""The image studio's selection, right click and clipboard the Photoshop way (owner 2026-10-07), Chromium and WebKit:

- a plain click on the picture outside the selection drops it, with Select and Move too («как раз должно и сбрасываться»); a click inside
  it, in a panel or in the layer list keeps it; ⌘D deselects, ⇧⌘D brings it back;
- the right click on the picture: with a selection Deselect, Select Inverse, Feather, Modify, Layer Via Copy and Cut, Fill, the mask from
  it; without one Select All, Reselect, Paste, the layers under the pointer, Free Transform, Undo; grey ones say why; keys shown;
- a mask targeted in Layers: ⌘C copies it, ⌘V on another layer makes it that layer's mask (one step; it did nothing: the studio had no
  ⌘C ⌘V of its own); the round trip: the mask ⇧⌘V as a layer, ⌘I on it, ⌘C, the mask targeted, ⌘V: the mask is the inverted one;
- ⌘C on a Raw Editor layer and on a mask puts them on the app's properties clipboard (cv.propsClip, the board's ⌥⌘V); ⌥⌘V in the studio
  pastes what the board copied.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_select_clip.py
  FRAMES_SHOTS=<folder> also saves screenshots
"""
import json

import pytest

from editor_kit import add_adj, ENGINES, MASKA, MASKGRID, PIXELS, at, center, focus, frame_tick, labels, pick, rect_sel, settle, shot, start
from test_imgframe import hy, closed  # noqa: F401  (the fixture)

HAS = "() => __ed.S.hasSel"


@pytest.mark.parametrize("engine", ENGINES)
def test_click_outside_drops_the_selection_and_the_picture_menu(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        a, b = fr.evaluate(PIXELS)
        for tool in ("select", "move", "marquee"):
            fr.evaluate(f"() => __ed.setTool('{tool}')"); rect_sel(fr, 100, 100, 300, 300)
            page.mouse.click(*at(page, fr, 200, 200)); settle(fr, 120)
            assert fr.evaluate(HAS) is (tool != "marquee"), (tool, "a click inside: kept (a marquee click deselects, as in Photoshop)")
            rect_sel(fr, 100, 100, 300, 300)
            page.mouse.click(*at(page, fr, 500, 380)); settle(fr, 120)
            assert fr.evaluate(HAS) is False, (tool, "a click outside drops it")
        # in a panel, in the layer list, on the options bar: kept
        fr.evaluate("() => __ed.setTool('select')"); rect_sel(fr, 100, 100, 300, 300)
        fr.locator(f"#rows .lr[data-id='{a}'] .nm").click(); settle(fr, 120); assert fr.evaluate(HAS)
        page.mouse.click(*center(fr, "#g1 .tabs .sp")); settle(fr, 80); assert fr.evaluate(HAS)
        page.mouse.click(*center(fr, "#obar")); assert fr.evaluate(HAS)
        # ⌘D, ⇧⌘D
        focus(page, fr); page.keyboard.press("Meta+d"); assert fr.evaluate(HAS) is False
        page.keyboard.press("Meta+Shift+d"); assert fr.evaluate(HAS) is True
        # the right click with the selection
        page.mouse.click(*at(page, fr, 200, 200), button="right"); settle(fr)
        L = labels(fr); T = fr.evaluate("() => __ed.T"); M = fr.evaluate("() => hyEdK.W.menus")
        names = [l[0] for l in L]
        for want in (T["deselect"], M["selInverse"], M["layerViaCopy"], M["fill"], M["maskFromSel"], M["deleteFromMask"]):
            assert want in names, (want, names)
        assert dict((l[0], l[1]) for l in L)[T["deselect"]] == "⌘D"
        assert dict((l[0], l[2]) for l in L)[M["deleteFromMask"]], "grey with its reason while no mask is targeted"
        shot(page, f"menu-picture-selection-{engine}.png")
        page.keyboard.press("Escape"); focus(page, fr); page.keyboard.press("Meta+d")
        page.mouse.click(*at(page, fr, 200, 200), button="right"); settle(fr)
        L = labels(fr); names = [l[0] for l in L]
        assert T["selAll"] in names and M["layersHere"] in names and M["paste"] in names, names
        assert dict((l[0], l[2]) for l in L)[M["paste"]], "Paste is grey with nothing copied"
        shot(page, f"menu-picture-{engine}.png")
        page.keyboard.press("Escape")
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ENGINES)
def test_mask_copy_paste_round_trip_and_the_properties_clipboard(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        a, b = fr.evaluate(PIXELS)
        pick(fr, b); fr.evaluate("() => hyEdK.addMask(false)"); rect_sel(fr, 700, 0, 850, 450)
        focus(page, fr); page.keyboard.press("Backspace"); fr.evaluate("() => __ed.deselect()")
        m0 = fr.evaluate(MASKGRID, b)
        # the mask targeted in Layers: ⌘C; a chosen, ⌘V: a's mask (a had none), one step
        fr.locator(f"#rows .lr[data-id='{b}'] .tb2.msk").click(); settle(fr)
        assert fr.evaluate("() => __ed.S.editMask")
        page.keyboard.press("Meta+c"); settle(fr)
        assert fr.evaluate("() => hyEdK.clip && hyEdK.clip.kind") == "mask"
        fr.locator(f"#rows .lr[data-id='{a}'] .nm").click(); settle(fr)
        u0 = fr.evaluate("() => __ed.S.undo.length"); page.keyboard.press("Meta+v"); settle(fr)
        assert fr.evaluate(f"() => !!__ed.byId('{a}').mask") and fr.evaluate("() => __ed.S.undo.length") == u0 + 1
        assert fr.evaluate(MASKA, [a, .5, .5]) == 255, "b's hidden part lies past a, a shows all"
        page.keyboard.press("Meta+z"); settle(fr); assert fr.evaluate(f"() => !__ed.byId('{a}').mask")
        # the round trip: the mask as a layer (⇧⌘V), inverted (⌘I), ⌘C, b's mask targeted, ⌘V: b's mask is the inverted one
        page.keyboard.press("Meta+Shift+v"); settle(fr)
        lay = fr.evaluate("() => __ed.S.ids[0]"); assert lay not in (a, b) and fr.evaluate(f"() => __ed.byId('{lay}').type") == "pixel"
        page.keyboard.press("Meta+i"); page.keyboard.press("Meta+c"); settle(fr)
        assert fr.evaluate("() => hyEdK.clip.kind") == "pixels"
        fr.locator(f"#rows .lr[data-id='{b}'] .tb2.msk").click(); settle(fr)
        page.keyboard.press("Meta+v"); settle(fr)
        m1 = fr.evaluate(MASKGRID, b)
        assert max(abs((255 - x) - y) for x, y in zip(m0, m1)) <= 3, "the mask came back, inverted by its trip through a layer"
        page.keyboard.press("Meta+i"); settle(fr)
        assert max(abs(x - y) for x, y in zip(m0, fr.evaluate(MASKGRID, b))) <= 3, "and once more inverted it is the mask it was"
        # ⌘C on the mask also put it on the app's properties clipboard, a file of its own
        pc = json.loads(fr.evaluate("() => localStorage.getItem('cv.propsClip')"))
        assert pc["kinds"]["mask"]["file"].startswith("frames/board-masks/masks/") and (lib / pc["kinds"]["mask"]["file"]).exists(), pc
        # a Raw Editor layer: ⌘C its settings, onto the properties clipboard too
        add_adj(fr, "{ exposure: 0.7 }")
        focus(page, fr); page.keyboard.press("Meta+c"); settle(fr, 400)
        pc = json.loads(fr.evaluate("() => localStorage.getItem('cv.propsClip')"))
        assert abs(pc["kinds"]["grade"]["exposure"] - 0.7) < 1e-6, pc
        # ⌥⌘V: what the board copied (a grade) onto picture a: a new Raw Editor layer over it with those settings
        fr.evaluate("() => localStorage.setItem('cv.propsClip', JSON.stringify({ from: 'x', at: Date.now() + 5000, kinds: { grade: { exposure: -0.4 } } }))")
        page.request.post(f"http://127.0.0.1:{port}/api/propsclip", data=json.dumps({"from": "x", "at": 1, "kinds": {"grade": {"exposure": -0.4}}}), headers={"Content-Type": "application/json"})
        pick(fr, a); focus(page, fr); page.keyboard.press("Alt+Meta+v"); settle(fr, 500)
        new = fr.evaluate("() => { const n = hyEdK.one(); return { type: n.type, params: n.params }; }")
        assert new["type"] == "adjust" and abs(new["params"]["exposure"] + 0.4) < 1e-6, new["type"]
        # back on the board: the mask copied in the studio pastes onto a picture there
        fr.locator(f"#rows .lr[data-id='{b}'] .tb2.msk").click(); settle(fr); page.keyboard.press("Meta+c"); settle(fr, 600)
        f = json.loads(fr.evaluate("() => localStorage.getItem('cv.propsClip')"))["kinds"]["mask"]["file"]
        fr.evaluate("() => __ed.cancelFrame()"); fr.wait_for_selector("#dlgw.on"); fr.locator("#dlg [data-a=ok]").click()
        closed(page)
        page.evaluate("() => pasteProps(propsClip().kinds, ['g1'])"); page.wait_for_timeout(400)
        assert page.evaluate("() => board.items.g1.mask && board.items.g1.mask.file") == f
        assert not errors, errors
        browser.close()
