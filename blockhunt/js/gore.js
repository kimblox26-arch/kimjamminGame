// 피, 상처, 핏자국, 피 웅덩이, 밖으로 튀어나오는 장기
import * as THREE from 'three';
import { G } from './game.js';
import { rbox, mat, rand, canvasTex, chance } from './util.js';

const MAXP = 900, MAXS = 500;
const _o = new THREE.Object3D(), _c = new THREE.Color(), _v = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

function blob(c, s, cx, cy, r, n, rough) {
  c.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (1 - rough / 2 + Math.random() * rough);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.fill();
}
const splatTex = () => canvasTex(128, (c) => {
  c.fillStyle = '#fff';
  blob(c, 128, 64, 64, 30, 18, 0.5);
  for (let i = 0; i < 12; i++) { const a = Math.random() * 7, r = 30 + Math.random() * 28; c.beginPath(); c.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 2 + Math.random() * 6, 0, 7); c.fill(); }
});
const poolTex = () => canvasTex(128, (c) => { c.fillStyle = '#fff'; blob(c, 128, 64, 64, 54, 26, 0.18); });
const woundTex = () => canvasTex(64, (c) => {
  c.fillStyle = '#b00d0d'; blob(c, 64, 32, 32, 22, 14, 0.5);
  c.fillRect(28, 32, 6, 30);
  c.fillStyle = '#4a0000'; blob(c, 64, 32, 32, 10, 10, 0.4);
  c.fillStyle = '#1a0000'; c.beginPath(); c.arc(32, 32, 4, 0, 7); c.fill();
});

export class Gore {
  constructor(scene) {
    this.scene = scene;
    this.pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff' }), MAXP);
    this.pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pm.setColorAt(0, _c.set('#fff'));
    this.pm.frustumCulled = false;
    this.pm.count = 0;
    scene.add(this.pm);
    this.P = [];
    const sm = new THREE.MeshLambertMaterial({ map: splatTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.sm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), sm, MAXS);
    this.sm.setColorAt(0, _c.set('#fff'));
    this.sm.frustumCulled = false; this.sm.count = 0; this.si = 0;
    this.sm.receiveShadow = true;
    scene.add(this.sm);
    this.poolMat = new THREE.MeshLambertMaterial({ color: '#7d0a0a', map: poolTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    this.woundMat = new THREE.MeshLambertMaterial({ map: woundTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 });
    this.pools = []; this.ropes = []; this.chunks = [];
  }

  // 핏방울/먼지 입자 뿌리기
  spray(point, dir, n, speed = 12, o = {}) {
    for (let i = 0; i < n && this.P.length < MAXP; i++) {
      const v = new THREE.Vector3(dir.x + rand(-0.6, 0.6) * (o.spread || 1), dir.y + rand(-0.3, 0.8) * (o.spread || 1), dir.z + rand(-0.6, 0.6) * (o.spread || 1));
      v.normalize().multiplyScalar(speed * rand(0.3, 1.2));
      this.P.push({
        p: point.clone(), v, life: o.life || rand(1.5, 3), s: (o.size || 0.2) * rand(0.5, 1.4),
        col: o.dust ? '#bfc3c8' : chance(0.3) ? '#6e0606' : '#a30d0d', dust: !!o.dust, mark: !o.dust && chance(o.mark ?? 0.5),
      });
    }
  }
  // 바닥·벽에 붙는 자국 (normal 방향으로)
  splat(point, normal, size, color = '#8b0909') {
    _o.position.copy(point).addScaledVector(normal, 0.03);
    _o.quaternion.setFromUnitVectors(_z, normal);
    _o.rotateZ(Math.random() * 6.28);
    _o.scale.set(size, size, 1);
    _o.updateMatrix();
    const i = this.si++ % MAXS;
    this.sm.setMatrixAt(i, _o.matrix);
    this.sm.setColorAt(i, _c.set(color));
    this.sm.count = Math.min(MAXS, this.si);
    this.sm.instanceMatrix.needsUpdate = true;
    this.sm.instanceColor.needsUpdate = true;
  }
  pool(pos, max = 6) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.poolMat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6;
    m.position.set(pos.x, 0.04 + this.pools.length * 0.0005, pos.z);
    m.scale.setScalar(0.3); m.receiveShadow = true;
    this.scene.add(m);
    this.pools.push({ m, max, s: 0.3 });
    if (this.pools.length > 30) this.pools.shift().m.removeFromParent();
  }
  // 몸에 상처 자국 (부위 메시에 붙어서 같이 움직임)
  wound(mesh, point, localNormal, size = 0.45) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.woundMat);
    mesh.updateWorldMatrix(true, false);
    d.position.copy(mesh.worldToLocal(point.clone())).addScaledVector(localNormal, 0.012);
    d.quaternion.setFromUnitVectors(_z, localNormal);
    d.rotateZ(Math.random() * 6.28);
    mesh.add(d);
    const ws = mesh.userData.owner && mesh.userData.owner.wounds;
    if (ws) { ws.push(d); if (ws.length > 28) ws.shift().removeFromParent(); }
    return d;
  }
  // 장기가 몸 밖으로: 창자(줄) + 덩어리
  organs(avatar, point, dir) {
    const torso = avatar.torso;
    torso.updateWorldMatrix(true, false);
    const anchor = torso.worldToLocal(point.clone());
    anchor.z = Math.sign(anchor.z || 1) * 0.45;
    const N = 14, h = 1 / 60, pts = [], old = [], segs = [];
    const out = dir.clone().setY(Math.max(dir.y, 0.2)).normalize();
    for (let i = 0; i < N; i++) {
      const p = point.clone().addScaledVector(out, i * 0.18);
      pts.push(p);
      old.push(p.clone().addScaledVector(out, -h * rand(6, 14)).add(new THREE.Vector3(rand(-1, 1), -rand(2, 5), rand(-1, 1)).multiplyScalar(h)));
    }
    const m1 = mat('#d98a92'), m2 = mat('#c46a76');
    for (let i = 0; i < N - 1; i++) {
      const s = new THREE.Mesh(rbox(0.34, 0.34, 0.5, 0.15, 2), i % 2 ? m1 : m2);
      s.castShadow = true; this.scene.add(s); segs.push(s);
    }
    this.ropes.push({ avatar, anchor, pts, old, segs, t: 0 });
    for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) {
      const m = new THREE.Mesh(rbox(rand(0.45, 0.7), rand(0.35, 0.5), rand(0.4, 0.6), 0.15, 2), mat(k === 0 ? '#8e1b25' : k === 1 ? '#6d241c' : '#b5485a'));
      m.position.copy(point); m.castShadow = true; this.scene.add(m);
      const v = out.clone().multiplyScalar(rand(8, 16)).add(new THREE.Vector3(rand(-4, 4), rand(4, 9), rand(-4, 4)));
      this.chunks.push({ m, v, w: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), avatar, rest: false });
    }
    this.spray(point, out, 40, 16, { size: 0.24, mark: 0.7 });
    if (this.ropes.length > 8) this.removeRope(this.ropes[0]);
    while (this.chunks.length > 24) this.chunks.shift().m.removeFromParent();
  }
  removeRope(r) { r.segs.forEach((s) => s.removeFromParent()); this.ropes.splice(this.ropes.indexOf(r), 1); }
  removeFor(avatar) {
    for (const r of [...this.ropes]) if (r.avatar === avatar) this.removeRope(r);
    this.chunks = this.chunks.filter((c) => { if (c.avatar === avatar) { c.m.removeFromParent(); return false; } return true; });
  }

  update(dt) {
    let n = 0;
    for (let i = this.P.length - 1; i >= 0; i--) {
      const q = this.P[i];
      q.life -= dt;
      q.v.y -= (q.dust ? 30 : 75) * dt;
      q.p.addScaledVector(q.v, dt);
      let dead = q.life <= 0;
      if (q.p.y <= 0.05) {
        if (q.mark) this.splat(_v.set(q.p.x, 0.02, q.p.z), UPV, q.s * rand(3, 7));
        dead = true;
      }
      if (dead) { this.P[i] = this.P[this.P.length - 1]; this.P.pop(); continue; }
      _o.position.copy(q.p); _o.rotation.set(q.life * 3, q.life * 2, 0); _o.scale.setScalar(q.s); _o.updateMatrix();
      this.pm.setMatrixAt(n, _o.matrix); this.pm.setColorAt(n, _c.set(q.col)); n++;
    }
    this.pm.count = n;
    this.pm.instanceMatrix.needsUpdate = true;
    if (this.pm.instanceColor) this.pm.instanceColor.needsUpdate = true;

    for (const p of this.pools) if (p.s < p.max) { p.s = Math.min(p.max, p.s + dt * 0.5); p.m.scale.setScalar(p.s); }

    // 창자 줄 물리
    const h = 1 / 60;
    for (const r of this.ropes) {
      r.t += dt;
      const steps = Math.min(3, Math.max(1, Math.round(dt / h)));
      const A = r.avatar.torso.localToWorld(_v.copy(r.anchor));
      for (let s = 0; s < steps; s++) {
        r.pts[0].copy(A);
        for (let i = 1; i < r.pts.length; i++) {
          const p = r.pts[i], o = r.old[i];
          const vx = (p.x - o.x) * 0.985, vy = (p.y - o.y) * 0.985, vz = (p.z - o.z) * 0.985;
          o.copy(p); p.x += vx; p.y += vy - 90 * h * h; p.z += vz;
        }
        for (let it = 0; it < 4; it++) {
          for (let i = 0; i < r.pts.length - 1; i++) {
            const a = r.pts[i], b = r.pts[i + 1];
            const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz) || 1e-5;
            const k = (L - 0.4) / L * (i === 0 ? 1 : 0.5);
            if (i !== 0) { a.x += dx * k; a.y += dy * k; a.z += dz * k; }
            b.x -= dx * k; b.y -= dy * k; b.z -= dz * k;
          }
          for (let i = 1; i < r.pts.length; i++) {
            const p = r.pts[i];
            if (p.y < 0.17) { p.y = 0.17; r.old[i].x += (p.x - r.old[i].x) * 0.3; r.old[i].z += (p.z - r.old[i].z) * 0.3; }
          }
        }
      }
      for (let i = 0; i < r.segs.length; i++) {
        const a = r.pts[i], b = r.pts[i + 1], s = r.segs[i];
        s.position.addVectors(a, b).multiplyScalar(0.5);
        _v.subVectors(b, a); const L = _v.length();
        if (L > 1e-4) s.quaternion.setFromUnitVectors(_z, _v.divideScalar(L));
        s.scale.z = Math.max(0.6, L / 0.42);
      }
      if (r.t < 3 && Math.random() < dt * 4) this.spray(r.pts[r.pts.length - 1], UPV, 1, 2, { size: 0.15, mark: 1 });
    }
    for (const c of this.chunks) {
      if (c.rest) continue;
      c.v.y -= 75 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
      if (c.m.position.y < 0.22) {
        c.m.position.y = 0.22;
        if (Math.abs(c.v.y) > 6) { this.splat(_v.set(c.m.position.x, 0.02, c.m.position.z), UPV, rand(1, 1.8)); G.sound && G.sound.splat(c.m.position); }
        c.v.y = -c.v.y * 0.25; c.v.x *= 0.6; c.v.z *= 0.6; c.w.multiplyScalar(0.5);
        if (c.v.lengthSq() < 1) c.rest = true;
      }
    }
  }
}
const UPV = new THREE.Vector3(0, 1, 0);
