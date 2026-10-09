// ⌘ picks the layer under the pointer, as in Photoshop (owner 2026-10-07: «я зажимаю ⌘: в фотошопе так могу выбирать слои и перетаскивать
// их, он подсвечивает, какие у меня слои»), on window.hyEdK (index.html). Only the pointer changes: ⌘Z, ⌘J, ⌘C and the rest stay keys.
//   Select (V), or Move (G) with Auto-Select off: while ⌘ is held the layer under the pointer is outlined on the picture (the thin line
//     of a hovered row, in the selection's colour) and its row lights up; a click picks it, ⇧⌘-click adds or removes it, a drag moves it
//     at once (one step to undo); the topmost visible layer that is not locked, by its bounds (hitTest), the base layer never
//   Move with Auto-Select on: ⌘ turns it off for the click, a drag moves what is selected (Photoshop's way round)
// The options bar says it after the tool's own hint (barHint)
(() => {
  const K = window.hyEdK; if (!K || !K.S) return;
  const { S } = K, view = K.view;
  const W = window.hyEdTr({ selHint: '⌘ drags the layer under the pointer', moveOff: '⌘ picks the layer under the pointer', moveOn: '⌘ moves without Auto-Select' });
  K.W = Object.assign(K.W || {}, { pick: W });
  let cmd = false, last = null, lit = null;
  const picking = () => cmd && S.ready && !S.space && !S.xf && !S.hsPick && (S.tool === 'select' || (S.tool === 'move' && !S.autoSel));
  const onRuler = e => document.body.classList.contains('rul') && (e.clientY >= innerHeight - 18 || e.clientX < 18);
  const under = (x, y) => { const h = K.hitTest(K.toDoc(x, y)); return h && !h.base ? h : null; };
  function light(id) {
    if (id === lit) return;
    document.querySelectorAll('#rows .lr.pk').forEach(r => r.classList.remove('pk'));
    lit = id; S.hoverRow = id; S.odirty = true;   // the hovered row's outline (drawHoverRow)
    const r = id && document.querySelector(`#rows .lr[data-id="${id}"]`); if (r) r.classList.add('pk');
  }
  function update() {
    if (S.mv) return;   // a drag keeps its layer lit
    const h = picking() && last ? under(last.x, last.y) : null; light(h ? h.id : null);
  }
  view.addEventListener('pointermove', e => { last = { x: e.clientX, y: e.clientY }; cmd = e.metaKey; update(); });
  view.addEventListener('pointerleave', () => { last = null; if (!S.mv) light(null); });
  addEventListener('keydown', e => { if (e.key === 'Meta' && !cmd) { cmd = true; update(); } });
  addEventListener('keyup', e => { if (e.key === 'Meta') { cmd = false; update(); } });
  addEventListener('blur', () => { cmd = false; light(null); });
  try {   // in place on the board the keys may go to the board's page while the pointer is over the frame
    if (parent !== window) {
      parent.addEventListener('keydown', e => { if (e.key === 'Meta' && !cmd) { cmd = true; update(); } });
      parent.addEventListener('keyup', e => { if (e.key === 'Meta') { cmd = false; update(); } });
    }
  } catch (er) {}
  addEventListener('pointerup', () => setTimeout(update, 0));

  // before the page's own handler (capture on the canvas itself)
  view.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.metaKey || e.altKey || !S.ready || S.xf || S.space || S.hsPick || onRuler(e)) return;
    if (S.tool === 'move' && S.autoSel) { S.autoSel = false; setTimeout(() => { S.autoSel = true; }, 0); return; }   // the page's handler runs without it
    cmd = true; if (!picking()) return;
    e.preventDefault(); e.stopImmediatePropagation(); K.closeMenu();
    const h = under(e.clientX, e.clientY); if (!h) return;
    if (e.shiftKey) { S.ids = S.ids.includes(h.id) ? S.ids.filter(x => x !== h.id) : [...S.ids, h.id]; S.anchor = h.id; S.editMask = false; K.refresh(); return; }
    if (!K.topSel().some(s => s === h || K.isDesc(h, s))) { S.ids = [h.id]; S.anchor = h.id; S.editMask = false; K.refresh(); }
    const set = K.moveSet(); if (!set.length) return;
    view.setPointerCapture(e.pointerId);
    const p = K.toDoc(e.clientX, e.clientY), bb = K.boxOf(set);
    K.beginEdit(K.T.h.move); S.mv = { x: p.x, y: p.y, set, orig: set.map(n => [n.x, n.y]), moved: false, ab: bb && K.aabb(bb) };   // the page's drag
  }, true);

  // the options bar: what ⌘ does with this tool
  let hint = null;
  const hintText = t => (t === 'select' ? W.selHint : t === 'move' ? (S.autoSel ? W.moveOn : W.moveOff) : '');
  K.barHint = t => {
    if (t !== 'select' && t !== 'move') return null;
    hint = document.createElement('span'); hint.className = 'hint2 pkh'; hint.textContent = hintText(t); return hint;
  };
  document.getElementById('obar').addEventListener('click', () => setTimeout(() => { if (hint && hint.isConnected) hint.textContent = hintText(S.tool); }, 0));
  const css = document.createElement('style');
  css.textContent = '.lr.pk:not(.sel){background:var(--raise);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--sel) 45%,transparent)}';
  document.head.append(css);
})();
