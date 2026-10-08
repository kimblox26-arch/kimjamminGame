// 2차 재해: 유리창 파손(수압·흐름·지진) + 유리 파편 물리, 전신주 전도(강체 회전) · 단선 · 아크 · 감전 구역 · 정전
import * as THREE from 'three';
import { HALF } from './config.js';
import { inlandDist, districtAt } from './geo.js';
import { cyl, box, merge } from './geom.js';

const G = 9.81;
const tmpS = {};

export class Hazards {
  constructor(scene, ctx, quality = 'medium', audio = null) {
    this.scene = scene;
    this.ctx = ctx;                     // { terrain, city, sim, bodies }
    this.audio = audio;
    this.low = quality === 'low';
    this.power = new Float32Array(16).fill(1);   // 구역별 전력
    this.onEvent = null;                         // (type, x, y, z)
    this.buildGlass();
    this.buildGrid();
    this.buildSparks();
  }

  /* ───────────────────────── 유리창 ───────────────────────── */
  buildGlass() {
    const city = this.ctx.city, n = city.buildings.length;
    // aBreak: x 깨진 높이(m) · y 전력 · z 최고 침수 높이(흙탕 자국) · w 지진 파손 비율
    this.aBreak = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.aBreak[i * 4 + 1] = 1;
    city.bMesh.geometry.setAttribute('aBreak', new THREE.InstancedBufferAttribute(this.aBreak, 4));
    for (const b of city.buildings) { b.brokenH = 0; b.shakeBreak = 0; }
    // 파편: 작은 삼각 조각 (회전하며 떨어지고 물에서는 흐름을 따라 표류)
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.09, 0, -0.06, -0.05, 0, 0.07, -0.04, 0], 3));
    tri.computeVertexNormals();
    this.shardMax = this.low ? 260 : 600;
    this.shardMesh = new THREE.InstancedMesh(tri, new THREE.MeshStandardMaterial({
      color: 0xd8eef2, metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.8, side: THREE.DoubleSide, envMapIntensity: 2.5,
    }), this.shardMax);
    this.shardMesh.frustumCulled = false;
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.count = 0;
    this.scene.add(this.shardMesh);
    this.shards = [];
    this.glassT = 0;
  }

  /** 건물 한 면에서 유리 파편 분출 */
  shatter(b, y0, y1, camPos) {
    const near = camPos && Math.hypot(b.x - camPos.x, b.z - camPos.z) < 450;
    if (!near) return;
    const count = Math.min(70, Math.round((b.w + b.d) * (y1 - y0) * 0.35));
    for (let i = 0; i < count && this.shards.length < this.shardMax; i++) {
      const side = Math.floor(Math.random() * 4), t = Math.random() - 0.5;
      const nx = side === 0 ? 1 : side === 1 ? -1 : 0, nz = side === 2 ? 1 : side === 3 ? -1 : 0;
      const x = b.x + (nx ? nx * b.w / 2 : t * b.w), z = b.z + (nz ? nz * b.d / 2 : t * b.d);
      const out = 0.5 + Math.random() * 2.5;
      this.shards.push({
        x: x + nx * 0.2, y: b.base + y0 + Math.random() * (y1 - y0), z: z + nz * 0.2,
        vx: nx * out + (Math.random() - 0.5), vy: Math.random() * 1.5, vz: nz * out + (Math.random() - 0.5),
        rx: Math.random() * 6, ry: Math.random() * 6, wx: (Math.random() - 0.5) * 18, wy: (Math.random() - 0.5) * 18,
        s: 0.6 + Math.random() * 1.6, life: 10 + Math.random() * 8, rest: false,
      });
    }
    if (this.audio && this.audio.glass) {
      const d = Math.hypot(b.x - camPos.x, b.z - camPos.z);
      this.audio.glass(Math.max(0.05, 1 - d / 400) * Math.min(1, count / 25));
    }
  }

  updateGlass(dt, quake, camPos) {
    const city = this.ctx.city, A = this.aBreak;
    this.glassT += dt;
    let dirty = false;
    if (this.glassT > 0.2) {
      const step = this.glassT; this.glassT = 0;
      for (const b of city.buildings) {
        if (b.style === 9) continue;
        let target = b.brokenH;
        // 수압·흐름: 유리 한계(약 2~4 kPa)를 넘는 층까지 파손
        const wd = b.waterDepth || 0;
        if (wd > 0.25 && (b.load || 0) > 2.5) target = Math.max(target, Math.min(b.h, wd * 1.3 + 0.8));
        if (!b.alive && b.collapse >= 0) target = b.h;
        // 지진: 고층 일부 창 파손
        if (quake > 0.45 && b.floors >= 3 && Math.random() < step * 0.15 * quake) b.shakeBreak = Math.min(0.35, b.shakeBreak + 0.05 * quake);
        if (target > b.brokenH + 0.4) {
          this.shatter(b, b.brokenH, target, camPos);
          b.brokenH = target;
          if (this.onEvent) this.onEvent('glass', b.x, b.base + target, b.z);
        }
        const i = b.idx * 4, mark = Math.max(A[i + 2], wd);
        if (A[i] !== b.brokenH || mark > A[i + 2] + 0.05 || A[i + 3] !== b.shakeBreak) {
          A[i] = b.brokenH; A[i + 2] = mark; A[i + 3] = b.shakeBreak; dirty = true;
        }
      }
    }
    // 파편 운동: 중력 · 공기 저항 · 지면 충돌 · 물에서 부유 표류 후 가라앉음
    const { terrain, sim } = this.ctx;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    for (let k = this.shards.length - 1; k >= 0; k--) {
      const S = this.shards[k];
      S.life -= dt;
      if (S.life <= 0) { this.shards.splice(k, 1); continue; }
      if (!S.rest) {
        sim.sample(S.x, S.z, tmpS);
        const g = terrain.groundAt(S.x, S.z), wet = tmpS.eta > g + 0.05 && S.y < tmpS.eta;
        if (wet) {
          S.vx += (tmpS.u - S.vx) * Math.min(1, dt * 3); S.vz += (tmpS.v - S.vz) * Math.min(1, dt * 3);
          S.vy += (-0.6 - S.vy) * Math.min(1, dt * 4);
        } else {
          S.vy -= G * dt;
          const k2 = 1 - Math.min(1, dt * 0.6);
          S.vx *= k2; S.vz *= k2;
        }
        S.x += S.vx * dt; S.y += S.vy * dt; S.z += S.vz * dt;
        S.rx += S.wx * dt; S.ry += S.wy * dt;
        if (S.y < g + 0.01) {
          S.y = g + 0.01;
          if (Math.abs(S.vy) > 1.2) { S.vy *= -0.25; S.vx *= 0.5; S.vz *= 0.5; S.wx *= 0.5; }
          else { S.rest = true; S.rx = Math.PI / 2; }
        }
      }
      e.set(S.rx, S.ry, 0); q.setFromEuler(e); s.setScalar(S.s);
      m.compose(p.set(S.x, S.y, S.z), q, s);
      this.shardMesh.setMatrixAt(n++, m);
    }
    this.shardMesh.count = n;
    if (n) this.shardMesh.instanceMatrix.needsUpdate = true;
    if (dirty) city.bMesh.geometry.attributes.aBreak.needsUpdate = true;
  }

  /* ───────────────────────── 전력망 ───────────────────────── */
  buildGrid() {
    const { city, terrain } = this.ctx;
    const max = this.low ? 70 : 140;
    this.poles = [];
    this.lines = [];
    // 해안 가까운 도로를 따라 35 m 간격 전신주
    const roads = city.roads.filter((r) => r.kind !== 'coastal' && r.w < 30)
      .map((r) => ({ r, d: Math.max(-1, inlandDist((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2)) }))
      .filter((o) => o.d > 60 && o.d < 900).sort((a, b) => a.d - b.d);
    for (const { r } of roads) {
      if (this.poles.length >= max) break;
      const L = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
      if (L < 70) continue;
      const ux = (r.x1 - r.x0) / L, uz = (r.z1 - r.z0) / L, off = r.w / 2 + 1.2;
      const line = [];
      for (let s = 15; s < L - 10 && this.poles.length < max; s += 35) {
        const x = r.x0 + ux * s - uz * off, z = r.z0 + uz * s + ux * off;
        if (city.buildingAt && city.buildingAt(x, z, 1)) continue;
        const g = terrain.groundAt(x, z);
        if (g < 0.5) continue;
        const pole = { x, z, g, ux, uz, H: 9, th: 0, w: 0, fx: 0, fz: 0, falling: false, down: false, district: Math.max(0, districtAt(x, z)), trans: Math.random() < 0.15 };
        this.poles.push(pole);
        line.push(pole);
      }
      if (line.length > 1) this.lines.push(line);
    }
    // 메시: 기둥 + 완금 + 애자 (+ 변압기)
    const pg = merge([
      cyl(0.13, 0.18, 9, 8, 0, 4.5, 0, 0x8a8478),
      box(2.0, 0.12, 0.12, 0, 8.4, 0, 0x5a5a58),
      ...[-0.8, 0, 0.8].map((ox) => cyl(0.05, 0.06, 0.25, 6, ox, 8.6, 0, 0xd8d0c0)),
    ]);
    const tg = cyl(0.32, 0.32, 0.9, 10, 0, 6.6, 0.35, 0x6a7078);
    this.poleMesh = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), Math.max(1, this.poles.length));
    this.poleMesh.count = this.poles.length;
    this.poleMesh.castShadow = true;
    this.transMesh = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), Math.max(1, this.poles.length));
    this.transMesh.castShadow = true;
    this.scene.add(this.poleMesh, this.transMesh);
    this.wireGeo = new THREE.BufferGeometry();
    this.wireMesh = new THREE.LineSegments(this.wireGeo, new THREE.LineBasicMaterial({ color: 0x1a1c1e, transparent: true, opacity: 0.85 }));
    this.wireMesh.frustumCulled = false;
    this.scene.add(this.wireMesh);
    this.live = [];          // 끊어져 땅/물에 닿은 활선 끝 { x, z, t, district, liveFor }
    this.arc = new THREE.PointLight(0xb8d8ff, 0, 60, 2);
    this.scene.add(this.arc);
    this.arcT = 0;
    this.refreshPoles();
  }

  poleTop(p, out, arm = 0) {
    // 기둥 축 회전: 넘어지는 방향(fx,fz)으로 th 만큼 기울어짐
    const s = Math.sin(p.th), c = Math.cos(p.th), h = 8.6;
    const ax = -p.uz, az = p.ux;     // 완금 방향(도로와 직각)
    out[0] = p.x + p.fx * s * h + ax * arm; out[1] = p.g + c * h; out[2] = p.z + p.fz * s * h + az * arm;
    return out;
  }

  refreshPoles() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), ax = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let ti = 0;
    for (let i = 0; i < this.poles.length; i++) {
      const P = this.poles[i];
      q.setFromAxisAngle(up, Math.atan2(P.ux, P.uz));
      if (P.th > 0) { ax.set(P.fz, 0, -P.fx); q2.setFromAxisAngle(ax, P.th); q.premultiply(q2); }
      m.compose(p.set(P.x, P.g, P.z), q, one);
      this.poleMesh.setMatrixAt(i, m);
      if (P.trans) this.transMesh.setMatrixAt(ti++, m);
    }
    this.transMesh.count = ti;
    this.poleMesh.instanceMatrix.needsUpdate = this.transMesh.instanceMatrix.needsUpdate = true;
    this.refreshWires();
  }

  refreshWires() {
    const pts = [], a = [0, 0, 0], b = [0, 0, 0], seg = 8;
    const push = (x0, y0, z0, x1, y1, z1, sag) => {
      let px = x0, py = y0, pz = z0;
      for (let k = 1; k <= seg; k++) {
        const t = k / seg, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
        pts.push(px, py, pz, x, y, z);
        px = x; py = y; pz = z;
      }
    };
    const terrain = this.ctx.terrain;
    for (const line of this.lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const P = line[i], Q = line[i + 1];
        for (const arm of [-0.8, 0, 0.8]) {
          this.poleTop(P, a, arm); this.poleTop(Q, b, arm);
          if (!P.down && !Q.down && P.th < 0.15 && Q.th < 0.15) { push(a[0], a[1], a[2], b[0], b[1], b[2], 0.45); continue; }
          // 끊어진 선: 서 있는 쪽 기둥에서 땅으로 늘어짐
          for (const [S, T, sp] of [[P, Q, a], [Q, P, b]]) {
            if (S.down || S.th > 0.15) continue;
            const ex = sp[0] + (T.x - S.x) * 0.45, ez = sp[2] + (T.z - S.z) * 0.45;
            push(sp[0], sp[1], sp[2], ex, terrain.groundAt(ex, ez) + 0.05, ez, 1.5);
          }
        }
      }
    }
    this.wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.wireGeo.computeBoundingSphere();
  }

  /** 전신주 넘어뜨림 (흐름 방향) */
  topple(P, fx, fz) {
    if (P.falling || P.down) return;
    const l = Math.hypot(fx, fz) || 1;
    P.fx = fx / l; P.fz = fz / l; P.falling = true; P.th = 0.04; P.w = 0;
  }

  buildSparks() {
    const n = this.low ? 300 : 700;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.sparkMax = n;
    this.sparks = [];
    this.sparkPts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparkPts.frustumCulled = false;
    this.scene.add(this.sparkPts);
  }

  burstSparks(x, y, z, n, power = 1) {
    for (let i = 0; i < n && this.sparks.length < this.sparkMax; i++) {
      const a = Math.random() * 6.283, e = Math.random() * 1.2, sp = (2 + Math.random() * 7) * power;
      this.sparks.push({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1, vz: Math.sin(a) * Math.cos(e) * sp, life: 0.25 + Math.random() * 0.9, t: 0 });
    }
    this.arc.position.set(x, y + 0.5, z);
    this.arcT = Math.max(this.arcT, 0.12 + Math.random() * 0.1);
    if (this.audio && this.audio.zap) this.audio.zap(Math.min(1, power));
    if (this.onEvent) this.onEvent('arc', x, y, z);
  }

  /** 감전 판정: 활선 끝에서 물에 잠긴 곳은 반경 18 m, 마른 땅은 2 m */
  electrified(x, z, depth = 0) {
    for (const L of this.live) {
      if (!this.power[L.district]) continue;
      const d = Math.hypot(x - L.x, z - L.z);
      if (d < 2 || (depth > 0.03 && L.wet && d < 18)) return true;
    }
    return false;
  }

  update(dt, quake, camPos) {
    if (dt <= 0) { this.renderSparks(0); return; }
    this.updateGlass(dt, quake, camPos);
    const { sim, terrain } = this.ctx;
    let moved = false;
    for (const P of this.poles) {
      if (P.down) continue;
      if (!P.falling) {
        // 기둥 밑동 항력: F ≈ ½ρ C_d D h u² — 임계값 넘으면 전도
        sim.sample(P.x, P.z, tmpS);
        const h = Math.max(0, tmpS.eta - P.g), u2 = tmpS.u * tmpS.u + tmpS.v * tmpS.v;
        const F = 0.5 * 1000 * 1.2 * 0.3 * h * u2 * (1 + h * 0.3);
        if (F > 9000 || (quake > 0.75 && Math.random() < dt * 0.01)) this.topple(P, tmpS.u || P.uz, tmpS.v || -P.ux);
        continue;
      }
      // 강체 막대가 밑동을 축으로 넘어짐: θ'' = (3g / 2L)·sinθ
      P.w += 1.5 * G / P.H * Math.sin(P.th) * dt;
      P.th += P.w * dt;
      moved = true;
      if (P.th >= 1.5) {
        P.th = 1.5; P.falling = false; P.down = true;
        const top = this.poleTop(P, [0, 0, 0]);
        sim.sample(top[0], top[2], tmpS);
        const wet = tmpS.eta > terrain.groundAt(top[0], top[2]) + 0.05;
        if (this.power[P.district]) {
          this.live.push({ x: top[0], z: top[2], t: 0, district: P.district, liveFor: 15 + Math.random() * 45, wet, nextArc: 0 });
          this.burstSparks(top[0], terrain.groundAt(top[0], top[2]) + 0.3, top[2], 80, 1.3);
        }
      }
    }
    if (moved) this.refreshPoles();
    // 활선: 물에서 아크 · 일정 시간 뒤 보호계전기 차단 → 구역 정전
    for (const L of this.live) {
      if (!this.power[L.district]) continue;
      L.t += dt;
      sim.sample(L.x, L.z, tmpS);
      L.wet = tmpS.eta > terrain.groundAt(L.x, L.z) + 0.05;
      L.nextArc -= dt;
      if (L.nextArc <= 0) { L.nextArc = 0.3 + Math.random() * (L.wet ? 1.2 : 2.5); this.burstSparks(L.x + (Math.random() - 0.5) * 2, Math.max(tmpS.eta, terrain.groundAt(L.x, L.z)) + 0.1, L.z + (Math.random() - 0.5) * 2, 18, 0.6); }
      if (L.t > L.liveFor) this.outage(L.district);
    }
    this.renderSparks(dt);
  }

  outage(d) {
    if (!this.power[d]) return;
    this.power[d] = 0;
    const city = this.ctx.city, A = this.aBreak;
    for (const b of city.buildings) if (b.district === d) A[b.idx * 4 + 1] = 0;
    city.bMesh.geometry.attributes.aBreak.needsUpdate = true;
    if (this.onEvent) this.onEvent('outage', 0, 0, 0, d);
  }

  renderSparks(dt) {
    const pos = this.sparkPts.geometry.attributes.position.array, col = this.sparkPts.geometry.attributes.color.array;
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      if (s.t > s.life) { this.sparks.splice(i, 1); continue; }
      s.vy -= G * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const k = 1 - s.t / s.life;
      pos[n * 3] = s.x; pos[n * 3 + 1] = s.y; pos[n * 3 + 2] = s.z;
      col[n * 3] = 1.6 * k; col[n * 3 + 1] = (1.2 * k * k + 0.2 * k); col[n * 3 + 2] = 0.8 * k * k * k;
      n++;
    }
    this.sparkPts.geometry.setDrawRange(0, n);
    this.sparkPts.geometry.attributes.position.needsUpdate = this.sparkPts.geometry.attributes.color.needsUpdate = true;
    this.arcT -= dt;
    this.arc.intensity = this.arcT > 0 ? 25 + Math.random() * 40 : 0;
  }

  reset() {
    const city = this.ctx.city, A = this.aBreak;
    for (const b of city.buildings) { b.brokenH = 0; b.shakeBreak = 0; A.set([0, 1, 0, 0], b.idx * 4); }
    city.bMesh.geometry.attributes.aBreak.needsUpdate = true;
    this.shards = [];
    this.sparks = [];
    this.live = [];
    this.power.fill(1);
    for (const P of this.poles) { P.th = 0; P.w = 0; P.falling = false; P.down = false; }
    this.refreshPoles();
  }
}
