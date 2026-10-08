// 인터페이스: 설정 패널 · 상황판(구별 현황) · 감정 분포 · 말풍선 · 인물 카드 · 1인칭 HUD · 미니맵 · 경보
import * as THREE from 'three';
import { WORLD, HALF, DISTRICTS, EMOTIONS, SOURCE_TYPES, QUALITY, PERSON_TYPES } from './config.js';
import { KNOLLS } from './geo.js';

const $ = (id) => document.getElementById(id);
const STATE_NAME = { normal: '평상시', evac: '대피 중', safe: '대피 완료 (고지대)', roof: '옥상 대피', inside: '건물 계단 오르는 중', swept: '물살에 휩쓸림', missing: '실종' };
const _p = new THREE.Vector3();

export class UI {
  constructor(game) {
    this.g = game;
    this.srcType = 'quake';
    this.power = 0.6;
    this.warnOn = true;
    this.markersOn = true;
    this.bubblesOn = true;
    this.t = 0; this.statT = 0; this.cardT = 0; this.mapT = 0;
    this.labelPool = [];
    this.buildPanels();
    this.buildMinimap();
    this.computeDistrictCentroids();
    document.body.classList.add('ready');
  }

  buildPanels() {
    const g = this.g;
    // 발생원 종류
    const box = $('src-types');
    for (const [k, s] of Object.entries(SOURCE_TYPES)) {
      const b = document.createElement('button');
      b.className = 'type' + (k === this.srcType ? ' on' : '');
      b.dataset.k = k;
      b.innerHTML = `<span class="ic">${s.icon}</span><span>${s.name}</span>`;
      b.onclick = () => { this.srcType = k; for (const c of box.children) c.classList.toggle('on', c.dataset.k === k); this.syncPower(); g.audio.start(); g.audio.click(); };
      box.appendChild(b);
    }
    const pw = $('power');
    pw.oninput = () => { this.power = pw.value / 100; this.syncPower(); };
    this.power = pw.value / 100;
    this.syncPower();
    $('opt-warn').onchange = (e) => { this.warnOn = e.target.checked; };
    $('opt-flood').onchange = (e) => { g.terrainU.uOverlay.value = e.target.checked ? 1 : 0; };
    $('opt-dist').onchange = (e) => { g.terrainU.uDistAlpha.value = e.target.checked ? 0.85 : 0; this.distLabels = e.target.checked; };
    $('opt-markers').onchange = (e) => { this.markersOn = e.target.checked; };
    $('opt-bubbles').onchange = (e) => { this.bubblesOn = e.target.checked; };
    const tod = $('tod');
    const syncTod = () => { g.timeOfDay = +tod.value; $('tod-val').textContent = g.clockText(); g.envDirty = true; };
    tod.oninput = syncTod;
    syncTod();
    const q = $('quality');
    for (const [k, v] of Object.entries(QUALITY)) { const o = document.createElement('option'); o.value = k; o.textContent = v.label; if (k === g.qKey) o.selected = true; q.appendChild(o); }
    q.onchange = () => { try { localStorage.setItem('tsunami.quality', q.value); } catch (e) { /* */ } location.search = ''; location.reload(); };
    const vol = $('vol');
    vol.oninput = () => { g.audio.volume = vol.value / 100 * 1.1; g.audio.start(); };
    g.audio.volume = vol.value / 100 * 1.1;
    $('btn-reset').onclick = () => { g.resetWorld(); this.toast('↺ 도시를 처음 상태로 되돌렸습니다', 'info'); };
    $('btn-help').onclick = () => $('help').classList.remove('hidden');
    $('help-start').onclick = () => { $('help').classList.add('hidden'); g.audio.start(); };
    for (const b of document.querySelectorAll('#speed button')) b.onclick = () => { g.setSpeed(+b.dataset.s); g.audio.start(); };
    $('m-map').onclick = () => g.setMode('map');
    $('m-fp').onclick = () => { g.audio.start(); g.setMode('fp'); };
    $('place-now').onclick = () => g.quickPlace();
    $('place-cancel').onclick = () => g.setMode('map');
    $('btn-left').onclick = () => document.body.classList.toggle('show-left');
    $('btn-right').onclick = () => document.body.classList.toggle('show-right');
    $('banner').onclick = () => $('banner').classList.add('hidden');
    $('t-run').onclick = () => { g.input.runToggle = !g.input.runToggle; $('t-run').classList.toggle('on', g.input.runToggle); };
    $('t-jump').onpointerdown = (e) => { e.stopPropagation(); g.input.jumpPressed = true; };
    $('t-act').onpointerdown = (e) => { e.stopPropagation(); g.input.actPressed = true; };
    $('fp-exit').onclick = () => g.setMode('map');
    // 감정 범례
    $('emo-legend').innerHTML = Object.values(EMOTIONS).map((e) => `<span><i style="background:${e.color}"></i>${e.emoji} ${e.name}</span>`).join('');
    if (innerWidth > 900) document.body.classList.add('show-left', 'show-right');
  }

  syncPower() {
    const p = this.power, t = this.srcType;
    let s;
    if (t === 'quake') s = `M ${(7 + 2.5 * p).toFixed(1)}`;
    else if (t === 'landslide') s = `토사 ${(0.5 + 9.5 * p).toFixed(1)}억 m³`;
    else if (t === 'impact') s = `지름 ${Math.round(50 + 450 * p)} m`;
    else s = `파고 ${(2 + 14 * p).toFixed(1)} m`;
    $('power-val').textContent = s;
    $('src-desc').textContent = SOURCE_TYPES[t].desc;
  }

  syncSpeed() {
    const g = this.g;
    for (const b of document.querySelectorAll('#speed button')) {
      const s = +b.dataset.s;
      b.classList.toggle('on', g.paused ? s === 0 : s === g.timeScale);
    }
  }

  toggleBubbles() { this.bubblesOn = !this.bubblesOn; $('opt-bubbles').checked = this.bubblesOn; }

  setMode(m) {
    const b = document.body;
    b.classList.toggle('mode-map', m === 'map');
    b.classList.toggle('mode-fp', m === 'fp');
    b.classList.toggle('mode-npc', m === 'npc');
    b.classList.toggle('mode-place', m === 'place');
    $('m-map').classList.toggle('on', m === 'map' || m === 'place');
    $('m-fp').classList.toggle('on', m === 'fp' || m === 'npc');
    if (m === 'fp' || m === 'npc') this.hideCard();
  }

  toast(msg, kind = 'info') {
    const log = $('log');
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    const t = this.g.eventT0 === null ? '' : `<small>T+${fmtShort(this.g.simTime - this.g.eventT0)}</small>`;
    d.innerHTML = `${t}${msg}`;
    log.prepend(d);
    while (log.children.length > 6) log.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), kind === 'alert' ? 14000 : 9000);
    setTimeout(() => d.remove(), kind === 'alert' ? 15000 : 10000);
  }

  banner(text) {
    const b = $('banner');
    b.textContent = text;
    b.classList.remove('hidden');
  }

  phone(text) {
    const p = $('phone');
    p.querySelector('.ph-body').textContent = text;
    p.classList.remove('hidden');
    p.classList.add('ring');
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 800]);
    clearTimeout(this.phoneT);
    this.phoneT = setTimeout(() => { p.classList.add('hidden'); p.classList.remove('ring'); }, 11000);
  }

  reset() {
    $('banner').classList.add('hidden');
    $('phone').classList.add('hidden');
    $('log').innerHTML = '';
    this.hideCard();
    this.statT = 0;
  }

  /* ───────────────────────── 인물 카드 ───────────────────────── */
  showCard(p) {
    if (!p) { this.hideCard(); return; }
    const g = this.g;
    this.cardP = p;
    const card = $('card');
    card.classList.remove('hidden');
    // 버튼은 한 번만 만들고, 본문만 주기적으로 갱신 (클릭 유실 방지)
    card.innerHTML = `<button class="x" id="card-x">✕</button><div id="card-body"></div>
      <div class="c-btns"><button id="card-view">👁 이 사람 시점</button><button id="card-follow">📍 따라가기</button><button id="card-play">🎮 여기서 조종</button></div>`;
    $('card-x').onclick = () => { g.select(null); };
    $('card-view').onclick = () => { const q = this.cardP; if (!q || q.state === 'missing') return; g.selected = q; g.npcYaw = undefined; g.npcLook.yaw = 0; g.setMode('npc'); };
    $('card-follow').onclick = () => { const q = this.cardP; if (!q) return; g.follow = true; g.mapCam.focus(q.x, q.z, 220); };
    $('card-play').onclick = () => { const q = this.cardP; if (!q) return; g.startFP(q.x + 1, q.z + 1); };
    $('card-body').onclick = (e) => { const s = e.target.closest('.fam'); if (s) g.select(g.people.list[+s.dataset.i]); };
    this.renderCard(true);
  }

  hideCard() { this.cardP = null; $('card').classList.add('hidden'); }

  renderCard(full) {
    const p = this.cardP, g = this.g;
    if (!p) return;
    const e = EMOTIONS[p.emotion] || EMOTIONS.calm;
    const bar = (v, c) => `<div class="mb"><div style="width:${Math.round(v * 100)}%;background:${c}"></div></div>`;
    const group = g.people.groups[p.group] || [];
    const fam = group.filter((o) => o !== p).map((o) => {
      const oe = EMOTIONS[o.emotion] || EMOTIONS.calm;
      return `<span class="fam" data-i="${o.i}">${oe.emoji} ${o.name}(${o.age})</span>`;
    }).join('') || '<span class="dim">혼자</span>';
    const typeName = PERSON_TYPES[p.type].name;
    $('card-body').innerHTML = `
      <div class="c-head"><div class="c-emo" style="background:${e.color}">${e.emoji}</div>
        <div><b>${p.name}</b> <span class="dim">${p.age}세 · ${p.sex === 'M' ? '남' : '여'} · ${typeName}</span><br>
        <span class="dim">${p.roleName} · ${DISTRICTS[p.district].name} · 키 ${p.height.toFixed(2)} m</span></div></div>
      <div class="c-state"><span style="color:${e.color}">${e.name}</span> · ${STATE_NAME[p.state] || p.state}</div>
      <div class="c-thought">${p.thought ? '“' + p.thought + '”' : '…'}</div>
      <div class="c-grid">
        <span>❤ 심박</span><b>${Math.round(p.heart)} bpm</b>
        <span>공포</span>${bar(p.fear, '#ff5a3a')}
        <span>체력</span>${bar(p.stamina, '#5ed67d')}
        <span>침착성</span>${bar(p.composure, '#7fb8ff')}
        <span>이타심</span>${bar(p.altruism, '#ffc94a')}
        <span>호기심</span>${bar(p.curiosity, '#43d3c6')}
        <span>재난 대비</span>${bar(p.prep, '#c48bff')}
        <span>수심</span><b>${p.depth > 0.02 ? p.depth.toFixed(2) + ' m' : '-'}</b>
      </div>
      <div class="c-fam">일행: ${fam}</div>`;
  }

  /* ───────────────────────── 미니맵 ───────────────────────── */
  buildMinimap() {
    const g = this.g, S = 256;
    const base = document.createElement('canvas');
    base.width = base.height = S;
    const c = base.getContext('2d'), img = c.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -HALF + (i + 0.5) * WORLD / S, z = -HALF + (j + 0.5) * WORLD / S;
      const h = g.terrain.terrainAt(x, z), o = (j * S + i) * 4;
      const hx = g.terrain.terrainAt(x + 8, z) - g.terrain.terrainAt(x - 8, z), hz = g.terrain.terrainAt(x, z + 8) - g.terrain.terrainAt(x, z - 8);
      const shade = Math.max(0.55, Math.min(1.25, 1 - (hx - hz) * 0.04));
      let r, gg, b;
      if (h < 0) { const d = Math.min(1, -h / 60); r = 30 - d * 20; gg = 90 - d * 50; b = 140 - d * 50; }
      else if (h < 2.8) { r = 210; gg = 196; b = 150; }
      else { const t = Math.min(1, h / 80); r = (95 - t * 40) * shade; gg = (130 - t * 40) * shade; b = (70 - t * 30) * shade; }
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    c.fillStyle = 'rgba(60,60,60,0.85)';
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
        if (h > 0.05) { const a = Math.min(1, 0.35 + h * 0.2); d[o] = 30; d[o + 1] = 110; d[o + 2] = 255; d[o + 3] = a * 255; }
        else d[o + 3] = 0;
      } else {
        const eta = h + sim.b[k];
        if (eta > 0.4) { d[o] = 255; d[o + 1] = 70; d[o + 2] = 60; d[o + 3] = Math.min(220, eta * 40); }
        else if (eta < -0.4) { d[o] = 200; d[o + 1] = 240; d[o + 2] = 255; d[o + 3] = Math.min(200, -eta * 40); }
        else d[o + 3] = 0;
      }
    }
    this.mmWater.getContext('2d').putImageData(this.mmImg, 0, 0);
    const cv = $('minimap'), c = cv.getContext('2d'), W = cv.width;
    let cx, cz, hx, hz;
    if (g.mode === 'npc' && g.selected) { cx = g.selected.x; cz = g.selected.z; hx = Math.sin(g.selected.yaw); hz = Math.cos(g.selected.yaw); }
    else { cx = g.player.x; cz = g.player.z; hx = -Math.sin(g.player.yaw); hz = -Math.cos(g.player.yaw); }
    const span = 1400;
    const sx = (cx - span / 2 + HALF) / WORLD, sz = (cz - span / 2 + HALF) / WORLD, sw = span / WORLD;
    c.fillStyle = '#0a1a28'; c.fillRect(0, 0, W, W);
    c.drawImage(this.mmBase, sx * 256, sz * 256, sw * 256, sw * 256, 0, 0, W, W);
    c.drawImage(this.mmWater, sx * N, sz * N, sw * N, sw * N, 0, 0, W, W);
    const toS = (x, z) => [(x - cx + span / 2) / span * W, (z - cz + span / 2) / span * W];
    c.fillStyle = '#39e07a';
    for (const b of g.city.shelters) { const [x, y] = toS(b.x, b.z); if (x > 0 && y > 0 && x < W && y < W) { c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); } }
    // 플레이어 화살표
    c.save(); c.translate(W / 2, W / 2); c.rotate(Math.atan2(hx, -hz));
    c.fillStyle = '#ffe14a'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
    c.fillStyle = 'rgba(255,255,255,0.8)'; c.font = '10px sans-serif'; c.fillText('N', W / 2 - 3, 11);
  }

  computeDistrictCentroids() {
    const g = this.g, sim = g.sim, N = sim.N;
    const acc = DISTRICTS.map(() => ({ x: 0, z: 0, n: 0, land: 0 }));
    for (let k = 0; k < N * N; k++) {
      const d = g.distMap[k];
      if (d < 0) continue;
      const i = k % N, j = (k - i) / N;
      acc[d].x += -HALF + (i + 0.5) * sim.dx; acc[d].z += -HALF + (j + 0.5) * sim.dx; acc[d].n++;
    }
    this.centroids = acc.map((a, i) => ({ x: a.x / Math.max(1, a.n), z: a.z / Math.max(1, a.n), id: i, cells: a.n }));
    this.centroids[5].z = Math.max(this.centroids[5].z, -1350);
  }

  /* ───────────────────────── 매 프레임 ───────────────────────── */
  update(dt) {
    const g = this.g;
    this.t += dt;
    // 시계
    const ck = $('clock');
    if (g.eventT0 === null) ck.innerHTML = `평상시 · ${g.clockText()}`;
    else ck.innerHTML = `<b>T+${fmtShort(g.simTime - g.eventT0)}</b> ${g.paused ? '⏸' : g.timeScale !== 1 ? g.timeScale + '×' : ''}`;
    ck.classList.toggle('alert', g.eventT0 !== null);
    // 상황판
    this.statT -= dt;
    if (this.statT <= 0) { this.statT = 0.5; this.renderStats(); }
    this.cardT -= dt;
    if (this.cardT <= 0 && this.cardP) { this.cardT = 0.3; this.renderCard(); }
    if (this.cardP && this.cardP.state === 'missing' && g.mode === 'npc') g.setMode('map');
    this.renderLabels();
    // 1인칭 HUD
    if (g.mode === 'fp' || g.mode === 'npc') {
      const P = g.mode === 'fp' ? g.player : g.selected;
      if (P) {
        const e = EMOTIONS[P.emotion] || EMOTIONS.calm;
        $('fp-emo').innerHTML = `<i style="background:${e.color}">${e.emoji}</i>${e.name}`;
        $('fp-heart').innerHTML = `❤ ${Math.round(P.heart)}`;
        $('fp-heart').style.animationDuration = (60 / Math.max(50, P.heart)) + 's';
        $('fp-stam').style.width = Math.round(P.stamina * 100) + '%';
        let status = '';
        if (g.mode === 'fp') {
          status = g.player.status || '';
          if (g.player.depth > 0.05 && g.player.state !== 'swept') status = `수심 ${g.player.depth.toFixed(2)} m — 물살이 세지면 휩쓸립니다!`;
          if (g.player.safe && g.sim.active) status = '안전한 높이입니다. 바다를 지켜보세요.';
          $('fp-prompt').textContent = g.player.prompt;
          $('fp-prompt').classList.toggle('on', !!g.player.prompt);
          $('t-act').classList.toggle('on', !!g.player.prompt);
        } else {
          status = `${P.name} (${P.age}) — ${STATE_NAME[P.state] || ''}${P.thought ? ' · “' + P.thought + '”' : ''}`;
          $('fp-prompt').classList.remove('on');
        }
        $('fp-status').textContent = status;
        const fear = P.fear;
        $('fx-vig').style.opacity = Math.max(0, (fear - 0.3) * 1.2).toFixed(2);
        $('fx-vig').style.animationDuration = (60 / Math.max(50, P.heart)) + 's';
      }
      this.mapT -= dt;
      if (this.mapT <= 0) { this.mapT = 0.25; this.drawMinimap(); }
    } else $('fx-vig').style.opacity = 0;
    $('fx-under').classList.toggle('on', !!g.underwater);
    $('fx-flash').style.opacity = Math.min(1, g.flash * 1.4).toFixed(2);
  }

  renderStats() {
    const g = this.g;
    const st = g.people.stats(DISTRICTS.length);
    const T = st.total;
    const sim = g.sim, N = sim.N;
    // 구별 침수
    const fl = DISTRICTS.map(() => ({ land: 0, wet: 0, maxD: 0 }));
    for (let k = 0; k < N * N; k += 2) {
      const d = g.distMap[k];
      if (d < 0) continue;
      fl[d].land++;
      const m = sim.maxH[k];
      if (m > 0.3) fl[d].wet++;
      if (m > fl[d].maxD) fl[d].maxD = m;
    }
    this.flood = fl;
    let floodArea = 0;
    for (const f of fl) floodArea += f.wet * 2 * sim.dx * sim.dx;
    const bars = Object.entries(st.emo).sort((a, b) => b[1] - a[1]);
    const alive = T.pop - (T.missing || 0);
    $('emo-bar').innerHTML = bars.map(([k, n]) => `<i title="${EMOTIONS[k].name} ${n}명" style="flex:${n};background:${EMOTIONS[k].color}"></i>`).join('');
    $('summary').innerHTML = `
      <div class="kv"><span>인구</span><b>${T.pop}</b></div>
      <div class="kv ok"><span>대피 완료</span><b>${T.safe || 0}</b></div>
      <div class="kv mid"><span>대피 중</span><b>${T.evac || 0}</b></div>
      <div class="kv"><span>미대피</span><b>${T.normal || 0}</b></div>
      <div class="kv bad"><span>휩쓸림</span><b>${T.swept || 0}</b></div>
      <div class="kv bad"><span>실종</span><b>${T.missing || 0}</b></div>
      <div class="kv"><span>해안 최고 수위</span><b>${sim.coastMax.toFixed(1)} m</b></div>
      <div class="kv"><span>침수 면적</span><b>${(floodArea / 1e6).toFixed(2)} km²</b></div>
      <div class="kv"><span>붕괴 건물</span><b>${g.collapses}</b></div>
      <div class="kv"><span>주된 감정</span><b>${bars[0] ? EMOTIONS[bars[0][0]].emoji + ' ' + EMOTIONS[bars[0][0]].name : '-'}</b></div>`;
    $('districts').innerHTML = DISTRICTS.map((D, i) => {
      const s = st.districts[i], f = fl[i];
      const pop = Math.max(1, s.pop);
      const w = (n) => (n / pop * 100).toFixed(1) + '%';
      const flooded = f.land ? f.wet / f.land : 0;
      return `<div class="dist" data-i="${i}">
        <div class="d-h"><i style="background:${D.color}"></i><b>${D.name}</b><span class="dim">${D.desc}</span></div>
        <div class="d-bar"><i class="ok" style="width:${w(s.safe)}"></i><i class="mid" style="width:${w(s.evac)}"></i><i class="bad" style="width:${w(s.swept + s.missing)}"></i></div>
        <div class="d-n"><span>👥 ${s.pop}</span><span class="ok">✔ ${s.safe}</span><span class="mid">🏃 ${s.evac}</span><span class="bad">🌊 ${s.swept + s.missing}</span>
        <span>침수 ${(flooded * 100).toFixed(0)}% · 최대 ${f.maxD.toFixed(1)} m</span>${g.collapseByDistrict[i] ? `<span class="bad">🏚 ${g.collapseByDistrict[i]}</span>` : ''}</div></div>`;
    }).join('');
    for (const el of document.querySelectorAll('#districts .dist')) el.onclick = () => {
      const c = this.centroids[+el.dataset.i];
      g.setMode('map'); g.mapCam.focus(c.x, c.z, 1200);
    };
    $('alive-pct') && ($('alive-pct').textContent = alive);
  }

  label(i) {
    let el = this.labelPool[i];
    if (!el) { el = document.createElement('div'); el.className = 'lb'; $('labels').appendChild(el); this.labelPool[i] = el; }
    return el;
  }

  renderLabels() {
    const g = this.g, cam = g.camera, W = innerWidth, H = innerHeight;
    let n = 0;
    const put = (x, y, z, html, cls) => {
      _p.set(x, y, z).project(cam);
      if (_p.z > 1 || _p.x < -1.2 || _p.x > 1.2 || _p.y < -1.2 || _p.y > 1.2) return false;
      const el = this.label(n++);
      const key = cls + html;
      if (el._k !== key) { el._k = key; el.className = 'lb ' + cls; el.innerHTML = html; }
      el.style.transform = `translate(${((_p.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-_p.y * 0.5 + 0.5) * H).toFixed(1)}px)`;
      el.style.display = '';
      return true;
    };
    const mapMode = g.mode === 'map' || g.mode === 'place';
    const camY = cam.position.y;
    // 구 이름
    if (mapMode && (this.distLabels || camY > 900)) {
      for (const c of this.centroids) {
        if (!c.cells) continue;
        const D = DISTRICTS[c.id];
        put(c.x, Math.max(0, g.terrain.groundAt(c.x, c.z)) + 30, c.z, `<b style="color:${D.color}">${D.name}</b>`, 'dist-lb');
      }
    }
    // 대피소
    if (mapMode && camY < 2800) {
      for (const b of g.city.shelters) put(b.x, b.top + 6, b.z, '🟢 대피소', 'shelter-lb');
      for (const k of KNOLLS) put(k.x, g.terrain.groundAt(k.x, k.z) + 14, k.z, `⛰ ${k.name}`, 'shelter-lb');
    }
    // 말풍선 (가까운 사람)
    if (this.bubblesOn) {
      const near = [];
      const px = cam.position.x, pz = cam.position.z;
      const maxD = mapMode ? Math.min(260, Math.max(0, 420 - camY)) : 55;
      if (maxD > 10) {
        for (const p of g.people.list) {
          if (p.state === 'missing' || p.state === 'inside') continue;
          if (g.mode === 'npc' && p === g.selected) continue;
          const d = Math.hypot(p.x - px, p.z - pz);
          if (d < maxD) near.push([d, p]);
        }
        near.sort((a, b) => a[0] - b[0]);
        const lim = mapMode ? 18 : 12;
        for (let i = 0; i < Math.min(lim, near.length); i++) {
          const p = near[i][1];
          const e = EMOTIONS[p.emotion] || EMOTIONS.calm;
          const showT = p.thoughtT > 0 && p.thought;
          put(p.x, p.y + p.height + (p.state === 'swept' ? 0.6 : 0.45), p.z,
            `<i style="background:${e.color}">${e.emoji}</i>${showT ? `<span>${p.thought}</span>` : ''}`, 'bub' + (p === g.selected ? ' sel' : ''));
        }
      }
    }
    if (g.selected && mapMode && g.selected.state !== 'missing') {
      const p = g.selected;
      put(p.x, p.y + p.height + 3, p.z, `<b>${p.name}</b>`, 'sel-lb');
    }
    for (let i = n; i < this.labelPool.length; i++) if (this.labelPool[i].style.display !== 'none') this.labelPool[i].style.display = 'none';
  }
}

function fmtShort(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
