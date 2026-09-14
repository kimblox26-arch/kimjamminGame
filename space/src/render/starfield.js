// ORBITER — 하늘과 별
//
// 하늘색은 "태양이 지평선 위 어디에 있는가" 하나로 결정된다.
// 천정은 레일리 산란으로 파랗고, 지평선은 대기를 길게 통과해 창백해지며,
// 태양 근처는 미 산란으로 하얗게 번진다. 해가 낮으면 붉은 빛만 남는다.
//
// 별은 대기 중에서만 반짝인다(대기 요동). 진공에서는 흔들림 없이 또렷하다.

import {
  TAU,
  clamp,
  clamp01,
  lerp,
  smoothstep,
  makeRng,
  withAlpha,
  mixHex,
  shade,
} from '../core/math.js';

export class Starfield {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 20260913;
    this.layers = [];
    this.enabled = true;
    this.brightness = 1;
    this.generate(opts.count ?? 1100);
    this.nebulae = this._generateNebulae(7);
    this.milkyWayAngle = 0.42;
  }

  generate(count) {
    const rng = makeRng(this.seed);
    // 시차 3층 — 밝은 별일수록 가깝게(크게) 보이도록
    const layerDefs = [
      { depth: 0.02, ratio: 0.56, sizeMin: 0.5, sizeMax: 1.0, alpha: 0.5 },
      { depth: 0.05, ratio: 0.32, sizeMin: 0.8, sizeMax: 1.6, alpha: 0.72 },
      { depth: 0.1, ratio: 0.12, sizeMin: 1.3, sizeMax: 2.6, alpha: 1.0 },
    ];
    this.layers = layerDefs.map((d) => ({ ...d, stars: [] }));

    // 실제 항성 색온도 분포에 가깝게 — 대부분 흰색~노랑, 소수의 청색/적색
    const colors = [
      '#ffffff', '#fff4e8', '#ffe9d0', '#ffdcb4', '#ffd0a0',
      '#e8f0ff', '#d0e0ff', '#b8d0ff', '#ffc8a0', '#ffb890',
    ];
    const weights = [22, 20, 16, 10, 6, 10, 7, 4, 3, 2];
    const total = weights.reduce((a, b) => a + b, 0);

    const pickColor = () => {
      let r = rng() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return colors[i];
      }
      return colors[0];
    };

    for (const layer of this.layers) {
      const n = Math.round(count * layer.ratio);
      for (let i = 0; i < n; i++) {
        let u = rng();
        let v = rng();
        // 은하수 띠를 따라 밀도를 높인다
        if (rng() < 0.42) v = 0.5 + (rng() + rng() + rng() - 1.5) * 0.16;
        layer.stars.push({
          u,
          v,
          size: lerp(layer.sizeMin, layer.sizeMax, Math.pow(rng(), 1.8)),
          color: pickColor(),
          twinkle: rng() * TAU,
          twinkleSpeed: 0.5 + rng() * 2.2,
        });
      }
    }
  }

  _generateNebulae(n) {
    const rng = makeRng(this.seed + 777);
    const out = [];
    const palettes = [
      ['#3a2a6a', '#150f34'],
      ['#264a68', '#0c1c2c'],
      ['#5e2846', '#24101c'],
      ['#26523f', '#0c221a'],
      ['#4a3a70', '#161030'],
    ];
    for (let i = 0; i < n; i++) {
      const pal = palettes[(rng() * palettes.length) | 0];
      out.push({
        u: rng(),
        v: 0.5 + (rng() - 0.5) * 0.55,
        radius: 0.1 + rng() * 0.26,
        color: pal[0],
        edge: pal[1],
        alpha: 0.09 + rng() * 0.14,
      });
    }
    return out;
  }

  /**
   * @param {number} fade 0=우주(별 또렷) … 1=대낮 하늘(별 안 보임)
   * @param {object} opts { atmosphere: 0..1, horizonY }
   */
  render(ctx, camera, time, fade = 0, opts = {}) {
    if (!this.enabled || fade >= 0.985) return;
    const w = camera.width;
    const h = camera.height;
    const alphaScale = (1 - fade) * this.brightness;
    const inAtmo = clamp01(opts.atmosphere ?? 0);

    ctx.save();

    // 성운 — 아주 옅게, 은하수 띠 근처에
    for (const neb of this.nebulae) {
      const px = neb.u * w;
      const py = neb.v * h;
      const r = neb.radius * Math.max(w, h);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, withAlpha(neb.color, neb.alpha * alphaScale));
      g.addColorStop(0.55, withAlpha(neb.edge, neb.alpha * 0.45 * alphaScale));
      g.addColorStop(1, withAlpha(neb.edge, 0));
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }

    // 은하수
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(this.milkyWayAngle + camera.rotation * 0.08);
    const bandH = h * 0.34;
    const bg = ctx.createLinearGradient(0, -bandH, 0, bandH);
    bg.addColorStop(0, withAlpha('#252a4a', 0));
    bg.addColorStop(0.35, withAlpha('#3a4070', 0.07 * alphaScale));
    bg.addColorStop(0.5, withAlpha('#4e5488', 0.14 * alphaScale));
    bg.addColorStop(0.65, withAlpha('#3a4070', 0.07 * alphaScale));
    bg.addColorStop(1, withAlpha('#252a4a', 0));
    ctx.fillStyle = bg;
    ctx.fillRect(-w, -bandH, w * 2, bandH * 2);
    // 암흑 성운 띠
    ctx.fillStyle = withAlpha('#080a14', 0.22 * alphaScale);
    ctx.fillRect(-w, -bandH * 0.12, w * 2, bandH * 0.16);
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

        // 대기 중에서만 반짝인다
        const tw = inAtmo > 0.02
          ? lerp(1, 0.62 + 0.38 * Math.sin(time * s.twinkleSpeed + s.twinkle), inAtmo)
          : 1;
        const a = layer.alpha * tw * alphaScale;
        if (a < 0.02) continue;

        const size = s.size;
        if (size > 1.7) {
          // 밝은 별 — 헤일로 + 회절 스파이크
          const g = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
          g.addColorStop(0, withAlpha(s.color, a));
          g.addColorStop(0.28, withAlpha(s.color, a * 0.35));
          g.addColorStop(1, withAlpha(s.color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - size * 3, y - size * 3, size * 6, size * 6);
          ctx.fillStyle = withAlpha(s.color, a * 0.28);
          ctx.fillRect(x - size * 2.6, y - 0.5, size * 5.2, 1);
          ctx.fillRect(x - 0.5, y - size * 2.6, 1, size * 5.2);
          ctx.fillStyle = withAlpha('#ffffff', a);
          ctx.fillRect(x - size * 0.35, y - size * 0.35, size * 0.7, size * 0.7);
        } else {
          ctx.fillStyle = withAlpha(s.color, a);
          ctx.fillRect(x, y, size, size);
        }
      }
    }

    ctx.restore();
  }
}

/* ──────────────────────────────────────────────────────────────
 * 하늘
 * ────────────────────────────────────────────────────────────── */

/**
 * 대기 하늘을 그린다.
 *
 * @param {object} opts
 *   sunElevation  태양의 고도각 (rad). +π/2 = 천정, 0 = 지평선, 음수 = 밤
 *   sunScreenX    태양의 화면 x (산란 밝기를 그쪽으로 몰아준다)
 *   horizonY      지평선의 화면 y (없으면 화면 하단)
 * @returns {number} 하늘 불투명도 (0 = 완전한 우주)
 */
export function drawSky(ctx, camera, body, altitude, opts = {}) {
  const w = camera.width;
  const h = camera.height;
  const atmo = body.atmo;

  // 우주 배경 — 완전한 검정보다 아주 살짝 푸른 편이 자연스럽다
  ctx.fillStyle = '#040609';
  ctx.fillRect(0, 0, w, h);

  if (!atmo.exists) return 0;

  const f = atmo.skyFactor(altitude);
  if (f <= 0.002) return 0;

  const sunElev = opts.sunElevation ?? 0.6;
  // 낮 정도: 태양이 지평선 위로 올라올수록 1
  const day = clamp01(Math.sin(sunElev) * 2.2 + 0.35);
  // 일출/일몰: 태양이 지평선 근처
  const twilight = clamp01(1 - Math.abs(Math.sin(sunElev)) * 3.2) * clamp01(day * 2 + 0.25);

  const glow = atmo.hazeColor;
  // 천정색: 대기가 두꺼울수록 진한 파랑, 고도가 높아지면 검정으로
  const zenithDay = mixHex('#050a16', '#1f5da8', f);
  const zenithNight = mixHex('#03050a', '#0a1428', f * 0.7);
  const horizonDay = mixHex('#050a16', glow, f);
  const horizonNight = mixHex('#03050a', '#141f33', f * 0.8);

  let zenith = mixHex(zenithNight, zenithDay, day);
  let horizon = mixHex(horizonNight, horizonDay, day);
  // 노을
  if (twilight > 0.02) {
    horizon = mixHex(horizon, '#e87a3a', twilight * 0.75);
    zenith = mixHex(zenith, '#3a3f78', twilight * 0.35);
  }

  const horizonY = opts.horizonY ?? h;
  const g = ctx.createLinearGradient(0, 0, 0, horizonY);
  g.addColorStop(0, zenith);
  g.addColorStop(0.45, mixHex(zenith, horizon, 0.42));
  g.addColorStop(0.8, mixHex(zenith, horizon, 0.82));
  g.addColorStop(1, horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, Math.max(horizonY, h));

  // 태양 주변 미 산란 — 하늘이 그쪽으로 하얗게 번진다
  if (day > 0.03 && opts.sunScreenX !== undefined) {
    const sx = clamp(opts.sunScreenX, -w, w * 2);
    const sy = opts.sunScreenY ?? h * 0.25;
    const r = Math.max(w, h) * lerp(0.28, 0.6, f);
    const mg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    const near = twilight > 0.15 ? '#ffb070' : '#ffffff';
    mg.addColorStop(0, withAlpha(near, 0.3 * day * f));
    mg.addColorStop(0.3, withAlpha(mixHex(near, glow, 0.6), 0.1 * day * f));
    mg.addColorStop(1, withAlpha(glow, 0));
    ctx.fillStyle = mg;
    ctx.fillRect(0, 0, w, h);
  }

  return f * lerp(0.35, 1, day);
}

/**
 * 고고도 구름층 — 대기권 안에서 아래를 볼 때.
 */
export function drawCloudDeck(ctx, camera, body, altitude, time, opts = {}) {
  const atmo = body.atmo;
  if (!atmo.exists) return;
  const deckAlt = atmo.height * 0.12;
  // 구름층보다 위에 있을 때만 아래로 구름이 보인다.
  // (지상에서 이걸 그리면 지평선에 흰 띠가 생긴다)
  if (altitude < deckAlt * 1.25) return;
  const vis = clamp01(1 - (altitude - deckAlt) / (atmo.height * 0.5));
  if (vis < 0.03) return;

  const w = camera.width;
  const h = camera.height;
  const y = opts.horizonY ?? h * 0.78;
  ctx.save();
  ctx.globalAlpha = vis * 0.55;
  const drift = (time * 4) % (w * 2);
  for (let i = 0; i < 14; i++) {
    const cx = ((i * 137.5 + drift) % (w * 1.6)) - w * 0.3;
    const cy = y - (i % 3) * h * 0.02;
    const cw = w * lerp(0.12, 0.32, (i * 0.37) % 1);
    const ch = h * 0.035;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.6, 'rgba(240,246,252,0.18)');
    g.addColorStop(1, 'rgba(240,246,252,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw, ch, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** 화면 가장자리 비네트 (후처리에서 다시 하므로 약하게) */
export function drawVignette(ctx, camera, strength = 0.25) {
  const w = camera.width;
  const h = camera.height;
  const g = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.38,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.76
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
