// ───────── 스킬 이펙트 17종 ─────────
const SKILL_FX = {};

// ── 공용 도우미 ──
function projectile(o) {
  const dx = o.tx - o.x, dy = o.ty - o.y, dur = Math.max(0.05, Math.hypot(dx, dy) / o.speed);
  const p = { x: o.x, y: o.y, px: o.x, py: o.y, ang: Math.atan2(dy, dx), k: 0 };
  return E.fx({
    layer: o.layer ?? 1,
    update(dt) {
      p.k = Math.min(1, this.t / dur);
      p.px = p.x; p.py = p.y;
      p.x = o.x + dx * p.k; p.y = o.y + dy * p.k - (o.arc || 0) * 4 * p.k * (1 - p.k);
      if (p.x !== p.px || p.y !== p.py) p.ang = Math.atan2(p.y - p.py, p.x - p.px);
      o.trail && o.trail(p, dt);
      if (p.k >= 1) { o.onHit && o.onHit(p); return false; }
    },
    draw(c) { o.draw(c, p, this.t); },
  });
}
function poly(c, pts, col, w) { for (let i = 0; i < pts.length - 1; i++) PX.line(c, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], col, w); }
function boltPath(x0, y0, x1, y1, jag) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, n = Math.max(2, Math.round(L / 7));
  const nx = -dy / L, ny = dx / L, pts = [[x0, y0]];
  for (let i = 1; i < n; i++) { const k = i / n, off = rnd(-1, 1) * jag * Math.sqrt(Math.sin(k * Math.PI)); pts.push([x0 + dx * k + nx * off, y0 + dy * k + ny * off]); }
  pts.push([x1, y1]);
  return pts;
}
function bolt(x0, y0, x1, y1, o = {}) {
  let pts, br, rt = 0;
  const regen = () => {
    pts = boltPath(x0, y0, x1, y1, o.jag ?? 7); br = [];
    for (let b = 0; b < (o.branches ?? 2); b++) {
      const s = pts[1 + ((Math.random() * (pts.length - 2)) | 0)]; if (!s) continue;
      let [x, y] = s; const a = Math.atan2(y1 - y0, x1 - x0) + rnd(-1.2, 1.2); const seg = [[x, y]];
      for (let i = 0; i < 4; i++) { x += Math.cos(a + rnd(-0.6, 0.6)) * 6; y += Math.sin(a + rnd(-0.6, 0.6)) * 6; seg.push([x, y]); }
      br.push(seg);
    }
  };
  regen();
  const dur = o.dur ?? 0.25;
  return E.fx({
    layer: 4, dur,
    update(dt) { rt += dt; if (rt > 0.045) { rt = 0; regen(); } },
    draw(c) {
      const col = o.col ?? '#4aa8ff';
      c.globalAlpha = 0.35 + 0.65 * (1 - this.t / dur);
      poly(c, pts, col, o.w ?? 3); br.forEach(b => poly(c, b, col, 1));
      poly(c, pts, '#ffffff', 1);
      PX.disc(c, x1, y1, (o.w ?? 3) + 1, '#ffffff');
    },
  });
}
function explode(x, y, s = 1, cols = FIRE) {
  E.burst(x, y, Math.round(26 * s), cols, { spd: 75 * s, life: 0.6, size: 2, add: true, drag: 3, shrink: true });
  E.burst(x, y, Math.round(10 * s), SMOKE, { spd: 25 * s, life: 1.2, size: 3, grav: -25, drag: 2, shrink: true });
  E.burst(x, y, Math.round(8 * s), cols, { spd: 130 * s, life: 0.35, add: true, shape: 'streak', drag: 3 });
  E.fx({ layer: 4, dur: 0.3, draw(c) { const k = this.t / 0.3; PX.ring(c, x, y, 3 + k * 22 * s, cols[2]); if (k < 0.4) PX.disc(c, x, y, (1 - k / 0.4) * 7 * s + 1, '#ffffff'); } });
}
function groundCircle(x, r, col, dur, o = {}) {
  return E.fx({
    layer: 0, dur,
    draw(c) {
      const g = o.grow ? Math.min(1, this.t * 3) : 1, a = Math.min(1, (dur - this.t) * 4);
      c.globalAlpha = a * (0.65 + 0.35 * Math.sin(this.t * 20));
      PX.ring(c, x, GROUND, r * g, col, 0.28); PX.ring(c, x, GROUND, r * 0.72 * g, col, 0.28);
      if (o.runes) for (let i = 0; i < 10; i++) { const an = this.t * 2 + i * Math.PI / 5; PX.rect(c, x + Math.cos(an) * r * 0.86 * g, GROUND + Math.sin(an) * r * 0.86 * 0.28 * g, 1, 1, '#ffffff'); }
      c.globalAlpha = 1;
    },
  });
}
function slashMark(x, y, ang, len, cols, dur = 0.25, layer = 4) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return E.fx({
    layer, dur,
    draw(c) {
      const k = this.t / dur, l = len * (k < 0.3 ? k / 0.3 : 1), th = k < 0.5 ? 3 : k < 0.8 ? 2 : 1;
      PX.line(c, x - ca * l / 2, y - sa * l / 2, x + ca * l / 2, y + sa * l / 2, cols[2], th);
      PX.line(c, x - ca * l / 2, y - sa * l / 2, x + ca * l / 2, y + sa * l / 2, cols[0], 1);
    },
  });
}

// ══════════ 일반 ══════════
SKILL_FX.fireball = k => {
  const P = E.hand(), S = E.target(); SFX.fire();
  projectile({
    x: P.x, y: P.y, tx: S.x - 4, ty: S.y, speed: 230, arc: 6,
    trail(p) { for (let i = 0; i < 3; i++) E.part({ x: p.x + rnd(-1.5, 1.5), y: p.y + rnd(-1.5, 1.5), vx: rnd(-35, -5), vy: rnd(-20, 5), life: rnd(0.2, 0.45), cols: FIRE, size: pick([1, 2, 2]), add: true, shrink: true }); },
    draw(c, p) {
      c.globalCompositeOperation = 'lighter'; PX.disc(c, p.x, p.y, 5, '#a8261a'); c.globalCompositeOperation = 'source-over';
      PX.disc(c, p.x, p.y, 3.6, '#ff8a1f'); PX.disc(c, p.x + 0.5, p.y - 0.5, 2.4, '#ffd23f'); PX.rect(c, p.x, p.y - 1, 1, 1, '#ffffff');
    },
    onHit(p) { k.hit({ kb: 4, col: '#ffb070' }); E.slime.burn = 1; explode(p.x, p.y, 1); SFX.boom(0.5); E.shake(2, 0.15); },
  });
};

SKILL_FX.iceshard = k => {
  for (let i = 0; i < 3; i++) E.after(i * 0.12, () => {
    const P = E.hand(), S = E.target(); SFX.ice();
    const off = (i - 1) * 6;
    projectile({
      x: P.x, y: P.y + off * 0.3, tx: S.x - 6, ty: S.y + off, speed: 300,
      trail(p) { if (Math.random() < 0.7) E.part({ x: p.x, y: p.y, vx: rnd(-10, 10), vy: rnd(-10, 10), life: 0.35, cols: ICE, add: true }); },
      draw(c, p) {
        const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
        PX.line(c, p.x - ca * 8, p.y - sa * 8, p.x, p.y, '#2a6fb0', 3);
        PX.line(c, p.x - ca * 7, p.y - sa * 7, p.x, p.y, '#8ef6ff', 1);
        PX.rect(c, p.x, p.y, 1, 1, '#ffffff'); PX.rect(c, p.x - ca * 3, p.y - sa * 3, 1, 1, '#ffffff');
      },
      onHit(p) {
        k.hit({ kb: 2, col: '#b0f0ff' }); E.slime.frozen = Math.max(E.slime.frozen, 0.3);
        E.burst(p.x, p.y, 14, ICE, { spd: 80, life: 0.6, grav: 220, drag: 1, floor: true });
        E.burst(p.x, p.y, 6, ICE, { spd: 110, life: 0.2, shape: 'streak', add: true });
        SFX.shatter();
      },
    });
  });
};

SKILL_FX.rock = k => {
  const P = E.hand(), S = E.target(); SFX.whoosh(0.4, 300);
  let rot = 0;
  projectile({
    x: P.x, y: P.y - 4, tx: S.x - 3, ty: S.y - 2, speed: 160, arc: 45,
    trail(p, dt) { rot += dt * 14; if (Math.random() < 0.4) E.part({ x: p.x + rnd(-3, 3), y: p.y + rnd(-3, 3), vx: 0, vy: 10, life: 0.5, cols: DUST, size: 2, shrink: true }); },
    draw(c, p) {
      PX.disc(c, p.x, p.y, 6.5, '#140c1c'); PX.disc(c, p.x, p.y, 5.5, '#7a6a5a');
      const hx = Math.cos(rot) * 2, hy = Math.sin(rot) * 2;
      PX.disc(c, p.x + hx - 1, p.y + hy - 1, 2.5, '#9a8a78'); PX.rect(c, p.x - hy * 2, p.y + hx * 2, 2, 1, '#584838'); PX.rect(c, p.x + hx - 2, p.y + hy - 2, 1, 1, '#c8b8a0');
    },
    onHit(p) {
      k.hit({ kb: 10, col: '#e0d0b0' });
      E.burst(p.x, p.y, 24, DUST, { spd: 120, life: 1, size: 2, grav: 300, drag: 0.5, up: -60, floor: true, shrink: true });
      E.burst(p.x, GROUND - 2, 14, SMOKE, { spd: 40, life: 0.8, size: 3, grav: -10, shrink: true, dir: -Math.PI / 2, spread: 3 });
      SFX.boom(0.8); E.shake(4, 0.25); E.hitstop(0.05);
    },
  });
};

SKILL_FX.windslash = k => {
  const P = E.hand(), S = E.target(); SFX.slash();
  projectile({
    x: P.x + 4, y: P.y + 2, tx: S.x + 6, ty: S.y, speed: 330,
    trail(p) { E.part({ x: p.x - 6, y: p.y + rnd(-9, 9), vx: -80, vy: 0, life: 0.18, cols: WIND, shape: 'streak', add: true }); },
    draw(c, p) {
      c.globalCompositeOperation = 'lighter'; PX.ring(c, p.x - 8, p.y, 11, '#2fa87a', 1, 2, -1.15, 1.15); c.globalCompositeOperation = 'source-over';
      PX.ring(c, p.x - 8, p.y, 10, '#bff5e0', 1, 1, -1.05, 1.05); PX.ring(c, p.x - 9, p.y, 9, '#ffffff', 1, 1, -0.8, 0.8); PX.ring(c, p.x - 10, p.y, 8, '#6fe0b0', 1, 1, -0.9, 0.9);
    },
    onHit(p) {
      k.hit({ kb: 5, col: '#bff5e0' });
      slashMark(p.x - 4, p.y, -0.7, 24, WIND); slashMark(p.x - 4, p.y, 0.7, 24, WIND);
      E.burst(p.x, p.y, 12, WIND, { spd: 100, life: 0.3, add: true, shape: 'streak' }); SFX.shing();
    },
  });
};

// ══════════ 희귀 ══════════
SKILL_FX.chain = k => {
  const S0 = E.target(), P = E.hand();
  [[P.x, P.y], [S0.x - 55, -4], [S0.x + 40, -4]].forEach((s, i) => E.after(i * 0.16, () => {
    const S = E.target();
    bolt(s[0], s[1], S.x + rnd(-3, 3), S.y + rnd(-3, 3), { dur: 0.28, w: 3, jag: 9, branches: 3 });
    SFX.zap(); E.flash('#bfe8ff', 0.08, 0.45); E.shake(2, 0.1);
    E.burst(S.x, S.y, 16, ELEC, { spd: 130, life: 0.3, add: true, shape: 'streak', drag: 4 });
    k.hit({ kb: 3, col: '#fff8a0' });
  }));
};

SKILL_FX.poison = k => {
  const P = E.hand(), S = E.target(); SFX.whoosh(0.3, 800);
  projectile({
    x: P.x, y: P.y - 3, tx: S.x - 2, ty: S.y - 6, speed: 170, arc: 30,
    trail(p) { if (Math.random() < 0.5) E.part({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.4, cols: POISON, add: true }); },
    draw(c, p) {
      const x = Math.round(p.x), y = Math.round(p.y);
      PX.rect(c, x - 2, y - 3, 5, 6, '#140c1c'); PX.rect(c, x - 1, y - 2, 3, 4, '#5ad35a'); PX.rect(c, x - 1, y - 2, 3, 1, '#c8e8ff');
      PX.rect(c, x, y - 5, 1, 2, '#c8e8ff'); PX.rect(c, x - 1, y - 6, 3, 1, '#7a5230');
    },
    onHit(p) {
      SFX.glass(); SFX.bubble();
      E.burst(p.x, p.y, 12, ['#ffffff', '#c8e8ff', '#a0c0d0'], { spd: 80, life: 0.5, grav: 250, floor: true });
      E.burst(p.x, p.y, 20, POISON, { spd: 60, life: 0.6, size: 2, add: true, shrink: true });
      E.slime.poison = 3.4;
      let n = 0;
      const cloud = Array.from({ length: 7 }, () => ({ ox: rnd(-16, 16), oy: rnd(-22, 0), r: rnd(5, 9), ph: rnd(0, 6) }));
      E.fx({
        layer: 1, dur: 3.4,
        update() {
          const S = E.target();
          if (Math.random() < 0.6) E.part({ x: S.x + rnd(-16, 16), y: GROUND - rnd(0, 26), vx: rnd(-5, 5), vy: rnd(-25, -8), life: rnd(0.5, 1), cols: POISON, size: pick([1, 2]), add: true });
          if (this.t > n * 0.42 + 0.1 && n < 8) { n++; k.hit({ kb: 0, col: '#a8f060' }); if (n % 2) SFX.bubble(); }
        },
        draw(c) {
          const S = E.target(), a = Math.min(1, this.t * 3, (3.4 - this.t) * 2);
          c.globalAlpha = 0.18 * a; cloud.forEach(q => PX.disc(c, S.x + q.ox * 1.3, GROUND - 4 + q.oy * 0.6, q.r * 1.3, '#2f8f3a'));
          c.globalAlpha = 0.28 * a; cloud.forEach(q => PX.disc(c, S.x + q.ox + Math.sin(this.t * 2 + q.ph) * 3, GROUND - 8 + q.oy + Math.cos(this.t * 1.7 + q.ph) * 2, q.r, '#5ad35a'));
        },
      });
    },
  });
};

SKILL_FX.daggers = k => {
  const P = E.hand();
  const ds = Array.from({ length: 5 }, (_, i) => {
    const a = -Math.PI / 2 + (i - 2) * 0.45;
    return { hx: P.x - 4 + Math.cos(a) * 16, hy: P.y - 6 + Math.sin(a) * 12, x: P.x, y: P.y, ang: 0, t0: 0.35 + i * 0.09, launched: false, done: false };
  });
  SFX.whoosh(0.3, 1200);
  E.fx({
    layer: 1,
    update(dt) {
      const S = E.target(); let any = false;
      ds.forEach(d => {
        if (d.done) return; any = true;
        if (this.t < d.t0) {
          d.x += (d.hx - d.x) * Math.min(1, dt * 12); d.y += (d.hy - d.y) * Math.min(1, dt * 12);
          d.ang = Math.atan2(S.y - d.y, S.x - d.x);
        } else {
          if (!d.launched) { d.launched = true; SFX.shing(); }
          d.ang = Math.atan2(S.y - d.y, S.x - d.x);
          d.x += Math.cos(d.ang) * 380 * dt; d.y += Math.sin(d.ang) * 380 * dt;
          E.part({ x: d.x, y: d.y, vx: 0, vy: 0, life: 0.2, cols: SHADOW.slice(1), add: true });
          if (Math.hypot(S.x - d.x, S.y - d.y) < 7) {
            d.done = true; k.hit({ kb: 2, col: '#e0b0ff' });
            E.burst(d.x, d.y, 10, SHADOW, { spd: 90, life: 0.3, add: true, shape: 'streak' });
            slashMark(d.x, d.y, d.ang + 1.3, 14, SHADOW, 0.2);
          }
        }
      });
      return any;
    },
    draw(c) {
      ds.forEach(d => {
        if (d.done) return;
        const ca = Math.cos(d.ang), sa = Math.sin(d.ang);
        c.globalCompositeOperation = 'lighter'; PX.line(c, d.x - ca * 6, d.y - sa * 6, d.x + ca * 3, d.y + sa * 3, '#6522a8', 3); c.globalCompositeOperation = 'source-over';
        PX.line(c, d.x - ca, d.y - sa, d.x + ca * 4, d.y + sa * 4, '#e6e9ef', 1); PX.rect(c, d.x + ca * 4, d.y + sa * 4, 1, 1, '#ffffff');
        PX.line(c, d.x - ca * 4, d.y - sa * 4, d.x - ca * 2, d.y - sa * 2, '#b45cff', 1);
        PX.line(c, d.x - ca * 2 - sa * 2, d.y - sa * 2 + ca * 2, d.x - ca * 2 + sa * 2, d.y - sa * 2 - ca * 2, '#ffd23f', 1);
      });
    },
  });
};

SKILL_FX.pillar = k => {
  const x = E.target().x;
  SFX.rumble(0.6);
  groundCircle(x, 16, '#ff8a1f', 0.45, { grow: true });
  E.burst(x, GROUND, 12, FIRE, { spd: 30, life: 0.5, dir: -Math.PI / 2, spread: 1.5, add: true, r: 10, ry: 0 });
  E.after(0.4, () => {
    SFX.fire(); SFX.boom(0.7); E.shake(3, 0.6); E.tint('#ff6a00', 0.12, 0.8);
    let n = 0;
    E.fx({
      layer: 4, dur: 1.0,
      update() {
        const xx = E.target().x;
        for (let i = 0; i < 9; i++) E.part({ x: xx + rnd(-9, 9), y: GROUND, vx: rnd(-10, 10), vy: rnd(-260, -140), life: rnd(0.3, 0.6), cols: FIRE, size: pick([1, 2, 3]), add: true, shrink: true, drag: 1 });
        if (this.t > n * 0.2 && n < 4) { n++; k.hit({ kb: 0, col: '#ffb070' }); E.slime.burn = 1.5; }
      },
      draw(c) {
        const xx = E.target().x, q = this.t;
        const w = (q < 0.15 ? q / 0.15 : q > 0.75 ? (1 - q) / 0.25 : 1) * 10;
        for (let y = 0; y < GROUND; y += 3) {
          const j = Math.sin(y * 0.3 + this.t * 30) * 1.5;
          PX.rect(c, xx - w + j, y, w * 2, 3, '#a8261a'); PX.rect(c, xx - w * 0.65 + j, y, w * 1.3, 3, '#ff8a1f'); PX.rect(c, xx - w * 0.3 + j * 0.5, y, w * 0.6, 3, '#fff3a0');
        }
      },
    });
    E.burst(x, GROUND - 2, 16, SMOKE, { spd: 50, life: 1, size: 3, grav: -20, shrink: true, dir: -Math.PI / 2, spread: 2.5 });
  });
};

// ══════════ 에픽 ══════════
SKILL_FX.meteor = k => {
  const S = E.target(), tx = S.x, ty = GROUND - 6, sx = tx - 140, sy = -40, dur = 0.9;
  E.darken(0.55, 1.6);
  groundCircle(tx, 20, '#ff3c3c', 0.95, { grow: true });
  SFX.tone(1400, 0.9, 'sine', 0.12, 250); SFX.rumble(1);
  E.fx({
    layer: 1, dur,
    update() {
      const q = this.t / dur; this.x = sx + (tx - sx) * q; this.y = sy + (ty - sy) * q;
      for (let i = 0; i < 6; i++) E.part({ x: this.x + rnd(-4, 4), y: this.y + rnd(-4, 4), vx: rnd(-70, -20), vy: rnd(-55, -10), life: rnd(0.3, 0.7), cols: FIRE, size: pick([2, 3]), add: true, shrink: true });
      if (Math.random() < 0.5) E.part({ x: this.x, y: this.y, vx: rnd(-30, 0), vy: rnd(-20, 0), life: 1, cols: SMOKE, size: 4, shrink: true, grav: -10 });
    },
    draw(c) {
      if (this.x === undefined) return;
      c.globalCompositeOperation = 'lighter'; PX.disc(c, this.x, this.y, 12, '#a8261a'); PX.disc(c, this.x, this.y, 9, '#e8401c'); c.globalCompositeOperation = 'source-over';
      PX.disc(c, this.x, this.y, 7, '#4a2a2a'); PX.disc(c, this.x + 1, this.y + 1, 5, '#7a3a2a'); PX.disc(c, this.x + 2, this.y + 2, 3, '#ff8a1f'); PX.disc(c, this.x + 2, this.y + 2, 1.5, '#fff3a0');
    },
    end() {
      k.hit({ kb: 14, col: '#ffb070' }); E.slime.burn = 2;
      explode(tx, ty, 2.6);
      E.burst(tx, GROUND, 40, DUST, { spd: 160, life: 1.3, size: 2, grav: 320, up: -80, floor: true, shrink: true, dir: -Math.PI / 2, spread: 2.6 });
      E.flash('#fff3c0', 0.25, 0.9); E.shake(7, 0.7); E.hitstop(0.09); SFX.boom(2.2);
      E.fx({ layer: 0, dur: 3, draw(c) { c.globalAlpha = Math.min(1, 3 - this.t) * 0.7; PX.ellipse(c, tx, GROUND + 1, 26, 4, '#1a0c0c'); PX.ellipse(c, tx, GROUND + 1, 16, 2.5, '#6a1a10'); } });
      E.fx({ layer: 4, dur: 0.5, draw(c) { const q = this.t / 0.5; PX.ring(c, tx, GROUND - 2, 10 + q * 90, '#ff8a1f', 0.3, 2); PX.ring(c, tx, ty, 6 + q * 50, '#fff3a0'); } });
    },
  });
};

SKILL_FX.blizzard = k => {
  const dur = 3;
  E.tint('#4ab8e8', 0.18, dur); E.darken(0.25, dur);
  SFX.noise(dur, 0.25, 700, 'bandpass', 1400, 0, 1.5); SFX.ice();
  const spikes = []; let n = 0, sp = 0;
  E.fx({
    layer: 1, dur,
    update(dt) {
      for (let i = 0; i < 7; i++) E.part({ x: rnd(0, W + 120), y: -4, vx: rnd(-160, -110), vy: rnd(70, 120), life: 1.6, cols: [pick(['#ffffff', '#d8f6ff', '#8ef6ff'])], size: pick([1, 1, 2]), floor: true });
      if (Math.random() < 0.3) E.part({ x: W + 4, y: rnd(10, GROUND), vx: -260, vy: 30, life: 1.1, cols: ['#ffffff', '#d8f6ff'], shape: 'streak', add: true });
      const S = E.target();
      sp -= dt;
      if (sp <= 0 && this.t < dur - 0.6) { sp = 0.12; spikes.push({ x: S.x + rnd(-24, 24), h: rnd(8, 20), t: 0, w: rnd(2, 4) }); }
      spikes.forEach(s => s.t += dt);
      if (this.t > 0.3 + n * 0.25 && n < 10) { n++; k.hit({ kb: 0, col: '#b0f0ff', silent: n % 2 === 0 }); E.slime.frozen = 0.6; if (n % 3 === 0) SFX.ice(); }
    },
    draw(c) {
      const fade = this.t > dur - 0.4 ? Math.max(0, (dur - this.t) / 0.4) : 1;
      spikes.forEach(s => {
        const h = s.h * Math.min(1, s.t * 8) * fade;
        if (h < 1) return;
        PX.tri(c, s.x - s.w, GROUND + 1, s.x + s.w, GROUND + 1, s.x, GROUND - h, '#4ab8e8');
        PX.tri(c, s.x - s.w + 1, GROUND + 1, s.x, GROUND + 1, s.x, GROUND - h + 1, '#d8f6ff');
        PX.rect(c, s.x, GROUND - h, 1, 1, '#ffffff');
      });
    },
    end() {
      const S = E.target(); SFX.shatter();
      E.burst(S.x, S.y, 50, ICE, { spd: 140, life: 0.9, grav: 260, size: 2, floor: true, shrink: true, up: -40 });
      E.burst(S.x, S.y, 20, ICE, { spd: 160, life: 0.3, add: true, shape: 'streak' });
      E.flash('#d8f6ff', 0.15, 0.6); E.shake(4, 0.3);
      spikes.forEach(s => E.burst(s.x, GROUND - s.h / 2, 3, ICE, { spd: 60, life: 0.6, grav: 200, floor: true }));
    },
  });
};

SKILL_FX.storm = k => {
  const dur = 2.5;
  E.darken(0.62, dur); SFX.rumble(dur);
  const bx = E.target().x;
  const cl = Array.from({ length: 10 }, (_, i) => ({ x: bx - 80 + i * 17 + rnd(-5, 5), y: rnd(2, 12), r: rnd(9, 14), ph: rnd(0, 6) }));
  E.fx({
    layer: 2, dur,
    draw(c) {
      const a = Math.min(1, this.t * 3, (dur - this.t) * 3), dx = q => q.x + Math.sin(this.t + q.ph) * 3;
      c.globalAlpha = a;
      cl.forEach(q => PX.disc(c, dx(q), q.y - 2, q.r + 2, '#1a1428'));
      cl.forEach(q => PX.disc(c, dx(q), q.y, q.r, '#3a3450'));
      cl.forEach(q => PX.disc(c, dx(q) - 2, q.y - 3, q.r * 0.5, '#5a5470'));
    },
  });
  for (let i = 0; i < 5; i++) E.after(0.45 + i * 0.36, () => {
    const S = E.target();
    bolt(S.x + rnd(-30, 30), 10, S.x + rnd(-4, 4), S.top + 2, { dur: 0.3, w: 5, jag: 10, branches: 4, col: '#8ef6ff' });
    bolt(S.x, S.top, S.x + rnd(-2, 2), GROUND, { dur: 0.2, w: 3, jag: 3, branches: 1, col: '#ffe066' });
    E.flash('#ffffff', 0.12, 0.7); E.shake(4, 0.2); SFX.thunder(); E.hitstop(0.04);
    E.burst(S.x, GROUND - 2, 18, ELEC, { spd: 120, life: 0.4, dir: -Math.PI / 2, spread: 2.6, add: true, shape: 'streak', grav: 200 });
    k.hit({ kb: 4, col: '#fff8a0' });
  });
};

// ══════════ 고급 ══════════
const DRAGON_CV = (() => { const [cv, c] = PX.mk(16, 10); PX.sprite(c, DRAGON_HEAD, DRAGON_PAL, 0, 0); return cv; })();
SKILL_FX.dragon = k => {
  const dur = 2.2;
  SFX.tone(90, 0.7, 'sawtooth', 0.2, 45); SFX.noise(0.7, 0.3, 500, 'lowpass', 200);
  E.tint('#ff6a00', 0.1, dur); E.darken(0.3, dur);
  let n = 0;
  E.fx({
    layer: 1, dur,
    update() {
      this.hx = E.player.x - 4; this.hy = GROUND - 62 + Math.sin(this.t * 8);
      const mouth = { x: this.hx + 30, y: this.hy + 15 };
      if (this.t > 0.45 && this.t < dur - 0.3) {
        if (!this.sfx) { this.sfx = true; SFX.noise(dur - 0.75, 0.35, 900, 'lowpass', 400); }
        const S = E.target(), a0 = Math.atan2(S.y - mouth.y, S.x - mouth.x);
        for (let i = 0; i < 8; i++) { const a = a0 + rnd(-0.2, 0.2), s = rnd(170, 250); E.part({ x: mouth.x, y: mouth.y + rnd(-1, 1), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.45, 0.7), cols: FIRE, size: pick([2, 3, 3, 4]), add: true, shrink: true, drag: 0.8 }); }
        if (Math.random() < 0.3) E.part({ x: S.x + rnd(-10, 10), y: S.y + rnd(-10, 10), vx: rnd(-20, 30), vy: rnd(-60, -20), life: 0.8, cols: SMOKE, size: 3, shrink: true });
        if (this.t > 0.5 + n * 0.09 && n < 16) { n++; k.hit({ kb: 1, col: '#ffb070', silent: n % 3 !== 0 }); E.slime.burn = 1; E.shake(1.5, 0.1); }
      }
    },
    draw(c) {
      if (this.hx === undefined) return;
      const a = Math.min(1, this.t * 4, (dur - this.t) * 4), hx = this.hx, hy = this.hy;
      c.globalAlpha = a * 0.55;
      c.globalCompositeOperation = 'lighter';
      PX.disc(c, hx + 16, hy + 10, 18 + Math.sin(this.t * 20), '#6a1a10');
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = a * 0.9;
      for (let i = 8; i >= 0; i--) {
        const x = hx + 6 - i * 3.2, y = hy + 22 + i * 3.6 + Math.sin(this.t * 6 + i * 0.8) * 2.5, r = 6 - i * 0.45;
        PX.disc(c, x, y, r + 1, '#140c1c'); PX.disc(c, x, y, r, i % 2 ? '#d8323c' : '#b02830'); PX.rect(c, x - 1, y - r - 1, 2, 2, '#ffd23f');
      }
      c.drawImage(DRAGON_CV, Math.round(hx), Math.round(hy), 32, 20);
      if (this.t > 0.45 && this.t < dur - 0.3) { c.globalCompositeOperation = 'lighter'; PX.disc(c, hx + 30, hy + 15, 4 + Math.sin(this.t * 40), '#ffd23f'); }
    },
  });
};

SKILL_FX.blackhole = k => {
  const S = E.target(), cx = S.x, cy = S.y - 4, dur = 2.3;
  E.darken(0.62, dur + 0.3); SFX.rumble(dur); SFX.tone(420, dur, 'sawtooth', 0.07, 50);
  const motes = []; let n = 0;
  E.fx({
    layer: 1, dur,
    update(dt) {
      for (let i = 0; i < 4; i++) motes.push({ a: rnd(0, 6.28), r: rnd(30, 85), w: rnd(2, 4), c: pick(VOID.slice(0, 4)) });
      motes.forEach(m => { m.a += m.w * dt * (40 / (m.r + 5)); m.r -= dt * (40 + 400 / (m.r + 4)); });
      for (let i = motes.length - 1; i >= 0; i--) if (motes[i].r < 4) motes.splice(i, 1);
      E.slime.kx = Math.sin(this.t * 40) * 1.5; E.slime.sx = 0.78 + Math.sin(this.t * 30) * 0.08; E.slime.sy = 1.25;
      if (this.t > 0.3 + n * 0.17 && n < 10) { n++; k.hit({ kb: 0, col: '#ff9af0', silent: n % 2 === 0 }); }
      E.G.parts.forEach(p => { const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) + 1; if (d < 90) { p.vx += dx / d * 300 * dt; p.vy += dy / d * 300 * dt; } });
      this.r = 9 * Math.min(1, this.t / 0.5) * (1 + Math.sin(this.t * 12) * 0.08);
    },
    draw(c) {
      const r = this.r || 0;
      c.globalCompositeOperation = 'lighter';
      motes.forEach(m => { const x = cx + Math.cos(m.a) * m.r, y = cy + Math.sin(m.a) * m.r * 0.45; PX.rect(c, x, y, 1, 1, m.c); PX.rect(c, x - Math.sin(m.a) * 2, y + Math.cos(m.a), 1, 1, '#5a1fa8'); });
      PX.disc(c, cx, cy, r + 6, '#3a0f6a'); PX.ring(c, cx, cy, r + 4, '#b45cff', 0.4, 2); PX.ring(c, cx, cy, r + 2, '#ff9af0');
      c.globalCompositeOperation = 'source-over';
      PX.disc(c, cx, cy, r, '#000000');
      PX.ring(c, cx, cy, r + 4, '#ffffff', 0.4, 1, 0.3 + this.t * 3, 1.9 + this.t * 3);
    },
    end() {
      E.fx({
        layer: 1, dur: 0.18,
        draw(c) { const r = 9 * (1 - this.t / 0.18); PX.disc(c, cx, cy, r + 2, '#ff9af0'); PX.disc(c, cx, cy, r, '#000000'); },
        end() {
          E.flash('#ffffff', 0.3, 1); E.shake(7, 0.6); E.hitstop(0.1); SFX.boom(2);
          k.hit({ mult: 6, crit: true, kb: 14 });
          E.burst(cx, cy, 90, VOID, { spd: 200, life: 0.9, size: 2, add: true, drag: 2.5, shrink: true });
          E.burst(cx, cy, 30, VOID, { spd: 260, life: 0.4, add: true, shape: 'streak' });
          E.fx({ layer: 4, dur: 0.6, draw(c) { const q = this.t / 0.6; PX.ring(c, cx, cy, 6 + q * 100, '#b45cff', 1, 2); PX.ring(c, cx, cy, 4 + q * 70, '#ff9af0', 0.6); PX.ring(c, cx, GROUND, 10 + q * 120, '#ffffff', 0.25); } });
        },
      });
    },
  });
};

// ══════════ 전설 ══════════
function drawHolySword(c, x, y, glow) {
  x = Math.round(x); y = Math.round(y);
  const K = '#140c1c';
  if (glow) { c.globalCompositeOperation = 'lighter'; PX.rect(c, x - 6, y + 12, 13, 32, '#4a3608'); PX.rect(c, x - 12, y + 9, 25, 8, '#4a3608'); c.globalCompositeOperation = 'source-over'; }
  PX.disc(c, x, y + 2, 2.5, K); PX.disc(c, x, y + 2, 1.6, '#ffd23f'); PX.rect(c, x, y + 2, 1, 1, '#e8364f');
  PX.rect(c, x - 2, y + 4, 5, 8, K); PX.rect(c, x - 1, y + 5, 3, 6, '#6b3f1f'); PX.rect(c, x - 1, y + 6, 3, 1, '#a0673a'); PX.rect(c, x - 1, y + 8, 3, 1, '#a0673a');
  PX.rect(c, x - 10, y + 11, 21, 5, K); PX.rect(c, x - 9, y + 12, 19, 3, '#ffd23f'); PX.rect(c, x - 9, y + 12, 19, 1, '#fff3b0');
  PX.rect(c, x - 11, y + 9, 3, 4, K); PX.rect(c, x + 9, y + 9, 3, 4, K); PX.rect(c, x - 10, y + 10, 1, 2, '#ffd23f'); PX.rect(c, x + 10, y + 10, 1, 2, '#ffd23f');
  PX.rect(c, x - 1, y + 12, 3, 3, '#3fa9ff');
  PX.rect(c, x - 4, y + 16, 9, 26, K); PX.rect(c, x - 3, y + 16, 7, 25, '#e6e9ef'); PX.rect(c, x - 3, y + 16, 1, 25, '#ffffff'); PX.rect(c, x + 3, y + 16, 1, 25, '#a3aab7'); PX.rect(c, x, y + 17, 1, 22, '#b8c4d8');
  for (let i = 0; i < 5; i++) { const w = 3 - Math.floor(i * 0.75); PX.rect(c, x - w - 1, y + 41 + i, (w + 1) * 2 + 1, 1, K); if (w > 0) PX.rect(c, x - w + 1, y + 41 + i, w * 2 - 1, 1, '#e6e9ef'); }
}
SKILL_FX.holysword = k => {
  const x = E.target().x, y1 = GROUND - 44;
  E.darken(0.5, 2.6); SFX.chord(523, 1.6);
  groundCircle(x, 26, '#ffd23f', 2.4, { runes: true, grow: true });
  E.fx({
    layer: 4, dur: 1.1,
    update() {
      if (Math.random() < 0.8) E.part({ x: x + rnd(-14, 14), y: rnd(0, GROUND), vx: 0, vy: rnd(20, 50), life: 0.8, cols: LIGHT, add: true });
      if (Math.random() < 0.15) E.part({ x: x + rnd(-30, 30), y: -2, vx: rnd(-8, 8), vy: 25, life: 3, cols: ['#ffffff', '#fff8d0'], size: 2, update: (p, d) => { p.vx = Math.sin(p.life * 6) * 14; } });
    },
    draw(c) {
      const q = this.t / 1.1, w = Math.min(1, q * 3) * 8 * (1 - Math.max(0, q - 0.85) / 0.15), fl = Math.sin(this.t * 50) * 0.5;
      PX.rect(c, x - w - 2, 0, (w + 2) * 2, GROUND, '#5a4210'); PX.rect(c, x - w, 0, w * 2, GROUND, '#b8860b'); PX.rect(c, x - w * 0.5 - fl, 0, w + fl * 2, GROUND, '#fff3b0');
    },
  });
  E.after(1.0, () => {
    const dur = 0.2, y0 = -70;
    SFX.whoosh(0.2, 2000);
    E.fx({
      layer: 1, dur,
      draw(c) {
        const q = this.t / dur, y = y0 + (y1 - y0) * q * q;
        c.globalAlpha = 0.3; for (let i = 3; i > 0; i--) drawHolySword(c, x, y - i * 14, 0);
        c.globalAlpha = 1; drawHolySword(c, x, y, 1);
      },
      end() {
        k.hit({ crit: true, kb: 12, col: '#ffe066' });
        E.flash('#ffffff', 0.35, 1); E.shake(8, 0.8); E.hitstop(0.14); SFX.clang(); SFX.boom(2.4); SFX.chord(784, 1.2);
        E.burst(x, GROUND - 4, 100, LIGHT, { spd: 220, life: 1, size: 2, add: true, drag: 2.5, shrink: true, dir: -Math.PI / 2, spread: 3.2 });
        E.burst(x, GROUND, 30, DUST, { spd: 140, life: 1, size: 2, grav: 300, up: -60, floor: true, shrink: true, dir: -Math.PI / 2, spread: 2.4 });
        E.fx({ layer: 4, dur: 0.8, draw(c) { const q = this.t / 0.8; PX.ring(c, x, GROUND, 8 + q * 130, '#ffe066', 0.25, 2); PX.ring(c, x, GROUND, 4 + q * 90, '#ffffff', 0.25); PX.ring(c, x, GROUND - 20, 6 + q * 60, '#fff3b0'); } });
        for (let i = 0; i < 6; i++) {
          const px = x + (i - 2.5) * 24;
          E.after(Math.abs(i - 2.5) * 0.05, () => E.fx({ layer: 4, dur: 0.5, draw(c) { const h = (1 - this.t / 0.5) * 70; PX.rect(c, px - 1, GROUND - h, 3, h, '#ffe066'); PX.rect(c, px, GROUND - h, 1, h, '#ffffff'); } }));
        }
        E.fx({
          layer: 1, dur: 1.4,
          update() { if (Math.random() < 0.4) E.part({ x: x + rnd(-3, 3), y: rnd(GROUND - 44, GROUND - 4), vx: rnd(-10, 10), vy: -20, life: 0.6, cols: LIGHT, add: true }); },
          draw(c) { c.globalAlpha = Math.min(1, (1.4 - this.t) * 2); drawHolySword(c, x, y1, 1); },
        });
      },
    });
  });
};

function drawPhoenix(c, x, y, ang, t) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const T = (u, v) => [x + u * ca - v * sa, y + u * sa + v * ca];
  const f = Math.sin(t * 26);
  c.globalCompositeOperation = 'lighter';
  PX.disc(c, x, y, 11, '#5a1408');
  c.globalCompositeOperation = 'source-over';
  [[-14, -3, '#e8401c'], [-16, 0, '#ff8a1f'], [-13, 3, '#e8401c'], [-18, 1, '#ffd23f']].forEach(([u, v, col]) => PX.line(c, ...T(-3, 0), ...T(u + Math.sin(t * 30 + v) * 1.5, v), col, 1));
  PX.tri(c, ...T(1, 0), ...T(-4, 0), ...T(-9, -13 * f - 1), '#a8261a');
  PX.tri(c, ...T(2, 0), ...T(-3, 1), ...T(-6, -11 * f), '#ff8a1f');
  PX.tri(c, ...T(1, 0), ...T(-3, 0), ...T(-4, -6 * f), '#ffd23f');
  PX.disc(c, ...T(0, 0), 3, '#ff8a1f'); PX.disc(c, ...T(0, 0), 1.6, '#ffd23f');
  PX.disc(c, ...T(4, -1), 2, '#ffd23f');
  const [bx, by] = T(6.5, -1); PX.rect(c, bx, by, 1, 1, '#ffffff');
  const [ex, ey] = T(4, -2); PX.rect(c, ex, ey, 1, 1, '#140c1c');
  const [qx, qy] = T(3, -4); PX.rect(c, qx, qy, 1, 2, '#ff5a3c');
}
SKILL_FX.phoenix = k => {
  const P = E.hand(), S0 = E.target();
  const b = [[P.x, P.y], [P.x + 10, 10], [S0.x - 80, -6], [S0.x - 45, 26]];
  const hx = S0.x - 45, hy = 26, ex = hx + (S0.x - hx) * 2.4, ey = hy + (S0.y - hy) * 2.4;
  const bez = (u, i) => { const m = 1 - u; return m * m * m * b[0][i] + 3 * m * m * u * b[1][i] + 3 * m * u * u * b[2][i] + u * u * u * b[3][i]; };
  SFX.whoosh(0.7, 500); E.tint('#ff6a00', 0.08, 1.8); E.darken(0.35, 1.8);
  let n = 0;
  E.fx({
    layer: 1, dur: 1.7,
    update() {
      const t = this.t; let x, y;
      if (t < 0.7) { const u = t / 0.7; x = bez(u, 0); y = bez(u, 1); }
      else if (t < 1.05) {
        x = hx + Math.sin((t - 0.7) * 12) * 2; y = hy - Math.sin((t - 0.7) * 9) * 4;
        if (!this.scr) { this.scr = 1; SFX.screech(); E.burst(x, y, 30, FIRE, { spd: 90, life: 0.6, add: true, size: 2, shrink: true }); }
      } else {
        const u = Math.min(1, (t - 1.05) / 0.55); x = hx + (ex - hx) * u; y = hy + (ey - hy) * u;
        if (!this.dv) { this.dv = 1; SFX.whoosh(0.4, 1500); }
        if (u > 0.36 + n * 0.03 && n < 6) {
          n++; k.hit({ kb: 3, col: '#ffb070', silent: n % 2 === 0 }); E.slime.burn = 2;
          if (n === 1) { E.shake(5, 0.4); E.hitstop(0.06); SFX.boom(1.2); }
          if (n === 6) { const S = E.target(); explode(S.x, S.y, 2); E.flash('#ffb060', 0.2, 0.6); }
        }
      }
      this.ang = this.x === undefined ? -1.2 : Math.atan2(y - this.y, x - this.x) || this.ang;
      this.x = x; this.y = y;
      for (let i = 0; i < 5; i++) E.part({ x: x + rnd(-3, 3), y: y + rnd(-2, 2), vx: -Math.cos(this.ang) * 40 + rnd(-20, 20), vy: -Math.sin(this.ang) * 40 + rnd(-20, 20), life: rnd(0.3, 0.7), cols: FIRE, size: pick([1, 2, 2, 3]), add: true, shrink: true });
    },
    draw(c) { if (this.x !== undefined) drawPhoenix(c, this.x, this.y, this.ang || 0, this.t); },
  });
};

// ══════════ 신화 ══════════
SKILL_FX.omega = k => {
  const P = E.hand(), ox = P.x + 6, oy = P.y - 1, charge = 1.3, fire = 1.5, dur = charge + fire + 0.3;
  E.darken(0.8, dur); SFX.charge(charge);
  let n = 0;
  E.fx({
    layer: 1, dur,
    update() {
      const t = this.t;
      E.player.cast = 0.5;
      if (t < charge) {
        for (let i = 0; i < 5; i++) { const a = rnd(0, 6.28), r = rnd(30, 70), h = rnd(0, 360); E.part({ x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r, vx: -Math.cos(a) * r * 2.2, vy: -Math.sin(a) * r * 2.2, life: 0.45, cols: [PX.hsl(h), PX.hsl(h + 30, 100, 75), '#ffffff'], add: true, shape: 'streak' }); }
        E.shake(t / charge * 1.5, 0.05);
      } else if (t < charge + fire) {
        if (!this.fired) { this.fired = 1; SFX.beam(fire); E.flash('#ffffff', 0.25, 0.9); E.hitstop(0.08); }
        E.shake(4, 0.06);
        const S = E.target();
        for (let i = 0; i < 4; i++) E.part({ x: rnd(ox, W), y: oy + rnd(-8, 8), vx: rnd(100, 300), vy: rnd(-60, 60), life: 0.35, cols: [PX.hsl(t * 600 + i * 40), '#ffffff'], add: true, shape: 'streak' });
        E.burst(S.x - 8, oy, 3, ['#ffffff', '#ff9af0', '#8ef6ff'], { spd: 160, life: 0.3, add: true, dir: Math.PI, spread: 2.5, shape: 'streak' });
        if (t > charge + n * 0.1 && n < 14) { n++; k.hit({ kb: 3, col: PX.hsl(n * 40, 100, 75), silent: n % 2 === 0 }); }
      }
    },
    draw(c) {
      const t = this.t;
      c.globalCompositeOperation = 'lighter';
      if (t < charge) {
        const q = t / charge;
        PX.disc(c, ox, oy, 2 + q * 7 + Math.sin(t * 40) * 0.6, PX.hsl(t * 500, 100, 55)); PX.disc(c, ox, oy, 1 + q * 4, '#ffffff');
        for (let i = 0; i < 3; i++) PX.ring(c, ox, oy, (1 - ((t * 2 + i / 3) % 1)) * 36, PX.hsl(t * 300 + i * 120));
      } else {
        const bt = t - charge, shr = bt > fire ? Math.max(0, 1 - (bt - fire) / 0.3) : 1, h = (12 + Math.sin(t * 60) * 2) * shr * Math.min(1, bt / 0.08);
        for (let x = ox; x < W + 8; x += 4) { const wob = Math.sin(x * 0.2 - t * 40) * 1.5; PX.rect(c, x, oy - h / 2 - wob, 4, h + wob * 2, PX.hsl(x * 2 - t * 900, 100, 45)); }
        PX.rect(c, ox, oy - h * 0.32, W - ox + 8, h * 0.64, '#ff9af0');
        PX.rect(c, ox, oy - h * 0.18, W - ox + 8, Math.max(1, h * 0.36), '#ffffff');
        PX.disc(c, ox, oy, h * 0.75 + 2, '#ffffff'); PX.ring(c, ox, oy, h + 3 + Math.sin(t * 30) * 2, PX.hsl(t * 700));
        if (h > 1) PX.disc(c, E.target().x - 10, oy, h * 0.9, '#ffffff');
      }
    },
    end() { const S = E.target(); E.burst(S.x, S.y, 60, ['#ffffff', '#ff9af0', '#8ef6ff', '#b45cff'], { spd: 150, life: 0.9, add: true, size: 2, shrink: true }); SFX.boom(1.5); E.shake(5, 0.3); },
  });
};

SKILL_FX.timestop = k => {
  const cx = W / 2, cy = 56, total = 12;
  SFX.bell(); SFX.tick();
  E.G.invertTo = 1; E.G.frozen = true;
  const slashes = [], ghosts = []; let n = 0;
  E.fx({
    layer: 3, dur: 2.9,
    update(dt) {
      const t = this.t;
      if (t > 0.5 && t < 2.1) {
        E.player.hide = true;
        if (t > 0.5 + n * 0.13 && n < total) {
          n++;
          const S = E.target(), an = rnd(-1.3, 1.3) + (n % 2 ? 0 : Math.PI / 2), side = n % 2 ? -1 : 1;
          slashes.push({ x: S.x + rnd(-6, 6), y: S.y + rnd(-6, 4), an, len: rnd(30, 46), t: 0 });
          ghosts.push({ x: S.x + side * rnd(18, 30), side });
          SFX.tick(); SFX.shing();
        }
      }
      slashes.forEach(s => s.t += dt);
      if (t >= 2.1 && !this.rel) {
        this.rel = true; E.player.hide = false; E.G.invertTo = 0; E.G.frozen = false;
        SFX.tone(440, 1, 'sine', 0.15); SFX.tone(660, 1, 'sine', 0.1);
        slashes.forEach((s, i) => E.after(i * 0.035, () => {
          k.hit({ kb: 2, col: '#ff9af0', silent: i % 2 === 1 });
          E.burst(s.x, s.y, 8, ['#ffffff', '#ff9af0', '#8ef6ff'], { spd: 140, life: 0.35, add: true, shape: 'streak' });
          if (i % 3 === 0) SFX.slash();
        }));
        E.after(0.45, () => {
          E.flash('#ffffff', 0.3, 1); E.shake(7, 0.5); SFX.boom(1.8); E.hitstop(0.1);
          const S = E.target(); E.burst(S.x, S.y, 80, ['#ffffff', '#ff9af0', '#ffd23f', '#8ef6ff'], { spd: 200, life: 0.9, add: true, size: 2, shrink: true });
        });
      }
    },
    draw(c) {
      const t = this.t, a = Math.min(1, t * 4, (2.9 - t) * 3);
      c.globalAlpha = a * 0.85;
      const r = 34 + Math.min(1, t * 5) * 4;
      PX.ring(c, cx, cy, r, '#ffd23f', 1, 2); PX.ring(c, cx, cy, r - 4, '#ffffff');
      for (let i = 0; i < 12; i++) { const an = i * Math.PI / 6; PX.rect(c, cx + Math.cos(an) * (r - 8) - 1, cy + Math.sin(an) * (r - 8) - 1, 2, 2, i % 3 === 0 ? '#ffd23f' : '#ffffff'); }
      const spin = t < 0.45 ? t * 30 : t < 2.1 ? 13.5 : 13.5 + (t - 2.1) * 20;
      PX.line(c, cx, cy, cx + Math.cos(spin - Math.PI / 2) * (r - 12), cy + Math.sin(spin - Math.PI / 2) * (r - 12), '#ffffff', 2);
      PX.line(c, cx, cy, cx + Math.cos(spin / 12 - Math.PI / 2) * (r - 18), cy + Math.sin(spin / 12 - Math.PI / 2) * (r - 18), '#ffd23f', 2);
      PX.disc(c, cx, cy, 2, '#ff5ad9');
      const rel = t > 2.1;
      ghosts.forEach((g, i) => {
        if (rel) return;
        c.globalAlpha = i === ghosts.length - 1 ? 0.95 : 0.3;
        c.save(); c.translate(Math.round(g.x), 0); if (g.side > 0) c.scale(-1, 1);
        c.drawImage(E.player.sprite, -12, GROUND - 31); c.restore();
      });
      slashes.forEach(s => {
        const l = s.len * Math.min(1, s.t * 12), ca = Math.cos(s.an), sa = Math.sin(s.an);
        const th = rel ? Math.max(1, 3 - (t - 2.1) * 6) : 2;
        c.globalAlpha = rel ? Math.max(0, 1 - (t - 2.1) * 2) : 1;
        PX.line(c, s.x - ca * l / 2, s.y - sa * l / 2, s.x + ca * l / 2, s.y + sa * l / 2, '#ff5ad9', th + 1);
        PX.line(c, s.x - ca * l / 2, s.y - sa * l / 2, s.x + ca * l / 2, s.y + sa * l / 2, '#ffffff', 1);
      });
    },
    end() { E.player.hide = false; E.G.invertTo = 0; E.G.frozen = false; },
  });
};

// ══════════ 기본 공격 ══════════
function swingArc(cx, cy, a0, a1, r, cols, dur = 0.18) {
  return E.fx({
    layer: 4, dur,
    draw(c) {
      const q = this.t / dur, a = a0 + (a1 - a0) * Math.min(1, q * 2.5), from = Math.max(a0, a - 2);
      c.globalAlpha = 1 - q;
      for (let i = 0; i < 5; i++) PX.ring(c, cx, cy, r - i, cols[Math.min(cols.length - 1, i >> 1)], 1, 1, from + i * 0.12, a);
    },
  });
}
function star(x, y, col = '#ffd23f', dur = 0.35, size = 8) {
  E.fx({ layer: 4, dur, draw(c) {
    const l = size * Math.sin(this.t / dur * Math.PI), d = l * 0.4;
    PX.line(c, x - l, y, x + l, y, '#ffffff'); PX.line(c, x, y - l, x, y + l, '#ffffff');
    PX.line(c, x - d, y - d, x + d, y + d, col); PX.line(c, x - d, y + d, x + d, y - d, col); PX.disc(c, x, y, 1.5, '#ffffff');
  } });
}
SKILL_FX.attack = k => {
  const P = E.player; if (P.busy) return; P.busy = true;
  const home = P.homeX, tx = Math.max(home, E.slime.x - 26);
  SFX.whoosh(0.15, 1500);
  let hit = false, gt = 0;
  E.fx({
    layer: 1, dur: 0.52,
    update(dt) {
      const t = this.t;
      if (t < 0.12) {
        const q = t / 0.12; P.x = home + (tx - home) * (1 - (1 - q) * (1 - q)); P.swing = -2.2; P.dash = 1;
        if ((gt -= dt) <= 0) { gt = 0.025; E.afterimage('#8ef6ff', 0.5, 0.2); }
        E.part({ x: P.x - 4, y: GROUND - 1, vx: rnd(-40, -10), vy: rnd(-20, -5), life: 0.3, cols: DUST, size: 2, shrink: true });
      } else if (t < 0.25) {
        P.x = tx; P.dash = 0;
        const q = (t - 0.12) / 0.13; P.swing = -2.2 + 3.3 * (1 - Math.pow(1 - q, 3));
        if (!hit && q > 0.3) {
          hit = true; const g = E.grip();
          swingArc(g.x, g.y, -2.2, 1.1, 15, ['#ffffff', '#8ef6ff', '#4aa8ff']);
          k.hit({ kb: 6 }); SFX.slash(); E.shake(2, 0.1); E.hitstop(0.04);
          const S = E.target(); E.burst(S.x - 6, S.y, 10, ['#ffffff', '#8ef6ff'], { spd: 120, life: 0.25, add: true, shape: 'streak', dir: 0, spread: 1.6 });
        }
      } else {
        const q = Math.min(1, (t - 0.25) / 0.27); P.x = tx + (home - tx) * q * q * (3 - 2 * q); P.swing = 1.1 - q * 1.6;
      }
    },
    end() { P.x = home; P.swing = null; P.dash = 0; P.busy = false; },
  });
};
function critImpact(k) {
  const S = E.target(), x = S.x, y = S.y;
  k.hit({ crit: true, kb: 16, col: '#ffd23f' });
  E.flash('#fff0e0', 0.22, 0.9); E.hitstop(0.16); E.shake(7, 0.45); SFX.clang(); SFX.boom(1.3); SFX.slash();
  [-0.75, 0.75].forEach((a, i) => E.fx({ layer: 3, dur: 0.45, draw(c) {
    const q = Math.min(1, (this.t - i * 0.05) / 0.08); if (q <= 0) return;
    const l = 34 * q, th = this.t < 0.2 ? 5 : this.t < 0.32 ? 3 : 1, ca = Math.cos(a), sa = Math.sin(a);
    c.globalAlpha = Math.min(1, (0.45 - this.t) / 0.15);
    PX.line(c, x - ca * l, y - sa * l, x + ca * l, y + sa * l, '#e8364f', th + 2);
    PX.line(c, x - ca * l, y - sa * l, x + ca * l, y + sa * l, '#ffffff', th);
  } }));
  E.burst(x, y, 40, ['#ffffff', '#ffd23f', '#ff5a3c'], { spd: 220, life: 0.45, add: true, shape: 'streak', drag: 3 });
  E.burst(x, y, 30, FIRE, { spd: 120, life: 0.7, size: 2, add: true, shrink: true });
  E.fx({ layer: 4, dur: 0.45, draw(c) { const q = this.t / 0.45; PX.ring(c, x, y, 6 + q * 60, '#ffd23f', 1, 2); PX.ring(c, x, GROUND, 8 + q * 90, '#ff5a3c', 0.25); } });
  E.fx({ layer: 3, dur: 1.0, draw(c) {
    const t = this.t, s = t < 0.06 ? 3 : 2, str = 'CRITICAL!', w = PX.textW(str, s);
    c.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
    const tx = Math.max(2, Math.min(W - w - 2, x - w / 2 + (t < 0.3 ? Math.round(rnd(-1, 1)) : 0)));
    PX.text(c, str, tx, y - 46 - t * 8, t % 0.1 < 0.05 ? '#ffffff' : '#ffd23f', s);
  } });
}
SKILL_FX.critical = k => {
  const P = E.player; if (P.busy) return; P.busy = true;
  const home = P.homeX, tx = Math.max(home, E.slime.x - 26);
  SFX.charge(0.4); E.darken(0.5, 1.1);
  let hit = false, gt = 0, glint = false;
  E.fx({
    layer: 1, dur: 1.15,
    update(dt) {
      const t = this.t;
      if (t < 0.4) {
        P.swing = -2.5; P.crouch = 1;
        if (Math.random() < 0.8) E.part({ x: P.x + rnd(-8, 8), y: GROUND - rnd(0, 6), vx: 0, vy: rnd(-60, -30), life: 0.5, cols: ['#ffffff', '#ffd23f', '#ff5a3c', '#a8261a'], add: true, shape: 'streak' });
        if (!glint && t > 0.25) { glint = true; const h = E.hand(); star(h.x, h.y, '#ffd23f', 0.4, 10); SFX.tone(2600, 0.3, 'triangle', 0.12); SFX.tone(3900, 0.3, 'sine', 0.06, null, 0.03); }
      } else if (t < 0.5) {
        P.crouch = 0; P.dash = 1; P.x = home + (tx - home) * (t - 0.4) / 0.1;
        if ((gt -= dt) <= 0) { gt = 0.018; E.afterimage(pick(['#ffd23f', '#ff5a3c']), 0.6, 0.3); }
        if (!this.ws) { this.ws = 1; SFX.whoosh(0.2, 2500); }
      } else if (t < 0.62) {
        P.x = tx; P.dash = 0; const q = (t - 0.5) / 0.12; P.swing = -2.5 + 3.8 * (1 - Math.pow(1 - q, 3));
        if (!hit && q > 0.25) { hit = true; const g = E.grip(); swingArc(g.x, g.y, -2.5, 1.3, 16, ['#ffffff', '#ffd23f', '#ff5a3c'], 0.22); critImpact(k); }
      } else if (t > 0.8) {
        const q = Math.min(1, (t - 0.8) / 0.3); P.x = tx + (home - tx) * q * q * (3 - 2 * q); P.swing = 1.3 - q * 1.8;
      }
    },
    end() { P.x = home; P.swing = null; P.crouch = 0; P.dash = 0; P.busy = false; },
  });
};
