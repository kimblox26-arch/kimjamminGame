// 계곡 지형: 높이장 생성 · 메시 · 흙 파기/붓기 · 물리 높이장
import * as THREE from 'three';
import { fbm, vnoise, sstep, clamp, GLSL_NOISE } from './noise.js';

export const CELL = 0.2, NX = 220, NZ = 300, NXV = NX + 1, NZV = NZ + 1, NV = NXV * NZV;
export const X0 = -NX * CELL / 2, Z0 = 0;
export const SX0 = 45, SX1 = 176; // 물 시뮬레이션 열 범위
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
};

export const centerX = z => 2.2 * Math.sin(z * 0.09 + 0.5) + 0.8 * Math.sin(z * 0.23 + 1.3);
export const floorHalf = z => 5.6 + 2.2 * Math.sin(z * 0.075 + 2.2);
export const chanW = z => 1.05 + 0.35 * Math.sin(z * 0.13 + 0.7);
export function baseY(z) {
  let y = 4.0 - z * 0.045;
  y += 3.2 * sstep(4.2, 2.8, z);       // 상류 절벽(폭포)
  y -= 2.6 * sstep(55.5, 58.6, z);     // 하류 낙차
  if (z < 0) y += -z * 0.06;
  if (z > 60) y -= (z - 60) * 0.07;
  return y;
}

// 해석적 지형 함수
export function terrainAt(x, z) {
  const cx = centerX(z), d = Math.abs(x - cx), F = floorHalf(z), w = chanW(z);
  let y = baseY(z);
  const ch = 1 - sstep(w * 0.5, w * 1.3, d);
  y -= 0.42 * ch;
  const pz = Math.exp(-((z - 6.4) ** 2) / 5) * Math.exp(-((x - centerX(6.4)) ** 2) / 6);
  y -= 0.75 * pz;
  y += 0.05 * Math.max(0, d - w) + 0.13 * fbm(x * 0.35, z * 0.35, 4) * (1 - ch * 0.7) + 0.035 * fbm(x * 1.7, z * 1.7, 3);
  const e = Math.max(0, d - F);
  const rough = fbm(x * 0.17 + 7, z * 0.17, 5);
  y += (15 * (1 - Math.exp(-e / 6.5)) + 0.25 * e + e * e * 0.004) * (1 + 0.35 * rough);
  y += sstep(0, 3, e) * 1.6 * Math.abs(fbm(x * 0.55, z * 0.55, 4)) + sstep(10, 60, e) * 25 * fbm(x * 0.03, z * 0.03, 4);
  let soil = 0.14 + 0.9 * sstep(w * 1.0, w * 2.6, d) * (1 - sstep(F - 0.3, F + 2.2, d));
  soil *= 0.75 + 0.5 * (vnoise(x * 0.5, z * 0.5) * 0.5 + 0.5);
  soil += sstep(F + 2, F + 6, d) * 0.35 * Math.max(0, fbm(x * 0.3 + 3, z * 0.3, 3) + 0.1);
  soil *= 1 - pz;
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
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat; varying vec4 vMat; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMat=aMat; vWP=(modelMatrix*vec4(transformed,1.)).xyz; vWN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vMat; varying vec3 vWP; varying vec3 vWN; uniform float uTime; uniform vec3 uSunCol; uniform vec3 uSunDir; uniform float uRain;\n' + GLSL_NOISE)
      .replace('#include <map_fragment>', TERRAIN_ALBEDO)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', 'normal = bumpN(-vViewPosition, normal, tH, 1.0);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * tCaus * uSunCol * 0.9;');
  };
  return m;
}
const TERRAIN_ALBEDO = /* glsl */`
vec3 P = vWP; vec3 N = normalize(vWN);
float slope = 1. - N.y;
float fade = 1. - smoothstep(5., 35., length(vViewPosition));
float sSoil = vMat.x, sLoose = vMat.y, sGrass = vMat.z, sDug = vMat.w;
vec4 wd = waterAt(P.xz); float under = wd.r - P.y;
float wet = clamp(max(wd.b*0.9, smoothstep(-0.06, 0.01, under)), 0., 1.);
float rockW = max(1. - smoothstep(0.03, 0.10, sSoil + sLoose), smoothstep(0.38, 0.62, slope));
float gravW = (1. - smoothstep(0.24, 0.40, sSoil)) * (1. - rockW);
float dirtW = max(0., 1. - rockW - gravW);
vec3 alb = vec3(0.); float tH = 0., tRough = 0.;
if (rockW > 0.002) { // 암반 (3축 투영)
  vec3 tw = pow(abs(N), vec3(4.)); tw /= tw.x + tw.y + tw.z;
  vec2 rp = P.zy*tw.x + P.xz*tw.y + P.xy*tw.z;
  float rn = fbm2(P.zy*0.5)*tw.x + fbm2(P.xz*0.5)*tw.y + fbm2(P.xy*0.5)*tw.z;
  float rn2 = vnoise2(rp*2.1 + 4.)*0.6 + vnoise2(rp*4.3)*0.4;
  float strata = sin(P.y*5. + rn*9. + rn2*3.)*.5+.5;
  vec3 rock = mix(vec3(0.19,0.18,0.165), vec3(0.42,0.40,0.36), rn) * (0.86 + 0.14*strata) * (0.8 + 0.35*rn2);
  rock = mix(rock, vec3(0.30,0.36,0.18), smoothstep(0.6,0.75,vnoise2(rp*1.6 + P.y))*0.5*smoothstep(0.7,0.2,slope));
  float cr = smoothstep(0.018, 0.0, abs(vnoise2(rp*2.6) - 0.5)) * (0.2 + 0.8*fade);
  rock *= 1. - cr*0.1;
  alb += rock*rockW; tRough += 0.86*rockW;
  tH += (rn*0.22 + rn2*0.05 + strata*0.008 - cr*0.015 + vnoise2(rp*15.)*0.006*fade) * rockW;
}
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
  tH += mix(domeS*0.012, 0.012 + domeB*0.05, inB) * gravW;
}
if (dirtW > 0.002) { // 흙 / 풀밭
  float fb = fbm2(P.xz*0.9);
  vec3 dirt = mix(vec3(0.27,0.19,0.12), vec3(0.42,0.31,0.20), vnoise2(P.xz*3.));
  vec3 gr = mix(vec3(0.16,0.25,0.06), vec3(0.32,0.38,0.11), fb);
  gr = mix(gr, vec3(0.40,0.35,0.16), smoothstep(0.55,0.8,vnoise2(P.xz*2.1+5.))*0.6);
  alb += mix(dirt, gr, sGrass)*dirtW; tRough += 0.95*dirtW;
  tH += (vnoise2(P.xz*28.)*0.006*fade + fb*0.02) * dirtW;
}
float fresh = clamp(max(sDug*1.2, sLoose*10.), 0., 1.) * (1. - rockW*0.7);
if (fresh > 0.002) {
  vec3 fd = mix(vec3(0.23,0.15,0.09), vec3(0.34,0.24,0.15), vnoise2(P.xz*9.));
  float fdH = fbm2(P.xz*9.)*0.03 + vnoise2(P.xz*40.)*0.006*fade;
  alb = mix(alb, fd, fresh); tH = mix(tH, fdH, fresh);
}
alb = mix(alb, alb*vec3(0.7,0.85,0.6), smoothstep(0.3,0.0,abs(under))*rockW*0.6);
alb *= mix(1., 0.5, wet); tRough = mix(tRough, 0.2, wet*0.85);
alb = mix(alb, alb*vec3(0.78,0.92,0.88), smoothstep(0.,0.3,under));
float tCaus = 0.;
if (under > 0. && under < 3.) tCaus = caustic(P.xz, uTime) * smoothstep(0.,0.06,under) * exp(-under*1.6) * max(N.y,0.) * max(uSunDir.y,0.) * (1.-0.7*uRain);
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
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(X0, -10, 0), new THREE.Vector3(-X0, 40, NZ * CELL));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 30), 45);
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
  const XA = -150, XB = 150, ZA = -120, ZB = 180, S = 1;
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
