// 게임 패널: 지도/사보타주 지도, 보안 카메라, 관리실, 바이탈, 문 기록, 긴급 버튼, 탐정 노트, 인플루언서, 변신 대상, 스폰 선택, 연습 역할, 매치 가이드
import { $, $$, h, esc, stage, sfx, net, settings, toast, modal } from '../core.js';
import { COLORS, SETTINGS, fmtSetting, PRESETS } from '../shared/data.js';
import { MAP_LIST, getMap } from '../shared/maps/index.js';
import { crewSVG, mapIcon } from '../ui/crew.js';
import { scene } from './scene.js';
import { G, R, alive, isImp, commsOn, roleDef, roleName, roleColor, roleOpt, roleKey, isImpRole, nameOf, lookOf, now, sabDef, hnsMode, isSeeker, roomLabel, setCd, stat } from './play.js';
import { overlay, dropOverlay, icon, ICON, sabIcon, crewImg, SND, fmtTime, renderTasks } from './hud.js';

// ---------- 패널 관리 (한 번에 하나) ----------
export function openPanel(kind, html, { freeze = true, onClose } = {}) {
  closePanel();
  const el = overlay(html);
  const p = { kind, el, freeze, close() { if (G.panel !== p) return; G.panel = null; p.timers.forEach(clearInterval); cancelAnimationFrame(p.raf); onClose?.(); dropOverlay(el); }, timers: [], raf: 0 };
  G.panel = p;
  $$('.xbtn', el).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); sfx('click'); p.close(); }));
  return p;
}
export const closePanel = () => G.panel?.close();

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
    ${labels ? `<g class="mb-lab" font-size="${fs}">${(m.rooms || []).map(r => `<text x="${r.label.x}" y="${r.label.y}" stroke-width="${fs * 0.16}">${esc(r.name)}</text>`).join('')}</g>` : ''}`;
}
const vb = g => `${g.x} ${g.y} ${g.w} ${g.h}`;
// SVG 안에 아이콘/크루원 넣기
const icoAt = (k, x, y, s, extra = '') => `<svg x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" viewBox="0 0 100 100" ${extra}>${ICON[k] || ''}</svg>`;
const crewAt = (look, x, y, s, o = {}) => crewSVG(look || {}, { noPet: true, ...o }).replace('<svg', `<svg x="${x - s * 0.5}" y="${y - s * 0.62}" width="${s}" height="${s * 0.72}"`);
// 원형 쿨다운 부채꼴
const pie = (x, y, r, f) => {
  if (f <= 0) return '';
  if (f >= 0.999) return `<circle cx="${x}" cy="${y}" r="${r}" class="pie"/>`;
  const a = f * Math.PI * 2, ex = x + r * Math.sin(a), ey = y - r * Math.cos(a);
  return `<path class="pie" d="M${x} ${y} L${x} ${y - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${ex} ${ey} Z"/>`;
};
const roomById = (m, id) => (m.rooms || []).find(r => r.id === id);

// ---------- 지도 / 사보타주 지도 ----------
export function openMap(forceSab) {
  if (G.panel?.kind === 'map') return closePanel();
  const S = G.S, m = G.map, game = !!S.game, hns = hnsMode();
  const sabMap = game && isImp() && !hns;
  const seekMap = game && hns && isSeeker();
  const g = geom(m);
  const p = openPanel('map', `<div class="mapov2 ${sabMap ? 'sab' : ''}"><div class="mapframe"><div class="maptitle">${esc(m.ko || m.name)}${sabMap ? ' · 방해 공작' : ''}</div>
    <svg class="msvg" viewBox="${vb(g)}" preserveAspectRatio="xMidYMid meet"><g class="base">${baseMap(m)}</g><g class="dyn"></g><g class="btns"></g></svg>
    ${sabMap ? '<div class="maphint">아이콘을 눌러 방해 공작을 시작하세요</div>' : ''}</div><button class="xbtn">✕</button></div>`, { freeze: false });
  const dyn = $('.dyn', p.el), btns = $('.btns', p.el);
  const draw = () => {
    if (!G.S?.game && game) return p.close();
    const t = now(), u = g.u, me = scene.players.get(S.you);
    let out = '';
    // 내 임무 위치
    if (game && !isImp() && !commsOn()) for (const id of scene.taskStations || []) { const s = m.stations[id]; if (s) out += `<g class="tmark">${icoAt('use', s.x, s.y - u * 1.2, u * 2.4, 'class="tm"')}<text x="${s.x}" y="${s.y + u * 0.55}" font-size="${u * 2.4}">!</text></g>`; }
    // 사보타주 위치 (깜빡임)
    if (game && S.sab) for (const id of scene.sabTargets || []) { const s = m.stations[id]; if (s) out += `<circle class="sabpt" cx="${s.x}" cy="${s.y}" r="${u * 1.6}" stroke-width="${u * 0.35}"/>`; }
    // 닫힌 문
    for (const id of scene.doorsClosed || []) { const d = m.doorById?.[id]; if (d) out += `<rect class="dclosed" x="${d.x}" y="${d.y}" width="${Math.max(d.w, u * 0.6)}" height="${Math.max(d.h, u * 0.6)}"/>`; }
    // 추적자 대상
    if (S.track && S.trackPos && !commsOn()) out += `<g class="trk">${crewAt({ ...lookOf(S.track.id), hat: 'none' }, S.trackPos.x, S.trackPos.y, u * 4.4)}<circle cx="${S.trackPos.x}" cy="${S.trackPos.y - u * 1.2}" r="${u * 2.6}" fill="none" stroke="#3cff6a" stroke-width="${u * 0.3}"/></g>`;
    // 숨바꼭질 술래 지도 (마지막 숨기)
    if (seekMap && (S.hns?.phase === 'final' || S.hns?.seekMap)) for (const pl of scene.players.values()) if (pl.id !== S.you && !S.dead.has(pl.id)) out += `<circle cx="${pl.x}" cy="${pl.y}" r="${u * 0.9}" fill="#ff3b3b" stroke="#000" stroke-width="${u * 0.2}"/>`;
    // 나
    const vp = scene.players.get(scene.viewId ?? S.you) || me;
    if (vp) out += `<g class="meicon">${crewAt(vp.disguise?.look || vp.look, vp.x, vp.y, u * 5)}</g>`;
    dyn.innerHTML = out;
    // 임포스터: 사보타주 버튼 + 문 버튼
    if (sabMap) {
      let b = '';
      const r = u * 2.6, sabCd = Math.max(0, (S.sabReady || 0) - t), sabOn = !!S.sab;
      const used = new Map();
      for (const [k, d] of Object.entries(m.sabotages || {})) {
        const room = roomById(m, d.room) || (m.rooms || []).find(x => x.name === d.room);
        if (!room) continue;
        const n = used.get(room.id) || 0; used.set(room.id, n + 1);
        const x = room.label.x + n * r * 2.4, y = room.label.y + u * 3.6;
        const dis = sabOn || sabCd > 0 || S.phase !== 'play';
        b += `<g class="sbtn ${dis ? 'dis' : ''} ${S.sab?.k === k ? 'act' : ''}" data-sab="${k}"><circle cx="${x}" cy="${y}" r="${r * 1.12}" class="ring"/>${icoAt(sabIcon(k, d), x, y, r * 2)}
          ${sabCd > 0 && !sabOn ? pie(x, y, r * 1.05, sabCd / (S.sabCdMax || 30000)) + `<text x="${x}" y="${y + r * 0.35}" font-size="${r}" class="cdt">${Math.ceil(sabCd / 1000)}</text>` : ''}<title>${esc(d.name)}</title></g>`;
      }
      for (const rid of m.doorRooms || []) {
        const room = roomById(m, rid);
        if (!room) continue;
        const n = used.get(room.id) || 0; used.set(room.id, n + 1);
        const x = room.label.x + n * r * 2.4, y = room.label.y + u * 3.6;
        const cd = Math.max(0, (S.doorCd?.[rid] || 0) - t);
        const closed = (m.doors || []).some(d => d.room === rid && scene.doorsClosed?.has(d.id));
        const dis = cd > 0 || closed || S.phase !== 'play';
        b += `<g class="dbtn ${dis ? 'dis' : ''}" data-door="${rid}"><rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" rx="${r * 0.3}" class="ring"/>${icoAt('door', x, y, r * 1.7)}
          ${cd > 0 ? pie(x, y, r * 0.95, cd / (S.doorCdMax?.[rid] || 30000)) + `<text x="${x}" y="${y + r * 0.35}" font-size="${r}" class="cdt">${Math.ceil(cd / 1000)}</text>` : ''}<title>${esc(room.name)} 문 닫기</title></g>`;
      }
      if (btns._h !== b) { btns._h = b; btns.innerHTML = b; }
    }
  };
  btns.onclick = e => {
    const sb = e.target.closest('[data-sab]'), db = e.target.closest('[data-door]');
    if (sb && !sb.classList.contains('dis')) { sfx('click'); net.send({ t: 'sab', k: sb.dataset.sab }); closePanel(); }
    else if (db && !db.classList.contains('dis')) { sfx('click'); net.send({ t: 'door', room: db.dataset.door }); SND.door(); }
    else if (sb || db) sfx('click');
  };
  draw();
  p.timers.push(setInterval(draw, 200));
}

// ---------- 보안 카메라 ----------
export function openCams() {
  const m = G.map, views = m.cams?.views || [];
  if (!views.length) return;
  const single = views.length > 6 || m.camSingle || m.id === 'airship';
  let cur = 0;
  const cells = single ? 1 : views.length;
  const p = openPanel('cams', `<div class="pnlback"><div class="pnl cams ${single ? 'single' : `n${Math.min(cells, 6)}`}"><button class="xbtn">✕</button><h3>${icon('cams')} 보안실 카메라</h3>
    <div class="camgrid">${Array.from({ length: cells }, (_, i) => `<div class="cam"><canvas width="${single ? 960 : 520}" height="${single ? 540 : 300}"></canvas><span class="cn"></span><i class="rec"></i><div class="static hidden"><b>통신 방해됨</b></div></div>`).join('')}</div>
    ${single ? '<div class="camnav"><button class="cprev">◀</button><span class="cidx"></span><button class="cnext">▶</button></div>' : ''}</div></div>`);
  const cvs = $$('canvas', p.el);
  if (single) {
    $('.cprev', p.el).onclick = () => { sfx('click'); cur = (cur + views.length - 1) % views.length; };
    $('.cnext', p.el).onclick = () => { sfx('click'); cur = (cur + 1) % views.length; };
  }
  let last = 0;
  const loop = t => {
    p.raf = requestAnimationFrame(loop);
    if (t - last < 55) return;
    last = t;
    const comms = commsOn();
    cvs.forEach((cv, i) => {
      const v = views[single ? cur : i], cell = cv.parentElement;
      $('.cn', cell).textContent = v?.name || '';
      $('.static', cell).classList.toggle('hidden', !comms);
      if (!v) return;
      if (comms) return staticNoise(cv);
      if (scene.renderCam) { try { scene.renderCam(cv, v.x, v.y, cv.height / 1150); } catch (e) { staticNoise(cv); } }
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
  c.imageSmoothingEnabled = false; c.drawImage(tmp, 0, 0, w, hh);
}
// renderCam 이 없을 때: 지도 + 플레이어 점
function fallbackCam(cv, v) {
  const c = cv.getContext('2d'), z = cv.height / 1150, m = G.map;
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#0b1220'; c.fillRect(0, 0, cv.width, cv.height);
  c.setTransform(z, 0, 0, z, cv.width / 2 - v.x * z, cv.height / 2 - v.y * z);
  c.fillStyle = '#5d6a70';
  for (const poly of m.walk || []) { c.beginPath(); poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); }
  for (const pl of scene.players.values()) {
    if (pl.vent || pl.dead || pl.invisible) continue;
    c.fillStyle = COLORS[(pl.disguise?.look || pl.look)?.color ?? 0][1]; c.beginPath(); c.arc(pl.x, pl.y - 60, 46, 0, 7); c.fill();
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- 관리실 지도 ----------
export function openAdmin() {
  const m = G.map, g = geom(m);
  const p = openPanel('admin', `<div class="pnlback"><div class="pnl admin"><button class="xbtn">✕</button><h3>${icon('admin')} 관리실 맵</h3>
    <div class="adminmap"><svg viewBox="${vb(g)}" preserveAspectRatio="xMidYMid meet"><g class="base">${baseMap(m)}</g><g class="cnt"></g></svg><div class="static hidden"><b>통신 방해됨</b></div></div></div></div>`);
  const cnt = $('.cnt', p.el);
  const draw = () => {
    const comms = commsOn();
    $('.adminmap .static', p.el).classList.toggle('hidden', !comms);
    if (comms) { cnt.innerHTML = ''; return; }
    const counts = new Map();
    const add = (x, y, body) => { const r = m.roomAt?.(x, y); if (r) { const a = counts.get(r.id) || []; a.push(body); counts.set(r.id, a); } };
    for (const pl of scene.players.values()) if (!pl.dead && !G.S.dead.has(pl.id)) add(pl.x, pl.y, false);
    for (const b of scene.bodies || []) if (!b.gone) add(b.x, b.y, true);
    const u = g.u;
    let out = '';
    for (const r of m.rooms || []) {
      const a = counts.get(r.id);
      if (!a?.length) continue;
      const n = a.length, cols = Math.min(n, 5), s = u * 2.8;
      a.forEach((body, i) => {
        const cx = r.label.x + ((i % cols) - (cols - 1) / 2) * s * 0.85, cy = r.label.y + u * 2.6 + Math.floor(i / cols) * s * 0.8;
        out += crewAt({ color: body ? 0 : 5 }, cx, cy, s, body ? { dead: true } : {}).replace('<svg', `<svg class="${body ? 'abody' : 'aicon'}"`);
      });
    }
    cnt.innerHTML = out;
  };
  draw();
  p.timers.push(setInterval(draw, 300));
}

// ---------- 바이탈 ----------
export function openVitals(src = 'station') {
  const S = G.S;
  if (src === 'ability') {
    if (commsOn()) return toast('통신 방해 중에는 바이탈을 볼 수 없습니다.');
    if ((S.battery ?? 1) <= 0.05) return toast('배터리가 없습니다. 임무를 완료해 충전하세요.');
  }
  S.vitalsOpen = src;
  net.send({ t: 'ability', a: 'vitals', on: true, src });
  const p = openPanel('vitals', `<div class="pnlback"><div class="pnl vitals2"><button class="xbtn">✕</button><h3>${icon('vitals')} 바이탈 모니터</h3>
    ${src === 'ability' ? '<div class="bat"><i></i><span></span></div>' : ''}<div class="vgrid"></div><div class="static hidden"><b>통신 방해됨</b></div></div></div>`,
  { onClose: () => { S.vitalsOpen = null; net.send({ t: 'ability', a: 'vitals', on: false, src }); } });
  const grid = $('.vgrid', p.el);
  const draw = () => {
    const comms = commsOn();
    $('.static', p.el).classList.toggle('hidden', !comms);
    const list = [...scene.players.values()].sort((a, b) => (a.look?.color ?? 0) - (b.look?.color ?? 0));
    const html = list.map(pl => {
      const st = S.vitals?.get(pl.id) || (S.gone?.has(pl.id) ? 'gone' : S.dead.has(pl.id) ? 'dead' : 'alive');
      const ecg = st === 'alive' ? '<path d="M0 30 H40 L48 14 L56 46 L64 6 L70 30 H160" class="ecg"/>' : st === 'dead' ? '<path d="M0 30 H160" class="flat"/>' : '<path d="M0 30 H160" class="dc"/>';
      return `<div class="vt ${st}">${crewImg(pl.look, st === 'dead' ? { dead: true } : {}, 110, 79)}<b>${esc(pl.name)}</b><svg class="ecgw" viewBox="0 0 160 60">${ecg}</svg><span>${st === 'alive' ? '정상' : st === 'dead' ? '사망' : '연결 끊김'}</span></div>`;
    }).join('');
    if (grid._h !== html) { grid._h = html; grid.innerHTML = html; }
    const bat = $('.bat', p.el);
    if (bat && S.batteryMax) { const f = Math.max(0, S.battery / S.batteryMax); $('i', bat).style.width = `${f * 100}%`; $('span', bat).textContent = `배터리 ${Math.ceil(S.battery)}초`; bat.classList.toggle('low', f < 0.3); }
  };
  draw();
  p.timers.push(setInterval(draw, 250));
}

// ---------- 문 기록 (미라 HQ) ----------
export function openDoorLog() {
  const S = G.S;
  const p = openPanel('doorlog', `<div class="pnlback"><div class="pnl doorlog"><button class="xbtn">✕</button><h3>${icon('doorlog')} 문 기록</h3><div class="dl"></div><div class="static hidden"><b>통신 방해됨</b></div></div></div>`);
  const draw = () => {
    const comms = commsOn();
    $('.static', p.el).classList.toggle('hidden', !comms);
    const box = $('.dl', p.el);
    const html = comms ? '' : (S.doorlog || []).slice(-14).reverse().map(e => `<div class="dle"><i style="background:${COLORS[e.color]?.[1] || '#888'}"></i>${esc(COLORS[e.color]?.[0] || '')} 님이 <b>${esc(e.sensor)}</b> 센서를 통과했습니다.<small>${fmtTime(now() - e.t)} 전</small></div>`).join('') || '<div class="dle empty">아직 기록이 없습니다.</div>';
    if (box._h !== html) { box._h = html; box.innerHTML = html; }
  };
  draw();
  p.timers.push(setInterval(draw, 500));
}

// ---------- 긴급 버튼 ----------
export function emergencyBox() {
  const S = G.S, left = S.emergLeft, cd = Math.ceil((S.emergAt - now()) / 1000);
  const sd = S.sab && sabDef(S.sab.k), crisis = sd && sd.type !== 'mixup';
  const txt = crisis ? '위기 상황에서는\n긴급회의를 소집할 수 없습니다.' : left <= 0 ? `${esc(nameOf(S.you))} 크루원님은\n긴급회의를 모두 사용했습니다.`
    : cd > 0 ? `크루원은 다음 긴급회의를 소집하기까지\n<b class="big">${cd}</b>초 기다려야 합니다.` : `${esc(nameOf(S.you))} 크루원님의 긴급회의가\n<b class="big">${left}</b>\n회 남아 있습니다.`;
  const can = !crisis && left > 0 && cd <= 0;
  const p = openPanel('emerg', `<div class="pnlback"><div class="emerg ${can ? '' : 'locked'}"><button class="xbtn">✕</button>
    <div class="eglass"></div><svg class="ebtn" viewBox="0 0 600 420"><text x="300" y="70" text-anchor="middle" class="etxt">EMERGENCY</text>
    <path d="M90 300 L510 300 L570 400 L30 400 Z" fill="#ffb300" stroke="#222" stroke-width="6"/><path d="M90 300 L510 300 L520 318 L80 318 Z" fill="#ffd54f"/>
    <ellipse cx="300" cy="300" rx="170" ry="72" fill="#7a0d0d" stroke="#222" stroke-width="6"/><g class="cap"><ellipse cx="300" cy="282" rx="160" ry="66" fill="#d32f2f" stroke="#300" stroke-width="5"/><ellipse cx="260" cy="262" rx="60" ry="18" fill="#ff8a80" opacity=".8"/></g></svg>
    <div class="enote">${txt}</div></div></div>`);
  $('.ebtn', p.el).onclick = () => {
    if (!can) { sfx('click'); return; }
    $('.emerg', p.el).classList.add('press');
    sfx('click');
    setTimeout(() => { net.send({ t: 'emergency' }); stat('meetings'); p.close(); }, 260);
  };
}

// ---------- 탐정 노트 ----------
const KILLER = ['임포스터', '형상 변환자', '팬텀', '바이퍼'], PREP = ['에 의해', '일지도', '아님'];
export function openNotebook() {
  const S = G.S;
  S.cases ||= [];
  let idx = S.activeCase ?? 0;
  const p = openPanel('notes', `<div class="pnlback"><div class="pnl notebook"><button class="xbtn">✕</button><h3>${icon('notes')} 사건 노트</h3><div class="ctabs"></div><div class="cpage"></div></div></div>`, { freeze: !S.meeting });
  const draw = () => {
    const cs = S.cases[idx];
    $('.ctabs', p.el).innerHTML = S.cases.map((c, i) => `<button data-i="${i}" class="${i === idx ? 'on' : ''}">${crewImg(c.look, { dead: true }, 60, 43)}<span>${esc(c.name)}</span>${i === S.activeCase ? '<em>진행 중</em>' : ''}</button>`).join('') || '<span class="empty">아직 사건이 없습니다.</span>';
    if (!cs) { $('.cpage', p.el).innerHTML = '<p class="empty">시체가 신고되거나 회의가 열리면 새로 죽은 크루원마다 사건 파일이 만들어집니다.<br>살아있는 플레이어 가까이에서 <b>심문</b>을 누르면 그 사람이 사망 당시 어디 있었는지 기록됩니다.</p>'; return; }
    const lim = roleOpt('detective', /suspect|limit/i, 3);
    $('.cpage', p.el).innerHTML = `<div class="cleft"><div class="victim">${crewImg(cs.look, { dead: true }, 150, 108)}<div><div class="lab">피해자</div><b>${esc(cs.name)}</b></div></div>
      <div class="lab">발견 장소</div><div class="val">${esc(cs.room || '알 수 없음')}</div>
      <div class="lab">범인 추정</div><div class="kpick">${KILLER.map((k, i) => `<button data-k="${i}" class="${cs.killer === i ? 'on' : ''}">${k}</button>`).join('')}</div>
      <div class="kpick">${PREP.map((k, i) => `<button data-pp="${i}" class="${cs.prep === i ? 'on' : ''}">${k}</button>`).join('')}</div>
      <textarea class="postit" maxlength="140" placeholder="메모를 남기세요">${esc(cs.note || '')}</textarea>
      ${S.activeCase === idx ? '<div class="activeb">진행 중인 사건</div>' : '<button class="obtn setact">이 사건 조사하기</button>'}</div>
      <div class="cright"><div class="lab">용의자 (${cs.suspects.length}/${lim}) — 사망 당시 위치</div>${Array.from({ length: lim }, (_, i) => {
        const s = cs.suspects[i];
        return `<div class="sus">${s ? `${crewImg(s.look, {}, 70, 50)}<b>#${i + 1} ${esc(s.name)}</b><span>${esc(s.room)}</span>` : `<b class="emp">#${i + 1} —</b>`}</div>`;
      }).join('')}</div>`;
    $('.postit', p.el).oninput = e => (cs.note = e.target.value);
    $('.postit', p.el).onkeydown = e => e.stopPropagation();
  };
  p.el.onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('xbtn')) return;
    const cs = S.cases[idx], d = b.dataset;
    sfx('click');
    if (d.i !== undefined) idx = +d.i;
    else if (d.k !== undefined && cs) cs.killer = cs.killer === +d.k ? null : +d.k;
    else if (d.pp !== undefined && cs) cs.prep = cs.prep === +d.pp ? null : +d.pp;
    else if (b.classList.contains('setact')) S.activeCase = idx;
    draw(); renderTasks();
  };
  draw();
}

// ---------- 인플루언서 ----------
const IG = (body) => `<svg viewBox="0 0 100 100">${body}</svg>`;
const arrow = (rot, col) => `<g transform="rotate(${rot} 50 50)"><path d="M50 10 L80 46 H62 V90 H38 V46 H20 Z" fill="${col}" stroke="#000" stroke-width="5" stroke-linejoin="round"/></g>`;
const pairArrows = (a, b) => `<path d="M14 64 L38 30 L38 48 L62 48 L62 30 L86 64 L62 98 L62 80 L38 80 L38 98 Z" fill="${a}" stroke="#000" stroke-width="4" transform="translate(0 -14)"/><rect x="38" y="34" width="24" height="32" fill="${b}"/>`;
export const INFLUENCE = {
  c_red: ['빨강 계열', pairArrows('#C51111', '#EC7578')], c_blue: ['파랑 계열', pairArrows('#132ED1', '#38FEDC')], c_green: ['초록 계열', pairArrows('#117F2D', '#50EF39')],
  c_yellow: ['노랑 계열', pairArrows('#F5F557', '#EF7D0D')], c_pink: ['분홍·보라 계열', pairArrows('#ED54BA', '#6B2FBB')], c_bw: ['검정·하양 계열', pairArrows('#3F474E', '#D6E0F0')],
  up: ['위쪽', arrow(0, '#ffd400')], down: ['아래쪽', arrow(180, '#ffd400')], left: ['왼쪽', arrow(-90, '#ffd400')], right: ['오른쪽', arrow(90, '#ffd400')],
  vitals: ['바이탈', ICON.vitals], bulb: ['조명', ICON.lights], vent: ['환풍구', ICON.vent], knife: ['처치', ICON.kill], eye: ['목격', '<ellipse cx="50" cy="50" rx="44" ry="26" fill="#fff" stroke="#000" stroke-width="5"/><circle cx="50" cy="50" r="16" fill="#3a7bd5" stroke="#000" stroke-width="4"/><circle cx="50" cy="50" r="7"/>'],
  question: ['모르겠음', '<circle cx="50" cy="50" r="42" fill="#ffd400" stroke="#000" stroke-width="5"/><path d="M36 38 C36 20 66 20 64 38 C63 48 50 48 50 60" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round"/><circle cx="50" cy="76" r="6"/>'],
  skull: ['시체', '<path d="M20 50 C20 22 80 22 80 50 C80 62 72 66 70 72 V84 H30 V72 C28 66 20 62 20 50 Z" fill="#f2f2e8" stroke="#000" stroke-width="5"/><circle cx="38" cy="52" r="9"/><circle cx="62" cy="52" r="9"/><path d="M44 72 V84 M56 72 V84" stroke="#000" stroke-width="4"/>'],
  shield: ['보호', ICON.protect], cam: ['카메라', ICON.cams], admin: ['관리실', ICON.admin], meeting: ['회의', ICON.report], task: ['임무', ICON.guide],
  check: ['안전', '<circle cx="50" cy="50" r="42" fill="#2fd05a" stroke="#000" stroke-width="5"/><path d="M28 52 L44 68 L74 34" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>'],
  cross: ['수상함', '<circle cx="50" cy="50" r="42" fill="#e53935" stroke="#000" stroke-width="5"/><path d="M32 32 L68 68 M68 32 L32 68" stroke="#fff" stroke-width="10" stroke-linecap="round"/>'],
  door: ['문', ICON.door], ladder: ['사다리', ICON.ladder], clock: ['시간', '<circle cx="50" cy="50" r="42" fill="#fff" stroke="#000" stroke-width="5"/><path d="M50 22 V50 L68 62" fill="none" stroke="#000" stroke-width="7" stroke-linecap="round"/>'],
};
export const influenceSVG = k => (INFLUENCE[k] ? IG(INFLUENCE[k][1]) : '');
const roll6 = () => { const k = Object.keys(INFLUENCE); for (let i = k.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [k[i], k[j]] = [k[j], k[i]]; } return k.slice(0, 6); };
export function openInfluencer(targetId) {
  const S = G.S;
  let imgs = roll6(), sel = [], refreshed = false, sendAt = 0;
  const cdFull = roleOpt('influencer', /cool/i, 20) * 1000;
  const p = openPanel('influence', `<div class="pnlback"><div class="pnl influ"><button class="xbtn">✕</button><h3>${icon('message')} ${esc(nameOf(targetId))} 님에게 메시지</h3>
    <div class="wheel"></div><div class="ifoot"><button class="obtn refresh">새로고침</button><button class="obtn send">보내기</button></div><p class="ihint">이미지를 최대 3개까지 고르세요</p></div></div>`);
  const draw = () => {
    $('.wheel', p.el).innerHTML = imgs.map((k, i) => {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2, x = 50 + Math.cos(a) * 36, y = 50 + Math.sin(a) * 36, n = sel.indexOf(k);
      return `<button class="wimg ${n >= 0 ? 'on' : ''}" data-k="${k}" style="left:${x}%;top:${y}%">${influenceSVG(k)}<span>${INFLUENCE[k][0]}</span>${n >= 0 ? `<em>${n + 1}</em>` : ''}</button>`;
    }).join('') + `<div class="wcenter">${crewImg(lookOf(targetId), {}, 150, 108)}</div>`;
    const wait = Math.max(0, sendAt - now());
    const sb = $('.send', p.el);
    sb.disabled = !sel.length || wait > 0; sb.textContent = wait > 0 ? `보내기 (${Math.ceil(wait / 1000)})` : '보내기';
    $('.refresh', p.el).disabled = refreshed;
  };
  p.el.onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.classList.contains('xbtn')) return;
    sfx('click');
    if (b.dataset.k) { const k = b.dataset.k, i = sel.indexOf(k); if (i >= 0) sel.splice(i, 1); else if (sel.length < 3) sel.push(k); }
    else if (b.classList.contains('refresh')) { imgs = roll6(); sel = []; refreshed = true; sendAt = now() + cdFull / 2; }
    else if (b.classList.contains('send')) {
      net.send({ t: 'ability', a: 'message', id: targetId, imgs: sel });
      setCd('message', cdFull);
      stat('messages');
      toast('메시지를 보냈습니다.');
      return p.close();
    }
    draw();
  };
  draw();
  p.timers.push(setInterval(draw, 250));
}

// ---------- 변신술사 대상 고르기 ----------
export function openShiftPicker() {
  const S = G.S;
  const bodies = new Set((scene.bodies || []).filter(b => !b.gone).map(b => b.id));
  const list = [...scene.players.values()].filter(p => p.id !== S.you && !S.gone?.has(p.id) && (!S.dead.has(p.id) || bodies.has(p.id)));
  const p = openPanel('shift', `<div class="pnlback"><div class="pnl shiftp"><button class="xbtn">✕</button><h3>${icon('shift')} 누구로 변신할까요?</h3>
    <div class="sgrid">${list.map(pl => `<button data-id="${pl.id}" class="${S.dead.has(pl.id) ? 'dead' : ''} ${S.mates.has(pl.id) ? 'mate' : ''}">${crewImg(pl.look, {}, 150, 108)}<b>${esc(pl.name)}</b></button>`).join('') || '<p class="empty">변신할 대상이 없습니다.</p>'}</div></div></div>`);
  p.el.onclick = e => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    sfx('click');
    net.send({ t: 'ability', a: 'shift', id: b.dataset.id });
    p.close();
  };
}

// ---------- 스폰 위치 고르기 (에어십) ----------
export function spawnPicker(points) {
  const m = G.map, S = G.S;
  const list = (Array.isArray(points) && points.length ? points : m.spawnPoints || []).map((pt, i) => (typeof pt === 'number' ? { ...(m.spawnPoints?.[pt] || {}), i: pt } : { ...pt, i: pt.i ?? i }));
  if (!list.length) return;
  const g = geom(m);
  S.picking = true;
  const p = openPanel('spawn', `<div class="spawnpick"><h2>시작 위치를 고르세요</h2><div class="spcards">${list.map((pt, k) => `<button class="spc" data-k="${k}" style="--i:${k}">
    <svg viewBox="${vb(g)}" preserveAspectRatio="xMidYMid meet"><g class="base">${baseMap(m, { labels: false })}</g><circle cx="${pt.x}" cy="${pt.y}" r="${g.u * 3}" class="spdot"/></svg><b>${esc(pt.name || roomLabel(pt.x, pt.y))}</b></button>`).join('')}</div>
    <div class="sptimer"></div></div>`, { onClose: () => { S.picking = false; } });
  const end = now() + 10000;
  const choose = k => {
    const pt = list[k];
    if (!pt) return;
    sfx('click');
    net.send({ t: 'spawn', i: pt.i });
    if (isFinite(pt.x)) scene.teleport?.(S.you, pt.x, pt.y);
    p.close();
  };
  p.el.onclick = e => { const b = e.target.closest('[data-k]'); if (b) choose(+b.dataset.k); };
  p.timers.push(setInterval(() => {
    const left = end - now();
    $('.sptimer', p.el).textContent = `${Math.max(0, Math.ceil(left / 1000))}초 뒤 자동 선택`;
    if (left <= 0) choose(Math.floor(Math.random() * list.length));
  }, 250));
}

// ---------- 연습 모드: 역할/맵 바꾸기 ----------
export function practiceSwitch() {
  const S = G.S;
  const order = ['crewmate', 'impostor', ...(R.order().filter(r => !['crewmate', 'impostor', 'crew'].includes(r)))];
  let role = S.role, map = G.map.id;
  const m = modal(`<h2 style="font-size:40px">연습 모드 설정</h2><div class="prac"><div class="lab">역할</div><div class="prole"></div><div class="lab">맵</div><div class="pmap"></div>
    <div class="row-c"><button class="obtn go">이대로 시작</button></div></div>`);
  const draw = () => {
    $('.prole', m.el).innerHTML = order.map(r => `<button data-r="${r}" class="${r === role ? 'on' : ''}" style="--rc:${roleColor(r)}">${esc(roleName(r))}${roleDef(r)?.ghost ? ' 👻' : ''}</button>`).join('');
    $('.pmap', m.el).innerHTML = MAP_LIST.map(x => `<button data-m="${x.id}" class="${x.id === map ? 'on' : ''}">${mapIcon(x.id)}<span>${esc(x.ko || x.name)}</span></button>`).join('');
  };
  m.el.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.r) { sfx('click'); role = b.dataset.r; draw(); }
    if (b.dataset.m) { sfx('click'); map = b.dataset.m; draw(); }
    if (b.classList.contains('go')) {
      sfx('click'); m.close();
      net.send({ t: 'leave' });
      setTimeout(() => net.send({ t: 'create', mode: 'practice', role: role === 'crewmate' ? 'crew' : role, map, settings: { map } }), 150);
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
    const s = S.game?.settings || S.room.settings;
    const rs = s.roleSet || {};
    $('.set-body', m.el).innerHTML = tab === '플레이어'
      ? `<div class="gplayers">${[...scene.players.values()].map(p => `<div class="gp ${S.dead.has(p.id) ? 'dead' : ''}">${crewImg(p.look, {}, 90, 65)}<span style="${S.mates.has(p.id) && isImp() ? 'color:#ff3b3b' : ''}">${esc(p.name)}</span>${p.id === S.you ? `<em style="color:${roleColor(S.role)}">${esc(roleName(S.role))}</em>` : ''}</div>`).join('')}</div>`
      : tab === '설정' ? `<div class="gset">${SETTINGS.map(d => s[d[0]] === undefined ? '' : `<div class="set-row"><span>${d[1]}</span><b>${fmtSetting(d, s[d[0]])}</b></div>`).join('')}<div class="set-row"><span>맵</span><b>${esc(G.map.ko || G.map.name)}</b></div></div>`
        : `<div class="groles">${R.order().map(r => { const d = roleDef(r) || {}, q = rs[r] || {}; return `<div class="set-row"><span style="color:${roleColor(r)};min-width:150px">${esc(roleName(r))}${r === S.role ? ' (나)' : ''}</span><span class="rd">${esc(d.desc || '')}</span><b>${q.max ? `${q.max}명 · ${q.chance ?? 0}%` : '꺼짐'}</b></div>`; }).join('')}</div>`;
  };
  $$('.set-tabs button', m.el).forEach(b => b.onclick = () => { sfx('click'); tab = b.textContent; draw(); });
  draw();
}

// ---------- 로비: 플레이어 목록 ----------
export function playersBox() {
  sfx('click');
  const S = G.S, r = S.room, host = r.host === S.you;
  const m = modal(`<h2 style="font-size:40px">플레이어 (${r.players.length}/${r.settings.maxPlayers})</h2><div class="plist2">
    ${r.players.map(p => `<div class="set-row"><span>${crewImg(p.look, {}, 70, 50)} ${esc(p.name)} <small style="color:#888">Lv.${p.lvl}</small> ${p.id === r.host ? '<b class="crown">주최자</b>' : ''}</span>
    ${host && p.id !== S.you && !p.bot ? `<div class="tog"><button data-kick="${p.id}">내보내기</button><button data-ban="${p.id}">차단</button></div>` : ''}</div>`).join('')}
    ${r.mode === 'online' ? `<p style="text-align:center">코드: <b>${settings.streamer ? '******' : r.code}</b></p>` : ''}</div>`);
  $$('[data-kick],[data-ban]', m.el).forEach(b => b.onclick = () => { net.send({ t: 'kick', id: b.dataset.kick || b.dataset.ban, ban: !!b.dataset.ban }); m.close(); });
}

// ---------- 로비: 게임 설정 (gamesettings.js 가 없을 때 대체) ----------
export function settingsFallback(editable, onChange) {
  const S = G.S;
  const m = modal(`<h2 style="font-size:40px">게임 설정</h2><div class="set-body" style="width:900px;height:470px"></div>`);
  const draw = () => {
    if (!m.back.isConnected) return;
    const s = S.room.settings, host = editable;
    const rows = [
      `<div class="set-row"><span>프리셋</span><div class="tog">${Object.keys(PRESETS).map(p => `<button data-pre="${p}" class="${s.preset === p ? 'on' : ''}" ${host ? '' : 'disabled'}>${p}</button>`).join('')}</div></div>`,
      `<div class="set-row"><span>맵</span><div class="tog">${MAP_LIST.map(x => `<button data-map="${x.id}" class="${s.map === x.id ? 'on' : ''}" ${host ? '' : 'disabled'}>${esc(x.ko || x.name)}</button>`).join('')}</div></div>`,
      `<div class="set-row"><span>게임 유형</span><div class="tog">${[['classic', '클래식'], ['hns', '숨바꼭질']].map(([k, l]) => `<button data-gt="${k}" class="${s.gameType === k ? 'on' : ''}" ${host ? '' : 'disabled'}>${l}</button>`).join('')}</div></div>`,
      ...SETTINGS.filter(d => s[d[0]] !== undefined).map(d => `<div class="set-row"><span>${d[1]}</span><div class="tog">${host ? `<button data-k="${d[0]}" data-d="-1">-</button>` : ''}
        <b style="min-width:110px;text-align:center">${fmtSetting(d, s[d[0]])}</b>${host ? `<button data-k="${d[0]}" data-d="1">+</button>` : ''}</div></div>`),
    ];
    $('.set-body', m.el).innerHTML = rows.join('');
  };
  $('.set-body', m.el).onclick = e => {
    const b = e.target.closest('button');
    if (!b || !editable) return;
    sfx('click');
    const s = S.room.settings, d = b.dataset;
    if (d.pre) onChange({ preset: d.pre });
    if (d.map) onChange({ map: d.map });
    if (d.gt) onChange({ gameType: d.gt });
    if (d.k) { const def = SETTINGS.find(x => x[0] === d.k); onChange({ [d.k]: s[d.k] + (def ? def[5] : 1) * +d.d }); }
  };
  draw();
  return { refresh: draw, close: () => m.close() };
}

// 맵 선택용 이름
export const mapNameOf = id => { const x = getMap(id); return x?.ko || x?.name || id; };
