"""The master mask of a picture or a frame (owner 2026-10-06), on a real canvas with a disposable library (Chromium and WebKit).
On the board: «Mask from alpha» makes a picture's alpha its mask (a png of its own under frames/board-masks/), the card shows the picture
masked; «Copy mask» and «Paste mask» put it on pictures of other sizes (one step to undo); «Clear mask»; it is on the board item and
survives a reload. In the image studio: the pinned «Mask» row under the main grade, the last layer, clipping the whole composite; a PNG
starts with its alpha; the brush, Invert, a selection and Feather change it; it is not deleted or moved; Save gives it to the card
(versioned beside the frame's masks) while the render stays without it; the studio's copy pastes onto a board picture. The files never change.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_master_mask.py
  FRAMES_SHOTS=<folder> also saves screenshots
"""
import io, json, time

import pytest
from PIL import Image

from test_imgframe import WEBKIT, board, closed, editor, hy, open_board, sha, shot   # noqa: F401 (hy is the fixture)

ENGINES = ["chromium", "webkit"]
PICS = ("pics/a.png", "pics/b.jpg", "pics/big.jpg", "pics/t.png")


def transparent_png(lib):
    """400 × 300: the left half transparent, the right half an opaque purple"""
    im = Image.new("RGBA", (400, 300), (0, 0, 0, 0))
    for x in range(200, 400):
        for y in range(300): im.putpixel((x, y), (150, 40, 200, 255))
    im.save(lib / "pics/t.png")


def add_t1(page, x=0, y=520, w=400):
    page.evaluate(f"() => {{ const b = snap(); board.items.t1 = {{ path: 'pics/t.png', x: {x}, y: {y}, w: {w}, ar: 400 / 300, crop: null }}; commit(b); render(); }}")
    page.wait_for_selector(".it[data-id=t1]")
    page.wait_for_function("() => { const i = document.querySelector('.it[data-id=t1] img'); return i && i.complete && i.naturalWidth; }")


def alpha_at(path, fx, fy):
    im = Image.open(path).convert("RGBA"); return im.getpixel((min(im.width - 1, int(im.width * fx)), min(im.height - 1, int(im.height * fy))))[3]


def card_halves(page, id):
    """the card's left and right quarters as they show on screen, and the board's paper beside it"""
    b = page.locator(f"#items [data-id={id}]").bounding_box()
    png = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    dpr = png.width / page.viewport_size["width"]
    at = lambda x, y: png.getpixel((int(x * dpr), int(y * dpr)))
    y = b["y"] + b["height"] * 0.6
    return at(b["x"] + b["width"] * 0.12, y), at(b["x"] + b["width"] * 0.88, y)


def near(a, b, d=24): return max(abs(p - q) for p, q in zip(a, b)) <= d


def props(page):
    """the board has «Copy properties ›» (HY.props): the mask is its kind «Маска» there, not items of its own"""
    return page.evaluate("() => !!(typeof HY !== 'undefined' && HY.props)")


def copy_mask(page, id):
    if props(page):
        assert "mask" in page.evaluate("() => HY.props.list().map(d => d.id)")
        page.evaluate(f"() => copyProps('{id}', ['mask'])")
        assert page.evaluate("() => propsClip().kinds.mask.file")
        return
    page.evaluate(f"sel = new Set(['{id}']); render()"); time.sleep(0.2)
    page.click(f"#items [data-id={id}]", button="right")
    page.locator("#ctx button", has_text="Скопировать маску").click()
    page.wait_for_function("() => !!localStorage.getItem('hyimg.maskClip')")


def paste_mask(page, ids, shot_name=None):
    page.evaluate(f"sel = new Set({ids!r}); render()"); time.sleep(0.3)
    if props(page):
        page.evaluate(f"() => pasteProps({{ mask: propsClip().kinds.mask }}, {ids!r})")
        return
    page.click(f"#items [data-id={ids[0]}]", button="right")
    label = f"Вставить маску ({len(ids)})" if len(ids) > 1 else "Вставить маску"
    assert label in page.locator("#ctx").inner_text()
    if shot_name: shot(page, shot_name)
    page.locator("#ctx button", has_text=label).click()


@pytest.mark.parametrize("engine", ENGINES)
def test_board_mask_from_alpha_copy_paste_clear_reload(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    transparent_png(lib)
    before = {q: sha(lib / q) for q in PICS}
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        add_t1(page)
        page.evaluate("sel = new Set(['t1']); render(); fit()"); time.sleep(0.5)
        menu = page.locator("#ctx")
        page.click("#items [data-id=t1]", button="right")
        # what does not apply stays, grey with its reason (Hyimg's HY.menuOff, owner 2026-10-06: «I want users to know what functions exist»)
        grey = lambda label: page.evaluate("l => { const b = [...document.querySelectorAll('#ctx [role=menuitem]')].find(x => x.textContent.includes(l)); return b ? (b.getAttribute('aria-disabled') === 'true' ? b.title : '') : null; }", label)
        assert grey("Маска из альфа-канала") == "" and grey("Убрать маску") == "Маски нет" and "Скопировать маску" not in menu.inner_text(), menu.inner_text()
        shot(page, f"mask-1-{engine}-menu-from-alpha.png")
        menu.locator("button", has_text="Маска из альфа-канала").click()
        page.wait_for_function("() => board.items.t1.mask && board.items.t1.mask.file", timeout=10000)
        m = page.evaluate("() => board.items.t1.mask")
        assert m["file"].startswith("frames/board-masks/masks/") and (lib / m["file"]).exists(), m
        assert alpha_at(lib / m["file"], .25, .5) == 0 and alpha_at(lib / m["file"], .75, .5) == 255
        assert page.evaluate("() => document.querySelector('#items [data-id=t1]').classList.contains('hmask')")
        css = page.evaluate("() => { const s = getComputedStyle(document.querySelector('#items [data-id=t1] img')); return s.maskImage || s.webkitMaskImage; }")
        assert m["file"].split("/")[-1] in css, css
        # a JPEG has no alpha: the item is grey for it, with the reason
        page.evaluate("sel = new Set(['b1']); render()"); time.sleep(0.2)
        page.click("#items [data-id=b1]", button="right")
        assert grey("Маска из альфа-канала") == "В этом файле нет прозрачности"
        page.keyboard.press("Escape")
        # copy from t1, paste onto a1 and b1 (other sizes) together: the same file, scaled by each card, one step to undo
        copy_mask(page, "t1")
        paste_mask(page, ["a1", "b1"], f"mask-2-{engine}-menu-paste.png")
        page.wait_for_function("() => ['a1', 'b1'].every(i => board.items[i].mask && board.items[i].mask.file === board.items.t1.mask.file)")
        page.evaluate("sel = new Set(); render()"); time.sleep(0.8)
        paper = Image.open(io.BytesIO(page.screenshot(clip={"x": 1200, "y": 820, "width": 4, "height": 4}))).convert("RGB").getpixel((1, 1))
        for id, pic in (("a1", (220, 140, 50)), ("b1", (45, 130, 210))):
            left, right = card_halves(page, id)
            assert near(left, paper, 30), (id, left, paper)          # masked out: the board shows through
            assert not near(right, paper, 30), (id, right, paper)    # the picture shows
        shot(page, f"mask-3-{engine}-masked-cards.png")
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => !board.items.a1.mask && !board.items.b1.mask && board.items.t1.mask")
        page.wait_for_function("() => !document.querySelector('#items [data-id=a1]').classList.contains('hmask')")
        page.keyboard.press("Meta+Shift+z")
        page.wait_for_function("() => board.items.a1.mask && board.items.b1.mask")
        # Clear mask on a1 alone
        page.evaluate("sel = new Set(['a1']); render()"); time.sleep(0.2)
        page.click("#items [data-id=a1]", button="right")
        menu.locator("button", has_text="Убрать маску").click()
        page.wait_for_function("() => !board.items.a1.mask && board.items.b1.mask")
        # on the board's file, and after a reload
        page.wait_for_function("() => !dirty", timeout=10000)
        assert board(state)["items"]["b1"]["mask"]["file"] == m["file"]
        page.reload(); page.wait_for_selector(".it[data-id=b1]"); time.sleep(0.8)
        assert page.evaluate("() => document.querySelector('#items [data-id=b1]').classList.contains('hmask') && !document.querySelector('#items [data-id=a1]').classList.contains('hmask')")
        assert {q: sha(lib / q) for q in PICS} == before
        assert not errors, errors
        browser.close()


PX = """([x, y]) => { const { V, acc } = __ed, s = devicePixelRatio || 1, c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d'); g.drawImage(acc, Math.round((V.x + x * V.s) * s), Math.round((V.y + y * V.s) * s), 1, 1, 0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data]; }"""
MASKA = """([fx, fy]) => { const m = __ed.root[__ed.root.length - 1].mask.c, c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d'); g.drawImage(m, Math.floor(fx * m.width), Math.floor(fy * m.height), 1, 1, 0, 0, 1, 1); return g.getImageData(0, 0, 1, 1).data[3]; }"""


@pytest.mark.parametrize("engine", ENGINES)
def test_studio_master_mask_pinned_alpha_paint_save_copy(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    transparent_png(lib)
    before = {q: sha(lib / q) for q in PICS}
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        add_t1(page)
        page.evaluate("sel = new Set(['t1']); render(); fit()"); time.sleep(0.4)
        page.evaluate("() => __frames.makeFrames(['t1'], true)")
        page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
        fid = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe')")
        page.wait_for_timeout(1200)
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page)
        # pinned: the main grade's row first, the mask's under it; the mask is the last of the layers (it clips after the grade)
        assert fr.evaluate("() => { const r = __ed.root; return r[r.length - 1].mmask && r[r.length - 2].main; }")
        rows = fr.evaluate("() => [...document.querySelectorAll('#rows .lr')].slice(0, 2).map(r => [r.dataset.id, r.classList.contains('mmask'), !!r.querySelector('.pin'), !!r.querySelector('.tb2.msk')])")
        assert rows == [["main_grade", False, True, False], ["main_mask", True, True, True]], rows
        # a PNG starts with its alpha: the left half hidden, and the view shows it transparent there (the board under it)
        assert fr.evaluate(MASKA, [.25, .5]) == 0 and fr.evaluate(MASKA, [.75, .5]) == 255
        W, H = fr.evaluate("() => [__ed.W, __ed.H]")
        fr.evaluate("() => __ed.renderView()")
        assert fr.evaluate(PX, [W * .25, H * .5])[3] == 0 and fr.evaluate(PX, [W * .75, H * .5])[3] == 255
        fr.evaluate("() => { __ed.S.ids = ['main_mask']; __ed.S.editMask = true; __ed.refresh(); __ed.showPanel('props'); }"); time.sleep(0.4)
        shot(page, f"mask-4-{engine}-studio-layers-pinned.png")
        # it is not deleted or moved
        page.keyboard.press("Backspace"); time.sleep(0.2)
        assert fr.evaluate("() => __ed.root[__ed.root.length - 1].mmask")
        # the brush on it: black conceals (the right half, the stroke's place)
        fr.evaluate(f"""() => {{ const S = __ed.S; S.fg = '#000000'; S.brush.size = {W} * .2; S.brush.hard = 100; S.ids = ['main_mask']; S.editMask = true;
          __ed.startStroke({{ x: {W} * .75, y: {H} * .5, pr: 1 }}); __ed.strokeTo({{ x: {W} * .8, y: {H} * .5, pr: 1 }}); __ed.endStroke(); }}""")
        assert fr.evaluate(MASKA, [.77, .5]) == 0 and fr.evaluate(MASKA, [.95, .1]) == 255
        T = fr.evaluate("() => __ed.T")   # the editor's words in the board's language (Russian here)
        assert fr.evaluate("() => __ed.S.undo[__ed.S.undo.length - 1].label") == T["h"]["maskBrush"]
        # Invert (Properties), then a selection becomes the mask, then the layers' alpha again
        fr.locator("#pbody button", has_text=T["invert"]).click()
        assert fr.evaluate(MASKA, [.25, .5]) == 255 and fr.evaluate(MASKA, [.77, .5]) == 255 and fr.evaluate(MASKA, [.95, .1]) == 0
        fr.evaluate(f"() => {{ const p = new Path2D(); p.rect(0, 0, {W} / 2, {H}); __ed.commitSel(p, 'new'); __ed.mmFromSel(); __ed.deselect(); }}")
        assert fr.evaluate(MASKA, [.25, .5]) == 255 and fr.evaluate(MASKA, [.75, .5]) == 0
        # the row's menu: copy, paste, from alpha, from selection, invert, disable, clear
        fr.locator("#rows .lr.mmask").click(button="right"); time.sleep(0.2)
        # the master's menu (owner 2026-10-07): its own items in order, and what a master never does grey with the reason, not hidden
        items = fr.evaluate("""() => [...document.querySelectorAll('#menu [role=menuitem]')]
          .map(b => [b.querySelector('.ml').childNodes[0].textContent.trim(), b.getAttribute('aria-disabled') === 'true' ? b.title : ''])""")
        own = [i[0] for i in items if i[0] in [T[k] for k in ("copyMask", "pasteMask", "maskFromAlpha", "mmFromSelL", "invert", "disableMask", "clearMask")]]
        assert own == [T[k] for k in ("copyMask", "pasteMask", "maskFromAlpha", "mmFromSelL", "invert", "disableMask", "clearMask")], items
        assert dict(items)[T["deleteLayer"]], items
        shot(page, f"mask-5-{engine}-studio-mask-menu.png")
        fr.locator("#menu button", has_text=T["maskFromAlpha"]).evaluate("b => b.click()")
        assert fr.evaluate(MASKA, [.25, .5]) == 0 and fr.evaluate(MASKA, [.75, .5]) == 255
        # feather: a soft edge, the card gets the mask's look baked beside it
        fr.evaluate("() => { const n = __ed.root[__ed.root.length - 1]; n.mask.feather = 12; __ed.S.dirty = true; __ed.S.ver++; __ed.refresh(); }")
        # a white document (a new frame is transparent since 2026-10-09), so the render shows whether the mask was baked into it
        fr.evaluate("() => { __ed.S.ids = []; __ed.refresh(); __ed.showPanel('props'); }"); time.sleep(0.3)
        fr.locator("#pbody .bgsw[style*=\"255, 255, 255\"]").first.click(); time.sleep(0.2)
        fr.click("#topr [data-a=save]")
        page.wait_for_function(f"() => board.items['{fid}'].v === 2", timeout=60000)
        closed(page)
        it = page.evaluate(f"() => board.items['{fid}']")
        dirp = it["doc"].rsplit("/", 1)[0]
        assert it["mask"]["file"] == f"{dirp}/masks/main_mask.2.png" and it["mask"]["show"] == f"{dirp}/masks/main_mask_fx.2.png" and it["mask"]["feather"] == 12, it["mask"]
        assert (lib / it["mask"]["file"]).exists() and (lib / it["mask"]["show"]).exists()
        doc = json.loads((lib / it["doc"]).read_text())
        assert doc["mask"]["file"] == it["mask"]["file"] and all(l["kind"] == "pic" for l in doc["layers"]), doc
        r = Image.open(lib / it["render"]).convert("RGBA")
        assert r.getpixel((r.width // 4, r.height // 2))[3] == 255, "the render is without the mask (the board masks the card)"
        page.wait_for_function(f"() => document.querySelector(\".plg[data-id='{fid}']\").classList.contains('hmask')")
        page.evaluate("sel = new Set(); render()"); time.sleep(0.8)
        shot(page, f"mask-6-{engine}-masked-frame-card.png")
        left, right = card_halves(page, fid)
        paper = Image.open(io.BytesIO(page.screenshot(clip={"x": 1200, "y": 820, "width": 4, "height": 4}))).convert("RGB").getpixel((1, 1))
        assert near(left, paper, 30) and not near(right, paper, 30), (left, right, paper)
        # the board's undo: the card before the Save, no mask
        page.keyboard.press("Meta+z")
        page.wait_for_function(f"() => board.items['{fid}'].v === 1 && !board.items['{fid}'].mask")
        page.keyboard.press("Meta+Shift+z")
        page.wait_for_function(f"() => board.items['{fid}'].v === 2 && board.items['{fid}'].mask")
        # the studio copies its mask, the board pastes it onto a picture
        page.wait_for_timeout(1200)
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page)
        assert fr.evaluate(MASKA, [.25, .5]) == 0, "the card's mask comes back into the studio"
        fr.evaluate("() => __ed.mmCopy()")
        fr.wait_for_function("() => !!localStorage.getItem('hyimg.maskClip')")
        clip = json.loads(fr.evaluate("() => localStorage.getItem('hyimg.maskClip')"))
        assert clip["file"].startswith("frames/board-masks/masks/") and (lib / clip["file"]).exists()
        fr.evaluate("() => __ed.cancelFrame()"); closed(page)
        paste_mask(page, ["a1"])
        page.wait_for_function(f"() => board.items.a1.mask && board.items.a1.mask.file === '{clip['file']}'")
        assert {q: sha(lib / q) for q in PICS} == before
        assert not errors, errors
        browser.close()
