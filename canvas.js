// Hyimg frames: an HTML page as a card on the canvas (owner 2026-10-04: «a frame for HTML: interactive buttons, change its width and
// height and see how it works, and frozen as a picture»). At rest the card shows a still of the page, made by the server in Chromium
// (POST /api/htmlstill), so a board of many frames costs pictures, not pages. A double click opens the page live in the card: it
// scrolls and clicks like a browser, the frame's edges change the page's viewport (its width and height in css px), the dock offers
// device sizes, Reload, Open in <Browser> and Done stand top right (Hyimg ui/hy/actions.js). Then a new still is made.
//
// The card on the board: {type: "htmlframe", src: "html/<name>/index.html", vw, x, y, w, h, name?}. vw is the viewport width in css px;
// its height follows the card's shape (vh = vw · h / w): resizing at rest zooms the page like a picture, resizing live widens the page.
// The page lives in the library (html/ is not shown as library frames) and is served by path (/lib/...), so its css, scripts and
// pictures load by relative links.
import { register as registerImageFrame } from "./imgframe.js";   // the image frame with its editor (owner 2026-10-05), its own module
import { translator } from "./lang.js";   // English or Russian, as the board is set (owner 2026-10-06)

const TYPE = "htmlframe";
const PRESETS = [["Phone", 390, 844], ["Tablet", 834, 1194], ["Laptop", 1280, 800], ["Desktop", 1440, 900]];   // names through t()
const enc = encodeURIComponent, libUrl = p => "/lib/" + p.split("/").map(enc).join("/");
let HY, t = k => k;
const L = { id: null, s: 1, frame: null, bar: null, zoom: null, acts: null };   // the frame open live, its scale (board units per css px), who zooms

const vhOf = it => Math.max(1, Math.round(it.vw * it.h / it.w));
const claimed = () => !!(HY && HY.claimed && HY.claimed(TYPE));   // another plugin opens the frame on a double-click (HY.opener)
const stillOf = (it, vw = it.vw, vh = vhOf(it)) => { const d = it.src.replace(/[^/]+$/, ""), b = it.src.split("/").pop().replace(/\.html?$/i, ""); return `${d}.stills/${b}-${vw}x${vh}.png`; };
const asked = new Set();
async function makeStill(it) {
  const r = await fetch(`/api/htmlstill?p=${enc(it.src)}&w=${it.vw}&h=${vhOf(it)}`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text()); return r.json();
}
const engineName = () => /HyimgCEF/.test(navigator.userAgent) ? "Chromium" : (() => { try { return window.top.webkit && window.top.webkit.messageHandlers ? "WebKit" : null; } catch { return null; } })() || (/Chrome\//.test(navigator.userAgent) ? "Chrome" : /Safari\//.test(navigator.userAgent) ? "Safari" : t("browser"));

// The still at the size the card has on screen (owner 2026-10-08, the «UI» board lagged on zoom and went blank in places): far out a
// frame 50 px wide decoded its whole 1440 px picture, 21 of them 109 MB. It asks the server's thumbnail of its still, 640 or 1280 px wide,
// by its width on screen in device px (the board's view hook), and the still itself beyond that; a sharper one is decoded before it
// replaces the one shown, mid-gesture a card keeps what it has (as Dev studio's HTML cards, cards.js).
const STEPS = [640, 1280];
const stepFor = dev => STEPS.find(s => dev <= s * 1.1) || 0;   // 0: the still itself
const urlOf = (it, step, v) => step ? `/thumb?p=${enc(stillOf(it))}&s=${step}${v ? `&v=${v}` : ""}` : libUrl(stillOf(it)) + (v ? `?v=${v}` : "");
function swapTo(img, u) {
  if (img._u === u) return;
  if (!img.complete || !img.naturalWidth) { img._u = u; img.src = u; return; }
  const nu = new Image(); nu.src = u; img._want = u;
  nu.decode().then(() => { if (img._want === u && img.isConnected) { img._u = u; img.src = u; } }, () => {});
}
// the card at rest: the still of the page at its viewport; missing, it is made once and shown when ready
function still(el, it, id, fresh) {
  let img = el.querySelector("img.hf");
  if (!img) {
    el.innerHTML = `<img class="hf" alt="" decoding="async" draggable="false"><span class="hb"></span>`; img = el.querySelector("img.hf");
    img.addEventListener("load", () => el.classList.add("lo"));
    img.addEventListener("error", () => {
      const cur = HY.board.items[id]; if (!cur) return; const p = stillOf(cur);
      if (el._made === p && el._hs) { el._hs = 0; img._u = urlOf(cur, 0, el._v); img.src = img._u; return; }   // a still made, its thumbnail failed: the still
      if (asked.has(p)) return; asked.add(p);
      el.classList.add("making");
      makeStill(cur).then(r => { asked.delete(p); el._made = p; el._v = r.mtime; img._u = urlOf(cur, el._hs, r.mtime); img.src = img._u; })
        .catch(e => { el.title = t("Still not made: {e}", { e: e.message }); }).finally(() => el.classList.remove("making"));
    });
  }
  const p = stillOf(it);
  if (el._hs === undefined) el._hs = STEPS[0];   // 640 until the view says more
  if (fresh) el._v = Date.now();
  if (img._p !== p || fresh) { img._p = p; img._u = urlOf(it, el._hs, el._v); img.src = img._u; }
  el.querySelector(".hb").textContent = `HTML · ${it.vw}×${vhOf(it)}`;
}
// the board's view hook: the card's width on screen (0 off it), whether the board moves
function view(id, el, px, moving) {
  const it = HY.board.items[id], img = el.querySelector("img.hf");
  if (!it || !img || !px || moving || L.id === id) return;
  const dev = px * (devicePixelRatio || 1), need = stepFor(dev), less = stepFor(dev * 1.25), cur = el._hs ?? STEPS[0], size = s => s || Infinity;
  // up as soon as it needs more, down only once it needs clearly less (no swaps back and forth at a step while the zoom wavers)
  const next = size(need) > size(cur) ? need : size(less) < size(cur) ? less : cur;
  if (next === cur) return;
  el._hs = next; swapTo(img, urlOf(it, next, el._v));
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
  // a pinch over the page zooms the board, a click in it gives the page the zoom (Hyimg ui/framezoom.js, owner 2026-10-08)
  L.zoom = window.hyFrameZoom ? hyFrameZoom.attach(f, { card, local: true }) : null;
  L.bar = dockBar(); HY.dock(L.bar); sizeFrame(); HY.render();
  // Reload, Open in <Browser> and Done top right, as in every Studio (Hyimg ui/hy/actions.js; owner 2026-10-09: «кнопки Done у нас всегда
  // стандартизированы справа вверху»); the device sizes and the page's size stay in the dock
  L.acts = document.body.appendChild(document.createElement("hy-studio-actions"));
  L.acts.actions = [{ id: "reload", label: t("Reload"), title: t("Reload page · ⌘R in the frame"), run: () => { if (L.frame) L.frame.src = L.frame.src; } },
    { id: "open", open: () => (L.id && HY.board.items[L.id] ? libUrl(HY.board.items[L.id].src) : ""), tip: t("Open page in a new tab") },
    { id: "done", label: t("Done"), tip: t("Done"), key: "Esc", primary: true, run: () => stop() }];
}
// leave the page: its viewport is written into the card (one step to undo) and a new still is made
function stop() {
  const id = L.id; if (!id) return; const it = HY.board.items[id], card = el(id);
  if (L.zoom) L.zoom.detach(); L.zoom = null;
  if (L.frame) L.frame.remove(); L.frame = null; if (card) card.classList.remove("plg-live");
  HY.dock(null); L.bar = null; L.id = null; if (L.acts) L.acts.remove(); L.acts = null;
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
    + `<span class="hfe" title="${t("The engine changes for the whole app: ⚙ › Engine")}">${engineName()}</span>`;
  b.addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.pre) { const [w, h] = t.dataset.pre.split("x").map(Number); return preset(w, h); }
  });
  b.addEventListener("change", e => {
    const w = +b.querySelector("[data-w]").value, h = +b.querySelector("[data-h]").value;
    if (w >= 200 && h >= 200 && w <= 4000 && h <= 8000) preset(Math.round(w), Math.round(h)); else sizeFrame();
  });
  b.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") e.target.blur(); });
  return b;
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
  document.addEventListener("pointerdown", e => { if (!L.id) return; if (e.target.closest(`.plg[data-id="${L.id}"], #dock, .tidy, .he, #ctx, hy-studio-actions, .hy-oi-menu`)) return; stop(); }, true);
  hy.register(TYPE, {
    opacity: true,   // the pictures' opacity: the bar's slider, the keys 1…9 and 0, «Copy properties» (owner 2026-10-06)
    render(card, it, id) {
      id = id || card.dataset.id;
      if (L.id === id) { if (!card.contains(L.frame) && L.frame) card.appendChild(L.frame); sizeFrame(); return; }
      still(card, it, id);
    },
    view,   // the still's size by the card's on screen
    frame(id) { return L.id === id; },   // live, the frame's edges change the page's viewport
    resized(id) { if (L.id === id) sizeFrame(); },
    dblclick(id) { goLive(id); },
    // the page changed elsewhere (Dev mode wrote it): a new still
    changed(id) { const card = el(id), it = HY.board.items[id]; if (card && it && L.id !== id) makeStill(it).then(() => still(card, it, id, true)).catch(() => {}); },
    onKey(e) { if (L.id && e.key === "Escape") { stop(); return true; } return false; },
    info(id, it) {
      return { name: it.name || t("HTML frame"), meta: `${it.vw}×${vhOf(it)} · ${it.src}`,
        text: claimed() ? t("Double-click: Dev Studio · the live page on the bar over it") : t("Double-click: the live page · its edges resize it") };
    },
  });
  // another plugin opens the frame on a double-click (Dev studio's Dev mode, owner 2026-10-07): the live view is one click away on the bar
  // over the frame; without such a plugin the double-click is the live view, and the bar has no button for it
  if (hy.bar) hy.bar(ids => {
    const it = ids.length === 1 && HY.board.items[ids[0]];
    return it && it.type === TYPE && claimed() && L.id !== ids[0] ? [{ first: true, icon: window.hyIcon ? window.hyIcon("htmlFrame", 15, 1.9) : "", label: t("Live view"),
      title: t("The live page: device sizes, the frame's edges resize it"), fn: () => goLive(ids[0]) }] : [];
  });
  // no dock button to make a new frame (owner 2026-10-09: «Также создавать фрейм я не вижу смысла. Зачем вообще эта кнопка?»): agents
  // place frames with hy.py do 'htmlframe …', the frames already on a board work as before
  registerImageFrame(hy);
}
