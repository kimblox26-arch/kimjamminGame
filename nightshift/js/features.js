// 추가 기능 모음: 날씨(비·천둥·번개), 새벽 하늘, 바닥 청소(쏟은 음료), 택배 접수, ATM 입출금, 컵라면 먹기, 사진 모드(갤러리), 통계·업적
import * as THREE from 'three';
import { $, modal, ic } from './ui.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), won = n => Math.round(n).toLocaleString() + '원';
const ACH = [
  ['first', '첫 손님', s => s.served >= 1], ['ten', '단골 만들기 (손님 10명)', s => s.served >= 10], ['clean', '깔끔쟁이 (바닥 5번 닦기)', s => s.cleaned >= 5],
  ['rider', '배달의 달인 (배달 5건)', s => s.deliveries >= 5], ['taxi', '모범 택시 (손님 3명)', s => s.taxi >= 3], ['noodle', '야식 마니아 (컵라면 3개)', s => s.noodles >= 3],
  ['photo', '사진작가 (사진 5장)', s => s.photos >= 5], ['rain', '비 오는 밤', s => s.rainNights >= 1], ['escape', '쇼생크 탈출', s => s.escapes >= 1], ['rich', '부자 (지갑 50만원)', s => s.richest >= 500000],
];
export class Features {
  constructor(app) {
    Object.assign(this, app); this.rain = false; this.wxT = 60 + Math.random() * 120; this.thT = 20; this.gallery = [];
    try { this.stats = JSON.parse(localStorage.getItem('ns_stats') || '{}'); } catch (e) { this.stats = {}; }
    // ── 비: 카메라 주변 빗줄기(선) 1400개 ──
    const N = 1400, pos = new Float32Array(N * 6); this.drops = Array.from({ length: N }, () => V3((Math.random() - 0.5) * 36, Math.random() * 22, (Math.random() - 0.5) * 36));
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xa8bccd, transparent: true, opacity: 0.32, depthWrite: false, fog: true }));
    this.rainMesh.frustumCulled = false; this.rainMesh.visible = false; this.scene.add(this.rainMesh);
    // ── 쏟은 음료 (매장 바닥) ──
    this.spillTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); for (let i = 0; i < 9; i++) { const x = 64 + (Math.random() - 0.5) * 50, y = 64 + (Math.random() - 0.5) * 50, r = 14 + Math.random() * 26; const gr = g.createRadialGradient(x, y, 2, x, y, r); gr.addColorStop(0, 'rgba(120,70,25,.75)'); gr.addColorStop(0.8, 'rgba(110,60,20,.55)'); gr.addColorStop(1, 'rgba(110,60,20,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } return new THREE.CanvasTexture(c); })();
    this.spills = []; this.spillT = 90 + Math.random() * 60;
    // ── ATM · 컵라면(온수기) 조준 상자 ──
    const hit = (aim, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial()); m.visible = false; m.position.set(x, y, z); m.userData.aim = aim; this.scene.add(m); return m; };
    this.hits = [hit('atm', -4.4, 1.2, 3.45, 0.8, 1.6, 0.7), hit('noodle', -2.9, 1.05, 3.62, 1.5, 0.5, 0.45)];
    this.bank = +(localStorage.getItem('ns_bank') ?? 300000);
  }
  stat(k, n = 1) { this.stats[k] = (this.stats[k] || 0) + n; const w = this.missions.money(0); this.stats.richest = Math.max(this.stats.richest || 0, w); try { localStorage.setItem('ns_stats', JSON.stringify(this.stats)); } catch (e) { } }
  aimTargets() { return [...this.hits, ...this.spills.map(s => s.hit)]; }
  label(t) { return { atm: 'ATM · 입출금', noodle: '컵라면 먹기 (1,500원)', spill: '쏟은 음료 · 닦기' }[t]; }
  act(a) {
    if (a.type === 'atm') return this.atm(); if (a.type === 'noodle') return this.noodle(); if (a.type === 'spill') return this.clean(a.obj);
  }
  // ── 날씨 ──
  setRain(on) {
    if (this.rain === on) return; this.rain = on; this.rainMesh.visible = on;
    if (on) { this.rainSnd = this.audio.play('rain', { loop: true, vol: 0 }); this.rainIn = this.audio.play('rain_in', { loop: true, vol: 0 }); this.stat('rainNights'); }
    else { this.rainSnd?.stop?.(); this.rainIn?.stop?.(); this.rainSnd = this.rainIn = null; }
  }
  update(dt, indoor) {
    const cam = this.camera.getWorldPosition(V3());
    // 날씨 바뀜 (몇 분마다)
    if ((this.wxT -= dt) < 0) { this.wxT = 150 + Math.random() * 240; this.setRain(!this.rain && Math.random() < 0.65); }
    if (this.rain) {
      const a = this.rainMesh.geometry.attributes.position, p = a.array, wind = 0.12;
      this.rainMesh.visible = !indoor;
      if (!indoor) for (let i = 0; i < this.drops.length; i++) {
        const d = this.drops[i]; d.y -= dt * 13; d.x += dt * 13 * wind; if (d.y < -2) { d.y = 20; d.x = (Math.random() - 0.5) * 36; d.z = (Math.random() - 0.5) * 36; }
        const x = cam.x + d.x, y = cam.y + d.y - 6, z = cam.z + d.z; p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z; p[i * 6 + 3] = x - wind * 0.5; p[i * 6 + 4] = y + 0.5; p[i * 6 + 5] = z;
      }
      a.needsUpdate = true;
      if (this.rainSnd?.gain) this.rainSnd.gain.gain.value += ((indoor ? 0 : 0.9) - this.rainSnd.gain.gain.value) * Math.min(1, dt * 2);
      if (this.rainIn?.gain) this.rainIn.gain.gain.value += ((indoor ? 0.7 : 0) - this.rainIn.gain.gain.value) * Math.min(1, dt * 2);
      // 천둥·번개: 하늘이 번쩍 → 몇 초 뒤 우르릉
      if ((this.thT -= dt) < 0) { this.thT = 25 + Math.random() * 40; const near = Math.random() < 0.35; this.flash = near ? 0.35 : 0.2; this.audio.play(near ? 'thunder' : 'thunder_far', { vol: near ? 1 : 0.8, delay: near ? 0.6 : 2.5 }); }
    }
    if (this.flash > 0) { this.flash -= dt; const k = this.flash > 0.12 ? 3.5 : this.flash > 0.08 ? 0.6 : this.flash > 0 ? 2.2 : 0; this.flashK = k; } else this.flashK = 0;
    // 새벽: 05시부터 하늘이 밝아짐 (근무 끝 06시)
    const m = this.game.min || 0, dawn = Math.min(1, Math.max(0, (m - 390) / 90));
    if (this.skyMat) this.skyMat.uniforms.uDawn.value = dawn;
    this.dawn = dawn;
    // 손님이 음료를 쏟음 (가끔)
    // 통계: 계산한 손님 수, 걸은·운전 거리
    if (this.game.st.served !== this.lastServed) { if (this.lastServed !== undefined && this.game.st.served > this.lastServed) this.stat('served', this.game.st.served - this.lastServed); this.lastServed = this.game.st.served; }
    const me = this.yawObj.position; if (this.lastP) { const d = Math.hypot(me.x - this.lastP.x, me.z - this.lastP.z); if (d < 5) { this.distAcc = (this.distAcc || 0) + d; if (this.distAcc > 20) { this.stat(this.drive?.ride ? 'driven' : 'walked', this.distAcc); this.distAcc = 0; } } } this.lastP = me.clone();
    if (this.game.running && !this.game.violence && (this.spillT -= dt) < 0) { this.spillT = 120 + Math.random() * 120; if (this.spills.length < 3) this.addSpill(); }
  }
  addSpill() {
    const spots = [[-2, -1.2], [-2, 1.4], [0.3, -0.6], [0.4, 2.0], [-3.9, 0.3], [1.6, 3.0]], [x, z] = spots[Math.random() * spots.length | 0];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: this.spillTex, transparent: true, depthWrite: false, roughness: 0.05, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6; m.position.set(x, 0.012, z); this.scene.add(m);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.9), new THREE.MeshBasicMaterial()); hit.visible = false; hit.position.set(x, 0.04, z); hit.userData.aim = 'spill'; this.scene.add(hit);
    const s = { m, hit }; hit.userData.spill = s; this.spills.push(s); this.audio.play('bag', { pos: m.position, vol: 0.4, rate: 0.5 });
  }
  // 대걸레로 닦기: 손에 대걸레 → 바닥을 몇 번 문지름(찍찍 소리) → 얼룩이 점점 옅어짐
  async clean(hitObj) {
    const s = hitObj?.userData?.spill || this.spills[0]; if (!s || s.busy) return; s.busy = true;
    const H = this.hands, mop = new THREE.Group(), stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2e })); stick.position.y = -0.4; mop.add(stick);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1 })); head.position.y = -1.0; mop.add(head);
    H.hold('R', mop); this.audio.play('bag', { vol: 0.5, rate: 0.6 });
    for (let i = 0; i < 4; i++) { const p = s.m.position.clone().add(V3((i % 2 ? 0.25 : -0.25), 0.5, (i % 2 ? -0.1 : 0.15))); await H.reachTo('R', p, 'grip', 'front', 320); this.audio.play('bag', { pos: s.m.position, vol: 0.35, rate: 2.2 + Math.random() * 0.4 }); s.m.material.opacity = Math.max(0, 1 - (i + 1) / 4); }
    H.hold('R', null); H.rest('R'); s.m.removeFromParent(); s.hit.removeFromParent(); this.spills.splice(this.spills.indexOf(s), 1); this.game.st.tidy = (this.game.st.tidy || 0) + 1; this.stat('cleaned');
  }
  // ATM: 은행 잔고 ↔ 지갑 (밤 수수료 1,300원)
  atm() {
    const w = this.missions.money(0), save = () => { try { localStorage.setItem('ns_bank', String(this.bank)); } catch (e) { } };
    const out = n => { if (this.bank < n + 1300) return; this.bank -= n + 1300; save(); this.missions.money(n); this.audio.play('bill', { vol: 0.8 }); this.audio.play('register', { vol: 0.3, rate: 1.4 }); setTimeout(() => this.atm(), 400); };
    modal(`<h2>${ic('cash')} 달빛은행 ATM</h2><p>통장 잔고 <b>${won(this.bank)}</b><br>지갑 <b>${won(w)}</b></p><p style="color:#8a97a6;font-size:13px">야간(22시~06시) 출금 수수료 1,300원</p>`,
      [['1만원 출금', 'blue', () => out(10000)], ['5만원 출금', 'blue', () => out(50000)], ['지갑 돈 전부 입금', 'gray', () => { const m = this.missions.money(0); if (m <= 0) return; this.missions.money(-m); this.bank += m; save(); this.audio.play('bill', { vol: 0.8, rate: 0.9 }); setTimeout(() => this.atm(), 400); }], ['닫기', 'gray', () => { }]]);
  }
  // 컵라면: 온수 붓고(소리) → 3분 대신 몇 초 → 후루룩 (체력 회복)
  async noodle() {
    if (this.busy) return; if (this.missions.money(0) < 1500) return;
    this.busy = true; this.missions.money(-1500); this.game.sales = (this.game.sales || 0) + 1500;
    const cup = this.productMesh?.('ramen') || new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0xc21a1a }));
    this.hands.hold('R', cup); await this.hands.reachTo('R', V3(-2.9, 1.0, 3.55), 'grip', 'front', 500);
    this.audio.play('engine', { vol: 0.25, rate: 2.4, dur: 2.2 }); await new Promise(r => setTimeout(r, 2400));
    this.hands.raise('R', V3(0.05, -0.12, -0.3), 'grip'); for (let i = 0; i < 4; i++) { this.audio.play('bag', { vol: 0.3, rate: 3 + Math.random() }); await new Promise(r => setTimeout(r, 450)); }
    this.crime.hp = Math.min(100, (this.crime.hp || 100) + 40); this.crime.hpHud?.(); this.hands.hold('R', null); this.hands.rest('R'); this.busy = false; this.stat('noodles');
  }
  // ── 사진 모드: 화면 장식 숨기고 찍기(번쩍·찰칵) → 휴대폰 갤러리 ──
  photoMode() {
    document.body.classList.add('photo'); const b = document.createElement('div'); b.id = 'photoUI'; b.innerHTML = '<button id="shutter">●</button><button id="photoX">닫기</button>'; document.body.appendChild(b);
    $('shutter').onclick = () => { this.render(); const url = this.renderer.domElement.toDataURL('image/jpeg', 0.85); this.gallery.unshift(url); this.gallery.length = Math.min(12, this.gallery.length); this.audio.play('key', { vol: 1, rate: 1.8 }); const f = $('fade'); f.classList.add('flash'); setTimeout(() => f.classList.remove('flash'), 120); this.stat('photos'); };
    $('photoX').onclick = () => { document.body.classList.remove('photo'); b.remove(); };
  }
  galleryView() { modal(`<h2>갤러리</h2>${this.gallery.length ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${this.gallery.map(u => `<img src="${u}" style="width:100%;border-radius:6px">`).join('')}</div>` : '<p>아직 찍은 사진이 없어요. 휴대폰 → 카메라</p>'}`, [['닫기', 'gray', () => { }]]); }
  statsView() {
    const s = this.stats, row = (k, v) => `<div class="opt"><span>${k}</span><b>${v}</b></div>`;
    modal(`<h2>통계 · 업적</h2>${row('계산한 손님', (s.served || 0) + '명')}${row('배달', (s.deliveries || 0) + '건')}${row('택시 손님', (s.taxi || 0) + '명')}${row('바닥 청소', (s.cleaned || 0) + '번')}${row('컵라면', (s.noodles || 0) + '개')}${row('사진', (s.photos || 0) + '장')}${row('운전 거리', ((s.driven || 0) / 1000).toFixed(1) + 'km')}${row('걸은 거리', ((s.walked || 0) / 1000).toFixed(1) + 'km')}
      <h3 style="margin:10px 0 4px">업적</h3>${ACH.map(([id, name, f]) => `<div class="opt"><span>${name}</span><b style="color:${f(s) ? '#2fd3b4' : '#6b7785'}">${f(s) ? '달성' : '미달성'}</b></div>`).join('')}`, [['닫기', 'gray', () => { }]]);
  }
}
