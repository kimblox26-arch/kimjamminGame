// 힌트 비행 경로와 각 별빛(mote)의 최소 거리, 그리고 가장 가까운 경로 지점을 출력
// 사용: node tools/motes.mjs <레벨id ...>
import { Sim, makeStroke } from '../src/sim.js';
import { LEVELS } from '../src/levels.js';
for (const id of process.argv.slice(2)) {
  const lv = LEVELS.find((l) => l.id === id);
  const s = new Sim(); s.load(lv);
  s.setStrokes(lv.hint.map((k) => makeStroke(k.pts, k.power)));
  for (let t = 0; t < 1.5; t += 1 / 60) s.step();
  s.launch();
  const pts = [];
  while (s.phase === 'fly') { s.step(); for (const f of s.flyers) if (f.state === 'fly') pts.push([f.x, f.y]); }
  const none = new Sim(); none.load(lv); none.launch();
  const npts = [];
  while (none.phase === 'fly') { none.step(); for (const f of none.flyers) if (f.state === 'fly') npts.push([f.x, f.y]); }
  const near = (P, m) => P.reduce((b, p) => { const d = Math.hypot(p[0] - m[0], p[1] - m[1]); return d < b.d ? { d, p } : b; }, { d: 1e9, p: null });
  const rep = lv.motes.map((m) => { const h = near(pts, m), n = near(npts, m); return `[${m}] hint ${h.d.toFixed(1)}m →(${h.p.map((v) => v.toFixed(0))}) none ${n.d.toFixed(1)}m`; });
  console.log(id, s.phase, '\n  ' + rep.join('\n  '));
}
