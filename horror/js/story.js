// 이야기 글 · 아이콘(SVG 그림)
export const DIARY = {
  1: {
    title: '찢어진 일기 — 첫 번째 장', who: '먼저 잡혀 온 사람', where: '01 침실',
    text: d => `며칠째인지 모르겠다. 나도 그 녀석을 팔로우하지 않았다.
그것뿐인데, 눈을 떠 보니 이 저택이었다.

그 녀석 — <b>초록모자</b>는 저택을 천천히 걸어 다닌다.
멀리서 발소리가 들리고 <b>불이 깜빡이면</b> 녀석이 가까이 온 거다.
<b>옷장</b>이나 <b>침대 밑</b>, 큰 <b>서랍장</b>에 숨어. 녀석은 사람 <b>목소리</b>를 듣는다.

<b>녹슨 열쇠</b>는 <b>08 부엌</b> 싱크대 서랍에 숨겨 두었다. 그걸로 <b>04 서재</b>를 열 수 있다.

현관문 비밀번호는 네 자리. 일기 네 장에 하나씩 나눠 적었다.
<b>첫 번째 숫자는 『 ${d} 』</b>`,
  },
  2: {
    title: '찢어진 일기 — 두 번째 장', who: '먼저 잡혀 온 사람', where: '04 서재',
    text: d => `서재까지 왔다. 손이 떨려서 글씨가 엉망이다.

<b>은색 열쇠</b>는 옆방 <b>05 음악실</b>의 서랍장에 있다.
그 열쇠는 <b>06 아이방</b> 문을 연다.

녀석은 문을 아무렇지 않게 열고 다닌다.
복도 끝에서 녀석의 모자가 보이면, 절대 눈을 마주치지 마.

<b>두 번째 숫자는 『 ${d} 』</b>`,
  },
  3: {
    title: '크레용 일기', who: '아이', where: '06 아이방',
    text: d => `초록모자 아저씨가 맨날 물어봐. "팔로우 해줄 거지?"
싫다고 하니까 아저씨가 엄청 화냈어.

<b>검은 열쇠</b>를 내 <b>장난감 상자</b>에 숨겼어. <b>09 갤러리</b> 문 열쇠야.
갤러리 동상들은 내가 안 볼 때 고개를 돌려. 진짜야.
갤러리를 지나면 <b>남쪽 복도</b>랑 <b>초상화 방</b>이 있대.

<b>세 번째 숫자는 『 ${d} 』</b>`,
  },
  4: {
    title: '마지막 장', who: '먼저 잡혀 온 사람', where: '20 초상화 방',
    text: d => `여기까지 온 사람이 있다면.

<b>금색 열쇠</b>는 <b>11 예배당 제단 서랍</b>에 있다. 현관 홀 옆이다. 현관문 자물쇠를 연다.
비밀번호 장치는 현관문 오른쪽에 있다.

<b>마지막 숫자는 『 ${d} 』</b>

문 밖은 아주 밝다고 한다. 나는 끝내 보지 못했지만.`,
  },
};
export const KEYS = { rusty: '녹슨 열쇠', silver: '은색 열쇠', iron: '검은 열쇠', gold: '금색 열쇠' };
export const KEY_ORDER = ['rusty', 'silver', 'iron', 'gold'];

const sv = (inner, fill = false) => `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
export const ICONS = {
  hand: sv('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5"/><path d="M14 11.5V5.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1c-2.8 0-4.4-1.3-6-3.8l-2.6-4.4a1.5 1.5 0 0 1 2.5-1.7L8 13.5"/>'),
  run: sv('<circle cx="15.5" cy="4" r="2"/><path d="M13.5 7.5 10.5 13l3.5 2.5-1.5 6"/><path d="M13.5 7.5 17 10.5l3-1"/><path d="M12.5 8.5 8.5 9l-2 3"/><path d="M10.5 13 8 17.5H4"/>'),
  torch: sv('<path d="M14.5 3.5l6 6-3 2.5-5.5-5.5z"/><path d="M12 6.5 4.2 14.3a1.8 1.8 0 0 0 0 2.5l3 3a1.8 1.8 0 0 0 2.5 0L17.5 12"/><path d="M8.5 13l2.5 2.5"/><path d="M19 2l1.5-1.5M22 5l1.5-.5M21.5 1.5 23 0"/>'),
  book: sv('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6M9 10.5h4"/>'),
  pause: sv('<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>'),
  mic: sv('<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3.5M8.5 21.5h7"/>'),
  micOff: sv('<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3.5M8.5 21.5h7"/><path d="M3 3l18 18"/>'),
  heart: sv('<path d="M12 20.5s-7.5-4.6-9.2-9.6A5 5 0 0 1 12 7a5 5 0 0 1 9.2 3.9c-1.7 5-9.2 9.6-9.2 9.6z"/>', true),
  key: sv('<circle cx="7.5" cy="15.5" r="4"/><path d="M10.5 12.5 20 3M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>'),
  door: sv('<path d="M14 3H5v18h9"/><path d="M14 3l5 1.5v15L14 21z"/><path d="M12 12h.01"/><path d="M9 12H2M4.5 9.5 2 12l2.5 2.5"/>'),
  eye: sv('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 21 21 3"/>'),
  skip: sv('<path d="M5 5l8 7-8 7z" /><path d="M13 5l8 7-8 7z"/>', true),
  gear: sv('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  ear: sv('<path d="M7 9a5 5 0 0 1 10 0c0 3-2.5 4-3 6.5S12.5 20 10 20a3 3 0 0 1-3-3"/><path d="M10 9a2 2 0 0 1 4 0c0 1.5-2 2-2 3.5"/>'),
  close: sv('<path d="M5 5l14 14M19 5 5 19"/>'),
  search: sv('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/><path d="M8 10.5h5M10.5 8v5"/>'),
  pen: sv('<path d="M4 20l1.2-4.6L16 4.6a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M14 6.6l3.4 3.4"/><path d="M4 20h7"/>'),
  chat: sv('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h-1A.5.5 0 0 1 4 15.5z"/><path d="M8 8.5h8M8 11.5h5"/>'),
  crouch: sv('<circle cx="12" cy="5" r="2"/><path d="M12 7.5 10.5 12l4 1.5-1 5.5"/><path d="M10.5 12l-3 3.5h-3"/><path d="M11.5 9l3.5 1.5"/>'),
  prone: sv('<circle cx="19" cy="13" r="2"/><path d="M17 14.5H9l-5 2"/><path d="M13 14.5l-2.5-3.5"/><path d="M3 19h18"/>'),
  heal: sv('<rect x="3" y="7" width="18" height="10" rx="3"/><path d="M12 9.5v5M9.5 12h5"/>'),
  up: sv('<path d="M6 15l6-6 6 6"/>'), down: sv('<path d="M6 9l6 6 6-6"/>'),
  back: sv('<path d="M15 5l-7 7 7 7"/>'),
  users: sv('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>'),
  wrench: sv('<path d="M14.5 6.5a4 4 0 0 0 5 5l-8.5 8.5a2.1 2.1 0 0 1-3-3L16.5 8.5"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>'),
  send: sv('<path d="M4 12 20 4l-6 16-2.5-6.5z"/><path d="M11.5 13.5 20 4"/>'),
  play: sv('<path d="M7 4.5v15l12-7.5z"/>', true),
  finger: `<svg viewBox="0 0 48 64"><path d="M18 34V8a5 5 0 0 1 10 0v18l12 3a6 6 0 0 1 4.5 7L42 52a10 10 0 0 1-10 9H24a10 10 0 0 1-8-4L6 44a4.5 4.5 0 0 1 7-5.5l5 5z" fill="#f2d2b0" stroke="#5a3a2a" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
};
export function paintIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach(i => { i.innerHTML = ICONS[i.dataset.icon] || ''; });
}
