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
  const horizonY = opts.horizonY ?? h;

  // ── 단일 산란 대기 모델 ─────────────────────────────────────
  // 레일리(λ⁻⁴) + 미(에어로졸) 을 시선 방향으로 적분한다. 하늘색을
  // 팔레트로 찍지 않고 계산하기 때문에 일출·황혼·고고도 암전이
  // 저절로 맞는 색으로 나온다.
  const aer = atmo.aerosol ?? 1;
  // 해면 기준 수직 광학두께 (지구 실측값)
  const tR = [0.0464, 0.1085, 0.2646].map((v) => v * f * (atmo.rayleigh ?? 1));
  const tM = 0.0252 * f * aer * 2.2;

  // 대기 두께 방향의 공기 질량 계수 (Kasten-Young 근사)
  const airmass = (elevRad) => {
    const deg = (elevRad * 180) / Math.PI;
    const z = 90 - deg;
    if (z >= 91) return 12;
    // 12 에서 자른다. 실제 지평선은 다중산란으로 더 밝아지지만
    // 그대로 두면 화면 아래가 흰색으로 날아간다.
    return Math.min(
      12,
      1 / (Math.cos((z * Math.PI) / 180) + 0.50572 * Math.pow(96.07995 - z, -1.6364))
    );
  };

  const mSun = airmass(Math.max(sunElev, -0.09));
  // 지평선 아래로 내려가면 급격히 어두워진다
  const belowHorizon = clamp01(1 + sunElev / 0.22);
  const sunPower = Math.pow(belowHorizon, 1.6);

  const sx = opts.sunScreenX ?? w * 0.5;
  // 화면 세로 60° 시야 가정 — 행마다 시선 고도각을 만든다
  const FOV = 1.05;
  const sunDX = (sx - w / 2) / w;

  const STOPS = 14;
  const g = ctx.createLinearGradient(0, 0, 0, horizonY);
  let horizonRGB = [0, 0, 0];

  for (let i = 0; i < STOPS; i++) {
    const t = i / (STOPS - 1);
    // 화면 위 = 천정 쪽, 아래 = 지평선
    const viewElev = lerp(Math.PI / 2, 0.004, t);
    const mView = airmass(viewElev);
    // 시선과 태양 사이 각 (수평 성분도 대충 반영)
    const dElev = viewElev - sunElev;
    const psi = Math.hypot(dElev, sunDX * FOV * 1.6);
    const mu = Math.cos(psi);
    const phaseR = 0.75 * (1 + mu * mu);
    const gHG = 0.76;
    const phaseM =
      ((1 - gHG * gHG) / Math.pow(1 + gHG * gHG - 2 * gHG * mu, 1.5)) * 0.25;

    // 태양광이 산란점까지 오며 얼마나 걸러졌는가.
    // 천정 쪽 공기를 비추는 빛은 대기 상층만 지나오므로 덜 붉어진다.
    // 이 항이 없으면 일몰에 하늘 전체가 주황색이 되어 버린다.
    const sunPathScale = lerp(1, 0.2, Math.sin(viewElev));
    const mSunHere = mSun * sunPathScale;
    // 에어로졸 소산도 파장에 약하게 의존한다 (옹스트롬 지수 ~1.3).
    // 이것 때문에 지평선 부근 노을이 금빛을 넘어 붉게 간다.
    const AER = [0.72, 0.96, 1.34];
    const sunT = [
      Math.exp(-(tR[0] * mSunHere + tM * mSunHere * AER[0])),
      Math.exp(-(tR[1] * mSunHere + tM * mSunHere * AER[1])),
      Math.exp(-(tR[2] * mSunHere + tM * mSunHere * AER[2])),
    ];

    const rgb = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const tau = tR[c] * mView;
      // 시선 위에서 산란되어 들어온 빛 (포화 방지를 위해 1-e^-τ)
      const scatterR = (1 - Math.exp(-tau)) * phaseR * sunT[c];
      const scatterM = (1 - Math.exp(-tM * mView)) * phaseM * sunT[c];
      let v = (scatterR + scatterM * 0.9) * sunPower;
      // 야간 잔광 — 완전히 검게 떨어지지 않도록
      v += (1 - sunPower) * f * [0.012, 0.017, 0.03][c];
      rgb[c] = v;
    }

    // 톤매핑 + 감마 + 약한 채도 보정.
    // 단일 산란만 계산하면 실제보다 물이 빠져 보이므로 채도를 조금 올린다.
    const lin = rgb.map((v) => Math.pow(clamp01(1 - Math.exp(-v * 2.2)), 1 / 2.2));
    const lum = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
    const out = lin.map((v) =>
      Math.round(clamp01(lum + (v - lum) * 1.32) * 255)
    );
    if (i === STOPS - 1) horizonRGB = out;
    g.addColorStop(t, `rgb(${out[0]},${out[1]},${out[2]})`);
  }

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, Math.max(horizonY, h));

  // 지평선 아래(화면 하단)까지 하늘이 이어져야 할 때
  if (horizonY < h) {
    ctx.fillStyle = `rgb(${horizonRGB[0]},${horizonRGB[1]},${horizonRGB[2]})`;
    ctx.fillRect(0, horizonY, w, h - horizonY);
  }

  const day = clamp01(Math.sin(sunElev) * 2.2 + 0.35);
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
