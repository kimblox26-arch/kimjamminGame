// 수능 감독관 — 데이터: 아이콘(SVG 그림), 효과음(실시간 합성), 무기, 문제, AI 안경 응답
'use strict';

// ───────── SVG 아이콘 (이모티콘 대신 직접 그린 그림) ─────────
const S = (b) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${b}</svg>`;
const HEART = 'M32 55 9.5 33.5C2 26 3.5 13.5 13 10.2c7-2.4 14 .8 19 7.6 5-6.8 12-10 19-7.6C60.5 13.5 62 26 54.5 33.5Z';
export const ICONS = {
  heart: S(`<path d="${HEART}" fill="#ff3d5a" stroke="#8a0820" stroke-width="3" stroke-linejoin="round"/><path d="M14.5 19.5c2-4 6.5-5.5 10-3.5" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".75"/>`),
  heart0: S(`<path d="${HEART}" fill="#2b2f3d" stroke="#596075" stroke-width="3" stroke-linejoin="round"/>`),
  coin: S(`<circle cx="32" cy="34" r="26" fill="#c98a00"/><circle cx="32" cy="30" r="26" fill="#ffc83a" stroke="#a86f00" stroke-width="3"/><circle cx="32" cy="30" r="18" fill="none" stroke="#e8a200" stroke-width="3"/><path d="M38.5 22.5a10 10 0 1 0 0 15" fill="none" stroke="#9a6400" stroke-width="5.5" stroke-linecap="round"/>`),
  gear: S(`<circle cx="32" cy="32" r="21" fill="none" stroke="#dfe6f2" stroke-width="11" stroke-dasharray="8.25 8.24"/><circle cx="32" cy="32" r="17" fill="#dfe6f2"/><circle cx="32" cy="32" r="7.5" fill="#2a3245"/>`),
  chat: S(`<path d="M10 10h44a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H28L15 58V48h-5a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6Z" fill="#fff" stroke="#3a62d9" stroke-width="3" stroke-linejoin="round"/><circle cx="20" cy="29" r="4" fill="#3a62d9"/><circle cx="32" cy="29" r="4" fill="#3a62d9"/><circle cx="44" cy="29" r="4" fill="#3a62d9"/>`),
  send: S(`<path d="M6 30 58 8 46 56 31 38Z" fill="#fff"/><path d="M31 38 58 8 24 34Z" fill="#b9cbff"/>`),
  jump: S(`<path d="M32 6 56 32H42v12H22V32H8Z" fill="#7ef0a0" stroke="#17663a" stroke-width="3" stroke-linejoin="round"/><rect x="22" y="49" width="20" height="5" rx="2" fill="#7ef0a0" stroke="#17663a" stroke-width="2"/><rect x="22" y="57" width="20" height="4" rx="2" fill="#7ef0a0" opacity=".6"/>`),
  attack: S(`<circle cx="32" cy="32" r="19" fill="none" stroke="#fff" stroke-width="5"/><path d="M32 4v15M32 45v15M4 32h15M45 32h15" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="32" r="6" fill="#ff4b4b"/>`),
  snatch: S(`<g stroke="#1d1d1d" stroke-width="5" fill="#9bdcff" fill-opacity=".6"><circle cx="17" cy="38" r="12"/><circle cx="47" cy="38" r="12"/></g><path d="M29 35q3-4 6 0M5 33 2 27M59 33l3-6" stroke="#1d1d1d" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M34 3 27 17l8 4-7 15" stroke="#ff3b30" stroke-width="4.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`),
  punch: S(`<path d="M4 16l7 5M3 32h8M5 48l7-4" stroke="#ffcc00" stroke-width="4" stroke-linecap="round"/><rect x="18" y="16" width="34" height="32" rx="10" fill="#ffd2a6" stroke="#7a4a1e" stroke-width="3"/><path d="M26.5 16v11M35 16v11M43.5 16v11" stroke="#7a4a1e" stroke-width="2.5"/><path d="M18 33h12a5 5 0 0 1 0 10H20" fill="#ffd2a6" stroke="#7a4a1e" stroke-width="3"/><rect x="24" y="47" width="22" height="10" rx="3" fill="#3d6fa8" stroke="#1a3352" stroke-width="3"/>`),
  bat: S(`<path d="M8 52l4 4 38-36c4.5-4.5 5-10 1.5-13.5S42.5 3.5 38 8Z" fill="#dca15a" stroke="#6b3f12" stroke-width="3" stroke-linejoin="round"/><path d="M11 45l8 8" stroke="#2b2b2b" stroke-width="7"/><circle cx="9" cy="55" r="5" fill="#6b3f12"/><path d="M40 12q4 2 6 6" stroke="#fff" stroke-width="2.5" fill="none" opacity=".6"/>`),
  pistol: S(`<circle cx="38" cy="15" r="8" fill="#ff4fa3" stroke="#7a1450" stroke-width="3"/><path d="M6 22h50v12H32l-3 3v13a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3l2-16H6Z" fill="#2fa8ff" stroke="#0b3d66" stroke-width="3" stroke-linejoin="round"/><path d="M29 37q4 6 0 8" stroke="#0b3d66" stroke-width="3" fill="none"/>`),
  ak: S(`<path d="M3 31l8-7h42v8H13l-5 9H2Z" fill="#a8652e" stroke="#4a2a10" stroke-width="2.5" stroke-linejoin="round"/><rect x="24" y="21" width="37" height="6" rx="1.5" fill="#2b2b2b"/><path d="M31 32h5l5 14-6 3-6-15Z" fill="#ff8a1a" stroke="#7a3a00" stroke-width="2.5" stroke-linejoin="round"/><path d="M21 32h6l-2 10h-6Z" fill="#2b2b2b"/><rect x="44" y="16" width="7" height="5" rx="1" fill="#7bff3a"/>`),
  rpg: S(`<rect x="4" y="27" width="40" height="11" rx="3" fill="#5d7a3a" stroke="#2c3d16" stroke-width="2.5"/><path d="M44 23h6l10 9.5-10 9.5h-6Z" fill="#ff5a1f" stroke="#7a1f00" stroke-width="2.5" stroke-linejoin="round"/><path d="M18 38h6v10h-6ZM30 38h5v7h-5Z" fill="#333"/><path d="M9 27v11M15 27v11" stroke="#ffd400" stroke-width="2.5"/><path d="M50 14l3 5M58 18l-4 4M44 15l2 5" stroke="#ff3fa4" stroke-width="3" stroke-linecap="round"/>`),
  tackle: S(`<circle cx="18" cy="40" r="12" fill="none" stroke="#cfd8e3" stroke-width="6"/><circle cx="46" cy="40" r="12" fill="none" stroke="#cfd8e3" stroke-width="6"/><circle cx="18" cy="40" r="12" fill="none" stroke="#6b7684" stroke-width="1.5"/><circle cx="46" cy="40" r="12" fill="none" stroke="#6b7684" stroke-width="1.5"/><path d="M27 28q5-8 10 0" stroke="#cfd8e3" stroke-width="5" fill="none"/><path d="M8 10l8 7M56 10l-8 7M32 4v8" stroke="#ffcc00" stroke-width="4" stroke-linecap="round"/>`),
  hack: S(`<rect x="14" y="14" width="36" height="36" rx="5" fill="#0f2418" stroke="#2bff88" stroke-width="3"/><path d="M20 8v6M32 8v6M44 8v6M20 50v6M32 50v6M44 50v6M8 20h6M8 32h6M8 44h6M50 20h6M50 32h6M50 44h6" stroke="#2bff88" stroke-width="3" stroke-linecap="round"/><path d="M27 25l-6 7 6 7M37 25l6 7-6 7" stroke="#2bff88" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  close: S(`<path d="M16 16l32 32M48 16 16 48" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`),
  ai: S(`<g stroke="#0d1b2a" stroke-width="4"><rect x="5" y="22" width="24" height="18" rx="7" fill="#37e0ff"/><rect x="35" y="22" width="24" height="18" rx="7" fill="#37e0ff"/></g><path d="M29 29h6" stroke="#0d1b2a" stroke-width="4"/><circle cx="54" cy="15" r="5" fill="#37e0ff" stroke="#0d1b2a" stroke-width="2"/><path d="M11 28h10M41 28h10" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>`),
  pencil: S(`<path d="M14 50 18 36 44 10l10 10-26 26Z" fill="#ffd23f" stroke="#7a5b00" stroke-width="3" stroke-linejoin="round"/><path d="M14 50l4-14 10 10Z" fill="#f7dcb0" stroke="#7a5b00" stroke-width="3" stroke-linejoin="round"/><path d="M14 50l1.5-5 3.5 3.5Z" fill="#333"/><path d="M40 14l10 10" stroke="#ff6b8b" stroke-width="6"/><path d="M8 58h30" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`),
  eye: S(`<path d="M3 32Q32 4 61 32 32 60 3 32Z" fill="#fff" stroke="#222" stroke-width="3"/><circle cx="32" cy="32" r="11" fill="#3b6bff"/><circle cx="32" cy="32" r="5" fill="#111"/><circle cx="28" cy="28" r="2.5" fill="#fff"/>`),
  exit: S(`<path d="M10 6h26v52H10Z" fill="#8a5a2b" stroke="#4a2a10" stroke-width="3"/><circle cx="30" cy="32" r="2.5" fill="#ffd23f"/><path d="M40 32h18M50 23l9 9-9 9" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  teacher: S(`<path d="M10 62q0-24 22-24t22 24Z" fill="#2a3348" stroke="#11182a" stroke-width="2.5"/><path d="M26 38l6 7 6-7" fill="#fff"/><path d="M32 43l-3 4 3 13 3-13Z" fill="#e0303a"/><circle cx="32" cy="20" r="12" fill="#f1c9a5" stroke="#5a3a20" stroke-width="2.5"/><path d="M20 18q12-15 24 0v-4q-12-10-24 0Z" fill="#2a2a2a"/><circle cx="27.5" cy="21" r="1.8" fill="#222"/><circle cx="36.5" cy="21" r="1.8" fill="#222"/><path d="M28 27q4 2 8 0" stroke="#7a3a2a" stroke-width="2" fill="none"/>`),
  student: S(`<path d="M10 62q0-24 22-24t22 24Z" fill="#3d6fa8" stroke="#1a3352" stroke-width="2.5"/><circle cx="32" cy="21" r="12" fill="#f1c9a5" stroke="#5a3a20" stroke-width="2.5"/><path d="M20 19q2-13 12-13t12 13q-7-6-24 0Z" fill="#1b1612"/><g fill="#37e0ff" fill-opacity=".35" stroke="#111" stroke-width="2.5"><circle cx="27" cy="22" r="4.5"/><circle cx="37" cy="22" r="4.5"/></g><path d="M31.5 22h1" stroke="#111" stroke-width="2.5"/><circle cx="43" cy="18" r="2" fill="#37e0ff"/>`),
  lock: S(`<path d="M20 28v-8a12 12 0 0 1 24 0v8" fill="none" stroke="#cfd8e3" stroke-width="6"/><rect x="12" y="28" width="40" height="28" rx="5" fill="#ffc83a" stroke="#a86f00" stroke-width="3"/><circle cx="32" cy="40" r="4" fill="#7a4f00"/><path d="M32 42v7" stroke="#7a4f00" stroke-width="4"/>`),
  check: S(`<path d="M12 34l13 13 27-29" stroke="#3dff8a" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  star: S(`<path d="M32 5l8 17 18 2-13.5 12.5L48 55 32 46 16 55l3.5-18.5L6 24l18-2Z" fill="#ffd23f" stroke="#a87b00" stroke-width="3" stroke-linejoin="round"/>`),
  lunch: S(`<rect x="8" y="22" width="48" height="32" rx="6" fill="#ff8a3d" stroke="#7a3500" stroke-width="3"/><path d="M8 34h48M32 34v20" stroke="#7a3500" stroke-width="3"/><path d="M24 22v-6a8 8 0 0 1 16 0v6" fill="none" stroke="#7a3500" stroke-width="4"/><circle cx="20" cy="44" r="4" fill="#fff"/><circle cx="44" cy="44" r="4" fill="#7bd651"/>`),
  bell: S(`<path d="M32 6a4 4 0 0 1 4 4v2c9 2 14 10 14 20v10l6 6H8l6-6V32c0-10 5-18 14-20v-2a4 4 0 0 1 4-4Z" fill="#ffd23f" stroke="#7a5b00" stroke-width="3" stroke-linejoin="round"/><path d="M25 52a7 7 0 0 0 14 0" fill="#7a5b00"/>`),
};
export const icon = (n) => ICONS[n] || '';

// ───────── 무기 / 스킬 ─────────
export const WEAPONS = {
  snatch: { name: '안경 뺏기', icon: 'snatch', cd: .8, range: 2.0, kind: 'snatch', desc: '안경을 뺏어서 반으로 쪼갠다' },
  punch: { name: '주먹 기절', icon: 'punch', cd: 1.2, range: 2.0, kind: 'punch', desc: '머리를 때려 잠깐 기절' },
  bat: { name: '야구방망이', icon: 'bat', price: 10, cd: 1.0, range: 2.2, kind: 'bat', desc: '머리를 딱! 한 방에 KO' },
  pistol: { name: '페인트 권총', icon: 'pistol', price: 25, cd: .5, kind: 'gun', speed: 30, spread: .012, desc: '페인트탄 한 발에 KO' },
  ak: { name: 'AK-47 페인트건', icon: 'ak', price: 40, cd: .1, kind: 'gun', auto: true, speed: 36, spread: .05, desc: '연사! 빗나가면 옆 학생이 맞는다' },
  rpg: { name: 'RPG 폭죽포', icon: 'rpg', price: 67, cd: 3, kind: 'rocket', speed: 14, desc: '자리째 날려버리는 대폭발' },
  tackle: { name: '태클 제압', icon: 'tackle', price: 100, cd: 3.5, range: 3.4, kind: 'tackle', desc: '밀어 넘어뜨리고 수갑 채우기' },
};
export const SHOP_ORDER = ['bat', 'pistol', 'ak', 'rpg', 'tackle'];

export const NAMES = ['김민준', '이서연', '박지호', '최서윤', '정도윤', '강하은', '조예준', '윤지우', '장시우', '임수아', '한주원', '오지민', '서건우', '신채원', '권현우', '황다은', '안유준', '송서아', '류은우', '홍하린', '전지환', '고나윤', '문승현', '양소율', '손태윤', '배지아', '백도현', '허예린'];

// ───────── 학생 반응 ─────────
export const REACT = {
  quiet: ['...', '(조용히 고개를 숙인다)', '네...', '죄송합니다'],
  cheat: ['누가 커닝해요?', '저 아니에요!', '헐...', '(두리번두리번)'],
  guilty: ['저, 저 아니에요!!', '(식은땀)', '이 안경은 그냥 시력 때문에...', '(안경을 슬쩍 만진다)'],
  fight: ['감사합니다!', '화이팅!!', '열심히 할게요!', '네! 힘낼게요'],
  time: ['몇 분 남았어요?', '헐 시간 없다...', '아직 반도 못 풀었는데ㅠ', '시간 더 주세요!'],
  start: ['떨린다...', '네!', '(심호흡)', '준비됐어요'],
  end: ['벌써요?!', '한 문제만요!!', '아 망했다...', '끝났다!!'],
  hi: ['안녕하세요', '안녕하세요 선생님!', '(꾸벅)'],
  food: ['배고파요...', '도시락 먹고 싶다', '점심 언제예요?'],
  praise: ['헤헤', '감사합니다!', '(뿌듯)'],
  angry: ['(움찔)', '죄송합니다!', '왜 저한테...'],
  def: ['네?', '...?', '네 선생님', '(끄덕끄덕)', '무슨 말씀이세요?', '네 알겠습니다'],
};
export function classify(t) {
  if (/조용|떠들|쉿|정숙/.test(t)) return 'quiet';
  if (/부정|커닝|컨닝|ai|안경|에이아이|치팅/i.test(t)) return 'cheat';
  if (/화이팅|파이팅|힘내|응원|잘\s*봐/.test(t)) return 'fight';
  if (/시간|분\s*남|남았/.test(t)) return 'time';
  if (/종료|끝|그만|펜\s*놓/.test(t)) return 'end';
  if (/시작|시험/.test(t)) return 'start';
  if (/안녕|반가|하이/.test(t)) return 'hi';
  if (/밥|점심|배고|도시락/.test(t)) return 'food';
  if (/잘했|최고|멋|대단/.test(t)) return 'praise';
  if (/야!|이놈|혼나|나와|일어나/.test(t)) return 'angry';
  return 'def';
}

// ───────── 수능 문제 ─────────
const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const KOR = [
  ['다음 중 맞춤법이 올바른 것은?', ['어의없다', '왠지 기분이 좋다', '몇일 동안', '금새 끝났다', '설겆이를 했다'], 1, '"왠지"는 "왜인지"의 준말이므로 올바른 표기입니다.'],
  ['다음 중 띄어쓰기가 올바른 것은?', ['할 수 있다', '할수 있다', '할 수있다', '할수있다', '할 수 잇다'], 0, '의존 명사 "수"는 앞말과 띄어 씁니다.'],
  ['다음 중 높임 표현이 올바른 것은?', ['할머니께서 진지를 잡수신다', '사장님, 커피 나오셨습니다', '아버지가 밥을 먹는다', '선생님이 집에 갔다', '할아버지가 아프다'], 0, '주체 높임 "-께서", "잡수시다"가 올바르게 쓰였습니다.'],
  ['윤동주의 「서시」에 나오지 않는 시어는?', ['하늘', '잎새', '바람', '별', '바다'], 4, '「서시」에는 하늘, 잎새, 바람, 별이 나옵니다.'],
  ['다음 중 반의어 관계가 아닌 것은?', ['크다 - 작다', '높다 - 낮다', '길다 - 짧다', '기쁘다 - 즐겁다', '덥다 - 춥다'], 3, '"기쁘다"와 "즐겁다"는 유의어입니다.'],
  ['다음 중 외래어 표기가 올바른 것은?', ['주스', '쥬스', '케잌', '로보트', '까페'], 0, '"juice"는 "주스"로 적습니다.'],
  ['"가랑비에 옷 젖는 줄 모른다"의 뜻은?', ['작은 일도 거듭되면 크게 된다', '비 오는 날은 조심해야 한다', '옷을 잘 챙겨 입어야 한다', '남의 일에 참견하지 마라', '급할수록 돌아가라'], 0, '사소한 것이 쌓이면 큰 결과가 된다는 속담입니다.'],
  ['다음 중 표준어인 것은?', ['짜장면', '삭월세', '강남콩', '숫병아리', '윗층'], 0, '"짜장면"은 2011년부터 표준어로 인정되었습니다.'],
];
const ENG = [['abandon', '버리다'], ['accurate', '정확한'], ['beneficial', '유익한'], ['consequence', '결과'], ['diverse', '다양한'], ['enhance', '향상시키다'], ['reluctant', '꺼리는'], ['inevitable', '불가피한'], ['sustain', '유지하다'], ['obscure', '모호한'], ['acquire', '습득하다'], ['emphasize', '강조하다']];
const SCI = [
  ['물의 화학식으로 옳은 것은?', ['H₂O', 'CO₂', 'O₂', 'NaCl', 'H₂O₂'], 0, '물은 수소 2개와 산소 1개로 이루어집니다.'],
  ['광합성이 일어나는 세포 소기관은?', ['엽록체', '미토콘드리아', '핵', '리보솜', '골지체'], 0, '광합성은 엽록체에서 일어납니다.'],
  ['임진왜란이 일어난 해는?', ['1392년', '1446년', '1592년', '1636년', '1910년'], 2, '임진왜란은 1592년(선조 25년)에 일어났습니다.'],
  ['뉴턴 운동 제2법칙을 나타낸 식은?', ['F = ma', 'E = mc²', 'V = IR', 'PV = nRT', 'p = mv'], 0, '힘은 질량과 가속도의 곱입니다.'],
  ['고려를 건국한 인물은?', ['왕건', '이성계', '궁예', '견훤', '김춘추'], 0, '왕건이 918년에 고려를 세웠습니다.'],
  ['DNA 이중 나선 구조를 밝힌 과학자는?', ['왓슨과 크릭', '멘델', '다윈', '파스퇴르', '뉴턴'], 0, '1953년 왓슨과 크릭이 발표했습니다.'],
  ['지구 대기에서 가장 많은 기체는?', ['질소', '산소', '아르곤', '이산화 탄소', '수소'], 0, '질소가 약 78%를 차지합니다.'],
  ['훈민정음이 반포된 해는?', ['1392년', '1443년', '1446년', '1592년', '1897년'], 2, '1443년에 창제되고 1446년에 반포되었습니다.'],
];
function genMath() {
  const k = ri(0, 5); let text, ans, exp;
  if (k === 0) { const a = ri(1, 6), b = ri(2, 7); text = `이차방정식 x² - ${a + b}x + ${a * b} = 0 의 두 근의 곱은?`; ans = a * b; exp = `근과 계수의 관계에서 두 근의 곱 = ${a * b}`; }
  else if (k === 1) { const a = ri(1, 4), b = ri(1, 6), c = ri(1, 3); text = `함수 f(x) = ${a}x² + ${b}x 에 대하여 f'(${c})의 값은?`; ans = 2 * a * c + b; exp = `f'(x) = ${2 * a}x + ${b} 이므로 f'(${c}) = ${ans}`; }
  else if (k === 2) { const n = ri(1, 3); text = `∫₀^${n} 3x² dx 의 값은?`; ans = n ** 3; exp = `[x³]₀^${n} = ${ans}`; }
  else if (k === 3) { const n = ri(3, 7); text = `log₂ ${2 ** n} 의 값은?`; ans = n; exp = `2^${n} = ${2 ** n} 이므로 ${n}`; }
  else if (k === 4) { const a = ri(1, 5), d = ri(2, 5), n = ri(5, 10); text = `첫째항이 ${a}, 공차가 ${d}인 등차수열의 제${n}항은?`; ans = a + (n - 1) * d; exp = `${a} + ${n - 1}×${d} = ${ans}`; }
  else { const c = ri(2, 6); text = `lim(x→${c}) (x² - ${c * c}) / (x - ${c}) 의 값은?`; ans = 2 * c; exp = `(x + ${c})로 약분하면 ${2 * c}`; }
  const set = new Set([ans]); while (set.size < 5) { const v = ans + ri(-6, 6); if (v > 0) set.add(v); }
  const ch = [...set].sort((a, b) => a - b);
  return { text, choices: ch.map(String), ans: ch.indexOf(ans), exp };
}
const pools = {};
function fromPool(key, arr) { if (!pools[key] || !pools[key].length) pools[key] = shuffle([...arr.keys()]); return arr[pools[key].pop()]; }
export function makeQuestion(subj, no) {
  let q;
  if (subj === '수학') q = genMath();
  else if (subj === '영어') {
    const [w, m] = fromPool('eng', ENG); const others = shuffle(ENG.filter((e) => e[0] !== w)).slice(0, 4).map((e) => e[1]);
    const ch = shuffle([m, ...others]);
    q = { text: `다음 글의 밑줄 친 "${w}"의 의미로 가장 적절한 것은?`, choices: ch, ans: ch.indexOf(m), exp: `"${w}"는 "${m}"이라는 뜻입니다.` };
  } else {
    const b = fromPool(subj, subj === '국어' ? KOR : SCI); const idx = shuffle([0, 1, 2, 3, 4]);
    q = { text: b[0], choices: idx.map((i) => b[1][i]), ans: idx.indexOf(b[2]), exp: b[3] };
  }
  q.subj = subj; q.no = no; return q;
}

// ───────── AI 안경 (어떤 질문이든 무조건 대답) ─────────
const KB = [
  [/(대한민국|한국).*수도|수도.*(한국|대한민국)/, '대한민국의 수도는 서울입니다.'],
  [/일본.*수도/, '일본의 수도는 도쿄입니다.'], [/미국.*수도/, '미국의 수도는 워싱턴 D.C.입니다.'],
  [/프랑스.*수도/, '프랑스의 수도는 파리입니다.'], [/중국.*수도/, '중국의 수도는 베이징입니다.'], [/영국.*수도/, '영국의 수도는 런던입니다.'],
  [/세종/, '세종대왕은 조선 제4대 왕으로, 1443년 훈민정음을 창제했습니다.'],
  [/이순신/, '이순신 장군은 임진왜란 때 한산도대첩·명량해전 등에서 승리한 조선의 명장입니다.'],
  [/광합성/, '광합성: 6CO₂ + 6H₂O + 빛 에너지 → C₆H₁₂O₆ + 6O₂ (엽록체에서 일어남)'],
  [/미분/, '미분은 순간 변화율입니다. xⁿ을 미분하면 n·xⁿ⁻¹ 입니다.'],
  [/적분/, '적분은 미분의 역연산입니다. xⁿ의 부정적분은 xⁿ⁺¹/(n+1) + C 입니다.'],
  [/피타고라스/, '직각삼각형에서 a² + b² = c² (c는 빗변) 입니다.'],
  [/근의\s*공식/, 'ax² + bx + c = 0 의 근: x = (-b ± √(b² - 4ac)) / 2a'],
  [/뉴턴|운동\s*법칙/, '뉴턴 운동 법칙: 제1법칙 관성, 제2법칙 F = ma, 제3법칙 작용·반작용'],
  [/빛의\s*속도|광속/, '빛의 속도는 약 30만 km/s (2.998×10⁸ m/s) 입니다.'],
  [/물.*화학식|화학식.*물/, '물의 화학식은 H₂O 입니다.'],
  [/임진왜란/, '임진왜란은 1592년 일본이 조선을 침략하며 시작된 전쟁입니다.'],
  [/한국\s*전쟁|6\.?\s*25/, '6·25 전쟁은 1950년 6월 25일에 일어났습니다.'],
  [/광복/, '광복절은 1945년 8월 15일입니다.'],
  [/dna|디엔에이/i, 'DNA는 이중 나선 구조이며 A-T, G-C 염기쌍으로 이루어집니다.'],
  [/지구.*(나이|역사)/, '지구의 나이는 약 46억 년입니다.'],
  [/수능/, '수능은 국어 → 수학 → 영어 → 한국사·탐구 → 제2외국어 순서로 진행됩니다. 화이팅!'],
  [/^(안녕|하이|hello|hi)/i, '안녕하세요! AI 안경입니다. 무엇이든 물어보세요. (감독관 조심!)'],
  [/(누구|정체|이름).*(너|넌|당신)|(너|넌|당신).*(누구|정체|이름)/, '저는 수능용 AI 안경 어시스턴트입니다. 모든 질문에 답해 드려요.'],
  [/(들킬|걸리|감독|선생)/, '감독관이 가까이 오면 저를 쓰지 마세요. 너무 빨리 답을 쓰면 의심받아요.'],
];
const DICT = { 사과: 'apple', 학교: 'school', 시험: 'exam / test', 선생님: 'teacher', 학생: 'student', 안경: 'glasses', 친구: 'friend', 사랑: 'love', 행복: 'happiness', 공부: 'study', 물: 'water', 책: 'book', 연필: 'pencil', 고양이: 'cat', 강아지: 'puppy', 하늘: 'sky', 바다: 'sea', 꿈: 'dream', 미래: 'future', 대학교: 'university', 합격: 'pass', 점심: 'lunch', 시간: 'time', 수학: 'math', 영어: 'English', 과학: 'science', 역사: 'history', 컴퓨터: 'computer', 인공지능: 'artificial intelligence', 감독관: 'proctor', 정답: 'answer', 문제: 'question' };
function translate(t) {
  let m = t.match(/([가-힣]+?)(?:을|를|은|는|이|가)?\s*영어로/);
  if (m && DICT[m[1]]) return `"${m[1]}"은(는) 영어로 "${DICT[m[1]]}" 입니다.`;
  m = t.match(/([a-zA-Z]{2,})/);
  if (m && /(뜻|의미|해석|무슨|번역)/.test(t)) {
    const w = m[1].toLowerCase(), e = ENG.find((x) => x[0] === w);
    if (e) return `"${w}"는 "${e[1]}"라는 뜻입니다.`;
    const d = Object.entries(DICT).find(([, v]) => v.toLowerCase().split(' / ').includes(w));
    if (d) return `"${w}"는 "${d[0]}"라는 뜻입니다.`;
    return `"${w}"는 문맥상 "${pick(['중요한', '변화', '결과', '유지하다', '특별한'])}"의 의미로 쓰였을 가능성이 높습니다.`;
  }
  return null;
}
function quad(t) {
  const s = t.replace(/\s/g, '').replace(/²/g, '^2');
  const m = s.match(/([+-]?\d*)x\^2([+-]\d*)x([+-]\d+)=0/); if (!m) return null;
  const co = (v) => (v === '' || v === '+' ? 1 : v === '-' ? -1 : +v);
  const a = co(m[1]), b = co(m[2]), c = +m[3], D = b * b - 4 * a * c, f = (v) => +v.toFixed(4);
  if (D < 0) return `판별식 D = ${D} < 0 이므로 실근이 없습니다. (서로 다른 두 허근)`;
  const r1 = (-b + Math.sqrt(D)) / (2 * a), r2 = (-b - Math.sqrt(D)) / (2 * a);
  return `x = ${f(r1)}${D > 0 ? `, ${f(r2)}` : ' (중근)'}\n두 근의 합 = ${f(-b / a)}, 두 근의 곱 = ${f(c / a)}`;
}
function calc(t) {
  const s = t.replace(/[×xX*＊]/g, '*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/[^\d+\-*/().%]/g, '');
  if (!/\d[+\-*/%]+\(?-?\d/.test(s)) return null;
  try { const v = Function('"use strict";return(' + s + ')')(); if (typeof v === 'number' && isFinite(v)) return Math.round(v * 1e6) / 1e6; } catch (e) { /* 계산 불가 */ }
  return null;
}
function similar(a, b) { const s = new Set(a.replace(/\s/g, '')); if (s.size < 6) return false; let k = 0; for (const ch of s) if (b.includes(ch)) k++; return k / s.size > .75; }
function generic(t) {
  const k = t.replace(/[?？!.~]+$/, '').slice(0, 40);
  if (/왜|이유/.test(t)) return `"${k}" — 이유를 정리하면:\n① 기본 원리(개념) 때문에 그런 결과가 나타나고\n② 주어진 조건이 그 효과를 더 크게 만들기 때문입니다.\n서술형이면 ①을 중심으로 쓰세요.`;
  if (/어떻게|방법|하려면/.test(t)) return `"${k}" 방법:\n1) 핵심 조건을 먼저 정리합니다.\n2) 알맞은 공식·개념을 적용합니다.\n3) 마지막에 검산합니다.`;
  if (/누구|누가/.test(t)) return `"${k}" → ${pick(['세종대왕', '이순신 장군', '뉴턴', '아인슈타인', '정약용', '장영실'])}일 가능성이 가장 높습니다.`;
  if (/언제|몇\s*년/.test(t)) return `"${k}" → ${pick(['1446년', '1592년', '1945년', '1950년', '1988년', '2002년'])} 무렵으로 알려져 있습니다.`;
  if (/어디/.test(t)) return `"${k}" → ${pick(['서울', '경주', '부산', '제주도', '한양', '개성'])}입니다.`;
  if (/뭐|무엇|무슨/.test(t)) return `"${k}"에 대한 설명: ${pick(['기본 개념을 실제 상황에 적용한 것', '기본 원리를 확장한 개념', '여러 요소가 결합되어 나타난 결과'])}입니다. 한 줄 요약: 기본에 충실하라!`;
  if (/(까|나요|니|냐|야|죠|지|래)\??$/.test(t)) return `${pick(['네, 맞습니다.', '아니요, 그렇지 않습니다.', '대체로 그렇습니다.'])} "${k}"에 대해 분석한 결과예요. (확신도 ${ri(86, 99)}%)`;
  return pick([`"${k}" 확인했어요. 핵심은 조건을 정확히 파악하는 거예요. 답은 문제에 주어진 정보 안에 있습니다!`, `"${k}"에 대한 답: 지금 상황에서 가장 합리적인 선택은 기본 개념을 그대로 적용하는 것입니다.`, `분석 완료. "${k}" — 정리하면 원인 → 과정 → 결과 순서로 생각하면 됩니다.`]);
}
export function aiAnswer(raw, cur) {
  const t = raw.trim(); if (!t) return '질문을 입력해 주세요!';
  const C = '①②③④⑤';
  const hint = cur ? `\n\n(참고: 지금 ${cur.subj} ${cur.no}번 정답은 ${C[cur.ans]}번)` : '';
  if (cur && (/(답|정답|몇\s*번|문제|풀어|알려|도와|모르)/.test(t) || similar(t, cur.text))) return `${cur.subj} ${cur.no}번 정답: ${C[cur.ans]} ${cur.choices[cur.ans]}\n해설: ${cur.exp}`;
  const q = quad(t); if (q) return q;
  const v = calc(t); if (v !== null) return `계산 결과: ${v}`;
  const tr = translate(t); if (tr) return tr;
  for (const [re, a] of KB) if (re.test(t)) return a + hint;
  return generic(t) + hint;
}
