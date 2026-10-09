// Copy and paste in the image studio, Photoshop's way (owner 2026-10-07), on window.hyEdK (index.html):
//   ⌘C   the targeted mask (its thumbnail chosen in Layers) as a picture; a Raw Editor layer's settings; else the layer's pixels (in the selection)
//   ⌘V   a mask onto the chosen layers as their mask (made or replaced, one step); a picture into the targeted mask, else as a new layer;
//        Raw Editor settings onto the chosen Raw Editor layers, else as a new Raw Editor layer
//   ⇧⌘V  always a new layer (the mask as a picture: adjust it, ⌘C, target a mask, ⌘V puts it back)
//   ⌥⌘V  Paste Properties: what the board copied (HY.props: its «Raw Editor» and «Mask» kinds) onto the chosen layers; a copy here is put
//        on that same clipboard (cv.propsClip, /api/propsclip), so the board's ⌥⌘V puts it on its pictures
//   drag a mask's thumbnail onto another layer: the mask moves there; with ⌥ a copy goes, one step each; ⌥-click shows the mask alone
//   a picture copied in another app (Photoshop): ⌘V into the targeted mask, or as a layer
(() => {
  const K = window.hyEdK; if (!K || !K.S) return;
  const { S } = K;
  const W = window.hyEdTr({
    copiedMask: 'Mask copied', copied: 'Copied', copiedGrade: 'Raw Editor settings copied', pastedMask: 'Pasted into the mask', pastedMasks: n => `Mask pasted on ${n} layers`,
    pastedLayer: 'Pasted as a new layer', pastedGrade: 'Raw Editor settings pasted', nothingCopied: 'Nothing copied yet', noProps: 'No properties copied yet',
    propsPasted: 'Properties pasted', noGrade: 'No Raw Editor copied yet', nothingMask: 'No mask copied yet',
    propsNone: 'These properties don\'t apply here', hPaste: 'Paste', hPasteMask: 'Paste Layer Mask', hPasteGrade: 'Paste Raw Editor',
    hPasteProps: 'Paste Properties', hMoveMask: 'Move Layer Mask', hCopyMask: 'Copy Layer Mask', maskMoved: 'Mask moved', maskCopied2: 'Mask copied to the layer',
    alone: 'The mask alone · ⌥-click its thumbnail to go back', layerN: 'Layer ', copy: 'Copy', pasteAsLayer: 'Paste as New Layer',
    pickPixel: 'Select a picture layer', noTarget: 'A mask goes on a picture or adjustment layer'
  });
  K.W = Object.assign(K.W || {}, { clip: W });
  const root = () => window.__ed.root, dims = () => K.dims();
  const masked = () => (K.masked ? K.masked() : null);
  const canMask = n => !!n && (n.type === 'pixel' || (n.type === 'adjust' && !n.main));
  const docC = () => { const [DW, DH] = dims(), r = Math.min(1, Math.sqrt(16e6 / (DW * DH))); return { c: K.mk(DW * r, DH * r), r }; };
  K.clip = null;

  /* ---- pictures of a mask and of a layer, document-sized ---- */
  // the mask as it is (not its look): white shows, black hides; outside a layer's rectangle white, as Photoshop's mask is endless there
  function maskPicture(n, look) {
    const { c, r } = docC(), x = c.getContext('2d'), src = look ? lookOf(n) : n.mask.c;
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.setTransform(new DOMMatrix().scale(r).multiply(K.nodeM(n))); x.fillStyle = '#000'; x.fillRect(0, 0, n.mask.c.width, n.mask.c.height);
    x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0); return c;
  }
  // its look on the board: Contract/Expand, Smooth, Density and Feather baked (as the board's mask kind shows it)
  function lookOf(n) {
    const m = n.mask, [DW] = dims(), k = n.type === 'adjust' ? m.c.width / DW : m.c.width / Math.abs(n.w), t = K.mk(m.c.width, m.c.height), x = t.getContext('2d');
    if (m.on === false) { x.fillStyle = '#fff'; x.fillRect(0, 0, t.width, t.height); return t; }
    if (m.density < 100) { x.fillStyle = `rgba(255,255,255,${1 - m.density / 100})`; x.fillRect(0, 0, t.width, t.height); }
    K.blurDraw(x, K.maskLook ? K.maskLook(m, k) : m.c, (m.feather || 0) * k); return t;
  }
  function layerPicture(n) {
    const { c, r } = docC(), x = c.getContext('2d');
    x.setTransform(new DOMMatrix().scale(r).multiply(K.LM(n))); x.imageSmoothingQuality = 'high'; x.drawImage(n.c, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0);
    if (S.hasSel) { const s = K.sel(); x.globalCompositeOperation = 'destination-in'; x.drawImage(s.c, 0, 0, c.width, c.height); x.globalCompositeOperation = 'source-over'; }
    return c;
  }
  // a picture's brightness as a mask's alpha (transparent counts as black)
  function lumAlpha(pic) {
    const g = K.mk(pic.width, pic.height), gx = g.getContext('2d', { willReadFrequently: true }); gx.drawImage(pic, 0, 0);
    const id = gx.getImageData(0, 0, g.width, g.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const a = (.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]) * d[i + 3] / 255; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a; }
    gx.putImageData(id, 0, 0); return g;
  }
  // a new mask canvas for n from a document-sized alpha picture (a new canvas each time: the history keeps the old one)
  function maskFrom(g, n) {
    const [DW, DH] = dims(), r = Math.min(1, Math.sqrt(4e6 / (DW * DH)));
    const c = n.mask ? K.mk(n.mask.c.width, n.mask.c.height) : n.type === 'adjust' ? K.mk(DW * r, DH * r) : K.mk(n.c.width, n.c.height), x = c.getContext('2d');
    x.setTransform(K.nodeM(n).inverse().multiply(new DOMMatrix().scale(DW / g.width, DH / g.height))); x.imageSmoothingQuality = 'high'; x.drawImage(g, 0, 0);
    x.setTransform(1, 0, 0, 1, 0, 0); c._v = 1; return c;   // the mask's context is used again: no transform left on it
  }
  const putMask = (n, c) => { if (n.mask) n.mask = { ...n.mask, c }; else n.mask = { c, density: 100, feather: 0, on: true }; };
  // a picture as the mask of these layers, one step to undo
  function setMasks(pic, ns, label) {
    let g; try { g = lumAlpha(pic); } catch (er) { return 0; }
    const cs = ns.map(n => maskFrom(g, n));
    K.edit(label || W.hPasteMask, () => ns.forEach((n, i) => putMask(n, cs[i])));
    if (ns.length === 1) { S.ids = [ns[0].id]; S.editMask = true; } S.dirty = true; K.refresh(); return ns.length;
  }
  K.pasteIntoMask = (pic, n) => { n = n || masked(); if (n && pic && setMasks(pic, [n])) K.toast(W.pastedMask, 'mask'); };
  K.pasteLayer = pic => {
    const [DW, DH] = dims(), c = K.copyC(pic); let n = 0; K.walk(root(), x => { if (x.type === 'pixel') n++; });
    K.edit(W.hPaste, () => { const l = K.pixNode(W.layerN + (n + 1), c, 0, 0, DW, DH); K.insertAbove(K.one() || K.selNodes().pop(), [l]); S.ids = [l.id]; S.editMask = false; });
    K.toast(W.pastedLayer, 'newLayer');
  };

  /* ---- Raw Editor settings ---- */
  const CG = () => K.HyCG || {};
  // only what differs from the defaults, as the board keeps a grade
  function gradeDiff(p) {
    const H = CG(); if (!H.defaults) return JSON.parse(JSON.stringify(p));
    const diff = (a, d) => { if (Array.isArray(d) || typeof d !== 'object' || d === null) return JSON.stringify(a) === JSON.stringify(d) ? undefined : a;
      const o = {}; for (const k of Object.keys(d)) { const v = diff(a && a[k], d[k]); if (v !== undefined) o[k] = v; } return Object.keys(o).length ? o : undefined; };
    return diff(H.normalize ? H.normalize(p) : p, H.defaults()) || {};
  }
  const gradeFull = g => { const H = CG(); return { ...(H.defaults ? H.defaults() : {}), ...(H.normalize ? H.normalize(g || {}) : g || {}) }; };
  // onto the chosen Raw Editor layers (the master's too), else a new Raw Editor layer over the choice; inside an edit
  function gradeInto(g) {
    const ns = K.selNodes().filter(n => n.type === 'adjust' && !n.mmask);
    if (ns.length) { ns.forEach(n => { n.params = gradeFull(g); }); return; }
    const a = K.adjNode('grade', gradeFull(g)); K.insertAbove(K.selNodes().pop(), [a]); S.ids = [a.id]; S.editMask = false;
  }

  /* ---- the app's properties clipboard (HY.props, the board's ⌥⌘C ⌥⌘V) ---- */
  const PCLIP = 'cv.propsClip', MCLIP = 'hyimg.maskClip';
  const toBlob = c => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('no png'))), 'image/png'));
  function propsOut(kinds, files) {
    const [DW, DH] = dims(), at = Date.now(), pc = { from: K.frameName(), src: { w: DW, h: DH, type: 'imgframe' }, at, kinds };
    if (files && files.length) pc.files = files;
    try { localStorage.setItem(PCLIP, JSON.stringify(pc)); if (kinds.mask) localStorage.setItem(MCLIP, JSON.stringify({ ...kinds.mask, at })); } catch (er) {}
    fetch('/api/propsclip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pc) }).catch(() => {});
  }
  // the mask's look as the board keeps a mask: white, its alpha what shows, a file of its own (never pruned)
  async function maskFile(n) {
    const pic = maskPicture(n, true), x = pic.getContext('2d', { willReadFrequently: true }), id = x.getImageData(0, 0, pic.width, pic.height), d = id.data;
    for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = d[i + 1] = d[i + 2] = 255; }
    x.putImageData(id, 0, 0);
    const path = `frames/board-masks/masks/m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`; await K.putFile(path, await toBlob(pic)); return path;
  }
  // «Copy Raw Editor» on a Raw Editor row, the master's too: only its settings, here (⌘V) and on the board's clipboard (⌥⌘V there)
  K.copyGrade = n => {
    if (!n || n.type !== 'adjust' || n.mmask) return; const g = gradeDiff(n.params);
    K.clip = { kind: 'grade', g, at: Date.now() }; propsOut({ grade: g }); K.toast(W.copiedGrade, 'copy');
  };
  // what the properties clipboard holds now, for the menus: {grade, mask} (this page's localStorage, the board keeps it fresh)
  K.clipHas = kind => { try { const c = JSON.parse(localStorage.getItem(PCLIP) || 'null'); return !!(c && c.kinds && c.kinds[kind] !== undefined); } catch (er) { return false; } };
  K.copyProps = async n => {
    n = n || K.one(); if (!n) return; const kinds = {}, files = [];
    if (n.type === 'adjust' && !n.mmask) kinds.grade = gradeDiff(n.params);
    if (n.mask) { try { const f = await maskFile(n); kinds.mask = { file: f }; files.push(f); } catch (er) { console.warn('[props]', er); } }
    if (Object.keys(kinds).length) propsOut(kinds, files);
  };
  async function propsIn() {
    let c = null; try { c = JSON.parse(localStorage.getItem(PCLIP) || 'null'); } catch (er) {}
    try { const s = await (await fetch('/api/propsclip', { cache: 'no-store' })).json(); if (s && s.kinds && (!c || (s.at || 0) > (c.at || 0))) c = s; } catch (er) {}
    if (!c || !c.kinds) return null;
    if (c.files && c.files.length && c.kinds.mask) {   // copied in another project: its files come here first
      try { const m = await (await fetch('/api/propsclip/take', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
        const map = (m && m.map) || {}; ['file', 'show'].forEach(k => { if (c.kinds.mask[k] && map[c.kinds.mask[k]]) c.kinds.mask[k] = map[c.kinds.mask[k]]; }); } catch (er) {}
    }
    return c;
  }
  // only: 'grade' or 'mask' (a master row's «Paste Raw Editor», «Paste Mask»); a master row takes only its own kind
  K.pasteProps = async only => {
    const c = await propsIn(); if (!c) return K.toast(W.noProps, 'pasteProps');
    const o = K.one(); if (!only && o && (o.main || o.mmask)) only = o.main ? 'grade' : 'mask';
    const g = only === 'mask' ? undefined : c.kinds.grade, m = only === 'grade' ? undefined : c.kinds.mask; let pic = null, ns = [];
    if (only && (only === 'grade' ? g === undefined : !m)) return K.toast(only === 'grade' ? W.noGrade : W.nothingMask, 'pasteProps');
    if (m && (m.show || m.file)) {
      ns = K.selNodes().filter(canMask); if (!ns.length && K.one() && K.one().mmask) ns = [K.one()];
      if (ns.length) pic = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = K.fileURL(m.show || m.file); });
    }
    if (g === undefined && !pic) return K.toast(W.propsNone, 'pasteProps');
    let gs = null; try { gs = pic && lumAlpha(alphaToBW(pic)); } catch (er) { gs = null; }
    const cs = gs ? ns.map(n => maskFrom(gs, n)) : [];
    const label = only === 'grade' ? W.hPasteGrade : only === 'mask' ? K.T.pasteMask || W.hPasteMask : W.hPasteProps;
    K.edit(label, () => { if (g !== undefined) gradeInto(g || {}); ns.forEach((n, i) => { if (cs[i]) putMask(n, cs[i]); }); });
    S.dirty = true; K.refresh(); K.toast(only === 'grade' ? W.pastedGrade : only === 'mask' ? W.pastedMask : W.propsPasted, 'pasteProps');
  };
  // a board mask (white, alpha what shows) as a black and white picture
  function alphaToBW(im) { const c = K.mk(im.naturalWidth || im.width, im.naturalHeight || im.height), x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0); return c; }

  /* ---- ⌘C ⌘V ---- */
  K.copyMask = n => {
    n = n || masked(); if (!n) return;
    K.clip = { kind: 'mask', c: maskPicture(n), at: Date.now() }; toSystem(K.clip.c); K.copyProps(n); K.toast(W.copiedMask, 'copy');
  };
  K.copy = () => {
    const mk = masked(); if (mk) return K.copyMask(mk);
    const p = K.one(); if (!p) return K.toast(W.pickPixel, 'copy');
    if (p.type === 'adjust') { K.clip = { kind: 'grade', g: gradeDiff(p.params), at: Date.now() }; K.copyProps(p); return K.toast(W.copiedGrade, 'copy'); }
    if (p.type !== 'pixel') return K.toast(W.pickPixel, 'copy');
    K.clip = { kind: 'pixels', c: layerPicture(p), at: Date.now() }; toSystem(K.clip.c); K.toast(W.copied, 'copy');
  };
  function toSystem(c) {   // also on the Mac's clipboard, for Photoshop; a page without the right to write it keeps its own copy
    try { if (navigator.clipboard && window.ClipboardItem) c.toBlob(b => { if (b) navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => {}); }); } catch (er) {}
  }
  K.paste = asLayer => {
    const cl = K.clip; if (!cl) return K.toast(W.nothingCopied, 'paste');
    if (cl.kind === 'grade') { K.edit(W.hPasteGrade, () => gradeInto(cl.g)); S.dirty = true; K.refresh(); return K.toast(W.pastedGrade, 'paste'); }
    if (asLayer) return K.pasteLayer(cl.c);
    const tg = masked();
    if (tg) return K.pasteIntoMask(cl.c, tg);
    if (cl.kind === 'mask') {   // a copied mask onto the chosen layers, each its mask (made or replaced)
      const ns = K.selNodes().filter(canMask);
      if (ns.length) { setMasks(cl.c, ns); return K.toast(ns.length > 1 ? W.pastedMasks(ns.length) : W.pastedMask, 'mask'); }
    }
    K.pasteLayer(cl.c);
  };
  // the app lost the focus to another app: what this page copied may no longer be the newest, the Mac's clipboard decides (the paste event)
  try { top.addEventListener('blur', () => setTimeout(() => { try { if (!top.document.hasFocus()) K.clip = null; } catch (er) {} }, 0)); } catch (er) {}
  const typing = e => e.target.closest && e.target.closest('input, textarea, select, [contenteditable=true]');
  const busy = () => !S.ready || document.getElementById('dlgw').classList.contains('on');
  addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || typing(e) || busy()) return;
    const eat = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.code === 'KeyV' && e.altKey && !e.shiftKey) { eat(); K.pasteProps(); return; }
    if (e.altKey) return;
    if (e.code === 'KeyC' && !e.shiftKey) { eat(); K.copy(); }
    else if (e.code === 'KeyV' && K.clip) { eat(); K.paste(e.shiftKey); }
  }, true);
  // the Edit menu of the app (a WKWebView) may send copy and paste themselves
  addEventListener('copy', e => { if (typing(e) || busy()) return; e.preventDefault(); K.copy(); }, true);
  addEventListener('paste', e => {
    if (typing(e) || busy()) return;
    if (K.clip) { e.preventDefault(); e.stopImmediatePropagation(); K.paste(); return; }
    if (!masked()) return;   // the page's own paste makes a picture a layer (index.html)
    const f = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.kind === 'file' && /^image\//.test(i.type)); if (!f) return;
    e.preventDefault(); e.stopImmediatePropagation(); const n = masked(), u = URL.createObjectURL(f.getAsFile()), im = new Image();
    im.onload = () => { K.pasteIntoMask(im, n); URL.revokeObjectURL(u); }; im.src = u;
  }, true);

  // Edit in Actions (⌘K): what the keys do, with their keys
  K.editMenu = () => [null,
    { icon: 'copy', label: W.copy, keys: ['⌘', 'C'], fn: K.copy, dis: !K.one(), why: W.pickPixel },
    { icon: 'paste', label: W.hPaste, keys: ['⌘', 'V'], fn: () => K.paste(), dis: !K.clip, why: W.nothingCopied },
    { icon: 'paste', label: W.pasteAsLayer, keys: ['⇧', '⌘', 'V'], fn: () => K.paste(true), dis: !K.clip || K.clip.kind === 'grade', why: W.nothingCopied },
    { icon: 'pasteProps', label: W.hPasteProps, keys: ['⌥', '⌘', 'V'], fn: K.pasteProps },
    ...(K.fillMenu ? [{ icon: 'brush', label: K.W.sel.fill, sub: K.fillMenu }] : [])];
  /* ---- a mask's thumbnail: drag it to another layer (⌥: a copy), ⌥-click: the mask alone ---- */
  const rows = document.getElementById('rows'), list = document.getElementById('list');
  let md = null;
  rows.addEventListener('pointerdown', e => {
    const t = e.target.closest && e.target.closest('[data-a=msk]'); if (!t || e.button !== 0 || e.shiftKey || e.metaKey) return;
    if (e.altKey && K.clipPairAt(e.clientY)) return;   // on the line between two rows ⌥ clips (index.html)
    const id = t.closest('.lr').dataset.id; if (!K.byId(id) || !K.byId(id).mask) return;
    md = { id, x: e.clientX, y: e.clientY, alt: e.altKey, on: false, over: null };
    if (e.altKey) { e.preventDefault(); e.stopPropagation(); }   // ⌥: nothing else happens before the pointer says click or drag
  }, true);
  const rowAt = y => [...rows.querySelectorAll('.lr')].find(r => { const b = r.getBoundingClientRect(); return b.height > 4 && y >= b.top && y <= b.bottom && !r.closest('.kids:not(.open)'); });
  addEventListener('pointermove', e => {
    const dragging = rows.querySelector('.lr.drag');   // a row dragged (index.html): ⌥ makes it a copy
    if (dragging || md) list.style.cursor = e.altKey ? 'copy' : md && md.on ? 'grabbing' : ''; else if (list.style.cursor === 'grabbing') list.style.cursor = '';
    if (!md) return;
    if (!md.on && Math.hypot(e.clientX - md.x, e.clientY - md.y) > 5) md.on = true;
    if (!md.on) return;
    const r = rowAt(e.clientY), n = r && K.byId(r.dataset.id), ok = n && n.id !== md.id && canMask(n);
    if (md.over && md.over !== r) md.over.classList.remove('into');
    md.over = ok ? r : null; if (ok) r.classList.add('into');
  });
  addEventListener('pointerup', e => {
    const d = md; md = null; if (!d) return; list.style.cursor = '';
    if (d.over) d.over.classList.remove('into');
    if (!d.on) { if (d.alt) alone(d.id); return; }
    if (!d.over) return;
    const src = K.byId(d.id), dst = K.byId(d.over.dataset.id), copy = e.altKey; if (!src || !dst || !src.mask) return;
    const c = maskFrom(lumAlpha(maskPicture(src)), dst);
    K.edit(copy ? W.hCopyMask : W.hMoveMask, () => { putMask(dst, c); dst.mask.density = src.mask.density; dst.mask.feather = src.mask.feather; if (!copy && !src.mmask) src.mask = null; });
    S.ids = [dst.id]; S.editMask = true; S.dirty = true; K.refresh(); K.toast(copy ? W.maskCopied2 : W.maskMoved, 'mask');
  });
  function alone(id) {
    const n = K.byId(id); if (!n || !n.mask) return;
    const on = S.film && S.maskShow === 'bw' && S.ids.length === 1 && S.ids[0] === id && S.editMask;
    if (on) { S.maskShow = S.showWas || 'red'; S.film = S.filmWas !== false; }
    else { S.showWas = S.maskShow; S.filmWas = S.film; S.ids = [id]; S.editMask = true; S.film = true; S.maskShow = 'bw'; K.toast(W.alone, 'mask'); }
    S.odirty = true; K.refresh();
  }
})();
