// 자동차: 아케이드식 주행(가속·브레이크·조향·미끄러짐), 벽·나무 충돌, 사람과 부딪히면 회전 박스 충돌로 밀어냄
import * as THREE from 'three';

const V = THREE.Vector3;
const _a = new V(), _b = new V();
// 차 좌표: +Z 앞, +X 왼쪽, 바닥 y=0
const L = 4.5, W = 1.84, HALF = new V(0.93, 0.66, 2.27);
export const SEAT = new V(0.37, 0.42, -0.25);     // 운전석 엉덩이 위치 (왼쪽 운전석)
const WHEEL_C = new V(0.37, 1.1, 0.26);          // 운전대 중심

function extrudeSide(pts, depth, bevel = 0.07) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -depth / 2); g.rotateY(-Math.PI / 2); g.computeVertexNormals();
  return g;
}
// 차체 아랫부분 (창문 아래 선까지)
function bodyGeo() { return extrudeSide([[-2.25, 0.32], [2.2, 0.32], [2.27, 0.5], [2.22, 0.72], [1.95, 0.86], [1.0, 0.98], [0.62, 1.03], [-1.6, 1.06], [-2.18, 1.02], [-2.27, 0.75]], W - 0.16, 0.08); }
// 두 점 사이 기둥
function pillar(a, b, w, t) { const d = new V().subVectors(b, a), L = d.length(); const g = new THREE.BoxGeometry(w, L, t); g.translate(0, L / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z); return g; }
function sidePane(points, x) {
  const s = new THREE.Shape(); s.moveTo(points[0][0], points[0][1]); for (const p of points.slice(1)) s.lineTo(p[0], p[1]); s.closePath();
  const g = new THREE.ShapeGeometry(s); g.rotateY(x > 0 ? -Math.PI / 2 : Math.PI / 2); g.translate(x, 0, 0);
  if (x < 0) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, -p.getZ(i)); }
  return g;
}

export class Car {
  constructor(G, pos, yaw) {
    this.G = G; this.pos = pos.clone(); this.yaw = yaw; this.vel = new V(); this.steer = 0; this.spin = 0; this.occupant = null;
    this.speed = 0; this.pitch = 0; this.roll = 0; this.hitCd = 0; this.seat = SEAT;
    this.obb = { c: new V(), half: HALF.clone(), yaw, vel: new V(), car: this, fric: 1 };
    G.world.obbs.push(this.obb);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x9c1420, metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x1a2630, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.28, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
    const black = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 1, roughness: 0.15 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 });
    const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 2.2 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a10, emissiveIntensity: 1.2 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.8 });
    const inner = new THREE.MeshStandardMaterial({ color: 0x2b2a29, roughness: 0.85 });
    const g = this.group = new THREE.Group(); this.body = new THREE.Group(); g.add(this.body);
    const add = (geo, mat, x = 0, y = 0, z = 0, p = this.body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; p.add(m); return m; };
    add(bodyGeo(), paint);
    // 지붕·기둥 (창문 자리는 비워 둠)
    add(new THREE.BoxGeometry(W - 0.12, 0.07, 1.12), paint, 0, 1.43, -0.47);
    add(new THREE.BoxGeometry(W - 0.2, 0.02, 1.08), inner, 0, 1.39, -0.47);
    for (const x of [0.86, -0.86]) {
      add(pillar(new V(x, 1.0, 0.64), new V(x, 1.43, 0.06), 0.08, 0.1), paint);
      add(pillar(new V(x, 1.0, -0.45), new V(x, 1.43, -0.45), 0.08, 0.12), paint);
      add(pillar(new V(x, 1.0, -1.62), new V(x, 1.43, -1.0), 0.08, 0.14), paint);
    }
    add(new THREE.BoxGeometry(W - 0.3, 0.02, 2.1), inner, 0, 1.075, -0.5); // 실내 바닥(창틀 높이)

    // 유리: 앞유리·뒷유리·옆창
    // 유리 (몸체 둥근 모서리 바깥으로 살짝 띄움)
    const pane = (w, h, z, y, th) => { const m = add(new THREE.PlaneGeometry(w, h), glass, 0, y, z); m.rotation.x = th; m.castShadow = false; return m; };
    pane(W - 0.2, 0.7, 0.35, 1.225, -(Math.PI / 2 - Math.atan2(0.39, 0.57)));
    pane(W - 0.24, 0.7, -1.31, 1.25, Math.atan2(0.6, 0.35) + Math.PI);
    for (const x of [0.86, -0.86]) add(sidePane([[0.6, 1.06], [0.06, 1.41], [-0.98, 1.41], [-1.58, 1.08]], x), glass).castShadow = false;
    // 범퍼·그릴·라이트
    add(new THREE.BoxGeometry(W - 0.1, 0.18, 0.12), black, 0, 0.42, 2.3); add(new THREE.BoxGeometry(W - 0.1, 0.18, 0.12), black, 0, 0.42, -2.3);
    add(new THREE.BoxGeometry(0.9, 0.12, 0.04), black, 0, 0.64, 2.29);
    for (const x of [0.62, -0.62]) { add(new THREE.BoxGeometry(0.36, 0.1, 0.05), head, x, 0.72, 2.25); add(new THREE.BoxGeometry(0.34, 0.1, 0.05), tail, x, 0.86, -2.27); }
    for (const x of [W / 2 + 0.06, -(W / 2 + 0.06)]) add(new THREE.BoxGeometry(0.06, 0.1, 0.18), paint, x, 1.08, 0.6);
    // 실내: 좌석·대시보드·운전대
    for (const x of [0.37, -0.37]) { add(new THREE.BoxGeometry(0.5, 0.14, 0.5), seat, x, 0.38, -0.2); const bk = add(new THREE.BoxGeometry(0.5, 0.62, 0.12), seat, x, 0.72, -0.5); bk.rotation.x = -0.18; }
    add(new THREE.BoxGeometry(W - 0.22, 0.16, 0.42), inner, 0, 1.12, 0.5);  // 대시보드
    add(new THREE.BoxGeometry(0.34, 0.1, 0.06), black, 0.37, 1.17, 0.3);      // 계기판
    this.wheelSt = new THREE.Group(); this.wheelSt.position.copy(WHEEL_C); this.wheelSt.rotation.x = 0.44; this.body.add(this.wheelSt);
    add(new THREE.TorusGeometry(0.19, 0.022, 10, 32), black, 0, 0, 0, this.wheelSt);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12).rotateX(Math.PI / 2), black, 0, 0, 0, this.wheelSt);
    add(new THREE.BoxGeometry(0.36, 0.03, 0.02), black, 0, 0, 0, this.wheelSt);
    // 바퀴
    this.wheels = [];
    for (const [x, z] of [[0.82, 1.42], [-0.82, 1.42], [0.82, -1.38], [-0.82, -1.38]]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.34, z); g.add(pivot);
      const w = new THREE.Group(); pivot.add(w);
      add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 28).rotateZ(Math.PI / 2), tire, 0, 0, 0, w);
      add(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 20).rotateZ(Math.PI / 2), chrome, 0, 0, 0, w);
      for (let k = 0; k < 5; k++) { const sp = add(new THREE.BoxGeometry(0.255, 0.05, 0.03), black, 0, 0, 0, w); sp.rotation.x = k / 5 * Math.PI; }
      this.wheels.push({ pivot, w, front: z > 0 });
    }
    G.scene.add(g);
    this.update(0, {});
  }
  get fwd() { return _a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  // 차 좌표 → 월드
  toWorld(local, out = new V()) { const c = Math.cos(this.yaw), s = Math.sin(this.yaw); return out.set(this.pos.x + local.x * c + local.z * s, this.pos.y + local.y, this.pos.z - local.x * s + local.z * c); }
  dirToWorld(local, out = new V()) { const c = Math.cos(this.yaw), s = Math.sin(this.yaw); return out.set(local.x * c + local.z * s, local.y, -local.x * s + local.z * c); }
  seatFrame() { return { pos: this.toWorld(SEAT), yaw: this.yaw }; }
  // 운전대를 잡는 두 손 (손바닥 방향 포함)
  wheelHold() {
    const st = this.wheelSt; st.updateWorldMatrix(true, false);
    const m = st.matrixWorld, curl = [[0.5, 0.6, 0.4], [1.0, 1.15, 0.7], [1.05, 1.2, 0.75], [1.1, 1.25, 0.75], [1.15, 1.3, 0.75]];
    const mk = (ang, side) => {
      const p = new V(Math.cos(ang) * 0.19, Math.sin(ang) * 0.19, 0).applyMatrix4(m);
      const out = new V(Math.cos(ang), Math.sin(ang), 0).transformDirection(m);   // 바퀴 바깥쪽
      const back = new V(0, 0, -1).transformDirection(m);                           // 운전자 쪽
      return { grip: p, F: out.clone().multiplyScalar(-0.25).sub(back).normalize(), U: out.clone().negate(), curl, pole: this.dirToWorld(new V(side * 0.8, -1, -0.3)) };
    };
    return { L: mk(Math.PI * 0.12, 1), R: mk(Math.PI * 0.88, -1) };
  }

  update(dt, inp) {
    const G = this.G, W_ = G.world;
    const drive = !!this.occupant && dt > 0;
    let fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), lx = Math.cos(this.yaw), lz = -Math.sin(this.yaw);
    let fwdS = this.vel.x * fx + this.vel.z * fz, lat = this.vel.x * lx + this.vel.z * lz;
    const thr = drive ? (inp.w ? 1 : 0) - (inp.s ? 1 : 0) : 0, st = drive ? (inp.a ? 1 : 0) - (inp.d ? 1 : 0) : 0, hb = drive && inp.space;
    if (thr > 0) fwdS += (fwdS < -0.3 ? 16 : 9.5 * (1 - Math.max(0, fwdS) / 44)) * dt;
    else if (thr < 0) fwdS -= (fwdS > 0.3 ? 16 : 5) * dt;
    else fwdS -= Math.sign(fwdS) * Math.min(Math.abs(fwdS), 1.8 * dt);
    fwdS = Math.max(-9, Math.min(44, fwdS)) * Math.exp(-0.04 * dt);
    if (hb) fwdS *= Math.exp(-1.4 * dt);
    const maxSt = 0.6 / (1 + Math.abs(fwdS) / 14);
    this.steer += (st * maxSt - this.steer) * Math.min(1, dt * 5);
    const yawRate = fwdS * Math.tan(this.steer) / 2.65;
    this.yaw += yawRate * dt;
    lat *= Math.exp(-dt * (hb ? 1.2 : 9));
    this.skid = Math.abs(lat) > 2.2 ? Math.min(1, (Math.abs(lat) - 2.2) / 5) : 0;
    fx = Math.sin(this.yaw); fz = Math.cos(this.yaw); lx = Math.cos(this.yaw); lz = -Math.sin(this.yaw);
    const prev = this.vel.clone();
    this.vel.set(fx * fwdS + lx * lat, 0, fz * fwdS + lz * lat);
    this.pos.addScaledVector(this.vel, dt);
    // 충돌: 차를 원 3개로 보고 벽·나무·건물·저수지 가장자리에서 밀어냄
    this.hitCd = Math.max(0, this.hitCd - dt);
    for (const oz of [-1.45, 0, 1.45]) {
      const cx = this.pos.x + fx * oz, cz = this.pos.z + fz * oz, r = 0.95;
      const push = (nx, nz, d) => { this.pos.x += nx * d; this.pos.z += nz * d; const vn = this.vel.x * nx + this.vel.z * nz; if (vn < 0) { if (-vn > 4 && this.hitCd <= 0) { G.audio.thud(new V(cx, 0.6, cz), Math.min(2, -vn / 8)); G.shake(Math.min(1, -vn / 15)); this.hitCd = 0.4; } this.vel.x -= nx * vn * 1.25; this.vel.z -= nz * vn * 1.25; this.vel.multiplyScalar(0.92); } };
      for (const b of W_.solids) {
        if (b.max.y < 0.3 || b.min.y > 1.4 || cx < b.min.x - r || cx > b.max.x + r || cz < b.min.z - r || cz > b.max.z + r) continue;
        const qx = Math.max(b.min.x, Math.min(cx, b.max.x)), qz = Math.max(b.min.z, Math.min(cz, b.max.z));
        let dx = cx - qx, dz = cz - qz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-4) { dx = cx - (b.min.x + b.max.x) / 2; dz = cz - (b.min.z + b.max.z) / 2; d = Math.hypot(dx, dz) || 1; push(dx / d, dz / d, 0.2); continue; }
        push(dx / d, dz / d, r - d);
      }
      const P = W_.water; // 저수지에는 못 들어감
      if (cx > P.min.x - r && cx < P.max.x + r && cz > P.min.z - r && cz < P.max.z + r) {
        const ds = [cx - (P.min.x - r), (P.max.x + r) - cx, cz - (P.min.z - r), (P.max.z + r) - cz]; let k = 0; for (let i = 1; i < 4; i++) if (ds[i] < ds[k]) k = i;
        push([-1, 1, 0, 0][k], [0, 0, -1, 1][k], ds[k]);
      }
    }
    this.speed = this.vel.length() * Math.sign(fwdS || 1);
    // 보이는 움직임: 바퀴 회전·조향, 차체 기울기
    if (dt > 0) {
      const acc = (fwdS - (prev.x * fx + prev.z * fz)) / dt;
      this.pitch += (-acc * 0.004 - this.pitch) * Math.min(1, dt * 6);
      this.roll += (yawRate * fwdS * 0.0025 - this.roll) * Math.min(1, dt * 6);
    }
    this.spin += fwdS * dt / 0.34;
    for (const w of this.wheels) { w.w.rotation.x = this.spin; w.pivot.rotation.y = w.front ? this.steer : 0; }
    this.wheelSt.rotation.z = -this.steer * 2.5;
    this.group.position.copy(this.pos); this.group.rotation.set(0, this.yaw, 0);
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.group.updateMatrixWorld(true);
    // 사람과의 충돌 박스
    const o = this.obb; o.yaw = this.yaw; o.vel.copy(this.vel); o.c.copy(this.toWorld(new V(0, 0.12 + HALF.y, 0)));
    // 소리
    if (G.audio.ctx) G.audio.engine(drive ? Math.abs(fwdS) : -1, this.skid * (Math.abs(fwdS) > 3 ? 1 : 0), this.pos);
  }
  nearDoor(p) { return this.toWorld(new V(1.5, 0, -0.2)).setY(p.y).distanceTo(p) < 2.2 || this.pos.distanceTo(_b.set(p.x, 0, p.z)) < 3; }
  exitPoint() { return this.toWorld(new V(1.6, 0, -0.2)).setY(0); }
}
