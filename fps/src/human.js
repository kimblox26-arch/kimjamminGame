// 사실적 인물 생성기 — SDF 조각으로 옷 입은 몸/얼굴/장갑/부츠를 만들고 뼈대에 스키닝.
// 머리카락(바람에 흔들리는 카드), 수염(셸), 눈, 플레이트캐리어·헬멧·헤드셋 등 장비 포함.
import * as THREE from 'three';
import { handBoneSpec, buildGloveLocal, toRest } from './hand.js';
import { SDFModel, ellipsoid, sphere, cone, rbox, torus, plane, buildGeometry, smoothMesh, mergeParts } from './sdf.js';
import { T } from './textures.js';
import { patchInterior } from './world.js';

// ── 3D 값 노이즈 (주름/변위용) ──
const H = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
export function n3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(H(xi, yi, zi), H(xi + 1, yi, zi), u), l(H(xi, yi + 1, zi), H(xi + 1, yi + 1, zi), u), v), l(l(H(xi, yi, zi + 1), H(xi + 1, yi, zi + 1), u), l(H(xi, yi + 1, zi + 1), H(xi + 1, yi + 1, zi + 1), u), v), w);
}

// ── 바람 (전역 균일값) ──
export const WIND = { dir: { value: new THREE.Vector3(1, 0, 0.3).normalize() }, strength: { value: 1.0 }, time: { value: 0 } };

// ── 삼면투영 재질 (UV 없는 SDF 메쉬용, 스키닝 시 바인드 포즈 좌표 사용) ──
export function triMaterial({ color = 0xffffff, map = null, nmap = null, scale = 8, ns = 1, rough = 0.9, metal = 0, vcol = false, side = THREE.FrontSide, env = 1, sheen = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, vertexColors: vcol, side, envMapIntensity: env });
  const uni = { uTriMap: { value: map || T.soft.map }, uTriNor: { value: nmap }, uTriS: { value: scale }, uTriNS: { value: ns }, uHasMap: { value: map ? 1 : 0 }, uSheen: { value: sheen } };
  m.userData.tri = uni;
  const interior = patchInterior(new THREE.MeshStandardMaterial()).onBeforeCompile;
  m.onBeforeCompile = (s) => {
    interior(s);
    Object.assign(s.uniforms, uni);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTriPos; varying vec3 vTriN; varying mat3 vO2V; uniform float uTriS;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vTriPos = position * uTriS; vTriN = normal;
        #ifdef USE_SKINNING
          vO2V = normalMatrix * mat3(skinMatrix);
        #else
          vO2V = normalMatrix;
        #endif`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vTriPos; varying vec3 vTriN; varying mat3 vO2V; uniform sampler2D uTriMap; uniform sampler2D uTriNor; uniform float uTriNS; uniform float uHasMap; uniform float uSheen;
        vec3 triW(){ vec3 b = pow(abs(normalize(vTriN)), vec3(4.)); return b / (b.x + b.y + b.z); }
        vec4 tri(sampler2D t, vec3 w){ return texture2D(t, vTriPos.zy) * w.x + texture2D(t, vTriPos.xz) * w.y + texture2D(t, vTriPos.xy) * w.z; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 tw = triW();
        if (uHasMap > 0.5) diffuseColor.rgb *= tri(uTriMap, tw).rgb;`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 n0 = normalize(vTriN);
          vec3 tx = texture2D(uTriNor, vTriPos.zy).xyz * 2. - 1.; vec3 ty = texture2D(uTriNor, vTriPos.xz).xyz * 2. - 1.; vec3 tz = texture2D(uTriNor, vTriPos.xy).xyz * 2. - 1.;
          tx.xy *= uTriNS; ty.xy *= uTriNS; tz.xy *= uTriNS;
          tx = vec3(tx.xy + n0.zy, abs(tx.z) * n0.x); ty = vec3(ty.xy + n0.xz, abs(ty.z) * n0.y); tz = vec3(tz.xy + n0.xy, abs(tz.z) * n0.z);
          vec3 on = normalize(tx.zyx * tw.x + ty.xzy * tw.y + tz.xyz * tw.z);
          normal = normalize(vO2V * on) * faceDirection;
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * mix(1.0, tri(uTriNor, tw).a * 0. + 1.0, 0.);`)
      .replace('#include <opaque_fragment>', `outgoingLight += uSheen * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0) * diffuseColor.rgb * 0.35;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'tri' + (nmap ? 1 : 0) + (vcol ? 1 : 0);
  if (!nmap) uni.uTriNor.value = T.clothN.normalMap, uni.uTriNS.value = 0;
  return m;
}

// ── 뼈대 정의 ──
function skeletonSpec() {
  const B = [];
  const add = (name, parent, p) => { B.push({ name, parent: parent == null ? -1 : B.findIndex((b) => b.name === parent), p: new THREE.Vector3(...p) }); };
  add('root', null, [0, 0, 0]);
  add('hips', 'root', [0, 0.97, 0]);
  add('spine', 'hips', [0, 1.08, 0]);
  add('chest', 'spine', [0, 1.26, 0]);
  add('neck', 'chest', [0, 1.465, 0.005]);
  add('head', 'neck', [0, 1.575, 0.01]);
  const A = 0.7071;
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const d = [s * A, -A, 0];
    const sh = [s * 0.175, 1.415, -0.005], el = [sh[0] + d[0] * 0.295, sh[1] + d[1] * 0.295, sh[2]], wr = [el[0] + d[0] * 0.255, el[1] + d[1] * 0.255, el[2]];
    add('clav' + k, 'chest', [s * 0.025, 1.43, 0.02]);
    add('uarm' + k, 'clav' + k, sh);
    add('farm' + k, 'uarm' + k, el);
    add('hand' + k, 'farm' + k, wr);
    // 손가락 3마디 + 엄지 3마디 (hand.js 공용 정의, 손 로컬 x=d, y=n(손바닥), z=w(엄지쪽))
    const n = [-s * A, -A, 0];
    for (const hb of handBoneSpec()) { const q = hb.p; add(hb.name + k, hb.parent + k, [wr[0] + d[0] * q.x + n[0] * q.y, wr[1] + d[1] * q.x + n[1] * q.y, wr[2] + d[2] * q.x + n[2] * q.y + q.z]); }
  }
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    add('thigh' + k, 'hips', [s * 0.093, 0.93, 0]);
    add('shin' + k, 'thigh' + k, [s * 0.1, 0.5, 0.012]);
    add('foot' + k, 'shin' + k, [s * 0.104, 0.085, -0.012]);
    add('toe' + k, 'foot' + k, [s * 0.108, 0.02, 0.115]);
  }
  return B;
}
export const SKEL = skeletonSpec();
export const BI = Object.fromEntries(SKEL.map((b, i) => [b.name, i]));
const P = (n) => SKEL[BI[n]].p.toArray();

// 천 주름 변위: 관절 근처의 고리형 주름 + 불규칙
function folds(amp, lambda, jointT, width, noiseAmp = 0.002) {
  return (t, qx, qy, qz, x, y, z) => {
    const m = Math.exp(-(((t - jointT) / width) ** 2));
    const nz = n3(x * 30, y * 30, z * 30);
    return -amp * m * Math.sin(t * 6.283 / lambda + nz * 4 + Math.atan2(qz, qx) * 0.6) + (n3(x * 60 + 5, y * 60, z * 60) - 0.5) * noiseAmp;
  };
}

// ════════ 몸통 (옷 입은 상태) ════════
let BODY_GEO = null;
function buildBody() {
  if (BODY_GEO) return BODY_GEO;
  const S = new SDFModel([-0.68, -0.01, -0.21], [0.68, 1.56, 0.27], 0.0125);
  const b = BI;
  // 골반/엉덩이/배/가슴
  S.add(ellipsoid([0, 0.945, -0.005], [0.158, 0.12, 0.112], { bone: b.hips, mat: 'pants', k: 0.03 }));
  for (const s of [1, -1]) S.add(ellipsoid([s * 0.072, 0.9, -0.048], [0.082, 0.098, 0.074], { bone: b.hips, mat: 'pants', k: 0.03, w: 0.8 }));
  S.add(ellipsoid([0, 1.075, 0.012], [0.142, 0.12, 0.108], { bone: b.spine, mat: 'shirt', k: 0.05 }));
  S.add(ellipsoid([0, 1.255, 0.0], [0.172, 0.15, 0.113], { bone: b.chest, mat: 'shirt', k: 0.05 }));
  S.add(ellipsoid([0, 1.37, -0.008], [0.165, 0.075, 0.096], { bone: b.chest, mat: 'shirt', k: 0.04 }));
  S.add(cone([0, 1.4, -0.005], [0, 1.515, 0.01], 0.064, 0.058, { bone: b.neck, mat: 'shirt', k: 0.03 }));
  S.add(torus([0, 1.47, 0.008], 0.062, 0.012, { bone: b.neck, mat: 'shirt', k: 0.01, rot: [0.15, 0, 0] }));
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    S.add(cone([s * 0.04, 1.44, -0.02], [s * 0.165, 1.43, -0.012], 0.05, 0.048, { bone: b['clav' + k], mat: 'shirt', k: 0.04 }));
    S.add(ellipsoid([s * 0.185, 1.395, -0.004], [0.06, 0.068, 0.062], { bone: [b['clav' + k], b['uarm' + k]], seg: [[s * 0.15, 1.44, 0], [s * 0.2, 1.35, 0]], mat: 'shirt', k: 0.035 }));
    // 팔 (소매) — 팔꿈치 주름
    const sh = P('uarm' + k), el = P('farm' + k), wr = P('hand' + k);
    S.add(cone(sh, el, 0.058, 0.047, { bone: [b['uarm' + k], b['farm' + k]], blend: [0.78, 1.02], mat: 'shirt', k: 0.02, disp: folds(0.004, 0.18, 0.92, 0.18), dispMax: 0.006 }));
    S.add(cone(el, wr, 0.047, 0.038, { bone: [b['farm' + k], b['hand' + k]], blend: [0.9, 1.05], mat: 'shirt', k: 0.02, disp: folds(0.004, 0.16, 0.08, 0.2), dispMax: 0.006 }));
    S.add(torus([wr[0] - 0.012 * s * 0.707, wr[1] + 0.012 * 0.707, wr[2]], 0.037, 0.008, { bone: b['farm' + k], mat: 'shirt', k: 0.01, rot: [0, 0, s * 0.785] }));
    // 다리 (바지) — 무릎/발목 주름, 카고 주머니
    const hp = P('thigh' + k), kn = P('shin' + k), an = P('foot' + k);
    S.add(cone([hp[0], hp[1] + 0.02, hp[2] - 0.005], kn, 0.09, 0.061, { bone: [b['thigh' + k], b['shin' + k]], blend: [0.8, 1.05], mat: 'pants', k: 0.03, disp: folds(0.0045, 0.2, 0.9, 0.18), dispMax: 0.006 }));
    S.add(cone(kn, [an[0], an[1] + 0.12, an[2]], 0.059, 0.052, { bone: [b['shin' + k], b['foot' + k]], blend: [0.95, 1.1], mat: 'pants', k: 0.02, disp: folds(0.005, 0.12, 0.95, 0.25), dispMax: 0.007 }));
    S.add(rbox([s * 0.168, 0.66, 0.005], [0.022, 0.075, 0.06], 0.018, { bone: b['thigh' + k], mat: 'pants', k: 0.015, rot: [0, 0, s * 0.06] }));
    S.add(rbox([s * 0.172, 0.735, 0.005], [0.024, 0.012, 0.064], 0.01, { bone: b['thigh' + k], mat: 'pants', k: 0.006, rot: [0, 0, s * 0.06] }));
    // 전투화
    S.add(cone([an[0], an[1] + 0.02, an[2]], [an[0], an[1] + 0.13, an[2] + 0.004], 0.05, 0.054, { bone: b['foot' + k], mat: 'boot', k: 0.02, sigma: 0.015 }));
    S.add(ellipsoid([s * 0.106, 0.052, 0.045], [0.05, 0.048, 0.12], { bone: b['foot' + k], mat: 'boot', k: 0.03 }));
    S.add(ellipsoid([s * 0.108, 0.04, 0.14], [0.046, 0.036, 0.05], { bone: b['toe' + k], mat: 'boot', k: 0.03 }));
    S.add(ellipsoid([s * 0.104, 0.05, -0.05], [0.044, 0.045, 0.046], { bone: b['foot' + k], mat: 'boot', k: 0.02 }));
    S.add(rbox([s * 0.105, 0.013, -0.01], [0.052, 0.013, 0.085], 0.008, { bone: b['foot' + k], mat: 'sole', k: 0.004 }));
    S.add(rbox([s * 0.107, 0.013, 0.13], [0.05, 0.013, 0.055], 0.012, { bone: b['toe' + k], mat: 'sole', k: 0.004 }));
    S.add(torus([an[0], an[1] + 0.13, an[2] + 0.004], 0.052, 0.009, { bone: b['shin' + k], mat: 'pants', k: 0.012 }));
  }
  S.bake();
  const m = smoothMesh(S.mesh(), 1, 0.4);
  const cls = S.classify(m, SKEL, 0.018);
  const g = buildGeometry(m, cls, ['shirt', 'pants', 'boot', 'sole'], (x, y, z, mat, out) => {
    // 먼지/얼룩: 바지 아래쪽, 무릎, 팔꿈치
    const dirt = mat === 'pants' ? Math.max(0, 0.45 - y) * 0.9 + n3(x * 8, y * 8, z * 8) * 0.12 : n3(x * 8, y * 8, z * 8) * 0.08;
    const k = 1 - dirt * 0.5;
    out[0] = k; out[1] = k * 0.98; out[2] = k * 0.95;
  });
  BODY_GEO = g;
  return g;
}

// ════════ 장갑 낀 손 ════════
let HAND_GEO = null;
function buildHands() {
  if (HAND_GEO) return HAND_GEO;
  const parts = [];
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const wr = new THREE.Vector3(...P('hand' + k)), d = new THREE.Vector3(s * 0.7071, -0.7071, 0), n = new THREE.Vector3(-s * 0.7071, -0.7071, 0), w = new THREE.Vector3(0, 0, 1);
    const { m, S } = buildGloveLocal({ h: 0.0024, detail: false, bi: (nm) => BI[nm + k] });
    const cls = S.classify(m, SKEL, 0.007);
    toRest(m, wr, d, n, w);
    parts.push({ m, cls });
  }
  const { m, cls } = mergeParts(parts);
  HAND_GEO = buildGeometry(m, cls, ['glove', 'palm', 'pad', 'pad2', 'cuff', 'cuff2'], null);
  return HAND_GEO;
}

// ════════ 머리/얼굴 ════════
// v: {jaw, nose, brow, cheek, female, skin:[r,g,b], lips, stubble, scar}
function buildHead(v, h = 0.0032) {
  const C = [0, 1.667, 0.012];
  const at = (x, y, z) => [C[0] + x, C[1] + y, C[2] + z];
  const S = new SDFModel(at(-0.1, -0.22, -0.12), at(0.1, 0.13, 0.135), h);
  const f = v.female ? 0.94 : 1, jw = v.jaw ?? 1, nl = v.nose ?? 1;
  // 두개골/얼굴 기본형
  S.add(ellipsoid(at(0, 0.02, -0.012), [0.074 * f, 0.093 * f, 0.1 * f], { mat: 'skin', k: 0.02 }));
  S.add(ellipsoid(at(0, -0.008, 0.028), [0.066 * f, 0.082 * f, 0.074 * f], { mat: 'skin', k: 0.03 }));
  // 이마/눈썹뼈/미간
  S.add(ellipsoid(at(0, 0.045, 0.06), [0.058 * f, 0.04, 0.035], { mat: 'skin', k: 0.02 }));
  S.add(cone(at(-0.042 * f, 0.021, 0.085), at(0.042 * f, 0.021, 0.085), 0.0105 * (v.brow ?? 1), 0.0105 * (v.brow ?? 1), { mat: 'skin', k: 0.018 }));
  S.add(ellipsoid(at(0, 0.017, 0.093), [0.012, 0.009, 0.006], { mat: 'skin', k: 0.01 }));
  for (const s of [1, -1]) {
    // 광대/볼/턱선
    S.add(ellipsoid(at(s * 0.046 * f, -0.013, 0.066), [0.022, 0.016, 0.02], { mat: 'skin', k: 0.02 }));
    S.add(ellipsoid(at(s * 0.041 * jw * f, -0.05, 0.05), [0.026, 0.029, 0.03], { mat: 'skin', k: 0.025 }));
    S.add(cone(at(s * 0.058 * jw * f, -0.036, -0.012), at(s * 0.022 * jw, -0.1 * f, 0.066), 0.018 * jw, 0.015, { mat: 'skin', k: 0.02 }));
    // 귀
    S.add(ellipsoid(at(s * 0.076 * f, 0.0, -0.008), [0.011, 0.03, 0.019], { mat: 'skin', k: 0.006, rot: [0.15, s * 0.3, s * 0.15] }));
    S.add(torus(at(s * 0.082 * f, 0.004, -0.008), 0.018, 0.0045, { mat: 'skin', k: 0.004, rot: [0, 0, Math.PI / 2 + s * 0.15] }));
    S.sub(ellipsoid(at(s * 0.087 * f, -0.002, -0.004), [0.005, 0.013, 0.01], { k: 0.004 }));
    // 눈구멍 → 눈꺼풀 구 → 눈매 틈 → 쌍꺼풀 주름/아래눈꺼풀
    const ex = s * 0.031 * f;
    S.sub(ellipsoid(at(ex, 0.003, 0.092), [0.017, 0.012, 0.015], { k: 0.012 }));
    S.add(sphere(at(ex, 0.003, 0.0795), 0.0137, { mat: 'lid', k: 0.003 }));
    S.sub(ellipsoid(at(ex, 0.0022, 0.0945), [0.0126, 0.0044, 0.012], { k: 0.002, rot: [0, 0, s * -0.1] }));
    S.add(ellipsoid(at(ex, 0.0098, 0.0888), [0.0145, 0.0035, 0.006], { mat: 'lid', k: 0.004, rot: [0, 0, s * -0.08] }));
    S.add(ellipsoid(at(ex, -0.0048, 0.0895), [0.0125, 0.0028, 0.0055], { mat: 'lid', k: 0.003 }));
    // 팔자주름 (얕게)
    S.sub(ellipsoid(at(s * 0.023, -0.041, 0.101), [0.0025, 0.013, 0.005], { k: 0.004, rot: [0, 0, s * 0.35] }));
    S.sub(sphere(at(s * 0.0215, -0.057, 0.095), 0.0028, { k: 0.003 }));
  }
  // 코 (콧대 → 코끝 → 콧방울 → 콧구멍)
  S.add(cone(at(0, 0.014, 0.093), at(0, -0.024 * nl, 0.117 + 0.003 * nl), 0.0072, 0.0105, { mat: 'skin', k: 0.011 }));
  S.add(ellipsoid(at(0, -0.01, 0.101), [0.012, 0.019, 0.011], { mat: 'skin', k: 0.012 }));
  S.add(sphere(at(0, -0.027 * nl, 0.1165 + 0.003 * nl), 0.0122, { mat: 'skin', k: 0.008 }));
  for (const s of [1, -1]) {
    S.add(ellipsoid(at(s * 0.0135, -0.033 * nl, 0.104), [0.0088, 0.0072, 0.009], { mat: 'skin', k: 0.006 }));
    S.sub(ellipsoid(at(s * 0.0068, -0.0395 * nl, 0.108), [0.0036, 0.0024, 0.0046], { k: 0.002 }));
  }
  // 입/입술/인중/턱
  S.add(ellipsoid(at(0, -0.052, 0.086), [0.031, 0.028, 0.022], { mat: 'skin', k: 0.02 }));
  S.add(ellipsoid(at(0, -0.046, 0.097), [0.016, 0.009, 0.01], { mat: 'skin', k: 0.01 }));
  S.add(ellipsoid(at(0, -0.0515, 0.1005), [0.019 * (v.lips ?? 1), 0.0046, 0.0078], { mat: 'lip', k: 0.004 }));
  S.add(ellipsoid(at(0, -0.0612, 0.0978), [0.0175 * (v.lips ?? 1), 0.0058, 0.0082], { mat: 'lip', k: 0.004 }));
  S.sub(ellipsoid(at(0, -0.0563, 0.1075), [0.0195, 0.0011, 0.009], { k: 0.0018 }));
  S.sub(ellipsoid(at(0, -0.0425, 0.106), [0.0032, 0.0038, 0.0022], { k: 0.002 }));
  S.add(ellipsoid(at(0, -0.1 * f, 0.075), [0.021 * jw, 0.019, 0.017], { mat: 'skin', k: 0.02 }));
  // 목
  S.add(cone(at(0, -0.06, -0.022), at(0, -0.2, -0.03), 0.052 * f, 0.056 * f, { mat: 'skin', k: 0.03 }));
  S.add(ellipsoid(at(0, -0.1, 0.012), [0.03, 0.035, 0.03], { mat: 'skin', k: 0.03 }));
  S.bake();
  const m = smoothMesh(S.mesh(), 1, 0.3);
  const cls = S.classify(m, null);
  const sk = v.skin || [0.78, 0.58, 0.46];
  const g = buildGeometry(m, cls, ['skin', 'lip', 'lid'], (x, y, z, mat, out) => {
    const lx = x - C[0], ly = y - C[1], lz = z - C[2];
    let r = sk[0], gg = sk[1], bb = sk[2];
    // 볼/코 홍조, 눈 주변 그늘, 수염 자국
    const cheek = Math.exp(-(((Math.abs(lx) - 0.04) / 0.022) ** 2 + ((ly + 0.02) / 0.025) ** 2)) * (lz > 0.03 ? 1 : 0);
    const nose = Math.exp(-((lx / 0.015) ** 2 + ((ly + 0.028) / 0.015) ** 2)) * (lz > 0.09 ? 1 : 0);
    r += (cheek * 0.08 + nose * 0.07); gg -= (cheek * 0.02 + nose * 0.02); bb -= cheek * 0.02;
    const eye = Math.exp(-(((Math.abs(lx) - 0.031) / 0.018) ** 2 + ((ly - 0.0) / 0.012) ** 2));
    r -= eye * 0.08; gg -= eye * 0.08; bb -= eye * 0.05;
    if (mat === 'lip') { r = sk[0] * 0.88 + 0.05; gg = sk[1] * 0.74; bb = sk[2] * 0.76; }
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const beardZone = sm(-0.018, -0.034, ly) * sm(-0.035, -0.005, lz) * sm(0.075, 0.06, Math.abs(lx)) * sm(-0.135, -0.12, ly) * (1 - sm(0.045, 0.02, Math.abs(lx)) * sm(-0.03, -0.02, ly));
    // 눈썹 (정점색)
    const bx = Math.abs(lx) / f, byc = 0.0215 + Math.sin(Math.min(1, Math.max(0, (bx - 0.012) / 0.034)) * Math.PI) * 0.0035 - (bx - 0.012) * 0.05;
    const brow = sm(0.009, 0.014, bx) * sm(0.05, 0.042, bx) * sm(0.0055 * (v.female ? 0.75 : 1), 0.002, Math.abs(ly - byc)) * (lz > 0.07 ? 1 : 0) * (0.6 + n3(x * 700, y * 1400, z * 700) * 0.5);
    const hc = v.browColor || [0.12, 0.09, 0.07];
    r = r * (1 - brow) + hc[0] * brow; gg = gg * (1 - brow) + hc[1] * brow; bb = bb * (1 - brow) + hc[2] * brow;
    if (v.hair && v.hair !== 'none') {
      const hr = Math.hypot(lx / 0.074, (ly - 0.02) / 0.093, (lz + 0.012) / 0.1);
      const front = lz > 0.03 ? 0.058 - (lz - 0.03) * 0.0 : lz > -0.02 ? 0.02 : -0.045;
      const scalp = sm(front - 0.008, front + 0.004, ly + (Math.abs(lx) < 0.07 && Math.abs(lx) > 0.06 ? 0.02 : 0)) * sm(1.12, 1.02, hr) * (Math.abs(lx) > 0.068 && ly < 0.01 && lz > -0.03 ? 0 : 1);
      const hcol = v.hairRGB || hc;
      const k = scalp * (v.hair === 'buzz' ? 0.55 : 0.9) * (0.75 + n3(x * 900, y * 900, z * 900) * 0.35);
      r = r * (1 - k) + hcol[0] * k; gg = gg * (1 - k) + hcol[1] * k; bb = bb * (1 - k) + hcol[2] * k;
    }
    const st = (v.stubble || 0) * beardZone * (0.6 + n3(x * 900, y * 900, z * 900) * 0.4) * (mat === 'lip' ? 0 : 1);
    r *= 1 - st * 0.45; gg *= 1 - st * 0.48; bb *= 1 - st * 0.45;
    // 흉터
    if (v.scar) { const sx = lx - v.scar[0], sy = ly - v.scar[1]; const dd = Math.abs(sx * 0.5 + sy) / 1.1; if (dd < 0.0025 && Math.abs(sx) < 0.022 && lz > 0.03 && Math.sign(lx) === Math.sign(v.scar[0])) { r = r * 0.95 + 0.05; gg *= 0.82; bb *= 0.84; } }
    const sp = (n3(x * 200, y * 200, z * 200) - 0.5) * 0.05;
    out[0] = Math.max(0, r + sp); out[1] = Math.max(0, gg + sp * 0.8); out[2] = Math.max(0, bb + sp * 0.7);
  });
  g.userData = { C, mesh: m, cls };
  return g;
}

// 수염 셸 영역 추출
function beardGeometry(headGeo, v) {
  const C = headGeo.userData.C, pos = headGeo.attributes.position, nor = headGeo.attributes.normal, idx = headGeo.index.array;
  const keep = new Uint8Array(pos.count), mask = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i) - C[0], ly = pos.getY(i) - C[1], lz = pos.getZ(i) - C[2];
    let m = 0;
    const ax = Math.abs(lx);
    if (v.beard === 'full') m = (ly < -0.044 + 0.5 * ax && lz > -0.03 && ax < 0.079 && ly > -0.138) ? 1 : 0;
    else if (v.beard === 'mustache') m = ((ly < -0.037 && ly > -0.0475 && ax < 0.027 && lz > 0.085) || (ax > 0.019 && ax < 0.028 && ly < -0.037 && ly > -0.07 && lz > 0.07)) ? 1 : 0;
    if (m && ax < 0.02 && ly < -0.0475 && ly > -0.068 && lz > 0.09) m = 0; // 입술 제외
    keep[i] = m; mask[i] = m;
  }
  const newIdx = [];
  for (let t = 0; t < idx.length; t += 3) if (keep[idx[t]] && keep[idx[t + 1]] && keep[idx[t + 2]]) newIdx.push(idx[t], idx[t + 1], idx[t + 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', pos); g.setAttribute('normal', nor);
  g.setIndex(newIdx);
  return g;
}
function shellMaterial(color, len, dens, layer, layers) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent: false, alphaTest: 0.5 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uL = { value: len * layer / layers }; s.uniforms.uK = { value: layer / layers }; s.uniforms.uD = { value: dens };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uL; varying vec3 vP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normal * uL; transformed.y -= uL * uL * 12.0; vP = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uK; uniform float uD; varying vec3 vP;
      float hh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
      .replace('#include <alphatest_fragment>', `vec3 q = floor(vP * uD); float r = hh(q); if (r < uK * 0.9 + 0.08) discard; diffuseColor.rgb *= 0.6 + uK * 0.6;`);
  };
  m.customProgramCacheKey = () => 'shell' + layer;
  return m;
}

// ── 머리카락 카드 ──
function hairMaterial(color) {
  const m = new THREE.MeshStandardMaterial({ color, map: T.hair.map, alphaMap: null, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.42, alphaToCoverage: true, transparent: false });
  m.map = T.hair.map;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uWind: WIND.dir, uWS: WIND.strength, uTime: WIND.time, uWLocal: m.userData.wLocal || (m.userData.wLocal = { value: new THREE.Vector3(1, 0, 0) }) });
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT; attribute vec3 aRoot; uniform vec3 uWLocal; uniform float uWS; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = dot(aRoot, vec3(31.0, 17.0, 23.0));
        float gust = 0.55 + 0.45 * sin(uTime * 1.3 + ph * 0.1) * sin(uTime * 0.37 + 1.7);
        float flap = sin(uTime * 7.0 + ph + aT * 3.0) * 0.35 + sin(uTime * 11.0 + ph * 1.7) * 0.15;
        vec3 wdir = uWLocal;
        transformed += (wdir * (0.6 + flap) + vec3(0., flap * 0.3, 0.)) * aT * aT * 0.04 * uWS * gust;`);
    s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.a = texture2D(map, vMapUv).a;`);
  };
  m.customProgramCacheKey = () => 'hair';
  return m;
}
// 두피 위 카드 생성: style = 'short' | 'medium' | 'pony' | 'buzz'
function buildHair(style, C, f) {
  const pos = [], uv = [], at = [], root = [], idx = [];
  const R = [0.078 * f, 0.097 * f, 0.104 * f], cz = -0.012;
  const surf = (th, ph, off = 0) => { // th: 위(0)→아래(π), ph: 방위(0=앞)
    const x = Math.sin(th) * Math.sin(ph) * (R[0] + off), y = Math.cos(th) * (R[1] + off) + 0.02, z = Math.sin(th) * Math.cos(ph) * (R[2] + off) + cz;
    return new THREE.Vector3(C[0] + x, C[1] + y, C[2] + z);
  };
  const card = (pts, width, side) => {
    const base = pos.length / 3, n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], t = i / (n - 1), w = width * (1 - t * 0.55);
      for (const sgn of [-1, 1]) { pos.push(p.x + side.x * w * sgn, p.y + side.y * w * sgn, p.z + side.z * w * sgn); uv.push(sgn < 0 ? 0 : 1, t); at.push(t); root.push(pts[0].x, pts[0].y, pts[0].z); }
      if (i < n - 1) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const cnt = style === 'buzz' ? 0 : style === 'short' ? 420 : 620;
  for (let i = 0; i < cnt; i++) {
    const ph = rnd(-Math.PI, Math.PI), th = Math.acos(rnd(-0.15, 1)) * 0.95;
    const front = Math.cos(ph);
    if (th > 1.35 - (front > 0.3 ? 0.55 : 0) + (Math.abs(Math.sin(ph)) > 0.8 ? -0.25 : 0)) continue;
    const L = style === 'short' ? rnd(0.035, 0.06) : style === 'medium' ? rnd(0.08, 0.14) : rnd(0.07, 0.12);
    const pts = [];
    let t0 = th, p0 = ph;
    // 빗는 방향: 뒤/아래로
    const dT = style === 'pony' ? 0.9 : 0.55, dP = style === 'pony' ? Math.sign(ph) * 0.35 : 0;
    const segs = 6;
    for (let s = 0; s < segs; s++) {
      const k = s / (segs - 1);
      const tt = t0 + dT * k * (L / 0.1), pp = p0 + dP * k;
      const pnt = surf(Math.min(tt, 2.2), pp, 0.009 + k * 0.007);
      if (tt > 1.9) pnt.y -= (tt - 1.9) * 0.08;
      pts.push(pnt);
    }
    const tang = pts[1].clone().sub(pts[0]).normalize(), nrm = pts[0].clone().sub(new THREE.Vector3(C[0], C[1] + 0.02, C[2] + cz)).normalize();
    const side = new THREE.Vector3().crossVectors(tang, nrm).normalize();
    card(pts, style === 'short' ? 0.011 : 0.014, side);
  }
  if (style === 'pony' || style === 'medium') {
    // 포니테일 / 뒷머리 다발
    const tie = new THREE.Vector3(C[0], C[1] + 0.01, C[2] - 0.122);
    const n = style === 'pony' ? 40 : 30;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(0, 0.012), L = style === 'pony' ? rnd(0.2, 0.28) : rnd(0.09, 0.14);
      const pts = [];
      const start = style === 'pony' ? tie.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)) : surf(rnd(1.5, 1.95), rnd(2.3, 3.98) * (Math.random() < 0.5 ? 1 : -1), 0.01);
      for (let s = 0; s < 8; s++) {
        const k = s / 7;
        pts.push(start.clone().add(new THREE.Vector3(Math.cos(a) * r * k * 1.5, -L * k, -0.03 * Math.sin(k * 1.5) - (style === 'pony' ? 0.02 * k : 0.005 * k))));
      }
      const side = new THREE.Vector3(Math.cos(a + 1.57), 0, Math.sin(a + 1.57) * 0.3).normalize();
      card(pts, style === 'pony' ? 0.014 : 0.012, side);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setAttribute('aRoot', new THREE.Float32BufferAttribute(root, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// 눈썹 카드
function buildBrows(C, f, thick) {
  const pos = [], uv = [], idx = [], at = [], root = [];
  for (const s of [1, -1]) for (let i = 0; i < 7; i++) {
    const t = i / 6, x = s * (0.014 + t * 0.03) * f, y = 0.021 + Math.sin(t * Math.PI) * 0.004 - t * 0.002, z = 0.1 - t * t * 0.02;
    const p = new THREE.Vector3(C[0] + x, C[1] + y, C[2] + z);
    const base = pos.length / 3, w = 0.004 * thick * (1 - t * 0.4), l = 0.006;
    const q = [[-w, -l * 0.3], [w, -l * 0.3], [-w, l], [w, l]];
    for (const [a, b] of q) { pos.push(p.x + s * b * 0.8, p.y + a, p.z + 0.002); uv.push(b > 0 ? 1 : 0, a > 0 ? 1 : 0); at.push(0); root.push(p.x, p.y, p.z); }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1)); g.setAttribute('aRoot', new THREE.Float32BufferAttribute(root, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ── 눈 ──
function eyeMaterial(iris) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uIris = { value: new THREE.Color(...iris) };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = normalize(position);');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; uniform vec3 uIris;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float a = acos(clamp(vOP.z, -1., 1.));
        float ang = atan(vOP.y, vOP.x);
        vec3 sclera = vec3(0.93, 0.9, 0.87) * (1.0 - 0.15 * smoothstep(0.9, 1.6, a)) + vec3(0.1, -0.05, -0.05) * smoothstep(1.2, 1.6, a) * (0.5 + 0.5 * sin(ang * 23.0));
        float fib = 0.75 + 0.25 * sin(ang * 60.0 + sin(ang * 13.0) * 2.0);
        vec3 ir = uIris * fib * (0.7 + 0.5 * smoothstep(0.1, 0.46, a));
        vec3 c = mix(ir, sclera, smoothstep(0.49, 0.53, a));
        c = mix(vec3(0.01), c, smoothstep(0.18, 0.21, a));
        c *= 1.0 - 0.6 * smoothstep(0.42, 0.5, a) * (1.0 - smoothstep(0.5, 0.55, a));
        diffuseColor.rgb = c;`);
  };
  m.customProgramCacheKey = () => 'eye';
  return m;
}

// ════════ 장비 ════════
const GEAR_CACHE = {};
function gearMesh(key, build, matMap, h = 0.011) {
  if (!GEAR_CACHE[key]) {
    const { S } = build(h);
    S.bake();
    const m = smoothMesh(S.mesh(), 1, 0.35);
    const cls = S.classify(m, null);
    GEAR_CACHE[key] = buildGeometry(m, cls, Object.keys(matMap), null);
  }
  const mats = Object.values(matMap);
  const mesh = new THREE.Mesh(GEAR_CACHE[key], mats);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function plateCarrier(h) {
  const S = new SDFModel([-0.25, 0.98, -0.2], [0.25, 1.52, 0.23], h);
  S.add(rbox([0, 1.25, 0.128], [0.152, 0.185, 0.03], 0.02, { mat: 'cordura', k: 0.01, rot: [-0.08, 0, 0] }));
  S.add(rbox([0, 1.27, -0.127], [0.158, 0.195, 0.03], 0.02, { mat: 'cordura', k: 0.01, rot: [0.06, 0, 0] }));
  // 컴머번드
  const cb = S.add(ellipsoid([0, 1.12, 0.0], [0.19, 0.075, 0.15], { mat: 'cordura', k: 0.01 }));
  S.sub(ellipsoid([0, 1.12, 0.0], [0.168, 0.2, 0.128], { k: 0.004 }));
  for (const s of [1, -1]) {
    S.add(cone([s * 0.1, 1.41, 0.112], [s * 0.115, 1.475, -0.005], 0.022, 0.02, { mat: 'cordura', k: 0.01 }));
    S.add(cone([s * 0.115, 1.475, -0.005], [s * 0.105, 1.42, -0.118], 0.02, 0.022, { mat: 'cordura', k: 0.01 }));
    // 측면 무전기 파우치
  }
  S.add(rbox([0.19, 1.14, -0.02], [0.028, 0.065, 0.038], 0.008, { mat: 'cordura2', k: 0.004 }));
  S.add(cone([0.19, 1.2, -0.03], [0.19, 1.37, -0.05], 0.004, 0.003, { mat: 'rubber', k: 0.001 }));
  // 탄창 파우치 3개 + 덮개
  for (const x of [-0.074, 0, 0.074]) {
    S.add(rbox([x, 1.14, 0.178], [0.033, 0.068, 0.024], 0.008, { mat: 'cordura2', k: 0.003 }));
    S.add(rbox([x, 1.2, 0.184], [0.035, 0.018, 0.027], 0.006, { mat: 'cordura2', k: 0.003, rot: [0.25, 0, 0] }));
  }
  // 행정 파우치 + 패치 영역
  S.add(rbox([0, 1.32, 0.172], [0.08, 0.045, 0.018], 0.01, { mat: 'cordura2', k: 0.004, rot: [-0.08, 0, 0] }));
  // 뒤 수화물 파우치
  S.add(rbox([0, 1.26, -0.18], [0.11, 0.13, 0.03], 0.02, { mat: 'cordura2', k: 0.006, rot: [0.06, 0, 0] }));
  // 손잡이 (드래그 핸들)
  S.add(torus([0, 1.47, -0.15], 0.025, 0.005, { mat: 'rubber', k: 0.002, rot: [Math.PI / 2 - 0.2, 0, 0] }));
  return { S };
}
function battleBelt(h) {
  const S = new SDFModel([-0.22, 0.85, -0.18], [0.22, 1.05, 0.18], h);
  S.add(ellipsoid([0, 0.975, 0], [0.172, 0.028, 0.128], { mat: 'cordura', k: 0.004 }));
  S.sub(ellipsoid([0, 0.975, 0], [0.156, 0.2, 0.112], { k: 0.003 }));
  S.add(rbox([0, 0.975, 0.126], [0.028, 0.02, 0.01], 0.004, { mat: 'metal', k: 0.002 }));
  for (const [x, z, r] of [[0.13, 0.08, 0.6], [-0.13, 0.08, -0.6], [0.16, -0.05, 1.3]]) S.add(rbox([x, 0.955, z], [0.03, 0.048, 0.025], 0.008, { mat: 'cordura2', k: 0.003, rot: [0, r, 0] }));
  S.add(rbox([-0.1, 0.945, -0.1], [0.05, 0.045, 0.025], 0.012, { mat: 'cordura2', k: 0.004, rot: [0, -0.6, 0] }));
  return { S };
}
function helmet(h) {
  const S = new SDFModel([-0.13, 1.56, -0.14], [0.13, 1.8, 0.16], h);
  const c = [0, 1.693, 0.0];
  S.add(ellipsoid(c, [0.104, 0.1, 0.122], { mat: 'helmet', k: 0.004 }));
  S.sub(ellipsoid(c, [0.089, 0.086, 0.107], { k: 0.003 }));
  S.inter(plane([0, -1, 0.35], -1.655, { k: 0.004 }));
  for (const s of [1, -1]) {
    S.sub(ellipsoid([s * 0.105, 1.66, 0.01], [0.03, 0.045, 0.05], { k: 0.006 }));
    S.add(rbox([s * 0.097, 1.685, 0.01], [0.008, 0.012, 0.055], 0.003, { mat: 'rail', k: 0.004, rot: [0, 0, s * -0.25] }));
    S.add(rbox([s * 0.094, 1.642, 0.004], [0.017, 0.037, 0.032], 0.014, { mat: 'headset', k: 0.004, rot: [0, 0, s * 0.08] }));
    S.add(cone([s * 0.08, 1.72, 0.07], [s * 0.1, 1.64, 0.1], 0.004, 0.003, { mat: 'headset', k: 0.001 }));
  }
  S.add(rbox([0, 1.745, 0.113], [0.028, 0.02, 0.012], 0.005, { mat: 'rail', k: 0.004, rot: [-0.5, 0, 0] }));
  S.add(rbox([0, 1.78, -0.02], [0.03, 0.006, 0.05], 0.004, { mat: 'rail', k: 0.004 }));
  return { S };
}
function capGear(h, boonie) {
  const S = new SDFModel([-0.2, 1.6, -0.2], [0.2, 1.84, 0.24], h);
  const c = [0, 1.706, -0.01];
  S.add(ellipsoid(c, [0.091, 0.094, 0.117], { mat: 'cap', k: 0.004 }));
  S.sub(ellipsoid(c, [0.079, 0.082, 0.105], { k: 0.003 }));
  S.inter(boonie ? plane([0, -1, 0], -1.708, { k: 0.003 }) : plane([0, -1, 0.3], -1.698, { k: 0.003 }));
  if (boonie) {
    S.add(ellipsoid([0, 1.708, -0.01], [0.165, 0.0075, 0.18], { mat: 'cap', k: 0.004 }));
    S.add(ellipsoid([0, 1.7, -0.01], [0.172, 0.012, 0.187], { mat: 'cap', k: 0.004 }));
    S.sub(ellipsoid([0, 1.708, -0.01], [0.086, 0.06, 0.11], { k: 0.003 }));
    S.sub(ellipsoid([0, 1.69, -0.01], [0.16, 0.012, 0.175], { k: 0.004 }));
    S.add(torus([0, 1.722, -0.01], 0.09, 0.0065, { mat: 'cap2', k: 0.003 }));
  } else {
    S.add(ellipsoid([0, 1.728, 0.125], [0.078, 0.0065, 0.068], { mat: 'cap2', k: 0.004, rot: [-0.22, 0, 0] }));
  }
  S.add(sphere([0, 1.797, -0.01], 0.007, { mat: 'cap', k: 0.003 }));
  for (const s of [1, -1]) S.add(rbox([s * 0.094, 1.645, 0.0], [0.017, 0.037, 0.032], 0.014, { mat: 'headset', k: 0.004, rot: [0, 0, s * 0.08] }));
  if (!boonie) S.add(torus([0, 1.66, 0.0], 0.096, 0.006, { mat: 'headset', k: 0.003, rot: [0, 0, Math.PI / 2] }));
  return { S };
}
function sunglasses(h) {
  const S = new SDFModel([-0.09, 1.64, 0.02], [0.09, 1.7, 0.13], h);
  for (const s of [1, -1]) {
    S.add(ellipsoid([s * 0.032, 1.671, 0.108], [0.022, 0.0135, 0.004], { mat: 'lens', k: 0.001, rot: [0, s * 0.2, 0] }));
    S.add(cone([s * 0.054, 1.673, 0.1], [s * 0.078, 1.675, 0.03], 0.0022, 0.0022, { mat: 'frame', k: 0.001 }));
  }
  S.add(cone([-0.012, 1.676, 0.112], [0.012, 1.676, 0.112], 0.002, 0.002, { mat: 'frame', k: 0.001 }));
  return { S };
}
function kneePad(h) {
  const S = new SDFModel([-0.08, -0.08, -0.03], [0.08, 0.08, 0.1], h);
  S.add(ellipsoid([0, 0, 0.05], [0.055, 0.07, 0.035], { mat: 'pad', k: 0.004 }));
  S.sub(ellipsoid([0, 0, 0.022], [0.05, 0.07, 0.035], { k: 0.004 }));
  return { S };
}

// ── 공유 재질 ──
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const cam = T.multicam, cl = T.clothN;
  MATS = {
    shirt: triMaterial({ map: cam.map, nmap: cl.normalMap, scale: 2.4, ns: 1.4, rough: 0.95, vcol: true, sheen: 0.6 }),
    pants: triMaterial({ map: cam.map, nmap: cl.normalMap, scale: 2.3, ns: 1.5, rough: 0.95, vcol: true, sheen: 0.6 }),
    boot: triMaterial({ color: 0x3e3226, nmap: T.bootL.normalMap, scale: 14, ns: 1.2, rough: 0.7, vcol: false }),
    sole: triMaterial({ color: 0x1d1a17, nmap: T.stipple.normalMap, scale: 30, ns: 1, rough: 0.9 }),
    glove: triMaterial({ color: 0x4d4234, nmap: T.glove.normalMap, map: T.glove.map, scale: 9, ns: 1.3, rough: 0.75 }),
    pad: triMaterial({ color: 0x24211c, nmap: T.stipple.normalMap, scale: 20, ns: 0.8, rough: 0.55 }),
    cuff: triMaterial({ color: 0x2c2822, nmap: T.clothN.normalMap, scale: 8, ns: 1, rough: 0.9 }),
    cordura: triMaterial({ color: 0x8a7658, map: T.cordura.map, nmap: T.cordura.normalMap, scale: 4, ns: 1.4, rough: 0.92, sheen: 0.4 }),
    cordura2: triMaterial({ color: 0x7d6b50, map: T.cordura.map, nmap: T.cordura.normalMap, scale: 5, ns: 1.2, rough: 0.92, sheen: 0.4 }),
    rubber: triMaterial({ color: 0x1b1b1a, nmap: T.stipple.normalMap, scale: 20, ns: 0.5, rough: 0.8 }),
    metal: triMaterial({ color: 0x2a2a2a, nmap: T.stipple.normalMap, scale: 20, ns: 0.2, rough: 0.4, metal: 0.8 }),
    helmet: triMaterial({ color: 0x8c7a5c, map: T.cordura.map, nmap: T.cordura.normalMap, scale: 7, ns: 0.9, rough: 0.85, sheen: 0.3 }),
    rail: triMaterial({ color: 0x252525, nmap: T.stipple.normalMap, scale: 20, ns: 0.4, rough: 0.5, metal: 0.4 }),
    headset: triMaterial({ color: 0x55513f, nmap: T.stipple.normalMap, scale: 20, ns: 0.6, rough: 0.6 }),
    cap: triMaterial({ color: 0x8f7c5e, nmap: T.clothN.normalMap, scale: 6, ns: 1.2, rough: 0.95, sheen: 0.5 }),
    cap2: triMaterial({ color: 0x7e6c51, nmap: T.clothN.normalMap, scale: 6, ns: 0.8, rough: 0.95 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.05, metalness: 0.6, clearcoat: 1, envMapIntensity: 2 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4 }),
    lid: null,
  };
  return MATS;
}
function skinMaterial() {
  return triMaterial({ nmap: T.skinN.normalMap, map: T.skinN.map, scale: 22, ns: 0.55, rough: 0.52, vcol: true, sheen: 0.15 });
}

// ════════ 인물 생성 ════════
export const VARIANTS = {
  jin: { name: '진', skin: [0.72, 0.5, 0.36], jaw: 1.05, nose: 1.0, stubble: 0.7, hair: 'short', hairColor: 0x15110e, gear: 'helmet', iris: [0.25, 0.16, 0.1] },
  mason: { name: '메이슨', skin: [0.77, 0.54, 0.41], browColor: [0.24, 0.16, 0.1], jaw: 1.1, nose: 1.08, beard: 'full', beardColor: 0x3a2a1c, hair: 'medium', hairColor: 0x3a2a1c, gear: 'cap', glasses: true, iris: [0.3, 0.4, 0.45] },
  sofia: { name: '소피아', female: true, skin: [0.78, 0.55, 0.43], browColor: [0.2, 0.13, 0.08], jaw: 0.9, nose: 0.9, lips: 1.1, brow: 0.8, hair: 'pony', hairColor: 0x2b1b10, gear: 'headset', iris: [0.35, 0.25, 0.12] },
  dae: { name: '대현', skin: [0.66, 0.45, 0.32], jaw: 1.0, nose: 0.95, beard: 'mustache', beardColor: 0x1a1410, stubble: 0.5, hair: 'short', hairColor: 0x0f0c0a, gear: 'boonie', scar: [0.045, -0.02], iris: [0.18, 0.12, 0.08] },
};

export function createHuman(key, { shadowOnly = false } = {}) {
  const v = VARIANTS[key] || VARIANTS.jin;
  const M = mats();
  // 뼈대
  const bones = SKEL.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; return bone; });
  SKEL.forEach((b, i) => {
    if (b.parent < 0) bone(bones[i]).position.copy(b.p);
    else { bones[b.parent].add(bones[i]); bones[i].position.copy(b.p).sub(SKEL[b.parent].p); }
  });
  function bone(x) { return x; }
  const skeleton = new THREE.Skeleton(bones);
  const root = new THREE.Group();
  const bodyMats = [M.shirt, M.pants, M.boot, M.sole];
  const invis = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const body = new THREE.SkinnedMesh(buildBody(), shadowOnly ? [invis, invis, invis, invis] : bodyMats);
  body.add(bones[0]);
  body.bind(skeleton);
  body.castShadow = true; body.receiveShadow = !shadowOnly; body.frustumCulled = false;
  root.add(body);
  const hands = new THREE.SkinnedMesh(buildHands(), shadowOnly ? [invis, invis, invis, invis, invis, invis] : [M.glove, M.pad, M.pad, M.pad, M.cuff, M.cuff]);
  hands.bind(skeleton); hands.castShadow = true; hands.receiveShadow = !shadowOnly; hands.frustumCulled = false;
  root.add(hands);
  const Bn = Object.fromEntries(bones.map((b) => [b.name, b]));
  const attach = (boneName, obj) => { const b = Bn[boneName]; obj.position.sub(SKEL[BI[boneName]].p); b.add(obj); if (shadowOnly) obj.traverse((o) => { if (o.isMesh) { o.material = invis; o.castShadow = true; } }); return obj; };
  // 장비
  const pc = gearMesh('pc', plateCarrier, { cordura: M.cordura, cordura2: M.cordura2, rubber: M.rubber });
  attach('chest', pc);
  const belt = gearMesh('belt', battleBelt, { cordura: M.cordura, cordura2: M.cordura2, metal: M.metal });
  attach('hips', belt);
  for (const k of ['L', 'R']) { const kp = gearMesh('knee', kneePad, { pad: M.pad }, 0.008); kp.position.set(...P('shin' + k)); kp.position.z += 0.01; kp.position.y += 0.005; attach('shin' + k, kp); }
  // 머리
  const headGroup = new THREE.Group();
  let headGeo = null;
  if (!shadowOnly) {
    headGeo = HEAD_CACHE[key] || (HEAD_CACHE[key] = buildHead(v));
    const hm = new THREE.Mesh(headGeo, [skinMaterial(), skinMaterial(), skinMaterial()]);
    hm.castShadow = true; hm.receiveShadow = true;
    headGroup.add(hm);
    const C = headGeo.userData.C, f = v.female ? 0.94 : 1;
    // 눈
    const eyes = [];
    for (const s of [1, -1]) {
      const e = new THREE.Mesh(EYE_GEO, eyeMaterial(v.iris));
      e.position.set(C[0] + s * 0.031 * f, C[1] + 0.003, C[2] + 0.0795);
      headGroup.add(e); eyes.push(e);
    }
    // 눈꺼풀(깜빡임용): 열림 땐 안구 뒤위쪽(머리 속)에 숨어 있다가 앞으로 덮음
    const lidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(v.skin[0] * 0.9, v.skin[1] * 0.86, v.skin[2] * 0.86, THREE.SRGBColorSpace), roughness: 0.55 });
    const lids = eyes.map((e) => { const l = new THREE.Mesh(LID_GEO, lidMat); l.position.copy(e.position); l.rotation.x = -0.9; headGroup.add(l); return l; });
    // 눈썹/머리카락/수염
    const hmat = hairMaterial(v.hairColor);
    const brows = new THREE.Mesh(buildBrows(C, f, v.female ? 0.7 : 1.1), hmat); headGroup.add(brows);
    const hg = buildHair(v.hair, C, f);
    if (hg) { const hair = new THREE.Mesh(hg, hmat); hair.castShadow = true; headGroup.add(hair); }
    if (v.beard) {
      const coarse = BEARD_BASE[key] || (BEARD_BASE[key] = buildHead(v, 0.0055));
      const bg = beardGeometry(coarse, v);
      for (let i = 1; i <= 7; i++) { const sh = new THREE.Mesh(bg, shellMaterial(v.beardColor, v.beard === 'full' ? 0.009 : 0.007, 1400, i, 7)); headGroup.add(sh); }
    }
    headGroup.userData = { eyes, hmat, lids };
  }
  if (v.gear === 'helmet') headGroup.add(gearMesh('helmet', helmet, { helmet: M.helmet, rail: M.rail, headset: M.headset }, 0.0045));
  else if (v.gear === 'cap') headGroup.add(gearMesh('cap', (h) => capGear(h, false), { cap: M.cap, cap2: M.cap2, headset: M.headset }, 0.0042));
  else if (v.gear === 'boonie') headGroup.add(gearMesh('boonie', (h) => capGear(h, true), { cap: M.cap, cap2: M.cap2, headset: M.headset }, 0.0042));
  else if (v.gear === 'headset') headGroup.add(gearMesh('headset', (h) => { const S = new SDFModel([-0.13, 1.58, -0.08], [0.13, 1.78, 0.08], h); for (const s of [1, -1]) S.add(rbox([s * 0.092, 1.645, 0.0], [0.017, 0.037, 0.032], 0.014, { mat: 'headset', k: 0.004, rot: [0, 0, s * 0.08] })); S.add(torus([0, 1.665, 0.0], 0.091, 0.0055, { mat: 'headset', k: 0.003, rot: [0, 0, Math.PI / 2] })); return { S }; }, { headset: M.headset }, 0.0045));
  if (v.glasses) headGroup.add(gearMesh('glasses', sunglasses, { lens: M.lens, frame: M.frame }, 0.0024));
  headGroup.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  attach('head', headGroup);
  root.userData = { v };
  return { root, bones: Bn, skeleton, body, hands, head: headGroup, v, key };
}
const HEAD_CACHE = {}, BEARD_BASE = {};
const EYE_GEO = new THREE.SphereGeometry(0.0122, 24, 16);
const LID_GEO = new THREE.SphereGeometry(0.0131, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);

// ════════ 포즈 도구 ════════
// 뼈의 휴지 방향: 휴지 회전은 모두 항등 → 자식 오프셋이 곧 방향
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
export function restDir(name, childName) { return SKEL[BI[childName]].p.clone().sub(SKEL[BI[name]].p).normalize(); }
// 두 축(주축+보조축)을 맞추는 월드 회전
export function frameQuat(restA, restB, tgtA, tgtB, out = new THREE.Quaternion()) {
  const a1 = restA.clone().normalize(), b1 = restB.clone().sub(a1.clone().multiplyScalar(restB.dot(a1))).normalize(), c1 = new THREE.Vector3().crossVectors(a1, b1);
  const a2 = tgtA.clone().normalize(), b2 = tgtB.clone().sub(a2.clone().multiplyScalar(tgtB.dot(a2))).normalize(), c2 = new THREE.Vector3().crossVectors(a2, b2);
  const mR = new THREE.Matrix4().makeBasis(a1, b1, c1), mT = new THREE.Matrix4().makeBasis(a2, b2, c2);
  return out.setFromRotationMatrix(mT.multiply(mR.transpose()));
}
// 뼈에 월드 회전 적용 (부모 월드 회전 역변환)
export function setWorldQuat(bone, qWorld) {
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(qWorld));
  bone.updateMatrixWorld(true);
}
