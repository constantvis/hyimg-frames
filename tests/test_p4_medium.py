"""Image Studio's medium and low findings of the П4 logic audit (2026-10-10, hyimg docs/process.md §5) and the owner's decisions of that
day, each as the person meets it. Chromium, the dark theme, a temporary library; each fails on the code before:

- S-53 a picture opened in the studio is called by its file, not «Frame 1»
- S-49 undone back to how it was opened, Cancel closes without a question
- S-48 renaming the frame is a step: ⌘Z gives the old name back
- S-51 ⌘Z brings back the layer that was chosen when the step was made
- S-38 ↑ ↑ ↑ in a number field: one step
- S-54 ⇧M is the next tool of M from any tool (the dock's «Ellipse · ⇧M»)
- S-34 a key typed while the focus is on the board's page around the studio (its zoom) is the studio's
- S-55 the generative prompt: Esc keeps the words, the typing is a step (the frame is unsaved), the prompt is in the saved frame
- S-52 one Save, one note
- round 17, version 2 (owner 2026-10-10): the Annotations tab beside Properties, Adjustments and History: its list is the frame's threads by
  layer, a click on one picks its layer, the field writes on the picked layer with the composer's keys (⇧↵ a new line, Esc keeps)

  HYIMG_REPO=<Hyimg checkout> nice -n 10 python3 -m pytest tests/test_p4_medium.py
"""
import json, time, urllib.request

from playwright.sync_api import sync_playwright

from test_imgframe import hy, editor, closed  # noqa: F401  (hy is the fixture)
from test_p4_logic import open_board, open_frame, focus

HOOK = "() => { window.__T = []; const o = window.hyToast; window.hyToast = (t, k, x) => { window.__T.push(String(t)); return o && o(t, k, x); }; }"


def steps(fr): return fr.evaluate("() => __ed.S.undo.length")


def test_names_steps_and_keys(hy):
    port, lib, state = hy
    with sync_playwright() as p:
        br, page, errors = open_board(p, port)
        # S-53: the picture by its file
        page.evaluate("fit()"); page.wait_for_timeout(400); page.dblclick(".it[data-id=a1]"); fr = editor(page); fr.wait_for_timeout(900)
        assert fr.evaluate("() => document.getElementById('cFrameName').textContent") == "a.png"
        # S-49: a change undone: Cancel asks nothing and closes
        focus(page, fr); fr.evaluate("() => hyEdK.edit('Opacity Change', () => { __ed.root.find(n => n.type === 'pixel').opacity = 40; })")
        focus(page, fr); page.keyboard.press("Meta+z"); fr.wait_for_timeout(200)
        fr.click("#topr [data-a=cancel]"); fr.wait_for_timeout(400)
        assert not fr.evaluate("() => !!document.getElementById('hyConfirm')"), "undone to the opening, Cancel still asked"
        closed(page)
        # a frame of two pictures for the rest
        fid, fr = open_frame(page); focus(page, fr)
        # S-48: the frame's name is a step
        page.dblclick("#cIfr"); page.wait_for_selector("#cIfr input"); page.keyboard.press("Meta+a"); page.keyboard.type("Poster"); page.keyboard.press("Enter")   # the board's crumb
        fr.wait_for_timeout(200); assert fr.evaluate("() => document.getElementById('cFrameName').textContent") == "Poster"
        focus(page, fr); page.keyboard.press("Meta+z"); fr.wait_for_timeout(300)
        assert fr.evaluate("() => document.getElementById('cFrameName').textContent") != "Poster", "⌘Z did not take the rename back"
        # S-51: the chosen layer comes back with ⌘Z
        a, b = fr.evaluate("() => __ed.root.filter(n => n.type === 'pixel').map(n => n.id)")[:2]
        fr.evaluate(f"() => {{ __ed.S.ids = ['{a}']; __ed.refresh(); hyEdK.edit('Opacity Change', () => {{ __ed.byId('{a}').opacity = 50; }}); __ed.S.ids = ['{b}']; __ed.refresh(); }}")
        focus(page, fr); page.keyboard.press("Meta+z"); fr.wait_for_timeout(300)
        assert fr.evaluate("() => __ed.S.ids") == [a]
        # S-38: ↑ ↑ ↑ in a number field, one step
        fr.evaluate("() => __ed.showPanel('props')"); fr.wait_for_timeout(300)
        n0 = steps(fr); fr.locator("#pbody input[inputmode=decimal]").first.focus()
        for _ in range(3): page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter"); fr.wait_for_timeout(300)
        assert steps(fr) == n0 + 1, (n0, steps(fr))
        # S-54: ⇧M from the lasso is the ellipse
        focus(page, fr); page.keyboard.press("l"); page.keyboard.press("Shift+m"); fr.wait_for_timeout(100)
        assert fr.evaluate("() => __ed.S.tool") == "ellipse"
        # S-34: the focus on the board's zoom (its page), B is the studio's brush
        page.click("#ifZoom"); page.evaluate("() => document.querySelector('#ifZoom').focus()"); page.keyboard.press("b"); fr.wait_for_timeout(150)
        assert fr.evaluate("() => __ed.S.tool") == "brush", "a key on the board's page did nothing"
        assert not errors, errors
        br.close()


def test_prompt_save_note_and_the_annotations_tab(hy):
    port, lib, state = hy
    with sync_playwright() as p:
        br, page, errors = open_board(p, port)
        fid, fr = open_frame(page); focus(page, fr)
        # S-55: a generative layer's prompt
        lid = fr.evaluate("() => { hyEdK.newLayer(); const n = hyEdK.one(); n.gen = { prompt: '', vars: [null, null, null], pick: 0, status: 'done' };"   # a painted layer
                          " __ed.S.ids = [n.id]; __ed.refresh(); __ed.showPanel('gen'); return n.id; }")
        fr.wait_for_selector("#pgen .gta"); n0 = steps(fr)
        fr.click("#pgen .gta"); page.keyboard.type("a red door"); page.keyboard.press("Escape"); fr.wait_for_timeout(300)
        assert fr.evaluate("() => document.querySelector('#pgen .gta').value") == "a red door", "Esc threw the prompt away"
        assert fr.evaluate("() => document.activeElement !== document.querySelector('#pgen .gta')"), "Esc kept the focus in the prompt"
        assert steps(fr) == n0 + 1, "typing the prompt is a step: the frame is unsaved"
        # S-52: Save, one note
        page.evaluate(HOOK); focus(page, fr); page.keyboard.press("Meta+Enter"); closed(page); page.wait_for_timeout(800)
        notes = [t for t in page.evaluate("() => window.__T") if "×" in t or "px" in t]
        assert len(notes) == 1, notes
        doc = page.evaluate(f"() => board.items['{fid}'].doc")
        frame = json.loads((lib / doc).read_text())
        assert any(l.get("prompt") == "a red door" for l in frame["layers"]), "the prompt is not in the saved frame"
        # the Annotations tab: in the upper block, the threads by layer, a click picks the layer, the field's keys
        page.wait_for_timeout(600); page.dblclick(f".plg[data-id='{fid}']"); fr = editor(page); fr.wait_for_timeout(900)
        assert fr.locator("#g1 .tabs .tab[data-t=ann]").count() == 1, "no Annotations tab beside Properties"
        a, b = fr.evaluate("() => __ed.root.filter(n => n.type === 'pixel').map(n => n.id)")[:2]
        fr.evaluate(f"() => {{ __ed.S.ids = ['{a}']; __ed.refresh(); }}"); fr.click("#g1 .tabs .tab[data-t=ann]"); fr.wait_for_selector("#pann .hy-annlist textarea:not([disabled])", timeout=5000)
        f = fr.locator("#pann .hy-annlist textarea"); f.click(); page.keyboard.type("Too dark"); page.keyboard.press("Shift+Enter"); page.keyboard.type("here")
        assert f.input_value() == "Too dark\nhere"
        page.keyboard.press("Escape"); fr.wait_for_timeout(200); assert f.input_value() == "Too dark\nhere", "Esc keeps the words"
        f.click(); page.keyboard.press("Enter")
        for _ in range(50):
            th = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/comments?name=main"))["items"]
            if th: break
            time.sleep(0.1)
        assert len(th) == 1 and th[0]["anchor"]["part"]["id"] == a and th[0]["messages"][0]["text"] == "Too dark\nhere", th
        fr.wait_for_function("() => document.querySelectorAll('#pann .hy-annlist .an').length === 1", timeout=8000)
        assert fr.evaluate("() => document.getElementById('acount').textContent") == "1"
        fr.evaluate(f"() => {{ __ed.S.ids = ['{b}']; __ed.refresh(); }}"); fr.wait_for_timeout(200)
        fr.click("#pann .hy-annlist .an"); fr.wait_for_timeout(500)
        assert fr.evaluate("() => __ed.S.ids") == [a], "a click on a thread picks its layer"
        assert page.evaluate("() => hyComments.state.open") == th[0]["id"]
        assert not errors, errors
        br.close()
