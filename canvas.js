// Hyimg frames: an HTML page as a card on the canvas (owner 2026-10-04: «a frame for HTML: interactive buttons, change its width and
// height and see how it works, and frozen as a picture»). At rest the card shows a still of the page, made by the server in Chromium
// (POST /api/htmlstill), so a board of many frames costs pictures, not pages. A double click opens the page live in the card: it
// scrolls and clicks like a browser, the frame's edges change the page's viewport (its width and height in css px), the dock offers
// device sizes, «Обновить», «Снимок» and «Готово». Then a new still is made.
//
// The card on the board: {type: "htmlframe", src: "html/<name>/index.html", vw, x, y, w, h, name?}. vw is the viewport width in css px;
// its height follows the card's shape (vh = vw · h / w): resizing at rest zooms the page like a picture, resizing live widens the page.
// The page lives in the library (html/ is not shown as library frames) and is served by path (/lib/...), so its css, scripts and
// pictures load by relative links.
import { register as registerImageFrame } from "./imgframe.js";   // the image frame with its editor (owner 2026-10-05), its own module
import { translator, lang } from "./lang.js";   // English or Russian, as the board is set (owner 2026-10-06)

const TYPE = "htmlframe";
const ICON = window.hyIcon ? window.hyIcon("htmlFrame", 18, 1.8) : "";   // an HTML frame (ui/icons.js)
const PRESETS = [["Phone", 390, 844], ["Tablet", 834, 1194], ["Laptop", 1280, 800], ["Desktop", 1440, 900]];   // names through t()
const enc = encodeURIComponent, libUrl = p => "/lib/" + p.split("/").map(enc).join("/");
let HY, t = k => k;
const L = { id: null, s: 1, frame: null, bar: null };   // the frame open live, its scale (board units per css px)

const vhOf = it => Math.max(1, Math.round(it.vw * it.h / it.w));
const stillOf = (it, vw = it.vw, vh = vhOf(it)) => { const d = it.src.replace(/[^/]+$/, ""), b = it.src.split("/").pop().replace(/\.html?$/i, ""); return `${d}.stills/${b}-${vw}x${vh}.png`; };
const asked = new Set();
async function makeStill(it) {
  const r = await fetch(`/api/htmlstill?p=${enc(it.src)}&w=${it.vw}&h=${vhOf(it)}`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text()); return r.json();
}
const engineName = () => /HyimgCEF/.test(navigator.userAgent) ? "Chromium" : (() => { try { return window.top.webkit && window.top.webkit.messageHandlers ? "WebKit" : null; } catch { return null; } })() || (/Chrome\//.test(navigator.userAgent) ? "Chrome" : /Safari\//.test(navigator.userAgent) ? "Safari" : t("browser"));

// the card at rest: the still of the page at its viewport; missing, it is made once and shown when ready
function still(el, it, id, fresh) {
  let img = el.querySelector("img.hf");
  if (!img) {
    el.innerHTML = `<img class="hf" alt="" decoding="async" draggable="false"><span class="hb"></span>`; img = el.querySelector("img.hf");
    img.addEventListener("load", () => el.classList.add("lo"));
    img.addEventListener("error", () => {
      const cur = HY.board.items[id]; if (!cur) return; const p = stillOf(cur); if (asked.has(p)) return; asked.add(p);
      el.classList.add("making"); makeStill(cur).then(r => { asked.delete(p); img.src = libUrl(r.path) + `?v=${r.mtime}`; }).catch(e => { el.title = t("Still not made: {e}", { e: e.message }); }).finally(() => el.classList.remove("making"));
    });
  }
  const p = stillOf(it);
  if (img._p !== p || fresh) { img._p = p; img.src = libUrl(p) + (fresh ? `?v=${Date.now()}` : ""); }
  el.querySelector(".hb").textContent = `HTML · ${it.vw}×${vhOf(it)}`;
}

function sizeFrame() {
  const it = HY.board.items[L.id]; if (!it || !L.frame) return;
  const vw = Math.round(it.w / L.s), vh = Math.round(it.h / L.s);
  Object.assign(L.frame.style, { width: vw + "px", height: vh + "px", transform: `scale(${L.s})` });
  if (L.bar) { L.bar.querySelector("[data-w]").value = vw; L.bar.querySelector("[data-h]").value = vh;
    L.bar.querySelectorAll("[data-pre]").forEach(b => b.classList.toggle("on", b.dataset.pre === `${vw}x${vh}`)); }
}
function el(id) { return document.querySelector(`.plg[data-type=${TYPE}][data-id="${id}"]`); }
function goLive(id) {
  if (L.id) stop();
  const it = HY.board.items[id], card = el(id); if (!it || !card) return;
  L.id = id; L.s = it.w / it.vw;
  card.classList.add("plg-live");
  const f = document.createElement("iframe"); f.className = "hfl"; f.title = it.name || it.src; f.src = libUrl(it.src); card.appendChild(f); L.frame = f;
  // the page is ours (same origin): Esc inside it ends the live view too
  f.addEventListener("load", () => { try { f.contentWindow.addEventListener("keydown", e => { if (e.key === "Escape") stop(); }); } catch {} });
  L.bar = dockBar(); HY.dock(L.bar); sizeFrame(); HY.render();
}
// leave the page: its viewport is written into the card (one step to undo) and a new still is made
function stop() {
  const id = L.id; if (!id) return; const it = HY.board.items[id], card = el(id);
  if (L.frame) L.frame.remove(); L.frame = null; if (card) card.classList.remove("plg-live");
  HY.dock(null); L.bar = null; L.id = null;
  if (it) {
    const vw = Math.round(it.w / L.s);
    if (vw !== it.vw) { const before = HY.snap(); it.vw = vw; HY.commit(before, t("HTML: page width")); }
    if (card) { card.classList.add("making"); makeStill(it).then(() => still(card, it, id, true)).catch(e => HY.toast(t("Page still not made: {e}", { e: e.message }), "error")).finally(() => card.classList.remove("making")); }
  }
  HY.render();
}
// a device size: the card keeps its width, the page gets the size, the card's height follows
function preset(vw, vh) {
  const it = HY.board.items[L.id]; if (!it) return; const before = HY.snap();
  it.vw = vw; it.h = Math.round(it.w * vh / vw); L.s = it.w / vw; HY.commit(before, `HTML: ${vw}×${vh}`); sizeFrame();
}
function dockBar() {
  const b = document.createElement("div"); b.className = "hfbar";
  b.innerHTML = PRESETS.map(([n, w, h]) => `<button class="wide" data-pre="${w}x${h}" title="${t(n)}: ${w}×${h}">${t(n)}</button>`).join("")
    + `<span class="sep"></span><label class="hfsz" title="${t("Page size in CSS pixels: type a number or drag the frame's edge")}"><input data-w inputmode="numeric" aria-label="${t("Page width")}">×<input data-h inputmode="numeric" aria-label="${t("Page height")}"></label>`
    + `<span class="hfe" title="${t("The engine changes for the whole app: ⚙ › Engine")}">${engineName()}</span>`
    + `<span class="sep"></span><button class="wide" data-a="reload" title="${t("Reload page · ⌘R in the frame")}">${t("Reload")}</button><button class="wide" data-a="open" title="${t("Open page in a new tab")}">${t("Open")}</button><button class="wide pri" data-a="done" title="${t("Done · Esc")}">${t("Done")}</button>`;
  b.addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.pre) { const [w, h] = t.dataset.pre.split("x").map(Number); return preset(w, h); }
    if (t.dataset.a === "reload" && L.frame) L.frame.src = L.frame.src;
    if (t.dataset.a === "open") window.open(libUrl(HY.board.items[L.id].src), "_blank");
    if (t.dataset.a === "done") stop();
  });
  b.addEventListener("change", e => {
    const w = +b.querySelector("[data-w]").value, h = +b.querySelector("[data-h]").value;
    if (w >= 200 && h >= 200 && w <= 4000 && h <= 8000) preset(Math.round(w), Math.round(h)); else sizeFrame();
  });
  b.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") e.target.blur(); });
  return b;
}
// a new frame: a starter page in html/<date>/index.html, live at once
async function newFrame() {
  const d = new Date(), z = n => String(n).padStart(2, "0"), stamp = `${String(d.getFullYear()).slice(2)}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  const src = `html/${stamp}/index.html`;
  // the starter page speaks the interface's language (owner 2026-10-06)
  const page = `<!doctype html><html lang="${lang(HY)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t("Frame {stamp}", { stamp })}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 -apple-system,system-ui,sans-serif;background:#f4f3ef;color:#1d1d1f}main{max-width:40ch;padding:24px}h1{font-size:28px;margin:0 0 8px}</style>
</head><body><main><h1>${t("New frame")}</h1><p>${t("File {src} in the project folder. An agent or you write it, the canvas shows it live on a double-click.", { src })}</p></main></body></html>`;
  const r = await fetch(`/api/file?p=${enc(src)}`, { method: "POST", body: page }); if (!r.ok) return HY.toast(t("Frame not created: {e}", { e: await r.text() }), "error");
  const c = HY.viewCenter(), w = 720, before = HY.snap(), id = HY.uid("h");
  HY.board.items[id] = { type: TYPE, src, vw: 1440, x: Math.round(c.x - w / 2), y: Math.round(c.y - 225), w, h: 450 };
  HY.commit(before, t("HTML frame")); HY.select([id]); setTimeout(() => goLive(id), 50);
}

export function register(hy) {
  HY = hy; t = translator(hy);
  const st = document.createElement("style"); st.textContent = `
    .plg[data-type=${TYPE}] { background: var(--raise); }
    .plg[data-type=${TYPE}] img.hf { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
    .plg[data-type=${TYPE}] .hb { position: absolute; left: calc(6px / var(--z)); bottom: calc(6px / var(--z)); padding: 0 calc(6px / var(--z)); height: calc(22px / var(--z)); border-radius: calc(6px / var(--z));
      display: grid; place-items: center; background: rgba(20,20,22,.72); color: #fff; font: 700 calc(11px / var(--z)) var(--sans); letter-spacing: .03em; pointer-events: none; white-space: nowrap; }
    .plg[data-type=${TYPE}].making .hb::after { content: ${JSON.stringify(" · " + t("still…"))}; font-weight: 500; }
    .plg[data-type=${TYPE}].plg-live { overflow: hidden !important; }
    .plg[data-type=${TYPE}].plg-live img.hf, .plg[data-type=${TYPE}].plg-live .hb { visibility: hidden; }
    .plg[data-type=${TYPE}] iframe.hfl { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; background: #fff; }
    .hfbar { display: flex; align-items: center; gap: 4px; }
    .hfbar button.on { background: var(--ink) !important; color: var(--panel) !important; }
    .hfbar .sep { width: 1px; height: 22px; background: var(--line); margin: 0 4px; }
    .hfsz { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font: 500 12px var(--sans); }
    .hfsz input { width: 52px; height: 28px; border: 1px solid var(--line); border-radius: 8px; background: var(--raise); color: var(--ink); font: 500 12px var(--sans); text-align: center; font-variant-numeric: tabular-nums; }
    .hfe { padding: 0 8px; color: var(--muted); font: 500 12px var(--sans); white-space: nowrap; }`;
  document.head.appendChild(st);
  // a click anywhere else on the board ends the live page, as «Готово» does
  document.addEventListener("pointerdown", e => { if (!L.id) return; if (e.target.closest(`.plg[data-id="${L.id}"], #dock, .tidy, .he, #ctx`)) return; stop(); }, true);
  hy.register(TYPE, {
    opacity: true,   // the pictures' opacity: the bar's slider, the keys 1…9 and 0, «Copy properties» (owner 2026-10-06)
    render(card, it, id) {
      id = id || card.dataset.id;
      if (L.id === id) { if (!card.contains(L.frame) && L.frame) card.appendChild(L.frame); sizeFrame(); return; }
      still(card, it, id);
    },
    frame(id) { return L.id === id; },   // live, the frame's edges change the page's viewport
    resized(id) { if (L.id === id) sizeFrame(); },
    dblclick(id) { goLive(id); },
    onKey(e) { if (L.id && e.key === "Escape") { stop(); return true; } return false; },
    info(id, it) {
      return { name: it.name || t("HTML frame"), meta: `${it.vw}×${vhOf(it)} · ${it.src}`,
        text: t("Double-click: the live page · its edges resize it") };
    },
  });
  hy.addButton(ICON, t("HTML frame: a live page on the canvas, double-click to scroll and click"), newFrame);
  registerImageFrame(hy);
}
