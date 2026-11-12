// 콘크리트 댐 블록 + 수력발전 터빈
import * as THREE from 'three';
import { CELL, NXV, X0, Z0, SX0, SX1, NZ, U, groundAt } from './terrain.js';
import * as W from './water.js';
import { GLSL_NOISE } from './noise.js';

export const blocks = [];
export const byHandle = new Map();
let R, world, group;
const BW = 1.6, BD = 0.8, BH = 1.2; // 블록 크기 (길이·두께·높이, m)

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
const GEO = new THREE.BoxGeometry(BW, BH, BD);
const metal = new THREE.MeshStandardMaterial({ color: 0x5d6b73, roughness: 0.4, metalness: 0.8 });
const accent = new THREE.MeshStandardMaterial({ color: 0xe0a92e, roughness: 0.5, metalness: 0.3 });

export function init(RAPIER, w, g) { R = RAPIER; world = w; group = g; }

// 조준한 곳에 블록 놓기: 다른 블록 위를 겨누면 그 위에 쌓고, 옆을 겨누면 이어 붙인다
export function place(point, yaw, hitBlock, normal) {
  let x = point.x, z = point.z, y0, ry = yaw;
  if (hitBlock) {
    ry = hitBlock.yaw;
    if (normal && normal.y > 0.7) { x = hitBlock.x; z = hitBlock.z; y0 = hitBlock.y1; }
    else {
      const ax = Math.cos(ry), az = -Math.sin(ry); // 블록 길이 방향
      const side = (point.x - hitBlock.x) * ax + (point.z - hitBlock.z) * az >= 0 ? 1 : -1;
      x = hitBlock.x + ax * BW * side; z = hitBlock.z + az * BW * side; y0 = hitBlock.y0;
    }
  }
  if (y0 === undefined) { // 땅 위: 발밑 가장 낮은 곳보다 조금 묻어 틈이 없게
    let gmin = 1e9;
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0]]) {
      const lx = u * BW, lz = v * BD, c = Math.cos(ry), s = Math.sin(ry);
      gmin = Math.min(gmin, groundAt(x + lx * c + lz * s, z - lx * s + lz * c));
    }
    y0 = gmin - 0.25;
  }
  if (blocks.some(b => Math.hypot(b.x - x, b.z - z) < 0.3 && Math.abs(b.y0 - y0) < 0.3)) return null;
  const b = { x, z, yaw: ry, y0, y1: y0 + BH, hp: 4, turbine: null };
  b.mesh = new THREE.Mesh(GEO, MAT); b.mesh.position.set(x, y0 + BH / 2, z); b.mesh.rotation.y = ry;
  b.mesh.castShadow = b.mesh.receiveShadow = true; b.mesh.layers.enable(1);
  group.add(b.mesh);
  const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y0 + BH / 2, z).setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) }));
  b.collider = world.createCollider(R.ColliderDesc.cuboid(BW / 2, BH / 2, BD / 2).setFriction(0.9), body); b.body = body;
  byHandle.set(b.collider.handle, b);
  blocks.push(b); blocks.sort((p, q) => p.y0 - q.y0);
  return b;
}
export function remove(b) {
  if (b.turbine) toggleTurbine(b);
  world.removeRigidBody(b.body); byHandle.delete(b.collider.handle);
  group.remove(b.mesh); blocks.splice(blocks.indexOf(b), 1);
}

// 물막이: 회전된 직사각형 안 칸은 블록 윗면까지 막히고, 콘크리트라 물이 스미지 않는다
export function rasterize() {
  for (const b of blocks) {
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), rr = Math.hypot(BW, BD) / 2 + CELL;
    const i0 = Math.max(SX0, Math.ceil((b.x - rr - X0) / CELL)), i1 = Math.min(SX1 - 1, Math.floor((b.x + rr - X0) / CELL));
    const j0 = Math.max(0, Math.ceil((b.z - rr - Z0) / CELL)), j1 = Math.min(NZ, Math.floor((b.z + rr - Z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = X0 + i * CELL - b.x, dz = Z0 + j * CELL - b.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) > BW / 2 + CELL * 0.5 || Math.abs(lz) > BD / 2 + CELL * 0.5) continue;
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
export function toggleTurbine(b) {
  if (b.turbine) {
    W.pipes.splice(W.pipes.indexOf(b.turbine.pipe), 1);
    group.remove(b.turbine.vis); b.turbine = null; return false;
  }
  const nx = Math.sin(b.yaw), nz = Math.cos(b.yaw), off = BD / 2 + 0.45;
  const pA = [b.x + nx * off, b.z + nz * off], pB = [b.x - nx * off, b.z - nz * off];
  const sa = W.sample(pA[0], pA[1]), sb = W.sample(pB[0], pB[1]);
  let up = pA, dn = pB, sign = 1;
  if ((sb?.surf ?? -1e9) > (sa?.surf ?? -1e9)) { up = pB; dn = pA; sign = -1; }
  const a = cellsAt(up[0], up[1]), bb = cellsAt(dn[0], dn[1]);
  if (!a.length || !bb.length) return false;
  const pipe = { a, b: bb, area: 0.06, Q: 0, head: 0, P: 0 };
  W.pipes.push(pipe);
  // 모습: 방수구 쪽 발전기 + 회전 날개
  const vis = new THREE.Group();
  const gen = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 16).rotateZ(Math.PI / 2), metal);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 16).rotateZ(Math.PI / 2), accent);
  const wheel = new THREE.Group();
  for (let n = 0; n < 6; n++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.12), metal); bl.rotation.x = n / 6 * Math.PI; wheel.add(bl); }
  const pipeM = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, BD + 0.9, 12).rotateX(Math.PI / 2), metal);
  gen.position.set(0, 0.55, -sign * (BD / 2 + 0.3)); cap.position.copy(gen.position); cap.position.x = 0.27;
  wheel.position.set(0, 0.12, -sign * (BD / 2 + 0.35)); pipeM.position.set(0, 0.12, 0);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0x223322, emissive: 0x33ff88, emissiveIntensity: 0 }));
  lamp.position.set(0, 0.86, -sign * (BD / 2 + 0.3));
  vis.add(gen, cap, wheel, pipeM, lamp);
  vis.traverse(o => { o.castShadow = true; });
  vis.position.set(b.x, b.y0 + 0.25, b.z); vis.rotation.y = b.yaw;
  group.add(vis);
  b.turbine = { pipe, vis, wheel, lamp, out: dn };
  return true;
}
export function update(dt, fx) {
  for (const b of blocks) {
    const t = b.turbine; if (!t) continue;
    t.wheel.rotation.x += dt * t.pipe.Q * 60;
    t.lamp.material.emissiveIntensity = t.pipe.P > 30 ? 2.5 : 0;
    if (fx && t.pipe.Q > 0.01 && Math.random() < 0.6) fx(t.out[0], groundAt(t.out[0], t.out[1]) + 0.3, t.out[1], Math.min(1, t.pipe.Q * 4));
  }
}
export const power = () => W.pipes.reduce((s, p) => s + p.P, 0); // W
