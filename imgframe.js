// Hyimg frames: the image frame (owner 2026-10-05: «select pictures, ⌥⌘G makes a frame, like Figma; a double click opens the editor»).
// The selected pictures move into the frame (they leave the board, one step to undo); the frame keeps links to their files, its masks
// and painted layers, and is drawn into one picture, its render, which the card shows at rest. The originals are never written.
//
// Two ways in (owner 2026-10-05), in the right click, the bar over the selection and on keys: «В один фрейм» (⌥⌘G) puts every selected
// picture into one frame, «Каждый в свой фрейм» (⌥⇧⌘G) gives each picture its own frame at its place and size. A selected group brings
// its pictures (nested groups too); the group stays around the new cards.
//
// The card on the board: {type: "imgframe", x, y, w, h, name, doc: "frames/<stamp>/frame.<n>.json", render: "frames/<stamp>/render.<n>.png",
// v: n, rv: the render's mtime in ms, size: [W, H] of the document, pics: [library paths inside], alpha: true when the document has no
// background}. Each Save is a new version beside the old ones (owner 2026-10-05: undo on the board must really undo), the card points
// to the version it shows; the plugin's server keeps the last 10 (inpaint/routes.py prune). A phase-1 card (frame.json, render.png) is
// version 0. pics is what the board, the server and the library count as lying on the page (canvas.html picsOf).
//
// The editor opens in place (owner 2026-10-05: «when entering the frame the whole interface flickers, this must never happen. We stay on
// the same canvas»): the board, its camera and zoom stay; the rest of the board dims around the frame, the tool rail comes in from the
// left, the panels from the right, the board's dock turns into the editor's, the crumb gains the frame's name, Cancel and Save stand
// where the board's buttons were. The editor (editor/index.html) is a transparent page over the board, loaded ahead of time so it opens
// at once; it pans and zooms the board's own camera (HY.camera). Exit runs the same moves back.
import { translator } from "./lang.js";   // English or Russian, as the board is set (owner 2026-10-06)
import { registerGrade, dress, loadCG } from "./grade.js";   // the colour grade of any picture and frame card (owner 2026-10-06), its own module
import { registerMask, dressMask, maskCanvas } from "./mask.js";   // the master mask of any picture and frame card (owner 2026-10-06)
const TYPE = "imgframe", MAXDOC = 8000, KEEP = 10;
// the menus' and the bar's icons are the app's (ui/icons.js, 15 px in the menus' 1.9 line; owner 2026-10-07: «одно значение, одна иконка»):
// the image studio opens with its own icon, Image mode's; a frame taken apart wears «ungroup»
const IC = { frame: hyIcon("frame", 15, 1.9), each: hyIcon("frameEach", 15, 1.9), open: hyIcon("image", 15, 1.9), unframe: hyIcon("ungroup", 15, 1.9), cmd: hyIcon("actions", 15, 1.9) };
const BASE = new URL(".", import.meta.url).pathname;   // /plugins/<this plugin>/
const PLUGIN = (BASE.match(/^\/plugins\/([^/]+)\//) || [])[1] || "frames";
const enc = encodeURIComponent, fileUrl = (p, v) => `/file?p=${enc(p)}` + (v ? `&v=${v}` : "");
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let t = k => k;   // the plugin's words (lang.js), set at register
const picsWord = n => t("{n} images", { n: String(n) });
const framesWord = n => t("{n} frames", { n: String(n) });
const $ = s => document.querySelector(s);
let HY, ED = null, making = false;   // ED: the open editor {id, ...}

const canGo = it => HY.isPic(it) && !VIDEO.test(it.path || "");   // pictures go in; a video frame is phase 2
const isFrame = it => !!it && it.type === TYPE;
const stamp = () => { const d = new Date(), z = n => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).slice(2)}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}-${Math.random().toString(36).slice(2, 5)}`; };
async function put(path, body) {
  const r = await fetch(`/api/file?p=${enc(path)}`, { method: "POST", body }); if (!r.ok) throw new Error(await r.text()); return r.json();
}
// the studio's frame of a picture lives in memory until its first Save (owner 2026-10-07: a cancelled double click leaves nothing in the
// library): path -> blob URL, read by the card (card) and the studio (host.mem), let go when the studio closes
let MEM = {};
const memPut = mem => async (path, body) => { mem[path] = URL.createObjectURL(body instanceof Blob ? body : new Blob([body], { type: "application/json" })); return { mtime: Date.now() * 1e6 }; };
function dropMem() { for (const u of Object.values(MEM)) URL.revokeObjectURL(u); MEM = {}; }
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = () => rej(new Error(t("no image"))); i.src = src; });
// The pictures' own pixel sizes (owner 2026-10-05: «the document must use the source's native pixels»). The library reads them from the
// file headers (/api/sizes); a picture it does not know is loaded once. The header ignores a camera's rotation flag (EXIF), the board
// and the browser do not: when the header's sides are swapped against the picture on the board, they are turned back.
async function naturalSizes(paths, items = []) {
  let got = {};
  try { const r = await fetch("/api/sizes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) }); if (r.ok) got = await r.json(); } catch {}
  for (const p of paths) {
    let n = got[p];
    if (!(Array.isArray(n) && n[0] > 0 && n[1] > 0)) { try { const im = await loadImg(`/img?p=${enc(p)}`); n = [im.naturalWidth, im.naturalHeight]; } catch { n = null; } }
    const it = items.find(i => i.path === p && i.ar > 0 && !i.crop);
    if (n && it && Math.abs(Math.log(n[0] / n[1] / it.ar)) > .15 && Math.abs(Math.log(n[1] / n[0] / it.ar)) < .05) n = [n[1], n[0]];
    if (n) got[p] = n; else delete got[p];
  }
  return got;
}
const docLayers = layers => (layers || []).flatMap(l => l.kind === "pic" && l.path ? [l] : docLayers(l.children));
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// the pictures a selection brings: pictures themselves, and a group's pictures (by their centre in its frame, so nested groups too)
function picsOf(ids) {
  const out = [];
  for (const id of ids) {
    const it = HY.board.items[id];
    if (it) { if (canGo(it) && !out.includes(id)) out.push(id); continue; }
    const g = HY.board.groups[id]; if (!g) continue;
    for (const [pid, p] of Object.entries(HY.board.items)) { if (!canGo(p) || out.includes(pid)) continue; const r = HY.rectOf(pid); if (inside({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, g)) out.push(pid); }
  }
  const order = Object.keys(HY.board.items); return out.sort((a, b) => order.indexOf(a) - order.indexOf(b));   // bottom to top, as the board draws them
}
const frameName = (k = 0) => t("Frame {n}", { n: String(Object.values(HY.board.items).filter(isFrame).length + 1 + k) });

// One frame of these pictures (not yet on the board): the document is their box in the pictures' own pixels, so the largest picture
// keeps its full resolution (owner 2026-10-05), at most 8000 px a side; the card takes the selection's place and size on the board.
// Writes frame.1.json and render.1.png into a new folder and returns the card. With mem (the studio on a picture, wrapPic) nothing is
// written: the files are blob URLs in mem under their paths (version 0, the studio's first Save writes version 1), the render at most
// 2048 px a side, as it is only the card's look and the studio's first picture while the layers load.
async function buildFrame(ids, name, nat, mem = null) {
  const R = Object.fromEntries(ids.map(id => [id, HY.rectOf(id)]));
  const x0 = Math.min(...ids.map(id => R[id].x)), y0 = Math.min(...ids.map(id => R[id].y));
  const bb = { x: x0, y: y0, w: Math.max(...ids.map(id => R[id].x + R[id].w)) - x0, h: Math.max(...ids.map(id => R[id].y + R[id].h)) - y0 };
  let best = null;
  ids.forEach(id => { const it = HY.board.items[id], n = nat[it.path]; if (!n) return; const c = it.crop || [0, 0, 1, 1], pw = n[0] * (c[2] - c[0]), ph = n[1] * (c[3] - c[1]);
    if (!best || pw * ph > best.a) best = { a: pw * ph, s: pw / R[id].w }; });
  let s = best ? best.s : 1, capped = false;
  if (Math.max(bb.w, bb.h) * s > MAXDOC) { s = MAXDOC / Math.max(bb.w, bb.h); capped = true; }
  const W = clamp(Math.round(bb.w * s), 16, MAXDOC), H = clamp(Math.round(bb.h * s), 16, MAXDOC), sx = W / bb.w, sy = H / bb.h;
  const dir = `frames/${stamp()}`, V = mem ? 0 : 1, out = mem ? memPut(mem) : put, k = mem ? Math.min(1, 2048 / Math.max(W, H)) : 1;
  // a picture with a colour grade on the board brings it along: a Color Grading layer clipped to it, so the frame looks as the board did
  // (owner 2026-10-06); its board item, grade too, stays in board.item for «Разобрать фрейм»
  if (ids.some(id => HY.board.items[id].grade)) { try { await loadCG(); } catch {} }
  const layers = ids.flatMap((id, i) => { const it = HY.board.items[id], r = R[id];
    const pic = { id: `p${i + 1}_${Math.random().toString(36).slice(2, 6)}`, kind: "pic", name: it.path.split("/").pop().replace(/\.[^.]+$/, ""), path: it.path, crop: it.crop || null,
      x: (r.x - bb.x) * sx, y: (r.y - bb.y) * sy, w: r.w * sx, h: r.h * sy, rot: 0, flip: [false, false],
      visible: true, opacity: Math.round((it.opacity ?? 1) * 100), fill: 100, blend: "source-over", clip: false, locked: true,
      locks: { alpha: false, pixels: true, pos: false, all: false }, board: { id, item: JSON.parse(JSON.stringify(it)) } };
    if (!it.grade || !window.HyColorGrade) return [pic];
    return [pic, { id: `g${i + 1}_${Math.random().toString(36).slice(2, 6)}`, kind: "grade", name: t("Raw Editor"), params: window.HyColorGrade.normalize(it.grade),
      visible: true, opacity: 100, fill: 100, blend: "source-over", clip: true, locks: { alpha: false, pixels: false, pos: false, all: false } }]; });
  const doc = { version: 1, v: V, name, size: [W, H], background: "#ffffff", order: "bottom-to-top", layers, render: `${dir}/render.${V}.png`, created: new Date().toISOString() };
  // the first render: the pictures with their crop on white, as they lay on the board
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
  const x = c.getContext("2d"); x.setTransform(k, 0, 0, k, 0, 0); x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = "high";
  let cgr = null;
  for (const [j, l] of layers.entries()) {
    if (l.kind !== "pic") continue;
    let im; try { im = await loadImg(`/img?p=${enc(l.path)}`); } catch { continue; }
    const cr = l.crop || [0, 0, 1, 1], nw = im.naturalWidth, nh = im.naturalHeight, g = layers[j + 1] && layers[j + 1].kind === "grade" ? layers[j + 1] : null;
    let src = im, sx0 = cr[0] * nw, sy0 = cr[1] * nh, sw = (cr[2] - cr[0]) * nw, sh = (cr[3] - cr[1]) * nh;
    // a picture with a master mask on the board brings it as its layer's mask (as its grade comes as a clipped layer), at the layer's
    // pixels, and the first render shows it masked (owner 2026-10-06)
    const bm = l.board && l.board.item && l.board.item.mask;
    if (bm && bm.file) {
      try { const mc = await maskCanvas(bm, Math.round(sw), Math.round(sh), l.crop), mp = `${dir}/masks/${l.id}.${V}.png`;
        await out(mp, await new Promise(res => mc.toBlob(res, "image/png"))); l.mask = { file: mp, density: 100, feather: 0, on: true };
        const pc = document.createElement("canvas"); pc.width = mc.width; pc.height = mc.height; const px = pc.getContext("2d");
        px.drawImage(im, sx0, sy0, sw, sh, 0, 0, pc.width, pc.height); px.globalCompositeOperation = "destination-in"; px.drawImage(mc, 0, 0);
        src = pc; sx0 = sy0 = 0; sw = pc.width; sh = pc.height; } catch (e) { console.warn("[mask]", e); }
    }
    if (g) {   // the picture graded at its size in the frame, as the editor draws the clipped layer
      try { const pc = document.createElement("canvas"); pc.width = Math.max(1, Math.round(l.w * k)); pc.height = Math.max(1, Math.round(l.h * k));
        const px = pc.getContext("2d"); px.imageSmoothingQuality = "high"; px.drawImage(src, sx0, sy0, sw, sh, 0, 0, pc.width, pc.height);
        cgr = cgr || window.HyColorGrade.createRenderer(); src = cgr.render(pc, g.params, pc); sx0 = sy0 = 0; sw = pc.width; sh = pc.height; } catch (e) { console.warn("[grade]", e); }
    }
    x.globalAlpha = l.opacity / 100; x.drawImage(src, sx0, sy0, sw, sh, l.x, l.y, l.w, l.h);
  }
  if (cgr) cgr.destroy();
  const blob = await new Promise(res => c.toBlob(res, "image/png")); c.width = c.height = 0;
  await out(`${dir}/frame.${V}.json`, JSON.stringify(doc, null, 1));
  const rr = await out(`${dir}/render.${V}.png`, blob);
  return { capped, card: { type: TYPE, x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.w), h: Math.round(bb.h), name, doc: `${dir}/frame.${V}.json`,
    render: `${dir}/render.${V}.png`, v: V, rv: Math.round(rr.mtime / 1e6), size: [W, H], pics: [...new Set(layers.map(l => l.path).filter(Boolean))] } };
}

// «В один фрейм» (each = false) or «Каждый в свой фрейм» (each = true): one step to undo for all of it
async function makeFrames(sel, each) {
  if (making) return;
  const ids = picsOf([...new Set(sel)]);
  const others = sel.filter(id => HY.board.items[id] && !canGo(HY.board.items[id]));
  if (!ids.length) return HY.toast(t("Select images or a group with images to make a frame of"));
  if (others.length && !sel.some(id => HY.board.groups[id])) return HY.toast(t("Only images go into a frame: deselect the rest"));
  making = true;
  try {
    const its = ids.map(id => HY.board.items[id]);
    const nat = await naturalSizes([...new Set(its.map(it => it.path))], its);
    const made = []; let capped = false;
    if (each) for (let i = 0; i < ids.length; i++) { const r = await buildFrame([ids[i]], frameName(i), nat); made.push(r.card); capped = capped || r.capped; }
    else { const r = await buildFrame(ids, frameName(), nat); made.push(r.card); capped = r.capped; }
    const before = HY.snap(), nids = [];
    ids.forEach(i => delete HY.board.items[i]);
    Object.values(HY.board.groups).forEach(g => { g.members = g.members.filter(m => HY.board.items[m]); });
    made.forEach(card => { const id = HY.uid("f"); HY.board.items[id] = card; nids.push(id); });
    HY.regroup(nids); HY.sel = new Set(nids);   // the cards fall into the groups their pictures were in
    HY.commit(before, capped ? t("Frame reduced to 8000 px: the images lie far apart")
      : each ? t("{frames}: each image in its own, double-click opens the editor", { frames: framesWord(made.length) }) : t("Frame: {pics} inside, double-click opens the editor", { pics: picsWord(ids.length) }));
    preload();
  } catch (e) { HY.toast(t("Frame not made: {e}", { e: e.message }), "error"); }
  finally { making = false; }
}

// «Разобрать фрейм»: the pictures go back onto the board where they lie in the frame (one step to undo); the frame's folder stays
async function explode(id) {
  const it = HY.board.items[id]; if (!it) return;
  let doc; try { const r = await fetch(fileUrl(it.doc, Date.now()), { cache: "no-store" }); if (!r.ok) throw new Error(r.status); doc = await r.json(); }
  catch (e) { return HY.toast(t("Frame not read: {e}", { e: e.message }), "error"); }
  const ls = docLayers(doc.layers); if (!ls.length) return HY.toast(t("The frame has no images from the library"));
  const [W] = doc.size, k = it.w / W;
  const nat = await naturalSizes([...new Set(ls.filter(l => !(l.board && l.board.item && l.board.item.ar)).map(l => l.path))]);
  const cur = HY.board.items[id]; if (!cur) return;
  const before = HY.snap(), ids = [];
  delete HY.board.items[id];
  Object.values(HY.board.groups).forEach(g => { g.members = g.members.filter(m => HY.board.items[m]); });
  for (const l of ls) {
    const o = (l.board && l.board.item) || {}, was = l.board && l.board.id, pid = was && !HY.board.items[was] ? was : HY.uid("i");
    const n = nat[l.path], ar = o.ar || (n ? n[0] / n[1] : Math.abs(l.w / l.h));
    const p = { ...o, path: l.path, x: Math.round(cur.x + l.x * k), y: Math.round(cur.y + l.y * k), w: Math.round(Math.abs(l.w) * k), ar, crop: l.crop || null };
    if ((l.opacity ?? 100) < 100) p.opacity = Math.round(l.opacity) / 100; else delete p.opacity;
    if (cur.grade && !p.grade) p.grade = JSON.parse(JSON.stringify(cur.grade));   // the frame's main grade stays on its pictures
    HY.board.items[pid] = p; ids.push(pid);
  }
  HY.regroup(ids); HY.sel = new Set(ids);
  HY.commit(before, t("Unframed: {pics} back on the board", { pics: picsWord(ids.length) }));
}

// The image studio on a picture (the dock's Image, a double click on the picture: owner 2026-10-07). The studio edits frames, so the
// picture becomes a frame of its own under its own id and in its place, with no step in the board's history: a Save makes it one step
// (the picture before, the frame after), leaving without a Save puts the picture back as it was. The file is never written
async function wrapPic(id) {
  const it = HY.board.items[id]; if (making || !it || !canGo(it)) return null;
  making = true; editorFrame();   // the studio's page loads while the frame is made
  if (HY.busy) HY.busy("studio", t("Opening the image studio"), id);   // the dock's sweep, on the card too, until the studio shows
  try {
    dropMem();
    const nat = await naturalSizes([it.path], [it]), r = await buildFrame([id], frameName(), nat, MEM);
    try { await loadImg(MEM[r.card.render]); } catch {}   // decoded before the card shows it: no empty card on the way in
    const cur = HY.board.items[id]; if (!cur || !canGo(cur) || cur.path !== it.path || PENDING !== id) { dropMem(); return null; }   // the picture left, or Esc
    const before = HY.snap();
    HY.board.items[id] = r.card; HY.sel = new Set([id]); HY.render();
    // the studio starts from the card's picture while its layers load (host.preview): wait for it, briefly
    const im = document.querySelector(`.plg[data-id="${CSS.escape(id)}"] img.ifr`);
    if (im && !(im.complete && im.naturalWidth)) await new Promise(ok => { const tm = setTimeout(ok, 1000), end = () => { clearTimeout(tm); ok(); };
      im.addEventListener("load", end, { once: true }); im.addEventListener("error", end, { once: true }); });
    return { pic: cur, card: r.card, before };
  } catch (e) { dropMem(); HY.toast(t("Frame not made: {e}", { e: e.message }), "error"); return null; }
  finally { making = false; if (HY.busy) HY.busy("studio", null, id); }
}
function unwrap(id, wrap) { if (wrap && isFrame(HY.board.items[id])) { HY.board.items[id] = wrap.pic; HY.render(); } }
let PENDING = null;   // the picture whose frame wrapPic is making: the switch shows Image at once, Esc or Board call it off

/* ================= the editor in place ================= */
// The editor page is loaded ahead of time, hidden, once the board has a frame (owner 2026-10-05: «opening took 5 s»): a double click
// then only hands it the frame. After each exit the page loads again in the background, so every opening starts clean.
let EDF = null, edReady = null, preT = 0;
function editorFrame() {
  if (EDF) return edReady;
  const wrap = document.createElement("div"); wrap.className = "ifed";
  const f = document.createElement("iframe"); f.title = t("Frame editor"); f.setAttribute("allowtransparency", "true");
  wrap.appendChild(f); HY.stage.appendChild(wrap);
  EDF = { wrap, f };
  const ready = () => new Promise(res => {
    const done = () => { const w = f.contentWindow; if (w && w.__ed && w.__ed.open) res(w); else setTimeout(done, 40); };
    f.addEventListener("load", done, { once: true });
  });
  edReady = ready(); f.src = `${BASE}editor/index.html?embed=1`;
  EDF.reload = () => { edReady = ready(); f.src = `${BASE}editor/index.html?embed=1&t=${Date.now()}`; };
  return edReady;
}
function preload() { clearTimeout(preT); preT = setTimeout(() => { if (!EDF) editorFrame(); }, 900); }

// the document's pixels on the board: the card's top left and world units per document pixel, fixed while the editor is open (a Canvas
// Size or a Crop moves pixels inside the document, its origin stays at the card's corner)
function camBridge(it) {
  const k = it.w / (it.size && it.size[0] ? it.size[0] : it.w);
  const off = () => { const s = HY.stage.getBoundingClientRect(), w = EDF.wrap.getBoundingClientRect(); return { x: w.left - s.left, y: w.top - s.top }; };
  return {
    // the board's camera as the editor's view: document px -> the editor's own window
    view() { const c = HY.cam, o = off(); return { s: c.z * k, x: (it.x - c.x) * c.z - o.x, y: (it.y - c.y) * c.z - o.y }; },
    // the editor's view back into the board's camera (one camera: the board pans and zooms with the editor)
    set(V, moving) { const o = off(), z = V.s / k; HY.camera(it.x - (V.x + o.x) / z, it.y - (V.y + o.y) / z, z, moving); },
  };
}

async function openEditor(id, wrap = null) {
  const it = HY.board.items[id]; if (!it || ED || making) { if (wrap) dropMem(); return unwrap(id, wrap); }
  // what the board was before: Esc, Cancel or Save bring back this selection and view (owner 2026-10-07)
  const back = { sel: [...HY.sel], cam: { x: HY.cam.x, y: HY.cam.y, z: HY.cam.z } };
  ED = { id, opening: true };
  const win = await editorFrame();
  const card = document.querySelector(`.plg[data-id="${CSS.escape(id)}"]`), img = card && card.querySelector("img.ifr");
  const host = {
    id, item: JSON.parse(JSON.stringify(it)), cam: camBridge(it), plugin: PLUGIN, mem: wrap ? MEM : null,
    preview: card && it.grade && card.querySelector(":scope > canvas.grd") || (img && img.complete && img.naturalWidth ? img : null),   // the graded look while the layers load
    saved: res => saved(id, res), closing, closed, leave, toast: (t, k) => HY.toast(t, k),
    toggleLib: () => { try { parent !== window && parent.postMessage({ type: "toggleCanvasFull" }, location.origin); } catch {} },
    zoom: t => { const z = $("#ifZoom"); if (z && z.textContent !== t) z.textContent = t; },
    name: n => { const s = $("#cIfr .ifn"); if (s) s.textContent = n; },
    rename: () => renameStep(),
  };
  ED = { id, win, host, card, wrap, back };
  EDF.wrap.classList.add("on");
  win.__ed.open(host);   // draws the frame where it lies, in this same frame of the screen
  if (card) card.classList.add("ifhide");
  // the board around: dimmed except the frame, its chrome out, the crumb gains the frame, the dock becomes the editor's
  veil(it, true);
  document.documentElement.classList.add("ifedit");
  crumbStep(it.name || t("Frame"));
  dockSwap(editorDock());
  try { EDF.f.contentWindow.focus(); } catch {}
}
// the editor starts its way out: the board comes back under it with the same moves (the frame's card already shows the saved render)
function closing() {
  if (!ED) return; const { card } = ED;
  if (card) card.classList.remove("ifhide");
  if (ED.wrap) { unwrap(ED.id, ED.wrap); ED.wrap = null; }   // left without a Save: the picture, as it was
  veil(null, false); document.documentElement.classList.remove("ifedit");
  crumbStep(null); dockSwap(null);
  try { EDF.f.blur(); window.focus(); } catch {}   // the keys go to the board again (⌘Z right after a Save undoes it on the board)
}
function closed() {
  if (!ED) return; const { back } = ED; ED = null;
  EDF.wrap.classList.remove("on"); EDF.reload(); dropMem();
  if (back) HY.sel = new Set(back.sel.filter(i => HY.board.items[i] || HY.board.groups[i]));
  HY.render();
  if (back) glide(back.cam);
}
// the board's camera eases back to where it was before the studio opened (the studio pans and zooms the board's own camera)
function glide(to) {
  const c0 = { x: HY.cam.x, y: HY.cam.y, z: HY.cam.z };
  if (Math.abs(c0.z / to.z - 1) < 1e-4 && Math.abs(c0.x - to.x) * c0.z < .5 && Math.abs(c0.y - to.y) * c0.z < .5) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return HY.camera(to.x, to.y, to.z, false);
  // the zoom eases in its own measure (log), the screen's centre moves on a straight line between the two views
  const r = HY.stage.getBoundingClientRect(), D = 450, t0 = performance.now(), ease = k => 1 - Math.pow(1 - k, 3);
  const step = now => {
    if (ED) return;   // the studio opened again
    const k = Math.min(1, (now - t0) / D), e = ease(k), z = Math.exp(Math.log(c0.z) + (Math.log(to.z) - Math.log(c0.z)) * e);
    const cx = r.width / 2, cy = r.height / 2;
    const wx = c0.x + cx / c0.z + (to.x + cx / to.z - c0.x - cx / c0.z) * e, wy = c0.y + cy / c0.z + (to.y + cy / to.z - c0.y - cy / c0.z) * e;
    if (k < 1) { HY.camera(wx - cx / z, wy - cy / z, z, true); requestAnimationFrame(step); } else HY.camera(to.x, to.y, to.z, false);
  };
  requestAnimationFrame(step);
}
function closeNow() { if (!ED || !ED.win) return; try { ED.win.__ed.exit(); } catch { closing(); closed(); } }
// Home and the project go on through the board's own crumb buttons once the editor is gone; the board and the page are where it was
function leave(where) {
  closing(); closed();
  const b = document.querySelector(where === "home" ? "#cHome" : where === "project" ? "#cFolder" : "#none");
  if (b && !b.hidden) setTimeout(() => b.click(), 60);
}
// the editor saved: the card shows the new version (one step to undo on the board); a document that changed its shape (Canvas Size,
// Crop) keeps the card's place and width, its height follows. Resolves once the card shows the new render, so the editor leaves over
// the same picture
function saved(id, res) {
  // a picture opened in the studio: its first Save is one step from the picture to the frame (wrapPic); the board read again from its
  // file meanwhile has the picture there, the frame comes back under the same id
  const w = ED && ED.id === id && ED.wrap; if (w) { ED.wrap = null; if (!isFrame(HY.board.items[id])) HY.board.items[id] = w.card; }
  const it = HY.board.items[id]; if (!it || !res) return Promise.resolve();
  const before = w ? w.before : HY.snap();
  Object.assign(it, { rv: res.rv, size: res.size, name: res.name || it.name, pics: res.pics || it.pics });
  if (res.doc) { it.doc = res.doc; it.render = res.render; it.v = res.v; }
  if (res.alpha) it.alpha = true; else delete it.alpha;
  if ("grade" in res) { if (res.grade) it.grade = res.grade; else delete it.grade; }   // the studio's main grade is the card's grade
  if ("mask" in res) { if (res.mask) it.mask = res.mask; else delete it.mask; }   // its master mask is the card's mask (mask.js)
  const nh = Math.round(it.w * res.size[1] / res.size[0]); if (Math.abs(nh - it.h) > 1) it.h = nh;
  HY.commit(before, t("“{name}” saved: {size}", { name: it.name, size: `${res.size[0]}×${res.size[1]}` }) + (res.v ? t(", version {v}", { v: String(res.v) }) : ""));
  return new Promise(ok => {
    const img = document.querySelector(`.plg[data-id="${CSS.escape(id)}"] img.ifr`), t = setTimeout(ok, 4000);
    if (!img) { clearTimeout(t); return ok(); }
    const want = fileUrl(it.render, it.rv), check = () => { if (img._u === want && img.complete && img.naturalWidth) { clearTimeout(t); (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(ok); } else setTimeout(check, 30); };
    check();
  });
}
// the rest of the board dims around the frame (four bands in board units, so they move with the camera and leave the frame alone)
function veil(it, on) {
  let v = document.getElementById("ifveil");
  if (!v) { v = document.createElement("div"); v.id = "ifveil"; v.innerHTML = "<i></i><i></i><i></i><i></i>"; const w = document.getElementById("world"); (w || HY.stage).appendChild(v); }
  if (it) { const B = 4e6, [t, b, l, r] = v.children, x = it.x, y = it.y, w = it.w, h = it.h;
    Object.assign(t.style, { left: -B + "px", top: -B + "px", width: 2 * B + "px", height: B + y + "px" });
    Object.assign(b.style, { left: -B + "px", top: y + h + "px", width: 2 * B + "px", height: B + "px" });
    Object.assign(l.style, { left: -B + "px", top: y + "px", width: B + x + "px", height: h + "px" });
    Object.assign(r.style, { left: x + w + "px", top: y + "px", width: B + "px", height: h + "px" }); }
  v.classList.toggle("on", !!on);
}
// the frame's name joins the board's crumb (Home › project › board › page › frame); a click opens the editor's frame menu
function crumbStep(name) {
  const cr = $("#crumb"); if (!cr) return;
  let st = $("#cIfr"), sp = $("#cIfrSep");
  if (name == null) { if (st) { st.classList.remove("in"); sp.classList.remove("in"); setTimeout(() => { if (!ED) { st.remove(); sp.remove(); } }, 400); } return; }
  if (!st) {
    sp = document.createElement("span"); sp.className = "cs ifcs"; sp.id = "cIfrSep"; sp.innerHTML = window.HY_CHEV || "›";
    st = document.createElement("button"); st.id = "cIfr"; st.innerHTML = `<i class="ifdot"></i><span class="ifn"></span>`;
    st.addEventListener("click", e => { e.stopPropagation(); if (ED && ED.win) { const r = st.getBoundingClientRect(), w = EDF.wrap.getBoundingClientRect(); ED.win.__ed.frameMenu(r.left - w.left, r.bottom - w.top + 8); } });
    st.addEventListener("dblclick", e => { e.stopPropagation(); renameStep(); });
    cr.append(sp, st);
  }
  st.querySelector(".ifn").textContent = name;
  requestAnimationFrame(() => { st.classList.add("in"); sp.classList.add("in"); });
}
function renameStep() {
  const st = $("#cIfr"); if (!st || !ED) return; const s = st.querySelector(".ifn"), old = s.textContent;
  const inp = document.createElement("input"); inp.value = old; inp.spellcheck = false; s.textContent = ""; s.appendChild(inp); inp.focus(); inp.select();
  let fin = false; const done = ok => { if (fin) return; fin = true; const v = inp.value.trim(); s.textContent = ok && v ? v : old; if (ok && v && v !== old && ED) ED.win.__ed.setName(v); try { EDF.f.contentWindow.focus(); } catch {} };
  inp.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); });
  inp.addEventListener("blur", () => done(true));
}
// the board's dock becomes the editor's (zoom and Actions); its width eases from one to the other
function editorDock() {
  const n = document.createElement("span");
  n.innerHTML = `<button class="wide" id="ifZoom" title="${t("Fit on screen · ⌘0")}">100%</button><span class="sep"></span><button class="wide" id="ifActs" title="${t("Actions · ⌘K")}">${IC.cmd}${t("Actions")}<kbd>⌘K</kbd></button>`;
  n.querySelector("#ifZoom").onclick = () => ED && ED.win && ED.win.__ed.fitView();
  n.querySelector("#ifActs").onclick = () => { if (ED && ED.win) { const e = ED.win.__ed; e.actsOpen() ? e.closeActs() : e.openActs(); } };
  return n;
}
function dockSwap(node) {
  const d = $("#dock"); if (!d) return HY.dock(node);
  const w0 = d.getBoundingClientRect().width; HY.dock(node); const w1 = d.getBoundingClientRect().width;
  if (!w0 || !w1 || Math.abs(w0 - w1) < 1) return;
  d.style.transition = "none"; d.style.width = w0 + "px"; d.offsetWidth;
  d.style.transition = "width .42s cubic-bezier(.3,.8,.25,1)"; d.style.width = w1 + "px";
  clearTimeout(dockSwap.t); dockSwap.t = setTimeout(() => { d.style.width = ""; d.style.transition = ""; }, 460);
}
// while the editor is open the board's crumb speaks for it: Home and the project leave through the editor (it asks about saving),
// the board and the page close it
document.addEventListener("click", e => {
  if (!ED || !ED.win) return; const b = e.target.closest && e.target.closest("#cHome, #cFolder, #cProj, #cPage"); if (!b) return;
  e.preventDefault(); e.stopImmediatePropagation();
  ED.win.__ed.leaveTo(b.id === "cHome" ? "home" : b.id === "cFolder" ? "project" : b.id === "cProj" ? "board" : "page");
}, true);
["pointerdown", "dblclick"].forEach(t => document.addEventListener(t, e => { if (ED && e.target.closest && e.target.closest("#cHome, #cFolder, #cProj, #cPage")) { e.preventDefault(); e.stopImmediatePropagation(); } }, true));

// a frame's own round badge in the card's corner, where a picture shows its copy mark (owner 2026-10-05: «recognisable at a glance at
// any zoom»); a card that copies another frame (the same folder, later on the board) shows the copy mark beside it
const FRAME_SVG = hyIcon("frame", 0, 2.2);   // a frame's badge: the board's marks' line
const folderOf = it => String(it.doc || "").replace(/\/[^/]*$/, "");
function isCopy(id, it) { const f = folderOf(it); for (const [k, o] of Object.entries(HY.board.items)) { if (k === id) return false; if (isFrame(o) && folderOf(o) === f) return true; } return false; }
function card(el, it, id) {
  let img = el.querySelector("img.ifr");
  if (!img) {
    // the board's marks (review/canvas.html .mk, owner 2026-10-06: one system for every mark): the # and the copy mark in the bottom left row,
    // sized, folded away and brought back by the board's law; .mk-on says the mark is there
    el.innerHTML = `<img class="ifr" alt="" decoding="async" draggable="false"><span class="mk mk-bl mk-frame mk-on ifb">${FRAME_SVG}</span>`
      + `<span class="mk mk-bl mk-dup ifc" title="${t("Copy: this frame is already on the board")}">${window.hyMarkIcon ? window.hyMarkIcon("copy") : ""}</span>`; img = el.querySelector("img.ifr");
    img.addEventListener("load", () => { el.classList.add("lo"); el.classList.remove("miss"); });
    img.addEventListener("error", () => el.classList.add("miss"));
  }
  const u = MEM[it.render] || fileUrl(it.render, it.rv); if (img._u !== u) { img._u = u; img.src = u; }
  el.classList.toggle("see", !!it.alpha);
  el.querySelector(".ifb").title = t("Frame · {size} px", { size: (it.size || [0, 0]).join("×") });
  const copy = !!id && isCopy(id, it); el.classList.toggle("ifcopy", copy); el.querySelector(".ifc").classList.toggle("mk-on", copy);
  dress(el, it);   // the colour grade over the render (grade.js)
  dressMask(el, it);   // the master mask (mask.js)
  preload();
}

// the selection's frame actions, for the right click and the bar over the selection
function actions(ids) {
  const its = ids.map(i => HY.board.items[i]);
  if (ids.length && its.every(isFrame)) return [{ icon: IC.open, label: t("Open"), keys: "↵", title: t("Open frame editor · Enter"), fn: () => openEditor(ids[0]) }];
  const pics = picsOf(ids), hasGroup = ids.some(i => HY.board.groups[i]);
  if (!pics.length || (!hasGroup && !its.every(it => it && canGo(it)))) return [];
  const out = [{ icon: IC.frame, label: t("Make frame"), keys: "⌥⌘G", title: t("All {pics} in one frame · ⌥⌘G", { pics: picsWord(pics.length) }), fn: () => makeFrames(ids, false) }];
  if (pics.length > 1) out.push({ icon: IC.each, label: t("Frame each ({n})", { n: String(pics.length) }), keys: "⌥⇧⌘G", title: t("Each image in its own frame, in its place · ⌥⇧⌘G"), fn: () => makeFrames(ids, true) });
  return out;
}

export function register(hy) {
  HY = hy; t = translator(hy);
  const st = document.createElement("style"); st.textContent = `
    /* frames are purple, not blue (owner 2026-10-05: «so it's clear what they are»): one token, a deeper one on the light theme */
    :root { --frame: #8b5cf6; } :root[data-theme=light] { --frame: #7c3aed; }
    .plg[data-type=${TYPE}] { background: var(--raise); } .plg[data-type=${TYPE}].lo.see { background: transparent; }
    .plg[data-type=${TYPE}].sel { outline-color: var(--frame); }
    .plg[data-type=${TYPE}]:hover:not(.sel) { outline: calc(1.5px / var(--z)) solid color-mix(in srgb, var(--frame) 70%, transparent); outline-offset: calc(2px / var(--z)); }
    .plg[data-type=${TYPE}] img.ifr { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
    .plg[data-type=${TYPE}].ifhide img.ifr { visibility: hidden; }
    /* the # and the copy mark are the board's marks (.mk: size, place, law), in the frame's purple, the copy mark too (owner 2026-10-06:
       «когда мы скопировали frame у нас вот этот символ дубля как раз становится фиолетовым тоже»); red while the render is missing */
    .plg[data-type=${TYPE}] .mk:is(.mk-frame, .mk-dup) { --mkg: var(--frame); --mkgh: var(--frame); }
    .plg[data-type=${TYPE}].miss .mk-frame { --mkg: var(--red, #ff453a); }
    /* the editor: a transparent page over the whole board, hidden until a frame opens. An open library floats over its left part as it
       floats over the board (owner 2026-10-06: «opening the media library doesn't move the rulers»): the page stays where it is, so its
       rulers keep to the window's edges; it reads --inset from this root and moves only its tool rail and options bar out from under */
    .ifed { position: absolute; inset: 0; z-index: 1100; visibility: hidden; pointer-events: none; }
    .ifed.on { visibility: visible; pointer-events: auto; }
    .ifed iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
    /* the board around the open frame: the rest dims, its own chrome steps aside; the crumb and the dock stay over the editor */
    #ifveil { position: absolute; left: 0; top: 0; pointer-events: none; opacity: 0; z-index: 3; transition: opacity .45s cubic-bezier(.3,.8,.25,1); }
    #ifveil.on { opacity: 1; }
    #ifveil i { position: absolute; background: color-mix(in srgb, var(--board, #17171a) 58%, transparent); }
    :is(#info, #handles, #bhist, #bkeys, #bntf, #bset, #ntf, #hist, #sets, #keys, #pv, #jump, #hint, #ctx) { transition: opacity .25s cubic-bezier(.3,.8,.25,1); }
    html.ifedit :is(#info, #handles, #bhist, #bkeys, #bntf, #bset, #ntf, #hist, #sets, #keys, #pv, #jump, #hint, #ctx) { opacity: 0 !important; pointer-events: none !important; }
    html.ifedit #crumb, html.ifedit #dock { z-index: 1200 !important; }
    html.ifedit #modetip { z-index: 1201 !important; }   /* the dock's mode switch tooltip (review/ui/modes.js) over the editor with the dock */
    #crumb .ifcs, #cIfr { max-width: 0; opacity: 0; overflow: hidden; transition: max-width .4s cubic-bezier(.3,.8,.25,1), opacity .3s cubic-bezier(.3,.8,.25,1); }
    #crumb .ifcs.in { max-width: 16px; opacity: 1; } #cIfr.in { max-width: 260px; opacity: 1; }
    #cIfr { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; color: var(--ink); }
    #cIfr .ifdot { width: 9px; height: 9px; border-radius: 3px; background: var(--frame); flex: none; }
    #cIfr input { font: inherit; color: inherit; background: transparent; border: 0; outline: none; width: 160px; }
    #dock .plgdock > * { animation: ifIn .35s cubic-bezier(.3,.8,.25,1) both; }
    @keyframes ifIn { from { opacity: 0; } }`;
  document.head.appendChild(st);
  hy.register(TYPE, {
    color: "var(--frame)", opacity: true,   // the pictures' opacity on the bar and the keys 1…9, 0 (owner 2026-10-06)
    render(el, it, id) { card(el, it, id || el.dataset.id); },
    dblclick(id) { openEditor(id); },
    // ⌥⌘G one frame, ⌥⇧⌘G a frame each (⌘G stays the board's group); Enter opens a selected frame; while the editor covers the board
    // the board takes no keys
    onKey(e) {
      if (ED) return true;
      if (PENDING && e.key === "Escape") { e.preventDefault(); PENDING = null; HY.modeChanged(); return true; }   // the studio was on its way
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === "KeyG") {
        const ids = [...HY.sel].filter(id => HY.board.items[id] || HY.board.groups[id]); if (!ids.length) return false;
        e.preventDefault(); makeFrames(ids, e.shiftKey); return true;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const ids = [...HY.sel]; if (ids.length && ids.every(id => isFrame(HY.board.items[id]))) { e.preventDefault(); openEditor(ids[0]); return true; }
      }
      return false;
    },
    info(id, it) {
      const n = (it.pics || []).length;
      return { name: it.name || t("Frame"), meta: `${(it.size || [0, 0]).join("×")} px · ${picsWord(n)}` + (it.v ? t(" · version {v}", { v: String(it.v) }) : "") + ` · ${it.doc}`,
        text: t("Double-click or Enter: the editor · the images inside never change") };
    },
  });
  hy.ctx((ids, id) => {
    const its = ids.map(i => HY.board.items[i]);
    // a Hyimg that greys what does not apply (HY.menuOff, owner 2026-10-06: «I want users to know what functions exist»): one fixed list
    // for any selection, each item with its reason when it does not apply; an older one gets only what applies
    if (hy.menuOff) {
      if (!ids.length) return [];
      const one = ids.length === 1 && isFrame(its[0]), notOne = ids.length > 1 ? t("Select one frame") : t("Only for a frame");
      const pics = picsOf(ids), can = pics.length && (ids.some(i => HY.board.groups[i]) || its.every(it => it && canGo(it)));
      const why = its.some(isFrame) ? t("This is already a frame") : !can ? t("Only images go into a frame") : "";
      return [
        { icon: IC.open, label: t("Open frame editor"), keys: ["↵"], off: one ? "" : notOne, fn: () => openEditor(ids[0]) },
        { icon: IC.unframe, label: t("Unframe"), off: one ? "" : notOne, fn: () => explode(ids[0]) },
        { icon: IC.frame, label: t("Make frame"), keys: ["⌥", "⌘", "G"], off: why, fn: () => makeFrames(ids, false) },
        { icon: IC.each, label: !why && pics.length > 1 ? t("Frame each ({n})", { n: String(pics.length) }) : t("Frame each"), keys: ["⌥", "⇧", "⌘", "G"],
          off: why || (pics.length < 2 ? t("Only for 2 images or more") : ""), fn: () => makeFrames(ids, true) },
      ];
    }
    if (ids.length === 1 && isFrame(its[0]))
      return [{ icon: IC.open, label: t("Open frame editor"), keys: ["↵"], fn: () => openEditor(ids[0]) }, { icon: IC.unframe, label: t("Unframe"), fn: () => explode(ids[0]) }];
    return actions(ids).map(a => ({ icon: a.icon, label: a.label, keys: a.keys.match(/[⌥⇧⌘]|↵|[A-Z]/g), fn: a.fn }));
  });
  if (hy.bar) hy.bar(ids => actions(ids.filter(id => HY.board.items[id] || HY.board.groups[id])));
  registerGrade(hy);   // after the frame's own buttons on the bar and in the menu
  registerMask(hy);
  // the image studio is a mode of the board's dock switch (owner 2026-10-06: «Board mode, Image mode, Dev mode and 3D studio»): chosen while
  // the frame editor is open, enabled when one frame or one picture is selected. A frame opens; a picture opens as a frame of its own that
  // stays only when it is saved (wrapPic; a double click on a picture comes here too, owner 2026-10-07). Leaving is the editor's own way
  // out (it asks about unsaved changes); the board's selection and view come back as they were
  if (hy.mode) hy.mode("image", { label: t("Image"), order: 10, icon: hyIcon("image", 16),
    title: t("Image studio for the selected frame or image"), hint: t("Select one image or frame: the image studio opens for it"),
    isOpen: () => !!ED || !!PENDING,
    target: ids => { const it = ids.length === 1 && HY.board.items[ids[0]]; return it && (isFrame(it) || canGo(it)) ? ids[0] : null; },
    async enter(id) {
      if (isFrame(HY.board.items[id])) return openEditor(id);
      PENDING = id; HY.modeChanged();   // Image at once; the card shimmers while its frame is made
      const w = await wrapPic(id), go = PENDING === id; PENDING = null;
      if (w && go) return openEditor(id, w);
      if (w) { unwrap(id, w); dropMem(); }
      HY.modeChanged();
    },
    leave: () => { if (PENDING) { PENDING = null; HY.modeChanged(); return; } closeNow(); },
  });
  if (Object.values(HY.board.items).some(isFrame)) preload();
  window.__frames = { openEditor, makeFrames, explode, closeNow, get ED() { return ED; }, get EDF() { return EDF; }, picsOf, naturalSizes };
}
