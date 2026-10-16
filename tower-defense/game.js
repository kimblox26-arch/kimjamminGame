'use strict';
// 가족 타워 디펜스 — 유튜브 '코테고리'의 가족 타워 디펜스 따라 만들기
//  전장: 잼민이(농부)가 맵 오른쪽 아래에서 계속 나와 흙길을 돈다. 가족이 던져 잡으면 돈.
//        가족은 끌어서 원하는 곳에 배치.
//  타워(집): 집을 끌어다 지으면 엄마·아빠가 걸어 나와 만세 → 전장으로.
//        대출이자를 갚으면 집이 무너지고 Lv.2 집으로 다시 지어지며 학교·상점·회사·분양소가 열린다.
//        타워 추가 = 아기 만들기, 엄마 강화, 잼민이 강화.
//  자리를 비우면 엄마는 담배, 아빠는 누워 쉬다가 들키면 화들짝.
//  로직은 1/60초 고정 스텝, 화면은 보간 렌더링.

const MAP_W = 688, MAP_H = 1529;       // 두 맵 이미지 크기 = 월드 좌표계
const STEP = 1 / 60;

const ENEMY_H = 128;                   // 잼민이 키(맵 픽셀)
const ENEMY_FRAME_RATE = 2.2;          // 초당 걷기 사진 전환 수
const FAMILY_H = 122;                  // 전장 가족 키(서 있을 때)
const RESIDENT_H = 400;                // 타워 화면 사람 키
const STD_H = 420;                     // 포즈 사진의 '서 있는 키' 픽셀 (tools/extract_poses.py, extract_round4.py)
const OLD_STD = new Set(['dad_back_0', 'dad_back_1', 'dad_turn', 'mom_back_0', 'mom_back_1', 'mom_turn']);
const START_MONEY = 10;
const MAX_ENEMIES = 26;

const PRICE = { loan: 1000, baby: 300, momUp: 300, enemyUp: 100, school: 300, shop: 400, company: 500, office: 800 };
const SALARY = 30, SALARY_EVERY = 6;   // 회사 월급(원) / 주기(초)

const HOUSE_LV = {
  1: { img: 'house', w: 400, label: 'Lv.1 대출이 반인 집', maxFamily: 2, door: { cx: 0.504, w: 0.14, top: 0.36, bot: 0.095 } },
  2: { img: 'house2', w: 470, label: 'Lv.2 대출이 절반밖에 안 남은 집', maxFamily: 3, door: { cx: 0.53, w: 0.105, top: 0.40, bot: 0.133 } },
};
const ENEMY_LV = {
  1: { hp: 10, reward: 5, prefix: 'farmer' },
  2: { hp: 20, reward: 10, prefix: 'farmer2' },     // 잼민이 강화: 체력 두 배, 잡는 수입 두 배
};
const UNIT = {
  mom: { dmg: 4, cooldown: 0.95, range: 210, proj: 'slipper' },
  dad: { dmg: 6, cooldown: 1.35, range: 230, proj: 'remote' },
  baby: { dmg: 3, cooldown: 0.8, range: 190, proj: 'bottle' },
};
const BUILDING = {
  school: { name: '학교', w: 140 },      // 가족 공격력 x1.5
  shop: { name: '상점', w: 135 },        // 잡는 수입 x1.5
  company: { name: '회사', w: 130 },     // 6초마다 월급 30원
  office: { name: '분양소', w: 140 },    // 가족 자리 +1
};
const SHOP_ITEMS = ['momUp', 'enemyUp', 'school', 'shop', 'company', 'office'];

// 흙길 중앙선 꼭짓점 (map.png 픽셀 분석값). 오른쪽 아래에서 출발해 시계 방향.
const PATH_CORNERS = [[566, 1094], [90, 1094], [90, 414], [566, 414]];
const CORNER_R = 52;
const PATH_HALF = 50;                  // 흙길 반폭(가족을 길 위에 못 놓게)

// 가족 기본 자리(발 위치). 안쪽 잔디밭 가장자리 — 어느 자리든 사거리 안에 길이 들어온다.
const FAMILY_SLOTS = [[475, 1020], [185, 1020], [330, 1020], [185, 560], [475, 560], [330, 560], [185, 790], [475, 790]];
const FAMILY_ENTRY_Y = 1235;           // 가족이 걸어 들어오기 시작하는 곳(길 아래 숲)

// 화면에 꼭 보여야 하는 영역(맵 좌표)
const NEED = {
  battle: { x0: 30, x1: 658, y0: 200, y1: 1480 },
  tower: { x0: 40, x1: 648, y0: 240, y1: 1480 },
};
// 버튼 자리(맵 좌표). 가족 생성 = 사용자가 네모로 그린 곳, 그 아래 이동 버튼.
const SLOT_SQ = { x0: 215, x1: 470, y0: 1205, y1: 1397 };
const SLOT_WIDE = { x0: 190, x1: 495, y0: 1412, y1: 1478 };
const FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

// ───────────────── 유틸 ─────────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {   // 구형 브라우저 대비
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);   // t가 a→b 사이 어디쯤인지 0~1
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

// 테두리 있는 글씨 (영상 자막처럼 진한 테두리 + 아래 입체 그림자)
function outlinedText(ctx, text, x, y, size, fill, stroke, opts = {}) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = opts.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (opts.maxW) {
    const w = ctx.measureText(text).width;
    if (w > opts.maxW) { size *= opts.maxW / w; ctx.font = `${size}px ${FONT}`; }
  }
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
  house2: 'assets/house2.png',
  rubble: 'assets/rubble.png',
  coin: 'assets/ui/coin.png',
  heart: 'assets/ui/heart.png',
};
for (const lv of ['farmer', 'farmer2']) for (const n of ['side_0', 'side_1', 'back_0', 'back_1', 'front_0', 'front_1']) IMAGE_LIST[`${lv}_${n}`] = `assets/characters/${lv}/${n}.png`;
const FAMILY_SPRITES = [
  'dad_back_0', 'dad_back_1', 'dad_turn', 'dad_cheer', 'dad_front_0', 'dad_front_1', 'dad_wave', 'dad_lunge', 'dad_rest', 'dad_out', 'dad_beg',
  'dad_walk_0', 'dad_walk_1', 'dad_walk_2', 'dad_walk_3',
  'mom_back_0', 'mom_back_1', 'mom_turn', 'mom_cheer', 'mom_front_0', 'mom_front_1', 'mom_hip', 'mom_hips', 'mom_smoke', 'mom_surprised',
  'mom2_front_0', 'mom2_front_1', 'baby',
];
for (const n of FAMILY_SPRITES) IMAGE_LIST[n] = `assets/characters/family/${n}.png`;
for (const n of ['school', 'shop', 'company', 'office', 'hand']) IMAGE_LIST['art_' + n] = svgURL(ART[n]);

function loadAssets() {
  return Promise.all(Object.entries(IMAGE_LIST).map(([k, src]) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => { IMG[k] = img; ok(); };
    img.onerror = () => fail(src);
    img.src = src;
  })));
}

// 사진 1장의 '서 있는 키' 픽셀. 누운 아빠·기어가는 아기처럼 키보다 작은 사진도 같은 사람 크기로 그려진다.
const stdOf = key => (key.startsWith('farmer') || OLD_STD.has(key) ? IMG[key].height : STD_H);

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

// 흙길 중앙선까지 가장 가까운 점
function nearestOnPath(x, y) {
  let best = null;
  for (let i = 1; i < PATH.pts.length; i++) {
    const [ax, ay] = PATH.pts[i - 1], [bx, by] = PATH.pts[i];
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
    const t = clamp(((x - ax) * vx + (y - ay) * vy) / l2, 0, 1);
    const px = ax + vx * t, py = ay + vy * t, d = Math.hypot(x - px, y - py);
    if (!best || d < best.d) best = { x: px, y: py, d };
  }
  return best;
}

// ───────────────── 상태 ─────────────────
const state = {
  scene: 'battle',
  money: START_MONEY,
  shownMoney: START_MONEY,   // 화면에 보이는 돈(부드럽게 따라감)
  time: 0,
  battleTime: 0,             // 적 생성 속도용 경과 시간
  away: false,               // 플레이어가 다른 창에 가 있음
  houseLevel: 0,             // 0 = 집 없음
  unlocked: {},              // 학교·상점·회사·분양소 잠금 해제
  enemyLevel: 1,
  momLevel: 1,
  familyTotal: 0,            // 만든 가족 수(오는 중 포함)
  built: { school: false, shop: false, company: false, office: false },
  salaryT: 0,
};
const house = { cx: 344, bottom: 985, tx: 344, tb: 985, lift: 0, tilt: 0, landT: 9, dropT: 9, landed: true, bounce: 0 };
const ghost = { cx: 344, bottom: 985, tx: 344, tb: 985, lift: 0, tilt: 0 };   // 짓기 전 끌어다 놓는 집
const buildings = [];       // { kind, cx, bottom, tx, tb, lift, tilt, age, bounce }
const enemies = [];
const family = [];
const projectiles = [];
const particles = [];       // { scene, x, y, vx, vy, g, life, max, size, color, rot, vr, shape }
const floaters = [];        // "+5원"
const effects = [];         // 휘두르기·타격 소용돌이·먼지 고리
const spawner = { timer: 2.2 };
let shake = 0;
let nextId = 1;
let cut = null;             // 타워 화면 연출 { kind, t, flags, actors }
const pillFx = { loan: { shake: 0, press: 0 }, add: { shake: 0, press: 0 } };

const maxFamily = () => (state.houseLevel ? HOUSE_LV[state.houseLevel].maxFamily : 0) + (state.built.office ? 1 : 0);
const lvInfo = () => HOUSE_LV[Math.max(1, state.houseLevel)];

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

// ───────────────── 감정 말풍선 ─────────────────
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
      ctx.beginPath(); ctx.roundRect(-4.5, -43, 9, 18, 4); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -18, 4.5, 0, Math.PI * 2); ctx.fill();
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
      for (let i = 0; i < 3; i++) if (t * 3 % 3 >= i) { ctx.beginPath(); ctx.arc(-11 + i * 11, -29, 3.6, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'heart':                               // 기쁨: 하트
      bubble(ctx);
      ctx.drawImage(IMG.heart, -14, -44, 28, 28);
      break;
  }
  ctx.restore();
}

// ───────────────── 잼민이 (적) ─────────────────
function spawnEnemy() {
  const level = state.enemyLevel;
  const hp = ENEMY_LV[level].hp;
  enemies.push({
    id: nextId++, level, dist: 0, prevDist: 0, hp, maxHp: hp, shownHp: hp, pending: 0,
    speed: (50 + Math.min(14, state.battleTime * 0.03)) * (0.9 + rand() * 0.2),
    age: 0, phase: rand() * 2, hitT: 0, kb: 0, dead: false, deathT: 0, fallDir: 1,
    pauseT: 0, nextPause: 5 + rand() * 9, emote: null,
    dir: 'side', sprite: makeSprite(`${ENEMY_LV[level].prefix}_side_0`),
  });
}

function enemyPose(e) {
  const p = pointAt(e.dist);
  const frame = Math.floor(e.phase) % 2;
  const pre = ENEMY_LV[e.level].prefix;
  if (Math.abs(p.dx) >= Math.abs(p.dy)) return { dir: 'side', key: `${pre}_side_${frame}`, flip: p.dx > 0 };
  const dir = p.dy < 0 ? 'back' : 'front';
  return { dir, key: `${pre}_${dir}_${frame}`, flip: false };
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
  e.nextPause -= dt;                                 // 가끔 멈춰서 두리번거림
  if (e.nextPause <= 0 && e.pauseT <= 0) { e.pauseT = 0.6 + rand() * 0.7; e.nextPause = 7 + rand() * 9; }
  if (e.pauseT > 0) { e.pauseT -= dt; speed *= 0.06; }
  for (const o of enemies) {                         // 앞사람과 너무 가까우면 속도를 줄여 줄을 선다
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

function killReward(e) { return Math.round(ENEMY_LV[e.level].reward * (state.built.shop ? 1.5 : 1)); }

function killEnemy(e, by) {
  e.dead = true; e.deathT = 0;
  e.fallDir = rand() < 0.5 ? -1 : 1;
  e.emote = null;
  const reward = killReward(e);
  state.money += reward;
  const f = enemyFoot(e);
  floaters.push({ scene: 'battle', x: f.x, y: f.y - ENEMY_H - 20, t: 0, text: `+${reward}원` });
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
    drawHpBar(ctx, f.x, f.y - ENEMY_H - 14, e.hp / e.maxHp, e.shownHp / e.maxHp, e.level);
    if (e.emote) drawEmote(ctx, e.emote, f.x, f.y - ENEMY_H - 4, 0.9);
  }
}

function drawHpBar(ctx, x, y, ratio, shown, level) {
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
  if (level > 1) {                                  // 강화된 잼민이: 레벨 표시
    ctx.fillStyle = '#e8302a';
    ctx.beginPath(); ctx.roundRect(x - w / 2 - 22, y - 4, 19, 17, 5); ctx.fill();
    ctx.strokeStyle = '#2b1d0e'; ctx.lineWidth = 2.5; ctx.stroke();
    outlinedText(ctx, String(level), x - w / 2 - 12.5, y + 4.5, 13, '#ffffff', '#2b1d0e');
  }
}

// ───────────────── 가족 (전장) ─────────────────
// 상태: walk(걸어/기어 들어옴) → arrive → idle ↔ windup → throw → recover
//       플레이어가 자리를 비우면 slack(엄마 담배 / 아빠 누움 / 아기 잠) → 돌아오면 notice(화들짝) → idle
//       끌고 있는 동안은 held
function freeSpot() {
  const taken = (x, y) => family.some(f => Math.hypot(f.slotX - x, f.slotY - y) < 60);
  for (const [x, y] of FAMILY_SLOTS) if (!taken(x, y)) return { x, y };
  for (let i = 0; i < 40; i++) {
    const x = 170 + rand() * 330, y = 540 + rand() * 480;
    if (!taken(x, y)) return { x, y };
  }
  return { x: 330, y: 800 };
}

function spawnUnit(type) {
  const s = freeSpot();
  const f = {
    id: nextId++, type, slotX: s.x, slotY: s.y, x: s.x, y: FAMILY_ENTRY_Y, px: s.x, py: FAMILY_ENTRY_Y,
    state: 'walk', t: 0, age: 0, cd: 0.5, walkPhase: 0, lean: 1, special: false, attacks: 0,
    idleAct: null, idleActT: 0, nextAct: 3 + rand() * 4, bored: 0, smokeT: 0, caughtT: 0, target: null,
    held: false, glowT: 0, emote: null, sprite: null,
  };
  f.sprite = makeSprite(keyFor(f, 'walk'));
  family.push(f);
  return f;
}

function famSet(f, s) { f.state = s; f.t = 0; }
const isMom2 = f => f.type === 'mom' && state.momLevel >= 2;

// 상황별 사진
function keyFor(f, what) {
  const t = f.type, m2 = isMom2(f);
  if (t === 'baby') return 'baby';
  switch (what) {
    case 'walk': return t === 'dad' ? `dad_walk_${Math.floor(f.walkPhase) % 4}` : `mom_back_${Math.floor(f.walkPhase) % 2}`;
    case 'idle':
      if (f.idleAct) return f.idleAct;
      if (t === 'dad') return ['dad_out', 'dad_front_1', 'dad_out'][Math.floor(f.age / 2.6) % 3];
      return m2 ? `mom2_front_${Math.floor(f.age / 2.2) % 2}` : `mom_front_${Math.floor(f.age / 1.7) % 2}`;
    case 'windup': return t === 'dad' ? 'dad_wave' : m2 ? 'mom2_front_1' : 'mom_hips';
    case 'throw': return t === 'dad' ? (f.special ? 'dad_lunge' : 'dad_front_1') : m2 ? 'mom2_front_0' : 'mom_surprised';
    case 'slack': return t === 'dad' ? 'dad_rest' : 'mom_smoke';
    case 'notice': return t === 'dad' ? 'dad_wave' : m2 ? 'mom2_front_1' : 'mom_surprised';
  }
  return 'dad_out';
}
function idleActFor(f) {
  if (f.type === 'baby') return null;
  if (f.type === 'dad') return f.bored > 5 ? 'dad_front_0' : pick(['dad_wave', 'dad_front_0', 'dad_front_1']);
  if (isMom2(f)) return 'mom2_front_1';
  return f.bored > 5 ? 'mom_hips' : pick(['mom_hip', 'mom_hips']);
}

function dmgOf(f) {
  let d = UNIT[f.type].dmg;
  if (isMom2(f)) d *= 2;
  if (state.built.school) d *= 1.5;
  if (f.special) d *= 1.6;
  return Math.round(d);
}

function findTarget(f) {
  const st = UNIT[f.type];
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

function startSlack(f) {
  famSet(f, 'slack');
  f.idleAct = null;
  f.smokeT = 0;
  if (f.type !== 'mom') setEmote(f, 'zzz', 9999);
  else f.emote = null;
}

function releaseThrow(f) {
  const st = UNIT[f.type];
  const tgt = f.target;
  f.cd = st.cooldown * (0.9 + rand() * 0.2);
  if (!tgt || tgt.dead) return;
  const ef = enemyFoot(tgt);
  f.lean = Math.sign(ef.x - f.x) || 1;
  const dmg = dmgOf(f);
  tgt.pending += dmg;
  const hgt = f.type === 'baby' ? 0.4 : f.special ? 0.55 : 0.82;
  const sx = f.x + f.lean * 20, sy = f.y - FAMILY_H * hgt;
  const dist = Math.hypot(ef.x - sx, ef.y - ENEMY_H * 0.55 - sy);
  projectiles.push({
    kind: st.proj, target: tgt, dmg, by: f,
    x0: sx, y0: sy, tx: ef.x, ty: ef.y - ENEMY_H * 0.55,
    t: 0, dur: clamp(dist / 480, 0.28, 0.6), arc: Math.min(90, dist * 0.35),
    x: sx, y: sy, px: sx, py: sy, rot: 0, prot: 0, spin: (rand() < 0.5 ? -1 : 1) * (10 + rand() * 6),
    trail: [], big: f.special || isMom2(f),
  });
  effects.push({ type: 'swoosh', x: f.x + f.lean * 6, y: f.y - FAMILY_H * (hgt - 0.04), dir: f.lean, t: 0, dur: 0.22, r: f.type === 'baby' ? 22 : 34, scene: 'battle' });
}

function updateFamily(f, dt) {
  f.px = f.x; f.py = f.y;
  f.t += dt; f.age += dt;
  f.glowT = Math.max(0, f.glowT - dt);
  tickEmote(f, dt);
  if (f.held) { tickSprite(f.sprite, dt); return; }
  if (f.state !== 'walk' && f.state !== 'slack' && f.state !== 'notice' && state.away) startSlack(f);
  switch (f.state) {
    case 'walk': {                                 // 사진을 넘기며 자기 자리로 걸어감 (아빠 걷기 사진 4장, 아기는 기어감)
      const sp = f.type === 'baby' ? 85 : 150;
      const dx = f.slotX - f.x, dy = f.slotY - f.y, d = Math.hypot(dx, dy), step = sp * dt;
      if (d <= step) { f.x = f.slotX; f.y = f.slotY; famSet(f, 'arrive'); setEmote(f, 'note', 1.1); }
      else { f.x += dx / d * step; f.y += dy / d * step; }
      f.walkPhase += dt * (f.type === 'dad' ? 7.5 : f.type === 'baby' ? 3 : 4);
      setSprite(f.sprite, keyFor(f, 'walk'), false, 0);
      break;
    }
    case 'arrive':                                 // 뒤돌아 앞을 봄
      setSprite(f.sprite, keyFor(f, 'idle'), false, 0.25);
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
        f.idleAct = idleActFor(f);
        f.idleActT = 1.4 + rand();
        f.nextAct = 4 + rand() * 5;
        if (f.bored > 5 && !f.emote) setEmote(f, 'dots', 1.8);
      }
      if (f.idleAct && (f.idleActT -= dt) <= 0) f.idleAct = null;
      setSprite(f.sprite, keyFor(f, 'idle'), false, 0.35);
      break;
    }
    case 'windup':                                 // 팔을 뒤로 젖혀 준비
      setSprite(f.sprite, keyFor(f, 'windup'), false, 0.08);
      if (f.t >= 0.2) { releaseThrow(f); famSet(f, 'throw'); }
      break;
    case 'throw':                                  // 던지는 순간
      setSprite(f.sprite, keyFor(f, 'throw'), f.special && f.lean > 0, 0.06);
      if (f.t >= (f.special ? 0.5 : 0.26)) famSet(f, 'recover');
      break;
    case 'recover':
      setSprite(f.sprite, keyFor(f, 'idle'), false, 0.2);
      if (f.t >= 0.22) famSet(f, 'idle');
      break;
    case 'slack':                                  // 플레이어가 없는 동안 땡땡이
      setSprite(f.sprite, keyFor(f, 'slack'), false, 0.3);
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
      setSprite(f.sprite, keyFor(f, 'notice'), false, 0.1);
      if (f.t >= 1.0) { famSet(f, 'idle'); f.cd = Math.min(f.cd, 0.2); }
      break;
  }
  tickSprite(f.sprite, dt);
}

function famPose(f) {
  let hop = 0, rot = 0, sx = 1, sy = 1, ox = 0;
  const t = f.t, baby = f.type === 'baby';
  if (f.held) return { hop: 18 + Math.sin(f.age * 9) * 3, rot: Math.sin(f.age * 7) * 0.05, sx: 1.06, sy: 1.06, ox: 0 };
  switch (f.state) {
    case 'walk':
      if (baby) { rot = Math.sin(f.walkPhase * Math.PI) * 0.07; ox = Math.sin(f.walkPhase * Math.PI) * 3; hop = Math.abs(Math.sin(f.walkPhase * Math.PI)) * 3; }
      else hop = Math.abs(Math.sin(f.walkPhase * Math.PI)) * (f.type === 'dad' ? 2 : 5);
      break;
    case 'arrive': hop = Math.sin(Math.min(t / 0.35, 1) * Math.PI) * 14; break;
    case 'idle':
      if (baby) { rot = Math.sin(f.age * 1.8) * 0.04; sy = 1 + Math.sin(f.age * 3.6) * 0.02; }
      else { sy = 1 + Math.sin(f.age * 2.4) * 0.012; if (f.idleAct === 'dad_wave') rot = Math.sin(f.age * 7) * 0.03; }
      break;
    case 'windup': { const k = Math.min(t / 0.2, 1); rot = -f.lean * (baby ? 0.18 : 0.1) * easeOut(k); sy = 1 + 0.05 * k; sx = 1 - 0.03 * k; break; }
    case 'throw':
      if (f.special) { const a = Math.sin(Math.min(t / 0.5, 1) * Math.PI); hop = a * 42; ox = f.lean * a * 36; }
      else {
        const k = Math.min(t / 0.12, 1); rot = f.lean * (baby ? 0.22 : 0.16) * (1 - k * 0.5);
        sx = 1 + 0.07 * (1 - k); sy = 1 - 0.07 * (1 - k);
        if (baby) ox = f.lean * Math.sin(Math.min(t / 0.26, 1) * Math.PI) * 10;
      }
      break;
    case 'recover': rot = f.lean * 0.08 * (1 - t / 0.22); break;
    case 'slack':
      if (baby) { sy = 0.9 + Math.sin(f.age * 1.6) * 0.02; sx = 1.04; }
      else { rot = f.type === 'mom' ? Math.sin(f.age * 1.2) * 0.02 : 0; sy = 1 + Math.sin(f.age * 1.6) * 0.02; }
      break;
    case 'notice':
      if (t < 0.42) hop = Math.sin(t / 0.42 * Math.PI) * 34;
      else if (t < 0.6) { const k = (t - 0.42) / 0.18; sy = 1 - Math.sin(k * Math.PI) * 0.08; sx = 1 + Math.sin(k * Math.PI) * 0.06; }
      rot = Math.sin(t * 30) * 0.03 * Math.max(0, 1 - t * 2);
      break;
  }
  return { hop, rot, sx, sy, ox };
}

const EMOTE_ANCHOR = { dad_rest: [-0.28, 0.78], dad_lunge: [-0.3, 0.95], dad_beg: [0, 0.8] };
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
  if (f.held) {                                      // 끄는 중: 사거리 원
    const r = UNIT[f.type].range;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 10]);
    ctx.lineDashOffset = -state.time * 30;
    ctx.beginPath(); ctx.arc(x, y - FAMILY_H * 0.6, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(x + ox, y);
  const shs = 1 - Math.min(hop, 40) / 80;
  ctx.fillStyle = `rgba(0,0,0,${0.22 * born})`;
  ctx.beginPath(); ctx.ellipse(0, 0, 24 * shs, 8 * shs, 0, 0, Math.PI * 2); ctx.fill();
  if (f.glowT > 0) {                                 // 강화 직후 반짝임
    const k = f.glowT / 2.5;
    ctx.strokeStyle = `rgba(255,236,150,${k})`;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(0, 0, 30 + (1 - k) * 30, 10 + (1 - k) * 10, 0, 0, Math.PI * 2); ctx.stroke();
  }
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
  p.x = lerp(p.x0, p.tx, t);
  p.y = lerp(p.y0, p.ty, t) - p.arc * 4 * t * (1 - t);
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
  } else if (p.kind === 'remote') {     // 아빠: 리모컨
    ctx.fillStyle = '#3d4148';
    ctx.beginPath(); ctx.roundRect(-7, -16, 14, 32, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8492f'; ctx.fillRect(-3, -11, 6, 5);
    ctx.fillStyle = '#c9ced6'; ctx.fillRect(-4, -2, 3, 3); ctx.fillRect(1, -2, 3, 3); ctx.fillRect(-4, 4, 3, 3); ctx.fillRect(1, 4, 3, 3);
  } else {                              // 아기: 젖병
    ctx.fillStyle = 'rgba(235,245,255,0.95)';
    ctx.beginPath(); ctx.roundRect(-8, -8, 16, 22, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fffbe8'; ctx.fillRect(-6, 2, 12, 10);
    ctx.fillStyle = '#5fb4f0'; ctx.beginPath(); ctx.roundRect(-9, -13, 18, 6, 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffb46b'; ctx.beginPath(); ctx.ellipse(0, -16, 4.5, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
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
function coinBurst(scene, x, y, n = 6) {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.6, sp = 160 + rand() * 160;
    particles.push({ scene, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 600, life: 0, max: 0.8 + rand() * 0.3, size: 22, rot: 0, vr: 0, shape: 'coin' });
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    p.life += dt;
    if (p.life < 0) continue;
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
    if (p.scene !== scene || p.life < 0) continue;
    const k = 1 - p.life / p.max;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.shape === 'round') {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(0, 0, p.size * (1 + (p.grow || 0) * (1 - k)), 0, Math.PI * 2); ctx.fill();
    } else if (p.shape === 'coin') {
      ctx.globalAlpha = Math.min(1, k * 3);
      ctx.drawImage(IMG.coin, -p.size / 2, -p.size / 2, p.size, p.size);
    } else if (p.shape === 'heart') {
      ctx.globalAlpha = Math.min(1, k * 2);
      const s = p.size * (0.6 + (1 - k) * 0.6);
      ctx.drawImage(IMG.heart, -s / 2, -s / 2, s, s);
    } else if (p.shape === 'cig') {               // 떨어지는 담배꽁초
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-6, -2, 9, 4);
      ctx.fillStyle = '#e8a050'; ctx.fillRect(3, -2, 4, 4);
      ctx.fillStyle = '#ff5a2a'; ctx.fillRect(-7, -1.5, 2, 3);
    } else if (p.shape === 'chunk') {             // 무너지는 집 조각
      ctx.fillStyle = p.color;
      ctx.strokeStyle = 'rgba(40,20,8,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66, 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      if (p.flat) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (0.4 + Math.abs(Math.sin(p.life * 9 + p.vr))));
      else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }
}

function drawFloaters(ctx, scene) {
  for (const f of floaters) {
    if (f.scene !== scene) continue;
    const k = f.t;
    ctx.save();
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const y = f.y - easeOut(k) * 46;
    const s = (k < 0.18 ? easeOutBack(k / 0.18) : 1) * (f.big ? 1.4 : 1);
    ctx.translate(f.x, y);
    ctx.scale(s, s);
    ctx.font = `30px ${FONT}`;
    const tw = ctx.measureText(f.text).width;
    ctx.drawImage(IMG.coin, -tw / 2 - 34, -14, 28, 28);
    outlinedText(ctx, f.text, 0, 0, 30, '#ffe94a', '#3a2410', { shadow: '#a86a10' });
    ctx.restore();
  }
}

// ───────────────── 잼민이 생성 (웨이브 없이 계속) ─────────────────
function updateSpawner(dt) {
  state.battleTime += dt;
  spawner.timer -= dt;
  if (spawner.timer > 0) return;
  const alive = enemies.filter(e => !e.dead).length;
  if (alive >= MAX_ENEMIES) { spawner.timer = 0.5; return; }
  // 앞 잼민이와 겹치지 않도록 출발점 근처가 비었을 때만
  if (enemies.some(e => !e.dead && ((e.dist % PATH.len) + PATH.len) % PATH.len < 44)) { spawner.timer = 0.3; return; }
  spawnEnemy();
  spawner.timer = Math.max(0.95, 1.9 - state.battleTime * 0.004) * (0.85 + rand() * 0.3);
}

// ───────────────── 타워(집) 화면: 위치 ─────────────────
function houseSize(lv = Math.max(1, state.houseLevel)) {
  const L = HOUSE_LV[lv], img = IMG[L.img];
  return { w: L.w, h: L.w * img.height / img.width };
}
function houseRectOf(o, lv) {
  const { w, h } = houseSize(lv);
  return { x: o.cx - w / 2, y: o.bottom - h, w, h };
}
function doorPoint() {
  const L = lvInfo(), { w, h } = houseSize();
  return { x: house.cx + (L.door.cx - 0.5) * w, y: house.bottom - L.door.bot * h };
}
function loanRect() { const r = houseRectOf(house); return { x: house.cx - 150, y: r.y - 172, w: 300, h: 96 }; }
function addRect() { return { x: house.cx - 150, y: house.bottom + 18, w: 300, h: 84 }; }
function buildingSize(kind) { const img = IMG['art_' + kind], w = BUILDING[kind].w; return { w, h: w * img.height / img.width }; }
function buildingRect(b) { const { w, h } = buildingSize(b.kind); return { x: b.cx - w / 2, y: b.bottom - h, w, h }; }

// 타워 화면에서 물건을 놓을 수 있는 영역(맵 좌표): 위 돈 표시 아래 ~ 아래 버튼 위
function towerBounds() {
  const s = view.s;
  const topPx = (view.moneyBottom || 60) + 8;
  const botPx = view.side ? view.ch - 10 : (view.shopTop || view.ch) - 8;
  return {
    x0: Math.max(0, -view.ox / s), x1: Math.min(MAP_W, (view.cw - view.ox) / s),
    y0: Math.max(0, (topPx - view.oy) / s), y1: Math.min(MAP_H, (botPx - view.oy) / s),
  };
}
function clampHouse(cx, bottom, lv) {
  const b = towerBounds(), { w, h } = houseSize(lv);
  const minX = b.x0 + w / 2 + 6, maxX = b.x1 - w / 2 - 6;
  const minB = b.y0 + h + 178, maxB = b.y1 - 106;       // 위: 이름표·대출이자 판 / 아래: 타워 추가 판
  return {
    cx: minX < maxX ? clamp(cx, minX, maxX) : (b.x0 + b.x1) / 2,
    bottom: minB < maxB ? clamp(bottom, minB, maxB) : (minB + maxB) / 2,
  };
}
function clampBuilding(kind, cx, bottom) {
  const b = towerBounds(), { w, h } = buildingSize(kind);
  return { cx: clamp(cx, b.x0 + w / 2, Math.max(b.x0 + w / 2, b.x1 - w / 2)), bottom: clamp(bottom, b.y0 + h, Math.max(b.y0 + h, b.y1)) };
}
function refitHouse() {
  const c = clampHouse(house.tx, house.tb);
  house.tx = c.cx; house.tb = c.bottom;
}
// 화면 크기가 바뀌어도 집·건물이 화면 안에 있도록
function fitHouseToView() {
  if (state.scene !== 'tower' || !ready) return;
  const g = clampHouse(ghost.tx, ghost.tb, 1);
  ghost.tx = ghost.cx = g.cx; ghost.tb = ghost.bottom = g.bottom;
  if (state.houseLevel) refitHouse();
  for (const b of buildings) { const c = clampBuilding(b.kind, b.tx, b.tb); b.tx = c.cx; b.tb = c.bottom; }
}

function follow(o, dt) {                            // 끄는 물건이 손가락을 부드럽게 따라옴
  const k = Math.min(1, dt * 16);
  const vx = (o.tx - o.cx) * k;
  o.cx += vx; o.bottom += (o.tb - o.bottom) * k;
  o.tilt = lerp(o.tilt, clamp(vx * 0.02, -0.12, 0.12), Math.min(1, dt * 10));
  o.lift = lerp(o.lift, drag && drag.obj === o ? 1 : 0, Math.min(1, dt * 12));
}

// ───────────────── 집 짓기 / 건물 ─────────────────
function buildHouse() {
  if (state.houseLevel) return;
  state.houseLevel = 1;
  state.familyTotal = Math.max(state.familyTotal, 2);   // 엄마·아빠
  house.cx = house.tx = ghost.tx;
  house.bottom = house.tb = ghost.tb;
  refitHouse();
  house.cx = house.tx; house.bottom = house.tb;
  startCut('build');
}

function addBuilding(kind) {
  state.built[kind] = true;
  const b0 = towerBounds(), { w, h } = buildingSize(kind);
  // 집·이름표·판·다른 건물과 겹치지 않는 빈자리를 찾고, 그중 집에서 가까운 곳
  const hr = houseRectOf(house), lw = Math.max(hr.w + 60, 420);
  const busy = [
    { x: hr.x, y: hr.y, w: hr.w, h: hr.h + 110 },                               // 집 + 타워 추가 판
    { x: house.cx - Math.max(lw, 300) / 2, y: hr.y - (state.houseLevel === 1 ? 178 : 64), w: Math.max(lw, 300), h: state.houseLevel === 1 ? 178 : 64 },  // 이름표(+대출이자 판)
    ...buildings.map(buildingRect),
  ];
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  let best = null;
  for (let cx = b0.x0 + w / 2; cx <= b0.x1 - w / 2 + 0.1; cx += 16) {
    for (let bot = b0.y0 + h; bot <= b0.y1 + 0.1; bot += 16) {
      const r = { x: cx - w / 2 - 6, y: bot - h - 6, w: w + 12, h: h + 12 };
      const score = busy.reduce((acc, o) => acc + overlap(r, o), 0) * 1000 + Math.hypot(cx - house.cx, bot - h / 2 - (hr.y + hr.h / 2));
      if (!best || score < best.score) best = { cx, bot, score };
    }
  }
  const c = clampBuilding(kind, best ? best.cx : house.cx, best ? best.bot : b0.y1);
  buildings.push({ kind, cx: c.cx, bottom: c.bottom, tx: c.cx, tb: c.bottom, lift: 0, tilt: 0, age: 0, bounce: 0 });
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

function breakHouse() {                             // 와르르: 집 조각이 튀고 먼지
  shake = 0.45;
  const r = houseRectOf(house, 1);
  const colors = ['#d9472b', '#b8402a', '#8a5428', '#f3e6c4', '#9a9a9a', '#6b3d1f'];
  for (let i = 0; i < 46; i++) {
    const x = r.x + rand() * r.w, y = r.y + rand() * r.h * 0.85;
    particles.push({ scene: 'tower', x, y, vx: (x - house.cx) * 2.4 + (rand() - 0.5) * 220, vy: -260 - rand() * 420, g: 1100,
      life: 0, max: 0.9 + rand() * 0.5, size: 10 + rand() * 18, color: pick(colors), rot: rand() * 6, vr: (rand() - 0.5) * 16, shape: 'chunk' });
  }
  for (let i = 0; i < 34; i++) {
    const a = rand() * Math.PI * 2;
    particles.push({ scene: 'tower', x: house.cx + Math.cos(a) * r.w * 0.4 * rand(), y: house.bottom - rand() * r.h * 0.5, vx: Math.cos(a) * (60 + rand() * 140), vy: -30 - rand() * 90, g: 40,
      life: 0, max: 1.0 + rand() * 0.6, size: 14 + rand() * 14, color: 'rgba(225,215,190,0.85)', rot: 0, vr: 0, shape: 'round', grow: 1.6 });
  }
  effects.push({ type: 'ring', x: house.cx, y: house.bottom - 4, t: 0, dur: 0.6, r: r.w * 0.7, scene: 'tower' });
}

function payCoins(from, to) {                       // 동전이 집으로 쏙
  for (let i = 0; i < 14; i++) {
    particles.push({ scene: 'tower', sx: from.x + 50 + rand() * 40, sy: from.y + from.h / 2, tx: to.x + (rand() - 0.5) * 40, ty: to.y,
      arc: 60 + rand() * 60, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: -i * 0.05, max: 0.7, size: 30, rot: 0, vr: 0, shape: 'coin' });
  }
}

// ───────────────── 타워 화면 연출 (컷신) ─────────────────
// 다른 화면으로 가면 즉시 끝까지 진행된 것으로 처리(finish)한다.
const once = key => (cut.flags[key] ? false : (cut.flags[key] = true));
function startCut(kind) { cut = { kind, t: 0, flags: {}, actors: {} }; updateUI(); }
function actor(name, key) {
  if (!cut.actors[name]) cut.actors[name] = { sprite: makeSprite(key), x: 0, y: 0, scale: 1, alpha: 1, hop: 0, rot: 0, flip: false, emote: null, label: null, labelT: 0, show: false };
  return cut.actors[name];
}
function endCut() {
  const k = cut.kind;
  CUTS[k].finish();
  cut = null;
  updateUI();
}
function finishCut() { if (cut) endCut(); }
function updateCut(dt) {
  cut.t += dt;
  for (const a of Object.values(cut.actors)) { tickSprite(a.sprite, dt); tickEmote(a, dt); a.labelT += dt; }
  CUTS[cut.kind].update(cut.t);
  if (cut && cut.t >= CUTS[cut.kind].len) endCut();
}
const walkSprite = (a, who, t, lv2 = false) => {   // 앞을 보고 손동작 없이 걷기
  if (who === 'dad') setSprite(a.sprite, 'dad_out', Math.floor(t * 4) % 2 === 1, 0.08);
  else setSprite(a.sprite, `${lv2 ? 'mom2' : 'mom'}_front_${Math.floor(t * 4) % 2}`, false, 0.08);
};

const BANNER_ITEMS = ['school', 'shop', 'company', 'office'];
const CUTS = {
  // 집이 떨어짐 → 엄마 아빠가 걸어 나옴 → 돌아서서 만세 → 전장으로 걸어감
  build: {
    len: 6.4,
    update(t) {
      if (once('drop')) { house.dropT = 0; house.landed = false; }
      const D = doorPoint(), { w } = houseSize();
      const spots = { dad: { x: house.cx - w * 0.27, y: house.bottom + 112 }, mom: { x: house.cx + w * 0.29, y: house.bottom + 112 } };
      for (const who of ['dad', 'mom']) {
        const a = actor(who, who === 'dad' ? 'dad_out' : 'mom_front_0'), P = spots[who];
        a.show = t >= 1.25;
        if (!a.show) continue;
        if (t < 2.75) {
          const u = seg(t, 1.25, 2.75), e = easeInOut(u);
          a.x = lerp(D.x, P.x, e); a.y = lerp(D.y, P.y, e); a.scale = lerp(0.32, 1, e); a.alpha = Math.min(1, u * 3);
          a.hop = Math.abs(Math.sin(t * Math.PI * 4)) * 8 * (1 - u * 0.5);
          walkSprite(a, who, t);
        } else if (t < 3.05) {
          a.x = P.x; a.y = P.y; a.scale = 1; a.alpha = 1; a.hop = 0;
          setSprite(a.sprite, `${who}_turn`, false, 0.12);
        } else if (t < 4.85) {
          if (once('cheer_' + who)) {
            setEmote(a, who === 'dad' ? 'note' : 'heart', 1.6);
            if (who === 'mom') confettiBurst(house.cx, houseRectOf(house).y + 30, 60);
          }
          setSprite(a.sprite, `${who}_cheer`, false, 0.1);
          a.hop = Math.abs(Math.sin((t - 3.05) * Math.PI * 2.2)) * 34;
        } else {                                    // 전장으로 출발
          const u = seg(t, 4.85, 6.3);
          a.y = P.y + u * u * 560; a.x = P.x;
          a.hop = Math.abs(Math.sin(t * Math.PI * 4)) * 8;
          a.alpha = 1 - seg(u, 0.55, 1);
          walkSprite(a, who, t);
        }
      }
    },
    finish() {
      house.dropT = Math.max(house.dropT, 1); house.landed = true;
      if (!family.some(f => f.type === 'dad')) spawnUnit('dad');
      if (!family.some(f => f.type === 'mom')) spawnUnit('mom');
    },
  },

  // 대출이자 갚기: 동전 → 흔들흔들 → 와르르 무너짐 → Lv.2 집이 떨어짐 → 건물 4개 잠금 해제
  upgrade: {
    len: 7.2,
    update(t) {
      if (once('coins')) { const r = houseRectOf(house); payCoins(loanRect(), { x: house.cx, y: r.y + r.h * 0.6 }); }
      if (t >= 1.5 && once('break')) breakHouse();
      if (t >= 2.9 && once('lv2')) { state.houseLevel = 2; house.dropT = 0; house.landed = false; refitHouse(); updateUI(); }
      if (t >= 3.8 && once('banners')) showBanners();
      if (t >= 6.2 && once('fly')) flyBanners();
    },
    finish() {
      if (state.houseLevel < 2) { state.houseLevel = 2; refitHouse(); }
      house.dropT = Math.max(house.dropT, 1); house.landed = true;
      clearBanners();
      for (const k of BANNER_ITEMS) state.unlocked[k] = true;
    },
  },

  // 타워 추가 = 아기 만들기: 엄마는 문 앞에서 "싫어", 아빠는 엎드려 빌고 → 하트 → 아기가 기어 나옴 → 전장으로
  baby: {
    len: 7.2,
    update(t) {
      const D = doorPoint();
      const inT = seg(t, 2.2, 2.8);
      const m = actor('mom', state.momLevel >= 2 ? 'mom2_front_1' : 'mom_surprised');
      m.show = t < 2.8;
      m.x = D.x + (t > 0.4 && t < 2.2 ? Math.sin(t * 16) * 5 : 0); m.y = D.y + 4;
      m.scale = lerp(0.5, 0.2, easeIn(inT)); m.alpha = Math.min(1, t / 0.3) * (1 - inT);
      if (t >= 0.3 && once('mAngry')) setEmote(m, 'angry', 1.9);
      const d = actor('dad', 'dad_beg');
      d.show = t < 2.8;
      const front = { x: D.x, y: D.y + 120 };
      d.x = front.x; d.y = lerp(front.y, D.y, easeIn(inT));
      d.scale = lerp(0.75, 0.2, easeIn(inT)); d.alpha = seg(t, 0.2, 0.5) * (1 - inT);
      d.hop = t < 0.6 ? Math.sin(seg(t, 0.2, 0.6) * Math.PI) * 18 : 0;
      d.rot = 0; d.sy = 1 - Math.max(0, Math.sin((t - 0.6) * 9)) * 0.1 * (t > 0.6 && t < 2.2 ? 1 : 0);   // 엎드려 비는 동작
      if (t >= 0.8 && once('dSweat')) setEmote(d, 'sweat', 1.2);
      if (t >= 1.7 && once('dHeart')) setEmote(d, 'heart', 1.0);
      if (t >= 2.9 && t < 4.3 && Math.floor(t / 0.22) !== Math.floor((t - STEP) / 0.22)) {
        const r = houseRectOf(house);
        particles.push({ scene: 'tower', x: house.cx + (rand() - 0.5) * r.w * 0.6, y: r.y + r.h * 0.3, vx: (rand() - 0.5) * 30, vy: -70 - rand() * 50, g: -10,
          life: 0, max: 1.3, size: 30 + rand() * 18, rot: (rand() - 0.5) * 0.6, vr: 0, shape: 'heart' });
      }
      const b = actor('baby', 'baby');
      b.show = t >= 4.4;
      if (b.show) {
        const P = { x: D.x, y: house.bottom + 120 };
        const u = seg(t, 4.4, 6.0), e = easeInOut(u);
        b.x = lerp(D.x, P.x, e) + Math.sin(t * 8) * 4; b.y = lerp(D.y, P.y, e);
        b.scale = lerp(0.3, 0.85, e); b.alpha = Math.min(1, u * 3);
        b.rot = Math.sin(t * 8) * 0.07; b.hop = Math.abs(Math.sin(t * 8)) * 3;
        if (t >= 4.6 && once('bLabel')) { b.label = 'Lv.1 애기'; b.labelT = 0; }
        if (t >= 5.2 && once('bNote')) setEmote(b, 'note', 1.3);
        if (t >= 6.0) { const v = seg(t, 6.0, 7.2); b.y = P.y + v * v * 480; b.alpha = 1 - seg(v, 0.5, 1); }
      }
    },
    finish() { spawnUnit('baby'); },
  },

  // 엄마 강화: 엄마가 집에 들어감 → 어둠 속 푸른 기운 + 붉은 마법진 → 번쩍 → 새 앞치마 Lv.2 엄마가 나옴
  momUp: {
    len: 6.9,
    update(t) {
      const D = doorPoint();
      const m = actor('mom', 'mom_back_0');
      if (t < 1.35) {
        const u = seg(t, 0, 1.35), e = easeInOut(u);
        m.show = true;
        m.x = lerp(D.x + 40, D.x, e); m.y = lerp(house.bottom + 300, D.y + 4, e);
        m.scale = lerp(1, 0.4, e); m.alpha = 1 - seg(u, 0.75, 1);
        m.hop = Math.abs(Math.sin(t * Math.PI * 4)) * 8;
        setSprite(m.sprite, `mom_back_${Math.floor(t * 4) % 2}`, false, 0.08);
      } else if (t < 4.3) {
        m.show = false;
      } else {
        if (once('m2')) { m.sprite = makeSprite('mom2_front_0'); m.label = 'Lv.2 엄마'; m.labelT = 0; }
        m.show = true;
        const P = { x: D.x, y: house.bottom + 125 };
        const u = seg(t, 4.3, 5.6), e = easeInOut(u);
        m.x = lerp(D.x, P.x, e); m.y = lerp(D.y, P.y, e); m.scale = lerp(0.4, 1, e); m.alpha = Math.min(1, u * 3);
        m.hop = t < 5.6 ? Math.abs(Math.sin(t * Math.PI * 4)) * 6 : Math.sin(seg(t, 5.6, 6.0) * Math.PI) * 30;
        if (t < 5.6) walkSprite(m, 'mom', t, true); else setSprite(m.sprite, 'mom2_front_0', false, 0.12);
        if (t >= 4.9 && once('mHeart')) setEmote(m, 'heart', 1.6);
        if (t >= 6.0) {
          const v = seg(t, 6.0, 6.9);
          m.y = P.y + v * v * 480; m.alpha = 1 - seg(v, 0.5, 1);
          m.hop = Math.abs(Math.sin(t * Math.PI * 4)) * 6;
          walkSprite(m, 'mom', t, true);
        }
      }
      if (t >= 3.9 && once('lv')) state.momLevel = 2;
    },
    finish() {
      state.momLevel = 2;
      for (const f of family) if (f.type === 'mom') { f.glowT = 2.5; setEmote(f, 'heart', 2.5); }
    },
  },
};

function cutDark() { return cut && cut.kind === 'momUp' ? seg(cut.t, 1.3, 1.7) * (1 - seg(cut.t, 3.9, 4.3)) : 0; }
function doorOpen() {
  if (!cut) return 0;
  const t = cut.t, win = (a, b) => seg(t, a, a + 0.25) * (1 - seg(t, b - 0.3, b));
  switch (cut.kind) {
    case 'build': return win(1.0, 2.9);
    case 'baby': return Math.max(win(2.05, 2.95), win(4.15, 5.9));
    case 'momUp': return Math.max(win(0.85, 1.45), win(4.05, 5.2));
  }
  return 0;
}

// 잠금 해제 안내 (영상처럼 보라색 띠) → 해당 버튼으로 날아가 잠금이 풀림
const BANNER_TEXT = { school: '학교를 지을 수 있습니다', shop: '상점을 지을 수 있습니다', company: '회사를 지을 수 있습니다', office: '분양소를 지을 수 있습니다' };
function showBanners() {
  clearBanners();
  const w = Math.min(view.cw * 0.72, 380);
  BANNER_ITEMS.forEach((k, i) => {
    const el = document.createElement('div');
    el.className = 'banner ' + (i % 2 ? 'from-right' : 'from-left');
    el.textContent = BANNER_TEXT[k];
    el.dataset.item = k;
    el.style.width = w + 'px';
    el.style.fontSize = clamp(w * 0.085, 16, 30) + 'px';
    el.style.left = (i % 2 ? view.cw - w - view.cw * 0.04 : view.cw * 0.04) + 'px';
    el.style.top = (view.ch * 0.17 + i * Math.min(88, view.ch * 0.12)) + 'px';
    el.style.animationDelay = (i * 0.18) + 's';
    ui.banners.appendChild(el);
  });
}
function flyBanners() {
  [...ui.banners.children].forEach((el, i) => {
    const card = cardEls[el.dataset.item];
    const a = el.getBoundingClientRect(), b = card.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = el.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.18)`, opacity: 0.3 },
    ], { duration: 560, delay: i * 90, easing: 'cubic-bezier(.55,0,.8,.2)', fill: 'forwards' });
    anim.onfinish = () => {
      el.remove();
      state.unlocked[el.dataset.item] = true;
      bump(card);
      updateUI();
    };
  });
}
function clearBanners() { ui.banners.innerHTML = ''; }

// ───────────────── 타워 화면: 진행 ─────────────────
function tapLoan() {
  pillFx.loan.press = 0.15;
  if (state.money < PRICE.loan) { pillFx.loan.shake = 0.4; shakeEl(ui.moneyBox); return; }
  state.money -= PRICE.loan;
  startCut('upgrade');
}
function canAddFamily() { return state.houseLevel > 0 && state.familyTotal < maxFamily(); }
function tapAdd() {
  pillFx.add.press = 0.15;
  if (!canAddFamily()) { pillFx.add.shake = 0.4; return; }
  if (state.money < PRICE.baby) { pillFx.add.shake = 0.4; shakeEl(ui.moneyBox); return; }
  state.money -= PRICE.baby;
  state.familyTotal++;
  startCut('baby');
}

function updateTower(dt) {
  for (const o of [house, ghost, ...buildings]) follow(o, dt);
  house.landT += dt;
  house.bounce = Math.max(0, house.bounce - dt);
  for (const b of buildings) {
    const was = b.age;
    b.age += dt; b.bounce = Math.max(0, b.bounce - dt);
    if (was < 0.5 && b.age >= 0.5) {               // 건물이 떨어져 착지
      effects.push({ type: 'ring', x: b.cx, y: b.bottom - 4, t: 0, dur: 0.45, r: buildingSize(b.kind).w * 0.6, scene: 'tower' });
      b.bounce = 0.3;
    }
  }
  for (const fx of Object.values(pillFx)) { fx.shake = Math.max(0, fx.shake - dt); fx.press = Math.max(0, fx.press - dt); }
  if (state.scene !== 'tower') return;
  house.dropT += dt;
  if (!house.landed && house.dropT >= 0.55) { house.landed = true; landBurst(true); }
  if (cut) updateCut(dt);
}

function updateEconomy(dt) {
  if (!state.built.company) return;
  state.salaryT += dt;
  if (state.salaryT < SALARY_EVERY) return;
  state.salaryT -= SALARY_EVERY;
  state.money += SALARY;                            // 회사 월급
  const b = buildings.find(o => o.kind === 'company');
  if (b) {
    const r = buildingRect(b);
    floaters.push({ scene: 'tower', x: b.cx, y: r.y - 6, t: 0, text: `+${SALARY}원` });
    coinBurst('tower', b.cx, r.y + r.h * 0.4, 5);
    b.bounce = 0.3;
  }
}

// ───────────────── 타워 화면: 그리기 ─────────────────
function drawHouseImg(ctx, o, img, w, h, alpha, ghostMode, squash = 0) {
  const lift = o.lift;
  ctx.save();
  ctx.translate(o.cx, o.bottom);
  ctx.fillStyle = `rgba(0,0,0,${(0.2 - lift * 0.08) * alpha})`;           // 그림자 (들어 올리면 커지고 옅어짐)
  ctx.beginPath(); ctx.ellipse(0, -6, w * (0.52 + lift * 0.06), 22 + lift * 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(0, -lift * 26);
  ctx.rotate(o.tilt);
  const s = 1 + lift * 0.05;
  ctx.scale(s * (1 + squash), s * (1 - squash));
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -w / 2, -h, w, h);
  if (ghostMode) {                                  // 반짝임
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * (0.18 + Math.sin(state.time * 3) * 0.1);
    ctx.drawImage(img, -w / 2, -h, w, h);
  }
  ctx.restore();
}

function drawBuilding(ctx, b) {
  const img = IMG['art_' + b.kind], { w, h } = buildingSize(b.kind);
  const drop = b.age < 0.5 ? (1 - easeOutBounce(b.age / 0.5)) * -300 : 0;
  const sq = b.bounce > 0 ? Math.sin(b.bounce / 0.3 * Math.PI) * 0.07 : 0;
  ctx.save();
  ctx.translate(0, drop);
  ctx.globalAlpha = Math.min(1, b.age / 0.1);
  drawHouseImg(ctx, b, img, w, h, 1, false, sq);
  ctx.restore();
}

function drawRubble(ctx, t) {
  const img = IMG.rubble, w = HOUSE_LV[1].w * 1.12, h = w * img.height / img.width;
  const pop = t < 1.7 ? lerp(0.85, 1, easeOutBack(seg(t, 1.5, 1.7))) : 1;
  ctx.save();
  ctx.globalAlpha = 1 - seg(t, 2.9, 3.2);
  ctx.translate(house.cx, house.bottom + 12);
  ctx.scale(pop, pop);
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}

function drawHouseNow(ctx) {
  const t = cut ? cut.t : 0, up = cut && cut.kind === 'upgrade';
  if (up && t >= 1.5 && t < 3.2) drawRubble(ctx, t);
  if (up && t >= 1.5 && t < 2.9) return;           // 무너진 동안은 집이 없음
  const { w, h } = houseSize();
  const drop = house.dropT < 0.55 ? (1 - easeOutBounce(house.dropT / 0.55)) * -420 : 0;
  let jitter = 0, rot = 0, beat = 0;
  if (up && t < 1.5) { const k = seg(t, 0.7, 1.5); jitter = Math.sin(t * 61) * 5 * k; rot = Math.sin(t * 47) * 0.03 * k; }
  if (cut && cut.kind === 'baby' && t >= 2.8 && t < 4.4) beat = Math.abs(Math.sin((t - 2.8) * 9)) * 0.035;
  const land = house.landT < 0.3 ? Math.sin(house.landT / 0.3 * Math.PI) * 0.05 : 0;
  const tap = house.bounce > 0 ? Math.sin(house.bounce / 0.3 * Math.PI) * 0.05 : 0;
  const sq = (house.dropT > 0.55 && house.dropT < 0.8 ? Math.sin((house.dropT - 0.55) / 0.25 * Math.PI) * 0.06 : 0) + land + tap;
  ctx.save();
  ctx.translate(house.cx + jitter, house.bottom + drop);
  ctx.rotate(rot);
  ctx.scale(1 + sq + beat, 1 - sq + beat);
  ctx.translate(-house.cx, -house.bottom);
  ctx.globalAlpha = Math.min(1, house.dropT / 0.12);
  drawHouseImg(ctx, house, IMG[lvInfo().img], w, h, 1, false);
  const open = doorOpen();
  if (open > 0) {                                    // 문이 열림
    const L = lvInfo().door;
    ctx.translate(house.cx + (L.cx - 0.5) * w, house.bottom - house.lift * 26);
    ctx.fillStyle = `rgba(30,18,8,${0.88 * open})`;
    const dw = L.w * w, top = L.top * h, bot = L.bot * h;
    ctx.beginPath(); ctx.roundRect(-dw / 2, -top, dw, top - bot, [dw / 2, dw / 2, 0, 0]); ctx.fill();
  }
  ctx.restore();
}

function drawPill(ctx, r, title, value, fx, opts = {}) {
  const sh = fx.shake > 0 ? Math.sin(fx.shake * 60) * 8 * (fx.shake / 0.4) : 0;
  const press = fx.press > 0 ? 1 - Math.sin(fx.press / 0.15 * Math.PI) * 0.06 : 1;
  const pop = opts.pop ?? 1;
  if (pop <= 0) return;
  ctx.save();
  ctx.translate(r.x + r.w / 2 + sh, r.y + r.h / 2);
  ctx.scale(press * pop, press * pop);
  ctx.globalAlpha = Math.min(1, pop * 1.5);
  ctx.fillStyle = 'rgba(20,40,8,0.45)';
  ctx.beginPath(); ctx.roundRect(-r.w / 2, -r.h / 2, r.w, r.h, r.h / 2); ctx.fill();
  const cs = r.h * 0.62;
  ctx.drawImage(IMG.coin, -r.w / 2 + r.h * 0.5 - cs / 2, -cs / 2, cs, cs);
  const tx = r.h * 0.3;
  outlinedText(ctx, title, tx, -r.h * 0.19, r.h * 0.3, opts.titleColor || '#ffffff', '#2b1d0e', { shadow: '#a86a10', maxW: r.w - r.h * 1.3 });
  outlinedText(ctx, value, tx, r.h * 0.23, r.h * 0.36, opts.valueColor || '#ffe94a', '#2b1d0e', { shadow: '#a86a10' });
  ctx.restore();
}

function drawAura(ctx, k, kc, t) {
  const { w, h } = houseSize();
  const cx = house.cx, cy = house.bottom - h * 0.45;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  if (k > 0) {                                       // 푸른 기운 + 빛줄기
    const R = w * 1.05;
    const g = ctx.createRadialGradient(cx, cy, w * 0.15, cx, cy, R);
    g.addColorStop(0, `rgba(160,215,255,${0.5 * k})`);
    g.addColorStop(0.35, `rgba(60,140,255,${0.28 * k})`);
    g.addColorStop(1, 'rgba(20,60,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.95, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * Math.PI * 2 + t * 0.4 + Math.sin(i * 7.3) * 0.2;
      const len = R * (0.75 + 0.35 * Math.sin(t * 6 + i * 2.1));
      const wd = 0.05 + 0.03 * Math.sin(t * 4 + i);
      ctx.fillStyle = `rgba(120,190,255,${0.16 * k})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a - wd) * len, cy + Math.sin(a - wd) * len);
      ctx.lineTo(cx + Math.cos(a + wd) * len, cy + Math.sin(a + wd) * len);
      ctx.closePath(); ctx.fill();
    }
  }
  if (kc > 0) {                                      // 붉은 마법진 + 빛기둥
    for (let i = 0; i < 8; i++) {
      const x = cx + (Math.sin(i * 12.9898) * 0.5) * w * 1.3;
      const a = (0.25 + 0.35 * Math.abs(Math.sin(t * 7 + i * 3.1))) * kc;
      const g2 = ctx.createLinearGradient(0, house.bottom, 0, house.bottom - 520);
      g2.addColorStop(0, `rgba(255,60,50,${a})`); g2.addColorStop(1, 'rgba(255,60,50,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(x - 2.5, house.bottom - 520, 5, 520);
    }
    ctx.translate(cx, house.bottom + 8);
    ctx.scale(1, 0.32);
    const R = w * 0.8 * (0.6 + 0.4 * easeOut(kc));
    ctx.shadowColor = 'rgba(255,40,40,0.9)';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = `rgba(255,80,70,${0.95 * kc})`;
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2); ctx.stroke();
    ctx.rotate(t * 0.6);
    for (let i = 0; i < 48; i++) {                  // 룬처럼 보이는 눈금
      const a = i / 48 * Math.PI * 2;
      ctx.lineWidth = i % 4 ? 2 : 4;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88); ctx.lineTo(Math.cos(a) * R * (i % 4 ? 0.94 : 0.98), Math.sin(a) * R * (i % 4 ? 0.94 : 0.98)); ctx.stroke();
    }
    ctx.lineWidth = 4;
    for (let k2 = 0; k2 < 2; k2++) {                // 육각별
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = k2 * Math.PI / 3 + i * Math.PI * 2 / 3 - Math.PI / 2;
        const x = Math.cos(a) * R * 0.84, y = Math.sin(a) * R * 0.84;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawActors(ctx) {
  if (!cut) return;
  const list = Object.values(cut.actors).filter(a => a.show && a.alpha > 0).sort((a, b) => a.y - b.y);
  for (const a of list) {
    ctx.save();
    ctx.translate(a.x, a.y);
    const shs = a.scale * (1 - Math.min(a.hop, 60) / 140);
    ctx.fillStyle = `rgba(0,0,0,${0.2 * a.alpha})`;
    ctx.beginPath(); ctx.ellipse(0, 0, 50 * shs, 13 * shs, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, -a.hop);
    ctx.save();
    ctx.rotate(a.rot);
    ctx.scale(a.scale, a.scale * (a.sy || 1));
    drawSpriteLayers(ctx, a.sprite, RESIDENT_H, a.alpha);
    ctx.restore();
    const top = spriteSize(a.sprite.cur.key, RESIDENT_H).h * a.scale;
    if (a.label && a.alpha > 0.3) {                  // "Lv.1 애기" 같은 이름표
      const k = seg(a.labelT, 0, 0.35);
      ctx.save();
      ctx.globalAlpha = a.alpha;
      ctx.translate(0, -top - 40);
      const s = k < 1 ? 0.5 + easeOutBounce(k) * 0.5 : 1;
      ctx.scale(s, s);
      outlinedText(ctx, a.label, 0, 0, 44, '#ffffff', '#2b1d0e', { shadow: '#f2c23a' });
      ctx.restore();
    }
    if (a.emote && a.alpha > 0.5) {
      const an = emoteAnchor(a.sprite, RESIDENT_H * a.scale);
      drawEmote(ctx, a.emote, an.x, a.label ? an.y - 70 : an.y, 1.5);
    }
    ctx.restore();
  }
}

function drawTowerScene(ctx) {
  if (!state.houseLevel) {                          // 끌어다 놓을 집 + 끄는 손 그림
    const img = IMG.house, { w, h } = houseSize(1);
    drawHouseImg(ctx, ghost, img, w, h, 0.62 + Math.sin(state.time * 2.4) * 0.08, true);
    if (!drag) {
      const k = (state.time % 2.2) / 2.2;
      const r = houseRectOf(ghost, 1);
      const press = k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1;
      const mv = easeInOut(clamp((k - 0.2) / 0.5, 0, 1));
      const hs = 70 - press * 6;
      ctx.save();
      ctx.globalAlpha = Math.min(1, press * 1.5);
      ctx.drawImage(IMG.art_hand, r.x + r.w * 0.6 + mv * 60, r.y + r.h * 0.55 - mv * 40 + (1 - press) * 10, hs, hs * 110 / 96);
      ctx.restore();
    }
    return;
  }

  const dark = cutDark();
  if (dark > 0) {                                   // 엄마 강화: 어둠 속에 집만 빛남
    for (const b of buildings) drawBuilding(ctx, b);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(2,3,8,${0.94 * dark})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const t = cut.t;
    drawAura(ctx, seg(t, 1.7, 2.4) * (1 - seg(t, 3.9, 4.2)), seg(t, 2.5, 2.9) * (1 - seg(t, 3.9, 4.2)), t);
    drawHouseNow(ctx);
  } else {
    const items = buildings.map(b => ({ y: b.bottom, draw: () => drawBuilding(ctx, b) }));
    items.push({ y: house.bottom, draw: () => drawHouseNow(ctx) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
  }

  // 이름표 + 대출이자 / 타워 추가 판
  const broken = cut && cut.kind === 'upgrade' && cut.t >= 1.5 && cut.t < 2.9;
  const k = seg(house.dropT, 0.55, 0.9);
  if (k > 0 && !broken) {
    const r = houseRectOf(house);
    const s = k < 1 ? 0.5 + easeOutBounce(k) * 0.5 : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 3);
    ctx.translate(house.cx, r.y - 36 - house.lift * 26);
    ctx.scale(s, s);
    outlinedText(ctx, lvInfo().label, 0, 0, 44, '#ffffff', '#2b1d0e', { shadow: '#f2c23a', maxW: Math.max(r.w + 60, 420) });
    ctx.restore();
  }
  if (!cut) {
    const pk = seg(house.dropT, 0.8, 1.15);
    if (state.houseLevel === 1) drawPill(ctx, loanRect(), '대출이자 갚기', String(PRICE.loan), pillFx.loan,
      { pop: pk < 1 ? easeOutBack(pk) : 1, titleColor: '#ffe94a', valueColor: state.money >= PRICE.loan ? '#ffe94a' : '#ffd0a0' });
    const full = !canAddFamily();
    drawPill(ctx, addRect(), `타워 추가 ${state.familyTotal}/${maxFamily()}`, full ? '최대' : String(PRICE.baby), pillFx.add,
      { pop: pk < 1 ? easeOutBack(pk) : 1, valueColor: full ? '#d8d8d8' : state.money >= PRICE.baby ? '#ffe94a' : '#ffd0a0' });
  }

  // 아기 만들기: 지붕 위 큰 하트
  if (cut && cut.kind === 'baby' && cut.t >= 2.85 && cut.t < 4.5) {
    const t = cut.t, r = houseRectOf(house);
    const pop = easeOutBack(seg(t, 2.85, 3.15)) * (1 - seg(t, 4.2, 4.5));
    const beat = 1 + Math.abs(Math.sin((t - 2.85) * 9)) * 0.12;
    const s = 120 * pop * beat;
    ctx.drawImage(IMG.heart, house.cx - s / 2, r.y - 40 - s, s, s);
  }

  drawActors(ctx);

  if (cut && cut.kind === 'momUp' && cut.t >= 3.9 && cut.t < 4.35) {   // 번쩍
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(255,255,255,${1 - seg(cut.t, 3.9, 4.35)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
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
    for (const f of family) list.push({ y: lerp(f.py, f.y, alpha) + (f.held ? 2000 : 0), draw: () => drawFamily(ctx, f, alpha) });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.draw();
    drawEffects(ctx, 'battle');
    for (const p of projectiles) drawProjectile(ctx, p, alpha);
    drawParticles(ctx, 'battle');
    drawFloaters(ctx, 'battle');
  } else {
    drawBackground('towerMap');
    worldTransform();
    drawEffects(ctx, 'tower');
    drawTowerScene(ctx);
    drawParticles(ctx, 'tower');
    drawFloaters(ctx, 'tower');
  }
}

// ───────────────── UI (DOM) ─────────────────
const $ = id => document.getElementById(id);
const ui = {
  money: $('moneyVal'), moneyBox: $('money'), family: $('familyBtn'), go: $('goBtn'), shop: $('shop'),
  banners: $('banners'), toast: $('toast'), fade: $('fade'),
};
document.querySelectorAll('[data-svg]').forEach(el => { el.innerHTML = ART[el.dataset.svg]; });

// 상점 카드 (사진·직접 그린 그림 아이콘)
const CARD = {
  momUp: { name: '엄마 강화', pic: 'photo mom2' },
  enemyUp: { name: '잼민이 강화', pic: 'photo farmer2' },
  school: { name: '학교', art: 'school' },
  shop: { name: '상점', art: 'shop' },
  company: { name: '회사', art: 'company' },
  office: { name: '분양소', art: 'office' },
};
const cardEls = {};
for (const item of SHOP_ITEMS) {
  const c = CARD[item];
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'card';
  el.dataset.item = item;
  el.innerHTML = `<span class="pic ${c.pic || 'art'}">${c.art ? ART[c.art] : ''}</span>
    <span class="txt"><b class="nm">${c.name}</b><span class="cost"><img class="coin" src="assets/ui/coin.png" alt=""><span class="cv">${PRICE[item]}</span></span></span>
    <i class="lock">${ART.lock}</i><i class="check">${ART.check}</i>`;
  el.addEventListener('click', () => buy(item));
  ui.shop.appendChild(el);
  cardEls[item] = el;
}

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
  view.side = sideRoom >= 190;
  let wide, sq, shop;
  if (view.side) {
    // 가로 화면: 맵 오른쪽 숲에 버튼을 세로로 쌓는다 (길을 가리지 않게)
    const cx = mapRight + sideRoom / 2;
    const ww = Math.min(sideRoom - 28, 280);
    wide = { cx, w: ww, h: 52 };
    wide.top = bottom - wide.h;
    const sh = clamp(Math.min(wide.top - 24, ww * 0.8), 104, 176);
    sq = { cx, w: clamp(sh * 1.3, 128, Math.min(ww, 230)), h: sh, top: wide.top - 12 - sh };
    const cardH = clamp((wide.top - 80) / 3 - 8, 46, 58);
    shop = { cx, w: ww, cols: 2, rows: 3, cardH, h: cardH * 3 + 16 };
    shop.top = wide.top - 12 - shop.h;
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
    const cardH = clamp(view.ch * 0.068, 48, 60);
    shop = { cx: view.cw / 2, w: Math.min(view.cw - 20, 460), cols: 3, rows: 2, cardH, h: cardH * 2 + 8 };
    shop.top = wide.top - 10 - shop.h;
  }
  setBox(ui.go, wide.cx, wide.top, wide.w, wide.h);
  ui.go.style.fontSize = clamp(wide.h * 0.4, 15, 23) + 'px';
  setBox(ui.family, sq.cx, sq.top, sq.w, sq.h);
  ui.family.style.fontSize = clamp(sq.h * 0.13, 13, 21) + 'px';
  ui.family.style.padding = `${Math.round(sq.h * 0.07)}px ${Math.round(sq.w * 0.06)}px ${Math.round(Math.max(13, sq.h * 0.09))}px`;
  setBox(ui.shop, shop.cx, shop.top, shop.w, shop.h);
  ui.shop.style.gridTemplateColumns = `repeat(${shop.cols}, minmax(0, 1fr))`;
  ui.shop.style.gridTemplateRows = `repeat(${shop.rows}, ${shop.cardH}px)`;
  ui.shop.style.setProperty('--ch', shop.cardH + 'px');
  ui.shop.style.fontSize = clamp(shop.w / shop.cols * 0.095, 11, 16) + 'px';
  ui.moneyBox.style.fontSize = clamp(view.cw * 0.07, 22, 34) + 'px';
  view.shopTop = shop.top;
  view.sqTop = sq.top;
  view.moneyBottom = ui.moneyBox.getBoundingClientRect().bottom || 60;
}

function cardState(item) {
  if (item === 'momUp') return !state.houseLevel ? 'locked' : state.momLevel >= 2 ? 'done' : cut ? 'busy' : 'ok';
  if (item === 'enemyUp') return state.enemyLevel >= 2 ? 'done' : 'ok';
  return !state.unlocked[item] ? 'locked' : state.built[item] ? 'done' : 'ok';
}

let goScene = null, goLevel = null;
function updateUI() {
  const battle = state.scene === 'battle';
  ui.family.classList.toggle('show', ready && battle);
  ui.go.classList.toggle('show', ready);
  ui.moneyBox.classList.toggle('show', ready);
  ui.shop.classList.toggle('show', ready && !battle && state.houseLevel > 0 && !(cut && cut.kind === 'build'));
  if (goScene !== state.scene || goLevel !== state.houseLevel) {
    goScene = state.scene; goLevel = state.houseLevel;
    ui.go.classList.toggle('to-tower', battle);
    ui.go.classList.toggle('to-battle', !battle);
    ui.go.querySelector('.label').textContent = battle ? '타워로 가기' : '전장으로 가기';
    const pic = ui.go.querySelector('.pic');
    pic.className = 'pic ' + (battle ? (state.houseLevel >= 2 ? 'house2' : 'house1') : 'farmer');
  }
  // 가족 생성(= 타워 추가, 아기 만들기)
  const full = state.houseLevel > 0 && !canAddFamily();
  ui.family.classList.toggle('locked', !state.houseLevel || full);
  ui.family.classList.toggle('poor', state.houseLevel > 0 && !full && state.money < PRICE.baby);
  ui.family.querySelector('.costVal').textContent = !state.houseLevel ? '집이 필요해요' : full ? '최대' : `${PRICE.baby}원`;
  ui.family.querySelector('.count').textContent = state.houseLevel ? `${state.familyTotal}/${maxFamily()}` : '';
  for (const item of SHOP_ITEMS) {
    const el = cardEls[item], st = cardState(item);
    el.classList.toggle('locked', st === 'locked');
    el.classList.toggle('done', st === 'done');
    el.classList.toggle('busy', st === 'busy');
    el.classList.toggle('poor', st === 'ok' && state.money < PRICE[item]);
    el.querySelector('.cv').textContent = st === 'done' ? (item === 'momUp' || item === 'enemyUp' ? 'Lv.2' : '완공') : PRICE[item];
  }
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

function buy(item) {
  if (!ready || state.scene !== 'tower') return;
  const el = cardEls[item];
  if (cardState(item) !== 'ok') { shakeEl(el); return; }
  if (state.money < PRICE[item]) { shakeEl(el); shakeEl(ui.moneyBox); return; }
  state.money -= PRICE[item];
  if (item === 'momUp') startCut('momUp');
  else if (item === 'enemyUp') state.enemyLevel = 2;
  else addBuilding(item);
  bump(el);
  updateUI();
}

// 전장의 가족 생성 버튼 = 타워 추가(아기). 아기가 숲에서 기어 들어온다.
ui.family.addEventListener('click', () => {
  if (!ready) return;
  if (!state.houseLevel) {                           // 글 대신 버튼 흔들기 + 타워 버튼 강조
    shakeEl(ui.family);
    ui.go.classList.remove('nudge'); void ui.go.offsetWidth; ui.go.classList.add('nudge');
    return;
  }
  if (!canAddFamily()) { shakeEl(ui.family); return; }
  if (state.money < PRICE.baby) { shakeEl(ui.family); shakeEl(ui.moneyBox); return; }
  state.money -= PRICE.baby;
  state.familyTotal++;
  spawnUnit('baby');
  updateUI();
});

let switching = false;
let ready = false;
ui.go.addEventListener('click', () => {
  if (switching || !ready) return;
  switching = true;
  endDrag();
  finishCut();                                       // 연출 중이면 끝난 것으로 처리
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

// ───────────────── 끌어서 배치 (전장: 가족 / 타워: 집·건물) ─────────────────
let drag = null;
function toWorld(ev) { return { x: (ev.clientX - view.ox) / view.s, y: (ev.clientY - view.oy) / view.s }; }
function hitRect(r, p, pad = 0) { return p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad; }

function unitRect(f) {
  const { w, h } = spriteSize(f.sprite.cur.key, FAMILY_H);
  const ww = Math.max(w, 56);
  return { x: f.x - ww / 2, y: f.y - h, w: ww, h: h + 12 };
}
function battleLimits() {
  const s = view.s;
  const top = Math.max(FAMILY_H + 20, (view.moneyBottom + 10 - view.oy) / s + FAMILY_H * 0.9);
  const botPx = view.side ? view.ch - 10 : view.sqTop - 6;
  return { x0: 24, x1: MAP_W - 24, y0: top, y1: Math.min(MAP_H - 20, (botPx - view.oy) / s) };
}
function onPath(x, y) { return nearestOnPath(x, y).d < PATH_HALF + 4; }
function placeUnit(x, y) {                          // 흙길 위에는 못 놓음 → 가장 가까운 잔디로 밀어냄
  const L = battleLimits();
  x = clamp(x, L.x0, L.x1); y = clamp(y, L.y0, L.y1);
  const n = nearestOnPath(x, y);
  if (n.d < PATH_HALF + 4) {
    let dx = x - n.x, dy = y - n.y, d = Math.hypot(dx, dy);
    if (d < 1) { dx = 344 - n.x; dy = 754 - n.y; d = Math.hypot(dx, dy); }
    x = n.x + dx / d * (PATH_HALF + 8); y = n.y + dy / d * (PATH_HALF + 8);
    x = clamp(x, L.x0, L.x1); y = clamp(y, L.y0, L.y1);
  }
  return { x, y };
}

canvas.addEventListener('pointerdown', ev => {
  comeBack();
  if (!ready || switching) return;
  const p = toWorld(ev);
  if (state.scene === 'battle') {
    const hit = [...family].sort((a, b) => b.y - a.y).find(f => hitRect(unitRect(f), p));
    if (!hit) return;
    hit.held = true;
    hit.emote = null;
    drag = { kind: 'unit', obj: hit, dx: p.x - hit.x, dy: p.y - hit.y, sx: p.x, sy: p.y, moved: 0 };
    canvas.setPointerCapture(ev.pointerId);
    return;
  }
  // 타워 화면
  if (!state.houseLevel) {
    if (!hitRect(houseRectOf(ghost, 1), p, 10)) return;
    drag = { kind: 'ghost', obj: ghost, dx: p.x - ghost.cx, dy: p.y - ghost.bottom, sx: p.x, sy: p.y, moved: 0 };
    canvas.setPointerCapture(ev.pointerId);
    return;
  }
  if (!cut) {
    if (state.houseLevel === 1 && house.landed && hitRect(loanRect(), p)) { tapLoan(); return; }
    if (hitRect(addRect(), p)) { tapAdd(); return; }
  }
  const b = [...buildings].sort((a, c) => c.bottom - a.bottom).find(o => hitRect(buildingRect(o), p));
  if (b) {
    drag = { kind: 'building', obj: b, dx: p.x - b.cx, dy: p.y - b.bottom, sx: p.x, sy: p.y, moved: 0 };
    canvas.setPointerCapture(ev.pointerId);
    return;
  }
  if (!cut && house.landed && hitRect(houseRectOf(house), p, 10)) {
    drag = { kind: 'house', obj: house, dx: p.x - house.cx, dy: p.y - house.bottom, sx: p.x, sy: p.y, moved: 0 };
    canvas.setPointerCapture(ev.pointerId);
  }
});

canvas.addEventListener('pointermove', ev => {
  if (!drag) return;
  const p = toWorld(ev);
  drag.moved = Math.max(drag.moved, Math.hypot(p.x - drag.sx, p.y - drag.sy) * view.s);
  const o = drag.obj;
  if (drag.kind === 'unit') {
    const L = battleLimits();
    o.x = o.px = clamp(p.x - drag.dx, L.x0, L.x1);
    o.y = o.py = clamp(p.y - drag.dy, L.y0, L.y1);
  } else if (drag.kind === 'building') {
    const c = clampBuilding(o.kind, p.x - drag.dx, p.y - drag.dy);
    o.tx = c.cx; o.tb = c.bottom;
  } else {
    const c = clampHouse(p.x - drag.dx, p.y - drag.dy, drag.kind === 'ghost' ? 1 : undefined);
    o.tx = c.cx; o.tb = c.bottom;
  }
});

function endDrag() {
  if (!drag) return;
  const { kind, obj: o, moved } = drag;
  drag = null;
  if (kind === 'unit') {
    o.held = false;
    const s = placeUnit(o.x, o.y);
    o.x = o.px = o.slotX = s.x; o.y = o.py = o.slotY = s.y;
    famSet(o, 'arrive');
    effects.push({ type: 'ring', x: o.x, y: o.y, t: 0, dur: 0.4, r: 44, scene: 'battle' });
  } else if (kind === 'ghost') {                     // 놓은 자리에 집 짓기
    ghost.cx = ghost.tx; ghost.bottom = ghost.tb;
    buildHouse();
  } else if (moved < 8) {                            // 톡 누르면 통통
    o.bounce = 0.3;
  } else {
    o.cx = o.tx; o.bottom = o.tb;
    if (kind === 'house') house.landT = 0; else o.bounce = 0.3;
    const w = kind === 'house' ? houseSize().w : buildingSize(o.kind).w;
    effects.push({ type: 'ring', x: o.cx, y: o.bottom - 4, t: 0, dur: 0.45, r: w * 0.5, scene: 'tower' });
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ───────────────── 플레이어 자리 비움 감지 ─────────────────
function goAway() {
  if (state.away || !ready) return;
  state.away = true;
  if (drag && drag.kind === 'unit') endDrag();
}
function comeBack() {
  if (!state.away) return;
  state.away = false;
  for (const f of family) f.caughtT = 0.8 + rand() * 0.6;   // 바로 알아채지 않고 잠깐 땡땡이를 들킨 채로
}
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
  updateEconomy(dt);
  updateEffects(dt);
  updateParticles(dt);
  updateMoneyDisplay(dt);
}

let acc = 0, last = 0;
function frame(nowMs) {
  const now = nowMs / 1000;
  const elapsed = Math.min(now - last, 0.25);
  last = now;
  acc += elapsed * (window.__timeScale ?? 1);         // 테스트용 일시정지(기본 1)
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
    layoutUI();
    last = performance.now() / 1000;
    requestAnimationFrame(frame);
  })
  .catch(src => { toast(`이미지를 불러오지 못했습니다: ${src}`, 10); });

// 테스트/디버그용 훅
window.__game = {
  state, enemies, family, projectiles, house, ghost, buildings, view,
  get cut() { return cut; }, buildHouse, spawnUnit, startCut, finishCut, tapLoan, tapAdd, buy, goAway, comeBack,
};
