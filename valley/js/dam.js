// 콘크리트 댐 블록 · 큰 댐 자동 건설 · 수력발전 터빈
import * as THREE from 'three';
import { CELL, NXV, X0, Z0, SX0, SX1, NZ, U, groundAt, centerX, floorHalf } from './terrain.js';
import * as W from './water.js';
import { GLSL_NOISE } from './noise.js';

export const blocks = [];
export const byHandle = new Map();
let R, world, group;
const BW = 1.6, BD = 0.8, BH = 1.2; // 손으로 놓는 블록 (길이·두께·높이, m)

function concreteMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0xb2b0a8, roughness: 0.88 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP2;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP2 = (modelMatrix * vec4(transformed, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP2;\n' + GLSL_NOISE)
      .replace('#include <map_fragment>', `
        float cn = vnoise3(vWP2 * 3.1) * 0.6 + vnoise3(vWP2 * 13.) * 0.4;
        vec3 cc = mix(vec3(0.56, 0.55, 0.52), vec3(0.72, 0.71, 0.67), cn);
        cc *= 1. - smoothstep(0.012, 0., abs(fract(vWP2.y / 0.4) - 0.5) - 0.488) * 0.25; // 거푸집 줄눈
        vec4 wd = waterAt(vWP2.xz); float under = wd.r - vWP2.y;
        float wet = clamp(smoothstep(-0.06, 0., under) + wd.b * 0.3, 0., 1.);
        cc *= mix(1., 0.6, wet); cc = mix(cc, cc * vec3(0.78, 0.9, 0.86), smoothstep(0., 0.3, under));
        diffuseColor.rgb *= cc;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, clamp(smoothstep(-0.06, 0., waterAt(vWP2.xz).r - vWP2.y), 0., 1.));');
  };
  return m;
}
const MAT = concreteMat();
const metal = new THREE.MeshStandardMaterial({ color: 0x5d6b73, roughness: 0.4, metalness: 0.8 });
const accent = new THREE.MeshStandardMaterial({ color: 0xe0a92e, roughness: 0.5, metalness: 0.3 });
const geoCache = new Map();
const boxGeo = (w, h, d) => { const k = `${w.toFixed(2)}|${h.toFixed(2)}|${d.toFixed(2)}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d)); return geoCache.get(k); };

export function init(RAPIER, w, g) { R = RAPIER; world = w; group = g; }

// 블록 하나 만들기 (anim: 땅속에서 솟아오르는 건설 애니메이션 시간, 초)
export function addBlock({ x, z, yaw, y0, w = BW, h = BH, d = BD, anim = 0, delay = 0, big = false }) {
  const b = { x, z, yaw, y0, y1: y0 + h, w, h, d, hp: big ? 12 : 4, turbine: null, big, t: anim ? -delay : 1, anim };
  b.mesh = new THREE.Mesh(boxGeo(w, h, d), MAT);
  b.mesh.rotation.y = yaw; b.mesh.castShadow = b.mesh.receiveShadow = true; b.mesh.layers.enable(1);
  b.mesh.position.set(x, anim ? y0 - h / 2 - 0.05 : y0 + h / 2, z);
  group.add(b.mesh);
  if (!anim) finish(b);
  blocks.push(b); blocks.sort((p, q) => p.y0 - q.y0);
  return b;
}
function finish(b) {
  b.mesh.position.y = b.y0 + b.h / 2;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(b.x, b.y0 + b.h / 2, b.z).setRotation({ x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) }));
  b.collider = world.createCollider(R.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setFriction(0.9), body); b.body = body;
  byHandle.set(b.collider.handle, b);
  b.ready = true;
}

// 조준한 곳에 블록 놓기: 다른 블록 위를 겨누면 그 위에 쌓고, 옆을 겨누면 이어 붙인다
export function place(point, yaw, hitBlock, normal) {
  let x = point.x, z = point.z, y0, ry = yaw;
  if (hitBlock) {
    ry = hitBlock.yaw;
    if (normal && normal.y > 0.7) { x = hitBlock.x; z = hitBlock.z; y0 = hitBlock.y1; }
    else {
      const ax = Math.cos(ry), az = -Math.sin(ry);
      const side = (point.x - hitBlock.x) * ax + (point.z - hitBlock.z) * az >= 0 ? 1 : -1;
      const step = (hitBlock.w + BW) / 2;
      x = hitBlock.x + ax * step * side; z = hitBlock.z + az * step * side; y0 = hitBlock.y0;
    }
  }
  if (y0 === undefined) y0 = footMin(x, z, ry, BW, BD) - 0.25; // 땅 위: 가장 낮은 곳보다 조금 묻어 틈이 없게
  if (blocks.some(b => Math.hypot(b.x - x, b.z - z) < 0.3 && Math.abs(b.y0 - y0) < 0.3)) return null;
  return addBlock({ x, z, yaw: ry, y0 });
}
function footMin(x, z, ry, w, d) {
  let gmin = 1e9; const c = Math.cos(ry), s = Math.sin(ry);
  for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0], [0, -0.5], [0, 0.5]]) {
    const lx = u * w, lz = v * d; gmin = Math.min(gmin, groundAt(x + lx * c + lz * s, z - lx * s + lz * c));
  }
  return gmin;
}
export function remove(b) {
  if (b.turbine) toggleTurbine(b);
  if (b.body) { world.removeRigidBody(b.body); byHandle.delete(b.collider.handle); }
  group.remove(b.mesh); blocks.splice(blocks.indexOf(b), 1);
}

// ───── 큰 댐 자동 건설: 계곡을 가로질러 높이 3 m 짜리 댐을 가운데부터 차례로 솟아오르게 ─────
export function bigDam(zc) {
  const cx = centerX(zc), bottom = groundAt(cx, zc), crest = bottom + 3.2, d = 2.4, w = 2.0, out = [];
  // 양쪽으로 벽에 닿을 때까지(땅이 마루보다 높아질 때까지) 블록을 늘어놓는다
  for (const side of [1, -1]) for (let n = side > 0 ? 0 : 1; n < 14; n++) {
    const x = cx + side * n * w; const g = footMin(x, zc, 0, w, d);
    if (g > crest - 0.3) { // 벽에 박히는 마지막 블록
      out.push({ x, g, last: true }); break;
    }
    out.push({ x, g });
  }
  out.sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx));
  const made = [];
  out.forEach((o, i) => {
    const y0 = o.g - 0.6, h = Math.max(1, crest - y0);
    made.push(addBlock({ x: o.x, z: zc, yaw: 0, y0, w, h, d, anim: 0.9, delay: i * 0.28, big: true }));
  });
  return { blocks: made, duration: out.length * 0.28 + 1, crest, cx };
}

// 물막이: 회전된 직사각형 안 칸은 블록 윗면까지 막히고, 콘크리트라 물이 스미지 않는다
export function rasterize() {
  for (const b of blocks) {
    if (!b.ready) continue;
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), rr = Math.hypot(b.w, b.d) / 2 + CELL;
    const i0 = Math.max(SX0, Math.ceil((b.x - rr - X0) / CELL)), i1 = Math.min(SX1 - 1, Math.floor((b.x + rr - X0) / CELL));
    const j0 = Math.max(0, Math.ceil((b.z - rr - Z0) / CELL)), j1 = Math.min(NZ, Math.floor((b.z + rr - Z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = X0 + i * CELL - b.x, dz = Z0 + j * CELL - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) > b.w / 2 + CELL * 0.5 || Math.abs(lz) > b.d / 2 + CELL * 0.5) continue;
      const k = j * NXV + i;
      if (b.y0 <= W.solid[k] + 0.3 && b.y1 > W.solid[k]) W.solid[k] = b.y1;
      W.dam[k] = 1; if (b.y0 < W.sBot[k]) W.sBot[k] = b.y0;
    }
  }
}

// 터빈: 블록 양쪽 수위를 비교해 높은 쪽을 취수구, 낮은 쪽을 방수구로 잇는다
const cellsAt = (x, z) => {
  const ci = Math.round((x - X0) / CELL), cj = Math.round((z - Z0) / CELL), out = [];
  for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) if (i >= SX0 && i < SX1 && j >= 0 && j <= NZ) out.push(j * NXV + i);
  return out;
};
export function toggleTurbine(b, forceSign) {
  if (b.turbine) {
    W.pipes.splice(W.pipes.indexOf(b.turbine.pipe), 1);
    group.remove(b.turbine.vis); b.turbine = null; return false;
  }
  const nx = Math.sin(b.yaw), nz = Math.cos(b.yaw), off = b.d / 2 + 0.45;
  const pA = [b.x + nx * off, b.z + nz * off], pB = [b.x - nx * off, b.z - nz * off];
  let sign = forceSign;
  if (!sign) { const sa = W.sample(pA[0], pA[1]), sb = W.sample(pB[0], pB[1]); sign = (sb?.surf ?? -1e9) > (sa?.surf ?? -1e9) ? -1 : 1; }
  const up = sign > 0 ? pA : pB, dn = sign > 0 ? pB : pA;
  const a = cellsAt(up[0], up[1]), bb = cellsAt(dn[0], dn[1]);
  if (!a.length || !bb.length) return false;
  const pipe = { a, b: bb, area: b.big ? 0.2 : 0.06, Q: 0, head: 0, P: 0 };
  W.pipes.push(pipe);
  const k = b.big ? 1.8 : 1; // 큰 댐은 발전기도 크게
  const vis = new THREE.Group();
  const gen = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * k, 0.28 * k, 0.5 * k, 16).rotateZ(Math.PI / 2), metal);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.29 * k, 0.29 * k, 0.08 * k, 16).rotateZ(Math.PI / 2), accent);
  const wheel = new THREE.Group();
  for (let n = 0; n < 6; n++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.04 * k, 0.5 * k, 0.12 * k), metal); bl.rotation.x = n / 6 * Math.PI; wheel.add(bl); }
  const pipeM = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * k, 0.13 * k, b.d + 0.9, 12).rotateX(Math.PI / 2), metal);
  gen.position.set(0, 0.55 * k, -sign * (b.d / 2 + 0.3 * k)); cap.position.copy(gen.position); cap.position.x = 0.27 * k;
  wheel.position.set(0, 0.12 * k, -sign * (b.d / 2 + 0.35 * k)); pipeM.position.set(0, 0.12 * k, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05 * k, 10, 8), new THREE.MeshStandardMaterial({ color: 0x223322, emissive: 0x33ff88, emissiveIntensity: 0 }));
  lamp.position.set(0, 0.86 * k, -sign * (b.d / 2 + 0.3 * k));
  vis.add(gen, cap, wheel, pipeM, lamp);
  vis.traverse(o => { o.castShadow = true; });
  vis.position.set(b.x, b.y0 + (b.big ? 0.75 : 0.25), b.z); vis.rotation.y = b.yaw;
  group.add(vis);
  b.turbine = { pipe, vis, wheel, lamp, out: dn, sign };
  return true;
}

let dust = null;
export function update(dt, fx, dirt) {
  for (const b of blocks) {
    if (!b.ready) { // 건설 애니메이션: 흙먼지를 일으키며 땅속에서 솟아오른다
      b.t += dt;
      if (b.t < 0) continue;
      const k = Math.min(1, b.t / b.anim), e = 1 - Math.pow(1 - k, 3);
      b.mesh.position.y = b.y0 - b.h / 2 - 0.05 + (b.h + 0.05) * e;
      if (dirt && Math.random() < 0.5) dirt(b.x + (Math.random() - 0.5) * b.w, groundAt(b.x, b.z) + 0.1, b.z + (Math.random() - 0.5) * b.d, 3);
      if (k >= 1) { finish(b); b.justDone = true; }
      continue;
    }
    const t = b.turbine; if (!t) continue;
    t.wheel.rotation.x += dt * t.pipe.Q * 60;
    t.lamp.material.emissiveIntensity = t.pipe.P > 30 ? 2.5 : 0;
    if (fx && t.pipe.Q > 0.01 && Math.random() < 0.6) fx(t.out[0], groundAt(t.out[0], t.out[1]) + 0.3, t.out[1], Math.min(1, t.pipe.Q * 4));
  }
}
export const building = () => blocks.some(b => !b.ready);
export const power = () => W.pipes.reduce((s, p) => s + p.P, 0); // W

// ───── 저장 / 불러오기 ─────
export function serialize() {
  return blocks.filter(b => b.ready).map(b => ({ x: b.x, z: b.z, yaw: b.yaw, y0: b.y0, w: b.w, h: b.h, d: b.d, big: b.big, tb: b.turbine ? b.turbine.sign : 0 }));
}
export function restore(list) {
  for (const o of list || []) { const b = addBlock(o); if (o.tb) toggleTurbine(b, o.tb); }
}
