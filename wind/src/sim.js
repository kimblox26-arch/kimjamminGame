// 게임 시뮬레이션 (DOM 없음 — 브라우저와 Node 테스트가 함께 사용)
import { Fluid, pointInPoly } from './fluid.js';
import { Glider, Seed, Lantern } from './flyers.js';

export const W = 200, H = 112.5, NX = 160, NY = 90;
export const POWERS = {
  soft: { speed: 9, cost: 1 },
  strong: { speed: 14, cost: 1.8 },
};
export const FIXED_DT = 1 / 60;

export function strokeLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

export function makeStroke(pts, power = 'soft') {
  return { pts, power, speed: POWERS[power].speed, len: strokeLen(pts) };
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export class Sim {
  constructor() {
    this.fluid = new Fluid(W, H, NX, NY);
    this.strokes = [];
    this.flyers = [];
    this.phase = 'plan';
    this.time = 0;
    this.flightT = 0;
    this.sandbox = false;
    this._w = (x, y, o) => this.fluid.sampleFelt(x, y, o);
    this.env = { wind: this._w, hit: (x, y) => this.hit(x, y), time: 0 };
  }

  load(level, warm = 2.5) {
    this.level = level;
    const ground = level.ground.slice();
    ground.push([W + 10, ground[ground.length - 1][1]], [W + 10, -10], [-10, -10], [-10, ground[0][1]]);
    this.polys = [ground, ...(level.rocks || [])];
    this.water = level.water || [];
    const f = this.fluid;
    f.ambU = level.wind ? level.wind[0] : 0;
    f.ambV = level.wind ? level.wind[1] : 0;
    f.p.fill(0);
    f.buildSolids(this.polys);
    f.clearHeat();
    for (const h of level.heat || []) f.addHeat(h.x, h.w, h.p);
    this.sandbox = !!level.sandbox;
    this.strokes = [];
    this._applyStrokes();
    this.flyers = [];
    this.phase = 'plan';
    this.time = 0;
    this.flightT = 0;
    this.motes = (level.motes || []).map(([x, y]) => ({ x, y, got: false }));
    this.result = null;
    for (let t = 0; t < warm; t += FIXED_DT) f.step(FIXED_DT);
  }

  // 0 공기 · 1 지형 · 2 물
  hit(x, y) {
    if (y < 0) return 1;
    for (const w of this.water) if (x >= w.x0 && x <= w.x1 && y < w.y) return 2;
    for (const pg of this.polys) if (pointInPoly(pg, x, y)) return 1;
    return 0;
  }

  inNoDraw(x, y) {
    for (const z of this.level.nodraw || []) if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return true;
    return false;
  }

  inkUsed() {
    let s = 0;
    for (const k of this.strokes) s += k.len * POWERS[k.power].cost;
    return s;
  }

  inkLeft() { return this.sandbox ? Infinity : this.level.ink - this.inkUsed(); }

  setStrokes(list) { this.strokes = list; this._applyStrokes(); }
  addStroke(s) { this.strokes.push(s); this._applyStrokes(); }
  removeStroke(s) { this.strokes = this.strokes.filter((k) => k !== s); this._applyStrokes(); }
  _applyStrokes(extra) {
    this.fluid.setStrokes(extra ? [...this.strokes, extra] : this.strokes);
  }
  // 그리는 중인 획을 즉시 바람에 반영
  previewStroke(s) { this._applyStrokes(s); }

  launch(spec) {
    const L = spec || this.level.flyer;
    const r = rng(1234 + this.flyers.length * 7);
    const add = [];
    if (L.type === 'glider') add.push(new Glider(L.x, L.y, L.speed ?? 11, L.angle ?? 0));
    else if (L.type === 'seed') {
      const n = L.count ?? 12;
      for (let i = 0; i < n; i++) add.push(new Seed(L.x + (r() - 0.5) * 2, L.y + (r() - 0.5) * 2, i * (L.gap ?? 0.18), r()));
    } else if (L.type === 'lantern') {
      const n = L.count ?? 4;
      for (let i = 0; i < n; i++) add.push(new Lantern(L.x + (r() - 0.5) * 3, L.y, i * (L.gap ?? 1.4), L.fuel ?? 24, r(), L.lift));
    }
    if (this.sandbox) {
      this.flyers.push(...add);
      if (this.flyers.length > 160) this.flyers.splice(0, this.flyers.length - 160);
    } else {
      this.flyers = add;
      for (const m of this.motes) m.got = false;
    }
    this.phase = 'fly';
    this.flightT = 0;
    this._metT = undefined;
    this.result = null;
  }

  reset() {
    this.flyers = [];
    this.phase = 'plan';
    this.result = null;
    for (const m of this.motes) m.got = false;
  }

  need() {
    const f = this.level.flyer;
    return f.type === 'glider' ? 1 : (f.need ?? 1);
  }

  goalCount() { let n = 0; for (const f of this.flyers) if (f.state === 'goal') n++; return n; }

  inGoal(x, y) {
    const g = this.level.goal;
    if (!g) return false;
    if (g.type === 'ring') return (x - g.x) ** 2 + (y - g.y) ** 2 < g.r * g.r;
    return x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1;
  }

  step(dt = FIXED_DT) {
    const ev = [];
    this.time += dt;
    this.env.time = this.time;
    this.fluid.step(dt);
    if (this.phase !== 'fly' && !(this.sandbox && this.flyers.length)) return ev;
    this.flightT += dt;
    for (const f of this.flyers) {
      const before = f.state;
      const sub = f.kind === 'glider' ? 4 : 2;
      for (let s = 0; s < sub && (f.state === 'fly' || f.state === 'wait'); s++) f.step(dt / sub, this.env);
      if (f.state === 'fly') {
        if (f.x < -6 || f.x > W + 6 || f.y > H + 14) f.state = 'lost';
        else if (!this.sandbox && this.inGoal(f.x, f.y)) f.state = 'goal';
        for (const m of this.motes) {
          if (!m.got && (f.x - m.x) ** 2 + (f.y - m.y) ** 2 < 11) { m.got = true; ev.push({ t: 'mote', x: m.x, y: m.y }); }
        }
      }
      if (f.state !== before && before === 'fly') ev.push({ t: f.state, x: f.x, y: f.y, kind: f.kind });
    }
    if (this.sandbox) {
      this.flyers = this.flyers.filter((f) => f.state === 'fly' || f.state === 'wait' || f.trail.length > 0 && (f.dead = (f.dead || 0) + dt) < 4);
      return ev;
    }
    if (this.phase !== 'fly') return ev;
    const need = this.need(), got = this.goalCount();
    let active = 0;
    for (const f of this.flyers) if (f.state === 'fly' || f.state === 'wait') active++;
    const limit = this.level.limit ?? 70;
    if (got >= need && this._metT === undefined) this._metT = this.flightT;
    const settled = this._metT !== undefined && (this.level.flyer.type === 'glider' || active === 0 || this.flightT - this._metT > 2);
    if (settled) {
      this.phase = 'won';
      this.result = this.score();
      ev.push({ t: 'win' });
    } else if (active === 0 || this.flightT > limit) {
      this.phase = 'failed';
      const last = this.flyers.find((f) => f.state !== 'goal') || this.flyers[0];
      const reason = this.flightT > limit ? 'timeout' : (last ? last.state : 'lost');
      this.result = { reason, got, need };
      ev.push({ t: 'fail', reason, got, need });
    }
    return ev;
  }

  score() {
    const motes = this.motes.length;
    const gotM = this.motes.filter((m) => m.got).length;
    const ink = this.inkUsed();
    const stars = 1 + (gotM === motes ? 1 : 0) + (ink <= this.level.par ? 1 : 0);
    return { stars, motes, gotM, ink, par: this.level.par, got: this.goalCount(), need: this.need() };
  }
}

// 공유 코드: 획을 0.5 m 단위로 양자화해 문자열로
export function encodeStrokes(strokes) {
  return strokes.map((s) => (s.power === 'strong' ? 'S' : 's') + s.pts.map(([x, y]) => Math.round(x * 2).toString(36) + '.' + Math.round(y * 2).toString(36)).join('_')).join('~');
}

export function decodeStrokes(str) {
  try {
    return str.split('~').filter(Boolean).map((t) => {
      const power = t[0] === 'S' ? 'strong' : 'soft';
      const pts = t.slice(1).split('_').map((p) => p.split('.').map((v) => parseInt(v, 36) / 2));
      if (pts.some((p) => p.length !== 2 || p.some((v) => !isFinite(v)))) throw new Error('bad');
      return makeStroke(pts, power);
    });
  } catch { return []; }
}
