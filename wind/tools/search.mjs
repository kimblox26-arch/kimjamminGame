// 무작위 풀이 탐색: node tools/search.mjs <레벨id> [시도수=120] [획수=1..3] [override.json]
// 바람 없는 비행 경로 근처에 획을 뿌려 보고, 성공한 조합을 잉크 순으로 출력한다.
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { Sim, makeStroke } from '../src/sim.js';
import { LEVELS } from '../src/levels.js';

function getLevel(id, ov) {
  const base = LEVELS.find((l) => l.id === id);
  return ov ? { ...base, ...JSON.parse(fs.readFileSync(ov)) } : base;
}

function run(level, strokes, wantPath) {
  const s = new Sim(); s.load(level);
  s.setStrokes(strokes.map(([p, k]) => makeStroke(p, k)));
  for (let t = 0; t < 1.5; t += 1 / 60) s.step();
  s.launch();
  let t = 0; const path = [];
  while (s.phase === 'fly' && t < (level.limit ?? 70)) {
    s.step(); t += 1 / 60;
    if (wantPath && Math.round(t * 60) % 30 === 0) { const f = s.flyers.find((q) => q.state === 'fly'); if (f) path.push([f.x, f.y]); }
  }
  return { won: s.phase === 'won', ink: s.inkUsed(), motes: s.motes.filter((m) => m.got).length, got: s.goalCount(), t, path };
}

function rnd(a, b) { return a + Math.random() * (b - a); }

function candidate(path, nStrokes, level) {
  const out = [];
  for (let k = 0; k < nStrokes; k++) {
    const p = path.length ? path[Math.floor(Math.random() * path.length)] : [level.flyer.x, level.flyer.y];
    const ang = Math.random() * Math.PI * 2, len = rnd(15, 70);
    const ox = rnd(-8, 8), oy = rnd(-10, 6);
    const a = [p[0] + ox - Math.cos(ang) * len * 0.3, p[1] + oy - Math.sin(ang) * len * 0.3];
    const bend = rnd(-0.5, 0.5);
    const m = [a[0] + Math.cos(ang + bend) * len * 0.5, a[1] + Math.sin(ang + bend) * len * 0.5];
    const b = [m[0] + Math.cos(ang - bend) * len * 0.5, m[1] + Math.sin(ang - bend) * len * 0.5];
    const pts = [a, m, b].map(([x, y]) => [Math.round(Math.min(199, Math.max(1, x))), Math.round(Math.min(111, Math.max(1, y)))]);
    if ((level.nodraw || []).some((z) => pts.some(([x, y]) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1))) { k--; continue; }
    out.push([pts, Math.random() < 0.4 ? 'strong' : 'soft']);
  }
  return out;
}

const me = fileURLToPath(import.meta.url);
if (process.argv[2] === '--child') {
  const [, , , id, n, ns, ov, seedPath] = process.argv;
  const level = getLevel(id, ov === '-' ? null : ov);
  const path = JSON.parse(seedPath);
  const wins = [];
  for (let i = 0; i < +n; i++) {
    const c = candidate(path, 1 + Math.floor(Math.random() * +ns), level);
    const r = run(level, c);
    if (r.won && r.ink <= level.ink) wins.push({ ink: Math.round(r.ink), motes: r.motes, t: Math.round(r.t), c });
  }
  process.send(wins);
  process.exit(0);
} else {
  const [, , id, tries = '120', ns = '2', ov = '-'] = process.argv;
  const level = getLevel(id, ov === '-' ? null : ov);
  const base = run(level, [], true);
  console.log('none:', base.won ? 'WON (bad)' : 'fail', 'path pts', base.path.length);
  const path = JSON.stringify(base.path.filter((_, i) => i % 2 === 0).map(([x, y]) => [Math.round(x), Math.round(y)]));
  const per = Math.ceil(+tries / 4);
  let done = 0; const all = [];
  for (let w = 0; w < 4; w++) {
    const ch = fork(me, ['--child', id, String(per), ns, ov, path]);
    ch.on('message', (m) => all.push(...m));
    ch.on('exit', () => {
      if (++done < 4) return;
      all.sort((a, b) => b.motes - a.motes || a.ink - b.ink);
      console.log(`wins ${all.length}/${per * 4}`);
      for (const wv of all.slice(0, 6)) console.log(`ink=${wv.ink} motes=${wv.motes} t=${wv.t}  ${JSON.stringify(wv.c)}`);
      if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(all.slice(0, 8).map((wv, i) => ({ name: `s${i}:ink${wv.ink}`, strokes: wv.c }))));
    });
  }
}
