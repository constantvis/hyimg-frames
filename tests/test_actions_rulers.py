"""The editor's Actions palette and its rulers (owner 2026-10-06: «why does Actions stand crooked, why does its height shrink, it must
be standardized, and Actions moves when I turn the rulers on; rulers must not affect anything by appearing or disappearing»): the palette
stands over the dock's middle with one height for every tab, and showing or hiding the rulers moves nothing (the dock, the tool rail,
the palette, the canvas). Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_actions_rulers.py
"""
import pytest

from test_imgframe import WEBKIT, hy  # noqa: F401  (hy is the fixture)
from test_select_tool import open_editor

GEO = """() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const pd = parent.document.querySelector('#dock').getBoundingClientRect();
  return { dock: r('#dock'), board_dock: [Math.round(pd.left), Math.round(pd.top), Math.round(pd.width)], rail: r('#rail'), acts: r('#acts'), view: [Math.round(__ed.V.x), Math.round(__ed.V.y), Math.round(__ed.V.s * 1000)] }; }"""


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_actions_stand_over_the_dock_with_one_height_and_rulers_move_nothing(hy, engine):
    if engine == "webkit" and not WEBKIT:
        pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_editor(p, port, engine)
        fr.evaluate("() => __ed.openActs()"); fr.wait_for_timeout(450)
        heights = {}
        for cat in fr.evaluate("() => [...document.querySelectorAll('#actsTabs button')].map(b => b.dataset.c)"):
            fr.evaluate(f"() => document.querySelector('#actsTabs button[data-c=\"{cat}\"]').click()"); fr.wait_for_timeout(80)
            heights[cat] = fr.evaluate("() => Math.round(document.querySelector('#acts').getBoundingClientRect().height)")
        assert len(set(heights.values())) == 1, heights
        # the dock the person sees: the editor's own, or on the board the board's dock (the editor is a frame in the board's page)
        a = fr.evaluate("() => { const a = document.querySelector('#acts').getBoundingClientRect(), f = frameElement ? frameElement.getBoundingClientRect() : { left: 0 }; return a.left + f.left + a.width / 2; }")
        d = page.evaluate("() => { const d = document.querySelector('#dock').getBoundingClientRect(); return d.left + d.width / 2; }")
        mid = [a, d]
        assert abs(mid[0] - mid[1]) <= 1, mid
        for _ in range(2):   # off, then on again
            before = fr.evaluate(GEO)
            was = fr.evaluate("() => __ed.S.rulers")
            fr.evaluate("() => __ed.toggleRulers()"); fr.wait_for_timeout(450)
            assert fr.evaluate("() => __ed.S.rulers") != was
            after = fr.evaluate(GEO)
            assert after == before, (was, before, after)
        assert not errors, errors
        browser.close()


RULER = """() => { const c = document.getElementById('view'), g = c.getContext('2d'), k = c.width / innerWidth, H = innerHeight;
  const a = (x, y) => g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data[3];
  return { on: __ed.S.rulers, top: a(6, 2), row: a(6, 31), mid: a(6, H / 2), corner: a(6, H - 6), bottom: a(innerWidth / 2, H - 4), kept: localStorage.getItem('hy-ed-rulers') }; }"""


def test_rulers_are_off_by_default_run_to_the_top_and_are_kept(hy):
    """The owner (2026-10-09, the board with Image Studio open, the ruler cut under the top row): «опять проблема с тем, что до самого
    верху должна идти линейка, и по дефолту выключена быть». The rulers are off when the studio first opens; ⇧R shows them (⌘R was Photoshop's until 2026-10-10), the vertical one
    from the window's very top down to the corner where it meets the bottom one; this viewer keeps the choice through closing and opening
    the studio again; a closed studio leaves nothing of them over the board. Chromium, dark."""
    from playwright.sync_api import sync_playwright
    from test_imgframe import closed, editor
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_editor(p, port, "chromium")
        fr.wait_for_function("() => document.body.classList.contains('in')", timeout=10000); fr.wait_for_timeout(600)
        r = fr.evaluate(RULER)
        assert not r["on"] and r["top"] == r["mid"] == r["corner"] == r["bottom"] == 0 and r["kept"] is None, r
        # ⌘R is not the studio's (the browser's reload, owner 2026-10-10): the rulers stay off; the page itself must not reload in the test,
        # so the key goes to the studio's own handler as a plain event
        fr.evaluate("() => { window.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', metaKey: true, bubbles: true, cancelable: true })); }")
        fr.wait_for_timeout(300); assert not fr.evaluate(RULER)["on"], "⌘R turned the rulers on"
        # ⇧R, as the studio's View menu says: both rulers, the vertical one up to the window's top (it began under the row, 59c21fd)
        page.keyboard.press("Shift+KeyR"); fr.wait_for_timeout(450)
        r = fr.evaluate(RULER)
        assert r["on"] and r["kept"] == "1" and min(r["top"], r["row"], r["mid"], r["corner"], r["bottom"]) > 0, r
        # a guide is pulled from the ruler's top part too
        assert fr.evaluate("() => __ed.TOPY") > 30
        # closed: nothing of the studio, its rulers included, over the board
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        page.keyboard.press("Escape"); closed(page)
        assert page.evaluate("() => getComputedStyle(document.querySelector('.ifed')).visibility") == "hidden"
        hit = page.evaluate("() => { const e = document.elementFromPoint(6, innerHeight / 2); return e ? (e.closest('.ifed') ? 'studio' : e.tagName) : null; }")
        assert hit != "studio", hit
        # opened again (the page loads afresh after each exit): the rulers as this viewer left them; off again, kept off
        page.evaluate(f"() => __frames.openEditor('{fid}')"); fr = editor(page)
        fr.wait_for_function("() => document.body.classList.contains('in')", timeout=10000); fr.wait_for_timeout(600)
        r = fr.evaluate(RULER); assert r["on"] and r["top"] > 0, r
        fr.evaluate("() => __ed.toggleRulers()"); fr.wait_for_timeout(300)
        page.keyboard.press("Escape"); closed(page)
        page.evaluate(f"() => __frames.openEditor('{fid}')"); fr = editor(page)
        fr.wait_for_function("() => document.body.classList.contains('in')", timeout=10000); fr.wait_for_timeout(600)
        r = fr.evaluate(RULER); assert not r["on"] and r["kept"] == "0" and r["top"] == r["mid"] == 0, r
        assert not errors, errors
        browser.close()
