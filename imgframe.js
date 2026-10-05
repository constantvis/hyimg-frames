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
const TYPE = "imgframe", MAXDOC = 8000, KEEP = 10;
const s15 = d => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  frame: s15('<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>'),
  each: s15('<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>'),
  open: s15('<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>'),
  unframe: s15('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M14 6.5h3.5V10M10 17.5H6.5V14"/>'),
  cmd: s15('<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>'),
};
const BASE = new URL(".", import.meta.url).pathname;   // /plugins/<this plugin>/
const PLUGIN = (BASE.match(/^\/plugins\/([^/]+)\//) || [])[1] || "frames";
const enc = encodeURIComponent, fileUrl = (p, v) => `/file?p=${enc(p)}` + (v ? `&v=${v}` : "");
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const plural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;
const picsWord = n => `${n} ${plural(n, "картинка", "картинки", "картинок")}`;
const framesWord = n => `${n} ${plural(n, "фрейм", "фрейма", "фреймов")}`;
const $ = s => document.querySelector(s);
let HY, ED = null, making = false;   // ED: the open editor {id, ...}

const canGo = it => HY.isPic(it) && !VIDEO.test(it.path || "");   // pictures go in; a video frame is phase 2
const isFrame = it => !!it && it.type === TYPE;
const stamp = () => { const d = new Date(), z = n => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).slice(2)}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}-${Math.random().toString(36).slice(2, 5)}`; };
async function put(path, body) {
  const r = await fetch(`/api/file?p=${enc(path)}`, { method: "POST", body }); if (!r.ok) throw new Error(await r.text()); return r.json();
}
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = () => rej(new Error("нет картинки")); i.src = src; });
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
const frameName = (k = 0) => `Фрейм ${Object.values(HY.board.items).filter(isFrame).length + 1 + k}`;

// One frame of these pictures (not yet on the board): the document is their box in the pictures' own pixels, so the largest picture
// keeps its full resolution (owner 2026-10-05), at most 8000 px a side; the card takes the selection's place and size on the board.
// Writes frame.1.json and render.1.png into a new folder and returns the card.
async function buildFrame(ids, name, nat) {
  const R = Object.fromEntries(ids.map(id => [id, HY.rectOf(id)]));
  const x0 = Math.min(...ids.map(id => R[id].x)), y0 = Math.min(...ids.map(id => R[id].y));
  const bb = { x: x0, y: y0, w: Math.max(...ids.map(id => R[id].x + R[id].w)) - x0, h: Math.max(...ids.map(id => R[id].y + R[id].h)) - y0 };
  let best = null;
  ids.forEach(id => { const it = HY.board.items[id], n = nat[it.path]; if (!n) return; const c = it.crop || [0, 0, 1, 1], pw = n[0] * (c[2] - c[0]), ph = n[1] * (c[3] - c[1]);
    if (!best || pw * ph > best.a) best = { a: pw * ph, s: pw / R[id].w }; });
  let s = best ? best.s : 1, capped = false;
  if (Math.max(bb.w, bb.h) * s > MAXDOC) { s = MAXDOC / Math.max(bb.w, bb.h); capped = true; }
  const W = clamp(Math.round(bb.w * s), 16, MAXDOC), H = clamp(Math.round(bb.h * s), 16, MAXDOC), sx = W / bb.w, sy = H / bb.h;
  const dir = `frames/${stamp()}`;
  const layers = ids.map((id, i) => { const it = HY.board.items[id], r = R[id];
    return { id: `p${i + 1}_${Math.random().toString(36).slice(2, 6)}`, kind: "pic", name: it.path.split("/").pop().replace(/\.[^.]+$/, ""), path: it.path, crop: it.crop || null,
      x: (r.x - bb.x) * sx, y: (r.y - bb.y) * sy, w: r.w * sx, h: r.h * sy, rot: 0, flip: [false, false],
      visible: true, opacity: Math.round((it.opacity ?? 1) * 100), fill: 100, blend: "source-over", clip: false, locked: true,
      locks: { alpha: false, pixels: true, pos: false, all: false }, board: { id, item: JSON.parse(JSON.stringify(it)) } }; });
  const doc = { version: 1, v: 1, name, size: [W, H], background: "#ffffff", order: "bottom-to-top", layers, render: `${dir}/render.1.png`, created: new Date().toISOString() };
  // the first render: the pictures with their crop on white, as they lay on the board
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = "high";
  for (const l of layers) {
    let im; try { im = await loadImg(`/img?p=${enc(l.path)}`); } catch { continue; }
    const cr = l.crop || [0, 0, 1, 1], nw = im.naturalWidth, nh = im.naturalHeight;
    x.globalAlpha = l.opacity / 100; x.drawImage(im, cr[0] * nw, cr[1] * nh, (cr[2] - cr[0]) * nw, (cr[3] - cr[1]) * nh, l.x, l.y, l.w, l.h);
  }
  const blob = await new Promise(res => c.toBlob(res, "image/png")); c.width = c.height = 0;
  await put(`${dir}/frame.1.json`, JSON.stringify(doc, null, 1));
  const rr = await put(`${dir}/render.1.png`, blob);
  return { capped, card: { type: TYPE, x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.w), h: Math.round(bb.h), name, doc: `${dir}/frame.1.json`,
    render: `${dir}/render.1.png`, v: 1, rv: Math.round(rr.mtime / 1e6), size: [W, H], pics: [...new Set(layers.map(l => l.path))] } };
}

// «В один фрейм» (each = false) or «Каждый в свой фрейм» (each = true): one step to undo for all of it
async function makeFrames(sel, each) {
  if (making) return;
  const ids = picsOf([...new Set(sel)]);
  const others = sel.filter(id => HY.board.items[id] && !canGo(HY.board.items[id]));
  if (!ids.length) return HY.toast("Выдели картинки или группу с картинками, из которых сделать фрейм");
  if (others.length && !sel.some(id => HY.board.groups[id])) return HY.toast("Во фрейм идут только картинки: сними выделение с остального");
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
    HY.commit(before, capped ? "Фрейм уменьшен до 8000 px: картинки лежат далеко друг от друга"
      : each ? `${framesWord(made.length)}: каждая картинка в своем, двойной клик открывает редактор` : `Фрейм: ${picsWord(ids.length)} внутри, двойной клик открывает редактор`);
    preload();
  } catch (e) { HY.toast("Фрейм не сделан: " + e.message, "error"); }
  finally { making = false; }
}

// «Разобрать фрейм»: the pictures go back onto the board where they lie in the frame (one step to undo); the frame's folder stays
async function explode(id) {
  const it = HY.board.items[id]; if (!it) return;
  let doc; try { const r = await fetch(fileUrl(it.doc, Date.now()), { cache: "no-store" }); if (!r.ok) throw new Error(r.status); doc = await r.json(); }
  catch (e) { return HY.toast("Фрейм не прочитан: " + e.message, "error"); }
  const ls = docLayers(doc.layers); if (!ls.length) return HY.toast("Во фрейме нет картинок из библиотеки");
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
    HY.board.items[pid] = p; ids.push(pid);
  }
  HY.regroup(ids); HY.sel = new Set(ids);
  HY.commit(before, `Фрейм разобран: ${picsWord(ids.length)} снова на доске`);
}

/* ================= the editor in place ================= */
// The editor page is loaded ahead of time, hidden, once the board has a frame (owner 2026-10-05: «opening took 5 s»): a double click
// then only hands it the frame. After each exit the page loads again in the background, so every opening starts clean.
let EDF = null, edReady = null, preT = 0;
function editorFrame() {
  if (EDF) return edReady;
  const wrap = document.createElement("div"); wrap.className = "ifed";
  const f = document.createElement("iframe"); f.title = "Редактор фрейма"; f.setAttribute("allowtransparency", "true");
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

// the top window's notification stack (the canvas sends its notes up to the library page): its top while the editor is open
function toastRoot() { let w = window; try { while (w.parent !== w && w.parent.hyToast) w = w.parent; } catch {} return w.document.documentElement; }

async function openEditor(id) {
  const it = HY.board.items[id]; if (!it || ED || making) return;
  ED = { id, opening: true };
  const win = await editorFrame();
  const card = document.querySelector(`.plg[data-id="${CSS.escape(id)}"]`), img = card && card.querySelector("img.ifr");
  const host = {
    id, item: JSON.parse(JSON.stringify(it)), cam: camBridge(it), plugin: PLUGIN,
    preview: img && img.complete && img.naturalWidth ? img : null,
    saved: res => saved(id, res), closing, closed, leave, toast: (t, k) => HY.toast(t, k),
    toggleLib: () => { try { parent !== window && parent.postMessage({ type: "toggleCanvasFull" }, location.origin); } catch {} },
    zoom: t => { const z = $("#ifZoom"); if (z && z.textContent !== t) z.textContent = t; },
    name: n => { const s = $("#cIfr .ifn"); if (s) s.textContent = n; },
    rename: () => renameStep(),
  };
  ED = { id, win, host, card };
  EDF.wrap.classList.add("on");
  win.__ed.open(host);   // draws the frame where it lies, in this same frame of the screen
  if (card) card.classList.add("ifhide");
  // the board around: dimmed except the frame, its chrome out, the crumb gains the frame, the dock becomes the editor's
  veil(it, true);
  document.documentElement.classList.add("ifedit");
  crumbStep(it.name || "Фрейм");
  dockSwap(editorDock());
  toastRoot().style.setProperty("--toast-top", "60px");   // the notes stand under the editor's top line (owner 2026-10-05)
  try { EDF.f.contentWindow.focus(); } catch {}
}
// the editor starts its way out: the board comes back under it with the same moves (the frame's card already shows the saved render)
function closing() {
  if (!ED) return; const { card } = ED;
  if (card) card.classList.remove("ifhide");
  veil(null, false); document.documentElement.classList.remove("ifedit");
  crumbStep(null); dockSwap(null);
  toastRoot().style.removeProperty("--toast-top");
  try { EDF.f.blur(); window.focus(); } catch {}   // the keys go to the board again (⌘Z right after a Save undoes it on the board)
}
function closed() {
  if (!ED) return; ED = null;
  EDF.wrap.classList.remove("on"); EDF.reload();
  HY.render();
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
  const it = HY.board.items[id]; if (!it || !res) return Promise.resolve();
  const before = HY.snap();
  Object.assign(it, { rv: res.rv, size: res.size, name: res.name || it.name, pics: res.pics || it.pics });
  if (res.doc) { it.doc = res.doc; it.render = res.render; it.v = res.v; }
  if (res.alpha) it.alpha = true; else delete it.alpha;
  const nh = Math.round(it.w * res.size[1] / res.size[0]); if (Math.abs(nh - it.h) > 1) it.h = nh;
  HY.commit(before, `«${it.name}» сохранен: ${res.size[0]}×${res.size[1]}, версия ${res.v || ""}`.replace(/, версия $/, ""));
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
  n.innerHTML = `<button class="wide" id="ifZoom" title="Fit on screen · ⌘0">100%</button><span class="sep"></span><button class="wide" id="ifActs" title="Actions · ⌘K">${IC.cmd}Actions<kbd>⌘K</kbd></button>`;
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
const FRAME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 3v18M17 3v18M3 7h18M3 17h18"/></svg>`;
const COPY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`;
const folderOf = it => String(it.doc || "").replace(/\/[^/]*$/, "");
function isCopy(id, it) { const f = folderOf(it); for (const [k, o] of Object.entries(HY.board.items)) { if (k === id) return false; if (isFrame(o) && folderOf(o) === f) return true; } return false; }
function card(el, it, id) {
  let img = el.querySelector("img.ifr");
  if (!img) {
    el.innerHTML = `<img class="ifr" alt="" decoding="async" draggable="false"><span class="ifb">${FRAME_SVG}</span><span class="ifc" title="Копия: этот фрейм уже есть на доске">${COPY_SVG}</span>`; img = el.querySelector("img.ifr");
    img.addEventListener("load", () => { el.classList.add("lo"); el.classList.remove("miss"); });
    img.addEventListener("error", () => el.classList.add("miss"));
  }
  const u = fileUrl(it.render, it.rv); if (img._u !== u) { img._u = u; img.src = u; }
  el.classList.toggle("see", !!it.alpha);
  el.querySelector(".ifb").title = `Фрейм · ${(it.size || [0, 0]).join("×")} px`;
  el.classList.toggle("ifcopy", !!id && isCopy(id, it));
  preload();
}

// the selection's frame actions, for the right click and the bar over the selection
function actions(ids) {
  const its = ids.map(i => HY.board.items[i]);
  if (ids.length && its.every(isFrame)) return [{ icon: IC.open, label: "Открыть", keys: "↵", title: "Открыть редактор фрейма · Enter", fn: () => openEditor(ids[0]) }];
  const pics = picsOf(ids), hasGroup = ids.some(i => HY.board.groups[i]);
  if (!pics.length || (!hasGroup && !its.every(it => it && canGo(it)))) return [];
  const out = [{ icon: IC.frame, label: "В один фрейм", keys: "⌥⌘G", title: `Все ${picsWord(pics.length)} в один фрейм · ⌥⌘G`, fn: () => makeFrames(ids, false) }];
  if (pics.length > 1) out.push({ icon: IC.each, label: `Каждый в свой фрейм (${pics.length})`, keys: "⌥⇧⌘G", title: `Каждая картинка в свой фрейм, на ее месте · ⌥⇧⌘G`, fn: () => makeFrames(ids, true) });
  return out;
}

export function register(hy) {
  HY = hy;
  const st = document.createElement("style"); st.textContent = `
    /* frames are purple, not blue (owner 2026-10-05: «so it's clear what they are»): one token, a deeper one on the light theme */
    :root { --frame: #8b5cf6; } :root[data-theme=light] { --frame: #7c3aed; }
    .plg[data-type=${TYPE}] { background: var(--raise); } .plg[data-type=${TYPE}].lo.see { background: transparent; }
    .plg[data-type=${TYPE}].sel { outline-color: var(--frame); }
    .plg[data-type=${TYPE}]:hover:not(.sel) { outline: calc(1.5px / var(--z)) solid color-mix(in srgb, var(--frame) 70%, transparent); outline-offset: calc(2px / var(--z)); }
    .plg[data-type=${TYPE}] img.ifr { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
    .plg[data-type=${TYPE}].ifhide img.ifr { visibility: hidden; }
    .plg[data-type=${TYPE}] :is(.ifb, .ifc) { position: absolute; left: calc(6px / var(--z)); bottom: calc(6px / var(--z)); width: calc(22px / var(--z)); height: calc(22px / var(--z));
      border-radius: 999px; display: grid; place-items: center; background: var(--frame); color: #fff; }
    .plg[data-type=${TYPE}] :is(.ifb, .ifc) svg { width: 60%; height: 60%; }
    .plg[data-type=${TYPE}] .ifc { left: calc(32px / var(--z)); background: rgba(0,0,0,.65); display: none; }
    .plg[data-type=${TYPE}].ifcopy .ifc { display: grid; }
    .plg[data-type=${TYPE}].miss .ifb { background: var(--red, #ff453a); }
    /* the editor: a transparent page over the board, right of an open library; hidden until a frame opens */
    .ifed { position: absolute; top: 0; right: 0; bottom: 0; left: var(--inset, 0px); z-index: 1100; visibility: hidden; pointer-events: none; }
    .ifed.on { visibility: visible; pointer-events: auto; }
    .ifed iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: normal; }
    /* the board around the open frame: the rest dims, its own chrome steps aside; the crumb and the dock stay over the editor */
    #ifveil { position: absolute; left: 0; top: 0; pointer-events: none; opacity: 0; z-index: 3; transition: opacity .45s cubic-bezier(.3,.8,.25,1); }
    #ifveil.on { opacity: 1; }
    #ifveil i { position: absolute; background: color-mix(in srgb, var(--board, #17171a) 58%, transparent); }
    :is(#info, #handles, #bhist, #bkeys, #bntf, #bset, #ntf, #hist, #sets, #keys, #pv, #jump, #hint, #ctx) { transition: opacity .25s cubic-bezier(.3,.8,.25,1); }
    html.ifedit :is(#info, #handles, #bhist, #bkeys, #bntf, #bset, #ntf, #hist, #sets, #keys, #pv, #jump, #hint, #ctx) { opacity: 0 !important; pointer-events: none !important; }
    html.ifedit #crumb, html.ifedit #dock { z-index: 1200 !important; }
    #crumb .ifcs, #cIfr { max-width: 0; opacity: 0; overflow: hidden; transition: max-width .4s cubic-bezier(.3,.8,.25,1), opacity .3s cubic-bezier(.3,.8,.25,1); }
    #crumb .ifcs.in { max-width: 16px; opacity: 1; } #cIfr.in { max-width: 260px; opacity: 1; }
    #cIfr { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; color: var(--ink); }
    #cIfr .ifdot { width: 9px; height: 9px; border-radius: 3px; background: var(--frame); flex: none; }
    #cIfr input { font: inherit; color: inherit; background: transparent; border: 0; outline: none; width: 160px; }
    #dock .plgdock > * { animation: ifIn .35s cubic-bezier(.3,.8,.25,1) both; }
    @keyframes ifIn { from { opacity: 0; } }`;
  document.head.appendChild(st);
  hy.register(TYPE, {
    color: "var(--frame)",
    render(el, it, id) { card(el, it, id || el.dataset.id); },
    dblclick(id) { openEditor(id); },
    // ⌥⌘G one frame, ⌥⇧⌘G a frame each (⌘G stays the board's group); Enter opens a selected frame; while the editor covers the board
    // the board takes no keys
    onKey(e) {
      if (ED) return true;
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
      return { name: it.name || "Фрейм", meta: `${(it.size || [0, 0]).join("×")} px · ${picsWord(n)}` + (it.v ? ` · версия ${it.v}` : "") + ` · ${it.doc}`,
        text: "Двойной клик или Enter: редактор фрейма. Картинки внутри не меняются, каждый Save пишет новую версию рендера в папку фрейма (последние 10 остаются), ⌘Z на доске возвращает прошлую. Правый клик: «Разобрать фрейм» вернет картинки на доску." };
    },
  });
  hy.ctx((ids, id) => {
    const its = ids.map(i => HY.board.items[i]);
    if (ids.length === 1 && isFrame(its[0]))
      return [{ icon: IC.open, label: "Открыть редактор фрейма", keys: ["↵"], fn: () => openEditor(ids[0]) }, { icon: IC.unframe, label: "Разобрать фрейм", fn: () => explode(ids[0]) }];
    return actions(ids).map(a => ({ icon: a.icon, label: a.label, keys: a.keys.match(/[⌥⇧⌘]|↵|[A-Z]/g), fn: a.fn }));
  });
  if (hy.bar) hy.bar(ids => actions(ids.filter(id => HY.board.items[id] || HY.board.groups[id])));
  if (Object.values(HY.board.items).some(isFrame)) preload();
  window.__frames = { openEditor, makeFrames, explode, closeNow, get ED() { return ED; }, get EDF() { return EDF; }, picsOf, naturalSizes };
}
