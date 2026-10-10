"""Leaving Image Studio keeps the work without waiting for it, and a picture's frame keeps the picture's name (owner decisions 2026-10-10,
«а ты как лучше думаешь»). Chromium, the dark theme, a temporary library; each fails on the code before:

- a picture opened in the studio and saved stays called by its file, by Save and by Esc, and opens again under that name
- the last Esc closes the studio at once (under 150 ms): the card keeps its last still with a busy LED, the frame is written after it
  and the card shows the new version
- opening the card again while its work is written waits for it and opens the new version, never the older file
- a refused write: the card's LED turns red, the note offers «Open again», which brings the studio back with the work as it was left;
  a page switch waits for a write and stays while one was refused

  HYIMG_REPO=<Hyimg checkout> nice -n 10 python3 -m pytest tests/test_leave_writes_after.py
"""
import json

from playwright.sync_api import sync_playwright

from test_imgframe import hy, closed  # noqa: F401  (hy is the fixture)
from test_p4_logic import open_board, open_frame, focus

LEFT = """() => new Promise(ok => { const t0 = performance.now(); const tick = () => {
  if (!__frames.ED && MODES.open === 'board' && !document.querySelector('.ifed.on:not(.away)')) return ok(performance.now() - t0);
  if (performance.now() - t0 > 5000) return ok(-1); requestAnimationFrame(tick); }; tick(); })"""
LED = "(id) => { const l = document.querySelector(`#items > [data-id='${id}'] > hy-led.ifled`); return l ? l.getAttribute('state') : ''; }"


def studio(page):
    """the open studio's page (a page that left and still writes is not it)"""
    page.wait_for_selector(".ifed.on:not(.away) iframe", state="attached", timeout=20000)
    fr = page.query_selector(".ifed.on:not(.away) iframe").content_frame()
    fr.wait_for_function("() => window.__ed && __ed.ready && __ed.BM", timeout=30000); fr.wait_for_timeout(600)
    return fr


def esc_left(page, fr):
    """the last Esc in the studio; how long until the board is back, in ms"""
    focus(page, fr); page.keyboard.press("Escape")
    return page.evaluate(LEFT)


def test_a_picture_keeps_its_name(hy):
    port, lib, state = hy
    with sync_playwright() as p:
        br, page, errors = open_board(p, port)
        page.evaluate("fit()"); page.wait_for_timeout(400)
        # Save (⌘↵): the frame of a.png is «a.png», not «Frame 1»
        page.dblclick(".it[data-id=a1]"); fr = studio(page)
        fr.evaluate("() => hyEdK.edit('Opacity Change', () => { __ed.root.find(n => n.type === 'pixel').opacity = 60; })")
        focus(page, fr); page.keyboard.press("Meta+Enter"); closed(page)
        page.wait_for_function("() => board.items.a1.type === 'imgframe' && board.items.a1.v >= 1", timeout=30000)
        assert page.evaluate("() => board.items.a1.name") == "a.png"
        assert json.loads((lib / page.evaluate("() => board.items.a1.doc")).read_text())["name"] == "a.png"
        page.wait_for_timeout(600); page.dblclick(".plg[data-id=a1]"); fr = studio(page)
        assert fr.evaluate("() => document.getElementById('cFrameName').textContent") == "a.png"
        assert "a.png" in page.locator("#cIfr").inner_text()
        assert esc_left(page, fr) >= 0; closed(page)
        # Esc on a picture: written after the studio left, the frame called by the file too
        page.dblclick(".it[data-id=b1]"); fr = studio(page)
        fr.evaluate("() => hyEdK.edit('Opacity Change', () => { __ed.root.find(n => n.type === 'pixel').opacity = 60; })")
        assert esc_left(page, fr) >= 0
        page.wait_for_function("() => board.items.b1.type === 'imgframe' && board.items.b1.v >= 1 && !__frames.SAVING.size", timeout=30000)
        assert page.evaluate("() => board.items.b1.name") == "b.jpg"
        assert not errors, errors
        br.close()


def test_esc_leaves_at_once_and_writes_after(hy):
    port, lib, state = hy
    with sync_playwright() as p:
        br, page, errors = open_board(p, port)
        fid, fr = open_frame(page)
        v0 = page.evaluate(f"() => board.items['{fid}'].v")
        fr.evaluate("() => hyEdK.edit('Opacity Change', () => { __ed.root.find(n => n.type === 'pixel').opacity = 41; })")
        ms = esc_left(page, fr)
        assert 0 <= ms < 150, f"the studio took {ms:.0f} ms to go"
        assert page.evaluate(f"() => board.items['{fid}'].v") == v0, "the board waited for the write"
        assert page.evaluate(LED, fid) == "busy"
        page.wait_for_function(f"() => board.items['{fid}'].v > {v0} && !__frames.SAVING.size", timeout=30000)
        assert page.evaluate(LED, fid) == ""
        doc = json.loads((lib / page.evaluate(f"() => board.items['{fid}'].doc")).read_text())
        assert any(l.get("opacity") == 41 for l in doc["layers"]), "the work is not in the written frame"
        assert (lib / page.evaluate(f"() => board.items['{fid}'].render")).is_file()
        page.wait_for_function("() => document.querySelectorAll('.ifed').length <= 1", timeout=5000)   # the page that wrote it went
        # opened again while its work is on its way: the new version, never the older file
        v1 = page.evaluate(f"() => board.items['{fid}'].v"); page.wait_for_timeout(600)
        page.dblclick(f".plg[data-id='{fid}']"); fr = studio(page)
        fr.evaluate("() => hyEdK.edit('Opacity Change', () => { __ed.root.find(n => n.type === 'pixel').opacity = 52; })")
        assert esc_left(page, fr) >= 0
        page.dblclick(f".plg[data-id='{fid}']"); fr = studio(page)
        assert page.evaluate(f"() => board.items['{fid}'].v") > v1, "it opened before the write"
        assert fr.evaluate("() => __ed.VERSION") == page.evaluate(f"() => board.items['{fid}'].v")
        assert fr.evaluate("() => __ed.root.find(n => n.type === 'pixel').opacity") == 52
        assert not errors, errors
        br.close()


def test_a_refused_write_keeps_the_work(hy):
    port, lib, state = hy
    with sync_playwright() as p:
        br, page, errors = open_board(p, port)
        fid, fr = open_frame(page)
        v0 = page.evaluate(f"() => board.items['{fid}'].v")
        refuse = lambda route: route.fulfill(status=500, body="disk full") if route.request.method == "POST" and "render." in route.request.url else route.continue_()
        page.context.route("**/api/file?*", refuse)
        fr.evaluate("() => hyEdK.edit('Opacity Change', () => { __ed.root.find(n => n.type === 'pixel').opacity = 33; })")
        assert 0 <= esc_left(page, fr) < 150
        page.wait_for_function(f"() => ({LED})('{fid}') === 'err'", timeout=30000)
        assert page.evaluate(f"() => board.items['{fid}'].v") == v0
        assert page.locator(".ht.error .ab").count() == 1, "no «Open again» on the note"
        assert page.evaluate("() => MODES.leaveFirst()") is False, "a page switch would leave the refused work behind"
        page.context.unroute("**/api/file?*", refuse)
        page.click(".ht.error .ab"); fr = studio(page)
        assert fr.evaluate("() => __ed.root.find(n => n.type === 'pixel').opacity") == 33, "the work is lost"
        assert fr.evaluate("() => hyEdK.isDirty()")
        assert page.evaluate(LED, fid) == ""
        focus(page, fr); page.keyboard.press("Meta+Enter"); closed(page)
        page.wait_for_function(f"() => board.items['{fid}'].v > {v0}", timeout=30000)
        doc = json.loads((lib / page.evaluate(f"() => board.items['{fid}'].doc")).read_text())
        assert any(l.get("opacity") == 33 for l in doc["layers"])
        # a page switch waits for a write still running and goes on once it is done
        page.wait_for_timeout(600); page.dblclick(f".plg[data-id='{fid}']"); fr = studio(page)
        fr.evaluate("() => hyEdK.edit('Opacity Change', () => { __ed.root.find(n => n.type === 'pixel').opacity = 70; })")
        assert esc_left(page, fr) >= 0
        assert page.evaluate("() => MODES.leaveFirst().then(ok => [ok, __frames.SAVING.size])") == [True, 0]
        assert not [e for e in errors if "disk full" not in e], errors
        br.close()
