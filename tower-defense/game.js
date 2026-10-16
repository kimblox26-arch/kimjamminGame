'use strict';
// 가족 타워 디펜스 — 1단계: 맵 + 캐릭터 생성/이동 (60fps 고정 스텝)

const MAP_W = 688, MAP_H = 1529;      // map.png 원본 크기 = 게임 좌표계
const STEP = 1 / 60;                  // 로직 업데이트 간격 (60fps)
const CHAR_H = 140;                   // 캐릭터 키(맵 픽셀)
const SPEED = 90;                     // 이동 속도(맵 픽셀/초)
const FRAME_RATE = 4;                 // 초당 사진(포즈) 전환 횟수
const AUTO_SPAWN = { every: 2.5, max: 6 };

// 흙길 중앙선 (map.png 픽셀 분석값). 오른쪽 아래에서 출발해 시계 방향으로 한 바퀴.
const PATH = [[566, 1094], [90, 1094], [90, 414], [566, 414], [566, 1094]];

const SEGS = [];
let PATH_LEN = 0;
for (let i = 0; i < PATH.length - 1; i++) {
  const [x0, y0] = PATH[i], [x1, y1] = PATH[i + 1];
  const len = Math.hypot(x1 - x0, y1 - y0);
  SEGS.push({ x0, y0, dx: (x1 - x0) / len, dy: (y1 - y0) / len, start: PATH_LEN, len });
  PATH_LEN += len;
}

function pointAt(dist) {
  const d = ((dist % PATH_LEN) + PATH_LEN) % PATH_LEN;
  let seg = SEGS[SEGS.length - 1];
  for (const s of SEGS) if (d < s.start + s.len) { seg = s; break; }
  const t = d - seg.start;
  return { x: seg.x0 + seg.dx * t, y: seg.y0 + seg.dy * t, dx: seg.dx, dy: seg.dy };
}

// ---------- 에셋 ----------
const SPRITE_NAMES = ['side_0', 'side_1', 'back_0', 'back_1', 'front_0', 'front_1'];
const sprites = {};
const mapImg = new Image();

function loadImage(img, src) {
  return new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(src); img.src = src; });
}

function loadAssets() {
  const jobs = [loadImage(mapImg, 'assets/map.png')];
  for (const n of SPRITE_NAMES) {
    sprites[n] = new Image();
    jobs.push(loadImage(sprites[n], `assets/characters/farmer/${n}.png`));
  }
  return Promise.all(jobs);
}

// ---------- 캐릭터 ----------
const chars = [];
let nextId = 0;

function spawnCharacter() {
  if (chars.length >= 30) return;
  chars.push({ id: nextId++, dist: 0, prevDist: 0, age: 0, phase: Math.random() });
}

function updateCharacter(c, dt) {
  c.prevDist = c.dist;
  c.age += dt;
  const moving = c.age > 0.35;              // 등장 연출이 끝나면 출발
  if (moving) c.dist += SPEED * dt;
  c.phase += dt * FRAME_RATE * (moving ? 1 : 0.4);
}

// 이동 방향 → 사진(포즈) 선택. 옆모습 사진은 왼쪽을 보고 있어서 오른쪽 이동 시 좌우 반전.
function poseFor(p) {
  if (Math.abs(p.dx) > Math.abs(p.dy)) return { dir: 'side', flip: p.dx > 0 };
  return { dir: p.dy < 0 ? 'back' : 'front', flip: false };
}

function drawCharacter(ctx, c, alpha) {
  const p = pointAt(c.prevDist + (c.dist - c.prevDist) * alpha);
  const { dir, flip } = poseFor(p);
  const img = sprites[`${dir}_${Math.floor(c.phase) % 2}`];
  const h = CHAR_H, w = img.width * (h / img.height);

  const t = Math.min(c.age / 0.35, 1);    // 등장: 튀어나오는 스케일
  const pop = t < 1 ? 1 - Math.pow(1 - t, 3) * Math.cos(t * 9) : 1;
  const bob = Math.abs(Math.sin(c.phase * Math.PI)) * 6;
  const tilt = Math.sin(c.phase * Math.PI) * 0.05;
  const footY = p.y + 28;

  ctx.save();
  ctx.translate(p.x, footY);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';      // 발밑 그림자
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.4 * pop, 9 * pop, 0, 0, Math.PI * 2);
  ctx.fill();
  if (t < 1) {                              // 생성 링
    ctx.strokeStyle = `rgba(255,255,255,${1 - t})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, 20 + t * 50, 8 + t * 18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.translate(0, -bob);
  ctx.rotate(tilt);
  ctx.scale(flip ? -pop : pop, pop);
  ctx.drawImage(img, -w / 2, -h, w, h);
  ctx.restore();
}

// ---------- 화면 ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const info = document.getElementById('info');
let view = { scale: 1 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(innerWidth / MAP_W, innerHeight / MAP_H);
  const cw = Math.floor(MAP_W * scale), ch = Math.floor(MAP_H * scale);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = Math.floor(cw * dpr);
  canvas.height = Math.floor(ch * dpr);
  view.scale = canvas.width / MAP_W;
}

function render(alpha) {
  ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(mapImg, 0, 0, MAP_W, MAP_H);
  // 아래쪽(화면 앞쪽) 캐릭터가 위에 그려지도록 y 정렬
  const order = chars
    .map(c => ({ c, y: pointAt(c.dist).y }))
    .sort((a, b) => a.y - b.y || a.c.id - b.c.id);
  for (const { c } of order) drawCharacter(ctx, c, alpha);
}

// ---------- 루프 (고정 60fps 업데이트 + 보간 렌더) ----------
let acc = 0, last = 0, spawnTimer = 0, autoSpawned = 0;
let fpsFrames = 0, fpsTime = 0, fps = 0;

function update(dt) {
  if (autoSpawned < AUTO_SPAWN.max) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnCharacter(); autoSpawned++; spawnTimer = AUTO_SPAWN.every; }
  }
  for (const c of chars) updateCharacter(c, dt);
}

function frame(now) {
  now /= 1000;
  const elapsed = Math.min(now - last, 0.25);   // 탭 전환 등으로 멈췄다 돌아와도 폭주 방지
  last = now;
  acc += elapsed;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render(acc / STEP);

  fpsFrames++; fpsTime += elapsed;
  if (fpsTime >= 0.5) {
    fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0;
    info.textContent = `FPS ${fps} · 캐릭터 ${chars.length}`;
  }
  requestAnimationFrame(frame);
}

document.getElementById('spawn').addEventListener('click', spawnCharacter);
addEventListener('resize', resize);
resize();
loadAssets()
  .then(() => { last = performance.now() / 1000; requestAnimationFrame(frame); })
  .catch(src => { info.textContent = `이미지를 불러오지 못했습니다: ${src}`; });
