"""A double click on a picture enters the image studio, the dock's Image mode (owner 2026-10-07: «давай при двойном нажатии на картинку мы
будем в режим картинки переходить, а не trim, trim добавим в меню сверху, которое появляется»). The picture opens as a frame of its own
under its own id with no step in the board's history, built in memory: nothing is written to the library before the first Save (owner
2026-10-07: a cancelled double click must not leave a frames/<stamp>/ folder). While the frame is made the switch already shows Image and
the card shimmers (the dock's sweep). Esc leaves it a picture, with the selection and the view of before, the library byte for byte as it
was; Save makes it a frame in one undo step and writes exactly one frame folder. The crop is «Кроп» on the bar over the picture.
Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_picture_dblclick.py
"""
import json

import pytest

from test_imgframe import WEBKIT, board, closed, editor, hy, open_board, sha   # noqa: F401 (hy is the fixture)

CAM = "() => [cam.x, cam.y, cam.z]"
PRESSED = "[...document.querySelectorAll('#modes > button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.mode)"


def near(a, b): return all(abs(x - y) < 1e-6 * max(1, abs(y)) for x, y in zip(a, b))


# the next /api/sizes waits until window.__release() (the frame of the picture stays «being made» meanwhile)
HOLD = """() => { const f = window.__f0 || (window.__f0 = window.fetch); window.__release = null;
  window.fetch = (u, o) => String(u).includes('/api/sizes') ? new Promise(r => { window.__release = () => { window.fetch = f; r(); }; }).then(() => f(u, o)) : f(u, o); }"""


def library(lib): return {str(p.relative_to(lib)): sha(p) for p in sorted(lib.rglob("*")) if p.is_file() and "_thumbs" not in p.parts}


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_double_click_on_a_picture_opens_the_image_mode(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit (python3 -m playwright install webkit)")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    before = {p: sha(lib / p) for p in ("pics/a.png", "pics/b.jpg")}
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate("() => { cam.x = -80; cam.y = -120; cam.z = 0.9; renderCam(); sel = new Set(); render(); }")
        page.wait_for_timeout(300)
        cam0, steps0, files0 = page.evaluate(CAM), page.evaluate("() => past.length"), library(lib)
        # the frame waits here on purpose (the picture's size is held back until released): Image is chosen at once and the card shimmers
        page.evaluate(HOLD)
        page.dblclick(".it[data-id=a1]")
        page.wait_for_function(f"() => {PRESSED}.join() === 'image' && !!window.__release", timeout=2000)
        page.wait_for_function("""() => { const c = document.querySelector('.it[data-id=a1].working');   // the dock follows in 40 ms (showBusy)
          return !!c && getComputedStyle(c, '::after').animationName === 'dockShimmer' && document.getElementById('dock').getAttribute('aria-busy') === 'true'
            && !document.querySelector('.ifed.on') && !board.items.a1.type; }""", timeout=1000)
        page.evaluate("() => window.__release()")
        fr = editor(page)
        assert not page.evaluate("() => !!document.querySelector('[data-id=a1].working')")
        # the studio is open on the picture, the switch shows Image; the picture is a frame under its own id, nothing in the history yet
        page.wait_for_function(f"() => {PRESSED}.join() === 'image'")
        a1 = page.evaluate("() => board.items.a1")
        assert a1["type"] == "imgframe" and a1["pics"] == ["pics/a.png"] and (a1["x"], a1["y"], a1["w"]) == (0, 0, 600), a1
        assert page.evaluate("() => !cropState && past.length") == steps0
        assert fr.evaluate("() => __ed.root.filter(n => !n.main && !n.mmask).map(n => n.src && n.src.path)") == ["pics/a.png"]
        # the studio zooms the board's own camera; Esc brings the picture, the selection and the view back
        fr.evaluate("() => __ed.zoomTo(__ed.V.s * 1.6, null, null, false)"); page.wait_for_timeout(200)
        assert not near(page.evaluate(CAM), cam0)
        fr.locator("body").press("Escape")
        closed(page, 10000)
        page.wait_for_function(f"() => {{ const c = [cam.x, cam.y, cam.z], o = {json.dumps(cam0)}; return c.every((v, i) => Math.abs(v - o[i]) < 1e-6 * Math.max(1, Math.abs(o[i]))); }}", timeout=5000)
        a1 = page.evaluate("() => board.items.a1")
        assert "type" not in a1 and a1["path"] == "pics/a.png" and (a1["x"], a1["w"]) == (0, 600), a1
        assert page.evaluate("() => [...sel]") == ["a1"] and page.evaluate("() => past.length") == steps0
        assert page.evaluate(f"() => {PRESSED}") == ["board"]
        page.wait_for_function("() => !dirty", timeout=10000)
        assert board(state)["items"]["a1"].get("type") is None
        assert library(lib) == files0   # nothing written: no frames/<stamp>/ left behind
        # Esc while the frame is still being made calls it off: Board again, the picture, nothing written
        page.evaluate(HOLD)
        page.dblclick(".it[data-id=a1]")
        page.wait_for_function(f"() => {PRESSED}.join() === 'image' && !!window.__release", timeout=2000)
        page.keyboard.press("Escape")
        page.wait_for_function(f"() => {PRESSED}.join() === 'board'", timeout=1000)
        page.evaluate("() => window.__release()"); page.wait_for_timeout(800)
        assert not page.evaluate("() => !!document.querySelector('.ifed.on') || !!board.items.a1.type || !!document.querySelector('[data-id=a1].working')")
        assert library(lib) == files0
        # again, and Save: one step from the picture to the frame, the same selection and view
        page.dblclick(".it[data-id=a1]")
        fr = editor(page)
        fr.click("#topr [data-a=save]")
        page.wait_for_function("() => board.items.a1.type === 'imgframe' && board.items.a1.v === 1", timeout=60000)
        closed(page)
        assert page.evaluate("() => [...sel]") == ["a1"] and page.evaluate("() => past.length") == steps0 + 1
        assert near(page.evaluate(CAM), cam0)
        page.wait_for_function("() => !dirty", timeout=10000)
        card = board(state)["items"]["a1"]
        assert card["type"] == "imgframe" and card["v"] == 1 and card["doc"].endswith("/frame.1.json") and card["render"].endswith("/render.1.png"), card
        new = sorted(set(library(lib)) - set(files0))
        d = card["doc"].rsplit("/", 1)[0]
        assert new == [f"{d}/frame.1.json", f"{d}/render.1.png"], new   # exactly one frame folder, the Save's version 1
        assert json.loads((lib / card["doc"]).read_text())["layers"][0]["path"] == "pics/a.png"
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => !board.items.a1.type && board.items.a1.path === 'pics/a.png'")
        # the same id, another kind of card: the board makes a picture's element again, not the frame's reused (canvas.html render)
        page.wait_for_function("() => document.querySelector('.it[data-id=a1] .kd') && !document.querySelector('.plg[data-id=a1]')")
        page.keyboard.press("Meta+Shift+z")
        page.wait_for_function("() => board.items.a1.type === 'imgframe' && board.items.a1.v === 1")
        page.wait_for_function("() => document.querySelector('.plg[data-id=a1] img.ifr') && !document.querySelector('.it[data-id=a1]')")
        # the crop is on the bar over a selected picture, with its key in the tooltip: ⇧C, C is Annotation (hyimg 782b0c8)
        page.evaluate("() => { sel = new Set(['b1']); render(); }"); page.wait_for_timeout(350)
        b = page.locator(".tidy > button[data-crop]")
        assert b.count() == 1 and b.get_attribute("title") == "Кадрировать · ⇧C" and b.locator("> kbd").inner_text() == "⇧C"
        b.click()
        page.wait_for_function("() => cropState && cropState.id === 'b1'")
        page.keyboard.press("Escape"); page.wait_for_function("() => !cropState")
        assert {p: sha(lib / p) for p in before} == before   # the originals never change
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_a_masked_picture_writes_its_layer_mask_only_on_save(hy, engine):
    """a picture with a master mask on the board brings it as its layer's mask: in memory while the studio is open, written with the
    first Save (frames/<stamp>/masks/<layer>.1.png), and the saved document points to that file"""
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit (python3 -m playwright install webkit)")
    from PIL import Image, ImageDraw
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    (lib / "masks").mkdir(); m = Image.new("L", (300, 450), 0); ImageDraw.Draw(m).ellipse([20, 20, 280, 430], fill=255); m.save(lib / "masks/b.png")
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate("() => { board.items.b1.mask = { file: 'masks/b.png' }; cam.x = 400; cam.y = -120; cam.z = 0.9; renderCam(); sel = new Set(); render(); }")
        page.wait_for_timeout(300)
        files0 = library(lib)
        page.dblclick(".it[data-id=b1]")
        fr = editor(page)
        assert fr.evaluate("() => __ed.root.filter(n => !n.main && !n.mmask).map(n => !!n.mask)") == [True]
        fr.locator("body").press("Escape"); closed(page, 10000)
        assert library(lib) == files0 and not page.evaluate("() => !!board.items.b1.type")
        page.dblclick(".it[data-id=b1]")
        fr = editor(page)
        fr.click("#topr [data-a=save]")
        page.wait_for_function("() => board.items.b1.type === 'imgframe' && board.items.b1.v === 1", timeout=60000)
        closed(page)
        card = page.evaluate("() => board.items.b1"); d = card["doc"].rsplit("/", 1)[0]
        new = sorted(set(library(lib)) - set(files0))
        doc = json.loads((lib / card["doc"]).read_text()); lm = doc["layers"][0]["mask"]["file"]
        assert lm.startswith(f"{d}/masks/") and lm.endswith(".1.png") and lm in new, (lm, new)
        assert all(f.startswith(d + "/") for f in new) and f"{d}/frame.1.json" in new and f"{d}/render.1.png" in new, new
        assert Image.open(lib / lm).size == (300, 450), Image.open(lib / lm).size   # the layer's own pixels: b.jpg is 300×450
        assert not errors, errors
        browser.close()
