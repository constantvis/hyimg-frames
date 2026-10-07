"""The grading switched off, as a whole and by section (owner 2026-10-06: the split button said nothing, «it is not clear at all» that
the grade is off). The header's eye switches the whole grade off: the panel under the header fades (a saturate(0) filter and less
opacity, the eye and ✕ stay), the card shows its picture as it is, its mark turns into the plain wheel, dimmed. Each section has its own
eye by its chevron: off, only that section leaves the picture, its values stay, the section fades. Both are changes of the grade: one
step to undo, saved with it, carried by «Copy properties ›» / «Paste properties ›», read back after a reload; a grade saved before has
neither flag and is on. A section's reset ↺ shows on its header's hover and resets only that section, one step. Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_grade_eyes.py
  FRAMES_SHOTS=<folder> also saves screenshots: on, all off, one section off, in both themes
"""
import time

import pytest

from test_grade import ENGINES, GRADED, graded_card, mark_shown
from test_grade_undo import open_panel
from test_imgframe import WEBKIT, board, hy, open_board, shot  # noqa: F401  (hy is the fixture)

# the card's graded canvas against a render of the given grade by the same renderer: how far apart, per channel on 16×16
SAME_AS = """([id, g]) => { const el = document.querySelector(`#items [data-id="${id}"]`), cv = el.querySelector(':scope > canvas.grd'), img = el.querySelector('img');
  if (!cv) return null; const R = HyColorGrade.createRenderer(), want = R.render(img, g, document.createElement('canvas'));
  const a = document.createElement('canvas'); a.width = a.height = 16; const x = a.getContext('2d', { willReadFrequently: true });
  x.drawImage(cv, 0, 0, 16, 16); const p = x.getImageData(0, 0, 16, 16).data; x.clearRect(0, 0, 16, 16); x.drawImage(want, 0, 0, 16, 16); const q = x.getImageData(0, 0, 16, 16).data;
  let d = 0; for (let i = 0; i < p.length; i += 4) d += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]); return d / 256; }"""
FADED = """sel => { const e = document.querySelector(sel), s = getComputedStyle(e); return { f: s.filter, o: +s.opacity }; }"""
GRADE = {"contrast": 60, "exposure": 0.3, "vignette": {"amount": -80}}


def faded(page, sel, t=3000):
    page.wait_for_function("sel => { const s = getComputedStyle(document.querySelector(sel)); return s.filter.includes('saturate(0)') && +s.opacity < .5; }", arg=sel, timeout=t)
    return True


@pytest.mark.parametrize("engine", ENGINES)
def test_eyes_and_section_reset(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate(f"() => {{ const b = snap(); board.items.a1.grade = {GRADE}; commit(b); }}")
        page.wait_for_function(GRADED); page.wait_for_function("() => !!document.querySelector('#items [data-id=a1] > canvas.grd')")
        # a working grade: the «on» wheel on the card and on the bar (the hue wedges), not the plain line
        assert mark_shown(page, "a1")
        assert page.evaluate("() => document.querySelectorAll('#items [data-id=a1] > .mk-grade svg path').length") >= 60
        open_panel(page)
        assert page.evaluate("""() => document.querySelectorAll('.tidy button.ic[aria-label="Raw Editor"] svg path').length""") >= 60
        hcg, eye = page.locator("#hcgp .hcg"), page.locator("#hcgp .hcg-eye")
        assert eye.get_attribute("aria-pressed") == "false" and "Выключить" in eye.get_attribute("title") and not eye.get_attribute("title").endswith(".")
        for th in ("dark", "light"):
            page.evaluate(f"() => {{ document.documentElement.dataset.theme = '{th}'; }}"); time.sleep(0.4)
            shot(page, f"eyes-1-{engine}-on-{th}.png")
        page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")
        s0 = page.evaluate("past.length")
        # the whole grade off: one step, the panel fades under its header, the card is its picture, the mark dims
        eye.click()
        page.wait_for_function("() => board.items.a1.grade.bypass === 1 && board.items.a1.grade.contrast === 60", timeout=3000)
        page.wait_for_function(f"() => past.length === {s0 + 1} && !__grade.P.before", timeout=3000)
        assert faded(page, "#hcgp .hcg-scroll") and faded(page, "#hcgp .hcg-pbtn")
        assert page.evaluate(FADED, "#hcgp .hcg-eye")["o"] == 1 and page.evaluate(FADED, "#hcgp .hcgx")["o"] == 1
        assert eye.get_attribute("aria-pressed") == "true" and "Включить" in eye.get_attribute("title")
        page.wait_for_function("() => !document.querySelector('#items [data-id=a1] > canvas.grd')", timeout=3000)
        assert page.evaluate("() => { const m = document.querySelector('#items [data-id=a1] > .mk-grade'); return m.classList.contains('idle') && m.querySelectorAll('svg path').length === 0; }")
        for th in ("dark", "light"):
            page.evaluate(f"() => {{ document.documentElement.dataset.theme = '{th}'; }}"); time.sleep(0.45)
            shot(page, f"eyes-2-{engine}-all-off-{th}.png")
        page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")
        # ⌘Z: on again, the card graded, the panel at full strength
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => !board.items.a1.grade.bypass", timeout=3000)
        page.wait_for_function("() => { const s = getComputedStyle(document.querySelector('#hcgp .hcg-scroll')); return +s.opacity > .95; }", timeout=3000)
        page.wait_for_function(GRADED); page.wait_for_function("() => !!document.querySelector('#items [data-id=a1] > canvas.grd')")
        # the \\ key switches it too (focus on the panel, not in a field)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("Backslash")
        page.wait_for_function("() => board.items.a1.grade.bypass === 1", timeout=3000)
        page.keyboard.press("Meta+z"); page.wait_for_function("() => !board.items.a1.grade.bypass", timeout=3000)
        # Basic's own eye: only Basic leaves the picture (the vignette stays), its values stay, the section fades
        basic = page.locator("#hcgp .hcg-sec[data-id=basic]")
        s1 = page.evaluate("past.length")
        basic.locator(".hcg-head .ey").click()
        page.wait_for_function("() => board.items.a1.grade.off && board.items.a1.grade.off.basic === 1 && board.items.a1.grade.contrast === 60", timeout=3000)
        page.wait_for_function(f"() => past.length === {s1 + 1} && !__grade.P.before", timeout=3000)
        assert faded(page, "#hcgp .hcg-sec[data-id=basic] > .hcg-body")
        assert page.evaluate(FADED, "#hcgp .hcg-sec[data-id=effects] > .hcg-body")["o"] == 1
        page.wait_for_function(GRADED)
        assert page.evaluate(SAME_AS, ["a1", {"vignette": {"amount": -80}}]) < 2      # what the card shows: the vignette alone
        assert page.evaluate(SAME_AS, ["a1", GRADE]) > 4
        assert page.evaluate("() => !document.querySelector('#items [data-id=a1] > .mk-grade').classList.contains('idle')")   # still working
        for th in ("dark", "light"):
            page.evaluate(f"() => {{ document.documentElement.dataset.theme = '{th}'; }}"); time.sleep(0.45)
            shot(page, f"eyes-3-{engine}-basic-off-{th}.png")
        page.evaluate("() => { document.documentElement.dataset.theme = 'dark'; }")
        # Effects off too: nothing left that works, the card is its picture and the mark dims
        page.locator("#hcgp .hcg-sec[data-id=effects] .hcg-head .ey").click()
        page.wait_for_function("() => board.items.a1.grade.off.effects === 1", timeout=3000)
        page.wait_for_function("() => !document.querySelector('#items [data-id=a1] > canvas.grd') && document.querySelector('#items [data-id=a1] > .mk-grade').classList.contains('idle')", timeout=3000)
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => !board.items.a1.grade.off.effects && board.items.a1.grade.off.basic === 1", timeout=3000)
        page.wait_for_function("() => !document.querySelector('#hcgp .hcg-sec[data-id=effects]').classList.contains('off')", timeout=3000)
        # Effects' reset: hidden until its header is hovered, then it grows in; it resets only Effects, one step
        rs = page.locator("#hcgp .hcg-sec[data-id=effects] .hcg-head .rs")
        page.mouse.move(200, 450); time.sleep(0.5)   # the pointer off the header (it just clicked the eye there)
        assert page.evaluate(FADED, "#hcgp .hcg-sec[data-id=effects] .hcg-head .rs")["o"] == 0
        page.locator("#hcgp .hcg-sec[data-id=effects] .hcg-head .t").hover()
        page.wait_for_function("() => +getComputedStyle(document.querySelector('#hcgp .hcg-sec[data-id=effects] .hcg-head .rs')).opacity > .95", timeout=3000)
        s2 = page.evaluate("past.length")
        b = rs.bounding_box(); page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)   # the pointer, no scroll into view (see preset())
        page.wait_for_function("() => !board.items.a1.grade.vignette && board.items.a1.grade.contrast === 60", timeout=3000)
        page.wait_for_function(f"() => past.length === {s2 + 1} && !__grade.P.before", timeout=3000)
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => board.items.a1.grade.vignette && board.items.a1.grade.vignette.amount === -80", timeout=3000)
        # saved with the grade; a reload shows the card without Basic
        page.keyboard.press("Escape"); page.wait_for_function("() => !document.querySelector('#hcgp')", timeout=5000)
        page.wait_for_function("() => !dirty", timeout=10000)
        g = board(state)["items"]["a1"]["grade"]
        assert g["off"] == {"basic": 1} and g["contrast"] == 60 and "bypass" not in g, g
        page.reload()
        page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
        page.wait_for_function("() => document.querySelector('#items [data-id=a1] > canvas.grd') && __gradeQ() === 0", timeout=20000)
        assert page.evaluate(SAME_AS, ["a1", {"vignette": {"amount": -80}}]) < 2
        # «Copy properties ›» / «Paste properties ›» carry the switched-off section
        page.evaluate("sel = new Set(['a1']); render()"); time.sleep(0.3)
        page.click("#items [data-id=a1]", button="right")
        menu, sub = page.locator("#ctx"), page.locator("#ctx .hy-sub")
        menu.locator("[data-sub=props-copy]").hover(); sub.locator("[role=menuitem]", has_text="Raw Editor").click()
        page.evaluate("sel = new Set(['b1']); render()"); time.sleep(0.3)
        page.click("#items [data-id=b1]", button="right")
        menu.locator("[data-sub=props-paste]").hover(); sub.locator("[role=menuitem]", has_text="Raw Editor").click()
        page.wait_for_function("() => board.items.b1.grade && board.items.b1.grade.off && board.items.b1.grade.off.basic === 1 && board.items.b1.grade.contrast === 60", timeout=5000)
        page.wait_for_function(GRADED)
        assert page.evaluate(SAME_AS, ["b1", {"vignette": {"amount": -80}}]) < 2
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ENGINES)
def test_a_grade_saved_before_is_on(hy, engine):
    """a grade written before the eyes (no bypass, no off) is on: the card graded, the mark the «on» wheel, the panel at full strength"""
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate("() => { const b = snap(); board.items.a1.grade = { contrast: 40 }; commit(b); }")
        page.wait_for_function(GRADED); page.wait_for_function("() => !!document.querySelector('#items [data-id=a1] > canvas.grd')")
        assert graded_card(page, "a1")["diff"] > 4
        open_panel(page)
        assert page.evaluate(FADED, "#hcgp .hcg-scroll")["o"] == 1 and page.locator("#hcgp .hcg-sec.off").count() == 0
        assert not errors, errors
        browser.close()
