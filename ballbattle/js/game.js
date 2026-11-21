'use strict';
// ===== 맵 / 스킬 효과 / 게임 엔진 / 매칭 =====
const MAPS = {
  arena: { name: '일반', desc: '함정 없는 깔끔한 박스', bg: '#ffffff' },
  jungle: { name: '정글', desc: '줄기에 걸리면 잠시 멈춰요. 빠져나오면 줄기는 사라져요', bg: '#f1f8f1' },
  lava: { name: '용암', desc: '용암에 닿으면 1초에 HP 1 감소', bg: '#fff6f1' },
  sky: { name: '하늘', desc: '구름에 닿으면 느려져요', bg: '#eef6ff' },
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
const GRAY = '#9aa0a6';
// 프로필 사진에서 공 색깔 뽑기 (사진이 없으면 회색)
function ballColor(img) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) { const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B), s = mx ? (mx - mn) / mx : 0, wt = s * s * (mx / 255) + 1e-4; r += R * wt; g += G * wt; b += B * wt; w += wt; }
    r /= w * 255; g /= w * 255; b /= w * 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn; if (!mx || dd / mx < .25) return GRAY;
    let h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h = (h * 60 + 360) % 360;
    return `hsl(${h | 0},75%,48%)`;
  } catch (e) { return GRAY; }
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

function drawMapBG(c, mk, W, H, t = 0) {
  c.fillStyle = MAPS[mk].bg; c.fillRect(0, 0, W, H); const R = srand(7); c.save();
  if (mk === 'jungle') for (let i = 0; i < 18; i++) { c.fillStyle = 'rgba(80,160,90,.12)'; c.beginPath(); c.ellipse(R() * W, R() * H, 8 + R() * 14, 4 + R() * 5, R() * 6 + Math.sin(t + i) * .08, 0, 7); c.fill(); }
  if (mk === 'lava') { c.strokeStyle = 'rgba(255,120,60,.18)'; c.lineWidth = 2; for (let i = 0; i < 10; i++) { let x = R() * W, y = R() * H; c.beginPath(); c.moveTo(x, y); for (let j = 0; j < 4; j++) { x += (R() - .5) * W * .2; y += (R() - .5) * H * .2; c.lineTo(x, y); } c.stroke(); } }
  if (mk === 'sky') { c.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse((R() * W + t * 6) % (W + 60) - 30, R() * H, 34, 11, 0, 0, 7); c.fill(); } }
  c.restore();
}
function drawCloud(c, x, y, w, hh, a = .95) {
  c.save(); c.globalAlpha = a; c.fillStyle = '#fff'; c.strokeStyle = '#cfe2f5'; c.lineWidth = 2;
  c.beginPath(); c.ellipse(x, y + hh * .15, w / 2, hh * .35, 0, 0, 7); c.arc(x - w * .2, y, hh * .35, 0, 7); c.arc(x + w * .12, y - hh * .12, hh * .45, 0, 7); c.arc(x + w * .32, y + hh * .05, hh * .3, 0, 7);
  c.stroke(); c.fill(); c.restore();
}
function drawLava(c, l, t) {
  const r = l.r * (1 + .05 * Math.sin(t * 3 + l.ph)), g = c.createRadialGradient(l.x, l.y, 2, l.x, l.y, r);
  g.addColorStop(0, '#ffe066'); g.addColorStop(.45, '#ff922b'); g.addColorStop(1, '#f03e3e');
  c.fillStyle = g; c.beginPath(); c.arc(l.x, l.y, r, 0, 7); c.fill();
  c.fillStyle = 'rgba(255,245,200,.8)'; for (let i = 0; i < 3; i++) { const a = t * 1.5 + i * 2 + l.ph; c.beginPath(); c.arc(l.x + Math.cos(a) * r * .45, l.y + Math.sin(a * 1.3) * r * .45, 2 + Math.sin(t * 4 + i) * 1.5, 0, 7); c.fill(); }
}
function drawVine(c, v, t) {
  c.save(); c.globalAlpha = Math.max(0, v.a); c.strokeStyle = '#2f9e44'; c.lineWidth = 3.5; c.lineCap = 'round';
  const tight = v.st === 1 ? .7 : 1;
  for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(v.x, v.y, v.r * tight * (.55 + .45 * Math.abs(Math.sin(v.ph + i))), v.r * .35 * tight, i * Math.PI / 3 + Math.sin(t + i) * .1, 0, 7); c.stroke(); }
  c.fillStyle = '#51cf66'; for (let i = 0; i < 5; i++) { const a = i * 1.26 + v.ph; c.beginPath(); c.ellipse(v.x + Math.cos(a) * v.r * .8, v.y + Math.sin(a) * v.r * .8, 6, 3, a, 0, 7); c.fill(); }
  c.restore();
}
function mapPreview(cv, mk) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height; drawMapBG(c, mk, W, H, 0); const s = W / 400;
  if (mk === 'jungle') [[100, 120], [280, 260], [200, 330]].forEach(([x, y]) => drawVine(c, { x: x * s, y: y * s, r: 26 * s, a: 1, st: 0, ph: x }, 0));
  if (mk === 'lava') [[110, 140, 40], [290, 270, 34], [200, 340, 28]].forEach(([x, y, r]) => drawLava(c, { x: x * s, y: y * s, r: r * s, ph: x }, 0));
  if (mk === 'sky') [[120, 110], [280, 230], [150, 330]].forEach(([x, y]) => drawCloud(c, x * s, y * s, 110 * s, 46 * s));
  c.lineWidth = 4; c.strokeStyle = '#111'; c.strokeRect(2, 2, W - 4, H - 4);
}

// 캔버스 배치: 위 문구 / 가운데 박스(400x400) / 아래 이름·체력·쿨타임 (녹화 영상에도 그대로 나옴)
const GW = 420, GH = 556, BX = 10, BY = 44;
class Game {
  constructor(cv, o) {
    this.cv = cv; this.c = cv.getContext('2d'); this.o = o; this.map = o.map;
    this.dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = GW * this.dpr; cv.height = GH * this.dpr;
    this.t = 0; this.parts = []; this.projs = []; this.rings = []; this.beams = []; this.texts = []; this.timers = []; this.marks = []; this.ovs = []; this.bolts = [];
    this.shake = 0; this.over = false; this.started = false; this.lastCol = -1;
    this.balls = [this.mkBall(0, o.opp), this.mkBall(1, o.me)];
    this.vines = []; this.lava = []; this.clouds = []; this.vineT = 5;
    this.place = r => { for (let i = 0; i < 60; i++) { const x = 45 + Math.random() * 310, y = 45 + Math.random() * 310; if (this.balls.every(b => Math.hypot(b.x - x, b.y - y) > r + 60) && this.lava.every(l => Math.hypot(l.x - x, l.y - y) > r + l.r + 10)) return [x, y]; } return [200, 200]; };
    if (this.map === 'jungle') for (let i = 0; i < 4; i++) this.addVine();
    if (this.map === 'lava') for (let i = 0; i < 4; i++) { const r = 28 + Math.random() * 16, [x, y] = this.place(r); this.lava.push({ x, y, r, ph: Math.random() * 6 }); }
    if (this.map === 'sky') for (let i = 0; i < 4; i++) this.clouds.push({ x: Math.random() * 400, y: 55 + i * 92 + Math.random() * 20, w: 95 + Math.random() * 40, h: 42 + Math.random() * 12, vx: (Math.random() < .5 ? -1 : 1) * (15 + Math.random() * 20) });
  }
  mkBall(side, p) {
    const a = Math.random() * Math.PI * 2;
    return {
      side, u: p.u, img: p.img, color: p.color || GRAY, x: side ? 300 : 100, y: side ? 300 : 100, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, r: 26, sc: 1, sqx: 1, sqy: 1,
      hp: 150, max: 150, lag: 150, sk: p.skills, shield: 0, shieldT: 0, slowT: 0, stuckT: 0, immT: 0, poisonT: 0, poisonD: 0,
      growT: 0, growDmg: 0, dashT: 0, dashDmg: 0, flash: 0, trail: [], cloud: false, lavaAcc: 0, dotAcc: 0, dead: false,
      wa: Math.random() * 7, wd: Math.random() < .5 ? -1 : 1, wcd: 0,
    };
  }
  addVine() { const [x, y] = this.place(28); this.vines.push({ x, y, r: 26, st: 0, a: 0, hold: null, ph: Math.random() * 6 }); }
  enemy(b) { return this.balls[b.side ? 0 : 1]; }
  part(x, y, col, sp = 60, life = .6, size = 3, g = 0) { const a = Math.random() * 7, v = Math.random() * sp; this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col, life, ml: life, size, g }); }
  burst(x, y, col, n = 10, sp = 160) { for (let i = 0; i < n; i++) this.part(x, y, col, sp, rnd(.3, .7), rnd(2, 4)); }
  ring(x, y, max, col, life = .45, w = 3) { this.rings.push({ x, y, r: 4, max, col, life, ml: life, w }); }
  text(x, y, s, col, big) { this.texts.push({ x, y, s, col, life: big ? 1.1 : .8, ml: big ? 1.1 : .8, big }); }
  later(t, fn) { this.timers.push({ t, fn }); }
  squash(b, ax) { if (ax) { b.sqx = .72; b.sqy = 1.22; } else { b.sqx = 1.22; b.sqy = .72; } }
  hit(b, dmg, col = '#333', snd = 'thud') {
    if (this.over || b.dead || dmg <= 0) return 0; let d = dmg;
    if (b.shield > 0) { const a = Math.min(b.shield, d); b.shield -= a; d -= a; this.ring(b.x, b.y, b.r * b.sc + 16, '#74c0fc', .3, 2); if (d <= 0) { this.text(b.x, b.y - b.r - 10, '막음', '#1c7ed6'); return 0; } }
    b.hp -= d; b.flash = .12; this.text(b.x + rnd(-12, 12), b.y - b.r * b.sc - 8, '-' + Math.round(d), '#333');
    if (d >= 10) this.shake = Math.min(10, d * .5); if (snd) AUD.sfx(snd); return d;
  }
  shoot(b, e, ang, sp, r, dmg, col, home = 0) { this.projs.push({ x: b.x + Math.cos(ang) * b.r, y: b.y + Math.sin(ang) * b.r, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r, dmg, col, tg: e, life: 2.5, home }); }
  cast(b, e, sk) {
    const s = sk.s, pm = skillPower(s) * (sk.crit ? 2 : 1), col = s.color;
    if (sk.buf) AUD.playBuf(sk.buf); else AUD.skill(s.sound);
    this.text(b.x, b.y - b.r * b.sc - 26, sk.crit ? '크리티컬 ' + s.name : s.name, sk.crit ? '#e03131' : col, true); if (sk.crit) this.shake = 6; this.ring(b.x, b.y, b.r * 2.6, col, .5, 3);
    if (sk.el) {
      if (sk.el.tagName === 'VIDEO') { try { sk.el.currentTime = s.media.edits.start || 0; sk.el.playbackRate = s.media.edits.speed || 1; sk.el.play().catch(() => { }); } catch (x) { } }
      this.ovs.push({ b, sk, life: 1.8, ml: 1.8 });
    }
    s.comps.forEach((c, i) => this.later(i * .12, () => !this.over && !b.dead && this.comp(c, b, e, pm, col)));
  }
  comp(c, b, e, pm, col) {
    const ang = Math.atan2(e.y - b.y, e.x - b.x), dist = Math.hypot(e.x - b.x, e.y - b.y);
    switch (c) {
      case 'proj': AUD.sfx('pew'); for (let i = -1; i <= 1; i++) this.shoot(b, e, ang + i * .2, 380, 6, 5 * pm, col, 1.5); break;
      case 'dash': b.dashT = .55; b.dashDmg = 10 * pm; AUD.sfx('whoosh'); break;
      case 'boom': this.ring(b.x, b.y, 110, col, .5, 5); this.burst(b.x, b.y, col, 26, 280); AUD.sfx('boom');
        if (dist < 110 + e.r) { this.hit(e, 12 * pm, col, null); e.vx += Math.cos(ang) * 400; e.vy += Math.sin(ang) * 400; } break;
      case 'heal': { AUD.sfx('heal'); const v = Math.min(b.max - b.hp, 10 * pm); b.hp += v; this.text(b.x, b.y - b.r - 8, '+' + Math.round(v), '#2f9e44'); for (let i = 0; i < 12; i++) this.part(b.x + rnd(-b.r, b.r), b.y + rnd(-b.r, b.r), '#51cf66', 20, .8, 3, -60); break; }
      case 'shield': AUD.sfx('shield'); b.shield = 15 * pm; b.shieldT = 4; this.ring(b.x, b.y, b.r + 14, '#74c0fc', .5, 3); break;
      case 'laser': this.beams.push({ x1: b.x, y1: b.y, b2: e, col, life: .35, ml: .35, w: 7 }); this.hit(e, 9 * pm, col, null); AUD.sfx('laser'); break;
      case 'freeze': AUD.sfx('freeze'); e.slowT = Math.min(4, 1.5 * pm); for (let i = 0; i < 14; i++) this.part(e.x, e.y, '#74c0fc', 120, .7, 3); this.text(e.x, e.y + e.r + 12, '느려짐', '#1c7ed6'); break;
      case 'poison': AUD.sfx('poison'); e.poisonT = 3; e.poisonD = 3 * pm; this.burst(e.x, e.y, '#69db7c', 12); break;
      case 'grow': AUD.sfx('grow'); b.growT = 3; b.growDmg = 6 * pm; break;
      case 'bolt': this.bolts.push({ x: e.x, y: e.y, life: .35, ml: .35, seed: Math.random() * 1e4 }); this.hit(e, 10 * pm, '#fab005', null); this.shake = 5; AUD.sfx('zap'); break;
      case 'vamp': { const d = this.hit(e, 7 * pm, '#e03131', 'vamp'); this.beams.push({ x1: b.x, y1: b.y, b2: e, col: '#ff6b6b', life: .4, ml: .4, w: 3 }); if (d) { b.hp = Math.min(b.max, b.hp + d); this.text(b.x, b.y - b.r - 8, '+' + Math.round(d), '#2f9e44'); } break; }
      case 'tele': { AUD.sfx('tele'); this.burst(b.x, b.y, col, 14); const a = Math.random() * 7, r = e.r + b.r + 6; b.x = Math.min(400 - b.r, Math.max(b.r, e.x + Math.cos(a) * r)); b.y = Math.min(400 - b.r, Math.max(b.r, e.y + Math.sin(a) * r)); this.burst(b.x, b.y, col, 14); this.ring(b.x, b.y, 50, col); this.hit(e, 6 * pm, col, 'bang'); break; }
      case 'meteor': { AUD.sfx('meteor'); const tx = e.x, ty = e.y; this.marks.push({ x: tx, y: ty, r: 55, life: .8, ml: .8 }); this.later(.8, () => { this.ring(tx, ty, 70, '#ff922b', .5, 5); this.burst(tx, ty, '#ff922b', 30, 300); AUD.sfx('boom'); this.shake = 8; if (Math.hypot(e.x - tx, e.y - ty) < 55 + e.r) this.hit(e, 16 * pm, '#ff922b', null); }); break; }
    }
  }
  updBall(b, dt, e) {
    b.flash = Math.max(0, b.flash - dt); b.wcd -= dt;
    for (const k of ['shieldT', 'slowT', 'immT', 'poisonT', 'growT', 'dashT']) b[k] = Math.max(0, b[k] - dt);
    if (b.shieldT <= 0) b.shield = 0;
    b.sc += ((b.growT > 0 ? 1.5 : 1) - b.sc) * Math.min(1, dt * 8);
    b.sqx += (1 - b.sqx) * Math.min(1, dt * 10); b.sqy += (1 - b.sqy) * Math.min(1, dt * 10);
    const r = b.r * b.sc, live = this.started && !this.over;
    if (b.poisonT > 0 && live) { const d = b.poisonD * dt; b.hp -= d; b.dotAcc += d; if (b.dotAcc >= 2) { this.text(b.x, b.y - r, '-' + Math.round(b.dotAcc), '#2f9e44'); b.dotAcc = 0; } if (Math.random() < .3) this.part(b.x + rnd(-r, r), b.y + rnd(-r, r), '#69db7c', 0, .5, 3, -20); }
    if (this.map === 'lava' && live && this.lava.some(l => Math.hypot(l.x - b.x, l.y - b.y) < l.r + r * .6)) {
      b.hp -= dt; b.lavaAcc += dt; if (b.lavaAcc >= 1) { b.lavaAcc -= 1; this.text(b.x, b.y - r, '-1', '#f76707'); }
      if (Math.random() < .5) this.part(b.x + rnd(-r, r), b.y + r * .5, '#ff922b', 0, .6, 3, -60);
    }
    b.cloud = this.map === 'sky' && this.clouds.some(c => ((b.x - c.x) / (c.w / 2 + r * .4)) ** 2 + ((b.y - c.y) / (c.h / 2 + r * .4)) ** 2 < 1);
    if (this.map === 'jungle') {
      if (b.stuckT > 0) {
        b.stuckT -= dt; const v = this.vines.find(v => v.hold === b);
        if (v) { b.x += (v.x - b.x) * Math.min(1, dt * 6); b.y += (v.y - b.y) * Math.min(1, dt * 6); }
        if (b.stuckT <= 0) { if (v) { v.st = 2; v.hold = null; } b.immT = .6; this.burst(b.x, b.y, '#51cf66', 14); this.text(b.x, b.y - r - 8, '탈출', '#2f9e44'); }
      } else if (b.immT <= 0 && this.started) {
        const v = this.vines.find(v => v.st === 0 && v.a > .8 && Math.hypot(v.x - b.x, v.y - b.y) < v.r + r * .6);
        if (v) { v.st = 1; v.hold = b; b.stuckT = 1.6; this.text(b.x, b.y - r - 8, '걸림', '#2f9e44'); AUD.sfx('vine'); }
      }
    }
    if (b.stuckT <= 0 && this.started) {
      const sp = 160 * (b.slowT > 0 ? .5 : 1) * (b.cloud ? .4 : 1) * (b.dashT > 0 ? 2.8 : 1);
      if (b.dashT > 0) { const a = Math.atan2(e.y - b.y, e.x - b.x), k = Math.min(1, dt * 10); b.vx += (Math.cos(a) * sp - b.vx) * k; b.vy += (Math.sin(a) * sp - b.vy) * k; this.part(b.x, b.y, b.color, 10, .4, 3); }
      const m = Math.hypot(b.vx, b.vy) || 1, nm = m + (sp - m) * Math.min(1, dt * 4); b.vx = b.vx / m * nm; b.vy = b.vy / m * nm;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx); this.squash(b, 1); } else if (b.x > 400 - r) { b.x = 400 - r; b.vx = -Math.abs(b.vx); this.squash(b, 1); }
      if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy); this.squash(b, 0); } else if (b.y > 400 - r) { b.y = 400 - r; b.vy = -Math.abs(b.vy); this.squash(b, 0); }
    }
    b.trail.push([b.x, b.y]); if (b.trail.length > 8) b.trail.shift();
    // 기본 공격: 공에 달린 막대가 돌면서 자동으로 때림
    if (this.started) b.wa += b.wd * dt * (b.dashT > 0 ? 7 : 3.6);
    if (!live || b.dead) return;
    const L = r + 36 * b.sc, x1 = b.x + Math.cos(b.wa) * r, y1 = b.y + Math.sin(b.wa) * r, x2 = b.x + Math.cos(b.wa) * L, y2 = b.y + Math.sin(b.wa) * L;
    if (b.wcd <= 0 && segDist(e.x, e.y, x1, y1, x2, y2) < e.r * e.sc) {
      b.wcd = .45; b.wd *= -1; this.hit(e, 3, b.color, 'hit'); this.burst(x2, y2, '#adb5bd', 8, 140);
      const a = Math.atan2(e.y - b.y, e.x - b.x); e.vx += Math.cos(a) * 120; e.vy += Math.sin(a) * 120;
    }
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
      this.hit(B, dA, A.color, 'bump'); this.hit(A, dB, B.color, null); this.burst(cx, cy, '#ced4da', 10, 200); this.ring(cx, cy, 30, '#ced4da', .25, 2);
      this.squash(A, Math.abs(nx) > Math.abs(ny) ? 1 : 0); this.squash(B, Math.abs(nx) > Math.abs(ny) ? 1 : 0);
    }
  }
  step(dt) {
    if (this.over) { this.endT -= dt; dt *= .3; if (this.endT <= 0 && !this.ended) { this.ended = true; this.o.onEnd(this.winner); } }
    if (this.started) this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    const [A, B] = this.balls;
    for (const b of this.balls) b.lag += (Math.max(0, b.hp) - b.lag) * Math.min(1, dt * 2.5);
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
      p.x += p.vx * dt; p.y += p.vy * dt; if (Math.random() < .4) this.part(p.x, p.y, p.col, 0, .25, 2);
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
      for (let i = 0; i < 60; i++) this.part(loser.x, loser.y, i % 2 ? loser.color : '#ced4da', rnd(80, 400), rnd(.6, 1.4), rnd(2, 6));
      this.ring(loser.x, loser.y, 140, loser.color, .8, 6); this.shake = 14; AUD.sfx('boom');
    }
  }
  draw() {
    const c = this.c, d = this.dpr; c.setTransform(d, 0, 0, d, 0, 0);
    c.fillStyle = '#fff'; c.fillRect(0, 0, GW, GH);
    c.textAlign = 'center'; c.fillStyle = '#a5a5a5'; c.font = '600 15px "IBM Plex Sans KR",sans-serif'; c.fillText(`created by ${BB_CONFIG.CREDIT}`, GW / 2, 28);
    c.font = '600 12px "IBM Plex Sans KR",sans-serif'; c.textAlign = 'left'; c.fillStyle = '#b5b5b5'; c.fillText(MAPS[this.map].name, BX, 28);
    c.textAlign = 'right'; c.fillStyle = '#b5b5b5'; c.fillText(`${Math.floor(this.t / 60)}:${String(Math.floor(this.t % 60)).padStart(2, '0')}`, GW - BX, 28);
    c.save(); if (this.shake > 0) c.translate(rnd(-this.shake, this.shake) * .5, rnd(-this.shake, this.shake) * .5);
    c.translate(BX, BY); c.beginPath(); c.rect(0, 0, 400, 400); c.clip();
    drawMapBG(c, this.map, 400, 400, this.t);
    for (const l of this.lava) drawLava(c, l, this.t);
    for (const v of this.vines) drawVine(c, v, this.t);
    for (const m of this.marks) { const k = 1 - m.life / m.ml; c.strokeStyle = `rgba(240,62,62,${.4 + .4 * Math.sin(k * 30)})`; c.lineWidth = 2; c.setLineDash([6, 6]); c.beginPath(); c.arc(m.x, m.y, m.r, 0, 7); c.stroke(); c.setLineDash([]); c.fillStyle = 'rgba(240,62,62,.08)'; c.fill(); c.fillStyle = '#ff922b'; c.beginPath(); c.arc(m.x, m.y - 300 * (1 - k), 12, 0, 7); c.fill(); }
    for (const b of this.balls) { if (b.dead) continue; b.trail.forEach(([x, y], i) => { c.globalAlpha = i / b.trail.length * .12; c.fillStyle = b.color; c.beginPath(); c.arc(x, y, b.r * b.sc, 0, 7); c.fill(); }); c.globalAlpha = 1; }
    for (const b of this.balls) if (!b.dead) this.drawBall(b);
    for (const cl of this.clouds) drawCloud(c, cl.x, cl.y, cl.w, cl.h, .9);
    for (const p of this.projs) { c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); }
    for (const bm of this.beams) { const a = bm.life / bm.ml; c.strokeStyle = bm.col; c.globalAlpha = a; c.lineWidth = bm.w * a; c.lineCap = 'round'; c.beginPath(); c.moveTo(bm.x1, bm.y1); c.lineTo(bm.b2.x, bm.b2.y); c.stroke(); c.globalAlpha = 1; }
    for (const bo of this.bolts) { const R = srand(bo.seed | 0 || 1); c.strokeStyle = '#fab005'; c.lineWidth = 3 * bo.life / bo.ml + 1; c.beginPath(); let x = bo.x + rnd(-30, 30), y = -10; c.moveTo(x, y); while (y < bo.y) { y += 25; x += (R() - .5) * 40; c.lineTo(y >= bo.y ? bo.x : x, Math.min(y, bo.y)); } c.stroke(); }
    for (const r of this.rings) { c.globalAlpha = r.life / r.ml * .8; c.strokeStyle = r.col; c.lineWidth = r.w; c.setLineDash([3, 4]); c.beginPath(); c.arc(r.x, r.y, r.r, 0, 7); c.stroke(); } c.setLineDash([]); c.globalAlpha = 1;
    for (const p of this.parts) { c.globalAlpha = Math.max(0, p.life / p.ml); c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.size / 2, 0, 7); c.fill(); } c.globalAlpha = 1;
    for (const ov of this.ovs) {
      const b = ov.b, a = Math.min(1, ov.life / .3, (ov.ml - ov.life) / .2), sz = 110, sk = ov.sk;
      drawEdited(sk.cv.getContext('2d'), sk.el, sk.s.media.edits, 128, 128, 'contain');
      c.globalAlpha = Math.max(0, a); c.drawImage(sk.cv, Math.min(400 - sz, Math.max(0, b.x - sz / 2)), Math.max(0, b.y - b.r - sz - 10), sz, sz); c.globalAlpha = 1;
    }
    for (const t of this.texts) {
      const a = Math.min(1, t.life / t.ml * 2), s = t.big ? 1 + .4 * Math.max(0, (t.life - t.ml + .2) / .2) : 1;
      c.globalAlpha = a; c.font = `${t.big ? 18 * s : 14}px 'Black Han Sans',sans-serif`; c.textAlign = 'center'; c.lineWidth = 4; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.strokeText(t.s, t.x, t.y); c.fillStyle = t.col; c.fillText(t.s, t.x, t.y);
    } c.globalAlpha = 1;
    c.restore();
    c.lineWidth = 5; c.strokeStyle = '#111'; c.strokeRect(BX - 2.5, BY - 2.5, 405, 405);
    this.panel(this.balls[0], BX, 0); this.panel(this.balls[1], 220, 1);
  }
  panel(b, x, side) {
    const c = this.c, w = 190, ny = BY + 400 + 34, hy = ny + 10, hh = 28, p = Math.max(0, b.hp / b.max), pl = Math.max(0, b.lag / b.max);
    c.textAlign = side ? 'right' : 'left'; c.font = '600 24px "IBM Plex Sans KR",sans-serif'; c.fillStyle = b.color;
    const nm = b.u.nick.length > 9 ? b.u.nick.slice(0, 9) + '…' : b.u.nick; c.fillText(nm, side ? x + w : x, ny);
    c.fillStyle = '#d0d0d0'; c.fillRect(x, hy, w, hh);
    c.fillStyle = '#ffa8a8'; c.fillRect(x, hy, w * pl, hh);
    c.fillStyle = p < .3 ? '#ff6b6b' : '#40d65a'; c.fillRect(x, hy, w * p, hh);
    if (b.shield > 0) { c.fillStyle = 'rgba(116,192,252,.6)'; c.fillRect(x, hy, Math.min(w, b.shield / b.max * w), 5); }
    c.lineWidth = 2.5; c.strokeStyle = '#111'; c.strokeRect(x, hy, w, hh);
    c.fillStyle = '#fff'; c.font = '600 19px "IBM Plex Sans KR",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(`${Math.ceil(Math.max(0, b.hp))} / ${b.max}`, x + w / 2, hy + hh / 2 + 1); c.textBaseline = 'alphabetic';
    const rows = b.sk.length ? b.sk : [null];
    rows.forEach((s, i) => { const y = hy + hh + 9 + i * 12; c.fillStyle = '#e9e9e9'; c.fillRect(x, y, w, 6); if (s) { c.fillStyle = b.color; c.fillRect(x, y, w * Math.min(1, 1 - Math.max(0, s.t) / s.cd), 6); } c.lineWidth = 1; c.strokeStyle = '#9a9a9a'; c.strokeRect(x, y, w, 6); });
  }
  drawBall(b) {
    const c = this.c, r = b.r * b.sc;
    // 막대 무기
    const L = r + 36 * b.sc; c.strokeStyle = '#8f8f8f'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(b.x + Math.cos(b.wa) * r, b.y + Math.sin(b.wa) * r); c.lineTo(b.x + Math.cos(b.wa) * L, b.y + Math.sin(b.wa) * L); c.stroke();
    c.save(); c.translate(b.x, b.y); c.scale(b.sqx, b.sqy);
    c.fillStyle = b.color; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill();
    c.save(); c.beginPath(); c.arc(0, 0, r - 3.5, 0, 7); c.clip();
    if (b.img && b.img.complete && b.img.naturalWidth) c.drawImage(b.img, -r + 3.5, -r + 3.5, (r - 3.5) * 2, (r - 3.5) * 2); else { c.fillStyle = '#fff'; c.fill(); }
    if (b.slowT > 0) { c.fillStyle = 'rgba(116,192,252,.35)'; c.fillRect(-r, -r, r * 2, r * 2); }
    if (b.poisonT > 0) { c.fillStyle = 'rgba(105,219,124,.3)'; c.fillRect(-r, -r, r * 2, r * 2); }
    if (b.flash > 0) { c.fillStyle = `rgba(255,255,255,${b.flash * 5})`; c.fillRect(-r, -r, r * 2, r * 2); }
    c.restore();
    if (b.shield > 0) { c.strokeStyle = '#74c0fc'; c.lineWidth = 2; c.fillStyle = 'rgba(116,192,252,.12)'; c.beginPath(); c.arc(0, 0, r + 6, 0, 7); c.fill(); c.stroke(); }
    if (b.growT > 0) { c.strokeStyle = '#fab005'; c.lineWidth = 2; c.setLineDash([4, 4]); c.beginPath(); c.arc(0, 0, r + 3, this.t * 3, this.t * 3 + 7); c.stroke(); c.setLineDash([]); }
    c.restore();
    if (b.stuckT > 0) { c.strokeStyle = '#2f9e44'; c.lineWidth = 3.5; for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(b.x, b.y, r + 2, r * .35, i * 1.05 + this.t, 0, 7); c.stroke(); } }
  }
  start() { this.last = performance.now(); const loop = now => { if (this.stopped) return; const dt = Math.min(.033, (now - this.last) / 1000); this.last = now; this.step(dt); this.draw(); this.onFrame && this.onFrame(); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  stop() { this.stopped = true; cancelAnimationFrame(this.raf); this.ovs.forEach(o => o.sk.el && o.sk.el.pause && o.sk.el.pause()); }
  startRec() {
    try {
      const st = this.cv.captureStream(30); if (AUD.dest) AUD.dest.stream.getAudioTracks().forEach(t => st.addTrack(t));
      const mt = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      this.rec = new MediaRecorder(st, mt ? { mimeType: mt, videoBitsPerSecond: 1.2e6 } : undefined); this.chunks = [];
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
    const sk = { s, crit: isCrit(u, s), cd: skillCD(s), t: skillCD(s) * (.35 + Math.random() * .3) };
    if (AUD.isFile(s.sound)) sk.buf = await AUD.load(s.sound);
    if (s.media) {
      try {
        const url = await mediaSrc(s.media); if (url) {
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
  if (!pool.length) { later(() => { clearInterval(el._iv); el.innerHTML = `<div class="match"><button class="icon-btn mt-x" data-back>${ic('x')}</button><h2 class="mt-title">아직 다른 플레이어가 없어요</h2><p class="muted center">다른 사람이 가입하면 그 사람의 공·스킬과 싸울 수 있어요</p><button class="btn-main" data-back>돌아가기</button></div>`; }, 1500); return; }
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
  el.innerHTML = `<div class="game"><div class="g-top"><button class="icon-btn g-quit">${ic('x')}</button><span class="g-map">${MAPS[p.map].name}</span><span></span></div>
    <div class="g-cv-wrap"><canvas class="g-cv"></canvas><div class="g-count"></div></div><div class="g-cards"></div></div>`;
  const [mySk, opSk, myImg, opImg] = await Promise.all([prepSkills(u), prepSkills(o), loadImg(avatarSrc(u)), loadImg(avatarSrc(o))]);
  if (!el.isConnected) return;
  const myC = ballColor(myImg), opC = ballColor(opImg);
  const card = (x, side, col, sks) => `<div class="g-card ${side}" style="--bc:${col}">${avImg(x, 'av-c')}<div class="g-nm"><div class="g-name">${nameHTML(x)}</div><small>@${esc(x.handle)}</small>
    ${side === 'opp' ? `<div class="g-acts">${isDev(u) ? `<button class="mini-ban" data-ban>${ic('ban', 13)} 밴</button>` : ''}<button class="mini-btn" data-rep>${ic('flag', 13)} 신고</button></div>` : ''}
    <div class="g-sk">${sks.map(s => `<div class="gs"><span>${esc(s.s.name)}</span><i><b></b></i></div>`).join('') || '<small class="muted">기본 공격만</small>'}</div></div></div>`;
  $('.g-cards', el).innerHTML = card(o, 'opp', opC, opSk) + card(u, 'me', myC, mySk);
  const g = new Game($('.g-cv', el), { map: p.map, me: { u, skills: mySk, img: myImg, color: myC }, opp: { u: o, skills: opSk, img: opImg, color: opC }, onEnd: w => finish(w) });
  el._leave = () => { g.stop(); g.stopRec(); };
  const bars = [[opSk, $$('.g-card.opp .gs', el)], [mySk, $$('.g-card.me .gs', el)]];
  g.onFrame = () => bars.forEach(([sks, els]) => sks.forEach((s, i) => { const e = els[i]; if (!e) return; const pr = 1 - Math.max(0, s.t) / s.cd; e.querySelector('b').style.width = pr * 100 + '%'; e.classList.toggle('ready', pr > .97); }));
  g.start();
  if (isDev(u)) $('[data-ban]', el).onclick = () => banModal(o.handle);
  $('[data-rep]', el).onclick = () => reportUser(o);
  $('.g-quit', el).onclick = async () => { if (g.over) return; if (await ask('게임을 나가면 패배로 기록돼요. 나갈까요?', '나가기', true)) { g.over = true; g.stop(); g.stopRec(); record(false); reset('main', { tab: 'home' }, 'back'); } };
  // 3, 2, 1 카운트다운
  const cnt = $('.g-count', el);
  for (const n of ['3', '2', '1', '시작']) {
    if (!el.isConnected) return; cnt.innerHTML = `<span class="${n.length > 1 ? 'go' : ''}">${n}</span>`; AUD.sfx(n.length > 1 ? 'go' : 'beep'); await new Promise(r => setTimeout(r, n.length > 1 ? 650 : 850));
  }
  cnt.innerHTML = ''; g.started = true; g.startRec();
  function record(win) {
    u.wins += win ? 1 : 0; u.losses += win ? 0 : 1; if (win) u.coins += 1;
    o.wins += win ? 0 : 1; o.losses += win ? 1 : 0; if (!win) o.coins += 1; save('users');
  }
  async function finish(w) {
    const win = w.side === 1; record(win); AUD.sfx(win ? 'win' : 'lose');
    let thumb = ''; try { const t = document.createElement('canvas'); t.width = 180; t.height = 238; t.getContext('2d').drawImage(g.cv, 0, 0, 180, 238); thumb = t.toDataURL('image/jpeg', .6); } catch (e) { }
    const res = h(`<div class="result ${win ? 'win' : 'lose'}"><div class="res-in">${win ? '<div class="confetti">' + Array.from({ length: 30 }, () => `<i style="--x:${rnd(-160, 160)}px;--d:${rnd(0, .6)}s;--c:${pick(['#ff6b6b', '#ffd43b', '#51cf66', '#4dabf7', '#cc5de8'])}"></i>`).join('') + '</div>' : ''}
      <div class="res-title">${win ? '승리' : '패배'}</div>${avImg(w.u, 'av-c res-av')}<div class="res-name">${nameHTML(w.u)} 승리</div>
      ${win ? `<div class="res-coin">${COIN}<b>+1 코인</b></div>` : '<div class="muted">다음엔 이길 수 있어요</div>'}
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
