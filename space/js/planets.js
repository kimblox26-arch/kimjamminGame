// 태양계 행성 자료 (NASA Planetary Fact Sheet 기준)
// layers: 안쪽부터 바깥까지 내부 구조. to = 바깥 경계(반지름 비율), frac = 질량 비율
// rotH: 자전 주기(시간), 음수는 역행 자전
// surface: 가장 바깥 구슬 한 겹의 표면 색 (암석 행성)

export const PLANETS = [
  {
    id: 'mercury', ko: '수성', en: 'Mercury', mass: 3.3011e23, radius: 2439.7, rotH: 1407.6,
    layers: [
      { name: '철 핵', to: 0.83, frac: 0.70, mat: 'iron', colors: ['#6f665e', '#7b7168'] },
      { name: '암석 맨틀', to: 1, frac: 0.30, mat: 'rock', colors: ['#8a7f74', '#94897d'] },
    ],
    surface: ['#a9a49e', '#97928c', '#b8b3ad'],
  },
  {
    id: 'venus', ko: '금성', en: 'Venus', mass: 4.8675e24, radius: 6051.8, rotH: -5832.5,
    layers: [
      { name: '철 핵', to: 0.53, frac: 0.30, mat: 'iron', colors: ['#6f665e', '#7b7168'] },
      { name: '암석 맨틀', to: 1, frac: 0.70, mat: 'rock', colors: ['#8a6f55', '#957a5f'] },
    ],
    surface: ['#e3c68f', '#d8b77a', '#ecd3a2'],
  },
  {
    id: 'earth', ko: '지구', en: 'Earth', mass: 5.9722e24, radius: 6371.0, rotH: 23.9345,
    layers: [
      { name: '철 핵', to: 0.547, frac: 0.325, mat: 'iron', colors: ['#6f665e', '#7b7168'] },
      { name: '암석 맨틀', to: 1, frac: 0.675, mat: 'rock', colors: ['#7a5a43', '#86634a'] },
    ],
    surface: ['#2f6fd0', '#3b80dd', '#2f6fd0', '#3f8f4a', '#e8eef5'],
  },
  {
    id: 'mars', ko: '화성', en: 'Mars', mass: 6.4171e23, radius: 3389.5, rotH: 24.6229,
    layers: [
      { name: '철 핵', to: 0.54, frac: 0.25, mat: 'iron', colors: ['#6f665e', '#7b7168'] },
      { name: '암석 맨틀', to: 1, frac: 0.75, mat: 'rock', colors: ['#7a4a35', '#85523b'] },
    ],
    surface: ['#c1440e', '#b5501f', '#d0632e'],
  },
  {
    id: 'jupiter', ko: '목성', en: 'Jupiter', mass: 1.89813e27, radius: 69911, rotH: 9.925,
    layers: [
      { name: '암석·얼음 핵', to: 0.15, frac: 0.03, mat: 'rock', colors: ['#6b5a4a'] },
      { name: '금속 수소', to: 0.80, frac: 0.80, mat: 'gas', colors: ['#6e6a72', '#77737b'] },
      { name: '수소·헬륨', to: 1, frac: 0.17, mat: 'gas', colors: ['#d8c2a0', '#c99a6b', '#e8dcc8', '#b07a4e'] },
    ],
  },
  {
    id: 'saturn', ko: '토성', en: 'Saturn', mass: 5.6834e26, radius: 58232, rotH: 10.656,
    layers: [
      { name: '암석·얼음 핵', to: 0.22, frac: 0.15, mat: 'rock', colors: ['#6b5a4a'] },
      { name: '금속 수소', to: 0.55, frac: 0.40, mat: 'gas', colors: ['#7a7468', '#857f72'] },
      { name: '수소·헬륨', to: 1, frac: 0.45, mat: 'gas', colors: ['#e3d3a3', '#d6c08a', '#eadfbf'] },
    ],
  },
  {
    id: 'uranus', ko: '천왕성', en: 'Uranus', mass: 8.6810e25, radius: 25362, rotH: -17.24,
    layers: [
      { name: '암석 핵', to: 0.2, frac: 0.05, mat: 'rock', colors: ['#6b5a4a'] },
      { name: '얼음 맨틀', to: 0.8, frac: 0.85, mat: 'ice', colors: ['#5f8f9a', '#6a9aa5'] },
      { name: '수소·헬륨', to: 1, frac: 0.10, mat: 'gas', colors: ['#a6e0e8', '#9ad7e1', '#b5e8ee'] },
    ],
  },
  {
    id: 'neptune', ko: '해왕성', en: 'Neptune', mass: 1.02413e26, radius: 24622, rotH: 16.11,
    layers: [
      { name: '암석 핵', to: 0.25, frac: 0.07, mat: 'rock', colors: ['#6b5a4a'] },
      { name: '얼음 맨틀', to: 0.85, frac: 0.83, mat: 'ice', colors: ['#3e5f9e', '#46689f'] },
      { name: '수소·헬륨', to: 1, frac: 0.10, mat: 'gas', colors: ['#3f6fe0', '#4b7bea', '#355fcc'] },
    ],
  },
];

import { spreadCoef } from './sim.js';

export const EARTH_MASS = 5.9722e24;
const MAT_INDEX = { iron: 0, rock: 1, ice: 2, gas: 3 };
const BASE_COUNT = 450; // 지구 하나를 이루는 구슬 수

export function searchPlanets(q) {
  q = q.trim().toLowerCase();
  if (!q) return PLANETS;
  return PLANETS.filter((p) => p.ko.includes(q) || p.en.toLowerCase().includes(q) || p.id.includes(q));
}

export function marbleCount(def) {
  return Math.round(BASE_COUNT * Math.pow(def.radius / 6371, 0.35));
}

// 반지름 R 원판을 구슬 N개로 무작위로 채운다.
// 같은 크기 구슬을 줄 맞춰 쌓으면 결정처럼 단단해져 실제 행성(유체에 가까움)보다 잘 안 부서지므로
// 크기가 다른 두 종류 구슬을 섞어 엉성하게 쌓는다.
function packDisk(R, N) {
  const PHI = 0.8; // 원판 면적 중 구슬이 차지하는 비율
  const rel = [];
  let sum = 0;
  for (let i = 0; i < N; i++) { const v = Math.random() < 0.5 ? 1 : 1.3; rel.push(v); sum += v * v; }
  const scale = R * Math.sqrt(PHI / sum);
  const rad = rel.map((v) => v * scale);
  const px = new Float64Array(N), py = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const d = Math.sqrt(Math.random()) * (R - rad[i]), t = Math.random() * 2 * Math.PI;
    px[i] = d * Math.cos(t); py[i] = d * Math.sin(t);
  }
  // 겹친 구슬을 밀어내며 고르게 편다
  const cell = 2 * 1.3 * scale, GS = Math.ceil((2 * R) / cell) + 1;
  const head = new Int32Array(GS * GS), nxt = new Int32Array(N);
  const cellOf = (v) => Math.min(GS - 1, Math.max(0, Math.floor((v + R) / cell)));
  for (let it = 0; it < 120; it++) {
    head.fill(-1);
    for (let i = 0; i < N; i++) { const c = cellOf(py[i]) * GS + cellOf(px[i]); nxt[i] = head[c]; head[c] = i; }
    for (let i = 0; i < N; i++) {
      const cx = cellOf(px[i]), cy = cellOf(py[i]);
      for (let gy = Math.max(0, cy - 1); gy <= Math.min(GS - 1, cy + 1); gy++) {
        for (let gx = Math.max(0, cx - 1); gx <= Math.min(GS - 1, cx + 1); gx++) {
          for (let j = head[gy * GS + gx]; j >= 0; j = nxt[j]) {
            if (j <= i) continue;
            const dx = px[j] - px[i], dy = py[j] - py[i];
            const d = Math.sqrt(dx * dx + dy * dy), rs = rad[i] + rad[j];
            if (d >= rs || d < 1e-9) continue;
            const k = (0.5 * (rs - d)) / d;
            px[i] -= dx * k; py[i] -= dy * k; px[j] += dx * k; py[j] += dy * k;
          }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(px[i], py[i]), lim = R - rad[i];
      if (d > lim) { px[i] *= lim / d; py[i] *= lim / d; }
    }
  }
  const out = [];
  for (let i = 0; i < N; i++) out.push({ x: px[i], y: py[i], r: rad[i] });
  return out;
}

// 행성을 구슬로 쪼개 시뮬레이션에 넣는다. colorId(hex) → 팔레트 번호
export function spawnPlanet(sim, def, cx, cy, vx, vy, name, colorId) {
  const R = def.radius;
  const N = marbleCount(def);
  const org = sim.bodies.length;
  sim.bodies.push({ name, def, mass: def.mass });
  const pts = packDisk(R, N);
  const rmax = pts.reduce((a, p) => Math.max(a, p.r), 0);

  // 재질·색을 정하는 층은 원판(적도 단면)에서의 위치로 정한다
  const L = def.layers;
  const layerOf = (d) => { for (let k = 0; k < L.length; k++) if (d <= L[k].to) return k; return L.length - 1; };
  const parts = pts.map((p) => {
    const d = Math.hypot(p.x, p.y) / R;
    return { ...p, layer: layerOf(d), d };
  });
  // 층의 실제(3차원) 평균 밀도 kg/km³
  const layerRho = L.map((l, k) => {
    const from = k === 0 ? 0 : L[k - 1].to;
    const vol = (4 / 3) * Math.PI * R ** 3 * (l.to ** 3 - from ** 3);
    return (l.frac * def.mass) / vol;
  });
  // 구슬 하나는 그 자리에서 행성을 위아래로 꿰뚫는 기둥을 나타낸다.
  // 기둥이 지나는 층마다 (밀도 × 길이)를 더해 기둥 질량을 정하므로 가운데 구슬일수록, 핵을 지날수록 무겁다.
  const chord = (u, lo, hi) => 2 * (Math.sqrt(Math.max(0, hi * hi - u * u)) - Math.sqrt(Math.max(0, lo * lo - u * u)));
  let total = 0, area = 0;
  for (const p of parts) {
    let colMass = 0, len = 0;
    for (let k = 0; k < L.length; k++) {
      const c = chord(p.d, k === 0 ? 0 : L[k - 1].to, L[k].to);
      colMass += layerRho[k] * c; len += c;
    }
    p.rho = len > 0 ? colMass / len : layerRho[L.length - 1]; // 기둥의 평균 밀도
    p.m = Math.max(colMass, 1e-9) * p.r * p.r;
    total += p.m;
    area += p.r * p.r;
  }
  for (const p of parts) p.m *= def.mass / total;
  const R2 = area / 0.8;
  let s1 = 0, s2 = 0;
  for (const p of parts) { const q = p.x * p.x + p.y * p.y; s1 += p.m * q; s2 += p.m * Math.max(0, R2 - q); }
  const spread = spreadCoef(s1, s2);

  // 자전: 위에서 내려다본 화면 기준 반시계 = 순행
  const w = (2 * Math.PI) / (def.rotH * 3600);
  const surfaceFrom = 1 - 2 * rmax / R;
  for (const p of parts) {
    const layer = L[p.layer];
    const palette = def.surface && p.d >= surfaceFrom ? def.surface : layer.colors;
    const hex = palette[Math.floor(Math.random() * palette.length)];
    sim.add(
      cx + p.x, cy + p.y,
      vx + w * p.y, vy - w * p.x, -w,
      p.m, p.r, p.rho, MAT_INDEX[layer.mat], colorId(hex), org,
      spread * Math.max(0, R2 - p.x * p.x - p.y * p.y),
    );
  }
  return org;
}
