// Leaving keeps the work without waiting for it (owner decision 2026-10-10, «а ты как лучше думаешь»), on window.hyEdK (index.html). The
// last Esc, the Board segment, another Studio's and a page switch used to keep the studio open for the 1–2 s the render and the write take.
// Now the studio goes at once (its page fades as exitBoard's, the board's side gives the board back: imgframe.js away), and this page,
// hidden and still loaded, renders and writes the work as Save does. Written: the board's card shows it and this page goes (host.done).
// Refused: the card's LED turns red and the board's note offers «Open again» (host.failed); then resume() shows this page again with the
// work exactly as it was left, so nothing is lost. Cancel, Save and the question before unsaved work are unchanged.
//   K.away.can()   the board can take it: the studio is on a board whose Hyimg knows away(), and the layers are loaded
//   K.away.go()    leave now, write after: a resolved promise (the studio is gone)
//   K.away.on      true while the write of a studio that left runs (saveFrame skips its progress card's frames and its own exit)
(() => {
  const K = window.hyEdK; if (!K || !K.S) return;
  const S = K.S, A = K.away = { on: false };
  const card = () => document.getElementById('rcard');
  A.can = () => { const H = K.host(); return !!(H && H.away && window.__ed && __ed.BM && S.ready); };
  A.go = () => {
    const H = K.host(); A.on = true; S.leaving = true;
    K.closeActs(); K.closeMenu(); K.hideTip();
    document.body.classList.remove('in'); K.ENT.to = 0; H.away();
    requestAnimationFrame(() => document.body.classList.add('out'));
    // after the page's own fade (exitBoard's 420 ms): the render's heavy part does not stall it
    setTimeout(() => { if (A.on) K.saveFrame(); }, 440);
    return Promise.resolve();
  };
  // saveFrame's ends: the card shows the new render (shown), then the board lets this page go; or the write was refused
  A.saved = shown => Promise.resolve(shown).then(() => { A.on = false; const c = card(); if (c) c.classList.remove('on', 'done'); K.host().done(); });
  A.failed = e => { A.on = false; const c = card(); if (c) c.classList.remove('on', 'err'); K.host().failed(e && e.message ? e.message : String(e)); };
  // the board brings the studio back over the card (imgframe.js reopen): the work is still here, the chrome comes in as at the opening
  A.resume = () => {
    A.on = false; S.leaving = false; S.saving = false;
    document.body.classList.remove('out'); K.syncView(); K.layout(); S.dirty = true;
    requestAnimationFrame(() => { document.body.classList.add('in'); K.ENT.to = 1; });
  };
})();
