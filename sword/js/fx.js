// fx.js — SKY HERO impact & atmosphere effects.
// 모든 이펙트는 생성 시점에 미리 만들어 두고(셰이더 프리워밍), 매 프레임 할당 없이 풀(pool)로만 갱신한다.
// 셰이더 출력은 LINEAR HDR (OutputPass 에서 톤매핑). 1 보다 큰 값은 블룸으로 빛난다.
//
// Draw calls (max ~10): craters, smoke, rings, shells, vapor, ribbons, wind lines, glow, plasma, debris.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const MACH = 343;

// ---------------------------------------------------------------------------------------------
// scratch (module scope, never allocate per frame)
// ---------------------------------------------------------------------------------------------
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _gx = new THREE.Vector3();
const _gy = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4();
const _sc = new THREE.Vector3();
const _rgb = [0, 0, 0];
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);
const Q_GROUND = new THREE.Quaternion().setFromAxisAngle(AX_X, -Math.PI / 2); // quad normal (+Z) -> +Y
const HOOK_VECS = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
let hookVecI = 0;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);

// X, Y ⟂ d (right-handed: X × Y = d)
function basis(d, X, Y) {
  if (Math.abs(d.y) < 0.92) X.crossVectors(AX_Y, d); else X.crossVectors(AX_X, d);
  X.normalize();
  Y.crossVectors(d, X).normalize();
}
function quatFromBasis(X, Y, Z, out) {
  _m0.makeBasis(X, Y, Z);
  return out.setFromRotationMatrix(_m0);
}

// incandescent ramp: 0 = white-hot .. 1 = dark red (normalised, multiply by heat)
const FIRE = [
  0.00, 1.00, 0.88, 0.62,
  0.10, 1.00, 0.62, 0.17,
  0.28, 0.92, 0.30, 0.04,
  0.52, 0.62, 0.08, 0.012,
  0.78, 0.30, 0.025, 0.006,
  1.00, 0.12, 0.012, 0.004,
];
function fireRamp(t, out) {
  if (t <= 0) { out[0] = FIRE[1]; out[1] = FIRE[2]; out[2] = FIRE[3]; return out; }
  for (let i = 4; i < FIRE.length; i += 4) {
    if (t <= FIRE[i]) {
      const t0 = FIRE[i - 4], k = (t - t0) / (FIRE[i] - t0);
      out[0] = lerp(FIRE[i - 3], FIRE[i + 1], k);
      out[1] = lerp(FIRE[i - 2], FIRE[i + 2], k);
      out[2] = lerp(FIRE[i - 1], FIRE[i + 3], k);
      return out;
    }
  }
  const j = FIRE.length - 4;
  out[0] = FIRE[j + 1]; out[1] = FIRE[j + 2]; out[2] = FIRE[j + 3];
  return out;
}

// ---------------------------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------------------------
const GLSL_NOISE = /* glsl */`
float fxHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fxNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fxHash(i), fxHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(fxHash(i + vec3(0.0, 1.0, 0.0)), fxHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(fxHash(i + vec3(0.0, 0.0, 1.0)), fxHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(fxHash(i + vec3(0.0, 1.0, 1.0)), fxHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fxFbm(vec3 p) {
  float s = 0.0, a = 0.5, w = 0.0;
  for (int i = 0; i < FBM_OCT; i++) { s += a * fxNoise(p); w += a; p = p * 2.03 + vec3(11.3, 7.1, 3.7); a *= 0.5; }
  return s / w;
}
// incandescent plasma ramp, HDR: deep red rim ~1.5 .. white-hot core ~8
vec3 fxHeat(float T) {
  T = clamp(T, 0.0, 1.0);
  vec3 c = mix(vec3(0.16, 0.008, 0.002), vec3(0.75, 0.045, 0.006), smoothstep(0.0, 0.22, T));
  c = mix(c, vec3(1.25, 0.24, 0.02), smoothstep(0.2, 0.46, T));
  c = mix(c, vec3(2.1, 0.95, 0.16), smoothstep(0.44, 0.74, T));
  c = mix(c, vec3(4.2, 3.3, 2.0), smoothstep(0.76, 1.0, T));
  return c;
}
`;

const PREMUL = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
};
function premulMaterial(params) {
  return new THREE.ShaderMaterial(Object.assign({}, PREMUL, params));
}

// ---------------------------------------------------------------------------------------------
// procedural textures
// ---------------------------------------------------------------------------------------------
function hash2(ix, iy, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise2(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm2(x, y, s, oct) {
  let v = 0, a = 0.5, w = 0;
  for (let i = 0; i < oct; i++) { v += a * vnoise2(x, y, s + i * 17); w += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return v / w;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function dataTex(data, size) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

// 2x2 atlas of billowy smoke puffs (alpha = density)
function makeSmokeAtlas(cell) {
  const size = cell * 2;
  const data = new Uint8Array(size * size * 4);
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const seed = 11 + (cy * 2 + cx) * 101;
      const lump = 0.7 + 0.25 * (cx + cy);
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const u = (x + 0.5) / cell * 2 - 1, v = (y + 0.5) / cell * 2 - 1;
          const r = Math.sqrt(u * u + v * v);
          const n = fbm2(u * 2.6 + 9.1, v * 2.6 + 3.7, seed, 5);
          const n2 = fbm2(u * 6.1, v * 6.1, seed + 7, 3);
          // warped radius -> cauliflower edge
          const rw = r * (0.82 + lump * 0.45 * (n - 0.5) + 0.12 * (n2 - 0.5));
          let dns = 1 - smooth(0.12, 0.92, rw);
          dns *= 0.55 + 0.75 * n;
          dns = clamp01(dns * 1.15 - 0.04) * (1 - smooth(0.86, 1.0, r));
          const o = ((cy * cell + y) * size + cx * cell + x) * 4;
          const b = Math.round(dns * 255);
          data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = b;
        }
      }
    }
  }
  return dataTex(data, size);
}
// soft glow with hot core (alpha = intensity)
function makeGlowTex(size) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
      const r2 = u * u + v * v;
      let a = 0.62 * Math.exp(-r2 * 6.5) + 0.38 * Math.exp(-r2 * 28);
      a *= 1 - smooth(0.7, 1.0, Math.sqrt(r2));
      const o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = Math.round(clamp01(a) * 255);
    }
  }
  return dataTex(data, size);
}

// superhero-landing crater: 2x2 atlas. alpha = darkening. texture +u points TOWARD the sun.
function makeCraterAtlas(cell) {
  const size = cell * 2;
  let canvas = null;
  if (typeof document !== 'undefined') { canvas = document.createElement('canvas'); canvas.width = canvas.height = size; }
  if (!canvas) return dataTex(new Uint8Array(size * size * 4), size);
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  const px = img.data;
  const el = 32 * Math.PI / 180;
  const Lx = Math.cos(el), Lz = Math.sin(el);
  const bowl = [0.3, 0.34, 0.32, 0.36];
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const seed = 300 + (cy * 2 + cx) * 37;
      const rb = bowl[cy * 2 + cx]; // bowl radius (cell-normalised)
      const depth = 0.075;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const u = (x + 0.5) / cell * 2 - 1, v = (y + 0.5) / cell * 2 - 1;
          const r = Math.sqrt(u * u + v * v) + 1e-6;
          const nz = fbm2(u * 9 + seed, v * 9, seed, 4);
          const rr = r * (1 + 0.1 * (fbm2(u * 2.5, v * 2.5, seed + 3, 3) - 0.5));
          // height field slope: shallow bowl + soft raised lip + rubble noise
          let dhdr = 0;
          if (rr < rb) { const q = rr / rb; dhdr += depth * 4.2 * q * (1 - q * q) / rb; }
          const rimW = 0.12;
          const e = (rr - rb) / rimW;
          dhdr += -0.03 * 2 * e / rimW * Math.exp(-e * e);
          const rub = (nz - 0.5) * 0.35 * (rr < rb * 1.25 ? 1 : 0.3);
          const gxh = dhdr * u / r + rub;
          const gyh = dhdr * v / r + rub * 0.5;
          const inv = 1 / Math.sqrt(gxh * gxh + gyh * gyh + 1);
          const lam = (-gxh * Lx + Lz) * inv;
          let dark = clamp01((Lz - lam) * 1.25);
          const ao = rr < rb ? 0.16 * (1 - rr / rb) + 0.06 : 0.07 * Math.exp(-(((rr - rb) / 0.2) ** 2));
          dark = Math.max(dark, ao);
          // faint powder/scorch halo
          dark += 0.07 * (1 - smooth(rb * 0.8, 0.9, r)) * (0.4 + fbm2(u * 3.5, v * 3.5, seed + 9, 3));
          const o = ((cy * cell + y) * size + cx * cell + x) * 4;
          px[o] = px[o + 1] = px[o + 2] = 0;
          px[o + 3] = Math.round(clamp01(dark * 0.8) * 255);
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  g.lineJoin = 'miter';
  // jagged crack polyline (straight segments with sharp kinks), tapering
  const crack = (rng, x, y, ang, len, w, lv, alpha, R) => {
    const steps = 7 + Math.floor(rng() * 5);
    const step = len / steps;
    let x0 = x, y0 = y;
    const heading = ang;
    for (let i = 0; i < steps; i++) {
      ang = heading + (rng() - 0.5) * 0.9;
      const k = step * (0.6 + rng() * 0.8);
      const x1 = x0 + Math.cos(ang) * k, y1 = y0 + Math.sin(ang) * k;
      const taper = 1 - i / steps;
      g.strokeStyle = `rgba(0,0,0,${(alpha * (0.45 + 0.55 * taper)).toFixed(3)})`;
      g.lineWidth = Math.max(0.6, w * (0.25 + 0.75 * taper));
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (lv < 1 && rng() < 0.1) {
        crack(rng, x1, y1, heading + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6), len * (0.2 + rng() * 0.25) * taper, w * 0.55, lv + 1, alpha * 0.85, R);
      }
      x0 = x1; y0 = y1;
    }
  };
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const rng = mulberry(77 + cy * 2 + cx);
      const ox = cx * cell + cell / 2, oy = cy * cell + cell / 2, R = cell / 2;
      const rb = bowl[cy * 2 + cx] * R;
      const nMain = 11 + Math.floor(rng() * 6);
      const angs = [];
      for (let i = 0; i < nMain; i++) angs.push((i / nMain) * TAU + (rng() - 0.5) * 0.4);
      // broken slab wedges between cracks (slightly different shade each)
      for (let i = 0; i < nMain; i++) {
        const a0 = angs[i], a1 = angs[(i + 1) % nMain] + (i + 1 === nMain ? TAU : 0);
        const r0 = rb * (0.55 + rng() * 0.3), r1 = rb * (1.25 + rng() * 0.4);
        g.fillStyle = `rgba(0,0,0,${(rng() * 0.09).toFixed(3)})`;
        g.beginPath();
        g.moveTo(ox + Math.cos(a0) * r0, oy + Math.sin(a0) * r0);
        g.lineTo(ox + Math.cos(a0) * r1, oy + Math.sin(a0) * r1);
        g.lineTo(ox + Math.cos(a1) * r1 * (0.9 + rng() * 0.2), oy + Math.sin(a1) * r1 * (0.9 + rng() * 0.2));
        g.lineTo(ox + Math.cos(a1) * r0, oy + Math.sin(a1) * r0);
        g.closePath(); g.fill();
      }
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.25)';
      g.shadowBlur = Math.max(1, cell / 200);
      for (let i = 0; i < nMain; i++) {
        const a = angs[i];
        const r0 = R * (0.04 + rng() * 0.1);
        crack(rng, ox + Math.cos(a) * r0, oy + Math.sin(a) * r0, a, R * (0.45 + rng() * 0.45), R * (0.011 + rng() * 0.007), 0, 0.72, R);
      }
      // hairline cracks in the bowl
      for (let i = 0; i < 9; i++) {
        const a = rng() * TAU;
        crack(rng, ox + Math.cos(a) * R * 0.02, oy + Math.sin(a) * R * 0.02, a, R * (0.12 + rng() * 0.14), R * 0.005, 1, 0.55, R);
      }
      // concentric fracture arcs around the bowl lip
      for (let i = 0; i < 7; i++) {
        const rr = rb * (0.95 + rng() * 0.6);
        const a0 = rng() * TAU, span = 0.3 + rng() * 0.6;
        g.strokeStyle = `rgba(0,0,0,${(0.35 + rng() * 0.25).toFixed(3)})`;
        g.lineWidth = Math.max(0.6, R * (0.004 + rng() * 0.004));
        g.beginPath();
        const segs = 6;
        for (let k = 0; k <= segs; k++) {
          const a = a0 + span * k / segs;
          const rj = rr * (1 + (rng() - 0.5) * 0.08);
          const X = ox + Math.cos(a) * rj, Y = oy + Math.sin(a) * rj;
          if (k === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
        }
        g.stroke();
      }
      // small chips
      for (let i = 0; i < 60; i++) {
        const a = rng() * TAU, rr = rb * (0.8 + rng() * 1.2);
        g.fillStyle = `rgba(0,0,0,${(0.15 + rng() * 0.3).toFixed(3)})`;
        const sz = R * (0.004 + rng() * 0.01);
        g.fillRect(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr, sz, sz * (0.5 + rng()));
      }
      g.restore();
    }
  }
  // fade to zero at each cell border
  const im2 = g.getImageData(0, 0, size, size);
  const p2 = im2.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x % cell) + 0.5) / cell * 2 - 1, v = ((y % cell) + 0.5) / cell * 2 - 1;
      const r = Math.sqrt(u * u + v * v);
      const o = (y * size + x) * 4 + 3;
      p2[o] = Math.round(p2[o] * (1 - smooth(0.78, 0.98, r)));
    }
  }
  g.putImageData(im2, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Particle pool: instanced camera-facing billboards with premultiplied blending.
// add = 0 -> alpha blend (dust/smoke/vapor), add = 1 -> additive (fire/sparks/energy). Fire can cool into smoke.
// ---------------------------------------------------------------------------------------------
const S = 36; // floats per particle (sim)
// field offsets
const PX = 0, VX = 3, AGE = 6, LIFE = 7, S0 = 8, S1 = 9, SPOW = 10, ROT = 11, ROTV = 12, C0 = 13, C1 = 16,
  ALPHA = 19, FIN = 20, FPOW = 21, DRAG = 22, GRAV = 23, SMODE = 24, SK = 25, ADD0 = 26, ADD1 = 27, PAL = 28,
  VAR = 29, SOFT = 30, BOUNCE = 31, FOLLOW = 32, SHADE = 33, AUX0 = 34, AUX1 = 35;
const MAX_STRETCH = 34;

// reusable spawn descriptor
const SP = {};
function sp() {
  SP.x = 0; SP.y = 0; SP.z = 0; SP.vx = 0; SP.vy = 0; SP.vz = 0;
  SP.life = 1; SP.s0 = 1; SP.s1 = 1; SP.spow = 1.6; SP.rot = Math.random() * TAU; SP.rotv = 0;
  SP.r0 = 1; SP.g0 = 1; SP.b0 = 1; SP.r1 = 1; SP.g1 = 1; SP.b1 = 1;
  SP.a = 1; SP.fin = 0.08; SP.fpow = 1; SP.drag = 0; SP.grav = 0; SP.smode = 0; SP.sk = 0;
  SP.add0 = 0; SP.add1 = 0; SP.pal = 0; SP.variant = (Math.random() * 4) | 0; SP.soft = 0; SP.bounce = -1;
  SP.follow = 0; SP.shade = 1; SP.aux0 = 0; SP.aux1 = 0; SP.preAge = 0;
  return SP;
}

const PARTICLE_VS = /* glsl */`
attribute vec4 aA; // pos, size
attribute vec4 aB; // rgb, alpha
attribute vec4 aC; // stretch (head->tail, world), rotation
attribute vec4 aD; // additive, variant, ground-soft distance (m), shade
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uAtlas;
varying vec4 vCol;
varying vec2 vUv;
varying float vAdd;
varying float vWy;
varying float vSoft;
varying float vDist;
varying float vShade;
varying float vShadeAmt;
varying float vNear;
void main() {
  float s = aA.w;
  vec3 st = aC.xyz;
  vec3 ctr = aA.xyz + st * 0.5;
  vec3 toCam = cameraPosition - ctr;
  float dist = max(length(toCam), 1e-4);
  vec3 V = toCam / dist;
  vec3 stp = st - dot(st, V) * V;
  float L = length(stp);
  float cr = cos(aC.w), sr = sin(aC.w);
  vec3 ax = uCamRight * cr + uCamUp * sr;
  vec3 pp = -uCamRight * sr + uCamUp * cr;
  if (L > s * 0.06) { ax = stp / L; pp = normalize(cross(V, ax)); } else { L = 0.0; }
  vec3 wp = ctr + ax * (position.x * (s + L)) + pp * (position.y * s);
  vWy = wp.y;
  vDist = distance(wp, cameraPosition);
  vNear = smoothstep(0.3 + s * 0.25, 1.6 + s * 1.1, dist);
  vec2 cell = vec2(mod(aD.y, uAtlas), floor(aD.y / uAtlas));
  vUv = (position.xy + 0.5 + cell) / uAtlas;
  vShade = clamp(dot(wp - ctr, uCamUp) / s + 0.5, 0.0, 1.0);
  vCol = aB;
  vAdd = aD.x;
  vSoft = aD.z;
  vShadeAmt = aD.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const PARTICLE_FS = /* glsl */`
uniform sampler2D uMap;
varying vec4 vCol;
varying vec2 vUv;
varying float vAdd;
varying float vWy;
varying float vSoft;
varying float vDist;
varying float vShade;
varying float vShadeAmt;
varying float vNear;
void main() {
  float d = texture2D(uMap, vUv).a;
  float a = d * vCol.a;
  if (vSoft > 0.0) a *= smoothstep(0.0, vSoft, vWy);
  a *= vNear;
  if (a < 0.003) discard;
  // fake volumetric lighting: lit from above, denser core slightly self-shadowed
  float lit = mix(0.52, 1.3, vShade) * mix(1.1, 0.82, d);
  vec3 col = vCol.rgb * mix(1.0, lit, vShadeAmt);
  gl_FragColor = vec4(col * a, a * (1.0 - vAdd));
}
`;

class ParticlePool {
  constructor(max, map, atlas, renderOrder, name) {
    this.max = max;
    this.n = 0;
    this.d = new Float32Array(max * S);
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(quad.getIndex());
    g.setAttribute('position', quad.getAttribute('position'));
    const mk = (nm) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(nm, a);
      return a;
    };
    this.aA = mk('aA'); this.aB = mk('aB'); this.aC = mk('aC'); this.aD = mk('aD');
    this.attrs = [this.aA, this.aB, this.aC, this.aD];
    g.instanceCount = 0;
    this.geo = g;
    this.uniforms = {
      uMap: { value: map },
      uAtlas: { value: atlas },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    };
    this.mat = premulMaterial({ uniforms: this.uniforms, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = name;
  }

  spawn(P) {
    if (this.n >= this.max) return -1;
    const o = this.n * S, d = this.d;
    const pa = P.preAge;
    d[o] = P.x + P.vx * pa; d[o + 1] = P.y + P.vy * pa; d[o + 2] = P.z + P.vz * pa;
    d[o + 3] = P.vx; d[o + 4] = P.vy; d[o + 5] = P.vz;
    d[o + AGE] = pa; d[o + LIFE] = Math.max(P.life, 1e-5);
    d[o + S0] = P.s0; d[o + S1] = P.s1; d[o + SPOW] = P.spow; d[o + ROT] = P.rot; d[o + ROTV] = P.rotv;
    d[o + C0] = P.r0; d[o + C0 + 1] = P.g0; d[o + C0 + 2] = P.b0;
    d[o + C1] = P.r1; d[o + C1 + 1] = P.g1; d[o + C1 + 2] = P.b1;
    d[o + ALPHA] = P.a; d[o + FIN] = P.fin; d[o + FPOW] = P.fpow; d[o + DRAG] = P.drag; d[o + GRAV] = P.grav;
    d[o + SMODE] = P.smode; d[o + SK] = P.sk; d[o + ADD0] = P.add0; d[o + ADD1] = P.add1; d[o + PAL] = P.pal;
    d[o + VAR] = P.variant; d[o + SOFT] = P.soft; d[o + BOUNCE] = P.bounce; d[o + FOLLOW] = P.follow;
    d[o + SHADE] = P.shade; d[o + AUX0] = P.aux0; d[o + AUX1] = P.aux1;
    return this.n++;
  }

  simulate(dt, ply) {
    const d = this.d;
    let n = this.n;
    for (let i = 0; i < n; i++) {
      const o = i * S;
      const age = d[o + AGE] + dt;
      if (age >= d[o + LIFE] || d[o + LIFE] <= 2e-5) { // ephemeral (one-frame) billboards always die here
        n--;
        if (i < n) { d.copyWithin(o, n * S, n * S + S); i--; }
        continue;
      }
      d[o + AGE] = age;
      const dr = d[o + DRAG];
      const k = dr > 0 ? Math.exp(-dr * dt) : 1;
      const vx = d[o + 3] * k, vy = d[o + 4] * k - d[o + GRAV] * dt, vz = d[o + 5] * k;
      const f = d[o + FOLLOW];
      let x = d[o] + (vx + ply.x * f) * dt;
      let y = d[o + 1] + (vy + ply.y * f) * dt;
      const z = d[o + 2] + (vz + ply.z * f) * dt;
      let nvy = vy;
      let nvx = vx, nvz = vz;
      const b = d[o + BOUNCE];
      if (b >= 0 && y < 0.04) {
        y = 0.04;
        if (nvy < 0) nvy = -nvy * b;
        nvx *= 0.82; nvz *= 0.82;
      }
      d[o] = x; d[o + 1] = y; d[o + 2] = z;
      d[o + 3] = nvx; d[o + 4] = nvy; d[o + 5] = nvz;
      d[o + ROT] += d[o + ROTV] * dt;
    }
    this.n = n;
  }

  upload(camVel, ply) {
    const n = this.n;
    this.geo.instanceCount = n;
    if (n === 0) return;
    const d = this.d, A = this.aA.array, B = this.aB.array, C = this.aC.array, D = this.aD.array;
    for (let i = 0; i < n; i++) {
      const o = i * S, j = i * 4;
      const t = Math.min(d[o + AGE] / d[o + LIFE], 1);
      const size = d[o + S0] + (d[o + S1] - d[o + S0]) * (1 - Math.pow(1 - t, d[o + SPOW]));
      const fin = d[o + FIN];
      let a = d[o + ALPHA] * (fin > 0 ? Math.min(t / fin, 1) : 1) * Math.pow(1 - t, d[o + FPOW]);
      const pal = d[o + PAL];
      let r, g, b, add;
      if (pal === 0) {
        r = lerp(d[o + C0], d[o + C1], t); g = lerp(d[o + C0 + 1], d[o + C1 + 1], t); b = lerp(d[o + C0 + 2], d[o + C1 + 2], t);
        add = lerp(d[o + ADD0], d[o + ADD1], t);
      } else if (pal === 1) {
        // fire: C0 = (heat, cooling rate, -), AUX1 = ramp start offset
        fireRamp(Math.min(1, d[o + AUX1] + t * d[o + C0 + 1]), _rgb);
        const h = d[o + C0] * (1 - 0.65 * t);
        r = _rgb[0] * h; g = _rgb[1] * h; b = _rgb[2] * h;
        add = d[o + ADD0];
      } else {
        // fire -> smoke: C0 = (heat, -, smokeStart), C1 = smoke rgb, AUX1 = smoke alpha mul
        const ss = d[o + C0 + 2];
        fireRamp(Math.min(1, t / ss), _rgb);
        const h = d[o + C0] * Math.max(0, 1 - 0.7 * t / ss);
        const kk = smooth(ss * 0.55, ss * 1.5, t);
        r = lerp(_rgb[0] * h, d[o + C1], kk); g = lerp(_rgb[1] * h, d[o + C1 + 1], kk); b = lerp(_rgb[2] * h, d[o + C1 + 2], kk);
        add = 0.45 * (1 - kk);
        a *= lerp(1, d[o + AUX1], kk);
      }
      const tw = d[o + AUX0];
      if (tw > 0) a *= 0.5 + 0.5 * Math.sin(d[o + AGE] * tw + d[o + ROT] * 7);
      A[j] = d[o]; A[j + 1] = d[o + 1]; A[j + 2] = d[o + 2]; A[j + 3] = size;
      B[j] = r; B[j + 1] = g; B[j + 2] = b; B[j + 3] = a;
      let sx = 0, sy = 0, sz = 0;
      const sm = d[o + SMODE];
      if (sm > 0) {
        const kk = d[o + SK];
        let vx = d[o + 3], vy = d[o + 4], vz = d[o + 5];
        if (sm === 2) {
          const f = d[o + FOLLOW];
          vx += ply.x * f - camVel.x; vy += ply.y * f - camVel.y; vz += ply.z * f - camVel.z;
        }
        sx = -vx * kk; sy = -vy * kk; sz = -vz * kk;
        const L2 = sx * sx + sy * sy + sz * sz;
        if (L2 > MAX_STRETCH * MAX_STRETCH) { const m = MAX_STRETCH / Math.sqrt(L2); sx *= m; sy *= m; sz *= m; }
      }
      C[j] = sx; C[j + 1] = sy; C[j + 2] = sz; C[j + 3] = d[o + ROT];
      D[j] = add; D[j + 1] = d[o + VAR]; D[j + 2] = d[o + SOFT]; D[j + 3] = d[o + SHADE];
    }
    for (let k = 0; k < 4; k++) {
      const at = this.attrs[k];
      at.clearUpdateRanges();
      at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Ring pool: oriented quads drawing shock rings / air donuts / condensation disks / arc swooshes.
// ---------------------------------------------------------------------------------------------
const RS = 32;
const RP = {};
function rp() {
  RP.x = 0; RP.y = 0; RP.z = 0; RP.vx = 0; RP.vy = 0; RP.vz = 0; RP.follow = 0;
  RP.q = Q_GROUND; RP.R0 = 0.2; RP.R1 = 2; RP.rpow = 2.5; RP.life = 0.5; RP.delay = 0;
  RP.r = 1; RP.g = 1; RP.b = 1; RP.a = 0.5; RP.apow = 1.3; RP.fin = 0.06;
  RP.w0 = 0.3; RP.w1 = 0.15; RP.fill = 0; RP.add = 0; RP.noise = 0.5;
  RP.head = 0; RP.span = 0; RP.spin = 0; RP.sign = 1; RP.seed = Math.random() * 50;
  return RP;
}
const RING_VS = /* glsl */`
attribute vec4 aPosR;
attribute vec4 aQuat;
attribute vec4 aCol;
attribute vec4 aShape; // width, fill, additive, noise
attribute vec4 aArc;   // head angle, span (0 = full), direction sign, seed
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vShape;
varying vec4 vArc;
varying float vDist;
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec2 lp = position.xy * 2.1;
  vec3 wp = aPosR.xyz + qrot(aQuat, vec3(lp * aPosR.w, 0.0));
  vUv = lp; vCol = aCol; vShape = aShape; vArc = aArc;
  vDist = distance(wp, cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const RING_FS = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vShape;
varying vec4 vArc;
varying float vDist;
${GLSL_NOISE}
void main() {
  float r = length(vUv);
  if (r > 1.03) discard;
  float w = max(vShape.x, 0.015);
  float ang = atan(vUv.y, vUv.x);
  vec2 cs = vec2(cos(ang), sin(ang));
  float seed = vArc.w;
  // ragged front
  float nE = fxNoise(vec3(cs * 4.0 + seed, seed * 0.37));
  float edge = 1.0 - vShape.w * 0.05 * nE;
  float outer = 1.0 - smoothstep(edge - 0.035, edge, r);
  float inner = smoothstep(edge - w, edge - w * 0.3, r);
  // compressed front: brightest just behind the leading edge, second soft rim at the inner side
  float front = smoothstep(edge - w, edge - 0.02, r);
  float band = outer * inner * (0.3 + 0.7 * front * front);
  float fill = vShape.y * (1.0 - smoothstep(0.25, edge, r)) * (0.55 + 0.45 * smoothstep(0.0, 0.6, r));
  float m = band + fill;
  // radial striations + blotches
  float n1 = fxNoise(vec3(cs * 9.0 + seed, r * 2.5 + seed));
  float n2 = fxNoise(vec3(cs * 26.0 - seed, r * 5.0));
  m *= mix(1.0, 0.25 + 0.95 * n1 + 0.5 * (n2 - 0.5), vShape.w);
  if (vArc.y > 0.0) {
    float t = mod(vArc.z * (vArc.x - ang), 6.2831853) / vArc.y;
    if (t > 1.0) discard;
    m *= pow(1.0 - t, 1.5) * smoothstep(0.0, 0.035, t + 0.012);
  }
  float a = clamp(m, 0.0, 1.6) * vCol.a * smoothstep(0.45, 2.2, vDist);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * a, min(a, 1.0) * (1.0 - vShape.z));
}
`;

class RingPool {
  constructor(max) {
    this.max = max; this.n = 0;
    this.d = new Float32Array(max * RS);
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(quad.getIndex());
    g.setAttribute('position', quad.getAttribute('position'));
    const mk = (nm) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(nm, a);
      return a;
    };
    this.attrs = [mk('aPosR'), mk('aQuat'), mk('aCol'), mk('aShape'), mk('aArc')];
    g.instanceCount = 0;
    this.geo = g;
    this.uniforms = { uTime: { value: 0 } };
    this.mat = premulMaterial({
      uniforms: this.uniforms, vertexShader: RING_VS, fragmentShader: RING_FS,
      side: THREE.DoubleSide, defines: { FBM_OCT: 2 },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'fx.rings';
  }
  spawn(P) {
    if (this.n >= this.max) return -1;
    const o = this.n * RS, d = this.d;
    d[o] = P.x; d[o + 1] = P.y; d[o + 2] = P.z; d[o + 3] = P.vx; d[o + 4] = P.vy; d[o + 5] = P.vz;
    d[o + 6] = -P.delay; d[o + 7] = P.life; d[o + 8] = P.R0; d[o + 9] = P.R1; d[o + 10] = P.rpow;
    d[o + 11] = P.q.x; d[o + 12] = P.q.y; d[o + 13] = P.q.z; d[o + 14] = P.q.w;
    d[o + 15] = P.r; d[o + 16] = P.g; d[o + 17] = P.b; d[o + 18] = P.a; d[o + 19] = P.apow; d[o + 20] = P.fin;
    d[o + 21] = P.w0; d[o + 22] = P.w1; d[o + 23] = P.fill; d[o + 24] = P.add; d[o + 25] = P.noise;
    d[o + 26] = P.head; d[o + 27] = P.span; d[o + 28] = P.spin; d[o + 29] = P.sign; d[o + 30] = P.seed; d[o + 31] = P.follow;
    return this.n++;
  }
  simulate(dt, ply) {
    const d = this.d;
    let n = this.n;
    for (let i = 0; i < n; i++) {
      const o = i * RS;
      const age = d[o + 6] + dt;
      if (age >= d[o + 7]) {
        n--;
        if (i < n) { d.copyWithin(o, n * RS, n * RS + RS); i--; }
        continue;
      }
      d[o + 6] = age;
      const f = d[o + 31];
      d[o] += (d[o + 3] + ply.x * f) * dt;
      d[o + 1] += (d[o + 4] + ply.y * f) * dt;
      d[o + 2] += (d[o + 5] + ply.z * f) * dt;
      d[o + 26] += d[o + 28] * dt;
    }
    this.n = n;
  }
  upload() {
    const n = this.n;
    this.geo.instanceCount = n;
    if (n === 0) return;
    const d = this.d;
    const P = this.attrs[0].array, Q = this.attrs[1].array, C = this.attrs[2].array, H = this.attrs[3].array, A = this.attrs[4].array;
    for (let i = 0; i < n; i++) {
      const o = i * RS, j = i * 4;
      const age = d[o + 6];
      const t = clamp01(age / d[o + 7]);
      const R = d[o + 8] + (d[o + 9] - d[o + 8]) * (1 - Math.pow(1 - t, d[o + 10]));
      const fin = d[o + 20];
      const a = age < 0 ? 0 : d[o + 18] * (fin > 0 ? Math.min(t / fin, 1) : 1) * Math.pow(1 - t, d[o + 19]);
      P[j] = d[o]; P[j + 1] = d[o + 1]; P[j + 2] = d[o + 2]; P[j + 3] = R;
      Q[j] = d[o + 11]; Q[j + 1] = d[o + 12]; Q[j + 2] = d[o + 13]; Q[j + 3] = d[o + 14];
      C[j] = d[o + 15]; C[j + 1] = d[o + 16]; C[j + 2] = d[o + 17]; C[j + 3] = a;
      H[j] = lerp(d[o + 21], d[o + 22], t); H[j + 1] = d[o + 23]; H[j + 2] = d[o + 24]; H[j + 3] = d[o + 25];
      A[j] = d[o + 26]; A[j + 1] = d[o + 27]; A[j + 2] = d[o + 29]; A[j + 3] = d[o + 30];
    }
    for (let k = 0; k < 5; k++) {
      const at = this.attrs[k];
      at.clearUpdateRanges(); at.addUpdateRange(0, n * 4); at.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Shell pool: expanding fresnel spheres (sonic-boom shock shell, landing dome)
// ---------------------------------------------------------------------------------------------
const HS = 24;
const HP = {};
function hp() {
  HP.x = 0; HP.y = 0; HP.z = 0; HP.vx = 0; HP.vy = 0; HP.vz = 0; HP.follow = 0;
  HP.R0 = 0.5; HP.R1 = 10; HP.rpow = 2; HP.life = 0.6; HP.r = 1; HP.g = 1; HP.b = 1; HP.a = 0.5; HP.apow = 1.5;
  HP.fres = 3; HP.add = 0.6; HP.noise = 0.5; HP.fin = 0.05;
  return HP;
}
const SHELL_VS = /* glsl */`
attribute vec4 aPosR;
attribute vec4 aCol;
attribute vec4 aP; // fresnel power, seed, additive, noise
varying vec3 vN;
varying vec3 vW;
varying vec4 vCol;
varying vec4 vP;
void main() {
  vN = normalize(position);
  vec3 wp = aPosR.xyz + position * aPosR.w;
  vW = wp; vCol = aCol; vP = aP;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const SHELL_FS = /* glsl */`
varying vec3 vN;
varying vec3 vW;
varying vec4 vCol;
varying vec4 vP;
${GLSL_NOISE}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  float f = 1.0 - abs(dot(N, V));
  float fr = pow(f, vP.x);
  float n = fxNoise(N * 7.0 + vP.y) * 0.7 + fxNoise(N * 19.0 - vP.y) * 0.3;
  float a = vCol.a * fr * mix(1.0, 0.3 + 1.3 * n, vP.w);
  a *= smoothstep(0.0, 0.25, vW.y + 0.25); // ground contact softening
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * a, min(a, 1.0) * (1.0 - vP.z));
}
`;
class ShellPool {
  constructor(max, segs) {
    this.max = max; this.n = 0;
    this.d = new Float32Array(max * HS);
    const sph = new THREE.SphereGeometry(1, segs, Math.max(8, segs >> 1));
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(sph.getIndex());
    g.setAttribute('position', sph.getAttribute('position'));
    const mk = (nm) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(nm, a);
      return a;
    };
    this.attrs = [mk('aPosR'), mk('aCol'), mk('aP')];
    g.instanceCount = 0;
    this.geo = g;
    this.mat = premulMaterial({ vertexShader: SHELL_VS, fragmentShader: SHELL_FS, side: THREE.DoubleSide, defines: { FBM_OCT: 2 } });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.name = 'fx.shells';
  }
  spawn(P) {
    if (this.n >= this.max) {
      // replace the oldest-ish (slot 0)
      this.n = this.max - 1;
      this.d.copyWithin(0, this.n * HS, this.n * HS + HS);
    }
    const o = this.n * HS, d = this.d;
    d[o] = P.x; d[o + 1] = P.y; d[o + 2] = P.z; d[o + 3] = P.vx; d[o + 4] = P.vy; d[o + 5] = P.vz;
    d[o + 6] = 0; d[o + 7] = P.life; d[o + 8] = P.R0; d[o + 9] = P.R1; d[o + 10] = P.rpow;
    d[o + 11] = P.r; d[o + 12] = P.g; d[o + 13] = P.b; d[o + 14] = P.a; d[o + 15] = P.apow;
    d[o + 16] = P.fres; d[o + 17] = P.add; d[o + 18] = P.noise; d[o + 19] = P.follow; d[o + 20] = Math.random() * 40; d[o + 21] = P.fin;
    return this.n++;
  }
  simulate(dt, ply) {
    const d = this.d;
    let n = this.n;
    for (let i = 0; i < n; i++) {
      const o = i * HS;
      const age = d[o + 6] + dt;
      if (age >= d[o + 7]) {
        n--;
        if (i < n) { d.copyWithin(o, n * HS, n * HS + HS); i--; }
        continue;
      }
      d[o + 6] = age;
      const f = d[o + 19];
      d[o] += (d[o + 3] + ply.x * f) * dt; d[o + 1] += (d[o + 4] + ply.y * f) * dt; d[o + 2] += (d[o + 5] + ply.z * f) * dt;
    }
    this.n = n;
  }
  upload() {
    const n = this.n;
    this.geo.instanceCount = n;
    if (n === 0) return;
    const d = this.d, P = this.attrs[0].array, C = this.attrs[1].array, Q = this.attrs[2].array;
    for (let i = 0; i < n; i++) {
      const o = i * HS, j = i * 4;
      const t = clamp01(d[o + 6] / d[o + 7]);
      P[j] = d[o]; P[j + 1] = d[o + 1]; P[j + 2] = d[o + 2];
      P[j + 3] = d[o + 8] + (d[o + 9] - d[o + 8]) * (1 - Math.pow(1 - t, d[o + 10]));
      C[j] = d[o + 11]; C[j + 1] = d[o + 12]; C[j + 2] = d[o + 13];
      C[j + 3] = d[o + 14] * Math.min(1, t / Math.max(d[o + 21], 1e-3)) * Math.pow(1 - t, d[o + 15]);
      Q[j] = d[o + 16]; Q[j + 1] = d[o + 20]; Q[j + 2] = d[o + 17]; Q[j + 3] = d[o + 18];
    }
    for (let k = 0; k < 3; k++) {
      const at = this.attrs[k];
      at.clearUpdateRanges(); at.addUpdateRange(0, n * 4); at.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Crater decals (pool of 3, round robin)
// ---------------------------------------------------------------------------------------------
const CRATER_VS = /* glsl */`
attribute vec4 aCr; // x, z, size, rotation
attribute vec4 aCv; // alpha, variant, reveal, -
varying vec2 vUv;
varying vec2 vLp;
varying float vA;
varying float vRev;
void main() {
  vec2 lp = position.xy;
  float c = cos(aCr.w), s = sin(aCr.w);
  vec2 rp = vec2(c * lp.x - s * lp.y, s * lp.x + c * lp.y) * aCr.z;
  vec3 wp = vec3(aCr.x + rp.x, 0.012, aCr.y - rp.y);
  vec2 cell = vec2(mod(aCv.y, 2.0), floor(aCv.y / 2.0));
  vUv = (lp + 0.5 + cell) * 0.5;
  vLp = lp * 2.0;
  vA = aCv.x; vRev = aCv.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const CRATER_FS = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec2 vLp;
varying float vA;
varying float vRev;
void main() {
  float r = length(vLp);
  float a = texture2D(uMap, vUv).a * vA;
  a *= 1.0 - smoothstep(vRev - 0.08, vRev, r); // cracks race outward
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(0.06, 0.056, 0.052) * a, a);
}
`;
class CraterPool {
  constructor(map, sunDir) {
    this.max = 3;
    this.age = new Float32Array(3).fill(99);
    this.life = new Float32Array(3).fill(1);
    this.next = 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(quad.getIndex());
    g.setAttribute('position', quad.getAttribute('position'));
    this.aCr = new THREE.InstancedBufferAttribute(new Float32Array(12), 4);
    this.aCv = new THREE.InstancedBufferAttribute(new Float32Array(12), 4);
    this.aCr.setUsage(THREE.DynamicDrawUsage); this.aCv.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCr', this.aCr); g.setAttribute('aCv', this.aCv);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = premulMaterial({
      uniforms: { uMap: { value: map } }, vertexShader: CRATER_VS, fragmentShader: CRATER_FS,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'fx.craters';
    // texture +u faces the sun (shadowed inner wall on the sun side)
    this.sunRot = Math.atan2(-sunDir.z, sunDir.x);
  }
  spawn(x, z, size, life) {
    const i = this.next; this.next = (this.next + 1) % 3;
    const A = this.aCr.array, V = this.aCv.array;
    A[i * 4] = x; A[i * 4 + 1] = z; A[i * 4 + 2] = size; A[i * 4 + 3] = this.sunRot + (Math.random() - 0.5) * 0.25;
    V[i * 4 + 1] = (Math.random() * 4) | 0;
    this.age[i] = 0; this.life[i] = life;
  }
  update(dt) {
    const V = this.aCv.array;
    let top = 0;
    for (let i = 0; i < 3; i++) {
      this.age[i] += dt;
      const t = this.age[i], L = this.life[i];
      const a = t >= L ? 0 : smooth(0, 0.04, t) * (1 - smooth(L - 2.0, L, t));
      V[i * 4] = a;
      V[i * 4 + 2] = 0.25 + 1.0 * smooth(0, 0.22, t);
      if (a > 0) top = i + 1;
    }
    this.geo.instanceCount = top;
    if (top > 0) {
      this.aCr.needsUpdate = true; this.aCv.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Debris chunks (white cubes, bounce on y = 0)
// ---------------------------------------------------------------------------------------------
class DebrisPool {
  constructor(scene, max) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.q = new Float32Array(max * 4); this.w = new Float32Array(max * 3);
    this.s = new Float32Array(max); this.age = new Float32Array(max); this.life = new Float32Array(max);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.Color();
    for (let i = 0; i < max; i++) {
      const k = 0.72 + Math.random() * 0.22;
      this.mesh.setColorAt(i, c.setRGB(k, k * 0.99, k * 0.97));
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'fx.debris';
    scene.add(this.mesh);
  }
  spawn(x, y, z, vx, vy, vz, size, life) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    _q0.setFromAxisAngle(_v0.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), Math.random() * TAU);
    this.q[i * 4] = _q0.x; this.q[i * 4 + 1] = _q0.y; this.q[i * 4 + 2] = _q0.z; this.q[i * 4 + 3] = _q0.w;
    this.w[i * 3] = rnd(-14, 14); this.w[i * 3 + 1] = rnd(-14, 14); this.w[i * 3 + 2] = rnd(-14, 14);
    this.s[i] = size; this.age[i] = 0; this.life[i] = life;
  }
  _copy(dst, src) {
    this.p.copyWithin(dst * 3, src * 3, src * 3 + 3); this.v.copyWithin(dst * 3, src * 3, src * 3 + 3);
    this.q.copyWithin(dst * 4, src * 4, src * 4 + 4); this.w.copyWithin(dst * 3, src * 3, src * 3 + 3);
    this.s[dst] = this.s[src]; this.age[dst] = this.age[src]; this.life[dst] = this.life[src];
  }
  update(dt) {
    let n = this.n;
    const p = this.p, v = this.v, q = this.q, w = this.w;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { n--; if (i < n) { this._copy(i, n); i--; } continue; }
      const i3 = i * 3, i4 = i * 4;
      const hs = this.s[i] * 0.5;
      v[i3 + 1] -= 9.81 * dt;
      const k = Math.exp(-0.25 * dt);
      v[i3] *= k; v[i3 + 2] *= k;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (p[i3 + 1] < hs) {
        p[i3 + 1] = hs;
        if (v[i3 + 1] < 0) {
          v[i3 + 1] = -v[i3 + 1] * 0.34;
          if (v[i3 + 1] < 0.6) v[i3 + 1] = 0;
          v[i3] *= 0.6; v[i3 + 2] *= 0.6;
          w[i3] *= 0.55; w[i3 + 1] *= 0.55; w[i3 + 2] *= 0.55;
        }
        // rolling friction on the floor
        const fk = Math.exp(-3 * dt);
        v[i3] *= fk; v[i3 + 2] *= fk; w[i3] *= fk; w[i3 + 1] *= fk; w[i3 + 2] *= fk;
      }
      const wx = w[i3], wy = w[i3 + 1], wz = w[i3 + 2];
      const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
      _q0.set(q[i4], q[i4 + 1], q[i4 + 2], q[i4 + 3]);
      if (wl > 1e-4) {
        _q1.setFromAxisAngle(_v0.set(wx / wl, wy / wl, wz / wl), wl * dt);
        _q0.premultiply(_q1).normalize();
        q[i4] = _q0.x; q[i4 + 1] = _q0.y; q[i4 + 2] = _q0.z; q[i4 + 3] = _q0.w;
      }
      const rem = this.life[i] - this.age[i];
      const sc = this.s[i] * Math.min(1, rem / 0.6) * Math.min(1, this.age[i] / 0.03 + 0.3);
      _sc.set(sc, sc, sc);
      _v1.set(p[i3], p[i3 + 1], p[i3 + 2]);
      _m0.compose(_v1, _q0, _sc);
      this.mesh.setMatrixAt(i, _m0);
    }
    this.n = n;
    this.mesh.count = n;
    if (n > 0) {
      const im = this.mesh.instanceMatrix;
      im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Speed wind lines (GPU-animated, zero CPU per line)
// ---------------------------------------------------------------------------------------------
const LINES_VS = /* glsl */`
attribute vec4 aSeed; // angle, radius, phase, rand
uniform vec3 uCenter;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uFlow;
uniform float uBox;
uniform float uLen;
uniform float uDensity;
uniform float uAlpha;
uniform float uWidth;
uniform float uPix;
varying float vA;
varying float vU;
varying float vV;
void main() {
  float vis = step(aSeed.w, uDensity);
  float ang = aSeed.x * 6.2831853;
  float rad = mix(1.6, 11.0, aSeed.y * aSeed.y);
  float spd = 0.75 + 0.5 * fract(aSeed.w * 7.13);
  float ph = fract(aSeed.z - uFlow * spd / uBox);
  float along = (ph - 0.5) * uBox;
  vec3 head = uCenter + (uRight * cos(ang) + uUp * sin(ang)) * rad + uFwd * along;
  float len = uLen * (0.55 + 0.9 * fract(aSeed.w * 3.71));
  float u = position.x + 0.5;
  vec3 p = head - uFwd * (u * len);
  vec3 V = normalize(cameraPosition - p);
  vec3 side = cross(uFwd, V);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : uRight;
  float dist = distance(cameraPosition, p);
  float w = max(uWidth, dist * uPix * 1.3);
  p += side * position.y * w;
  vA = vis * uAlpha * (uWidth / w) * sin(3.14159 * ph) * smoothstep(1.2, 4.5, dist) * (1.0 - smoothstep(32.0, 55.0, dist));
  vU = u; vV = position.y * 2.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const LINES_FS = /* glsl */`
uniform vec3 uColor;
uniform float uAdd;
varying float vA;
varying float vU;
varying float vV;
void main() {
  float a = vA * (1.0 - vV * vV) * smoothstep(0.0, 0.06, vU) * pow(1.0 - vU, 1.3);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, a * (1.0 - uAdd));
}
`;

// ---------------------------------------------------------------------------------------------
// Ribbon trails
// ---------------------------------------------------------------------------------------------
const RIB_VS = /* glsl */`
attribute vec4 aCol;
attribute vec2 aSA;
varying vec4 vCol;
varying float vSide;
varying float vAdd;
varying float vDist;
void main() {
  vCol = aCol; vSide = aSA.x; vAdd = aSA.y;
  vDist = distance(position, cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;
const RIB_FS = /* glsl */`
varying vec4 vCol;
varying float vSide;
varying float vAdd;
varying float vDist;
void main() {
  float x = abs(vSide);
  float prof = (1.0 - x * x) * (0.6 + 0.4 * (1.0 - smoothstep(0.0, 0.35, x)));
  float a = vCol.a * prof * smoothstep(1.2, 5.0, vDist);
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol.rgb * a, a * (1.0 - vAdd));
}
`;
class Ribbons {
  constructor(count, segs) {
    this.count = count; this.N = segs;
    const N = segs, V = count * N * 2;
    this.hist = [];
    for (let r = 0; r < count; r++) {
      this.hist.push({
        p: new Float32Array(N * 3), t: new Float32Array(N), I: new Float32Array(N), F: new Float32Array(N),
        head: 0, len: 0, last: -1, sx: 1, sy: 0, sz: 0,
      });
    }
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(V * 3), 3); this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.BufferAttribute(new Float32Array(V * 4), 4); this.col.setUsage(THREE.DynamicDrawUsage);
    this.sa = new THREE.BufferAttribute(new Float32Array(V * 2), 2); this.sa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('aCol', this.col); g.setAttribute('aSA', this.sa);
    const idx = [];
    for (let r = 0; r < count; r++) {
      const b = r * N * 2;
      for (let k = 0; k < N - 1; k++) {
        const a0 = b + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
    g.setIndex(idx);
    this.geo = g;
    this.mat = premulMaterial({ vertexShader: RIB_VS, fragmentShader: RIB_FS, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'fx.ribbons';
    this.alive = false;
  }
  // samples newest-first; head sample tracks the limb every frame
  push(r, x, y, z, time, I, F) {
    const h = this.hist[r], N = this.N;
    if (h.len > 0) {
      const o = h.head * 3;
      const dx = x - h.p[o], dy = y - h.p[o + 1], dz = z - h.p[o + 2];
      if (dx * dx + dy * dy + dz * dz > 250 * 250) h.len = 0; // teleport
    }
    if (h.len === 0 || time - h.last >= 1 / 125) {
      h.head = (h.head + 1) % N;
      h.len = Math.min(h.len + 1, N);
      h.last = time;
      h.t[h.head] = time;
    }
    const o = h.head * 3;
    h.p[o] = x; h.p[o + 1] = y; h.p[o + 2] = z;
    h.I[h.head] = I; h.F[h.head] = F;
  }
  build(time, camPos, life, width, fireWidth, maxLen, pixAngle) {
    const N = this.N, P = this.pos.array, C = this.col.array, SA = this.sa.array;
    let any = false;
    for (let r = 0; r < this.count; r++) {
      const h = this.hist[r];
      const base = r * N * 2;
      let lastX = 0, lastY = 0, lastZ = 0, valid = 0, maxA = 0, cum = 0;
      for (let k = 0; k < N; k++) {
        const idx = (h.head - k + N * 2) % N;
        const age = time - h.t[idx];
        const fire = h.F[idx];
        const L = life * (1 + 0.6 * fire);
        const a = k < h.len ? clamp01(1 - age / L) : 0;
        const vi = (base + k * 2);
        if (a <= 0) {
          // collapse dead tail onto the last live sample
          for (let s = 0; s < 2; s++) {
            const v = vi + s;
            P[v * 3] = lastX; P[v * 3 + 1] = lastY; P[v * 3 + 2] = lastZ;
            C[v * 4 + 3] = 0;
          }
          continue;
        }
        const o = idx * 3;
        const x = h.p[o], y = h.p[o + 1], z = h.p[o + 2];
        if (valid > 0) { const ex = x - lastX, ey = y - lastY, ez = z - lastZ; cum += Math.sqrt(ex * ex + ey * ey + ez * ez); }
        const lenFade = 1 - smooth(maxLen * 0.45, maxLen, cum);
        // tangent: neighbours
        const iPrev = (idx + 1) % N, iNext = (idx - 1 + N) % N;
        const hasPrev = k > 0, hasNext = k + 1 < h.len;
        const ax = hasPrev ? h.p[iPrev * 3] : x, ay = hasPrev ? h.p[iPrev * 3 + 1] : y, az = hasPrev ? h.p[iPrev * 3 + 2] : z;
        const bx = hasNext ? h.p[iNext * 3] : x, by = hasNext ? h.p[iNext * 3 + 1] : y, bz = hasNext ? h.p[iNext * 3 + 2] : z;
        const tx = ax - bx, ty = ay - by, tz = az - bz;
        const vx = camPos.x - x, vy = camPos.y - y, vz = camPos.z - z;
        let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
        const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (sl > 1e-6) { sx /= sl; sy /= sl; sz /= sl; h.sx = sx; h.sy = sy; h.sz = sz; } else { sx = h.sx; sy = h.sy; sz = h.sz; }
        const I = h.I[idx];
        const dc = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        const endOn = tl > 1e-6 ? Math.abs(tx * vx + ty * vy + tz * vz) / (tl * dc + 1e-6) : 0;
        const alignFade = 1 - smooth(0.8, 0.985, endOn);
        const wv = Math.min(lerp(width, fireWidth, fire), dc * pixAngle * 3.5) * Math.pow(a, 0.55) * (k === 0 ? 0.55 : 1) * (0.35 + 0.65 * I);
        const alpha = I * Math.pow(a, 1.35) * lerp(0.6, 0.9, fire) * lenFade * alignFade;
        // colour: cool white-blue, or incandescent ramp
        fireRamp(clamp01(0.12 + Math.max(age / L, cum / maxLen) * 1.1), _rgb);
        const heat = 2.8 * (1 - 0.5 * age / L);
        const cr = lerp(1.0, _rgb[0] * heat, fire), cg = lerp(1.1, _rgb[1] * heat, fire), cb = lerp(1.35, _rgb[2] * heat, fire);
        const add = lerp(0.45, 0.55, fire);
        for (let s = 0; s < 2; s++) {
          const v = vi + s, sg = s === 0 ? -1 : 1;
          P[v * 3] = x + sx * wv * sg; P[v * 3 + 1] = y + sy * wv * sg; P[v * 3 + 2] = z + sz * wv * sg;
          C[v * 4] = cr; C[v * 4 + 1] = cg; C[v * 4 + 2] = cb; C[v * 4 + 3] = alpha;
          SA[v * 2] = sg; SA[v * 2 + 1] = add;
        }
        lastX = x; lastY = y; lastZ = z;
        valid++;
        if (alpha > maxA) maxA = alpha;
      }
      if (valid > 1 && maxA > 0.003) any = true;
    }
    this.pos.needsUpdate = true; this.col.needsUpdate = true; this.sa.needsUpdate = true;
    this.alive = any;
  }
}

// ---------------------------------------------------------------------------------------------
// Vapor cone (Prandtl–Glauert condensation bell)
// ---------------------------------------------------------------------------------------------
const VAPOR_VS = /* glsl */`
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vUv = uv;
  float ph = uv.x * 6.2831853;
  float rip = fxNoise(vec3(cos(ph) * 3.0, sin(ph) * 3.0, uv.y * 3.0 - uTime * 5.0)) - 0.5;
  vec3 p = position + normal * rip * 0.09 * uv.y;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const VAPOR_FS = /* glsl */`
uniform float uTime;
uniform float uI;
uniform vec3 uColor;
uniform vec3 uAxis;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float ndv = abs(dot(normalize(vN), V));
  float thick = clamp(0.2 / max(ndv, 0.13), 0.0, 1.5);
  float s = vUv.y;
  float ph = vUv.x * 6.2831853;
  vec2 cs = vec2(cos(ph), sin(ph));
  float n1 = fxNoise(vec3(cs * 9.0, s * 1.6 - uTime * 3.2));
  float n2 = fxNoise(vec3(cs * 31.0, s * 3.5 - uTime * 7.5 + 3.0));
  float n3 = fxFbm(vec3(cs * 3.5, s * 2.5 - uTime * 1.7));
  float streak = smoothstep(0.15, 0.95, n1 * 0.45 + n2 * 0.3 + n3 * 0.4);
  float rim = 0.9 + 0.05 * fxNoise(vec3(cs * 15.0, uTime * 3.0)) + 0.04 * fxNoise(vec3(cs * 4.0, uTime * 1.3));
  float dens = smoothstep(0.02, 0.55, s) * (1.0 - smoothstep(rim - 0.035, rim, s));
  float a = dens * thick * (0.5 + 0.55 * streak) * (0.7 + 0.6 * n3);
  // condensation is densest right before the shock (aft lip), which ends abruptly
  a += 0.7 * smoothstep(rim - 0.3, rim - 0.04, s) * (1.0 - smoothstep(rim - 0.035, rim, s)) * thick * (0.7 + 0.5 * n1);
  // seen along the axis (chase camera) keep it see-through so the hero stays readable
  float along = abs(dot(uAxis, V));
  a *= mix(1.0, 0.5, along * along);
  a = clamp(a * uI * 1.25, 0.0, 0.9);
  if (a < 0.003) discard;
  // sunlit top, slightly shaded underside
  float lit = 0.86 + 0.2 * clamp(vN.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = uColor * lit * mix(0.88, 1.08, streak) * mix(0.93, 1.05, n3);
  gl_FragColor = vec4(col * a, a);
}
`;
function makeVaporGeometry(radial, rings, R, L) {
  const g = new THREE.BufferGeometry();
  const pos = [], nor = [], uv = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const s = j / rings;
    const r = R * (0.08 + 0.92 * Math.pow(s, 0.6)) * (1 + 0.16 * Math.pow(s, 5));
    const ds = 1e-3;
    const s2 = Math.min(1, s + ds), s1 = Math.max(0, s - ds);
    const r2 = R * (0.08 + 0.92 * Math.pow(s2, 0.6)) * (1 + 0.16 * Math.pow(s2, 5));
    const r1 = R * (0.08 + 0.92 * Math.pow(s1, 0.6)) * (1 + 0.16 * Math.pow(s1, 5));
    const drds = (r2 - r1) / (s2 - s1);
    for (let i = 0; i <= radial; i++) {
      const ph = (i / radial) * TAU;
      const c = Math.cos(ph), sn = Math.sin(ph);
      pos.push(c * r, sn * r, -s * L);
      const nx = c * L, ny = sn * L, nz = drds;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nor.push(nx / nl, ny / nl, nz / nl);
      uv.push(i / radial, s);
    }
  }
  const row = radial + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Bow shock / meteor plasma: one mesh = paraboloid sheath (part 0) + wake plume (part 1).
// position attribute carries (part, s, phi); geometry is evaluated in the vertex shader.
// local +Z = velocity direction, origin = body centre.
// ---------------------------------------------------------------------------------------------
const PLASMA_VS = /* glsl */`
uniform float uTime;
uniform float uLen;
uniform float uRad;
uniform float uNose;
uniform float uBack;
uniform float uTaper;
varying vec3 vN;
varying vec3 vW;
varying vec3 vD; // part, s, phi
${GLSL_NOISE}
void main() {
  float part = position.x;
  float s = max(position.y, 0.0005);
  float ph = position.z;
  vec2 cs = vec2(cos(ph), sin(ph));
  float r, z, drds, dzds;
  if (part < 0.5) {
    r = uRad * pow(s, 0.85);
    z = uNose - uBack * pow(s, 1.9);
    drds = uRad * 0.85 * pow(s, -0.15);
    dzds = -uBack * 1.9 * pow(s, 0.9);
    float n = fxNoise(vec3(cs * 2.6, s * 3.0 - uTime * 5.0));
    r *= 1.0 + (n - 0.5) * 0.22 * s;
    z += (n - 0.5) * 0.12 * s;
  } else {
    float dist = s * uLen;
    float e = exp(-dist / uTaper);
    r = uRad * 0.97 * (0.1 + 0.9 * e);
    z = uNose - uBack + 0.45 - dist;
    drds = -uRad * 0.97 * 0.9 * e * uLen / uTaper;
    dzds = -uLen;
    float n = fxNoise(vec3(cs * 2.0, dist * 0.16 - uTime * 16.0));
    r *= 1.0 + (n - 0.5) * (0.5 * (1.0 - e) + 0.14);
  }
  vec3 lp = vec3(cs * r, z);
  vec3 ln = normalize(vec3(cs * (-dzds), drds));
  vec4 wp = modelMatrix * vec4(lp, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * ln);
  vD = vec3(part, s, ph);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const PLASMA_FS = /* glsl */`
uniform float uTime;
uniform float uI;
uniform float uLen;
uniform float uOcc;
uniform float uTaper;
varying vec3 vN;
varying vec3 vW;
varying vec3 vD;
${GLSL_NOISE}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float ndv = abs(dot(normalize(vN), V));
  float s = vD.y;
  vec2 cs = vec2(cos(vD.z), sin(vD.z));
  vec3 col;
  float a;
  float occ;
  if (vD.x < 0.5) {
    // sheath: stagnation point white-hot, cooling to orange and deep red at the rim, turbulent flow streaming back
    float n1 = fxFbm(vec3(cs * 3.0, s * 3.4 - uTime * 6.0));
    float n2 = fxNoise(vec3(cs * 13.0, s * 2.2 - uTime * 9.0));   // streaks along the flow
    float n3 = fxNoise(vec3(cs * 27.0, s * 4.0 - uTime * 15.0));
    float streak = n2 * 0.65 + n3 * 0.35;
    float T = pow(1.0 - s, 1.5) * (0.8 + 0.4 * n1) + 0.14 * (streak - 0.5) * (1.0 - s);
    float edge = 0.78 + 0.26 * n1 * (0.6 + 0.6 * streak);
    a = 1.0 - smoothstep(edge - 0.25, edge + 0.04, s);
    a *= mix(mix(0.45, 1.0, smoothstep(0.55, 0.9, T)), 1.5, pow(1.0 - ndv, 1.6));
    a *= mix(1.0, 0.3 + 1.2 * streak, smoothstep(0.15, 0.7, s));
    a = min(1.0, a * 2.3);
    col = fxHeat(T);
    // 밝은 하늘 위에서도 불꽃색이 살도록 배경을 충분히 가림 (가장 뜨거운 코어만 순수 가산)
    occ = uOcc * (1.0 - 0.75 * smoothstep(0.7, 0.96, T)) * (0.75 + 0.25 * smoothstep(0.2, 0.7, s));
  } else {
    // wake plume: incandescent gas train
    float z = s * uLen;
    float n1 = fxFbm(vec3(cs * 2.2, z * 0.2 - uTime * 15.0));
    float n2 = fxNoise(vec3(cs * 6.5, z * 0.55 - uTime * 34.0));
    float T = 0.55 * exp(-z / (uTaper * 2.5)) * (0.6 + 0.7 * n1) + 0.06 * n2;
    a = (1.0 - smoothstep(0.35 + 0.35 * n1, 1.0, s)) * smoothstep(0.0, 0.05, s);
    a *= (0.3 + 0.85 * pow(ndv, 0.8)) * (0.6 + 0.7 * n2);
    a *= smoothstep(1.5, 4.0, distance(cameraPosition, vW));
    a = min(1.0, a * 2.8);
    col = fxHeat(T);
    occ = uOcc;
  }
  a *= uI;
  if (a < 0.002) discard;
  gl_FragColor = vec4(col * a, clamp(a * occ, 0.0, 0.97));
}
`;
function makePlasmaGeometry(shellRings, shellRadial, plumeRings, plumeRadial) {
  const pos = [], idx = [];
  const grid = (part, rings, radial) => {
    const base = pos.length / 3;
    for (let j = 0; j <= rings; j++) {
      const s = j / rings;
      const ss = part === 0 ? s : s * s * 0.65 + s * 0.35; // denser plume samples near the body
      for (let i = 0; i <= radial; i++) pos.push(part, ss, (i / radial) * TAU);
    }
    const row = radial + 1;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < radial; i++) {
        const a = base + j * row + i, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
  };
  grid(0, shellRings, shellRadial);
  grid(1, plumeRings, plumeRadial);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// =============================================================================================
// FX
// =============================================================================================
export class FX {
  constructor(scene, camera, hooks = {}, opts = { quality: 'high' }) {
    this.scene = scene;
    this.camera = camera;
    this.hooks = hooks || {};
    this.quality = (opts && opts.quality) === 'low' ? 'low' : 'high';
    const hi = this.quality === 'high';
    this.q = hi ? 1 : 0.45; // emission scale
    const sunDir = (opts && opts.sunDir) ? opts.sunDir.clone().normalize() : new THREE.Vector3(-0.42, 0.53, -0.74).normalize();

    // tunables (lead may tweak at runtime)
    this.params = {
      dust: new THREE.Color(0.8, 0.75, 0.68),  // linear dust colour (a touch darker/warmer than the lit white floor so it reads)
      dustBrightness: 1.0,
      vapor: new THREE.Color(1.05, 1.08, 1.12),
      windAlpha: 0.6,
      trailWidth: 0.05,     // half width (m)
      trailLife: 0.42,      // s
      trailMaxLen: 12,      // m (keeps trails from sweeping through the chase camera)
      plasmaLight: 16,      // candela at full plasma (light sits ~2 m ahead of the body)
      flashLight: 1.0,      // multiplier for one-shot light flashes
      plumeLength: 30,      // metres at full plasma
    };
    // live levels for audio/post (0..1)
    this.levels = { wind: 0, vapor: 0, plasma: 0, wake: 0, trail: 0 };

    this._t = 0;
    this._speed = 0;
    this._mach = 0;
    this._vel = new THREE.Vector3();
    this._dir = new THREE.Vector3(0, 0, 1);
    this._pos = new THREE.Vector3();
    this._camPrev = new THREE.Vector3().copy(camera.position);
    this._camPos = new THREE.Vector3().copy(camera.position);
    this._camVel = new THREE.Vector3();
    this._camRight = new THREE.Vector3(1, 0, 0);
    this._camUp = new THREE.Vector3(0, 1, 0);
    this._vaporKick = 0;
    this._acc = { fire: 0, smoke: 0, ember: 0, wake: 0, vap: 0, wakeFire: 0, wakeRing: 0 };
    this._warm = 3;
    this._lineFlow = 0;
    this._limbList = [null, null, null, null];
    this._pixAngle = 0.002;

    // ---- textures ----
    this.texSmoke = makeSmokeAtlas(hi ? 128 : 64);
    this.texGlow = makeGlowTex(hi ? 64 : 32);
    this.texCrater = makeCraterAtlas(hi ? 512 : 256);

    // ---- systems ----
    this.craters = new CraterPool(this.texCrater, sunDir);
    this.smoke = new ParticlePool(hi ? 1600 : 600, this.texSmoke, 2, 2, 'fx.smoke');
    this.glow = new ParticlePool(hi ? 1400 : 550, this.texGlow, 1, 8, 'fx.glow');
    this.rings = new RingPool(hi ? 64 : 32);
    this.shells = new ShellPool(3, hi ? 40 : 24);
    this.debris = new DebrisPool(scene, hi ? 64 : 24);
    this.ribbons = new Ribbons(4, hi ? 40 : 24);

    // wind lines
    const nLines = hi ? 170 : 70;
    {
      const quad = new THREE.PlaneGeometry(1, 1, 12, 1); // segmented so near-camera fade/width is sampled along the line
      const g = new THREE.InstancedBufferGeometry();
      g.setIndex(quad.getIndex());
      g.setAttribute('position', quad.getAttribute('position'));
      const seeds = new Float32Array(nLines * 4);
      for (let i = 0; i < nLines; i++) {
        seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.sqrt(Math.random());
        seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = (i + Math.random()) / nLines;
      }
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      g.instanceCount = nLines;
      this.lineU = {
        uCenter: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3(0, 0, 1) },
        uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
        uFlow: { value: 0 }, uBox: { value: 80 }, uLen: { value: 2 }, uDensity: { value: 0 }, uAlpha: { value: 0 },
        uWidth: { value: 0.03 }, uPix: { value: 0.002 }, uColor: { value: new THREE.Color(0.95, 0.98, 1.05) }, uAdd: { value: 0.35 },
      };
      this.lines = new THREE.Mesh(g, premulMaterial({ uniforms: this.lineU, vertexShader: LINES_VS, fragmentShader: LINES_FS }));
      this.lines.frustumCulled = false;
      this.lines.renderOrder = 7;
      this.lines.name = 'fx.windLines';
    }

    // vapor cone
    this.vaporU = { uTime: { value: 0 }, uI: { value: 0 }, uColor: { value: this.params.vapor }, uAxis: { value: new THREE.Vector3(0, 0, 1) } };
    this.vapor = new THREE.Mesh(
      makeVaporGeometry(hi ? 56 : 32, hi ? 22 : 14, 1.45, 3.1),
      premulMaterial({ uniforms: this.vaporU, vertexShader: VAPOR_VS, fragmentShader: VAPOR_FS, side: THREE.DoubleSide, defines: { FBM_OCT: hi ? 3 : 2 } }),
    );
    this.vapor.frustumCulled = false;
    this.vapor.renderOrder = 5;
    this.vapor.name = 'fx.vaporCone';

    // plasma sheath + plume
    this.plasmaU = {
      uTime: { value: 0 }, uI: { value: 0 }, uLen: { value: 20 }, uRad: { value: 1.65 }, uNose: { value: 1.75 }, uBack: { value: 3.2 },
      uTaper: { value: 3.2 }, uOcc: { value: 1.0 },
    };
    this.plasma = new THREE.Mesh(
      hi ? makePlasmaGeometry(30, 64, 44, 40) : makePlasmaGeometry(18, 36, 24, 24),
      new THREE.ShaderMaterial(Object.assign({}, PREMUL, {
        uniforms: this.plasmaU, vertexShader: PLASMA_VS, fragmentShader: PLASMA_FS, side: THREE.DoubleSide,
        defines: { FBM_OCT: hi ? 3 : 2 },
      })),
    );
    this.plasma.frustumCulled = false;
    this.plasma.renderOrder = 9;
    this.plasma.name = 'fx.bowShock';

    // the one fx light (always in scene; intensity 0 when idle)
    this.light = new THREE.PointLight(0xff7a2a, 0, 90, 2);
    this.light.castShadow = false;
    this.light.name = 'fx.light';
    this._lightFlash = { I: 0, tau: 0.2, age: 9, r: 1, g: 1, b: 1, pos: new THREE.Vector3() };
    this._plasmaColor = new THREE.Color(1.0, 0.42, 0.13);

    for (const m of [this.craters.mesh, this.smoke.mesh, this.rings.mesh, this.shells.mesh, this.vapor,
      this.ribbons.mesh, this.lines, this.glow.mesh, this.plasma, this.light]) scene.add(m);
  }

  // ---------------------------------------------------------------- hooks
  _hook(name, a, b) {
    const f = this.hooks[name];
    if (typeof f === 'function') {
      try { f(a, b); } catch (e) { /* never let a hook break fx */ }
    }
  }
  _hookPos(x, y, z) {
    const v = HOOK_VECS[hookVecI]; hookVecI = (hookVecI + 1) % HOOK_VECS.length;
    return v.set(x, y, z);
  }
  _flashLight(x, y, z, I, tau, r, g, b) {
    const L = this._lightFlash;
    L.I = I * this.params.flashLight; L.tau = tau; L.age = 0; L.r = r; L.g = g; L.b = b; L.pos.set(x, y, z);
  }
  _dust(P, k = 1) {
    const c = this.params.dust, br = this.params.dustBrightness * k;
    const j = 0.94 + Math.random() * 0.1;
    P.r0 = P.r1 = c.r * br * j; P.g0 = P.g1 = c.g * br * j; P.b0 = P.b1 = c.b * br * j;
    return P;
  }
  _white(P, k = 1) {
    const c = this.params.vapor;
    P.r0 = P.r1 = c.r * k; P.g0 = P.g1 = c.g * k; P.b0 = P.b1 = c.b * k;
    return P;
  }
  _ringDust(R) {
    const c = this.params.dust, br = this.params.dustBrightness * 0.9;
    R.r = c.r * br; R.g = c.g * br; R.b = c.b * br;
    return R;
  }

  // ground radial dust burst (shared by jump/land/takeoff/heroLanding)
  _groundBurst(gx, gz, n, r0, r1, spd0, spd1, up0, up1, s0, s1, life0, life1, alpha, drag) {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rnd(-0.5, 0.5) * (TAU / n);
      const c = Math.cos(ang), s = Math.sin(ang);
      const r = rnd(r0, r1), spd = rnd(spd0, spd1);
      const P = this._dust(sp());
      P.x = gx + c * r; P.y = rnd(0.08, 0.35); P.z = gz + s * r;
      P.vx = c * spd; P.vy = rnd(up0, up1); P.vz = s * spd;
      P.life = rnd(life0, life1); P.s0 = s0 * rnd(0.7, 1.1); P.s1 = s1 * rnd(0.75, 1.25); P.spow = 3;
      P.a = alpha * rnd(0.7, 1.0); P.fin = 0.05; P.fpow = 1.4; P.drag = drag; P.grav = -0.25;
      P.rotv = rnd(-0.8, 0.8); P.soft = 0.3; P.bounce = 0.15;
      this.smoke.spawn(P);
    }
  }

  // ================================================================ one-shots
  jump(pos, strength = 1) {
    const s = clamp01(strength);
    const g = 1 - smooth(1.2, 4, pos.y);
    if (g <= 0) return;
    const gx = pos.x, gz = pos.z;
    this._groundBurst(gx, gz, Math.round((7 + 10 * s) * this.q) + 2, 0.15, 0.5, 1.2, 3.4 * (0.7 + 0.5 * s), 0.1, 1.1,
      0.28, 1.0 * (0.75 + 0.5 * s), 0.5, 1.0, 0.42 * g, 3.2);
    const R = this._ringDust(rp());
    R.x = gx; R.y = 0.03; R.z = gz; R.R0 = 0.3; R.R1 = 1.4 + 0.8 * s; R.rpow = 2.6; R.life = 0.45;
    R.a = 0.32 * g; R.w0 = 0.4; R.w1 = 0.2; R.noise = 0.7;
    this.rings.spawn(R);
  }

  step(pos, strength = 1) {
    const s = clamp01(strength);
    if (pos.y > 1.2 || s <= 0.02) return;
    const n = this.quality === 'high' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * TAU;
      const P = this._dust(sp());
      P.x = pos.x + rnd(-0.1, 0.1); P.y = 0.06; P.z = pos.z + rnd(-0.1, 0.1);
      P.vx = Math.cos(ang) * rnd(0.3, 1.2) * s - this._vel.x * 0.08; P.vy = rnd(0.2, 0.7); P.vz = Math.sin(ang) * rnd(0.3, 1.2) * s - this._vel.z * 0.08;
      P.life = rnd(0.35, 0.6); P.s0 = 0.1; P.s1 = rnd(0.32, 0.5) * (0.6 + 0.6 * s); P.a = 0.3 * s; P.drag = 3.5;
      P.soft = 0.12; P.bounce = 0.1; P.fin = 0.08;
      this.smoke.spawn(P);
    }
  }

  land(pos, strength = 1) {
    const s = clamp01(strength);
    const gx = pos.x, gz = pos.z;
    this._groundBurst(gx, gz, Math.round((12 + 30 * s) * this.q) + 3, 0.2, 0.7, 2.5 + 3 * s, 4 + 9 * s, 0.1, 0.9 + s,
      0.35, 1.0 + 1.6 * s, 0.7, 1.4 + 0.6 * s, 0.5, 2.8);
    const R = this._ringDust(rp());
    R.x = gx; R.y = 0.03; R.z = gz; R.R0 = 0.4; R.R1 = 1.6 + 4 * s; R.rpow = 2.8; R.life = 0.55 + 0.3 * s;
    R.a = 0.4; R.w0 = 0.45; R.w1 = 0.2; R.noise = 0.75;
    this.rings.spawn(R);
    if (s > 0.45) {
      const R2 = rp();
      R2.x = gx; R2.y = 0.05; R2.z = gz; R2.R0 = 0.3; R2.R1 = 3 + 5 * s; R2.rpow = 2.2; R2.life = 0.35;
      R2.r = 1.25; R2.g = 1.27; R2.b = 1.35; R2.a = 0.35 * s; R2.w0 = 0.12; R2.w1 = 0.06; R2.add = 0.5; R2.noise = 0.4;
      this.rings.spawn(R2);
    }
    this._hook('shake', 0.1 + 0.32 * s);
  }

  heroLanding(pos, strength = 1) {
    const s = clamp01(strength);
    const hi = this.quality === 'high';
    const gx = pos.x, gz = pos.z;
    // crater
    this.craters.spawn(gx, gz, 4.5 + 3.5 * s, 6.5);
    // flash disk at impact
    let R = rp();
    R.x = gx; R.y = 0.06; R.z = gz; R.R0 = 0.4; R.R1 = 3.2 + s; R.rpow = 3; R.life = 0.18; R.fill = 1.0;
    R.r = 2.6; R.g = 2.45; R.b = 2.2; R.a = 0.8; R.w0 = 0.06; R.w1 = 0.04; R.add = 0.9; R.noise = 0.5; R.fin = 0.01; R.apow = 1.8;
    this.rings.spawn(R);
    // bright shock front racing over the floor
    R = rp();
    R.x = gx; R.y = 0.05; R.z = gz; R.R0 = 0.5; R.R1 = 13 + 7 * s; R.rpow = 2.0; R.life = 0.55;
    R.r = 1.3; R.g = 1.31; R.b = 1.4; R.a = 0.5; R.w0 = 0.1; R.w1 = 0.04; R.add = 0.5; R.noise = 0.55; R.fin = 0.02; R.apow = 1.6;
    this.rings.spawn(R);
    // heavy dust ring
    R = this._ringDust(rp());
    R.x = gx; R.y = 0.04; R.z = gz; R.R0 = 0.8; R.R1 = 7 + 3.5 * s; R.rpow = 3.2; R.life = 1.3;
    R.a = 0.6; R.w0 = 0.5; R.w1 = 0.3; R.noise = 0.85; R.fin = 0.03; R.apow = 1.2;
    this.rings.spawn(R);
    // dusty shock skirt racing out right behind the bright front
    R = this._ringDust(rp());
    R.x = gx; R.y = 0.03; R.z = gz; R.R0 = 0.6; R.R1 = 10 + 5 * s; R.rpow = 2.4; R.life = 0.75;
    R.a = 0.55; R.w0 = 0.3; R.w1 = 0.12; R.noise = 0.8; R.fin = 0.02; R.apow = 1.4;
    this.rings.spawn(R);
    // crown splash: dust jets thrown up and out at ~45 deg
    const nJ = Math.round((26 + 14 * s) * this.q) + 6;
    for (let i = 0; i < nJ; i++) {
      const ang = (i / nJ) * TAU + rnd(-0.12, 0.12);
      const c = Math.cos(ang), sn = Math.sin(ang);
      const v = rnd(7, 13) * (0.7 + 0.4 * s);
      const P = this._dust(sp(), 1.04);
      P.x = gx + c * 0.6; P.y = 0.3; P.z = gz + sn * 0.6;
      P.vx = c * v; P.vy = v * rnd(0.6, 1.1); P.vz = sn * v;
      P.life = rnd(0.7, 1.2); P.s0 = 0.35; P.s1 = rnd(1.3, 2.2); P.a = 0.55; P.drag = 2.6; P.grav = 4; P.soft = 0.3;
      P.smode = 1; P.sk = 0.03; P.fpow = 1.3;
      this.smoke.spawn(P);
    }
    // second delayed dust ring
    R = this._ringDust(rp());
    R.x = gx; R.y = 0.04; R.z = gz; R.R0 = 0.5; R.R1 = 4 + 2 * s; R.rpow = 2.5; R.life = 1.1; R.delay = 0.08;
    R.a = 0.4; R.w0 = 0.7; R.w1 = 0.45; R.noise = 0.9; R.apow = 1.2;
    this.rings.spawn(R);
    // dome shock shell
    const H = hp();
    H.x = gx; H.y = 0; H.z = gz; H.R0 = 0.4; H.R1 = 11 + 5 * s; H.rpow = 2.0; H.life = 0.32;
    H.r = 1.2; H.g = 1.24; H.b = 1.4; H.a = 0.16; H.fres = 5.0; H.add = 0.8; H.noise = 0.7; H.apow = 2.0;
    this.shells.spawn(H);
    // ground-hugging dust wall
    this._groundBurst(gx, gz, Math.round((70 + 50 * s) * this.q) + 8, 0.3, 1.3, 7 + 3 * s, 12 + 9 * s, 0.4, 2.8,
      0.8, 2.8 + 1.8 * s, 1.5, 3.0, 0.7, 2.1);
    // tall dust plume + lingering haze
    const nL = Math.round((22 + 10 * s) * this.q) + 4;
    for (let i = 0; i < nL; i++) {
      const ang = Math.random() * TAU, r = Math.sqrt(Math.random()) * (2.5 + 1.5 * s);
      const P = this._dust(sp());
      P.x = gx + Math.cos(ang) * r; P.y = rnd(0.2, 1.4); P.z = gz + Math.sin(ang) * r;
      P.vx = Math.cos(ang) * rnd(0.6, 2.2); P.vy = rnd(0.3, 1.4); P.vz = Math.sin(ang) * rnd(0.6, 2.2);
      P.life = rnd(3.5, 6.0); P.s0 = 1.2; P.s1 = rnd(3.0, 5.2); P.spow = 1.4; P.a = 0.26; P.fin = 0.12; P.fpow = 1.6;
      P.drag = 0.9; P.grav = -0.15; P.soft = 0.5; P.rotv = rnd(-0.25, 0.25);
      this.smoke.spawn(P);
    }
    const nC = Math.round(12 * this.q) + 3;
    for (let i = 0; i < nC; i++) {
      const ang = Math.random() * TAU, r = Math.random() * 0.8;
      const P = this._dust(sp(), 1.02);
      P.x = gx + Math.cos(ang) * r; P.y = 0.3; P.z = gz + Math.sin(ang) * r;
      P.vx = Math.cos(ang) * rnd(0.5, 2.5); P.vy = rnd(4, 9) * (0.7 + 0.4 * s); P.vz = Math.sin(ang) * rnd(0.5, 2.5);
      P.life = rnd(1.2, 2.2); P.s0 = 0.6; P.s1 = rnd(2.0, 3.4); P.a = 0.4; P.drag = 2.2; P.grav = 0.6; P.soft = 0.4;
      this.smoke.spawn(P);
    }
    // debris chunks
    const nD = Math.round((18 + 26 * s) * (hi ? 1 : 0.5));
    for (let i = 0; i < nD; i++) {
      const ang = Math.random() * TAU, r = rnd(0.2, 1.4);
      const out = rnd(2, 8) * (0.6 + 0.5 * s);
      const sz = Math.random() < 0.2 ? rnd(0.2, 0.34) : rnd(0.06, 0.18);
      this.debris.spawn(gx + Math.cos(ang) * r, 0.15 + Math.random() * 0.3, gz + Math.sin(ang) * r,
        Math.cos(ang) * out, rnd(3.5, 11) * (0.6 + 0.5 * s), Math.sin(ang) * out, sz, rnd(2.6, 4.2));
    }
    // impact sparks
    const nS = Math.round((16 + 16 * s) * this.q) + 4;
    for (let i = 0; i < nS; i++) {
      const ang = Math.random() * TAU;
      const out = rnd(7, 19);
      const P = sp();
      P.x = gx; P.y = 0.15; P.z = gz;
      P.vx = Math.cos(ang) * out; P.vy = rnd(1.5, 7); P.vz = Math.sin(ang) * out;
      P.life = rnd(0.25, 0.55); P.s0 = P.s1 = rnd(0.05, 0.1); P.pal = 1; P.r0 = rnd(3, 5); P.g0 = 0.9;
      P.a = 1; P.add0 = 1; P.fin = 0.01; P.drag = 1.2; P.grav = 9.8; P.smode = 1; P.sk = 0.03; P.bounce = 0.35; P.shade = 0;
      this.glow.spawn(P);
    }
    this._flashLight(gx, 0.8, gz, 42 * (0.6 + 0.4 * s), 0.18, 1.0, 0.9, 0.78);
    this._hook('shake', 0.7 + 0.3 * s);
    this._hook('flash', 0.2 * (0.6 + 0.4 * s));
    this._hook('shockwave', this._hookPos(gx, 0.3, gz), 0.6 + 0.4 * s);
  }

  takeoff(pos, strength = 1) {
    const s = clamp01(strength);
    const gx = pos.x, gz = pos.z;
    const gnd = 1 - smooth(1.5, 9, pos.y);
    if (gnd > 0) {
      this._groundBurst(gx, gz, Math.round((26 + 24 * s) * this.q * gnd) + 3, 0.3, 0.9, 5 + 2 * s, 9 + 6 * s, 0.1, 0.8,
        0.45, 1.8 + 0.9 * s, 0.8, 1.5, 0.48 * gnd, 2.4);
      let R = this._ringDust(rp());
      R.x = gx; R.y = 0.03; R.z = gz; R.R0 = 0.5; R.R1 = 4.5 + 2.5 * s; R.rpow = 2.8; R.life = 0.8;
      R.a = 0.42 * gnd; R.w0 = 0.45; R.w1 = 0.25; R.noise = 0.8;
      this.rings.spawn(R);
      R = rp();
      R.x = gx; R.y = 0.05; R.z = gz; R.R0 = 0.3; R.R1 = 6 + 4 * s; R.rpow = 2.0; R.life = 0.42;
      R.r = 1.45; R.g = 1.5; R.b = 1.65; R.a = 0.55 * gnd; R.w0 = 0.1; R.w1 = 0.05; R.add = 0.55; R.noise = 0.4;
      this.rings.spawn(R);
    }
    // air shock rings around the feet, rising
    const fy = Math.max(0.15, pos.y - 0.6);
    for (let k = 0; k < 2; k++) {
      const R = rp();
      R.x = gx; R.y = fy; R.z = gz; R.vy = k === 0 ? 5 : 9; R.R0 = 0.45; R.R1 = (k === 0 ? 2.8 : 1.9) + s;
      R.rpow = 2.4; R.life = k === 0 ? 0.5 : 0.4; R.delay = k * 0.05;
      R.r = 1.35; R.g = 1.4; R.b = 1.55; R.a = 0.6; R.w0 = 0.28; R.w1 = 0.12; R.add = 0.35; R.noise = 0.65;
      this.rings.spawn(R);
    }
    // upward streaks
    const nU = Math.round((14 + 10 * s) * this.q) + 4;
    for (let i = 0; i < nU; i++) {
      const ang = Math.random() * TAU, r = rnd(0.35, 1.3);
      const P = sp();
      P.x = gx + Math.cos(ang) * r; P.y = fy + rnd(0, 1.2); P.z = gz + Math.sin(ang) * r;
      P.vx = Math.cos(ang) * rnd(0.5, 2); P.vy = rnd(16, 30) * (0.7 + 0.4 * s); P.vz = Math.sin(ang) * rnd(0.5, 2);
      P.life = rnd(0.22, 0.4); P.s0 = P.s1 = rnd(0.045, 0.08); P.r0 = P.r1 = 1.5; P.g0 = P.g1 = 1.65; P.b0 = P.b1 = 2.0;
      P.a = 0.85; P.add0 = P.add1 = 1; P.drag = 2.5; P.smode = 1; P.sk = 0.035; P.shade = 0; P.fin = 0.02;
      this.glow.spawn(P);
    }
    // swirl of dust sucked up with the hero
    const nW = Math.round(10 * this.q * gnd) + 1;
    for (let i = 0; i < nW; i++) {
      const ang = Math.random() * TAU;
      const P = this._dust(sp());
      P.x = gx + Math.cos(ang) * 0.6; P.y = 0.2; P.z = gz + Math.sin(ang) * 0.6;
      P.vx = -Math.sin(ang) * 3; P.vy = rnd(5, 10); P.vz = Math.cos(ang) * 3;
      P.life = rnd(0.6, 1.0); P.s0 = 0.4; P.s1 = rnd(1.2, 2.0); P.a = 0.32 * gnd; P.drag = 2.4; P.soft = 0.4;
      this.smoke.spawn(P);
    }
    this._hook('shake', 0.35);
    this._hook('fovKick', 4);
    this._hook('shockwave', this._hookPos(gx, Math.max(0.3, pos.y - 0.5), gz), 0.25);
  }

  boostBurst(pos, dir) {
    basis(dir, _bx, _by);
    quatFromBasis(_bx, _by, dir, _q0);
    const rec = Math.min(Math.max(this._speed * 0.1, 4), 30);
    const f = this._speed > 30 ? 0.97 : 0;
    // main translucent donut
    let R = rp();
    R.x = pos.x - dir.x * 0.6; R.y = pos.y - dir.y * 0.6; R.z = pos.z - dir.z * 0.6;
    R.vx = -dir.x * rec; R.vy = -dir.y * rec; R.vz = -dir.z * rec; R.follow = f; R.q = _q0;
    R.R0 = 0.45; R.R1 = 4.6; R.rpow = 3.2; R.life = 0.6;
    R.r = 1.25; R.g = 1.32; R.b = 1.45; R.a = 0.62; R.w0 = 0.3; R.w1 = 0.1; R.add = 0.25; R.noise = 0.75; R.fin = 0.02;
    this.rings.spawn(R);
    // sharp outer pressure ring
    R = rp();
    R.x = pos.x - dir.x * 0.9; R.y = pos.y - dir.y * 0.9; R.z = pos.z - dir.z * 0.9;
    R.vx = -dir.x * rec * 1.2; R.vy = -dir.y * rec * 1.2; R.vz = -dir.z * rec * 1.2; R.follow = f; R.q = _q0;
    R.R0 = 0.3; R.R1 = 6.8; R.rpow = 2.4; R.life = 0.42; R.delay = 0.035;
    R.r = 1.7; R.g = 1.85; R.b = 2.2; R.a = 0.4; R.w0 = 0.08; R.w1 = 0.04; R.add = 0.65; R.noise = 0.35; R.fin = 0.02;
    this.rings.spawn(R);
    // pressure puff disk
    R = rp();
    R.x = pos.x - dir.x * 0.4; R.y = pos.y - dir.y * 0.4; R.z = pos.z - dir.z * 0.4;
    R.vx = -dir.x * rec * 0.7; R.vy = -dir.y * rec * 0.7; R.vz = -dir.z * rec * 0.7; R.follow = f; R.q = _q0;
    R.R0 = 0.3; R.R1 = 2.6; R.rpow = 3; R.life = 0.32; R.fill = 0.35;
    R.r = 1.15; R.g = 1.2; R.b = 1.3; R.a = 0.35; R.w0 = 0.5; R.w1 = 0.3; R.add = 0.2; R.noise = 0.8;
    this.rings.spawn(R);
    // radial streak burst
    const nS = Math.round(28 * this.q) + 6;
    for (let i = 0; i < nS; i++) {
      const a = (i / nS) * TAU + rnd(-0.1, 0.1);
      const c = Math.cos(a), s = Math.sin(a);
      const rx = _bx.x * c + _by.x * s, ry = _bx.y * c + _by.y * s, rz = _bx.z * c + _by.z * s;
      const out = rnd(14, 28), back = rnd(2, 9);
      const P = sp();
      P.x = pos.x + rx * 0.5 - dir.x * 0.5; P.y = pos.y + ry * 0.5 - dir.y * 0.5; P.z = pos.z + rz * 0.5 - dir.z * 0.5;
      P.vx = rx * out - dir.x * back; P.vy = ry * out - dir.y * back; P.vz = rz * out - dir.z * back; P.follow = f;
      P.life = rnd(0.16, 0.32); P.s0 = P.s1 = rnd(0.05, 0.09); P.r0 = P.r1 = 1.5; P.g0 = P.g1 = 1.7; P.b0 = P.b1 = 2.1;
      P.a = 0.9; P.add0 = P.add1 = 1; P.drag = 5; P.smode = 1; P.sk = 0.03; P.shade = 0; P.fin = 0.02;
      this.glow.spawn(P);
    }
    // vapor puffs in the donut
    const nV = Math.round(14 * this.q) + 3;
    for (let i = 0; i < nV; i++) {
      const a = Math.random() * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      const rx = _bx.x * c + _by.x * s, ry = _bx.y * c + _by.y * s, rz = _bx.z * c + _by.z * s;
      const P = this._white(sp());
      P.x = pos.x + rx * 0.8 - dir.x * 0.7; P.y = pos.y + ry * 0.8 - dir.y * 0.7; P.z = pos.z + rz * 0.8 - dir.z * 0.7;
      const o = rnd(4, 8);
      P.vx = rx * o - dir.x * rec; P.vy = ry * o - dir.y * rec; P.vz = rz * o - dir.z * rec; P.follow = f;
      P.life = rnd(0.4, 0.6); P.s0 = 0.4; P.s1 = rnd(1.1, 1.6); P.a = 0.3; P.drag = 3.5;
      this.smoke.spawn(P);
    }
    this._flashLight(pos.x, pos.y, pos.z, 10, 0.16, 0.8, 0.9, 1.0);
    this._hook('fovKick', 8);
    this._hook('shake', 0.3);
    this._hook('shockwave', this._hookPos(pos.x - dir.x, pos.y - dir.y, pos.z - dir.z), 0.3);
  }

  sonicBoom(pos, dir) {
    basis(dir, _bx, _by);
    quatFromBasis(_bx, _by, dir, _q0);
    const rec = Math.min(Math.max(this._speed * 0.02, 4), 10);
    const f = 0.99;
    const bx = pos.x - dir.x * 0.3, by = pos.y - dir.y * 0.3, bz = pos.z - dir.z * 0.3;
    // condensation disk
    let R = rp();
    R.x = bx; R.y = by; R.z = bz; R.vx = -dir.x * rec; R.vy = -dir.y * rec; R.vz = -dir.z * rec; R.follow = f; R.q = _q0;
    R.R0 = 0.9; R.R1 = 8.5; R.rpow = 4; R.life = 0.7; R.apow = 1.5; R.fin = 0.015;
    R.r = 1.12; R.g = 1.15; R.b = 1.22; R.a = 0.55; R.w0 = 0.5; R.w1 = 0.22; R.fill = 0.04; R.add = 0.15; R.noise = 0.95;
    this.rings.spawn(R);
    // snapping shock ring
    R = rp();
    R.x = bx; R.y = by; R.z = bz; R.vx = -dir.x * rec; R.vy = -dir.y * rec; R.vz = -dir.z * rec; R.follow = f; R.q = _q0;
    R.R0 = 1.0; R.R1 = 17; R.rpow = 2.4; R.life = 0.48; R.fin = 0.01;
    R.r = 3.0; R.g = 3.1; R.b = 3.6; R.a = 0.5; R.w0 = 0.05; R.w1 = 0.025; R.add = 0.8; R.noise = 0.3;
    this.rings.spawn(R);
    // vapor ring behind it
    R = rp();
    R.x = bx; R.y = by; R.z = bz; R.vx = -dir.x * rec * 1.3; R.vy = -dir.y * rec * 1.3; R.vz = -dir.z * rec * 1.3; R.follow = f; R.q = _q0;
    R.R0 = 0.8; R.R1 = 11; R.rpow = 2.8; R.life = 0.65; R.delay = 0.06;
    R.r = 1.15; R.g = 1.18; R.b = 1.24; R.a = 0.42; R.w0 = 0.2; R.w1 = 0.1; R.add = 0.1; R.noise = 0.8;
    this.rings.spawn(R);
    // faint spherical shock shell
    const H = hp();
    H.x = pos.x; H.y = pos.y; H.z = pos.z; H.vx = -dir.x * rec; H.vy = -dir.y * rec; H.vz = -dir.z * rec; H.follow = f;
    H.R0 = 0.6; H.R1 = 36; H.rpow = 2.2; H.life = 0.6; H.r = 1.6; H.g = 1.7; H.b = 2.0; H.a = 0.42; H.fres = 4.0; H.add = 0.75; H.noise = 0.6; H.apow = 2;
    this.shells.spawn(H);
    // sparkles
    const nS = Math.round(56 * this.q) + 8;
    for (let i = 0; i < nS; i++) {
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * 4.5;
      const c = Math.cos(a), s = Math.sin(a);
      const rx = _bx.x * c + _by.x * s, ry = _bx.y * c + _by.y * s, rz = _bx.z * c + _by.z * s;
      const P = sp();
      P.x = bx + rx * rr; P.y = by + ry * rr; P.z = bz + rz * rr;
      const o = rnd(5, 16);
      P.vx = rx * o - dir.x * rec; P.vy = ry * o - dir.y * rec; P.vz = rz * o - dir.z * rec; P.follow = f;
      P.life = rnd(0.25, 0.65); P.s0 = P.s1 = rnd(0.05, 0.14); P.r0 = P.r1 = 3.0; P.g0 = P.g1 = 3.1; P.b0 = P.b1 = 3.5;
      P.a = 1; P.add0 = P.add1 = 1; P.drag = 2; P.smode = 1; P.sk = 0.02; P.shade = 0; P.aux0 = rnd(25, 45); P.fin = 0.01;
      this.glow.spawn(P);
    }
    // condensation puffs
    const nV = Math.round(30 * this.q) + 6;
    for (let i = 0; i < nV; i++) {
      const a = (i / nV) * TAU + rnd(-0.1, 0.1), rr = rnd(1.0, 2.8);
      const c = Math.cos(a), s = Math.sin(a);
      const rx = _bx.x * c + _by.x * s, ry = _bx.y * c + _by.y * s, rz = _bx.z * c + _by.z * s;
      const P = this._white(sp(), 1.05);
      P.x = bx + rx * rr; P.y = by + ry * rr; P.z = bz + rz * rr;
      const o = rnd(6, 15);
      P.vx = rx * o - dir.x * rec; P.vy = ry * o - dir.y * rec; P.vz = rz * o - dir.z * rec; P.follow = f;
      P.life = rnd(0.6, 1.0); P.s0 = 0.5; P.s1 = rnd(1.3, 2.2); P.a = 0.34; P.drag = 2.2; P.fpow = 1.6;
      this.smoke.spawn(P);
    }
    this._vaporKick = 1;
    this._flashLight(pos.x, pos.y, pos.z, 55, 0.25, 0.92, 0.96, 1.0);
    this._hook('flash', 0.5);
    this._hook('shake', 0.9);
    this._hook('shockwave', this._hookPos(pos.x, pos.y, pos.z), 1);
    this._hook('fovKick', 12);
  }

  roll(pos, dir, sign = 1) {
    const sg = sign < 0 ? -1 : 1;
    basis(dir, _bx, _by);
    quatFromBasis(_bx, _by, dir, _q0);
    // two spinning arc swooshes attached to the hero
    for (let k = 0; k < 2; k++) {
      const R = rp();
      const back = 0.25 + k * 0.7;
      R.x = pos.x - dir.x * back; R.y = pos.y - dir.y * back; R.z = pos.z - dir.z * back; R.follow = 1; R.q = _q0;
      R.vx = -dir.x * 3; R.vy = -dir.y * 3; R.vz = -dir.z * 3;
      R.R0 = 1.05 + k * 0.35; R.R1 = 1.35 + k * 0.5; R.rpow = 1.5; R.life = 0.5 + k * 0.05; R.delay = k * 0.06;
      R.head = Math.random() * TAU; R.span = 3.6; R.spin = sg * TAU / 0.42; R.sign = sg;
      R.r = 1.4; R.g = 1.55; R.b = 1.9; R.a = 0.85 - k * 0.25; R.w0 = 0.14; R.w1 = 0.07; R.add = 0.6; R.noise = 0.35; R.fin = 0.1; R.apow = 1.2;
      this.rings.spawn(R);
    }
    // helix of vapor + sparkles trailing behind
    const n = Math.round(44 * this.q) + 8;
    const th0 = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const th = th0 + sg * i * 0.3;
      const c = Math.cos(th), s = Math.sin(th);
      const rx = _bx.x * c + _by.x * s, ry = _bx.y * c + _by.y * s, rz = _bx.z * c + _by.z * s;
      const tx = -_bx.x * s + _by.x * c, ty = -_bx.y * s + _by.y * c, tz = -_bx.z * s + _by.z * c;
      const along = i * 0.11, rr = 1.05;
      const sw = sg * rnd(3, 6);
      const isGlow = (i & 1) === 0;
      const P = isGlow ? sp() : this._white(sp());
      P.x = pos.x + rx * rr - dir.x * along; P.y = pos.y + ry * rr - dir.y * along; P.z = pos.z + rz * rr - dir.z * along;
      P.vx = tx * sw + rx * 1.2; P.vy = ty * sw + ry * 1.2; P.vz = tz * sw + rz * 1.2; P.follow = 0.82;
      if (isGlow) {
        P.life = rnd(0.25, 0.45); P.s0 = P.s1 = rnd(0.05, 0.09); P.r0 = P.r1 = 1.5; P.g0 = P.g1 = 1.7; P.b0 = P.b1 = 2.1;
        P.a = 0.8; P.add0 = P.add1 = 1; P.smode = 1; P.sk = 0.04; P.shade = 0; P.drag = 2;
        this.glow.spawn(P);
      } else {
        P.life = rnd(0.35, 0.6); P.s0 = 0.12; P.s1 = rnd(0.3, 0.5); P.a = 0.28; P.drag = 2.5; P.smode = 1; P.sk = 0.08;
        this.smoke.spawn(P);
      }
    }
  }

  flip(pos, dir) {
    // somersault around the lateral axis: arc in the plane (dir, up)
    _v0.copy(AX_Y);
    if (Math.abs(dir.dot(_v0)) > 0.9) _v0.copy(AX_Z);
    _gy.copy(_v0).addScaledVector(dir, -dir.dot(_v0)).normalize(); // up ⟂ dir
    _gx.copy(dir);
    _v1.crossVectors(_gx, _gy).normalize(); // plane normal (lateral axis)
    quatFromBasis(_gx, _gy, _v1, _q0);
    // forward flip: head goes up -> forward -> down  => angle decreasing
    for (let k = 0; k < 2; k++) {
      const R = rp();
      R.x = pos.x; R.y = pos.y; R.z = pos.z; R.follow = 1; R.q = _q0;
      R.R0 = 1.25 + k * 0.4; R.R1 = 1.55 + k * 0.55; R.rpow = 1.5; R.life = 0.58; R.delay = k * 0.05;
      R.head = Math.PI * 0.5; R.span = 4.2 - k * 0.6; R.spin = -TAU / 0.55; R.sign = -1;
      R.r = 1.45; R.g = 1.6; R.b = 1.95; R.a = 0.9 - k * 0.3; R.w0 = 0.16; R.w1 = 0.07; R.add = 0.6; R.noise = 0.35; R.fin = 0.08; R.apow = 1.2;
      this.rings.spawn(R);
    }
    {
      basis(dir, _bx, _by);
      quatFromBasis(_bx, _by, dir, _q1);
      const R = rp();
      R.x = pos.x - dir.x * 0.4; R.y = pos.y - dir.y * 0.4; R.z = pos.z - dir.z * 0.4; R.follow = 1; R.q = _q1;
      R.vx = -dir.x * 4; R.vy = -dir.y * 4; R.vz = -dir.z * 4;
      R.R0 = 0.5; R.R1 = 2.3; R.rpow = 3; R.life = 0.4;
      R.r = 1.2; R.g = 1.28; R.b = 1.45; R.a = 0.42; R.w0 = 0.3; R.w1 = 0.12; R.add = 0.35; R.noise = 0.7;
      this.rings.spawn(R);
    }
    const n = Math.round(22 * this.q) + 4;
    for (let i = 0; i < n; i++) {
      const th = Math.PI * 0.5 + rnd(-0.3, 2.4);
      const c = Math.cos(th), s = Math.sin(th);
      const P = sp();
      const rr = rnd(1.2, 1.7);
      P.x = pos.x + (_gx.x * c + _gy.x * s) * rr; P.y = pos.y + (_gx.y * c + _gy.y * s) * rr; P.z = pos.z + (_gx.z * c + _gy.z * s) * rr;
      const tv = rnd(4, 8);
      P.vx = (_gx.x * s - _gy.x * c) * tv; P.vy = (_gx.y * s - _gy.y * c) * tv; P.vz = (_gx.z * s - _gy.z * c) * tv; P.follow = 0.85;
      P.life = rnd(0.25, 0.45); P.s0 = P.s1 = rnd(0.05, 0.09); P.r0 = P.r1 = 1.5; P.g0 = P.g1 = 1.7; P.b0 = P.b1 = 2.1;
      P.a = 0.85; P.add0 = P.add1 = 1; P.smode = 1; P.sk = 0.04; P.shade = 0; P.drag = 2.5;
      this.glow.spawn(P);
    }
  }

  brake(pos, dir, strength = 1) {
    const s = clamp01(strength);
    basis(dir, _bx, _by);
    quatFromBasis(_bx, _by, dir, _q0);
    const fwd = 1.4;
    let R = rp();
    R.x = pos.x + dir.x * fwd; R.y = pos.y + dir.y * fwd; R.z = pos.z + dir.z * fwd;
    R.vx = dir.x * (6 + 10 * s); R.vy = dir.y * (6 + 10 * s); R.vz = dir.z * (6 + 10 * s); R.follow = 0.6; R.q = _q0;
    R.R0 = 0.4; R.R1 = 2.6 + 2.2 * s; R.rpow = 2.6; R.life = 0.45; R.fill = 0.25;
    R.r = 1.2; R.g = 1.25; R.b = 1.38; R.a = 0.5 * (0.5 + 0.5 * s); R.w0 = 0.3; R.w1 = 0.12; R.add = 0.25; R.noise = 0.75;
    this.rings.spawn(R);
    // forward blast cone
    const n = Math.round((18 + 26 * s) * this.q) + 4;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, spread = rnd(0.1, 0.65);
      const c = Math.cos(a) * spread, sn = Math.sin(a) * spread;
      _v0.copy(dir).addScaledVector(_bx, c).addScaledVector(_by, sn).normalize();
      const v = rnd(9, 24) * (0.6 + 0.5 * s);
      const P = this._white(sp());
      P.x = pos.x + dir.x * 0.9; P.y = pos.y + dir.y * 0.9; P.z = pos.z + dir.z * 0.9;
      P.vx = _v0.x * v; P.vy = _v0.y * v; P.vz = _v0.z * v; P.follow = 0.5;
      P.life = rnd(0.45, 0.85); P.s0 = 0.25; P.s1 = rnd(1.2, 2.2); P.a = 0.32; P.drag = 3.2; P.fpow = 1.4;
      this.smoke.spawn(P);
    }
    const nS = Math.round((10 + 14 * s) * this.q) + 3;
    for (let i = 0; i < nS; i++) {
      const a = Math.random() * TAU, spread = rnd(0.15, 0.55);
      _v0.copy(dir).addScaledVector(_bx, Math.cos(a) * spread).addScaledVector(_by, Math.sin(a) * spread).normalize();
      const v = rnd(18, 34) * (0.6 + 0.5 * s);
      const P = sp();
      P.x = pos.x + dir.x * 0.9 + _v0.x * 0.4; P.y = pos.y + dir.y * 0.9 + _v0.y * 0.4; P.z = pos.z + dir.z * 0.9 + _v0.z * 0.4;
      P.vx = _v0.x * v; P.vy = _v0.y * v; P.vz = _v0.z * v; P.follow = 0.5;
      P.life = rnd(0.16, 0.3); P.s0 = P.s1 = rnd(0.04, 0.07); P.r0 = P.r1 = 1.4; P.g0 = P.g1 = 1.55; P.b0 = P.b1 = 1.9;
      P.a = 0.8; P.add0 = P.add1 = 1; P.smode = 1; P.sk = 0.035; P.shade = 0; P.drag = 4;
      this.glow.spawn(P);
    }
    this._hook('shake', 0.12 + 0.2 * s);
  }

  dash(pos, dir) {
    basis(dir, _bx, _by);
    quatFromBasis(_bx, _by, dir, _q0);
    const R = rp();
    R.x = pos.x - dir.x * 0.5; R.y = pos.y - dir.y * 0.5; R.z = pos.z - dir.z * 0.5;
    R.vx = -dir.x * 6; R.vy = -dir.y * 6; R.vz = -dir.z * 6; R.follow = this._speed > 15 ? 0.9 : 0; R.q = _q0;
    R.R0 = 0.3; R.R1 = 2.3; R.rpow = 3; R.life = 0.32;
    R.r = 1.3; R.g = 1.38; R.b = 1.55; R.a = 0.5; R.w0 = 0.22; R.w1 = 0.1; R.add = 0.35; R.noise = 0.6;
    this.rings.spawn(R);
    const n = Math.round(12 * this.q) + 4;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      const rx = _bx.x * c + _by.x * s, ry = _bx.y * c + _by.y * s, rz = _bx.z * c + _by.z * s;
      const P = sp();
      P.x = pos.x + rx * 0.4; P.y = pos.y + ry * 0.4; P.z = pos.z + rz * 0.4;
      const o = rnd(3, 8), b = rnd(10, 20);
      P.vx = rx * o - dir.x * b; P.vy = ry * o - dir.y * b; P.vz = rz * o - dir.z * b;
      P.life = rnd(0.15, 0.3); P.s0 = P.s1 = rnd(0.04, 0.07); P.r0 = P.r1 = 1.4; P.g0 = P.g1 = 1.6; P.b0 = P.b1 = 2.0;
      P.a = 0.8; P.add0 = P.add1 = 1; P.smode = 1; P.sk = 0.03; P.shade = 0; P.drag = 4;
      this.glow.spawn(P);
    }
    const nP = Math.round(6 * this.q) + 2;
    for (let i = 0; i < nP; i++) {
      const P = (pos.y < 1.6 ? this._dust(sp()) : this._white(sp()));
      P.x = pos.x - dir.x * 0.6 + rnd(-0.3, 0.3); P.y = Math.max(0.15, pos.y - dir.y * 0.6 + rnd(-0.3, 0.3)); P.z = pos.z - dir.z * 0.6 + rnd(-0.3, 0.3);
      P.vx = -dir.x * rnd(2, 5) + rnd(-1, 1); P.vy = rnd(0, 1); P.vz = -dir.z * rnd(2, 5) + rnd(-1, 1);
      P.life = rnd(0.4, 0.7); P.s0 = 0.25; P.s1 = rnd(0.8, 1.2); P.a = 0.3; P.drag = 3; P.soft = 0.4; P.bounce = 0.1;
      this.smoke.spawn(P);
    }
    this._hook('fovKick', 3);
    this._hook('shake', 0.12);
  }

  // ================================================================ per-frame
  update(dt, ctx) {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    this._t += dt;
    const T = this._t % 600;
    const cam = this.camera;
    const p = this.params;

    // ---- player state ----
    this._pos.copy(ctx.pos);
    this._vel.copy(ctx.vel);
    const speed = ctx.speed !== undefined ? ctx.speed : this._vel.length();
    const mach = ctx.mach !== undefined ? ctx.mach : speed / MACH;
    this._speed = speed; this._mach = mach;
    if (speed > 0.5) this._dir.copy(this._vel).multiplyScalar(1 / speed);
    else if (ctx.bodyQuat) this._dir.set(0, 1, 0).applyQuaternion(ctx.bodyQuat);
    const dir = this._dir;
    const flying = !!ctx.flying;
    const grounded = !!ctx.grounded;
    const alt = ctx.altitude !== undefined ? ctx.altitude : ctx.pos.y;

    // ---- camera (world space; works even if the camera sits in a rig) ----
    const camPos = cam.getWorldPosition(this._camPos);
    cam.getWorldQuaternion(_q1);
    if (dt > 0) {
      this._camVel.subVectors(camPos, this._camPrev).multiplyScalar(1 / dt);
      if (this._camVel.lengthSq() > 4000 * 4000) this._camVel.set(0, 0, 0); // teleport
    }
    this._camPrev.copy(camPos);
    this._camRight.set(1, 0, 0).applyQuaternion(_q1);
    this._camUp.set(0, 1, 0).applyQuaternion(_q1);
    this.smoke.uniforms.uCamRight.value.copy(this._camRight);
    this.smoke.uniforms.uCamUp.value.copy(this._camUp);
    this.glow.uniforms.uCamRight.value.copy(this._camRight);
    this.glow.uniforms.uCamUp.value.copy(this._camUp);

    // ---- levels ----
    const L = this.levels;
    const vapT = flying ? smooth(0.84, 0.97, mach) * (1 - smooth(1.08, 1.3, mach)) : 0;
    const plaT = flying && !grounded ? smooth(1.6, 3.0, mach) : 0;
    L.vapor += (vapT - L.vapor) * Math.min(1, dt * 9);
    L.plasma += (plaT - L.plasma) * Math.min(1, dt * (plaT > L.plasma ? 3.5 : 5));
    L.wind = smooth(30, 320, speed);
    L.wake = flying && !grounded ? (1 - smooth(1.5, 8, alt)) * smooth(20, 60, speed) : 0;
    L.trail = Math.max(smooth(45, 85, speed) * (flying ? 1 : 0.5), clamp01(ctx.trick || 0));
    this._vaporKick = Math.max(0, this._vaporKick - dt * 1.6);

    // ---- simulate pools (existing particles) ----
    this.smoke.simulate(dt, this._vel);
    this.glow.simulate(dt, this._vel);
    this.rings.simulate(dt, this._vel);
    this.shells.simulate(dt, this._vel);

    // ---- continuous emitters ----
    this._updateLines(dt, speed, L);
    this._updateRibbons(ctx, L);
    this._updateVapor(dt, T, L);
    this._updatePlasma(dt, T, L, speed);
    this._updateWake(dt, L, alt, speed);

    // ---- upload ----
    this.smoke.upload(this._camVel, this._vel);
    this.glow.upload(this._camVel, this._vel);
    this.rings.upload();
    this.shells.upload();
    this.rings.uniforms.uTime.value = T;
    this.craters.update(dt);
    this.debris.update(dt);

    // ---- light ----
    const lf = this._lightFlash;
    lf.age += dt;
    const fI = lf.age < lf.tau * 5 ? lf.I * Math.exp(-lf.age / lf.tau) : 0;
    const pI = p.plasmaLight * L.plasma * (0.85 + 0.15 * Math.sin(T * 41) * Math.sin(T * 17.3));
    const li = this.light;
    li.intensity = fI + pI;
    if (li.intensity > 0.001) {
      const wf = fI / (fI + pI);
      const pc = this._plasmaColor;
      li.color.setRGB(lerp(pc.r, lf.r, wf), lerp(pc.g, lf.g, wf), lerp(pc.b, lf.b, wf));
      if (wf > 0.5) li.position.copy(lf.pos);
      else li.position.copy(this._pos).addScaledVector(dir, 2.3);
    }

    // ---- visibility (keep everything visible for the first frames so shaders compile up front) ----
    if (this._warm > 0) {
      this._warm--;
      this.vapor.visible = this.plasma.visible = this.lines.visible = this.ribbons.mesh.visible = true;
    } else {
      this.vapor.visible = this.vaporU.uI.value > 0.002;
      this.plasma.visible = this.plasmaU.uI.value > 0.002;
      this.lines.visible = this.lineU.uDensity.value > 0.001 && this.lineU.uAlpha.value > 0.001;
      this.ribbons.mesh.visible = this.ribbons.alive;
    }
  }

  _updateLines(dt, speed, L) {
    const u = this.lineU;
    const w = L.wind;
    u.uCenter.value.copy(this._pos);
    u.uFwd.value.copy(this._dir);
    basis(this._dir, u.uRight.value, u.uUp.value);
    this._lineFlow = (this._lineFlow + Math.min(speed, 300) * 1.1 * dt) % (u.uBox.value * 2000);
    u.uFlow.value = this._lineFlow;
    u.uLen.value = Math.min(1.2 + speed * 0.03, 22);
    u.uDensity.value = w;
    u.uAlpha.value = this.params.windAlpha * Math.min(1, w * 1.6);
    const cam = this.camera;
    const h = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 720;
    this._pixAngle = 2 * Math.tan((cam.fov || 70) * Math.PI / 360) / h;
    u.uPix.value = this._pixAngle;
    const pl = L.plasma;
    u.uColor.value.setRGB(lerp(0.95, 1.5, pl), lerp(0.98, 0.75, pl), lerp(1.05, 0.4, pl));
    u.uAdd.value = lerp(0.35, 0.6, pl);
  }

  _updateRibbons(ctx, L) {
    const limbs = ctx.limbs;
    const rb = this.ribbons;
    const time = this._t;
    if (limbs) {
      const I = L.trail;
      const F = smooth(1.45, 1.85, this._mach);
      const list = this._limbList;
      list[0] = limbs.handR; list[1] = limbs.handL; list[2] = limbs.footR; list[3] = limbs.footL;
      for (let r = 0; r < 4; r++) {
        const o = list[r];
        if (!o) continue;
        o.getWorldPosition(_v0);
        // feet trails slightly fainter
        rb.push(r, _v0.x, _v0.y, _v0.z, time, r < 2 ? I : I * 0.8, F);
      }
    }
    const p = this.params;
    rb.build(time, this._camPos, p.trailLife, p.trailWidth, p.trailWidth * 2.2, p.trailMaxLen * (1 + 0.6 * L.plasma), this._pixAngle);
  }

  _updateVapor(dt, T, L) {
    const v = Math.min(1, L.vapor + this._vaporKick * 0.9);
    const flick = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(T * 37.0) * Math.sin(T * 23.7 + 1.3));
    this.vaporU.uI.value = v * flick;
    this.vaporU.uTime.value = T;
    if (v > 0.002) {
      const m = this.vapor;
      m.position.copy(this._pos).addScaledVector(this._dir, 0.72);
      m.quaternion.setFromUnitVectors(AX_Z, this._dir);
      this.vaporU.uAxis.value.copy(this._dir);
      const sc = 0.88 + 0.16 * v + 0.03 * Math.sin(T * 29);
      m.scale.set(sc, sc, sc * (0.95 + 0.1 * v));
    }
  }

  _updatePlasma(dt, T, L, speed) {
    const pl = L.plasma;
    const U = this.plasmaU;
    U.uTime.value = T;
    U.uI.value = pl * (0.9 + 0.1 * Math.sin(T * 31) * Math.sin(T * 13.7));
    if (pl <= 0.002) { this._acc.fire = this._acc.smoke = this._acc.ember = this._acc.wakeFire = 0; return; }
    const dir = this._dir, pos = this._pos, vel = this._vel;
    const m = this.plasma;
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(AX_Z, dir);
    const sc = 0.82 + 0.22 * pl;
    m.scale.setScalar(sc);
    U.uLen.value = (6 + this.params.plumeLength * pl) / sc;
    // incandescent core + halo (ephemeral billboards, rebuilt every frame)
    const nose = U.uNose.value * sc;
    let P = sp();
    P.x = pos.x + dir.x * nose * 0.9; P.y = pos.y + dir.y * nose * 0.9; P.z = pos.z + dir.z * nose * 0.9;
    P.life = 1e-5; P.s0 = P.s1 = 1.8 + 0.9 * pl; P.r0 = P.r1 = 1.9 * pl; P.g0 = P.g1 = 1.05 * pl; P.b0 = P.b1 = 0.28 * pl;
    P.a = 0.85; P.add0 = P.add1 = 1; P.fin = 0; P.fpow = 0; P.shade = 0; P.rot = T * 3;
    this.glow.spawn(P);
    P = sp();
    P.x = pos.x + dir.x * nose * 0.4; P.y = pos.y + dir.y * nose * 0.4; P.z = pos.z + dir.z * nose * 0.4;
    P.life = 1e-5; P.s0 = P.s1 = 6.5 + 2.5 * pl; P.r0 = P.r1 = 0.75 * pl; P.g0 = P.g1 = 0.13 * pl; P.b0 = P.b1 = 0.015 * pl;
    P.a = 0.5; P.add0 = P.add1 = 0.85; P.fin = 0; P.fpow = 0; P.shade = 0;
    this.glow.spawn(P);

    // plume particles in world space (they stream back at ~0.7..1.0 * speed)
    basis(dir, _bx, _by);
    const Rr = this.plasmaU.uRad.value * sc, back = this.plasmaU.uBack.value * sc;
    const q = this.q;
    const A = this._acc;
    A.fire += dt * pl * 560 * q;
    A.smoke += dt * pl * 230 * q;
    A.ember += dt * pl * 140 * q;
    A.wakeFire += dt * pl * 380 * q;
    const camVelK = 1 / 240;
    while (A.fire >= 1) {
      A.fire -= 1;
      const f = Math.random();
      const s = rnd(0.5, 1.0);
      const ang = Math.random() * TAU, c = Math.cos(ang), sn = Math.sin(ang);
      const r = Rr * Math.pow(s, 0.85) * rnd(0.8, 1.05), z = nose - back * Math.pow(s, 1.9);
      const rx = _bx.x * c + _by.x * sn, ry = _bx.y * c + _by.y * sn, rz = _bx.z * c + _by.z * sn;
      const kv = rnd(0, 0.3), out = rnd(1, 6);
      P = sp();
      P.x = pos.x + rx * r + dir.x * z - vel.x * dt * f; P.y = pos.y + ry * r + dir.y * z - vel.y * dt * f; P.z = pos.z + rz * r + dir.z * z - vel.z * dt * f;
      P.vx = vel.x * kv + rx * out; P.vy = vel.y * kv + ry * out; P.vz = vel.z * kv + rz * out; P.preAge = dt * f;
      P.life = rnd(0.22, 0.6); P.s0 = rnd(0.45, 0.9); P.s1 = rnd(1.6, 3.4) * (0.7 + 0.4 * pl); P.spow = 1.5;
      P.pal = 1; P.r0 = rnd(1.8, 3.0) * (0.6 + 0.4 * pl); P.g0 = rnd(0.9, 1.3); P.aux1 = rnd(0.08, 0.22); P.a = 0.55; P.add0 = 0.35; P.fin = 0.04; P.fpow = 1.1;
      P.drag = 0.6; P.smode = 2; P.sk = camVelK; P.shade = 0; P.rotv = rnd(-2, 2);
      this.glow.spawn(P);
    }
    while (A.wakeFire >= 1) {
      A.wakeFire -= 1;
      const s = rnd(0.72, 1.0);
      const ang = Math.random() * TAU, c = Math.cos(ang), sn = Math.sin(ang);
      const r = Rr * Math.pow(s, 0.85) * rnd(0.85, 1.05), z = nose - back * Math.pow(s, 1.9);
      const rx = _bx.x * c + _by.x * sn, ry = _bx.y * c + _by.y * sn, rz = _bx.z * c + _by.z * sn;
      const bk = rnd(8, 30), out = rnd(0.5, 3.5) * (s < 0.8 ? 1 : 1.6);
      P = sp();
      P.x = pos.x + rx * r + dir.x * z; P.y = pos.y + ry * r + dir.y * z; P.z = pos.z + rz * r + dir.z * z;
      P.vx = -dir.x * bk + rx * out; P.vy = -dir.y * bk + ry * out; P.vz = -dir.z * bk + rz * out; P.follow = rnd(0.965, 0.99);
      P.life = rnd(0.12, 0.3); P.s0 = rnd(0.35, 0.6); P.s1 = rnd(1.0, 1.9) * (0.7 + 0.3 * pl); P.spow = 1.3;
      P.pal = 1; P.r0 = rnd(1.6, 2.6); P.g0 = rnd(1.0, 1.4); P.aux1 = rnd(0.1, 0.25); P.a = 0.62 * (0.5 + 0.5 * pl);
      P.add0 = 0.3; P.fin = 0.08; P.fpow = 1.1; P.drag = 1.5; P.smode = 2; P.sk = 1 / 110; P.shade = 0; P.rotv = rnd(-4, 4);
      this.glow.spawn(P);
    }
    while (A.smoke >= 1) {
      A.smoke -= 1;
      const f = Math.random();
      const ang = Math.random() * TAU, c = Math.cos(ang), sn = Math.sin(ang);
      const r = Rr * rnd(0.5, 0.95), z = nose - back - rnd(0.2, 1.8);
      const rx = _bx.x * c + _by.x * sn, ry = _bx.y * c + _by.y * sn, rz = _bx.z * c + _by.z * sn;
      const kv = rnd(0, 0.25), out = rnd(0.5, 3);
      P = sp();
      P.x = pos.x + rx * r + dir.x * z - vel.x * dt * f; P.y = pos.y + ry * r + dir.y * z - vel.y * dt * f; P.z = pos.z + rz * r + dir.z * z - vel.z * dt * f;
      P.vx = vel.x * kv + rx * out; P.vy = vel.y * kv + ry * out; P.vz = vel.z * kv + rz * out; P.preAge = dt * f;
      P.life = rnd(1.3, 2.8); P.s0 = rnd(0.7, 1.1); P.s1 = rnd(3.2, 6.5); P.spow = 1.4;
      P.pal = 2; P.r0 = rnd(1.8, 3.0); P.b0 = 0.2; P.r1 = 0.1; P.g1 = 0.092; P.b1 = 0.086; P.aux1 = 0.85;
      P.a = 0.55; P.fin = 0.04; P.fpow = 1.4; P.drag = 0.45; P.grav = -0.6; P.smode = 2; P.sk = 1 / 150; P.rotv = rnd(-0.6, 0.6);
      this.smoke.spawn(P);
    }
    while (A.ember >= 1) {
      A.ember -= 1;
      const f = Math.random();
      const s = rnd(0.6, 1.0);
      const ang = Math.random() * TAU, c = Math.cos(ang), sn = Math.sin(ang);
      const r = Rr * Math.pow(s, 0.85), z = nose - back * Math.pow(s, 1.9);
      const rx = _bx.x * c + _by.x * sn, ry = _bx.y * c + _by.y * sn, rz = _bx.z * c + _by.z * sn;
      const kv = rnd(0.05, 0.4), out = rnd(4, 14);
      P = sp();
      P.x = pos.x + rx * r + dir.x * z - vel.x * dt * f; P.y = pos.y + ry * r + dir.y * z - vel.y * dt * f; P.z = pos.z + rz * r + dir.z * z - vel.z * dt * f;
      P.vx = vel.x * kv + rx * out + rnd(-3, 3); P.vy = vel.y * kv + ry * out + rnd(-3, 3); P.vz = vel.z * kv + rz * out + rnd(-3, 3); P.preAge = dt * f;
      P.life = rnd(0.3, 0.9); P.s0 = P.s1 = rnd(0.05, 0.12); P.pal = 1; P.r0 = rnd(3, 5); P.g0 = 1.2; P.aux1 = 0.05;
      P.a = 1; P.add0 = 0.8; P.fin = 0.01; P.drag = 0.8; P.smode = 2; P.sk = 1 / 200; P.shade = 0;
      this.glow.spawn(P);
    }
  }

  _updateWake(dt, L, alt, speed) {
    const w = L.wake;
    if (w <= 0.002) { this._acc.wake = 0; this._acc.wakeRing = 0; return; }
    const vel = this._vel, pos = this._pos;
    const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (hs < 1) return;
    const hx = vel.x / hs, hz = vel.z / hs;
    const sx = -hz, sz = hx;
    const low = 1 - smooth(0.5, 8, alt);
    this._acc.wake += dt * w * (60 + Math.min(speed, 500) * 0.5) * this.q;
    // air dragged along by the hero carries the dust: recede ~25..80 m/s relative to the hero
    while (this._acc.wake >= 1) {
      this._acc.wake -= 1;
      const f = Math.random();
      const sd = Math.random() < 0.5 ? -1 : 1;
      const lat = rnd(3, 9) + Math.min(speed * 0.05, 30);
      const up = rnd(1, 3.5) + Math.min(speed * 0.02, 10);
      const fol = Math.min(0.985, Math.max(0, 1 - rnd(6, 26) / hs));
      const ahead = rnd(-1.0, 3.0), off = rnd(0, 1.0) * sd;
      const P = this._dust(sp());
      P.x = pos.x + hx * ahead + sx * off - vel.x * dt * f; P.y = 0.1; P.z = pos.z + hz * ahead + sz * off - vel.z * dt * f;
      P.vx = sx * sd * lat; P.vy = up * low; P.vz = sz * sd * lat; P.follow = fol;
      P.life = rnd(0.5, 1.0); P.s0 = 0.7; P.s1 = rnd(2.0, 3.4) * (0.8 + 0.4 * low); P.spow = 2.5;
      P.a = 0.55 * w * (0.5 + 0.5 * low);
      P.drag = 2.4; P.grav = 1.2; P.soft = 0.35; P.bounce = 0.1; P.smode = 2; P.sk = 1 / 150; P.fin = 0.05; P.rotv = rnd(-1, 1);
      this.smoke.spawn(P);
    }
    // pressure rings sweeping over the floor (reads as a V-wake from above)
    this._acc.wakeRing += dt * w * low * 14;
    if (this._acc.wakeRing >= 1) {
      this._acc.wakeRing -= 1;
      const R = this._ringDust(rp());
      const fol = Math.min(0.985, Math.max(0, 1 - 18 / hs));
      R.x = pos.x; R.y = 0.04; R.z = pos.z; R.follow = fol; R.R0 = 0.6; R.R1 = 3.5 + Math.min(speed * 0.02, 6); R.rpow = 2.2;
      R.life = 0.5; R.a = 0.3 * w * low; R.w0 = 0.35; R.w1 = 0.2; R.noise = 0.85;
      this.rings.spawn(R);
    }
    const fwd = Math.min(hs * 0.3, 70);
    // under hypersonic flight the wake also glows from the plasma
    if (L.plasma > 0.05 && Math.random() < L.plasma * w) {
      const P = sp();
      P.x = pos.x; P.y = 0.1; P.z = pos.z;
      P.vx = sx * rnd(-20, 20) + hx * fwd * 0.5; P.vy = rnd(1, 4); P.vz = sz * rnd(-20, 20) + hz * fwd * 0.5;
      P.life = rnd(0.2, 0.5); P.s0 = P.s1 = rnd(0.05, 0.1); P.pal = 1; P.r0 = 4; P.g0 = 1.2; P.add0 = 1; P.a = 1;
      P.smode = 2; P.sk = 1 / 90; P.shade = 0; P.bounce = 0.3; P.grav = 9.8;
      this.glow.spawn(P);
    }
  }

  dispose() {
    for (const m of [this.craters.mesh, this.smoke.mesh, this.rings.mesh, this.shells.mesh, this.vapor,
      this.ribbons.mesh, this.lines, this.glow.mesh, this.plasma, this.debris.mesh]) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.scene.remove(this.light);
    this.texSmoke.dispose(); this.texGlow.dispose(); this.texCrater.dispose();
  }
}
