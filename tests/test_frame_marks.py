"""A frame card's marks are the board's marks (owner 2026-10-06: one system for every mark on a card): the # and, on a copy, the copy
mark beside it, bottom left, the board's plate (26 px × k), 8.5 px × k in, 3.5 px apart (the owner's lab, 2026-10-06), both in the frame's purple («когда мы скопировали frame у нас вот этот символ
дубля как раз становится фиолетовым тоже»), sized and taken away by the board's law (on a small card they leave, scaling to 0).

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_frame_marks.py
"""
import time

import pytest

from test_imgframe import hy, open_board, WEBKIT  # noqa: F401  (hy is the fixture)

MARKS = """id => { const el = EL.get(id), c = el.getBoundingClientRect();
  return [...el.querySelectorAll('.mk')].filter(m => getComputedStyle(m).display !== 'none').map(m => { const r = m.getBoundingClientRect(), s = getComputedStyle(m);
    return { cls: m.className, l: r.left - c.left, b: c.bottom - r.bottom, w: r.width, h: r.height, bg: s.backgroundColor, frame: getComputedStyle(el).getPropertyValue('--frame').trim() }; }); }"""


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_frame_and_its_copy_wear_the_boards_marks_in_purple(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate("sel = new Set(['a1', 'b1']); render()"); time.sleep(0.3)
        page.keyboard.press("Alt+Meta+KeyG")
        page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        page.evaluate("id => { const s = snap(); board.items.fcopy = { ...board.items[id], x: board.items[id].x, y: board.items[id].y + board.items[id].h + 60 }; sel = new Set(); commit(s); cam.x = board.items[id].x - 40; cam.y = board.items[id].y - 40; cam.z = 0.6; renderCam(); render(); }", fid)
        page.wait_for_timeout(700)
        one, two = page.evaluate(MARKS, fid), page.evaluate(MARKS, "fcopy")
        assert [m["cls"].split()[2] for m in one] == ["mk-frame"], one
        assert sorted(m["cls"].split()[2] for m in two) == ["mk-dup", "mk-frame"], two
        purple = page.evaluate("() => { const d = document.createElement('i'); d.style.color = 'var(--frame)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }")
        k = page.evaluate("id => +getComputedStyle(EL.get(id)).getPropertyValue('--vbs')", "fcopy")
        assert 14 / 26 - 0.01 <= k <= 1, k
        for m in one + two:
            assert abs(m["h"] - 26 * k) < 0.6 and abs(m["w"] - 26 * k) < 0.6 and abs(m["b"] - 8.5 * k) < 0.6, (k, m)
            assert m["bg"] == purple, (m, purple)   # the copy mark too
        fr, dp = sorted(two, key=lambda m: m["l"])
        assert abs(fr["l"] - 8.5 * k) < 0.6 and abs(dp["l"] - (8.5 * k + 26 * k + 3.5)) < 0.6, two   # the copy mark beside the #, 3.5 px apart
        # a small card: its marks leave (the board's law), scaling down first
        page.evaluate("() => { cam.z = 0.02; renderCam(); render(); }")
        page.wait_for_function("id => [...EL.get(id).querySelectorAll('.mk')].every(m => getComputedStyle(m).display === 'none')", arg="fcopy")
        assert not errors, errors
        browser.close()
