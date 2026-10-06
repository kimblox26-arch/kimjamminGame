// 도구 시스템: 손 · 배치 · 용접기 · 망치 · 임팩트 드릴 · 흙손 · 그라인더 · 페인트
import * as THREE from 'three';
import { buildViewmodels } from './viewmodels.js';
import { CAT_BY_ID, cuttableAxes } from '../build/catalog.js';
import { MATS } from '../gfx/materials.js';
import { GROUP, groups } from '../physics.js';
import { clamp, rand, toV, toQ, rv, rq, bestAxis, AXES, fmtKg, fmtN } from '../core/util.js';

export const TOOLS = [
  { id: 'hand', name: '손', desc: '잡기 · 운반 · 고정' },
  { id: 'place', name: '자재 배치', desc: '카탈로그 자재 놓기' },
  { id: 'weld', name: 'MIG 용접기', desc: '금속 ↔ 금속' },
  { id: 'hammer', name: '망치 + 못', desc: '목재 못 박기 · 두드리기' },
  { id: 'drill', name: '임팩트 드릴', desc: '볼트 체결 (모든 재질)' },
  { id: 'trowel', name: '흙손', desc: '벽돌 · 블록 모르타르' },
  { id: 'grinder', name: '앵글 그라인더', desc: '절단 · 접합부 제거' },
  { id: 'paint', name: '스프레이 건', desc: '도장' },
];
export const PAINTS = [
  { c: 0xb3121a, n: '레드' }, { c: 0xe8a812, n: '옐로' }, { c: 0x1d4f91, n: '블루' }, { c: 0x2f6b3a, n: '그린' }, { c: 0x161616, n: '블랙' },
  { c: 0xe9e9e6, n: '화이트' }, { c: 0xff6a13, n: '오렌지' }, { c: 0x5b3d8f, n: '퍼플' }, { c: 0x8f959c, n: '실버' }, { c: null, n: '도장 제거' },
];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class ToolSystem {
  constructor(g) {
    this.g = g; // game context: ph, mgr, fx, sfx, camera, player, vehicles, ui, mats, presets
    this.vm = buildViewmodels(g.mats);
    this.vmRoot = new THREE.Group(); this.vmRoot.position.set(0.2, -0.165, -0.4); g.camera.add(this.vmRoot);
    for (const k in this.vm) this.vmRoot.add(this.vm[k]);
    this.idx = 0; this.prevIdx = 1; this.aimHit = null; this.info = null; this.hint = '';
    this.sel = CAT_BY_ID.plate5; this.dims = this.sel.dims.slice();
    this.orient = 1; this.spin = 0; this.grid = 0.05; this.undo = [];
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x58b4ff, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghost = null; this.ghostKey = '';
    this.cutPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    this.cutPlane.visible = false; g.scene.add(this.cutPlane);
    this.st = {}; // 도구별 상태
    this.paintIdx = 0; this.anim = 0; this.swing = 0; this.sway = new THREE.Vector2();
    this.select(0);
  }
  get tool() { return TOOLS[this.idx].id; }
  select(i) {
    if (i === this.idx && this.vm[this.tool]?.visible) return;
    this.stopLoops(); this.release();
    if (i !== this.idx) this.prevIdx = this.idx;
    this.idx = i; for (const k in this.vm) this.vm[k].visible = k === this.tool;
    this.anim = 1; this.st = {};
    if (this.ghost) this.ghost.visible = false; this.cutPlane.visible = false;
    this.g.ui?.setTool(i); this.g.sfx.play('click');
  }
  selectItem(def) {
    this.sel = def; this.dims = def.dims ? def.dims.slice() : [1, 1, 1];
    this.orient = def.attach ?? 1; this.spin = 0;
    if (this.tool !== 'place') this.select(1);
  }
  stopLoops() { for (const k of ['arcSnd', 'grSnd', 'drSnd', 'spSnd']) { this.st[k]?.stop(); } this.g.fx.arc(false); this.g.ui?.helmet(false); }
  setVisible(on) { this.vmRoot.visible = on; if (!on) { if (this.ghost) this.ghost.visible = false; this.cutPlane.visible = false; this.stopLoops(); this.st = {}; this.release(); } }

  // ─── 조준 ───
  aim(reach = 4.5) {
    const cam = this.g.camera, o = cam.getWorldPosition(new THREE.Vector3()), d = cam.getWorldDirection(new THREE.Vector3());
    const h = this.g.ph.raycast(o, d, reach, this.g.player.col);
    if (!h) return null;
    h.part = this.g.mgr.partOf(h.collider); h.origin = o; h.dir = d;
    h.static = !h.part ? this.g.ph.statics.get(h.collider.handle) : null;
    return h;
  }
  halfAlong(p, dir) {
    const q = p.worldQuat(_q); let s = 0;
    for (let i = 0; i < 3; i++) s += Math.abs(dir.dot(_v.copy(AXES[i]).applyQuaternion(q))) * p.dims[i] / 2;
    return s;
  }
  partsNear(point, r, except) {
    const out = new Set();
    this.g.ph.overlapBall(point, r, (c) => { const p = this.g.mgr.partOf(c); if (p && p !== except) out.add(p); }, GROUP.PART);
    return [...out];
  }
  // 관통 방향 뒤쪽 부품 (못/볼트)
  partBehind(P, hit, depth = 0.02) {
    const th = this.halfAlong(P, hit.normal) * 2;
    for (const k of [th + depth, th + 0.005, th * 0.5]) {
      const q = hit.point.clone().addScaledVector(hit.normal, -k);
      const c = this.partsNear(q, 0.012, P).filter((p) => !p.mat.brittle);
      if (c.length) return c[0];
    }
    const side = this.partsNear(hit.point, 0.02, P).filter((p) => !p.mat.brittle);
    return side[0] || null;
  }
  // 조준점 주변 상대 부품의 최근접점 (용접/모르타르 이음매)
  seam(P, hit, r, ok) {
    let B = null, best = null, bd = Infinity;
    for (const q of this.partsNear(hit.point, r, P)) {
      if (!q.s || !ok(q)) continue;
      for (const c of q.colliders) { const pr = c.projectPoint(hit.point, true); if (!pr) continue; const d = hit.point.distanceTo(pr.point); if (d < bd) { bd = d; B = q; best = new THREE.Vector3(pr.point.x, pr.point.y, pr.point.z); } }
    }
    if (!B) return { B: null, p: hit.point.clone(), n: hit.normal.clone() };
    const toHit = hit.point.clone().sub(best); const n = hit.normal.clone();
    if (toHit.lengthSq() > 1e-8) n.add(toHit.normalize()).normalize();
    return { B, p: best.clone().addScaledVector(hit.normal, 0.001), n };
  }
  local(P, wp, wn) {
    const lp = P.toLocal(wp), ln = wn.clone().applyQuaternion(P.worldQuat(_q).invert()).normalize();
    return [lp, ln];
  }
  nearFasteners(P, wp, r, kinds) {
    const out = [];
    const check = (p) => { for (const f of p.fs) if ((!kinds || kinds.includes(f.kind)) && p.toWorld(f.p, _v2).distanceTo(wp) < r) out.push(f); };
    check(P); for (const j of P.joints) check(j.other(P));
    return out;
  }
  // ─── 매 프레임 ───
  update(dt, input) {
    const g = this.g;
    this.anim = Math.max(0, this.anim - dt * 5);
    // 도구 전환
    for (let i = 0; i < TOOLS.length; i++) if (input.pressed('Digit' + (i + 1))) this.select(i);
    if (input.pressed('KeyQ')) this.select(this.g.input.isTouch ? (this.idx + 1) % TOOLS.length : this.prevIdx);
    const hit = (this.aimHit = this.aim());
    this.info = hit?.part ? this.describe(hit.part) : null;
    // 공통: E 상호작용, F 고정
    if (input.pressed('KeyE') && hit?.part) this.interact(hit.part);
    if (input.pressed('KeyF') && hit?.part) this.toggleAnchor(hit.part, hit);
    const fn = this['t_' + this.tool]; this.hint = '';
    fn?.call(this, dt, input, hit);
    this.animate(dt, input);
  }
  describe(p) {
    const now = this.g.mgr.time, S = p.s;
    const js = [...p.joints].map((j) => j.strength(now));
    const kinds = {}; for (const j of p.joints) for (const f of j.fs) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    const kn = { bead: '용접', nail: '못', bolt: '볼트', mortar: '모르타르', clamp: '클램프' };
    let cure = '';
    const mortar = [...p.joints].flatMap((j) => j.fs.filter((f) => f.kind === 'mortar'));
    if (mortar.length) cure = ` · 양생 ${Math.round(clamp(0.08 + (now - Math.max(...mortar.map((f) => f.t0))) / 20, 0, 1) * 100)}%`;
    return {
      name: p.def.name, spec: (p.def.spec || '') + (p.def.shape === 'box' ? ` · ${p.dims.map((d) => Math.round(d * 1000)).join('×')} mm` : p.def.resize ? ` · L ${Math.round(p.dims[0] * 1000)} mm` : ''),
      mat: p.mat.name + (p.paint != null ? ' · 도장' : ''), mass: fmtKg(p.mass), smass: fmtKg(S.mass), parts: S.parts.size, anchored: S.anchored,
      joints: Object.entries(kinds).map(([k, n]) => `${kn[k] || k} ${n}`).join(' · ') + cure, strength: js.length ? fmtN(js.reduce((a, b) => a + b, 0)) : '',
      dents: p.dents.length, pinned: p.pinned,
    };
  }
  interact(p) {
    const g = this.g;
    if (p.def.mech === 'seat') { g.enterVehicle(p); return; }
    if (p.def.mech === 'light') { const r = p.s.rig; if (r) { r.setLights(!r.lightsOn); g.sfx.play('click'); } return; }
    if (p.def.mech === 'engine') { g.ui.toast(`${p.def.name}: 운전석에 앉아 W 로 가속`); return; }
  }
  toggleAnchor(p, hit) {
    const g = this.g, mgr = g.mgr;
    if (p.pinned) {
      for (const f of [...p.fs]) if (f.kind === 'anchor') mgr.removeFastener(f);
      mgr.setPinned(p, false); g.sfx.play('bolt', { pos: hit.point }); g.ui.toast('앵커 볼트 해제 — 구조물이 자유롭게 움직입니다'); return;
    }
    // 지면/바닥 근처인지 확인
    const c = p.worldPos(), down = new THREE.Vector3(0, -1, 0), hy = this.halfAlong(p, down);
    const r = g.ph.raycast(c, down, hy + 0.25, undefined, p.s.body, GROUP.WORLD);
    if (!r) { g.sfx.play('error'); g.ui.toast('바닥(지면)에 닿아 있는 부품만 앵커로 고정할 수 있습니다'); return; }
    const [lp, ln] = this.local(p, hit.point, hit.normal);
    mgr.addFastener(null, p, 'anchor', lp, ln);
    mgr.setPinned(p, true); g.sfx.play('bolt', { pos: hit.point }); g.fx.dust(hit.point, 6);
    g.ui.toast('앵커 볼트로 바닥에 고정 — 건물·기초처럼 움직이지 않습니다 (F: 해제)');
  }

  // ═══ 손: 잡기/운반 ═══
  t_hand(dt, input, hit) {
    const g = this.g, st = this.st;
    if (st.grab) {
      if (!st.grab.S.body || !g.mgr.structs.has(st.grab.S) || st.grab.S.anchored) { this.release(); return; }
      if (input.wheel) st.grab.dist = clamp(st.grab.dist - input.wheel * 0.15, 0.7, 4);
      if (input.pressed('KeyR')) st.grab.rel.premultiply(_q.setFromAxisAngle(_v.set(0, 1, 0), Math.PI / 2));
      if (input.pressed('KeyT')) st.grab.rel.premultiply(_q.setFromAxisAngle(_v.set(1, 0, 0), Math.PI / 2));
      if (input.btnHit[2]) { // 던지기
        const b = st.grab.S.body, m = b.mass(), v = Math.min(11, 380 / m);
        const d = g.camera.getWorldDirection(new THREE.Vector3());
        b.applyImpulse(rv(d.multiplyScalar(v * m)), true); g.sfx.play('swoosh', { pos: g.camera.position }); this.release(); return;
      }
      if (!input.btn[0]) { this.release(); return; }
      st.grab.age += dt;
      const m = st.grab.S.mass;
      this.hint = `운반 중 · ${fmtKg(m)}${m > 75 ? ' — 너무 무거워 들 수 없음 (끌기만 가능)' : ''} · 휠: 거리 · R/T: 회전 · 우클릭: 던지기`;
      return;
    }
    this.hint = hit?.part ? (hit.part.s.anchored ? '고정된 구조물 · F: 앵커 해제' : '좌클릭(유지): 잡기 · F: 바닥에 앵커 고정 · E: 상호작용') : '';
    if (input.btnHit[0] && hit?.part && !hit.part.s.anchored) {
      const S = hit.part.s, b = S.body, bq = toQ(b.rotation()), bp = toV(b.translation());
      const cq = g.camera.getWorldQuaternion(new THREE.Quaternion());
      st.grab = { S, local: hit.point.clone().sub(bp).applyQuaternion(bq.clone().invert()), dist: hit.dist, rel: cq.clone().invert().multiply(bq), age: 0 };
      b.wakeUp(); g.sfx.play('tap', { pos: hit.point, vol: 0.5 });
    }
  }
  release() { this.st.grab = null; }
  // 물리 단계: 잡은 물체를 스프링-댐퍼로 끌어당김 (사람 힘 한계 ≈ 750 N)
  physicsStep(dt) {
    const gr = this.st.grab; if (!gr || !this.g.mgr.structs.has(gr.S)) return;
    const b = gr.S.body, g = this.g;
    const bq = toQ(b.rotation()), bp = toV(b.translation());
    const wp = gr.local.clone().applyQuaternion(bq).add(bp);
    const cam = g.camera, target = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(cam.getWorldDirection(new THREE.Vector3()), gr.dist);
    if (wp.distanceTo(target) > 2.5) { this.release(); return; }
    const vel = toV(b.velocityAtPoint(rv(wp)));
    const m = Math.min(b.mass(), 90), w0 = 11;
    const F = target.sub(wp).multiplyScalar(w0 * w0 * m).addScaledVector(vel, -2 * 0.9 * w0 * m).add(_v.set(0, 9.81 * Math.min(b.mass(), 90), 0));
    if (F.length() > 750) F.setLength(750);
    b.applyImpulseAtPoint(rv(F.multiplyScalar(dt)), rv(wp), true);
    // 자세 유지 토크
    const tq = cam.getWorldQuaternion(new THREE.Quaternion()).multiply(gr.rel), err = tq.multiply(bq.clone().invert());
    if (err.w < 0) { err.x *= -1; err.y *= -1; err.z *= -1; err.w *= -1; }
    const ang = 2 * Math.acos(clamp(err.w, -1, 1)), s = Math.sqrt(1 - err.w * err.w);
    const axis = s > 1e-4 ? _v.set(err.x / s, err.y / s, err.z / s) : _v.set(0, 0, 0);
    const I = m * 0.12, av = toV(b.angvel());
    const T = axis.multiplyScalar(ang * 60 * I).addScaledVector(av, -2 * 7 * I);
    if (T.length() > 140) T.setLength(140);
    b.applyTorqueImpulse(rv(T.multiplyScalar(dt)), true);
  }

  // ═══ 배치 ═══
  t_place(dt, input, hit) {
    const g = this.g, def = this.sel;
    if (input.pressed('KeyR')) { this.spin += Math.PI / 2; g.sfx.play('click'); }
    if (input.wheel) this.spin += input.wheel * (Math.PI / 12);
    if (input.pressed('KeyT') && !def.mech && !def.kit) { this.orient = (this.orient + 1) % 3; g.sfx.play('click'); }
    if (input.pressed('KeyG')) { const gs = [0, 0.01, 0.05, 0.1, 0.25]; this.grid = gs[(gs.indexOf(this.grid) + 1) % gs.length]; g.ui.toast(`격자 스냅: ${this.grid ? this.grid * 100 + ' cm' : '끔'}`); }
    if ((input.down('ControlLeft') || input.down('MetaLeft')) && input.pressed('KeyZ')) this.undoLast();
    // 우클릭: 철거
    if (input.btnHit[2] && hit?.part) {
      const p = hit.part, wp = p.worldPos();
      g.mgr.removePart(p); g.mgr.flushDirty(); g.sfx.play('place', { pos: wp, vol: 0.6 }); g.fx.dust(wp, 4);
      return;
    }
    const pose = hit ? this.ghostPose(hit) : null;
    this.updateGhost(pose);
    const grid = this.grid ? `${this.grid * 100}cm` : '끔';
    this.hint = def.kit ? `좌클릭: ${def.name} 설치 · R/휠: 회전` : `좌클릭: 배치 · 우클릭: 철거 · R/휠: 회전 · ${def.mech ? '' : 'T: 세우기 · '}G: 격자(${grid}) · Ctrl+Z: 되돌리기`;
    if (pose && !pose.ok) this.hint = (pose.why || '공간이 겹칩니다') + ' · ' + this.hint;
    if (input.btnHit[0] && pose?.ok) this.placeAt(pose, hit);
  }
  ghostPose(hit) {
    const def = this.sel, cam = this.g.camera;
    if (def.kit) {
      if (hit.normal.y < 0.7) return { ok: false, why: '평평한 바닥에 설치하세요' };
      const yaw = Math.atan2(-hit.dir.x, -hit.dir.z) + this.spin;
      const size = this.g.presets.size(def.kit);
      return { ok: true, kit: true, pos: hit.point.clone(), quat: new THREE.Quaternion().setFromAxisAngle(_v.set(0, 1, 0), yaw), size };
    }
    let frameQ, nS, planePt, P = hit.part;
    if (P && !P.s) P = null;
    if (P) {
      const pq = P.worldQuat(new THREE.Quaternion()), ba = bestAxis(pq, hit.normal);
      frameQ = pq; nS = AXES[ba.axis].clone().multiplyScalar(ba.sign).applyQuaternion(pq);
      planePt = P.worldPos(new THREE.Vector3()).addScaledVector(nS, P.dims[ba.axis] / 2);
      if (P.def.shape !== 'box' && !P.def.mech) planePt = hit.point.clone(); // 비정형 단면은 실제 접점
      if (P.def.mech) planePt = hit.point.clone();
    } else {
      frameQ = new THREE.Quaternion(); const ba = bestAxis(frameQ, hit.normal);
      nS = AXES[ba.axis].clone().multiplyScalar(ba.sign); planePt = hit.point.clone();
    }
    // 프레임 기저: Y = 법선, X/Z = 접선
    const a0 = [0, 1, 2].map((i) => AXES[i].clone().applyQuaternion(frameQ));
    let t1 = a0.find((a) => Math.abs(a.dot(nS)) < 0.5);
    const Yf = nS.clone(), Xf = t1.clone(), Zf = new THREE.Vector3().crossVectors(Xf, Yf);
    const F = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(Xf, Yf, Zf));
    // 시점 기준 기본 회전 (90° 스냅)
    const vf = hit.dir.clone().applyQuaternion(F.clone().invert());
    const base = Math.round(Math.atan2(-vf.x, -vf.z) / (Math.PI / 2)) * (Math.PI / 2);
    const k = def.mech ? def.attach ?? 1 : this.orient;
    const Ql = k === 1 ? new THREE.Quaternion() : k === 0 ? new THREE.Quaternion().setFromAxisAngle(_v.set(0, 0, 1), Math.PI / 2) : new THREE.Quaternion().setFromAxisAngle(_v.set(1, 0, 0), -Math.PI / 2);
    const quat = F.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_v.set(0, 1, 0), base + this.spin)).multiply(Ql);
    const dims = this.dims, ghalf = (dir) => { let s = 0; for (let i = 0; i < 3; i++) s += Math.abs(dir.dot(_v.copy(AXES[i]).applyQuaternion(quat))) * dims[i] / 2; return s; };
    // 접선 스냅
    const P0 = hit.point.clone().addScaledVector(nS, -hit.point.clone().sub(planePt).dot(nS));
    const ctr = P ? P.worldPos(new THREE.Vector3()) : new THREE.Vector3();
    const tans = [Xf, Zf], off = [];
    for (const t of tans) {
      const u = P0.clone().sub(ctr).dot(t), hg = ghalf(t);
      let best = null;
      if (P && P.def.shape === 'box') {
        const hp = this.halfAlong(P, t), mag = Math.min(0.06, hg * 0.6 + 0.012);
        for (const c of [-hp + hg, 0, hp - hg, -hp - hg, hp + hg]) if (Math.abs(u - c) < mag && (best === null || Math.abs(u - c) < Math.abs(u - best))) best = c;
        if (best === null && this.grid) best = Math.round((u - (-hp + hg)) / this.grid) * this.grid + (-hp + hg);
      } else if (this.grid) best = Math.round(u / this.grid) * this.grid;
      off.push(best ?? u);
    }
    const along = P0.clone().sub(ctr).dot(nS);
    const pos = ctr.clone().addScaledVector(nS, along + ghalf(nS)).addScaledVector(Xf, off[0]).addScaledVector(Zf, off[1]);
    const pose = { ok: true, pos, quat, nS, Xf, Zf, P, contact: ctr.clone().addScaledVector(nS, along).addScaledVector(Xf, off[0]).addScaledVector(Zf, off[1]), gh: [ghalf(Xf), ghalf(Zf)] };
    if (def.mech === 'wheel' && !P) return { ...pose, ok: false, why: '바퀴는 차체(부품) 옆면에 붙이세요' };
    if (hit.dist > 6) return { ...pose, ok: false, why: '너무 멉니다' };
    // 겹침 검사
    const tmp = this.ghostPart; let bad = false;
    if (tmp) for (const c of tmp.cols) {
      if (c.t === 'ball') continue;
      const cp = _v.fromArray(c.p).applyQuaternion(quat).add(pos);
      const half = c.t === 'box' ? new THREE.Vector3(...c.h) : new THREE.Vector3(c.hl, c.r * 0.7, c.r * 0.7);
      half.subScalar(0.004).max(_v2.set(0.0005, 0.0005, 0.0005));
      this.g.ph.overlapBox(cp, rq(quat), half, () => { bad = true; }, GROUP.PART | GROUP.WORLD | GROUP.PLAYER);
      if (bad) break;
    }
    if (bad) return { ...pose, ok: false };
    return pose;
  }
  updateGhost(pose) {
    const def = this.sel, key = def.id + '|' + this.dims.join(',');
    if (key !== this.ghostKey) {
      if (this.ghost) this.g.scene.remove(this.ghost);
      this.ghostKey = key; this.ghostPart = null;
      if (def.kit) {
        const s = this.g.presets.size(def.kit);
        const geo = new THREE.BoxGeometry(s[0], s[1], s[2]); geo.translate(0, s[1] / 2, 0);
        this.ghost = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x58b4ff }));
      } else {
        const p = this.g.mgr.createPart(def, this.dims);
        this.ghostPart = p; this.ghost = p.mesh;
        p.mesh.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; } });
      }
      this.g.scene.add(this.ghost);
    }
    if (!pose) { this.ghost.visible = false; return; }
    this.ghost.visible = true; this.ghost.position.copy(pose.pos); this.ghost.quaternion.copy(pose.quat);
    const mat = pose.ok ? this.ghostMat : this.ghostBad;
    if (this.ghost.isLineSegments) this.ghost.material.color.set(pose.ok ? 0x58b4ff : 0xff4040);
    else this.ghost.traverse((o) => { if (o.isMesh) o.material = mat; });
  }
  placeAt(pose, hit) {
    const g = this.g, mgr = g.mgr, def = this.sel;
    if (pose.kit) { g.presets.spawn(def.kit, pose.pos, pose.quat); g.sfx.play('place', { pos: pose.pos }); return; }
    const p = mgr.createPart(def, this.dims);
    const P = pose.P;
    if (P && P.s) {
      mgr.attach(p, P.s, pose.pos, pose.quat);
      const [lp, ln] = this.local(p, pose.contact, pose.nS.clone().negate());
      if (def.mech) { // 기계 부품은 볼트로 장착
        const j = mgr.connect(p, P);
        for (let i = 0; i < 2; i++) mgr.addFastener(j, p, 'bolt', lp.clone().add(_v.set(rand(-0.03, 0.03), 0, rand(-0.03, 0.03))), ln.clone().negate());
        g.sfx.play('bolt', { pos: pose.pos });
      } else if (!(p.mat.masonry && P.mat.masonry)) { // 임시 클램프
        // 카메라에 가까운 모서리
        const cands = [[pose.Xf, pose.gh[0]], [pose.Xf.clone().negate(), pose.gh[0]], [pose.Zf, pose.gh[1]], [pose.Zf.clone().negate(), pose.gh[1]]];
        let best = null, bd = Infinity;
        for (const [d, h] of cands) { const e = pose.contact.clone().addScaledVector(d, h); const dd = e.distanceTo(g.camera.position); if (dd < bd) { bd = dd; best = [e, d]; } }
        const j = mgr.connect(p, P);
        const [cp] = this.local(p, best[0], pose.nS);
        const cn = pose.nS.clone().applyQuaternion(p.worldQuat(_q).invert());
        const ct = best[1].clone().applyQuaternion(p.worldQuat(_q).invert());
        mgr.addFastener(j, p, 'clamp', cp, cn, { tan: ct });
        g.sfx.play('clamp', { pos: pose.pos });
      }
    } else {
      mgr.spawn(p, pose.pos, pose.quat);
    }
    g.sfx.play('place', { pos: pose.pos, vol: clamp(p.mass / 40, 0.3, 1) });
    this.undo.push(p); if (this.undo.length > 50) this.undo.shift();
  }
  undoLast() {
    while (this.undo.length) { const p = this.undo.pop(); if (p.s) { this.g.mgr.removePart(p); this.g.mgr.flushDirty(); this.g.sfx.play('ui'); return; } }
  }

  // ═══ MIG 용접 ═══
  t_weld(dt, input, hit) {
    const g = this.g, st = this.st, P = hit?.part, close = hit && hit.dist < 2.0;
    const on = input.btn[0] && close && (P || hit.static);
    this.hint = !hit ? '' : !close ? '토치를 더 가까이 (2 m 이내)' : P && !P.mat.metal ? `${P.mat.name}은(는) 용접할 수 없습니다` : '좌클릭(유지): 아크 용접 — 이음매를 따라 천천히 이동';
    if (!on || (P && !P.mat.metal && !P.mat.wood)) {
      if (st.arc) { st.arc = false; g.fx.arc(false); g.ui.helmet(false); st.arcSnd?.set(0); this.finishWeld(); }
      return;
    }
    if (!st.arc) { st.arc = true; st.arcSnd = st.arcSnd || g.sfx.loop('arc'); st.t = 0; st.last = null; st.welded = new Set(); }
    st.arcSnd?.set(0.55 + Math.random() * 0.2);
    g.ui.helmet(true);
    const tip = hit.point.clone().addScaledVector(hit.normal, 0.008);
    g.fx.arc(true, tip);
    g.fx.sparks(tip, hit.normal.clone().multiplyScalar(0.8).add(_v.set(0, 0.3, 0)), 5, 4.5, 1.1, 1.2, 1);
    if (Math.random() < 0.25) g.fx.smoke(tip, 1, [0.6, 0.6, 0.62], 0.08, 2.5, 0.25);
    g.fx.shake = Math.max(g.fx.shake, 0.08);
    if (!P) return;
    if (P.mat.wood) { // 나무 → 그을림
      st.t += dt; if (st.t > 0.15) { st.t = 0; const [lp, ln] = this.local(P, hit.point, hit.normal); g.fx.decal(P, lp, ln, 'scorch', rand(0.03, 0.06)); g.fx.smoke(tip, 2, [0.3, 0.3, 0.3], 0.12, 3, 0.5); }
      this.hint = '목재가 그을립니다 — 나무는 못이나 볼트로 접합하세요'; return;
    }
    st.t += dt;
    if (st.t < 0.045) return;
    st.t = 0;
    // 이음매 탐색: 3 cm 이내 금속 부품의 최근접점 → 비드는 두 면이 만나는 모서리(필릿)에 쌓임
    const sm = this.seam(P, hit, 0.03, (q) => q.mat.metal);
    const B = sm.B, j = B ? g.mgr.connect(P, B) : null;
    const [lp, ln] = this.local(P, sm.p, sm.n);
    if (st.last && st.last.part === P && st.last.p.distanceTo(lp) < 0.004) { g.fx.heatGlow(P, lp, ln); return; }
    const f = g.mgr.addFastener(j, P, 'bead', lp, ln);
    f.heat = 1; g.mgr.hot.add(f); g.mgr.setBeadHeat(f, 1);
    g.fx.heatGlow(P, lp, ln, 0.06);
    if (!st.lastTint || st.lastTint.part !== P || st.lastTint.p.distanceTo(lp) > 0.025) { g.fx.decal(P, lp, ln, 'tint', rand(0.045, 0.07)); st.lastTint = { part: P, p: lp.clone() }; }
    st.last = { part: P, p: lp.clone() };
    if (j) st.welded.add(j);
    this.hint = B ? `용접 중: ${P.def.name} ↔ ${B.def.name} · 강도 ${fmtN(j.strength(g.mgr.time))}` : '용접할 상대 부품이 닿아 있지 않습니다 (이음매를 조준)';
  }
  finishWeld() {
    const g = this.g, st = this.st; if (!st.welded) return;
    let n = 0;
    for (const j of st.welded) if (j.permanent(g.mgr.time) >= 6000) for (const f of [...j.fs]) if (f.kind === 'clamp') { g.mgr.removeFastener(f); n++; }
    if (n) { g.sfx.play('unclamp', { pos: g.camera.position }); g.ui.toast(`가용접 완료 — 클램프 ${n}개 해제`); }
    st.welded = null; g.mgr.flushDirty();
  }

  // ═══ 망치 ═══
  t_hammer(dt, input, hit) {
    const g = this.g, st = this.st, P = hit?.part;
    this.hint = P ? (P.mat.wood ? '좌클릭: 못 박기 (3번 쳐서 완전히) · 우클릭: 못 뽑기' : P.mat.brittle ? '좌클릭: 유리가 깨집니다!' : P.mat.masonry ? '좌클릭: 두드리기 (반복 시 깨짐)' : '좌클릭: 두드리기 · 얇은 판은 찌그러짐') : '좌클릭: 휘두르기';
    if (st.swing > 0) {
      const prev = st.swing; st.swing -= dt;
      if (prev > 0.2 && st.swing <= 0.2) this.hammerHit();
      return;
    }
    if (input.btnHit[0] || (input.btn[0] && g.input.isTouch)) { st.swing = 0.34; g.sfx.play('swoosh', { pos: g.camera.position }); }
    if (input.btnHit[2] && P) { // 못 뽑기
      const ns = this.nearFasteners(P, hit.point, 0.035, ['nail']);
      if (ns.length) { g.mgr.removeFastener(ns[0]); g.sfx.play('nail', { pos: hit.point, vol: 0.5 }); g.fx.debris(hit.point, 1, 0x9a9da2, 0.01, 2); g.mgr.flushDirty(); }
    }
  }
  hammerHit() {
    const g = this.g, hit = this.aim(1.9); if (!hit) return;
    const P = hit.part, n = hit.normal;
    g.fx.shake = 0.35;
    if (!P) {
      const m = hit.static?.mat;
      if (m === 'metal') g.sfx.play('clang', { pos: hit.point, size: 3, ring: 0.6 }); else { g.sfx.play('stone', { pos: hit.point }); g.fx.dust(hit.point, 3); }
      return;
    }
    // 타격 충격량: 대부분 못/지지면이 흡수 → 면 안쪽 방향 위주의 작은 충격 (가벼운 부품은 살짝 밀림)
    if (!P.s.anchored) P.s.body.applyImpulseAtPoint(rv(n.clone().multiplyScalar(-1.4).addScaledVector(hit.dir, 0.4)), rv(hit.point), true);
    const [lp, ln] = this.local(P, hit.point, n);
    if (P.mat.brittle) { this.shatter(P, hit.dir.clone().multiplyScalar(2)); return; }
    if (P.mat.wood) {
      g.sfx.play('thud', { pos: hit.point }); g.fx.debris(hit.point, 2, 0xc9a46c, 0.006, 1.5);
      const ns = this.nearFasteners(P, hit.point, 0.025, ['nail']).filter((f) => f.stage < 3 && !f.bent && f.host === P);
      if (ns.length) {
        const f = ns[0]; f.stage++;
        if (f.stage < 3 && Math.random() < 0.06) { f.bent = true; g.ui.toast('앗! 못이 휘었습니다 — 우클릭으로 뽑으세요'); g.sfx.play('tap', { pos: hit.point }); }
        else g.sfx.play('nail', { pos: hit.point });
        g.mgr.setNailStage(f);
        if (f.stage >= 3 && f.joint) { g.ui.toast(`못 박기 완료 · ${f.joint.a.def.name} ↔ ${f.joint.b.def.name}`); this.dropClamps(f.joint, 2500); }
        return;
      }
      const B = this.partBehind(P, hit);
      const j = B ? g.mgr.connect(P, B) : null;
      const f = g.mgr.addFastener(j, P, 'nail', lp, ln, { stage: 1 });
      g.sfx.play('nail', { pos: hit.point, vol: 0.7 });
      if (!B) g.ui.toast('못 뒤에 고정할 부품이 없습니다');
      g.mgr.flushDirty();
      return;
    }
    if (P.mat.metal) {
      const sz = P.dims[0] * P.dims[2] + P.dims[1] * 0.5;
      g.sfx.play('clang', { pos: hit.point, size: Math.max(0.05, Math.sqrt(sz)), ring: P.dentable ? 1.3 : 0.7 });
      g.fx.sparks(hit.point, n, 2, 2, 1, 0.3, 0.6);
      if (P.dentable) { const th = Math.min(...P.dims); g.mgr.dent(P, lp, ln.clone().negate(), 0.035, clamp(0.0012 / (th * 250), 0.0002, 0.003)); }
      return;
    }
    if (P.mat.masonry) {
      g.sfx.play('stone', { pos: hit.point }); g.fx.debris(hit.point, 4, P.mat.color, 0.012, 1.8); g.fx.dust(hit.point, 3, [0.6, 0.45, 0.4]);
      P.damage++;
      if (P.damage >= 4) { this.breakMasonry(P); }
      return;
    }
    g.sfx.play('thud', { pos: hit.point });
  }
  breakMasonry(P) {
    const g = this.g, ax = P.dims.indexOf(Math.max(...P.dims));
    g.sfx.play('crack', { pos: P.worldPos() });
    const pcs = g.mgr.cutPart(P, ax, (Math.random() - 0.5) * P.dims[ax] * 0.3, 0.004);
    g.fx.debris(P.worldPos(), 8, P.mat.color, 0.015, 2); g.fx.dust(P.worldPos(), 6, [0.6, 0.5, 0.45], 0.2);
    if (pcs) for (const q of pcs) q.damage = 2;
    g.mgr.flushDirty();
  }
  shatter(P, vel) {
    const g = this.g, c = P.worldPos(), q = P.worldQuat();
    g.fx.shatter(c, new THREE.Vector3(P.dims[0] / 2, P.dims[1] / 2, P.dims[2] / 2), q, vel);
    g.sfx.play('glass', { pos: c, vol: clamp(P.mass / 10, 0.5, 1.2) });
    g.mgr.removePart(P); g.mgr.flushDirty();
  }
  dropClamps(j, need) { if (j.permanent(this.g.mgr.time) >= need) for (const f of [...j.fs]) if (f.kind === 'clamp') { this.g.mgr.removeFastener(f); this.g.sfx.play('unclamp', { pos: this.g.camera.position }); } }

  // ═══ 임팩트 드릴 (볼트) ═══
  t_drill(dt, input, hit) {
    const g = this.g, st = this.st, P = hit?.part, close = hit && hit.dist < 1.9;
    st.drSnd = st.drSnd || g.sfx.loop('drill');
    const unscrew = input.btn[2] && P && close;
    const run = (input.btn[0] || unscrew) && close;
    this.hint = P ? (close ? '좌클릭(유지): 구멍 뚫고 볼트 체결 · 우클릭(유지): 볼트 풀기' : '더 가까이') : '';
    if (!run || !P) { st.drSnd?.set(input.btn[0] ? 0.25 : 0, input.btn[0] ? 1 : 0.3, 0); st.prog = 0; st.target = null; g.ui.progress(0); return; }
    const key = P.id;
    if (st.target !== key) { st.target = key; st.prog = 0; }
    if (unscrew) {
      const bs = this.nearFasteners(P, hit.point, 0.04, ['bolt']);
      if (!bs.length) { this.hint = '풀 볼트가 없습니다'; st.drSnd?.set(0.25, 1, 0); return; }
      st.prog += dt / 0.6; st.drSnd?.set(0.5, 0.8, 1); g.ui.progress(st.prog);
      if (st.prog >= 1) { g.mgr.removeFastener(bs[0]); g.sfx.play('bolt', { pos: hit.point }); st.prog = 0; g.mgr.flushDirty(); }
      return;
    }
    const th = this.halfAlong(P, hit.normal) * 2;
    const T = P.mat.masonry ? 1.3 : P.mat.metal ? 0.6 + th * 50 : 0.55;
    st.prog += dt / T; g.ui.progress(st.prog);
    st.drSnd?.set(0.55, 0.85 + (P.mat.metal ? 0 : 0.2), st.prog > 0.6 ? 1 : 0.2);
    g.fx.shake = Math.max(g.fx.shake, 0.06);
    if (P.mat.brittle && st.prog > 0.3) { this.shatter(P, hit.normal.clone().multiplyScalar(-1)); return; }
    if (Math.random() < 0.5) {
      if (P.mat.metal) g.fx.debris(hit.point, 1, 0xb8bcc2, 0.006, 1.2, hit.normal);
      else if (P.mat.wood) { g.fx.debris(hit.point, 1, 0xd8b888, 0.005, 1, hit.normal); g.fx.puff('soft', hit.point, hit.normal.clone().multiplyScalar(0.4), [0.85, 0.75, 0.55], 0.02, 0.12, 0.5, 1.2, -0.2); }
      else g.fx.dust(hit.point, 1, [0.6, 0.58, 0.55], 0.08);
    }
    if (st.prog >= 1) {
      st.prog = 0; g.ui.progress(0);
      const B = this.partBehind(P, hit, 0.03);
      const [lp, ln] = this.local(P, hit.point, hit.normal);
      if (!B) { g.ui.toast('볼트를 체결할 상대 부품이 없습니다 — 두 부품이 겹친 곳을 조준'); g.fx.decal(P, lp, ln, 'scorch', 0.014); return; }
      const j = g.mgr.connect(P, B);
      g.mgr.addFastener(j, P, 'bolt', lp, ln);
      g.sfx.play('bolt', { pos: hit.point }); this.dropClamps(j, 6000); g.mgr.flushDirty();
      this.hint = `볼트 체결: ${P.def.name} ↔ ${B.def.name}`;
    }
  }

  // ═══ 흙손 (모르타르) ═══
  t_trowel(dt, input, hit) {
    const g = this.g, st = this.st, P = hit?.part, close = hit && hit.dist < 2.0;
    this.hint = P ? (close ? '좌클릭(유지): 이음매에 모르타르 바르기 — 약 20초 후 완전 양생' : '더 가까이') : '';
    if (!input.btn[0] || !P || !close) { st.last = null; return; }
    st.t = (st.t || 0) + dt; if (st.t < 0.1) return; st.t = 0;
    const sm = this.seam(P, hit, 0.035, (q) => !q.mat.brittle), B = sm.B;
    if (!(P.mat.masonry || B?.mat.masonry)) { this.hint = '모르타르는 벽돌 · 블록 · 콘크리트 접합용입니다'; return; }
    const [lp, ln] = this.local(P, sm.p, sm.n);
    if (st.last && st.last.part === P && st.last.p.distanceTo(lp) < 0.03) return;
    const j = B ? g.mgr.connect(P, B) : null;
    g.mgr.addFastener(j, P, 'mortar', lp, ln);
    st.last = { part: P, p: lp };
    g.sfx.play('step', { pos: hit.point, soft: true, vol: 0.6 });
    g.fx.debris(hit.point, 1, 0xa8a49a, 0.006, 0.6);
    this.hint = B ? `모르타르: ${P.def.name} ↔ ${B.def.name} · ${fmtN(j.strength(g.mgr.time))} (양생 중)` : '맞닿은 부품이 없습니다';
  }

  // ═══ 앵글 그라인더 ═══
  t_grinder(dt, input, hit) {
    const g = this.g, st = this.st, P = hit?.part, close = hit && hit.dist < 1.9;
    st.grSnd = st.grSnd || g.sfx.loop('grinder');
    if (input.pressed('KeyT')) { st.vert = !st.vert; g.sfx.play('click'); }
    const on = input.btn[0];
    st.spin = clamp((st.spin || 0) + (on ? dt * 3 : -dt * 1.2), 0, 1);
    st.grSnd?.set(st.spin * 0.5, 0.6 + st.spin * 0.4, 0);
    this.cutPlane.visible = false;
    if (!P || !close) { st.prog = 0; g.ui.progress(0); this.hint = hit ? '더 가까이' : ''; return; }
    // 접합부 근처면 접합부 절단
    const fs = this.nearFasteners(P, hit.point, 0.035, ['bead', 'nail', 'bolt', 'mortar', 'clamp']);
    const axes = cuttableAxes(P.def);
    let axis = -1, coord = 0;
    if (!fs.length && axes.length) {
      const ref = st.vert ? new THREE.Vector3(0, 1, 0).applyQuaternion(g.camera.quaternion) : new THREE.Vector3(1, 0, 0).applyQuaternion(g.camera.quaternion);
      const ba = bestAxis(P.worldQuat(), ref); axis = axes.includes(ba.axis) ? ba.axis : axes[0];
      coord = P.toLocal(hit.point).getComponent(axis);
      // 절단선 미리보기
      const q = P.worldQuat(), nrm = AXES[axis].clone().applyQuaternion(q), c = P.toWorld(_v.set(0, 0, 0).setComponent(axis, coord));
      const o = [0, 1, 2].filter((i) => i !== axis);
      this.cutPlane.position.copy(c); this.cutPlane.quaternion.setFromRotationMatrix(_m.makeBasis(AXES[o[0]].clone().applyQuaternion(q), AXES[o[1]].clone().applyQuaternion(q), nrm));
      this.cutPlane.scale.set(P.dims[o[0]] + 0.01, P.dims[o[1]] + 0.01, 1); this.cutPlane.visible = true;
    }
    this.hint = fs.length ? '좌클릭(유지): 접합부(용접·못·볼트) 갈아내기' : axis >= 0 ? `좌클릭(유지): 절단 · T: 절단 방향 전환 (${st.vert ? '수평' : '수직'})` : '절단할 수 없는 부품';
    if (!on || st.spin < 0.5) { st.prog = 0; g.ui.progress(0); return; }
    const key = P.id + ':' + (fs.length ? 'f' : axis);
    if (st.key !== key) { st.key = key; st.prog = 0; }
    if (P.mat.brittle) { this.shatter(P, hit.normal.clone().multiplyScalar(-1)); return; }
    const o = [0, 1, 2].filter((i) => i !== axis), area = axis >= 0 ? (P.def.shape === 'box' ? P.dims[o[0]] * P.dims[o[1]] : P.mass / (MATS[P.def.mat].density * P.dims[0])) : 0;
    const k = P.mat.metal ? 520 : P.mat.masonry ? 260 : 60;
    const T = fs.length ? 0.7 : 0.5 + area * k;
    st.prog += dt / T; g.ui.progress(st.prog);
    st.grSnd?.set(0.75, 0.5, 1);
    g.fx.shake = Math.max(g.fx.shake, 0.12);
    // 불꽃 / 분진
    const tang = new THREE.Vector3().crossVectors(hit.normal, axis >= 0 ? AXES[axis].clone().applyQuaternion(P.worldQuat()) : _v.set(0, 1, 0)).normalize();
    if (tang.y > 0) tang.negate();
    if (P.mat.metal) g.fx.sparks(hit.point, tang.clone().add(hit.normal.clone().multiplyScalar(0.15)), 22, 13, 0.18, 1.2, 1);
    else if (P.mat.wood) { g.fx.debris(hit.point, 1, 0xd8b888, 0.006, 3, tang); g.fx.puff('soft', hit.point, tang.clone().multiplyScalar(2), [0.85, 0.75, 0.55], 0.03, 0.25, 0.5, 1.5, -0.1); }
    else { g.fx.dust(hit.point, 2, [0.62, 0.58, 0.55], 0.15); g.fx.debris(hit.point, 1, P.mat.color, 0.005, 2, tang); }
    if (st.prog < 1) return;
    st.prog = 0; g.ui.progress(0);
    if (fs.length) {
      for (const f of fs) if (f.host.s) g.mgr.removeFastener(f);
      g.sfx.play('snap', { pos: hit.point, vol: 0.5 }); g.mgr.flushDirty(); return;
    }
    const pcs = g.mgr.cutPart(P, axis, coord);
    if (!pcs) { g.ui.toast('조각이 너무 작습니다'); return; }
    g.sfx.play(P.mat.metal ? 'clang' : P.mat.wood ? 'thud' : 'crack', { pos: hit.point, size: 0.6 });
    g.mgr.flushDirty();
    g.ui.toast(`절단 완료 — ${pcs.map((q) => Math.round(q.dims[axis] * 1000) + ' mm').join(' + ')}`);
  }

  // ═══ 스프레이 도장 ═══
  t_paint(dt, input, hit) {
    const g = this.g, st = this.st, P = hit?.part, col = PAINTS[this.paintIdx];
    st.spSnd = st.spSnd || g.sfx.loop('spray');
    if (input.btnHit[2] || input.pressed('KeyR')) { this.paintIdx = (this.paintIdx + 1) % PAINTS.length; g.sfx.play('click'); g.ui.setPaint(PAINTS[this.paintIdx]); }
    const cup = this.vm.paint.userData.paint.material; cup.color.set(col.c ?? 0x888888);
    this.hint = `색상: ${col.n} · 좌클릭(유지): 도장 · 우클릭/R: 색 변경`;
    const on = input.btn[0];
    st.spSnd?.set(on ? 0.35 : 0, 1);
    if (!on) { st.prog = 0; return; }
    const tip = this.vm.paint.userData.tip.getWorldPosition(new THREE.Vector3()), dir = g.camera.getWorldDirection(new THREE.Vector3());
    const c = new THREE.Color(col.c ?? 0xaaaaaa);
    for (let i = 0; i < 3; i++) g.fx.puff('soft', tip, dir.clone().multiplyScalar(rand(3, 5)).add(_v.set(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4))), [c.r, c.g, c.b], 0.02, 0.35, 0.35, rand(0.5, 1), 0, 2.2);
    if (!P || hit.dist > 3) return;
    if (st.target !== P) { st.target = P; st.prog = 0; }
    st.prog += dt / (0.25 + Math.sqrt(P.dims[0] * P.dims[2] + P.dims[1] * P.dims[0]) * 0.4);
    if (st.prog >= 1 && P.paint !== col.c) { P.paint = col.c; P.applyMaterials(g.mats); st.prog = 0; }
  }

  // ═══ 공구 애니메이션 ═══
  animate(dt, input) {
    const m = this.vm[this.tool]; if (!m) return;
    this.sway.x = THREE.MathUtils.damp(this.sway.x, clamp(-input.mx * 0.0006, -0.05, 0.05), 8, dt);
    this.sway.y = THREE.MathUtils.damp(this.sway.y, clamp(input.my * 0.0006, -0.05, 0.05), 8, dt);
    const bob = this.g.player.bob, sp = Math.hypot(this.g.player.vel.x, this.g.player.vel.z);
    m.position.set(this.sway.x + Math.cos(bob) * 0.008 * Math.min(1, sp / 3), this.sway.y - this.anim * 0.25 + Math.abs(Math.sin(bob)) * 0.008 * Math.min(1, sp / 3), 0);
    m.rotation.set(0, 0, 0);
    const st = this.st;
    if (this.tool === 'hammer') {
      const s = st.swing || 0, t = s > 0 ? 1 - s / 0.34 : 0;
      const a = t < 0.4 ? -t / 0.4 * 0.5 : t < 0.6 ? -0.5 + ((t - 0.4) / 0.2) * 1.9 : 1.4 - ((t - 0.6) / 0.4) * 1.4;
      m.userData.piv.rotation.x = -0.75 - a * 0.9; m.userData.piv.position.set(0, -0.05, 0.02);
      m.rotation.set(0.25, 0.35, 0.35); m.scale.setScalar(0.85);
    } else if (this.tool === 'drill') {
      const on = st.prog > 0; for (const o of m.userData.spin) o.rotation.y += on ? dt * 60 : 0;
      if (on) m.position.add(_v.set(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(0.002));
    } else if (this.tool === 'grinder') {
      m.userData.disc.rotation.y += (st.spin || 0) * dt * 90; m.rotation.set(0, 0, -0.1);
      if ((st.spin || 0) > 0.3) m.position.add(_v.set(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(0.003 * st.spin));
    } else if (this.tool === 'weld') {
      if (st.arc) m.position.add(_v.set(rand(-1, 1), rand(-1, 1), 0).multiplyScalar(0.0015));
      m.rotation.set(-0.15, 0, 0);
    } else if (this.tool === 'trowel' && input.btn[0]) {
      m.rotation.set(-0.3 + Math.sin(performance.now() * 0.012) * 0.15, 0, 0.2);
    }
  }
}
