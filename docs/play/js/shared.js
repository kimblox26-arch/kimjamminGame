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
  // 학교급: 초등(1~6학년, 학년마다 서버) · 중학교(7~9 → 서버 하나) · 고등학교(10~12 → 서버 하나)
  const MAX_GRADE = 12;
  const levelOf = g => (g >= 10 ? 'h' : g >= 7 ? 'm' : 'e');
  const serverOf = g => (g >= 10 ? 10 : g >= 7 ? 7 : g);
  const gradeName = g => (g >= 10 ? `고${g - 9}` : g >= 7 ? `중${g - 6}` : `${g}학년`);
  const serverName = g => (g >= 10 ? '고등학교 서버' : g >= 7 ? '중학교 서버' : `${g}학년 서버`);
  const LEVEL_NAME = { e: '초등학교', m: '중학교', h: '고등학교' };
  const SERVERS = [1, 2, 3, 4, 5, 6, 7, 10];

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
    const O = dims ? 2 : 4096, HH = dims ? dims.H + 5 : 65536;
    const big = dims && (dims.W + 5) * HH >= 4294967296, K = big ? Float64Array : Uint32Array; // 일본까지 넣은 큰 지도: 꼭짓점 열쇠가 32비트를 넘는다
    const ka = new K(cap), kb = new K(cap), val = new Int32Array(cap).fill(-1);
    for (let c = 0; c < n; c++) ring(c, (r, s, e) => {
      if (e - s < 4) return;
      let px = r[e - 2], py = r[e - 1];
      for (let k = s; k < e; k += 2) {
        const x = r[k], y = r[k + 1];
        if (x !== px || y !== py) {
          const v = (x + O) * HH + (y + O), w = (px + O) * HH + (py + O), a = v < w ? v : w, b = v < w ? w : v;
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
  const FAR_COST_MH = 20, JP_MIN = 300; // 중학생부터 멀리 있는 땅은 문제 20개, 일본 땅은 우리 땅이 300칸 이상이어야 (고등학교)
  const farCost = grade => (grade >= 7 ? FAR_COST_MH : FAR_COST);
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
    if (o.jp && o.jp(cell)) { // 일본 땅 (고등학교): 붙어 있으면 그냥, 처음에는 배를 타고 바닷가에 내린다
      const size = typeof o.size === 'function' ? o.size() : o.size || 0;
      if (size < JP_MIN) return { error: `일본 땅은 우리 학교 땅이 ${JP_MIN}칸 이상이어야 뺏을 수 있어요. (지금 ${size}칸)`, jp: true };
      if (nb(cell).some(k => owner[k] === sid)) return { cost: Math.max(BASE_COST, d) };
      const sh = o.ship || {};
      if (!sh.coast) return { error: '🌊 일본에는 배를 타고 가요. 바다에 닿은 일본 땅을 골라 주세요.', jp: true };
      if (!sh.port) return { error: '⚓ 우리 학교 땅 중에 바다에 닿은 땅(항구)이 있어야 배를 띄울 수 있어요.', jp: true };
      if (!sh.have) return { error: `⛵ 배가 있어야 일본으로 건너갈 수 있어요. 🛒 상점에서 배를 사 주세요. (${priceOf('ship')}코인)`, jp: true, needShip: true };
      return { cost: Math.max(BASE_COST, d), ship: true };
    }
    if (nb(cell).some(k => owner[k] === sid)) return { cost: Math.max(BASE_COST, d) };
    const esc = o.escape || new Set(escapeCells(owner, nb, sid));
    if (esc.has(cell)) return { cost: BASE_COST, escape: true };
    if (grade >= FAR_GRADE) return { cost: Math.max(farCost(grade), d), far: true };
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
    { id: 'war', icon: '⚔️', name: '전쟁 선포권', price: 30, lv: 'mh', desc: '게임에 있는 다른 학교 친구에게 전쟁을 걸어요. 상대가 수락하면 30분 동안 전쟁! (중·고등학교)' },
    { id: 'ship', icon: '⛵', name: '배', price: 20, lv: 'h', desc: '우리 학교 바닷가 땅에서 일본 바닷가 땅으로 건너가 뺏어요. 한 번 건너면 없어져요. (고등학교)' },
  ];
  const shopFor = lv => SHOP.filter(it => !it.lv || it.lv.includes(lv));

  // ---------- 전쟁 · 동맹 (중·고등학교) ----------
  const WAR_MIN = 30, WAR_ASK_SEC = 120, WAR_WIN = 40; // 전쟁 30분, 신청은 2분 안에 수락, 이긴 편에서 땅을 뺏은 사람은 40코인
  const warLive = (w, now) => w.st === 'on' && now < w.end;
  const warSide = (w, key) => (key === w.a ? 'a' : key === w.b ? 'b' : (w.al && w.al[key]) || null); // 학교 키 → 'a' / 'b' / null
  // 전쟁 중인 학교 땅은 상대편만 뺏을 수 있고, 동맹 학교 땅은 아무도 못 뺏는다 (뺏을 수 있으면 null)
  function warRule(wars, now, atkKey, defKey) {
    for (const w of wars || []) {
      if (!warLive(w, now)) continue;
      const ds = warSide(w, defKey);
      if (!ds) continue;
      if (defKey !== w.a && defKey !== w.b) return { error: '🤝 전쟁을 돕는 동맹 학교의 땅은 전쟁이 끝날 때까지 아무도 못 뺏어요.' };
      const as = warSide(w, atkKey);
      if (!as || as === ds) return { error: '⚔️ 전쟁 중인 학교의 땅은 상대편만 뺏을 수 있어요.' };
    }
    return null;
  }
  const VOTE_BAN = 20, VOTE_BAN_HOURS = 24, VOTE_DAYS = 7;
  const UNION_PRICE = 50, UNION_MAX = 5; // 🛡️ 연합 만들기 50코인, 학교 5곳까지

  // ---------- 🎁 보물 상자 · 🏗️ 건물 ----------
  const TREASURE_N = 15; // 서버마다 하루에 15개 (학교 근처에)
  const TREASURE_REWARDS = [['c20', 30], ['c30', 25], ['c50', 14], ['c80', 5], ['i:shield', 8], ['i:bomb', 7], ['i:scope', 9], ['i:war', 6, 'mh'], ['i:ship', 6, 'h']]; // [보상, 뽑힐 무게, 학교급]
  const ITEM_NAME = { shield: '🛡️ 방패', bomb: '💣 폭탄', scope: '🔭 망원경', war: '⚔️ 전쟁 선포권', ship: '⛵ 배' };
  const rewardText = r => (r[0] === 'c' ? `🪙 ${r.slice(1)}코인` : ITEM_NAME[r.slice(2)] || '선물');
  const BUILDINGS = [
    { id: 'tower', icon: '🗼', name: '망루', price: 50, desc: '붙어 있는 우리 땅을 뺏으려면 문제가 2개 더 필요해요.' },
    { id: 'wall', icon: '🧱', name: '성벽', price: 40, desc: '이 땅을 뺏으려면 문제가 3개 더 필요하고, 폭탄으로도 못 뺏어요.' },
    { id: 'pole', icon: '🎌', name: '깃대', price: 20, desc: '우리 학교 깃발을 높이 세워요. 멀리서도 잘 보여요.' },
  ];
  const BUILD_MAX = 20; // 한 학교에 건물 20개까지

  // ---------- 👾 보스 레이드: 일주일(월~일, 한국 시간)마다 서버에 보스 하나 ----------
  const BOSSES = [['👾', '숫자 먹는 괴물'], ['🐉', '분수 드래곤'], ['🤖', '계산 로봇'], ['🦑', '방정식 크라켄'], ['👹', '구구단 도깨비'], ['🦖', '도형 공룡'], ['🧟', '오답 좀비'], ['🐙', '소수 문어']];
  const RAID_HP = { e: 200, m: 300, h: 300 }, RAID_WIN = 50, RAID_SET = 10; // 문제 1개 = 데미지 1, 쓰러뜨리면 공격한 사람마다 50코인 + 아이템
  const raidWeek = now => Math.floor(((now || Date.now()) + 9 * 3600e3) / 864e5 + 3) / 7 | 0; // 월요일에 바뀐다
  const raidEnds = week => (week * 7 - 3 + 7) * 864e5 - 9 * 3600e3; // 다음 월요일 0시 (한국 시간)
  // ---------- 🧑‍🎨 내 캐릭터 꾸미기: 캐릭터(av) · 칭호(ti) · 이름 테두리(fr). need: [기록, 수] 이 있어야 살 수 있다 ----------
  const LOOKS = {
    av: [{ id: '😀', price: 0 }, { id: '🐯', price: 30 }, { id: '🐶', price: 30 }, { id: '🐱', price: 30 }, { id: '🦊', price: 30 }, { id: '🐼', price: 30 }, { id: '🐸', price: 30 }, { id: '🐧', price: 30 },
      { id: '🦉', price: 30 }, { id: '🐬', price: 30 }, { id: '🦄', price: 60 }, { id: '🐲', price: 60 }, { id: '🤖', price: 60 }, { id: '👽', price: 60 }, { id: '🦖', price: 60 }, { id: '👑', price: 150 }],
    ti: [{ id: '', price: 0 }, { id: '수학 새싹', price: 20 }, { id: '계산 달인', price: 40 }, { id: '땅의 왕', price: 60, need: ['captures', 50] }, { id: '보물 사냥꾼', price: 50, need: ['treasures', 3] },
      { id: '레이드 용사', price: 50, need: ['raidWins', 1] }, { id: '수학 천재', price: 100, need: ['solved', 500] }, { id: '전설의 학생', price: 200, need: ['solved', 2000] }],
    fr: [{ id: '', price: 0, name: '기본' }, { id: 'gold', price: 50, name: '금빛' }, { id: 'fire', price: 60, name: '불꽃' }, { id: 'ice', price: 60, name: '얼음' }, { id: 'star', price: 70, name: '별빛' }, { id: 'rainbow', price: 100, name: '무지개' }],
  };
  const NEED_NAME = { captures: '땅 차지', treasures: '보물 상자 열기', raidWins: '보스 쓰러뜨리기', solved: '문제 풀기' };
  const bossOf = week => BOSSES[((week % BOSSES.length) + BOSSES.length) % BOSSES.length];
  // 건물 때문에 더 풀어야 하는 문제 수 (builds: 칸 → [종류, 학교]. 주인이 바뀐 칸의 건물은 무너진 것)
  function buildExtra(cell, owner, nb, builds) {
    const o = owner[cell];
    if (o < 0 || !builds) return 0;
    let x = 0;
    const b = builds[cell];
    if (b && b[0] === 'wall' && b[1] === o) x += 3;
    for (const k of nbFn(nb)(cell)) { const t = builds[k]; if (t && t[0] === 'tower' && t[1] === o && owner[k] === o) { x += 2; break; } }
    return x;
  } // 7일 안에 20표가 모이면 하루 동안 정지
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
    MAX_GRADE, levelOf, serverOf, gradeName, serverName, LEVEL_NAME, SERVERS, FAR_COST_MH, JP_MIN, farCost,
    WAR_MIN, WAR_ASK_SEC, WAR_WIN, warLive, warSide, warRule, VOTE_BAN, VOTE_BAN_HOURS, VOTE_DAYS, shopFor,
    TREASURE_N, TREASURE_REWARDS, ITEM_NAME, rewardText, BUILDINGS, BUILD_MAX, buildExtra,
    BOSSES, RAID_HP, RAID_WIN, RAID_SET, raidWeek, raidEnds, bossOf, LOOKS, NEED_NAME, UNION_PRICE, UNION_MAX,
    BASE_COST, FAR_GRADE, FAR_COST, NK_MIN, escapeCells, captureCost, saleCells, touches, RESERVED_NICK, ROLE_NICK, MARK,
    SHOP, SHIELD_HOURS, SCOPE_MIN, BOMB_EXTRA, BOMB_MAX_DEF, FLAG_COLORS, FLAG_MARKS, attendCoins, MISSIONS, MISSION_ALL, dailyMissions,
    priceOf, duelPace, DUEL_BONUS, cleanChat };
});
