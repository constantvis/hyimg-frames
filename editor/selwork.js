// The image studio's selection the Photoshop way (owner 2026-10-07), on window.hyEdK (index.html):
//   a plain click on the picture outside the selection drops it, with the Select and Move tools too («как раз должно и сбрасываться»);
//   a click in a panel, the layer list, the options bar or a menu keeps it; a new marquee replaces it (index.html)
//   ⌘D deselects, ⇧⌘D brings the last one back; ⇧⌘J Layer via Cut; Edit › Fill: the foreground, background, black, white or 50 % grey
//   in the selection (on the targeted mask black hides and white shows)
(() => {
  const K = window.hyEdK; if (!K || !K.S) return;
  const { S } = K;
  const W = window.hyEdTr({
    reselect: 'Reselect', layerViaCut: 'Layer Via Cut', cutToLayer: 'Selection cut to a new layer', fill: 'Fill', fg: 'Foreground Color', bg: 'Background Color',
    black: 'Black', white: 'White', gray: '50% Gray', noSel: 'No selection', pickPixel: 'Select a picture layer', origLocked: 'Original is locked: the source picture never changes',
    pxLocked: 'The layer pixels are locked', filled: 'Filled', fragment: ' piece'
  });
  K.T.reselect = W.reselect; K.W = Object.assign(K.W || {}, { sel: W });
  const view = K.view;

  // the selection's strength at a point of the document, 0 to 1
  function selAt(p) {
    const s = K.sel(); if (!s.c) return 0;
    const t = K.mk(1, 1).getContext('2d', { willReadFrequently: true }); t.drawImage(s.c, Math.floor(p.x * s.k), Math.floor(p.y * s.k), 1, 1, 0, 0, 1, 1);
    try { return t.getImageData(0, 0, 1, 1).data[3] / 255; } catch (er) { return 1; }
  }
  // a click, not a drag, on the picture with Select or Move, outside the selection: deselect (the selection tools do it themselves)
  let down = null;
  view.addEventListener('pointerdown', e => { down = e.button === 0 && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey ? { x: e.clientX, y: e.clientY, tool: S.tool, had: S.hasSel } : null; });
  view.addEventListener('pointerup', e => {
    const d = down; down = null;
    if (!d || !d.had || !S.hasSel || S.xf || S.space || (d.tool !== 'select' && d.tool !== 'move') || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) return;
    if (selAt(K.toDoc(e.clientX, e.clientY)) < .5) K.deselect();
  });

  K.reselect = () => {
    const last = S.lastSel; if (!last) return; K.ensureSel(); const s = K.sel(), x = s.c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, s.c.width, s.c.height); x.drawImage(last, 0, 0, s.c.width, s.c.height);
    S.hasSel = true; S.selV++; S.odirty = true;
  };

  // Layer via Cut: the selected pixels leave the layer for a new one above it, one step to undo
  K.layerViaCut = () => {
    const n = K.one(); if (!n || n.type !== 'pixel') return K.toast(W.pickPixel, 'cut');
    if (!S.hasSel) return K.toast(W.noSel, 'cut');
    if (n.orig) return K.toast(W.origLocked, 'lock');
    if (K.lk(n).pixels || K.lk(n).all) return K.toast(W.pxLocked, 'lock');
    const piece = K.copyC(n.c), px = piece.getContext('2d'); px.globalCompositeOperation = 'destination-in'; K.selToLocal(px, n); px.globalCompositeOperation = 'source-over';
    const rest = K.copyC(n.c), rx = rest.getContext('2d'); rx.globalCompositeOperation = 'destination-out'; K.selToLocal(rx, n); rx.globalCompositeOperation = 'source-over';
    rest._v = (n.c._v | 0) + 1;
    K.edit(W.layerViaCut, () => {
      const m = K.pixNode(n.name + W.fragment, piece, n.x, n.y, n.w, n.h); Object.assign(m, { angle: n.angle, fx: n.fx, fy: n.fy });
      n.c = rest; const l = K.locate(n.id); l.list.splice(l.i + 1, 0, m); S.ids = [m.id]; S.editMask = false;
    });
    K.toast(W.cutToLayer, 'cut');
  };

  // Edit › Fill: in the selection, or the whole layer or mask without one
  K.fill = kind => {
    const n = K.one(), onMask = !!(n && n.mask && (S.editMask || n.type === 'adjust'));
    if (!n || !(onMask || n.type === 'pixel')) return K.toast(W.pickPixel, 'brush');
    if (!onMask && n.orig) return K.toast(W.origLocked, 'lock');
    if (!onMask && (K.lk(n).pixels || K.lk(n).all)) return K.toast(W.pxLocked, 'lock');
    const col = kind === 'fg' ? S.fg : kind === 'bg' ? S.bg : kind === 'black' ? '#000000' : kind === 'white' ? '#ffffff' : '#808080', t = onMask ? n.mask.c : n.c;
    const lum = (() => { const v = parseInt(col.slice(1), 16); return (.2126 * (v >> 16 & 255) + .7152 * (v >> 8 & 255) + .0722 * (v & 255)) / 255; })();
    const f = K.mk(t.width, t.height), fx = f.getContext('2d');
    fx.fillStyle = onMask ? `rgba(255,255,255,${lum})` : col; fx.fillRect(0, 0, f.width, f.height);
    if (S.hasSel) { fx.globalCompositeOperation = 'destination-in'; K.selToLocal(fx, n); fx.globalCompositeOperation = 'source-over'; }
    K.pxEdit(t, W.fill, x => {
      if (onMask) { if (S.hasSel) { x.globalCompositeOperation = 'destination-out'; K.selToLocal(x, n); } else x.clearRect(0, 0, t.width, t.height); x.globalCompositeOperation = 'lighter'; }
      x.drawImage(f, 0, 0); x.globalCompositeOperation = 'source-over';
    });
    S.dirty = true; K.toast(W.filled, 'brush');
  };
  K.fillMenu = () => [['fg', W.fg], ['bg', W.bg], null, ['black', W.black], ['white', W.white], ['gray', W.gray]].map(x => x && { icon: 'brush', label: x[1], fn: () => K.fill(x[0]) });
})();
