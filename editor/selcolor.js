/*
 * HySelColor: Photoshop's Selective Color as a section of Raw Editor (owner 2026-10-07: «Selective Color like Photoshop»). Its own file
 * because editor/colorgrade.js is over the size limit; colorgrade.js takes from here the params (grade.sc), the step of its one WebGL pass
 * and the panel's section, so the image studio's Adjustments and the board's Raw Editor (grade.js) both have it. Load it before colorgrade.js.
 *
 *   grade.sc = { abs: 0 Relative (Photoshop's default) | 1 Absolute, reds: { c, m, y, k }, yellows, greens, cyans, blues, magentas,
 *                whites, neutrals, blacks }   each ink −100…100 %, the board keeps only what differs from 0 (grade.js compact)
 *   HySelColor.defaults(), .used(sc), .weights(rgb), .apply(rgb, sc) -> [r, g, b]   (rgb 0..1; apply is the shader's maths in JS)
 *   .GLSL (uniforms and scStep for the fragment shader), .STEP (its line in main), .uniforms(gl, U, sc), .section(panel's helpers)
 *
 * The maths, as Photoshop's Selective Color is commonly reverse-engineered (GIMP and ImageMagick ports, Imageshop's write-up), per pixel:
 *   weight of a range: Reds, Greens, Blues  max − mid when that channel is the largest; Cyans, Magentas, Yellows  mid − min when red,
 *   green, blue is the smallest; Whites (min − ½)·2 above ½; Blacks (½ − max)·2 below ½; Neutrals 1 − |max − ½| − |min − ½|
 *   each channel with its ink (R cyan, G magenta, B yellow) and Black k, in −1…1:  t = (−1 − ink)·k − ink;  Relative t ·= (1 − channel),
 *   the share of ink the channel already has (so Relative cannot touch pure white), Absolute takes t over the full range;  t is kept
 *   within what the channel can move (−v…1 − v), and the ranges' t, each by its weight from the pixel as it came in, are summed
 */
(function (global) {
  'use strict';

  const RANGES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'];
  const INKS = ['c', 'm', 'y', 'k'];
  const NAME = { reds: 'Reds', yellows: 'Yellows', greens: 'Greens', cyans: 'Cyans', blues: 'Blues', magentas: 'Magentas', whites: 'Whites',
    neutrals: 'Neutrals', blacks: 'Blacks' };
  const INK_NAME = { c: 'Cyan', m: 'Magenta', y: 'Yellow', k: 'Black' };
  // the range swatches: Hue/Saturation's colours for the six hues, then white, middle grey and black
  const COL = { reds: 'hsl(0 85% 55%)', yellows: 'hsl(55 90% 52%)', greens: 'hsl(120 70% 45%)', cyans: 'hsl(185 80% 48%)', blues: 'hsl(230 85% 60%)',
    magentas: 'hsl(300 75% 56%)', whites: 'hsl(0 0% 100%)', neutrals: 'hsl(0 0% 50%)', blacks: 'hsl(0 0% 0%)' };
  // a slider's track from less of the ink to more: less cyan is more red, less magenta more green, less yellow more blue
  const TRACK = { c: 'linear-gradient(90deg,hsl(0 80% 55%),hsl(0 0% 55%),hsl(185 80% 48%))',
    m: 'linear-gradient(90deg,hsl(120 70% 45%),hsl(0 0% 55%),hsl(300 75% 56%))',
    y: 'linear-gradient(90deg,hsl(230 85% 60%),hsl(0 0% 55%),hsl(55 90% 52%))', k: 'linear-gradient(90deg,hsl(0 0% 100%),hsl(0 0% 0%))' };

  function defaults() {
    const o = { abs: 0 };
    RANGES.forEach(k => { o[k] = { c: 0, m: 0, y: 0, k: 0 }; });
    return o;
  }
  const amt = v => Math.max(-1, Math.min(1, (+v || 0) / 100));
  const used = sc => !!sc && RANGES.some(k => sc[k] && INKS.some(i => amt(sc[k][i])));

  // the nine weights of a pixel (r, g, b in 0..1), in RANGES' order
  function weights(c) {
    const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b), md = r + g + b - mx - mn;
    return [r === mx ? mx - md : 0, b === mn ? md - mn : 0, g === mx ? mx - md : 0, r === mn ? md - mn : 0, b === mx ? mx - md : 0,
      g === mn ? md - mn : 0, Math.max(0, mn - 0.5) * 2, 1 - Math.abs(mx - 0.5) - Math.abs(mn - 0.5), Math.max(0, 0.5 - mx) * 2];
  }
  // rgb in 0..1, sc the grade's sc (normalized); returns [r, g, b]
  function apply(rgb, sc) {
    const c = rgb.slice(0, 3).map(v => Math.min(1, Math.max(0, v)));
    if (!used(sc)) return c;
    const w = weights(c), d = [0, 0, 0];
    RANGES.forEach((k, n) => {
      const o = sc[k], k4 = amt(o.k); if (w[n] <= 0) return;
      for (let i = 0; i < 3; i++) {
        const ink = amt(o[INKS[i]]); let t = (-1 - ink) * k4 - ink;
        if (!sc.abs) t *= 1 - c[i];
        d[i] += Math.min(1 - c[i], Math.max(-c[i], t)) * w[n];
      }
    });
    return c.map((v, i) => Math.min(1, Math.max(0, v + d[i])));
  }

  // the same in the fragment shader; colorgrade.js puts GLSL among its functions and STEP after Hue/Saturation
  const GLSL = `
uniform int uUseSc;      // Selective Color (editor/selcolor.js, apply() there is the same maths in JS)
uniform vec4 uSc[9];     // per range, reds … blacks: cyan, magenta, yellow, black in -1..1
uniform float uScAbs;    // 1 Absolute, 0 Relative
vec3 scStep(vec3 c){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), md = c.r + c.g + c.b - mx - mn;
  float w[9] = float[9](c.r == mx ? mx - md : 0.0, c.b == mn ? md - mn : 0.0, c.g == mx ? mx - md : 0.0, c.r == mn ? md - mn : 0.0,
    c.b == mx ? mx - md : 0.0, c.g == mn ? md - mn : 0.0, max(0.0, mn - 0.5) * 2.0, 1.0 - abs(mx - 0.5) - abs(mn - 0.5), max(0.0, 0.5 - mx) * 2.0);
  vec3 d = vec3(0.0);
  for (int k = 0; k < 9; k++) {
    if (w[k] <= 0.0 || uSc[k] == vec4(0.0)) continue;
    vec3 t = (-1.0 - uSc[k].xyz) * uSc[k].w - uSc[k].xyz;
    if (uScAbs < 0.5) t *= 1.0 - c;
    d += clamp(t, -c, 1.0 - c) * w[k];
  }
  return clamp(c + d, 0.0, 1.0);
}`;
  const STEP = 'if (uUseSc == 1) c = scStep(clamp(c, 0.0, 1.0));   // Selective Color (editor/selcolor.js)';
  // U(name) -> the uniform's location in the main program
  function uniforms(gl, U, sc) {
    const on = used(sc);
    gl.uniform1i(U('uUseSc'), on ? 1 : 0);
    if (!on) return;
    gl.uniform4fv(U('uSc'), RANGES.flatMap(k => INKS.map(i => amt(sc[k][i]))));
    gl.uniform1f(U('uScAbs'), sc.abs ? 1 : 0);
  }

  /* -------------------------------------------------------------------- panel */
  // the swatches take Hue/Saturation's look (.hcg-hsr, .hcg-sw); here only a hairline round each, so white and black read on either paper
  const CSS = '.hcg-scr{justify-content:space-between}.hcg-scr .hcg-sw:not(.on){box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink) 24%,transparent)}';
  // x: the panel's helpers (colorgrade.js createPanel): section, segmented, el, on, L, emit, controls, parseEntry, state() -> the grade
  function section(x) {
    const { el, on, L, emit } = x, S = () => x.state().sc;
    if (!document.getElementById('hsc-style')) { const st = el('style'); st.id = 'hsc-style'; st.textContent = CSS; document.head.appendChild(st); }
    const pad = x.section('sc', 'Selective Color', ['sc'], false);
    let cur = 'reds';   // the range being edited: Photoshop's «Colors» list as swatches
    const row = el('div', 'hcg-hsr hcg-scr'), sws = {};
    RANGES.forEach(k => {
      const b = el('button', 'hcg-sw'); b.style.background = COL[k]; b.dataset.range = k;
      b.title = L(NAME[k]); b.setAttribute('aria-label', L(NAME[k]));
      on(b, 'click', () => { cur = k; sync(); });
      row.appendChild(b); sws[k] = b;
    });
    pad.appendChild(row);
    const name = el('div', 'hcg-hsn');
    pad.appendChild(name);
    // the app's one slider for each ink, signed from zero, the edited range's value
    const sls = INKS.map(i => {
      const r = el('div', 'hcg-row'), w = el('div', 'hy-slider grad'), inp = el('input'), lab = L(INK_NAME[i]), num = el('output', 'hy-slider-v');
      inp.type = 'range'; inp.min = -100; inp.max = 100; inp.step = 1; inp.setAttribute('aria-label', lab); inp.dataset.k = INK_NAME[i];
      num.title = L('Type a value: 10 sets it; +10 adds, -10 takes away, +10% adds a tenth, *2, /2; 1239+10 works too; an exact negative: 0-10');
      w.dataset.sc = i; w.dataset.center = '0'; w.dataset.reset = '0'; w.style.setProperty('--hy-sl-grad', TRACK[i]);
      w.append(inp, el('span', 'hy-slider-l', lab), num); r.appendChild(w); pad.appendChild(r);
      const sl = global.hySlider.mount(w);
      sl.format = v => (v > 0 ? '+' : '') + Math.round(v);
      sl.parse = (text, c) => { const v = x.parseEntry(text, c); return v == null ? NaN : v; };
      on(inp, 'input', () => {
        const v = Math.min(100, Math.max(-100, Math.round(+inp.value)));
        if (v === S()[cur][i]) return;
        S()[cur][i] = v; emit(); mark();
      });
      return { i, inp, sl, row: w };
    });
    // Photoshop's Method: Relative or Absolute, for all the ranges
    const seg = x.segmented(pad, [['rel', 'Relative'], ['abs', 'Absolute']], 'rel', m => { S().abs = m === 'abs' ? 1 : 0; emit(); });
    const mark = () => RANGES.forEach(k => sws[k].classList.toggle('mod', INKS.some(i => S()[k][i])));
    function sync() {
      RANGES.forEach(k => sws[k].classList.toggle('on', k === cur));
      name.textContent = L(NAME[cur]);
      sls.forEach(s => { s.inp.value = String(S()[cur][s.i]); s.sl.paint(); });
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.k === 'Absolute') === !!S().abs));
      mark();
    }
    x.controls.push({ update: sync });
    sls.forEach(s => x.controls.push({ update() {}, row: s.row }));   // their glide when a preset or a reset moves them (refreshAll)
    sync();
    return { select(k) { cur = RANGES.includes(k) ? k : 'reds'; sync(); }, get range() { return cur; } };
  }

  global.HySelColor = { RANGES, INKS, defaults, used, weights, apply, GLSL, STEP, uniforms, section };
})(typeof window !== 'undefined' ? window : globalThis);
