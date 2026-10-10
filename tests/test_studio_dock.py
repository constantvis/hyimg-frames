"""Image Studio's tools in the board's dock (owner 2026-10-08, round 11 «Tools in the dock · D3», note neb38wlg: «Все, отлично, давай делай
так»): the rail on the left steps out and the dock carries the six groups (only the tools the studio has), the two colours, the zoom and
Actions; the options of the tool in hand ride right above the dock, their numbers filled in the studio's purple. A group with more tools has
a corner mark: a plain click takes the button's tool, holding 0.25 s or dragging up 6 px opens its list and letting go on a tool takes it,
letting go on the button keeps the list, letting go elsewhere or Esc changes nothing, a right click or the mark opens it, ↑ ↓ ↵ work in it.
The dock never moves, the studio's keys keep working, leaving the studio gives the board its dock back. Chromium, dark.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_studio_dock.py
  FRAMES_SHOTS=<folder> also saves the dock, a group opened by holding and the options strip
"""
import time

from test_imgframe import closed, editor, hy, shot  # noqa: F401  (hy is the fixture)

DOCK = "() => { const r = document.getElementById('dock').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.top)]; }"
TOOL = "() => __ed.S.tool"
ON = "() => { const b = document.querySelector('#dock button.ifg.on'); return b ? [b.dataset.g, b.dataset.t] : null; }"
FLY = "() => { const f = document.querySelector('.ifly.show'); return f ? [...f.querySelectorAll('button[data-t]')].map(b => b.dataset.t + (b.classList.contains('hi') ? '*' : '')) : null; }"


def open_studio(p, port):
    browser = p.chromium.launch()
    # 1600 wide: the dock (with Undo and Redo since 2026-10-10, about 770 px) fits between the library and the right column
    page = browser.new_page(viewport={"width": 1600, "height": 900}, color_scheme="dark")
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{port}/canvas.html")
    page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
    page.wait_for_selector(".it[data-id=a1]")
    page.evaluate("sel = new Set(['a1', 'b1']); render(); fit()"); time.sleep(0.6)
    page.keyboard.press("Alt+Meta+KeyG")
    page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
    fid = page.evaluate("() => Object.entries(board.items).find(([k, it]) => it.type === 'imgframe')[0]")
    page.wait_for_timeout(1200)
    page.dblclick(f".plg[data-id='{fid}']")
    fr = editor(page); page.wait_for_timeout(700)
    return browser, page, fr, errors


def mid(page, sel):
    b = page.locator(sel).first.bounding_box(); return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def test_studio_dock(hy):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_studio(p, port)
        # the six groups, in D3's order, the corner mark only on the two that hold more; the rail is out, the board's own buttons too
        groups = page.evaluate("() => [...document.querySelectorAll('#dock button.ifg')].map(b => [b.dataset.g, b.dataset.t, !!b.querySelector('.fm')])")
        assert groups == [["gsel", "select", True], ["gmarq", "marquee", True], ["gbrush", "brush", False], ["gheal", "patch", False],
                          ["gpick", "pick", False], ["ghand", "hand", False]], groups
        assert page.evaluate(ON) == ["gsel", "select"]
        assert fr.evaluate("() => getComputedStyle(document.getElementById('rail')).display") == "none"
        assert page.evaluate("() => [...document.querySelectorAll('#dock > button')].every(b => getComputedStyle(b).display === 'none')")
        assert page.evaluate("() => !!document.querySelector('#dock #modesw') && !!document.querySelector('#dock .ifcol .fg') && !!document.querySelector('#dock #ifZoom')")
        # Russian board: the tooltips in Russian, the tool's name and key, the gesture said on the groups that hold more
        tip = page.evaluate("() => document.querySelector('#dock button.ifg[data-g=gmarq]').title")
        assert "M" in tip and "зажми и веди вверх" in tip, tip
        assert "Select and move" not in fr.evaluate("() => window.__edMiss")
        assert page.evaluate("() => __frames && document.querySelector('#dock button.ifg[data-g=gsel]').title").startswith(fr.evaluate("() => __ed.T.tool.select"))
        d0 = page.evaluate(DOCK)

        # the options strip: right above the dock, centred on it (owner 2026-10-09: «второе меню сверху должно быть отцентрировано, а то оно
        # left aligned относительно меню нижнего»), the tool's name after its icon; inside the free part between the library and the right column
        def strip():
            return page.evaluate("""() => { const f = document.querySelector('.ifed iframe'), o = f.contentDocument.getElementById('obar'),
              r = o.getBoundingClientRect(), d = document.getElementById('dock').getBoundingClientRect(), cs = getComputedStyle(o), w = f.getBoundingClientRect(),
              rs = getComputedStyle(f.contentDocument.documentElement), l = parseFloat(rs.getPropertyValue('--obl')), rr = parseFloat(rs.getPropertyValue('--obr'));
              return { ctr: w.left + r.left + r.width / 2 - (d.left + d.width / 2), gap: Math.round(d.top - w.top - r.bottom), dock: o.classList.contains('indock'),
                op: +cs.opacity, name: (o.querySelector('.dtn') || {}).textContent || '', inL: r.left - l, inR: rr - 12 - r.right, w: r.width }; }""")
        s = strip()
        assert s["dock"] and abs(s["ctr"]) <= 1 and 6 <= s["gap"] <= 10 and s["op"] == 1, s
        assert s["name"] == fr.evaluate("() => __ed.T.tool.select"), s
        shot(page, "dock-1-studio.png")

        # a plain click on a group takes the tool the button shows, and the keyboard stays with the studio
        page.mouse.click(*mid(page, "#dock button.ifg[data-g=gbrush]")); page.wait_for_timeout(200)
        assert fr.evaluate(TOOL) == "brush" and page.evaluate(ON) == ["gbrush", "brush"]
        page.keyboard.press("KeyV"); page.wait_for_timeout(150)
        assert fr.evaluate(TOOL) == "select" and page.evaluate(ON) == ["gsel", "select"], "the studio's keys after a click in the dock"
        page.mouse.click(*mid(page, "#dock button.ifg[data-g=gmarq]")); page.wait_for_timeout(150)
        assert fr.evaluate(TOOL) == "marquee"

        # hold 0.25 s: the list opens over the button, the strip steps aside; let go on a tool: it is in hand, the button shows it
        x, y = mid(page, "#dock button.ifg[data-g=gsel]")
        page.mouse.move(x, y); page.mouse.down(); page.wait_for_timeout(150)
        assert page.evaluate(FLY) is None, "not before 0.25 s"
        page.wait_for_timeout(250)
        assert page.evaluate(FLY) == ["select", "move"]
        assert fr.evaluate("() => document.getElementById('obar').classList.contains('fly')")
        shot(page, "dock-2-hold.png")
        mx, my = mid(page, ".ifly button[data-t=move]")
        page.mouse.move(mx, my, steps=6); page.wait_for_timeout(80)
        assert page.evaluate(FLY) == ["select", "move*"]
        page.mouse.up(); page.wait_for_timeout(200)
        assert fr.evaluate(TOOL) == "move" and page.evaluate(ON) == ["gsel", "move"] and page.evaluate(FLY) is None
        assert not fr.evaluate("() => document.getElementById('obar').classList.contains('fly')")

        # press and drag up 6 px: the list at once, without the wait
        x, y = mid(page, "#dock button.ifg[data-g=gmarq]")
        page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x, y - 10, steps=2); page.wait_for_timeout(60)
        assert page.evaluate(FLY) == ["marquee", "ellipse", "lasso", "wand"]
        page.mouse.move(*mid(page, ".ifly button[data-t=lasso]"), steps=4); page.mouse.up(); page.wait_for_timeout(150)
        assert fr.evaluate(TOOL) == "lasso" and page.evaluate(ON) == ["gmarq", "lasso"]

        # let go on the button: the list stays, the tool in hand lit; a click on a tool takes it
        page.mouse.move(x, y); page.mouse.down(); page.wait_for_timeout(350); page.mouse.up(); page.wait_for_timeout(150)
        assert page.evaluate(FLY) == ["marquee", "ellipse", "lasso*", "wand"]
        page.mouse.click(*mid(page, ".ifly button[data-t=wand]")); page.wait_for_timeout(150)
        assert fr.evaluate(TOOL) == "wand" and page.evaluate(FLY) is None

        # let go elsewhere, or Esc while holding: nothing changes, the studio stays open
        page.mouse.move(x, y); page.mouse.down(); page.wait_for_timeout(350); page.mouse.move(700, 300, steps=5); page.mouse.up(); page.wait_for_timeout(150)
        assert fr.evaluate(TOOL) == "wand" and page.evaluate(FLY) is None
        page.mouse.move(x, y); page.mouse.down(); page.wait_for_timeout(350); page.keyboard.press("Escape"); page.mouse.up(); page.wait_for_timeout(150)
        assert fr.evaluate(TOOL) == "wand" and page.evaluate(FLY) is None and page.evaluate("() => !!__frames.ED")

        # a right click opens the list to be clicked; ↓ ↵ take the next tool; Esc closes a list that waits, and the studio stays
        page.mouse.click(*mid(page, "#dock button.ifg[data-g=gsel]"), button="right"); page.wait_for_timeout(150)
        assert page.evaluate(FLY) == ["select", "move*"]
        page.keyboard.press("ArrowUp"); page.keyboard.press("Enter"); page.wait_for_timeout(150)
        assert fr.evaluate(TOOL) == "select" and page.evaluate(FLY) is None
        page.mouse.click(*mid(page, "#dock button.ifg[data-g=gsel] .fm")); page.wait_for_timeout(150)
        assert page.evaluate(FLY) == ["select*", "move"], "the corner mark opens the list"
        page.keyboard.press("Escape"); page.wait_for_timeout(150)
        assert page.evaluate(FLY) is None and page.evaluate("() => !!__frames.ED") and fr.evaluate(TOOL) == "select"
        # a click on the picture closes a list that waits
        page.mouse.click(*mid(page, "#dock button.ifg[data-g=gmarq]"), button="right"); page.wait_for_timeout(120)
        page.mouse.click(700, 300); page.wait_for_timeout(150)
        assert page.evaluate(FLY) is None

        # the studio's keys move the dock: B the brush, M the marquee group with the marquee
        page.keyboard.press("KeyB"); page.wait_for_timeout(150)
        assert page.evaluate(ON) == ["gbrush", "brush"]
        page.keyboard.press("KeyM"); page.wait_for_timeout(150)
        assert page.evaluate(ON) == ["gmarq", "marquee"]

        # the brush's options over the dock, its numbers filled in the frame's purple; X swaps the colours in the dock too
        page.keyboard.press("KeyB"); page.wait_for_timeout(250)
        f = fr.evaluate("""() => [...document.querySelectorAll('#obar .xff[data-fill]')].map(x => [x.style.getPropertyValue('--b'), getComputedStyle(x).backgroundImage.includes('gradient')])""")
        assert len(f) >= 3 and all(b for _, b in f) and float(f[0][0].rstrip("%")) > 0, f
        shot(page, "dock-3-brush-strip.png")
        cols = "() => [...document.querySelectorAll('#dock .ifcol button')].map(b => b.style.getPropertyValue('--c'))"
        assert page.evaluate(cols) == fr.evaluate("() => [__ed.S.fg, __ed.S.bg]")
        page.keyboard.press("KeyX"); page.wait_for_timeout(120)
        assert page.evaluate(cols) == fr.evaluate("() => [__ed.S.fg, __ed.S.bg]") == ["#ffffff", "#000000"]

        assert abs(strip()["ctr"]) <= 1, strip()
        # a narrow window: the strip of the lasso (modes, feather, anti-alias, Subject, Remove Background) steps in just enough to stay in the
        # free part, never under the library or the right column; back at full width it is centred again
        page.keyboard.press("KeyL"); page.set_viewport_size({"width": 1000, "height": 900}); page.wait_for_timeout(700)
        s = strip()
        assert s["inL"] >= -1 and s["inR"] >= -1 and min(s["inL"], s["inR"]) <= 1, s   # pressed to an edge of the free part, not past it
        page.set_viewport_size({"width": 1600, "height": 900}); page.wait_for_timeout(700)
        s = strip()
        assert abs(s["ctr"]) <= 1 and s["inL"] >= -1 and s["inR"] >= -1, s
        page.keyboard.press("KeyB"); page.wait_for_timeout(300)
        assert abs(strip()["ctr"]) <= 1, strip()
        # the dock never moved: the same place and width through every gesture and tool, and through the zoom's number (to 1600 %)
        assert page.evaluate(DOCK) == d0, (page.evaluate(DOCK), d0)
        for k in ("Meta+Equal",) * 6 + ("Meta+Minus",) * 9:
            page.keyboard.press(k); page.wait_for_timeout(60)
            assert page.evaluate(DOCK) == d0, (k, page.evaluate("() => document.getElementById('ifZoom').textContent"), page.evaluate(DOCK), d0)

        # leaving the studio gives the board its dock back, the list and the dock's tools are gone
        page.keyboard.press("Escape"); closed(page)
        assert page.evaluate("() => !document.querySelector('#dock .plgdock, #dock button.ifg, .ifly') && !document.getElementById('dock').classList.contains('plg-mode')")
        # another studio's dock (3D, Dev: HY.dock of their own) stands where the board's does, without this studio's place or looks
        other = page.evaluate("""() => { const d = document.getElementById('dock'), n = document.createElement('span'); n.innerHTML = '<button data-tool="x">X</button>';
          HY.dock(n); const r = d.getBoundingClientRect(), st = getComputedStyle(d), s = document.getElementById('stage').getBoundingClientRect();
          const out = { mid: d.classList.contains('ifmid') || !!d.style.getPropertyValue('--ifdx'), off: Math.round(r.left + r.width / 2 - (s.left + s.width / 2)),
            bg: getComputedStyle(n.firstChild).backgroundColor }; HY.dock(null); return out; }""")
        assert not other["mid"] and abs(other["off"]) <= 1, other
        assert page.evaluate("() => getComputedStyle(document.getElementById('bnote') || document.querySelector('#dock > button.ic')).display") != "none"
        assert not errors, errors
        browser.close()


def test_studio_dock_release_in_the_app(hy):
    """The owner in the app (2026-10-09): «почему когда я зажимаю, навожу на другой тул и отпускаю мышку, оно не включается». The app's
    Chromium gets the mouse from macOS, not from Playwright's mouse (which handles drags itself): here the input goes in as raw CDP mouse
    events, with a trackpad's pressure too; the press starts on the corner mark as well as on the button; and the button may not keep the
    pointer capture, so the moves and the release land on the list or on the studio's page under the gap. Letting go on the lit row always
    takes that tool, letting go on the button keeps the list, letting go elsewhere changes nothing."""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_studio(p, port)
        cdp = page.context.new_cdp_session(page)

        def mouse(kind, x, y, down, **k):
            cdp.send("Input.dispatchMouseEvent", dict(type=kind, x=x, y=y, button="left" if down or kind != "mouseMoved" else "none",
                                                      buttons=1 if down else 0, **k))

        def gesture(group, to, start=None, hold=0.4, force=None, release=None):
            """press on the group (or at start), hold, glide in 24 steps of a 60 Hz frame to the row `to` (or a point), let go there"""
            x, y = start or mid(page, f"#dock button.ifg[data-g={group}]")
            extra = {"force": force} if force is not None else {}
            mouse("mouseMoved", x, y, False); mouse("mousePressed", x, y, True, clickCount=1, **extra)
            if force is not None:   # a trackpad's press deepens where it is: pressure without a move
                for f in (0.3, 0.6, 0.8): mouse("mouseMoved", x, y, True, force=f); time.sleep(0.03)
            time.sleep(hold)
            tx, ty = mid(page, f".ifly button[data-t={to}]") if isinstance(to, str) else to
            for i in range(1, 25): mouse("mouseMoved", x + (tx - x) * i / 24, y + (ty - y) * i / 24, True, **extra); time.sleep(0.016)
            time.sleep(0.08); lit = page.evaluate(FLY)
            rx, ry = release or (tx, ty)
            mouse("mouseReleased", rx, ry, False, clickCount=1); time.sleep(0.25)
            return lit

        # the hold, then the glide onto Lasso: raw events, a mouse and a trackpad pressing deeper
        assert gesture("gmarq", "lasso") == ["marquee", "ellipse", "lasso*", "wand"]
        assert fr.evaluate(TOOL) == "lasso" and page.evaluate(ON) == ["gmarq", "lasso"] and page.evaluate(FLY) is None
        assert gesture("gsel", "move", force=0.5) == ["select", "move*"]
        assert fr.evaluate(TOOL) == "move" and page.evaluate(FLY) is None

        # the press on the corner mark (its 14 px target is a quarter of the button): the list at once, the glide lights the row, letting go takes it
        mx, my = mid(page, "#dock button.ifg[data-g=gmarq] .fm")
        assert gesture("gmarq", "wand", start=(mx - 3, my - 3), hold=0.05) == ["marquee", "ellipse", "lasso", "wand*"]
        assert fr.evaluate(TOOL) == "wand" and page.evaluate(ON) == ["gmarq", "wand"] and page.evaluate(FLY) is None

        # the button does not keep the pointer: the moves go to the list's rows, the release to the row or to the studio's page
        page.evaluate("() => { Element.prototype.__spc = Element.prototype.setPointerCapture; Element.prototype.setPointerCapture = function () {}; }")
        assert gesture("gmarq", "ellipse") == ["marquee", "ellipse*", "lasso", "wand"]
        assert fr.evaluate(TOOL) == "ellipse" and page.evaluate(ON) == ["gmarq", "ellipse"] and page.evaluate(FLY) is None
        # let go in the gap between the list and the dock, over the studio's page: nothing changes, the list goes
        x, y = mid(page, "#dock button.ifg[data-g=gmarq]")
        lit = gesture("gmarq", "lasso", release=(x, page.evaluate("() => document.getElementById('dock').getBoundingClientRect().top") - 4))
        assert lit == ["marquee", "ellipse", "lasso*", "wand"]
        assert page.evaluate("() => document.elementFromPoint(%f, document.getElementById('dock').getBoundingClientRect().top - 4).tagName" % x) == "IFRAME"
        assert fr.evaluate(TOOL) == "ellipse" and page.evaluate(FLY) is None
        # a hold and a release on the button: the list stays, to be clicked
        gesture("gmarq", (x, y), release=(x, y))
        assert page.evaluate(FLY) == ["marquee", "ellipse*", "lasso", "wand"]
        page.mouse.click(*mid(page, ".ifly button[data-t=marquee]")); page.wait_for_timeout(150)
        assert fr.evaluate(TOOL) == "marquee" and page.evaluate(FLY) is None
        page.evaluate("() => { Element.prototype.setPointerCapture = Element.prototype.__spc; }")
        assert not errors, errors
        browser.close()


def test_studio_wears_its_colour(hy):
    """The owner (2026-10-09, arrows on a blue «Anti-alias» box, the blue Image segment of the dock's switch and a white Save): «вот здесь
    цвета неверные, вроде же бы в цвет режима должно быть?». Inside Image Studio a checked box, the chosen segment of the switch and the
    primary Save wear the Studio's purple (--frame); back on the board the Board segment is the selection's blue again. Chromium, dark."""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    probe = "(v) => { const p = document.createElement('i'); p.style.color = v; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; }"
    with sync_playwright() as p:
        browser, page, fr, errors = open_studio(p, port)
        # the board's blue is its dark --sel: while the studio is open the root's --sel is the purple (hyimg ui/modes.js, data-studio)
        purple, blue = page.evaluate(probe, "var(--frame)"), page.evaluate(probe, "#3b82f6")
        assert purple != blue and fr.evaluate(probe, "var(--frame)") == purple, (purple, blue)
        # the switch's chosen segment: Image Studio's purple
        seg = "() => { const b = document.querySelector('#dock #modes > button[aria-pressed=true]'); return [b.dataset.mode, getComputedStyle(b).color]; }"
        page.wait_for_timeout(300)
        assert page.evaluate(seg) == ["image", purple], page.evaluate(seg)
        # the options strip's checked box (the lasso's Anti-alias), on and off
        page.keyboard.press("KeyL"); page.wait_for_timeout(300)
        box = "() => { const c = [...document.querySelectorAll('#obar .ck')].pop(); return c ? [c.classList.contains('on'), getComputedStyle(c.querySelector('i')).backgroundColor] : null; }"
        if not fr.evaluate(box)[0]: fr.evaluate("() => [...document.querySelectorAll('#obar .ck')].pop().click()"); page.wait_for_timeout(250)
        assert fr.evaluate(box) == [True, purple], fr.evaluate(box)
        # Save: filled with the purple, its words readable on it
        save = fr.evaluate("() => { const s = getComputedStyle(document.querySelector('#topr [data-a=save]')); return [s.backgroundColor, s.color]; }")
        assert save == [purple, "rgb(255, 255, 255)"], save
        # back on the board: Board chosen, in the selection's blue
        page.keyboard.press("Escape"); closed(page); page.wait_for_timeout(400)   # the segment's colour eases over .2 s
        assert page.evaluate(seg) == ["board", blue], page.evaluate(seg)
        assert not errors, errors
        browser.close()
