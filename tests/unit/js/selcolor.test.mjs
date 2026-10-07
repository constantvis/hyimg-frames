// editor/selcolor.js: Photoshop's Selective Color in Raw Editor (owner 2026-10-07), its params in the grade (sc) and its maths in JS
// (apply, the shader's step written again), against values worked out by hand from the formula in the file's head
import test from "node:test";
import assert from "node:assert/strict";
import { context, colorGrade, plain } from "./load.mjs";

const ctx = context(), CG = colorGrade(ctx), SC = ctx.HySelColor;
const sc = (ranges, abs = 0) => CG.normalize({ sc: Object.assign({ abs }, ranges) }).sc;
const px = (rgb, s) => SC.apply(rgb.map(v => v / 255), s).map(v => v * 255);
const near = (a, b, d = 0.6) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= d), `${a.map(v => v.toFixed(2))} ≠ ${b}`);

/* ---- params */
test("Selective Color is a part of the grade: nine ranges of four inks, Relative, all zero and neutral", () => {
  const d = plain(CG.defaults().sc);
  assert.deepEqual(Object.keys(d), ["abs", ...SC.RANGES]);
  assert.equal(d.abs, 0);
  for (const k of SC.RANGES) assert.deepEqual(d[k], { c: 0, m: 0, y: 0, k: 0 });
  assert.ok(CG.isNeutral({ sc: { reds: { c: 0 } } }));
  assert.equal(CG.isNeutral({ sc: { neutrals: { k: 20 } } }), false);
  assert.equal(CG.isNeutral({ sc: { abs: 1 } }), false, "the method alone is a change of the grade (it is kept)");
  assert.deepEqual(plain(CG.SECTION_PATHS.sc), ["sc"]);
});

test("normalize keeps the ranges' values, fills the rest and drops what is not a range or an ink", () => {
  const n = CG.normalize({ sc: { abs: 1, reds: { c: -40, k: 10 }, oranges: { c: 5 }, blues: { q: 3, y: "12" } } });
  assert.equal(n.sc.abs, 1); assert.deepEqual(plain(n.sc.reds), { c: -40, m: 0, y: 0, k: 10 });
  assert.equal("oranges" in n.sc, false); assert.deepEqual(plain(n.sc.blues), { c: 0, m: 0, y: 12, k: 0 });
});

test("its eye: off, the section leaves the picture and its values stay; the whole grade's eye too", () => {
  const g = { sc: { reds: { c: 30 } }, off: { sc: 1 } };
  assert.ok(CG.isNeutral(CG.effective(g)));
  assert.equal(CG.normalize(g).sc.reds.c, 30);
  assert.equal(CG.isNeutral(CG.effective({ sc: { reds: { c: 30 } } })), false);
  assert.ok(CG.isNeutral(CG.effective({ sc: { reds: { c: 30 } }, bypass: 1 })));
});

test("a grade with Selective Color is no preset, the presets are still what they were", () => {
  assert.equal(CG.presetOf({ sc: { reds: { c: 30 } } }), null);
  assert.equal(CG.presetOf({}), "Neutral");
});

/* ---- weights */
test("a range's weight: max − mid for reds, greens, blues; mid − min for cyans, magentas, yellows; whites, neutrals, blacks by lightness", () => {
  const w = rgb => Object.fromEntries(SC.RANGES.map((k, i) => [k, +SC.weights(rgb)[i].toFixed(4)]));
  assert.deepEqual(w([1, 0, 0]), { reds: 1, yellows: 0, greens: 0, cyans: 0, blues: 0, magentas: 0, whites: 0, neutrals: 0, blacks: 0 });
  assert.deepEqual(w([1, 1, 0]), { reds: 0, yellows: 1, greens: 0, cyans: 0, blues: 0, magentas: 0, whites: 0, neutrals: 0, blacks: 0 });
  assert.deepEqual(w([1, 0.5, 0]), { reds: 0.5, yellows: 0.5, greens: 0, cyans: 0, blues: 0, magentas: 0, whites: 0, neutrals: 0, blacks: 0 });
  assert.deepEqual(w([0.5, 0.5, 0.5]), { reds: 0, yellows: 0, greens: 0, cyans: 0, blues: 0, magentas: 0, whites: 0, neutrals: 1, blacks: 0 });
  assert.deepEqual(w([1, 1, 1]), { reds: 0, yellows: 0, greens: 0, cyans: 0, blues: 0, magentas: 0, whites: 1, neutrals: 0, blacks: 0 });
  assert.deepEqual(w([0, 0, 0]), { reds: 0, yellows: 0, greens: 0, cyans: 0, blues: 0, magentas: 0, whites: 0, neutrals: 0, blacks: 1 });
  assert.deepEqual(w([0.2, 0.6, 0.9]), { reds: 0, yellows: 0, greens: 0, cyans: 0.4, blues: 0.3, magentas: 0, whites: 0, neutrals: 0.3, blacks: 0 });
});

/* ---- the maths, against values worked out by hand */
test("Reds −100 % Cyan, Relative, on a pure red: red has no cyan to take away, R stays 255, green and blue stay", () => {
  near(px([255, 40, 40], sc({ reds: { c: -100 } })), [255, 40, 40]);
  near(px([255, 40, 40], sc({ reds: { c: -100 } }, 1)), [255, 40, 40]);
});

test("Reds −50 % Cyan on (200, 60, 60): R rises, Relative by half the cyan it has, Absolute by half the range (kept under 255)", () => {
  // weight (200 − 60) / 255; Relative t = 0.5·(1 − 200/255), Absolute t = 0.5 kept to 1 − 200/255
  const w = 140 / 255;
  near(px([200, 60, 60], sc({ reds: { c: -50 } })), [200 + w * 0.5 * 55, 60, 60]);   // 215.1
  near(px([200, 60, 60], sc({ reds: { c: -50 } }, 1)), [200 + w * 55, 60, 60]);       // 230.2
  assert.ok(px([200, 60, 60], sc({ reds: { c: -50 } }))[0] > 214);
});

test("Reds +100 % Cyan takes red away: Relative doubles the cyan the pixel has, Absolute adds the full amount (down to 0)", () => {
  const w = 140 / 255;
  near(px([200, 60, 60], sc({ reds: { c: 100 } })), [200 - w * 55, 60, 60]);
  near(px([200, 60, 60], sc({ reds: { c: 100 } }, 1)), [200 - w * 200, 60, 60]);
});

test("a neutral grey is in no colour range: Reds, Blues, Yellows leave (128, 128, 128) as it is", () => {
  const all = { c: 100, m: -100, y: 60, k: 80 };
  for (const abs of [0, 1]) near(px([128, 128, 128], sc({ reds: all, blues: all, yellows: all, cyans: all, greens: all, magentas: all }, abs)), [128, 128, 128], 1e-9);
});

test("Neutrals +20 % Black darkens grey: Relative by the ink it lacks, Absolute by 20 % of the range", () => {
  const v = 128 / 255, w = 1 - 2 * Math.abs(v - 0.5);
  const rel = px([128, 128, 128], sc({ neutrals: { k: 20 } })), ab = px([128, 128, 128], sc({ neutrals: { k: 20 } }, 1));
  near(rel, [1, 1, 1].map(() => 128 - w * 0.2 * (1 - v) * 255));   // 102.7
  near(ab, [1, 1, 1].map(() => 128 - w * 0.2 * 255));               // 77.2
  assert.ok(ab[0] < rel[0] && rel[0] < 128);
  assert.ok(rel[0] === rel[1] && rel[1] === rel[2], "grey stays grey");
});

test("Relative cannot touch pure white (no ink in it), Absolute can; on dark colours the two come close", () => {
  near(px([255, 255, 255], sc({ whites: { c: 50, k: 50 } })), [255, 255, 255]);
  near(px([255, 255, 255], sc({ whites: { c: 50 } }, 1)), [127.5, 255, 255]);
  const rel = px([20, 20, 20], sc({ blacks: { y: -40 } })), ab = px([20, 20, 20], sc({ blacks: { y: -40 } }, 1));
  assert.ok(rel[2] > 20 && ab[2] > rel[2] && ab[2] - rel[2] < 0.1 * (ab[2] - 20) + 1, `${rel} ${ab}`);
});

test("Black and an ink together: t = (−1 − ink)·k − ink, so taking all the cyan out leaves Black nothing to add in red", () => {
  // a pure blue is all Blues (weight 1): red has all the cyan taken out, green and blue get all the black
  near(px([0, 0, 255], sc({ blues: { c: -100, k: 100 } }, 1)), [255, 0, 0]);
  // Black alone in Absolute: every channel down by k, as far as it can go
  near(px([90, 160, 230], sc({ blues: { k: 30 } }, 1)), [90, 160, 230].map(v => v - (230 - 160) / 255 * Math.min(0.3 * 255, v)));
});

test("the ranges are weighed on the pixel as it came in and summed, and the result stays in 0…255", () => {
  const all = Object.fromEntries(SC.RANGES.map(k => [k, { c: 100, m: 100, y: 100, k: 100 }]));
  for (const rgb of [[255, 0, 0], [12, 200, 90], [250, 250, 240], [5, 5, 5], [128, 64, 200]])
    for (const abs of [0, 1]) for (const v of px(rgb, sc(all, abs))) assert.ok(v >= 0 && v <= 255, `${rgb} ${v}`);
  const one = px([200, 60, 60], sc({ reds: { c: -50 }, neutrals: { c: -50 } }));
  const a = px([200, 60, 60], sc({ reds: { c: -50 } })), b = px([200, 60, 60], sc({ neutrals: { c: -50 } }));
  near(one, [a[0] + b[0] - 200, 60 + (b[1] - 60), 60 + (b[2] - 60)]);
});

test("values past ±100 % act as ±100 %, and nothing set is the pixel as it is", () => {
  near(px([200, 60, 60], sc({ reds: { c: -400 } })), px([200, 60, 60], sc({ reds: { c: -100 } })), 1e-9);
  assert.equal(SC.used(sc({})), false); assert.equal(SC.used(sc({ blacks: { m: 1 } })), true);
  near(px([31, 77, 201], sc({})), [31, 77, 201], 1e-9);
});
