// 숨은 mod 메뉴 (클라이언트). 설정 창의 크루원을 10번 눌러 인증하면 왼쪽 위에 동그란 "mod" 버튼이 생긴다.
// 버튼 → 계정 해킹 / 플레이어 해킹 / 설정 해킹 / 시스템 해킹. 권한 판정은 모두 서버(server/mod.js)가 한다.
import { $, $$, h, esc, stage, sfx, net, me, profile, saveProfile, settings } from '../core.js';
import { COLORS, ITEMS, MAPS, SETTINGS, SETTING_GROUPS, HNS_SETTINGS, HNS_GROUPS, defaultSettings, fmtSetting } from '../shared/data.js';
import { ROLE_DEFS, ROLE_ORDER, isImpRole } from '../shared/roles.js';
import { crewSVG, mapIcon } from './crew.js';
import * as PLAY from '../game/play.js';
import * as MENU from './menu.js';

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 저장 불가 */ } },
  json(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && typeof v === 'object' ? v : d; } catch { return d; } },
};
const KEY = 'au_modkey', POS = 'au_mod_pos', CREATE = 'au_mod_create';
const FAB = 70; // 버튼 지름 (stage 좌표)
const ROLES = ['crewmate', 'impostor', ...ROLE_ORDER].filter(r => ROLE_DEFS[r]);
const norm = r => (r === 'crew' ? 'crewmate' : r === 'angel' || r === 'guardianAngel' ? 'guardian' : r);
const roleName = r => ROLE_DEFS[norm(r)]?.name || r || '?';
const roleColor = r => (isImpRole(norm(r)) ? '#ff3b5c' : '#39e6ff');
const ro = s => { s = String(s); const c = s.charCodeAt(s.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 && c % 28 !== 8 ? '으로' : '로'; };
const mapName = id => MAPS.find(m => m.id === id)?.ko || id || '?';

// ---------- 상태 ----------
const ST = {
  authed: false, open: false, view: 'home', noclip: false, nocd: false, speed: 1, possess: null, rainbow: null, sabs: null,
  pick: null, role: null, target: 'room', confirm: null, drafts: {},
};
const api = () => PLAY.modApi;
const game = () => { try { return api()?.state?.() || {}; } catch { return {}; } };
const myId = () => game().you ?? me.id;
const playersNow = () => game().players || [];
const send = m => { if (!net.open) { note('서버에 연결되어 있지 않습니다', 'bad'); return false; } net.send({ t: 'mod', ...m }); return true; };

// ---------- 화면 위 레이어 (#stage 와 같은 좌표·배율, 모든 화면 위) ----------
const layer = h('<div id="modlayer" aria-live="polite"></div>');
document.body.append(layer);
const syncLayer = () => { const s = stage(); if (s) layer.style.transform = s.style.transform; };
if (stage()) new MutationObserver(syncLayer).observe(stage(), { attributes: true, attributeFilter: ['style'] });
addEventListener('resize', () => requestAnimationFrame(syncLayer));
syncLayer();
const scale = () => layer.getBoundingClientRect().width / 1600 || 1;
const toasts = h('<div class="md-toasts"></div>');
layer.append(toasts);
// mod 전용 알림 (mod 창보다 위에 보임)
function note(msg, kind = 'ok') {
  const t = h(`<div class="md-toast ${kind}"><i>${kind === 'bad' ? '✕' : '✓'}</i><span>${esc(msg)}</span></div>`);
  toasts.append(t);
  while (toasts.children.length > 4) toasts.firstChild.remove();
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// ---------- 동그란 mod 버튼 (끌어서 옮기기, 위치 저장) ----------
const fab = h(`<button class="md-fab hidden" aria-label="mod 메뉴"><span>mod</span></button>`);
layer.append(fab);
const clampPos = p => ({ x: Math.max(0, Math.min(1600 - FAB, +p.x || 0)), y: Math.max(0, Math.min(720 - FAB, +p.y || 0)) });
let pos = clampPos(LS.json(POS, { x: 14, y: 96 }));
const placeFab = () => { fab.style.left = `${pos.x}px`; fab.style.top = `${pos.y}px`; };
placeFab();
let drag = null;
fab.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  e.preventDefault(); e.stopPropagation();
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y, moved: false };
  try { fab.setPointerCapture(e.pointerId); } catch { /* 지원 안 함 */ }
});
fab.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const k = scale(), dx = (e.clientX - drag.sx) / k, dy = (e.clientY - drag.sy) / k;
  if (!drag.moved && Math.hypot(dx, dy) < 8) return; // 이 정도 움직임은 클릭
  drag.moved = true; fab.classList.add('drag');
  pos = clampPos({ x: drag.x + dx, y: drag.y + dy });
  placeFab();
});
const endDrag = e => {
  if (!drag || e.pointerId !== drag.id) return;
  const moved = drag.moved;
  drag = null; fab.classList.remove('drag');
  if (moved) { LS.set(POS, JSON.stringify(pos)); return; }
  if (e.type === 'pointerup') toggleWin();
};
fab.addEventListener('pointerup', endDrag);
fab.addEventListener('pointercancel', endDrag);
fab.addEventListener('click', e => e.stopPropagation());

// ---------- 인증 ----------
function setAuthed(on) {
  ST.authed = !!on;
  fab.classList.toggle('hidden', !ST.authed);
  if (!ST.authed) closeWin();
}
net.on('welcome', () => { const key = LS.get(KEY); if (key) net.send({ t: 'mod', a: 'hello', key }); });
addEventListener('au-mod-open', () => { if (!LS.get(KEY)) return; setAuthed(true); openWin(); });

// ---------- 서버 응답 ----------
const TXT = {
  level: m => `레벨이 ${m.v}${ro(m.v)} 바뀌었습니다`,
  noclip: m => `벽뚫 ${m.on ? '켬' : '끔'}`,
  speed: m => `속도 ${m.v}배`,
  kickAll: m => `${m.n || 0}명을 추방했습니다`,
  nocd: m => `쿨타임 없이 킬 ${m.on ? '켬' : '끔'}`,
  killAll: () => '나를 뺀 모두가 죽었습니다',
  win: m => `${m.team === 'impostor' ? '임포스터' : '크루원'} 팀 승리!`,
  settings: () => '설정을 적용했습니다',
  map: m => `맵을 ${mapName(m.id)}${ro(mapName(m.id))} 바꿨습니다`,
  rainbow: m => (m.on ? (m.target === 'all' ? '모두의 색이 계속 바뀝니다' : '내 색이 계속 바뀝니다') : '색 바꾸기를 껐습니다'),
  doors: () => '모든 문을 닫았습니다',
  sab: m => `${sabName(m.k)} 발동!`,
  meeting: () => '긴급 회의를 열었습니다',
};
net.on('mod', m => {
  const a = m.a;
  if (a === 'hello') {
    if (!m.ok) { LS.del(KEY); setAuthed(false); return; }
    setAuthed(true);
    // hello 의 레벨은 인증 전이라 999 로 잘렸을 수 있음 → 다시 알림
    if (profile && (profile.level > 999 || profile.level < 1)) net.send({ t: 'mod', a: 'level', v: profile.level });
    send({ a: 'status' });
    return;
  }
  if (a === 'auth') { if (m.ok) { setAuthed(true); send({ a: 'status' }); } return; }
  if (!ST.authed) return;
  if (a === 'status') {
    if (!m.ok) return;
    Object.assign(ST, { noclip: !!m.noclip, nocd: !!m.nocd, speed: +m.speed || 1, possess: m.possess || null, rainbow: m.rainbow || null, sabs: Array.isArray(m.sabs) ? m.sabs : null });
    applyLocal();
    if (ST.open && ST.view !== 'settings') render();
    return;
  }
  if (!m.ok) { note(m.msg || '실패했습니다', 'bad'); return; }
  switch (a) {
    case 'role': {
      const mine = m.id === myId(), n = nameOf(m.id), rn = roleName(m.role);
      note(m.now ? `${mine ? '내' : `${n}님의`} 직업이 ${rn}${ro(rn)} 바뀌었습니다` : `다음 게임에서 ${mine ? '나는' : `${n}님은`} ${rn}${ro(rn)} 시작합니다`);
      break;
    }
    case 'noclip': ST.noclip = !!m.on; applyLocal(); break;
    case 'speed': ST.speed = +m.v || 1; applyLocal(); break;
    case 'nocd': ST.nocd = !!m.on; break;
    case 'possess': ST.possess = m.id || null; note(m.id ? `${nameOf(m.id)}님을 조종합니다` : '조종을 해제했습니다'); break;
    case 'rainbow': ST.rainbow = m.on ? m.target || 'me' : null; break;
  }
  if (TXT[a]) note(TXT[a](m));
  sfx('task');
  if (ST.open && (ST.view !== 'settings' || a === 'settings' || a === 'map')) render();
});
// 내가 조종 중인 대상 (서버가 possess{by, target} 로 알려 줌)
net.on('possess', m => { if (m.by && m.by === myId()) { ST.possess = m.target || null; if (ST.open && ST.view === 'system') render(); } });
// 방/게임이 바뀌면 클라이언트 쪽 설정(벽뚫·속도)을 다시 적용하고 목록 갱신
let rt = null;
const soon = () => { clearTimeout(rt); rt = setTimeout(() => { applyLocal(); if (ST.open && ST.view !== 'settings') render(); else if (ST.open) foot(); }, 60); };
['joined', 'start', 'room', 'leftRoom', 'kicked', 'mapChange', 'gone', 'end', 'resume', 'roleSet', 'meeting'].forEach(t => net.on(t, soon));
net.on('close', () => { ST.possess = null; if (ST.open) foot(); });

// 클라이언트 쪽 효과: 벽 통과·속도 배율 (나갈 때 play.js 가 초기화하므로 들어올 때마다 다시)
function applyLocal() {
  try { api()?.setNoclip?.(ST.noclip); api()?.setSpeed?.(ST.speed); } catch { /* play.js 없음 */ }
}
// 쿨타임 없이: 서버는 쿨다운을 무시하지만 화면의 쿨다운 표시가 버튼을 막으므로 계속 0으로 만든다
setInterval(() => {
  if (!ST.authed || !ST.nocd) return;
  const S = PLAY.G?.S;
  if (!S?.game) return;
  for (const k of Object.keys(S.cdl || {})) if (S.cdl[k] > 0) S.cdl[k] = 0;
  if (S.sabCd > 0) S.sabCd = 0;
  for (const k of Object.keys(S.doorCd || {})) S.doorCd[k] = 0;
}, 100);

const nameOf = id => (id === myId() ? '나' : playersNow().find(p => p.id === id)?.name || '?');
const curMap = () => (game().inGame ? PLAY.G?.map : null);
const sabName = k => curMap()?.sabotages?.[k]?.name || { reactor: '원자로', o2: '산소', lights: '조명', comms: '통신', seismic: '지반 안정 장치', crash: '충돌 항로', mixup: '버섯 믹스업' }[k] || k;

// ---------- mod 창 ----------
const win = h(`<div class="md-win hidden" role="dialog" aria-label="mod 메뉴">
  <div class="md-scan"></div>
  <div class="md-head"><button class="md-backb hidden" aria-label="뒤로">◀</button><span class="md-logo">${crewSVG({ color: 11, hat: 'none', visor: 'none', skin: 'none', pet: 'none' }, { noPet: true, head: true })}</span>
    <b class="md-title">MOD<i>//</i>MENU</b><span class="md-path"></span><span class="md-cur">_</span><button class="md-x" aria-label="닫기">✕</button></div>
  <div class="md-body"></div><div class="md-foot"></div></div>`);
layer.append(win);
const body = $('.md-body', win);
// 창 안에서 누른 키는 게임으로 보내지 않음 (Esc 는 창 닫기)
win.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { if (ST.view !== 'home') go('home'); else closeWin(); }
  if (e.key === 'Enter' && e.target.matches('input[data-enter]')) $(`[data-act="${e.target.dataset.enter}"]`, win)?.click();
});
win.addEventListener('pointerdown', e => e.stopPropagation());
// 머리줄을 끌어서 창 옮기기
{
  const hd = $('.md-head', win);
  let d = null;
  hd.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = { x: win.offsetLeft, y: win.offsetTop };
    d = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ...r };
    try { hd.setPointerCapture(e.pointerId); } catch { /* 지원 안 함 */ }
  });
  hd.addEventListener('pointermove', e => {
    if (!d || d.id !== e.pointerId) return;
    const k = scale();
    win.style.left = `${Math.max(-700, Math.min(1500, d.x + (e.clientX - d.sx) / k))}px`;
    win.style.top = `${Math.max(0, Math.min(660, d.y + (e.clientY - d.sy) / k))}px`;
  });
  const up = e => { if (d && d.id === e.pointerId) d = null; };
  hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
}
$('.md-x', win).onclick = () => { sfx('click'); closeWin(); };
$('.md-backb', win).onclick = () => { sfx('click'); go('home'); };

function openWin() {
  if (!ST.authed) return;
  ST.open = true;
  win.classList.remove('hidden');
  fab.classList.add('on');
  send({ a: 'status' });
  render();
}
function closeWin() { ST.open = false; ST.confirm = null; win.classList.add('hidden'); fab.classList.remove('on'); }
function toggleWin() { sfx('click'); ST.open ? closeWin() : openWin(); }
function go(view) {
  ST.view = view; ST.confirm = null; body.scrollTop = 0;
  if (view === 'settings') ST.target = game().inRoom ? 'room' : 'create'; // 방 밖이면 "방 만들 때 쓸 설정"
  render();
}

const VIEWS = {
  account: ['계정 해킹', 'ACCOUNT', '직업(역할) 바꾸기 · 계정 레벨'],
  player: ['플레이어 해킹', 'PLAYER', '벽뚫 · 속도 · 추방 · 쿨타임 · 승리'],
  settings: ['설정 해킹', 'SETTINGS', '모든 게임 설정을 제한 없이'],
  system: ['시스템 해킹', 'SYSTEM', '맵 · 아이템 · 시점 조작 · 색 · 문 · 긴급상황'],
};
const ICON = {
  account: '<svg viewBox="0 0 48 48"><rect x="5" y="10" width="38" height="28" rx="5"/><circle cx="17" cy="22" r="5"/><path d="M9 33Q17 25 25 33"/><path d="M29 20H38M29 26H38M29 32H35"/></svg>',
  player: '<svg viewBox="0 0 48 48"><path d="M13 40V20C13 11 18 6 25 6C32 6 36 11 36 19V40"/><path d="M13 40H21V34H28V40H36"/><rect x="22" y="12" width="17" height="10" rx="5"/><path d="M13 20H8V34H13"/></svg>',
  settings: '<svg viewBox="0 0 48 48"><path d="M8 13H40M8 24H40M8 35H40"/><circle cx="17" cy="13" r="4.5"/><circle cx="31" cy="24" r="4.5"/><circle cx="21" cy="35" r="4.5"/></svg>',
  system: '<svg viewBox="0 0 48 48"><rect x="12" y="12" width="24" height="24" rx="3"/><rect x="19" y="19" width="10" height="10"/><path d="M18 12V6M24 12V6M30 12V6M18 42V36M24 42V36M30 42V36M12 18H6M12 24H6M12 30H6M42 18H36M42 24H36M42 30H36"/></svg>',
};

function render() {
  if (!ST.open) return;
  const v = ST.view;
  $('.md-backb', win).classList.toggle('hidden', v === 'home');
  $('.md-path', win).textContent = v === 'home' ? '' : `/ ${VIEWS[v][0]}`;
  const top = body.scrollTop, focus = document.activeElement?.closest?.('.md-body') ? document.activeElement.dataset.f : null;
  body.innerHTML = v === 'home' ? homeHTML() : v === 'account' ? accountHTML() : v === 'player' ? playerHTML() : v === 'settings' ? settingsHTML() : systemHTML();
  body.scrollTop = top;
  body.dataset.view = v;
  // 입력 중이던 칸은 다시 그려도 값·포커스 유지
  for (const [f, val] of Object.entries(ST.drafts)) { const i = $(`.md-in[data-f="${f}"]`, body); if (i) i.value = val; }
  if (focus) $(`.md-in[data-f="${focus}"]`, body)?.focus({ preventScroll: true });
  foot();
}
function foot() {
  const g = game(), S = PLAY.G?.S, code = S?.room?.code;
  const where = !g.inRoom ? '메뉴' : g.inGame ? `게임 중 · ${mapName(g.map)}` : `로비${code ? ` ${settings.streamer ? '******' : code}` : ''} · ${mapName(g.map)}`;
  $('.md-foot', win).innerHTML = `<span class="${net.open ? 'on' : 'off'}">● ${net.open ? 'ONLINE' : 'OFFLINE'}</span><span>${esc(where)}</span>
    ${g.inGame && g.role ? `<span>역할: <b style="color:${roleColor(g.role)}">${esc(roleName(g.role))}</b></span>` : ''}
    <span class="flags">${ST.noclip ? '<em>NOCLIP</em>' : ''}${ST.speed !== 1 ? `<em>SPD×${ST.speed}</em>` : ''}${ST.nocd ? '<em>NOCD</em>' : ''}${ST.possess ? '<em>POSSESS</em>' : ''}${ST.rainbow ? '<em>RGB</em>' : ''}</span>`;
}

// ---------- 홈 ----------
const homeHTML = () => `<div class="md-home">${Object.entries(VIEWS).map(([k, [ko, en, d]]) => `<button class="md-tile" data-go="${k}">
  <i>${ICON[k]}</i><span><small>${en}_HACK</small><b>${ko}</b><em>${d}</em></span></button>`).join('')}</div>`;

// ---------- 공용 조각 ----------
const head = (p, sz = 48) => `<span class="md-head-ic" style="width:${sz}px">${crewSVG(p.look || { color: 0 }, { noPet: true, head: true })}</span>`;
const need = (ok, msg) => (ok ? '' : `<p class="md-warn">⚠ ${msg}</p>`);
const tog = (on, act, label, sub = '', dis = false) => `<button class="md-tog ${on ? 'on' : ''}" data-act="${act}" ${dis ? 'disabled' : ''}>
  <span class="md-sw"><i></i></span><span class="lb"><b>${label}</b>${sub ? `<em>${sub}</em>` : ''}</span><span class="st">${on ? 'ON' : 'OFF'}</span></button>`;
// 위험한 즉시 동작은 두 번 눌러야 실행
const danger = (act, label, sub, dis = false) => `<button class="md-danger ${ST.confirm === act ? 'arm' : ''}" data-act="${act}" ${dis ? 'disabled' : ''}>
  <span class="lb"><b>${ST.confirm === act ? '정말 실행할까요? 한 번 더 누르기' : label}</b><em>${sub}</em></span><span class="st">${ST.confirm === act ? '!!' : 'RUN'}</span></button>`;

// ---------- 계정 해킹 ----------
function accountHTML() {
  const g = game(), list = playersNow(), me2 = myId();
  if (!ST.pick || !list.some(p => p.id === ST.pick)) ST.pick = list.some(p => p.id === me2) ? me2 : list[0]?.id || null;
  return `<section class="md-sec"><h5><span>01</span>직업 해킹</h5>
    <div class="md-step">플레이어 고르기</div>
    ${g.inRoom ? `<div class="md-plist">${list.map(p => `<button class="md-pl ${p.id === ST.pick ? 'on' : ''}" data-pick="${esc(p.id)}" style="--pc:${COLORS[p.look?.color ?? 0]?.[1] || '#fff'}">
      ${head(p, 44)}<span>${esc(p.name)}${p.id === me2 ? ' <small>(나)</small>' : ''}</span>${p.role ? `<em style="color:${roleColor(p.role)}">${esc(roleName(p.role))}</em>` : ''}${p.dead ? '<em class="dead">죽음</em>' : ''}</button>`).join('')}</div>`
    : '<p class="md-warn">⚠ 방(로비)에 들어가면 플레이어를 고를 수 있습니다.</p>'}
    <div class="md-step">직업 고르기</div>
    <div class="md-rlist">${ROLES.map(r => `<button class="md-rl ${r === ST.role ? 'on' : ''}" data-role="${r}" style="--rc:${roleColor(r)}"><i>${ROLE_DEFS[r].icon || ''}</i><span>${esc(roleName(r))}</span></button>`).join('')}</div>
    <div class="md-row"><button class="md-go" data-act="role" ${g.inRoom && ST.pick && ST.role ? '' : 'disabled'}>직업 고르기 확인</button>
      <p class="md-hint">${g.inGame ? '게임 중이므로 바로 바뀝니다.' : '로비에서는 다음 게임을 이 직업으로 시작합니다.'}</p></div></section>
  <section class="md-sec"><h5><span>02</span>계정 레벨 해킹</h5>
    <div class="md-row"><label class="md-field"><span>현재 레벨 <b>${profile?.level ?? 1}</b></span><input class="md-in" type="number" inputmode="numeric" min="0" step="1" value="${profile?.level ?? 1}" data-f="level" data-enter="level"></label>
    <button class="md-go" data-act="level">레벨 바꾸기</button></div></section>`;
}

// ---------- 플레이어 해킹 ----------
function playerHTML() {
  const g = game(), imp = g.inGame && isImpRole(norm(g.role));
  return `<section class="md-sec"><h5><span>01</span>이동</h5><div class="md-grid">
    ${tog(ST.noclip, 'noclip', '벽뚫', '벽과 닫힌 문을 통과합니다')}
    <div class="md-card"><div class="lb"><b>속도</b><em>배율을 마음대로 (지금 ×${ST.speed})</em></div>
      <div class="md-row tight"><input class="md-in" type="number" step="0.25" min="0.05" value="${ST.speed}" data-f="speed" data-enter="speed"><button class="md-go sm" data-act="speed">적용</button><button class="md-go sm ghost" data-act="speed1">×1</button></div>
      <div class="md-chips">${[0.5, 1.5, 2, 3, 5, 10].map(v => `<button data-spd="${v}">×${v}</button>`).join('')}</div></div></div></section>
  <section class="md-sec"><h5><span>02</span>처치</h5><div class="md-grid">
    ${tog(ST.nocd, 'nocd', '임포스터면 쿨타임 없이 킬', imp ? '처치·방해 공작·능력 쿨다운 무시' : '임포스터일 때 처치 쿨다운을 무시합니다')}
    ${danger('killAll', '나빼고 모두 죽기', '나를 뺀 모든 플레이어를 처치합니다', !g.inGame)}</div>
    ${need(g.inGame, '나빼고 모두 죽기는 게임 중에만 쓸 수 있습니다.')}</section>
  <section class="md-sec"><h5><span>03</span>방 · 게임</h5><div class="md-grid">
    ${danger('kickAll', '나빼고 모두 추방(킥)', '방에 있는 다른 플레이어를 모두 내보냅니다', !g.inRoom)}
    ${danger('win', '승리', '지금 내 팀이 바로 이깁니다', !g.inGame)}</div>
    ${need(g.inRoom, '방에 들어가 있지 않습니다.')}</section>`;
}

// ---------- 설정 해킹 ----------
const ROOM_ROWS = [['maxPlayers', '최대 인원', 'i', 4, 15, 1, 15, '명']];
function createBase() { const d = defaultSettings(), s = LS.json(CREATE, {}); return { ...d, ...s, roleSet: mergeRS(d.roleSet, s.roleSet) }; }
function mergeRS(a = {}, b = {}) { const o = JSON.parse(JSON.stringify(a || {})); for (const [r, v] of Object.entries(b || {})) o[r] = { ...o[r], ...v }; return o; }
function setSource() {
  if (ST.target === 'create') return createBase();
  const s = game().settings;
  return s ? { ...defaultSettings(), ...s, roleSet: mergeRS(defaultSettings().roleSet, s.roleSet) } : null;
}
const numRow = (d, v, attrs) => `<label class="md-num"><span class="lb">${esc(d[1])}</span>
  <input class="md-in" type="number" step="any" value="${esc(v ?? '')}" ${attrs}><em>${esc(v === undefined || v === null || v === '' ? '' : fmtSetting(d, +v))}<small>기본 ${d[3]}~${d[4]}</small></em></label>`;
function settingsHTML() {
  const s = setSource(), g = game();
  const tgt = `<div class="md-seg"><button data-tgt="room" class="${ST.target === 'room' ? 'on' : ''}">현재 방 설정</button><button data-tgt="create" class="${ST.target === 'create' ? 'on' : ''}">방 만들 때 쓸 설정</button></div>`;
  if (!s) return `${tgt}${need(false, '방에 들어가 있지 않습니다. "방 만들 때 쓸 설정"을 바꾸면 다음에 만드는 방에 적용됩니다.')}`;
  const grp = (title, rows) => `<section class="md-sec"><h5><span>#</span>${esc(title)}</h5><div class="md-nums">${rows.map(d => numRow(d, s[d[0]], `data-k="${d[0]}"`)).join('')}</div></section>`;
  const cls = SETTING_GROUPS.map(gn => grp(gn, SETTINGS.filter(d => d[8] === gn))).join('');
  const hns = HNS_GROUPS.map(gn => grp(`숨바꼭질 · ${gn}`, HNS_SETTINGS.filter(d => d[8] === gn && d[2] !== 'p' && d[0] !== 'playerSpeed'))).join('');
  const roles = ROLE_ORDER.filter(r => ROLE_DEFS[r]).map(r => {
    const rs = s.roleSet?.[r] || {}, D = ROLE_DEFS[r];
    const rows = [['max', '인원수', 'i', 0, isImpRole(r) ? 3 : 15, 1, 0, '명'], ['chance', '확률', 'i', 0, 100, 10, 0, '%'], ...(D.opts || [])];
    return `<div class="md-rset" style="--rc:${D.accent || roleColor(r)}"><b>${D.icon || ''} ${esc(D.name)}</b><div class="md-nums">${rows.map(d => numRow(d, rs[d[0]] ?? d[6], `data-r="${r}" data-rk="${d[0]}"`)).join('')}</div></div>`;
  }).join('');
  const saved = Object.keys(LS.json(CREATE, {})).length;
  return `${tgt}<p class="md-hint">숫자를 직접 입력하세요. 범위 제한이 없습니다${ST.target === 'room' ? (g.inGame ? ' · 게임 중에도 바로 적용됩니다' : ' · 로비에 바로 적용됩니다') : ` · 저장된 값 ${saved}개 (mod 인증 상태에서 방을 만들면 적용)`}.</p>
    ${grp('방', ROOM_ROWS)}${cls}${hns}<section class="md-sec"><h5><span>#</span>역할 설정</h5>${roles}</section>
    <div class="md-sticky"><button class="md-go" data-act="setApply">${ST.target === 'room' ? '현재 방에 적용' : '저장'}</button><button class="md-go ghost" data-act="setReload">되돌리기</button>
    ${ST.target === 'create' ? '<button class="md-go ghost" data-act="setClear">저장값 지우기</button>' : ''}</div>`;
}
// 바뀐 칸만 모아 패치 만들기
function settingsPatch() {
  const s = setSource();
  if (!s) return null;
  const p = {};
  for (const inp of $$('.md-in[data-k]', body)) {
    const k = inp.dataset.k, v = inp.value.trim();
    if (v === '' || !Number.isFinite(+v)) continue;
    if (+v !== +s[k]) p[k] = +v;
  }
  for (const inp of $$('.md-in[data-r]', body)) {
    const r = inp.dataset.r, k = inp.dataset.rk, v = inp.value.trim();
    if (v === '' || !Number.isFinite(+v)) continue;
    const old = s.roleSet?.[r]?.[k] ?? (k === 'max' || k === 'chance' ? 0 : ROLE_DEFS[r]?.opts?.find(o => o[0] === k)?.[6]);
    if (+v !== +old) { p.roleSet ||= {}; (p.roleSet[r] ||= {})[k] = +v; }
  }
  return p;
}

// ---------- 시스템 해킹 ----------
function systemHTML() {
  const g = game(), list = playersNow().filter(p => p.id !== myId());
  const ms = Object.keys(curMap()?.sabotages || {}), sabs = g.inGame ? (ms.length ? ms : ST.sabs || []) : [];
  return `<section class="md-sec"><h5><span>01</span>맵 변경</h5><div class="md-maps">${MAPS.map(m => `<button class="md-map ${g.map === m.id ? 'on' : ''}" data-map="${m.id}" ${g.inRoom ? '' : 'disabled'}>
      <i>${mapIcon(m.id)}</i><b>${esc(m.name)}</b></button>`).join('')}</div>${need(g.inRoom, '방에 들어가 있지 않습니다.')}</section>
  <section class="md-sec"><h5><span>02</span>모든 아이템 얻기</h5><div class="md-row"><button class="md-go" data-act="items">모든 아이템 + 콩 100,000개 받기</button>
    <p class="md-hint">보유 아이템 ${profile?.owned?.length || 0}개 · 콩 ${(profile?.beans || 0).toLocaleString()}개</p></div></section>
  <section class="md-sec"><h5><span>03</span>다른 플레이어 시점으로 조작</h5>
    ${g.inRoom ? `<div class="md-plist">${list.map(p => `<button class="md-pl ${ST.possess === p.id ? 'on' : ''}" data-pos="${esc(p.id)}" style="--pc:${COLORS[p.look?.color ?? 0]?.[1] || '#fff'}">${head(p, 44)}<span>${esc(p.name)}</span>${p.dead ? '<em class="dead">죽음</em>' : ''}</button>`).join('') || '<p class="md-hint">다른 플레이어가 없습니다.</p>'}</div>
      <div class="md-row"><button class="md-go ghost" data-act="unpossess" ${ST.possess ? '' : 'disabled'}>조종 해제 (내 몸으로)</button><p class="md-hint">${ST.possess ? `지금 ${esc(nameOf(ST.possess))}님을 조종하는 중` : '고른 플레이어의 시점으로 바뀌고, 내 조작으로 그 플레이어가 움직입니다.'}</p></div>`
    : need(false, '방에 들어가 있지 않습니다.')}</section>
  <section class="md-sec"><h5><span>04</span>색 계속 바뀌기</h5><div class="md-seg wide">
    <button data-rgb="me" class="${ST.rainbow === 'me' ? 'on' : ''}" ${g.inRoom ? '' : 'disabled'}>나</button><button data-rgb="all" class="${ST.rainbow === 'all' ? 'on' : ''}" ${g.inRoom ? '' : 'disabled'}>모두</button><button data-rgb="off" class="${!ST.rainbow ? 'on' : ''}" ${g.inRoom ? '' : 'disabled'}>끄기</button></div></section>
  <section class="md-sec"><h5><span>05</span>문 · 긴급상황</h5><div class="md-grid">
    <button class="md-act" data-act="doors" ${g.inGame ? '' : 'disabled'}><b>🚪 모든 문 닫기</b><em>맵의 모든 문을 한꺼번에 닫습니다</em></button>
    <button class="md-act red" data-act="meeting" ${g.inGame ? '' : 'disabled'}><b>📢 긴급 회의</b><em>지금 바로 긴급 회의를 엽니다</em></button>
    ${sabs.map(k => `<button class="md-act red" data-sab="${esc(k)}"><b>⚠ ${esc(sabName(k))}</b><em>${esc(sabDesc(k))}</em></button>`).join('')}</div>
    ${need(g.inGame, '문 닫기와 긴급상황은 게임 중에만 쓸 수 있습니다.')}${g.inGame && !sabs.length ? '<p class="md-hint">이 맵에는 방해 공작이 없습니다.</p>' : ''}</section>`;
}
const sabDesc = k => { const t = curMap()?.sabotages?.[k]?.type; return t === 'critical' ? '치명적 방해 공작 (시간 안에 못 고치면 임포스터 승리)' : t === 'lights' ? '크루원 시야를 줄입니다' : t === 'comms' ? '임무 목록·카메라·관리실을 막습니다' : t === 'mixup' ? '모두의 모습이 뒤섞입니다' : '방해 공작'; };

// ---------- 입력 ----------
body.addEventListener('input', e => { const f = e.target.dataset?.f; if (f) ST.drafts[f] = e.target.value; });
body.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  sfx('click');
  if (d.go) return go(d.go);
  if (d.pick) { ST.pick = d.pick; return render(); }
  if (d.role) { ST.role = d.role; return render(); }
  if (d.tgt) { ST.target = d.tgt; return render(); }
  if (d.spd) { const i = $('.md-in[data-f=speed]', body); if (i) i.value = d.spd; return act('speed'); }
  if (d.map) return send({ a: 'map', id: d.map });
  if (d.pos) { try { api()?.possess?.(d.pos); } catch { send({ a: 'possess', id: d.pos }); } return; }
  if (d.rgb) return send({ a: 'rainbow', on: d.rgb !== 'off', target: d.rgb === 'all' ? 'all' : 'me' });
  if (d.sab) return send({ a: 'sab', k: d.sab });
  if (d.act) act(d.act);
});
function act(a) {
  const val = f => { const i = $(`.md-in[data-f=${f}]`, body); return i ? i.value.trim() : ''; };
  // 두 번 눌러야 하는 동작
  if (['killAll', 'kickAll', 'win'].includes(a)) {
    if (ST.confirm !== a) { ST.confirm = a; render(); clearTimeout(act.t); act.t = setTimeout(() => { if (ST.confirm === a) { ST.confirm = null; render(); } }, 3000); return; }
    ST.confirm = null; render();
    return send({ a });
  }
  switch (a) {
    case 'role': if (ST.pick && ST.role) send({ a: 'role', id: ST.pick, role: ST.role }); return;
    case 'level': {
      const v = Math.round(+val('level'));
      if (!val('level') || !Number.isFinite(v)) return note('숫자를 입력하세요', 'bad');
      profile.level = Math.max(0, Math.min(1e9, v)); profile.xp = 0; saveProfile();
      try { MENU.updateTop?.(); } catch { /* 메뉴 없음 */ }
      if (!net.open) { delete ST.drafts.level; note(`레벨이 ${profile.level}${ro(profile.level)} 바뀌었습니다`); render(); return; }
      delete ST.drafts.level;
      send({ a: 'level', v: profile.level });
      return;
    }
    case 'noclip': ST.noclip = !ST.noclip; applyLocal(); render(); send({ a: 'noclip', on: ST.noclip }); return;
    case 'nocd': ST.nocd = !ST.nocd; render(); send({ a: 'nocd', on: ST.nocd }); return;
    case 'speed': case 'speed1': {
      const v = a === 'speed1' ? 1 : +val('speed');
      if (!Number.isFinite(v) || v <= 0) return note('0보다 큰 숫자를 입력하세요', 'bad');
      delete ST.drafts.speed;
      ST.speed = v; applyLocal(); render(); send({ a: 'speed', v });
      return;
    }
    case 'setApply': {
      const p = settingsPatch();
      if (!p || !Object.keys(p).length) return note('바뀐 값이 없습니다', 'bad');
      if (ST.target === 'room') { if (game().inRoom) send({ a: 'settings', s: p }); else note('방에 들어가 있지 않습니다', 'bad'); return; }
      const cur = LS.json(CREATE, {});
      const next = { ...cur, ...p, ...(p.roleSet || cur.roleSet ? { roleSet: mergeRS(cur.roleSet, p.roleSet) } : {}) };
      LS.set(CREATE, JSON.stringify(next));
      note(`방 만들 때 쓸 설정을 저장했습니다 (${Object.keys(p).length + (p.roleSet ? Object.keys(p.roleSet).length - 1 : 0)}개)`);
      render();
      return;
    }
    case 'setReload': render(); return;
    case 'setClear': LS.del(CREATE); note('저장된 값을 지웠습니다'); render(); return;
    case 'items': {
      const all = new Set(profile.owned || []);
      for (const [type, list] of Object.entries(ITEMS)) for (const it of list) if (it[3] !== 'free') all.add(`${type}:${it[0]}`);
      profile.owned = [...all]; profile.beans = (+profile.beans || 0) + 100000; saveProfile();
      try { MENU.updateTop?.(); } catch { /* 메뉴 없음 */ }
      sfx('win'); note('모든 아이템을 얻었습니다! (+콩 100,000)'); render();
      return;
    }
    case 'unpossess': try { api()?.possess?.(null); } catch { send({ a: 'possess', id: null }); } return;
    case 'doors': send({ a: 'doors' }); return;
    case 'meeting': send({ a: 'meeting' }); return;
  }
}
// 창이 열려 있으면 상태 줄을 1초마다 갱신
setInterval(() => { if (ST.open) foot(); }, 1000);
// 저장된 key 가 있으면 일단 버튼을 보여 주고, 서버가 아니라고 하면(hello 응답) 숨김
setAuthed(!!LS.get(KEY));
