/* 매뜨 땅먹 — 서버와 브라우저가 함께 쓰는 것 (지도 좌표계, 나이 인증 학년 계산) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MLE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 위도·경도 → 지도 좌표 (1칸 ≈ 13.9m, 위도 36.5° 기준으로 가로 길이를 보정)
  const PROJ = { lon0: 124.4, lat0: 38.8, k: 8000, cos: 0.8039 };
  const project = (lon, lat) => [(lon - PROJ.lon0) * PROJ.k * PROJ.cos, (PROJ.lat0 - lat) * PROJ.k];
  const unproject = (x, y) => [PROJ.lat0 - y / PROJ.k, PROJ.lon0 + x / (PROJ.k * PROJ.cos)];

  // 나이 인증: 출생연도로 학년 계산 (3월에 새 학년 시작)
  function schoolYear(now) {
    now = now || new Date();
    return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  }
  const gradeFromBirthYear = (birthYear, now) => schoolYear(now) - birthYear - 6;

  // 배지: 기록(key)이 n 이상이면 받는다
  const BADGES = [
    { id: 'cap1', icon: '🚩', name: '첫 땅', desc: '땅을 처음 차지하기', key: 'captures', n: 1 },
    { id: 'cap10', icon: '🏘️', name: '땅부자', desc: '땅 10칸 차지하기', key: 'captures', n: 10 },
    { id: 'cap50', icon: '🏰', name: '땅의 왕', desc: '땅 50칸 차지하기', key: 'captures', n: 50 },
    { id: 'cap200', icon: '👑', name: '대한민국 정복자', desc: '땅 200칸 차지하기', key: 'captures', n: 200 },
    { id: 'steal1', icon: '⚔️', name: '첫 결투 승리', desc: '다른 학교 땅 처음 빼앗기', key: 'steals', n: 1 },
    { id: 'steal20', icon: '🗡️', name: '결투의 달인', desc: '다른 학교 땅 20칸 빼앗기', key: 'steals', n: 20 },
    { id: 'sol10', icon: '✏️', name: '연필 잡기', desc: '문제 10개 풀기', key: 'solved', n: 10 },
    { id: 'sol100', icon: '📘', name: '수학 탐험가', desc: '문제 100개 풀기', key: 'solved', n: 100 },
    { id: 'sol500', icon: '🎓', name: '수학 박사', desc: '문제 500개 풀기', key: 'solved', n: 500 },
    { id: 'def10', icon: '🛡️', name: '든든한 방패', desc: '방어 10 올리기', key: 'defends', n: 10 },
    { id: 'def50', icon: '🏯', name: '철벽 수비', desc: '방어 50 올리기', key: 'defends', n: 50 },
    { id: 'str5', icon: '🔥', name: '불꽃 5연속', desc: '5문제 연속 정답', key: 'bestStreak', n: 5 },
    { id: 'str10', icon: '☄️', name: '불꽃 10연속', desc: '10문제 연속 정답', key: 'bestStreak', n: 10 },
    { id: 'str20', icon: '🌟', name: '전설의 20연속', desc: '20문제 연속 정답', key: 'bestStreak', n: 20 },
    { id: 'day3', icon: '📅', name: '3일 출석', desc: '3일 동안 게임하기', key: 'days', n: 3 },
    { id: 'day7', icon: '🗓️', name: '7일 출석', desc: '7일 동안 게임하기', key: 'days', n: 7 },
    { id: 'day30', icon: '🏆', name: '30일 출석', desc: '30일 동안 게임하기', key: 'days', n: 30 },
  ];

  // 빠른 채팅: 아이들이 안전하게 쓰도록 정해진 말만 보낸다
  const CHAT = ['같이 땅 넓히자! 💪', '여기 방어해 줘! 🛡️', '공격 간다! ⚔️', '도와줘! 🆘', '잘했어! 👍', '고마워! 😊', '화이팅! 🔥', '문제 어렵다 😵', '내가 해볼게! ✋', 'ㅋㅋㅋ 😆'];

  // 직접 쓰는 채팅: 60자까지, 나쁜 말은 ♡ 로, 전화번호처럼 긴 숫자는 * 로 가린다 (어린이 안전)
  const BAD_WORDS = ['시발', '씨발', '씨바', '씨빨', '시바', '쉬발', '슈발', 'ㅅㅂ', 'ㅆㅂ', 'ㅅ ㅂ', '병신', '븅신', '빙신', 'ㅂㅅ', '개새', '개색', '개세', '새끼', '색기', '쌔끼', '존나', '졸라', 'ㅈㄴ', '좆', '졷', '지랄', 'ㅈㄹ', '닥쳐', '꺼져', '미친놈', '미친년', '미친새', '썅', '등신', '엿먹', '니애미', '느금', '애미', '애비', 'fuck', 'shit', 'bitch', 'damn', 'sex', '섹스', '야동'];
  function cleanChat(s) {
    let t = String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    for (const w of BAD_WORDS) {
      const re = new RegExp(w.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\\-_~!@#*]*'), 'gi'); // 사이에 띄어쓰기·기호를 넣어도 찾는다
      t = t.replace(re, m => '♡'.repeat(Math.min(4, m.replace(/[\s.\-_~!@#*]/g, '').length)));
    }
    return t.replace(/\d[\d\s-]{6,}\d/g, m => m.replace(/\d/g, '*')); // 전화번호
  }

  // 지도 칸 모양: [x0, y0, dx1, dy1, …] 로 줄여 둔 꼭짓점을 원래 좌표로
  function decodeRing(arr) {
    const out = new Int32Array(arr.length);
    let x = 0, y = 0;
    for (let k = 0; k < arr.length; k += 2) { x += arr[k]; y += arr[k + 1]; out[k] = x; out[k + 1] = y; }
    return out;
  }
  // 두 칸이 함께 쓰는 변 찾기. ring(c, visit) 는 칸 c 의 고리마다 visit(좌표 배열, 시작, 끝) 을 부른다.
  // 같은 변을 쓰는 칸을 만나면 fn(c, o, x1, y1, x2, y2, 앞 꼭짓점 자리, 뒤 꼭짓점 자리). 변(두 꼭짓점)을 열쇠로 하는 타입 배열 해시 표라 50만 칸도 빠르다.
  function sharedEdges(n, ring, fn, dims) { // dims: 지도 크기 {W, H} (꼭짓점 하나를 32비트 수 하나로 줄이는 데 쓴다)
    let total = 0;
    for (let c = 0; c < n; c++) ring(c, (r, s, e) => { total += (e - s) >> 1; });
    const cap = Math.ceil(total * 0.75) + 1024; // 서로 다른 변은 꼭짓점 수의 절반쯤 → 표가 2/3쯤 찬다
    const ka = new Uint32Array(cap), kb = new Uint32Array(cap), val = new Int32Array(cap).fill(-1);
    const O = dims ? 2 : 4096, HH = dims ? dims.H + 5 : 65536;
    if (dims && (dims.W + 5) * HH >= 4294967296) throw new Error('지도가 너무 커요');
    for (let c = 0; c < n; c++) ring(c, (r, s, e) => {
      if (e - s < 4) return;
      let px = r[e - 2], py = r[e - 1];
      for (let k = s; k < e; k += 2) {
        const x = r[k], y = r[k + 1];
        if (x !== px || y !== py) {
          const v = ((x + O) * HH + (y + O)) >>> 0, w = ((px + O) * HH + (py + O)) >>> 0, a = v < w ? v : w, b = v < w ? w : v;
          let h = Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b);
          h = ((h ^ (h >>> 15)) >>> 0) % cap;
          while (val[h] >= 0 && (ka[h] !== a || kb[h] !== b)) if (++h === cap) h = 0;
          const o = val[h];
          if (o < 0) { ka[h] = a; kb[h] = b; val[h] = c; }
          else if (o !== c) fn(c, o, px, py, x, y, k === s ? e - 2 : k - 2, k);
        }
        px = x; py = y;
      }
    });
  }
  // 이웃한 땅: 변(꼭짓점 두 개)을 함께 쓰는 칸끼리 이웃이다.
  // 서버와 브라우저가 같은 정수 좌표로 계산하므로 결과가 항상 같다. (지도 파일에 이웃 목록을 안 넣어도 된다)
  function neighborsFromRings(cellRings, dims) {
    const nb = cellRings.map(() => []);
    sharedEdges(cellRings.length, (c, visit) => { for (const r of cellRings[c]) visit(r, 0, r.length); }, (c, o) => { if (!nb[c].includes(o)) { nb[c].push(o); nb[o].push(c); } }, dims);
    return nb;
  }

  // ---------- 게임 규칙 (서버와 브라우저가 똑같이 쓴다) ----------
  const BASE_COST = 2, FAR_GRADE = 4, FAR_COST = 50, NK_MIN = 200; // 북한 땅은 우리 땅이 200칸 이상이어야
  // 갇힌 학교의 탈출길: 우리 땅 둘레에 빈 땅이 하나도 없으면 가장 가까운 빈 땅으로 빠져나갈 수 있다
  const nbFn = nb => (typeof nb === 'function' ? nb : i => nb[i]); // 이웃 목록: 배열 또는 함수
  function escapeCells(owner, nb, sid, mine) { // mine: 우리 칸 목록 (없으면 모두 찾아본다)
    nb = nbFn(nb);
    const n = owner.length;
    let cur = mine ? mine.slice() : [];
    if (!mine) for (let i = 0; i < n; i++) if (owner[i] === sid) cur.push(i);
    if (!cur.length) return [];
    for (const i of cur) for (const k of nb(i)) if (owner[k] < 0) return []; // 빈 땅이 닿아 있으면 탈출길이 필요 없다
    const seen = new Uint8Array(n);
    for (const i of cur) seen[i] = 1;
    while (cur.length) {
      const next = [], found = [];
      for (const i of cur) for (const k of nb(i)) if (!seen[k]) { seen[k] = 1; (owner[k] < 0 ? found : next).push(k); }
      if (found.length) return found;
      cur = next;
    }
    return [];
  }
  // 땅을 뺏는 데 필요한 문제 수. 닿은 땅 = 2(또는 방어 수), 탈출길 = 2, 4학년부터 멀리 있는 땅 = 50(또는 방어 수)
  function captureCost(o) { // { owner, def, nb, sid, cell, grade, escape(Set, 없으면 계산) }
    const { owner, def, sid, cell, grade } = o, nb = nbFn(o.nb), prev = owner[cell], d = prev < 0 ? 0 : def[cell];
    if (o.nk && o.nk(cell)) { // o.nk: 북한 칸인지, o.size: 우리 학교 땅 칸 수 (수 또는 함수)
      const size = typeof o.size === 'function' ? o.size() : o.size || 0;
      if (size < NK_MIN) return { error: `북한 땅은 우리 학교 땅이 ${NK_MIN}칸 이상이어야 뺏을 수 있어요. (지금 ${size}칸)`, nk: true };
    }
    if (nb(cell).some(k => owner[k] === sid)) return { cost: Math.max(BASE_COST, d) };
    const esc = o.escape || new Set(escapeCells(owner, nb, sid));
    if (esc.has(cell)) return { cost: BASE_COST, escape: true };
    if (grade >= FAR_GRADE) return { cost: Math.max(FAR_COST, d), far: true };
    return { error: '우리 학교 땅과 닿아 있는 땅만 뺏을 수 있어요. (4학년부터는 멀리 있는 땅도 문제 50개로 뺏을 수 있어요)' };
  }
  // 땅 팔기: 고른 칸에서 이어진 우리 땅(본부 빼고)을 count 칸까지 모은다
  function saleCells(owner, nb, homeCell, sid, start, count) {
    nb = nbFn(nb);
    const out = [start], seen = new Set(out);
    for (let k = 0; k < out.length && out.length < count; k++) {
      for (const j of nb(out[k])) if (!seen.has(j) && owner[j] === sid && homeCell[j] < 0) { seen.add(j); out.push(j); if (out.length >= count) break; }
    }
    return out;
  }
  const touches = (cells, owner, nb, sid) => { nb = nbFn(nb); return cells.some(c => nb(c).some(k => owner[k] === sid)); };
  // 운영자·개발자 이름은 다른 사람이 못 쓴다
  const RESERVED_NICK = /운영|관리자|개발|어드민|admin|develop|^gm$|staff|매니저|manager/i;
  const ROLE_NICK = { admin: '운영자', dev: '개발자' };
  const MARK = { dev: '♛', admin: '✦' }; // 이름 오른쪽에 붙는 표시 (그림 문자가 아닌 특수문자)

  // ---------- 코인 · 상점 ----------
  const DUEL_BONUS = 5; // 1:1 결투에서 이기면 코인 보너스
  const SHOP = [
    { id: 'shield', icon: '🛡️', name: '방패', price: 40, desc: '우리 땅 1칸을 24시간 동안 아무도 못 뺏어요.' },
    { id: 'bomb', icon: '💣', name: '폭탄', price: 60, desc: '뺏을 수 있는 땅과 그 옆 땅 2칸까지, 문제 없이 한 번에 3칸!' },
    { id: 'scope', icon: '🔭', name: '망원경', price: 25, desc: '10분 동안 우리 땅 둘레에서 가장 약한 땅을 반짝반짝 알려 주고, 멀리서도 방어 수가 보여요.' },
    { id: 'flag', icon: '🚩', name: '학교 깃발 꾸미기', price: 50, desc: '우리 학교 땅 색깔과 마크를 바꿔요. (다른 학교 친구들에게 보여요)' },
  ];
  const SHIELD_HOURS = 24, SCOPE_MIN = 10, BOMB_EXTRA = 2, BOMB_MAX_DEF = 10;
  const FLAG_COLORS = ['#ef4444', '#f97316', '#d97706', '#84cc16', '#16a34a', '#14b8a6', '#0891b2', '#2563eb', '#4f46e5', '#9333ea', '#db2777', '#57534e'];
  const FLAG_MARKS = ['★', '◆', '▲', '●', '♪', '☾', '✿', '■', '✚', '✱', '✪', '❀', '✸', '♡'];
  const attendCoins = streak => 10 + 5 * Math.min(6, Math.max(0, streak - 1)); // 출석: 10코인, 연속이면 하루에 5씩 더 (최대 40)

  // ---------- 오늘의 미션 ----------
  const MISSIONS = [
    { id: 'solve', icon: '✏️', key: 'solved', n: [10, 20, 30], coin: 20, text: n => `문제 ${n}개 풀기` },
    { id: 'cap', icon: '🚩', key: 'captures', n: [3, 5, 8], coin: 25, text: n => `땅 ${n}칸 차지하기` },
    { id: 'steal', icon: '⚔️', key: 'steals', n: [1, 2], coin: 30, text: n => `다른 학교 땅 ${n}칸 뺏기` },
    { id: 'def', icon: '🛡️', key: 'defends', n: [5, 10], coin: 20, text: n => `방어 ${n} 올리기` },
    { id: 'streak', icon: '🔥', key: 'streak', n: [5, 8], coin: 25, max: true, text: n => `${n}문제 연속으로 맞히기` },
    { id: 'speed', icon: '⏱️', key: 'speed', n: [8, 12], coin: 30, max: true, text: n => `스피드 퀴즈에서 ${n}문제 이상 맞히기` },
    { id: 'item', icon: '🛒', key: 'items', n: [1], coin: 20, text: () => '상점 아이템 1번 쓰기' },
  ];
  const MISSION_ALL = 30; // 세 개를 모두 끝내면 보너스
  function dailyMissions(day, seed) { // 날짜·계정마다 다른 미션 3개 (같은 날에는 늘 같다)
    let h = 2166136261;
    for (const ch of day + '|' + seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const pool = MISSIONS.slice(), out = [];
    while (out.length < 3) { const m = pool.splice(Math.floor(rnd() * pool.length), 1)[0]; out.push({ id: m.id, n: m.n[Math.floor(rnd() * m.n.length)] }); }
    return out;
  }

  const priceOf = item => { const it = SHOP.find(x => x.id === item); return it ? it.price : Infinity; };
  // 1:1 결투: 땅 주인 학교가 문제 하나를 푸는 데 걸리는 시간(초). 학년이 높고 방어가 높을수록 빠르다
  const duelPace = (grade, def) => Math.max(4.5, 8.5 - grade * 0.35 - Math.min(def || 0, 20) * 0.05);

  return { PROJ, project, unproject, schoolYear, gradeFromBirthYear, BADGES, CHAT, decodeRing, sharedEdges, neighborsFromRings,
    BASE_COST, FAR_GRADE, FAR_COST, NK_MIN, escapeCells, captureCost, saleCells, touches, RESERVED_NICK, ROLE_NICK, MARK,
    SHOP, SHIELD_HOURS, SCOPE_MIN, BOMB_EXTRA, BOMB_MAX_DEF, FLAG_COLORS, FLAG_MARKS, attendCoins, MISSIONS, MISSION_ALL, dailyMissions,
    priceOf, duelPace, DUEL_BONUS, cleanChat };
});
