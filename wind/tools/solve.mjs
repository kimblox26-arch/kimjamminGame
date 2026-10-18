// 후보 풀이를 병렬로 시험: node tools/solve.mjs <레벨id> <후보.json>
// 후보.json: [{ "name": "...", "level": {덮어쓸 필드}, "strokes": [[pts, power], ...] }, ...]
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { Sim, makeStroke } from '../src/sim.js';
import { LEVELS } from '../src/levels.js';

function run(level, strokes, warm = 1.5, dx = 0, dy = 0) {
  const s = new Sim(); s.load(level);
  s.setStrokes(strokes.map(([p, k]) => makeStroke(p.map(([x, y]) => [x + dx, y + dy]), k || 'soft')));
  for (let t = 0; t < warm; t += 1 / 60) s.step();
  s.launch();
  let t = 0; const path = [];
  while (s.phase === 'fly' && t < (level.limit ?? 70) + 2) {
    s.step(); t += 1 / 60;
    if (Math.round(t * 60) % 60 === 0) { const f = s.flyers.find((q) => q.state === 'fly') || s.flyers[0]; path.push(`${f.x.toFixed(0)},${f.y.toFixed(0)}`); }
  }
  const counts = {}; for (const f of s.flyers) counts[f.state] = (counts[f.state] || 0) + 1;
  return `${s.phase} t=${t.toFixed(0)} ink=${Math.round(s.inkUsed())} motes=${s.motes.filter((m) => m.got).length}/${s.motes.length} ${JSON.stringify(counts)}\n     ${path.join(' ')}`;
}
const [,, a, b, c] = process.argv;
if (a === '--child') {
  const cand = JSON.parse(fs.readFileSync(c))[+b];
  const base = LEVELS.find((l) => l.id === process.argv[5]);
  const lv = { ...base, ...(cand.level || {}) };
  let rob = '';
  if (process.env.ROBUST) {
    const v = [[4, 0, 0], [1.5, 1.5, 0], [1.5, 0, 1.5], [1.5, -1.5, -1.5]].map(([w, x, y]) => run(lv, cand.strokes, w, x, y).startsWith('won'));
    rob = ` robust+${v.filter(Boolean).length}/4`;
  }
  process.send(`[${cand.name || b}]${rob} ` + run(lv, cand.strokes));
  process.exit(0);
} else {
  const cands = JSON.parse(fs.readFileSync(b));
  const me = fileURLToPath(import.meta.url);
  let qi = 0;
  const next = () => {
    if (qi >= cands.length) return;
    const i = qi++;
    const ch = fork(me, ['--child', String(i), b, a]);
    ch.on('message', (m) => console.log(m));
    ch.on('exit', next);
  };
  for (let i = 0; i < 4; i++) next();
}
