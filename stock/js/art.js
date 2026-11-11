// 직접 그린 그림(SVG): 아이콘, 기업 로고, 마스코트, 공부 그림
const IC = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  market: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11v3"/><path d="M15 13.5h2"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M3 12.5h18"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="3"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v14c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  news: '<rect x="3" y="4" width="14" height="16" rx="2"/><path d="M17 8h3v10a2 2 0 0 1-2 2H5"/><path d="M7 8.5h6M7 12.5h6M7 16h3.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5h.01" stroke-width="3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01" stroke-width="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>',
  text: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
  speed: '<path d="M4.5 18a8.5 8.5 0 1 1 15 0"/><path d="M12 14l4.5-5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  gift: '<rect x="3.5" y="9" width="17" height="11.5" rx="1.5"/><path d="M2.5 9h19M12 9v11.5"/><path d="M12 9c-1.5-3.5-6-4-6-1.5C6 9 10 9 12 9c2 0 6 0 6-1.5 0-2.5-4.5-2-6 1.5z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4.5M16 6h3a3 3 0 0 1-3 4.5"/><path d="M12 13v4M8 20.5h8M9.5 17h5"/>',
  pie: '<path d="M11 4a8.5 8.5 0 1 0 9 9h-9z"/><path d="M14.5 2.5a7.5 7.5 0 0 1 7 7h-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[name] || ''}</svg>`;
}

// 오름/내림 세모
export function tri(dir) {
  const d = dir === 'up' ? 'M5 1.5L9.2 8.5H.8z' : dir === 'down' ? 'M5 8.5L9.2 1.5H.8z' : 'M1 4h8v2H1z';
  return `<svg class="tri" viewBox="0 0 10 10" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;
}

export function coin(cls = '') {
  return `<svg class="coin ${cls}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="#F5B82E"/><circle cx="12" cy="12" r="7.3" fill="none" stroke="#D18A0F" stroke-width="1.6"/><path d="M12 7.8l1.25 2.55 2.8.4-2.03 1.98.48 2.8L12 14.2l-2.5 1.33.48-2.8-2.03-1.98 2.8-.4z" fill="#D18A0F"/></svg>`;
}

// ---------- 기업 로고 ----------
const W = '#fff';
const LOGO = {
  tv: c => `<rect x="7" y="9" width="34" height="23" rx="3" fill="${W}"/><rect x="10.5" y="12.5" width="27" height="16" rx="1.5" fill="${c}"/><path d="M21.5 16.5l7 4-7 4z" fill="${W}"/><path d="M17 39.5h14M24 32v7.5" stroke="${W}" stroke-width="3" stroke-linecap="round"/>`,
  bolt: () => `<path d="M27.5 5.5L11.5 27h10.5l-3 15.5L36.5 20H26z" fill="${W}" stroke="${W}" stroke-width="1.5" stroke-linejoin="round"/>`,
  washer: c => `<rect x="10" y="6.5" width="28" height="35" rx="4" fill="${W}"/><path d="M10 14.5h28" stroke="${c}" stroke-width="2"/><circle cx="15" cy="10.5" r="1.6" fill="${c}"/><circle cx="20" cy="10.5" r="1.6" fill="${c}"/><circle cx="24" cy="28" r="8.5" fill="none" stroke="${c}" stroke-width="2.6"/><path d="M18.5 29.5c2-1.8 3.6 1.6 5.5 0s3.6 1.6 5.5 0" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  ram: c => `<rect x="6" y="14" width="36" height="17" rx="2" fill="${W}"/>${[9.5, 17.5, 25.5, 33.5].map(x => `<rect x="${x}" y="17.5" width="5" height="8" rx="1" fill="${c}"/>`).join('')}<path d="M9 31v5M13 31v5M17 31v5M21 31v5M27 31v5M31 31v5M35 31v5M39 31v5" stroke="${W}" stroke-width="2.2"/>`,
  phone: c => `<rect x="14" y="5" width="20" height="38" rx="5" fill="${W}"/><rect x="17" y="10" width="14" height="25" rx="1.5" fill="${c}"/><circle cx="24" cy="39" r="1.8" fill="${c}"/><path d="M24 17.5l1.5 3.1 3.4.5-2.5 2.4.6 3.4-3-1.6-3 1.6.6-3.4-2.5-2.4 3.4-.5z" fill="${W}"/>`,
  cloud: c => `<path d="M15 35a8.5 8.5 0 0 1-.8-17A11 11 0 0 1 35 16.5 9 9 0 0 1 34 35z" fill="${W}"/><path d="M20.5 22.5L17 26l3.5 3.5M27.5 22.5L31 26l-3.5 3.5" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  gpu: c => `<rect x="5" y="12" width="38" height="21" rx="3" fill="${W}"/><circle cx="16" cy="22.5" r="6.8" fill="${c}"/><circle cx="32" cy="22.5" r="6.8" fill="${c}"/><path d="M16 17v11M10.5 22.5h11M32 17v11M26.5 22.5h11" stroke="${W}" stroke-width="1.6" opacity=".75"/><circle cx="16" cy="22.5" r="2" fill="${W}"/><circle cx="32" cy="22.5" r="2" fill="${W}"/><rect x="9" y="33" width="15" height="4.5" rx="1" fill="${W}"/>`,
  food: () => `<path d="M8 23h32a16 16 0 0 1-32 0z" fill="${W}"/><path d="M17 8c-2.2 2 2.2 4.2 0 7M24 6.5c-2.2 2.4 2.2 5 0 8.5M31 8c-2.2 2 2.2 4.2 0 7" stroke="${W}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
  chip: c => `<rect x="14" y="14" width="20" height="20" rx="3" fill="${W}"/><rect x="19.5" y="19.5" width="9" height="9" rx="1.5" fill="${c}"/><path d="M19 8.5v5M24 8.5v5M29 8.5v5M19 34.5v5M24 34.5v5M29 34.5v5M8.5 19h5M8.5 24h5M8.5 29h5M34.5 19h5M34.5 24h5M34.5 29h5" stroke="${W}" stroke-width="2.6" stroke-linecap="round"/>`,
  capsule: () => `<g transform="rotate(-40 24 25)"><rect x="9" y="18" width="30" height="14" rx="7" fill="none" stroke="${W}" stroke-width="2.8"/><path d="M24 18h-8a7 7 0 0 0 0 14h8z" fill="${W}"/></g><path d="M36 7v7M32.5 10.5h7" stroke="${W}" stroke-width="2.6" stroke-linecap="round"/>`,
  car: c => `<path d="M6 31v-6c0-1.6 1.1-2.8 2.6-3.1L13.5 21l3.6-5.7c.7-1 1.7-1.6 2.9-1.6h8.6c1.1 0 2.1.5 2.8 1.4L35.5 21l4.7 1.2c1.6.4 2.8 1.8 2.8 3.4V31z" fill="${W}"/><path d="M18.6 20.5l2.4-4h7.2l3 4z" fill="${c}"/><circle cx="15" cy="32" r="4.6" fill="${W}" stroke="${c}" stroke-width="2.6"/><circle cx="34" cy="32" r="4.6" fill="${W}" stroke="${c}" stroke-width="2.6"/>`,
  building: c => {
    let w = '';
    for (const y of [20, 26, 32]) for (const x of [13, 18]) w += `<rect x="${x}" y="${y}" width="3" height="3.4" rx=".6" fill="${c}"/>`;
    for (const y of [13, 19, 25, 31]) for (const x of [28.5, 33.5]) w += `<rect x="${x}" y="${y}" width="3" height="3.4" rx=".6" fill="${c}"/>`;
    return `<rect x="9.5" y="16" width="14" height="25" rx="1.6" fill="${W}"/><rect x="25" y="9" width="14" height="32" rx="1.6" fill="${W}"/>${w}`;
  },
  gamepad: c => `<path d="M14.5 15h19a8.5 8.5 0 0 1 8.3 10.3l-1.7 7.4a4.6 4.6 0 0 1-8.2 1.8L28.6 30h-9.2l-3.3 4.5a4.6 4.6 0 0 1-8.2-1.8l-1.7-7.4A8.5 8.5 0 0 1 14.5 15z" fill="${W}"/><path d="M15.5 19.5v7.5M11.75 23.25h7.5" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><circle cx="31" cy="21" r="2" fill="${c}"/><circle cx="35.5" cy="25.5" r="2" fill="${c}"/>`,
  plane: () => `<path transform="rotate(40 24 23)" d="M24 6c2 0 3 2 3 4v8l13 8v4l-13-4v8l4 3v3l-7-2-7 2v-3l4-3v-8l-13 4v-4l13-8v-8c0-2 1-4 3-4z" fill="${W}"/>`,
  turbine: c => `<path d="M24 20v20M16 41h16" stroke="${W}" stroke-width="3" stroke-linecap="round"/><g fill="${W}"><ellipse cx="24" cy="11.5" rx="2.8" ry="8.5"/><ellipse cx="24" cy="11.5" rx="2.8" ry="8.5" transform="rotate(120 24 20)"/><ellipse cx="24" cy="11.5" rx="2.8" ry="8.5" transform="rotate(240 24 20)"/></g><circle cx="24" cy="20" r="3" fill="${W}" stroke="${c}" stroke-width="2"/>`,
  bank: c => `<path d="M24 6.5l16.5 8.5h-33z" fill="${W}"/><circle cx="24" cy="11.8" r="2" fill="${c}"/><rect x="8.5" y="17" width="31" height="3" rx=".8" fill="${W}"/><path d="M13 22.5v11M20 22.5v11M28 22.5v11M35 22.5v11" stroke="${W}" stroke-width="3.6"/><rect x="7.5" y="35.5" width="33" height="4.5" rx="1.2" fill="${W}"/>`,
  paw: () => `<g fill="${W}"><path d="M24 22c5 0 10.5 6 10.5 11 0 4-3 5.5-6 5.5-2 0-3-1-4.5-1s-2.5 1-4.5 1c-3 0-6-1.5-6-5.5 0-5 5.5-11 10.5-11z"/><ellipse cx="11.5" cy="22" rx="3.6" ry="4.6" transform="rotate(-25 11.5 22)"/><ellipse cx="19" cy="13.5" rx="3.6" ry="4.8" transform="rotate(-8 19 13.5)"/><ellipse cx="29" cy="13.5" rx="3.6" ry="4.8" transform="rotate(8 29 13.5)"/><ellipse cx="36.5" cy="22" rx="3.6" ry="4.6" transform="rotate(25 36.5 22)"/></g>`,
};

export function logo(c, size = 44) {
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="${c.name} 로고"><rect width="48" height="48" rx="13" fill="${c.color}"/>${LOGO[c.logo](c.color)}</svg>`;
}

// ---------- 마스코트: 부엉 선생님 ----------
export function owl(cls = '') {
  return `<svg class="owl ${cls}" viewBox="0 0 100 100" aria-hidden="true">
<path d="M21 34L25 11l16 13z" fill="#7A5230"/><path d="M79 34L75 11 59 24z" fill="#7A5230"/>
<ellipse cx="50" cy="56" rx="33" ry="36" fill="#9B6B43"/>
<path d="M18 52c-5 16 1 30 13 34-3-11-4-22-1-33z" fill="#7A5230"/><path d="M82 52c5 16-1 30-13 34 3-11 4-22 1-33z" fill="#7A5230"/>
<ellipse cx="50" cy="69" rx="21" ry="21" fill="#EBD5B5"/>
<path d="M40 64q3 3.5 6 0q3 3.5 6 0q3 3.5 6 0M43 72q3 3.5 6 0q3 3.5 6 0" stroke="#C9A57A" stroke-width="2" fill="none" stroke-linecap="round"/>
<circle cx="37" cy="43" r="12" fill="#fff"/><circle cx="63" cy="43" r="12" fill="#fff"/>
<circle cx="38" cy="44" r="6" fill="#2B2B33"/><circle cx="62" cy="44" r="6" fill="#2B2B33"/>
<circle cx="40" cy="42" r="2" fill="#fff"/><circle cx="64" cy="42" r="2" fill="#fff"/>
<circle cx="37" cy="43" r="13.5" fill="none" stroke="#2E3A59" stroke-width="2.6"/><circle cx="63" cy="43" r="13.5" fill="none" stroke="#2E3A59" stroke-width="2.6"/><path d="M47.5 41q2.5-2 5 0" stroke="#2E3A59" stroke-width="2.6" fill="none"/>
<path d="M45.5 52h9L50 59.5z" fill="#F2A33A"/>
<path d="M40 91.5v-4M44 91.5v-4M56 91.5v-4M60 91.5v-4" stroke="#F2A33A" stroke-width="3" stroke-linecap="round"/>
</svg>`;
}

// ---------- 공부하기 그림 ----------
const person = (x, y, c) => `<circle cx="${x}" cy="${y}" r="7" fill="${c}"/><path d="M${x - 10} ${y + 24}a10 11 0 0 1 20 0z" fill="${c}"/>`;
const T = (x, y, s, size = 12, fill = 'var(--text)', anchor = 'middle') => `<text x="${x}" y="${y}" font-size="${size}" font-weight="700" fill="${fill}" text-anchor="${anchor}">${s}</text>`;

const PICS = {
  pizza: () => `<path d="M100 72L145 98A52 52 0 1 1 145 46z" fill="#F6C453" stroke="#E0A23A" stroke-width="6" stroke-linejoin="round"/>
<path d="M100 72L100 20M100 72L55 46M100 72L55 98M100 72L100 124" stroke="#E0A23A" stroke-width="2"/>
<g fill="#E2574C"><circle cx="80" cy="45" r="6"/><circle cx="68" cy="78" r="6"/><circle cx="92" cy="104" r="6"/><circle cx="115" cy="36" r="5"/><circle cx="118" cy="104" r="5"/></g>
<g transform="translate(22 0)"><path d="M100 72L145 46A52 52 0 0 1 145 98z" fill="#F6C453" stroke="#E0A23A" stroke-width="6" stroke-linejoin="round"/><circle cx="130" cy="72" r="6" fill="#E2574C"/></g>
${T(100, 138, '회사 전체')}${T(198, 30, '주식 1주', 13, 'var(--primary)')}<path d="M190 36l-12 18" stroke="var(--primary)" stroke-width="2" stroke-linecap="round"/>`,
  crowd: () => `${person(28, 58, '#E5484D')}${person(54, 50, '#E5484D')}${person(80, 58, '#E5484D')}${person(41, 86, '#E5484D')}${person(67, 86, '#E5484D')}
${person(170, 66, '#3366E0')}${person(198, 66, '#3366E0')}
<path d="M122 112V34M106 50l16-17 16 17" stroke="#E5484D" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
${T(54, 132, '사고 싶은 사람', 12, '#E5484D')}${T(184, 132, '팔고 싶은 사람', 12, '#3366E0')}${T(122, 22, '주가', 13)}`,
  paper: () => `<rect x="48" y="14" width="120" height="112" rx="8" fill="var(--card)" stroke="var(--line-strong)" stroke-width="3"/>
<rect x="62" y="28" width="92" height="12" rx="3" fill="var(--text)"/><path d="M62 52h40M62 62h40M62 72h36M62 82h40M62 92h30M62 102h38" stroke="var(--muted)" stroke-width="3" stroke-linecap="round"/>
<rect x="110" y="50" width="44" height="54" rx="4" fill="var(--up-soft)"/><path d="M114 96l9-12 8 6 12-18" stroke="#E5484D" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="160" y="20" width="62" height="24" rx="12" fill="#E5484D"/>${T(191, 36, '좋은 소식', 11, '#fff')}`,
  bars: () => `<path d="M30 118h180" stroke="var(--line-strong)" stroke-width="3" stroke-linecap="round"/>
<rect x="55" y="66" width="44" height="52" rx="5" fill="#9AA3B5"/><rect x="141" y="38" width="44" height="80" rx="5" fill="#E5484D"/>
<path d="M163 38V66" stroke="#fff" stroke-width="2" stroke-dasharray="4 3"/><path d="M99 66h42" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 3"/>
${T(77, 58, '살 때 1,000', 11)}${T(163, 30, '팔 때 1,300', 11)}${T(77, 136, '산 가격', 11, 'var(--muted)')}${T(163, 136, '판 가격', 11, 'var(--muted)')}
<rect x="190" y="44" width="48" height="22" rx="11" fill="var(--up-soft)"/>${T(214, 59, '+300', 12, '#E5484D')}`,
  dividend: () => `<rect x="20" y="40" width="58" height="80" rx="4" fill="#5B5BD6"/>${[52, 66, 80, 94].map(y => `<rect x="30" y="${y}" width="12" height="8" rx="1.5" fill="#fff"/><rect x="56" y="${y}" width="12" height="8" rx="1.5" fill="#fff"/>`).join('')}<path d="M16 40l33-20 33 20z" fill="#4646B8"/>
${T(49, 136, '회사', 12)}
${[30, 70, 110].map(y => `<path d="M88 80Q120 ${y - 6} 150 ${y + 6}" stroke="#F5B82E" stroke-width="2.5" fill="none" stroke-dasharray="5 4"/>`).join('')}
${[30, 70, 110].map(y => `<circle cx="132" cy="${y + 1}" r="7" fill="#F5B82E" stroke="#D18A0F" stroke-width="2"/>`).join('')}
${person(178, 14, '#12A37A')}${person(178, 54, '#12A37A')}${person(178, 94, '#12A37A')}${T(212, 64, '주주', 12, 'var(--text)', 'start')}`,
  baskets: () => [30, 95, 160].map((x, i) => `<g transform="translate(${x} 0)"><ellipse cx="18" cy="64" rx="10" ry="13" fill="#FFF6E5" stroke="#E7C9A0" stroke-width="2"/><ellipse cx="34" cy="62" rx="10" ry="13" fill="#FFF6E5" stroke="#E7C9A0" stroke-width="2"/><path d="M0 70h52l-7 40H7z" fill="#C98B4E"/><path d="M3 82h46M5 94h42M17 70l3 40M35 70l-3 40" stroke="#A86C33" stroke-width="2"/>${T(26, 130, `바구니 ${i + 1}`, 11, 'var(--muted)')}</g>`).join(''),
  tree: () => `<path d="M14 118h212" stroke="#8FBF6A" stroke-width="5" stroke-linecap="round"/>
<path d="M40 118v-14" stroke="#8B5E3C" stroke-width="4"/><circle cx="40" cy="98" r="9" fill="#5DBB63"/>
<path d="M110 118v-28" stroke="#8B5E3C" stroke-width="6"/><circle cx="110" cy="80" r="20" fill="#4CAF55"/>
<path d="M190 118v-40" stroke="#8B5E3C" stroke-width="8"/><circle cx="190" cy="56" r="32" fill="#3E9C48"/><circle cx="178" cy="50" r="4" fill="#E5484D"/><circle cx="200" cy="64" r="4" fill="#E5484D"/><circle cx="194" cy="40" r="4" fill="#E5484D"/>
<path d="M30 20h150M168 12l12 8-12 8" stroke="var(--muted)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>${T(105, 14, '시간이 지나면', 11, 'var(--muted)')}`,
  empty: () => `<rect x="70" y="30" width="100" height="80" rx="10" fill="var(--soft)" stroke="var(--line-strong)" stroke-width="3"/><path d="M70 55h100" stroke="var(--line-strong)" stroke-width="3"/><path d="M106 30V22a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v8" stroke="var(--line-strong)" stroke-width="3" fill="none"/><circle cx="120" cy="82" r="10" fill="none" stroke="var(--muted)" stroke-width="3"/><path d="M116 82h8" stroke="var(--muted)" stroke-width="3" stroke-linecap="round"/>`,
};

export function pic(name, cls = '') {
  return `<svg class="pic ${cls}" viewBox="0 0 240 140" aria-hidden="true">${(PICS[name] || PICS.empty)()}</svg>`;
}
