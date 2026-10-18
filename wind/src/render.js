// Canvas2D 렌더러 — 하늘·지형은 미리 구워 두고, 바람·비행체·효과는 매 프레임
import { W, H, NX, NY } from './sim.js';

export const PALETTES = {
  dawn: {
    sky: ['#26345e', '#6f6596', '#e9967a', '#fbd7a6'], sun: [0.8, 0.62], sunC: '255,226,170', sunR: 0.07,
    far: ['#9b86ad', '#7c6a98'], land: ['#4b3f63', '#231d33'], rim: '#f6c9a0', grass: '#a9cf8f', tree: '#2f2944',
    water: ['#7d93c4', '#2b3966'], streak: '255,247,235', cloud: '255,224,210',
  },
  noon: {
    sky: ['#2f7fcf', '#5fb0e8', '#a9dcf6', '#e7f6ff'], sun: [0.2, 0.18], sunC: '255,252,230', sunR: 0.05,
    far: ['#9cc5df', '#7fafcd'], land: ['#5e7f4b', '#2a3f27'], rim: '#d9f2a2', grass: '#b8e07a', tree: '#2c4a2a',
    water: ['#4fa3d9', '#1b4f80'], streak: '255,255,255', cloud: '255,255,255',
  },
  sunset: {
    sky: ['#2c1c48', '#8b3a68', '#e8724a', '#ffcf73'], sun: [0.7, 0.72], sunC: '255,200,120', sunR: 0.09,
    far: ['#a2577a', '#7b3d66'], land: ['#43284a', '#1d1226'], rim: '#ffb071', grass: '#e3a76a', tree: '#2a1730',
    water: ['#c76a6a', '#3b1f45'], streak: '255,236,214', cloud: '255,190,160',
  },
  night: {
    sky: ['#03071a', '#0b1536', '#1a2754', '#2f3c6e'], sun: [0.78, 0.2], sunC: '220,230,255', sunR: 0.035, moon: true, stars: true,
    far: ['#1c2650', '#141c3e'], land: ['#182042', '#090d20'], rim: '#6f86c9', grass: '#3d5a8a', tree: '#0a0f24',
    water: ['#22346a', '#070c22'], streak: '190,214,255', cloud: '120,140,200',
  },
  mist: {
    sky: ['#40566a', '#6f8796', '#a9b9c0', '#d9e0dc'], sun: [0.35, 0.3], sunC: '250,250,240', sunR: 0.05,
    far: ['#8fa1a8', '#7a8e97'], land: ['#3e4f52', '#1c2628'], rim: '#cfe2d6', grass: '#9fbf9a', tree: '#203030',
    water: ['#6f8f9f', '#24414e'], streak: '245,252,255', cloud: '235,240,240',
  },
};

const STROKE_RGB = { soft: '150,236,255', strong: '255,206,110' };
const NPART = 1500;
const BRUSH_R = 6;

function rng(seed) {
  let s = seed >>> 0 || 7;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000003) / 1000003; };
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.dpr = 1; this.sc = 1; this.ox = 0; this.oy = 0;
    this.px = new Float32Array(NPART); this.py = new Float32Array(NPART);
    this.pl = new Float32Array(NPART); this.pm = new Float32Array(NPART);
    this.fx = [];
    this.clouds = [];
    this.tint = document.createElement('canvas');
    this.tint.width = NX; this.tint.height = NY;
    this.tctx = this.tint.getContext('2d');
    this.timg = this.tctx.createImageData(NX, NY);
    this.bg = document.createElement('canvas');
    this.fg = document.createElement('canvas');
    this.puff = this._makePuff();
    this.t = 0;
    this.hover = null;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    this.cv.width = w; this.cv.height = h;
    this.dpr = dpr;
    const pad = 4 * dpr;
    this.sc = Math.min((w - pad * 2) / W, (h - pad * 2) / H);
    this.ox = (w - W * this.sc) / 2;
    this.oy = (h - H * this.sc) / 2;
    if (this.sim) this._bake();
  }

  sx(x) { return this.ox + x * this.sc; }
  sy(y) { return this.oy + (H - y) * this.sc; }
  toWorld(cssX, cssY) { return [(cssX * this.dpr - this.ox) / this.sc, H - (cssY * this.dpr - this.oy) / this.sc]; }

  setLevel(sim) {
    this.sim = sim;
    this.pal = PALETTES[sim.level.palette] || PALETTES.noon;
    this.fx = [];
    const r = rng(sim.level.seed || 11);
    for (let i = 0; i < NPART; i++) this._spawn(i, Math.random);
    this.clouds = [];
    const nc = sim.level.clouds ?? 7;
    for (let i = 0; i < nc; i++) {
      const parts = [];
      const n = 4 + ((r() * 4) | 0);
      for (let k = 0; k < n; k++) parts.push([(k - n / 2) * 4 + r() * 3, r() * 3, 4 + r() * 5]);
      this.clouds.push({ x: r() * (W + 40) - 20, y: 72 + r() * 36, parts, a: 0.25 + r() * 0.35, sp: 0.15 + r() * 0.2 });
    }
    this._bake();
  }

  _spawn(i, rand) {
    const f = this.sim.fluid;
    for (let tries = 0; tries < 6; tries++) {
      const x = rand() * W, y = rand() * H;
      if (!f.isSolidAt(x, y)) { this.px[i] = x; this.py[i] = y; break; }
    }
    this.pm[i] = 1.5 + rand() * 2.5;
    this.pl[i] = rand() * this.pm[i];
  }

  _makePuff() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return c;
  }

  // ───────────── 정적 레이어 굽기 ─────────────
  _bake() {
    const { cv, pal, sim } = this;
    const w = cv.width, h = cv.height;
    for (const c of [this.bg, this.fg]) { c.width = w; c.height = h; }
    const g = this.bg.getContext('2d');
    const r = rng(sim.level.seed || 3);

    const sky = g.createLinearGradient(0, 0, 0, h);
    pal.sky.forEach((c, i) => sky.addColorStop(i / (pal.sky.length - 1), c));
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    if (pal.stars) {
      for (let i = 0; i < 260; i++) {
        const x = r() * w, y = r() * h * 0.75, s = r();
        g.fillStyle = `rgba(230,236,255,${0.25 + s * 0.6})`;
        g.fillRect(x, y, (s > 0.92 ? 2.2 : 1.2) * this.dpr, (s > 0.92 ? 2.2 : 1.2) * this.dpr);
      }
    }
    const sx = this.ox + pal.sun[0] * W * this.sc, sy = this.oy + pal.sun[1] * H * this.sc;
    const sr = pal.sunR * W * this.sc;
    const glow = g.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 7);
    glow.addColorStop(0, `rgba(${pal.sunC},0.55)`);
    glow.addColorStop(0.25, `rgba(${pal.sunC},0.16)`);
    glow.addColorStop(1, `rgba(${pal.sunC},0)`);
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    g.fillStyle = `rgb(${pal.sunC})`;
    g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
    if (pal.moon) {
      g.fillStyle = pal.sky[1];
      g.beginPath(); g.arc(sx + sr * 0.45, sy - sr * 0.25, sr * 0.9, 0, Math.PI * 2); g.fill();
    }

    // 원경 산 실루엣 2겹
    pal.far.forEach((col, layer) => {
      const base = 30 - layer * 10, amp = 22 - layer * 6;
      const ph = r() * 100, f1 = 0.018 + r() * 0.01, f2 = 0.05 + r() * 0.03;
      g.fillStyle = col;
      g.globalAlpha = 0.55 + layer * 0.2;
      g.beginPath();
      g.moveTo(0, h);
      for (let px = 0; px <= w; px += 6 * this.dpr) {
        const x = (px - this.ox) / this.sc;
        const y = base + amp * (0.55 * Math.sin(x * f1 + ph) + 0.3 * Math.sin(x * f2 + ph * 2) + 0.15 * Math.sin(x * 0.13 + ph));
        g.lineTo(px, this.sy(y));
      }
      g.lineTo(w, h);
      g.fill();
    });
    g.globalAlpha = 1;
    const haze = g.createLinearGradient(0, this.sy(40), 0, h);
    haze.addColorStop(0, `rgba(${pal.cloud},0)`);
    haze.addColorStop(1, `rgba(${pal.cloud},0.18)`);
    g.fillStyle = haze;
    g.fillRect(0, this.sy(40), w, h);

    this._bakeTerrain(r);
  }

  _bakeTerrain(r) {
    const g = this.fg.getContext('2d');
    const { pal, sim } = this;
    const lv = sim.level;
    g.clearRect(0, 0, this.fg.width, this.fg.height);
    const polys = sim.polys.map((pg, i) => {
      if (i !== 0) return pg;
      const p = pg.slice(0, lv.ground.length);
      const a = p[0], b = p[p.length - 1];
      return [[-400, a[1]], ...p, [W + 400, b[1]], [W + 400, -60], [-400, -60]];
    });
    for (const pg of polys) {
      let top = -1e9, bot = 1e9;
      for (const [, y] of pg) { top = Math.max(top, y); bot = Math.min(bot, y); }
      bot = Math.max(bot, -2);
      const gr = g.createLinearGradient(0, this.sy(top), 0, this.sy(bot));
      gr.addColorStop(0, pal.land[0]);
      gr.addColorStop(1, pal.land[1]);
      g.save();
      g.beginPath();
      pg.forEach(([x, y], i) => (i ? g.lineTo(this.sx(x), this.sy(y)) : g.moveTo(this.sx(x), this.sy(y))));
      g.closePath();
      g.fillStyle = gr;
      g.fill();
      g.clip();
      // 지층 결
      g.strokeStyle = 'rgba(255,255,255,0.045)';
      g.lineWidth = 1.2 * this.dpr;
      for (let y = top; y > bot - 2; y -= 3.2) {
        g.beginPath();
        const ph = r() * 10;
        for (let x = -20; x <= W + 20; x += 4) {
          const yy = y + Math.sin(x * 0.07 + ph) * 0.9 + Math.sin(x * 0.21 + ph) * 0.3;
          x === -20 ? g.moveTo(this.sx(x), this.sy(yy)) : g.lineTo(this.sx(x), this.sy(yy));
        }
        g.stroke();
      }
      for (let i = 0; i < 220; i++) {
        const x = -10 + r() * (W + 20), y = bot + r() * (top - bot);
        g.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.08})`;
        g.beginPath(); g.arc(this.sx(x), this.sy(y), (0.3 + r() * 0.9) * this.sc, 0, Math.PI * 2); g.fill();
      }
      g.restore();

      // 윗면 테두리(풀/빛) + 나무
      let area = 0;
      for (let i = 0; i < pg.length; i++) { const a = pg[i], b = pg[(i + 1) % pg.length]; area += a[0] * b[1] - b[0] * a[1]; }
      const sgn = area > 0 ? 1 : -1;
      for (let i = 0; i < pg.length; i++) {
        const a = pg[i], b = pg[(i + 1) % pg.length];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;
        const ny = (sgn * -dx) / L;
        if (ny < 0.2) {
          if (ny < -0.2) continue;
          g.strokeStyle = 'rgba(255,255,255,0.08)';
          g.lineWidth = 1.5 * this.dpr;
        } else {
          g.strokeStyle = ny > 0.55 ? pal.grass : pal.rim;
          g.lineWidth = (ny > 0.55 ? 3.2 : 2) * this.dpr;
        }
        g.beginPath(); g.moveTo(this.sx(a[0]), this.sy(a[1])); g.lineTo(this.sx(b[0]), this.sy(b[1])); g.stroke();
        if (ny > 0.75) this._decorEdge(g, a, b, L, r);
      }
    }
  }

  _decorEdge(g, a, b, L, r) {
    const lv = this.sim.level, pal = this.pal;
    const avoid = [];
    if (lv.flyer) avoid.push([lv.flyer.x, 10]);
    if (lv.goal) avoid.push([lv.goal.type === 'ring' ? lv.goal.x : (lv.goal.x0 + lv.goal.x1) / 2, lv.goal.type === 'ring' ? lv.goal.r + 4 : (lv.goal.x1 - lv.goal.x0) / 2 + 3]);
    for (const hsrc of lv.heat || []) avoid.push([hsrc.x, hsrc.w / 2 + 3]);
    const dens = lv.trees ?? 0.06;
    const n = Math.floor(L * dens + r());
    for (let k = 0; k < n; k++) {
      const t = r();
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      if (x < -5 || x > W + 5) continue;
      if (avoid.some(([ax, ar]) => Math.abs(x - ax) < ar)) continue;
      if ((lv.water || []).some((wt) => x > wt.x0 - 2 && x < wt.x1 + 2 && y < wt.y + 1)) continue;
      const hgt = 2.5 + r() * 4.5;
      g.fillStyle = pal.tree;
      const X = this.sx(x), Y = this.sy(y - 0.3), s = this.sc;
      if (r() < 0.55) {
        for (let q = 0; q < 3; q++) {
          const yy = Y - (q * hgt * 0.28) * s, ww = (hgt * 0.42 - q * 0.45) * s;
          g.beginPath(); g.moveTo(X - ww, yy); g.lineTo(X, yy - hgt * 0.55 * s); g.lineTo(X + ww, yy); g.fill();
        }
      } else {
        g.fillRect(X - 0.18 * s, Y - hgt * 0.5 * s, 0.36 * s, hgt * 0.5 * s);
        g.beginPath(); g.arc(X, Y - hgt * 0.62 * s, hgt * 0.33 * s, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(X + hgt * 0.2 * s, Y - hgt * 0.5 * s, hgt * 0.24 * s, 0, Math.PI * 2); g.fill();
      }
    }
    g.strokeStyle = pal.grass;
    g.globalAlpha = 0.7;
    g.lineWidth = 1 * this.dpr;
    const nt = Math.floor(L * 0.9);
    g.beginPath();
    for (let k = 0; k < nt; k++) {
      const t = r();
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const X = this.sx(x), Y = this.sy(y), hh = (0.4 + r() * 0.8) * this.sc;
      g.moveTo(X, Y); g.lineTo(X + (r() - 0.5) * hh * 0.8, Y - hh);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  // ───────────── 매 프레임 ─────────────
  frame(dt, ui) {
    this.t += dt;
    const { cx, sim } = this;
    const f = sim.fluid;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.drawImage(this.bg, 0, 0);
    this._clouds(dt);
    this._tint(f);
    this._streaks(dt, f);
    this._heat();
    cx.drawImage(this.fg, 0, 0);
    this._water();
    this._nodraw();
    this._goal();
    this._motes();
    this._launchMarker();
    if (ui.hint) this._strokes(sim.level.hint || [], 'hint');
    if (ui.faint) cx.globalAlpha = 0.28;
    this._strokes(sim.strokes, ui.hoverStroke);
    cx.globalAlpha = 1;
    if (ui.drawing) this._strokes([ui.drawing], null, true);
    for (const fl of sim.flyers) this._flyer(fl);
    this._fx(dt);
    this._cursor(ui);
  }

  _clouds(dt) {
    const { cx, sim } = this;
    const o = [0, 0];
    cx.globalAlpha = 1;
    for (const c of this.clouds) {
      sim.fluid.sample(Math.min(W - 1, Math.max(1, c.x)), Math.min(H - 1, c.y), o);
      c.x += (o[0] * 0.25 + c.sp) * dt;
      if (c.x > W + 30) c.x = -30; else if (c.x < -30) c.x = W + 30;
      for (const [dx, dy, rr] of c.parts) {
        const R = rr * this.sc * 1.6;
        cx.globalAlpha = c.a * 0.55;
        cx.drawImage(this.puff, this.sx(c.x + dx) - R, this.sy(c.y + dy) - R, R * 2, R * 2);
      }
    }
    cx.globalAlpha = 1;
  }

  _tint(f) {
    const d = this.timg.data;
    const { u, v, T, solid, ambU, ambV } = f;
    const [sr, sg, sb] = this.pal.streak.split(',').map(Number);
    for (let j = 0; j < NY; j++) {
      const row = (NY - 1 - j) * NX;
      for (let i = 0; i < NX; i++) {
        const k = i + j * NX, o = (row + i) * 4;
        if (solid[k]) { d[o + 3] = 0; continue; }
        const s = Math.hypot(u[k] - ambU, v[k] - ambV);
        const t = T[k];
        let a = Math.min(0.17, s * 0.011);
        let r = sr, g = sg, b = sb;
        if (t > 0.05) { const q = Math.min(1, t * 0.35); r = 255; g = 150 + 70 * (1 - q); b = 90 * (1 - q); a = Math.max(a, Math.min(0.3, t * 0.09)); }
        else if (t < -0.05) { const q = Math.min(1, -t * 0.35); r = 140 - 60 * q; g = 200; b = 255; a = Math.max(a, Math.min(0.3, -t * 0.09)); }
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a * 255;
      }
    }
    this.tctx.putImageData(this.timg, 0, 0);
    const cx = this.cx;
    cx.imageSmoothingEnabled = true;
    cx.drawImage(this.tint, this.ox, this.oy, W * this.sc, H * this.sc);
  }

  _streaks(dt, f) {
    const { cx, px, py, pl, pm } = this;
    const o = [0, 0];
    const buckets = [[], [], [], []];
    const k = 0.28;
    for (let i = 0; i < NPART; i++) {
      pl[i] += dt;
      if (pl[i] > pm[i]) { this._spawn(i, Math.random); pl[i] = 0; }
      f.sampleFelt(px[i], py[i], o);
      px[i] += o[0] * dt; py[i] += o[1] * dt;
      if (px[i] < 0 || px[i] > W || py[i] < 0 || py[i] > H || f.isSolidAt(px[i], py[i])) { pl[i] = pm[i] + 1; continue; }
      const s = Math.hypot(o[0], o[1]);
      const life = pl[i] / pm[i];
      const fade = Math.min(1, life * 5, (1 - life) * 4);
      const a = Math.min(1, s / 9) * fade;
      if (a < 0.06) continue;
      const b = Math.min(3, (a * 4) | 0);
      buckets[b].push(px[i], py[i], o[0], o[1]);
    }
    cx.lineCap = 'round';
    cx.lineWidth = 1.3 * this.dpr;
    for (let b = 0; b < 4; b++) {
      const arr = buckets[b];
      if (!arr.length) continue;
      cx.strokeStyle = `rgba(${this.pal.streak},${0.12 + b * 0.13})`;
      cx.beginPath();
      for (let q = 0; q < arr.length; q += 4) {
        const x = arr[q], y = arr[q + 1];
        cx.moveTo(this.sx(x), this.sy(y));
        cx.lineTo(this.sx(x - arr[q + 2] * k), this.sy(y - arr[q + 3] * k));
      }
      cx.stroke();
    }
  }

  _surfaceY(x) {
    let y = H;
    while (y > 0 && !this.sim.hit(x, y)) y -= 0.5;
    return y;
  }

  _heat() {
    const { cx, sim } = this;
    for (const h of sim.level.heat || []) {
      if (h._y === undefined) h._y = this._surfaceY(h.x);
      const hot = h.p > 0;
      const pulse = 0.75 + 0.25 * Math.sin(this.t * 2.2 + h.x);
      const X = this.sx(h.x), Y = this.sy(h._y), R = (h.w * 0.75) * this.sc;
      const gr = cx.createRadialGradient(X, Y, 0, X, Y, R);
      const col = hot ? '255,140,60' : '150,220,255';
      gr.addColorStop(0, `rgba(${col},${0.55 * pulse})`);
      gr.addColorStop(1, `rgba(${col},0)`);
      cx.fillStyle = gr;
      cx.fillRect(X - R, Y - R, R * 2, R * 2);
      if (hot) {
        // 달궈진 바위: 어두운 돌 + 주황빛 균열
        for (let q = -2; q <= 2; q++) {
          const sx = this.sx(h.x + q * h.w * 0.16), rr = (1.1 + ((q * 7 + 11) % 5) * 0.18) * this.sc;
          cx.fillStyle = '#2b1d1c';
          cx.beginPath(); cx.ellipse(sx, Y - rr * 0.35, rr, rr * 0.7, 0, Math.PI, 0); cx.fill();
          cx.strokeStyle = `rgba(255,${120 + 60 * pulse},60,${0.6 + 0.3 * pulse})`;
          cx.lineWidth = 1.3 * this.dpr;
          cx.beginPath(); cx.moveTo(sx - rr * 0.5, Y - rr * 0.2); cx.lineTo(sx, Y - rr * 0.65); cx.lineTo(sx + rr * 0.4, Y - rr * 0.3); cx.stroke();
        }
      } else {
        cx.strokeStyle = `rgba(220,245,255,${0.35 + 0.2 * pulse})`;
        cx.lineWidth = 2 * this.dpr;
        cx.beginPath(); cx.moveTo(this.sx(h.x - h.w / 2), Y - 2); cx.lineTo(this.sx(h.x + h.w / 2), Y - 2); cx.stroke();
      }
      if (hot && Math.random() < 0.35) this.fx.push({ x: h.x + (Math.random() - 0.5) * h.w * 0.7, y: h._y + 0.5, vx: 0, vy: 2, life: 1.6, max: 1.6, kind: 'ember', s: 0.25 });
      if (!hot && Math.random() < 0.25) this.fx.push({ x: h.x + (Math.random() - 0.5) * h.w * 0.8, y: h._y + 6 + Math.random() * 10, vx: 0, vy: -1, life: 2, max: 2, kind: 'frost', s: 0.22 });
    }
  }

  _water() {
    const { cx, pal, sim } = this;
    for (const wt of sim.water) {
      const x0 = wt.x0 < 1 ? -400 : wt.x0, x1 = wt.x1 > W - 1 ? W + 400 : wt.x1;
      const gr = cx.createLinearGradient(0, this.sy(wt.y), 0, this.sy(-5));
      gr.addColorStop(0, pal.water[0]);
      gr.addColorStop(1, pal.water[1]);
      cx.fillStyle = gr;
      cx.globalAlpha = 0.92;
      cx.beginPath();
      cx.moveTo(this.sx(x0), this.sy(-60));
      for (let x = x0; x <= x1; x += 1.5) cx.lineTo(this.sx(x), this.sy(wt.y + Math.sin(x * 0.35 + this.t * 1.8) * 0.18 + Math.sin(x * 0.11 - this.t) * 0.12));
      cx.lineTo(this.sx(x1), this.sy(-60));
      cx.fill();
      cx.globalAlpha = 1;
      cx.strokeStyle = 'rgba(255,255,255,0.35)';
      cx.lineWidth = 1.2 * this.dpr;
      cx.beginPath();
      for (let x = Math.max(x0, -10); x <= Math.min(x1, W + 10); x += 7) {
        const o = (Math.sin(x * 1.7 + this.t * 0.8) * 0.5 + 0.5) * 2;
        cx.moveTo(this.sx(x + o), this.sy(wt.y - 0.6 - (x % 3)));
        cx.lineTo(this.sx(x + o + 2.2), this.sy(wt.y - 0.6 - (x % 3)));
      }
      cx.stroke();
    }
  }

  _nodraw() {
    const { cx, sim } = this;
    for (const z of sim.level.nodraw || []) {
      const X = this.sx(z.x0), Y = this.sy(z.y1), Wd = (z.x1 - z.x0) * this.sc, Hd = (z.y1 - z.y0) * this.sc;
      cx.fillStyle = 'rgba(255,90,110,0.07)';
      cx.fillRect(X, Y, Wd, Hd);
      cx.save();
      cx.beginPath(); cx.rect(X, Y, Wd, Hd); cx.clip();
      cx.strokeStyle = 'rgba(255,130,140,0.16)';
      cx.lineWidth = 1.5 * this.dpr;
      cx.beginPath();
      const step = 3 * this.sc;
      for (let d = -Hd; d < Wd; d += step) { cx.moveTo(X + d, Y + Hd); cx.lineTo(X + d + Hd, Y); }
      cx.stroke();
      cx.restore();
      cx.setLineDash([6 * this.dpr, 6 * this.dpr]);
      cx.strokeStyle = 'rgba(255,150,160,0.5)';
      cx.strokeRect(X, Y, Wd, Hd);
      cx.setLineDash([]);
      cx.fillStyle = 'rgba(255,190,195,0.85)';
      cx.font = `${12 * this.dpr}px "Gowun Dodum", sans-serif`;
      cx.fillText('바람 금지', X + 6 * this.dpr, Y + 16 * this.dpr);
    }
  }

  _goal() {
    const { cx, sim } = this;
    const g = sim.level.goal;
    if (!g) return;
    const t = this.t;
    if (g.type === 'ring') {
      const X = this.sx(g.x), Y = this.sy(g.y), R = g.r * this.sc;
      const gr = cx.createRadialGradient(X, Y, R * 0.2, X, Y, R * 1.6);
      gr.addColorStop(0, 'rgba(255,240,190,0.22)');
      gr.addColorStop(0.6, 'rgba(255,220,140,0.12)');
      gr.addColorStop(1, 'rgba(255,220,140,0)');
      cx.fillStyle = gr;
      cx.beginPath(); cx.arc(X, Y, R * 1.6, 0, Math.PI * 2); cx.fill();
      cx.lineWidth = 3 * this.dpr;
      cx.strokeStyle = `rgba(255,236,170,${0.75 + 0.2 * Math.sin(t * 3)})`;
      cx.beginPath(); cx.arc(X, Y, R, 0, Math.PI * 2); cx.stroke();
      cx.setLineDash([4 * this.dpr, 10 * this.dpr]);
      cx.lineDashOffset = -t * 30 * this.dpr;
      cx.lineWidth = 2 * this.dpr;
      cx.strokeStyle = 'rgba(255,255,255,0.6)';
      cx.beginPath(); cx.arc(X, Y, R * 0.78, 0, Math.PI * 2); cx.stroke();
      cx.setLineDash([]);
    } else {
      const X0 = this.sx(g.x0), X1 = this.sx(g.x1), Y0 = this.sy(g.y0), Y1 = this.sy(g.y1 + 6);
      const gr = cx.createLinearGradient(0, Y0, 0, Y1);
      gr.addColorStop(0, 'rgba(255,240,160,0.28)');
      gr.addColorStop(1, 'rgba(255,240,160,0)');
      cx.fillStyle = gr;
      cx.fillRect(X0, Y1, X1 - X0, Y0 - Y1);
      const r = rng(77);
      const cols = ['#ffd6e8', '#fff3a6', '#ffffff', '#ffb3c7', '#c7e8ff'];
      for (let x = g.x0 + 1; x < g.x1; x += 1.6) {
        const yb = this._gy(g, x);
        const hh = 0.8 + r() * 1.4, sw = Math.sin(t * 1.5 + x) * 0.15;
        cx.strokeStyle = 'rgba(120,200,120,0.8)';
        cx.lineWidth = 1 * this.dpr;
        cx.beginPath(); cx.moveTo(this.sx(x), this.sy(yb)); cx.lineTo(this.sx(x + sw), this.sy(yb + hh)); cx.stroke();
        cx.fillStyle = cols[(r() * cols.length) | 0];
        cx.beginPath(); cx.arc(this.sx(x + sw), this.sy(yb + hh), 0.45 * this.sc, 0, Math.PI * 2); cx.fill();
      }
      cx.setLineDash([3 * this.dpr, 7 * this.dpr]);
      cx.strokeStyle = 'rgba(255,240,170,0.55)';
      cx.lineWidth = 1.5 * this.dpr;
      cx.strokeRect(X0, this.sy(g.y1), X1 - X0, Y0 - this.sy(g.y1));
      cx.setLineDash([]);
    }
  }

  _gy(g, x) {
    if (!g._ys) g._ys = {};
    const key = Math.round(x * 2);
    if (g._ys[key] === undefined) {
      let y = g.y1;
      while (y > g.y0 - 3 && !this.sim.hit(x, y - 0.3)) y -= 0.3;
      g._ys[key] = y;
    }
    return g._ys[key];
  }

  _star(x, y, R, rot) {
    const cx = this.cx;
    cx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4, rr = i % 2 ? R * 0.32 : R;
      const X = x + Math.cos(a) * rr, Y = y + Math.sin(a) * rr;
      i ? cx.lineTo(X, Y) : cx.moveTo(X, Y);
    }
    cx.closePath();
    cx.fill();
  }

  _motes() {
    const { cx, sim } = this;
    for (const m of sim.motes) {
      if (m.got) continue;
      const X = this.sx(m.x), Y = this.sy(m.y + Math.sin(this.t * 2 + m.x) * 0.4), R = 1.5 * this.sc;
      const gr = cx.createRadialGradient(X, Y, 0, X, Y, R * 2.6);
      gr.addColorStop(0, 'rgba(255,246,200,0.7)');
      gr.addColorStop(1, 'rgba(255,230,150,0)');
      cx.fillStyle = gr;
      cx.beginPath(); cx.arc(X, Y, R * 2.6, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = '#fff8dc';
      this._star(X, Y, R * (1 + 0.15 * Math.sin(this.t * 4 + m.y)), this.t * 0.6);
    }
  }

  _launchMarker() {
    const { cx, sim } = this;
    const L = sim.level.flyer;
    if (!L) return;
    if (L.type === 'seed') {
      const gy = this._surfaceY(L.x);
      cx.strokeStyle = 'rgba(140,200,120,0.95)';
      cx.lineWidth = 2 * this.dpr;
      cx.beginPath(); cx.moveTo(this.sx(L.x), this.sy(gy)); cx.quadraticCurveTo(this.sx(L.x + 0.8), this.sy((gy + L.y) / 2), this.sx(L.x), this.sy(L.y - 1)); cx.stroke();
      if (sim.phase === 'plan') {
        cx.strokeStyle = 'rgba(255,255,255,0.85)';
        cx.lineWidth = 1 * this.dpr;
        cx.beginPath();
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2 + Math.sin(this.t) * 0.05;
          cx.moveTo(this.sx(L.x), this.sy(L.y)); cx.lineTo(this.sx(L.x + Math.cos(a) * 2.4), this.sy(L.y + Math.sin(a) * 2.4));
        }
        cx.stroke();
      }
      return;
    }
    if (sim.phase !== 'plan') return;
    if (L.type === 'glider') {
      const bob = Math.sin(this.t * 2.4) * 0.25;
      const fake = { kind: 'glider', x: L.x, y: L.y + bob, a: L.angle ?? 0, state: 'fly', trail: [] };
      this._flyer(fake);
      const a = L.angle ?? 0;
      cx.setLineDash([2 * this.dpr, 6 * this.dpr]);
      cx.lineDashOffset = -this.t * 20 * this.dpr;
      cx.strokeStyle = 'rgba(255,255,255,0.55)';
      cx.lineWidth = 1.5 * this.dpr;
      cx.beginPath();
      cx.moveTo(this.sx(L.x + Math.cos(a) * 2.5), this.sy(L.y + Math.sin(a) * 2.5));
      cx.lineTo(this.sx(L.x + Math.cos(a) * 14), this.sy(L.y + Math.sin(a) * 14));
      cx.stroke();
      cx.setLineDash([]);
    } else if (L.type === 'lantern') {
      const n = L.count ?? 4;
      for (let i = 0; i < n; i++) this._flyer({ kind: 'lantern', x: L.x + (i - (n - 1) / 2) * 2.6, y: L.y, fuel: 1, fuel0: 1, state: 'fly', trail: [], ph: i });
    }
  }

  _path(pts) {
    const cx = this.cx;
    cx.beginPath();
    pts.forEach(([x, y], i) => (i ? cx.lineTo(this.sx(x), this.sy(y)) : cx.moveTo(this.sx(x), this.sy(y))));
  }

  _strokes(list, mark, live) {
    const { cx } = this;
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    for (const s of list) {
      if (s.pts.length < 2) continue;
      const hint = mark === 'hint';
      const rgb = hint ? '255,255,255' : (s === mark ? '255,110,120' : STROKE_RGB[s.power]);
      this._path(s.pts);
      if (!hint) {
        cx.strokeStyle = `rgba(${rgb},0.09)`;
        cx.lineWidth = BRUSH_R * 1.7 * this.sc;
        cx.stroke();
      }
      cx.strokeStyle = `rgba(${rgb},${hint ? 0.35 : 0.42})`;
      cx.lineWidth = (hint ? 1.5 : 2.2) * this.dpr;
      if (hint) cx.setLineDash([5 * this.dpr, 7 * this.dpr]);
      cx.stroke();
      cx.setLineDash([2 * this.dpr, 15 * this.dpr]);
      cx.lineDashOffset = -this.t * s.speed * this.sc * 0.9;
      cx.lineWidth = 4.2 * this.dpr;
      cx.strokeStyle = `rgba(${rgb},${hint ? 0.55 : live ? 0.7 : 0.95})`;
      cx.stroke();
      cx.setLineDash([]);
      const n = s.pts.length, a = s.pts[n - 2], b = s.pts[n - 1];
      const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      const X = this.sx(b[0]), Y = this.sy(b[1]), A = 1.6 * this.sc;
      cx.fillStyle = `rgba(${rgb},${hint ? 0.5 : 0.9})`;
      cx.beginPath();
      cx.moveTo(X + Math.cos(ang) * A, Y + Math.sin(ang) * A);
      cx.lineTo(X + Math.cos(ang + 2.5) * A, Y + Math.sin(ang + 2.5) * A);
      cx.lineTo(X + Math.cos(ang - 2.5) * A, Y + Math.sin(ang - 2.5) * A);
      cx.fill();
    }
  }

  _trail(fl, rgb, width, alpha) {
    const tr = fl.trail, cx = this.cx;
    if (tr.length < 4) return;
    const n = tr.length / 2;
    cx.lineWidth = width * this.dpr;
    for (let i = 1; i < n; i++) {
      cx.strokeStyle = `rgba(${rgb},${(i / n) * alpha})`;
      cx.beginPath();
      cx.moveTo(this.sx(tr[(i - 1) * 2]), this.sy(tr[(i - 1) * 2 + 1]));
      cx.lineTo(this.sx(tr[i * 2]), this.sy(tr[i * 2 + 1]));
      cx.stroke();
    }
  }

  _flyer(fl) {
    const { cx } = this;
    const s = this.sc;
    const X = this.sx(fl.x), Y = this.sy(fl.y);
    if (fl.kind === 'glider') {
      if (fl.state === 'crash' || fl.state === 'splash' || fl.state === 'lost') return;
      this._trail(fl, '255,255,255', 1.6, 0.45);
      cx.save();
      cx.translate(X, Y);
      cx.rotate(-fl.a);
      cx.scale(s * 1.15, s * 1.15);
      cx.shadowColor = 'rgba(0,0,0,0.25)';
      cx.shadowBlur = 6 * this.dpr;
      cx.fillStyle = '#c9d1dc';
      cx.beginPath(); cx.moveTo(1.4, 0); cx.lineTo(-1.15, 0.05); cx.lineTo(-0.95, 0.42); cx.closePath(); cx.fill();
      cx.shadowBlur = 0;
      cx.fillStyle = '#ffffff';
      cx.beginPath(); cx.moveTo(1.4, 0); cx.lineTo(-1.3, -0.62); cx.lineTo(-1.15, 0.05); cx.closePath(); cx.fill();
      cx.strokeStyle = 'rgba(120,130,150,0.6)';
      cx.lineWidth = 0.06;
      cx.beginPath(); cx.moveTo(1.4, 0); cx.lineTo(-1.15, 0.05); cx.stroke();
      cx.restore();
    } else if (fl.kind === 'seed') {
      if (fl.state === 'wait' || fl.state === 'splash' || fl.state === 'lost') return;
      if (fl.state === 'fly') this._trail(fl, '255,255,255', 1, 0.25);
      const R = 1.1 * s;
      cx.strokeStyle = fl.state === 'goal' ? 'rgba(255,245,180,0.95)' : 'rgba(255,255,255,0.9)';
      cx.lineWidth = 0.8 * this.dpr;
      cx.beginPath();
      cx.moveTo(X, Y); cx.lineTo(X, Y - R * 0.9);
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (i - 4) * 0.33 + Math.sin(fl.spin) * 0.08;
        cx.moveTo(X, Y - R * 0.9); cx.lineTo(X + Math.cos(a) * R, Y - R * 0.9 + Math.sin(a) * R);
      }
      cx.stroke();
      cx.fillStyle = '#8a6a4a';
      cx.beginPath(); cx.arc(X, Y, 0.22 * s, 0, Math.PI * 2); cx.fill();
    } else if (fl.kind === 'lantern') {
      if (fl.state === 'wait' || fl.state === 'splash' || fl.state === 'lost' || fl.state === 'burnt') return;
      if (fl.state === 'fly' && fl.trail) this._trail(fl, '255,190,110', 1.2, 0.25);
      const lit = Math.max(0, Math.min(1, fl.fuel / 3 + 0.25));
      const fl1 = 0.85 + 0.15 * Math.sin(this.t * 13 + (fl.ph || 0) * 7);
      const R = 7 * s * lit * fl1;
      if (R > 0) {
        const gr = cx.createRadialGradient(X, Y, 0, X, Y, R);
        gr.addColorStop(0, `rgba(255,190,100,${0.45 * lit})`);
        gr.addColorStop(1, 'rgba(255,150,60,0)');
        cx.fillStyle = gr;
        cx.beginPath(); cx.arc(X, Y, R, 0, Math.PI * 2); cx.fill();
      }
      const w0 = 0.75 * s, w1 = 0.55 * s, hh = 1.9 * s;
      const body = cx.createLinearGradient(0, Y - hh / 2, 0, Y + hh / 2);
      body.addColorStop(0, `rgba(255,${170 + 60 * lit},${110 + 60 * lit},1)`);
      body.addColorStop(1, `rgba(255,${120 + 80 * lit},60,1)`);
      cx.fillStyle = lit > 0.3 ? body : '#7a5a50';
      cx.beginPath();
      cx.moveTo(X - w0, Y - hh / 2); cx.lineTo(X + w0, Y - hh / 2); cx.lineTo(X + w1, Y + hh / 2); cx.lineTo(X - w1, Y + hh / 2); cx.closePath();
      cx.fill();
      cx.fillStyle = `rgba(255,255,220,${0.9 * lit})`;
      cx.beginPath(); cx.ellipse(X, Y + hh / 2 - 0.15 * s, 0.22 * s, 0.32 * s * fl1, 0, 0, Math.PI * 2); cx.fill();
    }
  }

  burst(kind, x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random();
      const p = { x, y, vx: Math.cos(a) * sp * 6, vy: Math.sin(a) * sp * 6, life: 0.6 + Math.random() * 0.8, kind, s: 0.3 + Math.random() * 0.4 };
      if (kind === 'splash') { p.vx *= 0.6; p.vy = 4 + Math.random() * 7; }
      if (kind === 'paper') { p.vy = Math.random() * 5; p.s = 0.5 + Math.random() * 0.4; p.rot = Math.random() * 6; }
      if (kind === 'goal') { p.vx *= 2.2; p.vy *= 2.2; p.life += 0.6; }
      p.max = p.life;
      this.fx.push(p);
    }
  }

  _fx(dt) {
    const { cx } = this;
    const keep = [];
    const o = [0, 0];
    for (const p of this.fx) {
      p.life -= dt;
      if (p.life <= 0) continue;
      keep.push(p);
      if (p.kind === 'splash' || p.kind === 'paper') p.vy -= 9.8 * dt * (p.kind === 'paper' ? 0.35 : 1);
      if (p.kind === 'ember' || p.kind === 'frost') {
        this.sim.fluid.sample(Math.max(0, Math.min(W, p.x)), Math.max(0, Math.min(H, p.y)), o);
        p.vx += (o[0] - p.vx) * dt * 2; p.vy += (o[1] - p.vy) * dt * 2;
      } else { p.vx *= 1 - dt * 1.2; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const a = Math.min(1, p.life / p.max * 1.5);
      const X = this.sx(p.x), Y = this.sy(p.y), R = p.s * this.sc;
      if (p.kind === 'splash') cx.fillStyle = `rgba(200,230,255,${a})`;
      else if (p.kind === 'paper') cx.fillStyle = `rgba(245,245,250,${a})`;
      else if (p.kind === 'ember') cx.fillStyle = `rgba(255,170,90,${a * 0.8})`;
      else if (p.kind === 'frost') cx.fillStyle = `rgba(210,240,255,${a * 0.6})`;
      else cx.fillStyle = `rgba(255,240,180,${a})`;
      if (p.kind === 'paper') {
        p.rot += dt * 5;
        cx.save(); cx.translate(X, Y); cx.rotate(p.rot); cx.fillRect(-R, -R * 0.5, R * 2, R); cx.restore();
      } else if (p.kind === 'mote' || p.kind === 'goal') {
        this._star(X, Y, R * 1.6, p.life * 3);
      } else {
        cx.beginPath(); cx.arc(X, Y, R, 0, Math.PI * 2); cx.fill();
      }
    }
    this.fx = keep;
  }

  _cursor(ui) {
    if (!ui.pointer || ui.touch) return;
    const { cx } = this;
    const [x, y] = ui.pointer;
    const X = this.sx(x), Y = this.sy(y);
    const er = ui.tool === 'erase';
    cx.strokeStyle = er ? 'rgba(255,140,150,0.7)' : `rgba(${STROKE_RGB[ui.tool] || '255,255,255'},0.55)`;
    cx.lineWidth = 1.2 * this.dpr;
    cx.setLineDash([3 * this.dpr, 4 * this.dpr]);
    cx.beginPath(); cx.arc(X, Y, (er ? 4 : BRUSH_R) * this.sc, 0, Math.PI * 2); cx.stroke();
    cx.setLineDash([]);
    if (ui.blocked) {
      cx.strokeStyle = 'rgba(255,120,130,0.9)';
      cx.beginPath(); cx.moveTo(X - 6 * this.dpr, Y - 6 * this.dpr); cx.lineTo(X + 6 * this.dpr, Y + 6 * this.dpr); cx.stroke();
    }
  }
}

