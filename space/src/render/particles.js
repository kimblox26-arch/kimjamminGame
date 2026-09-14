// ORBITER — 파티클 시스템
// 엔진 화염, 연기, 폭발, 재진입 플라즈마, 먼지, 물보라를 담당한다.
// 월드 좌표(미터)에 존재하며 카메라 변환을 거쳐 그려진다.

import {
  clamp01,
  lerp,
  rand,
  randSign,
  TAU,
  Vec2,
  withAlpha,
  mixHex,
  swapRemove,
} from '../core/math.js';

/** 파티클 한 개 — 플랫 배열 대신 객체 풀을 쓴다 */
class Particle {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.life = 0;
    this.maxLife = 1;
    this.size = 1;
    this.endSize = 1;
    this.color = '#ffffff';
    this.endColor = '#ffffff';
    this.alpha = 1;
    this.drag = 0;
    this.gravity = 0;
    this.rotation = 0;
    this.spin = 0;
    this.kind = 'smoke';
    this.additive = false;
    this.active = false;
    return this;
  }
}

export class ParticleSystem {
  constructor(opts = {}) {
    this.max = opts.max ?? 2200;
    this.pool = [];
    this.active = [];
    this.quality = opts.quality ?? 1;
    for (let i = 0; i < 256; i++) this.pool.push(new Particle());
    this.gravityVector = new Vec2(0, 0);
  }

  get count() {
    return this.active.length;
  }

  clear() {
    for (const p of this.active) {
      p.active = false;
      this.pool.push(p);
    }
    this.active.length = 0;
  }

  _alloc() {
    if (this.active.length >= this.max) return null;
    const p = this.pool.pop() ?? new Particle();
    p.reset();
    p.active = true;
    this.active.push(p);
    return p;
  }

  spawn(cfg) {
    const p = this._alloc();
    if (!p) return null;
    p.x = cfg.x;
    p.y = cfg.y;
    p.vx = cfg.vx ?? 0;
    p.vy = cfg.vy ?? 0;
    p.maxLife = cfg.life ?? 1;
    p.life = p.maxLife;
    p.size = cfg.size ?? 1;
    p.endSize = cfg.endSize ?? p.size;
    p.color = cfg.color ?? '#ffffff';
    p.endColor = cfg.endColor ?? p.color;
    p.alpha = cfg.alpha ?? 1;
    p.drag = cfg.drag ?? 0;
    p.gravity = cfg.gravity ?? 0;
    p.rotation = cfg.rotation ?? 0;
    p.spin = cfg.spin ?? 0;
    p.kind = cfg.kind ?? 'smoke';
    p.additive = cfg.additive ?? false;
    return p;
  }

  update(dt, gravity = null) {
    if (gravity) this.gravityVector.copy(gravity);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.pool.push(p);
        swapRemove(this.active, i);
        continue;
      }
      if (p.drag > 0) {
        const f = Math.max(0, 1 - p.drag * dt);
        p.vx *= f;
        p.vy *= f;
      }
      if (p.gravity !== 0) {
        p.vx += this.gravityVector.x * p.gravity * dt;
        p.vy += this.gravityVector.y * p.gravity * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
    }
  }

  /* ── 이펙트 프리셋 ─────────────────────────────────────── */

  /**
   * 엔진 배기 화염.
   * @param {object} o { x, y, dirX, dirY, power, scale, color, atmoDensity, dt }
   */
  engineExhaust(o) {
    const power = clamp01(o.power);
    if (power < 0.02) return;
    const rate = 60 * power * this.quality;
    const n = Math.max(1, Math.round(rate * (o.dt ?? 0.016)));
    const spread = lerp(0.05, 0.32, clamp01(o.atmoDensity ?? 0));
    const speed = lerp(90, 40, clamp01(o.atmoDensity ?? 0)) * (o.scale ?? 1);

    for (let i = 0; i < n; i++) {
      const a = rand(-spread, spread);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = o.dirX * c - o.dirY * s;
      const dy = o.dirX * s + o.dirY * c;
      const v = speed * rand(0.7, 1.3);
      this.spawn({
        x: o.x + rand(-0.3, 0.3) * (o.scale ?? 1),
        y: o.y + rand(-0.3, 0.3) * (o.scale ?? 1),
        vx: dx * v + (o.vx ?? 0),
        vy: dy * v + (o.vy ?? 0),
        life: rand(0.18, 0.45) * (o.scale ?? 1),
        size: rand(0.5, 1.1) * (o.scale ?? 1),
        endSize: rand(1.8, 3.4) * (o.scale ?? 1),
        color: o.color ?? '#ffd07a',
        endColor: '#ff5a1e',
        alpha: 0.9,
        drag: 1.6,
        kind: 'flame',
        additive: true,
      });
    }

    // 대기 중에서는 연기도 남는다
    const atmo = clamp01(o.atmoDensity ?? 0);
    if (atmo > 0.05) {
      const sn = Math.max(1, Math.round(18 * power * atmo * this.quality * (o.dt ?? 0.016) * 60) / 6);
      for (let i = 0; i < sn; i++) {
        this.spawn({
          x: o.x + rand(-0.6, 0.6),
          y: o.y + rand(-0.6, 0.6),
          vx: o.dirX * speed * 0.35 * rand(0.4, 1) + rand(-6, 6) + (o.vx ?? 0),
          vy: o.dirY * speed * 0.35 * rand(0.4, 1) + rand(-6, 6) + (o.vy ?? 0),
          life: rand(1.4, 3.2),
          size: rand(1.2, 2.4) * (o.scale ?? 1),
          endSize: rand(6, 14) * (o.scale ?? 1),
          color: '#b8b2ab',
          endColor: '#5c5854',
          alpha: 0.42 * atmo,
          drag: 0.6,
          spin: rand(-1, 1),
          kind: 'smoke',
        });
      }
    }
  }

  /** RCS 추력기 분사 */
  rcsPuff(x, y, dx, dy, scale = 1) {
    for (let i = 0; i < 3; i++) {
      this.spawn({
        x,
        y,
        vx: dx * rand(6, 14) * scale + rand(-2, 2),
        vy: dy * rand(6, 14) * scale + rand(-2, 2),
        life: rand(0.12, 0.3),
        size: 0.16 * scale,
        endSize: 0.7 * scale,
        color: '#dff0ff',
        endColor: '#9fc8e8',
        alpha: 0.65,
        drag: 3,
        additive: true,
        kind: 'flame',
      });
    }
  }

  /** 폭발 */
  explosion(x, y, scale = 1, opts = {}) {
    const n = Math.round(48 * scale * this.quality);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const v = rand(8, 55) * scale;
      this.spawn({
        x: x + rand(-1, 1) * scale,
        y: y + rand(-1, 1) * scale,
        vx: Math.cos(a) * v + (opts.vx ?? 0),
        vy: Math.sin(a) * v + (opts.vy ?? 0),
        life: rand(0.4, 1.4),
        size: rand(0.8, 2.2) * scale,
        endSize: rand(3, 8) * scale,
        color: '#fff0b0',
        endColor: '#d9431e',
        alpha: 1,
        drag: 1.1,
        kind: 'flame',
        additive: true,
      });
    }
    // 검은 연기
    const sn = Math.round(26 * scale * this.quality);
    for (let i = 0; i < sn; i++) {
      const a = rand(0, TAU);
      const v = rand(3, 22) * scale;
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * v + (opts.vx ?? 0),
        vy: Math.sin(a) * v + (opts.vy ?? 0),
        life: rand(1.6, 4),
        size: rand(1.5, 3) * scale,
        endSize: rand(8, 20) * scale,
        color: '#4a4540',
        endColor: '#1c1a18',
        alpha: 0.65,
        drag: 0.55,
        spin: rand(-1.5, 1.5),
        kind: 'smoke',
      });
    }
    // 파편
    const dn = Math.round(16 * scale * this.quality);
    for (let i = 0; i < dn; i++) {
      const a = rand(0, TAU);
      const v = rand(20, 90) * scale;
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * v + (opts.vx ?? 0),
        vy: Math.sin(a) * v + (opts.vy ?? 0),
        life: rand(1.0, 3.0),
        size: rand(0.15, 0.5) * scale,
        endSize: rand(0.1, 0.3) * scale,
        color: '#d8c8a8',
        endColor: '#6b5f4c',
        alpha: 1,
        drag: 0.2,
        gravity: 1,
        spin: rand(-8, 8),
        kind: 'debris',
      });
    }
  }

  /** 재진입 플라즈마 */
  reentryPlasma(x, y, dirX, dirY, intensity, scale = 1) {
    const t = clamp01(intensity);
    if (t < 0.05) return;
    const n = Math.round(10 * t * this.quality);
    for (let i = 0; i < n; i++) {
      const spread = rand(-0.5, 0.5);
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const dx = dirX * c - dirY * s;
      const dy = dirX * s + dirY * c;
      const v = rand(30, 120) * t;
      const color = t > 0.7 ? '#cfe8ff' : t > 0.4 ? '#ffb05a' : '#ff6a28';
      this.spawn({
        x: x + rand(-0.5, 0.5) * scale,
        y: y + rand(-0.5, 0.5) * scale,
        vx: dx * v,
        vy: dy * v,
        life: rand(0.2, 0.8),
        size: rand(0.6, 1.6) * scale,
        endSize: rand(2, 6) * scale,
        color,
        endColor: '#8a2a10',
        alpha: 0.8 * t,
        drag: 1.2,
        kind: 'flame',
        additive: true,
      });
    }
  }

  /** 착륙 먼지 */
  groundDust(x, y, normalX, normalY, power, scale = 1) {
    const n = Math.round(14 * power * this.quality);
    for (let i = 0; i < n; i++) {
      const a = rand(-1.3, 1.3);
      const c = Math.cos(a);
      const s = Math.sin(a);
      // 법선에 수직인 방향으로 퍼진다
      const tx = -normalY * c + normalX * s;
      const ty = normalX * c + normalY * s;
      const v = rand(6, 34) * power;
      this.spawn({
        x,
        y,
        vx: tx * v,
        vy: ty * v + normalY * rand(2, 12),
        life: rand(0.8, 2.4),
        size: rand(0.6, 1.6) * scale,
        endSize: rand(4, 11) * scale,
        color: '#cbbda4',
        endColor: '#8b8172',
        alpha: 0.5,
        drag: 1.0,
        spin: rand(-2, 2),
        kind: 'smoke',
      });
    }
  }

  /** 물보라 */
  waterSplash(x, y, normalX, normalY, power, scale = 1) {
    const n = Math.round(26 * power * this.quality);
    for (let i = 0; i < n; i++) {
      const a = rand(-0.9, 0.9);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = normalX * c - normalY * s;
      const dy = normalX * s + normalY * c;
      const v = rand(10, 60) * power;
      this.spawn({
        x,
        y,
        vx: dx * v,
        vy: dy * v,
        life: rand(0.6, 1.8),
        size: rand(0.3, 1.0) * scale,
        endSize: rand(1.2, 3) * scale,
        color: '#e8f4ff',
        endColor: '#8fb8d8',
        alpha: 0.75,
        drag: 0.7,
        gravity: 1,
        kind: 'water',
      });
    }
  }

  /** 단 분리 시 나오는 잔여 추진제 */
  separationPuff(x, y, dirX, dirY, scale = 1) {
    for (let i = 0; i < 16; i++) {
      const a = rand(-0.8, 0.8);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = dirX * c - dirY * s;
      const dy = dirX * s + dirY * c;
      this.spawn({
        x,
        y,
        vx: dx * rand(5, 24) * scale,
        vy: dy * rand(5, 24) * scale,
        life: rand(0.5, 1.4),
        size: rand(0.4, 0.9) * scale,
        endSize: rand(2, 5) * scale,
        color: '#e4e8ec',
        endColor: '#9aa2aa',
        alpha: 0.55,
        drag: 1.4,
        kind: 'smoke',
      });
    }
  }

  /** 마하 콘 / 응축 구름 */
  vaporCone(x, y, dirX, dirY, scale = 1) {
    for (let i = 0; i < 6; i++) {
      this.spawn({
        x: x - dirX * scale * rand(0, 1.5),
        y: y - dirY * scale * rand(0, 1.5),
        vx: -dirX * rand(4, 14),
        vy: -dirY * rand(4, 14),
        life: rand(0.2, 0.5),
        size: rand(1.5, 3) * scale,
        endSize: rand(4, 8) * scale,
        color: '#ffffff',
        endColor: '#cfe0ee',
        alpha: 0.3,
        drag: 2,
        kind: 'smoke',
      });
    }
  }

  /* ── 렌더링 ───────────────────────────────────────────── */

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Camera} camera
   */
  render(ctx, camera) {
    if (!this.active.length) return;
    const sp = { x: 0, y: 0 };
    const zoom = camera.zoom;

    // 가산 합성 파티클을 나중에 그려 밝게 보이도록 두 번 순회
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.active) {
      if (p.additive) continue;
      this._drawParticle(ctx, p, camera, sp, zoom);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.active) {
      if (!p.additive) continue;
      this._drawParticle(ctx, p, camera, sp, zoom);
    }
    ctx.restore();
  }

  /**
   * 광원 방향을 설정하면 연기가 한쪽만 밝게 보인다 (실제 연기 기둥처럼).
   */
  setLight(x, y) {
    this.lightX = x;
    this.lightY = y;
  }

  _drawParticle(ctx, p, camera, sp, zoom) {
    const t = 1 - p.life / p.maxLife;
    const size = lerp(p.size, p.endSize, t) * zoom;
    if (size < 0.35) return;
    camera.worldToScreen(p.x, p.y, sp);
    if (
      sp.x < -size ||
      sp.y < -size ||
      sp.x > camera.width + size ||
      sp.y > camera.height + size
    ) {
      return;
    }
    const alpha = p.alpha * (1 - t * t);
    if (alpha <= 0.01) return;
    const color = mixHex(p.color, p.endColor, t);

    ctx.globalAlpha = alpha;

    if (p.kind === 'debris') {
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(p.rotation);
      const g = ctx.createLinearGradient(-size / 2, 0, size / 2, 0);
      g.addColorStop(0, mixHex(color, '#ffffff', 0.3));
      g.addColorStop(1, mixHex(color, '#000000', 0.45));
      ctx.fillStyle = g;
      ctx.fillRect(-size / 2, -size / 4, size, size / 2);
      ctx.restore();
    } else if (p.kind === 'flame') {
      // 불꽃 — 중심이 하얗게 타고 바깥으로 갈수록 붉어진다
      const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, size);
      g.addColorStop(0, withAlpha(mixHex(color, '#ffffff', 0.55 * (1 - t)), 1));
      g.addColorStop(0.25, withAlpha(color, 0.85));
      g.addColorStop(0.6, withAlpha(color, 0.3));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, size, 0, TAU);
      ctx.fill();
    } else if (p.kind === 'water') {
      const g = ctx.createRadialGradient(
        sp.x - size * 0.3,
        sp.y - size * 0.3,
        0,
        sp.x,
        sp.y,
        size
      );
      g.addColorStop(0, withAlpha('#ffffff', 0.9));
      g.addColorStop(0.5, withAlpha(color, 0.6));
      g.addColorStop(1, withAlpha(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, size * 0.8, 0, TAU);
      ctx.fill();
    } else {
      // 연기 — 광원 쪽이 밝고 반대쪽이 어둡다. 부드러운 가장자리가 핵심.
      const lx = this.lightX ?? -0.5;
      const ly = this.lightY ?? -0.5;
      const g = ctx.createRadialGradient(
        sp.x + lx * size * 0.42,
        sp.y + ly * size * 0.42,
        size * 0.05,
        sp.x,
        sp.y,
        size
      );
      g.addColorStop(0, withAlpha(mixHex(color, '#ffffff', 0.42), 0.95));
      g.addColorStop(0.35, withAlpha(color, 0.7));
      g.addColorStop(0.72, withAlpha(mixHex(color, '#000000', 0.25), 0.28));
      g.addColorStop(1, withAlpha(mixHex(color, '#000000', 0.3), 0));
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(p.rotation);
      ctx.scale(1, 0.82);
      ctx.translate(-sp.x, -sp.y);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, size, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * 엔진 화염 콘 — 파티클과 별개로 그리는 "코어 화염".
 * 노즐 바로 아래에 밝은 삼각형을 그려 추력감을 준다.
 */
/**
 * 엔진 화염 콘.
 *
 * 실제 로켓 배기는 노즐 바로 아래가 가장 밝고 좁으며, 과팽창/저팽창에 따라
 * 충격 다이아몬드(마하 디스크)가 규칙적으로 늘어선다. 진공에서는 압력이
 * 없어 깃털처럼 넓게 퍼진다. 그 차이를 그려야 로켓처럼 보인다.
 *
 * @param {object} opts { x, y, dirX, dirY, power, length, width, color, vacuum(0..1) }
 */
export function drawPlume(ctx, camera, opts) {
  const power = clamp01(opts.power);
  if (power < 0.02) return;
  const sp = camera.worldToScreen(opts.x, opts.y);
  const vac = clamp01(opts.vacuum ?? 0);
  const len = opts.length * power * camera.zoom;
  const width = opts.width * camera.zoom;
  if (len < 1.5) return;

  const angle = Math.atan2(-opts.dirY, opts.dirX) + camera.rotation;
  const color = opts.color ?? '#ffd07a';

  ctx.save();
  ctx.translate(sp.x, sp.y);
  ctx.rotate(angle);
  ctx.globalCompositeOperation = 'lighter';

  const flicker = 0.88 + Math.random() * 0.24;
  const L = len * flicker;
  // 진공에서는 넓게 퍼지고, 대기 중에서는 좁게 모인다
  const spread = lerp(0.55, 1.9, vac);

  /* 1. 바깥 깃털 */
  const outer = ctx.createLinearGradient(0, 0, L, 0);
  outer.addColorStop(0, withAlpha(color, 0.5));
  outer.addColorStop(0.3, withAlpha(color, 0.3));
  outer.addColorStop(0.7, withAlpha('#ff6a28', 0.1));
  outer.addColorStop(1, withAlpha('#ff5a1e', 0));
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.moveTo(0, -width * 0.5);
  ctx.quadraticCurveTo(L * 0.45, -width * spread, L, 0);
  ctx.quadraticCurveTo(L * 0.45, width * spread, 0, width * 0.5);
  ctx.closePath();
  ctx.fill();

  /* 2. 주 화염 */
  const main = ctx.createLinearGradient(0, 0, L, 0);
  main.addColorStop(0, withAlpha('#ffffff', 0.95));
  main.addColorStop(0.08, withAlpha(mixHex(color, '#ffffff', 0.5), 0.9));
  main.addColorStop(0.4, withAlpha(color, 0.55));
  main.addColorStop(1, withAlpha('#ff5a1e', 0));
  ctx.fillStyle = main;
  ctx.beginPath();
  ctx.moveTo(0, -width * 0.34);
  ctx.quadraticCurveTo(L * 0.4, -width * spread * 0.5, L * 0.95, 0);
  ctx.quadraticCurveTo(L * 0.4, width * spread * 0.5, 0, width * 0.34);
  ctx.closePath();
  ctx.fill();

  /* 3. 충격 다이아몬드 — 대기 중에서만 또렷하다 */
  const diamondStrength = (1 - vac) * power;
  if (diamondStrength > 0.15 && L > 14) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const t = 0.1 + i * 0.15;
      const x = L * t;
      const dw = width * 0.3 * (1 - t * 0.7);
      const dl = L * 0.07 * (1 - t * 0.5);
      const a = diamondStrength * (1 - i / n) * 0.85;
      const dg = ctx.createRadialGradient(x, 0, 0, x, 0, dl * 1.6);
      dg.addColorStop(0, withAlpha('#ffffff', a));
      dg.addColorStop(0.5, withAlpha('#ffe9b0', a * 0.5));
      dg.addColorStop(1, withAlpha('#ffd07a', 0));
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.moveTo(x - dl, 0);
      ctx.lineTo(x, -dw);
      ctx.lineTo(x + dl, 0);
      ctx.lineTo(x, dw);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* 4. 노즐 목의 강한 발광 */
  const throat = ctx.createRadialGradient(0, 0, 0, 0, 0, width * 1.3);
  throat.addColorStop(0, withAlpha('#ffffff', 0.9 * power));
  throat.addColorStop(0.35, withAlpha(color, 0.45 * power));
  throat.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = throat;
  ctx.beginPath();
  ctx.arc(0, 0, width * 1.3, 0, TAU);
  ctx.fill();

  ctx.restore();
}

/**
 * 충격파 링 (폭발/소닉붐).
 */
export class ShockwaveManager {
  constructor() {
    this.waves = [];
  }

  add(x, y, maxRadius, duration = 0.6, color = '#ffffff') {
    this.waves.push({ x, y, r: 0, maxRadius, t: 0, duration, color });
  }

  update(dt) {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      w.r = w.maxRadius * (1 - Math.pow(1 - w.t / w.duration, 2));
      if (w.t >= w.duration) swapRemove(this.waves, i);
    }
  }

  render(ctx, camera) {
    for (const w of this.waves) {
      const sp = camera.worldToScreen(w.x, w.y);
      const r = w.r * camera.zoom;
      if (r < 1 || r > Math.max(camera.width, camera.height) * 2) continue;
      const alpha = 1 - w.t / w.duration;
      ctx.strokeStyle = withAlpha(w.color, alpha * 0.45);
      ctx.lineWidth = Math.max(1, 6 * alpha);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, TAU);
      ctx.stroke();
    }
  }

  clear() {
    this.waves.length = 0;
  }
}
