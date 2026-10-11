// 게임 패널: 지도/사보타주 지도, 보안 카메라, 관리실, 바이탈, 문 기록, 긴급 버튼, 탐정 노트, 인플루언서, 변신 대상, 스폰 선택, 연습 역할, 매치 가이드
import { $, $$, esc, sfx, net, settings, toast, modal } from '../core.js';
import { COLORS, SETTINGS, HNS_SETTINGS, SETTING_GROUPS, HNS_GROUPS, fmtSetting, PRESETS, PRESET_MODES, RULES } from '../shared/data.js';
import { DETECTIVE_GUESS, DETECTIVE_PREP, INFLUENCER } from '../shared/roles.js';
import { MAP_LIST, getMap } from '../shared/maps/index.js';
import { crewSVG, mapIcon } from '../ui/crew.js';
import { scene } from './scene.js';
import { G, R, alive, isImp, commsOn, roleDef, roleName, roleAccent, nameOf, lookOf, now, hnsMode, isSeeker, roomLabel, restartPractice } from './play.js';
import { overlay, dropOverlay, icon, ICON, sabIcon, crewImg, fmtTime, renderTasks, infImg, INF_LABEL } from './hud.js';

// ---------- 패널 관리 (한 번에 하나) ----------
export function openPanel(kind, html, { freeze = true, onClose } = {}) {
  closePanel();
  const el = overlay(html);
  const p = {
    kind, el, freeze, timers: [], raf: 0, silent: false,
    close() { if (G.panel !== p) return; G.panel = null; p.timers.forEach(clearInterval); cancelAnimationFrame(p.raf); try { onClose?.(p); } catch (e) { console.warn(e); } dropOverlay(el); },
  };
  G.panel = p;
  $$('.xbtn', el).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); sfx('click'); p.close(); }));
  return p;
}
export const closePanel = () => G.panel?.close();
const commsStatic = '<div class="static hidden"><b>통신 방해됨</b></div>';

// ---------- 지도 SVG ----------
const geoCache = new WeakMap();
export function geom(m) {
  if (geoCache.has(m)) return geoCache.get(m);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of m.walk || []) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x0 > x1) { x0 = 0; y0 = 0; x1 = m.w || 1000; y1 = m.h || 1000; }
  const pad = Math.max(120, (x1 - x0) * 0.03);
  const g = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  g.u = Math.max(g.w, g.h * 1.6) / 100; // 지도 표시용 기본 단위
  geoCache.set(m, g);
  return g;
}
const pts = p => p.map(q => `${Math.round(q[0])},${Math.round(q[1])}`).join(' ');
export function baseMap(m, { labels = true } = {}) {
  const g = geom(m), all = [...(m.halls || []).map(x => x.poly), ...(m.rooms || []).map(r => r.poly)];
  const fs = Math.max(70, g.u * 1.55);
  return `<g class="mb-out">${all.map(p => `<polygon points="${pts(p)}" stroke-width="${g.u * 1.1}"/>`).join('')}</g>
    <g class="mb-in">${all.map(p => `<polygon points="${pts(p)}"/>`).join('')}</g>
    <g class="mb-room">${(m.rooms || []).map(r => `<polygon points="${pts(r.poly)}" stroke-width="${g.u * 0.25}"/>`).join('')}</g>
    ${labels ? `<g class="mb-lab" font-size="${fs}">${(m.rooms || []).filter(r => r.name).map(r => `<text x="${r.label.x}" y="${r.label.y}" stroke-width="${fs * 0.16}">${esc(r.name)}</text>`).join('')}</g>` : ''}`;
}
const vb = g => `${g.x} ${g.y} ${g.w} ${g.h}`;
const icoAt = (k, x, y, s, extra = '') => `<svg x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" viewBox="0 0 100 100" ${extra}>${ICON[k] || ''}</svg>`;
const crewAt = (look, x, y, s, o = {}) => crewSVG(look || {}, { noPet: true, ...o }).replace('<svg', `<svg x="${x - s * 0.5}" y="${y - s * 0.62}" width="${s}" height="${s * 0.72}"`);
// 원형 쿨다운 부채꼴
const pie = (x, y, r, f) => {
  if (f <= 0) return '';
  if (f >= 0.999) return `<circle cx="${x}" cy="${y}" r="${r}" class="pie"/>`;
  const a = f * Math.PI * 2, ex = x + r * Math.sin(a), ey = y - r * Math.cos(a);
  return `<path class="pie" d="M${x} ${y} L${x} ${y - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${ex} ${ey} Z"/>`;
};
const roomById = (m, id) => (m.rooms || []).find(r => r.id === id) || (m.rooms || []).find(r => r.name === id);

// ---------- 지도 / 사보타주 지도 / 술래 지도 ----------
export function openMap() {
  if (G.panel?.kind === 'map') return closePanel();
  const S = G.S, m = G.map, hns = hnsMode();
  const sabMap = isImp() && !hns;
  const g = geom(m);
  const p = openPanel('map', `<div class="mapov2 ${sabMap ? 'sab' : ''}"><div class="mapframe"><div class="maptitle">${esc(m.ko || m.name)}${sabMap ? ' · 방해 공작' : ''}</div>
    <svg class="msvg" viewBox="${vb(g)}" preserveAspectRatio="xMidYMid meet"><g class="base">${baseMap(m)}</g><g class="dyn"></g><g class="btns"></g></svg>
    ${sabMap ? '<div class="maphint">아이콘을 눌러 방해 공작을 시작하세요</div>' : ''}</div><button class="xbtn">✕</button></div>`, { freeze: false });
  const dyn = $('.dyn', p.el), btns = $('.btns', p.el);
  const draw = () => {
    if (!G.S?.game) return p.close();
    const t = now(), u = g.u, comms = commsOn();
    let out = '';
    // 내 임무 위치 (노란 느낌표)
    if (!isImp() && !comms) for (const id of scene.taskStations || []) { const s = m.stations[id]; if (s) out += `<g class="tmark"><path d="M${s.x - u * 1.1} ${s.y - u * 3.2} h${u * 2.2} l${-u * 0.5} ${u * 2.4} h${-u * 1.2}z" class="tm1"/><circle cx="${s.x}" cy="${s.y}" r="${u * 0.55}" class="tm1"/></g>`; }
    // 고쳐야 할 사보타주 위치 (깜빡임)
    if (S.sab) for (const id of scene.sabTargets || []) { const s = m.stations[id]; if (s) out += `<circle class="sabpt" cx="${s.x}" cy="${s.y}" r="${u * 1.6}" stroke-width="${u * 0.35}"/>`; }
    // 닫힌 문
    for (const id of scene.doorsClosed || []) { const d = m.doorById?.[id]; if (d) out += `<rect class="dclosed" x="${d.x}" y="${d.y}" width="${Math.max(d.w, u * 0.6)}" height="${Math.max(d.h, u * 0.6)}"/>`; }
    // 추적자 대상 (실제 색)
    if (S.track && isFinite(S.track.x) && !comms && !S.track.comms) out += `<g class="trk"><circle cx="${S.track.x}" cy="${S.track.y - u * 1.2}" r="${u * 2.8}" fill="none" stroke="${S.track.color}" stroke-width="${u * 0.35}"/>${crewAt({ color: lookOf(S.track.id)?.color ?? 0 }, S.track.x, S.track.y, u * 4.4, S.track.dead ? { dead: true } : {})}</g>`;
    // 노이즈 메이커 경보
    for (const n of S.alerts || []) if (n.until > t) out += `<circle class="noisept" cx="${n.x}" cy="${n.y}" r="${u * 2}" stroke-width="${u * 0.4}"/>`;
    // 숨바꼭질 술래 지도
    if (hns && isSeeker() && (S.hns?.seekMap || S.hns?.phase === 'final' && +S.game.settings.finalMap)) {
      for (const pl of scene.players.values()) if (pl.id !== S.you && !S.dead.has(pl.id) && !S.mates.has(pl.id)) out += `<circle class="seekpt" cx="${pl.x}" cy="${pl.y}" r="${u * 0.9}" stroke-width="${u * 0.2}"/>`;
    }
    for (const pg of S.pings || []) if (pg.until > t) out += `<circle class="pingpt" cx="${pg.x}" cy="${pg.y}" r="${u * 1.6}" stroke-width="${u * 0.35}"/>`;
    // 나
    const vp = scene.players.get(scene.viewId ?? S.you) || scene.players.get(S.you);
    if (vp) out += `<g class="meicon">${crewAt(vp.disguise?.look || vp.look, vp.x, vp.y, u * 6.5, vp.dead ? { ghost: true } : {})}</g>`;
    dyn.innerHTML = out;
    if (sabMap) drawSabButtons(g, t);
  };
  const drawSabButtons = (g, t) => {
    const u = g.u, r = u * 2.6, cdl = Math.max(0, S.sabCd || 0), active = !!S.sab;
    const groups = new Map();
    const add = (rid, html) => { const room = roomById(m, rid); if (!room) return; const k = room.id; if (!groups.has(k)) groups.set(k, { room, items: [] }); groups.get(k).items.push(html); };
    for (const [k, d] of Object.entries(m.sabotages || {})) {
      const dis = active || cdl > 0 || S.phase !== 'play';
      add(d.room, (x, y) => `<g class="sbtn ${dis ? 'dis' : ''} ${S.sab?.k === k ? 'act' : ''}" data-sab="${k}"><circle cx="${x}" cy="${y}" r="${r * 1.12}" class="ring"/>${icoAt(sabIcon(k, d), x, y, r * 2)}
        ${cdl > 0 && !active ? pie(x, y, r * 1.05, cdl / (S.sabCdMax || RULES.sabCd * 1000)) + `<text x="${x}" y="${y + r * 0.35}" font-size="${r}" class="cdt">${Math.ceil(cdl / 1000)}</text>` : ''}<title>${esc(d.name)}</title></g>`);
    }
    for (const rid of m.doorRooms || []) {
      const cd = Math.max(0, (S.doorCd?.[rid] || 0) - t);
      const closed = (m.doors || []).some(d => d.room === rid && scene.doorsClosed?.has(d.id));
      const dis = cd > 0 || closed || S.phase !== 'play';
      add(rid, (x, y) => `<g class="dbtn ${dis ? 'dis' : ''} ${closed ? 'shut' : ''}" data-door="${rid}"><rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" rx="${r * 0.3}" class="ring"/>${icoAt('door', x, y, r * 1.7)}
        ${cd > 0 ? pie(x, y, r * 0.95, cd / (S.doorCdMax?.[rid] || RULES.doorCd * 1000)) + `<text x="${x}" y="${y + r * 0.35}" font-size="${r}" class="cdt">${Math.ceil(cd / 1000)}</text>` : ''}<title>${esc(roomById(m, rid)?.name || rid)} 문 닫기</title></g>`);
    }
    let b = '';
    for (const { room, items } of groups.values()) {
      const n = items.length, gap = r * 2.5;
      items.forEach((f, i) => { b += f(room.label.x + (i - (n - 1) / 2) * gap, room.label.y + u * 3.4); });
    }
    if (btns._h !== b) { btns._h = b; btns.innerHTML = b; }
  };
  btns.onclick = e => {
    const sb = e.target.closest('[data-sab]'), db = e.target.closest('[data-door]');
    if (sb && !sb.classList.contains('dis')) { sfx('click'); net.send({ t: 'sab', k: sb.dataset.sab }); closePanel(); }
    else if (db && !db.classList.contains('dis')) { sfx('click'); net.send({ t: 'door', room: db.dataset.door }); }
    else if (sb || db) sfx('click');
  };
  draw();
  p.timers.push(setInterval(draw, 200));
}

// ---------- 보안 카메라 ----------
export function openCams() {
  const m = G.map, views = m.cams?.views || [];
  if (!views.length) return toast('이 맵에는 카메라가 없습니다.');
  const single = !!m.cams.single || views.length > 6 || ['airship', 'fungle'].includes(m.id);
  let cur = 0;
  const cells = single ? 1 : views.length;
  const cols = single ? 1 : cells <= 4 ? 2 : 3;
  const p = openPanel('cams', `<div class="pnlback"><div class="pnl cams ${single ? 'single' : `c${cols}`}"><button class="xbtn">✕</button><h3>${icon('cams')} 보안 카메라</h3>
    <div class="camgrid">${Array.from({ length: cells }, () => `<div class="cam"><canvas width="${single ? 960 : cols === 3 ? 400 : 560}" height="${single ? 540 : cols === 3 ? 240 : 320}"></canvas><span class="cn"></span><i class="rec"></i><div class="static hidden"><b>통신 방해됨</b></div></div>`).join('')}</div>
    ${single ? '<div class="camnav"><button class="cprev">◀</button><span class="cidx"></span><button class="cnext">▶</button></div>' : ''}</div></div>`);
  const cvs = $$('canvas', p.el);
  if (single) {
    $('.cprev', p.el).onclick = () => { sfx('click'); cur = (cur + views.length - 1) % views.length; };
    $('.cnext', p.el).onclick = () => { sfx('click'); cur = (cur + 1) % views.length; };
  }
  let last = 0;
  const loop = t => {
    p.raf = requestAnimationFrame(loop);
    if (t - last < 50) return;
    last = t;
    const comms = commsOn();
    cvs.forEach((cv, i) => {
      const v = views[single ? cur : i], cell = cv.parentElement;
      const nm = v?.name || '';
      if ($('.cn', cell).textContent !== nm) $('.cn', cell).textContent = nm;
      $('.static', cell).classList.toggle('hidden', !comms);
      if (!v) return;
      if (comms) return staticNoise(cv);
      if (scene.renderCam) { try { scene.renderCam(cv, v.x, v.y, (cv.height / 1150) * (v.zoom || 1)); } catch { fallbackCam(cv, v); } }
      else fallbackCam(cv, v);
    });
    if (single) $('.cidx', p.el).textContent = `${cur + 1} / ${views.length}`;
  };
  p.raf = requestAnimationFrame(loop);
}
function staticNoise(cv) {
  const c = cv.getContext('2d'), w = cv.width, hh = cv.height;
  const img = c.createImageData(w / 4 | 0, hh / 4 | 0);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 200 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  const tmp = document.createElement('canvas'); tmp.width = img.width; tmp.height = img.height; tmp.getContext('2d').putImageData(img, 0, 0);
  c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = false; c.drawImage(tmp, 0, 0, w, hh);
}
// renderCam 이 없을 때: 바닥 + 플레이어
function fallbackCam(cv, v) {
  const c = cv.getContext('2d'), z = cv.height / 1150, m = G.map;
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#0b1220'; c.fillRect(0, 0, cv.width, cv.height);
  c.setTransform(z, 0, 0, z, cv.width / 2 - v.x * z, cv.height / 2 - v.y * z);
  c.fillStyle = '#5d6a70';
  for (const poly of m.walk || []) { c.beginPath(); poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); }
  for (const b of scene.bodies || []) { c.fillStyle = COLORS[b.look?.color ?? 0][1]; c.fillRect(b.x - 50, b.y - 30, 100, 40); }
  for (const pl of scene.players.values()) {
    if (pl.vent || pl.dead || pl.invisible) continue;
    c.fillStyle = COLORS[(pl.disguise?.look || pl.look)?.color ?? 0][1]; c.beginPath(); c.ellipse(pl.x, pl.y - 70, 46, 62, 0, 0, 7); c.fill();
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- 관리실 지도 (방별 인원) ----------
export function openAdmin() {
  const m = G.map, g = geom(m), S = G.S;
  const p = openPanel('admin', `<div class="pnlback"><div class="pnl admin"><button class="xbtn">✕</button><h3>${icon('admin')} 관리실 지도</h3>
    <div class="adminmap"><svg viewBox="${vb(g)}" preserveAspectRatio="xMidYMid meet"><g class="base">${baseMap(m)}</g><g class="cnt"></g></svg>${commsStatic}</div></div></div>`);
  const cnt = $('.cnt', p.el);
  const draw = () => {
    const comms = commsOn();
    $('.adminmap .static', p.el).classList.toggle('hidden', !comms);
    if (comms) { cnt.innerHTML = ''; return; }
    const counts = new Map();
    const add = (x, y) => { const r = m.roomAt?.(x, y); if (r) counts.set(r.id, (counts.get(r.id) || 0) + 1); };
    // 원작처럼 살아있는 사람 + 시체가 같은 아이콘으로 보임 (환풍구 안·유령 제외)
    for (const pl of scene.players.values()) if (!pl.dead && !S.dead.has(pl.id) && !pl.vent) add(pl.x, pl.y);
    for (const b of scene.bodies || []) if (!b.gone) add(b.x, b.y);
    const u = g.u;
    let out = '';
    for (const r of m.rooms || []) {
      const n = counts.get(r.id);
      if (!n) continue;
      const cols = Math.min(n, 5), s = u * 2.6;
      for (let i = 0; i < n; i++) {
        const cx = r.label.x + ((i % cols) - (cols - 1) / 2) * s * 0.8, cy = r.label.y + u * 2.6 + Math.floor(i / cols) * s * 0.78;
        out += crewAt({ color: 5 }, cx, cy, s).replace('<svg', '<svg class="aicon"');
      }
    }
    cnt.innerHTML = out;
  };
  draw();
  p.timers.push(setInterval(draw, 300));
}

// ---------- 바이탈 (장치 / 과학자 능력) ----------
export function openVitals(src = 'station') {
  const S = G.S;
  if (src === 'ability') {
    if (commsOn()) return toast('통신 방해 중에는 바이탈을 볼 수 없습니다.');
    if ((S.battery ?? 0) <= 50) return toast('배터리가 없습니다. 임무를 완료해 충전하세요.');
    net.send({ t: 'ability', a: 'vitals', on: true, src: 'ability' });
  } else net.send({ t: 'vitals', on: true });
  S.vitalsOpen = src;
  const p = openPanel('vitals', `<div class="pnlback"><div class="pnl vitals2"><button class="xbtn">✕</button><h3>${icon('vitals')} 바이탈</h3>
    ${src === 'ability' ? '<div class="bat"><i></i><span></span></div>' : ''}<div class="vgrid"></div>${commsStatic}</div></div>`,
  { onClose: pp => { S.vitalsOpen = null; if (pp.silent) return; if (src === 'ability') net.send({ t: 'ability', a: 'vitals', on: false, src: 'ability' }); else net.send({ t: 'vitals', on: false }); } });
  p.src = src;
  const grid = $('.vgrid', p.el);
  const draw = () => {
    const comms = commsOn() || S.vitalsComms;
    $('.static', p.el).classList.toggle('hidden', !comms);
    const list = [...scene.players.values()].sort((a, b) => (a.look?.color ?? 0) - (b.look?.color ?? 0));
    const html = comms ? '' : list.map(pl => {
      const st = S.vitals?.get(pl.id) || (S.gone?.has(pl.id) ? 'gone' : S.dead.has(pl.id) ? 'dead' : 'alive');
      const ecg = st === 'alive' ? '<path d="M0 30 H40 L48 14 L56 46 L64 6 L70 30 H160" class="ecg"/>' : st === 'dead' ? '<path d="M0 30 H160" class="flat"/>' : '<path d="M0 30 H160" class="dc"/>';
      return `<div class="vt ${st}">${crewImg(pl.look, st === 'dead' ? { dead: true } : {}, 110, 79)}<b>${esc(pl.name)}</b><svg class="ecgw" viewBox="0 0 160 60">${ecg}</svg><span>${st === 'alive' ? '정상' : st === 'dead' ? '사망' : '연결 끊김'}</span></div>`;
    }).join('');
    if (grid._h !== html) { grid._h = html; grid.innerHTML = html; }
    const bat = $('.bat', p.el);
    if (bat && S.batteryMax) {
      const f = Math.max(0, S.battery / S.batteryMax);
      $('i', bat).style.width = `${f * 100}%`; $('span', bat).textContent = `배터리 ${(Math.max(0, S.battery) / 1000).toFixed(1)}초`; bat.classList.toggle('low', f < 0.3);
      if (S.battery <= 0 && G.panel === p) setTimeout(() => G.panel === p && p.close(), 400);
    }
  };
  draw();
  p.timers.push(setInterval(draw, 200));
}

// ---------- 문 기록 (미라 HQ) ----------
export function openDoorLog() {
  const S = G.S;
  net.send({ t: 'doorlog', on: true });
  const p = openPanel('doorlog', `<div class="pnlback"><div class="pnl doorlog"><button class="xbtn">✕</button><h3>${icon('doorlog')} 문 기록</h3><div class="dl"></div>${commsStatic}</div></div>`,
    { onClose: () => net.send({ t: 'doorlog', on: false }) });
  const draw = () => {
    const comms = commsOn() || S.doorlogComms;
    $('.static', p.el).classList.toggle('hidden', !comms);
    const box = $('.dl', p.el);
    const list = (S.doorlog || []).slice(-20).reverse();
    const html = comms ? '' : list.map(e => `<div class="dle"><i style="background:${COLORS[e.color]?.[1] || '#888'}"></i><span>${esc(COLORS[e.color]?.[0] || '')}</span> <b>${esc(e.sensor)}</b> 센서 통과<small>${e.at !== undefined ? fmtTime(e.at) : ''}</small></div>`).join('')
      || '<div class="dle empty">아직 기록이 없습니다.</div>';
    if (box._h !== html) { box._h = html; box.innerHTML = html; }
  };
  draw();
  p.timers.push(setInterval(draw, 500));
}

// ---------- 긴급 버튼 ----------
export function emergencyBox() {
  const S = G.S;
  const draw = () => {
    const left = S.emergLeft, cd = Math.ceil((S.emergAt - now()) / 1000), crisis = !!S.sab;
    const nm = esc(nameOf(S.you));
    const txt = crisis ? '위기 상황에서는\n긴급회의를 소집할 수 없습니다.' : left <= 0 ? `${nm} 크루원님은\n긴급회의를 모두 사용했습니다.`
      : cd > 0 ? `크루원은 다음 긴급회의를 소집하기까지\n<b class="big">${cd}</b>초 기다려야 합니다.` : `${nm} 크루원님의 긴급회의가\n<b class="big">${left}</b>\n회 남아 있습니다.`;
    return { can: !crisis && left > 0 && cd <= 0, txt };
  };
  const st = draw();
  const p = openPanel('emerg', `<div class="pnlback"><div class="emerg ${st.can ? '' : 'locked'}"><button class="xbtn">✕</button>
    <div class="eglass"></div><svg class="ebtn" viewBox="0 0 600 420"><text x="300" y="70" text-anchor="middle" class="etxt">EMERGENCY</text>
    <path d="M90 300 L510 300 L570 400 L30 400 Z" fill="#ffb300" stroke="#222" stroke-width="6"/><path d="M90 300 L510 300 L520 318 L80 318 Z" fill="#ffd54f"/>
    <ellipse cx="300" cy="300" rx="170" ry="72" fill="#7a0d0d" stroke="#222" stroke-width="6"/><g class="ecap"><ellipse cx="300" cy="282" rx="160" ry="66" fill="#d32f2f" stroke="#300" stroke-width="5"/><ellipse cx="260" cy="262" rx="60" ry="18" fill="#ff8a80" opacity=".8"/></g></svg>
    <div class="enote">${st.txt}</div></div></div>`);
  p.timers.push(setInterval(() => { const s2 = draw(); $('.enote', p.el).innerHTML = s2.txt; $('.emerg', p.el).classList.toggle('locked', !s2.can); }, 250));
  $('.ebtn', p.el).onclick = () => {
    if (!draw().can) { sfx('click'); return; }
    $('.emerg', p.el).classList.add('press');
    sfx('click');
    setTimeout(() => { net.send({ t: 'emergency' }); p.close(); }, 260);
  };
}

// ---------- 탐정 노트 (사건 파일은 서버가 관리) ----------
let noteTimer = 0;
export function openNotebook() {
  const S = G.S;
  let idx = Math.max(0, (S.cases || []).findIndex(c => c.id === S.activeCase));
  const p = openPanel('notes', `<div class="pnlback"><div class="pnl notebook"><button class="xbtn">✕</button><h3>${icon('notes')} 사건 노트</h3><div class="ctabs"></div><div class="cpage"></div></div></div>`, { freeze: !S.meeting });
  const send = (cs, patch) => net.send({ t: 'ability', a: 'notes', case: cs.id, ...patch });
  const draw = () => {
    const list = S.cases || [];
    if (idx >= list.length) idx = Math.max(0, list.length - 1);
    const cs = list[idx];
    $('.ctabs', p.el).innerHTML = list.map((c, i) => `<button data-i="${i}" class="${i === idx ? 'on' : ''}">${crewImg({ color: c.color }, { dead: true }, 60, 43)}<span>${esc(c.name)}</span>${c.id === S.activeCase ? '<em>진행 중</em>' : ''}</button>`).join('') || '<span class="empty">아직 사건이 없습니다.</span>';
    const page = $('.cpage', p.el);
    if (!cs) { page.innerHTML = '<p class="empty">시체가 신고되거나 회의가 열리면 새로 죽은 크루원마다 사건 파일이 만들어집니다.<br>살아있는 플레이어 가까이에서 <b>심문</b>을 누르면 그 사람이 사망 당시 실제로 어디 있었는지 기록됩니다.</p>'; return; }
    const lim = S.caseLimit || 3;
    const where = cs.dissolved ? '알 수 없음 (시체가 녹음)' : cs.room ? `${cs.room}${cs.near ? ' 근처' : ''}` : '알 수 없음';
    page.innerHTML = `<div class="cleft"><div class="victim">${crewImg({ color: cs.color }, { dead: true }, 150, 108)}<div><div class="lab">피해자</div><b>${esc(cs.name)}</b></div></div>
      <div class="lab">발견 장소</div><div class="val">${esc(where)}</div>
      <div class="lab">범인 추정</div><div class="kpick">${DETECTIVE_GUESS.map(([k, l]) => `<button data-g="${k}" class="${cs.guess === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="kpick">${DETECTIVE_PREP.map(([k, l]) => `<button data-pp="${k}" class="${cs.prep === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <textarea class="postit" maxlength="200" placeholder="메모를 남기세요">${esc(cs.note || '')}</textarea>
      ${S.activeCase === cs.id ? '<div class="activeb">진행 중인 사건</div>' : '<button class="obtn setact">이 사건 조사하기</button>'}</div>
      <div class="cright"><div class="lab">용의자 (${cs.suspects?.length || 0}/${lim}) — 사망 당시 위치</div>${Array.from({ length: lim }, (_, i) => {
        const s = cs.suspects?.[i];
        return `<div class="sus">${s ? `${crewImg({ color: s.color }, {}, 70, 50)}<b>#${i + 1} ${esc(s.name)}</b><span>${esc(s.room ? `${s.room}${s.near && !/근처$/.test(s.room) ? ' 근처' : ''}` : '알 수 없음')}</span>` : `<b class="emp">#${i + 1} —</b>`}</div>`;
      }).join('')}</div>`;
    const ta = $('.postit', page);
    ta.oninput = e => { cs.note = e.target.value; clearTimeout(noteTimer); noteTimer = setTimeout(() => send(cs, { note: cs.note }), 600); };
    ta.onkeydown = e => e.stopPropagation();
  };
  p.el.onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('xbtn')) return;
    const cs = (S.cases || [])[idx], d = b.dataset;
    sfx('click');
    if (d.i !== undefined) idx = +d.i;
    else if (d.g !== undefined && cs) { cs.guess = cs.guess === d.g ? '' : d.g; send(cs, { guess: cs.guess }); }
    else if (d.pp !== undefined && cs) { cs.prep = cs.prep === d.pp ? '' : d.pp; send(cs, { prep: cs.prep }); }
    else if (b.classList.contains('setact') && cs) { S.activeCase = cs.id; send(cs, {}); }
    draw(); renderTasks();
  };
  p.redraw = draw;
  draw();
}
export const refreshNotebook = () => { if (G.panel?.kind === 'notes' && !$('.postit:focus', G.panel.el)) G.panel.redraw?.(); };

// ---------- 인플루언서 메시지 휠 (서버가 그림 6개를 고름) ----------
export function influencerWheel(m) {
  const S = G.S;
  let sel = [];
  const max = m.max || INFLUENCER.maxSend;
  const sendAt = now() + (m.sendIn || 0);
  if (G.panel?.kind === 'influence' && G.panel.target === m.target) { G.panel.update(m, sendAt); return; }
  const p = openPanel('influence', `<div class="pnlback"><div class="pnl influ"><button class="xbtn">✕</button><h3>${icon('message')} <span class="tgt"></span> 님에게 메시지</h3>
    <div class="wheel"></div><div class="ifoot"><button class="obtn irefresh">새로고침</button><button class="obtn send">보내기</button></div><p class="ihint">그림을 최대 ${max}개까지 고르세요</p></div></div>`,
  { onClose: pp => { if (!pp.silent) net.send({ t: 'ability', a: 'close' }); } });
  p.target = m.target;
  let cur = m, until = sendAt;
  p.update = (mm, at) => { cur = mm; until = at; sel = []; draw(); };
  const draw = () => {
    $('.tgt', p.el).textContent = nameOf(cur.target);
    const imgs = cur.imgs || [];
    $('.wheel', p.el).innerHTML = imgs.map((k, i) => {
      const a = (i / imgs.length) * Math.PI * 2 - Math.PI / 2, x = 50 + Math.cos(a) * 36, y = 50 + Math.sin(a) * 36, n = sel.indexOf(k);
      return `<button class="wimg ${n >= 0 ? 'on' : ''}" data-k="${esc(k)}" style="left:${x}%;top:${y}%">${infImg(k)}<span>${esc(INF_LABEL[k] || k)}</span>${n >= 0 ? `<em>${n + 1}</em>` : ''}</button>`;
    }).join('') + `<div class="wcenter">${crewImg(lookOf(cur.target), {}, 150, 108)}</div>`;
    tick();
  };
  const tick = () => {
    const wait = Math.max(0, until - now());
    const sb = $('.send', p.el), rb = $('.irefresh', p.el);
    sb.disabled = !sel.length || wait > 0; sb.textContent = wait > 0 ? `보내기 (${Math.ceil(wait / 1000)})` : '보내기';
    rb.disabled = !(cur.refresh > 0); rb.textContent = `새로고침${cur.refresh > 0 ? ` (${cur.refresh})` : ''}`;
  };
  p.el.onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.classList.contains('xbtn')) return;
    sfx('click');
    if (b.dataset.k) { const k = b.dataset.k, i = sel.indexOf(k); if (i >= 0) sel.splice(i, 1); else if (sel.length < max) sel.push(k); draw(); }
    else if (b.classList.contains('irefresh')) net.send({ t: 'ability', a: 'refresh' });
    else if (b.classList.contains('send')) net.send({ t: 'ability', a: 'send', imgs: sel });
  };
  draw();
  p.timers.push(setInterval(() => { tick(); if (!alive() && S.phase !== 'play') p.close(); }, 250));
}

// ---------- 형상 변환자: 변신 대상 고르기 ----------
export function openShiftPicker() {
  const S = G.S;
  const bodies = new Set((scene.bodies || []).filter(b => !b.gone).map(b => b.id));
  const list = [...scene.players.values()].filter(p => p.id !== S.you && !S.gone?.has(p.id) && (!S.dead.has(p.id) || bodies.has(p.id)));
  const p = openPanel('shift', `<div class="pnlback"><div class="pnl shiftp"><button class="xbtn">✕</button><h3>${icon('shift')} 누구로 변신할까요?</h3>
    <div class="sgrid">${list.map(pl => `<button data-id="${esc(pl.id)}" class="${S.dead.has(pl.id) ? 'dead' : ''} ${S.mates.has(pl.id) ? 'mate' : ''}">${crewImg(pl.look, {}, 150, 108)}<b>${esc(pl.name)}</b></button>`).join('') || '<p class="empty">변신할 대상이 없습니다.</p>'}</div></div></div>`);
  p.el.onclick = e => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    sfx('click');
    net.send({ t: 'ability', a: 'shift', id: b.dataset.id });
    p.close();
  };
}

// ---------- 에어십: 시작 위치 고르기 (무작위 3곳 중 선택) ----------
export function spawnPicker(points, ms = RULES.spawnPickMs) {
  const m = G.map, S = G.S;
  const all = (Array.isArray(points) && points.length ? points : m.spawnPoints || []).map((pt, i) => (typeof pt === 'number' ? { ...(m.spawnPoints?.[pt] || {}), i: pt } : { ...pt, i: pt.i ?? i }));
  if (!all.length) return;
  const list = all.length > 3 ? [...all].sort(() => Math.random() - 0.5).slice(0, 3) : all;
  const g = geom(m);
  S.picking = true;
  try { G.mg?.close(); } catch {}
  const p = openPanel('spawn', `<div class="spawnpick"><h2>시작 위치를 고르세요</h2><div class="spcards">${list.map((pt, k) => `<button class="spc" data-k="${k}" style="--i:${k}">
    <svg viewBox="${vb(g)}" preserveAspectRatio="xMidYMid meet"><g class="base">${baseMap(m, { labels: false })}</g><circle cx="${pt.x}" cy="${pt.y}" r="${g.u * 3}" class="spdot"/></svg><b>${esc(pt.name || roomLabel(pt.x, pt.y))}</b></button>`).join('')}</div>
    <div class="sptimer"></div></div>`, { onClose: () => { S.picking = false; } });
  const end = now() + Math.max(2000, (ms || RULES.spawnPickMs) - 500);
  let chosen = false;
  const choose = k => {
    const pt = list[k];
    if (!pt || chosen) return;
    chosen = true;
    sfx('click');
    net.send({ t: 'spawn', i: pt.i });
    if (isFinite(pt.x)) scene.teleport?.(S.you, pt.x, pt.y);
    $$('.spc', p.el).forEach((b, i) => b.classList.toggle(i === k ? 'chosen' : 'gone', true));
    setTimeout(() => p.close(), 450);
  };
  p.el.onclick = e => { const b = e.target.closest('[data-k]'); if (b) choose(+b.dataset.k); };
  p.timers.push(setInterval(() => {
    const left = end - now();
    $('.sptimer', p.el).textContent = chosen ? '' : `${Math.max(0, Math.ceil(left / 1000))}초 뒤 자동 선택`;
    if (left <= 0) choose(Math.floor(Math.random() * list.length));
  }, 250));
}

// ---------- 연습 모드: 역할/맵 바꾸기 ----------
export function practiceSwitch() {
  const S = G.S;
  const order = ['crewmate', 'impostor', ...R.order()];
  let role = S.role, map = G.map.id;
  const m = modal(`<h2 style="font-size:40px">연습 모드 설정</h2><div class="prac"><div class="lab">역할</div><div class="prole"></div><div class="rdesc"></div><div class="lab">맵</div><div class="pmap"></div>
    <div class="row-c"><button class="obtn go">이대로 다시 시작</button></div></div>`);
  const draw = () => {
    $('.prole', m.el).innerHTML = order.map(r => `<button data-r="${r}" class="${r === role ? 'on' : ''}" style="--rc:${roleAccent(r)}">${esc(roleName(r))}${roleDef(r)?.ghost ? ' (유령)' : ''}</button>`).join('');
    $('.rdesc', m.el).textContent = roleDef(role)?.desc || '';
    $('.pmap', m.el).innerHTML = MAP_LIST.map(x => `<button data-m="${x.id}" class="${x.id === map ? 'on' : ''}">${mapIcon(x.id)}<span>${esc(x.ko || x.name)}</span></button>`).join('');
  };
  m.el.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.r) { sfx('click'); role = b.dataset.r; draw(); }
    if (b.dataset.m) { sfx('click'); map = b.dataset.m; draw(); }
    if (b.classList.contains('go')) {
      sfx('click'); m.close();
      restartPractice(role, map);
    }
  };
  draw();
}

// ---------- 매치 정보 가이드 ----------
export function matchGuide() {
  sfx('click');
  const S = G.S;
  let tab = '플레이어';
  const m = modal(`<h2 style="font-size:44px">매치 정보 가이드</h2><div class="set-tabs"><button>플레이어</button><button>설정</button><button>역할</button></div><div class="set-body guide2"></div>`);
  const draw = () => {
    $$('.set-tabs button', m.el).forEach(b => b.classList.toggle('on', b.textContent === tab));
    const s = S.game?.settings || S.room.settings, rs = s.roleSet || {}, hns = hnsMode();
    const rows = hns ? HNS_SETTINGS : SETTINGS, groups = hns ? HNS_GROUPS : SETTING_GROUPS;
    $('.set-body', m.el).innerHTML = tab === '플레이어'
      ? `<div class="gplayers">${[...scene.players.values()].map(p => `<div class="gp ${S.dead.has(p.id) ? 'dead' : ''}">${crewImg(p.look, S.dead.has(p.id) ? { ghost: true } : {}, 90, 65)}<span style="${S.mates.has(p.id) && (isImp() || hns) ? 'color:#ff3b3b' : ''}">${esc(p.name)}</span>${p.id === S.you ? `<em style="color:${roleAccent(S.role)}">${esc(roleName(S.role))}</em>` : ''}</div>`).join('')}</div>`
      : tab === '설정'
        ? `<div class="gset"><div class="set-row"><span>맵</span><b>${esc(G.map.ko || G.map.name)}</b></div><div class="set-row"><span>게임 유형</span><b>${hns ? '숨바꼭질' : '클래식'}</b></div>
          ${groups.map(gr => `<div class="ghead">${gr}</div>${rows.filter(d => d.group === gr && s[d.key] !== undefined && d.type !== 'p').map(d => `<div class="set-row"><span>${d.label}</span><b>${fmtSetting(d, s[d.key])}</b></div>`).join('')}`).join('')}</div>`
        : `<div class="groles">${hns ? '<p class="empty">숨바꼭질에서는 역할이 없습니다.</p>' : R.order().map(r => { const d = roleDef(r) || {}, q = rs[r] || {}; return `<div class="set-row"><span style="color:${roleAccent(r)};min-width:170px">${esc(roleName(r))}${r === S.role ? ' (나)' : ''}</span><span class="rd">${esc(d.blurb || d.desc || '')}</span><b>${q.max > 0 && q.chance > 0 ? `${q.max}명 · ${q.chance}%` : '꺼짐'}</b></div>`; }).join('')}</div>`;
  };
  $$('.set-tabs button', m.el).forEach(b => b.onclick = () => { sfx('click'); tab = b.textContent; draw(); });
  draw();
}

// ---------- 로비: 플레이어 목록 (주최자는 내보내기/차단) ----------
export function playersBox() {
  sfx('click');
  const S = G.S, r = S.room, host = r.host === S.you;
  const m = modal(`<h2 style="font-size:40px">플레이어 (${r.players.length}/${r.settings.maxPlayers})</h2><div class="plist2">
    ${r.players.map(p => `<div class="set-row"><span>${crewImg(p.look, {}, 70, 50)} ${esc(p.name)} <small style="color:#888">Lv.${p.lvl || 1}</small> ${p.id === r.host ? '<b class="crown">주최자</b>' : ''}</span>
    ${host && p.id !== S.you && !p.bot ? `<div class="tog"><button data-kick="${esc(p.id)}">내보내기</button><button data-ban="${esc(p.id)}">차단</button></div>` : ''}</div>`).join('')}
    ${r.mode === 'online' ? `<p style="text-align:center">코드: <b>${settings.streamer ? '******' : r.code}</b></p>` : ''}</div>`);
  $$('[data-kick],[data-ban]', m.el).forEach(b => b.onclick = () => { sfx('click'); net.send({ t: 'kick', id: b.dataset.kick || b.dataset.ban, ban: !!b.dataset.ban }); m.close(); });
}

// ---------- 로비: 게임 설정 (gamesettings.js 가 없을 때 대체) ----------
export function settingsFallback(editable, onChange) {
  const S = G.S;
  const m = modal(`<h2 style="font-size:40px">게임 설정</h2><div class="set-body" style="width:900px;height:470px"></div>`);
  const draw = () => {
    if (!m.back.isConnected) return;
    const s = S.room.settings, host = editable, hns = s.gameType === 'hns';
    const rows = hns ? HNS_SETTINGS : SETTINGS;
    $('.set-body', m.el).innerHTML = [
      `<div class="set-row"><span>프리셋</span><div class="tog">${Object.keys(PRESETS).filter(p => PRESET_MODES[p] === (hns ? 'hns' : 'classic')).map(p => `<button data-pre="${p}" class="${s.preset === p ? 'on' : ''}" ${host ? '' : 'disabled'}>${p}</button>`).join('')}</div></div>`,
      `<div class="set-row"><span>맵</span><div class="tog">${MAP_LIST.map(x => `<button data-map="${x.id}" class="${s.map === x.id ? 'on' : ''}" ${host ? '' : 'disabled'}>${esc(x.ko || x.name)}</button>`).join('')}</div></div>`,
      `<div class="set-row"><span>게임 유형</span><div class="tog">${[['classic', '클래식'], ['hns', '숨바꼭질']].map(([k, l]) => `<button data-gt="${k}" class="${s.gameType === k ? 'on' : ''}" ${host ? '' : 'disabled'}>${l}</button>`).join('')}</div></div>`,
      ...rows.filter(d => s[d.key] !== undefined && d.type !== 'p').map(d => `<div class="set-row"><span>${d.label}</span><div class="tog">${host ? `<button data-k="${d.key}" data-d="-1">-</button>` : ''}
        <b style="min-width:110px;text-align:center">${fmtSetting(d, s[d.key])}</b>${host ? `<button data-k="${d.key}" data-d="1">+</button>` : ''}</div></div>`),
    ].join('');
  };
  $('.set-body', m.el).onclick = e => {
    const b = e.target.closest('button');
    if (!b || !editable) return;
    sfx('click');
    const s = S.room.settings, d = b.dataset;
    if (d.pre) onChange({ preset: d.pre });
    if (d.map) onChange({ map: d.map });
    if (d.gt) onChange({ gameType: d.gt });
    if (d.k) { const def = [...SETTINGS, ...HNS_SETTINGS].find(x => x.key === d.k); const v = +s[d.k] + (def ? def.step : 1) * +d.d; onChange({ [d.k]: def ? Math.min(def.max, Math.max(def.min, v)) : v }); }
  };
  draw();
  return { refresh: draw, close: () => m.close() };
}

export const mapNameOf = id => { const x = getMap(id); return x?.ko || x?.name || id; };
