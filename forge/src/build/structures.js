// 구조물 시스템: 부품(Part) · 접합(Joint) · 구조물(강체 1개 = 접합으로 연결된 부품 묶음)
// 용접/못/볼트/모르타르/클램프로 연결되면 하나의 강체로 병합되고, 하중이 접합 강도를 넘으면 끊어져 분리된다.
import * as THREE from 'three';
import { MATS, JOINT } from '../gfx/materials.js';
import { shapeFor, wheelParts, engineParts, seatParts, lightParts, thrusterParts, FAST } from '../gfx/geometry.js';
import { partMass, CAT_BY_ID } from './catalog.js';
import { GROUP, groups } from '../physics.js';
import { toV, toQ, rv, rq, clamp, rand } from '../core/util.js';

let PID = 1, SID = 1;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const G = new THREE.Vector3(0, -9.81, 0);
const ROT_X2Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const geoCache = new Map();

// 체결 요소 1개의 강도
export function fastenerStrength(f, now) {
  switch (f.kind) {
    case 'bead': return JOINT.bead;
    case 'clamp': return JOINT.clamp;
    case 'bolt': return JOINT.bolt;
    case 'nail': return f.bent ? 80 : f.stage >= 3 ? JOINT.nail : JOINT.nail * f.stage * 0.2;
    case 'mortar': return JOINT.mortar * clamp(0.08 + (now - f.t0) / 20, 0.08, 1);
  }
  return 0;
}

export class Joint {
  constructor(a, b) { this.a = a; this.b = b; this.fs = []; }
  other(p) { return p === this.a ? this.b : this.a; }
  strength(now) { let s = 0; for (const f of this.fs) s += fastenerStrength(f, now); return s; }
  permanent(now) { let s = 0; for (const f of this.fs) if (f.kind !== 'clamp') s += fastenerStrength(f, now); return s; }
  has(kind) { return this.fs.some((f) => f.kind === kind); }
}

export class Part {
  constructor(def, dims) {
    this.id = PID++; this.def = def; this.dims = dims.slice(); this.mat = MATS[def.mat]; this.skin = def.skin;
    this.paint = null; this.mass = partMass(def, dims);
    this.lp = new THREE.Vector3(); this.lq = new THREE.Quaternion();
    this.joints = new Set(); this.fs = []; this.colliders = []; this.dents = []; this.damage = 0; this.pinned = false;
    this.s = null; this.mesh = new THREE.Group(); this.mesh.userData.part = this;
    this.dentable = !!(this.mat.dent && def.shape === 'box' && Math.min(...dims) <= 0.0125);
    this.build();
  }
  get name() { return this.def.name; }
  // 시각 메쉬 + 충돌 형상 생성
  build() {
    const d = this.def;
    this.body = new THREE.Group(); this.mesh.add(this.body);
    if (d.mech) {
      let subs;
      if (d.mech === 'wheel') subs = wheelParts(d.r, d.w);
      else if (d.mech === 'engine') subs = engineParts(d.kind);
      else if (d.mech === 'seat') subs = seatParts();
      else if (d.mech === 'light') subs = lightParts();
      else subs = thrusterParts();
      this.subs = subs;
      if (d.mech === 'wheel') {
        this.pivot = new THREE.Group(); this.spin = new THREE.Group(); this.pivot.add(this.spin); this.body.add(this.pivot);
        this.cols = [{ t: 'ball', r: d.r * 0.3, p: [0, 0, 0] }];
      } else this.cols = d.cols;
    } else {
      const key = d.id + '|' + this.dims.join(',') + '|' + this.dentable;
      let sh = geoCache.get(key);
      if (!sh) { sh = shapeFor(d, this.dims, this.dentable); geoCache.set(key, sh); }
      this.geo = sh.geo; this.ownGeo = false; this.cols = sh.cols;
    }
    // 충돌 형상 질량 배분 (부피 비례)
    const vol = (c) => (c.t === 'box' ? c.h[0] * c.h[1] * c.h[2] * 8 : c.t === 'cylX' ? Math.PI * c.r * c.r * c.hl * 2 : (4 / 3) * Math.PI * c.r ** 3);
    const tot = this.cols.reduce((s, c) => s + vol(c), 0);
    this.colMass = this.cols.map((c) => (this.mass * vol(c)) / tot);
  }
  applyMaterials(lib) {
    const b = this.body;
    for (const m of [...b.children]) if (m.isMesh) b.remove(m);
    if (this.spin) this.spin.clear();
    const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.userData.part = this; return m; };
    if (this.subs) {
      for (const s of this.subs) {
        let mat;
        if (s.emissive) { mat = this.lensMat || (this.lensMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: s.emissive, emissiveIntensity: 0.15, roughness: 0.1, metalness: 0 })); }
        else mat = lib.get(s.skin, this.paint != null && s.skin === 'paint' ? this.paint : s.paint ?? null);
        if (this.paint != null && (s.skin === 'cast' || (this.def.mech === 'wheel' && s.skin === 'alu'))) mat = lib.get('paint', this.paint);
        (s.spin ? this.spin : b).add(mk(s.geo, mat));
      }
    } else b.add(mk(this.geo, lib.get(this.skin, this.paint)));
  }
  // 로컬 축 방향 반치수
  half(axis) { return this.dims[axis] / 2; }
  worldPos(out = new THREE.Vector3()) { return this.mesh.getWorldPosition(out); }
  worldQuat(out = new THREE.Quaternion()) { return this.mesh.getWorldQuaternion(out); }
  // 구조물 현재 물리 자세 기준 월드 변환
  physPose(outP, outQ) {
    const b = this.s.body, bq = toQ(b.rotation(), _q);
    outQ.copy(bq).multiply(this.lq); outP.copy(this.lp).applyQuaternion(bq).add(toV(b.translation(), _v2));
  }
  toLocal(world, out = new THREE.Vector3()) { this.mesh.updateWorldMatrix(true, false); return this.mesh.worldToLocal(out.copy(world)); }
  toWorld(local, out = new THREE.Vector3()) { this.mesh.updateWorldMatrix(true, false); return this.mesh.localToWorld(out.copy(local)); }
  strength(now) { let s = 0; for (const j of this.joints) s += j.strength(now); return s; }
}

export class Structure {
  constructor(body, group) {
    this.id = SID++; this.body = body; this.group = group; this.parts = new Set(); this.rig = null;
    this.pP = new THREE.Vector3(); this.pQ = new THREE.Quaternion(); this.cP = new THREE.Vector3(); this.cQ = new THREE.Quaternion();
    this.v0 = new THREE.Vector3(); this.w0 = new THREE.Vector3(); this.fresh = 3; this.extra = [];
  }
  get anchored() { return this.body.isFixed(); }
  get mass() { let m = 0; for (const p of this.parts) m += p.mass; return m; }
  snap() { toV(this.body.translation(), this.cP); toQ(this.body.rotation(), this.cQ); this.pP.copy(this.cP); this.pQ.copy(this.cQ); }
}

export class StructureManager {
  constructor({ scene, physics, mats, sfx, fx }) {
    this.scene = scene; this.ph = physics; this.mats = mats; this.sfx = sfx; this.fx = fx;
    this.structs = new Set(); this.colMap = new Map(); this.time = 0; this.onRig = null;
    this.beadMat = new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.55, metalness: 0.9, map: mats.skins.cast.map, normalMap: mats.skins.cast.normalMap });
    // 인스턴스 색 → 자체발광(열) 으로 사용
    this.beadMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor.rgb * 6.0;\n#endif');
    };
    this.mortarMat = new THREE.MeshStandardMaterial({ color: 0xa8a49a, roughness: 0.95, map: mats.skins.block.map });
    this.nailMat = new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.35, metalness: 1 });
    this.boltMat = new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.4, metalness: 1, map: mats.skins.galv.map });
    this.clampMat = new THREE.MeshStandardMaterial({ color: 0xc22020, roughness: 0.45, metalness: 0.3 });
    this.anchorMat = new THREE.MeshStandardMaterial({ color: 0xe8b818, roughness: 0.5, metalness: 0.4 });
    this.hot = new Set(); // 식고 있는 비드
  }

  // ─── 생성 ───
  createPart(def, dims = def.dims, paint = null) {
    const p = new Part(def, dims); p.paint = paint; p.applyMaterials(this.mats); return p;
  }
  newStructure(pos, quat, fixed = false) {
    const R = this.ph.R;
    const desc = (fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic()).setTranslation(pos.x, pos.y, pos.z).setRotation(rq(quat))
      .setCcdEnabled(true).setLinearDamping(0.03).setAngularDamping(0.08);
    const body = this.ph.world.createRigidBody(desc);
    const group = new THREE.Group(); group.position.copy(pos); group.quaternion.copy(quat); this.scene.add(group);
    const s = new Structure(body, group); s.snap(); this.structs.add(s);
    return s;
  }
  // 월드 자세로 부품을 새 구조물로 생성
  spawn(part, pos, quat, fixed = false) {
    const s = this.newStructure(pos, quat, fixed);
    this.attach(part, s, null, null); return s;
  }
  // 부품을 구조물에 붙임. wpos/wquat 가 null 이면 lp/lq 그대로 사용
  attach(part, s, wpos, wquat) {
    if (wpos) {
      const bq = toQ(s.body.rotation(), _q).clone(), bp = toV(s.body.translation());
      part.lq.copy(bq).invert().multiply(wquat);
      part.lp.copy(wpos).sub(bp).applyQuaternion(bq.invert());
    }
    part.s = s; s.parts.add(part);
    part.mesh.position.copy(part.lp); part.mesh.quaternion.copy(part.lq); s.group.add(part.mesh);
    this.makeColliders(part);
  }
  makeColliders(part) {
    const R = this.ph.R, s = part.s, m = part.mat;
    for (let i = 0; i < part.cols.length; i++) {
      const c = part.cols[i];
      let d;
      if (c.t === 'box') d = R.ColliderDesc.cuboid(Math.max(c.h[0], 0.001), Math.max(c.h[1], 0.001), Math.max(c.h[2], 0.001));
      else if (c.t === 'cylX') d = R.ColliderDesc.cylinder(c.hl, c.r);
      else d = R.ColliderDesc.ball(c.r);
      const lp = _v.fromArray(c.p).applyQuaternion(part.lq).add(part.lp);
      const lq = part.lq.clone(); if (c.t === 'cylX') lq.multiply(ROT_X2Y);
      d.setTranslation(lp.x, lp.y, lp.z).setRotation(rq(lq)).setMass(part.colMass[i]).setFriction(m.friction).setRestitution(m.rest)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(400 + part.mass * 30)
        .setCollisionGroups(groups(GROUP.PART, 0xffff));
      if (part.def.mech === 'wheel') d.setCollisionGroups(groups(GROUP.PART, GROUP.PART)); // 바퀴 허브는 지면과 충돌 안 함
      const col = this.ph.world.createCollider(d, s.body);
      part.colliders.push(col); this.colMap.set(col.handle, part);
    }
  }
  dropColliders(part) {
    for (const c of part.colliders) { this.colMap.delete(c.handle); if (this.ph.world.getCollider(c.handle)) this.ph.world.removeCollider(c, true); }
    part.colliders = [];
  }
  partOf(collider) { return collider ? this.colMap.get(collider.handle) : null; }

  // ─── 접합 ───
  jointBetween(a, b) { for (const j of a.joints) if (j.other(a) === b) return j; return null; }
  // 두 부품 사이 체결요소 추가 (다른 구조물이면 병합)
  connect(a, b) {
    let j = this.jointBetween(a, b);
    if (!j) { j = new Joint(a, b); a.joints.add(j); b.joints.add(j); }
    if (a.s !== b.s) this.merge(a.s, b.s);
    return j;
  }
  // 체결요소 시각물 생성 + 등록. host: 시각물이 붙을 부품, lpos/lnrm: host 로컬
  addFastener(j, host, kind, lpos, lnrm, extra = {}) {
    const f = { kind, host, joint: j, p: lpos.clone(), n: lnrm.clone().normalize(), stage: 0, t0: this.time, ...extra };
    this.makeFastenerMesh(f);
    host.fs.push(f); if (j) j.fs.push(f);
    return f;
  }
  makeFastenerMesh(f) {
    const host = f.host;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), f.n);
    if (f.kind === 'bead' || f.kind === 'mortar') {
      const key = f.kind === 'bead' ? 'beadIM' : 'mortarIM';
      let im = host[key];
      const need = (im ? im.count : 0) + 1;
      if (!im || need > im.instanceMatrix.count) {
        const cap = Math.max(32, need * 2);
        const nim = new THREE.InstancedMesh(f.kind === 'bead' ? FAST.bead : FAST.mortar, f.kind === 'bead' ? this.beadMat : this.mortarMat, cap);
        nim.castShadow = true; nim.receiveShadow = true; nim.count = 0; nim.frustumCulled = false;
        if (f.kind === 'bead') nim.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        if (im) {
          for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, _m); nim.setMatrixAt(i, _m); if (im.instanceColor) nim.instanceColor.setXYZ(i, im.instanceColor.getX(i), im.instanceColor.getY(i), im.instanceColor.getZ(i)); }
          nim.count = im.count; host.mesh.remove(im); im.dispose();
        }
        host.mesh.add(nim); host[key] = im = nim;
      }
      const s = f.kind === 'bead' ? rand(0.8, 1.25) : rand(0.8, 1.2);
      const rot = q.clone().multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), rand(0, 6.28)));
      _m.compose(f.p, rot, _v2.set(s, s * (f.kind === 'bead' ? rand(0.8, 1.3) : 1), s));
      f.idx = im.count; im.setMatrixAt(im.count, _m); im.count++;
      if (im.instanceColor) { im.instanceColor.setXYZ(f.idx, 0, 0, 0); im.instanceColor.needsUpdate = true; }
      im.instanceMatrix.needsUpdate = true;
      if (!host.instItems) host.instItems = { bead: [], mortar: [] };
      host.instItems[f.kind][f.idx] = f;
      return;
    }
    let mesh;
    if (f.kind === 'nail') {
      mesh = new THREE.Group();
      const sh = new THREE.Mesh(FAST.nailShaft, this.nailMat), hd = new THREE.Mesh(FAST.nailHead, this.nailMat);
      mesh.add(sh, hd); f.sub = mesh;
      mesh.position.copy(f.p); mesh.quaternion.copy(q);
      this.setNailStage(f);
    } else if (f.kind === 'bolt' || f.kind === 'anchor') {
      mesh = new THREE.Mesh(FAST.boltHead, f.kind === 'anchor' ? this.anchorMat : this.boltMat);
      if (f.kind === 'anchor') mesh.scale.setScalar(1.6);
      mesh.position.copy(f.p); mesh.quaternion.copy(q).multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), rand(0, 1)));
    } else if (f.kind === 'clamp') {
      mesh = new THREE.Group(); mesh.add(new THREE.Mesh(FAST.clamp, this.clampMat), new THREE.Mesh(FAST.clampScrew, this.nailMat));
      // 클램프: 접촉면(f.n) 을 사이에 두고 두 부품을 물고 있는 모습. f.t = 바깥 방향(접선)
      const n = f.n, t = (f.tan || new THREE.Vector3(1, 0, 0)).clone();
      const yAxis = n.clone(), xAxis = t.clone().negate(), zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
      _m.makeBasis(xAxis, yAxis, zAxis); mesh.quaternion.setFromRotationMatrix(_m);
      mesh.position.copy(f.p).addScaledVector(t, 0.03);
    }
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.part = host; } });
    host.mesh.add(mesh); f.mesh = mesh;
  }
  setNailStage(f) {
    const depth = [0.05, 0.034, 0.018, 0.001][Math.min(f.stage, 3)];
    f.sub.children[0].position.y = depth; f.sub.children[1].position.y = depth;
    if (f.bent) { f.sub.children[0].rotation.z = 0.9; f.sub.children[0].position.x = 0.015; f.sub.children[1].visible = true; }
  }
  removeFastener(f) {
    const host = f.host;
    if (f.kind === 'bead' || f.kind === 'mortar') {
      const key = f.kind === 'bead' ? 'beadIM' : 'mortarIM', im = host[key], items = host.instItems[f.kind];
      const last = im.count - 1;
      if (f.idx !== last) {
        im.getMatrixAt(last, _m); im.setMatrixAt(f.idx, _m);
        if (im.instanceColor) im.instanceColor.setXYZ(f.idx, im.instanceColor.getX(last), im.instanceColor.getY(last), im.instanceColor.getZ(last));
        const mv = items[last]; items[f.idx] = mv; mv.idx = f.idx;
      }
      items.length = last; im.count = last; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.hot.delete(f);
    } else if (f.mesh) host.mesh.remove(f.mesh);
    host.fs.splice(host.fs.indexOf(f), 1);
    if (f.joint) { const j = f.joint; j.fs.splice(j.fs.indexOf(f), 1); f.joint = null; if (j.fs.length === 0) this.breakJoint(j, true); }
  }
  // 비드 열색 (0~1 → 흑적 → 주황 → 백열)
  setBeadHeat(f, h) {
    const im = f.host.beadIM; if (!im) return;
    const c = h <= 0 ? [0, 0, 0] : [Math.min(1, h * 2.2) * 1.0, Math.max(0, h * 1.6 - 0.45) * 0.75, Math.max(0, h * 2 - 1.4) * 0.6];
    const k = h * h;
    im.instanceColor.setXYZ(f.idx, c[0] * k * 1.4, c[1] * k * 1.3, c[2] * k * 1.2); im.instanceColor.needsUpdate = true;
  }
  // 접합 해제 (clean=true 면 시각물도 제거)
  breakJoint(j, silent = false) {
    if (!j.a.joints.has(j)) return;
    j.a.joints.delete(j); j.b.joints.delete(j);
    for (const f of [...j.fs]) {
      f.joint = null;
      if (f.kind === 'clamp' || f.kind === 'bolt' || f.kind === 'nail') { // 볼트/못/클램프는 튕겨 나감
        if (f.mesh) { this.fx?.debrisFrom(f.host.toWorld(f.p), f.kind); f.host.mesh.remove(f.mesh); }
        f.host.fs.splice(f.host.fs.indexOf(f), 1);
      }
    }
    j.fs = [];
    if (!silent) { const w = j.a.worldPos(); this.sfx.play('snap', { pos: w, vol: 0.8 }); }
    this.dirty.add(j.a.s);
  }
  dirty = new Set();

  // ─── 병합 / 분리 ───
  merge(A, B) {
    if (A === B) return A;
    let keep = A, gone = B;
    if (B.anchored && !A.anchored) [keep, gone] = [B, A];
    else if (A.anchored === B.anchored && B.mass > A.mass) [keep, gone] = [B, A];
    const mk = keep.mass, mg = gone.mass;
    const vk = toV(keep.body.linvel()), vg = toV(gone.body.linvel());
    const kq = toQ(keep.body.rotation()), kp = toV(keep.body.translation()), kqi = kq.clone().invert();
    const gq = toQ(gone.body.rotation()), gp = toV(gone.body.translation());
    for (const p of [...gone.parts]) {
      const wq = gq.clone().multiply(p.lq), wp = p.lp.clone().applyQuaternion(gq).add(gp);
      this.dropColliders(p); gone.parts.delete(p);
      p.lq.copy(kqi).multiply(wq); p.lp.copy(wp).sub(kp).applyQuaternion(kqi);
      p.s = keep; keep.parts.add(p); p.mesh.position.copy(p.lp); p.mesh.quaternion.copy(p.lq); keep.group.add(p.mesh);
      this.makeColliders(p);
    }
    if (!keep.anchored) keep.body.setLinvel(rv(vk.multiplyScalar(mk).addScaledVector(vg, mg).divideScalar(mk + mg)), true);
    this.destroyStructure(gone);
    keep.fresh = 3; this.rebuildRig(keep);
    return keep;
  }
  destroyStructure(s) {
    if (s.rig) { s.rig.dispose(); s.rig = null; }
    for (const e of s.extra) this.ph.world.removeCollider(e, false); s.extra = [];
    this.ph.world.removeRigidBody(s.body); this.scene.remove(s.group); this.structs.delete(s);
  }
  // 연결 요소 분석 후 분리
  splitCheck(S) {
    if (!this.structs.has(S) || S.parts.size === 0) { if (this.structs.has(S) && S.parts.size === 0) this.destroyStructure(S); return; }
    const seen = new Set(), comps = [];
    for (const p of S.parts) {
      if (seen.has(p)) continue;
      const comp = [], st = [p]; seen.add(p);
      while (st.length) { const q = st.pop(); comp.push(q); for (const j of q.joints) { const o = j.other(q); if (!seen.has(o) && o.s === S) { seen.add(o); st.push(o); } } }
      comps.push(comp);
    }
    if (comps.length <= 1) { this.rebuildRig(S); return; }
    const pinned = (c) => c.some((p) => p.pinned);
    const cm = (c) => c.reduce((m, p) => m + p.mass, 0);
    comps.sort((a, b) => (pinned(b) - pinned(a)) || cm(b) - cm(a));
    const bp = toV(S.body.translation()), bq = toQ(S.body.rotation());
    const lv = toV(S.body.linvel()), av = toV(S.body.angvel()), com = toV(S.body.worldCom());
    for (let i = 1; i < comps.length; i++) {
      const c = comps[i], ns = this.newStructure(bp, bq, pinned(c));
      for (const p of c) { this.dropColliders(p); S.parts.delete(p); this.attach(p, ns, null, null); }
      if (!ns.anchored) {
        const r = toV(ns.body.worldCom()).sub(com);
        ns.body.setLinvel(rv(lv.clone().add(_v.crossVectors(av, r))), true); ns.body.setAngvel(rv(av), true);
      }
      ns.fresh = 3; this.rebuildRig(ns);
    }
    if (S.anchored && !pinned(comps[0])) S.body.setBodyType(this.ph.R.RigidBodyType.Dynamic, true);
    S.fresh = 3; this.rebuildRig(S);
  }
  rebuildRig(s) { this.onRig?.(s); }

  // 부품 제거 (철거)
  removePart(p, fxOn = true) {
    const S = p.s;
    for (const j of [...p.joints]) this.breakJoint(j, true);
    this.dropColliders(p); S.parts.delete(p); S.group.remove(p.mesh);
    for (const f of p.fs) this.hot.delete(f);
    if (p.ownGeo) p.geo.dispose();
    p.s = null;
    if (S.parts.size === 0) this.destroyStructure(S); else this.dirty.add(S);
  }
  setPinned(p, on) {
    p.pinned = on;
    const S = p.s, any = [...S.parts].some((q) => q.pinned);
    const R = this.ph.R;
    if (any && !S.anchored) { S.body.setBodyType(R.RigidBodyType.Fixed, true); }
    else if (!any && S.anchored) { S.body.setBodyType(R.RigidBodyType.Dynamic, true); S.body.wakeUp(); }
    S.fresh = 3; this.rebuildRig(S);
  }

  // ─── 절단 (그라인더) : 부품을 로컬 axis 방향 좌표 c 에서 둘로 나눔 ───
  cutPart(p, axis, c, kerf = 0.002) {
    const L = p.dims[axis], lo = -L / 2, hi = L / 2;
    const la = c - kerf / 2 - lo, lb = hi - (c + kerf / 2);
    if (la < 0.012 || lb < 0.012) return null;
    const S = p.s, pieces = [];
    for (const [len, ctr] of [[la, lo + la / 2], [lb, hi - lb / 2]]) {
      const dims = p.dims.slice(); dims[axis] = len;
      const q = this.createPart(p.def, dims, p.paint);
      const off = new THREE.Vector3(); off.setComponent(axis, ctr);
      q.lq.copy(p.lq); q.lp.copy(off).applyQuaternion(p.lq).add(p.lp); q.off = off;
      pieces.push(q);
    }
    // 접합/체결 재배분: p 로컬 좌표에서 절단면 기준
    const side = (local) => (local.getComponent(axis) < c ? 0 : 1);
    const toP = (other, lpos) => { // other 로컬 → p 로컬 (같은 구조물)
      return lpos.clone().applyQuaternion(other.lq).add(other.lp).sub(p.lp).applyQuaternion(p.lq.clone().invert());
    };
    const oldJoints = [...p.joints], oldFs = [...p.fs];
    for (const f of oldFs) this.hot.delete(f);
    for (const j of oldJoints) { j.a.joints.delete(j); j.b.joints.delete(j); }
    // p 자신에 붙은 비조인트 시각물(앵커 등)
    const pinSide = [false, false];
    for (const f of oldFs) if (!f.joint && f.kind === 'anchor') pinSide[side(f.p)] = true;
    S.parts.delete(p); this.dropColliders(p); S.group.remove(p.mesh);
    for (const q of pieces) { this.attach(q, S, null, null); }
    for (const j of oldJoints) {
      const o = j.other(p), nj = [null, null];
      for (const f of j.fs) {
        const loc = f.host === p ? f.p : toP(o, f.p);
        const k = side(loc), piece = pieces[k];
        if (!nj[k]) { nj[k] = new Joint(piece, o); piece.joints.add(nj[k]); o.joints.add(nj[k]); }
        if (f.host === p) this.addFastener(nj[k], piece, f.kind, f.p.clone().sub(piece.off), f.n, { stage: f.stage, bent: f.bent, t0: f.t0, tan: f.tan });
        else { f.joint = nj[k]; nj[k].fs.push(f); }
      }
    }
    for (const f of oldFs) if (!f.joint && f.kind === 'anchor') { const k = side(f.p); this.addFastener(null, pieces[k], 'anchor', f.p.clone().sub(pieces[k].off), f.n); }
    pieces.forEach((q, k) => { q.pinned = p.pinned && pinSide[k]; });
    if (p.pinned && !pinSide[0] && !pinSide[1]) pieces[0].pinned = true;
    if (!pieces.some((q) => q.pinned) && S.anchored && ![...S.parts].some((q) => q.pinned)) S.body.setBodyType(this.ph.R.RigidBodyType.Dynamic, true);
    this.dirty.add(S);
    return pieces;
  }

  // ─── 찌그러짐 (얇은 판재) ───
  dent(p, localPoint, pushDir, radius, depth) {
    if (!p.dentable || p.dents.length > 60) return false;
    if (!p.ownGeo) { p.geo = p.geo.clone(); p.ownGeo = true; p.body.children[0].geometry = p.geo; }
    const thin = p.dims.indexOf(Math.min(...p.dims)), sgn = Math.sign(pushDir.getComponent(thin)) || 1;
    const pos = p.geo.attributes.position, a1 = (thin + 1) % 3, a2 = (thin + 2) % 3;
    const lim = Math.min(0.06, Math.min(p.dims[a1], p.dims[a2]) * 0.15);
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getComponent(i, a1) - localPoint.getComponent(a1), dy = pos.getComponent(i, a2) - localPoint.getComponent(a2);
      const d = Math.hypot(dx, dy); if (d >= radius) continue;
      const w = 0.5 * (1 + Math.cos((Math.PI * d) / radius));
      const cur = pos.getComponent(i, thin), base = Math.sign(cur) * p.dims[thin] / 2;
      const off = clamp(cur - base + sgn * depth * w, -lim, lim);
      pos.setComponent(i, thin, base + off);
    }
    pos.needsUpdate = true; p.geo.computeVertexNormals(); p.geo.computeBoundingSphere();
    p.dents.push([localPoint.x, localPoint.y, localPoint.z, pushDir.x, pushDir.y, pushDir.z, radius, depth]);
    return true;
  }

  // ─── 매 물리 단계: 하중 → 접합 파손 ───
  physicsStep(dt) {
    this.time += dt;
    for (const s of this.structs) {
      if (s.anchored) continue;
      const b = s.body, v = toV(b.linvel()), w = toV(b.angvel());
      if (s.fresh > 0 || b.isSleeping()) { s.fresh--; s.v0.copy(v); s.w0.copy(w); continue; }
      if (s.parts.size < 2) { s.v0.copy(v); s.w0.copy(w); continue; }
      const a = v.clone().sub(s.v0).divideScalar(dt), al = w.clone().sub(s.w0).divideScalar(dt);
      s.v0.copy(v); s.w0.copy(w);
      if (a.lengthSq() < 4 && al.lengthSq() < 4) continue; // 정상 상태(중력만) — 하중 = 자중
      const com = toV(b.worldCom()), bq = toQ(b.rotation()), bp = toV(b.translation());
      let broke = 0;
      for (const p of s.parts) {
        if (!p.joints.size) continue;
        const r = _v.copy(p.lp).applyQuaternion(bq).add(bp).sub(com);
        const ap = _v2.copy(a).add(new THREE.Vector3().crossVectors(al, r)).add(new THREE.Vector3().crossVectors(w, new THREE.Vector3().crossVectors(w, r)));
        const load = p.mass * ap.sub(G).length();
        if (load > p.strength(this.time) * 1.0 && broke < 3) { this.breakWeakest(p); broke++; }
      }
    }
  }
  breakWeakest(p) {
    let wj = null, ws = Infinity;
    for (const j of p.joints) { const st = j.strength(this.time); if (st < ws) { ws = st; wj = j; } }
    if (wj) this.breakJoint(wj);
  }
  // 정적 하중 검사 (가끔): 자중 > 접합 강도이면 떨어짐
  staticCheck() {
    for (const s of this.structs) for (const p of s.parts) {
      if (!p.joints.size) continue;
      if (p.mass * 9.81 > p.strength(this.time)) this.breakWeakest(p);
    }
  }
  flushDirty() {
    if (!this.dirty.size) return;
    const d = [...this.dirty]; this.dirty.clear();
    for (const s of d) this.splitCheck(s);
  }
  // 렌더 보간
  beforePhysics() { for (const s of this.structs) { s.pP.copy(s.cP); s.pQ.copy(s.cQ); } }
  afterPhysics() { for (const s of this.structs) { toV(s.body.translation(), s.cP); toQ(s.body.rotation(), s.cQ); } }
  sync(alpha) {
    for (const s of this.structs) { s.group.position.lerpVectors(s.pP, s.cP, alpha); s.group.quaternion.slerpQuaternions(s.pQ, s.cQ, alpha); }
  }
  update(dt) {
    // 비드 냉각
    for (const f of this.hot) {
      f.heat -= dt / 7; if (f.heat <= 0) { f.heat = 0; this.hot.delete(f); }
      if (f.host.beadIM) this.setBeadHeat(f, f.heat);
    }
  }
  // 낙하 정리 (월드 밖)
  cleanup() {
    for (const s of [...this.structs]) if (s.body.translation().y < -200) { for (const p of [...s.parts]) this.removePart(p, false); }
  }
  clearAll() { for (const s of [...this.structs]) this.destroyStructure(s); this.hot.clear(); this.dirty.clear(); }
}
