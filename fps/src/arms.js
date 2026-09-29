// 1인칭 팔/손 — 장갑 낀 손 모델 + 2본 IK 로 총기 앵커를 따라감
import * as THREE from 'three';
import { MeshBatch, solveIK, placeBetween } from './core.js';
import { T } from './textures.js';

const RG = 0.02;                                   // 기준 손잡이 반경
export const WRIST = new THREE.Vector3(RG + 0.016, -0.03, 0.062);

function capsule(batch, mat, A, B, r) {
  const L = A.distanceTo(B);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, L), 4, 8);
  const m = new THREE.Object3D();
  placeBetween(m, A, B, 1); m.scale.set(1, 1, 1); m.updateMatrix();
  batch.addMatrix(g, mat, m.matrix);
}

// 오른손 기준 쥔 손 (Y=쥠 축, +X=손바닥, -Z=전방)
function buildHand(mats, trigger) {
  const b = new MeshBatch(), v = (x, y, z) => new THREE.Vector3(x, y, z);
  const ell = (rx, ry, rz) => { const g = new THREE.SphereGeometry(1, 16, 12); g.scale(rx, ry, rz); return g; };
  b.add(ell(0.017, 0.046, 0.043), mats.glove, RG + 0.015, 0.0, 0.02, 0, -0.35, 0);
  b.add(ell(0.013, 0.036, 0.03), mats.glove, RG + 0.01, -0.02, 0.048, 0, -0.2, 0);
  b.add(ell(0.0065, 0.036, 0.013), mats.pad, RG + 0.03, 0.004, -0.004, 0, -0.25, 0);
  for (const [y, r] of [[0.032, 0.0098], [0.011, 0.01], [-0.01, 0.0095], [-0.03, 0.0085]]) b.add(new THREE.SphereGeometry(r, 10, 8), mats.glove, RG + 0.012, y, -0.018);
  const fingers = [
    { y: 0.032, r: 0.0088, L: [0.044, 0.026, 0.02] },
    { y: 0.011, r: 0.009, L: [0.048, 0.03, 0.022] },
    { y: -0.01, r: 0.0086, L: [0.045, 0.028, 0.021] },
    { y: -0.03, r: 0.0076, L: [0.036, 0.022, 0.018] },
  ];
  fingers.forEach((f, i) => {
    if (i === 0 && trigger) {
      const pts = [v(0.03, 0.036, -0.01), v(0.026, 0.039, -0.046), v(0.01, 0.035, -0.064), v(-0.003, 0.028, -0.062)];
      for (let k = 0; k < 3; k++) capsule(b, mats.glove, pts[k], pts[k + 1], f.r * (1 - k * 0.08));
      return;
    }
    const R = RG + f.r + 0.002;
    let th = -0.42;
    let prev = v(Math.cos(th) * R + 0.004, f.y, Math.sin(th) * R);
    f.L.forEach((len, k) => {
      th -= len / R * 0.95;
      const nx = v(Math.cos(th) * R, f.y - k * 0.002, Math.sin(th) * R);
      capsule(b, mats.glove, prev, nx, f.r * (1 - k * 0.1));
      prev = nx;
    });
  });
  // 엄지: 손잡이 뒤로 감아 왼쪽 면에 얹음
  const tp = [v(RG + 0.014, 0.004, 0.052), v(0.02, 0.036, 0.026), v(-0.006, 0.042, 0.03), v(-0.026, 0.038, 0.012), v(-0.03, 0.034, -0.012)];
  const tr = [0.012, 0.0105, 0.0098, 0.009];
  for (let k = 0; k < 4; k++) capsule(b, mats.glove, tp[k], tp[k + 1], tr[k]);
  return b.build(new THREE.Group());
}

export class Arms {
  constructor(root) {
    this.root = root;
    const camo = T.camo, lt = T.leather;
    this.mats = {
      sleeve: new THREE.MeshStandardMaterial({ map: camo.map.clone(), normalMap: camo.normalMap.clone(), roughness: 1, roughnessMap: camo.roughnessMap }),
      glove: new THREE.MeshStandardMaterial({ color: 0x2c2b28, normalMap: lt.normalMap, roughnessMap: lt.roughnessMap, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) }),
      pad: new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 0.55, normalMap: T.stipple.normalMap }),
    };
    for (const k of ['map', 'normalMap']) { this.mats.sleeve[k].repeat.set(2, 1.6); this.mats.sleeve[k].needsUpdate = true; }
    this.side = { R: this.makeSide(1), L: this.makeSide(-1) };
    this.shell = null;
  }

  makeSide(s) {
    const M = this.mats, g = new THREE.Group();
    const hand = buildHand(M, s > 0);
    if (s < 0) hand.scale.set(-1.1, 1.05, 1.1);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.052, 1, 14, 1, true), M.sleeve);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.047, 1, 14, 1, true), M.sleeve);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.035, 1, 14, 1, false), M.glove);
    const roll = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.008, 6, 16), M.sleeve);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.049, 14, 10), M.sleeve);
    g.add(hand, upper, fore, cuff, roll, elbow);
    this.root.add(g);
    return {
      g, hand, upper, fore, cuff, roll, elbow, s,
      shoulder0: new THREE.Vector3(s > 0 ? 0.2 : -0.2, -0.3, 0.16),
      pole: new THREE.Vector3(s * 0.7, -1, 0.3).normalize(),
      S: new THREE.Vector3(), E: new THREE.Vector3(), W: new THREE.Vector3(),
    };
  }

  // tgt = {p: Vector3, q: Quaternion} (root 로컬)
  updateSide(side, tgt) {
    const d = this.side[side], a = 0.3, b = 0.29;
    d.hand.position.copy(tgt.p); d.hand.quaternion.copy(tgt.q);
    d.hand.updateMatrix();
    d.W.copy(tgt.w || WRIST).applyMatrix4(d.hand.matrix);
    d.S.copy(d.shoulder0);
    solveIK(d.S, d.W, a, b, d.pole, d.E);
    placeBetween(d.upper, d.S, d.E, 1);
    const cuffStart = new THREE.Vector3().lerpVectors(d.W, d.E, 0.3);
    placeBetween(d.fore, d.E, cuffStart, 1);
    placeBetween(d.cuff, cuffStart, d.W, 1);
    d.roll.position.copy(cuffStart); d.roll.quaternion.copy(d.cuff.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    d.elbow.position.copy(d.E);
  }
  setVisible(v) { this.side.R.g.visible = this.side.L.g.visible = v; }
}
