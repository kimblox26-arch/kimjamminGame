// 모든 소리는 WebAudio 로 실시간 합성. sounds/ 폴더에 scp096_cry.mp3 / scp096_scream.mp3 를 넣으면 그 파일을 대신 사용.
const rnd = (a, b) => a + Math.random() * (b - a);

export class AudioSys {
  init() {
    if (this.ctx) return this.ctx.resume();
    const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.connect(c.destination);
    this.master = this.g(0.9, comp);
    this.rev = c.createConvolver(); this.rev.buffer = this.ir(2.8); this.revOut = this.g(0.55, this.master); this.rev.connect(this.revOut);
    this.dry = this.g(1, this.master); this.dry.connect(this.rev);
    this.noise = this.makeNoise(3, false); this.brown = this.makeNoise(4, true);
    // 성문(glottal) 파형: 배음 1/n^1.25
    const N = 64, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) im[n] = 1 / Math.pow(n, 1.25) * (n % 2 ? 1 : 0.85);
    this.glottal = c.createPeriodicWave(re, im);
    this.ambient();
    this.voice = new Voice(this);
    this.custom = {};
    for (const k of ['cry', 'scream']) for (const ext of ['mp3', 'ogg', 'wav'])
      fetch(`sounds/scp096_${k}.${ext}`).then(r => r.ok ? r.arrayBuffer() : null).then(b => b && c.decodeAudioData(b)).then(buf => { if (buf && !this.custom[k]) this.custom[k] = buf; }).catch(() => {});
    this.nextBeat = 0; this.fear = 0;
  }
  g(v, to) { const n = this.ctx.createGain(); n.gain.value = v; if (to) n.connect(to); return n; }
  makeNoise(sec, brown) {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  ir(sec) {
    const c = this.ctx, len = c.sampleRate * sec, b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 900 ? 0.3 : 1) * (Math.random() < 0.002 && t < 0.15 ? 4 : 1); } }
    return b;
  }
  src(buf, loop = false, off = 0) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; s.start(this.ctx.currentTime, off); return s; }
  panner(pos, ref = 2, roll = 1.1) {
    const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 80;
    this.setPos(p, pos); p.connect(this.dry); return p;
  }
  setPos(p, v) { if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; } else p.setPosition(v.x, v.y, v.z); }
  listen(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, f = cam.getWorldDirection(this._f || (this._f = cam.position.clone())), p = cam.position;
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }
  // 짧은 잡음 타격음 (발소리·충돌 공용)
  hit(out, t, dur, freq, type, vol, q = 0.7) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.g(0, out); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g); s.start(t, rnd(0, 2.5)); s.stop(t + dur + 0.05);
  }
  tone(out, t, f0, f1, dur, vol, type = 'sine') {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.g(0, out); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  }
  step(pos, vol, heavy) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, p = this.panner(pos, 1.5);
    this.hit(p, t, heavy ? 0.16 : 0.09, heavy ? 420 : 1600, 'lowpass', vol);
    this.hit(p, t, 0.03, 3500, 'highpass', vol * (heavy ? 0.25 : 0.5));
    this.tone(p, t, heavy ? 95 : 140, 45, heavy ? 0.12 : 0.06, vol * (heavy ? 1.3 : 0.5));
    setTimeout(() => p.disconnect(), 600);
  }
  door(pos, gate) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, p = this.panner(pos, 2);
    const s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.35); f.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    const g = this.g(0, p); g.gain.linearRampToValueAtTime(0.35, t + 0.05); g.gain.linearRampToValueAtTime(0, t + 0.6);
    s.connect(f).connect(g); s.start(t, rnd(0, 2)); s.stop(t + 0.7);
    this.tone(p, t + 0.5, gate ? 60 : 80, 40, 0.25, 0.5);
    this.hit(p, t + 0.5, 0.12, 900, 'lowpass', 0.4);
    setTimeout(() => p.disconnect(), 1200);
  }
  doorBurst(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, p = this.panner(pos, 4, 0.8);
    this.hit(p, t, 0.9, 2500, 'lowpass', 1.6); this.hit(p, t, 0.35, 5000, 'highpass', 0.6);
    this.tone(p, t, 70, 30, 0.6, 1.5);
    for (const f of [187, 431, 822, 1293, 1911]) this.tone(p, t, f, f * 0.97, rnd(0.8, 1.6), 0.18, 'triangle');
    this.hit(p, t + 0.45, 0.4, 1200, 'lowpass', 0.8); // 바닥에 떨어짐
    setTimeout(() => p.disconnect(), 2500);
  }
  unlock() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.dry, t, 880, 880, 0.12, 0.2, 'square'); this.tone(this.dry, t + 0.15, 1320, 1320, 0.2, 0.2, 'square'); }
  pickup() { if (!this.ctx) return; const t = this.ctx.currentTime; [660, 880, 1320].forEach((f, i) => this.tone(this.master, t + i * 0.09, f, f, 0.5, 0.18, 'triangle')); }
  land(v) { if (!this.ctx) return; const t = this.ctx.currentTime; this.hit(this.dry, t, 0.2, 500, 'lowpass', Math.min(1, v)); this.tone(this.dry, t, 110, 40, 0.15, Math.min(1, v)); }
  ambient() {
    const c = this.ctx, b = this.src(this.brown, true), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    b.connect(f).connect(this.g(0.22, this.master));
    for (const [hz, v] of [[60, 0.012], [120, 0.008], [180, 0.004]]) { const o = c.createOscillator(); o.frequency.value = hz; o.connect(this.g(v, this.master)); o.start(); }
    // 플레이어 숨소리 (지칠 때)
    const br = this.src(this.noise, true), bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1100; bf.Q.value = 0.9;
    this.breathG = this.g(0, this.master); const bm = this.g(0, this.breathG); br.connect(bf).connect(bm);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.9; const lg = this.g(0.5, bm.gain); lfo.connect(lg); bm.gain.value = 0.5; lfo.start();
    this.breathLfo = lfo;
    // 경보 사이렌
    const so = c.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 700;
    const sl = c.createOscillator(); sl.type = 'square'; sl.frequency.value = 0.75; sl.connect(this.g(130, so.frequency)); sl.start();
    const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1800;
    this.sirenG = this.g(0, this.dry); so.connect(sf).connect(this.sirenG); so.start();
    this.clankT = c.currentTime + 6;
  }
  alarm(on) { if (this.ctx) this.sirenG.gain.setTargetAtTime(on ? 0.05 : 0, this.ctx.currentTime, 0.3); }
  stinger() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(150, t); f.frequency.exponentialRampToValueAtTime(4000, t + 1.8);
    const g = this.g(0, this.master); g.gain.linearRampToValueAtTime(0.32, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + 5);
    f.connect(g); f.connect(this.rev);
    for (const hz of [55, 58.3, 82.4, 87.3, 116.5, 123.5, 233]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = rnd(-12, 12); o.connect(f); o.start(t); o.stop(t + 5.2); }
    this.tone(this.master, t, 80, 25, 1.4, 1.2); this.hit(this.master, t, 1.5, 300, 'lowpass', 0.8);
  }
  kill() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(this.master, t, 60, 20, 1.2, 1.4); this.hit(this.master, t, 0.6, 700, 'lowpass', 1.4); this.hit(this.master, t + 0.05, 0.3, 3000, 'bandpass', 0.6); }
  // 매 프레임: 심장박동, 숨소리, 먼 금속음, 096 목소리
  update(dt, s) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    this.fear += (s.fear - this.fear) * Math.min(1, dt * 2);
    if (this.fear > 0.12 && t > this.nextBeat) {
      const v = 0.25 + this.fear * 0.9; this.tone(this.master, t, 62, 38, 0.16, v); this.tone(this.master, t + 0.17, 55, 35, 0.14, v * 0.7);
      this.nextBeat = t + 60 / (60 + this.fear * 110);
    }
    this.breathG.gain.setTargetAtTime(s.tired * 0.32, t, 0.3); this.breathLfo.frequency.value = 0.7 + s.tired * 0.8;
    if (t > this.clankT) { const p = this.panner({ x: rnd(0, 80), y: 3, z: rnd(0, 36) }, 6); for (const f of [rnd(150, 300), rnd(500, 900), rnd(1200, 2000)]) this.tone(p, t, f, f * 0.98, rnd(1, 2.4), 0.12, 'triangle'); this.clankT = t + rnd(9, 22); }
    this.voice.update(s.mood, s.pos096);
  }
}

// ── SCP-096 목소리: 성문 파형 + 포먼트 필터 + 숨 잡음 + 디스토션 ──
const VOW = { a: [850, 1250, 2750], u: [420, 880, 2450], e: [600, 1900, 2700], ae: [1000, 1650, 3050], o: [550, 950, 2600] };
class Voice {
  constructor(A) {
    const c = A.ctx; this.A = A; this.c = c;
    this.out = A.panner({ x: 0, y: 0, z: 0 }, 2.2, 1.05);
    this.osc = c.createOscillator(); this.osc.setPeriodicWave(A.glottal);
    this.osc2 = c.createOscillator(); this.osc2.setPeriodicWave(A.glottal); this.osc2.detune.value = 18;
    const mix = A.g(1); this.osc.connect(mix); this.osc2.connect(A.g(0.55, mix));
    this.drive = A.g(1); this.fs = [];
    for (let i = 0; i < 3; i++) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = [6, 9, 12][i]; mix.connect(f); f.connect(A.g([1, 0.55, 0.35][i] * 3.2, this.drive)); this.fs.push(f); }
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; mix.connect(lp); lp.connect(A.g(0.18, this.drive));
    const sh = c.createWaveShaper(), cur = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; cur[i] = Math.tanh(x * 2.5); } sh.curve = cur;
    this.env = A.g(0); this.trem = A.g(1);
    this.drive.connect(sh).connect(this.env).connect(this.trem).connect(this.out);
    this.lfo = c.createOscillator(); this.lfo.frequency.value = 6; this.tremD = A.g(0); this.lfo.connect(this.tremD).connect(this.trem.gain); this.lfo.start();
    // 숨/쉰 소리
    const n = A.src(A.noise, true); this.bf = c.createBiquadFilter(); this.bf.type = 'bandpass'; this.bf.Q.value = 1.4; this.bf.frequency.value = 1800;
    this.breath = A.g(0, this.out); n.connect(this.bf).connect(this.breath);
    this.osc.start(); this.osc2.start();
    this.t = 0; this.mood = 'silent'; this.loop = null;
  }
  P() { return [this.osc.frequency, this.osc2.frequency]; }
  pitch(t, f, lin = true) { for (const p of this.P()) lin ? p.linearRampToValueAtTime(f, t) : p.setValueAtTime(f, t); }
  vowel(t, v, k = 1) { this.fs.forEach((f, i) => f.frequency.linearRampToValueAtTime(VOW[v][i] * k, t)); }
  cancel(t) {
    for (const p of [...this.P(), this.env.gain, this.breath.gain, this.tremD.gain, this.bf.frequency, this.drive.gain, this.lfo.frequency, ...this.fs.map(f => f.frequency)]) { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
  }
  update(mood, pos) {
    const A = this.A, c = this.c, now = c.currentTime;
    if (pos) A.setPos(this.out, pos);
    if (mood !== this.mood) {
      this.mood = mood; this.cancel(now); this.t = now;
      if (this.loop) { this.loop.stop(); this.loop = null; }
      const key = mood === 'sob' ? 'cry' : mood === 'silent' ? null : 'scream';
      if (key && A.custom[key]) { this.loop = A.src(A.custom[key], true); this.loop.connect(this.out); this.env.gain.setTargetAtTime(0, now, 0.05); this.breath.gain.setTargetAtTime(0, now, 0.05); return; }
      if (mood === 'silent') { this.env.gain.setTargetAtTime(0, now, 0.08); this.breath.gain.setTargetAtTime(0, now, 0.08); }
    }
    if (this.loop || mood === 'silent' || now + 0.35 < this.t) return;
    const t = Math.max(this.t, now + 0.02);
    if (mood === 'sob') {
      const r = Math.random();
      this.t = r < 0.3 ? this.gasp(t, 0.35) : r < 0.82 ? this.wail(t, rnd(300, 380), rnd(1.3, 2.6), 0.55, rnd(0.45, 0.7)) : r < 0.92 ? this.whimper(t) : this.pause(t);
    } else if (mood === 'panic') {
      const r = Math.random();
      this.t = r < 0.25 ? this.gasp(t, 0.8) : r < 0.75 ? this.wail(t, rnd(480, 640), rnd(0.6, 1.3), 1, rnd(0.6, 0.85)) : this.scream(t, rnd(0.6, 1.2), 0.9);
    } else if (mood === 'scream') {
      this.t = Math.random() < 0.82 ? this.scream(t, rnd(1.4, 3.0), 1.25) : this.gasp(t, 1.2);
    }
  }
  // 흐느끼며 들이쉬는 숨 "흐-흐-흡"
  gasp(t, v) {
    const n = 2 + (Math.random() * 3 | 0), b = this.breath.gain, f = this.bf.frequency;
    this.env.gain.setTargetAtTime(0, t, 0.02);
    for (let i = 0; i < n; i++) {
      const s = t + i * rnd(0.1, 0.16);
      b.setValueAtTime(0, s); b.linearRampToValueAtTime(v * 0.9, s + 0.025); b.linearRampToValueAtTime(v * 0.15, s + 0.09);
      f.setValueAtTime(900 + i * 350, s); f.linearRampToValueAtTime(2200 + i * 400, s + 0.09);
    }
    const end = t + n * 0.14 + 0.05; b.linearRampToValueAtTime(0, end);
    return end + rnd(0.02, 0.15);
  }
  // 떨리며 내려가는 울음 "아-아-아우…"
  wail(t, p, d, v, trem) {
    const e = this.env.gain;
    this.pitch(t, p * 0.92, false); this.vowel(t, Math.random() < 0.5 ? 'a' : 'ae');
    this.lfo.frequency.setValueAtTime(rnd(4.8, 7.2), t); this.tremD.gain.setValueAtTime(trem * 0.5, t); this.trem.gain.setValueAtTime(1 - trem * 0.5, t);
    this.drive.gain.setValueAtTime(0.7 + v * 0.6, t);
    e.setValueAtTime(0, t); e.linearRampToValueAtTime(0.5 * v, t + 0.07);
    this.pitch(t + d * 0.22, p * 1.12);
    for (let k = 0.3; k < 1; k += 0.1) this.pitch(t + d * k, p * (1.12 - 0.42 * k) * rnd(0.97, 1.03));
    this.vowel(t + d, 'u');
    e.linearRampToValueAtTime(0.42 * v, t + d * 0.7); e.linearRampToValueAtTime(0, t + d);
    const b = this.breath.gain; this.bf.frequency.setValueAtTime(2400, t);
    b.setValueAtTime(0.12 * v, t); b.linearRampToValueAtTime(0.2 * v, t + d * 0.8); b.linearRampToValueAtTime(0, t + d);
    return t + d + rnd(0.05, 0.3);
  }
  whimper(t) {
    const d = rnd(0.25, 0.45), p = rnd(520, 680), e = this.env.gain;
    this.pitch(t, p, false); this.pitch(t + d, p * 0.7); this.vowel(t, 'e'); this.vowel(t + d, 'u');
    this.tremD.gain.setValueAtTime(0.1, t);
    e.setValueAtTime(0, t); e.linearRampToValueAtTime(0.35, t + 0.04); e.linearRampToValueAtTime(0, t + d);
    return t + d + rnd(0.1, 0.4);
  }
  pause(t) {
    const d = rnd(0.4, 1.1);
    if (Math.random() < 0.6) { const b = this.breath.gain; this.bf.frequency.setValueAtTime(4200, t + 0.1); b.setValueAtTime(0, t + 0.1); b.linearRampToValueAtTime(0.25, t + 0.13); b.linearRampToValueAtTime(0, t + 0.22); }
    return t + d;
  }
  // 찢어지는 비명
  scream(t, d, v) {
    const e = this.env.gain, p = rnd(780, 1020);
    this.vowel(t, 'ae', rnd(0.95, 1.1)); this.drive.gain.setValueAtTime(2.2, t);
    this.lfo.frequency.setValueAtTime(rnd(9, 14), t); this.tremD.gain.setValueAtTime(0.18, t); this.trem.gain.setValueAtTime(0.82, t);
    this.pitch(t, p * 0.75, false); this.pitch(t + 0.12, p);
    for (let s = t + 0.12; s < t + d; s += rnd(0.05, 0.1)) this.pitch(s, p * rnd(0.9, 1.1) * (1 + 0.15 * Math.sin((s - t) * 3)));
    this.pitch(t + d, p * 0.6);
    e.setValueAtTime(0, t); e.linearRampToValueAtTime(0.75 * v, t + 0.08); e.linearRampToValueAtTime(0.7 * v, t + d * 0.85); e.linearRampToValueAtTime(0, t + d);
    const b = this.breath.gain; this.bf.frequency.setValueAtTime(3000, t); b.setValueAtTime(0, t); b.linearRampToValueAtTime(0.5 * v, t + 0.1); b.linearRampToValueAtTime(0, t + d);
    return t + d + 0.03;
  }
}
