// FREE FREELY 우주 탐사 - 은하(입자 LOD) · 국소 별 배경(순환 격자) · 성운 · 블랙홀
import * as THREE from 'three';
import { LOGDEPTH_VS_PARS, LOGDEPTH_VS, LOGDEPTH_FS_PARS, LOGDEPTH_FS } from './glsl.js';
import { LY, blackbody } from './consts.js';

const ADD = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };

function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/* ------------------------------ 은하 입자 ------------------------------ */
const GAL_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
attribute vec3 color;
attribute float size;
uniform float uPixelScale;
uniform float uBright;
uniform float uNearFade;
uniform float uDpr;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = length(mv.xyz);
  float px = size * uPixelScale / d;
  float ps = clamp(px, 1.0, 40.0);
  float e = (px * px) / (ps * ps);
  float near = smoothstep(uNearFade * 0.25, uNearFade, d);
  // 화면에서 크게 보이는 가까운 입자(성단 덩어리)는 사라지고 국소 별 배경이 대신한다
  float big = 1.0 - smoothstep(5.0, 22.0, px);
  vA = min(1.5, e) * near * big * uBright;
  vCol = color;
  gl_PointSize = ps * 2.0 * uDpr;
  gl_Position = projectionMatrix * mv;
  if (vA < 0.0005) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  ${LOGDEPTH_VS}
}`;
const GAL_FS = /* glsl */`
precision highp float;
${LOGDEPTH_FS_PARS}
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(c, c) * 4.0);
  gl_FragColor = vec4(vCol * a * vA, 0.0);
  ${LOGDEPTH_FS}
}`;

export class GalaxyView {
  constructor(body, ctx, count) {
    this.body = body;
    const R = body.galRadius;
    const r = rng(body.seed || 1);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
    const C = body.colors;
    const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let i = 0; i < count; i++) {
      let x, y, z, c, s = R / 160;
      if (body.gtype === 'spiral') {
        const isBulge = r() < (body.bulge || 0.15);
        if (isBulge) {
          const rr = Math.abs(gauss(r)) * R * 0.09;
          const th = r() * Math.PI * 2, ph = Math.acos(r() * 2 - 1);
          x = rr * Math.sin(ph) * Math.cos(th) * 1.6; z = rr * Math.sin(ph) * Math.sin(th); y = rr * Math.cos(ph) * 0.6;
          c = lerp3(C.core, [1, 0.7, 0.45], r() * 0.5);
          s *= 1.4;
        } else {
          const rr = Math.min(R * 1.1, -Math.log(1 - r() * 0.985) * R * 0.28 + R * 0.04);
          const arms = body.arms || 2;
          const arm = Math.floor(r() * arms);
          const twist = body.armTwist || 3;
          const spread = body.flocculent ? 0.9 : 0.32 + 0.25 * (1 - rr / R);
          const th = arm * (Math.PI * 2 / arms) + Math.log(rr / (R * 0.05) + 1) * twist + gauss(r) * spread * (r() < 0.25 ? 2.5 : 1);
          x = Math.cos(th) * rr; z = Math.sin(th) * rr;
          y = gauss(r) * R * 0.012 * (1 + rr / R);
          const inArm = Math.exp(-Math.pow(gauss(r) * spread, 2));
          c = lerp3(C.core, C.arm, Math.min(1, rr / (R * 0.5)) * (0.5 + 0.5 * inArm));
          // HII 영역 (분홍빛 별 탄생 구역)
          if (r() < 0.025) { c = [1.0, 0.45, 0.62]; s *= 0.7; }
          // 먼지띠 근처 붉게 감쇠
          if (r() < 0.12) c = c.map((v, k) => v * [0.75, 0.55, 0.45][k]);
        }
      } else if (body.gtype === 'elliptical') {
        const e = body.ellip || [1, 0.8, 0.9];
        // 드 보쿨뢰르 근사: 중심 집중
        const rr = Math.pow(r(), 2.6) * R;
        const th = r() * Math.PI * 2, ph = Math.acos(r() * 2 - 1);
        x = rr * Math.sin(ph) * Math.cos(th) * e[0]; y = rr * Math.cos(ph) * e[1]; z = rr * Math.sin(ph) * Math.sin(th) * e[2];
        c = lerp3(C.core, C.arm, rr / R);
        s *= 1.3;
      } else {
        // 불규칙: 덩어리 몇 개 + 막대
        const k = Math.floor(r() * 6);
        const cr = rng(body.seed * 31 + k);
        const cx = (cr() - 0.5) * R * 1.2, cy = (cr() - 0.5) * R * 0.3, cz = (cr() - 0.5) * R * 0.8;
        const rad = R * (0.12 + cr() * 0.25);
        x = cx + gauss(r) * rad; y = cy + gauss(r) * rad * 0.4; z = cz + gauss(r) * rad;
        if (k === 0) { x = (r() - 0.5) * R * 1.4; y = gauss(r) * R * 0.05; z = gauss(r) * R * 0.08; }
        c = lerp3(C.core, C.arm, r());
        if (r() < 0.05) c = [1.0, 0.5, 0.65];
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      const b = 0.6 + r() * 0.8;
      col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
      size[i] = s * (0.5 + r());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: GAL_VS, fragmentShader: GAL_FS, ...ADD,
      uniforms: { uPixelScale: { value: 800 }, uBright: { value: 0.35 * 120000 / count }, uNearFade: { value: R * 0.03 }, uDpr: { value: 1 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.renderOrder = -10;
    ctx.scene.add(this.points);
  }

  update(f) {
    const b = this.body;
    const m = this.points.matrix;
    m.makeRotationFromQuaternion(b.rotation);
    m.elements[12] = b.rel.x; m.elements[13] = b.rel.y; m.elements[14] = b.rel.z;
    this.points.matrixWorld.copy(m);
    this.mat.uniforms.uPixelScale.value = f.pixelScale;
    this.mat.uniforms.uDpr.value = f.dpr;
  }

  dispose() { this.points.parent && this.points.parent.remove(this.points); this.points.geometry.dispose(); this.mat.dispose(); }
}

/* ------------------------------ 국소 별 배경 (순환 격자) ------------------------------ */
const SF_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
attribute vec3 color;
attribute vec2 lum;   // x: 광도(태양=1), y: 표시 임계값
uniform vec3 uOffset;
uniform float uL;
uniform float uScale;
uniform float uDensity;
uniform float uDpr;
uniform float uExposure;
varying vec3 vCol;
varying float vA;
void main() {
  vec3 p = mod(position - uOffset + 0.5 * uL, uL) - 0.5 * uL;
  float d = length(p);
  float fade = 1.0 - smoothstep(0.36 * uL, 0.49 * uL, d);
  float show = step(lum.y, uDensity);
  float flux = lum.x / max(1e-4, d * d);
  float m = log2(1.0 + flux * 2400.0 * uExposure);
  vA = clamp(m * 0.2, 0.0, 6.0) * fade * show;
  vCol = color;
  vec4 mv = modelViewMatrix * vec4(p * uScale, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(1.5 + m * 0.55, 1.5, 9.0) * uDpr;
  if (vA < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  ${LOGDEPTH_VS}
}`;
const SF_FS = /* glsl */`
precision highp float;
${LOGDEPTH_FS_PARS}
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(c, c);
  float a = exp(-d2 * 6.0) + exp(-d2 * 1.5) * 0.08;
  gl_FragColor = vec4(vCol * a * vA, 0.0);
  ${LOGDEPTH_FS}
}`;

export class Starfield {
  constructor(ctx, count, L = 600) {
    const r = rng(77);
    this.L = L;
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), lum = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (r() - 0.5) * L; pos[i * 3 + 1] = (r() - 0.5) * L; pos[i * 3 + 2] = (r() - 0.5) * L;
      // 별 종류 분포 (주계열 + 거성)
      const k = r();
      let T, Lm;
      if (k < 0.55) { T = 2800 + r() * 1000; Lm = 0.002 + r() * 0.05; }        // 적색왜성
      else if (k < 0.8) { T = 3900 + r() * 1300; Lm = 0.1 + r() * 0.6; }        // K형
      else if (k < 0.93) { T = 5200 + r() * 900; Lm = 0.7 + r() * 1.5; }        // G형
      else if (k < 0.975) { T = 6100 + r() * 3500; Lm = 2 + r() * 30; }         // F·A형
      else if (k < 0.992) { T = 3400 + r() * 1200; Lm = 50 + r() * 900; }       // 적색거성
      else { T = 10000 + r() * 22000; Lm = 300 + r() * 40000; }                 // 청색거성
      const [cr, cg, cb] = blackbody(T);
      const mx = Math.max(cr, cg, cb);
      col[i * 3] = cr / mx; col[i * 3 + 1] = cg / mx; col[i * 3 + 2] = cb / mx;
      lum[i * 2] = Lm; lum[i * 2 + 1] = r();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('lum', new THREE.BufferAttribute(lum, 2));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SF_VS, fragmentShader: SF_FS, ...ADD,
      uniforms: { uOffset: { value: new THREE.Vector3() }, uL: { value: L }, uScale: { value: LY }, uDensity: { value: 1 }, uDpr: { value: 1 }, uExposure: { value: 1 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.renderOrder = -9;
    ctx.scene.add(this.points);
  }

  /** gal: 카메라가 속한 은하 (없으면 null), camGal: 은하 좌표 카메라 위치(m, Float64) */
  update(gal, camGal, f) {
    if (!gal) { this.points.visible = false; return; }
    this.points.visible = true;
    const L = this.L;
    const m = (v) => { const x = v / LY; return x - Math.floor(x / L) * L; };
    this.mat.uniforms.uOffset.value.set(m(camGal.x), m(camGal.y), m(camGal.z));
    this.points.matrix.makeRotationFromQuaternion(gal.rotation);
    this.points.matrixWorld.copy(this.points.matrix);
    this.mat.uniforms.uDensity.value = galaxyDensity(gal, camGal);
    this.mat.uniforms.uDpr.value = f.dpr;
    this.mat.uniforms.uExposure.value = f.starExposure ?? 1;
  }
}

/** 은하 내 위치의 상대 별 밀도 (태양 근처 ≈ 1) */
export function galaxyDensity(gal, p) {
  const R = gal.galRadius;
  if (gal.gtype === 'spiral') {
    const r = Math.hypot(p.x, p.z);
    const d = Math.exp(-(r - R * 0.52) / (R * 0.28)) * Math.exp(-Math.abs(p.y) / (R * 0.02));
    const bulge = Math.exp(-(r * r + p.y * p.y * 4) / Math.pow(R * 0.08, 2)) * 6;
    return Math.min(1, d + bulge);
  }
  const r = Math.hypot(p.x, p.y, p.z) / R;
  return Math.min(1, Math.exp(-r * 5) * 2.2);
}

/* ------------------------------ 성운 ------------------------------ */
const NEB_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
attribute vec3 iCenter;
attribute vec4 iColor;   // rgb, 크기(m)
attribute float iRot;
uniform float uPixelScale;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(iCenter, 1.0);
  float d = length(mv.xyz);
  float s = iColor.a;
  float c = cos(iRot), si = sin(iRot);
  vec2 q = vec2(position.x * c - position.y * si, position.x * si + position.y * c);
  mv.xy += q * s;
  vUv = uv;
  vCol = iColor.rgb;
  // 가까이 다가가면 사라짐 (거대한 면 채움 방지), 멀면 밝기 보존
  float near = smoothstep(s * 0.4, s * 2.2, d);
  float px = s * uPixelScale / d;
  vA = near * min(1.0, px / 3.0);
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VS}
}`;
const NEB_FS = /* glsl */`
precision highp float;
${LOGDEPTH_FS_PARS}
uniform sampler2D uTex;
uniform float uBright;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 t = texture(uTex, vUv);
  gl_FragColor = vec4(vCol * t.r * vA * uBright, 0.0);
  ${LOGDEPTH_FS}
}`;

function nebulaTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  const r = rng(5);
  const blobs = [];
  for (let i = 0; i < 14; i++) blobs.push([0.25 + r() * 0.5, 0.25 + r() * 0.5, 0.08 + r() * 0.2, 0.4 + r() * 0.6]);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = x / s, v = y / s;
    let a = 0;
    for (const [bx, by, br, bw] of blobs) a += Math.exp(-((u - bx) ** 2 + (v - by) ** 2) / (br * br)) * bw;
    const edge = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2);
    a = Math.min(1, a * 0.45) * edge * edge;
    const k = (y * s + x) * 4;
    img.data[k] = a * 255; img.data[k + 1] = a * 255; img.data[k + 2] = a * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

export class NebulaView {
  constructor(body, ctx, count = 260) {
    this.body = body;
    const r = rng(body.seed || 3);
    const R = body.nebRadius;
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const cen = new Float32Array(count * 3), col = new Float32Array(count * 4), rot = new Float32Array(count);
    const clumps = [];
    for (let i = 0; i < 7; i++) clumps.push([gauss(r) * R * 0.4, gauss(r) * R * 0.25, gauss(r) * R * 0.4]);
    for (let i = 0; i < count; i++) {
      const cl = clumps[i % clumps.length];
      cen[i * 3] = cl[0] + gauss(r) * R * 0.3; cen[i * 3 + 1] = cl[1] + gauss(r) * R * 0.2; cen[i * 3 + 2] = cl[2] + gauss(r) * R * 0.3;
      const c = body.colors[Math.floor(r() * body.colors.length)];
      const b = 0.4 + r() * 0.8;
      col[i * 4] = c[0] * b; col[i * 4 + 1] = c[1] * b; col[i * 4 + 2] = c[2] * b; col[i * 4 + 3] = R * (0.15 + r() * 0.35);
      rot[i] = r() * Math.PI * 2;
    }
    g.setAttribute('iCenter', new THREE.InstancedBufferAttribute(cen, 3));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(col, 4));
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(rot, 1));
    g.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: NEB_VS, fragmentShader: NEB_FS, ...ADD,
      uniforms: { uTex: { value: nebulaTexture() }, uPixelScale: { value: 800 }, uBright: { value: 0.07 } },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = -8;
    ctx.scene.add(this.mesh);
  }
  update(f) {
    const rel = this.body.rel;
    this.mesh.matrix.makeTranslation(rel.x, rel.y, rel.z);
    this.mesh.matrixWorld.copy(this.mesh.matrix);
    this.mat.uniforms.uPixelScale.value = f.pixelScale;
  }
}

/* ------------------------------ 블랙홀 ------------------------------ */
const DISK_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
varying vec3 vP;
varying vec3 vW;
void main() {
  vP = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  ${LOGDEPTH_VS}
}`;
const DISK_FS = /* glsl */`
precision highp float;
precision highp sampler3D;
${LOGDEPTH_FS_PARS}
uniform sampler3D uNoise;
uniform float uIn;
uniform float uOut;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uViewL;
varying vec3 vP;
varying vec3 vW;
void main() {
  float r = length(vP.xz);
  float u = (r - uIn) / (uOut - uIn);
  if (u < 0.0 || u > 1.0) discard;
  float a = atan(vP.z, vP.x);
  float spin = uTime * 0.6 / pow(r / uIn, 1.5);
  float n = texture(uNoise, vec3(cos(a + spin) * u * 2.0, sin(a + spin) * u * 2.0, u * 0.7)).r;
  float n2 = texture(uNoise, vec3(u * 6.0, (a + spin) * 0.8, 0.3)).g;
  float temp = pow(max(0.001, 1.0 - u), 1.6);
  vec3 hot = mix(uColor, vec3(1.0, 0.95, 0.85), temp);
  // 도플러 빔: 다가오는 쪽이 밝다
  vec3 vel = normalize(vec3(-vP.z, 0.0, vP.x));
  float dop = 1.0 + 0.75 * dot(vel, normalize(uViewL - vP));
  float I = (temp * 6.0 + 0.4) * (0.5 + n * 0.8) * (0.7 + n2 * 0.5) * dop * dop;
  float edge = smoothstep(0.0, 0.05, u) * smoothstep(1.0, 0.6, u);
  gl_FragColor = vec4(hot * I * edge, 0.0);
  ${LOGDEPTH_FS}
}`;

export class BlackHoleView {
  constructor(body, ctx) {
    this.body = body;
    const rs = body.radius;
    this.horizon = new THREE.Mesh(new THREE.SphereGeometry(rs, 64, 48), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    this.horizon.matrixAutoUpdate = false;
    ctx.scene.add(this.horizon);
    const d = body.disk;
    const g = new THREE.RingGeometry(rs * d.inner, rs * d.outer, 256, 8);
    g.rotateX(-Math.PI / 2);
    this.diskMat = new THREE.ShaderMaterial({
      vertexShader: DISK_VS, fragmentShader: DISK_FS, side: THREE.DoubleSide, ...ADD,
      uniforms: { uNoise: { value: ctx.cloudTex }, uIn: { value: rs * d.inner }, uOut: { value: rs * d.outer }, uTime: { value: 0 }, uColor: { value: new THREE.Vector3(...d.color) }, uViewL: { value: new THREE.Vector3() } },
    });
    this.disk = new THREE.Mesh(g, this.diskMat);
    this.disk.matrixAutoUpdate = false;
    this.disk.renderOrder = 7;
    ctx.scene.add(this.disk);
    this.tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0, 0.18));
  }
  update(f) {
    const rel = this.body.rel;
    for (const o of [this.horizon, this.disk]) {
      o.matrix.makeRotationFromQuaternion(this.tilt);
      o.matrix.elements[12] = rel.x; o.matrix.elements[13] = rel.y; o.matrix.elements[14] = rel.z;
      o.matrixWorld.copy(o.matrix);
    }
    this.diskMat.uniforms.uTime.value = f.time;
    this.diskMat.uniforms.uViewL.value.copy(rel).negate().applyQuaternion(this.tilt.clone().invert());
  }
}
