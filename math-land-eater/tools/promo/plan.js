// 홍보 영상용: 호평초 둘레 학교 + 서울 학교들이 땅을 넓힌 모습 (칸 고르기)
const fs = require('fs'), dir = '/home/user/kimjamminGame/docs/play/';
const m = JSON.parse(fs.readFileSync(dir + 'map.json')), b = fs.readFileSync('centers.bin'), n = m.n;
const cx = new Float32Array(b.buffer, b.byteOffset, n), cy = new Float32Array(b.buffer, b.byteOffset + 4 * n, n);
const nk = m.nkSchools || [m.schools.length, m.schools.length], S = m.schools.length;
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const CELL = 600, grid = new Map(); // 칸을 격자에 나눠 담아 가까운 칸을 빨리 찾는다
for (let i = 0; i < n; i++) { const k = Math.floor(cx[i] / CELL) + ',' + Math.floor(cy[i] / CELL); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
const taken = new Set(); for (let i = 0; i < S; i++) taken.add(i); // 학교 본부 칸
function blob(home, K) {
  const hx = cx[home], hy = cy[home], ph = rnd() * 6.28, ph2 = rnd() * 6.28, out = [];
  for (let r = 1; r < 12 && out.length < K * 3; r++) {
    const cand = [];
    const gx = Math.floor(hx / CELL), gy = Math.floor(hy / CELL);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (const i of grid.get((gx + dx) + ',' + (gy + dy)) || []) cand.push(i);
    if (cand.length < K * 3) continue;
    const sc = cand.filter(i => !taken.has(i)).map(i => { const a = Math.atan2(cy[i] - hy, cx[i] - hx), d = Math.hypot(cx[i] - hx, cy[i] - hy); return [i, d * (1 + 0.32 * Math.sin(3 * a + ph) + 0.18 * Math.sin(5 * a + ph2))]; }).sort((x, y) => x[1] - y[1]);
    for (const [i] of sc.slice(0, K)) { out.push(i); taken.add(i); }
    break;
  }
  return out;
}
const idx = (name, sgg) => m.schools.findIndex(s => s[0] === name && s[2] === sgg);
const main = idx('호평초등학교', '남양주시');
const near = m.schools.map((s, i) => [i, Math.hypot(cx[i] - cx[main], cy[i] - cy[main])]).filter(([i]) => i !== main && !(i >= nk[0] && i < nk[1])).sort((x, y) => x[1] - y[1]).slice(0, 13).map(x => x[0]);
const seoul = m.schools.map((s, i) => [i, s]).filter(([i, s]) => s[1] === '서울').map(([i]) => i);
const pick = []; for (let k = 0; k < 34; k++) pick.push(seoul[Math.floor(rnd() * seoul.length)]);
const plan = [{ id: main, cells: blob(main, 170), main: true }];
for (const i of near) plan.push({ id: i, cells: blob(i, 60 + Math.floor(rnd() * 80)) });
for (const i of [...new Set(pick)]) plan.push({ id: i, cells: blob(i, 30 + Math.floor(rnd() * 45)) });
fs.writeFileSync('plan.json', JSON.stringify(plan));
console.log('main', main, m.schools[main], 'schools', plan.length, 'cells', plan.reduce((t, p) => t + p.cells.length, 0));
