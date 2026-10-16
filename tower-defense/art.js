'use strict';
// 직접 그린 벡터 그림 (픽셀 아님). 버튼 아이콘과 타워 화면의 건물로 함께 쓴다.

const ART = (() => {
  const svg = (w, h, vb, body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`;
  const shadow = '<ellipse cx="60" cy="104" rx="54" ry="5" fill="#000" opacity=".2"/>';

  const school = svg(240, 220, '0 0 120 110', `
    <defs>
      <linearGradient id="schW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef8a5c"/><stop offset="1" stop-color="#c0522f"/></linearGradient>
      <linearGradient id="schR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f93e6"/><stop offset="1" stop-color="#3c58ad"/></linearGradient>
    </defs>${shadow}
    <rect x="8" y="46" width="104" height="56" rx="3" fill="url(#schW)" stroke="#5a2414" stroke-width="2.5"/>
    <g fill="#c86a45" opacity=".55"><rect x="12" y="66" width="10" height="3"/><rect x="26" y="90" width="12" height="3"/><rect x="86" y="70" width="10" height="3"/><rect x="96" y="92" width="10" height="3"/></g>
    <rect x="4" y="40" width="112" height="9" rx="3" fill="url(#schR)" stroke="#23336b" stroke-width="2.5"/>
    <g fill="#bfe6ff" stroke="#fff" stroke-width="2">
      <rect x="14" y="55" width="12" height="11" rx="1.5"/><rect x="29" y="55" width="12" height="11" rx="1.5"/>
      <rect x="79" y="55" width="12" height="11" rx="1.5"/><rect x="94" y="55" width="12" height="11" rx="1.5"/>
      <rect x="14" y="76" width="12" height="11" rx="1.5"/><rect x="29" y="76" width="12" height="11" rx="1.5"/>
      <rect x="79" y="76" width="12" height="11" rx="1.5"/><rect x="94" y="76" width="12" height="11" rx="1.5"/>
    </g>
    <rect x="42" y="22" width="36" height="80" fill="#f6ead2" stroke="#5a2414" stroke-width="2.5"/>
    <path d="M37 24 L60 5 L83 24 Z" fill="url(#schR)" stroke="#23336b" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="60" cy="38" r="9" fill="#fff" stroke="#5a2414" stroke-width="2.5"/>
    <path d="M60 38 V32 M60 38 L64.5 40" stroke="#2b2b2b" stroke-width="2" stroke-linecap="round"/>
    <path d="M51 102 V84 a9 9 0 0 1 18 0 V102 Z" fill="#7a4622" stroke="#3a1d0b" stroke-width="2.2"/>
    <line x1="60" y1="76" x2="60" y2="102" stroke="#3a1d0b" stroke-width="1.6"/>
    <line x1="13" y1="40" x2="13" y2="16" stroke="#5a4636" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M13 17 L30 21 L13 26 Z" fill="#ff5a4a" stroke="#8a1f16" stroke-width="1.6" stroke-linejoin="round"/>`);

  let stripes = '';
  for (let i = 0; i < 8; i++) {
    const x0 = 10 + i * 12.5, c = i % 2 ? '#ffffff' : '#ef4b3c';
    stripes += `<path d="M${x0 + 1.5} 42 H${x0 + 14} L${x0 + 13} 56 a6.25 6.25 0 0 1 -12.5 0 Z" fill="${c}" stroke="#7a1d14" stroke-width="1.6"/>`;
  }
  const shop = svg(240, 220, '0 0 120 110', `
    <defs><linearGradient id="shpW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3d9"/><stop offset="1" stop-color="#f0d6a6"/></linearGradient></defs>${shadow}
    <rect x="14" y="40" width="92" height="62" rx="3" fill="url(#shpW)" stroke="#6b3d1f" stroke-width="2.5"/>
    <rect x="22" y="20" width="76" height="19" rx="5" fill="#3f9a3a" stroke="#1f4d1c" stroke-width="2.5"/>
    <circle cx="60" cy="29.5" r="6" fill="#ffd23a" stroke="#8a5a00" stroke-width="1.8"/>
    <rect x="58.3" y="26" width="3.4" height="7" rx="1" fill="#e19a12"/>
    ${stripes}
    <rect x="20" y="66" width="46" height="30" rx="2" fill="#a8defa" stroke="#6b3d1f" stroke-width="2.5"/>
    <path d="M24 70 L34 70 L24 80 Z" fill="#fff" opacity=".7"/>
    <g stroke="#6b3d1f" stroke-width="1.2"><circle cx="31" cy="90" r="4.5" fill="#ff5a4a"/><circle cx="41" cy="90" r="4.5" fill="#ffb02e"/><circle cx="51" cy="90" r="4.5" fill="#7ed957"/><circle cx="36" cy="83" r="4" fill="#ffd23a"/><circle cx="46" cy="83" r="4" fill="#ff7aa8"/></g>
    <rect x="74" y="62" width="24" height="40" rx="2" fill="#8a5428" stroke="#3a1d0b" stroke-width="2.5"/>
    <rect x="78" y="66" width="16" height="14" rx="1.5" fill="#a8defa" stroke="#3a1d0b" stroke-width="1.5"/>
    <circle cx="93" cy="84" r="1.8" fill="#ffd23a"/>`);

  let grid = '';
  for (let r = 0; r < 7; r++) for (let c = 0; c < 3; c++) grid += `<rect x="${42.5 + c * 12.5}" y="${18 + r * 10}" width="9" height="6.5" rx="1" fill="#d9f2ff" opacity="${0.55 + ((r + c) % 3) * 0.15}"/>`;
  let wing = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) wing += `<rect x="${14 + c * 13}" y="${54 + r * 10}" width="9" height="6" rx="1" fill="#e8f7ff" opacity=".8"/><rect x="${82 + c * 13}" y="${42 + r * 12}" width="9" height="7" rx="1" fill="#e8f7ff" opacity=".8"/>`;
  const company = svg(240, 220, '0 0 120 110', `
    <defs>
      <linearGradient id="cmpG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7cc3f5"/><stop offset="1" stop-color="#2f6fb5"/></linearGradient>
      <linearGradient id="cmpS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9aa9bb"/><stop offset="1" stop-color="#5d6c80"/></linearGradient>
    </defs>${shadow}
    <rect x="10" y="48" width="32" height="54" rx="2" fill="url(#cmpS)" stroke="#1d2f4f" stroke-width="2.5"/>
    <rect x="78" y="36" width="32" height="66" rx="2" fill="url(#cmpS)" stroke="#1d2f4f" stroke-width="2.5"/>
    ${wing}
    <rect x="38" y="12" width="44" height="90" rx="2" fill="url(#cmpG)" stroke="#1d2f4f" stroke-width="2.5"/>
    ${grid}
    <path d="M42 14 L56 14 L42 40 Z" fill="#fff" opacity=".35"/>
    <line x1="60" y1="12" x2="60" y2="1" stroke="#1d2f4f" stroke-width="2.2"/>
    <circle cx="60" cy="2" r="2.4" fill="#ff4a3a"/>
    <rect x="49" y="86" width="22" height="16" rx="1.5" fill="#1d3a5f" stroke="#0e1d33" stroke-width="2"/>
    <line x1="60" y1="86" x2="60" y2="102" stroke="#7cc3f5" stroke-width="1.5"/>
    <rect x="44" y="80" width="32" height="5" rx="1.5" fill="#ffd23a" stroke="#8a5a00" stroke-width="1.4"/>`);

  let flags = '';
  const fc = ['#ff5a4a', '#ffd23a', '#4ab0ff', '#7ed957', '#ff7aa8', '#b07cff'];
  for (let i = 0; i < 6; i++) {
    const x = 8 + i * 6.2, y = 44 - i * 4.2;
    flags += `<path d="M${x} ${y} L${x + 6} ${y - 4.2} L${x + 4.5} ${y + 4} Z" fill="${fc[i]}"/>`;
  }
  const office = svg(240, 220, '0 0 120 110', `
    <defs><linearGradient id="ofcR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b7ee6"/><stop offset="1" stop-color="#5e43ad"/></linearGradient></defs>${shadow}
    <path d="M6 46 L40 18" stroke="#6b5a4a" stroke-width="1.2"/>${flags}
    <rect x="12" y="52" width="96" height="50" rx="3" fill="#ffffff" stroke="#4a3a6a" stroke-width="2.5"/>
    <rect x="6" y="45" width="108" height="10" rx="3" fill="url(#ofcR)" stroke="#33236b" stroke-width="2.5"/>
    <rect x="18" y="61" width="58" height="33" rx="2" fill="#a8defa" stroke="#4a3a6a" stroke-width="2"/>
    <path d="M22 65 L36 65 L22 82 Z" fill="#fff" opacity=".7"/>
    <path d="M30 92 V80 L40 72 L50 80 V92 Z" fill="#ffe08a" stroke="#8a5a00" stroke-width="1.5"/>
    <path d="M52 92 V83 L59 77 L66 83 V92 Z" fill="#ffc0d6" stroke="#8a3a5a" stroke-width="1.5"/>
    <rect x="82" y="61" width="20" height="41" rx="2" fill="#cfeeff" stroke="#4a3a6a" stroke-width="2"/>
    <line x1="92" y1="61" x2="92" y2="102" stroke="#4a3a6a" stroke-width="1.4"/>
    <path d="M44 45 V30 L60 17 L76 30 V45 Z" fill="#ffd23a" stroke="#8a5a00" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="55.5" y="33" width="9" height="12" rx="1" fill="#c0661a"/>
    <path d="M108 50 L106 30 M108 50 L114 34 M108 50 L100 36" stroke="#6b5a4a" stroke-width="1"/>
    <ellipse cx="106" cy="25" rx="5.5" ry="6.5" fill="#ff5a7a" stroke="#8a1f3a" stroke-width="1.2"/>
    <ellipse cx="115" cy="29" rx="5" ry="6" fill="#4ab0ff" stroke="#1f4d8a" stroke-width="1.2"/>
    <ellipse cx="99" cy="31" rx="5" ry="6" fill="#ffd23a" stroke="#8a5a00" stroke-width="1.2"/>`);

  const lock = svg(64, 76, '0 0 64 76', `
    <defs><linearGradient id="lkG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset="1" stop-color="#e0961a"/></linearGradient></defs>
    <path d="M17 34 V23 a15 15 0 0 1 30 0 V34" fill="none" stroke="#3a2410" stroke-width="12" stroke-linecap="round"/>
    <path d="M17 34 V23 a15 15 0 0 1 30 0 V34" fill="none" stroke="#c8ccd4" stroke-width="6" stroke-linecap="round"/>
    <rect x="6" y="32" width="52" height="40" rx="9" fill="url(#lkG)" stroke="#3a2410" stroke-width="4"/>
    <circle cx="32" cy="49" r="5.5" fill="#3a2410"/><rect x="29.5" y="51" width="5" height="11" rx="2" fill="#3a2410"/>
    <path d="M12 38 h14" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>`);

  const check = svg(64, 64, '0 0 64 64', `
    <circle cx="32" cy="32" r="28" fill="#4cc94a" stroke="#1d5a1c" stroke-width="4"/>
    <path d="M18 33 L28 43 L47 22" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`);

  const hand = svg(96, 110, '0 0 96 110', `
    <path d="M34 60 V16 a8 8 0 0 1 16 0 V50 V40 a8 8 0 0 1 16 0 V54 V46 a8 8 0 0 1 15 2 V58 V54 a7 7 0 0 1 14 2 V78 c0 18 -12 28 -30 28 h-10 c-12 0 -18 -6 -26 -16 L10 70 c-4 -5 -2 -12 4 -13 c4 -1 8 1 11 4 Z"
      fill="#ffffff" stroke="#2b1d0e" stroke-width="5" stroke-linejoin="round"/>
    <path d="M50 50 V62 M66 54 V64 M81 58 V66" stroke="#2b1d0e" stroke-width="3.5" stroke-linecap="round"/>`);

  return { school, shop, company, office, lock, check, hand };
})();

const svgURL = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
