// SpaceSim — N-체 시나리오 공통 기반 (태양계 · 쌍성 · 삼체 · 샌드박스)
import * as THREE from 'three';
import { NBody } from '../physics.js';
import { createBodyVisual, LIGHTS } from '../bodies.js';
import { Trail, Markers, OrbitLine, Flashes } from '../trails.js';
import { Debris } from '../debris.js';
import { orbitalElements, ellipsePoints, blackbody, clamp, fmtNum, fmtMass, fmtDuration, AUYR_KMS, AU_KM, TAU } from '../util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);

export class NBodyScenario {
  constructor(app, opt = {}) {
    this.app = app;
    this.opt = opt;
    this.units = opt.units ?? 'au';
    this.root = new THREE.Group();
    app.scene.add(this.root);
    this.sim = new NBody({ G: opt.G ?? 1, softening: opt.softening ?? 0, merge: !!opt.merge, adaptive: !!opt.adaptive, eta: opt.eta ?? 0.02 });
    this.bodies = this.sim.bodies;
    this.dtMax = opt.dtMax ?? 0.001;
    this.distScale = opt.distScale ?? 1;
    this.markers = new Markers(512, app.pixelRatio);
    this.root.add(this.markers.points);
    this.flashes = new Flashes(this.root);
    this.selected = null;
    this.frame = 0;
    this.simRate = 0;
    this._trailDue = 0;
    this.E0 = null;
    this.dE = 0;
    this.sim.onStep = () => { if (this.sim.time >= this._trailDue) this._pushTrails(); };
    this.sim.onMerge = (info) => this._onMerge(info);
    this.maxBodies = opt.maxBodies ?? 220;
    if (opt.merge) {
      this.debris = new Debris(this, app.quality.debrisCap);
      this.sim.onCollision = (a, b) => this._collide(a, b);
    }
  }

  // ── 천체 추가 ──
  addBody(d) {
    const temp = d.temp ?? 5800;
    const b = {
      name: d.name ?? '', type: d.type ?? '', kind: d.kind ?? 'planet', style: d.style, look: d.look, temp,
      color: new THREE.Color(d.color ?? (d.kind === 'star' ? blackbody(temp).getHex() : 0xaaaaaa)),
      visR: d.visR, enhR: d.visR, realR: d.realR ?? d.visR,
      parent: d.parent ?? null, moonScale: d.moonScale ?? 1, enhMoonScale: d.moonScale ?? 1,
      tilt: d.tilt ?? 0, rotRate: d.rotRate ?? 0.3, spin: Math.random() * 6.28,
      desc: d.desc ?? '', label: d.label !== false, small: !!d.small,
      trailDt: d.trailDt ?? this.opt.trailDt ?? 0.01, nextTrail: this.sim.time, orbit: d.orbit ?? true,
      vis: new THREE.Vector3(), px: 0, glow: d.glow, coronaI: d.coronaI, lightW: d.lightW ?? 1, heat: d.heat ?? 0,
      noMarker: !!d.noMarker, markerA: d.markerA, extra: d.extra, tex: d.tex, iau: d.iau,
    };
    if (b.kind === 'star') b.lightCol = blackbody(temp).multiplyScalar(b.lightW);
    this.sim.add(b, d.m, d.p, d.v, d.collideR ?? d.visR * (this.opt.collideScale ?? 1));
    this._makeVisual(b);
    b.trail = new Trail(d.trailLen ?? this.opt.trailLen ?? 400, b.color.clone().lerp(WHITE, 0.2), d.trailOpacity ?? 0.85);
    b.trail.line.visible = this.app.settings.trails;
    this.root.add(b.trail.line);
    if (b.label) b.labelEl = this.app.labels.add(b.name, () => this.select(b, true), b.parent ? 'moon' : '');
    if (b.orbit) { b.orbitLine = new OrbitLine(b.color.clone().lerp(WHITE, 0.3)); this.root.add(b.orbitLine.line); }
    this.E0 = null;
    this._trailDue = Math.min(this._trailDue, b.nextTrail);
    return b;
  }

  _makeVisual(b) {
    if (b.visual) { this.root.remove(b.visual.object); b.visual.dispose(); }
    b.visual = createBodyVisual(b, this.app);
    this.root.add(b.visual.object);
  }

  _disposeBody(b) {
    this.root.remove(b.visual.object); b.visual.dispose();
    this.root.remove(b.trail.line); b.trail.dispose();
    if (b.orbitLine) { this.root.remove(b.orbitLine.line); b.orbitLine.dispose(); }
    if (b.labelEl) this.app.labels.remove(b.labelEl);
    if (this.selected === b) this.select(null);
  }

  removeBody(b) {
    if (b.dead) return;
    this.sim.removeAt(b.idx);
    this._disposeBody(b);
    this.E0 = null;
  }

  _onMerge(info) {
    const a = info.survivor, b = info.absorbed;
    const k = Math.cbrt(info.massA + info.massB > 0 ? 1 + info.massB / Math.max(info.massA, 1e-30) : 1);
    if (a.kind !== 'star' && a.kind !== 'blackhole') {
      a.visR = a.enhR = Math.cbrt(a.visR ** 3 + b.visR ** 3);
      a.realR = Math.cbrt(a.realR ** 3 + b.realR ** 3);
      a.visual.setRadius(a.visR);
    }
    a.heat = Math.min(1, (a.heat ?? 0) + 0.6);
    _v.set(info.pos[0], info.pos[1], info.pos[2]).multiplyScalar(this.distScale);
    this.flashes.spawn(_v, Math.max(a.visR, b.visR) * 2.2 * Math.min(k, 2), a.kind === 'star' ? 0xffd2a0 : 0xffa060);
    this.app.audio?.blip(a.kind === 'star' ? 90 : 160 + Math.random() * 80);
    const wasSel = this.selected === b;
    this._disposeBody(b);
    if (wasSel) this.select(a, false);
    this.E0 = null;
    this.onMerged?.(info);
  }

  // ── 충돌: 파편 분출 · 표면 가열 · (고속) 파괴와 원시 위성 생성 ──
  _collide(a, b) {
    const s = this.sim, G = s.G;
    if (s.m[b.idx] > s.m[a.idx]) [a, b] = [b, a];
    const ia = a.idx, ib = b.idx, m1 = s.m[ia], m2 = s.m[ib], M = m1 + m2;
    const n = [s.x[ib] - s.x[ia], s.y[ib] - s.y[ia], s.z[ib] - s.z[ia]];
    const dist = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= dist; n[1] /= dist; n[2] /= dist;
    const dv = Math.hypot(s.vx[ib] - s.vx[ia], s.vy[ib] - s.vy[ia], s.vz[ib] - s.vz[ia]);
    const R1 = s.r[ia], R2 = s.r[ib];
    const vesc = Math.sqrt((2 * G * M) / Math.max(R1 + R2, 1e-15));
    const ratio = dv / Math.max(vesc, 1e-15);
    const vcm = ['vx', 'vy', 'vz'].map((k) => (s[k][ia] * m1 + s[k][ib] * m2) / M);
    const contact = [s.x[ia] + n[0] * R1, s.y[ia] + n[1] * R1, s.z[ia] + n[2] * R1];
    const compactA = a.kind === 'star' || a.kind === 'blackhole', compactB = b.kind === 'star' || b.kind === 'blackhole';
    const q = m2 / Math.max(m1, 1e-30);
    if (this.debris && !(compactA && compactB)) {
      const energy = Math.min(1, Math.cbrt(q) * 2.2 + 0.08) * clamp(ratio, 0.35, 3);
      const cnt = Math.round(this.app.quality.debris * Math.min(1.6, energy) * (compactA ? 0.45 : 1));
      if (cnt > 2) this.debris.burst({ pos: contact, n, vcm, vej: vesc * (compactA ? 0.3 : 0.65), size: Math.max(b.visR, a.visR * 0.3), count: cnt, hot: compactA ? 0.5 : 1 });
    }
    if (!compactA) {
      _w.set(n[0], n[1], n[2]);
      a.visual.impact(_w, Math.min(1.4, 0.35 + 0.45 * ratio) * Math.min(1, Math.cbrt(q) * 3 + 0.12), q > 0.03 ? Math.min(1.1, q * 6) : 0);
    }
    const catastrophic = this.opt.fragments && !compactA && !compactB && ratio > 1.3 && q > 0.008 && s.n < this.maxBodies;
    s.mergeBodies(a, b);
    if (catastrophic) this._fragment(a, n, ratio, M, m2);
    return true;
  }

  _fragment(a, n, ratio, M, m2) {
    const s = this.sim, G = s.G, R = Math.random, ia = a.idx;
    const flr = clamp(1 - 0.26 * (ratio - 1), 0.5, 0.94);
    const mFrag = Math.min(M * (1 - flr), m2 * 1.4);
    const k = Math.min(7, Math.max(2, Math.round(1 + ratio * 1.3)), this.maxBodies - s.n);
    if (k < 1 || mFrag / k < (this.opt.minFrag ?? 1e-11)) return;
    const Ra = s.r[ia], rRatio = Ra / Math.cbrt(M), vRatio = a.visR / Math.cbrt(M);
    const vesc = Math.sqrt((2 * G * M) / Ra);
    const w = Array.from({ length: k }, () => 0.25 + R() ** 2);
    const ws = w.reduce((x, y) => x + y, 0);
    const nv = new THREE.Vector3(n[0], n[1], n[2]);
    const up = Math.abs(nv.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const t1 = new THREE.Vector3().crossVectors(nv, up).normalize(), t2 = new THREE.Vector3().crossVectors(nv, t1);
    let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
    const base = [s.x[ia], s.y[ia], s.z[ia], s.vx[ia], s.vy[ia], s.vz[ia]];
    for (let j = 0; j < k; j++) {
      const mj = (mFrag * w[j]) / ws, rj = rRatio * Math.cbrt(mj);
      const ang = R() * TAU, spr = 0.35 + R() * 0.8;
      const dir = nv.clone().addScaledVector(t1, Math.cos(ang) * spr).addScaledVector(t2, Math.sin(ang) * spr).normalize();
      const tang = new THREE.Vector3().crossVectors(t2, dir).normalize();
      const off = (Ra + rj) * (1.35 + R() * 0.5), sp = vesc * (0.62 + R() * 0.5);
      const d = [dir.x * sp * 0.75 + tang.x * sp * 0.55, dir.y * sp * 0.75 + tang.y * sp * 0.55, dir.z * sp * 0.75 + tang.z * sp * 0.55];
      px += mj * d[0]; py += mj * d[1]; pz += mj * d[2];
      qx += mj * dir.x * off; qy += mj * dir.y * off; qz += mj * dir.z * off;
      this.addBody({
        name: '', label: false, small: true, style: 'lava', look: { colA: 0x2c241f, colB: 0x6a5446, spot: 1 }, heat: 1, color: 0xffa070,
        m: mj, visR: vRatio * Math.cbrt(mj), realR: a.realR * Math.cbrt(mj / M), collideR: rj,
        p: [base[0] + dir.x * off, base[1] + dir.y * off, base[2] + dir.z * off], v: [base[3] + d[0], base[4] + d[1], base[5] + d[2]],
        orbit: false, trailLen: 160, trailOpacity: 0.6, trailDt: this.opt.trailDt ?? 0.002, markerA: 0.6, type: '충돌 파편',
        desc: '거대 충돌로 떨어져 나온 용융 파편. 다시 떨어지거나 궤도를 돌다 뭉쳐 위성이 될 수 있습니다(달 형성 가설).',
      });
    }
    const Mr = M - mFrag;
    s.m[ia] = Mr;
    s.vx[ia] -= px / Mr; s.vy[ia] -= py / Mr; s.vz[ia] -= pz / Mr;
    s.x[ia] -= qx / Mr; s.y[ia] -= qy / Mr; s.z[ia] -= qz / Mr;
    s.r[ia] = rRatio * Math.cbrt(Mr);
    a.visR = a.enhR = vRatio * Math.cbrt(Mr);
    a.realR *= Math.cbrt(Mr / M);
    a.visual.setRadius(a.visR);
    s.accValid = false;
    this.app.toast?.(`파괴적 충돌! 파편 ${k}개 생성 (충돌 속도 = 탈출 속도의 ${ratio.toFixed(1)}배)`);
  }

  // ── 좌표 ──
  _visOf(b, out) {
    const s = this.distScale, i = b.idx, { x, y, z } = this.sim;
    const p = b.parent;
    if (p && !p.dead && b.moonScale !== 1) {
      const j = p.idx, k = b.moonScale * s;
      return out.set(x[j] * s + (x[i] - x[j]) * k, y[j] * s + (y[i] - y[j]) * k, z[j] * s + (z[i] - z[j]) * k);
    }
    return out.set(x[i] * s, y[i] * s, z[i] * s);
  }

  _pushTrails() {
    const t = this.sim.time;
    let due = Infinity;
    for (const b of this.bodies) {
      if (t >= b.nextTrail) {
        this._visOf(b, _v);
        if (b.parent && !b.parent.dead) { this._visOf(b.parent, _w); _v.sub(_w); }
        b.trail.push(_v.x, _v.y, _v.z);
        b.nextTrail = t + b.trailDt;
      }
      if (b.nextTrail < due) due = b.nextTrail;
    }
    this._trailDue = due;
  }

  resetTrails() { for (const b of this.bodies) { b.trail.reset(); b.nextTrail = this.sim.time; } this._trailDue = this.sim.time; }

  // 주천체 상태 (궤도 계산용)
  primaryOf(b) {
    if (b.parent && !b.parent.dead) return this._stateOf([b.parent]);
    if (this.opt.primary === 'stars' && b.kind !== 'star') {
      const stars = this.bodies.filter((s) => s.kind === 'star');
      if (stars.length) return this._stateOf(stars);
    }
    let best = null;
    for (const o of this.bodies) if (o !== b && (!best || this.sim.m[o.idx] > this.sim.m[best.idx])) best = o;
    if (!best || this.sim.m[best.idx] < this.sim.m[b.idx]) return null;
    return this._stateOf([best]);
  }

  _stateOf(list) {
    const s = this.sim, st = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, m: 0 };
    for (const o of list) {
      const i = o.idx, m = s.m[i];
      st.m += m;
      st.x += s.x[i] * m; st.y += s.y[i] * m; st.z += s.z[i] * m;
      st.vx += s.vx[i] * m; st.vy += s.vy[i] * m; st.vz += s.vz[i] * m;
    }
    if (st.m <= 0) return null;
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) st[k] /= st.m;
    st.single = list.length === 1 ? list[0] : null;
    return st;
  }

  relElements(b, P) {
    const s = this.sim, i = b.idx;
    _r.set(s.x[i] - P.x, s.y[i] - P.y, s.z[i] - P.z);
    _u.set(s.vx[i] - P.vx, s.vy[i] - P.vy, s.vz[i] - P.vz);
    const el = orbitalElements(_r, _u, s.G * (P.m + s.m[i]));
    el.dist = _r.length(); el.speed = _u.length();
    return el;
  }

  _updateOrbits() {
    const show = this.app.settings.orbits;
    for (const b of this.bodies) {
      const ol = b.orbitLine;
      if (!ol) continue;
      ol.line.visible = false;
      if (!show) continue;
      const P = this.primaryOf(b);
      if (!P) continue;
      const el = this.relElements(b, P);
      if (!(el.a > 0) || el.e >= 0.97) continue;
      const scale = this.distScale * (b.parent ? b.moonScale : 1);
      ellipsePoints(el, ol.buf, ol.n, scale);
      ol.commit();
      if (P.single) this._visOf(P.single, ol.line.position);
      else ol.line.position.set(P.x * this.distScale, P.y * this.distScale, P.z * this.distScale);
      ol.line.visible = true;
    }
  }

  // ── 시간 적분 ──
  simulate(dt, warp) {
    const want = warp * dt;
    const done = this.sim.advance(want, this.dtMax, this.app.budgetMs);
    this.lagging = done < want * 0.97;
    this.simRate = dt > 0 ? done / dt : 0;
    this.lastAdvance = done;
    this.debris?.step(done, this.sim.lastSteps || 1);
  }

  update(dt) {
    this.frame++;
    if (this.opt.trailFrame) { const td = Math.max(this.app.warp / 90, 1e-12); for (const b of this.bodies) b.trailDt = td; }
    for (const b of this.bodies) this._visOf(b, b.vis);
    const adv = this.lastAdvance || 0;
    this.lastAdvance = 0;

    // 조명: 가장 무거운 항성 2개
    const stars = this.bodies.filter((b) => b.kind === 'star').sort((a, c) => this.sim.m[c.idx] - this.sim.m[a.idx]);
    const n = Math.min(2, stars.length);
    LIGHTS.uStarCount.value = Math.max(1, n);
    for (let i = 0; i < n; i++) { LIGHTS.uStarPos.value[i].copy(stars[i].vis); LIGHTS.uStarCol.value[i].copy(stars[i].lightCol); }
    if (!n) { LIGHTS.uStarPos.value[0].set(1e4, 2e3, 1e4); LIGHTS.uStarCol.value[0].setRGB(0.25, 0.25, 0.3); }

    const trails = this.app.settings.trails;
    for (const b of this.bodies) {
      b.spin += clamp(b.rotRate * adv, -1.2 * dt, 1.2 * dt);
      if (b.heat > 0) { b.heat *= Math.exp(-dt / 7); if (b.visual.mat?.uniforms.uSpot && b.style === 'lava') b.visual.mat.uniforms.uSpot.value = b.heat; }
      b.visual.object.position.copy(b.vis);
      b.trail.line.visible = trails;
      if (b.parent && !b.parent.dead) b.trail.line.position.copy(b.parent.vis);
      b.trail.commit();
    }
    if (this.frame % 12 === 1) this._updateOrbits();
    if (this.frame % 30 === 2 && this.sim.n <= 400) {
      const E = this.sim.energy().E;
      if (this.E0 === null) this.E0 = E;
      this.dE = this.E0 !== 0 ? Math.abs((E - this.E0) / this.E0) : 0;
    }
    this.refreshInfo();
  }

  // 카메라 갱신 후: 빌보드·화면 크기·마커·라벨
  lateUpdate(dt) {
    const cam = this.app.camera;
    const f = this.app.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    for (const b of this.bodies) {
      b.visual.update(cam, dt);
      const d = cam.position.distanceTo(b.vis);
      b.px = d > 0 ? (b.visR / d) * f : 1e9;
    }
    this.markers.update(this.bodies, this.app.settings.markers);
    this.flashes.update(dt, cam);
    this.debris?.update(dt);
    this._updateLabels();
  }

  _updateLabels() {
    const L = this.app.labels, show = this.app.settings.labels, cam = this.app.camera;
    const w = this.app.width, h = this.app.height;
    for (const b of this.bodies) {
      if (!b.labelEl) continue;
      if (!show) { L.place(b.labelEl, 0, 0, false); continue; }
      _v.copy(b.vis).project(cam);
      let vis = _v.z < 1 && _v.z > -1;
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      if (vis && b.parent && !b.parent.dead) {
        _w.copy(b.parent.vis).project(cam);
        const px = (_w.x * 0.5 + 0.5) * w, py = (-_w.y * 0.5 + 0.5) * h;
        if (Math.hypot(px - x, py - y) < 26 + b.parent.px) vis = false;
      }
      L.place(b.labelEl, x + Math.min(b.px, 200) + 4, y - 8, vis, this.selected === b);
    }
  }

  // ── 선택/추적 ──
  pick(x, y) {
    const cam = this.app.camera, w = this.app.width, h = this.app.height;
    let best = null, bestS = Infinity;
    for (const b of this.bodies) {
      _v.copy(b.vis).project(cam);
      if (_v.z > 1 || _v.z < -1) continue;
      const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - x, sy - y), th = Math.max(26, b.px + 10);
      if (d < th && d / th < bestS) { bestS = d / th; best = b; }
    }
    if (best) { this.select(best, true); return true; }
    return false;
  }

  focusRadius(b) { return Math.max(b.visR * 8, this.opt.minFocus ?? 0); }

  select(b, focus = false) {
    this.selected = b;
    this.app.ui.showInfo(b ? this.info(b) : null);
    if (b && focus) this.app.controls.focus(() => (b.dead ? this.app.controls.target : b.vis), this.focusRadius(b));
  }

  // ── 정보 ──
  info(b) {
    const s = this.sim, m = s.m[b.idx];
    const rows = [];
    const P = this.primaryOf(b);
    if (this.units === 'au') {
      rows.push(['질량', fmtMass(m)]);
      rows.push(['반지름', `${fmtNum(b.realR * AU_KM, 0)} km`]);
      if (P) {
        const el = this.relElements(b, P);
        rows.push(['주천체 거리', `${fmtNum(el.dist, 4)} AU`]);
        rows.push(['상대 속도', `${fmtNum(el.speed * AUYR_KMS, 2)} km/s`]);
        if (el.a > 0 && el.e < 1) {
          rows.push(['궤도 장반경', `${fmtNum(el.a, 4)} AU`]);
          rows.push(['이심률', fmtNum(el.e, 4)]);
          rows.push(['궤도 경사', `${fmtNum((el.inc * 180) / Math.PI, 2)}°`]);
          rows.push(['공전 주기', fmtDuration(el.period)]);
        } else rows.push(['궤도', '쌍곡선 (탈출 중)']);
      }
      const vesc = Math.sqrt((2 * s.G * m) / Math.max(b.realR, 1e-12)) * AUYR_KMS;
      if (b.kind !== 'blackhole') rows.push(['탈출 속도', `${fmtNum(vesc, 2)} km/s`]);
      if (b.kind === 'star') rows.push(['표면 온도', `${Math.round(b.temp).toLocaleString()} K`]);
    } else {
      rows.push(['질량', fmtNum(m, 4)]);
      rows.push(['위치', `${fmtNum(s.x[b.idx], 3)}, ${fmtNum(s.z[b.idx], 3)}`]);
      const sp = Math.hypot(s.vx[b.idx], s.vy[b.idx], s.vz[b.idx]);
      rows.push(['속력', fmtNum(sp, 4)]);
      if (P) { const el = this.relElements(b, P); rows.push(['주천체 거리', fmtNum(el.dist, 4)]); }
    }
    return { name: b.name || '이름 없는 천체', type: b.type, color: '#' + b.color.getHexString(), rows, desc: b.desc };
  }

  refreshInfo() { if (this.selected && !this.selected.dead && this.frame % 10 === 0) this.app.ui.showInfo(this.info(this.selected)); }

  stats() {
    return { bodies: this.sim.n, steps: this.sim.lastSteps || 0, dE: this.dE, debris: this.debris?.count || 0 };
  }

  dispose() {
    for (const b of [...this.bodies]) this._disposeBody(b);
    this.sim.clear();
    this.markers.dispose();
    this.flashes.dispose();
    this.debris?.dispose();
    this.app.scene.remove(this.root);
  }
}
