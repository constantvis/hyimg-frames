"""Two habits of the colour grading on the board (owner 2026-10-06): ↑ ↓ in a typed number step it, ⇧ by ten («when I press up or down
the number changes, with Shift by ten, everywhere I clicked a number»), and while the grading is open every card mark steps out («in
colour grading all the tags must disappear so they don't get in the way»), coming back when it closes. Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_grade_keys_marks.py
"""
import time

import pytest

from test_grade import ENGINES, mark_shown, preset
from test_imgframe import WEBKIT, hy, open_board  # noqa: F401  (hy is the fixture)

MARKS_OUT = """() => [...document.querySelectorAll('#items .mk')].every(m => { const s = getComputedStyle(m); return s.display === 'none' || +s.opacity < .05; })"""


@pytest.mark.parametrize("engine", ENGINES)
def test_arrows_step_a_typed_number_and_marks_step_out_while_grading(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate("sel = new Set(['a1']); render(); fit()"); time.sleep(0.5)
        page.locator('.tidy button.ic[aria-label="Raw Editor"]').click()
        page.wait_for_selector("#hcgp.in .hcg", timeout=10000)
        preset(page.locator("#hcgp"), "Punchy")
        page.wait_for_function("() => board.items.a1.grade && board.items.a1.grade.contrast === 26", timeout=5000)
        # the marks are out while the panel is open (the grade mark the preset just gave too)
        page.wait_for_timeout(500)
        assert page.evaluate(MARKS_OUT)
        # a click on Contrast's number types it; ↑ one step, ⇧↑ ten, ↓ back
        row = page.locator("#hcgp .hy-slider", has=page.locator("input[data-k='Contrast']")).first
        row.locator(".hy-slider-v").evaluate("v => v.click()")
        f = row.locator("input.hy-slider-ed"); f.wait_for(timeout=3000)
        f.press("ArrowUp")
        page.wait_for_function("() => board.items.a1.grade.contrast === 27", timeout=3000)
        f.press("Shift+ArrowUp"); page.wait_for_function("() => board.items.a1.grade.contrast === 37", timeout=3000)
        f.press("ArrowDown"); page.wait_for_function("() => board.items.a1.grade.contrast === 36", timeout=3000)
        assert f.input_value().strip().lstrip("+") == "36", f.input_value()
        f.press("Enter")
        # closed: the marks come back
        page.evaluate("() => document.activeElement && document.activeElement.blur()")   # the slider keeps the focus after Enter; Esc from a field stays in it
        page.keyboard.press("Escape"); page.wait_for_function("() => !document.querySelector('#hcgp')", timeout=5000)
        assert mark_shown(page, "a1")
        assert not errors, errors
        browser.close()
