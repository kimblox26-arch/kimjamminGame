// SKYBREAKER — 화면 UI (메뉴, 설정, 조작법, 터치 조작, 배너/팝업/킬피드, 일시정지/격추 패널)
import { Settings } from '../../src/core/settings.js';
import { Audio } from '../../src/core/audio.js';
import { computeStats, BODIES, WINGS, GUNS } from './jet.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function isTouch() {
  return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
}

export function statBarsHTML(design) {
  const st = computeStats(design);
  const rows = [
    ['최고 속도', st.bars.speed, Math.round(st.vmax * 3.6).toLocaleString() + ' km/h'],
    ['가속', st.bars.accel, '추력비 ' + (st.accAB / 9.81).toFixed(2)],
    ['기동성', st.bars.agility, Math.round(st.rollRate * 57.3) + '°/s 롤'],
    ['장갑', st.bars.armor, st.hp + ' HP'],
    ['화력', st.bars.firepower, GUNS[design.gun].name.split(' ')[0] + ' · 미사일 ' + design.missiles],
  ];
  return rows.map(([k, v, t]) => `
    <div class="stat"><div class="stat-h"><span>${k}</span><em>${t}</em></div>
    <div class="stat-bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`).join('');
}

export class UI {
  constructor(game) {
    this.game = game;
    this.screen = 's-loading';
    this._bindNav();
    this._bindTouch();
    this.buildSettings();
    this.buildControls();
  }

  /* ------------------------------ 화면 전환 ------------------------------ */
  show(id) {
    for (const s of $$('.screen')) s.classList.toggle('active', s.id === id);
    this.screen = id;
    document.body.dataset.screen = id;
  }
  hideScreens() { for (const s of $$('.screen')) s.classList.remove('active'); this.screen = null; document.body.dataset.screen = 'flight'; }

  setLoading(p, label) {
    const bar = $('#load-bar i');
    if (bar) bar.style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
    const l = $('#load-label');
    if (l && label) l.textContent = label;
  }

  setFlight(on) {
    $('#flight-ui').hidden = !on;
    this.applyTouchVisibility();
  }

  applyTouchVisibility() {
    const mode = Settings.get('onScreenControls');
    const show = mode === 'on' || (mode !== 'off' && isTouch());
    $('#touch').hidden = !show;
    this.touchVisible = show;
    if (this.game.hud) this.game.hud.mobile = show;
  }

  _click(kind = 'click') { if (Audio.ready) Audio.ui(kind); }

  _bindNav() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      const g = this.game;
      this._click(act === 'back' ? 'back' : 'click');
      switch (act) {
        case 'free': g.startFlight('free'); break;
        case 'dogfight': g.startFlight('dogfight'); break;
        case 'hangar': g.openHangar(); break;
        case 'settings': this.show('s-settings'); break;
        case 'controls': this.show('s-controls'); break;
        case 'back': if (g.state === 'menu') this.show('s-menu'); else if (g.state === 'flight') { this.show(null); this.hideScreens(); this.showPause(true); } break;
        case 'resume': g.setPaused(false); break;
        case 'respawn': g.respawn(); break;
        case 'pause-settings': this.showPause(false); this.show('s-settings'); break;
        case 'menu': g.toMenu(); break;
        case 'fullscreen': this.toggleFullscreen(); break;
        default: break;
      }
    });
    for (const b of $$('.mbtn')) b.addEventListener('pointerenter', () => this._click('hover'));
  }

  toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement) {
      const el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
      try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* noop */ }
    } else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  }

  /* ------------------------------ 메뉴 카드 ------------------------------ */
  updateMenuCard(design) {
    const el = $('#menu-jet');
    if (!el) return;
    const best = this.game.best || {};
    el.innerHTML = `
      <div class="jc-top"><span class="jc-tag">출격 기체</span><b>${design.name}</b>
      <em>${BODIES[design.body].name} · ${WINGS[design.wing].name} · 엔진 ${design.engines}기</em></div>
      ${statBarsHTML(design)}
      <div class="jc-best"><span>최고 점수</span><b>자유 ${Number(best.free || 0).toLocaleString()}</b><b>공중전 ${Number(best.dogfight || 0).toLocaleString()}</b></div>`;
  }

  /* ------------------------------ 연출 ------------------------------ */
  banner(title, sub = '', kind = 'kill') {
    const wrap = $('#banner');
    const el = document.createElement('div');
    el.className = 'bn bn-' + kind;
    el.innerHTML = `<div class="bn-t">${title}</div>${sub ? `<div class="bn-s">${sub}</div>` : ''}`;
    wrap.innerHTML = '';
    wrap.appendChild(el);
    clearTimeout(this._bnT);
    this._bnT = setTimeout(() => el.remove(), 2200);
  }

  popup(text, kind = 'pts') {
    const wrap = $('#popups');
    const el = document.createElement('div');
    el.className = 'pp pp-' + kind;
    el.textContent = text;
    wrap.appendChild(el);
    while (wrap.children.length > 5) wrap.firstChild.remove();
    setTimeout(() => el.remove(), 1700);
  }

  killfeed(html) {
    const wrap = $('#killfeed');
    const el = document.createElement('div');
    el.className = 'kf';
    el.innerHTML = html;
    wrap.prepend(el);
    while (wrap.children.length > 5) wrap.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 5000);
    setTimeout(() => el.remove(), 5600);
  }

  showPause(on) { $('#pause').hidden = !on; }

  showDead(on, info) {
    const el = $('#dead');
    el.hidden = !on;
    if (on && info) {
      $('#dead-reason').textContent = info.reason;
      $('#dead-stats').innerHTML = Object.entries(info.stats).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    }
  }

  setTouchState(name, on) {
    const b = $(`#touch [data-t="${name}"]`);
    if (b) b.classList.toggle('on', !!on);
  }

  setThrottleKnob(v, ab) {
    if (this._thrActive) return;
    const k = $('#thr-knob'), f = $('#thr-fill');
    if (k) k.style.bottom = `calc(${v * 100}% - 18px)`;
    if (f) { f.style.height = v * 100 + '%'; f.classList.toggle('ab', !!ab); }
  }

  /* ------------------------------ 터치 조작 ------------------------------ */
  _bindTouch() {
    const g = this.game;
    const input = () => g.input;
    // 조이스틱 (화면 왼쪽 아무 곳이나 누르면 그 자리가 중심)
    const zone = $('#stick-zone'), base = $('#stick'), knob = $('#stick-knob');
    let sid = null, ox = 0, oy = 0;
    const R = 62;
    const set = (x, y) => {
      let dx = x - ox, dy = y - oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.35);
      const inp = input();
      inp.v.roll = curve(dx / R);
      inp.v.pitch = curve(dy / R);
    };
    zone.addEventListener('pointerdown', (e) => {
      sid = e.pointerId;
      zone.setPointerCapture(sid);
      const r = zone.getBoundingClientRect();
      ox = clamp(e.clientX, r.left + R + 10, r.right - R - 10);
      oy = clamp(e.clientY, r.top + R + 10, r.bottom - R - 10);
      base.style.left = ox - r.left + 'px';
      base.style.top = oy - r.top + 'px';
      base.classList.add('active');
      set(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === sid) set(e.clientX, e.clientY); });
    const end = (e) => {
      if (e.pointerId !== sid) return;
      sid = null;
      base.classList.remove('active');
      base.style.left = ''; base.style.top = '';
      knob.style.transform = 'translate(0,0)';
      const inp = input();
      inp.v.roll = 0; inp.v.pitch = 0;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    // 버튼
    for (const b of $$('#touch [data-t]')) {
      const name = b.dataset.t;
      const hold = name === 'fire' || name === 'yawL' || name === 'yawR';
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        const inp = input();
        if (navigator.vibrate && name === 'fire') try { navigator.vibrate(12); } catch (er) { /* noop */ }
        if (name === 'fire') inp.v.fire = true;
        else if (name === 'yawL') inp.v.yaw = -1;
        else if (name === 'yawR') inp.v.yaw = 1;
        else if (name === 'ab') { inp.v.ab = !inp.v.ab; this.setTouchState('ab', inp.v.ab); }
        else inp.taps.add(name);
        if (hold) b.classList.add('on');
      });
      const up = () => {
        const inp = input();
        if (name === 'fire') inp.v.fire = false;
        if (name === 'yawL' || name === 'yawR') inp.v.yaw = 0;
        if (hold) b.classList.remove('on');
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }

    // 스로틀 슬라이더
    const track = $('#thr-track');
    let tid = null;
    const setT = (e) => {
      const r = track.getBoundingClientRect();
      const v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      input().v.throttle = v;
      const k = $('#thr-knob'), f = $('#thr-fill');
      k.style.bottom = `calc(${v * 100}% - 18px)`;
      f.style.height = v * 100 + '%';
    };
    track.addEventListener('pointerdown', (e) => { tid = e.pointerId; track.setPointerCapture(tid); this._thrActive = true; setT(e); });
    track.addEventListener('pointermove', (e) => { if (e.pointerId === tid) setT(e); });
    const tend = (e) => { if (e.pointerId === tid) { tid = null; this._thrActive = false; } };
    track.addEventListener('pointerup', tend);
    track.addEventListener('pointercancel', tend);
  }

  /* ------------------------------ 설정 ------------------------------ */
  buildSettings() {
    const body = $('#settings-body');
    const groups = [
      ['그래픽', [
        ['quality', '그래픽 품질', 'select', { low: '낮음 (모바일)', medium: '중간', high: '높음', ultra: '울트라' }],
        ['renderScale', '렌더 해상도', 'range', [0.5, 1.6, 0.05], (v) => Math.round(v * 100) + '%'],
        ['bloom', '블룸 (빛 번짐)', 'toggle'],
        ['shadows', '실시간 그림자', 'toggle'],
        ['volumetricClouds', '입체 구름', 'toggle'],
        ['cloudDensity', '구름 양', 'range', [0, 2, 0.1], (v) => v.toFixed(1)],
        ['fov', '시야각 (FOV)', 'range', [55, 100, 1], (v) => v + '°'],
        ['impactFx', '화면 임팩트 효과', 'range', [0, 1.5, 0.05], (v) => Math.round(v * 100) + '%'],
      ]],
      ['조작', [
        ['mouseFlight', '마우스 조종 (클릭으로 커서 고정)', 'toggle'],
        ['sensitivity', '조종 감도', 'range', [0.4, 2.2, 0.05], (v) => v.toFixed(2)],
        ['invertPitch', '피치 반전', 'toggle'],
        ['autoLevel', '자동 수평 보조', 'select', { auto: '자동 (터치 기기)', on: '켜기', off: '끄기' }],
        ['onScreenControls', '화면 조작 버튼', 'select', { auto: '자동', on: '항상 표시', off: '숨김' }],
        ['hudColor', 'HUD 색상', 'select', { green: '그린', cyan: '시안', amber: '앰버', white: '화이트' }],
      ]],
      ['환경', [
        ['timeOfDay', '시간대', 'range', [0, 24, 0.25], (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`],
        ['dayNightRunning', '시간 흐름', 'toggle'],
        ['weather', '날씨', 'select', { clear: '맑음', cloudy: '구름 조금', overcast: '흐림', storm: '폭풍' }],
      ]],
      ['사운드', [
        ['masterVolume', '전체 볼륨', 'range', [0, 1, 0.05], (v) => Math.round(v * 100) + '%'],
        ['engineVolume', '엔진', 'range', [0, 1.5, 0.05], (v) => Math.round(v * 100) + '%'],
        ['effectVolume', '효과음', 'range', [0, 1.5, 0.05], (v) => Math.round(v * 100) + '%'],
        ['musicVolume', '음악', 'range', [0, 1, 0.05], (v) => Math.round(v * 100) + '%'],
        ['flightMusic', '비행 중 음악', 'toggle'],
      ]],
    ];
    body.innerHTML = '';
    for (const [title, items] of groups) {
      const sec = document.createElement('section');
      sec.className = 'set-group';
      sec.innerHTML = `<h3>${title}</h3>`;
      for (const [key, label, type, opt, fmt] of items) {
        const row = document.createElement('label');
        row.className = 'set-row';
        const v = Settings.get(key);
        if (type === 'toggle') {
          row.innerHTML = `<span>${label}</span><input type="checkbox" class="tg" ${v ? 'checked' : ''}>`;
          row.querySelector('input').addEventListener('change', (e) => this._set(key, e.target.checked));
        } else if (type === 'select') {
          row.innerHTML = `<span>${label}</span><select>${Object.entries(opt).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
          row.querySelector('select').addEventListener('change', (e) => this._set(key, e.target.value));
        } else {
          const [mn, mx, stp] = opt;
          row.innerHTML = `<span>${label}</span><div class="rg"><input type="range" min="${mn}" max="${mx}" step="${stp}" value="${v}"><em>${fmt(+v)}</em></div>`;
          const inp = row.querySelector('input'), em = row.querySelector('em');
          inp.addEventListener('input', () => { em.textContent = fmt(+inp.value); this._set(key, +inp.value); });
        }
        sec.appendChild(row);
      }
      body.appendChild(sec);
    }
    const reset = document.createElement('button');
    reset.className = 'btn ghost';
    reset.textContent = '기본값으로 초기화';
    reset.addEventListener('click', () => { Settings.reset(); this.buildSettings(); this.game.onSettings('*'); });
    body.appendChild(reset);
  }

  _set(key, v) {
    Settings.set(key, v);
    if (key === 'quality') this.buildSettings();
    this.game.onSettings(key);
  }

  buildControls() {
    const rows = [
      ['조종', [['S / ↓', '기수 올림 (당기기)'], ['W / ↑', '기수 내림'], ['A / D', '좌/우 롤'], ['Q / E', '러더 (요)'], ['마우스', '클릭 후 마우스로 조종 (커서 고정)']]],
      ['엔진', [['Shift / Ctrl', '스로틀 증가 / 감소'], ['휠', '스로틀 조절'], ['Tab / B (누름)', '애프터버너']]],
      ['무장', [['Space / 좌클릭', '기관포 연사'], ['F / 우클릭', '미사일 발사 (락온 시 유도)'], ['X / C', '플레어 살포']]],
      ['시점·기타', [['V', '시점 전환 (3인칭 · 1인칭 · 원거리 · 시네마틱)'], ['마우스 드래그', '둘러보기'], ['H', 'HUD 숨기기'], ['ESC / P', '일시정지']]],
      ['게임패드', [['왼쪽 스틱', '피치 / 롤'], ['오른쪽 스틱', '요'], ['RT / LT', '기관포 / 애프터버너'], ['A / B', '미사일 / 플레어'], ['RB / LB', '스로틀'], ['Y', '시점']]],
      ['모바일', [['왼쪽 화면 드래그', '가상 조종간 (아래로 = 기수 올림)'], ['오른쪽 세로 슬라이더', '스로틀'], ['FIRE (누름)', '기관포'], ['MSL / FLR', '미사일 / 플레어'], ['A/B', '애프터버너 켜기/끄기']]],
    ];
    $('#controls-body').innerHTML = rows.map(([t, list]) => `
      <section class="set-group"><h3>${t}</h3>${list.map(([k, d]) => `<div class="key-row"><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</section>`).join('') +
      `<section class="set-group tips"><h3>에이스의 팁</h3>
        <p>· 미사일 탐색원 안에 적을 1초간 유지하면 <b>LOCK</b> — 그때 발사하면 유도됩니다.</p>
        <p>· 기관포는 <b>리드 조준점(원)</b>에 기수 표시(W)를 겹치면 명중합니다.</p>
        <p>· 연속 격추로 <b>콤보 배율</b>이 오릅니다. 근접 통과, 초저공 비행, 음속 돌파도 보너스!</p>
        <p>· MISSILE 경보 시 플레어(X)를 뿌리고 미사일 반대 방향으로 급선회하세요.</p></section>`;
  }
}
