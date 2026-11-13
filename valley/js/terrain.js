// 계곡 지형: 높이장 생성 · 메시 · 흙 파기/붓기 · 물리 높이장
import * as THREE from 'three';
import { fbm, vnoise, sstep, clamp, GLSL_NOISE } from './noise.js';

export const CELL = 0.2, NX = 180, NZ = 360, NXV = NX + 1, NZV = NZ + 1, NV = NXV * NZV;
export const X0 = -NX * CELL / 2, Z0 = 0;
export const SX0 = 45, SX1 = 135; // 물 시뮬레이션 열 범위 (x ±9 m) // 물 시뮬레이션 열 범위
export const SW = SX1 - SX0;
export const idx = (i, j) => j * NXV + i;

// 모든 셰이더가 공유하는 유니폼
export const U = {
  uTime: { value: 0 },
  tWater: { value: null },
  uWInfo: { value: new THREE.Vector4(X0 + SX0 * CELL, Z0, 1 / CELL, 0) },
  uWSize: { value: new THREE.Vector2(SW, NZV) },
  uSunDir: { value: new THREE.Vector3(-0.38, 0.82, 0.43).normalize() },
  uSunCol: { value: new THREE.Color(1.0, 0.93, 0.82) },
  uRain: { value: 0 },
  uDay: { value: 1 },
};

// 장소: 'valley' 계곡 / 'sea' 바다 (지형을 만들기 전에 정한다)
export let MODE = 'valley';
export function setMode(m) { MODE = m === 'sea' ? 'sea' : 'valley'; }
export const noTree = []; // 나무를 심지 않을 자리 [x, z, r]
export const centerX = z => MODE === 'sea' ? 0 : 1.8 * Math.sin(z * 0.13 + 0.5) + 0.6 * Math.sin(z * 0.31 + 1.3);
export const floorHalf = z => MODE === 'sea' ? 7.2 : 5.0 + 1.9 * Math.sin(z * 0.17 + 2.33); // z≈14 에서 가장 좁음
export const chanW = z => MODE === 'sea' ? 7 : 1.05 + 0.35 * Math.sin(z * 0.13 + 0.7);
export const FALL_Z = 50.5, FALL_H = 1.0; // 작은 폭포: 바위 턱 위치·높이
export function baseY(z) {
  let y = 4.0 - z * 0.045;
  y += 3.2 * sstep(4.2, 2.8, z);       // 상류 절벽(폭포)
  y -= 2.2 * sstep(66.2, 68.8, z);     // 하류 낙차
  y -= FALL_H * sstep(-0.2, 0.2, z - FALL_Z); // 작은 폭포 (암반 턱)
  if (z < 0) y += -z * 0.06;
  if (z > 72) y -= (z - 72) * 0.07;
  return y;
}

// 바다: 모래언덕(z<14) → 모래사장(물가 z≈38) → 얕은 만(z 72 에서 수심 약 1 m) · 양쪽은 바위 곶, 만 입구 너머 먼바다
export const SEA_Y = 0;
const reefs = [[-4.2, 49, 1.5, 1.3], [4.6, 57, 1.1, 1.0], [-1.5, 63, 0.8, 0.6], [6.2, 31, 0.9, 0.9]];
function seaTerrainAt(x, z) {
  let y = 2.2 - 2.6 * sstep(14, 46, z) - 0.9 * sstep(40, 80, z) - 2.5 * sstep(80, 130, z);
  if (z < 14) y += (14 - z) * 0.06;
  const land = sstep(24, 12, z);
  y += 0.4 * fbm(x * 0.22, z * 0.22, 4) * land + 0.035 * fbm(x * 1.4, z * 1.4, 3) + 0.05 * fbm(x * 0.5 + 9, z * 0.5, 3) * (1 - land);
  // 바위 곶: |x| > 8.3 (만 입구 너머 z>80 에서는 바다로 잠긴다)
  const ax = Math.abs(x), wob = 0.9 * fbm(z * 0.13 + (x > 0 ? 5 : 0), 3.7, 3), hx = ax - 8.3 - wob;
  const arm = sstep(-0.2, 1.6, hx) * sstep(88, 76, z);
  const rough = fbm(x * 0.21 + 3, z * 0.21, 5);
  let rock = arm * (3.6 + 1.6 * rough + 0.12 * Math.max(0, hx) + 0.6 * Math.abs(fbm(x * 0.6, z * 0.6, 4)));
  rock += sstep(14, 40, ax) * 3 * (1 + fbm(x * 0.04, z * 0.04, 3)) * sstep(100, 70, z); // 바깥 언덕
  // 만 안의 갯바위
  let reef = 0;
  for (const [rx, rz, r, hgt] of reefs) { const d = Math.hypot(x - rx, (z - rz) * 1.2) / r; if (d < 1.6) reef = Math.max(reef, hgt * (1 - sstep(0.3, 1.6, d)) * (1 + 0.35 * fbm(x * 1.1, z * 1.1, 3))); }
  const yr = Math.max(y, y + rock, y + reef * 1.0 + (reef > 0 ? 0.6 * Math.max(0, -y) : 0));
  const rocky = Math.max(sstep(0.05, 0.6, rock), sstep(0.05, 0.3, reef));
  y = yr;
  let soil = (1.6 - 0.3 * land) * (1 - rocky); // 모래 두께
  const grass = land * sstep(-0.1, 0.25, fbm(x * 0.4 - 4, z * 0.4, 3)) * (1 - rocky) + rocky * arm * 0.6 * sstep(4.5, 5.5, y) * sstep(0, 0.3, fbm(x * 0.3, z * 0.3, 3));
  return { y, soil, grass, d: y > 1.9 ? 2.5 + y : 0, w: 7, F: 0 };
}
// 해석적 지형 함수
export function terrainAt(x, z) {
  if (MODE === 'sea') return seaTerrainAt(x, z);
  const cx = centerX(z), d = Math.abs(x - cx), F = floorHalf(z), w = chanW(z);
  let y = baseY(z);
  const ch = 1 - sstep(w * 0.5, w * 1.3, d);
  y -= 0.42 * ch;
  const pz = Math.exp(-((z - 6.4) ** 2) / 5) * Math.exp(-((x - centerX(6.4)) ** 2) / 6);
  y -= 0.75 * pz;
  y += 0.05 * Math.max(0, d - w) + 0.13 * fbm(x * 0.35, z * 0.35, 4) * (1 - ch * 0.7) + 0.035 * fbm(x * 1.7, z * 1.7, 3);
  // 작은 폭포 아래 소(웅덩이)
  const pool = Math.exp(-((z - FALL_Z - 0.9) ** 2) / 0.6) * Math.exp(-((x - cx) ** 2) / 1.6);
  y -= 0.5 * pool;
  // 기슭: 3~4 m 바위 턱 위로 완만한 숲 비탈 (거대한 협곡 벽 없음)
  const e = Math.max(0, d - F);
  const rough = fbm(x * 0.17 + 7, z * 0.17, 5);
  y += (4.4 * (1 - Math.exp(-e / 1.0)) + 0.16 * e + e * e * 0.0015) * (1 + 0.2 * rough);
  y += sstep(0, 3, e) * 1.2 * Math.abs(fbm(x * 0.55, z * 0.55, 4)) + sstep(10, 60, e) * 6 * fbm(x * 0.03, z * 0.03, 4);
  let soil = 0.14 + 0.9 * sstep(w * 1.0, w * 2.6, d) * (1 - sstep(F - 0.3, F + 2.2, d));
  soil *= 0.75 + 0.5 * (vnoise(x * 0.5, z * 0.5) * 0.5 + 0.5);
  soil += sstep(F + 2, F + 6, d) * 0.35 * Math.max(0, fbm(x * 0.3 + 3, z * 0.3, 3) + 0.1);
  soil *= 1 - pz;
  soil *= 1 - sstep(1.4, 0.3, Math.abs(z - FALL_Z - 0.4)) * (1 - sstep(w, w * 2.5, d)) * 0.9; // 폭포 턱·소는 암반
  const grass = sstep(w * 1.5, w * 2.5, d) * sstep(0.2, 0.0, fbm(x * 0.4 - 4, z * 0.4, 3) - 0.25);
  return { y, soil, grass, d, w, F };
}

export const bed = new Float32Array(NV), soil = new Float32Array(NV), loose = new Float32Array(NV);
export const ground = new Float32Array(NV), grass = new Float32Array(NV), dug = new Float32Array(NV);
export const cap = new Float32Array(NV); // 돌 위에 얹힌 흙
export const fill = new Float32Array(NV); // 돌 틈(공극)을 메운 진흙 높이
const PHI = 0.38;
let solidRef = null;
export function setSolidRef(a) { solidRef = a; }
const vh = k => (cap[k] > 0.002 && solidRef ? Math.max(ground[k], solidRef[k]) : ground[k] + fill[k]);

export function generate() {
  const ox = [], oz = [];
  for (let j = 0; j < NZV; j++) for (let i = 0; i < NXV; i++) {
    const x = X0 + i * CELL, z = Z0 + j * CELL, k = idx(i, j);
    const t = terrainAt(x, z);
    ground[k] = t.y; soil[k] = t.soil; grass[k] = t.grass;
  }
  // 경계: 바깥 지형(1m 격자)과 이음새 맞추기
  const edgeLerp = (x, z, alongX) => {
    const a = alongX ? Math.floor(x) : Math.floor(z), f = (alongX ? x : z) - a;
    const p = alongX ? terrainAt(a, z).y : terrainAt(x, a).y;
    const q = alongX ? terrainAt(a + 1, z).y : terrainAt(x, a + 1).y;
    return p + (q - p) * f;
  };
  for (let i = 0; i < NXV; i++) for (const j of [0, NZ]) ground[idx(i, j)] = edgeLerp(X0 + i * CELL, j * CELL, true);
  for (let j = 0; j < NZV; j++) for (const i of [0, NX]) ground[idx(i, j)] = edgeLerp(X0 + i * CELL, j * CELL, false);
  // 흙 두께·풀 덮임을 살짝 흐리게 해서 경계가 삼각형 모양으로 튀지 않게
  for (let pass = 0; pass < 2; pass++) for (const arr of [soil, grass]) {
    const src = arr.slice();
    for (let j = 1; j < NZ; j++) for (let i = 1; i < NX; i++) {
      const k = idx(i, j);
      arr[k] = (src[k] * 4 + src[k - 1] + src[k + 1] + src[k - NXV] + src[k + NXV]) / 8;
    }
  }
  // 경사가 급하면 흙 없음(암반)
  for (let j = 0; j < NZV; j++) for (let i = 0; i < NXV; i++) {
    const k = idx(i, j);
    const s = slopeAt(i, j);
    soil[k] *= 1 - sstep(0.55, 1.0, s);
    grass[k] *= 1 - sstep(0.45, 0.8, s);
    if (soil[k] < 0.3) grass[k] *= sstep(0.15, 0.3, soil[k]);
    bed[k] = ground[k] - soil[k];
  }
}
function slopeAt(i, j) {
  const l = ground[idx(Math.max(0, i - 1), j)], r = ground[idx(Math.min(NX, i + 1), j)];
  const u = ground[idx(i, Math.max(0, j - 1))], d = ground[idx(i, Math.min(NZ, j + 1))];
  return Math.hypot(r - l, d - u) / (2 * CELL);
}

export function groundAt(x, z) {
  const fx = clamp((x - X0) / CELL, 0, NX - 0.001), fz = clamp((z - Z0) / CELL, 0, NZ - 0.001);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
  const a = ground[idx(i, j)], b = ground[idx(i + 1, j)], c = ground[idx(i, j + 1)], d = ground[idx(i + 1, j + 1)];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ───── 재질 ─────
export function terrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  if (MODE === 'sea') m.defines = { SEA: '' };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat; varying vec4 vMat; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMat=aMat; vWP=(modelMatrix*vec4(transformed,1.)).xyz; vWN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vMat; varying vec3 vWP; varying vec3 vWN; uniform float uTime; uniform vec3 uSunCol; uniform vec3 uSunDir; uniform float uRain;\n' + GLSL_NOISE)
      .replace('#include <map_fragment>', TERRAIN_ALBEDO)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', 'normal = bumpN(-vViewPosition, normal, tH, tBump);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * tCaus * uSunCol * 0.9;');
  };
  return m;
}
const TERRAIN_ALBEDO = /* glsl */`
vec3 P = vWP; vec3 N = normalize(vWN);
float slope = 1. - N.y;
// 한 픽셀이 덮는 지면 크기(m): 해상도가 낮거나 멀면 잔무늬·굴곡을 줄여 픽셀 깨짐(2x2 블록)을 막는다
float pxs = length(fwidth(P.xz)) + abs(fwidth(P.y)) * 0.5;
float det = 1. - smoothstep(0.012, 0.05, pxs);
float tBump = mix(0.15, 0.85, det) * (1. - 0.6 * smoothstep(0.35, 0.7, slope)); // 가파른 벽은 굴곡을 줄인다
float fade = (1. - smoothstep(5., 35., length(vViewPosition))) * det;
float sSoil = vMat.x, sLoose = vMat.y, sGrass = vMat.z, sDug = vMat.w;
vec4 wd = waterAt(P.xz); float under = wd.r - P.y;
float wet = clamp(max(wd.b*0.9, smoothstep(-0.06, 0.01, under)), 0., 1.);
float bn = vnoise2(P.xz*0.9 + P.y*0.3) - 0.5;
float rockW = max(1. - smoothstep(0.03, 0.10, sSoil + sLoose + bn*0.08), smoothstep(0.36, 0.64, slope + bn*0.22));
float gravW = (1. - smoothstep(0.22, 0.42, sSoil + bn*0.1)) * (1. - rockW);
float dirtW = max(0., 1. - rockW - gravW);
vec3 alb = vec3(0.); float tH = 0., tRough = 0.;
if (rockW > 0.002) { // 암반: 3D 노이즈(방향 왜곡 없음) — 경사면에서도 무늬가 찌그러지거나 픽셀처럼 깨지지 않게
  vec3 q = P * 0.45;
#ifdef LITE
  float rn = vnoise3(q) * 0.65 + vnoise3(q * 2.3 + 7.1) * 0.35;
  float rn2 = 0.5;
#else
  float rn = vnoise3(q) * 0.55 + vnoise3(q * 2.3 + 7.1) * 0.3 + vnoise3(q * 5.2 + 3.7) * 0.15;
  float rn2 = mix(0.5, vnoise3(P * 2.4 + 11.3), det);
#endif
  vec3 rock = mix(vec3(0.17, 0.165, 0.15), vec3(0.45, 0.43, 0.39), smoothstep(0.15, 0.85, rn)) * (0.86 + 0.24 * rn2);
  rock *= 0.78 + 0.32 * vnoise3(P * 0.16 + 2.3); // 큰 얼룩(명암)
  rock *= 0.94 + 0.06 * sin(P.y * 2.6 + rn * 3.5); // 아주 옅은 지층
  float moss = smoothstep(0.58, 0.72, vnoise3(P * 0.9 + 5.)) * smoothstep(0.75, 0.3, slope);
  rock = mix(rock, vec3(0.28, 0.34, 0.17), moss * 0.45);
  alb += rock * rockW; tRough += 0.86 * rockW;
  tH += (rn * 0.06 + rn2 * 0.01 * fade) * rockW; // 굴곡은 얕게
}
#ifdef LITE
if (gravW > 0.002) { // 가벼운 자갈
  float g1 = vnoise2(P.xz*9.), g2 = vnoise2(P.xz*23.);
  vec3 peb = mix(vec3(0.34,0.31,0.26), vec3(0.54,0.50,0.44), g1) * (0.8 + 0.3*g2);
  alb += peb*gravW; tRough += 0.78*gravW; tH += (g1*0.012 + g2*0.006*fade) * gravW;
}
#else
if (gravW > 0.002) { // 자갈: 큰 돌 + 잔자갈 + 모래
  vec3 vb = voronoi(P.xz*4.2), vs = voronoi(P.xz*13.);
  float big = step(0.68, hash12(vec2(vb.y, 7.1)));
  float domeB = sqrt(max(0., 1. - vb.x*vb.x*2.3)) * smoothstep(0.0, 0.07, vb.z);
  float domeS = sqrt(max(0., 1. - vs.x*vs.x*2.3)) * smoothstep(0.0, 0.1, vs.z);
  float inB = big * smoothstep(0.08, 0.2, domeB);
  vec3 sand = mix(vec3(0.44,0.39,0.31), vec3(0.55,0.49,0.39), vnoise2(P.xz*30.));
  vec3 cB = mix(vec3(0.40,0.39,0.37), vec3(0.66,0.62,0.55), hash12(vec2(vb.y,1.3)));
  cB = mix(cB, vec3(0.26,0.25,0.24), step(0.8, hash12(vec2(vb.y,5.2)))); cB = mix(cB, vec3(0.56,0.45,0.35), step(0.88, hash12(vec2(vb.y,3.7)))*0.8);
  vec3 cS = mix(vec3(0.36,0.35,0.33), vec3(0.62,0.58,0.51), hash12(vec2(vs.y,2.1)));
  cS = mix(cS, vec3(0.5,0.4,0.32), step(0.85, hash12(vec2(vs.y,9.3)))*0.7);
  vec3 peb = mix(mix(sand, cS, smoothstep(0.05, 0.35, domeS)), cB, inB);
  peb *= (0.9 + 0.2*vnoise2(P.xz*55.)*fade + 0.1) * mix(mix(0.6, 1., domeS), mix(0.55, 1.05, domeB), inB);
  alb += peb*gravW; tRough += 0.78*gravW;
  tH += mix(domeS*0.012*mix(0.3, 1., det), 0.012 + domeB*0.05, inB) * gravW;
}
#endif
if (dirtW > 0.002) { // 흙 / 풀밭
  float fb = fbm2(P.xz*0.9);
#ifdef SEA
  vec3 dirt = mix(vec3(0.60,0.53,0.40), vec3(0.78,0.70,0.54), vnoise2(P.xz*3.)) * (0.95 + 0.06*sin(P.x*0.4 + P.z*5.2 + vnoise2(P.xz*1.3)*5.)); // 모래 (물결무늬)
#else
  vec3 dirt = mix(vec3(0.27,0.19,0.12), vec3(0.42,0.31,0.20), vnoise2(P.xz*3.));
#endif
  vec3 gr = mix(vec3(0.16,0.25,0.06), vec3(0.32,0.38,0.11), fb);
  gr = mix(gr, vec3(0.40,0.35,0.16), smoothstep(0.55,0.8,vnoise2(P.xz*2.1+5.))*0.6);
  alb += mix(dirt, gr, sGrass)*dirtW; tRough += 0.95*dirtW;
  tH += (vnoise2(P.xz*28.)*0.006*fade + fb*0.02) * dirtW;
}
float fresh = clamp(max(sDug*1.2, sLoose*10.), 0., 1.) * (1. - rockW*0.7);
if (fresh > 0.002) {
#ifdef SEA
  vec3 fd = mix(vec3(0.52,0.45,0.33), vec3(0.64,0.56,0.42), vnoise2(P.xz*9.));
#else
  vec3 fd = mix(vec3(0.23,0.15,0.09), vec3(0.34,0.24,0.15), vnoise2(P.xz*9.));
#endif
  float fdH = fbm2(P.xz*9.)*0.03 + vnoise2(P.xz*40.)*0.006*fade;
  alb = mix(alb, fd, fresh); tH = mix(tH, fdH, fresh);
}
alb = mix(alb, alb*vec3(0.7,0.85,0.6), smoothstep(0.3,0.0,abs(under))*rockW*0.6);
alb *= mix(1., 0.5, wet); tRough = mix(tRough, 0.2, wet*0.85);
alb = mix(alb, alb*vec3(0.78,0.92,0.88), smoothstep(0.,0.3,under));
float tCaus = 0.;
#ifndef LITE
if (under > 0. && under < 3.) tCaus = caustic(P.xz, uTime) * smoothstep(0.,0.06,under) * exp(-under*1.6) * max(N.y,0.) * max(uSunDir.y,0.) * (1.-0.7*uRain);
#endif
diffuseColor.rgb *= alb;
`;

// ───── 메시 ─────
export let mesh, geo;
export const diag = new Uint8Array(NX * NZ); // 사각형마다 대각선 방향 (경사를 따라)
const dirty = { i0: 1e9, i1: -1, j0: 1e9, j1: -1 };
export const physState = { dirty: false, t: 0, rev: 0 };

export function buildMesh(material) {
  geo = new THREE.BufferGeometry();
  const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3), mat = new Float32Array(NV * 4);
  for (let j = 0; j < NZV; j++) for (let i = 0; i < NXV; i++) { const k = idx(i, j); pos[k * 3] = X0 + i * CELL; pos[k * 3 + 2] = Z0 + j * CELL; }
  const ind = new Uint32Array(NX * NZ * 6); let p = 0;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = idx(i, j), b = a + 1, c = a + NXV, d = c + 1;
    diag[j * NX + i] = Math.abs(ground[a] - ground[d]) > Math.abs(ground[b] - ground[c]) ? 1 : 0;
    if (diag[j * NX + i]) { ind[p++] = a; ind[p++] = c; ind[p++] = b; ind[p++] = b; ind[p++] = c; ind[p++] = d; }
    else { ind[p++] = a; ind[p++] = c; ind[p++] = d; ind[p++] = a; ind[p++] = d; ind[p++] = b; }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aMat', new THREE.BufferAttribute(mat, 4));
  geo.setIndex(new THREE.BufferAttribute(ind, 1));
  writeRegion(0, NX, 0, NZ);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}
function writeRegion(i0, i1, j0, j1) {
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, mat = geo.attributes.aMat.array;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = idx(i, j);
    pos[k * 3 + 1] = vh(k);
    const l = vh(idx(Math.max(0, i - 1), j)), r = vh(idx(Math.min(NX, i + 1), j));
    const u = vh(idx(i, Math.max(0, j - 1))), d = vh(idx(i, Math.min(NZ, j + 1)));
    let nx = (l - r) / (2 * CELL), nz = (u - d) / (2 * CELL), il = 1 / Math.hypot(nx, 1, nz);
    nor[k * 3] = nx * il; nor[k * 3 + 1] = il; nor[k * 3 + 2] = nz * il;
    mat[k * 4] = soil[k]; mat[k * 4 + 1] = loose[k] + cap[k] + fill[k]; mat[k * 4 + 2] = grass[k]; mat[k * 4 + 3] = dug[k];
  }
}
function markDirty(i0, i1, j0, j1, phys = true) {
  dirty.i0 = Math.min(dirty.i0, i0); dirty.i1 = Math.max(dirty.i1, i1);
  dirty.j0 = Math.min(dirty.j0, j0); dirty.j1 = Math.max(dirty.j1, j1);
  physState.rev++; if (phys) physState.dirty = true;
}
// phys=false: 보이는 메시만 갱신(침식 등 작은 변화는 물리 높이장을 다시 만들지 않음)
export function markDirtyCell(i, j, phys = false) { markDirty(Math.max(0, i - 1), Math.min(NX, i + 1), Math.max(0, j - 1), Math.min(NZ, j + 1), phys); }
export function flushMesh() {
  if (dirty.i1 < 0) return false;
  const i0 = Math.max(0, dirty.i0 - 1), i1 = Math.min(NX, dirty.i1 + 1), j0 = Math.max(0, dirty.j0 - 1), j1 = Math.min(NZ, dirty.j1 + 1);
  writeRegion(i0, i1, j0, j1);
  for (const n of ['position', 'normal', 'aMat']) {
    const a = geo.attributes[n]; a.clearUpdateRanges?.(); const s = a.itemSize;
    a.addUpdateRange ? a.addUpdateRange(idx(0, j0) * s, (j1 - j0 + 1) * NXV * s) : null;
    a.needsUpdate = true;
  }
  dirty.i0 = 1e9; dirty.i1 = -1; dirty.j0 = 1e9; dirty.j1 = -1;
  return true;
}

// ───── 흙 파기 / 붓기 ─────
// stoneBot: 셀별 돌의 바닥 높이 (돌 속으로 흙이 차오르지 않게)
export function dig(x, z, radius, depth, ctx) {
  const ci = Math.round((x - X0) / CELL), cj = Math.round((z - Z0) / CELL), r = Math.ceil(radius / CELL);
  let vol = 0;
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 1 || j < 1 || i >= NX || j >= NZ) continue;
    const dd = Math.hypot((i - ci) * CELL, (j - cj) * CELL) / radius; if (dd >= 1) continue;
    const k = idx(i, j); let want = depth * (1 - dd * dd);
    if (cap[k] > 0) { const c = Math.min(cap[k], want); cap[k] -= c; want -= c; vol += c * CELL * CELL; if (ctx) ctx.solid[k] -= c; dug[k] = Math.min(1, dug[k] + c * 12); if (want <= 0) continue; }
    if (fill[k] > 0) { const c = Math.min(fill[k] * PHI, want); fill[k] -= c / PHI; want -= c; vol += c * CELL * CELL; if (want <= 0) continue; }
    const fromL = Math.min(loose[k], want); loose[k] -= fromL; want -= fromL;
    const fromS = Math.min(soil[k], want); soil[k] -= fromS;
    const got = fromL + fromS; if (got <= 0) continue;
    ground[k] -= got; vol += got * CELL * CELL;
    dug[k] = Math.min(1, dug[k] + got * 12); grass[k] = 0;
  }
  markDirty(ci - r, ci + r, cj - r, cj + r); fixDirty();
  return vol;
}
// ───── 땅 평평하게: 목표 높이(target)로 흙을 깎거나 채운다 (암반 아래로는 안 깎음) ─────
export function flatten(x, z, radius, target, rate, ctx) {
  const ci = Math.round((x - X0) / CELL), cj = Math.round((z - Z0) / CELL), r = Math.ceil(radius / CELL);
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 1 || j < 1 || i >= NX || j >= NZ) continue;
    const dd = Math.hypot((i - ci) * CELL, (j - cj) * CELL) / radius; if (dd >= 1) continue;
    const k = idx(i, j), f = 1 - dd * dd;
    let step = Math.max(-rate, Math.min(rate, target - ground[k])) * f;
    if (Math.abs(step) < 1e-4) continue;
    if (step > 0) { loose[k] += step; ground[k] += step; if (ctx && ctx.solid[k] < ground[k]) ctx.solid[k] = ground[k]; }
    else {
      let want = -step;
      const a = Math.min(loose[k], want); loose[k] -= a; want -= a;
      const b = Math.min(soil[k], want); soil[k] -= b;
      ground[k] -= a + b;
    }
    grass[k] *= 0.6; dug[k] = Math.min(1, dug[k] + Math.abs(step) * 8);
  }
  markDirty(ci - r, ci + r, cj - r, cj + r); fixDirty();
}
// ───── 바위 깎기: 흙이든 암반이든 깎아 낸다 ─────
export function carve(x, z, radius, depth) {
  const ci = Math.round((x - X0) / CELL), cj = Math.round((z - Z0) / CELL), r = Math.ceil(radius / CELL);
  let vol = 0;
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 1 || j < 1 || i >= NX || j >= NZ) continue;
    const dd = Math.hypot((i - ci) * CELL, (j - cj) * CELL) / radius; if (dd >= 1) continue;
    const k = idx(i, j); let want = depth * (1 - dd * dd);
    const a = Math.min(loose[k], want); loose[k] -= a; want -= a;
    const b = Math.min(soil[k], want); soil[k] -= b; want -= b;
    bed[k] -= want; ground[k] -= a + b + want; vol += (a + b + want) * CELL * CELL;
    grass[k] = 0;
  }
  markDirty(ci - r, ci + r, cj - r, cj + r); fixDirty();
  return vol;
}
// 사각형 구덩이: 바닥 y 까지 흙·암반을 깎는다 (가장자리는 가파른 바위 절개면)
export function cutRect(xa, xb, za, zb, y) {
  const i0 = Math.max(1, Math.floor((xa - 1.2 - X0) / CELL)), i1 = Math.min(NX - 1, Math.ceil((xb + 1.2 - X0) / CELL));
  const j0 = Math.max(1, Math.floor((za - 1.2 - Z0) / CELL)), j1 = Math.min(NZ - 1, Math.ceil((zb + 1.2 - Z0) / CELL));
  let vol = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = X0 + i * CELL, z = Z0 + j * CELL, e = Math.max(xa - x, x - xb, za - z, z - zb, 0);
    const k = idx(i, j), t = y + e * 4; if (ground[k] <= t) continue;
    let want = ground[k] - t; vol += want * CELL * CELL;
    const a = Math.min(loose[k], want); loose[k] -= a; want -= a;
    const b = Math.min(soil[k], want); soil[k] -= b; want -= b;
    bed[k] -= want; ground[k] = t; grass[k] = 0; cap[k] = 0; fill[k] = 0;
  }
  markDirty(i0, i1, j0, j1); fixDirty();
  return vol;
}
// 생성 직후: 집터를 평평하게 다진다 (회전된 직사각형 + 1 m 가장자리 완만하게)
export function flattenPad(x, z, hw, hd, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw), rr = Math.hypot(hw, hd) + 1.2;
  let sum = 0, n = 0;
  const each = fn => {
    const i0 = Math.max(1, Math.floor((x - rr - X0) / CELL)), i1 = Math.min(NX - 1, Math.ceil((x + rr - X0) / CELL));
    const j0 = Math.max(1, Math.floor((z - rr - Z0) / CELL)), j1 = Math.min(NZ - 1, Math.ceil((z + rr - Z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = X0 + i * CELL - x, dz = Z0 + j * CELL - z, lx = Math.abs(dx * c - dz * s), lz = Math.abs(dx * s + dz * c);
      const e = Math.max(lx - hw, lz - hd, 0); if (e < 1.2) fn(idx(i, j), e);
    }
  };
  each((k, e) => { if (e === 0) { sum += ground[k]; n++; } });
  const h0 = sum / Math.max(1, n);
  each((k, e) => {
    const w = e === 0 ? 1 : 1 - sstep(0, 1.2, e), g = ground[k] + (h0 - ground[k]) * w;
    ground[k] = g; if (bed[k] > g - 0.3) bed[k] = g - 0.3; soil[k] = g - bed[k]; if (e < 0.4) grass[k] *= 0.3;
  });
  return h0;
}

// ───── 저장: 처음 만든 지형과 달라진 칸만 기록 ─────
let soil0 = null, bed0 = null, grass0 = null;
export function remember() { soil0 = soil.slice(); bed0 = bed.slice(); grass0 = grass.slice(); }
const q = v => Math.round(v * 1000);
export function snapshot() {
  const d = { s: [], b: [], l: [], c: [], f: [], g: [], u: [] };
  for (let k = 0; k < NV; k++) {
    if (Math.abs(soil[k] - soil0[k]) > 1e-4) d.s.push(k, q(soil[k]));
    if (Math.abs(bed[k] - bed0[k]) > 1e-4) d.b.push(k, q(bed[k]));
    if (loose[k] > 1e-4) d.l.push(k, q(loose[k]));
    if (cap[k] > 1e-4) d.c.push(k, q(cap[k]));
    if (fill[k] > 1e-4) d.f.push(k, q(fill[k]));
    if (Math.abs(grass[k] - grass0[k]) > 0.01) d.g.push(k, Math.round(grass[k] * 100));
    if (dug[k] > 0.01) d.u.push(k, Math.round(dug[k] * 100));
  }
  return d;
}
export function restore(d) {
  const put = (arr, list, sc) => { for (let n = 0; n < list.length; n += 2) arr[list[n]] = list[n + 1] / sc; };
  put(soil, d.s, 1000); put(bed, d.b, 1000); put(loose, d.l, 1000); put(cap, d.c, 1000); put(fill, d.f, 1000); put(grass, d.g, 100); put(dug, d.u, 100);
  for (let k = 0; k < NV; k++) ground[k] = bed[k] + soil[k] + loose[k];
}

// 돌이 떨어진 충격: 흙이 눌려 움푹 패이고, 밀려난 흙이 가장자리에 둥글게 쌓인다(암반은 안 패임)
export function impact(x, z, R, depth, ctx) {
  const ci = Math.round((x - X0) / CELL), cj = Math.round((z - Z0) / CELL), r = Math.ceil(R * 1.6 / CELL);
  let removed = 0, wsum = 0; const rim = [];
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 1 || j < 1 || i >= NX || j >= NZ) continue;
    const k = idx(i, j), d = Math.hypot((i - ci) * CELL, (j - cj) * CELL) / R;
    if (d < 1) {
      let want = depth * (1 - d * d);
      const a = Math.min(loose[k], want); loose[k] -= a; want -= a;
      const b = Math.min(soil[k], want); soil[k] -= b;
      const got = a + b; if (got <= 0) continue;
      ground[k] -= got; removed += got;
      dug[k] = Math.min(1, dug[k] + got * 18); grass[k] *= 0.1;
    } else if (d < 1.6) { const w = Math.max(0, 1 - Math.abs(d - 1.25) / 0.35); if (w > 0) { rim.push(k, w); wsum += w; } }
  }
  // 절반은 다져지고 절반은 가장자리로 밀려난다
  if (wsum > 0) for (let n = 0; n < rim.length; n += 2) put(rim[n], removed * 0.5 * rim[n + 1] / wsum, ctx);
  markDirty(ci - r, ci + r, cj - r, cj + r); fixDirty();
  return removed * CELL * CELL;
}
export function deposit(x, z, radius, vol, ctx) {
  const ci = Math.round((x - X0) / CELL), cj = Math.round((z - Z0) / CELL), r = Math.ceil(radius / CELL);
  let wsum = 0; const cells = [];
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    if (i < 1 || j < 1 || i >= NX || j >= NZ) continue;
    const dd = Math.hypot((i - ci) * CELL, (j - cj) * CELL) / radius; if (dd >= 1) continue;
    const w = 1 - dd * dd; cells.push(idx(i, j), w); wsum += w;
  }
  for (let n = 0; n < cells.length; n += 2) put(cells[n], vol * cells[n + 1] / wsum / (CELL * CELL), ctx);
  slump(ci, cj, r + 3, ctx);
  markDirty(ci - r - 4, ci + r + 4, cj - r - 4, cj + r + 4); fixDirty();
  return vol;
}
// 높이 add 만큼 흙을 셀 k 에 놓기: 돌이 있으면 돌 틈(아래)을 먼저 채우고 남으면 돌 위에 얹는다
function put(k, add, ctx) {
  const room = ctx ? ctx.sBot[k] - 0.01 - ground[k] : 1e9;
  const below = Math.max(0, Math.min(add, room));
  loose[k] += below; ground[k] += below;
  if (ctx) {
    if (ctx.solid[k] < ground[k]) ctx.solid[k] = ground[k];
    let rest = add - below;
    if (rest > 0) { // 돌 틈을 진흙으로 먼저 메우고, 다 차면 돌 위에 얹힌다
      const room2 = Math.max(0, ctx.ptop[k] - ground[k] - fill[k]), f = Math.min(rest / PHI, room2);
      fill[k] += f; rest -= f * PHI;
      if (rest > 0) { cap[k] += rest; ctx.solid[k] += rest; }
    }
  }
  if (add > 0.003) grass[k] = 0;
}
const surf = (k, ctx) => (ctx && (cap[k] > 0 || ctx.sBot[k] < 1e8) ? ctx.solid[k] : ground[k]);
// 흙 안식각(약 37°)을 넘으면 흘러내림
const MAXD = CELL * 0.75;
export function slump(ci, cj, r, ctx) {
  for (let it = 0; it < 8; it++) {
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 1 || j < 1 || i >= NX || j >= NZ) continue;
      const k = idx(i, j); if (loose[k] <= 0 && cap[k] <= 0) continue;
      for (const n of [k - 1, k + 1, k - NXV, k + NXV]) {
        const diff = surf(k, ctx) - surf(n, ctx);
        if (diff <= MAXD) continue;
        let mv = (diff - MAXD) * 0.25;
        if (cap[k] > 0) { mv = Math.min(mv, cap[k]); cap[k] -= mv; if (ctx) ctx.solid[k] -= mv; }
        else { mv = Math.min(mv, loose[k]); loose[k] -= mv; ground[k] -= mv; if (ctx && ctx.solid[k] > ground[k] && ctx.sBot[k] > 1e8) ctx.solid[k] = ground[k]; }
        if (mv > 0) put(n, mv, ctx);
      }
    }
  }
}
function fixDirty() {
  dirty.i0 = Math.max(0, dirty.i0); dirty.j0 = Math.max(0, dirty.j0);
  dirty.i1 = Math.min(NX, dirty.i1); dirty.j1 = Math.min(NZ, dirty.j1);
}

// ───── 물리 높이장 ─────
let hfCollider = null;
export function buildPhysics(R, world) {
  if (hfCollider) world.removeCollider(hfCollider, false);
  const h = new Float32Array(NV);
  for (let i = 0; i < NXV; i++) for (let j = 0; j < NZV; j++) h[j + i * NZV] = ground[idx(i, j)];
  const d = R.ColliderDesc.heightfield(NZ, NX, h, { x: NX * CELL, y: 1, z: NZ * CELL })
    .setTranslation(0, 0, Z0 + NZ * CELL / 2).setFriction(0.9);
  hfCollider = world.createCollider(d);
  physState.dirty = false; physState.t = 0;
  return hfCollider;
}
export const getHF = () => hfCollider;

// ───── 바깥 산 (1m 격자, 안쪽 영역은 비움) ─────
export function buildOuter(material) {
  const XA = -70, XB = 70, ZA = -50, ZB = 130, S = 1; // 안개 너머 안 보이는 곳은 만들지 않음
  const nx = (XB - XA) / S + 1, nz = (ZB - ZA) / S + 1;
  const pos = new Float32Array(nx * nz * 3), mat = new Float32Array(nx * nz * 4);
  const ys = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = XA + i * S, z = ZA + j * S, k = j * nx + i, t = terrainAt(x, z);
    ys[k] = t.y; pos[k * 3] = x; pos[k * 3 + 1] = t.y; pos[k * 3 + 2] = z;
    mat[k * 4] = t.soil; mat[k * 4 + 2] = t.grass;
  }
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i, s = Math.hypot(ys[k + 1] - ys[k - 1], ys[k + nx] - ys[k - nx]) / (2 * S);
    mat[k * 4] *= 1 - sstep(0.55, 1.0, s); mat[k * 4 + 2] *= 1 - sstep(0.45, 0.8, s);
  }
  const ind = [];
  const ix0 = (X0 - XA) / S, ix1 = (-X0 - XA) / S, iz0 = (0 - ZA) / S, iz1 = (NZ * CELL - ZA) / S;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (i >= ix0 && i + 1 <= ix1 && j >= iz0 && j + 1 <= iz1) continue;
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    ind.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(mat, 4));
  g.setIndex(ind); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.receiveShadow = true; m.castShadow = true;
  return m;
}
