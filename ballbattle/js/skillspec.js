'use strict';
// ===== 직접 만드는 스킬: 스타일(모양) + 작동 원리 =====
const SPEC0 = { spawn: 'self', move: 'straight', count: 1, spread: 30, speed: 320, size: 10, life: 2, dmg: 8, knock: 100, effect: 'none', explode: 0, pierce: false, heal: 0, shield: 0, shape: 'circle', trail: true, glow: false, spin: false };
const SPEC_OPT = {
  shape: [['circle', '동그라미'], ['star', '별'], ['square', '네모'], ['tri', '세모'], ['bolt', '번개'], ['drawing', '내 그림']],
  spawn: [['self', '내 공에서 발사'], ['above', '적 위에서 떨어짐'], ['around', '내 공 주위에 생김'], ['dash', '내 공이 돌진']],
  move: [['straight', '직선'], ['homing', '따라가기'], ['orbit', '공 주위 돌기'], ['bounce', '벽에 튕기기'], ['zigzag', '지그재그'], ['boomerang', '부메랑']],
  effect: [['none', '없음'], ['slow', '느리게'], ['poison', '독'], ['stun', '기절'], ['vamp', '흡혈']],
};
const SPEC_ICON = { self: 'proj', above: 'meteor', around: 'swirl', dash: 'dash' };
const SPEC_BUDGET = 100;
const optName = (k, v) => (SPEC_OPT[k].find(o => o[0] === v) || [0, v])[1];
function specCost(p) { // 강할수록 커지는 점수. 100을 넘으면 위력이 그만큼 줄어요
  const n = p.spawn === 'dash' ? 1 : p.count, mm = p.spawn === 'dash' ? 1 : ({ homing: 1.25, orbit: 1.4, bounce: 1.2, zigzag: 1.05, boomerang: 1.3 }[p.move] || 1);
  return 4 * p.dmg * n * (p.pierce ? 1.5 : 1) * (p.spawn === 'above' ? 1.2 : 1) * mm + .02 * p.explode * p.dmg * n
    + ({ slow: 12, poison: 14, stun: 20, vamp: 14 }[p.effect] || 0) + .03 * p.knock + 2 * p.heal + 1.5 * p.shield + (p.speed > 450 ? 6 : 0);
}
const specScale = p => Math.min(1, SPEC_BUDGET / Math.max(1, specCost(p)));
const skIc = s => s.anim ? 'sparkle' : s.spec ? SPEC_ICON[s.spec.spawn] || 'proj' : (COMPS[(s.comps || [])[0]] || [0, 'sparkle'])[1];

Object.assign(Game.prototype, {
  castSpec(b, e, sk, pm) {
    const p = { ...SPEC0, ...sk.s.spec }, col = sk.s.color;
    if (p.heal) { const v = Math.min(b.max - b.hp, p.heal * pm); if (v > 0) { b.hp += v; this.text(b.x, b.y - b.r - 8, '+' + Math.round(v), '#2f9e44'); AUD.sfx('heal'); } }
    if (p.shield) { b.shield = p.shield * pm; b.shieldT = 4; this.ring(b.x, b.y, b.r + 14, '#74c0fc', .5, 3); }
    if (p.spawn === 'dash') { b.dashT = Math.min(1, p.life * .4 + .3); b.dashDmg = 0; b.dashSpec = { p, pm, col, sk }; AUD.sfx('whoosh'); return; }
    const n = p.count, base = Math.atan2(e.y - b.y, e.x - b.x), spr = p.spread * Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const off = n > 1 ? -spr / 2 + spr * i / (n - 1) : 0; let x, y, a;
      if (p.spawn === 'above') { x = Math.min(390, Math.max(10, e.x + (n > 1 ? (i - (n - 1) / 2) * 36 : 0))); y = -20 - i * 22; a = Math.PI / 2; }
      else if (p.spawn === 'around') { a = base + Math.PI * 2 * i / n; x = b.x + Math.cos(a) * (b.r + 16); y = b.y + Math.sin(a) * (b.r + 16); }
      else { a = base + off; x = b.x + Math.cos(a) * b.r; y = b.y + Math.sin(a) * b.r; }
      this.specs.push({ p, pm, col, sk, b, tg: e, x, y, vx: Math.cos(a) * p.speed, vy: Math.sin(a) * p.speed, age: 0, orbA: a, hcd: 0, trail: [], done: false });
    }
    AUD.sfx(p.spawn === 'above' ? 'meteor' : 'pew');
  },
  specHit(o, tg, x, y) {
    const p = o.p, d = this.hit(tg, p.dmg * o.pm, o.col, 'thud');
    if (p.knock) { const a = Math.atan2(tg.y - y, tg.x - x); tg.vx += Math.cos(a) * p.knock; tg.vy += Math.sin(a) * p.knock; }
    if (p.effect === 'slow') tg.slowT = 1.6;
    if (p.effect === 'poison') { tg.poisonT = 3; tg.poisonD = p.dmg * .35 * o.pm; }
    if (p.effect === 'stun') { tg.stunT = .8; this.text(tg.x, tg.y + tg.r + 12, '기절', '#f59f00'); }
    if (p.effect === 'vamp' && d) { o.b.hp = Math.min(o.b.max, o.b.hp + d * .6); this.text(o.b.x, o.b.y - o.b.r - 8, '+' + Math.round(d * .6), '#2f9e44'); }
    if (p.explode) { this.ring(x, y, p.explode, o.col, .45, 4); this.burst(x, y, o.col, 18, 260); AUD.sfx('bang'); }
    this.burst(x, y, o.col, 10);
  },
  updSpecs(dt) {
    for (const o of this.specs) {
      const p = o.p, tg = o.tg, b = o.b, sp = p.speed, rr = p.size;
      o.age += dt; o.hcd = Math.max(0, o.hcd - dt); o.trail.push([o.x, o.y]); if (o.trail.length > 8) o.trail.shift();
      const steer = (tx, ty, rate) => { const a = Math.atan2(ty - o.y, tx - o.x), cur = Math.atan2(o.vy, o.vx); let df = Math.atan2(Math.sin(a - cur), Math.cos(a - cur)); const na = cur + df * Math.min(1, dt * rate); o.vx = Math.cos(na) * sp; o.vy = Math.sin(na) * sp; };
      if (p.move === 'homing' && !tg.dead) steer(tg.x, tg.y, 4);
      if (p.move === 'boomerang' && o.age > p.life * .45) { steer(b.x, b.y, 7); if (o.age > p.life * .6 && Math.hypot(b.x - o.x, b.y - o.y) < b.r + rr) o.done = true; }
      if (p.move === 'orbit') { o.orbA += dt * 4.5; const rad = Math.min(75, b.r + 16 + o.age * 45); o.x = b.x + Math.cos(o.orbA) * rad; o.y = b.y + Math.sin(o.orbA) * rad; o.vx = -Math.sin(o.orbA); o.vy = Math.cos(o.orbA); }
      else { o.x += o.vx * dt; o.y += o.vy * dt; if (p.move === 'zigzag') { const z = Math.cos(o.age * 12) * 170 * dt; o.x += -o.vy / sp * z; o.y += o.vx / sp * z; } }
      if (p.move === 'bounce') { if (o.x < rr) { o.x = rr; o.vx = Math.abs(o.vx); } else if (o.x > 400 - rr) { o.x = 400 - rr; o.vx = -Math.abs(o.vx); } if (o.y < rr && o.age > .2) { o.y = rr; o.vy = Math.abs(o.vy); } else if (o.y > 400 - rr) { o.y = 400 - rr; o.vy = -Math.abs(o.vy); } }
      if (!tg.dead && o.hcd <= 0 && Math.hypot(tg.x - o.x, tg.y - o.y) < tg.r * tg.sc + rr) { this.specHit(o, tg, o.x, o.y); if (p.pierce || p.move === 'orbit') o.hcd = .5; else o.done = true; }
      if (o.age > p.life + (p.spawn === 'above' ? 2 : 0)) o.done = true;
      if (!['bounce', 'orbit', 'boomerang'].includes(p.move) && (o.x < -50 || o.x > 450 || o.y > 450 || (o.y < -250))) o.done = true;
    }
    this.specs = this.specs.filter(o => !o.done);
  },
  drawSpecs(c) {
    for (const o of this.specs) {
      const p = o.p, r = p.size;
      if (p.trail) o.trail.forEach(([x, y], i) => { c.globalAlpha = i / o.trail.length * .35; c.fillStyle = o.col; c.beginPath(); c.arc(x, y, r * (.4 + .5 * i / o.trail.length), 0, 7); c.fill(); });
      c.globalAlpha = Math.min(1, (p.life + 2 - o.age) * 3); c.save(); c.translate(o.x, o.y); c.rotate(p.spin ? o.age * 9 : Math.atan2(o.vy, o.vx));
      if (p.glow) { c.shadowColor = o.col; c.shadowBlur = 16; }
      drawSpecShape(c, p.shape, r, o.col, o.sk.sprite); c.restore(); c.globalAlpha = 1;
    }
  },
});
function drawSpecShape(c, shape, r, col, sprite) {
  c.fillStyle = col;
  if (shape === 'drawing' && sprite && sprite.complete && sprite.naturalWidth) { c.drawImage(sprite, -r * 1.4, -r * 1.4, r * 2.8, r * 2.8); return; }
  c.beginPath();
  if (shape === 'star') for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * .45 : r * 1.15; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  else if (shape === 'square') c.rect(-r, -r, r * 2, r * 2);
  else if (shape === 'tri') { c.moveTo(r * 1.2, 0); c.lineTo(-r * .8, r); c.lineTo(-r * .8, -r); }
  else if (shape === 'bolt') { c.moveTo(r * 1.3, 0); c.lineTo(0, r * .5); c.lineTo(r * .1, r * .1); c.lineTo(-r * 1.3, 0); c.lineTo(0, -r * .5); c.lineTo(-r * .1, -r * .1); }
  else c.arc(0, 0, r, 0, 7);
  c.closePath(); c.fill();
  if (shape === 'circle' || !shape) { c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.arc(-r * .3, -r * .3, r * .35, 0, 7); c.fill(); }
}
// 만드는 화면의 미리보기: 실제 게임 엔진으로 과녁 공에게 계속 써봐요
function specPreview(cv, getS) {
  const x = cv.getContext('2d'), white = new Image(); white.src = avatarSrc({});
  let g = null, raf = 0, last = performance.now();
  const build = () => {
    const s = getS(), sk = { s, crit: false, cd: 1.8, t: .5 };
    if (s.pic) { sk.sprite = new Image(); sk.sprite.src = s.pic; }
    if (s.anim) sk.sprites = animSprites(s);
    g = new Game(document.createElement('canvas'), { map: 'arena', seed: 5, p0: { u: { nick: '과녁' }, skills: [], img: white, color: '#adb5bd' }, p1: { u: { nick: '나' }, skills: [sk], img: white, color: s.color }, meIdx: 1 });
    g.dpr = 1; g.cv.width = GW; g.cv.height = GH; g.started = true; g.balls.forEach(b => { b.hp = b.max = b.lag = 99999; });
  };
  const loop = now => {
    const dt = Math.min(.033, (now - last) / 1000); last = now;
    AUD.quiet = true; try { g.step(dt); g.draw(); } finally { AUD.quiet = false; }
    x.clearRect(0, 0, cv.width, cv.height); x.drawImage(g.cv, BX, BY, 400, 400, 0, 0, cv.width, cv.height);
    raf = requestAnimationFrame(loop);
  };
  build(); raf = requestAnimationFrame(loop);
  return { rebuild: build, stop: () => cancelAnimationFrame(raf) };
}
