"""Image frames on a real canvas with a disposable library (Chromium; the main flow in WebKit too, as the app runs in WKWebView):
⌥⌘G makes a frame of two pictures (they leave the board, undo brings them back); the editor opens in place over the board (the camera
stays, the crumb gains the frame, the dock turns into the editor's); a brush stroke and Save write a new version beside the old one,
board ⌘Z goes back to it and ⌘⇧Z forward; the originals stay byte for byte; «Разобрать фрейм» puts the pictures back; a picture much
smaller on the board than in pixels keeps its pixels; «Каждый в свой фрейм» and a group; the library's pictures dropped into the editor;
hy.py's frame command; the server lets the plugin write only inside frames/<stamp>/ and keeps the last 10 versions.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_imgframe.py
  FRAMES_SHOTS=<folder> also saves screenshots of the steps there
"""
import base64, hashlib, io, json, os, re, shutil, socket, subprocess, sys, time, urllib.error, urllib.request, uuid
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent.parent
REPO = Path(os.environ.get("HYIMG_REPO", HERE.parent / "hyimg"))   # side by side in one folder
SHOTS = os.environ.get("FRAMES_SHOTS")
LAMA = Path(os.path.expanduser(os.environ.get("HYIMG_LAMA", "~/Library/Caches/Hyimg/models/lama/lama_fp32.onnx")))
WEBKIT = any(Path(os.path.expanduser("~/Library/Caches/ms-playwright")).glob("webkit-*"))


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def picture(w, h, a, b):   # a gradient with a square: something to see in the render
    im = Image.new("RGB", (w, h)); d = ImageDraw.Draw(im)
    for y in range(h): d.line([(0, y), (w, y)], fill=tuple(int(a[k] + (b[k] - a[k]) * y / h) for k in range(3)))
    d.rectangle([w // 4, h // 4, w // 2, h // 2], fill=(250, 250, 250)); return im


def sha(p): return hashlib.sha1(Path(p).read_bytes()).hexdigest()


ITEMS = {"a1": {"path": "pics/a.png", "x": 0, "y": 0, "w": 600, "ar": 1.5, "crop": None},
         "b1": {"path": "pics/b.jpg", "x": 700, "y": 0, "w": 300, "ar": 300 / 450, "crop": None},
         "g1": {"path": "pics/big.jpg", "x": 0, "y": 900, "w": 300, "ar": 1.5, "crop": None}}


@pytest.fixture
def hy(tmp_path):
    lib, state, plugins = tmp_path / "lib", tmp_path / "state", tmp_path / "plugins"
    (lib / "pics").mkdir(parents=True); (state / "boards").mkdir(parents=True); plugins.mkdir(); (plugins / "frames").symlink_to(HERE)
    picture(600, 400, (200, 40, 40), (240, 180, 60)).save(lib / "pics/a.png")
    picture(300, 450, (30, 60, 200), (60, 200, 220)).save(lib / "pics/b.jpg", quality=92)
    picture(2400, 1600, (40, 160, 90), (200, 220, 90)).save(lib / "pics/big.jpg", quality=90)   # 2400 px on a board 300 wide
    picture(500, 500, (120, 40, 160), (220, 140, 240)).save(lib / "pics/lib.png")                # only in the library
    (state / "boards/main.json").write_text(json.dumps({"items": ITEMS, "groups": {}, "removed": {}, "revision": 1}))
    port = free_port()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("HYIMG_", "REVIEW_"))}
    env.update(HYIMG_LIBRARY_ROOT=str(lib), HYIMG_STATE_ROOT=str(state), HYIMG_PROJECT_ID=str(uuid.uuid4()), HYIMG_PLUGINS=str(plugins),
               HYIMG_SETTINGS=str(tmp_path / "settings.json"), PYTHONDONTWRITEBYTECODE="1")
    log = open(tmp_path / "server.log", "w+")
    proc = subprocess.Popen([sys.executable, str(REPO / "review/server.py"), str(port)], env=env, stdout=log, stderr=log)
    for _ in range(100):
        try: urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1); break
        except OSError: time.sleep(0.1)
    yield port, lib, state
    proc.terminate(); proc.wait(5); log.close()


def post(port, path, body, ctype="application/octet-stream"):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body, headers={"Content-Type": ctype}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()


def shot(page, name):
    if SHOTS: Path(SHOTS).mkdir(parents=True, exist_ok=True); page.screenshot(path=str(Path(SHOTS) / name))


def board(state): return json.loads((state / "boards/main.json").read_text())


def open_board(p, port, engine="chromium"):
    browser = getattr(p, engine).launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{port}/canvas.html")
    page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
    page.wait_for_selector(".it[data-id=a1]")
    return browser, page, errors


def editor(page):
    page.wait_for_selector(".ifed.on iframe", state="attached", timeout=20000)
    for _ in range(200):
        fr = next((f for f in page.frames if "/editor/index.html" in f.url), None)
        if fr: break
        page.wait_for_timeout(50)
    fr.wait_for_function("() => window.__ed && __ed.ready && __ed.BM", timeout=30000)
    return fr


def closed(page, t=60000):
    page.wait_for_function("() => !document.querySelector('.ifed.on') && !document.documentElement.classList.contains('ifedit')", timeout=t)


@pytest.mark.parametrize("engine", ["chromium", "webkit"])
def test_frame_make_edit_save_undo_explode(hy, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit (python3 -m playwright install webkit)")
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    before = {p: sha(lib / p) for p in ("pics/a.png", "pics/b.jpg", "pics/big.jpg")}
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port, engine)
        page.evaluate("sel = new Set(['a1', 'b1']); render(); fit()"); time.sleep(0.6)
        # the right-click menu and the bar over the selection offer both ways in
        page.click(".it[data-id=a1]", button="right")
        menu = page.locator("#ctx").inner_text()
        assert "В один фрейм" in menu and "Каждый в свой фрейм (2)" in menu, menu
        page.keyboard.press("Escape")
        page.evaluate("sel = new Set(['a1', 'b1']); render()")
        bar = page.locator(".tidy").inner_text()
        assert "В один фрейм" in bar and "Каждый в свой фрейм (2)" in bar, bar
        shot(page, f"1-{engine}-selection-bar.png")
        # ⌥⌘G: the pictures move into the frame; the document is their box in the largest picture's own pixels
        page.keyboard.press("Alt+Meta+KeyG")
        page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
        fid, card = page.evaluate("() => Object.entries(board.items).find(([k, it]) => it.type === 'imgframe')")
        assert not page.evaluate("() => !!(board.items.a1 || board.items.b1)")
        assert card["size"] == [1000, 450] and (card["w"], card["h"]) == (1000, 450) and sorted(card["pics"]) == ["pics/a.png", "pics/b.jpg"]
        assert card["doc"].endswith("/frame.1.json") and card["render"].endswith("/render.1.png") and card["v"] == 1
        dirp = card["doc"].rsplit("/", 1)[0]
        doc = json.loads((lib / card["doc"]).read_text())
        assert doc["version"] == 1 and doc["size"] == [1000, 450] and [l["kind"] for l in doc["layers"]] == ["pic", "pic"]
        assert Image.open(lib / card["render"]).size == (1000, 450)
        render0 = Image.open(lib / card["render"]).convert("RGB")
        # the pictures inside the frame still count as on the page: none went to the archive, the server lists them
        page.wait_for_function("() => !dirty", timeout=10000)
        assert board(state)["removed"] == {}
        assert {"pics/a.png", "pics/b.jpg"} <= set(json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/pages"))["on"])
        # one step to undo, and redo
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => board.items.a1 && board.items.b1 && !Object.values(board.items).some(it => it.type === 'imgframe')")
        page.keyboard.press("Meta+Shift+z")
        page.wait_for_function(f"() => board.items['{fid}'] && !board.items.a1")
        # the frame's selection is purple, not the board's blue
        page.evaluate(f"sel = new Set(['{fid}']); render()"); time.sleep(0.4)
        oc = page.evaluate(f"() => getComputedStyle(document.querySelector(\".plg[data-id='{fid}']\")).outlineColor")
        assert oc.replace(" ", "") in ("rgb(139,92,246)", "rgb(124,58,237)"), oc
        assert "Открыть" in page.locator(".tidy").inner_text()
        shot(page, f"2-{engine}-board-frame-card.png")
        # the editor in place: a double click; the camera stays, the crumb gains the frame, the dock is the editor's
        page.wait_for_timeout(1200)   # the editor page loads ahead of time
        cam0 = page.evaluate("() => JSON.stringify(cam)")
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page)
        assert fr.evaluate("() => __ed.root.length") == 2 and fr.evaluate("() => [__ed.W, __ed.H]") == [1000, 450]
        assert fr.evaluate("() => __ed.root.every(n => n.orig && n.locks.pixels)")   # originals are locked bases
        assert page.evaluate("() => JSON.stringify(cam)") == cam0
        assert page.evaluate("() => document.documentElement.classList.contains('ifedit') && document.querySelector('#cIfr').textContent.includes('Фрейм 1') && !!document.querySelector('#dock.plg-mode #ifActs')")
        assert page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--toast-top').trim()") == "60px"
        # the frame is drawn exactly where its card lies: the editor's view is the board's camera
        v = fr.evaluate("() => ({ x: __ed.V.x, y: __ed.V.y, s: __ed.V.s })")
        r = page.evaluate(f"() => {{ const e = document.querySelector(\".plg[data-id='{fid}']\").getBoundingClientRect(); return [e.left, e.top, e.width]; }}")
        off = page.evaluate("() => { const w = document.querySelector('.ifed').getBoundingClientRect(); return [w.left, w.top]; }")
        assert abs(v["x"] + off[0] - r[0]) < 1.5 and abs(v["y"] + off[1] - r[1]) < 1.5 and abs(v["s"] * 1000 - r[2]) < 1.5, (v, r, off)
        time.sleep(0.6)
        shot(page, f"3-{engine}-editor-in-place.png")
        # the editor's zoom is the board's zoom
        fr.evaluate("() => __ed.zoomTo(__ed.V.s * 1.25, null, null, false)"); page.wait_for_timeout(200)
        assert abs(page.evaluate("() => cam.z") - json.loads(cam0)["z"] * 1.25) < 1e-6
        fr.evaluate("() => __ed.zoomTo(__ed.V.s / 1.25, null, null, false)"); page.wait_for_timeout(200)
        # a brush stroke over the first picture: the original is locked, so it goes onto a new layer above it
        v = fr.evaluate("() => ({ x: __ed.V.x, y: __ed.V.y, s: __ed.V.s })")
        to = lambda dx, dy: (off[0] + v["x"] + dx * v["s"], off[1] + v["y"] + dy * v["s"])
        fr.evaluate("() => __ed.setTool('brush')")
        page.mouse.move(*to(100, 225)); page.mouse.down()
        for k in range(1, 21): page.mouse.move(*to(100 + k * 20, 225 + (k % 2) * 4))
        page.mouse.up(); time.sleep(0.3)
        assert fr.evaluate("() => __ed.root.length") == 3
        fr.click("#bSave")
        page.wait_for_function(f"() => board.items['{fid}'].v === 2", timeout=60000)
        closed(page)
        card2 = page.evaluate(f"() => board.items['{fid}']")
        assert card2["doc"] == f"{dirp}/frame.2.json" and card2["render"] == f"{dirp}/render.2.png"
        doc2 = json.loads((lib / card2["doc"]).read_text())
        assert sorted(l["kind"] for l in doc2["layers"]) == ["paint", "pic", "pic"] and doc2["v"] == 2
        paint = next(l for l in doc2["layers"] if l["kind"] == "paint")
        assert (lib / paint["file"]).is_file() and re.fullmatch(re.escape(dirp) + r"/layers/[A-Za-z0-9_]+\.2\.png", paint["file"])
        im = Image.open(lib / card2["render"]).convert("RGB")
        assert im.size == (1000, 450) and sum(im.getpixel((300, 225))) < 60 and sum(render0.getpixel((300, 225))) > 200   # the stroke is black
        assert (lib / card["doc"]).is_file() and (lib / card["render"]).is_file()   # version 1 is still there
        assert page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--toast-top').trim()") == ""
        page.wait_for_function("() => { const i = document.querySelector('.plg[data-type=imgframe] img.ifr'); return i && i.complete && i.naturalWidth === 1000 && i.src.includes('render.2.png') }")
        shot(page, f"4-{engine}-board-card-after-save.png")
        # board undo goes back to version 1 (its files are on disk), redo forward to version 2
        page.keyboard.press("Meta+z")
        page.wait_for_function(f"() => board.items['{fid}'].v === 1 && board.items['{fid}'].render.endsWith('render.1.png')")
        page.keyboard.press("Meta+Shift+z")
        page.wait_for_function(f"() => board.items['{fid}'].v === 2")
        assert {p: sha(lib / p) for p in before} == before   # the originals are byte for byte what they were
        # «Разобрать фрейм»: the pictures come back where they lie in the frame; the frame's folder stays
        page.click(f".plg[data-id='{fid}']", button="right")
        page.locator("#ctx button", has_text="Разобрать фрейм").click()
        page.wait_for_function("() => board.items.a1 && board.items.b1 && !Object.values(board.items).some(it => it.type === 'imgframe')")
        a1, b1 = page.evaluate("() => [board.items.a1, board.items.b1]")
        assert (a1["x"], a1["y"], a1["w"], b1["x"], b1["w"]) == (0, 0, 600, 700, 300)
        page.keyboard.press("Meta+z")
        page.wait_for_function(f"() => board.items['{fid}'] && !board.items.a1")
        # Canvas Size changes the document's shape: the card keeps its place and width, its height follows; Esc with nothing to cancel
        # and no changes closes the editor
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page)
        assert fr.evaluate("() => __ed.root.length") == 3   # the painted layer came back from its file
        fr.evaluate("() => __ed.canvasSize(1000, 900, 0, 0)")
        fr.click("#bSave")
        page.wait_for_function(f"() => board.items['{fid}'].v === 3", timeout=60000); closed(page)
        assert page.evaluate(f"() => [board.items['{fid}'].w, board.items['{fid}'].h, board.items['{fid}'].x]") == [1000, 900, 0]
        assert Image.open(lib / f"{dirp}/render.3.png").size == (1000, 900)
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page)
        fr.locator("body").press("Escape")
        closed(page, 10000)
        assert {p: sha(lib / p) for p in before} == before
        assert not errors, errors
        browser.close()
    if engine == "webkit": return
    # an agent sees the frame and what is inside it
    out = subprocess.run([sys.executable, str(REPO / "review/hy.py"), "map", "--port", str(port)], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0 and "F «Фрейм 1» 1000×900 px · картинок 2: pics/a.png, pics/b.jpg" in out.stdout, out.stdout + out.stderr
    out = subprocess.run([sys.executable, str(REPO / "review/hy.py"), "find", "b.jpg", "--port", str(port)], capture_output=True, text=True, timeout=60)
    assert "во фрейме «Фрейм 1»" in out.stdout, out.stdout + out.stderr


def test_native_pixels_each_group_and_library_drop(hy):
    """a picture 2400 px wide lying 300 wide on the board makes a 2400 px document (owner 2026-10-05: «use the source's native pixels»);
    «Каждый в свой фрейм» gives every picture its own frame in one undo step; a group brings its pictures and stays around the card;
    pictures dragged from the library into the editor become original layers in their own pixels"""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port)
        page.evaluate("sel = new Set(['g1']); render(); fit()"); time.sleep(0.4)
        page.keyboard.press("Alt+Meta+KeyG")
        page.wait_for_function("() => Object.values(board.items).some(it => it.type === 'imgframe')", timeout=20000)
        fid, card = page.evaluate("() => Object.entries(board.items).find(([k, it]) => it.type === 'imgframe')")
        assert card["size"] == [2400, 1600] and card["w"] == 300, card
        # each picture its own frame, at its place and size, one step to undo
        page.evaluate("sel = new Set(['a1', 'b1']); render()")
        page.keyboard.press("Alt+Shift+Meta+KeyG")
        page.wait_for_function("() => Object.values(board.items).filter(it => it.type === 'imgframe').length === 3", timeout=20000)
        cards = page.evaluate("() => Object.values(board.items).filter(it => it.type === 'imgframe' && it.pics.length === 1 && it.pics[0] !== 'pics/big.jpg').map(c => [c.pics[0], c.x, c.y, c.w, c.h, c.size])")
        assert sorted(cards) == [["pics/a.png", 0, 0, 600, 400, [600, 400]], ["pics/b.jpg", 700, 0, 300, 450, [300, 450]]], cards
        page.keyboard.press("Meta+z")
        page.wait_for_function("() => board.items.a1 && board.items.b1 && Object.values(board.items).filter(it => it.type === 'imgframe').length === 1")
        # a group: the bar offers both with the count; one frame, the group stays around it
        page.evaluate("board.groups.gr = { title: 'Группа 1', x: -50, y: -50, w: 1100, h: 600, members: ['a1', 'b1'] }; sel = new Set(['gr']); render()")
        time.sleep(0.3)
        assert "Каждый в свой фрейм (2)" in page.locator(".tidy").inner_text()
        page.locator(".tidy [data-plgbar]", has_text="В один фрейм").click()
        page.wait_for_function("() => Object.values(board.items).filter(it => it.type === 'imgframe').length === 2", timeout=20000)
        nf = page.evaluate("() => Object.keys(board.items).find(k => board.items[k].type === 'imgframe' && board.items[k].pics.length === 2)")
        assert page.evaluate(f"() => board.groups.gr && board.groups.gr.members.includes('{nf}')")
        # the library's picture dropped into the editor (the drag carries text/x-frames, as the library's cards do)
        page.wait_for_timeout(1200)
        page.dblclick(f".plg[data-id='{fid}']")
        fr = editor(page)
        fr.evaluate("""() => { const dt = new DataTransfer(); dt.setData('text/x-frames', JSON.stringify(['pics/lib.png'])); dt.setData('text/x-frame', 'pics/lib.png');
          const x = __ed.V.x + 1200 * __ed.V.s, y = __ed.V.y + 800 * __ed.V.s;
          for (const t of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(t, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })); }""")
        fr.wait_for_function("() => __ed.root.length === 2", timeout=20000)
        top = fr.evaluate("() => { const n = __ed.root[1]; return { w: n.w, h: n.h, cx: n.x + n.w / 2, cy: n.y + n.h / 2, orig: !!n.orig, path: n.src && n.src.path, cw: n.c.width, px: 1 / __ed.V.s }; }")
        assert (top["w"], top["h"], top["orig"], top["path"], top["cw"]) == (500, 500, True, "pics/lib.png", 500), top   # its own pixels
        assert abs(top["cx"] - 1200) <= top["px"] + .01 and abs(top["cy"] - 800) <= top["px"] + .01, top   # at the drop point (a screen pixel is px document pixels)
        time.sleep(0.5); shot(page, "5-editor-library-drop.png")
        fr.click("#bSave")
        page.wait_for_function(f"() => board.items['{fid}'].v === 2", timeout=60000); closed(page)
        assert sorted(page.evaluate(f"() => board.items['{fid}'].pics")) == ["pics/big.jpg", "pics/lib.png"]
        doc = json.loads((lib / page.evaluate(f"() => board.items['{fid}'].doc")).read_text())
        assert [l["kind"] for l in doc["layers"]] == ["pic", "pic"] and doc["layers"][1]["path"] == "pics/lib.png"
        assert not errors, errors
        browser.close()


def test_old_frame_opens_and_versions_are_pruned(hy):
    """a phase-1 frame (frame.json, render.png) still opens and its first Save is version 1; the server keeps the last 10 versions"""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    d = lib / "frames/251005-120000-old"; d.mkdir(parents=True)
    Image.new("RGB", (600, 400), (200, 40, 40)).save(d / "render.png")
    (d / "frame.json").write_text(json.dumps({"version": 1, "name": "Старый", "size": [600, 400], "background": "#ffffff", "order": "bottom-to-top",
        "layers": [{"id": "p1_ab", "kind": "pic", "name": "a", "path": "pics/a.png", "crop": None, "x": 0, "y": 0, "w": 600, "h": 400, "rot": 0, "flip": [False, False],
                    "visible": True, "opacity": 100, "fill": 100, "blend": "source-over", "clip": False, "locked": True, "locks": {"pixels": True}}]}))
    b = board(state); b["items"] = {"f1": {"type": "imgframe", "x": 0, "y": 0, "w": 600, "h": 400, "name": "Старый", "doc": "frames/251005-120000-old/frame.json",
        "render": "frames/251005-120000-old/render.png", "rv": 1, "size": [600, 400], "pics": ["pics/a.png"]}, "b1": ITEMS["b1"], "a1": {**ITEMS["a1"], "x": 2000}}
    (state / "boards/main.json").write_text(json.dumps(b))
    with sync_playwright() as p:
        browser, page, errors = open_board(p, port)
        page.evaluate("fit()"); page.wait_for_timeout(1500)
        page.dblclick(".plg[data-id='f1']")
        fr = editor(page)
        assert fr.evaluate("() => __ed.root.length") == 1 and fr.evaluate("() => __ed.VERSION") == 0
        fr.evaluate("() => __ed.canvasSize(600, 500, 0, 0)")
        fr.click("#bSave")
        page.wait_for_function("() => board.items.f1.v === 1", timeout=60000); closed(page)
        assert page.evaluate("() => board.items.f1.doc") == "frames/251005-120000-old/frame.1.json"
        assert (d / "frame.json").is_file() and (d / "render.png").is_file() and (d / "render.1.png").is_file()
        assert not errors, errors
        browser.close()
    # 13 versions on disk, a layer file only version 2 used, one all of them use: prune keeps 10, and what they need
    for n in range(2, 13):
        (d / f"frame.{n}.json").write_text(json.dumps({"v": n, "render": f"frames/251005-120000-old/render.{n}.png", "layers": [{"kind": "paint", "file": f"frames/251005-120000-old/layers/x.{n}.png"}, {"kind": "paint", "file": "frames/251005-120000-old/layers/keep.png"}]}))
        Image.new("RGB", (8, 8)).save(d / f"render.{n}.png"); (d / "layers").mkdir(exist_ok=True); Image.new("RGB", (8, 8)).save(d / f"layers/x.{n}.png")
    Image.new("RGB", (8, 8)).save(d / "layers/keep.png")
    code, body = post(port, "/api/plugin/frames/versions", json.dumps({"dir": "frames/251005-120000-old"}).encode(), "application/json")
    assert code == 200 and json.loads(body) == {"versions": list(range(13)), "next": 13}
    code, body = post(port, "/api/plugin/frames/prune", json.dumps({"dir": "frames/251005-120000-old", "keep": 10}).encode(), "application/json")
    assert code == 200, body
    assert json.loads(body)["kept"] == list(range(3, 13))
    names = {str(x.relative_to(d)) for x in d.rglob("*") if x.is_file()}
    assert "frame.json" not in names and "render.png" not in names and "frame.1.json" not in names and "frame.2.json" not in names and "layers/x.2.png" not in names
    assert {"frame.3.json", "render.3.png", "layers/x.3.png", "layers/keep.png", "frame.12.json"} <= names
    assert (lib / "pics/a.png").is_file()
    for bad in ("frames/../pics", "pics", "frames/a/b", "../frames/x"):
        code, _ = post(port, "/api/plugin/frames/prune", json.dumps({"dir": bad}).encode(), "application/json"); assert code == 400, bad


def test_hy_frame_commands(hy):
    """hy.py do 'frame …': one frame of named pictures, its layers, a new name (a new version), each picture its own frame, unframe"""
    port, lib, state = hy
    run = lambda *a: subprocess.run([sys.executable, str(REPO / "review/hy.py"), *a, "--port", str(port), "--page", "main", "--quiet"], capture_output=True, text=True, timeout=120)
    out = run("do", 'frame a1 b1 name="Тест"')
    assert out.returncode == 0 and "«Тест» 1000×450 px из 2" in out.stdout, out.stdout + out.stderr
    b = board(state); fid, card = next((k, it) for k, it in b["items"].items() if it.get("type") == "imgframe")
    assert "a1" not in b["items"] and card["size"] == [1000, 450] and (lib / card["render"]).is_file() and Image.open(lib / card["render"]).size == (1000, 450)
    rev = b["revision"]
    out = run("do", "frame layers Тест")
    assert out.returncode == 0 and "pic «a» 600×400 @ 0,0 pics/a.png" in out.stdout and board(state)["revision"] == rev, out.stdout + out.stderr
    out = run("do", 'frame rename Тест "Новое имя"')
    assert out.returncode == 0 and "«Тест» → «Новое имя» (версия 2)" in out.stdout, out.stdout + out.stderr
    card = board(state)["items"][fid]
    assert card["name"] == "Новое имя" and card["doc"].endswith("frame.2.json") and json.loads((lib / card["doc"]).read_text())["name"] == "Новое имя"
    out = run("do", "frame unframe Новое")
    assert out.returncode == 0 and "2 картинок снова" in out.stdout, out.stdout + out.stderr
    b = board(state); assert b["items"]["a1"]["x"] == 0 and b["items"]["b1"]["x"] == 700 and fid not in b["items"]
    out = run("do", "frame each a1 b1 g1")
    assert out.returncode == 0 and out.stdout.count("frame f") == 3, out.stdout + out.stderr
    sizes = sorted(it["size"] for it in board(state)["items"].values() if it.get("type") == "imgframe")
    assert sizes == [[300, 450], [600, 400], [2400, 1600]], sizes


def test_server_whitelist_and_library(hy):
    port, lib, state = hy
    for bad in ("frames/x/../../evil.png", "frames/x/evil.txt", "frames/x/render.jpg", "frames/a/b/c.png", "frames/x/masks/../m.png",
                "frames/../pics/a.png", "pics/a.png", "frames/x/layers/a.b.png", "/frames/x/render.png", "frames/x/frame.v2.json", "frames/x/render.2.png.png"):
        code, _ = post(port, "/api/file?p=" + urllib.request.quote(bad), b"\x89PNG not really")
        assert code == 400, bad
    assert sha(lib / "pics/a.png") and not (lib / "evil.png").exists()
    png = io.BytesIO(); Image.new("RGBA", (8, 8), (255, 0, 0, 128)).save(png, "PNG")
    for good in ("frames/260101-000000-abc/render.png", "frames/260101-000000-abc/render.4.png", "frames/260101-000000-abc/masks/p1_x.png",
                 "frames/260101-000000-abc/layers/p2_y.png", "frames/260101-000000-abc/layers/p2_y.12.png"):
        code, body = post(port, "/api/file?p=" + urllib.request.quote(good), png.getvalue())
        assert code == 200, body
        assert (lib / good).read_bytes() == png.getvalue()   # binary safe
    code, _ = post(port, "/api/file?p=frames/260101-000000-abc/frame.json", b"{not json")
    assert code == 400
    code, _ = post(port, "/api/file?p=frames/260101-000000-abc/frame.3.json", b'{"v": 3}')
    assert code == 200
    # the frames' files are not library pictures
    items = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/items"))
    assert not [i for i in items if i["path"].startswith("frames/")] and {i["path"] for i in items} == {"pics/a.png", "pics/b.jpg", "pics/big.jpg", "pics/lib.png"}


def test_plugin_routes(hy):
    port, lib, state = hy
    im = Image.new("RGB", (256, 256), (250, 250, 250)); ImageDraw.Draw(im).ellipse([70, 50, 190, 210], fill=(20, 20, 30))
    buf = io.BytesIO(); im.save(buf, "PNG"); url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    code, body = post(port, "/api/plugin/frames/subject", json.dumps({"image": url}).encode(), "application/json")
    if code == 503: pytest.skip("macOS Vision is not here: " + body.decode())
    assert code == 200, body
    m = Image.open(io.BytesIO(base64.b64decode(json.loads(body)["mask"].split(",", 1)[1]))).convert("L")
    assert m.size == (256, 256) and m.getpixel((128, 130)) > m.getpixel((10, 10))   # the dark disc is the subject
    code, body = post(port, "/api/plugin/frames/nope", b"{}", "application/json")
    assert code == 404 and "error" in json.loads(body)
    code, body = post(port, "/api/plugin/nobody/subject", b"{}", "application/json")
    assert code == 404
    code, body = post(port, "/api/plugin/frames/subject", b"not json", "application/json")
    assert code == 400


@pytest.mark.skipif(not LAMA.is_file(), reason="no LaMa model on this Mac")
def test_plugin_inpaint_lama(hy):
    port, lib, state = hy
    im = Image.new("RGB", (192, 192), (40, 120, 200)); ImageDraw.Draw(im).rectangle([80, 80, 112, 112], fill=(255, 255, 255))
    mk = Image.new("L", (192, 192), 0); ImageDraw.Draw(mk).rectangle([76, 76, 116, 116], fill=255)
    du = lambda x: "data:image/png;base64," + base64.b64encode((lambda b: (x.save(b, "PNG"), b.getvalue())[1])(io.BytesIO())).decode()
    code, body = post(port, "/api/plugin/frames/inpaint", json.dumps({"image": du(im), "mask": du(mk)}).encode(), "application/json")
    assert code == 200, body
    out = Image.open(io.BytesIO(base64.b64decode(json.loads(body)["image"].split(",", 1)[1]))).convert("RGB")
    r, g, b = out.getpixel((96, 96))
    assert b > r + 60 and b > 120   # the white square is filled with the blue around it


@pytest.mark.skipif(not LAMA.is_file(), reason="no LaMa model on this Mac")
def test_lama_keeps_strong_colours():
    """on a strong colour the fill keeps the colour around it (owner 2026-10-05: on burgundy the healed spot came out lighter): mean Lab of
    the filled disc against the same disc of a flat saturated purple with a little grain"""
    sys.path.insert(0, str(HERE / "inpaint")); import lama
    import numpy as np
    rng = np.random.default_rng(1)
    im = np.clip(np.array([110, 20, 120], np.float32) + rng.normal(0, 3, (384, 384, 3)), 0, 255).astype(np.uint8)
    yy, xx = np.mgrid[:384, :384]; hole = np.hypot(xx - 192, yy - 192) < 50
    src = im.copy(); src[hole] = (240, 240, 240)   # a light spot to heal
    out = lama.fill(src, hole.astype(np.uint8) * 255)
    want, got = im[hole].astype(float).mean(0), out[hole].astype(float).mean(0)
    assert np.abs(want - got).max() < 8, (want, got)
