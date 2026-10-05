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
 *   const panel = HyColorGrade.createPanel(el, params, onChange, {theme, onBeforeAfter})
 *     -> {set(p), get(), setHistogram(h), setBefore(b), before, el, destroy()}
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ params */

  const HUES = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
  const HUE_LABEL = { red: 'Reds', orange: 'Oranges', yellow: 'Yellows', green: 'Greens', aqua: 'Aquas', blue: 'Blues', purple: 'Purples', magenta: 'Magentas' };
  const HUE_DEG = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 270, magenta: 300 };
  const ID_CURVE = () => [[0, 0], [255, 255]];

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
      grain: { amount: 0, size: 25, roughness: 50 }
    };
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
      const p = normalize(params);
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
.hcg{--ease:cubic-bezier(.3,.8,.25,1);position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;
  background:var(--paper);color:var(--ink);font:500 12px/1.3 Geist,ui-sans-serif,system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;box-sizing:border-box}
.hcg *,.hcg *::before,.hcg *::after{box-sizing:border-box}
.hcg button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer}
.hcg svg{display:block;flex:none}
.hcg-top{display:flex;align-items:center;gap:2px;height:44px;padding:0 8px 0 14px;border-bottom:1px solid var(--line);flex:none}
.hcg-title{flex:1;font-weight:600;font-size:13px;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hcg-ib{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--sub);
  transition:background .2s var(--ease),color .2s var(--ease),transform .2s var(--ease)}
.hcg-ib svg{width:16px;height:16px}
.hcg-ib:hover{background:rgba(255,255,255,.055);color:var(--ink)}
.hcg-ib:active{transform:scale(.92)}
.hcg-ib.on{background:var(--raise2);color:var(--ink)}
.hcg-pbtn{height:28px;padding:0 8px 0 10px;border-radius:8px;display:flex;align-items:center;gap:4px;color:var(--sub);
  transition:background .2s var(--ease),color .2s var(--ease)}
.hcg-pbtn:hover,.hcg-pbtn.on{background:rgba(255,255,255,.055);color:var(--ink)}
.hcg-pbtn .hcg-chev{width:11px;height:11px;transform:rotate(90deg)}
.hcg-menu{position:absolute;right:8px;top:40px;z-index:5;min-width:180px;padding:4px;border-radius:10px;background:var(--panel);
  border:1px solid var(--line);box-shadow:0 2px 6px rgba(0,0,0,.35),0 18px 48px rgba(0,0,0,.5);
  opacity:0;transform:translateY(-4px) scale(.98);transform-origin:top right;pointer-events:none;
  transition:opacity .18s var(--ease),transform .2s var(--ease)}
.hcg-menu.open{opacity:1;transform:none;pointer-events:auto}
.hcg-menu .mt{padding:6px 8px 4px;color:var(--muted);font:600 10.5px Geist,ui-sans-serif,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.hcg-menu button{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 8px;border-radius:6px;text-align:left;
  transition:background .15s var(--ease)}
.hcg-menu button:hover{background:var(--raise2)}
.hcg-menu button .ck{width:14px;color:var(--sel);opacity:0;transition:opacity .15s}
.hcg-menu button.cur .ck{opacity:1}
.hcg-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color:var(--raise2) transparent;padding-bottom:24px}
.hcg-sec{border-bottom:1px solid var(--line)}
.hcg-head{display:flex;align-items:center;gap:9px;height:40px;padding:0 10px 0 14px;cursor:pointer;color:var(--sub);
  transition:color .2s var(--ease),background .2s var(--ease)}
.hcg-head:hover{color:var(--ink);background:rgba(255,255,255,.02)}
.hcg-sec.open>.hcg-head{color:var(--ink)}
.hcg-head .ic{width:15px;height:15px;opacity:.9}
.hcg-head .t{flex:1;font-weight:600;font-size:12.5px}
.hcg-head .dot{width:5px;height:5px;border-radius:50%;background:var(--sel);opacity:0;transform:scale(.4);transition:opacity .2s var(--ease),transform .25s var(--ease)}
.hcg-sec.mod .hcg-head .dot{opacity:1;transform:none}
.hcg-head .rs{width:24px;height:24px;border-radius:6px;display:grid;place-items:center;color:var(--muted);opacity:0;pointer-events:none;
  transition:opacity .2s var(--ease),background .15s var(--ease),color .15s var(--ease)}
.hcg-sec.mod .hcg-head:hover .rs{opacity:1;pointer-events:auto}
.hcg-head .rs:hover{background:var(--raise2);color:var(--ink)}
.hcg-head .hcg-chev{width:12px;height:12px;color:var(--muted);transition:transform .25s var(--ease)}
.hcg-sec.open>.hcg-head .hcg-chev{transform:rotate(90deg)}
.hcg-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .28s var(--ease)}
.hcg-sec.open>.hcg-body{grid-template-rows:1fr}
.hcg-inner{min-height:0;overflow:hidden;opacity:0;transition:opacity .22s var(--ease)}
.hcg-sec.open .hcg-inner{opacity:1}
.hcg-pad{padding:2px 14px 14px}
.hcg-sub{display:flex;align-items:center;gap:8px;margin:12px 0 4px;color:var(--muted);font:600 10.5px Geist,ui-sans-serif,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.hcg-sub::after{content:"";flex:1;height:1px;background:var(--line)}
.hcg-sub:first-child{margin-top:6px}
.hcg-row{padding:5px 0 1px}
.hcg-lab{display:flex;align-items:center;justify-content:space-between;height:18px;color:var(--sub);transition:color .15s var(--ease)}
.hcg-row:hover .hcg-lab,.hcg-row.drag .hcg-lab{color:var(--ink)}
.hcg-num{width:56px;height:20px;margin-right:-4px;padding:0 4px;border:1px solid transparent;border-radius:5px;background:transparent;
  color:var(--ink);font:500 12px/1 Geist,ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums;text-align:right;outline:none;cursor:text;
  transition:background .15s var(--ease),border-color .15s var(--ease)}
.hcg-num{user-select:text;-webkit-user-select:text}
.hcg-num:hover{background:var(--raise)}
.hcg-num:focus{background:var(--panel);border-color:var(--sel)}
.hcg-trk{position:relative;height:18px;cursor:pointer;touch-action:none;outline:none}
.hcg-rail{position:absolute;left:0;right:0;top:7px;height:4px;border-radius:2px;background:var(--raise2)}
.hcg-trk.grad .hcg-rail{height:5px;top:6.5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.hcg-fill{position:absolute;top:7px;height:4px;border-radius:2px;background:var(--sel);opacity:.85;transition:opacity .2s var(--ease)}
.hcg-trk.grad .hcg-fill{display:none}
.hcg-zero{position:absolute;left:50%;top:4px;width:1px;height:10px;margin-left:-.5px;background:var(--muted);opacity:.55}
.hcg-thumb{position:absolute;top:3px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:var(--ink);
  box-shadow:0 0 0 1px rgba(0,0,0,.45),0 1px 3px rgba(0,0,0,.5);transition:transform .15s var(--ease),box-shadow .15s var(--ease)}
.hcg-trk:hover .hcg-thumb{transform:scale(1.12)}
.hcg-row.drag .hcg-thumb{transform:scale(1.25)}
.hcg-trk:focus-visible .hcg-thumb{box-shadow:0 0 0 2px var(--sel),0 1px 3px rgba(0,0,0,.5)}
.hcg-row.anim .hcg-thumb{transition:left .22s var(--ease),transform .15s var(--ease)}
.hcg-row.anim .hcg-fill{transition:left .22s var(--ease),width .22s var(--ease)}
.hcg-seg{display:flex;gap:2px;padding:2px;margin:6px 0 8px;border-radius:8px;background:var(--panel);border:1px solid var(--line)}
.hcg-seg button{flex:1 1 auto;min-width:0;padding:0 5px;height:24px;border-radius:6px;color:var(--sub);font-size:11px;display:flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;
  transition:background .2s var(--ease),color .2s var(--ease)}
.hcg-seg button:hover{color:var(--ink)}
.hcg-seg button.on{background:var(--raise2);color:var(--ink)}
.hcg-seg .sw{width:7px;height:7px;border-radius:50%}
.hcg-cv{position:relative;margin:2px 0 4px}
.hcg-cv canvas{display:block;width:100%;border-radius:6px;touch-action:none;cursor:crosshair}
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
.hcg-fade{animation:hcgFade .24s var(--ease)}
@keyframes hcgFade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
`;

  const ICON = {
    basic: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    curve: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M6 18C10 18 9 6 18 6"/>',
    detail: '<path d="M12 3 3 19h18z"/><path d="M8.5 13h7"/>',
    mixer: '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="9" r="5.5"/><circle cx="12" cy="15" r="5.5"/>',
    grading: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" opacity=".35"/><circle cx="15" cy="9" r="1.6"/>',
    effects: '<rect x="3" y="4" width="18" height="16" rx="3"/><ellipse cx="12" cy="12" rx="5" ry="4"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    split: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M12 4v16"/><path d="M12 4h6.5A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5H12z" fill="currentColor" stroke="none" opacity=".35"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>'
  };
  const svg = (body, cls, sw) => `<svg class="${cls || 'ic'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.7}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const CHEV = '<svg class="hcg-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

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
    const listeners = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); listeners.push(() => t.removeEventListener(ev, fn, o)); };

    const root = el('div', 'hcg');
    const theme = opts.theme && typeof opts.theme === 'object' ? Object.assign({}, DARK, opts.theme) : DARK;
    for (const k in theme) root.style.setProperty(k, theme[k]);
    container.appendChild(root);

    // rAF-throttled change notification
    let pending = 0;
    function emit() {
      refreshSections();
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; if (onChange) onChange(clone(state)); });
    }

    const controls = [];   // each: {update()}
    const redraws = [];    // canvases that depend on width

    /* -- top bar -- */
    const top = el('div', 'hcg-top');
    const title = el('div', 'hcg-title', opts.title || 'Color Grading');
    const baBtn = el('button', 'hcg-ib', svg(ICON.split));
    baBtn.title = 'Toggle Before/After  (\\)';
    const pBtn = el('button', 'hcg-pbtn', 'Presets' + CHEV);
    const rBtn = el('button', 'hcg-ib', svg(ICON.reset));
    rBtn.title = 'Reset all';
    top.append(title, pBtn, baBtn, rBtn);
    root.appendChild(top);

    const menu = el('div', 'hcg-menu');
    menu.appendChild(el('div', 'mt', 'Presets'));
    const presetBtns = [];
    Object.keys(presets).forEach(name => {
      const b = el('button', '', svg(ICON.check, 'ck', 2.2) + `<span>${name}</span>`);
      on(b, 'click', () => { setState(normalize(presets[name]), true); closeMenu(); emit(); });
      menu.appendChild(b); presetBtns.push([name, b]);
    });
    root.appendChild(menu);
    const closeMenu = () => { menu.classList.remove('open'); pBtn.classList.remove('on'); };
    on(pBtn, 'click', e => {
      e.stopPropagation();
      const cur = JSON.stringify(state);
      presetBtns.forEach(([n, b]) => b.classList.toggle('cur', JSON.stringify(normalize(presets[n])) === cur));
      const open = !menu.classList.contains('open');
      menu.classList.toggle('open', open); pBtn.classList.toggle('on', open);
    });
    on(document, 'pointerdown', e => { if (!menu.contains(e.target) && e.target !== pBtn && !pBtn.contains(e.target)) closeMenu(); });
    on(rBtn, 'click', () => { setState(defaults(), true); emit(); });

    let before = false;
    function setBefore(b) {
      before = !!b; baBtn.classList.toggle('on', before);
      if (opts.onBeforeAfter) opts.onBeforeAfter(before);
    }
    on(baBtn, 'click', () => setBefore(!before));
    on(window, 'keydown', e => {
      if (e.key === 'Escape') closeMenu();
      if (e.key !== '\\' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault(); setBefore(!before);
    });

    const scroll = el('div', 'hcg-scroll');
    root.appendChild(scroll);

    /* -- sections -- */
    const sections = [];
    function section(id, name, paths, openByDefault) {
      const sec = el('section', 'hcg-sec' + (openByDefault ? ' open' : ''));
      sec.dataset.id = id;
      const head = el('div', 'hcg-head', svg(ICON[id]) + `<span class="t">${name}</span><span class="dot"></span>`);
      const rs = el('button', 'rs', svg(ICON.reset, 'ic', 1.9));
      rs.title = 'Reset ' + name;
      head.append(rs);
      head.insertAdjacentHTML('beforeend', CHEV);
      const body = el('div', 'hcg-body'), inner = el('div', 'hcg-inner'), pad = el('div', 'hcg-pad');
      inner.appendChild(pad); body.appendChild(inner); sec.append(head, body);
      on(head, 'click', e => {
        if (rs.contains(e.target)) return;
        sec.classList.toggle('open');
        if (sec.classList.contains('open')) requestAnimationFrame(() => redraws.forEach(f => f()));
      });
      on(rs, 'click', e => {
        e.stopPropagation();
        paths.forEach(p => setPath(state, p, clone(getPath(DEF, p))));
        refreshAll(true); emit();
      });
      scroll.appendChild(sec);
      sections.push({ sec, paths });
      return pad;
    }
    function refreshSections() {
      sections.forEach(({ sec, paths }) => {
        sec.classList.toggle('mod', paths.some(p => JSON.stringify(getPath(state, p)) !== JSON.stringify(getPath(DEF, p))));
      });
    }

    /* -- slider -- */
    function slider(parent, o) {
      // o: {path, label, min, max, step, dec, track}
      const def = getPath(DEF, o.path);
      const step = o.step || 1, dec = o.dec || 0;
      const centered = o.min < 0 && o.max > 0;
      const row = el('div', 'hcg-row');
      const lab = el('div', 'hcg-lab');
      const name = el('span', '', o.label);
      const num = el('input', 'hcg-num');
      num.type = 'text'; num.spellcheck = false; num.inputMode = 'decimal';
      num.title = 'Type a value: 10 sets it; +10 adds, -10 takes away, +10% adds a tenth, *2, /2; 1239+10 works too; an exact negative: 0-10';
      lab.append(name, num);
      const trk = el('div', 'hcg-trk' + (o.track ? ' grad' : ''));
      trk.tabIndex = 0; trk.setAttribute('role', 'slider'); trk.setAttribute('aria-label', o.label);
      const rail = el('div', 'hcg-rail'), fill = el('div', 'hcg-fill'), thumb = el('div', 'hcg-thumb');
      if (o.track) rail.style.background = o.track;
      trk.append(rail, fill);
      if (centered) trk.appendChild(el('div', 'hcg-zero'));
      trk.appendChild(thumb);
      row.append(lab, trk);
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
      const frac = v => (v - o.min) / (o.max - o.min);
      function update() {
        const v = get(), f = frac(v) * 100;
        thumb.style.left = f + '%';
        if (centered) { const z = frac(0) * 100; fill.style.left = Math.min(z, f) + '%'; fill.style.width = Math.abs(f - z) + '%'; }
        else { fill.style.left = '0%'; fill.style.width = f + '%'; }
        if (document.activeElement !== num) num.value = fmt(v);
        trk.setAttribute('aria-valuenow', v);
      }
      function setV(v, animate) {
        v = quant(v);
        if (v === get()) { update(); return; }
        setPath(state, o.path, v);
        if (animate) { row.classList.add('anim'); clearTimeout(row._t); row._t = setTimeout(() => row.classList.remove('anim'), 260); }
        update(); emit();
        if (o.onSet) o.onSet(v);
      }
      // pointer: grab the thumb (relative drag) or jump to the click position
      let drag = null;
      on(trk, 'pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); trk.focus({ preventScroll: true });
        const r = trk.getBoundingClientRect();
        const tx = r.left + frac(get()) * r.width;
        const onThumb = Math.abs(e.clientX - tx) <= 8;
        drag = { r, off: onThumb ? e.clientX - tx : 0 };
        trk.setPointerCapture(e.pointerId);
        row.classList.add('drag');
        if (!onThumb) setV(o.min + (e.clientX - r.left) / r.width * (o.max - o.min), true);
      });
      on(trk, 'pointermove', e => {
        if (!drag) return;
        setV(o.min + (e.clientX - drag.off - drag.r.left) / drag.r.width * (o.max - o.min));
      });
      const end = () => { if (drag) { drag = null; row.classList.remove('drag'); } };
      on(trk, 'pointerup', end); on(trk, 'pointercancel', end);
      on(trk, 'dblclick', () => setV(def, true));
      on(trk, 'keydown', e => {
        const k = e.key, big = e.shiftKey ? 10 : 1;
        if (k === 'ArrowRight' || k === 'ArrowUp') { e.preventDefault(); setV(get() + step * big); }
        else if (k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); setV(get() - step * big); }
        else if (k === 'Home') setV(o.min, true);
        else if (k === 'End') setV(o.max, true);
      });
      // number field
      on(num, 'focus', () => { num.value = fmt(get()); requestAnimationFrame(() => num.select()); });
      // only typed text is read: the field shows +10 for a positive value, and reading that back would add 10 again
      const commit = () => {
        if (num.value === fmt(get())) return;
        const v = parseEntry(num.value, get());
        if (v != null && isFinite(v)) setV(v, true);
        num.value = fmt(get());
      };
      on(num, 'keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); num.select(); }
        else if (e.key === 'Escape') { num.value = fmt(get()); num.blur(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          setV(get() + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
          num.value = fmt(get()); num.select();
        }
        e.stopPropagation();
      });
      on(num, 'blur', commit);
      on(num, 'dblclick', e => e.stopPropagation());
      const ctl = { update, row };
      controls.push(ctl);
      update();
      return ctl;
    }

    function sub(parent, text) { parent.appendChild(el('div', 'hcg-sub', text)); }

    function segmented(parent, items, cur, onPick) {
      const seg = el('div', 'hcg-seg');
      const btns = items.map(([id, label, sw]) => {
        const b = el('button', id === cur ? 'on' : '', (sw ? `<span class="sw" style="background:${sw}"></span>` : '') + label);
        on(b, 'click', () => { btns.forEach(x => x.classList.toggle('on', x === b)); onPick(id); });
        seg.appendChild(b);
        return b;
      });
      parent.appendChild(seg);
      return seg;
    }

    /* ===== Basic ===== */
    {
      const pad = section('basic', 'Basic', ['temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation'], true);
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
      const pad = section('curve', 'Curve', ['curve'], false);
      let mode = 'rgb';
      segmented(pad, [['param', 'Parametric'], ['rgb', 'RGB', '#e4e4e7'], ['red', 'Red', '#ef4444'], ['green', 'Green', '#22c55e'], ['blue', 'Blue', '#3b82f6']],
        mode, m => { mode = m; layout(); draw(); });
      const wrap = el('div', 'hcg-cv');
      const cv = el('canvas');
      const readout = el('div', 'hcg-readout');
      wrap.append(cv, readout);
      pad.appendChild(wrap);
      const hint = el('div', 'hcg-hint', 'Click to add a point, drag it off the grid to remove');
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
      splitEl.title = 'Region splits (double-click to reset)';

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
        const cs = getComputedStyle(root);
        ctx.fillStyle = cs.getPropertyValue('--panel'); ctx.fillRect(0, 0, W, W);
        // histogram
        if (histo) {
          const chans = mode === 'red' ? [['r', 'rgba(248,113,113,.35)']] : mode === 'green' ? [['g', 'rgba(74,222,128,.32)']] : mode === 'blue' ? [['b', 'rgba(96,165,250,.38)']] :
            [['l', 'rgba(255,255,255,.13)']];
          chans.forEach(([k, col]) => {
            const a = histo[k];
            ctx.beginPath(); ctx.moveTo(0, W);
            for (let i = 0; i < 256; i++) ctx.lineTo(i / 255 * W, W - a[i] * W * 0.62);
            ctx.lineTo(W, W); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
          });
        }
        // grid
        ctx.strokeStyle = cs.getPropertyValue('--line'); ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 4; i++) { const g = Math.round(i * W / 4) + 0.5; ctx.moveTo(g, 0); ctx.lineTo(g, W); ctx.moveTo(0, g); ctx.lineTo(W, g); }
        ctx.stroke();
        if (mode === 'param') {
          ctx.fillStyle = 'rgba(255,255,255,.035)';
          const s = state.curve.splits;
          [[0, s[0]], [s[1], s[2]]].forEach(([a, b]) => ctx.fillRect(a / 100 * W, 0, (b - a) / 100 * W, W));
        }
        // diagonal
        ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(0, W); ctx.lineTo(W, 0); ctx.stroke(); ctx.setLineDash([]);
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
        readout.textContent = removing ? 'Release to remove point' : `Input ${Math.round(p[0])}  ·  Output ${Math.round(p[1])}`;
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
      const pad = section('detail', 'Detail', ['sharpening', 'sharpenRadius', 'noiseReduction'], false);
      slider(pad, { path: 'sharpening', label: 'Sharpening', min: 0, max: 150 });
      slider(pad, { path: 'sharpenRadius', label: 'Radius', min: 0.5, max: 3, step: 0.1, dec: 1 });
      slider(pad, { path: 'noiseReduction', label: 'Noise Reduction', min: 0, max: 100 });
    }

    /* ===== Color Mixer ===== */
    {
      const pad = section('mixer', 'Color Mixer', ['hsl'], false);
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

    /* ===== Color Grading ===== */
    {
      const pad = section('grading', 'Color Grading', ['grading'], false);
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
        const lab = el('div', 'wl', `<b>${ZN[zone]}</b><span class="wv"></span>`);
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
        cv.title = 'Drag to set hue and saturation (Shift keeps hue, double-click resets)';
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
      const pad = section('effects', 'Effects', ['vignette', 'grain'], false);
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
      if (animate) controls.forEach(c => { if (c.row) { c.row.classList.add('anim'); setTimeout(() => c.row.classList.remove('anim'), 260); } });
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

    return {
      el: root,
      set(p) { setState(p, false); },
      get() { return clone(state); },
      setHistogram(h) { setHistoHook(h); },
      setBefore,
      get before() { return before; },
      destroy() {
        listeners.forEach(f => f());
        if (pending) cancelAnimationFrame(pending);
        if (ro) ro.disconnect();
        root.remove();
      }
    };
  }
  global.HyColorGrade = {
    version: '1.0.0',
    createRenderer,
    createPanel,
    defaults,
    normalize,
    isNeutral,
    presets,
    histogram,
    HUES,
    _internal: { monotoneSpline, buildCurveLUT, buildHslLUT, parseEntry, wbGains }
  };
})(typeof window !== 'undefined' ? window : globalThis);
