// 1인칭 사람 모드: 걷기·달리기(체력)·점프·건물 충돌·수직대피(옥상)·물살에 휩쓸림·수영·탈출
import { HALF, WORLD, SAFE_ELEV, LINES } from './config.js';

const EYE = 1.62;

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = false;
    this.x = 0; this.z = 0; this.y = 0;
    this.yaw = 0; this.pitch = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.s = {};
    this.reset();
  }

  reset() {
    this.state = 'walk';         // walk | swept | climbing
    this.roof = null;
    this.stamina = 1;
    this.fear = 0.05;
    this.heart = 72;
    this.threat = 0;
    this.threatDir = [0, 1];
    this.bob = 0;
    this.waterT = 0;
    this.under = 0;
    this.prompt = '';
    this.climbT = 0;
    this.status = '';
    this.safe = false;
    this.depth = 0;
  }

  spawn(x, z, yaw = Math.PI) {
    this.reset();
    const { city, terrain } = this.ctx;
    const p = { x, z };
    city.collide(p, 0.5);
    this.x = p.x; this.z = p.z;
    this.y = terrain.groundAt(this.x, this.z);
    this.yaw = yaw; this.pitch = -0.02;
    this.vx = this.vz = this.vy = 0;
    this.active = true;
  }

  ground() {
    const { terrain } = this.ctx;
    const g = terrain.groundAt(this.x, this.z);
    if (this.roof && this.roof.alive && Math.abs(this.x - this.roof.x) < this.roof.w / 2 && Math.abs(this.z - this.roof.z) < this.roof.d / 2) return Math.max(g, this.roof.top);
    this.roof = null;
    return g;
  }

  /** inp: { mx, mz (-1..1 이동), run, jump, act, lookX, lookY } */
  update(dt, inp, env) {
    if (!this.active || dt <= 0) return;
    const { city, terrain, sim } = this.ctx;
    this.yaw -= inp.lookX; this.pitch -= inp.lookY;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    const s = sim.sample(this.x, this.z, this.s);
    const g = this.ground();
    const depth = Math.max(0, s.eta - g);
    this.depth = depth;
    const wsp = Math.hypot(s.u, s.v);
    this.prompt = '';
    this.perceive(env);

    if (this.state === 'climbing') {
      this.climbT -= dt;
      if (this.climbT <= 0 && this.climbTarget) {
        const b = this.climbTarget;
        this.state = 'walk'; this.roof = b;
        this.x = Math.max(b.x - b.w / 2 + 1.5, Math.min(b.x + b.w / 2 - 1.5, this.x));
        this.z = Math.max(b.z - b.d / 2 + 1.5, Math.min(b.z + b.d / 2 - 1.5, this.z));
        this.y = b.top; this.vy = 0;
        this.status = `${b.name} 옥상 도착 — 높이 ${b.h.toFixed(0)} m`;
        this.climbTarget = null;
      }
      this.mood(dt, depth);
      return;
    }

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = inp.mx, mz = inp.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }

    if (this.state === 'swept') {
      this.waterT += dt;
      const swim = 1.25 * (0.4 + 0.6 * this.stamina);
      const tx = s.u + (fx * mz + rx * mx) * swim, tz = s.v + (fz * mz + rz * mx) * swim;
      this.vx += (tx - this.vx) * Math.min(1, dt * 2.5);
      this.vz += (tz - this.vz) * Math.min(1, dt * 2.5);
      this.stamina = Math.max(0, this.stamina - dt * (ml > 0.1 ? 0.02 : 0.006));
      this.x += this.vx * dt; this.z += this.vz * dt;
      this.clampWorld();
      const p = { x: this.x, z: this.z };
      const hit = city.collide(p, 0.45, s.eta - 0.5);
      this.x = p.x; this.z = p.z;
      // 수면에서 흔들림 · 물속으로 잠김
      const turb = Math.min(1, wsp / 6) * (0.5 + 0.5 * Math.sin(env.time * 1.3 + Math.sin(env.time * 0.37) * 3));
      this.under += ((turb > 0.62 || this.stamina < 0.08 ? 1 : 0) - this.under) * Math.min(1, dt * 3);
      this.y = Math.max(terrain.groundAt(this.x, this.z), s.eta - 1.45 - this.under * 1.2);
      // 탈출 조건
      if (hit && hit.alive) {
        const climb = hit.top - s.eta;
        if (climb < 3.5 && climb > -0.5) { this.prompt = `E: ${hit.name} 지붕으로 기어오르기`; if (inp.act) this.toRoof(hit); }
        else if (hit.evac) { this.prompt = `E: 창문으로 ${hit.name} 안에 들어가기`; if (inp.act) this.startClimb(hit, 2.5); }
      }
      const d2 = Math.max(0, s.eta - terrain.groundAt(this.x, this.z));
      if ((d2 < 0.55 && wsp < 1.6) || d2 < 0.1) { this.state = 'walk'; this.status = '간신히 발이 닿았다! 높은 곳으로!'; this.under = 0; this.vy = 0; }
      this.mood(dt, depth);
      return;
    }

    // 지상 보행
    const runK = inp.run && this.stamina > 0.05 ? 1 : 0;
    let speed = runK ? 5.6 * (0.55 + 0.45 * this.stamina) : 1.75;
    if (mz < 0) speed *= 0.7;
    if (depth > 0.05) speed *= Math.max(0.15, 1 - depth / 1.2);
    let tvx = (fx * mz + rx * mx) * speed, tvz = (fz * mz + rz * mx) * speed;
    const grounded = this.y <= g + 0.05;
    const acc = (grounded ? 14 : 2.5) * dt;
    let ddx = tvx - this.vx, ddz = tvz - this.vz;
    const dl = Math.hypot(ddx, ddz);
    if (dl > acc) { ddx *= acc / dl; ddz *= acc / dl; }
    this.vx += ddx; this.vz += ddz;
    if (depth > 0.05) {
      const k = Math.min(1, depth / 1.0) * 1.3 * dt;
      this.vx += (s.u - this.vx) * k * 0.5; this.vz += (s.v - this.vz) * k * 0.5;
    }
    if (inp.jump && grounded && depth < 0.8) this.vy = 4.3;
    this.vy -= 9.81 * dt;
    const ox = this.x, oz = this.z;
    this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
    this.clampWorld();
    // 급경사 차단
    const ng = terrain.groundAt(this.x, this.z);
    if (!this.roof && ng - g > 0.9 && ng > this.y + 0.6) { this.x = ox; this.z = oz; this.vx *= 0.2; this.vz *= 0.2; }
    const p = { x: this.x, z: this.z };
    const hit = city.collide(p, 0.38, this.y);
    this.x = p.x; this.z = p.z;
    // 낮은 지붕·담 위로 점프 착지
    if (!this.roof) { const b = city.buildingAt(this.x, this.z, -0.2); if (b && b.alive && this.y >= b.top - 0.4) this.roof = b; }
    const gg = this.ground();
    if (this.y < gg) { this.y = gg; if (this.vy < 0) this.vy = 0; }
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 2.4) this.stamina = Math.max(0, this.stamina - dt * 0.03 * sp / 5);
    else this.stamina = Math.min(1, this.stamina + dt * 0.06);
    this.bob += sp * dt * (sp > 2.4 ? 1.55 : 1.9);
    // 대피 건물 진입
    const near = hit || city.buildingAt(this.x, this.z, 1.6);
    if (near && near.alive && !this.roof && near.floors >= 2) {
      if (near.evac) { this.prompt = `E: ${near.name} 계단으로 옥상까지 (${near.floors}층)`; if (inp.act) this.startClimb(near, 1 + near.floors * 0.35); }
      else if (near.top - this.y < 3.2) { this.prompt = `E: ${near.name} 지붕으로 오르기`; if (inp.act) this.toRoof(near); }
    }
    // 휩쓸림 판정 (성인 기준)
    const dvc = 0.62;
    if (depth > 0.05 && (depth * wsp > dvc || depth > 1.35)) {
      this.state = 'swept'; this.roof = null; this.waterT = 0;
      this.status = '물살에 휩쓸렸다! 방향키로 헤엄쳐 건물이나 얕은 곳으로!';
    }
    this.safe = !this.roof ? terrain.groundAt(this.x, this.z) >= SAFE_ELEV : this.roof.top - (s.eta) > 3;
    this.mood(dt, depth);
  }

  startClimb(b, t) {
    this.state = 'climbing'; this.climbTarget = b; this.climbT = t;
    this.status = `${b.name} 계단을 오르는 중...`;
  }

  toRoof(b) {
    this.state = 'walk'; this.roof = b; this.y = b.top; this.vy = 0; this.under = 0;
    this.x = Math.max(b.x - b.w / 2 + 1, Math.min(b.x + b.w / 2 - 1, this.x));
    this.z = Math.max(b.z - b.d / 2 + 1, Math.min(b.z + b.d / 2 - 1, this.z));
    this.status = `${b.name} 지붕 위로 올라갔다`;
  }

  clampWorld() {
    this.x = Math.max(-HALF + 5, Math.min(HALF - 5, this.x));
    this.z = Math.max(-HALF + 5, Math.min(HALF - 5, this.z));
  }

  perceive(env) {
    const sim = this.ctx.sim, CN = sim.CN, cs = WORLD / CN;
    const R = this.y > 14 ? 1300 : 800;
    const ci = Math.floor((this.x + HALF) / cs), cj = Math.floor((this.z + HALF) / cs), rc = Math.ceil(R / cs);
    let best = 0, bx = 0, bz = 0;
    for (let j = Math.max(0, cj - rc); j <= Math.min(CN - 1, cj + rc); j++) for (let i = Math.max(0, ci - rc); i <= Math.min(CN - 1, ci + rc); i++) {
      const t = sim.threat[j * CN + i];
      if (!t) continue;
      const cx = -HALF + (i + 0.5) * cs - this.x, cz = -HALF + (j + 0.5) * cs - this.z;
      const d = Math.hypot(cx, cz);
      if (d > R) continue;
      const v = t * (0.3 + 0.7 * (1 - d / R));
      if (v > best) { best = v; bx = cx; bz = cz; }
    }
    this.threat = best;
    if (best > 0.3) { const l = Math.hypot(bx, bz) || 1; this.threatDir = [bx / l, bz / l]; }
    this.env = env;
  }

  mood(dt, depth) {
    const env = this.env || {};
    let ft = 0.05;
    if (env.quake > 0.05) ft = Math.max(ft, env.quake * 0.8);
    if (env.sirenOn) ft = Math.max(ft, 0.3);
    if (this.threat > 0.5) ft = Math.max(ft, Math.min(1, 0.45 + this.threat * 0.12));
    if (depth > 0.1) ft = Math.max(ft, Math.min(1, 0.6 + depth * 0.5));
    if (this.state === 'swept') ft = 1;
    if (this.safe) ft = Math.min(ft, 0.25);
    this.fear += (ft - this.fear) * Math.min(1, dt * (ft > this.fear ? 2 : 0.15));
    const exert = Math.min(1, Math.hypot(this.vx, this.vz) / 5);
    this.heart += (68 + this.fear * 90 + exert * 40 - this.heart) * Math.min(1, dt * 0.7);
    const f = this.fear;
    this.emotion = this.state === 'swept' ? 'struggle' : this.safe && f < 0.4 ? 'relief' : f < 0.12 ? 'calm' : f < 0.3 ? 'confused' : f < 0.5 ? 'anxious' : f < 0.78 ? 'fear' : 'panic';
  }

  eye(out, time) {
    if (this.state === 'swept') return out.set(this.x, this.y + EYE, this.z);
    const sp = Math.hypot(this.vx, this.vz);
    const b = Math.sin(this.bob * Math.PI) * Math.min(0.06, sp * 0.012);
    return out.set(this.x, this.y + EYE + b, this.z);
  }
}
