"""Image Studio's critical and high findings of the П4 logic audit (2026-10-10, hyimg docs/process.md §5), each as the person meets it.
Chromium, the dark theme, a temporary library:

- S-03 «Close without saving?»: «Keep editing» has the focus, ↵ keeps the studio, ⌘K waits, ⌘↵ saves; Hyimg's one question (hyConfirm)
- S-10 after a dialog closes (Canvas Size, Esc) the studio's keys work at once; Tab stays inside an open dialog
- S-11 Esc with Hue/Saturation's eyedropper waiting puts the eyedropper away, the studio stays
- S-12 a double click on a layer's name renames it
- S-23 ⌘↵ inside Actions saves, it does not run the lit command
- S-22 ⌘Z after the Save of a picture opened in the studio takes back only the picture, a card another window added stays
- S-16 an annotation on a picture not saved yet as a frame is tied to the picture, not to a layer that would not exist
- S-06 the board's keys wait while the studio is open

  HYIMG_REPO=<Hyimg checkout> nice -n 10 python3 -m pytest tests/test_p4_logic.py
"""
import json, time, urllib.request

from playwright.sync_api import sync_playwright

from test_imgframe import hy, editor, closed  # noqa: F401  (hy is the fixture)

BOARD = "() => JSON.stringify([Object.keys(board.items).sort(), Object.values(board.items).map(i => [i.x, i.y, i.opacity ?? 1]), cam.z.toFixed(3)])"


def open_board(p, port):
    br = p.chromium.launch(); page = br.new_page(viewport={"width": 1440, "height": 900}, color_scheme="dark")
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{port}/canvas.html")
    page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
    page.wait_for_selector(".it[data-id=a1]")
    return br, page, errors


def open_frame(page):
    page.evaluate("sel = new Set(['a1', 'b1']); render(); fit()"); time.sleep(0.6)
    page.keyboard.press("Alt+Meta+KeyG")
    page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
    fid = page.evaluate("() => Object.entries(board.items).find(([k, it]) => it.type === 'imgframe')[0]")
    page.wait_for_timeout(1200); page.dblclick(f".plg[data-id='{fid}']")
    fr = editor(page); fr.wait_for_function("() => window.__ed && __ed.ready", timeout=30000); fr.wait_for_timeout(900)
    return fid, fr


def focus(page, fr):
    b = fr.locator("#g2 .tabs .sp").first.bounding_box(); page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2); fr.wait_for_timeout(80)


def is_open(page): return page.evaluate("() => !!__frames.ED")


def dirty(fr): fr.evaluate("() => hyEdK.edit('Opacity Change', () => { __ed.root[0].opacity = 77; })")   # a step: the work differs from the save


def cancel(page, fr): fr.click("#topr [data-a=cancel]"); fr.wait_for_timeout(150)   # the Cancel button: Esc keeps the work (S-27)


def test_keys_dialogs_and_layer_rename(hy):
    port, lib, state = hy
    with sync_playwright() as p:
        br, page, errors = open_board(p, port)
        fid, fr = open_frame(page); focus(page, fr)
        # S-06: the board's keys wait behind the studio (the keyboard on the board's own page)
        page.evaluate("document.activeElement && document.activeElement.blur(); window.focus()"); b0 = page.evaluate(BOARD)
        for k in ("l", "3", "Shift+Digit1", "Meta+a", "Meta+d", "Meta+x"):
            page.evaluate("document.activeElement && document.activeElement.blur(); window.focus()"); page.keyboard.press(k); page.wait_for_timeout(200)
            assert page.evaluate(BOARD) == b0, f"{k} changed the board behind Image Studio"
        focus(page, fr)
        # S-12: a double click on a layer's name renames it
        fr.evaluate("() => { __ed.S.ids = [__ed.root[0].id]; __ed.refresh(); }"); fr.wait_for_timeout(150)   # another row chosen: the first press rebuilds the rows
        lid = fr.evaluate("() => __ed.root.find(n => n.type === 'pixel' && n.name === 'b').id")
        nm = fr.locator(f".lr[data-id='{lid}'] .nm").bounding_box()
        page.mouse.dblclick(nm["x"] + 8, nm["y"] + nm["height"] / 2)
        fr.wait_for_function("() => !!document.querySelector('.lr .nm input')", timeout=3000)
        page.keyboard.press("Meta+a"); page.keyboard.type("Renamed"); page.keyboard.press("Enter"); fr.wait_for_timeout(200)
        assert fr.evaluate(f"() => __ed.byId('{lid}').name") == "Renamed"
        # S-10: Canvas Size, Esc: the keys work at once; Tab stays inside while it is open
        focus(page, fr); page.keyboard.press("Meta+Alt+c"); fr.wait_for_function("() => document.getElementById('dlgw').classList.contains('on')")
        for _ in range(8):
            page.keyboard.press("Tab"); assert fr.evaluate("() => document.getElementById('dlg').contains(document.activeElement)"), "Tab left the dialog"
        page.keyboard.press("Escape"); fr.wait_for_timeout(250)
        page.keyboard.press("b"); fr.wait_for_timeout(120)
        assert fr.evaluate("() => __ed.S.tool") == "brush", "a key after the dialog closed did nothing"
        page.keyboard.press("v"); fr.wait_for_timeout(80)
        # S-11: Esc with Hue/Saturation's eyedropper waiting: the eyedropper goes, the studio stays
        fr.evaluate("() => { __ed.S.hsPick = () => {}; }"); page.keyboard.press("Escape"); fr.wait_for_timeout(400)
        assert is_open(page) and not fr.evaluate("() => !!__ed.S.hsPick")
        # S-03: Cancel with changes asks; «Keep editing» has the focus, ↵ keeps the studio, ⌘K waits, Esc keeps it
        dirty(fr); cancel(page, fr)
        fr.wait_for_selector("#hyConfirm.on", timeout=5000); fr.wait_for_timeout(150)
        assert fr.evaluate("() => document.activeElement && document.activeElement.dataset.a") == "no"
        assert [x.strip() for x in fr.locator("#hyConfirm button").all_inner_texts()] == ["Сбросить", "Продолжить", "Сохранить"]
        page.keyboard.press("Enter"); fr.wait_for_timeout(500)
        assert is_open(page) and not fr.evaluate("() => !!document.getElementById('hyConfirm')"), "↵ in the question closed the studio"
        cancel(page, fr); fr.wait_for_selector("#hyConfirm.on", timeout=5000)
        page.keyboard.press("Meta+k"); fr.wait_for_timeout(200)
        assert not fr.evaluate("() => __ed.actsOpen()"), "Actions opened over the question"
        page.keyboard.press("Escape"); fr.wait_for_timeout(400)
        assert is_open(page) and not fr.evaluate("() => !!document.getElementById('hyConfirm')")
        # ⌘↵ in the question saves
        cancel(page, fr); fr.wait_for_selector("#hyConfirm.on", timeout=5000)
        page.keyboard.press("Meta+Enter"); closed(page)
        assert page.evaluate(f"() => board.items['{fid}'].rv") >= 2, "⌘↵ in the question did not save"
        # S-23: ⌘↵ inside Actions saves too
        page.wait_for_timeout(800); page.dblclick(f".plg[data-id='{fid}']"); fr = editor(page); fr.wait_for_function("() => __ed.ready"); fr.wait_for_timeout(900)
        rv = page.evaluate(f"() => board.items['{fid}'].rv"); dirty(fr); focus(page, fr)
        page.keyboard.press("Meta+k"); fr.wait_for_function("() => __ed.actsOpen()"); page.keyboard.press("Meta+Enter"); closed(page)
        assert page.evaluate(f"() => board.items['{fid}'].rv") > rv, "⌘↵ in Actions did not save"
        assert not errors, errors
        br.close()


def test_picture_save_undo_and_its_annotation(hy):
    port, lib, state = hy
    with sync_playwright() as p:
        br, page, errors = open_board(p, port)
        page.evaluate("fit()"); page.wait_for_timeout(400)
        page.dblclick(".it[data-id=a1]"); fr = editor(page); fr.wait_for_function("() => __ed.ready"); fr.wait_for_timeout(900)
        # S-16: an annotation on the picture, not a frame yet: tied to the picture itself
        focus(page, fr); page.keyboard.press("c"); fr.wait_for_timeout(120)
        off = page.evaluate("() => { const w = document.querySelector('.ifed iframe').getBoundingClientRect(); return [w.left, w.top]; }")
        V = fr.evaluate("() => ({ x: __ed.V.x, y: __ed.V.y, s: __ed.V.s })")
        page.mouse.click(off[0] + V["x"] + 300 * V["s"], off[1] + V["y"] + 200 * V["s"]); page.wait_for_selector("#cmthread.open textarea", timeout=5000)
        page.keyboard.type("On the picture"); page.keyboard.press("Enter"); page.wait_for_timeout(900)
        th = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/comments?name=main"))["items"]
        assert len(th) == 1 and "part" not in th[0]["anchor"] and th[0]["anchor"]["file"] == "pics/a.png", th[0]["anchor"]
        page.keyboard.press("Escape"); page.wait_for_timeout(200); focus(page, fr); page.keyboard.press("v")
        # S-22: another window adds a card while the studio is open; Save, then ⌘Z on the board: the picture is back, the card stays
        ctx2 = br.new_context(viewport={"width": 1200, "height": 800}, color_scheme="dark"); p2 = ctx2.new_page()
        p2.goto(f"http://127.0.0.1:{port}/canvas.html"); p2.wait_for_selector(".it[data-id=b1]"); p2.wait_for_timeout(800)
        p2.evaluate("() => { const b = snap(); board.items.zz = { path: 'pics/lib.png', x: 0, y: 1500, w: 300, ar: 1, crop: null }; commit(b); render(); }")
        page.wait_for_function("() => !!board.items.zz", timeout=20000)
        dirty(fr); focus(page, fr); page.keyboard.press("Meta+Enter"); closed(page)
        page.wait_for_function("() => board.items.a1.type === 'imgframe'")
        page.wait_for_timeout(800); page.evaluate("document.activeElement && document.activeElement.blur(); window.focus()")
        page.keyboard.press("Meta+z"); page.wait_for_function("() => !board.items.a1.type", timeout=10000)
        assert page.evaluate("() => !!board.items.zz"), "⌘Z after the studio's Save took another window's card away"
        assert not errors, errors
        br.close()
