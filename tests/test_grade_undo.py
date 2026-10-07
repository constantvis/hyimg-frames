"""Undo while the colour grading is open (owner 2026-10-06: «when I'm in colour grading and press back, it does not come back»).
Each finished gesture in the panel is one step: a slider dragged (also with a pause while the button is held), a typed value, a preset,
Reset all. ⌘Z and ⇧⌘Z work with the panel open, also when the slider just dragged has the focus (a range input took the board's keys
away before); a gesture still settling lands as its step first, so ⌘Z right after letting go undoes that gesture and nothing later
re-applies it. The panel's sliders show the undone value, the card shows the undone picture. The dock's Undo does the same. Esc closes
the panel with a slider focused. A typed number being edited keeps the text field's own ⌘Z. Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_grade_undo.py
"""
import time

import pytest

from test_grade import ENGINES, GRADED, preset
from test_imgframe import WEBKIT, hy, open_board, shot  # noqa: F401  (hy is the fixture)

ROW = "#hcgp .hy-slider:has(input[data-k='{}'])"   # the English name, in either language


def contrast(page):
    """the board item's contrast (0 without a grade) and what the panel's Contrast slider shows"""
    return page.evaluate("""() => { const g = board.items.a1.grade, i = document.querySelector("#hcgp input[data-k='Contrast']");
      return { item: g && g.contrast || 0, panel: i ? +i.value : null, steps: past.length, pending: !!(__grade.P && __grade.P.before) }; }""")


def drag(page, label, share, pause=0.0):
    """a real pointer gesture on a panel slider: press near its left, move to share of its width (optionally resting while held)"""
    row = page.locator(ROW.format(label)).first
    row.scroll_into_view_if_needed()
    b = row.bounding_box(); y = b["y"] + b["height"] / 2; x0 = b["x"] + b["width"] * 0.5; x1 = b["x"] + b["width"] * share
    page.mouse.move(x0, y); page.mouse.down()
    for k in range(1, 7): page.mouse.move(x0 + (x1 - x0) * k / 12, y)
    if pause: time.sleep(pause)   # held still longer than the old 450 ms rest: still the same gesture
    for k in range(7, 13): page.mouse.move(x0 + (x1 - x0) * k / 12, y)
    page.mouse.up()


def open_panel(page):
    page.evaluate("sel = new Set(['a1']); render(); fit()"); time.sleep(0.5)
    page.locator('.tidy button.ic[aria-label="Raw Editor"]').click()
    page.wait_for_selector("#hcgp.in .hcg", timeout=10000)
    page.wait_for_timeout(300)


@pytest.mark.parametrize("engine", ENGINES)
def test_undo_redo_with_the_grading_open(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        open_panel(page)
        s0 = page.evaluate("past.length")
        # a drag with a rest while held: one step, once let go
        drag(page, "Contrast", 0.9, pause=0.8)
        page.wait_for_function("() => board.items.a1.grade && board.items.a1.grade.contrast > 20", timeout=5000)
        page.wait_for_function(f"() => past.length === {s0 + 1} && !__grade.P.before", timeout=5000)
        page.wait_for_timeout(700)
        c1 = contrast(page); assert c1["steps"] == s0 + 1, c1
        assert page.evaluate("() => document.activeElement.type") == "range"   # the slider keeps the focus, as a native one does
        shot(page, f"undo-1-{engine}-dragged.png")
        # ⌘Z with the slider focused: the grade goes, the panel and the card follow
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => !board.items.a1.grade", timeout=3000)
        page.wait_for_function("() => +document.querySelector(\"#hcgp input[data-k='Contrast']\").value === 0", timeout=3000)
        page.wait_for_function("() => !document.querySelector('#items [data-id=a1] > canvas.grd')", timeout=3000)
        assert page.evaluate("() => !!document.querySelector('#hcgp.in')")   # the panel stays open
        # ⇧⌘Z: back again, in the panel and on the card
        page.keyboard.press("Meta+Shift+z")
        page.wait_for_function(f"() => board.items.a1.grade && board.items.a1.grade.contrast === {c1['item']}", timeout=3000)
        page.wait_for_function(f"() => +document.querySelector(\"#hcgp input[data-k='Contrast']\").value === {c1['item']}", timeout=3000)
        page.wait_for_function(GRADED); page.wait_for_function("() => !!document.querySelector('#items [data-id=a1] > canvas.grd')")
        # ⌘Z at once after letting go: that gesture lands as its step first and is the one undone; nothing re-applies it later
        drag(page, "Saturation", 0.15)
        page.keyboard.press("Meta+z")
        page.wait_for_timeout(900)
        c = page.evaluate("() => board.items.a1.grade || {}")
        assert c.get("contrast") == c1["item"] and not c.get("saturation"), c
        assert page.evaluate("+document.querySelector(\"#hcgp input[data-k='Saturation']\").value") == 0
        assert page.evaluate("past.length") == s0 + 1 and page.evaluate("future.length") == 1
        # a typed value is one step; ⌘Z back to the value before (the slider has the focus again after Enter)
        row = page.locator(ROW.format("Contrast")).first
        row.locator(".hy-slider-v").evaluate("v => v.click()")
        f = row.locator("input.hy-slider-ed"); f.wait_for(timeout=3000)
        f.fill("40")
        page.keyboard.press("Meta+z")   # while its text is edited the field keeps its own undo: the board does not move
        page.wait_for_timeout(200)
        assert page.evaluate("() => board.items.a1.grade.contrast") == c1["item"]
        f.fill("40"); f.press("Enter")
        page.wait_for_function("() => board.items.a1.grade.contrast === 40 && past.length === %d && !__grade.P.before" % (s0 + 2), timeout=5000)
        page.keyboard.press("Meta+z")
        page.wait_for_function(f"() => board.items.a1.grade.contrast === {c1['item']}", timeout=3000)
        page.wait_for_function(f"() => +document.querySelector(\"#hcgp input[data-k='Contrast']\").value === {c1['item']}", timeout=3000)
        # a preset, then Reset all: two steps; the dock's Undo takes them back one by one
        preset(page.locator("#hcgp"), "Punchy")
        page.wait_for_function("() => board.items.a1.grade && board.items.a1.grade.contrast === 26", timeout=5000)
        page.locator("#hcgp .hcg-top .hcg-rall").evaluate("b => b.click()")
        page.wait_for_function("() => !board.items.a1.grade", timeout=5000)
        page.wait_for_timeout(700)
        assert page.evaluate("past.length") == s0 + 3
        page.locator("#bundo").click()
        page.wait_for_function("() => board.items.a1.grade && board.items.a1.grade.contrast === 26", timeout=3000)
        page.wait_for_function("() => +document.querySelector(\"#hcgp input[data-k='Contrast']\").value === 26", timeout=3000)
        page.locator("#hcgp input[data-k='Contrast']").focus()
        page.keyboard.press("Meta+z")
        page.wait_for_function(f"() => board.items.a1.grade && board.items.a1.grade.contrast === {c1['item']}", timeout=3000)
        page.wait_for_function(f"() => +document.querySelector(\"#hcgp input[data-k='Contrast']\").value === {c1['item']}", timeout=3000)
        shot(page, f"undo-2-{engine}-undone.png")
        # Esc with a slider focused closes the panel
        page.locator("#hcgp input[data-k='Contrast']").focus()
        page.keyboard.press("Escape")
        page.wait_for_function("() => !document.querySelector('#hcgp')", timeout=5000)
        assert not errors, errors
        browser.close()
