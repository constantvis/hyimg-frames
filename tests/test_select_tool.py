"""The frame editor in the app's one UI system (owner 2026-10-06): a Select tool like the 3D studio's (the arrow, V, the tool the editor opens
with; Move takes the 3D studio's G), drawn in the editors' one icon family (Hyimg ui/icons.js), its key a <kbd> shown only under ⌘; every control
of a row with the app's one row radius (round and pro); the panel groups' line is the app's one splitter (ui/split.js), a double click gives the
groups their halves back. Chromium and WebKit.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_select_tool.py
  FRAMES_SHOTS=<folder> also saves screenshots
"""
import time

import pytest

from test_imgframe import WEBKIT, closed, editor, hy, open_board, shot  # noqa: F401  (hy is the fixture)


def open_editor(p, port, engine):
    browser, page, errors = open_board(p, port, engine)
    page.evaluate("sel = new Set(['a1', 'b1']); render(); fit()"); time.sleep(0.6)
    page.keyboard.press("Alt+Meta+KeyG")
    page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
    fid = page.evaluate("() => Object.entries(board.items).find(([k, it]) => it.type === 'imgframe')[0]")
    page.wait_for_timeout(1200)
    page.dblclick(f".plg[data-id='{fid}']")
    fr = editor(page)
    fr.wait_for_function("() => window.__ed && __ed.ready", timeout=30000)
    return browser, page, fr, errors


PIXELS = """() => { const out = []; (function rec(l) { for (const n of l) { if (n.children) rec(n.children); else if (n.type === 'pixel' && n.visible) out.push({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }); } })(__ed.root); return out; }"""


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_select_tool_icons_keys_radius_and_splitter(hy, engine):
    if engine == "webkit" and not WEBKIT:
        pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_editor(p, port, engine)
        # Select is the tool the editor opens with, the first of the rail, the arrow of the editors' family, key V; Move is G
        assert fr.evaluate("() => __ed.S.tool") == "select"
        first = fr.evaluate("""() => { const b = document.querySelector('#rail [data-g]'), s = b.querySelector('svg'), ref = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          ref.innerHTML = HY_TOOL_IC.select; return { tool: b.dataset.tool, same: s.innerHTML === ref.innerHTML, key: (b.querySelector(':scope > kbd') || {}).textContent, on: b.classList.contains('on') }; }""")
        assert first == {"tool": "select", "same": True, "key": "V", "on": True}, first
        move = fr.evaluate("""() => { const b = document.querySelector('#rail [data-tool=move]'), ref = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ref.innerHTML = HY_TOOL_IC.move;
          return { same: b.querySelector('svg').innerHTML === ref.innerHTML, key: b.querySelector(':scope > kbd').textContent }; }""")
        assert move == {"same": True, "key": "G"}, move
        assert fr.evaluate("() => getComputedStyle(document.querySelector('#rail [data-tool=select] > kbd')).opacity") == "0", "the key shows only under ⌘"
        shot(page, f"select-tool-{engine}.png")
        fr.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("g"); page.wait_for_timeout(150); assert fr.evaluate("() => __ed.S.tool") == "move"
        page.keyboard.press("v"); page.wait_for_timeout(150); assert fr.evaluate("() => __ed.S.tool") == "select"
        # a click with Select picks the layer under the pointer; ⇧ adds another; a click on nothing changes nothing
        px = fr.evaluate(PIXELS); assert len(px) >= 2, px
        off = page.evaluate("() => { const w = document.querySelector('.ifed').getBoundingClientRect(); return [w.left, w.top]; }")
        V = fr.evaluate("() => ({ x: __ed.V.x, y: __ed.V.y, s: __ed.V.s })")
        at = lambda n: (off[0] + V["x"] + (n["x"] + n["w"] / 2) * V["s"], off[1] + V["y"] + (n["y"] + n["h"] / 2) * V["s"])   # noqa: E731
        fr.evaluate("() => { __ed.S.ids = []; }")
        page.mouse.click(*at(px[0])); page.wait_for_timeout(200)
        ids = fr.evaluate("() => __ed.S.ids"); assert len(ids) == 1, ids
        page.keyboard.down("Shift"); page.mouse.click(*at(px[1])); page.keyboard.up("Shift"); page.wait_for_timeout(200)
        ids2 = fr.evaluate("() => __ed.S.ids"); assert len(ids2) == 2 and ids[0] in ids2, ids2
        geo = [(n["x"], n["y"]) for n in fr.evaluate(PIXELS)]
        assert geo == [(n["x"], n["y"]) for n in px], "Select never moves anything"
        # one row radius: the editor's controls and the app's slider, round and pro
        RADII = """() => { const box = document.createElement('div'); box.id = '__r'; box.style.cssText = 'position:fixed;left:40px;top:120px;width:260px;z-index:99';
          box.innerHTML = '<div class="hy-slider"><input type="range" min="0" max="10" value="3"><span class="hy-slider-l">x</span></div><button class="btn">b</button><div class="selb">s</div><div class="nf">n</div><button class="ib">i</button>';
          document.getElementById('__r') && document.getElementById('__r').remove(); document.body.appendChild(box);
          const r = s => getComputedStyle(box.querySelector(s)).borderTopLeftRadius, row = getComputedStyle(document.documentElement).getPropertyValue('--hy-row-r').trim();
          return { row, slider: r('.hy-slider'), btn: r('.btn'), selb: r('.selb'), nf: r('.nf'), ib: r('.ib') }; }"""
        for shape, want in (("round", "999px"), ("pro", "8px")):
            fr.evaluate(f"() => {{ document.documentElement.dataset.shape = '{shape}'; }}")
            r = fr.evaluate(RADII)
            assert r["row"] == want and {r["btn"], r["selb"], r["nf"], r["ib"]} == {want}, (shape, r)
            if fr.evaluate("() => !!document.querySelector('link[href$=\"ui/slider.css\"]')"): assert r["slider"] == want, (shape, r)
        fr.evaluate("() => { document.getElementById('__r').remove(); document.documentElement.dataset.shape = 'round'; }")
        # the panel groups' line: the app's splitter; a drag sets the height, a double click gives the halves back
        assert fr.evaluate("() => document.getElementById('split').classList.contains('hy-split')")
        fr.evaluate("() => { __ed.S.splitH = 220; __ed.applySplit(); }")
        assert fr.evaluate("() => __ed.S.splitH") == 220
        fr.dblclick("#split"); page.wait_for_timeout(200)
        assert fr.evaluate("() => __ed.S.splitH") is None
        assert not errors, errors
        browser.close()
