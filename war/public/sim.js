/* 픽셀 월드 워 — 게임 시뮬레이션 (서버와 브라우저 싱글 모드가 함께 사용) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WarSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEA = 65535;
  const TICK = 0.1; // 초
  const CELL = 12; // 유닛 공간 해시 칸 크기
  const PLAYER_UNIT_CAP = 600;
  const AI_UNIT_CAP = 25;
  const GLOBAL_UNIT_SOFT_CAP = 6000;

  // dom: L 지상, S 해상, A 공중, M 미사일 / hits: 공격 가능한 dom
  const UNITS = [
    { key: 'inf', name: '군인', icon: '🪖', cost: 30, hp: 60, dmg: 6, range: 2.5, rate: 1.0, speed: 3, cap: 1, dom: 'L', hits: 'LS' },
    { key: 'tank', name: '탱크', icon: '🛡️', cost: 200, hp: 320, dmg: 28, range: 3.5, rate: 1.2, speed: 5, cap: 1.5, dom: 'L', hits: 'LS', armor: 1 },
    { key: 'art', name: '포병', icon: '💥', cost: 260, hp: 90, dmg: 40, range: 11, rate: 2.5, speed: 2.2, cap: 1, dom: 'L', hits: 'LS', splash: 2 },
    { key: 'aa', name: '방공포', icon: '🎯', cost: 220, hp: 140, dmg: 45, range: 10, rate: 0.8, speed: 3, cap: 1, dom: 'L', hits: 'AM' },
    { key: 'ftr', name: '전투기', icon: '✈️', cost: 500, hp: 160, dmg: 22, range: 6, rate: 0.6, speed: 22, cap: 0, dom: 'A', hits: 'ALS', armor: 1 },
    { key: 'bmb', name: '폭격기', icon: '🛩️', cost: 800, hp: 260, dmg: 90, range: 2.5, rate: 2.0, speed: 14, cap: 0, dom: 'A', hits: 'LS', splash: 3, armor: 1 },
    { key: 'ship', name: '군함', icon: '🚢', cost: 700, hp: 700, dmg: 35, range: 9, rate: 1.5, speed: 6, cap: 0, dom: 'S', hits: 'LSA', armor: 1 },
    { key: 'msl', name: '미사일', icon: '🚀', cost: 1200, hp: 20, dmg: 260, range: 0, speed: 45, dom: 'M', blast: 5 },
    { key: 'nuke', name: '핵미사일', icon: '☢️', cost: 25000, hp: 60, dmg: 1e9, range: 0, speed: 30, dom: 'M', blast: 16, grab: 10, cooldown: 90 },
  ];
  const NUKE = 8;
  // 이펙트 종류: 1~9 사격(유닛 타입+1), 20 폭발, 21 미사일 폭발, 22 핵폭발
  const FX_BOOM = 20, FX_MISSILE = 21, FX_NUKE = 22;

  const discCache = new Map();
  function disc(r) {
    let d = discCache.get(r);
    if (!d) {
      d = [];
      const R = Math.ceil(r);
      for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) if (x * x + y * y <= r * r) d.push(x, y);
      discCache.set(r, d);
    }
    return d;
  }

  // 한국어 조사: josa('한국', '이', '가') → '한국이'
  function josa(word, a, b) {
    const ch = word.charCodeAt(word.length - 1);
    if (ch < 0xac00 || ch > 0xd7a3) return word + a + '(' + b + ')';
    return word + ((ch - 0xac00) % 28 ? a : b);
  }

  class Game {
    constructor(meta, grid, opts = {}) {
      const W = (this.W = meta.w), H = (this.H = meta.h);
      this.N = W * H;
      this.owner = grid;
      this.rng = opts.rng || Math.random;
      this.aiAggro = opts.aiAggro ?? 0.0006;
      this.aiWarLimit = opts.aiWarLimit ?? 12;
      this.tick = 0;
      this.countries = meta.countries.map((c) => ({
        id: c.id, name: c.name, lx: c.lx, ly: c.ly, capIdx: c.ly * W + c.lx, nb: c.nb,
        pop: c.pop, gdp: c.gdp, px: 0, px0: 0, money: 0, troops: 0, cap: 0, income: 0,
        alive: c.id !== 0, wars: new Map(), offers: new Set(), player: null, units: 0, nukeCd: 0,
        bbox: [W, -1, H, -1],
      }));
      for (let i = 0; i < this.N; i++) {
        const o = grid[i];
        if (o === SEA) continue;
        const c = this.countries[o];
        c.px++;
        this.grow(c, i % W, (i / W) | 0);
      }
      for (const c of this.countries) {
        c.px0 = Math.max(1, c.px);
        this.economy(c);
        c.money = 400 + c.income * 15;
        c.troops = c.cap * 0.5;
      }
      this.units = new Map();
      this.nextUnit = 1;
      this.attacks = [];
      this.dirty = [];
      this.dirtyMark = new Uint8Array(this.N);
      this.fx = [];
      this.out = [];
      this.dead = [];
      this.capLost = [];
      this.players = new Map();
      this.gw = Math.ceil(W / CELL);
      this.gh = Math.ceil(H / CELL);
      this.buckets = Array.from({ length: this.gw * this.gh }, () => []);
      this.usedBuckets = [];
    }

    // ───────── 기본 도구 ─────────
    grow(c, x, y) {
      const b = c.bbox;
      if (x < b[0]) b[0] = x;
      if (x > b[1]) b[1] = x;
      if (y < b[2]) b[2] = y;
      if (y > b[3]) b[3] = y;
    }
    wdx(dx) {
      const W = this.W;
      return dx > W / 2 ? dx - W : dx < -W / 2 ? dx + W : dx;
    }
    cell(x, y) {
      const W = this.W;
      const cy = Math.floor(y);
      if (cy < 0 || cy >= this.H) return -1;
      const cx = ((Math.floor(x) % W) + W) % W;
      return cy * W + cx;
    }
    nbs(i, out) {
      const W = this.W, x = i % W;
      out[0] = x > 0 ? i - 1 : i + W - 1;
      out[1] = x < W - 1 ? i + 1 : i - W + 1;
      out[2] = i >= W ? i - W : -1;
      out[3] = i + W < this.N ? i + W : -1;
      return out;
    }
    isSea(i) {
      return i < 0 || this.owner[i] === SEA;
    }
    // a가 b의 땅을 빼앗을 수 있는가 (b=0 무주지는 누구나)
    canTake(a, b) {
      return b !== SEA && b !== a && (b === 0 || this.countries[a].wars.has(b));
    }
    hostile(a, b) {
      return a !== b && this.countries[a].wars.has(b);
    }
    setOwner(i, o) {
      const old = this.owner[i];
      if (old === o || old === SEA) return false;
      this.owner[i] = o;
      const oc = this.countries[old], nc = this.countries[o];
      oc.px--;
      nc.px++;
      this.grow(nc, i % this.W, (i / this.W) | 0);
      if (!this.dirtyMark[i]) {
        this.dirtyMark[i] = 1;
        this.dirty.push(i);
      }
      if (old !== 0) {
        if (oc.px === 0) this.dead.push([old, o]);
        else if (i === oc.capIdx) this.capLost.push([old, o]);
      }
      return true;
    }
    event(m, k) {
      this.out.push({ to: null, msg: { t: 'ev', m, k } });
    }
    tell(pid, msg) {
      if (pid) this.out.push({ to: pid, msg });
    }
    err(pid, m) {
      this.tell(pid, { t: 'err', m });
      return false;
    }
    drainOut() {
      const o = this.out;
      this.out = [];
      return o;
    }

    economy(c) {
      if (c.id === 0) return;
      const share = Math.min(1, c.px / c.px0);
      c.cap = Math.round(300 + c.px * 1.2 + Math.min(c.pop / 40000, 40000) * share);
      c.income = 3 + Math.sqrt(c.px) * 1.2 + Math.sqrt(c.gdp) * 0.02 * share;
    }

    // 수도를 잃으면 남은 땅 중 가장 가까운 곳으로 옮긴다
    relocateCapital(c) {
      if (this.owner[c.capIdx] === c.id) return true;
      const [x0, x1, y0, y1] = c.bbox, W = this.W;
      let best = -1, bd = Infinity;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0, i = y * W + x0; x <= x1; x++, i++) {
          if (this.owner[i] !== c.id) continue;
          const dx = this.wdx(x - c.lx), dy = y - c.ly, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best < 0) return false;
      c.capIdx = best;
      c.lx = best % W;
      c.ly = (best / W) | 0;
      return true;
    }

    // ───────── 외교 ─────────
    declare(a, b, pid) {
      const A = this.countries[a], B = this.countries[b];
      if (!B || b === 0 || a === b || !B.alive || !A.alive) return this.err(pid, '선전포고할 수 없는 대상입니다');
      if (A.wars.has(b)) return true;
      A.wars.set(b, { t: this.tick, px: A.px });
      B.wars.set(a, { t: this.tick, px: B.px });
      A.offers.delete(b);
      B.offers.delete(a);
      this.event(`⚔️ ${josa(A.name, '이', '가')} ${B.name}에 선전포고!`, 'war');
      return true;
    }
    makePeace(a, b) {
      const A = this.countries[a], B = this.countries[b];
      if (!A.wars.has(b)) return;
      A.wars.delete(b);
      B.wars.delete(a);
      A.offers.delete(b);
      B.offers.delete(a);
      for (const at of this.attacks) if ((at.from === a && at.to === b) || (at.from === b && at.to === a)) at.done = true;
      this.event(`🕊️ ${josa(A.name, '과', '와')} ${B.name} 평화 협정 체결`, 'peace');
    }
    proposePeace(a, b, pid) {
      const A = this.countries[a], B = this.countries[b];
      const war = B && A.wars.get(b);
      if (!war) return this.err(pid, '전쟁 중이 아닙니다');
      if (A.offers.has(b)) return this.makePeace(a, b); // 상대가 이미 제안함
      if (B.player) {
        B.offers.add(a);
        this.tell(B.player, { t: 'peaceOffer', from: a });
        this.tell(pid, { t: 'info', m: `${B.name}에 평화를 제안했습니다` });
        return;
      }
      const dur = (this.tick - war.t) * TICK;
      const mine = B.wars.get(a);
      const losing = B.px < mine.px * 0.85;
      if (dur > 20 && (losing || this.rng() < 0.35)) this.makePeace(a, b);
      else this.tell(pid, { t: 'info', m: `${josa(B.name, '이', '가')} 평화 제안을 거절했습니다` });
    }

    // ───────── 공세 (전선이 실시간으로 밀고 들어감) ─────────
    startAttack(a, b, ratio, px, py, pid) {
      const A = this.countries[a], B = this.countries[b];
      if (!A.alive || !B || b === a) return this.err(pid, '공격할 수 없습니다');
      if (b !== 0 && !A.wars.has(b)) return this.err(pid, '먼저 선전포고를 하세요');
      ratio = Math.min(1, Math.max(0.05, +ratio || 0.4));
      const force = A.troops * ratio;
      if (force < 5) return this.err(pid, '병력이 부족합니다');
      A.troops -= force;
      let at = this.attacks.find((x) => x.from === a && x.to === b && !x.done);
      if (at) {
        at.force += force;
        if (at.front.length) return true;
      } else {
        at = { from: a, to: b, force, front: [], inF: new Set(), done: false };
        this.attacks.push(at);
      }
      this.seedFront(at);
      if (!at.front.length) this.seedLanding(at, px, py);
      if (!at.front.length) {
        at.done = true;
        return this.err(pid, '공격할 땅을 찾지 못했습니다');
      }
      return true;
    }
    addFront(at, i) {
      if (!at.inF.has(i)) {
        at.inF.add(i);
        at.front.push(i);
      }
    }
    seedFront(at) {
      const [x0, x1, y0, y1] = this.countries[at.to].bbox, W = this.W, own = this.owner, nb = [0, 0, 0, 0];
      for (let y = y0; y <= y1; y++) {
        for (let i = y * W + x0, e = y * W + x1; i <= e; i++) {
          if (own[i] !== at.to) continue;
          this.nbs(i, nb);
          for (let k = 0; k < 4; k++) if (nb[k] >= 0 && own[nb[k]] === at.from) { this.addFront(at, i); break; }
        }
      }
    }
    // 국경이 없으면 상륙/공수 작전: 지정 지점 또는 수도에서 가장 가까운 해안
    seedLanding(at, px, py) {
      const p = px != null ? this.cell(px, py) : -1;
      if (p >= 0 && this.owner[p] === at.to) {
        this.addFront(at, p);
      } else {
        const A = this.countries[at.from], [x0, x1, y0, y1] = this.countries[at.to].bbox;
        const W = this.W, own = this.owner, nb = [0, 0, 0, 0];
        let best = -1, bd = Infinity;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0, i = y * W + x0; x <= x1; x++, i++) {
            if (own[i] !== at.to) continue;
            this.nbs(i, nb);
            if (!(this.isSea(nb[0]) || this.isSea(nb[1]) || this.isSea(nb[2]) || this.isSea(nb[3]))) continue;
            const dx = this.wdx(x - A.lx), dy = y - A.ly, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; }
          }
        }
        if (best >= 0) this.addFront(at, best);
      }
      at.force *= 0.8; // 상륙 손실
    }
    stepAttacks() {
      const nb = [0, 0, 0, 0];
      for (let k = this.attacks.length - 1; k >= 0; k--) {
        const at = this.attacks[k], A = this.countries[at.from], B = this.countries[at.to];
        const dens = at.to === 0 ? 0.6 : 1 + (B.troops / Math.max(B.px, 1)) * 0.7;
        if (!at.done && (!A.alive || (at.to !== 0 && !A.wars.has(at.to)))) at.done = true;
        if (!at.done) {
          const boost = Math.min(3, Math.max(0.5, at.force / (B.troops + 50)));
          let n = Math.min(40, Math.ceil(Math.sqrt(at.front.length) * 0.3 * boost));
          while (n > 0 && at.front.length && at.force >= dens) {
            const j = (this.rng() * at.front.length) | 0, i = at.front[j];
            at.front[j] = at.front[at.front.length - 1];
            at.front.pop();
            at.inF.delete(i);
            if (this.owner[i] !== at.to) continue;
            n--;
            this.setOwner(i, at.from);
            at.force -= dens;
            if (at.to) B.troops = Math.max(0, B.troops - dens * 0.5);
            this.nbs(i, nb);
            for (let q = 0; q < 4; q++) if (nb[q] >= 0 && this.owner[nb[q]] === at.to) this.addFront(at, nb[q]);
          }
          if (!at.front.length || at.force < dens) at.done = true;
        }
        if (at.done) {
          if (A.alive) A.troops += at.force;
          this.attacks.splice(k, 1);
        }
      }
    }

    // ───────── 유닛 ─────────
    addUnit(t, o, x, y) {
      const T = UNITS[t];
      const u = { id: this.nextUnit++, t, o, x, y, tx: null, ty: null, ax: x, ay: y, hp: T.hp, cd: this.rng() * (T.rate || 1) };
      this.units.set(u.id, u);
      this.countries[o].units++;
      return u;
    }
    nearOwnLand(i, o, r) {
      const d = disc(r), x = i % this.W, y = (i / this.W) | 0;
      for (let k = 0; k < d.length; k += 2) {
        const j = this.cell(x + d[k], y + d[k + 1]);
        if (j >= 0 && this.owner[j] === o) return true;
      }
      return false;
    }
    spawn(o, t, x, y, n, pid) {
      const c = this.countries[o], T = UNITS[t];
      if (!T || !c.alive) return false;
      const capN = (c.player ? PLAYER_UNIT_CAP : AI_UNIT_CAP) - c.units;
      n = Math.max(1, Math.min(20, n | 0, capN, Math.floor(c.money / T.cost)));
      if (c.money < T.cost) return this.err(pid, `돈이 부족합니다 (${T.name} ${T.cost})`);
      if (capN <= 0) return this.err(pid, '유닛 수 한도에 도달했습니다');
      if (T.dom === 'M') return this.launch(c, t, x, y, n, pid);
      let made = 0;
      for (let k = 0; k < n * 4 && made < n; k++) {
        const r = k ? 0.6 + Math.sqrt(k) * 0.7 : 0;
        const a = this.rng() * Math.PI * 2;
        const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r, i = this.cell(sx, sy);
        if (i < 0) continue;
        const ok = T.dom === 'S' ? this.owner[i] === SEA && this.nearOwnLand(i, o, 5) : this.owner[i] === o;
        if (!ok) continue;
        this.addUnit(t, o, sx, sy);
        c.money -= T.cost;
        made++;
      }
      if (!made) return this.err(pid, T.dom === 'S' ? '군함은 자기 나라 근처 바다에만 소환할 수 있어요' : '자기 나라 땅에만 소환할 수 있어요');
      return true;
    }
    launch(c, t, x, y, n, pid) {
      const T = UNITS[t];
      if (t === NUKE) {
        if (c.nukeCd > 0) return this.err(pid, `핵 재장전 중 (${Math.ceil(c.nukeCd)}초)`);
        n = 1;
        c.nukeCd = T.cooldown;
      }
      if (!this.relocateCapital(c)) return false;
      const i = this.cell(x, y);
      const tgt = i >= 0 ? this.owner[i] : SEA;
      if (tgt !== SEA && tgt !== 0 && tgt !== c.id && !c.wars.has(tgt)) this.declare(c.id, tgt, pid);
      for (let k = 0; k < n; k++) {
        const u = this.addUnit(t, c.id, c.lx + 0.5, c.ly + 0.5);
        u.tx = x + (k ? (this.rng() - 0.5) * 3 : 0);
        u.ty = y + (k ? (this.rng() - 0.5) * 3 : 0);
        c.money -= T.cost;
      }
      if (t === NUKE) this.event(`☢️ ${josa(c.name, '이', '가')} 핵미사일을 발사했다!`, 'nuke');
      return true;
    }
    move(o, ids, x, y) {
      if (!Array.isArray(ids)) return;
      const list = [];
      for (const id of ids.slice(0, PLAYER_UNIT_CAP)) {
        const u = this.units.get(id);
        if (u && u.o === o && UNITS[u.t].dom !== 'M') list.push(u);
      }
      const side = Math.ceil(Math.sqrt(list.length));
      list.forEach((u, k) => {
        const ox = ((k % side) - (side - 1) / 2) * 0.9, oy = (Math.floor(k / side) - (side - 1) / 2) * 0.9;
        u.tx = u.ax = x + ox;
        u.ty = u.ay = Math.min(this.H - 0.01, Math.max(0, y + oy));
      });
    }

    hashUnits() {
      for (const b of this.usedBuckets) this.buckets[b].length = 0;
      this.usedBuckets.length = 0;
      for (const u of this.units.values()) {
        const b = Math.min(this.gh - 1, Math.floor(u.y / CELL)) * this.gw + (Math.floor(u.x / CELL) % this.gw);
        const arr = this.buckets[b];
        if (!arr.length) this.usedBuckets.push(b);
        arr.push(u);
      }
    }
    near(x, y, r, fn) {
      const gw = this.gw;
      const bx0 = Math.floor((x - r) / CELL), bx1 = Math.floor((x + r) / CELL);
      const by0 = Math.max(0, Math.floor((y - r) / CELL)), by1 = Math.min(this.gh - 1, Math.floor((y + r) / CELL));
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          for (const v of this.buckets[by * gw + (((bx % gw) + gw) % gw)]) {
            const dx = this.wdx(v.x - x), dy = v.y - y, d2 = dx * dx + dy * dy;
            if (d2 <= r * r) fn(v, d2);
          }
        }
      }
    }
    pushFx(k, x1, y1, x2, y2) {
      if (this.fx.length < 3000) this.fx.push(k, x1, y1, x2, y2);
    }

    stepUnits() {
      this.hashUnits();
      const own = this.owner;
      for (const u of this.units.values()) {
        if (u.hp <= 0) continue;
        const T = UNITS[u.t];
        // 이동
        if (u.tx != null) {
          const dx = this.wdx(u.tx - u.x), dy = u.ty - u.y, d = Math.hypot(dx, dy);
          let sp = T.speed * TICK;
          if (T.dom === 'L' && this.isSea(this.cell(u.x, u.y))) sp *= 0.5;
          if (d <= sp) {
            u.x = u.tx;
            u.y = u.ty;
            if (T.dom === 'M') { this.explode(u); continue; }
            if (T.dom === 'A') {
              const a = this.rng() * Math.PI * 2;
              u.tx = u.ax + Math.cos(a) * 4;
              u.ty = u.ay + Math.sin(a) * 4;
            } else u.tx = u.ty = null;
          } else {
            let nx = u.x + (dx / d) * sp, ny = u.y + (dy / d) * sp;
            if (T.dom === 'S' && !this.isSea(this.cell(nx, ny))) {
              // 해안선을 따라 미끄러지기
              if (this.isSea(this.cell(u.x + Math.sign(dx) * sp, u.y))) { nx = u.x + Math.sign(dx) * sp; ny = u.y; }
              else if (this.isSea(this.cell(u.x, u.y + Math.sign(dy) * sp))) { nx = u.x; ny = u.y + Math.sign(dy) * sp; }
              else { nx = u.x; ny = u.y; u.tx = u.ty = null; }
            }
            u.x = ((nx % this.W) + this.W) % this.W;
            u.y = Math.min(this.H - 0.01, Math.max(0, ny));
          }
        } else if (T.dom === 'A') {
          u.tx = u.ax;
          u.ty = u.ay;
        }
        // 땅 점령
        if (T.cap) {
          const here = this.cell(u.x, u.y);
          if (here >= 0 && own[here] !== SEA) {
            const d = disc(T.cap), cx = Math.floor(u.x), cy = Math.floor(u.y);
            for (let k = 0; k < d.length; k += 2) {
              const i = this.cell(cx + d[k], cy + d[k + 1]);
              if (i >= 0 && this.canTake(u.o, own[i])) this.setOwner(i, u.o);
            }
          }
        }
        // 전투
        if (!T.hits) continue;
        u.cd -= TICK;
        if (u.cd > 0) continue;
        let best = null, bs = Infinity;
        const C = this.countries[u.o];
        this.near(u.x, u.y, T.range, (v, d2) => {
          if (v.hp <= 0 || v.o === u.o || !C.wars.has(v.o)) return;
          const vd = UNITS[v.t].dom;
          if (!T.hits.includes(vd)) return;
          const s = d2 - (u.t === 4 && vd === 'A' ? 1000 : 0);
          if (s < bs) { bs = s; best = v; }
        });
        if (!best) continue;
        u.cd = T.rate;
        this.pushFx(u.t + 1, u.x, u.y, best.x, best.y);
        if (T.splash) {
          const bx = best.x, by = best.y;
          this.near(bx, by, T.splash, (v) => {
            if (v.o !== u.o && C.wars.has(v.o) && T.hits.includes(UNITS[v.t].dom)) this.hurt(v, T.dmg, u);
          });
          this.pushFx(FX_BOOM, bx, by, T.splash, 0);
        } else this.hurt(best, T.dmg, u);
      }
      for (const u of this.units.values()) {
        if (u.hp > 0) continue;
        this.units.delete(u.id);
        this.countries[u.o].units--;
        if (UNITS[u.t].dom !== 'M') this.pushFx(FX_BOOM, u.x, u.y, 1, 0);
      }
    }
    hurt(v, dmg, by) {
      if (by.t === 0 && UNITS[v.t].armor) dmg *= 0.4; // 소총은 장갑에 약함
      v.hp -= dmg;
    }
    explode(m) {
      const T = UNITS[m.t], C = this.countries[m.o], nuke = m.t === NUKE;
      m.hp = 0;
      this.near(m.x, m.y, T.blast, (v) => {
        if (v === m) return;
        if (nuke || (v.o !== m.o && C.wars.has(v.o))) v.hp -= T.dmg;
      });
      if (nuke) {
        const d = disc(T.grab), cx = Math.floor(m.x), cy = Math.floor(m.y), hit = new Set();
        for (let k = 0; k < d.length; k += 2) {
          const i = this.cell(cx + d[k], cy + d[k + 1]);
          if (i < 0) continue;
          const o = this.owner[i];
          if (this.canTake(m.o, o)) { if (o) hit.add(o); this.setOwner(i, m.o); }
        }
        for (const o of hit) this.countries[o].troops *= 0.6;
        this.pushFx(FX_NUKE, m.x, m.y, T.blast, 0);
      } else this.pushFx(FX_MISSILE, m.x, m.y, T.blast, 0);
    }

    // ───────── AI ─────────
    aiThink(c) {
      if (!c.alive || c.player || c.id === 0) return;
      const r = this.rng;
      if (c.wars.size) {
        const enemies = [...c.wars.keys()];
        const e = enemies[(r() * enemies.length) | 0], E = this.countries[e];
        if (c.troops > c.cap * 0.3 && r() < 0.5) this.startAttack(c.id, e, 0.35 + r() * 0.3);
        if (c.units < AI_UNIT_CAP && this.units.size < GLOBAL_UNIT_SOFT_CAP && c.money > 60 && this.relocateCapital(c)) {
          const pool = [[0, 40], [1, 25], [2, 8], [3, 7], [4, 10], [5, 6]].filter(([t]) => UNITS[t].cost <= c.money * 0.6);
          if (pool.length) {
            let p = r() * pool.reduce((s, x) => s + x[1], 0), t = pool[0][0];
            for (const [tt, w] of pool) if ((p -= w) < 0) { t = tt; break; }
            const n = Math.min(5, Math.floor((c.money * 0.6) / UNITS[t].cost));
            const before = this.nextUnit;
            if (this.spawn(c.id, t, c.lx + 0.5, c.ly + 0.5, n)) {
              const ids = [];
              for (let id = before; id < this.nextUnit; id++) ids.push(id);
              this.move(c.id, ids, E.lx + (r() - 0.5) * 6, E.ly + (r() - 0.5) * 6);
            }
          }
        }
        if (c.money > 4000 && r() < 0.08) this.spawn(c.id, 7, E.lx + (r() - 0.5) * 8, E.ly + (r() - 0.5) * 8, 1);
        if (c.money > 60000 && c.nukeCd <= 0 && r() < 0.02) this.spawn(c.id, NUKE, E.lx + 0.5, E.ly + 0.5, 1);
        for (const [e2, w] of c.wars) {
          const E2 = this.countries[e2], dur = (this.tick - w.t) * TICK;
          if (E2.player) {
            if (dur > 60 && c.px < w.px * 0.6 && !E2.offers.has(c.id) && r() < 0.1) {
              E2.offers.add(c.id);
              this.tell(E2.player, { t: 'peaceOffer', from: c.id });
            }
          } else if (dur > 90 && r() < 0.03) this.makePeace(c.id, e2);
        }
      } else if (c.nb.length && r() < this.aiAggro && this.aiWars < this.aiWarLimit) {
        const cand = c.nb.filter((n) => n !== 0 && this.countries[n].alive);
        if (cand.length) this.declare(c.id, cand[(r() * cand.length) | 0]);
      }
    }

    // ───────── 플레이어 ─────────
    addPlayer(pid) {
      this.players.set(pid, { name: '플레이어', country: 0 });
    }
    removePlayer(pid) {
      this.release(pid);
      this.players.delete(pid);
    }
    release(pid) {
      const p = this.players.get(pid);
      if (!p || !p.country) return;
      const c = this.countries[p.country];
      if (c.player === pid) c.player = null;
      p.country = 0;
    }
    command(pid, m) {
      const p = this.players.get(pid);
      if (!p || !m || typeof m.t !== 'string') return;
      if (m.t === 'join') {
        const c = this.countries[m.id | 0];
        if (!c || !c.alive || c.id === 0) return this.err(pid, '선택할 수 없는 나라입니다');
        if (c.player && c.player !== pid) return this.err(pid, '이미 다른 플레이어가 지휘 중인 나라입니다');
        this.release(pid);
        p.name = String(m.name || '플레이어').slice(0, 16);
        p.country = c.id;
        c.player = pid;
        c.offers.clear();
        this.tell(pid, { t: 'you', id: c.id });
        this.event(`🎮 ${p.name}님이 ${josa(c.name, '을', '를')} 지휘합니다`, 'join');
        return;
      }
      if (m.t === 'leave') {
        this.release(pid);
        this.tell(pid, { t: 'you', id: 0 });
        return;
      }
      const me = p.country;
      if (!me) return this.err(pid, '먼저 나라를 선택하세요');
      const tgt = m.id | 0;
      switch (m.t) {
        case 'declare': return this.declare(me, tgt, pid);
        case 'peace': return this.proposePeace(me, tgt, pid);
        case 'acceptPeace':
          if (this.countries[me].offers.has(tgt)) this.makePeace(me, tgt);
          return;
        case 'attack': return this.startAttack(me, tgt, m.r, num(m.x), num(m.y), pid);
        case 'spawn': {
          const t = m.u | 0, x = num(m.x), y = num(m.y);
          if (!UNITS[t] || x == null || y == null) return;
          return this.spawn(me, t, x, y, m.n | 0 || 1, pid);
        }
        case 'move': {
          const x = num(m.x), y = num(m.y);
          if (x != null && y != null) this.move(me, m.ids, x, y);
          return;
        }
      }
    }

    // ───────── 메인 루프 ─────────
    step() {
      this.tick++;
      if (this.tick % 10 === 0) {
        let wars = 0;
        for (const c of this.countries) {
          if (!c.alive) continue;
          this.economy(c);
          c.money += c.income;
          if (c.troops < c.cap) c.troops = Math.min(c.cap, c.troops + Math.max(2, c.cap * 0.012));
          else c.troops -= (c.troops - c.cap) * 0.1;
          if (c.nukeCd > 0) c.nukeCd--;
          if (!c.player) for (const e of c.wars.keys()) if (!this.countries[e].player) wars++;
        }
        this.aiWars = wars / 2;
      }
      const slot = this.tick % 20;
      for (let id = slot; id < this.countries.length; id += 20) this.aiThink(this.countries[id]);
      this.stepAttacks();
      this.stepUnits();
      this.resolveLosses();
    }
    resolveLosses() {
      for (const [id, by] of this.capLost) {
        const c = this.countries[id], B = this.countries[by];
        if (!c.alive || c.px === 0) continue;
        // 수도를 연달아 잃어도 벌칙·소식은 30초에 한 번만
        if (this.tick - (c.capT ?? -1e9) < 300) { this.relocateCapital(c); continue; }
        c.capT = this.tick;
        const loot = c.money * 0.3;
        c.money -= loot;
        B.money += loot;
        c.troops *= 0.6;
        this.event(`🏛️ ${c.name}의 수도가 ${B.name}에 함락되었다!`, 'capital');
        this.relocateCapital(c);
      }
      this.capLost.length = 0;
      for (const [id, by] of this.dead) {
        const c = this.countries[id];
        if (!c.alive || c.px > 0) continue;
        c.alive = false;
        for (const e of c.wars.keys()) this.countries[e].wars.delete(id);
        c.wars.clear();
        for (const u of this.units.values()) if (u.o === id) u.hp = 0;
        for (const at of this.attacks) if (at.from === id || at.to === id) at.done = true;
        if (by) this.countries[by].money += c.money * 0.5;
        c.money = c.troops = 0;
        this.event(`💀 ${josa(c.name, '이', '가')} ${this.countries[by].name}에 의해 멸망했다`, 'dead');
        if (c.player) {
          this.tell(c.player, { t: 'dead', id });
          this.release(c.player);
        }
      }
      this.dead.length = 0;
    }

    stats() {
      return {
        t: 'stats',
        c: this.countries.map((c) =>
          c.id === 0 ? [c.px] : c.alive
            ? [c.px, c.money | 0, c.troops | 0, c.cap, Math.round(c.income), c.player ? this.players.get(c.player).name : '', [...c.wars.keys()], c.lx, c.ly, Math.ceil(c.nukeCd), c.units]
            : 0),
      };
    }

    // 바이너리 틱: [2][flags][픽셀 수][(idx u32, owner u16)...][fx 수][(kind u8, x1,y1,x2,y2 u16)...][유닛 수][(id u32, type u8, owner u16, x u16, y u16, hp u8)...]
    encodeTick(withUnits) {
      const pix = this.dirty, fx = this.fx, nfx = fx.length / 5;
      const size = 6 + pix.length * 6 + 2 + nfx * 9 + (withUnits ? 4 + this.units.size * 12 : 0);
      const buf = new ArrayBuffer(size), dv = new DataView(buf);
      let o = 0;
      dv.setUint8(o++, 2);
      dv.setUint8(o++, withUnits ? 1 : 0);
      dv.setUint32(o, pix.length, true);
      o += 4;
      for (const i of pix) {
        dv.setUint32(o, i, true);
        dv.setUint16(o + 4, this.owner[i], true);
        o += 6;
        this.dirtyMark[i] = 0;
      }
      this.dirty = [];
      dv.setUint16(o, nfx, true);
      o += 2;
      for (let k = 0; k < fx.length; k += 5) {
        dv.setUint8(o, fx[k]);
        for (let q = 1; q < 5; q++) dv.setUint16(o + 1 + (q - 1) * 2, q20(fx[k + q]), true);
        o += 9;
      }
      this.fx = [];
      if (withUnits) {
        dv.setUint32(o, this.units.size, true);
        o += 4;
        for (const u of this.units.values()) {
          dv.setUint32(o, u.id, true);
          dv.setUint8(o + 4, u.t);
          dv.setUint16(o + 5, u.o, true);
          dv.setUint16(o + 7, q20(u.x), true);
          dv.setUint16(o + 9, q20(u.y), true);
          dv.setUint8(o + 11, Math.max(0, Math.min(255, Math.round((u.hp / UNITS[u.t].hp) * 255))));
          o += 12;
        }
      }
      return buf;
    }
  }

  function q20(v) {
    return Math.max(0, Math.min(65535, Math.round(v * 20)));
  }
  function num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  return { Game, UNITS, SEA, NUKE, FX_BOOM, FX_MISSILE, FX_NUKE, josa };
});
