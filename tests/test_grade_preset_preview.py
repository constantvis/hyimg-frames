"""The grading panel's presets show on hover (owner 2026-10-06: «when I hover the presets they should apply at once»): an item pointed
at, or reached with ↓ ↑, shows on the picture and in the sliders; the next one swaps it; leaving the list, Esc, or closing the menu puts
back what was there, also after a fast sweep down the list; a click keeps it as one undo step; the hovers make no step and nothing is
saved for them. The menu's check marks the preset the panel holds. Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_grade_preset_preview.py
"""
import time

import pytest

from test_grade import ENGINES, GRADED, graded_card
from test_grade_undo import open_panel
from test_imgframe import WEBKIT, hy, open_board, shot  # noqa: F401  (hy is the fixture)

STATE = """() => { const i = n => +document.querySelector(`#hcgp input[data-k='${n}']`).value, cv = document.querySelector('#items [data-id=a1] > canvas.grd');
  return { contrast: i('Contrast'), temp: i('Temp'), item: board.items.a1.grade || null, steps: past.length, dirty, card: !!cv, q: __gradeQ() }; }"""


def center(page, loc):
    b = loc.bounding_box(); return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def open_menu(page):
    page.mouse.click(*center(page, page.locator("#hcgp .hcg-pbtn")))
    page.wait_for_function("() => document.querySelector('#hcgp .hcg-menu.open')", timeout=3000)
    page.wait_for_timeout(250)


def item(page, name):
    return page.locator(f"#hcgp .hcg-menu button[data-k='{name}']").first


def calm(page):
    page.wait_for_function("() => __gradeQ() === 0", timeout=5000); page.wait_for_timeout(120)


@pytest.mark.parametrize("engine", ENGINES)
def test_presets_show_on_hover_and_a_click_keeps_one(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        open_panel(page)
        page.wait_for_function("() => !dirty", timeout=10000)
        s0 = page.evaluate("past.length")
        open_menu(page)
        # no grade: the panel holds Neutral's values, its check is on
        assert page.evaluate("() => [...document.querySelectorAll('#hcgp .hcg-menu button.cur')].map(b => b.dataset.k)") == ["Neutral"]
        # pointed at: Punchy on the picture and in the sliders, nothing in the board
        page.mouse.move(*center(page, item(page, "Punchy"))); calm(page)
        st = page.evaluate(STATE)
        assert st["contrast"] == 26 and st["card"] and st["item"] is None and st["steps"] == s0 and not st["dirty"], st
        assert graded_card(page, "a1")["diff"] > 4
        shot(page, f"preset-hover-{engine}-punchy.png")
        # the next one swaps it
        page.mouse.move(*center(page, item(page, "Cool Studio"))); calm(page)
        st = page.evaluate(STATE); assert st["temp"] == -14 and st["contrast"] != 26 and st["item"] is None, st
        # a fast sweep down the whole list and out of it: back to what was there
        names = page.evaluate("() => [...document.querySelectorAll('#hcgp .hcg-menu button[data-k]')].map(b => b.dataset.k)")   # the presets, not «Clear all»
        for n in names + names[::-1]: page.mouse.move(*center(page, item(page, n)), steps=1)
        page.mouse.move(600, 500, steps=2); calm(page)
        st = page.evaluate(STATE)
        assert st["contrast"] == 0 and st["temp"] == 0 and not st["card"] and st["item"] is None and st["steps"] == s0 and not st["dirty"], st
        assert page.evaluate("() => !!document.querySelector('#hcgp .hcg-menu.open')")   # the menu stays open, only its look went back
        # Esc while one shows: the menu closes, the panel stays, the look goes back
        page.mouse.move(*center(page, item(page, "Punchy"))); calm(page)
        assert page.evaluate(STATE)["contrast"] == 26
        page.keyboard.press("Escape")
        page.wait_for_function("() => !document.querySelector('#hcgp .hcg-menu.open') && document.querySelector('#hcgp.in')", timeout=3000)
        calm(page); st = page.evaluate(STATE); assert st["contrast"] == 0 and not st["card"] and st["item"] is None, st
        # the keys: ↓ reaches an item and shows it, Esc puts it back
        open_menu(page); page.mouse.move(600, 500)
        page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown"); calm(page)
        focused = page.evaluate("() => document.activeElement.dataset.k")
        assert focused == names[1], focused
        st = page.evaluate(STATE); assert st["card"] and st["item"] is None, st
        page.keyboard.press("Escape"); calm(page)
        st = page.evaluate(STATE); assert st["contrast"] == 0 and not st["card"], st
        # a click keeps it: one step, saved; ⌘Z takes it back
        open_menu(page)
        page.mouse.move(*center(page, item(page, "Punchy"))); calm(page)
        page.mouse.click(*center(page, item(page, "Punchy")))
        page.wait_for_function("() => board.items.a1.grade && board.items.a1.grade.contrast === 26", timeout=3000)
        page.wait_for_timeout(900)
        assert page.evaluate("past.length") == s0 + 1
        page.wait_for_function("() => !dirty", timeout=10000)
        open_menu(page)
        assert page.evaluate("() => [...document.querySelectorAll('#hcgp .hcg-menu button.cur')].map(b => b.dataset.k)") == ["Punchy"]
        page.keyboard.press("Escape")
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => !board.items.a1.grade", timeout=3000)
        page.wait_for_function("() => +document.querySelector(\"#hcgp input[data-k='Contrast']\").value === 0", timeout=3000)
        page.wait_for_function(GRADED)
        assert not errors, errors
        browser.close()
