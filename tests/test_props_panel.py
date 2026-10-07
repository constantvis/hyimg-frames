"""The image studio's right panel after the owner's six notes of 2026-10-07, in the editor on the board, Chromium and WebKit:

1. «вот это горизонтально должно быть ... и какая-то анимация, чтобы понятно было, что включили»: the W ↔ H link is the app's horizontal
   link (ui/icons.js linkWH, svg.hy-link); on, its halves close on the bar along the app's curve; Document has the same link between its W
   and H instead of a «Constrain proportions» switch, and it scales the other side;
2. «бг прозрачный не включается»: Transparent shows the checkerboard over the board, and the saved render keeps its alpha;
3. «нужно по умолчанию выбранный дефолтный»: Adjustments has a normal button and the presets list starts with Neutral, chosen while the
   Raw Editor on top is neutral; each swatch is the preset's own render of one sample; a hover shows it, leaving puts it back, a click is
   one step to undo;
4. «fill уберем»: no Fill field, a layer saved with fill takes it into its opacity (a clipping base keeps it, so it draws as before);
5. «lock тоже уберем»: no Lock row; every row has its lock button, as the eye;
6. «если я зажимаю глаз ... и потом не отпуская тяну»: Photoshop's eye drag (ui/eyedrag.js) on eyes, locks and the Raw Editor's section
   eyes, the first row's new state for every row passed, one step to undo, the list scrolling on past its edge.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_props_panel.py
  FRAMES_SHOTS=<folder> also saves screenshots of the panel in both themes
"""
import io, json, urllib.request

import pytest
from PIL import Image

from test_imgframe import WEBKIT, board, hy, post, shot  # noqa: F401  (hy is the fixture)
from test_select_tool import open_editor

ENGINES = ["chromium", "webkit"]
PIXELS = """() => { const out = []; (function r(l) { for (const n of l) { if (n.children) r(n.children); else if (n.type === 'pixel') out.push(n.id); } })(__ed.root); return out; }"""
PIX = """([x, y]) => { __ed.renderView(); const c = __ed.acc, k = Math.max(1, devicePixelRatio || 1), V = __ed.V;
  return [...c.getContext('2d').getImageData(Math.round((V.x + x * V.s) * k), Math.round((V.y + y * V.s) * k), 1, 1).data]; }"""
SECTION = """(name) => [...document.querySelectorAll('#pbody .sec')].find(s => s.querySelector('.sh').textContent.trim().toUpperCase().startsWith(name.toUpperCase()))"""


def start(p, port, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    browser, page, fr, errors = open_editor(p, port, engine)
    fr.wait_for_timeout(900)   # the panels slide in first
    return browser, page, fr, errors


def link_state(fr, sel):
    return fr.evaluate("""(sel) => { const b = document.querySelector(sel), s = b.querySelector('svg.hy-link'), la = s.querySelector('.la'), lm = s.querySelector('.lm'), bb = s.getBBox();
      const st = getComputedStyle(la); return { on: b.classList.contains('on'), same: (() => { const ref = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); ref.innerHTML = HY_TOOL_IC.linkWH; return s.innerHTML === ref.innerHTML; })(), wide: bb.width > bb.height * 1.4,
        la: new DOMMatrix(st.transform).e, lm: +getComputedStyle(lm).opacity, ease: st.transitionTimingFunction, dur: st.transitionDuration }; }""", sel)


def settle(fr, ms=400): fr.wait_for_timeout(ms)


@pytest.mark.parametrize("engine", ENGINES)
def test_link_is_horizontal_and_document_uses_it(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        # a layer: Transform's link between W and H
        fr.evaluate("(ids) => { __ed.S.ids = [ids[0]]; __ed.refresh(); __ed.setTab('g1', 'props'); }", fr.evaluate(PIXELS)); settle(fr)
        s = link_state(fr, "#pbody .whr .xlk")
        assert s["same"] and s["wide"], s
        assert "cubic-bezier(0.32, 0.72, 0, 1)" in s["ease"] and "0.24s" in s["dur"], s
        on0 = s["on"]; assert on0 == fr.evaluate("() => __ed.S.lockRatio")
        assert (s["la"] == 0 and s["lm"] > .9) if on0 else (s["la"] < -1 and s["lm"] < .1), s
        fr.click("#pbody .whr .xlk"); settle(fr)
        s2 = link_state(fr, "#pbody .whr .xlk")
        assert s2["on"] != on0 and fr.evaluate("() => __ed.S.lockRatio") == s2["on"], s2
        assert (s2["la"] == 0 and s2["lm"] > .9) if s2["on"] else (s2["la"] < -1 and s2["lm"] < .1), (s, s2)
        # nothing chosen: Document has W, the link and H in one row, and no «Constrain proportions» switch
        fr.evaluate("() => { __ed.S.ids = []; __ed.refresh(); }"); settle(fr)
        row = fr.evaluate(f"""() => {{ const s = ({SECTION})(__ed.T.document); const r = s && s.querySelector('.whr');
          return {{ kids: r ? [...r.children].map(c => c.classList.contains('xlk') ? 'link' : (c.querySelector('.nl') || {{}}).textContent) : null,
            sw: [...s.querySelectorAll('.tg')].map(t => t.textContent) }}; }}""")
        assert row["kids"] == ["W", "link", "H"] and row["sw"] == [], row
        d = link_state(fr, "#pbody .sec .whr .xlk")
        assert d["same"] and d["on"] == fr.evaluate("() => __ed.S.docLock !== false"), d
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); settle(fr, 300)
            shot(page, f"props-doc-link-{th}-{engine}.png")
        # on: a new W scales H by the document's ratio (1000 × 450)
        if not d["on"]: fr.click("#pbody .sec .whr .xlk"); settle(fr, 100)
        w0, h0 = fr.evaluate("() => [__ed.W, __ed.H]")
        inp = fr.locator("#pbody .sec .whr .nf").first.locator("input")
        inp.click(); inp.fill(str(w0 // 2)); inp.press("Enter"); settle(fr)
        assert fr.evaluate("() => [__ed.W, __ed.H]") == [w0 // 2, round(h0 / 2)]
        # off: the halves part, the other side stays
        fr.click("#pbody .sec .whr .xlk"); settle(fr)
        d2 = link_state(fr, "#pbody .sec .whr .xlk"); assert not d2["on"] and d2["la"] < -1 and d2["lm"] < .1 and fr.evaluate("() => __ed.S.docLock") is False, d2
        inp = fr.locator("#pbody .sec .whr .nf").first.locator("input")
        inp.click(); inp.fill("400"); inp.press("Enter"); settle(fr)
        assert fr.evaluate("() => [__ed.W, __ed.H]") == [400, round(h0 / 2)]
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ENGINES)
def test_transparent_background_shows_the_checkerboard_and_saves_alpha(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        # the owner's case: the only pictures hidden, Transparent chosen
        fr.evaluate(f"() => {{ for (const id of ({PIXELS})()) __ed.byId(id).visible = false; __ed.S.ids = []; __ed.refresh(); }}"); settle(fr)
        W, H = fr.evaluate("() => [__ed.W, __ed.H]")
        assert fr.evaluate(PIX, [W / 2, H / 2])[:3] == [255, 255, 255]   # white, as it opened
        fr.locator("#pbody .bgsw.tr").click(); settle(fr)
        assert fr.evaluate("() => document.querySelector('#pbody .bgsw.tr').classList.contains('on')")
        # the checkerboard's two greys, opaque, over the board's paper
        a, b = fr.evaluate(PIX, [6, 6]), fr.evaluate(PIX, [W / 2 + 0.5, H / 2 + 0.5])
        cols = {tuple(fr.evaluate(PIX, [x, y])[:3]) for x in range(2, 60, 3) for y in (2, 12, 22)}
        assert a[3] == 255 and b[3] == 255, (a, b)
        assert {(228, 228, 231), (196, 196, 202)} <= cols, cols
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); settle(fr, 300)
            shot(page, f"props-transparent-{th}-{engine}.png")
        # saved: the render has its alpha, the card says so
        fr.click("#bSave")
        page.wait_for_function(f"() => board.items['{fid}'].v === 2", timeout=60000)
        page.wait_for_function("() => !dirty", timeout=10000)
        it = board(state)["items"][fid]
        im = Image.open(lib / it["render"]); assert im.mode == "RGBA", im.mode
        assert im.getpixel((W // 2, H // 2))[3] == 0 and im.getpixel((3, 3))[3] == 0
        doc = json.loads((lib / it["doc"]).read_text()); assert doc["background"] is None, doc["background"]
        assert not errors, errors
        browser.close()


SWATCH = """(k) => { const t = document.querySelector(`#padj .adjt[data-k="${k}"]`), cv = t.querySelector('canvas'); const w = cv.width, h = cv.height;
  const R = HyColorGrade.createRenderer(), want = R.render(HyColorGrade.sample(w, h), HyColorGrade.presets[k] || {}, document.createElement('canvas'));
  const a = document.createElement('canvas'); a.width = w; a.height = h; const x = a.getContext('2d', { willReadFrequently: true });
  x.drawImage(cv, 0, 0); const p = x.getImageData(0, 0, w, h).data; x.clearRect(0, 0, w, h); x.drawImage(want, 0, 0, w, h); const q = x.getImageData(0, 0, w, h).data;
  let d = 0, rb = 0, sat = 0; for (let i = 0; i < p.length; i += 4) { d += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
    rb += p[i] - p[i + 2]; sat += Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]); }
  const n = p.length / 4; return { diff: d / n / 3, rb: rb / n, sat: sat / n }; }"""
ADJ = """() => { const m = __ed.root.find(n => n.main); return { tiles: [...document.querySelectorAll('#padj .adjt')].map(t => t.dataset.k),
  on: [...document.querySelectorAll('#padj .adjt.on')].map(t => t.dataset.k), temp: m.params.temp, undo: __ed.S.undo.length,
  bh: document.querySelector('#padj .adjnew').getBoundingClientRect().height }; }"""


@pytest.mark.parametrize("engine", ENGINES)
def test_adjustments_presets_default_swatches_hover_and_click(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        ids = fr.evaluate(PIXELS)
        fr.evaluate("(ids) => { __ed.S.ids = [ids[0]]; __ed.refresh(); __ed.setTab('g1', 'adj'); __ed.S.undo.length = 0; __ed.S.redo.length = 0; }", ids); settle(fr)
        a = fr.evaluate(ADJ)
        assert a["bh"] <= 32, a                                                    # the app's button, not a 180 px pill
        assert a["tiles"][0] == "Neutral" and len(a["tiles"]) == 6 and a["on"] == ["Neutral"], a
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); settle(fr, 300)
            shot(page, f"adj-presets-{th}-{engine}.png")
        # each swatch is its preset's render of the sample, so it says what the name says
        sw = {k: fr.evaluate(SWATCH, k) for k in a["tiles"]}
        assert all(v["diff"] < 3 for v in sw.values()), sw
        assert sw["Warm Product"]["rb"] > sw["Neutral"]["rb"] + 4 > sw["Cool Studio"]["rb"] + 8, sw
        assert sw["High Contrast B&W"]["sat"] < 3 < sw["Neutral"]["sat"], sw
        # a hover shows Warm Product on the picture, nothing kept; leaving the list puts it back
        W, H = fr.evaluate("() => [__ed.W, __ed.H]"); at = [W * .3, H * .6]
        p0 = fr.evaluate(PIX, at)
        fr.hover("#padj .adjt[data-k='Warm Product']"); settle(fr, 200)
        b = fr.evaluate(ADJ); assert b["temp"] == 16 and b["undo"] == 0, b
        p1 = fr.evaluate(PIX, at); assert p1 != p0, (p0, p1)
        page.mouse.move(5, 450); settle(fr, 200)
        c = fr.evaluate(ADJ); assert c["temp"] == 0 and c["on"] == ["Neutral"] and c["undo"] == 0, c
        assert fr.evaluate(PIX, at) == p0
        # a click keeps Cool Studio: one step, chosen in the list; ⌘Z puts Neutral back
        fr.click("#padj .adjt[data-k='Cool Studio']"); page.mouse.move(5, 450); settle(fr, 300)
        d = fr.evaluate(ADJ); assert d["temp"] == -14 and d["undo"] == 1 and d["on"] == ["Cool Studio"], d
        fr.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("Meta+z"); settle(fr, 300)
        e = fr.evaluate(ADJ); assert e["temp"] == 0 and e["on"] == ["Neutral"], e
        # away and back: Neutral chosen again
        fr.evaluate("() => { __ed.setTab('g1', 'props'); __ed.setTab('g1', 'adj'); }"); settle(fr)
        assert fr.evaluate(ADJ)["on"] == ["Neutral"]
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ENGINES)
def test_fill_and_the_lock_row_are_gone_and_fill_folds_into_opacity(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        ids = fr.evaluate(PIXELS)
        fr.evaluate("(ids) => { __ed.S.ids = [ids[0]]; __ed.refresh(); }", ids); settle(fr)
        g = fr.evaluate("""() => ({ fill: !!document.querySelector('#lFill'), locks: document.querySelectorAll('#lset [data-lock], #lset .lk').length, text: document.querySelector('#lset').innerText,
          opacity: !!document.querySelector('#lOp'), rows: [...document.querySelectorAll('#rows .lr:not(.main):not(.mmask)')].map(r => !!r.querySelector('[data-a=lock]')) })""")
        assert not g["fill"] and g["locks"] == 0 and g["opacity"] and "Fill" not in g["text"] and "Lock" not in g["text"], g
        assert g["rows"] and all(g["rows"]), g
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); settle(fr, 300)
            shot(page, f"props-layers-{th}-{engine}.png")
        # a frame saved with fill: the top layer's fill goes into its opacity (it draws the same), a clipping base keeps its own
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        path = page.evaluate(f"() => board.items['{fid}'].doc")
        doc = json.loads((lib / path).read_text())
        lo, up = doc["layers"][0], doc["layers"][1]
        up.update(fill=40, opacity=80)
        doc["layers"].append(dict(lo, id="base2", fill=50, opacity=100)); doc["layers"].append(dict(up, id="clip2", clip=True, fill=100, opacity=100))
        assert post(port, f"/api/file?p={urllib.request.quote(path)}", json.dumps(doc).encode(), "application/json")[0] == 200
        fr.evaluate("() => __ed.loadDoc()"); fr.wait_for_function("() => __ed.ready && __ed.byId('base2')", timeout=20000)
        got = fr.evaluate(f"() => ['{up['id']}', 'base2'].map(id => {{ const n = __ed.byId(id); return [n.opacity, n.fill]; }})")
        assert got == [[32, 100], [100, 50]], got
        assert not errors, errors
        browser.close()


ROWS = """() => [...document.querySelectorAll('#rows .lr')].filter(r => !r.classList.contains('main') && !r.classList.contains('mmask')).map(r => r.dataset.id)"""
STATE = """(ids) => ids.map(id => { const n = __ed.byId(id); return [n.visible, !!(n.locks.all || n.locks.pos || n.locks.alpha || (n.locks.pixels && !n.orig))]; })"""


def center(fr, sel):
    b = fr.locator(sel).bounding_box(); return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


@pytest.mark.parametrize("engine", ENGINES)
def test_eye_and_lock_drag_in_layers(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        # two new layers over a and b: four rows; the second one hidden already
        fr.evaluate("() => { document.querySelector('#lbot [data-key]') }")
        for _ in range(2): fr.evaluate("() => [...document.querySelectorAll('#lbot .ib')].find(b => b.dataset.key === '⇧ ⌘ N').click()")
        settle(fr)
        rows = fr.evaluate(ROWS); assert len(rows) == 4, rows
        fr.evaluate("(id) => { __ed.byId(id).visible = false; __ed.refresh(); __ed.S.undo.length = 0; __ed.S.redo.length = 0; }", rows[1]); settle(fr)
        # press the first row's eye, drag over the other three: all hidden (the hidden one stays hidden), one step
        x, y = center(fr, f"#rows .lr[data-id='{rows[0]}'] [data-a=eye]")
        _, y3 = center(fr, f"#rows .lr[data-id='{rows[3]}'] [data-a=eye]")
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 3, y3, steps=6); page.mouse.up(); settle(fr)
        assert [v for v, _ in fr.evaluate(STATE, rows)] == [False] * 4
        assert fr.evaluate("() => __ed.S.undo.length") == 1
        page.keyboard.press("Meta+z"); settle(fr)
        assert [v for v, _ in fr.evaluate(STATE, rows)] == [True, False, True, True]
        # from the hidden one up: shown, and the row above it stays shown (set, not switched)
        x, y = center(fr, f"#rows .lr[data-id='{rows[1]}'] [data-a=eye]"); _, y0 = center(fr, f"#rows .lr[data-id='{rows[0]}'] [data-a=eye]")
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, y0, steps=4); page.mouse.up(); settle(fr)
        assert [v for v, _ in fr.evaluate(STATE, rows)] == [True] * 4 and fr.evaluate("() => __ed.S.undo.length") == 1
        # locks: the first row's lock locks all four in one step; ⌘Z unlocks them
        x, y = center(fr, f"#rows .lr[data-id='{rows[0]}'] [data-a=lock]"); _, y3 = center(fr, f"#rows .lr[data-id='{rows[3]}'] [data-a=lock]")
        u0 = fr.evaluate("() => __ed.S.undo.length")
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, y3, steps=6); page.mouse.up(); settle(fr)
        assert [l for _, l in fr.evaluate(STATE, rows)] == [True] * 4 and fr.evaluate("() => __ed.S.undo.length") == u0 + 1
        assert fr.evaluate(f"(ids) => ids.every(id => document.querySelector(`#rows .lr[data-id='${{id}}'] [data-a=lock]`).classList.contains('keep'))", rows)
        page.keyboard.press("Meta+z"); settle(fr)
        assert [l for _, l in fr.evaluate(STATE, rows)] == [False] * 4
        # a click alone still switches one row, once
        fr.click(f"#rows .lr[data-id='{rows[2]}'] [data-a=eye]"); settle(fr)
        assert [v for v, _ in fr.evaluate(STATE, rows)] == [True, True, False, True]
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ENGINES)
def test_lock_drag_past_the_bottom_scrolls_the_layers(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        for _ in range(22): fr.evaluate("() => [...document.querySelectorAll('#lbot .ib')].find(b => b.dataset.key === '⇧ ⌘ N').click()")
        settle(fr)
        fr.evaluate("() => { document.querySelector('#list').scrollTop = 0; __ed.S.undo.length = 0; __ed.S.redo.length = 0; }")
        rows = fr.evaluate(ROWS); assert len(rows) == 24
        assert fr.evaluate("() => { const l = document.querySelector('#list'); return l.scrollHeight > l.clientHeight + 100; }")
        lb = fr.locator("#list").bounding_box()
        x, y = center(fr, f"#rows .lr[data-id='{rows[0]}'] [data-a=lock]")
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, lb["y"] + lb["height"] + 40, steps=8)
        fr.wait_for_function("() => { const l = document.querySelector('#list'); return l.scrollTop + l.clientHeight >= l.scrollHeight - 1; }", timeout=10000)
        settle(fr, 200); page.mouse.up(); settle(fr)
        assert [l for _, l in fr.evaluate(STATE, rows)] == [True] * 24
        assert fr.evaluate("() => __ed.S.undo.length") == 1
        page.keyboard.press("Meta+z"); settle(fr)
        assert [l for _, l in fr.evaluate(STATE, rows)] == [False] * 24
        assert not errors, errors
        browser.close()


OFF = """() => { const n = __ed.byId(__ed.S.ids[0]); return Object.keys(n.params.off || {}).filter(k => n.params.off[k]); }"""


@pytest.mark.parametrize("engine", ENGINES)
def test_raw_editor_section_eyes_drag(hy, engine):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        ids = fr.evaluate(PIXELS)
        fr.evaluate("(ids) => { __ed.S.ids = [ids[0]]; __ed.refresh(); __ed.setTab('g1', 'adj'); }", ids); settle(fr)
        fr.click("#padj .adjnew"); settle(fr, 600)
        fr.evaluate("() => { document.querySelectorAll('#padj .hcg-sec.open .hcg-head .t').forEach(t => t.click()); __ed.S.undo.length = 0; __ed.S.redo.length = 0; }"); settle(fr, 500)
        secs = fr.evaluate("() => [...document.querySelectorAll('#padj .hcg-sec')].map(s => s.dataset.id)")
        assert len(secs) >= 4, secs
        x, y = center(fr, f"#padj .hcg-sec[data-id={secs[0]}] .hcg-head .ey"); _, y3 = center(fr, f"#padj .hcg-sec[data-id={secs[3]}] .hcg-head .ey")
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, (y + y3) / 2, steps=4); fr.wait_for_timeout(700)   # a rest longer than the 450 ms a typed change waits
        page.mouse.move(x, y3, steps=4); page.mouse.up(); settle(fr, 900)
        assert sorted(fr.evaluate(OFF)) == sorted(secs[:4]), fr.evaluate(OFF)
        assert fr.evaluate("() => __ed.S.undo.length") == 1
        assert fr.evaluate(f"() => [...document.querySelectorAll('#padj .hcg-sec')].slice(0, 4).every(s => s.classList.contains('off'))")
        fr.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("Meta+z"); settle(fr, 400)
        assert fr.evaluate(OFF) == []
        assert not errors, errors
        browser.close()


# the shackle's angle in degrees now, from its computed transform (0: closed, 30: open)
ANGLE = """(sel) => { const m = new DOMMatrix(getComputedStyle(document.querySelector(sel)).transform); return Math.round(Math.atan2(m.b, m.a) * 1800 / Math.PI) / 10; }"""
# the angles over 450 ms, a frame apart
TRACK = """(sel) => new Promise(done => { const out = [], t0 = performance.now(); const f = () => { const m = new DOMMatrix(getComputedStyle(document.querySelector(sel)).transform);
  out.push(Math.atan2(m.b, m.a) * 180 / Math.PI); if (performance.now() - t0 < 450) requestAnimationFrame(f); else done(out); }; f(); })"""


@pytest.mark.parametrize("engine", ENGINES)
def test_the_padlock_swings_open_and_shut(hy, engine):
    """owner 2026-10-07: «можно эту иконку более явной сделать и в идеале анимированной, чтобы поворачивалась эта дуга, когда открывается»:
    every row's lock is the app's one padlock (ui/icons.js hyLockIcon); open, its shackle is lifted and swung 30° about its right leg and the
    icon is dimmer; a click swings it shut along the app's curve, a frame at a time, and back"""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, engine)
        rid = fr.evaluate(ROWS)[0]
        btn, sh = f"#rows .lr[data-id='{rid}'] [data-a=lock]", f"#rows .lr[data-id='{rid}'] [data-a=lock] svg.hy-lock .sh"
        fr.hover(f"#rows .lr[data-id='{rid}'] .nm"); settle(fr, 300)
        assert fr.evaluate(f"() => {{ const s = document.querySelector(\"{btn} svg\"); return s.classList.contains('hy-lock') && !s.classList.contains('locked'); }}")
        assert abs(fr.evaluate(ANGLE, sh) - 30) < 0.5
        assert "cubic-bezier(0.32, 0.72, 0, 1)" in fr.evaluate(f"() => getComputedStyle(document.querySelector(\"{sh}\")).transitionTimingFunction")
        op = lambda: float(fr.evaluate(f"() => getComputedStyle(document.querySelector(\"{btn} svg\")).opacity"))
        assert op() < 0.7
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); settle(fr, 300)
            shot(fr.locator(f"#rows .lr[data-id='{rid}']"), f"padlock-open-{th}-{engine}.png")
        page.evaluate("() => document.documentElement.dataset.theme = 'dark'"); settle(fr, 300)
        # a click shuts it: the angle falls from 30 to 0 through the frames between
        b = fr.locator(btn).bounding_box(); page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        page.mouse.down(); page.mouse.up()
        seq = fr.evaluate(TRACK, sh)
        assert any(3 < a < 27 for a in seq), seq
        assert all(x >= y - 0.5 for x, y in zip(seq, seq[1:])), seq
        settle(fr, 300)
        assert abs(fr.evaluate(ANGLE, sh)) < 0.5 and op() > 0.95
        assert fr.evaluate(f"() => __ed.byId('{rid}').locks.all")
        for th in ("dark", "light"):
            page.evaluate(f"() => document.documentElement.dataset.theme = '{th}'"); settle(fr, 300)
            shot(fr.locator(f"#rows .lr[data-id='{rid}']"), f"padlock-shut-{th}-{engine}.png")
        page.evaluate("() => document.documentElement.dataset.theme = 'dark'"); settle(fr, 300)
        # and open again, slowed down ten times for a sequence of pictures of the swing
        b = fr.locator(btn).bounding_box(); page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        page.mouse.down(); page.mouse.up()
        fr.evaluate("() => document.getAnimations().forEach(a => { a.playbackRate = 0.1; })")
        for i in range(4):
            shot(fr.locator(btn), f"padlock-swing-{i}-{engine}.png"); fr.wait_for_timeout(450)
        fr.evaluate("() => document.getAnimations().forEach(a => a.finish())"); settle(fr, 400)
        assert abs(fr.evaluate(ANGLE, sh) - 30) < 0.5 and not fr.evaluate(f"() => __ed.byId('{rid}').locks.all")
        assert not errors, errors
        browser.close()
