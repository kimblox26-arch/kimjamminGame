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

export const EARTH_MASS = 5.9722e24;
const MAT_INDEX = { iron: 0, rock: 1, ice: 2, gas: 3 };

export function searchPlanets(q) {
  q = q.trim().toLowerCase();
  if (!q) return PLANETS;
  return PLANETS.filter((p) => p.ko.includes(q) || p.en.toLowerCase().includes(q) || p.id.includes(q));
}

// 반지름 R 공을 같은 크기 구슬 N개로 무작위로 채운다
function packBall(R, N) {
  const PHI = 0.58; // 공 부피 중 구슬이 차지하는 비율
  const r = R * Math.cbrt(PHI / N);
  const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const d = Math.cbrt(Math.random()) * (R - r);
    const u = Math.random() * 2 - 1, t = Math.random() * 2 * Math.PI, s = Math.sqrt(1 - u * u);
    px[i] = d * s * Math.cos(t); py[i] = d * u; pz[i] = d * s * Math.sin(t);
  }
  // 겹친 구슬을 밀어내며 고르게 편다
  const cell = 2 * r, GS = Math.ceil((2 * R) / cell) + 1;
  const head = new Int32Array(GS * GS * GS), nxt = new Int32Array(N);
  const cellOf = (v) => Math.min(GS - 1, Math.max(0, Math.floor((v + R) / cell)));
  const r2 = 4 * r * r;
  for (let it = 0; it < 80; it++) {
    head.fill(-1);
    for (let i = 0; i < N; i++) {
      const c = (cellOf(pz[i]) * GS + cellOf(py[i])) * GS + cellOf(px[i]);
      nxt[i] = head[c]; head[c] = i;
    }
    for (let i = 0; i < N; i++) {
      const cx = cellOf(px[i]), cy = cellOf(py[i]), cz = cellOf(pz[i]);
      for (let gz = Math.max(0, cz - 1); gz <= Math.min(GS - 1, cz + 1); gz++) {
        for (let gy = Math.max(0, cy - 1); gy <= Math.min(GS - 1, cy + 1); gy++) {
          for (let gx = Math.max(0, cx - 1); gx <= Math.min(GS - 1, cx + 1); gx++) {
            for (let j = head[(gz * GS + gy) * GS + gx]; j >= 0; j = nxt[j]) {
              if (j <= i) continue;
              const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= r2 || d2 < 1e-18) continue;
              const d = Math.sqrt(d2), k = (0.5 * (2 * r - d)) / d;
              px[i] -= dx * k; py[i] -= dy * k; pz[i] -= dz * k;
              px[j] += dx * k; py[j] += dy * k; pz[j] += dz * k;
            }
          }
        }
      }
    }
    for (let i = 0; i < N; i++) {
      const d = Math.sqrt(px[i] * px[i] + py[i] * py[i] + pz[i] * pz[i]), lim = R - r;
      if (d > lim) { const f = lim / d; px[i] *= f; py[i] *= f; pz[i] *= f; }
    }
  }
  const out = [];
  for (let i = 0; i < N; i++) out.push({ x: px[i], y: py[i], z: pz[i] });
  return { r, pts: out };
}

// 행성을 같은 크기 구슬 count 개로 만들어 시뮬레이션에 넣는다. colorId(hex) → 팔레트 번호
// 위쪽(+y)이 북쪽, 자전축은 y축
export function spawnPlanet(sim, def, count, cx, cy, cz, vx, vy, vz, name, colorId) {
  const R = def.radius;
  const org = sim.bodies.length;
  sim.bodies.push({ name, def, mass: def.mass });
  const { r, pts } = packBall(R, count);

  // 층의 실제 평균 밀도 kg/km³
  const L = def.layers;
  const layerRho = L.map((l, k) => {
    const from = k === 0 ? 0 : L[k - 1].to;
    const vol = (4 / 3) * Math.PI * R ** 3 * (l.to ** 3 - from ** 3);
    return (l.frac * def.mass) / vol;
  });
  // 구슬이 놓인 층의 밀도로 질량을 정하고, 전체가 행성 질량이 되게 맞춘다
  const layerOf = (d) => { for (let k = 0; k < L.length; k++) if (d <= L[k].to) return k; return L.length - 1; };
  let total = 0;
  for (const p of pts) {
    p.d = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) / R;
    p.layer = layerOf(p.d);
    p.m = layerRho[p.layer];
    total += p.m;
  }

  const w = (2 * Math.PI) / (def.rotH * 3600); // 음수면 역행 자전
  const surfaceFrom = 1 - 2 * r / R;
  for (const p of pts) {
    const layer = L[p.layer];
    const palette = def.surface && p.d >= surfaceFrom ? def.surface : layer.colors;
    const hex = palette[Math.floor(Math.random() * palette.length)];
    sim.add(
      cx + p.x, cy + p.y, cz + p.z,
      vx + w * p.z, vy, vz - w * p.x,
      0, w, 0,
      (p.m * def.mass) / total, r, layerRho[p.layer], MAT_INDEX[layer.mat], colorId(hex), org,
    );
  }
  return org;
}
