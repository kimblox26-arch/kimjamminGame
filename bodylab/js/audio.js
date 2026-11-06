// 소리: 전부 WebAudio 로 실시간 합성. 슬로우 모션이면 음높이가 내려가고 길어진다.
// 비명: 성대(톱니파+떨림) → 모음 포먼트 필터 → 거친 왜곡
const VOW = { a: [[800, 1], [1150, 0.6], [2900, 0.3], [3900, 0.2]], e: [[600, 1], [1800, 0.5], [2600, 0.3], [3500, 0.2]], o: [[480, 1], [820, 0.5], [2500, 0.15], [3400, 0.1]], u: [[350, 1], [700, 0.35], [2400, 0.12], [3300, 0.08]], ae: [[900, 1], [1650, 0.7], [2700, 0.35], [3700, 0.2]] };

export class Audio {
  constructor() { this.ctx = null; this.ts = 1; this.loops = {}; }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = 0.8;
    this.lp = C.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(this.lp).connect(comp).connect(C.destination);
    this.rev = C.createConvolver(); this.rev.buffer = this.impulse(2.4); this.revIn = C.createGain(); this.revIn.gain.value = 0.35;
    this.revIn.connect(this.rev).connect(this.master);
    const n = C.sampleRate * 2; this.noise = C.createBuffer(1, n, C.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.curve = new Float32Array(1024).map((_, i) => { const x = i / 512 - 1; return Math.tanh(x * 3.5); });
    this.mkLoops();
  }
  impulse(sec) { const C = this.ctx, n = C.sampleRate * sec, b = C.createBuffer(2, n, C.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); } return b; }
  get pf() { return Math.max(0.32, Math.min(1, Math.pow(this.ts, 0.35))); }
  setSlow(ts) { this.ts = ts; if (!this.ctx) return; const t = this.ctx.currentTime; this.lp.frequency.setTargetAtTime(ts < 0.9 ? 1800 + ts * 9000 : 20000, t, 0.08); }
  listener(cam) {
    if (!this.ctx) return; const L = this.ctx.listener, p = cam.position, f = cam.getWorldDirection(this._v || (this._v = cam.position.clone()));
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }
  out(pos, gain = 1, rev = 0.3) {
    const C = this.ctx, g = C.createGain(); g.gain.value = gain;
    if (pos) { const p = C.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2; p.rolloffFactor = 1.1; p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; g.connect(p); p.connect(this.master); if (rev) { const s = C.createGain(); s.gain.value = rev; p.connect(s); s.connect(this.revIn); } }
    else g.connect(this.master);
    return g;
  }
  nz(dest, t0, dur, { type = 'lowpass', f = 1000, q = 0.7, a = 0.002, g = 1, f2 = null } = {}) {
    const C = this.ctx, s = C.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = this.pf;
    const fl = C.createBiquadFilter(); fl.type = type; fl.frequency.value = f * this.pf; fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2 * this.pf, t0 + dur);
    const e = C.createGain(); e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(g, t0 + a); e.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    s.connect(fl).connect(e).connect(dest); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }
  tone(dest, t0, dur, f0, f1, { type = 'sine', g = 1, a = 0.003 } = {}) {
    const C = this.ctx, o = C.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0 * this.pf, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * this.pf), t0 + dur);
    const e = C.createGain(); e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(g, t0 + a); e.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(e).connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  gun(kind, pos) {
    if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf;
    const P = { pistol: [3500, 0.2, 110, 1], rifle: [5200, 0.16, 90, 1], shotgun: [2400, 0.38, 65, 1.4], sniper: [6500, 0.5, 55, 1.6] }[kind];
    const o = this.out(pos, P[3], 0.8);
    this.nz(o, t, P[1] * k, { f: P[0], g: 1.2, a: 0.0008 });
    this.nz(o, t, 0.03 * k, { type: 'highpass', f: 3000, g: 0.9, a: 0.0003 });
    this.tone(o, t, 0.25 * k, P[2] * 2, P[2] * 0.5, { g: 1.1 });
    this.tone(o, t + 0.06 * k, 0.04 * k, 1800, 1500, { type: 'square', g: 0.05 });
  }
  impact(kind, pos, g = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, g);
    if (kind === 'flesh') { this.tone(o, t, 0.12 * k, 95, 45, { g: 0.9 }); this.nz(o, t, 0.09 * k, { f: 900, g: 0.6 }); }
    else if (kind === 'metal') { this.tone(o, t, 0.4 * k, 2600, 2500, { g: 0.25 }); this.tone(o, t, 0.3 * k, 3900, 3800, { g: 0.15 }); this.nz(o, t, 0.05 * k, { type: 'highpass', f: 2500, g: 0.4 }); }
    else { this.nz(o, t, 0.12 * k, { type: 'bandpass', f: 1600, q: 0.8, g: 0.8 }); this.tone(o, t, 0.08 * k, 400, 200, { g: 0.2 }); }
  }
  crack(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, 1); for (let i = 0; i < 4; i++) this.nz(o, t + i * 0.012 * k, 0.025 * k, { type: 'highpass', f: 1800 + Math.random() * 1500, g: 0.8 - i * 0.15, a: 0.0005 }); this.tone(o, t, 0.06 * k, 300, 120, { g: 0.4 }); }
  splat(pos, g = 1) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, g); this.nz(o, t, 0.3 * k, { f: 700, f2: 250, g: 0.9, q: 3 }); this.tone(o, t, 0.15 * k, 120, 60, { g: 0.5 }); }
  stab(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, 1); this.nz(o, t, 0.12 * k, { type: 'bandpass', f: 1300, f2: 500, q: 2, g: 0.9 }); this.tone(o, t, 0.08 * k, 160, 70, { g: 0.6 }); }
  thud(pos, g = 1) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, g); this.tone(o, t, 0.18 * k, 140, 50, { g: 1 }); this.nz(o, t, 0.1 * k, { f: 1500, g: 0.7 }); this.nz(o, t, 0.03 * k, { type: 'highpass', f: 2500, g: 0.5 }); }
  whoosh(pos, g = 1) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, g * 0.5); this.nz(o, t, 0.3 * k, { type: 'bandpass', f: 300, f2: 1400, q: 1.5, g: 0.6, a: 0.12 * k }); }
  click() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.out(null, 0.15), t, 0.04, 2200, 1800, { type: 'square', g: 0.3 }); }
  explosion(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, 2, 1); this.nz(o, t, 2.2 * k, { f: 600, f2: 80, g: 1.5, a: 0.002 }); this.tone(o, t, 1.2 * k, 70, 25, { g: 1.4 }); for (let i = 0; i < 12; i++) this.nz(o, t + Math.random() * 0.8 * k, 0.04 * k, { type: 'highpass', f: 2000, g: 0.3 }); }
  splash(pos, p = 1) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, Math.min(1.5, 0.4 + p * 0.4)); this.nz(o, t, (0.4 + p * 0.3) * k, { type: 'bandpass', f: 1500, f2: 400, q: 0.8, g: 1, a: 0.01 }); for (let i = 0; i < 6; i++) this.tone(o, t + Math.random() * 0.4 * k, 0.05 * k, 600 + Math.random() * 800, 1500 + Math.random() * 800, { g: 0.12 }); }
  // 사람 목소리
  voice(h, kind, inten = 1) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime, pf = this.pf, k = 1 / pf;
    if (h._v && h._v.end > t && kind !== 'scream' && kind !== 'death') return;
    if (h._v && h._v.end > t) { try { h._v.g.gain.cancelScheduledValues(t); h._v.g.gain.setTargetAtTime(0, t, 0.02); } catch (e) { } }
    const pos = h.particles[0].p, base = h.isPlayer ? 0.9 : 1;
    const S = {
      scream: { f0: 340 + Math.random() * 90, dur: 1.1 + Math.random() * 0.7, v: Math.random() < 0.5 ? 'a' : 'ae', rough: 0.75, g: 1.0 },
      pain: { f0: 270 + Math.random() * 60, dur: 0.45, v: 'e', rough: 0.55, g: 0.8 },
      moan: { f0: 120 + Math.random() * 20, dur: 1.2, v: 'o', rough: 0.25, g: 0.5 },
      cry: { f0: 230, dur: 1.5, v: 'u', rough: 0.35, g: 0.6, trem: 7 },
      death: { f0: 190, dur: 1.4, v: 'a', rough: 0.6, g: 0.7, fall: 1 },
      drown: { f0: 160, dur: 0.9, v: 'u', rough: 0.4, g: 0.6, bub: 1 },
    }[kind];
    const f0 = S.f0 * base * pf, dur = S.dur * k, end = t + dur;
    const o = this.out(pos, S.g * (0.5 + 0.5 * inten) * 0.9, 0.5);
    const env = C.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1, t + 0.05 * k); env.gain.setValueAtTime(1, end - 0.25 * k); env.gain.linearRampToValueAtTime(0, end);
    if (S.trem) { const lfo = C.createOscillator(), lg = C.createGain(); lfo.frequency.value = S.trem * pf; lg.gain.value = 0.5; lfo.connect(lg).connect(env.gain); lfo.start(t); lfo.stop(end); }
    const sh = C.createWaveShaper(); sh.curve = this.curve; const pre = C.createGain(); pre.gain.value = 0.4 + S.rough * 1.2;
    const sum = C.createGain(); sum.gain.value = 0.35;
    sum.connect(pre).connect(sh).connect(env).connect(o);
    const osc = C.createOscillator(); osc.type = 'sawtooth';
    const fq = osc.frequency;
    fq.setValueAtTime(f0 * 0.82, t); fq.exponentialRampToValueAtTime(f0 * 1.12, t + dur * 0.15); fq.exponentialRampToValueAtTime(f0 * (S.fall ? 0.5 : 0.92), t + dur * 0.8); fq.exponentialRampToValueAtTime(f0 * (S.fall ? 0.35 : 0.7), end);
    const vib = C.createOscillator(), vg = C.createGain(); vib.frequency.value = 5.5 * pf; vg.gain.value = f0 * 0.035; vib.connect(vg).connect(fq);
    const jit = C.createBufferSource(); jit.buffer = this.noise; jit.playbackRate.value = 0.02; const jg = C.createGain(); jg.gain.value = f0 * 0.6 * S.rough; jit.connect(jg).connect(fq);
    const osc2 = C.createOscillator(); osc2.type = 'square'; osc2.frequency.value = f0; vg.connect(osc2.frequency); fq.value; 
    const src = C.createGain(); osc.connect(src); const o2g = C.createGain(); o2g.gain.value = 0.25 * S.rough; osc2.connect(o2g).connect(src);
    // 숨소리
    const br = C.createBufferSource(); br.buffer = this.noise; const bf = C.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 2200 * pf; bf.Q.value = 0.8; const bg = C.createGain(); bg.gain.value = 0.25 * S.rough;
    br.connect(bf).connect(bg).connect(src);
    for (const [F, A] of VOW[S.v]) { const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = F * pf; f.Q.value = F / 110; const g = C.createGain(); g.gain.value = A * 3; src.connect(f).connect(g).connect(sum); }
    if (S.bub) { for (let i = 0; i < 10; i++) this.tone(o, t + Math.random() * dur, 0.05, 300 + Math.random() * 500, 900 + Math.random() * 600, { g: 0.3 }); }
    for (const s of [osc, osc2, vib, jit, br]) { s.start(t); s.stop(end + 0.05); }
    h._v = { end, g: env };
  }
  // 장치 소리 (계속 나는 소리)
  mkLoops() {
    const C = this.ctx;
    const mk = (build) => { const g = C.createGain(); g.gain.value = 0; const p = C.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 2; p.rolloffFactor = 1; g.connect(p).connect(this.master); build(g); return { g, p }; };
    this.loops.saw = mk(g => { const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 190; const o2 = C.createOscillator(); o2.type = 'square'; o2.frequency.value = 380; const n = C.createBufferSource(); n.buffer = this.noise; n.loop = true; const hp = C.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000; const m = C.createGain(); m.gain.value = 0.12; o.connect(m); o2.connect(m); n.connect(hp).connect(m); m.connect(g); o.start(); o2.start(); n.start(); this.sawOsc = [o, o2]; });
    this.loops.buzz = mk(g => { const o = C.createOscillator(); o.type = 'square'; o.frequency.value = 100; const n = C.createBufferSource(); n.buffer = this.noise; n.loop = true; const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4000; const m = C.createGain(); m.gain.value = 0.1; o.connect(m); n.connect(bp).connect(m); m.connect(g); o.start(); n.start(); });
    this.loops.eng = mk(g => { const o = C.createOscillator(); o.type = 'sawtooth'; const o2 = C.createOscillator(); o2.type = 'square'; const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; const m = C.createGain(); m.gain.value = 0.25; const m2 = C.createGain(); m2.gain.value = 0.12; o.connect(lp); o2.connect(m2).connect(lp); lp.connect(m).connect(g); o.start(); o2.start(); this.engOsc = [o, o2, lp]; });
    this.loops.skid = mk(g => { const n = C.createBufferSource(); n.buffer = this.noise; n.loop = true; const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 3; const m = C.createGain(); m.gain.value = 0.35; n.connect(bp).connect(m).connect(g); n.start(); });
    this.loops.hyd = mk(g => { const n = C.createBufferSource(); n.buffer = this.noise; n.loop = true; const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 2; const o = C.createOscillator(); o.frequency.value = 55; const m = C.createGain(); m.gain.value = 0.3; n.connect(bp).connect(m); o.connect(m); m.connect(g); n.start(); o.start(); });
  }
  loop(name, gain, pos) {
    if (!this.ctx) return; const L = this.loops[name], t = this.ctx.currentTime;
    L.g.gain.setTargetAtTime(gain, t, 0.05);
    L.p.positionX.value = pos.x; L.p.positionY.value = pos.y; L.p.positionZ.value = pos.z;
    if (name === 'saw' && this.sawOsc) { this.sawOsc[0].frequency.setTargetAtTime(190 * this.pf * (gain > 0.3 ? 0.85 : 1), t, 0.05); this.sawOsc[1].frequency.setTargetAtTime(380 * this.pf, t, 0.05); }
  }
  // 엔진: rpm 은 속도로 (rpm<0 이면 끔), 미끄러짐 소리
  engine(sp, skid, pos) {
    if (!this.ctx || !this.engOsc) return; const t = this.ctx.currentTime;
    const on = sp >= 0, gear = Math.min(4, Math.floor(Math.max(0, sp) / 11)), rpm = 0.25 + ((Math.max(0, sp) - gear * 11) / 11) * 0.75;
    const f = (38 + rpm * 70 + gear * 6) * this.pf;
    this.engOsc[0].frequency.setTargetAtTime(f, t, 0.05); this.engOsc[1].frequency.setTargetAtTime(f * 0.5, t, 0.05); this.engOsc[2].frequency.setTargetAtTime(500 + rpm * 1500, t, 0.05);
    this.loop('eng', on ? 0.25 + rpm * 0.2 : 0, pos); this.loop('skid', on ? skid * 0.5 : 0, pos);
  }
  shing(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, 0.9); this.nz(o, t, 0.25 * k, { type: 'highpass', f: 3000, g: 0.6 }); this.tone(o, t, 0.2 * k, 400, 120, { type: 'square', g: 0.2 }); }
  boing(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, 1); this.tone(o, t, 0.5 * k, 90, 300, { type: 'triangle', g: 0.8 }); this.nz(o, t, 0.15 * k, { f: 600, g: 0.6 }); }
  zap(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, 0.7); for (let i = 0; i < 5; i++) this.nz(o, t + i * 0.02 * k, 0.03 * k, { type: 'highpass', f: 2500, g: 0.5 }); }
  slam(pos) { if (!this.ctx) return; const t = this.ctx.currentTime, k = 1 / this.pf, o = this.out(pos, 1.5, 0.7); this.tone(o, t, 0.5 * k, 80, 30, { g: 1.3 }); this.nz(o, t, 0.25 * k, { f: 900, g: 0.9 }); this.tone(o, t, 0.6 * k, 900, 850, { g: 0.08 }); }
}
