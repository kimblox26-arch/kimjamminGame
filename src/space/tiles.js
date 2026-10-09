// FREE FREELY 우주 탐사 - 타일 작업 스케줄러 (워커 풀 + 메인 스레드 폴백)
import { PlanetTerrain, buildTile } from './terrainfn.js';

export class TileScheduler {
  constructor() {
    this.workers = [];
    this.busy = [];
    this.queue = [];
    this.callbacks = new Map();     // key → callback
    this.scatterCb = new Map();
    this.planets = new Map();       // id → {cfg, R}
    this.local = new Map();         // 메인 스레드 폴백용 지형
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./tileworker.js', import.meta.url), { type: 'module' });
        w.onmessage = (e) => this._onMessage(i, e.data);
        w.onerror = (err) => { console.warn('타일 워커 오류 — 메인 스레드로 전환', err); this._disableWorkers(); };
        this.workers.push(w);
        this.busy.push(0);
      }
    } catch (e) {
      console.warn('모듈 워커 미지원 — 메인 스레드에서 지형 생성', e);
      this.workers = [];
    }
    this.maxInFlight = 2;
    this.stats = { done: 0 };
  }

  _disableWorkers() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    // 대기 중이던 작업은 다시 큐로
    for (const [key, cb] of this.callbacks) if (cb.job && cb.inflight) { cb.inflight = false; this.queue.push(cb.job); }
  }

  registerPlanet(id, cfg, R) {
    this.planets.set(id, { cfg, R });
    for (const w of this.workers) w.postMessage({ type: 'planet', id, cfg, R });
  }

  localTerrain(id) {
    let t = this.local.get(id);
    if (!t) { const p = this.planets.get(id); t = new PlanetTerrain(p.cfg, p.R); this.local.set(id, t); }
    return t;
  }

  /** 타일 요청. priority 가 작을수록 먼저. */
  request(job, cb) {
    job.priority = job.priority || 0;
    this.callbacks.set(job.key, { cb, job, inflight: false });
    this.queue.push(job);
  }

  cancel(key) {
    const c = this.callbacks.get(key);
    if (c && !c.inflight) {
      this.callbacks.delete(key);
      const i = this.queue.findIndex((j) => j.key === key);
      if (i >= 0) this.queue.splice(i, 1);
    }
  }

  setPriority(key, p) {
    const c = this.callbacks.get(key);
    if (c) c.job.priority = p;
  }

  scatter(planet, id, payload, cb) {
    this.scatterCb.set(id, cb);
    const msg = { type: 'scatter', planet, id, ...payload };
    if (this.workers.length) {
      // 가장 한가한 워커
      let best = 0;
      for (let i = 1; i < this.workers.length; i++) if (this.busy[i] < this.busy[best]) best = i;
      this.workers[best].postMessage(msg);
    } else {
      const t = this.localTerrain(planet);
      const pts = payload.points;
      const out = new Float32Array(pts.length / 3 * 4);
      for (let i = 0, j = 0; i < pts.length; i += 3, j += 4) {
        const h = t.height(pts[i], pts[i + 1], pts[i + 2], payload.minW || 2);
        out[j] = h; out[j + 1] = t.out.moist; out[j + 2] = t.out.extra; out[j + 3] = 0;
      }
      setTimeout(() => this._onMessage(-1, { type: 'scatter', id, planet, data: out }), 0);
    }
  }

  _onMessage(wi, m) {
    if (m.type === 'tile') {
      if (wi >= 0) this.busy[wi] = Math.max(0, this.busy[wi] - 1);
      const c = this.callbacks.get(m.key);
      this.callbacks.delete(m.key);
      this.stats.done++;
      if (c && !m.error) c.cb(m.data);
    } else if (m.type === 'scatter') {
      const cb = this.scatterCb.get(m.id);
      this.scatterCb.delete(m.id);
      if (cb) cb(m.data);
    }
  }

  /** 매 프레임: 대기열에서 우선순위 순으로 작업 배분 */
  update(budgetMs = 4) {
    if (!this.queue.length) return;
    this.queue.sort((a, b) => a.priority - b.priority);
    if (this.workers.length) {
      for (let i = 0; i < this.workers.length; i++) {
        while (this.busy[i] < this.maxInFlight && this.queue.length) {
          const job = this.queue.shift();
          const c = this.callbacks.get(job.key);
          if (!c) continue;
          c.inflight = true;
          this.busy[i]++;
          this.workers[i].postMessage({ type: 'tile', ...job });
        }
      }
    } else {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < budgetMs) {
        const job = this.queue.shift();
        const c = this.callbacks.get(job.key);
        if (!c) continue;
        const d = buildTile(this.localTerrain(job.planet), job.face, job.level, job.ix, job.iy, job.N);
        this.callbacks.delete(job.key);
        c.cb(d);
      }
    }
  }

  get pending() { return this.queue.length + this.busy.reduce((a, b) => a + b, 0); }
}
