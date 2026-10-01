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

  // 지도 칸 모양: [x0, y0, dx1, dy1, …] 로 줄여 둔 꼭짓점을 원래 좌표로
  function decodeRing(arr) {
    const out = new Int32Array(arr.length);
    let x = 0, y = 0;
    for (let k = 0; k < arr.length; k += 2) { x += arr[k]; y += arr[k + 1]; out[k] = x; out[k + 1] = y; }
    return out;
  }
  // 이웃한 땅: 변(꼭짓점 두 개)을 함께 쓰는 칸끼리 이웃이다.
  // 서버와 브라우저가 같은 정수 좌표로 계산하므로 결과가 항상 같다. (지도 파일에 이웃 목록을 안 넣어도 된다)
  function neighborsFromRings(cellRings) {
    const vid = new Map(), edges = new Map(), nb = cellRings.map(() => []);
    let nv = 0;
    const id = (x, y) => { const k = (x + 65536) * 262144 + (y + 65536); let v = vid.get(k); if (v === undefined) { v = nv++; vid.set(k, v); } return v; };
    cellRings.forEach((rings, c) => {
      for (const r of rings) {
        const L = r.length >> 1;
        if (L < 2) continue;
        let prev = id(r[2 * L - 2], r[2 * L - 1]);
        for (let k = 0; k < L; k++) {
          const v = id(r[2 * k], r[2 * k + 1]);
          if (v !== prev) {
            const key = v < prev ? v * 4194304 + prev : prev * 4194304 + v, o = edges.get(key);
            if (o === undefined) edges.set(key, c);
            else if (o !== c && !nb[c].includes(o)) { nb[c].push(o); nb[o].push(c); }
          }
          prev = v;
        }
      }
    });
    return nb;
  }

  return { PROJ, project, unproject, schoolYear, gradeFromBirthYear, BADGES, CHAT, decodeRing, neighborsFromRings };
});
