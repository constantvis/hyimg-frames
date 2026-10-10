"""Annotations on Image Studio's layers (owner 2026-10-09 on round 15, r15-image.html liked as drawn: «Да и не только в 3D, в картинках тоже
должны быть аннотации. Image Studio точно так же, чтобы я мог выбрать и слой»). Chromium, dark, a Russian board:

- C takes the Annotation tool (the dock's button lights up in the studio's purple); a click on layer b drops a pin and the board's thread
  window opens; the thread is stored with its anchor: the frame's card, the layer's id and name, the point in the layer's own pixels;
- the pin is round, in the studio's purple, over the picture; the layer's row shows a count of 1, a click on it opens the thread;
- the layer moved, the pin moves with it; Save puts the thread's place on the card right (op place), the board's pin stands there after a
  reload and the studio's pin is on the layer again; hy.py comments names the layer;
- Resolve hides the pin and the row's count; Esc gives back the tool before it.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_studio_annotations.py
"""
import json
import os
import subprocess
import sys
import urllib.request

from test_imgframe import REPO, hy  # noqa: F401  (hy is the fixture)
from test_studio_dock import open_studio

# a pin's point: its sharp bottom left corner (Hyimg ui/hy/apin.css, owner 2026-10-10: «круг с уголком внизу слева»)
PINS = "() => [...document.querySelectorAll('.hy-spins .hy-spin')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.c, b.textContent, r.x, r.y + r.height]; })"
LAYER = "(name) => { let id = null; (function rec(l) { for (const n of l) { if (n.name === name) id = n.id; if (n.children) rec(n.children); } })(__ed.root); return id; }"


def threads(port):
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/comments?name=main"))["items"]


def doc_point(page, fr, x, y):
    """a point of the document in the board page's coordinates"""
    off = page.evaluate("() => { const w = document.querySelector('.ifed iframe').getBoundingClientRect(); return [w.left, w.top]; }")
    v = fr.evaluate("() => ({ x: __ed.V.x, y: __ed.V.y, s: __ed.V.s })")
    return off[0] + v["x"] + x * v["s"], off[1] + v["y"] + y * v["s"]


def in_frame(page, pt):
    off = page.evaluate("() => { const w = document.querySelector('.ifed iframe').getBoundingClientRect(); return [w.left, w.top]; }")
    return pt[0] + off[0], pt[1] + off[1]


def test_an_annotation_on_a_layer_follows_it(hy):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_studio(p, port)
        fid = page.evaluate("() => Object.entries(board.items).find(([k, it]) => it.type === 'imgframe')[0]")
        bid = fr.evaluate(LAYER, "b")
        assert bid, fr.evaluate("() => __ed.root.map(n => n.name)")
        # C: the Annotation tool, its button in the dock lit
        fr.evaluate("() => __ed.fitView()"); fr.wait_for_timeout(500)   # the whole document in the free part, off the right column
        page.evaluate("() => document.querySelector('.ifed iframe').contentWindow.focus()"); fr.wait_for_timeout(100)
        page.keyboard.press("c"); fr.wait_for_timeout(150)
        assert fr.evaluate("() => __ed.S.tool") == "comment"
        assert page.evaluate("() => document.querySelector('#dock button.ifann').classList.contains('on')")
        # a click on layer b (700..1000 × 0..450 of the document): a pin, the board's thread window with its layer's name
        x, y = doc_point(page, fr, 850, 200)
        page.mouse.click(x, y); page.wait_for_selector("#cmthread.open textarea", timeout=5000)
        assert "b" in page.locator("#cmthread .cm-w").inner_text()
        page.keyboard.type("Brighter here"); page.keyboard.press("Enter"); page.wait_for_timeout(900)
        ts = threads(port); assert len(ts) == 1, ts
        an = ts[0]["anchor"]
        assert an["obj"] == fid and an["part"]["kind"] == "layer" and an["part"]["id"] == bid and an["part"]["name"] == "b", an
        u, v = an["part"]["local"]; assert abs(u - 0.5) < 0.02 and abs(v - 200 / 450) < 0.02, an
        # the pin: Hyimg's one annotation pin, the studio's purple, its corner on the point; the row's count, compact
        fr.wait_for_function("() => document.querySelectorAll('.hy-spins .hy-spin').length === 1 && getComputedStyle(document.querySelector('.hy-spin')).visibility === 'visible'")
        look = fr.evaluate("() => { const b = document.querySelector('.hy-spin'), c = getComputedStyle(b), p = document.createElement('i'); p.style.color = 'var(--frame)';"
                           " document.body.append(p); const f = getComputedStyle(p).color; p.remove(); return [c.borderRadius, c.backgroundColor, f, b.offsetWidth, b.offsetHeight]; }")
        assert look[0].startswith("999px") and look[0].endswith(" 3px") and look[1] == look[2] and look[4] == 24, look
        pin = fr.evaluate(PINS)[0]; px, py = in_frame(page, pin[2:])
        assert abs(px - x) < 1.5 and abs(py - y) < 1.5, (pin, x, y)
        assert fr.evaluate(f"() => document.querySelector('.lr[data-id=\"{bid}\"] [data-ann-n]').getBoundingClientRect().height") <= 16
        assert fr.evaluate(f"() => document.querySelector('.lr[data-id=\"{bid}\"] [data-ann-n]').textContent") == "1"
        # the layer moves: the pin goes with it
        page.keyboard.press("Escape"); page.wait_for_timeout(200)   # the thread's window closes, the keys go back to the studio
        fr.evaluate(f"() => {{ const n = __ed.byId('{bid}'); n.x -= 200; n.y += 30; __ed.refresh(); }}"); fr.wait_for_timeout(300)
        pin2 = fr.evaluate(PINS)[0]; s = fr.evaluate("() => __ed.V.s")
        assert abs(pin2[2] - (pin[2] - 200 * s)) < 2 and abs(pin2[3] - (pin[3] + 30 * s)) < 2, (pin, pin2, s)
        # Esc gives back the tool before it
        assert fr.evaluate("() => __ed.S.tool") == "comment"
        page.evaluate("() => document.querySelector('.ifed iframe').contentWindow.focus()"); page.keyboard.press("Escape"); fr.wait_for_timeout(150)
        assert fr.evaluate("() => __ed.S.tool") == "select"
        # Save: the thread's place on the card is the layer's now (op place, no event)
        page.keyboard.press("Meta+Enter"); page.wait_for_function("() => !document.querySelector('.ifed.on')", timeout=30000); page.wait_for_timeout(800)
        t1 = threads(port)[0]
        assert abs(t1["at"][0] - (850 - 200) / 1000) < 0.01 and abs(t1["at"][1] - 230 / 450) < 0.01, t1["at"]
        out = subprocess.run([sys.executable, str(REPO / "review/hy.py"), "comments"], env={**os.environ, "HYIMG_PORT": str(port)},
                             capture_output=True, text=True, timeout=60).stdout
        assert f"слой «b» (layer {bid}" in out and "Brighter here" in out, out
        # after a reload: the board's pin where the layer is, the studio's pin on the layer
        page.reload(); page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
        page.wait_for_function("() => document.querySelectorAll('#cmpins .cmpin').length === 1", timeout=15000)
        bp = page.evaluate("() => { const b = document.querySelector('#cmpins .cmpin'); return [parseFloat(b.style.left), parseFloat(b.style.top)]; }")
        it = page.evaluate(f"() => board.items['{fid}']")
        assert abs(bp[0] - (it["x"] + 650 / 1000 * it["w"])) < 2 and abs(bp[1] - (it["y"] + 230 / 450 * it["h"])) < 2, (bp, it)
        page.dblclick(f".plg[data-id='{fid}']")
        from test_imgframe import editor
        fr = editor(page); fr.wait_for_function("() => document.querySelectorAll('.hy-spins .hy-spin').length === 1", timeout=10000)
        x2, y2 = doc_point(page, fr, 650, 230); pin3 = fr.evaluate(PINS)[0]; px, py = in_frame(page, pin3[2:])
        assert abs(px - x2) < 3 and abs(py - y2) < 3, (pin3, x2, y2)
        # the count opens the thread; Resolve hides the pin and the count
        fr.locator(f".lr[data-id='{bid}'] [data-ann-n]").click(); page.wait_for_selector("#cmthread.open", timeout=5000)
        page.click("#cmthread [data-cm=resolve]"); page.wait_for_timeout(800)
        assert fr.evaluate("() => document.querySelectorAll('.hy-spins .hy-spin').length") == 0
        assert fr.evaluate(f"() => document.querySelectorAll('.lr[data-id=\"{bid}\"] [data-ann-n]').length") == 0
        assert threads(port)[0]["resolved"]
        assert not errors, errors
        browser.close()
