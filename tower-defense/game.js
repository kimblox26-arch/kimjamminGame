'use strict';
// 가족 타워 디펜스
//  - 전장: 농부(적)가 맵 오른쪽 아래에서 끊임없이 나와 흙길을 돈다. 가족이 던져서 잡으면 5원.
//  - 타워: 집을 끌어다 원하는 곳에 놓으면 엄마·아빠가 걸어 나와 만세. 대출이자도 갚을 수 있다.
//  - 플레이어가 다른 창에 다녀오면 엄마는 담배, 아빠는 누워 쉬다가 들켜서 화들짝 → 다시 공격.
//  - 로직은 1/60초 고정 스텝, 화면은 보간 렌더링.

const MAP_W = 688, MAP_H = 1529;       // 두 맵 이미지 크기 = 월드 좌표계
const STEP = 1 / 60;

const ENEMY_H = 128;                   // 적 키(맵 픽셀)
const ENEMY_FRAME_RATE = 2.2;          // 초당 걷기 사진 전환 수
const FAMILY_H = 122;                  // 전장 가족 키(서 있을 때)
const RESIDENT_H = 400;                // 타워 화면 엄마·아빠 키
const STD_H = 420;                     // 포즈 사진의 '서 있는 키' 픽셀 (tools/extract_poses.py)
const OLD_STD = new Set(['dad_back_0', 'dad_back_1', 'dad_turn', 'mom_back_0', 'mom_back_1', 'mom_turn']);
const REWARD = 5;                      // 적 1명당 보상(원)
const START_MONEY = 10;
const LOAN_INTEREST = 1000;            // 대출이자
const familyCost = n => 10 + n * 5;    // n = 이미 생성한 가족 수
const MAX_ENEMIES = 26;

// 흙길 중앙선 꼭짓점 (map.png 픽셀 분석값). 오른쪽 아래에서 출발해 시계 방향.
const PATH_CORNERS = [[566, 1094], [90, 1094], [90, 414], [566, 414]];
const CORNER_R = 52;

// 전장 가족 배치 자리(발 위치). 안쪽 잔디밭 가장자리 — 어느 자리든 사거리 안에 길이 들어온다.
const FAMILY_SLOTS = [[475, 1020], [185, 560], [185, 1020], [475, 560], [330, 1020], [330, 560], [185, 790], [475, 790]];
const FAMILY_ENTRY_Y = 1235;           // 가족이 걸어 들어오기 시작하는 곳(길 아래 숲)

const FAMILY_STATS = {
  mom: { dmg: 20, cooldown: 0.95, range: 210, proj: 'slipper' },
  dad: { dmg: 32, cooldown: 1.35, range: 230, proj: 'remote' },
};

// 화면에 꼭 보여야 하는 영역(맵 좌표) — 화면비가 달라도 이 영역은 잘리지 않는다.
const NEED = {
  battle: { x0: 30, x1: 658, y0: 200, y1: 1480 },
  tower: { x0: 40, x1: 648, y0: 240, y1: 1480 },
};
// 버튼 자리(맵 좌표). 가족 생성 = 사용자가 네모로 그린 곳, 그 아래 이동 버튼.
const SLOT_SQ = { x0: 215, x1: 470, y0: 1205, y1: 1397 };
const SLOT_WIDE = { x0: 190, x1: 495, y0: 1412, y1: 1478 };

// 타워 화면
const HOUSE_W = 400;
const RESIDENT_REL = { dad: [-108, 112], mom: [118, 112] };   // 집 기준 엄마·아빠 자리
const HOUSE_LABEL = 'Lv.1 대출이 반인 집';
const FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

// ───────────────── 유틸 ─────────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {   // 구형 브라우저 대비
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
function easeOutBounce(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = arr => arr[Math.floor(rand() * arr.length)];

// ───────────────── 도트 아이콘 (이모지 대신 직접 그린 그림) ─────────────────
const PIXEL_ICONS = {
  coin: {
    pal: { k: '#5a3300', y: '#ffcf2e', o: '#e08a12', w: '#fff4b0', d: '#d98b0c' },
    rows: ['...kkkkkk...', '..kyyyyyyk..', '.kyywwyyyyk.', 'kyywyyddyyok', 'kywyyydwyyok', 'kywyyydwyyok',
           'kyyyyydwyyok', 'kyyyyydwyyok', 'kyyyyyddyyok', '.kyyyyyyyok.', '..koooooook.', '...kkkkkk...'],
  },
  house: {
    pal: { k: '#3a2410', r: '#d9472b', g: '#a3a3a3', c: '#f3e6c4', b: '#5fb4e8', d: '#8a5a2b' },
    rows: ['.....kk.kkk.', '....krrkkgk.', '...krrrrkgk.', '..krrrrrrkk.', '.krrrrrrrrk.',
           'krrrrrrrrrrk', 'kkkkkkkkkkkk', '.kcccccccck.', '.kbbcddcbbk.', '.kbbcddcbbk.',
           '.kcccddccck.', '.kkkkkkkkkk.'],
  },
  family: {
    pal: { k: '#2b1d0e', h: '#1b1b1b', c: '#3a2a22', s: '#e8ad7f', e: '#2b1d0e', m: '#c0504d', t: '#74777c', p: '#efc6dc' },
    rows: ['..kkkk...k.kk.k.', '.khhhhk.kckcckck', 'khhhhhhkkcccccck', 'khsssshkkcssssck',
           'ksessesk' + 'ksessesk', 'kssssssk' + 'kssssssk', 'kssmmssk' + 'kssmmssk',
           '.kssssk.' + '.kssssk.', '..kttk..' + '..kppk..', '.kttttk.' + '.kppppk.'],
  },
  sword: {
    pal: { k: '#2b1d0e', w: '#ffffff', l: '#b8c4cc', b: '#8a5a2b' },
    rows: ['..........kk', '.........kwk', '........kwlk', '.......kwlk.', '......kwlk..',
           '..k..kwlk...', '..kkkwlk....', '...kklk.....', '...kbkk.....', '..kbk.kk....',
           '.kbk........', '.kk.........'],
  },
  lock: {
    pal: { k: '#2b1d0e', y: '#ffd84a', o: '#d08a18' },
    rows: ['..kkkk..', '.kk..kk.', '.k....k.', '.k....k.', 'kkkkkkkk',
           'kyyyyyyk', 'kyyykyyk', 'kyyykyyk', 'kooooook', 'kkkkkkkk'],
  },
  hand: {
    pal: { k: '#2b1d0e', w: '#ffffff' },
    rows: ['....kk......', '...kwwk.....', '...kwwk.....', '...kwwkkk...', '...kwwkwwkk.', '.kkkwwkwwkwk',
           'kwwkwwwwwkwk', 'kwwwwwwwwwwk', '.kwwwwwwwwwk', '..kwwwwwwwk.', '...kwwwwwk..', '...kkkkkkk..'],
  },
};

function pixelSVG(name) {
  const { pal, rows } = PIXEL_ICONS[name];
  const w = rows[0].length, h = rows.length;
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${rects}</svg>`;
}

function drawPixelIcon(ctx, name, cx, cy, size) {
  const { pal, rows } = PIXEL_ICONS[name];
  const px = size / rows.length;
  const ox = cx - rows[0].length * px / 2, oy = cy - size / 2;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * px, oy + y * px, px + 0.5, px + 0.5);
    }
  });
}

// 테두리 있는 글씨 (노란 글씨 + 진한 테두리 + 아래 입체 그림자)
function outlinedText(ctx, text, x, y, size, fill, stroke, opts = {}) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (opts.shadow) {
    ctx.fillStyle = opts.shadow;
    ctx.strokeStyle = opts.shadow;
    ctx.lineWidth = size * 0.28;
    ctx.strokeText(text, x, y + size * 0.1);
    ctx.fillText(text, x, y + size * 0.1);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = size * 0.24;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// ───────────────── 에셋 ─────────────────
const IMG = {};
const IMAGE_LIST = {
  map: 'assets/map.png',
  towerMap: 'assets/tower_map.png',
  house: 'assets/house.png',
};
for (const n of ['side_0', 'side_1', 'back_0', 'back_1', 'front_0', 'front_1']) IMAGE_LIST['farmer_' + n] = `assets/characters/farmer/${n}.png`;
const FAMILY_SPRITES = [
  'dad_back_0', 'dad_back_1', 'dad_turn', 'dad_cheer', 'dad_front_0', 'dad_front_1', 'dad_wave', 'dad_lunge', 'dad_rest',
  'dad_walk_0', 'dad_walk_1', 'dad_walk_2', 'dad_walk_3',
  'mom_back_0', 'mom_back_1', 'mom_turn', 'mom_cheer', 'mom_front_0', 'mom_front_1', 'mom_hip', 'mom_hips', 'mom_smoke', 'mom_surprised',
];
for (const n of FAMILY_SPRITES) IMAGE_LIST[n] = `assets/characters/family/${n}.png`;

function loadAssets() {
  return Promise.all(Object.entries(IMAGE_LIST).map(([k, src]) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => { IMG[k] = img; ok(); };
    img.onerror = () => fail(src);
    img.src = src;
  })));
}

// 사진 1장의 '서 있는 키' 픽셀. 누운 아빠처럼 키보다 작은 사진도 같은 사람 크기로 그려진다.
const stdOf = key => (key.startsWith('farmer_') || OLD_STD.has(key) ? IMG[key].height : STD_H);

// ───────────────── 경로 (모서리를 둥글게 → 부드러운 이동) ─────────────────
const PATH = (() => {
  const n = PATH_CORNERS.length;
  const corner = i => {
    const c = PATH_CORNERS[i], p = PATH_CORNERS[(i + n - 1) % n], q = PATH_CORNERS[(i + 1) % n];
    const toward = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [a[0] + (b[0] - a[0]) / l * CORNER_R, a[1] + (b[1] - a[1]) / l * CORNER_R]; };
    return { a: toward(c, p), c, b: toward(c, q) };
  };
  const bez = (k, t) => {
    const u = 1 - t;
    return [u * u * k.a[0] + 2 * u * t * k.c[0] + t * t * k.b[0], u * u * k.a[1] + 2 * u * t * k.c[1] + t * t * k.b[1]];
  };
  const pts = [];
  const SEG = 16;
  const k0 = corner(0);
  for (let s = SEG / 2; s <= SEG; s++) pts.push(bez(k0, s / SEG));         // 출발: 오른쪽 아래 모서리 가운데
  for (let i = 1; i < n; i++) { const k = corner(i); for (let s = 0; s <= SEG; s++) pts.push(bez(k, s / SEG)); }
  for (let s = 0; s <= SEG / 2; s++) pts.push(bez(k0, s / SEG));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
})();

function pointAt(dist) {
  const d = ((dist % PATH.len) + PATH.len) % PATH.len;
  let lo = 0, hi = PATH.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PATH.cum[m] <= d) lo = m; else hi = m; }
  const [x0, y0] = PATH.pts[lo], [x1, y1] = PATH.pts[hi];
  const segLen = PATH.cum[hi] - PATH.cum[lo] || 1;
  const t = (d - PATH.cum[lo]) / segLen;
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, dx: (x1 - x0) / segLen, dy: (y1 - y0) / segLen };
}

// ───────────────── 상태 ─────────────────
const state = {
  scene: 'battle',
  money: START_MONEY,
  shownMoney: START_MONEY,   // 화면에 보이는 돈(부드럽게 따라감)
  houseBuilt: false,
  houseT: 0,                 // 집 지은 뒤 경과 시간(타워 화면에서만 흐름)
  familyCount: 0,
  time: 0,
  battleTime: 0,             // 적 난이도용 경과 시간
  away: false,               // 플레이어가 다른 창에 가 있음
  loanPaid: 0,
};
const house = { cx: 344, bottom: 985, tx: 344, tb: 985, lift: 0, landT: 9, tilt: 0 };
const ghost = { cx: 344, bottom: 985, tx: 344, tb: 985, lift: 0, tilt: 0 };   // 짓기 전 끌어다 놓는 집
const enemies = [];
const family = [];
const projectiles = [];
const particles = [];       // { scene, x, y, vx, vy, g, life, max, size, color, rot, vr, shape }
const floaters = [];        // "+5원"
const effects = [];         // 휘두르기·타격 소용돌이
const spawner = { timer: 2.2 };
let shake = 0;
let nextId = 1;
let loanFx = { shake: 0, flash: 0, press: 0 };

// ───────────────── 사진(스프라이트) 전환 ─────────────────
// blend = 0 이면 즉시 교체(걷기 프레임), 0보다 크면 그 시간 동안 크로스페이드(자세 바꾸기)
function makeSprite(key, flip = false) { return { cur: { key, flip }, prev: null, fade: 1, dur: 1 }; }
function setSprite(sp, key, flip = false, blend = 0) {
  if (sp.cur.key === key && sp.cur.flip === flip) return;
  const next = { key, flip };
  if (blend <= 0) { sp.cur = next; return; }
  if (!(sp.prev && sp.fade < 0.5)) sp.prev = sp.cur;
  sp.cur = next; sp.fade = 0; sp.dur = blend;
}
function tickSprite(sp, dt) { if (sp.fade < 1) sp.fade = Math.min(1, sp.fade + dt / sp.dur); }
function spriteSize(key, personH) {
  const img = IMG[key];
  const h = personH * img.height / stdOf(key);
  return { w: img.width * h / img.height, h };
}
function drawSpriteLayers(ctx, sp, personH, alpha, flash = 0) {
  // 새 사진을 불투명하게 깔고 이전 사진을 그 위에서 서서히 지운다 → 겹친 부분이 반투명해지지 않음
  const layers = [[sp.cur, 1]];
  if (sp.prev && sp.fade < 1) layers.push([sp.prev, 1 - sp.fade]);
  for (const [l, a] of layers) {
    const img = IMG[l.key];
    const { w, h } = spriteSize(l.key, personH);
    ctx.save();
    ctx.globalAlpha = alpha * a;
    if (l.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    if (flash > 0) {                      // 맞았을 때 하얗게 번쩍
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * a * flash * 0.55;
      ctx.drawImage(img, -w / 2, -h, w, h);
    }
    ctx.restore();
  }
}

// ───────────────── 감정 말풍선 (도트 그림) ─────────────────
function setEmote(o, kind, dur = 1.4) { o.emote = { kind, t: 0, dur }; }
function tickEmote(o, dt) {
  if (!o.emote) return;
  o.emote.t += dt;
  if (o.emote.t >= o.emote.dur) o.emote = null;
}
function bubble(ctx, w = 46, h = 40) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2b1d0e';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h - 10, w, h, 12);
  ctx.moveTo(-7, -11); ctx.lineTo(0, 0); ctx.lineTo(7, -11);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-6, -13, 12, 4);
}
function drawEmote(ctx, em, x, y, s = 1) {
  const t = em.t;
  const pop = t < 0.2 ? easeOutBack(t / 0.2) : 1;
  const fade = em.dur - t < 0.25 ? clamp((em.dur - t) / 0.25, 0, 1) : 1;
  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.translate(x, y - Math.sin(t * 3) * 2);
  ctx.scale(s * pop, s * pop);
  ctx.lineCap = 'round';
  switch (em.kind) {
    case 'alert':                               // 들킴 / 발견: 빨간 느낌표
      bubble(ctx);
      ctx.fillStyle = '#e8302a';
      ctx.fillRect(-4, -42, 8, 17);
      ctx.fillRect(-4, -21, 8, 7);
      break;
    case 'angry': {                             // 화남: 핏줄 표시
      ctx.translate(16, -18);
      ctx.strokeStyle = '#e8302a';
      ctx.lineWidth = 5;
      for (let i = 0; i < 4; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 2);
        ctx.beginPath(); ctx.arc(9, 9, 6, Math.PI, Math.PI * 1.5); ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'sweat': {                             // 진땀: 파란 물방울이 흘러내림
      const k = (t % 0.9) / 0.9;
      ctx.translate(20, -26 + k * 16);
      ctx.fillStyle = '#7fd0ff'; ctx.strokeStyle = '#2b5a8a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.quadraticCurveTo(10, 3, 0, 7); ctx.quadraticCurveTo(-10, 3, 0, -12);
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'zzz':                                 // 쿨쿨
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.7 + i / 3) % 1);
        ctx.save();
        ctx.globalAlpha *= Math.sin(k * Math.PI);
        outlinedText(ctx, 'Z', 8 + k * 26, -10 - k * 46, 22 + i * 4, '#ffffff', '#2b3a6a');
        ctx.restore();
      }
      break;
    case 'note':                                // 신남: 음표
      bubble(ctx);
      ctx.fillStyle = '#2b1d0e';
      ctx.fillRect(2, -44, 4, 20);
      ctx.fillRect(2, -44, 12, 5);
      ctx.beginPath(); ctx.ellipse(-1, -23, 7, 5.5, -0.3, 0, Math.PI * 2); ctx.fill();
      break;
    case 'dots':                                // 심심: 말줄임
      bubble(ctx);
      ctx.fillStyle = '#2b1d0e';
      for (let i = 0; i < 3; i++) if (t * 3 % 3 >= i) ctx.fillRect(-14 + i * 11, -32, 7, 7);
      break;
    case 'heart':                               // 기쁨: 하트
      bubble(ctx);
      ctx.fillStyle = '#ff5a7a';
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.bezierCurveTo(-16, -28, -10, -44, 0, -35);
      ctx.bezierCurveTo(10, -44, 16, -28, 0, -18);
      ctx.fill();
      break;
  }
  ctx.restore();
}

// ───────────────── 적 (농부) ─────────────────
function spawnEnemy() {
  const d = state.battleTime;
  const hp = Math.round(38 * (1 + d / 100) * (0.9 + rand() * 0.2));
  enemies.push({
    id: nextId++, dist: 0, prevDist: 0, hp, maxHp: hp, shownHp: hp, pending: 0,
    speed: (50 + Math.min(16, d * 0.03)) * (0.9 + rand() * 0.2),
    age: 0, phase: rand() * 2, hitT: 0, kb: 0, dead: false, deathT: 0, fallDir: 1,
    pauseT: 0, nextPause: 5 + rand() * 9, emote: null,
    dir: 'side', sprite: makeSprite('farmer_side_0'),
  });
}

function enemyPose(e) {
  const p = pointAt(e.dist);
  const frame = Math.floor(e.phase) % 2;
  if (Math.abs(p.dx) >= Math.abs(p.dy)) return { dir: 'side', key: `farmer_side_${frame}`, flip: p.dx > 0 };
  const dir = p.dy < 0 ? 'back' : 'front';
  return { dir, key: `farmer_${dir}_${frame}`, flip: false };
}

function updateEnemy(e, dt) {
  e.prevDist = e.dist;
  e.age += dt;
  e.hitT = Math.max(0, e.hitT - dt);
  e.shownHp = Math.max(e.hp, e.shownHp - e.maxHp * dt * 0.9);   // 체력바가 부드럽게 줄어듦
  tickEmote(e, dt);
  if (e.dead) { e.deathT += dt; return; }
  if (e.age <= 0.45) return;                         // 등장 연출 후 출발
  let speed = e.speed * Math.min(1, (e.age - 0.45) / 0.6);
  // 가끔 멈춰서 두리번거림
  e.nextPause -= dt;
  if (e.nextPause <= 0 && e.pauseT <= 0) { e.pauseT = 0.6 + rand() * 0.7; e.nextPause = 7 + rand() * 9; }
  if (e.pauseT > 0) { e.pauseT -= dt; speed *= 0.06; }
  // 앞사람과 너무 가까우면 속도를 줄여 줄을 선다
  for (const o of enemies) {
    if (o === e || o.dead) continue;
    const gap = ((o.dist - e.dist) % PATH.len + PATH.len) % PATH.len;
    if (gap > 0.01 && gap < 40) speed *= clamp((gap - 16) / 24, 0, 1);
  }
  if (e.kb > 0) { const k = Math.min(e.kb, 140 * dt); e.dist -= k; e.kb -= k; }   // 맞으면 뒤로 밀림
  e.dist += speed * dt;
  e.phase += dt * ENEMY_FRAME_RATE * (speed / e.speed);
  if (e.hp / e.maxHp < 0.4 && !e.emote && rand() < dt * 0.6) setEmote(e, 'sweat', 1.3);
  const pose = enemyPose(e);
  const look = e.pauseT > 0 && Math.sin(e.pauseT * 9) > 0;   // 두리번
  const flip = pose.dir === 'side' ? pose.flip !== look : look;
  const turned = pose.dir !== e.dir;
  e.dir = pose.dir;
  setSprite(e.sprite, pose.key, flip, turned ? 0.14 : 0);
  tickSprite(e.sprite, dt);
}

function enemyFoot(e, alpha = 1) {
  const p = pointAt(lerp(e.prevDist, e.dist, alpha));
  return { x: p.x, y: p.y + 26 };
}

function killEnemy(e, by) {
  e.dead = true; e.deathT = 0;
  e.fallDir = rand() < 0.5 ? -1 : 1;
  e.emote = null;
  state.money += REWARD;
  const f = enemyFoot(e);
  floaters.push({ x: f.x, y: f.y - ENEMY_H - 20, t: 0, text: `+${REWARD}원` });
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2, sp = 60 + rand() * 120;
    particles.push({ scene: 'battle', x: f.x, y: f.y - 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 60, g: 220,
      life: 0, max: 0.7 + rand() * 0.3, size: 10 + rand() * 8, color: rand() < 0.5 ? 'rgba(230,214,170,0.9)' : 'rgba(200,180,130,0.9)', rot: 0, vr: 0, shape: 'round', grow: 1.2 });
  }
  if (by && rand() < 0.45 && by.state === 'recover') setEmote(by, rand() < 0.5 ? 'note' : 'heart', 1.2);
}

function drawEnemy(ctx, e, alpha) {
  const f = enemyFoot(e, alpha);
  const born = Math.min(e.age / 0.45, 1);
  const pop = born < 1 ? 1 - Math.pow(1 - born, 3) * Math.cos(born * 8) : 1;
  const moving = e.age > 0.45 && !e.dead && e.pauseT <= 0;
  const bob = moving ? Math.abs(Math.sin(e.phase * Math.PI)) * 3 : 0;
  const tilt = moving ? Math.sin(e.phase * Math.PI) * 0.025 : 0;
  const hit = e.hitT / 0.22;
  let a = 1, rot = tilt, sx = 1, sy = 1;
  if (e.dead) {                                     // 쓰러지며 사라짐
    const d = Math.min(e.deathT / 0.6, 1);
    rot = e.fallDir * Math.PI / 2 * easeOut(Math.min(1, d * 1.6));
    a = d < 0.55 ? 1 : 1 - (d - 0.55) / 0.45;
  } else {
    sx = 1 + hit * 0.08; sy = 1 - hit * 0.09;
    rot += -Math.sin(hit * Math.PI) * 0.14;         // 맞으면 뒤로 젖혀짐
  }

  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.fillStyle = `rgba(0,0,0,${0.22 * a})`;
  ctx.beginPath(); ctx.ellipse(0, 0, 26 * pop, 8 * pop, 0, 0, Math.PI * 2); ctx.fill();
  if (born < 1) {
    ctx.strokeStyle = `rgba(255,255,255,${1 - born})`;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(0, 0, 18 + born * 46, 7 + born * 16, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.translate(0, -bob);
  ctx.rotate(rot);
  ctx.scale(sx * pop, sy * pop);
  drawSpriteLayers(ctx, e.sprite, ENEMY_H, a, hit);
  ctx.restore();

  if (!e.dead && born >= 1) {
    drawHpBar(ctx, f.x, f.y - ENEMY_H - 14, e.hp / e.maxHp, e.shownHp / e.maxHp);
    if (e.emote) drawEmote(ctx, e.emote, f.x, f.y - ENEMY_H - 4, 0.9);
  }
}

function drawHpBar(ctx, x, y, ratio, shown) {
  const w = 54, h = 9;
  ctx.fillStyle = '#2b1d0e';
  ctx.beginPath(); ctx.roundRect(x - w / 2 - 3, y - 3, w + 6, h + 6, 4); ctx.fill();
  ctx.fillStyle = '#5a2a1c';
  ctx.fillRect(x - w / 2, y, w, h);
  const r = clamp(ratio, 0, 1), s = clamp(shown, 0, 1);
  if (s > r) { ctx.fillStyle = '#fff3c4'; ctx.fillRect(x - w / 2, y, w * s, h); }   // 깎인 만큼 잠깐 남는 흰 띠
  ctx.fillStyle = r > 0.6 ? '#5fd14a' : r > 0.3 ? '#f2c23a' : '#e8492f';
  ctx.fillRect(x - w / 2, y, w * r, h);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x - w / 2, y, w * r, 3);
}

// ───────────────── 가족 (전장) ─────────────────
// 상태: walk(걸어 들어옴) → arrive → idle ↔ windup → throw → recover
//       플레이어가 자리를 비우면 slack(엄마 담배 / 아빠 누움) → 돌아오면 notice(화들짝) → idle
function spawnFamily() {
  const type = state.familyCount % 2 === 0 ? 'mom' : 'dad';
  const [sx, sy] = FAMILY_SLOTS[family.length];
  family.push({
    type, slotX: sx, slotY: sy, x: sx, y: FAMILY_ENTRY_Y, px: sx, py: FAMILY_ENTRY_Y,
    state: 'walk', t: 0, age: 0, cd: 0.5, walkPhase: 0, lean: 1, special: false, attacks: 0,
    idleAct: null, idleActT: 0, nextAct: 3 + rand() * 4, bored: 0, smokeT: 0, caughtT: 0, target: null,
    emote: null, sprite: makeSprite(type === 'dad' ? 'dad_walk_0' : 'mom_back_0'),
  });
  state.familyCount++;
}

function famSet(f, s) { f.state = s; f.t = 0; }

function findTarget(f) {
  const st = FAMILY_STATS[f.type];
  const ox = f.x, oy = f.y - FAMILY_H * 0.6;
  let best = null;
  for (const e of enemies) {
    if (e.dead || e.age < 0.45 || e.hp - e.pending <= 0) continue;
    const ef = enemyFoot(e);
    if (Math.hypot(ef.x - ox, ef.y - ENEMY_H * 0.5 - oy) > st.range) continue;
    if (!best || e.dist > best.dist) best = e;
  }
  return best;
}

function idleKey(f) {
  if (f.type === 'mom') {
    if (f.idleAct) return f.idleAct;
    return `mom_front_${Math.floor(f.age / 1.7) % 2}`;
  }
  if (f.idleAct) return f.idleAct;
  return Math.floor(f.age / 2.6) % 3 === 2 ? 'dad_front_0' : 'dad_front_1';
}
const SLACK_KEY = { mom: 'mom_smoke', dad: 'dad_rest' };
const NOTICE_KEY = { mom: 'mom_surprised', dad: 'dad_wave' };
const WINDUP_KEY = { mom: 'mom_hips', dad: 'dad_wave' };
const THROW_KEY = { mom: 'mom_surprised', dad: 'dad_front_1' };

function startSlack(f) {
  famSet(f, 'slack');
  f.idleAct = null;
  f.smokeT = 0;
  if (f.type === 'dad') setEmote(f, 'zzz', 9999);
  else f.emote = null;
}

function releaseThrow(f) {
  const st = FAMILY_STATS[f.type];
  const tgt = f.target;
  f.cd = st.cooldown * (0.9 + rand() * 0.2);
  if (!tgt || tgt.dead) return;
  const ef = enemyFoot(tgt);
  f.lean = Math.sign(ef.x - f.x) || 1;
  const dmg = f.special ? Math.round(st.dmg * 1.6) : st.dmg;
  tgt.pending += dmg;
  const sx = f.x + f.lean * 20, sy = f.y - FAMILY_H * (f.special ? 0.55 : 0.82);
  const dist = Math.hypot(ef.x - sx, ef.y - ENEMY_H * 0.55 - sy);
  projectiles.push({
    kind: st.proj, target: tgt, dmg, by: f,
    x0: sx, y0: sy, tx: ef.x, ty: ef.y - ENEMY_H * 0.55,
    t: 0, dur: clamp(dist / 480, 0.28, 0.6), arc: Math.min(90, dist * 0.35),
    x: sx, y: sy, px: sx, py: sy, rot: 0, prot: 0, spin: (rand() < 0.5 ? -1 : 1) * (10 + rand() * 6),
    trail: [], big: f.special,
  });
  effects.push({ type: 'swoosh', x: f.x + f.lean * 6, y: f.y - FAMILY_H * 0.78, dir: f.lean, t: 0, dur: 0.22, r: 34, scene: 'battle' });
}

function updateFamily(f, dt) {
  f.px = f.x; f.py = f.y;
  f.t += dt; f.age += dt;
  tickEmote(f, dt);
  if (f.state !== 'walk' && f.state !== 'slack' && f.state !== 'notice' && state.away) startSlack(f);
  switch (f.state) {
    case 'walk': {                                 // 사진을 넘기며 자기 자리로 걸어감 (아빠는 걷기 사진 4장)
      const dy = f.slotY - f.y, step = 150 * dt;
      if (Math.abs(dy) <= step) { f.y = f.slotY; famSet(f, 'arrive'); setEmote(f, 'note', 1.1); }
      else f.y += Math.sign(dy) * step;
      f.walkPhase += dt * (f.type === 'dad' ? 7.5 : 4);
      setSprite(f.sprite, f.type === 'dad' ? `dad_walk_${Math.floor(f.walkPhase) % 4}` : `mom_back_${Math.floor(f.walkPhase) % 2}`, false, 0);
      break;
    }
    case 'arrive':                                 // 뒤돌아 앞을 봄
      setSprite(f.sprite, idleKey(f), false, 0.25);
      if (f.t > 0.5) famSet(f, 'idle');
      break;
    case 'idle': {
      f.cd -= dt;
      const tgt = findTarget(f);
      if (tgt) f.bored = 0; else f.bored += dt;
      if (tgt && f.cd <= 0) {
        f.target = tgt;
        f.idleAct = null;
        f.special = f.type === 'dad' && (++f.attacks % 4 === 0);   // 아빠는 네 번에 한 번 날아차기 던지기
        famSet(f, 'windup');
        if (rand() < 0.3) setEmote(f, 'angry', 0.9);
        break;
      }
      f.nextAct -= dt;
      if (f.nextAct <= 0 && !f.idleAct) {
        if (f.type === 'mom') f.idleAct = f.bored > 5 ? 'mom_hips' : pick(['mom_hip', 'mom_hips']);
        else f.idleAct = f.bored > 5 ? 'dad_front_0' : 'dad_wave';
        f.idleActT = 1.4 + rand();
        f.nextAct = 4 + rand() * 5;
        if (f.bored > 5 && !f.emote) setEmote(f, 'dots', 1.8);
      }
      if (f.idleAct && (f.idleActT -= dt) <= 0) f.idleAct = null;
      setSprite(f.sprite, idleKey(f), false, 0.35);
      break;
    }
    case 'windup':                                 // 팔을 뒤로 젖혀 준비
      setSprite(f.sprite, WINDUP_KEY[f.type], false, 0.08);
      if (f.t >= 0.2) { releaseThrow(f); famSet(f, 'throw'); }
      break;
    case 'throw':                                  // 던지는 순간
      if (f.special) setSprite(f.sprite, 'dad_lunge', f.lean > 0, 0.06);
      else setSprite(f.sprite, THROW_KEY[f.type], false, 0.06);
      if (f.t >= (f.special ? 0.5 : 0.26)) famSet(f, 'recover');
      break;
    case 'recover':
      setSprite(f.sprite, idleKey(f), false, 0.2);
      if (f.t >= 0.22) famSet(f, 'idle');
      break;
    case 'slack':                                  // 플레이어가 없는 동안 땡땡이
      setSprite(f.sprite, SLACK_KEY[f.type], false, 0.3);
      if (f.type === 'mom' && (f.smokeT -= dt) <= 0) {
        f.smokeT = 0.45 + rand() * 0.3;
        const { w, h } = spriteSize('mom_smoke', FAMILY_H);
        smokePuff('battle', f.x - w * 0.3, f.y - h * 0.87, 1);
      }
      if (!state.away && (f.caughtT -= dt) <= 0) {
        famSet(f, 'notice');
        setEmote(f, 'alert', 1.1);
        if (f.type === 'mom') dropCigarette('battle', f.x - FAMILY_H * 0.1, f.y - FAMILY_H * 0.85);
      }
      break;
    case 'notice':                                 // 들켰다! 화들짝 뛰어오름
      setSprite(f.sprite, NOTICE_KEY[f.type], false, 0.1);
      if (f.t >= 1.0) { famSet(f, 'idle'); f.cd = Math.min(f.cd, 0.2); }
      break;
  }
  tickSprite(f.sprite, dt);
}

function famPose(f) {
  let hop = 0, rot = 0, sx = 1, sy = 1, ox = 0;
  const t = f.t;
  switch (f.state) {
    case 'walk': hop = Math.abs(Math.sin(f.walkPhase * Math.PI)) * (f.type === 'dad' ? 2 : 5); break;
    case 'arrive': hop = Math.sin(Math.min(t / 0.35, 1) * Math.PI) * 14; break;
    case 'idle': sy = 1 + Math.sin(f.age * 2.4) * 0.012; if (f.idleAct === 'dad_wave') rot = Math.sin(f.age * 7) * 0.03; break;
    case 'windup': { const k = Math.min(t / 0.2, 1); rot = -f.lean * 0.1 * easeOut(k); sy = 1 + 0.05 * k; sx = 1 - 0.03 * k; break; }
    case 'throw':
      if (f.special) { const a = Math.sin(Math.min(t / 0.5, 1) * Math.PI); hop = a * 42; ox = f.lean * a * 36; }
      else { const k = Math.min(t / 0.12, 1); rot = f.lean * 0.16 * (1 - k * 0.5); sx = 1 + 0.07 * (1 - k); sy = 1 - 0.07 * (1 - k); }
      break;
    case 'recover': rot = f.lean * 0.08 * (1 - t / 0.22); break;
    case 'slack': rot = f.type === 'mom' ? Math.sin(f.age * 1.2) * 0.02 : 0; sy = 1 + Math.sin(f.age * 1.6) * 0.02; break;
    case 'notice':
      if (t < 0.42) hop = Math.sin(t / 0.42 * Math.PI) * 34;
      else if (t < 0.6) { const k = (t - 0.42) / 0.18; sy = 1 - Math.sin(k * Math.PI) * 0.08; sx = 1 + Math.sin(k * Math.PI) * 0.06; }
      rot = Math.sin(t * 30) * 0.03 * Math.max(0, 1 - t * 2);
      break;
  }
  return { hop, rot, sx, sy, ox };
}

const EMOTE_ANCHOR = { dad_rest: [-0.28, 0.78], dad_lunge: [-0.3, 0.95] };
function emoteAnchor(sprite, personH) {
  const key = sprite.cur.key;
  const { w, h } = spriteSize(key, personH);
  const [fx, fy] = EMOTE_ANCHOR[key] || [0, 1.0];
  return { x: fx * w * (sprite.cur.flip ? -1 : 1), y: -fy * h - 6 };
}

function drawFamily(ctx, f, alpha) {
  const x = lerp(f.px, f.x, alpha), y = lerp(f.py, f.y, alpha);
  const { hop, rot, sx, sy, ox } = famPose(f);
  const born = Math.min(f.age / 0.4, 1);
  ctx.save();
  ctx.translate(x + ox, y);
  const sh = 1 - Math.min(hop, 40) / 80;
  ctx.fillStyle = `rgba(0,0,0,${0.22 * born})`;
  ctx.beginPath(); ctx.ellipse(0, 0, 24 * sh, 8 * sh, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(0, -hop);
  ctx.save();
  ctx.rotate(rot);
  ctx.scale(sx, sy);
  drawSpriteLayers(ctx, f.sprite, FAMILY_H, born);
  ctx.restore();
  if (f.emote) {
    const a = emoteAnchor(f.sprite, FAMILY_H);
    drawEmote(ctx, f.emote, a.x, a.y, 0.85);
  }
  ctx.restore();
}

// ───────────────── 투사체 / 공격 효과 ─────────────────
function updateProjectile(p, dt) {
  p.px = p.x; p.py = p.y; p.prot = p.rot;
  const tgt = p.target;
  if (tgt && !tgt.dead) {
    const ef = enemyFoot(tgt);
    p.tx = ef.x; p.ty = ef.y - ENEMY_H * 0.55;
  }
  p.t += dt / p.dur;
  const t = Math.min(p.t, 1);
  const bx = lerp(p.x0, p.tx, t), by = lerp(p.y0, p.ty, t) - p.arc * 4 * t * (1 - t);
  p.x = bx; p.y = by;
  p.rot += p.spin * dt;
  // 하얀 바람 꼬리: 진행 방향에 수직으로 살짝 꼬이며 따라옴
  const dx = p.x - p.px, dy = p.y - p.py, l = Math.hypot(dx, dy) || 1;
  const wob = Math.sin(p.t * 22) * 7;
  p.trail.push({ x: p.x - dy / l * wob, y: p.y + dx / l * wob });
  if (p.trail.length > 12) p.trail.shift();
  if (p.t >= 1) {
    p.done = true;
    if (tgt) {
      tgt.pending = Math.max(0, tgt.pending - p.dmg);
      if (!tgt.dead) {
        tgt.hp -= p.dmg;
        tgt.hitT = 0.22;
        tgt.kb += p.big ? 22 : 10;
        if (!tgt.emote && rand() < 0.3) setEmote(tgt, 'angry', 0.8);
        if (tgt.hp <= 0) killEnemy(tgt, p.by);
      }
    }
    effects.push({ type: 'swirl', x: p.x, y: p.y, t: 0, dur: p.big ? 0.5 : 0.38, r: p.big ? 46 : 32, scene: 'battle', rot: rand() * 6 });
    if (p.big) shake = Math.max(shake, 0.12);
    for (let i = 0; i < (p.big ? 12 : 7); i++) {
      const a = rand() * Math.PI * 2, sp = 90 + rand() * 120;
      particles.push({ scene: 'battle', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 120,
        life: 0, max: 0.3 + rand() * 0.15, size: 5 + rand() * 4, color: rand() < 0.5 ? '#ffffff' : '#ffe27a', rot: 0, vr: 0 });
    }
  }
}

function drawTrail(ctx, pts) {
  if (pts.length < 3) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [extra, col] of [[4, 'rgba(120,150,175,0.55)'], [0, '#ffffff']]) {
    ctx.strokeStyle = col;
    for (let i = 1; i < pts.length; i++) {
      const k = i / pts.length;
      ctx.globalAlpha = 0.2 + 0.75 * k;
      ctx.lineWidth = 2 + 11 * k + extra;
      ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawProjectile(ctx, p, alpha) {
  drawTrail(ctx, p.trail);
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha), r = lerp(p.prot, p.rot, alpha);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(r);
  if (p.big) ctx.scale(1.3, 1.3);
  ctx.strokeStyle = '#2b1d0e';
  ctx.lineWidth = 3;
  if (p.kind === 'slipper') {           // 엄마: 슬리퍼
    ctx.fillStyle = '#ff86ad';
    ctx.beginPath(); ctx.roundRect(-16, -8, 32, 16, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#d94f7e';
    ctx.fillRect(-4, -9, 9, 18);
    ctx.strokeRect(-4, -9, 9, 18);
  } else {                              // 아빠: 리모컨
    ctx.fillStyle = '#3d4148';
    ctx.beginPath(); ctx.roundRect(-7, -16, 14, 32, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8492f'; ctx.fillRect(-3, -11, 6, 5);
    ctx.fillStyle = '#c9ced6'; ctx.fillRect(-4, -2, 3, 3); ctx.fillRect(1, -2, 3, 3); ctx.fillRect(-4, 4, 3, 3); ctx.fillRect(1, 4, 3, 3);
  }
  ctx.restore();
}

function updateEffects(dt) {
  for (const e of effects) e.t += dt;
  for (let i = effects.length - 1; i >= 0; i--) if (effects[i].t >= effects[i].dur) effects.splice(i, 1);
}

function drawEffects(ctx, scene) {
  ctx.lineCap = 'round';
  for (const e of effects) {
    if (e.scene !== scene) continue;
    const k = e.t / e.dur;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.type === 'swoosh') {                     // 팔 휘두르는 흰 궤적
      ctx.globalAlpha = 1 - k;
      ctx.scale(e.dir, 1);
      for (const [w, col] of [[10, 'rgba(120,150,175,0.5)'], [6, '#ffffff']]) {
        ctx.strokeStyle = col; ctx.lineWidth = w * (1 - k * 0.5);
        ctx.beginPath(); ctx.arc(0, 8, e.r, -Math.PI * 0.95, -Math.PI * 0.95 + Math.PI * 0.9 * easeOut(Math.min(1, k * 2))); ctx.stroke();
      }
    } else if (e.type === 'swirl') {               // 맞은 자리의 하얀 소용돌이
      ctx.globalAlpha = 1 - k;
      ctx.rotate(e.rot + k * 5);
      const r = e.r * (0.4 + easeOut(k) * 0.8);
      for (let i = 0; i < 3; i++) {
        ctx.rotate(Math.PI * 2 / 3);
        for (const [w, col] of [[8, 'rgba(120,150,175,0.5)'], [4.5, '#ffffff']]) {
          ctx.strokeStyle = col; ctx.lineWidth = w * (1 - k * 0.6);
          ctx.beginPath(); ctx.arc(r * 0.35, 0, r * 0.65, 0, Math.PI * 1.1); ctx.stroke();
        }
      }
    } else if (e.type === 'ring') {               // 착지 먼지 고리
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = '#fff6d8'; ctx.lineWidth = 6 * (1 - k);
      ctx.beginPath(); ctx.ellipse(0, 0, e.r * (0.5 + k), e.r * 0.3 * (0.5 + k), 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

// ───────────────── 파티클 / 떠오르는 글씨 ─────────────────
function smokePuff(scene, x, y, s) {
  particles.push({ scene, x, y, vx: -6 + rand() * 12, vy: -26 - rand() * 14, g: -6, life: 0, max: 1.6 + rand() * 0.6,
    size: (7 + rand() * 4) * s, color: 'rgba(235,235,235,0.6)', rot: 0, vr: 0, shape: 'round', grow: 2.2 });
}
function dropCigarette(scene, x, y) {
  particles.push({ scene, x, y, vx: -40 + rand() * 30, vy: -80, g: 520, life: 0, max: 0.7, size: 12, color: '#ffffff', rot: 0, vr: 14, shape: 'cig' });
}

function updateParticles(dt) {
  for (const p of particles) {
    p.life += dt;
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.tx !== undefined) {                     // 목표로 날아가는 동전
      const k = Math.min(1, p.life / p.max);
      const e = easeInOut(k);
      p.x = lerp(p.sx, p.tx, e); p.y = lerp(p.sy, p.ty, e) - Math.sin(k * Math.PI) * p.arc;
    }
  }
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life >= particles[i].max) particles.splice(i, 1);
  for (const f of floaters) f.t += dt;
  for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].t >= 1) floaters.splice(i, 1);
}

function drawParticles(ctx, scene) {
  for (const p of particles) {
    if (p.scene !== scene) continue;
    const k = 1 - p.life / p.max;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.shape === 'round') {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(0, 0, p.size * (1 + (p.grow || 0) * (1 - k)), 0, Math.PI * 2); ctx.fill();
    } else if (p.shape === 'coin') {
      ctx.globalAlpha = 1;
      drawPixelIcon(ctx, 'coin', 0, 0, p.size);
    } else if (p.shape === 'cig') {               // 떨어지는 담배꽁초
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-6, -2, 9, 4);
      ctx.fillStyle = '#e8a050'; ctx.fillRect(3, -2, 4, 4);
      ctx.fillStyle = '#ff5a2a'; ctx.fillRect(-7, -1.5, 2, 3);
    } else {
      ctx.fillStyle = p.color;
      if (p.flat) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (0.4 + Math.abs(Math.sin(p.life * 9 + p.vr))));
      else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }
}

function drawFloaters(ctx) {
  for (const f of floaters) {
    const k = f.t;
    ctx.save();
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const y = f.y - easeOut(k) * 46;
    const s = k < 0.18 ? easeOutBack(k / 0.18) : 1;
    ctx.translate(f.x, y);
    ctx.scale(s, s);
    drawPixelIcon(ctx, 'coin', -36, 0, 26);
    outlinedText(ctx, f.text, 10, 0, 30, '#ffe94a', '#3a2410', { shadow: '#a86a10' });
    ctx.restore();
  }
}

// ───────────────── 적 생성 (웨이브 없이 계속) ─────────────────
function updateSpawner(dt) {
  state.battleTime += dt;
  spawner.timer -= dt;
  if (spawner.timer > 0) return;
  const alive = enemies.filter(e => !e.dead).length;
  if (alive >= MAX_ENEMIES) { spawner.timer = 0.5; return; }
  // 첫 적과 겹치지 않도록 출발점 근처가 비었을 때만
  if (enemies.some(e => !e.dead && ((e.dist % PATH.len) + PATH.len) % PATH.len < 44)) { spawner.timer = 0.3; return; }
  spawnEnemy();
  spawner.timer = Math.max(1.15, 3.0 - state.battleTime * 0.006) * (0.8 + rand() * 0.4);
}

// ───────────────── 타워(집) 화면 ─────────────────
function houseSize() {
  const img = IMG.house;
  return { w: HOUSE_W, h: HOUSE_W * img.height / img.width };
}
function houseRectOf(o) {
  const { w, h } = houseSize();
  return { x: o.cx - w / 2, y: o.bottom - h, w, h };
}
function loanRect() {
  const r = houseRectOf(house);
  return { x: house.cx - 150, y: r.y - 172, w: 300, h: 96 };
}

const residents = { dad: makeResident('dad'), mom: makeResident('mom') };
function makeResident(who) {
  return { who, state: 'hidden', t: 0, x: 0, y: 0, sprite: makeSprite(`${who}_front_0`), emote: null, caughtT: 0, smokeT: 0, cheerT: 0, idle: rand() * 2 };
}
function residentSpot(who) { return { x: house.cx + RESIDENT_REL[who][0], y: house.bottom + RESIDENT_REL[who][1] }; }
function resSet(r, s) { r.state = s; r.t = 0; }

function buildHouse() {
  if (state.houseBuilt) return;
  state.houseBuilt = true;
  state.houseT = 0;
  house.cx = house.tx = ghost.cx;
  house.bottom = house.tb = ghost.bottom;
  for (const who of ['dad', 'mom']) {
    const r = residents[who];
    resSet(r, 'wait');
    r.sprite = makeSprite(`${who}_front_0`);
  }
  updateUI();
}

const EMERGE_START = 1.25, EMERGE_DUR = 1.5;

function updateTower(dt) {
  // 끌기: 집이 손가락을 부드럽게 따라옴
  for (const o of [house, ghost]) {
    const k = Math.min(1, dt * 16);
    const vx = (o.tx - o.cx) * k;
    o.cx += vx; o.bottom += (o.tb - o.bottom) * k;
    o.tilt = lerp(o.tilt, clamp(vx * 0.02, -0.12, 0.12), Math.min(1, dt * 10));
    o.lift = lerp(o.lift, drag && drag.obj === o ? 1 : 0, Math.min(1, dt * 12));
  }
  house.landT += dt;
  loanFx.shake = Math.max(0, loanFx.shake - dt);
  loanFx.flash = Math.max(0, loanFx.flash - dt);
  loanFx.press = Math.max(0, loanFx.press - dt);
  if (!state.houseBuilt || state.scene !== 'tower') return;
  const before = state.houseT;
  state.houseT += dt;
  const t = state.houseT;
  if (before < 0.55 && t >= 0.55) landBurst(true);
  for (const who of ['dad', 'mom']) updateResident(residents[who], dt);
}

function landBurst(confetti) {
  shake = 0.3;
  const r = houseRectOf(house);
  effects.push({ type: 'ring', x: house.cx, y: house.bottom - 4, t: 0, dur: 0.5, r: r.w * 0.55, scene: 'tower' });
  for (let i = 0; i < 22; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    particles.push({ scene: 'tower', x: house.cx + side * rand() * r.w * 0.5, y: house.bottom - 4, vx: side * (60 + rand() * 160), vy: -40 - rand() * 80, g: 120,
      life: 0, max: 0.7 + rand() * 0.4, size: 9 + rand() * 8, color: rand() < 0.5 ? 'rgba(233,220,184,0.9)' : 'rgba(203,184,138,0.9)', rot: 0, vr: 0, shape: 'round', grow: 1 });
  }
  if (confetti) confettiBurst(house.cx, r.y + 20, 90);
}

function confettiBurst(x, y, n) {
  const colors = ['#e8492f', '#f2c23a', '#5fd14a', '#4aa8f2', '#b05fe8', '#ff86ad', '#ffffff'];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.9, sp = 260 + rand() * 360;
    particles.push({ scene: 'tower', x: x + (rand() - 0.5) * 60, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 420,
      life: 0, max: 1.6 + rand() * 0.9, size: 9 + rand() * 7, color: colors[i % colors.length], rot: rand() * 6, vr: (rand() - 0.5) * 14, flat: true });
  }
}

function updateResident(r, dt) {
  r.t += dt;
  r.idle += dt;
  tickEmote(r, dt);
  const spot = residentSpot(r.who);
  const door = { x: house.cx, y: house.bottom - 28 };
  const busy = r.state === 'wait' || r.state === 'emerge' || r.state === 'turn';
  if (state.away && !busy && r.state !== 'slack' && r.state !== 'notice') {
    resSet(r, 'slack');
    if (r.who === 'dad') setEmote(r, 'zzz', 9999); else r.emote = null;
  }
  // 집을 옮기면 자기 자리로 걸어감
  if (!busy) {
    const dx = spot.x - r.x, dy = spot.y - r.y, d = Math.hypot(dx, dy);
    const step = 300 * dt;
    if (d > step) { r.x += dx / d * step; r.y += dy / d * step; r.walking = true; } else { r.x = spot.x; r.y = spot.y; r.walking = false; }
  }
  switch (r.state) {
    case 'wait':
      r.x = door.x; r.y = door.y;
      if (state.houseT >= EMERGE_START) resSet(r, 'emerge');
      break;
    case 'emerge': {                               // 문에서 걸어 나옴 (앞모습)
      const u = Math.min(r.t / EMERGE_DUR, 1), e = easeInOut(u);
      r.x = lerp(door.x, spot.x, e); r.y = lerp(door.y, spot.y, e);
      setSprite(r.sprite, `${r.who}_front_${Math.floor(r.t * 4) % 2}`, false, 0.12);
      if (u >= 1) { resSet(r, 'turn'); }
      break;
    }
    case 'turn':                                   // 집 쪽으로 돌아섬
      setSprite(r.sprite, `${r.who}_turn`, false, 0.12);
      if (r.t >= 0.3) { resSet(r, 'cheer'); r.cheerT = 1.8; setEmote(r, r.who === 'dad' ? 'note' : 'heart', 1.6); if (r.who === 'mom') confettiBurst(house.cx, houseRectOf(house).y + 30, 60); }
      break;
    case 'cheer':                                  // 만세!
      setSprite(r.sprite, `${r.who}_cheer`, false, 0.1);
      if (r.t >= r.cheerT) resSet(r, 'idle');
      break;
    case 'idle':
      setSprite(r.sprite, `${r.who}_back_${Math.floor(r.idle / 1.3) % 2}`, false, 0.4);
      break;
    case 'slack':
      setSprite(r.sprite, r.who === 'mom' ? 'mom_smoke' : 'dad_rest', false, 0.3);
      if (r.who === 'mom' && (r.smokeT -= dt) <= 0) {
        r.smokeT = 0.45 + rand() * 0.3;
        const { w, h } = spriteSize('mom_smoke', RESIDENT_H);
        smokePuff('tower', r.x - w * 0.3, r.y - h * 0.87, 1.7);
      }
      if (!state.away && (r.caughtT -= dt) <= 0) {
        resSet(r, 'notice');
        setEmote(r, 'alert', 1.1);
        if (r.who === 'mom') dropCigarette('tower', r.x - RESIDENT_H * 0.1, r.y - RESIDENT_H * 0.85);
      }
      break;
    case 'notice':
      setSprite(r.sprite, r.who === 'mom' ? 'mom_surprised' : 'dad_wave', false, 0.1);
      if (r.t >= 1.0) resSet(r, 'idle');
      break;
  }
  tickSprite(r.sprite, dt);
}

function cheerResidents(emote) {
  for (const who of ['dad', 'mom']) {
    const r = residents[who];
    if (r.state === 'idle' || r.state === 'cheer') { resSet(r, 'cheer'); r.cheerT = 1.5; setEmote(r, emote, 1.4); }
  }
}

function payLoan() {
  loanFx.press = 0.15;
  if (state.money < LOAN_INTEREST) {
    loanFx.shake = 0.4;
    for (const who of ['dad', 'mom']) if (!residents[who].emote) setEmote(residents[who], 'sweat', 1.4);
    return;
  }
  state.money -= LOAN_INTEREST;
  state.loanPaid++;
  loanFx.flash = 0.6;
  const lr = loanRect();
  for (let i = 0; i < 14; i++) {                    // 동전이 집으로 쏙
    particles.push({ scene: 'tower', sx: lr.x + 50 + rand() * 40, sy: lr.y + lr.h / 2, tx: house.cx + (rand() - 0.5) * 40, ty: house.bottom - houseSize().h * 0.25,
      arc: 60 + rand() * 60, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: -i * 0.05, max: 0.7, size: 26, rot: 0, vr: 0, shape: 'coin' });
  }
  cheerResidents('heart');
}

function residentPose(r) {
  let hop = 0, rot = 0, sx = 1, sy = 1, scale = 1, alpha = 1;
  const t = r.t;
  switch (r.state) {
    case 'wait': alpha = 0; break;
    case 'emerge': { const u = Math.min(t / EMERGE_DUR, 1); scale = lerp(0.32, 1, easeInOut(u)); alpha = Math.min(1, u * 3); hop = Math.abs(Math.sin(t * Math.PI * 4)) * 8 * (1 - u * 0.5); break; }
    case 'cheer': hop = Math.abs(Math.sin(t * Math.PI * 2.2)) * 34; sy = 1 + Math.sin(t * Math.PI * 4.4) * 0.025; break;
    case 'idle': sy = 1 + Math.sin(r.idle * 2 + (r.who === 'dad' ? 0.6 : 0)) * 0.01; if (r.walking) hop = Math.abs(Math.sin(r.idle * 12)) * 10; break;
    case 'slack': sy = 1 + Math.sin(r.idle * 1.6) * 0.015; break;
    case 'notice': if (t < 0.42) hop = Math.sin(t / 0.42 * Math.PI) * 60; rot = Math.sin(t * 30) * 0.03 * Math.max(0, 1 - t * 2); break;
  }
  return { hop, rot, sx, sy, scale, alpha };
}

function drawHouse(ctx, o, alpha, ghostMode) {
  const { w, h } = houseSize();
  const lift = o.lift;
  ctx.save();
  ctx.translate(o.cx, o.bottom);
  // 그림자 (들어 올리면 커지고 옅어짐)
  ctx.fillStyle = `rgba(0,0,0,${(0.2 - lift * 0.08) * alpha})`;
  ctx.beginPath(); ctx.ellipse(0, -6, w * (0.52 + lift * 0.06), 22 + lift * 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(0, -lift * 26);
  ctx.rotate(o.tilt);
  const s = 1 + lift * 0.05;
  ctx.scale(s, s);
  ctx.globalAlpha = alpha;
  ctx.drawImage(IMG.house, -w / 2, -h, w, h);
  if (ghostMode) {                                  // 반짝이는 테두리
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * (0.18 + Math.sin(state.time * 3) * 0.1);
    ctx.drawImage(IMG.house, -w / 2, -h, w, h);
  }
  ctx.restore();
}

function drawLoanPanel(ctx) {
  const r = loanRect();
  const sh = loanFx.shake > 0 ? Math.sin(loanFx.shake * 60) * 8 * (loanFx.shake / 0.4) : 0;
  const press = loanFx.press > 0 ? 1 - Math.sin(loanFx.press / 0.15 * Math.PI) * 0.06 : 1;
  const born = clamp((state.houseT - 0.8) / 0.35, 0, 1);
  if (born <= 0) return;
  ctx.save();
  ctx.translate(r.x + r.w / 2 + sh, r.y + r.h / 2);
  const s = (born < 1 ? easeOutBack(born) : 1) * press;
  ctx.scale(s, s);
  ctx.globalAlpha = Math.min(1, born * 2);
  ctx.fillStyle = 'rgba(20,40,8,0.42)';
  ctx.beginPath(); ctx.roundRect(-r.w / 2, -r.h / 2, r.w, r.h, r.h / 2); ctx.fill();
  if (loanFx.flash > 0) {
    ctx.fillStyle = `rgba(255,240,150,${loanFx.flash * 0.6})`;
    ctx.beginPath(); ctx.roundRect(-r.w / 2, -r.h / 2, r.w, r.h, r.h / 2); ctx.fill();
  }
  drawPixelIcon(ctx, 'coin', -r.w / 2 + 52, 0, 58);
  const can = state.money >= LOAN_INTEREST;
  outlinedText(ctx, '대출이자 갚기', 28, -18, 30, '#ffe94a', '#2b1d0e', { shadow: '#a86a10' });
  outlinedText(ctx, `${LOAN_INTEREST}`, 28, 22, 34, can ? '#ffe94a' : '#ffd0a0', '#2b1d0e', { shadow: '#a86a10' });
  ctx.restore();
}

function drawTowerScene(ctx, alpha) {
  if (!state.houseBuilt) {                          // 끌어다 놓을 집 + 끄는 손 그림
    drawHouse(ctx, ghost, 0.62 + Math.sin(state.time * 2.4) * 0.08, true);
    if (!drag) {
      const k = (state.time % 2.2) / 2.2;
      const r = houseRectOf(ghost);
      const press = k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1;
      const mv = clamp((k - 0.2) / 0.5, 0, 1);
      ctx.save();
      ctx.globalAlpha = Math.min(1, press * 1.5);
      drawPixelIcon(ctx, 'hand', r.x + r.w * 0.62 + easeInOut(mv) * 60, r.y + r.h * 0.62 - easeInOut(mv) * 40 + (1 - press) * 10, 64 - press * 6);
      ctx.restore();
    }
    return;
  }

  const t = state.houseT;
  const { w, h } = houseSize();
  const fall = Math.min(t / 0.55, 1);
  const dropY = (1 - easeOutBounce(fall)) * -420;
  ctx.save();
  ctx.translate(0, dropY);
  ctx.globalAlpha = Math.min(1, t / 0.12);
  const land = house.landT < 0.3 ? Math.sin(house.landT / 0.3 * Math.PI) * 0.05 : 0;
  const squash = (t > 0.55 && t < 0.8 ? Math.sin((t - 0.55) / 0.25 * Math.PI) * 0.06 : 0) + land;
  ctx.translate(house.cx, house.bottom);
  ctx.scale(1 + squash, 1 - squash);
  ctx.translate(-house.cx, -house.bottom);
  drawHouse(ctx, house, 1, false);
  // 문 열림 (엄마 아빠가 나오는 동안)
  const doorOpen = clamp((t - EMERGE_START + 0.25) / 0.25, 0, 1) * (1 - clamp((t - EMERGE_START - EMERGE_DUR + 0.2) / 0.4, 0, 1));
  if (doorOpen > 0) {
    ctx.save();
    ctx.translate(house.cx, house.bottom - house.lift * 26);
    ctx.fillStyle = `rgba(30,18,8,${0.85 * doorOpen})`;
    ctx.beginPath();
    ctx.roundRect(-w * 0.062, -h * 0.36, w * 0.124, h * 0.25, [w * 0.06, w * 0.06, 0, 0]);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // 이름표 + 대출이자 판
  if (t > 0.55) {
    const k = clamp((t - 0.55) / 0.35, 0, 1);
    const s = k < 1 ? 0.5 + easeOutBounce(k) * 0.5 : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 3);
    ctx.translate(house.cx, house.bottom - h - 34 - house.lift * 26);
    ctx.scale(s, s);
    outlinedText(ctx, HOUSE_LABEL, 0, 0, 46, '#ffffff', '#2b1d0e', { shadow: '#f2c23a' });
    ctx.restore();
    drawLoanPanel(ctx);
  }

  // 엄마 아빠
  const list = ['dad', 'mom'].map(who => residents[who]).sort((a, b) => a.y - b.y);
  for (const r of list) {
    const p = residentPose(r);
    if (p.alpha <= 0) continue;
    ctx.save();
    ctx.translate(r.x, r.y);
    const shs = p.scale * (1 - Math.min(p.hop, 60) / 140);
    ctx.fillStyle = `rgba(0,0,0,${0.2 * p.alpha})`;
    ctx.beginPath(); ctx.ellipse(0, 0, 50 * shs, 13 * shs, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, -p.hop);
    ctx.save();
    ctx.rotate(p.rot);
    ctx.scale(p.scale * p.sx, p.scale * p.sy);
    drawSpriteLayers(ctx, r.sprite, RESIDENT_H, p.alpha);
    ctx.restore();
    if (r.emote && p.alpha > 0.5) {
      const a = emoteAnchor(r.sprite, RESIDENT_H * p.scale);
      drawEmote(ctx, r.emote, a.x, a.y, 1.6);
    }
    ctx.restore();
  }
}

// ───────────────── 플레이어 자리 비움 감지 ─────────────────
function goAway() {
  if (state.away || !ready) return;
  state.away = true;
}
function comeBack() {
  if (!state.away) return;
  state.away = false;
  // 바로 알아채지 않고 잠깐 땡땡이를 들킨 채로 있다가 화들짝
  for (const f of family) f.caughtT = 0.8 + rand() * 0.6;
  for (const who of ['dad', 'mom']) residents[who].caughtT = 0.8 + rand() * 0.6;
}

// ───────────────── 화면 / 카메라 ─────────────────
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const view = { s: 1, ox: 0, oy: 0, dpr: 1, cw: 0, ch: 0 };   // 화면px = 월드*s + o

function layoutFor(scene, cw, ch) {
  const need = { ...NEED[scene] };
  if (cw > ch) need.y1 = scene === 'battle' ? 1200 : 1160;   // 가로 화면: 버튼은 맵 옆으로 가므로 아래 숲은 덜 보여도 됨
  const cover = Math.max(cw / MAP_W, ch / MAP_H);
  const fit = Math.min(cw / (need.x1 - need.x0), ch / (need.y1 - need.y0));
  const s = Math.min(cover, fit);
  const visW = cw / s, visH = ch / s;
  const left = visW >= MAP_W ? (MAP_W - visW) / 2 : clamp((need.x0 + need.x1) / 2 - visW / 2, 0, MAP_W - visW);
  const top = visH >= MAP_H ? (MAP_H - visH) / 2 : clamp((need.y0 + need.y1) / 2 - visH / 2, 0, MAP_H - visH);
  return { s, ox: -left * s, oy: -top * s };
}

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.cw = window.innerWidth;
  view.ch = window.innerHeight;
  canvas.width = Math.round(view.cw * view.dpr);
  canvas.height = Math.round(view.ch * view.dpr);
  canvas.style.width = view.cw + 'px';
  canvas.style.height = view.ch + 'px';
  Object.assign(view, layoutFor(state.scene, view.cw, view.ch));
  layoutUI();
}

// 맵을 화면 전체에 깔기. 화면이 맵보다 넓으면 남는 곳을 숲(전장)·잔디(타워) 무늬로 채우고
// 맵 가장자리를 부드럽게 녹여서 빈 띠나 가짜 길이 보이지 않게 한다.
const FILL_CROP = { map: [0, 0, MAP_W, 220], towerMap: [0, 0, MAP_W, 700] };
const bgCache = {};
function bgAssets(name) {
  if (bgCache[name]) return bgCache[name];
  const img = IMG[name];
  const [sx, sy, sw, sh] = FILL_CROP[name];
  const tile = document.createElement('canvas');          // 거울 2x2 → 이음매 없는 무늬
  tile.width = sw * 2; tile.height = sh * 2;
  const t = tile.getContext('2d');
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    t.save();
    t.translate(fx ? sw * 2 : 0, fy ? sh * 2 : 0);
    t.scale(fx ? -1 : 1, fy ? -1 : 1);
    t.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    t.restore();
  }
  const soft = document.createElement('canvas');          // 가장자리를 투명하게 녹인 맵
  soft.width = MAP_W; soft.height = MAP_H;
  const c = soft.getContext('2d');
  c.drawImage(img, 0, 0);
  c.globalCompositeOperation = 'destination-out';
  const F = 46;
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
    [0, 0, F, 0, 0, 0, F, MAP_H], [MAP_W, 0, MAP_W - F, 0, MAP_W - F, 0, F, MAP_H],
    [0, 0, 0, F, 0, 0, MAP_W, F], [0, MAP_H, 0, MAP_H - F, 0, MAP_H - F, MAP_W, F]]) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(rx, ry, rw, rh);
  }
  return (bgCache[name] = { pattern: ctx.createPattern(tile, 'repeat'), soft });
}

function drawBackground(name) {
  const img = IMG[name];
  const W = MAP_W * view.s, H = MAP_H * view.s;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const covered = view.ox <= 0.5 && view.oy <= 0.5 && view.ox + W >= view.cw - 0.5 && view.oy + H >= view.ch - 0.5;
  if (covered) { ctx.drawImage(img, view.ox, view.oy, W, H); return; }
  const { pattern, soft } = bgAssets(name);
  pattern.setTransform(new DOMMatrix([view.s * view.dpr, 0, 0, view.s * view.dpr, view.ox * view.dpr, view.oy * view.dpr]));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.drawImage(soft, view.ox, view.oy, W, H);
}

function worldTransform() {
  const sh = shake > 0 && state.scene === 'tower' ? Math.sin(state.time * 70) * shake * 14 : 0;
  ctx.setTransform(view.s * view.dpr, 0, 0, view.s * view.dpr, (view.ox + sh) * view.dpr, view.oy * view.dpr);
}


function render(alpha) {
  ctx.imageSmoothingEnabled = true;
  if (state.scene === 'battle') {
    drawBackground('map');
    worldTransform();
    const list = [];
    for (const e of enemies) list.push({ y: enemyFoot(e, alpha).y, draw: () => drawEnemy(ctx, e, alpha) });
    for (const f of family) list.push({ y: lerp(f.py, f.y, alpha), draw: () => drawFamily(ctx, f, alpha) });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.draw();
    drawEffects(ctx, 'battle');
    for (const p of projectiles) drawProjectile(ctx, p, alpha);
    drawParticles(ctx, 'battle');
    drawFloaters(ctx);
  } else {
    drawBackground('towerMap');
    worldTransform();
    drawEffects(ctx, 'tower');
    drawTowerScene(ctx, alpha);
    drawParticles(ctx, 'tower');
  }
}

// ───────────────── UI (DOM) ─────────────────
const $ = id => document.getElementById(id);
const ui = { money: $('moneyVal'), moneyBox: $('money'), family: $('familyBtn'), go: $('goBtn'), toast: $('toast'), fade: $('fade') };
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = pixelSVG(el.dataset.icon); });

// 아이폰 홈 바 등 안전 영역
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(safeProbe);
function safeInsets() {
  const cs = getComputedStyle(safeProbe);
  return { right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

function setBox(el, cx, top, w, h) {
  el.style.left = Math.round(cx - w / 2) + 'px';
  el.style.top = Math.round(top) + 'px';
  el.style.width = Math.round(w) + 'px';
  el.style.height = Math.round(h) + 'px';
}

function layoutUI() {
  const inset = safeInsets();
  const bottom = view.ch - 14 - inset.bottom;
  const mapRight = view.ox + MAP_W * view.s;
  const sideRoom = view.cw - inset.right - mapRight;
  let wide, sq;
  view.side = sideRoom >= 190;
  if (view.side) {
    // 가로 화면: 맵 오른쪽 숲에 버튼을 세로로 쌓는다 (길을 가리지 않게)
    const cx = mapRight + sideRoom / 2;
    const ww = Math.min(sideRoom - 28, 260);
    wide = { cx, w: ww, h: 52 };
    wide.top = bottom - wide.h;
    const sh = clamp(Math.min(wide.top - 24, ww * 0.8), 104, 176);
    sq = { cx, w: clamp(sh * 1.3, 128, Math.min(ww, 230)), h: sh, top: wide.top - 12 - sh };
  } else {
    // 세로 화면: 사용자가 그린 네모 자리(맵 좌표) 그대로, 화면 밖으로 나가면 위로 당김
    const s = view.s;
    wide = { cx: (SLOT_WIDE.x0 + SLOT_WIDE.x1) / 2 * s + view.ox,
      w: clamp((SLOT_WIDE.x1 - SLOT_WIDE.x0) * s, 170, 300), h: clamp((SLOT_WIDE.y1 - SLOT_WIDE.y0) * s, 42, 60) };
    wide.top = Math.min(SLOT_WIDE.y0 * s + view.oy, bottom - wide.h);
    const sh = clamp((SLOT_SQ.y1 - SLOT_SQ.y0) * s, 104, 176);
    sq = { cx: (SLOT_SQ.x0 + SLOT_SQ.x1) / 2 * s + view.ox,
      w: clamp((SLOT_SQ.x1 - SLOT_SQ.x0) * s, 128, 220), h: sh };
    sq.top = Math.min(SLOT_SQ.y0 * s + view.oy, wide.top - 10 - sh);
  }
  setBox(ui.go, wide.cx, wide.top, wide.w, wide.h);
  ui.go.style.fontSize = clamp(wide.h * 0.42, 15, 24) + 'px';
  setBox(ui.family, sq.cx, sq.top, sq.w, sq.h);
  ui.family.style.fontSize = clamp(sq.h * 0.13, 13, 21) + 'px';
  // 버튼 크기 기준 여백 (아래는 테두리+입체 띠 두께만큼 확보)
  ui.family.style.padding = `${Math.round(sq.h * 0.07)}px ${Math.round(sq.w * 0.06)}px ${Math.round(Math.max(13, sq.h * 0.09))}px`;
  ui.moneyBox.style.fontSize = clamp(view.cw * 0.07, 22, 34) + 'px';
}

let goScene = null;
function updateUI() {
  const battle = state.scene === 'battle';
  ui.family.classList.toggle('show', ready && battle);
  ui.go.classList.toggle('show', ready);
  ui.moneyBox.classList.toggle('show', ready);
  if (goScene !== state.scene) {
    goScene = state.scene;
    ui.go.classList.toggle('to-tower', battle);
    ui.go.classList.toggle('to-battle', !battle);
    ui.go.querySelector('.label').textContent = battle ? '타워로 가기' : '전장으로 가기';
    ui.go.querySelector('.ico').innerHTML = pixelSVG(battle ? 'house' : 'sword');
  }
  const cost = familyCost(state.familyCount);
  const full = family.length >= FAMILY_SLOTS.length;
  ui.family.classList.toggle('locked', !state.houseBuilt);
  ui.family.classList.toggle('poor', state.houseBuilt && !full && state.money < cost);
  ui.family.querySelector('.costVal').textContent = !state.houseBuilt ? '집이 필요해요' : full ? '자리 꽉 참' : `${cost}원`;
}

// 돈: 숫자가 부드럽게 올라가거나 내려감
let shownRounded = null;
function updateMoneyDisplay(dt) {
  const diff = state.money - state.shownMoney;
  if (Math.abs(diff) < 0.5) state.shownMoney = state.money;
  else state.shownMoney += diff * Math.min(1, dt * 9) + Math.sign(diff) * 0.3;
  const v = Math.round(state.shownMoney);
  if (v !== shownRounded) {
    if (shownRounded !== null && v > shownRounded) bump(ui.moneyBox);
    shownRounded = v;
    ui.money.textContent = v;
    updateUI();
  }
}

function bump(el) {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function toast(msg, sec = 1.8) {                   // 오류 알림 전용 (설명 문구는 띄우지 않음)
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  setTimeout(() => ui.toast.classList.remove('show'), sec * 1000);
}

function shakeEl(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

ui.family.addEventListener('click', () => {
  if (!ready) return;
  if (!state.houseBuilt) {                 // 글 대신 버튼 흔들기 + 타워 버튼 강조
    shakeEl(ui.family);
    ui.go.classList.remove('nudge'); void ui.go.offsetWidth; ui.go.classList.add('nudge');
    return;
  }
  if (family.length >= FAMILY_SLOTS.length) { shakeEl(ui.family); return; }
  const cost = familyCost(state.familyCount);
  if (state.money < cost) { shakeEl(ui.family); shakeEl(ui.moneyBox); return; }
  state.money -= cost;
  spawnFamily();
  updateUI();
});

let switching = false;
let ready = false;
ui.go.addEventListener('click', () => {
  if (switching || !ready) return;
  switching = true;
  drag = null;
  ui.fade.classList.add('on');
  setTimeout(() => {
    state.scene = state.scene === 'battle' ? 'tower' : 'battle';
    resize();
    fitHouseToView();
    updateUI();
    ui.fade.classList.remove('on');
    switching = false;
  }, 260);
});

// ───────────────── 집 끌어다 놓기 ─────────────────
let drag = null;
function toWorld(ev) { return { x: (ev.clientX - view.ox) / view.s, y: (ev.clientY - view.oy) / view.s }; }
function hitRect(r, p, pad = 0) { return p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad; }
function clampHouse(cx, bottom) {
  const { w, h } = houseSize();
  const x0 = Math.max(0, -view.ox / view.s), x1 = Math.min(MAP_W, (view.cw - view.ox) / view.s);
  const y0 = Math.max(0, -view.oy / view.s), y1 = Math.min(MAP_H, (view.ch - view.oy) / view.s);
  const minX = x0 + w / 2 + 6, maxX = x1 - w / 2 - 6;
  // 위: 이름표·대출이자 판 + 돈 표시 자리 / 아래: 엄마 아빠 발 + (세로 화면이면) 이동 버튼 자리
  const minB = y0 + h + 190 + 60 / view.s, maxB = y1 - 125 - (view.side ? 0 : 80 / view.s);
  return {
    cx: minX < maxX ? clamp(cx, minX, maxX) : (x0 + x1) / 2,
    bottom: minB < maxB ? clamp(bottom, minB, maxB) : Math.min(minB, y1 - 110),
  };
}

// 화면 크기가 바뀌어도 집이 화면 안에 있도록
function fitHouseToView() {
  if (state.scene !== 'tower') return;
  for (const o of [ghost, house]) {
    const c = clampHouse(o.tx, o.tb);
    o.tx = c.cx; o.tb = c.bottom;
    if (o === ghost || !state.houseBuilt) { o.cx = c.cx; o.bottom = c.bottom; }
  }
}

canvas.addEventListener('pointerdown', ev => {
  comeBack();
  if (!ready || state.scene !== 'tower' || switching) return;
  const p = toWorld(ev);
  if (state.houseBuilt && state.houseT > 1 && hitRect(loanRect(), p)) { payLoan(); return; }
  const obj = state.houseBuilt ? house : ghost;
  if (state.houseBuilt && state.houseT < 0.6) return;     // 떨어지는 중에는 못 잡음
  if (!hitRect(houseRectOf(obj), p, 10)) return;
  drag = { obj, dx: p.x - obj.cx, dy: p.y - obj.bottom, moved: 0, sx: p.x, sy: p.y };
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', ev => {
  if (!drag) return;
  const p = toWorld(ev);
  const c = clampHouse(p.x - drag.dx, p.y - drag.dy);
  drag.obj.tx = c.cx; drag.obj.tb = c.bottom;
  drag.moved = Math.max(drag.moved, Math.hypot(p.x - drag.sx, p.y - drag.sy));
});
function endDrag() {
  if (!drag) return;
  const obj = drag.obj;
  drag = null;
  if (obj === ghost) {                              // 놓은 자리에 집 짓기
    ghost.cx = ghost.tx; ghost.bottom = ghost.tb;
    buildHouse();
  } else {
    house.cx = house.tx; house.bottom = house.tb;
    house.landT = 0;
    effects.push({ type: 'ring', x: house.cx, y: house.bottom - 4, t: 0, dur: 0.45, r: HOUSE_W * 0.5, scene: 'tower' });
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// 다른 창/탭에 다녀오면 감지
document.addEventListener('visibilitychange', () => (document.hidden ? goAway() : comeBack()));
addEventListener('blur', goAway);
addEventListener('focus', comeBack);

// ───────────────── 루프 ─────────────────
function update(dt) {
  state.time += dt;
  shake = Math.max(0, shake - dt);
  updateSpawner(dt);
  for (const e of enemies) updateEnemy(e, dt);
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead && enemies[i].deathT > 0.6) enemies.splice(i, 1);
  for (const f of family) updateFamily(f, dt);
  for (const p of projectiles) updateProjectile(p, dt);
  for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].done) projectiles.splice(i, 1);
  updateTower(dt);
  updateEffects(dt);
  updateParticles(dt);
  updateMoneyDisplay(dt);
}

let acc = 0, last = 0;
function frame(nowMs) {
  const now = nowMs / 1000;
  const elapsed = Math.min(now - last, 0.25);
  last = now;
  acc += elapsed;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render(acc / STEP);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => { resize(); fitHouseToView(); });
resize();
updateUI();
const fontReady = document.fonts ? document.fonts.load(`40px ${FONT}`).catch(() => {}) : Promise.resolve();
Promise.all([loadAssets(), Promise.race([fontReady, new Promise(r => setTimeout(r, 1500))])])
  .then(() => {
    ready = true;
    updateUI();
    last = performance.now() / 1000;
    requestAnimationFrame(frame);
  })
  .catch(src => { toast(`이미지를 불러오지 못했습니다: ${src}`, 10); });

// 테스트/디버그용 훅
window.__game = { state, enemies, family, projectiles, residents, house, ghost, buildHouse, spawnFamily, payLoan, goAway, comeBack, view };
