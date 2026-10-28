// 손으로 만질 수 있는 물체(공·풍선)와 간단한 물리
import * as THREE from 'three';

const TABLE = { x: 0, z: -0.62, w: 1.5, d: 0.72, h: 0.98 };
const BALLS = [
  { r: 0.075, c: ['#ff5a5f', '#ffffff', '#2f8cff', '#ffffff', '#ffd23f', '#ffffff'] },
  { r: 0.06, c: ['#7bd389', '#2a9d8f'] },
  { r: 0.09, c: ['#ff9f1c', '#ffbf69', '#ff9f1c', '#ffbf69'] },
  { r: 0.055, c: ['#9b5de5', '#f15bb5'] },
  { r: 0.07, c: ['#00bbf9', '#ffffff', '#00bbf9', '#ffffff', '#00bbf9', '#ffffff'] },
];
const BALLOONS = [
  { p: [-0.8, 1.45, -0.6], c: 0xff4d6d }, { p: [0.85, 1.5, -0.7], c: 0x4cc9f0 },
  { p: [-0.3, 1.7, -1.35], c: 0xffd60a }, { p: [0.35, 1.38, -1.45], c: 0x80ed99 },
];

function stripeTexture(colors) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const w = 256 / colors.length;
  colors.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * w, 0, w + 1, 128); });
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, 0, 256, 10); g.fillRect(0, 118, 256, 10);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _g = new THREE.Vector3(), _d = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

export class Physics {
  constructor(scene) {
    this.scene = scene;
    this.bodies = [];
    this.boxes = [];
    this.buildTable();
    const sphere = new THREE.SphereGeometry(1, 40, 24);
    BALLS.forEach((b, i) => {
      const mat = new THREE.MeshPhysicalMaterial({ map: stripeTexture(b.c), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
      const x = -0.52 + i * 0.26;
      this.add({ kind: 'ball', r: b.r, mass: b.r ** 3 * 2000, home: new THREE.Vector3(x, TABLE.h + b.r, TABLE.z + 0.08), mesh: new THREE.Mesh(sphere, mat), e: 0.55 });
    });
    BALLOONS.forEach(b => {
      const mat = new THREE.MeshPhysicalMaterial({ color: b.c, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.4, transparent: true, opacity: 0.93 });
      const mesh = new THREE.Mesh(sphere, mat);
      const knot = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.03, 12), mat);
      knot.position.y = -1.08; knot.scale.set(1 / 0.13, 1 / 0.15, 1 / 0.13); knot.rotation.x = Math.PI;
      mesh.add(knot);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0x8899aa }));
      line.frustumCulled = false;
      this.scene.add(line);
      const body = this.add({ kind: 'balloon', r: 0.13, mass: 0.02, home: new THREE.Vector3(...b.p), mesh, e: 0.45, line, tail: new THREE.Vector3() });
      mesh.scale.set(0.13, 0.15, 0.13);
      body.tail.copy(body.home).y -= 0.9;
    });
  }

  buildTable() {
    const { x, z, w, d, h } = TABLE;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8b48a, roughness: 0.55 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), mat);
    top.position.set(x, h - 0.025, z);
    const legGeo = new THREE.BoxGeometry(0.05, h - 0.05, 0.05);
    const parts = [top];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(x + sx * (w / 2 - 0.06), (h - 0.05) / 2, z + sz * (d / 2 - 0.06));
      parts.push(leg);
    }
    for (const p of parts) { p.castShadow = p.receiveShadow = true; this.scene.add(p); }
    this.boxes.push({ min: new THREE.Vector3(x - w / 2, 0, z - d / 2), max: new THREE.Vector3(x + w / 2, h, z + d / 2) });
  }

  add(o) {
    const b = { ...o, pos: o.home.clone(), vel: new THREE.Vector3(), held: null, pull: null, glow: 0 };
    b.mesh.castShadow = true; b.mesh.receiveShadow = true;
    if (b.kind === 'ball') b.mesh.scale.setScalar(b.r);
    b.mesh.position.copy(b.pos);
    this.scene.add(b.mesh);
    this.bodies.push(b);
    return b;
  }

  reset() {
    for (const b of this.bodies) {
      b.pos.copy(b.home); b.vel.set(0, 0, 0);
      if (b.held) b.held.holding = null;
      if (b.pull) b.pull.pulling = null;
      b.held = b.pull = null;
      if (b.tail) b.tail.copy(b.home).y -= 0.9;
    }
  }

  // 잡기/놓기/끌어오기 (제스처 변화에 반응)
  updateHands(hands, camPos) {
    for (const h of hands) {
      const want = h.visible && (h.gesture === 'pinch' || h.gesture === 'fist');
      if (want && !h.wasGrab) this.tryGrab(h, camPos);
      if (!want && h.wasGrab) this.release(h);
      h.wasGrab = want;
      if (h.pulling && h.pulling.pos.distanceTo(h.grabPoint(_g)) < h.pulling.r + 0.05) {
        const b = h.pulling; b.pull = null; h.pulling = null;
        this.attach(h, b, _g);
      }
      if (h.holding) {
        const b = h.holding;
        b.pos.copy(h.grabPoint(_g)).add(b.offset);
        b.vel.copy(h.palmVel);
      }
    }
  }

  tryGrab(h, camPos) {
    const gp = h.grabPoint(_g);
    let best = null, bestD = Infinity;
    for (const b of this.bodies) {
      if (b.held) continue;
      const d = b.pos.distanceTo(gp) - b.r;
      if (d < (h.gesture === 'fist' ? 0.07 : 0.05) && d < bestD) { best = b; bestD = d; }
    }
    if (best) { if (best.pull) { best.pull.pulling = null; best.pull = null; } this.attach(h, best, gp); return; }
    if (h.gesture !== 'pinch') return;
    // 가까이 없으면: 눈→집은 손 방향의 공을 끌어온다
    const dir = _d.subVectors(gp, camPos).normalize();
    let bestA = 0.1;
    for (const b of this.bodies) {
      if (b.held || b.pull) continue;
      _v.subVectors(b.pos, gp);
      const t = _v.dot(dir);
      if (t <= 0 || t > 30) continue;
      const ang = Math.max(0, _v.addScaledVector(dir, -t).length() - b.r) / t;
      if (ang < bestA) { bestA = ang; best = b; }
    }
    if (best) { best.pull = h; h.pulling = best; }
  }

  attach(h, b, gp) {
    b.held = h; h.holding = b;
    b.offset = new THREE.Vector3().subVectors(b.pos, gp).clampLength(0, b.r * 0.9);
  }

  release(h) {
    if (h.holding) {
      const b = h.holding;
      b.vel.copy(h.palmVel).multiplyScalar(1.25).clampLength(0, 12);
      b.held = null; h.holding = null;
    }
    if (h.pulling) { h.pulling.pull = null; h.pulling = null; }
  }

  // colliders: [{ p, v, r, hand }]
  step(dt, colliders) {
    const n = 3, h = dt / n;
    for (let s = 0; s < n; s++) {
      for (const b of this.bodies) {
        if (b.held) continue;
        if (b.pull) {
          b.pull.grabPoint(_g);
          _v.subVectors(_g, b.pos).multiplyScalar(45).addScaledVector(b.vel, -11);
          b.vel.addScaledVector(_v, h);
        } else if (b.kind === 'balloon') {
          b.vel.y += ((b.home.y - b.pos.y) * 1.4 - 0.15) * h;
          b.vel.multiplyScalar(Math.exp(-1.8 * h));
        } else {
          b.vel.y -= 9.8 * h;
          b.vel.multiplyScalar(Math.exp(-0.05 * h));
        }
        b.pos.addScaledVector(b.vel, h);
        b.support = false;
        if (b.pos.y < b.r) {
          b.pos.y = b.r;
          if (b.vel.y < 0) b.vel.y = Math.abs(b.vel.y) < 0.3 ? 0 : -b.vel.y * b.e;
          b.support = true;
        }
        for (const box of this.boxes) this.sphereBox(b, box);
        if (b.support) { const f = Math.exp(-(b.kind === 'ball' ? 0.9 : 3) * h); b.vel.x *= f; b.vel.z *= f; }
        for (const c of colliders) {
          if (c.hand === b.pull) continue;
          _n.subVectors(b.pos, c.p);
          const d = _n.length(), min = b.r + c.r;
          if (d >= min || d < 1e-6) continue;
          _n.divideScalar(d);
          b.pos.copy(c.p).addScaledVector(_n, min);
          _v.subVectors(b.vel, c.v);
          const vn = _v.dot(_n);
          if (vn < 0) {
            b.vel.addScaledVector(_n, -(1 + b.e) * vn);
            _v.addScaledVector(_n, -vn);
            b.vel.addScaledVector(_v, -0.25); // 마찰
          }
        }
      }
      // 물체끼리 충돌
      for (let i = 0; i < this.bodies.length; i++) for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i], b = this.bodies[j];
        _n.subVectors(b.pos, a.pos);
        const d = _n.length(), min = a.r + b.r;
        if (d >= min || d < 1e-6) continue;
        _n.divideScalar(d);
        const ia = a.held ? 0 : 1 / a.mass, ib = b.held ? 0 : 1 / b.mass;
        if (ia + ib === 0) continue;
        const pen = min - d;
        a.pos.addScaledVector(_n, -pen * ia / (ia + ib));
        b.pos.addScaledVector(_n, pen * ib / (ia + ib));
        const vn = _v.subVectors(b.vel, a.vel).dot(_n);
        if (vn < 0) {
          const j2 = -(1 + Math.min(a.e, b.e)) * vn / (ia + ib);
          a.vel.addScaledVector(_n, -j2 * ia);
          b.vel.addScaledVector(_n, j2 * ib);
        }
      }
    }
    for (const b of this.bodies) {
      if (b.pos.y < -5 || b.pos.lengthSq() > 3600) { b.pos.copy(b.home); b.vel.set(0, 0, 0); }
      const prev = b.mesh.position.clone();
      b.mesh.position.copy(b.pos);
      if (b.kind === 'ball') {
        // 굴러가는 회전
        _v.subVectors(b.pos, prev); _v.y = 0;
        const dist = _v.length();
        if (dist > 1e-5) b.mesh.rotateOnWorldAxis(_n.crossVectors(UPV, _v).normalize(), dist / b.r);
      } else {
        b.mesh.rotation.z = THREE.MathUtils.clamp(-b.vel.x * 0.4, -0.5, 0.5);
        b.mesh.rotation.x = THREE.MathUtils.clamp(b.vel.z * 0.4, -0.5, 0.5);
        // 풍선 줄: 끝이 늦게 따라오는 줄
        const top = _v.copy(b.pos); top.y -= b.r * 1.18;
        _g.copy(top).y -= 0.9;
        b.tail.lerp(_g, 1 - Math.exp(-dt * 4));
        b.tail.sub(top).setLength(0.9).add(top);
        const arr = b.line.geometry.attributes.position.array;
        arr[0] = top.x; arr[1] = top.y; arr[2] = top.z; arr[3] = b.tail.x; arr[4] = b.tail.y; arr[5] = b.tail.z;
        b.line.geometry.attributes.position.needsUpdate = true;
      }
      // 잡거나 끌어오는 물체는 살짝 빛나게
      const target = b.held ? 0.35 : b.pull ? 0.6 : 0;
      b.glow += (target - b.glow) * Math.min(1, dt * 10);
      b.mesh.material.emissive.setRGB(0.3 * b.glow, 0.55 * b.glow, b.glow);
    }
  }

  sphereBox(b, box) {
    const cx = THREE.MathUtils.clamp(b.pos.x, box.min.x, box.max.x);
    const cy = THREE.MathUtils.clamp(b.pos.y, box.min.y, box.max.y);
    const cz = THREE.MathUtils.clamp(b.pos.z, box.min.z, box.max.z);
    _n.set(b.pos.x - cx, b.pos.y - cy, b.pos.z - cz);
    const d2 = _n.lengthSq();
    if (d2 >= b.r * b.r) return;
    let pen;
    if (d2 > 1e-10) { const d = Math.sqrt(d2); _n.divideScalar(d); pen = b.r - d; }
    else { _n.set(0, 1, 0); pen = box.max.y - b.pos.y + b.r; }
    b.pos.addScaledVector(_n, pen);
    const vn = b.vel.dot(_n);
    if (vn < 0) b.vel.addScaledVector(_n, -(1 + (Math.abs(vn) < 0.3 ? 0 : b.e)) * vn);
    if (_n.y > 0.7) b.support = true;
  }
}
