// SKYBREAKER — 전투기 설계 데이터 · 성능 계산 · 절차적 3D 모델
// 기체 좌표계: 기수 -Z, 위 +Y, 오른쪽 +X. 원점 ≈ 무게중심.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* 설계 카탈로그                                                        */
/* ------------------------------------------------------------------ */
export const BODIES = {
  light:   { name: '경량 전투기', len: 15.5, w: 0.95, h: 0.92, mass: 8600,  armor: 0.85, cd0: 0.0165, n: 2.3, desc: '가볍고 민첩한 단발기 기체' },
  medium:  { name: '다목적 전투기', len: 17.5, w: 1.18, h: 1.0, mass: 12500, armor: 1.0, cd0: 0.0180, n: 2.4, desc: '균형 잡힌 표준 기체' },
  heavy:   { name: '제공 전투기', len: 20.0, w: 1.42, h: 1.1, mass: 17200, armor: 1.4, cd0: 0.0205, n: 2.6, desc: '튼튼하고 강력한 대형 기체' },
  stealth: { name: '스텔스 전투기', len: 19.0, w: 1.5, h: 0.86, mass: 15200, armor: 1.1, cd0: 0.0170, n: 1.15, faceted: true, desc: '각진 차폐 형상의 5세대 기체' },
};

export const WINGS = {
  trapezoid: { name: '사다리꼴익', sweep: 40, span: 0.30, cr: 0.30, ct: 0.085, rootT: 0.42, cla: 5.0, aoaMax: 0.42, lift: 1.0, cd: 0.0040, roll: 1.10, dihedral: -0.02 },
  swept:     { name: '후퇴익', sweep: 45, span: 0.34, cr: 0.32, ct: 0.09, rootT: 0.40, cla: 4.8, aoaMax: 0.40, lift: 1.08, cd: 0.0048, roll: 0.95, dihedral: -0.035 },
  delta:     { name: '델타익', sweep: 55, span: 0.29, cr: 0.50, ct: 0.04, rootT: 0.36, cla: 3.7, aoaMax: 0.52, lift: 1.05, cd: 0.0038, roll: 1.0, dihedral: -0.04, straightTE: true },
  cranked:   { name: '크랭크드 델타', sweep: 50, span: 0.29, cr: 0.56, ct: 0.05, rootT: 0.28, cla: 3.9, aoaMax: 0.55, lift: 1.12, cd: 0.0045, roll: 1.04, dihedral: -0.03, lex: true, straightTE: true },
  forward:   { name: '전진익', sweep: 25, span: 0.33, cr: 0.42, ct: 0.09, rootT: 0.36, cla: 5.4, aoaMax: 0.60, lift: 1.15, cd: 0.0060, roll: 1.22, dihedral: -0.02, forward: true },
};

export const TAILS = {
  single: { name: '단일 수직미익', yaw: 1.0, pitch: 1.0, cd: 0.0012 },
  twin:   { name: '쌍수직미익', yaw: 1.12, pitch: 1.05, cd: 0.0018 },
  vtail:  { name: 'V형 꼬리', yaw: 0.92, pitch: 1.0, cd: 0.0010 },
  none:   { name: '무미익', yaw: 0.6, pitch: 0.88, cd: 0.0 },
};

export const GUNS = {
  vulcan: { name: '20mm 개틀링', rof: 85, dmg: 7, speed: 1050, spread: 0.0045, ammo: 900, color: 0xffd36a, size: 1 },
  cannon: { name: '30mm 리볼버 캐논', rof: 28, dmg: 24, speed: 960, spread: 0.0022, ammo: 260, color: 0xff8a3a, size: 1.6 },
  twin:   { name: '27mm 쌍열 기관포', rof: 50, dmg: 12, speed: 1000, spread: 0.0035, ammo: 520, color: 0x8af7ff, size: 1.2 },
};

export const FLAMES = {
  orange: { name: '클래식 오렌지', core: [1.0, 0.86, 0.62], edge: [1.0, 0.36, 0.08], glow: 0xff8a3c },
  blue:   { name: '터빈 블루', core: [0.75, 0.9, 1.0], edge: [0.25, 0.42, 1.0], glow: 0x6aa8ff },
  violet: { name: '플라즈마 바이올렛', core: [1.0, 0.75, 1.0], edge: [0.6, 0.2, 1.0], glow: 0xb46aff },
  green:  { name: '에메랄드', core: [0.8, 1.0, 0.8], edge: [0.15, 0.95, 0.45], glow: 0x5aff9a },
  red:    { name: '크림슨', core: [1.0, 0.7, 0.6], edge: [1.0, 0.12, 0.08], glow: 0xff4a3a },
};

export const PATTERNS = { solid: '단색', twotone: '투톤', splinter: '스플린터 위장', digital: '디지털 위장', tiger: '타이거', stripe: '레이싱 스트라이프' };
export const FINISHES = { matte: '무광', gloss: '유광', metal: '메탈릭' };
export const CANOPIES = { gold: '골드 코팅', clear: '투명', smoke: '스모크', blue: '블루 미러' };

export const DEFAULT_DESIGN = {
  id: 'custom', name: 'MY FIGHTER', number: '01',
  body: 'medium', length: 1.0,
  wing: 'trapezoid', span: 1.0, sweep: 0,
  canard: false, tail: 'twin', engines: 2, intake: 'side',
  gun: 'vulcan', missiles: 4, flame: 'orange',
  paint: { base: '#7b8794', second: '#59626e', accent: '#f2b33d', pattern: 'twotone', finish: 'matte', canopy: 'gold' },
};

export const PRESETS = [
  { id: 'viper', name: 'VIPER-X', number: '16', body: 'light', length: 1.0, wing: 'trapezoid', span: 1.0, sweep: 0, canard: false, tail: 'single', engines: 1, intake: 'chin', gun: 'vulcan', missiles: 6, flame: 'orange',
    paint: { base: '#8b96a3', second: '#6c7682', accent: '#e8c547', pattern: 'twotone', finish: 'matte', canopy: 'gold' } },
  { id: 'raptor', name: 'RAPTOR-S', number: '22', body: 'stealth', length: 1.0, wing: 'trapezoid', span: 1.0, sweep: 3, canard: false, tail: 'twin', engines: 2, intake: 'side', gun: 'vulcan', missiles: 4, flame: 'blue',
    paint: { base: '#4f565e', second: '#3c4249', accent: '#9aa3ad', pattern: 'splinter', finish: 'matte', canopy: 'gold' } },
  { id: 'typhoon', name: 'TYPHOON-C', number: '05', body: 'medium', length: 1.0, wing: 'delta', span: 1.0, sweep: 0, canard: true, tail: 'single', engines: 2, intake: 'chin', gun: 'cannon', missiles: 6, flame: 'orange',
    paint: { base: '#a7b1ba', second: '#8c97a1', accent: '#3a6ea8', pattern: 'solid', finish: 'gloss', canopy: 'clear' } },
  { id: 'berkut', name: 'BERKUT-F', number: '47', body: 'heavy', length: 1.0, wing: 'forward', span: 1.0, sweep: 0, canard: true, tail: 'twin', engines: 2, intake: 'side', gun: 'cannon', missiles: 6, flame: 'violet',
    paint: { base: '#24272c', second: '#3a3f46', accent: '#c9a227', pattern: 'digital', finish: 'gloss', canopy: 'gold' } },
  { id: 'eagle', name: 'EAGLE-H', number: '15', body: 'heavy', length: 1.0, wing: 'swept', span: 1.05, sweep: 0, canard: false, tail: 'twin', engines: 2, intake: 'side', gun: 'vulcan', missiles: 8, flame: 'orange',
    paint: { base: '#6f7f8f', second: '#56636f', accent: '#d94b3a', pattern: 'splinter', finish: 'matte', canopy: 'smoke' } },
  { id: 'phantom', name: 'CRIMSON ACE', number: '00', body: 'light', length: 1.05, wing: 'cranked', span: 1.0, sweep: 0, canard: false, tail: 'single', engines: 1, intake: 'chin', gun: 'twin', missiles: 4, flame: 'red',
    paint: { base: '#d8dde2', second: '#b52a2a', accent: '#b52a2a', pattern: 'stripe', finish: 'gloss', canopy: 'blue' } },
];

export const ENEMY_DESIGNS = [
  { ...PRESETS[0], id: 'e1', name: 'BANDIT', number: '66', flame: 'red', paint: { base: '#3b2a2a', second: '#702020', accent: '#ff4a3a', pattern: 'tiger', finish: 'matte', canopy: 'smoke' } },
  { ...PRESETS[3], id: 'e2', name: 'BANDIT', number: '13', flame: 'red', paint: { base: '#2c2c30', second: '#5c1d1d', accent: '#ff3b30', pattern: 'splinter', finish: 'matte', canopy: 'smoke' } },
  { ...PRESETS[4], id: 'e3', name: 'BANDIT', number: '99', flame: 'red', paint: { base: '#4a3d33', second: '#2f2620', accent: '#ff6a2a', pattern: 'digital', finish: 'matte', canopy: 'smoke' } },
];

export function normalizeDesign(d) {
  const out = JSON.parse(JSON.stringify({ ...DEFAULT_DESIGN, ...(d || {}) }));
  out.paint = { ...DEFAULT_DESIGN.paint, ...((d && d.paint) || {}) };
  if (!BODIES[out.body]) out.body = 'medium';
  if (!WINGS[out.wing]) out.wing = 'trapezoid';
  if (!TAILS[out.tail]) out.tail = 'twin';
  if (!GUNS[out.gun]) out.gun = 'vulcan';
  if (!FLAMES[out.flame]) out.flame = 'orange';
  out.engines = clamp(Math.round(out.engines) || 2, 1, 3);
  out.missiles = clamp(Math.round(out.missiles / 2) * 2, 2, 8);
  out.length = clamp(+out.length || 1, 0.85, 1.2);
  out.span = clamp(+out.span || 1, 0.8, 1.25);
  out.sweep = clamp(+out.sweep || 0, -10, 10);
  out.number = String(out.number || '01').slice(0, 3);
  out.name = String(out.name || 'MY FIGHTER').slice(0, 16);
  return out;
}

/* ------------------------------------------------------------------ */
/* 성능 계산 (설계 → 비행 파라미터)                                      */
/* ------------------------------------------------------------------ */
export function computeStats(design) {
  const d = normalizeDesign(design);
  const B = BODIES[d.body], W = WINGS[d.wing], T = TAILS[d.tail], G = GUNS[d.gun];
  const L = B.len * d.length;
  const mass = B.mass * d.length * d.length + d.engines * 1650 + d.missiles * 95 + (d.canard ? 160 : 0);
  const thrustMil = d.engines * 76000 * (d.engines === 1 ? 1.32 : 1) * (d.body === 'heavy' ? 1.3 : 1);
  const thrustAB = thrustMil * 1.75;
  const spanK = d.span;
  const internal = d.body === 'stealth';
  const cd0 = B.cd0 + W.cd * spanK + T.cd + (d.canard ? 0.0009 : 0) + (internal ? 0 : d.missiles * 0.00045) + (d.engines - 2) * 0.0012;
  const sweepK = 1 + d.sweep * 0.012;              // 후퇴각↑ → 고속↑ 저속 양력↓
  const accMil = thrustMil / mass;                 // m/s²
  const accAB = thrustAB / mass;
  const liftK = 0.00088 * W.lift * spanK / Math.sqrt(sweepK) * (12500 / mass) ** 0.35;
  const dragK = 0.0024 * (mass / 12500) ** -0.1;
  const wave = 1 / sweepK;
  const maxG = d.body === 'heavy' ? 8.6 : d.body === 'light' ? 9.6 : 9.2;
  const agilityMass = (12500 / mass) ** 0.45;
  const rollRate = 3.4 * W.roll / Math.sqrt(spanK) * agilityMass * (d.wing === 'delta' ? 1.0 : 1);
  const pitchRate = 0.95 * T.pitch * (d.canard ? 1.14 : 1) * agilityMass ** 0.6 * (W.aoaMax / 0.42) ** 0.3;
  const yawRate = 0.42 * T.yaw;
  const aoaMax = W.aoaMax + (d.canard ? 0.06 : 0) - d.sweep * 0.004;
  // 추정 최고 속도 (해면, 애프터버너)
  const vmax = Math.sqrt(accAB / ((cd0 + 0.012 * wave * 0.6) * dragK));
  const stall = Math.sqrt(9.81 / (liftK * W.cla * aoaMax * 0.95));
  const armor = B.armor * (1 + (d.length - 1) * 0.6);
  const firepower = (G.dmg * G.rof) / 600 + d.missiles * 0.12;
  return {
    L, mass, accMil, accAB, cd0, liftK, dragK, wave, cla: W.cla, aoaMax, maxG,
    rollRate, pitchRate, yawRate, vmax, stall, armor, gun: G, missiles: d.missiles,
    hp: Math.round(100 * armor),
    radius: L * 0.42,
    // 0..1 정규화 (설계실 막대 그래프)
    bars: {
      speed: clamp((vmax * 3.6 - 1200) / 800, 0.05, 1),
      accel: clamp((accAB - 10) / 14, 0.05, 1),
      agility: clamp((rollRate - 2.2) / 2.6 * 0.5 + (pitchRate - 0.7) / 0.6 * 0.5, 0.05, 1),
      armor: clamp((armor - 0.7) / 0.9, 0.05, 1),
      firepower: clamp((firepower - 0.7) / 1.5, 0.05, 1),
    },
  };
}

/* ------------------------------------------------------------------ */
/* 텍스처 (도장 · 패널 라인 · 마킹)                                      */
/* ------------------------------------------------------------------ */
function rng(seed) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) | 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

function drawPattern(ctx, w, h, p, R, fuselage) {
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, w, h);
  if (p.pattern === 'twotone') {
    if (fuselage) {
      // 아래쪽(v≈0.75)을 밝은 하면색으로
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0.0, p.base); g.addColorStop(0.42, p.base);
      g.addColorStop(0.52, shade(p.base, 1.18)); g.addColorStop(0.98, shade(p.base, 1.18)); g.addColorStop(1.0, p.base);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = p.second;
    for (let i = 0; i < 9; i++) {
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      const x = R() * w, y = R() * h, r = (0.08 + R() * 0.12) * w;
      ctx.ellipse(x, y, r, r * (0.4 + R() * 0.5), R() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (p.pattern === 'splinter') {
    const cols = [p.second, shade(p.base, 0.82), shade(p.second, 1.15)];
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath();
      const cx = R() * w, cy = R() * h, r = (0.05 + R() * 0.14) * w;
      const n = 3 + Math.floor(R() * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + R() * 0.8;
        const rr = r * (0.4 + R() * 0.9);
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.6);
      }
      ctx.closePath(); ctx.fill();
    }
  } else if (p.pattern === 'digital') {
    const cell = Math.max(6, Math.round(w / 110));
    const cols = [p.second, shade(p.base, 0.75), shade(p.base, 1.2)];
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const n = Math.sin(x * 0.013 + Math.sin(y * 0.021) * 2.1) + Math.sin(y * 0.017 + Math.cos(x * 0.009) * 1.7) + (R() - 0.5) * 0.9;
        if (n > 0.55) { ctx.fillStyle = cols[0]; ctx.fillRect(x, y, cell, cell); }
        else if (n < -0.85) { ctx.fillStyle = cols[1]; ctx.fillRect(x, y, cell, cell); }
        else if (n > 0.2 && R() < 0.12) { ctx.fillStyle = cols[2]; ctx.fillRect(x, y, cell, cell); }
      }
    }
  } else if (p.pattern === 'tiger') {
    ctx.fillStyle = p.second;
    for (let i = 0; i < 22; i++) {
      const x0 = R() * w;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      for (let y = 0; y <= h; y += h / 8) ctx.lineTo(x0 + Math.sin(y * 0.02 + i) * w * 0.03 + (R() - 0.5) * w * 0.02, y);
      for (let y = h; y >= 0; y -= h / 8) ctx.lineTo(x0 + w * (0.012 + R() * 0.02) + Math.sin(y * 0.02 + i) * w * 0.03, y);
      ctx.closePath(); ctx.fill();
    }
  } else if (p.pattern === 'stripe') {
    ctx.fillStyle = p.second;
    if (fuselage) {
      // 길이 방향 레이싱 스트라이프 (상면)
      ctx.fillRect(0, h * 0.205, w, h * 0.03);
      ctx.fillRect(0, h * 0.265, w, h * 0.03);
    } else {
      for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(w * (0.2 + i * 0.32), 0); ctx.rotate(0.5); ctx.fillRect(0, -h, w * 0.06, h * 3); ctx.restore(); }
    }
  }
  // 그을음/노화
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.025)';
    const s = 4 + R() * 40;
    ctx.fillRect(R() * w, R() * h, s, s * (0.3 + R()));
  }
}

function drawPanelLines(ctx, w, h, R, density = 1) {
  ctx.strokeStyle = 'rgba(10,12,16,0.32)';
  ctx.lineWidth = Math.max(1, w / 900);
  const nx = Math.round(14 * density);
  for (let i = 0; i < nx; i++) {
    const x = (i / nx) * w + (R() - 0.5) * (w / nx) * 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let i = 0; i < 30 * density; i++) {
    const y = R() * h, x = R() * w, len = (0.04 + R() * 0.12) * w;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  // 정비 패널 + 리벳
  for (let i = 0; i < 22 * density; i++) {
    const x = R() * w, y = R() * h, pw = (0.015 + R() * 0.04) * w, ph = (0.02 + R() * 0.05) * h;
    ctx.strokeRect(x, y, pw, ph);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 500 * density; i++) ctx.fillRect(R() * w, R() * h, 1.2, 1.2);
}

const _texCache = new Map();
function getTextures(d) {
  const key = JSON.stringify([d.name, d.number, d.paint]);
  let t = _texCache.get(key);
  if (!t) {
    t = makeTextures(d);
    _texCache.set(key, t);
    if (_texCache.size > 14) {
      const [k0, old] = _texCache.entries().next().value;
      _texCache.delete(k0);
      for (const x of Object.values(old)) x.dispose();
    }
  }
  return t;
}

function makeTextures(d) {
  const p = d.paint;
  const R = rng(d.name + d.number + p.pattern + p.base + p.second + p.accent);
  // 동체 (u: 길이, v: 둘레 — v=0.25 가 상면)
  const fc = document.createElement('canvas');
  fc.width = 1024; fc.height = 512;
  const fx = fc.getContext('2d');
  drawPattern(fx, 1024, 512, p, R, true);
  // 레이돔 / 대눈부심 패널
  fx.fillStyle = shade(p.base, 0.62);
  fx.fillRect(0, 0, 1024 * 0.075, 512);
  fx.fillStyle = 'rgba(20,22,26,0.85)';
  fx.fillRect(1024 * 0.075, 512 * 0.19, 1024 * 0.1, 512 * 0.12);
  // 강조 밴드 (노즐 앞)
  fx.fillStyle = p.accent;
  fx.fillRect(1024 * 0.86, 0, 1024 * 0.018, 512);
  drawPanelLines(fx, 1024, 512, R, 1.2);
  // 측면 번호 (v≈0 / 0.5 가 좌우 측면)
  fx.font = 'bold 54px Orbitron, Rajdhani, sans-serif';
  fx.fillStyle = 'rgba(240,240,240,0.85)';
  fx.textAlign = 'center'; fx.textBaseline = 'middle';
  for (const v of [0.035, 0.535]) {
    fx.save(); fx.translate(1024 * 0.25, 512 * v); fx.scale(1, 0.55); fx.fillText(d.number, 0, 0); fx.restore();
  }
  // 날개/미익
  const sc = document.createElement('canvas');
  sc.width = sc.height = 512;
  const sx = sc.getContext('2d');
  drawPattern(sx, 512, 512, p, R, false);
  drawPanelLines(sx, 512, 512, R, 0.8);

  const fus = new THREE.CanvasTexture(fc);
  fus.colorSpace = THREE.SRGBColorSpace;
  fus.anisotropy = 4;
  const surf = new THREE.CanvasTexture(sc);
  surf.colorSpace = THREE.SRGBColorSpace;
  surf.wrapS = surf.wrapT = THREE.RepeatWrapping;
  surf.repeat.set(1 / 9, 1 / 9);
  surf.anisotropy = 4;

  // 수직미익 마킹 (번호 + 엠블럼)
  const tc = document.createElement('canvas');
  tc.width = tc.height = 256;
  const tx = tc.getContext('2d');
  tx.clearRect(0, 0, 256, 256);
  tx.fillStyle = p.accent;
  tx.beginPath(); tx.moveTo(0, 30); tx.lineTo(256, 0); tx.lineTo(256, 46); tx.lineTo(0, 76); tx.closePath(); tx.fill();
  tx.fillStyle = 'rgba(245,245,245,0.92)';
  tx.font = 'bold 74px Orbitron, Rajdhani, sans-serif';
  tx.textAlign = 'center'; tx.textBaseline = 'middle';
  tx.fillText(d.number, 128, 168);
  tx.strokeStyle = p.accent; tx.lineWidth = 6;
  tx.beginPath(); tx.arc(128, 168, 70, 0, Math.PI * 2); tx.stroke();
  const tail = new THREE.CanvasTexture(tc);
  tail.colorSpace = THREE.SRGBColorSpace;

  // 국적 표지
  const rc = document.createElement('canvas');
  rc.width = rc.height = 128;
  const rx = rc.getContext('2d');
  rx.fillStyle = p.accent; rx.beginPath(); rx.arc(64, 64, 62, 0, Math.PI * 2); rx.fill();
  rx.fillStyle = '#f2f2f2'; rx.beginPath(); rx.arc(64, 64, 44, 0, Math.PI * 2); rx.fill();
  rx.fillStyle = shade(p.base, 0.55);
  rx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 ? 16 : 38;
    rx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  rx.closePath(); rx.fill();
  const roundel = new THREE.CanvasTexture(rc);
  roundel.colorSpace = THREE.SRGBColorSpace;
  return { fus, surf, tail, roundel };
}

let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

/* ------------------------------------------------------------------ */
/* 화염 셰이더 (충격 다이아몬드 포함)                                    */
/* ------------------------------------------------------------------ */
const FLAME_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FLAME_FRAG = /* glsl */`
uniform float uTime, uPower, uAB, uOuter;
uniform vec3 uCore, uEdge;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  float t = vUv.y;
  float f = abs(dot(normalize(vN), normalize(vV)));
  float body = pow(f, uOuter > 0.5 ? 1.1 : 2.4);
  float fall = pow(clamp(1.0 - t, 0.0, 1.0), uOuter > 0.5 ? 1.7 : 1.05);
  float dia = pow(0.5 + 0.5 * cos(t * 34.0 - 1.2), 7.0) * uAB * smoothstep(0.75, 0.0, t);
  float flick = 0.8 + 0.2 * sin(uTime * 71.0 + t * 23.0) * sin(uTime * 43.0 + vUv.x * 31.4);
  vec3 col = mix(uEdge, uCore, clamp(body * (1.25 - t), 0.0, 1.0));
  col += vec3(1.0, 0.96, 0.9) * dia * 2.2 * body;
  float a = body * fall * uPower * flick;
  gl_FragColor = vec4(col * (uOuter > 0.5 ? 1.6 : 3.2), clamp(a, 0.0, 1.0));
}`;

/* ------------------------------------------------------------------ */
/* 형상 생성 유틸                                                        */
/* ------------------------------------------------------------------ */
const STATIONS = [
  // t, 반폭, 위높이, 아래높이, 중심y
  [0.00, 0.03, 0.03, 0.03, -0.10],
  [0.05, 0.26, 0.23, 0.22, -0.10],
  [0.12, 0.42, 0.38, 0.35, -0.07],
  [0.22, 0.52, 0.50, 0.43, -0.03],
  [0.32, 0.68, 0.55, 0.50, 0.00],
  [0.44, 0.92, 0.54, 0.54, 0.00],
  [0.58, 1.00, 0.52, 0.55, 0.00],
  [0.74, 0.96, 0.50, 0.52, 0.00],
  [0.88, -1, 0.46, 0.46, 0.02],
  [1.00, -0.92, 0.42, 0.42, 0.04],
];

function stationAt(t, tailW) {
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const a = STATIONS[i], b = STATIONS[i + 1];
    if (t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0]);
      const s = (1 - Math.cos(u * Math.PI)) / 2;
      const res = [];
      for (let k = 1; k < 5; k++) {
        let av = a[k], bv = b[k];
        if (k === 1) { if (av < 0) av = -av * tailW; if (bv < 0) bv = -bv * tailW; }
        res.push(lerp(av, bv, i === 0 && k === 1 ? Math.sqrt(u) : s));
      }
      return res;
    }
  }
  const z = STATIONS[STATIONS.length - 1];
  return [Math.abs(z[1]) * tailW, z[2], z[3], z[4]];
}

function loftFuselage(L, W, H, n, tailW) {
  const seg = 36, rings = 64;
  const pos = [], uv = [], idx = [];
  const e = 2 / n;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const [w, ht, hb, yc] = stationAt(t, tailW);
    const z = -L / 2 + t * L;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const x = W * Math.sign(c) * Math.pow(Math.abs(c), e) * w;
      const y = H * 2 * (yc + (s > 0 ? ht : hb) * Math.sign(s) * Math.pow(Math.abs(s), e));
      pos.push(x, y, z);
      uv.push(t, 1 - j / seg);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // 꼬리 캡
  const last = rings * (seg + 1);
  const [, , , ycL] = stationAt(1, tailW);
  const ci = pos.length / 3;
  pos.push(0, H * 2 * ycL, L / 2); uv.push(1, 0.5);
  for (let j = 0; j < seg; j++) idx.push(ci, last + j + 1, last + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 평면형(planform) → 두께 있는 익면. 점 좌표: x=스팬 바깥, y=후방 */
function surfaceGeo(points, thick, bevel, span, tipThin = 0.45) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: true, bevelThickness: thick * 0.7, bevelSize: bevel, bevelSegments: 2, curveSegments: 1,
  });
  g.rotateX(Math.PI / 2);
  g.translate(0, thick / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = lerp(1, tipThin, clamp(p.getX(i) / Math.max(0.01, span), 0, 1));
    p.setY(i, p.getY(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function planform(W, L, spanMul, sweepAdj) {
  const s = W.span * L * spanMul, cr = W.cr * L, ct = W.ct * L;
  const sw = (W.sweep + sweepAdj) * DEG;
  let le;
  if (W.forward) {
    const by = 0.42 * cr;
    le = [[0, 0], [0.2 * s, by], [s, by - 0.8 * s * Math.tan(sw)]];
  } else if (W.lex) {
    const ky = 0.32 * s * Math.tan(74 * DEG);
    le = [[0, 0], [0.32 * s, ky], [s, ky + 0.68 * s * Math.tan(sw)]];
  } else {
    le = [[0, 0], [s, s * Math.tan(sw)]];
  }
  const tipLE = le[le.length - 1];
  const tipTE = W.straightTE ? [s, Math.max(tipLE[1] + ct, cr)] : [s, tipLE[1] + ct];
  const rootTE = [0, cr];
  const leY = (x) => {
    for (let i = 0; i < le.length - 1; i++) {
      const a = le[i], b = le[i + 1];
      if (x <= b[0]) return lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
    }
    return tipLE[1];
  };
  const teY = (x) => lerp(rootTE[1], tipTE[1], x / s);
  return { s, cr, le, tipLE, tipTE, rootTE, leY, teY };
}

function makeMissileMesh(mats) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 2.7, 12), mats.missile);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.42, 12), mats.missileNose);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.56;
  g.add(nose);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.12, 12), mats.missileBand);
  band.rotation.x = Math.PI / 2; band.position.z = -1.05;
  g.add(band);
  const finG = new THREE.BoxGeometry(0.42, 0.012, 0.32);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(finG, mats.missile);
    f.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    f.position.z = 1.18;
    g.add(f);
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.01, 0.18), mats.missile);
    c.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    c.position.z = -0.7;
    g.add(c);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

const _missileMats = {
  missile: new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.45, metalness: 0.1 }),
  missileNose: new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.3, metalness: 0.4 }),
  missileBand: new THREE.MeshStandardMaterial({ color: 0xd8b13a, roughness: 0.5 }),
};
export function createMissileMesh() { return makeMissileMesh(_missileMats); }

/* ------------------------------------------------------------------ */
/* 전투기 모델                                                          */
/* ------------------------------------------------------------------ */
export class JetModel {
  constructor(design, opts = {}) {
    this.design = normalizeDesign(design);
    this.stats = computeStats(this.design);
    this.opts = opts;
    this.root = new THREE.Group();
    this.root.name = 'jet';
    this.nozzles = [];
    this.surfaces = { ailerons: [], stabs: [], canards: [], rudders: [] };
    this.missileSlots = [];
    this.navLights = [];
    this.disposables = [];
    this._time = Math.random() * 10;
    this._build();
  }

  _mat(m) { this.disposables.push(m); return m; }

  _build() {
    const d = this.design;
    const B = BODIES[d.body], Wt = WINGS[d.wing];
    const L = B.len * d.length;
    const W = B.w * (d.engines === 3 ? 1.1 : 1);
    const H = B.h;
    const tailW = d.engines === 1 ? 0.52 : d.engines === 2 ? 0.86 : 0.98;
    this.L = L;

    const tex = getTextures(d);
    const fin = d.paint.finish;
    const metal = fin === 'metal' ? 0.85 : 0.32;
    const rough = fin === 'gloss' ? 0.28 : fin === 'metal' ? 0.24 : 0.6;
    const cc = fin === 'gloss' ? 0.9 : fin === 'metal' ? 0.5 : 0.08;
    const bodyMat = this._mat(new THREE.MeshPhysicalMaterial({
      map: tex.fus, metalness: metal, roughness: rough, clearcoat: cc, clearcoatRoughness: 0.18,
      flatShading: !!B.faceted, envMapIntensity: 1.1,
    }));
    const surfMat = this._mat(new THREE.MeshPhysicalMaterial({
      map: tex.surf, metalness: metal, roughness: rough, clearcoat: cc, clearcoatRoughness: 0.2, envMapIntensity: 1.1,
    }));
    const darkMetal = this._mat(new THREE.MeshStandardMaterial({ color: 0x3b3e43, metalness: 0.9, roughness: 0.34 }));
    const burnt = this._mat(new THREE.MeshStandardMaterial({ color: 0x6b5a4a, metalness: 0.95, roughness: 0.4 }));
    const black = this._mat(new THREE.MeshBasicMaterial({ color: 0x050607 }));
    this.mats = { bodyMat, surfMat, darkMetal, black };

    const root = this.root;
    // ── 동체
    const fus = new THREE.Mesh(loftFuselage(L, W, H, B.n, tailW), bodyMat);
    fus.castShadow = true; fus.receiveShadow = true;
    root.add(fus);
    this.fuselage = fus;
    const topAt = (t) => { const s = stationAt(t, tailW); return H * 2 * (s[3] + s[1]); };
    const halfWAt = (t) => W * stationAt(t, tailW)[0];
    const ycAt = (t) => H * 2 * stationAt(t, tailW)[3];
    const zAt = (t) => -L / 2 + t * L;

    // ── 캐노피 + 조종사
    const ct = 0.25;
    const cz = zAt(ct);
    const cBase = topAt(ct) - 0.12;
    const canopyTint = { gold: 0xd9a441, clear: 0xbfd8e6, smoke: 0x2a2f36, blue: 0x3d6fd8 }[d.paint.canopy] || 0xd9a441;
    const canopyMat = this._mat(new THREE.MeshPhysicalMaterial({
      color: canopyTint, metalness: d.paint.canopy === 'clear' ? 0.0 : 0.55, roughness: 0.04, transparent: true,
      opacity: d.paint.canopy === 'clear' ? 0.28 : 0.62, clearcoat: 1, clearcoatRoughness: 0.03,
      iridescence: d.paint.canopy === 'gold' || d.paint.canopy === 'blue' ? 0.8 : 0.1, iridescenceIOR: 1.6,
      envMapIntensity: 2.6, depthWrite: false,
    }));
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat);
    const cw = Math.min(0.56, halfWAt(ct) * 0.82);
    canopy.scale.set(cw, 0.66, L * 0.105);
    canopy.position.set(0, cBase, cz + L * 0.01);
    canopy.renderOrder = 2;
    root.add(canopy);
    this.canopy = canopy;
    // 캐노피 프레임
    const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 24, Math.PI), darkMetal);
    frame.scale.set(cw * 0.9, 0.66 * 0.9, 1);
    frame.position.set(0, cBase, cz - L * 0.035);
    root.add(frame);
    this.canopyFrame = frame;
    // 조종사
    const pilot = new THREE.Group();
    const helmetMat = this._mat(new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.35 }));
    const visorMat = this._mat(new THREE.MeshPhysicalMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.05, iridescence: 1 }));
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), helmetMat);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.172, 16, 8, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.32), visorMat);
    visor.rotation.y = Math.PI;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 10), this._mat(new THREE.MeshStandardMaterial({ color: 0x4b5a3c, roughness: 0.8 })));
    helmet.position.y = 0.42; visor.position.y = 0.42; torso.position.y = 0.05;
    pilot.add(helmet, visor, torso);
    pilot.position.set(0, cBase + 0.02, cz + 0.2);
    root.add(pilot);
    this.pilot = pilot;
    this.eye = new THREE.Vector3(0, cBase + 0.5, cz + 0.12);

    // ── 흡입구
    if (d.intake === 'chin') {
      const ig = new THREE.CylinderGeometry(0.5, 0.55, L * 0.2, 20, 1, false);
      ig.rotateX(Math.PI / 2);
      const intake = new THREE.Mesh(ig, bodyMat);
      intake.scale.set(W * 0.75, H * 0.5, 1);
      intake.position.set(0, ycAt(0.42) - H * 0.95, zAt(0.42));
      intake.castShadow = true;
      root.add(intake);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.48, 20), black);
      mouth.scale.copy(intake.scale); mouth.scale.z = 1;
      mouth.position.set(0, intake.position.y, intake.position.z - L * 0.1 - 0.01);
      mouth.rotation.y = Math.PI;
      root.add(mouth);
    } else {
      const len = L * 0.24, ih = H * 0.9, slant = d.body === 'stealth' ? 0.55 : 0.3;
      const shape = new THREE.Shape([
        new THREE.Vector2(0, ih / 2), new THREE.Vector2(ih * slant, -ih / 2),
        new THREE.Vector2(len, -ih / 2 * 0.8), new THREE.Vector2(len, ih / 2 * 0.6),
      ]);
      const iw = W * 0.38;
      const g = new THREE.ExtrudeGeometry(shape, { depth: iw, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
      g.rotateY(-Math.PI / 2);
      for (const side of [1, -1]) {
        const m = new THREE.Mesh(g, bodyMat);
        const t0 = 0.33;
        m.position.set(side > 0 ? halfWAt(0.45) * 0.62 + iw : -halfWAt(0.45) * 0.62, ycAt(t0) - H * 0.22, zAt(t0));
        m.castShadow = true;
        root.add(m);
        // 입구 (검정)
        const mw = iw, mh = ih * 0.86;
        const mouth = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), black);
        const midZ = zAt(t0) + ih * slant * 0.5 - 0.08;
        mouth.position.set(side * (halfWAt(0.45) * 0.62 + iw / 2), m.position.y, midZ);
        mouth.rotation.set(-Math.atan2(ih * slant, ih), Math.PI, 0);
        root.add(mouth);
      }
    }

    // ── 엔진 노즐 + 화염
    const nozR = (d.engines === 1 ? 0.62 : d.engines === 2 ? 0.5 : 0.44) * H * (d.body === 'heavy' ? 1.08 : 1);
    const tailHW = halfWAt(1);
    const nx = d.engines === 1 ? [0] : d.engines === 2 ? [-tailHW * 0.5, tailHW * 0.5] : [-tailHW * 0.66, 0, tailHW * 0.66];
    const nozY = ycAt(1);
    const prof = [
      [nozR * 1.06, 0], [nozR * 1.02, 0.35], [nozR * 0.9, 0.95], [nozR * 0.94, 1.3], [nozR * 0.86, 1.34], [nozR * 0.8, 0.95], [nozR * 0.7, 0.3],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const nozG = new THREE.LatheGeometry(prof, 28);
    nozG.rotateX(Math.PI / 2);
    const flameDef = FLAMES[d.flame];
    this.flameUniforms = {
      uTime: { value: 0 }, uPower: { value: 0 }, uAB: { value: 0 }, uOuter: { value: 0 },
      uCore: { value: new THREE.Vector3(...flameDef.core) }, uEdge: { value: new THREE.Vector3(...flameDef.edge) },
    };
    const coreMat = this._mat(new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, uniforms: this.flameUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    const outerUniforms = { ...this.flameUniforms, uOuter: { value: 1 } };
    this.outerUniforms = outerUniforms;
    const outerMat = this._mat(new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, uniforms: outerUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    const coneG = new THREE.CylinderGeometry(0.02, 1, 1, 24, 10, true);
    coneG.translate(0, 0.5, 0);
    coneG.rotateX(Math.PI / 2);
    this.innerGlowMat = this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(flameDef.glow), toneMapped: false }));
    const glowMat = this._mat(new THREE.SpriteMaterial({ map: glowTexture(), color: flameDef.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    for (const x of nx) {
      const n = new THREE.Group();
      n.position.set(x, nozY, L / 2 - 0.5);
      const shell = new THREE.Mesh(nozG, d.body === 'stealth' ? darkMetal : burnt);
      shell.material.side = THREE.DoubleSide;
      shell.castShadow = true;
      n.add(shell);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(nozR * 0.78, 20), this.innerGlowMat);
      disc.position.z = 0.55;
      n.add(disc);
      const core = new THREE.Mesh(coneG, coreMat);
      core.position.z = 1.3;
      core.scale.set(nozR * 0.75, nozR * 0.75, 3);
      core.frustumCulled = false;
      const outer = new THREE.Mesh(coneG, outerMat);
      outer.position.z = 1.25;
      outer.scale.set(nozR * 1.05, nozR * 1.05, 5);
      outer.frustumCulled = false;
      const glow = new THREE.Sprite(glowMat);
      glow.position.z = 1.45;
      glow.scale.setScalar(nozR * 4);
      n.add(core, outer, glow);
      root.add(n);
      this.nozzles.push({ group: n, core, outer, glow, r: nozR, exit: new THREE.Vector3(x, nozY, L / 2 + 0.9) });
    }

    // ── 주익
    const pf = planform(Wt, L, d.span, d.sweep);
    this.planform = pf;
    const wingT = Wt.rootT;
    const wx0 = halfWAt(wingT + 0.1) * 0.55;
    const wy = ycAt(wingT) - H * 0.12;
    const wz = zAt(wingT);
    const f1 = 0.4, f2 = 0.9;
    const P1 = [f1 * pf.s, pf.teY(f1 * pf.s)], P2 = [f2 * pf.s, pf.teY(f2 * pf.s)];
    const c1 = (P1[1] - pf.leY(P1[0])) * 0.24, c2 = (P2[1] - pf.leY(P2[0])) * 0.24;
    const H1 = [P1[0], P1[1] - c1], H2 = [P2[0], P2[1] - c2];
    const wingPts = [...pf.le, pf.tipTE, P2, H2, H1, P1, pf.rootTE];
    const thick = 0.1 * d.length;
    const wingG = surfaceGeo(wingPts, thick, 0.07, pf.s, 0.4);
    // 에일러론 (힌지 축 기준 로컬 좌표)
    const hd = new THREE.Vector2(H2[0] - H1[0], H2[1] - H1[1]);
    const hLen = hd.length(); hd.normalize();
    const toLocal = (p) => { const dx = p[0] - H1[0], dy = p[1] - H1[1]; return [dx * hd.x + dy * hd.y, -dx * hd.y + dy * hd.x]; };
    const ailPts = [[0, 0], [hLen, 0], toLocal(P2), toLocal(P1)];
    const ailG = surfaceGeo(ailPts, thick * 0.55, 0.03, 1e6, 1);
    const tipFrac = 0.42;
    this.wingtips = [];
    for (const side of [1, -1]) {
      const wg = new THREE.Group();
      wg.position.set(side * wx0, wy, wz);
      wg.scale.x = side;
      wg.rotation.z = side * Wt.dihedral;
      const wing = new THREE.Mesh(wingG, surfMat);
      wing.castShadow = true; wing.receiveShadow = true;
      wg.add(wing);
      const hinge = new THREE.Group();
      hinge.position.set(H1[0], 0, H1[1]);
      hinge.rotation.y = Math.atan2(-hd.y, hd.x);
      const ail = new THREE.Mesh(ailG, surfMat);
      ail.castShadow = true;
      const pivot = new THREE.Group();
      pivot.add(ail);
      hinge.add(pivot);
      wg.add(hinge);
      this.surfaces.ailerons.push({ pivot, side });
      // 국적 표지
      const rd = new THREE.Mesh(new THREE.CircleGeometry(pf.s * 0.13, 24), this._mat(new THREE.MeshStandardMaterial({
        map: tex.roundel, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.6,
      })));
      rd.rotation.x = -Math.PI / 2;
      const rx = pf.s * 0.62;
      rd.position.set(rx, thick * 1.2 * lerp(1, 0.4, 0.62) + 0.008, (pf.leY(rx) + pf.teY(rx)) / 2);
      wg.add(rd);
      // 날개 끝 마커 (비행운 · 항법등)
      const tip = new THREE.Object3D();
      tip.position.set(pf.s + 0.05, 0, pf.tipLE[1] + (pf.tipTE[1] - pf.tipLE[1]) * tipFrac);
      wg.add(tip);
      this.wingtips.push(tip);
      const nav = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), this._mat(new THREE.MeshBasicMaterial({
        color: side > 0 ? new THREE.Color(0.2, 3, 0.4) : new THREE.Color(3, 0.15, 0.1), toneMapped: false,
      })));
      nav.position.copy(tip.position);
      wg.add(nav);
      root.add(wg);
    }

    // ── 수평 미익
    const hasStab = (d.tail === 'single' || d.tail === 'twin') && d.wing !== 'delta' && d.wing !== 'cranked';
    if (hasStab) {
      const hs = 0.17 * L * Math.sqrt(d.span), hcr = 0.15 * L, hct = 0.055 * L, hsw = 42 * DEG;
      const pts = [[0, 0], [hs, hs * Math.tan(hsw)], [hs, hs * Math.tan(hsw) + hct], [0, hcr]];
      // 피벗을 시위 40% 지점으로
      const piv = hcr * 0.42;
      const g = surfaceGeo(pts.map(([x, y]) => [x, y - piv]), 0.06, 0.05, hs, 0.5);
      const tz = zAt(0.79) + piv;
      for (const side of [1, -1]) {
        const grp = new THREE.Group();
        grp.position.set(side * halfWAt(0.86) * 0.82, ycAt(0.86), tz);
        grp.scale.x = side;
        grp.rotation.z = side * -0.03;
        const m = new THREE.Mesh(g, surfMat);
        m.castShadow = true;
        grp.add(m);
        root.add(grp);
        this.surfaces.stabs.push({ pivot: grp, side });
      }
    }
    // ── 카나드
    if (d.canard) {
      const s = 0.1 * L, cr = 0.085 * L, ctp = 0.03 * L, sw = 50 * DEG;
      const piv = cr * 0.45;
      const pts = [[0, 0], [s, s * Math.tan(sw)], [s, s * Math.tan(sw) + ctp], [0, cr]].map(([x, y]) => [x, y - piv]);
      const g = surfaceGeo(pts, 0.05, 0.04, s, 0.5);
      for (const side of [1, -1]) {
        const grp = new THREE.Group();
        grp.position.set(side * halfWAt(0.3) * 0.85, ycAt(0.3) + H * 0.12, zAt(0.27) + piv);
        grp.scale.x = side;
        grp.rotation.z = side * 0.05;
        const m = new THREE.Mesh(g, surfMat);
        m.castShadow = true;
        grp.add(m);
        root.add(grp);
        this.surfaces.canards.push({ pivot: grp, side });
      }
    }
    // ── 수직 미익
    if (d.tail !== 'none') {
      const hv = (d.tail === 'vtail' ? 0.15 : d.tail === 'twin' ? 0.17 : 0.2) * L;
      const vcr = (d.tail === 'single' ? 0.22 : 0.18) * L, vct = 0.075 * L, vsw = (d.body === 'stealth' ? 40 : 46) * DEG;
      const pts = [[0, 0], [hv, hv * Math.tan(vsw)], [hv, hv * Math.tan(vsw) + vct], [0, vcr]];
      const g = surfaceGeo(pts, 0.06, 0.05, hv, 0.5);
      g.rotateZ(Math.PI / 2);
      const tailMat = this._mat(new THREE.MeshStandardMaterial({ map: tex.tail, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.55 }));
      const cant = d.tail === 'vtail' ? 42 * DEG : d.tail === 'twin' ? (d.body === 'stealth' ? 26 : 12) * DEG : 0;
      const list = d.tail === 'single' ? [0] : [1, -1];
      for (const side of list) {
        const grp = new THREE.Group();
        const x = side === 0 ? 0 : side * halfWAt(0.82) * 0.62;
        grp.position.set(x, topAt(0.78) - 0.08, zAt(0.74));
        grp.rotation.z = side === 0 ? 0 : -side * cant;
        const m = new THREE.Mesh(g, surfMat);
        m.castShadow = true;
        grp.add(m);
        // 꼬리 마킹 (양면)
        const dg = new THREE.PlaneGeometry(vcr * 0.62, vcr * 0.62);
        for (const face of [1, -1]) {
          const dm = new THREE.Mesh(dg, tailMat);
          dm.position.set(face * 0.08, hv * 0.48, hv * 0.48 * Math.tan(vsw) + vcr * 0.42);
          dm.rotation.y = face * Math.PI / 2;
          grp.add(dm);
        }
        root.add(grp);
        this.surfaces.rudders.push({ pivot: grp, side, base: grp.rotation.z });
        if (side >= 0) {
          const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4), toneMapped: false })));
          strobe.position.set(0, hv + 0.05, hv * Math.tan(vsw) + vct * 0.5);
          grp.add(strobe);
          this.strobe = strobe;
        }
      }
    }

    // ── 무장 (미사일)
    if (d.body !== 'stealth') {
      const stations = [];
      stations.push([pf.s + 0.12, 0.98]);                 // 날개 끝 레일
      if (d.missiles >= 4) stations.push([pf.s * 0.68, 0.0]);
      if (d.missiles >= 6) stations.push([pf.s * 0.42, 0.0]);
      if (d.missiles >= 8) stations.push([pf.s * 0.2, 0.0]);
      for (const side of [1, -1]) {
        for (const [x, isTip] of stations) {
          const m = createMissileMesh();
          const midY = (pf.leY(Math.min(x, pf.s)) + pf.teY(Math.min(x, pf.s))) / 2;
          const local = new THREE.Vector3(x, isTip ? 0 : -0.42, midY);
          // 날개 그룹 좌표 → 기체 좌표
          const wpos = new THREE.Vector3(side * (wx0 + local.x), wy + local.y + side * Wt.dihedral * local.x * side, wz + local.z);
          m.position.copy(wpos);
          root.add(m);
          if (!isTip) {
            const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 1.1), darkMetal);
            pylon.position.copy(wpos).add(new THREE.Vector3(0, 0.2, 0));
            root.add(pylon);
          }
          this.missileSlots.push({ mesh: m, pos: wpos.clone(), side });
        }
      }
    } else {
      // 내부 무장창: 발사 위치만 정의
      for (let i = 0; i < d.missiles; i++) {
        const side = i % 2 ? -1 : 1;
        this.missileSlots.push({ mesh: null, pos: new THREE.Vector3(side * 0.5, ycAt(0.5) - H * 0.9, zAt(0.5)), side });
      }
    }
    this.missileSlots.sort((a, b) => Math.abs(b.pos.x) - Math.abs(a.pos.x));

    // ── 기관포 포구
    this.gunPort = new THREE.Vector3(-halfWAt(0.3) * 0.7, ycAt(0.3) + H * 0.35, zAt(0.3));
    const flashMat = this._mat(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.muzzle = new THREE.Sprite(flashMat);
    this.muzzle.position.copy(this.gunPort).add(new THREE.Vector3(0, 0, -0.8));
    this.muzzle.visible = false;
    root.add(this.muzzle);

    // 마커 좌표 확정
    root.updateMatrixWorld(true);
    this.wingtipLocal = this.wingtips.map((o) => root.worldToLocal(o.getWorldPosition(new THREE.Vector3())));
    this.radius = L * 0.5;
    if (this.opts.cockpit) this._buildCockpit();
  }

  /** 1인칭 조종석 내부 (계기판, MFD, HUD 결합유리, 캐노피 프레임) */
  _buildCockpit() {
    const g = new THREE.Group();
    const e = this.eye;
    const panelMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.85, metalness: 0.2 }));
    const trim = this._mat(new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.6, metalness: 0.4 }));
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.3), panelMat);
    panel.position.set(e.x, e.y - 0.5, e.z - 0.72);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.2), trim);
    shield.position.set(e.x, e.y - 0.38, e.z - 0.8);
    g.add(panel, shield);
    // MFD
    this.mfdCanvas = document.createElement('canvas');
    this.mfdCanvas.width = 512; this.mfdCanvas.height = 160;
    this.mfdTex = new THREE.CanvasTexture(this.mfdCanvas);
    this.mfdTex.colorSpace = THREE.SRGBColorSpace;
    const mfd = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.19), this._mat(new THREE.MeshBasicMaterial({ map: this.mfdTex, toneMapped: false })));
    mfd.position.set(e.x, e.y - 0.37, e.z - 0.55);
    mfd.rotation.x = -0.55;
    g.add(mfd);
    // HUD 결합 유리
    const combiner = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.17), this._mat(new THREE.MeshBasicMaterial({ color: 0x6affc0, transparent: true, opacity: 0.07, depthWrite: false })));
    combiner.position.set(e.x, e.y - 0.13, e.z - 0.6);
    combiner.rotation.x = -0.2;
    g.add(combiner);
    // 캐노피 후방 아치 + 측면 레일 (전방 시야는 버블 캐노피처럼 트여 있음)
    const arch = new THREE.TorusGeometry(0.56, 0.02, 6, 28, Math.PI);
    const a2 = new THREE.Mesh(arch, trim); a2.position.set(e.x, e.y - 0.42, e.z + 0.55); a2.scale.set(1, 1.18, 1);
    g.add(a2);
    for (const s of [1, -1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 1.6), panelMat);
      rail.position.set(e.x + s * 0.52, e.y - 0.46, e.z - 0.1);
      g.add(rail);
    }
    g.visible = false;
    this.root.add(g);
    this.cockpit = g;
  }

  setInterior(on) {
    if (this.cockpit) this.cockpit.visible = on;
    this.pilot.visible = !on;
    this.canopy.visible = !on;
    this.canopyFrame.visible = !on;
  }

  /** 매 프레임: 조종면 · 화염 · 등화 */
  animate(dt, st) {
    this._time += dt;
    const t = this._time;
    const k = 1 - Math.exp(-dt * 10);
    const sm = this._sm || (this._sm = { p: 0, r: 0, y: 0 });
    sm.p += ((st.pitch || 0) - sm.p) * k;
    sm.r += ((st.roll || 0) - sm.r) * k;
    sm.y += ((st.yaw || 0) - sm.y) * k;
    for (const a of this.surfaces.ailerons) a.pivot.rotation.x = -a.side * sm.r * 0.38 + (this.surfaces.stabs.length ? 0 : -sm.p * 0.3);
    for (const s of this.surfaces.stabs) s.pivot.rotation.x = -sm.p * 0.32 - s.side * sm.r * 0.14;
    for (const c of this.surfaces.canards) c.pivot.rotation.x = sm.p * 0.3;
    for (const r of this.surfaces.rudders) r.pivot.rotation.y = -sm.y * 0.12;

    const thr = clamp(st.throttle || 0, 0, 1);
    const ab = st.ab ? 1 : 0;
    const abS = this._abS = lerp(this._abS || 0, ab, 1 - Math.exp(-dt * 7));
    const flick = 0.92 + Math.sin(t * 57) * 0.05 + Math.sin(t * 31) * 0.04;
    this.flameUniforms.uTime.value = t;
    this.flameUniforms.uPower.value = 0.28 + thr * 0.35 + abS * 0.6;
    this.flameUniforms.uAB.value = abS;
    this.outerUniforms.uTime.value = t;
    this.outerUniforms.uPower.value = (0.08 + thr * 0.12) + abS * 0.75;
    this.outerUniforms.uAB.value = abS;
    for (const n of this.nozzles) {
      n.core.scale.z = (1.0 + thr * 1.6 + abS * 4.2) * flick;
      n.outer.scale.z = (1.4 + thr * 1.8 + abS * 6.5) * flick;
      n.outer.scale.x = n.outer.scale.y = n.r * (0.95 + abS * 0.25);
      n.glow.scale.setScalar(n.r * (2.2 + thr * 1.5 + abS * 4.5) * flick);
      n.glow.material.opacity = 0.35 + abS * 0.65;
    }
    this.innerGlowMat.color.copy(new THREE.Color(FLAMES[this.design.flame].glow)).multiplyScalar(0.4 + thr * 1.2 + abS * 2.6);
    if (this.strobe) this.strobe.visible = (t % 1.3) < 0.07 || ((t + 0.18) % 1.3) < 0.06;
    // 총구 섬광
    if (st.firing) {
      this.muzzle.visible = Math.random() < 0.85;
      this.muzzle.scale.setScalar(1.6 + Math.random() * 2.2);
      this.muzzle.material.rotation = Math.random() * 6.28;
    } else this.muzzle.visible = false;
  }

  /** 미사일 장착 표시 (남은 수) */
  setMissilesVisible(count) {
    this.missileSlots.forEach((s, i) => { if (s.mesh) s.mesh.visible = i < count; });
  }

  /** 발사할 슬롯의 기체 좌표 */
  missileSlot(indexFromRemaining) {
    const s = this.missileSlots[Math.max(0, indexFromRemaining)];
    return s ? s.pos : new THREE.Vector3(0, -1, 0);
  }

  /** 1인칭 MFD 갱신 (저빈도) */
  drawMFD(info, hudColor = '#7dffb0') {
    if (!this.mfdCanvas) return;
    const c = this.mfdCanvas.getContext('2d');
    const w = 512, h = 160;
    c.fillStyle = '#020604'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2a3a30'; c.lineWidth = 4;
    for (let i = 0; i < 3; i++) c.strokeRect(4 + i * 170, 4, 164, h - 8);
    c.fillStyle = hudColor; c.strokeStyle = hudColor;
    c.font = 'bold 20px Rajdhani, sans-serif';
    // 좌: 레이더
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(86, 80, 60, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(86, 80, 30, 0, Math.PI * 2); c.stroke();
    c.fillRect(84, 78, 4, 4);
    if (info.blips) for (const b of info.blips) { c.fillStyle = b.hostile ? '#ff5a4a' : hudColor; c.fillRect(86 + b.x * 60 - 3, 80 + b.y * 60 - 3, 6, 6); }
    c.fillStyle = hudColor;
    // 중: 엔진/속도
    c.fillText('SPD ' + Math.round(info.speed), 190, 40);
    c.fillText('ALT ' + Math.round(info.alt), 190, 68);
    c.fillText('THR ' + Math.round(info.throttle * 100) + (info.ab ? ' AB' : ''), 190, 96);
    c.fillText('G ' + info.g.toFixed(1), 190, 124);
    // 우: 무장/기체
    c.fillText('GUN ' + info.ammo, 360, 40);
    c.fillText('MSL ' + info.missiles, 360, 68);
    c.fillText('FLR ' + info.flares, 360, 96);
    c.fillStyle = info.hp < 0.35 ? '#ff5a4a' : hudColor;
    c.fillRect(360, 112, 130 * clamp(info.hp, 0, 1), 14);
    c.strokeRect(360, 112, 130, 14);
    this.mfdTex.needsUpdate = true;
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const d of this.disposables) d.dispose && d.dispose();
    if (this.mfdTex) this.mfdTex.dispose();
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}
