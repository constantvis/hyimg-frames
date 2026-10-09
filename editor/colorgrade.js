/*
 * HyColorGrade: a Camera Raw-like "Color Grading" adjustment for the Hyimg frame editor (copied from Concepts/html/_lib, 2026-10-05).
 * One WebGL2 fragment pass does the grade; tone curve and HSL come from small float lookup
 * textures built on the CPU; Texture/Clarity/Dehaze read a blurred pyramid of the source that
 * is built once per source (and reused while sliders move). No dependencies, no build step.
 *
 *   const cg = HyColorGrade.createRenderer();
 *   cg.render(sourceCanvasOrImage, params, outCanvas?, {scale, reuseSource, frame}?)  -> canvas
 *   frame: [x, y, w, h] of the document inside the source, in its pixels: the vignette belongs to the document, so the editor's view
 *   (the document somewhere in the window) and the frame's render (the document alone) darken the same corners (2026-10-05)
 *   HyColorGrade.defaults(), .normalize(p), .isNeutral(p), .presets, .histogram(src)
 *   const panel = HyColorGrade.createPanel(el, params, onChange, {theme, onBeforeAfter})   (the panel's sliders are the app's: <script src="/ui/slider.js"> first)
 *     -> {set(p), get(), setHistogram(h), setBefore(b), before, el, destroy()}
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ params */

  const HUES = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
  const HUE_LABEL = { red: 'Reds', orange: 'Oranges', yellow: 'Yellows', green: 'Greens', aqua: 'Aquas', blue: 'Blues', purple: 'Purples', magenta: 'Magentas' };
  const HUE_DEG = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 270, magenta: 300 };
  const ID_CURVE = () => [[0, 0], [255, 255]];
  const SC = global.HySelColor || (() => { throw new Error('HyColorGrade needs editor/selcolor.js loaded first (Selective Color, grade.sc)'); })();

  function defaults() {
    const hsl = {};
    HUES.forEach(k => { hsl[k] = { hue: 0, sat: 0, lum: 0 }; });
    const zone = () => ({ hue: 0, sat: 0, lum: 0 });
    return {
      version: 1,
      temp: 0, tint: 0,
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
      texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
      curve: {
        rgb: ID_CURVE(), red: ID_CURVE(), green: ID_CURVE(), blue: ID_CURVE(),
        highlights: 0, lights: 0, darks: 0, shadows: 0, splits: [25, 50, 75]
      },
      hsl,
      grading: { shadows: zone(), midtones: zone(), highlights: zone(), global: zone(), blending: 50, balance: 0 },
      sharpening: 0, sharpenRadius: 1, noiseReduction: 0,
      vignette: { amount: 0, midpoint: 50, roundness: 0, feather: 50 },
      grain: { amount: 0, size: 25, roughness: 50 },
      hs: hsDefaults(), sc: SC.defaults(),
      // switched off, values kept (owner 2026-10-06): the whole grade (the header's eye) and each section (its own eye); a grade saved
      // before has neither, so it is on
      bypass: 0,
      off: { basic: 0, curve: 0, detail: 0, mixer: 0, hs: 0, sc: 0, grading: 0, effects: 0 }
    };
  }
  // what each section of the panel changes: its reset and its eye act on these
  const SECTION_PATHS = {
    basic: ['temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation'],
    curve: ['curve'], detail: ['sharpening', 'sharpenRadius', 'noiseReduction'], mixer: ['hsl'], hs: ['hs'], sc: ['sc'], grading: ['grading'], effects: ['vignette', 'grain']
  };

  // Photoshop's Hue/Saturation (owner 2026-10-06, with a screenshot of Properties › Hue/Saturation): Master and six colour ranges, each
  // with Hue −180…180, Saturation −100…100, Lightness −100…100; a range's r is [a, b, c, d] in degrees (red at 0): full effect from b to
  // c, fading out to a and to d (Photoshop's defaults: 30° inside, 30° of falloff each side; a may be negative, d may pass 360). Colorize
  // (colorize: 1) replaces the colours by one hue: ch 0…360, cs 0…100 (Photoshop starts it at 25), cl −100…100.
  const HS_RANGES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
  const HS_CENTER = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };
  function hsDefaults() {
    const o = { colorize: 0, ch: 0, cs: 25, cl: 0, master: { hue: 0, sat: 0, light: 0 } };
    HS_RANGES.forEach(k => { const c = HS_CENTER[k]; o[k] = { hue: 0, sat: 0, light: 0, r: [c - 45, c - 15, c + 15, c + 45] }; });
    return o;
  }

  const clone = o => JSON.parse(JSON.stringify(o));

  // Deep-merge `src` onto a fresh defaults() tree. Unknown keys are dropped, arrays are copied.
  function mergeInto(base, src) {
    if (!src || typeof src !== 'object') return base;
    for (const k of Object.keys(base)) {
      if (!(k in src) || src[k] == null) continue;
      const b = base[k], s = src[k];
      if (Array.isArray(b)) {
        if (Array.isArray(s)) base[k] = clone(s);
      } else if (b && typeof b === 'object') {
        mergeInto(b, s);
      } else if (typeof b === 'number') {
        const n = +s;
        if (isFinite(n)) base[k] = n;
      }
    }
    return base;
  }
  const normalize = p => mergeInto(defaults(), p);
  const DEFAULT_JSON = JSON.stringify(defaults());
  const isNeutral = p => JSON.stringify(normalize(p)) === DEFAULT_JSON;
  // the grade as the picture gets it: everything at its default while the whole grade is off, a switched-off section at its defaults;
  // the values themselves stay in the grade. The renderer draws this, so every caller (the board's cards, a frame's render, the image
  // studio's layers) leaves out what is off; isNeutral(effective(p)) tells a grade that changes nothing
  function effective(p) {
    const n = normalize(p), d = defaults();
    if (n.bypass) return d;
    for (const k in SECTION_PATHS) if (n.off[k]) SECTION_PATHS[k].forEach(path => setPath(n, path, clone(getPath(d, path))));
    n.off = d.off;   // what is drawn: the switches themselves are not
    return n;
  }

  function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, path, v) {
    const ks = path.split('.'); let a = o;
    for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]];
    a[ks[ks.length - 1]] = v;
  }

  const presets = {
    'Neutral': {},
    'Warm Product': {
      temp: 16, tint: 4, exposure: 0.1, contrast: 10, highlights: -22, shadows: 14, whites: 6, blacks: -4,
      clarity: 8, vibrance: 14,
      curve: { rgb: [[0, 0], [64, 60], [192, 198], [255, 255]] },
      grading: { highlights: { hue: 45, sat: 14, lum: 0 }, shadows: { hue: 28, sat: 8, lum: 0 }, blending: 60 }
    },
    'Cool Studio': {
      temp: -14, tint: -3, contrast: 12, highlights: -14, shadows: 6, whites: 10, blacks: -8,
      clarity: 10, saturation: -8,
      grading: { shadows: { hue: 215, sat: 14, lum: 0 }, highlights: { hue: 200, sat: 6, lum: 0 }, balance: -10 }
    },
    'High Contrast B&W': {
      contrast: 45, highlights: -10, shadows: 8, whites: 22, blacks: -26, clarity: 22, texture: 10, saturation: -100,
      curve: { rgb: [[0, 0], [60, 46], [190, 204], [255, 255]] },
      grain: { amount: 14, size: 22, roughness: 55 }
    },
    'Soft Matte': {
      contrast: -16, highlights: -26, shadows: 22, saturation: -12, dehaze: -6,
      curve: { rgb: [[0, 28], [64, 74], [190, 190], [255, 238]] },
      grading: { shadows: { hue: 220, sat: 10, lum: 0 }, highlights: { hue: 40, sat: 6, lum: 0 } },
      grain: { amount: 10, size: 30, roughness: 40 }
    },
    'Punchy': {
      exposure: 0.05, contrast: 26, highlights: -18, shadows: 12, whites: 8, blacks: -12,
      texture: 12, clarity: 16, dehaze: 8, vibrance: 32, saturation: 6,
      vignette: { amount: -16, midpoint: 45, roundness: 0, feather: 60 }
    }
  };

  // which preset a grade holds: its values without the switches (a section off or the whole grade off is still that preset), else null.
  // The panel's Presets menu puts its mark by it, the image studio's Adjustments list chooses its tile by it (owner 2026-10-07)
  const presetVals = p => JSON.stringify(Object.assign({}, normalize(p), { bypass: 0, off: defaults().off }));
  function presetOf(p) { const v = presetVals(p); return Object.keys(presets).find(n => presetVals(presets[n]) === v) || null; }
  // A preset shown while it is pointed at (owner 2026-10-06: «when I hover the presets they apply at once»), one for the panel's menu and
  // the image studio's list: show(name) puts the preset in (the grade from before is kept aside once), show(null) puts that grade back,
  // end(keep) finishes: keep leaves the picture as it is for the click's own change, which follows at once
  //   presetHover({ current() -> grade, apply(grade), preview(grade | null, keep) })
  function presetHover(o) {
    let base = null, at = null;
    return {
      show(name) {
        if (name === at || (!name && !base)) return;
        if (!base) base = o.current();
        at = name; o.apply(name ? normalize(presets[name]) : base);
        if (o.preview) o.preview(name ? o.current() : null);
      },
      end(keep) {
        if (!base) return; const b = base; base = null; at = null;
        if (!keep) o.apply(b);
        if (o.preview) o.preview(null, !!keep);
      },
      get on() { return !!base; }
    };
  }
  // A preset's swatch (owner 2026-10-07: «Warm Product» showed a teal swatch, «Cool Studio» an orange one): the preset itself applied by
  // the same pass to one neutral sample, a grey ramp over a muted ramp of hues, so warm reads warm, black and white reads grey
  function sample(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    for (let i = 0; i < w; i++) {
      const t = i / Math.max(1, w - 1), l = Math.round(14 + t * 82);
      x.fillStyle = `hsl(0 0% ${l}%)`; x.fillRect(i, 0, 1, Math.ceil(h / 2));
      x.fillStyle = `hsl(${Math.round(20 + t * 200)} 38% ${Math.round(30 + t * 40)}%)`; x.fillRect(i, Math.ceil(h / 2), 1, h - Math.ceil(h / 2));
    }
    return c;
  }
  let swR = null;
  const swatches = new Map();
  function swatch(name, w, h) {
    const k = name + '|' + w + '|' + h; if (swatches.has(k)) return swatches.get(k);
    if (!swR) swR = createRenderer();
    const out = document.createElement('canvas'); swR.render(sample(w, h), presets[name] || {}, out);
    swatches.set(k, out); return out;
  }

  // Hue/Saturation's own presets (its Preset menu, as Photoshop's list): only the hs part of the grade
  const hsPresets = {
    'Default': {},
    'Cyanotype': { colorize: 1, ch: 210, cs: 25, cl: 0 },
    'Increase Saturation': { master: { sat: 25 } },
    'Further Increase Saturation': { master: { sat: 45 } },
    'Strong Saturation': { master: { sat: 65 } },
    'Old Style': { master: { sat: -55, light: 0 }, reds: { sat: 15 }, yellows: { hue: -5, sat: 20 } },
    'Red Boost': { reds: { sat: 40 } },
    'Sepia': { colorize: 1, ch: 35, cs: 25, cl: 0 },
    'Yellow Boost': { yellows: { hue: -4, sat: 40 } }
  };

  /* ------------------------------------------------------- Hue/Saturation */
  // The same maths as the shader's Hue/Saturation step, in plain JS on 0..1 RGB: the reference the tests compare the WebGL pass with, and
  // what the panel's After bar shows. Photoshop's way: a range's weight comes from the pixel's own hue (1 inside b..c, a straight fade to
  // a and to d, nothing for a grey); each range is applied by its weight, then Master: hue turns in HSL, saturation is Photoshop's
  // (towards full colour without clipping the strongest one first, linear towards grey), lightness mixes towards white or black.
  const rgb2hsl = (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (d <= 0) return [0, 0, l];
    const s = l < 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  };
  const hsl2rgb = (h, s, l) => {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m];
  };
  function hsWeight(h, r) {
    const [a, b, c, d] = r, x = a + (((h - a) % 360) + 360) % 360;
    if (x < b) return (x - a) / (b - a);
    if (x <= c) return 1;
    if (x < d) return (d - x) / (d - c);
    return 0;
  }
  function psSat(c, inc) {
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
    if (d <= 0 || !inc) return c;
    const v = mx + mn, L = v / 2, S = L < 0.5 ? d / v : d / (2 - v);
    if (inc > 0) { let a = inc + S >= 1 ? S : 1 - inc; a = 1 / a - 1; return c.map(x => x + (x - L) * a); }
    return c.map(x => L + (x - L) * (1 + inc));
  }
  const clamp01 = v => Math.min(1, Math.max(0, v));
  function hsStep(c, hue, sat, light) {
    if (hue) { const q = rgb2hsl(c[0], c[1], c[2]); if (q[1] > 0) c = hsl2rgb(q[0] + hue, q[1], q[2]); }
    if (sat) c = psSat(c, sat).map(clamp01);
    if (light) c = c.map(x => light > 0 ? x * (1 - light) + light : x * (1 + light));
    return c;
  }
  // r, g, b in 0..1, hs the grade's hs (normalized); returns [r, g, b]
  function hsApply(rgb, hs) {
    let c = rgb.slice(0, 3);
    if (hs.colorize) {
      const L = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      c = hsl2rgb(hs.ch, hs.cs / 100, L);
      return hsStep(c, 0, 0, hs.cl / 100).map(clamp01);
    }
    const mx = Math.max(c[0], c[1], c[2]), d = mx - Math.min(c[0], c[1], c[2]);
    if (d > 0) {
      const h = rgb2hsl(c[0], c[1], c[2])[0], grey = Math.min(1, d * 255 / 2);   // a near grey is barely in any range
      for (const k of HS_RANGES) {
        const o = hs[k]; if (!o.hue && !o.sat && !o.light) continue;
        const w = hsWeight(h, hsRange(o.r)) * grey; if (w <= 0) continue;
        const t = hsStep(c, o.hue, o.sat / 100, o.light / 100);
        c = c.map((x, i) => x + (t[i] - x) * w);
      }
    }
    return hsStep(c, hs.master.hue, hs.master.sat / 100, hs.master.light / 100).map(clamp01);
  }
  // a range as the shader takes it: four degrees, a ≤ b ≤ c ≤ d, d − a < 360 (a stored range that breaks it falls back to a sane one)
  function hsRange(r) {
    if (!Array.isArray(r) || r.length !== 4 || !r.every(v => isFinite(+v))) return [-45, -15, 15, 45];
    let [a, b, c, d] = r.map(Number);
    b = Math.max(a, b); c = Math.max(b, c); d = Math.max(c, d);
    if (d - a >= 360) { const m = (b + c) / 2; a = Math.max(a, m - 179); d = Math.min(d, m + 179); b = Math.max(a, b); c = Math.min(c, d); }
    return [a, b, c, d];
  }
  const hsUsed = hs => !!hs.colorize || ['master', ...HS_RANGES].some(k => hs[k].hue || hs[k].sat || hs[k].light);

  /* ---------------------------------------------------------------- CPU LUTs */

  const CURVE_N = 1024;

  // Monotone cubic (Fritsch-Carlson) through points in 0..255 space. Flat outside the end points.
  function monotoneSpline(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0]);
    const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    if (n === 0) return x => x;
    if (n === 1) return () => ys[0];
    const d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) { const h = xs[i + 1] - xs[i]; d.push(h > 0 ? (ys[i + 1] - ys[i]) / h : 0); }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return x => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0;
      while (i < n - 2 && x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i];
      if (h <= 0) return ys[i + 1];
      const t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }

  const isIdentityCurve = pts => pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255;

  // Parametric curve (Highlights / Lights / Darks / Shadows with three split points), x in 0..1.
  function parametricFn(c) {
    const s = (c.splits || [25, 50, 75]).map(v => Math.min(0.98, Math.max(0.02, v / 100))).sort((a, b) => a - b);
    const regions = [[0, s[0], c.shadows], [s[0], s[1], c.darks], [s[1], s[2], c.lights], [s[2], 1, c.highlights]];
    return x => {
      let y = x;
      for (const [a, b, v] of regions) {
        if (!v) continue;
        const ctr = (a + b) / 2, hw = Math.max(0.06, b - a), k = (x - ctr) / hw;
        if (Math.abs(k) >= 1) continue;
        const bump = (Math.cos(k * Math.PI) + 1) / 2;
        const taper = Math.min(1, x / 0.04) * Math.min(1, (1 - x) / 0.04);
        y += (v / 100) * 0.22 * bump * taper;
      }
      return y;
    };
  }

  // RGBA32F 1024x1: r,g,b = per-channel curves, a = master (parametric then RGB point curve).
  function buildCurveLUT(c) {
    const data = new Float32Array(CURVE_N * 4);
    const hasParam = c.highlights || c.lights || c.darks || c.shadows;
    const pf = hasParam ? parametricFn(c) : null;
    const fm = monotoneSpline(c.rgb), fr = monotoneSpline(c.red), fg = monotoneSpline(c.green), fb = monotoneSpline(c.blue);
    let prev = 0;
    for (let i = 0; i < CURVE_N; i++) {
      const x = i / (CURVE_N - 1);
      let p = x;
      if (pf) { p = Math.min(1, Math.max(0, pf(x))); p = Math.max(p, prev); prev = p; }
      const clamp01 = v => Math.min(1, Math.max(0, v));
      data[i * 4 + 0] = isIdentityCurve(c.red) ? x : clamp01(fr(x * 255) / 255);
      data[i * 4 + 1] = isIdentityCurve(c.green) ? x : clamp01(fg(x * 255) / 255);
      data[i * 4 + 2] = isIdentityCurve(c.blue) ? x : clamp01(fb(x * 255) / 255);
      data[i * 4 + 3] = isIdentityCurve(c.rgb) ? p : clamp01(fm(p * 255) / 255);
    }
    return data;
  }

  // RGBA32F 360x1: r = hue shift in degrees, g = saturation (-1..1), b = luminance (-1..1).
  function buildHslLUT(hsl) {
    const data = new Float32Array(360 * 4);
    const centers = HUES.map(k => HUE_DEG[k]);
    const vals = HUES.map(k => [hsl[k].hue / 100 * 30, hsl[k].sat / 100, hsl[k].lum / 100]);
    for (let h = 0; h < 360; h++) {
      let i = centers.length - 1;
      for (let k = 0; k < centers.length; k++) if (h >= centers[k]) i = k;
      const j = (i + 1) % centers.length;
      const c0 = centers[i], c1 = j === 0 ? 360 : centers[j];
      const t = (h - c0) / (c1 - c0), w = t * t * (3 - 2 * t);
      for (let ch = 0; ch < 3; ch++) data[h * 4 + ch] = vals[i][ch] * (1 - w) + vals[j][ch] * w;
    }
    return data;
  }

  function hsv2rgb(h, s, v) {
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)];
  }

  function zoneUniform(z) {
    const c = hsv2rgb(((z.hue % 360) + 360) % 360, 1, 1);
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const s = z.sat / 100;
    return [(c[0] - l) * s, (c[1] - l) * s, (c[2] - l) * s, z.lum / 100];
  }

  function wbGains(temp, tint) {
    const t = temp / 100, g = tint / 100;
    const r = Math.pow(2, 0.45 * t + 0.08 * g), gg = Math.pow(2, -0.32 * g), b = Math.pow(2, -0.45 * t + 0.08 * g);
    const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    return [r / y, gg / y, b / y];
  }

  /* ----------------------------------------------------------------- shaders */

  const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

  const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDst; out vec4 o;
void main(){ o = texture(uTex, gl_FragCoord.xy / uDst); }`;

  const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDst; uniform vec2 uDir; out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uDst, d = uDir / uDst;
  vec4 s = texture(uTex, uv) * 0.2270270270;
  s += (texture(uTex, uv + d * 1.3846153846) + texture(uTex, uv - d * 1.3846153846)) * 0.3162162162;
  s += (texture(uTex, uv + d * 3.2307692308) + texture(uTex, uv - d * 3.2307692308)) * 0.0702702703;
  o = s;
}`;

  const FS_MAIN = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc, uB1, uB2, uCurve, uHsl;
uniform vec2 uSize;
uniform vec4 uFrame;
uniform float uScale;
uniform vec3 uWB;
uniform float uExposure;
uniform vec4 uTone;      // contrast, highlights, shadows, whites (-1..1)
uniform float uBlacks;
uniform vec3 uPresence;  // texture, clarity, dehaze
uniform vec2 uSatVib;    // saturation, vibrance
uniform int uUseCurve, uUseHsl, uUseBlur, uUseTone, uUseGrade;
uniform vec4 uCgS, uCgM, uCgH, uCgG;
uniform vec2 uCgBB;      // blending 0..1, balance -1..1
uniform vec3 uDetail;    // sharpen 0..1.5, radius px, noise 0..1
uniform vec4 uVig;       // amount, midpoint, roundness, feather
uniform vec3 uGrain;     // amount, size, roughness
uniform int uUseHs;      // Hue/Saturation (hsApply above is the same maths in JS)
uniform vec3 uHsM;       // Master: hue in degrees, saturation and lightness -1..1
uniform vec3 uHsR[6];    // the six ranges' own hue, saturation, lightness
uniform vec4 uHsB[6];    // their ranges a, b, c, d in degrees
uniform vec4 uHsC;       // colorize: on, hue in degrees, saturation 0..1, lightness -1..1
out vec4 outColor;

const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
float luma(vec3 c){ return dot(c, LW); }

vec3 toLin(vec3 c){ c = max(c, 0.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 toSrgb(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec4 curveAt(float x){
  float f = clamp(x, 0.0, 1.0) * 1023.0, i0 = floor(f);
  int i = int(i0), j = min(i + 1, 1023);
  return mix(texelFetch(uCurve, ivec2(i, 0), 0), texelFetch(uCurve, ivec2(j, 0), 0), f - i0);
}

vec3 rgb2hsl(vec3 c){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l = (mx + mn) * 0.5, d = mx - mn;
  if (d <= 0.0) return vec3(0.0, 0.0, l);
  float s = l < 0.5 ? d / (mx + mn) : d / (2.0 - mx - mn);
  float h = mx == c.r ? (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
  return vec3(h * 60.0, s, l);
}
vec3 hsl2rgb(vec3 q){
  float h = mod(q.x, 360.0), c = (1.0 - abs(2.0 * q.z - 1.0)) * q.y, x = c * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0)), m = q.z - c * 0.5;
  vec3 r = h < 60.0 ? vec3(c, x, 0.0) : h < 120.0 ? vec3(x, c, 0.0) : h < 180.0 ? vec3(0.0, c, x) : h < 240.0 ? vec3(0.0, x, c) : h < 300.0 ? vec3(x, 0.0, c) : vec3(c, 0.0, x);
  return r + m;
}
float hsWeight(float h, vec4 r){
  float x = r.x + mod(h - r.x, 360.0);
  if (x < r.y) return (x - r.x) / (r.y - r.x);
  if (x <= r.z) return 1.0;
  if (x < r.w) return (r.w - x) / (r.w - r.z);
  return 0.0;
}
vec3 psSat(vec3 c, float inc){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
  if (d <= 0.0 || inc == 0.0) return c;
  float v = mx + mn, L = v * 0.5, S = L < 0.5 ? d / v : d / (2.0 - v);
  if (inc > 0.0) { float a = inc + S >= 1.0 ? S : 1.0 - inc; a = 1.0 / a - 1.0; return c + (c - L) * a; }
  return L + (c - L) * (1.0 + inc);
}
vec3 hsStep(vec3 c, vec3 a){
  if (a.x != 0.0) { vec3 q = rgb2hsl(c); if (q.y > 0.0) c = hsl2rgb(vec3(q.x + a.x, q.y, q.z)); }
  if (a.y != 0.0) c = clamp(psSat(c, a.y), 0.0, 1.0);
  if (a.z != 0.0) c = a.z > 0.0 ? c * (1.0 - a.z) + a.z : c * (1.0 + a.z);
  return c;
}
${SC.GLSL}

float hash(ivec2 p){
  uvec2 q = uvec2(p + ivec2(4096));
  uint h = q.x * 1597334677u ^ q.y * 3812015801u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h) * (1.0 / 4294967295.0);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  ivec2 ii = ivec2(i);
  float a = hash(ii), b = hash(ii + ivec2(1, 0)), c = hash(ii + ivec2(0, 1)), d = hash(ii + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

const vec2 RING[8] = vec2[8](vec2(1,0), vec2(-1,0), vec2(0,1), vec2(0,-1),
  vec2(0.7071,0.7071), vec2(-0.7071,0.7071), vec2(0.7071,-0.7071), vec2(-0.7071,-0.7071));

void main(){
  vec2 ip = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);   // image pixel coords, top-left origin
  vec2 uv = ip / uSize, px = 1.0 / uSize;
  vec4 s = texelFetch(uSrc, ivec2(ip), 0);
  vec3 c = s.rgb;

  // Detail: noise reduction (edge-aware 9-tap), then sharpening (luma unsharp mask)
  if (uDetail.z > 0.0) {
    float r = max(0.6, 1.4 * uScale), sig = 0.035 + 0.14 * uDetail.z;
    vec3 acc = c; float ws = 1.0;
    for (int k = 0; k < 8; k++) {
      vec3 n = texture(uSrc, uv + RING[k] * r * px).rgb;
      vec3 dd = n - s.rgb; float w = exp(-dot(dd, dd) / (2.0 * sig * sig));
      acc += n * w; ws += w;
    }
    c = mix(c, acc / ws, min(1.0, uDetail.z * 1.15));
  }
  if (uDetail.x > 0.0) {
    float r = max(0.35, uDetail.y * uScale);
    vec3 b = vec3(0.0);
    for (int k = 0; k < 8; k++) b += texture(uSrc, uv + RING[k] * r * px).rgb;
    b /= 8.0;
    float d = luma(s.rgb) - luma(b);
    d = sign(d) * max(abs(d) - 0.003, 0.0);
    c += vec3(d * uDetail.x * 1.4);
  }

  // Presence: texture (fine local contrast) and clarity (midtone local contrast)
  if (uUseBlur == 1) {
    if (uPresence.x != 0.0) {
      float d = luma(c) - luma(texture(uB1, uv).rgb);
      c += vec3(d * uPresence.x * (uPresence.x > 0.0 ? 1.25 : 0.95));
    }
    if (uPresence.y != 0.0) {
      float L = luma(c);
      float d = L - luma(texture(uB2, uv).rgb);
      float m = smoothstep(0.0, 0.3, L) * (1.0 - smoothstep(0.7, 1.0, L)) * 0.75 + 0.25;
      c += vec3(d * uPresence.y * m * (uPresence.y > 0.0 ? 1.1 : 0.9));
    }
  }

  vec3 lin = toLin(c);

  // Dehaze (dark-channel style, local airlight from the blurred copy)
  if (uPresence.z != 0.0) {
    vec3 bl = uUseBlur == 1 ? toLin(texture(uB2, uv).rgb) : lin;
    float dark = min(min(bl.r, bl.g), bl.b);
    if (uPresence.z > 0.0) {
      float t = clamp(dark * uPresence.z * 0.95, 0.0, 0.85);
      lin = max(lin - vec3(t), 0.0) / (1.0 - t);
      float Yd = luma(lin);
      lin = max(Yd + (lin - Yd) * (1.0 + 0.35 * uPresence.z), 0.0);
    } else {
      float h = -uPresence.z;
      lin = mix(lin, vec3(0.5 + 0.45 * luma(bl)), h * 0.6);
    }
  }

  // White balance + exposure (linear light)
  lin *= uWB * exp2(uExposure);

  // Tone: luminance-only curve in a perceptual (gamma 2.2) domain; chroma ratios preserved
  if (uUseTone == 1) {
    float Y = luma(lin);
    float L = pow(max(Y, 0.0), 1.0 / 2.2);
    float g = clamp(L, 0.0, 1.0);
    L += uTone.x * 1.8 * (g - 0.5) * g * (1.0 - g);
    float hm = smoothstep(0.45, 1.0, L);
    L *= 1.0 + uTone.y * (uTone.y > 0.0 ? 0.28 : 0.26) * hm;
    float sm = 1.0 - smoothstep(0.0, 0.55, L);
    if (uTone.z > 0.0) L += uTone.z * 0.4 * sm * pow(max(L, 0.0), 0.75);
    else L *= 1.0 + uTone.z * 0.6 * sm;
    L += uTone.w * 0.2 * smoothstep(0.5, 1.0, L) * L;
    L += uBlacks * 0.1 * (1.0 - smoothstep(0.0, 0.5, L));
    float Y2 = pow(max(L, 0.0), 2.2);
    lin = Y > 1e-6 ? lin * (Y2 / Y) : vec3(Y2);
  }

  // Soft highlight roll-off: keep luminance, pull chroma in until nothing exceeds 1
  float mx = max(lin.r, max(lin.g, lin.b));
  if (mx > 1.0) {
    float Yc = luma(lin);
    lin = Yc >= 1.0 ? vec3(1.0) : Yc + (lin - Yc) * ((1.0 - Yc) / (mx - Yc));
  }

  c = toSrgb(lin);

  // Vibrance / Saturation (around luma, encoded)
  if (uSatVib.y != 0.0 || uSatVib.x != 0.0) {
    float l = luma(c);
    if (uSatVib.y != 0.0) {
      float cmx = max(c.r, max(c.g, c.b)), cmn = min(c.r, min(c.g, c.b));
      float sat = cmx > 1e-5 ? (cmx - cmn) / cmx : 0.0;
      float amt = uSatVib.y;
      if (amt > 0.0) {
        float hd = rgb2hsv(clamp(c, 0.0, 1.0)).x * 360.0;
        float dh = abs(mod(hd - 25.0 + 180.0, 360.0) - 180.0);
        float skin = 1.0 - 0.55 * exp(-(dh * dh) / (2.0 * 22.0 * 22.0));
        amt *= (1.0 - sat) * (1.0 - sat) * skin * 1.6;
      }
      c = l + (c - l) * (1.0 + amt);
    }
    c = l + (c - l) * (1.0 + uSatVib.x);
  }

  // Curves: master (parametric + RGB point) then per channel
  if (uUseCurve == 1) {
    c = clamp(c, 0.0, 1.0);
    c = vec3(curveAt(c.r).a, curveAt(c.g).a, curveAt(c.b).a);
    c = vec3(curveAt(c.r).r, curveAt(c.g).g, curveAt(c.b).b);
  }

  // Color Mixer (HSL), weighted by chroma so neutrals stay put
  if (uUseHsl == 1) {
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float w = smoothstep(0.02, 0.22, hsv.y) * smoothstep(0.0, 0.06, hsv.z);
    float f = hsv.x * 360.0, i0 = floor(f);
    int i = int(i0) % 360, j = (i + 1) % 360;
    vec4 a = mix(texelFetch(uHsl, ivec2(i, 0), 0), texelFetch(uHsl, ivec2(j, 0), 0), f - i0) * w;
    if (a.x != 0.0) { hsv.x = fract(hsv.x + a.x / 360.0 + 1.0); c = hsv2rgb(hsv); }
    float l = luma(c);
    c = l + (c - l) * max(0.0, 1.0 + a.y);
    c = a.z < 0.0 ? c * (1.0 + a.z * 0.7) : c + (1.0 - c) * a.z * 0.45;
  }

  // Hue/Saturation (Photoshop's): the ranges by the pixel's own hue, then Master; or Colorize
  if (uUseHs == 1) {
    c = clamp(c, 0.0, 1.0);
    if (uHsC.x > 0.5) {
      float L = dot(c, vec3(0.299, 0.587, 0.114));
      c = hsStep(hsl2rgb(vec3(uHsC.y, uHsC.z, L)), vec3(0.0, 0.0, uHsC.w));
    } else {
      float d = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
      if (d > 0.0) {
        float h = rgb2hsl(c).x, grey = min(1.0, d * 127.5);
        for (int k = 0; k < 6; k++) {
          if (uHsR[k] == vec3(0.0)) continue;
          float w = hsWeight(h, uHsB[k]) * grey;
          if (w > 0.0) c = mix(c, hsStep(c, uHsR[k]), w);
        }
      }
      c = hsStep(c, uHsM);
    }
    c = clamp(c, 0.0, 1.0);
  }
  ${SC.STEP}

  // Color Grading: shadows / midtones / highlights / global
  if (uUseGrade == 1) {
    float L = clamp(luma(c), 0.0, 1.0);
    float p = clamp(0.5 - uCgBB.y * 0.25, 0.2, 0.8);
    float wd = 0.08 + uCgBB.x * 0.55;
    float ws = 1.0 - smoothstep(p - wd, p, L);
    float wh = smoothstep(p, p + wd, L);
    float wm = max(0.0, 1.0 - ws - wh);
    c += (uCgS.rgb * ws + uCgM.rgb * wm + uCgH.rgb * wh) * 0.24 + uCgG.rgb * 0.2;
    c += vec3((uCgS.a * ws + uCgM.a * wm + uCgH.a * wh) * 0.2 + uCgG.a * 0.15);
  }

  // Vignette (post-crop style)
  if (uVig.x != 0.0) {
    vec2 fs = uFrame.z > 0.0 ? uFrame.zw : uSize, fp = ip - (uFrame.z > 0.0 ? uFrame.xy : vec2(0.0));
    vec2 q = (fp / fs - 0.5) * 2.0;
    float d;
    if (uVig.z >= 0.0) {
      vec2 qc = (fp - 0.5 * fs) / (0.5 * length(fs)) * 1.41421356;
      d = length(mix(q, qc, uVig.z));
    } else {
      float n = 2.0 - uVig.z * 6.0;
      vec2 aq = abs(q);
      d = pow(pow(aq.x, n) + pow(aq.y, n), 1.0 / n);
    }
    float mid = 0.25 + uVig.y * 1.1, fea = 0.05 + uVig.w * 1.0;
    float m = smoothstep(mid, mid + fea, d);
    c = uVig.x < 0.0 ? c * (1.0 + uVig.x * 0.95 * m) : mix(c, vec3(1.0), uVig.x * 0.9 * m);
  }

  // Grain (deterministic, monochrome, strongest in midtones)
  if (uGrain.x > 0.0) {
    float sz = max(0.5, (0.6 + uGrain.y * 3.2) * uScale);
    vec2 gp = ip / sz;
    float n1 = vnoise(gp), n2 = vnoise(gp * 2.37 + 17.3), n3 = hash(ivec2(floor(ip)));
    float n = mix(n1, n1 * 0.45 + n2 * 0.35 + n3 * 0.2, uGrain.z) - 0.5;
    float L = clamp(luma(c), 0.0, 1.0);
    c += vec3(n * uGrain.x * 0.28 * (0.3 + 2.8 * L * (1.0 - L)));
  }

  c = clamp(c, 0.0, 1.0);
  outColor = vec4(c * s.a, s.a);
}`;

  /* ---------------------------------------------------------------- renderer */

  function createRenderer() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    let gl, progMain, progDown, progBlur, vao, srcTex, curveTex, hslTex, emptyTex;
    let lost = false, maxTex = 0;
    let lastSrc = null, lastW = 0, lastH = 0, pyramidValid = false, pyramid = null;
    let curveKey = '', hslKey = '';
    const uloc = new Map();

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('HyColorGrade shader: ' + gl.getShaderInfoLog(sh));
      return sh;
    }
    function program(fs) {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('HyColorGrade link: ' + gl.getProgramInfoLog(p));
      return p;
    }
    function U(p, name) {
      let m = uloc.get(p);
      if (!m) { m = {}; uloc.set(p, m); }
      if (!(name in m)) m[name] = gl.getUniformLocation(p, name);
      return m[name];
    }
    function makeTex(filter) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function makeTarget(w, h) {
      const tex = makeTex(gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w, h };
    }
    function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }

    function init() {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('HyColorGrade: WebGL2 is not available');
      uloc.clear();
      progMain = program(FS_MAIN); progDown = program(FS_DOWN); progBlur = program(FS_BLUR);
      vao = gl.createVertexArray();
      srcTex = makeTex(gl.LINEAR);
      curveTex = makeTex(gl.NEAREST); hslTex = makeTex(gl.NEAREST);
      emptyTex = makeTex(gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      lastSrc = null; lastW = lastH = 0; pyramidValid = false; pyramid = null; curveKey = hslKey = '';
      lost = false;
    }
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { try { init(); } catch (err) { console.error(err); } });
    init();

    function pass(prog, target, tex, extra) {
      gl.useProgram(prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, target.w, target.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U(prog, 'uTex'), 0);
      gl.uniform2f(U(prog, 'uDst'), target.w, target.h);
      if (extra) extra();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function ensurePyramid(w, h) {
      if (pyramid && pyramid.w === w && pyramid.h === h) return;
      if (pyramid) { pyramid.all.forEach(freeTarget); }
      const all = [];
      const b1w = Math.max(1, Math.ceil(w / 2)), b1h = Math.max(1, Math.ceil(h / 2));
      const b1 = makeTarget(b1w, b1h), b1t = makeTarget(b1w, b1h);
      all.push(b1, b1t);
      const chain = [];
      let cw = b1w, ch = b1h;
      while ((Math.max(cw, ch) > 256 || !chain.length) && Math.max(cw, ch) > 2) {
        cw = Math.max(1, Math.ceil(cw / 2)); ch = Math.max(1, Math.ceil(ch / 2));
        const t = makeTarget(cw, ch); chain.push(t); all.push(t);
      }
      const last = chain.length ? chain[chain.length - 1] : null;
      const b2t = makeTarget(last ? last.w : b1w, last ? last.h : b1h);
      all.push(b2t);
      pyramid = { w, h, b1, b1t, chain, b2t, all };
    }

    function buildPyramid() {
      const P = pyramid;
      gl.bindVertexArray(vao);
      const blur = (target, tmp, spread) => {
        pass(progBlur, tmp, target.tex, () => gl.uniform2f(U(progBlur, 'uDir'), spread, 0));
        pass(progBlur, target, tmp.tex, () => gl.uniform2f(U(progBlur, 'uDir'), 0, spread));
      };
      // Small-radius copy for Texture: 1/2 resolution, gaussian
      pass(progDown, P.b1, srcTex);
      // Large-radius copy for Clarity / Dehaze: halve down to <= 256 px, then two wide gaussian passes
      let prev = P.b1;
      for (const t of P.chain) { pass(progDown, t, prev.tex); prev = t; }
      const b2 = P.chain.length ? P.chain[P.chain.length - 1] : null;
      if (b2) { const sp = 1.5 * Math.max(b2.w, b2.h) / 192; blur(b2, P.b2t, sp); blur(b2, P.b2t, sp); }
      blur(P.b1, P.b1t, 1.0);
      P.b2 = b2 || P.b1;
      pyramidValid = true;
    }

    function srcSize(src) {
      return [src.naturalWidth || src.videoWidth || src.displayWidth || src.width, src.naturalHeight || src.videoHeight || src.displayHeight || src.height];
    }
    const isImmutable = src => (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) ||
      (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap);

    function render(src, params, out, opts) {
      opts = opts || {};
      if (lost || !src) return out || canvas;
      const p = effective(params);
      const [w, h] = srcSize(src);
      if (!w || !h) return out || canvas;
      const max = maxTex || (maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE));
      if (w > max || h > max) throw new Error(`HyColorGrade: source ${w}x${h} exceeds MAX_TEXTURE_SIZE ${max}`);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.bindVertexArray(vao);

      const same = src === lastSrc && w === lastW && h === lastH && (isImmutable(src) || opts.reuseSource);
      if (!same) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        if (w === lastW && h === lastH) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
        lastSrc = src; lastW = w; lastH = h; pyramidValid = false;
      }
      const useBlur = !!(p.texture || p.clarity || p.dehaze);
      if (useBlur) { ensurePyramid(w, h); if (!pyramidValid) buildPyramid(); }

      const c = p.curve;
      const useCurve = !(isIdentityCurve(c.rgb) && isIdentityCurve(c.red) && isIdentityCurve(c.green) && isIdentityCurve(c.blue) &&
        !c.highlights && !c.lights && !c.darks && !c.shadows);
      if (useCurve) {
        const key = JSON.stringify(c);
        if (key !== curveKey) {
          gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, curveTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, CURVE_N, 1, 0, gl.RGBA, gl.FLOAT, buildCurveLUT(c));
          curveKey = key;
        }
      }
      const useHsl = HUES.some(k => p.hsl[k].hue || p.hsl[k].sat || p.hsl[k].lum);
      if (useHsl) {
        const key = JSON.stringify(p.hsl);
        if (key !== hslKey) {
          gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, hslTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 360, 1, 0, gl.RGBA, gl.FLOAT, buildHslLUT(p.hsl));
          hslKey = key;
        }
      }
      const g = p.grading;
      const useGrade = ['shadows', 'midtones', 'highlights', 'global'].some(k => g[k].sat || g[k].lum);

      const P = progMain;
      gl.useProgram(P);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      const bind = (unit, tex, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U(P, name), unit); };
      bind(0, srcTex, 'uSrc');
      bind(1, useBlur ? pyramid.b1.tex : emptyTex, 'uB1');
      bind(2, useBlur ? pyramid.b2.tex : emptyTex, 'uB2');
      bind(3, useCurve ? curveTex : emptyTex, 'uCurve');
      bind(4, useHsl ? hslTex : emptyTex, 'uHsl');

      const scale = opts.scale > 0 ? opts.scale : 1;
      const wb = wbGains(p.temp, p.tint);
      gl.uniform2f(U(P, 'uSize'), w, h);
      const fr = Array.isArray(opts.frame) && opts.frame[2] > 0 && opts.frame[3] > 0 ? opts.frame : [0, 0, 0, 0];
      gl.uniform4f(U(P, 'uFrame'), fr[0], fr[1], fr[2], fr[3]);
      gl.uniform1f(U(P, 'uScale'), scale);
      gl.uniform3f(U(P, 'uWB'), wb[0], wb[1], wb[2]);
      gl.uniform1f(U(P, 'uExposure'), p.exposure);
      gl.uniform4f(U(P, 'uTone'), p.contrast / 100, p.highlights / 100, p.shadows / 100, p.whites / 100);
      gl.uniform1f(U(P, 'uBlacks'), p.blacks / 100);
      gl.uniform1i(U(P, 'uUseTone'), (p.contrast || p.highlights || p.shadows || p.whites || p.blacks) ? 1 : 0);
      gl.uniform3f(U(P, 'uPresence'), p.texture / 100, p.clarity / 100, p.dehaze / 100);
      gl.uniform2f(U(P, 'uSatVib'), p.saturation / 100, p.vibrance / 100);
      gl.uniform1i(U(P, 'uUseCurve'), useCurve ? 1 : 0);
      gl.uniform1i(U(P, 'uUseHsl'), useHsl ? 1 : 0);
      gl.uniform1i(U(P, 'uUseBlur'), useBlur ? 1 : 0);
      gl.uniform1i(U(P, 'uUseGrade'), useGrade ? 1 : 0);
      const zs = zoneUniform(g.shadows), zm = zoneUniform(g.midtones), zh = zoneUniform(g.highlights), zg = zoneUniform(g.global);
      gl.uniform4fv(U(P, 'uCgS'), zs); gl.uniform4fv(U(P, 'uCgM'), zm);
      gl.uniform4fv(U(P, 'uCgH'), zh); gl.uniform4fv(U(P, 'uCgG'), zg);
      gl.uniform2f(U(P, 'uCgBB'), g.blending / 100, g.balance / 100);
      gl.uniform3f(U(P, 'uDetail'), p.sharpening / 100, p.sharpenRadius, p.noiseReduction / 100);
      const v = p.vignette;
      gl.uniform4f(U(P, 'uVig'), v.amount / 100, v.midpoint / 100, v.roundness / 100, v.feather / 100);
      gl.uniform3f(U(P, 'uGrain'), p.grain.amount / 100, p.grain.size / 100, p.grain.roughness / 100);
      const hs = p.hs, useHs = hsUsed(hs);
      gl.uniform1i(U(P, 'uUseHs'), useHs ? 1 : 0);
      if (useHs) {
        gl.uniform3f(U(P, 'uHsM'), hs.master.hue, hs.master.sat / 100, hs.master.light / 100);
        gl.uniform3fv(U(P, 'uHsR'), HS_RANGES.flatMap(k => [hs[k].hue, hs[k].sat / 100, hs[k].light / 100]));
        gl.uniform4fv(U(P, 'uHsB'), HS_RANGES.flatMap(k => hsRange(hs[k].r)));
        gl.uniform4f(U(P, 'uHsC'), hs.colorize ? 1 : 0, hs.ch, hs.cs / 100, hs.cl / 100);
      }
      SC.uniforms(gl, n => U(P, n), p.sc);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (out && out !== canvas) {
        if (out.width !== w) out.width = w;
        if (out.height !== h) out.height = h;
        const ctx = out.getContext('2d');
        ctx.save();
        ctx.globalCompositeOperation = 'copy';
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvas, 0, 0);
        ctx.restore();
        return out;
      }
      return canvas;
    }

    return {
      render,
      canvas,
      get gl() { return gl; },
      invalidate() { lastSrc = null; pyramidValid = false; },
      info() {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
      },
      destroy() {
        if (pyramid) pyramid.all.forEach(freeTarget);
        pyramid = null;
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    };
  }

  /* --------------------------------------------------------------- histogram */

  // 256-bin histograms (r, g, b, luma) of a source, each normalised to 0..1 (sqrt-compressed).
  function histogram(src, maxSide) {
    maxSide = maxSide || 256;
    const w0 = src.naturalWidth || src.videoWidth || src.width, h0 = src.naturalHeight || src.videoHeight || src.height;
    if (!w0 || !h0) return null;
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const r = new Float32Array(256), g = new Float32Array(256), b = new Float32Array(256), l = new Float32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
      l[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
    }
    const norm = a => {
      let m = 0;
      for (let i = 1; i < 255; i++) m = Math.max(m, a[i]);
      m = Math.sqrt(m || 1);
      for (let i = 0; i < 256; i++) a[i] = Math.min(1, Math.sqrt(a[i]) / m);
      return a;
    };
    return { r: norm(r), g: norm(g), b: norm(b), l: norm(l) };
  }

  /* -------------------------------------------------------------------- panel */

  const DARK = {
    '--paper': '#17171a', '--panel': '#0c0c0e', '--raise': '#18181b', '--raise2': '#232327',
    '--ink': '#fafafa', '--sub': '#a1a1aa', '--muted': '#71717a', '--line': '#27272a', '--sel': '#3b82f6'
  };

  const CSS = `
.hcg{--ease:cubic-bezier(.3,.8,.25,1);--ease2:cubic-bezier(.32,.72,0,1);position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;
  background:var(--paper);color:var(--ink);font:500 12px/1.3 Geist,ui-sans-serif,system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;box-sizing:border-box}
.hcg *,.hcg *::before,.hcg *::after{box-sizing:border-box}
/* the buttons' reset weighs nothing (:where), so a control's own class keeps its padding (owner 2026-10-06: «Presets ⌄» and the
   Hue/Saturation select had their words against the capsule's edge, this reset outweighed their padding) */
:where(.hcg) button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer}
.hcg svg{display:block;flex:none}
/* round 12 «A · Line» (owner 2026-10-09, r12/image-raw.html: «реализуй этот дизайн»): the title row with no rule under it, the sections
   34 px heads in the app's words, a hairline between two (Hyimg ui/hy/block.css), labels without a rule after them, a choice a dark well */
.hcg-top{display:flex;align-items:center;gap:2px;height:36px;padding:0 6px 0 14px;flex:none}
.hcg-title{flex:1;font-weight:600;font-size:13px;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hcg-ib{width:26px;height:26px;border-radius:var(--r-ctl,8px);display:grid;place-items:center;color:var(--sub);
  transition:background .2s var(--ease),color .2s var(--ease),transform .2s var(--ease)}
.hcg-ib svg{width:16px;height:16px}
.hcg-ib:hover{background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--ink)}
.hcg-ib:active{transform:scale(.92)}
.hcg-ib.on{background:var(--raise2);color:var(--ink)}
.hcg-pbtn{height:26px;padding:0 calc(var(--hy-cap-pad,10px) - 2px) 0 var(--hy-cap-pad,10px);border-radius:var(--r-ctl,8px);display:flex;align-items:center;gap:4px;color:var(--sub);
  transition:background .2s var(--ease),color .2s var(--ease)}
.hcg-pbtn:hover,.hcg-pbtn.on{background:color-mix(in srgb,var(--ink) 6%,transparent);color:var(--ink)}
.hcg-pbtn .hcg-chev{width:11px;height:11px;transform:rotate(90deg)}
.hcg-menu{position:absolute;right:8px;top:40px;z-index:5;min-width:180px;padding:6px;border-radius:var(--r-panel,10px);background:var(--panel);
  border:1px solid var(--line);box-shadow:var(--plate-sh,0 2px 6px rgba(0,0,0,.35),0 18px 48px rgba(0,0,0,.5));
  opacity:0;transform:translateY(-4px) scale(.98);transform-origin:top right;pointer-events:none;
  transition:opacity .18s var(--ease),transform .2s var(--ease)}
.hcg-menu.open{opacity:1;transform:none;pointer-events:auto}
.hcg-menu .mt{padding:6px 8px 4px;color:var(--muted);font:600 10.5px Geist,ui-sans-serif,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.hcg-menu button{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 10px;border-radius:var(--r-row,6px);text-align:left;
  transition:background .15s var(--ease)}
.hcg-menu button:hover{background:var(--raise)}
.hcg-menu .hcg-msep{height:1px;margin:5px 6px;background:var(--line)} .hcg-menu .hcg-mclear .ck{opacity:.75;color:currentColor}
.hcg-menu button .ck{width:14px;color:var(--sel);opacity:0;transition:opacity .15s}
.hcg-menu button.cur .ck{opacity:1}
.hcg-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:var(--raise2) transparent;padding:0 6px 24px}
.hcg-sec+.hcg-sec{border-top:1px solid var(--hy-pline,var(--line))}
.hcg-head{display:flex;align-items:center;gap:8px;height:34px;padding:0 4px 0 8px;border-radius:8px;cursor:pointer;color:var(--sub);
  transition:color .2s var(--ease),background .2s var(--ease)}
.hcg-head:hover{color:var(--ink);background:var(--hy-hov,color-mix(in srgb,var(--ink) 6%,transparent))}
.hcg-sec.open>.hcg-head{color:var(--ink)}
.hcg-head .ic{width:15px;height:15px;opacity:.9}
.hcg-head .t{flex:1;min-width:0;font-weight:500;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hcg-head .dot{width:5px;height:5px;border-radius:50%;background:var(--sel);opacity:0;transform:scale(.4);transition:opacity .2s var(--ease),transform .25s var(--ease)}
.hcg-sec.mod .hcg-head .dot{opacity:1;transform:none}
.hcg-head .rs{width:24px;height:24px;border-radius:var(--r-ctl,6px);display:grid;place-items:center;color:var(--muted);opacity:0;scale:.6;pointer-events:none;
  transition:opacity .24s var(--ease2),scale .32s var(--ease2),background .15s var(--ease),color .15s var(--ease)}
.hcg-sec.mod .hcg-head:hover .rs{opacity:1;scale:1;pointer-events:auto}
.hcg-head .rs:hover,.hcg-head .ey:hover{background:var(--raise2);color:var(--ink)}
.hcg-head .ey{width:24px;height:24px;border-radius:var(--r-ctl,6px);display:grid;place-items:center;color:var(--muted);transition:background .15s var(--ease),color .15s var(--ease)}
.hcg-head .ey svg,.hcg-eye svg{width:15px;height:15px}
.hcg-sec.off .hcg-head .ey{color:var(--ink)}
/* off (owner 2026-10-06: «it is not clear at all» that the grade is off): what is off fades, colour and strength, by a filter on the
   blocks, never by other colours; the eyes and the close button stay as they are, to switch back */
.hcg-scroll,.hcg-title,.hcg-pbtn,.hcg-rall,.hcg-head>.ic,.hcg-head>.t{transition:filter .32s var(--ease2),opacity .32s var(--ease2)}
.hcg.byp .hcg-scroll,.hcg.byp .hcg-title,.hcg.byp .hcg-pbtn,.hcg.byp .hcg-rall,.hcg-sec.off>.hcg-body{filter:saturate(0);opacity:.4}
.hcg-sec.off>.hcg-head>.ic,.hcg-sec.off>.hcg-head>.t{opacity:.45}
.hcg.byp .hcg-eye{color:var(--ink);background:var(--raise2)}
.hcg-head .hcg-chev{width:11px;height:11px;margin:0 2.5px;color:var(--muted);transition:transform .25s var(--ease)}
.hcg-sec.open>.hcg-head .hcg-chev{transform:rotate(90deg)}
.hcg-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s var(--ease),filter .32s var(--ease2),opacity .32s var(--ease2)}
.hcg-sec.open>.hcg-body{grid-template-rows:1fr}
.hcg-inner{min-height:0;overflow:hidden;opacity:0;transition:opacity .22s var(--ease)}
.hcg-sec.open .hcg-inner{opacity:1}
.hcg-pad{padding:0 6px 10px}
.hcg-sub{display:flex;align-items:center;gap:8px;margin:8px 0 2px;color:var(--muted);font:600 10px Geist,ui-sans-serif,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.hcg-sub:first-child{margin-top:2px}
.hcg-row{padding:2px 0}
.hcg .hy-slider{--hy-sl-h:28px;font-size:12px}   /* the app's one slider (ui/slider.css) at this panel's row height */
.hcg .hy-slider-ed{user-select:text;-webkit-user-select:text}
.hcg-rail{position:absolute;left:0;right:0;top:7px;height:4px;border-radius:2px;background:var(--raise2)}   /* the tone split's rail */
/* a choice: its track var(--hy-seg-pad) around the options, each option's corners the track's less that inset (concentric) and its
   words 6 px from its ends (owner 2026-10-06: the app's one segmented rule, ui/look.css .seg) */
.hcg-seg{display:flex;gap:0;padding:var(--hy-seg-pad,3px);margin:6px 0 8px;border-radius:var(--r-ctl,8px);background:var(--raise)}
.hcg-seg button{flex:1 1 auto;min-width:0;padding:0 6px;height:24px;border-radius:max(0px,calc(var(--r-ctl,8px) - var(--hy-seg-pad,3px)));color:var(--sub);font-size:11px;display:flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;
  transition:background .2s var(--ease),color .2s var(--ease)}
.hcg-seg button:hover{color:var(--ink)}
.hcg-seg button.on{background:var(--hy-val-on,var(--panel));color:var(--hy-val-ink,var(--ink));box-shadow:var(--hy-thumb-sh,none)}
.hcg-seg .sw{width:7px;height:7px;border-radius:50%;flex:none}   /* a dot stays a dot when the words are long (Russian) */
.hcg-seg button.dot{flex:0 0 32px}.hcg-seg button.dot .sw{width:9px;height:9px}   /* a channel by its colour alone, its name in the tooltip */
.hcg-cv{position:relative;margin:2px 0 4px}
.hcg-cv canvas{display:block;width:100%;border-radius:var(--r-box,6px);touch-action:none;cursor:crosshair}
.hcg-readout{position:absolute;left:8px;top:6px;font:500 10.5px/1 Geist,ui-sans-serif,sans-serif;font-variant-numeric:tabular-nums;color:var(--sub);
  opacity:0;transition:opacity .2s var(--ease);pointer-events:none}
.hcg-cv.show .hcg-readout{opacity:1}
.hcg-hint{color:var(--muted);font-size:11px;margin:2px 0 4px}
.hcg-split{position:relative;height:22px;margin:4px 0 2px;touch-action:none;cursor:pointer}
.hcg-split .hcg-rail{top:9px;background:linear-gradient(90deg,#111,#3f3f46 50%,#d4d4d8)}
.hcg-split .k{position:absolute;top:3px;width:10px;height:16px;margin-left:-5px;border-radius:3px;background:var(--ink);
  box-shadow:0 0 0 1px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.5);transition:transform .15s var(--ease)}
.hcg-split .k:hover,.hcg-split .k.drag{transform:scaleY(1.12)}
.hcg-wheels{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px 8px;margin:4px 0 6px}
.hcg-wheel{display:flex;flex-direction:column;align-items:center;gap:4px}
.hcg-wheel.full{width:100%}
.hcg-wheel .wl{display:flex;justify-content:space-between;align-self:stretch;color:var(--sub);font-size:11.5px}
.hcg-wheel .wl b{font-weight:500;color:var(--ink)}
.hcg-wheel .wv{color:var(--muted);font-variant-numeric:tabular-nums}
.hcg-wheel canvas{display:block;touch-action:none;cursor:crosshair;border-radius:50%}
.hcg-wheel .hcg-row{align-self:stretch}
.hcg-wheel .hy-slider-l{max-width:calc(100% - 40px)}   /* under a wheel the number is at most «100»: the label gets the room (owner 2026-10-07: «Светимость» was cut) */
/* Hue/Saturation (owner 2026-10-06, Photoshop's Properties › Hue/Saturation in the app's look): the preset select, the range swatches
   with the eyedroppers, the app's sliders, Colorize, the Before-After bars with the range's marks; rows take the app's row radius */
.hcg button:focus,.hcg button:focus-visible{outline:none}
.hcg-hsp{display:flex;align-items:center;gap:8px;margin:6px 0 8px}
.hcg-hsp .l{color:var(--sub);font-size:11.5px;flex:none}
.hcg-sel{flex:1;min-width:0;height:28px;padding:0 calc(var(--hy-cap-pad,10px) - 1px) 0 calc(var(--hy-cap-pad,10px) + 2px);border-radius:var(--hy-row-r,var(--r-ctl,8px));background:color-mix(in srgb,var(--ink) 7%,transparent);display:flex;align-items:center;gap:6px;color:var(--ink);
  transition:background .25s var(--ease)}
.hcg-sel:hover,.hcg-sel.on{background:color-mix(in srgb,var(--ink) 11%,transparent)}
.hcg-sel span{flex:1;min-width:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hcg-sel .hcg-chev{width:11px;height:11px;color:var(--muted);transform:rotate(90deg);transition:transform .25s var(--ease)}
.hcg-sel.on .hcg-chev{transform:rotate(-90deg)}
.hcg-hsm{position:absolute;z-index:6;min-width:200px;padding:6px;border-radius:var(--r-panel,10px);background:var(--panel);border:1px solid var(--line);
  box-shadow:var(--plate-sh,0 2px 6px rgba(0,0,0,.35),0 18px 48px rgba(0,0,0,.5));opacity:0;transform:translateY(-4px) scale(.98);transform-origin:top left;pointer-events:none;
  transition:opacity .18s var(--ease),transform .2s var(--ease)}
.hcg-hsm.open{opacity:1;transform:none;pointer-events:auto}
.hcg-hsm button{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 10px;border-radius:var(--r-row,6px);text-align:left;transition:background .15s var(--ease)}
.hcg-hsm button:hover{background:var(--raise)}
.hcg-hsm button .ck{width:14px;color:var(--sel);opacity:0;transition:opacity .15s}
.hcg-hsm button.cur .ck{opacity:1}
.hcg-hsr{display:flex;align-items:center;gap:5px;margin:4px 0 2px}
.hcg-sw{position:relative;width:20px;height:20px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18);transition:box-shadow .2s var(--ease),transform .2s var(--ease)}
.hcg-sw:hover{transform:scale(1.08)}
.hcg-sw.on{box-shadow:0 0 0 2px var(--paper,var(--panel)),0 0 0 3.5px var(--ink)}
.hcg-sw.mod::after{content:"";position:absolute;left:50%;bottom:-6px;width:3px;height:3px;margin-left:-1.5px;border-radius:50%;background:var(--sel)}
.hcg-sw.master{background:conic-gradient(from 90deg,hsl(0 85% 55%),hsl(60 85% 55%),hsl(120 75% 48%),hsl(180 75% 48%),hsl(240 80% 60%),hsl(300 80% 58%),hsl(360 85% 55%))}
.hcg-hsr .sp{flex:1}
.hcg-hsr .hcg-ib{width:26px;height:26px}
.hcg-hsr .hcg-ib.on{background:var(--sel);color:#fff}
.hcg-hsr.dis .hcg-sw:not(.master),.hcg-hsr.dis .hcg-ib{opacity:.35;pointer-events:none}
.hcg-hsn{color:var(--muted);font-size:11px;margin:6px 0 4px;min-height:14px}
.hcg-ck{display:inline-flex;align-items:center;gap:7px;height:28px;margin:4px 0 2px;padding:0 10px 0 8px;border-radius:var(--hy-row-r,var(--r-ctl,8px));color:var(--sub);
  transition:background .18s var(--ease),color .18s var(--ease)}
.hcg-ck:hover{background:var(--raise);color:var(--ink)}
.hcg-ck i{width:14px;height:14px;border-radius:4px;box-shadow:inset 0 0 0 1.5px var(--muted);display:grid;place-items:center;transition:background .2s var(--ease),box-shadow .2s var(--ease)}
.hcg-ck i svg{width:11px;height:11px;color:#fff;opacity:0;transform:scale(.6);transition:opacity .18s var(--ease),transform .25s var(--ease)}
.hcg-ck.on{color:var(--ink)}
.hcg-ck.on i{background:var(--sel);box-shadow:none}
.hcg-ck.on i svg{opacity:1;transform:none}
.hcg-ba{position:relative;margin:8px 0 2px}
.hcg-ba canvas{display:block;width:100%;height:46px;touch-action:none}
.hcg-ba .rd{display:flex;justify-content:space-between;margin-top:3px;color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums;min-height:13px}
.hcg-fade{animation:hcgFade .24s var(--ease)}
@keyframes hcgFade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
`;

  // the panel's icons are the app's (ui/icons.js hyIcon, owner 2026-10-07: «одно значение, одна иконка»): a section by its id, a button by
  // its meaning; Color Grading's section is its three wheels, not the half circle (that is the opacity's)
  const SEC_ICON = { basic: 'rawLight', curve: 'rawCurve', detail: 'rawDetail', mixer: 'rawMixer', hs: 'rawHueSat',   // hy-icon-names
    sc: 'rawSelColor', grading: 'rawGrading', effects: 'rawEffects' };
  const svg = (name, cls, sw) => global.hyIcon ? global.hyIcon(name, 0, sw || 1.8, cls || 'ic') : '';
  const CHEV = global.hyIcon ? global.hyIcon('chevron', 0, 2.4, 'hcg-chev') : '';

  const TRACK = {
    temp: 'linear-gradient(90deg,#2f6fe0,#8fb2e6 35%,#d6d3c8 50%,#e8d27a 65%,#f0b62a)',
    tint: 'linear-gradient(90deg,#34b24a,#9ed29a 35%,#d3d0d3 50%,#dc9ad6 65%,#d23fc4)',
    tone: 'linear-gradient(90deg,#0b0b0d,#55555c 50%,#ececf0)',
    sat: 'linear-gradient(90deg,#7a7a7a,#9a8f86 30%,#e0574a 55%,#f0c33c 70%,#3fbf6a 85%,#3d8ef0)',
    vig: 'linear-gradient(90deg,#0b0b0d,#55555c 50%,#ececf0)',
    rainbow: 'linear-gradient(90deg,hsl(0 80% 55%),hsl(60 80% 55%),hsl(120 80% 50%),hsl(180 80% 50%),hsl(240 80% 60%),hsl(300 80% 55%),hsl(360 80% 55%))'
  };
  const hueTrack = (deg, kind) => {
    if (kind === 'hue') return `linear-gradient(90deg,hsl(${deg - 30} 85% 55%),hsl(${deg} 85% 55%),hsl(${deg + 30} 85% 55%))`;
    if (kind === 'sat') return `linear-gradient(90deg,hsl(${deg} 0% 50%),hsl(${deg} 90% 52%))`;
    return `linear-gradient(90deg,hsl(${deg} 70% 12%),hsl(${deg} 75% 50%),hsl(${deg} 70% 88%))`;
  };

  function injectCSS() {
    if (document.getElementById('hcg-style')) return;
    const st = document.createElement('style');
    st.id = 'hcg-style'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // One rule for every number typed (owner 2026-10-05: «1239px + 10 = 1249px, 100px + 10% = 110px»). A plain number sets the value
  // (50% is a share of base); text that starts with + - * / works on the current value: +10 adds 10, -10 takes 10 away, +10% adds a
  // tenth of it, *2, /2; a whole sum works too: 1239+10, 100+10%, 800/2. An exact negative: 0-10. The old ++5 and = are gone.
  function parseEntry(text, cur, base) {
    if (base == null) base = 100;
    let t = String(text).trim().replace(/\s+/g, '').replace(/,/g, '.').replace(/[−–]/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
    if (!t) return null;
    if (/^[+\-*/]/.test(t)) t = '@' + t;
    const toks = t.match(/@|\d*\.?\d+(?:px|%|°)?|[+\-*/]/g);
    if (!toks || toks.join('') !== t || toks.length % 2 === 0) return null;
    const groups = []; let g = null;
    for (let i = 0; i < toks.length; i += 2) {
      const k = toks[i]; if (/^[+\-*/]$/.test(k)) return null;
      const op = i ? toks[i - 1] : '+', v = k === '@' ? cur : parseFloat(k), pct = k.endsWith('%');
      if (op === '*' || op === '/') { const f = pct ? v / 100 : v; if (op === '/' && !f) return null; g.v = op === '*' ? g.v * f : g.v / f; }
      else if (op === '+' || op === '-') { g = { s: op === '-' ? -1 : 1, v, pct }; groups.push(g); }
      else return null;
    }
    let acc = groups[0].pct ? base * groups[0].v / 100 : groups[0].v;
    for (let i = 1; i < groups.length; i++) { const x = groups[i]; acc += x.s * (x.pct ? acc * x.v / 100 : x.v); }
    return isFinite(acc) ? acc : null;
  }

  function createPanel(container, params, onChange, opts) {
    opts = opts || {};
    injectCSS();
    let state = normalize(params);
    const DEF = defaults();
    // the words of the newer sections through the host's language (opts.t: the board's or the image studio's, lang.js); English without it
    const L = k => { try { return opts.t ? opts.t(k) : k; } catch (e) { return k; } };
    // a shorter word where a row of options has no room for the full one («short::Hue» is «Тон» in Russian; English and a language
    // without it keep the full word)
    const SHORT = new Set(['Hue', 'Selective Color']);   // the words lang.js has a «short::» form of (a title: its full name in the tooltip)
    const Ls = k => { if (!SHORT.has(k)) return L(k); const v = L('short::' + k); return !v || v.includes('short::') ? L(k) : v; };
    const listeners = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); listeners.push(() => t.removeEventListener(ev, fn, o)); };

    const root = el('div', 'hcg');
    // theme 'inherit': the page's own palette and corners (the frame editor's, which are the app's: owner 2026-10-06); otherwise dark,
    // or dark with the given tokens over it
    if (opts.theme !== 'inherit') {
      const theme = opts.theme && typeof opts.theme === 'object' ? Object.assign({}, DARK, opts.theme) : DARK;
      for (const k in theme) root.style.setProperty(k, theme[k]);
    }
    container.appendChild(root);

    // rAF-throttled change notification
    let pending = 0;
    function emit() {
      refreshSections();
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; if (onChange) onChange(clone(state)); });
    }

    const panelApi = {};   // what a section adds to the panel's object (Hue/Saturation: hs.pick, hs.select)
    const controls = [];   // each: {update()}
    const redraws = [];    // canvases that depend on width

    /* -- top bar -- */
    const top = el('div', 'hcg-top');
    const title = el('div', 'hcg-title', opts.title || 'Raw Editor');   // its name in both languages (owner 2026-10-06)
    // the whole grade on and off, its values kept (owner 2026-10-06: the split icon said nothing about it): an eye, open while the grade
    // works, crossed out while it is off; the panel below fades then (.byp). \\ as before
    const baBtn = el('button', 'hcg-ib hcg-eye');
    const pBtn = el('button', 'hcg-pbtn', L('Presets') + CHEV);
    const rBtn = el('button', 'hcg-ib hcg-rall', svg('reset'));
    rBtn.title = L('Reset all');
    top.append(title, pBtn, baBtn, rBtn);
    root.appendChild(top);

    const menu = el('div', 'hcg-menu'); menu.dataset.hymenu = '';
    menu.appendChild(el('div', 'mt', L('Presets')));
    const presetBtns = [];
    // A preset shows on the picture and in the sliders while it is pointed at or reached with ↑ ↓ (owner 2026-10-06: «when I hover the
    // presets they apply at once»): opts.preview(grade) draws it on the picture without changing anything kept, the next item swaps it,
    // leaving the list puts back what was there, closing the menu without a click too (Esc, a click elsewhere). A click keeps it: one
    // change, so one undo step; the hovers are none and nothing is saved for them. Without opts.preview the menu only applies on click
    const pv = presetHover({ current: () => clone(state), apply: g => setState(g, false), preview: (g, keep) => opts.preview(g, keep) });
    function pvShow(name) { if (opts.preview) pv.show(name); }
    // keep: the click's own change follows at once, so the picture is left as it is until then
    function pvEnd(keep) { pv.end(keep); }
    Object.keys(presets).forEach(name => {
      const b = el('button', '', svg('check', 'ck', 2.2) + `<span>${L(name)}</span>`); b.dataset.k = name;   // the words in the page's language, the English name to find it by
      on(b, 'click', () => { pvEnd(true); setState(normalize(presets[name]), true); closeMenu(); emit(); });
      on(b, 'pointerenter', () => pvShow(name)); on(b, 'focus', () => pvShow(name));
      menu.appendChild(b); presetBtns.push([name, b]);
    });
    on(menu, 'pointerleave', () => { if (!menu.contains(document.activeElement)) pvShow(null); });
    // «Clear all» (owner 2026-10-07): the host clears everything applied to its cards, opts.clearAll (the board: HY.props.clear); not a preset
    if (opts.clearAll) { const cb = el('button', 'hcg-mclear', svg('reset', 'ck', 2) + `<span>${L('Clear all')}</span>`); cb.setAttribute('role', 'menuitem');
      on(cb, 'click', () => { closeMenu(); opts.clearAll(); }); menu.append(el('div', 'hcg-msep'), cb); }
    root.appendChild(menu);
    // a closed menu keeps its place (it fades), so its items lose their role: the app's menu keys (ui/menu.js: ↑ ↓ Enter) take only an open one
    const closeMenu = () => { pvEnd(false); menu.classList.remove('open'); pBtn.classList.remove('on'); if (menu.contains(document.activeElement)) document.activeElement.blur(); presetBtns.forEach(([, b]) => b.removeAttribute('role')); };
    // the values without the switches: a preset is checked while the panel holds its values, a section off or not
    const vals = presetVals;
    on(pBtn, 'click', e => {
      e.stopPropagation();
      const cur = vals(state);
      presetBtns.forEach(([n, b]) => b.classList.toggle('cur', vals(presets[n]) === cur));
      const open = !menu.classList.contains('open');
      if (!open) return closeMenu();
      menu.classList.add('open'); pBtn.classList.add('on'); presetBtns.forEach(([, b]) => b.setAttribute('role', 'menuitem'));
    });
    on(document, 'pointerdown', e => { if (!menu.contains(e.target) && e.target !== pBtn && !pBtn.contains(e.target)) closeMenu(); });
    on(rBtn, 'click', () => { setState(defaults(), true); emit(); });

    // the app's eye (ui/icons.js), the same as in the image studio's layer list; a page without it keeps the old split icon
    const EYE = 'eye', EYEOFF = 'eyeoff';
    function eye(b, shown, title) {
      if (b._on !== shown) { b._on = shown; b.innerHTML = svg(shown ? EYE : EYEOFF, 'ic', 1.85); }
      b.title = title; b.setAttribute('aria-label', title); b.setAttribute('aria-pressed', String(!shown));
    }
    // Before (the old split): now the grade switched off, a change of the grade (one step to undo, saved with it)
    function setBefore(b) {
      b = b ? 1 : 0; if (b === state.bypass) return;
      state.bypass = b; emit();
      if (opts.onBeforeAfter) opts.onBeforeAfter(!!b);
    }
    on(baBtn, 'click', () => setBefore(!state.bypass));
    on(window, 'keydown', e => {
      if (e.key === 'Escape' && menu.classList.contains('open')) closeMenu();
      if (e.key !== '\\' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault(); setBefore(!state.bypass);
    });

    const scroll = el('div', 'hcg-scroll');
    root.appendChild(scroll);

    /* -- sections -- */
    const sections = [];
    // Photoshop's eye drag over the sections' eyes (Hyimg's ui/eyedrag.js, owner 2026-10-07): a press switches a section, the sections
    // passed while held take the same state; the host makes the press one step to undo. A click from the keys keeps the eye's own click
    if (global.hyEyeDrag) {
      const secOf = b => sections.find(x => x.ey === b);
      global.hyEyeDrag(scroll, { selector: '.hcg-head .ey', get: b => { const x = secOf(b); return !!x && !state.off[x.id]; },
        set: (b, on) => { const x = secOf(b); if (!x) return; state.off[x.id] = on ? 0 : 1; emit(); } });
    }
    function section(id, name, paths, openByDefault) {
      const shown = Ls(name); name = L(name);   // every word of the panel in the page's language (owner 2026-10-06: «Basic», «Tone» … in Russian)
      const sec = el('section', 'hcg-sec' + (openByDefault ? ' open' : ''));
      sec.dataset.id = id;
      const head = el('div', 'hcg-head', svg(SEC_ICON[id]) + `<span class="t">${shown}</span><span class="dot"></span>`); head.title = name;
      const rs = el('button', 'rs', svg('reset', 'ic', 1.9));
      rs.title = L('Reset') + ' · ' + name;
      // the section's own eye, next to its chevron: off, the section leaves the picture and its values stay (owner 2026-10-06)
      const ey = el('button', 'ey');
      head.append(rs, ey);
      head.insertAdjacentHTML('beforeend', CHEV);
      const body = el('div', 'hcg-body'), inner = el('div', 'hcg-inner'), pad = el('div', 'hcg-pad');
      inner.appendChild(pad); body.appendChild(inner); sec.append(head, body);
      on(head, 'click', e => {
        if (rs.contains(e.target) || ey.contains(e.target)) return;
        sec.classList.toggle('open');
        if (sec.classList.contains('open')) requestAnimationFrame(() => redraws.forEach(f => f()));
      });
      on(rs, 'click', e => {
        e.stopPropagation();
        paths.forEach(p => setPath(state, p, clone(getPath(DEF, p))));
        refreshAll(true); emit();
      });
      on(ey, 'click', e => { e.stopPropagation(); state.off[id] = state.off[id] ? 0 : 1; emit(); });
      scroll.appendChild(sec);
      sections.push({ sec, paths, id, ey, name });
      return pad;
    }
    function refreshSections() {
      root.classList.toggle('byp', !!state.bypass);
      eye(baBtn, !state.bypass, (state.bypass ? L('Turn on') : L('Turn off')) + ' · \\');
      sections.forEach(({ sec, paths, id, ey, name }) => {
        sec.classList.toggle('mod', paths.some(p => JSON.stringify(getPath(state, p)) !== JSON.stringify(getPath(DEF, p))));
        const off = !!state.off[id]; sec.classList.toggle('off', off);
        eye(ey, !off, (off ? L('Turn on') : L('Turn off')) + ' ' + name);
      });
    }

    /* -- slider: the app's one slider (ui/slider.js, owner 2026-10-06: sliders must be the same everywhere, as in 3D) -- */
    function slider(parent, o) {
      // o: {path, label, min, max, step, dec, track}; the label is inside the slider, the number at its right (a click on it types: parseEntry's rule),
      // a double click puts the default back, a signed range fills from zero, a colour track (o.track) shows its colours along the bottom edge
      if (!global.hySlider) throw new Error('HyColorGrade needs the app\'s slider: <script src="/ui/slider.js">');
      const def = getPath(DEF, o.path);
      const step = o.step || 1, dec = o.dec || 0;
      const centered = o.min < 0 && o.max > 0;
      const row = el('div', 'hcg-row');
      const w = el('div', 'hy-slider' + (o.track ? ' grad' : ''));
      const lab = L(o.label);   // the words in the page's language; data-k keeps the English name (the tests, an agent's selector)
      const inp = el('input'); inp.type = 'range'; inp.min = o.min; inp.max = o.max; inp.step = step; inp.setAttribute('aria-label', lab); inp.dataset.k = o.label;
      const num = el('output', 'hy-slider-v');
      num.title = L('Type a value: 10 sets it; +10 adds, -10 takes away, +10% adds a tenth, *2, /2; 1239+10 works too; an exact negative: 0-10');
      w.append(inp, el('span', 'hy-slider-l', lab), num);
      if (centered) w.dataset.center = '0';
      w.dataset.reset = String(def);
      if (o.track) w.style.setProperty('--hy-sl-grad', o.track);
      row.appendChild(w);
      parent.appendChild(row);

      const get = () => getPath(state, o.path);
      const fmt = v => {
        const s = (+v).toFixed(dec);
        return centered && v > 0 ? '+' + s : (Math.abs(v) < Math.pow(10, -dec) / 2 ? (0).toFixed(dec) : s);
      };
      const quant = v => {
        v = Math.min(o.max, Math.max(o.min, v));
        v = Math.round(v / step) * step;
        return +v.toFixed(dec + 2);
      };
      const sl = global.hySlider.mount(w);
      sl.format = fmt;
      sl.parse = (text, cur) => { const v = parseEntry(text, cur); return v == null ? NaN : v; };
      function update() { inp.value = String(get()); sl.paint(); }
      on(inp, 'input', () => {
        const v = quant(+inp.value);
        if (v === get()) return;
        setPath(state, o.path, v);
        emit();
        if (o.onSet) o.onSet(v);
      });
      const ctl = { update, row: w };
      controls.push(ctl);
      update();
      return ctl;
    }

    function sub(parent, text) { parent.appendChild(el('div', 'hcg-sub', L(text))); }

    function segmented(parent, items, cur, onPick) {
      const seg = el('div', 'hcg-seg');
      // [id, label, swatch, dotOnly]: a dot alone says its channel by its colour, the words in its tooltip (as Lightroom's curve channels)
      const btns = items.map(([id, label, sw, dot]) => {
        const b = el('button', (id === cur ? 'on' : '') + (dot ? ' dot' : ''), (sw ? `<span class="sw" style="background:${sw}"></span>` : '') + (dot ? '' : Ls(label)));
        b.dataset.k = label; b.title = L(label); b.setAttribute('aria-label', L(label));
        on(b, 'click', () => { btns.forEach(x => x.classList.toggle('on', x === b)); onPick(id); });
        seg.appendChild(b);
        return b;
      });
      parent.appendChild(seg);
      return seg;
    }

    /* ===== Basic ===== */
    {
      const pad = section('basic', 'Basic', SECTION_PATHS.basic, true);
      sub(pad, 'White Balance');
      slider(pad, { path: 'temp', label: 'Temp', min: -100, max: 100, track: TRACK.temp });
      slider(pad, { path: 'tint', label: 'Tint', min: -100, max: 100, track: TRACK.tint });
      sub(pad, 'Tone');
      slider(pad, { path: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01, dec: 2, track: TRACK.tone });
      slider(pad, { path: 'contrast', label: 'Contrast', min: -100, max: 100, track: TRACK.tone });
      slider(pad, { path: 'highlights', label: 'Highlights', min: -100, max: 100, track: TRACK.tone });
      slider(pad, { path: 'shadows', label: 'Shadows', min: -100, max: 100, track: TRACK.tone });
      slider(pad, { path: 'whites', label: 'Whites', min: -100, max: 100, track: TRACK.tone });
      slider(pad, { path: 'blacks', label: 'Blacks', min: -100, max: 100, track: TRACK.tone });
      sub(pad, 'Presence');
      slider(pad, { path: 'texture', label: 'Texture', min: -100, max: 100 });
      slider(pad, { path: 'clarity', label: 'Clarity', min: -100, max: 100 });
      slider(pad, { path: 'dehaze', label: 'Dehaze', min: -100, max: 100 });
      slider(pad, { path: 'vibrance', label: 'Vibrance', min: -100, max: 100, track: TRACK.sat });
      slider(pad, { path: 'saturation', label: 'Saturation', min: -100, max: 100, track: TRACK.sat });
    }

    /* ===== Curve ===== */
    let histo = null, setHistoHook = () => {};
    {
      const pad = section('curve', 'Curve', SECTION_PATHS.curve, false);
      let mode = 'rgb';
      segmented(pad, [['param', 'Parametric'], ['rgb', 'RGB', '#e4e4e7'], ['red', 'Red', '#ef4444', 1], ['green', 'Green', '#22c55e', 1], ['blue', 'Blue', '#3b82f6', 1]],
        mode, m => { mode = m; layout(); draw(); });
      const wrap = el('div', 'hcg-cv');
      const cv = el('canvas');
      const readout = el('div', 'hcg-readout');
      wrap.append(cv, readout);
      pad.appendChild(wrap);
      const hint = el('div', 'hcg-hint', L('Click to add a point, drag it off the grid to remove'));
      pad.appendChild(hint);
      const pbox = el('div');
      pad.appendChild(pbox);
      // parametric controls
      const splitEl = el('div', 'hcg-split');
      splitEl.appendChild(el('div', 'hcg-rail'));
      const knobs = [0, 1, 2].map(() => { const k = el('div', 'k'); splitEl.appendChild(k); return k; });
      pbox.appendChild(splitEl);
      const pctl = [];
      pctl.push(slider(pbox, { path: 'curve.highlights', label: 'Highlights', min: -100, max: 100, onSet: () => draw() }));
      pctl.push(slider(pbox, { path: 'curve.lights', label: 'Lights', min: -100, max: 100, onSet: () => draw() }));
      pctl.push(slider(pbox, { path: 'curve.darks', label: 'Darks', min: -100, max: 100, onSet: () => draw() }));
      pctl.push(slider(pbox, { path: 'curve.shadows', label: 'Shadows', min: -100, max: 100, onSet: () => draw() }));

      function layoutSplits() { state.curve.splits.forEach((v, i) => { knobs[i].style.left = v + '%'; }); }
      let sdrag = -1;
      on(splitEl, 'pointerdown', e => {
        const r = splitEl.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 100;
        let best = 0;
        state.curve.splits.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(state.curve.splits[best] - x)) best = i; });
        sdrag = best; knobs[best].classList.add('drag');
        splitEl.setPointerCapture(e.pointerId);
        moveSplit(e);
      });
      function moveSplit(e) {
        if (sdrag < 0) return;
        const r = splitEl.getBoundingClientRect();
        const s = state.curve.splits.slice();
        const lo = sdrag === 0 ? 5 : s[sdrag - 1] + 5, hi = sdrag === 2 ? 95 : s[sdrag + 1] - 5;
        s[sdrag] = Math.round(Math.min(hi, Math.max(lo, (e.clientX - r.left) / r.width * 100)));
        if (s[sdrag] !== state.curve.splits[sdrag]) { state.curve.splits = s; layoutSplits(); draw(); emit(); }
      }
      on(splitEl, 'pointermove', moveSplit);
      const sEnd = () => { if (sdrag >= 0) knobs[sdrag].classList.remove('drag'); sdrag = -1; };
      on(splitEl, 'pointerup', sEnd); on(splitEl, 'pointercancel', sEnd);
      on(splitEl, 'dblclick', () => { state.curve.splits = [25, 50, 75]; layoutSplits(); draw(); emit(); });
      splitEl.title = L('Region splits (double-click to reset)');

      function layout() {
        const isP = mode === 'param';
        pbox.style.display = isP ? '' : 'none';
        hint.style.display = isP ? 'none' : '';
        wrap.classList.add('hcg-fade'); setTimeout(() => wrap.classList.remove('hcg-fade'), 260);
      }
      layout();

      const COL = { rgb: '#f4f4f5', red: '#f87171', green: '#4ade80', blue: '#60a5fa', param: '#f4f4f5' };
      let W = 0, dpr = 1, active = -1, hover = -1, removing = false;
      const PADX = 0; // curve fills the canvas
      function size() {
        const w = Math.round(wrap.clientWidth || 272);
        if (!w) return false;
        dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        if (W !== w || cv.width !== Math.round(w * dpr)) {
          W = w; cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr); cv.style.height = w + 'px';
        }
        return true;
      }
      const toPx = (x, y) => [PADX + x / 255 * (W - 2 * PADX), W - PADX - y / 255 * (W - 2 * PADX)];
      const fromPx = (px, py) => [(px - PADX) / (W - 2 * PADX) * 255, (W - PADX - py) / (W - 2 * PADX) * 255];
      function curveFn() {
        if (mode === 'param') { const f = parametricFn(state.curve); return x => Math.min(255, Math.max(0, f(x / 255) * 255)); }
        return monotoneSpline(state.curve[mode]);
      }
      function draw() {
        if (!size()) return;
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const cs = getComputedStyle(root), ink = cs.getPropertyValue('--ink').trim() || '#f4f4f5';
        COL.rgb = COL.param = ink;   // the neutral curve in the ink of the page's theme (white on the dark panel, near black on the light one)
        ctx.fillStyle = cs.getPropertyValue('--panel'); ctx.fillRect(0, 0, W, W);
        // histogram
        if (histo) {
          const chans = mode === 'red' ? [['r', 'rgba(248,113,113,.35)']] : mode === 'green' ? [['g', 'rgba(74,222,128,.32)']] : mode === 'blue' ? [['b', 'rgba(96,165,250,.38)']] :
            [['l', ink]];
          chans.forEach(([k, col]) => {
            const a = histo[k];
            ctx.beginPath(); ctx.moveTo(0, W);
            for (let i = 0; i < 256; i++) ctx.lineTo(i / 255 * W, W - a[i] * W * 0.62);
            ctx.lineTo(W, W); ctx.closePath(); ctx.fillStyle = col; if (k === 'l') ctx.globalAlpha = .13; ctx.fill(); ctx.globalAlpha = 1;
          });
        }
        // grid
        ctx.strokeStyle = cs.getPropertyValue('--line'); ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 4; i++) { const g = Math.round(i * W / 4) + 0.5; ctx.moveTo(g, 0); ctx.lineTo(g, W); ctx.moveTo(0, g); ctx.lineTo(W, g); }
        ctx.stroke();
        if (mode === 'param') {
          ctx.fillStyle = ink; ctx.globalAlpha = .035;
          const s = state.curve.splits;
          [[0, s[0]], [s[1], s[2]]].forEach(([a, b]) => ctx.fillRect(a / 100 * W, 0, (b - a) / 100 * W, W)); ctx.globalAlpha = 1;
        }
        // diagonal
        ctx.strokeStyle = ink; ctx.globalAlpha = .14; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(0, W); ctx.lineTo(W, 0); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        // other channels' curves faintly when on RGB
        if (mode === 'rgb') {
          ['red', 'green', 'blue'].forEach(ch => {
            if (isIdentityCurve(state.curve[ch])) return;
            const f = monotoneSpline(state.curve[ch]);
            ctx.strokeStyle = COL[ch]; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.2; ctx.beginPath();
            for (let i = 0; i <= W; i++) { const [px, py] = toPx(i / W * 255, f(i / W * 255)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
            ctx.stroke(); ctx.globalAlpha = 1;
          });
        }
        // curve
        const f = curveFn();
        ctx.strokeStyle = COL[mode]; ctx.lineWidth = 1.6; ctx.beginPath();
        for (let i = 0; i <= W; i++) { const x = i / W * 255; const [px, py] = toPx(x, Math.min(255, Math.max(0, f(x)))); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.stroke();
        // points
        if (mode !== 'param') {
          state.curve[mode].forEach((p, i) => {
            if (removing && i === active) return;
            const [px, py] = toPx(p[0], p[1]);
            ctx.beginPath(); ctx.arc(Math.min(W - 5, Math.max(5, px)), Math.min(W - 5, Math.max(5, py)), i === active ? 5 : 4, 0, Math.PI * 2);
            ctx.fillStyle = i === active || i === hover ? COL[mode] : cs.getPropertyValue('--panel');
            ctx.fill(); ctx.strokeStyle = COL[mode]; ctx.lineWidth = 1.5; ctx.stroke();
          });
        }
      }
      redraws.push(draw);
      function hit(px, py) {
        let best = -1, bd = 10;
        state.curve[mode].forEach((p, i) => { const [x, y] = toPx(p[0], p[1]); const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = i; } });
        return best;
      }
      function local(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r]; }
      function showReadout(p) {
        if (!p) { wrap.classList.remove('show'); return; }
        readout.textContent = removing ? L('Release to remove point') : `${L('Input')} ${Math.round(p[0])}  ·  ${L('Output')} ${Math.round(p[1])}`;
        wrap.classList.add('show');
      }
      on(cv, 'pointerdown', e => {
        if (mode === 'param' || e.button !== 0) return;
        e.preventDefault();
        const [px, py] = local(e);
        let i = hit(px, py);
        const pts = state.curve[mode];
        if (i < 0) {
          const [x] = fromPx(px, py);
          const xi = Math.round(Math.min(254, Math.max(1, x)));
          if (pts.some(p => Math.abs(p[0] - xi) < 3)) return;
          const y = Math.round(Math.min(255, Math.max(0, monotoneSpline(pts)(xi))));
          pts.push([xi, y]); pts.sort((a, b) => a[0] - b[0]);
          i = pts.findIndex(p => p[0] === xi);
          emit();
        }
        active = i; removing = false;
        cv.setPointerCapture(e.pointerId);
        showReadout(pts[i]); draw();
      });
      on(cv, 'pointermove', e => {
        if (mode === 'param') return;
        const [px, py, r] = local(e);
        const pts = state.curve[mode];
        if (active < 0) {
          const h = hit(px, py);
          if (h !== hover) { hover = h; draw(); }
          cv.style.cursor = h >= 0 ? 'grab' : 'crosshair';
          return;
        }
        const n = pts.length, isEnd = active === 0 || active === n - 1;
        const out = px < -18 || py < -18 || px > r.width + 18 || py > r.height + 18;
        removing = !isEnd && out && n > 2;
        let [x, y] = fromPx(px, py);
        const lo = active === 0 ? 0 : pts[active - 1][0] + 1, hi = active === n - 1 ? 255 : pts[active + 1][0] - 1;
        x = Math.round(Math.min(hi, Math.max(lo, x)));
        y = Math.round(Math.min(255, Math.max(0, y)));
        if (!removing && (pts[active][0] !== x || pts[active][1] !== y)) { pts[active] = [x, y]; emit(); }
        showReadout(pts[active]); draw();
      });
      const cEnd = () => {
        if (active < 0) return;
        if (removing) { state.curve[mode].splice(active, 1); emit(); }
        active = -1; removing = false; showReadout(null); draw();
      };
      on(cv, 'pointerup', cEnd); on(cv, 'pointercancel', cEnd);
      on(cv, 'pointerleave', () => { if (active < 0 && hover >= 0) { hover = -1; draw(); } });
      on(cv, 'dblclick', e => {
        if (mode === 'param') return;
        const [px, py] = local(e);
        const i = hit(px, py), pts = state.curve[mode];
        if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); emit(); draw(); }
      });
      controls.push({ update() { layoutSplits(); draw(); } });
      layoutSplits();
      setHistoHook = h => { histo = h; draw(); };
    }

    /* ===== Detail ===== */
    {
      const pad = section('detail', 'Detail', SECTION_PATHS.detail, false);
      slider(pad, { path: 'sharpening', label: 'Sharpening', min: 0, max: 150 });
      slider(pad, { path: 'sharpenRadius', label: 'Radius', min: 0.5, max: 3, step: 0.1, dec: 1 });
      slider(pad, { path: 'noiseReduction', label: 'Noise Reduction', min: 0, max: 100 });
    }

    /* ===== Color Mixer ===== */
    {
      const pad = section('mixer', 'Color Mixer', SECTION_PATHS.mixer, false);
      let mode = 'hue';
      segmented(pad, [['hue', 'Hue'], ['sat', 'Saturation'], ['lum', 'Luminance'], ['all', 'All']], mode, m => { mode = m; build(); });
      const box = el('div');
      pad.appendChild(box);
      const built = [];
      function group(kind, withSub) {
        if (withSub) sub(box, kind === 'hue' ? 'Hue' : kind === 'sat' ? 'Saturation' : 'Luminance');
        HUES.forEach(h => built.push(slider(box, { path: `hsl.${h}.${kind}`, label: HUE_LABEL[h], min: -100, max: 100, track: hueTrack(HUE_DEG[h], kind) })));
      }
      function build() {
        built.forEach(c => { const i = controls.indexOf(c); if (i >= 0) controls.splice(i, 1); });
        built.length = 0;
        box.innerHTML = '';
        if (mode === 'all') { group('hue', true); group('sat', true); group('lum', true); }
        else group(mode, false);
        box.classList.add('hcg-fade'); setTimeout(() => box.classList.remove('hcg-fade'), 260);
      }
      build();
    }

    /* ===== Hue/Saturation (Photoshop's, owner 2026-10-06) ===== */
    {
      const pad = section('hs', 'Hue/Saturation', SECTION_PATHS.hs, false);
      const RCOL = { reds: 'hsl(0 85% 55%)', yellows: 'hsl(55 90% 52%)', greens: 'hsl(120 70% 45%)', cyans: 'hsl(185 80% 48%)', blues: 'hsl(230 85% 60%)', magentas: 'hsl(300 75% 56%)' };
      const RNAME = { master: 'Master', reds: 'Reds', yellows: 'Yellows', greens: 'Greens', cyans: 'Cyans', blues: 'Blues', magentas: 'Magentas' };
      let cur = 'master';   // the range being edited: Photoshop's «Edit» list as swatches
      const H = () => state.hs, R = k => H()[k];
      const centreOf = k => { const r = hsRange(R(k).r); return (r[1] + r[2]) / 2; };
      const wrap = v => ((Math.round(v) % 360) + 360) % 360;

      // Preset: Photoshop's list of Hue/Saturation presets, only the hs part of the grade changes
      const prow = el('div', 'hcg-hsp');
      const pbtn = el('button', 'hcg-sel', '<span></span>' + CHEV);
      prow.append(el('span', 'l', L('Preset')), pbtn);
      pad.appendChild(prow);
      const pmenu = el('div', 'hcg-hsm');
      root.appendChild(pmenu);
      const hsOf = name => { const d = hsDefaults(); const n = normalize({ hs: mergeInto(d, hsPresets[name]) }).hs; return n; };
      const presetName = () => { const c = JSON.stringify(H()); return Object.keys(hsPresets).find(n => JSON.stringify(hsOf(n)) === c) || null; };
      const nameP = () => { pbtn.querySelector('span').textContent = L(presetName() || 'Custom'); };
      Object.keys(hsPresets).forEach(name => {
        const b = el('button', '', svg('check', 'ck', 2.2) + `<span>${L(name)}</span>`); b.dataset.name = name;
        on(b, 'click', () => { state.hs = hsOf(name); closeP(); syncHs(true); emit(); });
        pmenu.appendChild(b);
      });
      const closeP = () => { pmenu.classList.remove('open'); pbtn.classList.remove('on'); };
      on(pbtn, 'click', e => {
        e.stopPropagation();
        const open = !pmenu.classList.contains('open');
        if (open) {
          const rr = root.getBoundingClientRect(), br = pbtn.getBoundingClientRect(), cn = presetName();
          pmenu.style.left = (br.left - rr.left) + 'px'; pmenu.style.top = (br.bottom - rr.top + 4) + 'px'; pmenu.style.minWidth = br.width + 'px';
          pmenu.querySelectorAll('button').forEach(b => b.classList.toggle('cur', b.dataset.name === cn));
        }
        pmenu.classList.toggle('open', open); pbtn.classList.toggle('on', open);
      });
      on(document, 'pointerdown', e => { if (!pmenu.contains(e.target) && !pbtn.contains(e.target)) closeP(); });

      // the range row: Master (the colour wheel) and the six ranges, the three eyedroppers at its right
      const rrow = el('div', 'hcg-hsr');
      const sws = {};
      ['master', ...HS_RANGES].forEach(k => {
        const b = el('button', 'hcg-sw' + (k === 'master' ? ' master' : ''));
        if (k !== 'master') b.style.background = RCOL[k];
        b.title = L(RNAME[k]); b.setAttribute('aria-label', L(RNAME[k]));
        on(b, 'click', () => { cur = k; syncHs(); });
        rrow.appendChild(b); sws[k] = b;
      });
      rrow.appendChild(el('span', 'sp'));
      const picks = {};
      [['set', 'eyedropper', 'Select a colour range on the image'], ['add', 'eyedropperAdd', 'Add to the colour range'], ['sub', 'eyedropperSub', 'Subtract from the colour range']].forEach(([m, ic, tip]) => {
        const b = el('button', 'hcg-ib', svg(ic, 'ic', 1.8)); b.title = L(tip); b.setAttribute('aria-label', L(tip)); b.dataset.pick = m;
        on(b, 'click', () => startPick(m));
        rrow.appendChild(b); picks[m] = b;
        if (!opts.pick) b.style.display = 'none';   // a host that cannot sample its picture has no eyedroppers
      });
      pad.appendChild(rrow);
      const rname = el('div', 'hcg-hsn');
      pad.appendChild(rname);

      // the sliders: the app's one slider; their range and colour track follow the edited range and Colorize
      const hsCtl = [];
      function hsSlider(o) {
        const row = el('div', 'hcg-row'), w = el('div', 'hy-slider grad'), inp = el('input'); inp.type = 'range'; inp.step = 1;
        const num = el('output', 'hy-slider-v'), lab = el('span', 'hy-slider-l', o.label);
        num.title = L('Type a value: 10 sets it; +10 adds, -10 takes away, +10% adds a tenth, *2, /2; 1239+10 works too; an exact negative: 0-10');
        inp.setAttribute('aria-label', o.label); w.dataset.hs = o.key;
        w.append(inp, lab, num); row.appendChild(w); pad.appendChild(row);
        const sl = global.hySlider.mount(w);
        sl.format = v => { const c = w.dataset.center != null; return c && v > 0 ? '+' + Math.round(v) : String(Math.round(v)); };
        sl.parse = (text, c) => { const v = parseEntry(text, c); return v == null ? NaN : v; };
        function update() {
          const [mn, mx, def, signed] = o.range();
          inp.min = mn; inp.max = mx; if (signed) w.dataset.center = '0'; else delete w.dataset.center;
          w.dataset.reset = String(def); w.style.setProperty('--hy-sl-grad', o.track());
          inp.value = String(o.get()); sl.paint();
        }
        on(inp, 'input', () => { const [mn, mx] = o.range(), v = Math.min(mx, Math.max(mn, Math.round(+inp.value))); if (v === o.get()) return; o.set(v); emit(); drawBA(); markSw(); nameP(); });
        const ctl = { update, row: w }; hsCtl.push(ctl); return ctl;
      }
      const isCol = () => !!H().colorize;
      const hueAt = deg => `hsl(${deg} 85% 52%)`;
      const spectrum = (from, to) => `linear-gradient(90deg,${[0, 1, 2, 3, 4, 5, 6].map(i => hueAt(from + (to - from) * i / 6)).join(',')})`;
      const cHue = () => (cur === 'master' ? 0 : centreOf(cur));
      hsSlider({ key: 'hue', label: L('Hue'), get: () => isCol() ? H().ch : R(cur).hue, set: v => { if (isCol()) H().ch = v; else R(cur).hue = v; },
        range: () => isCol() ? [0, 360, 0, false] : [-180, 180, 0, true], track: () => isCol() ? spectrum(0, 360) : spectrum(cHue() - 180, cHue() + 180) });
      hsSlider({ key: 'sat', label: L('Saturation'), get: () => isCol() ? H().cs : R(cur).sat, set: v => { if (isCol()) H().cs = v; else R(cur).sat = v; },
        range: () => isCol() ? [0, 100, 25, false] : [-100, 100, 0, true],
        track: () => isCol() ? `linear-gradient(90deg,hsl(${H().ch} 0% 50%),hsl(${H().ch} 90% 50%))` : cur === 'master' ? TRACK.sat : `linear-gradient(90deg,hsl(${cHue()} 0% 50%),hsl(${cHue()} 90% 52%))` });
      hsSlider({ key: 'light', label: L('Lightness'), get: () => isCol() ? H().cl : R(cur).light, set: v => { if (isCol()) H().cl = v; else R(cur).light = v; },
        range: () => [-100, 100, 0, true], track: () => `linear-gradient(90deg,#000,${isCol() ? `hsl(${H().ch} ${H().cs}% 50%)` : cur === 'master' ? '#808080' : `hsl(${cHue()} 85% 50%)`},#fff)` });

      // Colorize: one hue for the whole picture (Photoshop starts it at Saturation 25)
      const ck = el('button', 'hcg-ck', `<i>${svg('check', 'ic', 2.4)}</i><span>${L('Colorize')}</span>`);
      on(ck, 'click', () => { H().colorize = H().colorize ? 0 : 1; if (H().colorize) cur = 'master'; syncHs(true); emit(); });
      pad.appendChild(ck);

      // Before-After: the spectrum as it is and as it comes out, the edited range's marks between them (inner range and falloff,
      // dragged as in Photoshop: the inner bar's ends, the outer marks, the middle moves it all; a double click puts the range back)
      const ba = el('div', 'hcg-ba'), bcv = el('canvas'), rd = el('div', 'rd', '<span></span><span></span>');
      ba.append(bcv, rd); pad.appendChild(ba);
      ba.title = L('Drag the marks: between the inner ones the full effect, out to the outer ones it fades; double-click puts the range back');
      let BW = 0, bdpr = 1, drag = null;
      const lo = () => drag ? drag.lo : cur === 'master' ? 0 : centreOf(cur) - 180;
      const xOf = deg => (deg - lo()) / 360 * BW;
      function drawBA() {
        const w = Math.round(ba.clientWidth || 0); if (!w) return;
        bdpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        if (BW !== w || bcv.width !== Math.round(w * bdpr)) { BW = w; bcv.width = Math.round(w * bdpr); bcv.height = Math.round(46 * bdpr); }
        const ctx = bcv.getContext('2d'); ctx.setTransform(bdpr, 0, 0, bdpr, 0, 0); ctx.clearRect(0, 0, BW, 46);
        const cs = getComputedStyle(root), ink = cs.getPropertyValue('--ink').trim() || '#fafafa', l0 = lo(), hs = normalize({ hs: H() }).hs;
        for (let x = 0; x < BW; x++) {
          const deg = l0 + (x + 0.5) / BW * 360, c = hsl2rgb(deg, 1, 0.5), o = hsApply(c, hs);
          ctx.fillStyle = `rgb(${c.map(v => Math.round(v * 255)).join(',')})`; ctx.fillRect(x, 0, 1, 10);
          ctx.fillStyle = `rgb(${o.map(v => Math.round(v * 255)).join(',')})`; ctx.fillRect(x, 36, 1, 10);
        }
        const [s0, s1] = rd.children;
        if (cur === 'master' || isCol()) { s0.textContent = ''; s1.textContent = ''; return; }
        const r = hsRange(R(cur).r), [xa, xb, xc, xd] = r.map(xOf);
        ctx.globalAlpha = .22; ctx.fillStyle = ink; ctx.fillRect(xa, 18, xb - xa, 10); ctx.fillRect(xc, 18, xd - xc, 10);
        ctx.globalAlpha = .55; ctx.fillRect(xb, 18, xc - xb, 10); ctx.globalAlpha = 1;
        ctx.fillStyle = ink;
        [xb, xc].forEach(x => ctx.fillRect(Math.round(x) - 1.5, 14, 3, 18));
        [xa, xd].forEach(x => { ctx.beginPath(); ctx.moveTo(x, 28); ctx.lineTo(x - 4.5, 33); ctx.lineTo(x + 4.5, 33); ctx.closePath(); ctx.fill(); });
        s0.textContent = `${wrap(r[0])}°/${wrap(r[1])}°`; s1.textContent = `${wrap(r[2])}° \\ ${wrap(r[3])}°`;
      }
      redraws.push(drawBA);
      function hitBA(x) {
        if (cur === 'master' || isCol()) return null;
        const r = hsRange(R(cur).r), xs = r.map(xOf);
        let best = null, bd = 8;
        [1, 2, 0, 3].forEach(i => { const d = Math.abs(xs[i] - x); if (d < bd) { bd = d; best = i; } });
        if (best != null) return best;
        return x > xs[0] && x < xs[3] ? 'all' : null;
      }
      on(bcv, 'pointermove', e => { if (drag) return; const h = hitBA(e.clientX - bcv.getBoundingClientRect().left); bcv.style.cursor = h == null ? 'default' : h === 'all' ? 'grab' : 'ew-resize'; });
      on(bcv, 'pointerdown', e => {
        if (e.button !== 0) return;
        const x = e.clientX - bcv.getBoundingClientRect().left, h = hitBA(x); if (h == null) return;
        e.preventDefault(); bcv.setPointerCapture(e.pointerId);
        drag = { h, x, r0: hsRange(R(cur).r), lo: lo() };
        if (h === 'all') bcv.style.cursor = 'grabbing';
      });
      on(bcv, 'pointermove', e => {
        if (!drag) return;
        const d = Math.round((e.clientX - bcv.getBoundingClientRect().left - drag.x) / (BW || 1) * 360), r = drag.r0.slice();
        if (drag.h === 'all') for (let i = 0; i < 4; i++) r[i] += d;
        else {
          const i = drag.h; r[i] += d;
          if (i === 0) r[0] = Math.min(r[1], Math.max(r[3] - 359, r[0]));
          if (i === 3) r[3] = Math.max(r[2], Math.min(r[0] + 359, r[3]));
          if (i === 1) { r[1] = Math.min(r[2], Math.max(r[0], r[1])); }
          if (i === 2) { r[2] = Math.max(r[1], Math.min(r[3], r[2])); }
        }
        if (JSON.stringify(r) !== JSON.stringify(R(cur).r)) { R(cur).r = r; drawBA(); emit(); hsCtl.forEach(c => c.update()); markSw(); nameP(); }
      });
      const endBA = () => { if (!drag) return; drag = null; normRange(cur); bcv.style.cursor = ''; drawBA(); };
      on(bcv, 'pointerup', endBA); on(bcv, 'pointercancel', endBA);
      on(bcv, 'dblclick', () => { if (cur === 'master' || isCol()) return; R(cur).r = DEF.hs[cur].r.slice(); syncHs(); emit(); });
      // a range moved a whole turn round is the same range: its centre is kept within the circle
      function normRange(k) { const r = hsRange(R(k).r), m = (r[1] + r[2]) / 2, t = Math.floor(m / 360) * 360; if (t) R(k).r = r.map(v => v - t); else R(k).r = r; }

      // the eyedroppers: a click on the picture (the host samples it: opts.pick) picks the range (Master picks the nearest one, as in
      // Photoshop), + widens the inner range to the colour, − narrows it to leave the colour out
      let picking = null;
      function startPick(mode) {
        if (picking) { const was = picking.mode; stopPick(); if (was === mode) return; }
        if (!opts.pick) return;
        picks[mode].classList.add('on');
        picking = { mode, cancel: null };
        const cancel = opts.pick(rgb => { const m = picking && picking.mode; stopPick(true); if (rgb && m) applyPick(rgb, m); });
        if (picking) picking.cancel = cancel;
      }
      function stopPick(quiet) {
        if (!picking) return; const p = picking; picking = null;
        Object.values(picks).forEach(b => b.classList.remove('on'));
        if (!quiet && typeof p.cancel === 'function') p.cancel();
      }
      on(window, 'keydown', e => { if (picking && e.key === 'Escape') stopPick(); });
      function applyPick(rgb, mode) {
        if (isCol()) return;
        const [h, s] = rgb2hsl(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); if (!(s > 0)) return;   // a grey has no hue: no range to take
        const dist = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
        if (cur === 'master') cur = HS_RANGES.reduce((best, k) => dist(h, centreOf(k)) < dist(h, centreOf(best)) ? k : best, HS_RANGES[0]);
        const r = hsRange(R(cur).r), m = (r[1] + r[2]) / 2, hh = Math.round(m + ((h - m) % 360 + 540) % 360 - 180);
        if (mode === 'set') { const d = hh - Math.round(m); for (let i = 0; i < 4; i++) r[i] += d; }
        else if (mode === 'add') {
          if (hh < r[1]) { const f = r[1] - r[0]; r[1] = hh; r[0] = Math.max(r[3] - 359, hh - f); }
          else if (hh > r[2]) { const f = r[3] - r[2]; r[2] = hh; r[3] = Math.min(r[0] + 359, hh + f); }
        } else if (mode === 'sub') {
          if (hh >= r[1] && hh <= r[2]) { if (hh - r[1] <= r[2] - hh) { const f = r[1] - r[0]; r[1] = Math.min(r[2], hh + 1); r[0] = r[1] - f; } else { const f = r[3] - r[2]; r[2] = Math.max(r[1], hh - 1); r[3] = r[2] + f; } }
          else if (hh >= r[0] && hh < r[1]) r[0] = Math.min(r[1], hh + 1);
          else if (hh > r[2] && hh <= r[3]) r[3] = Math.max(r[2], hh - 1);
        }
        R(cur).r = r; normRange(cur); syncHs(); emit();
      }

      function markSw() { HS_RANGES.forEach(k => sws[k].classList.toggle('mod', !!(R(k).hue || R(k).sat || R(k).light) || JSON.stringify(R(k).r) !== JSON.stringify(DEF.hs[k].r))); }
      function syncHs(animate) {
        if (isCol()) cur = 'master';
        Object.entries(sws).forEach(([k, b]) => b.classList.toggle('on', k === cur));
        rrow.classList.toggle('dis', isCol());
        ck.classList.toggle('on', isCol());
        nameP();
        rname.textContent = isCol() ? L('Colorize') : L(RNAME[cur]);
        hsCtl.forEach(c => { if (animate) { c.row.classList.add('jump'); setTimeout(() => c.row.classList.remove('jump'), 260); } c.update(); });
        markSw(); drawBA();
      }
      controls.push({ update: () => syncHs() });
      syncHs();
      panelApi.hs = { pick: (rgb, mode) => applyPick(rgb, mode || 'set'), select: k => { cur = k in sws ? k : 'master'; syncHs(); }, get range() { return cur; }, stopPick };
    }
    panelApi.sc = SC.section({ section, segmented, el, on, L, emit, controls, parseEntry, state: () => state });   // Selective Color (selcolor.js)

    /* ===== Color Grading ===== */
    {
      const pad = section('grading', 'Color Grading', SECTION_PATHS.grading, false);
      let mode = '3way';
      segmented(pad, [['3way', '3-Way'], ['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights'], ['global', 'Global']], mode, m => { mode = m; build(); });
      const box = el('div');
      pad.appendChild(box);
      const tail = el('div');
      pad.appendChild(tail);
      slider(tail, { path: 'grading.blending', label: 'Blending', min: 0, max: 100 });
      slider(tail, { path: 'grading.balance', label: 'Balance', min: -100, max: 100, track: TRACK.tone });
      const built = [];
      const ZN = { shadows: 'Shadows', midtones: 'Midtones', highlights: 'Highlights', global: 'Global' };

      const wheelCache = {};
      function wheelImage(S, dpr) {
        const key = S + '@' + dpr;
        if (wheelCache[key]) return wheelCache[key];
        const n = Math.round(S * dpr), c = document.createElement('canvas');
        c.width = c.height = n;
        const ctx = c.getContext('2d'), img = ctx.createImageData(n, n), R = n / 2 - 1.5 * dpr;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const dx = x + 0.5 - n / 2, dy = n / 2 - (y + 0.5), r = Math.hypot(dx, dy) / R;
          if (r > 1.02) continue;
          const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          const rgb = hsv2rgb(hue, Math.min(1, r) * 0.9, 0.42 + 0.33 * Math.min(1, r));
          const a = Math.max(0, Math.min(1, (1.02 - r) / 0.02 * dpr));
          const o = (y * n + x) * 4;
          img.data[o] = rgb[0] * 255; img.data[o + 1] = rgb[1] * 255; img.data[o + 2] = rgb[2] * 255; img.data[o + 3] = a * 255;
        }
        ctx.putImageData(img, 0, 0);
        return (wheelCache[key] = c);
      }

      function wheel(parent, zone, S, full) {
        const w = el('div', 'hcg-wheel' + (full ? ' full' : ''));
        if (!full) w.style.width = S + 'px';
        const lab = el('div', 'wl', `<b>${L(ZN[zone])}</b><span class="wv"></span>`);
        const cv = el('canvas');
        cv.style.width = cv.style.height = S + 'px';
        w.append(lab, cv);
        parent.appendChild(w);
        const wv = lab.querySelector('.wv');
        const path = 'grading.' + zone;
        function draw() {
          const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
          cv.width = cv.height = Math.round(S * dpr);
          const ctx = cv.getContext('2d');
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.drawImage(wheelImage(S, dpr), 0, 0);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const R = S / 2 - 1.5, z = getPath(state, path);
          ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(S / 2 - 4, S / 2); ctx.lineTo(S / 2 + 4, S / 2); ctx.moveTo(S / 2, S / 2 - 4); ctx.lineTo(S / 2, S / 2 + 4); ctx.stroke();
          const a = z.hue * Math.PI / 180, rr = z.sat / 100 * R;
          const px = S / 2 + Math.cos(a) * rr, py = S / 2 - Math.sin(a) * rr;
          ctx.beginPath(); ctx.arc(px, py, z.sat ? 6 : 4.5, 0, Math.PI * 2);
          const rgb = hsv2rgb(z.hue, z.sat / 100, 1);
          ctx.fillStyle = z.sat ? `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})` : 'rgba(0,0,0,.25)'; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
          ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(px, py, 7.5, 0, Math.PI * 2); ctx.stroke();
          wv.textContent = z.sat ? `${Math.round(z.hue)}° · ${Math.round(z.sat)}` : '';
        }
        let dragging = false;
        function setFrom(e) {
          const r = cv.getBoundingClientRect();
          const dx = e.clientX - r.left - S / 2, dy = S / 2 - (e.clientY - r.top);
          const R = S / 2 - 1.5;
          let hue = Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360);
          let sat = Math.round(Math.min(100, Math.hypot(dx, dy) / R * 100));
          const z = getPath(state, path);
          if (e.shiftKey) hue = z.hue;
          if (sat === 0) hue = z.hue;
          if (z.hue !== hue || z.sat !== sat) { z.hue = hue; z.sat = sat; draw(); emit(); syncSliders(); }
        }
        on(cv, 'pointerdown', e => {
          if (e.button !== 0) return;
          const r = cv.getBoundingClientRect();
          if (Math.hypot(e.clientX - r.left - S / 2, e.clientY - r.top - S / 2) > S / 2 + 2) return;
          e.preventDefault(); dragging = true; cv.setPointerCapture(e.pointerId); setFrom(e);
        });
        on(cv, 'pointermove', e => { if (dragging) setFrom(e); });
        const end = () => { dragging = false; };
        on(cv, 'pointerup', end); on(cv, 'pointercancel', end);
        on(cv, 'dblclick', () => { const z = getPath(state, path); z.hue = 0; z.sat = 0; draw(); emit(); syncSliders(); });
        cv.title = L('Drag to set hue and saturation (Shift keeps hue, double-click resets)');
        const ctl = { update: draw };
        controls.push(ctl); built.push(ctl);
        draw();
        return w;
      }
      let zoneSliders = [];
      function syncSliders() { zoneSliders.forEach(c => c.update()); }
      function zoneSlider(parent, zone, kind, label) {
        const deg = getPath(state, 'grading.' + zone).hue;
        const track = kind === 'hue' ? TRACK.rainbow : kind === 'sat' ? hueTrack(deg, 'sat') : TRACK.tone;
        const c = slider(parent, {
          path: `grading.${zone}.${kind}`, label, min: kind === 'lum' ? -100 : 0, max: kind === 'hue' ? 360 : 100,
          track, onSet: () => built.forEach(b => b.update())
        });
        built.push(c); zoneSliders.push(c);
        return c;
      }
      function build() {
        built.forEach(c => { const i = controls.indexOf(c); if (i >= 0) controls.splice(i, 1); });
        built.length = 0; zoneSliders = [];
        box.innerHTML = '';
        const avail = Math.max(240, (box.clientWidth || 272));
        if (mode === '3way') {
          const top = el('div', 'hcg-wheels'); top.style.justifyContent = 'center';
          box.appendChild(top);
          const mid = wheel(top, 'midtones', 128, false);
          zoneSlider(mid, 'midtones', 'lum', 'Luminance');
          const row = el('div', 'hcg-wheels');
          box.appendChild(row);
          const S = Math.floor((avail - 16) / 2);
          const sw = wheel(row, 'shadows', Math.min(124, S), false);
          zoneSlider(sw, 'shadows', 'lum', 'Luminance');
          const hw = wheel(row, 'highlights', Math.min(124, S), false);
          zoneSlider(hw, 'highlights', 'lum', 'Luminance');
        } else {
          const top = el('div', 'hcg-wheels'); top.style.justifyContent = 'center';
          box.appendChild(top);
          wheel(top, mode, 176, false);
          zoneSlider(box, mode, 'hue', 'Hue');
          zoneSlider(box, mode, 'sat', 'Saturation');
          zoneSlider(box, mode, 'lum', 'Luminance');
        }
        box.classList.add('hcg-fade'); setTimeout(() => box.classList.remove('hcg-fade'), 260);
      }
      build();
    }

    /* ===== Effects ===== */
    {
      const pad = section('effects', 'Effects', SECTION_PATHS.effects, false);
      sub(pad, 'Vignette');
      slider(pad, { path: 'vignette.amount', label: 'Amount', min: -100, max: 100, track: TRACK.vig });
      slider(pad, { path: 'vignette.midpoint', label: 'Midpoint', min: 0, max: 100 });
      slider(pad, { path: 'vignette.roundness', label: 'Roundness', min: -100, max: 100 });
      slider(pad, { path: 'vignette.feather', label: 'Feather', min: 0, max: 100 });
      sub(pad, 'Grain');
      slider(pad, { path: 'grain.amount', label: 'Amount', min: 0, max: 100 });
      slider(pad, { path: 'grain.size', label: 'Size', min: 0, max: 100 });
      slider(pad, { path: 'grain.roughness', label: 'Roughness', min: 0, max: 100 });
    }

    function refreshAll(animate) {
      if (animate) controls.forEach(c => { if (c.row) { c.row.classList.add('jump'); setTimeout(() => c.row.classList.remove('jump'), 260); } });   // the slider's own glide (ui/slider.css .jump)
      controls.forEach(c => c.update());
      refreshSections();
    }
    function setState(p, animate) { state = normalize(p); refreshAll(animate); }

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      let lastW = 0;
      ro = new ResizeObserver(() => { const w = root.clientWidth; if (w !== lastW) { lastW = w; redraws.forEach(f => f()); } });
      ro.observe(root);
    }
    refreshSections();

    // live answers (Object.assign below would copy a getter's value once)
    Object.defineProperties(panelApi, {
      before: { get: () => !!state.bypass, configurable: true },
      menuOpen: { get: () => menu.classList.contains('open'), configurable: true }
    });
    return Object.assign(panelApi, {
      el: root,
      set(p) { setState(p, false); },
      get() { return clone(state); },
      setHistogram(h) { setHistoHook(h); },
      setBefore,
      closeMenu,
      destroy() {
        listeners.forEach(f => f());
        if (pending) cancelAnimationFrame(pending);
        if (ro) ro.disconnect();
        if (panelApi.hs) panelApi.hs.stopPick();
        root.remove();
      }
    });
  }
  global.HyColorGrade = {
    version: '1.0.0',
    createRenderer,
    createPanel,
    defaults,
    normalize,
    isNeutral,
    effective,
    SECTION_PATHS,
    presets,
    presetOf,
    presetHover,
    sample,
    swatch,
    histogram,
    HUES,
    HS_RANGES,
    hsPresets,
    hsApply,
    _internal: { monotoneSpline, buildCurveLUT, buildHslLUT, parseEntry, wbGains, hsWeight, psSat, hsRange, rgb2hsl, hsl2rgb }
  };
})(typeof window !== 'undefined' ? window : globalThis);
