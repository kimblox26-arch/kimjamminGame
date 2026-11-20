// 시뮬레이션 사진으로 인식 정확도 측정. 사용: node run-test.mjs <프레임폴더>
import fs from 'node:fs';
import sharp from 'sharp';
import { makeQueries } from '../../js/scan.js';
import { bestMatches } from '../../js/hash.js';
const dir = process.argv[2];
const L = JSON.parse(fs.readFileSync(`${dir}/labels.json`, 'utf8'));
const data = '../../data';
const meta = JSON.parse(fs.readFileSync(new URL(`${data}/cards.json`, import.meta.url)));
const db = new Uint32Array(fs.readFileSync(new URL(`${data}/hashes.bin`, import.meta.url)).buffer.slice(0));
const ids = meta.cards.map(c => c[0]);
const [gx0, gy0, gx1, gy1] = L.guide;
const pos = [], neg = [];
let top1 = 0, top3 = 0, edges = 0, ms = 0;
for (const f of L.frames) {
  const { data: px, info } = await sharp(`${dir}/${f.file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const t = performance.now();
  const { queries, edge } = makeQueries(px, info.width, info.height, { x0: gx0, y0: gy0, x1: gx1, y1: gy1 });
  const top = bestMatches(db, queries, 5);
  ms += performance.now() - t;
  if (!f.id) { neg.push(top[0].score); continue; }
  if (edge) edges++;
  const rank = top.findIndex(x => ids[x.index] === f.id);
  // 같은 그림(재판)도 정답 취급: 정답 카드 지문과의 거리 <= 4
  const ti = ids.indexOf(f.id);
  const same = i => { let d = 0; for (let k = 0; k < 4; k++) { let v = db[i * 4 + k] ^ db[ti * 4 + k]; while (v) { d += v & 1; v >>>= 1; } } return d <= 4; };
  const ok1 = rank === 0 || same(top[0].index);
  if (ok1) top1++;
  if (ok1 || (rank >= 0 && rank < 3)) top3++;
  pos.push({ score: top[0].score, ok: ok1, trueScore: rank >= 0 ? top[rank].score : null });
  if (!ok1 && process.env.SHOW) { const a = meta.cards[ti], b = meta.cards[top[0].index]; console.log('틀림', f.file, a[1], a[3], '→', b[1], b[3], top[0].score, 'rank', rank); }
}
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
const okS = pos.filter(p => p.ok).map(p => p.score);
const badS = pos.filter(p => !p.ok).map(p => p.score);
console.log(`정답률 top1 ${(100 * top1 / pos.length).toFixed(1)}%  top3 ${(100 * top3 / pos.length).toFixed(1)}%  (n=${pos.length}, 테두리검출 ${edges})`);
console.log('맞춘 점수 50/90/max', q(okS, .5), q(okS, .9), Math.max(...okS));
if (badS.length) console.log('틀린 점수 min/50', Math.min(...badS), q(badS, .5));
console.log('카드없음 점수 min/10/50', Math.min(...neg), q(neg, .1), q(neg, .5));
console.log('평균 처리시간', (ms / L.frames.length).toFixed(1), 'ms');
for (const T of [26, 30, 34, 38, 42]) {
  const acc = pos.filter(p => p.ok && p.score <= T).length, wrong = pos.filter(p => !p.ok && p.score <= T).length;
  console.log(`기준 ${T}: 인식 ${acc}/${pos.length}, 오인식 ${wrong}, 카드없는데 인식 ${neg.filter(s => s <= T).length}/${neg.length}`);
}
