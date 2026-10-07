// Hyimg frames: the colour grade of any picture on the board (owner 2026-10-06: «colour grading for ALL pictures on the board, not only
// inside frames»). The image studio's grading (editor/colorgrade.js, one WebGL pass) on a picture card or a frame card, never on the file:
// the grade is kept on the board item, it.grade, only what differs from the defaults (compact), and the card shows the graded look in a
// canvas over its picture (canvas.grd). A measured choice: a CSS filter cannot do curves, HSL, colour wheels, clarity; the WebGL pass
// grades a 300–600 px thumbnail in 3.5–5 ms in WebKit (the app's engine; 15–40 ms in headless Chromium's software GL), so the cards are
// graded from the very picture the board loaded (any size it picks), one queue for the board, ~8 ms of it per frame, and never again
// until the picture, the grade or the crop changes. The far view (its one canvas of thumbnails) shows the pictures ungraded.
//
// Ways in (owner 2026-10-06): «Colour grade» on the bar over the selection of any picture (and of a frame), the grade's own mark in the
// card's top left corner (a click opens the grading), the right click «Copy colour grade» and «Paste colour grade» (onto every selected
// picture). The grading is a panel where the card's info stands, the same panel as in the image studio; a gesture is one step to undo.
// In the image studio the frame's grade is its MAIN grade, the layer pinned on top of all layers (editor/index.html), so a frame card's
// it.grade and that layer are one thing, and the frame's render is without it (the card grades the render like any picture).
import { translator } from "./lang.js";
const BASE = new URL(".", import.meta.url).pathname;
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const CAP = 2048;   // the graded copy on a card is at most this long a side (the picture the board shows can be the full file)
let HY, t = k => k, CG = null, R = null, cgP = null;
// the icon is the app's (ui/icons.js hyGradeIcon, Raw Editor's «rawEditor», owner 2026-10-06: variant 2 «Круг»): a colour wheel with its
// puck, in the line of the bar (1.9) and of a card's mark (2.2); «on», the wheel filled with hues, where a grade works on the picture. Never
// the half-filled circle: that is the opacity right beside it on the bar (owner 2026-10-07: «одно значение, одна иконка»)
const icon = (on, size, line) => (window.hyGradeIcon ? window.hyGradeIcon(on, size, line) : "");
export const GRADE_SVG = icon(false, 15, 1.9);

export function loadCG() {
  if (CG) return Promise.resolve(CG);
  if (window.HyColorGrade) { CG = window.HyColorGrade; return Promise.resolve(CG); }
  // Selective Color (editor/selcolor.js) first: colorgrade.js takes its params, shader step and section when it loads
  const js = f => new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = `${BASE}editor/${f}`; s.onload = res; s.onerror = () => rej(new Error(f)); document.head.appendChild(s);
  });
  return cgP || (cgP = (window.HySelColor ? Promise.resolve() : js("selcolor.js")).then(() => js("colorgrade.js")).then(() => {
    CG = window.HyColorGrade; if (!CG) throw new Error("colorgrade.js"); return CG;
  }));
}
const renderer = () => R || (R = CG.createRenderer());
// only the leaves that differ from the defaults (the board file stays small, a grade reads as what was changed); null: no grade
export function compact(p) {
  if (!CG || !p) return null;
  const diff = (a, d) => {
    if (Array.isArray(d) || typeof d !== "object" || d === null) return JSON.stringify(a) === JSON.stringify(d) ? undefined : a;
    const o = {}; for (const k of Object.keys(d)) { const v = diff(a[k], d[k]); if (v !== undefined) o[k] = v; }
    return Object.keys(o).length ? o : undefined;
  };
  return diff(CG.normalize(p), CG.defaults()) || null;
}
const gradeable = it => !!it && ((HY.isPic(it) && !VIDEO.test(it.path || "")) || it.type === "imgframe" || !!(HY.asPic && HY.asPic(it)));
// the element a card's picture is in: a plugin card that is a picture tells it (HY.surface: a 3D card's still, its live three.js canvas
// or Blender's frame, owner 2026-10-06), a frame card its render, a picture card its <img>; an <img> or a <canvas>, ready when it has pixels
const surf = el => (HY.surface && HY.surface(el)) || el.querySelector(el.classList.contains("plg") ? "img.ifr" : "img");
const ready = s => !!s && (s.tagName === "CANVAS" ? s.width > 0 && s.height > 0 : s.complete && s.naturalWidth > 0);
const keyOf = it => (it.grade ? JSON.stringify(it.grade) : "") + "|" + (it.crop || "");
// a grade that changes the picture: not switched off as a whole (the panel's eye) and not with every changed section off. Before
// colorgrade.js is here, a grade counts as working
const working = g => !!g && (!CG || !CG.effective || !CG.isNeutral(CG.effective(g)));

// the pictures' own pixel sizes, for the grain's and the sharpening's scale on a thumbnail (asked once per picture, in a batch)
const SIZES = new Map(), asking = new Set(); let sizeT = 0;
function sizeOf(path) {
  if (SIZES.has(path)) return SIZES.get(path);
  if (!asking.has(path)) { asking.add(path); clearTimeout(sizeT); sizeT = setTimeout(askSizes, 30); }
  return null;
}
async function askSizes() {
  const paths = [...asking]; asking.clear(); let got = {};
  try { const r = await fetch("/api/sizes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) }); if (r.ok) got = await r.json(); } catch {}
  paths.forEach(p => SIZES.set(p, Array.isArray(got[p]) && got[p][0] > 0 ? got[p] : 0));
  document.querySelectorAll("#items .it.graded").forEach(el => { const it = HY.board.items[el.dataset.id]; if (it && paths.includes(it.path)) queue(el); });
}

// the graded look of one card: a canvas over its picture, the crop's place given in shares of the card, so a resize needs no new pass
let scr = null;
function paint(el) {
  const id = el.dataset.id, it = HY.board.items[id], img = surf(el);
  // a preset pointed at in the panel's menu shows on the cards it grades, the board item stays as it is (P.pv)
  const grade = it && P && P.pv && P.ids.includes(id) ? P.pv : it && it.grade;
  let cv = el.querySelector(":scope > canvas.grd");
  if (!it || !working(grade) || !CG) { if (cv) cv.remove(); return; }   // switched off: the picture as it is
  if (!ready(img)) return;   // its load paints it
  const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height, k = Math.min(1, CAP / Math.max(nw, nh)), w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
  let src = img;
  if (k < 1) { scr = scr || document.createElement("canvas"); scr.width = w; scr.height = h; const x = scr.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, w, h); src = scr; }
  if (!cv) { cv = document.createElement("canvas"); cv.className = "grd"; }
  if (cv.previousElementSibling !== img) img.after(cv);   // right over the picture, also when a card shows it in another element now
  const c = it.crop || [0, 0, 1, 1], full = it.path ? sizeOf(it.path) : null;
  // the frame of what the card shows (its crop), so the vignette and the grain sit on the visible picture
  const fr = [c[0] * w, c[1] * h, (c[2] - c[0]) * w, (c[3] - c[1]) * h], scale = full ? w / full[0] : 1;
  // the renderer keeps the last picture on the GPU (a slider's next step costs no upload); a card's same <img> with another file in it
  // (a bigger thumbnail, a frame's new render) is sent again
  const u = img.currentSrc || img.src; if (el._grdU !== u) { el._grdU = u; renderer().invalidate(); }
  try { renderer().render(src, CG.normalize(grade), cv, { frame: fr, scale }); }
  catch (e) { console.warn("[grade]", e); cv.remove(); return; }
  const cw = c[2] - c[0], ch = c[3] - c[1];
  const ss = el.classList.contains("plg") && getComputedStyle(img);   // a card's picture element: its layer and its fit, so the grade lies right on it
  Object.assign(cv.style, ss ? { left: 0, top: 0, width: "100%", height: "100%", zIndex: ss.zIndex === "auto" ? "" : ss.zIndex, objectFit: ss.objectFit }
    : { left: -c[0] / cw * 100 + "%", top: -c[1] / ch * 100 + "%", width: 100 / cw + "%", height: 100 / ch + "%" });
}
// one queue for the board: the cards graded in turn, at most ~8 ms a frame, so a board of many graded pictures opens without a stall
const Q = new Set(); let qRaf = 0;
function queue(el) { Q.add(el); if (!qRaf) qRaf = requestAnimationFrame(run); }
function run() {
  qRaf = 0; const t0 = performance.now();
  for (const el of Q) { Q.delete(el); if (el.isConnected) paint(el); if (performance.now() - t0 > 8) break; }
  if (Q.size) qRaf = requestAnimationFrame(run);
}
window.__gradeQ = () => Q.size;   // for the tests: nothing waits to be graded

// the card's mark: the board's one mark (.mk, its size, inset and way in and out), in the top right row after the ♥ (owner 2026-10-06:
// «top right after the heart: colour grading and trim/crop»); the board's law places it and lets it leave first (review/canvas.html mkFit)
// A working grade wears the «on» wheel; a grade switched off keeps its mark (it is still there to switch on) in the plain wheel, dimmed
function mark(el, on, works) {
  let m = el.querySelector(":scope > .mk-grade");
  if (on && !m) { m = document.createElement("button"); m.className = "mk mk-tr mk-grade"; m.title = t("Raw Editor · click to change"); m.setAttribute("aria-label", t("Raw Editor")); el.appendChild(m); }
  if (m && m._on !== works) { m._on = works; m.innerHTML = icon(works, 0, 2.2); m.classList.toggle("idle", !works); m.dataset.icon = works ? "on" : "off"; }
  el.classList.toggle("graded", !!on);
}
// a card's grade changed, or its picture: the mark, and the graded look once the picture is there (each new picture the board loads
// into the card, a bigger thumbnail on zoom, paints it again)
export function dress(el, it) {
  if (!CG && it.grade) { loadCG().then(() => dress(el, HY.board.items[el.dataset.id] || it)).catch(() => {}); }
  mark(el, !!it.grade, working(it.grade));
  const img = surf(el);
  if (img && !el._grdL) { el._grdL = true; img.addEventListener("load", () => { if (el.classList.contains("graded")) queue(el); }); }
  if (it.grade) queue(el); else { const cv = el.querySelector(":scope > canvas.grd"); if (cv) cv.remove(); }
}
// the graded look at once, out of the queue (the panel's sliders: the card follows the pointer)
function now(id) { const el = cardEl(id); if (el) { Q.delete(el); dress(el, HY.board.items[id]); Q.delete(el); paint(el); } }
const cardEl = id => document.querySelector(`#items [data-id="${CSS.escape(id)}"]`);

/* ---------- the grading panel ---------- */
let P = null;   // {ids, wrap, inst, before, t}
function targets(ids) { return ids.filter(id => gradeable(HY.board.items[id])); }
// Hue/Saturation's eyedropper on the board: the next click on a card samples its picture (as loaded, before the grade) at that point;
// anywhere else, or Esc in the panel, gives nothing
function boardPick(done) {
  if (!document.getElementById("hcgpk")) { const s = document.createElement("style"); s.id = "hcgpk"; s.textContent = "html.hcgpick #items, html.hcgpick #items * { cursor: crosshair !important; }"; document.head.appendChild(s); }
  const end = () => { document.removeEventListener("pointerdown", down, true); document.documentElement.classList.remove("hcgpick"); };
  function down(e) {
    if (e.button !== 0 || (e.target.closest && e.target.closest("#hcgp"))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    // the card under the pointer, whatever lies over it (the selection's frame and corner squares are drawn above the cards)
    const card = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.matches("#items [data-id]")), img = card && surf(card);
    let rgb = null;
    if (img && img.naturalWidth) {
      const r = img.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * img.naturalWidth, y = (e.clientY - r.top) / r.height * img.naturalHeight;
      if (x >= 0 && y >= 0 && x < img.naturalWidth && y < img.naturalHeight) {
        try { const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1);
          const d = g.getImageData(0, 0, 1, 1).data; if (d[3]) rgb = [d[0], d[1], d[2]]; } catch {}
      }
    }
    const f = done; done = null; end(); if (f) f(rgb);
  }
  document.addEventListener("pointerdown", down, true); document.documentElement.classList.add("hcgpick");
  HY.toast(t("Click a colour on the image · Esc cancels"));
  return () => { done = null; end(); };
}
async function openPanel(ids) {
  ids = targets(ids); if (!ids.length) return;
  try { await loadCG(); } catch (e) { return HY.toast(t("Raw Editor did not load: {e}", { e: e.message }), "error"); }
  if (P) { retarget(ids); return; }
  const wrap = document.createElement("div"); wrap.id = "hcgp"; wrap.dataset.hyui = "";
  ["wheel", "pointerdown", "dblclick", "contextmenu"].forEach(ev => wrap.addEventListener(ev, e => e.stopPropagation(), { passive: ev === "wheel" }));
  // a press in the panel starts a gesture: everything until the button is let go is one step to undo, however long it rests while held
  wrap.addEventListener("pointerdown", e => { if (P && e.button === 0) P.down = true; }, true);
  // a button pressed from the keys or by VoiceOver (a preset, a reset: a click with no pointer) is a gesture of its own too
  wrap.addEventListener("click", () => { if (P && !P.down) { P.down = true; up(); } }, true);
  HY.stage.appendChild(wrap);
  const first = HY.board.items[ids[0]];
  // the header's eye switches the grade off and on, a change of the grade like any other (one step, saved, the cards follow)
  // a preset pointed at in the menu: on the cards at once through the one queue (the last one pointed at wins, a sweep down the list does
  // not pile up), nothing in the board; null puts their grade back, keep: a click's change follows and paints them itself
  const preview = (p, keep) => { if (!P) return; P.pv = p || null; if (!keep) P.ids.forEach(id => { const el = cardEl(id); if (el) queue(el); }); };
  const inst = CG.createPanel(wrap, first.grade ? CG.normalize(first.grade) : CG.defaults(), change, { theme: "inherit", title: t("Raw Editor"), t, pick: boardPick, preview });
  const x = document.createElement("button"); x.className = "hcg-ib hcgx"; x.title = t("Close · Esc"); x.setAttribute("aria-label", t("Close"));
  x.innerHTML = hyIcon("close", 0, 2); x.onclick = () => closePanel();
  wrap.querySelector(".hcg-top").appendChild(x);
  P = { ids, wrap, inst, before: null, t: 0, down: false, last: key(first.grade), pv: null };
  histo();
  document.documentElement.classList.add("hcgon");
  requestAnimationFrame(() => wrap.classList.add("in"));
}
function histo() { try { const el = cardEl(P.ids[0]), img = el && surf(el); if (ready(img)) P.inst.setHistogram(CG.histogram(img, 256)); } catch {} }
// a slider moved: the selected cards follow at once. One finished gesture is one step to undo (owner 2026-10-06): a drag, a click on a
// preset or a reset is committed when the button is let go (up()), a change from the keys (a typed value, an arrow) once it rests
// 450 ms (as the image studio); an undo, a redo or closing commits what still waits first (HY.history), so ⌘Z takes back that gesture
function change(p) {
  if (!P) return; const g = compact(p); P.last = key(g);
  // the panel only repeats what the cards have (it was set from them while its own change waited for its frame): no step
  if (!P.before && P.ids.every(id => !HY.board.items[id] || key(HY.board.items[id].grade) === P.last)) return;
  if (!P.before) P.before = HY.snap();
  P.ids.forEach(id => { const it = HY.board.items[id]; if (!it) return; if (g) it.grade = g; else delete it.grade; now(id); });
  clearTimeout(P.t); if (!P.down) P.t = setTimeout(settle, 450);
}
// the button let go: the panel's last change reaches change() on its next frame (colorgrade.js emits once a frame), then the step
function up() {
  if (!P || !P.down) return; P.down = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { if (P && !P.down) settle(); }));
}
function settle() {
  if (!P || !P.before) return; clearTimeout(P.t); const b = P.before; P.before = null;
  HY.commit(b, P.ids.length > 1 ? t("Raw Editor on {n} images", { n: P.ids.length }) : t("Raw Editor"));
}
function closePanel() {
  if (!P) return; if (P.inst.closeMenu) P.inst.closeMenu(); settle(); const { wrap, inst } = P; P = null;
  document.documentElement.classList.remove("hcgon"); wrap.classList.remove("in");
  setTimeout(() => { try { inst.destroy(); } catch {} wrap.remove(); }, 260);
}
// the selection changed while the panel is open: it follows to the new pictures, and an undo on the board shows in its sliders
function retarget(ids) {
  if (!P) return; ids = targets(ids);
  if (!ids.length) return closePanel();
  if (ids.join() !== P.ids.join()) { settle(); P.ids = ids; histo(); }
  if (P.before) return;   // a gesture runs: the panel is the truth
  // the panel follows the card only when its grade is not what the panel last gave it (an undo, a paste): a render between a click in
  // the panel and its change, which reaches change() on the next frame, must not put the old grade back into the panel
  const it = HY.board.items[ids[0]], k = key(it.grade);
  if (k === P.last) return;
  P.last = k; P.inst.set(it.grade ? CG.normalize(it.grade) : CG.defaults());
}
// a grade compared by what it changes (a pasted grade may carry its defaults too)
const key = g => JSON.stringify(g ? compact(g) : null);

/* ---------- copy and paste ---------- */
const CLIPK = "hyimg.gradeClip";
function clip() { try { const s = localStorage.getItem(CLIPK); return s ? JSON.parse(s) : null; } catch { return null; } }
function copyGrade(id) {
  const it = HY.board.items[id]; if (!it || !it.grade) return;
  try { localStorage.setItem(CLIPK, JSON.stringify(it.grade)); } catch {}
  HY.toast(t("Raw Editor copied"), "success");
}
function pasteGrade(ids) {
  const g = clip(); ids = targets(ids); if (!g || !ids.length) return;
  const before = HY.snap(); ids.forEach(id => { HY.board.items[id].grade = JSON.parse(JSON.stringify(g)); });
  HY.commit(before, ids.length > 1 ? t("Raw Editor pasted on {n} images", { n: ids.length }) : t("Raw Editor pasted"));
  if (P) retarget([...HY.sel]);
}

export function registerGrade(hy) {
  HY = hy; t = translator(hy);
  const st = document.createElement("style"); st.textContent = `
    /* while the colour grading is open every card mark steps out with its own scale-to-0 (owner 2026-10-06: «in colour grading all the
       tags must disappear so they don't get in the way»); they come back when it closes */
    html.hcgon :is(.it, .plg) .mk { scale: 0 !important; opacity: 0 !important; pointer-events: none !important; }
    /* the graded look over the card's picture */
    :is(.it, .plg) > canvas.grd { position: absolute; display: block; pointer-events: none; max-width: none; }
    .it > canvas.grd { z-index: 1; } .plg > canvas.grd { z-index: 0; }
    .it.missing > canvas.grd, .plg.ifhide > canvas.grd { visibility: hidden; }
    /* the grade's mark: the board's one mark (.mk), top right after the ♥ (on a frame card, which has no ♥, in the corner); the board's
       law counts it in that row (.graded) and it is the first to leave when the row has no room (data-mkx grade) */
    :is(.it, .plg).graded:not(.mkoff):not([data-mkx~=grade]) > .mk.mk-grade { display: flex; scale: 1; opacity: 1; pointer-events: auto; cursor: pointer; }
    @starting-style { :is(.it, .plg).graded:not(.mkoff):not([data-mkx~=grade]) > .mk.mk-grade { scale: 0; opacity: 0; } }
    :is(.it, .plg) > .mk.mk-grade:hover { background: var(--mkgh); }
    /* a grade switched off: the plain wheel, dimmed (the «on» wheel is for a grade that works) */
    :is(.it, .plg) > .mk.mk-grade.idle svg { opacity: .5; transition: opacity .3s cubic-bezier(.32,.72,0,1); }
    /* the grading panel stands where the card's info stands (#info), the same glass plate */
    #hcgp { position: absolute; right: 12px; top: 60px; width: 300px; height: calc(100% - 150px); z-index: 31; overflow: hidden; border-radius: 18px;
      border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); background: color-mix(in srgb, var(--panel) 66%, transparent);
      backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4); box-shadow: 0 12px 40px rgba(0,0,0,.25);
      --paper: transparent; --raise2: color-mix(in srgb, var(--ink) 12%, transparent); --r-ctl: var(--hy-row-r, 8px);
      opacity: 0; translate: 12px 0; transition: opacity .26s cubic-bezier(.32,.72,0,1), translate .26s cubic-bezier(.32,.72,0,1); }
    #hcgp.in { opacity: 1; translate: 0 0; }
    :root[data-shape=pro] #hcgp { border-radius: 14px; }
    #hcgp .hcg { background: transparent; }
    #hcgp .hcgx svg { width: 15px; height: 15px; }
    #hcgp :focus, #hcgp :focus-visible { outline: none; }
    html.hcgon #info { display: none !important; }`;
  document.head.appendChild(st);
  // the mark: a click opens the grading of that card (the board's pointer does not take it: no drag, no marquee)
  document.addEventListener("pointerdown", e => {
    const m = e.target.closest && e.target.closest("#items .mk-grade"); if (!m || e.button !== 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const id = m.parentElement.dataset.id; HY.select([id]); openPanel([id]);
  }, true);
  addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
  // Esc closes the panel, also with a slider focused (a slider keeps the focus after a drag); a typed number takes its own Esc
  addEventListener("keydown", e => {
    if (!P || e.key !== "Escape") return; const tg = e.target;
    if (P.inst.menuOpen) { e.preventDefault(); e.stopImmediatePropagation(); P.inst.closeMenu(); return; }   // Esc in the presets: the menu, its look put back
    if (tg && (tg.tagName === "TEXTAREA" || tg.isContentEditable || (tg.tagName === "INPUT" && !/^(range|checkbox|radio|button)$/i.test(tg.type)))) return;
    e.preventDefault(); e.stopImmediatePropagation(); closePanel();
  }, true);
  // a gesture still waiting becomes its step before the board's undo or redo; a Hyimg without HY.history: at least before ⌘Z
  if (hy.history) hy.history(() => settle());
  else addEventListener("keydown", e => { if (P && (e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "я")) settle(); }, true);
  if (hy.bar) hy.bar(ids => {
    if (P) queueMicrotask(() => retarget([...HY.sel]));
    const its = ids.map(i => HY.board.items[i]);
    if (!ids.length || !its.every(gradeable)) return [];
    // an icon button, as «Arrange» (the bar stays short over a small picture), its words in the tooltip
    // the «on» wheel when the first picture's grade works (owner 2026-10-06), the plain one otherwise
    return [{ icon: icon(working(its[0].grade), 15, 1.9), label: "", aria: t("Raw Editor"), title: its.length > 1 ? t("Raw Editor on the {n} images", { n: its.length }) : t("Raw Editor: the picture's file never changes"), fn: () => openPanel(ids) }];
  });
  // the third function: a 3D card's new picture (its live view's frame, a render that arrived) graded at once, out of the queue
  if (hy.pic) hy.pic(keyOf, (el, it) => dress(el, it), el => { Q.delete(el); paint(el); });   // last: its render draws the bar with the button above too; a Hyimg older than 2026-10-06 has no picture layers: frames only
  // the colour grade is a kind of the board's «Copy properties ›» / «Paste properties ›» (owner 2026-10-06: one place for copying a look,
  // its live preview on hover, presets, hy.py props); a Hyimg older than that keeps the grade's own two items in the right click
  if (hy.props) hy.props.register({ id: "grade", label: t("Raw Editor"), order: 10, has: it => gradeable(it) && !!it.grade,
    applies: it => gradeable(it) || t("Raw Editor only on images, frames and 3D cards"), lacks: () => t("Raw Editor isn't applied"), get: it => it.grade ? JSON.parse(JSON.stringify(it.grade)) : null,
    set: (it, v) => { if (v) it.grade = JSON.parse(JSON.stringify(v)); else delete it.grade; } });
  else hy.ctx((ids, id) => {
    const tg = targets(ids); if (!tg.length) return [];
    const out = [], src = HY.board.items[id];
    if (src && src.grade && gradeable(src)) out.push({ icon: GRADE_SVG, label: t("Copy Raw Editor"), fn: () => copyGrade(id) });
    if (clip()) out.push({ icon: GRADE_SVG, label: tg.length > 1 ? t("Paste Raw Editor ({n})", { n: tg.length }) : t("Paste Raw Editor"), fn: () => pasteGrade(tg) });
    return out;
  });
  if (Object.values(HY.board.items).some(it => it.grade)) loadCG().then(() => HY.render()).catch(() => {});
  window.__grade = { openPanel, closePanel, copyGrade, pasteGrade, compact, get P() { return P; }, paint, loadCG };
}
