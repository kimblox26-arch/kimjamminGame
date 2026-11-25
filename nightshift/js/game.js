// 게임 진행: 손님 흐름, 화면 가운데 점으로 바코드 찍기·계산하기(자동 결제 + 손·돈통 애니메이션), 진상, 사장님, 음성 대화
import * as THREE from 'three';
import { PRODUCTS, CIGS, TYPES, INTENTS, L, TROUBLE, BOSS, ME, wonKo } from './data.js';
import { SPOT } from './store.js';
import { productMesh, cigMesh } from './products.js';
import { drawPos, billMesh, coinMesh } from './counter.js';
import { Person } from './people.js';
import { $, won, subtitle, mine, toast, hint, show, modal, stars, ic } from './ui.js';

const pick = a => a[Math.floor(Math.random() * a.length)];
let parcelM = null; const PARCEL = () => parcelM ||= (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 192; const g = c.getContext('2d'); g.fillStyle = '#b98d5a'; g.fillRect(0, 0, 256, 192); g.fillStyle = '#e8e4d8'; g.fillRect(70, 20, 150, 110); g.fillStyle = '#222'; g.font = '700 16px sans-serif'; g.fillText('편의점택배', 84, 46); g.fillRect(84, 60, 120, 28); g.fillStyle = 'rgba(255,255,255,.85)'; for (let x = 86; x < 202; x += 4) g.fillRect(x, 62, Math.random() < 0.5 ? 1 : 2, 24); g.fillStyle = '#c9b07a'; g.fillRect(0, 86, 256, 18); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }); })();
const rnd = (a, b) => a + Math.random() * (b - a);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const WAGE = 10320, SHIFT_SEC = 13 * 60, DENOMS = [50000, 10000, 5000, 1000, 500, 100, 50, 10];
const BOSS_TYPE = { id: 'boss', name: '사장님', model: 'man', h: 1.73, top: '#6b5a48', bottom: '#2c2c30', glasses: true, voice: [0.95, 1.0] };
// 감정 → 목소리 높이·빠르기
const EMO = { sad: [1.1, 1.06], scared: [1.12, 1.18], calm: [1, 1], happy: [1.05, 1.04], annoyed: [0.98, 1.08], angry: [0.95, 1.14], shy: [1.04, 0.92], drunk: [0.93, 0.8], tired: [0.97, 0.93] };
const SCAN_AT = V3(2.66, 1.12, 0.95), GIVE_AT = V3(2.42, 1.04, 0.78), BAG_AT = V3(2.56, 0.95, 1.5);

function route(from, to) {
  if (from.x > -0.5 && to.x > -0.5) return [to];
  const pts = [V3(from.x, 0, SPOT.frontZ), V3(to.x, 0, SPOT.frontZ), to];
  return pts.filter((p, i) => i === pts.length - 1 || p.distanceTo(i ? pts[i - 1] : from) > 0.05);
}
const change = (n) => { const out = []; for (const d of DENOMS) while (n >= d) { out.push(d); n -= d; } return out; };

export class Game {
  constructor(app) {
    Object.assign(this, app);
    this.timers = []; this.tweens = []; this.customers = []; this.items = []; this.cash = []; this.queue = []; this.lines = [];
    $('idOk').onclick = () => this.idResolve?.(true);
    $('idNo').onclick = () => this.idResolve?.(false);
  }
  // ───────── 시작/끝 ─────────
  start(day, name) {
    this.day = day; this.name = name; this.min = 0; this.t = 0; this.running = true; this.paused = false; this.ending = false;
    this.customers = []; this.queue = []; this.cur = null; this.items = []; this.cash = []; this.lines = []; this.busy = false;
    this.drawer = 200000; this.expected = 200000; this.sales = 0; this.rep = 60; this.aim = null;
    this.st = { served: 0, angry: 0, greet: 0, minor: 0, theft: 0, caught: 0, handled: 0, wrongCig: 0, refund: 0, bye: 0, tidy: 0 };
    this.violence = false; this.bossDead = false;
    this.nextSpawn = 6; this.bossVisitAt = rnd(220, 320); this.bossVisited = false; this.intro = true;
    this.renderPos(); this.updateHud(true); show('hud'); this.choices([]);
    this.bossScene('intro').then(() => { this.intro = false; });
  }
  wait(s) { return new Promise(r => this.timers.push({ t: s, r })); }
  tween(obj, to, dur, rot) { return new Promise(r => this.tweens.push({ obj, from: obj.position.clone(), to: to.clone(), t: 0, dur, r, rot })); }
  // ───────── 매 프레임 ─────────
  update(dt) {
    if (!this.running || this.paused) return;
    this.t += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) if ((this.timers[i].t -= dt) <= 0) { const r = this.timers[i].r; this.timers.splice(i, 1); r(); }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const w = this.tweens[i]; w.t += dt; const k = Math.min(1, w.t / w.dur), e = k * k * (3 - 2 * k);
      w.obj.position.lerpVectors(w.from, w.to, e); if (w.rot) w.obj.rotation.y += w.rot * dt;
      if (k >= 1) { this.tweens.splice(i, 1); w.r(); }
    }
    if (!this.intro) this.min = Math.min(480, this.min + dt * 480 / SHIFT_SEC);
    const camW = this.camera.getWorldPosition(this._cw || (this._cw = new THREE.Vector3()));
    for (const c of this.customers) { c.person.fidget = !c.atCounter && !c.fleeing && !c.surr && !c.begging; c.person.update(dt, camW); }
    this.boss?.update(dt, camW);
    if (!this.intro && !this.violence && this.min < 455 && (this.nextSpawn -= dt) <= 0 && this.customers.length < 3) { this.spawn(); this.nextSpawn = rnd(18, 36) * Math.max(0.6, 1 - this.day * 0.06); }
    if (!this.intro && !this.bossVisited && this.t > this.bossVisitAt && !this.cur) { this.bossVisited = true; this.bossScene('visit'); }
    if (this.min >= 480 && !this.freeRoam && !this.customers.length && !this.ending && !this.boss) { this.ending = true; this.bossScene('end'); }
    const s = this.store, want = this.doorOpenUntil > this.t ? 1 : 0;
    s.doorAngle += (want - s.doorAngle) * Math.min(1, dt * 5); s.door.rotation.y = -s.doorAngle * 1.3;
    const D = s.C.drawer; D.open += ((this.drawerOpen ? 1 : 0) - D.open) * Math.min(1, dt * 7); D.tray.position.x = D.open * 0.3;
    this.updateHud(); this.updateHint();
  }
  openDoor() { if (!(this.doorOpenUntil > this.t)) this.audio.play('door', { pos: SPOT.doorIn, vol: 0.5 }); this.doorOpenUntil = this.t + 2.2; this.audio.chime(V3(1.1, 2.5, 3.9)); this.audio.setDoorOpen(true); setTimeout(() => this.audio.setDoorOpen(false), 2500); }

  // ───────── 말하기 ─────────
  fill(t, c, extra = {}) { return t.replace('{cig}', c?.cig ? (c.cigByNum ? `${c.cig.id}번 ${c.cig.name}` : c.cig.name) : '담배').replace('{name}', this.name).replace('{won}', extra.won || ''); }
  // 같은 손님은 같은 말을 다시 안 한다 (repeat=false 면 다 쓰면 null)
  fresh(c, arr, repeat = true) { c.used ||= new Set(); const l = arr.filter(x => !c.used.has(x[0])); const ch = l.length ? pick(l) : (repeat ? pick(arr) : null); if (ch) c.used.add(ch[0]); return ch; }
  say(c, line, after) {
    if (!line) return Promise.resolve();
    const [raw, emo = 'calm'] = Array.isArray(line) ? line : [line, 'calm'];
    const text = this.fill(raw, c);
    subtitle(c.type.name, text, c.type.id === 'boss');
    c.person.talk = 1; c.person.smile = emo === 'happy' ? 0.6 : (c.mood > 70 ? 0.25 : 0);
    if (emo === 'angry' || emo === 'annoyed') { if (Math.random() < 0.5) c.person.gesture('headShake'); } else if (Math.random() < 0.3) c.person.gesture('agree');
    const [ep, er] = EMO[emo] || EMO.calm;
    // 사람처럼: 가끔 '음…', '아,' 같은 말버릇과 쉼, 말할 때마다 빠르기·높이가 조금씩 다름
    let spoken = text; if (spoken.length > 8 && Math.random() < 0.22 && !/^(아|어|음|그|저기|야|헉|꺄)/.test(spoken)) spoken = pick(['음… ', '아, ', '어… ', '그… ', '저기… ']) + spoken;
    spoken = spoken.replace(/([.?!])\s+/g, '$1 … ');
    return new Promise(r => this.audio.speak(spoken, { pitch: c.voice[0] * ep * (0.97 + Math.random() * 0.06), rate: c.voice[1] * er * (0.95 + Math.random() * 0.1), gender: c.gender, idx: c.vIdx }, () => { c.person.talk = 0; after?.(); r(); }));
  }
  // 점원(나)이 하는 말: 자막엔 숫자, 목소리는 한국어 읽기
  meSay(arr, n) {
    const [raw] = pick(arr), shown = raw.replace('{won}', n != null ? won(n) : ''), spoken = raw.replace('{won}', n != null ? wonKo(n) : '');
    mine(shown); this.audio.duck?.();
    return new Promise(r => this.audio.speak(spoken, { gender: this.settings.myVoice || 'm', idx: 3, rate: 1.04 }, r));
  }

  // ───────── 손님 ─────────
  spawn() {
    const trouble = Math.random() < Math.min(0.45, 0.16 + this.day * 0.05) && !this.customers.some(c => c.type.trouble);
    const pool = TYPES.filter(t => trouble ? t.trouble : !t.trouble);
    let type;
    if (trouble) type = pick(pool); else { const tot = pool.reduce((a, t) => a + t.w, 0); let r = Math.random() * tot; type = pool.find(t => (r -= t.w) < 0) || pool[0]; }
    if (this.forceType) { const want = this.forceType.shift(); type = TYPES.find(t => t.id === want) || type; if (!this.forceType.length) this.forceType = null; }
    type = { ...type, bottle: type.id === 'drunk' };
    const p = new Person(type, this.audio);
    const c = { parcel: !type.trouble && Math.random() < 0.12, type, person: p, trouble: type.trouble, mood: 70, idle: 0, stage: 0, order: [...pick(type.wants)], voice: type.voice, gender: type.model === 'woman' ? 'f' : 'm', vIdx: 1 + Math.floor(Math.random() * 5) };
    if (type.cig && Math.random() < type.cig) c.cig = pick(CIGS);
    if (c.trouble === 'minor' && !c.cig && Math.random() < 0.5) c.cig = pick(CIGS);
    if (c.trouble === 'refund') c.order = [];
    c.cigByNum = Math.random() < 0.6;
    c.wantsBag = c.order.length >= 2 && Math.random() < 0.55;
    c.wantsHeat = c.order.includes('dosirak') && Math.random() < 0.7;
    c.pay = type.pay === 'throw' ? (Math.random() < 0.5 ? 'card' : 'cash') : (Math.random() < 0.8 ? type.pay : (type.pay === 'card' ? 'cash' : 'card'));
    if (this.forceCash) c.pay = 'cash';
    c.throws = type.pay === 'throw';
    p.root.position.copy(SPOT.street).add(V3(rnd(-2, 2), 0, rnd(-0.3, 0.6)));
    if (Math.random() < 0.5) p.root.position.x = 8 + rnd(0, 2);
    this.scene.add(p.root); this.customers.push(c);
    this.life(c).catch(e => console.error(e));
  }
  async life(c) {
    const p = c.person;
    await p.walk([V3(1.1, 0, 5.6), SPOT.doorOut]);
    this.openDoor(); c.greetUntil = this.t + 7; this.lastEntered = c;
    await p.walk([SPOT.doorIn]);
    if (c.trouble === 'drunk') this.say(c, this.fresh(c, TROUBLE.drunk.enter));
    if (c.trouble !== 'rude' && c.trouble !== 'refund') {
      const stops = c.trouble === 'thief' ? 2 : 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < stops && !c.gone; i++) {
        const fridge = Math.random() < 0.4, ax = pick(SPOT.aisles);
        const tgt = fridge ? V3(rnd(-4, 1.5), 0, SPOT.backZ) : V3(ax, 0, rnd(-1.7, 1.7));
        await p.walk(route(p.root.position, tgt));
        const shelf = fridge ? V3(tgt.x, 1.1, -3.6) : V3(ax < -3 ? -4.6 : (ax < -1 ? -2.6 : -0.6), 1.0, tgt.z);
        p.lookAt(shelf); await this.wait(rnd(1.2, 2.2));
        p.reach(shelf, 1100); await this.wait(rnd(1.2, 2.2));       // 진열대에서 물건 집기

        if (c.trouble === 'thief' && !c.stolen) { c.stolen = pick(['chips', 'choco', 'battery']); this.cctv(true); this.audio.play('bag', { pos: p.root.position, vol: 0.2 }); }
        if (fridge) { this.audio.play('door', { pos: shelf, vol: 0.25, rate: 1.4 }); await p.walk([V3(tgt.x, 0, SPOT.frontZ - 0.3)]); }
      }
      if (c.trouble === 'thief' && Math.random() < 0.35) { this.say(c, TROUBLE.thief.escape[0]); c.escaped = true; return this.leave(c); }
    }
    if (c.gone) return;
    await this.queueUp(c);
    if (!c.gone) await this.counter(c);
  }
  async queueUp(c) {
    this.queue.push(c);
    for (; ;) {
      if (c.gone) return;
      const i = this.queue.indexOf(c);
      if (i === 0 && !this.cur) { this.queue.shift(); this.cur = c; await c.person.walk(route(c.person.root.position, SPOT.customer)); c.person.lookAt(SPOT.cam); return; }
      const spot = SPOT.queue[Math.min(i, 1)].clone().add(V3(-0.75 * Math.max(0, i - 1), 0, 0));
      if (c.person.root.position.distanceTo(spot) > 0.2 && !c.person.path.length) { await c.person.walk(route(c.person.root.position, spot)); c.person.lookAt(SPOT.customer); }
      await this.wait(0.5); c.mood -= 0.15;
    }
  }
  async counter(c) {
    c.atCounter = true; show('cust'); $('cname').textContent = c.type.name;
    await this.wait(0.3);
    // 물건을 하나씩 계산대에 내려놓는다 (손을 뻗어서)
    const all = c.trouble === 'refund' ? ['dosirak'] : c.order;
    for (let i = 0; i < all.length; i++) { const at = this.slotPos(i); c.person.reach(at, 700); await this.wait(0.45); const it = this.addItem(all[i]); if (c.trouble === 'refund') { it.refund = true; it.mesh.rotation.z = 0.3; } await this.wait(0.25); }
    await this.wait(0.3);
    const T = TROUBLE[c.trouble];
    let line = T?.counter ? this.fresh(c, T.counter) : (c.cig ? this.fresh(c, L.cigAsk) : this.fresh(c, L.request));
    if (c.trouble === 'rude' && !c.cig) line = T.counter[1];
    await this.say(c, line);
    if (c.trouble === 'haggle' || c.trouble === 'refund') { c.waitReply = c.trouble; this.offerChoices(c); }
    if (c.cig && c.trouble === 'minor') this.say(c, this.fresh(c, L.cigAsk));
    while (!c.done && !c.gone) { await this.wait(0.25); this.tick(c, 0.25); }
  }
  tick(c, dt) {
    if (this.paused) return;
    if (this.busy) { c.idle = 0; return; }
    c.idle += dt;
    if (c.trouble === 'drunk' && !c.paid && c.idle > 0 && (c.rambleT = (c.rambleT || 9) - dt) < 0) { c.rambleT = 14; const l = this.fresh(c, TROUBLE.drunk.counter, false); if (l) this.say(c, l); }
    if (!c.paid) {
      if (c.idle > 22 && c.stage < 1) { c.stage = 1; c.mood -= 8; this.say(c, this.fresh(c, L.wait1)); }
      else if (c.idle > 40 && c.stage < 2) { c.stage = 2; c.mood -= 15; this.say(c, this.fresh(c, L.wait2)); }
      else if (c.idle > 60 || c.mood <= 0) { this.say(c, this.fresh(c, L.leaveAngry)); this.rep -= 8; this.st.angry++; this.endTx(c, false); }
    }
    $('moodbar').style.width = Math.max(0, Math.min(100, c.mood)) + '%';
    $('moodbar').style.background = c.mood > 55 ? '#2fd3b4' : c.mood > 30 ? '#ffb84a' : '#ff4d5e';
    $('cwant').textContent = (c.cig ? `담배: ${c.cig.id}번 ${c.cig.name}${c.cigGiven ? ' (완료)' : ''} · ` : '') + `스캔 ${this.items.filter(i => i.scanned).length}/${this.items.filter(i => !i.refund).length}`;
  }
  async leave(c) {
    if (c.dead) return;
    c.gone = true; c.atCounter = false;
    const i = this.queue.indexOf(c); if (i >= 0) this.queue.splice(i, 1);
    if (this.cur === c) { this.cur = null; show('cust', false); }
    const p = c.person; p.faceTarget = null;
    await p.walk(route(p.root.position, SPOT.doorIn));
    this.openDoor();
    await p.walk([SPOT.doorOut, V3(1.1, 0, 5.8), V3(p.root.position.x < 0 ? -9 : 9, 0, 6)]);
    p.dispose(); this.customers.splice(this.customers.indexOf(c), 1);
    if (c.escaped || (c.stolen && !c.caught)) this.st.theft += PRODUCTS[c.stolen].price;
    if (!this.customers.some(x => x.stolen && !x.caught && !x.gone)) this.cctv(false);
  }
  endTx(c, good) {
    c.done = true; this.choices([]);
    for (const it of this.items) it.mesh.removeFromParent(); this.items = [];
    for (const m of this.cash) m.removeFromParent(); this.cash = [];
    this.card?.removeFromParent(); this.card = null; this.bagMesh?.removeFromParent(); this.bagMesh = null;
    this.lines = []; this.posMsg = ''; this.recv = null; this.chg = null; this.renderPos();
    if (good) { this.st.served++; this.rep += Math.max(-3, Math.min(4, (c.mood - 50) / 10)); }
    this.rep = Math.max(0, Math.min(100, this.rep));
    const lingerDrunk = c.trouble === 'drunk' && good && Math.random() < 0.6;
    c.byeWindow = this.t + 5;
    if (good && !this.voiceOK) this.choices([['감사합니다, 안녕히 가세요!']]);
    this.wait(lingerDrunk ? 0.2 : 2.4).then(async () => {
      if (lingerDrunk) { c.lingering = true; if (!this.voiceOK) this.choices([['손님, 이제 들어가셔야 해요']]); for (let k = 0; k < 3 && c.lingering; k++) { const l = this.fresh(c, TROUBLE.drunk.counter, false); if (l) this.say(c, l); await this.wait(9); } }
      if (!c.gone) { this.choices([]); this.leave(c); }
    });
  }

  // ───────── 계산대 위 물건 ─────────
  slotPos(n) { return V3(2.42 + (n % 3) * 0.12, SPOT.counterY, 0.62 + Math.floor(n / 3) * 0.2); }
  addItem(key, cig) {
    const mesh = cig ? cigMesh(cig) : productMesh(key, true); mesh.scale.setScalar(1.2);
    const n = this.items.length; mesh.position.copy(this.slotPos(n)); mesh.position.z += rnd(-0.02, 0.02);
    mesh.rotation.y = rnd(-0.6, 0.6); if (cig) mesh.rotation.set(-Math.PI / 2, 0, rnd(-1, 1));
    const P = cig ? { name: cig.name, price: cig.price, adult: true } : PRODUCTS[key];
    const it = { mesh, key: key || 'cig', cig, name: P.name, price: P.price, adult: !!P.adult, scanned: false };
    mesh.userData.item = it;
    this.scene.add(mesh); this.items.push(it);
    this.audio.play('thud', { pos: mesh.position, vol: 0.35, rate: 1.6 + Math.random() * 0.4 });
    return it;
  }
  addLine(name, price, key, adult) { const ex = this.lines.find(l => l.name === name); ex ? ex.qty++ : this.lines.push({ name, price, key, qty: 1, adult }); this.renderPos(); }
  total() { return this.lines.reduce((a, l) => a + l.price * l.qty, 0); }
  renderPos() {
    if (!this.store) return;
    drawPos(this.store.C.posScreenTex, this.store.C.custTex, { items: this.lines.map(l => ({ name: l.name, qty: l.qty, price: l.price * l.qty })), total: this.total(), recv: this.recv, change: this.chg, clock: this.clock?.(), staff: this.name, msg: this.posMsg, msgCol: this.posCol });
  }

  // ───────── [바코드 찍기] 버튼: 점이 가리키는 것에 따라 ─────────
  doPrimary() {
    if (!this.running || this.busy) return;
    const a = this.aim;
    if (!a) return toast('상품에 화면 가운데 점을 맞춰 주세요');
    if (a.type === 'item') return this.scanItem(a.item);
    if (a.type === 'cig') return this.takeCig(a.obj);
    if (a.type === 'mw') return this.heat();
    if (a.type === 'mess') return this.tidyItem(a.entry);
    if (a.type === 'guns') return this.crime?.takeFromCabinet();
    if (a.type === 'counter') return toast('계산은 <b>계산하기</b> 버튼이에요');
    toast('상품에 점을 맞춰 주세요');
  }
  async scanItem(it) {
    const c = this.cur;
    if (it.scanned) return toast('이미 찍은 상품이에요');
    if (it.refund) { this.say(c, TROUBLE.refund.angry[0]); return; }
    this.busy = true; c && (c.idle = 0);
    const H = this.hands, S = this.store.C.scanner;
    // 오른손으로 상품 집어서 바코드가 보이게 들고
    await H.reachTo('R', it.mesh.position, 'open', 'down', 320);
    H.pose('R', 'grip'); await this.wait(0.15);
    H.hold('R', it.mesh); it.mesh.scale.setScalar(1.0);
    await H.reachTo('R', SCAN_AT, 'grip', 'front', 380);
    // 왼손으로 핸드 스캐너 들어서 바코드에 대고 삑
    await H.reachTo('L', S.gun.getWorldPosition(V3()), 'open', 'down', 300);
    H.pose('L', 'grip'); await this.wait(0.12); H.hold('L', S.gun); S.gun.position.set(0, -0.06, 0.02); S.gun.rotation.set(0, -Math.PI / 2, -0.2);
    await H.reachTo('L', SCAN_AT.clone().add(V3(0.06, 0.05, 0.17)), 'grip', 'front', 380);
    S.laser.visible = true; S.win.material.color.set(0xff3030);
    await this.wait(0.15);
    this.audio.beep(SCAN_AT); S.laser.visible = false; S.win.material.color.set(0x551111);
    it.scanned = true; this.addLine(it.name, it.price, it.key, it.adult); this.posMsg = it.name; this.posCol = '#294a78'; this.renderPos();
    // 스캐너 제자리, 상품은 봉투 쪽에
    await H.reachTo('L', S.stand.getWorldPosition(V3()).add(V3(0, 0.12, 0)), 'grip', 'down', 300);
    S.home(); H.pose('L', 'open'); H.rest('L');
    const n = this.items.filter(x => x.scanned).length - 1, dst = BAG_AT.clone().add(V3((n % 2) * 0.13, 0, -Math.floor(n / 2) * 0.12));
    await H.reachTo('R', dst, 'grip', 'down', 360);
    H.hold('R', null); this.scene.add(it.mesh); it.mesh.position.copy(dst); it.mesh.rotation.set(0, rnd(-1, 1), 0); it.mesh.scale.setScalar(1.2);
    if (it.cig) it.mesh.rotation.set(-Math.PI / 2, 0, rnd(-1, 1));
    this.audio.play('thud', { pos: dst, vol: 0.3, rate: 1.8 });
    H.pose('R', 'open'); H.rest('R'); this.busy = false;
  }
  // 담배: 뒤돌아서 점을 맞추고 바코드 찍기 → 꺼내서 계산대에 올림 (그다음 바코드 찍기)
  async takeCig(slot) {
    const c = this.cur, cig = slot.userData.cig;
    if (!c || !c.cig || c.cigGiven) { toast(`${cig.id}번 ${cig.name} · ${won(cig.price)}`); return; }
    if (cig.id !== c.cig.id) { this.st.wrongCig++; c.mood -= 6; this.say(c, this.fresh(c, L.wrongCig)); return; }
    this.busy = true;
    const H = this.hands;
    await H.reachTo('R', slot.getWorldPosition(V3()), 'open', 'front', 380);
    H.pose('R', 'pinch'); await this.wait(0.15);
    const m = cigMesh(cig); H.hold('R', m, 'pinch'); m.rotation.set(0, Math.PI / 2, 0);
    this.audio.play('bag', { pos: SPOT.cam, vol: 0.3, rate: 1.6, dur: 0.25 });
    this.look.turnTo(Math.PI / 2); await this.wait(0.7);
    const at = this.slotPos(this.items.length);
    await H.reachTo('R', at, 'pinch', 'down', 360);
    H.hold('R', null); c.cigGiven = true; this.addItem(null, cig); H.pose('R', 'open'); H.rest('R'); this.busy = false;
  }

  // ───────── [계산하기] 버튼: 계산대에 점 맞추고 → 자동 결제 ─────────
  async doCheckout() {
    if (!this.running || this.busy) return;
    const c = this.cur;
    if (!c || c.done) return;
    if (c.trouble === 'refund') { this.busy = true; await this.meSay(ME.noRefund); await this.say(c, this.fresh(c, TROUBLE.refund.refused)); this.st.handled++; this.busy = false; return this.endTx(c, true); }
    // 계산하기 한 번이면 끝까지 자동: 남은 상품 바코드 차례로 찍기 → 담배 꺼내기 → 결제
    const scanAll = async () => { for (let k = 0, it; k < 30 && (it = this.items.find(i => !i.scanned && !i.refund)); k++) { await this.scanItem(it); await this.wait(0.1); if (c.gone) return false; } return true; };
    if (!await scanAll()) return;
    if (c.cig && !c.cigGiven) { const slot = this.store.cigSlots.find(s => s.userData.cig?.id === c.cig.id); if (slot) { await this.takeCig(slot); await this.wait(0.2); } if (!await scanAll()) return; }
    if (this.items.some(i => !i.scanned && !i.refund)) return;
    // 택배 접수: 손님이 상자를 올려놓음 → 무게 재고 송장 출력 → 선불 4,000원 추가
    if (c.parcel && !c.parcelDone) {
      c.parcelDone = true; this.busy = true;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.26), PARCEL()); box.position.copy(this.slotPos(this.items.length + 1)); box.position.y += 0.11; box.rotation.y = 0.3; this.scene.add(box);
      await this.say(c, ['아, 택배도 하나 보낼게요. 선불로요.', 'calm']);
      await this.hands.reachTo('R', box.position, 'open', 'down', 420); this.audio.beep(box.position, true); this.audio.play('register', { vol: 0.4, rate: 1.3, delay: 0.3 });
      this.addLine('편의점 택배 (선불)', 4000); await this.wait(0.6); this.hands.rest('R'); box.position.x += 0.6; await this.wait(0.3); box.removeFromParent(); this.busy = false;
    }
    if (!this.lines.length) return toast('찍은 상품이 없어요');
    // 술·담배 → 연령 확인
    if (this.lines.some(l => l.adult) && !c.idChecked) {
      const ans = await new Promise(r => modal(`<h2>${ic('warn')} 연령 확인</h2><p>술이나 담배가 있어요. 신분증을 확인할까요?<br><small>2007년생까지 판매 가능</small></p>`, [['그냥 계산', 'gray', () => r('skip')], ['신분증 확인', 'blue', () => r('check')]]));
      if (ans === 'check') { const ok = await this.checkId(); if (!ok) return; } else c.idChecked = 'skip';
    }
    if (c.waitReply === 'haggle') { c.waitReply = null; this.choices([]); }
    this.busy = true; c.idle = 0;
    const total = this.total();
    this.posMsg = '결제 대기'; this.posCol = '#2467c9'; this.renderPos();
    await this.meSay(ME.total, total);
    if (c.pay === 'card') await this.cardFlow(c, total); else await this.cashFlow(c);
    if (c.gone) { this.busy = false; return; }
    // 영수증 출력
    this.printReceipt();
    c.paid = true; this.posMsg = '결제 완료'; this.posCol = '#1d9e5b'; this.renderPos();
    if (c.trouble === 'minor' && this.lines.some(l => l.adult) && !c.refusedSale) {
      this.st.minor++; this.rep -= 30;
      setTimeout(() => toast(ic('warn') + '미성년자에게 술·담배 판매!<br><small>적발되면 영업정지 + 벌금</small>', 'bad', 3500), 2500);
    }
    if (c.wantsBag && !this.bagMesh) { await this.say(c, this.fresh(c, L.bagAsk)); await this.bagBtn(true); }
    if (c.wantsHeat) { c.heatWait = true; this.busy = false; await this.say(c, this.fresh(c, L.heat)); this.heatPending = c; return; }
    await this.handOver(c);
  }
  async handOver(c) {
    // 손님이 물건(봉투)을 가져가며 인사
    if (this.bagMesh) {
      const H = this.hands, bag = this.bagMesh, top = bag.position.clone().add(V3(0, 0.3, 0));
      this.busy = true;
      for (const it of this.items) { if (!it.mesh.visible || it.refund) continue; const sd = H.sideOf(it.mesh.position); await H.reachTo(sd, it.mesh.position, 'open', 'down', 220); H.pose(sd, 'grip'); H.hold(sd, it.mesh); await H.reachTo(sd, top, 'grip', 'down', 240); H.hold(sd, null); it.mesh.visible = false; this.audio.rustle(top, 0.35, 0.55); H.pose(sd, 'open'); H.rest(sd); }
      bag.scale.set(1.05, 1, 1.25);
      await H.reachTo('R', top.clone().add(V3(0, 0.05, 0)), 'open', 'down', 260); H.pose('R', 'pinch'); H.hold('R', bag, 'pinch'); bag.rotation.set(Math.PI, 0, 0); bag.position.set(0, -0.02, 0);
      this.audio.rustle(GIVE_AT, 0.6, 0.6); await H.reachTo('R', GIVE_AT.clone().add(V3(0, 0.25, 0)), 'pinch', 'front', 420);
      c.person.reach(GIVE_AT, 900); await this.wait(0.45); H.hold('R', null); this.audio.rustle(GIVE_AT, 0.5, 0.5); H.pose('R', 'open'); H.rest('R'); this.bagMesh = null;
    } else {
      c.person.reach(BAG_AT, 900); await this.wait(0.5);
      for (const it of this.items) it.mesh.visible = false;
      this.audio.play('bag', { pos: BAG_AT, vol: 0.6 });
    }
    this.busy = false;
    await this.say(c, c.trouble === 'rude' ? (c.handledRude ? TROUBLE.rude.polite[1] : ['…', 'tired']) : this.fresh(c, L.thanks));
    this.endTx(c, true);
  }
  printReceipt() {
    const p = this.store.C.paper; let k = 0;
    for (let i = 0; i < 10; i++) this.audio.play('key', { pos: this.store.C.printer.position, vol: 0.22, rate: 0.55, delay: i * 0.07 });
    const iv = setInterval(() => { k++; p.scale.y = 0.02 + k * 0.012; if (k >= 12) { clearInterval(iv); setTimeout(() => (p.scale.y = 0.02), 2500); } }, 60);
  }
  async cardFlow(c, total) {
    const C = this.store.C, H = this.hands;
    await this.meSay(ME.cardIn);
    // 손님이 카드를 꺼내 단말기에 꽂는다
    const card = this.cardMesh(c); card.position.copy(c.person.root.position).add(V3(0.25, 1.05, 0)); this.scene.add(card); this.card = card;
    if (c.throws) { this.say(c, TROUBLE.rude.cardThrow[0]); card.position.set(2.55, SPOT.counterY + 0.003, 1.2); this.audio.play('whoosh', { pos: card.position, vol: 0.5 }); await this.wait(0.6);
      await H.reachTo('R', card.position, 'open', 'down', 350); H.pose('R', 'pinch'); H.hold('R', card, 'pinch'); await H.reachTo('R', C.readerSlot().add(V3(0.02, 0.06, 0)), 'pinch', 'down', 380); H.hold('R', null); this.scene.add(card); H.rest('R');
    } else { c.person.reach(C.readerSlot(), 1600); await this.tween(card, C.readerSlot().add(V3(0, 0.03, 0)), 0.7); }
    card.position.copy(C.readerSlot()).add(V3(-0.01, 0.015, 0)); card.rotation.set(0, 0, Math.PI / 2 - 0.35);
    C.readerMsg('결제 중\n잠시만…', '#ffd36b'); this.posMsg = '카드 승인 중'; this.posCol = '#c98d1d'; this.renderPos();
    await this.wait(1.4);
    this.audio.beep(C.readerSlot()); await this.wait(0.15); this.audio.beep(C.readerSlot());
    C.readerMsg('승인 완료\n카드 빼세요', '#7dffb0'); this.sales += total;
    await this.meSay(ME.cardOk);
    c.person.reach(C.readerSlot(), 900); await this.tween(card, c.person.root.position.clone().add(V3(0.2, 1.0, 0)), 0.6);
    card.removeFromParent(); this.card = null; C.readerMsg('카드를\n넣어주세요');
  }
  async cashFlow(c) {
    const C = this.store.C, H = this.hands, D = C.drawer;
    let total = this.total();
    let given = this.cashFor(total);
    if (c.trouble === 'drunk') { given = Math.max(1000, Math.floor((total - 500) / 1000) * 1000); }
    c.person.reach(V3(2.45, SPOT.counterY, 0.5), 900); await this.wait(0.5);
    this.putCash(given, c.throws); this.say(c, c.throws ? ['(돈을 툭 던진다)', 'angry'] : this.fresh(c, L.cash));
    await this.wait(0.6);
    // 돈이 모자라면 (취객) → 제일 싼 상품 하나 빼고 다시
    while (given < total && this.lines.length) {
      await this.meSay(ME.short, total - given); await this.say(c, TROUBLE.drunk.short[0]);
      const l = [...this.lines].sort((a, b) => a.price - b.price)[0]; l.qty--; if (!l.qty) this.lines.splice(this.lines.indexOf(l), 1);
      const it = this.items.find(i => i.name === l.name && i.mesh.visible); if (it) it.mesh.visible = false;
      total = this.total(); this.renderPos(); await this.meSay(ME.total, total); this.st.handled++;
    }
    // 내 손: 손님 돈 집기 → 돈통 열기 → 칸에 넣기
    await H.reachTo('L', this.cash[0].position, 'open', 'down', 340);
    H.pose('L', 'pinch'); await this.wait(0.15);
    const stack = new THREE.Group(); this.cash.forEach((m, i) => { m.removeFromParent(); m.position.set(0, i * 0.0015, 0); m.rotation.set(0, Math.PI / 2, 0); stack.add(m); });
    this.cash = []; H.hold('L', stack, 'pinch'); this.audio.play('bill', { pos: GIVE_AT, vol: 0.8 });
    this.recv = given; this.renderPos();
    await this.meSay(ME.recv, given);
    const keep = [this.look.yaw, this.look.pitch]; this.look.turnTo(Math.PI / 2 - 0.45); this.look.pitchTo(-0.75);
    this.drawerOpen = true; this.audio.play('register', { pos: SPOT.drawer, vol: 0.8 }); await this.wait(0.5);
    const big = DENOMS.find(d => d <= given && d >= 1000) || 1000;
    const slotP = D.slots[big].getWorldPosition(V3());
    await H.reachTo('L', slotP, 'pinch', 'down', 420);
    H.hold('L', null); stack.children.slice().forEach(b => { D.slots[Math.min(...[50000, 10000, 5000, 1000].filter(x => x >= 1000))] && D.slots[big].add(b); b.position.y = 0.02 + D.slots[big].children.length * 0.0013; b.rotation.set(0, Math.PI / 2, 0); });
    this.audio.play('bill', { pos: slotP, vol: 0.5, rate: 1.2 }); H.pose('L', 'open'); H.rest('L');
    // 거스름돈: 칸마다 집어서 손님 쪽으로
    const chg = given - total; this.chg = chg; this.renderPos();
    this.drawer += given - chg; this.expected += total; this.sales += total;
    if (chg > 0) {
      const parts = change(chg), groups = {}; parts.forEach(d => (groups[d] = (groups[d] || 0) + 1));
      const pile = new THREE.Group();
      for (const d of Object.keys(groups).map(Number).sort((a, b) => b - a)) {
        const sp = D.slots[d].getWorldPosition(V3());
        await H.reachTo('R', sp, 'open', 'down', 330); H.pose('R', 'pinch'); await this.wait(0.12);
        d >= 1000 ? this.audio.play('bill', { pos: sp, vol: 0.5, rate: 1.3, dur: 0.4 }) : this.audio.coins(sp);
        for (let k = 0; k < groups[d]; k++) { const m = d >= 1000 ? billMesh(d) : coinMesh(d); m.position.y = pile.children.length * 0.0016; m.rotation.y = Math.PI / 2 + rnd(-0.1, 0.1); pile.add(m); }
        H.hold('R', pile, 'pinch');
        await this.wait(0.1);
      }
      this.look.turnTo(keep[0]); this.look.pitchTo(Math.max(-0.45, keep[1]));
      await H.reachTo('R', GIVE_AT, 'pinch', 'up', 450);
      await this.meSay(ME.change, chg);
      c.person.reach(GIVE_AT, 1000); await this.wait(0.55);
      H.hold('R', null); this.audio.coins(GIVE_AT); this.say(c, this.fresh(c, L.takeChange));
      H.pose('R', 'open'); H.rest('R');
    }
    if (chg <= 0) { this.look.turnTo(keep[0]); this.look.pitchTo(keep[1]); }
    await this.wait(0.3); this.drawerOpen = false; this.audio.play('thud', { pos: SPOT.drawer, vol: 0.5, rate: 0.8 });
  }
  cashFor(total) {
    if (Math.random() < 0.12) return 50000;
    if (Math.random() < 0.25) return Math.ceil(total / 1000) * 1000;
    return [1000, 5000, 10000, 20000, 50000].find(v => v >= total) || Math.ceil(total / 10000) * 10000;
  }
  putCash(amount, messy) {
    let left = amount, i = 0;
    for (const d of DENOMS) while (left >= d && d >= 1000) {
      left -= d; const m = billMesh(d);
      m.rotation.y = Math.PI / 2 + (messy ? rnd(-1.2, 1.2) : rnd(-0.1, 0.1));
      m.position.set(2.46 + (messy ? rnd(-0.05, 0.2) : 0), SPOT.counterY + 0.002 + i * 0.0014, 0.5 + (messy ? rnd(-0.2, 0.5) : i * 0.012));
      this.scene.add(m); this.cash.push(m); i++;
    }
  }
  cardMesh(c) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 160; const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 256, 160); gr.addColorStop(0, pick(['#1d3b8a', '#111', '#8a1d4a', '#c9a227', '#2d6a4f'])); gr.addColorStop(1, '#3a3f47'); g.fillStyle = gr; g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#e6c35a'; g.fillRect(26, 54, 40, 30); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '700 18px monospace'; g.fillText('5412 •••• •••• ' + (1000 + Math.random() * 8999 | 0), 26, 122);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const side = new THREE.MeshStandardMaterial({ color: 0x333333 });
    return new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.0008, 0.054), [side, side, new THREE.MeshStandardMaterial({ map: t, roughness: 0.3, metalness: 0.2 }), side, side, side]);
  }
  // 넘어진 상품 정리
  async tidyItem(e) {
    if (!e?.messy || this.busy) return; this.busy = true;
    const H = this.hands, p = e.pos.clone(), cur = new THREE.Vector3().setFromMatrixPosition(e.cur), side = H.sideOf(cur);
    await H.reachTo(side, cur, 'open', 'down', 300); H.pose(side, 'grip'); await this.wait(0.12);
    this.store.merch.tidy(e); await H.reachTo(side, p, 'grip', 'front', 320);
    this.audio.play('thud', { pos: p, vol: 0.4, rate: 1.7 }); H.pose(side, 'open'); H.rest(side);
    this.st.tidy++; this.rep = Math.min(100, this.rep + 0.6); toast(ic('check') + '정리 완료', 'good', 700); this.busy = false;
  }
  // 구겨진 비닐봉투 (반투명, 주름, 손잡이)
  makeBag() {
    const w = 0.3, d = 0.15, h = 0.36, g = new THREE.BoxGeometry(w, h, d, 10, 12, 4), p = g.attributes.position;
    const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = (y + h / 2) / h;
      const n = Math.sin(x * 61 + ph[0]) * Math.sin(y * 47 + ph[1]) * 0.012 + Math.sin(x * 23 + y * 31 + ph[2]) * 0.009 + (Math.random() - 0.5) * 0.004;
      p.setXYZ(i, x * (0.86 + 0.14 * t) + n, y + Math.abs(n) * 0.4, z * (0.55 + 0.45 * t) + n * 1.3);
    }
    // 윗면(입구)은 지움
    const idx = g.index.array, keep = []; for (let i = 0; i < idx.length; i += 3) { if (![0, 1, 2].every(k => p.getY(idx[i + k]) > h / 2 - 0.02)) keep.push(idx[i], idx[i + 1], idx[i + 2]); } g.setIndex(keep);
    g.computeVertexNormals(); g.translate(0, h / 2, 0);
    const wr = document.createElement('canvas'); wr.width = wr.height = 256; const c = wr.getContext('2d'); c.fillStyle = '#808080'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) { c.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.2 + Math.random() * 0.4})`; c.lineWidth = 1 + Math.random() * 2; c.beginPath(); let x = Math.random() * 256, y = Math.random() * 256; c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 80; y += (Math.random() - 0.5) * 80; c.lineTo(x, y); } c.stroke(); }
    const bump = new THREE.CanvasTexture(wr);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.5, transparent: true, opacity: 0.8, side: THREE.DoubleSide, bumpMap: bump, bumpScale: 2.5, envMapIntensity: 0.8 });
    const bag = new THREE.Group(); bag.add(new THREE.Mesh(g, mat));
    for (const sx of [-1, 1]) { const hd = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16, Math.PI), mat); hd.position.set(sx * 0.07, h + 0.005, 0); bag.add(hd); }
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.07), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, map: (() => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const x = cv.getContext('2d'); x.fillStyle = '#1f2d4a'; x.font = '900 70px sans-serif'; x.fillText('달빛', 20, 85); x.fillStyle = '#2fd3b4'; x.fillText('24', 160, 85); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })() }));
    logo.position.set(0, h * 0.55, d * 0.5 + 0.004); bag.add(logo);
    return bag;
  }
  // 봉투: 계산대 아래에서 꺼내 펼침 (유상 100원)
  async bagBtn(auto = false) {
    const c = this.cur; if (!c || this.bagMesh || (this.busy && !auto)) return;
    if (!c.wantsBag && !auto) { c.mood -= 2; this.say(c, ['아, 봉투는 괜찮아요.', 'calm']); return; }
    const H = this.hands; const wasBusy = this.busy; this.busy = true;
    await H.reachTo('R', V3(2.86, 0.7, 1.25), 'open', 'front', 320); H.pose('R', 'pinch');
    const bag = this.makeBag(); this.audio.rustle(BAG_AT, 0.9, 0.6);
    H.hold('R', bag, 'pinch');
    await H.reachTo('R', BAG_AT.clone().add(V3(0.05, 0.15, -0.05)), 'pinch', 'down', 380);
    H.hold('R', null); this.scene.add(bag); bag.position.copy(BAG_AT).add(V3(0.08, 0, -0.1)); bag.rotation.set(0, Math.PI / 2 + rnd(-0.3, 0.3), 0); this.bagMesh = bag; this.audio.rustle(bag.position, 0.5, 0.5);
    if (!c.paid) this.addLine('봉투(유상)', 100, 'bag', false);
    await this.meSay(ME.bag); H.pose('R', 'open'); H.rest('R'); this.busy = wasBusy; c.wantsBag = false;
  }
  async heat() {
    const c = this.heatPending; if (!c || this.busy) return toast(c ? '' : '데울 게 없어요');
    this.heatPending = null; this.busy = true;
    const H = this.hands, it = this.items.find(i => i.key === 'dosirak'), mw = V3(4.25, 1.08, -0.25);
    if (it) { it.mesh.visible = true; H.hold('L', it.mesh); }
    await H.reachTo('L', mw, 'grip', 'front', 420); H.hold('L', null); H.rest('L');
    this.audio.play('thud', { pos: mw, vol: 0.5 });
    const ctx = this.audio.ctx, hum = ctx.createOscillator(), g = ctx.createGain(); hum.frequency.value = 118; g.gain.value = 0.03; hum.connect(g); g.connect(this.audio.master); hum.start();
    toast('전자레인지 돌리는 중… (1분)'); await this.wait(5); hum.stop();
    this.audio.play('chime', { pos: mw, vol: 0.5, rate: 2.2, dur: 0.5 });
    this.look.turnTo(Math.PI / 2); await this.wait(0.6);
    c.mood += 6; await this.handOver(c);
  }
  // ───────── 신분증 ─────────
  async checkId() {
    const c = this.cur; if (!c) return false;
    c.idChecked = true; this.busy = true;
    await this.meSay(ME.idAsk);
    if (c.trouble === 'minor' && Math.random() < 0.5) {
      await this.say(c, this.fresh(c, TROUBLE.minor.noId)); await this.meSay([['죄송하지만 신분증 없으면 판매가 안 돼요.']]);
      this.busy = false; this.refuseMinor(c); return false;
    }
    const age = c.trouble === 'minor' ? 2026 - (2008 + Math.floor(Math.random() * 3)) : ({ student: 21, woman: 34, office: 41, night: 29, rider: 33, soldier: 21, drunk: 52, rude: 27, haggle: 55 }[c.type.id] || 30);
    await this.say(c, c.trouble === 'minor' ? TROUBLE.minor.fake[0] : this.fresh(c, age > 35 ? L.idOld : L.idShow));
    const year = 2026 - age; this.showId(c, year);
    const sell = await new Promise(r => (this.idResolve = r)); show('idcard', false); this.idResolve = null; this.busy = false;
    const minor = year > 2007;
    if (sell) { if (minor) c.idOkWrong = true; return true; }
    if (minor) { this.refuseMinor(c); return false; }
    c.mood -= 25; this.say(c, this.fresh(c, L.idWrongRefuse)); return false;
  }
  showId(c, year) {
    const yy = String(year).slice(2), m = 1 + Math.floor(Math.random() * 12), d = 1 + Math.floor(Math.random() * 28);
    $('idName').textContent = pick(['김', '이', '박', '최', '정']) + pick(['민준', '서연', '도윤', '지우', '하준', '수아', '현우', '지민']);
    $('idNum').textContent = `${yy}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}-${year >= 2000 ? (c.type.model === 'man' ? 3 : 4) : (c.type.model === 'man' ? 1 : 2)}******`;
    $('idAddr').textContent = pick(['서울특별시 마포구 월드컵로', '서울특별시 관악구 신림로', '경기도 수원시 팔달구']);
    show('idcard');
  }
  refuseMinor(c) { c.refusedSale = true; this.st.handled++; this.rep += 5; this.say(c, this.fresh(c, TROUBLE.minor.refused)); toast(ic('check') + '미성년자 판매 거절 — 잘했어요!', 'good'); this.endTx(c, false); this.st.served++; }

  // ───────── 음성으로 들은 말 ─────────
  hear(text) {
    if (!this.running) return;
    mine(text);
    const intent = (INTENTS.find(([, re]) => re.test(text.replace(/\s+/g, ' '))) || ['none'])[0];
    const c = this.cur;
    if (this.boss && this.bossListening) { if (intent === 'rude') { this.rep -= 15; this.say(this.bossC, ['…방금 뭐라고 했어?', 'angry']); } else this.say(this.bossC, pick([['그래, 그래.', 'happy'], ['응, 수고해.', 'calm'], ['좋아.', 'happy']])); return; }
    const le = this.lastEntered;
    if (intent === 'greet' && le && !le.greeted && le.greetUntil > this.t) { le.greeted = true; le.mood += 12; this.st.greet++; this.rep += 1; this.choices([]); if (Math.random() < 0.6) this.say(le, this.fresh(le, L.greetBack)); else le.person.gesture('agree'); return; }
    const done = this.customers.find(x => x.done && !x.gone && x.byeWindow > this.t - 3);
    if (intent === 'bye' && done && !done.byeSaid) { done.byeSaid = true; this.rep += 1; this.st.bye++; this.choices([]); if (done.lingering) { done.lingering = false; this.say(done, TROUBLE.drunk.out[0]); } else done.person.gesture('agree'); return; }
    if (!c) { if (done?.lingering && (intent === 'out' || intent === 'police' || intent === 'none')) return this.kickOut(done); return; }
    c.idle = 0;
    const T = TROUBLE[c.trouble];
    switch (intent) {
      case 'greet': if (!c.greeted) { c.greeted = true; c.mood += 6; this.say(c, this.fresh(c, L.greetBack)); } break;
      case 'bagask': c.bagAnswered = true; this.say(c, this.fresh(c, c.wantsBag ? L.bagYes : L.bagNo)); break;
      case 'point': this.say(c, this.fresh(c, Math.random() < 0.2 ? L.pointYes : L.pointNo)); c.mood += 2; break;
      case 'receipt': this.say(c, this.fresh(c, Math.random() < 0.3 ? L.receiptYes : L.receiptNo)); c.mood += 2; break;
      case 'id': if (!c.idChecked && !this.busy) this.checkId(); break;
      case 'heat': if (c.order.includes('dosirak')) { c.wantsHeat = true; this.say(c, ['네, 데워 주세요.', 'calm']); } break;
      case 'thief':
        if (c.stolen && !c.caught) { c.caught = true; this.st.caught++; this.st.handled++; this.rep += 6; this.say(c, TROUBLE.thief.caught[0]); this.addItem(c.stolen); toast(ic('check') + '도난 방지 성공!', 'good'); this.choices([]); }
        else { c.mood -= 15; this.say(c, this.fresh(c, L.notStolen)); }
        break;
      case 'refuse': case 'no': case 'sorry':
        if (c.waitReply === 'haggle') { c.waitReply = null; this.st.handled++; this.say(c, this.fresh(c, TROUBLE.haggle.refused)); this.choices([]); }
        else if (c.waitReply === 'refund') { c.waitReply = null; this.st.handled++; this.say(c, this.fresh(c, TROUBLE.refund.refused)); this.endTx(c, true); }
        else if (c.trouble === 'rude' && !c.handledRude) { c.handledRude = true; this.st.handled++; this.say(c, TROUBLE.rude.polite[0]); }
        else if (c.trouble === 'drunk') this.say(c, T.calm[0]);
        break;
      case 'yes':
        if (c.waitReply === 'haggle') { c.waitReply = null; this.choices([]); this.say(c, this.fresh(c, TROUBLE.haggle.accepted)); this.drawer -= 1000; }
        else if (c.waitReply === 'refund') { c.waitReply = null; this.choices([]); this.st.refund++; this.drawer -= 4900; this.sales -= 4900; this.say(c, ['진작 그럴 것이지.', 'annoyed']); this.endTx(c, true); }
        break;
      case 'calm': c.mood += 6; if (c.trouble === 'rude' && !c.handledRude) { c.handledRude = true; this.st.handled++; this.say(c, TROUBLE.rude.polite[0]); } else if (c.trouble === 'drunk') this.say(c, T.calm[0]); break;
      case 'out': case 'police': this.kickOut(c, intent === 'police'); break;
      case 'rude': c.mood -= 30; this.rep -= 6; this.say(c, c.trouble === 'rude' ? T.rudeBack[0] : this.fresh(c, L.rudeReply)); break;
      case 'bye': case 'total': case 'card': case 'cash': break;
      default: if (Math.random() < 0.5) this.say(c, this.fresh(c, L.what, false));
    }
  }
  kickOut(c, police) {
    if (!c) return;
    this.choices([]);
    if (c.trouble || c.lingering) {
      this.st.handled++; this.rep += 3; c.lingering = false;
      const T = TROUBLE[c.trouble];
      this.say(c, police ? (T?.police?.[0] || ['아 알았어요, 간다고요!', 'angry']) : (T?.out?.[0] || ['아 알았어요.', 'annoyed']));
      if (!c.done) this.endTx(c, false);
    } else { c.mood = 0; this.rep -= 10; this.st.angry++; this.say(c, ['네? 제가 뭘 했다고요? 어이없네.', 'angry']); if (!c.done) this.endTx(c, false); }
  }
  call112() {
    const c = this.cur || this.customers.find(x => x.lingering);
    toast(ic('siren') + '112 신고 접수<br><small>경찰이 출동합니다</small>', '', 2200);
    if (!c) { this.rep -= 3; return; }
    this.wait(4).then(() => { toast(ic('police') + '경찰 도착', 'good'); this.kickOut(c, true); });
  }
  cctv(on) { $('cctv').classList.toggle('alert', on); if (on) this.audio.beep(null, false); if (on && !this.voiceOK) setTimeout(() => this.cur?.stolen && this.choices([['계산 안 하신 거 있으시죠?']]), 3000); }
  // 마이크를 못 쓰는 환경에서만: 그 상황에 맞는 대답 버튼
  choices(list) {
    const el = $('choices'); if (!el) return;
    el.innerHTML = ''; el.classList.toggle('hidden', !list.length);
    for (const [t] of list) { const b = document.createElement('button'); b.textContent = t; b.onclick = () => { this.hear(t); }; el.appendChild(b); }
  }
  offerChoices(c) {
    if (this.voiceOK) return;
    if (c.waitReply === 'haggle') this.choices([['죄송하지만 안 돼요'], ['네, 깎아 드릴게요']]);
    if (c.waitReply === 'refund') this.choices([['죄송하지만 영수증 없으면 안 돼요'], ['네, 환불해 드릴게요']]);
  }
  // ───────── 사장님 ─────────
  async bossScene(kind) {
    const p = new Person(BOSS_TYPE, this.audio); this.boss = p;
    this.bossC = { type: BOSS_TYPE, person: p, voice: BOSS_TYPE.voice, mood: 80, gender: 'm', vIdx: 0 };
    p.root.position.copy(SPOT.bossDoor); this.scene.add(p.root);
    this.audio.play('door', { pos: SPOT.bossDoor, vol: 0.5, rate: 0.8 });
    this.look.turnTo(0.35);
    await p.walk([V3(3.6, 0, -1.6), SPOT.boss]); p.lookAt(SPOT.cam);
    this.bossListening = true;
    const B = this.bossC;
    if (kind === 'intro') {
      const lines = this.day === 1 ? BOSS.intro : [[`${this.day}일차네. 오늘도 잘 부탁해, {name} 씨.`, 'happy'], ['진상 오면 침착하게 하고, 미성년자는 신분증 꼭 확인하고!', 'calm']];
      for (const l of lines) { await this.say(B, l); await this.wait(0.4); }
    } else if (kind === 'visit') {
      const bad = this.st.minor || this.st.angry > 1 || this.rep < 45;
      await this.say(B, pick(BOSS.visit)); await this.wait(0.5);
      await this.say(B, this.st.minor ? BOSS.minor[0] : pick(bad ? BOSS.bad : BOSS.good));
      if (this.st.minor) this.rep -= 5;
      await this.wait(2.5);
    } else { await this.say(B, pick(BOSS.end)); await this.wait(0.5); }
    this.bossListening = false; this.look.turnTo(Math.PI / 2);
    if (kind === 'end') { this.results(); return; }
    await p.walk([V3(3.6, 0, -1.6), SPOT.bossDoor]); this.audio.play('door', { pos: SPOT.bossDoor, vol: 0.5, rate: 0.8 });
    p.dispose(); this.boss = null;
  }
  results() {
    this.running = false;
    const diff = this.drawer - this.expected, st = this.st;
    const score = this.rep - st.minor * 25 - Math.abs(diff) / 1000 * 2 - st.theft / 1000 * 2 + st.handled * 2 + st.bye * 0.5;
    const grade = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'F';
    try { const w = +(localStorage.getItem('ns_wallet') ?? 50000); localStorage.setItem('ns_wallet', String(w + WAGE * 8)); } catch (e) { }
    const best = JSON.parse(localStorage.getItem('ns_best') || '{}');
    try { localStorage.setItem('ns_save', JSON.stringify({ day: this.day + 1, name: this.name })); if (!best.day || this.day > best.day) localStorage.setItem('ns_best', JSON.stringify({ day: this.day, grade })); } catch (e) { }
    const line = (a, b) => `<span>${a}</span><b>${b}</b>`;
    modal(`<h2>${this.day}일차 근무 끝 — 06:00</h2><div class="grade">${grade}</div>
      <div class="res">${line('손님 응대', st.served + '명')}${line('매출', won(this.sales))}${line('시재 (돈통 차이)', (diff >= 0 ? '+' : '') + won(diff))}
      ${line('인사한 손님', st.greet + '명')}${line('배웅 인사', st.bye + '명')}${line('진상 대처', st.handled + '회')}${line('화나서 간 손님', st.angry + '명')}
      ${line('담배 잘못 집음', st.wrongCig + '회')}${line('상품 정리', st.tidy + '개')}${line('도난 피해', won(st.theft))}
      ${line('미성년자 판매', st.minor ? `<span style="color:#ff6b7a">${st.minor}회</span>` : '0회')}${line('평판', stars(this.rep))}${line('오늘 일당 (시급 10,320원 × 8시간)', won(WAGE * 8))}</div>
      <p>${grade === 'F' ? '사장님: "…내일은 좀 더 잘 하자."' : grade === 'S' ? '사장님: "최고야! 정직원 할 생각 없어?"' : '사장님: "수고했어, 내일 봐~"'}</p>`,
      [['메인으로', 'gray', () => this.onExit()], [`${this.day + 1}일차 출근`, 'blue', () => this.onNext(this.day + 1)]]);
    this.boss?.dispose(); this.boss = null;
  }
  stop() {
    this.running = false;
    for (const c of this.customers) c.person.dispose(); this.customers = [];
    this.boss?.dispose(); this.boss = null; this.timers = []; this.tweens = [];
    for (const it of this.items) it.mesh.removeFromParent(); this.items = [];
    for (const m of this.cash) m.removeFromParent(); this.cash = [];
    this.card?.removeFromParent(); this.card = null; this.bagMesh?.removeFromParent(); this.bagMesh = null; this.cur = null; this.queue = []; this.busy = false; this.drawerOpen = false;
    ['idcard', 'cust'].forEach(id => show(id, false)); show('hud', false); this.cctv(false); this.choices([]);
    if (this.hands) for (const s of ['R', 'L']) { this.hands.hold(s, null); this.hands.rest(s); }
  }
  // ───────── 화면 정보 ─────────
  clock() { const m = Math.floor(this.min || 0), h = (22 + Math.floor(m / 60)) % 24; return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  updateHud(force) {
    if (!force && (this._hudT = (this._hudT || 0) + 1) % 10) return;
    $('clock').textContent = this.clock(); $('day').textContent = `${this.day}일차`; $('sales').textContent = won(this.sales); $('rep').innerHTML = stars(this.rep);
  }
  updateHint() {
    const c = this.cur;
    if (this.intro) return hint(`사장님 말씀 듣는 중… (${ic('mic')} 로 "네" 라고 대답해 보세요)`);
    if (this.busy) return hint('');
    if (c && this.mover && this.yawObjDist?.() > 2.4) return hint('손님이 계산대에서 기다려요 — 계산대로 돌아가세요');
    if (!c && this.store.merch.messyCount() > 3 && !this.lastEntered?.greetUntil) return hint(`넘어진 상품 ${this.store.merch.messyCount()}개 — 점을 맞추고 <b>정리하기</b>`);
    if (!c) return hint(this.lastEntered && !this.lastEntered.greeted && this.lastEntered.greetUntil > this.t ? ic('mic') + ' 손님이 들어왔어요! "어서오세요" 라고 말해 보세요' : (this.min >= 480 ? '근무 끝! 마지막 손님을 기다리는 중' : ''));
    if (this.heatPending) return hint('뒤쪽 전자레인지에 점을 맞추고 <b>데우기</b>');
    if (c.waitReply) return hint(ic('mic') + ' 손님 요구에 대답하세요 ("죄송하지만 안 됩니다" 등)');
    if (c.cig && !c.cigGiven) return hint(`${ic('turn')} 뒤돌아서 <b>${c.cig.id}번 ${c.cig.name}</b>에 점을 맞추고 <b>꺼내기</b>`);
    if (this.items.some(i => !i.scanned && !i.refund)) return hint('상품에 점을 맞추고 <b>바코드 찍기</b>');
    if (!c.paid) return hint('계산대에 점을 맞추고 <b>계산하기</b>');
    hint('');
  }
}
