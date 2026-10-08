// 전 지구 쓰나미 시뮬레이션 — 워커 래퍼 (메인 스레드)
export class GlobalSim {
  constructor(data, { quality = 'medium' } = {}) {
    this.factor = quality === 'low' ? 2 : 1;
    this.W = data.W / this.factor;
    this.H = data.H / this.factor;
    this.t = 0;
    this.active = false;
    this.eta = null;
    this.max = null;
    this.arr = null;
    this.series = [];          // 관측점 시계열 [t, eta, t, eta, ...]
    this.gauge = null;
    this.stepsPerSec = 0;
    this.scale = 600;
    this.paused = false;
    this.onFrame = null;
    this.recvAt = 0;
    this.ready = new Promise((res) => { this._ready = res; });
    this.worker = new Worker(new URL('./globalswe.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onMessage(e.data);
    const elev = new Int16Array(data.elev);
    this.worker.postMessage({ cmd: 'init', W: data.W, H: data.H, elev, factor: this.factor }, [elev.buffer]);
  }

  onMessage(m) {
    if (m.type === 'ready') { this.dt = m.dt; this._ready(); return; }
    if (m.type === 'gauge') { this.gauge = m.gauge; return; }
    if (m.type === 'tt') { this.tt = m.tt; if (this.onTT) this.onTT(this); return; }
    if (m.type !== 'frame') return;
    // 이전 버퍼는 워커로 돌려보내 재사용
    if (this.eta) this.worker.postMessage({ cmd: 'return', buf: this.eta }, [this.eta.buffer]);
    this.eta = m.eta;
    if (m.max) { this.max = m.max; this.arr = m.arr; }
    this.t = m.t;
    this.active = m.active;
    this.stepsPerSec = m.stepsPerSec;
    this.recvAt = performance.now();
    if (m.gauge && m.gauge.length) {
      for (const v of m.gauge) this.series.push(v);
      if (this.series.length > 40000) this.series.splice(0, this.series.length - 30000);
    }
    if (this.onFrame) this.onFrame(this);
  }

  /** 화면 표시에 쓸 현재 시각 (마지막 프레임 이후 경과분 외삽) */
  now() {
    if (!this.active || this.paused) return this.t;
    return this.t + Math.min(0.3, (performance.now() - this.recvAt) / 1000) * this.scale;
  }

  addSource(src) {
    this.worker.postMessage({ cmd: 'source', src });
    this.active = true;
  }

  setTimeScale(s) { this.scale = s; this.worker.postMessage({ cmd: 'speed', scale: s }); }
  pause(p) { this.paused = p; this.worker.postMessage({ cmd: 'pause', paused: p }); }

  reset() {
    this.worker.postMessage({ cmd: 'reset' });
    this.series = [];
    this.t = 0;
    this.active = false;
  }

  setGauge(lon, lat) { this.series = []; this.worker.postMessage({ cmd: 'gauge', lon, lat }); }

  /** 경위도 → 격자 셀 번호 */
  cellOf(lon, lat) {
    const i = Math.floor(((((lon + 180) % 360) + 360) % 360) / (360 / this.W));
    const j = Math.max(0, Math.min(this.H - 1, Math.floor((90 - lat) / (180 / this.H))));
    return j * this.W + Math.min(this.W - 1, i);
  }

  /** 발생 지점 → 도시(관측점) 장파 도달 시간(초). 아직 계산 전이거나 육지면 null */
  travelTime(lon, lat) {
    if (!this.tt) return null;
    const v = this.tt[this.cellOf(lon, lat)];
    return Number.isFinite(v) ? v : null;
  }

  /** 관측점 수위 (선형 보간) */
  gaugeAt(t) {
    const s = this.series, n = s.length;
    if (n < 2) return 0;
    if (t <= s[0]) return 0;
    if (t >= s[n - 2]) return s[n - 1];
    let lo = 0, hi = n / 2 - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid * 2] <= t) lo = mid; else hi = mid; }
    const t0 = s[lo * 2], t1 = s[hi * 2], a = (t - t0) / Math.max(1e-6, t1 - t0);
    return s[lo * 2 + 1] * (1 - a) + s[hi * 2 + 1] * a;
  }

  dispose() { this.worker.terminate(); }

  /** 모멘트 규모 추정 (μ=3×10¹⁰ Pa, 미끄럼 ≈ 융기/0.35) */
  static magnitude(src) {
    if (src.type !== 'quake') return null;
    const slip = Math.max(0.05, src.height_m / 0.35);
    const M0 = 3e10 * src.length_km * 1000 * src.width_km * 1000 * slip;
    return (2 / 3) * (Math.log10(M0) - 9.1);
  }
}
