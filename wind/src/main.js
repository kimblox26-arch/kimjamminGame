import { Sim, makeStroke, POWERS, FIXED_DT, encodeStrokes, decodeStrokes, strokeLen } from './sim.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';
import { LEVELS, SANDBOX, TITLE } from './levels.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const sim = new Sim();
const ren = new Renderer($('#cv'));
const audio = new Audio();
const ui = { tool: 'soft', pointer: null, drawing: null, hint: false, hoverStroke: null, touch: false, blocked: false };

let screen = 'title';
let level = null;
let levelIdx = -1;
let history = [];
let speed = 1;
let failTimer = 0;
let resultTimer = 0;
let titleSpawn = 0;
let sandboxKind = 'glider';
let ambientLevel = 0;

const store = {
  get() { try { return JSON.parse(localStorage.getItem('wind.progress') || '{}'); } catch { return {}; } },
  set(p) { try { localStorage.setItem('wind.progress', JSON.stringify(p)); } catch { /* 저장 불가 */ } },
};

// ───────────── 화면 전환 ─────────────
function show(name) {
  screen = name;
  document.body.dataset.screen = name;
  $('#hud').hidden = !(name === 'play' || name === 'sandbox');
  document.body.classList.toggle('sandbox', name === 'sandbox');
  $('#result').hidden = true;
  if (name === 'levels') buildLevelGrid();
  if (name === 'title' || name === 'levels' || name === 'howto') {
    if (sim.level !== TITLE) loadTitle();
  }
}

function loadTitle() {
  sim.load(TITLE, 1);
  sim.setStrokes((TITLE.hint || []).map((s) => makeStroke(s.pts, s.power)));
  ren.setLevel(sim);
  titleSpawn = 0;
  speed = 1;
}

function buildLevelGrid() {
  const prog = store.get();
  const grid = $('#level-grid');
  grid.innerHTML = '';
  let total = 0;
  const pals = { dawn: '#f2a07b,#7b6d9b', noon: '#7cc0ec,#b8e07a', sunset: '#f08a4b,#a8456b', night: '#3b4677,#ffbe6e', mist: '#a9b9c0,#6f8796' };
  LEVELS.forEach((lv, i) => {
    const st = prog[lv.id] || 0;
    total += st;
    const locked = i > 0 && !prog[LEVELS[i - 1].id];
    const b = document.createElement('button');
    b.className = 'lv-card' + (locked ? ' locked' : '');
    b.style.setProperty('--pal', `linear-gradient(90deg, ${pals[lv.palette] || pals.noon})`);
    const kind = { glider: '종이 글라이더', seed: '민들레 홀씨', lantern: '풍등' }[lv.flyer.type];
    b.innerHTML = `<div class="num">${String(i + 1).padStart(2, '0')}</div><div class="nm">${lv.name}</div><div class="ds">${locked ? '이전 하늘을 먼저 건너세요' : lv.sub}</div>`
      + `<div class="st">${[0, 1, 2].map((k) => (k < st ? '★' : '<span class="off">★</span>')).join('')}</div><div class="kind">${kind}</div>`;
    if (!locked) b.addEventListener('click', () => { audio.sfx('click'); startLevel(i); });
    grid.appendChild(b);
  });
  $('#star-total').textContent = `★ ${total} / ${LEVELS.length * 3}`;
}

function startLevel(i, strokes) {
  levelIdx = i;
  level = LEVELS[i];
  sim.load(level);
  ren.setLevel(sim);
  history = [];
  if (strokes) sim.setStrokes(strokes);
  ui.hint = false;
  ui.drawing = null;
  speed = 1;
  failTimer = resultTimer = 0;
  show('play');
  $('#lv-name').textContent = `${i + 1}. ${level.name}`;
  $('#lv-goal').textContent = level.goalText;
  const tip = $('#tip');
  if (level.tip) { tip.innerHTML = level.tip + '<small>눌러서 닫기</small>'; tip.hidden = false; } else tip.hidden = true;
  updateButtons();
}

function startSandbox() {
  level = SANDBOX;
  levelIdx = -1;
  SANDBOX.wind = [ambientLevel, 0];
  sim.load(SANDBOX);
  ren.setLevel(sim);
  history = [];
  speed = 1;
  show('sandbox');
  $('#lv-name').textContent = '자유 바람';
  $('#lv-goal').textContent = '마음껏 바람을 그리고, 무엇이든 날려 보세요.';
  $('#tip').hidden = true;
  updateButtons();
}

// ───────────── 획 편집 ─────────────
function snapshot() {
  history.push(sim.strokes.slice());
  if (history.length > 60) history.shift();
}

function undo() {
  if (!history.length) return;
  sim.setStrokes(history.pop());
  audio.sfx('erase');
}

function clearStrokes() {
  if (!sim.strokes.length) return;
  snapshot();
  sim.setStrokes([]);
  audio.sfx('erase');
}

function strokeNear(x, y, r) {
  let best = null, bd = r;
  for (const s of sim.strokes) {
    for (let i = 0; i + 1 < s.pts.length; i++) {
      const [ax, ay] = s.pts[i], [bx, by] = s.pts[i + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
      if (d < bd) { bd = d; best = s; }
    }
  }
  return best;
}

function eraseAt(x, y) {
  const s = strokeNear(x, y, 5);
  if (!s) return;
  snapshot();
  sim.removeStroke(s);
  audio.sfx('erase');
}

function inkLeftFor(extra) {
  if (sim.sandbox) return Infinity;
  return sim.inkLeft() - extra;
}

let erasing = false, smooth = null, lastMove = 0, lastPreview = 0, brushSpeed = 0, nopeCooldown = 0;

function canEdit() { return (screen === 'play' || screen === 'sandbox') && $('#result').hidden; }

function beginStroke(x, y) {
  if (sim.inNoDraw(x, y) || x < 0 || x > 200 || y < 0 || y > 112.5) { ui.blocked = true; return; }
  ui.blocked = false;
  if (inkLeftFor(0) <= 0.5) { flashInk(); return; }
  ui.drawing = { pts: [[x, y]], power: ui.tool, speed: POWERS[ui.tool].speed, len: 0 };
  smooth = [x, y];
}

function extendStroke(x, y) {
  const d = ui.drawing;
  smooth[0] += (x - smooth[0]) * 0.6; smooth[1] += (y - smooth[1]) * 0.6;
  const last = d.pts[d.pts.length - 1];
  const seg = Math.hypot(smooth[0] - last[0], smooth[1] - last[1]);
  if (seg < 1.6) return;
  if (sim.inNoDraw(smooth[0], smooth[1])) { ui.blocked = true; commitStroke(); return; }
  const cost = (d.len + seg) * POWERS[d.power].cost;
  if (inkLeftFor(cost) < 0) { flashInk(); return; }
  d.pts.push([smooth[0], smooth[1]]);
  d.len += seg;
  const now = performance.now();
  if (now - lastPreview > 60) { lastPreview = now; sim.previewStroke(d); }
}

function commitStroke() {
  const d = ui.drawing;
  ui.drawing = null;
  if (!d) return;
  if (d.pts.length < 2 || strokeLen(d.pts) < 3) { sim.previewStroke(null); return; }
  snapshot();
  sim.addStroke(makeStroke(d.pts, d.power));
  audio.sfx('stroke');
  if (screen === 'play') $('#tip').hidden = true;
}

function flashInk() {
  if (performance.now() < nopeCooldown) return;
  nopeCooldown = performance.now() + 500;
  const el = $('.ink');
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  audio.sfx('nope');
}

const cv = $('#cv');
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  audio.init();
  if (!canEdit()) return;
  cv.setPointerCapture(e.pointerId);
  ui.touch = e.pointerType === 'touch';
  const [x, y] = ren.toWorld(e.clientX, e.clientY);
  ui.pointer = [x, y];
  if (e.button === 2 || ui.tool === 'erase') { erasing = true; eraseAt(x, y); return; }
  if (e.button !== 0) return;
  beginStroke(x, y);
});
cv.addEventListener('pointermove', (e) => {
  ui.touch = e.pointerType === 'touch';
  const [x, y] = ren.toWorld(e.clientX, e.clientY);
  const now = performance.now();
  if (ui.pointer && lastMove) {
    const v = Math.hypot(x - ui.pointer[0], y - ui.pointer[1]) / Math.max(0.001, (now - lastMove) / 1000);
    brushSpeed = ui.drawing ? v : 0;
  }
  lastMove = now;
  ui.pointer = [x, y];
  if (!canEdit()) return;
  ui.hoverStroke = (ui.tool === 'erase' || erasing) ? strokeNear(x, y, 5) : null;
  if (erasing) { eraseAt(x, y); return; }
  if (ui.drawing) extendStroke(x, y);
  else if (e.buttons & 1 && ui.blocked && !sim.inNoDraw(x, y)) beginStroke(x, y);
  else ui.blocked = sim.inNoDraw(x, y);
});
const endPointer = () => { erasing = false; brushSpeed = 0; commitStroke(); ui.blocked = false; };
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { if (!ui.drawing) ui.pointer = null; });

// ───────────── 비행 ─────────────
function launchOrReset() {
  audio.init();
  if (screen === 'sandbox') {
    const L = SANDBOX.flyer;
    sim.launch({ ...L, type: sandboxKind, count: sandboxKind === 'seed' ? 14 : sandboxKind === 'lantern' ? 4 : 1 });
    audio.sfx('launch');
    return;
  }
  if (screen !== 'play') return;
  if (sim.phase === 'plan') {
    sim.launch();
    audio.sfx('launch');
    $('#tip').hidden = true;
  } else {
    sim.reset();
    failTimer = 0;
  }
  updateButtons();
}

function updateButtons() {
  const fly = screen === 'play' && sim.phase !== 'plan';
  const b = $('#launch');
  b.classList.toggle('flying', fly);
  b.querySelector('i').textContent = fly ? '↺' : '▶';
  b.querySelector('span').textContent = fly ? '다시' : '날리기';
  $$('[data-tool]').forEach((t) => t.classList.toggle('active', t.dataset.tool === ui.tool));
  $('[data-act="hint"]').classList.toggle('on', ui.hint);
  $('[data-act="speed"]').classList.toggle('on', speed > 1);
}

const REASONS = {
  crash: '종이 글라이더가 부딪혔어요',
  splash: '물에 빠지고 말았어요',
  lost: '바람에 실려 하늘 밖으로 날아갔어요',
  timeout: '바람이 잦아들었어요',
  stuck: '홀씨가 엉뚱한 곳에 내려앉았어요',
  burnt: '풍등이 바위에 닿아 꺼졌어요',
};

function handleEvents(evs) {
  for (const e of evs) {
    switch (e.t) {
      case 'mote': ren.burst('mote', e.x, e.y, 14); audio.sfx('mote'); break;
      case 'goal': if (e.kind !== 'glider') { ren.burst('mote', e.x, e.y, 6); audio.sfx('goal'); } break;
      case 'crash': ren.burst('paper', e.x, e.y, 16); audio.sfx('crash'); break;
      case 'splash': ren.burst('splash', e.x, e.y, e.kind === 'glider' ? 26 : 6); if (e.kind !== 'seed') audio.sfx('splash'); break;
      case 'burnt': ren.burst('ember', e.x, e.y, 10); break;
      case 'win': {
        const g = level.goal;
        const gx = g.type === 'ring' ? g.x : (g.x0 + g.x1) / 2, gy = g.type === 'ring' ? g.y : g.y1;
        ren.burst('goal', gx, gy, 40);
        audio.sfx('win');
        saveResult(sim.result);
        resultTimer = 1.1;
        break;
      }
      case 'fail': {
        audio.sfx('fail');
        const multi = level.flyer.type !== 'glider';
        let msg = REASONS[e.reason] || '다시 해 볼까요?';
        if (multi) msg = `${e.got} / ${e.need} 도착 — ${e.got ? '조금만 더!' : msg}`;
        toast(msg + '<br><small>바람을 고쳐 다시 날려 보세요</small>', 2200);
        failTimer = 1.8;
        break;
      }
      default: break;
    }
  }
}

function saveResult(r) {
  const p = store.get();
  p[level.id] = Math.max(p[level.id] || 0, r.stars);
  store.set(p);
}

function showResult() {
  const r = sim.result;
  $('#res-stars').innerHTML = [0, 1, 2].map((k) => (k < r.stars ? '<span>★</span>' : '<span class="off">★</span>')).join('');
  $('#res-title').textContent = r.stars === 3 ? '완벽한 바람이에요' : r.stars === 2 ? '하늘이 길을 열었어요' : '바람이 닿았어요';
  const parts = [];
  if (r.need > 1) parts.push(`도착 ${r.got} / ${r.need}`);
  parts.push(`별빛 ${r.gotM} / ${r.motes}${r.gotM === r.motes ? ' ✓' : ''}`);
  parts.push(`바람의 숨 ${Math.round(r.ink)} / 기준 ${r.par}${r.ink <= r.par ? ' ✓' : ''}`);
  $('#res-body').innerHTML = parts.join(' · ');
  $('[data-act="next"]').textContent = levelIdx < LEVELS.length - 1 ? '다음 하늘 →' : '여정 목록 →';
  $('#result').hidden = false;
}

function toast(html, ms = 1800) {
  const d = document.createElement('div');
  d.innerHTML = html;
  $('#toast').appendChild(d);
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, ms);
}

function share() {
  const url = `${location.origin}${location.pathname}#play=${level.id}&w=${encodeStrokes(sim.strokes)}`;
  const done = () => toast('링크를 복사했어요 — 친구에게 내 바람을 보여 주세요');
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => window.prompt('이 링크를 복사하세요', url));
  else window.prompt('이 링크를 복사하세요', url);
}

// ───────────── 버튼·키보드 ─────────────
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-tool],[data-kind]');
  if (!t) return;
  audio.init();
  if (t.dataset.tool) { ui.tool = t.dataset.tool; audio.sfx('click'); updateButtons(); return; }
  if (t.dataset.kind) {
    sandboxKind = t.dataset.kind;
    $$('.fly-kind').forEach((k) => k.classList.toggle('active', k === t));
    audio.sfx('click');
    return;
  }
  const a = t.dataset.act;
  audio.sfx('click');
  if (a === 'levels') show('levels');
  else if (a === 'title') show('title');
  else if (a === 'howto') show('howto');
  else if (a === 'back') show(level && levelIdx >= 0 && sim.level === level ? 'play' : 'title');
  else if (a === 'sandbox') startSandbox();
  else if (a === 'launch') launchOrReset();
  else if (a === 'undo') undo();
  else if (a === 'clear') clearStrokes();
  else if (a === 'hint') { ui.hint = !ui.hint; updateButtons(); if (ui.hint) toast('흰 점선은 바람 하나의 예시예요. 꼭 같을 필요는 없어요', 2400); }
  else if (a === 'speed') { speed = speed > 1 ? 1 : 2; updateButtons(); }
  else if (a === 'retry') { $('#result').hidden = true; sim.reset(); updateButtons(); }
  else if (a === 'share') share();
  else if (a === 'next') { if (levelIdx < LEVELS.length - 1) startLevel(levelIdx + 1); else show('levels'); }
});
$('#tip').addEventListener('click', () => { $('#tip').hidden = true; });
$('#mute').addEventListener('click', () => { audio.init(); audio.setMuted(!audio.muted); $('#mute').classList.toggle('off', audio.muted); });
$('#mute').classList.toggle('off', audio.muted);
$('#amb').addEventListener('input', (e) => {
  ambientLevel = +e.target.value;
  $('#amb-v').textContent = ambientLevel;
  sim.fluid.ambU = ambientLevel;
});

window.addEventListener('keydown', (e) => {
  if (e.repeat && e.key !== 'z') return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    if (screen === 'play' || screen === 'sandbox') show(screen === 'play' ? 'levels' : 'title');
    else if (screen === 'levels' || screen === 'howto') show('title');
    return;
  }
  if (!canEdit()) {
    if ((k === ' ' || k === 'enter') && !$('#result').hidden) { e.preventDefault(); document.querySelector('[data-act="next"]').click(); }
    return;
  }
  audio.init();
  if (k === ' ') { e.preventDefault(); launchOrReset(); }
  else if (k === '1' || k === '2' || k === '3') { ui.tool = ['soft', 'strong', 'erase'][+k - 1]; updateButtons(); }
  else if (k === 'z') undo();
  else if (k === 'c') clearStrokes();
  else if (k === 'h' && screen === 'play') document.querySelector('[data-act="hint"]').click();
  else if (k === 'f') { speed = speed > 1 ? 1 : 2; updateButtons(); }
});

window.addEventListener('resize', () => ren.resize());

// ───────────── HUD ─────────────
let hudCache = '';
function updateHud() {
  if (screen !== 'play') return;
  const left = Math.max(0, sim.inkLeft() - (ui.drawing ? ui.drawing.len * POWERS[ui.drawing.power].cost : 0));
  const m = sim.motes;
  const key = `${Math.round(left)}|${m.filter((q) => q.got).length}|${sim.phase}|${sim.goalCount()}`;
  if (key === hudCache) return;
  hudCache = key;
  const frac = left / level.ink;
  const fill = $('#ink-fill');
  fill.style.width = `${frac * 100}%`;
  fill.classList.toggle('low', frac < 0.15);
  $('#ink-par').style.left = `${((level.ink - level.par) / level.ink) * 100}%`;
  $('#ink-num').textContent = Math.round(left);
  let mc = `✦ ${m.filter((q) => q.got).length} / ${m.length}`;
  if (level.flyer.type !== 'glider') mc = `도착 ${sim.goalCount()} / ${sim.need()} · ` + mc;
  $('#mote-count').textContent = mc;
  updateButtons();
}

// ───────────── 루프 ─────────────
let acc = 0, last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const sdt = dt * speed;
  acc += sdt;
  let n = 0;
  while (acc >= FIXED_DT && n < 5) {
    handleEvents(sim.step(FIXED_DT));
    acc -= FIXED_DT;
    n++;
  }
  if (n === 5) acc = 0;

  if (screen === 'title' || screen === 'levels' || screen === 'howto') {
    titleSpawn -= sdt;
    if (titleSpawn <= 0) {
      titleSpawn = 3.2;
      const kinds = ['seed', 'glider', 'lantern', 'seed'];
      const kind = kinds[(Math.random() * kinds.length) | 0];
      sim.launch({ ...TITLE.flyer, type: kind, count: kind === 'seed' ? 10 : kind === 'lantern' ? 3 : 1, fuel: 14 });
    }
  }
  if (failTimer > 0) { failTimer -= dt; if (failTimer <= 0 && sim.phase === 'failed') { sim.reset(); updateButtons(); } }
  if (resultTimer > 0) { resultTimer -= dt; if (resultTimer <= 0) showResult(); }

  ui.faint = screen === 'title' || screen === 'levels' || screen === 'howto';
  ren.frame(sdt, ui);
  updateHud();
  let air = 0;
  for (const f of sim.flyers) if (f.kind === 'glider' && f.state === 'fly') air = Math.max(air, Math.hypot(f.vx, f.vy));
  audio.update(dt, Math.abs(sim.fluid.ambU) + 2, air, brushSpeed);
  brushSpeed *= 0.85;
  requestAnimationFrame(loop);
}

// ───────────── 시작 ─────────────
function boot() {
  ren.resize();
  loadTitle();
  show('title');
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('play')) {
    const i = LEVELS.findIndex((l) => l.id === h.get('play'));
    if (i >= 0) {
      startLevel(i, decodeStrokes(h.get('w') || ''));
      toast('공유받은 바람이에요 — ▶ 날리기를 눌러 보세요', 2600);
    }
  }
  requestAnimationFrame(loop);
  window.__WIND__ = { sim, ren, startLevel, LEVELS };
}
boot();
