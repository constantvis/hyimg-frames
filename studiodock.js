// Image Studio's tools in the board's dock (owner 2026-10-08, round 11 «Tools in the dock · D3», note neb38wlg: «Все, отлично, давай делай
// так»; earlier: «зажимаешь внизу какой-то из пунктов, ведешь мышкой вверх и отпускаешь, и выбираем тот или иной элемент, чтобы сократить
// количество кликов»; round 10: the tool column on the left goes into the bottom dock, packed compactly). While the studio is open the
// board's dock carries, left to right: the tool groups, the two colours, the zoom and Actions; the board's switch of studios stays at its
// right end (review/ui/modes.js). The options of the tool in hand ride right above the dock (the studio's #obar, editor/dockwork.js).
// A group with more than one tool has a corner mark and opens its list above the button, as the macOS menu gesture:
//   a plain click        takes the tool the button shows
//   hold 0.25 s, or press and drag up 6 px   the list opens; the tool under the pointer lights up, let go on it and it is in hand
//   let go on the button the list stays, to be clicked
//   Esc, let go elsewhere   nothing changes
//   a press on the corner mark   the list at once: glide onto a tool and let go, or let go on the button and click
//   right click          the list, to be clicked
//   ↑ ↓ ↵                while the list is open
// The dock never moves: each group is one button of a fixed size that only changes its icon, the zoom keeps its width, the strip and the
// list hang above the dock outside it. The studio's own keys (V, G, M, L, W, B, J, I, H, X, D) go on working: the dock gives the
// keyboard back to the studio after each click, and a key that changes the tool changes the dock (K.onTool).
//   const D = studioDock({ t, win, K, zoom, acts })   D.node (into HY.dock)   D.close()   D.destroy()
const HOLD = 250, DRAG = 6;
let css = null;
const STYLE = `
  /* the groups: round 36 × 34 buttons, the one in hand filled in the studio's purple (the frame colour), a corner mark where a group holds more */
  #dock .plgdock button.ifg { position: relative; width: 36px; padding: 0 !important; justify-content: center; background: transparent !important; flex: none;
    transition: transform .12s var(--hy-ease, cubic-bezier(.32,.72,0,1)); }
  #dock .plgdock button.ifg:hover { background: var(--raise) !important; }
  #dock .plgdock button.ifg.on { background: var(--frame) !important; color: var(--hy-on-accent) !important; }
  #dock .plgdock button.ifg .fm { position: absolute; right: 7px; bottom: 7px; width: 0; height: 0; border-left: 4px solid transparent; border-bottom: 4px solid currentColor; opacity: .5; }
  #dock .plgdock button.ifg .fm::after { content: ""; position: absolute; right: -6px; bottom: -6px; width: 14px; height: 14px; }
  #dock .plgdock button.ifg:hover .fm, #dock .plgdock button.ifg.on .fm { opacity: .9; }
  #dock .plgdock button.ifg.press { transform: scale(.92); }
  #dock .plgdock button.ifg.open8 { box-shadow: 0 0 0 2px color-mix(in srgb, var(--frame) 55%, transparent) !important; }
  /* the two colours: the front square the foreground, the back one the background */
  #dock .plgdock .ifcol { position: relative; width: 34px; height: 34px; flex: none; }
  #dock .plgdock .ifcol button { position: absolute; width: 14px; height: 14px !important; min-width: 0; padding: 0 !important; border-radius: 4px !important;
    background: var(--c, var(--raise)) !important; box-shadow: 0 0 0 1.5px var(--panel), 0 0 0 2.5px var(--muted) !important; }
  #dock .plgdock .ifcol .fg { left: 8px; top: 8px; z-index: 1; } #dock .plgdock .ifcol .bg { left: 14px; top: 14px; }
  #dock .plgdock .ifcol input { position: absolute; left: 8px; top: 8px; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  #dock .plgdock #ifZoom { min-width: 72px; justify-content: center; font-variant-numeric: tabular-nums; }
  /* the dock in the middle of the board's free part, between the library and the studio's right column (editor/dockwork.js) */
  html.ifedit #dock.plg-mode.ifmid { left: var(--ifdx) !important; transition: left .3s var(--hy-ease, cubic-bezier(.32,.72,0,1)); }
  /* the list over a group: the app's menu (ui/menu.js items), over the studio and its dock */
  .ifly { position: fixed; z-index: 1210; min-width: 236px; padding: 6px; display: none; border: 1px solid var(--line); border-radius: 14px;
    background: color-mix(in srgb, var(--panel) 92%, transparent); backdrop-filter: blur(18px) saturate(1.4); -webkit-backdrop-filter: blur(18px) saturate(1.4);
    box-shadow: var(--hy-sh-pop); transform-origin: 18px 100%; }
  .ifly.show { display: block; animation: iflyIn .16s var(--hy-ease, cubic-bezier(.32,.72,0,1)); }
  @keyframes iflyIn { from { opacity: 0; transform: translateY(6px) scale(.97); } }
  .ifly .mt { padding: 6px 10px 4px; color: var(--muted); font: 600 10.5px var(--sans); letter-spacing: .06em; text-transform: uppercase; }
  .ifly button { display: flex; align-items: center; width: 100%; height: 32px; padding: 0 10px; border: 0; border-radius: var(--hy-row-r, 9px);
    background: none; color: var(--sub); font: 500 13px var(--sans); cursor: default; }
  .ifly button.cur { color: var(--ink); }
  .ifly button.cur .ml::after { content: ""; display: inline-block; width: 5px; height: 5px; margin-left: 8px; border-radius: 50%; background: var(--frame); vertical-align: middle; }
  .ifly button.hi { background: color-mix(in srgb, var(--frame) 85%, transparent); color: var(--hy-on-accent); }
  .ifly button.hi > svg { opacity: 1; } .ifly button.hi.cur .ml::after { background: var(--hy-on-accent); }
  @media (prefers-reduced-motion: reduce) { .ifly.show { animation: none; } #dock .plgdock button.ifg { transition: none; } }`;

export function studioDock({ t, win, K, zoom, acts }) {
  if (!css) { css = document.createElement("style"); css.textContent = STYLE; document.head.appendChild(css); }
  const D = K.dock, G = D.groups(), esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const ic = (id, s) => (K.svg ? K.svg(id, s) : "");   // the studio's own names for its tools' icons (pick: the eyedropper)
  const toolOf = id => { for (const g of G) { const x = g.tools.find(y => y.id === id); if (x) return [g, x]; } return [null, null]; };
  const keyText = x => x.keys.join("");
  const node = document.createElement("span");
  node.innerHTML = G.map(g => { const multi = g.tools.length > 1, x = g.tools[0];
    return `<button class="ifg${multi ? " multi" : ""}" data-g="${g.id}" data-t="${x.id}" aria-haspopup="${multi ? "menu" : "false"}">${ic(x.id, 17)}`
      + (multi ? `<i class="fm" title="${esc(t("Hold, or click here: the other tools"))}"></i>` : "") + `</button>`; }).join("")
    + `<span class="sep"></span><span class="ifcol" role="group" aria-label="${esc(t("Colors"))}">`
    + `<button class="fg" title="${esc(t("Foreground color") + " · " + t("X swaps, D resets"))}"></button>`
    + `<button class="bg" title="${esc(t("Background color") + " · " + t("X swaps, D resets"))}"></button><input type="color" tabindex="-1" aria-hidden="true"></span>`
    + `<span class="sep"></span>`;
  node.append(zoom, acts);
  const btns = [...node.querySelectorAll("button.ifg")], back = () => { try { win.focus(); } catch (e) {} };
  // a group's button shows the tool it would take, its name and key in the tooltip
  function show(b, id) {
    const [, x] = toolOf(id); if (!x) return; b.dataset.t = id;
    const sv = b.querySelector("svg"), nw = document.createElement("span"); nw.innerHTML = ic(id, 17); if (sv && nw.firstChild) sv.replaceWith(nw.firstChild);
    const tip = x.name + (x.keys.length ? " · " + keyText(x) : "") + (b.classList.contains("multi") ? " · " + t("hold and drag up for the others") : "");
    b.title = tip; b.setAttribute("aria-label", x.name);
  }
  function sync(id) {
    const [g] = toolOf(id);
    btns.forEach(b => { const on = !!g && b.dataset.g === g.id; if (on && b.dataset.t !== id) show(b, id); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  }
  btns.forEach(b => show(b, b.dataset.t)); sync(D.tool());
  function pick(b, id) { show(b, id); D.setTool(id); sync(D.tool()); back(); }
  // the colours: the front square the foreground; the picker is this page's, the studio takes the colour as from its own swatches
  const fgB = node.querySelector(".ifcol .fg"), bgB = node.querySelector(".ifcol .bg"), cin = node.querySelector(".ifcol input");
  function colors(fg, bg) { fgB.style.setProperty("--c", fg); bgB.style.setProperty("--c", bg); }
  { const c = D.colors(); colors(c.fg, c.bg); }
  [fgB, bgB].forEach(b => b.addEventListener("click", e => { e.stopPropagation(); const w = b === fgB ? "fg" : "bg"; cin.dataset.w = w; cin.value = D.colors()[w]; cin.click(); }));
  cin.addEventListener("input", () => D.setColor(cin.dataset.w || "fg", cin.value));
  cin.addEventListener("change", back);

  /* ---- the list over a group ---- */
  const fly = document.createElement("div"); fly.className = "menu ifly"; fly.setAttribute("role", "menu"); fly.dataset.hymenu = "";
  document.body.appendChild(fly);
  let F = null, P = null;   // F: the open list {b, sticky}; P: the press on a button {b, x0, y0, timer, sticky}
  const items = () => [...fly.querySelectorAll("button[data-t]")];
  const hilite = it => items().forEach(x => x.classList.toggle("hi", x === it));
  function openFly(b, sticky) {
    const g = G.find(x => x.id === b.dataset.g); if (!g || g.tools.length < 2) return;
    const it = x => (window.hyMenuItem ? window.hyMenuItem(`data-t="${x.id}" class="${x.id === b.dataset.t ? "cur" : ""}"`, ic(x.id, 15), esc(x.name), x.keys)
      : `<button role="menuitem" data-t="${x.id}">${esc(x.name)}</button>`);
    fly.innerHTML = `<div class="mt">${esc(g.name)}</div>` + g.tools.map(it).join("");
    fly.classList.add("show"); F = { b, sticky: !!sticky };
    const r = b.getBoundingClientRect(), dr = (document.getElementById("dock") || b).getBoundingClientRect();
    fly.style.left = Math.max(8, Math.min(innerWidth - fly.offsetWidth - 8, r.left - 6)) + "px"; fly.style.top = Math.max(8, dr.top - 8 - fly.offsetHeight) + "px";
    if (sticky) hilite(items().find(x => x.dataset.t === b.dataset.t));
    b.classList.add("open8"); b.setAttribute("aria-expanded", "true"); D.fly(true);
  }
  function closeFly() {
    if (!F) return; F.b.classList.remove("open8"); F.b.setAttribute("aria-expanded", "false"); F = null;
    fly.classList.remove("show"); fly.innerHTML = ""; D.fly(false);
  }
  // the row under a point by the rows' boxes, not by what the point hits: the list is found whatever lies over it or whichever page heard
  // the event (owner 2026-10-09 in the app: «зажимаю, навожу на другой тул и отпускаю мышку, оно не включается»)
  const rowAt = (x, y) => items().find(it => { const r = it.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; }) || null;
  const onBtn = (b, x, y) => { const r = b.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  // A press is followed on the windows, this page's and the studio's, not on the button: the gesture does not hang on the pointer capture,
  // which the app's Chromium may not keep, nor on which element the release lands (the list, the gap over the studio's page, the button).
  // A move without the button down is a release that was not heard
  const sw = () => { try { return win && win !== window && win.frameElement ? win : null; } catch (e) { return null; } };
  function press(on) {
    const w2 = sw(), f = on ? "addEventListener" : "removeEventListener";
    for (const [w, h] of [[window, pmTop], [w2, pmIn]]) if (w) ["pointermove", "pointerup", "pointercancel"].forEach(t => w[f](t, h, true));
  }
  const pmTop = e => pm(e, e.clientX, e.clientY);
  const pmIn = e => { const fe = sw() && win.frameElement; if (!fe) return; const r = fe.getBoundingClientRect(); pm(e, r.left + e.clientX, r.top + e.clientY); };
  function endPress() { if (!P) return null; const p = P; P = null; clearTimeout(p.timer); p.b.classList.remove("press"); press(false); return p; }
  function pm(e, x, y) {
    if (!P || (P.id != null && e.pointerId !== P.id)) return;
    if (e.type === "pointercancel") { endPress(); closeFly(); return; }
    if (e.type === "pointerup" || (e.type === "pointermove" && !(e.buttons & 1))) return up(x, y);
    const b = P.b;
    if (!F && b.classList.contains("multi") && P.y0 - y > DRAG) { clearTimeout(P.timer); openFly(b, false); }
    if (F) { const it = rowAt(x, y); if (it || !onBtn(b, x, y)) hilite(it); }   // the row under the pointer lit, the button keeps what is lit
  }
  function up(x, y) {
    const p = endPress(); if (!p) return; const b = p.b;
    const it = F && rowAt(x, y);
    if (it) { closeFly(); pick(b, it.dataset.t); return; }   // let go on a tool: it is in hand
    const on = onBtn(b, x, y);
    if (!F) { if (on) pick(b, b.dataset.t); else back(); return; }   // a plain click: the tool the button shows
    if (on) { F.sticky = true; hilite(items().find(x => x.classList.contains("cur"))); return back(); }   // let go on the button: the list stays
    closeFly(); back();   // let go anywhere else: nothing changes
  }
  btns.forEach(b => {
    b.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();   // the keyboard stays with the studio
      endPress();
      if (F && F.b === b && F.sticky) { closeFly(); return; }   // the same button again closes a list that waits
      closeFly();
      try { b.setPointerCapture(e.pointerId); } catch (er) {}
      P = { b, x0: e.clientX, y0: e.clientY, id: e.pointerId }; b.classList.add("press"); press(true);
      if (e.target.closest(".fm") && b.classList.contains("multi")) { openFly(b, true); return; }   // the corner mark: the list at once
      if (b.classList.contains("multi")) P.timer = setTimeout(() => { if (P && P.b === b && !F) openFly(b, false); }, HOLD);
    });
    b.addEventListener("click", e => { e.stopPropagation(); back(); });   // not the board's dock click: it would take the keyboard to the board
    b.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); if (!b.classList.contains("multi")) return; closeFly(); openFly(b, true); back(); });
  });
  fly.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); });
  fly.addEventListener("click", e => { const it = e.target.closest("button[data-t]"); if (!it || !F) return; const b = F.b; closeFly(); pick(b, it.dataset.t); });
  fly.addEventListener("pointermove", e => { if (F && F.sticky) { const it = e.target.closest("button[data-t]"); if (it) hilite(it); } });
  // a press anywhere else closes a list that waits (on the board here, on the studio's page through link.outside)
  const outside = e => { if (F && !(e.target.closest && e.target.closest(".ifly, button.ifg"))) closeFly(); };
  document.addEventListener("pointerdown", outside, true);
  // ↑ ↓ ↵ Esc while the list is open, from this page or from the studio's (link.key)
  function key(e) {
    if (!F) return false;
    const its = items(), i = its.findIndex(x => x.classList.contains("hi"));
    if (e.key === "Escape") { endPress(); closeFly(); back(); return true; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {   // from nothing lit, ↓ the first and ↑ the last
      const d = e.key === "ArrowDown" ? 1 : -1, j = i < 0 ? (d > 0 ? 0 : its.length - 1) : (i + d + its.length) % its.length;
      hilite(its[j]); F.sticky = true; return true;
    }
    if (e.key === "Enter") { if (i >= 0) { const b = F.b, id = its[i].dataset.t; closeFly(); pick(b, id); } return true; }
    if (!["Meta", "Shift", "Alt", "Control"].includes(e.key)) closeFly();   // another key: the list goes, the key does what it does
    return false;
  }
  const onKey = e => { if (key(e)) { e.preventDefault(); e.stopImmediatePropagation(); } };
  addEventListener("keydown", onKey, true);
  // the studio says where the free part of the board is (its coordinates are the stage's: its page covers the stage); the dock keeps 8 px
  // from the library when the part is narrower than the dock
  const dock = document.getElementById("dock");
  function center(c, l) {
    if (!dock) return; const w = dock.offsetWidth || 0;
    dock.style.setProperty("--ifdx", Math.max(c, l + w / 2 + 8) + "px"); dock.classList.add("ifmid");
  }
  D.link({ tool: id => sync(id), colors, key, center, outside: () => { if (F && !P) closeFly(); } });
  return {
    node, close: closeFly, sync, get open() { return !!F; },
    destroy() {
      endPress(); closeFly(); D.link(null); fly.remove(); removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", outside, true);
      if (dock) { dock.classList.remove("ifmid"); dock.style.removeProperty("--ifdx"); }
    },
  };
}
