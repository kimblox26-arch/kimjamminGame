// 폭력 → 경찰 출동 → 체포 → 법정 선고(사형/무기징역/징역) → 게임 오버
import * as THREE from 'three';
import { Person } from './people.js';
import { COURT, PRISON } from './places.js';
import { $, toast, modal, show, subtitle, ic } from './ui.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const POLICE = { id: 'police', name: '경찰관', model: 'man', h: 1.8, top: '#1b2a49', bottom: '#1b2a49', hat: 'police', voice: [0.95, 1.05] };
const JUDGE = { id: 'judge', name: '재판장', model: 'man', h: 1.75, top: '#111111', bottom: '#111111', glasses: true, voice: [0.9, 0.95] };
const PAIN = [['아악!', 'angry'], ['뭐, 뭐하는 거예요!', 'angry'], ['으악! 살려 주세요!', 'angry'], ['미쳤어요?!', 'angry']];

export class Crime {
  constructor(app) { Object.assign(this, app); this.reset(); }
  reset() { this.assaults = 0; this.kills = 0; this.police = null; this.called = false; this.arrested = false; this.officers = []; this.weapon = 'fist'; this.gunMesh = null; }
  get hasGun() { try { return localStorage.getItem('ns_gun') === '1'; } catch (e) { return false; } }
  // 권총 모양 (손에 쥐는 것)
  makeGun() {
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.35, metalness: 0.75 });
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.19), m); slide.position.set(0, 0.03, -0.06); g.add(slide);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.045), m); grip.position.set(0, -0.025, 0.01); grip.rotation.x = 0.25; g.add(grip);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false })); flash.position.set(0, 0.03, -0.17); flash.visible = false; g.add(flash);
    const light = new THREE.PointLight(0xffb050, 0, 6); light.position.copy(flash.position); g.add(light);
    g.userData = { flash, light }; return g;
  }
  setWeapon(w) {
    if (w === 'gun' && !this.hasGun) return toast('총이 없어요. 창고 상점에서 살 수 있어요');
    this.weapon = w;
    if (w === 'gun') { this.gunMesh ||= this.makeGun(); this.hands.hold('R', this.gunMesh); this.hands.raise('R', V3(0.17, -0.2, -0.42), 'grip'); }
    else { this.hands.hold('R', null); this.hands.rest('R'); }
    $('bWpn').querySelector('b').textContent = w === 'gun' ? '권총' : '주먹';
  }
  // 공격: c = 손님(또는 사장님) 정보
  async attack(c) {
    const g = this.game; if (this.arrested || !c || c.dead) return;
    const head = c.person.head?.getWorldPosition(V3()) || c.person.root.position.clone().add(V3(0, 1.6, 0));
    const dist = head.distanceTo(this.camera.getWorldPosition(V3()));
    if (this.weapon === 'gun') {
      const G = this.gunMesh.userData; this.audio.play('gun', { pos: head, vol: 1.6 }); G.flash.visible = true; G.light.intensity = 30;
      setTimeout(() => { G.flash.visible = false; G.light.intensity = 0; }, 70);
      this.look.pitch += 0.05; this.hit(c, 100);
    } else {
      if (dist > 2.2) return toast('너무 멀어요. 가까이 가서 때리세요');
      this.hands.pose('R', 'fist'); await this.hands.reachTo('R', head.clone().add(V3(0, -0.15, 0)), 'fist', 'front', 140);
      this.audio.play('punch', { pos: head, vol: 1.2, rate: 1.1 + Math.random() * 0.2 }); this.hit(c, 34);
      setTimeout(() => { this.hands.pose('R', 'relax'); this.hands.rest('R'); }, 160);
    }
  }
  hit(c, dmg) {
    const g = this.game;
    c.hp = (c.hp ?? 100) - dmg; this.assaults++;
    if (c.hp <= 0) { this.kill(c); }
    else { c.person.hurt(); g.say(c, PAIN[Math.random() * PAIN.length | 0]); c.mood = 0; }
    // 다른 손님은 도망
    for (const o of g.customers) if (o !== c && !o.dead && !o.fleeing) { o.fleeing = true; o.person.speed = 2.6; o.done = true; if (g.cur === o) g.cur = null; g.say(o, [['꺄악!', 'angry'], ['사, 사람 살려!', 'angry'], ['경찰 불러요!', 'angry']][Math.random() * 3 | 0]); if (!o.gone) g.leave(o); }
    g.violence = true; this.callPolice();
  }
  kill(c) {
    const g = this.game; this.kills++; c.dead = true; c.done = true; c.gone = true;
    if (g.cur === c) { g.cur = null; show('cust', false); }
    const qi = g.queue.indexOf(c); if (qi >= 0) g.queue.splice(qi, 1);
    c.person.die(); this.audio.play('thud', { pos: c.person.root.position, vol: 1.2, rate: 0.6 });
    if (c === g.bossC) g.bossDead = true;
  }
  // 경찰차가 사이렌 울리며 와서 경찰관 2명이 쫓아옴
  callPolice() {
    if (this.called) return; this.called = true;
    setTimeout(() => toast(ic('siren') + '누군가 112에 신고했습니다!', 'bad', 2500), 1200);
    setTimeout(() => this.policeArrive(), 9000);
  }
  async policeArrive() {
    if (this.arrested || !this.game.running) return;
    const car = this.vehicles.car.clone(true); car.visible = true;
    car.traverse(o => { if (o.isMesh && o.material === this.vehicles.car.userData.paint) { o.material = o.material.clone(); o.material.color.setHex(0xf2f2f2); } if (o.isSpotLight) o.visible = false; });
    const red = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }), blue = new THREE.MeshBasicMaterial({ color: 0x2060ff, toneMapped: false });
    const bar = new THREE.Group(); bar.position.set(0, this.vehicles.car.userData.size.y + 0.08, 0); car.add(bar);
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.2), red), l2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.2), blue); l1.position.x = -0.27; l2.position.x = 0.27; bar.add(l1, l2);
    const pl = new THREE.PointLight(0xff2020, 8, 14); pl.position.y = 0.3; bar.add(pl);
    car.rotation.y = Math.PI / 2; car.position.set(-90, 0, 8.6); this.scene.add(car);
    const siren = this.audio.siren(() => car.position);
    const P = { car, siren, t: 0, l1, l2, pl, phase: 'drive' }; this.police = P;
    toast(ic('police') + '경찰이 출동했습니다', 'bad', 2200);
  }
  update(dt) {
    const P = this.police; if (!P) return;
    P.t += dt; const blink = Math.floor(P.t * 6) % 2;
    P.l1.visible = !!blink; P.l2.visible = !blink; P.pl.color.setHex(blink ? 0xff2020 : 0x2060ff);
    if (P.phase === 'drive') {
      const d = 1.1 - P.car.position.x, v = Math.min(16, Math.max(2, d * 0.8));
      P.car.position.x += Math.sign(d) * Math.min(Math.abs(d), v * dt);
      if (Math.abs(d) < 0.05) { P.phase = 'out'; this.officersOut(); }
    }
    if (P.phase === 'chase' && !this.arrested) {
      const me = this.yawObj.position;
      for (const o of this.officers) {
        if (!o.path.length) o.walk([V3(me.x, 0, me.z)]);
        else o.path[o.path.length - 1].set(me.x, 0, me.z);
        if (o.root.position.distanceTo(V3(me.x, 0, me.z)) < 1.4) { this.arrest(); break; }
      }
    }
    for (const o of this.officers) o.update(dt, this.camera.getWorldPosition(V3()));
  }
  async officersOut() {
    const g = this.game, P = this.police;
    for (let i = 0; i < 2; i++) {
      const o = new Person(POLICE, this.audio); o.root.position.set(0.2 + i * 1.6, 0, 7.2); o.speed = 3.4; this.scene.add(o.root); this.officers.push(o);
      o.walk([V3(1.1, 0, 5.6), V3(1.1, 0, 5.2), V3(1.1, 0, 3.3)]);
    }
    this.audio.play('door', { pos: P.car.position, vol: 0.8, rate: 0.7 });
    g.openDoor(); setTimeout(() => g.openDoor(), 1500);
    const oc = { type: POLICE, person: this.officers[0], voice: POLICE.voice, gender: 'm', vIdx: 4, mood: 50 };
    g.say(oc, ['경찰입니다! 꼼짝 마!', 'angry']);
    setTimeout(() => { P.phase = 'chase'; }, 2200);
  }
  async arrest() {
    if (this.arrested) return; this.arrested = true;
    const g = this.game, oc = { type: POLICE, person: this.officers[0], voice: POLICE.voice, gender: 'm', vIdx: 4, mood: 50 };
    this.mover.enabled = false; g.running = false;
    this.hands.hold('R', null); this.hands.raise('R', V3(0.25, 0.05, -0.38), 'open'); this.hands.raise('L', V3(-0.25, 0.05, -0.38), 'open');
    await g.say(oc, ['손 들어! 당신을 살인 혐의로 체포합니다.'.replace('살인', this.kills ? '살인' : '폭행'), 'angry']);
    this.audio.play('key', { vol: 1, rate: 0.5 }); this.audio.play('thud', { vol: 0.6, rate: 2.5 });
    await g.say(oc, ['당신은 변호인을 선임할 수 있고, 진술을 거부할 수 있습니다.', 'calm']);
    this.police?.siren.stop();
    $('fade').classList.add('on');
    setTimeout(() => this.court(), 1600);
  }
  async court() {
    const g = this.game;
    show('hud', false); ['cust', 'idcard'].forEach(id => show(id, false));
    for (const s of ['R', 'L']) { this.hands.hold(s, null); this.hands.rest(s); }
    this.hands.enabled = false; this.hands.body.visible = false;
    this.yawObj.position.copy(COURT).add(V3(0, 1.6, -1.4)); this.look.yaw = 0; this.look.pitch = 0.08; this.look.target = null; this.look.frozen = true;
    const judge = new Person(JUDGE, this.audio); judge.root.position.copy(COURT).add(V3(0, 0.9, -6.15)); this.scene.add(judge.root); this.judge = judge;
    const jc = { type: JUDGE, person: judge, voice: JUDGE.voice, gender: 'm', vIdx: 2, mood: 50 };
    const upd = setInterval(() => judge.update(0.05, this.camera.getWorldPosition(V3())), 50);
    $('fade').classList.remove('on');
    await new Promise(r => setTimeout(r, 1200));
    const gavel = () => { for (let i = 0; i < 3; i++) this.audio.play('thud', { vol: 1.4, rate: 0.75, delay: i * 0.45 }); };
    gavel(); await new Promise(r => setTimeout(r, 1500));
    await g.say(jc, ['지금부터 2026고합 제1024호 사건의 판결을 선고하겠습니다.', 'calm']);
    const crime = this.kills ? `편의점 근무 중 손님 ${this.kills}명을 살해하였습니다` : `편의점 근무 중 손님을 ${this.assaults}회 폭행하였습니다`;
    await g.say(jc, [`피고인 ${g.name}은, ${crime}. 그 죄질이 매우 무겁고 반성의 기미가 보이지 않습니다.`, 'calm']);
    const death = this.kills >= 2 || (this.kills === 1 && Math.random() < 0.5);
    const years = 1 + Math.min(9, Math.ceil(this.assaults / 2));
    const verdict = death ? '사형' : this.kills ? '무기징역' : `징역 ${years}년`;
    await g.say(jc, [`따라서 피고인을 ${verdict}에 처한다.`, 'angry']);
    gavel(); await new Promise(r => setTimeout(r, 1800));
    clearInterval(upd);
    $('fade').classList.add('on');
    setTimeout(() => {
      if (!death) { this.yawObj.position.copy(PRISON).add(V3(0, 1.6, -0.6)); this.look.yaw = Math.PI; this.look.pitch = -0.05; this.audio.play('door', { vol: 1, rate: 0.5 }); this.audio.play('thud', { vol: 1, rate: 0.5 }); }
      $('fade').classList.remove('on');
      try { localStorage.removeItem('ns_save'); } catch (e) { }
      setTimeout(() => modal(`<h2>${death ? '사형 선고' : '교도소 수감'}</h2><div class="grade" style="color:#ff6b7a">GAME OVER</div><p>${death ? '법원은 피고인에게 사형을 선고했습니다.' : `${verdict} — 이제 편의점 대신 교도소에서 밤을 보냅니다.`}</p><p style="color:#8a97a6;font-size:13px">폭력은 게임 속에서도 큰 대가를 치릅니다. 다시 성실한 알바생으로 시작해 볼까요?</p>`,
        [['메인으로', 'gray', () => this.onExit()], ['처음부터', 'blue', () => this.onRestart()]]), death ? 600 : 2200);
    }, 1500);
  }
  cleanup() {
    this.police?.siren.stop(); this.police?.car.removeFromParent(); this.police = null;
    for (const o of this.officers) o.dispose(); this.officers = []; this.judge?.dispose(); this.judge = null;
    this.look.frozen = false; this.hands.enabled = true; this.reset();
  }
}
