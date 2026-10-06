// 자재 카탈로그 — 실제 규격(KS) 기반 치수와 재질
import { MATS } from '../gfx/materials.js';

export const CATS = [
  { id: 'steel', name: '철강재' }, { id: 'wood', name: '목재' }, { id: 'stone', name: '석재 · 유리' },
  { id: 'mech', name: '기계 부품' }, { id: 'kit', name: '완성 예제' },
];

// dims: [X, Y, Z] m. 기본 배치 시 로컬 +Y 가 접촉면 법선 방향.
// resize: 축별 [최소, 최대] (m) — 카탈로그에서 재단 크기 조절
export const CATALOG = [
  // ── 철강 ──
  { id: 'plate5', cat: 'steel', name: '흑피 철판 5T', spec: 'SS400 · 열간압연', shape: 'box', mat: 'steel', skin: 'millscale', dims: [1.0, 0.005, 1.0], resize: { 0: [0.05, 3], 2: [0.05, 3], 1: [0.002, 0.03] } },
  { id: 'plate3', cat: 'steel', name: '냉연 강판 3T', spec: 'SPCC · 헤어라인', shape: 'box', mat: 'steel', skin: 'brushed', dims: [1.2, 0.003, 0.6], resize: { 0: [0.05, 3], 2: [0.05, 3], 1: [0.001, 0.02] } },
  { id: 'plate12', cat: 'steel', name: '후판 12T', spec: 'SS400 · 베이스 플레이트', shape: 'box', mat: 'steel', skin: 'millscale', dims: [0.4, 0.012, 0.4], resize: { 0: [0.05, 2], 2: [0.05, 2], 1: [0.008, 0.05] } },
  { id: 'checker', cat: 'steel', name: '체크 플레이트 4.5T', spec: '미끄럼 방지 무늬강판', shape: 'box', mat: 'steel', skin: 'checker', dims: [1.0, 0.0045, 1.0], resize: { 0: [0.05, 3], 2: [0.05, 3] } },
  { id: 'rust', cat: 'steel', name: '녹슨 철판 6T', spec: '고철 · 부식', shape: 'box', mat: 'steel', skin: 'rust', dims: [1.0, 0.006, 0.8], resize: { 0: [0.05, 3], 2: [0.05, 3] } },
  { id: 'sqtube', cat: 'steel', name: '각관 50×50', spec: 'STKR400 · t2.3 · 아연도', shape: 'sqtube', mat: 'steel', skin: 'galv', dims: [2.0, 0.05, 0.05], wall: 0.0023, resize: { 0: [0.05, 6] } },
  { id: 'rtube', cat: 'steel', name: '각관 100×50', spec: 'STKR400 · t3.2', shape: 'sqtube', mat: 'steel', skin: 'millscale', dims: [2.0, 0.1, 0.05], wall: 0.0032, resize: { 0: [0.05, 6] } },
  { id: 'hbeam', cat: 'steel', name: 'H빔 150×150', spec: 'SS275 · 7/10 · 31.1kg/m', shape: 'hbeam', mat: 'steel', skin: 'millscale', dims: [3.0, 0.15, 0.15], tw: 0.007, tf: 0.01, resize: { 0: [0.1, 8] } },
  { id: 'angle', cat: 'steel', name: 'ㄱ형강 50×50', spec: 'SS275 · t6', shape: 'angle', mat: 'steel', skin: 'millscale', dims: [2.0, 0.05, 0.05], wall: 0.006, resize: { 0: [0.05, 6] } },
  { id: 'pipe', cat: 'steel', name: '강관 Ø60.5', spec: 'SPP · t3.2', shape: 'pipe', mat: 'steel', skin: 'galv', dims: [2.0, 0.0605, 0.0605], wall: 0.0032, resize: { 0: [0.05, 6] } },
  { id: 'flat', cat: 'steel', name: '평철 50×9', spec: 'SS400', shape: 'box', mat: 'steel', skin: 'millscale', dims: [1.5, 0.009, 0.05], resize: { 0: [0.05, 6] } },
  { id: 'alplate', cat: 'steel', name: '알루미늄 판 3T', spec: 'A6061-T6', shape: 'box', mat: 'alu', skin: 'alu', dims: [1.0, 0.003, 1.0], resize: { 0: [0.05, 3], 2: [0.05, 3], 1: [0.001, 0.02] } },
  // ── 목재 ──
  { id: '2x4', cat: 'wood', name: '구조목 2×4', spec: 'SPF · 38×89 mm', shape: 'box', mat: 'wood', skin: 'pine', dims: [2.4, 0.038, 0.089], grain: 0, resize: { 0: [0.05, 4.8] } },
  { id: '2x6', cat: 'wood', name: '구조목 2×6', spec: 'SPF · 38×140 mm', shape: 'box', mat: 'wood', skin: 'pine', dims: [3.0, 0.038, 0.14], grain: 0, resize: { 0: [0.05, 4.8] } },
  { id: 'post', cat: 'wood', name: '각재 90×90', spec: '육송 기둥재', shape: 'box', mat: 'wood', skin: 'pine', dims: [2.4, 0.09, 0.09], grain: 0, resize: { 0: [0.05, 4.8] } },
  { id: 'plank', cat: 'wood', name: '판재 18×140', spec: '루바 · 데크재', shape: 'box', mat: 'wood', skin: 'pine', dims: [1.8, 0.018, 0.14], grain: 0, resize: { 0: [0.05, 3.6] } },
  { id: 'plywood', cat: 'wood', name: '구조용 합판 18T', spec: '1220×2440', shape: 'box', mat: 'plywood', skin: 'plywood', dims: [2.44, 0.018, 1.22], grain: 0, resize: { 0: [0.05, 2.44], 2: [0.05, 1.22], 1: [0.009, 0.024] } },
  // ── 석재 · 유리 ──
  { id: 'brick', cat: 'stone', name: '적벽돌', spec: 'KS 190×90×57', shape: 'box', mat: 'brick', skin: 'brick', dims: [0.19, 0.057, 0.09], bevel: 0.003 },
  { id: 'block', cat: 'stone', name: '콘크리트 블록', spec: '390×190×190 · 중공', shape: 'box', mat: 'concrete', skin: 'block', dims: [0.39, 0.19, 0.19], fill: 0.55, bevel: 0.004 },
  { id: 'slab', cat: 'stone', name: '콘크리트 판', spec: '프리캐스트 · 100T', shape: 'box', mat: 'concrete', skin: 'block', dims: [1.0, 0.1, 1.0], bevel: 0.006, resize: { 0: [0.2, 3], 2: [0.2, 3] } },
  { id: 'glass', cat: 'stone', name: '판유리 6T', spec: '투명 플로트 유리', shape: 'box', mat: 'glass', skin: 'glass', dims: [1.0, 0.006, 1.0], resize: { 0: [0.1, 2.5], 2: [0.1, 2.5] } },
  // ── 기계 ──
  { id: 'wheelS', cat: 'mech', name: '바퀴 Ø300', spec: '고카트용 · 슬릭', mech: 'wheel', mat: 'rubber', r: 0.15, w: 0.14, susp: 0.05, mass: 6, dims: [0.14, 0.3, 0.3], attach: 0 },
  { id: 'wheelM', cat: 'mech', name: '바퀴 Ø650', spec: '승용 · 205/55R16', mech: 'wheel', mat: 'rubber', r: 0.325, w: 0.21, susp: 0.16, mass: 18, dims: [0.21, 0.65, 0.65], attach: 0 },
  { id: 'wheelL', cat: 'mech', name: '바퀴 Ø1000', spec: '오프로드 · 35인치', mech: 'wheel', mat: 'rubber', r: 0.5, w: 0.32, susp: 0.3, mass: 42, dims: [0.32, 1.0, 1.0], attach: 0 },
  { id: 'engS', cat: 'mech', name: '단기통 엔진', spec: '212cc · 5 kW', mech: 'engine', kind: 'single', power: 5000, mass: 17, mat: 'machine', dims: [0.36, 0.34, 0.36], cols: [{ t: 'box', h: [0.15, 0.15, 0.15], p: [0, 0, 0] }] },
  { id: 'engM', cat: 'mech', name: '전기 모터', spec: '80 kW · 영구자석', mech: 'engine', kind: 'motor', power: 80000, mass: 45, mat: 'machine', dims: [0.4, 0.36, 0.36], cols: [{ t: 'box', h: [0.18, 0.17, 0.17], p: [0, 0, 0] }], torqueBoost: 1.6 },
  { id: 'engV8', cat: 'mech', name: 'V8 엔진', spec: '5.0L · 300 kW', mech: 'engine', kind: 'v8', power: 300000, mass: 210, mat: 'machine', dims: [0.8, 0.75, 0.75], cols: [{ t: 'box', h: [0.25, 0.25, 0.33], p: [0, -0.1, 0] }, { t: 'box', h: [0.38, 0.14, 0.3], p: [0, 0.14, 0] }] },
  { id: 'seat', cat: 'mech', name: '운전석 + 핸들', spec: 'E 키로 탑승', mech: 'seat', mass: 22, mat: 'machine', dims: [0.5, 0.5, 0.75], cols: [{ t: 'box', h: [0.24, 0.06, 0.24], p: [0, -0.18, 0.02] }, { t: 'box', h: [0.23, 0.3, 0.05], p: [0, 0.14, 0.24] }] },
  { id: 'light', cat: 'mech', name: '헤드라이트', spec: 'LED 3000 lm', mech: 'light', mass: 2.5, mat: 'machine', dims: [0.18, 0.18, 0.14], attach: 2, cols: [{ t: 'box', h: [0.08, 0.08, 0.06], p: [0, 0, 0] }] },
  { id: 'thruster', cat: 'mech', name: '로켓 추진기', spec: '추력 12 kN · Shift', mech: 'thruster', thrust: 12000, mass: 60, mat: 'machine', dims: [0.34, 0.34, 0.6], attach: 2, cols: [{ t: 'box', h: [0.15, 0.15, 0.28], p: [0, 0, 0] }] },
  { id: 'ballast', cat: 'mech', name: '납 무게추 50 kg', spec: '무게중심 조절용', shape: 'box', mat: 'steel', skin: 'cast', dims: [0.2, 0.11, 0.2], massOverride: 50 },
  // ── 완성 예제 ──
  { id: 'kit-kart', cat: 'kit', name: '고카트', spec: '각관 프레임 · 5 kW', kit: 'kart' },
  { id: 'kit-buggy', cat: 'kit', name: '오프로드 버기', spec: 'H빔+각관 · V8 300 kW', kit: 'buggy' },
  { id: 'kit-shed', cat: 'kit', name: '목조 창고 골조', spec: '2×4 스터드 · 못 접합', kit: 'shed' },
  { id: 'kit-wall', cat: 'kit', name: '벽돌 벽', spec: '모르타르 쌓기 · 충돌 시험용', kit: 'wall' },
  { id: 'kit-tower', cat: 'kit', name: '철골 탑', spec: '각관 트러스 · 용접', kit: 'tower' },
];
export const CAT_BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));

// 실제 질량 계산 (kg)
export function partMass(def, dims) {
  if (def.mass) return def.mass;
  if (def.massOverride) return def.massOverride;
  const [X, Y, Z] = dims, rho = MATS[def.mat].density, t = def.wall || 0;
  let vol;
  switch (def.shape) {
    case 'sqtube': vol = X * (Y * Z - (Y - 2 * t) * (Z - 2 * t)); break;
    case 'hbeam': vol = X * (2 * def.tf * Z + (Y - 2 * def.tf) * def.tw); break;
    case 'angle': vol = X * (t * Z + (Y - t) * t); break;
    case 'pipe': { const r = Y / 2; vol = X * Math.PI * (r * r - (r - t) * (r - t)); break; }
    default: vol = X * Y * Z * (def.fill || 1);
  }
  return vol * rho;
}
// 절단 가능한 축 (보/관류는 길이 방향만)
export function cuttableAxes(def) {
  if (def.mech || def.kit) return [];
  if (def.shape === 'box') return [0, 1, 2];
  return [0];
}
