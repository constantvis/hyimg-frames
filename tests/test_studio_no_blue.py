"""Image Studio has no board blue left (owner 2026-10-09). On «Close without saving?» the white Discard: «почему здесь кнопка до сих пор
белая? Она должна быть такого цвета, в каком режиме мы сейчас находимся»; and the blue «1 step» note of the History while in the studio.
While the studio is open Hyimg's switch puts its colour on the board's root (hyimg ui/modes.js: data-studio, --hy-studio), so the board's
--sel and the notes' info colour are the purple; the studio's page has its own purple (editor/index.html). The test walks every visible
element of both windows (and their ::before and ::after) with a layer picked, a checked box, the History's «1 step» note up and the
dialog open, and finds no computed colour equal to a board blue; the dialog's Discard is filled with the purple, white words, Cancel as it
was. Back on the board the selection is blue again. Chromium, dark.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_studio_no_blue.py
"""
from test_imgframe import closed, hy  # noqa: F401  (hy is the fixture)
from test_studio_dock import open_studio

# the board's blues: the selection (--sel dark #3b82f6, light #2563eb) and the notes' info (#0a84ff, light #007aff), any alpha, in the two
# forms Chromium gives a computed colour (rgb() and, from color-mix, color(srgb …))
WALK = """() => {
  const BLUE = [[59, 130, 246], [37, 99, 235], [10, 132, 255], [0, 122, 255]];
  const rgbs = s => [...s.matchAll(/rgba?\\(([^)]*)\\)/g)].map(m => m[1].split(/[\\s,\\/]+/).filter(Boolean).slice(0, 3).map(Number))
    .concat([...s.matchAll(/color\\(srgb ([^)]*)\\)/g)].map(m => m[1].split(/[\\s\\/]+/).filter(Boolean).slice(0, 3).map(x => +x * 255)));
  const blue = s => rgbs(s).some(c => BLUE.some(b => b.every((x, i) => Math.abs(x - c[i]) < 2.5)));
  const seen = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const s = getComputedStyle(e); if (s.opacity === '0' || s.visibility === 'hidden') return false; } return true; };
  const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 3).map(c => '.' + c).join('');
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight || !seen(el)) continue;
    const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || el instanceof SVGElement;
    for (const ps of [null, '::before', '::after']) {
      const s = getComputedStyle(el, ps); if (ps && (s.content === 'none' || s.content === 'normal')) continue;
      const props = ['background-color', 'background-image', 'box-shadow', 'fill', 'stroke'];
      if (text || ps) props.push('color');
      if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth)) props.push('outline-color');
      for (const sd of ['top', 'right', 'bottom', 'left']) if (parseFloat(s.getPropertyValue(`border-${sd}-width`))) props.push(`border-${sd}-color`);
      for (const p of props) { const v = s.getPropertyValue(p); if (v && blue(v)) out.push([name(el) + (ps || ''), p, v]); }
    }
  }
  return out;
}"""
PROBE = """([v, prop]) => { const p = document.createElement('i'); p.style.setProperty(prop, v); document.body.append(p);
  const c = getComputedStyle(p).getPropertyValue(prop); p.remove(); return c; }"""
BTN = "(s) => { const c = getComputedStyle(document.querySelector(s)); return [c.backgroundColor, c.color]; }"


def no_blue(page, fr, where):
    found = [["board"] + f for f in page.evaluate(WALK)] + [["studio"] + f for f in fr.evaluate(WALK)]
    assert found == [], where + ":\n" + "\n".join(" ".join(f) for f in found)


def test_image_studio_has_no_board_blue(hy):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_studio(p, port)
        purple = page.evaluate(PROBE, ["var(--frame)", "color"])
        assert page.evaluate("() => document.documentElement.dataset.studio") == "image"
        assert page.evaluate(PROBE, ["var(--sel)", "color"]) == purple == fr.evaluate(PROBE, ["var(--sel)", "color"])
        # a checked box (the lasso's Anti-alias)
        page.keyboard.press("KeyL"); page.wait_for_timeout(300)
        if not fr.evaluate("() => [...document.querySelectorAll('#obar .ck')].pop().classList.contains('on')"):
            fr.evaluate("() => [...document.querySelectorAll('#obar .ck')].pop().click()"); page.wait_for_timeout(250)
        page.keyboard.press("KeyV"); page.wait_for_timeout(200)
        # a step to undo (⌘J, the picked layer copied), then the History: back one step, its note «1 step» on the board
        fr.evaluate("() => window.focus()"); page.keyboard.press("Meta+KeyJ"); fr.wait_for_function("() => __ed.S.undo.length === 1")
        fr.evaluate("() => __ed.showPanel('hist')"); page.wait_for_timeout(300)
        fr.evaluate("() => { const r = [...document.querySelectorAll('#phist [data-to]')].find(b => +b.dataset.to === __ed.S.undo.length - 1); r.click(); }")
        page.wait_for_function("() => [...document.querySelectorAll('#hyToasts .ht')].some(n => /1/.test(n.textContent))", timeout=3000)
        note = page.evaluate("() => { const n = [...document.querySelectorAll('#hyToasts .ht')].pop(); return [n.className, getComputedStyle(n).color]; }")
        assert note[1] == purple, note
        page.wait_for_timeout(450)   # the note's way in
        no_blue(page, fr, "the studio with a picked layer, a checked box and the History's note")

        # «Close without saving?»: Discard filled with the purple, white words; Cancel as it was
        fr.evaluate("() => __ed.cancelFrame()"); fr.wait_for_selector("#dlgw.on #dlg .ok", timeout=3000); page.wait_for_timeout(400)
        assert fr.evaluate(BTN, "#dlg .ok") == [purple, "rgb(255, 255, 255)"], fr.evaluate(BTN, "#dlg .ok")
        cancel = fr.evaluate("() => { const b = [...document.querySelectorAll('#dlg .dbtns button')].find(b => !b.classList.contains('ok')); return getComputedStyle(b).backgroundColor; }")
        assert cancel != purple, cancel
        no_blue(page, fr, "the dialog")
        fr.click("#dlg .ok"); closed(page)

        # back on the board: the board's blue on the root again
        page.wait_for_function("() => !document.documentElement.dataset.studio", timeout=3000)
        assert page.evaluate(PROBE, ["var(--sel)", "color"]) == "rgb(59, 130, 246)"
        assert not errors, errors
        browser.close()
