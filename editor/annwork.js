// Annotations in Image Studio (owner 2026-10-09 on round 15, r15-image.html liked as drawn: «Да и не только в 3D, в картинках тоже должны
// быть аннотации. Image Studio точно так же, чтобы я мог выбрать и слой»). A thread is tied to a layer and its pin follows the layer when it
// is moved, turned or scaled:
//   C or «Annotation» in the dock   the tool (id comment): a click on the picture drops a pin on the picked layer when the click is on it,
//                                   else on the layer under the pointer; a drag marks an area; Esc or C again gives the tool before back
//   Layers                          a row with open threads shows their count (a click opens the newest, again the next one)
//   Annotations                     a tab of the upper block beside Properties | Adjustments | History (owner 2026-10-10 on round 17,
//                                   version 2: «Properties tab»): Hyimg's one list of a Studio's threads (ui/annlist.js, 3D Studio's too),
//                                   by layer, Open | Resolved, «This layer», a field for the picked layer; a click on a thread picks its layer
// The thread is the board's (Hyimg ui/comments.js, the page around this one): replies, @mentions, Resolve, the bell, hy.py comments. Its
// anchor names the frame's card and the layer (anchor.part, Hyimg review/comments.py clean_part): {kind: "layer", id, name, local: [u, v]
// shares of the layer's own pixels, area?: [u, v, w, h] of them}. Its at and area are the place on the card's picture (the document's
// shares), put right again at each Save (op place), so the board shows the pin where the layer is. The board side is ../annhost.js.
(() => {
  const K = window.hyEdK, ED = window.__ed; if (!K || !K.S || !ED) return;
  const { S, T } = K, view = K.view;
  const PW = () => { try { return parent !== window ? parent : null; } catch (e) { return null; } };
  const CM = () => { const w = PW(); return w && w.hyComments; };
  const AN = () => { const w = PW(); return w && w.hyAnnot; };
  const tr = window.hyEdTr ? window.hyEdTr({ onCard: 'the frame', openN: n => `Open annotations: ${n}, a click opens them` }) : { onCard: 'the frame', openN: n => `Open annotations: ${n}` };
  let H = null, P = null, prev = 'select', live = null, press = null, draft = null, raf = 0;

  // the host of the board (imgframe.js openEditor): which card, its place, the moments of Save and of the way out
  const open0 = ED.open;
  ED.open = h => {
    H = h;
    const saved0 = h.saved, closing0 = h.closing;
    h.saved = res => { settle(); return saved0(res); };
    h.closing = () => { stop(); return closing0(); };
    start(); setTimeout(() => { listMount(); listDraw(); }, 0);
    return open0(h);
  };

  // ---- the document and the board -------------------------------------------------------------------------------------------------------
  const dims = () => K.dims();
  const V = () => ED.V;
  const toScr = p => ({ x: V().x + p.x * V().s, y: V().y + p.y * V().s });
  // the document's px on the board: the card's corner and its board units per document px, as the camera bridge (imgframe.js camBridge)
  const kOf = () => H.item.w / (H.item.size && H.item.size[0] ? H.item.size[0] : H.item.w);
  const toBoard = p => ({ x: H.item.x + p.x * kOf(), y: H.item.y + p.y * kOf() });
  const mine = t => !!(H && t && t.anchor && t.anchor.obj === H.id);
  const threads = () => { const c = CM(), a = AN(); return c && c.threads ? c.threads().filter(mine).filter(t => !a || !a.visible || a.visible(t.by)) : []; };
  // a layer's own space: a pixel layer its own pixels (it moves, turns, scales and flips), a group its box, any other the document
  function frameOf(n) {
    const [W, Hh] = dims();
    if (n.type === 'pixel') { const m = K.LM(n); return { m, w: n.c.width, h: n.c.height }; }
    const b = n.type === 'group' ? groupBox(n) : null;
    if (b) return { m: new DOMMatrix().translate(b.x0, b.y0), w: Math.max(1, b.x1 - b.x0), h: Math.max(1, b.y1 - b.y0) };
    return { m: new DOMMatrix(), w: W, h: Hh };
  }
  function groupBox(g) {   // a group's box: its pixel layers' corners
    let b = null;
    K.walk(g.children || [], x => { if (x.type !== 'pixel') return; const m = K.LM(x);
      for (const [a, c] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const q = m.transformPoint(new DOMPoint(a * x.c.width, c * x.c.height));
        b = b ? { x0: Math.min(b.x0, q.x), y0: Math.min(b.y0, q.y), x1: Math.max(b.x1, q.x), y1: Math.max(b.y1, q.y) } : { x0: q.x, y0: q.y, x1: q.x, y1: q.y }; } });
    return b;
  }
  const docOf = (n, u, v) => { const f = frameOf(n), q = f.m.transformPoint(new DOMPoint(u * f.w, v * f.h)); return { x: q.x, y: q.y }; };
  const localOf = (n, p) => { const f = frameOf(n), q = f.m.inverse().transformPoint(new DOMPoint(p.x, p.y)); return [q.x / f.w, q.y / f.h].map(r5); };
  const r5 = v => Math.round(v * 1e5) / 1e5;
  const box4 = ps => { const xs = ps.map(p => p.x), ys = ps.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
  // a thread's place in the document: its layer's point (an area: its box), else its share of the document
  function placeOf(t) {
    const [W, Hh] = dims(), p = t.anchor.part, n = p && K.byId(p.id);
    if (n) {
      if (p.area) { const [u, v, w, h] = p.area, b = box4([[u, v], [u + w, v], [u + w, v + h], [u, v + h]].map(([a, c]) => docOf(n, a, c))); return { pin: { x: b.x + b.w, y: b.y }, box: b }; }
      const l = p.local || [0.5, 0.5]; return { pin: docOf(n, l[0], l[1]) };
    }
    if (t.area) { const [u, v, w, h] = t.area, b = { x: u * W, y: v * Hh, w: w * W, h: h * Hh }; return { pin: { x: b.x + b.w, y: b.y }, box: b }; }
    return { pin: { x: t.at[0] * W, y: t.at[1] * Hh } };
  }

  // ---- the pins on the picture ----------------------------------------------------------------------------------------------------------
  async function pinsLib() {
    if (!window.hyStudioPins) { try { await import('/ui/studiopins.js'); } catch (e) { console.error('studio pins', e); } }
    return window.hyStudioPins || null;
  }
  function start() {
    pinsLib().then(lib => {
      if (!lib || !H || P) return;
      P = lib.layer(document.body, { fixed: true, onPin: id => openThread(id) }); view.after(P.el);   // over the picture, under the panels
      cancelAnimationFrame(raf); const tick = () => { raf = requestAnimationFrame(tick); draw(); }; tick();
      rows();
    });
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; if (S.tool === 'comment') K.setTool(prev); if (P) { P.destroy(); P = null; } draft = null; live = null; }
  function draw() {
    if (!P || !H) return;
    const c = CM(), st = (c && c.state) || {}, out = [];
    const sb = b => { if (!b) return null; const a = toScr(b), e = toScr({ x: b.x + b.w, y: b.y + b.h }); return { x: a.x, y: a.y, w: e.x - a.x, h: e.y - a.y }; };
    const off = document.documentElement.classList.contains('hy-hideui') || (AN() && AN().state && AN().state.show === false) || !S.ready;
    if (!off) for (const t of threads()) {
      if (t.resolved && st.open !== t.id) continue;
      const q = placeOf(t), s = toScr(q.pin), nm = t.anchor.part ? t.anchor.part.name || t.anchor.part.id : tr.onCard;
      out.push({ id: t.id, ...s, n: t.messages.length, on: st.open === t.id, area: sb(q.box), title: `${nm}: ${(t.messages[0] || {}).text || ''}`.slice(0, 120) });
    }
    if (live) out.push({ id: 'live', area: sb(live) });
    if (draft && st.draft) { const q = draft.n && K.byId(draft.n.id) ? draft.at() : draft.pin; out.push({ id: 'draft', draft: true, ...toScr(q.pin), area: sb(q.box) }); }
    P.draw(out);
  }

  // ---- the tool ---------------------------------------------------------------------------------------------------------------------------
  const prevOnTool = K.onTool;
  K.onTool = id => { if (id !== 'comment') prev = id; document.documentElement.classList.toggle('annot', id === 'comment'); if (prevOnTool) prevOnTool(id); };
  K.annBack = () => prev || 'select';
  const css = document.createElement('style'); css.textContent = ':root.annot #view{cursor:crosshair!important} #pann{padding:6px 8px 8px}'; document.head.append(css);
  // the layer a click is about: the picked one when the click is on it, else the one under the pointer, else the picked one
  function layerAt(p) {
    const one = K.one(), on = n => { if (!n || n.type !== 'pixel') return !!n; const l = localOf(n, p); return l[0] >= 0 && l[1] >= 0 && l[0] <= 1 && l[1] <= 1; };
    if (one && !K.isPinned(one) && on(one)) return one;
    return K.hitTest(p) || (one && !K.isPinned(one) ? one : null);
  }
  const partOf = (n, p, area) => ({ kind: 'layer', id: n.id, name: n.name || n.id, local: localOf(n, p), ...(area ? { area } : {}) });
  // a press anywhere in the studio closes the board's open thread; with the tool on the picture it is all that press does
  addEventListener('pointerdown', e => {
    const c = CM(), st = (c && c.state) || {}, onPin = e.target.closest && e.target.closest('.hy-spin, [data-ann-n]');
    const wasOpen = !!(st.open || st.draft); if (wasOpen && !onPin && c) c.close();
    if (S.tool !== 'comment' || e.target !== view || e.button !== 0 || !H) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (wasOpen) return;
    press = { x: e.clientX, y: e.clientY, on: false, p0: K.toDoc(e.clientX, e.clientY) };
  }, true);
  addEventListener('pointermove', e => {
    if (!press) return; e.stopImmediatePropagation();
    if (!press.on && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return; press.on = true;
    const p = K.toDoc(e.clientX, e.clientY), a = press.p0;
    live = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) };
  }, true);
  addEventListener('pointerup', e => {
    if (!press) { if (S.tool === 'comment' && e.target === view) e.stopImmediatePropagation(); return; }
    e.stopImmediatePropagation(); const pr = press, b = live; press = null; live = null;
    if (pr.on && b && b.w * V().s > 6 && b.h * V().s > 6) newArea(b); else newPin(pr.p0);
  }, true);
  // a picture opened here is a frame only in memory until its Save: a thread on it is tied to the picture itself, no layer (P4 S-16)
  const kindOfPic = it => { const w = PW(); return w && w.hyNoteLink ? w.hyNoteLink.kind(it) : it.type || 'picture'; };
  function anchor(part) {
    const r = AN() && AN().boxOf ? AN().boxOf({ obj: H.id }) : null, it = H.item;
    if (H.pic) return { obj: H.id, kind: kindOfPic(H.pic), file: H.pic.path || '', ...(r ? { r: [r.x, r.y, r.w, r.h] } : {}) };
    return { obj: H.id, kind: it.type || 'imgframe', file: it.doc || '', ...(r ? { r: [r.x, r.y, r.w, r.h] } : {}), ...(part ? { part } : {}) };
  }
  function compose(pin, part, n, o = {}) {
    const c = CM(); if (!c || !c.newAt) return; if (H.pic) { part = null; n = null; }
    const [W, Hh] = dims();
    draft = { n, pin: { pin, box: o.box || null }, at: () => (part && part.area ? placeOf({ anchor: { part }, at: [0, 0] }) : { pin: docOf(n, part.local[0], part.local[1]) }) };
    if (!part) draft.n = null;
    c.newAt(toBoard(pin), { anchor: anchor(part), at: [r5(pin.x / W), r5(pin.y / Hh)], area: o.area || null, cancel: () => { draft = null; } });
    if (n) select(n);
  }
  function newPin(p) {
    const n = layerAt(p); compose(p, n ? partOf(n, p) : null, n);
  }
  function newArea(b) {
    const [W, Hh] = dims(), mid = { x: b.x + b.w / 2, y: b.y + b.h / 2 }, n = layerAt(mid);
    let part = null;
    if (n) { const c = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => localOf(n, { x, y })), us = c.map(q => q[0]), vs = c.map(q => q[1]);
      const u0 = Math.min(...us), v0 = Math.min(...vs); part = partOf(n, mid, [u0, v0, Math.max(...us) - u0, Math.max(...vs) - v0].map(r5)); }
    compose({ x: b.x + b.w, y: b.y }, part, n, { box: b, area: [b.x / W, b.y / Hh, b.w / W, b.h / Hh].map(r5) });
  }
  function select(n) { if (S.ids.length === 1 && S.ids[0] === n.id) return; S.ids = [n.id]; S.anchor = n.id; S.editMask = false; K.refresh(); }
  function openThread(id) {
    const c = CM(); if (!c) return; const st = c.state || {};
    if (st.open === id) { c.close(); return; }
    c.open(id);
  }
  // Esc and C with the tool in hand: the tool before it comes back (C on another tool takes this one: TOOLS in index.html)
  addEventListener('keydown', e => {
    if (S.tool !== 'comment' || (e.target.closest && e.target.closest('input, textarea, select')) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' || (e.code === 'KeyC' && !e.shiftKey)) { e.preventDefault(); e.stopImmediatePropagation(); K.setTool(prev || 'select'); }
  }, true);

  // ---- the rows' counts -------------------------------------------------------------------------------------------------------------------
  function byLayer() {
    const m = new Map();
    for (const t of threads()) { if (t.resolved || !t.anchor.part) continue; const k = t.anchor.part.id; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
    for (const l of m.values()) l.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
    return m;
  }
  function rows(el) {
    el = el || document.getElementById('rows'); const lib = window.hyStudioPins; if (!el || !lib) return;
    const m = H ? byLayer() : new Map();
    for (const r of el.querySelectorAll('.lr[data-id]')) {
      const l = m.get(r.dataset.id), n = l ? l.length : 0, had = r.querySelector(':scope > [data-ann-n]');
      if (had && had.getAttribute('count') === String(n)) continue;
      if (had) had.remove(); if (!n) continue;
      const nm = r.querySelector(':scope > .nm'); if (nm) nm.insertAdjacentHTML('afterend', lib.count(n, tr.openN(n)));
    }
  }
  K.onRows = rows;
  const listEl = document.getElementById('list');
  if (listEl) {
    listEl.addEventListener('pointerdown', e => { if (e.target.closest('[data-ann-n]')) { e.stopPropagation(); e.preventDefault(); } }, true);
    listEl.addEventListener('click', e => {
      const b = e.target.closest('[data-ann-n]'); if (!b) return; e.stopPropagation(); e.preventDefault();
      const l = byLayer().get(b.closest('.lr').dataset.id), c = CM(); if (!l || !c) return;
      const i = l.findIndex(x => x.id === (c.state || {}).open);
      if (i >= 0 && l.length === 1) c.close(); else c.open(l[(i + 1) % l.length].id);
    }, true);
  }

  // ---- for the board's side (../annhost.js) ---------------------------------------------------------------------------------------------
  // where a thread's pin stands on the board now, the threads changed, a thread opened (its layer is picked)
  function boardAt(t) {
    if (!mine(t) || !t.anchor.part || !S.ready) return undefined;
    return toBoard(placeOf(t).pin);
  }
  function changed() { if (draft && !((CM() && CM().state) || {}).draft) draft = null; rows(); listDraw(); }
  function opened(t) { if (!mine(t) || !t.anchor.part) return; const n = K.byId(t.anchor.part.id); if (n) select(n); }
  // Save: each thread on a layer takes the place of its pin on the card's picture as it is now (op place, no event)
  function settle() {
    const a = AN(); if (!a || !a.api || !S.ready) return;
    const [W, Hh] = dims(), jobs = [];
    for (const t of threads()) {
      if (!t.anchor.part || !K.byId(t.anchor.part.id)) continue;
      const q = placeOf(t), at = [r5(Math.max(0, Math.min(1, q.pin.x / W))), r5(Math.max(0, Math.min(1, q.pin.y / Hh)))];
      if (Math.abs(at[0] - t.at[0]) < 2e-3 && Math.abs(at[1] - t.at[1]) < 2e-3) continue;
      const area = q.box ? [q.box.x / W, q.box.y / Hh, q.box.w / W, q.box.h / Hh].map(r5) : undefined;
      jobs.push(a.api('/api/comments', { op: 'place', name: t.page, id: t.id, at, ...(area ? { area } : {}) }).catch(() => {}));
    }
    if (jobs.length) Promise.all(jobs).then(() => { const c = CM(); if (c) c.load(); });
  }
  // the free part of the board for the open thread: right of the library, left of the right column (dockwork.js freeRight)
  function free() {
    const fe = frameElement, sd = document.getElementById('side'); if (!fe) return null;
    const f = fe.getBoundingClientRect(), inset = parseFloat(document.documentElement.style.getPropertyValue('--inset')) || 0;
    return { l: f.left + inset + 8, r: f.left + (sd && sd.offsetWidth ? sd.offsetLeft : innerWidth) - 8, t: f.top + 8, b: f.bottom - 8 };
  }
  // ---- the Annotations tab (ui/annlist.js) ------------------------------------------------------------------------------------------------
  let AL = null, alSel = '';
  const page = () => (H && H.page ? H.page() : 'main');
  async function listLib() { if (!window.hyAnnList) { try { await import('/ui/annlist.js'); } catch (e) { console.error('annotations list', e); } } return window.hyAnnList || null; }
  // a new thread from the field: on the picked layer, its pin at the layer's middle (the picture itself while it is not a frame yet)
  async function sendNew(text) {
    const n = K.one(), a = AN(); if (!n || !H || !a || !a.api) return false;
    const [W, Hh] = dims(), part = H.pic || K.isPinned(n) ? null : partOf(n, docOf(n, 0.5, 0.5)), pin = part ? docOf(n, 0.5, 0.5) : { x: W / 2, y: Hh / 2 };
    try { await a.api('/api/comments', { op: 'new', name: page(), anchor: anchor(part), at: [r5(pin.x / W), r5(pin.y / Hh)], text }); const c = CM(); if (c) await c.load(); return true; }
    catch (ex) { if (a.fail) a.fail(ex); return false; }
  }
  function listMount() {
    const pgb = document.querySelector('#g1 .pgb'); if (!pgb || AL) return;
    let pane = document.getElementById('pann'); if (!pane) { pane = document.createElement('div'); pane.className = 'pane'; pane.dataset.p = 'ann'; pane.id = 'pann'; pgb.appendChild(pane); }
    pane.classList.toggle('on', ED.GS && ED.GS.g1.tab === 'ann');
    listLib().then(lib => {
      if (!lib || AL) return; const w = PW() || window;
      AL = lib.mount(pane, { threads: () => threads(), state: () => (CM() && CM().state) || {}, draftKey: H ? 'img:' + H.id : '',
        picked: () => { const n = K.one(); return n && !K.isPinned(n) ? { kind: 'layer', id: n.id, name: n.name || n.id } : null; },
        keyOf: p => p.id, nameOf: p => { const n = K.byId(p.id); return (n && n.name) || p.name || p.id; },
        iconOf: p => K.svg(!p ? 'frame' : (K.byId(p.id) || {}).type === 'group' ? 'folder' : 'layers', 13),
        open: id => { const t = threads().find(x => x.id === id); if (t) opened(t); openThread(id); }, send: sendNew,
        face: by => (w.hyAvatarOf ? w.hyAvatarOf(by, 20) : ''), who: t => (w.hyWhoText ? w.hyWhoText(t) : ''), ago: iso => (w.T && w.T.ago ? w.T.ago(iso) : iso || '') });
      listDraw();
    });
  }
  function listDraw() {
    const n = threads().filter(t => !t.resolved).length, c = document.getElementById('acount'); if (c && c.textContent !== String(n || '')) c.textContent = n || '';
    if (AL && document.getElementById('pann') && document.getElementById('pann').classList.contains('on')) AL.draw();
  }
  K.onAnnTab = () => { listMount(); listDraw(); };
  // the picked layer changes the field's words and «This layer»; the rows' counts are drawn again with the list (K.onRows)
  const rows0 = rows; K.onRows = el => { rows0(el); const k = S.ids.join(','); if (k !== alSel) { alSel = k; listDraw(); } };
  window.hyEdAnn = { boardAt, changed, opened, free, rows, get on() { return S.tool === 'comment'; } };
})();
