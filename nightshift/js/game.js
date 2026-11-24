// 게임 진행: 손님 흐름, 바코드·포스·돈통·담배·신분증, 진상, 사장님, 음성 대화
import * as THREE from 'three';
import { PRODUCTS, CIGS, TYPES, INTENTS, L, TROUBLE, BOSS, PHRASES } from './data.js';
import { SPOT, productMesh, cigMesh, drawPosScreen, canvasTex } from './store.js';
import { Person } from './people.js';
import { parseWon } from './voice.js';
import { $, won, subtitle, mine, toast, hint, show, modal, stars, ic } from './ui.js';

const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const WAGE = 10320, SHIFT_SEC = 13 * 60, DENOMS = [50000, 10000, 5000, 1000, 500, 100, 50, 10];
const BOSS_TYPE = { id: 'boss', name: '사장님', model: 'man', h: 1.73, top: '#6b5a48', bottom: '#2c2c30', glasses: true, voice: [0.9, 1.0] };

function route(from, to) {
  if (from.x > -0.5 && to.x > -0.5) return [to];
  const pts = [V3(from.x, 0, SPOT.frontZ), V3(to.x, 0, SPOT.frontZ), to];
  return pts.filter((p, i) => i === pts.length - 1 || p.distanceTo(i ? pts[i - 1] : from) > 0.05);
}

export class Game {
  constructor(app) {
    Object.assign(this, app);
    this.timers = []; this.ray = new THREE.Raycaster(); this.customers = []; this.items = []; this.cash = []; this.queue = [];
    this.bindUi();
  }
  // ───────── 시작/끝 ─────────
  start(day, name) {
    this.day = day; this.name = name; this.min = 0; this.t = 0; this.running = true; this.paused = false; this.ending = false;
    this.customers = []; this.queue = []; this.cur = null; this.items = []; this.cash = [];
    this.lines = []; this.recv = ''; this.sel = -1; this.payMode = null; this.tray = []; this.trayGiven = 0;
    this.drawer = 200000; this.expected = 200000; this.sales = 0; this.rep = 60;
    this.st = { served: 0, angry: 0, greet: 0, noGreet: 0, minor: 0, theft: 0, caught: 0, troubles: 0, handled: 0, over: 0, short: 0, wrongCig: 0, refund: 0 };
    this.nextSpawn = 6; this.bossVisitAt = rnd(200, 300); this.bossVisited = false; this.intro = true;
    this.renderPos(); this.updateHud();
    show('hud'); this.store.drawerOpen = 0;
    this.bossScene('intro').then(() => { this.intro = false; });
  }
  wait(s) { return new Promise(r => this.timers.push({ t: s, r })); }
  // ───────── 매 프레임 ─────────
  update(dt) {
    if (!this.running || this.paused) return;
    this.t += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) if ((this.timers[i].t -= dt) <= 0) { const r = this.timers[i].r; this.timers.splice(i, 1); r(); }
    if (!this.intro) this.min = Math.min(480, this.min + dt * 480 / SHIFT_SEC);
    const camW = this.camera.getWorldPosition(this._cw || (this._cw = new THREE.Vector3()));
    for (const c of this.customers) c.person.update(dt, camW);
    this.boss?.update(dt, camW);
    // 손님 등장
    if (!this.intro && this.min < 455 && (this.nextSpawn -= dt) <= 0 && this.customers.length < 3) {
      this.spawn(); this.nextSpawn = rnd(16, 34) * Math.max(0.6, 1 - this.day * 0.06);
    }
    if (!this.intro && !this.bossVisited && this.t > this.bossVisitAt && !this.cur) { this.bossVisited = true; this.bossScene('visit'); }
    if (this.min >= 480 && !this.customers.length && !this.ending && !this.boss) { this.ending = true; this.bossScene('end'); }
    // 문
    const s = this.store; const want = this.doorOpenUntil > this.t ? 1 : 0;
    s.doorAngle += (want - s.doorAngle) * Math.min(1, dt * 5); s.door.rotation.y = -s.doorAngle * 1.3;
    s.drawerOpen += ((this.payMode === 'drawer' ? 1 : 0) - s.drawerOpen) * Math.min(1, dt * 8); s.drawer.position.x = 0.01 + s.drawerOpen * 0.3;
    this.updateHud(); this.updateHint();
  }
  openDoor() { if (!(this.doorOpenUntil > this.t)) this.audio.play('door', { pos: SPOT.doorIn, vol: 0.5 }); this.doorOpenUntil = this.t + 2.2; this.audio.chime(V3(1.1, 2.5, 3.9)); this.audio.setDoorOpen(true); setTimeout(() => this.audio.setDoorOpen(false), 2500); }

  // ───────── 손님 ─────────
  spawn() {
    const trouble = Math.random() < Math.min(0.45, 0.16 + this.day * 0.05) && !this.customers.some(c => c.type.trouble);
    const pool = TYPES.filter(t => trouble ? t.trouble : !t.trouble);
    let type;
    if (trouble) type = pick(pool); else { const tot = pool.reduce((a, t) => a + t.w, 0); let r = Math.random() * tot; type = pool.find(t => (r -= t.w) < 0) || pool[0]; }
    if (this.forceType) { const want = this.forceType.shift(); type = TYPES.find(t => t.id === want) || type; if (!this.forceType.length) this.forceType = null; }
    type = { ...type, bottle: type.id === 'drunk' };
    const p = new Person(type, this.audio);
    const c = { type, person: p, trouble: type.trouble, mood: 70, idle: 0, order: [...pick(type.wants)], voice: type.voice, gender: type.model === 'woman' ? 'f' : 'm', vIdx: 1 + Math.floor(Math.random() * 5) };
    if (type.cig && Math.random() < type.cig) c.cig = pick(CIGS);
    if (c.trouble === 'minor' && !c.cig && Math.random() < 0.5) c.cig = pick(CIGS);
    if (c.trouble === 'refund') c.order = [];
    c.wantsBag = c.order.length >= 2 && Math.random() < 0.55;
    c.wantsHeat = c.order.includes('dosirak') && Math.random() < 0.7;
    c.pay = type.pay === 'throw' ? (Math.random() < 0.5 ? 'card' : 'cash') : (Math.random() < 0.8 ? type.pay : (type.pay === 'card' ? 'cash' : 'card'));
    c.throws = type.pay === 'throw';
    if (this.forceCash) { c.pay = 'cash'; c.cig = c.cig || CIGS[32]; }
    p.root.position.copy(SPOT.street).add(V3(rnd(-2, 2), 0, rnd(-0.3, 0.6)));
    if (Math.random() < 0.5) p.root.position.x = 8 + rnd(0, 2);
    this.scene.add(p.root); this.customers.push(c);
    this.life(c).catch(e => console.error(e));
  }
  async life(c) {
    const p = c.person;
    await p.walk([V3(1.1, 0, 5.6), SPOT.doorOut]);
    this.openDoor(); c.greetUntil = this.t + 7; c.entered = true; this.lastEntered = c;
    await p.walk([SPOT.doorIn]);
    if (c.trouble === 'drunk') this.say(c, pick(TROUBLE.drunk.enter));
    if (c.trouble === 'rude' || c.trouble === 'refund') { await this.wait(0.5); }
    else {
      const stops = c.trouble === 'thief' ? 2 : 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < stops && !c.gone; i++) {
        const fridge = Math.random() < 0.4, ax = pick(SPOT.aisles);
        const tgt = fridge ? V3(rnd(-4, 1.5), 0, SPOT.backZ) : V3(ax, 0, rnd(-1.7, 1.7));
        await p.walk(route(p.root.position, tgt));
        p.lookAt(fridge ? V3(tgt.x, 1, -4) : V3(ax < -3 ? -5 : (ax < -1 ? -3 : -1), 1, tgt.z));
        await this.wait(rnd(1.5, 3.5));
        if (c.trouble === 'thief' && !c.stolen) { c.stolen = pick(['chips', 'choco', 'battery']); this.cctv(true); this.audio.play('bag', { pos: p.root.position, vol: 0.2 }); }
        if (fridge) await p.walk([V3(tgt.x, 0, SPOT.frontZ - 0.3)]);
      }
      if (c.trouble === 'thief' && Math.random() < 0.35) { // 계산 안 하고 그냥 나감
        this.say(c, pick(TROUBLE.thief.escape)); c.escaped = true; return this.leave(c, false);
      }
    }
    if (c.gone) return;
    await this.queueUp(c);
    if (c.gone) return;
    await this.counter(c);
  }
  async queueUp(c) {
    this.queue.push(c);
    for (; ;) {
      if (c.gone) return;
      const i = this.queue.indexOf(c);
      if (i === 0 && !this.cur) { this.queue.shift(); this.cur = c; await c.person.walk(route(c.person.root.position, SPOT.customer)); c.person.lookAt(SPOT.cam); return; }
      const spot = SPOT.queue[Math.min(i, 1)].clone().add(V3(-0.75 * Math.max(0, i - 1), 0, 0));
      if (c.person.root.position.distanceTo(spot) > 0.2 && !c.person.path.length) { await c.person.walk(route(c.person.root.position, spot)); c.person.lookAt(SPOT.customer); }
      await this.wait(0.5);
      c.mood -= 0.25;
    }
  }
  async counter(c) {
    c.atCounter = true; show('cust'); $('cname').textContent = c.type.name;
    await this.wait(0.4);
    // 물건 내려놓기
    c.order.forEach((k, i) => this.addItem(k, null, i));
    if (c.trouble === 'refund') { const it = this.addItem('dosirak', null, 0); it.refund = true; it.mesh.rotation.z = 0.3; }
    c.person.gesture('agree');
    await this.wait(0.5);
    let line;
    const T = TROUBLE[c.trouble];
    const cigTxt = c.cig ? (Math.random() < 0.6 ? `${c.cig.id}번 ${c.cig.name}` : c.cig.name) : '';
    if (T?.counter) line = pick(T.counter).replace('{cig}', cigTxt || '담배');
    else if (c.cig) line = pick([`${cigTxt} 하나 주세요`, `${cigTxt} 한 갑이요`, `계산이요. 그리고 ${cigTxt} 하나요`]);
    else line = pick(['계산해 주세요', '이거요', '계산이요']);
    if (c.trouble === 'rude' && !c.cig) line = '야 이거 계산.';
    this.say(c, line); c.line = line;
    if (c.trouble === 'haggle' || c.trouble === 'refund') c.waitReply = c.trouble;
    // 기다리기
    while (!c.done && !c.gone) { await this.wait(0.25); this.tick(c, 0.25); }
  }
  tick(c, dt) {
    if (this.paused) return;
    const scanned = this.items.length > 0 && this.items.every(i => i.scanned || i.refund) && (!c.cig || c.cigGiven);
    const busy = this.payMode || $('pos').className.indexOf('hidden') < 0;
    c.idle += dt;
    if (c.trouble === 'drunk' && c.idle > 9) { c.idle = 3; this.say(c, pick(TROUBLE.drunk.counter)); }
    if (c.waitReply && c.idle > 10) { c.idle = 2; this.say(c, c.waitReply === 'refund' ? pick(TROUBLE.refund.angry) : pick(TROUBLE.haggle.counter)); c.mood -= 6; }
    if (scanned && !c.offered && !c.waitReply && !c.blocked) {
      c.offered = true;
      if (c.wantsBag && !c.bagAnswered) { c.bagAnswered = true; this.say(c, '봉투 하나 주세요', () => this.offerPay(c)); }
      else this.offerPay(c);
    }
    if (!busy && c.idle > 13 && !c.paid) { c.idle = 5; c.mood -= 10; this.say(c, pick(L.slow)); }
    if (c.mood <= 0 && !c.paid) { this.say(c, pick(L.leaveAngry)); this.rep -= 8; this.st.angry++; c.person.gesture('headShake'); this.endTx(c, false); }
    $('moodbar').style.width = Math.max(0, Math.min(100, c.mood)) + '%';
    $('moodbar').style.background = c.mood > 55 ? '#2fd3b4' : c.mood > 30 ? '#ffb84a' : '#ff4d5e';
    $('cwant').textContent = (c.cig ? `담배 요청: ${c.cig.name}${c.cigGiven ? ' (완료)' : ''} · ` : '') + `상품 ${this.items.filter(i => i.scanned).length}/${this.items.filter(i => !i.refund).length} 스캔`;
  }
  offerPay(c) {
    const total = this.total();
    if (c.pay === 'card') {
      this.putCard(c);
      this.say(c, c.throws ? pick(TROUBLE.rude.pay) : pick(L.card));
      if (c.throws) this.audio.play('whoosh', { pos: SPOT.itemArea, vol: 0.6 });
    } else {
      let give = this.cashFor(total);
      if (c.trouble === 'drunk') { give = Math.max(1000, Math.floor((total - 500) / 1000) * 1000); c.shortMoney = give < total; }
      c.given = give; this.putCash(give, c.throws);
      this.say(c, c.trouble === 'drunk' && c.shortMoney ? TROUBLE.drunk.pay[0] : (c.throws ? '(돈을 던진다) 빨리 해' : pick(L.cash)));
    }
  }
  cashFor(total) { // 손님이 낼 지폐: 보통은 딱 넘는 지폐, 가끔 5만원
    if (Math.random() < 0.12) return 50000;
    const opts = [1000, 5000, 10000, 20000, 50000].filter(v => v >= total);
    if (Math.random() < 0.25) { const exact = Math.ceil(total / 1000) * 1000; if (exact >= total) return exact; }
    return opts[0] || Math.ceil(total / 10000) * 10000;
  }
  async leave(c, good) {
    c.gone = true; c.atCounter = false;
    const i = this.queue.indexOf(c); if (i >= 0) this.queue.splice(i, 1);
    if (this.cur === c) { this.cur = null; show('cust', false); }
    const p = c.person; p.faceTarget = null;
    await p.walk(route(p.root.position, SPOT.doorIn));
    this.openDoor();
    await p.walk([SPOT.doorOut, V3(1.1, 0, 5.8), V3(p.root.position.x < 0 ? -9 : 9, 0, 6)]);
    p.dispose(); this.customers.splice(this.customers.indexOf(c), 1);
    if (c.escaped || (c.stolen && !c.caught)) { this.st.theft += PRODUCTS[c.stolen].price; }
    if (!this.customers.some(x => x.stolen && !x.caught && !x.gone)) this.cctv(false);
  }
  endTx(c, good) {
    c.done = true;
    for (const it of this.items) it.mesh.removeFromParent(); this.items = [];
    for (const m of this.cash) m.removeFromParent(); this.cash = [];
    this.card?.removeFromParent(); this.card = null;
    this.lines = []; this.recv = ''; this.sel = -1; this.payMode = null; this.tray = []; this.trayGiven = 0;
    show('pos', false); show('drawer', false); show('idcard', false);
    this.renderPos();
    if (good) { this.st.served++; this.rep += Math.max(-3, Math.min(4, (c.mood - 50) / 10)); }
    this.rep = Math.max(0, Math.min(100, this.rep));
    // 계산 끝난 뒤 인사 기다리기
    const lingerDrunk = c.trouble === 'drunk' && good && Math.random() < 0.6;
    c.byeWindow = this.t + 4;
    this.wait(lingerDrunk ? 0.2 : 2.2).then(async () => {
      if (lingerDrunk) { c.lingering = true; for (let k = 0; k < 4 && c.lingering; k++) { this.say(c, pick(TROUBLE.drunk.counter)); await this.wait(7); } }
      if (!c.gone) this.leave(c, good);
    });
  }

  // ───────── 계산대 위 물건 ─────────
  addItem(key, cig, i) {
    const mesh = cig ? cigMesh(cig) : productMesh(key); mesh.scale.setScalar(1.25);
    const n = this.items.length, row = n % 3, col = Math.floor(n / 3);
    mesh.position.set(2.42 + row * 0.13, SPOT.counterY, 0.62 + col * 0.2 + rnd(-0.02, 0.02));
    mesh.rotation.y = rnd(-0.6, 0.6);
    if (cig) mesh.rotation.set(-Math.PI / 2, 0, rnd(-1, 1));
    const P = cig ? { name: cig.name, price: cig.price, adult: true } : PRODUCTS[key];
    const it = { mesh, key, cig, name: P.name, price: P.price, adult: !!P.adult, scanned: false };
    mesh.userData.tap = () => this.scanItem(it);
    this.scene.add(mesh); this.items.push(it);
    this.audio.play('thud', { pos: mesh.position, vol: 0.35, rate: 1.6 + Math.random() * 0.4 });
    return it;
  }
  async scanItem(it) {
    const c = this.cur;
    if (it.scanned || this.handBusy) return;
    if (it.refund) { this.say(c, '그거 아까 산 거라니까요. 환불이요!'); return; }
    this.handBusy = true; c && (c.idle = 0);
    const hs = this.hands.sideOf(it.mesh.position);
    await this.hands.reachTo(hs, it.mesh.position);
    await this.wait(0.12);
    this.hands.hold(hs, it.mesh);
    await this.hands.reachTo(hs, SPOT.scanner.clone().add(V3(-0.05, 0.02, 0)));
    await this.wait(0.15);
    this.audio.beep(SPOT.scanner); this.flashScanner();
    it.scanned = true; this.addLine(it.name, it.price, it.key || 'cig', it.adult);
    await this.wait(0.12);
    this.hands.hold(hs, null);
    const n = this.items.filter(x => x.scanned).length;
    it.mesh.position.set(2.5 + (n % 2) * 0.14, SPOT.counterY, 1.95 + Math.floor(n / 2) * 0.03 - 0.3 * (n > 6));
    it.mesh.rotation.set(0, rnd(-1, 1), 0);
    this.scene.add(it.mesh); this.audio.play('thud', { pos: it.mesh.position, vol: 0.3, rate: 1.8 });
    this.hands.rest(hs); this.handBusy = false;
  }
  flashScanner() { const l = this.store.sLight; l.material.color.set(0xffffff); setTimeout(() => l.material.color.set(0xff2020), 120); }
  addLine(name, price, key, adult) {
    const ex = this.lines.find(l => l.name === name);
    ex ? ex.qty++ : this.lines.push({ name, price, key, qty: 1, adult });
    this.renderPos();
  }
  total() { return this.lines.reduce((a, l) => a + l.price * l.qty, 0); }
  putCard(c) {
    const tex = canvasTex('card' + (c.type.id), 128, 80, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, pick(['#1d3b8a', '#111', '#8a1d4a', '#c9a227'])); gr.addColorStop(1, '#444'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#e6c35a'; g.fillRect(14, 28, 22, 16); g.fillStyle = '#fff'; g.font = '700 10px sans-serif'; g.fillText('**** **** **** ' + (1000 + Math.floor(Math.random() * 8999)), 14, 64); });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.054, 0.002, 0.086), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0.2 }));
    m.position.set(c.throws ? 2.62 : 2.45, SPOT.counterY + 0.002, c.throws ? 1.25 : 0.42); m.rotation.y = c.throws ? 1.1 : 0.1;
    m.userData.tap = () => this.payCard();
    this.scene.add(m); this.card = m;
  }
  putCash(amount, messy) {
    let left = amount, i = 0;
    for (const d of DENOMS) while (left >= d && d >= 1000) {
      left -= d;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.07), new THREE.MeshStandardMaterial({ map: this.billTex(d), roughness: 0.8, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 2 + (messy ? rnd(-1.2, 1.2) : rnd(-0.1, 0.1));
      m.position.set(2.45 + (messy ? rnd(-0.05, 0.25) : 0), SPOT.counterY + 0.003 + i * 0.002, 0.42 + (messy ? rnd(-0.2, 0.5) : i * 0.01));
      m.userData.tap = () => this.takeCash(); this.scene.add(m); this.cash.push(m); i++;
    }
    if (left > 0) this.cur.coins = left;
  }
  billTex(d) {
    const col = { 1000: ['#a9c6e8', '#5f88b8'], 5000: ['#f2c39a', '#c97a4a'], 10000: ['#b9dcae', '#6fa25f'], 50000: ['#f5dd8e', '#d0a23b'] }[d];
    return canvasTex('bill' + d, 256, 120, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = 'rgba(0,0,0,.15)'; g.beginPath(); g.ellipse(190, 60, 34, 42, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(0,0,0,.6)'; g.font = '900 34px sans-serif'; g.fillText(d.toLocaleString(), 18, 50); g.font = '700 16px sans-serif'; g.fillText('한국은행', 18, 90); });
  }
  async takeCash() {
    const c = this.cur; if (!c || !this.cash.length || this.handBusy) return;
    this.handBusy = true; c.idle = 0;
    const hs = this.hands.sideOf(this.cash[0].position); this.cashHand = hs;
    await this.hands.reachTo(hs, this.cash[0].position);
    this.audio.play('bill', { pos: this.cash[0].position, vol: 0.8 });
    const stack = new THREE.Group(); for (const m of this.cash) { m.removeFromParent(); m.position.set(0, 0, 0); m.rotation.set(-Math.PI / 2, 0, Math.PI / 2); stack.add(m); }
    this.hands.hold(hs, stack); this.cashTaken = c.given; this.cash = [];
    await this.wait(0.35); this.hands.rest(hs);
    toast(`받은 돈 ${won(c.given)}`, 'good');
    await this.wait(0.3); this.handBusy = false;
  }
  // ───────── 담배 ─────────
  async tapCig(slot) {
    const c = this.cur, cig = slot.userData.cig;
    if (this.handBusy) return;
    if (!c || !c.cig || c.cigGiven) { toast(`${cig.id}번 ${cig.name}`); return; }
    if (cig.id !== c.cig.id) { this.st.wrongCig++; c.mood -= 7; this.say(c, pick(L.wrongCig)); c.person.gesture('headShake'); return; }
    this.handBusy = true;
    await this.hands.reachTo('R', slot.getWorldPosition(V3()));
    const m = cigMesh(cig); this.hands.hold('R', m); m.rotation.set(-Math.PI / 2, 0, 0);
    this.audio.play('bag', { pos: SPOT.cam, vol: 0.3, rate: 1.6, dur: 0.25 });
    await this.wait(0.3); this.hands.hold('R', null); this.hands.rest('R');
    c.cigGiven = true; this.addItem(null, cig); toast('담배를 계산대에 올렸습니다. 바코드를 찍으세요');
    this.look.turnTo(Math.PI / 2); this.handBusy = false;
  }
  // ───────── 포스 ─────────
  bindUi() {
    const keys = $('posKeys');
    ['7', '8', '9', 'C', '4', '5', '6', '00', '1', '2', '3', '0'].forEach(k => { const b = document.createElement('button'); b.textContent = k; b.onclick = () => this.posKey(k); keys.appendChild(b); });
    document.querySelectorAll('.quick button').forEach(b => b.onclick = () => { this.recv = String((+this.recv || 0) + +b.dataset.q); this.click(); this.renderPos(); });
    $('posItems').onclick = e => { const tr = e.target.closest('tr'); if (tr) { this.sel = +tr.dataset.i; this.renderPos(); } };
    $('pCancel').onclick = () => this.posCancel();
    $('pVoid').onclick = () => this.posVoid();
    $('pCash').onclick = () => this.payCash();
    $('pCard').onclick = () => this.payCard();
    $('pAge').onclick = () => this.checkId();
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { show(b.dataset.close, false); this.audio.play('key', { vol: 0.4 }); });
    // 돈통
    const till = $('till');
    DENOMS.forEach(d => { const s = document.createElement('button'); s.className = 'slot'; s.innerHTML = (d >= 1000 ? `<div class="bill b${d}">${d.toLocaleString()}</div>` : `<div class="coin c${d}">${d}</div>`) + `<small>${d.toLocaleString()}원</small>`; s.onclick = () => this.trayAdd(d); till.appendChild(s); });
    $('tray').onclick = e => { const i = e.target.closest('[data-i]'); if (i) { this.tray.splice(+i.dataset.i, 1); this.renderTray(); } };
    $('dReset').onclick = () => { this.tray = []; this.renderTray(); };
    $('dGive').onclick = () => this.giveChange();
    $('idOk').onclick = () => this.idDecision(true);
    $('idNo').onclick = () => this.idDecision(false);
  }
  click() { this.audio.play('key', { vol: 0.5, rate: 1 + Math.random() * 0.1 }); }
  posKey(k) { this.click(); if (k === 'C') this.recv = ''; else if (this.recv.length < 7) this.recv = (this.recv + k).replace(/^0+/, ''); this.renderPos(); }
  renderPos() {
    $('posItems').innerHTML = this.lines.map((l, i) => `<tr data-i="${i}" class="${i === this.sel ? 'sel' : ''}"><td>${l.name}${l.adult ? ' <small style="color:#c00">[19]</small>' : ''}</td><td>${l.qty}</td><td>${(l.price * l.qty).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="3" style="color:#889;text-align:center;padding:18px">상품을 스캔하세요</td></tr>';
    const total = this.total(), recv = +this.recv || 0;
    $('posTotal').textContent = total.toLocaleString(); $('posRecv').textContent = recv.toLocaleString();
    $('posChange').textContent = this.settings.diff === 'hard' ? '직접 계산' : (recv >= total && total ? (recv - total).toLocaleString() : '-');
    drawPosScreen(this.store.posScreenTex, { items: this.lines.map(l => ({ name: l.name, price: l.price * l.qty })), total, clock: this.clock(), msg: this.posMsg || '' });
  }
  posCancel() {
    this.click(); if (this.payMode) return;
    this.lines = []; this.recv = ''; this.sel = -1;
    for (const it of this.items) if (it.scanned) { it.scanned = false; this.items.indexOf(it); }
    this.items.forEach((it, n) => { it.mesh.position.set(2.42 + (n % 3) * 0.13, SPOT.counterY, 0.62 + Math.floor(n / 3) * 0.2); });
    if (this.cur) { this.cur.offered = false; this.cur.blocked = false; }
    this.renderPos();
  }
  posVoid() {
    this.click(); if (this.sel < 0 || this.payMode) return;
    const l = this.lines[this.sel]; l.qty--; if (!l.qty) this.lines.splice(this.sel, 1);
    const it = this.items.find(i => i.scanned && i.name === l.name); if (it) { it.mesh.removeFromParent(); this.items.splice(this.items.indexOf(it), 1); }
    this.sel = -1; this.renderPos();
    const c = this.cur; if (c?.trouble === 'drunk' && c.shortMoney && this.total() <= c.given) { c.shortMoney = false; this.say(c, '어어 그래 그거 빼~ 끅'); c.handled = true; }
  }
  posError(msg) { this.audio.beep(SPOT.pos, false); toast(msg, 'bad', 2000); }
  needIdFirst() { const c = this.cur; return c && this.lines.some(l => l.adult) && !c.idChecked && c.trouble === 'minor'; }
  payCash() {
    const c = this.cur, total = this.total();
    if (!c || !total) return this.posError('결제할 상품이 없습니다');
    if (this.payMode) return;
    if (c.pay === 'card' && this.card) { this.say(c, '카드로 할게요'); return; }
    if (!this.cashTaken) return this.posError('손님이 낸 돈을 먼저 받으세요 (계산대 위 지폐를 누르기)');
    const recv = +this.recv || 0;
    if (recv < total) return this.posError(c.shortMoney && recv >= c.given ? '손님 돈이 모자랍니다!<br><small>포스에서 상품을 골라 선택삭제 하거나, 말로 거절하세요</small>' : '받은 금액이 합계보다 적습니다');
    this.click(); c.idle = 0;
    this.recvEntered = recv; this.changeDue = c.given - total; this.changeShown = recv - total;
    this.drawer += c.given; this.expected += total; this.sales += total; this.cashTaken = 0;
    this.hands.hold(this.cashHand || 'L', null);
    this.audio.play('register', { pos: SPOT.drawer, vol: 0.8 });
    this.payMode = 'drawer'; this.paidMethod = 'cash'; c.paid = true;
    if (this.changeDue <= 0 && this.changeShown <= 0) return this.finishTx();
    show('pos', false); this.tray = []; this.trayGiven = 0; this.renderTray(); show('drawer');
  }
  async payCard() {
    const c = this.cur, total = this.total();
    if (!c || !total) return this.posError('결제할 상품이 없습니다');
    if (this.payMode) return;
    if (c.pay !== 'card') { this.say(c, '아 현금으로 드릴게요'); return; }
    if (!this.card) return this.posError('손님이 아직 카드를 안 냈습니다');
    this.click(); this.payMode = 'card'; this.posMsg = '카드 결제 중…'; this.renderPos();
    show('pos', false);
    const hs = this.hands.sideOf(this.card.position);
    await this.hands.reachTo(hs, this.card.position);
    this.hands.hold(hs, this.card); this.card.rotation.set(0, 0, 0);
    await this.hands.reachTo(hs, SPOT.cardReader.clone().add(V3(0, 0.08, 0)));
    this.store.readerScr.material.color.set(0xffd36b);
    await this.wait(1.4);
    this.audio.beep(SPOT.cardReader); await this.wait(0.15); this.audio.beep(SPOT.cardReader);
    this.store.readerScr.material.color.set(0x7dffb0); this.posMsg = '승인 완료';
    this.sales += total; c.paid = true; this.paidMethod = 'card';
    for (let i = 0; i < 8; i++) this.audio.play('key', { pos: SPOT.pos, vol: 0.25, rate: 0.6, delay: 0.5 + i * 0.06 });
    await this.wait(0.5); this.hands.hold(hs, null); this.card = null; this.hands.rest(hs);
    this.store.readerScr.material.color.set(0x7fd0ff);
    this.finishTx();
  }
  trayAdd(d) { this.tray.push(d); this.renderTray(); d >= 1000 ? this.audio.play('bill', { vol: 0.5, rate: 1.2, dur: 0.4 }) : this.audio.coins(SPOT.drawer); }
  renderTray() {
    const sum = this.tray.reduce((a, b) => a + b, 0);
    $('trayAmt').textContent = won(sum);
    $('tray').innerHTML = this.tray.map((d, i) => d >= 1000 ? `<div class="bill b${d}" data-i="${i}">${d / 1000}천</div>` : `<div class="coin c${d}" data-i="${i}">${d}</div>`).join('');
  }
  giveChange() {
    const c = this.cur; if (!c || this.payMode !== 'drawer') return;
    const sum = this.tray.reduce((a, b) => a + b, 0);
    this.trayGiven += sum; this.drawer -= sum; this.tray = []; this.renderTray();
    this.audio.coins(SPOT.itemArea); this.audio.play('bill', { pos: SPOT.itemArea, vol: 0.5 });
    const due = this.changeDue;
    if (this.trayGiven < due) { this.st.short++; c.mood -= 12; this.say(c, pick(L.shortChange) + ` (${won(due - this.trayGiven)} 더)`); return; }
    if (this.trayGiven > due) { this.st.over++; this.say(c, pick(L.overChange)); }
    else { this.say(c, pick(L.rightChange)); c.mood += 5; }
    show('drawer', false); this.finishTx();
  }
  finishTx() {
    const c = this.cur; if (!c) return;
    this.payMode = null; this.posMsg = '';
    if (c.trouble === 'minor' && this.lines.some(l => l.adult) && !c.refusedSale) {
      this.st.minor++; this.rep -= 30;
      setTimeout(() => toast(ic('warn') + '미성년자에게 술·담배 판매!<br><small>적발되면 영업정지 + 벌금</small>', 'bad', 3500), 2500);
    }
    if (c.wantsHeat) { c.blocked = true; this.say(c, '이거 데워주세요'); this.heatPending = true; this.paidPending = c; toast('전자레인지(뒤쪽 카운터)를 누르세요'); return; }
    this.say(c, c.trouble === 'rude' ? '…' : pick(L.thanks));
    c.person.gesture('agree');
    this.audio.play('bag', { pos: SPOT.bagArea, vol: 0.6 });
    this.endTx(c, true);
  }
  async heat() {
    const c = this.cur; if (!this.heatPending || !c || this.handBusy) return;
    this.heatPending = false; this.handBusy = true;
    const it = this.items.find(i => i.key === 'dosirak');
    if (it) { await this.hands.reachTo('R', it.mesh.position); this.hands.hold('R', it.mesh); }
    this.look.turnTo(-Math.PI / 2 + 0.2);
    await this.hands.reachTo('R', V3(4.25, 1.1, -0.25)); this.hands.hold('R', null); this.hands.rest('R');
    this.audio.play('thud', { pos: V3(4.3, 1.1, -0.25), vol: 0.5 });
    const hum = this.audio.ctx.createOscillator(), g = this.audio.ctx.createGain(); hum.frequency.value = 118; g.gain.value = 0.03; hum.connect(g); g.connect(this.audio.master); hum.start();
    toast('전자레인지 돌리는 중… (1분 30초)'); await this.wait(5); hum.stop();
    this.audio.play('chime', { pos: V3(4.3, 1.1, -0.25), vol: 0.5, rate: 2.2, dur: 0.5 });
    await this.wait(0.4); this.look.turnTo(Math.PI / 2);
    this.say(c, '감사합니다~'); c.mood += 6; this.handBusy = false; c.wantsHeat = false; c.blocked = false;
    this.endTx(c, true);
  }
  // ───────── 신분증 ─────────
  checkId() {
    const c = this.cur; if (!c) return; this.click();
    if (c.idChecked) return;
    c.idChecked = true; c.idle = 0;
    if (c.trouble === 'minor') {
      if (Math.random() < 0.5) { this.say(c, pick(TROUBLE.minor.idAsk)); c.noId = true; c.waitReply = 'minorNoId'; return; }
      this.say(c, pick(TROUBLE.minor.fake)); this.showId(c, 2008 + Math.floor(Math.random() * 3)); return;
    }
    const age = { student: 21, woman: 34, office: 41, night: 29, rider: 33, soldier: 21, drunk: 52, rude: 27, haggle: 55, refund: 38 }[c.type.id] || 30;
    if (age > 35) this.say(c, '허허, 제가 학생으로 보여요? 여기요', () => this.showId(c, 2026 - age));
    else { this.say(c, '아 네, 여기요'); this.showId(c, 2026 - age); }
  }
  showId(c, year) {
    const yy = String(year).slice(2), m = 1 + Math.floor(Math.random() * 12), d = 1 + Math.floor(Math.random() * 28);
    $('idName').textContent = pick(['김', '이', '박', '최', '정']) + pick(['민준', '서연', '도윤', '지우', '하준', '수아', '현우', '지민']);
    $('idNum').textContent = `${yy}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}-${year >= 2000 ? (c.type.model === 'man' ? 3 : 4) : (c.type.model === 'man' ? 1 : 2)}******`;
    $('idAddr').textContent = pick(['서울특별시 마포구 월드컵로', '서울특별시 관악구 신림로', '경기도 수원시 팔달구']);
    c.idYear = year; show('idcard');
  }
  idDecision(sell) {
    const c = this.cur; show('idcard', false); if (!c) return;
    const minor = c.idYear > 2007;
    if (sell) { if (minor) { c.idOkWrong = true; } else this.say(c, '네~'); }
    else if (minor) { this.refuseMinor(c); }
    else { c.mood -= 25; this.say(c, '네? 저 성인인데요? 생년 잘 보세요!'); c.person.gesture('headShake'); }
  }
  refuseMinor(c) {
    c.refusedSale = true; this.st.handled++; this.rep += 5; this.say(c, pick(TROUBLE.minor.refused));
    toast('잘했어요! 미성년자 판매 거절', 'good'); this.endTx(c, false); this.st.served++;
  }
  // ───────── 말하기 / 듣기 ─────────
  say(c, text, after) {
    subtitle(c.type.name, text, c.type.id === 'boss');
    c.person.talk = 1; c.person.smile = c.mood > 70 ? 0.4 : 0;
    return new Promise(r => this.audio.speak(text, { pitch: c.voice[0], rate: c.voice[1], gender: c.gender, idx: c.vIdx }, () => { c.person.talk = 0; after?.(); r(); }));
  }
  hear(text) {
    if (!this.running) return;
    mine(text);
    const intent = (INTENTS.find(([, re]) => re.test(text.replace(/\s+/g, ' '))) || ['none'])[0];
    const c = this.cur;
    // 사장님
    if (this.boss && this.bossListening) { if (intent === 'rude') { this.rep -= 15; this.sayBoss('…지금 뭐라고 했어?'); } else this.sayBoss(pick(['그래그래', '응 수고해', '좋아'])); return; }
    // 방금 들어온 손님 인사
    const le = this.lastEntered;
    if (intent === 'greet' && le && !le.greeted && le.greetUntil > this.t) { le.greeted = true; le.mood += 12; this.st.greet++; this.rep += 1; if (Math.random() < 0.6) this.say(le, pick(L.greetBack)); le.person.gesture('agree'); return; }
    // 계산 끝나고 인사
    const done = this.customers.find(x => x.done && !x.gone && x.byeWindow > this.t - 3);
    if (intent === 'bye' && done && !done.byeSaid) { done.byeSaid = true; this.rep += 1; if (done.lingering) { done.lingering = false; this.say(done, '어어 그래~ 수고해~'); } return; }
    if (!c) { if (done?.lingering && (intent === 'out' || intent === 'police')) return this.kickOut(done); return; }
    c.idle = 0;
    const T = TROUBLE[c.trouble];
    switch (intent) {
      case 'greet': if (!c.greeted) { c.greeted = true; c.mood += 6; this.say(c, pick(L.greetBack)); } else this.say(c, '네…'); break;
      case 'bagask': c.bagAnswered = true; this.say(c, pick(c.wantsBag ? L.bagYes : L.bagNo)); if (c.wantsBag) hint(ic('bag') + ' 봉투 버튼을 누르세요'); break;
      case 'point': this.say(c, pick(Math.random() < 0.2 ? L.pointYes : L.pointNo)); c.mood += 2; break;
      case 'receipt': this.say(c, pick(Math.random() < 0.3 ? L.receiptYes : L.receiptNo)); c.mood += 2; break;
      case 'id': this.checkId(); break;
      case 'heat': if (c.order.includes('dosirak')) { c.wantsHeat = true; this.say(c, '네 데워주세요'); } else this.say(c, pick(L.what)); break;
      case 'thief':
        if (c.stolen && !c.caught) { c.caught = true; this.st.caught++; this.st.handled++; this.rep += 6; this.say(c, TROUBLE.thief.caught[0]); this.addItem(c.stolen); c.offered = false; toast('도난 방지 성공!', 'good'); }
        else { c.mood -= 15; this.say(c, '네? 저 아무것도 안 가져갔는데요?'); c.person.gesture('headShake'); }
        break;
      case 'card': case 'cash': this.say(c, c.pay === 'card' ? pick(L.card) : pick(L.cash)); break;
      case 'total': {
        const n = parseWon(text), tot = this.total();
        if (n && tot && n === tot) { c.mood += 4; this.say(c, '네~'); } else if (n && tot) this.say(c, `네? ${won(n)}이요? 포스엔 ${won(tot)}인데…`); else this.say(c, pick(L.what));
        break;
      }
      case 'refuse': case 'no':
        if (c.waitReply === 'haggle') { c.waitReply = null; this.st.handled++; this.say(c, pick(TROUBLE.haggle.refused)); c.mood -= 3; }
        else if (c.waitReply === 'refund') { c.waitReply = null; this.st.handled++; this.say(c, pick(TROUBLE.refund.refused)); this.endTx(c, true); }
        else if (c.trouble === 'minor' && (c.noId || c.idYear > 2007)) this.refuseMinor(c);
        else if (c.trouble === 'drunk' && c.shortMoney) { this.say(c, '아 쫌~ 깎아주라~ 끅'); }
        else this.say(c, pick(L.what));
        break;
      case 'yes':
        if (c.waitReply === 'haggle') { c.waitReply = null; this.say(c, '어머 고마워라~ 천 원 뺄게~'); c.given && (c.given -= 1000); this.expected += 0; this.drawer -= 1000; this.st.over++; }
        else if (c.waitReply === 'refund') { c.waitReply = null; this.st.refund++; this.drawer -= 4900; this.sales -= 4900; this.say(c, '진작 그럴 것이지'); this.endTx(c, true); }
        else this.say(c, '네~');
        break;
      case 'sorry': case 'calm':
        c.mood += 6;
        if (c.trouble === 'rude' && !c.handledRude) { c.handledRude = true; this.st.handled++; this.say(c, T.polite[0]); }
        else if (c.trouble === 'drunk') this.say(c, T.calm[0]);
        else if (c.waitReply === 'haggle') { c.waitReply = null; this.say(c, pick(TROUBLE.haggle.sorry)); }
        else if (c.waitReply === 'refund') { c.waitReply = null; this.st.handled++; this.say(c, pick(TROUBLE.refund.refused)); this.endTx(c, true); }
        else this.say(c, '아 괜찮아요');
        break;
      case 'out': case 'police': this.kickOut(c, intent === 'police'); break;
      case 'bye': this.say(c, c.paid ? '네~' : '아직 계산 안 했는데요?'); break;
      case 'rude': c.mood -= 30; this.rep -= 6; this.say(c, c.trouble === 'rude' ? T.rudeBack[0] : pick(L.rudeReply)); c.person.gesture('headShake'); break;
      default: this.say(c, pick(L.what));
    }
  }
  kickOut(c, police) {
    if (!c) return;
    if (c.trouble || c.lingering) {
      this.st.handled++; this.rep += 3; c.lingering = false;
      const T = TROUBLE[c.trouble];
      this.say(c, police ? (T?.police?.[0] || '아 알았어요 간다고요!') : (T?.out?.[0] || '아 알았어요!'));
      if (!c.done) this.endTx(c, false);
    } else { c.mood = 0; this.rep -= 10; this.st.angry++; this.say(c, '네? 제가 뭘 했다고요? 어이없네'); if (!c.done) this.endTx(c, false); }
  }
  call112() {
    const c = this.cur || this.customers.find(x => x.lingering);
    toast(ic('siren') + '112 신고 접수<br><small>경찰이 출동합니다</small>', '', 2200);
    if (!c) { this.rep -= 3; return; }
    this.wait(4).then(() => { toast(ic('police') + '경찰 도착', 'good'); this.kickOut(c, true); });
  }
  bagBtn() {
    const c = this.cur; if (!c) return;
    if (c.paid) { toast('봉투를 드렸습니다'); this.audio.play('bag', { pos: SPOT.bagArea, vol: 0.7 }); c.wantsBag = false; return; }
    this.addLine('봉투(유상)', 100, 'bag', false); this.audio.play('bag', { pos: SPOT.bagArea, vol: 0.7 });
    if (!c.wantsBag) { c.mood -= 3; this.say(c, '봉투 필요 없는데요?'); this.lines.pop(); this.renderPos(); }
    else c.wantsBag = false;
  }
  cctv(on) { $('cctv').classList.toggle('alert', on); if (on) this.audio.beep(null, false); }
  // ───────── 사장님 ─────────
  sayBoss(text) { return this.boss ? this.say(this.bossC, text) : Promise.resolve(); }
  async bossScene(kind) {
    const p = new Person(BOSS_TYPE, this.audio); this.boss = p;
    this.bossC = { type: BOSS_TYPE, person: p, voice: BOSS_TYPE.voice, mood: 80, gender: 'm', vIdx: 0 };
    p.root.position.copy(SPOT.bossDoor); this.scene.add(p.root);
    this.audio.play('door', { pos: SPOT.bossDoor, vol: 0.5, rate: 0.8 });
    const prevYaw = this.look.yaw; this.look.turnTo(0.35);
    await p.walk([V3(3.6, 0, -1.6), SPOT.boss]); p.lookAt(SPOT.cam);
    this.bossListening = true;
    const fill = s => s.replace('{name}', this.name);
    if (kind === 'intro') {
      const lines = this.day === 1 ? BOSS.intro : [`${this.day}일차네. 오늘도 잘 부탁해 ${this.name} 씨.`, '진상 오면 침착하게. 미성년자 신분증 꼭 확인하고!'];
      for (const l of lines) { await this.say(this.bossC, fill(l)); await this.wait(0.5); }
    } else if (kind === 'visit') {
      const bad = this.st.minor || this.st.short + this.st.over > 1 || this.rep < 45;
      await this.say(this.bossC, pick(BOSS.visit)); await this.wait(0.6);
      await this.say(this.bossC, fill(this.st.minor ? BOSS.minor[0] : pick(bad ? BOSS.bad : BOSS.good)));
      if (this.st.minor) this.rep -= 5;
      await this.wait(3);
    } else {
      await this.say(this.bossC, pick(BOSS.end)); await this.wait(0.5);
    }
    this.bossListening = false; this.look.turnTo(Math.PI / 2);
    if (kind === 'end') { this.results(); return; }
    await p.walk([V3(3.6, 0, -1.6), SPOT.bossDoor]); this.audio.play('door', { pos: SPOT.bossDoor, vol: 0.5, rate: 0.8 });
    p.dispose(); this.boss = null;
  }
  results() {
    this.running = false;
    const diff = this.drawer - this.expected, st = this.st;
    let score = this.rep - st.minor * 25 - Math.abs(diff) / 1000 * 2 - st.theft / 1000 * 2 + st.handled * 2;
    const grade = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'F';
    const pay = WAGE * 8;
    const best = JSON.parse(localStorage.getItem('ns_best') || '{}');
    try { localStorage.setItem('ns_save', JSON.stringify({ day: this.day + 1, name: this.name })); if (!best.day || this.day > best.day) localStorage.setItem('ns_best', JSON.stringify({ day: this.day, grade })); } catch (e) { }
    const line = (a, b) => `<span>${a}</span><b>${b}</b>`;
    modal(`<h2>${this.day}일차 근무 끝 — 06:00</h2><div class="grade">${grade}</div>
      <div class="res">${line('손님 응대', st.served + '명')}${line('매출', won(this.sales))}${line('시재 (돈통 차이)', (diff >= 0 ? '+' : '') + won(diff))}
      ${line('인사한 손님', st.greet + '명')}${line('진상 대처', st.handled + '회')}${line('화나서 간 손님', st.angry + '명')}
      ${line('거스름돈 실수', (st.short + st.over) + '회')}${line('담배 잘못 집음', st.wrongCig + '회')}${line('도난 피해', won(st.theft))}
      ${line('미성년자 판매', st.minor ? `<span style="color:#ff6b7a">${st.minor}회</span>` : '0회')}${line('평판', stars(this.rep))}${line('오늘 일당 (시급 10,320원 × 8시간)', won(pay))}</div>
      <p>${grade === 'F' ? '사장님: "…내일은 좀 더 잘 하자."' : grade === 'S' ? '사장님: "최고야! 정직원 할 생각 없어?"' : '사장님: "수고했어, 내일 봐~"'}</p>`,
      [['메인으로', 'gray', () => this.onExit()], [`${this.day + 1}일차 출근`, 'blue', () => this.onNext(this.day + 1)]]);
    this.boss?.dispose(); this.boss = null;
  }
  stop() {
    this.running = false;
    for (const c of this.customers) c.person.dispose(); this.customers = [];
    this.boss?.dispose(); this.boss = null; this.timers = [];
    for (const it of this.items) it.mesh.removeFromParent(); this.items = [];
    for (const m of this.cash) m.removeFromParent(); this.cash = [];
    this.card?.removeFromParent(); this.card = null; this.cur = null; this.queue = [];
    ['pos', 'drawer', 'idcard', 'talk', 'cust'].forEach(id => show(id, false)); show('hud', false); this.cctv(false);
  }
  // ───────── 화면 정보 ─────────
  clock() { const m = Math.floor(this.min || 0), h = (22 + Math.floor(m / 60)) % 24; return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  updateHud() {
    if ((this._hudT = (this._hudT || 0) + 1) % 10) return;
    $('clock').textContent = this.clock(); $('day').textContent = `${this.day}일차`; $('sales').textContent = won(this.sales); $('rep').innerHTML = stars(this.rep);
    $('posTime').textContent = this.clock();
  }
  updateHint() {
    const c = this.cur;
    if (this.intro) return hint(`사장님 말씀 듣는 중… (${ic('mic')} 로 "네" 라고 대답해 보세요)`);
    if (!c) return hint(this.lastEntered && !this.lastEntered.greeted && this.lastEntered.greetUntil > this.t ? ic('mic') + ' 손님이 들어왔어요! "어서오세요" 라고 말해보세요' : (this.min >= 480 ? '근무 끝! 마지막 손님을 기다리는 중' : ''));
    if (c.waitReply === 'minorNoId') return hint('신분증이 없다고 합니다 → "죄송하지만 안 됩니다"');
    if (c.waitReply) return hint(ic('mic') + ' 손님 요구에 대답하세요 ("죄송하지만 안 됩니다" 등)');
    if (this.heatPending) return hint('뒤쪽 카운터의 전자레인지를 누르세요');
    if (c.cig && !c.cigGiven) return hint(`${ic('turn')} 뒤돌아서 ${c.cig.name} 담배를 누르세요`);
    if (this.items.some(i => !i.scanned && !i.refund)) return hint('계산대 위 상품을 눌러 바코드를 찍으세요');
    if (this.payMode === 'drawer') return hint(`${ic('cash')} 돈통에서 거스름돈을 집어 건네세요`);
    if (this.cash.length) return hint('계산대 위 지폐를 눌러 돈을 받으세요');
    if (this.cashTaken) return hint(ic('pos') + ' 포스: 받은 금액 입력 → 현금결제');
    if (this.card) return hint(ic('pos') + ' 포스에서 카드결제를 누르세요');
    hint('');
  }
}
