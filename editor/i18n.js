// The image studio in the app's language (owner 2026-10-07: the studio stayed English on a Russian board, «board, library, Raw Editor, 3D
// are bilingual»). The words are the plugin's lang.js: the board hands them to its T at the plugin's start (lang.js translator, HY.strings,
// keys under «frames::»), and this page, a frame inside the board, reads them from there before its own script runs. Loaded as a plain
// script before index.html's main one:
//   hyEdTr(T)        the editor's table of words in the board's language: a string is its own key, a function's key is its English with
//                    {name} for each parameter (`Snapshot ${i}` -> "Snapshot {i}"); a Russian list of forms is picked by the number
//   hyEdTr.one(k, v) one word (trF): the Russian of k, or k
// A page alone (no board) takes the language from cv.lang and the words from lang.js once its module is in (window.__framesRU). A word
// with no Russian stays English and is listed in window.__edMiss (the tests keep it empty).
(() => {
  const P = "frames::";
  const board = (() => { try { for (let w = window; w.parent !== w;) { w = w.parent; if (w.T && w.T.dict) return w.T; } } catch (e) {} return null; })();
  const lang = board ? board.lang : (() => { try { return localStorage.getItem("cv.lang") === "ru" ? "ru" : "en"; } catch (e) { return "en"; } })();
  const miss = window.__edMiss = [];
  const ru = k => {
    if (lang !== "ru") return undefined;
    let v = board && board.dict.ru ? board.dict.ru[P + k] : undefined;
    if (v === undefined && window.__framesRU) v = window.__framesRU[k];
    if (v === undefined && !miss.includes(k)) miss.push(k);
    return v;
  };
  // Russian plural forms: 1 кадр, 2 кадра, 5 кадров
  const form = (n, f) => {
    if (!Array.isArray(f)) return f;
    n = Math.abs(Number(n)); if (!Number.isFinite(n)) return f[0];
    const a = n % 10, b = n % 100;
    return !Number.isInteger(n) ? f[1] : a === 1 && b !== 11 ? f[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? f[1] : f[2];
  };
  const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, x) => (v && x in v ? String(v[x]) : m));
  const one = (k, v) => {
    const r = ru(k); if (r === undefined) return v ? fill(k, v) : k;
    const n = v ? (v.n !== undefined ? v.n : Object.values(v).find(x => typeof x === "number")) : undefined;
    return fill(Array.isArray(r) ? (n === undefined ? r[0] : form(n, r)) : r, v);
  };
  // a function's key: its English with its parameters' names as placeholders; one whose English depends on an argument (a flag that picks
  // another word) has its keys here, by its name in the table
  const ALT = {
    nSteps: (n, strokes) => [strokes ? "{n} strokes" : "{n} changes", { n }],
    sizeNote: (w, h, mx, img) => [img ? "Now {w} × {h} px, up to {mx} px per side. Layers scale with the document" : "Now {w} × {h} px, up to {mx} px per side", { w, h, mx }],
  };
  const params = f => { const m = /^\s*(?:function\b[^(]*)?\(?\s*([\w\s,]*?)\s*\)?\s*=>/.exec(f.toString()); return m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : null; };
  const wrap = (name, f) => {
    if (ALT[name]) return (...a) => { const [k, v] = ALT[name](...a); return ru(k) === undefined ? f(...a) : one(k, v); };
    const names = params(f); if (!names) return f;
    let key; try { key = f(...names.map(x => `{${x}}`)); } catch (e) { return f; }
    if (typeof key !== "string") return f;
    return (...a) => (ru(key) === undefined ? f(...a) : one(key, Object.fromEntries(names.map((x, i) => [x, a[i]]))));
  };
  const walk = o => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") o[k] = v.trim() ? one(v) : v;
      else if (typeof v === "function") o[k] = wrap(k, v);
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v);
    }
    return o;
  };
  window.hyEdTr = o => (lang === "ru" ? walk(o) : o);
  window.hyEdTr.one = one;
  window.hyEdTr.lang = lang;
})();
