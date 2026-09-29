// 인물/장비용 절차적 텍스처: 멀티캠, 천 주름, 피부 모공, 머리카락 가닥, 코듀라+MOLLE, 장갑, 가죽
import { T, gen, fbm, fbm2, noise, cell } from './textures.js';

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const tick = () => new Promise((r) => setTimeout(r, 0));

export async function buildTextures2(progress = () => {}) {
  const jobs = [
    // 멀티캠 위장 (부드러운 경계의 다층 얼룩 + 립스탑 격자)
    ['multicam', () => gen(512, (u, v, o) => {
      const w1 = fbm(u + fbm(u, v, 3, 2) * 0.15, v, 4, 4), w2 = fbm(u + 3.1, v + 7.2, 6, 4), w3 = fbm(u + 8.3, v + 1.1, 9, 3), w4 = fbm(u + 5.5, v + 4.4, 14, 3);
      let c = [0.6, 0.53, 0.4];
      const lay = (col, m) => { c = [mix(c[0], col[0], m), mix(c[1], col[1], m), mix(c[2], col[2], m)]; };
      lay([0.73, 0.67, 0.53], sstep(0.5, 0.56, w1));
      lay([0.4, 0.41, 0.27], sstep(0.55, 0.6, w2));
      lay([0.46, 0.35, 0.24], sstep(0.58, 0.62, w3));
      lay([0.27, 0.21, 0.15], sstep(0.66, 0.69, w4));
      lay([0.82, 0.78, 0.64], sstep(0.7, 0.72, fbm(u + 2.2, v + 9.9, 18, 2)));
      const gx = (u * 64) % 1, gy = (v * 64) % 1, rip = (gx < 0.08 || gy < 0.08) ? 1 : 0;
      const weave = (Math.sin(u * Math.PI * 2 * 256) * Math.sin(v * Math.PI * 2 * 256)) * 0.5 + 0.5;
      const k = 0.97 + weave * 0.02 - rip * 0.015 + (fbm(u, v, 40, 2) - 0.5) * 0.08;
      o.r = sat(c[0] * k); o.g = sat(c[1] * k); o.b = sat(c[2] * k);
      o.h = rip * 0.5 + weave * 0.3; o.ro = 0.92;
    }, { normal: 1.5 })],
    // 천 주름 노멀 (방향성 능선 + 립스탑)
    ['clothN', () => gen(512, (u, v, o) => {
      let h = 0;
      const dirs = [[1, 0.25], [0.3, 1], [-0.6, 0.8]];
      dirs.forEach(([a, b], i) => {
        const warp = fbm(u + i * 3.3, v + i * 1.7, 3, 3) * 2.0;
        const p = (u * a + v * b) * (5 + i * 2) + warp;
        const ridge = Math.pow(1 - Math.abs(Math.sin(p * Math.PI)), 3);
        const m = sstep(0.4, 0.7, fbm(u + 9.1 * i, v + 2.3 * i, 3, 3));
        h += ridge * m * (0.8 - i * 0.2);
      });
      const gx = (u * 64) % 1, gy = (v * 64) % 1, rip = (gx < 0.07 || gy < 0.07) ? 1 : 0;
      const weave = (Math.sin(u * Math.PI * 2 * 256) * Math.sin(v * Math.PI * 2 * 256)) * 0.5 + 0.5;
      o.h = h * 1.2 + rip * 0.03 + weave * 0.03; rgb(o, 1, 1, 1, 0.9 + h * 0.1); o.ro = 0.9 - h * 0.05;
    }, { normal: 3, srgb: false })],
    // 피부 모공/잔주름
    ['skinN', () => gen(512, (u, v, o) => {
      const pore = sstep(0.2, 0.05, cell(u, v, 96)), fine = fbm(u, v, 64, 3), wr = Math.pow(1 - Math.abs(Math.sin((u * 3 + v * 40 + fbm(u, v, 8, 2) * 3) * Math.PI)), 6) * 0.3;
      const blot = fbm(u, v, 6, 4);
      o.h = -pore * 0.6 + fine * 0.35 - wr; rgb(o, 1, 1, 1, 0.93 + blot * 0.1 - pore * 0.05); o.ro = 0.45 + fine * 0.2 + pore * 0.15;
    }, { normal: 1.2, srgb: true })],
    // 머리카락 가닥 (알파)
    ['hair', () => gen(256, (u, v, o) => {
      let a = 0;
      for (let s = 0; s < 22; s++) {
        const x0 = (s + 0.5) / 22 + (noise(s * 3.7, 1.2) - 0.5) * 0.05;
        const x = x0 + Math.sin(v * 9 + s) * 0.01 + (noise(s, v * 6) - 0.5) * 0.02;
        const w = 0.012 * (1 - v * 0.7) * (0.6 + noise(s * 1.3, 7) * 0.8);
        const tipEnd = 0.75 + noise(s * 5.1, 3) * 0.25;
        a = Math.max(a, sstep(w, w * 0.3, Math.abs(u - x)) * (v < tipEnd ? 1 : 0));
      }
      const k = 0.8 + noise(u * 40, 3) * 0.3;
      o.r = k; o.g = k; o.b = k; o.a = sat(a) * sstep(0.0, 0.05, v);
    }, { normal: 0, rough: false, repeat: false })],
    // 코듀라 + MOLLE 웨빙
    ['cordura', () => gen(512, (u, v, o) => {
      const weave = (Math.sin(u * Math.PI * 2 * 180) * 0.5 + 0.5) * (Math.sin(v * Math.PI * 2 * 180) * 0.5 + 0.5);
      const rowV = (v * 10) % 1, band = rowV > 0.1 && rowV < 0.5 ? 1 : 0;
      const colU = (u * 6) % 1, tack = band && (colU < 0.04 || colU > 0.96) ? 1 : 0;
      const stitch = band && (Math.abs(rowV - 0.13) < 0.012 || Math.abs(rowV - 0.47) < 0.012) && Math.sin(u * 400) > 0 ? 1 : 0;
      const dirt = fbm(u, v, 5, 4);
      const k = 0.88 + weave * 0.08 + band * 0.04 - stitch * 0.06 - tack * 0.05 - dirt * 0.12;
      rgb(o, 1, 1, 1, k); o.h = band * 0.45 + weave * 0.12 - stitch * 0.15 + tack * 0.08; o.ro = 0.9;
    }, { normal: 2.5 })],
    // 장갑 (합성가죽 + 봉제선)
    ['glove', () => gen(512, (u, v, o) => {
      const c = cell(u, v, 60), grain = sstep(0.05, 0.25, c), n = fbm(u, v, 8, 4);
      const seam = Math.abs(((u * 4 + fbm(u, v, 3, 2) * 0.3) % 1) - 0.5) < 0.012 ? 1 : 0;
      const st = seam && Math.sin(v * 500) > 0.3 ? 1 : 0;
      const crease = Math.pow(1 - Math.abs(Math.sin((v * 30 + fbm(u, v, 5, 3) * 4) * Math.PI)), 8) * sstep(0.45, 0.7, fbm(u + 3, v, 4, 3));
      rgb(o, 1, 1, 1, 0.85 + n * 0.15 - seam * 0.15 + st * 0.2 - crease * 0.15); o.h = grain * 0.35 - seam * 0.6 + st * 0.3 - crease * 0.8; o.ro = 0.7 - crease * 0.1 + n * 0.1;
    }, { normal: 2.5 })],
    // 부츠 가죽
    ['bootL', () => gen(256, (u, v, o) => {
      const c = cell(u, v, 40), n = fbm(u, v, 6, 4), sc = sstep(0.85, 0.95, fbm(u * 3, v, 10, 3));
      rgb(o, 1, 1, 1, 0.8 + n * 0.2 + sc * 0.2); o.h = sstep(0.05, 0.3, c) * 0.4 - sc * 0.3; o.ro = 0.6 + n * 0.2 - sc * 0.2;
    }, { normal: 2 })],
  ];
  for (let i = 0; i < jobs.length; i++) {
    T[jobs[i][0]] = jobs[i][1]();
    progress((i + 1) / jobs.length, jobs[i][0]);
    await tick();
  }
}
function rgb(o, r, g, b, k = 1) { o.r = sat(r * k); o.g = sat(g * k); o.b = sat(b * k); }
