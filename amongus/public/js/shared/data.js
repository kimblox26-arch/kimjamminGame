// 서버와 클라이언트가 함께 쓰는 게임 데이터
import { ROLE_DEFS, ROLE_ORDER, ROLE_SET_RANGE, ROLES_GALORE, defaultRoleSet, isImpRole } from './roles.js';

export const VERSION = 'v19.0.0 (build num: 2026.9.29)';

const rnd = n => Math.floor(Math.random() * n);
export const pick = a => a[rnd(a.length)];
export const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// [이름, 몸 색, 그림자 색]
export const COLORS = [
  ['빨강', '#C51111', '#7A0838'], ['파랑', '#132ED1', '#09158E'], ['초록', '#117F2D', '#0A4D2E'], ['분홍', '#ED54BA', '#AB2BAD'],
  ['주황', '#EF7D0D', '#B33E15'], ['노랑', '#F5F557', '#C38823'], ['검정', '#3F474E', '#1E1F26'], ['하양', '#D6E0F0', '#8394BF'],
  ['보라', '#6B2FBB', '#3B177C'], ['갈색', '#71491E', '#5E2615'], ['청록', '#38FEDC', '#24A8BE'], ['라임', '#50EF39', '#15A742'],
  ['적갈', '#6B2B3C', '#41192A'], ['장미', '#ECC0D3', '#DE92B3'], ['바나나', '#FFFEBE', '#D2BC89'], ['회색', '#708496', '#475870'],
  ['황갈', '#928776', '#51413E'], ['산호', '#EC7578', '#B4436C'],
];

// 꾸미기 아이템 [id, 이름, 가격(콩), 획득 방법: free | shop | code]
export const ITEMS = {
  hat: [['none', '없음', 0, 'free'], ['tophat', '실크햇', 0, 'free'], ['cap', '야구 모자', 0, 'free'], ['flower', '꽃', 0, 'free'],
    ['beanie', '비니', 100, 'shop'], ['chef', '요리사 모자', 150, 'shop'], ['cowboy', '카우보이 모자', 200, 'shop'], ['police', '경찰 모자', 200, 'shop'],
    ['pumpkin', '호박', 100, 'shop'], ['mushroom', '버섯 모자', 250, 'shop'], ['crown', '왕관', 300, 'shop'], ['halo', '천사 고리', 300, 'shop'],
    ['horns', '악마 뿔', 300, 'shop'], ['party', '파티 모자', 0, 'code'], ['cone', '보라 교통체증 모자', 0, 'code']],
  visor: [['none', '없음', 0, 'free'], ['shades', '선글라스', 0, 'free'], ['blush', '볼터치', 0, 'free'], ['monocle', '외알 안경', 150, 'shop'], ['mask', '하키 마스크', 200, 'shop']],
  skin: [['none', '없음', 0, 'free'], ['suit', '정장', 200, 'shop'], ['police', '경찰복', 200, 'shop'], ['doctor', '의사 가운', 150, 'shop'], ['cape', '고스트 망토', 250, 'shop']],
  pet: [['none', '없음', 0, 'free'], ['mini', '미니 크루원', 0, 'free'], ['dog', '강아지', 300, 'shop'], ['hamster', '햄스터', 200, 'shop'], ['ufo', 'UFO', 250, 'shop'], ['ghost', '꼬마 유령', 0, 'code']],
  plate: [['none', '기본', 0, 'free'], ['space', '우주', 0, 'free'], ['mint', '민트', 100, 'shop'], ['night', '밤하늘', 150, 'shop'], ['candy', '사탕', 0, 'code']],
};
export const ITEM_TABS = [['hat', '모자'], ['visor', '바이저'], ['skin', '스킨'], ['pet', '애완동물'], ['plate', '명판']];
// 보상 교환 코드
export const REDEEM = { IMPOSTORMOON: ['hat', 'cone'], HAPPY8TH: ['hat', 'party'], GHOST2026: ['pet', 'ghost'], SWEETCANDY: ['plate', 'candy'] };

// 맵 (id 는 shared/maps/index.js 레지스트리와 같음)
export const MAPS = [
  { id: 'skeld', name: 'THE SKELD', ko: '더 스켈드', ready: true }, { id: 'mira', name: 'MIRA HQ', ko: '미라 HQ', ready: true },
  { id: 'polus', name: 'POLUS', ko: '폴러스', ready: true }, { id: 'airship', name: 'THE AIRSHIP', ko: '에어십', ready: true },
  { id: 'fungle', name: 'THE FUNGLE', ko: '펑글', ready: true },
];
export const REGIONS = [['na', '북미'], ['eu', '유럽'], ['as', '아시아']];
export const TAGS = ['없음', '초보자', '중급자', '전문가'];
export const CHAT_LANGS = ['English', 'Español (Latam)', 'Português (BR)', 'Português', '한국어', 'Русский', 'Nederlands', 'Bisaya', 'Français',
  'Deutsch', 'Italiano', '日本語', 'Español', 'Al Arabiya', 'Polski', '简体中文', '繁體中文', 'Gaeilge', '기타'];
export const KO = 4; // 한국어 인덱스 → 아시아 서버

// 공용 규칙 수치 (월드 단위: 1 유니티 단위 ≈ 160)
export const RULES = {
  speed: 430, ghostSpeed: 1.2, vision: 560,
  killDist: [160, 290, 400], hnsKillDist: 100, reportDist: 800, useDist: 230, ventDist: 220, targetDist: 320, buttonDist: 330,
  sabCd: 30, sabStartCd: 10, doorCd: 30, killStart: 10, hnsKillCd: 1, hnsLead: 10, hnsSeekerSpeed: 1.25, hnsPingShow: 2,
  introMs: 4500, spawnPickMs: 10000, meetIntro: 3500, resultMs: 5000, ejectMs: 7000, detectiveMeetingCd: 10,
};
export const KILL_DIST = RULES.killDist;

// 게임 설정 행: [키, 라벨, 종류(i 정수/f 실수/e 선택/b 켬끔/p 플레이어), 최소, 최대, 간격, 기본값, 단위 또는 선택지, 그룹, 0일 때 표시]
// 각 행은 .key .label .type .min .max .step .def .unit .group 속성으로도 읽을 수 있다.
const row = a => Object.assign(a, { key: a[0], label: a[1], type: a[2], min: a[3], max: a[4], step: a[5], def: a[6], unit: a[7], group: a[8], zero: a[9] });
export const SETTING_GROUPS = ['임포스터', '크루원', '회의', '임무'];
export const SETTINGS = [
  ['impostors', '임포스터 수', 'i', 1, 3, 1, 1, '', '임포스터'],
  ['killCooldown', '처치 쿨다운', 'f', 10, 60, 2.5, 20, '초', '임포스터'],
  ['impVision', '임포스터 시야', 'f', 0.25, 5, 0.25, 1.5, 'x', '임포스터'],
  ['killDistance', '처치 거리', 'e', 0, 2, 1, 1, ['짧게', '중간', '길게'], '임포스터'],
  ['playerSpeed', '플레이어 속도', 'f', 0.5, 3, 0.25, 1, 'x', '크루원'],
  ['crewVision', '크루원 시야', 'f', 0.25, 5, 0.25, 1, 'x', '크루원'],
  ['emergencyMeetings', '긴급회의 수', 'i', 0, 9, 1, 1, '', '회의'],
  ['emergencyCooldown', '긴급회의 쿨다운', 'i', 0, 60, 5, 15, '초', '회의'],
  ['discussionTime', '회의 시간', 'i', 0, 120, 15, 15, '초', '회의'],
  ['votingTime', '투표 시간', 'i', 15, 300, 15, 120, '초', '회의'],
  ['anonVotes', '익명 투표', 'b', 0, 1, 1, 0, '', '회의'],
  ['confirmEjects', '방출 확인', 'b', 0, 1, 1, 1, '', '회의'],
  ['taskBar', '임무 진행 게이지 업데이트', 'e', 0, 2, 1, 0, ['항상', '회의', '안 함'], '임무'],
  ['visualTasks', '임무 수행 표시', 'b', 0, 1, 1, 1, '', '임무'],
  ['commonTasks', '공통 임무 수', 'i', 0, 2, 1, 1, '', '임무'],
  ['longTasks', '복잡한 임무 수', 'i', 0, 3, 1, 1, '', '임무'],
  ['shortTasks', '간단한 임무 수', 'i', 0, 5, 1, 2, '', '임무'],
].map(row);
// 숨바꼭질 설정 (키가 클래식과 겹치지 않음. playerSpeed 는 공용)
export const HNS_GROUPS = ['임포스터', '크루원', '마지막 숨기', '임무'];
export const HNS_SETTINGS = [
  ['seeker', '임포스터', 'p', 0, 0, 0, '', '', '임포스터'],
  ['hnsImpVision', '임포스터 시야', 'f', 0.25, 1, 0.05, 0.6, 'x', '임포스터'],
  ['impLight', '임포스터 손전등 크기', 'f', 0.1, 0.5, 0.05, 0.25, 'x', '임포스터'],
  ['playerSpeed', '플레이어 속도', 'f', 0.5, 3, 0.25, 1, 'x', '크루원'],
  ['hnsCrewVision', '크루원 시야', 'f', 0.25, 1, 0.05, 0.6, 'x', '크루원'],
  ['hideTime', '숨는 시간', 'i', 160, 300, 20, 200, '초', '크루원'],
  ['flashlight', '손전등 모드', 'b', 0, 1, 1, 1, '', '크루원'],
  ['crewLight', '크루원 손전등 크기', 'f', 0.1, 0.5, 0.05, 0.35, 'x', '크루원'],
  ['ventUses', '최대 환풍구 사용', 'i', 0, 5, 1, 1, '', '크루원'],
  ['ventTime', '환풍구에서의 최대 시간', 'i', 1, 10, 1, 3, '초', '크루원'],
  ['showNames', '이름 표시', 'b', 0, 1, 1, 1, '', '크루원'],
  ['finalTime', '마지막 숨기 시간', 'i', 30, 120, 5, 50, '초', '마지막 숨기'],
  ['finalSpeed', '마지막 숨기 속도', 'f', 1, 3, 0.05, 1.2, 'x', '마지막 숨기'],
  ['finalMap', '마지막 숨기 술래 맵', 'b', 0, 1, 1, 1, '', '마지막 숨기'],
  ['finalPings', '마지막 숨기 핑', 'b', 0, 1, 1, 1, '', '마지막 숨기'],
  ['pingInterval', '핑 간격', 'i', 3, 10, 1, 6, '초', '마지막 숨기'],
  ['hnsCommon', '공통 임무 수', 'i', 0, 4, 1, 1, '', '임무'],
  ['hnsLong', '복잡한 임무 수', 'i', 0, 3, 1, 1, '', '임무'],
  ['hnsShort', '간단한 임무 수', 'i', 0, 5, 1, 2, '', '임무'],
].map(row);
const ALL_ROWS = [...SETTINGS, ...HNS_SETTINGS.filter(d => d[0] !== 'playerSpeed')];
export const settingDef = k => ALL_ROWS.find(d => d[0] === k) || roleOptDefs().find(d => d[0] === k);
const roleOptDefs = () => ROLE_ORDER.flatMap(r => ROLE_DEFS[r].opts || []);

// 프리셋 (클래식: 핵심 설정·다양한 역할 / 숨바꼭질: 피치 다크·손전등). 값을 바꾸면 '맞춤 설정'
export const CUSTOM = '맞춤 설정';
export const PRESETS = {
  '핵심 설정': { roleSet: 'none' },
  '다양한 역할': { roleSet: 'galore' },
  '피치 다크': { flashlight: 0 },
  '손전등': { flashlight: 1 },
};
export const PRESET_MODES = { '핵심 설정': 'classic', '다양한 역할': 'classic', '피치 다크': 'hns', '손전등': 'hns' };
export const PRESET_DESC = {
  '핵심 설정': '균형 잡힌 게임 설정과 역할이 없는 프리셋입니다.', '다양한 역할': '역할이 있는 로비를 위한 추천 설정입니다.',
  '피치 다크': '손전등 시야를 끈 이상적인 숨바꼭질 설정입니다.', '손전등': '크루원이 손전등 시야를 갖는 균형 잡힌 숨바꼭질 설정입니다.',
};
export const presetNames = gameType => Object.keys(PRESETS).filter(p => PRESET_MODES[p] === (gameType === 'hns' ? 'hns' : 'classic'));
// 예전 '권장 설정' 표: 방 용량별 처치 쿨다운
const REC_KILL = { 4: 45, 5: 30, 6: 15, 7: 35, 8: 30, 9: 25, 10: 20 };
export const recommendedKillCd = n => REC_KILL[n] ?? 20;

// log=true 이면 로비 기록용 표현("켜로", "45.0초로")
export function fmtSetting(def, v, log) {
  const [, , k, , , , , u, , zero] = def;
  if (zero && v === 0) return zero;
  if (k === 'b') return log ? (v ? '켜' : '꺼') : (v ? '켬' : '끔');
  if (k === 'e') return Array.isArray(u) && u[v] !== undefined ? u[v] : String(v);
  if (k === 'p') return v ? '지정됨' : '무작위';
  if (k === 'f') return (Number.isInteger(v) ? v.toFixed(1) : String(+(+v).toFixed(3))) + (u || '');
  return v + (u || '');
}

export function defaultSettings() {
  const o = { map: 'skeld', gameType: 'classic', maxPlayers: 15, tag: 0, chatType: 'free', chatLang: KO, roles: false, preset: '핵심 설정' };
  for (const d of ALL_ROWS) o[d[0]] = d[6];
  o.roleSet = defaultRoleSet();
  return o;
}
const cloneRS = rs => Object.fromEntries(Object.entries(rs || {}).map(([k, v]) => [k, { ...v }]));
// 한 값 정리: unlimited 이면 범위·간격 무시(유한한 숫자만)
function cleanVal(d, raw, unlimited) {
  const [, , t, min, max, step] = d;
  if (t === 'p') return typeof raw === 'string' && raw.length <= 24 ? raw : raw == null ? '' : undefined;
  let v = typeof raw === 'boolean' ? +raw : Number(raw);
  if (!isFinite(v)) return undefined;
  if (t === 'b') return v ? 1 : 0;
  if (unlimited) return t === 'f' ? +v.toFixed(3) : Math.round(v);
  v = clamp(Math.round((v - min) / step) * step + min, min, max);
  return t === 'f' ? +v.toFixed(2) : v;
}
export function sanitizeRoleSet(src, base = defaultRoleSet(), unlimited = false) {
  const o = cloneRS(base);
  if (!src || typeof src !== 'object') return o;
  for (const r of ROLE_ORDER) {
    const s = src[r];
    if (!s || typeof s !== 'object') continue;
    o[r] ||= { max: 0, chance: 0 };
    const [mn, mx, st] = isImpRole(r) ? ROLE_SET_RANGE.impMax : ROLE_SET_RANGE.max;
    const mv = cleanVal(['max', '', 'i', mn, mx, st], s.max, unlimited);
    if (mv !== undefined) o[r].max = Math.max(0, mv);
    const cv = cleanVal(['chance', '', 'i', ...ROLE_SET_RANGE.chance], s.chance, unlimited);
    if (cv !== undefined) o[r].chance = Math.max(0, cv);
    for (const d of ROLE_DEFS[r].opts || []) {
      const v = cleanVal(d, s[d[0]], unlimited);
      if (v !== undefined) o[r][d[0]] = unlimited ? Math.max(0, v) : v;
    }
  }
  return o;
}
export const anyRoleOn = rs => ROLE_ORDER.some(r => rs?.[r]?.max > 0 && rs?.[r]?.chance > 0);
const galoreSet = () => { const rs = defaultRoleSet(); for (const r of ROLES_GALORE) Object.assign(rs[r], { max: 1, chance: 100 }); return rs; };

// opts.unlimited: mod 설정 해킹 — 범위 제한 없이 숫자만 확인
export function sanitizeSettings(s = {}, base = defaultSettings(), opts = {}) {
  const unl = !!opts.unlimited;
  const o = { ...defaultSettings(), ...base };
  o.roleSet = sanitizeRoleSet(base.roleSet, defaultRoleSet(), true);
  if (!s || typeof s !== 'object') s = {};
  for (const d of ALL_ROWS) {
    if (s[d[0]] === undefined) continue;
    const v = cleanVal(d, s[d[0]], unl);
    if (v !== undefined) o[d[0]] = v;
  }
  if (MAPS.some(m => m.id === s.map && (m.ready || unl))) o.map = s.map;
  if (s.gameType === 'classic' || s.gameType === 'hns') o.gameType = s.gameType;
  if (s.maxPlayers !== undefined && isFinite(+s.maxPlayers)) o.maxPlayers = unl ? Math.max(1, Math.round(+s.maxPlayers)) : clamp(Math.round(+s.maxPlayers) || 10, 4, 15);
  if (s.tag !== undefined) o.tag = clamp(Math.round(+s.tag) || 0, 0, TAGS.length - 1);
  if (s.chatType === 'free' || s.chatType === 'quick') o.chatType = s.chatType;
  if (s.chatLang !== undefined) o.chatLang = clamp(Math.round(+s.chatLang) || 0, 0, CHAT_LANGS.length - 1);
  if (s.roleSet && typeof s.roleSet === 'object') o.roleSet = sanitizeRoleSet(s.roleSet, o.roleSet, unl);
  else if (s.roles !== undefined && !!s.roles !== anyRoleOn(o.roleSet)) o.roleSet = s.roles ? galoreSet() : defaultRoleSet(); // 예전 "역할 켬/끔"
  o.roles = anyRoleOn(o.roleSet);
  if (s.preset === '커스텀') s = { ...s, preset: CUSTOM };
  if (typeof s.preset === 'string' && (Object.prototype.hasOwnProperty.call(PRESETS, s.preset) || s.preset === CUSTOM)) o.preset = s.preset;
  return o;
}
// 프리셋 적용 (방 정보 map/용량/채팅 등은 유지)
export function applyPreset(name, cur = defaultSettings()) {
  const P = Object.prototype.hasOwnProperty.call(PRESETS, name) ? PRESETS[name] : null;
  if (!P) return cur;
  const keep = { map: cur.map, gameType: PRESET_MODES[name] || cur.gameType, maxPlayers: cur.maxPlayers, tag: cur.tag, chatType: cur.chatType, chatLang: cur.chatLang };
  const o = { ...defaultSettings(), ...keep, preset: name };
  if (PRESET_MODES[name] === 'classic') {
    for (const d of HNS_SETTINGS) if (d[0] !== 'playerSpeed') o[d[0]] = cur[d[0]] ?? d[6]; // 숨바꼭질 값 유지
    o.killCooldown = recommendedKillCd(cur.maxPlayers);
    o.roleSet = P.roleSet === 'galore' ? galoreSet() : defaultRoleSet();
  } else {
    for (const d of SETTINGS) o[d[0]] = cur[d[0]] ?? d[6]; // 클래식 값 유지
    o.roleSet = sanitizeRoleSet(cur.roleSet);
    o.flashlight = P.flashlight;
  }
  o.roles = anyRoleOn(o.roleSet);
  return o;
}
// 인원에 따른 최대 임포스터 수 (실제 게임 규칙: 1명=4인, 2명=7인, 3명=9인 이상)
export const maxImpostors = n => (n >= 9 ? 3 : n >= 7 ? 2 : 1);

// ---- 예전(v1) 클라이언트 호환용: 스켈드 임무/사보타주 표 (v2 는 shared/maps 의 맵 정의를 사용) ----
export const TASKS = {
  wires: { name: '배선 수리하기', kind: 'common', game: 'wires', pick: 3, pool: ['w_elec', 'w_stor', 'w_admin', 'w_nav', 'w_cafe', 'w_sec'] },
  card: { name: '카드 긁기', kind: 'common', game: 'card', seq: ['card'] },
  engine: { name: '엔진 출력 정렬하기', kind: 'long', game: 'align', seq: ['align_up', 'align_low'] },
  upload: { name: '데이터 업로드', kind: 'long', game: 'upload', pick: 1, pool: ['dl_cafe', 'dl_weapons', 'dl_nav', 'dl_comms', 'dl_elec'], then: 'ul_admin' },
  scan: { name: '의무실 스캔 제출', kind: 'long', game: 'scan', seq: ['scan'], visual: true },
  reactor: { name: '원자로 가동', kind: 'long', game: 'simon', seq: ['reactor_start'] },
  calib: { name: '배전기 보정하기', kind: 'short', game: 'calib', seq: ['calib'] },
  o2: { name: '산소 필터 청소', kind: 'short', game: 'leaves', seq: ['o2filter'] },
  steer: { name: '항로 조종 안정시키기', kind: 'short', game: 'steer', seq: ['steer'] },
  asteroids: { name: '소행성 파괴', kind: 'short', game: 'asteroids', seq: ['weapons'] },
  garbage: { name: '쓰레기 비우기', kind: 'short', game: 'garbage', pick: 1, pool: ['garb_cafe', 'garb_o2'] },
  shields: { name: '보호막 활성화', kind: 'short', game: 'shields', seq: ['shields'] },
};
// 임무 정의(객체) 또는 예전 TASKS id → 이번 게임의 단계별 장소 목록
export function stationsFor(t) {
  if (typeof t === 'string') t = TASKS[t];
  if (!t) return [];
  if (t.pick) { const p = shuffle([...t.pool]).slice(0, t.pick); if (t.then) p.push(t.then); return p; }
  return t.seq.map(s => (typeof s === 'string' ? s : pick(s.pool)));
}
export const tasksOfKind = k => Object.keys(TASKS).filter(id => TASKS[id].kind === k);
export const SABOTAGES = {
  reactor: { name: '원자로 멜트다운', time: 30, critical: true, parts: ['h1', 'h2'], together: true },
  o2: { name: '산소 고갈', time: 30, critical: true, parts: ['k1', 'k2'] },
  lights: { name: '조명', parts: ['l'] },
  comms: { name: '통신 방해', parts: ['c'] },
};
// 예전 역할 표 (v2 는 shared/roles.js 의 ROLE_DEFS)
export const ROLES = { crew: ROLE_DEFS.crewmate, ...ROLE_DEFS };

// 빠른 채팅 문장 ({p}=플레이어, {r}=장소) — 기존 번호를 바꾸지 않도록 뒤에만 추가
export const QUICK = [
  ['말하기', ['안녕!', '네', '아니요', '고마워', '미안', '잘 모르겠어', '스킵하자', '투표하자', '누구야?', '어디서?', '증거 있어?', '좋은 게임이었어!', '프리셋 바꿀까?', '숨는 시간 더 줄까?']],
  ['의심', ['{p} 수상해', '{p} 안전해', '{p} 벤트 탔어', '{p}이(가) 죽이는 걸 봤어', '{p} 투표하자', '{p}이(가) 나를 따라왔어', '{p}이(가) 변신하는 걸 봤어', '{p}이(가) 사라졌어']],
  ['위치', ['{r}에 있었어', '{r}에서 시체 발견', '{r}에서 {p} 봤어', '{r}에 아무도 없었어', '{r}(으)로 가자', '{r}에서 시체가 녹고 있었어']],
  ['행동', ['임무 하고 있었어', '스캔했어', '사보타주 고치고 있었어', '벤트 근처에 있었어', '혼자 있었어', '{p}랑 같이 있었어', '심문당했어', '짚라인 타고 있었어']],
  ['역할', ['나는 기술자야', '나는 과학자야', '나는 추적자야', '나는 탐정이야', '나는 판사야', '나는 노이즈 메이커야', '바이탈 봤어', '{p} 추적하고 있었어', '{p} 심문했어', '시체가 녹았어', '시체가 많이 녹았어', '시체가 거의 다 녹았어']],
];
export function buildQuick(q, names, rooms) {
  const cat = QUICK[q?.c]; const s = cat?.[1][q?.i];
  if (!s) return null;
  if (s.includes('{p}') && !names.includes(q.p)) return null;
  if (s.includes('{r}') && !rooms[q.r]) return null;
  return s.replace('{p}', q.p).replace('{r}', rooms[q.r]);
}

// 게스트·어린이 계정용 무작위 이름
export const NAME_A = ['용감한', '조용한', '빠른', '졸린', '배고픈', '수상한', '귀여운', '똑똑한', '신난', '작은', '행복한', '엉뚱한'];
export const NAME_B = ['감자', '펭귄', '고양이', '당근', '우주인', '호박', '버섯', '곰', '토끼', '여우', '만두', '고래'];
export const randomName = () => pick(NAME_A) + pick(NAME_B);
export const isRandomName = n => typeof n === 'string' && NAME_A.some(a => n.startsWith(a) && NAME_B.includes(n.slice(a.length)));

export function ageOf(birth, now = new Date()) {
  const [y, m, d] = String(birth).split('-').map(Number);
  if (!y || !m || !d) return -1;
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}
export const CHILD_AGE = 14; // 만 14세 미만 → 청록불

export const NOTICES = [
  { date: '2026-10-10', title: '대규모 업데이트 v2', head: '모든 맵, 모든 역할!', sub: '우주선 전체가 열렸습니다',
    body: ['이제 <b>더 스켈드 · 미라 HQ · 폴러스 · 에어십 · 펑글</b> 다섯 맵을 모두 플레이할 수 있습니다.',
      '- 폴러스와 에어십의 문은 패널로 직접 열어야 하고, 에어십에서는 시작 위치를 고를 수 있어요.',
      '- 사다리 · 짚라인 · 승강장 · 소독실로 이동하세요.',
      '로비의 <b>역할 설정</b>에서 13가지 역할을 모두 켤 수 있습니다: 기술자, 과학자, 추적자, 노이즈 메이커, 탐정, 판사, 수호천사, 인플루언서, 형상 변환자, 팬텀, 바이퍼.',
      '<b>숨바꼭질</b> 모드도 새로워졌습니다. 마지막 숨기, 핑, 손전등, 위험 측정기를 확인하세요!'] },
  { date: '2026-10-02', title: '임포스터의 달', head: '임포스터의 달이 시작됩니다', sub: '장난기 가득한 시간',
    body: ['크크크크크크크크…', '<s>관리자</s> 임포스터들이 이번 달을 차지했습니다! 크루원 여러분, 조심하세요. 10월은 원래 으스스한 달이죠. 우주선을 사보타주로 괴롭히는 임포스터보다 무서운 게 또 있을까요?',
      '이 혼돈을 기념해 창고 깊숙이 숨겨 두었던 것들을 꺼냈습니다.',
      '- 보라색으로 만든 <b>무료 교통체증 모자</b>! 내 계정 → 보상 교환에서 코드 <b>IMPOSTORMOON</b> 을 입력하세요.',
      '- 상점에 <b>호박 모자</b>와 <b>고스트 망토</b>가 들어왔습니다.', '- 식당에 할로윈 장식이 생겼어요. 사탕은 먹지 마세요.'] },
  { date: '2026-09-29', title: '새 유령 역할: 인플루언서', head: '새 유령 역할: 인플루언서', sub: '죽어서도 할 말은 많다',
    body: ['죽은 크루원은 <b>인플루언서</b>가 될 수 있습니다.', '살아있는 플레이어 근처에서 <b>메시지</b>를 누르면 그림 6개가 나옵니다. 최대 3개를 골라 보내면 상대 화면에 잠깐 나타나요.',
      '그림을 새로 고치면 보내기 쿨다운이 생기니 신중하게!', '유령은 벽을 통과해 날아다니고, 다른 유령과만 대화할 수 있어요.'] },
  { date: '2026-08-18', title: '새 역할: 판사', head: '새 역할: 판사', sub: '판결이 내려졌습니다',
    body: ['<b>판사</b>는 자기 임무를 일정 비율 끝내면 <b>기각</b> 능력이 열립니다.', '회의 중 단 한 번, 망치로 한 명을 지목하면 다른 모든 투표가 무시됩니다.',
      '- 지목한 사람이 임포스터면 그 사람이 방출됩니다.', '- 아니라면 <b>판사 자신</b>이 방출됩니다!', '이번 업데이트부터 탐정의 심문은 긴급회의 뒤 10초 쿨다운이 생깁니다.'] },
  { date: '2026-07-14', title: '다시 찾아온 인디 타임', head: '다시 찾아온 인디 타임', sub: '여름 맞이 상점 세일',
    body: ['상점의 모든 아이템을 콩으로 살 수 있습니다.', '메인 화면 오른쪽 아래의 <b>+1</b> 별을 누르면 매일 콩 50개를 받을 수 있어요.'] },
  { date: '2026-06-16', title: '8번째 생일', head: '8번째 생일 축하합니다!', sub: '케이크는 거짓말이 아니에요',
    body: ['함께해 주셔서 고맙습니다!', '보상 교환에서 코드 <b>HAPPY8TH</b> 를 입력하면 파티 모자를 드립니다.', '꼬마 유령 펫 코드: <b>GHOST2026</b>'] },
];
