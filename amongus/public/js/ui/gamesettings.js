// 로비 게임 설정 창 (원작 2024+ 로비 UI)
// 주최자(편집): 게임 프리셋 / 게임 설정 / 역할 설정(클래식) — 보기 전용: 개요 / 역할
// openGameSettings({ settings, editable, onChange(patch), players? }) → { refresh(settings), close() }
import { $, h, esc, stage, sfx } from '../core.js';
import { SETTINGS, SETTING_GROUPS, HNS_SETTINGS, HNS_GROUPS, MAPS, CUSTOM, PRESET_DESC, presetNames, fmtSetting, maxImpostors } from '../shared/data.js';
import { ROLE_DEFS, ROLE_ORDER, ROLE_SET_RANGE, isImpRole, isGhostRole } from '../shared/roles.js';
import { crewSVG, mapIcon } from './crew.js';

// 행 설명 (오른쪽 아래 정보 상자)
const HINT = {
  impostors: '게임마다 임포스터가 몇 명일지 정합니다. 임포스터 2명은 7명 이상, 3명은 9명 이상이 필요합니다.',
  killCooldown: '임포스터가 한 번 처치한 뒤 다시 처치할 수 있을 때까지의 시간입니다.',
  impVision: '임포스터가 볼 수 있는 거리입니다. 조명이 고장 나도 줄어들지 않습니다.',
  killDistance: '임포스터가 처치할 수 있는 거리입니다.',
  playerSpeed: '모든 플레이어의 이동 속도입니다.',
  crewVision: '크루원이 볼 수 있는 거리입니다. 조명이 고장 나면 줄어듭니다.',
  emergencyMeetings: '플레이어 한 명이 긴급 버튼을 누를 수 있는 횟수입니다.',
  emergencyCooldown: '게임이 시작되거나 회의가 끝난 뒤 긴급 버튼을 다시 쓸 수 있을 때까지의 시간입니다.',
  discussionTime: '회의가 시작되고 투표할 수 있게 될 때까지의 토론 시간입니다.',
  votingTime: '투표할 수 있는 시간입니다.',
  anonVotes: '켜면 누가 누구에게 투표했는지 보이지 않습니다.',
  confirmEjects: '켜면 방출된 플레이어가 임포스터였는지 알려 줍니다.',
  taskBar: '전체 임무 진행 게이지가 언제 갱신될지 정합니다.',
  visualTasks: '켜면 의무실 스캔 같은 일부 임무를 하는 모습이 다른 플레이어에게 보입니다.',
  commonTasks: '모든 크루원이 똑같이 받는 임무 수입니다.',
  longTasks: '시간이 오래 걸리는 임무 수입니다.',
  shortTasks: '금방 끝나는 임무 수입니다.',
  seeker: '술래(임포스터)를 무작위로 정하거나 직접 지정합니다.',
  hnsImpVision: '술래가 볼 수 있는 거리입니다.',
  impLight: '손전등 모드에서 술래 손전등의 크기입니다.',
  hnsCrewVision: '크루원이 볼 수 있는 거리입니다.',
  hideTime: '크루원이 버텨야 하는 주 타이머입니다. 임무를 완료할 때마다 줄어듭니다.',
  flashlight: '켜면 시야가 손전등처럼 바라보는 방향으로만 비춥니다.',
  crewLight: '손전등 모드에서 크루원 손전등의 크기입니다.',
  ventUses: '크루원 한 명이 환풍구에 들어갈 수 있는 횟수입니다.',
  ventTime: '크루원이 환풍구 안에 머무를 수 있는 최대 시간입니다.',
  showNames: '켜면 플레이어 이름이 보입니다.',
  finalTime: '주 타이머가 끝난 뒤 이어지는 마지막 숨기 시간입니다.',
  finalSpeed: '마지막 숨기 동안 술래의 속도 배율입니다.',
  finalMap: '마지막 숨기 동안 술래가 크루원 위치가 표시된 지도를 볼 수 있습니다.',
  finalPings: '마지막 숨기 동안 크루원 위치에 주기적으로 핑이 표시됩니다.',
  pingInterval: '핑이 표시되는 간격입니다.',
  hnsCommon: '모든 크루원이 똑같이 받는 임무 수입니다.', hnsLong: '시간이 오래 걸리는 임무 수입니다.', hnsShort: '금방 끝나는 임무 수입니다.',
  maxPlayers: '이 로비에 들어올 수 있는 최대 인원입니다.', map: '플레이할 맵을 고릅니다.', gameType: '클래식과 숨바꼭질 중에서 고릅니다.',
};
const TAB_INFO = {
  preset: ['게임 프리셋', '프리셋을 골라 로비를 빠르게 설정합니다. 설정을 바꾸면 "맞춤 설정"이 됩니다.'],
  game: ['게임 설정', '게임 로비의 개별 설정을 편집합니다.'],
  roles: ['역할 설정', '각 역할의 인원수와 등장 확률, 세부 설정을 편집합니다. 임포스터 역할은 임포스터 자리를 대신합니다.'],
  over: ['개요', '이 로비의 현재 게임 설정입니다. 주최자만 바꿀 수 있습니다.'],
  rview: ['역할', '이 로비에서 나올 수 있는 역할과 확률입니다.'],
};
const GROUP_COLOR = { 임포스터: '#ff3b3b', 크루원: '#45d7f0', 회의: '#ffcf3d', 임무: '#5fdc6a', '마지막 숨기': '#c584ff' };
const TAB_ICON = {
  preset: '<svg viewBox="0 0 40 40"><rect x="5" y="7" width="30" height="7" rx="3"/><rect x="5" y="17" width="30" height="7" rx="3" opacity=".7"/><rect x="5" y="27" width="30" height="7" rx="3" opacity=".45"/></svg>',
  game: '<svg viewBox="0 0 40 40"><path d="M6 11H34M6 20H34M6 29H34" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="14" cy="11" r="4.5"/><circle cx="26" cy="20" r="4.5"/><circle cx="17" cy="29" r="4.5"/></svg>',
  roles: '<svg viewBox="0 0 40 40"><path d="M9 34V18C9 10 13 6 19 6C25 6 29 10 29 17V34Z"/><rect x="18" y="11" width="15" height="9" rx="4.5" fill="#9fe7ff" stroke="#000" stroke-width="2"/></svg>',
  over: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="20" cy="13" r="2.6"/><rect x="17.6" y="18" width="4.8" height="12" rx="2"/></svg>',
};
TAB_ICON.rview = TAB_ICON.roles;

const ROLE_MAX = r => (isImpRole(r) ? ROLE_SET_RANGE.impMax : ROLE_SET_RANGE.max);
const MAX_DEF = r => { const [a, b, c] = ROLE_MAX(r); return ['max', '인원수', 'i', a, b, c, 0, '']; };
const CHANCE_DEF = ['chance', '확률', 'i', ...ROLE_SET_RANGE.chance, 0, '%'];
const PLAYERS_DEF = ['maxPlayers', '최대 인원', 'i', 4, 15, 1, 15, '명'];
const MIN_FOR_IMP = [0, 4, 7, 9];
const fmt = (d, v) => (v === undefined || v === null || v === '' ? '-' : fmtSetting(d, v));
const num = v => (Number.isFinite(+v) ? +v : 0);
// − / + 한 칸 (범위 밖 값은 범위 안으로 돌아옴)
function stepVal(d, v, dir) {
  const [, , t, min, max, step] = d;
  if (t === 'b') return v ? 0 : 1;
  let n = num(v) + step * dir;
  n = Math.min(max, Math.max(min, Math.round((n - min) / step) * step + min));
  return t === 'f' ? +n.toFixed(3) : Math.round(n);
}
const roleRS = (s, r) => s.roleSet?.[r] || {};
const roleVal = (s, r, k) => { const v = roleRS(s, r)[k]; if (v !== undefined && v !== null) return v; return ROLE_DEFS[r]?.opts?.find(o => o[0] === k)?.[6] ?? 0; };
const roleIcon = r => `<i class="gs2-ric" style="--ac:${ROLE_DEFS[r]?.accent || '#fff'}">${ROLE_DEFS[r]?.icon || '?'}</i>`;

let open = null; // 한 번에 하나만

export function openGameSettings({ settings, editable = false, onChange = () => {}, players = null } = {}) {
  open?.close();
  let cur = clone(settings || {}), tab = editable ? 'preset' : 'over', closed = false, playMod = null;
  const expanded = new Set();
  const back = h(`<div class="modal-back gs2-back"><div class="gs2 ${editable ? 'ed' : 'view'}">
    <div class="gs2-side"><div class="gs2-title">${editable ? '게임 설정' : '로비 설정'}</div><div class="gs2-tabs"></div>
      <div class="gs2-info"><b></b><p></p></div></div>
    <div class="gs2-main"><div class="gs2-head"><h3></h3><span class="gs2-pre"></span><button class="gs2-x" aria-label="닫기">✕</button></div><div class="gs2-scroll"></div></div>
  </div></div>`);
  stage().append(back);
  const panel = $('.gs2', back), scroll = $('.gs2-scroll', back), info = $('.gs2-info', back);
  const hns = () => cur.gameType === 'hns';
  const tabs = () => (editable ? ['preset', 'game', ...(hns() ? [] : ['roles'])] : ['over', ...(hns() ? [] : ['rview'])]);
  const setInfo = (t, p) => { $('b', info).textContent = t; $('p', info).textContent = p; };

  // 플레이어 목록 (숨바꼭질 술래 지정용): 주어지지 않으면 지금 방 상태에서 읽기
  const plistNow = () => players || playMod?.G?.S?.room?.players || [];
  if (!players) import('../game/play.js').then(m => { playMod = m; if (!closed && hns()) draw(); }).catch(() => {});

  const send = patch => { try { onChange(patch); } catch (e) { console.warn(e); } };
  // 바꾼 값을 바로 보여 주고(서버 응답이 오면 refresh 로 덮어씀) 서버에 보냄
  const change = patch => {
    sfx('click');
    if (patch.roleSet) { cur.roleSet = clone(cur.roleSet || {}); for (const [r, o] of Object.entries(patch.roleSet)) cur.roleSet[r] = { ...cur.roleSet[r], ...o }; }
    for (const [k, v] of Object.entries(patch)) if (k !== 'roleSet' && k !== 'preset') cur[k] = v;
    send(patch);
    draw();
  };

  // ---------- 행 HTML ----------
  const stepper = (d, v, attrs) => {
    if (!editable) return `<b class="gs2-val">${esc(fmt(d, v))}</b>`;
    if (d[2] === 'b') return `<button class="gs2-chk ${v ? 'on' : ''}" ${attrs} data-d="1" aria-label="${v ? '켬' : '끔'}"><i></i></button>`;
    const lo = num(v) <= d[3], hi = num(v) >= d[4];
    return `<div class="gs2-step"><button class="m" ${attrs} data-d="-1" ${lo ? 'disabled' : ''}>−</button><b class="gs2-val">${esc(fmt(d, v))}</b><button class="p" ${attrs} data-d="1" ${hi ? 'disabled' : ''}>+</button></div>`;
  };
  const row = (d, v, attrs, hint, extra = '') => `<div class="gs2-row" data-hint="${esc(hint || '')}" data-lb="${esc(d[1])}"><span class="gs2-lb">${esc(d[1])}${extra}</span>${stepper(d, v, attrs)}</div>`;
  // 숨바꼭질 술래 지정: 무작위 또는 플레이어
  const seekerRow = d => {
    const list = plistNow(), id = cur.seeker || '', p = list.find(x => x.id === id);
    const val = p ? `${crewSVG(p.look || {}, { noPet: true, head: true })}<span>${esc(p.name)}</span>` : `<span>${id ? '지정됨' : '무작위'}</span>`;
    const ctl = editable && list.length
      ? `<div class="gs2-step wide"><button class="m" data-seek="-1">‹</button><b class="gs2-val who">${val}</b><button class="p" data-seek="1">›</button></div>`
      : `<b class="gs2-val who">${val}</b>`;
    return `<div class="gs2-row" data-hint="${esc(HINT.seeker)}" data-lb="${esc(d[1])}"><span class="gs2-lb">${esc(d[1])}</span>${ctl}</div>`;
  };
  const impNote = () => {
    const n = num(cur.impostors), need = MIN_FOR_IMP[Math.min(3, Math.max(0, Math.round(n)))] || 0;
    const warn = maxImpostors(num(cur.maxPlayers) || 15) < n;
    return need > 4 ? `<small class="gs2-note ${warn ? 'warn' : ''}">최소 ${need}명 필요</small>` : '';
  };
  const groupsHTML = () => {
    const rows = hns() ? HNS_SETTINGS : SETTINGS, groups = hns() ? HNS_GROUPS : SETTING_GROUPS;
    return groups.map(g => {
      const list = rows.filter(d => d[8] === g && !(hns() && !cur.flashlight && /Light$/.test(d[0])));
      if (!list.length) return '';
      return `<section class="gs2-grp" style="--gc:${GROUP_COLOR[g] || '#4fd9c4'}"><h4>${esc(g)}</h4>${list.map(d =>
        d[2] === 'p' ? seekerRow(d) : row(d, cur[d[0]] ?? d[6], `data-k="${d[0]}"`, HINT[d[0]], d[0] === 'impostors' ? impNote() : '')).join('')}</section>`;
    }).join('');
  };

  // ---------- 탭: 게임 프리셋 ----------
  const presetHTML = () => {
    const names = presetNames(cur.gameType), custom = cur.preset === CUSTOM || !names.includes(cur.preset);
    return `<section class="gs2-grp" style="--gc:#4fd9c4"><h4>방 설정</h4>
      <div class="gs2-row" data-hint="${esc(HINT.gameType)}" data-lb="게임 유형"><span class="gs2-lb">게임 유형</span>
        <div class="gs2-seg">${[['classic', '클래식'], ['hns', '숨바꼭질']].map(([k, l]) => `<button data-gt="${k}" class="${cur.gameType === k || (k === 'classic' && !hns()) ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      ${row(PLAYERS_DEF, cur.maxPlayers ?? 15, 'data-k="maxPlayers"', HINT.maxPlayers)}
      <div class="gs2-maps" data-hint="${esc(HINT.map)}" data-lb="맵">${MAPS.map(m => `<button class="gs2-map ${cur.map === m.id ? 'on' : ''}" data-map="${m.id}">
        <span class="mi">${mapIcon(m.id)}</span><b>${esc(m.name)}</b><small>${esc(m.ko)}</small></button>`).join('')}</div></section>
      <section class="gs2-grp" style="--gc:#ffcf3d"><h4>프리셋</h4><div class="gs2-presets">
      ${names.map(p => `<button class="gs2-preset ${cur.preset === p ? 'on' : ''}" data-pre="${esc(p)}"><b>${esc(p)}</b><p>${esc(PRESET_DESC[p] || '')}</p>${cur.preset === p ? '<i class="tag">사용 중</i>' : ''}</button>`).join('')}
      <div class="gs2-preset custom ${custom ? 'on' : ''}"><b>${esc(CUSTOM)}</b><p>설정을 하나라도 바꾸면 자동으로 맞춤 설정이 됩니다.</p>${custom ? '<i class="tag">사용 중</i>' : ''}</div></div></section>`;
  };

  // ---------- 탭: 역할 설정 ----------
  const roleRow = r => {
    const D = ROLE_DEFS[r], rs = roleRS(cur, r), mx = num(rs.max), ch = num(rs.chance), on = mx > 0 && ch > 0, ex = expanded.has(r);
    const opts = D.opts || [];
    return `<div class="gs2-role ${on ? 'on' : ''} ${ex ? 'ex' : ''}" data-role="${r}" style="--ac:${D.accent || D.color}">
      <div class="gs2-rhead" data-hint="${esc(`${D.blurb || ''} — ${D.desc || ''}`)}" data-lb="${esc(D.name)}">
        <button class="gs2-rname" data-exp="${r}">${roleIcon(r)}<span><b>${esc(D.name)}</b>${isGhostRole(r) ? '<em>유령</em>' : ''}</span><i class="car">${opts.length ? '▾' : ''}</i></button>
        ${stepper(MAX_DEF(r), mx, `data-r="${r}" data-f="max"`)}${stepper(CHANCE_DEF, ch, `data-r="${r}" data-f="chance"`)}</div>
      ${ex ? `<div class="gs2-ropts"><div class="gs2-rdesc">${roleIcon(r)}<div><b>${esc(D.blurb || D.name)}</b><p>${esc(D.desc || '')}</p></div></div>
        ${opts.length ? opts.map(o => row(o, roleVal(cur, r, o[0]), `data-r="${r}" data-o="${o[0]}"`, D.desc)).join('') : '<p class="gs2-none">세부 설정이 없습니다.</p>'}</div>` : ''}</div>`;
  };
  const rolesHTML = () => {
    const crew = ROLE_ORDER.filter(r => ROLE_DEFS[r] && !isImpRole(r)), imp = ROLE_ORDER.filter(r => ROLE_DEFS[r] && isImpRole(r));
    const sec = (title, list, color) => `<section class="gs2-grp roles" style="--gc:${color}"><h4>${title}<span class="cols"><span>인원수</span><span>확률</span></span></h4>${list.map(roleRow).join('')}</section>`;
    return `<div class="gs2-rstrip">${[...crew, ...imp].map(r => `<button data-jump="${r}" class="${roleRS(cur, r).max > 0 && roleRS(cur, r).chance > 0 ? 'on' : ''}" title="${esc(ROLE_DEFS[r].name)}" style="--ac:${ROLE_DEFS[r].accent}">${ROLE_DEFS[r].icon}</button>`).join('')}</div>
      ${sec('크루원 역할', crew, '#45d7f0')}${sec('임포스터 역할', imp, '#ff3b3b')}`;
  };

  // ---------- 탭: 개요 (보기 전용) ----------
  const overHTML = () => {
    const m = MAPS.find(x => x.id === cur.map) || MAPS[0];
    return `<div class="gs2-cards">
      <div class="gs2-card map"><span class="mi">${mapIcon(m.id)}</span><small>맵</small><b>${esc(m.name)}</b></div>
      <div class="gs2-card"><small>게임 유형</small><b>${hns() ? '숨바꼭질' : '클래식'}</b></div>
      <div class="gs2-card"><small>프리셋</small><b>${esc(cur.preset || '핵심 설정')}</b></div>
      <div class="gs2-card"><small>최대 인원</small><b>${num(cur.maxPlayers) || 15}명</b></div></div>${groupsHTML()}`;
  };

  // ---------- 그리기 ----------
  function draw() {
    if (closed) return;
    if (!tabs().includes(tab)) tab = tabs()[0];
    $('.gs2-tabs', back).innerHTML = tabs().map(t => `<button class="gs2-tab ${t === tab ? 'on' : ''}" data-tab="${t}"><i>${TAB_ICON[t]}</i><span>${TAB_INFO[t][0]}</span></button>`).join('');
    $('h3', back).textContent = TAB_INFO[tab][0];
    const pre = $('.gs2-pre', back);
    pre.innerHTML = `<small>프리셋</small> ${esc(cur.preset || '핵심 설정')}`;
    pre.classList.toggle('custom', cur.preset === CUSTOM);
    const top = scroll.scrollTop;
    scroll.innerHTML = tab === 'preset' ? presetHTML() : tab === 'game' || tab === 'over' ? (tab === 'over' ? overHTML() : groupsHTML()) : rolesHTML();
    scroll.scrollTop = top;
    panel.classList.toggle('hns', hns());
    if (!info.dataset.hold) setInfo(...TAB_INFO[tab]);
  }

  // ---------- 입력 ----------
  back.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (b.classList.contains('gs2-x')) { sfx('click'); api.close(); return; }
    if (d.tab) { sfx('click'); tab = d.tab; scroll.scrollTop = 0; delete info.dataset.hold; draw(); return; }
    if (d.exp !== undefined) { sfx('click'); expanded.has(d.exp) ? expanded.delete(d.exp) : expanded.add(d.exp); draw(); return; }
    if (d.jump) {
      sfx('click'); expanded.add(d.jump); draw();
      const el = $(`.gs2-role[data-role="${d.jump}"]`, scroll);
      if (el) scroll.scrollTop = el.offsetTop - 70;
      return;
    }
    if (!editable) return;
    if (d.gt) { if (d.gt !== cur.gameType) change({ gameType: d.gt }); return; }
    if (d.map) { if (d.map !== cur.map) change({ map: d.map }); return; }
    if (d.pre) { if (d.pre !== cur.preset) pickPreset(d.pre); return; }
    if (d.seek) {
      const ids = ['', ...plistNow().map(p => p.id)], i = Math.max(0, ids.indexOf(cur.seeker || ''));
      change({ seeker: ids[(i + +d.seek + ids.length) % ids.length] });
      return;
    }
    const dir = +d.d;
    if (!dir) return;
    if (d.k) {
      const def = d.k === 'maxPlayers' ? PLAYERS_DEF : [...SETTINGS, ...HNS_SETTINGS].find(x => x[0] === d.k);
      if (def) change({ [d.k]: stepVal(def, cur[d.k] ?? def[6], dir) });
    } else if (d.r && d.f) {
      const def = d.f === 'max' ? MAX_DEF(d.r) : CHANCE_DEF, rs = roleRS(cur, d.r);
      let v = stepVal(def, rs[d.f] ?? 0, dir);
      const patch = { [d.f]: v };
      // 원작처럼: 인원수를 올리면 확률이 0일 때 자동으로 확률을 채움
      if (d.f === 'max' && v > 0 && !num(rs.chance)) patch.chance = 100;
      change({ roleSet: { [d.r]: patch } });
    } else if (d.r && d.o) {
      const def = ROLE_DEFS[d.r]?.opts?.find(o => o[0] === d.o);
      if (def) change({ roleSet: { [d.r]: { [d.o]: stepVal(def, roleVal(cur, d.r, d.o), dir) } } });
    }
  });
  // 행에 마우스를 올리면 설명 표시
  back.addEventListener('pointerover', e => {
    const r = e.target.closest('[data-hint]');
    if (r && r.dataset.hint) { info.dataset.hold = '1'; setInfo(r.dataset.lb || '', r.dataset.hint); }
  });
  scroll.addEventListener('pointerleave', () => { delete info.dataset.hold; setInfo(...TAB_INFO[tab]); });

  // 프리셋 바꾸기: 맞춤 설정을 덮어쓰기 전에 경고 (원작 "경고!")
  function pickPreset(p) {
    sfx('click');
    if (cur.preset !== CUSTOM) { send({ preset: p }); return; }
    const w = h(`<div class="gs2-warn"><div class="box"><h4>경고!</h4><p>게임 설정에서 바꾼 내용이 선택한 프리셋으로 덮어씌워집니다!</p>
      <div class="row-c"><button class="obtn go">그래도 계속하기</button><button class="obtn no">돌아가기</button></div></div></div>`);
    panel.append(w);
    $('.go', w).onclick = () => { sfx('click'); w.remove(); send({ preset: p }); };
    $('.no', w).onclick = () => { sfx('click'); w.remove(); };
  }

  const onKey = e => {
    if (!back.isConnected) { api.close(); return; } // 다른 코드가 화면을 지웠으면 정리만
    if (e.key === 'Escape') { e.stopPropagation(); api.close(); }
  };
  addEventListener('keydown', onKey, true);

  const api = {
    refresh(s) { if (closed || !s) return; cur = clone(s); draw(); },
    close() {
      if (closed) return;
      closed = true; back.remove(); removeEventListener('keydown', onKey, true);
      if (open === api) open = null;
    },
    get el() { return back; },
  };
  open = api;
  draw();
  return api;
}

function clone(o) { try { return JSON.parse(JSON.stringify(o || {})); } catch { return { ...o }; } }
