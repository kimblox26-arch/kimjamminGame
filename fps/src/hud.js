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
      slots: $('slots'), fps: $('fps'), breath: $('breath'), lowAmmo: $('low-ammo'),
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
    if (!from) return;
    const d = document.createElement('div');
    d.className = 'dmg-arc';
    const a = Math.atan2(from.x - p.pos.x, from.z - p.pos.z);
    d.dataset.a = a;
    this.el.dmg.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }

  kill(name, weapon, head) {
    const e = document.createElement('div');
    e.className = 'kf';
    e.innerHTML = `<span class="me">YOU</span> <span class="wp">[${weapon}]</span> <span class="en">${name}</span>${head ? ' <span class="hs">◉ HEADSHOT</span>' : ''}`;
    this.el.feed.prepend(e);
    setTimeout(() => e.classList.add('fade'), 4000);
    setTimeout(() => e.remove(), 4800);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
  }

  message(txt, t = 2.2, cls = '') {
    this.el.msg.innerHTML = txt; this.el.msg.className = 'show ' + cls; this.msgT = t;
  }

  prompt(txt) { this.el.prompt.textContent = txt || ''; this.el.prompt.style.opacity = txt ? 1 : 0; }

  update(dt) {
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

  stats(wave, left, score) {
    this.el.wave.textContent = wave;
    this.el.left.textContent = left;
    this.el.score.textContent = score;
  }
}
