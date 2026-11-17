// 수능 감독관 — 데이터: 아이콘(SVG 그림), 효과음(실시간 합성), 무기, 문제, AI 안경 응답
'use strict';

// ───────── SVG 아이콘 (그라데이션·음영을 넣어 직접 그린 그림) ─────────
const S = (b) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${b}</svg>`;
const LG = (id, a, b, x2 = 0, y2 = 1) => `<linearGradient id="${id}$" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const RG = (id, a, b, cx = .35, cy = .3) => `<radialGradient id="${id}$" cx="${cx}" cy="${cy}" r=".75"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
const HEART = 'M32 55 9.5 33.5C2 26 3.5 13.5 13 10.2c7-2.4 14 .8 19 7.6 5-6.8 12-10 19-7.6C60.5 13.5 62 26 54.5 33.5Z';
const SH = '<filter id="d$" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".45"/></filter>';
export const ICONS = {
  heart: S(`<defs>${RG('h', '#ff8fa0', '#d4122f')}${SH}</defs><path d="${HEART}" fill="url(#h$)" stroke="#6e0717" stroke-width="2.5" stroke-linejoin="round" filter="url(#d$)"/><path d="M14 19c2.5-5 8-6 11.5-3.5" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".7"/>`),
  heart0: S(`<defs>${LG('h', '#4a4f60', '#23262f')}</defs><path d="${HEART}" fill="url(#h$)" stroke="#5c6275" stroke-width="2.5" stroke-linejoin="round"/>`),
  coin: S(`<defs>${RG('c', '#fff3b0', '#d99400')}${LG('e', '#ffd75e', '#a86a00')}${SH}</defs><g filter="url(#d$)"><circle cx="32" cy="32" r="27" fill="url(#e$)"/><circle cx="32" cy="32" r="23" fill="url(#c$)"/><circle cx="32" cy="32" r="17.5" fill="none" stroke="#b07a00" stroke-width="2" opacity=".7"/></g><path d="M38.5 24.5a9.5 9.5 0 1 0 0 15" fill="none" stroke="#8a5800" stroke-width="5" stroke-linecap="round"/><path d="M17 22a17 17 0 0 1 12-9" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".75"/>`),
  gear: S(`<defs>${LG('g', '#ffffff', '#9aa6b8')}</defs><circle cx="32" cy="32" r="21" fill="none" stroke="url(#g$)" stroke-width="10" stroke-dasharray="8.25 8.24"/><circle cx="32" cy="32" r="17" fill="url(#g$)"/><circle cx="32" cy="32" r="7" fill="#1c2232"/>`),
  chat: S(`<defs>${LG('c', '#ffffff', '#cdd8f0')}</defs><path d="M10 9h44a7 7 0 0 1 7 7v25a7 7 0 0 1-7 7H29L15 58V48h-5a7 7 0 0 1-7-7V16a7 7 0 0 1 7-7Z" fill="url(#c$)"/><circle cx="20" cy="28.5" r="3.6" fill="#33405e"/><circle cx="32" cy="28.5" r="3.6" fill="#33405e"/><circle cx="44" cy="28.5" r="3.6" fill="#33405e"/>`),
  send: S(`<defs>${LG('s', '#ffffff', '#b8c8ff')}</defs><path d="M5 30 59 7 46 57 31 38Z" fill="url(#s$)"/><path d="M31 38 59 7 22 33Z" fill="#7d93d8"/>`),
  jump: S(`<defs>${LG('j', '#ffffff', '#c4ccd8')}</defs><path d="M32 8 52 28H40v8H24v-8H12Z" fill="url(#j$)"/><path d="M14 44 32 30l18 14" fill="none" stroke="url(#j$)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/><path d="M14 56 32 42l18 14" fill="none" stroke="url(#j$)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".45"/>`),
  attack: S(`<circle cx="32" cy="32" r="18" fill="none" stroke="#fff" stroke-width="4"/><path d="M32 6v14M32 44v14M6 32h14M44 32h14" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="32" r="4.5" fill="#ff4b5c"/>`),
  snatch: S(`<defs>${LG('l', '#bff6ff', '#1aa3d6')}</defs><g stroke="#151515" stroke-width="4.5" fill="url(#l$)" fill-opacity=".85"><rect x="4" y="27" width="24" height="18" rx="8"/><rect x="36" y="27" width="24" height="18" rx="8"/></g><path d="M28 33q4-4 8 0" stroke="#151515" stroke-width="4" fill="none"/><path d="M9 32h9M41 32h9" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".8"/><path d="M34 4 28 16l7 4-6 13" stroke="#ff4040" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  punch: S(`<defs>${LG('f', '#ffe1c4', '#d9935e')}${LG('k', '#3e6cb0', '#1d3560')}</defs><rect x="24" y="44" width="22" height="14" rx="3" fill="url(#k$)"/><path d="M20 14h26a8 8 0 0 1 8 8v14a10 10 0 0 1-10 10H26a10 10 0 0 1-10-10V18a4 4 0 0 1 4-4Z" fill="url(#f$)" stroke="#8a5530" stroke-width="2.5"/><path d="M29 14v12M37.5 14v12M46 15v11" stroke="#8a5530" stroke-width="2" opacity=".7"/><path d="M16 30h13a5 5 0 0 1 0 10H18" fill="url(#f$)" stroke="#8a5530" stroke-width="2.5"/>`),
  bat: S(`<defs>${LG('w', '#f6d29a', '#b47432', 1, 1)}</defs><path d="M9 51l4 4 37-34c5-5 6-11 2.5-14.5S43 3.5 38 8.5Z" fill="url(#w$)" stroke="#6b3f12" stroke-width="2"/><path d="M41 11q5 1 8 6" stroke="#fff" stroke-width="2.5" fill="none" opacity=".55" stroke-linecap="round"/><path d="M11 44.5l8.5 8.5" stroke="#1b1b1b" stroke-width="7"/><path d="M12.5 43l7 7M15 41l7 7" stroke="#444" stroke-width="1.2"/><circle cx="9.5" cy="54.5" r="5" fill="#5a3510"/>`),
  pistol: S(`<defs>${LG('m', '#5b6068', '#16181b')}${LG('p', '#2b2d31', '#0c0d0f')}</defs><path d="M6 19h50a2 2 0 0 1 2 2v9H6Z" fill="url(#m$)"/><path d="M6 21h50" stroke="#8a9098" stroke-width="1.2"/><rect x="54" y="19" width="5" height="11" fill="#ff6a00"/><path d="M42 21v8M45 21v8M48 21v8" stroke="#0a0a0a" stroke-width="1.4"/><path d="M8 30h36l-3 4H30l-1.5 3.5v15a3 3 0 0 1-3 3H15.5a3 3 0 0 1-3-3.4L15 34H8Z" fill="url(#p$)"/><path d="M29 35q5 5 0 9" stroke="#3a3d42" stroke-width="2.5" fill="none"/>`),
  ak: S(`<defs>${LG('m', '#5a5f66', '#141518')}${LG('w', '#c8743a', '#6e2e0c')}${LG('o', '#e0742a', '#8a3410')}</defs><path d="M2 30 13 23h11v9H14l-9 11H1Z" fill="url(#w$)"/><rect x="22" y="22" width="22" height="9" rx="1.5" fill="url(#m$)"/><path d="M42 23h12v6H42Z" fill="url(#w$)"/><rect x="52" y="24.5" width="11" height="2.8" fill="#1d1e21"/><rect x="61" y="23.8" width="2.6" height="4.2" fill="#ff6a00"/><path d="M33 31h6l4 11 1 6-6 1-3-8Z" fill="url(#o$)"/><path d="M25 31h5l-1.5 10h-5Z" fill="#1d1e21"/><path d="M23 22h21" stroke="#9aa0a8" stroke-width="1"/>`),
  rpg: S(`<defs>${LG('t', '#7a8a58', '#2f3a20')}${LG('h', '#a8653a', '#5a2c10')}${LG('r', '#ff6b4a', '#a01a10')}</defs><path d="M2 27l6-3h34v12H8l-6-3Z" fill="url(#t$)"/><rect x="18" y="24.5" width="13" height="11" rx="1" fill="url(#h$)"/><path d="M42 26h5l12 4-12 4h-5Z" fill="url(#r$)"/><path d="M45 26v8" stroke="#ffd400" stroke-width="2"/><path d="M15 36h5l-2 11h-5ZM27 36h5l-1 8h-5Z" fill="#1e1e1e"/><rect x="24" y="18" width="9" height="6" rx="1.5" fill="#22261c"/><circle cx="32" cy="21" r="2" fill="#5a8ad8"/>`),
  tackle: S(`<defs>${LG('s', '#ffffff', '#7d8794', 1, 1)}</defs><g fill="none" stroke="url(#s$)" stroke-width="5.5"><circle cx="17" cy="41" r="12"/><circle cx="47" cy="41" r="12"/></g><g fill="none" stroke="#56606c" stroke-width="1.6"><circle cx="17" cy="41" r="12"/><circle cx="47" cy="41" r="12"/></g><rect x="13" y="23" width="9" height="8" rx="1.5" fill="url(#s$)"/><rect x="42" y="23" width="9" height="8" rx="1.5" fill="url(#s$)"/><path d="M22 26q5-6 10 0 5-6 10 0" stroke="url(#s$)" stroke-width="3.5" fill="none"/>`),
  hack: S(`<defs>${RG('h', '#1f5a36', '#06140c')}</defs><rect x="14" y="14" width="36" height="36" rx="6" fill="url(#h$)" stroke="#2bff88" stroke-width="2.5"/><path d="M21 8v6M32 8v6M43 8v6M21 50v6M32 50v6M43 50v6M8 21h6M8 32h6M8 43h6M50 21h6M50 32h6M50 43h6" stroke="#2bff88" stroke-width="3" stroke-linecap="round"/><path d="M27 25l-6 7 6 7M37 25l6 7-6 7" stroke="#7dffb5" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  close: S(`<path d="M17 17l30 30M47 17 17 47" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`),
  ai: S(`<defs>${LG('l', '#b8fbff', '#0d9cc4')}</defs><g stroke="#0b1622" stroke-width="3.5" fill="url(#l$)"><rect x="4" y="22" width="25" height="19" rx="8"/><rect x="35" y="22" width="25" height="19" rx="8"/></g><path d="M29 29h6" stroke="#0b1622" stroke-width="3.5"/><path d="M10 29h11M41 29h11" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".85"/><circle cx="56" cy="15" r="4.5" fill="#7af7ff"/><circle cx="56" cy="15" r="8" fill="#7af7ff" opacity=".25"/>`),
  pencil: S(`<defs>${LG('y', '#ffe680', '#e0a400', 1, 0)}</defs><path d="M14 50 18 36 44 10l10 10-26 26Z" fill="url(#y$)" stroke="#7a5b00" stroke-width="2"/><path d="M14 50l4-14 10 10Z" fill="#f5d9ab" stroke="#7a5b00" stroke-width="2"/><path d="M14 50l1.6-5.2 3.6 3.6Z" fill="#222"/><path d="M40 14l10 10" stroke="#ff7c96" stroke-width="6"/><path d="M38 16l10 10" stroke="#c9c9c9" stroke-width="2"/>`),
  eye: S(`<defs>${RG('i', '#7fb0ff', '#173a8a', .5, .5)}</defs><path d="M3 32Q32 6 61 32 32 58 3 32Z" fill="#f4f4f2" stroke="#1a1a1a" stroke-width="3"/><circle cx="32" cy="32" r="11" fill="url(#i$)"/><circle cx="32" cy="32" r="5" fill="#0b0b0b"/><circle cx="28" cy="28" r="2.6" fill="#fff"/>`),
  exit: S(`<defs>${LG('x', '#ffffff', '#c6cfdc')}</defs><path d="M27 12H14a3 3 0 0 0-3 3v34a3 3 0 0 0 3 3h13" fill="none" stroke="url(#x$)" stroke-width="5" stroke-linecap="round"/><path d="M26 32h28M45 22l10 10-10 10" stroke="url(#x$)" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  view: S(`<defs>${LG('v', '#ffffff', '#c6cfdc')}</defs><rect x="6" y="18" width="40" height="30" rx="6" fill="url(#v$)"/><path d="M46 28l12-7v24l-12-7Z" fill="url(#v$)"/><circle cx="26" cy="33" r="8" fill="#1f2a40"/><circle cx="26" cy="33" r="3.5" fill="#6fa0ff"/>`),
  teacher: S(`<defs>${LG('s', '#3a4766', '#151b2c')}${RG('f', '#ffe3c8', '#d9a173')}</defs><path d="M9 64q0-25 23-25t23 25Z" fill="url(#s$)"/><path d="M25 39l7 8 7-8" fill="#fff"/><path d="M32 45l-3 4 3 14 3-14Z" fill="#d42a3a"/><circle cx="32" cy="21" r="12.5" fill="url(#f$)"/><path d="M19.5 19q1-13 13-13t12 12q-6-6-12-5.5-7 0-13 6.5Z" fill="#231f1c"/><g fill="none" stroke="#9aa2ac" stroke-width="1.6"><circle cx="27" cy="22" r="4"/><circle cx="37" cy="22" r="4"/></g><circle cx="27" cy="22" r="1.5" fill="#222"/><circle cx="37" cy="22" r="1.5" fill="#222"/><path d="M28.5 28.5q3.5 2 7 0" stroke="#8a4a3a" stroke-width="1.6" fill="none" stroke-linecap="round"/>`),
  student: S(`<defs>${LG('s', '#4b80c4', '#1f3d6e')}${RG('f', '#ffe6cf', '#dca47a')}${LG('l', '#c8fbff', '#22b4dd')}</defs><path d="M9 64q0-25 23-25t23 25Z" fill="url(#s$)"/><path d="M24 40q8 7 16 0" fill="none" stroke="#173055" stroke-width="3"/><circle cx="32" cy="22" r="12.5" fill="url(#f$)"/><path d="M19 22q0-15 13-15t13 15q-3-7-13-7.5T19 22Z" fill="#17120f"/><g fill="url(#l$)" fill-opacity=".7" stroke="#0e0e0e" stroke-width="2.2"><rect x="21.5" y="19.5" width="9" height="7" rx="2.5"/><rect x="33.5" y="19.5" width="9" height="7" rx="2.5"/></g><circle cx="45" cy="19" r="2" fill="#7af7ff"/>`),
  lock: S(`<defs>${LG('g', '#ffd75e', '#b07a00')}</defs><path d="M20 28v-8a12 12 0 0 1 24 0v8" fill="none" stroke="#cfd8e3" stroke-width="6"/><rect x="12" y="28" width="40" height="28" rx="6" fill="url(#g$)"/><circle cx="32" cy="40" r="4" fill="#6a4500"/><path d="M32 42v7" stroke="#6a4500" stroke-width="4"/>`),
  check: S(`<path d="M12 34l13 13 27-29" stroke="#4dff9a" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  star: S(`<defs>${RG('s', '#fff6c0', '#e6a800')}</defs><path d="M32 5l8 17 18 2-13.5 12.5L48 55 32 46 16 55l3.5-18.5L6 24l18-2Z" fill="url(#s$)" stroke="#9a6e00" stroke-width="2" stroke-linejoin="round"/>`),
  lunch: S(`<defs>${LG('b', '#ffae6b', '#d9581a')}</defs><rect x="8" y="22" width="48" height="32" rx="7" fill="url(#b$)" stroke="#7a3000" stroke-width="2"/><path d="M8 34h48M32 34v20" stroke="#7a3000" stroke-width="2"/><path d="M24 22v-5a8 8 0 0 1 16 0v5" fill="none" stroke="#7a3000" stroke-width="4"/><circle cx="20" cy="44" r="4.5" fill="#fff"/><circle cx="44" cy="44" r="4.5" fill="#7bd651"/>`),
  bell: S(`<defs>${LG('b', '#ffe680', '#c99400')}</defs><path d="M32 6a4 4 0 0 1 4 4v2c9 2 14 10 14 20v10l6 6H8l6-6V32c0-10 5-18 14-20v-2a4 4 0 0 1 4-4Z" fill="url(#b$)" stroke="#7a5b00" stroke-width="2"/><path d="M25 52a7 7 0 0 0 14 0" fill="#7a5b00"/>`),
};
let _ic = 0;
export const icon = (n) => { const s = ICONS[n]; if (!s) return ''; const id = '_' + (++_ic); return s.replace(/\$/g, id); };

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
