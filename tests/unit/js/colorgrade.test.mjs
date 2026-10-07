// editor/colorgrade.js: the grade's parameters (defaults, normalize, presets), the typed-number rule and the CPU lookup tables
import test from "node:test";
import assert from "node:assert/strict";
import { colorGrade, plain } from "./load.mjs";

const CG = colorGrade();
const { parseEntry, monotoneSpline, buildCurveLUT, buildHslLUT, wbGains } = CG._internal;
const leaves = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? leaves(v, pre + k + ".") : [pre + k]));

/* ---- parameters */
test("the defaults are a neutral grade, and each call gives a fresh copy", () => {
  const a = CG.defaults(), b = CG.defaults();
  assert.ok(CG.isNeutral(a));
  a.curve.rgb.push([128, 140]); a.hsl.red.hue = 9;
  assert.deepEqual(plain(b.curve.rgb), [[0, 0], [255, 255]]);
  assert.equal(b.hsl.red.hue, 0);
});

test("normalize fills every missing leaf from the defaults", () => {
  const n = CG.normalize({ contrast: 20, hsl: { blue: { sat: -30 } } });
  assert.deepEqual(leaves(n).sort(), leaves(CG.defaults()).sort());
  assert.equal(n.contrast, 20); assert.equal(n.hsl.blue.sat, -30); assert.equal(n.hsl.blue.hue, 0);
});

test("normalize drops unknown keys and values that are not numbers", () => {
  const n = CG.normalize({ contrast: "abc", exposure: "0.5", made_up: 1, hsl: { teal: { hue: 3 } }, curve: { rgb: "no" } });
  assert.equal(n.contrast, 0);
  assert.equal(n.exposure, 0.5, "a number written as text is a number");
  assert.equal("made_up" in n, false);
  assert.equal("teal" in n.hsl, false);
  assert.deepEqual(plain(n.curve.rgb), [[0, 0], [255, 255]]);
});

test("normalize copies the curves, so editing the result never changes the source", () => {
  const src = { curve: { rgb: [[0, 0], [100, 120], [255, 255]] } };
  const n = CG.normalize(src);
  n.curve.rgb[1][1] = 0;
  assert.equal(src.curve.rgb[1][1], 120);
});

test("normalize of nothing is the defaults", () => {
  for (const x of [null, undefined, 5, "x"]) assert.deepEqual(plain(CG.normalize(x)), plain(CG.defaults()));
});

test("a grade with every value at its default is neutral, one changed value is not", () => {
  assert.ok(CG.isNeutral({}));
  assert.ok(CG.isNeutral({ contrast: 0 }));
  assert.equal(CG.isNeutral({ contrast: 1 }), false);
  assert.equal(CG.isNeutral({ curve: { rgb: [[0, 0], [128, 129], [255, 255]] } }), false);
});

test("every preset names only parameters that exist, so none of its values is dropped", () => {
  const known = new Set(leaves(CG.defaults()));
  for (const [name, p] of Object.entries(CG.presets)) for (const l of leaves(p)) assert.ok(known.has(l), `${name}: ${l}`);
});

test("every preset but Neutral changes the picture", () => {
  for (const [name, p] of Object.entries(CG.presets)) assert.equal(CG.isNeutral(p), name === "Neutral", name);
});

/* ---- the typed-number rule */
test("a typed number follows the one rule: a plain number sets, a leading operator works on the current value", () => {
  const cases = [
    ["1239px + 10", 0, 1249], ["100px+10%", 0, 110], ["800/2", 0, 400], ["0-10", 0, -10], ["2+3*4", 0, 14], ["100-10%", 0, 90],
    ["+10", 50, 60], ["-10", 50, 40], ["+10%", 50, 55], ["*2", 50, 100], ["/2", 50, 25],
    ["1,5", 0, 1.5], ["−5", 20, 15], ["×2", 3, 6], ["÷2", 3, 1.5], ["5px", 0, 5], ["10°", 0, 10], [".5", 0, 0.5],
  ];
  for (const [text, cur, want] of cases) assert.equal(parseEntry(text, cur, 100), want, `${text} on ${cur}`);
});

test("a typed share is a share of the base, 100 when none is given", () => {
  assert.equal(parseEntry("50%", 7), 50);
  assert.equal(parseEntry("50%", 7, 1240), 620);
});

test("text the rule cannot read gives null, so the value stays", () => {
  for (const t of ["", "abc", "-", "++5", "=5", "/0", "+-5", "1e3", "10%%", "5 5x"]) assert.equal(parseEntry(t, 10, 100), null, JSON.stringify(t));
});

/* ---- curves */
test("a spline through two corner points is the identity", () => {
  const f = monotoneSpline([[0, 0], [255, 255]]);
  for (const x of [0, 1, 64, 127.5, 200, 255]) assert.ok(Math.abs(f(x) - x) < 1e-9, String(x));
});

test("a spline goes through its points and is flat outside them", () => {
  const pts = [[20, 10], [64, 30], [128, 200], [230, 240]], f = monotoneSpline(pts);
  for (const [x, y] of pts) assert.ok(Math.abs(f(x) - y) < 1e-9, `${x}`);
  assert.equal(f(0), 10); assert.equal(f(255), 240);
});

test("a spline through rising points never dips: no overshoot between them", () => {
  const f = monotoneSpline([[0, 0], [60, 5], [70, 200], [255, 255]]);
  let prev = -Infinity;
  for (let x = 0; x <= 255; x += 0.25) { const y = f(x); assert.ok(y >= prev - 1e-9, `at ${x}`); assert.ok(y >= 0 && y <= 255, `at ${x}: ${y}`); prev = y; }
});

test("a spline's points may come in any order", () => {
  const a = monotoneSpline([[255, 255], [100, 60], [0, 0]]), b = monotoneSpline([[0, 0], [100, 60], [255, 255]]);
  for (const x of [10, 100, 180]) assert.equal(a(x), b(x));
});

test("a spline of one point is that point's level everywhere", () => {
  const f = monotoneSpline([[100, 77]]);
  assert.equal(f(0), 77); assert.equal(f(255), 77);
});

test("the default curve table maps every input to itself", () => {
  const L = buildCurveLUT(CG.defaults().curve), N = L.length / 4;
  for (let i = 0; i < N; i += 37) for (let ch = 0; ch < 4; ch++) assert.ok(Math.abs(L[i * 4 + ch] - i / (N - 1)) < 1e-6, `${i}/${ch}`);
});

test("the parametric curve stays rising and inside 0..1 even at its extremes", () => {
  for (const c of [{ shadows: 100, highlights: -100 }, { shadows: -100, darks: -100, lights: -100, highlights: -100 }, { shadows: 100, darks: 100, lights: 100, highlights: 100, splits: [5, 6, 95] }]) {
    const L = buildCurveLUT(CG.normalize({ curve: c }).curve);
    for (let i = 0; i < L.length / 4; i++) {
      const v = L[i * 4 + 3]; assert.ok(v >= 0 && v <= 1, `${JSON.stringify(c)} at ${i}`);
      if (i) assert.ok(v >= L[(i - 1) * 4 + 3] - 1e-6, `${JSON.stringify(c)} dips at ${i}`);
    }
  }
});

test("the HSL table is zero for a neutral grade and holds a hue's own shift at its centre", () => {
  const zero = buildHslLUT(CG.defaults().hsl);
  assert.ok(zero.every(v => v === 0));
  const hsl = CG.normalize({ hsl: { red: { hue: 100, sat: -50, lum: 20 } } }).hsl, L = buildHslLUT(hsl);
  assert.deepEqual([...L.slice(0, 3)].map(v => +v.toFixed(5)), [30, -0.5, 0.2]);
  assert.deepEqual([...L.slice(120 * 4, 120 * 4 + 3)], [0, 0, 0], "green, far from red, is untouched");
});

/* ---- white balance */
test("white balance at zero is no change, and any setting keeps the brightness", () => {
  assert.deepEqual(plain(wbGains(0, 0)), [1, 1, 1]);
  for (const [t, g] of [[50, 0], [-100, 0], [0, 80], [100, -100]]) {
    const [r, gg, b] = wbGains(t, g);
    assert.ok(Math.abs(0.2126 * r + 0.7152 * gg + 0.0722 * b - 1) < 1e-12, `${t},${g}`);
  }
});

test("a warmer temperature raises red over blue, a cooler one the other way", () => {
  const [r1, , b1] = wbGains(40, 0), [r2, , b2] = wbGains(-40, 0);
  assert.ok(r1 > b1); assert.ok(r2 < b2);
});

/* ---- Hue/Saturation (owner 2026-10-06) */
test("Hue/Saturation: Photoshop's default ranges, its presets name only what exists, and a neutral hs changes nothing", () => {
  const hs = CG.defaults().hs;
  assert.deepEqual(plain(CG.HS_RANGES), ["reds", "yellows", "greens", "cyans", "blues", "magentas"]);
  assert.deepEqual(plain(hs.reds.r), [-45, -15, 15, 45]); assert.deepEqual(plain(hs.blues.r), [195, 225, 255, 285]);
  const known = new Set(leaves(hs));
  for (const [name, p] of Object.entries(CG.hsPresets)) for (const l of leaves(p)) assert.ok(known.has(l), `${name}: ${l}`);
  for (const q of [[0.2, 0.5, 0.9], [1, 0, 0], [0.5, 0.5, 0.5]]) assert.deepEqual(plain(CG.hsApply(q, hs)).map(v => Math.round(v * 1e6)), q.map(v => Math.round(v * 1e6)));
});

test("Hue/Saturation: a range's weight is 1 inside, fades to the outer marks, wraps round red; a broken range falls back", () => {
  const { hsWeight, hsRange } = CG._internal;
  const r = [-45, -15, 15, 45];
  assert.equal(hsWeight(0, r), 1); assert.equal(hsWeight(350, r), 1); assert.equal(hsWeight(30, r), 0.5); assert.equal(hsWeight(330, r), 0.5); assert.equal(hsWeight(90, r), 0);
  assert.deepEqual(plain(hsRange("x")), [-45, -15, 15, 45]);
  assert.deepEqual(plain(hsRange([10, 5, 40, 30])), [10, 10, 40, 40], "out of order: each at least the one before");
  const w = hsRange([0, 10, 20, 400]); assert.ok(w[3] - w[0] < 360, "less than a whole turn");
});

test("Hue/Saturation: Photoshop's saturation: +100 makes a colour full without a grey turning, −100 is grey", () => {
  const { psSat } = CG._internal;
  assert.deepEqual(plain(psSat([0.5, 0.5, 0.5], 1)), [0.5, 0.5, 0.5]);
  const g = psSat([0.6, 0.4, 0.4], -1); assert.ok(Math.abs(g[0] - g[1]) < 1e-9 && Math.abs(g[1] - g[2]) < 1e-9);
  const f = psSat([0.6, 0.4, 0.4], 1).map(v => Math.min(1, Math.max(0, v))); assert.ok(f[0] === 1 && f[1] === 0, plain(f));
});
