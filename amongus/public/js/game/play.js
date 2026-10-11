// 로비/게임 진행: 상태·네트워크 처리, 로비, 회의/투표/추방, 종료 화면, 채팅, mod API
import { $, $$, h, esc, stage, toast, sfx, music, net, me, profile, saveProfile, settings, addXp, censor } from '../core.js';
import { QUICK, COLORS, CHAT_LANGS, RULES } from '../shared/data.js';
import { ROLE_DEFS, ROLE_ORDER, roleOpt as rOpt } from '../shared/roles.js';
import { getMap, LOBBY, stepGame, stepLabel, taskById } from '../shared/maps/index.js';
import { scene } from './scene.js';
import { crewSVG, mapIcon } from '../ui/crew.js';
import { app, go, screens } from '../ui/nav.js';
import * as HUD from './hud.js';
import * as PN from './panels.js';

export const KILL_D = RULES.killDist;
export const now = () => performance.now();
// 공유 상태 (hud.js / panels.js 가 함께 씀)
export const G = { S: null, hud: null, mg: null, panel: null, overlays: [], map: LOBBY, dt: 0.05, closePanel: () => PN.closePanel() };
let S = null, tick = 0, lastTick = 0;

// 미니게임/게임 설정 모듈은 늦게 불러와서, 하나가 깨져도 게임 화면은 뜨게 한다
let openGame = null;
const loadTasks = () => import('./tasks.js').then(m => (openGame = m.openGame)).catch(e => console.warn('tasks.js 불러오기 실패', e));
loadTasks();
let gsMod = null;
const loadGS = () => (gsMod ? Promise.resolve(gsMod) : import('../ui/gamesettings.js').then(m => (gsMod = m)).catch(() => null));

// ---------- 역할 ----------
export const roleKey = r => (!r || r === 'crew' ? 'crewmate' : r === 'guardianAngel' || r === 'angel' ? 'guardian' : r);
export const roleDef = r => ROLE_DEFS[roleKey(r)] || null;
export const isImpRole = r => (roleDef(r)?.team || (roleKey(r) === 'impostor' ? 'impostor' : 'crew')) === 'impostor';
export const roleName = r => roleDef(r)?.name || String(r || '');
// 원작: 크루원 팀은 하늘색, 임포스터 팀은 빨강
export const roleColor = r => (isImpRole(r) ? '#FF1919' : '#8CFFFF');
export const roleAccent = r => roleDef(r)?.accent || roleColor(r);
export const R = { order: () => ROLE_ORDER.filter(r => ROLE_DEFS[r]) };
export const curSettings = () => S?.game?.settings || S?.room?.settings || {};
export const roleOpt = (role, key) => +rOpt(curSettings(), roleKey(role), key) || 0;
// 키 이름 대신 정규식으로 역할 옵션 찾기 (옵션 키가 바뀌어도 동작)
export function optBy(role, re, def = 0) {
  const d = roleDef(role)?.opts?.find(o => re.test(o[0]));
  return d ? roleOpt(role, d[0]) : def;
}
// 능력의 쿨다운/지속 시간(ms)
export const abCd = (role, ab = roleDef(role)?.ability) => (ab?.cdKey ? roleOpt(role, ab.cdKey) * 1000 : 0);
export const abDur = (role, ab = roleDef(role)?.ability) => (ab?.durKey ? roleOpt(role, ab.durKey) * 1000 : 0);
// 받침에 따라 조사 고르기
export const josa = (w, a, b) => { const s = String(w || ''), c = s.charCodeAt(s.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? a : b; };

// ---------- 상태 도우미 ----------
const P = id => S?.room.players.find(p => p.id === id);
export const nameOf = id => scene.players.get(id)?.name || P(id)?.name || '?';
export const lookOf = id => scene.players.get(id)?.look || P(id)?.look || { color: 0 };
export const isImp = () => !!S && (S.team ? S.team === 'impostor' : isImpRole(S.role));
export const alive = () => !!S?.game && !S.dead.has(S.you);
export const hnsMode = () => !!S?.game?.hns;
export const isSeeker = () => hnsMode() && isImp();
export const sabDef = k => G.map?.sabotages?.[k] || null;
export const sabType = () => S?.sab?.type || sabDef(S?.sab?.k)?.type || null;
export const commsOn = () => sabType() === 'comms';
export const stat = (k, n = 1) => { if (S?.game?.practice || !profile) return; profile.stats ||= {}; profile.stats[k] = (profile.stats[k] || 0) + n; saveProfile(); };
export const myTasksDone = () => { const t = S?.tasks || []; return [t.filter(x => x.step >= x.st.length).length, t.length]; };
// 쿨다운: 남은 ms 를 들고 있다가 서버처럼 play 단계에서만 줄인다 (처치는 환풍구·이동 중 멈춤)
export const cdLeft = a => Math.max(0, S?.cdl?.[a] || 0);
export function fullCd(a) {
  const s = curSettings();
  if (a === 'kill') return hnsMode() ? RULES.hnsKillCd * 1000 : (+s.killCooldown || 20) * 1000;
  if (a === 'interrogate') return RULES.detectiveMeetingCd * 1000;
  if (a === 'vent' && hnsMode()) return 1000;
  const mine = roleDef(S?.role)?.ability;
  if (mine?.id === a && mine.cdKey) return abCd(S.role, mine);
  for (const r of ROLE_ORDER) { const ab = ROLE_DEFS[r]?.ability; if (ab?.id === a && ab.cdKey) return abCd(r, ab); }
  return 1;
}
export function setCd(a, ms, max) {
  if (!S) return;
  S.cdl[a] = Math.max(0, +ms || 0);
  S.cdMax[a] = Math.max(1, max ?? fullCd(a), S.cdl[a]);
}
// 위치 → 방 이름 (복도면 "가까운 방 근처")
export function roomLabel(x, y, map = G.map) {
  const r = map.roomAt?.(x, y);
  if (r) return r.name;
  let best = null, bd = 1e12;
  for (const q of map.rooms || []) { const d = Math.hypot(q.label.x - x, q.label.y - y); if (d < bd) { bd = d; best = q; } }
  return best ? `${best.name} 근처` : '통로';
}
const mapIdOf = v => (typeof v === 'string' ? v : v?.id) || null;
const normTasks = list => (list || []).map(t => ({ ...t, st: t.st || t.stations || [], step: t.step || 0 }));
const canFree = () => me.status === 'green' && S.room.settings.chatType !== 'quick';

// ---------- 방 입장/퇴장 ----------
net.on('joined', m => {
  restarting = 0;
  closeAll();
  S = G.S = { room: m.room, you: m.you, min: m.min, game: null, chat: [], unread: 0, dead: new Set(), gone: new Set(), mates: new Set(), tasks: [], cdl: {}, cdMax: {}, role: 'crewmate', team: 'crew', phase: 'lobby' };
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
let restarting = 0;
function leaveRoom(msg) {
  if (!S) return;
  clearInterval(tick);
  closeAll();
  S = G.S = null; app.inRoom = false;
  if (restarting > now()) { G.hud = null; stage().replaceChildren(); return; } // 연습 모드 다시 시작: 메뉴로 가지 않음
  scene.stop?.();
  scene._started = false;
  Object.assign(scene, { noclip: false, speedMul: 1, frozen: false });
  stage().classList.remove('ingame');
  go('menu', 'play');
  if (msg) toast(msg, 3500);
}
// 연습 모드: 고른 역할·맵으로 다시 시작
export function restartPractice(role, map) {
  restarting = now() + 3000;
  net.send({ t: 'leave' });
  setTimeout(() => net.send({ t: 'create', mode: 'practice', role, map, settings: { map } }), 150);
  setTimeout(() => { if (!S && restarting && now() > restarting - 100) { restarting = 0; scene.stop?.(); scene._started = false; stage().classList.remove('ingame'); go('menu', 'play'); } }, 3100);
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
  $$('.modal-back,.chat2,.mapov2,.mg-back').forEach(e => e.remove());
}
export const overlay = HUD.overlay, dropOverlay = HUD.dropOverlay;

// ---------- 공통 HUD 뼈대 ----------
function baseHud(inner, cls = '') {
  const hud = G.hud = h(`<div class="hud v2 ${cls}">${inner}
    <div class="joy ${showJoy() ? '' : 'hidden'}" style="transform:scale(${settings.joySize || 1});transform-origin:left bottom"><i></i></div>
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
addEventListener('settings', () => { const j = G.hud && $('.joy', G.hud); if (j) { j.classList.toggle('hidden', !showJoy()); j.style.transform = `scale(${settings.joySize || 1})`; } });
const hb = (cls, ic, title) => `<button class="hb2 ${cls}" title="${title}">${HUD.icon(ic)}<i class="badge hidden"></i></button>`;
function startScene(map) {
  if (scene._started && scene.setMap) { if (scene.map !== map) scene.setMap(map); }
  else scene.start(map);
  scene._started = true;
}

// ---------- 로비 ----------
function lobbyView() {
  S.game = null; S.phase = 'lobby'; S.dead = new Set(); S.gone = new Set(); S.sab = null; S.meeting = null; S.possessed = null; S.possessing = null;
  G.map = LOBBY;
  startScene(LOBBY);
  Object.assign(scene, { ghost: false, vision: 1, lightsOut: false, inVent: null, frozen: false, speed: S.room.settings.playerSpeed || 1, sabTargets: [], taskStations: new Set(),
    redNames: new Set(), bodies: [], tracks: [], noises: [], mixup: false, doorsClosed: new Set(), hl: null, killId: null, reportId: null, abilityId: null, viewId: S.you, controlId: S.you,
    flashlight: null, hideNames: false });
  scene.players.clear(); scene.visuals?.clear();
  for (const p of S.room.players) scene.setPlayer({ ...p, dead: false, vent: 0, disguise: null, invisible: false, shield: false, moving: false });
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
    <div class="mapban">${mapIcon(mp.id)}<span>${esc(mp.name || s.map)}</span></div>
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
  $('.host', hud).innerHTML = `${crewSVG(host?.look || {}, { noPet: true }).replace('<svg', '<svg style="width:44px;height:34px;vertical-align:middle"')} <span style="color:${COLORS[host?.look?.color ?? 0][1]}">${esc(host?.name)}</span>${mine ? ' (나)' : ''} 님의 로비`;
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
  if (S.game) {
    for (const p of m.room.players) { const sp = scene.players.get(p.id); if (sp && p.look) sp.look = p.look; }
    if (JSON.stringify(old.settings) !== JSON.stringify(m.room.settings)) onGameSettings({ ...S.game.settings, ...m.room.settings });
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
  for (const l of m.lines || []) {
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
  HUD.notice(`${m.name || nameOf(m.id)} 님이 게임에서 나갔습니다.`);
  if (S.meeting) drawPlates();
});

// 로비 게임 설정 창 (gamesettings.js, 없으면 간단한 대체 창)
let gs = null;
async function editSettings(editable) {
  const ed = editable && S.room.host === S.you && !S.game;
  const onChange = patch => net.send({ t: 'settings', s: patch });
  const mod = await loadGS();
  if (!S) return;
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
  const intro = Math.max(800, m.intro ?? (m.practice ? 2500 : RULES.introMs));
  S.game = { settings: s, practice: !!m.practice, hns: !!m.hns || (s.gameType === 'hns' && !m.practice) };
  const role = roleKey(m.role);
  Object.assign(S, {
    role, team: m.team || (isImpRole(role) ? 'impostor' : 'crew'), mates: new Set(m.mates || []), tasks: normTasks(m.tasks), bar: m.bar || { done: 0, total: 0 },
    dead: new Set(), gone: new Set(), sab: null, sabEnd: 0, sabCd: RULES.sabStartCd * 1000, sabCdMax: RULES.sabStartCd * 1000, doorCd: {}, doorCdMax: {},
    cdl: {}, cdMax: {}, emergLeft: m.meetings ?? s.emergencyMeetings, emergAt: now() + (m.emerg ?? intro + (+s.emergencyCooldown || 0) * 1000),
    chat: [], unread: 0, meeting: null, phase: 'intro', track: null, alerts: [], shifted: null, shiftUntil: 0, vanished: false, vanishUntil: 0,
    cases: [], activeCase: null, caseLimit: optBy('detective', /suspect/i, 3), judge: null, vitals: null, vitalsComms: false, doorlog: null, doorlogComms: false,
    hns: null, hnsCfg: typeof m.hns === 'object' ? m.hns : null, possessed: null, possessing: null, transportUntil: 0, ventOutAt: 0,
    battery: 0, batteryMax: 0, picking: false, pendingSpawn: null, spawnSeen: false, wheel: null, lastBar: m.bar || null,
  });
  if (m.sabCd !== undefined) S.sabCd = S.sabCdMax = Math.max(0, m.sabCd);
  if (S.team === 'impostor') setCd('kill', m.kill ?? RULES.killStart * 1000);
  for (const [a, ms] of Object.entries(m.roleCds || {})) setCd(a, ms);
  initRoleLocal();
  if (S.game.hns) setHns({ phase: 'hide', left: (S.hnsCfg?.hideTime ?? (+s.hideTime || 200) * 1000), lead: (S.hnsCfg?.lead ?? RULES.hnsLead * 1000) + intro, vents: S.hnsCfg?.ventUses ?? s.ventUses, seeker: S.hnsCfg?.seeker });
  startScene(G.map);
  scene.players.clear(); scene.visuals?.clear();
  for (const p of m.players || []) scene.setPlayer({ ...p, dead: false, vent: 0, ventId: null, disguise: null, invisible: false, shield: false, moving: false });
  Object.assign(scene, { ghost: false, inVent: null, lightsOut: false, sabTargets: [], bodies: [], tracks: [], noises: [], mixup: false, doorsClosed: new Set(m.doors?.closed || []),
    redNames: S.team === 'impostor' || S.game.hns ? new Set(S.mates) : new Set(), viewId: S.you, controlId: S.you, hl: null, killId: null, reportId: null, abilityId: null, taskStations: new Set() });
  if (m.doors?.cd) for (const [room, ms] of Object.entries(m.doors.cd)) { S.doorCd[room] = now() + ms; S.doorCdMax[room] = RULES.doorCd * 1000; }
  applyVision();
  stat('started'); stat(isImp() ? 'impGames' : 'crewGames');
  gameHud();
  if (m.alive === false) { S.dead.add(S.you); becomeGhost(true); }
  HUD.renderTasks();
  HUD.roleIntro(m.players || [], intro, () => {
    if (!S?.game || S.phase !== 'intro') return;
    S.phase = 'play';
    if (S.pendingSpawn) { PN.spawnPicker(S.pendingSpawn.points, S.pendingSpawn.ms); S.pendingSpawn = null; }
  });
  // 서버가 시작 위치 고르기를 따로 알려 주지 않으면 직접 연다 (대비용)
  const pts = m.spawnPick || m.spawnPoints;
  if (pts?.length) setTimeout(() => { if (S?.game && !S.spawnSeen && S.phase === 'play') PN.spawnPicker(pts, RULES.spawnPickMs); }, intro + 2500);
});
// 역할별 지역 상태 (배터리 등)
function initRoleLocal() {
  if (S.role === 'scientist') {
    const ab = roleDef('scientist')?.ability;
    S.batteryMax = abDur('scientist', ab) || 5000;
    if (!S.battery || S.battery > S.batteryMax) S.battery = S.batteryMax;
  }
  if (S.role === 'detective') S.caseLimit = optBy('detective', /suspect/i, S.caseLimit || 3);
}
function applyVision() {
  if (!S?.game) return;
  const s = S.game.settings, hns = hnsMode(), imp = isImp();
  scene.vision = hns ? +((imp ? s.hnsImpVision : s.hnsCrewVision) ?? 0.6) : +((imp ? s.impVision : s.crewVision) ?? 1);
  scene.flashlight = hns && +s.flashlight ? { on: true, size: +(imp ? s.impLight : s.crewLight) || 0.3 } : null;
  scene.hideNames = hns && s.showNames !== undefined && !+s.showNames;
  let sp = +s.playerSpeed || 1;
  if (hns && imp) sp *= S.hns?.speed || RULES.hnsSeekerSpeed * (S.hns?.phase === 'final' ? +s.finalSpeed || 1.2 : 1);
  scene.speed = sp;
}
function onGameSettings(s) {
  if (!S?.game) return;
  S.game.settings = s;
  applyVision();
  rebuildActs();
}
net.on('settings', m => { if (S?.game && m.settings) onGameSettings({ ...S.game.settings, ...m.settings }); });
function gameHud() {
  const practice = S.game.practice;
  baseHud(`<div class="taskbar"><i></i><b>총 임무 완료</b></div>
    <div class="tasklist2 open"><button class="tltab">임무</button><div class="tl"></div></div>
    <div class="hbtns2">${hb('chatb hidden', 'chat', '채팅')}${hb('guideb', 'guide', '매치 정보')}${hb('setb', 'gear', '설정')}${hb('mapb', 'map', '지도')}</div>
    <div class="critov"></div><div class="critbox hidden"><span class="nm"></span><b class="sec"></b></div>
    <div class="hnsbar hidden"><span class="lab"></span><div class="track"><i class="fill"></i></div><b class="tm"></b><em class="cut"></em></div>
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
export function rebuildActs() {
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
  if (after > before && n) {
    stat('tasks');
    if (after === n) stat('allTasks');
    HUD.centerMsg(after === n && !isImp() ? '모든 임무 완료!' : '임무를 완료했습니다!', 1500, 'taskdone');
  }
  HUD.renderTasks();
});
net.on('bar', m => { if (S?.game && m.bar) { S.bar = m.bar; HUD.renderTasks(); } });

// ---------- 매 프레임 (20Hz) ----------
function syncFrozen() {
  const t = now();
  const f = !!G.mg || !!G.panel?.freeze || (!!S.game && (S.phase !== 'play' || S.picking || !!S.possessed || !!S.hnsLocked || S.transportUntil > t));
  if (scene.frozen !== f) scene.frozen = f;
}
function tickCds(dtms) {
  if (!S.game || S.phase !== 'play' || S.picking) return;
  const stopKill = !!scene.inVent || S.transportUntil > now();
  for (const k in S.cdl) { if (k === 'kill' && stopKill) continue; if (S.cdl[k] > 0) S.cdl[k] = Math.max(0, S.cdl[k] - dtms); }
  if (!S.sab && S.sabCd > 0) S.sabCd = Math.max(0, S.sabCd - dtms);
}
function frame() {
  if (!S || !G.hud) return;
  const t = now();
  G.dt = Math.min(0.25, (t - lastTick) / 1000); lastTick = t;
  const pg = $('.ping', G.hud);
  if (pg) pg.textContent = `PING: ${net.ping} ms`;
  tickCds(G.dt * 1000);
  syncFrozen();
  const meP = scene.players.get(S.you);
  if (!meP) return;
  if (!S.game) {
    let n = null, bd = RULES.useDist;
    for (const [id, s] of Object.entries(LOBBY.stations || {})) { const d = Math.hypot(s.x - meP.x, s.y - meP.y); if (d < bd) { bd = d; n = { id, ...s }; } }
    scene.hl = n?.id || null; S.use = n ? { kind: 'custom', id: n.id } : null;
    $('[data-act=use]', G.hud)?.classList.toggle('ok', !!S.use);
    const badge = $('.chatb .badge', G.hud);
    if (badge) { badge.textContent = S.unread; badge.classList.toggle('hidden', !S.unread); }
    return;
  }
  reconcile(t);
  HUD.updateHud();
  if (S.track) {
    if (S.track.until < t) { S.track = null; scene.tracks = []; }
    else scene.tracks = S.track.comms || commsOn() || !isFinite(S.track.x) ? [] : [{ id: S.track.id, color: S.track.color, x: S.track.x, y: S.track.y }];
  }
  if (scene.noises?.length) scene.noises = scene.noises.filter(n => n.until > t);
  HUD.drawArrows();
}

// 서버가 받아들이지 않은 이동(벽·닫힌 문·속도 제한)으로 서버 위치와 오래 어긋나면 서버 위치로 맞춤
function reconcile(t) {
  const sp = S.srvPos, me = scene.players.get(S.you);
  if (!sp || !me || S.possessed || scene.inVent || S.transportUntil > t || S.phase !== 'play' || S.picking || (scene.controlId && scene.controlId !== S.you) || t - sp.t > 1000) { S.desyncAt = 0; return; }
  const d = Math.hypot(me.x - sp.x, me.y - sp.y), lim = 320 * Math.max(1, scene.speedMul || 1);
  if (d < lim) { S.desyncAt = 0; return; }
  if (!S.desyncAt) S.desyncAt = t;
  else if (t - S.desyncAt > 1500) { scene.teleport(S.you, sp.x, sp.y); S.desyncAt = 0; }
}

// ---------- 행동 ----------
export function act(a) {
  if (!S) return;
  if (!S.game) {
    if (a === 'use' && S.use) { sfx('click'); const taken = () => new Set(S.room.players.filter(p => p.id !== S.you).map(p => p.look.color)); screens.customize?.(taken, S.use.id === 'box' ? 'hat' : 'color'); }
    return;
  }
  if (a === 'map') { sfx('click'); if (G.panel && G.panel.kind !== 'map') return; return PN.openMap(); }
  if (a === 'sabotage') { if (!isImp() || hnsMode()) return; sfx('click'); if (G.panel?.kind === 'map') return PN.closePanel(); return PN.openMap(true); }
  if (a === 'ab:notes') { sfx('click'); return PN.openNotebook(); }
  if (S.phase !== 'play' || G.mg || S.picking || (G.panel && G.panel.kind !== 'map')) return;
  const t = now();
  if (a === 'use') {
    if (!S.use) { if (isImp() && !hnsMode()) act('sabotage'); return; }
    if (G.panel?.kind === 'map') PN.closePanel();
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
    else if (u.kind === 'transport') { net.send({ t: 'transport', id: u.id }); S.transportUntil = t + 700; }
    return;
  }
  if (G.panel?.kind === 'map') PN.closePanel();
  if (a === 'report' && S.report) { sfx('click'); net.send({ t: 'report', id: S.report.id }); return; }
  if (a === 'kill' && S.kill) {
    net.send({ t: 'kill', id: S.kill.id });
    S.cdl.kill = Math.max(S.cdl.kill || 0, 600); // 서버 응답 전 중복 방지
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
  if (!btn) return;
  if (id === 'overrule') { sfx('click'); return HUD.centerMsg(S.judge?.used ? '기각은 이미 사용했습니다' : S.judge?.locked !== false ? '임무를 더 완료하면 기각이 열립니다' : '회의에서 투표할 때 망치를 눌러 판결하세요', 2200); }
  if (!btn.classList.contains('ok')) return;
  const tg = btn._target;
  sfx('click');
  switch (id) {
    case 'vitals': return PN.openVitals('ability');
    case 'shift': if (S.shifted) return net.send({ t: 'ability', a: 'shift' }); return PN.openShiftPicker();
    case 'vanish': return net.send({ t: 'ability', a: 'vanish' });
    case 'track': if (S.track) return net.send({ t: 'ability', a: 'track' }); return tg && net.send({ t: 'ability', a: 'track', id: tg });
    case 'protect': return tg && net.send({ t: 'ability', a: 'protect', id: tg });
    case 'message': return tg && net.send({ t: 'ability', a: 'message', id: tg });
    case 'interrogate': if (tg) { S.pendingInterro = tg; net.send({ t: 'ability', a: 'interrogate', id: tg }); } return;
    default: return net.send({ t: 'ability', a: id, ...(tg ? { id: tg } : {}) });
  }
}
// 미니게임 열기 (실패해도 조작이 막히지 않게)
function openMinigame(gameId, title, ctx, onDone) {
  if (!openGame) { loadTasks(); toast('미니게임을 불러오는 중입니다…'); return null; }
  let handle = null;
  const c = { map: G.map, params: {}, ...ctx, onClose: () => { if (G.mg === handle) G.mg = null; ctx.onClose?.(); } };
  try { handle = openGame(stage(), gameId, title, c, onDone); }
  catch (e) { console.warn('미니게임 오류', gameId, e); $$('.mg-back').forEach(x => x.remove()); G.mg = null; toast('이 미니게임을 열 수 없습니다.'); return null; }
  if (handle) { handle.sab = ctx.sab; handle.door = ctx.door?.id; handle.station = ctx.station; G.mg = handle; }
  return handle;
}
function openTask(u) {
  const t = S.tasks[u.i];
  if (!t) return;
  const T = taskById(G.map, t.id) || { id: t.id, name: t.name || t.id, game: t.game || 'tap', seq: t.st };
  const step = t.step, gid = stepGame(T, step) || 'tap';
  const params = { ...(T.params || {}), ...(T.stepParams?.[step] || {}), ...(t.params || {}) };
  openMinigame(gid, stepLabel(T, step), { station: u.id, task: T, step, params, visual: (k, on) => net.send({ t: 'visual', k, on: !!on }) },
    () => net.send({ t: 'task', i: u.i, step }));
}
function openFix(u) {
  const k = S.sab?.k, d = sabDef(k);
  if (!d) return;
  const params = { ...(d.params || {}), ...(d.stepParams?.[u.part] || {}), ...(d.params?.[u.id] || {}) };
  let held = false;
  openMinigame(d.game, d.name, {
    station: u.id, sab: k, part: u.part, params, together: !!d.together,
    fix: on => { held = !!on; net.send({ t: 'fix', k, p: u.part, on: !!on }); },
    onClose: () => { if (d.together && held && S?.sab?.k === k) net.send({ t: 'fix', k, p: u.part, on: false }); },
  }, () => { stat('sabFixed'); if (!d.together) net.send({ t: 'fix', k, p: u.part, on: true }); });
}
function openDoorPanel(id) {
  const m = G.map, door = m.doorById?.[id];
  const game = m.doorGame || (m.id === 'polus' ? 'door_switch' : 'door_panel');
  openMinigame(game, '문 열기', { station: id, door, params: m.doorParams || {} }, () => { net.send({ t: 'openDoor', id }); HUD.SND.open(); });
}

addEventListener('keydown', e => {
  if (!S || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'Escape') { if (G.mg) { try { G.mg.close(); } catch {} } else if (G.panel) PN.closePanel(); else $('.chat2')?.remove(); return; }
  const k = { KeyE: 'use', Space: 'use', KeyQ: 'kill', KeyR: 'report', Tab: 'map', KeyV: 'vent', KeyF: 'ab1', KeyG: 'ab2', KeyX: 'sabotage' }[e.code];
  if (!k || $('.modal-back')) return;
  e.preventDefault();
  if (!S.game) { if (k === 'use') act('use'); return; }
  if (k === 'ab1' || k === 'ab2') { const bs = $$('[data-act^="ab:"]', G.hud).filter(b => !b.classList.contains('hide')); const b = bs[k === 'ab1' ? 0 : 1]; if (b) act(b.dataset.act); return; }
  if (k === 'map' && G.panel?.kind === 'map') return PN.closePanel();
  act(k);
});

// ---------- 처치 / 환풍구 / 시체 ----------
net.on('kill', m => {
  if (!S?.game) return;
  const v = scene.players.get(m.id), k = m.by ? scene.players.get(m.by) : null;
  S.dead.add(m.id);
  if (v) { v.dead = true; v.shield = false; v.vent = 0; }
  const look = v?.look || lookOf(m.id), t = now();
  scene.bodies = [...scene.bodies.filter(b => b.id !== m.id), { id: m.id, x: m.x, y: m.y, look, t, acid: m.acid ? { t0: t, dur: m.acid, stage: 1 } : null, stage: m.acid ? 1 : 0 }];
  scene.effect?.('kill', { x: m.x, y: m.y, killer: m.by, victim: m.id, acid: !!m.acid });
  if (m.by === S.you) {
    scene.teleport(S.you, m.x, m.y);
    setCd('kill', m.cd ?? fullCd('kill'));
    sfx('kill'); stat('kills');
  }
  if (m.id === S.you) {
    sfx('kill');
    try { G.mg?.close(); } catch {}
    PN.closePanel();
    const kl = m.as ? lookOf(m.as) : k?.disguise?.look || k?.look || lookOf(m.by);
    HUD.killSplash(kl, look, !!m.acid);
    becomeGhost();
  } else {
    const mp = scene.players.get(S.you);
    if (mp && Math.hypot(mp.x - m.x, mp.y - m.y) < 700) sfx('kill');
  }
  HUD.renderTasks();
});
function becomeGhost(quiet) {
  scene.ghost = true; scene.inVent = null; S.vanished = false; S.shifted = null; S.track = null; scene.tracks = []; scene.lightsOut = false;
  const me2 = scene.players.get(S.you); if (me2) { me2.dead = true; me2.disguise = null; me2.invisible = false; me2.vent = 0; }
  if (G.panel && !['map', 'notes'].includes(G.panel.kind)) PN.closePanel();
  rebuildActs();
  if (!quiet) setTimeout(() => S?.game && HUD.renderTasks(), 50);
}
net.on('vent', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.id), prev = p?.ventId;
  if (p) { p.vent = m.v ? 1 : 0; p.ventId = m.v || null; }
  const fx = { id: m.id, vent: m.v || prev, x: m.x, y: m.y };
  if (m.a === 'in') scene.effect?.('ventIn', fx);
  else if (m.a === 'out') scene.effect?.('ventOut', fx);
  else if (m.a === 'move') scene.effect?.('ventMove', fx);
  if (m.id === S.you) {
    scene.inVent = m.v || null;
    if (isFinite(m.x)) scene.teleport(S.you, m.x, m.y);
    if (m.a === 'in' || m.a === 'move') { if (m.a === 'in') S.ventOutAt = m.ms ? now() + m.ms : 0; }
    else { S.ventOutAt = 0; if (m.forced) HUD.notice(commsOn() ? '통신 방해로 환풍구에서 나왔습니다.' : '환풍구에 머무를 수 있는 시간이 끝났습니다.', 3000); }
    if (m.a === 'in' && S.role === 'engineer') stat('vents');
    if (m.uses !== undefined && m.uses !== null && S.hns) S.hns.vents = m.uses;
  } else if (m.a !== 'move') {
    const meP = scene.players.get(S.you);
    if (meP && isFinite(m.x) && Math.hypot(meP.x - m.x, meP.y - m.y) < 700) sfx('vent');
  }
});
net.on('visual', m => { if (S?.game) scene.visuals?.set(m.id, { ...(scene.visuals.get(m.id) || {}), [m.k || 'scan']: !!m.on }); });
net.on('bodyGone', m => {
  if (!S?.game) return;
  const b = scene.bodies.find(x => x.id === m.id);
  if (b) scene.effect?.('poof', { x: b.x, y: b.y, acid: true });
  scene.bodies = scene.bodies.filter(x => x.id !== m.id);
});
net.on('bodyStage', m => {
  if (!S?.game) return;
  const b = scene.bodies.find(x => x.id === m.id);
  if (b) { b.stage = m.stage; if (b.acid) b.acid.stage = m.stage; }
});

// ---------- 사보타주 / 문 / 이동 장치 ----------
function setSab(sab, info = {}) {
  const was = S.sab, d = sab ? sabDef(sab.k) : null;
  const type = sab ? sab.type || d?.type || 'lights' : null;
  S.sab = sab ? { ...sab, type, parts: sab.parts || [], name: sab.name || d?.name || '방해 공작' } : null;
  if (sab) {
    S.sabEnd = sab.left ? now() + sab.left : 0;
    if (!was || was.k !== sab.k) { sfx('sab'); if (type === 'critical') HUD.SND.alarm(); }
    if (info.reset) HUD.notice('통신 복구가 초기화되었습니다. 두 곳을 동시에 고치세요.', 3000);
  } else if (was) {
    S.sabCd = RULES.sabCd * 1000; S.sabCdMax = S.sabCd;
    if (info.fixed && was.type === 'critical') HUD.centerMsg(`${esc(was.name)} 해결!`, 1500, 'taskdone');
  }
  scene.lightsOut = type === 'lights' && !isImp() && alive();
  // 버섯 믹스업: 모두의 모습/이름이 섞임
  const mixOn = type === 'mixup';
  if (mixOn && !scene.mixup) {
    for (const p of scene.players.values()) {
      p._preMix = p.disguise || null;
      const col = sab.mix?.[p.id];
      p.disguise = { look: { color: col ?? Math.floor(Math.random() * COLORS.length), hat: 'none', visor: 'none', skin: 'none', pet: 'none' }, name: '' };
    }
  } else if (!mixOn && scene.mixup) {
    for (const p of scene.players.values()) { p.disguise = p._preMix || null; delete p._preMix; }
  }
  scene.mixup = mixOn;
  scene.mix = mixOn ? sab.mix || null : null;
  // 고쳐야 할 장소 (화살표·지도 표시)
  const fixes = Object.entries(d?.fix || {});
  scene.sabTargets = sab ? fixes.filter(([, p]) => d.together || !S.sab.parts.includes(p)).map(([id]) => id) : [];
  if (!sab && was && G.mg?.sab) { try { G.mg.close(); } catch {} }
  // 혼자 고치는 장치는 이미 고쳐진 곳의 미니게임을 닫음
  if (sab && G.mg?.sab && d && !d.together) { const part = d.fix?.[G.mg.station]; if (part && S.sab.parts.includes(part)) { try { G.mg.close(); } catch {} } }
  HUD.setSabUI(); HUD.renderTasks();
}
net.on('sab', m => { if (S?.game && G.hud) setSab(m.sab, m); });
net.on('doors', m => {
  if (!S?.game) return;
  applyDoors(m);
});
function applyDoors(m) {
  const prev = scene.doorsClosed || new Set(), next = new Set(m.closed || []);
  const meP = scene.players.get(S.you);
  const near = ids => ids.some(id => { const d = G.map.doorById?.[id]; return d && meP && Math.hypot(d.x + d.w / 2 - meP.x, d.y + d.h / 2 - meP.y) < 900; });
  if (near([...next].filter(id => !prev.has(id)))) HUD.SND.door();
  else if (near([...prev].filter(id => !next.has(id)))) HUD.SND.open();
  scene.doorsClosed = next;
  for (const [room, ms] of Object.entries(m.cd || {})) { S.doorCd[room] = now() + ms; if (!S.doorCdMax[room] || ms > S.doorCdMax[room] - 200) S.doorCdMax[room] = Math.max(ms, RULES.doorCd * 1000); }
  // 수동 문 패널을 열어 둔 사이 문이 열리면 닫기
  if (G.mg?.door && !next.has(G.mg.door)) { try { G.mg.close(); } catch {} }
}
const transTimers = new Map();
net.on('transport', m => {
  if (!S?.game) return;
  if (!m.pid) { scene.effect?.('platform', { tid: m.id, call: true, from: m.from, to: m.to, ms: m.ms }); HUD.SND.open(); return; }
  const p = scene.players.get(m.pid);
  const from = m.from || (p ? { x: p.x, y: p.y } : m.to);
  if (p) { p.moving = true; if (from) { p.x = p.tx = from.x; p.y = p.ty = from.y; } }
  scene.effect?.('transport', { id: m.pid, tid: m.id, kind: m.kind, from, to: m.to, ms: m.ms });
  if (m.pid === S.you) { S.transportUntil = now() + (m.ms || 0) + 1500; try { G.mg?.close(); } catch {} }
  clearTimeout(transTimers.get(m.pid));
  transTimers.set(m.pid, setTimeout(() => finishTransport(m.pid, m.to), (m.ms || 0) + 900));
});
net.on('transportDone', m => finishTransport(m.pid, { x: m.x, y: m.y }));
function finishTransport(pid, to) {
  clearTimeout(transTimers.get(pid)); transTimers.delete(pid);
  if (!S?.game) return;
  const p = scene.players.get(pid);
  if (p) p.moving = false;
  if (to && isFinite(to.x)) scene.teleport(pid, to.x, to.y);
  if (pid === S.you) S.transportUntil = 0;
}
// 에어십: 시작 위치 고르기
net.on('spawnPick', m => {
  if (!S?.game) return;
  S.spawnSeen = true;
  if (S.phase === 'intro') S.pendingSpawn = { points: m.points, ms: m.ms };
  else PN.spawnPicker(m.points, m.ms);
});
net.on('spawned', m => {
  if (!S?.game) return;
  scene.teleport(m.id, m.x, m.y);
  if (m.id === S.you) { S.picking = false; if (G.panel?.kind === 'spawn') PN.closePanel(); }
});
net.on('spawnDone', m => {
  if (!S?.game) return;
  for (const [id, x, y] of m.pos || []) scene.teleport(id, x, y);
  S.picking = false; S.pendingSpawn = null;
  if (G.panel?.kind === 'spawn') PN.closePanel();
});

// ---------- 역할 능력 ----------
net.on('abilityCd', m => {
  if (!S?.game) return;
  const a = m.a;
  if (a === 'sab' || a === 'sabotage') { S.sabCd = m.ms; S.sabCdMax = Math.max(m.ms, 1); return; }
  if (a === 'overrule') {
    const was = S.judge;
    S.judge = { locked: !!m.locked, used: !!m.used, done: m.done ?? 0, total: m.total ?? 0, need: m.need ?? 0 };
    if (was?.locked && !m.locked && !m.used) { HUD.SND.unlock(); HUD.centerMsg('기각 능력이 해제되었습니다!', 2200, 'taskdone'); }
    HUD.renderTasks();
    return;
  }
  if (a === 'acid') return; // 바이퍼: 처치 쿨다운과 같음
  setCd(a, m.ms);
  if (a === 'kill' && m.shield) HUD.centerMsg('보호막에 막혔습니다!', 1800, 'warn');
  if (a === 'vitals') {
    if (m.max) S.batteryMax = m.max;
    if (m.battery !== undefined) S.battery = m.battery;
    if (m.charged) { HUD.notice('바이탈 배터리가 충전되었습니다.', 2500); stat('charges'); }
    if (m.empty) toast('배터리가 없습니다. 임무를 완료하면 충전됩니다.');
  }
  if (a === 'vent' && m.uses !== undefined && S.hns) S.hns.vents = m.uses;
});
net.on('roleSet', m => {
  if (!S?.game) return;
  const was = S.role, wasTeam = S.team;
  S.role = roleKey(m.role);
  S.team = m.team || (isImpRole(S.role) ? 'impostor' : 'crew');
  if (m.mates) S.mates = new Set(m.mates);
  if (m.cds) { S.cdl = {}; S.cdMax = {}; for (const [a, ms] of Object.entries(m.cds)) setCd(a, ms); }
  if (m.tasks) S.tasks = normTasks(m.tasks);
  scene.redNames = isImp() || hnsMode() ? new Set(S.mates) : new Set();
  if (m.alive === false && alive()) { S.dead.add(S.you); becomeGhost(true); }
  if (m.alive === true && !alive()) { S.dead.delete(S.you); scene.ghost = false; const p = scene.players.get(S.you); if (p) p.dead = false; }
  if (was !== S.role) { S.battery = 0; S.track = null; scene.tracks = []; S.shifted = null; S.vanished = false; S.judge = null; }
  initRoleLocal();
  applyVision();
  rebuildActs();
  if (wasTeam !== S.team) setSab(S.sab);
  if (was !== S.role && !m.quiet) {
    const d = roleDef(S.role) || {}, nm = roleName(S.role);
    HUD.centerMsg(`<b style="color:${roleAccent(S.role)}">${esc(nm)}</b>${d.ghost ? josa(nm, '이', '가') + ' 되었습니다!' : ' 역할이 되었습니다'}<br><small>${esc(d.blurb || d.desc || '')}</small>`, 3800, 'roleset');
    HUD.SND.unlock();
  }
});
net.on('shift', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.id);
  if (!p) return;
  p.disguise = m.as ? { look: { ...lookOf(m.as) }, name: nameOf(m.as) } : null;
  if (!m.quiet) { scene.effect?.('poof', { x: m.x ?? p.x, y: m.y ?? p.y, id: m.id, color: p.look?.color, shift: true, evidence: !!m.evidence }); HUD.SND.poof(); }
  if (m.id === S.you) {
    S.shifted = m.as || null;
    S.shiftUntil = m.as && m.ms ? now() + m.ms : 0;
    if (!m.as) setCd('shift', cdLeft('shift'));
  }
});
net.on('vanish', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.id);
  if (p) {
    p.invisible = !!m.on;
    if (!m.quiet) scene.effect?.('poof', { x: m.x ?? p.x, y: m.y ?? p.y, id: m.id, color: p.look?.color, follow: !m.on, vanish: true });
  }
  if (!m.quiet) HUD.SND.poof();
  if (m.id === S.you) { S.vanished = !!m.on; S.vanishUntil = m.on && m.ms ? now() + m.ms : 0; }
});
net.on('shield', m => {
  if (!S?.game) return;
  const p = scene.players.get(m.id);
  if (p) p.shield = !!m.on;
  if (m.on) { HUD.SND.shield(); if (m.by === S.you) stat('protected'); }
});
net.on('shieldHit', m => {
  if (!S?.game) return;
  scene.effect?.('shieldHit', { id: m.id, by: m.by });
  const p = scene.players.get(m.id); if (p) p.shield = false;
  HUD.SND.shieldBreak();
  if (m.by === S.you) HUD.centerMsg('보호막에 막혔습니다!', 1800, 'warn');
});
net.on('noise', m => {
  if (!S?.game) return;
  const until = now() + (m.ms || 10000);
  scene.noises = [...(scene.noises || []), { x: m.x, y: m.y, until, id: m.id }];
  S.alerts.push({ x: m.x, y: m.y, until, id: m.id });
  scene.effect?.('noise', { x: m.x, y: m.y, id: m.id });
  HUD.SND.squeak();
});
net.on('vitalsData', m => {
  if (!S?.game) return;
  if (m.list) S.vitals = new Map(m.list);
  S.vitalsComms = !!m.comms;
  if (m.battery !== undefined) S.battery = m.battery;
  if (m.closed && G.panel?.kind === 'vitals' && G.panel.src === 'ability') {
    G.panel.silent = true; PN.closePanel();
    if (m.why === 'battery') toast('배터리가 다 떨어졌습니다.');
    else if (m.why === 'comms') toast('통신 방해로 바이탈을 볼 수 없습니다.');
  }
});
net.on('doorlogData', m => { if (S?.game) { if (m.list) S.doorlog = m.list; S.doorlogComms = !!m.comms; } });
net.on('track', m => {
  if (!S?.game) return;
  if (m.id && m.ms > 0) {
    const col = COLORS[m.color ?? lookOf(m.id)?.color ?? 0]?.[1] || '#3cff6a';
    if (!S.track || S.track.id !== m.id) stat('tracked');
    S.track = { id: m.id, until: now() + m.ms, color: col, x: m.x ?? S.track?.x, y: m.y ?? S.track?.y, dead: !!m.dead, comms: !!m.comms };
  } else { S.track = null; scene.tracks = []; }
  HUD.renderTasks();
});
// 탐정: 사건 파일 (서버가 관리)
net.on('cases', m => {
  if (!S?.game) return;
  const old = new Map((S.cases || []).map(c => [c.id, c.suspects?.length || 0]));
  S.cases = m.list || [];
  S.activeCase = m.active ?? S.activeCase;
  if (m.limit) S.caseLimit = m.limit;
  for (const c of S.cases) {
    const n = c.suspects?.length || 0;
    if (old.has(c.id) && n > old.get(c.id)) {
      const s = c.suspects[n - 1];
      HUD.notice(`${s.name} 님은 사망 당시 ${s.room ? `${s.room}${s.near ? ' 근처' : ''}에 있었습니다` : '위치를 알 수 없습니다'}.`, 5000);
      stat('interrogated');
    }
  }
  if (!old.size && S.cases.length && S.role === 'detective' && S.phase === 'meeting') HUD.notice('새 사건 파일이 생겼습니다.', 3000);
  PN.refreshNotebook?.();
  HUD.renderTasks();
});
net.on('interrogate', m => { if (S?.game && m.ok === false && m.msg) toast(m.msg); });
net.on('interrogated', () => { if (S?.game) HUD.notice('탐정이 당신을 심문했습니다.', 3000); });
// 판사: 기각 결과
net.on('overrule', m => {
  if (!S?.meeting) return;
  if (m.ok) { S.meeting.my = m.target; S.meeting.overruled = true; HUD.SND.gavel(); stat('overrules'); }
  else { S.meeting.my = null; S.meeting.overruled = false; if (m.msg) toast(m.msg); }
  drawPlates();
});
// 인플루언서: 메시지 휠 / 받은 메시지
net.on('msgWheel', m => {
  if (!S?.game) return;
  if (m.close) { if (G.panel?.kind === 'influence') { G.panel.silent = true; PN.closePanel(); } if (m.sent) { toast('메시지를 보냈습니다.'); stat('messages'); } return; }
  PN.influencerWheel(m);
});
net.on('message', m => { if (S?.game && Array.isArray(m.imgs)) HUD.showInfluence(m.imgs.slice(0, 3), m.ms || 4000); });

// ---------- 숨바꼭질 ----------
function setHns(m) {
  const t = now(), prev = S.hns;
  const phase = m.phase || prev?.phase || 'seek';
  const cfg = S.hnsCfg || {}, s = S.game.settings;
  const H = S.hns = { ...(prev || {}), phase };
  if (m.main !== undefined) H.mainEnd = t + m.main;
  if (m.final !== undefined) H.finalEnd = t + m.final;
  if (m.left !== undefined) { if (phase === 'final') H.finalEnd = t + m.left; else H.mainEnd = t + m.left; }
  if (m.lead !== undefined) H.leadEnd = t + m.lead;
  H.mainTotal = cfg.hideTime || (+s.hideTime || 200) * 1000;
  H.finalTotal = cfg.finalTime || (+s.finalTime || 50) * 1000;
  if (m.vents !== undefined && m.vents !== null) H.vents = m.vents;
  else if (H.vents === undefined) H.vents = cfg.ventUses ?? +s.ventUses ?? 1;
  if (m.seekMap !== undefined) H.seekMap = !!m.seekMap;
  if (m.speed) H.speed = m.speed;
  if (m.crewLeft !== undefined) H.crewLeft = m.crewLeft;
  if (m.cut) HUD.hnsCut(m.cut);
  const pings = m.ping || m.pings;
  if (Array.isArray(pings) && pings.length) HUD.addPings(pings.map(p => (Array.isArray(p) ? { id: p[0], x: p[1], y: p[2] } : p)), m.pingMs);
  S.hnsLocked = isSeeker() && phase === 'hide' && (H.leadEnd || 0) > t;
  if (prev && prev.phase !== phase) {
    if (phase === 'final') { HUD.centerMsg('마지막 숨기!', 2500, 'warn'); HUD.SND.alarm(); S.tasks = []; HUD.renderTasks(); }
    if (phase === 'seek') HUD.centerMsg(isSeeker() ? '찾으러 가세요!' : '술래가 출발했습니다!', 1800, 'warn');
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
  S.game.settings = { ...S.game.settings, map: G.map.id };
  startScene(G.map);
  if (m.tasks) S.tasks = normTasks(m.tasks);
  if (m.bar) S.bar = m.bar;
  for (const [pid, x, y] of m.pos || []) scene.teleport(pid, x, y);
  scene.bodies = []; scene.sabTargets = []; scene.inVent = null; S.sab = null; S.doorCd = {}; S.doorCdMax = {};
  for (const p of scene.players.values()) { p.vent = 0; p.ventId = null; }
  applyDoors(m.doors || { closed: [] });
  setSab(null);
  HUD.renderTasks();
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
  else if (S.possessed && (!m.target || m.by === S.possessed)) { S.possessed = null; HUD.notice('다시 내 몸을 조종할 수 있습니다.', 2000); }
  if (m.by === S.you) { const id = m.target || S.you; scene.viewId = scene.controlId = id; S.possessing = m.target || null; }
});

// ---------- 회의 ----------
let meet = null;
net.on('meeting', m => {
  if (!S?.game) return;
  closeAll();
  meet = null;
  S.phase = 'meeting'; scene.inVent = null; scene.bodies = []; scene.doorsClosed = new Set(); S.picking = false;
  for (const id of m.dead || []) { S.dead.add(id); const p = scene.players.get(id); if (p) p.dead = true; }
  for (const p of scene.players.values()) { if (!scene.mixup) p.disguise = null; p.invisible = false; p.vent = 0; p.ventId = null; p.shield = false; p.moving = false; }
  S.shifted = null; S.vanished = false; S.track = null; scene.tracks = []; scene.noises = []; S.alerts = []; S.ventOutAt = 0;
  if (m.bar) S.bar = m.bar;
  if (m.sab !== undefined) setSab(m.sab);
  S.emergLeft = m.meetings?.[S.you] ?? S.emergLeft;
  if (m.caller === S.you && m.body) stat('reports');
  if (m.caller === S.you && !m.body) stat('meetings');
  const t = now();
  const intro = m.intro ?? RULES.meetIntro;
  S.meeting = { caller: m.caller, body: m.body, voted: new Set(), stage: m.discuss > 0 ? 'discuss' : 'vote', end: t + intro + m.discuss, voteEnd: t + intro + m.discuss + m.vote,
    my: null, pick: null, prot: !!(m.protected || m.protectedRecently), comms: commsOn(), overruled: false };
  sfx('alarm');
  const cl = lookOf(m.caller), bl = m.body ? m.bodyLook || lookOf(m.body) : null;
  const sp = overlay(`<div class="msplash ${m.body ? 'body' : 'emer'}"><div class="ms-bg"></div><div class="ms-art">${m.body
    ? `<div class="ms-body">${HUD.crewImg(bl, { dead: true }, 300, 216)}</div><div class="ms-rep">${HUD.crewImg(cl, {}, 300, 216)}</div>`
    : `<div class="ms-mega">${HUD.icon('report')}</div>${HUD.crewImg(cl, {}, 320, 230)}`}</div><h1>${m.body ? '시체 발견됨' : '긴급회의'}</h1></div>`);
  setTimeout(() => { dropOverlay(sp); if (S?.meeting) meetingUI(); }, intro);
});
function meetingUI() {
  if (!S?.meeting) return;
  const M = S.meeting, n = scene.players.size;
  meet = overlay(`<div class="meet2"><div class="tablet"><div class="mhead"><h2>누가 임포스터일까요?</h2>${M.prot ? '<div class="prot">최근에 누군가 보호받았습니다</div>' : ''}</div>
    <div class="plates2 ${n > 10 ? 'c3' : ''}"></div>
    <div class="mfoot"><div class="skiparea2"><button class="skip2">투표 건너뛰기</button><div class="svotes"></div></div><div class="mtime"></div>
      ${S.role === 'detective' ? `<button class="mbtn notesb" title="사건 노트">${HUD.icon('notes')}</button>` : ''}<button class="mbtn chatb2" title="채팅">${HUD.icon('chat')}<i class="badge hidden"></i></button></div></div><div class="judgefx"></div></div>`);
  $('.chatb2', meet).onclick = openChat;
  $('.notesb', meet)?.addEventListener('click', () => { sfx('click'); PN.openNotebook(); });
  $('.skip2', meet).onclick = () => { if (M.stage !== 'vote' || M.my || !alive()) return; sfx('click'); M.pick = M.pick === 'skip' ? null : 'skip'; drawPlates(); };
  drawPlates();
  const iv = setInterval(() => {
    if (!meet?.isConnected) return clearInterval(iv);
    const t = now(), el = $('.mtime', meet);
    if (M.stage === 'discuss' && t > M.end) { M.stage = 'vote'; drawPlates(); }
    el.textContent = M.stage === 'discuss' ? `투표 시작까지: ${Math.max(0, Math.ceil((M.end - t) / 1000))}초`
      : M.stage === 'vote' ? `투표 종료까지: ${Math.max(0, Math.ceil((M.voteEnd - t) / 1000))}초` : `진행까지: ${Math.max(0, Math.ceil(((M.doneAt || t) + RULES.resultMs - t) / 1000))}초`;
    const b = $('.chatb2 .badge', meet); b.textContent = S.unread; b.classList.toggle('hidden', !S.unread);
  }, 200);
}
const judgeReady = () => S.role === 'judge' && alive() && !!S.judge && !S.judge.locked && !S.judge.used && !S.meeting?.comms && !commsOn();
function drawPlates(result) {
  const M = S?.meeting, box = meet && $('.plates2', meet);
  if (!box || !M) return;
  result ||= M.result;
  const ps = [...scene.players.values()].sort((a, b) => (S.dead.has(a.id) - S.dead.has(b.id)));
  const chip = v => `<i class="chip" style="--d:${v.i * 0.22}s">${v[0] && !result.anon ? HUD.crewImg(lookOf(v[0]), { head: true }, 44, 32) : HUD.crewImg({ color: 15 }, {}, 44, 32).replace('<svg', '<svg class="anon"')}</i>`;
  const canVote = M.stage === 'vote' && !M.my && alive();
  const jr = canVote && judgeReady();
  const votes = result ? result.votes.map((v, i) => Object.assign([...v], { i })) : [];
  box.innerHTML = ps.map(p => {
    const dead = S.dead.has(p.id), mine = votes.filter(v => v[1] === p.id);
    const look = p.look || {}, plate = look.plate && look.plate !== 'none' ? `plate-${look.plate}` : '';
    const red = (isImp() || hnsMode()) && S.mates.has(p.id);
    return `<div class="pl2 ${dead ? 'dead' : ''} ${p.id === S.you ? 'me' : ''} ${M.pick === p.id ? 'pick' : ''} ${canVote && !dead && !S.gone.has(p.id) ? 'can' : ''} ${result?.ejected === p.id ? 'out' : ''} ${plate}" data-id="${p.id}">
      <div class="av">${HUD.crewImg(look, dead ? { dead: true } : {}, 100, 72)}</div><div class="nm" style="${red ? 'color:#e01b1b' : ''}">${esc(p.name)}${p.id === S.you ? ` <small style="color:${roleAccent(S.role)}">${esc(roleName(S.role))}</small>` : ''}</div>
      ${M.caller === p.id ? `<span class="megaphone">${HUD.icon('report')}</span>` : ''}${M.voted.has(p.id) && !result ? '<span class="ivoted">투표함</span>' : ''}
      ${M.my === p.id && !result ? `<span class="myvote">${M.overruled ? HUD.icon('overrule') : '✓'}</span>` : ''}
      ${M.pick === p.id && !result ? `<div class="conf"><button class="yes" title="투표">✓</button><button class="no" title="취소">✕</button>${jr ? `<button class="gavel" title="기각 (판결)">${HUD.icon('overrule')}</button>` : ''}</div>` : ''}
      ${dead ? '<i class="xmark"></i>' : ''}<div class="votes2">${mine.map(chip).join('')}</div></div>`;
  }).join('');
  const sk = $('.skip2', meet);
  sk.classList.toggle('on', M.pick === 'skip' || M.my === 'skip'); sk.disabled = !canVote;
  $('.skiparea2 .conf', meet)?.remove();
  if (M.pick === 'skip' && !result) sk.insertAdjacentHTML('afterend', '<div class="conf"><button class="yes">✓</button><button class="no">✕</button></div>');
  $('.svotes', meet).innerHTML = result ? `<span class="slab">투표 건너뜀</span>${votes.filter(v => v[1] === 'skip').map(chip).join('')}` : '';
  $('.skiparea2 .yes', meet)?.addEventListener('click', e => { e.stopPropagation(); vote('skip'); });
  $('.skiparea2 .no', meet)?.addEventListener('click', e => { e.stopPropagation(); M.pick = null; drawPlates(); });
  $('.mhead h2', meet).textContent = result ? '투표 결과' : '누가 임포스터일까요?';
  $$('.pl2', box).forEach(pl => pl.onclick = e => {
    const id = pl.dataset.id;
    if (e.target.closest('.yes')) return vote(id);
    if (e.target.closest('.gavel')) return overrule(id);
    if (e.target.closest('.no')) { M.pick = null; return drawPlates(); }
    if (M.stage !== 'vote' || M.my || !alive() || S.dead.has(id) || S.gone.has(id)) return;
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
  M.my = id; M.pick = null; M.overruled = true;
  net.send({ t: 'ability', a: 'overrule', id });
  drawPlates();
}
net.on('voting', m => {
  if (!S?.meeting) return;
  S.meeting.stage = 'vote';
  if (m.ms) S.meeting.voteEnd = now() + m.ms;
  drawPlates();
});
net.on('voted', m => {
  if (!S?.meeting) return;
  S.meeting.voted.add(m.id); sfx('vote'); drawPlates();
  const left = m.left ?? [...scene.players.keys()].filter(id => !S.dead.has(id) && !S.meeting.voted.has(id)).length;
  const line = { sys: true, text: `${nameOf(m.id)} 님이 투표했습니다. ${left}명 남음.` };
  S.chat.push(line);
  const box = $('.chat2 .msgs'); if (box) { box.append(chatLine(line)); box.scrollTop = 1e9; }
});
net.on('result', m => {
  if (!S?.meeting) return;
  const M = S.meeting;
  M.stage = 'done'; M.doneAt = now(); M.pick = null;
  const res = { votes: m.votes || [], anon: !!+S.game.settings.anonVotes, ejected: m.ejected };
  if (m.judge) { M.result = null; judgeEffect(); setTimeout(() => { if (S?.meeting === M) { M.result = res; drawPlates(); } }, 1800); }
  else { M.result = res; drawPlates(); }
});
// 판사 판결 연출: 망치가 내려치고 유리가 깨짐 ("The Judge has spoken")
function judgeEffect() {
  const fx = meet && $('.judgefx', meet);
  if (!fx) return;
  fx.innerHTML = `<div class="gv">${HUD.icon('overrule')}</div><svg class="jglass" viewBox="0 0 1600 720" preserveAspectRatio="none">${crackLines()}</svg>
    <div class="jtxt">판사가 판결을 내렸습니다</div>`;
  fx.classList.add('on');
  setTimeout(() => HUD.SND.gavel(), 380);
}
function crackLines() {
  const cx = 800, cy = 330, out = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
    let d = `M${cx} ${cy}`;
    for (let k = 0; k < 5; k++) { const r = 70 + k * 150 + Math.random() * 60, b = a + (Math.random() - 0.5) * 0.25; d += ` L${(cx + Math.cos(b) * r).toFixed(0)} ${(cy + Math.sin(b) * r * 0.75).toFixed(0)}`; }
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
  const name = m.name || (m.id ? nameOf(m.id) : '');
  const multi = (+S.game.settings.impostors || 1) > 1;
  let text, sub = m.sub ?? (m.impLeft !== null && m.impLeft !== undefined ? `임포스터가 ${m.impLeft}명 남았습니다.` : '');
  if (m.verdict) text = '판결이 내려졌습니다...';
  else if (!m.id) text = `아무도 방출되지 않았습니다. (${m.tie ? '동점' : '건너뜀'})`;
  else if (m.role && m.imp !== null && m.imp !== undefined) { const rn = roleName(m.role); text = `${name} 님은 ${rn}${josa(rn, '이었습니다', '였습니다')}.`; }
  else if (m.text) text = m.text;
  else if (m.imp === null || m.imp === undefined) text = `${name} 님이 방출됐습니다.`;
  else text = m.imp ? `${name} 님은 ${multi ? '' : ''}임포스터였습니다.` : `${name} 님은 임포스터가 아니었습니다.`;
  const theme = G.map.theme?.outside || 'space';
  const look = m.id ? m.look || lookOf(m.id) : null;
  const el = overlay(`<div class="eject2 th-${theme}"><div class="ebg"></div><div class="estars"></div>${look ? `<div class="who2">${HUD.crewImg(look, {}, 260, 187)}</div>` : ''}
    <div class="etxt"><div class="txt"></div><div class="sub"></div></div></div>`);
  let i = 0;
  const start = 700;
  setTimeout(() => { const iv = setInterval(() => { const tx = $('.txt', el); if (!tx) return clearInterval(iv); tx.textContent = text.slice(0, ++i); if (i % 2) sfx('step'); if (i >= text.length) clearInterval(iv); }, 65); }, start);
  setTimeout(() => { const sb = $('.sub', el); if (sb && sub) sb.textContent = sub; }, start + text.length * 65 + 450);
  setTimeout(() => el.classList.add('out'), (m.ms || RULES.ejectMs) - 500);
  setTimeout(() => dropOverlay(el), m.ms || RULES.ejectMs);
  HUD.renderTasks();
});
net.on('resume', m => {
  if (!S?.game) return;
  $$('.eject2').forEach(e => dropOverlay(e));
  for (const [id, x, y] of m.pos || []) scene.teleport(id, x, y);
  S.phase = 'play'; S.meeting = null; meet = null;
  scene.doorsClosed = new Set();
  if (isImp()) setCd('kill', m.kill ?? fullCd('kill'));
  S.emergAt = now() + (m.emerg ?? (+S.game.settings.emergencyCooldown || 0) * 1000);
  if (m.meetings !== undefined) S.emergLeft = m.meetings;
  if (m.sab !== undefined) setSab(m.sab);
  if (m.bar) S.bar = m.bar;
  if (m.doors) applyDoors(m.doors);
  for (const [a, ms] of Object.entries(m.cds || m.roleCds || {})) setCd(a, ms);
  if (m.sabCd !== undefined) S.sabCd = Math.max(0, m.sabCd);
  S.spawnSeen = false;
  const pts = m.spawnPick || m.spawnPoints;
  if (pts?.length) setTimeout(() => { if (S?.game && !S.picking && S.phase === 'play' && !S.spawnSeen) PN.spawnPicker(pts, RULES.spawnPickMs); }, 2500);
  HUD.renderTasks();
});

// ---------- 게임 종료 ----------
net.on('over', m => {
  if (!S?.game) return;
  closeAll(); meet = null; S.meeting = null; S.phase = 'over';
  const roles = new Map(m.roles || []);
  const teamOf = id => (isImpRole(roles.get(id)) ? 'impostor' : 'crew');
  const winners = new Set(m.winners || (m.players || []).filter(p => teamOf(p.id) === m.winner).map(p => p.id));
  const win = winners.has(S.you);
  if (!S.game.practice) {
    stat('finished'); if (win) stat(isImp() ? 'impWins' : 'crewWins');
    const mine = m.stats?.[S.you];
    if (mine) for (const [k, v] of Object.entries(mine)) if (typeof v === 'number') stat(`r_${k}`, v);
    addXp(win ? 60 : 35); profile.beans += win ? 30 : 15; saveProfile();
  }
  sfx(win ? 'win' : 'lose');
  const team = (m.players || []).filter(p => winners.has(p.id));
  const meFirst = [...team.filter(p => p.id === S.you), ...team.filter(p => p.id !== S.you)];
  const col = m.winner === 'impostor' ? '#FF1919' : '#8CFFFF';
  S.pendingLobby = true;
  const el = overlay(`<div class="endscr2 ${win ? 'win' : 'lose'}" style="--tc:${win ? col : '#FF1919'}"><h1>${win ? '승리' : '패배'}</h1><p class="why">${m.winner === 'impostor' ? '임포스터 승리' : '크루원 승리'}${m.reason ? ` — ${esc(m.reason)}` : ''}</p>
    <div class="glow" style="--gc:${col}"></div><div class="team">${meFirst.map((p, i) => { const k = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2), dead = S.dead.has(p.id); return `<div class="tc ${dead ? 'ghost' : ''}" style="--k:${k};--a:${Math.abs(k)}">${HUD.crewImg(p.look, dead ? { ghost: true } : {}, 240, 173)}<b>${esc(p.name)}</b><small style="color:${roleAccent(roles.get(p.id))}">${esc(roleName(roles.get(p.id)))}</small></div>`; }).join('')}</div>
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
  const red = S.game && (isImp() || hnsMode()) && S.mates.has(m.id);
  return h(`<div class="m ${m.id === S.you ? 'mine' : ''} ${ghost ? 'ghost' : ''}">${crewSVG(m.look || lookOf(m.id), { noPet: true, ghost })}<div class="bub"><b style="${red ? 'color:#e01b1b' : ''}">${esc(m.name)}${m.quick ? ' <i class="q">빠른 채팅</i>' : ''}</b>${esc(censor(m.text || ''))}</div></div>`);
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
  if ($('.qc2', el)) return $('.qc2', el).remove();
  let cat = 0;
  const q = h('<div class="qc2"></div>');
  el.append(q);
  const names = [...scene.players.values()].map(p => p.name);
  const rooms = (S.game ? G.map : getMap(S.room.settings.map)).roomNames || [];
  const draw = () => {
    q.innerHTML = `<div class="cats">${QUICK.map((c, i) => `<button data-c="${i}" class="${i === cat ? 'on' : ''}">${c[0]}</button>`).join('')}</div>
      <div class="sels"><label>플레이어 <select class="sp">${names.map(n => `<option>${esc(n)}</option>`).join('')}</select></label><label>장소 <select class="sr">${rooms.map((r, i) => `<option value="${i}">${esc(r)}</option>`).join('')}</select></label></div>
      <div class="ph">${QUICK[cat][1].map((p, i) => `<button data-i="${i}">${esc(p).replace('{p}', '<b>○○</b>').replace('{r}', '<b>□□</b>')}</button>`).join('')}</div>`;
    $$('[data-c]', q).forEach(b => b.onclick = () => { sfx('click'); cat = +b.dataset.c; draw(); });
    $$('[data-i]', q).forEach(b => b.onclick = () => { sfx('click'); net.send({ t: 'chat', q: { c: cat, i: +b.dataset.i, p: $('.sp', q).value, r: +$('.sr', q).value } }); q.remove(); });
    $$('select', q).forEach(s => s.onkeydown = e => e.stopPropagation());
  };
  draw();
}

// ---------- 플레이어 위치 ----------
net.on('pos', m => {
  if (!S) return;
  const ctl = scene.controlId ?? S.you;
  for (const [id, x, y, d, mv, f = 0] of m.p || []) {
    const p = scene.players.get(id);
    if (!p) continue;
    if (S.game) {
      p.vent = f & 1 ? 1 : 0;
      if (!S.meeting) p.invisible = !!(f & 2);
      p.moving = !!(f & 8);
    }
    if (id === S.you) S.srvPos = { x, y, t: now() };
    if (id === S.you && !S.possessed) continue;
    if (id === ctl && id !== S.you) continue;
    if (id === S.you && S.possessed) { p.x = p.tx = x; p.y = p.ty = y; p.dir = d; p.mv = mv; continue; }
    if (f & 8) continue; // 사다리·짚라인 이동 중: 효과가 그림
    p.tx = x; p.ty = y; p.dir = d; p.mv = mv;
    if (Math.hypot(p.x - x, p.y - y) > 600) { p.x = x; p.y = y; }
  }
});

net.on('err', m => m.msg && toast(m.msg));
net.on('toast', m => m.msg && toast(m.msg));

// ---------- mod 메뉴용 API ----------
export const modApi = {
  state: () => ({
    inRoom: !!S, inGame: !!S?.game, you: S?.you ?? null, role: S?.game ? S.role : null,
    players: (S?.game ? [...scene.players.values()] : S?.room.players || []).map(p => ({
      id: p.id, name: p.name, look: p.look, dead: !!S?.dead.has(p.id),
      ...(S?.game && (p.id === S.you ? { role: S.role } : S.mates.has(p.id) && isImp() ? { role: 'impostor' } : {})),
    })),
    settings: S?.game?.settings || S?.room?.settings || null, map: S?.game ? G.map.id : S?.room?.settings?.map || null,
  }),
  setNoclip(on) { scene.noclip = !!on; },
  setSpeed(mul) { const v = Number(mul); scene.speedMul = isFinite(v) && v > 0 ? v : 1; },
  possess(id) {
    if (!S) return;
    const t = id && id !== S.you ? id : null;
    net.send({ t: 'mod', a: 'possess', id: t });
    scene.viewId = scene.controlId = t || S.you; S.possessing = t;
  },
};
