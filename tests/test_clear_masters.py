"""«Clear all» on the image studio's master rows (owner 2026-10-07: «одним кликом убрать все, что применено», as the board's «Clear
properties ›» and the Raw Editor panel's menu): the master Raw Editor back to neutral and the master Mask to white, one step to undo.
Runs in Chromium, dark, on temporary libraries only."""
import pytest

from editor_kit import MASKA, labels, settle, start
from test_imgframe import hy  # noqa: F401  (the fixture)


def row(fr, id): return f"#rows .lr[data-id='{id}']"


@pytest.mark.parametrize("hy", ["en"], indirect=True)
@pytest.mark.parametrize("engine", ["chromium"])
def test_clear_all_on_the_master_rows(hy, engine):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser, page, fr, errors = start(p, hy[0], engine)
        # a graded main and a master mask hiding its left half
        fr.evaluate("""() => { const K = hyEdK, g = __ed.byId('main_grade'), m = K.mmNode().mask;
          K.edit('x', () => { g.params = Object.assign(K.HyCG.defaults(), { exposure: 1 });
            const c = K.mk(m.c.width, m.c.height), x = c.getContext('2d'); x.fillStyle = '#fff';
            x.fillRect(c.width / 2, 0, c.width / 2, c.height); c._v = (m.c._v | 0) + 1; m.c = c; }); K.refresh(); }""")
        settle(fr)
        assert fr.evaluate("() => __ed.byId('main_grade').params.exposure") == 1 and fr.evaluate(MASKA, ["main_mask", .25, .5]) == 0
        fr.locator(row(fr, "main_grade") + " .nm").click(button="right"); settle(fr)
        L = labels(fr)
        assert L[0][:2] == ["Clear all", "⇧⌥⌘⌫"] and L[0][2] is None, L
        fr.locator("#menu [role=menuitem]").first.click(); settle(fr)
        assert fr.evaluate("() => JSON.stringify(__ed.byId('main_grade').params) === JSON.stringify(hyEdK.HyCG.defaults())")
        assert fr.evaluate(MASKA, ["main_mask", .25, .5]) == 255 and fr.evaluate(MASKA, ["main_mask", .75, .5]) == 255
        fr.evaluate("() => hyEdK.undo()"); settle(fr)   # one step back: both as they were
        assert fr.evaluate("() => __ed.byId('main_grade').params.exposure") == 1 and fr.evaluate(MASKA, ["main_mask", .25, .5]) == 0
        assert not errors, errors
        browser.close()
