/* 매뜨 땅먹 — 인트로 + 로딩 화면
 * 지도를 불러오는 동안: 로고가 하나씩 튀어나오고, 진짜 한반도 모양 위에서 학교들이 육각형 땅을 넓혀 가는 애니메이션,
 * 실제 진행률(%)과 단계, 게임 팁을 보여 준다. 다 불러오면 "시작하기" 버튼을 띄운다.
 * app.js 가 쓰는 것: MLEIntro.setLand(land, W, H), MLEIntro.progress(%, 글), MLEIntro.done() → 누르면 끝나는 Promise */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const cv = $('#introMap'), g = cv.getContext('2d');
  const COLORS = ['#ff6b6b', '#ffb020', '#3ec46d', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#6366f1'];
  const LINES = ['🧮 수학 문제를 풀고', '🗺️ 땅을 차지해서', '🏫 우리 학교를 1등으로!'];
  const TIPS = [
    '💡 분수는 분자/분모로 써요. 10분의 3 → 3/10',
    '🛡️ 땅 방어를 올리면 다른 학교가 뺏기 어려워요',
    '🚀 4학년부터는 멀리 있는 땅도 문제 50개로 뺏을 수 있어요',
    '🗺️ 우리 학교 땅이 200칸을 넘으면 북한 땅도 뺏을 수 있어요',
    '🏷️ 우리 땅을 다른 학교에 팔 수도 있어요',
    '🔥 연속으로 맞히면 불꽃이 붙어요',
    '📒 틀린 문제는 오답 노트에 모여요',
    '📊 랭킹표에서 학교·학생·시도 순위를 볼 수 있어요',
    '🪙 문제 1개를 맞히면 1코인! 상점에서 방패·폭탄·망원경을 사요',
    '🎯 오늘의 미션을 깨면 코인을 받아요',
    '⚔️ 다른 학교 땅은 1:1 수학 결투로 뺏어요',
    '💬 위 💬 버튼으로 친구들과 채팅해요',
    '⏱️ 스피드 퀴즈: 1분 동안 몇 문제나 맞힐까요?',
  ];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, land = null, hexes = [], owner = null, fronts = [], seeds = [], raf = 0, hold = 0, running = true;

  // 캔버스 크기 (화면에 보이는 크기에 맞춰 선명하게)
  function fit() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(160, r.width); H = Math.max(200, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    if (land) buildHexes();
  }

  // 지도 파일의 해안선(줄여 쓴 정수 좌표)을 캔버스 모양으로
  let rings = null, box = null;
  function setLand(enc, mw, mh) {
    rings = enc.map(e => { const o = []; let x = 0, y = 0; for (let k = 0; k < e.length; k += 2) { x += e[k]; y += e[k + 1]; o.push(x, y); } return o; });
    box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of rings) for (let k = 0; k < r.length; k += 2) { box[0] = Math.min(box[0], r[k]); box[1] = Math.min(box[1], r[k + 1]); box[2] = Math.max(box[2], r[k]); box[3] = Math.max(box[3], r[k + 1]); }
    land = true;
    buildHexes();
  }
  let tf = null; // 지도 좌표 → 캔버스 좌표
  function buildHexes() {
    const pad = 8, s = Math.min((W - 2 * pad) / (box[2] - box[0]), (H - 2 * pad) / (box[3] - box[1]));
    const ox = (W - (box[2] - box[0]) * s) / 2 - box[0] * s, oy = (H - (box[3] - box[1]) * s) / 2 - box[1] * s;
    tf = { s, ox, oy };
    const path = new Path2D();
    for (const r of rings) { path.moveTo(r[0] * s + ox, r[1] * s + oy); for (let k = 2; k < r.length; k += 2) path.lineTo(r[k] * s + ox, r[k + 1] * s + oy); path.closePath(); }
    land = path;
    // 육각형 칸 (뾰족한 쪽이 위) 중 땅 위에 있는 것만
    const R = Math.max(3.2, Math.min(W, H) / 70), dx = Math.sqrt(3) * R, dy = 1.5 * R;
    hexes = []; const at = new Map();
    g.setTransform(dpr, 0, 0, dpr, 0, 0); // isPointInPath 는 지금 변환을 따른다
    for (let row = 0, y = R; y < H; row++, y += dy) for (let col = 0, x = (row % 2 ? dx / 2 : 0) + dx / 2; x < W; col++, x += dx) {
      if (g.isPointInPath(path, x * dpr, y * dpr)) { at.set(row + ',' + col, hexes.length); hexes.push({ x, y, row, col, nb: [] }); }
    }
    const odd = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]], even = [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    for (const h of hexes) for (const [r, c] of (h.row % 2 ? odd : even)) { const j = at.get((h.row + r) + ',' + (h.col + c)); if (j !== undefined) h.nb.push(j); }
    hexR = R;
    reset();
  }
  let hexR = 4;
  function reset() { // 학교 몇 곳이 처음 칸에서 시작
    owner = new Int8Array(hexes.length).fill(-1);
    fronts = []; seeds = [];
    const k = Math.min(COLORS.length, 7 + Math.floor(Math.random() * 3));
    for (let i = 0; i < k && hexes.length; i++) {
      const h = Math.floor(Math.random() * hexes.length);
      if (owner[h] >= 0) continue;
      owner[h] = i; seeds.push(h); fronts.push([h]);
    }
    hold = 0;
  }
  // 학교마다 닿아 있는 빈 칸을 하나씩 차지 (게임처럼)
  function step() {
    let any = false;
    fronts.forEach((f, s) => {
      for (let t = 0; t < 2; t++) {
        for (let tries = 0; tries < 6 && f.length; tries++) {
          const i = Math.floor(Math.random() * f.length), free = hexes[f[i]].nb.filter(j => owner[j] < 0);
          if (!free.length) { f.splice(i, 1); continue; }
          const j = free[Math.floor(Math.random() * free.length)];
          owner[j] = s; f.push(j); any = true;
          break;
        }
      }
    });
    return any;
  }
  function hexPath(x, y, r) {
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
    g.closePath();
  }
  function draw(t) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!land) { // 지도 받기 전: 빛나는 점
      const a = (Math.sin(t / 300) + 1) / 2;
      g.fillStyle = `rgba(255,255,255,${0.4 + a * 0.4})`; g.beginPath(); g.arc(W / 2, H / 2, 10 + a * 8, 0, 7); g.fill();
      return;
    }
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fill(land); // 바닷가 물빛
    g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.35)'; g.stroke(land);
    g.fillStyle = '#d7dce3'; g.fill(land);
    for (let i = 0; i < hexes.length; i++) {
      const h = hexes[i], o = owner[i];
      hexPath(h.x, h.y, hexR * 0.96);
      g.fillStyle = o >= 0 ? COLORS[o] : '#cfd5dd'; g.fill();
      g.lineWidth = 0.8; g.strokeStyle = 'rgba(255,255,255,.85)'; g.stroke();
    }
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(30,80,120,.45)'; g.stroke(land);
    const pulse = (t % 1200) / 1200;
    seeds.forEach((h, s) => { // 학교 본부
      const p = hexes[h];
      g.beginPath(); g.arc(p.x, p.y, hexR * (1.2 + pulse * 1.6), 0, 7); g.strokeStyle = `rgba(255,255,255,${1 - pulse})`; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.arc(p.x, p.y, hexR * 0.9, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = COLORS[s]; g.stroke();
    });
  }
  let last = 0;
  function loop(t) {
    if (!running) return;
    if (land && t - last > (reduce ? 400 : 70)) {
      last = t;
      if (!step()) { if (++hold > 25) reset(); } // 다 차면 잠깐 보여 주고 다시
    }
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  // 글: 소개 세 줄 → 팁
  let li = 0, ti = Math.floor(Math.random() * TIPS.length), textTimer = 0;
  function nextText() {
    const line = $('#introLine'), tip = $('#introTip');
    if (li < LINES.length) { line.textContent = LINES[li++]; line.classList.remove('show'); void line.offsetWidth; line.classList.add('show'); textTimer = setTimeout(nextText, 1500); return; }
    tip.textContent = TIPS[ti++ % TIPS.length]; tip.classList.remove('show'); void tip.offsetWidth; tip.classList.add('show');
    textTimer = setTimeout(nextText, 3200);
  }

  function progress(p, msg) {
    p = Math.max(0, Math.min(100, Math.round(p)));
    $('#loadBar').style.width = p + '%';
    $('#loadPct').textContent = p + '%';
    if (msg) $('#loadMsg').textContent = msg;
  }
  // 다 불러왔으면 시작 버튼 (누르면 끝)
  function done() {
    progress(100, '준비 완료!');
    const btn = $('#introStart');
    $('#introProgress').hidden = true;
    btn.hidden = false;
    btn.focus();
    return new Promise(res => {
      const go = () => { running = false; cancelAnimationFrame(raf); clearTimeout(textTimer); window.removeEventListener('keydown', key); res(); };
      const key = e => { if (e.key === 'Enter' || e.key === ' ') go(); };
      btn.onclick = go;
      window.addEventListener('keydown', key);
    });
  }

  window.addEventListener('resize', fit);
  fit();
  raf = requestAnimationFrame(loop);
  nextText();
  window.MLEIntro = { setLand, progress, done };
})();
