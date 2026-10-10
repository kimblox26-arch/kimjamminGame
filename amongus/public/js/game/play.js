// 로비/게임 진행 화면: HUD, 회의, 투표, 채팅, 지도, 종료 화면
import { $, $$, h, esc, stage, modal, toast, sfx, music, net, me, profile, saveProfile, settings, addXp, censor } from '../core.js';
import { TASKS, SETTINGS, PRESETS, fmtSetting, ROLES, QUICK, COLORS, SABOTAGES, MAPS, CHAT_LANGS } from '../shared/data.js';
import { ROOM_NAMES } from '../shared/maps.js';
import { scene, SKELD, LOBBY } from './scene.js';
import { openGame } from './tasks.js';
import { crewSVG, mapIcon } from '../ui/crew.js';
import { app, go, screens } from '../ui/nav.js';

const KILL_D = [200, 260, 350];
const SAB_STATIONS = { reactor: { hand1: 'h1', hand2: 'h2' }, o2: { o2k: 'k1', o2k_admin: 'k2' }, lights: { lights: 'l' }, comms: { comms: 'c' } };
const SAB_GAME = { reactor: 'hand', o2: 'keypad', lights: 'lights', comms: 'comms' };
let S = null;     // 현재 방 상태
let hud = null, tick = 0, mg = null, overlays = [];

const now = () => performance.now();
const P = id => S.room.players.find(p => p.id === id);
const nameOf = id => scene.players.get(id)?.name || P(id)?.name || '?';
const isImp = () => S.role === 'impostor';
const alive = () => S.game && !S.dead.has(S.you);
const canFree = () => me.status === 'green' && S.room.settings.chatType === 'free';
const stat = (k, n = 1) => { profile.stats[k] += n; saveProfile(); };

// ---------- 방 입장/퇴장 ----------
net.on('joined', m => {
  closeOverlays();
  S = { room: m.room, you: m.you, min: m.min, game: null, chat: [], unread: 0, dead: new Set(), tasks: [], logs: [] };
  app.inRoom = true;
  music(false);
  scene.meId = m.you;
  scene.onMove = (x, y, d, mv) => net.send({ t: 'move', x, y, d, m: mv });
  scene.onArrow = id => { sfx('vent'); net.send({ t: 'vent', a: 'move', v: id }); };
  stage().classList.add('ingame');
  lobbyView();
  clearInterval(tick);
  tick = setInterval(frame, 100);
});
function leaveRoom(msg) {
  if (!S) return;
  clearInterval(tick);
  closeOverlays();
  S = null; app.inRoom = false;
  scene.stop();
  stage().classList.remove('ingame');
  go('menu', 'play');
  if (msg) toast(msg, 3500);
}
net.on('leftRoom', () => leaveRoom());
net.on('kicked', m => leaveRoom(m.ban ? '주최자가 게임에서 추방(차단)했습니다.' : '주최자가 게임에서 내보냈습니다.'));
net.on('close', () => leaveRoom('서버와 연결이 끊어졌습니다.'));
const leave = () => { net.send({ t: 'leave' }); leaveRoom(); };
function closeOverlays() { mg?.close(); mg = null; overlays.forEach(o => o.remove()); overlays = []; $$('.modal-back,.chat,.mapov,.mg-back').forEach(e => e.remove()); }
const overlay = html => { const el = h(html); stage().append(el); overlays.push(el); return el; };
const dropOverlay = el => { el?.remove(); overlays = overlays.filter(o => o !== el); };

// ---------- 공통 HUD ----------
function baseHud(inner) {
  hud = h(`<div class="hud">${inner}
    <div class="joy ${showJoy() ? '' : 'hidden'}" style="transform:scale(${settings.joySize});transform-origin:left bottom"><i></i></div>
    <div class="ping"></div><div class="notice-left"></div><div class="center-msg"></div></div>`);
  stage().replaceChildren(hud);
  const joy = $('.joy', hud), knob = $('i', joy);
  let jid = null;
  const jmove = e => {
    const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
    const d = Math.hypot(dx, dy); if (d > 1) { dx /= d; dy /= d; }
    scene.joy.x = Math.abs(dx) > 0.15 ? dx : 0; scene.joy.y = Math.abs(dy) > 0.15 ? dy : 0;
    knob.style.transform = `translate(${dx * 55}px,${dy * 55}px)`;
  };
  joy.onpointerdown = e => { jid = e.pointerId; joy.setPointerCapture(jid); jmove(e); };
  joy.onpointermove = e => e.pointerId === jid && jmove(e);
  joy.onpointerup = joy.onpointercancel = () => { jid = null; scene.joy.x = scene.joy.y = 0; knob.style.transform = ''; };
  $$('[data-act]', hud).forEach(b => b.onclick = () => act(b.dataset.act));
}
const showJoy = () => settings.control === 'joystick' && matchMedia('(pointer:coarse)').matches;
addEventListener('settings', () => { const j = hud && $('.joy', hud); if (j) { j.classList.toggle('hidden', !showJoy()); j.style.transform = `scale(${settings.joySize})`; } });

// ---------- 로비 ----------
function lobbyView() {
  S.game = null; S.dead = new Set();
  scene.start(LOBBY);
  Object.assign(scene, { ghost: false, vision: 1, lightsOut: false, inVent: null, frozen: false, speed: 1, sabTargets: [], taskStations: new Set(), redNames: new Set(), bodies: [] });
  scene.players.clear(); scene.visuals.clear();
  for (const p of S.room.players) scene.setPlayer({ ...p, dead: false, vent: 0 });
  baseHud(`<div class="hbtns"><button class="hb chatb">💬<i class="badge hidden"></i></button><button class="hb setb">⚙️</button><button class="hb infob">📱</button></div>
    <div class="lobpanel"></div><div class="logs"></div>
    <div class="startbar"><div class="host"></div><button class="startb"></button><div class="code"></div></div>
    <div class="acts"><button class="act use" data-act="use"><span class="ic">✋</span>사용</button></div>`);
  $('.chatb', hud).onclick = openChat;
  $('.setb', hud).onclick = () => { sfx('click'); go('settings', { onLeave: leave }); };
  $('.infob', hud).onclick = playersBox;
  $('.startb', hud).onclick = () => { sfx('click'); net.send({ t: 'start' }); };
  if (S.room.mode === 'practice') $('.startbar', hud).classList.add('hidden');
  renderLobby();
}
function renderLobby() {
  if (!S || S.game || !hud) return;
  const r = S.room, s = r.settings, host = P(r.host), mine = r.host === S.you, n = r.players.length;
  const pv = r.mode === 'local' ? '로컬' : r.mode === 'practice' ? '연습' : r.isPublic ? '공개' : '비공개';
  const lp = $('.lobpanel', hud);
  if (!lp) return;
  lp.innerHTML = `<h3>${r.mode === 'local' ? '로컬 로비' : r.mode === 'practice' ? '연습 모드' : '온라인 로비'}</h3><div class="l">방 설정</div>
    <div class="mapban">${mapIcon(s.map)}${MAPS.find(m => m.id === s.map).name}</div>
    <div class="kv"><span>용량</span><b>${crewSVG({ color: 0 }, { noPet: true })}<span style="color:#f33">${n}/${s.maxPlayers}</span></b>
    <span>프리셋</span><b class="pre">${s.preset}</b><span>개인 정보 보호</span><b class="priv">${pv}</b></div>
    <div class="l">게임 설정</div><div class="two"><button class="ed" ${mine ? '' : 'disabled'}>편집</button><button class="vw">보기</button></div>`;
  $('.ed', lp).onclick = () => { sfx('click'); editSettings(true); };
  $('.vw', lp).onclick = () => { sfx('click'); editSettings(false); };
  $('.priv', lp).onclick = () => { if (mine && r.mode === 'online') net.send({ t: 'privacy', v: !r.isPublic }); };
  $('.pre', lp).onclick = () => mine && editSettings(true);
  $('.host', hud).innerHTML = `주최자: ${crewSVG(host?.look || {}, { noPet: true }).replace('<svg', '<svg style="width:44px;height:34px;vertical-align:middle"')} <span style="color:${COLORS[host?.look.color ?? 0][1]}">${esc(host?.name)}</span>${mine ? ' (거기 친구!)' : ''}`;
  const sb = $('.startb', hud);
  if (S.countdown) { sb.textContent = `${S.countdown}초 후 시작`; sb.disabled = true; }
  else if (mine) { sb.textContent = n >= S.min ? '시작' : '플레이어를 기다리는 중'; sb.disabled = n < S.min; }
  else { sb.textContent = '주최자를 기다리는 중'; sb.disabled = true; }
  $('.code', hud).textContent = r.mode === 'online' ? `코드: ${settings.streamer ? '******' : r.code} · ${CHAT_LANGS[s.chatLang]} · ${s.chatType === 'free' ? '자유 채팅' : '빠른 채팅'}` : r.mode === 'local' ? '같은 와이파이에서 참가할 수 있어요' : '';
}
net.on('room', m => {
  if (!S) return;
  S.room = m.room;
  if (S.pendingLobby) return;
  if (!S.game) {
    for (const p of m.room.players) { const old = scene.players.get(p.id); scene.setPlayer({ ...p, ...(old && p.id === S.you ? { x: old.x, y: old.y } : {}) }); }
    for (const id of [...scene.players.keys()]) if (!m.room.players.some(p => p.id === id)) scene.players.delete(id);
    renderLobby();
    editRefresh?.();
  }
});
net.on('log', m => {
  const box = hud && $('.logs', hud);
  if (!box) return;
  for (const l of m.lines) {
    const d = h(`<div>${esc(l)}</div>`); box.append(d);
    setTimeout(() => (d.style.opacity = 0), 6000); setTimeout(() => d.remove(), 7000);
  }
  while (box.children.length > 5) box.firstChild.remove();
});
net.on('countdown', m => { if (!S) return; S.countdown = m.n; renderLobby(); if (m.n) sfx('vote'); });
net.on('gone', m => {
  if (!S) return;
  scene.players.delete(m.id);
  const el = hud && $('.notice-left', hud);
  if (el) { el.textContent = `◀ ${m.name} 님이 게임에서 나갔습니다.`; clearTimeout(el._t); el._t = setTimeout(() => (el.textContent = ''), 4000); }
  if (S.game) { S.dead.add(m.id); }
});

let editRefresh = null;
function editSettings(editable) {
  const host = S.room.host === S.you && editable && !S.game;
  const m = modal(`<h2 style="font-size:40px">게임 설정</h2><div class="set-body" style="width:900px;height:470px"></div>`, { onClose: () => (editRefresh = null) });
  const draw = () => {
    const s = S.room.settings;
    const rows = [
      `<div class="set-row"><span>프리셋</span><div class="tog">${Object.keys(PRESETS).map(p => `<button data-pre="${p}" class="${s.preset === p ? 'on' : ''}" ${host ? '' : 'disabled'}>${p}</button>`).join('')}${s.preset === '커스텀' ? '<button class="on" disabled>커스텀</button>' : ''}</div></div>`,
      `<div class="set-row"><span>게임 유형</span><div class="tog">${[['classic', '클래식'], ['hns', '숨바꼭질']].map(([k, l]) => `<button data-gt="${k}" class="${s.gameType === k ? 'on' : ''}" ${host ? '' : 'disabled'}>${l}</button>`).join('')}</div></div>`,
      `<div class="set-row"><span>최대 인원</span><div class="tog">${host ? '<button data-k="maxPlayers" data-d="-1">-</button>' : ''}<b style="min-width:80px;text-align:center">${s.maxPlayers}</b>${host ? '<button data-k="maxPlayers" data-d="1">+</button>' : ''}</div></div>`,
      `<div class="set-row"><span>역할 (엔지니어·과학자)</span><div class="tog"><button data-roles="1" class="${s.roles ? 'on' : ''}" ${host ? '' : 'disabled'}>켬</button><button data-roles="0" class="${s.roles ? '' : 'on'}" ${host ? '' : 'disabled'}>끔</button></div></div>`,
      ...SETTINGS.filter(d => d[0] !== 'hnsTime' || s.gameType === 'hns').map(d => `<div class="set-row"><span>${d[1]}</span><div class="tog">${host ? `<button data-k="${d[0]}" data-d="-1">-</button>` : ''}
        <b style="min-width:110px;text-align:center">${fmtSetting(d, s[d[0]])}</b>${host ? `<button data-k="${d[0]}" data-d="1">+</button>` : ''}</div></div>`),
    ];
    $('.set-body', m.el).innerHTML = rows.join('');
  };
  $('.set-body', m.el).onclick = e => {
    const b = e.target.closest('button');
    if (!b || !host) return;
    sfx('click');
    const s = S.room.settings, d = b.dataset;
    if (d.pre) net.send({ t: 'settings', s: { preset: d.pre } });
    if (d.gt) net.send({ t: 'settings', s: { gameType: d.gt } });
    if (d.roles) net.send({ t: 'settings', s: { roles: d.roles === '1' } });
    if (d.k) {
      const def = SETTINGS.find(x => x[0] === d.k), step = def ? def[5] : 1;
      net.send({ t: 'settings', s: { [d.k]: s[d.k] + step * +d.d } });
    }
  };
  editRefresh = () => m.back.isConnected && draw();
  draw();
}
function playersBox() {
  sfx('click');
  const r = S.room, host = r.host === S.you;
  const m = modal(`<h2 style="font-size:40px">플레이어 (${r.players.length}/${r.settings.maxPlayers})</h2><div style="width:760px;font-size:24px">
    ${r.players.map(p => `<div class="set-row"><span>${crewSVG(p.look, { noPet: true }).replace('<svg', '<svg style="width:60px;height:44px;vertical-align:middle"')} ${esc(p.name)} <small style="color:#888">Lv.${p.lvl}</small> ${p.id === r.host ? '👑' : ''}</span>
    ${host && p.id !== S.you && !p.bot ? `<div class="tog"><button data-kick="${p.id}">내보내기</button><button data-ban="${p.id}">차단</button></div>` : ''}</div>`).join('')}
    ${r.mode === 'online' ? `<p style="text-align:center">코드: <b>${settings.streamer ? '******' : r.code}</b></p>` : ''}</div>`);
  $$('[data-kick],[data-ban]', m.el).forEach(b => b.onclick = () => { net.send({ t: 'kick', id: b.dataset.kick || b.dataset.ban, ban: !!b.dataset.ban }); m.close(); });
}

// ---------- 게임 시작 ----------
net.on('start', m => {
  if (!S) return;
  closeOverlays();
  S.pendingLobby = false;
  S.countdown = 0;
  S.game = { settings: m.settings, practice: m.practice };
  S.role = m.role; S.mates = new Set(m.mates); S.tasks = m.tasks; S.bar = m.bar; S.dead = new Set(); S.sab = null;
  S.killAt = now() + m.kill; S.emergLeft = m.meetings; S.emergAt = now() + m.settings.emergencyCooldown * 1000; S.hnsEnd = m.hnsLeft ? now() + m.hnsLeft : 0;
  S.chat = []; S.unread = 0; S.reported = false;
  scene.start(SKELD);
  scene.players.clear(); scene.bodies = []; scene.visuals.clear();
  for (const p of m.players) scene.setPlayer({ ...p, dead: false, vent: 0 });
  const s = m.settings;
  Object.assign(scene, { ghost: false, inVent: null, lightsOut: false, sabTargets: [], speed: s.playerSpeed, vision: isImp() ? s.impVision : s.crewVision,
    redNames: isImp() || s.gameType === 'hns' ? new Set(m.mates) : new Set(), frozen: true });
  if (!m.practice) { stat('started'); stat(isImp() ? 'impGames' : 'crewGames'); }
  gameHud();
  roleIntro(m.players);
});
function roleIntro(players) {
  const r = ROLES[S.role], team = S.role === 'impostor' ? players.filter(p => S.mates.has(p.id)) : players;
  const nImp = S.mates.size || S.game.settings.impostors;
  const el = overlay(`<div class="roleintro"><h1 style="color:#fff">쉿!</h1></div>`);
  sfx('alarm');
  setTimeout(() => {
    el.innerHTML = `<h1 style="color:${r.color}">${r.name}</h1><p>${S.role === 'impostor' ? r.desc : S.game.settings.gameType === 'hns' ? '임포스터에게서 끝까지 도망치세요!' : `임포스터가 <b style="color:#f33">${nImp}명</b> 있습니다. ${S.role !== 'crew' ? r.desc : ''}`}</p>
      <div class="team">${team.slice(0, 8).map(p => crewSVG(p.look, { noPet: true })).join('')}</div>`;
  }, 1300);
  setTimeout(() => { dropOverlay(el); scene.frozen = false; }, S.game.practice ? 2500 : 4500);
}
function gameHud() {
  const imp = isImp(), eng = S.role === 'engineer', sci = S.role === 'scientist';
  baseHud(`<div class="taskbar"><i></i><b>모든 임무 완료함</b></div><div class="tasklist"></div><div class="sabtimer"></div>
    <div class="hbtns"><button class="hb chatb hidden">💬<i class="badge hidden"></i></button><button class="hb guide">📋</button><button class="hb setb">⚙️</button><button class="hb mapb">🗺️</button></div>
    <div class="acts">${sci ? '<button class="act ok" data-act="vitals"><span class="ic">💓</span>생체 신호</button>' : ''}
      ${imp ? '<button class="act sab ok" data-act="map"><span class="ic">☢️</span>사보타주</button><button class="act kill" data-act="kill"><span class="ic">🔪</span><span class="cd"></span>처치</button>' : ''}
      ${imp || eng ? '<button class="act vent" data-act="vent"><span class="ic">🕳️</span>벤트</button>' : ''}
      <button class="act report" data-act="report"><span class="ic">📢</span>신고</button><button class="act use" data-act="use"><span class="ic">✋</span>사용</button></div>`);
  $('.chatb', hud).onclick = openChat;
  $('.setb', hud).onclick = () => { sfx('click'); go('settings', { onLeave: leave }); };
  $('.mapb', hud).onclick = () => act('map');
  $('.guide', hud).onclick = matchGuide;
  if (S.game.settings.taskBar === 2) $('.taskbar', hud).classList.add('hidden');
  if (S.game.practice) {
    const b = h(`<button class="obtn" style="position:absolute;left:70px;bottom:20px;min-width:0;height:50px;font-size:20px">역할 바꾸기 (${isImp() ? '크루원' : '임포스터'})</button>`);
    b.onclick = () => { net.send({ t: 'leave' }); setTimeout(() => net.send({ t: 'create', mode: 'practice', role: isImp() ? 'crew' : 'impostor' }), 150); };
    hud.append(b);
  }
  renderTasks();
}
function renderTasks() {
  if (!S?.game || !hud) return;
  const bar = $('.taskbar i', hud);
  if (bar && S.bar) bar.style.width = `${S.bar.total ? (S.bar.done / S.bar.total) * 100 : 0}%`;
  const sab = S.sab, comms = sab?.k === 'comms' && !isImp();
  let html = '';
  if (sab) {
    const parts = Object.keys(SAB_STATIONS[sab.k]).length;
    html += `<div class="sab">${SABOTAGES[sab.k].name}${SABOTAGES[sab.k].critical ? ` ${Math.max(0, Math.ceil((S.sabEnd - now()) / 1000))}초` : ''} (${sab.parts.length}/${parts})</div>`;
  }
  if (isImp()) html += '<div class="fake">사보타주를 하고 크루원을 처치하세요.</div><div class="fake">가짜 임무:</div>';
  if (S.hnsEnd) html += `<div class="part">남은 시간 ${fmtTime(S.hnsEnd - now())}</div>`;
  if (comms) html += '<div class="sab">통신 방해됨 — 통신실에서 수리하세요</div>';
  else for (const t of S.tasks) {
    const T = TASKS[t.id], done = t.step >= t.st.length, st = SKELD.stations[t.st[Math.min(t.step, t.st.length - 1)]];
    const nm = t.id === 'upload' ? (t.step === 0 ? '데이터 다운로드' : '데이터 업로드') : T.name;
    html += `<div class="${done ? 'done' : t.step ? 'part' : ''}">${st.room}: ${nm}${t.st.length > 1 ? ` (${t.step}/${t.st.length})` : ''}</div>`;
  }
  if (S.dead.has(S.you)) html = `<div style="color:#aaa">유령이 되었습니다. ${isImp() ? '사보타주로 동료를 도우세요.' : '임무를 끝내 동료를 도우세요.'}</div>` + html;
  $('.tasklist', hud).innerHTML = html;
  scene.taskStations = new Set(isImp() || comms ? [] : S.tasks.filter(t => t.step < t.st.length).map(t => t.st[t.step]));
}
const fmtTime = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
net.on('tasks', m => { if (!S?.game) return; const before = S.tasks.filter(t => t.step >= t.st.length).length; S.tasks = m.tasks; const after = S.tasks.filter(t => t.step >= t.st.length).length; if (after > before && !S.game.practice) stat('tasks'); if (after === S.tasks.length && after > before && !S.game.practice) stat('allTasks'); renderTasks(); });
net.on('bar', m => { if (S?.game) { S.bar = m.bar; renderTasks(); } });

// ---------- 매 프레임(0.1초) HUD 갱신 ----------
function nearest(list, max) {
  const meP = scene.me;
  let best = null, bd = max;
  for (const it of list) { const d = Math.hypot(it.x - meP.x, it.y - meP.y); if (d < bd) { bd = d; best = it; } }
  return best;
}
function frame() {
  if (!S || !hud) return;
  const pg = $('.ping', hud);
  if (pg) pg.textContent = `PING: ${net.ping} ms`;
  const meP = scene.me;
  if (!meP) return;
  const setBtn = (sel, ok) => $(sel, hud)?.classList.toggle('ok', !!ok);
  if (!S.game) {
    const st = Object.entries(LOBBY.stations).map(([id, s]) => ({ id, ...s }));
    const n = nearest(st, 230);
    scene.hl = n?.id || null; S.use = n ? { kind: 'custom', id: n.id } : null;
    setBtn('.use', S.use);
    $('.chatb .badge', hud)?.classList.toggle('hidden', !S.unread);
    if ($('.chatb .badge', hud)) $('.chatb .badge', hud).textContent = S.unread;
    return;
  }
  const g = S.game, live = alive(), inPlay = !S.meeting && !scene.frozen;
  // 사용 대상: 내 임무 → 사보타주 수리 → 긴급 버튼
  const cands = [];
  if (!isImp() && S.sab?.k !== 'comms') for (const [i, t] of S.tasks.entries()) if (t.step < t.st.length) { const s = SKELD.stations[t.st[t.step]]; cands.push({ kind: 'task', i, id: t.st[t.step], x: s.x, y: s.y }); }
  if (S.sab && live) for (const [id, part] of Object.entries(SAB_STATIONS[S.sab.k])) if (!S.sab.parts.includes(part) || S.sab.k === 'reactor') { const s = SKELD.stations[id]; cands.push({ kind: 'fix', id, part, x: s.x, y: s.y }); }
  if (live && g.settings.gameType !== 'hns') cands.push({ kind: 'button', id: 'button', ...SKELD.button, r: 300 });
  const use = inPlay ? nearest(cands, 230) || (live && g.settings.gameType !== 'hns' && Math.hypot(SKELD.button.x - meP.x, SKELD.button.y - meP.y) < 330 ? { kind: 'button', id: 'button' } : null) : null;
  S.use = use; scene.hl = use?.id || null;
  setBtn('.use', use);
  // 신고
  const body = live && inPlay && g.settings.gameType !== 'hns' ? nearest(scene.bodies, 320) : null;
  S.report = body; scene.reportId = body?.id || null; setBtn('.report', body);
  // 처치
  if (isImp()) {
    const targets = live && inPlay && !scene.inVent ? [...scene.players.values()].filter(p => !p.dead && !p.vent && !S.mates.has(p.id) && p.id !== S.you) : [];
    const t = nearest(targets, KILL_D[g.settings.killDistance]);
    const cd = Math.ceil((S.killAt - now()) / 1000);
    S.kill = cd <= 0 ? t : null; scene.killId = S.kill?.id || null;
    setBtn('.kill', S.kill);
    const cdEl = $('.kill .cd', hud); if (cdEl) cdEl.textContent = cd > 0 && live ? cd : '';
  }
  if (isImp() || S.role === 'engineer') {
    const vents = Object.entries(SKELD.vents).map(([id, v]) => ({ id, ...v }));
    const v = live && inPlay ? (scene.inVent ? { id: scene.inVent } : nearest(vents, 200)) : null;
    S.vent = v; if (!scene.inVent && v && !use) scene.hl = v.id;
    setBtn('.vent', v);
  }
  const showChat = !live || S.meeting;
  $('.chatb', hud)?.classList.toggle('hidden', !showChat);
  const badge = $('.chatb .badge', hud);
  if (badge) { badge.textContent = S.unread; badge.classList.toggle('hidden', !S.unread); }
  if (S.sab || S.hnsEnd) renderTasks();
  const sabEl = $('.sabtimer', hud);
  if (sabEl) sabEl.textContent = S.sab && SABOTAGES[S.sab.k].critical ? `⚠ ${SABOTAGES[S.sab.k].name}! ${Math.max(0, Math.ceil((S.sabEnd - now()) / 1000))}초` : '';
}

function act(a) {
  if (!S) return;
  if (a === 'map') { sfx('click'); return openMap(); }
  if (a === 'vitals') return vitals();
  if (!S.game) {
    if (a === 'use' && S.use) { sfx('click'); const taken = () => new Set(S.room.players.filter(p => p.id !== S.you).map(p => p.look.color)); screens.customize(taken, S.use.id === 'box' ? 'hat' : 'color'); }
    return;
  }
  if (mg || S.meeting) return;
  if (a === 'use' && S.use) {
    sfx('click');
    const u = S.use;
    if (u.kind === 'task') {
      const t = S.tasks[u.i], T = TASKS[t.id];
      scene.frozen = true;
      mg = openGame(stage(), T.game, '', { station: u.id, visual: (k, on) => net.send({ t: 'visual', k, on }), onClose: () => { mg = null; scene.frozen = false; } },
        () => net.send({ t: 'task', i: u.i }));
    } else if (u.kind === 'fix') {
      const k = S.sab.k;
      scene.frozen = true;
      mg = openGame(stage(), SAB_GAME[k], '', { fix: on => net.send({ t: 'fix', k, p: u.part, on }), onClose: () => { mg = null; scene.frozen = false; } }, () => stat('sabFixed'));
    } else if (u.kind === 'button') emergencyBox();
  }
  if (a === 'report' && S.report) { sfx('click'); net.send({ t: 'report', id: S.report.id }); S.reported = true; }
  if (a === 'kill' && S.kill) net.send({ t: 'kill', id: S.kill.id });
  if (a === 'vent' && S.vent) { sfx('vent'); net.send({ t: 'vent', a: scene.inVent ? 'out' : 'in', v: S.vent.id }); }
}
addEventListener('keydown', e => {
  if (!S || e.target.tagName === 'INPUT') return;
  const k = { KeyE: 'use', Space: 'use', KeyQ: 'kill', KeyR: 'report', Tab: 'map', KeyV: 'vent' }[e.code];
  if (k) { e.preventDefault(); if (k === 'map' && $('.mapov')) return dropOverlay($('.mapov')); if (S.game || k === 'use') act(k); }
  if (e.code === 'Escape') { mg?.close(); $('.mapov')?.remove(); }
});

function emergencyBox() {
  const left = S.emergLeft, cd = Math.ceil((S.emergAt - now()) / 1000), crit = S.sab && SABOTAGES[S.sab.k].critical;
  const txt = crit ? '긴급 상황 중에는\n회의를 소집할 수 없습니다.' : left <= 0 ? '긴급 회의를\n모두 사용했습니다.' : cd > 0 ? `긴급 회의 쿨다운:\n${cd}초` : `${esc(nameOf(S.you))} 크루원님의 긴급회의가\n<b style="color:#e22;font-size:40px">${left}</b>\n회 남아 있습니다.`;
  scene.frozen = true;
  const el = overlay(`<div class="mg-back"><div class="mg" style="width:600px;height:600px;background:#2f5f9a"><button class="xbtn">✕</button>
    <svg class="full" viewBox="0 0 600 600"><text x="300" y="120" text-anchor="middle" font-size="80" fill="rgba(255,255,255,.75)" transform="scale(-1 -1) translate(-600 -170)" font-family="Impact,sans-serif">EMERGENCY</text>
    <path d="M110 330 L490 330 L560 470 L40 470 Z" fill="#ffb300" stroke="#222" stroke-width="6"/><ellipse class="btn" cx="300" cy="330" rx="140" ry="70" fill="#c62828" stroke="#5a0000" stroke-width="6" style="cursor:pointer"/>
    <ellipse cx="300" cy="312" rx="140" ry="70" fill="#e53935" pointer-events="none"/></svg>
    <div style="position:absolute;left:40px;right:40px;bottom:20px;background:#eef;color:#222;border:4px dashed #555;border-radius:12px;padding:12px;text-align:center;font-size:26px;font-family:monospace;white-space:pre-line">${txt}</div></div></div>`);
  const close = () => { dropOverlay(el); scene.frozen = false; };
  $('.xbtn', el).onclick = close;
  $('.btn', el).onclick = () => { if (!crit && left > 0 && cd <= 0) { net.send({ t: 'emergency' }); stat('meetings'); } close(); };
}

// ---------- 처치 / 벤트 / 시각 효과 / 사보타주 ----------
net.on('kill', m => {
  if (!S?.game) return;
  const v = scene.players.get(m.id);
  S.dead.add(m.id);
  if (v) { v.dead = true; scene.bodies.push({ id: m.id, x: m.x, y: m.y, look: v.look }); }
  if (m.by === S.you) { scene.teleport(S.you, m.x, m.y); S.killAt = now() + m.cd; sfx('kill'); if (!S.game.practice) stat('kills'); }
  if (m.id === S.you) {
    sfx('kill'); mg?.close();
    const k = scene.players.get(m.by);
    const el = overlay(`<div class="splash" style="background:radial-gradient(#7a0000,#000 70%)"><div style="display:flex;align-items:center">${crewSVG(k?.look || {}, { noPet: true }).replace('<svg', '<svg style="width:360px;height:260px"')}<span style="font-size:120px">🔪</span>${crewSVG(v?.look || {}, { dead: true }).replace('<svg', '<svg style="width:360px;height:260px"')}</div></div>`);
    setTimeout(() => dropOverlay(el), 1800);
    scene.ghost = true; renderTasks();
  }
});
net.on('vent', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.id);
  if (p) { p.vent = m.v ? 1 : 0; }
  if (m.id === S.you) { scene.inVent = m.v; scene.teleport(S.you, m.x, m.y); }
});
net.on('visual', m => { if (S?.game) scene.visuals.set(m.id, { scan: m.on }); });
function setSab(sab, fixed) {
  const was = S.sab;
  S.sab = sab;
  if (sab) { S.sabEnd = now() + sab.left; if (!was) sfx('sab'); }
  scene.lightsOut = sab?.k === 'lights' && !isImp();
  scene.sabTargets = sab ? Object.entries(SAB_STATIONS[sab.k]).filter(([, p]) => !sab.parts.includes(p) || sab.k === 'reactor').map(([id]) => id) : [];
  $('.sabwarn', hud)?.remove();
  if (sab && SABOTAGES[sab.k].critical) hud.append(h('<div class="sabwarn"></div>'));
  if (!sab && was && mg && fixed) mg.close();
  renderTasks();
}
net.on('sab', m => { if (S?.game && hud) setSab(m.sab, m.fixed); });

// ---------- 회의 ----------
let meet = null;
net.on('meeting', m => {
  if (!S?.game) return;
  closeOverlays(); mg = null;
  scene.frozen = true; scene.inVent = null; scene.bodies = [];
  for (const id of m.dead) S.dead.add(id);
  if (m.bar) S.bar = m.bar;
  if (m.sab !== undefined) setSab(m.sab);
  S.emergLeft = m.meetings[S.you] ?? S.emergLeft;
  if (m.caller === S.you && m.body) stat('reports');
  S.meeting = { caller: m.caller, body: m.body, voted: new Set(), stage: 'discuss', end: now() + m.intro + m.discuss, voteEnd: now() + m.intro + m.discuss + m.vote, my: null };
  sfx('alarm');
  const sp = overlay(`<div class="splash">${m.body ? '시체 발견!' : '긴급 회의!'}</div>`);
  setTimeout(() => { dropOverlay(sp); meetingUI(); }, m.intro);
});
function meetingUI() {
  if (!S?.meeting) return;
  const M = S.meeting;
  meet = overlay(`<div class="meet"><div class="tablet"><h2>누가 임포스터일까요?</h2><div class="plates"></div>
    <div class="meet-foot"><div class="skiparea"><button class="skipbtn">투표 건너뛰기</button><div class="votes"></div></div><div class="mtime"></div><button class="chatbtn">💬<i class="badge hidden"></i></button></div></div></div>`);
  $('.chatbtn', meet).onclick = openChat;
  $('.skipbtn', meet).onclick = () => vote('skip');
  drawPlates();
  const iv = setInterval(() => {
    if (!meet?.isConnected) return clearInterval(iv);
    const t = $('.mtime', meet);
    t.textContent = M.stage === 'discuss' ? `토론 종료까지: ${Math.max(0, Math.ceil((M.end - now()) / 1000))}초` : M.stage === 'vote' ? `투표 종료까지: ${Math.max(0, Math.ceil((M.voteEnd - now()) / 1000))}초` : '투표 결과';
    const b = $('.chatbtn .badge', meet); b.textContent = S.unread; b.classList.toggle('hidden', !S.unread);
  }, 200);
}
function drawPlates(result) {
  const M = S.meeting, box = meet && $('.plates', meet);
  if (!box) return;
  const ps = [...scene.players.values()];
  box.innerHTML = ps.map(p => {
    const dead = S.dead.has(p.id), votes = result ? result.votes.filter(v => v[1] === p.id) : [];
    return `<div class="pl ${dead ? 'dead' : ''}" data-id="${p.id}" style="${scene.redNames.has(p.id) ? 'color:#d00' : ''}">${crewSVG(p.look, { noPet: true })}<span>${esc(p.name)}</span>
      ${M.caller === p.id ? '<span class="megaphone">📢</span>' : ''}${M.voted.has(p.id) && !result ? '<span class="vtag">투표함</span>' : ''}
      ${M.pick === p.id && !result ? '<div class="conf"><button class="yes">✓</button><button class="no">✕</button></div>' : ''}
      <div class="votes">${votes.map(v => `<i style="background:${v[0] ? COLORS[scene.players.get(v[0])?.look.color ?? 15][1] : '#888'}"></i>`).join('')}</div></div>`;
  }).join('');
  if (result) $('.skiparea .votes', meet).innerHTML = result.votes.filter(v => v[1] === 'skip').map(v => `<i style="background:${v[0] ? COLORS[scene.players.get(v[0])?.look.color ?? 15][1] : '#888'}"></i>`).join('');
  $$('.pl', box).forEach(pl => pl.onclick = e => {
    if (e.target.closest('.yes')) return vote(pl.dataset.id);
    if (e.target.closest('.no')) { M.pick = null; return drawPlates(); }
    if (M.stage !== 'vote' || M.my || !alive() || S.dead.has(pl.dataset.id)) return;
    sfx('click'); M.pick = pl.dataset.id; drawPlates();
  });
}
function vote(id) {
  const M = S.meeting;
  if (!M || M.stage !== 'vote' || M.my || !alive()) return;
  M.my = id; M.pick = null; sfx('vote');
  net.send({ t: 'vote', id });
  drawPlates();
}
net.on('voting', () => { if (S?.meeting) { S.meeting.stage = 'vote'; drawPlates(); } });
net.on('voted', m => { if (S?.meeting) { S.meeting.voted.add(m.id); sfx('vote'); drawPlates(); } });
net.on('result', m => { if (S?.meeting) { S.meeting.stage = 'done'; drawPlates(m); } });
net.on('eject', m => {
  if (!S?.game) return;
  dropOverlay(meet); meet = null; S.meeting = null;
  $$('.chat').forEach(e => e.remove());
  if (m.id) { S.dead.add(m.id); const p = scene.players.get(m.id); if (p) p.dead = true; if (m.id === S.you) { scene.ghost = true; stat('ejected'); } }
  const text = !m.id ? `아무도 추방되지 않았습니다. (${m.tie ? '동점' : '건너뛰기'})` : m.imp === null ? `${esc(m.name)}님이 추방되었습니다.` : `${esc(m.name)}님은 임포스터${m.imp ? '였습니다' : '가 아니었습니다'}.`;
  const el = overlay(`<div class="eject">${m.id ? `<div class="who">${crewSVG(m.look, { noPet: true })}</div>` : ''}<div class="txt"></div><div class="sub"></div></div>`);
  let i = 0;
  const iv = setInterval(() => { $('.txt', el).textContent = text.replace(/<[^>]+>/g, '').slice(0, ++i); if (i > text.length) clearInterval(iv); }, 60);
  setTimeout(() => { if (m.impLeft !== null && m.impLeft !== undefined) $('.sub', el).textContent = `임포스터 ${m.impLeft}명 남음.`; }, 3200);
  setTimeout(() => dropOverlay(el), 6800);
  renderTasks();
});
net.on('resume', m => {
  if (!S?.game) return;
  for (const [id, x, y] of m.pos) scene.teleport(id, x, y);
  S.killAt = now() + m.kill; S.emergAt = now() + m.emerg;
  scene.frozen = false;
  if (m.sab !== undefined) setSab(m.sab);
});

// ---------- 게임 종료 ----------
net.on('over', m => {
  if (!S?.game) return;
  closeOverlays(); meet = null; S.meeting = null; mg = null;
  const roles = new Map(m.roles), myTeam = S.role === 'impostor' ? 'impostor' : 'crew', win = m.winner === myTeam;
  if (!S.game.practice) {
    stat('finished'); if (win) stat(myTeam === 'impostor' ? 'impWins' : 'crewWins');
    addXp(win ? 60 : 35); profile.beans += win ? 30 : 15; saveProfile();
  }
  sfx(win ? 'win' : 'lose');
  const team = m.players.filter(p => (roles.get(p.id) === 'impostor') === (m.winner === 'impostor'));
  S.pendingLobby = true;
  const el = overlay(`<div class="endscr"><h1 style="color:${win ? '#3cf' : '#f33'}">${win ? '승리' : '패배'}</h1><p>${m.winner === 'impostor' ? '임포스터 승리' : '크루원 승리'} — ${m.reason}</p>
    <div class="team">${team.map(p => crewSVG(p.look, { noPet: true })).join('')}</div><p style="color:#ffd84a">${S.game.practice ? '' : `+${win ? 60 : 35} 경험치 · 🫘 +${win ? 30 : 15}`}</p>
    <div class="row-c"><button class="obtn again">다시 하기</button><button class="obtn quit">나가기</button></div></div>`);
  const back = () => { if (!el.isConnected) return; dropOverlay(el); S.pendingLobby = false; lobbyView(); };
  $('.again', el).onclick = back;
  $('.quit', el).onclick = leave;
  setTimeout(back, 9000);
});

// ---------- 채팅 ----------
net.on('chat', m => {
  if (!S) return;
  S.chat.push(m);
  if (S.chat.length > 100) S.chat.shift();
  const box = $('.chat .msgs');
  if (box) { box.append(chatLine(m)); box.scrollTop = 1e9; } else if (!m.sys) S.unread++;
});
function chatLine(m) {
  if (m.sys) return h(`<div class="m sys">${esc(m.text)}</div>`);
  return h(`<div class="m ${m.id === S.you ? 'mine' : ''} ${m.ghost ? 'ghost' : ''}">${crewSVG(m.look, { noPet: true, ghost: m.ghost })}<div class="bub"><b>${esc(m.name)}${m.quick ? ' ⚡' : ''}</b>${esc(censor(m.text))}</div></div>`);
}
function openChat() {
  sfx('click');
  if ($('.chat')) return $('.chat').remove();
  S.unread = 0;
  const free = canFree();
  const el = h(`<div class="chat"><button class="xbtn">✕</button><div class="msgs"></div><div class="bar">
    ${free ? '<input maxlength="100" placeholder="여기에 입력하세요">' : `<span style="flex:1;align-self:center;color:#666;font-size:20px">${me.status === 'green' ? '이 로비는 빠른 채팅 전용입니다.' : me.status === 'teal' ? '만 14세 미만 계정은 빠른 채팅만 사용할 수 있어요.' : '게스트 계정은 빠른 채팅만 사용할 수 있어요.'}</span>`}
    <button class="qbtn">⚡ 빠른 채팅</button>${free ? '<button class="send">보내기</button>' : ''}</div></div>`);
  stage().append(el);
  const box = $('.msgs', el);
  S.chat.forEach(m => box.append(chatLine(m)));
  box.scrollTop = 1e9;
  $('.xbtn', el).onclick = () => el.remove();
  const inp = $('input', el);
  const send = () => { const v = inp.value.trim(); if (v) net.send({ t: 'chat', text: v }); inp.value = ''; };
  if (inp) { $('.send', el).onclick = send; inp.onkeydown = e => { if (e.key === 'Enter') send(); e.stopPropagation(); }; }
  $('.qbtn', el).onclick = () => quickChat(el);
}
function quickChat(el) {
  $('.qc', el)?.remove();
  let cat = 0;
  const q = h('<div class="qc"></div>');
  el.append(q);
  const names = [...scene.players.values()].map(p => p.name);
  const draw = () => {
    q.innerHTML = `<div class="cats">${QUICK.map((c, i) => `<button data-c="${i}" class="${i === cat ? 'on' : ''}">${c[0]}</button>`).join('')}</div>
      <div style="margin-bottom:8px"><select class="sp">${names.map(n => `<option>${esc(n)}</option>`).join('')}</select><select class="sr">${ROOM_NAMES.map((r, i) => `<option value="${i}">${r}</option>`).join('')}</select></div>
      <div class="ph">${QUICK[cat][1].map((p, i) => `<button data-i="${i}">${p.replace('{p}', '○○').replace('{r}', '□□')}</button>`).join('')}</div>`;
    $$('[data-c]', q).forEach(b => b.onclick = () => { cat = +b.dataset.c; draw(); });
    $$('[data-i]', q).forEach(b => b.onclick = () => { net.send({ t: 'chat', q: { c: cat, i: +b.dataset.i, p: $('.sp', q).value, r: +$('.sr', q).value } }); q.remove(); });
  };
  draw();
}

// ---------- 지도 / 정보 / 생체 신호 ----------
function openMap() {
  if ($('.mapov')) return dropOverlay($('.mapov'));
  const m = SKELD, meP = scene.me, imp = isImp() && S.game;
  const pts = p => p.map(q => q.join(',')).join(' ');
  const marks = S.game && !imp ? [...(scene.taskStations || [])].map(id => m.stations[id]) : [];
  const sabRooms = { reactor: '원자로', o2: '산소 공급실', lights: '전기실', comms: '통신실' };
  const el = overlay(`<div class="mapov"><svg viewBox="-100 -100 ${m.w + 200} ${m.h + 200}">
    ${m.halls.map(p => `<polygon points="${pts(p)}" fill="rgba(170,190,255,.75)" stroke="#fff" stroke-width="10"/>`).join('')}
    ${m.rooms.map(r => `<polygon points="${pts(r.poly)}" fill="rgba(20,60,240,.85)" stroke="#fff" stroke-width="14"/>`).join('')}
    ${m.rooms.map(r => `<text x="${r.label.x}" y="${r.label.y - 60}" text-anchor="middle" font-size="110" font-weight="700" fill="#fff" stroke="#000" stroke-width="6" paint-order="stroke">${r.name}</text>`).join('')}
    ${marks.map(s => `<circle cx="${s.x}" cy="${s.y}" r="70" fill="#ffd400" stroke="#000" stroke-width="8"/><text x="${s.x}" y="${s.y + 38}" text-anchor="middle" font-size="110" font-weight="900">!</text>`).join('')}
    ${S.sab ? scene.sabTargets.map(id => `<circle cx="${m.stations[id].x}" cy="${m.stations[id].y}" r="80" fill="#f22" stroke="#000" stroke-width="8"/>`).join('') : ''}
    ${meP ? `<g transform="translate(${meP.x - 90} ${meP.y - 210})">${crewSVG(meP.look, { noPet: true }).replace('<svg', '<svg width="250" height="180"')}</g>` : ''}
    ${imp ? Object.entries(sabRooms).map(([k, rn]) => { const r = m.rooms.find(x => x.name === rn); return `<g class="sabk" data-k="${k}" style="cursor:pointer"><circle cx="${r.label.x}" cy="${r.label.y + 90}" r="105" fill="#b00" stroke="#fff" stroke-width="10"/><text x="${r.label.x}" y="${r.label.y + 135}" text-anchor="middle" font-size="120">${{ reactor: '☢', o2: '💨', lights: '💡', comms: '📡' }[k]}</text></g>`; }).join('') : ''}
  </svg><button class="xbtn">✕</button></div>`);
  $('.xbtn', el).onclick = () => dropOverlay(el);
  $$('.sabk', el).forEach(g => g.onclick = () => { sfx('click'); net.send({ t: 'sab', k: g.dataset.k }); dropOverlay(el); });
}
function matchGuide() {
  sfx('click');
  let tab = '플레이어';
  const m = modal(`<h2 style="font-size:44px">매치 정보 가이드</h2><div class="set-tabs"><button>플레이어</button><button>설정</button><button>역할</button></div><div class="set-body" style="width:900px;height:400px"></div>`);
  const draw = () => {
    $$('.set-tabs button', m.el).forEach(b => b.classList.toggle('on', b.textContent === tab));
    const s = S.game.settings;
    $('.set-body', m.el).innerHTML = tab === '플레이어' ? `<div class="plates" style="grid-template-columns:1fr 1fr">${[...scene.players.values()].map(p => `<div class="pl" style="color:#222">${crewSVG(p.look, { noPet: true })}<span>${esc(p.name)}</span></div>`).join('')}</div>`
      : tab === '설정' ? SETTINGS.map(d => `<div class="set-row"><span>${d[1]}</span><b>${fmtSetting(d, s[d[0]])}</b></div>`).join('')
        : Object.entries(ROLES).map(([k, r]) => `<div class="set-row"><span style="color:${r.color};min-width:140px">${r.name}${k === S.role ? ' (나)' : ''}</span><span style="font-size:20px;flex:1">${r.desc}</span></div>`).join('');
  };
  $$('.set-tabs button', m.el).forEach(b => b.onclick = () => { tab = b.textContent; draw(); });
  draw();
}
function vitals() {
  sfx('click');
  modal(`<h2 style="font-size:40px">생체 신호</h2><div class="vitals" style="width:900px">${[...scene.players.values()].map(p => `<div class="${S.dead.has(p.id) ? 'dead' : ''}">${crewSVG(p.look, { noPet: true })}<br>${esc(p.name)}<br>${S.dead.has(p.id) ? '사망' : '정상'}</div>`).join('')}</div>`);
}

// 다른 플레이어 위치
net.on('pos', m => {
  if (!S) return;
  for (const [id, x, y, d, mv, v] of m.p) {
    if (id === S.you) continue;
    const p = scene.players.get(id);
    if (p) { p.tx = x; p.ty = y; p.dir = d; p.mv = mv; p.vent = v; if (Math.hypot(p.x - x, p.y - y) > 600) { p.x = x; p.y = y; } }
  }
});
net.on('err', m => toast(m.msg));
net.on('toast', m => toast(m.msg));
