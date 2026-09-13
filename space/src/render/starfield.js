// ORBITER — 별하늘
// 시차(parallax) 레이어로 이루어진 배경 별과 은하수, 그리고 대기 그라디언트.

import {
  TAU,
  clamp01,
  lerp,
  makeRng,
  withAlpha,
  mixHex,
} from '../core/math.js';

export class Starfield {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 20260913;
    this.layers = [];
    this.enabled = true;
    this.brightness = 1;
    this.generate(opts.count ?? 900);
    this.nebulae = this._generateNebulae(6);
    this.milkyWayAngle = 0.42;
  }

  generate(count) {
    const rng = makeRng(this.seed);
    // 3개 시차 레이어
    const layerDefs = [
      { depth: 0.02, ratio: 0.5, sizeMin: 0.6, sizeMax: 1.2, alpha: 0.55 },
      { depth: 0.05, ratio: 0.33, sizeMin: 0.9, sizeMax: 1.8, alpha: 0.75 },
      { depth: 0.1, ratio: 0.17, sizeMin: 1.4, sizeMax: 2.8, alpha: 1.0 },
    ];
    this.layers = layerDefs.map((d) => ({ ...d, stars: [] }));

    const colors = [
      '#ffffff',
      '#ffeedd',
      '#ffddbb',
      '#ddeeff',
      '#bbd4ff',
      '#fff4d0',
    ];

    for (const layer of this.layers) {
      const n = Math.round(count * layer.ratio);
      for (let i = 0; i < n; i++) {
        // 은하수 띠를 따라 밀도를 높인다
        let u = rng();
        let v = rng();
        if (rng() < 0.4) {
          // 띠 근처로 몰아준다
          v = 0.5 + (rng() + rng() + rng() - 1.5) * 0.18;
        }
        layer.stars.push({
          u,
          v,
          size: lerp(layer.sizeMin, layer.sizeMax, rng()),
          color: colors[(rng() * colors.length) | 0],
          twinkle: rng() * TAU,
          twinkleSpeed: 0.4 + rng() * 1.6,
        });
      }
    }
  }

  _generateNebulae(n) {
    const rng = makeRng(this.seed + 777);
    const out = [];
    const palettes = [
      ['#3a2a6a', '#1a1240'],
      ['#2a4a6a', '#0f2438'],
      ['#6a2a4a', '#2e1020'],
      ['#2a5a4a', '#0f2a22'],
    ];
    for (let i = 0; i < n; i++) {
      const pal = palettes[(rng() * palettes.length) | 0];
      out.push({
        u: rng(),
        v: 0.5 + (rng() - 0.5) * 0.5,
        radius: 0.08 + rng() * 0.22,
        color: pal[0],
        edge: pal[1],
        alpha: 0.1 + rng() * 0.16,
      });
    }
    return out;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Camera} camera
   * @param {number} time
   * @param {number} fade 대기권에서 별이 사라지는 정도 (0=우주, 1=완전히 가림)
   */
  render(ctx, camera, time, fade = 0) {
    if (!this.enabled || fade >= 0.99) return;
    const w = camera.width;
    const h = camera.height;
    const alphaScale = (1 - fade) * this.brightness;

    ctx.save();

    // 성운
    for (const neb of this.nebulae) {
      const px = ((neb.u * w * 2 - camera.pos.x * 1e-9) % (w * 2)) - w * 0.5;
      const py = ((neb.v * h * 2 - camera.pos.y * 1e-9) % (h * 2)) - h * 0.5;
      const r = neb.radius * Math.max(w, h);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, withAlpha(neb.color, neb.alpha * alphaScale));
      g.addColorStop(0.6, withAlpha(neb.edge, neb.alpha * 0.5 * alphaScale));
      g.addColorStop(1, withAlpha(neb.edge, 0));
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }

    // 은하수 띠
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(this.milkyWayAngle + camera.rotation * 0.1);
    const bandH = h * 0.32;
    const bg = ctx.createLinearGradient(0, -bandH, 0, bandH);
    bg.addColorStop(0, withAlpha('#2a2f52', 0));
    bg.addColorStop(0.5, withAlpha('#4a5080', 0.13 * alphaScale));
    bg.addColorStop(1, withAlpha('#2a2f52', 0));
    ctx.fillStyle = bg;
    ctx.fillRect(-w, -bandH, w * 2, bandH * 2);
    ctx.restore();

    // 별
    for (const layer of this.layers) {
      const ox = (-camera.pos.x * layer.depth * 1e-7) % w;
      const oy = (camera.pos.y * layer.depth * 1e-7) % h;
      for (const s of layer.stars) {
        let x = (s.u * w + ox) % w;
        let y = (s.v * h + oy) % h;
        if (x < 0) x += w;
        if (y < 0) y += h;
        const tw = 0.72 + 0.28 * Math.sin(time * s.twinkleSpeed + s.twinkle);
        const a = layer.alpha * tw * alphaScale;
        if (a < 0.02) continue;
        ctx.fillStyle = withAlpha(s.color, a);
        const size = s.size;
        if (size > 1.8) {
          // 밝은 별은 십자 스파이크
          ctx.fillRect(x - size / 2, y - size / 2, size, size);
          ctx.fillStyle = withAlpha(s.color, a * 0.35);
          ctx.fillRect(x - size * 2, y - 0.5, size * 4, 1);
          ctx.fillRect(x - 0.5, y - size * 2, 1, size * 4);
        } else {
          ctx.fillRect(x, y, size, size);
        }
      }
    }

    ctx.restore();
  }
}

/**
 * 대기 배경 — 고도에 따라 하늘색을 보간한다.
 */
export function drawSky(ctx, camera, body, altitude, sunAngle = 0) {
  const w = camera.width;
  const h = camera.height;
  const atmo = body.atmo;

  if (!atmo.exists) {
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, w, h);
    return 0;
  }

  const f = atmo.skyFactor(altitude);
  if (f <= 0.001) {
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, w, h);
    return 0;
  }

  // 낮/밤 보간
  const day = clamp01(Math.cos(sunAngle) * 0.5 + 0.5);
  const zenithDay = mixHex('#05060a', '#2f6fb0', f);
  const horizonDay = mixHex('#05060a', atmo.hazeColor, f);
  const zenithNight = mixHex('#05060a', '#0b1830', f * 0.6);
  const horizonNight = mixHex('#05060a', '#1a2c48', f * 0.7);

  const zenith = mixHex(zenithNight, zenithDay, day);
  const horizon = mixHex(horizonNight, horizonDay, day);

  // 화면 아래쪽이 지평선 방향이라고 가정하고 수직 그라디언트
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, zenith);
  g.addColorStop(0.62, mixHex(zenith, horizon, 0.6));
  g.addColorStop(1, horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 일출/일몰 붉은 기운
  const sunset = clamp01(1 - Math.abs(Math.cos(sunAngle)) * 2.2) * f;
  if (sunset > 0.02) {
    const sg = ctx.createLinearGradient(0, h * 0.45, 0, h);
    sg.addColorStop(0, withAlpha('#ff8a4a', 0));
    sg.addColorStop(1, withAlpha('#ff6a3a', 0.35 * sunset));
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);
  }

  return f;
}

/**
 * 화면 가장자리 비네트.
 */
export function drawVignette(ctx, camera, strength = 0.35) {
  const w = camera.width;
  const h = camera.height;
  const g = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.35,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
