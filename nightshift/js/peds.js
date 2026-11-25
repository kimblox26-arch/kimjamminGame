// 거리·지하상가 행인: 보도를 따라 걷고, 휴대폰 보거나 통화하고, 멈춰 서기도 함.
// 총소리 → 멈칫하며 소리 난 쪽 보기 → 비명 지르며 도망 / 웅크리고 머리 감싸기 / 112 신고 전화
// 쓰러진 사람 발견 → 입 막고 뒷걸음질 → 신고
import * as THREE from 'three';
import { Person } from './people.js';
import { TYPES } from './data.js';
import { ROADS } from './city.js';
import { UNDER } from './underpass.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z), pk = a => a[Math.random() * a.length | 0];
const CALL = [['여보세요, 경찰이죠? 여기 총소리가 났어요!', 'scared'], ['112죠? 사람이 총에 맞았어요! 빨리 와 주세요!', 'scared'], ['여기 달빛대로 편의점 근처인데요, 총 든 사람이 있어요!', 'scared']];
const BODY = [['헉… 사, 사람이 쓰러져 있어…!', 'scared'], ['꺄악! 피… 피야!', 'scared'], ['저기요! 괜찮으세요? 저기요!', 'scared']];
const CHAT = [['응, 나 지금 집 가는 중이야.', 'calm'], ['아 진짜? 대박이다 ㅋㅋ', 'happy'], ['내일 아침에 전화할게. 응, 끊어.', 'tired'], ['엄마, 나 거의 다 왔어.', 'calm'], ['야근 끝났어… 너무 피곤하다.', 'tired']];

function sidewalks() {
  const { X0, X1, Z0, Z1, EW, NS } = ROADS, W2 = 4, out = [];
  const cut = (a, b, ex) => { let parts = [[a, b]]; for (const [e0, e1] of ex) parts = parts.flatMap(([p, q]) => e1 <= p || e0 >= q ? [[p, q]] : [[p, e0], [e1, q]]); return parts.filter(([p, q]) => q - p > 12); };
  const xb = [X0, ...NS.flatMap(c => [c - W2 - 1.6, c + W2 + 1.6]), X1];
  for (const r of EW) for (const z of [r.z0 - 1.1, r.z1 + 1.1]) for (let i = 0; i < xb.length; i += 2) {
    const ex = r === ROADS.main ? [[-9, 9], [23.5, 35.8]] : [];
    for (const [a, b] of cut(xb[i] + 1, xb[i + 1] - 1, ex)) out.push({ axis: 'x', c: z, a, b, y: 0 });
  }
  const zb = [Z0, ...EW.flatMap(r => [r.z0 - 1.6, r.z1 + 1.6]), Z1];
  for (const cx of NS) for (const x of [cx - W2 - 1.1, cx + W2 + 1.1]) for (let i = 0; i < zb.length; i += 2) if (zb[i + 1] - zb[i] > 14) out.push({ axis: 'z', c: x, a: zb[i] + 1, b: zb[i + 1] - 1, y: 0 });
  const H = UNDER.hall; for (const z of [5.4, 11.4, 15.7]) out.push({ axis: 'x', c: z, a: H.x0 + 1.5, b: H.x1 - 2, y: UNDER.y, ug: true });
  return out;
}

export class Pedestrians {
  constructor({ scene, audio, game, crime, yawObj, camera }) {
    Object.assign(this, { scene, audio, game, crime, yawObj, camera });
    this.segs = sidewalks(); this.list = []; this.t = 0; this.chatCool = 8; this.callCool = 0;
    this.types = TYPES.filter(t => !t.trouble);
  }
  pt(seg, s) { return seg.axis === 'x' ? V3(s, seg.y, seg.c) : V3(seg.c, seg.y, s); }
  along(seg, p) { return seg.axis === 'x' ? p.x : p.z; }
  spawn(ug) {
    const me = this.yawObj.position, near = this.segs.filter(s => !!s.ug === ug && this.dist(s, me) < 55);
    if (!near.length) return;
    const seg = pk(near), m = this.along(seg, me);
    let s = Math.max(seg.a, Math.min(seg.b, m + (Math.random() < 0.5 ? -1 : 1) * (ug ? 6 + Math.random() * 18 : 14 + Math.random() * 30)));
    const thug = Math.random() < 0.12, type = thug ? { id: 'thug', name: '동네 깡패', model: 'man', h: 1.8, top: '#121212', bottom: '#1a1a1a', hat: Math.random() < 0.5 ? 'cap' : null, voice: [0.85, 1.05] } : { ...pk(this.types) }, P = new Person(type, this.audio);
    P.root.position.copy(this.pt(seg, s)); P.speed = 0.95 + Math.random() * 0.45; this.scene.add(P.root);
    const c = { type, person: P, voice: type.voice, gender: type.model === 'woman' ? 'f' : 'm', vIdx: Math.random() * 6 | 0, mood: 50, ped: true, seg, ug, state: 'walk', wait: 0, thug, armed: thug && Math.random() < 0.3 };
    if (thug && Math.random() < 0.15) setTimeout(() => { if (!c.dead && c.person.root.position.distanceTo(this.yawObj.position) < 12) this.crime.provoke(c); }, 4000);
    const r = Math.random(); if (r < 0.22) { P.PT.phone = 1; P.keepPhone = true; } else if (r < 0.32) { P.PT.call = 1; c.caller = true; }
    P.fidget = !P.keepPhone && !c.caller; this.next(c); this.list.push(c);
  }
  dist(seg, p) { const s = Math.max(seg.a, Math.min(seg.b, this.along(seg, p))), q = this.pt(seg, s); return Math.hypot(q.x - p.x, q.z - p.z) + Math.abs((seg.y || 0) - (p.y - 1.55)) * 3; }
  next(c, away) {
    const seg = c.seg, cur = this.along(seg, c.person.root.position);
    let s = away ? cur + away : seg.a + Math.random() * (seg.b - seg.a);
    if (!away && Math.abs(s - cur) < 10) s = cur + (s > cur ? 10 : -10);
    s = Math.max(seg.a, Math.min(seg.b, s));
    c.person.walk([this.pt(seg, s)]).then(() => { if (c.dead || c.down) return; if (c.state === 'flee') { c.state = 'hide'; c.person.PT.cover = 1; c.person.PT.kneel = 0.6; return; } c.wait = 1 + Math.random() * 4; });
  }
  // 차에서 끌려 나온 운전자 등: 그 자리에서 도망
  addFleeing(pos, from) {
    const type = { ...pk(this.types) }, P = new Person(type, this.audio); P.root.position.copy(pos).setY(0); this.scene.add(P.root);
    const me = this.yawObj.position, seg = this.segs.filter(s => !s.ug).sort((a, b) => this.dist(a, pos) - this.dist(b, pos))[0];
    const c = { type, person: P, voice: type.voice, gender: type.model === 'woman' ? 'f' : 'm', vIdx: Math.random() * 6 | 0, mood: 0, ped: true, seg, ug: false, state: 'flee', from: from || me.clone() };
    this.list.push(c); P.speed = 4; const away = pos.clone().sub(c.from).setY(0).normalize(); P.walk([pos.clone().addScaledVector(away, 25).setY(0)]); this.crime.vox(c, 'scream', 0.2);
    return c;
  }
  remove(c) { c.person.dispose(); this.list.splice(this.list.indexOf(c), 1); }
  // 총소리 들림
  gunshot(from) {
    const g = this.game;
    for (const c of this.list) {
      if (c.dead || c.down || c.aggro) continue; const d = c.person.root.position.distanceTo(from); if (d > 55 || c.state === 'flee' || c.state === 'cower') continue;
      if (c.thug && d < 30 && Math.random() < (c.armed ? 0.8 : 0.4)) { this.crime.provoke(c); continue; }
      const P = c.person; c.state = 'startle'; c.alertT = 0.35 + Math.random() * 0.5; c.from = from.clone(); P.pause(true); P.lookAt(from); P.PT.phone = 0; P.PT.call = 0; P.keepPhone = false; P.fidget = false;
      P.fl.push({ zone: 'chest', side: 'R', t: 0, T: 0.25, axis: V3(0, 1, 0).cross(P.root.position.clone().sub(from).setY(0).normalize()).normalize(), amp: 0.5 });
      if (d < 30 && Math.random() < 0.7) this.crime.vox(c, 'scream', Math.random() * 0.4);
      const r = Math.random(); c.plan = d < 18 && r < 0.3 ? 'cower' : r < 0.82 ? 'flee' : 'call';
      void g;
    }
  }
  flee(c) {
    const P = c.person; c.state = 'flee'; P.pause(false); P.PT.cover = 0; P.PT.kneel = 0; P.PT.call = 0; P.speed = 3.8 + Math.random() * 1.2;
    const dir = Math.sign(this.along(c.seg, P.root.position) - this.along(c.seg, c.from || this.yawObj.position)) || 1;
    this.next(c, dir * (35 + Math.random() * 25));
  }
  update(dt, active) {
    const me = this.yawObj.position, ug = me.y - 1.55 < -1.5 && Math.abs(me.z) < 40, cam = this.camera.getWorldPosition(V3());
    this.chatCool -= dt; this.callCool -= dt;
    // 인원 유지 (지상 10명 / 지하 6명), 멀어지면 사라짐
    if (active && (this.t -= dt) < 0) {
      this.t = 0.6;
      for (const c of [...this.list]) if (!c.dead && (c.ug !== ug || c.person.root.position.distanceTo(me) > 80)) this.remove(c);
      for (const c of [...this.list]) if (c.dead && c.person.root.position.distanceTo(me) > 90) this.remove(c);
      if (this.list.filter(c => !c.dead).length < (ug ? 6 : 10)) this.spawn(ug);
    }
    const dead = [...this.list.filter(c => c.dead), ...this.game.customers.filter(c => c.dead), ...this.crime.officers.filter(o => o.dead).map(o => o.ref)];
    for (const c of this.list) {
      const P = c.person; P.update(dt, cam); if (c.dead || c.down) continue;
      if (c.aggro) { this.crime.fight(c, dt); continue; }
      if (c.state === 'walk' && c.wait > 0 && (c.wait -= dt) <= 0) this.next(c);
      if (c.state === 'walk' && c.caller && this.chatCool < 0 && P.root.position.distanceTo(me) < 9) { this.chatCool = 14; this.game.say(c, pk(CHAT)); }
      // 쓰러진 사람 발견
      if ((c.state === 'walk') && dead.length) for (const d of dead) if (d.person.root.position.distanceTo(P.root.position) < 7) {
        c.state = 'shock'; c.alertT = 2.6; P.pause(true); P.lookAt(d.person.root.position); P.PT.mouth = 1; P.PT.phone = 0; P.keepPhone = false; c.from = d.person.root.position.clone();
        this.crime.vox(c, Math.random() < 0.5 ? 'scream' : 'breath'); this.game.say(c, pk(BODY)); c.plan = 'call'; break;
      }
      if (c.state === 'startle' || c.state === 'shock') {
        if ((c.alertT -= dt) > 0) continue;
        P.PT.mouth = 0;
        if (c.plan === 'cower') { c.state = 'cower'; c.cowerT = 4 + Math.random() * 5; P.PT.kneel = 1; P.PT.cover = 1; P.PT.hunch = 0.6; }
        else if (c.plan === 'call') { c.state = 'calling'; c.callT = 4.5; P.PT.call = 1; if (this.callCool < 0) { this.callCool = 6; this.game.say(c, pk(CALL)); } this.crime.report?.(); }
        else this.flee(c);
      } else if (c.state === 'cower') { if ((c.cowerT -= dt) < 0) { P.PT.hunch = 0; this.flee(c); } }
      else if (c.state === 'calling') { if ((c.callT -= dt) < 0) this.flee(c); }
    }
  }
  clear() { for (const c of [...this.list]) this.remove(c); }
}
