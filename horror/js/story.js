// 이야기 글 · 아이콘(SVG 그림)
export const DIARY = {
  1: {
    title: '찢어진 일기 — 첫 번째 장',
    who: '먼저 잡혀 온 사람',
    text: `며칠째인지 모르겠다. 나도 그 녀석을 팔로우하지 않았다.
그것뿐인데, 눈을 떠 보니 이 저택이었다.

그 녀석 — <b>초록모자</b>는 소리에 반응한다.
크게 말하거나 뛰어다니면 <b>반드시</b> 온다.

발소리가 들리면 <b>옷장</b>이나 <b>침대 밑</b>, 큰 <b>서랍장</b>에 숨어.
숨어서도 절대 소리 내면 안 된다. 그 녀석은 다 듣고 있다.

서재 문은 잠겨 있다.
<b>녹슨 열쇠</b>를 침대 옆 <b>협탁 서랍</b>에 숨겨 두었다.`,
  },
  2: {
    title: '찢어진 일기 — 두 번째 장',
    who: '먼저 잡혀 온 사람',
    text: `현관문에는 <b>금색 자물쇠</b>와 <b>비밀번호 장치</b>가 달려 있다.

비밀번호는 네 자리.
그 녀석은 자기가 아끼는 물건에 숫자를 하나씩 새겨 둔다.
순서는 — <b>거울 → 괘종시계 → 초상화 → 피아노</b>.

아이방 문을 여는 <b>은색 열쇠</b>는 이 책상 서랍에 넣어 두었다.
금색 열쇠는... 아이방 어딘가에 있다고 들었다.

나는 여기까지다. 발소리가 가까워진다.`,
  },
  3: {
    title: '크레용 일기',
    who: '아이',
    text: `초록모자 아저씨가 맨날 물어봐.
"팔로우 해줄 거지?"

싫다고 하니까 아저씨가 엄청 화냈어.
아저씨가 무서워서 반짝이는 <b>금색 열쇠</b>를
내 <b>장난감 상자</b>에 숨겼어.

아저씨는 밝은 걸 싫어해.
현관문 밖은 엄청 밝대.
나도 언젠가 나갈 수 있을까?`,
  },
};
export const CLUE = {
  mirror: { name: '거울', text: d => `김 서린 거울에 누군가 손가락으로 쓴 숫자가 있다.  『 ${d} 』` },
  clock: { name: '괘종시계', text: d => `멈춘 괘종시계. 시계판 아래에 붉은 숫자가 새겨져 있다.  『 ${d} 』` },
  portrait: { name: '초상화', text: d => `초록모자의 초상화. 액자 아래 벽에 피로 쓴 숫자.  『 ${d} 』` },
  piano: { name: '피아노', text: d => `피아노 위 악보에 붉게 동그라미 친 숫자가 있다.  『 ${d} 』` },
};
export const ORDER = ['mirror', 'clock', 'portrait', 'piano'];
export const KEYS = { rusty: '녹슨 열쇠', silver: '은색 열쇠', gold: '금색 열쇠' };

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
  finger: `<svg viewBox="0 0 48 64"><path d="M18 34V8a5 5 0 0 1 10 0v18l12 3a6 6 0 0 1 4.5 7L42 52a10 10 0 0 1-10 9H24a10 10 0 0 1-8-4L6 44a4.5 4.5 0 0 1 7-5.5l5 5z" fill="#f2d2b0" stroke="#5a3a2a" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
};
export function paintIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach(i => { i.innerHTML = ICONS[i.dataset.icon] || ''; });
}
