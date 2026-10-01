// 사실적 인물 생성기 — MakeHuman(CC0) 기반 몸/얼굴(fps/tools/humans 베이크) + SDF 장갑/부츠/장비를 뼈대에 스키닝.
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
// 피부: 파장별 랩 조명(표면하 산란 근사: 적색광이 더 깊이 퍼짐) + 피지 이중 스펙큘러(클리어코트)
const SKIN_PARS = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
  'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor )',
  `vec3 sssW = vec3(0.42, 0.2, 0.12) * uSSS;
    float nl0 = dot( geometryNormal, directLight.direction );
    vec3 wrapNL = saturate( ( nl0 + sssW ) / ( 1.0 + sssW ) );
    vec3 sssTint = mix( vec3( 1.0 ), vec3( 1.0, 0.62, 0.52 ), saturate( ( 1.0 - saturate( nl0 * 2.5 ) ) * 0.7 * uSSS ) );
    reflectedLight.directDiffuse += wrapNL * sssTint * directLight.color * BRDF_Lambert( material.diffuseColor )`);
export function triMaterial({ color = 0xffffff, map = null, nmap = null, scale = 8, ns = 1, rough = 0.9, metal = 0, vcol = false, side = THREE.FrontSide, env = 1, sheen = 0, skin = 0 } = {}) {
  const m = skin ? new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, vertexColors: vcol, side, envMapIntensity: env, clearcoat: 0.32 * skin, clearcoatRoughness: 0.42 })
    : new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, vertexColors: vcol, side, envMapIntensity: env });
  const uni = { uTriMap: { value: map || T.soft.map }, uTriNor: { value: nmap }, uTriS: { value: scale }, uTriNS: { value: ns }, uHasMap: { value: map ? 1 : 0 }, uSheen: { value: sheen }, uSSS: { value: skin } };
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
        varying vec3 vTriPos; varying vec3 vTriN; varying mat3 vO2V; uniform sampler2D uTriMap; uniform sampler2D uTriNor; uniform float uTriNS; uniform float uHasMap; uniform float uSheen; uniform float uSSS;
        vec3 triW(){ vec3 b = pow(abs(normalize(vTriN)), vec3(4.)); return b / (b.x + b.y + b.z); }
        vec4 tri(sampler2D t, vec3 w){ return texture2D(t, vTriPos.zy) * w.x + texture2D(t, vTriPos.xz) * w.y + texture2D(t, vTriPos.xy) * w.z; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 tw = triW();
        if (uHasMap > 0.5) diffuseColor.rgb *= tri(uTriMap, tw).rgb;
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.18;   // 근접 평면에 잘린 안쪽 면은 어두운 안감으로`)
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
      .replace('#include <lights_physical_pars_fragment>', skin ? SKIN_PARS : '#include <lights_physical_pars_fragment>')
      .replace('#include <opaque_fragment>', `outgoingLight += uSheen * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0) * diffuseColor.rgb * 0.35;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'tri' + (nmap ? 1 : 0) + (vcol ? 1 : 0) + (skin ? 's' : '');
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
// 수염/두피 셸 영역 (MakeHuman 얼굴 실측: 코끝 y-0.036, 입선 -0.0705, 턱끝 -0.115; C 상대)
const _ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function subGeometry(headGeo, test) {
  const C = headGeo.userData.C, pos = headGeo.attributes.position, idx = headGeo.index.array;
  const keep = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) keep[i] = test(pos.getX(i) - C[0], pos.getY(i) - C[1], pos.getZ(i) - C[2]) ? 1 : 0;
  const newIdx = [];
  for (let t = 0; t < idx.length; t += 3) if (keep[idx[t]] && keep[idx[t + 1]] && keep[idx[t + 2]]) newIdx.push(idx[t], idx[t + 1], idx[t + 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', pos); g.setAttribute('normal', headGeo.attributes.normal);
  g.setIndex(newIdx);
  return g;
}
function beardGeometry(headGeo, v) {
  return subGeometry(headGeo, (lx, ly, lz) => {
    const ax = Math.abs(lx);
    const lips = ax < 0.027 && ly < -0.05 && ly > -0.086 && lz > 0.09;
    if (v.beard === 'full') return !lips && ly < -0.05 + Math.max(ax - 0.028, 0) * 0.95 && ly > -0.155 && lz > -0.03 && ax < 0.08;
    return (ly < -0.043 && ly > -0.054 && ax < 0.03 && lz > 0.097) || (ax > 0.022 && ax < 0.033 && ly < -0.045 && ly > -0.09 && lz > 0.083);
  });
}
function scalpGeometry(headGeo, v, hat = false) {
  return subGeometry(headGeo, (lx, ly, lz) => {
    const ax = Math.abs(lx);
    const front = 0.07 + 0.01 * _ss(0.022, 0.05, ax) * (v.female ? 0.2 : 1);
    const side = ax > 0.06 && lz > -0.03 ? (lz < 0.03 ? -0.004 : 0.04) : 0.03;
    const wb = _ss(0.0, -0.05, lz), wf = _ss(0.0, 0.05, lz);
    const hl = (front * wf + side * (1 - wf)) * (1 - wb) + -0.07 * wb;
    if (ly < hl) return false;
    if (ax > 0.062 && ly < 0.035 && ly > -0.035 && lz > -0.035 && lz < 0.03 && !(lz < 0.03 && lz > 0.012)) return false;   // 귀
    return !(hat && (ly > 0.03 || lz > 0.0));
  });
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
function buildHair(style, C, f, hat = 0) {
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
    if (hat && th < hat) continue;   // 모자 속 머리는 생략 (관통 방지)
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

// ── 눈 ──
function eyeMaterial(iris) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uIris = { value: new THREE.Color(...iris) };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying float vUp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = normalize(position); vUp = normalize((modelMatrix * vec4(normal, 0.)).xyz).y;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying float vUp; uniform vec3 uIris;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float a = acos(clamp(vOP.z, -1., 1.));
        float ang = atan(vOP.y, vOP.x);
        vec3 sclera = vec3(0.8, 0.76, 0.71) * (1.0 - 0.2 * smoothstep(0.8, 1.5, a)) + vec3(0.1, -0.05, -0.05) * smoothstep(1.2, 1.6, a) * (0.5 + 0.5 * sin(ang * 23.0));
        float fib = 0.75 + 0.25 * sin(ang * 60.0 + sin(ang * 13.0) * 2.0);
        vec3 ir = uIris * fib * (0.7 + 0.5 * smoothstep(0.1, 0.46, a));
        vec3 c = mix(ir, sclera, smoothstep(0.49, 0.53, a));
        c = mix(vec3(0.01), c, smoothstep(0.18, 0.21, a));
        c *= 1.0 - 0.6 * smoothstep(0.42, 0.5, a) * (1.0 - smoothstep(0.5, 0.55, a));
        c *= 1.0 - 0.35 * smoothstep(-0.25, 0.4, vUp);   // 윗눈꺼풀/속눈썹 그늘
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
const MATS_BY = {};
// faction: 'fr' 아군(멀티캠·코요테 장비) / 'op' 적(우드랜드 위장·올리브/검정 장비)
function mats(faction = 'fr') {
  if (MATS_BY[faction]) return MATS_BY[faction];
  if (faction === 'op') {
    const b = mats('fr'), cl = T.clothN;
    return (MATS_BY.op = { ...b,
      shirt: triMaterial({ color: 0x8f9c76, map: T.camo.map, nmap: cl.normalMap, scale: 2.6, ns: 1.4, rough: 0.95, vcol: true, sheen: 0.5 }),
      pants: triMaterial({ color: 0x8f9c76, map: T.camo.map, nmap: cl.normalMap, scale: 2.5, ns: 1.5, rough: 0.95, vcol: true, sheen: 0.5 }),
      cordura: triMaterial({ color: 0x3d4130, map: T.cordura.map, nmap: T.cordura.normalMap, scale: 4, ns: 1.4, rough: 0.92, sheen: 0.3 }),
      cordura2: triMaterial({ color: 0x2e3126, map: T.cordura.map, nmap: T.cordura.normalMap, scale: 5, ns: 1.2, rough: 0.92, sheen: 0.3 }),
      helmet: triMaterial({ color: 0x3f4632, map: T.cordura.map, nmap: T.cordura.normalMap, scale: 7, ns: 0.9, rough: 0.85, sheen: 0.2 }),
      cap: triMaterial({ color: 0x2c2f25, nmap: T.clothN.normalMap, scale: 6, ns: 1.2, rough: 0.95, sheen: 0.4 }),
      cap2: triMaterial({ color: 0x24261f, nmap: T.clothN.normalMap, scale: 6, ns: 0.8, rough: 0.95 }),
      glove: triMaterial({ color: 0x1d1d1b, nmap: T.glove.normalMap, map: T.glove.map, scale: 9, ns: 1.3, rough: 0.7 }),
      headset: triMaterial({ color: 0x24261f, nmap: T.stipple.normalMap, scale: 20, ns: 0.6, rough: 0.6 }) });
  }
  const cam = T.multicam, cl = T.clothN;
  const MATS = MATS_BY.fr = {
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

// ════════ MakeHuman(CC0) 기반 실사 인물 — fps/tools/humans 에서 베이크 ════════
const MHA = { ready: false, geo: {}, head: {}, tex: {} };
export async function loadHumanAssets(url = './assets/humans/') {
  const [meta, base] = await Promise.all([fetch(url + 'humans.json').then((r) => r.json()), fetch(url + 'base.bin').then((r) => r.arrayBuffer())]);
  const n = meta.count, ni = meta.layout.index, nl = meta.layoutLash ?? meta.layout.lashIndex;
  let o = 0;
  const take = (C, len, bytes) => { const a = new C(base.slice(o, o + len * bytes)); o += len * bytes; return a; };
  MHA.index = take(Uint16Array, ni, 2);
  const uvq = take(Uint16Array, n * 2, 2);
  const si = take(Uint8Array, n * 4, 1), sw = take(Uint8Array, n * 4, 1);
  MHA.lashIndex = take(Uint16Array, nl, 2);
  MHA.weld = take(Uint16Array, n, 2);
  MHA.uv = Float32Array.from(uvq, (q) => q / 65535);
  MHA.skinIndex = Uint16Array.from(si, (b) => BI[meta.bones[b]]);
  MHA.skinWeight = Float32Array.from(sw, (w) => w / 255);
  MHA.meta = meta; MHA.n = n; MHA.url = url;
  const keys = Object.keys(meta.variants);
  const bufs = await Promise.all(keys.map((k) => fetch(url + k + '.bin').then((r) => r.arrayBuffer())));
  MHA.pos = {};
  keys.forEach((k, i) => { const q = new Int16Array(bufs[i]); MHA.pos[k] = Float32Array.from(q, (x) => x / 32767 * 2); });
  // 얼굴 텍스처 (인물별 알베도 + 공용 피부 노멀)
  const tl = new THREE.TextureLoader();
  const load = (f, srgb) => new Promise((res) => tl.load(url + f, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, () => res(null)));
  const [nrm, ...alb] = await Promise.all([load('skin_n.jpg', false), ...keys.map((k) => load(k + '_d.jpg', true))]);
  MHA.tex.normal = nrm; keys.forEach((k, i) => { MHA.tex[k] = alb[i]; });
  MHA.ready = true;
}

function weldNormals(g) {
  const pos = g.attributes.position.array, idx = g.index.array, W = MHA.weld, acc = new Float32Array(65536 * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3).sub(a); c.fromArray(pos, i2 * 3).sub(a); b.cross(c);
    for (const i of [i0, i1, i2]) { const w = W[i] * 3; acc[w] += b.x; acc[w + 1] += b.y; acc[w + 2] += b.z; }
  }
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < MHA.n; i++) { const w = W[i] * 3; a.set(acc[w], acc[w + 1], acc[w + 2]).normalize(); nor[i * 3] = a.x; nor[i * 3 + 1] = a.y; nor[i * 3 + 2] = a.z; }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
}

// 인물 몸 지오메트리: 그룹 0 피부(머리·목) 1 상의 2 하의
function mhBody(key) {
  if (MHA.geo[key]) return MHA.geo[key];
  const n = MHA.n, P = MHA.pos[key].subarray(0, n * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P.slice(), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(MHA.uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(MHA.skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(MHA.skinWeight, 4));
  g.setIndex(new THREE.BufferAttribute(MHA.index, 1));
  for (const [st, cnt] of MHA.meta.groups) g.addGroup(st, cnt, g.groups.length);
  weldNormals(g);
  // 옷 얼룩(정점색): 바지 아래쪽·무릎, 소매 끝
  const col = new Float32Array(n * 3).fill(1);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const dirt = Math.max(0, 0.45 - y) * 0.9 * (y < 1 ? 1 : 0) + n3(x * 8, y * 8, z * 8) * 0.1;
    const k = 1 - dirt * 0.5; col[i * 3] = k; col[i * 3 + 1] = k * 0.98; col[i * 3 + 2] = k * 0.95;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return (MHA.geo[key] = g);
}

// 머리 영역만 강체 지오메트리 (두피/수염 셸, 속눈썹 기준)
function mhHead(key) {
  if (MHA.head[key]) return MHA.head[key];
  const body = mhBody(key), P = body.attributes.position.array, idx = MHA.index, [st, cnt] = MHA.meta.groups[0];
  const keep = [];
  for (let t = st; t < st + cnt; t += 3) if (P[idx[t] * 3 + 1] > 1.52 && P[idx[t + 1] * 3 + 1] > 1.52 && P[idx[t + 2] * 3 + 1] > 1.52) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', body.attributes.position); g.setAttribute('normal', body.attributes.normal);
  g.setIndex(keep);
  g.userData = { C: [0, 1.667, 0.012] };
  // 속눈썹 (헬퍼 메시)
  const L = MHA.pos[key].subarray(MHA.n * 3), lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(L.slice(), 3)); lg.setIndex(new THREE.BufferAttribute(MHA.lashIndex, 1)); lg.computeVertexNormals();
  return (MHA.head[key] = { geo: g, lash: lg });
}

// 피부: 인물별 알베도 + 모공/주름 노멀, 파장별 표면하 산란 + 피지층(클리어코트)
function faceMaterial(key, v) {
  const tex = MHA.tex[key], sk = v.skin;
  const m = new THREE.MeshPhysicalMaterial({
    color: tex ? 0xffffff : new THREE.Color().setRGB(sk[0], sk[1], sk[2], THREE.SRGBColorSpace), map: tex, normalMap: MHA.tex.normal,
    normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.57, clearcoat: 0.16, clearcoatRoughness: 0.42, sheen: 0.15, sheenRoughness: 0.7, sheenColor: new THREE.Color(0.3, 0.17, 0.13),
  });
  const interior = patchInterior(new THREE.MeshStandardMaterial()).onBeforeCompile;
  m.onBeforeCompile = (s) => {
    interior(s);
    s.uniforms.uSSS = { value: 1 };
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSSS;').replace('#include <lights_physical_pars_fragment>', SKIN_PARS);
  };
  m.customProgramCacheKey = () => 'mhskin';
  return m;
}

// 전투화 (SDF) — 몸 메시의 발은 부츠 속에서 잘려 있음
let BOOT_GEO = null;
function buildBoots() {
  if (BOOT_GEO) return BOOT_GEO;
  const S = new SDFModel([-0.2, -0.01, -0.12], [0.2, 0.26, 0.24], 0.008);
  const b = BI;
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const an = P('foot' + k);
    S.add(cone([an[0], an[1] + 0.02, an[2]], [an[0], an[1] + 0.135, an[2] + 0.004], 0.05, 0.056, { bone: b['foot' + k], mat: 'boot', k: 0.02, sigma: 0.015 }));
    S.add(ellipsoid([s * 0.106, 0.052, 0.045], [0.05, 0.048, 0.12], { bone: b['foot' + k], mat: 'boot', k: 0.03 }));
    S.add(ellipsoid([s * 0.108, 0.04, 0.14], [0.046, 0.036, 0.05], { bone: b['toe' + k], mat: 'boot', k: 0.03 }));
    S.add(ellipsoid([s * 0.104, 0.05, -0.05], [0.044, 0.045, 0.046], { bone: b['foot' + k], mat: 'boot', k: 0.02 }));
    S.add(rbox([s * 0.105, 0.013, -0.01], [0.052, 0.013, 0.085], 0.008, { bone: b['foot' + k], mat: 'sole', k: 0.004 }));
    S.add(rbox([s * 0.107, 0.013, 0.13], [0.05, 0.013, 0.055], 0.012, { bone: b['toe' + k], mat: 'sole', k: 0.004 }));
    S.add(torus([an[0], an[1] + 0.135, an[2] + 0.004], 0.056, 0.009, { bone: b['shin' + k], mat: 'boot', k: 0.012 }));
  }
  S.bake();
  const m = smoothMesh(S.mesh(), 1, 0.4);
  const cls = S.classify(m, SKEL, 0.018);
  BOOT_GEO = buildGeometry(m, cls, ['boot', 'sole'], (x, y, z, mat, out) => { out[0] = out[1] = out[2] = 1; });
  return BOOT_GEO;
}

// ════════ 인물 생성 ════════
export const VARIANTS = {
  jin: { name: '진', skin: [0.72, 0.5, 0.36], jaw: 1.05, nose: 1.0, stubble: 0.7, hair: 'short', hairColor: 0x15110e, gear: 'helmet', iris: [0.25, 0.16, 0.1] },
  mason: { name: '메이슨', skin: [0.77, 0.54, 0.41], browColor: [0.24, 0.16, 0.1], jaw: 1.1, nose: 1.08, beard: 'full', beardColor: 0x3a2a1c, hair: 'medium', hairColor: 0x3a2a1c, gear: 'cap', glasses: true, iris: [0.3, 0.4, 0.45] },
  sofia: { name: '소피아', female: true, skin: [0.78, 0.55, 0.43], browColor: [0.2, 0.13, 0.08], jaw: 0.9, nose: 0.9, lips: 1.1, brow: 0.8, hair: 'pony', hairColor: 0x2b1b10, gear: 'headset', iris: [0.35, 0.25, 0.12] },
  dae: { name: '대현', skin: [0.66, 0.45, 0.32], jaw: 1.0, nose: 0.95, beard: 'mustache', beardColor: 0x1a1410, stubble: 0.5, hair: 'short', hairColor: 0x0f0c0a, gear: 'boonie', scar: [0.045, -0.02], iris: [0.18, 0.12, 0.08] },
  // 적 (우드랜드 위장)
  op1: { name: '적 소총수', faction: 'op', skin: [0.7, 0.52, 0.4], jaw: 1.08, nose: 1.05, stubble: 0.9, hair: 'buzz', hairColor: 0x14110e, gear: 'helmet', iris: [0.2, 0.14, 0.1] },
  op2: { name: '적 사수', faction: 'op', skin: [0.62, 0.44, 0.32], jaw: 1.12, nose: 1.0, beard: 'full', beardColor: 0x16120e, hair: 'short', hairColor: 0x100d0b, gear: 'cap', iris: [0.15, 0.1, 0.07] },
  op3: { name: '적 척후병', faction: 'op', skin: [0.75, 0.56, 0.44], jaw: 0.98, nose: 1.1, stubble: 0.4, hair: 'short', hairColor: 0x2a1d12, gear: 'boonie', iris: [0.28, 0.3, 0.3] },
  op4: { name: '적 분대장', faction: 'op', skin: [0.55, 0.39, 0.28], jaw: 1.05, nose: 0.97, beard: 'mustache', beardColor: 0x0f0c0a, stubble: 0.7, hair: 'buzz', hairColor: 0x0c0a08, gear: 'helmet', iris: [0.12, 0.08, 0.06] },
};

export function createHuman(key, { shadowOnly = false } = {}) {
  const v = VARIANTS[key] || VARIANTS.jin;
  const M = mats(v.faction);
  // 뼈대
  const bones = SKEL.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; return bone; });
  SKEL.forEach((b, i) => {
    if (b.parent < 0) bone(bones[i]).position.copy(b.p);
    else { bones[b.parent].add(bones[i]); bones[i].position.copy(b.p).sub(SKEL[b.parent].p); }
  });
  function bone(x) { return x; }
  const skeleton = new THREE.Skeleton(bones);
  const root = new THREE.Group();
  const invis = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const body = new THREE.SkinnedMesh(mhBody(key), shadowOnly ? [invis, invis, invis] : [faceMaterial(key, v), M.shirt, M.pants]);
  body.add(bones[0]);
  body.bind(skeleton);
  body.castShadow = true; body.receiveShadow = !shadowOnly; body.frustumCulled = false;
  root.add(body);
  const boots = new THREE.SkinnedMesh(buildBoots(), shadowOnly ? [invis, invis] : [M.boot, M.sole]);
  boots.bind(skeleton); boots.castShadow = true; boots.receiveShadow = !shadowOnly; boots.frustumCulled = false;
  root.add(boots);
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
  // 원래 SDF 두개골(C 기준 타원체)용으로 만든 헤어/모자를 이 인물의 실제 두개골 타원체로 옮김
  const skullFit = new THREE.Group();
  {
    const sk = MHA.meta.variants[key].skull, f0 = v.female ? 0.94 : 1, C0 = [0, 1.667, 0.012];
    const r0 = [0.074 * f0, 0.093 * f0, 0.1 * f0], c0 = [0, 0.02, -0.012];
    const sc = [0, 1, 2].map((i) => Math.min(1.08, Math.max(0.94, sk.r[i] / r0[i])));
    skullFit.scale.set(...sc);
    // x 는 중심, y 는 정수리, z 는 뒤통수를 맞춤 (모자/헬멧이 얹히는 기준)
    skullFit.position.set(0, C0[1] + sk.top - (C0[1] + c0[1] + r0[1]) * sc[1], C0[2] + sk.back - (C0[2] + c0[2] - r0[2]) * sc[2]);
  }
  let headGeo = null;
  if (!shadowOnly) {
    const HD = mhHead(key);
    headGeo = HD.geo;
    const C = headGeo.userData.C, f = v.female ? 0.94 : 1;
    // 눈 (MakeHuman 안와 위치에 맞춤)
    const EM = MHA.meta.variants[key], es = EM.eyeR / 0.0122;
    const eyes = [];
    for (const k of ['L', 'R']) {
      const e = new THREE.Mesh(EYE_GEO, eyeMaterial(v.iris));
      e.position.fromArray(EM.eyes[k]); e.scale.setScalar(es);
      headGroup.add(e); eyes.push(e);
    }
    // 눈꺼풀(깜빡임용): 열림 땐 안구 뒤위쪽(머리 속)에 숨어 있다가 앞으로 덮음
    const lidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(v.skin[0] * 0.9, v.skin[1] * 0.86, v.skin[2] * 0.86, THREE.SRGBColorSpace), roughness: 0.55 });
    const lids = eyes.map((e) => { const l = new THREE.Mesh(LID_GEO, lidMat); l.position.copy(e.position); l.scale.setScalar(es * 1.02); l.rotation.x = -0.9; headGroup.add(l); return l; });
    // 속눈썹
    const lash = new THREE.Mesh(HD.lash, new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: v.female ? 0.7 : 0.45, depthWrite: false }));
    lash.userData.noShadow = true; headGroup.add(lash);
    // 머리카락/수염 (눈썹은 피부 텍스처에 그려짐)
    const hmat = hairMaterial(v.hairColor);
    headGroup.add(skullFit);
    const hg = buildHair(v.hair, C, f, v.gear === 'cap' || v.gear === 'boonie' ? 1.2 : v.gear === 'helmet' ? 1.35 : 0);
    if (v.hair && v.hair !== 'none') {
      const sg = scalpGeometry(headGeo, v, !!v.gear && v.gear !== 'headset'), hl = v.hair === 'buzz' ? 0.004 : 0.007;
      for (let i = 1; i <= 5; i++) { const sh = new THREE.Mesh(sg, shellMaterial(v.hairColor, hl, 2200, i, 5)); sh.userData.noShadow = i > 1; headGroup.add(sh); }
    }
    if (hg) { const hair = new THREE.Mesh(hg, hmat); hair.castShadow = true; skullFit.add(hair); }
    if (v.beard) {
      const bg = beardGeometry(headGeo, v);
      for (let i = 1; i <= 7; i++) { const sh = new THREE.Mesh(bg, shellMaterial(v.beardColor, v.beard === 'full' ? 0.009 : 0.0042, v.beard === 'full' ? 1400 : 2600, i, 7)); sh.userData.noShadow = i > 1; headGroup.add(sh); }
    }
    headGroup.userData = { eyes, hmat, lids };
  }
  if (!skullFit.parent) headGroup.add(skullFit);
  if (v.gear === 'helmet') skullFit.add(gearMesh('helmet', helmet, { helmet: M.helmet, rail: M.rail, headset: M.headset }, 0.0045));
  else if (v.gear === 'cap') skullFit.add(gearMesh('cap', (h) => capGear(h, false), { cap: M.cap, cap2: M.cap2, headset: M.headset }, 0.0042));
  else if (v.gear === 'boonie') skullFit.add(gearMesh('boonie', (h) => capGear(h, true), { cap: M.cap, cap2: M.cap2, headset: M.headset }, 0.0042));
  else if (v.gear === 'headset') skullFit.add(gearMesh('headset', (h) => { const S = new SDFModel([-0.13, 1.58, -0.08], [0.13, 1.78, 0.08], h); for (const s of [1, -1]) S.add(rbox([s * 0.092, 1.645, 0.0], [0.017, 0.037, 0.032], 0.014, { mat: 'headset', k: 0.004, rot: [0, 0, s * 0.08] })); S.add(torus([0, 1.665, 0.0], 0.091, 0.0055, { mat: 'headset', k: 0.003, rot: [0, 0, Math.PI / 2] })); return { S }; }, { headset: M.headset }, 0.0045));
  if (v.glasses) headGroup.add(gearMesh('glasses', sunglasses, { lens: M.lens, frame: M.frame }, 0.0024));
  headGroup.traverse((o) => { if (o.isMesh) { o.castShadow = !o.userData.noShadow; o.receiveShadow = true; } });
  attach('head', headGroup);
  root.userData = { v };
  return { root, bones: Bn, skeleton, body, boots, hands, head: headGroup, v, key };
}
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
