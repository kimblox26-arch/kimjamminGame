// 사람끼리 안 겹치게(밀어내기), 사람도 벽·진열대를 통과하지 않게, 나(플레이어)도 사람을 통과 못 함.
// 부딪히면 한마디("아, 죄송합니다" / "아 뭐야!"), 깡패는 화를 내며 덤빔.
import * as THREE from 'three';
import { activeAt } from './zones.js';

const pk = a => a[Math.random() * a.length | 0];
const SORRY = [['아, 죄송합니다.', 'shy'], ['어이쿠, 미안해요.', 'calm'], ['아 뭐야, 앞 좀 보고 다녀요!', 'annoyed'], ['아씨… 깜짝이야.', 'annoyed']];
export class Crowd {
  constructor({ game, crime, peds, yawObj, colliders, mover }) { Object.assign(this, { game, crime, peds, yawObj, colliders, mover }); this.talkCool = 0; }
  people() {
    const out = [];
    for (const c of this.game.customers) out.push(c);
    for (const c of this.peds.list) out.push(c);
    for (const o of this.crime.officers) out.push(o.ref);
    for (const c of this.crime.courtPeople) out.push(c);
    for (const c of this.crime.extra || []) out.push(c);
    if (this.game.bossC && this.game.boss) out.push(this.game.bossC);
    return out;
  }
  update(dt) {
    this.talkCool -= dt;
    const L = this.people().filter(c => c?.person?.root?.parent), n = L.length, R = 0.29;
    // 사람 ↔ 사람
    for (let i = 0; i < n; i++) {
      const a = L[i], pa = a.person.root.position, fa = a.dead || a.person.down || a.person.dead;
      for (let j = i + 1; j < n; j++) {
        const b = L[j], pb = b.person.root.position; if (Math.abs(pa.y - pb.y) > 1) continue;
        const dx = pb.x - pa.x, dz = pb.z - pa.z, d2 = dx * dx + dz * dz; if (d2 > 0.36 || d2 < 1e-8) continue;
        const fb = b.dead || b.person.down || b.person.dead; if (fa && fb) continue;
        const d = Math.sqrt(d2), push = (0.6 - d) / d, wa = fa ? 0 : fb ? 1 : 0.5, wb = fb ? 0 : fa ? 1 : 0.5;
        pa.x -= dx * push * wa; pa.z -= dz * push * wa; pb.x += dx * push * wb; pb.z += dz * push * wb;
      }
    }
    // 사람 ↔ 벽·진열대 (움직이는 사람만)
    for (const c of L) {
      const P = c.person, p = P.root.position; if (c.dead || P.dead || (!P.path.length && !P.kv) || !(c.ped || c.thief) || c.officer) continue;   // 행인만 (손님·경찰은 정해진 길로 다님)
      const feet = p.y;
      for (const k of this.colliders) {
        if (p.x < k.x0 - R || p.x > k.x1 + R || p.z < k.z0 - R || p.z > k.z1 + R || !activeAt(k, feet)) continue;
        const qx = Math.max(k.x0, Math.min(p.x, k.x1)), qz = Math.max(k.z0, Math.min(p.z, k.z1)), dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz);
        if (d < R && d > 1e-4) { p.x = qx + dx / d * R; p.z = qz + dz / d * R; }
      }
    }
    // 나 ↔ 사람 (통과 못 함, 부딪히면 반응)
    if (this.mover?.enabled && !this.mover.riding) {
      const me = this.yawObj.position, feet = me.y - 1.55;
      for (const c of L) {
        const p = c.person.root.position; if (Math.abs(p.y - feet) > 1) continue;
        const dx = me.x - p.x, dz = me.z - p.z, d = Math.hypot(dx, dz); if (d > 0.58 || d < 1e-4) continue;
        const push = 0.58 - d, down = c.dead || c.person.down;
        me.x += dx / d * push * (down ? 1 : 0.75); me.z += dz / d * push * (down ? 1 : 0.75);
        if (!down) { p.x -= dx / d * push * 0.25; p.z -= dz / d * push * 0.25; }
        if (!down && !c.dead && this.mover.moving && this.talkCool < 0 && !c.officer && !c.surr && !c.begging) {
          this.talkCool = 3.5; c.person.lookAt(me);
          if (c.thug) this.crime.provoke?.(c); else if (Math.random() < 0.6) this.game.say(c, pk(SORRY));
        }
      }
    }
  }
}
