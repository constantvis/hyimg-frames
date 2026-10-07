// grade.js: a board item keeps only the leaves of its grade that differ from the defaults (compact), and they read back as the grade
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { context, colorGrade, moduleIn, plain, url, REPO } from "./load.mjs";

async function grade() {
  const ctx = context(), CG = colorGrade(ctx);
  const G = moduleIn(ctx, "grade.js", { "./lang.js": await import(url("lang.js")) });
  return { CG, G, ctx };
}

// a deterministic stream of numbers (mulberry32)
const rng = seed => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test("before the grading code is loaded no grade is kept", async () => {
  const { G } = await grade();
  assert.equal(G.compact({ contrast: 10 }), null);
});

test("a neutral grade is no grade at all", async () => {
  const { G, CG } = await grade(); await G.loadCG();
  assert.equal(G.compact(CG.defaults()), null);
  assert.equal(G.compact({}), null);
  assert.equal(G.compact(null), null);
});

test("only the changed leaves are kept, deep ones with their path", async () => {
  const { G } = await grade(); await G.loadCG();
  assert.deepEqual(plain(G.compact({ contrast: 26, hsl: { red: { hue: 5 } }, grading: { blending: 50 } })), { contrast: 26, hsl: { red: { hue: 5 } } });
});

test("a curve is kept whole when any of its points moved", async () => {
  const { G } = await grade(); await G.loadCG();
  const rgb = [[0, 0], [128, 140], [255, 255]];
  assert.deepEqual(plain(G.compact({ curve: { rgb } })), { curve: { rgb } });
});

test("unknown keys and the format's version are never kept", async () => {
  const { G } = await grade(); await G.loadCG();
  assert.equal(G.compact({ version: 1, sparkle: 9 }), null);
});

test("a compact grade reads back as the full grade it came from", async () => {
  const { G, CG } = await grade(); await G.loadCG();
  const r = rng(42), paths = (o, pre = []) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? paths(v, [...pre, k]) : [[...pre, k]]));
  const all = paths(CG.defaults()).filter(p => typeof p.reduce((a, k) => a[k], CG.defaults()) === "number" && p[0] !== "version");
  for (let n = 0; n < 50; n++) {
    const g = CG.defaults();
    for (const p of all) if (r() < 0.15) { let o = g; for (const k of p.slice(0, -1)) o = o[k]; o[p.at(-1)] = Math.round((r() * 200 - 100) * 10) / 10; }
    if (r() < 0.3) g.curve.rgb = [[0, 0], [Math.round(r() * 250), Math.round(r() * 255)], [255, 255]];
    const c = G.compact(g);
    if (CG.isNeutral(g)) { assert.equal(c, null); continue; }
    assert.deepEqual(plain(CG.normalize(c)), plain(CG.normalize(g)), `grade ${n}`);
    assert.ok(JSON.stringify(c).length <= JSON.stringify(CG.normalize(g)).length);
  }
});

test("compacting twice changes nothing", async () => {
  const { G, CG } = await grade(); await G.loadCG();
  const once = G.compact(CG.presets["Soft Matte"]);
  assert.deepEqual(plain(G.compact(once)), plain(once));
});

test("the grade's icon is Raw Editor's wheel from the app's icons (ui/icons.js), 15 px in the bar's 1.9 line", async t => {
  const core = path.join(REPO, "../hyimg/review/ui/icons.js");   // the plugin draws no glyph of its own (owner 2026-10-07)
  if (!fs.existsSync(core)) return t.skip("no hyimg beside the plugin");
  const ctx = context(); vm.runInContext(fs.readFileSync(core, "utf8"), ctx); colorGrade(ctx);
  const G = moduleIn(ctx, "grade.js", { "./lang.js": await import(url("lang.js")) });
  assert.match(G.GRADE_SVG, /^<svg viewBox="0 0 24 24" width="15" height="15"/);
  assert.match(G.GRADE_SVG, /stroke-width="1.9"/);
  assert.ok(G.GRADE_SVG.includes(ctx.HY_TOOL_IC.rawEditor));
});
