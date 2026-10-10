// FREE FREELY - 벡터 아이콘 · 버튼 프레임 라이브러리
// 모든 UI 아이콘은 이 파일의 SVG 경로로 그린다 (이모티콘·아이콘 폰트 사용 금지).
// 규칙: 24×24 그리드, 둥근 끝 선(1.75px) + 부분 채움, 기본 흰색/청록, 강조 주황, 경고 빨강.
// HTML 은 inline SVG(icon()), 캔버스 HUD 는 같은 경로를 Path2D 로 그린다(drawIcon()).
//
// 파트 형식: { d: 'SVG path', f: 채움 불투명도(0~1, 생략 시 선만), s: false(선 없음),
//              a: 애니메이션 종류, c: 'accent'|'warn'|'dim'|'cyan' 색 역할, w: 선 굵기 }
// 애니메이션 종류: spin(회전), flow(가로 흐름·행성 자전), flick(불꽃 흔들림), wobble(기울기 흔들림),
//                  twinkle(반짝임), pulse(맥동), orbit(궤도 공전), bob(상하), sway(좌우), heat(일렁임), draw(선 그리기)

const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
const ell = (cx, cy, rx, ry) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
const P = circ(12, 12, 7);   // 표준 행성 원판

/** 행성 표면 무늬를 두 번 그려(14px 간격) 가로 흐름으로 자전 표현 */
const twice = (d) => d + ' ' + d.replace(/([Mm])\s*(-?[\d.]+)/g, (m, c, x) => (c === 'M' ? `M${parseFloat(x) + 14}` : m));

export const ICONS = {
  /* ------------------------------ 메뉴 ------------------------------ */
  play: { anim: 'nudge', parts: [{ d: 'M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2a.8.8 0 0 0-1.2.7Z', f: 0.3, a: 'nudge' }] },
  resume: { parts: [{ d: 'M5 5.5v13', c: 'accent' }, { d: 'M9.5 6.3v11.4a.8.8 0 0 0 1.2.7l8.8-5.7a.8.8 0 0 0 0-1.4l-8.8-5.7a.8.8 0 0 0-1.2.7Z', f: 0.3, a: 'nudge' }] },
  modeSpace: {
    parts: [
      { d: circ(10, 13, 6), f: 0.25, c: 'cyan' },
      { d: 'M2.2 15.2c-1-1.6 2.6-4 8.2-5.2 5.6-1.2 10.4-.8 11.4.8', c: 'dim', a: 'wobble' },
      { d: 'M17.6 3.2c1.3 1.3 1.8 3 1.8 4.9l1.1 1.1v1.4l-1.6-.6-.4.8h-1.8l-.4-.8-1.6.6V9.2l1.1-1.1c0-1.9.5-3.6 1.8-4.9Z', f: 0.35, c: 'accent', a: 'bob' },
      { d: 'M5 5.2l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4Z', f: 1, s: false, a: 'twinkle' },
    ],
  },
  modeAtmo: {
    parts: [
      { d: 'M3 13.5l7-1.2 3.6-6.3h2l-1.6 6 4.8-.8c1.4-.2 2.2 1.6.4 2l-4.9 1.1 1.6 4.2h-1.8l-3.3-3.5-6.8 1.1Z', f: 0.25, a: 'bob' },
      { d: 'M4 19.5h5.5M14 20.5h6', c: 'dim', a: 'sway' },
    ],
  },
  system: {
    parts: [
      { d: circ(12, 12, 2.6), f: 0.9, c: 'accent' },
      { d: ell(12, 12, 9.5, 4), c: 'dim' },
      { d: circ(21.5, 12, 1.4), f: 1, s: false, a: 'orbit' },
      { d: circ(5.5, 9, 1.1), f: 1, s: false, c: 'cyan', a: 'orbit' },
    ],
  },
  settings: {
    anim: 'spin',
    parts: [{
      d: 'M10.3 3h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.8 1.6v1.8l1.8 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.8-1.6v-1.8L4.3 8.3 6 5.4l2.2.8 1.6-.9Z' + circ(12, 12, 2.8),
      f: 0.2, a: 'spin',
    }],
  },
  controls: {
    parts: [
      { d: 'M4.5 8h15a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 14.5v-4A2.5 2.5 0 0 1 4.5 8Z', f: 0.15 },
      { d: 'M6 11h1M9 11h1M12 11h1M15 11h1M18 11h0M7 14h10', a: 'twinkle' },
    ],
  },
  back: { parts: [{ d: 'M15 5l-7 7 7 7', a: 'nudgeL' }, { d: 'M8.5 12H20', c: 'dim' }] },
  close: { parts: [{ d: circ(12, 12, 9), f: 0.12, c: 'dim' }, { d: 'M8.5 8.5l7 7M15.5 8.5l-7 7', a: 'spin' }] },
  save: {
    parts: [
      { d: 'M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z', f: 0.15 },
      { d: 'M8 4v5h7V4M8 20v-6h8v6', c: 'cyan', a: 'bob' },
    ],
  },
  pause: { parts: [{ d: 'M8 5.5v13M16 5.5v13', w: 2.6, a: 'pulse' }] },
  restart: { parts: [{ d: 'M19 12a7 7 0 1 1-2.1-5', a: 'spin' }, { d: 'M17.5 3.5v4h-4', c: 'accent', a: 'spin' }] },
  mute: { parts: [{ d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4Z', f: 0.25 }, { d: 'M15.5 9.5l5 5M20.5 9.5l-5 5', c: 'warn' }] },
  sound: { parts: [{ d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4Z', f: 0.25 }, { d: 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11', c: 'cyan', a: 'pulse' }] },
  fullscreen: { parts: [{ d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', a: 'pulse' }, { d: 'M9 9h6v6H9Z', c: 'dim', f: 0.15 }] },
  home: { parts: [{ d: 'M4 11l8-6.5 8 6.5M6 9.8V19h12V9.8', f: 0.12 }, { d: 'M10 19v-5h4v5', c: 'accent' }] },
  respawn: { parts: [{ d: 'M5 12a7 7 0 1 0 2.1-5', a: 'spin' }, { d: 'M6.5 3.5v4h4', c: 'accent', a: 'spin' }, { d: circ(12, 12, 1.6), f: 1, s: false }] },
  menu: { parts: [{ d: 'M5 7h14M5 12h14M5 17h9', a: 'sway' }] },
  chevronRight: { parts: [{ d: 'M9 5l7 7-7 7', a: 'nudge' }] },
  arrowRight: { parts: [{ d: 'M4 12h15M13.5 6.5L19 12l-5.5 5.5', a: 'nudge' }] },
  arrowLeft: { parts: [{ d: 'M20 12H5M10.5 6.5L5 12l5.5 5.5', a: 'nudgeL' }] },
  arrowLR: { parts: [{ d: 'M3.5 12h17M8 7.5L3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5', a: 'sway' }] },
  arrowUD: { parts: [{ d: 'M12 3.5v17M7.5 8L12 3.5 16.5 8M7.5 16l4.5 4.5 4.5-4.5', a: 'bob' }] },
  cycle: { parts: [{ d: 'M18.5 9A7 7 0 0 0 5.6 8.2M5.5 15a7 7 0 0 0 12.9.8', a: 'spin' }, { d: 'M5.5 4.5v3.8h3.8M18.5 19.5v-3.8h-3.8', c: 'accent', a: 'spin' }] },
  upload: { parts: [{ d: 'M12 15V4.5M7.5 9L12 4.5 16.5 9', a: 'bob' }, { d: 'M4.5 15v4h15v-4', c: 'dim' }] },
  download: { parts: [{ d: 'M12 4.5V15M7.5 10.5L12 15l4.5-4.5', a: 'bob' }, { d: 'M4.5 15v4h15v-4', c: 'dim' }] },
  folder: { parts: [{ d: 'M3.5 6.5h6l2 2h9v10h-17Z', f: 0.18 }, { d: 'M3.5 11h17', c: 'dim' }] },
  code: { parts: [{ d: 'M8.5 7l-5 5 5 5M15.5 7l5 5-5 5', a: 'sway' }, { d: 'M13.5 5l-3 14', c: 'accent' }] },
  trash: { parts: [{ d: 'M4.5 7h15M9 7V4.5h6V7', a: 'wobble' }, { d: 'M6.5 7l1 13h9l1-13', f: 0.15 }, { d: 'M10 10.5v6M14 10.5v6', c: 'dim' }] },
  copy: { parts: [{ d: 'M8.5 8.5h11v11h-11Z', f: 0.15 }, { d: 'M15.5 8.5v-4h-11v11h4', c: 'dim', a: 'nudge' }] },
  plus: { parts: [{ d: 'M12 5v14M5 12h14', a: 'spin' }] },
  hangar: { parts: [{ d: 'M3 20V10l9-5.5 9 5.5v10', f: 0.12 }, { d: 'M7 20v-6h10v6', c: 'cyan' }, { d: 'M9 17h6', c: 'accent', a: 'sway' }] },
  build: { parts: [{ d: 'M4 20l8.5-8.5', w: 2.2 }, { d: 'M13.2 4.2a4.3 4.3 0 0 0 5.9 5.9l-2.7-.3-.6-2.3-2.3-.6Z', f: 0.25, a: 'wobble' }, { d: 'M16.5 15.5l3 3', c: 'accent' }] },
  trophy: { parts: [{ d: 'M8 4.5h8v4.5a4 4 0 0 1-8 0Z', f: 0.25, a: 'bob' }, { d: 'M8 6H4.5c0 3 1.5 4.5 3.7 4.5M16 6h3.5c0 3-1.5 4.5-3.7 4.5M12 13v3.5M8.5 19.5h7', c: 'accent' }] },
  blueprint: { parts: [{ d: 'M4 4h16v16H4Z', f: 0.12 }, { d: 'M4 9h16M4 14h16M9 4v16M14 4v16', c: 'dim' }, { d: 'M7 17l4-8 3 5 3-3', c: 'accent', a: 'draw' }] },

  /* ------------------------------ 천체 ------------------------------ */
  terran: {
    anim: 'flow', clip: 'P',
    parts: [
      { d: P, f: 0.35, c: 'cyan' },
      { d: twice('M2 9.5c1.6-1 3.2-.6 3.6.8.4 1.6 2 1.2 2.4 2.8.3 1.3-.6 2.4-1.8 2.6M8.5 6.4c1 .8 2.6.4 3.2 1.4M3.5 15.2c1.4-.5 2.6 0 2.8 1.5'), f: 0.6, c: 'accent', a: 'flow', clip: true },
      { d: P },
      { d: 'M2.5 15.5c3 2.2 15 -1 18.5 -6.5', c: 'dim', w: 1.1 },
    ],
  },
  mars: {
    anim: 'flow', clip: 'P',
    parts: [
      { d: P, f: 0.4, c: 'accent' },
      { d: twice('M3 11.5c2 .8 4 -.6 5.5 .4M4.5 15.5c1.4.4 2.6-.2 3.5.4'), c: 'warn', a: 'flow', clip: true },
      { d: twice('M6.2 8.3h.1M9.2 13.8h.1'), w: 2.4, a: 'flow', clip: true },
      { d: 'M9.5 5.3c1.6-.6 3.4-.6 5 0', w: 2.2 },
      { d: P },
    ],
  },
  hot: {
    anim: 'heat', clip: 'P',
    parts: [
      { d: P, f: 0.5, c: 'warn', a: 'heat' },
      { d: 'M7 9.5l2.5 2.2-1 3 2.8 1.5M13.5 6.5l.8 3 3 1.2-1.2 3.3', c: 'accent', a: 'heat' },
      { d: P },
    ],
  },
  ice: {
    anim: 'twinkle',
    parts: [
      { d: P, f: 0.22, c: 'cyan' },
      { d: 'M7 9l3 2.5 1.5-2 2.5 3 3-1.5M8 15.5l2.5-1 2.5 1.5', c: 'cyan' },
      { d: P },
      { d: 'M17.5 4.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5Z', f: 1, s: false, a: 'twinkle' },
      { d: 'M6 17.5l.35.9.9.35-.9.35-.35.9-.35-.9-.9-.35.9-.35Z', f: 1, s: false, a: 'twinkle2' },
    ],
  },
  gas: {
    anim: 'flow', clip: 'P',
    parts: [
      { d: P, f: 0.3, c: 'accent' },
      { d: twice('M0 9.2c2 .7 4.5-.7 7 0M0 12.2c2.5.8 5-.8 7.5 0M0 15c2 .6 4.5-.6 7 0'), a: 'flow', clip: true, c: 'accent' },
      { d: twice('M8.6 13.4h2'), w: 2.6, c: 'warn', a: 'flow', clip: true },
      { d: P },
    ],
  },
  ringed: {
    anim: 'wobble',
    parts: [
      { d: circ(12, 12, 5.5), f: 0.3, c: 'accent' },
      { d: 'M7 10.6c2.5 .8 7.5 .8 10 0', c: 'dim', w: 1.2 },
      { d: 'M3.4 14.6c-1.6-1.6 1.6-3.6 7-4.3 5.4-.6 9.6.3 10 2 .4 1.7-3.3 3.6-8.7 4.3-4.1.5-7.4.1-8.3-2', a: 'wobble' },
    ],
  },
  moon: {
    anim: 'spin',
    parts: [
      { d: circ(12, 12, 7), f: 0.25 },
      { d: circ(9.5, 10, 1.6) + circ(14.6, 13.8, 1.2) + circ(11, 15.4, 0.8), c: 'dim', a: 'spin' },
    ],
  },
  asteroid: {
    anim: 'spin',
    parts: [
      { d: 'M6.5 8.5l3.5-3.6 5 .7 3.5 3.4-.5 5.4-3.6 4-5.2-.5-3.7-3.6Z', f: 0.25, a: 'spin' },
      { d: circ(10.5, 10, 1.3) + circ(14.2, 14.2, 1), c: 'dim', a: 'spin' },
    ],
  },
  star: {
    anim: 'pulse',
    parts: [
      { d: circ(12, 12, 4.6), f: 0.85, c: 'accent', a: 'pulse' },
      { d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1', c: 'accent', a: 'spin' },
    ],
  },
  nebula: {
    anim: 'flow',
    parts: [
      { d: 'M4 14c-1.5-3.5 2-7 5.2-5.4C10 5 15.5 4.6 17 8.5c3.5-.2 4.6 4.6 1.6 6.3.5 3-3.6 4.6-5.6 2.7-2.4 2.4-6.6 1.6-7-1.1C4.8 16.4 4.2 15 4 14Z', f: 0.25, c: 'cyan', a: 'wobble' },
      { d: 'M8.5 12.5c1.6-1.6 4-1.4 5.4.4 1 1.3 3 1 3.6-.4', c: 'accent', a: 'sway' },
      { d: 'M11.6 9.2h.1M15.2 15.2h.1', w: 2.2, a: 'twinkle' },
    ],
  },
  galaxy: {
    anim: 'spin',
    parts: [
      { d: 'M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0', f: 1, c: 'accent', a: 'spin' },
      { d: 'M12 10.4c3.6-2.6 8.6.2 7.8 4.6M12 13.6c-3.6 2.6-8.6-.2-7.8-4.6M13.6 12c2.6 3.6-.2 8.6-4.6 7.8M10.4 12c-2.6-3.6.2-8.6 4.6-7.8', a: 'spin' },
    ],
  },
  blackhole: {
    anim: 'spin',
    parts: [
      { d: 'M2.5 12.5c0-1.8 4.2-3.3 9.5-3.3s9.5 1.5 9.5 3.3-4.2 3.3-9.5 3.3-9.5-1.5-9.5-3.3Z', c: 'accent', f: 0.2, a: 'wobble' },
      { d: circ(12, 12, 3.6), f: 1, c: 'void' },
      { d: circ(12, 12, 4.6), c: 'accent', w: 1.2, a: 'pulse' },
    ],
  },
  belt: {
    parts: [
      { d: ell(12, 12, 9.5, 3.8), c: 'dim', w: 1.1 },
      { d: circ(4.5, 11, 1.1) + circ(9, 15.4, 1) + circ(16, 8.8, 1.2) + circ(19.4, 13.6, 0.9) + circ(12.5, 8.2, 0.7), f: 0.6, a: 'spin' },
    ],
  },
  ship: {
    parts: [
      { d: 'M12 2.8c2.4 2.4 3.4 6 3.4 10.2l2.6 2.6v2.6l-3.6-1.4-.8 1.6h-3.2l-.8-1.6L6 18.2v-2.6L8.6 13c0-4.2 1-7.8 3.4-10.2Z', f: 0.25 },
      { d: circ(12, 9, 1.4), c: 'cyan' },
      { d: 'M10.6 19.8c.4 1.4.9 2 1.4 2s1-.6 1.4-2', c: 'accent', a: 'flick' },
    ],
  },

  /* ------------------------------ 속도 단계 ------------------------------ */
  tier1: { anim: 'flick', parts: shipTier(1) },
  tier2: { anim: 'flick', parts: shipTier(2) },
  tier3: { anim: 'flick', parts: shipTier(3) },
  tier4: {
    anim: 'flick',
    parts: [...shipTier(4), { d: 'M20.5 4.6a2.4 2.4 0 1 0 0 3.8', c: 'cyan', w: 1.5 }],
  },
  tier5: {
    anim: 'spin',
    parts: [
      { d: circ(12, 12, 9.2), c: 'cyan', w: 1.2, a: 'spin', dash: '3 2.2' },
      { d: circ(12, 12, 6.4), c: 'accent', w: 1.1, a: 'spinRev', dash: '1.6 1.6' },
      { d: 'M12 6.5c1.4 1.4 2 3.4 2 5.8l1.4 1.4v1.6l-2-.8-.5 1h-1.8l-.5-1-2 .8v-1.6l1.4-1.4c0-2.4.6-4.4 2-5.8Z', f: 0.3 },
    ],
  },

  /* ------------------------------ HUD ------------------------------ */
  speed: { parts: [{ d: 'M4.2 16a8 8 0 1 1 15.6 0', c: 'dim' }, { d: 'M12 15l4.5-5', c: 'accent', a: 'wobble' }, { d: circ(12, 15, 1.4), f: 1, s: false }] },
  throttle: { parts: [{ d: 'M8 4.5h8v15H8Z', c: 'dim' }, { d: 'M8 13h8v6.5H8Z', f: 0.5, c: 'accent', a: 'bob' }, { d: 'M5 9h3M16 9h3', c: 'dim' }] },
  altitude: { parts: [{ d: 'M3 19.5l6-9 3.5 5 2.5-3 6 7Z', f: 0.25 }, { d: 'M17.5 3.5v6M15 6l2.5-2.5L20 6', c: 'accent', a: 'bob' }] },
  distance: { parts: [{ d: 'M4 16.5h16', c: 'dim' }, { d: 'M4 13.5v6M20 13.5v6', a: 'sway' }, { d: 'M7.5 9.5h9M14 7l2.5 2.5L14 12M10 7L7.5 9.5 10 12', c: 'accent' }] },
  eta: { parts: [{ d: circ(12, 13, 7.5), f: 0.15 }, { d: 'M12 13V9M12 13l3 2', c: 'accent', a: 'spin' }, { d: 'M10 3.5h4M12 3.5v2', c: 'dim' }] },
  gravity: { parts: [{ d: circ(12, 7.5, 3.5), f: 0.3 }, { d: 'M12 13v7.5M8.5 17l3.5 3.5 3.5-3.5', c: 'accent', a: 'bob' }] },
  pressure: { parts: [{ d: circ(12, 12, 8.5), f: 0.12 }, { d: 'M12 12l-4-3.5', c: 'accent', a: 'wobble' }, { d: 'M6.5 16.5h11M12 4.5v1.6M18.8 9l-1.4.8M5.2 9l1.4.8', c: 'dim' }] },
  temperature: { parts: [{ d: 'M10 14.5V5a2 2 0 0 1 4 0v9.5a3.6 3.6 0 1 1-4 0Z', f: 0.12 }, { d: 'M12 9.5v7', c: 'warn', w: 2.4, a: 'heat' }, { d: 'M16.5 6h2M16.5 9h2', c: 'dim' }] },
  atmosphere: { parts: [{ d: circ(12, 14, 5), f: 0.3 }, { d: 'M4 14a8 8 0 0 1 16 0', c: 'cyan', a: 'pulse' }, { d: 'M2 14a10 10 0 0 1 20 0', c: 'dim', w: 1.1, a: 'pulse2' }] },
  damage: { parts: [{ d: 'M12 3.5l7 2.6v5.4c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6.1Z', f: 0.15 }, { d: 'M12.5 6.5l-2 4.5 3 1-2 5', c: 'warn', a: 'pulse' }] },
  hullTemp: { parts: [{ d: 'M12 3.5l7 2.6v5.4c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6.1Z', f: 0.15 }, { d: 'M12 8c1.8 2 2.8 3.4 2.8 5a2.8 2.8 0 0 1-5.6 0c0-1.2.6-2 1.4-2.8.2 1 .6 1.4 1.2 1.6 0-1.4.1-2.4.2-3.8Z', f: 0.6, c: 'accent', a: 'heat' }] },
  gear: { parts: [{ d: 'M8 4.5h8l-1.5 5h-5Z', f: 0.2 }, { d: 'M12 9.5v6', a: 'bob' }, { d: circ(12, 18, 2.5), f: 0.4, c: 'accent', a: 'bob' }] },
  assist: { parts: [{ d: 'M12 3.5l7 2.6v5.4c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6.1Z', f: 0.15 }, { d: 'M8 12h8M12 8v8', c: 'cyan', a: 'spin' }] },
  rcs: { parts: [{ d: circ(12, 12, 3.2), f: 0.3 }, { d: 'M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3', c: 'cyan', a: 'pulse' }, { d: 'M10.5 4.4L12 2.8l1.5 1.6M10.5 19.6l1.5 1.6 1.5-1.6M4.4 10.5L2.8 12l1.6 1.5M19.6 10.5l1.6 1.5-1.6 1.5', c: 'dim' }] },
  warp: { anim: 'spin', parts: [{ d: circ(12, 12, 8.5), c: 'cyan', a: 'spin', dash: '4 2.5' }, { d: circ(12, 12, 4.5), c: 'accent', a: 'spinRev', dash: '2 2' }, { d: 'M9.5 12h5M12 9.5v5', w: 1.4 }] },
  warpExit: { parts: [{ d: circ(12, 12, 8.5), c: 'dim', dash: '4 2.5' }, { d: 'M8.5 8.5l7 7M15.5 8.5l-7 7', c: 'accent', a: 'pulse' }] },
  orbit: { parts: [{ d: circ(12, 12, 3.2), f: 0.4 }, { d: ell(12, 12, 9.5, 5), c: 'cyan', dash: '2.4 2' }, { d: circ(21.5, 12, 1.4), f: 1, s: false, c: 'accent', a: 'orbit' }] },
  view: { parts: [{ d: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z', f: 0.12 }, { d: circ(12, 12, 3), f: 0.5, c: 'cyan', a: 'sway' }] },
  map: { parts: [{ d: 'M3.5 6l5.5-2 6 2 5.5-2v14l-5.5 2-6-2-5.5 2Z', f: 0.15 }, { d: 'M9 4v14M15 6v14', c: 'dim' }, { d: 'M11.5 10.5l1.2 1.2 1.6-1.6', c: 'accent', a: 'pulse' }] },
  target: { parts: [{ d: 'M12 3.5l8.5 8.5-8.5 8.5L3.5 12Z', c: 'accent', a: 'pulse' }, { d: circ(12, 12, 1.6), f: 1, s: false }] },
  reticle: { parts: [{ d: 'M12 4v4M12 16v4M4 12h4M16 12h4', c: 'cyan' }, { d: circ(12, 12, 1.2), f: 1, s: false }] },
  prograde: { parts: [{ d: circ(12, 12, 4), c: 'cyan' }, { d: 'M12 3v5M4 12h4M16 12h4', c: 'cyan' }] },
  lights: { parts: [{ d: 'M9 17h6M10 20h4M12 3.5a5.5 5.5 0 0 0-3.2 10V15h6.4v-1.5A5.5 5.5 0 0 0 12 3.5Z', f: 0.2, a: 'pulse' }] },
  engine: { parts: [{ d: 'M8 4h8l-1 6H9Z', f: 0.3 }, { d: 'M9.5 10.5c-.5 3 .5 5.5 2.5 9 2-3.5 3-6 2.5-9', c: 'accent', f: 0.4, a: 'flick' }] },
  cockpit: { parts: [{ d: 'M3 17c1.5-6 5-10 9-10s7.5 4 9 10Z', f: 0.12 }, { d: 'M12 7v10M5.5 12.5l4 4.5M18.5 12.5l-4 4.5', c: 'dim' }, { d: 'M9 19.5h6', c: 'cyan', a: 'pulse' }] },
  chase: { parts: [{ d: 'M12 6c1.6 1.6 2.3 4 2.3 6.8l1.7 1.7v1.7l-2.4-.9-.6 1h-2l-.6-1-2.4.9v-1.7l1.7-1.7c0-2.8.7-5.2 2.3-6.8Z', f: 0.25, a: 'bob' }, { d: 'M4 20.5l3-3M20 20.5l-3-3', c: 'dim' }] },
  zoom: { parts: [{ d: circ(10.5, 10.5, 6), f: 0.12 }, { d: 'M15 15l5 5', w: 2.4 }, { d: 'M8 10.5h5M10.5 8v5', c: 'accent', a: 'pulse' }] },
  optimize: { parts: [{ d: 'M4.2 17a8.5 8.5 0 1 1 15.6 0', c: 'dim' }, { d: 'M6.6 17h10.8', c: 'dim' }, { d: 'M13 6.5l-3.5 6h3l-1.5 5 4.5-6.5h-3Z', f: 0.6, c: 'accent', a: 'pulse' }] },
  fps: { parts: [{ d: 'M3.5 18.5l4.5-5 3.5 3 5-7 4 4', c: 'cyan', a: 'draw' }, { d: 'M3.5 4.5v14h17', c: 'dim' }] },
  clock: { parts: [{ d: circ(12, 12, 8.5), f: 0.12 }, { d: 'M12 12V7M12 12l3.5 2', c: 'accent', a: 'spin' }] },
  wind: { parts: [{ d: 'M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h7', a: 'sway' }] },
  weather: { parts: [{ d: 'M7 17.5h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.2A3.5 3.5 0 0 0 7 17.5Z', f: 0.2, a: 'bob' }] },
  craft: { parts: [{ d: 'M3 13.5l7-1.2 3.6-6.3h2l-1.6 6 4.8-.8c1.4-.2 2.2 1.6.4 2l-4.9 1.1 1.6 4.2h-1.8l-3.3-3.5-6.8 1.1Z', f: 0.25, a: 'nudge' }] },
  log: { parts: [{ d: 'M9 6.5l5.5 5.5L9 17.5', c: 'cyan' }] },

  /* ------------------------------ 알림 ------------------------------ */
  warning: { anim: 'pulse', parts: [{ d: 'M12 3.8l9 15.6H3Z', f: 0.2, c: 'accent', a: 'pulse' }, { d: 'M12 9.5v4.5M12 16.8v.1', c: 'accent', w: 2.2 }] },
  danger: { anim: 'pulse', parts: [{ d: 'M8.3 3.5h7.4l5.3 5.3v7.4l-5.3 5.3H8.3L3 16.2V8.8Z', f: 0.25, c: 'warn', a: 'pulse' }, { d: 'M12 7.8v5.4M12 16.2v.1', c: 'warn', w: 2.4 }] },
  info: { parts: [{ d: circ(12, 12, 9), f: 0.15, c: 'cyan' }, { d: 'M12 11v6M12 7.6v.1', c: 'cyan', w: 2.2, a: 'bob' }] },
  done: { anim: 'draw', parts: [{ d: circ(12, 12, 9), f: 0.15, c: 'good' }, { d: 'M7.5 12.5l3 3 6-6.5', c: 'good', w: 2.2, a: 'draw', len: 14 }] },
  error: { parts: [{ d: circ(12, 12, 9), f: 0.15, c: 'warn' }, { d: 'M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8', c: 'warn', w: 2.2, a: 'pulse' }] },
  tip: { anim: 'pulse', parts: [{ d: 'M9.5 17.5h5M10.5 20.5h3M12 3.5a5.5 5.5 0 0 0-3.2 10v1.5h6.4v-1.5A5.5 5.5 0 0 0 12 3.5Z', f: 0.25, c: 'accent', a: 'pulse' }, { d: 'M12 7.2a2.4 2.4 0 0 1 2.2 1.8', c: 'dim' }] },

  /* ------------------------------ 설정 ------------------------------ */
  graphics: { parts: [{ d: 'M3.5 5h17v11h-17Z', f: 0.15 }, { d: 'M9 20h6M12 16v4', c: 'dim' }, { d: 'M6.5 13l3.5-4 2.5 2.5 2-2 3 3.5', c: 'accent', a: 'draw' }] },
  keyboard: { parts: [{ d: 'M3 7h18v10H3Z', f: 0.15 }, { d: 'M6 10h1M9 10h1M12 10h1M15 10h1M18 10h0M6 13.5h1M17 13.5h1M9.5 13.5h5', a: 'twinkle' }] },
  mouse: { parts: [{ d: 'M12 3.5a5.5 5.5 0 0 1 5.5 5.5v6a5.5 5.5 0 0 1-11 0V9A5.5 5.5 0 0 1 12 3.5Z', f: 0.15 }, { d: 'M12 6.5v3', c: 'accent', w: 2.2, a: 'bob' }] },
  gamepad: { parts: [{ d: 'M7 7.5h10a4.5 4.5 0 0 1 4.3 5.7l-1 3.6a2.4 2.4 0 0 1-4 1L14.2 16H9.8l-2.1 1.8a2.4 2.4 0 0 1-4-1l-1-3.6A4.5 4.5 0 0 1 7 7.5Z', f: 0.15 }, { d: 'M8 10.5v3M6.5 12h3', c: 'dim' }, { d: circ(15.5, 11, 0.9) + circ(17.5, 13, 0.9), f: 1, s: false, c: 'accent', a: 'pulse' }] },
  touch: { parts: [{ d: 'M9.5 11V5.5a1.5 1.5 0 0 1 3 0V11l4 .8a2 2 0 0 1 1.6 2.2l-.6 4.5a2 2 0 0 1-2 1.7h-4.4a2 2 0 0 1-1.6-.8L6 15.6a1.4 1.4 0 0 1 2-2L9.5 15', f: 0.15 }, { d: circ(11, 5.5, 3.6), c: 'cyan', w: 1.1, a: 'pulse' }] },
  reset: { parts: [{ d: 'M5 12a7 7 0 1 0 2.1-5', a: 'spinRev' }, { d: 'M6.5 3.5v4h4', c: 'accent' }] },

  /* -------------------------- 대기권 비행: 미션 -------------------------- */
  missionFree: { parts: [{ d: 'M3 15.5l7-1.2 3.6-6.3h2l-1.6 6 4.8-.8c1.4-.2 2.2 1.6.4 2l-4.9 1.1 1.6 4.2h-1.8l-3.3-3.5-6.8 1.1Z', f: 0.25, a: 'bob' }, { d: 'M3 21h18', c: 'dim' }, { d: 'M4 8.5c2-1.5 4-1.5 6 0', c: 'cyan', a: 'sway' }] },
  missionRings: { parts: [{ d: ell(7, 12, 3, 6.5), c: 'cyan', a: 'pulse' }, { d: ell(14, 12, 2.4, 5.2), c: 'cyan', a: 'pulse2' }, { d: ell(19.5, 12, 1.8, 4), c: 'dim' }, { d: 'M2 12h4', c: 'accent', a: 'nudge' }] },
  missionCarrier: { parts: [{ d: 'M2.5 15h19l-2.5 4.5H5Z', f: 0.25 }, { d: 'M14 15v-4h3v4M7 15l9-3', c: 'dim' }, { d: 'M3 8.5l4.5-.8 2.2-3.7h1.3l-1 3.5 3-.5c.9-.1 1.4 1 .2 1.3l-3 .7 1 2.6h-1.1l-2-2.2-4.2.7Z', f: 0.3, c: 'accent', a: 'bob' }] },
  missionBalloon: { parts: [{ d: 'M12 3a6 6 0 0 0-6 6c0 3.5 3.3 6.4 4.5 7.5h3C14.7 15.4 18 12.5 18 9a6 6 0 0 0-6-6Z', f: 0.3, c: 'accent', a: 'bob' }, { d: 'M12 3c-2 2-2.5 9 0 13.5 2.5-4.5 2-11.5 0-13.5Z', c: 'dim' }, { d: 'M10.5 16.5l.5 3h2l.5-3M10.5 19.5h3v1.5h-3Z', a: 'bob' }] },
  missionSpace: { parts: [{ d: 'M12 2.5c2.4 2.4 3.4 6 3.4 10.2l2.6 2.6v2.6l-3.6-1.4-.8 1.6h-3.2l-.8-1.6L6 17.9v-2.6l2.6-2.6C8.6 8.5 9.6 4.9 12 2.5Z', f: 0.25 }, { d: circ(12, 8.8, 1.4), c: 'cyan' }, { d: 'M10.6 19.5c.4 1.6.9 2.2 1.4 2.2s1-.6 1.4-2.2', c: 'accent', a: 'flick' }] },
  missionStorm: { parts: [{ d: 'M6.5 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.2A3.5 3.5 0 0 0 6.5 14Z', f: 0.2 }, { d: 'M12.5 14l-2.5 4h3l-2 4', c: 'accent', a: 'pulse' }, { d: 'M7 17l-1 2M17 16l-1 2', c: 'cyan', a: 'bob' }] },
  missionWater: { parts: [{ d: 'M2.5 15c2 1.4 3.8 1.4 5.6 0s3.8-1.4 5.6 0 3.8 1.4 5.6 0', c: 'cyan', a: 'sway' }, { d: 'M2.5 19c2 1.4 3.8 1.4 5.6 0s3.8-1.4 5.6 0 3.8 1.4 5.6 0', c: 'dim', a: 'sway' }, { d: 'M6 11l5-.8 2.5-4.2h1.4l-1.1 4 3.4-.6c1-.1 1.5 1.1.3 1.4l-3.4.7Z', f: 0.3, a: 'bob' }] },
  missionGlide: { parts: [{ d: 'M1.5 11.5c3-1.4 7-1.8 10.5-1.8s7.5.4 10.5 1.8l-10.5 1.4Z', f: 0.3, a: 'bob' }, { d: 'M12 12.9v3.2M10 18.5l2-2.4 2 2.4', c: 'dim' }, { d: 'M4 6c1.6-1 3-1 4.6 0M15.4 5c1.6-1 3-1 4.6 0', c: 'cyan', a: 'sway' }] },

  /* -------------------------- 대기권 비행: 설계실 -------------------------- */
  launch: { parts: [{ d: 'M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2a.8.8 0 0 0-1.2.7Z', f: 0.35, c: 'accent', a: 'nudge' }, { d: 'M3.5 9h3M2.5 12h4M3.5 15h3', c: 'dim', a: 'sway' }] },
  pending: { parts: [{ d: 'M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5 4 8.5S8 16.5 8 20.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5', c: 'cyan', a: 'wobble' }, { d: 'M10 18.5h4l-2-2.5Z', f: 0.7, c: 'accent' }] },
  flapsUp: { parts: [{ d: 'M2.5 13.5h12', w: 2.4 }, { d: 'M14.5 13.5l6-3', c: 'accent', w: 2.2, a: 'bob' }, { d: 'M18 4.5v4.5M15.8 6.6L18 4.4l2.2 2.2', c: 'cyan' }] },
  flapsDown: { parts: [{ d: 'M2.5 10.5h12', w: 2.4 }, { d: 'M14.5 10.5l6 3', c: 'accent', w: 2.2, a: 'bob' }, { d: 'M18 15v4.5M15.8 17.4l2.2 2.2 2.2-2.2', c: 'cyan' }] },
  brake: { parts: [{ d: circ(12, 12, 7.5), f: 0.15 }, { d: circ(12, 12, 3), c: 'accent' }, { d: 'M3 7.5a10 10 0 0 0 0 9M21 7.5a10 10 0 0 1 0 9', c: 'warn', a: 'pulse' }] },
  airbrake: { parts: [{ d: 'M3 15h18', w: 2.2 }, { d: 'M8 15l3-6.5M13 15l3-6.5', c: 'accent', a: 'wobble' }, { d: 'M3 7h4M2 10h3', c: 'dim', a: 'sway' }] },
  afterburner: { parts: [{ d: 'M3 9h7v6H3Z', f: 0.25 }, { d: 'M10 9.5c3 0 6 .8 10.5 2.5C16 13.7 13 14.5 10 14.5', c: 'accent', f: 0.35, a: 'flick' }] },
  burner: { parts: [{ d: 'M12 4c2.5 3 4 5.3 4 8.2a4 4 0 0 1-8 0c0-1.8 1-3 2.2-4.2.3 1.4.9 2 1.7 2.4 0-2.2.1-4 .1-6.4Z', f: 0.45, c: 'accent', a: 'flick' }, { d: 'M8 20.5h8', c: 'dim' }] },
  vent: { parts: [{ d: 'M5 16h14', w: 2.2 }, { d: 'M8 13c0-2 2-2 2-4s-2-2-2-4M12 13c0-2 2-2 2-4s-2-2-2-4M16 13c0-2 2-2 2-4s-2-2-2-4', c: 'cyan', a: 'bob' }] },
  autopilot: { parts: [{ d: circ(12, 12, 8.5), f: 0.12 }, { d: 'M12 6.5v3M12 14.5v3M6.5 12h3M14.5 12h3', c: 'cyan' }, { d: circ(12, 12, 2.2), f: 0.8, c: 'accent', a: 'pulse' }] },
  lookBack: { parts: [{ d: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z', f: 0.12 }, { d: 'M15 12H8.5M11 9.5L8.5 12l2.5 2.5', c: 'accent', a: 'nudgeL' }] },
  fire: { parts: [{ d: circ(12, 12, 7.5), c: 'warn' }, { d: 'M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5', c: 'warn', a: 'pulse' }, { d: circ(12, 12, 1.4), f: 1, s: false, c: 'warn' }] },
  flare: { parts: [{ d: circ(12, 8.5, 2.6), f: 0.8, c: 'accent', a: 'pulse' }, { d: 'M10.5 11c-2 3-4 5.5-6.5 8M13.5 11c2 3 4 5.5 6.5 8M12 11.2v8.6', c: 'dim', a: 'bob' }] },
  chute: { parts: [{ d: 'M3 10.5a9 9 0 0 1 18 0c-1.5-1-3-1-4.5 0-1.5-1-3-1-4.5 0-1.5-1-3-1-4.5 0-1.5-1-3-1-4.5 0Z', f: 0.3, a: 'bob' }, { d: 'M3 10.5l9 9 9-9M7.5 10.5l4.5 9 4.5-9', c: 'dim' }] },
  power: { parts: [{ d: 'M12 3.5v8', c: 'accent', w: 2.2 }, { d: 'M7.2 6.7a7 7 0 1 0 9.6 0', a: 'pulse' }] },
  stick: { parts: [{ d: circ(12, 12, 8.5), c: 'dim', dash: '2 2' }, { d: circ(12, 12, 3.4), f: 0.5, c: 'cyan', a: 'sway' }] },

  /* ------------------------------ 기타 ------------------------------ */
  logo: {
    anim: 'flick',
    parts: [
      { d: 'M12 1.8c2.6 2.6 3.7 6.6 3.7 11.1l2.9 2.9v2.9l-3.9-1.5-.9 1.8h-3.6l-.9-1.8-3.9 1.5v-2.9l2.9-2.9c0-4.5 1.1-8.5 3.7-11.1Z', f: 0.25 },
      { d: circ(12, 8.6, 1.6), c: 'cyan', f: 0.4 },
      { d: 'M10.3 19.7c.5 1.6 1 2.6 1.7 2.6s1.2-1 1.7-2.6', c: 'accent', f: 0.5, a: 'flick' },
      { d: 'M4.5 6.5l.4 1 1 .4-1 .4-.4 1-.4-1-1-.4 1-.4ZM19.5 4.5l.3.8.8.3-.8.3-.3.8-.3-.8-.8-.3.8-.3Z', f: 1, s: false, a: 'twinkle' },
    ],
  },
  loadingSet: {
    parts: [
      { d: circ(12, 12, 5), f: 0.3, c: 'cyan' },
      { d: twice('M5.5 10.5c1.4-.6 2.6 0 3 1.2.3 1 1.4 1 1.7 2'), c: 'accent', a: 'flow', clip: 'P5' },
      { d: circ(12, 12, 5) },
      { d: ell(12, 12, 10.5, 10.5), c: 'dim', w: 0.8, dash: '1.2 1.8' },
      { d: circ(22.5, 12, 1.5), f: 1, s: false, a: 'orbit' },
    ],
  },
};

/** 속도 단계 아이콘: 단계가 오를수록 엔진 불꽃이 길어진다 */
function shipTier(n) {
  const len = [0, 2.2, 3.6, 5.2, 6.6][n];
  const base = 15.2;
  const flame = `M10.4 ${base}c.4 ${len * 0.75} 1 ${len} 1.6 ${len}s1.2-${len * 0.25} 1.6-${len}`;
  const parts = [
    { d: 'M12 2.6c1.9 1.9 2.7 4.7 2.7 8l2 2v2.2l-2.8-1.1-.6 1.5h-2.6l-.6-1.5-2.8 1.1v-2.2l2-2c0-3.3.8-6.1 2.7-8Z', f: 0.25 },
    { d: flame, c: 'accent', f: 0.35, a: 'flick' },
  ];
  // 단계 눈금 (1~5)
  let ticks = '';
  for (let i = 0; i < 5; i++) ticks += `M${3.4} ${20.5 - i * 3.2}h${i < n ? 2.2 : 1}`;
  parts.push({ d: ticks, c: 'cyan', w: 1.6 });
  return parts;
}

/* ------------------------------------------------------------------ */
/* 색                                                                  */
/* ------------------------------------------------------------------ */
export const ICON_COLORS = {
  base: '#e9f6ff', cyan: '#62e6ff', accent: '#ffa94d', warn: '#ff5a4e', dim: 'rgba(200,230,250,0.55)',
  good: '#7dffb0', void: '#020306',
};

function roleColor(role) {
  if (!role) return 'currentColor';
  if (role === 'accent') return 'var(--ico-accent, #ffa94d)';
  if (role === 'warn') return 'var(--ico-warn, #ff5a4e)';
  if (role === 'cyan') return 'var(--ico-cyan, #62e6ff)';
  if (role === 'dim') return 'var(--ico-dim, rgba(200,230,250,0.55))';
  if (role === 'good') return 'var(--ico-good, #7dffb0)';
  if (role === 'void') return '#020306';
  return 'currentColor';
}

/* ------------------------------------------------------------------ */
/* HTML: inline SVG                                                    */
/* ------------------------------------------------------------------ */
let _defsInjected = false;

/** 문서 전체에서 공유하는 SVG defs (발광 흐림·행성 클립) — 한 번만 삽입 */
export function injectIconDefs() {
  if (_defsInjected || typeof document === 'undefined') return;
  _defsInjected = true;
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  div.setAttribute('aria-hidden', 'true');
  div.innerHTML = `<svg width="0" height="0" focusable="false"><defs>
    <filter id="ico-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4"/></filter>
    <clipPath id="ico-clip-P" clipPathUnits="userSpaceOnUse"><circle cx="12" cy="12" r="6.6"/></clipPath>
    <clipPath id="ico-clip-P5" clipPathUnits="userSpaceOnUse"><circle cx="12" cy="12" r="4.7"/></clipPath>
  </defs></svg>`;
  document.body.appendChild(div);
}

/**
 * 아이콘 SVG 문자열.
 * @param {string} name
 * @param {object} o { size, cls, title, glow(bool, 기본 true), anim(항상 재생) }
 */
export function icon(name, o = {}) {
  const def = ICONS[name] || ICONS.info;
  const size = o.size || 20;
  const glow = o.glow !== false;
  const body = def.parts.map((p) => partSVG(p, def)).join('');
  const glowLayer = glow ? `<g class="ico-glow" filter="url(#ico-blur)">${def.parts.filter((p) => p.s !== false).map((p) => partSVG({ ...p, f: 0, w: (p.w || 1.75) + 1.6 }, def)).join('')}</g>` : '';
  const cls = `ico ico-${name}${o.anim ? ' ico-live' : ''}${o.cls ? ' ' + o.cls : ''}`;
  const title = o.title ? `<title>${o.title}</title>` : '';
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="${o.title ? 'false' : 'true'}" focusable="false">${title}${glowLayer}<g class="ico-body">${body}</g></svg>`;
}

function partSVG(p, def) {
  const stroke = p.s === false ? 'none' : roleColor(p.c);
  const fill = p.f ? roleColor(p.c) : 'none';
  const fo = p.f ? ` fill-opacity="${p.f}"` : '';
  const w = p.w || 1.75;
  const dash = p.dash ? ` stroke-dasharray="${p.dash}"` : '';
  const len = p.a === 'draw' ? ` pathLength="1" style="--len:1"` : '';
  const path = `<path d="${p.d}" fill="${fill}"${fo} stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dash}${len}/>`;
  let out = p.a ? `<g class="a-${p.a}">${path}</g>` : path;
  if (p.clip) out = `<g clip-path="url(#ico-clip-${p.clip === true ? (def.clip || 'P') : p.clip})">${out}</g>`;
  return out;
}

/** 숫자 배지 (원문자 대체) */
export function numberBadge(n, size = 20) {
  return `<svg class="ico ico-badge" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${circ(12, 12, 9.5)}" fill="var(--ico-cyan,#62e6ff)" fill-opacity="0.18" stroke="var(--ico-cyan,#62e6ff)" stroke-width="1.5"/><text x="12" y="16.2" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor" font-family="Rajdhani, system-ui, sans-serif">${n}</text></svg>`;
}

/** 아이콘 + 글자 버튼 HTML */
export function buttonHTML(iconName, label, o = {}) {
  const cls = ['sbtn', o.primary ? 'primary' : '', o.small ? 'small' : '', o.xl ? 'xl' : '', o.cls || ''].filter(Boolean).join(' ');
  const attrs = o.attrs || '';
  const sub = o.sub ? `<span class="sbtn-sub">${o.sub}</span>` : '';
  const key = o.key ? `<span class="sbtn-key">${o.key}</span>` : '';
  return `<button class="${cls}" ${attrs}>${icon(iconName, { size: o.iconSize || (o.xl ? 30 : o.small ? 16 : 20) })}<span class="sbtn-text"><span class="sbtn-label">${label}</span>${sub}</span>${key}</button>`;
}

/* ------------------------------------------------------------------ */
/* 버튼 프레임 (9-slice SVG)                                            */
/* ------------------------------------------------------------------ */
function svgURI(svg) {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** 모서리를 깎은 SF 외곽선 — 48×48, 9-slice 14px */
export function frameSVG(kind = 'base') {
  const c = {
    base: ['#62e6ff', 0.55, 'rgba(14,34,52,0.72)', 'rgba(6,16,28,0.6)'],
    primary: ['#ffb366', 0.95, 'rgba(120,58,14,0.75)', 'rgba(40,18,6,0.7)'],
    selected: ['#ffa94d', 0.95, 'rgba(70,40,14,0.8)', 'rgba(24,14,6,0.7)'],
    focus: ['#bff6ff', 1, 'rgba(20,60,84,0.85)', 'rgba(8,26,40,0.7)'],
    danger: ['#ff5a4e', 0.9, 'rgba(70,14,10,0.78)', 'rgba(30,6,6,0.7)'],
    panel: ['#62e6ff', 0.32, 'rgba(8,20,32,0.82)', 'rgba(4,12,20,0.82)'],
  }[kind] || ['#62e6ff', 0.55, 'rgba(14,34,52,0.72)', 'rgba(6,16,28,0.6)'];
  const [stroke, so, f1, f2] = c;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${f1}"/><stop offset="1" stop-color="${f2}"/></linearGradient></defs><path d="M10 1.5H46.5V38L38 46.5H1.5V10Z" fill="url(#g)" stroke="${stroke}" stroke-opacity="${so}" stroke-width="1.5"/><path d="M4 9.5L9.5 4M38.5 44L44 38.5" stroke="${stroke}" stroke-opacity="${Math.min(1, so + 0.2)}" stroke-width="2" stroke-linecap="round"/><path d="M14 4.5H30" stroke="#fff" stroke-opacity="0.18" stroke-width="1"/></svg>`;
}

/** 발광 레이어 — 미리 흐리게 그린 외곽선 (opacity 만 바꿔 쓴다) */
export function glowSVG(color = '#62e6ff') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter></defs><path d="M18 9.5H54.5V46L46 54.5H9.5V18Z" fill="none" stroke="${color}" stroke-width="3.5" filter="url(#b)"/></svg>`;
}

/** 포커스 표시 — 모서리 브래킷 */
export function focusSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><path d="M1 12V8L8 1h5M35 1h12v12M47 36v4l-7 7h-5M13 47H1V35" fill="none" stroke="#e6fbff" stroke-width="2" stroke-linecap="round"/></svg>`;
}

/** CSS 변수로 프레임 이미지 등록 (styles/space.css 에서 사용) */
export function injectFrameStyles() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--frame-base', svgURI(frameSVG('base')));
  root.setProperty('--frame-primary', svgURI(frameSVG('primary')));
  root.setProperty('--frame-selected', svgURI(frameSVG('selected')));
  root.setProperty('--frame-focus', svgURI(frameSVG('focus')));
  root.setProperty('--frame-danger', svgURI(frameSVG('danger')));
  root.setProperty('--frame-panel', svgURI(frameSVG('panel')));
  root.setProperty('--glow-cyan', svgURI(glowSVG('#62e6ff')));
  root.setProperty('--glow-orange', svgURI(glowSVG('#ffa94d')));
  root.setProperty('--glow-red', svgURI(glowSVG('#ff5a4e')));
  root.setProperty('--focus-brackets', svgURI(focusSVG()));
}

/* ------------------------------------------------------------------ */
/* 버튼 꾸미기: 발광·흐름·물결 레이어 추가, 아이콘 자동 부여               */
/* ------------------------------------------------------------------ */
const AUTO_ICON = [
  [/메뉴|돌아가기/, 'back'], [/격납고/, 'hangar'], [/저장/, 'save'], [/불러오기/, 'folder'], [/JSON/, 'code'],
  [/초기화|기본값/, 'reset'], [/비행 시작|임무 시작|이 기체로/, 'launch'], [/닫기/, 'close'], [/적용/, 'done'],
  [/설계 열기|설계/, 'blueprint'], [/삭제/, 'trash'], [/복제/, 'copy'], [/계속/, 'resume'], [/리스폰|다시/, 'respawn'],
  [/설정/, 'settings'], [/조작/, 'controls'], [/도전/, 'trophy'], [/제작/, 'build'], [/자유 비행/, 'missionFree'],
  [/일시정지/, 'pause'], [/전체화면/, 'fullscreen'], [/음소거/, 'mute'], [/지도/, 'map'], [/시점/, 'view'],
];

export function guessIcon(text) {
  for (const [re, name] of AUTO_ICON) if (re.test(text)) return name;
  return 'chevronRight';
}

/** 버튼에 프레임 장식 레이어와 아이콘을 붙인다 (중복 호출 안전) */
export function decorateButton(b) {
  if (!b || b.dataset.deco === '1') return;
  b.dataset.deco = '1';
  b.classList.add('deco');
  if (!b.querySelector('svg.ico')) {
    const name = b.dataset.icon || guessIcon(b.textContent || '');
    b.insertAdjacentHTML('afterbegin', icon(name, { size: b.classList.contains('nav-btn') ? 26 : 18 }));
  }
  if (!b.querySelector(':scope > .sb-glow')) {
    b.insertAdjacentHTML('afterbegin', '<span class="sb-glow" aria-hidden="true"></span><span class="sb-clip" aria-hidden="true"></span><span class="sb-focus" aria-hidden="true"></span><span class="sb-flow" aria-hidden="true"><i></i></span>');
  }
}

/** 문서 내 모든 버튼 장식 + 새로 생기는 버튼 자동 장식 */
export function autoDecorate(root = document.body) {
  const run = (el) => {
    if (el.matches && el.matches('button')) decorateButton(el);
    if (el.querySelectorAll) el.querySelectorAll('button').forEach(decorateButton);
  };
  run(root);
  const mo = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) run(n);
  });
  mo.observe(root, { childList: true, subtree: true });
  bindRipple(root);
}

/** 누름 물결 + 터치 1회 애니메이션 */
function bindRipple(root) {
  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const s = document.createElement('span');
    s.className = 'sb-ripple';
    const d = Math.max(r.width, r.height) * 2.2;
    s.style.width = s.style.height = d + 'px';
    s.style.left = (e.clientX - r.left - d / 2) + 'px';
    s.style.top = (e.clientY - r.top - d / 2) + 'px';
    (b.querySelector(':scope > .sb-clip') || b).appendChild(s);
    setTimeout(() => s.remove(), 650);
    if (e.pointerType === 'touch') {
      b.classList.remove('tap-anim');
      void b.offsetWidth;
      b.classList.add('tap-anim');
      setTimeout(() => b.classList.remove('tap-anim'), 1300);
    }
  }, { passive: true });
}

/* ------------------------------------------------------------------ */
/* 게임패드 UI 포커스 이동                                               */
/* ------------------------------------------------------------------ */
export class GamepadFocus {
  constructor() {
    this.cur = null;
    this.cool = 0;
    this.prevA = false;
    this.prevB = false;
    this.active = false;
    this.onBack = null;
  }
  _candidates() {
    return [...document.querySelectorAll('button, input, select, [data-focusable]')].filter((el) => {
      if (el.disabled) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      return el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
    });
  }
  /** dir: [dx, dy] — 화면상 가장 가까운 다음 요소로 */
  move(dx, dy) {
    const list = this._candidates();
    if (!list.length) return;
    if (!this.cur || !list.includes(this.cur)) { this.set(list[0]); return; }
    const a = this.cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === this.cur) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 - ax, y = r.top + r.height / 2 - ay;
      const along = x * dx + y * dy;
      if (along <= 4) continue;
      const across = Math.abs(x * dy - y * dx);
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.set(best);
  }
  set(el) {
    if (this.cur) this.cur.classList.remove('gp-focus');
    this.cur = el;
    if (el) {
      el.classList.add('gp-focus');
      try { el.focus({ preventScroll: false }); } catch (e) { /* noop */ }
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  clear() { if (this.cur) this.cur.classList.remove('gp-focus'); this.cur = null; }
  /** 매 프레임: UI 화면이 떠 있을 때만 호출 */
  update(dt, gp) {
    if (!gp) return;
    this.cool -= dt;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const up = (gp.buttons[12] && gp.buttons[12].pressed) || ay < -0.6;
    const down = (gp.buttons[13] && gp.buttons[13].pressed) || ay > 0.6;
    const left = (gp.buttons[14] && gp.buttons[14].pressed) || ax < -0.6;
    const right = (gp.buttons[15] && gp.buttons[15].pressed) || ax > 0.6;
    if (this.cool <= 0 && (up || down || left || right)) {
      this.active = true;
      this.move(right ? 1 : left ? -1 : 0, down ? 1 : up ? -1 : 0);
      this.cool = 0.2;
    }
    const a = !!(gp.buttons[0] && gp.buttons[0].pressed);
    const b = !!(gp.buttons[1] && gp.buttons[1].pressed);
    if (a && !this.prevA && this.cur) {
      this.cur.classList.add('tap-anim');
      setTimeout(() => this.cur && this.cur.classList.remove('tap-anim'), 900);
      this.cur.click();
    }
    if (b && !this.prevB && this.onBack) this.onBack();
    this.prevA = a; this.prevB = b;
  }
}

/* ------------------------------------------------------------------ */
/* 캔버스: Path2D 로 같은 아이콘 그리기                                   */
/* ------------------------------------------------------------------ */
const _path2d = new Map();
function getPaths(name) {
  let p = _path2d.get(name);
  if (!p) {
    const def = ICONS[name] || ICONS.info;
    p = def.parts.map((part) => ({ ...part, path: typeof Path2D !== 'undefined' ? new Path2D(part.d) : null }));
    _path2d.set(name, p);
  }
  return p;
}
const _clipPath = typeof Path2D !== 'undefined' ? new Path2D(circ(12, 12, 6.6)) : null;
const _clipPath5 = typeof Path2D !== 'undefined' ? new Path2D(circ(12, 12, 4.7)) : null;

/**
 * 캔버스에 아이콘을 그린다. 애니메이션은 경과 시간(t, 초) 기반으로 직접 보간.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o { color, accent, warn, alpha, scale, rot, t(애니 시간 초), animate(bool), glow(0..1) }
 */
export function drawIcon(ctx, name, x, y, size, o = {}) {
  const parts = getPaths(name);
  const s = (size / 24) * (o.scale || 1);
  const t = o.t || 0;
  const live = !!o.animate;
  const col = {
    base: o.color || ICON_COLORS.base, cyan: o.cyan || ICON_COLORS.cyan, accent: o.accent || ICON_COLORS.accent,
    warn: o.warn || ICON_COLORS.warn, dim: o.dim || ICON_COLORS.dim, good: ICON_COLORS.good, void: ICON_COLORS.void,
  };
  ctx.save();
  ctx.translate(x, y);
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale(s, s);
  ctx.translate(-12, -12);
  ctx.globalAlpha *= o.alpha === undefined ? 1 : o.alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const passes = o.glow ? [1, 0] : [0];
  for (const glowPass of passes) {
    for (const p of parts) {
      if (!p.path) continue;
      const c = p.c ? col[p.c] || col.base : col.base;
      ctx.save();
      if (p.clip) ctx.clip(p.clip === 'P5' ? _clipPath5 : _clipPath);
      if (live && p.a) applyCanvasAnim(ctx, p.a, t);
      if (p.dash) ctx.setLineDash(p.dash.split(' ').map(Number));
      if (glowPass) {
        if (p.s === false) { ctx.restore(); continue; }
        ctx.globalAlpha *= 0.35 * o.glow;
        ctx.strokeStyle = c;
        ctx.lineWidth = (p.w || 1.75) + 2.4;
        ctx.stroke(p.path);
      } else {
        if (p.f) {
          ctx.fillStyle = c;
          const ga = ctx.globalAlpha;
          ctx.globalAlpha = ga * p.f;
          ctx.fill(p.path);
          ctx.globalAlpha = ga;
        }
        if (p.s !== false) {
          ctx.strokeStyle = c;
          ctx.lineWidth = p.w || 1.75;
          ctx.stroke(p.path);
        }
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

function applyCanvasAnim(ctx, a, t) {
  const c = 12;
  switch (a) {
    case 'spin': ctx.translate(c, c); ctx.rotate(t * 1.6); ctx.translate(-c, -c); break;
    case 'spinRev': ctx.translate(c, c); ctx.rotate(-t * 2.2); ctx.translate(-c, -c); break;
    case 'flow': ctx.translate(-((t * 5) % 14), 0); break;
    case 'flick': { const k = 1 + Math.sin(t * 23) * 0.12 + Math.sin(t * 37) * 0.06; ctx.translate(c, 15); ctx.scale(1, k); ctx.translate(-c, -15); break; }
    case 'wobble': ctx.translate(c, c); ctx.rotate(Math.sin(t * 3) * 0.16); ctx.translate(-c, -c); break;
    case 'pulse': { const k = 1 + Math.sin(t * 6.3) * 0.08; ctx.translate(c, c); ctx.scale(k, k); ctx.translate(-c, -c); break; }
    case 'pulse2': ctx.globalAlpha *= 0.6 + 0.4 * Math.sin(t * 5); break;
    case 'twinkle': ctx.globalAlpha *= 0.45 + 0.55 * Math.abs(Math.sin(t * 3.2)); break;
    case 'twinkle2': ctx.globalAlpha *= 0.45 + 0.55 * Math.abs(Math.cos(t * 2.6)); break;
    case 'orbit': ctx.translate(c, c); ctx.rotate(t * 1.4); ctx.translate(-c, -c); break;
    case 'bob': ctx.translate(0, Math.sin(t * 4) * 0.9); break;
    case 'sway': ctx.translate(Math.sin(t * 3.5) * 1.0, 0); break;
    case 'heat': { const k = 1 + Math.sin(t * 9) * 0.04; ctx.translate(c, c); ctx.scale(k, 1 / k); ctx.translate(-c, -c); break; }
    case 'nudge': ctx.translate(Math.max(0, Math.sin(t * 5)) * 1.4, 0); break;
    case 'nudgeL': ctx.translate(-Math.max(0, Math.sin(t * 5)) * 1.4, 0); break;
    default: break;
  }
}

/** 미리 렌더링한 아이콘 이미지(캔버스) — 반복 그리기용 캐시 */
const _bitmapCache = new Map();
export function iconBitmap(name, size, color) {
  const key = name + '|' + size + '|' + (color || '');
  let c = _bitmapCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.ceil(size * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    drawIcon(ctx, name, size / 2, size / 2, size, { color, glow: 0.8 });
    _bitmapCache.set(key, c);
  }
  return c;
}

/** 천체 종류 → 아이콘 이름 */
export function bodyIcon(body) {
  if (!body) return 'info';
  const k = body.kind;
  if (k === 'galaxy') return 'galaxy';
  if (k === 'system') return 'system';
  if (k === 'star') return 'star';
  if (k === 'blackhole') return 'blackhole';
  if (k === 'nebula') return 'nebula';
  if (k === 'belt') return 'belt';
  const t = body.type;
  return { terran: 'terran', mars: 'mars', hot: 'hot', lava: 'hot', ice: 'ice', gas: 'gas', ringed: 'ringed', moon: 'moon', asteroid: 'asteroid' }[t] || 'moon';
}
