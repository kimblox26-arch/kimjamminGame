// ───────── 전투 엔진: 루프 · 파티클 · 이펙트 · 슬라임 · 플레이어 ─────────
const W = 256, H = 144, GROUND = 122;
const FIRE = ['#ffffff', '#fff3a0', '#ffd23f', '#ff8a1f', '#e8401c', '#a8261a', '#4a2a2a'];
const SMOKE = ['#7a7088', '#5a5068', '#463e54', '#342c40'];
const ICE = ['#ffffff', '#d8f6ff', '#8ef6ff', '#4ab8e8', '#2a6fb0'];
const ELEC = ['#ffffff', '#fff8a0', '#ffe066', '#8ef6ff', '#4aa8ff'];
const POISON = ['#e8ffb0', '#a8f060', '#5ad35a', '#2f8f3a', '#1f5a2a'];
const SHADOW = ['#ffffff', '#e0b0ff', '#b45cff', '#6522a8', '#2a1048'];
const DUST = ['#e0d0b0', '#b09878', '#806850', '#584838'];
const LIGHT = ['#ffffff', '#fff8d0', '#ffe066', '#ffb020', '#b8860b'];
const VOID = ['#ffffff', '#ff9af0', '#b45cff', '#5a1fa8', '#1a0830'];
const WIND = ['#ffffff', '#bff5e0', '#6fe0b0', '#2fa87a'];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];

const E = (() => {
  let cv, c, bg, last = 0;
  const G = {
    t: 0, fx: [], parts: [], nums: [], timers: [],
    shakeA: 0, shakeT: 0, flashC: '#fff', flashT: 0, flashD: 1, flashA: 1,
    dark: 0, darkTo: 0, darkHold: 0, tintC: '#000', tintA: 0, tintTo: 0, tintHold: 0,
    invert: 0, invertTo: 0, frozen: false, hitstop: 0, lastHitSfx: 0, fly: 0, gearT: 0,
  };
  const player = { x: 62, homeX: 62, y: GROUND, cast: 0, castCol: '#fff', castR: 0, sprite: null, hide: false, swing: null, crouch: 0, dash: 0, busy: false };
  const slime = { x: 194, lv: 1, hp: 1, max: 1, ghost: 1, bw: 30, bh: 22, sx: 1, sy: 1, kx: 0, flash: 0, hurt: 0,
    dead: true, respawn: 0, oy: 0, vy: 0, frozen: 0, poison: 0, burn: 0, king: false, col: SLIME_COLORS[0], hop: 2 };
  const clouds = Array.from({ length: 5 }, (_, i) => ({ x: i * 60 + rnd(0, 30), y: rnd(8, 44), s: rnd(0.6, 1.2), v: rnd(2, 5) }));

  // ── 배경 미리 그리기 (흔들림 여유 4px) ──
  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function makeBg() {
    const [b, g] = PX.mk(W + 8, H + 8);
    const r = mulberry(7);
    g.translate(4, 4);
    const sky = ['#120d2a', '#1a1440', '#241a52', '#33205e', '#472668', '#622d74', '#84367c', '#a8427e', '#cc5a7c'];
    const bandH = (GROUND - 24) / sky.length;
    for (let y = -4; y < GROUND; y++) {
      const fi = Math.max(0, (y + 4) / bandH);
      let i = Math.min(sky.length - 1, Math.floor(fi));
      const frac = fi - Math.floor(fi);
      for (let x = -4; x < W + 4; x++) {
        let k = i;
        if (frac > 0.75 && ((x + y) & 1) && i < sky.length - 1) k = i + 1;
        g.fillStyle = sky[k]; g.fillRect(x, y, 1, 1);
      }
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = r() < 0.3 ? '#ffe9b0' : '#ffffff'; g.globalAlpha = 0.4 + r() * 0.6; g.fillRect((r() * (W + 8) - 4) | 0, (r() * 60 - 4) | 0, 1, 1); }
    g.globalAlpha = 1;
    PX.disc(g, 214, 24, 11, '#3d2a5e'); PX.disc(g, 214, 24, 9, '#ffe9b0'); PX.disc(g, 211, 21, 2, '#e8cf90'); PX.disc(g, 218, 27, 1.5, '#e8cf90'); PX.disc(g, 216, 19, 1, '#e8cf90');
    const ridge = (base, amp, f, col, seed) => {
      for (let x = -4; x < W + 4; x++) {
        const h = base + Math.sin(x * f + seed) * amp + Math.sin(x * f * 2.7 + seed * 2) * amp * 0.4 + Math.sin(x * f * 7.1) * amp * 0.12;
        g.fillStyle = col; g.fillRect(x, Math.round(GROUND - h), 1, Math.ceil(h) + 1);
      }
    };
    ridge(42, 14, 0.035, '#2e2052', 1); ridge(26, 9, 0.06, '#251842', 4); ridge(12, 5, 0.11, '#1c1233', 9);
    // 땅
    for (let y = GROUND; y < H + 4; y++) {
      for (let x = -4; x < W + 4; x++) {
        let col = y === GROUND ? '#8ee07a' : y < GROUND + 3 ? '#4fa84a' : y < GROUND + 5 ? '#3a7d3a' : '#5a3d2a';
        if (y >= GROUND + 5) { const n = r(); if (n < 0.07) col = '#4a311f'; else if (n < 0.1) col = '#6b4a33'; }
        if (y === GROUND + 5 && r() < 0.5) col = '#3a7d3a';
        g.fillStyle = col; g.fillRect(x, y, 1, 1);
      }
    }
    for (let i = 0; i < 70; i++) { const x = (r() * (W + 8) - 4) | 0, h = 1 + (r() * 3 | 0); g.fillStyle = r() < 0.5 ? '#4fa84a' : '#8ee07a'; g.fillRect(x, GROUND - h, 1, h); }
    for (let i = 0; i < 8; i++) { const x = (r() * W) | 0; g.fillStyle = pick(['#ff7ab8', '#ffe066', '#ffffff']); g.fillRect(x, GROUND - 2, 1, 1); g.fillStyle = '#3a7d3a'; g.fillRect(x, GROUND - 1, 1, 1); }
    return b;
  }

  // ── 파티클 ──
  function part(o) {
    o.max = o.life; o.size = o.size || 1; o.grav = o.grav || 0; o.drag = o.drag || 0;
    G.parts.push(o);
    if (G.parts.length > 2600) G.parts.splice(0, G.parts.length - 2600);
    return o;
  }
  function burst(x, y, n, cols, o = {}) {
    const spd = o.spd ?? 60;
    for (let i = 0; i < n; i++) {
      const a = o.dir !== undefined ? o.dir + (Math.random() - 0.5) * (o.spread ?? 1) : Math.random() * Math.PI * 2;
      const s = spd * (0.25 + Math.random() * 0.75);
      part({ x: x + rnd(-1, 1) * (o.r || 0), y: y + rnd(-1, 1) * (o.ry ?? o.r ?? 0), vx: Math.cos(a) * s, vy: Math.sin(a) * s + (o.up || 0),
        life: (o.life ?? 0.5) * rnd(0.5, 1), cols, size: o.size ?? 1, grav: o.grav ?? 0, drag: o.drag ?? 2,
        add: o.add, shrink: o.shrink, shape: o.shape, floor: o.floor, free: o.free });
    }
  }
  function fx(o) { o.t = 0; if (o.layer === undefined) o.layer = 1; G.fx.push(o); return o; }
  function after(s, fn) { G.timers.push({ t: s, fn }); }
  function shake(a, d) { G.shakeA = Math.max(G.shakeA, a); G.shakeT = Math.max(G.shakeT, d); }
  function flash(col = '#fff', d = 0.15, a = 1) { G.flashC = col; G.flashT = d; G.flashD = d; G.flashA = a; }
  function darken(a, hold) { G.darkTo = Math.max(G.darkTo, a); G.darkHold = Math.max(G.darkHold, hold); }
  function tint(col, a, hold) { G.tintC = col; G.tintTo = a; G.tintHold = hold; }
  function num(str, x, y, col, s = 1) { G.nums.push({ str, x, y, vy: -38 - s * 8, t: 0, col, s }); }
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e5 ? Math.round(n / 1000) + 'K' : String(n);

  // ── 위치 ──
  const swordAng = () => player.swing != null ? player.swing : -0.5;
  const grip = () => ({ x: player.x + 4, y: player.y - 9 });
  const hand = () => ({ x: player.x + 9, y: player.y - 15 });
  const target = () => ({ x: slime.x + slime.kx, y: GROUND - slime.bh * 0.45 + slime.oy, top: GROUND - slime.bh + slime.oy });
  const alive = () => !slime.dead && slime.oy > -3;

  // ── 슬라임 ──
  function setupSlime(lv) {
    Object.assign(slime, {
      lv, king: lv % 5 === 0, col: SLIME_COLORS[(lv - 1) % SLIME_COLORS.length],
      dead: false, oy: -150, vy: 0, kx: 0, sx: 1, sy: 1, frozen: 0, poison: 0, burn: 0, hop: 2,
    });
    slime.max = Math.round(600 * Math.pow(1.3, lv - 1) * (slime.king ? 2.5 : 1));
    slime.hp = slime.ghost = slime.max;
    slime.bw = slime.king ? 40 : 30; slime.bh = slime.king ? 29 : 22;
    E.onSlime && E.onSlime(slime);
  }
  function killSlime() {
    slime.dead = true; slime.respawn = 1.6;
    const t = target();
    burst(t.x, t.y, 50, [slime.col.l, slime.col.m, slime.col.m, slime.col.d], { spd: 150, life: 1.2, size: 3, grav: 320, drag: 0.5, up: -60, floor: true, shrink: true, r: 8 });
    burst(t.x, t.y, 20, ['#ffffff', '#8ef6ff', '#4aa8ff'], { spd: 70, life: 0.9, add: true, up: -30 });
    SFX.slimeDie(); shake(3, 0.3);
    const gems = Math.round((40 + slime.lv * 15) * (slime.king ? 3 : 1));
    after(0.25, () => { num('+' + gems, t.x - 8, t.y - 10, '#8ef6ff', 2); SFX.coin(); E.onKill && E.onKill(gems, slime.lv); });
  }
  function hit(base, o = {}) {
    if (!alive()) return 0;
    const st = E.stats ? E.stats() : { atk: 0, crit: 5 };
    const crit = o.crit || Math.random() < st.crit / 100;
    const dmg = Math.max(1, Math.round(base * (1 + st.atk / 100) * rnd(0.9, 1.1) * (crit ? 2 : 1)));
    slime.hp -= dmg; slime.flash = 0.06; slime.hurt = 0.35;
    slime.kx = Math.min(16, slime.kx + (o.kb ?? 2) * (crit ? 1.5 : 1));
    slime.sx = 1.22; slime.sy = 0.82;
    const nx = slime.x + slime.kx + rnd(-10, 10), ny = GROUND - slime.bh - 8 - rnd(0, 10) + slime.oy;
    num(fmt(dmg) + (crit ? '!' : ''), nx, ny, crit ? '#ffd23f' : (o.col || '#ffffff'), crit ? 2 : 1);
    const hx = slime.x + slime.kx + rnd(-8, 8), hy = GROUND - slime.bh * rnd(0.3, 0.7) + slime.oy, sc = o.col || '#fff3a0';
    fx({ layer: 4, dur: 0.13, draw(c) {
      const q = this.t / 0.13, l = 3 + q * (crit ? 16 : 9), d = l * 0.55;
      PX.line(c, hx - l, hy, hx + l, hy, '#ffffff'); PX.line(c, hx, hy - l, hx, hy + l, '#ffffff');
      PX.line(c, hx - d, hy - d, hx + d, hy + d, sc); PX.line(c, hx - d, hy + d, hx + d, hy - d, sc);
      if (q < 0.5) PX.disc(c, hx, hy, 3.5 * (1 - q * 2) + 1, '#ffffff');
    } });
    if (!o.silent && G.t - G.lastHitSfx > 0.05) { SFX.hit(crit); G.lastHitSfx = G.t; }
    if (crit) { shake(2, 0.12); burst(nx + 4, ny + 8, 10, ['#ffffff', '#ffd23f'], { spd: 110, life: 0.25, add: true, shape: 'streak', drag: 4 }); }
    E.onDamage && E.onDamage(dmg);
    if (slime.hp <= 0) { slime.hp = 0; killSlime(); }
    return dmg;
  }

  // ── 시전 ──
  function cast(skill, lv) {
    const per = skill.dmg * (1 + 0.15 * (lv - 1));
    const k = { r: skill.r, per, hit: (o = {}) => hit(per * (o.mult || 1), o) };
    if (skill.basic) { SKILL_FX[skill.id](k); return; }
    player.cast = 0.5; player.castCol = RAR[skill.r].color; player.castR = skill.r;
    burst(player.x, GROUND - 2, 12 + skill.r * 6, ['#ffffff', RAR[skill.r].color, RAR[skill.r].dark], { spd: 30, life: 0.7, up: -40, add: true, r: 8, ry: 1, drag: 1 });
    SFX.cast(skill.r);
    if (skill.r >= 2) cutIn(skill, true);
    SKILL_FX[skill.id](k);
  }
  // 레터박스 연출
  function cutIn(skill, barsOnly) {
    const col = RAR[skill.r].color, dark = RAR[skill.r].dark, dur = barsOnly ? 1.1 : 0.62;
    if (!barsOnly) { SFX.tone(500, 0.45, 'sawtooth', 0.07, 2600); SFX.noise(0.4, 0.2, 2000, 'bandpass', 7000, 0, 2); }
    fx({ layer: 3, dur, draw(c) {
      const t = this.t, out = Math.max(0, (t - (dur - 0.15)) / 0.15);
      const bh = Math.round(16 * Math.min(1, t / 0.08) * (1 - out));
      PX.rect(c, -4, -4, W + 8, bh + 4, '#000'); PX.rect(c, -4, H - bh, W + 8, bh + 4, '#000');
    } });
  }

  // ── 업데이트 ──
  function update(dt, rdt) {
    G.t += dt;
    for (let i = G.timers.length - 1; i >= 0; i--) { const tm = G.timers[i]; tm.t -= dt; if (tm.t <= 0) { G.timers.splice(i, 1); tm.fn(); } }
    for (let i = G.fx.length - 1; i >= 0; i--) {
      const f = G.fx[i]; f.t += dt;
      let ok = f.update ? f.update(dt) !== false : true;
      if (f.dur !== undefined && f.t >= f.dur) ok = false;
      if (!ok) { G.fx.splice(i, 1); f.end && f.end(); }
    }
    for (let i = G.parts.length - 1; i >= 0; i--) {
      const p = G.parts[i];
      if (G.frozen && !p.free) continue;
      p.life -= dt;
      if (p.life <= 0) { G.parts.splice(i, 1); continue; }
      if (p.update) p.update(p, dt);
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.floor && p.y > GROUND) { p.y = GROUND; p.vy *= -0.3; p.vx *= 0.6; }
    }
    for (let i = G.nums.length - 1; i >= 0; i--) { const n = G.nums[i]; n.t += rdt; n.y += n.vy * rdt; n.vy *= 1 - 3 * rdt; if (n.t > 1) G.nums.splice(i, 1); }
    // 화면 효과
    G.shakeT -= rdt; if (G.shakeT <= 0) G.shakeA = 0;
    G.flashT -= rdt;
    G.darkHold -= rdt; if (G.darkHold <= 0) G.darkTo = 0;
    G.dark += (G.darkTo - G.dark) * Math.min(1, rdt * 5);
    G.tintHold -= rdt; if (G.tintHold <= 0) G.tintTo = 0;
    G.tintA += (G.tintTo - G.tintA) * Math.min(1, rdt * 6);
    G.invert += (G.invertTo - G.invert) * Math.min(1, rdt * 10);
    clouds.forEach(cl => { cl.x += cl.v * rdt; if (cl.x > W + 30) cl.x = -40; });
    // 반딧불
    G.fly -= rdt;
    if (G.fly <= 0) { G.fly = 0.35; part({ x: rnd(0, W), y: rnd(GROUND - 30, GROUND - 4), vx: rnd(-4, 4), vy: rnd(-4, 1), life: 3, cols: ['#c8ff80', '#e8ffb0', '#a8f060', '#5ad35a'], add: true, update: (p, d) => { p.vx += rnd(-20, 20) * d; } }); }

    // 플레이어
    player.cast = Math.max(0, player.cast - dt);
    G.gearT -= dt;
    if (G.gearT <= 0 && E.gear && !player.hide) {
      G.gearT = 0.12;
      const g = E.gear;
      if (g.head >= 4 && Math.random() < 0.6) part({ x: player.x + rnd(-6, 7), y: player.y - rnd(26, 34), vx: 0, vy: -8, life: 0.6, cols: g.head === 5 ? ['#ffffff', '#8ef6ff', '#ff7ad9'] : ['#ffffff', '#fff3b0', '#ffd23f'], add: true });
      if (g.body >= 4 && Math.random() < 0.6) part({ x: player.x + rnd(-8, 8), y: player.y - rnd(8, 18), vx: rnd(-5, 5), vy: -10, life: 0.7, cols: g.body === 5 ? ['#ffffff', '#ff9af0', '#8c6cf0'] : ['#ffffff', '#ffe066'], add: true });
      if (g.legs >= 4) part({ x: player.x + rnd(-5, 5), y: GROUND - 1, vx: rnd(-6, 6), vy: rnd(-10, -3), life: 0.6, cols: g.legs === 5 ? ['#ffffff', '#8ef6ff', '#3aa0d8'] : ['#fff3b0', '#ffd23f', '#b8860b'], add: true });
    }

    // 슬라임
    if (slime.dead) {
      slime.respawn -= dt;
      if (slime.respawn <= 0) setupSlime(slime.lv + 1);
    } else if (!G.frozen) {
      if (slime.oy < 0 || slime.vy < 0) {
        slime.vy += 520 * dt; slime.oy += slime.vy * dt;
        if (slime.oy >= 0) {
          const hard = slime.vy > 200;
          slime.oy = 0; slime.vy = 0; slime.sx = hard ? 1.5 : 1.25; slime.sy = hard ? 0.55 : 0.8;
          burst(slime.x, GROUND - 1, hard ? 16 : 6, DUST, { spd: hard ? 60 : 30, life: 0.5, dir: -Math.PI / 2, spread: 3, grav: 60, ry: 0, r: slime.bw / 2 });
          if (hard) { SFX.squish(); shake(2, 0.15); }
        }
      } else {
        slime.hop -= dt;
        if (slime.hop <= 0 && slime.frozen <= 0) { slime.hop = rnd(1.8, 3.5); slime.vy = -95; slime.sx = 0.8; slime.sy = 1.25; }
      }
      const wob = Math.sin(G.t * 4) * 0.04;
      const k = Math.min(1, dt * 9);
      slime.sx += (1 + wob - slime.sx) * k; slime.sy += (1 - wob - slime.sy) * k;
      slime.kx -= slime.kx * Math.min(1, dt * 6);
      slime.flash -= dt; slime.hurt -= dt; slime.frozen -= dt; slime.poison -= dt; slime.burn -= dt;
      slime.ghost += (slime.hp - slime.ghost) * Math.min(1, dt * 3);
      if (slime.poison > 0 && Math.random() < 0.3) part({ x: slime.x + rnd(-12, 12), y: GROUND - rnd(2, slime.bh), vx: 0, vy: -15, life: 0.6, cols: POISON, size: 2, shrink: true });
      if (slime.burn > 0 && Math.random() < 0.5) part({ x: slime.x + rnd(-12, 12), y: GROUND - rnd(2, slime.bh), vx: 0, vy: -30, life: 0.4, cols: FIRE, add: true });
    }
    E.onTick && E.onTick(rdt);
  }

  // ── 그리기 ──
  function drawParts(add) {
    for (const p of G.parts) {
      if (!!p.add !== add) continue;
      const k = 1 - p.life / p.max;
      const col = p.cols[Math.min(p.cols.length - 1, Math.floor(k * p.cols.length))];
      let s = p.shrink ? Math.max(1, Math.round(p.size * (1 - k * 0.8))) : p.size;
      if (p.shape === 'streak') { PX.line(c, p.x, p.y, p.x - p.vx * 0.04, p.y - p.vy * 0.04, col, s); continue; }
      c.fillStyle = col;
      c.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
  }
  function drawFx(layer) {
    for (const f of G.fx) if (f.layer === layer && f.draw) { c.save(); f.draw(c); c.restore(); }
  }
  function drawSlimeAll() {
    if (slime.dead) return;
    const x = slime.x + slime.kx, yb = GROUND + slime.oy;
    const w = Math.max(4, Math.round(slime.bw * slime.sx)), h = Math.max(4, Math.round(slime.bh * slime.sy));
    const sh = Math.max(0.3, 1 + slime.oy / 80);
    c.globalAlpha = 0.35; PX.ellipse(c, x, GROUND + 1, slime.bw / 2 * sh, 2, '#000'); c.globalAlpha = 1;
    const col = slime.poison > 0 ? { m: '#8fd35a', d: '#4f7a2a', l: '#d8f5a8' } : slime.col;
    drawSlime(c, x, yb, w, h, col, { flash: slime.flash > 0, hurt: slime.hurt > 0, crown: slime.king });
    if (slime.frozen > 0) {
      const L = Math.round(x - w / 2 - 3), T = Math.round(yb - h - 4);
      c.globalAlpha = 0.5; PX.rect(c, L, T, w + 6, h + 4, '#8ef6ff'); c.globalAlpha = 0.9;
      PX.rect(c, L, T, w + 6, 1, '#ffffff'); PX.rect(c, L, T, 1, h + 4, '#ffffff'); PX.rect(c, L + w + 5, T, 1, h + 4, '#4ab8e8');
      PX.line(c, L + 3, T + 3, L + 8, T + 8, '#ffffff'); PX.line(c, L + 5, T + 2, L + 9, T + 6, '#d8f6ff');
      c.globalAlpha = 1;
    }
    // HP 바
    const bw = 40, bx = Math.round(slime.x - bw / 2), by = Math.round(GROUND - slime.bh - (slime.king ? 16 : 10) + Math.min(0, slime.oy));
    PX.rect(c, bx - 1, by - 1, bw + 2, 5, '#140c1c');
    PX.rect(c, bx, by, bw, 3, '#3a1020');
    PX.rect(c, bx, by, Math.round(bw * slime.ghost / slime.max), 3, '#ffffff');
    const hw = Math.round(bw * slime.hp / slime.max);
    PX.rect(c, bx, by, hw, 3, slime.king ? '#ffb020' : '#e8364f');
    PX.rect(c, bx, by, hw, 1, slime.king ? '#ffe066' : '#ff8a9a');
  }
  const silCache = { src: null, map: {} };
  function sil(col) {
    if (silCache.src !== player.sprite) { silCache.src = player.sprite; silCache.map = {}; }
    if (!silCache.map[col]) { const [cv, g] = PX.mk(24, 34); g.drawImage(player.sprite, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, 24, 34); silCache.map[col] = cv; }
    return silCache.map[col];
  }
  function afterimage(col, a = 0.5, dur = 0.25) {
    const x = Math.round(player.x - 12), y = Math.round(player.y - 31);
    fx({ layer: 1, dur, draw(c) { c.globalAlpha = a * (1 - this.t / dur); c.drawImage(sil(col), x, y); } });
  }
  function drawPlayer() {
    if (player.hide) return;
    const bob = Math.sin(G.t * 3) > 0 ? 0 : 1;
    const hop = player.cast > 0.3 ? 2 : player.cast > 0.2 ? 1 : 0;
    c.globalAlpha = 0.35; PX.ellipse(c, player.x, GROUND + 1, 8, 2, '#000'); c.globalAlpha = 1;
    if (player.cast > 0) {
      const a = Math.min(1, player.cast * 3), R = 13 + player.castR * 2;
      c.globalAlpha = a;
      PX.ring(c, player.x, GROUND, R, player.castCol, 0.25);
      PX.ring(c, player.x, GROUND, R - 4, '#ffffff', 0.25);
      const nn = 6 + player.castR * 2;
      for (let i = 0; i < nn; i++) { const an = G.t * 4 + i * Math.PI * 2 / nn; PX.rect(c, player.x + Math.cos(an) * (R - 2), GROUND + Math.sin(an) * (R - 2) * 0.25, 1, 1, '#ffffff'); }
      c.globalAlpha = 1;
    }
    c.drawImage(player.sprite, Math.round(player.x - 12), Math.round(player.y - 31 - bob - hop + (player.crouch ? 1 : 0)));
    if (player.cast > 0.15) {
      const h = hand();
      c.globalCompositeOperation = 'lighter';
      PX.disc(c, h.x, h.y - hop, 2 + Math.sin(G.t * 40), player.castCol);
      PX.rect(c, h.x, h.y - hop, 1, 1, '#ffffff');
      c.globalCompositeOperation = 'source-over';
    }
  }
  function draw() {
    c.setTransform(1, 0, 0, 1, 0, 0);
    let ox = 0, oy = 0;
    if (G.shakeA > 0) { ox = Math.round(rnd(-1, 1) * G.shakeA); oy = Math.round(rnd(-1, 1) * G.shakeA); }
    c.save(); c.translate(ox, oy);
    c.drawImage(bg, -4, -4);
    for (const cl of clouds) {
      const x = Math.round(cl.x), y = Math.round(cl.y), s = cl.s;
      PX.ellipse(c, x, y, 14 * s, 4 * s, '#3a2862'); PX.ellipse(c, x - 6 * s, y - 2, 7 * s, 4 * s, '#3a2862'); PX.ellipse(c, x + 5 * s, y - 3 * s, 8 * s, 5 * s, '#46307a');
    }
    if (G.dark > 0.01) { c.globalAlpha = G.dark; PX.rect(c, -4, -4, W + 8, H + 8, '#05020c'); c.globalAlpha = 1; }
    drawFx(0);
    drawSlimeAll();
    drawPlayer();
    if (G.tintA > 0.01) { c.globalAlpha = G.tintA; PX.rect(c, -4, -4, W + 8, H + 8, G.tintC); c.globalAlpha = 1; }
    drawFx(1);
    drawParts(false);
    c.globalCompositeOperation = 'lighter'; drawParts(true); drawFx(4); c.globalCompositeOperation = 'source-over';
    drawFx(2);
    for (const n of G.nums) {
      c.globalAlpha = n.t > 0.7 ? Math.max(0, (1 - n.t) / 0.3) : 1;
      const s = n.t < 0.08 ? n.s + 1 : n.s;
      PX.text(c, n.str, n.x - PX.textW(n.str, s) / 2, n.y, n.col, s);
    }
    c.globalAlpha = 1;
    c.restore();
    if (G.flashT > 0) { c.globalAlpha = G.flashA * G.flashT / G.flashD; PX.rect(c, 0, 0, W, H, G.flashC); c.globalAlpha = 1; }
    if (G.invert > 0.02) {
      c.globalAlpha = G.invert;
      c.globalCompositeOperation = 'saturation'; PX.rect(c, 0, 0, W, H, '#808080');
      c.globalCompositeOperation = 'difference'; PX.rect(c, 0, 0, W, H, '#ffffff');
      c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    }
    c.save(); c.translate(ox, oy); drawFx(3); c.restore();
  }
  function frame(now) {
    const rdt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    let dt = rdt;
    if (G.hitstop > 0) { G.hitstop -= rdt; dt *= 0.12; }
    update(dt, rdt);
    draw();
    requestAnimationFrame(frame);
  }
  function start(canvas) {
    cv = canvas; c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    bg = makeBg();
    setupSlime(E.startLevel || 1);
    requestAnimationFrame(t => { last = t; frame(t); });
  }

  return {
    G, player, slime, start, part, burst, fx, after, shake, flash, darken, tint, num, hit, cast, hand, grip, swordAng, target, alive, setupSlime, afterimage, sil, cutIn,
    hitstop(s) { G.hitstop = Math.max(G.hitstop, s); },
    stats: null, onKill: null, onSlime: null, onTick: null, onDamage: null, gear: null, startLevel: 1,
  };
})();
