"""The image studio in Russian (owner 2026-10-07: the studio stayed English on a Russian board while the board, the library, Raw Editor and
the 3D studio are bilingual). Its words come from lang.js through editor/i18n.js (hyEdTr). On a Russian board every panel, tab, menu, the
Actions palette, the settings, a dialog, the tool rail's and the options bar's words and every tooltip show no English word but the names
the app keeps (Raw Editor, Hyimg, PSD, PNG, RGB, units, key names); no word is cut with … at the panel's width. Dark and light.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_editor_ru.py
  FRAMES_SHOTS=<folder> also saves the panels' screenshots
"""
import re

import pytest

from test_imgframe import hy, shot  # noqa: F401  (hy is the fixture)
from test_select_tool import open_editor

# names and signs that stay as they are in Russian
KEEP = re.compile(r"Raw Editor|Image Studio|3D Studio|Dev Studio|HTML|Hyimg|PSD|PNG|JPE?G|RGB|HSL|LaMa|px|esc|Esc|Enter|Shift|Alt|Option|Cmd|Ctrl|Delete|Backspace|Space|Tab|°")
# what the editor shows now: visible words and the tooltips of what is visible, with where they are and whether they are cut; the owner's
# own names (the layers', the board's and the project's in the crumb) are data, not the interface
SCAN = r"""(root) => {
  const out = [], vis = el => { if (!el.getClientRects().length) return false; for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; } return true; };
  const where = el => { const p = []; for (let e = el; e && e !== document.body && p.length < 3; e = e.parentElement)
    p.unshift(e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : '')); return p.join(' > '); };
  const roots = root ? [...document.querySelectorAll(root)] : [document.body];
  for (const r of roots) { const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const t = w.currentNode, el = t.parentElement, s = t.nodeValue.trim();
    if (!s || !el || el.closest('script, style, #rows .nm, #rows input, .lname, kbd, .kc, #dlg input, #cProj, #cFolder') || !vis(el)) continue;
    const cut = (() => { for (let e = el; e && e !== document.body; e = e.parentElement) { const c = getComputedStyle(e);
      if (c.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) return true; if (c.display !== 'inline') break; } return false; })();
    out.push({ s, at: where(el), cut }); } }
  for (const el of roots.flatMap(r => [r, ...r.querySelectorAll('[title], [data-tip], [aria-label], [placeholder]')])) { if (!vis(el) || el.closest('#cProj, #cFolder')) continue;
    for (const a of ['title', 'data-tip', 'aria-label', 'placeholder']) { const v = el.getAttribute(a); if (v && v.trim()) out.push({ s: v.trim(), at: where(el) + ' @' + a, cut: false }); } }
  return out; }"""


def english(items):
    return sorted({f"{x['at']}: «{x['s']}»" for x in items if re.search(r"[A-Za-z]{2,}", KEEP.sub("", x["s"]))})


def cut(items):
    return sorted({f"{x['at']}: «{x['s']}»" for x in items if x["cut"]})


@pytest.mark.parametrize("theme", ["dark", "light"])
def test_the_image_studio_speaks_russian(hy, theme):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_editor(p, port, "chromium")
        page.evaluate(f"() => {{ document.documentElement.dataset.theme = '{theme}'; }}"); page.wait_for_timeout(500)
        assert fr.evaluate("() => hyEdTr.lang") == "ru"
        seen = []
        look = lambda name: (fr.wait_for_timeout(450), seen.extend(fr.evaluate(SCAN)), shot(page, f"ru-{theme}-{name}.png"))   # noqa: E731
        fr.evaluate("() => __ed.S.ids.length || __ed.selectAll && __ed.selectAll()")
        for tab in ("props", "adj", "hist", "gen"):
            fr.evaluate(f"() => __ed.showPanel('{tab}')"); look(f"panel-{tab}")
        fr.evaluate("() => __ed.showPanel('chan')"); look("panel-chan")
        fr.evaluate("() => __ed.showPanel('layers')"); look("panel-layers")
        for tool in ("brush", "marquee", "wand", "move", "patch", "pick", "hand", "select"):
            fr.evaluate(f"() => __ed.setTool('{tool}')")   # the tools are in the board's dock since round 11 D3 (studiodock.js)
            fr.wait_for_timeout(150); seen.extend(fr.evaluate(SCAN))
        look("tool-select")
        fr.click("#g1 .gm"); look("menu-panels"); page.keyboard.press("Escape")
        fr.evaluate("() => __ed.openActs()"); look("actions"); fr.evaluate("() => __ed.closeActs()")
        assert fr.evaluate("() => !document.getElementById('bset').getClientRects().length")   # no gear in a Studio (owner 2026-10-09)
        fr.click("#view", position={"x": 700, "y": 300}); page.keyboard.press("Alt+Meta+KeyC")   # Canvas Size… (over the picture: the options ride over the dock)
        fr.wait_for_selector("#dlgw.on", timeout=5000); look("dialog"); page.keyboard.press("Escape")
        fr.evaluate("() => __ed.frameMenu(220, 60)"); look("frame-menu"); page.keyboard.press("Escape")
        seen.extend(page.evaluate(SCAN, "#dock, #crumb"))   # the board's dock and crumb while the studio is open
        assert seen and not errors, errors
        assert english(seen) == [], "English in the Russian studio:\n" + "\n".join(english(seen))
        assert cut(seen) == [], "words cut with … at the panel's width:\n" + "\n".join(cut(seen))
        browser.close()
