"""A click on an annotation's pin in Image Studio puts the cursor in the reply at once, as on the board (owner 2026-10-10, round 18
question 20, r18-small.html, version A: «Да, все окей, давай так»). The thread is the board's (Hyimg ui/comments.js hyComments.open, one
rule for the board and every Studio): after the click the letters typed are the reply, the Studio's keys stay quiet (B would take the
brush). The same for the count on a layer's row. Chromium, dark, the mouse.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_pin_reply.py
"""
from test_imgframe import REPO, hy  # noqa: F401  (hy is the fixture)
from test_studio_annotations import LAYER, doc_point
from test_studio_dock import open_studio

FOCUS = "() => !!(document.activeElement && document.activeElement.matches('#cmthread.open textarea'))"


def test_a_click_on_a_pin_in_image_studio_puts_the_cursor_in_the_reply(hy):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_studio(p, port)
        bid = fr.evaluate(LAYER, "b")
        fr.evaluate("() => __ed.fitView()"); fr.wait_for_timeout(500)
        page.evaluate("() => document.querySelector('.ifed iframe').contentWindow.focus()"); fr.wait_for_timeout(100)
        page.keyboard.press("c"); fr.wait_for_function("() => __ed.S.tool === 'comment'")
        x, y = doc_point(page, fr, 850, 200)
        page.mouse.click(x, y); page.wait_for_selector("#cmthread.open textarea", timeout=5000)
        page.keyboard.type("Brighter here"); page.keyboard.press("Enter")
        page.wait_for_function("() => { const t = document.querySelector('#cmthread.open'); return t && t.dataset.c !== 'draft'; }", timeout=5000)
        tid = page.evaluate("() => document.querySelector('#cmthread').dataset.c")
        page.keyboard.press("Escape"); page.wait_for_function("() => !document.querySelector('#cmthread.open')")
        page.evaluate("() => document.querySelector('.ifed iframe').contentWindow.focus()")
        page.keyboard.press("Escape"); fr.wait_for_function("() => __ed.S.tool === 'select'")   # the tool before it
        fr.wait_for_function(f"() => document.querySelector('.hy-spins .hy-spin[data-c=\"{tid}\"]')", timeout=5000)

        # the pin on the picture: a click, the reply has the cursor, B goes into it and not to the brush
        fr.locator(f'.hy-spins .hy-spin[data-c="{tid}"]').click()
        page.wait_for_selector(f'#cmthread.open[data-c="{tid}"] textarea')
        page.wait_for_function(FOCUS, timeout=3000)
        page.keyboard.type("be bold")
        assert page.evaluate("() => document.querySelector('#cmthread textarea').value") == "be bold"
        assert fr.evaluate("() => __ed.S.tool") == "select"
        page.keyboard.press("Escape"); page.wait_for_function("() => !document.querySelector('#cmthread.open')")

        # the count on the layer's row: the same
        fr.locator(f".lr[data-id='{bid}'] [data-ann-n]").click()
        page.wait_for_selector(f'#cmthread.open[data-c="{tid}"] textarea')
        page.wait_for_function(FOCUS, timeout=3000)
        page.keyboard.type("!")
        assert page.evaluate("() => document.querySelector('#cmthread textarea').value") == "be bold!"
        assert fr.evaluate("() => __ed.S.tool") == "select"
        assert not errors, errors
        browser.close()
