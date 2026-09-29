// 사격장 — 흔들리는 스틸 플레이트(땡!), 쓰러졌다 일어서는 IPSC 표적, 유리병, 울타리 밖 장거리 철판(100·200·300m)
import * as THREE from 'three';
import { terrainH } from './world.js';
import { Audio } from './audio.js';
import { rand, clamp } from './core.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FIRE_LINE = V(-50, 1.6, 60);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const ipscTex = () => canvasTex(256, 480, (x, w, h) => {
  x.fillStyle = '#b8976a'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '90,70,40' : '220,200,160'},0.08)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  x.strokeStyle = 'rgba(70,50,30,0.8)'; x.lineWidth = 2; x.setLineDash([6, 4]);
  x.strokeRect(w * 0.32, h * 0.02, w * 0.36, h * 0.17); x.strokeRect(w * 0.38, h * 0.06, w * 0.24, h * 0.08);
  x.strokeRect(w * 0.26, h * 0.26, w * 0.48, h * 0.34); x.strokeRect(w * 0.12, h * 0.22, w * 0.76, h * 0.52);
  x.setLineDash([]); x.fillStyle = 'rgba(70,50,30,0.8)'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center';
  x.fillText('A', w / 2, h * 0.43); x.fillText('A', w / 2, h * 0.115); x.fillText('C', w * 0.3, h * 0.66); x.fillText('D', w * 0.18, h * 0.3);
});
const signTex = (t1, t2) => canvasTex(512, 256, (x, w, h) => {
  x.fillStyle = '#1f3a24'; x.fillRect(0, 0, w, h); x.strokeStyle = '#e8e4d0'; x.lineWidth = 10; x.strokeRect(12, 12, w - 24, h - 24);
  x.fillStyle = '#e8e4d0'; x.textAlign = 'center'; x.font = 'bold 88px sans-serif'; x.fillText(t1, w / 2, h * 0.52);
  x.font = 'bold 40px sans-serif'; x.fillStyle = '#d9b44a'; x.fillText(t2, w / 2, h * 0.8);
});

export class Range {
  constructor(g) {
    this.g = g;
    this.group = new THREE.Group(); g.scene.add(this.group);
    this.targets = [];
    this.M = {
      steel: new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.55, metalness: 0.25 }),
      steelO: new THREE.MeshStandardMaterial({ color: 0xd9641e, roughness: 0.55, metalness: 0.25 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x3a3d3a, roughness: 0.6, metalness: 0.8 }),
      chain: new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.4, metalness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.85 }),
      ipsc: new THREE.MeshStandardMaterial({ map: ipscTex(), roughness: 0.95 }),
      lead: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.6 }),
      hole: new THREE.MeshBasicMaterial({ color: 0x120c06 }),
      glassG: new THREE.MeshPhysicalMaterial({ color: 0x2f6b3a, roughness: 0.08, transmission: 0, transparent: true, opacity: 0.8, metalness: 0.1, clearcoat: 1 }),
      glassB: new THREE.MeshPhysicalMaterial({ color: 0x6b3a14, roughness: 0.08, transparent: true, opacity: 0.82, metalness: 0.1, clearcoat: 1 }),
    };
    this.build();
  }

  add(o, cast = true) { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = true; } }); this.group.add(o); return o; }
  box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }

  // 매달린 철판: 기둥 두 개 + 가로대, 판은 체인 길이 L 아래
  plateRack(x, z, span, plates, yaw = 0, H = 1.55, scale = 1) {
    const G = new THREE.Group(); G.position.set(x, 0, z); G.rotation.y = yaw;
    const baseY = z < -60 || x < -70 ? terrainH(x, z) : 0; G.position.y = baseY;
    for (const s of [-1, 1]) G.add(this.box(0.08 * scale, H + 0.1, 0.08 * scale, this.M.frame, s * span / 2, (H + 0.1) / 2 - 0.05, 0));
    G.add(this.box(span + 0.16, 0.08 * scale, 0.08 * scale, this.M.frame, 0, H, 0));
    for (const s of [-1, 1]) { const f = this.box(0.06, 0.06, 0.9 * scale, this.M.frame, s * span / 2, 0.03, 0); G.add(f); }
    plates.forEach((p, i) => {
      const px = -span / 2 + span * (i + 0.5) / plates.length;
      const piv = new THREE.Group(); piv.position.set(px, H - 0.05, 0.06 * scale); G.add(piv);
      const L = 0.3 * scale;
      for (const s of [-1, 1]) piv.add(this.box(0.008, L, 0.008, this.M.chain, s * p.w * 0.3, -L / 2, 0));
      let mesh;
      if (p.round) { mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.w / 2, p.w / 2, 0.012, 28), p.orange ? this.M.steelO : this.M.steel); mesh.rotation.x = Math.PI / 2; }
      else mesh = this.box(p.w, p.h, 0.012, p.orange ? this.M.steelO : this.M.steel, 0, 0, 0);
      mesh.position.y = -L - (p.round ? p.w : p.h) / 2;
      piv.add(mesh);
      const hh = p.round ? p.w : p.h;
      this.targets.push({ kind: 'plate', pivot: piv, face: mesh, box: new THREE.Box3(V(-p.w / 2, -L - hh, -0.02), V(p.w / 2, -L, 0.02)), th: 0, w: 0, L: L + hh / 2, pts: p.pts, big: scale > 1.2, marks: 0, dist: p.dist, cr: L + hh + 0.5 });
    });
    return this.add(G);
  }

  popup(x, z) {
    const G = new THREE.Group(); G.position.set(x, 0, z);
    G.add(this.box(0.6, 0.12, 0.3, this.M.frame, 0, 0.06, 0));
    const piv = new THREE.Group(); piv.position.y = 0.12; G.add(piv);
    piv.add(this.box(0.03, 0.55, 0.03, this.M.wood, 0, 0.27, -0.02));
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.76), this.M.ipsc);
    card.position.set(0, 0.55 + 0.38, 0); piv.add(card);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.76), this.M.wood); back.rotation.y = Math.PI; back.position.copy(card.position).add(V(0, 0, -0.003)); piv.add(back);
    this.targets.push({ kind: 'popup', pivot: piv, face: card, box: new THREE.Box3(V(-0.23, 0.55, -0.02), V(0.23, 1.31, 0.02)), a: 0, down: 0, marks: 0 });
    return this.add(G);
  }

  bottles(x, z) {
    const G = new THREE.Group(); G.position.set(x, 0, z);
    for (const s of [-1, 1]) { G.add(this.box(0.08, 0.85, 0.08, this.M.wood, s * 0.7, 0.425, 0.12)); G.add(this.box(0.08, 0.85, 0.08, this.M.wood, s * 0.7, 0.425, -0.12)); }
    G.add(this.box(1.7, 0.05, 0.3, this.M.wood, 0, 0.875, 0));
    const prof = [[0, 0], [0.034, 0], [0.036, 0.004], [0.036, 0.16], [0.03, 0.19], [0.014, 0.22], [0.012, 0.28], [0.014, 0.285], [0.011, 0.29], [0, 0.29]].map(([a, b]) => new THREE.Vector2(a, b));
    const geo = new THREE.LatheGeometry(prof, 18);
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(geo, i % 2 ? this.M.glassB : this.M.glassG);
      b.position.set(-0.6 + i * 0.24, 0.9, rand(-0.03, 0.03)); b.renderOrder = 3;
      G.add(b);
      this.targets.push({ kind: 'bottle', pivot: b, face: b, box: new THREE.Box3(V(-0.036, 0, -0.036), V(0.036, 0.29, 0.036)), dead: 0 });
    }
    return this.add(G);
  }

  sign(x, y, z, t1, t2, yaw = 0, w = 1.6) {
    const G = new THREE.Group(); G.position.set(x, 0, z); G.rotation.y = yaw;
    for (const s of [-1, 1]) G.add(this.box(0.07, y, 0.07, this.M.wood, s * w * 0.4, y / 2, -0.02));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 2), new THREE.MeshStandardMaterial({ map: signTex(t1, t2), roughness: 0.8 }));
    m.position.set(0, y, 0.02); G.add(m);
    return this.add(G);
  }

  build() {
    const W = this.g.world, zL = FIRE_LINE.z;
    // 사대: 사격 벤치 3개 + 모래주머니 받침 + 표지판
    for (const x of [-56, -50, -44]) {
      const G = new THREE.Group(); G.position.set(x, 0, zL);
      G.add(this.box(1.4, 0.06, 0.7, this.M.wood, 0, 0.84, 0));
      for (const [sx, sz] of [[-0.6, -0.28], [0.6, -0.28], [-0.6, 0.28], [0.6, 0.28]]) G.add(this.box(0.07, 0.84, 0.07, this.M.wood, sx, 0.42, sz));
      const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 4, 10), W.M.sandbag); bag.rotation.z = Math.PI / 2; bag.position.set(0, 0.95, -0.2); G.add(bag);
      this.add(G);
      W.addCollider(x - 0.7, 0, zL - 0.35, x + 0.7, 0.87, zL + 0.35, 'wood');
    }
    this.sign(-61, 2.2, zL - 0.5, '사격장', 'FIRING RANGE · 10–300m', 0.25);
    for (const [d, z] of [[10, 50], [15, 45], [25, 35], [35, 25]]) this.sign(-60.5, 0.55, z, `${d}m`, '', 0.2, 0.55);
    // 표적
    this.bottles(-43.5, 50);
    this.plateRack(-54, 45, 6, [{ w: 0.2, round: true, pts: 10 }, { w: 0.3, h: 0.45, pts: 10, orange: true }, { w: 0.25, round: true, pts: 10 }, { w: 0.15, round: true, pts: 15 }]);
    for (const x of [-57, -52, -47]) this.popup(x, 35);
    this.plateRack(-54, 25, 4.5, [{ w: 0.35, h: 0.55, pts: 20 }, { w: 0.2, round: true, pts: 25, orange: true }, { w: 0.35, h: 0.55, pts: 20 }]);
    // 울타리 밖 장거리 (서쪽): 사선에서 시야가 지형에 가리지 않게 높이 보정
    const eye = V(-60, 1.6, 45);
    for (const [dist, pts] of [[100, 50], [200, 100], [300, 150]]) {
      const x = eye.x - dist, z = eye.z, gy = terrainH(x, z);
      let need = gy + 1.2;
      for (let s = 0.2; s < 1; s += 0.02) { const xs = eye.x + (x - eye.x) * s; need = Math.max(need, eye.y + (terrainH(xs, z) + 0.6 - eye.y) / s); }
      const Hs = need - gy + 0.6, sc = 1 + dist / 150;
      const G = this.plateRack(x, z, 1.4 * sc, [{ w: 0.5 * sc, h: 0.8 * sc, pts, orange: dist === 300, dist }], Math.PI / 2, Hs, sc);
      G.position.y = gy;
      this.sign(x + 2, 0.9, z + 1.6 * sc, `${dist}m`, '', Math.PI / 2, 0.9);
    }
    this.group.updateMatrixWorld(true);
  }

  // ── 광선 판정 ──
  raycast(o, d, maxT) {
    let best = maxT, out = null;
    const inv = this._inv || (this._inv = new THREE.Matrix4()), ray = this._ray || (this._ray = new THREE.Ray()), pt = V(0, 0, 0);
    for (const T of this.targets) {
      if (T.dead > 0) continue;
      // 대략적 거리 컷
      const wp = T.pivot.getWorldPosition(pt);
      const tc = wp.clone().sub(o).dot(d);
      const cr = T.cr || 1.6;
      if (tc < -cr || tc > best + cr || wp.clone().sub(o).addScaledVector(d, -tc).lengthSq() > cr * cr) continue;
      inv.copy(T.pivot.matrixWorld).invert();
      ray.origin.copy(o).applyMatrix4(inv); ray.direction.copy(d).transformDirection(inv);
      const hp = ray.intersectBox(T.box, V(0, 0, 0));
      if (!hp) continue;
      const t = hp.distanceTo(ray.origin);
      if (t < best) { best = t; out = { t, target: T, local: hp, point: o.clone().addScaledVector(d, t), n: d.clone().negate(), dLocal: ray.direction.clone() }; }
    }
    return out;
  }

  hit(h, dir, b) {
    const g = this.g, T = h.target, p = h.point;
    let pts = 0, msg = null;
    if (T.kind === 'plate') {
      T.w += clamp((b.dmg || 30) / 30, 0.5, 4) * (T.big ? 0.9 : 2.4) * Math.sign(-h.dLocal.z || 1);
      this.mark(T, h.local, this.M.lead, 0.012);
      g.fx.impact(p, h.n, 'metal', dir);
      Audio.play3D(T.big ? 'gong' : 'ding', p, { vol: T.big ? 3 : 1.4, ref: T.big ? 30 : 8, rate: T.big ? 1 : rand(0.9, 1.15) });
      pts = T.pts;
      if (T.dist) msg = `<small>장거리 명중 — ${Math.round(p.distanceTo(g.player.eye))}m</small>`;
    } else if (T.kind === 'popup') {
      if (T.down > 0) return;
      this.mark(T, h.local, this.M.hole, 0.006);
      const head = h.local.y > 1.12;
      T.down = 2.8; pts = head ? 25 : 15;
      g.fx.impact(p, h.n, 'wood', dir);
      Audio.play3D('hitWood', p, { vol: 0.8, ref: 6 });
      if (head) msg = '<small>A존 헤드 — +25</small>';
    } else if (T.kind === 'bottle') {
      T.dead = 9; T.face.visible = false; pts = 5;
      const c = T.face.material === this.M.glassG ? [0.12, 0.3, 0.14] : [0.35, 0.18, 0.06];
      for (let i = 0; i < 26; i++) g.fx.dots.add(p, V(rand(-1, 1), rand(0.2, 1.6), rand(-1, 1)).normalize().multiplyScalar(rand(1, 4)).addScaledVector(dir, 1.2), { life: rand(0.6, 1.4), size: rand(0.01, 0.025), grav: 9.8, drag: 0.5, color: c });
      Audio.play3D('glass', p, { vol: 0.9, ref: 5 });
    }
    g.score += pts;
    g.stats.hits++;
    g.hud.hitmarker(false, false);
    if (msg) g.hud.message(msg, 1.6);
  }

  mark(T, local, mat, r) {
    if (T.marks > 40) return;
    T.marks++;
    const m = new THREE.Mesh(this._circ || (this._circ = new THREE.CircleGeometry(1, 8)), mat);
    m.scale.setScalar(r * rand(0.8, 1.4)); m.position.copy(local); m.position.z = 0.0075;
    T.pivot.add(m);
    (T.markList || (T.markList = [])).push(m);
  }

  update(dt) {
    for (const T of this.targets) {
      if (T.kind === 'plate') {
        const acc = -9.81 / T.L * Math.sin(T.th) - T.w * 1.6;
        T.w += acc * dt; T.th += T.w * dt;
        T.th = clamp(T.th, -1.2, 1.4);
        T.pivot.rotation.x = T.th;
      } else if (T.kind === 'popup') {
        if (T.down > 0) { T.down -= dt; if (T.down <= 0) { for (const m of T.markList || []) T.pivot.remove(m); T.markList = []; T.marks = 0; Audio.play3D('select', T.pivot.getWorldPosition(V(0, 0, 0)), { vol: 0.5 }); } }
        const tgt = T.down > 0.4 ? -1.45 : 0;
        T.a += (tgt - T.a) * Math.min(1, dt * (tgt < 0 ? 16 : 6));
        T.pivot.rotation.x = T.a;
      } else if (T.kind === 'bottle' && T.dead > 0) {
        T.dead -= dt; if (T.dead <= 0) T.face.visible = true;
      }
    }
  }

  reset() {
    for (const T of this.targets) {
      T.th = T.w = 0; T.down = 0; T.a = 0; T.dead = 0; T.face.visible = true;
      for (const m of T.markList || []) T.pivot.remove(m);
      T.markList = []; T.marks = 0;
    }
  }
}
