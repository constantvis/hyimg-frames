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
        # ⌥-drag: a copy of b goes over a (a is the base layer, nothing goes under it), b stays where it was; one step to undo
        pick(fr, b); n0, u0 = len(fr.evaluate(ORDER)), fr.evaluate(UNDO)
        bb = fr.locator(row(fr, a)).bounding_box()
        drag(page, fr, center(fr, row(fr, b) + " .nm"), (bb["x"] + 80, bb["y"] + 4), alt=True)
        order = fr.evaluate(ORDER)
        assert len(order) == n0 + 1 and order[0] == a and order[1] not in (a, b) and order.index(b) > 1, order
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


def test_alt_click_on_the_line_clips_alt_drag_of_a_row_copies(hy):
    """The owner (2026-10-09, a Photoshop screenshot of Layer 3 clipped onto Layer 2): «ты что-то перепутал: при нажатии Option и нажатии
    между layers образуется вот такое наложение (clipping mask); Option + зажатие layer и перетягивание = копировать выделенный layer».
    ⌥ over the line between two rows shows the clip line with the clip cursor (it showed the copy cursor); a ⌥-click there clips the upper
    layer to the lower one without changing the selection, its row indented with the clipped mark, the canvas clipped; ⌥-click again
    releases it. A ⌥ press on a row, even on that line, and a drag leave a copy where it drops, also when ⌥ is let go before the drop; a plain
    drag only reorders. The clip is saved, comes back when the studio opens again and is in the render. Chromium, dark."""
    import json
    from PIL import Image
    from playwright.sync_api import sync_playwright
    from editor_kit import PX
    from test_imgframe import closed, editor
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, "chromium")
        a, b = fr.evaluate(PIXELS)   # the list: b over a (a the base); a 0..600, b 700..1000: b clipped to a shows nothing
        pick(fr, a); u0 = fr.evaluate(UNDO)
        before = fr.evaluate(PX, [850, 225])
        # ⌥ over the line under b's row: the clip line, the clip cursor (not the copy one)
        x, y = line_under(fr, b); page.mouse.move(x, y - 10); page.keyboard.down("Alt"); page.mouse.move(x, y, steps=2); settle(fr, 100)
        cur = fr.evaluate("() => [document.getElementById('cliph').classList.contains('on'), document.getElementById('list').style.cursor]")
        assert cur[0] and cur[1].startswith('url("data:image/svg+xml') and "copy" not in cur[1], cur
        # the click: b clipped to a, a still the chosen one, one step; the row indented with its mark; the canvas clipped
        page.mouse.down(); page.mouse.up(); page.keyboard.up("Alt"); settle(fr)
        assert fr.evaluate(f"() => __ed.byId('{b}').clip") is True and fr.evaluate("() => __ed.S.ids") == [a] and fr.evaluate(UNDO) == u0 + 1
        ind = fr.evaluate(f"() => [document.querySelector(\"{row(fr, b)} .ind\").getBoundingClientRect().width, !!document.querySelector(\"{row(fr, b)} .clp svg\"),"
                          f" document.querySelector(\"{row(fr, a)} .ind\").getBoundingClientRect().width]")
        assert ind[1] and ind[0] >= ind[2] + 8, ind
        assert fr.evaluate(PX, [850, 225]) != before, "b clipped to a shows nothing where a is not"
        shot(page, "layers-alt-clip.png")
        # ⌥-click on the same line again: released
        x, y = line_under(fr, b); page.mouse.move(x, y); page.keyboard.down("Alt"); page.mouse.down(); page.mouse.up(); page.keyboard.up("Alt"); settle(fr)
        assert fr.evaluate(f"() => __ed.byId('{b}').clip") is False and fr.evaluate(PX, [850, 225]) == before
        # ⌥ pressed on b's row right at that line and dragged under a's middle: a copy of b, not a clip; b stays
        n0 = len(fr.evaluate(ORDER)); ab = fr.locator(row(fr, a)).bounding_box(); x, y = line_under(fr, b)
        page.mouse.move(x, y - 3); page.keyboard.down("Alt"); page.mouse.down(); page.mouse.move(x, y + 8, steps=2)
        page.mouse.move(x, ab["y"] + 4, steps=8); settle(fr, 80)
        assert fr.evaluate("() => document.getElementById('list').style.cursor") == "copy"
        page.mouse.up(); page.keyboard.up("Alt"); settle(fr)
        order = fr.evaluate(ORDER)
        assert len(order) == n0 + 1 and b in order and not fr.evaluate(f"() => __ed.byId('{b}').clip"), order
        page.keyboard.press("Meta+z"); settle(fr); assert len(fr.evaluate(ORDER)) == n0
        # ⌥ at the press, let go during the drag: still a copy
        pick(fr, b); bb = fr.locator(row(fr, b)).bounding_box(); x, y = bb["x"] + 90, bb["y"] + bb["height"] / 2
        page.mouse.move(x, y); page.keyboard.down("Alt"); page.mouse.down(); page.mouse.move(x, y + 8, steps=2); page.keyboard.up("Alt")
        page.mouse.move(x, ab["y"] + 4, steps=8); settle(fr, 80); page.mouse.up(); settle(fr)
        assert len(fr.evaluate(ORDER)) == n0 + 1
        page.keyboard.press("Meta+z"); settle(fr)
        # a plain drag reorders only
        drag(page, fr, center(fr, row(fr, b) + " .nm"), (ab["x"] + 80, ab["y"] + 4))
        assert len(fr.evaluate(ORDER)) == n0
        page.keyboard.press("Meta+z"); settle(fr)
        # the layer's menu has «Create Clipping Mask ⌥⌘G»; clipped and saved: in the document, in the render, and again after reopening
        fr.locator(row(fr, b)).click(button="right"); settle(fr, 150)
        T = fr.evaluate("() => __ed.T")
        assert [T["createClip"], "⌥⌘G"] in [l[:2] for l in labels(fr)], labels(fr)
        page.keyboard.press("Escape"); settle(fr, 100)
        x, y = line_under(fr, b); page.mouse.move(x, y); page.keyboard.down("Alt"); page.mouse.down(); page.mouse.up(); page.keyboard.up("Alt"); settle(fr)
        assert fr.evaluate(f"() => __ed.byId('{b}').clip") is True
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        fr.click("#topr [data-a=save]"); page.wait_for_function(f"() => board.items['{fid}'].v === 2", timeout=60000); closed(page)
        it = page.evaluate(f"() => board.items['{fid}']"); doc = json.loads((lib / it["doc"]).read_text())
        assert [l["clip"] for l in doc["layers"] if l.get("id") == b] == [True], doc["layers"]
        im = Image.open(lib / it["render"]).convert("RGBA"); assert im.getpixel((850, 225))[3] == 0 and im.getpixel((300, 200))[3] == 255
        page.evaluate(f"() => __frames.openEditor('{fid}')"); fr = editor(page)
        assert fr.evaluate(f"() => __ed.byId('{b}').clip") is True
        assert not errors, errors
        browser.close()


def base_with_mask(page, fr):
    """a (the base layer, locked) gets a mask that hides x < 300; the owner's list: a with its mask, «Layer 1» over it, b on top"""
    a, b = fr.evaluate(PIXELS)
    assert fr.evaluate(f"() => [__ed.byId('{a}').base, __ed.byId('{a}').locks.all]") == [True, True]
    pick(fr, a); fr.evaluate("() => hyEdK.addMask(false)"); rect_sel(fr, 0, 0, 300, 450)
    focus(page, fr); page.keyboard.press("Backspace"); fr.evaluate("() => __ed.deselect()"); settle(fr)
    assert fr.evaluate(MASKA, [a, .2, .5]) == 0 and fr.evaluate(MASKA, [a, .8, .5]) == 255
    fr.evaluate("() => hyEdK.newLayer()"); settle(fr)
    l1 = fr.evaluate("() => __ed.S.ids[0]"); assert fr.evaluate(ORDER)[:3] == [a, l1, b]
    pick(fr, a); return a, l1, b


def test_alt_drag_of_the_locked_base_layer_copies_it(hy):
    """The owner (2026-10-09, in the app, the locked base layer with a mask under «Layer 1»): «Вот я тут зажимаю Option, пытаюсь перетащить
    выше, чтобы скопировать слой базовый ... и у меня ничего не происходит». The base layer kept every drag of itself off the list, ⌥ or not
    (basework.js baseDrop). As Photoshop's Background: the lock keeps it where it is and does not stop ⌥ and a drag from leaving a copy, an
    ordinary unlocked layer with its mask, over Layer 1 or right over the base on its own row; one step; a plain drag still moves nothing.
    Chromium, dark (the owner's app draws with CEF). Fails on the old code."""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, "chromium")
        a, l1, b = base_with_mask(page, fr); n0, u0 = len(fr.evaluate(ORDER)), fr.evaluate(UNDO)
        # a plain drag of the base row up over Layer 1: nothing moves
        lb = fr.locator(row(fr, l1)).bounding_box()
        drag(page, fr, center(fr, row(fr, a) + " .nm"), (lb["x"] + 80, lb["y"] + 4))
        assert fr.evaluate(ORDER)[:3] == [a, l1, b] and len(fr.evaluate(ORDER)) == n0 and fr.evaluate(UNDO) == u0
        # ⌥ and a drag of it up over Layer 1: a copy there, the base where it was, one step; the copy an ordinary layer with a's mask
        drag(page, fr, center(fr, row(fr, a) + " .nm"), (lb["x"] + 80, lb["y"] + 4), alt=True)
        order = fr.evaluate(ORDER)
        assert len(order) == n0 + 1 and order[:2] == [a, l1] and order[3] == b and fr.evaluate(UNDO) == u0 + 1, order
        cp = order[2]
        assert fr.evaluate(f"() => [!!__ed.byId('{cp}').base, __ed.byId('{cp}').locks.all, !!__ed.byId('{cp}').mask, __ed.byId('{a}').base]") == [False, False, True, True]
        assert fr.evaluate("() => __ed.S.ids") == [cp]
        page.keyboard.press("Meta+z"); settle(fr); assert fr.evaluate(ORDER)[:3] == [a, l1, b] and len(fr.evaluate(ORDER)) == n0
        # ⌥ and a short drag up within its own row: the copy lands right over it
        pick(fr, a); ab = fr.locator(row(fr, a)).bounding_box(); x, y = center(fr, row(fr, a) + " .nm")
        drag(page, fr, (x, y), (x, ab["y"] + 3), alt=True)
        order = fr.evaluate(ORDER)
        assert len(order) == n0 + 1 and order[0] == a and order[2] == l1 and not fr.evaluate(f"() => !!__ed.byId('{order[1]}').base"), order
        page.keyboard.press("Meta+z"); settle(fr); assert len(fr.evaluate(ORDER)) == n0
        # nothing goes under it, a copy neither
        pick(fr, l1); drag(page, fr, center(fr, row(fr, l1) + " .nm"), (ab["x"] + 80, ab["y"] + ab["height"] - 3), alt=True)
        assert fr.evaluate(ORDER)[0] == a and len(fr.evaluate(ORDER)) == n0
        assert not errors, errors
        browser.close()


def test_alt_drag_of_the_base_layers_mask_thumbnail_copies_the_mask(hy):
    """The owner (2026-10-09, same list): «либо зажимаю маску, пытаюсь перетащить, зажав Option, и у меня ничего не происходит». ⌥ and a
    drag of the base layer's mask thumbnail, its mask being painted (the thumbnail framed, as in the owner's screenshot), onto Layer 1:
    Layer 1 gets a copy of the mask, the base keeps its own, no row moves, one step. Chromium, dark."""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, "chromium")
        a, l1, b = base_with_mask(page, fr); n0 = len(fr.evaluate(ORDER))
        x, y = center(fr, row(fr, a) + " .tb2.msk"); page.mouse.click(x, y); settle(fr)   # the mask painted: the owner's framed thumbnail
        assert fr.evaluate("() => [!!__ed.S.maskMode, __ed.S.editMask]") == [True, True]
        u0 = fr.evaluate(UNDO)
        drag(page, fr, (x, y), center(fr, row(fr, l1) + " .nm"), alt=True)
        assert fr.evaluate(f"() => [!!__ed.byId('{a}').mask, !!__ed.byId('{l1}').mask]") == [True, True] and fr.evaluate(UNDO) == u0 + 1
        assert fr.evaluate(MASKA, [l1, .2, .5]) == 0 and fr.evaluate(MASKA, [l1, .8, .5]) == 255, "the same mask"
        assert fr.evaluate(ORDER)[:3] == [a, l1, b] and len(fr.evaluate(ORDER)) == n0, "the mask goes, not the row"
        page.keyboard.press("Meta+z"); settle(fr); assert not fr.evaluate(f"() => !!__ed.byId('{l1}').mask")
        assert not errors, errors
        browser.close()


def test_alt_key_with_the_pointer_still_on_the_line_shows_the_clip_cursor(hy):
    """a9e243f: ⌥ over the line between two rows shows the clip line with the clip cursor, «also when ⌥ goes down with the pointer still».
    An older ⌥ key handler in menus.js ran after it and put the copy cursor back. Chromium, dark. Fails on the old code."""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, "chromium")
        a, b = fr.evaluate(PIXELS); focus(page, fr)
        x, y = line_under(fr, b); page.mouse.move(x, y - 10); page.mouse.move(x, y, steps=2); settle(fr, 100)
        page.keyboard.down("Alt"); settle(fr, 100)
        cur = fr.evaluate("() => [document.getElementById('cliph').classList.contains('on'), document.getElementById('list').style.cursor]")
        assert cur[0] and cur[1].startswith('url("data:image/svg+xml') and "copy" not in cur[1], cur
        page.keyboard.up("Alt"); settle(fr, 100)
        assert fr.evaluate("() => [document.getElementById('cliph').classList.contains('on'), document.getElementById('list').style.cursor]") == [False, ""]
        assert not errors, errors
        browser.close()
