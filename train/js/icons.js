// 화면에 쓰는 그림 아이콘 (SVG). 이모티콘은 쓰지 않는다.
const S = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const ICON = {
  train: S('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l-2-4M15 21l2-4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M9 6h6"/>'),
  build: S('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'),
  map: S('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'),
  gear: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  keys: S('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  play: S('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
  back: S('<path d="M15 18l-6-6 6-6"/>'),
  door: S('<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M9 12h.01M15 12h.01"/>'),
  doorOpen: S('<path d="M4 3h5v18H4zM15 3h5v18h-5z"/><path d="M11 9l-2 3 2 3M13 9l2 3-2 3"/>'),
  horn: S('<path d="M3 10v4h4l6 4V6L7 10H3z"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/>'),
  light: S('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'),
  panto: S('<path d="M4 20h16M8 20l4-8-4-5M16 20l-4-8 4-5M6 4h12"/>'),
  eye: S('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  pause: S('<path d="M8 5v14M16 5v14"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  save: S('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>'),
  trash: S('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: S('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  chip: S('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
  locate: S('<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  up: S('<path d="M6 15l6-6 6 6"/>'),
  down: S('<path d="M6 9l6 6 6-6"/>'),
  neutral: S('<path d="M5 12h14"/>'),
  stop: S('<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/>'),
  flag: S('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
};
// 메뉴 전환 애니메이션에 쓰는 열차 그림
export const TRAIN_ART = `<svg viewBox="0 0 640 120" class="art-train"><defs>
<linearGradient id="tb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d2da"/></linearGradient></defs>
<path d="M20 92 L470 92 Q600 92 628 70 Q600 40 520 34 L40 34 Q20 34 20 54 Z" fill="url(#tb)"/>
<path d="M20 70 L560 70 Q600 70 622 66" stroke="#1d5fb0" stroke-width="7" fill="none"/>
<path d="M20 80 L540 80" stroke="#3fa0d8" stroke-width="3"/>
<path d="M520 40 Q580 44 606 62 L560 62 Q540 50 520 48 Z" fill="#121a22"/>
${[60, 100, 140, 180, 220, 260, 300, 340, 380, 420, 460].map(x => `<rect x="${x}" y="44" width="26" height="14" rx="3" fill="#18222c"/>`).join('')}
<rect x="40" y="92" width="80" height="10" fill="#2a2c2e"/><rect x="380" y="92" width="80" height="10" fill="#2a2c2e"/>
<circle cx="60" cy="104" r="9" fill="#55575a"/><circle cx="100" cy="104" r="9" fill="#55575a"/><circle cx="400" cy="104" r="9" fill="#55575a"/><circle cx="440" cy="104" r="9" fill="#55575a"/>
<path d="M0 114 H640" stroke="#8a8f94" stroke-width="3"/></svg>`;
