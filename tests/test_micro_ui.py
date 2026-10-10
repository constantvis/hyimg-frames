"""Round 15's micro UI in Image Studio (owner 2026-10-09 on r15-micro.html: «Все топ, все делай, кроме номера пять»). Layers: a row is a
.hy-hovrow and its lock and eye are .hy-ri, 20 px, shown while the row is hovered, a set one (a hidden layer's eye) staying. A generative
layer that is generating wears the 6 px LED blinking in the studio's purple, a ring when it failed. Chromium, dark.

  HYIMG_REPO=<Hyimg checkout> python3 -m pytest tests/test_micro_ui.py
"""
from test_imgframe import hy  # noqa: F401  (hy is the fixture)
from test_studio_dock import open_studio

PROBE = """([v, prop]) => { const p = document.createElement('i'); p.style.setProperty(prop, v); document.body.append(p);
  const c = getComputedStyle(p).getPropertyValue(prop); p.remove(); return c; }"""
EYE = "(id) => { const b = document.querySelector(`.lr[data-id=\"${id}\"] .rb[data-a=eye]`); const r = b.getBoundingClientRect(); " \
      "return [b.classList.contains('hy-ri'), b.closest('.lr').classList.contains('hy-hovrow'), Math.round(r.width), Math.round(r.height), +getComputedStyle(b).opacity]; }"


def test_image_studio_layers_wear_the_micro_ui(hy):
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_studio(p, port)
        purple = fr.evaluate(PROBE, ["var(--frame)", "background-color"])
        ids = fr.evaluate("() => [...document.querySelectorAll('#rows .lr[data-id]')].filter(r => r.querySelector('.rb[data-a=eye]') && r.querySelector('.rb[data-a=lock]')).map(r => r.dataset.id)")
        assert ids, "layer rows with an eye and a lock"
        lid = ids[-1]
        # 8 · icons on hover: away from the list the eye is out, over its row it shows
        page.mouse.move(700, 450); page.wait_for_timeout(300)
        assert fr.evaluate(EYE, lid) == [True, True, 20, 20, 0]
        fr.locator(f'.lr[data-id="{lid}"]').hover(); page.wait_for_timeout(300)
        assert fr.evaluate(EYE, lid)[4] == 1
        assert fr.evaluate(f"() => document.querySelector('.lr[data-id=\"{lid}\"] .rb[data-a=lock]').classList.contains('hy-ri')")
        # a set one stays: the layer hidden, its eye stays out of hover
        fr.locator(f'.lr[data-id="{lid}"] .rb[data-a=eye]').click(); page.wait_for_timeout(300)
        page.mouse.move(700, 450); page.wait_for_timeout(300)
        assert fr.evaluate(f"() => document.querySelector('.lr[data-id=\"{lid}\"] .rb[data-a=eye]').classList.contains('keep')")
        assert fr.evaluate(EYE, lid)[4] == 1
        fr.locator(f'.lr[data-id="{lid}"] .rb[data-a=eye]').click(force=True); page.wait_for_timeout(300)
        # 4 · a generating layer: the LED, 6 px, blinking in the studio's purple, no glow; a failed one a ring
        fr.evaluate(f"(id) => {{ __ed.byId(id).gen = {{ status: 'run', vars: [null, null, null], pick: 0 }}; hyEdK.renderLayers(); }}", lid)
        led = fr.locator(f'.lr[data-id="{lid}"] hy-led')
        assert led.count() == 1
        got = led.evaluate("l => { const s = getComputedStyle(l), r = l.getBoundingClientRect(); return [l.getAttribute('state'), Math.round(r.width), Math.round(r.height), "
                           "s.backgroundColor, s.boxShadow, s.animationName, l.getAttribute('role')]; }")
        assert got == ["busy", 6, 6, purple, "none", "hy-led-busy", "img"], (got, purple)
        fr.evaluate(f"(id) => {{ __ed.byId(id).gen.status = 'err'; hyEdK.renderLayers(); }}", lid)
        assert led.evaluate("l => [l.getAttribute('state'), getComputedStyle(l).backgroundColor]") == ["off", "rgba(0, 0, 0, 0)"]
        fr.evaluate(f"(id) => {{ delete __ed.byId(id).gen; hyEdK.renderLayers(); }}", lid)
        assert not errors, errors
        browser.close()


def test_image_studio_numbers_scrub_by_their_letter(hy):
    """round 16's scrub, version A (owner 2026-10-10 on r16-scrub.html: «отлично, беру»): every number field of the studio (numIn: the
    layer's opacity, the Properties' X Y W H, the options bar) drags by its label through ui/hy/scrub.js: ⇧ ×10, Esc puts it back, one
    history step a drag, none for an Esc"""
    from playwright.sync_api import sync_playwright
    port, lib, state = hy
    with sync_playwright() as p:
        browser, page, fr, errors = open_studio(p, port)
        lid = fr.evaluate("() => [...document.querySelectorAll('#rows .lr[data-id]')].filter(r => r.querySelector('.rb[data-a=lock]')).map(r => r.dataset.id).pop()")
        fr.locator(f'.lr[data-id="{lid}"] .nm').click(); page.wait_for_timeout(300)
        lab = fr.locator("#lOp").locator("xpath=..").locator(".nl")
        assert lab.evaluate("l => [l.classList.contains('hy-scrub-h'), getComputedStyle(l).cursor]") == [True, "ew-resize"]
        op = lambda: fr.evaluate(f"(id) => __ed.byId(id).opacity", lid)
        steps = lambda: fr.evaluate("() => __ed.S.undo.length")
        assert op() == 100
        b = lab.bounding_box(); x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        h0 = steps()
        page.mouse.move(x, y); page.mouse.down()
        for i in range(1, 5): page.mouse.move(x - 5 * i, y)
        page.mouse.up(); page.wait_for_timeout(200)
        assert op() == 90 and steps() == h0 + 1 and fr.evaluate("() => document.querySelector('#lOp').value") == "90"   # half a percent a pixel
        page.mouse.move(x, y); page.mouse.down(); page.keyboard.down("Shift")
        for i in range(1, 4): page.mouse.move(x - i, y)
        page.keyboard.up("Shift"); page.mouse.up(); page.wait_for_timeout(200)
        assert op() == 75 and steps() == h0 + 2   # ⇧: 5 % a pixel
        page.mouse.move(x, y); page.mouse.down()
        for i in range(1, 5): page.mouse.move(x - 5 * i, y)
        page.keyboard.press("Escape"); page.mouse.up(); page.wait_for_timeout(300)
        assert op() == 75 and steps() == h0 + 2 and page.evaluate("() => document.documentElement.dataset.studio") == "image", "Esc put it back and left the studio open"
        # the Properties' numbers drag by their letters too
        assert fr.evaluate("() => [...document.querySelectorAll('#side .nf .nl')].every(l => l.classList.contains('hy-scrub-h'))")
        assert not errors, errors
        browser.close()
