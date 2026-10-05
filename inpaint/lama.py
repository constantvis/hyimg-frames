"""Content-aware fill with LaMa (owner 2026-10-05: «давай качай и прикручивай»): the open LaMa inpainting model, run on this Mac with
onnxruntime, no network. The model takes a 512 × 512 picture and a mask; a larger picture is filled in a crop around the mask, scaled to
512, and only the masked pixels are put back (feathered), so the rest of the picture keeps its full resolution.

  from lama import fill
  out = fill(rgb, mask)   # rgb: H × W × 3 uint8, mask: H × W uint8 (255 = fill); returns H × W × 3 uint8

The model (lama_fp32.onnx, 208 MB, Apache-2.0, huggingface.co/Carve/LaMa-ONNX) lives in ~/Library/Caches/Hyimg/models/lama/.
"""
import os
import threading
import time

import numpy as np
from PIL import Image, ImageFilter

MODEL = os.path.expanduser(os.environ.get("HYIMG_LAMA", "~/Library/Caches/Hyimg/models/lama/lama_fp32.onnx"))
SIZE = 512
_sess, _lock = None, threading.Lock()


def session():
    global _sess
    with _lock:
        if _sess is None:
            import onnxruntime as ort
            if not os.path.exists(MODEL):
                raise FileNotFoundError(f"нет модели LaMa: {MODEL}")
            o = ort.SessionOptions(); o.log_severity_level = 3
            _sess = ort.InferenceSession(MODEL, o, providers=["CPUExecutionProvider"])
        return _sess


def _box(mask, margin_min=64):
    ys, xs = np.nonzero(mask)
    if not len(ys):
        return None
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    m = max(margin_min, int(max(y1 - y0, x1 - x0) * 0.6))   # enough of the surroundings for the model to read
    h, w = mask.shape
    y0, y1, x0, x1 = max(0, y0 - m), min(h, y1 + m), max(0, x0 - m), min(w, x1 + m)
    side = max(y1 - y0, x1 - x0)   # square, so the picture is not stretched on the way to 512 × 512
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    y0, x0 = max(0, min(h - side, cy - side // 2)), max(0, min(w - side, cx - side // 2))
    return y0, min(h, y0 + side), x0, min(w, x0 + side)


def _blur(a, r):
    """box blur of radius r along both axes (H x W or H x W x C, float), edges clamped"""
    if r < 1: return a
    for ax in (0, 1):
        n = a.shape[ax]; pad = [(0, 0)] * a.ndim; pad[ax] = (r + 1, r); p = np.pad(a, pad, mode="edge"); c = np.cumsum(p, axis=ax)
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=ax); lo = np.take(c, np.arange(0, n), axis=ax)
        a = (hi - lo) / (2 * r + 1)
    return a


def _nconv(val, w, r):
    """normalised convolution: the mean of val over the pixels where w is set, near each pixel (three box passes, close to a gaussian)"""
    v, k = val * w[..., None], w.astype(np.float64)
    for _ in range(3): v, k = _blur(v, r), _blur(k, r)
    return v / np.maximum(k, 1e-6)[..., None]


def seam_match(src, out, hole):
    """the fill takes the colour of its surroundings (owner 2026-10-05: on burgundy the healed spot came out lighter than around it).
    LaMa keeps the known pixels as they are, but inside the hole it leans to its prior: on strong colours it comes out greyer, which
    reads as lighter (measured on burgundy-03 under the mockup's colour tint: chroma -3 to -4). Inside the hole the surroundings give a
    smooth estimate (the band around the hole, spread inwards); the fill keeps its own shapes and detail and moves, as a whole, by the
    difference of the two means (at most 14 levels a channel), and only where the band around is calm (no edges or patterns in it)."""
    hole = hole.astype(bool)
    n = int(hole.sum())
    if n < 9: return out
    size = n ** .5; t = int(max(3, min(40, round(size * .15))))
    big = Image.fromarray(hole.astype(np.uint8) * 255)
    ring = (np.asarray(big.filter(ImageFilter.MaxFilter(2 * t + 1))) > 127) & ~hole
    if not ring.any(): return out
    s, o = src.astype(np.float64), out.astype(np.float64)
    est = _nconv(s, ring, int(max(3, size * .3)))
    # only where the surroundings are calm: around an edge or a pattern the estimate means little and LaMa's own fill stands
    spread = float(np.sqrt(((s[ring] - est[ring]) ** 2).sum(1).mean()))
    calm = float(np.clip(1 - (spread - 6) / 14, 0, 1))
    shift = np.clip(est[hole].mean(0) - o[hole].mean(0), -14, 14) * calm
    o[hole] += shift
    return np.clip(o, 0, 255).astype(np.uint8)


def fill(rgb, mask, feather=2):
    mask = (np.asarray(mask) > 127).astype(np.uint8) * 255
    rgb = np.asarray(rgb, np.uint8)[..., :3]
    b = _box(mask)
    if b is None:
        return rgb.copy()
    y0, y1, x0, x1 = b
    crop, cm = rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    h, w = cm.shape
    # the mask a little wider before the model: the soft edge of a stroke must not leave a rim of the old pixels
    cm_in = np.asarray(Image.fromarray(cm).filter(ImageFilter.MaxFilter(5)))
    img = np.asarray(Image.fromarray(crop).resize((SIZE, SIZE), Image.BICUBIC), np.float32) / 255
    mk = (np.asarray(Image.fromarray(cm_in).resize((SIZE, SIZE), Image.NEAREST), np.float32) > 127).astype(np.float32)
    out = session().run(None, {"image": img.transpose(2, 0, 1)[None], "mask": mk[None, None]})[0][0]
    out = out.transpose(1, 2, 0)
    if out.max() <= 1.5:   # some exports give 0..1, this one gives 0..255
        out = out * 255
    out = np.asarray(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((w, h), Image.BICUBIC))
    out = seam_match(crop, out, cm_in > 127).astype(np.float32)
    a = np.asarray(Image.fromarray(cm_in).filter(ImageFilter.GaussianBlur(feather)), np.float32)[..., None] / 255
    res = rgb.copy()
    res[y0:y1, x0:x1] = np.clip(out * a + crop.astype(np.float32) * (1 - a), 0, 255).astype(np.uint8)
    return res


if __name__ == "__main__":   # python3 lama.py picture.jpg mask.png out.png
    import sys
    im = np.asarray(Image.open(sys.argv[1]).convert("RGB")); mk = np.asarray(Image.open(sys.argv[2]).convert("L"))
    t = time.time(); r = fill(im, mk); print(f"{(time.time() - t) * 1000:.0f} ms")
    Image.fromarray(r).save(sys.argv[3])
