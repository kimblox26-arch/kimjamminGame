// HUD / 메뉴 / 지도 / 가방 / 시계
import * as THREE from 'three';
import { COAST, DMZ, CITIES, HIGHWAYS, RIVERS, ll, toLatLon } from './korea.js';
import { ITEMS, RARITY } from './items.js';
import { WEAPONS } from './player.js';
import { fmt2, clamp } from './util.js';

const $ = id => document.getElementById(id);
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export class Clock {
  constructor() { this.base = new Date(2026, 10, 26, 7, 59, 0).getTime(); this.min = 0; }
  get date() { return new Date(this.base + this.min * 60000); }
  get hours() { const d = this.date; return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
  get day() { return Math.floor((this.min + 7 * 60 + 59) / 1440) + 1; }
  short() { const d = this.date; return `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`; }
}

export class UI {
  constructor(game) {
    this.g = game; this.hud = $('hud'); this.mode = 'title';
    this.el = { date: $('clock-date'), time: $('clock-time'), day: $('clock-day'), hp: $('bar-hp'), st: $('bar-st'), food: $('bar-food'), water: $('bar-water'), fear: $('bar-fear'), stress: $('bar-stress'), hope: $('bar-hope'), emo: $('emo-label'), wn: $('weapon-name'), wa: $('weapon-ammo'), prompt: $('prompt'), hold: $('hold'), holdBar: $('hold-bar'), notify: $('notify'), tasks: $('tasks'), ct: $('center-task'), fps: $('fps'), strip: $('compass-strip'), obj: $('compass-obj') };
    for (let i = 0; i < 24; i++) { const s = document.createElement('span'), a = i * 15; s.textContent = ['북', '', '', '북동', '', '', '동', '', '', '남동', '', '', '남', '', '', '남서', '', '', '서', '', '', '북서', '', ''][i] || '·'; s.dataset.a = a; this.el.strip.appendChild(s); }
    this.map = { zoom: 0.0016, cx: 0, cz: 0, drag: null };
    this.bind();
  }
  bind() {
    const g = this.g;
    $('menu-btn').onclick = () => this.toggleMenu(true);
    $('btn-settings').onclick = () => { g.audio.play('ui'); this.titleSettings(true); };
    $('btn-howto').onclick = () => { g.audio.play('ui'); this.titleInfo(`WASD 이동 · Shift 달리기 · C 앉기 · Space 점프<br>마우스 왼쪽 공격/사격 · 오른쪽 조준 · R 재장전 · 1~6 무기<br>E(길게) 상호작용·수색 · F 손전등 · Tab 가방 · M 지도<br>H 치료 · X 먹기 · Z 마시기<br><b>좀비는 머리를 파괴해야 확실히 죽습니다.</b> 몸통 공격은 잠시 쓰러뜨릴 뿐입니다.`); };
    $('btn-credits').onclick = () => { g.audio.play('ui'); this.titleInfo(`서울 감염: DAY ZERO — 오리지널 웹 좀비 서바이벌<br>엔진: three.js (WebGL) · 모든 모델·텍스처·사운드는 코드로 실시간 생성<br>맵: 실제 위경도 기반 대한민국 1:1`); };
    document.querySelectorAll('#menu [data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act; g.audio.play('ui');
      if (a === 'resume') this.toggleMenu(false);
      if (a === 'title') this.titleSettings(false);
      if (a === 'skip') { this.toggleMenu(false); g.intro.skip(); }
      if (a === 'map') { this.toggleMenu(false, true); this.openMap(true); }
      if (a === 'save') { g.saveGame(); }
      if (a === 'controls') $('controls-help').classList.toggle('hidden');
    });
    const S = g.settings, set = (id, k, f = v => v) => { const e = $(id); if (e.type === 'checkbox') e.checked = S[k]; else e.value = S[k]; e.oninput = e.onchange = () => { S[k] = f(e.type === 'checkbox' ? e.checked : e.value); g.applySettings(); }; };
    set('set-optimize', 'optimize'); set('set-quality', 'quality'); set('set-volume', 'volume', Number); set('set-voice', 'voice'); set('set-subs', 'subs'); set('set-sens', 'sens', Number); set('set-fov', 'fov', Number); set('set-fps', 'showFps');
    const cv = $('map-canvas');
    cv.onwheel = e => { this.map.zoom = clamp(this.map.zoom * (e.deltaY > 0 ? 0.8 : 1.25), 0.00005, 0.2); this.drawMap(); };
    cv.onmousedown = e => this.map.drag = [e.clientX, e.clientY, this.map.cx, this.map.cz];
    window.addEventListener('mouseup', () => this.map.drag = null);
    cv.onmousemove = e => { const d = this.map.drag; if (!d) return; this.map.cx = d[2] - (e.clientX - d[0]) / this.map.zoom; this.map.cz = d[3] - (e.clientY - d[1]) / this.map.zoom; this.drawMap(); };
    $('btn-retry').onclick = () => g.retry(); $('btn-freeplay').onclick = () => { $('ending').classList.add('hidden'); g.paused = false; g.requestLock(); };
  }
  titleInfo(html) { const e = $('title-info'); e.innerHTML = html; e.classList.toggle('hidden', e.dataset.h === html && !e.classList.contains('hidden')); e.dataset.h = html; }
  titleSettings(on) { $('menu').classList.toggle('hidden', !on); $('menu').classList.toggle('from-title', on); $('menu-title').textContent = on ? '설정' : '일시정지'; }
  setMode(m) {
    this.mode = m;
    this.hud.classList.toggle('hidden', m !== 'play');
    $('menu-btn').classList.toggle('hidden', m === 'title');
    $('btn-skip').classList.toggle('hidden', m !== 'cine');
    document.body.classList.toggle('playing', m === 'play');
    $('subtitle').style.display = '';
  }
  toggleMenu(on, keepPause) {
    const g = this.g; $('menu').classList.toggle('hidden', !on); $('menu').classList.remove('from-title'); $('menu-title').textContent = '일시정지';
    g.paused = on || !!keepPause; if (on) { document.exitPointerLock?.(); if (g.voice) speechSynthesis?.pause?.(); } else { speechSynthesis?.resume?.(); if (!keepPause && this.mode === 'play') g.requestLock(); }
    if (g.audio.ctx) on ? g.audio.ctx.suspend() : g.audio.ctx.resume();
  }
  get menuOpen() { return !$('menu').classList.contains('hidden'); }
  openMap(on) { $('map-screen').classList.toggle('hidden', !on); this.g.paused = on; if (on) { document.exitPointerLock?.(); const p = this.g.player.pos; this.map.cx = p.x; this.map.cz = p.z; this.resizeMap(); this.drawMap(); } else this.g.requestLock(); }
  get mapOpen() { return !$('map-screen').classList.contains('hidden'); }
  openInv(on) {
    $('inventory').classList.toggle('hidden', !on); this.g.paused = on;
    if (on) { document.exitPointerLock?.(); this.drawInv(); } else this.g.requestLock();
  }
  get invOpen() { return !$('inventory').classList.contains('hidden'); }
  drawInv() {
    const P = this.g.player, L = $('inv-list'), G = $('inv-gear'); L.innerHTML = ''; G.innerHTML = '';
    $('inv-weight').textContent = `${P.weight().toFixed(1)} / ${P.capacity()} kg`;
    const row = (par, name, sub, col, fn, rfn) => { const d = document.createElement('div'); d.className = 'it'; d.innerHTML = `<span style="color:${col || '#eee'}">${name}</span><small>${sub}</small>`; if (fn) d.onclick = () => { fn(); this.drawInv(); }; if (rfn) d.oncontextmenu = e => { e.preventDefault(); rfn(); this.drawInv(); }; par.appendChild(d); };
    row(G, '🎒 ' + (P.bag ? ITEMS[P.bag].name : '가방 없음'), `수용량 ${P.capacity()}kg`, P.bag ? RARITY[ITEMS[P.bag].r][1] : '#999');
    for (const sl of ['head', 'body']) { const a = P.armor[sl]; row(G, (sl === 'head' ? '⛑ ' : '🦺 ') + (a ? ITEMS[a.type].name : sl === 'head' ? '머리 방어구 없음' : '몸 방어구 없음'), a ? `방어 ${Math.round(ITEMS[a.type].def * 100)}% · 내구도 ${Math.max(0, a.dur | 0)}` : '-', a ? RARITY[ITEMS[a.type].r][1] : '#888'); }
    if (P.hasFlash) row(G, '🔦 손전등', `배터리 ${P.batt | 0}% · ${P.flashOn ? '켜짐' : '꺼짐'}`, '#ddd', () => P.flashOn = !P.flashOn);
    for (const w of P.owned) { const W = WEAPONS[w], d = ITEMS[w]; row(G, (P.weapon === w ? '▶ ' : '') + W.name, W.gun ? `탄창 ${P.mag[w]}/${W.mag} · 예비 ${P.ammo[w]}` : (W.heavy ? '중량 근접' : '근접'), d ? RARITY[d.r][1] : '#ccc', () => P.equip(w)); }
    const keys = Object.keys(P.inv); if (!keys.length) row(L, '(비어 있음)', '');
    const sub = d => ({ food: '먹기 · 배고픔 +' + d.val, drink: '마시기 · 갈증 +' + d.val + (d.st ? ' · 기력' : ''), heal: '치료 · 체력 +' + d.val, armor: '장착 · 방어 ' + Math.round(d.def * 100) + '%', tool: '도구', misc: d.use ? '사용' : '재료' }[d.kind] || '');
    for (const k of keys) { const d = ITEMS[k]; row(L, `${d.name} ×${P.inv[k]}`, `${RARITY[d.r][0]} · ${sub(d)} · ${(d.w * P.inv[k]).toFixed(1)}kg`, RARITY[d.r][1], () => P.use(k), () => P.drop(k)); }
  }
  resizeMap() { const c = $('map-canvas'); c.width = innerWidth; c.height = innerHeight; }
  drawMap() {
    const c = $('map-canvas'), x = c.getContext('2d'), W = c.width, H = c.height, m = this.map, g = this.g;
    const X = (wx) => W / 2 + (wx - m.cx) * m.zoom, Y = (wz) => H / 2 + (wz - m.cz) * m.zoom;
    x.fillStyle = '#0d2233'; x.fillRect(0, 0, W, H);
    const poly = (pts, fill, stroke) => { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1]))); x.closePath(); if (fill) { x.fillStyle = fill; x.fill(); } if (stroke) { x.strokeStyle = stroke; x.stroke(); } };
    poly(COAST, '#2f3b2c', '#6b7d63');
    const [jx, jz] = ll(33.38, 126.55); x.beginPath(); x.ellipse(X(jx), Y(jz), 36000 * m.zoom, 16500 * m.zoom, 0, 0, 7); x.fillStyle = '#2f3b2c'; x.fill(); x.strokeStyle = '#6b7d63'; x.stroke();
    // 북한 지역 음영
    x.save(); x.beginPath(); x.moveTo(X(DMZ[0][0]), Y(DMZ[0][1])); DMZ.forEach(p => x.lineTo(X(p[0]), Y(p[1]))); x.lineTo(X(DMZ[DMZ.length - 1][0]), 0); x.lineTo(X(DMZ[0][0]) - 2000, 0); x.closePath(); x.fillStyle = 'rgba(0,0,0,.45)'; x.fill(); x.restore();
    x.setLineDash([6, 4]); x.strokeStyle = '#d33'; x.lineWidth = 2; x.beginPath(); DMZ.forEach((p, i) => i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1]))); x.stroke(); x.setLineDash([]);
    x.lineWidth = Math.max(1.5, 600 * m.zoom); x.strokeStyle = '#2b6c9a'; for (const r of RIVERS) { x.beginPath(); r.xz.forEach((p, i) => i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1]))); x.stroke(); }
    x.lineWidth = 2; x.strokeStyle = '#c9a23a'; for (const h of HIGHWAYS) { x.beginPath(); x.moveTo(X(h.ax), Y(h.az)); x.lineTo(X(h.bx), Y(h.bz)); x.stroke(); }
    for (const ct of CITIES) { x.beginPath(); x.arc(X(ct.x), Y(ct.z), Math.max(3, ct.r * m.zoom * 0.6), 0, 7); x.fillStyle = 'rgba(200,200,200,.25)'; x.fill(); x.fillStyle = '#eee'; x.font = `${ct.d > 0.8 ? 'bold ' : ''}13px sans-serif`; x.fillText(ct.name, X(ct.x) + 6, Y(ct.z) - 6); }
    // 가까이 확대 시 로드된 청크(도로망)
    if (m.zoom > 0.02) { x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 1; for (const ch of g.world.chunks.values()) { if (!ch.urban) continue; for (const o of [0, 80, 160]) { x.beginPath(); x.moveTo(X(ch.ox + o), Y(ch.oz)); x.lineTo(X(ch.ox + o), Y(ch.oz + 240)); x.moveTo(X(ch.ox), Y(ch.oz + o)); x.lineTo(X(ch.ox + 240), Y(ch.oz + o)); x.stroke(); } } }
    if (g.objective) { const o = g.objective.pos; x.fillStyle = '#ffd166'; x.beginPath(); x.arc(X(o.x), Y(o.z), 7, 0, 7); x.fill(); x.fillText(g.objective.name, X(o.x) + 10, Y(o.z) + 4); }
    const p = g.player.vehicle ? g.player.vehicle.pos : g.player.pos, yaw = g.player.vehicle ? g.player.vehicle.yaw + Math.PI : g.player.yaw;
    x.save(); x.translate(X(p.x), Y(p.z)); x.rotate(-yaw); x.fillStyle = '#ff4d4d'; x.beginPath(); x.moveTo(0, -11); x.lineTo(7, 8); x.lineTo(0, 4); x.lineTo(-7, 8); x.closePath(); x.fill(); x.restore();
    const [lat, lon] = toLatLon(p.x, p.z);
    $('map-info').innerHTML = `현재 위치: 북위 ${lat.toFixed(4)}° 동경 ${lon.toFixed(4)}°<br>축척: 1:${Math.round(1 / m.zoom * 0.00026 * 1000)}${g.objective ? `<br>목표: ${g.objective.name} (${(Math.hypot(g.objective.pos.x - p.x, g.objective.pos.z - p.z) / 1000).toFixed(2)} km)` : ''}`;
  }
  update(dt) {
    const g = this.g, P = g.player, E = this.el, d = g.clock.date;
    if (this.mode !== 'play') return;
    const h = d.getHours();
    E.date.textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`;
    E.time.textContent = `${h < 12 ? '오전' : '오후'} ${fmt2(h % 12 === 0 ? 12 : h % 12)}:${fmt2(d.getMinutes())}`;
    E.day.textContent = `생존 ${g.clock.day}일차`;
    E.hp.style.width = P.hp + '%'; E.st.style.width = P.st + '%'; E.food.style.width = P.food + '%'; E.water.style.width = P.water + '%';
    E.fear.style.width = P.fear + '%'; E.stress.style.width = P.stress + '%'; E.hope.style.width = P.hope + '%';
    E.emo.textContent = { 평온: '😌 평온', 불안: '😟 불안', 공포: '😨 공포', 공황: '😱 공황', 지침: '😩 지침', 희망: '🙂 희망' }[P.emo] || P.emo;
    const w = WEAPONS[P.weapon]; E.wn.textContent = P.vehicle ? `차량 · ${Math.abs(P.vehicle.speed * 3.6) | 0} km/h` : w.name;
    E.wa.textContent = P.vehicle ? `내구도 ${Math.max(0, P.vehicle.hp | 0)}%` : w.gun ? `${P.mag[P.weapon]} / ${P.ammo[P.weapon]}${P.reloadT > 0 ? ' (장전 중)' : ''}` : '';
    // 나침반
    const yaw = P.vehicle ? P.vehicle.yaw + Math.PI : P.yaw, head = ((-yaw * 180 / Math.PI) % 360 + 360) % 360; // 0=북
    const Wd = E.strip.parentElement.clientWidth, ppd = Wd / 180;
    for (const s of E.strip.children) { let a = +s.dataset.a - head; a = ((a + 540) % 360) - 180; s.style.left = (Wd / 2 + a * ppd) + 'px'; s.style.opacity = Math.abs(a) > 90 ? 0 : 1; }
    if (g.objective) { const p = P.vehicle ? P.vehicle.pos : P.pos, o = g.objective.pos, ang = Math.atan2(o.x - p.x, -(o.z - p.z)) * 180 / Math.PI; let a = ((ang - head + 540) % 360) - 180; const dist = Math.hypot(o.x - p.x, o.z - p.z); E.obj.style.left = (Wd / 2 + clamp(a, -88, 88) * ppd) + 'px'; E.obj.textContent = `◆ ${g.objective.name} ${dist > 1000 ? (dist / 1000).toFixed(1) + 'km' : (dist | 0) + 'm'}`; E.obj.style.display = ''; } else E.obj.style.display = 'none';
    E.fps.style.display = g.settings.showFps ? '' : 'none';
    this._gT = (this._gT || 0) - dt; if (this._gT < 0) { this._gT = 0.5; $('gear').innerHTML = `가방 ${P.weight().toFixed(1)}/${P.capacity()}kg${P.armor.body ? ' · ' + ITEMS[P.armor.body.type].name : ''}${P.armor.head ? ' · ' + ITEMS[P.armor.head.type].name : ''}${P.hasFlash ? ' · 손전등 ' + (P.batt | 0) + '%' : ''}`; }
  }
  prompt(label, k = 0) {
    const E = this.el; if (!label) { E.prompt.style.display = 'none'; E.hold.style.display = 'none'; return; }
    E.prompt.style.display = 'block'; E.prompt.innerHTML = `<b>E</b>${label}`; E.hold.style.display = k > 0 ? 'block' : 'none'; E.holdBar.style.width = (k * 100) + '%';
  }
  hitmarker(r) { const e = $('hitmarker'); e.classList.toggle('kill', !!r.kill); e.style.transition = 'none'; e.style.opacity = 1; e.style.transform = `scale(${r.head ? 1.3 : 1})`; requestAnimationFrame(() => { e.style.transition = 'opacity .35s'; e.style.opacity = 0; }); if (r.head && r.kill) { const h = $('headshot'); h.style.transition = 'none'; h.style.opacity = 1; requestAnimationFrame(() => { h.style.transition = 'opacity 1s'; h.style.opacity = 0; }); } this.g.audio.play('click', { vol: r.kill ? 0.5 : 0.25 }); }
  notify(t, col) { const d = document.createElement('div'); d.textContent = t; if (col) d.style.color = col; this.el.notify.appendChild(d); setTimeout(() => d.remove(), 3600); while (this.el.notify.children.length > 5) this.el.notify.firstChild.remove(); }
  tasks(title, steps) { const E = this.el.tasks; if (!title) { E.innerHTML = ''; return; } E.innerHTML = `<div class="t-title">${title}</div>` + steps.map(s => `<div class="t-step ${s.done ? 'done' : ''}">${s.txt}</div>`).join(''); }
  centerTask(label, title, desc, dur = 5) { const E = this.el.ct; E.innerHTML = `<div class="ct-label">${label}</div><div class="ct-title">${title}</div><div class="ct-desc">${desc}</div>`; E.classList.add('show'); clearTimeout(this._ct); this._ct = setTimeout(() => E.classList.remove('show'), dur * 1000); }
  hurt(k) { const e = $('fx-hurt'); e.style.transition = 'none'; e.style.opacity = k; requestAnimationFrame(() => { e.style.transition = 'opacity 1.2s'; e.style.opacity = 0; }); }
  fade(v, dur) { const e = $('fx-fade'); e.style.transition = `opacity ${dur}s`; e.style.opacity = v; }
  eyes(lid, blur) { $('fx-lid-top').style.transform = `scaleY(${lid})`; $('fx-lid-bot').style.transform = `scaleY(${lid})`; const b = $('fx-blur'); b.style.backdropFilter = b.style.webkitBackdropFilter = blur > 0.05 ? `blur(${blur.toFixed(1)}px)` : 'none'; }
  death(info) { $('death-info').textContent = info; $('death').classList.remove('hidden'); document.exitPointerLock?.(); }
  ending(info) { $('ending-info').innerHTML = info; $('ending').classList.remove('hidden'); document.exitPointerLock?.(); }
}
