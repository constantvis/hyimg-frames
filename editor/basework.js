// The base layer, as Photoshop's Background (owner 2026-10-07: «наш главный слой, самый нижний, тоже должен быть залочен, чтобы было
// ясно, что его можно только выключить»), on window.hyEdK (index.html). The base layer is the picture the frame is made of: the bottom
// layer of the document when it is an original (a library picture). It wears a closed padlock that does not open from its row (the
// same place and the same padlock as every row's lock, so it reads next to the master rows' crown as «locked», not as «master»).
//   it can be hidden (its eye) and painted over (the brush goes to a new layer, as on any original); the master Raw Editor and Mask
//   act on it as on everything; Duplicate makes a normal layer of it
//   it is not moved, transformed, deleted, renamed, grouped, merged into or unlocked, nothing goes under it; what would do it says why;
//   ⌥ and a drag of its row leaves a copy, a normal layer, over it
// In frame.json the layer carries `base: true` (and the locks it has); a frame saved before has no flag: its bottom original becomes
// the base on load, in memory only, and goes to the file with the next Save. A Hyimg without this module reads the flag as nothing.
(() => {
  const K = window.hyEdK; if (!K || !K.S) return;
  const W = window.hyEdTr({ why: 'Base layer: only hide' });
  K.W = Object.assign(K.W || {}, { base: W });
  const LOCKED = () => ({ alpha: true, pixels: true, pos: true, all: true });
  // on load: the flagged layer, or else the bottom original of the document
  K.markBase = list => {
    const top = list.filter(n => !K.isPinned(n));
    if (!top.some(n => n.base)) { const b = top[0]; if (b && b.type === 'pixel' && b.orig) b.base = true; }
    top.forEach(n => { if (n.base) n.locks = LOCKED(); });
  };
  // a step that would change the base layer: its reason as a note, true to stop
  K.baseStop = ns => {
    if (!(ns || []).some(n => n && n.base)) return false;
    K.toast(W.why, 'lock'); return true;
  };
  // the list's drag: the base layer stays where it is, and nothing goes under it. A ⌥-drag (copy) of it leaves a copy over it, as Photoshop's
  // Background (owner 2026-10-09: «зажимаю Option, пытаюсь перетащить выше, чтобы скопировать слой базовый ... ничего не происходит»)
  K.baseDrop = (sel, t, copy) => (!copy && sel.some(n => n.base)) || !!(t && t.ref && t.ref.base && t.pos === 'below');
  K.baseWhy = n => (n && n.base ? W.why : '');
  // its row's padlock: shut, a mark and not a button (the eye drag over locks passes it by)
  K.baseLock = () => `<span class="rb hy-ri keep bse" data-tip="${W.why}" data-side="left">${window.hyLockIcon ? hyLockIcon(true, 14) : K.svg('lock', 14)}</span>`;
  const css = document.createElement('style');
  css.textContent = '.lr .rb.bse{cursor:default}.lr .rb.bse:hover{background:none;color:var(--sub)}';
  document.head.append(css);
})();
