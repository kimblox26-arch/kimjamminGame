/* 매뜨 땅먹 — 선 아이콘 (24×24, 선 굵기 2)
 * 한 벌의 그림으로 화면(SVG)과 지도(캔버스)에 함께 쓴다. 화면 글자 속 이모티콘은 저절로 같은 선 아이콘으로 바뀐다.
 * (캐릭터 꾸미기·보스 그림·사람이 쓴 채팅 글은 그대로 둔다) */
(function () {
  'use strict';
  const C = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`; // 원
  const R = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`; // 둥근 네모
  const shield = 'M12 3L5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z';
  const ICONS = {
    pencil: 'M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4',
    target: C(12, 12, 9) + C(12, 12, 5) + C(12, 12, 1.2),
    swords: 'M14.5 17.5L3 6V3h3l11.5 11.5 M13 19l6-6 M16 16l4 4 M19 21l2-2 M14.5 6.5L18 3h3v3l-3.5 3.5 M5 14l4 4 M7 17l-3 3 M3 19l2 2',
    bag: 'M5 8h14l-1 12H6L5 8Z M9 8V7a3 3 0 0 1 6 0v1',
    chat: 'M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5Z M8.5 11.5h.01 M12 11.5h.01 M15.5 11.5h.01',
    trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4Z M16 5h3v2a3 3 0 0 1-3 3 M8 5H5v2a3 3 0 0 0 3 3 M12 13v4 M8 20h8',
    square: R(5, 5, 14, 14, 3),
    grid: R(4, 4, 6, 6, 1.5) + R(14, 4, 6, 6, 1.5) + R(4, 14, 6, 6, 1.5) + R(14, 14, 6, 6, 1.5),
    medal: C(12, 15, 5) + 'M8.5 11L6 3h4l2 4.5L14 3h4l-2.5 8 M12 13.5v3',
    chart: 'M4 20h16 M7 16v-4 M12 16V7 M17 16v-7',
    music: 'M9 18V6l11-2v12' + C(6.5, 18, 2.5) + C(17.5, 16, 2.5),
    volume: 'M11 5L6 9H3v6h3l5 4V5Z M15.5 9a4 4 0 0 1 0 6 M18.5 6a8 8 0 0 1 0 12',
    help: C(12, 12, 9) + 'M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5 M12 17h.01',
    sliders: 'M4 7h9 M17 7h3 M4 12h3 M11 12h9 M4 17h11 M19 17h1' + C(15, 7, 2) + C(9, 12, 2) + C(17, 17, 2),
    shield: shield,
    shieldok: shield + ' M9 12l2 2 4-4',
    plus: 'M12 5v14 M5 12h14',
    minus: 'M5 12h14',
    home: 'M4 11l8-7 8 7 M6 10v10h12V10 M10 20v-5h4v5',
    map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z M9 4v14 M15 6v14',
    smile: C(12, 12, 9) + 'M8.5 14a4 4 0 0 0 7 0 M9 9.5h.01 M15 9.5h.01',
    sad: C(12, 12, 9) + 'M8.5 16.5a4 4 0 0 1 7 0 M9 9.5h.01 M15 9.5h.01',
    coin: C(12, 12, 9) + 'M14.8 9.4c-.5-.9-1.5-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2s1.1 1.6 2.8 2 2.8.9 2.8 2.1-1.2 2-2.8 2c-1.3 0-2.4-.6-2.9-1.5 M12 6.3v1.6 M12 16v1.7',
    globe: C(12, 12, 9) + 'M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18',
    users: C(9, 8, 3.5) + 'M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.6a3.5 3.5 0 0 1 0 6.8 M18 14.5c2 .9 3.5 2.9 3.5 5.5',
    user: C(12, 8, 4) + 'M4 21a8 8 0 0 1 16 0',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z',
    school: 'M3 21h18 M5 21V10l7-5 7 5v11 M10 21v-5h4v5 M12 5V2l3 1.2-3 1.2 M8.5 12h.01 M15.5 12h.01',
    handshake: 'M2 11l4-4 4 2 3-2 4 1 5 3 M2 11l5 5 M22 11l-6 6c-.8.8-2 .8-2.8 0l-.5-.5 M7 16l2 2c.8.8 2 .8 2.8 0 M10 13l3 3 M12.5 11.5l3 3',
    gift: R(4, 8.5, 16, 4.5, 1) + 'M5.5 13h13v7.5h-13Z M12 8.5v12 M12 8.5C10 4.5 6.4 5.4 7.4 7.6c.7 1.2 4.6.9 4.6.9Z M12 8.5c2-4 5.6-3.1 4.6-.9-.7 1.2-4.6.9-4.6.9Z',
    tag: 'M3 12V4h8l10 10-8 8L3 12Z' + C(7.5, 7.5, 1.3),
    door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17 M3 21h18 M14.5 12h.01',
    cap: 'M2 9l10-5 10 5-10 5L2 9Z M6 11v5c3 2.5 9 2.5 12 0v-5 M22 9v6',
    sail: 'M3 17h18l-2.5 4h-13L3 17Z M12 3v14 M12 4l7 11h-7 M11 6.5L6 15h5',
    flag: 'M5 21V4 M5 4h11l-2 4 2 4H5',
    pole: 'M4 21h6 M7 21V3 M7 4h12l-3 3.5 3 3.5H7',
    checkc: C(12, 12, 9) + 'M8 12.5l2.5 2.5L16 9.5',
    check: 'M5 12.5l4.5 4.5L19 7',
    x: 'M6 6l12 12 M18 6L6 18',
    xc: C(12, 12, 9) + 'M9 9l6 6 M15 9l-6 6',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
    timer: C(12, 13, 8) + 'M12 9v4l2.5 2 M10 2h4 M19 6l1.5-1.5',
    build: 'M4 21h16 M7 21V4h11 M7 4l11 5 M18 4v8 M16 12h4v3h-4Z M7 9h3 M7 14h3',
    tools: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8Z',
    fire: 'M12 21c-3.9 0-7-2.7-7-6.5 0-3.2 2.3-5.4 3.5-7.5.5 2 1.5 3 2.5 3.5 0-3 1.5-5.5 3.5-7.5.5 3 4.5 5.5 4.5 11 0 4-3 7-7 7Z M12 21c-1.7 0-3-1.2-3-3 0-1.6 1.3-2.6 2-3.5.3 1 1 1.5 1.5 1.5 0-1 .5-2 1.5-2.5.3 1.5 1 2.5 1 4 0 2-1.3 3.5-3 3.5Z',
    rocket: 'M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2-.1-2.8-.8-.8-2.1-.9-2.9-.2Z M12 15l-3-3c1.5-4 4-8 10-9 0 6-5 8.5-7 12Z M9 12H5l2-4c1-.3 3 0 3 0 M12 15v4l4-2s.3-2 0-3' + C(15, 8.5, 1.5),
    pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z' + C(12, 9, 2.5),
    boss: 'M5 21V11a7 7 0 0 1 14 0v10l-2.3-1.8L14.3 21 12 19.2 9.7 21l-2.4-1.8L5 21Z M9.5 11h.01 M14.5 11h.01 M10 15h4',
    bomb: C(11, 14, 7) + 'M15.5 8.5L17 7 M17 7l2-2 M19.5 2.5v1 M21.5 4.5h-1 M8 13a3 3 0 0 1 3-3',
    scope: 'M3 16l12-6 2 4-12 6-2-4Z M15 10l4-2 2 4-4 2 M10 18l-2 4 M12 17l2 5',
    refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.6 4.5L20 16 M20 20v-4h-4',
    note: R(5, 3, 14, 18, 1.5) + 'M9 3v18 M12 8h4 M12 12h4',
    palette: 'M12 3a9 9 0 0 0 0 18c1 0 1.7-.7 1.7-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.4-9-7.4Z' + C(7.5, 11, 1) + C(10, 7, 1) + C(14.5, 7, 1) + C(17, 10.5, 1),
    ballot: 'M4 12h16v8H4Z M8 12V4h8v8 M10 8l1.5 1.5L14 7 M8 16h8',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8Z',
    mail: R(3, 5, 18, 14, 2) + 'M3 7l9 6 9-6',
    party: 'M4 20l3.5-11 7.5 7.5L4 20Z M8 13l3 3 M14 3c.5 1.5 0 3-1.5 4 M17 9.5c1.5-.8 3-.8 4 .2 M19 4l.5 1.5 M21 7h-1.5 M16 5.5l-.5-1.5',
    ban: C(12, 12, 9) + 'M5.6 5.6l12.8 12.8',
    bug: 'M8 9h8v6a4 4 0 0 1-8 0V9Z M9 9V7a3 3 0 0 1 6 0v2 M4 12h4 M16 12h4 M5 7l3 2 M19 7l-3 2 M5 18l3-2 M19 18l-3-2 M12 9v10',
    bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z',
    tower: 'M6 4h2v2h2V4h4v2h2V4h2v6H6V4Z M7 10l1 11h8l1-11 M10.5 21v-4h3v4 M12 13v.01',
    wall: R(3, 5, 18, 14, 1) + 'M3 9.7h18 M3 14.3h18 M8 5v4.7 M16 5v4.7 M12 9.7v4.6 M7 14.3V19 M16 14.3V19',
    books: R(4, 4, 4, 16, .5) + R(10, 4, 4, 16, .5) + 'M15.5 5l3.5-1 2.5 15.5-3.5 1Z',
    calendar: R(4, 5, 16, 15, 2) + 'M4 10h16 M8 3v4 M16 3v4 M8 14h2 M12 14h2 M16 14h.01',
    megaphone: 'M3 10v4h3l9 5V5L6 10H3Z M18 9a3 3 0 0 1 0 6 M7 14l1 5h2.5l-1-4.5',
    broom: 'M14 3l-4 9 M7 12h9l1 2-1 7H6l-1-7 1-2Z M9 15v6 M12.5 15v6',
    boom: 'M12 2l1.8 5.2L19 5l-2.2 5L22 12l-5.2 1.8L19 19l-5-2.2L12 22l-1.8-5.2L5 19l2.2-5L2 12l5.2-1.8L5 5l5 2.2L12 2Z',
    crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8Z M5 19h14',
    key: C(8, 15, 4) + 'M11 12l9-9 M17 6l3 3 M15 8l2 2',
    lock: R(5, 11, 14, 10, 2) + 'M8 11V7a4 4 0 0 1 8 0v4 M12 15v2',
    search: C(11, 11, 7) + 'M16 16l5 5',
    compass: C(12, 12, 9) + 'M15.5 8.5l-2 5-5 2 2-5 5-2Z',
    wave: 'M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2 M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2',
    hammer: 'M13 6l5 5 M10.5 3.5L16 9l-3 3L7.5 6.5Z M12 11L4 19l1.5 1.5L13.5 12.5',
    leaf: 'M5 19C5 10 10 5 20 4c-1 10-6 15-15 15Z M5 19l8-8',
    hourglass: 'M6 3h12 M6 21h12 M7 3c0 5 10 5 10 9s-10 4-10 9 M17 3c0 5-10 5-10 9s10 4 10 9',
    scroll: 'M7 3h11a2 2 0 0 1 2 2v12 M7 3a2 2 0 0 0-2 2v13a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1H10v1a3 3 0 0 1-3 3 M9 8h7 M9 12h7',
    city: 'M3 21h18 M5 21V9h6v12 M11 21V4h8v17 M8 13h.01 M8 17h.01 M14 8h2 M14 12h2 M14 16h2',
    sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z',
    alert: 'M12 3l10 18H2L12 3Z M12 10v5 M12 18h.01',
    cake: 'M4 21h16 M5 21v-7h14v7 M5 16.5c2.3 1.6 4.7 1.6 7 0s4.7-1.6 7 0 M12 14v-3 M12 6.5c1 .9 1 2 0 2.8-1-.8-1-1.9 0-2.8Z',
    clipboard: 'M8 4h8v3H8Z M6 5H5v16h14V5h-1 M9 12h6 M9 16h6',
    anchor: C(12, 5, 2) + 'M12 7v14 M5 13a7 7 0 0 0 14 0 M3 13h4 M17 13h4',
    heart: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11Z',
    logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
    image: R(3, 5, 18, 14, 2.5) + C(8.5, 10, 1.6) + 'M3.5 17l5-5 4 4 2.5-2.5 5.5 5',
    video: R(3, 6, 13, 12, 2.5) + 'M16 10.5l5-3v9l-5-3',
    brush: 'M19.5 3.5c-3 1.5-7.5 6-9.5 9l2 2c3-2 7.5-6.5 9-9.5l-1.5-1.5Z M9.5 13.5c-2 0-3.5 1.5-3.5 3.5 0 1.3-.8 2.3-2 2.5 3.5 1.2 8 .5 7.5-4Z',
    idcard: R(3, 5, 18, 14, 2.5) + C(8.5, 11, 2) + 'M5.5 16.5c.6-1.6 1.6-2.4 3-2.4s2.4.8 3 2.4 M14 10h4 M14 14h3',
    eraser: 'M8 20h12 M4.5 15.5l9-9.5a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L12 19.5H8l-3.5-3.5a1 1 0 0 1 0-.5Z M9 11l5 5',
    bucket: 'M5 11l7-7 7 7-7 7-7-7Z M5 11h14 M20 15s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3Z',
    undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
    siren: 'M6 18v-6a6 6 0 0 1 12 0v6 M4 21h16 M12 3v1 M4.5 6l.8.8 M19.5 6l-.8.8 M10 12a2 2 0 0 1 2-2',
    font: 'M4 20L10 4h1l6 16 M6.5 14h8 M17 20v-6.5a2.5 2.5 0 0 1 5 0V20 M17 16.5h5',
    copy: R(8, 8, 12, 12, 2) + 'M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3',
  };
  // 이모티콘 → 아이콘 (변형 선택자 FE0F 가 있든 없든)
  const PAIRS = {
    shield: '🛡️🛡', square: '⬜⬛◻️', swords: '⚔️🗡️', coin: '🪙', school: '🏫', handshake: '🤝', gift: '🎁', bag: '🛒🎒', tag: '🏷️', door: '🚪', pencil: '✏️', cap: '👩‍🏫🎓', sail: '⛵',
    user: '😀🧒👤', flag: '🚩🏁', checkc: '✅', trash: '🗑️', timer: '⏱️', build: '🏗️', tools: '🛠️', fire: '🔥', rocket: '🚀☄️', pin: '📍', boss: '👾', bomb: '💣', scope: '🔭',
    star: '⭐🌟', globe: '🌐', refresh: '🔄♻️', note: '📒📘', target: '🎯', palette: '🧑‍🎨', ballot: '🗳️', trophy: '🏆', map: '🗺️🗾', chat: '💬', chart: '📊', bolt: '⚡💪', mail: '📨',
    xc: '❌🙅', party: '🎉', ban: '🚫✋', bug: '🐛', bulb: '💡', music: '🎵', tower: '🗼🏰🏯', sad: '😢😵', books: '📚', calendar: '🗓️📅', medal: '🏅🥇🥈🥉', megaphone: '📢', broom: '🧹',
    boom: '🧨💥', wall: '🧱', crown: '👑', key: '🔑', lock: '🔐🔒🔓', help: '❓', search: '🔎🔍', compass: '🧭', pole: '🎌', wave: '🌊', hammer: '🔨', leaf: '🕊️🌱', hourglass: '⏳',
    scroll: '📜', city: '🏙️🏘️', sliders: '⚙️', sparkles: '✨', alert: '😱', cake: '🎂', clipboard: '📋', volume: '🔊', smile: '😊😆', check: '👍', anchor: '⚓', x: '✕', image: '🖼️📷📸🏞️', video: '🎬📹🎥', brush: '🖌️🖍️', idcard: '🪪', eraser: '🧽', bucket: '🪣', undo: '↩️', siren: '🚨', font: '🔤🔠',
  };
  const MAP = {};
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
  for (const [name, str] of Object.entries(PAIRS)) {
    const list = seg ? [...seg.segment(str)].map(x => x.segment) : str.match(/(?:\p{Extended_Pictographic}|[✕])(?:️)?(?:‍\p{Extended_Pictographic}️?)*/gu) || [];
    for (const e of list) { MAP[e] = name; MAP[e.replace(/️/g, '')] = name; }
  }
  const keys = Object.keys(MAP).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const RE = new RegExp(`(?:${keys.join('|')})\\uFE0F?`, 'gu');
  const nameOf = e => MAP[e] || MAP[e.replace(/️/g, '')];

  // ---------- 화면: SVG 아이콘 ----------
  const NS = 'http://www.w3.org/2000/svg';
  function sprite() {
    if (document.getElementById('mleIcons')) return;
    const svg = document.createElementNS(NS, 'svg');
    svg.id = 'mleIcons'; svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML = Object.entries(ICONS).map(([k, d]) => `<symbol id="i-${k}" viewBox="0 0 24 24"><path d="${d}"/></symbol>`).join('');
    document.body.prepend(svg);
  }
  const svgHTML = (name, cls) => `<svg class="ie i-${name}${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  function iconEl(name) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', `ie i-${name}`); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#i-' + name);
    s.appendChild(u);
    return s;
  }
  // 글자 속 이모티콘을 아이콘으로 (캐릭터 꾸미기·보스·사람이 쓴 글·입력칸은 그대로)
  const SKIP = '.av, .lk-av, .lp-av, .pf-av, .boss, .no-ic, option, select, textarea, script, style, svg, canvas, input, .keep-emoji';
  function decoText(t) {
    const s = t.nodeValue;
    RE.lastIndex = 0;
    if (!s || !RE.test(s)) return;
    const p = t.parentElement;
    if (!p || p.closest(SKIP)) return;
    RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = RE.exec(s))) {
      const name = nameOf(m[0]);
      if (!name) continue;
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      frag.appendChild(iconEl(name));
      last = m.index + m[0].length;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    p.replaceChild(frag, t);
  }
  function deco(root) {
    if (!root) return;
    if (root.nodeType === 3) return decoText(root);
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n);
    list.forEach(decoText);
  }
  let pending = new Set(), queued = false;
  function flush() { queued = false; const l = [...pending]; pending = new Set(); l.forEach(n => { if (n.isConnected) deco(n); }); }
  function watch() {
    sprite();
    deco(document.body);
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'characterData') pending.add(m.target);
        else m.addedNodes.forEach(n => pending.add(n));
      }
      if (!queued && pending.size) { queued = true; requestAnimationFrame(flush); }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

  // ---------- 지도(캔버스): 동그란 배지 위에 같은 아이콘 ----------
  const paths = {};
  function draw(ctx, name, x, y, size, color, bg) {
    const d = ICONS[name];
    if (!d) return;
    const p = paths[name] || (paths[name] = new Path2D(d)), r = size / 2;
    ctx.save();
    if (bg !== false) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
      ctx.fillStyle = bg || '#fff'; ctx.fill();
      ctx.lineWidth = Math.max(1.5, size * 0.08); ctx.strokeStyle = color; ctx.stroke();
    }
    const k = (size * 0.6) / 24;
    ctx.translate(x - 12 * k, y - 12 * k); ctx.scale(k, k);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
    ctx.stroke(p);
    ctx.restore();
  }
  window.MLEIcons = { ICONS, svg: svgHTML, deco, draw, nameOf };
})();
