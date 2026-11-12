// 얕은 물 시뮬레이션(가상 파이프 + 마찰) · 침식 · 물 표면 렌더링
import * as THREE from 'three';
import { CELL, NX, NZ, NXV, NZV, NV, X0, Z0, SX0, SX1, SW, idx, U, ground, loose, cap, diag, centerX, baseY, markDirtyCell } from './terrain.js';
import { GLSL_NOISE, sstep } from './noise.js';
import { GLSL_SKY } from './sky.js';

const G = 9.81, CF = 0.045, A = CELL * CELL;
export const h = new Float32Array(NV), solid = new Float32Array(NV), sBot = new Float32Array(NV).fill(1e9);
// 돌무더기 공극(틈): seal=공극 바닥(땅/진흙), ptop=공극 꼭대기(돌 윗면). 그 사이로 물이 스며 흐른다
export const seal = new Float32Array(NV), ptop = new Float32Array(NV), lev = new Float32Array(NV);
export const PHI = 0.38; let KP = 0.25;
const ho = new Float32Array(NV), hp = new Float32Array(NV);
const pL = new Float32Array(NV), pR = new Float32Array(NV), pU = new Float32Array(NV), pD = new Float32Array(NV);
const fL = new Float32Array(NV), fR = new Float32Array(NV), fU = new Float32Array(NV), fD = new Float32Array(NV);
export const vx = new Float32Array(NV), vz = new Float32Array(NV), foam = new Float32Array(NV), wet = new Float32Array(NV);
export const sed = new Float32Array(NV); const sed2 = new Float32Array(NV);
const h0 = new Float32Array(NV);
export const MEAS_J = 262;
export const state = { inflow: 0.2, outflow: 0.2, outSm: 0.2, time: 0, stored: 0, maxDepth: 0, steps: 0, eroded: 0 };
const src = [];

export function init() {
  const zs = 5.2, cx = centerX(zs);
  for (let j = Math.round(zs / CELL) - 2; j <= Math.round(zs / CELL) + 2; j++)
    for (let i = SX0; i < SX1; i++) { const x = X0 + i * CELL; if (Math.abs(x - cx) < 0.7) src.push(idx(i, j)); }
  beginSolid();
}
export function beginSolid() {
  for (let j = 0; j < NZV; j++) {
    const b = idx(SX0, j), g = ground.subarray(b, b + SW);
    solid.set(g, b); seal.set(g, b); ptop.set(g, b); sBot.fill(1e9, b, b + SW);
  }
}

export function step(dt) {
  const kf = dt * G;
  // 수위: 공극이 차기 전엔 seal + h/φ, 다 차면 돌 위로 흐름
  for (let j = 0; j < NZV; j++) for (let i = SX0; i < SX1; i++) {
    const k = j * NXV + i, hk = h[k], cp = PHI * (ptop[k] - seal[k]);
    if (cp > 1e-4) {
      if (hk <= cp) { lev[k] = seal[k] + hk / PHI; ho[k] = 0; hp[k] = hk / PHI; }
      else { lev[k] = solid[k] + hk - cp; ho[k] = hk - cp; hp[k] = ptop[k] - seal[k]; }
    } else { lev[k] = solid[k] + hk; ho[k] = hk; hp[k] = 0; }
  }
  for (let j = 0; j < NZV; j++) {
    for (let i = SX0; i < SX1; i++) {
      const k = j * NXV + i, hk = h[k], H = lev[k], o = ho[k], q = hp[k];
      let l = 0, r = 0, u = 0, d = 0, a = 0, b = 0, c = 0, e = 0;
      if (i > SX0) { l = flux(fL[k], H, o, k - 1, kf, dt); if (q > 0 && H > lev[k - 1]) a = KP * q * (H - lev[k - 1]); }
      if (i < SX1 - 1) { r = flux(fR[k], H, o, k + 1, kf, dt); if (q > 0 && H > lev[k + 1]) b = KP * q * (H - lev[k + 1]); }
      if (j > 0) { u = flux(fU[k], H, o, k - NXV, kf, dt); if (q > 0 && H > lev[k - NXV]) c = KP * q * (H - lev[k - NXV]); }
      if (j < NZ) { d = flux(fD[k], H, o, k + NXV, kf, dt); if (q > 0 && H > lev[k + NXV]) e = KP * q * (H - lev[k + NXV]); }
      else { d = flux0(fD[k], o, o, kf, dt); e = KP * q * q; }
      const s = l + r + u + d + a + b + c + e;
      if (s > 0) { const K = Math.min(1, hk * A / (s * dt)); l *= K; r *= K; u *= K; d *= K; a *= K; b *= K; c *= K; e *= K; }
      fL[k] = l; fR[k] = r; fU[k] = u; fD[k] = d; pL[k] = a; pR[k] = b; pU[k] = c; pD[k] = e;
    }
  }
  let out = 0;
  for (let j = 0; j < NZV; j++) {
    for (let i = SX0; i < SX1; i++) {
      const k = j * NXV + i;
      const inL = i > SX0 ? fR[k - 1] : 0, inR = i < SX1 - 1 ? fL[k + 1] : 0;
      const inU = j > 0 ? fD[k - NXV] : 0, inD = j < NZ ? fU[k + NXV] : 0;
      const sin = (i > SX0 ? pR[k - 1] : 0) + (i < SX1 - 1 ? pL[k + 1] : 0) + (j > 0 ? pD[k - NXV] : 0) + (j < NZ ? pU[k + NXV] : 0);
      const ho0 = h[k];
      let hn = ho0 + dt * (inL + inR + inU + inD + sin - fL[k] - fR[k] - fU[k] - fD[k] - pL[k] - pR[k] - pU[k] - pD[k]) / A;
      if (hn < 0) hn = 0;
      h[k] = hn;
      const ha = Math.max(0, (ho0 + hn) * 0.5 - PHI * (ptop[k] - seal[k]));
      if (ha > 0.003) {
        let ux = (inL - fL[k] + fR[k] - inR) * 0.5 / (CELL * ha), uz = (inU - fU[k] + fD[k] - inD) * 0.5 / (CELL * ha);
        const sp = Math.hypot(ux, uz); if (sp > 5) { ux *= 5 / sp; uz *= 5 / sp; }
        vx[k] = ux; vz[k] = uz;
      } else { vx[k] = 0; vz[k] = 0; }
    }
    if (j === MEAS_J) for (let i = SX0; i < SX1; i++) { const k = j * NXV + i; out += fD[k] + pD[k] - fU[k + NXV] - pU[k + NXV]; }
  }
  const add = state.inflow * dt / (A * src.length);
  for (const k of src) h[k] += add;
  state.outflow = out;
  const a = Math.min(1, dt * 0.6); state.outSm += (out - state.outSm) * a;
  state.steps++; state.time += dt;
}
export function setPermeability(v) { KP = v; }
function flux(f0, H, o, n, kf, dt) {
  const dH = H - lev[n];
  return flux0(f0, dH > 0 ? o : ho[n], dH, kf, dt);
}
function flux0(f0, hf, dH, kf, dt) {
  if (hf <= 1e-5) return 0;
  let f = f0 + kf * hf * dH;
  f /= 1 + dt * (CF * Math.abs(f0) / (hf * hf * CELL) + 0.04);
  return f > 0 ? f : 0;
}

// 침식(부어 놓은 흙만) · 거품 · 젖음 — 프레임당 한 번
export function post(dt) {
  let mx = 0;
  for (let j = 1; j < NZ; j++) for (let i = SX0 + 1; i < SX1 - 1; i++) {
    const k = j * NXV + i, hk = ho[k];
    const sp = Math.hypot(vx[k], vz[k]);
    if (h[k] > 0.004) wet[k] = 1;
    if (hk > 0.004) {
      wet[k] = 1;
      const cp = 0.008 * Math.max(0, sp - 0.6) * Math.min(hk, 0.3) / 0.3;
      if (sed[k] < cp && (loose[k] > 0 || cap[k] > 0)) {
        let e = (cp - sed[k]) * 0.5 * dt;
        if (cap[k] > 0) { e = Math.min(cap[k], e); cap[k] -= e; solid[k] -= e; }
        else { e = Math.min(loose[k], e); loose[k] -= e; ground[k] -= e; }
        sed[k] += e; state.eroded += e * A;
        if (e > 2e-5) markDirtyCell(i, j);
      } else if (sed[k] > cp) {
        const dd = (sed[k] - cp) * 0.5 * dt;
        sed[k] -= dd; loose[k] += dd; ground[k] += dd; if (dd > 2e-5) markDirtyCell(i, j);
      }
      const dHx = lev[k + 1] - lev[k - 1], dHz = lev[k + NXV] - lev[k - NXV];
      const grad = Math.hypot(dHx, dHz) / (2 * CELL);
      const tgt = Math.min(1, sstep(0.9, 2.2, sp) + sstep(0.15, 0.6, grad) * sstep(0.3, 0.8, sp) * 0.7);
      foam[k] += (tgt - foam[k]) * Math.min(1, dt * (tgt > foam[k] ? 4 : 0.8));
      if (j < MEAS_J && hk > mx) mx = hk;
    } else {
      if (h[k] <= 0.004) wet[k] = Math.max(0, wet[k] - dt / 45);
      foam[k] *= 0.9;
      if (sed[k] > 0) { loose[k] += sed[k]; ground[k] += sed[k]; sed[k] = 0; markDirtyCell(i, j); }
    }
  }
  // 퇴적물 이류(반 라그랑지)
  sed2.set(sed);
  for (let j = 1; j < NZ; j++) for (let i = SX0 + 1; i < SX1 - 1; i++) {
    const k = j * NXV + i; if (h[k] <= 0.004) continue;
    const px = i - vx[k] * dt / CELL, pz = j - vz[k] * dt / CELL;
    const ii = Math.max(SX0, Math.min(SX1 - 2, px | 0)), jj = Math.max(0, Math.min(NZ - 1, pz | 0));
    const u = Math.min(1, Math.max(0, px - ii)), v = Math.min(1, Math.max(0, pz - jj)), b = jj * NXV + ii;
    sed2[k] = (sed[b] * (1 - u) + sed[b + 1] * u) * (1 - v) + (sed[b + NXV] * (1 - u) + sed[b + NXV + 1] * u) * v;
  }
  sed.set(sed2);
  let st = 0;
  for (let j = 0; j < MEAS_J; j++) for (let i = SX0; i < SX1; i++) { const k = j * NXV + i, dv = h[k] - h0[k]; if (dv > 0) st += dv; }
  state.stored = st * A;
  state.maxDepth = mx;
}
export function saveBaseline() { h0.set(h); }

// ───── 데이터 텍스처 ─────
const dW = new Float32Array(SW * NZV * 4), dV = new Float32Array(SW * NZV * 4);
export const texW = new THREE.DataTexture(dW, SW, NZV, THREE.RGBAFormat, THREE.FloatType);
export const texV = new THREE.DataTexture(dV, SW, NZV, THREE.RGBAFormat, THREE.FloatType);
for (const t of [texW, texV]) { t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
U.tWater.value = texW;

export function upload() {
  for (let j = 0; j < NZV; j++) for (let c = 0; c < SW; c++) {
    const k = j * NXV + SX0 + c, o = (j * SW + c) * 4, hk = h[k];
    let R, dep = 0;
    if (hk > 0.003) { R = lev[k]; dep = lev[k] - seal[k]; }
    else {
      let best = -1e9;
      if (c > 0 && h[k - 1] > 0.003) best = Math.max(best, lev[k - 1]);
      if (c < SW - 1 && h[k + 1] > 0.003) best = Math.max(best, lev[k + 1]);
      if (j > 0 && h[k - NXV] > 0.003) best = Math.max(best, lev[k - NXV]);
      if (j < NZ && h[k + NXV] > 0.003) best = Math.max(best, lev[k + NXV]);
      R = best > -1e8 ? Math.min(best, solid[k] + 0.03) - 0.006 : Math.min(solid[k], ground[k]) - 0.06;
    }
    dW[o] = R; dW[o + 1] = dep; dW[o + 2] = wet[k]; dW[o + 3] = foam[k];
    dV[o] = vx[k]; dV[o + 1] = vz[k]; dV[o + 2] = Math.min(1, sed[k] / (hk + 0.02) * 25); dV[o + 3] = 0;
  }
  texW.needsUpdate = true; texV.needsUpdate = true;
}

// 위치에서 수면/속도 조회 (게임플레이용)
export function sample(x, z) {
  const i = Math.round((x - X0) / CELL), j = Math.round((z - Z0) / CELL);
  if (i < SX0 || i >= SX1 || j < 0 || j > NZ) return null;
  const k = idx(i, j);
  return { h: h[k], open: ho[k], surf: lev[k], solid: solid[k], vx: vx[k], vz: vz[k], k };
}

// ───── 잔물결 노멀맵 (타일링) ─────
function makeNormalTex() {
  const S = 256, data = new Uint8Array(S * S * 4), hgt = new Float32Array(S * S), fo = new Float32Array(S * S);
  const waves = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 48; n++) {
    let kx, ky; do { kx = Math.round((rnd() * 2 - 1) * 14); ky = Math.round((rnd() * 2 - 1) * 14); } while (kx === 0 && ky === 0);
    const km = Math.hypot(kx, ky); waves.push([kx, ky, 1 / Math.pow(km, 1.4), rnd() * 6.283]);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0, f = 0;
    for (const [kx, ky, a, p] of waves) { const t = 6.283 * (kx * x + ky * y) / S + p; v += a * Math.sin(t); f += a * Math.sin(t * 1.0 + p * 3.0) * (kx % 3 === 0 ? 1 : 0.3); }
    hgt[y * S + x] = v; fo[y * S + x] = f;
  }
  let fmin = 1e9, fmax = -1e9; for (const v of fo) { fmin = Math.min(fmin, v); fmax = Math.max(fmax, v); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const L = hgt[y * S + ((x + S - 1) % S)], R = hgt[y * S + ((x + 1) % S)], D = hgt[((y + S - 1) % S) * S + x], T = hgt[((y + 1) % S) * S + x];
    let nx = (L - R) * 0.9, ny = (D - T) * 0.9; const il = 1 / Math.hypot(nx, ny, 1);
    const o = (y * S + x) * 4;
    data[o] = (nx * il * 0.5 + 0.5) * 255; data[o + 1] = (ny * il * 0.5 + 0.5) * 255; data[o + 2] = il * 255;
    data[o + 3] = (fo[y * S + x] - fmin) / (fmax - fmin) * 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export function makeWaterMesh(refrRT) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(SW * NZV * 3);
  for (let j = 0; j < NZV; j++) for (let c = 0; c < SW; c++) { const o = (j * SW + c) * 3; pos[o] = X0 + (SX0 + c) * CELL; pos[o + 2] = Z0 + j * CELL; }
  const ind = new Uint32Array((SW - 1) * NZ * 6); let p = 0;
  for (let j = 0; j < NZ; j++) for (let c = 0; c < SW - 1; c++) {
    const a = j * SW + c, b = a + 1, cc = a + SW, d = cc + 1;
    // 지형 메시와 같은 대각선 방향(물가 톱니 방지)
    if (diag[j * NX + SX0 + c]) { ind[p++] = a; ind[p++] = cc; ind[p++] = b; ind[p++] = b; ind[p++] = cc; ind[p++] = d; }
    else { ind[p++] = a; ind[p++] = cc; ind[p++] = d; ind[p++] = a; ind[p++] = d; ind[p++] = b; }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(ind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 30), 45);
  const uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), U, {
    tV: { value: texV }, tN: { value: makeNormalTex() }, tRefr: { value: refrRT.texture }, tDepth: { value: refrRT.depthTexture },
    uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.05 }, uFar: { value: 1200 }, uCheap: { value: 0 },
  });
  const mat = new THREE.ShaderMaterial({ uniforms, fog: true, vertexShader: WATER_VS, fragmentShader: WATER_FS });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

const WATER_VS = /* glsl */`
uniform sampler2D tWater; uniform vec4 uWInfo; uniform vec2 uWSize;
varying vec3 vWorld; varying vec2 vUv;
#include <fog_pars_vertex>
void main(){
  vec2 c = (position.xz - uWInfo.xy) * uWInfo.z; vUv = (c + .5) / uWSize;
  vec4 w = texture2D(tWater, vUv);
  vec3 p = vec3(position.x, w.r, position.z);
  vWorld = p;
  vec4 mvPosition = viewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FS = GLSL_NOISE + GLSL_SKY + /* glsl */`
uniform sampler2D tV, tN, tRefr, tDepth; uniform vec2 uRes; uniform float uTime, uNear, uFar, uCheap; uniform vec3 uSunCol;
varying vec3 vWorld; varying vec2 vUv;
#include <fog_pars_fragment>
float linZ(float d){ return uNear*uFar / (uFar - d*(uFar-uNear)); }
void main(){
  vec4 w = texture2D(tWater, vUv); vec4 v = texture2D(tV, vUv);
  float depth = w.g;
  vec2 tx = 1.0 / uWSize;
  float hL = texture2D(tWater, vUv - vec2(tx.x,0.)).r, hR = texture2D(tWater, vUv + vec2(tx.x,0.)).r;
  float hD = texture2D(tWater, vUv - vec2(0.,tx.y)).r, hU = texture2D(tWater, vUv + vec2(0.,tx.y)).r;
  vec3 n = normalize(vec3((hL-hR)/(2.*0.2), 1.0, (hD-hU)/(2.*0.2)));
  vec2 flow = v.xy; float sp = length(flow);
  float t = uTime*0.55; float p0 = fract(t), p1 = fract(t+0.5); float wb = abs(p0*2.-1.);
  vec2 bx = vWorld.xz*0.42;
  vec2 uvA = bx - flow*p0*0.55, uvB = bx - flow*p1*0.55 + vec2(0.37,0.71);
  vec4 nA = texture2D(tN, uvA), nB = texture2D(tN, uvB);
  vec4 nC = texture2D(tN, vWorld.xz*1.3 - flow*p0*1.6 + 0.5), nD = texture2D(tN, vWorld.xz*1.3 - flow*p1*1.6 + 0.2);
  vec2 dn = mix(nA.xy, nB.xy, wb)*2.-1.; vec2 dn2 = mix(nC.xy, nD.xy, wb)*2.-1.;
  vec4 nS = texture2D(tN, vWorld.xz*0.9 + vec2(uTime*0.03, uTime*0.021));
  dn += (nS.xy*2.-1.)*0.5 + dn2*(0.25+sp*0.6);
  float rainR = uRain * smoothstep(0.75,0.95, vnoise2(vWorld.xz*9. + floor(uTime*6.)*7.3));
  float str = (0.10 + sp*0.32) * smoothstep(0.,0.03,depth) + rainR*0.4;
  n = normalize(n + vec3(dn.x, 0., dn.y)*str);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n,V), 0.);
  float fres = 0.02 + 0.98*pow(1.-ndv, 5.);
  vec3 Rv = reflect(-V, n); Rv.y = abs(Rv.y);
  vec3 wallC = mix(vec3(0.06,0.08,0.05), vec3(0.15,0.17,0.16), uRain);
  vec3 refl = mix(wallC, skyCol(Rv), smoothstep(0.08, 0.5, Rv.y));
  float sdot = max(dot(Rv, uSunDir), 0.);
  vec3 spec = uSunCol * (pow(sdot, 900.)*28. + pow(sdot, 90.)*1.3) * (1.-uRain*0.9);
  float mud = v.z;
  vec3 absC = mix(vec3(1.9, 0.75, 0.62), vec3(1.4, 1.7, 2.6), mud);
  vec3 scat = mix(vec3(0.020, 0.085, 0.075), vec3(0.16, 0.11, 0.06), mud) * (0.45 + 0.55*max(uSunDir.y,0.)) * (1.-uRain*0.4);
  vec3 refr = vec3(0.); float thick, alpha = 1.;
  if (uCheap < 0.5) {
    vec2 suv = gl_FragCoord.xy / uRes;
    float myZ = linZ(gl_FragCoord.z);
    vec2 off = n.xz * 0.05 * clamp(depth*5., 0., 1.) / max(myZ*0.15, 1.);
    float sZ = linZ(texture2D(tDepth, suv + off).r);
    if (sZ < myZ) { off = vec2(0.); sZ = linZ(texture2D(tDepth, suv).r); }
    refr = texture2D(tRefr, suv + off).rgb;
    thick = clamp(sZ - myZ, 0., 6.);
  } else thick = depth / max(ndv, 0.2);
  vec3 ab = exp(-thick * absC);
  vec3 col = uCheap < 0.5 ? refr*ab + scat*(1.-ab) : scat;
  if (uCheap > 0.5) alpha = 1. - dot(ab, vec3(0.3333));
  col = mix(col, refl, fres) + spec*smoothstep(0.,0.01,depth);
  alpha = max(alpha, fres*0.9);
  float vis = smoothstep(0.004, 0.03, depth); // 아주 얇은 물막은 보이지 않게
  if (uCheap < 0.5) col = mix(refr, col, vis); else alpha *= vis;
  float fo = w.a;
  float fnz = mix(nA.w, nB.w, wb)*0.6 + nC.w*0.4;
  float foamA = smoothstep(0.5, 0.85, fo*0.6 + fnz*0.7 - 0.2) * smoothstep(0.,0.02,depth);
  float edge = smoothstep(0.05, 0.015, depth) * smoothstep(0.5, 0.75, fnz) * step(0.012, depth) * 0.45;
  foamA = max(foamA, edge);
  vec3 foamC = vec3(0.92,0.95,0.96) * (0.35 + 0.65*max(uSunDir.y,0.)) * uSunCol;
  col = mix(col, foamC, foamA*0.9);
  gl_FragColor = vec4(col, max(alpha, foamA*0.9));
  #include <fog_fragment>
}`;

// 웅덩이를 미리 채워(우선순위 범람) 시작 안정화 시간을 줄인다
export function prefill() {
  const lev = new Float32Array(NV).fill(Infinity), heap = [];
  const push = (v, k) => { heap.push([v, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  for (let i = SX0; i < SX1; i++) { const k = idx(i, NZ); lev[k] = solid[k]; push(lev[k], k); }
  while (heap.length) {
    const [v, k] = pop(); const i = k % NXV, j = (k / NXV) | 0;
    for (const [n, ok] of [[k - 1, i > SX0], [k + 1, i < SX1 - 1], [k - NXV, j > 0], [k + NXV, j < NZ]]) {
      if (!ok || lev[n] !== Infinity) continue;
      lev[n] = Math.max(solid[n], v); push(lev[n], n);
    }
  }
  for (let j = 0; j <= NZ; j++) {
    const z = Z0 + j * CELL, cx = centerX(z);
    for (let i = SX0; i < SX1; i++) {
      const k = idx(i, j); let d = lev[k] - solid[k];
      if (Math.abs(X0 + i * CELL - cx) < 0.6 && z > 4.5) d = Math.max(d, 0.17 - Math.max(0, solid[k] - (baseY(z) - 0.42)));
      h[k] = d > 1.5 ? 0 : d;
    }
  }
}
