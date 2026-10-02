'use strict';
// 매뜨 땅먹 SNS(틱톡·유튜브) 프로필 이미지 만들기: 육각형 한반도 + 로고 (Playwright 필요)
//   node tools/make-branding.js  →  branding/profile-logo.png, profile-map.png, youtube-banner.png
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const path = require('path'), ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'branding'); // 먼저 node tools/build-static.js 로 dist/static/map.json 을 만든다
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/static/map.json'), 'utf8'));
const land = m.land.map(e => { const o = []; let x = 0, y = 0; for (let k = 0; k < e.length; k += 2) { x += e[k]; y += e[k + 1]; o.push(x, y); } return o; });
const PAGE = (w, h, body) => `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Jua&display=swap" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}body{width:${w}px;height:${h}px;overflow:hidden;font-family:Jua,sans-serif}
#c{position:absolute;inset:0}.t{position:absolute;color:#fff;text-align:center;-webkit-text-stroke:var(--sw,14px) #17508a;paint-order:stroke fill;text-shadow:0 10px 0 #0f3d6b,0 18px 34px rgba(0,0,0,.3)}.y{color:#ffd23f}
.sym{position:absolute;width:var(--s);height:var(--s);border-radius:28%;display:flex;align-items:center;justify-content:center;font-size:calc(var(--s) * .62);color:#fff;background:var(--c);box-shadow:0 10px 0 rgba(0,0,0,.15),0 18px 30px rgba(0,40,90,.25);transform:rotate(var(--r))}
</style></head><body><canvas id="c" width="${w}" height="${h}"></canvas>${body}</body></html>`;
// 캔버스에 바다 + 육각형 한반도 (학교 색 땅따먹기)
function drawScene(opts) {
  const { land, w, h, map, hexR, seed, bg } = opts, cv = document.getElementById('c'), g = cv.getContext('2d');
  let s0 = seed; const rnd = () => { s0 = (s0 * 1664525 + 1013904223) >>> 0; return s0 / 4294967296; };
  const gr = g.createRadialGradient(w * bg[0], h * bg[1], 0, w * bg[0], h * bg[1], Math.max(w, h) * 0.85);
  gr.addColorStop(0, '#9be0ff'); gr.addColorStop(0.45, '#4fb0ea'); gr.addColorStop(1, '#1f6fb5');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  if (!map) return;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of land) for (let k = 0; k < r.length; k += 2) { box[0] = Math.min(box[0], r[k]); box[1] = Math.min(box[1], r[k + 1]); box[2] = Math.max(box[2], r[k]); box[3] = Math.max(box[3], r[k + 1]); }
  const sc = Math.min(map.w / (box[2] - box[0]), map.h / (box[3] - box[1])), ox = map.x + (map.w - (box[2] - box[0]) * sc) / 2 - box[0] * sc, oy = map.y + (map.h - (box[3] - box[1]) * sc) / 2 - box[1] * sc;
  const path = new Path2D();
  for (const r of land) { path.moveTo(r[0] * sc + ox, r[1] * sc + oy); for (let k = 2; k < r.length; k += 2) path.lineTo(r[k] * sc + ox, r[k + 1] * sc + oy); path.closePath(); }
  g.save(); g.shadowColor = 'rgba(0,40,90,.35)'; g.shadowBlur = hexR * 4; g.shadowOffsetY = hexR * 1.2; g.fillStyle = '#5b6b7d'; g.fill(path); g.restore(); // 반투명 하얀 테두리 없이
  const R = hexR, dx = Math.sqrt(3) * R, dy = 1.5 * R, hx = [], at = new Map();
  for (let row = 0, y = map.y; y < map.y + map.h + R; row++, y += dy) for (let col = 0, x = map.x + (row % 2 ? dx / 2 : 0); x < map.x + map.w + R; col++, x += dx) if (g.isPointInPath(path, x, y)) { at.set(row + ',' + col, hx.length); hx.push({ x, y, row, col, nb: [] }); }
  const odd = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]], even = [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
  for (const q of hx) for (const [r, c] of (q.row % 2 ? odd : even)) { const j = at.get((q.row + r) + ',' + (q.col + c)); if (j !== undefined) q.nb.push(j); }
  const COLORS = ['#ff6b6b', '#ffb020', '#3ec46d', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#6366f1'];
  const owner = new Int8Array(hx.length).fill(-1), fronts = [], seeds = [];
  for (let i = 0; i < 9; i++) { const k = Math.floor(rnd() * hx.length); if (owner[k] < 0) { owner[k] = i; fronts.push([k]); seeds.push(k); } }
  const fill = 1; let taken = seeds.length;
  while (taken < hx.length * fill) { let any = false; fronts.forEach((f, s) => { for (let t = 0; t < 6 && f.length; t++) { const i = Math.floor(rnd() * f.length), free = hx[f[i]].nb.filter(j => owner[j] < 0); if (!free.length) { f.splice(i, 1); continue; } const j = free[Math.floor(rnd() * free.length)]; owner[j] = s; f.push(j); taken++; any = true; break; } }); if (!any) break; }
  // 섬처럼 이어지지 않은 칸까지 모두 가장 가까운 학교 색으로 (알록달록하게)
  for (let i = 0; i < hx.length; i++) if (owner[i] < 0) { let best = 0, bd = Infinity; seeds.forEach((k, s) => { const d = (hx[k].x - hx[i].x) ** 2 + (hx[k].y - hx[i].y) ** 2; if (d < bd) { bd = d; best = s; } }); owner[i] = best; }
  for (let i = 0; i < hx.length; i++) {
    const q = hx[i]; g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(q.x + R * 0.95 * Math.cos(a), q.y + R * 0.95 * Math.sin(a)); } g.closePath();
    g.fillStyle = owner[i] >= 0 ? COLORS[owner[i] % COLORS.length] : '#cfd5dd'; g.fill(); g.lineWidth = Math.max(1, R * 0.14); g.strokeStyle = 'rgba(255,255,255,.9)'; g.stroke();
  }
  g.lineWidth = Math.max(1.2, R * 0.2); g.strokeStyle = 'rgba(30,80,120,.45)'; g.stroke(path);
  for (const k of seeds) { const q = hx[k]; g.beginPath(); g.arc(q.x, q.y, R * 0.75, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = R * 0.3; g.strokeStyle = COLORS[owner[k] % COLORS.length]; g.stroke(); }
  if (opts.wash) { g.fillStyle = `rgba(60,150,220,${opts.wash})`; g.fillRect(0, 0, w, h); } // 글자가 잘 보이게 지도를 살짝 흐리게
}
(async () => {
  const b = await chromium.launch();
  const make = async (name, w, h, body, opts) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(PAGE(w, h, body), { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.load('100px Jua', '매뜨 땅먹 수학문제풀고땅먹고우리학교1등초등땅따먹기게임!+−×÷=?'));
    await p.evaluate(() => document.fonts.ready);
    console.log('Jua loaded:', await p.evaluate(() => document.fonts.check('100px Jua', '매뜨')));
    await p.evaluate(`(${drawScene})(${JSON.stringify(Object.assign({ land, w, h }, opts))})`);
    await p.screenshot({ path: `${OUT}/${name}`, clip: { x: 0, y: 0, width: w, height: h } });
    await p.close(); console.log('made', name);
  };
  // 1) 프로필 사진 A: 글자 (원으로 잘려도 잘 보이게 가운데에 크게)
  await make('profile-logo.png', 1080, 1080, `<div class="t" style="left:0;right:0;top:215px;font-size:300px;line-height:1.02;--sw:22px">매뜨<br><span class="y">땅먹</span></div>`,
    { map: { x: 90, y: 90, w: 900, h: 900 }, hexR: 15, seed: 7, bg: [0.5, 0.2] });
  // 2) 프로필 사진 B: 육각형 한반도 지도 + 작은 로고
  await make('profile-map.png', 1080, 1080, `<div class="t" style="left:0;right:0;bottom:60px;font-size:130px;--sw:12px">매뜨 <span class="y">땅먹</span></div>`,
    { map: { x: 200, y: 70, w: 680, h: 780 }, hexR: 12, seed: 3, bg: [0.5, 0.15], fill: 0.86 });
  // 3) 유튜브 배너 2560x1440 (모든 기기에 보이는 가운데 1546x423 안에 글자)
  const syms = [['+', 230, 300, 170, '#ff6b6b', -12], ['×', 470, 560, 140, '#ffb020', 10], ['÷', 190, 820, 150, '#3ec46d', 8], ['−', 520, 1020, 120, '#a855f7', -8], ['=', 330, 1180, 110, '#3b82f6', 14], ['?', 640, 260, 110, '#ec4899', 6]]
    .map(([t, x, y, sz, c, r]) => `<div class="sym" style="left:${x}px;top:${y}px;--s:${sz}px;--c:${c};--r:${r}deg">${t}</div>`).join('');
  await make('youtube-banner.png', 2560, 1440, `${syms}<div class="t" style="left:0;right:0;top:520px;font-size:190px;line-height:1;--sw:16px">매뜨 <span class="y">땅먹</span></div>
    <div class="t" style="left:0;right:0;top:745px;font-size:62px;--sw:8px;text-shadow:0 5px 0 #0f3d6b">수학 문제 풀고 · 땅 먹고 · 우리 학교 1등!</div>`,
    { map: { x: 1880, y: 120, w: 620, h: 1200 }, hexR: 14, seed: 11, bg: [0.5, 0.3], fill: 0.8 });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
