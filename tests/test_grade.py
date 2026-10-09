"""The colour grade of any picture on the board and the image studio's main grade (owner 2026-10-06), on a real canvas with a disposable
library (Chromium and WebKit): a selected frame card has the pictures' opacity on its bar; the colour grade icon on the bar of a picture opens
the grading where the card's info stands, a change grades the card at once (a canvas over its picture) and is one step to undo; a graded
card wears its mark top right after the ♥ (owner 2026-10-06: «top right after the heart: colour grading and trim/crop»), a click on it opens the grading; the right click copies a grade and pastes it onto every selected picture;
the grade is on the board item and survives a reload; the files never change. In the image studio the frame's grade is the main Color
Grading layer: on top of all layers, its row pinned at the top of the list, not dragged or deleted, a new grade layer goes under it, Save
gives its grade to the card and keeps it out of the frame's document and render.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_grade.py
  FRAMES_SHOTS=<folder> also saves screenshots of the steps there
"""
import json, time
from pathlib import Path

import pytest
from PIL import Image, ImageChops

from test_imgframe import WEBKIT, board, closed, editor, hy, open_board, sha, shot   # noqa: F401 (hy is the fixture)

ENGINES = ["chromium", "webkit"]
GRADED = "() => window.__gradeQ && __gradeQ() === 0"


def graded_card(page, id):
    """the card's graded canvas differs from its picture, and covers the card"""
    return page.evaluate("""id => { const el = document.querySelector(`#items [data-id="${id}"]`), cv = el && el.querySelector(':scope > canvas.grd');
      if (!cv || !cv.width) return null; const img = el.querySelector(el.classList.contains('plg') ? 'img.ifr' : 'img');
      const a = document.createElement('canvas'); a.width = 16; a.height = 16; const x = a.getContext('2d'); x.drawImage(img, 0, 0, 16, 16); const p = x.getImageData(0, 0, 16, 16).data;
      x.clearRect(0, 0, 16, 16); x.drawImage(cv, 0, 0, 16, 16); const q = x.getImageData(0, 0, 16, 16).data; let d = 0; for (let i = 0; i < p.length; i += 4) d += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
      const r = el.getBoundingClientRect(), c = cv.getBoundingClientRect(); return { diff: d / 256, cover: c.left <= r.left + 1 && c.right >= r.right - 1 && c.top <= r.top + 1 && c.bottom >= r.bottom - 1 }; }""", id)


def mark_shown(page, id, t=5000):
    """the mark is in the card, grown in (its way in takes .32 s)"""
    page.wait_for_function("""id => { const m = document.querySelector(`#items [data-id="${id}"] > .mk-grade`); if (!m) return false; const s = getComputedStyle(m);
      return s.display !== 'none' && +s.opacity > .9 && m.getBoundingClientRect().width > 8; }""", arg=id, timeout=t)
    return True


def preset(scope, name):
    """the grading panel's Presets menu: the way a person picks a look in one click"""
    # clicked in the page (a pointer click inside the editor's frame made Playwright scroll the board's overflow-hidden stage to reach it)
    scope.locator(".hcg-pbtn").first.evaluate("b => b.click()")
    scope.locator(f".hcg-menu.open button[data-k='{name}']").first.evaluate("b => b.click()")   # by its English name, in either language


@pytest.mark.parametrize("engine", ENGINES)
def test_frame_card_has_the_pictures_opacity(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate("sel = new Set(['a1']); render(); fit()"); time.sleep(0.4)
        page.keyboard.press("Alt+Meta+KeyG")
        page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        page.evaluate(f"sel = new Set(['{fid}']); render()"); time.sleep(0.4)
        bar = page.locator(".tidy")
        # the bar's opacity is the app's standard slider, its word and number inside, since hyimg 09c544f (owner 2026-10-07), not the compact one
        assert "Открыть" in bar.inner_text() and bar.locator(".op .hy-slider:not(.sm) input[data-op]").count() == 1, bar.inner_html()
        assert bar.locator(".op .hy-slider-l").inner_text() == "Прозрачность" and bar.locator(".op .hy-slider-v").inner_text() == "100%"
        shot(page, f"grade-1-{engine}-frame-bar-opacity.png")
        # the slider: live on the card, one step to undo when let go
        page.evaluate("() => { const i = document.querySelector('.tidy [data-op]'); i.value = 40; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }")
        assert page.evaluate(f"() => board.items['{fid}'].opacity") == 0.4
        assert page.evaluate(f"() => getComputedStyle(document.querySelector(\".plg[data-id='{fid}']\")).opacity") == "0.4"
        page.keyboard.press("Digit7")   # the keys 1…9 and 0, as on a picture
        assert page.evaluate(f"() => board.items['{fid}'].opacity") == 0.7
        page.keyboard.press("Meta+z")
        page.wait_for_function(f"() => board.items['{fid}'].opacity === 0.4")
        page.keyboard.press("Digit0")
        page.wait_for_function(f"() => board.items['{fid}'].opacity === undefined && getComputedStyle(document.querySelector(\".plg[data-id='{fid}']\")).opacity === '1'")
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ENGINES)
def test_grade_any_picture_mark_copy_paste_reload(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    before = {q: sha(lib / q) for q in ("pics/a.png", "pics/b.jpg", "pics/big.jpg")}
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate("sel = new Set(['a1']); render(); fit()"); time.sleep(0.5)
        # the button on the bar of any picture, in the bar's look (icon and word)
        btn = page.locator('.tidy button.ic[aria-label="Raw Editor"]')   # an icon button, its words in the tooltip
        assert btn.count() == 1 and btn.locator("svg").count() == 1 and btn.inner_text().strip() == "" and "файл картинки не меняется" in btn.get_attribute("title")
        assert not page.evaluate("() => !!document.querySelector('#items [data-id=a1] > .mk-grade')")   # no grade, no mark
        btn.click()
        page.wait_for_selector("#hcgp.in .hcg", timeout=10000)
        assert page.evaluate("() => getComputedStyle(document.querySelector('#info')).display") == "none"   # the panel stands where the info was
        preset(page.locator("#hcgp"), "Punchy")
        page.wait_for_function("() => board.items.a1.grade && board.items.a1.grade.contrast === 26", timeout=5000)
        page.wait_for_function("() => past.length && !dirty", timeout=10000)   # one step, saved
        g = graded_card(page, "a1")
        assert g and g["diff"] > 4 and g["cover"], g
        shot(page, f"grade-2-{engine}-panel-and-graded-card.png")
        # the card's marks step out while the grading is open (owner 2026-10-06), the grade's mark shows once it closes
        page.keyboard.press("Escape"); page.wait_for_function("() => !document.querySelector('#hcgp')", timeout=5000)
        assert mark_shown(page, "a1")
        # a change of the grade is one step to undo, redo brings it back
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => !board.items.a1.grade && !document.querySelector('#items [data-id=a1] > canvas.grd')")
        assert not page.evaluate("() => document.querySelector('#items [data-id=a1]').classList.contains('graded')")
        page.keyboard.press("Meta+Shift+z")
        page.wait_for_function("() => board.items.a1.grade && board.items.a1.grade.contrast === 26")
        page.wait_for_function(GRADED)
        # the mark: a click opens the grading of that card, it does not drag or start a marquee
        page.evaluate("sel = new Set(); render()"); time.sleep(0.3)
        x0 = page.evaluate("() => board.items.a1.x")
        page.locator("#items [data-id=a1] > .mk-grade").click()
        page.wait_for_selector("#hcgp.in", timeout=5000)
        assert page.evaluate("() => [...sel].join()") == "a1" and page.evaluate("() => board.items.a1.x") == x0
        assert page.evaluate("() => __grade.P.inst.get().contrast") == 26   # the panel shows the card's grade
        page.keyboard.press("Escape")
        page.evaluate("sel = new Set(); render()"); time.sleep(0.6)
        # its place: the top right row, after the ♥'s slot (kept while the ♥ waits for the pointer), 8.5 px × k in, 3.5 px from the ♥
        at = page.evaluate("""() => { const el = document.querySelector('#items [data-id=a1]'), c = el.getBoundingClientRect(), r = el.querySelector(':scope > .mk-grade').getBoundingClientRect();
          return { k: +getComputedStyle(el).getPropertyValue('--vbs'), r: c.right - r.right, t: r.top - c.top, w: r.width }; }""")
        k = at["k"]
        assert abs(at["t"] - 8.5 * k) < 0.6 and abs(at["r"] - (8.5 * k + 26 * k + 3.5)) < 0.6 and abs(at["w"] - 26 * k) < 0.6, at
        shot(page, f"grade-3-{engine}-graded-card-mark.png")
        # right click: copy from a1, paste onto b1 and g1 together (one step); the grade is a kind of the board's «Копировать свойства ›» and
        # «Вставить свойства ›» (Hyimg's HY.props, owner 2026-10-06), its own two items are gone
        page.click("#items [data-id=a1]", button="right")
        menu = page.locator("#ctx")
        assert "Скопировать Raw Editor" not in menu.inner_text()   # only in «Копировать свойства ›»
        menu.locator("[data-sub=props-copy]").hover()
        sub = page.locator("#ctx .hy-sub")
        sub.locator("[role=menuitem]", has_text="Raw Editor").wait_for()
        shot(page, f"grade-4-{engine}-context-menu-copy.png")
        sub.locator("[role=menuitem]", has_text="Raw Editor").click()
        page.evaluate("sel = new Set(['b1', 'g1']); render()"); time.sleep(0.3)
        page.click("#items [data-id=b1]", button="right")
        menu.locator("[data-sub=props-paste]").hover()
        sub.locator("[role=menuitem]", has_text="Raw Editor").wait_for()
        shot(page, f"grade-5-{engine}-context-menu-paste.png")
        sub.locator("[role=menuitem]", has_text="Raw Editor").click()
        page.wait_for_function("() => ['b1', 'g1'].every(i => board.items[i].grade && board.items[i].grade.contrast === 26)")
        page.wait_for_function(GRADED)
        assert graded_card(page, "b1")["diff"] > 4 and graded_card(page, "g1")["diff"] > 4
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => !board.items.b1.grade && !board.items.g1.grade && board.items.a1.grade")
        page.keyboard.press("Meta+Shift+z")
        page.wait_for_function("() => board.items.b1.grade && board.items.g1.grade")
        page.wait_for_function("() => !dirty", timeout=10000)
        # on the board item, in the board file, after a reload too: only what differs from the defaults
        saved = board(state)["items"]
        assert saved["a1"]["grade"]["contrast"] == 26 and "version" not in saved["a1"]["grade"] and saved["b1"]["grade"] == saved["a1"]["grade"]
        page.reload()
        page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
        page.wait_for_function("() => document.querySelector('#items [data-id=a1] > canvas.grd') && __gradeQ() === 0", timeout=20000)
        assert graded_card(page, "a1")["diff"] > 4 and mark_shown(page, "a1")
        assert {q: sha(lib / q) for q in before} == before   # the files are byte for byte what they were
        assert not errors, errors
        browser.close()


@pytest.mark.parametrize("engine", ENGINES)
def test_main_grade_pinned_on_top(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    before = {q: sha(lib / q) for q in ("pics/a.png", "pics/b.jpg")}
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        # a graded picture goes into a frame with its grade: a Color Grading layer clipped to it
        page.evaluate("() => { const b = snap(); board.items.a1.grade = { contrast: 40, saturation: -100 }; commit(b); }")
        page.evaluate("sel = new Set(['a1']); render(); fit()"); time.sleep(0.4)
        page.keyboard.press("Alt+Meta+KeyG")
        page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
        fid, card = page.evaluate("() => Object.entries(board.items).find(([k, it]) => it.type === 'imgframe')")
        doc = json.loads((lib / card["doc"]).read_text())
        assert [(l["kind"], l["clip"]) for l in doc["layers"]] == [("pic", False), ("grade", True)] and doc["layers"][1]["params"]["saturation"] == -100
        r1 = Image.open(lib / card["render"]).convert("RGB"); px = r1.getpixel((450, 300))
        assert max(px) - min(px) < 6, px   # the first render is graded as the board showed it (black and white)
        # the frame card gets a grade of its own (a paste), shown over its render, with the mark
        page.evaluate(f"() => {{ const b = snap(); board.items['{fid}'].grade = {{ temp: 60, exposure: 0.4 }}; commit(b); }}")
        page.wait_for_function(GRADED); page.wait_for_function(f"() => !!document.querySelector(\".plg[data-id='{fid}'] > canvas.grd\")")
        assert graded_card(page, fid)["diff"] > 4 and mark_shown(page, fid)
        page.evaluate(f"sel = new Set(['{fid}']); render()"); time.sleep(0.3)
        assert page.locator('.tidy button.ic[aria-label="Raw Editor"]').count() == 1
        page.wait_for_timeout(1200)
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page)
        # always there: over all the layers, under only the master mask (the last), the card's grade, its row first in the list and pinned
        assert fr.evaluate("() => { const r = __ed.root, m = r[r.length - 2]; return m.main && r[r.length - 1].mmask && m.type === 'adjust' && m.params.temp === 60 && m.params.exposure === 0.4; }")
        assert fr.evaluate("() => { const r = document.querySelector('#rows .lr'); return r.classList.contains('main') && !!r.querySelector('.pin'); }")
        # dragged down: it stays; Delete: it stays
        row = fr.locator("#rows .lr.main"); rows = fr.locator("#rows .lr")
        b0 = row.bounding_box(); bl = rows.nth(rows.count() - 1).bounding_box()
        page.mouse.move(b0["x"] + 60, b0["y"] + b0["height"] / 2); page.mouse.down()
        for k in range(1, 9): page.mouse.move(b0["x"] + 60, b0["y"] + b0["height"] / 2 + (bl["y"] + bl["height"] - b0["y"]) * k / 8)
        page.mouse.up(); time.sleep(0.3)
        assert fr.evaluate("() => __ed.root[__ed.root.length - 2].main")
        assert fr.evaluate("() => __ed.S.ids.join()") == "main_grade"
        page.keyboard.press("Backspace"); time.sleep(0.2)
        assert fr.evaluate("() => __ed.root.some(n => n.main) && __ed.root[__ed.root.length - 2].main")
        # a layer dragged above it does not go there
        pic = rows.nth(rows.count() - 1); pb = pic.bounding_box()
        page.mouse.move(pb["x"] + 60, pb["y"] + pb["height"] / 2); page.mouse.down()
        for k in range(1, 9): page.mouse.move(pb["x"] + 60, pb["y"] + pb["height"] / 2 + (b0["y"] + 2 - pb["y"] - pb["height"] / 2) * k / 8)
        page.mouse.up(); time.sleep(0.3)
        assert fr.evaluate("() => __ed.root[__ed.root.length - 2].main")
        # a new Color Grading layer while the main one is selected goes under it
        fr.evaluate("() => { __ed.S.ids = ['main_grade']; __ed.refresh(); }")
        fr.locator(f'#lbot .ib[data-tip="{fr.evaluate("() => __ed.T.newAdjustment")}"]').click()   # the editor's words in the board's language
        fr.locator("#menu button", has_text="Raw Editor").first.evaluate("b => b.click()")   # in the page: see preset()
        time.sleep(0.3)
        kinds = fr.evaluate("() => __ed.root.map(n => n.main ? 'main' : n.mmask ? 'mask' : n.type)")
        assert kinds[-1] == "mask" and kinds[-2] == "main" and kinds.count("adjust") == 2 and kinds[-3] == "adjust", kinds
        # the main grade changed in its panel, Save: the card takes it; the document and the render stay without it
        fr.evaluate("() => { __ed.S.ids = ['main_grade']; __ed.refresh(); __ed.showPanel('adj'); }")
        time.sleep(0.3)
        shot(page, f"grade-6-{engine}-editor-layers-main.png")
        preset(fr.locator("#padj"), "Cool Studio")
        fr.wait_for_function("() => __ed.root[__ed.root.length - 2].params.temp === -14", timeout=5000)
        time.sleep(0.6)
        fr.click("#topr [data-a=save]")
        page.wait_for_function(f"() => board.items['{fid}'].v === 2", timeout=60000)
        closed(page)
        it = page.evaluate(f"() => board.items['{fid}']")
        assert it["grade"]["temp"] == -14 and it["grade"]["contrast"] == 12 and "exposure" not in it["grade"], it["grade"]
        doc2 = json.loads((lib / it["doc"]).read_text())
        assert all(not l.get("main") for l in doc2["layers"]) and len(doc2["layers"]) == 3   # pic, its grade, the new grade layer
        r2 = Image.open(lib / it["render"]).convert("RGB")
        assert ImageChops.difference(r1, r2).getbbox() is None   # the new layer is neutral, the main grade is not in the render
        page.wait_for_function(GRADED); assert graded_card(page, fid)["diff"] > 4
        # the board's undo takes the card back to its grade before the Save
        page.keyboard.press("Meta+z")
        page.wait_for_function(f"() => board.items['{fid}'].v === 1 && board.items['{fid}'].grade.temp === 60")
        # unframed, the picture keeps its own grade (the frame's goes only to pictures without one)
        page.evaluate(f"sel = new Set(['{fid}']); render()")
        page.click(f".plg[data-id='{fid}']", button="right")
        page.locator("#ctx button", has_text="Разобрать фрейм").click()
        page.wait_for_function("() => board.items.a1 && board.items.a1.grade && board.items.a1.grade.saturation === -100")
        assert {q: sha(lib / q) for q in before} == before
        assert not errors, errors
        browser.close()
