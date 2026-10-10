"""The agent's commands in Image Studio (owner 2026-10-10: «научить агента пользоваться всеми тулзами в Image Studio: вырезать, рисовать ...
не нажимая кнопки»): window.hyImage.run does what the tool does, pixel for pixel and with the tool's step in History, and `hy.py image`
runs them headless on a frame of the board: Save is a new version, the pictures and the older versions stay. Chromium, dark, own server."""
import hashlib
import json
import subprocess
import sys

import pytest
from PIL import Image

from editor_kit import at, focus, settle, start
from test_imgframe import REPO, board, hy  # noqa: F401  (the fixture)

# a canvas at 64 × 64 samples, RGBA: what a layer, a mask or the selection holds
SIG = """(w) => { const K = hyEdK, c = w === 'sel' ? K.sel().c : w.endsWith('|mask') ? __ed.byId(w.split('|')[0]).mask.c : __ed.byId(w).c;
  const t = document.createElement('canvas'); t.width = t.height = 64; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 64);
  return [...g.getImageData(0, 0, 64, 64).data]; }"""
LAST = "() => { const u = __ed.S.undo; return u.length ? u[u.length - 1].label : null; }"


def ops(fr, *o):
    r = fr.evaluate("o => hyImage.run(o)", list(o))
    assert r["ok"], r
    return r


def diff(a, b):
    """the largest difference of two samplings, premultiplied: a colour where nothing shows is not a difference"""
    pm = lambda s, i: s[i] * s[i - i % 4 + 3] / 255 if i % 4 < 3 else s[i]
    return max(abs(pm(a, i) - pm(b, i)) for i in range(len(a)))


def sel_iou(a, b):
    A = [a[i] > 127 for i in range(3, len(a), 4)]; B = [b[i] > 127 for i in range(3, len(b), 4)]
    return sum(x and y for x, y in zip(A, B)) / max(1, sum(x or y for x, y in zip(A, B)))


def undo(fr): fr.evaluate("() => hyEdK.undo()"); settle(fr, 80)


@pytest.mark.parametrize("hy", ["en"], indirect=True)
def test_ops_do_what_the_tools_do(hy):
    """each command against the same action through the interface: the same pixels, the same History step"""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, "chromium")
        page.emulate_media(color_scheme="dark")
        assert fr.evaluate("() => !!window.hyImage && hyImage.info().size.join('x')") == "1000x450"
        # New Layer: the strip's button, then the command
        fr.locator("#lbot button[data-tip='New Layer']").click(); settle(fr)
        ui, shape = fr.evaluate(LAST), fr.evaluate("() => { const n = hyEdK.one(); return [n.type, n.x, n.y, n.w, n.h]; }")
        undo(fr)
        r = ops(fr, {"op": "layer.new"}); lid = r["results"][0]["layer"]
        assert r["steps"] == [ui] == ["New Layer"] and fr.evaluate("() => { const n = hyEdK.one(); return [n.type, n.x, n.y, n.w, n.h]; }") == shape
        # the Rectangular Marquee: M and a drag, then select.rect over the same box (the drag lands on whole screen pixels)
        focus(page, fr); page.keyboard.press("KeyM")
        page.mouse.move(*at(page, fr, 100, 80)); page.mouse.down(); page.mouse.move(*at(page, fr, 400, 300), steps=6); page.mouse.up(); settle(fr)
        a = fr.evaluate(SIG, "sel")
        ops(fr, {"op": "select.rect", "x": 100, "y": 80, "w": 300, "h": 220})
        assert sel_iou(a, fr.evaluate(SIG, "sel")) > 0.95
        # Edit › Fill › Foreground Color from the picture's right click, then fill
        ops(fr, {"op": "color", "fg": "#ff0000"})
        page.mouse.click(*at(page, fr, 250, 200), button="right"); settle(fr)
        fr.locator("#menu [role=menuitem]", has_text="Fill").first.click(); settle(fr)
        fr.locator("#submenu [role=menuitem]", has_text="Foreground Color").first.click(); settle(fr)
        ui, a = fr.evaluate(LAST), fr.evaluate(SIG, lid)
        undo(fr); assert fr.evaluate(SIG, lid) != a
        r = ops(fr, {"op": "fill", "color": "#ff0000"})
        assert r["steps"] == [ui] == ["Fill"] and fr.evaluate(SIG, lid) == a
        # ⌫ in a selection, then erase
        ops(fr, {"op": "select.rect", "x": 150, "y": 100, "w": 100, "h": 100}); focus(page, fr)
        page.keyboard.press("Backspace"); settle(fr)
        ui, a = fr.evaluate(LAST), fr.evaluate(SIG, lid)
        undo(fr); r = ops(fr, {"op": "erase"})
        assert r["steps"] == [ui] == ["Clear"] and fr.evaluate(SIG, lid) == a
        # ⇧⌘I, then select.invert, from the same selection
        focus(page, fr); page.keyboard.press("Shift+Meta+KeyI"); settle(fr); a = fr.evaluate(SIG, "sel")
        page.keyboard.press("Shift+Meta+KeyI"); settle(fr)
        ops(fr, {"op": "select.invert"}); assert fr.evaluate(SIG, "sel") == a
        # the Brush: B and a drag through points, then brush through the same points of the document
        ops(fr, {"op": "select.none"}); focus(page, fr); page.keyboard.press("KeyB")
        off = page.evaluate("() => { const w = document.querySelector('.ifed iframe').getBoundingClientRect(); return [w.left, w.top]; }")
        path = [at(page, fr, 200 + 40 * i, 200 + 15 * i) for i in range(11)]
        page.mouse.move(*path[0]); page.mouse.down()
        for q in path[1:]: page.mouse.move(*q)
        page.mouse.up(); settle(fr)
        ui, a = fr.evaluate(LAST), fr.evaluate(SIG, lid)
        pts = [fr.evaluate("([x, y]) => { const p = __ed.toDoc(x, y); return [p.x, p.y]; }", [q[0] - off[0], q[1] - off[1]]) for q in path]
        undo(fr); r = ops(fr, {"op": "brush", "points": pts})
        assert r["steps"] == [ui] == ["Brush Tool"] and diff(fr.evaluate(SIG, lid), a) <= 3
        # Add layer mask with a selection (Reveal Selection), then mask.add
        ops(fr, {"op": "select.rect", "x": 0, "y": 0, "w": 500, "h": 225})
        fr.locator("#lbot button[data-tip='Add layer mask']").click(); settle(fr)
        ui, a = fr.evaluate(LAST), fr.evaluate(SIG, lid + "|mask")
        undo(fr); assert fr.evaluate(f"() => __ed.byId('{lid}').mask") is None
        r = ops(fr, {"op": "mask.add"})
        assert r["steps"] == [ui] == ["Add Layer Mask"] and fr.evaluate(SIG, lid + "|mask") == a and r["results"][0]["onMask"] is True
        # what a tool would refuse, the command refuses with the tool's words; nothing after it runs
        r = fr.evaluate("() => hyImage.run([{ op: 'layer.select', layer: 'a' }, { op: 'select.all' }, { op: 'erase' }, { op: 'layer.new' }])")
        assert not r["ok"] and r["at"] == 2 and "locked" in r["error"].lower() and r["steps"] == [], r
        assert errors == [], errors
        browser.close()


def sha(p): return hashlib.sha1(p.read_bytes()).hexdigest()


@pytest.mark.parametrize("hy", ["en"], indirect=True)
def test_hy_image_runs_headless_and_saves_a_new_version(hy, tmp_path):
    """hy.py image look/run/export on a frame made with hy.py do 'frame': History's names, Save a new version, the card takes it"""
    port, lib, state = hy
    hyp = lambda *a, inp=None: subprocess.run([sys.executable, str(REPO / "review/hy.py"), *a, "--port", str(port), "--page", "main"],
                                             capture_output=True, text=True, timeout=240, input=inp)
    out = hyp("do", 'frame a1 name="Pic"', "--quiet"); assert out.returncode == 0, out.stdout + out.stderr
    fid, card = next((k, it) for k, it in board(state)["items"].items() if it.get("type") == "imgframe")
    d = lib / card["doc"].rsplit("/", 1)[0]; before = {f.name: sha(f) for f in d.iterdir() if f.is_file()}; pic = sha(lib / "pics/a.png")
    # look: the render with a line every 100 px, labelled in the picture's own pixels
    look = tmp_path / "look.png"
    out = hyp("image", "look", "Pic", "grid=100", "--out", str(look)); assert out.returncode == 0 and "600×400 px" in out.stdout, out.stdout + out.stderr
    g = Image.open(look).convert("RGB"); assert g.size == (600, 400) and g.getpixel((100, 300)) != Image.open(lib / card["render"]).convert("RGB").getpixel((100, 300))
    # --dry: the commands and the picture, no version
    ops_ = [{"op": "layer.new", "name": "Red"}, {"op": "select.polygon", "points": [[200, 100], [400, 100], [400, 300], [200, 300]]},
            {"op": "fill", "color": "#ff0000"}, {"op": "layer.opacity", "value": 60}, {"op": "select.none"}]
    dry = tmp_path / "dry.png"
    out = hyp("image", "run", "Pic", json.dumps(ops_), "--dry", "--out", str(dry)); assert out.returncode == 0, out.stdout + out.stderr
    assert "шаги History: New Layer, Rename Layer, Fill, Opacity Change" in out.stdout and board(state)["items"][fid]["v"] == 1
    r, g_, b_ = Image.open(dry).convert("RGB").getpixel((300, 200)); assert r > 200 and g_ < 150, (r, g_, b_)
    # run: the same, then Save; the card shows version 2, the pictures and version 1 stay as they were
    (tmp_path / "ops.json").write_text(json.dumps(ops_))
    out = hyp("image", "run", "Pic", str(tmp_path / "ops.json"), "--out", str(tmp_path / "after.png"))
    assert out.returncode == 0 and "версия 2" in out.stdout, out.stdout + out.stderr
    c2 = board(state)["items"][fid]
    assert c2["v"] == 2 and c2["doc"].endswith("frame.2.json") and c2["render"].endswith("render.2.png")
    assert {f.name: sha(f) for f in d.iterdir() if f.is_file() and f.name in before} == before and sha(lib / "pics/a.png") == pic
    doc = json.loads((lib / c2["doc"]).read_text()); red = next(l for l in doc["layers"] if l["name"] == "Red")
    assert red["kind"] == "paint" and red["opacity"] == 60 and (lib / red["file"]).is_file()
    rend = Image.open(lib / c2["render"]).convert("RGB"); assert rend.getpixel((300, 200))[0] > 200 and rend.getpixel((50, 50)) == Image.open(lib / card["render"]).convert("RGB").getpixel((50, 50))
    # the next run opens version 2: its layer is there to work on; a failing command saves nothing
    out = hyp("image", "run", "Pic", '[{"op": "layer.select", "layer": "Red"}, {"op": "erase"}]')
    assert out.returncode != 0 and "select an area first" in out.stdout and board(state)["items"][fid]["v"] == 2, out.stdout + out.stderr
    out = hyp("image", "export", "Pic", "--out", str(tmp_path / "exp.png"))
    assert out.returncode == 0 and sha(tmp_path / "exp.png") == sha(lib / c2["render"])
    out = hyp("image", "ops"); assert out.returncode == 0 and "select.polygon" in out.stdout and "mask.add" in out.stdout


@pytest.mark.parametrize("hy", ["en"], indirect=True)
def test_select_from_image_loads_a_mask_picture(hy):
    """select.fromImage (owner 2026-10-10: «методы: выделение, маска, инверсия маски»): a mask picture of the library becomes the selection,
    white selected, black not, grey partly; another size is stretched; mode combines it as a marquee; a picture it can't read fails"""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    (lib / "masks").mkdir()
    m = Image.new("L", (1000, 450), 0); m.paste(255, (100, 80, 400, 300)); m.save(lib / "masks/rect.png")
    m.resize((500, 225), Image.NEAREST).save(lib / "masks/half.png")
    left = Image.new("L", (1000, 450), 0); left.paste(255, (0, 0, 250, 450)); left.save(lib / "masks/left.png")
    Image.new("L", (1000, 450), 128).save(lib / "masks/grey.png")
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, port, "chromium")
        page.emulate_media(color_scheme="dark")
        ops(fr, {"op": "select.rect", "x": 100, "y": 80, "w": 300, "h": 220}); rect = fr.evaluate(SIG, "sel")
        r = ops(fr, {"op": "select.none"}, {"op": "select.fromImage", "file": "masks/rect.png"})
        assert sel_iou(rect, fr.evaluate(SIG, "sel")) > 0.98 and r["results"][1]["selection"] == {"x": 100, "y": 80, "w": 300, "h": 220}, r
        r = ops(fr, {"op": "select.fromImage", "file": "masks/half.png"})
        assert r["results"][0].get("stretched") is True and sel_iou(rect, fr.evaluate(SIG, "sel")) > 0.97
        # mode: sub takes the left strip away, as the marquee's sub does
        ops(fr, {"op": "select.rect", "x": 100, "y": 80, "w": 300, "h": 220}, {"op": "select.rect", "x": 0, "y": 0, "w": 250, "h": 450, "mode": "sub"})
        want = fr.evaluate(SIG, "sel")
        ops(fr, {"op": "select.fromImage", "file": "masks/rect.png"}, {"op": "select.fromImage", "file": "masks/left.png", "mode": "sub"})
        assert sel_iou(want, fr.evaluate(SIG, "sel")) > 0.97
        # then the selection works for the next tools: invert, fill
        ops(fr, {"op": "select.fromImage", "file": "masks/rect.png"}, {"op": "select.invert"})
        assert fr.evaluate("() => __ed.S.hasSel") and sel_iou(rect, fr.evaluate(SIG, "sel")) < 0.05
        # grey selects partly
        ops(fr, {"op": "select.fromImage", "file": "masks/grey.png"}); a = fr.evaluate(SIG, "sel")[(32 * 64 + 32) * 4 + 3]
        assert 118 <= a <= 138, a
        r = fr.evaluate("() => hyImage.run([{ op: 'select.fromImage', file: 'masks/none.png' }])")
        assert not r["ok"] and "cannot read" in r["error"], r
        r = fr.evaluate("() => hyImage.run([{ op: 'select.fromImage' }])")
        assert not r["ok"] and "file" in r["error"], r
        assert errors == [], errors
        browser.close()
