"""The image studio draws with Geist from the app's own files (owner 2026-10-07: the pages took 3-13 s to get the font from Google Fonts, and
the app works offline). Its page links /ui/tokens.css, which imports ui/fonts.css of the core. Opened in place over a board in Chromium and
WebKit with fonts.googleapis.com and fonts.gstatic.com blocked: no request goes to either, and Geist is loaded and the font of the studio's
text. The core's pages (board, library, Home) are checked in hyimg/tests/test_fonts_local.py.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_fonts_local.py
"""
import re
import time

import pytest

from test_imgframe import WEBKIT, editor, hy  # noqa: F401  (hy is the fixture)

BLOCKED = re.compile(r"https?://fonts\.(googleapis|gstatic)\.com/")
PROBE = """async () => {
  await document.fonts.load('500 12px "Geist"', 'Layers 12 Ag'); await document.fonts.ready;
  const faces = [...document.fonts].filter(f => f.family.replace(/["']/g, '') === 'Geist' && f.status === 'loaded');
  const used = [...document.querySelectorAll('body, body *')].some(e => getComputedStyle(e).fontFamily.includes('Geist'));
  return { used, check: document.fonts.check('500 12px "Geist"', 'Layers 12 Ag'), loaded: faces.length };
}"""


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_image_studio_takes_geist_from_the_apps_own_files(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit (python3 -m playwright install webkit)")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser = getattr(p, engine).launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900}); seen = []; errors = []
        page.on("request", lambda r: seen.append(r.url)); page.on("pageerror", lambda e: errors.append(str(e)))
        page.route(BLOCKED, lambda route: route.abort())   # before the first request, the studio's frame included
        page.goto(f"http://127.0.0.1:{port}/canvas.html")
        page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
        page.wait_for_selector(".it[data-id=a1]")
        page.evaluate("sel = new Set(['a1', 'b1']); render(); fit()"); time.sleep(0.6)
        page.keyboard.press("Alt+Meta+KeyG")
        page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
        fid = page.evaluate("() => Object.entries(board.items).find(([k, it]) => it.type === 'imgframe')[0]")
        page.wait_for_timeout(1200)
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page)
        r = fr.evaluate(PROBE)
        assert r["loaded"] >= 1 and r["check"] and r["used"], r
        assert any("/editor/index.html" in u for u in seen) and any(u.endswith(".woff2") and "/ui/fonts/" in u for u in seen), seen
        assert not [u for u in seen if BLOCKED.match(u)], [u for u in seen if BLOCKED.match(u)]
        assert not errors, errors
        browser.close()
