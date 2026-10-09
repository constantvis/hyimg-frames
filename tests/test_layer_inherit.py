"""The image studio's Layers: chosen rows switch together, and a group's eye and lock are inherited, never written into its layers
(owner 2026-10-07):

1. «Shift + выбор двух и более объектов, и когда потом нажимаю на lock или глаз, то блокирую все выбранные или выключаю все выбранные»:
   a press on the eye or the lock of one of several chosen rows gives every chosen row the pressed row's new state, one step to undo; a
   row outside the choice switches alone;
2. «если группу выключаю или включаю lock или глаз, то это не сбрасывает настройки у тех layers, которые лежат в группе»: hiding a group
   and showing it again leaves each layer's own eye as it was;
3. «и настройки серым цветом disabled для них»: under a hidden or locked group a row is dimmed and its eye or lock shows the group's
   state faintly; a layer locked by its group (or by itself) has its Properties and Opacity grey with the reason, does not move, nudge or
   take a brush, and a click on the picture does not pick it.

Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_layer_inherit.py
  FRAMES_SHOTS=<folder> also saves screenshots in both themes
"""
import pytest

from test_imgframe import WEBKIT, hy, shot  # noqa: F401  (hy is the fixture)
from test_select_tool import open_editor

ENGINES = ["chromium", "webkit"]
ROWS = """() => [...document.querySelectorAll('#rows .lr')].filter(r => !r.classList.contains('main') && !r.classList.contains('mmask')).map(r => r.dataset.id)"""
VIS = """(ids) => ids.map(id => __ed.byId(id).visible)"""
LOCKED = """(ids) => ids.map(id => !!__ed.byId(id).locks.all)"""
UNDO = "() => __ed.S.undo.length"


def settle(fr, ms=400): fr.wait_for_timeout(ms)


def click(page, fr, sel):
    b = fr.locator(sel).bounding_box(); page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2); page.mouse.down(); page.mouse.up()


def new_layers(fr, n):
    for _ in range(n): fr.evaluate("() => [...document.querySelectorAll('#lbot .ib')].find(b => b.dataset.key === '⇧ ⌘ N').click()")
    fr.wait_for_timeout(300)


def start(p, port, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    browser, page, fr, errors = open_editor(p, port, engine)
    fr.wait_for_timeout(900)
    return browser, page, fr, errors


@pytest.mark.parametrize("engine", ENGINES)
def test_chosen_rows_switch_together(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        new_layers(fr, 2)
        r = fr.evaluate(ROWS); assert len(r) == 4, r
        # rows 0 and 2 chosen (⌘-click), row 1 hidden before
        fr.evaluate("(r) => { __ed.byId(r[1]).visible = false; __ed.S.ids = [r[0], r[2]]; __ed.refresh(); __ed.S.undo.length = 0; __ed.S.redo.length = 0; }", r); settle(fr)
        click(page, fr, f"#rows .lr[data-id='{r[2]}'] [data-a=eye]"); settle(fr)
        assert fr.evaluate(VIS, r) == [False, False, False, True] and fr.evaluate(UNDO) == 1
        # a row outside the choice: alone
        click(page, fr, f"#rows .lr[data-id='{r[3]}'] [data-a=eye]"); settle(fr)
        assert fr.evaluate(VIS, r) == [False, False, False, False] and fr.evaluate(UNDO) == 2
        page.keyboard.press("Meta+z"); page.keyboard.press("Meta+z"); settle(fr)
        assert fr.evaluate(VIS, r) == [True, False, True, True]
        # the lock of a chosen row locks both chosen ones, one step
        fr.evaluate("(r) => { __ed.S.ids = [r[0], r[2]]; __ed.refresh(); }", r); settle(fr)
        u0 = fr.evaluate(UNDO)
        click(page, fr, f"#rows .lr[data-id='{r[0]}'] [data-a=lock]"); settle(fr, 700)
        assert fr.evaluate(LOCKED, r) == [True, False, True, True] and fr.evaluate(UNDO) == u0 + 1   # the last row is the base layer, locked
        assert fr.evaluate(f"() => document.querySelector(\"#rows .lr[data-id='{r[2]}'] [data-a=lock]\").classList.contains('keep')")
        page.keyboard.press("Meta+z"); settle(fr)
        assert fr.evaluate(LOCKED, r) == [False] * 3 + [True]
        assert not errors, errors
        browser.close()


GROUP = """(r) => { __ed.S.ids = [r[0], r[1]]; __ed.refresh(); }"""


def grouped(page, fr, r):
    """rows 0 and 1 into a group (⌘G, the focus in the editor first); returns the group's id"""
    b = fr.locator("#list").bounding_box(); page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] - 6)
    fr.evaluate(GROUP, r); settle(fr, 200)
    page.keyboard.press("Meta+g"); settle(fr)
    gid = fr.evaluate(f"() => {{ const l = __ed.locate('{r[0]}'); return l.parent && l.parent.id; }}")
    assert gid and fr.evaluate(f"() => __ed.locate('{r[1]}').parent.id") == gid
    return gid


@pytest.mark.parametrize("engine", ENGINES)
def test_a_group_hides_and_locks_without_touching_its_layers(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        new_layers(fr, 2)
        r = fr.evaluate(ROWS)
        gid = grouped(page, fr, r)
        fr.evaluate(f"() => {{ const g = __ed.byId('{gid}'); g.open = true; __ed.byId('{r[0]}').visible = false; __ed.S.ids = []; __ed.refresh(); }}"); settle(fr)
        # the group hidden: its layers keep their own eyes, their rows dim, the visible one's eye shows the group's state faintly
        click(page, fr, f"#rows .lr[data-id='{gid}'] [data-a=eye]"); settle(fr)
        assert fr.evaluate(VIS, [gid, r[0], r[1]]) == [False, False, True]
        row1 = fr.evaluate(f"""() => {{ const row = document.querySelector("#rows .lr[data-id='{r[1]}']"), e = row.querySelector('[data-a=eye]');
          return {{ dim: row.classList.contains('ghid'), inh: e.classList.contains('inh'), op: +getComputedStyle(e).opacity }}; }}""")
        assert row1["dim"] and row1["inh"] and 0.2 < row1["op"] < 0.8, row1
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); settle(fr, 300)
            shot(page, f"inherit-hidden-group-{th}-{engine}.png")
        page.evaluate("() => document.documentElement.dataset.theme = 'dark'")
        click(page, fr, f"#rows .lr[data-id='{gid}'] [data-a=eye]"); settle(fr)
        assert fr.evaluate(VIS, [gid, r[0], r[1]]) == [True, False, True]   # each layer as it was
        assert not fr.evaluate(f"() => document.querySelector(\"#rows .lr[data-id='{r[1]}']\").classList.contains('ghid')")
        # the group locked: its layers' own locks stay off, they show the group's lock faintly, Properties and Opacity grey with the reason
        click(page, fr, f"#rows .lr[data-id='{gid}'] [data-a=lock]"); settle(fr, 700)
        assert fr.evaluate(LOCKED, [gid, r[0], r[1]]) == [True, False, False]
        fr.evaluate(f"() => {{ __ed.S.ids = ['{r[1]}']; __ed.refresh(); __ed.setTab('g1', 'props'); }}"); settle(fr)
        g = fr.evaluate(f"""() => ({{ inh: document.querySelector("#rows .lr[data-id='{r[1]}'] [data-a=lock]").classList.contains('inh'),
          why: (document.querySelector('#pbody .why') || {{}}).textContent, dis: [...document.querySelectorAll('#pbody .sec.dis')].length,
          pe: getComputedStyle(document.querySelector('#pbody .sec.dis .sbi')).pointerEvents, off: document.querySelector('#lset').classList.contains('off') }})""")
        assert g["inh"] and g["why"] == fr.evaluate("() => __ed.T.lockedByGroup") and g["dis"] >= 1 and g["pe"] == "none" and g["off"], g
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); settle(fr, 300)
            shot(page, f"inherit-locked-group-{th}-{engine}.png")
        page.evaluate("() => document.documentElement.dataset.theme = 'dark'")
        # no move, no nudge: the Move tool's arrows leave it where it is
        x0 = fr.evaluate(f"() => __ed.byId('{r[1]}').x")
        fr.evaluate("() => { __ed.setTool('move'); document.activeElement && document.activeElement.blur(); }")
        page.keyboard.press("ArrowRight"); settle(fr, 200)
        assert fr.evaluate(f"() => __ed.byId('{r[1]}').x") == x0
        fr.evaluate("() => __ed.setTool('select')")
        # unlocked again: it all comes back
        click(page, fr, f"#rows .lr[data-id='{gid}'] [data-a=lock]"); settle(fr, 700)
        fr.evaluate(f"() => {{ __ed.S.ids = ['{r[1]}']; __ed.refresh(); }}"); settle(fr)
        assert not fr.evaluate("() => document.querySelector('#pbody .why')") and not fr.evaluate("() => document.querySelector('#lset').classList.contains('off')")
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ENGINES)
def test_a_locked_layer_is_grey_and_not_picked_on_the_picture(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        pics = fr.evaluate("""() => { const out = []; (function r(l) { for (const n of l) { if (n.children) r(n.children); else if (n.type === 'pixel') out.push(n.id); } })(__ed.root); return out; }""")
        top = pics[-1]
        # where the top picture is, on the page
        at = fr.evaluate(f"""() => {{ const n = __ed.byId('{top}'), V = __ed.V; return [V.x + (n.x + n.w * .15) * V.s, V.y + (n.y + n.h * .85) * V.s]; }}""")
        off = page.locator(".ifed.on iframe").bounding_box()
        fr.evaluate("() => { __ed.setTool('select'); __ed.S.ids = []; __ed.refresh(); }"); settle(fr)
        page.mouse.click(off["x"] + at[0], off["y"] + at[1]); settle(fr)
        assert fr.evaluate("() => __ed.S.ids") == [top]   # picked while open
        click(page, fr, f"#rows .lr[data-id='{top}'] [data-a=lock]"); settle(fr, 700)
        fr.evaluate("() => { __ed.S.ids = []; __ed.refresh(); }"); settle(fr)
        page.mouse.click(off["x"] + at[0], off["y"] + at[1]); settle(fr)
        assert fr.evaluate("() => __ed.S.ids") != [top]
        fr.evaluate(f"() => {{ __ed.S.ids = ['{top}']; __ed.refresh(); __ed.setTab('g1', 'props'); }}"); settle(fr)
        assert fr.evaluate("() => (document.querySelector('#pbody .why') || {}).textContent") == fr.evaluate("() => __ed.T.lockedSelf")
        assert fr.evaluate("() => getComputedStyle(document.querySelector('#pbody .sec.dis .sbi')).pointerEvents") == "none"
        assert not errors, errors
        browser.close()
