// 돌: 절차적 바위 메시 · 물리 바디 · 물막이 래스터화 · 물의 힘(수압/항력/부력)
import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { physState, CELL, NXV, X0, Z0, SX0, SX1, NZ, U, groundAt, centerX, floorHalf, chanW, cap, fill, ground, loose, markDirtyCell, MODE, gfr, cem, cure } from './terrain.js';
import * as W from './water.js';
import * as D from './dam.js';
import { GLSL_NOISE, rng } from './noise.js';

const perlin = new ImprovedNoise();
const T_rev = () => physState.rev;
export const stones = [];
export const byHandle = new Map();
let R, world;
const rand = rng(1234);

// ───── 재질 ─────
const PALETTE = [
  [0x8a8783, 0xb3aea6, 0x3c3a38, 0.0],
  [0x4f4e4c, 0x6d6a66, 0x23211f, 0.0],
  [0x9a8a72, 0xbfae92, 0x5a4a3a, 0.0],
  [0x6f7479, 0x9198a0, 0x2f3236, 0.0],
  [0x7b7a72, 0xa29f94, 0x3a3833, 1.0],
  [0x8d837c, 0xaaa198, 0x4a3f3a, 0.5],
];
function stoneMaterial([c1, c2, c3, moss]) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, {
      uC1: { value: new THREE.Color(c1) }, uC2: { value: new THREE.Color(c2) }, uC3: { value: new THREE.Color(c3) }, uMoss: { value: moss },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvOP=position; vWP=(modelMatrix*vec4(transformed,1.)).xyz; vWN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vWP; varying vec3 vWN; uniform vec3 uC1,uC2,uC3; uniform float uMoss, uTime, uRain; uniform vec3 uSunCol, uSunDir;\n' + GLSL_NOISE)
      .replace('#include <map_fragment>', /* glsl */`
        float sDet = 1. - smoothstep(0.008, 0.035, length(fwidth(vWP)));
        float fade = (1. - smoothstep(4., 25., length(vViewPosition))) * sDet;
        #ifdef LITE
        float n1 = vnoise3(vOP*2.6), n2 = vnoise3(vOP*17.), n3 = 0.5;
#else
        float n1 = fbm3(vOP*2.6), n2 = vnoise3(vOP*17.), n3 = mix(0.5, vnoise3(vOP*60.), fade);
#endif
        vec3 alb = mix(uC1, uC2, smoothstep(0.25,0.75,n1));
        alb *= 0.86 + 0.22*n2;
        alb = mix(alb, uC3, smoothstep(0.78, 0.9, n3)*0.35);
        alb = mix(alb, vec3(0.86,0.84,0.8), smoothstep(0.84, 0.95, vnoise3(vOP*45.+3.))*0.3*fade);
        #ifdef LITE
        float vein = 0.;
#else
        float vein = smoothstep(0.02, 0.0, abs(fbm3(vOP*1.4+7.)-0.5)) * smoothstep(0.55, 0.7, vnoise3(vOP*0.9+11.));
#endif
        alb = mix(alb, vec3(0.8,0.78,0.74), vein*0.35);
        vec3 WN = normalize(vWN);
        float mossA = uMoss * smoothstep(0.35,0.85,WN.y) * smoothstep(0.42,0.62, vnoise3(vOP*3.3+2.)*0.7 + vnoise3(vOP*7.+1.)*0.3);
        alb = mix(alb, mix(vec3(0.16,0.25,0.06), vec3(0.30,0.36,0.10), n2), mossA);
        alb = mix(alb, vec3(0.62,0.66,0.48), smoothstep(0.7,0.82,vnoise3(vOP*5.+9.))*0.35*(1.-mossA));
        float sH = n1*0.025 + n2*0.005*fade + n3*0.0012 + mossA*vnoise3(vOP*90.)*0.002*fade - vein*0.002;
        vec4 wd = waterAt(vWP.xz); float under = wd.r - vWP.y;
        float wet = clamp(max(smoothstep(-0.05, 0.0, under), wd.b*smoothstep(0.25,0.0,vWP.y-wd.r)*0.7) + uRain*0.6, 0., 1.);
        alb *= mix(1., 0.48, wet);
        alb = mix(alb, alb*vec3(0.78,0.92,0.88), smoothstep(0.,0.3,under));
        float sRough = mix(mix(0.78, 0.95, mossA), 0.16, wet*(1.-mossA*0.6));
        float sCaus = 0.;
#ifndef LITE
        if (under > 0.) sCaus = caustic(vWP.xz, uTime)*smoothstep(0.,0.05,under)*exp(-under*1.6)*max(WN.y,0.)*max(uSunDir.y,0.);
#endif
        diffuseColor.rgb *= alb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <normal_fragment_maps>', 'normal = bumpN(-vViewPosition, normal, sH, mix(0.3, 1., sDet));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * sCaus * uSunCol * 0.9;');
  };
  return m;
}
export const mats = PALETTE.map(stoneMaterial);
// 페인트 칠한 돌: 색마다 젖은(반짝)·마른 재질 하나씩
export const paintMats = []; const paintCache = new Map();
function paintMat(hex, wet) {
  const key = hex + (wet ? 'w' : 'd'); if (paintCache.has(key)) return paintCache.get(key);
  const c = new THREE.Color(hex), m = stoneMaterial([c.clone().multiplyScalar(0.8).getHex(), hex, c.clone().lerp(new THREE.Color(1, 1, 1), 0.15).getHex(), 0]);
  m.roughness = wet ? 0.12 : 0.62; m.defines = { ...(mats[0].defines || {}) }; m.customProgramCacheKey = () => 'paint' + key;
  paintCache.set(key, m); paintMats.push(m); return m;
}
export function paint(st, hex, wet = true) { st.paint = hex; st.paintWet = wet ? 1 : 0; st.mesh.material = paintMat(hex, wet); }
export function paintStep(dg) { for (const st of stones) if (st.paintWet > 0 && (st.paintWet -= dg / 40) <= 0) { st.paintWet = 0; st.mesh.material = paintMat(st.paint, false); } }
// 시멘트에 박혀 굳은 돌은 움직이지 않는다
export function cementCheck() {
  let n = 0;
  for (const st of stones) {
    if (st.fixed || st.held || st.cy === undefined) continue;
    const v = st.body.linvel(); if (v.x * v.x + v.y * v.y + v.z * v.z > 0.01) continue;
    const bot = st.cy - st.hy, rr = st.rb * 0.7;
    let hard = 0, tot = 0;
    for (let dz = -rr; dz <= rr + 1e-6; dz += rr) for (let dx = -rr; dx <= rr + 1e-6; dx += rr) {
      const i = Math.round((st.cx + dx - X0) / CELL), j = Math.round((st.cz + dz - Z0) / CELL); if (i < 1 || j < 1 || j >= NZ) continue;
      const k = j * NXV + i; tot++;
      const top = ground[k] + fill[k] + cap[k]; // 시멘트 면 높이
      if (cem[k] * cure[k] > 0.5 && top > bot + 0.03) hard++;
    }
    if (tot && hard >= 2) { st.body.setBodyType(R.RigidBodyType.Fixed, true); st.fixed = true; st.cemented = true; needRaster = true; n++; }
  }
  return n;
}

// ───── 바위 형상 ─────
function rockGeometry(r, seed, detail) {
  const rr = rng(seed);
  const a = r * (0.9 + rr() * 0.35), b = r * (0.45 + rr() * 0.4), c = r * (0.75 + rr() * 0.3);
  const angular = rr() < 0.45;
  const cuts = [];
  if (angular) for (let n = 0; n < 4; n++) {
    const v = new THREE.Vector3(rr() * 2 - 1, rr() * 2 - 1, rr() * 2 - 1).normalize();
    cuts.push([v, 0.62 + rr() * 0.25]);
  }
  const so = rr() * 100;
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let d = 1 + 0.16 * perlin.noise(v.x * 1.3 + so, v.y * 1.3, v.z * 1.3) + 0.05 * perlin.noise(v.x * 4 + so, v.y * 4, v.z * 4) + 0.015 * perlin.noise(v.x * 11, v.y * 11 + so, v.z * 11);
    v.multiplyScalar(d);
    for (const [n, off] of cuts) { const t = v.dot(n); if (t > off) v.addScaledVector(n, -(t - off) * 0.85); }
    if (v.y < -0.55) v.y = -0.55 - (v.y + 0.55) * 0.3; // 바닥 약간 평평
    p.setXYZ(i, v.x * a, v.y * b, v.z * c);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const ext = [Math.max(-bb.min.x, bb.max.x), Math.max(-bb.min.y, bb.max.y), Math.max(-bb.min.z, bb.max.z)];
  return { g, ext };
}

let lowPoly = false;
export function initPhysics(RAPIER, w, low) { R = RAPIER; world = w; lowPoly = !!low; }
// 큰 바위: 평소엔 고정된 지형처럼 있다가 손으로 잡으면 움직이는 돌이 된다
export function makeDynamic(st) {
  if (!st.fixed) return;
  st.body.setBodyType(R.RigidBodyType.Dynamic, true);
  st.body.setLinearDamping(0.1); st.body.setAngularDamping(0.6);
  st.body.setAdditionalMass(0, true);
  st.fixed = false; needRaster = true;
}
let needRaster = true, lastRev = -1;
export function touch() { needRaster = true; }

export function addStone(x, y, z, r, opts = {}) {
  const seed = opts.seed ?? ((rand() * 1e9) | 0);
  const detail = (r > 0.5 ? 5 : r > 0.2 ? 4 : 3) - (lowPoly ? 1 : 0);
  const { g, ext } = rockGeometry(r, seed, detail);
  const matIdx = opts.mat ?? Math.floor(rand() * mats.length), mat = mats[matIdx];
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.layers.enable(1);
  const yaw = rand() * Math.PI * 2;
  const q = opts.q ? new THREE.Quaternion(...opts.q) : new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * (opts.fixed ? 0.3 : 0.2), yaw, (rand() - 0.5) * 0.2));
  const fixed = !!opts.fixed;
  const bd = (fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic().setLinearDamping(0.08).setAngularDamping(0.5).setCcdEnabled(true))
    .setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  const body = world.createRigidBody(bd);
  const pts = g.attributes.position.array;
  let cd = R.ColliderDesc.convexHull(new Float32Array(pts)) || R.ColliderDesc.ball(r);
  cd.setDensity(2400).setFriction(0.85).setRestitution(0.06);
  const vol = 4 / 3 * Math.PI * ext[0] * ext[1] * ext[2] * 0.8;
  cd.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(vol * 2400 * 9.81 * 6 + 60);
  const collider = world.createCollider(cd, body);
  mesh.position.set(x, y, z); mesh.quaternion.copy(q);
  const st = { mesh, body, collider, ext: ext.map(e => e * 1.04), r, fixed, vol, mass: fixed ? vol * 2400 : body.mass(), boulder: fixed, lastHit: 0, above: true, surf: -100, held: false, moved: false, seed, matIdx };
  stones.push(st); byHandle.set(collider.handle, st);
  return st;
}

export function removeStone(st) {
  world.removeRigidBody(st.body);
  byHandle.delete(st.collider.handle);
  const i = stones.indexOf(st); if (i >= 0) stones.splice(i, 1);
  st.mesh.parent?.remove(st.mesh); st.mesh.geometry.dispose();
  needRaster = true;
}
// 곡괭이로 깨기: 부피를 나눠 2~4개 조각 돌로 쪼갠다 (아주 작은 돌은 부스러져 사라짐)
export function split(st, dir, player) {
  const t = st.body.translation(), parent = st.mesh.parent, out = [];
  if (st.r < 0.09) { removeStone(st); return out; }
  const n = st.r > 0.5 ? 4 : st.r > 0.22 ? 3 : 2;
  const rr = st.r * Math.cbrt(1 / n) * 0.92;
  // 조각끼리 겹치지 않는 거리 (겹치면 물리엔진이 서로 세게 밀어내 날아가 버림)
  const d = rr * 1.12 / Math.sin(Math.PI / n);
  let a0 = rand() * 6.283;
  if (player) a0 = Math.atan2(player.z - t.z, player.x - t.x) + Math.PI / n; // 플레이어 쪽으로는 조각을 두지 않는다
  const paintHex = st.paint, wet = st.paintWet > 0;
  removeStone(st);
  for (let i = 0; i < n; i++) {
    const a = a0 + i / n * 6.283, fr = rr * (0.9 + rand() * 0.1);
    let fx = t.x + Math.cos(a) * d, fz = t.z + Math.sin(a) * d;
    if (player) { const px = fx - player.x, pz = fz - player.z, pd = Math.hypot(px, pz), need = 0.36 + fr * 1.1; if (pd < need) { fx = player.x + px / (pd || 1) * need; fz = player.z + pz / (pd || 1) * need; } }
    let gy = groundAt(fx, fz); for (const [ox, oz] of [[fr, 0], [-fr, 0], [0, fr], [0, -fr]]) gy = Math.max(gy, groundAt(fx + ox, fz + oz));
    const f = addStone(fx, Math.max(t.y, gy + fr * 1.08), fz, fr, { mat: st.matIdx });
    if (paintHex) paint(f, paintHex, wet);
    parent.add(f.mesh);
    f.body.setLinvel({ x: Math.cos(a) * 0.35 + dir.x * 0.25, y: 0.3, z: Math.sin(a) * 0.35 + dir.z * 0.25 }, true);
    f.body.setAngvel({ x: (rand() - 0.5) * 1.5, y: (rand() - 0.5) * 1.5, z: (rand() - 0.5) * 1.5 }, true);
    f.quiet = performance.now() + 1200; // 막 생긴 조각의 충돌로 땅이 패이지 않게
    f.moved = true; out.push(f);
  }
  return out;
}
// 돌이 너무 많아지면 멀리 있는 작은 돌부터 치운다 (성능 유지)
export function trim(max, cam) {
  if (stones.length <= max) return;
  const cand = stones.filter(s => !s.held && !s.boulder).sort((a, b) => (a.r - b.r) * 4 - (((a.cx - cam.x) ** 2 + (a.cz - cam.z) ** 2) - ((b.cx - cam.x) ** 2 + (b.cz - cam.z) ** 2)) * 0.01);
  for (const st of cand) { if (stones.length <= max) break; removeStone(st); }
}
export function spawnAll(group, count, nBoulders = 18, keepOut = []) {
  const placed = keepOut.map(([x, z, r]) => [x, z, r]); // 집터·가로등 자리는 비워 둔다
  const free = (x, z, r) => placed.every(([px, pz, pr]) => (px - x) ** 2 + (pz - z) ** 2 > (pr + r + 0.05) ** 2);
  // 고정 큰 바위
  for (let n = 0, tries = 0; n < nBoulders && tries < 500; tries++) {
    const sea = MODE === 'sea', z = sea ? 12 + rand() * 48 : 7.5 + rand() * 57, F = floorHalf(z), side = rand() < 0.5 ? -1 : 1;
    let x = sea ? (rand() * 2 - 1) * 7.6 : centerX(z) + side * (n < 4 ? chanW(z) * (0.6 + rand() * 0.6) : F * (0.5 + rand() * 0.4)); // 바닥 위에만 (벽에 뜨지 않게)
    const r = n < 4 ? 0.55 + rand() * 0.3 : 0.6 + rand() * 0.9;
    if (!free(x, z, r)) continue;
    placed.push([x, z, r]);
    let gy = groundAt(x, z), gmin = gy;
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, r * 0.7]]) gmin = Math.min(gmin, groundAt(x + ox, z + oz));
    if (gy - gmin > r * 0.45) continue;
    const st = addStone(x, gmin + r * 0.22, z, r, { fixed: true, mat: [0, 1, 4, 5][n % 4] });
    group.add(st.mesh); n++;
  }
  // 주울 수 있는 돌
  for (let n = 0, tries = 0; n < count && tries < count * 30; tries++) {
    const nearDam = rand() < 0.45;
    const z = MODE === 'sea' ? 18 + rand() * 36 : nearDam ? (rand() < 0.5 ? 10 : 46) + rand() * 9 : 7.5 + rand() * 57;
    const F = floorHalf(z);
    const x = centerX(z) + (rand() * 2 - 1) * F * 0.92;
    const r = 0.1 + 0.24 * Math.pow(rand(), 1.5);
    if (!free(x, z, r)) continue;
    placed.push([x, z, r]);
    const st = addStone(x, groundAt(x, z) + r + 0.05, z, r);
    group.add(st.mesh); n++;
  }
}

// ───── 물막이 래스터화 ─────
const _q = new THREE.Quaternion(), _m = new THREE.Matrix3(), _e = new THREE.Matrix4();
const order = [];
const KG = 0.12; // 자갈 투수계수 (흙 0.02 · 돌무더기 0.25 사이)
const matKp = k => (W.KS * (1 - gfr[k]) + KG * gfr[k]) * (1 - Math.min(1, cem[k] * cure[k] * 1.6));
export function rasterize(force) {
  if (!force && !needRaster && T_rev() === lastRev) return false;
  needRaster = false; lastRev = T_rev();
  W.beginSolid();
  order.length = 0;
  for (const st of stones) {
    const t = st.body.translation(), r = st.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _e.makeRotationFromQuaternion(_q); const e = _e.elements; // column-major
    const [a, b, c] = st.ext, s0 = 1 / (a * a), s1 = 1 / (b * b), s2 = 1 / (c * c);
    // M = R diag(s) R^T
    const R00 = e[0], R10 = e[1], R20 = e[2], R01 = e[4], R11 = e[5], R21 = e[6], R02 = e[8], R12 = e[9], R22 = e[10];
    const M = st.M || (st.M = new Float64Array(6));
    M[0] = R00 * R00 * s0 + R01 * R01 * s1 + R02 * R02 * s2; // xx
    M[1] = R10 * R10 * s0 + R11 * R11 * s1 + R12 * R12 * s2; // yy
    M[2] = R20 * R20 * s0 + R21 * R21 * s1 + R22 * R22 * s2; // zz
    M[3] = R00 * R10 * s0 + R01 * R11 * s1 + R02 * R12 * s2; // xy
    M[4] = R10 * R20 * s0 + R11 * R21 * s1 + R12 * R22 * s2; // yz
    M[5] = R00 * R20 * s0 + R01 * R21 * s1 + R02 * R22 * s2; // xz
    st.hy = Math.sqrt(R10 * R10 * a * a + R11 * R11 * b * b + R12 * R12 * c * c);
    st.cx = t.x; st.cy = t.y; st.cz = t.z; st.rb = Math.max(a, b, c);
    order.push(st);
  }
  order.sort((p, q) => (p.cy - p.hy) - (q.cy - q.hy));
  for (let pass = 0; pass < 2; pass++) for (const st of order) {
    const M = st.M, rb = st.rb;
    const i0 = Math.max(SX0, Math.ceil((st.cx - rb - X0) / CELL)), i1 = Math.min(SX1 - 1, Math.floor((st.cx + rb - X0) / CELL));
    const j0 = Math.max(0, Math.ceil((st.cz - rb - Z0) / CELL)), j1 = Math.min(NZ, Math.floor((st.cz + rb - Z0) / CELL));
    for (let j = j0; j <= j1; j++) {
      const dz = Z0 + j * CELL - st.cz;
      for (let i = i0; i <= i1; i++) {
        const dx = X0 + i * CELL - st.cx;
        const B = M[3] * dx + M[4] * dz, C = M[0] * dx * dx + 2 * M[5] * dx * dz + M[2] * dz * dz - 1;
        const disc = B * B - M[1] * C; if (disc <= 0) continue;
        const sq = Math.sqrt(disc), bot = st.cy + (-B - sq) / M[1], top = st.cy + (-B + sq) / M[1];
        const k = j * NXV + i;
        if (pass === 0 && bot < W.sBot[k]) W.sBot[k] = bot;
        if (bot <= W.solid[k] + 0.12 && top > W.solid[k]) W.solid[k] = top;
      }
    }
  }
  D.rasterize();
  // 돌 위의 흙: 돌이 사라지면 바닥으로 떨어지고, 돌이 움직이면 같이 움직인다
  for (let j = 0; j <= NZ; j++) for (let i = SX0; i < SX1; i++) {
    const k = j * NXV + i;
    if (W.sBot[k] < 1e8 && W.solid[k] > ground[k] + 0.01) {
      // 돌 기둥: (돌 밑 흙) + (틈을 메운 진흙: 느리게) + (빈 틈: 빠르게) 로 물이 스며 흐른다
      const top = W.solid[k], lz = Math.min(loose[k], 0.5), mud = Math.min(fill[k], top - ground[k]), open = Math.max(0, top - ground[k] - mud);
      W.ptop[k] = top; W.seal[k] = ground[k] - lz;
      W.kp[k] = (matKp(k) * (lz + mud) + W.getKP() * open) / Math.max(1e-4, lz + mud + open);
    } else if (loose[k] > 0.02) { // 부어 놓은 흙더미도 물이 스민다 (자갈은 잘 스미고, 굳은 시멘트는 안 스민다)
      W.ptop[k] = ground[k]; W.seal[k] = ground[k] - Math.min(loose[k], 0.5); W.kp[k] = matKp(k);
    } else W.kp[k] = 0;
    if (W.sBot[k] >= 1e8 && fill[k] > 0) { const v = fill[k] * 0.38; fill[k] = 0; ground[k] += v; loose[k] += v; W.solid[k] = W.seal[k] = W.ptop[k] = ground[k]; markDirtyCell(i, j, true); }
    if (W.dam[k]) { W.ptop[k] = W.seal[k] = W.solid[k]; W.kp[k] = 0; }
    const c = cap[k]; if (c <= 0) continue;
    if (W.sBot[k] > 1e8) { cap[k] = 0; ground[k] += c; loose[k] += c; W.solid[k] = W.seal[k] = W.ptop[k] = ground[k]; markDirtyCell(i, j, true); continue; }
    W.solid[k] += c;
    if (Math.abs(W.solid[k] - lastVis[k]) > 0.01) { lastVis[k] = W.solid[k]; markDirtyCell(i, j); }
  }
}
const lastVis = new Float32Array(W.solid.length);

// ───── 물이 돌에 주는 힘 ─────
const DIRS = Array.from({ length: 8 }, (_, n) => [Math.cos(n * Math.PI / 4), Math.sin(n * Math.PI / 4)]);
export function waterForces(cb) {
  for (const st of stones) {
    if (st.fixed || st.held) continue;
    const bot = st.cy - st.hy, top = st.cy + st.hy, Rh = Math.max(st.ext[0], st.ext[2]);
    let fx = 0, fz = 0, wetN = 0, sv = 0, svx = 0, svz = 0;
    for (const [dx, dz] of DIRS) {
      const s = W.sample(st.cx + dx * (Rh + 0.12), st.cz + dz * (Rh + 0.12));
      if (!s || s.h < 0.01) continue;
      const d = Math.min(Math.max(s.surf - bot, 0), top - bot);
      fx -= dx * d * d; fz -= dz * d * d; wetN++; sv += s.surf; svx += s.vx; svz += s.vz;
    }
    const wasAbove = st.above;
    if (!wetN) { st.above = true; st.surf = -100; if (st.forced) { st.body.resetForces(false); st.forced = false; } continue; }
    const surf = sv / wetN; st.surf = surf;
    const sub = Math.min(1, Math.max(0, (surf - bot) / (top - bot)));
    const lv = st.body.linvel();
    st.above = bot > surf;
    if (wasAbove && !st.above && lv.y < -1.2 && cb) cb(st, -lv.y, surf);
    const P = 1000 * 9.81 * 0.5 * (2 * Math.PI * Rh / 8) * 0.6;
    fx *= P; fz *= P;
    const rx = svx / wetN - lv.x, rz = svz / wetN - lv.z, rs = Math.hypot(rx, rz);
    const Ad = 2 * Rh * (top - bot) * sub, Fd = 0.5 * 1000 * 0.9 * Ad * rs;
    fx += Fd * rx; fz += Fd * rz;
    const fy = 1000 * 9.81 * st.vol * sub;
    const fh = Math.hypot(fx, fz), wake = fh > st.mass * 9.81 * 0.3;
    st.body.resetForces(false);
    if (st.body.isSleeping() && !wake) { st.forced = false; continue; }
    st.body.addForce({ x: fx, y: fy, z: fz }, wake);
    st.forced = true;
  }
}

export function sync() {
  for (const st of stones) {
    if (st.fixed || st.body.isSleeping()) continue;
    needRaster = true;
    const t = st.body.translation(), r = st.body.rotation();
    st.mesh.position.set(t.x, t.y, t.z); st.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    if (t.y < -20) { st.body.setTranslation({ x: 0, y: 8, z: 30 }, true); st.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
  }
}

// 선택 외곽선
const outline = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xfff3c4, side: THREE.BackSide, transparent: true, opacity: 0.55, depthWrite: false }));
outline.visible = false; outline.renderOrder = 2;
export function outlineMesh() { return outline; }
export function setHighlight(st) {
  if (!st) { outline.visible = false; return; }
  outline.visible = true; outline.geometry = st.mesh.geometry;
  outline.position.copy(st.mesh.position); outline.quaternion.copy(st.mesh.quaternion);
  outline.scale.setScalar(1 + 0.035 / st.r * 0.3 + 0.04);
}

// ───── 저장 / 불러오기 ─────
export function serialize() {
  return stones.map(st => {
    const t = st.body.translation(), r = st.body.rotation();
    return [st.seed, +st.r.toFixed(4), st.matIdx, st.boulder ? 1 : 0, st.fixed ? 1 : 0, +t.x.toFixed(3), +t.y.toFixed(3), +t.z.toFixed(3), +r.x.toFixed(4), +r.y.toFixed(4), +r.z.toFixed(4), +r.w.toFixed(4), st.paint || 0, st.cemented ? 1 : 0];
  });
}
export function restore(list, group) {
  for (const [seed, r, mat, boulder, fixed, x, y, z, qx, qy, qz, qw, pnt, cmt] of list) {
    const st = addStone(x, y, z, r, { seed, mat, fixed: !!fixed, q: [qx, qy, qz, qw] });
    if (pnt) paint(st, pnt, false); if (cmt) st.cemented = true;
    if (boulder) { st.boulder = true; if (!fixed) st.mass = st.vol * 2400; }
    st.moved = true; group.add(st.mesh);
  }
}
