// 인트로 컷신(오전 8시 재난문자 → 창밖 → TV 뉴스) + 튜토리얼/스토리 임무
import * as THREE from 'three';
import { clamp, lerp, smooth } from './util.js';
import { BX, BZ, FH } from './apartment.js';
import { carGeo, carMaterials } from './vehicle.js';
import { ll, city } from './korea.js';

const TASKS = [
  { id: 'water', title: '물 모으기', desc: '곧 단수될 수 있다. 욕실 욕조와 주방 싱크대에 물을 받아 두자.', steps: [['water_tub', '욕실: 욕조에 물 받기 (E 길게)'], ['water_bottles', '주방: 페트병에 물 담기 (E 길게)']] },
  { id: 'food', title: '식량 확인', desc: '집에 있는 먹을 것을 전부 챙기자. 배고픔으로 죽진 않지만 기력이 떨어진다.', steps: [['food_fridge', '냉장고 뒤지기'], ['food_cupboard', '주방 찬장 뒤지기']] },
  { id: 'door', title: '현관 봉쇄', desc: '감염자가 들어오지 못하게 현관을 막자.', steps: [['door_lock', '현관문 잠그기 (E)'], ['barricade', '신발장으로 현관 막기 (E 길게)']] },
  { id: 'quiet', title: '빛과 소리 줄이기', desc: '놈들은 소리와 빛에 반응한다. 집을 조용하고 어둡게 만들자.', steps: [['tv_off', 'TV 끄기'], ['curtain_living', '거실 커튼 치기'], ['curtain_bed', '침실 커튼 치기']] },
  { id: 'kit', title: '생존 물품 챙기기', desc: '다용도실에서 비상 물품과 무기가 될 만한 것을 챙기자.', steps: [['pick_flashlight', '손전등 (F로 켜기)'], ['pick_medkit', '구급상자 (H로 치료)'], ['pick_bat', '야구방망이 (무기)']] },
  { id: 'radio', title: '정보 수집', desc: '다용도실의 라디오로 재난 방송을 듣자.', steps: [['radio', '라디오 켜기 (E 길게)'], ['radio_done', '방송 끝까지 듣기']] },
  { id: 'escape', title: '탈출', desc: '놈들이 계단을 올라오고 있다! 무기를 들고 대피소로 가자.', steps: [['equip', '무기 들기 (숫자키 3: 방망이)'], ['unbarricade', '바리케이드 치우기 (E 길게)'], ['leave', '건물 밖으로 나가기'], ['shelter', '새빛초등학교 임시대피소 도착 (나침반 참고)']] },
  { id: 'south', title: '남쪽으로', desc: '군은 수원 방면으로 철수했다. 차를 구해 남쪽으로 가자. (E: 차량 탑승)', steps: [['suwon', '수원 군 집결지 도착 (약 34km)']] },
  { id: 'busan', title: '마지막 희망', desc: '부산항에서 마지막 피난선이 출항한다. 경부고속도로를 따라 남쪽으로.', steps: [['busan', '부산항 도착 (약 325km)']] }
];

export class Story {
  constructor(game) { this.game = game; this.idx = -1; this.done = new Set(); this.ambT = 25; game.on('task', id => this.mark(id)); }
  get cur() { return TASKS[this.idx]; }
  start(i = 0) { this.idx = i - 1; this.next(); }
  next() {
    const g = this.game; this.idx++;
    const t = this.cur; if (!t) { g.ui.tasks(null); return; }
    g.ui.centerTask(this.idx === 0 ? '첫 번째 할 일' : '다음 할 일', t.title, t.desc);
    g.audio.play('ui');
    this.render(); this.onStart(t);
    if (t.steps.every(s => this.done.has(s[0]))) setTimeout(() => this.complete(), 1200);
  }
  render() { const t = this.cur; if (t) this.game.ui.tasks(t.title, t.steps.map(([id, txt]) => ({ txt, done: this.done.has(id) }))); }
  mark(id) {
    if (this.done.has(id)) return; this.done.add(id);
    const t = this.cur; if (!t) return;
    if (t.steps.some(s => s[0] === id)) { this.game.audio.play('ui'); this.render(); if (t.steps.every(s => this.done.has(s[0]))) setTimeout(() => this.complete(), 1500); }
    if (id === 'radio') this.radio();
  }
  complete() {
    const g = this.game, t = this.cur; if (!t || this._completing === t) return; this._completing = t;
    g.ui.notify(`✔ ${t.title} 완료`); g.player.hopeAdd(8); g.player.stress = Math.max(0, g.player.stress - 6);
    g.saveGame(true);
    setTimeout(() => this.next(), 2500);
  }
  onStart(t) {
    const g = this.game, P = g.player;
    if (t.id === 'escape') this.escapeEvent();
    if (t.id === 'south') { g.objective = { name: '수원 집결지', pos: new THREE.Vector3(city('수원').x, 0, city('수원').z) }; }
    if (t.id === 'busan') { const [x, z] = ll(35.10, 129.04); g.objective = { name: '부산항', pos: new THREE.Vector3(x, 0, z) }; }
    if (t.id === 'water') P.mono('hope', true);
  }
  async radio() {
    const g = this.game, v = g.voice, snd = g.audio.loop('radio', { vol: 0.6 });
    await v.lines([
      ['radio', '…치익… 여기는 재난방송입니다. 현재 서울 전역에 감염 확산이 계속되고 있습니다.'],
      ['radio', '감염자는 소리와 빛에 강하게 반응합니다. 일부 감염자는 매우 빠르게 달립니다. 절대 맞서 싸우지 마십시오.'],
      ['radio', '현재 정부와 군은 각 구별로 임시 대피소를 운영 중입니다. 종로·중구 지역 주민은 새빛초등학교 임시대피소로 이동하십시오.'],
      ['radio', '이동 시에는 큰길을 피하고, 물과 식량, 손전등을 챙기십시오. 반복합니다…'],
      ['player', '새빛초등학교… 걸어서 십 분 거리야. 거기까지만 가면…']
    ]);
    snd.stop(); this.mark('radio_done'); g.player.hopeAdd(12);
    g.objective = { name: '새빛초 대피소', pos: g.shelterPos };
  }
  escapeEvent() {
    const g = this.game, h = g.home, Y0 = h.Y0, y = 2 * FH;
    g.audio.play('doorBang', { pos: h.door.center }); g.player.fear = Math.max(g.player.fear, 60);
    setTimeout(() => g.voice.say('누가… 문을 두드리고 있어… 아니, 저건 사람이 아니야.', 'player'), 900);
    const z1 = g.zombies.spawn(BX + 11.6, Y0 + y, BZ + 10.9, { state: 'chase', noDespawn: true, runner: false });
    z1.lastSeen = g.player.pos.clone();
    for (const [x, zz, f] of [[12.7, 9.0, 1], [12, 13, 0], [11, 14, 0]]) { const z = g.zombies.spawn(BX + x, Y0 + f * FH, BZ + zz, { state: 'chase', noDespawn: true, runner: f === 0 && zz > 13 }); z.lastSeen = g.player.pos.clone(); }
    const chk = setInterval(() => {
      if (g.player.weapon !== 'fists') this.mark('equip');
      if (!h.inBuilding(g.player.pos) && g.player.pos.distanceTo(h.door.center) > 6) { this.mark('leave'); g.zombies.autoSpawn = true; }
      if (g.shelterPos && g.player.pos.distanceTo(g.shelterPos) < 40 && !this.done.has('shelter')) { clearInterval(chk); this.shelterEvent(); }
    }, 300);
  }
  async shelterEvent() {
    const g = this.game, s = g.shelterPos;
    this.mark('shelter');
    for (let k = 0; k < 7; k++) { const a = Math.random() * 6.28, d = 14 + Math.random() * 20; const z = g.zombies.spawn(s.x + Math.cos(a) * d, s.y, s.z + Math.sin(a) * d, { state: k < 3 ? 'eat' : 'idle' }); }
    await g.voice.lines([['player', '대피소가… 이미 무너졌어.'], ['player', '저기 무전기에서 소리가 나.'],
      ['soldier', '…치익… 전 부대에 알린다. 서울 방어선 붕괴. 생존 인원은 수원 공군기지 방면으로 철수하라. 반복한다, 수원으로…'],
      ['player', '수원… 걸어서는 무리야. 차가 필요해. 그리고 저 군인 총도…']]);
    const chk = setInterval(() => {
      const P = g.player.vehicle ? g.player.vehicle.pos : g.player.pos;
      const su = city('수원'); if (Math.hypot(P.x - su.x, P.z - su.z) < 500 && !this.done.has('suwon')) { this.mark('suwon'); g.voice.lines([['player', '여기도 비어 있어… 철수한 지 한참 됐나 봐.'], ['radio', '…부산항… 마지막 피난선… 생존자는 부산으로…']]); }
      const [bx, bz] = ll(35.10, 129.04); if (Math.hypot(P.x - bx, P.z - bz) < 700) { clearInterval(chk); this.mark('busan'); g.ending(); }
    }, 1000);
  }
  // 집 안에 있을 때의 앰비언스(윗집 쿵쿵, 이웃 비명)
  update(dt) {
    const g = this.game; if (!g.home.inUnit(g.player.pos)) return;
    this.ambT -= dt; if (this.ambT > 0) return; this.ambT = 25 + Math.random() * 40;
    const r = Math.random(), up = new THREE.Vector3(BX + 18, g.home.Y0 + 3 * FH + 1, BZ + 6);
    if (r < 0.35) g.audio.play('doorBang', { pos: up, vol: 0.5 }); else if (r < 0.6) g.audio.play('scream', { pos: up, female: true, vol: 0.6 }); else if (r < 0.8) g.audio.play('groan', { pos: new THREE.Vector3(BX + 12, g.home.Y0 + 3, BZ + 9), vol: 0.7 }); else g.audio.play('heliPass', { pos: new THREE.Vector3(g.player.pos.x + 80, g.player.pos.y + 60, g.player.pos.z), vol: 2, ref: 30 });
  }
  save() { return { idx: this.idx, done: [...this.done] }; }
  load(s) { this.done = new Set(s.done); this.idx = s.idx - 1; this.next(); }
}

// ---------------- 인트로 ----------------
export class Intro {
  constructor(game) { this.game = game; this.waits = []; this.tw = null; this.t = 0; this.aborted = false; this.blink = []; }
  U(x, y, z) { const h = this.game.home; return new THREE.Vector3(BX + x, h.Y0 + 2 * FH + y, BZ + z); }
  wait(s) { return new Promise(r => this.waits.push({ t: this.t + s, r })); }
  to(pos, yaw, pitch, dur, ease = true) { return new Promise(r => { const c = this.cam; this.tw = { p0: c.pos.clone(), p1: pos, y0: c.yaw, y1: yaw, q0: c.pitch, q1: pitch, t: 0, dur, r, ease }; }); }
  say(t, who = 'player', o) { return this.aborted ? Promise.resolve() : this.game.voice.say(t, who, o); }
  lids(v, dur = 0.4) { this.lid = { from: this.lidV ?? 1, to: v, t: 0, dur }; }
  async play() {
    const g = this.game, h = g.home, ui = g.ui;
    this.active = true; g.player.enabled = false; g.zombies.ignorePlayer = true; ui.setMode('cine');
    this.cam = { pos: this.U(0.75, 0.72, 10.05), yaw: -Math.PI / 2, pitch: 1.45 }; this.lidV = 1; this.blur = 8;
    h.setCurtain(h.curtBed, false, true); h.setCurtain(h.curtLiv, false, true);
    if (!this.streetDone) this.street();
    this.amb = [g.audio.loop('birds', { amb: true, vol: 0.5 }), g.audio.loop('wind', { amb: true, vol: 0.25 })];
    ui.fade(1, 0); ui.fade(0, 2.5);
    await this.wait(1.0); if (this.aborted) return;
    // 08:00 재난문자
    h.drawPhone(true); g.audio.play('alert', { pos: this.U(0.5, 0.55, 11.25), vol: 0.9, inside: true, important: true }); this.phoneBuzz = 5.5;
    this.lids(0.55, 0.5); await this.wait(0.9); this.lids(1, 0.2); await this.wait(0.3); this.lids(0.3, 0.6); this.blurTo = 4;
    await this.say('으음… 뭐야… 아침부터…', 'player', { rate: 0.85 }); if (this.aborted) return;
    this.lids(1, 0.15); await this.wait(0.25); this.lids(0, 0.5); this.blurTo = 0.5;
    await this.to(this.U(1.0, 1.05, 10.2), -Math.PI / 2, 0.15, 2.0); if (this.aborted) return;
    await this.to(this.U(1.05, 1.1, 10.4), Math.PI, -0.7, 1.4); if (this.aborted) return;
    this.holdPhone = 0.0001; await this.wait(1.2); if (this.aborted) return;
    await this.to(this.U(1.05, 1.1, 10.4), Math.PI, -0.35, 0.8);
    await this.say('긴급재난문자…? 서울 전역에서… 원인 불명의 감염 확산…?'); if (this.aborted) return;
    await this.say('물리면 감염된다고…? 이게 무슨…'); if (this.aborted) return;
    // 바깥 비명
    g.audio.play('scream', { pos: this.U(10, -6, 30), female: true, long: true, vol: 1.6, important: true });
    await this.wait(1.3); g.audio.play('crash', { pos: new THREE.Vector3(62, h.Y0, 79), vol: 1 }); this.alarm = g.audio.loop('alarm', { pos: new THREE.Vector3(62, h.Y0 + 1, 79), vol: 0.5 });
    g.player.fear = 35;
    await this.say('…방금 그거, 비명 소리야?'); if (this.aborted) return;
    this.holdPhone = -1;
    await this.to(this.U(1.5, 1.6, 10.6), Math.PI * 0.95, 0, 1.6); if (this.aborted) return;
    await this.to(this.U(2.2, 1.6, 11.25), Math.PI, 0.05, 1.4); if (this.aborted) return;
    h.setCurtain(h.curtBed, true); await this.wait(0.9); if (this.aborted) return;
    this.chaseStart();
    await this.to(this.U(2.2, 1.6, 11.35), Math.PI - 0.25, -0.38, 2.2); if (this.aborted) return;
    await this.wait(2.0); if (this.aborted) return;
    await this.to(this.U(2.2, 1.6, 11.4), Math.PI + 0.25, -0.42, 3.0); g.player.fear = 70;
    await this.say('저게… 뭐야… 사람을… 물어뜯고 있어…', 'player', { rate: 0.85 }); if (this.aborted) return;
    await this.wait(1.2); this.lookUp = true; await this.wait(1.0); if (this.aborted) return;
    await this.say('…쉿. 소리 내면 안 돼.', 'player', { vol: 0.7 }); if (this.aborted) return;
    h.setCurtain(h.curtBed, false);
    await this.to(this.U(3.0, 1.6, 9.0), 0.5, 0, 1.6); if (this.aborted) return;
    await this.to(this.U(4.0, 1.6, 7.65), -Math.PI / 2, 0, 1.4); if (this.aborted) return;
    await this.to(this.U(6.9, 1.6, 8.9), -0.05, -0.08, 2.0); if (this.aborted) return;
    h.setTV('static'); await this.wait(0.8); h.setTV('news'); g.audio.play('jingle', { pos: this.U(7, 1, 5.2), inside: true }); await this.wait(1.2); if (this.aborted) return;
    this.tvPush = true;
    for (const [w, l] of [['anchor', '속보입니다. 오늘 오전 7시경부터 서울 전역에서, 원인을 알 수 없는 감염 증상을 보이는 사람들이 시민들을 공격하는 사태가 잇따르고 있습니다.'],
      ['anchor', '감염자들은 극도로 공격적이며, 물리거나 긁힌 사람은 수 분 안에 같은 증상을 보이는 것으로 알려졌습니다.'],
      ['anchor', '정부는 위기경보를 최고 단계인 심각으로 격상하고, 시민들에게 외출을 자제하고 문을 잠근 채 실내에 머물 것을 당부했습니다.'],
      ['anchor', '곧 단수와 정전이 예상되니, 물과 식량을 미리 확보해 주시기 바랍니다. 현장 연결합니다.'],
      ['reporter', '네, 이곳 종로 일대는 지금… 아, 저쪽에서 사람들이… 피하세요! 카메라 돌려! 빨리!']]) { await this.say(l, w); if (this.aborted) return; }
    h.setTV('static'); g.audio.play('scream', { pos: this.U(7, 1, 5.2), female: false, inside: true });
    await this.wait(1.5); if (this.aborted) return;
    await this.say('말도 안 돼… 진짜야, 이거.'); if (this.aborted) return;
    await this.say('정신 차려. 일단… 살아남아야 해. 물부터 받아 두자. 곧 끊길지도 몰라.'); if (this.aborted) return;
    this.finish();
  }
  street() {
    const g = this.game, h = g.home, y = h.Y0, Z = g.zombies;
    // 경찰차(경광등) & 사고 차량(화재·경보)
    const M = carMaterials(), G = carGeo(true);
    const pol = new THREE.Group(), body = new THREE.Mesh(G.body, M.paint.clone()); body.material.color.set(0xf4f4f4); pol.add(body, new THREE.Mesh(G.detail, M.detail));
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1010, emissiveIntensity: 0 })), blue = red.clone(); blue.material = new THREE.MeshStandardMaterial({ color: 0x000030, emissive: 0x1030ff, emissiveIntensity: 0 });
    red.position.set(0.3, 1.5, -0.2); blue.position.set(-0.3, 1.5, -0.2); pol.add(red, blue); pol.position.set(24, y - 0.1, 80.5); pol.rotation.y = 1.9; pol.traverse(o => o.castShadow = true); g.scene.add(pol);
    g.col.box(21.5, y, 78, 26.5, y + 1.5, 83, 'home');
    g.blinkers.push(t => { const k = (t * 3) % 1 < 0.5; red.material.emissiveIntensity = k ? 4 : 0; blue.material.emissiveIntensity = k ? 0 : 4; });
    this.siren = g.audio.loop('siren', { pos: new THREE.Vector3(24, y + 1.5, 80.5), vol: 0.35, hilo: false });
    g.items.spawn([{ id: 'police_pistol', type: 'pistol', x: 26.2, y: y + 0.02, z: 82.4 }, { id: 'police_ammo', type: 'pistolAmmo', x: 26.8, y: y + 0.02, z: 82.0 }], 'home');
    const crash = new THREE.Group(); const cb = new THREE.Mesh(G.body, M.paint.clone()); cb.material.color.set(0x23324a); crash.add(cb, new THREE.Mesh(G.detail, M.detail)); crash.position.set(62, y - 0.1, 79); crash.rotation.set(0, 0.6, 0.05); g.scene.add(crash);
    g.col.box(59.5, y, 76.5, 64.5, y + 1.5, 81.5, 'home');
    g.fx.addFire(new THREE.Vector3(63.5, y + 0.3, 80.2), 'home', false);
    // 도로 위 섭식 좀비 + 배회
    if (g.world.corpseG) { const m = new THREE.Mesh(g.world.corpseG[1], g.world.mats.corpse); m.position.set(47.5, y + 0.05, 74.2); m.rotation.y = 2.2; g.scene.add(m); }
    this.eater = Z.spawn(46.8, y, 73.4, { state: 'eat', yaw: 0.7, noDespawn: true });
    Z.spawn(70, y, 82, { state: 'idle', noDespawn: true }); Z.spawn(15, y, 79, { state: 'wander', noDespawn: true });
  }
  chaseStart() {
    const g = this.game, y = g.home.Y0, Z = g.zombies;
    const path = [new THREE.Vector3(80, y, 80.5), new THREE.Vector3(60, y, 81.5), new THREE.Vector3(44, y, 80.5), new THREE.Vector3(30, y, 79.5), new THREE.Vector3(10, y, 80)];
    this.civ = Z.civ(98, y, 80.2, 4, path);
    this.chasers = [Z.spawn(106, y, 80.5, { runner: true, noDespawn: true }), Z.spawn(112, y, 79.5, { runner: true, noDespawn: true })];
    this.chasers.forEach(z => { z.forceTarget = this.civ; z.chaseV = 6.4; });
    this.civ.speed = 5.0;
  }
  update(dt) {
    if (!this.active) return;
    this.t += dt; const g = this.game, cam = g.camera, h = g.home;
    this.waits = this.waits.filter(w => { if (this.t >= w.t) { w.r(); return false; } return true; });
    if (this.tw) { const w = this.tw; w.t += dt; const k = clamp(w.t / w.dur, 0, 1), e = w.ease ? smooth(0, 1, k) : k; const c = this.cam; c.pos.lerpVectors(w.p0, w.p1, e); c.yaw = lerp(w.y0, w.y1, e); c.pitch = lerp(w.q0, w.q1, e); if (k >= 1) { this.tw = null; w.r(); } }
    // 눈꺼풀/흐림
    if (this.lid) { const l = this.lid; l.t += dt; this.lidV = lerp(l.from, l.to, clamp(l.t / l.dur, 0, 1)); }
    this.blur += ((this.blurTo ?? this.blur) - this.blur) * Math.min(1, dt * 1.5);
    g.ui.eyes(this.lidV, this.blur);
    const c = this.cam, tt = this.t, hand = 0.004;
    cam.position.copy(c.pos).add(new THREE.Vector3(Math.sin(tt * 1.7) * hand, Math.sin(tt * 2.3) * hand, Math.cos(tt * 1.3) * hand));
    cam.rotation.set(c.pitch + Math.sin(tt * 0.9) * 0.006, c.yaw + Math.sin(tt * 0.7) * 0.008, 0, 'YXZ');
    // 폰 진동/손에 들기
    const ph = h.phone;
    if (this.phoneBuzz > 0) { this.phoneBuzz -= dt; if (this.holdPhone === undefined) ph.rotation.z = Math.sin(tt * 90) * 0.04; }
    if (this.holdPhone !== undefined && this.holdPhone >= 0) {
      this.holdPhone = Math.min(1, this.holdPhone + dt * 1.2);
      const target = new THREE.Vector3(0.0, -0.035, -0.24).applyQuaternion(cam.quaternion).add(cam.position);
      const wp = h.group.localToWorld(h.phoneRest.p.clone());
      const p = wp.lerp(target, smooth(0, 1, this.holdPhone)); ph.position.copy(h.group.worldToLocal(p));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, 0)); const camQ = cam.quaternion.clone().multiply(q);
      const restQ = new THREE.Quaternion().setFromEuler(h.phoneRest.r); ph.quaternion.slerpQuaternions(restQ, camQ, smooth(0, 1, this.holdPhone));
    } else if (this.holdPhone === -1) { ph.visible = false; }
    // 섭식 좀비가 창문 쪽을 올려다봄
    if (this.lookUp && this.eater && !this.eater.dead) { const b = this.eater.h.b; b.neck.rotation.x = -0.6; b.head.rotation.x = -0.4; }
    // 추격 장면
    if (this.civ && !this.civ.dead) {
      for (const z of this.chasers) if (z.pos.distanceTo(this.civ.pos) < 1.3) {
        this.civ.kill(45); this.chasers.forEach(q => { q.forceTarget = null; q.state = 'eat'; q.h.st.mode = 'eat'; q.stateT = 4; q.yaw = Math.atan2(this.civ.pos.x - q.pos.x, this.civ.pos.z - q.pos.z); });
        g.audio.play('zattack', { pos: this.civ.pos }); break;
      }
      if (!this.civ.path.length && !this.civ.dead) this.civ.kill(45);
    }
    g.audio.listen(cam);
  }
  skip() { if (!this.active) return; this.aborted = true; this.game.voice.stop(); this.waits.forEach(w => w.r()); this.waits = []; if (this.tw) { const r = this.tw.r; this.tw = null; r(); } this.finish(true); }
  finish(skipped) {
    if (this.done) return; this.done = true;
    const g = this.game, h = g.home, ui = g.ui;
    if (!this.civ) this.chaseStart();
    if (this.civ && !this.civ.dead) { this.civ.pos.set(42, h.Y0, 80); this.civ.kill(40); this.chasers.forEach(q => { q.forceTarget = null; q.state = 'eat'; q.h.st.mode = 'eat'; q.pos.set(42 + Math.random() * 1.5, h.Y0, 79 + Math.random()); }); }
    h.phone.visible = false; if (h.tvState === 'off') h.setTV('static');
    this.amb.forEach(a => a.stop(3));
    ui.fade(1, 0.6);
    setTimeout(() => {
      this.active = false; g.zombies.ignorePlayer = false; ui.eyes(0, 0);
      const P = g.player; P.pos.copy(this.U(6.9, 0, 8.9)); P.yaw = 0.3; P.pitch = -0.05; P.c.vel.set(0, 0, 0); P.eyeSmooth = 0;
      P.enabled = true; ui.setMode('play'); ui.fade(0, 1.2);
      g.story.start(0); g.requestLock();
    }, skipped ? 700 : 900);
  }
}
