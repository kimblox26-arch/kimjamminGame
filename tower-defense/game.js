'use strict';
// 가족 타워 디펜스
//  - 전장: 농부(적)가 맵 오른쪽 아래에서 생성되어 흙길을 계속 돈다. 가족이 던져서 잡으면 5원.
//  - 타워: 빈 잔디밭에 집을 지으면 안에서 엄마·아빠가 나온다. 집이 있어야 전장에서 가족 생성 가능.
//  - 로직은 1/60초 고정 스텝, 화면은 보간 렌더링(60fps 이상 화면에서도 부드럽게).

const MAP_W = 688, MAP_H = 1529;       // 두 맵 이미지 크기 = 월드 좌표계
const STEP = 1 / 60;

const ENEMY_H = 128;                   // 적 키(맵 픽셀)
const ENEMY_FRAME_RATE = 2.2;          // 초당 걷기 사진 전환 수
const FAMILY_H = 118;                  // 전장 가족 키
const REWARD = 5;                      // 적 1명당 보상(원)
const START_MONEY = 10;
const familyCost = n => 10 + n * 5;    // n = 이미 생성한 가족 수
const MAX_ENEMIES = 24;

// 흙길 중앙선 꼭짓점 (map.png 픽셀 분석값). 오른쪽 아래에서 출발해 시계 방향.
const PATH_CORNERS = [[566, 1094], [90, 1094], [90, 414], [566, 414]];
const CORNER_R = 52;

// 전장 가족 배치 자리(발 위치). 안쪽 잔디밭 가장자리 — 어느 자리든 사거리 안에 길이 들어온다.
const FAMILY_SLOTS = [[475, 1020], [185, 560], [185, 1020], [475, 560], [330, 1020], [330, 560], [185, 790], [475, 790]];

const FAMILY_STATS = {
  mom: { dmg: 20, cooldown: 0.85, range: 205, proj: 'slipper' },
  dad: { dmg: 32, cooldown: 1.25, range: 225, proj: 'remote' },
};

// 화면에 꼭 보여야 하는 영역(맵 좌표) — 화면비가 달라도 이 영역은 잘리지 않는다.
const NEED = {
  battle: { x0: 30, x1: 658, y0: 200, y1: 1480 },
  tower: { x0: 60, x1: 628, y0: 60, y1: 1480 },
};
// 버튼 자리(맵 좌표). 가족 생성 = 사용자가 네모로 그린 곳, 그 아래 이동 버튼.
const SLOT_SQ = { x0: 215, x1: 470, y0: 1205, y1: 1397 };
const SLOT_WIDE = { x0: 190, x1: 495, y0: 1412, y1: 1478 };

// 타워 화면 배치
const HOUSE = { cx: 344, bottom: 985, w: 400 };
const RESIDENT_H = 400;
const RESIDENT_SPOT = { dad: [236, 1100], mom: [462, 1100] };
const HOUSE_LABEL = 'Lv.1 대출이 반인 집';
const TITLE = '가족 타워 디펜스';
const FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

// ───────────────── 유틸 ─────────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {   // 구형 브라우저 대비
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function easeOutBounce(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
// 결정적 난수 (연출용)
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

// ───────────────── 도트 아이콘 (이모지 대신 직접 그린 그림) ─────────────────
const PIXEL_ICONS = {
  coin: {
    pal: { k: '#3a2410', y: '#ffd84a', o: '#e0961a', w: '#fff7c9' },
    rows: ['...kkkk...', '..kyyyyk..', '.kywwyyyk.', 'kywyyyyyok', 'kywyyyyyok',
           'kyyyyyyyok', 'kyyyyyyook', '.kyyyyook.', '..kooook..', '...kkkk...'],
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

// 캔버스용 도트 코인
function drawPixelCoin(ctx, cx, cy, size) {
  const { pal, rows } = PIXEL_ICONS.coin;
  const px = size / rows.length;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(cx - size / 2 + x * px, cy - size / 2 + y * px, px + 0.5, px + 0.5);
    }
  });
}

// 테두리 있는 글씨
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
for (const who of ['dad', 'mom']) for (const n of ['back_0', 'back_1', 'turn']) IMAGE_LIST[`${who}_${n}`] = `assets/characters/family/${who}_${n}.png`;

function loadAssets() {
  return Promise.all(Object.entries(IMAGE_LIST).map(([k, src]) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => { IMG[k] = img; ok(); };
    img.onerror = () => fail(src);
    img.src = src;
  })));
}

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
  houseBuilt: false,
  houseT: 0,              // 집 지은 뒤 경과 시간
  familyCount: 0,
  time: 0,
};
const enemies = [];
const family = [];
const projectiles = [];
const particles = [];       // { scene, x, y, vx, vy, g, life, max, size, color, rot, vr }
const floaters = [];        // "+5원"
const wave = { n: 0, toSpawn: 0, timer: 2.5, spawnTimer: 0, mode: 'break', banner: 0 };
let shake = 0;
let nextId = 1;

// 사진 전환을 크로스페이드로 처리하는 스프라이트 상태
// blend = 0 이면 즉시 교체(걷기 프레임), 0보다 크면 그 시간 동안 크로스페이드(방향 전환·숨쉬기)
function makeSprite(key, flip = false) { return { cur: { key, flip }, prev: null, fade: 1, dur: 1 }; }
function setSprite(sp, key, flip, blend = 0) {
  if (sp.cur.key === key && sp.cur.flip === flip) return;
  const next = { key, flip };
  if (blend <= 0) { sp.cur = next; return; }          // 진행 중인 페이드는 그대로 둔다
  if (!(sp.prev && sp.fade < 0.5)) sp.prev = sp.cur;  // 페이드 초반에 또 바뀌면 원래 사진에서 이어서
  sp.cur = next; sp.fade = 0; sp.dur = blend;
}
function tickSprite(sp, dt) { if (sp.fade < 1) sp.fade = Math.min(1, sp.fade + dt / sp.dur); }
function drawSpriteLayers(ctx, sp, h, alpha) {
  // 새 사진을 불투명하게 깔고 이전 사진을 그 위에서 서서히 지운다 → 겹친 부분이 반투명해지지 않음
  const layers = [[sp.cur, 1]];
  if (sp.prev && sp.fade < 1) layers.push([sp.prev, 1 - sp.fade]);
  for (const [l, a] of layers) {
    const img = IMG[l.key];
    const w = img.width * (h / img.height);
    ctx.save();
    ctx.globalAlpha = alpha * a;
    if (l.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }
}

// ───────────────── 적 ─────────────────
function spawnEnemy() {
  const hp = Math.round(40 * Math.pow(1.2, wave.n - 1));
  enemies.push({
    id: nextId++, dist: 0, prevDist: 0, hp, maxHp: hp, pending: 0,
    speed: Math.min(52 + wave.n * 1.2, 68),
    age: 0, phase: 0, hitT: 0, dead: false, deathT: 0,
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
  if (e.dead) { e.deathT += dt; return; }
  const moving = e.age > 0.45;           // 등장 연출 후 출발
  if (moving) {
    const ramp = Math.min(1, (e.age - 0.45) / 0.6);   // 부드럽게 출발
    e.dist += e.speed * ramp * dt;
    e.phase += dt * ENEMY_FRAME_RATE * ramp;
  }
  const pose = enemyPose(e);
  const turned = pose.dir !== e.dir || pose.flip !== e.sprite.cur.flip;
  e.dir = pose.dir;
  setSprite(e.sprite, pose.key, pose.flip, turned ? 0.14 : 0);
  tickSprite(e.sprite, dt);
}

function enemyFoot(e, alpha = 1) {
  const p = pointAt(lerp(e.prevDist, e.dist, alpha));
  return { x: p.x, y: p.y + 26 };
}

function killEnemy(e) {
  e.dead = true; e.deathT = 0;
  state.money += REWARD;
  bumpMoney();
  const f = enemyFoot(e);
  floaters.push({ x: f.x, y: f.y - ENEMY_H - 20, t: 0, text: `+${REWARD}원` });
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2, sp = 60 + rand() * 120;
    particles.push({ scene: 'battle', x: f.x, y: f.y - 30, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, g: 260,
      life: 0, max: 0.6 + rand() * 0.3, size: 6 + rand() * 5, color: rand() < 0.5 ? '#d8b26a' : '#a07a3e', rot: 0, vr: 0 });
  }
}

function drawEnemy(ctx, e, alpha) {
  const f = enemyFoot(e, alpha);
  const born = Math.min(e.age / 0.45, 1);
  const pop = born < 1 ? 1 - Math.pow(1 - born, 3) * Math.cos(born * 8) : 1;
  const moving = e.age > 0.45;
  const bob = moving ? Math.abs(Math.sin(e.phase * Math.PI)) * 3 : 0;
  const tilt = moving ? Math.sin(e.phase * Math.PI) * 0.025 : 0;
  const hit = e.hitT / 0.18;
  let a = 1, sy = 1, sx = 1, lift = 0;
  if (e.dead) {
    const d = Math.min(e.deathT / 0.4, 1);
    a = 1 - d; sx = sy = 1 - d * 0.35; lift = d * 20;
  }
  sx *= 1 + hit * 0.07; sy *= 1 - hit * 0.08;

  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.fillStyle = `rgba(0,0,0,${0.22 * a})`;
  ctx.beginPath(); ctx.ellipse(0, 0, 26 * pop, 8 * pop, 0, 0, Math.PI * 2); ctx.fill();
  if (born < 1) {
    ctx.strokeStyle = `rgba(255,255,255,${1 - born})`;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(0, 0, 18 + born * 46, 7 + born * 16, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.translate(0, -bob - lift);
  ctx.rotate(tilt);
  ctx.scale(sx * pop, sy * pop);
  drawSpriteLayers(ctx, e.sprite, ENEMY_H, a);
  ctx.restore();

  if (!e.dead && born >= 1) drawHpBar(ctx, f.x, f.y - ENEMY_H - 14, e.hp / e.maxHp);
}

function drawHpBar(ctx, x, y, ratio) {
  const w = 54, h = 9;
  ctx.fillStyle = '#2b1d0e';
  ctx.fillRect(x - w / 2 - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = '#5a2a1c';
  ctx.fillRect(x - w / 2, y, w, h);
  const r = clamp(ratio, 0, 1);
  ctx.fillStyle = r > 0.6 ? '#5fd14a' : r > 0.3 ? '#f2c23a' : '#e8492f';
  ctx.fillRect(x - w / 2, y, Math.round(w * r), h);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x - w / 2, y, Math.round(w * r), 3);
}

// ───────────────── 가족 (전장) ─────────────────
function spawnFamily() {
  const type = state.familyCount % 2 === 0 ? 'mom' : 'dad';
  const [x, y] = FAMILY_SLOTS[family.length];
  family.push({
    type, x, y, cd: 0.4, age: 0, throwT: 0, lean: 0, idle: rand() * 3,
    sprite: makeSprite(`${type}_back_0`),
  });
  state.familyCount++;
}

function updateFamily(f, dt) {
  f.age += dt;
  f.idle += dt;
  f.throwT = Math.max(0, f.throwT - dt);
  setSprite(f.sprite, `${f.type}_back_${Math.floor(f.idle / 1.1) % 2}`, false, 0.35);
  tickSprite(f.sprite, dt);
  f.cd -= dt;
  if (f.cd > 0 || f.age < 0.5) return;
  const st = FAMILY_STATS[f.type];
  const ox = f.x, oy = f.y - FAMILY_H * 0.6;
  let best = null;
  for (const e of enemies) {
    if (e.dead || e.age < 0.45 || e.hp - e.pending <= 0) continue;
    const ef = enemyFoot(e);
    if (Math.hypot(ef.x - ox, ef.y - ENEMY_H * 0.5 - oy) > st.range) continue;
    if (!best || e.dist > best.dist) best = e;
  }
  if (!best) return;
  f.cd = st.cooldown;
  f.throwT = 0.28;
  const ef = enemyFoot(best);
  f.lean = Math.sign(ef.x - f.x) || 1;
  best.pending += st.dmg;
  const sx = f.x + f.lean * 18, sy = f.y - FAMILY_H * 0.78;
  const dist = Math.hypot(ef.x - sx, ef.y - ENEMY_H * 0.55 - sy);
  projectiles.push({
    kind: st.proj, target: best, dmg: st.dmg,
    x0: sx, y0: sy, tx: ef.x, ty: ef.y - ENEMY_H * 0.55,
    t: 0, dur: clamp(dist / 480, 0.28, 0.6), arc: Math.min(90, dist * 0.35),
    x: sx, y: sy, px: sx, py: sy, rot: 0, prot: 0, spin: (rand() < 0.5 ? -1 : 1) * (10 + rand() * 6),
  });
}

function drawFamily(ctx, f) {
  const born = Math.min(f.age / 0.5, 1);
  const pop = born < 1 ? 1 - Math.pow(1 - born, 3) * Math.cos(born * 8) : 1;
  const th = f.throwT / 0.28;
  const breathe = Math.sin(f.idle * 2.2) * 0.012;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(0, 0, 24 * pop, 8 * pop, 0, 0, Math.PI * 2); ctx.fill();
  if (born < 1) {
    ctx.strokeStyle = `rgba(255,236,150,${1 - born})`;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(0, 0, 18 + born * 50, 7 + born * 18, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.rotate(f.lean * Math.sin(th * Math.PI) * 0.12);
  ctx.scale(pop * (1 + th * 0.04), pop * (1 + breathe - th * 0.05));
  drawSpriteLayers(ctx, f.sprite, FAMILY_H, 1);
  ctx.restore();
}

// ───────────────── 투사체 ─────────────────
function updateProjectile(p, dt) {
  p.px = p.x; p.py = p.y; p.prot = p.rot;
  const tgt = p.target;
  if (tgt && !tgt.dead) {
    const ef = enemyFoot(tgt);
    p.tx = ef.x; p.ty = ef.y - ENEMY_H * 0.55;
  }
  p.t += dt / p.dur;
  const t = Math.min(p.t, 1);
  p.x = lerp(p.x0, p.tx, t);
  p.y = lerp(p.y0, p.ty, t) - p.arc * 4 * t * (1 - t);
  p.rot += p.spin * dt;
  if (p.t >= 1) {
    p.done = true;
    if (tgt) {
      tgt.pending = Math.max(0, tgt.pending - p.dmg);
      if (!tgt.dead) {
        tgt.hp -= p.dmg;
        tgt.hitT = 0.18;
        if (tgt.hp <= 0) killEnemy(tgt);
      }
    }
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2, sp = 80 + rand() * 110;
      particles.push({ scene: 'battle', x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 120,
        life: 0, max: 0.3 + rand() * 0.15, size: 5 + rand() * 4, color: rand() < 0.5 ? '#ffffff' : '#ffe27a', rot: 0, vr: 0 });
    }
  }
}

function drawProjectile(ctx, p, alpha) {
  const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha), r = lerp(p.prot, p.rot, alpha);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(r);
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

// ───────────────── 파티클 / 떠오르는 글씨 ─────────────────
function updateParticles(dt) {
  for (const p of particles) {
    p.life += dt;
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.vr * dt;
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
    ctx.fillStyle = p.color;
    if (p.flat) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (0.4 + Math.abs(Math.sin(p.life * 9 + p.vr))));
    else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
}

function drawFloaters(ctx) {
  for (const f of floaters) {
    const k = f.t;
    ctx.save();
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const y = f.y - easeOut(k) * 46;
    const s = 1 + Math.max(0, 0.25 - k) * 2;
    ctx.translate(f.x, y);
    ctx.scale(s, s);
    drawPixelCoin(ctx, -34, 0, 24);
    outlinedText(ctx, f.text, 10, 0, 30, '#ffe27a', '#3a2410');
    ctx.restore();
  }
}

// ───────────────── 웨이브 ─────────────────
function updateWaves(dt) {
  wave.banner = Math.max(0, wave.banner - dt);
  if (wave.mode === 'break') {
    wave.timer -= dt;
    if (wave.timer <= 0) {
      wave.n++;
      wave.toSpawn = 4 + wave.n * 2;
      wave.spawnTimer = 0;
      wave.mode = 'spawning';
      wave.banner = 2;
    }
    return;
  }
  wave.spawnTimer -= dt;
  const alive = enemies.filter(e => !e.dead).length;
  if (wave.spawnTimer <= 0 && alive < MAX_ENEMIES) {
    spawnEnemy();
    wave.toSpawn--;
    wave.spawnTimer = 2.4;
    if (wave.toSpawn <= 0) { wave.mode = 'break'; wave.timer = 7; }
  }
}

function drawWaveBanner(ctx) {
  if (wave.banner <= 0) return;
  const t = 2 - wave.banner;
  const a = t < 0.25 ? t / 0.25 : wave.banner < 0.4 ? wave.banner / 0.4 : 1;
  const s = t < 0.25 ? 0.6 + easeOut(t / 0.25) * 0.4 : 1;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(MAP_W / 2, 760);
  ctx.scale(s, s);
  outlinedText(ctx, `${wave.n} 웨이브`, 0, 0, 72, '#ffffff', '#3a2410', { shadow: '#f2c23a' });
  ctx.restore();
}

// ───────────────── 타워(집) 화면 ─────────────────
function houseRect() {
  const img = IMG.house;
  const h = HOUSE.w * img.height / img.width;
  return { x: HOUSE.cx - HOUSE.w / 2, y: HOUSE.bottom - h, w: HOUSE.w, h };
}

function buildHouse() {
  if (state.houseBuilt) return;
  state.houseBuilt = true;
  state.houseT = 0;
  residents.dad.sprite = makeSprite('dad_turn', true);
  residents.mom.sprite = makeSprite('mom_turn', true);
  updateUI();
}

const residents = {
  dad: { sprite: null, idle: 0.3 },
  mom: { sprite: null, idle: 0 },
};
const EMERGE_START = 1.25, EMERGE_DUR = 1.7;

function updateTower(dt) {
  if (!state.houseBuilt || state.scene !== 'tower') return;
  const before = state.houseT;
  state.houseT += dt;
  const t = state.houseT;
  if (before < 0.55 && t >= 0.55) {              // 착지: 먼지 + 흔들림 + 꽃가루
    shake = 0.3;
    const r = houseRect();
    for (let i = 0; i < 22; i++) {
      const side = rand() < 0.5 ? -1 : 1;
      particles.push({ scene: 'tower', x: HOUSE.cx + side * rand() * r.w * 0.5, y: HOUSE.bottom - 4, vx: side * (60 + rand() * 160), vy: -40 - rand() * 80, g: 120,
        life: 0, max: 0.7 + rand() * 0.4, size: 10 + rand() * 10, color: rand() < 0.5 ? '#e9dcb8' : '#cbb88a', rot: 0, vr: 0 });
    }
    const colors = ['#e8492f', '#f2c23a', '#5fd14a', '#4aa8f2', '#b05fe8', '#ff86ad', '#ffffff'];
    for (let i = 0; i < 90; i++) {
      const a = -Math.PI / 2 + (rand() - 0.5) * 1.9, sp = 260 + rand() * 360;
      particles.push({ scene: 'tower', x: HOUSE.cx + (rand() - 0.5) * 60, y: r.y + 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 420,
        life: 0, max: 1.6 + rand() * 0.9, size: 9 + rand() * 7, color: colors[i % colors.length], rot: rand() * 6, vr: (rand() - 0.5) * 14, flat: true });
    }
  }
  if (before < EMERGE_START + EMERGE_DUR && t >= EMERGE_START + EMERGE_DUR) {
    setSprite(residents.dad.sprite, 'dad_back_0', false, 0.3);
    setSprite(residents.mom.sprite, 'mom_back_0', false, 0.3);
  }
  for (const who of ['dad', 'mom']) {
    const r = residents[who];
    if (t > EMERGE_START + EMERGE_DUR + 0.2) {
      r.idle += dt;
      setSprite(r.sprite, `${who}_back_${Math.floor(r.idle / 1.3) % 2}`, false, 0.4);
    }
    tickSprite(r.sprite, dt);
  }
}

function drawTowerScene(ctx) {
  // 제목
  const tt = state.time;
  ctx.save();
  ctx.translate(MAP_W / 2, 262 + Math.sin(tt * 1.6) * 4);
  outlinedText(ctx, TITLE, 0, 0, 74, '#ffe94a', '#3b2a10', { shadow: '#1e1408' });
  ctx.restore();

  const r = houseRect();
  if (!state.houseBuilt) {                       // 집 지을 터
    const pulse = 0.55 + Math.sin(tt * 3) * 0.2;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(r.x, r.y + r.h * 0.3, r.w, r.h * 0.7);
    ctx.setLineDash([18, 12]);
    ctx.lineDashOffset = -tt * 30;
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fff6c9';
    ctx.strokeRect(r.x, r.y + r.h * 0.3, r.w, r.h * 0.7);
    ctx.restore();
    ctx.save();
    ctx.translate(HOUSE.cx, r.y + r.h * 0.65);
    ctx.fillStyle = '#fff6c9';
    ctx.globalAlpha = 0.9;
    ctx.fillRect(-8, -40, 16, 80);
    ctx.fillRect(-40, -8, 80, 16);
    ctx.restore();
    outlinedText(ctx, '여기에 집 짓기', HOUSE.cx, r.y + r.h * 0.3 - 34, 40, '#ffffff', '#3a2410');
    return;
  }

  const t = state.houseT;
  // 집: 위에서 떨어져 통통 튀며 착지
  const fall = Math.min(t / 0.55, 1);
  const dropY = (1 - easeOutBounce(fall)) * -420;
  const squash = t > 0.55 && t < 0.8 ? Math.sin((t - 0.55) / 0.25 * Math.PI) * 0.06 : 0;
  ctx.save();
  ctx.globalAlpha = Math.min(1, t / 0.12);
  ctx.translate(HOUSE.cx, HOUSE.bottom + dropY);
  ctx.scale(1 + squash, 1 - squash);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(0, -6, r.w * 0.52, 22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(IMG.house, -r.w / 2, -r.h, r.w, r.h);

  // 문이 열리는 연출 (엄마 아빠가 나오는 동안)
  const doorOpen = clamp((t - EMERGE_START + 0.25) / 0.25, 0, 1) * (1 - clamp((t - EMERGE_START - EMERGE_DUR + 0.3) / 0.4, 0, 1));
  if (doorOpen > 0) {
    ctx.fillStyle = `rgba(30,18,8,${0.85 * doorOpen})`;
    ctx.beginPath();
    ctx.roundRect(-r.w * 0.062, -r.h * 0.36, r.w * 0.124, r.h * 0.25, [r.w * 0.06, r.w * 0.06, 0, 0]);
    ctx.fill();
  }
  ctx.restore();

  // 이름표
  if (t > 0.55) {
    const k = clamp((t - 0.55) / 0.35, 0, 1);
    const s = k < 1 ? 0.5 + easeOutBounce(k) * 0.5 : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 3);
    ctx.translate(HOUSE.cx, r.y - 30);
    ctx.scale(s, s);
    outlinedText(ctx, HOUSE_LABEL, 0, 0, 46, '#ffffff', '#2b1d0e', { shadow: '#f2c23a' });
    ctx.restore();
  }

  // 엄마 아빠: 문에서 나와 양옆으로 걸어나온 뒤 집을 바라봄
  if (t > EMERGE_START) {
    const u = clamp((t - EMERGE_START) / EMERGE_DUR, 0, 1);
    const e = easeInOut(u);
    const doorX = HOUSE.cx, doorY = HOUSE.bottom - r.h * 0.07;
    const order = ['dad', 'mom'];
    for (const who of order) {
      const [tx, ty] = RESIDENT_SPOT[who];
      const x = lerp(doorX, tx, e), y = lerp(doorY, ty, e);
      const scale = lerp(0.32, 1, e);
      const walk = u < 1 ? Math.abs(Math.sin(u * Math.PI * 5)) * 8 * (1 - u) : 0;
      const breathe = u >= 1 ? Math.sin((t + (who === 'dad' ? 0.6 : 0)) * 2) * 0.01 : 0;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = `rgba(0,0,0,${0.2 * Math.min(1, u * 3)})`;
      ctx.beginPath(); ctx.ellipse(0, 0, 50 * scale, 13 * scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.translate(0, -walk);
      ctx.scale(scale, scale * (1 + breathe));
      drawSpriteLayers(ctx, residents[who].sprite, RESIDENT_H, Math.min(1, u * 2.2));
      ctx.restore();
    }
  }
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
    for (const f of family) list.push({ y: f.y, draw: () => drawFamily(ctx, f) });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.draw();
    for (const p of projectiles) drawProjectile(ctx, p, alpha);
    drawParticles(ctx, 'battle');
    drawFloaters(ctx);
    drawWaveBanner(ctx);
  } else {
    drawBackground('towerMap');
    worldTransform();
    drawTowerScene(ctx);
    drawParticles(ctx, 'tower');
  }
}

// ───────────────── UI (DOM) ─────────────────
const $ = id => document.getElementById(id);
const ui = { money: $('moneyVal'), family: $('familyBtn'), build: $('buildBtn'), go: $('goBtn'), toast: $('toast'), fade: $('fade') };
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
  if (sideRoom >= 190) {
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
  for (const el of [ui.family, ui.build]) {
    setBox(el, sq.cx, sq.top, sq.w, sq.h);
    el.style.fontSize = clamp(sq.h * 0.13, 13, 21) + 'px';
    // 버튼 크기 기준 여백 (아래는 테두리+입체 띠 두께만큼 확보)
    el.style.padding = `${Math.round(sq.h * 0.07)}px ${Math.round(sq.w * 0.06)}px ${Math.round(Math.max(13, sq.h * 0.09))}px`;
  }
}

let goScene = null;
function updateUI() {
  const battle = state.scene === 'battle';
  ui.family.classList.toggle('show', ready && battle);
  ui.build.classList.toggle('show', ready && !battle && !state.houseBuilt);
  ui.go.classList.toggle('show', ready);
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
  ui.money.textContent = state.money;
}

function bumpMoney() {
  ui.money.textContent = state.money;
  ui.money.classList.remove('bump');
  void ui.money.offsetWidth;
  ui.money.classList.add('bump');
  setTimeout(() => ui.money.classList.remove('bump'), 140);
  updateUI();
}

let toastTimer = 0;
function toast(msg, sec = 1.8) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), sec * 1000);
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
  if (state.money < cost) { shakeEl(ui.family); return; }
  state.money -= cost;
  spawnFamily();
  bumpMoney();
});

ui.build.addEventListener('click', () => { if (ready) buildHouse(); });

let switching = false;
let ready = false;
ui.go.addEventListener('click', () => {
  if (switching || !ready) return;
  switching = true;
  ui.fade.classList.add('on');
  setTimeout(() => {
    state.scene = state.scene === 'battle' ? 'tower' : 'battle';
    resize();
    updateUI();
    ui.fade.classList.remove('on');
    switching = false;
  }, 230);
});

canvas.addEventListener('pointerdown', ev => {
  if (!ready || state.scene !== 'tower' || state.houseBuilt) return;
  const wx = (ev.clientX - view.ox) / view.s, wy = (ev.clientY - view.oy) / view.s;
  const r = houseRect();
  if (wx > r.x - 20 && wx < r.x + r.w + 20 && wy > r.y && wy < r.y + r.h + 20) buildHouse();
});

// ───────────────── 루프 ─────────────────
function update(dt) {
  state.time += dt;
  shake = Math.max(0, shake - dt);
  updateWaves(dt);
  for (const e of enemies) updateEnemy(e, dt);
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead && enemies[i].deathT > 0.4) enemies.splice(i, 1);
  for (const f of family) updateFamily(f, dt);
  for (const p of projectiles) updateProjectile(p, dt);
  for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].done) projectiles.splice(i, 1);
  updateTower(dt);
  updateParticles(dt);
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

addEventListener('resize', resize);
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
window.__game = { state, enemies, family, projectiles, wave, buildHouse, spawnFamily, view };
