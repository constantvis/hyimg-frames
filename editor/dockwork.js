// The studio's tools in the board's dock (owner 2026-10-08, round 11 D3, note neb38wlg: «Все, отлично, давай делай так»; round 10: the tool
// column on the left moves into the bottom dock, packed compactly), on window.hyEdK (index.html). On the board (:root.board) the tool rail
// steps out and the board's dock carries the tool groups (../studiodock.js builds them there); this page gives that dock what it needs:
//   K.dock             the groups of the dock (only the tools this studio has), the tool in hand, setTool, the colours, link(api)
//   the options strip  the options bar (#obar) rides right above the dock, centred on it, never wider than the free part; its numbers show their
//                      value as a fill in the studio's purple (the frame colour, --frame) like the panels' sliders
//   K.onTool, K.onColors   what index.html calls when the tool or a colour changes: the dock follows (link.tool, link.colors)
//   the keys           while the dock's list is open its keys (↑ ↓ ↵ Esc) go to the list first (link.key), a press on the picture closes it
(() => {
  const K = window.hyEdK; if (!K || !K.S) return;
  const { S, T } = K, root = document.documentElement, obar = document.getElementById('obar');
  const W = window.hyEdTr({ selMove: 'Select and move' });
  const board = () => root.classList.contains('board');
  // D3's groups: Select and Move, the selections, the brush, healing, the eyedropper, the hand. No eraser, crop, content-aware fill or
  // Select Subject among the tools: the studio has none as a tool (Select Subject and the fill are commands, on the bar and in Actions)
  const GROUPS = [
    { id: 'gsel', name: () => W.selMove, tools: ['select', 'move'] },
    { id: 'gmarq', name: () => T.selectionTools, tools: ['marquee', 'ellipse', 'lasso', 'wand'] },
    { id: 'gbrush', name: () => T.tool.brush, tools: ['brush'] },
    { id: 'gheal', name: () => T.healingTools, tools: ['patch'] },
    { id: 'gpick', name: () => T.tool.pick, tools: ['pick'] },
    { id: 'ghand', name: () => T.tool.hand, tools: ['hand'] },
  ];
  // a tool's keys as the studio takes them: the first tool of a letter has it, the next ones of the same letter ⇧ and it (⇧M: the next one)
  const keysOf = id => {
    const all = K.TOOLS || [], t = all.find(x => x.id === id); if (!t || !t.key) return [];
    return all.filter(x => x.key === t.key).indexOf(t) > 0 ? ['⇧', t.key] : [t.key];
  };
  let link = null;
  K.dock = {
    groups: () => GROUPS.map(g => ({ id: g.id, name: g.name(), tools: g.tools.map(id => ({ id, name: (T.tool && T.tool[id]) || id, keys: keysOf(id) })) })),
    tool: () => S.tool,
    setTool: id => { if (S.tool !== id) K.setTool(id); },
    colors: () => ({ fg: S.fg, bg: S.bg }),
    // the same way as the rail's swatches: the colour input of the page, so the mask's toast and the history stay as they were
    setColor(which, v) { const c = document.getElementById('colorIn'); if (!c) return; S.colTarget = which === 'bg' ? 'bg' : 'fg'; c.value = v; c.dispatchEvent(new Event('input')); },
    link(api) { link = api || null; place(true); },
    // the list over a group opens where the options were: the strip steps aside while it is open
    fly(on) { obar.classList.toggle('fly', !!on); },
  };
  K.onTool = id => { if (link && link.tool) link.tool(id); };
  K.onColors = () => { if (link && link.colors) link.colors(S.fg, S.bg); };
  K.obarDocked = board;
  K.xfPlace = 'above';   // free transform's keys over the strip (index.html updModeBar), not under it on the dock

  // the keys of the dock's list come here while the studio has the keyboard; Esc there closes the list, not the studio
  addEventListener('keydown', e => { if (link && link.key && link.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  addEventListener('pointerdown', () => { if (link && link.outside) link.outside(); }, true);

  /* ---- the strip: the options bar over the dock, centred on it ---- */
  const css = document.createElement('style');
  css.textContent = `:root.board #rail{display:none!important}
    :root.board #obar.indock{top:auto!important;max-width:calc(var(--obr, 100vw) - var(--obl, 12px) - 12px)!important;translate:0 10px}
    :root.board body.in #obar.indock{translate:0 0}
    :root.board body.in #obar.indock.fly{opacity:0;translate:0 6px;pointer-events:none}
    #obar.indock .mic{background:transparent;box-shadow:none;color:var(--frame)}
    #obar.indock .dtn{color:var(--ink);font-weight:500;font-size:12.5px;padding:0 8px 0 2px;flex:none} #obar.indock:is(.tight,.noname) .dtn{display:none}
    #obar.indock .xff[data-fill]{background:linear-gradient(90deg,transparent var(--a),color-mix(in srgb,var(--frame) 30%,transparent) var(--a) var(--b),transparent var(--b)) var(--raise)}
    #obar.indock .xff[data-fill]:focus-within{background-image:linear-gradient(90deg,transparent var(--a),color-mix(in srgb,var(--frame) 44%,transparent) var(--a) var(--b),transparent var(--b))}`;
  document.head.append(css);
  // the parent's dock in this page's coordinates (the page is a frame over the whole board)
  function dockBox() {
    try { const pd = parent !== window && parent.document.getElementById('dock'), fe = frameElement; if (!pd || !fe) return null;
      const a = pd.getBoundingClientRect(), f = fe.getBoundingClientRect(); return a.width ? { left: a.left - f.left, top: a.top - f.top, w: a.width } : null; } catch (e) { return null; }
  }
  // the free part of the board between the library (--inset) and the right column: the dock stands in its middle (link.center), so it
  // never lies over the panels; offsetLeft, not the box, so the column's slide in does not move the dock along
  function freeRight() { const sd = document.getElementById('side'); return sd && sd.offsetWidth ? sd.offsetLeft : innerWidth; }
  let at = '', mid = '';
  function place(force) {
    const on = board(); obar.classList.toggle('indock', on); if (!on) return;
    const r = freeRight(), l = Math.max(0, parseFloat(root.style.getPropertyValue('--inset')) || 0), c = Math.round((l + r) / 2);
    if ((c + '|' + l + '|' + r !== mid || force) && link && link.center) { mid = c + '|' + l + '|' + r; link.center(c, l, r); }
    const d = dockBox(); if (!d) return;
    // its room: from the library to the right column; the bar is built again for a new room, its labels fold when it does not fit there
    // (index.html updModeBar, «tight»)
    const bt = Math.round(innerHeight - d.top + 8), k = l + '|' + r + '|' + bt;
    if (k !== at || force) {
      at = k; obar.style.bottom = bt + 'px'; root.style.setProperty('--obl', (l + 12) + 'px'); root.style.setProperty('--obr', r + 'px'); S.mbKey = '';
    }
    // centred over the dock, on its centre line (owner 2026-10-09: «второе меню сверху должно быть отцентрировано, а то оно left aligned
    // относительно меню нижнего»); near an edge of the free part it steps in just enough, never under the library or the right column
    const w = obar.offsetWidth, x = Math.round(Math.max(l + 12, Math.min(d.left + d.w / 2 - w / 2, r - 12 - w))) + 'px';
    if (obar.style.left !== x) obar.style.left = x;
  }
  // a number's fill: from the start of its range, or from 0 for a range around it; a size on a log scale, as the brush grows
  function fill(el) {
    const o = el._o; if (!o || o.min == null || o.max == null || !(o.max > o.min)) return;
    const v = Math.max(o.min, Math.min(o.max, +o.get())), lg = o.unit === 'px' && o.min >= 1 && o.max / o.min > 50;
    const f = lg ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min), c = o.min < 0 && o.max > 0 ? -o.min / (o.max - o.min) : 0;
    const p = n => (n * 100).toFixed(1) + '%', a = p(Math.min(c, f)), b = p(Math.max(c, f));
    if (el.dataset.fill !== a + b) { el.dataset.fill = a + b; el.style.setProperty('--a', a); el.style.setProperty('--b', b); }
  }
  // the tool's name after its icon, as the concept's strip says it (index.html's bar shows the icon alone, its name in the tooltip)
  function dress() {
    if (!board()) return; const oc = obar.querySelector('.oc'); if (!oc) return;
    const mic = oc.querySelector(':scope > .mic'); if (mic && !(mic.nextElementSibling && mic.nextElementSibling.classList.contains('dtn'))) {
      const n = document.createElement('span'); n.className = 'dtn'; n.textContent = mic.dataset.tip || ''; obar.classList.remove('noname'); mic.after(n);
      if (oc.scrollWidth > oc.clientWidth + 1) obar.classList.add('noname'); }   // no room for the name: it goes first, the labels stay whole
    oc.querySelectorAll('.xff').forEach(fill);
  }
  new MutationObserver(dress).observe(obar, { childList: true });
  (function tick() { if (board()) { place(); dress(); } requestAnimationFrame(tick); })();
})();
