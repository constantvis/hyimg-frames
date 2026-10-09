// The image studio's masks the Photoshop way (owner 2026-10-07: «it's pretty confusing»), on what index.html gives in window.hyEdK:
//   the mask's look   Contract/Expand (± px) and Smooth (px) beside Density and Feather in Properties; while a slider moves the look is
//                     made on a smaller copy each frame, at full size once it rests (m.draft); saved with the mask as grow and smooth
//   how it shows      a targeted mask over the picture in red, the picture on black or on white, the mask alone in black and white, or not
//   the mask plate    at the bottom centre while a mask is targeted: «Mask», how it shows, ✓ Apply (Esc and Enter too)
//   ⌘I                inverts the targeted mask, else the layer's pixels (in the selection when there is one); ⇧⌘I is Select › Inverse
//   (copy and paste of masks and layers: clipwork.js)
//   notes             under the app's top row at the window's centre, the board's own stack (ui/toasts.js)
(() => {
  const K = window.hyEdK; if (!K || !K.S) return;
  const { S } = K, $ = s => document.querySelector(s);
  const W = window.hyEdTr({
    grow: 'Contract/Expand', smooth: 'Smooth', hGrow: 'Mask Contract/Expand', hSmooth: 'Mask Smooth', hInvert: 'Invert',
    mask: 'Mask', show: 'How the mask shows', red: 'Red Overlay', black: 'On Black', white: 'On White', bw: 'Black & White', off: 'Off',
    apply: 'Apply', applyTip: 'Apply the mask and leave it', plateTip: 'Editing the mask: black hides, white shows',
    pickPixel: 'Select a picture layer', origLocked: 'Original is locked: the source picture never changes',
    pxLocked: 'The layer pixels are locked', invert: 'Invert'
  });
  K.T.invert = W.invert; K.W = Object.assign(K.W || {}, { mask: W });
  const masked = K.masked = () => { const n = K.one(); return n && n.mask && (S.editMask || n.mmask) ? n : null; };   // the mask the brush, ⌫, ⌘I, ⌘V act on
  const dims = () => K.dims(), kOf = n => n.type === 'adjust' ? n.mask.c.width / dims()[0] : n.mask.c.width / Math.abs(n.w);

  /* ---- the mask's look: Contract/Expand and Smooth ---- */
  // A blur of sigma px, then a level that puts the edge where it should be: for a straight edge blurred by a gaussian the level Φ(-z) lies
  // z·sigma out of it, so z = grow / sigma moves the edge by grow; the slope there, φ(z) / sigma, gives back a one pixel soft edge. Smooth
  // alone is the 0.5 level: the jagged edge goes round. One pass over the pixels; the blur is the studio's own (WebKit has no ctx.filter)
  const erf = x => { const t = 1 / (1 + .3275911 * Math.abs(x)),
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x < 0 ? -y : y; };
  const Phi = z => .5 * (1 + erf(z / Math.SQRT2)), phi = z => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const looks = new WeakMap();
  // a gaussian of sigma px as three box blurs, the edges held: the same in every engine (WebKit's canvas has no blur filter, and the studio's
  // stand-in for it is narrower than a gaussian, which moved a contracted edge)
  function gauss(f, w, h, sig) {
    const n = 3, wi = Math.sqrt(12 * sig * sig / n + 1), wl = Math.floor(wi) - (Math.floor(wi) % 2 ? 0 : 1), m = Math.round((12 * sig * sig - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    const t = new Float32Array(f.length);
    for (let k = 0; k < n; k++) { const r = ((k < m ? wl : wl + 2) - 1) / 2; if (r < 1) continue; box(f, t, w, h, r, 1, w); box(t, f, h, w, r, w, 1); }
  }
  // one box pass of radius r along lines: line i starts at i * step, its pixels are `along` apart
  function box(src, dst, lines, len, r, step, along) {
    const k = 1 / (2 * r + 1);
    for (let i = 0; i < lines; i++) {
      const o = i * step, first = src[o]; let acc = (r + 1) * first;
      for (let j = 0; j < r; j++) acc += src[o + Math.min(j, len - 1) * along];
      for (let j = 0; j < len; j++) {
        acc += src[o + Math.min(j + r, len - 1) * along] - (j - r - 1 >= 0 ? src[o + (j - r - 1) * along] : first);
        dst[o + j * along] = acc * k;
      }
    }
  }
  K.maskLook = (m, k) => {
    const g = +m.grow || 0, sm = +m.smooth || 0; if (!g && !sm) return m.c;
    const key = [m.c._v | 0, m.c.width, m.c.height, g, sm, k.toFixed(5), m.draft ? 1 : 0].join('|'), e = looks.get(m);
    if (e && e.key === key) return e.c;
    const w0 = m.c.width, h0 = m.c.height, r = m.draft ? Math.min(1, Math.sqrt(4e5 / (w0 * h0))) : 1;
    const w = Math.max(1, Math.round(w0 * r)), h = Math.max(1, Math.round(h0 * r)), kk = k * r;
    const sig = Math.max(sm * kk, Math.abs(g) * kk / 2, .35), z = g * kk / sig, L = Phi(-z), gain = sig / Math.max(1e-4, phi(z));
    const a = K.mk(w, h), ax = a.getContext('2d'); ax.imageSmoothingEnabled = true; ax.imageSmoothingQuality = 'high'; ax.drawImage(m.c, 0, 0, w, h);
    const b = K.mk(w, h), bx = b.getContext('2d', { willReadFrequently: true });
    try {
      const id = ax.getImageData(0, 0, w, h), d = id.data, f = new Float32Array(w * h);
      for (let i = 0; i < f.length; i++) f[i] = d[i * 4 + 3] / 255;
      gauss(f, w, h, sig);
      for (let i = 0; i < f.length; i++) { const v = .5 + (f[i] - L) * gain, j = i * 4; d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = v <= 0 ? 0 : v >= 1 ? 255 : v * 255; }
      bx.putImageData(id, 0, 0);
    } catch (er) { return m.c; }
    let out = b; if (r < 1) { out = K.mk(w0, h0); const ox = out.getContext('2d'); ox.imageSmoothingEnabled = true; ox.imageSmoothingQuality = 'high'; ox.drawImage(b, 0, 0, w0, h0); }
    out._v = (e ? e.c._v | 0 : 0) + 1; looks.set(m, { key, c: out }); return out;
  };
  // Properties › Mask: the two sliders under Feather; the gesture is one step to undo, live on a small copy, full size on release
  K.maskFields = n => {
    const m = n.mask; if (!m) return [];
    const f = (label, key, min, max, hist) => K.reg(K.Field(label, { min, max, unit: 'px', get: () => m[key] || 0, hist,
      set: v => { m[key] = v; m.draft = true; S.dirty = true; }, done: () => { m.draft = false; S.dirty = true; K.refresh(); } }));
    return [f(W.grow, 'grow', -100, 100, W.hGrow), f(W.smooth, 'smooth', 0, 50, W.hSmooth)];
  };

  /* ---- how a targeted mask shows (View › Mask Overlay, \) ---- */
  let film = null;
  K.drawMask = (c, n) => {
    const mode = S.maskShow || 'red', src = K.maskLook(n.mask, kOf(n)), [DW, DH] = dims();
    if (!film) film = K.mk(1, 1); film.width = src.width; film.height = src.height;
    const x = film.getContext('2d'); x.globalCompositeOperation = 'source-over';
    c.save();
    if (mode === 'bw') {   // the mask alone: black hides, white shows, over the whole document
      c.setTransform(K.viewM()); c.fillStyle = '#000'; c.fillRect(0, 0, DW, DH);
      c.setTransform(K.viewM().multiply(K.nodeM(n))); c.drawImage(src, 0, 0);
    } else {   // what the mask hides: red at half, or solid black or white
      x.fillStyle = mode === 'black' ? '#000' : mode === 'white' ? '#fff' : '#ff453a'; x.fillRect(0, 0, film.width, film.height);
      x.globalCompositeOperation = 'destination-out'; x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-over';
      if (mode !== 'red' && n.type === 'pixel') {   // outside a layer's own rectangle nothing of it shows either
        c.setTransform(K.viewM()); c.beginPath(); c.rect(0, 0, DW, DH); c.setTransform(K.viewM().multiply(K.nodeM(n))); c.rect(film.width, 0, -film.width, film.height);
        c.setTransform(K.viewM()); c.fillStyle = mode === 'black' ? '#000' : '#fff'; c.fill('evenodd');
      }
      c.setTransform(K.viewM().multiply(K.nodeM(n))); c.globalAlpha = mode === 'red' ? .5 : 1; c.drawImage(film, 0, 0);
    }
    c.restore();
  };
  const setShow = v => { if (v === 'off') S.film = false; else { S.film = true; S.maskShow = v; } S.odirty = true; S.mbKey = ''; syncPlate(true); };

  /* ---- the mask plate: bottom centre, over the dock ---- */
  const css = document.createElement('style');
  css.textContent = `#mplate{position:fixed;z-index:36;left:50%;bottom:96px;transform:translate(-50%,10px);opacity:0;pointer-events:none;
      transition:opacity .22s cubic-bezier(.32,.72,0,1),transform .32s cubic-bezier(.32,.72,0,1)}
    #mplate.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
    #mplate hy-plate{display:flex;align-items:center;gap:8px;padding:0 4px 0 10px;color:var(--ink)}
    #mplate .mpi{display:grid;place-items:center;color:var(--sel)}
    #mplate .mpl{font:600 13px var(--sans);margin-right:2px}
    #mplate hy-segmented{height:30px}
    .tb2.msk.edit:after{box-shadow:inset 0 0 0 2px var(--ink),inset 0 0 0 3px var(--panel)}`;
  document.head.append(css);
  const plate = document.createElement('div'); plate.id = 'mplate';
  plate.innerHTML = `<hy-plate kind="capsule" data-tip="${W.plateTip}" data-side="top"><span class="mpi">${K.svg('mask', 16)}</span><span class="mpl">${W.mask}</span>`
    + `<hy-segmented size="s" label="${W.show}" value="red">${['red', 'black', 'white', 'bw', 'off'].map(v => `<button value="${v}">${W[v]}</button>`).join('')}</hy-segmented>`
    + `<hy-button size="l" variant="solid" icon="check" data-tip="${W.applyTip}" data-key="Esc" data-side="top">${W.apply}</hy-button></hy-plate>`;
  document.body.append(plate);
  const seg = plate.querySelector('hy-segmented');
  seg.addEventListener('hy-change', e => setShow(e.detail.value));
  plate.querySelector('hy-button').addEventListener('click', () => K.leaveMask());
  // the dock this page shows: its own, or on the board the board's (the page is a frame over it); on the board the options strip rides over
  // the dock (dockwork.js), and the plate stands over the strip
  function dockTop() {
    const own = $('#dock'), r = own && own.getBoundingClientRect(); if (r && r.width) return r.top;
    const ob = $('#obar'); if (ob && ob.classList.contains('indock') && ob.offsetWidth) return ob.getBoundingClientRect().top;
    try { const pd = parent !== window && parent.document.getElementById('dock'), fe = frameElement;
      if (pd && fe) return pd.getBoundingClientRect().top - fe.getBoundingClientRect().top; } catch (er) {}
    return innerHeight - 78;
  }
  let plateKey = '', kh = null;
  // the brush's keys in the Hint bar as a mask is taken up, gone once one is used (the app's ui/hy/keyhint.js place "top", owner 2026-10-09);
  // ⌥ is the eyedropper, not shown
  const KEYS = [{ id: 'size', keys: ['[', ']'], t: 'Brush size' }, { id: 'swap', keys: ['x'], t: 'Black / white' }, { id: 'done', keys: ['enter', 'escape'], t: 'Done' }];
  function syncPlate(force) {
    const n = masked(), on = !!n && !!S.ready && !S.xf, val = !S.film ? 'off' : S.maskShow || 'red';
    const dr = K.dockRect && K.dockRect(), cx = dr && dr.width ? dr.left + dr.width / 2 : innerWidth / 2, key = [on, val, Math.round(cx), Math.round(dockTop())].join('|');
    if (key === plateKey && !force) return; plateKey = key;
    if (on && !kh && window.hyKeyHint) kh = hyKeyHint.show(plate.querySelector('hy-plate'), 'mask', KEYS, { place: 'top' }); else if (!on && kh) { kh.hide(); kh = null; }
    plate.classList.toggle('on', on); plate.style.left = cx + 'px'; plate.style.bottom = Math.max(12, innerHeight - dockTop() + 10) + 'px';
    if (seg.value !== val) seg.value = val;
  }
  (function tick() { syncPlate(); requestAnimationFrame(tick); })();
  // ✓, Esc, Enter: the strokes stay (Photoshop), the layer's pixels are the target again; the master mask gives the choice back to the layers
  K.leaveMask = () => {
    if (S.maskMode) { K.applyMaskMode(); return; }
    const n = K.one(); S.editMask = false;
    if (n && n.mmask) { const top = [...window.__ed.root].reverse().find(x => !K.isPinned(x)); S.ids = top ? [top.id] : []; }
    K.refresh();
  };

  /* ---- ⌘I ---- */
  K.invert = () => {
    const n = K.one(); if (!n) return K.toast(W.pickPixel, 'invsel');
    if (masked() || (n.type === 'adjust' && n.mask && !n.main)) return K.invertMask(n);   // Photoshop: ⌘I on an adjustment layer inverts its mask
    if (n.type !== 'pixel') return K.toast(W.pickPixel, 'invsel');
    if (n.orig) return K.toast(W.origLocked, 'lock');
    if (K.lk(n).pixels || K.lk(n).all) return K.toast(W.pxLocked, 'lock');
    const inv = K.copyC(n.c), ix = inv.getContext('2d', { willReadFrequently: true });
    try { const id = ix.getImageData(0, 0, inv.width, inv.height), d = id.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } ix.putImageData(id, 0, 0); }
    catch (er) { return K.toast(W.pickPixel, 'invsel'); }
    K.pxEdit(n.c, W.hInvert, x => {
      if (!S.hasSel) { x.clearRect(0, 0, n.c.width, n.c.height); x.drawImage(inv, 0, 0); return; }
      ix.globalCompositeOperation = 'destination-in'; K.selToLocal(ix, n);   // only in the selection: the rest keeps its pixels
      x.globalCompositeOperation = 'destination-out'; K.selToLocal(x, n); x.globalCompositeOperation = 'lighter'; x.drawImage(inv, 0, 0); x.globalCompositeOperation = 'source-over';
    });
    S.dirty = true; K.toast(W.invert, 'invsel');
  };

  /* ---- notes: the app's stack (ui/toasts.js) at the top centre, under the studio's top rows (the options bar: --topy) ---- */
  // the board's own stack lies under this page, where the options bar covered it: the studio keeps one of its own, in the same look
  const stack = () => window.hyToast || null;
  document.documentElement.style.setProperty('--toast-top', 'var(--topy, 106px)');
  if (!stack()) { const sc = document.createElement('script'); sc.src = '/ui/toasts.js'; document.head.append(sc); }
  K.note = (text, icon) => { const f = stack(); if (!f) return false; f(text, icon === 'x' ? 'error' : icon === 'check' ? 'success' : 'info'); return true; };
})();
