"""The image studio's two panel groups only fold, they never close (owner 2026-10-07: «если я тяну за эту штуку, то я могу полностью
сложить тот блок, то есть коллапс. Либо наоборот, если вниз тяну, точно так же. А закрыть группу нельзя. Зачем ее закрывать? Как ее
вообще вернуть? Не нужно ее закрывать, по сути, только одна настройка: это коллапс»). The line between Properties / Adjustments / History
and Layers / Channels, dragged up past the top group's least height, folds the top group to its tabs; dragged down past the bottom
group's, folds the bottom one (to its header, 36 px with the block's hairline); dragged back out, it opens again; a double click gives the automatic halves back; the active tab of a
folded group opens it. No menu, key or saved state closes a group; a reload keeps the fold and the split. Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_panel_groups.py
  FRAMES_SHOTS=<folder> also saves screenshots in both themes
"""
import pytest

from test_imgframe import WEBKIT, editor, hy, shot  # noqa: F401  (hy is the fixture)
from test_select_tool import open_editor

GEO = """() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { g1: Math.round(r('#g1').height), g2: Math.round(r('#g2').height),
  side: Math.round(r('#side').height), s1: __ed.GS.g1.shut, s2: __ed.GS.g2.shut, c1: document.querySelector('#g1').classList.contains('closed'),
  c2: document.querySelector('#g2').classList.contains('closed'), off: document.querySelector('#split').classList.contains('off'), splitH: __ed.S.splitH }; }"""


def drag(page, fr, dy, steps=10):
    b = fr.locator("#split").bounding_box(); x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, y + dy, steps=steps); page.mouse.up(); fr.wait_for_timeout(550)


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_the_split_folds_each_group_and_nothing_closes_one(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_editor(p, port, engine)
        fr.wait_for_timeout(900)
        g0 = fr.evaluate(GEO); assert not g0["s1"] and not g0["s2"] and not g0["off"], g0
        # up past the top group's least height: Properties folds to its tabs, Layers takes the room; the line still works
        drag(page, fr, -g0["g1"])
        g1 = fr.evaluate(GEO); assert g1["s1"] and not g1["s2"] and g1["g1"] == 36 and not g1["off"], g1   # a folded block: its 34 px header in its hairline (round 12 «A · Line»)
        assert g1["g2"] > g0["g2"] + 100, (g0, g1)
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); fr.wait_for_timeout(300)
            shot(page, f"groups-top-folded-{th}-{engine}.png")
        page.evaluate("() => document.documentElement.dataset.theme = 'dark'")
        # back out: open again at a height of its own
        drag(page, fr, 250)
        g2 = fr.evaluate(GEO); assert not g2["s1"] and not g2["s2"] and g2["g1"] >= 130, g2
        # down past the bottom group's least height: Layers folds to its tabs
        drag(page, fr, g2["side"])
        g3 = fr.evaluate(GEO); assert g3["s2"] and not g3["s1"] and g3["g2"] == 36 and not g3["off"], g3
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); fr.wait_for_timeout(300)
            shot(page, f"groups-bottom-folded-{th}-{engine}.png")
        page.evaluate("() => document.documentElement.dataset.theme = 'dark'")
        # the active tab of a folded group opens it
        fr.click("#g2 .tab.on"); fr.wait_for_timeout(500)
        assert not fr.evaluate(GEO)["s2"]
        # a double click: the automatic halves, both open
        drag(page, fr, -g0["side"]); assert fr.evaluate(GEO)["s1"]
        fr.dblclick("#split", force=True); fr.wait_for_timeout(550)
        g4 = fr.evaluate(GEO); assert not g4["s1"] and not g4["s2"] and g4["splitH"] is None and abs(g4["g1"] - g0["g1"]) <= 2, (g0, g4)
        # no way to close: the groups' menus only fold, F7 and View › Panels fold Layers and open it again
        for g in ("g1", "g2"):
            fr.click(f"#{g} .gm"); fr.wait_for_timeout(250)
            items = fr.evaluate("() => [...document.querySelectorAll('#menu.open button[role=menuitem]')].map(b => b.innerText.trim())")
            assert items and not any("Close" in t or "Hide" in t for t in items), items
            page.keyboard.press("Escape"); fr.wait_for_timeout(200)
        fr.evaluate("() => document.activeElement && document.activeElement.blur()")
        for _ in range(3):
            page.keyboard.press("F7"); fr.wait_for_timeout(450)
            g = fr.evaluate(GEO); assert not g["c1"] and not g["c2"], g
        assert fr.evaluate(GEO)["s2"]   # pressed three times: folded
        # a fold and a split survive a reload; a group a saved state hid comes back
        fr.click("#g2 .tab.on"); fr.wait_for_timeout(400)
        drag(page, fr, -g0["side"])
        assert fr.evaluate(GEO)["s1"]
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        page.evaluate("""() => { const k = 'hy-ed-panels-r8', v = JSON.parse(localStorage.getItem(k)); v.vis = Object.assign(v.vis || {}, { layers: false, chan: false }); localStorage.setItem(k, JSON.stringify(v)); }""")
        page.reload()
        page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
        page.wait_for_timeout(1200)
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page); fr.wait_for_timeout(900)
        g5 = fr.evaluate(GEO); assert g5["s1"] and not g5["s2"] and not g5["c1"] and not g5["c2"], g5
        assert fr.evaluate("() => document.querySelectorAll('#g2 .tab:not(.hide)').length") == 2
        assert not errors, errors
        browser.close()
