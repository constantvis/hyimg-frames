"""The frames plugin's server routes (owner 2026-10-05: the editor's content-aware fill and subject mask live in Hyimg's own server, not in
a dev server beside it). Hyimg loads this file by manifest.json "server" and serves each route at POST /api/plugin/<plugin>/<name>:

  POST .../inpaint {"image": "data:image/png;base64,…", "mask": "data:image/png;base64,…"} → {"image": "data:image/png;base64,…", "ms": 2900}
        LaMa (lama.py) on this Mac; without the model file: 503 {"error", "fallback": "local"}, and the editor fills by itself
  POST .../subject {"image": "data:…"} → {"mask": "data:image/png;base64,…" (white = the subject), "ms": 500}, macOS Vision (subject.py)
  POST .../versions {"dir": "frames/<stamp>"} → {"versions": [0, 1], "next": 2}: the saved versions of a frame
  POST .../prune {"dir": "frames/<stamp>", "keep": 10} → {"kept", "removed"}: older versions go, with the files only they used

A route is fn(body bytes, query dict) -> (status, content type, bytes). lama.py and subject.py are loaded under names of their own, so
nothing of this folder goes into the server's sys.path; the LaMa session stays loaded in the server's process after the first fill.
"""
import base64
import importlib.util
import io
import json
import os
import re
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
_MODS, _LOCK = {}, threading.Lock()


def _mod(name):
    with _LOCK:
        if name not in _MODS:
            spec = importlib.util.spec_from_file_location(f"hyimg_frames_{name}", os.path.join(HERE, name + ".py"))
            m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); _MODS[name] = m
        return _MODS[name]


def _json(status, obj):
    return status, "application/json", json.dumps(obj, ensure_ascii=False).encode()


def _img(url, mode):
    from PIL import Image
    return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[-1]))).convert(mode)


def _png_url(im):
    buf = io.BytesIO(); im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def inpaint(body, query=None):
    import numpy as np
    from PIL import Image
    lama = _mod("lama")
    if not os.path.exists(lama.MODEL):
        return _json(503, {"error": f"The LaMa model is missing: {lama.MODEL}", "fallback": "local"})
    try:
        d = json.loads(body); img = _img(d["image"], "RGBA"); mask = _img(d["mask"], "L").resize(img.size)
    except (ValueError, KeyError, TypeError, AttributeError, OSError) as ex:   # AttributeError: an image that is not a string (unit test, 2026-10-06)
        return _json(400, {"error": f"bad request: {ex}"})
    t = time.time()
    out = lama.fill(np.asarray(img)[..., :3], np.asarray(mask))
    ms = round((time.time() - t) * 1000)
    res = Image.fromarray(out).convert("RGBA"); res.putalpha(img.getchannel("A"))
    return _json(200, {"image": _png_url(res), "ms": ms})


def subject(body, query=None):
    from PIL import Image
    try:
        d = json.loads(body); data = base64.b64decode(d["image"].split(",", 1)[-1])
    except (ValueError, KeyError, TypeError, AttributeError) as ex:
        return _json(400, {"error": f"bad request: {ex}"})
    try:
        sub = _mod("subject")
    except ImportError as ex:   # Vision comes with pyobjc on a Mac; elsewhere the editor finds the subject by itself
        return _json(503, {"error": f"macOS Vision is not available: {ex}", "fallback": "local"})
    t = time.time(); m = sub.mask(data); ms = round((time.time() - t) * 1000)
    return _json(200, {"mask": _png_url(Image.fromarray(m)), "ms": ms})


# Versions of a frame (owner 2026-10-05: Save never overwrites, so undo on the board finds the version it goes back to). Each Save
# writes frame.<n>.json, render.<n>.png and the changed masks and painted layers as <id>.<n>.png; the card points to its version.
# A phase-1 frame (frame.json, render.png) is version 0.
VER = re.compile(r"frame(?:\.([0-9]{1,6}))?\.json")
KEEP = 10


def _frame_dir(d):
    """frames/<stamp> of the library, or ValueError: nothing outside a frame's own folder is listed or removed"""
    if not isinstance(d, str) or not re.fullmatch(r"frames/[A-Za-z0-9_-]+", d): raise ValueError(f"not a frame folder: {d!r}")
    root = os.environ.get("HYIMG_LIBRARY_ROOT") or getattr(sys.modules.get("config"), "W", None)   # the server's library (config.py)
    if not root: raise ValueError("no library root")
    full = os.path.realpath(os.path.join(root, d))
    if not full.startswith(os.path.realpath(os.path.join(root, "frames")) + os.sep): raise ValueError(d)
    return full


def _versions(full):
    out = {}
    for n in os.listdir(full) if os.path.isdir(full) else []:
        m = VER.fullmatch(n)
        if m: out[int(m.group(1) or 0)] = n
    return out


def _refs(doc):
    """the files a frame.json refers to: its render, the painted layers and the masks"""
    out = set()
    if doc.get("render"): out.add(doc["render"])
    def walk(ls):
        for l in ls or []:
            if l.get("file"): out.add(l["file"])
            if isinstance(l.get("mask"), dict) and l["mask"].get("file"): out.add(l["mask"]["file"])
            walk(l.get("children"))
    walk(doc.get("layers"))
    m = doc.get("mask")   # the master mask of the whole frame (owner 2026-10-06): its file and its baked look
    if isinstance(m, dict): out |= {m[k] for k in ("file", "show") if isinstance(m.get(k), str)}
    return out


def versions(body, query=None):
    """POST {"dir": "frames/<stamp>"} -> {"versions": [0, 1, 2], "next": 3}"""
    try: full = _frame_dir(json.loads(body or b"{}").get("dir"))
    except (ValueError, AttributeError) as ex: return _json(400, {"error": str(ex)})
    vs = sorted(_versions(full)); return _json(200, {"versions": vs, "next": (vs[-1] + 1) if vs else 1})


def prune(body, query=None):
    """POST {"dir": "frames/<stamp>", "keep": 10} -> {"kept": [...], "removed": [...]}: the newest versions stay with every file they
    refer to; older frame.<n>.json, their renders and the layer and mask files no kept version needs are removed, only in this folder"""
    try:
        d = json.loads(body or b"{}"); rel = d.get("dir"); full = _frame_dir(rel); keep = max(1, min(50, int(d.get("keep", KEEP))))
    except (ValueError, AttributeError, TypeError) as ex: return _json(400, {"error": str(ex)})
    vs = _versions(full); order = sorted(vs); kept, old = order[-keep:], order[:-keep]
    need = set()
    for n in kept:
        try: need |= _refs(json.load(open(os.path.join(full, vs[n]), encoding="utf-8")))
        except (OSError, ValueError, AttributeError, TypeError): pass   # a json that is not a frame's object: as an unreadable one
        need.add(f"{rel}/render.png" if n == 0 else f"{rel}/render.{n}.png")
    removed = []
    def rm(name):
        p = os.path.join(full, name)
        # the master mask's files stay (owner 2026-10-06): a card's mask, pasted onto pictures, points to them from anywhere on the boards
        if f"{rel}/{name}" in need or not os.path.isfile(p) or name.startswith("masks/main_mask"): return
        os.remove(p); removed.append(name)
    for n in old:
        rm(vs[n]); rm("render.png" if n == 0 else f"render.{n}.png")
    if old:   # the layers and masks only an old version used
        for sub in ("layers", "masks"):
            sd = os.path.join(full, sub)
            for name in os.listdir(sd) if os.path.isdir(sd) else []:
                if re.fullmatch(r"[A-Za-z0-9_-]+(\.[0-9]{1,6})?\.png", name): rm(f"{sub}/{name}")
    return _json(200, {"kept": kept, "removed": removed})


ROUTES = {"inpaint": inpaint, "subject": subject, "versions": versions, "prune": prune}
