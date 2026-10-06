// 실시간 합성 사운드 (WebAudio) — 샘플 파일 없이 모든 소리를 생성
import { rand, clamp } from './util.js';

export class Sfx {
  constructor() { this.ctx = null; this.vol = 0.8; this.cool = new Map(); }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = C.createGain(); this.master.gain.value = this.vol;
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(C.destination);
    // 작업장 잔향 (합성 임펄스 응답)
    this.rev = C.createConvolver(); this.rev.buffer = this.makeIR(1.6, 2.6);
    this.revIn = C.createGain(); this.revIn.gain.value = 0.32;
    this.revIn.connect(this.rev).connect(this.master);
    this.white = this.noiseBuf(2, 'white'); this.brown = this.noiseBuf(3, 'brown');
    this.arcBuf = this.makeArcBuf();
    this.listener = C.listener;
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  makeIR(sec, decay) {
    const C = this.ctx, n = Math.floor(C.sampleRate * sec), b = C.createBuffer(2, n, C.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 200 ? i / 200 : 1); }
    return b;
  }
  noiseBuf(sec, kind) {
    const C = this.ctx, n = Math.floor(C.sampleRate * sec), b = C.createBuffer(1, n, C.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  // 용접 아크: 튀김 같은 '지글지글' 크래클 + 험
  makeArcBuf() {
    const C = this.ctx, sr = C.sampleRate, n = sr * 3, b = C.createBuffer(1, n, sr), d = b.getChannelData(0);
    let env = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      if (Math.random() < 900 / sr) env = Math.random() ** 2 * 1.0;
      env *= 0.9965;
      const w = Math.random() * 2 - 1; lp += (w - lp) * 0.55;
      d[i] = (w - lp) * env * 0.9 + w * 0.05 + Math.sin(i / sr * Math.PI * 2 * 120) * 0.04 * (0.6 + Math.random() * 0.4);
    }
    return b;
  }
  // 3D 위치 출력 노드
  out(pos, vol = 1, rev = 1) {
    const C = this.ctx, g = C.createGain(); g.gain.value = vol;
    let node = g;
    if (pos) {
      const p = C.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = 2; p.rolloffFactor = 1.1; p.maxDistance = 400;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p); node = p;
    }
    node.connect(this.master);
    if (rev) { const s = C.createGain(); s.gain.value = rev; node.connect(s).connect(this.revIn); }
    return g;
  }
  setListener(cam) {
    if (!this.ctx) return;
    const L = this.listener, p = cam.position, t = this.ctx.currentTime;
    const f = cam.getWorldDirection(this._f || (this._f = cam.position.clone()));
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }
  limit(key, ms) {
    const now = performance.now(), last = this.cool.get(key) || 0;
    if (now - last < ms) return false; this.cool.set(key, now); return true;
  }
  noise(dst, t, dur, type, freq, q, vol, attack = 0.001, buf = this.white) {
    const C = this.ctx, s = C.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(dst); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return f;
  }
  tone(dst, t, freq, dur, vol, type = 'sine', attack = 0.002) {
    const C = this.ctx, o = C.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(dst); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }
  // 금속 타격음: 비조화 모드 합성 (크기 → 기본 주파수)
  metal(pos, vol = 1, size = 1, ring = 1) {
    const C = this.ctx, t = C.currentTime, o = this.out(pos, vol, 0.8);
    const f0 = clamp(520 / Math.sqrt(size), 90, 2400) * rand(0.92, 1.08);
    const ratios = [1, 1.59, 2.14, 2.83, 3.61, 4.37, 5.65, 7.1];
    ratios.forEach((r, i) => this.tone(o, t, f0 * r * rand(0.99, 1.01), (1.6 * ring) / (1 + i * 0.55), 0.22 / (1 + i * 0.35)));
    this.noise(o, t, 0.05, 'highpass', 2500, 0.7, 0.5);
  }
  play(name, opt = {}) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime, pos = opt.pos, v = opt.vol ?? 1;
    switch (name) {
      case 'clang': this.metal(pos, v, opt.size ?? 1, opt.ring ?? 1); break;
      case 'tap': { const o = this.out(pos, v * 0.6); this.tone(o, t, rand(1800, 2400), 0.12, 0.2); this.noise(o, t, 0.03, 'highpass', 3000, 1, 0.3); break; }
      case 'thud': { // 나무
        const o = this.out(pos, v); this.noise(o, t, 0.16, 'bandpass', rand(260, 420), 1.4, 1.1);
        this.tone(o, t, rand(140, 190), 0.12, 0.5, 'triangle'); this.noise(o, t, 0.03, 'highpass', 1800, 0.8, 0.4); break;
      }
      case 'nail': { const o = this.out(pos, v); this.tone(o, t, rand(2600, 3400), 0.35, 0.18); this.tone(o, t, rand(4100, 4700), 0.2, 0.1); this.noise(o, t, 0.08, 'bandpass', 380, 1.3, 0.8); break; }
      case 'stone': { const o = this.out(pos, v); this.noise(o, t, 0.12, 'bandpass', rand(900, 1500), 0.8, 1); this.noise(o, t, 0.25, 'lowpass', 300, 0.7, 0.5, 0.002, this.brown); break; }
      case 'glass': {
        const o = this.out(pos, v);
        this.noise(o, t, 0.25, 'highpass', 3500, 0.6, 0.9);
        for (let i = 0; i < 22; i++) { const tt = t + Math.random() ** 2 * 0.7; this.tone(o, tt, rand(2500, 7500), rand(0.05, 0.25), rand(0.03, 0.12)); }
        break;
      }
      case 'place': { const o = this.out(pos, v * 0.7); this.noise(o, t, 0.1, 'lowpass', 700, 1, 0.9, 0.002, this.brown); this.tone(o, t, 110, 0.1, 0.4, 'triangle'); break; }
      case 'clamp': { const o = this.out(pos, v * 0.6); for (let i = 0; i < 4; i++) this.noise(o, t + i * 0.045, 0.03, 'bandpass', 3200, 3, 0.5); this.metal(pos, v * 0.25, 0.08, 0.3); break; }
      case 'unclamp': { const o = this.out(pos, v * 0.6); this.noise(o, t, 0.05, 'bandpass', 2400, 2, 0.6); this.metal(pos, v * 0.3, 0.07, 0.4); break; }
      case 'bolt': { const o = this.out(pos, v); for (let i = 0; i < 6; i++) this.noise(o, t + i * 0.04, 0.03, 'bandpass', 1800 + i * 100, 4, 0.6); this.metal(pos, v * 0.3, 0.05, 0.5); break; }
      case 'click': { const o = this.out(null, v * 0.4, 0); this.tone(o, t, 1700, 0.04, 0.3, 'square'); break; }
      case 'ui': { const o = this.out(null, v * 0.3, 0); this.tone(o, t, 880, 0.08, 0.3); this.tone(o, t + 0.05, 1320, 0.1, 0.25); break; }
      case 'error': { const o = this.out(null, v * 0.3, 0); this.tone(o, t, 220, 0.18, 0.3, 'square'); this.tone(o, t + 0.09, 180, 0.2, 0.3, 'square'); break; }
      case 'step': { const o = this.out(pos, v * 0.35); this.noise(o, t, 0.06, 'bandpass', opt.soft ? 500 : 1300, 0.9, 0.7); break; }
      case 'swoosh': { const o = this.out(pos, v * 0.25, 0.2); const f = this.noise(o, t, 0.2, 'bandpass', 600, 1.2, 0.6, 0.06); f.frequency.exponentialRampToValueAtTime(1800, t + 0.18); break; }
      case 'crack': { const o = this.out(pos, v); this.noise(o, t, 0.08, 'highpass', 1500, 0.8, 1); this.noise(o, t, 0.3, 'bandpass', 500, 1, 0.5); break; }
      case 'snap': { const o = this.out(pos, v); this.noise(o, t, 0.12, 'bandpass', 1200, 1.5, 1.2); this.metal(pos, v * 0.6, 0.3, 0.8); break; }
      case 'horn': { const o = this.out(pos, v * 0.5); this.tone(o, t, 420, 0.5, 0.3, 'sawtooth', 0.02); this.tone(o, t, 520, 0.5, 0.25, 'sawtooth', 0.02); break; }
      case 'ignite': { const o = this.out(pos, v); for (let i = 0; i < 8; i++) this.noise(o, t + i * 0.07, 0.08, 'lowpass', 300, 1, 0.8, 0.005, this.brown); break; }
    }
  }
  // 충돌 충격음 (재질별)
  impact(mat, force, pos) {
    if (!this.ctx) return;
    const v = clamp(Math.log10(force / 300) * 0.45, 0.05, 1.2);
    if (mat === 'metal') this.play('clang', { pos, vol: v * 0.7, size: rand(0.5, 2.5), ring: 0.6 });
    else if (mat === 'wood') this.play('thud', { pos, vol: v });
    else if (mat === 'glass') this.play('tap', { pos, vol: v });
    else this.play('stone', { pos, vol: v * 0.8 });
  }
  // 루프 사운드 핸들
  loop(kind) {
    if (!this.ctx) return null;
    const C = this.ctx, out = this.out(null, 0, 0.6); out.gain.value = 0;
    const nodes = [], h = { out, nodes, kind, p: {} };
    const src = (buf, rate = 1) => { const s = C.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * 2); nodes.push(s); return s; };
    const osc = (type, f) => { const o = C.createOscillator(); o.type = type; o.frequency.value = f; o.start(); nodes.push(o); return o; };
    const filt = (type, f, q = 1) => { const b = C.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    if (kind === 'arc') {
      const s = src(this.arcBuf); const hp = filt('highpass', 700); s.connect(hp).connect(out);
    } else if (kind === 'grinder') {
      const o = osc('sawtooth', 170), o2 = osc('square', 340); const bp = filt('bandpass', 1400, 0.8);
      const g2 = C.createGain(); g2.gain.value = 0.3; o.connect(bp); o2.connect(g2).connect(bp); bp.connect(out);
      const n = src(this.white); const nb = filt('bandpass', 5200, 1.2); const ng = C.createGain(); ng.gain.value = 0; n.connect(nb).connect(ng).connect(out);
      h.p = { o, o2, ng, bp };
    } else if (kind === 'drill') {
      const o = osc('sawtooth', 95); const lp = filt('lowpass', 1600, 2); const trem = C.createGain(); trem.gain.value = 0.6;
      const lfo = osc('square', 22); const lg = C.createGain(); lg.gain.value = 0; lfo.connect(lg).connect(trem.gain);
      o.connect(lp).connect(trem).connect(out); const n = src(this.white); const nb = filt('bandpass', 3000, 1); const ng = C.createGain(); ng.gain.value = 0.15; n.connect(nb).connect(ng).connect(out);
      h.p = { o, lg, lp };
    } else if (kind === 'spray') {
      const n = src(this.white); const hp = filt('highpass', 2500, 0.5); n.connect(hp).connect(out);
    } else if (kind === 'engine') {
      const o1 = osc('sawtooth', 40), o2 = osc('square', 80), o3 = osc('sawtooth', 120.5);
      const lp = filt('lowpass', 600, 3); const ws = C.createWaveShaper(); const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); } ws.curve = curve;
      const g1 = C.createGain(), g2 = C.createGain(), g3 = C.createGain(); g1.gain.value = 0.5; g2.gain.value = 0.25; g3.gain.value = 0.18;
      o1.connect(g1).connect(ws); o2.connect(g2).connect(ws); o3.connect(g3).connect(ws); ws.connect(lp).connect(out);
      const n = src(this.brown); const nb = filt('bandpass', 300, 0.8); const ng = C.createGain(); ng.gain.value = 0.4; n.connect(nb).connect(ng).connect(out);
      h.p = { o1, o2, o3, lp, ng };
    } else if (kind === 'thruster') {
      const n = src(this.brown); const lp = filt('lowpass', 500, 0.7); n.connect(lp).connect(out);
      const n2 = src(this.white); const bp = filt('bandpass', 1800, 0.6); const g = C.createGain(); g.gain.value = 0.15; n2.connect(bp).connect(g).connect(out);
    } else if (kind === 'ambient') {
      const n = src(this.brown, 0.7); const lp = filt('lowpass', 260, 0.5); n.connect(lp).connect(out);
      const hum = osc('sine', 60); const hg = C.createGain(); hg.gain.value = 0.03; hum.connect(hg).connect(out);
    } else if (kind === 'fire') {
      const s = src(this.arcBuf, 0.35); const lp = filt('lowpass', 900); s.connect(lp).connect(out);
      const n = src(this.brown); n.connect(out);
    }
    h.set = (vol, pitch = 1, extra = 0) => this.loopSet(h, vol, pitch, extra);
    h.stop = () => { out.gain.setTargetAtTime(0, C.currentTime, 0.05); setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch (e) {} }), 400); };
    return h;
  }
  loopSet(h, vol, pitch, extra) {
    const t = this.ctx.currentTime, p = h.p;
    h.out.gain.setTargetAtTime(vol, t, 0.04);
    if (h.kind === 'grinder') {
      p.o.frequency.setTargetAtTime(170 * pitch, t, 0.15); p.o2.frequency.setTargetAtTime(340 * pitch, t, 0.15);
      p.ng.gain.setTargetAtTime(extra * 0.9, t, 0.03); p.bp.frequency.setTargetAtTime(1000 + 900 * pitch, t, 0.1);
    } else if (h.kind === 'drill') {
      p.o.frequency.setTargetAtTime(60 + 90 * pitch, t, 0.08); p.lg.gain.setTargetAtTime(extra * 0.5, t, 0.03); p.lp.frequency.setTargetAtTime(600 + 2000 * pitch, t, 0.08);
    } else if (h.kind === 'engine') {
      const f = pitch; // 점화 주파수(Hz)
      p.o1.frequency.setTargetAtTime(f, t, 0.03); p.o2.frequency.setTargetAtTime(f * 2, t, 0.03); p.o3.frequency.setTargetAtTime(f * 3.01, t, 0.03);
      p.lp.frequency.setTargetAtTime(300 + f * 8 + extra * 1500, t, 0.05); p.ng.gain.setTargetAtTime(0.2 + extra * 0.6, t, 0.05);
    } else if (h.nodes[0]?.playbackRate) {
      h.nodes[0].playbackRate.setTargetAtTime(pitch, t, 0.05);
    }
  }
}
