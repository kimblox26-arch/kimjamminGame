// Rapier 물리 월드 래퍼 — 고정 시간 간격(120Hz), 레이캐스트, 충돌 이벤트
import RAPIER from '../../vendor/rapier/rapier.mjs';
import * as THREE from 'three';

export const GROUP = { PART: 0x0001, WORLD: 0x0002, PLAYER: 0x0004, GHOST: 0x0008 };
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

export class Physics {
  async init() {
    await RAPIER.init();
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 120;
    this.events = new RAPIER.EventQueue(true);
    this.dt = 1 / 120; this.acc = 0; this.alpha = 0;
    this.statics = new Map(); // collider handle → {mat}
    this.onContactForce = null;
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }
  // 정적 월드 충돌체 추가 (mat: 소리/이펙트 재질)
  addStatic(desc, mat = 'concrete') {
    desc.setCollisionGroups(groups(GROUP.WORLD, 0xffff));
    const c = this.world.createCollider(desc);
    this.statics.set(c.handle, { mat, static: true });
    return c;
  }
  // 고정 간격 시뮬레이션. preStep(dt): 매 하위 단계 전에 호출
  step(frameDt, preStep, postStep) {
    this.acc += Math.min(frameDt, 0.1);
    let n = 0;
    while (this.acc >= this.dt && n < 10) {
      preStep?.(this.dt);
      this.world.step(this.events);
      this.events.drainContactForceEvents((e) => this.onContactForce?.(e));
      this.events.drainCollisionEvents(() => {});
      postStep?.(this.dt);
      this.acc -= this.dt; n++;
    }
    if (n === 10) this.acc = 0;
    this.alpha = this.acc / this.dt;
    return n;
  }
  // 레이캐스트 → {collider, point(V3), normal(V3), dist}
  raycast(origin, dir, maxDist, exclude, excludeBody, filter = 0xffff ^ GROUP.PLAYER ^ GROUP.GHOST) {
    const r = this.ray; r.origin = { x: origin.x, y: origin.y, z: origin.z }; r.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(r, maxDist, true, undefined, groups(0xffff, filter), exclude, excludeBody);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      collider: hit.collider, dist: t,
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    };
  }
  // 점 주변 충돌체 목록
  overlapBall(p, r, cb, filter = GROUP.PART | GROUP.WORLD) {
    const shape = new this.R.Ball(r);
    this.world.intersectionsWithShape(p, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => { cb(c); return true; }, undefined, groups(0xffff, filter));
  }
  overlapBox(p, q, half, cb, filter = GROUP.PART | GROUP.WORLD, excludeBody) {
    const shape = new this.R.Cuboid(half.x, half.y, half.z);
    this.world.intersectionsWithShape(p, q, shape, (c) => { cb(c); return true; }, undefined, groups(0xffff, filter), undefined, excludeBody);
  }
}
