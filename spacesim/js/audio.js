// SpaceSim — 실시간 합성 우주 앰비언트 (WebAudio, 외부 음원 없음)
export class SpaceAudio {
  constructor() { this.ctx = null; this.on = false; }

  _init() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // 잔향
    const len = ctx.sampleRate * 4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.7;
    this.verb.connect(wet).connect(this.master);
    // 드론
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 3;
    const drone = ctx.createGain(); drone.gain.value = 0.16;
    lp.connect(drone); drone.connect(this.master); drone.connect(this.verb);
    [[55, 'sine'], [82.41, 'sine'], [110.3, 'triangle'], [164.8, 'sine'], [41.2, 'sine']].forEach(([f, type], i) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = (i - 2) * 4;
      const g = ctx.createGain(); g.gain.value = i === 4 ? 0.5 : 0.22;
      const l = ctx.createOscillator(); l.frequency.value = 0.03 + i * 0.017;
      const lg = ctx.createGain(); lg.gain.value = 0.12;
      l.connect(lg).connect(g.gain);
      o.connect(g).connect(lp); o.start(); l.start();
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain(); lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    // 우주풍 노이즈
    const nb = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; nd[i] = last * 3.5; }
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.value = 0.25;
    ns.connect(bp).connect(ng); ng.connect(this.master); ng.connect(this.verb); ns.start();
  }

  setEnabled(on) {
    this.on = on;
    if (on && !this.ctx) { try { this._init(); } catch { return; } }
    if (!this.ctx) return;
    if (on) this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.5 : 0, t, 0.8);
  }

  blip(freq = 220) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - (this._lastBlip || 0) < 0.12) return;
    this._lastBlip = t;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq * 2, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.4);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); g.connect(this.master); g.connect(this.verb);
    o.start(t); o.stop(t + 1.7);
  }
}
