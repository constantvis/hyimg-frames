"""HTML frames on a real canvas (Chromium), a disposable library. HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_frames.py"""
import json, os, socket, subprocess, sys, time, urllib.request, uuid
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent.parent
REPO = Path(os.environ.get("HYIMG_REPO", HERE.parent / "hyimg"))   # side by side in one folder
PAGE = """<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head>
<body><h1 id="t">Привет</h1><button id="b" onclick="document.getElementById('t').textContent = 'Нажато ' + innerWidth">Нажми</button>
<script>document.body.dataset.w = innerWidth</script></body></html>"""


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


@pytest.fixture
def hy(tmp_path, request):
    # the interface's language (owner 2026-10-06: «make 2 versions, Russian and English»): the app's setting cv.lang in its settings
    # file; these tests read the Russian words, an English test asks for "en" (indirect parametrize), which is the app's default
    lang = getattr(request, "param", "ru")
    (tmp_path / "settings.json").write_text(json.dumps({"cv.lang": "ru"} if lang == "ru" else {}))
    lib, state, plugins = tmp_path / "lib", tmp_path / "state", tmp_path / "plugins"
    (lib / "html/demo").mkdir(parents=True); (lib / "html/demo/index.html").write_text(PAGE)
    (lib / "html/demo/style.css").write_text("body { background: rgb(10, 120, 200); color: white; } h1 { font-size: 64px; }")
    (state / "boards").mkdir(parents=True); plugins.mkdir(); (plugins / "frames").symlink_to(HERE)
    items = {"h1": {"type": "htmlframe", "src": "html/demo/index.html", "vw": 1440, "x": 0, "y": 0, "w": 720, "h": 450}}
    (state / "boards/main.json").write_text(json.dumps({"items": items, "groups": {}, "revision": 1}))
    port = free_port()
    env = {k: v for k, v in os.environ.items() if not k.startswith(("HYIMG_", "REVIEW_"))}
    env.update(HYIMG_LIBRARY_ROOT=str(lib), HYIMG_STATE_ROOT=str(state), HYIMG_PROJECT_ID=str(uuid.uuid4()), HYIMG_PLUGINS=str(plugins), HYIMG_SETTINGS=str(tmp_path / "settings.json"), PYTHONDONTWRITEBYTECODE="1")
    log = open(tmp_path / "server.log", "w+")
    proc = subprocess.Popen([sys.executable, str(REPO / "review/server.py"), str(port)], env=env, stdout=log, stderr=log)
    for _ in range(100):
        try: urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1); break
        except OSError: time.sleep(0.1)
    try:   # the server goes even when the test fails or is interrupted
        yield port, lib, state
    finally:
        proc.terminate(); proc.wait(5); log.close()


def wait(cond, t=60):
    for _ in range(int(t * 10)):
        if cond(): return True
        time.sleep(0.1)
    raise AssertionError("timed out")


def test_frame_still_live_sizes_and_agent(hy):
    port, lib, state = hy
    # the page is served by its path: its css loads by a relative link; frame pages stay out of the library
    css = urllib.request.urlopen(f"http://127.0.0.1:{port}/lib/html/demo/style.css").read()
    assert b"rgb(10, 120, 200)" in css
    assert json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/items")) == []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1500, "height": 950})
        errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{port}/canvas.html")
        page.wait_for_function("() => typeof PLGST !== 'undefined' && PLGST.some(p => p.name === 'frames' && p.ok)", timeout=20000)
        # at rest: a still made in Chromium at the frame's viewport, with the page's css and scripts
        still = lib / "html/demo/.stills/index-1440x900.png"
        wait(lambda: still.is_file())
        from PIL import Image
        im = Image.open(still); assert im.size == (1440, 900) and im.convert("RGB").getpixel((700, 880))[:3] == (10, 120, 200)
        # the card shows its still at the size it has on screen (Hyimg 2026-10-08): 720 px wide here, the server's 1280 px thumbnail of it;
        # far out the 640 one, close in the still itself (a 1440 px picture for a card 50 px wide made the far zoom lag)
        nat = "() => { const i = document.querySelector('.plg[data-id=h1] img.hf'); return i && i.complete && decodeURIComponent(i.src).includes('.stills/index-1440x900.png') ? i.naturalWidth : 0 }"
        page.wait_for_function(f"({nat})() === 1280", timeout=30000)
        cam0 = page.evaluate("() => ({ ...cam })")
        page.evaluate("() => { cam = { x: -100, y: -100, z: 0.15 }; render(); }"); page.wait_for_function(f"({nat})() === 640", timeout=15000)
        page.evaluate("() => { cam = { x: 0, y: 0, z: 2.2 }; render(); }"); page.wait_for_function(f"({nat})() === 1440", timeout=15000)
        page.evaluate("c => { cam = c; render(); }", cam0); page.wait_for_function(f"({nat})() === 1280", timeout=15000)
        assert page.locator(".plg[data-id=h1] .hb").inner_text() == "HTML · 1440×900"
        # live: the page scrolls and clicks inside the card
        page.dblclick(".plg[data-id=h1]")
        fr = page.frame_locator(".plg[data-id=h1] iframe.hfl")
        fr.locator("#b").click()
        assert fr.locator("#t").inner_text() == "Нажато 1440"
        # a device size: the page gets 390 css px, the card keeps its width and takes the phone's shape
        page.click(".hfbar [data-pre='390x844']")
        page.wait_for_function("() => board.items.h1.vw === 390 && Math.abs(board.items.h1.h - 720 * 844 / 390) < 1")
        page.wait_for_function("() => { const f = document.querySelector('.plg[data-id=h1] iframe.hfl'); return f.contentWindow.innerWidth === 390 }")
        # a typed size, then «Готово»: the viewport stays, a new still is made at it
        page.fill(".hfbar [data-w]", "600"); page.press(".hfbar [data-w]", "Enter")
        page.wait_for_function("() => board.items.h1.vw === 600")
        vh = page.evaluate("() => Math.round(board.items.h1.vw * board.items.h1.h / board.items.h1.w)")
        page.click("hy-studio-actions [data-a=done]")
        assert not page.locator(".plg[data-id=h1] iframe").count()
        wait(lambda: (lib / f"html/demo/.stills/index-600x{vh}.png").is_file())
        assert not errors, errors
        browser.close()
    # an agent puts a frame with hy.py
    out = subprocess.run([sys.executable, str(REPO / "review/hy.py"), "do", "htmlframe html/demo/index.html x=0 y=900 w=400 vw=390 vh=844", "--port", str(port)],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr + out.stdout
    b = json.loads((state / "boards/main.json").read_text())
    f = [i for i in b["items"].values() if i.get("type") == "htmlframe" and i["vw"] == 390]
    assert f and abs(f[0]["h"] - 400 * 844 / 390) < 1
