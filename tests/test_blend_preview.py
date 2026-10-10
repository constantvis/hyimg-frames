"""The layer's blend mode shows on hover (owner 2026-10-06: «in our Image Editor, when I hover a blend mode it applies at once and I
see how it looks»), as in Figma and Photoshop: pointing at a mode in the list, or reaching it with ↑ ↓, draws the layer with it; the next
one replaces it; leaving the list, Esc or closing without a click puts the mode back exactly; a click (or Enter) keeps it as one undo
step. Hovers make no undo steps, mark nothing unsaved and send nothing to the server. A fast sweep ends on the last mode pointed at.
Esc leaves no focus in the closed list (Enter after it changes nothing). Run with the editor in place on the board (the board's dock is
the editor's). Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_blend_preview.py
  FRAMES_SHOTS=<folder> also saves screenshots of the hover in both themes
"""
import pytest

from test_imgframe import WEBKIT, hy, shot  # noqa: F401  (hy is the fixture)
from test_select_tool import open_editor

# the top picture over the bottom one, chosen; history from here on is the test's
SETUP = """() => { const px = []; (function r(l) { for (const n of l) { if (n.children) r(n.children); else if (n.type === 'pixel') px.push(n); } })(__ed.root);
  const [a, b] = px; b.x = a.x + 300; b.y = a.y; __ed.S.ids = [b.id]; __ed.refresh(); __ed.S.undo.length = 0; __ed.S.redo.length = 0;
  return b.id; }"""
# the view's pixel at a point of the document (the canvas the person sees)
PIX = """([x, y]) => { const c = __ed.acc, k = Math.max(1, devicePixelRatio || 1), V = __ed.V;
  return [...c.getContext('2d').getImageData(Math.round((V.x + x * V.s) * k), Math.round((V.y + y * V.s) * k), 1, 1).data]; }"""
FRAMES2 = "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
AT = [550, 40]   # inside both pictures, off the white squares


def item(fr, key):
    label = fr.evaluate(f"() => __ed.T.blend.{key}")
    return fr.locator("#menu.open button[role=menuitem]", has_text=label).first


def state(fr, bid):
    return fr.evaluate(f"() => ({{ blend: __ed.byId('{bid}').blend, undo: __ed.S.undo.length, ver: __ed.S.ver, open: document.querySelector('#menu').classList.contains('open') }})")


def close(a, b, tol=2): return all(abs(x - y) <= tol for x, y in zip(a, b))


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_blend_mode_previews_on_hover_and_commits_on_click(hy, engine):
    if engine == "webkit" and not WEBKIT:
        pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state_dir = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_editor(p, port, engine)
        fr.wait_for_timeout(900)   # the panels slide in first: a click while they move would make Playwright scroll the board under the editor
        writes = []
        # stat: the board's look at its files; live, settings: its camera (the studio's fit, P4 S-61) and preferences
        quiet = ("/api/stat", "/api/live", "/api/settings")
        page.on("request", lambda r: writes.append(r.url) if r.method not in ("GET", "HEAD") and "/api/" in r.url and not any(x in r.url for x in quiet) else None)
        bid = fr.evaluate(SETUP); fr.evaluate(FRAMES2)
        s0 = state(fr, bid); assert s0["blend"] == "source-over" and s0["undo"] == 0, s0
        normal = fr.evaluate(PIX, AT)

        # hover: the mode draws at once, the next replaces it, nothing is committed
        fr.click("#blendBtn"); fr.wait_for_timeout(250)
        item(fr, "multiply").hover(); fr.evaluate(FRAMES2)
        assert state(fr, bid)["blend"] == "multiply"
        mul = fr.evaluate(PIX, AT); assert not close(mul, normal), (mul, normal)
        for theme in ("light", "dark"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{theme}'"); fr.wait_for_timeout(250)
            shot(page, f"blend-hover-{theme}-{engine}.png")
        item(fr, "screen").hover(); fr.evaluate(FRAMES2)
        scr = fr.evaluate(PIX, AT); assert state(fr, bid)["blend"] == "screen" and not close(scr, mul), (scr, mul)
        s = state(fr, bid); assert s["undo"] == 0 and s["ver"] == s0["ver"], s

        # a fast sweep over the whole list ends on the mode under the pointer, drawn as such
        top, bot = item(fr, "darken").bounding_box(), item(fr, "luminosity").bounding_box()
        x = top["x"] + top["width"] / 2
        page.mouse.move(x, top["y"] + 4); page.mouse.move(x, bot["y"] + bot["height"] / 2, steps=6)
        page.mouse.move(x, item(fr, "multiply").bounding_box()["y"] + 12, steps=3)
        fr.evaluate(FRAMES2)
        assert state(fr, bid)["blend"] == "multiply"; assert close(fr.evaluate(PIX, AT), mul)

        # leaving the list puts the mode back exactly, also when it leaves before a frame is drawn
        b = item(fr, "screen").bounding_box(); page.mouse.move(b["x"] + 20, b["y"] + 12)
        page.mouse.move(b["x"] - 120, b["y"] + 12)
        fr.evaluate(FRAMES2)
        s = state(fr, bid); assert s["blend"] == "source-over" and s["open"], s
        assert fr.evaluate(PIX, AT) == normal

        # Esc while pointing: back, closed, no step, and no focus left in the closed list (Enter after it changes nothing)
        item(fr, "overlay").hover(); fr.evaluate(FRAMES2); assert state(fr, bid)["blend"] == "overlay"
        page.keyboard.press("Escape"); fr.evaluate(FRAMES2)
        s = state(fr, bid); assert s["blend"] == "source-over" and not s["open"] and s["undo"] == 0, s
        assert fr.evaluate(PIX, AT) == normal
        assert fr.evaluate("() => !(document.activeElement && document.activeElement.closest('.menu'))")
        page.keyboard.press("Enter"); fr.evaluate(FRAMES2); assert state(fr, bid)["blend"] == "source-over"

        # the keys: ↓ moves through the list and shows each mode; Esc puts it back; Enter keeps the one reached
        fr.click("#blendBtn"); fr.wait_for_timeout(250); page.mouse.move(5, 450)
        page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown"); fr.evaluate(FRAMES2)
        assert state(fr, bid)["blend"] == "multiply"   # Normal, Darken, Multiply
        assert close(fr.evaluate(PIX, AT), mul)
        page.keyboard.press("Escape"); fr.evaluate(FRAMES2)
        s = state(fr, bid); assert s["blend"] == "source-over" and not s["open"] and s["undo"] == 0, s
        fr.click("#blendBtn"); fr.wait_for_timeout(250); page.mouse.move(5, 450)
        for _ in range(5): page.keyboard.press("ArrowDown")
        fr.evaluate(FRAMES2); assert state(fr, bid)["blend"] == "screen"
        page.keyboard.press("Enter"); fr.evaluate(FRAMES2)
        s = state(fr, bid); assert s["blend"] == "screen" and not s["open"] and s["undo"] == 1, s
        assert close(fr.evaluate(PIX, AT), scr)

        # a click keeps the hovered mode as one step; ⌘Z takes back exactly that step
        fr.click("#blendBtn"); fr.wait_for_timeout(250)
        item(fr, "lighten").hover(); item(fr, "darken").hover(); item(fr, "multiply").hover()
        item(fr, "multiply").click(); fr.evaluate(FRAMES2)
        s = state(fr, bid); assert s["blend"] == "multiply" and not s["open"] and s["undo"] == 2, s
        assert fr.evaluate("() => __ed.S.undo[__ed.S.undo.length - 1].label") == fr.evaluate("() => __ed.T.h.blend")
        assert close(fr.evaluate(PIX, AT), mul)
        page.keyboard.press("Meta+KeyZ"); fr.evaluate(FRAMES2)
        assert state(fr, bid)["blend"] == "screen"; assert close(fr.evaluate(PIX, AT), scr)

        # a key that is not the list's (⌘Z) while a mode is shown: the list closes first, history never holds the hovered mode
        fr.click("#blendBtn"); fr.wait_for_timeout(250)
        item(fr, "difference").hover(); fr.evaluate(FRAMES2); assert state(fr, bid)["blend"] == "difference"
        page.keyboard.press("Meta+KeyZ"); fr.evaluate(FRAMES2)
        s = state(fr, bid); assert s["blend"] == "source-over" and not s["open"], s
        assert "difference" not in fr.evaluate("() => JSON.stringify(__ed.S.redo.map(e => e.state && e.state.tree))")

        # the same mode again is no step
        fr.click("#blendBtn"); fr.wait_for_timeout(250); n = state(fr, bid)["undo"]
        print(fr.evaluate("() => [JSON.stringify(document.querySelector('#menu').getBoundingClientRect()), JSON.stringify(document.querySelector('#blendBtn').getBoundingClientRect()), __ed.S.ids, innerWidth, innerHeight]"))
        print(page.evaluate("() => JSON.stringify(document.querySelector('.ifed iframe').getBoundingClientRect())"), item(fr, "normal").bounding_box(), fr.evaluate("() => getComputedStyle(document.querySelector('#menu')).transform + ' ' + getComputedStyle(document.querySelector('#menu')).opacity"))
        item(fr, "normal").click(); fr.evaluate(FRAMES2); assert state(fr, bid)["undo"] == n

        assert not writes, writes
        assert not errors, errors
        browser.close()
