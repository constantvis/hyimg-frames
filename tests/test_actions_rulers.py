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
