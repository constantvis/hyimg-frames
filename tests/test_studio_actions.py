"""Image Studio's Cancel and Save top right through Hyimg's one element for a Studio's session actions (ui/hy/actions.js; owner 2026-10-09:
«кнопки Done у нас всегда стандартизированы справа вверху ... Их тоже нужно систематизировать, чтобы они везде были идентичны»), the same
as in 3D Studio and Dev Studio: Cancel, then Save in the studio's purple with white words and a check, on the top row's line and height,
at its gutter (no round buttons in a Studio, the gear neither); the tooltips the page's own (data-tip, the key in data-key); neither in the board's dock. The HTML
frame's live view has Reload, Open in browser and Done there too, not in its dock. Chromium, dark."""
from test_imgframe import closed, hy  # noqa: F401  (hy is the fixture)
from test_studio_dock import open_studio

BOX = "(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.height)]; }"
PROBE = "(v) => { const p = document.createElement('i'); p.style.color = v; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; }"


def test_image_studio_actions_top_right(hy):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_studio(p, port)
        fr.wait_for_function("() => customElements.get('hy-studio-actions') && document.querySelectorAll('#topr > hy-button').length === 2")
        assert fr.evaluate("() => [document.getElementById('topr').localName, ...[...document.querySelectorAll('#topr > *')].map(b => b.dataset.a)]") == \
            ["hy-studio-actions", "cancel", "save"]
        # neither in the board's dock
        assert page.evaluate("() => document.querySelectorAll('#dock [data-a=save], #dock [data-a=cancel]').length") == 0
        # the row's line and height, at the row's gutter: in a Studio the round buttons are away, Image Studio's gear and the board's
        # (owner 2026-10-09 on round 14's 3D Studio: «В режиме студии мы вот эти все элементы убираем»)
        acts, width = fr.evaluate(BOX, "#topr"), fr.evaluate("() => innerWidth")
        assert acts[1] == 12 and acts[3] == 38 and acts[2] == width - 12, (acts, width)
        assert fr.evaluate("() => !document.getElementById('bset').getClientRects().length")
        assert page.evaluate("() => ['#bntf', '#bkeys', '#bhist', '#bset'].every(q => !document.querySelector(q).getClientRects().length)")
        # Save: the purple, white words, a check, its key in the page's tooltip and on its key cap; Cancel on the row's glass
        purple = fr.evaluate(PROBE, "var(--frame)")
        save = fr.evaluate("() => { const b = document.querySelector('#topr [data-a=save]'), c = getComputedStyle(b); "
                           "return [b.getAttribute('variant'), c.backgroundColor, c.color, !!b.querySelector('svg'), b.dataset.key, b.querySelector('kbd').textContent, !!b.title]; }")
        assert save == ["accent", purple, "rgb(255, 255, 255)", True, "⌘↵", "⌘↵", False], save   # one spelling of the cap (P4 S-60)
        cancel = fr.evaluate("() => { const b = document.querySelector('#topr [data-a=cancel]'); return [getComputedStyle(b).backgroundColor, b.dataset.tip, b.dataset.key]; }")
        assert cancel[0] != purple and cancel[1] and not cancel[2], cancel   # Esc keeps the work, it is not Cancel's key (owner decision 2026-10-10, S-27)
        # Cancel from the top leaves the studio (nothing changed: no question)
        fr.click("#topr [data-a=cancel]"); closed(page)
        assert not errors, errors
        browser.close()


def test_html_frame_live_view_actions_top_right(hy):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    (lib / "html/demo").mkdir(parents=True, exist_ok=True)
    (lib / "html/demo/index.html").write_text("<!doctype html><html><body><h1>Hi</h1></body></html>")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900}, color_scheme="dark")
        errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{port}/canvas.html")
        page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
        page.evaluate("() => { const b = snap(); board.items.h1 = { type: 'htmlframe', src: 'html/demo/index.html', vw: 1440, x: 0, y: 1400, w: 720, h: 450 }; commit(b); }")
        page.wait_for_selector(".plg[data-id=h1]"); page.dblclick(".plg[data-id=h1]"); page.wait_for_selector(".hfbar")
        assert page.evaluate("() => [...document.querySelectorAll('hy-studio-actions > *')].map(b => b.dataset.a)") == ["reload", "open", "done"]
        assert page.evaluate("() => document.querySelectorAll('.hfbar [data-a]').length") == 0
        acts, bell = page.evaluate(BOX, "hy-studio-actions"), page.evaluate(BOX, "#bntf")
        assert acts[1] == 12 and acts[2] == bell[0] - 8, (acts, bell)
        # a press on the actions does not end the live page (a press elsewhere does); Done does
        page.click("hy-studio-actions [data-a=reload]"); page.wait_for_timeout(200)
        assert page.locator(".plg[data-id=h1] iframe.hfl").count() == 1
        page.click("hy-studio-actions [data-a=done]")
        page.wait_for_function("() => !document.querySelector('.plg[data-id=h1] iframe') && !document.querySelector('hy-studio-actions')", timeout=5000)
        assert not errors, errors
        browser.close()
