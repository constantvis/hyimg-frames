"""What the image studio's tests of masks, layers, selections, menus and the clipboard share (owner 2026-10-07): the studio open on a frame of
two pictures (a: 600 × 400 at 0,0, b: 300 × 450 at 700,0 in a 1000 × 450 document), the page's own pixels and the mask's, real clicks and keys.
"""
import pytest

from test_imgframe import WEBKIT, shot  # noqa: F401
from test_select_tool import open_editor

ENGINES = ["chromium", "webkit"]
# the composite as drawn (acc), at a point of the document: [r, g, b, a]
PX = """([x, y]) => { const { V, acc } = __ed, s = devicePixelRatio || 1, c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d'); g.drawImage(acc, Math.round((V.x + x * V.s) * s), Math.round((V.y + y * V.s) * s), 1, 1, 0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data]; }"""
# a layer's mask alpha at a share of its canvas
MASKA = """([id, fx, fy]) => { const m = __ed.byId(id).mask.c, c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d'); g.drawImage(m, Math.floor(fx * m.width), Math.floor(fy * m.height), 1, 1, 0, 0, 1, 1); return g.getImageData(0, 0, 1, 1).data[3]; }"""
# the mask's whole alpha at 32 × 32 samples, for comparing two masks
MASKGRID = """(id) => { const m = __ed.byId(id).mask.c, c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
  g.drawImage(m, 0, 0, 32, 32); const d = g.getImageData(0, 0, 32, 32).data, o = []; for (let i = 3; i < d.length; i += 4) o.push(d[i]); return o; }"""
PIXELS = """() => { const o = []; (function rec(l) { for (const n of l) { if (n.children) rec(n.children); else if (n.type === 'pixel') o.push(n.id); } })(__ed.root); return o; }"""


def start(p, port, engine):
    if engine == "webkit" and not WEBKIT: pytest.skip("no Playwright WebKit")
    browser, page, fr, errors = open_editor(p, port, engine)
    fr.wait_for_timeout(900)
    return browser, page, fr, errors


def settle(fr, ms=250): fr.wait_for_timeout(ms)


def at(page, fr, x, y):
    """a point of the document in the page's coordinates"""
    off = page.evaluate("() => { const w = document.querySelector('.ifed iframe').getBoundingClientRect(); return [w.left, w.top]; }")
    V = fr.evaluate("() => ({ x: __ed.V.x, y: __ed.V.y, s: __ed.V.s })")
    return off[0] + V["x"] + x * V["s"], off[1] + V["y"] + y * V["s"]


def center(fr, sel):
    b = fr.locator(sel).first.bounding_box(); return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def focus(page, fr):
    """the keyboard into the studio without touching anything: a click on the empty part of the Layers tabs"""
    x, y = center(fr, "#g2 .tabs .sp"); page.mouse.click(x, y); settle(fr, 80)


def pick(fr, id, mask=False):
    fr.evaluate(f"() => {{ __ed.S.ids = ['{id}']; __ed.S.anchor = '{id}'; __ed.S.editMask = {'true' if mask else 'false'}; __ed.refresh(); }}"); settle(fr, 120)


def rect_sel(fr, x0, y0, x1, y1):
    fr.evaluate(f"() => {{ const p = new Path2D(); p.rect({x0}, {y0}, {x1 - x0}, {y1 - y0}); __ed.commitSel(p, 'new'); }}")


def frame_tick(fr):
    """two animation frames: what the page draws next"""
    fr.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def labels(fr):
    """the open menu's items: [label, keys, grey reason or None]"""
    return fr.evaluate("""() => [...document.querySelectorAll('#menu [role=menuitem]')].map(b => [b.querySelector('.ml').childNodes[0].textContent.trim(),
      [...b.querySelectorAll('.mk kbd')].map(k => k.textContent).join(''), b.getAttribute('aria-disabled') === 'true' ? b.title : null])""")


def add_adj(fr, params="{ exposure: 1 }", mask=False):
    """a Raw Editor layer over the chosen one, chosen; with a mask that shows everything"""
    fr.evaluate(f"""() => {{ hyEdK.edit('x', () => {{ const n = hyEdK.adjNode('grade', {params}); hyEdK.insertAbove(hyEdK.one(), [n]);
      __ed.S.ids = [n.id]; __ed.S.editMask = false; }}); hyEdK.refresh(); {'hyEdK.addMask(false);' if mask else ''} }}""")
    return fr.evaluate("() => __ed.S.ids[0]")
