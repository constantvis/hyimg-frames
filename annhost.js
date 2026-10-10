// The board's side of Image Studio's annotations (editor/annwork.js; owner 2026-10-09 on round 15: «Image Studio точно так же, чтобы я мог
// выбрать и слой»). The studio is a page over the board (imgframe.js), the threads are the board's (Hyimg ui/comments.js). While a frame is
// open here:
//   - the board asks the studio where a thread on one of the frame's layers stands (hyComments.position): the open thread follows its pin;
//   - the thread's window stands over the studio's page, in the board's free part, off the studio's right column (hyComments.bounds);
//   - the frame's own pins on the board step aside: the studio draws them over the picture, round, in its purple (Hyimg ui/studiopins.js);
//   - the threads changing and a thread opened reach the studio (its rows' counts, the layer of the opened one picked), and the keys go back
//     to the studio when the thread's window closes.
//   const A = annHost(HY, () => ED)   A.open(ED)   A.close()
let hooked = false;
const STYLE = `
  html.ifedit #cmthread, html.ifedit #cmat { z-index: 1201 !important; }   /* the open thread over the studio's page (z 1100) */
  html.ifedit #cmlist { z-index: 1201 !important; }`;

export function annHost(HY, cur) {
  const CM = () => window.hyComments, win = () => { const e = cur(); return e && e.win && e.win.hyEdAnn ? e.win : null; };
  const st = document.createElement("style"); st.textContent = STYLE; document.head.appendChild(st);
  const hide = document.createElement("style");
  function hook() {
    if (hooked || !CM() || !CM().position) return; hooked = true;
    CM().position(t => { const e = cur(), w = win(); return e && w && t.anchor && t.anchor.obj === e.id ? w.hyEdAnn.boardAt(t) : undefined; });
  }
  addEventListener("hy-comments", () => { const w = win(); if (w) w.hyEdAnn.changed(); });
  addEventListener("hy-comment-open", e => { const w = win(), d = e.detail || {}; if (w && d.thread && !d.made) w.hyEdAnn.opened(d.thread); });
  // the thread's window closed: the keys back to the studio's page
  const mo = new MutationObserver(() => {
    const el = document.getElementById("cmthread"), e = cur();
    const away = document.activeElement === document.body || (el && el.contains(document.activeElement));
    if (e && e.win && el && !el.classList.contains("open") && away) try { e.win.focus(); } catch (x) {}
  });
  const watch = () => { const el = document.getElementById("cmthread"); if (el) mo.observe(el, { attributes: true, attributeFilter: ["class"] }); else setTimeout(watch, 500); };
  watch();
  return {
    open(e) {
      hook();
      hide.textContent = `#cmpins > [data-o="${CSS.escape(e.id)}"], #cmpins > [data-c="draft"], #cmpins > [data-a="draft"], #cmpins > [data-a="live"] { display: none !important; }`;
      document.head.appendChild(hide);
      if (CM() && CM().bounds) CM().bounds(() => { const w = win(); return w ? w.hyEdAnn.free() : null; });
    },
    close() {
      hide.remove();
      if (CM()) { if (CM().state && CM().state.draft) CM().close(); if (CM().bounds) CM().bounds(null); if (CM().draw) CM().draw(); }
    },
  };
}
