// HUD: 조준선, 탄약, 체력, 히트마커, 피격 방향, 킬피드, 나침반, 웨이브 정보
import * as THREE from 'three';
import { clamp } from './core.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.g = game;
    this.el = {
      root: $('hud'), cross: $('crosshair'), hit: $('hitmarker'), hp: $('hp-fill'), hpTxt: $('hp-text'), ammo: $('ammo-mag'), res: $('ammo-res'),
      wname: $('w-name'), wcal: $('w-cal'), wmode: $('w-mode'), rounds: $('rounds'), feed: $('killfeed'), dmg: $('dmg-ind'),
      wave: $('wave-num'), left: $('enemies-left'), score: $('score'), msg: $('center-msg'), prompt: $('prompt'), compass: $('compass-strip'),
      slots: $('slots'), fps: $('fps'), breath: $('breath'), lowAmmo: $('low-ammo'), clock: $('clock'), ptsBox: $('pts-feed'), ptsTotal: $('pts-total'),
    };
    this.hitT = 0; this.msgT = 0; this.slotT = 0;
    this.buildCompass();
    this.buildSlots();
  }

  buildCompass() {
    const s = this.el.compass; s.innerHTML = '';
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let rep = -1; rep <= 1; rep++) for (let d = 0; d < 360; d += 15) {
      const e = document.createElement('span');
      e.className = names[d] ? 'cmaj' : 'cmin';
      e.textContent = names[d] || (d % 45 === 0 ? '' : '·');
      if (!names[d]) e.textContent = d;
      e.style.left = ((d + rep * 360) * 4) + 'px';
      s.appendChild(e);
    }
  }

  buildSlots() {
    const W = this.g.weapons, c = W.ex ? W.ex.count : { frag: 0, smoke: 0, c4: 0 }, pl = W.ex ? W.ex.placed.length : 0;
    const names = [W.list[W.loadout[0]].def.name, W.list[W.loadout[1]].def.name, `파편 수류탄 ×${c.frag}`, `연막탄 ×${c.smoke}`, `C4 ×${c.c4}${pl ? ` (설치 ${pl})` : ''}`];
    this.el.slots.innerHTML = names.map((n, i) => `<div class="slot" data-i="${i}"><b>${i + 1}</b> ${n}</div>`).join('');
  }

  weapon(w) {
    this.el.wname.textContent = w.def.name;
    this.el.wcal.textContent = w.def.cal;
    this.ammo(w);
    this.slotT = 2.5;
    this.buildSlots();
    const Wi = this.g.weapons.list.indexOf(w), L = this.g.weapons.loadout;
    [...this.el.slots.children].forEach((c, i) => c.classList.toggle('on', i < 2 && L[i] === Wi));
    this.el.slots.classList.add('show');
  }

  ammo(w) {
    const d = w.def;
    this.el.ammo.textContent = w.ammo;
    this.el.res.textContent = this.g.mode === 'training' ? '∞' : w.reserve;
    this.el.wmode.textContent = d.modes[w.mode];
    const low = w.ammo <= Math.ceil(d.mag * 0.25);
    this.el.ammo.classList.toggle('low', low);
    // 탄 아이콘
    const n = Math.min(d.mag + 1, 31);
    if (this._rn !== n || this._ra !== w.ammo) {
      this._rn = n; this._ra = w.ammo;
      let h = '';
      for (let i = 0; i < n; i++) h += `<i class="${i < w.ammo ? 'f' : ''} ${d.id}"></i>`;
      this.el.rounds.innerHTML = h;
    }
    this.el.lowAmmo.style.opacity = low && w.reserve === 0 && w.ammo === 0 ? 1 : 0;
  }

  hitmarker(kill, head) {
    const h = this.el.hit;
    h.className = 'show' + (kill ? ' kill' : '') + (head ? ' head' : '');
    void h.offsetWidth;
    this.hitT = kill ? 0.45 : 0.22;
  }

  damage(from, p, amount) {
    // 화면 가장자리 피 튐 (맞은 방향 쪽 더 진하게)
    this.bloodT = Math.min(1, (this.bloodT || 0) + amount / 45);
    if (!this.bloodCv) this.bloodCv = this.makeSplatter();
    if (!from) return;
    const d = document.createElement('div');
    d.className = 'dmg-arc';
    const a = Math.atan2(from.x - p.pos.x, from.z - p.pos.z);
    d.dataset.a = a;
    this.el.dmg.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }

  kill(name, weapon, head, squad = false) {
    const e = document.createElement('div');
    e.className = 'kf';
    e.innerHTML = `<span class="me">${squad ? '분대' : (this.g.profile?.nick || 'YOU')}</span> <span class="wp">[${weapon}]</span> <span class="en">${name}</span>${head ? ' <span class="hs">◉ HEADSHOT</span>' : ''}`;
    this.el.feed.prepend(e);
    setTimeout(() => e.classList.add('fade'), 4000);
    setTimeout(() => e.remove(), 4800);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
  }

  // 무작위 핏방울 얼룩 캔버스 (가장자리 위주) → 화면 오버레이 배경
  makeSplatter() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 576;
    const x = c.getContext('2d');
    // 가장자리 띠에만: 불규칙한 얼룩 + 흘러내린 자국 + 미세 비말
    for (let i = 0; i < 26; i++) {
      const side = Math.floor(Math.random() * 4), t = Math.random();
      const px = side === 0 ? Math.random() * 90 : side === 1 ? 1024 - Math.random() * 90 : t * 1024, py = side === 2 ? Math.random() * 70 : side === 3 ? 576 - Math.random() * 70 : t * 576;
      const r = 10 + Math.random() * 30;
      for (let k = 0; k < 7; k++) {   // 여러 겹의 작은 원으로 불규칙한 얼룩
        const ox = (Math.random() - 0.5) * r, oy = (Math.random() - 0.5) * r, rr = r * (0.3 + Math.random() * 0.5), g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rr);
        g.addColorStop(0, 'rgba(70,0,3,0.85)'); g.addColorStop(0.7, 'rgba(95,3,6,0.55)'); g.addColorStop(1, 'rgba(95,3,6,0)');
        x.fillStyle = g; x.beginPath(); x.arc(px + ox, py + oy, rr, 0, Math.PI * 2); x.fill();
      }
      if (side !== 3 && Math.random() < 0.6) { const L = 20 + Math.random() * 90, w = 2 + Math.random() * 4; const g = x.createLinearGradient(px, py, px, py + L); g.addColorStop(0, 'rgba(80,0,4,0.7)'); g.addColorStop(1, 'rgba(80,0,4,0)'); x.fillStyle = g; x.fillRect(px - w / 2, py, w, L); }
      for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2, d = r * (1.2 + Math.random() * 2); x.fillStyle = 'rgba(90,2,6,0.6)'; x.beginPath(); x.arc(px + Math.cos(a) * d, py + Math.sin(a) * d, 0.8 + Math.random() * 2.2, 0, Math.PI * 2); x.fill(); }
    }
    const el = document.getElementById('blood-screen'); el.style.backgroundImage = `url(${c.toDataURL()})`;
    return c;
  }

  // 포인트 획득 팝업 (+100 처치)
  points(n, why, total) {
    const e = document.createElement('div');
    e.className = 'pts'; e.innerHTML = `<b>+${n}</b> ${why}`;
    this.el.ptsBox.prepend(e);
    setTimeout(() => e.classList.add('fade'), 1600);
    setTimeout(() => e.remove(), 2200);
    while (this.el.ptsBox.children.length > 4) this.el.ptsBox.lastChild.remove();
    this.el.ptsTotal.textContent = total.toLocaleString();
  }

  message(txt, t = 2.2, cls = '') {
    this.el.msg.innerHTML = txt; this.el.msg.className = 'show ' + cls; this.msgT = t;
  }

  prompt(txt) { this.el.prompt.textContent = txt || ''; this.el.prompt.style.opacity = txt ? 1 : 0; }

  update(dt) {
    if (this.bloodT > 0) { this.bloodT = Math.max(0, this.bloodT - dt * 0.35); document.getElementById('blood-screen').style.opacity = Math.min(0.6, this.bloodT).toFixed(3); }
    const g = this.g, W = g.weapons, P = g.player;
    // 조준선
    const spread = W.currentSpread();
    const px = Math.tan(spread * Math.PI / 360) / Math.tan(g.camera.fov * Math.PI / 360) * innerHeight * 0.5;
    const gap = clamp(px, 4, 160);
    this.el.cross.style.setProperty('--gap', gap + 'px');
    const hide = W.ads > 0.35 || P.sprinting || W.busy() && /reload|inspect|rS|rE|holster|draw/.test(W.anim?.name || '') || !P.alive;
    this.el.cross.style.opacity = hide ? 0 : 1;
    // 히트마커
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.el.hit.className = ''; }
    // 체력
    this.el.hp.style.width = P.hp + '%';
    this.el.hp.classList.toggle('low', P.hp < 35);
    this.el.hpTxt.textContent = Math.ceil(P.hp);
    // 피격 방향 회전
    for (const d of this.el.dmg.children) d.style.transform = `translate(-50%,-50%) rotate(${(-(+d.dataset.a) + P.yaw + Math.PI) }rad)`;
    // 나침반
    const deg = ((-P.yaw * 180 / Math.PI) % 360 + 360) % 360;
    this.el.compass.style.transform = `translateX(${-deg * 4}px)`;
    // 메시지
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.el.msg.className = ''; }
    if (this.slotT > 0) { this.slotT -= dt; if (this.slotT <= 0) this.el.slots.classList.remove('show'); }
    // 숨 참기 게이지
    this.el.breath.style.opacity = W.def.scope && W.ads > 0.5 ? 1 : 0;
    this.el.breath.firstElementChild.style.width = P.breath * 100 + '%';
  }

  clock(dn) {
    const t = dn.clock() + (dn.flashOn ? '  ◉ 라이트' : '') + (dn.nvg ? '  ◉ NVG' : '') + (dn.lamp > 0.6 && !dn.flashOn && !dn.nvg ? '  [L] 라이트 · [N] 야간투시경' : '');
    if (this._ck !== t) { this._ck = t; this.el.clock.textContent = t; }
  }

  stats(wave, left, score) {
    this.el.wave.textContent = wave;
    this.el.left.textContent = left;
    this.el.score.textContent = score;
  }
}
