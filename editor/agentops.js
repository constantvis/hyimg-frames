// The agent's commands (owner 2026-10-10: «научить агента пользоваться всеми тулзами в Image Studio: вырезать, рисовать ... не нажимая
// кнопки»): window.hyImage.run([{op: 'select.polygon', points: [[x, y], …]}, {op: 'fill', color: '#ff0000'}, …]) does what the person does
// with the tools, through the studio's own functions on window.hyEdK and window.__ed (the marquee's commitSel, Edit › Fill, the brush's
// stroke, ⌫ in a selection, Add Layer Mask, Content-Aware Fill, Save), so a step looks and undoes exactly as the tool's, with the tool's
// name in History. Coordinates are the document's own pixels (a frame of one picture: that picture's pixels).
//   hyImage.run(ops)  runs them in order and stops at the first that fails: {ok, results, steps (the History names it added), error?, at?}
//   hyImage.info()    the document: size, layers top first, the selected layer, the selection's box, the colours, History
//   hyImage.png(s)    the picture as the studio shows it, a PNG data URL at scale s (export)
//   hyImage.OPS       the commands and what they take
// The headless runner is hyimg/review/imageops.py (hy.py image run), it opens this page under editor/agenthost.html.
(() => {
  const K = window.hyEdK; if (!K || !K.S) return;
  const S = K.S, T = K.T, E = () => window.__ed;
  const BLENDS = ['source-over', 'darken', 'multiply', 'lighten', 'screen', 'overlay', 'soft-light', 'hard-light', 'difference', 'hue', 'saturation', 'color', 'luminosity', 'pass'];
  const BLEND_ALIAS = { normal: 'source-over', 'pass-through': 'pass', softlight: 'soft-light', hardlight: 'hard-light' };
  const fail = m => { throw new Error(m); };
  const num = (v, name) => { const x = Number(v); if (!isFinite(x)) fail(`${name}: a number, got ${JSON.stringify(v)}`); return x; };
  const color = v => { const s = String(v || '').trim().toLowerCase(); const m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/); if (!m) fail(`a colour #rrggbb, got ${JSON.stringify(v)}`);
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]; return '#' + h; };
  const pt = p => Array.isArray(p) ? { x: num(p[0], 'x'), y: num(p[1], 'y'), pr: p[2] == null ? 1 : num(p[2], 'pressure') } : { x: num(p.x, 'x'), y: num(p.y, 'y'), pr: p.pr ?? 1 };
  const pts = v => { if (!Array.isArray(v) || !v.length) fail('points: [[x, y], …]'); return v.map(pt); };
  const box = o => ({ x0: num(o.x, 'x'), y0: num(o.y, 'y'), x1: num(o.x, 'x') + num(o.w, 'w'), y1: num(o.y, 'y') + num(o.h, 'h') });
  const opt = (v, name) => (v != null ? num(v, name) : undefined);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function until(fn, ms, what) { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) fail(`${what}: no answer in ${Math.round(ms / 1000)} s`); await wait(40); } }

  // the layers, top first as the panel shows them
  function layers() {
    const out = [];
    (function rec(list, depth) {
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        out.push({ id: n.id, name: n.name, kind: n.main ? 'master-grade' : n.mmask ? 'master-mask' : n.type === 'adjust' ? 'grade' : n.type, depth, visible: n.visible,
          opacity: n.opacity, blend: n.blend, clip: !!n.clip, mask: !!n.mask, base: !!n.base, original: !!n.orig, src: n.src ? n.src.path : undefined,
          box: n.type === 'pixel' ? { x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.w), h: Math.round(n.h), rotate: n.angle || 0 } : undefined });
        if (n.children) rec(n.children, depth + 1);
      }
    })(E().root, 0);
    return out;
  }
  // a layer by its id, its name (whole, else the one name that has it), «top» (the topmost picture or painted layer), «base», «master-mask»
  function find(ref) {
    if (ref == null || ref === '') { const n = K.one(); if (!n) fail('no layer selected: give layer'); return n; }
    const all = []; K.walk(E().root, n => { all.push(n); });
    if (ref === 'top') { const p = all.filter(n => n.type === 'pixel'); if (!p.length) fail('no picture layer'); return p[p.length - 1]; }
    if (ref === 'base') { const b = all.find(n => n.base); if (!b) fail('no base layer'); return b; }
    if (ref === 'master-mask') return K.mmNode();
    const s = String(ref).toLowerCase();
    const hit = all.find(n => n.id === ref) || all.filter(n => String(n.name).toLowerCase() === s)[0];
    if (hit) return hit;
    const part = all.filter(n => String(n.name).toLowerCase().includes(s));
    if (part.length === 1) return part[0];
    fail(part.length ? `layer «${ref}» is ambiguous: ${part.map(n => n.name).join(', ')}` : `no layer «${ref}»: ${layers().map(l => l.name).join(', ')}`);
  }
  function choose(n, mask = false) { if (mask && !n.mask) fail(`«${n.name}» has no mask: mask.add first`); S.ids = [n.id]; S.anchor = n.id; S.editMask = !!mask; K.refresh(); return n; }
  const target = (o, mask) => (o.layer != null ? choose(find(o.layer), mask) : (mask != null && K.one() ? choose(K.one(), mask) : K.one()));
  // the options a tool takes from its bar, for this command only (the person's own settings come back after it)
  function withOpts(obj, vals, fn) {
    const was = { ...obj }; Object.keys(vals).forEach(k => { if (vals[k] !== undefined) obj[k] = vals[k]; });
    try { return fn(); } finally { Object.assign(obj, was); }
  }
  const modeOf = m => { const v = m || 'new'; if (!['new', 'add', 'sub', 'int'].includes(v)) fail('mode: new, add, sub or int'); return v; };
  const selShape = (sh, o) => withOpts(S.selo, { feather: o.feather != null ? num(o.feather, 'feather') : 0, smooth: !!o.smooth }, () => K.commitSelShape(sh, modeOf(o.mode)));
  K.commitSelShape = (sh, mode) => E().commitSel(K.shapePath(sh), mode);
  const setColor = (which, v) => K.dock && K.dock.setColor ? K.dock.setColor(which, color(v)) : (S[which] = color(v));
  const selBox = () => { if (!S.hasSel) return null; const b = K.selBounds(); return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }; };

  // every command: what it takes and what it does; `step: true` when it must add a step to History (else it said why not)
  const OPS = {
    'select.rect': { args: 'x, y, w, h, mode?: new|add|sub|int, feather?', step: false, run: o => selShape({ type: 'rect', ...box(o) }, o) },
    'select.ellipse': { args: 'x, y, w, h, mode?, feather?', step: false, run: o => selShape({ type: 'ellipse', ...box(o) }, o) },
    'select.polygon': { args: 'points [[x, y], …], mode?, feather?, smooth? (the Lasso\'s curve through the points; straight edges without it)', step: false,
      run: o => { const p = pts(o.points); if (p.length < 3) fail('select.polygon: 3 points or more'); selShape({ type: 'lasso', pts: p }, o); } },
    'select.wand': { args: 'x, y, tolerance? 32, contiguous? true, sampleAll? true, mode?', step: false,
      run: o => withOpts(S.wand, { tol: opt(o.tolerance, 'tolerance'), contig: o.contiguous, all: o.sampleAll }, () => K.wandAt(pt([o.x, o.y]), modeOf(o.mode))) },
    'select.subject': { args: '(macOS Vision, else the studio\'s simpler guess)', step: false, run: () => E().selectSubject() },
    'select.fromImage': { args: 'file (a mask picture of the library: white selects, black not, grey and transparency partly; stretched to the document), mode?',
      step: false, run: o => fromImage(o) },
    'select.all': { args: '', step: false, run: () => K.selectAll() },
    'select.none': { args: '', step: false, run: () => K.deselect() },
    'select.invert': { args: '', step: false, run: () => K.invertSel() },
    'select.reselect': { args: '', step: false, run: () => K.reselect && K.reselect() },
    'select.expand': { args: 'px', step: false, run: o => K.growSel(Math.abs(num(o.px, 'px'))) },
    'select.contract': { args: 'px', step: false, run: o => K.growSel(-Math.abs(num(o.px, 'px'))) },
    'select.feather': { args: 'px', step: false, run: o => K.featherSel(num(o.px, 'px')) },
    color: { args: 'fg?, bg? (#rrggbb)', step: false, run: o => { if (o.fg) setColor('fg', o.fg); if (o.bg) setColor('bg', o.bg); } },
    fill: { args: 'color? #rrggbb | use?: fg|bg|black|white|gray, layer?, mask? (Edit › Fill: in the selection, or the whole layer or mask)', step: true,
      run: o => { target(o, o.mask); if (o.color) setColor('fg', o.color); const k = o.color ? 'fg' : (o.use || 'fg');
        if (!['fg', 'bg', 'black', 'white', 'gray'].includes(k)) fail('use: fg, bg, black, white or gray'); K.fill(k); } },
    brush: { args: 'points [[x, y(, pressure)], …], size? px, hardness?, opacity?, flow?, color?, layer?, mask? (on an original it paints on a new layer above, as the tool)', step: true,
      run: o => { const p = pts(o.points); target(o, o.mask); if (o.color) setColor('fg', o.color);
        withOpts(S.brush, { size: opt(o.size, 'size'), hard: opt(o.hardness, 'hardness'), opac: opt(o.opacity, 'opacity'), flow: opt(o.flow, 'flow') }, () => {
          E().startStroke(p[0]); if (!S.stroke) return; p.slice(1).forEach(q => E().strokeTo(q)); E().endStroke(); }); } },
    erase: { args: 'layer?, mask?, reveal? (⌫ in the selection: clears the pixels, on a mask hides; reveal: ⇧⌫ shows)', step: true,
      run: o => { if (!S.hasSel) fail('erase: select an area first (⌫ without a selection deletes the layer: use layer.delete)'); target(o, o.mask); K.clearInSel(!!o.reveal); } },
    inpaint: { args: '(Content-Aware Fill of the selection, a new layer: LaMa on the server, else the studio\'s own fill)', step: true,
      run: async () => { if (!S.hasSel) fail('inpaint: select an area first'); K.fillSelection(); await until(() => !S.pend, 180000, 'inpaint'); return { how: (window.__lastFill || {}).how }; } },
    'layer.new': { args: 'name?', step: true, run: o => { K.newLayer(); if (o.name) K.edit(T.h.rename, () => { K.one().name = String(o.name); }); } },
    'layer.add': { args: 'file (a library path), x?, y? (top left), w?, h?, scale? (of its own pixels), rotate? °, name?', step: true,
      run: async o => { const ws = K.dims(); const before = S.undo.length; await E().addLibPics([String(o.file)], { x: ws[0] / 2, y: ws[1] / 2 });
        if (S.undo.length === before) fail(`layer.add: could not place ${o.file}`); const n = K.one();
        if (o.name) K.edit(T.h.rename, () => { n.name = String(o.name); });
        if (['x', 'y', 'w', 'h', 'scale', 'rotate'].some(k => o[k] != null)) transform(n, { ...o, scale: o.scale != null ? num(o.scale, 'scale') * n.c.width / n.w : undefined }); } },
    'layer.select': { args: 'layer (id, name, top, base, master-mask), mask?', step: false, run: o => { choose(find(o.layer), o.mask); } },
    'layer.transform': { args: 'layer?, x?, y?, w?, h?, scale?, rotate? °, dx?, dy?, flipH?, flipV?', step: true, run: o => { transform(target(o), o); } },
    'layer.opacity': { args: 'value 0–100, layer?', step: true,
      run: o => { const n = target(o), v = Math.max(0, Math.min(100, num(o.value, 'value'))); guard(n); K.edit(T.h.opacity, () => { n.opacity = v; }); } },
    'layer.blend': { args: 'mode (normal, multiply, screen, overlay, …), layer?', step: true,
      run: o => { const n = target(o), m = BLEND_ALIAS[o.mode] || o.mode; if (!BLENDS.includes(m)) fail(`mode: ${BLENDS.join(', ')}`); guard(n); K.edit(T.h.blend, () => { n.blend = m; }); } },
    'layer.rename': { args: 'name, layer?', step: true,
      run: o => { const n = target(o); if (K.isPinned(n) || n.base) fail('this layer keeps its name'); K.edit(T.h.rename, () => { n.name = String(o.name); }); } },
    'layer.visible': { args: 'on true|false, layer?', step: true, run: o => { const n = target(o), on = o.on !== false; K.edit(on ? T.h.show : T.h.hide, () => { n.visible = on; }); } },
    'layer.order': { args: 'to: top|bottom|up|down, or above / below: layer; layer?', step: true, run: o => order(target(o), o) },
    'layer.duplicate': { args: 'layer?', step: true, run: o => { target(o); K.duplicate(); } },
    'layer.delete': { args: 'layer?', step: true, run: o => { target(o); K.deleteSel(); } },
    'layer.mergeDown': { args: 'layer?', step: true, run: o => { target(o); K.mergeDown(); } },
    'layer.viaCopy': { args: 'layer? (⌘J: the selection on a new layer)', step: true, run: o => { target(o); K.copyToLayer(); } },
    'layer.viaCut': { args: 'layer? (⇧⌘J)', step: true, run: o => { target(o); K.layerViaCut(); } },
    'layer.group': { args: 'layers? [refs] (⌘G)', step: true, run: o => { const ns = (o.layers || [o.layer]).map(find); S.ids = ns.map(n => n.id); K.refresh(); K.groupSel(); } },
    'layer.clip': { args: 'layer? (clips it to the layer below, again releases)', step: true, run: o => { K.toggleClip(target(o)); } },
    'mask.add': { args: 'layer?, fromSelection? (default: when there is one; Reveal Selection, else Reveal All)', step: true,
      run: o => { const n = target(o); if (n.mask) fail('the layer has a mask: mask.edit, mask.invert, fill or brush with mask: true'); K.addMask(o.fromSelection !== false); } },
    'mask.invert': { args: 'layer?', step: true, run: o => { const n = target(o); if (!n.mask) fail('the layer has no mask'); K.invertMask(n); } },
    'mask.delete': { args: 'layer?', step: true, run: o => { const n = target(o); if (!n.mask) fail('the layer has no mask'); K.deleteMask(); } },
    'mask.edit': { args: 'on true|false, layer? (the brush, fill and erase go to the mask)', step: false,
      run: o => { const n = target(o); if (!n.mask) fail('the layer has no mask'); choose(n, o.on !== false); } },
    'mask.master.fromSelection': { args: '(the whole frame\'s mask: what is selected shows)', step: true, run: () => { if (!S.hasSel) fail('select an area first'); E().mmFromSel(); } },
    'mask.master.invert': { args: '', step: true, run: () => K.invertMask(K.mmNode()) },
    'mask.master.clear': { args: '', step: true, run: () => E().mmClear() },
    'removeBackground': { args: 'layer? (a mask that hides the background, macOS Vision)', step: true, run: async o => { target(o); await E().removeBackground(); } },
    undo: { args: '', step: false, run: () => K.undo() },
    redo: { args: '', step: false, run: () => K.redo() },
    save: { args: '(a new version of the frame; the pictures and the older versions stay)', step: false, run: () => save() },
    info: { args: '', step: false, run: () => info() },
  };
  function guard(n) { if (K.isPinned(n)) fail('a master layer: use mask.master.* or the Raw Editor'); }
  // a selection from a mask picture (owner 2026-10-10: «методы: выделение, маска, инверсия маски»): what an agent's segmentation or a 3D
  // silhouette made, loaded as the selection, combined by mode as a marquee is (index.html commitSelDraw: new clears, add, sub, int)
  async function fromImage(o) {
    const file = String(o.file || ''); if (!file) fail('select.fromImage: file, a picture of the library');
    const mode = modeOf(o.mode), im = await K.loadImg(K.fileURL(file)); if (!im) fail(`select.fromImage: cannot read ${file}`);
    K.ensureSel(); const s = K.sel(), w = s.c.width, h = s.c.height, t = K.mk(w, h), tx = t.getContext('2d', { willReadFrequently: true });
    tx.drawImage(im, 0, 0, w, h); const d = tx.getImageData(0, 0, w, h), p = d.data;
    let any = false;
    for (let i = 0; i < p.length; i += 4) {   // the grey, as far as it shows, becomes how much is selected
      const v = Math.round((.2126 * p[i] + .7152 * p[i + 1] + .0722 * p[i + 2]) * p[i + 3] / 255); p[i] = p[i + 1] = p[i + 2] = 255; p[i + 3] = v; if (v > 6) any = true;
    }
    tx.putImageData(d, 0, 0);
    const m = !S.hasSel && mode !== 'add' ? 'new' : mode, x = s.c.getContext('2d'); x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    if (m === 'new' || !S.hasSel) x.clearRect(0, 0, w, h);
    x.globalCompositeOperation = m === 'sub' ? 'destination-out' : m === 'int' ? 'destination-in' : 'source-over'; x.drawImage(t, 0, 0); x.restore();
    const r = x.getImageData(0, 0, w, h).data; let has = false; for (let i = 3; i < r.length; i += 4) if (r[i] > 6) { has = true; break; }
    S.hasSel = has; S.selV++; S.odirty = true; S.dirty = true;
    const [dw, dh] = K.dims();
    return { size: [im.naturalWidth, im.naturalHeight], stretched: im.naturalWidth !== dw || im.naturalHeight !== dh || undefined, empty: !any || undefined };
  }
  function transform(n, o) {
    guard(n); if (n.type !== 'pixel') fail('transform: a picture or painted layer');
    if (n.base) fail('the base layer is not moved or transformed (it can only be hidden)');
    if (K.lk(n).pos || K.lk(n).all) fail('the layer position is locked');
    K.edit(T.h.xf, () => {
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2, r = n.h / n.w;
      if (o.scale != null) { const s = num(o.scale, 'scale'); n.w *= s; n.h *= s; }
      if (o.w != null && o.h == null) { n.w = num(o.w, 'w'); n.h = n.w * r; } else if (o.h != null && o.w == null) { n.h = num(o.h, 'h'); n.w = n.h / r; }
      else if (o.w != null) { n.w = num(o.w, 'w'); n.h = num(o.h, 'h'); }
      n.x = o.x != null ? num(o.x, 'x') : cx - n.w / 2; n.y = o.y != null ? num(o.y, 'y') : cy - n.h / 2;
      if (o.dx != null) n.x += num(o.dx, 'dx'); if (o.dy != null) n.y += num(o.dy, 'dy');
      if (o.rotate != null) n.angle = num(o.rotate, 'rotate'); if (o.flipH) n.fx = !n.fx; if (o.flipV) n.fy = !n.fy;
    });
  }
  // the panel's drag of a row, as a command: within the layer's own list, never under the base layer nor over the master rows
  function order(n, o) {
    guard(n); if (n.base) fail('the base layer stays at the bottom');
    const l = K.locate(n.id), list = l.list, pinned = list.filter(K.isPinned).length, floor = list.findIndex(x => x.base) + 1;
    let at = l.i;
    if (o.above || o.below) { const r = find(o.above || o.below), rl = K.locate(r.id); if (rl.list !== list) fail('above/below: a layer of the same group');
      if (K.isPinned(r) && o.above) fail('nothing goes over the master rows'); if (r.base && o.below) fail('nothing goes under the base layer'); at = rl.i + (o.above ? 1 : 0) - (rl.i > l.i ? 1 : 0); }
    else if (o.to === 'top') at = list.length - pinned - 1; else if (o.to === 'bottom') at = floor; else if (o.to === 'up') at = l.i + 1; else if (o.to === 'down') at = l.i - 1;
    else fail('layer.order: to: top|bottom|up|down, or above/below');
    at = Math.max(floor, Math.min(list.length - pinned - 1, at)); if (at === l.i) return { unchanged: true };
    K.edit(T.h.order, () => { list.splice(l.i, 1); list.splice(at, 0, n); });
  }
  async function save() {
    const H = K.host(); if (H) H.last = null;
    const v0 = E().VERSION; await K.saveFrame();
    if (E().VERSION === v0) fail('not saved');
    const H2 = K.host(), d = (E().DOC || (H2 && H2.item && H2.item.doc) || '').replace(/\/[^/]*$/, ''), v = E().VERSION;
    return { v, doc: `${d}/frame.${v}.json`, render: `${d}/render.${v}.png`, res: (H && H.last) || null };
  }
  function info() {
    const [w, h] = K.dims(), n = K.one(), hist = S.undo.map(e => e.label);
    return { size: [w, h], layer: n ? { id: n.id, name: n.name, mask: S.editMask } : null, selection: selBox(), fg: S.fg, bg: S.bg, layers: layers(),
      history: hist, version: E().VERSION, dirty: K.isDirty() };
  }
  const png = (s = 1) => { const c = E().renderDoc(Math.max(.05, Math.min(1, s))); return { png: c.toDataURL('image/png'), w: c.width, h: c.height }; };

  async function run(ops) {
    if (!S.ready) fail('the studio is still loading');
    const list = Array.isArray(ops) ? ops : [ops], results = [], first = S.undo.length, start = S.undo[S.undo.length - 1];
    for (let i = 0; i < list.length; i++) {
      const o = list[i] || {}, def = OPS[o.op];
      if (!def) return { ok: false, at: i, error: `unknown op ${JSON.stringify(o.op)}: ${Object.keys(OPS).join(', ')}`, results, steps: steps(first, start) };
      const notes = [], prev = K.note; K.note = (t, ic) => { notes.push(String(t).replace(/<[^>]+>/g, '')); return prev ? prev(t, ic) : false; };
      const top0 = S.undo[S.undo.length - 1], selV0 = S.selV;
      try {
        if (S.stroke) E().endStroke();
        const r = await def.run(o) || {};
        if (def.step && S.undo[S.undo.length - 1] === top0 && !r.unchanged) fail(notes.length ? notes.join('; ') : `${o.op} changed nothing`);
        const top = S.undo[S.undo.length - 1];
        results.push({ op: o.op, ...r, step: top !== top0 && top ? top.label : undefined, selection: S.selV !== selV0 || o.op.startsWith('select') ? selBox() : undefined,
          layer: K.one() ? K.one().id : null, onMask: S.editMask || undefined, notes: notes.length ? notes : undefined });
      } catch (e) { return { ok: false, at: i, op: o.op, error: e.message || String(e), results, steps: steps(first, start) }; }
      finally { K.note = prev; }
    }
    return { ok: true, results, steps: steps(first, start) };
  }
  // the History names this run added (the stack keeps 40: count from the step that was on top before)
  function steps(first, start) { const u = S.undo, i = start ? u.indexOf(start) + 1 : 0; return u.slice(i < 0 ? first : i).map(e => e.label); }
  window.hyImage = { run, info, png, layers, OPS: Object.fromEntries(Object.entries(OPS).map(([k, v]) => [k, v.args])) };
})();
