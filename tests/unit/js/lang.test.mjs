// lang.js: the plugin's Russian words, how they reach the board's T, and the English a board without T shows
import test from "node:test";
import assert from "node:assert/strict";
import { read, url } from "./load.mjs";
import vm from "node:vm";

let n = 0;
const fresh = () => import(url("lang.js") + "?fresh=" + ++n);   // a module of its own: its «strings handed over» flag starts unset
const holes = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");

test("every Russian word has exactly the placeholders of its English key, in every form", async () => {
  const { RU } = await fresh(), bad = [];
  for (const [k, v] of Object.entries(RU)) for (const form of [].concat(v)) if (holes(form) !== holes(k)) bad.push(`«${k}» → «${form}»`);
  assert.deepEqual(bad, []);
});

test("every English plural has two forms and a Russian one of three", async () => {
  const { RU, EN } = await fresh();
  for (const [k, v] of Object.entries(EN)) {
    assert.equal(v.length, 2, k);
    assert.ok(Array.isArray(RU[k]) && RU[k].length === 3, `«${k}» needs three Russian forms`);
  }
  for (const [k, v] of Object.entries(RU)) if (Array.isArray(v)) assert.equal(v.length, 3, k);
});

test("every key the board's frame and the grading ask for has its Russian", async () => {
  const { RU } = await fresh(), missing = [];
  for (const f of ["canvas.js", "grade.js", "imgframe.js", "mask.js"])
    for (const m of read(f).matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) { const k = JSON.parse('"' + m[1] + '"'); if (!(k in RU)) missing.push(`${f}: «${k}»`); }
  assert.deepEqual(missing, []);
});

test("a board with T gets the words once, every key under the plugin's prefix", async () => {
  const L = await fresh(), handed = [];
  const HY = { t: (k, v) => `T(${k})${v ? JSON.stringify(v) : ""}`, strings: d => handed.push(d) };
  const t = L.translator(HY);
  L.translator(HY);
  assert.equal(handed.length, 1);
  assert.ok(Object.keys(handed[0].ru).every(k => k.startsWith("frames::")));
  assert.deepEqual(Object.keys(handed[0].en).sort(), Object.keys(L.EN).map(k => "frames::" + k).sort());
  assert.equal(t("Frame {n}", { n: 2 }), 'T(frames::Frame {n}){"n":2}');
});

test("a board without T shows the English, plurals by the number", async () => {
  const { translator } = await fresh(), t = translator({});
  assert.equal(t("Frame"), "Frame");
  assert.equal(t("{n} images", { n: 1 }), "1 image");
  assert.equal(t("{n} images", { n: 3 }), "3 images");
  assert.equal(t("Frame not made: {e}", { e: "disk" }), "Frame not made: disk");
  assert.equal(t("Frame {stamp}", {}), "Frame {stamp}", "an unknown placeholder stays as written");
});

test("the board's language is Russian only when it says so", async () => {
  const { lang } = await fresh();
  assert.equal(lang({ lang: "ru" }), "ru");
  assert.equal(lang({ lang: "de" }), "en");
  assert.equal(lang({}), "en");
});

test("every word the image studio asks lang.js for (trF) has its Russian, in the owner's style", async () => {
  const { RU } = await fresh(), page = read("editor/index.html"), missing = [], style = [];
  // the editor's T table: «key: 'English'» (a string value, not a function)
  const Tv = Object.fromEntries([...page.matchAll(/\b(\w+):\s*'((?:[^'\\]|\\.)*)'/g)].map(m => [m[1], m[2]]));
  const asked = [...page.matchAll(/\btrF\(\s*T\.(\w+)\s*\)/g)].map(m => Tv[m[1]] ?? `T.${m[1]}`)
    .concat([...page.matchAll(/\btrF\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)].map(m => m[1]));
  assert.ok(asked.includes("A click picks the layer under the pointer, ⇧ adds or removes it"), "the select tool's hint goes through trF");
  assert.ok(asked.includes("Drag the canvas; pinch or ⌘ with the wheel zooms"), "the hand tool's hint goes through trF");
  for (const k of asked) {
    if (!(k in RU)) { missing.push(k); continue; }
    for (const v of [].concat(RU[k])) if (/[ё—]|\.$/.test(v)) style.push(`«${v}»`);
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(style, [], "no ё, no em dash, no period at the end");
});

test("the whole image studio is in Russian: every word of its table (editor/index.html T through i18n.js) has its Russian", async () => {
  const { RU } = await fresh(), page = read("editor/index.html").split("\n");
  const start = page.findIndex(l => l.startsWith("const T = hyEdTr({")), end = page.indexOf("});", start);
  assert.ok(start > 0 && end > start, "the table is made through hyEdTr");
  const board = { T: { lang: "ru", dict: { ru: Object.fromEntries(Object.entries(RU).map(([k, v]) => ["frames::" + k, v])) } } };
  board.parent = board;
  const win = { parent: board, localStorage: { getItem: () => null } }; win.window = win;
  const c = vm.createContext(win);
  vm.runInContext(read("editor/i18n.js"), c);
  vm.runInContext(["const T = hyEdTr({", ...page.slice(start + 1, end), "});", "globalThis.T = T;"].join("\n"), c);
  const out = [], walk = o => { for (const v of Object.values(o)) {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") for (const a of [[1, 2, 3, 1], [5, 0, 3, 0]]) out.push(String(v(...a)));
    else if (v && typeof v === "object") walk(v); } };
  walk(c.T);
  assert.deepEqual([...c.__edMiss], [], "words without Russian");
  // proper names stay English in Russian too (owner 2026-10-08: Image Studio, 3D Studio, Dev Studio, as Raw Editor)
  const latin = out.filter(s => /[A-Za-z]{3,}/.test(s.replace(/Raw Editor|Image Studio|3D Studio|Dev Studio|Hyimg|px|<\/?b>/g, "")));
  assert.deepEqual(latin, [], "English left in the Russian table");
  assert.deepEqual(out.filter(s => /[ё—]|\.$/.test(s)), [], "no ё, no em dash, no period at the end");
  assert.equal(c.T.layersN(1), "1 слой"); assert.equal(c.T.layersN(3), "3 слоя"); assert.equal(c.T.layersN(5), "5 слоев");
  assert.equal(c.T.nSteps(2, true), "2 мазка"); assert.equal(c.T.nSteps(2, false), "2 изменения");
});
