"""The subject of a picture, found by macOS itself (Vision's foreground instance mask, the «lift subject» of Photos and Preview; owner
2026-10-05: «как будем вырезать белый фон, smart маска»). On this Mac, no network, 0.3–0.5 s for a 1600 px picture.

  from subject import mask
  m = mask(png_bytes)   # H × W uint8, 255 = the subject, soft at the edge
"""
import io

import numpy as np
import Quartz
import Vision
from Foundation import NSData
from PIL import Image


def mask(data):
    src = Quartz.CGImageSourceCreateWithData(NSData.dataWithBytes_length_(data, len(data)), None)
    cg = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, {})
    req = Vision.VNGenerateForegroundInstanceMaskRequest.alloc().init()
    ok, err = handler.performRequests_error_([req], None)
    if not ok:
        raise RuntimeError(str(err))
    res = req.results()
    w, h = Quartz.CGImageGetWidth(cg), Quartz.CGImageGetHeight(cg)
    if not res:
        return np.zeros((h, w), np.uint8)
    r = res[0]
    buf, err = r.generateScaledMaskForImageForInstances_fromRequestHandler_error_(r.allInstances(), handler, None)
    if buf is None:
        raise RuntimeError(str(err))
    ci = Quartz.CIImage.imageWithCVPixelBuffer_(buf)
    ctx = Quartz.CIContext.contextWithOptions_(None)
    out = ctx.createCGImage_fromRect_(ci, ci.extent())
    rep = Quartz.NSBitmapImageRep.alloc().initWithCGImage_(out) if hasattr(Quartz, "NSBitmapImageRep") else None
    if rep is None:
        from AppKit import NSBitmapImageRep
        rep = NSBitmapImageRep.alloc().initWithCGImage_(out)
    png = bytes(rep.representationUsingType_properties_(4, {}))   # 4 = PNG
    m = Image.open(io.BytesIO(png)).convert("L")
    if m.size != (w, h):
        m = m.resize((w, h), Image.BILINEAR)
    return np.asarray(m)


if __name__ == "__main__":
    import sys, time
    t = time.time(); m = mask(open(sys.argv[1], "rb").read()); print(m.shape, m.dtype, int(m.mean()), f"{(time.time() - t) * 1000:.0f} ms")
    Image.fromarray(m).save(sys.argv[2])
