// 화면 UI: 상단 모드·시간, 쓰나미 설정 카드, 도시 표지, 1인칭 HUD, 말풍선, 알림, 설정
import * as THREE from 'three';
import { WORLD, HALF, EMOTIONS, QUALITY } from './config.js';
import { icon, face } from './icons.js';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();

// 발생 유형별 슬라이더 범위 (세계 / 도시). 값은 0..100 슬라이더를 로그 축으로 변환
const TYPES = [
  { key: 'quake', name: '지진', ic: 'quake' },
  { key: 'landslide', name: '산사태', ic: 'slide' },
  { key: 'impact', name: '운석', ic: 'meteor' },
];
const RANGE = {
  world: {
    quake: { h: [0.3, 15], s: [50, 1300], hName: '해저 융기', sName: '단층 길이' },
    landslide: { h: [2, 60], s: [30, 300], hName: '초기 파고', sName: '붕괴 길이' },
    impact: { h: [20, 1200], s: [60, 600], hName: '충돌 파고', sName: '충돌 지름' },
  },
  city: {
    quake: { h: [1, 18], s: [1.2, 8], hName: '해저 융기', sName: '단층 길이' },
    landslide: { h: [3, 35], s: [0.15, 0.6], hName: '초기 파고', sName: '붕괴 길이' },
    impact: { h: [15, 160], s: [0.1, 0.6], hName: '충돌 파고', sName: '충돌 지름' },
  },
};
const lerpLog = ([a, b], v) => a * Math.pow(b / a, v / 100);
const fmtDur = (t) => (t < 3600 ? `${Math.max(1, Math.round(t / 60))}분` : `${Math.floor(t / 3600)}시간 ${Math.round((t % 3600) / 60)}분`);

export class UI {
  constructor(game) {
    this.g = game;
    this.labelPool = [];
    this.t = 0;
    this.mapT = 0;
    this.noticeT = 0;
    this.bubblesOn = true;
    this.warnOn = true;
    this.floodOn = true;
    this.ed = { type: 'quake', ctx: null };
    for (const el of document.querySelectorAll('[data-ic]')) el.innerHTML = icon(el.dataset.ic);
    this.bind();
    this.buildMinimap();
  }

  bind() {
    const g = this.g;
    for (const b of document.querySelectorAll('#modes button')) b.onclick = () => { g.audio.start(); g.setMode(b.dataset.mode); };
    $('btn-play').onclick = () => g.togglePause();
    $('btn-speed').onclick = () => g.cycleSpeed();
    $('btn-settings').onclick = () => $('settings').classList.toggle('hidden');
    $('set-close').onclick = () => $('settings').classList.add('hidden');
    // 편집기
    $('ed-types').innerHTML = TYPES.map((t) => `<button data-t="${t.key}">${icon(t.ic)}<span>${t.name}</span></button>`).join('');
    for (const b of $('ed-types').children) b.onclick = () => { this.ed.type = b.dataset.t; this.syncEditor(); };
    for (const id of ['ed-height', 'ed-size', 'ed-dir']) $(id).oninput = () => this.syncEditor();
    $('ed-close').onclick = $('ed-cancel').onclick = () => this.closeEditor();
    $('ed-go').onclick = () => { const s = this.editorSource(); this.closeEditor(); g.launch(s); };
    // 도시 표지
    $('pin-btn').onclick = () => $('pin-menu').classList.toggle('hidden');
    for (const b of document.querySelectorAll('#pin-menu [data-go]')) b.onclick = () => { $('pin-menu').classList.add('hidden'); g.setMode(b.dataset.go); };
    $('btn-3d').onclick = () => g.setMode(g.mode === 'city3d' ? 'city' : 'city3d');
    $('btn-person').onclick = () => g.setMode('fp');
    // 터치 버튼
    const inp = g.input;
    $('t-run').onpointerdown = (e) => { e.stopPropagation(); inp.runToggle = !inp.runToggle; $('t-run').classList.toggle('on', inp.runToggle); };
    $('t-jump').onpointerdown = (e) => { e.stopPropagation(); inp.jumpPressed = true; };
    $('t-act').onpointerdown = (e) => { e.stopPropagation(); inp.actPressed = true; };
    $('phone').onclick = () => $('phone').classList.add('hidden');
    // 설정
    const qs = $('set-quality');
    qs.innerHTML = Object.entries(QUALITY).map(([k, q]) => `<option value="${k}"${k === g.qKey ? ' selected' : ''}>${q.label}</option>`).join('');
    qs.onchange = () => {
      try { localStorage.setItem('tsunami.quality', qs.value); } catch (e) { /* 저장소 없음 */ }
      const u = new URL(location.href); u.searchParams.set('q', qs.value); location.href = u.toString();
    };
    $('set-vol').oninput = () => g.audio.setVolume && g.audio.setVolume($('set-vol').value / 100);
    const tod = () => { g.timeOfDay = +$('set-tod').value; const h = Math.floor(g.timeOfDay), m = Math.round((g.timeOfDay - h) * 60); $('set-tod-v').textContent = `${h}:${String(m).padStart(2, '0')}`; g.envDirty = true; };
    $('set-tod').oninput = tod; tod();
    $('set-warn').onchange = () => { this.warnOn = $('set-warn').checked; };
    $('set-emo').onchange = () => { this.bubblesOn = $('set-emo').checked; };
    $('set-flood').onchange = () => { this.floodOn = $('set-flood').checked; g.setFloodOverlay(this.floodOn); };
    $('set-reset').onclick = () => { $('settings').classList.add('hidden'); g.resetWorld(); };
    $('intro-go').onclick = () => { $('intro').classList.add('hidden'); g.audio.start(); };
    // 사람 선택 카드 (도시 지도)
    const pc = document.createElement('div');
    pc.id = 'person-card'; pc.className = 'card hidden';
    document.body.appendChild(pc);
    this.pcard = pc;
    pc.onclick = (e) => {
      const b = e.target.closest('[data-pc]');
      if (!b) return;
      if (b.dataset.pc === 'view') g.viewPerson(this.pcP);
      if (b.dataset.pc === 'here' && this.pcPlace) g.startFP(this.pcPlace.x, this.pcPlace.z);
      this.hidePerson();
    };
  }

  /* ───────────────────────── 쓰나미 설정 카드 ───────────────────────── */
  openEditor(ctx, sx, sy) {
    this.ed.ctx = ctx;
    $('ed-where').textContent = ctx.where;
    $('editor').classList.remove('hidden');
    this.syncEditor();
    // 터치 위치 옆에 배치 (작은 화면에서는 CSS 가 하단 시트로 고정)
    const el = $('editor'), w = el.offsetWidth, h = el.offsetHeight;
    if (innerWidth > 640) {
      let x = sx + 24, y = sy - h / 2;
      if (x + w > innerWidth - 12) x = sx - w - 24;
      y = Math.max(70, Math.min(innerHeight - h - 12, y));
      el.style.left = Math.max(12, x) + 'px'; el.style.top = y + 'px';
    } else { el.style.left = ''; el.style.top = ''; }
  }

  closeEditor() {
    $('editor').classList.add('hidden');
    this.ed.ctx = null;
    this.g.previewSource(null);
  }

  get editorOpen() { return !!this.ed.ctx; }

  editorSource() {
    const c = this.ed.ctx, t = this.ed.type, R = RANGE[c.kind][t];
    const hv = +$('ed-height').value, sv = +$('ed-size').value, dir = +$('ed-dir').value;
    return { kind: c.kind, type: t, lon: c.lon, lat: c.lat, x: c.x, z: c.z, height: lerpLog(R.h, hv), size: lerpLog(R.s, sv), strike: dir, power: (hv + sv) / 200 };
  }

  syncEditor() {
    const c = this.ed.ctx;
    if (!c) return;
    for (const b of $('ed-types').children) b.classList.toggle('on', b.dataset.t === this.ed.type);
    const s = this.editorSource(), R = RANGE[c.kind][s.type];
    const km = c.kind === 'world';
    const fmtL = (v) => (km ? `${v < 100 ? v.toFixed(0) : Math.round(v / 10) * 10} km` : v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`);
    $('ed-height-v').textContent = `${s.height < 10 ? s.height.toFixed(1) : Math.round(s.height)} m`;
    $('ed-size-v').textContent = fmtL(s.size);
    $('ed-height').title = R.hName; $('ed-size').title = R.sName;
    $('ed-dir-row').classList.toggle('hidden', s.type === 'impact');
    $('ed-dir-v').textContent = `${s.strike}° ${['북', '북동', '동', '남동', '남'][Math.round(s.strike / 45)] || '남'}`;
    // 물리량 요약
    let calc;
    if (s.type === 'quake') {
      const L = s.size * 1000, W = Math.min(km ? 220e3 : 2400, Math.max(km ? 50e3 : 600, L * 0.33));
      const Mw = (2 / 3) * (Math.log10(3e10 * L * W * (s.height / 0.35)) - 9.1);
      calc = `규모 <b>Mw ${Mw.toFixed(1)}</b> · 미끄럼 ${(s.height / 0.35).toFixed(1)} m · 단층 ${fmtL(s.size)} × ${fmtL(W / 1000)}`;
    } else if (s.type === 'landslide') {
      const V = s.size * s.size * 0.3 * (s.height * 3) * (km ? 1e6 : 1e6) / 1e9;
      calc = `붕괴 토사 약 <b>${V < 1 ? V.toFixed(2) : V.toFixed(0)} km³</b> · ${R.hName} ${s.height.toFixed(0)} m`;
    } else {
      const E = 0.5 * 1000 * 9.81 * (s.height ** 2) * Math.PI * (s.size * 500) ** 2;   // 초기 파동 위치에너지 (J)
      const Mt = E / 4.184e15;
      calc = `파동 에너지 약 <b>${Mt < 1 ? (Mt * 1000).toFixed(0) + ' kt' : Mt < 1000 ? Mt.toFixed(0) + ' Mt' : (Mt / 1000).toFixed(1) + ' Gt'}</b> (TNT) · 지름 ${fmtL(s.size)}`;
    }
    let tail = '';
    if (km) { const tt = this.g.etaFor(c.lon, c.lat); tail = tt !== null ? `<br>해랑시 도달 예상 <b>${fmtDur(tt)}</b> 후` : ''; }
    $('ed-calc').innerHTML = calc + tail;
    this.g.previewSource(s);
  }

  /* ───────────────────────── 알림 · 안내 ───────────────────────── */
  notice(msg, kind = 'info', sec = 6) {
    const el = $('notice');
    const ic = kind === 'alert' ? 'siren' : kind === 'warn' ? 'bolt' : kind === 'wave' ? 'wave' : 'eye';
    el.innerHTML = icon(ic) + `<span>${msg}</span>`;
    el.className = 'pill notice ' + kind;
    this.noticeT = sec;
  }

  hint(msg) { if ($('hint').textContent !== msg) $('hint').textContent = msg; }

  phone(text) {
    const el = $('phone');
    el.querySelector('.ph-b').textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this.phoneTO);
    this.phoneTO = setTimeout(() => el.classList.add('hidden'), 12000);
  }

  setMode(m) {
    document.body.className = 'm-' + m;
    const tab = m === 'city3d' ? 'city' : m === 'npc' ? 'fp' : m;
    for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('on', b.dataset.mode === tab);
    if (m !== 'world') { $('city-pin').classList.add('hidden'); $('pin-menu').classList.add('hidden'); }
    this.closeEditor();
    this.hidePerson();
    this.syncSpeed();
    this.hint({
      world: '바다를 눌러 쓰나미를 만드세요 · 끌어서 이동, 휠/두 손가락으로 확대',
      city: '바다를 누르면 도시 앞바다 쓰나미 · 사람을 누르면 그 사람의 시점',
      city3d: '끌어서 회전 · 오른쪽 끌기 이동 · 휠 확대',
      fp: matchMedia('(pointer: coarse)').matches ? '왼쪽 조이스틱 이동 · 오른쪽 끌기 시점' : 'WASD 이동 · Shift 달리기 · Space 점프 · E 오르기',
      npc: '이 사람의 눈으로 보는 중 · 끌어서 둘러보기',
    }[m] || '');
  }

  syncSpeed() {
    const g = this.g;
    $('btn-play').innerHTML = icon(g.paused ? 'play' : 'pause');
    const s = g.speedLabel();
    $('btn-speed').textContent = s;
  }

  reset() {
    $('phone').classList.add('hidden');
    $('notice').classList.add('hidden');
    this.closeEditor();
    this.hidePerson();
  }

  /* ───────────────────────── 사람 카드 (도시 지도) ───────────────────────── */
  showPerson(p, sx, sy) {
    this.pcP = p;
    const e = EMOTIONS[p.emotion] || EMOTIONS.calm;
    this.pcard.innerHTML = `<div class="pc-h">${face(p.emotion, '#f1c9a5')}<div><b>${p.name}</b><small>${p.age}세 · ${p.roleName}</small></div></div>
      <p class="pc-s"><i style="background:${e.color}"></i>${e.name}${p.thought ? ` · “${p.thought}”` : ''}</p>
      <button class="btn primary wide" data-pc="view">${icon('eye')}이 사람의 시점</button>`;
    this.pcard.classList.remove('hidden');
    const w = this.pcard.offsetWidth, h = this.pcard.offsetHeight;
    this.pcard.style.left = Math.max(12, Math.min(innerWidth - w - 12, sx - w / 2)) + 'px';
    this.pcard.style.top = Math.max(70, Math.min(innerHeight - h - 12, sy + 18)) + 'px';
  }

  showPlace(x, z, sx, sy) {
    this.pcP = null;
    this.pcPlace = { x, z };
    const h = this.g.terrain.groundAt(x, z);
    this.pcard.innerHTML = `<p class="pc-s">육지 · 해발 ${h.toFixed(1)} m — 바다를 누르면 쓰나미를 만들 수 있습니다</p>
      <button class="btn primary wide" data-pc="here">${icon('person')}여기서 사람 모드</button>`;
    this.pcard.classList.remove('hidden');
    const w = this.pcard.offsetWidth, hh = this.pcard.offsetHeight;
    this.pcard.style.left = Math.max(12, Math.min(innerWidth - w - 12, sx - w / 2)) + 'px';
    this.pcard.style.top = Math.max(70, Math.min(innerHeight - hh - 12, sy + 18)) + 'px';
  }

  hidePerson() { if (this.pcard) this.pcard.classList.add('hidden'); this.pcP = null; }

  /* ───────────────────────── 미니맵 (1인칭) ───────────────────────── */
  buildMinimap() {
    const g = this.g, S = 256;
    const base = document.createElement('canvas');
    base.width = base.height = S;
    const c = base.getContext('2d'), img = c.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -HALF + (i + 0.5) * WORLD / S, z = -HALF + (j + 0.5) * WORLD / S;
      const h = g.terrain.terrainAt(x, z), o = (j * S + i) * 4;
      let r, gg, b;
      if (h < 0) { const d = Math.min(1, -h / 60); r = 22 - d * 12; gg = 70 - d * 35; b = 98 - d * 30; }
      else if (h < 2.8) { r = 200; gg = 188; b = 150; }
      else { const t = Math.min(1, h / 80); r = 80 - t * 30; gg = 104 - t * 34; b = 84 - t * 30; }
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    c.fillStyle = 'rgba(30,36,42,0.9)';
    for (const b of g.city.buildings) {
      const x = (b.x - b.w / 2 + HALF) / WORLD * S, y = (b.z - b.d / 2 + HALF) / WORLD * S;
      c.fillRect(x, y, Math.max(1, b.w / WORLD * S), Math.max(1, b.d / WORLD * S));
    }
    this.mmBase = base;
    this.mmWater = document.createElement('canvas');
    this.mmWater.width = this.mmWater.height = g.sim.N;
    this.mmImg = this.mmWater.getContext('2d').createImageData(g.sim.N, g.sim.N);
  }

  drawMinimap() {
    const g = this.g, sim = g.sim, N = sim.N, d = this.mmImg.data;
    for (let k = 0; k < N * N; k++) {
      const o = k * 4, h = sim.h[k];
      if (sim.b0[k] > 0.2) {
        if (h > 0.05) { d[o] = 60; d[o + 1] = 150; d[o + 2] = 255; d[o + 3] = Math.min(1, 0.35 + h * 0.2) * 255; } else d[o + 3] = 0;
      } else {
        const eta = h + sim.b[k];
        if (eta > 0.4) { d[o] = 255; d[o + 1] = 106; d[o + 2] = 61; d[o + 3] = Math.min(220, eta * 40); }
        else if (eta < -0.4) { d[o] = 200; d[o + 1] = 240; d[o + 2] = 255; d[o + 3] = Math.min(200, -eta * 40); }
        else d[o + 3] = 0;
      }
    }
    this.mmWater.getContext('2d').putImageData(this.mmImg, 0, 0);
    const cv = $('minimap'), c = cv.getContext('2d'), W = cv.width;
    let cx, cz, hx, hz;
    if (g.mode === 'npc' && g.selected) { cx = g.selected.x; cz = g.selected.z; hx = Math.sin(g.selected.yaw); hz = Math.cos(g.selected.yaw); }
    else { cx = g.player.x; cz = g.player.z; hx = -Math.sin(g.player.yaw); hz = -Math.cos(g.player.yaw); }
    const span = 1200;
    const sx = (cx - span / 2 + HALF) / WORLD, sz = (cz - span / 2 + HALF) / WORLD, sw = span / WORLD;
    c.fillStyle = '#08131e'; c.fillRect(0, 0, W, W);
    c.save(); c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 1, 0, 7); c.clip();
    c.drawImage(this.mmBase, sx * 256, sz * 256, sw * 256, sw * 256, 0, 0, W, W);
    c.drawImage(this.mmWater, sx * N, sz * N, sw * N, sw * N, 0, 0, W, W);
    const toS = (x, z) => [(x - cx + span / 2) / span * W, (z - cz + span / 2) / span * W];
    c.fillStyle = '#52c6c2';
    for (const b of g.city.shelters) { const [x, y] = toS(b.x, b.z); c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); }
    c.restore();
    c.save(); c.translate(W / 2, W / 2); c.rotate(Math.atan2(hx, -hz));
    c.fillStyle = '#edf3f7'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath(); c.fill();
    c.restore();
    c.fillStyle = 'rgba(237,243,247,.75)'; c.font = '600 10px IBM Plex Mono, monospace'; c.fillText('N', W / 2 - 3, 12);
  }

  /* ───────────────────────── 매 프레임 ───────────────────────── */
  update(dt) {
    const g = this.g;
    this.t += dt;
    const ck = $('clock');
    ck.textContent = g.clockLabel();
    ck.classList.toggle('live', g.eventStarted());
    if (this.noticeT > 0) { this.noticeT -= dt; $('notice').classList.toggle('hidden', this.noticeT <= 0); }
    // 도시 표지 (세계지도)
    if (g.mode === 'world') {
      const s = g.worldMap.cityScreen(this._cs || (this._cs = {}));
      const pin = $('city-pin');
      if (s && s.visible) {
        pin.classList.remove('hidden');
        pin.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%) translateY(-6px)`;
        $('pin-eta').textContent = g.cityEtaText();
      } else pin.classList.add('hidden');
    }
    this.renderLabels();
    // 1인칭 HUD
    if (g.mode === 'fp' || g.mode === 'npc') {
      const P = g.mode === 'fp' ? g.player : g.selected;
      if (P) {
        const em = P.emotion || 'calm';
        if (this._vf !== em) { this._vf = em; $('v-face').innerHTML = face(em, '#f1c9a5'); }
        $('v-bpm').textContent = Math.round(P.heart);
        $('v-heart').style.animationDuration = (60 / Math.max(50, P.heart)) + 's';
        $('v-stam').style.width = Math.round((P.stamina ?? 1) * 100) + '%';
        let pr = '';
        if (g.mode === 'fp') {
          pr = g.player.prompt || '';
          if (!pr && g.player.depth > 0.05 && g.player.state !== 'swept') pr = `수심 ${g.player.depth.toFixed(2)} m — 물살이 세지면 휩쓸립니다`;
          $('t-act').classList.toggle('on', !!g.player.prompt);
        } else pr = `${P.name} (${P.age}) ${P.thought ? '· “' + P.thought + '”' : ''}`;
        $('prompt').textContent = pr;
        $('prompt').classList.toggle('on', !!pr);
        $('fx-vig').style.opacity = Math.max(0, (P.fear - 0.3) * 1.2).toFixed(2);
        $('fx-shock').style.opacity = (g.shockFx || 0).toFixed(2);
      }
      this.mapT -= dt;
      if (this.mapT <= 0) { this.mapT = 0.25; this.drawMinimap(); }
    } else { $('fx-vig').style.opacity = 0; $('fx-shock').style.opacity = 0; }
    $('fx-under').classList.toggle('on', !!g.underwater);
    $('fx-flash').style.opacity = Math.min(1, g.flash * 1.4).toFixed(2);
  }

  label(i) {
    let el = this.labelPool[i];
    if (!el) { el = document.createElement('div'); el.className = 'lb'; $('labels').appendChild(el); this.labelPool[i] = el; }
    return el;
  }

  /** 말풍선: 가까운 사람의 감정 얼굴(그림) + 생각 */
  renderLabels() {
    const g = this.g, W = innerWidth, H = innerHeight;
    let n = 0;
    const show = (sx, sy, html) => {
      const el = this.label(n++);
      if (el._k !== html) { el._k = html; el.className = 'lb bub'; el.innerHTML = html; }
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      el.style.display = '';
    };
    const m = g.mode;
    if (this.bubblesOn && m !== 'world') {
      const near = [];
      let px, pz, maxD, lim;
      if (m === 'city') {
        const v = g.city2d.view;
        px = v.cx; pz = v.cz; maxD = Math.min(W, H) / v.zoom * 0.6; lim = v.zoom > 1.6 ? 14 : 0;
      } else { px = g.camera.position.x; pz = g.camera.position.z; maxD = m === 'city3d' ? Math.max(0, 300 - g.camera.position.y) : 55; lim = 12; }
      if (lim && maxD > 8) {
        for (const p of g.people.list) {
          if (p.state === 'missing' || p.state === 'inside' || (m === 'npc' && p === g.selected)) continue;
          const d = Math.abs(p.x - px) + Math.abs(p.z - pz);
          if (d < maxD) near.push([d, p]);
        }
        near.sort((a, b) => a[0] - b[0]);
        for (let i = 0; i < Math.min(lim, near.length); i++) {
          const p = near[i][1];
          let sx, sy;
          if (m === 'city') { const q = g.city2d.worldToScreen(p.x, p.z); sx = q.x; sy = q.y - 8; }
          else {
            _p.set(p.x, p.y + p.height + (p.state === 'swept' ? 0.6 : 0.4), p.z).project(g.camera);
            if (_p.z > 1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1) continue;
            sx = (_p.x * 0.5 + 0.5) * W; sy = (-_p.y * 0.5 + 0.5) * H;
          }
          if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) continue;
          const th = p.thoughtT > 0 && p.thought;
          show(sx, sy, face(p.emotion, skinCss(p)) + (th ? `<span>${p.thought}</span>` : ''));
        }
      }
    }
    for (let i = n; i < this.labelPool.length; i++) if (this.labelPool[i].style.display !== 'none') this.labelPool[i].style.display = 'none';
  }
}

function skinCss(p) {
  const s = p.ap && p.ap.skin;
  return s !== undefined ? '#' + s.toString(16).padStart(6, '0') : '#f1c9a5';
}
