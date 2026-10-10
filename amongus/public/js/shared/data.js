// 서버와 클라이언트가 함께 쓰는 게임 데이터
export const VERSION = 'v1.0a (build num: 1)';

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

export const MAPS = [
  { id: 'skeld', name: 'THE SKELD', ready: true }, { id: 'mira', name: 'MIRA HQ' }, { id: 'polus', name: 'POLUS' },
  { id: 'airship', name: 'THE AIRSHIP' }, { id: 'fungle', name: 'THE FUNGLE' },
];
export const REGIONS = [['na', '북미'], ['eu', '유럽'], ['as', '아시아']];
export const TAGS = ['없음', '초보자', '중급자', '전문가'];
export const CHAT_LANGS = ['English', 'Español (Latam)', 'Português (BR)', 'Português', '한국어', 'Русский', 'Nederlands', 'Bisaya', 'Français',
  'Deutsch', 'Italiano', '日本語', 'Español', 'Al Arabiya', 'Polski', '简体中文', '繁體中文', 'Gaeilge', '기타'];
export const KO = 4; // 한국어 인덱스 → 아시아 서버

// 게임 설정 [키, 라벨, 종류(i 정수/f 실수/e 선택/b 켬끔), 최소, 최대, 간격, 기본값, 단위 또는 선택지]
export const SETTINGS = [
  ['impostors', '임포스터 수', 'i', 1, 3, 1, 1, ''],
  ['killCooldown', '처치 쿨다운', 'f', 10, 60, 2.5, 45, '초'],
  ['playerSpeed', '플레이어 속도', 'f', 0.5, 3, 0.25, 1, 'x'],
  ['crewVision', '크루원 시야', 'f', 0.25, 5, 0.25, 1, 'x'],
  ['impVision', '임포스터 시야', 'f', 0.25, 5, 0.25, 1.5, 'x'],
  ['killDistance', '처치 거리', 'e', 0, 2, 1, 1, ['짧음', '보통', '김']],
  ['emergencyMeetings', '긴급 회의 수', 'i', 0, 9, 1, 1, ''],
  ['emergencyCooldown', '긴급 회의 쿨다운', 'i', 0, 60, 5, 15, '초'],
  ['discussionTime', '토론 시간', 'i', 0, 120, 15, 15, '초'],
  ['votingTime', '투표 시간', 'i', 15, 300, 15, 120, '초'],
  ['anonVotes', '익명 투표', 'b', 0, 1, 1, 0],
  ['confirmEjects', '추방 확인', 'b', 0, 1, 1, 1],
  ['taskBar', '임무 진행 바 업데이트', 'e', 0, 2, 1, 0, ['항상', '회의 중', '안 함']],
  ['visualTasks', '임무 수행 표시', 'b', 0, 1, 1, 1],
  ['commonTasks', '일반 임무', 'i', 0, 2, 1, 1, ''],
  ['longTasks', '긴 임무', 'i', 0, 3, 1, 1, ''],
  ['shortTasks', '짧은 임무', 'i', 0, 5, 1, 2, ''],
  ['hnsTime', '숨바꼭질 제한 시간', 'i', 60, 600, 30, 240, '초'],
];
export const PRESETS = {
  '핵심 설정': {},
  '빠른 게임': { killCooldown: 25, playerSpeed: 1.25, discussionTime: 0, votingTime: 60, shortTasks: 1 },
  '초보자': { killCooldown: 60, emergencyMeetings: 2, discussionTime: 30, impVision: 1 },
};
// log=true 이면 로비 기록용 표현("켜로", "45.0초로")
export function fmtSetting(def, v, log) {
  const [, , k, , , , , u] = def;
  if (k === 'b') return log ? (v ? '켜' : '꺼') : (v ? '켬' : '끔');
  if (k === 'e') return u[v];
  if (k === 'f') return (Number.isInteger(v) ? v.toFixed(1) : String(v)) + u;
  return v + u;
}
export function defaultSettings() {
  const o = { map: 'skeld', gameType: 'classic', maxPlayers: 10, tag: 0, chatType: 'free', chatLang: KO, roles: false, preset: '핵심 설정' };
  for (const d of SETTINGS) o[d[0]] = d[6];
  return o;
}
export function sanitizeSettings(s = {}, base = defaultSettings()) {
  const o = { ...base };
  for (const [k, , t, min, max, step] of SETTINGS) {
    if (s[k] === undefined) continue;
    let v = Number(s[k]);
    if (!isFinite(v)) continue;
    v = clamp(Math.round((v - min) / step) * step + min, min, max);
    o[k] = t === 'f' ? +v.toFixed(2) : v;
  }
  if (MAPS.some(m => m.id === s.map && m.ready)) o.map = s.map;
  if (s.gameType === 'classic' || s.gameType === 'hns') o.gameType = s.gameType;
  if (s.maxPlayers !== undefined) o.maxPlayers = clamp(Math.round(+s.maxPlayers) || 10, 4, 15);
  if (s.tag !== undefined) o.tag = clamp(Math.round(+s.tag) || 0, 0, 3);
  if (s.chatType === 'free' || s.chatType === 'quick') o.chatType = s.chatType;
  if (s.chatLang !== undefined) o.chatLang = clamp(Math.round(+s.chatLang) || 0, 0, CHAT_LANGS.length - 1);
  if (s.roles !== undefined) o.roles = !!s.roles;
  if (typeof s.preset === 'string' && (PRESETS[s.preset] || s.preset === '커스텀')) o.preset = s.preset;
  return o;
}
// 인원에 따른 최대 임포스터 수 (실제 게임 규칙)
export const maxImpostors = n => (n >= 9 ? 3 : n >= 7 ? 2 : 1);

// 임무: seq = 고정 순서, pool+pick = 무작위 위치, then = 마지막 단계
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
export function stationsFor(id) {
  const t = TASKS[id];
  if (t.seq) return [...t.seq];
  const p = shuffle([...t.pool]).slice(0, t.pick);
  if (t.then) p.push(t.then);
  return p;
}
export const tasksOfKind = k => Object.keys(TASKS).filter(id => TASKS[id].kind === k);

export const SABOTAGES = {
  reactor: { name: '원자로 붕괴', time: 45, critical: true, parts: ['h1', 'h2'], together: true },
  o2: { name: '산소 고갈', time: 40, critical: true, parts: ['k1', 'k2'] },
  lights: { name: '조명 고장', parts: ['l'] },
  comms: { name: '통신 방해', parts: ['c'] },
};

export const ROLES = {
  crew: { name: '크루원', color: '#8CFFFF', desc: '임무를 모두 끝내거나 임포스터를 찾아 추방하세요.' },
  impostor: { name: '임포스터', color: '#FF1919', desc: '들키지 않게 크루원을 처치하세요. 벤트와 사보타주를 쓸 수 있습니다.' },
  engineer: { name: '엔지니어', color: '#FF8A00', desc: '크루원 팀. 벤트를 타고 이동할 수 있습니다.' },
  scientist: { name: '과학자', color: '#00D9FF', desc: '크루원 팀. 어디서든 생체 신호를 확인할 수 있습니다.' },
};

// 빠른 채팅 문장 ({p}=플레이어, {r}=장소)
export const QUICK = [
  ['말하기', ['안녕!', '네', '아니요', '고마워', '미안', '잘 모르겠어', '스킵하자', '투표하자', '누구야?', '어디서?', '증거 있어?', '좋은 게임이었어!']],
  ['의심', ['{p} 수상해', '{p} 안전해', '{p} 벤트 탔어', '{p}이(가) 죽이는 걸 봤어', '{p} 투표하자', '{p}이(가) 나를 따라왔어']],
  ['위치', ['{r}에 있었어', '{r}에서 시체 발견', '{r}에서 {p} 봤어', '{r}에 아무도 없었어', '{r}(으)로 가자']],
  ['행동', ['임무 하고 있었어', '스캔했어', '사보타주 고치고 있었어', '벤트 근처에 있었어', '혼자 있었어', '{p}랑 같이 있었어']],
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
  { date: '2026-10-02', title: '임포스터의 달', head: '임포스터의 달이 시작됩니다', sub: '장난기 가득한 시간',
    body: ['크크크크크크크크…', '<s>관리자</s> 임포스터들이 이번 달을 차지했습니다! 크루원 여러분, 조심하세요. 10월은 원래 으스스한 달이죠. 우주선을 사보타주로 괴롭히는 임포스터보다 무서운 게 또 있을까요?',
      '이 혼돈을 기념해 창고 깊숙이 숨겨 두었던 것들을 꺼냈습니다.',
      '- 보라색으로 만든 <b>무료 교통체증 모자</b>! 내 계정 → 보상 교환에서 코드 <b>IMPOSTORMOON</b> 을 입력하세요.',
      '- 상점에 <b>호박 모자</b>와 <b>고스트 망토</b>가 들어왔습니다.', '- 식당에 할로윈 장식이 생겼어요. 사탕은 먹지 마세요.'] },
  { date: '2026-09-30', title: '새로운 유령 역할', head: '새로운 유령 역할', sub: '죽어서도 할 일은 많다',
    body: ['유령이 된 크루원도 임무를 끝까지 도울 수 있습니다.', '유령은 벽을 통과해 날아다니고, 다른 유령과만 대화할 수 있어요.', '유령끼리의 채팅은 살아있는 사람에게 보이지 않습니다.'] },
  { date: '2026-08-19', title: '새 역할: 판사', head: '새 역할: 판사', sub: '정의는 투표로',
    body: ['게임을 만들 때 <b>역할</b>을 켜면 엔지니어와 과학자가 등장합니다.', '- <b>엔지니어</b>: 벤트를 타고 이동할 수 있습니다.', '- <b>과학자</b>: 어디서든 생체 신호를 볼 수 있습니다.', '판사는 다음 업데이트에서 만나요!'] },
  { date: '2026-07-14', title: '다시 찾아온 인디 타임', head: '다시 찾아온 인디 타임', sub: '여름 맞이 상점 세일',
    body: ['상점의 모든 아이템을 콩으로 살 수 있습니다.', '메인 화면 오른쪽 아래의 <b>+1</b> 별을 누르면 매일 콩 50개를 받을 수 있어요.'] },
  { date: '2026-06-16', title: '8번째 생일', head: '8번째 생일 축하합니다!', sub: '케이크는 거짓말이 아니에요',
    body: ['함께해 주셔서 고맙습니다!', '보상 교환에서 코드 <b>HAPPY8TH</b> 를 입력하면 파티 모자를 드립니다.', '꼬마 유령 펫 코드: <b>GHOST2026</b>'] },
];
