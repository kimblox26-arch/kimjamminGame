'use strict';
// ===== 맵 / 스킬 효과 / 게임 엔진 / 매칭 =====
const MAPS = {
  arena: { name: '기본 박스', desc: '함정 없는 정정당당 대결', bg: ['#1b1035', '#2d1b5e'], c: '#a78bfa' },
  jungle: { name: '정글', desc: '줄기에 걸리면 잠시 멈춰요. 빠져나오면 줄기는 사라져요', bg: ['#0c2a12', '#1d4d22'], c: '#4ade80' },
  lava: { name: '용암', desc: '용암에 닿으면 1초에 HP 1 감소', bg: ['#2a0a05', '#4a1206'], c: '#ff6a1a' },
  sky: { name: '하늘', desc: '구름에 닿으면 느려져요', bg: ['#2f7fd0', '#a8dcff'], c: '#ffffff' },
};
const MAP_KEYS = Object.keys(MAPS);
const COMPS = {
  proj: ['발사체', 'proj', '적에게 탄환 3발'], dash: ['돌진', 'dash', '적에게 돌진해 추가 피해'], boom: ['폭발', 'burst', '주변 폭발 + 넉백'],
  heal: ['회복', 'heal', '체력 회복'], shield: ['방어막', 'shield', '피해 흡수 보호막'], laser: ['레이저', 'laser', '즉시 꽂히는 빔'],
  freeze: ['빙결', 'snow', '적을 느리게'], poison: ['독', 'drop', '3초 지속 피해'], grow: ['거대화', 'grow', '커지고 충돌 피해 증가'],
  bolt: ['번개', 'bolt', '하늘에서 번개'], vamp: ['흡혈', 'fang', '준 피해만큼 회복'], tele: ['순간이동', 'swirl', '적 옆으로 이동 후 타격'],
  meteor: ['메테오', 'meteor', '잠시 후 거대 운석'],
};
const COMP_KEYS = Object.keys(COMPS);
const skillPower = s => (s.cd / 6) * (1 + .15 * (s.lv - 1)) * (s.fused ? 1.1 : 1) * (1.4 / (s.comps.length + .4));
const skillCD = s => +(s.cd * (1 - .04 * (s.lv - 1))).toFixed(2);
function srand(s) { return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function drawMapBG(c, mk, W, H, t = 0) {
  const m = MAPS[mk], g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, m.bg[0]); g.addColorStop(1, m.bg[1]);
  c.fillStyle = g; c.fillRect(0, 0, W, H); const R = srand(7); c.save();
  if (mk === 'arena') { c.strokeStyle = 'rgba(167,139,250,.14)'; c.lineWidth = 1; for (let i = 0; i <= W; i += W / 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, H); c.moveTo(0, i); c.lineTo(W, i); c.stroke(); } }
  if (mk === 'jungle') for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(${20 + R() * 40 | 0},${90 + R() * 80 | 0},${30 + R() * 30 | 0},.35)`; c.beginPath(); c.ellipse(R() * W, R() * H, 6 + R() * 16, 3 + R() * 6, R() * 6 + Math.sin(t + i) * .1, 0, 7); c.fill(); }
  if (mk === 'lava') { c.strokeStyle = `rgba(255,${90 + 40 * Math.sin(t * 2) | 0},20,.35)`; c.lineWidth = 2; for (let i = 0; i < 12; i++) { let x = R() * W, y = R() * H; c.beginPath(); c.moveTo(x, y); for (let j = 0; j < 4; j++) { x += (R() - .5) * W * .2; y += (R() - .5) * H * .2; c.lineTo(x, y); } c.stroke(); } }
  if (mk === 'sky') { c.fillStyle = 'rgba(255,240,150,.85)'; c.beginPath(); c.arc(W * .85, H * .12, W * .07, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse((R() * W + t * 5) % W, R() * H, 30, 10, 0, 0, 7); c.fill(); } }
  c.restore();
}
function drawCloud(c, x, y, w, hh, a = .9) {
  c.save(); c.globalAlpha = a; c.fillStyle = '#fff';
  c.beginPath(); c.ellipse(x, y + hh * .15, w / 2, hh * .35, 0, 0, 7); c.arc(x - w * .2, y, hh * .35, 0, 7); c.arc(x + w * .12, y - hh * .12, hh * .45, 0, 7); c.arc(x + w * .32, y + hh * .05, hh * .3, 0, 7); c.fill(); c.restore();
}
function drawLava(c, l, t) {
  const r = l.r * (1 + .05 * Math.sin(t * 3 + l.ph)), g = c.createRadialGradient(l.x, l.y, 2, l.x, l.y, r);
  g.addColorStop(0, '#fff3a0'); g.addColorStop(.35, '#ffb020'); g.addColorStop(.75, '#ff4a0a'); g.addColorStop(1, 'rgba(120,10,0,.9)');
  c.fillStyle = g; c.beginPath(); c.arc(l.x, l.y, r, 0, 7); c.fill();
  c.fillStyle = 'rgba(255,240,180,.7)'; for (let i = 0; i < 3; i++) { const a = t * 1.5 + i * 2 + l.ph; c.beginPath(); c.arc(l.x + Math.cos(a) * r * .45, l.y + Math.sin(a * 1.3) * r * .45, 2 + Math.sin(t * 4 + i) * 1.5, 0, 7); c.fill(); }
}
function drawVine(c, v, t) {
  c.save(); c.globalAlpha = Math.max(0, v.a); c.strokeStyle = '#2f9e44'; c.lineWidth = 4; c.lineCap = 'round';
  const tight = v.st === 1 ? .7 : 1;
  for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(v.x, v.y, v.r * tight * (.55 + .45 * Math.abs(Math.sin(v.ph + i))), v.r * .35 * tight, i * Math.PI / 3 + Math.sin(t + i) * .1, 0, 7); c.stroke(); }
  c.fillStyle = '#69db7c'; for (let i = 0; i < 5; i++) { const a = i * 1.26 + v.ph; c.beginPath(); c.ellipse(v.x + Math.cos(a) * v.r * .8, v.y + Math.sin(a) * v.r * .8, 6, 3, a, 0, 7); c.fill(); }
  c.restore();
}
function mapPreview(cv, mk) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height; drawMapBG(c, mk, W, H, 0); const s = W / 400;
  if (mk === 'jungle') [[100, 120], [280, 260], [200, 330]].forEach(([x, y]) => drawVine(c, { x: x * s, y: y * s, r: 26 * s, a: 1, st: 0, ph: x }, 0));
  if (mk === 'lava') [[110, 140, 40], [290, 270, 34], [200, 340, 28]].forEach(([x, y, r]) => drawLava(c, { x: x * s, y: y * s, r: r * s, ph: x }, 0));
  if (mk === 'sky') [[120, 110], [280, 230], [150, 330]].forEach(([x, y]) => drawCloud(c, x * s, y * s, 110 * s, 46 * s));
}

class Game {
  constructor(cv, o) {
    this.cv = cv; this.c = cv.getContext('2d'); this.o = o; this.map = o.map;
    this.dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = 400 * this.dpr; cv.height = 450 * this.dpr;
    this.t = 0; this.parts = []; this.projs = []; this.rings = []; this.beams = []; this.texts = []; this.timers = []; this.marks = []; this.ovs = []; this.bolts = [];
    this.shake = 0; this.over = false; this.started = false; this.lastCol = -1;
    this.balls = [this.mkBall(0, o.opp), this.mkBall(1, o.me)];
    this.vines = []; this.lava = []; this.clouds = []; this.vineT = 5;
    const place = r => { for (let i = 0; i < 60; i++) { const x = 45 + Math.random() * 310, y = 45 + Math.random() * 310; if (this.balls.every(b => Math.hypot(b.x - x, b.y - y) > r + 60) && this.lava.every(l => Math.hypot(l.x - x, l.y - y) > r + l.r + 10)) return [x, y]; } return [200, 200]; };
    this.place = place;
    if (this.map === 'jungle') for (let i = 0; i < 4; i++) this.addVine();
    if (this.map === 'lava') for (let i = 0; i < 4; i++) { const r = 28 + Math.random() * 16, [x, y] = place(r); this.lava.push({ x, y, r, ph: Math.random() * 6 }); }
    if (this.map === 'sky') for (let i = 0; i < 4; i++) this.clouds.push({ x: Math.random() * 400, y: 55 + i * 92 + Math.random() * 20, w: 95 + Math.random() * 40, h: 42 + Math.random() * 12, vx: (Math.random() < .5 ? -1 : 1) * (15 + Math.random() * 20) });
  }
  mkBall(side, p) {
    const a = Math.random() * Math.PI * 2;
    return {
      side, u: p.u, img: p.img, x: side ? 300 : 100, y: side ? 300 : 100, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, r: 24, sc: 1, sqx: 1, sqy: 1,
      hp: 150, max: 150, color: side ? '#25F4EE' : '#FE2C55', sk: p.skills, shield: 0, shieldT: 0, slowT: 0, stuckT: 0, immT: 0, poisonT: 0, poisonD: 0,
      growT: 0, growDmg: 0, dashT: 0, dashDmg: 0, flash: 0, trail: [], shotT: 1 + Math.random() * .5, cloud: false, lavaAcc: 0, dotAcc: 0, dead: false,
    };
  }
  addVine() { const [x, y] = this.place(28); this.vines.push({ x, y, r: 26, st: 0, a: 0, hold: null, ph: Math.random() * 6 }); }
  enemy(b) { return this.balls[b.side ? 0 : 1]; }
  part(x, y, col, sp = 60, life = .6, size = 3, g = 0) { const a = Math.random() * 7, v = Math.random() * sp; this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col, life, ml: life, size, g }); }
  burst(x, y, col, n = 10, sp = 160) { for (let i = 0; i < n; i++) this.part(x, y, col, sp, rnd(.3, .7), rnd(2, 4)); }
  ring(x, y, max, col, life = .45, w = 4) { this.rings.push({ x, y, r: 4, max, col, life, ml: life, w }); }
  text(x, y, s, col, big) { this.texts.push({ x, y, s, col, life: big ? 1.1 : .8, ml: big ? 1.1 : .8, big }); }
  later(t, fn) { this.timers.push({ t, fn }); }
  squash(b, ax) { if (ax) { b.sqx = .7; b.sqy = 1.25; } else { b.sqx = 1.25; b.sqy = .7; } }
  hit(b, dmg, col = '#fff') {
    if (this.over || b.dead || dmg <= 0) return 0; let d = dmg;
    if (b.shield > 0) { const a = Math.min(b.shield, d); b.shield -= a; d -= a; this.ring(b.x, b.y, b.r * b.sc + 16, '#9ee7ff', .3, 3); if (d <= 0) { this.text(b.x, b.y - b.r - 10, '막음', '#9ee7ff'); return 0; } }
    b.hp -= d; b.flash = .12; this.text(b.x + rnd(-12, 12), b.y - b.r * b.sc - 8, '-' + Math.round(d), col);
    if (d >= 10) this.shake = Math.min(12, d * .6); AUD.sfx('hit'); return d;
  }
  shoot(b, e, ang, sp, r, dmg, col, home = 0) { this.projs.push({ x: b.x + Math.cos(ang) * b.r, y: b.y + Math.sin(ang) * b.r, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r, dmg, col, tg: e, life: 2.5, home }); }
  cast(b, e, sk) {
    const s = sk.s, pm = skillPower(s), col = s.color;
    if (sk.buf) AUD.playBuf(sk.buf); else AUD.skill(s.sound);
    this.text(b.x, b.y - b.r * b.sc - 26, s.name, col, true); this.ring(b.x, b.y, b.r * 2.6, col, .5, 5);
    if (sk.el) {
      if (sk.el.tagName === 'VIDEO') { try { sk.el.currentTime = s.media.edits.start || 0; sk.el.playbackRate = s.media.edits.speed || 1; sk.el.play().catch(() => { }); } catch (x) { } }
      this.ovs.push({ b, sk, life: 1.8, ml: 1.8 });
    }
    s.comps.forEach((c, i) => this.later(i * .12, () => !this.over && !b.dead && this.comp(c, b, e, pm, col)));
  }
  comp(c, b, e, pm, col) {
    const ang = Math.atan2(e.y - b.y, e.x - b.x), dist = Math.hypot(e.x - b.x, e.y - b.y);
    switch (c) {
      case 'proj': for (let i = -1; i <= 1; i++) this.shoot(b, e, ang + i * .2, 380, 7, 5 * pm, col, 1.5); break;
      case 'dash': b.dashT = .55; b.dashDmg = 10 * pm; AUD.sfx('whoosh'); break;
      case 'boom': this.ring(b.x, b.y, 110, col, .5, 8); this.burst(b.x, b.y, col, 30, 300); AUD.sfx('boom');
        if (dist < 110 + e.r) { this.hit(e, 12 * pm, col); e.vx += Math.cos(ang) * 400; e.vy += Math.sin(ang) * 400; } break;
      case 'heal': { const v = Math.min(b.max - b.hp, 10 * pm); b.hp += v; this.text(b.x, b.y - b.r - 8, '+' + Math.round(v), '#5cff8a'); for (let i = 0; i < 14; i++) this.part(b.x + rnd(-b.r, b.r), b.y + rnd(-b.r, b.r), '#5cff8a', 20, .8, 3, -60); break; }
      case 'shield': b.shield = 15 * pm; b.shieldT = 4; this.ring(b.x, b.y, b.r + 14, '#9ee7ff', .5, 4); break;
      case 'laser': this.beams.push({ x1: b.x, y1: b.y, b2: e, col, life: .35, ml: .35, w: 9 }); this.hit(e, 9 * pm, col); AUD.sfx('laser'); break;
      case 'freeze': e.slowT = Math.min(4, 1.5 * pm); for (let i = 0; i < 16; i++) this.part(e.x, e.y, '#bfefff', 120, .7, 3); this.text(e.x, e.y + e.r + 12, '느려짐', '#bfefff'); break;
      case 'poison': e.poisonT = 3; e.poisonD = 3 * pm; this.burst(e.x, e.y, '#7dff6a', 14); break;
      case 'grow': b.growT = 3; b.growDmg = 6 * pm; break;
      case 'bolt': this.bolts.push({ x: e.x, y: e.y, life: .35, ml: .35, seed: Math.random() * 1e4 }); this.hit(e, 10 * pm, '#fff59d'); this.shake = 6; AUD.sfx('zap'); break;
      case 'vamp': { const d = this.hit(e, 7 * pm, '#ff4d6d'); this.beams.push({ x1: b.x, y1: b.y, b2: e, col: '#ff4d6d', life: .4, ml: .4, w: 4 }); if (d) { b.hp = Math.min(b.max, b.hp + d); this.text(b.x, b.y - b.r - 8, '+' + Math.round(d), '#5cff8a'); } break; }
      case 'tele': { this.burst(b.x, b.y, col, 16); const a = Math.random() * 7, r = e.r + b.r + 6; b.x = Math.min(400 - b.r, Math.max(b.r, e.x + Math.cos(a) * r)); b.y = Math.min(400 - b.r, Math.max(b.r, e.y + Math.sin(a) * r)); this.burst(b.x, b.y, col, 16); this.ring(b.x, b.y, 50, col); this.hit(e, 6 * pm, col); break; }
      case 'meteor': { const tx = e.x, ty = e.y; this.marks.push({ x: tx, y: ty, r: 55, life: .8, ml: .8 }); this.later(.8, () => { this.ring(tx, ty, 70, '#ff8a3d', .5, 8); this.burst(tx, ty, '#ff8a3d', 34, 320); AUD.sfx('boom'); this.shake = 10; if (Math.hypot(e.x - tx, e.y - ty) < 55 + e.r) this.hit(e, 16 * pm, '#ff8a3d'); }); break; }
    }
  }
  updBall(b, dt, e) {
    b.flash = Math.max(0, b.flash - dt);
    for (const k of ['shieldT', 'slowT', 'immT', 'poisonT', 'growT', 'dashT']) b[k] = Math.max(0, b[k] - dt);
    if (b.shieldT <= 0) b.shield = 0;
    b.sc += ((b.growT > 0 ? 1.5 : 1) - b.sc) * Math.min(1, dt * 8);
    b.sqx += (1 - b.sqx) * Math.min(1, dt * 10); b.sqy += (1 - b.sqy) * Math.min(1, dt * 10);
    const r = b.r * b.sc;
    if (b.poisonT > 0 && this.started && !this.over) { const d = b.poisonD * dt; b.hp -= d; b.dotAcc += d; if (b.dotAcc >= 2) { this.text(b.x, b.y - r, '-' + Math.round(b.dotAcc), '#8f8'); b.dotAcc = 0; } if (Math.random() < .3) this.part(b.x + rnd(-r, r), b.y + rnd(-r, r), '#7f7', 0, .5, 3, -20); }
    if (this.map === 'lava' && this.started && !this.over && this.lava.some(l => Math.hypot(l.x - b.x, l.y - b.y) < l.r + r * .6)) {
      b.hp -= dt; b.lavaAcc += dt; if (b.lavaAcc >= 1) { b.lavaAcc -= 1; this.text(b.x, b.y - r, '-1', '#ff8a3d'); }
      if (Math.random() < .5) this.part(b.x + rnd(-r, r), b.y + r * .5, '#ff7a1a', 0, .6, 3, -60);
    }
    if (this.t > 60 && this.started && !this.over) b.hp -= 2 * dt; // 서든데스
    b.cloud = this.map === 'sky' && this.clouds.some(c => ((b.x - c.x) / (c.w / 2 + r * .4)) ** 2 + ((b.y - c.y) / (c.h / 2 + r * .4)) ** 2 < 1);
    if (this.map === 'jungle') {
      if (b.stuckT > 0) {
        b.stuckT -= dt; const v = this.vines.find(v => v.hold === b);
        if (v) { b.x += (v.x - b.x) * Math.min(1, dt * 6); b.y += (v.y - b.y) * Math.min(1, dt * 6); }
        if (b.stuckT <= 0) { if (v) { v.st = 2; v.hold = null; } b.immT = .6; this.burst(b.x, b.y, '#4ade80', 14); this.text(b.x, b.y - r - 8, '탈출!', '#8ce99a'); }
      } else if (b.immT <= 0 && this.started) {
        const v = this.vines.find(v => v.st === 0 && v.a > .8 && Math.hypot(v.x - b.x, v.y - b.y) < v.r + r * .6);
        if (v) { v.st = 1; v.hold = b; b.stuckT = 1.6; this.text(b.x, b.y - r - 8, '걸림!', '#4ade80'); AUD.sfx('whoosh'); }
      }
    }
    if (b.stuckT <= 0 && this.started) {
      const sp = 160 * (b.slowT > 0 ? .5 : 1) * (b.cloud ? .4 : 1) * (b.dashT > 0 ? 2.8 : 1);
      if (b.dashT > 0) { const a = Math.atan2(e.y - b.y, e.x - b.x), k = Math.min(1, dt * 10); b.vx += (Math.cos(a) * sp - b.vx) * k; b.vy += (Math.sin(a) * sp - b.vy) * k; this.part(b.x, b.y, b.color, 10, .4, 4); }
      const m = Math.hypot(b.vx, b.vy) || 1, nm = m + (sp - m) * Math.min(1, dt * 4); b.vx = b.vx / m * nm; b.vy = b.vy / m * nm;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx); this.squash(b, 1); } else if (b.x > 400 - r) { b.x = 400 - r; b.vx = -Math.abs(b.vx); this.squash(b, 1); }
      if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy); this.squash(b, 0); } else if (b.y > 400 - r) { b.y = 400 - r; b.vy = -Math.abs(b.vy); this.squash(b, 0); }
      if (b.cloud && Math.random() < .2) this.part(b.x, b.y, '#fff', 30, .5, 4);
    }
    b.trail.push([b.x, b.y]); if (b.trail.length > 10) b.trail.shift();
    if (this.over || !this.started || b.dead) return;
    b.shotT -= dt; if (b.shotT <= 0) { b.shotT = 1.3; this.shoot(b, e, Math.atan2(e.y - b.y, e.x - b.x), 300, 5, 3, b.color, 2); }
    for (const s of b.sk) { s.t -= dt; if (s.t <= 0) { s.t = s.cd; this.cast(b, e, s); } }
  }
  collide(A, B) {
    const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), rr = A.r * A.sc + B.r * B.sc;
    if (d >= rr || d === 0) return;
    const nx = dx / d, ny = dy / d, ov = rr - d; A.x -= nx * ov / 2; A.y -= ny * ov / 2; B.x += nx * ov / 2; B.y += ny * ov / 2;
    const va = A.vx * nx + A.vy * ny, vb = B.vx * nx + B.vy * ny;
    if (va - vb > 0) { A.vx += (vb - va) * nx; A.vy += (vb - va) * ny; B.vx += (va - vb) * nx; B.vy += (va - vb) * ny; }
    if (this.t - this.lastCol > .3 && this.started) {
      this.lastCol = this.t; const cx = A.x + nx * A.r, cy = A.y + ny * A.r;
      const dA = 4 + (A.growT > 0 ? A.growDmg : 0) + (A.dashT > 0 ? A.dashDmg : 0), dB = 4 + (B.growT > 0 ? B.growDmg : 0) + (B.dashT > 0 ? B.dashDmg : 0);
      if (A.dashT > 0) A.dashT = 0; if (B.dashT > 0) B.dashT = 0;
      this.hit(B, dA, A.color); this.hit(A, dB, B.color); this.burst(cx, cy, '#fff', 12, 220); this.ring(cx, cy, 30, '#fff', .25, 3);
      this.squash(A, Math.abs(nx) > Math.abs(ny) ? 1 : 0); this.squash(B, Math.abs(nx) > Math.abs(ny) ? 1 : 0);
    }
  }
  step(dt) {
    if (this.over) { this.endT -= dt; dt *= .3; if (this.endT <= 0 && !this.ended) { this.ended = true; this.o.onEnd(this.winner); } }
    if (this.started) this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    const [A, B] = this.balls;
    if (this.map === 'jungle') {
      this.vineT -= dt; if (this.vineT <= 0) { this.vineT = 5; if (this.vines.length < 5) this.addVine(); }
      for (const v of this.vines) { if (v.st === 0) v.a = Math.min(1, v.a + dt * 2); if (v.st === 2) v.a -= dt * 1.5; v.ph += dt; }
      this.vines = this.vines.filter(v => v.st !== 2 || v.a > 0);
    }
    for (const c of this.clouds) { c.x += c.vx * dt; if (c.x < -c.w) c.x = 400 + c.w / 2; if (c.x > 400 + c.w) c.x = -c.w / 2; }
    for (const b of this.balls) if (!b.dead) this.updBall(b, dt, this.enemy(b));
    if (!A.dead && !B.dead) this.collide(A, B);
    for (const p of this.projs) {
      p.life -= dt; const tg = p.tg;
      if (p.home && !tg.dead) { const a = Math.atan2(tg.y - p.y, tg.x - p.x), cur = Math.atan2(p.vy, p.vx); let df = a - cur; df = Math.atan2(Math.sin(df), Math.cos(df)); const na = cur + df * Math.min(1, dt * p.home), sp = Math.hypot(p.vx, p.vy); p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp; }
      p.x += p.vx * dt; p.y += p.vy * dt; if (Math.random() < .5) this.part(p.x, p.y, p.col, 0, .25, 2);
      if (!tg.dead && Math.hypot(tg.x - p.x, tg.y - p.y) < tg.r * tg.sc + p.r) { p.life = 0; this.hit(tg, p.dmg, p.col); this.burst(p.x, p.y, p.col, 8); }
      if (p.x < -10 || p.x > 410 || p.y < -10 || p.y > 410) p.life = 0;
    }
    this.projs = this.projs.filter(p => p.life > 0);
    for (const tm of [...this.timers]) { tm.t -= dt; if (tm.t <= 0) { tm.done = 1; tm.fn(); } }
    this.timers = this.timers.filter(t => !t.done);
    for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .95; p.vy *= .95; p.vy += p.g * dt; p.life -= dt; }
    this.parts = this.parts.filter(p => p.life > 0);
    for (const r of this.rings) { r.life -= dt; r.r += (r.max - r.r) * Math.min(1, dt * 12); }
    this.rings = this.rings.filter(r => r.life > 0);
    for (const k of ['beams', 'bolts', 'marks', 'ovs']) { for (const x of this[k]) x.life -= dt; this[k] = this[k].filter(x => x.life > 0); }
    for (const t of this.texts) { t.life -= dt; t.y -= (t.big ? 18 : 34) * dt; }
    this.texts = this.texts.filter(t => t.life > 0);
    if (!this.over && this.started && (A.hp <= 0 || B.hp <= 0)) {
      const loser = A.hp <= 0 && B.hp <= 0 ? (A.hp < B.hp ? A : B) : (A.hp <= 0 ? A : B);
      loser.hp = 0; loser.dead = true; this.winner = loser === A ? B : A; this.over = true; this.endT = 1.8;
      for (let i = 0; i < 70; i++) this.part(loser.x, loser.y, i % 2 ? loser.color : '#fff', rnd(80, 420), rnd(.6, 1.4), rnd(2, 6));
      this.ring(loser.x, loser.y, 140, loser.color, .8, 10); this.shake = 18; AUD.sfx('boom');
    }
  }
  draw() {
    const c = this.c, d = this.dpr; c.setTransform(d, 0, 0, d, 0, 0);
    c.fillStyle = '#0d0d16'; c.fillRect(0, 0, 400, 50);
    const [A, B] = this.balls; this.hpBar(A, 10, 0); this.hpBar(B, 240, 1);
    c.textAlign = 'center'; c.fillStyle = this.t > 60 ? '#ff4d6d' : '#fff'; c.font = '15px Jua,sans-serif';
    c.fillText(this.t > 60 ? '서든데스' : `${Math.floor(this.t / 60)}:${String(Math.floor(this.t % 60)).padStart(2, '0')}`, 200, 24);
    c.fillStyle = '#888'; c.font = '10px Jua,sans-serif'; c.fillText(T, 200, 40);
    c.save(); if (this.shake > 0) c.translate(rnd(-this.shake, this.shake) * .5, rnd(-this.shake, this.shake) * .5);
    c.translate(0, 50); c.beginPath(); c.rect(0, 0, 400, 400); c.clip();
    drawMapBG(c, this.map, 400, 400, this.t);
    for (const l of this.lava) drawLava(c, l, this.t);
    for (const v of this.vines) drawVine(c, v, this.t);
    for (const m of this.marks) { const k = 1 - m.life / m.ml; c.strokeStyle = `rgba(255,80,40,${.5 + .5 * Math.sin(k * 30)})`; c.lineWidth = 3; c.setLineDash([8, 6]); c.beginPath(); c.arc(m.x, m.y, m.r, 0, 7); c.stroke(); c.setLineDash([]); c.fillStyle = 'rgba(255,80,40,.15)'; c.fill(); const my = m.y - 300 * (1 - k); c.fillStyle = '#ff8a3d'; c.beginPath(); c.arc(m.x, my, 14, 0, 7); c.fill(); }
    for (const b of this.balls) { if (b.dead) continue; b.trail.forEach(([x, y], i) => { c.globalAlpha = i / b.trail.length * .25; c.fillStyle = b.color; c.beginPath(); c.arc(x, y, b.r * b.sc * (i / b.trail.length), 0, 7); c.fill(); }); c.globalAlpha = 1; }
    for (const b of this.balls) if (!b.dead) this.drawBall(b);
    for (const cl of this.clouds) drawCloud(c, cl.x, cl.y, cl.w, cl.h, .82);
    for (const p of this.projs) { c.fillStyle = p.col; c.shadowColor = p.col; c.shadowBlur = 10; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); c.shadowBlur = 0; c.fillStyle = '#fff'; c.beginPath(); c.arc(p.x, p.y, p.r * .45, 0, 7); c.fill(); }
    for (const bm of this.beams) { const a = bm.life / bm.ml; c.strokeStyle = bm.col; c.globalAlpha = a; c.lineWidth = bm.w * a; c.lineCap = 'round'; c.beginPath(); c.moveTo(bm.x1, bm.y1); c.lineTo(bm.b2.x, bm.b2.y); c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = bm.w * a * .35; c.stroke(); c.globalAlpha = 1; }
    for (const bo of this.bolts) { const R = srand(bo.seed | 0 || 1); c.strokeStyle = '#fff59d'; c.lineWidth = 4 * bo.life / bo.ml + 1; c.beginPath(); let x = bo.x + rnd(-30, 30), y = -10; c.moveTo(x, y); while (y < bo.y) { y += 25; x += (R() - .5) * 40; c.lineTo(y >= bo.y ? bo.x : x, Math.min(y, bo.y)); } c.stroke(); }
    for (const r of this.rings) { c.globalAlpha = r.life / r.ml; c.strokeStyle = r.col; c.lineWidth = r.w; c.beginPath(); c.arc(r.x, r.y, r.r, 0, 7); c.stroke(); } c.globalAlpha = 1;
    for (const p of this.parts) { c.globalAlpha = Math.max(0, p.life / p.ml); c.fillStyle = p.col; c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); } c.globalAlpha = 1;
    for (const ov of this.ovs) {
      const b = ov.b, a = Math.min(1, ov.life / .3, (ov.ml - ov.life) / .2), sz = 110, sk = ov.sk;
      drawEdited(sk.cv.getContext('2d'), sk.el, sk.s.media.edits, 128, 128, 'contain');
      const x = Math.min(400 - sz, Math.max(0, b.x - sz / 2)), y = Math.max(0, b.y - b.r - sz - 10);
      c.globalAlpha = Math.max(0, a); c.drawImage(sk.cv, x, y, sz, sz); c.globalAlpha = 1;
    }
    for (const t of this.texts) {
      const a = Math.min(1, t.life / t.ml * 2), s = t.big ? 1 + .4 * Math.max(0, (t.life - t.ml + .2) / .2) : 1;
      c.globalAlpha = a; c.font = `${t.big ? 18 * s : 14}px 'Black Han Sans',Jua,sans-serif`; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(t.s, t.x, t.y); c.fillStyle = t.col; c.fillText(t.s, t.x, t.y);
    } c.globalAlpha = 1;
    c.restore();
    c.strokeStyle = MAPS[this.map].c; c.lineWidth = 4; c.strokeRect(2, 52, 396, 396);
  }
  hpBar(b, x, side) {
    const c = this.c, w = 150, p = Math.max(0, b.hp / b.max);
    c.textAlign = side ? 'right' : 'left'; c.fillStyle = '#fff'; c.font = '12px Jua,sans-serif';
    c.fillText(b.u.nick.slice(0, 12), side ? x + w : x, 17);
    c.fillStyle = '#2a2a3a'; c.fillRect(x, 24, w, 12);
    const g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, b.color); g.addColorStop(1, '#fff');
    c.fillStyle = p < .3 ? '#ff3b3b' : g; c.fillRect(side ? x + w * (1 - p) : x, 24, w * p, 12);
    if (b.shield > 0) { c.fillStyle = 'rgba(158,231,255,.7)'; c.fillRect(side ? x : x, 37, Math.min(w, b.shield * 2), 3); }
    c.fillStyle = '#000'; c.font = '10px Jua,sans-serif'; c.textAlign = 'center'; c.fillText(`${Math.ceil(b.hp)} / ${b.max}`, x + w / 2, 34);
  }
  drawBall(b) {
    const c = this.c, r = b.r * b.sc;
    c.save(); c.translate(b.x, b.y); c.scale(b.sqx, b.sqy);
    c.shadowColor = b.color; c.shadowBlur = 16; c.fillStyle = b.color; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill(); c.shadowBlur = 0;
    c.save(); c.beginPath(); c.arc(0, 0, r - 3, 0, 7); c.clip();
    if (b.img && b.img.complete && b.img.naturalWidth) c.drawImage(b.img, -r + 3, -r + 3, (r - 3) * 2, (r - 3) * 2); else { c.fillStyle = '#444'; c.fill(); }
    if (b.slowT > 0) { c.fillStyle = 'rgba(150,220,255,.35)'; c.fillRect(-r, -r, r * 2, r * 2); }
    if (b.poisonT > 0) { c.fillStyle = 'rgba(80,255,80,.25)'; c.fillRect(-r, -r, r * 2, r * 2); }
    if (b.flash > 0) { c.fillStyle = `rgba(255,255,255,${b.flash * 5})`; c.fillRect(-r, -r, r * 2, r * 2); }
    c.restore();
    if (b.shield > 0) { c.strokeStyle = 'rgba(158,231,255,.95)'; c.lineWidth = 3; c.fillStyle = 'rgba(158,231,255,.15)'; c.beginPath(); c.arc(0, 0, r + 6, 0, 7); c.fill(); c.stroke(); }
    if (b.growT > 0) { c.strokeStyle = 'rgba(255,200,0,.8)'; c.lineWidth = 2; c.setLineDash([4, 4]); c.beginPath(); c.arc(0, 0, r + 3, this.t * 3, this.t * 3 + 7); c.stroke(); c.setLineDash([]); }
    c.restore();
    if (b.stuckT > 0) { c.strokeStyle = '#2f9e44'; c.lineWidth = 4; for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(b.x, b.y, r + 2, r * .35, i * 1.05 + this.t, 0, 7); c.stroke(); } }
    c.textAlign = 'center'; c.font = '12px Jua,sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.8)';
    const nm = b.u.nick.slice(0, 10); c.strokeText(nm, b.x, b.y - r - 14); c.fillStyle = '#fff'; c.fillText(nm, b.x, b.y - r - 14);
    const w = 44, p = Math.max(0, b.hp / b.max); c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(b.x - w / 2, b.y - r - 10, w, 5); c.fillStyle = b.color; c.fillRect(b.x - w / 2, b.y - r - 10, w * p, 5);
  }
  start() { this.last = performance.now(); const loop = now => { if (this.stopped) return; const dt = Math.min(.033, (now - this.last) / 1000); this.last = now; this.step(dt); this.draw(); this.onFrame && this.onFrame(); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.stopped = true; cancelAnimationFrame(this.raf); this.ovs.forEach(o => o.sk.el && o.sk.el.pause && o.sk.el.pause()); }
  startRec() {
    try {
      const st = this.cv.captureStream(30); if (AUD.dest) AUD.dest.stream.getAudioTracks().forEach(t => st.addTrack(t));
      const mt = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      this.rec = new MediaRecorder(st, mt ? { mimeType: mt, videoBitsPerSecond: 2.5e6 } : undefined); this.chunks = [];
      this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data); this.rec.start(500);
    } catch (e) { this.rec = null; }
  }
  stopRec() {
    return new Promise(res => {
      if (!this.rec || this.rec.state === 'inactive') return res(null);
      this.rec.onstop = () => res(new Blob(this.chunks, { type: (this.rec.mimeType || 'video/webm').split(';')[0] })); this.rec.stop();
    });
  }
}

// 게임용 스킬 준비 (소리·영상 미리 불러오기)
async function prepSkills(u) {
  return Promise.all(loadout(u).map(async s => {
    const sk = { s, cd: skillCD(s), t: skillCD(s) * (.35 + Math.random() * .3) };
    if (s.sound && s.sound.startsWith('k_')) sk.buf = await AUD.load(s.sound);
    if (s.media) {
      try {
        const url = await blobURL(s.media.key); if (url) {
          sk.el = await loadEl(url, s.media.kind); sk.cv = document.createElement('canvas'); sk.cv.width = sk.cv.height = 128;
          if (s.media.edits.key && s.media.edits.key.mode === 'ai') SEG.load().catch(() => { });
        }
      } catch (e) { sk.el = null; }
    }
    return sk;
  }));
}
function loadImg(src) { return new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(i); i.src = src; }); }

// ===== 매칭 / VS / 맵 선택 =====
screen('match', el => {
  const u = me(), tm = []; const later = (f, t) => tm.push(setTimeout(f, t));
  el._leave = () => { tm.forEach(clearTimeout); clearInterval(el._iv); };
  el.innerHTML = `<div class="match"><button class="icon-btn mt-x" data-back>${ic('x')}</button>
    <div class="radar"><div class="radar-sweep"></div><div class="radar-ring r1"></div><div class="radar-ring r2"></div>${avImg(u, 'radar-me')}</div>
    <h2 class="mt-title">상대를 찾는 중<span class="dots"><i>.</i><i>.</i><i>.</i></span></h2><div class="mt-time">0:00</div></div>`;
  let s = 0; el._iv = setInterval(() => { s++; const t = $('.mt-time', el); if (t) t.textContent = `0:${String(s).padStart(2, '0')}`; }, 1000);
  const pool = Object.values(D.users).filter(x => x.uid !== u.uid && !x.banned);
  const opp = pick(pool);
  later(() => {
    clearInterval(el._iv); AUD.sfx('ding');
    el.innerHTML = `<div class="vs"><div class="vs-bg"><i class="vs-top"></i><i class="vs-bot"></i></div>
      <div class="vs-card opp">${avImg(opp, 'av-c')}<div><b>${nameHTML(opp)}</b><small>@${esc(opp.handle)}</small><small class="muted">${opp.wins}승</small></div></div>
      <div class="vs-mid">VS</div>
      <div class="vs-card me"><div><b>${nameHTML(u)}</b><small>@${esc(u.handle)}</small><small class="muted">${u.wins}승</small></div>${avImg(u, 'av-c')}</div>
      <div class="vs-found">매칭 성공!</div></div>`;
    later(() => AUD.sfx('boom'), 450);
    later(() => mapSelect(el, u, opp, later), 2600);
  }, 1600 + Math.random() * 1600);
});
function mapSelect(el, u, opp, later) {
  const keys = [...MAP_KEYS, 'random'];
  el.innerHTML = `<div class="ms"><h2 class="ms-title">맵 선택</h2><div class="ms-timer">10</div>
    <div class="ms-grid">${keys.map(k => k === 'random' ? `<button class="ms-card rnd" data-k="random"><div class="ms-dice">${ic('dice', 46)}</div><b>랜덤</b><small>무작위로 골라요</small></button>` : `<button class="ms-card" data-k="${k}"><canvas width="200" height="120"></canvas><b>${MAPS[k].name}</b><small>${MAPS[k].desc}</small></button>`).join('')}</div>
    <div class="ms-picks"><div class="ms-pick opp">${avImg(opp, 'av-xs')}<span>상대: <b id="op-pick">고르는 중...</b></span></div><div class="ms-pick me">${avImg(u, 'av-xs')}<span>나: <b id="my-pick">-</b></span></div></div></div>`;
  $$('.ms-card canvas', el).forEach(cv => mapPreview(cv, cv.parentElement.dataset.k));
  let mine = null, theirs = null, left = 10, done = false;
  const iv = setInterval(() => { left--; const t = $('.ms-timer', el); if (t) t.textContent = left; if (left <= 0) { clearInterval(iv); if (!mine) choose('random'); } }, 1000);
  const oldLeave = el._leave; el._leave = () => { clearInterval(iv); oldLeave(); };
  later(() => { theirs = pick(MAP_KEYS); $('#op-pick', el).textContent = MAPS[theirs].name; $(`.ms-card[data-k="${theirs}"]`, el).classList.add('opp-pick'); tryFinal(); }, 1200 + Math.random() * 2500);
  const choose = k => {
    if (mine) return; clearInterval(iv);
    const real = k === 'random' ? pick(MAP_KEYS) : k; mine = real;
    $('#my-pick', el).textContent = (k === 'random' ? '랜덤 → ' : '') + MAPS[real].name;
    $(`.ms-card[data-k="${k}"]`, el).classList.add('my-pick'); if (k === 'random') $(`.ms-card[data-k="${real}"]`, el).classList.add('my-pick');
    tryFinal();
  };
  $$('.ms-card', el).forEach(b => b.onclick = () => choose(b.dataset.k));
  function tryFinal() {
    if (!mine || !theirs || done) return; done = true;
    const final = Math.random() < .5 ? mine : theirs, cand = [...new Set([mine, theirs])];
    $('.ms-title', el).textContent = cand.length > 1 ? '맵 결정 중...' : '맵 결정!';
    let i = 0, n = cand.length > 1 ? (cand[0] === final ? 9 : 10) : 1, delay = 90;
    const spin = () => {
      $$('.ms-card', el).forEach(c => c.classList.remove('spin'));
      const k = cand.length > 1 ? cand[i % 2] : final; $(`.ms-card[data-k="${k}"]`, el).classList.add('spin'); AUD.sfx('beep');
      i++; if (i < n) { delay *= 1.18; later(spin, delay); }
      else { $(`.ms-card[data-k="${final}"]`, el).classList.add('final'); $('.ms-title', el).textContent = MAPS[final].name + '!'; later(() => go('game', { opp: opp.uid, map: final }, 'zoom'), 1100); }
    };
    later(spin, 500);
  }
}

// ===== 게임 화면 =====
screen('game', async (el, p) => {
  const u = me(), o = D.users[p.opp];
  const card = (x, side) => `<div class="g-card ${side}">${avImg(x, 'av-c')}<div class="g-nm"><div class="g-name">${nameHTML(x)}</div><small>@${esc(x.handle)}</small>
    ${side === 'opp' ? `<div class="g-acts">${u.dev ? `<button class="mini-ban" data-ban>${ic('ban', 13)} 밴</button>` : ''}<button class="mini-btn" data-rep>${ic('flag', 13)} 신고</button></div>` : ''}</div></div>`;
  el.innerHTML = `<div class="game"><div class="g-top"><button class="icon-btn g-quit">${ic('x')}</button><span class="g-map" style="color:${MAPS[p.map].c}">${MAPS[p.map].name}</span><span class="rec-dot">REC</span></div>
    <div class="g-cv-wrap"><canvas class="g-cv"></canvas><div class="g-count"></div></div>
    <div class="g-cards">${card(o, 'opp')}${card(u, 'me')}</div>
    <div class="g-cds"><div class="g-cd-row opp"></div><div class="g-cd-row me"></div></div></div>`;
  const [mySk, opSk, myImg, opImg] = await Promise.all([prepSkills(u), prepSkills(o), loadImg(avatarSrc(u)), loadImg(avatarSrc(o))]);
  if (!el.isConnected) return;
  const cdHTML = (sks, big) => sks.length ? sks.map((s, i) => `<div class="cd ${big ? 'big' : ''}" style="--c:${s.s.color}" data-i="${i}"><div class="cd-ring"><span>${ic(COMPS[s.s.comps[0]][1], big ? 22 : 15)}</span></div>${big ? `<small>${esc(s.s.name)}</small>` : ''}<em></em></div>`).join('') : '<small class="muted">스킬 없음</small>';
  $('.g-cd-row.opp', el).innerHTML = cdHTML(opSk, false); $('.g-cd-row.me', el).innerHTML = cdHTML(mySk, true);
  const g = new Game($('.g-cv', el), { map: p.map, me: { u, skills: mySk, img: myImg }, opp: { u: o, skills: opSk, img: opImg }, onEnd: w => finish(w) });
  el._leave = () => { g.stop(); g.stopRec(); };
  const cds = [[opSk, $$('.g-cd-row.opp .cd', el)], [mySk, $$('.g-cd-row.me .cd', el)]];
  g.onFrame = () => cds.forEach(([sks, els]) => sks.forEach((s, i) => { const e = els[i]; if (!e) return; const pr = 1 - Math.max(0, s.t) / s.cd; e.style.setProperty('--p', pr); e.classList.toggle('ready', pr > .97); const em = e.querySelector('em'); em.textContent = s.t > .05 ? s.t.toFixed(1) : ''; }));
  g.start();
  if (u.dev) $('[data-ban]', el).onclick = () => banModal(o.handle);
  $('[data-rep]', el).onclick = () => reportUser(o);
  $('.g-quit', el).onclick = async () => { if (g.over) return; if (await ask('게임을 나가면 패배로 기록돼요. 나갈까요?', '나가기', true)) { g.over = true; g.stop(); g.stopRec(); record(false); reset('main', { tab: 'home' }, 'back'); } };
  // 3, 2, 1 카운트다운
  const cnt = $('.g-count', el);
  for (const n of ['3', '2', '1', '시작!']) {
    if (!el.isConnected) return; cnt.innerHTML = `<span class="${n.length > 1 ? 'go' : ''}">${n}</span>`; AUD.sfx(n.length > 1 ? 'go' : 'beep'); await new Promise(r => setTimeout(r, n.length > 1 ? 650 : 850));
  }
  cnt.innerHTML = ''; g.started = true; g.startRec();
  function record(win) {
    u.wins += win ? 1 : 0; u.losses += win ? 0 : 1; if (win) u.coins += 1;
    o.wins += win ? 0 : 1; o.losses += win ? 1 : 0; if (!win) o.coins += 1; save('users');
  }
  async function finish(w) {
    const win = w.side === 1; record(win); AUD.sfx(win ? 'win' : 'lose');
    let thumb = ''; try { const t = document.createElement('canvas'); t.width = 180; t.height = 202; t.getContext('2d').drawImage(g.cv, 0, 0, 180, 202); thumb = t.toDataURL('image/jpeg', .6); } catch (e) { }
    const res = h(`<div class="result ${win ? 'win' : 'lose'}"><div class="res-in">${win ? '<div class="confetti">' + Array.from({ length: 30 }, (_, i) => `<i style="--x:${rnd(-160, 160)}px;--d:${rnd(0, .6)}s;--c:${pick(['#25F4EE', '#FE2C55', '#FFD700', '#7CFF6B', '#fff'])}"></i>`).join('') + '</div>' : ''}
      <div class="res-title">${win ? '승리!' : '패배'}</div>${avImg(w.u, 'av-c res-av')}<div class="res-name">${nameHTML(w.u)} 승리</div>
      ${win ? `<div class="res-coin">${COIN}<b>+1 코인</b></div>` : '<div class="muted">다음엔 이길 수 있어요!</div>'}
      <div class="res-saved">${ic('film', 16)} 플레이 영상이 자동 저장됐어요</div>
      <div class="res-btns"><button class="btn-main" data-a="again">${ic('rotate', 18)} 다시하기</button><button class="btn-sec" data-a="video">${ic('film', 18)} 영상 만들기</button><button class="btn-ghost" data-a="home">${ic('home', 18)} 홈</button></div></div></div>`);
    await new Promise(r => setTimeout(r, 400)); const blob = await g.stopRec(); g.stop();
    let rec = null;
    if (blob && blob.size > 1000) {
      const key = await putBlob(blob, 'r');
      rec = { id: uid6(), key, uid: u.uid, map: p.map, opp: o.uid, win, t: Date.now(), dur: Math.round(g.t), thumb };
      D.recs.unshift(rec); const mine = D.recs.filter(r => r.uid === u.uid);
      if (mine.length > 20) { const old = mine[mine.length - 1]; if (!D.posts.some(x => x.key === old.key)) IDB.del(old.key); D.recs = D.recs.filter(r => r !== old); }
      save('recs');
    } else $('.res-saved', res).textContent = '이 브라우저는 영상 녹화를 지원하지 않아요';
    if (!el.isConnected) return; el.appendChild(res);
    $$('[data-a]', res).forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'again') { NAV.stack = [{ name: 'main', p: { tab: 'home' } }]; show('match', {}, 'zoom'); }
      if (a === 'home') reset('main', { tab: 'home' }, 'fade');
      if (a === 'video') { NAV.stack = [{ name: 'main', p: { tab: 'home' } }]; if (rec) show('upload', { key: rec.key, kind: 'video' }); else show('create'); }
    });
  }
});
