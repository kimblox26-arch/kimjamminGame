// 모든 스테이지 검증: 바람 없이 → 실패해야 함, 힌트 바람 → 성공해야 함
// 사용: node tools/check.mjs [레벨id ...]
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { Sim, makeStroke } from '../src/sim.js';
import { LEVELS } from '../src/levels.js';

function run(level, strokes, warm = 1.5, dx = 0, dy = 0) {
  const s = new Sim();
  s.load(level);
  s.setStrokes(strokes.map((k) => makeStroke(k.pts.map(([x, y]) => [x + dx, y + dy]), k.power)));
  for (let t = 0; t < warm; t += 1 / 60) s.step();
  s.launch();
  let t = 0;
  const lim = (level.limit ?? 70) + 5;
  const path = [];
  while (s.phase === 'fly' && t < lim) {
    s.step(); t += 1 / 60;
    if (Math.round(t * 60) % 60 === 0) { const f = s.flyers.find((q) => q.state === 'fly') || s.flyers[0]; path.push(`${f.x.toFixed(0)},${f.y.toFixed(0)}`); }
  }
  const counts = {};
  for (const f of s.flyers) counts[f.state] = (counts[f.state] || 0) + 1;
  return { phase: s.phase, t: +t.toFixed(1), ink: Math.round(s.inkUsed()), motes: s.motes.filter((m) => m.got).length + '/' + s.motes.length, counts, path: path.join(' ') };
}

if (process.argv[2] === '--child') {
  const lv = LEVELS.find((l) => l.id === process.argv[3]);
  const none = run(lv, []);
  const none2 = run(lv, [], 5);
  const hint = run(lv, lv.hint || []);
  // 견고성: 발사 시점과 획 위치를 조금씩 바꿔도 풀려야 한다
  const vars = [[4, 0, 0], [1.5, 1.5, 0], [1.5, 0, 1.5], [1.5, -1.5, -1.5]].map(([w, x, y]) => run(lv, lv.hint || [], w, x, y).phase === 'won');
  const robust = vars.filter(Boolean).length + (hint.phase === 'won' ? 1 : 0);
  if (none2.phase === 'won') none.phase = 'won';
  process.send({ id: lv.id, none, hint, robust, par: lv.par, ink: lv.ink });
  process.exit(0);
} else {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : LEVELS.map((l) => l.id);
  const verbose = ids.length <= 3;
  const me = fileURLToPath(import.meta.url);
  let bad = 0, active = 0, qi = 0;
  const next = () => {
    if (qi >= ids.length) { if (!active) process.exit(bad ? 1 : 0); return; }
    const id = ids[qi++];
    active++;
    const c = fork(me, ['--child', id]);
    c.on('message', (r) => {
      const ok = r.none.phase !== 'won' && r.hint.phase === 'won' && r.robust >= 4;
      if (!ok) bad++;
      console.log(`${ok ? 'OK ' : 'BAD'} ${r.id.padEnd(10)} none:${r.none.phase}(${Object.entries(r.none.counts).map((e) => e.join(':'))}) hint:${r.hint.phase} robust=${r.robust}/5 t=${r.hint.t} ink=${r.hint.ink}/${r.par}/${r.ink} motes=${r.hint.motes} (${Object.entries(r.hint.counts).map((e) => e.join(':'))})`);
      if (verbose || !ok) console.log('   hint path:', r.hint.path, '\n   none path:', r.none.path);
    });
    c.on('exit', () => { active--; next(); });
  };
  for (let i = 0; i < 4; i++) next();
}
