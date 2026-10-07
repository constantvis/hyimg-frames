// Hyimg frames: the MASTER MASK of a picture or a frame card on the board (owner 2026-10-06: «a master mask for the whole object, working
// like the main colour grade»). The card shows its picture masked (transparent outside); the picture's file never changes. The mask is a
// png of its own (white where the picture shows, its alpha is what counts) kept with the card, never in it:
//   it.mask = {file, show?, density?, feather?}
// file is the mask itself; show, when there is one, its look with the studio's density and feather baked in (the board shows show || file).
// A frame's mask is drawn in the image studio (editor/index.html: the pinned «Mask» row under the main grade) and saved beside the frame's
// masks, versioned with each Save (frames/<stamp>/masks/main_mask.<n>.png); a picture's comes from «Mask from alpha» or a paste and lives
// in frames/board-masks/masks/ (one file per mask, never written again, never pruned), so undo on the board finds the one it goes back to.
// The card is masked by CSS (mask-image over the picture, its graded canvas too, at 100% × 100% of the picture): one mask fits any size,
// so a paste onto pictures of other sizes is the same file scaled to each. The far view's canvas shows the pictures unmasked, as it
// shows them ungraded. No mark on the card (owner 2026-10-06: the board's marks are placed by their own law; a masked card shows its mask
// itself, so a mark would only repeat it).
//
// Ways in: the right click on a picture or a frame «Mask from alpha» (a picture that can carry transparency: png, webp, gif, avif, heic,
// tiff, a frame with a transparent render) and «Clear mask»; copy and paste are the mask kind of the board's «Copy properties ›» /
// «Paste properties ›» (HY.props, owner 2026-10-06), maskProp {has, applies, get, set}: the value is the same file, each card scales it to
// its size. A Hyimg without HY.props gets «Copy mask» and «Paste mask» in the right click, through localStorage (hyimg.maskClip, as the
// grade's hyimg.gradeClip), so they work across boards; the image studio's own copy and paste use that clipboard too. The mask files are
// never pruned (frames/board-masks/ is no frame, inpaint/routes.py keeps a frame's main_mask files), so a pasted reference stays good.
import { translator } from "./lang.js";
const VIDEO = /\.(mp4|m4v|mov|webm)$/i, ALPHA = /\.(png|webp|gif|avif|heic|heif|tiff?)$/i;
const CLIPK = "hyimg.maskClip", DIRM = "frames/board-masks/masks", MAXPX = 4e6;
const enc = encodeURIComponent, fileUrl = p => `/file?p=${enc(p)}`;
let HY, t = k => k;
export const MASK_SVG = window.hyIcon ? window.hyIcon("mask", 15, 1.9) : "";   // the app's mask (ui/icons.js), the menus' size and line

const maskable = it => !!it && ((HY.isPic(it) && !VIDEO.test(it.path || "")) || it.type === "imgframe");
const canAlpha = it => !!it && (it.type === "imgframe" ? !!it.alpha : HY.isPic(it) && ALPHA.test(it.path || ""));
const shown = m => (m ? m.show || m.file : "");
const newName = () => `${DIRM}/m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.png`;
async function put(path, body) { const r = await fetch(`/api/file?p=${enc(path)}`, { method: "POST", body }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });
const toBlob = c => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("png"))), "image/png"));

// the card's masked look: the picture (and its graded canvas) take the mask; the card's own background goes, so outside is transparent
export function dressMask(el, it) {
  const u = it && it.mask ? shown(it.mask) : "";
  if (el._mku === u) return; el._mku = u;
  el.classList.toggle("hmask", !!u);
  if (u) el.style.setProperty("--hmask", `url("${fileUrl(u)}")`); else el.style.removeProperty("--hmask");
}

// a mask's pixels: the crop [x0, y0, x1, y1] of it (shares of the picture) drawn into w × h (a picture's mask becomes its layer's mask
// when it goes into a frame, imgframe.js)
export async function maskCanvas(m, w, h, crop) {
  const im = await loadImg(fileUrl(shown(m))), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const cr = crop || [0, 0, 1, 1], nw = im.naturalWidth, nh = im.naturalHeight, x = c.getContext("2d"); x.imageSmoothingQuality = "high";
  x.drawImage(im, cr[0] * nw, cr[1] * nh, (cr[2] - cr[0]) * nw, (cr[3] - cr[1]) * nh, 0, 0, c.width, c.height);
  return c;
}

/* ---------- the property: has, applies, get, set (the board's «Copy properties», and the right click's copy and paste) ---------- */
// no preview of its own: the board puts the value on the item and draws it (HY.pic's key is the mask's file), then puts the item back
export const maskProp = {
  id: "mask", order: 20,
  get label() { return t("Mask"); },
  has: it => maskable(it) && !!(it.mask && it.mask.file),
  applies: it => maskable(it) || t("A mask only on images and frames"),
  get: it => (it && it.mask ? JSON.parse(JSON.stringify(it.mask)) : null),
  // a value from get() onto a card: the same file, scaled by the card to its own size; null clears
  set(it, v) { if (!it) return; if (v && v.file) it.mask = JSON.parse(JSON.stringify(v)); else delete it.mask; },
  lacks: () => t("This picture has no mask"),   // the grey «Mask» in «Copy properties ›» says why (owner 2026-10-06)
  // its png files: a copy keeps their bytes, a paste in another project brings them into its library first (Hyimg's HY.props files)
  files: v => (v ? [v.file, v.show].filter(Boolean) : []),
};

/* ---------- the menu's actions ---------- */
function clip() { try { const v = JSON.parse(localStorage.getItem(CLIPK) || "null"); return v && v.file ? v : null; } catch { return null; } }
function copyMask(id) {
  const it = HY.board.items[id]; if (!maskProp.has(it)) return;
  try { localStorage.setItem(CLIPK, JSON.stringify({ ...maskProp.get(it), at: Date.now() })); HY.toast(t("Mask copied"), "success"); }
  catch (e) { HY.toast(t("Mask not copied: {e}", { e: e.message }), "error"); }
}
function pasteMask(ids) {
  const c = clip(), v = c && { ...c }; if (v) delete v.at; ids = ids.filter(id => maskable(HY.board.items[id])); if (!v || !ids.length) return;
  const before = HY.snap(); ids.forEach(id => maskProp.set(HY.board.items[id], v));
  HY.commit(before, ids.length > 1 ? t("Mask pasted on {n} images", { n: ids.length }) : t("Mask pasted"));
}
function clearMask(ids) {
  ids = ids.filter(id => HY.board.items[id] && HY.board.items[id].mask); if (!ids.length) return;
  const before = HY.snap(); ids.forEach(id => maskProp.set(HY.board.items[id], null));
  HY.commit(before, ids.length > 1 ? t("Mask cleared on {n} images", { n: ids.length }) : t("Mask cleared"));
}
// the picture's own alpha as its mask: read from the file (a frame: its render), at most 4 MP, written once as a png of its own
async function alphaOf(it) {
  const im = await loadImg(fileUrl(it.type === "imgframe" ? it.render : it.path));
  const nw = im.naturalWidth, nh = im.naturalHeight, k = Math.min(1, Math.sqrt(MAXPX / (nw * nh))), w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data; let any = false; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { any = true; break; }
  if (!any) return null;
  x.globalCompositeOperation = "source-in"; x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
  const path = newName(); await put(path, await toBlob(c)); c.width = c.height = 0; return { file: path };
}
async function maskFromAlpha(ids) {
  ids = ids.filter(id => canAlpha(HY.board.items[id])); if (!ids.length) return;
  const got = {};
  for (const id of ids) { try { const v = await alphaOf(HY.board.items[id]); if (v) got[id] = v; } catch (e) { console.warn("[mask]", e); } }
  const done = Object.keys(got).filter(id => HY.board.items[id]);
  if (!done.length) return HY.toast(ids.length > 1 ? t("These images have no transparent pixels") : t("The image has no transparent pixels"));
  const before = HY.snap(); done.forEach(id => maskProp.set(HY.board.items[id], got[id]));
  HY.commit(before, done.length > 1 ? t("Mask from alpha on {n} images", { n: done.length }) : t("Mask from alpha"));
}

export function registerMask(hy) {
  HY = hy; t = translator(hy);
  const st = document.createElement("style"); st.textContent = `
    /* the master mask: the picture and its graded canvas take it, the card's ground goes (outside the mask the board shows) */
    :is(.it, .plg[data-type]).hmask { background: transparent; }
    .it.hmask > :is(img, video, canvas.grd), .plg.hmask > :is(img.ifr, canvas.grd) {
      -webkit-mask-image: var(--hmask); mask-image: var(--hmask); -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
      -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: 0 0; mask-position: 0 0; }`;
  document.head.appendChild(st);
  if (hy.pic) hy.pic(it => shown(it.mask), (el, it) => dressMask(el, it));
  if (hy.props) hy.props.register(maskProp);
  hy.ctx((ids, id) => {
    const tg = ids.filter(i => maskable(HY.board.items[i]));
    const out = [], src = HY.board.items[id], al = tg.filter(i => canAlpha(HY.board.items[i])), wm = tg.filter(i => HY.board.items[i].mask);
    if (hy.menuOff && ids.length) {   // both always there, grey with the reason when they do not apply (owner 2026-10-06, HY.menuOff)
      const no = tg.length ? "" : t("A mask only on images and frames");
      return [{ icon: MASK_SVG, label: t("Mask from alpha"), off: no || (al.length ? "" : t("This file has no transparency")), fn: () => maskFromAlpha(al) },
        { icon: MASK_SVG, label: wm.length > 1 ? t("Clear mask ({n})", { n: wm.length }) : t("Clear mask"), off: no || (wm.length ? "" : t("No mask here")), fn: () => clearMask(wm) }];
    }
    if (!tg.length) return [];
    if (!hy.props && maskProp.has(src)) out.push({ icon: MASK_SVG, label: t("Copy mask"), fn: () => copyMask(id) });
    if (!hy.props && clip()) out.push({ icon: MASK_SVG, label: tg.length > 1 ? t("Paste mask ({n})", { n: tg.length }) : t("Paste mask"), fn: () => pasteMask(tg) });
    if (al.length) out.push({ icon: MASK_SVG, label: t("Mask from alpha"), fn: () => maskFromAlpha(al) });
    if (wm.length) out.push({ icon: MASK_SVG, label: wm.length > 1 ? t("Clear mask ({n})", { n: wm.length }) : t("Clear mask"), fn: () => clearMask(wm) });
    return out;
  });
  window.__mask = { copyMask, pasteMask, clearMask, maskFromAlpha, maskProp, clip, dressMask };
}
