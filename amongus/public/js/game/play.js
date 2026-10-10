// 로비/게임 진행: 상태·네트워크 처리, 로비, 회의/투표/추방, 종료 화면, 채팅, mod API
import { $, $$, h, esc, stage, modal, toast, sfx, music, net, me, profile, saveProfile, settings, addXp, censor } from '../core.js';
import { QUICK, COLORS, CHAT_LANGS } from '../shared/data.js';
import { getMap, LOBBY, MAP_LIST, stepGame, stepLabel, taskById, lineClear } from '../shared/maps/index.js';
import { scene } from './scene.js';
import { crewSVG, mapIcon } from '../ui/crew.js';
import { app, go, screens } from '../ui/nav.js';
import * as HUD from './hud.js';
import * as PN from './panels.js';

export const KILL_D = [200, 260, 350];
export const now = () => performance.now();
// 공유 상태 (hud.js / panels.js 가 함께 씀)
export const G = { S: null, hud: null, mg: null, panel: null, overlays: [], map: LOBBY, dt: 0.05, closePanel: () => PN.closePanel(), influenceSVG: k => PN.influenceSVG(k) };
let S = null, tick = 0, lastTick = 0;

// 미니게임/역할 모듈은 늦게 불러와서, 하나가 깨져도 게임 화면은 뜨게 한다
let openGame = null;
import('./tasks.js').then(m => (openGame = m.openGame)).catch(e => console.warn('tasks.js 불러오기 실패', e));
let rolesMod = null;
import('../shared/roles.js').then(m => { rolesMod = m; if (S?.game && G.hud) rebuildActs(); }).catch(() => {});
let gsMod = null;
const loadGS = () => (gsMod ? Promise.resolve(gsMod) : import('../ui/gamesettings.js').then(m => (gsMod = m)).catch(() => null));

// ---------- 역할 ----------
const FALLBACK = {
  crewmate: { team: 'crew', name: '크루원', color: '#8CFFFF', desc: '임무를 수행하세요' },
  impostor: { team: 'impostor', name: '임포스터', color: '#FF1919', desc: '처치 및 방해 공작' },
  engineer: { team: 'crew', name: '엔지니어', color: '#FF8A00', desc: '환풍구를 이용해 이동할 수 있습니다', ability: { id: 'vent', label: '환풍구' } },
  scientist: { team: 'crew', name: '과학자', color: '#00D9FF', desc: '언제든 바이탈 모니터에 접근 가능', ability: { id: 'vitals', label: '바이탈' } },
  tracker: { team: 'crew', name: '추적자', color: '#2BD94A', desc: '지도로 크루원 추적 가능', ability: { id: 'track', label: '추적', target: true } },
  noisemaker: { team: 'crew', name: '노이즈 메이커', color: '#F2F25A', desc: '사망 시 알림 보내기' },
  detective: { team: 'crew', name: '탐정', color: '#4D7BFF', desc: '심문으로 용의자의 사망 당시 위치를 알아내세요', ability: { id: 'interrogate', label: '심문', target: true } },
  judge: { team: 'crew', name: '판사', color: '#D9A440', desc: '회의 중 한 번, 임포스터를 판결로 추방하세요', ability: { id: 'overrule', label: '기각' } },
  guardian: { team: 'crew', ghost: true, name: '수호천사', color: '#C3F6FF', desc: '크루원을 보호하세요', ability: { id: 'protect', label: '보호', target: true } },
  influencer: { team: 'crew', ghost: true, name: '인플루언서', color: '#B48CFF', desc: '이미지 메시지로 살아있는 크루원을 도우세요', ability: { id: 'message', label: '메시지', target: true } },
  shapeshifter: { team: 'impostor', name: '변신술사', color: '#FF1919', desc: '다른 플레이어로 변신하세요', ability: { id: 'shift', label: '변신', target: true } },
  phantom: { team: 'impostor', name: '팬텀', color: '#FF1919', desc: '투명 상태로 변신', ability: { id: 'vanish', label: '사라지기' } },
  viper: { team: 'impostor', name: '바이퍼', color: '#FF1919', desc: '처치 후 시체 용해하기', ability: { id: 'acid', label: '산' } },
};
const FALLBACK_ORDER = ['engineer', 'scientist', 'tracker', 'noisemaker', 'detective', 'judge', 'guardian', 'influencer', 'shapeshifter', 'phantom', 'viper'];
export const roleKey = r => (r === 'crew' || !r ? 'crewmate' : r === 'guardianAngel' || r === 'angel' ? 'guardian' : r);
export const roleDef = r => rolesMod?.ROLE_DEFS?.[roleKey(r)] || FALLBACK[roleKey(r)] || null;
export const isImpRole = r => { const k = roleKey(r); if (rolesMod?.isImpRole) return rolesMod.isImpRole(k); return (roleDef(k)?.team || (k === 'impostor' ? 'impostor' : 'crew')) === 'impostor'; };
export const roleName = r => roleDef(r)?.name || r;
export const roleColor = r => roleDef(r)?.color || (isImpRole(r) ? '#FF1919' : '#8CFFFF');
export const R = { order: () => (rolesMod?.ROLE_ORDER || FALLBACK_ORDER).filter(r => r !== 'crewmate' && r !== 'impostor') };
// 역할 세부 설정값 읽기: settings.roleSet[role] 에서 키 이름이 re 에 맞는 값
export function roleOpt(role, re, def) {
  const st = S?.game?.settings || S?.room?.settings || {}, set = st.roleSet?.[role] || {};
  for (const o of roleDef(role)?.opts || []) if (re.test(o[0])) return +(set[o[0]] ?? o[6] ?? def);
  for (const k in set) if (k !== 'max' && k !== 'chance' && re.test(k)) return +set[k];
  return def;
}

// ---------- 상태 도우미 ----------
const P = id => S?.room.players.find(p => p.id === id);
export const nameOf = id => scene.players.get(id)?.name || P(id)?.name || '?';
export const lookOf = id => scene.players.get(id)?.look || P(id)?.look || { color: 0 };
export const isImp = () => !!S && isImpRole(S.role);
export const alive = () => !!S?.game && !S.dead.has(S.you);
export const hnsMode = () => S?.game?.settings?.gameType === 'hns';
export const isSeeker = () => hnsMode() && isImp();
export const sabDef = k => G.map?.sabotages?.[k] || null;
export const commsOn = () => !!S?.sab && sabDef(S.sab.k)?.type === 'comms';
export const stat = (k, n = 1) => { if (S?.game?.practice) return; profile.stats[k] = (profile.stats[k] || 0) + n; saveProfile(); };
export const myTasksDone = () => { const t = S?.tasks || []; return [t.filter(x => x.step >= x.st.length).length, t.length]; };
export const setCd = (a, ms) => { if (!S) return; S.cd[a] = now() + ms; S.cdMax[a] = Math.max(ms, 1); };
// 위치 → 방 이름 (복도면 "가까운 방 근처")
export function roomLabel(x, y) {
  const m = G.map, r = m.roomAt?.(x, y);
  if (r) return r.name;
  let best = null, bd = 1e12;
  for (const q of m.rooms || []) { const d = Math.hypot(q.label.x - x, q.label.y - y); if (d < bd) { bd = d; best = q; } }
  return best ? `${best.name} 근처 통로` : '통로';
}
const mapIdOf = v => (typeof v === 'string' ? v : v?.id) || null;
const normTasks = list => (list || []).map(t => ({ ...t, st: t.st || t.stations || [], step: t.step || 0 }));
const canFree = () => me.status === 'green' && S.room.settings.chatType !== 'quick';

// ---------- 방 입장/퇴장 ----------
net.on('joined', m => {
  closeAll();
  S = G.S = { room: m.room, you: m.you, min: m.min, game: null, chat: [], unread: 0, dead: new Set(), gone: new Set(), mates: new Set(), tasks: [], cd: {}, cdMax: {}, role: 'crewmate', phase: 'lobby' };
  app.inRoom = true;
  music(false);
  scene.meId = m.you; scene.viewId = m.you; scene.controlId = m.you;
  scene.onMove = (x, y, d, mv, id) => net.send({ t: 'move', x, y, d, m: mv, ...(id && id !== S?.you ? { as: id } : {}) });
  scene.onArrow = id => { sfx('vent'); net.send({ t: 'vent', a: 'move', v: id }); };
  stage().classList.add('ingame');
  lobbyView();
  clearInterval(tick);
  lastTick = now();
  tick = setInterval(frame, 50);
});
function leaveRoom(msg) {
  if (!S) return;
  clearInterval(tick);
  closeAll();
  S = G.S = null; app.inRoom = false;
  scene.stop?.();
  Object.assign(scene, { noclip: false, speedMul: 1 });
  stage().classList.remove('ingame');
  go('menu', 'play');
  if (msg) toast(msg, 3500);
}
net.on('leftRoom', () => leaveRoom());
net.on('kicked', m => leaveRoom(m.ban ? '주최자가 게임에서 추방(차단)했습니다.' : '주최자가 게임에서 내보냈습니다.'));
net.on('close', () => leaveRoom('서버와 연결이 끊어졌습니다.'));
const leave = () => { net.send({ t: 'leave' }); leaveRoom(); };
function closeAll() {
  try { G.mg?.close(); } catch {}
  G.mg = null;
  PN.closePanel();
  G.overlays.forEach(o => o.remove()); G.overlays = [];
  gs?.close?.(); gs = null;
  $$('.modal-back,.chat,.chat2,.mapov2,.mg-back').forEach(e => e.remove());
}
export const overlay = HUD.overlay, dropOverlay = HUD.dropOverlay;

// ---------- 공통 HUD 뼈대 ----------
function baseHud(inner, cls = '') {
  const hud = G.hud = h(`<div class="hud v2 ${cls}">${inner}
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
  hud.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
  return hud;
}
const showJoy = () => settings.control === 'joystick' && matchMedia('(pointer:coarse)').matches;
addEventListener('settings', () => { const j = G.hud && $('.joy', G.hud); if (j) { j.classList.toggle('hidden', !showJoy()); j.style.transform = `scale(${settings.joySize})`; } });
const hb = (cls, ic, title) => `<button class="hb2 ${cls}" title="${title}">${HUD.icon(ic)}<i class="badge hidden"></i></button>`;

// ---------- 로비 ----------
function lobbyView() {
  S.game = null; S.phase = 'lobby'; S.dead = new Set(); S.gone = new Set(); S.sab = null; S.meeting = null;
  G.map = LOBBY;
  startScene(LOBBY);
  Object.assign(scene, { ghost: false, vision: 1, lightsOut: false, inVent: null, frozen: false, speed: S.room.settings.playerSpeed || 1, sabTargets: [], taskStations: new Set(),
    redNames: new Set(), bodies: [], tracks: [], noises: [], mixup: false, doorsClosed: new Set(), hl: null, killId: null, reportId: null, viewId: S.you, controlId: S.you });
  scene.players.clear(); scene.visuals?.clear();
  for (const p of S.room.players) scene.setPlayer({ ...p, dead: false, vent: 0, disguise: null, invisible: false, shield: false });
  baseHud(`<div class="hbtns2">${hb('chatb', 'chat', '채팅')}${hb('setb', 'gear', '설정')}${hb('plb', 'players', '플레이어')}</div>
    <div class="lobpanel2"></div><div class="logs"></div>
    <div class="startbar2"><div class="host"></div><button class="startb"></button><div class="code"></div></div>
    <div class="acts2"><button class="act" data-act="use" data-slot="0"><span class="icw">${HUD.icon('customize')}</span><i class="cdv"></i><b class="cdn"></b><em class="sub"></em><span class="lb">사용</span></button></div>`, 'lobby');
  const hud = G.hud;
  $('.chatb', hud).onclick = openChat;
  $('.setb', hud).onclick = () => { sfx('click'); go('settings', { onLeave: leave }); };
  $('.plb', hud).onclick = PN.playersBox;
  $('.startb', hud).onclick = () => { sfx('click'); net.send({ t: 'start' }); };
  if (S.room.mode === 'practice') $('.startbar2', hud).classList.add('hidden');
  renderLobby();
}
function startScene(map) {
  if (scene.map && scene.setMap && scene.map !== map && scene._started) scene.setMap(map);
  else scene.start(map);
  scene._started = true;
}
function renderLobby() {
  if (!S || S.game || !G.hud) return;
  const hud = G.hud, r = S.room, s = r.settings, host = P(r.host), mine = r.host === S.you, n = r.players.length;
  const pv = r.mode === 'local' ? '로컬' : r.mode === 'practice' ? '연습' : r.isPublic ? '공개' : '비공개';
  const lp = $('.lobpanel2', hud);
  if (!lp) return;
  const mp = getMap(s.map);
  lp.innerHTML = `<h3>${r.mode === 'local' ? '로컬 로비' : r.mode === 'practice' ? '연습 모드' : '온라인 로비'}</h3>
    ${r.mode === 'online' ? `<div class="rcode"><span>방 코드</span><b>${settings.streamer ? '******' : r.code}</b><button class="copy" title="복사">⧉</button></div>` : ''}
    <div class="l">방 설정</div>
    <div class="mapban">${mapIcon(s.map)}<span>${esc(mp.name || s.map)}</span></div>
    <div class="kv"><span>용량</span><b>${crewSVG({ color: 0 }, { noPet: true })}<span style="color:${n >= s.maxPlayers ? '#f33' : '#fff'}">${n}/${s.maxPlayers}</span></b>
    <span>프리셋</span><b class="pre">${esc(s.preset || '핵심 설정')}</b><span>개인 정보 보호</span><b class="priv ${mine && r.mode === 'online' ? 'click' : ''}">${pv}</b>
    <span>게임 유형</span><b>${s.gameType === 'hns' ? '숨바꼭질' : '클래식'}</b></div>
    <div class="l">게임 설정</div><div class="two"><button class="ed" ${mine ? '' : 'disabled'}>편집</button><button class="vw">보기</button></div>`;
  $('.ed', lp).onclick = () => { sfx('click'); editSettings(true); };
  $('.vw', lp).onclick = () => { sfx('click'); editSettings(false); };
  $('.priv', lp).onclick = () => { if (mine && r.mode === 'online') { sfx('click'); net.send({ t: 'privacy', v: !r.isPublic }); } };
  $('.pre', lp).onclick = () => mine && editSettings(true);
  const cp = $('.copy', lp);
  if (cp) cp.onclick = () => { sfx('click'); navigator.clipboard?.writeText(r.code).then(() => toast('방 코드 복사 완료!'), () => {}); };
  $('.host', hud).innerHTML = `${crewSVG(host?.look || {}, { noPet: true }).replace('<svg', '<svg style="width:44px;height:34px;vertical-align:middle"')} <span style="color:${COLORS[host?.look.color ?? 0][1]}">${esc(host?.name)}</span>${mine ? ' (나)' : ''} 님의 로비`;
  const sb = $('.startb', hud);
  if (S.countdown) { sb.innerHTML = `<b>${S.countdown}</b>초 후 시작`; sb.disabled = true; sb.classList.add('cd'); }
  else if (mine) { sb.classList.remove('cd'); sb.innerHTML = n >= S.min ? '시작' : `플레이어를 기다리는 중 <small>${n}/${S.min}</small>`; sb.disabled = n < S.min; }
  else { sb.classList.remove('cd'); sb.textContent = '주최자를 기다리는 중'; sb.disabled = true; }
  $('.code', hud).textContent = r.mode === 'online' ? `${CHAT_LANGS[s.chatLang] || ''} · ${s.chatType === 'quick' ? '빠른 채팅' : '자유 채팅'}` : r.mode === 'local' ? '같은 와이파이에서 참가할 수 있어요' : '';
}
net.on('room', m => {
  if (!S) return;
  const old = S.room;
  S.room = m.room;
  for (const p of m.room.players) { const sp = scene.players.get(p.id); if (sp && JSON.stringify(sp.look) !== JSON.stringify(p.look) && !S.game) sp.look = p.look; }
  if (S.game) {
    // 게임 중 설정 변경 (mod 설정 해킹 등)
    if (JSON.stringify(old.settings) !== JSON.stringify(m.room.settings)) { S.game.settings = { ...S.game.settings, ...m.room.settings }; applyVision(); }
    return;
  }
  if (S.pendingLobby) return;
  for (const p of m.room.players) { const o = scene.players.get(p.id); scene.setPlayer({ ...p, ...(o && p.id === S.you ? { x: o.x, y: o.y } : {}), dead: false, vent: 0 }); }
  for (const id of [...scene.players.keys()]) if (!m.room.players.some(p => p.id === id)) scene.players.delete(id);
  renderLobby();
  gs?.refresh?.(m.room.settings);
});
net.on('log', m => {
  const box = G.hud && $('.logs', G.hud);
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
  S.gone.add(m.id);
  if (!S.game) scene.players.delete(m.id);
  else { S.dead.add(m.id); const p = scene.players.get(m.id); if (p) { p.dead = true; p.gone = true; } }
  HUD.notice(`◀ ${m.name} 님이 게임에서 나갔습니다.`);
});

// 로비 설정 창 (gamesettings.js 우선)
let gs = null;
async function editSettings(editable) {
  const ed = editable && S.room.host === S.you && !S.game;
  const onChange = patch => net.send({ t: 'settings', s: patch });
  const mod = await loadGS();
  gs?.close?.();
  if (mod?.openGameSettings) {
    try { gs = mod.openGameSettings({ settings: S.room.settings, editable: ed, onChange }); return; } catch (e) { console.warn('gamesettings', e); }
  }
  gs = PN.settingsFallback(ed, onChange);
}

// ---------- 게임 시작 ----------
net.on('start', m => {
  if (!S) return;
  closeAll();
  S.pendingLobby = false; S.countdown = 0;
  const s = { ...S.room.settings, ...(m.settings || {}) };
  G.map = getMap(mapIdOf(m.map) || s.map);
  S.game = { settings: s, practice: !!m.practice };
  Object.assign(S, {
    role: roleKey(m.role), mates: new Set(m.mates || []), tasks: normTasks(m.tasks), bar: m.bar || { done: 0, total: 0 }, dead: new Set(), gone: new Set(),
    sab: null, sabEnd: 0, sabReady: now() + (m.sabCd ?? 10000), sabCdMax: m.sabCd ?? 10000, doorCd: {}, doorCdMax: {}, killAt: now() + (m.kill ?? 10000), cd: {}, cdMax: {},
    emergLeft: m.meetings ?? s.emergencyMeetings, emergAt: now() + (s.emergencyCooldown || 0) * 1000, chat: [], unread: 0, meeting: null, phase: 'intro',
    track: null, trackPos: null, alerts: [], shifted: null, vanished: false, cases: [], activeCase: null, deaths: {}, knownDead: new Set(), overruled: false,
    vitals: null, doorlog: [], lastRoom: {}, hns: null, possessed: null, transportUntil: 0, battery: 0, batteryMax: 0, batCdEnd: 0, busy: false,
  });
  for (const [a, ms] of Object.entries(m.roleCds || {})) a === 'kill' ? (S.killAt = now() + ms) : setCd(a, ms);
  if (m.hns || s.gameType === 'hns') setHns(typeof m.hns === 'object' ? m.hns : { phase: 'hide', left: m.hnsLeft || (typeof m.hns === 'number' ? m.hns : 0) });
  if (S.role === 'scientist') { S.batteryMax = roleOpt('scientist', /batt|charge|dur/i, 5); S.battery = S.batteryMax; }
  startScene(G.map);
  scene.players.clear(); scene.visuals?.clear();
  for (const p of m.players) scene.setPlayer({ ...p, dead: false, vent: 0, disguise: null, invisible: false, shield: false });
  Object.assign(scene, { ghost: false, inVent: null, lightsOut: false, sabTargets: [], bodies: [], tracks: [], noises: [], mixup: false, doorsClosed: new Set(),
    redNames: isImp() || hnsMode() ? new Set(m.mates || []) : new Set(), viewId: S.you, controlId: S.you, hl: null, killId: null, reportId: null });
  applyVision();
  stat('started'); stat(isImp() ? 'impGames' : 'crewGames');
  gameHud();
  HUD.roleIntro(m.players, () => {
    if (!S?.game || S.phase !== 'intro') return;
    S.phase = 'play';
    if (m.spawnPick) PN.spawnPicker(Array.isArray(m.spawnPick) ? m.spawnPick : m.spawnPick.points);
    else if (S.pendingSpawn) PN.spawnPicker(S.pendingSpawn);
    S.pendingSpawn = null;
  });
});
function applyVision() {
  if (!S?.game) return;
  const s = S.game.settings, hns = hnsMode(), imp = isImp();
  scene.vision = (imp ? s.impVision : s.crewVision) ?? 1;
  if (hns) scene.vision = (imp ? s.hnsImpVision ?? s.impVision : s.hnsCrewVision ?? s.crewVision) ?? 1;
  let sp = s.playerSpeed || 1;
  if (hns && imp) sp *= 1.25 * (S.hns?.phase === 'final' ? s.hnsFinalSpeed ?? s.finalSpeed ?? 1.2 : 1);
  scene.speed = sp;
}
function gameHud() {
  const practice = S.game.practice;
  baseHud(`<div class="taskbar"><i></i><b>총 임무 완료</b></div>
    <div class="tasklist2 open"><button class="tltab">임무</button><div class="tl"></div></div>
    <div class="hbtns2">${hb('chatb hidden', 'chat', '채팅')}${hb('guideb', 'guide', '매치 정보')}${hb('setb', 'gear', '설정')}${hb('mapb', 'map', '지도')}</div>
    <div class="critov"></div><div class="critbox hidden"><span class="nm"></span><b class="sec"></b></div>
    <div class="hnsbar hidden"><span class="lab"></span><div class="track"><i class="fill"></i></div><b class="tm"></b></div>
    <div class="danger hidden"><div class="dm"><i></i></div><span>위험</span></div>
    <div class="arrows"></div><div class="acts2"></div>
    ${practice ? `<button class="pracb">${HUD.icon('players')}<span>역할·맵 바꾸기</span></button>` : ''}`, 'game');
  const hud = G.hud;
  $('.chatb', hud).onclick = openChat;
  $('.setb', hud).onclick = () => { sfx('click'); go('settings', { onLeave: leave }); };
  $('.mapb', hud).onclick = () => act('map');
  $('.guideb', hud).onclick = PN.matchGuide;
  $('.tltab', hud).onclick = () => { sfx('click'); $('.tasklist2', hud).classList.toggle('open'); };
  if (practice) $('.pracb', hud).onclick = () => { sfx('click'); PN.practiceSwitch(); };
  if (hnsMode()) $('.hnsbar', hud).classList.remove('hidden');
  rebuildActs();
  HUD.setSabUI();
}
function rebuildActs() {
  const box = G.hud && $('.acts2', G.hud);
  if (!box || !S?.game) return;
  box.innerHTML = HUD.buildActs();
  HUD.renderTasks();
}

// ---------- 임무 ----------
net.on('tasks', m => {
  if (!S?.game) return;
  const before = myTasksDone()[0];
  S.tasks = normTasks(m.tasks);
  const [after, n] = myTasksDone();
  if (after > before) {
    stat('tasks');
    if (after === n) stat('allTasks');
    HUD.centerMsg('임무를 완료했습니다!', 1400, 'taskdone');
    if (S.role === 'scientist' && S.batteryMax) { S.battery = S.batteryMax; S.batCdEnd = 0; }
    if (S.role === 'judge') { const need = roleOpt('judge', /task|pct|percent|unlock/i, 50), req = Math.ceil((n * need) / 100); if (before < req && after >= req && !S.overruled) { HUD.SND.unlock(); HUD.notice('기각 능력이 해제되었습니다!'); } }
  }
  HUD.renderTasks();
});
net.on('bar', m => { if (S?.game) { S.bar = m.bar; HUD.renderTasks(); } });

// ---------- 매 프레임 ----------
function syncFrozen() {
  const f = !!G.mg || !!G.panel?.freeze || (!!S.game && (S.phase !== 'play' || S.busy || !!S.possessed || !!S.hnsLocked || S.transportUntil > now()));
  if (scene.frozen !== f) scene.frozen = f;
}
function frame() {
  if (!S || !G.hud) return;
  const t = now();
  G.dt = Math.min(0.2, (t - lastTick) / 1000); lastTick = t;
  const pg = $('.ping', G.hud);
  if (pg) pg.textContent = `PING: ${net.ping} ms`;
  syncFrozen();
  const meP = scene.players.get(S.you);
  if (!meP) return;
  if (!S.game) {
    const st = Object.entries(LOBBY.stations || {}).map(([id, s]) => ({ id, ...s }));
    let n = null, bd = 230;
    for (const s of st) { const d = Math.hypot(s.x - meP.x, s.y - meP.y); if (d < bd) { bd = d; n = s; } }
    scene.hl = n?.id || null; S.use = n ? { kind: 'custom', id: n.id } : null;
    $('[data-act=use]', G.hud)?.classList.toggle('ok', !!S.use);
    const badge = $('.chatb .badge', G.hud);
    if (badge) { badge.textContent = S.unread; badge.classList.toggle('hidden', !S.unread); }
    return;
  }
  scene.abilityId = null;
  HUD.updateHud();
  // 추적: 지연 시간마다 위치 갱신
  if (S.track) {
    if (S.track.until < t) { S.track = null; scene.tracks = []; }
    else {
      const delay = roleOpt('tracker', /delay/i, 1) * 1000;
      if (!S.trackPos || t - S.trackPos.t >= delay) { const p = scene.players.get(S.track.id); if (p && !S.dead.has(S.track.id)) S.trackPos = { x: p.x, y: p.y, t }; else if (p && !S.trackPos) S.trackPos = { x: p.x, y: p.y, t }; }
      scene.tracks = commsOn() ? [] : [{ id: S.track.id, color: S.track.color, x: S.trackPos?.x, y: S.trackPos?.y }];
    }
  }
  // 엔지니어 환풍구 최대 시간
  if (scene.inVent && S.role === 'engineer' && S.ventOutAt && t > S.ventOutAt) { S.ventOutAt = 0; net.send({ t: 'vent', a: 'out', v: scene.inVent }); }
  if (scene.noises?.length) scene.noises = scene.noises.filter(n => n.until > t);
  HUD.drawArrows();
}

// ---------- 행동 ----------
export function act(a) {
  if (!S) return;
  if (!S.game) {
    if (a === 'use' && S.use) { sfx('click'); const taken = () => new Set(S.room.players.filter(p => p.id !== S.you).map(p => p.look.color)); screens.customize?.(taken, S.use.id === 'box' ? 'hat' : 'color'); }
    return;
  }
  if (a === 'map') { sfx('click'); if (G.panel && G.panel.kind !== 'map') return; return PN.openMap(); }
  if (a === 'sabotage') { sfx('click'); if (G.panel?.kind === 'map') return PN.closePanel(); return PN.openMap(true); }
  if (a === 'ab:notes') { sfx('click'); return PN.openNotebook(); }
  if (S.phase !== 'play' || G.mg || (G.panel && G.panel.kind !== 'map')) return;
  if (G.panel?.kind === 'map') PN.closePanel();
  const t = now();
  if (a === 'use' && S.use) {
    const u = S.use;
    sfx('click');
    if (u.kind === 'task') openTask(u);
    else if (u.kind === 'fix') openFix(u);
    else if (u.kind === 'button') PN.emergencyBox();
    else if (u.kind === 'cams') PN.openCams();
    else if (u.kind === 'admin') PN.openAdmin();
    else if (u.kind === 'vitals') PN.openVitals('station');
    else if (u.kind === 'doorlog') PN.openDoorLog();
    else if (u.kind === 'door') openDoorPanel(u.id);
    else if (u.kind === 'transport') { net.send({ t: 'transport', id: u.id }); S.transportUntil = t + 600; }
    return;
  }
  if (a === 'report' && S.report) { sfx('click'); net.send({ t: 'report', id: S.report.id }); return; }
  if (a === 'kill' && S.kill) {
    net.send({ t: 'kill', id: S.kill.id });
    if (S.role === 'viper' && roleDef('viper')?.ability?.id && roleDef('viper').ability.id !== 'kill') net.send({ t: 'ability', a: roleDef('viper').ability.id, id: S.kill.id });
    S.killAt = t + 600; // 서버 응답 전 중복 방지
    return;
  }
  if (a === 'vent' && S.vent) {
    sfx('vent');
    net.send({ t: 'vent', a: scene.inVent ? 'out' : 'in', v: S.vent.id });
    return;
  }
  if (a.startsWith('ab:')) ability(a.slice(3));
}
function ability(id) {
  const btn = G.hud && $(`[data-act="ab:${id}"]`, G.hud);
  if (!btn?.classList.contains('ok')) return;
  const tg = btn._target;
  sfx('click');
  switch (id) {
    case 'vitals': return PN.openVitals('ability');
    case 'shift': if (S.shifted) return net.send({ t: 'ability', a: 'shift', id: null }); return PN.openShiftPicker();
    case 'vanish': return net.send({ t: 'ability', a: 'vanish', on: !S.vanished });
    case 'track': if (S.track) return net.send({ t: 'ability', a: 'track', id: null, off: true }); return tg && net.send({ t: 'ability', a: 'track', id: tg });
    case 'protect': return tg && net.send({ t: 'ability', a: 'protect', id: tg });
    case 'message': return tg && PN.openInfluencer(tg);
    case 'interrogate': return tg && interrogate(tg);
    default: return net.send({ t: 'ability', a: id, ...(tg ? { id: tg } : {}) });
  }
}
// 미니게임 열기 (실패해도 조작이 막히지 않게)
function openMinigame(gameId, title, ctx, onDone) {
  if (!openGame) { toast('미니게임을 불러오는 중입니다…'); return null; }
  let handle = null;
  const c = { map: G.map, ...ctx, onClose: () => { if (G.mg === handle) G.mg = null; ctx.onClose?.(); } };
  try { handle = openGame(stage(), gameId, title, c, onDone); }
  catch (e) { console.warn('미니게임 오류', gameId, e); $$('.mg-back').forEach(x => x.remove()); toast('이 미니게임을 열 수 없습니다.'); return null; }
  if (handle) { handle.sab = ctx.sab; G.mg = handle; }
  return handle;
}
function openTask(u) {
  const t = S.tasks[u.i], T = taskById(G.map, t.id) || { id: t.id, name: t.name || t.id, game: t.game };
  const step = t.step, gid = t.game || stepGame(T, step);
  const params = { ...(T.params || {}), ...(T.stepParams?.[step] || {}), ...(t.params || {}) };
  openMinigame(gid, stepLabel(T, step), { station: u.id, task: T, step, params, visual: (k, on) => net.send({ t: 'visual', k, on: !!on }) },
    () => net.send({ t: 'task', i: u.i, step }));
}
function openFix(u) {
  const k = S.sab.k, d = sabDef(k);
  if (!d) return;
  const params = { ...(d.params || {}), ...(d.params?.[u.id] || {}) };
  openMinigame(d.game, d.name, { station: u.id, sab: k, part: u.part, params, fix: on => net.send({ t: 'fix', k, p: u.part, on: !!on }) },
    () => { stat('sabFixed'); if (!d.together) net.send({ t: 'fix', k, p: u.part, on: true }); });
}
function openDoorPanel(id) {
  const m = G.map, game = m.doorGame || (m.id === 'polus' ? 'door_switch' : 'door_panel');
  openMinigame(game, '문 열기', { station: id, door: m.doorById?.[id] }, () => { net.send({ t: 'openDoor', id }); HUD.SND.open(); });
}
// 탐정 심문: 서버 결과 우선, 없으면 사망 당시 위치 기록으로 판단
function interrogate(id) {
  const cs = S.cases[S.activeCase];
  if (!cs) return;
  net.send({ t: 'ability', a: 'interrogate', id, case: cs.id });
  S.pendingInterro = { id, case: cs.id, t: now() };
  setTimeout(() => {
    if (!S?.pendingInterro || S.pendingInterro.id !== id) return;
    S.pendingInterro = null;
    const snap = S.deaths[cs.id]?.snap?.[id];
    addSuspect(cs.id, id, snap ? roomLabel(snap.x, snap.y) : '알 수 없음');
  }, 700);
}
function addSuspect(caseId, id, room) {
  const cs = S.cases.find(c => c.id === caseId);
  if (!cs || cs.suspects.some(x => x.id === id)) return;
  cs.suspects.push({ id, name: nameOf(id), look: lookOf(id), room });
  stat('interrogated');
  HUD.notice(`${nameOf(id)} 님은 사망 당시 ${room}에 있었습니다.`, 5000);
  HUD.renderTasks();
  if (G.panel?.kind === 'notes') { PN.closePanel(); PN.openNotebook(); }
}
net.on('interrogate', m => {
  if (!S?.game) return;
  const caseId = m.case ?? m.victim ?? S.pendingInterro?.case;
  if (S.pendingInterro?.id === m.id) S.pendingInterro = null;
  if (m.ok === false) return m.msg && toast(m.msg);
  addSuspect(caseId, m.id, m.room || (isFinite(m.x) ? roomLabel(m.x, m.y) : '알 수 없음'));
});

addEventListener('keydown', e => {
  if (!S || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = { KeyE: 'use', Space: 'use', KeyQ: 'kill', KeyR: 'report', Tab: 'map', KeyV: 'vent', KeyF: 'ab1', KeyG: 'ab2', KeyX: 'sabotage' }[e.code];
  if (e.code === 'Escape') { G.mg?.close(); PN.closePanel(); $('.chat2')?.remove(); return; }
  if (!k) return;
  e.preventDefault();
  if (k === 'ab1' || k === 'ab2') { const bs = $$('[data-act^="ab:"]', G.hud).filter(b => !b.classList.contains('hide')); const b = bs[k === 'ab1' ? 0 : 1]; if (b) act(b.dataset.act); return; }
  if (k === 'map' && G.panel?.kind === 'map') return PN.closePanel();
  if (S.game || k === 'use') act(k);
});

// ---------- 처치 / 환풍구 / 시각 효과 ----------
const snapshot = () => Object.fromEntries([...scene.players.values()].map(p => [p.id, { x: p.x, y: p.y }]));
net.on('kill', m => {
  if (!S?.game) return;
  const v = scene.players.get(m.id), k = scene.players.get(m.by);
  S.dead.add(m.id);
  S.deaths[m.id] = { x: m.x, y: m.y, t: now(), snap: snapshot() };
  if (v) { v.dead = true; v.shield = false; }
  if (!m.noBody) scene.bodies = [...scene.bodies.filter(b => b.id !== m.id), { id: m.id, x: m.x, y: m.y, look: v?.look || lookOf(m.id), acid: !!m.acid, t: now(), dissolve: m.dissolve }];
  scene.effect?.('kill', { x: m.x, y: m.y, killer: m.by, victim: m.id });
  if (m.by === S.you) {
    scene.teleport(S.you, m.x, m.y);
    S.killAt = now() + (m.cd ?? S.game.settings.killCooldown * 1000);
    sfx('kill'); stat('kills');
  }
  if (m.id === S.you) {
    sfx('kill');
    try { G.mg?.close(); } catch {}
    PN.closePanel();
    HUD.killSplash(k?.disguise?.look || k?.look || lookOf(m.by), v?.look || lookOf(m.id));
    becomeGhost();
  } else if (Math.hypot((scene.players.get(S.you)?.x ?? 0) - m.x, (scene.players.get(S.you)?.y ?? 0) - m.y) < 700) sfx('kill');
});
function becomeGhost() {
  scene.ghost = true; scene.inVent = null; S.vanished = false; S.shifted = null; S.track = null; scene.tracks = []; scene.lightsOut = false;
  const me2 = scene.players.get(S.you); if (me2) { me2.dead = true; me2.disguise = null; me2.invisible = false; }
  rebuildActs();
}
net.on('vent', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.id), prev = p?.ventId;
  if (p) { p.vent = m.v ? 1 : 0; p.ventId = m.v || null; }
  if (m.a === 'in') scene.effect?.('ventIn', { id: m.id, vent: m.v, x: m.x, y: m.y });
  else if (m.a === 'out') scene.effect?.('ventOut', { id: m.id, vent: prev || m.v, x: m.x, y: m.y });
  else if (m.a === 'move') scene.effect?.('ventMove', { id: m.id, vent: m.v, x: m.x, y: m.y });
  if (m.id === S.you) {
    scene.inVent = m.v || null;
    if (isFinite(m.x)) scene.teleport(S.you, m.x, m.y);
    if (S.role === 'engineer') {
      if (m.a === 'in') { const mx = roleOpt('engineer', /time|dur/i, 15); S.ventOutAt = mx > 0 ? now() + mx * 1000 : 0; }
      if (m.a === 'out' && !(S.cd.vent > now())) setCd('vent', roleOpt('engineer', /cool/i, 30) * 1000);
    }
    if (hnsMode() && m.a === 'in' && S.hns && S.hns.vents > 0 && m.uses === undefined) S.hns.vents--;
    if (m.uses !== undefined && S.hns) S.hns.vents = m.uses;
  } else if (m.a !== 'move') {
    const meP = scene.players.get(S.you);
    if (meP && Math.hypot(meP.x - (m.x ?? 0), meP.y - (m.y ?? 0)) < 600) sfx('vent');
  }
});
net.on('visual', m => { if (S?.game) scene.visuals?.set(m.id, { ...(scene.visuals.get(m.id) || {}), [m.k === 'scan' || !m.k ? 'scan' : m.k]: m.on }); });
net.on('bodyGone', m => { if (S?.game) scene.bodies = scene.bodies.filter(b => b.id !== m.id); });

// ---------- 사보타주 / 문 ----------
function setSab(sab, fixed) {
  const was = S.sab;
  S.sab = sab ? { ...sab, parts: sab.parts || [] } : null;
  const d = sab && sabDef(sab.k);
  if (sab) { S.sabEnd = now() + (sab.left || 0); if (!was) { sfx('sab'); if (d?.type === 'critical') HUD.SND.alarm(); } }
  else if (was) { S.sabReady = Math.max(S.sabReady || 0, now() + 30000); S.sabCdMax = 30000; }
  scene.lightsOut = d?.type === 'lights' && !isImp() && alive();
  scene.mixup = d?.type === 'mixup';
  scene.sabTargets = d ? Object.entries(d.fix || {}).filter(([, p]) => d.together || !S.sab.parts.includes(p)).map(([id]) => id) : [];
  if (!sab && was && G.mg?.sab) { try { G.mg.close(); } catch {} }
  if (sab && was && G.mg?.sab && d && !d.together) { const part = Object.entries(d.fix || {}).find(([id]) => id === G.mg?.station)?.[1]; if (part && S.sab.parts.includes(part)) { /* 이미 고쳐진 부분 */ } }
  if (d?.type === 'comms' && S.track) scene.tracks = [];
  HUD.setSabUI(); HUD.renderTasks();
}
net.on('sab', m => { if (S?.game && G.hud) setSab(m.sab, m.fixed); });
net.on('doors', m => {
  if (!S?.game) return;
  const prev = scene.doorsClosed || new Set(), next = new Set(m.closed || []);
  const meP = scene.players.get(S.you);
  if ([...next].some(id => !prev.has(id))) {
    const near = [...next].some(id => { const d = G.map.doorById?.[id]; return d && meP && Math.hypot(d.x + d.w / 2 - meP.x, d.y + d.h / 2 - meP.y) < 900; });
    if (near) HUD.SND.door();
  }
  scene.doorsClosed = next;
  for (const [room, ms] of Object.entries(m.cd || {})) { S.doorCd[room] = now() + ms; S.doorCdMax[room] = Math.max(ms, S.doorCdMax[room] && S.doorCd[room] > now() ? S.doorCdMax[room] : 0, 1); }
  // 수동 문 패널을 열어 둔 사이 문이 열리면 닫기
  if (G.mg && G.mg.door && !next.has(G.mg.door)) { try { G.mg.close(); } catch {} }
});
net.on('transport', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.pid);
  const from = p ? { x: p.x, y: p.y } : m.from;
  scene.effect?.('transport', { id: m.pid, tid: m.id, from, to: m.to, ms: m.ms });
  if (m.pid === S.you) S.transportUntil = now() + (m.ms || 0);
  setTimeout(() => { if (S?.game && m.to) scene.teleport(m.pid, m.to.x, m.to.y); if (m.pid === S?.you) S.transportUntil = 0; }, m.ms || 0);
});
net.on('spawnPick', m => { if (!S?.game) return; if (S.phase === 'play') PN.spawnPicker(m.points); else S.pendingSpawn = m.points || true; });

// ---------- 역할 능력 결과 ----------
net.on('abilityCd', m => {
  if (!S?.game) return;
  if (m.a === 'kill') S.killAt = now() + m.ms;
  else if (m.a === 'sab' || m.a === 'sabotage') { S.sabReady = now() + m.ms; S.sabCdMax = Math.max(m.ms, 1); }
  else setCd(m.a, m.ms);
});
net.on('roleSet', m => {
  if (!S?.game) return;
  const was = S.role;
  S.role = roleKey(m.role);
  if (m.mates) S.mates = new Set(m.mates);
  scene.redNames = isImp() || hnsMode() ? new Set(S.mates) : new Set();
  if (S.role === 'scientist' && !S.batteryMax) { S.batteryMax = roleOpt('scientist', /batt|charge|dur/i, 5); S.battery = S.batteryMax; }
  applyVision();
  rebuildActs();
  if (was !== S.role) {
    const d = roleDef(S.role) || {};
    HUD.centerMsg(`<b style="color:${roleColor(S.role)}">${esc(roleName(S.role))}</b>${d.ghost ? '이(가) 되었습니다!' : ' 역할로 바뀌었습니다'}<br><small>${esc(d.desc || '')}</small>`, 3500, 'roleset');
    HUD.SND.unlock();
  }
});
net.on('shift', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.id);
  if (!p) return;
  p.disguise = m.as ? { look: { ...lookOf(m.as) }, name: nameOf(m.as) } : null;
  scene.effect?.('poof', { x: p.x, y: p.y, id: m.id, color: p.look?.color });
  HUD.SND.poof();
  if (m.id === S.you) {
    S.shifted = m.as || null;
    if (m.as) { const d = roleOpt('shapeshifter', /dur/i, 30); S.shiftUntil = d > 0 ? now() + d * 1000 : 0; }
    else { S.shiftUntil = 0; if (!(S.cd.shift > now())) setCd('shift', roleOpt('shapeshifter', /cool/i, 10) * 1000); }
  }
});
net.on('vanish', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.id);
  if (p) { p.invisible = !!m.on; scene.effect?.('poof', { x: p.x, y: p.y, id: m.id, color: p.look?.color, follow: !m.on }); }
  if (m.id === S.you) {
    S.vanished = !!m.on; HUD.SND.poof();
    if (m.on) { const d = roleOpt('phantom', /dur/i, 30); S.vanishUntil = d > 0 ? now() + d * 1000 : 0; }
    else { S.vanishUntil = 0; if (!(S.cd.vanish > now())) setCd('vanish', roleOpt('phantom', /cool/i, 15) * 1000); }
  }
});
net.on('shield', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.id);
  if (p) p.shield = !!m.on;
  if (m.on) HUD.SND.shield();
  if (m.on && S.role === 'guardian') { stat('protected'); if (!(S.cd.protect > now())) setCd('protect', roleOpt('guardian', /cool/i, 60) * 1000); }
});
net.on('shieldHit', m => {
  if (!S?.game) return;
  scene.effect?.('shieldHit', { id: m.id, by: m.by });
  const p = scene.players.get(m.id); if (p) p.shield = false;
  HUD.SND.shield();
  if (m.by === S.you) { HUD.centerMsg('보호막에 막혔습니다!', 1600, 'warn'); S.killAt = Math.max(S.killAt, now() + S.game.settings.killCooldown * 500); }
});
net.on('noise', m => {
  if (!S?.game) return;
  const until = now() + (m.ms || 10000);
  scene.noises = [...(scene.noises || []), { x: m.x, y: m.y, until, id: m.id }];
  S.alerts.push({ x: m.x, y: m.y, until });
  scene.effect?.('noise', { x: m.x, y: m.y, id: m.id });
  HUD.SND.squeak();
});
net.on('vitalsData', m => { if (S?.game) S.vitals = new Map(m.list || []); });
net.on('track', m => {
  if (!S?.game) return;
  if (m.id && m.ms > 0) {
    const col = COLORS[lookOf(m.id)?.color ?? 0]?.[1] || '#3cff6a';
    S.track = { id: m.id, until: now() + m.ms, color: col }; S.trackPos = null;
  } else {
    S.track = null; S.trackPos = null; scene.tracks = [];
    if (!(S.cd.track > now())) setCd('track', roleOpt('tracker', /cool/i, 15) * 1000);
  }
});
// 인플루언서 메시지 (받는 쪽)
const onInfluence = m => { if (S?.game && Array.isArray(m.imgs)) HUD.showInfluence(m.imgs.slice(0, 3), m.from ? lookOf(m.from) : null); };
net.on('influence', onInfluence);
net.on('message', onInfluence);
net.on('ability', m => {
  if (!S?.game) return;
  if (m.a === 'message' && m.imgs) onInfluence(m);
  if (m.a === 'interrogate' && m.id) net.emit('interrogate', m);
  if (m.ok === false && m.msg) toast(m.msg);
});

// ---------- 숨바꼭질 ----------
function setHns(m) {
  const t = now(), prev = S.hns;
  const phase = m.phase || prev?.phase || 'seek';
  const left = m.left ?? m.ms ?? 0;
  const H = S.hns = { ...(prev || {}), phase, end: t + left, total: !prev || prev.phase !== phase || !prev.total ? Math.max(left, m.total || 0) : Math.max(prev.total, left) };
  if (m.vents !== undefined || m.ventUses !== undefined) H.vents = m.vents ?? m.ventUses;
  else if (H.vents === undefined) H.vents = S.game.settings.hnsVentUses ?? S.game.settings.ventUses;
  if (m.seekMap !== undefined) H.seekMap = m.seekMap;
  if (Array.isArray(m.pings) && m.pings.length) { H.serverPings = true; HUD.addPings(m.pings.map(p => (Array.isArray(p) ? { x: p[p.length - 2], y: p[p.length - 1] } : p))); }
  S.hnsLocked = isSeeker() && phase === 'hide';
  if (prev && prev.phase !== phase) {
    if (phase === 'final') { HUD.centerMsg('마지막 숨기!', 2500, 'warn'); HUD.SND.alarm(); }
    if (phase === 'seek' && isSeeker()) HUD.centerMsg('찾으러 가세요!', 1800, 'warn');
  }
  applyVision();
}
net.on('hns', m => { if (S?.game) setHns(m); });

// ---------- 맵 변경 / 색 변경 / 빙의 ----------
net.on('mapChange', m => {
  if (!S) return;
  const id = mapIdOf(m.map);
  if (!S.game) { if (id) S.room.settings = { ...S.room.settings, map: id }; renderLobby(); return; }
  try { G.mg?.close(); } catch {}
  PN.closePanel();
  G.map = getMap(id);
  startScene(G.map);
  if (m.tasks) S.tasks = normTasks(m.tasks);
  if (m.bar) S.bar = m.bar;
  for (const [pid, x, y] of m.pos || []) scene.teleport(pid, x, y);
  scene.bodies = []; scene.doorsClosed = new Set(); scene.sabTargets = []; S.sab = null; S.doorCd = {};
  HUD.setSabUI(); HUD.renderTasks();
  HUD.centerMsg(`맵이 ${esc(G.map.ko || G.map.name)}(으)로 바뀌었습니다`, 2500);
});
net.on('look', m => {
  if (!S) return;
  const p = scene.players.get(m.id);
  if (p) p.look = m.look;
  const rp = P(m.id); if (rp) rp.look = m.look;
});
net.on('possess', m => {
  if (!S) return;
  if (m.target === S.you) { S.possessed = m.by || true; HUD.notice('누군가 내 몸을 조종하고 있습니다…', 3000); }
  else if (!m.target && S.possessed) S.possessed = null;
  if (m.by === S.you) { scene.viewId = scene.controlId = m.target || S.you; S.possessing = m.target || null; }
});

// ---------- 회의 ----------
let meet = null;
net.on('meeting', m => {
  if (!S?.game) return;
  closeAll();
  meet = null;
  S.phase = 'meeting'; scene.inVent = null; scene.bodies = []; scene.doorsClosed = new Set();
  for (const id of m.dead || []) { S.dead.add(id); const p = scene.players.get(id); if (p) p.dead = true; }
  for (const p of scene.players.values()) { p.disguise = null; p.invisible = false; p.vent = 0; }
  S.shifted = null; S.vanished = false; S.track = null; scene.tracks = []; scene.noises = []; S.alerts = [];
  if (m.bar) S.bar = m.bar;
  if (m.sab !== undefined) setSab(m.sab);
  S.emergLeft = m.meetings?.[S.you] ?? S.emergLeft;
  if (m.caller === S.you && m.body) stat('reports');
  // 탐정: 새로 죽은 사람마다 사건 파일
  for (const id of m.dead || []) {
    if (S.knownDead.has(id) || S.gone.has(id)) continue;
    S.knownDead.add(id);
    const d = S.deaths[id];
    S.cases.push({ id, name: nameOf(id), look: lookOf(id), room: d ? roomLabel(d.x, d.y) : '알 수 없음', suspects: [], killer: null, prep: null, note: '' });
    if (S.role === 'detective') S.activeCase = S.cases.length - 1;
  }
  const t = now();
  S.meeting = { caller: m.caller, body: m.body, voted: new Set(), stage: m.discuss > 0 ? 'discuss' : 'vote', end: t + m.intro + m.discuss, voteEnd: t + m.intro + m.discuss + m.vote, my: null, prot: m.protected || m.protectedRecently };
  sfx('alarm');
  const cl = lookOf(m.caller), bl = m.body ? lookOf(m.body) : null;
  const sp = overlay(`<div class="msplash ${m.body ? 'body' : 'emer'}"><div class="ms-bg"></div><div class="ms-art">${m.body
    ? `${HUD.crewImg(bl, { dead: true }, 300, 216)}<div class="ms-rep">${HUD.crewImg(cl, {}, 300, 216)}</div>`
    : `<div class="ms-mega">${HUD.icon('report')}</div>${HUD.crewImg(cl, {}, 320, 230)}`}</div><h1>${m.body ? '시체 발견됨' : '긴급회의'}</h1></div>`);
  setTimeout(() => { dropOverlay(sp); meetingUI(); }, m.intro);
});
function meetingUI() {
  if (!S?.meeting) return;
  const M = S.meeting, n = scene.players.size;
  meet = overlay(`<div class="meet2"><div class="tablet"><div class="mhead"><h2>누가 임포스터일까요?</h2>${M.prot ? '<div class="prot">최근에 누군가 보호받았습니다</div>' : ''}</div>
    <div class="plates2 ${n > 10 ? 'c3' : ''}"></div>
    <div class="mfoot"><div class="skiparea2"><button class="skip2">투표 건너뛰기</button><div class="svotes"></div></div><div class="mtime"></div>
      ${S.role === 'detective' ? `<button class="mbtn notesb">${HUD.icon('notes')}</button>` : ''}<button class="mbtn chatb2">${HUD.icon('chat')}<i class="badge hidden"></i></button></div></div><div class="judgefx"></div></div>`);
  $('.chatb2', meet).onclick = openChat;
  $('.notesb', meet)?.addEventListener('click', () => { sfx('click'); PN.openNotebook(); });
  $('.skip2', meet).onclick = () => { if (M.stage !== 'vote' || M.my || !alive()) return; sfx('click'); M.pick = M.pick === 'skip' ? null : 'skip'; drawPlates(); };
  drawPlates();
  const iv = setInterval(() => {
    if (!meet?.isConnected) return clearInterval(iv);
    const t = now(), el = $('.mtime', meet);
    if (M.stage === 'discuss' && t > M.end) { M.stage = 'vote'; drawPlates(); }
    el.textContent = M.stage === 'discuss' ? `투표 시작까지: ${Math.max(0, Math.ceil((M.end - t) / 1000))}초` : M.stage === 'vote' ? `투표 종료까지: ${Math.max(0, Math.ceil((M.voteEnd - t) / 1000))}초` : `진행까지: ${Math.max(0, Math.ceil(((M.doneAt || t) + 5000 - t) / 1000))}초`;
    const b = $('.chatb2 .badge', meet); b.textContent = S.unread; b.classList.toggle('hidden', !S.unread);
  }, 200);
}
const judgeReady = () => {
  if (S.role !== 'judge' || S.overruled || !alive() || commsOn()) return false;
  const need = roleOpt('judge', /task|pct|percent|unlock/i, 50), [d, n] = myTasksDone();
  return d >= Math.ceil((n * need) / 100);
};
function drawPlates(result) {
  const M = S.meeting, box = meet && $('.plates2', meet);
  if (!box || !M) return;
  const ps = [...scene.players.values()].sort((a, b) => (S.dead.has(a.id) - S.dead.has(b.id)));
  const chip = v => `<i class="chip" style="--d:${v.i * 0.25}s">${v[0] && !result.anon ? HUD.crewImg(lookOf(v[0]), {}, 44, 32) : HUD.crewImg({ color: 15 }, {}, 44, 32).replace('<svg', '<svg class="anon"')}</i>`;
  const canVote = M.stage === 'vote' && !M.my && alive();
  const jr = canVote && judgeReady();
  box.innerHTML = ps.map(p => {
    const dead = S.dead.has(p.id), votes = result ? result.votes.map((v, i) => Object.assign([...v], { i })).filter(v => v[1] === p.id) : [];
    const look = p.look || {}, plate = look.plate && look.plate !== 'none' ? `plate-${look.plate}` : '';
    return `<div class="pl2 ${dead ? 'dead' : ''} ${p.id === S.you ? 'me' : ''} ${M.pick === p.id ? 'pick' : ''} ${canVote && !dead ? 'can' : ''} ${plate}" data-id="${p.id}">
      <div class="av">${HUD.crewImg(look, dead ? { dead: true } : {}, 100, 72)}</div><div class="nm" style="${S.mates.has(p.id) && isImp() ? 'color:#e01b1b' : ''}">${esc(p.name)}${p.id === S.you ? ` <small style="color:${roleColor(S.role)}">${esc(roleName(S.role))}</small>` : ''}</div>
      ${M.caller === p.id ? `<span class="megaphone">${HUD.icon('report')}</span>` : ''}${M.voted.has(p.id) && !result ? '<span class="ivoted">투표함</span>' : ''}
      ${M.pick === p.id && !result ? `<div class="conf"><button class="yes">✓</button><button class="no">✕</button>${jr ? `<button class="gavel" title="기각">${HUD.icon('overrule')}</button>` : ''}</div>` : ''}
      ${dead ? '<i class="xmark"></i>' : ''}<div class="votes2">${votes.map(chip).join('')}</div></div>`;
  }).join('');
  const sk = $('.skip2', meet);
  sk.classList.toggle('on', M.pick === 'skip'); sk.disabled = !(canVote);
  $('.skiparea2 .conf')?.remove();
  if (M.pick === 'skip' && !result) { sk.insertAdjacentHTML('afterend', '<div class="conf"><button class="yes">✓</button><button class="no">✕</button></div>'); }
  $('.svotes', meet).innerHTML = result ? `<span class="slab">투표 건너뜀</span>${result.votes.map((v, i) => Object.assign([...v], { i })).filter(v => v[1] === 'skip').map(chip).join('')}` : '';
  $('.skiparea2 .yes', meet)?.addEventListener('click', e => { e.stopPropagation(); vote('skip'); });
  $('.skiparea2 .no', meet)?.addEventListener('click', e => { e.stopPropagation(); M.pick = null; drawPlates(); });
  $$('.pl2', box).forEach(pl => pl.onclick = e => {
    const id = pl.dataset.id;
    if (e.target.closest('.yes')) return vote(id);
    if (e.target.closest('.gavel')) return overrule(id);
    if (e.target.closest('.no')) { M.pick = null; return drawPlates(); }
    if (M.stage !== 'vote' || M.my || !alive() || S.dead.has(id)) return;
    sfx('click'); M.pick = M.pick === id ? null : id; drawPlates();
  });
}
function vote(id) {
  const M = S.meeting;
  if (!M || M.stage !== 'vote' || M.my || !alive()) return;
  M.my = id; M.pick = null; sfx('vote');
  net.send({ t: 'vote', id });
  drawPlates();
}
function overrule(id) {
  const M = S.meeting;
  if (!M || M.stage !== 'vote' || M.my || !judgeReady()) return;
  M.my = id; M.pick = null; S.overruled = true;
  HUD.SND.gavel();
  net.send({ t: 'ability', a: 'overrule', id });
  stat('overrules');
  drawPlates();
  HUD.renderTasks();
}
net.on('voting', () => { if (S?.meeting) { S.meeting.stage = 'vote'; drawPlates(); } });
net.on('voted', m => {
  if (!S?.meeting) return;
  S.meeting.voted.add(m.id); sfx('vote'); drawPlates();
  const left = [...scene.players.keys()].filter(id => !S.dead.has(id) && !S.meeting.voted.has(id)).length;
  S.chat.push({ sys: true, text: `${nameOf(m.id)} 님이 투표했습니다. ${left}명 남음.` });
});
net.on('result', m => {
  if (!S?.meeting) return;
  const M = S.meeting;
  M.stage = 'done'; M.doneAt = now();
  const judge = m.overrule || m.judge || m.verdict;
  const res = { votes: m.votes || [], anon: S.game.settings.anonVotes };
  if (judge) { judgeEffect(judge); setTimeout(() => S?.meeting && drawPlates(res), 1400); }
  else drawPlates(res);
});
// 판사 판결 연출: 망치가 내려치고 유리가 깨짐
function judgeEffect(j) {
  const fx = meet && $('.judgefx', meet);
  if (!fx) return;
  const jid = typeof j === 'object' ? j.by || j.judge : null;
  fx.innerHTML = `<div class="gv">${HUD.icon('overrule')}</div><svg class="glass" viewBox="0 0 1600 720" preserveAspectRatio="none">${crackLines()}</svg>
    <div class="jtxt">판사가 판결을 내렸습니다${jid ? `<small>${esc(nameOf(jid))}</small>` : ''}</div>`;
  fx.classList.add('on');
  setTimeout(() => HUD.SND.gavel(), 380);
}
function crackLines() {
  const cx = 800, cy = 330, out = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3; let x = cx, y = cy, d = '';
    d += `M${cx} ${cy}`;
    for (let k = 0; k < 5; k++) { const r = 70 + k * 150 + Math.random() * 60; x = cx + Math.cos(a + (Math.random() - 0.5) * 0.25) * r; y = cy + Math.sin(a + (Math.random() - 0.5) * 0.25) * r * 0.75; d += ` L${x.toFixed(0)} ${y.toFixed(0)}`; }
    out.push(`<path d="${d}"/>`);
  }
  for (let k = 1; k < 4; k++) { const r = k * 110; out.push(`<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.75}" stroke-dasharray="${30 + k * 10} ${40 + k * 20}"/>`); }
  return out.join('');
}
net.on('eject', m => {
  if (!S?.game) return;
  dropOverlay(meet); meet = null; S.meeting = null; S.phase = 'eject';
  $$('.chat2').forEach(e => e.remove());
  if (m.id) { S.dead.add(m.id); const p = scene.players.get(m.id); if (p) p.dead = true; if (m.id === S.you) { stat('ejected'); becomeGhost(); } }
  const name = m.name || nameOf(m.id), s = S.game.settings;
  const multi = (s.impostors || 1) > 1;
  const josa = w => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? '이었습니다' : '였습니다'; };
  let text;
  if (!m.id) text = `아무도 방출되지 않았습니다. (${m.tie ? '동점' : '건너뜀'})`;
  else if (m.role && m.imp !== null && m.imp !== undefined) { const rn = roleName(m.role); text = `${name} 님은 ${rn}${josa(rn)}.`; }
  else if (m.imp === null || m.imp === undefined) text = `${name} 님이 방출됐습니다.`;
  else text = m.imp ? `${name} 님은 ${multi ? '' : ''}임포스터였습니다.` : `${name} 님은 ${multi ? '' : ''}임포스터가 아니었습니다.`;
  const verdict = m.verdict || m.judge || m.overrule;
  const theme = G.map.theme?.outside || 'space';
  const look = m.look || (m.id ? lookOf(m.id) : null);
  const el = overlay(`<div class="eject2 th-${theme}"><div class="ebg"></div><div class="estars"></div>${look ? `<div class="who2">${HUD.crewImg(look, {}, 260, 187)}</div>` : ''}
    <div class="etxt">${verdict ? '<div class="verdict">판결이 내려졌습니다...</div>' : ''}<div class="txt"></div><div class="sub"></div></div></div>`);
  let i = 0;
  const start = verdict ? 1800 : 600;
  setTimeout(() => { const iv = setInterval(() => { const tx = $('.txt', el); if (!tx) return clearInterval(iv); tx.textContent = text.slice(0, ++i); if (i % 2) sfx('step'); if (i >= text.length) clearInterval(iv); }, 70); }, start);
  setTimeout(() => { const sb = $('.sub', el); if (sb && m.impLeft !== null && m.impLeft !== undefined) sb.textContent = `임포스터 ${m.impLeft}명 남음`; }, start + text.length * 70 + 500);
  setTimeout(() => el.classList.add('out'), 6500);
  setTimeout(() => dropOverlay(el), 7000);
  HUD.renderTasks();
});
net.on('resume', m => {
  if (!S?.game) return;
  for (const [id, x, y] of m.pos || []) scene.teleport(id, x, y);
  S.killAt = now() + (m.kill ?? S.game.settings.killCooldown * 1000);
  S.emergAt = now() + (m.emerg ?? 0);
  S.phase = 'play'; S.meeting = null;
  scene.doorsClosed = new Set();
  if (m.sab !== undefined) setSab(m.sab);
  if (S.role === 'detective' && !(S.cd.interrogate > now())) setCd('interrogate', 10000);
  for (const [a, ms] of Object.entries(m.roleCds || {})) a === 'kill' ? (S.killAt = now() + ms) : setCd(a, ms);
  if (m.spawnPick) PN.spawnPicker(Array.isArray(m.spawnPick) ? m.spawnPick : m.spawnPick.points);
  else if (S.pendingSpawn) { PN.spawnPicker(S.pendingSpawn); S.pendingSpawn = null; }
  HUD.renderTasks();
});

// ---------- 게임 종료 ----------
net.on('over', m => {
  if (!S?.game) return;
  closeAll(); meet = null; S.meeting = null; S.phase = 'over';
  const roles = new Map(m.roles || []);
  const myRole = roles.get(S.you) || S.role, myTeam = isImpRole(myRole) ? 'impostor' : 'crew', win = m.winner === myTeam;
  if (!S.game.practice) {
    stat('finished'); if (win) stat(myTeam === 'impostor' ? 'impWins' : 'crewWins');
    addXp(win ? 60 : 35); profile.beans += win ? 30 : 15; saveProfile();
  }
  sfx(win ? 'win' : 'lose');
  const team = (m.players || []).filter(p => (isImpRole(roles.get(p.id)) ? 'impostor' : 'crew') === m.winner);
  const meFirst = [...team.filter(p => p.id === S.you), ...team.filter(p => p.id !== S.you)];
  const col = m.winner === 'impostor' ? '#FF1919' : '#8CFFFF';
  S.pendingLobby = true;
  const el = overlay(`<div class="endscr2 ${win ? 'win' : 'lose'}" style="--tc:${col}"><h1>${win ? '승리' : '패배'}</h1><p class="why">${m.winner === 'impostor' ? '임포스터 승리' : '크루원 승리'} — ${esc(m.reason || '')}</p>
    <div class="glow"></div><div class="team">${meFirst.map((p, i) => { const k = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2); return `<div class="tc" style="--k:${k};--a:${Math.abs(k)}">${HUD.crewImg(p.look, {}, 240, 173)}<b>${esc(p.name)}</b><small style="color:${roleColor(roles.get(p.id))}">${esc(roleName(roles.get(p.id)))}</small></div>`; }).join('')}</div>
    <p class="rew">${S.game.practice ? '' : `+${win ? 60 : 35} 경험치 · 콩 +${win ? 30 : 15}`}</p>
    <div class="row-c"><button class="obtn again">다시 하기</button><button class="obtn quit">나가기</button></div></div>`);
  const back = () => { if (!el.isConnected) return; dropOverlay(el); S.pendingLobby = false; lobbyView(); };
  $('.again', el).onclick = back;
  $('.quit', el).onclick = leave;
  setTimeout(back, 10000);
});

// ---------- 채팅 ----------
net.on('chat', m => {
  if (!S) return;
  S.chat.push(m);
  if (S.chat.length > 120) S.chat.shift();
  const box = $('.chat2 .msgs');
  if (box) { box.append(chatLine(m)); box.scrollTop = 1e9; } else if (!m.sys) S.unread++;
});
function chatLine(m) {
  if (m.sys) return h(`<div class="m sys">${esc(m.text)}</div>`);
  const ghost = m.ghost || (S.game && S.dead.has(m.id));
  return h(`<div class="m ${m.id === S.you ? 'mine' : ''} ${ghost ? 'ghost' : ''}">${crewSVG(m.look, { noPet: true, ghost })}<div class="bub"><b style="${S.game && isImp() && S.mates.has(m.id) ? 'color:#e01b1b' : ''}">${esc(m.name)}${m.quick ? ' <i class="q">빠른 채팅</i>' : ''}</b>${esc(censor(m.text))}</div></div>`);
}
function openChat() {
  sfx('click');
  if ($('.chat2')) return $('.chat2').remove();
  S.unread = 0;
  const free = canFree();
  const el = h(`<div class="chat2"><button class="xbtn">✕</button><div class="chead">${S.game && !alive() ? '유령 채팅 — 살아있는 플레이어에게는 보이지 않습니다' : S.meeting ? '회의 채팅' : '로비 채팅'}</div><div class="msgs"></div><div class="bar">
    ${free ? '<input maxlength="100" placeholder="여기에 입력하세요">' : `<span class="nofree">${me.status === 'green' ? '이 로비는 빠른 채팅 전용입니다.' : me.status === 'teal' ? '만 14세 미만 계정은 빠른 채팅만 사용할 수 있어요.' : '게스트 계정은 빠른 채팅만 사용할 수 있어요.'}</span>`}
    <button class="qbtn">빠른 채팅</button>${free ? '<button class="send">보내기</button>' : ''}</div></div>`);
  stage().append(el);
  const box = $('.msgs', el);
  S.chat.forEach(m => box.append(chatLine(m)));
  box.scrollTop = 1e9;
  $('.xbtn', el).onclick = () => el.remove();
  const inp = $('input', el);
  const send = () => { const v = inp.value.trim(); if (v) net.send({ t: 'chat', text: v }); inp.value = ''; };
  if (inp) { $('.send', el).onclick = send; inp.onkeydown = e => { if (e.key === 'Enter') send(); e.stopPropagation(); }; setTimeout(() => inp.focus(), 30); }
  $('.qbtn', el).onclick = () => quickChat(el);
}
function quickChat(el) {
  $('.qc2', el)?.remove();
  let cat = 0;
  const q = h('<div class="qc2"></div>');
  el.append(q);
  const names = [...scene.players.values()].map(p => p.name);
  const rooms = (S.game ? G.map : getMap(S.room.settings.map)).roomNames || [];
  const draw = () => {
    q.innerHTML = `<div class="cats">${QUICK.map((c, i) => `<button data-c="${i}" class="${i === cat ? 'on' : ''}">${c[0]}</button>`).join('')}</div>
      <div class="sels"><label>플레이어 <select class="sp">${names.map(n => `<option>${esc(n)}</option>`).join('')}</select></label><label>장소 <select class="sr">${rooms.map((r, i) => `<option value="${i}">${esc(r)}</option>`).join('')}</select></label></div>
      <div class="ph">${QUICK[cat][1].map((p, i) => `<button data-i="${i}">${esc(p).replace('{p}', '<b>○○</b>').replace('{r}', '<b>□□</b>')}</button>`).join('')}</div>`;
    $$('[data-c]', q).forEach(b => b.onclick = () => { cat = +b.dataset.c; draw(); });
    $$('[data-i]', q).forEach(b => b.onclick = () => { net.send({ t: 'chat', q: { c: cat, i: +b.dataset.i, p: $('.sp', q).value, r: +$('.sr', q).value } }); q.remove(); });
  };
  draw();
}

// ---------- 다른 플레이어 위치 ----------
net.on('pos', m => {
  if (!S) return;
  const ctl = scene.controlId ?? S.you;
  for (const [id, x, y, d, mv, f = 0] of m.p) {
    const p = scene.players.get(id);
    if (!p) continue;
    if (S.game) { p.vent = f & 1 ? 1 : 0; if (!S.meeting) p.invisible = !!(f & 2); p.moving = !!(f & 8); }
    if (id === S.you && !S.possessed) continue;
    if (id === ctl && id !== S.you) continue;
    if (id === S.you && S.possessed) { p.x = p.tx = x; p.y = p.ty = y; p.dir = d; p.mv = mv; continue; }
    p.tx = x; p.ty = y; p.dir = d; p.mv = mv;
    if (Math.hypot(p.x - x, p.y - y) > 600) { p.x = x; p.y = y; }
    if (S.game && G.map.doorlog) doorlogTrack(p, x, y);
  }
});
// 문 기록: 센서(맵에 정의되어 있으면) 또는 방 이동을 기록
function doorlogTrack(p, x, y) {
  if (S.dead.has(p.id) || commsOn()) return;
  const m = G.map, t = now();
  let sensor = null;
  if (Array.isArray(m.sensors)) {
    for (const s of m.sensors) if (Math.hypot(s.x - x, s.y - y) < (s.r || 120)) { sensor = s.name; break; }
  } else {
    const r = m.roomAt?.(x, y);
    if (r && S.lastRoom[p.id] !== r.id) { if (S.lastRoom[p.id]) sensor = r.name; S.lastRoom[p.id] = r.id; }
  }
  if (!sensor) return;
  const key = `${p.id}:${sensor}`;
  S.dlT ||= {};
  if (S.dlT[key] && t - S.dlT[key] < 5000) return;
  S.dlT[key] = t;
  S.doorlog.push({ color: p.look?.color ?? 0, sensor, t });
  if (S.doorlog.length > 60) S.doorlog.shift();
}

net.on('err', m => toast(m.msg));
net.on('toast', m => toast(m.msg));

// ---------- mod 메뉴용 API ----------
export const modApi = {
  state: () => ({
    inRoom: !!S, inGame: !!S?.game, you: S?.you ?? null, role: S?.game ? S.role : null,
    players: (S?.game ? [...scene.players.values()] : S?.room.players || []).map(p => ({ id: p.id, name: p.name, look: p.look, ...(S?.game && (p.id === S.you ? { role: S.role } : S.mates.has(p.id) && isImp() ? { role: 'impostor' } : {})), dead: !!S?.dead.has(p.id) })),
    settings: S?.game?.settings || S?.room?.settings || null, map: S?.game ? G.map.id : S?.room?.settings?.map || null,
  }),
  setNoclip(on) { scene.noclip = !!on; },
  setSpeed(mul) { const v = Number(mul); scene.speedMul = isFinite(v) && v > 0 ? v : 1; },
  possess(id) {
    if (!S) return;
    net.send({ t: 'mod', a: 'possess', id: id || null });
    scene.viewId = scene.controlId = id || S.you; S.possessing = id || null;
  },
};
