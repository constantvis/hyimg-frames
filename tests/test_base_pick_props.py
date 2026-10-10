"""The image studio, 2026-10-07 (owner): ⌘ picks the layer under the pointer as in Photoshop (editor/pickwork.js), the bottom picture is the
base layer, locked, only hidden (basework.js), and the master Raw Editor and the master Mask copy from their rows' right click onto the
board's properties clipboard (HY.props), which pastes them on the board's pictures and back into a studio (menus.js, clipwork.js).
Chromium, dark, temporary libraries only.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_base_pick_props.py
  FRAMES_SHOTS=<folder> also saves screenshots
"""
import json
import time

import pytest

from editor_kit import MASKA, at, focus, labels, settle, start
from test_imgframe import SHOTS, closed, editor, hy, shot  # noqa: F401  (hy is the fixture)
from test_master_mask import alpha_at

LAYERS = """() => __ed.root.filter(n => !n.main && !n.mmask).map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, base: !!n.base,
  all: !!n.locks.all, visible: n.visible }))"""


def dark(page, fr):
    page.emulate_media(color_scheme="dark")   # the app's theme is «auto» here: it follows this when it applies itself again
    page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }"); settle(fr, 300)


def row(id): return f"#rows .lr[data-id='{id}']"


def mid(n): return n["x"] + n["w"] / 2, n["y"] + n["h"] / 2


def put_clip(page, kinds):
    """the properties clipboard holds these kinds, newest, in this page and on the server (as a copy makes it)"""
    page.evaluate("""async kinds => { const c = { from: 'test', src: { w: 1000, h: 450, type: 'imgframe' }, at: Date.now(), kinds };
      localStorage.setItem('cv.propsClip', JSON.stringify(c));
      await fetch('/api/propsclip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }); }""", kinds)


def menu_of(fr, id):
    fr.locator(row(id) + " .nm").click(button="right"); settle(fr, 200)
    return {l[0]: (l[1], l[2]) for l in labels(fr)}


@pytest.mark.parametrize("hy", ["en"], indirect=True)
def test_cmd_picks_outlines_and_drags_the_layer_under_the_pointer(hy):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, hy[0], "chromium")
        dark(page, fr)
        L = fr.evaluate(LAYERS); base = next(n for n in L if n["base"]); top = next(n for n in L if not n["base"])
        fr.evaluate("() => { __ed.setTool('select'); __ed.S.ids = []; __ed.refresh(); }"); settle(fr)
        assert fr.locator("#obar .pkh").inner_text() == "⌘ drags the layer under the pointer"
        focus(page, fr)
        # ⌘ over the upper picture: its outline and its row light up; over the base nothing (it is locked)
        lx = top["x"] + 40   # the upper picture's left part: the panels stand over its right
        page.mouse.move(*at(page, fr, lx, mid(top)[1])); page.keyboard.down("Meta"); page.mouse.move(*at(page, fr, lx + 2, mid(top)[1])); settle(fr)
        assert fr.evaluate("() => __ed.S.hoverRow") == top["id"]
        assert fr.locator(row(top["id"]) + ".pk").count() == 1
        shot(page, "pick-1-cmd-hover-dark.png")
        if SHOTS: page.screenshot(path=f"{SHOTS}/pick-2-cmd-hover-zoom-dark.png", clip={"x": 820, "y": 90, "width": 620, "height": 360})
        page.mouse.move(*at(page, fr, *mid(base))); settle(fr)
        assert fr.evaluate("() => __ed.S.hoverRow") is None
        # ⌘-drag on the upper picture: it is picked and moves at once, the base stays
        x0, y0 = at(page, fr, lx, mid(top)[1])
        page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0 - 30, y0 + 20, steps=6); page.mouse.up(); settle(fr)
        L2 = {n["id"]: n for n in fr.evaluate(LAYERS)}
        assert fr.evaluate("() => __ed.S.ids") == [top["id"]]
        assert L2[top["id"]]["x"] < top["x"] - 5 and L2[top["id"]]["y"] > top["y"] + 5, (top, L2[top["id"]])
        assert (L2[base["id"]]["x"], L2[base["id"]]["y"]) == (base["x"], base["y"])
        # ⌘ still held: ⌘Z is a key as before, it undoes the move
        page.keyboard.press("z"); settle(fr)
        L3 = {n["id"]: n for n in fr.evaluate(LAYERS)}
        assert (L3[top["id"]]["x"], L3[top["id"]]["y"]) == (top["x"], top["y"])
        page.keyboard.up("Meta"); page.mouse.move(*at(page, fr, lx + 4, mid(top)[1])); settle(fr)
        assert fr.evaluate("() => __ed.S.hoverRow") is None, "⌘ up: back to the tool's own way"
        # Move with Auto-Select on: ⌘ turns it off, a drag from the base's area moves what is selected
        fr.evaluate(f"() => {{ __ed.setTool('move'); __ed.S.autoSel = true; __ed.S.ids = ['{top['id']}']; __ed.refresh(); }}"); settle(fr)
        assert fr.locator("#obar .pkh").inner_text() == "⌘ moves without Auto-Select"
        bx, by = at(page, fr, *mid(base))
        page.keyboard.down("Meta"); page.mouse.move(bx, by); page.mouse.down(); page.mouse.move(bx + 40, by, steps=5); page.mouse.up(); page.keyboard.up("Meta"); settle(fr)
        L4 = {n["id"]: n for n in fr.evaluate(LAYERS)}
        assert fr.evaluate("() => __ed.S.ids") == [top["id"]] and L4[top["id"]]["x"] > top["x"] + 5 and fr.evaluate("() => __ed.S.autoSel")
        assert L4[base["id"]]["x"] == base["x"]
        # Move with Auto-Select off: ⌘ picks as Select does
        fr.evaluate("() => { __ed.S.autoSel = false; __ed.S.ids = []; __ed.refresh(); __ed.setTool('select'); __ed.setTool('move'); }"); settle(fr)
        assert fr.locator("#obar .pkh").inner_text() == "⌘ picks the layer under the pointer"
        x0, y0 = at(page, fr, L4[top["id"]]["x"] + 20, mid(top)[1])   # its left part: the panels stand over its right
        page.keyboard.down("Meta"); page.mouse.move(x0, y0); page.mouse.move(x0 + 1, y0); settle(fr)
        assert fr.evaluate("() => __ed.S.hoverRow") == top["id"]
        page.mouse.down(); page.mouse.up(); page.keyboard.up("Meta"); settle(fr)
        assert fr.evaluate("() => __ed.S.ids") == [top["id"]]
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("hy", ["en"], indirect=True)
def test_the_base_layer_is_locked_only_hidden(hy):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, "chromium")
        dark(page, fr)
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        # a frame saved before: no flag in its file; it opens with its bottom original as the base, locked, and nothing to save
        doc = json.loads((lib / page.evaluate(f"() => board.items['{fid}'].doc")).read_text())
        assert not any("base" in l for l in doc["layers"])
        L = fr.evaluate(LAYERS); base = L[0]
        assert base["base"] and base["all"] and not any(n["base"] for n in L[1:]), L
        assert fr.evaluate("() => __ed.S.ver === __ed.S.savedVer"), "loading marks nothing as changed"
        # its row: a shut padlock that is a mark, not a button; a click on it changes nothing
        assert fr.locator(row(base["id"]) + " .rb.bse .hy-lock.locked, " + row(base["id"]) + " .rb.bse svg").count() >= 1
        assert fr.locator(row(base["id"]) + " [data-a=lock]").count() == 0
        fr.locator(row(base["id"]) + " .rb.bse").click(); settle(fr)
        assert fr.evaluate(f"() => __ed.byId('{base['id']}').locks.all")
        fr.locator(row(base["id"]) + " .nm").click(); settle(fr)
        shot(page, "base-1-row-locked-dark.png")
        # its menu: what would change it grey with the reason; Duplicate and Hide do
        M = menu_of(fr, base["id"])
        why = "Base layer: only hide"
        for k in ("Delete Layer", "Rename Layer", "Group Layers", "Unlock Layer"):
            assert M[k][1] == why, (k, M)
        assert M["Duplicate Layer"][1] is None and M["Hide Layer"][1] is None, M
        shot(page, "base-2-menu-dark.png")
        page.keyboard.press("Escape"); settle(fr)
        # the layer above it: Merge Down grey, nothing merges into the base
        M2 = menu_of(fr, L[1]["id"])
        assert M2["Merge Down"][1] == why, M2
        page.keyboard.press("Escape"); settle(fr)
        # the keys: ⌫, ⌘T, ⌘E and a drag with Move do nothing to it; the eye hides and shows it
        fr.evaluate(f"() => {{ __ed.S.ids = ['{base['id']}']; __ed.refresh(); }}"); focus(page, fr)
        page.keyboard.press("Backspace"); page.keyboard.press("Meta+t"); settle(fr)
        assert len(fr.evaluate(LAYERS)) == 2 and not fr.evaluate("() => !!__ed.S.xf")
        fr.evaluate(f"() => {{ __ed.S.ids = ['{L[1]['id']}']; __ed.refresh(); }}"); page.keyboard.press("Meta+e"); settle(fr)
        assert len(fr.evaluate(LAYERS)) == 2
        fr.evaluate("() => { __ed.setTool('move'); __ed.S.autoSel = true; }")
        x0, y0 = at(page, fr, *mid(base))
        page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x0 + 50, y0 + 30, steps=5); page.mouse.up(); settle(fr)
        b2 = fr.evaluate(LAYERS)[0]
        assert (b2["x"], b2["y"]) == (base["x"], base["y"]) and fr.evaluate("() => __ed.S.ids") == [base["id"]]
        fr.locator(row(base["id"]) + " [data-a=eye]").click(); settle(fr)
        assert not fr.evaluate(LAYERS)[0]["visible"]
        fr.locator(row(base["id"]) + " [data-a=eye]").click(); settle(fr)
        assert fr.evaluate(LAYERS)[0]["visible"]
        # Duplicate: the copy is a normal layer, unlocked
        fr.evaluate(f"() => {{ __ed.S.ids = ['{base['id']}']; __ed.refresh(); }}"); page.keyboard.press("Meta+j"); settle(fr)
        L5 = fr.evaluate(LAYERS)
        assert len(L5) == 3 and L5[0]["base"] and not L5[1]["base"] and not L5[1]["all"], L5
        # nothing goes under it in the list
        assert fr.evaluate("""([a, b]) => { const n = __ed.byId(a), bs = __ed.byId(b);
          return hyEdK.baseDrop([n], { ref: bs, pos: 'below' }) && hyEdK.baseDrop([bs], { ref: n, pos: 'above' }) && !hyEdK.baseDrop([n], { ref: bs, pos: 'above' }); }""",
                           [L5[1]["id"], base["id"]])
        # Save writes the flag, the next open keeps it
        fr.evaluate("() => hyEdK.undo()"); settle(fr)
        fr.click("#topr [data-a=save]")
        page.wait_for_function(f"() => board.items['{fid}'].v === 2", timeout=60000)
        closed(page)
        doc2 = json.loads((lib / page.evaluate(f"() => board.items['{fid}'].doc")).read_text())
        assert doc2["layers"][0].get("base") is True and doc2["layers"][0]["locks"]["all"] and "base" not in doc2["layers"][1], doc2["layers"]
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("hy", ["en"], indirect=True)
def test_master_raw_editor_and_mask_copy_to_the_board_and_back(hy):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, "chromium")
        dark(page, fr)
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        # a graded master and a master mask hiding the left half
        fr.evaluate("""() => { const K = hyEdK, g = __ed.byId('main_grade'), m = K.mmNode().mask;
          K.edit('x', () => { g.params = Object.assign(K.HyCG.defaults(), { exposure: 1, saturation: -30 });
            const c = K.mk(m.c.width, m.c.height), x = c.getContext('2d'); x.fillStyle = '#fff';
            x.fillRect(c.width / 2, 0, c.width / 2, c.height); c._v = (m.c._v | 0) + 1; m.c = c; }); K.refresh(); }""")
        settle(fr)
        M = menu_of(fr, "main_grade")
        assert M["Copy Raw Editor"] == ("⌘C", None) and M["Paste Raw Editor"] == ("⌥⌘V", "No Raw Editor copied yet"), M
        shot(page, "props-1-master-raw-editor-menu-dark.png")
        fr.locator("#menu [role=menuitem]", has_text="Copy Raw Editor").click(); settle(fr)
        clip = json.loads(fr.evaluate("() => localStorage.getItem('cv.propsClip')"))
        assert clip["kinds"]["grade"]["exposure"] == 1 and clip["kinds"]["grade"]["saturation"] == -30 and "mask" not in clip["kinds"], clip
        M = menu_of(fr, "main_mask")
        assert M["Copy Mask"] == ("⌘C", None) and M["Paste Mask"][0] == "⌥⌘V", M
        assert list(M).count("Copy Mask") == 1, "the master mask's own list has no second copy"
        shot(page, "props-2-master-mask-menu-dark.png")
        fr.locator("#menu [role=menuitem]", has_text="Copy Mask").first.click()
        fr.wait_for_function("() => { const c = JSON.parse(localStorage.getItem('cv.propsClip') || 'null'); return c && c.kinds.mask && c.kinds.mask.file; }")
        mclip = json.loads(fr.evaluate("() => localStorage.getItem('cv.propsClip')"))["kinds"]["mask"]
        assert (lib / mclip["file"]).exists() and alpha_at(lib / mclip["file"], .25, .5) == 0 and alpha_at(lib / mclip["file"], .75, .5) == 255
        fr.evaluate("() => { __ed.S.savedVer = __ed.S.ver; __ed.S.savedTop = __ed.S.undo[__ed.S.undo.length - 1] || null; __ed.cancelFrame(); }")   # leave without the question about the changes
        closed(page)
        # on the board: ⌥⌘V puts the mask on a picture; then the Raw Editor, copied again, the same as the master's
        page.evaluate("() => { sel = new Set(['g1']); render(); }"); time.sleep(0.3)
        page.keyboard.press("Alt+Meta+v")
        page.wait_for_function(f"() => board.items.g1.mask && board.items.g1.mask.file === '{mclip['file']}'", timeout=10000)
        put_clip(page, clip["kinds"])
        page.keyboard.press("Alt+Meta+v")
        page.wait_for_function("() => board.items.g1.grade && board.items.g1.grade.exposure === 1", timeout=10000)
        assert page.evaluate("() => board.items.g1.grade") == clip["kinds"]["grade"]
        shot(page, "props-3-board-pasted-dark.png")
        # back into a studio: the master cleared, then Paste Raw Editor and Paste Mask from the rows, one step each
        page.wait_for_timeout(800)
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page); fr.wait_for_timeout(600)
        fr.evaluate("""() => { const K = hyEdK, g = __ed.byId('main_grade'), m = K.mmNode().mask;
          K.edit('x', () => { g.params = K.HyCG.defaults(); const c = K.mk(m.c.width, m.c.height), x = c.getContext('2d');
            x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); c._v = (m.c._v | 0) + 1; m.c = c; }); K.refresh(); }""")
        M = menu_of(fr, "main_grade")
        assert M["Paste Raw Editor"] == ("⌥⌘V", None), M
        n0 = fr.evaluate("() => __ed.S.undo.length")
        fr.locator("#menu [role=menuitem]", has_text="Paste Raw Editor").click()
        fr.wait_for_function("() => __ed.byId('main_grade').params.exposure === 1")
        assert fr.evaluate("() => __ed.S.undo.length") == n0 + 1 and fr.evaluate("() => __ed.root.filter(n => n.type === 'adjust').length") == 2
        put_clip(page, {"mask": mclip})
        M = menu_of(fr, "main_mask")
        assert M["Paste Mask"] == ("⌥⌘V", None), M
        fr.locator("#menu [role=menuitem]", has_text="Paste Mask").click()
        fr.wait_for_function(f"() => __ed.S.undo.length === {n0 + 2}")
        assert fr.evaluate(MASKA, ["main_mask", .25, .5]) < 40 and fr.evaluate(MASKA, ["main_mask", .75, .5]) > 215
        assert fr.evaluate("() => __ed.byId('main_grade').params.exposure") == 1, "the mask's paste leaves the Raw Editor"
        fr.evaluate("() => hyEdK.undo()"); settle(fr)
        assert fr.evaluate(MASKA, ["main_mask", .25, .5]) == 255
        assert not errors, errors
        browser.close()
