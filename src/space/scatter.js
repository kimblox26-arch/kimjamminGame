// FREE FREELY 우주 탐사 - 근거리 인스턴싱: 나무·바위 (지표), 고리·소행성대 입자 (우주)
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function hash(i, j, k) {
  let h = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function treeGeometry(alien) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.32, 4, 6);
  trunk.translate(0, 2, 0);
  parts.push([trunk, new THREE.Color(alien ? '#3a2a30' : '#4a3626')]);
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(2.6 - i * 0.6, 4.2, 7);
    c.translate(0, 4.2 + i * 2.4, 0);
    parts.push([c, new THREE.Color(alien ? ['#3c1846', '#4a1c58', '#5a2468'][i] : ['#1f3d18', '#26481c', '#2f5422'][i])]);
  }
  return mergeColored(parts);
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = 0.7 + hash(Math.round(p.getX(i) * 50), Math.round(p.getY(i) * 50), Math.round(p.getZ(i) * 50)) * 0.55;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function mergeColored(parts) {
  let n = 0;
  for (const [g] of parts) n += g.toNonIndexed().getAttribute('position').count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const [g0, c] of parts) {
    const g = g0.toNonIndexed();
    g.computeVertexNormals();
    const p = g.getAttribute('position'), nn = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++, o++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3);
      nrm.set([nn.getX(i), nn.getY(i), nn.getZ(i)], o * 3);
      col.set([c.r, c.g, c.b], o * 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 지표 식생·바위 (행성 하나, 카메라 주변) */
export class SurfaceScatter {
  constructor(scene, scheduler) {
    this.scene = scene;
    this.scheduler = scheduler;
    this.count = 4000;
    this.radius = 1500;
    this.meshes = {};
    this.active = null;     // { body, anchor(Vector3 planet-local), t1, t2, up }
    this.pending = false;
    this.reqId = 0;
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.05 });
    this.materials = { tree: treeMat, rock: rockMat };
    this.geos = { tree: treeGeometry(false), alien: treeGeometry(true), rock: rockGeometry() };
  }

  setQuality(q) { this.count = { low: 0, medium: 2600, high: 5200, ultra: 9000 }[q] ?? 2600; this.radius = { low: 800, medium: 1300, high: 1700, ultra: 2200 }[q] ?? 1300; this._reset(); }

  _reset() {
    for (const k in this.meshes) { this.scene.remove(this.meshes[k]); this.meshes[k].dispose(); }
    this.meshes = {};
    this.active = null;
  }

  _mesh(kind, n) {
    let m = this.meshes[kind];
    if (!m || m.instanceMatrix.count < n) {
      if (m) { this.scene.remove(m); m.dispose(); }
      m = new THREE.InstancedMesh(kind === 'rock' ? this.geos.rock : kind === 'alien' ? this.geos.alien : this.geos.tree, kind === 'rock' ? this.materials.rock : this.materials.tree, Math.max(1, n));
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      m.layers.enable(1);
      m.count = 0;
      this.scene.add(m);
      this.meshes[kind] = m;
    }
    return m;
  }

  /**
   * @param near { body, view } 가까운 지형 천체
   * @param camL 행성 로컬 카메라 위치
   * @param agl 지표 고도
   */
  update(near, camL, agl, rel) {
    const ok = near && near.view && near.view.terrain && agl < 4000 && this.count > 0;
    if (!ok) { for (const k in this.meshes) this.meshes[k].visible = false; this.active = null; return; }
    const body = near.body;
    const R = body.radius;
    const kind = body.terrain.kind;
    const trees = kind === 'terran';
    const meshKind = trees ? (body.terrain.alien ? 'alien' : 'tree') : 'rock';
    const dir = camL.clone().normalize();
    // 다시 배치할지 판정
    const need = !this.active || this.active.body !== body || this.active.anchor.distanceTo(dir.clone().multiplyScalar(R)) > this.radius * 0.3;
    if (need && !this.pending) this._request(body, dir, meshKind);
    // 행렬 갱신 (카메라 기준)
    for (const k in this.meshes) this.meshes[k].visible = false;
    if (this.active && this.active.body === body) {
      const m = this.meshes[this.active.kind];
      if (m) {
        m.visible = true;
        _p.copy(this.active.anchor).applyQuaternion(body.rotation).add(rel);
        m.matrix.makeRotationFromQuaternion(body.rotation);
        m.matrix.elements[12] = _p.x; m.matrix.elements[13] = _p.y; m.matrix.elements[14] = _p.z;
        m.matrixWorld.copy(m.matrix);
      }
    }
  }

  _request(body, dir, meshKind) {
    this.pending = true;
    const R = body.radius;
    const t1 = new THREE.Vector3(0, 1, 0).cross(dir);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = dir.clone().cross(t1).normalize();
    // 격자 정렬 (흔들림 방지): 앵커를 셀 크기로 스냅
    const area = Math.PI * this.radius * this.radius;
    const cell = Math.sqrt(area / this.count);
    const anchor = dir.clone().multiplyScalar(R);
    const n = Math.ceil(this.radius / cell);
    const pts = [];
    const meta = [];
    // 앵커 좌표 기준 정수 격자 (전역 정렬용 오프셋)
    const gx0 = Math.round(anchor.dot(t1) / cell), gz0 = Math.round(anchor.dot(t2) / cell);
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const gi = gx0 + i, gj = gz0 + j;
      const jx = hash(gi, gj, 1) - 0.5, jz = hash(gi, gj, 2) - 0.5;
      const x = (i + jx) * cell, z = (j + jz) * cell;
      if (x * x + z * z > this.radius * this.radius) continue;
      const p = anchor.clone().addScaledVector(t1, x).addScaledVector(t2, z).normalize();
      pts.push(p.x, p.y, p.z);
      meta.push([gi, gj]);
    }
    const id = ++this.reqId;
    this.scheduler.scatter(body.id, 'scatter' + id, { points: new Float32Array(pts), minW: 3, eps: 4 / R, tx: [t1.x, t1.y, t1.z], tz: [t2.x, t2.y, t2.z] }, (data) => {
      this.pending = false;
      if (id !== this.reqId) return;
      this._apply(body, anchor, dir, pts, meta, data, meshKind);
    });
  }

  _apply(body, anchor, dir, pts, meta, data, meshKind) {
    const R = body.radius;
    const kind = body.terrain.kind;
    const sea = body.terrain.ocean;
    const m = this._mesh(meshKind, meta.length);
    let k = 0;
    const color = new THREE.Color();
    const pal = { mars: '#7a4a32', moon: '#6a6866', ice: '#a8c4dc', hot: '#3a3028', lava: '#2a2420', io: '#a89040', titan: '#5a4224', asteroid: '#5a544e' }[kind] || '#6a6460';
    _q.setFromUnitVectors(_up, dir);
    for (let i = 0; i < meta.length; i++) {
      const h = data[i * 4], moist = data[i * 4 + 1], slope = data[i * 4 + 3];
      const [gi, gj] = meta[i];
      const r = hash(gi, gj, 7);
      let place, scale;
      if (meshKind !== 'rock') {
        // 숲: 습한 저지대, 완만한 경사, 해변·설선 제외
        const lat = Math.abs(pts[i * 3 + 1]);
        const temp = 1 - lat * 1.05 - Math.max(0, h) / 7000;
        place = h > 12 && (!sea || h > 3) && slope < 0.55 && moist > 0.42 + r * 0.25 && temp > 0.18 && temp < 0.95;
        scale = 0.7 + hash(gi, gj, 9) * 1.1;
      } else {
        place = slope < 1.2 && r < 0.55 && (!sea || h > 0);
        scale = 0.3 + Math.pow(hash(gi, gj, 9), 3) * 4.5;
      }
      if (!place) continue;
      _p.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).multiplyScalar(R + h - (meshKind === 'rock' ? scale * 0.25 : 0.4)).sub(anchor);
      const rot = new THREE.Quaternion().setFromAxisAngle(_up, r * Math.PI * 2);
      const qq = _q.clone().multiply(rot);
      if (meshKind === 'rock') qq.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(r * 3, hash(gi, gj, 4) * 3, 0)));
      _s.setScalar(scale);
      if (meshKind !== 'rock') _s.y *= 0.8 + hash(gi, gj, 11) * 0.6;
      _m.compose(_p, qq, _s);
      m.setMatrixAt(k, _m);
      if (meshKind === 'rock') { color.set(pal).multiplyScalar(0.7 + hash(gi, gj, 13) * 0.5); m.setColorAt(k, color); }
      else { color.setRGB(0.8 + r * 0.4, 0.85 + hash(gi, gj, 5) * 0.3, 0.8); m.setColorAt(k, color); }
      k++;
    }
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    this.active = { body, anchor, kind: meshKind };
  }
}

/** 고리·소행성대 근접 입자 (카메라 주변 셀에서 해시로 생성) */
export class ParticleField {
  constructor(scene, max = 2400) {
    this.max = max;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(rockGeometry(), mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.count = 0;
    this.mesh.layers.enable(1);
    scene.add(this.mesh);
    this.cell = 160;
    this._color = new THREE.Color();
  }

  /**
   * @param region { body, kind: 'ring'|'belt', density(0..1), camLocal(Vector3 천체 로컬), rel(카메라 기준 천체 중심), rotation, palette }
   */
  update(region) {
    if (!region || region.density <= 0.01) { this.mesh.visible = false; return; }
    const m = this.mesh;
    m.visible = true;
    const c = this.cell;
    const cam = region.camLocal;
    const ci = Math.floor(cam.x / c), cj = Math.floor(cam.y / c), ck = Math.floor(cam.z / c);
    const span = region.kind === 'ring' ? 5 : 6;
    let n = 0;
    const isIce = region.palette === 'ice';
    for (let k = -span; k <= span && n < this.max; k++) for (let j = -2; j <= 2 && n < this.max; j++) for (let i = -span; i <= span && n < this.max; i++) {
      const gi = ci + i, gj = cj + j, gk = ck + k;
      const r = hash(gi, gj, gk);
      if (r > region.density * (region.kind === 'ring' ? 0.9 : 0.25)) continue;
      _p.set((gi + hash(gi, gj, gk + 1)) * c, (gj + hash(gi, gj + 7, gk)) * c * (region.kind === 'ring' ? 0.08 : 1), (gk + hash(gi + 3, gj, gk)) * c);
      if (region.kind === 'ring') _p.y = (hash(gi, gj, gk + 5) - 0.5) * 30;
      const d = _p.distanceTo(cam);
      if (d > c * span) continue;
      _p.sub(cam);
      const sz = (region.kind === 'ring' ? 0.4 + Math.pow(hash(gi, gj, gk + 2), 4) * 9 : 2 + Math.pow(hash(gi, gj, gk + 2), 5) * 60);
      _q.setFromEuler(new THREE.Euler(r * 6, hash(gi, gj, gk + 3) * 6, hash(gi, gj, gk + 4) * 6));
      _s.setScalar(sz);
      _m.compose(_p, _q, _s);
      m.setMatrixAt(n, _m);
      const b = 0.6 + hash(gi, gj, gk + 6) * 0.5;
      this._color.set(isIce ? '#d8e6f2' : region.kind === 'belt' ? '#6a625a' : '#cbb898').multiplyScalar(b);
      m.setColorAt(n, this._color);
      n++;
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // 로컬 → 월드: 천체 자세, 카메라 위치가 원점
    m.matrix.makeRotationFromQuaternion(region.rotation);
    m.matrixWorld.copy(m.matrix);
  }
}
