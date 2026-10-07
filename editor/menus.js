// The image studio's right click and its layer list's extras (owner 2026-10-07: «полностью отсутствует клик правой мышкой»), on
// window.hyEdK (index.html). Menus are the studio's #menu built of the app's items (ui/menu.js hyMenuItem); what does not apply now stays,
// grey, with its reason (hyMenuOff, the owner's rule: never hide), and every item shows its keys:
//   on the picture      with a selection: Deselect, Select Inverse, Feather, Modify, Layer Via Copy and Cut, Fill, the mask from it or
//                       out of the targeted mask; without one: Select All, Reselect, Paste, the layers under the pointer, Free Transform, Undo
//   on a layer row      the note colours first (ui/menu.js hyMenuColors, the board's notes and the library's folders), then Photoshop's layer menu
//   on a mask thumbnail Disable, Delete, Apply, Invert, Copy as Image, Paste Into Mask, the mask alone
//   on the master rows  what applies to them, the rest grey with the reason
// The list: the master rows under a «Master» band on top (owner: «make it understandable that these are master layers»); a row's colour
// is a stripe on its left (ui/menu.js .hy-rc), saved with the layer, one step to undo, for every chosen row; ⌥ over the line between two
// rows shows where a click clips, as soon as ⌥ goes down
(() => {
  const K = window.hyEdK; if (!K || !K.S) return;
  const { S, T } = K, $ = s => document.querySelector(s);
  const W = window.hyEdTr({
    master: 'Master layers', masterTip: 'Master layers act on the whole frame, the board shows them; they stay on top',
    selInverse: 'Select Inverse', layerViaCopy: 'Layer Via Copy', flatten: 'Flatten Image', lock: 'Lock Layer', unlock: 'Unlock Layer', hide: 'Hide Layer', show: 'Show Layer',
    applyMask: 'Apply Layer Mask', invertMask: 'Invert Mask', copyMaskImg: 'Copy Mask as Image', pasteIntoMask: 'Paste Into Mask', deleteFromMask: 'Delete from Mask',
    maskFromSel: 'Mask from Selection', disableMask: 'Disable Layer Mask', enableMask: 'Enable Layer Mask', deleteMask: 'Delete Layer Mask', alone: 'Show the Mask Alone',
    addMask: 'Add Layer Mask', copyStyle: 'Copy Layer Style', pasteStyle: 'Paste Layer Style', noStyles: 'Layer styles are not there yet', layersHere: 'Layers Here',
    noLayerHere: 'No layer under the pointer', paste: 'Paste', nothingCopied: 'Nothing copied yet', modify: 'Modify', fill: 'Fill', layerColor: 'Layer Color',
    whyMaster: 'A master layer stays on top and acts on the whole frame', whyMasterMask: 'The master Mask is the frame\'s mask', whyOrig: 'Original is locked: the source picture never changes',
    whyNoMask: 'This layer has no mask', whyHasMask: 'This layer has a mask', whyNoSel: 'Only with a selection', whyNoTarget: 'Target a mask first: click its thumbnail',
    whyPixel: 'Only for a picture layer', whyAdjMask: 'An adjustment layer\'s mask stays a mask', whyOne: 'Select one layer', whyBelow: 'There is no layer below',
    whyNoUndo: 'Nothing to undo', whyNoLast: 'No selection to bring back', whyGroup: 'Select a group', whyTwo: 'Select two layers or more', rename: 'Rename Layer'
  });
  K.W = Object.assign(K.W || {}, { menus: W });
  const it = (icon, label, keys, fn, why) => ({ icon, label, keys, fn, dis: !!why, why: why || '' });
  const root = () => window.__ed.root;

  /* ---- the list: the master band, the colour stripe, ⌥ over a line ---- */
  const css = document.createElement('style');
  css.textContent = `.mgrp{margin:0 0 8px;padding:2px 3px 3px;border-radius:calc(var(--r-row) + 3px);background:color-mix(in srgb,var(--sel) 8%,transparent);
      box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--sel) 20%,transparent)}
    .mgh{display:flex;align-items:center;gap:6px;height:22px;padding:0 7px;color:var(--sel);font:600 11px/1 var(--sans);cursor:default}
    .mgrp .lr.main,.mgrp .lr.mmask{margin:0}
    .mgrp .lr::after{display:none}
    .mgrp .lr .pin{color:var(--sel)}
    .lr.hy-rc:not(.sel){background:color-mix(in srgb,var(--hy-rc) 9%,transparent)}`;
  document.head.append(css);
  K.masterGroup = html => html ? `<div class="mgrp" role="group" aria-label="${W.master}">
    <div class="mgh" data-tip="${W.masterTip}" data-side="left">${K.svg('master', 13)}<span>${W.master}</span></div>${html}</div>` : '';
  const list = $('#list'), clipH = $('#cliph'); let lastY = null;
  list.addEventListener('pointermove', e => { lastY = e.clientY; });
  list.addEventListener('pointerleave', () => { lastY = null; });
  addEventListener('keydown', e => {
    if (e.key !== 'Alt' || lastY == null) return; const pair = K.clipPairAt(lastY); if (!pair) return;
    const r = list.getBoundingClientRect(); clipH.style.top = (pair.y - r.top + list.scrollTop) + 'px'; clipH.classList.add('on'); list.style.cursor = 'copy';
  });
  addEventListener('keyup', e => { if (e.key === 'Alt') { clipH.classList.remove('on'); list.style.cursor = ''; } });

  /* ---- the row's colour ---- */
  const menuEl = $('#menu');
  menuEl.addEventListener('click', e => {
    const c = window.hyColorPick ? hyColorPick(e) : null; if (c === null || !menuEl._colorFor) return;
    e.preventDefault(); e.stopImmediatePropagation(); const ns = menuEl._colorFor.map(K.byId).filter(Boolean); K.closeMenu();
    if (ns.some(n => (n.color || '') !== c)) K.edit(W.layerColor, () => ns.forEach(n => { if (c) n.color = c; else delete n.color; }));
  }, true);
  const colorRow = ns => ({ html: window.hyMenuColors ? hyMenuColors(ns.length && ns.every(n => n.color === ns[0].color) ? ns[0].color || '' : null) : '' });

  /* ---- a layer row, a mask thumbnail, the master rows ---- */
  const maskTarget = n => S.ids.length === 1 && S.ids[0] === n.id && S.editMask;
  function maskItems(n) {
    const m = n.mask, adj = n.type === 'adjust', noM = !m && W.whyNoMask;
    return [
      it('eyeoff', m && m.on === false ? W.enableMask : W.disableMask, ['⇧', 'click'], () => K.edit(T.h.maskOnOff, () => { m.on = m.on === false; }), noM),
      it('trash', W.deleteMask, null, () => { S.ids = [n.id]; K.deleteMask(); }, noM || (n.mmask && W.whyMasterMask)),
      it('mask', W.applyMask, null, () => applyMask(n), noM || (adj && W.whyAdjMask) || (n.orig && W.whyOrig)),
      it('invsel', W.invertMask, ['⌘', 'I'], () => K.invertMask(n), noM), null,
      it('copy', W.copyMaskImg, ['⌘', 'C'], () => K.copyMask(n), noM),
      it('paste', W.pasteIntoMask, ['⌘', 'V'], () => K.pasteIntoMask(K.clip.c, n), noM || (!K.clip && W.nothingCopied)),
      it('maskOverlay', W.alone, ['⌥', 'click'], () => { S.ids = [n.id]; S.editMask = true; S.film = true; S.maskShow = 'bw'; S.odirty = true; K.refresh(); }, noM)];
  }
  function masterItems(n) {
    const why = W.whyMaster, mm = !!n.mmask;
    return [
      it(n.visible ? 'eyeoff' : 'eye', n.visible ? W.hide : W.show, null, () => K.edit(n.visible ? T.h.hide : T.h.show, () => { n.visible = !n.visible; })), null,
      it('duplicate', T.duplicateLayer, ['⌘', 'J'], null, why), it('trash', T.deleteLayer, ['⌫'], null, why), it('rename', W.rename, null, null, why),
      it('group', T.groupLayers, ['⌘', 'G'], null, why), it('clip', T.createClip, ['⌥', '⌘', 'G'], null, why), null,
      ...(mm ? K.mmMenu() : [it('mask', W.addMask, null, null, W.whyMasterMask)]), null,
      it('merge', T.mergeDown, ['⌘', 'E'], null, why), it('lock', W.lock, null, null, why)];
  }
  function layerItems(n) {
    const ns = K.selNodes(), multi = ns.length > 1, l = K.locate(n.id), pix = n.type === 'pixel', locked = K.userLock(n), m = n.mask;
    const one = multi ? W.whyOne : '', below = !l || l.i === 0 ? W.whyBelow : '';
    return [colorRow(ns.filter(x => !K.isPinned(x))),
      it('duplicate', T.duplicateLayer, ['⌘', 'J'], K.duplicate), it('trash', T.deleteLayer, ['⌫'], K.deleteSel, ns.some(x => x.orig) && T.origNoDelete),
      it('rename', W.rename, null, () => { const nm = document.querySelector(`#rows .lr[data-id="${n.id}"] .nm`);
        if (nm) nm.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }, one), null,
      it('group', T.groupLayers, ['⌘', 'G'], K.groupSel), it('ungroup', T.ungroupLayers, ['⇧', '⌘', 'G'], K.ungroup, !ns.some(x => x.type === 'group') && W.whyGroup), null,
      it('clip', n.clip ? T.releaseClip : T.createClip, ['⌥', '⌘', 'G'], () => K.toggleClip(n), one || (!n.clip && below)), null,
      it('mask', W.addMask, null, () => K.addMask(), (m && W.whyHasMask) || (n.type === 'group' && W.whyPixel)),
      it('trash', W.deleteMask, null, () => K.deleteMask(), !m && W.whyNoMask),
      it('invsel', W.invertMask, ['⌘', 'I'], () => K.invertMask(n), !m && W.whyNoMask),
      it('mask', W.applyMask, null, () => applyMask(n), (!m && W.whyNoMask) || (!pix && W.whyAdjMask) || (n.orig && W.whyOrig)),
      it('copy', W.copyMaskImg, null, () => K.copyMask(n), !m && W.whyNoMask), null,
      it('merge', multi ? T.mergeLayers : T.mergeDown, ['⌘', 'E'], K.mergeDown, !multi && below), it('flatten', T.mergeVisible, ['⇧', '⌘', 'E'], K.mergeVisible),
      it('flatten', W.flatten, null, K.mergeVisible), null,
      it('lock', locked ? W.unlock : W.lock, null, () => K.edit(locked ? T.h.unlock : T.h.lock, () => ns.filter(x => !K.isPinned(x)).forEach(x => K.setLock(x, !locked)))),
      it(n.visible ? 'eyeoff' : 'eye', n.visible ? W.hide : W.show, null, () => K.edit(n.visible ? T.h.hide : T.h.show, () => { const v = !n.visible; ns.forEach(x => { x.visible = v; }); })), null,
      it('layerStyle', W.copyStyle, null, null, W.noStyles), it('layerStyle', W.pasteStyle, null, null, W.noStyles)];
  }
  // Apply Layer Mask: the mask's look goes into the pixels, the mask goes; one step to undo
  function applyMask(n) {
    const m = n.mask; if (!m || n.type !== 'pixel' || n.orig) return;
    const k = m.c.width / Math.abs(n.w), t = K.mk(m.c.width, m.c.height), tx = t.getContext('2d');
    if (m.on !== false) {
      if (m.density < 100) { tx.fillStyle = `rgba(255,255,255,${1 - m.density / 100})`; tx.fillRect(0, 0, t.width, t.height); }
      K.blurDraw(tx, K.maskLook(m, k), (m.feather || 0) * k);
    } else { tx.fillStyle = '#fff'; tx.fillRect(0, 0, t.width, t.height); }
    const c = K.copyC(n.c), cx = c.getContext('2d'); cx.globalCompositeOperation = 'destination-in'; cx.drawImage(t, 0, 0, c.width, c.height); c._v = (n.c._v | 0) + 1;
    K.edit(W.applyMask, () => { n.c = c; n.mask = null; }); S.editMask = false; K.refresh();
  }
  K.rowMenu = e => {
    const lr = e.target.closest('.lr'); if (!lr) return;
    const id = lr.dataset.id, onMask = !!e.target.closest('[data-a=msk]');
    if (!S.ids.includes(id) || onMask) { S.ids = [id]; S.anchor = id; if (onMask) S.editMask = true; K.refresh(); }
    const n = K.byId(id); if (!n) return;
    const items = n.main || n.mmask ? masterItems(n) : onMask ? maskItems(n) : layerItems(n);
    K.openMenu(items, e.clientX, e.clientY, 'ctx');
    menuEl._colorFor = n.main || n.mmask || onMask ? null : S.ids.filter(x => !K.isPinned(K.byId(x)));
  };

  /* ---- the picture ---- */
  function layersAt(p) {
    const out = []; K.walk(root(), n => { if (n.type !== 'pixel' || !n.visible) return;
      const q = K.LM(n).inverse().transformPoint(new DOMPoint(p.x, p.y)); if (q.x >= 0 && q.y >= 0 && q.x <= n.c.width && q.y <= n.c.height) out.push(n); });
    return out.reverse();
  }
  K.canvasMenu = e => {
    const p = K.toDoc(e.clientX, e.clientY), n = K.one(), pix = n && n.type === 'pixel' ? '' : W.whyPixel, tgt = n && n.mask && (S.editMask || n.type === 'adjust');
    let items;
    if (S.hasSel) items = [
      it('deselect', T.deselect, ['⌘', 'D'], K.deselect), it('invertSelection', W.selInverse, ['⇧', '⌘', 'I'], K.invertSel), null,
      it('feather', T.feather + '…', ['⇧', 'F6'], K.featherDialog),
      { icon: 'grow', label: W.modify, sub: () => [it('grow', T.expand + '…', null, () => K.valueDialog(T.expandSel, 'grow', T.expandBy, 20, 'px', 1, 500, K.growSel)),
        it('grow', T.contract + '…', null, () => K.valueDialog(T.contractSel, 'grow', T.contractBy, 20, 'px', 1, 500, r => K.growSel(-r)))] }, null,
      it('copy', W.layerViaCopy, ['⌘', 'J'], K.copyToLayer, pix), it('cut', K.W.sel.layerViaCut, ['⇧', '⌘', 'J'], K.layerViaCut, pix || (n.orig && W.whyOrig)), null,
      { icon: 'brush', label: W.fill, sub: () => [...K.fillMenu(), null, it('contentFill', T.caFill, ['⇧', 'F5'], K.fillSelection)] }, null,
      it('mask', W.maskFromSel, null, () => (n && n.mmask ? window.__ed.mmFromSel() : K.addMask(true)), !n ? W.whyOne : n.mask && !n.mmask ? W.whyHasMask : ''),
      it('trash', W.deleteFromMask, ['⌫'], () => K.clearInSel(false), !tgt && W.whyNoTarget)];
    else {
      const here = layersAt(p);
      items = [
        it('selectAll', T.selAll, ['⌘', 'A'], K.selectAll), it('selectAll', K.T.reselect, ['⇧', '⌘', 'D'], K.reselect, !S.lastSel && W.whyNoLast),
        it('paste', W.paste, ['⌘', 'V'], K.paste, !K.clip && W.nothingCopied), null,
        { icon: 'layers', label: W.layersHere, dis: !here.length, why: here.length ? '' : W.noLayerHere,
          sub: () => here.map(x => ({ icon: 'image', label: K.esc(x.name), on: S.ids.includes(x.id), fn: () => { S.ids = [x.id]; S.editMask = false; K.refresh(); } })) },
        it('transform', T.freeTransform, ['⌘', 'T'], () => K.startFT(), !S.ids.length && W.whyOne), null,
        it('undo', T.undo, ['⌘', 'Z'], K.undo, !S.undo.length && W.whyNoUndo)];
    }
    menuEl._colorFor = null; K.openMenu(items, e.clientX, e.clientY, 'ctx');
  };
})();
