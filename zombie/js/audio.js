// 사운드 엔진: 전부 WebAudio 실시간 합성(3D HRTF, 거리 감쇠·공기흡수·음속 지연, 실내/실외 잔향)
// sounds/manifest.json 에 이름을 적고 같은 이름의 mp3/ogg 를 넣으면 실제 녹음으로 자동 교체됩니다.
import * as THREE from 'three';

const R = Math.random;
export class AudioEngine {
  constructor() { this.ctx = null; this.vol = 0.8; this.samples = {}; this.active = 0; this.lp = new THREE.Vector3(); this.amb = {}; this.evT = 3; this.chaos = 1; this.indoor = 0; }
  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.9; this.ambBus.connect(this.master);
    this.revOut = this.conv(this.ir(2.6, 2.4, true), 0.32); this.revIn = ctx.createGain(); this.revIn.connect(this.revOut.in);
    this.roomOut = this.conv(this.ir(0.55, 3.5, false), 0.28); this.roomIn = ctx.createGain(); this.roomIn.connect(this.roomOut.in); this.roomIn.gain.value = 0; this.revIn.gain.value = 1;
    const mk = (n, f) => { const b = ctx.createBuffer(1, ctx.sampleRate * n, ctx.sampleRate), d = b.getChannelData(0); f(d); return b; };
    this.white = mk(3, d => { for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1; });
    this.pink = mk(3, d => { let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < d.length; i++) { const w = R() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.02) * 2.2; } });
    this.brown = mk(3, d => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (R() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    this.crackle = mk(2, d => { for (let i = 0; i < d.length; i++) d[i] = R() < 0.0015 ? (R() * 2 - 1) : d[i - 1] * 0.6 || 0; });
    this.hrtf = true;
    this.loadSamples();
  }
  async loadSamples() {
    try {
      const r = await fetch('./sounds/manifest.json'); if (!r.ok) return; const list = await r.json();
      for (const f of list) { try { const b = await (await fetch('./sounds/' + f)).arrayBuffer(); this.samples[f.replace(/\.\w+$/, '')] = await this.ctx.decodeAudioData(b); } catch (e) { } }
    } catch (e) { }
  }
  ir(dur, decay, outdoor) {
    const ctx = this.ctx, n = ctx.sampleRate * dur, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (R() * 2 - 1) * Math.pow(1 - i / n, decay) * (outdoor ? 0.5 : 1);
      if (outdoor) for (let k = 0; k < 9; k++) { const p = Math.floor(ctx.sampleRate * (0.04 + R() * 0.5)), a = 0.5 * (1 - p / n); for (let j = 0; j < 300; j++) if (p + j < n) d[p + j] += (R() * 2 - 1) * a * (1 - j / 300); }
    }
    return b;
  }
  conv(buf, g) { const c = this.ctx.createConvolver(); c.buffer = buf; const o = this.ctx.createGain(); o.gain.value = g; c.connect(o).connect(this.master); return { in: c, out: o }; }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  setIndoor(k) { if (!this.ctx) return; this.indoor = k; this.revIn.gain.value = 1 - k * 0.85; this.roomIn.gain.value = k; }
  listen(cam) {
    if (!this.ctx) return; const L = this.ctx.listener, p = cam.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    this.lp.copy(p);
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }
  // 출력 체인 생성 (pos 가 있으면 3D)
  out(o = {}, bus) {
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = o.vol ?? 1;
    let last = g;
    if (o.pos) {
      const d = o.pos.distanceTo(this.lp);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(500, 20000 / (1 + d / 35)) * (this.indoor > 0.5 && !o.inside ? 0.25 : 1);
      const p = ctx.createPanner(); p.panningModel = this.hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 1.5; p.rolloffFactor = o.roll || 1; p.maxDistance = 2000;
      if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; } else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      g.connect(lp).connect(p); last = p; g._panner = p;
    }
    last.connect(bus || this.sfx);
    const s = ctx.createGain(); s.gain.value = o.rev ?? 0.3; last.connect(s); s.connect(this.revIn); s.connect(this.roomIn);
    return g;
  }
  t(o) { let t = this.ctx.currentTime + (o.delay || 0); if (o.pos && o.sos) t += o.pos.distanceTo(this.lp) / 343; return t; }
  src(buf, t, dur, rate = 1, off = R() * 1.5) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(t, off); s.stop(t + dur + 0.05); this.active++; s.onended = () => this.active--; return s; }
  osc(type, f, t, dur) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.start(t); o.stop(t + dur + 0.05); this.active++; o.onended = () => this.active--; return o; }
  flt(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  env(t, a, peak, d, hold = 0) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); if (hold) g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d); return g; }
  shaper(k) { const s = this.ctx.createWaveShaper(), n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } s.curve = c; return s; }
  chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
  // 포먼트 목소리(비명/신음): pts = [[time, f0], ...]
  voice(t, dur, pts, forms, o = {}) {
    const ctx = this.ctx, out = this.out(o), src = this.osc('sawtooth', pts[0][1], t, dur);
    for (const [tt, f] of pts) src.frequency.linearRampToValueAtTime(f, t + tt);
    const jit = this.osc('sine', 5 + R() * 4, t, dur), jg = ctx.createGain(); jg.gain.value = pts[0][1] * (o.jit || 0.03); jit.connect(jg).connect(src.frequency);
    const e = this.env(t, o.a || 0.05, o.peak || 0.6, dur * 0.6, dur * 0.3); e.connect(out);
    let head = src; if (o.dist) { const sh = this.shaper(o.dist); src.connect(sh); head = sh; }
    for (const [f, q, g] of forms) { const b = this.flt('bandpass', f, q), gg = ctx.createGain(); gg.gain.value = g; head.connect(b).connect(gg).connect(e); }
    if (o.noise) { const n = this.src(this.white, t, dur), b = this.flt('bandpass', o.nf || 1800, 0.8), gg = ctx.createGain(); gg.gain.value = o.noise; this.chain(n, b, gg, e); }
    return e;
  }
  hit(t, buf, f, type, q, peak, d, o, rate = 1) { const n = this.src(buf, t, d + 0.1, rate), b = this.flt(type, f, q), e = this.env(t, 0.002, peak, d); this.chain(n, b, e, this.out(o)); return e; }
  play(name, o = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.active > 160 && !o.important) return;
    if (this.samples[name]) { const s = this.ctx.createBufferSource(); s.buffer = this.samples[name]; s.playbackRate.value = o.pitch || 1; s.connect(this.out(o)); s.start(this.t(o)); return; }
    const f = S[name]; if (f) try { f.call(this, this.t(o), o); } catch (e) { console.warn(name, e); }
  }
  loop(name, o = {}) {
    if (!this.ctx) return { stop() { }, set() { } };
    const f = L[name]; if (!f) return { stop() { }, set() { } };
    const out = this.out(o, o.amb ? this.ambBus : this.sfx), nodes = [];
    const h = f.call(this, out, nodes, o) || {};
    out.gain.value = 0; out.gain.linearRampToValueAtTime(o.vol ?? 1, this.ctx.currentTime + (o.fade ?? 0.4));
    return Object.assign({
      out, nodes, stop: (fd = 0.4) => { if (h.stopBirds) h.stopBirds(); const t = this.ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + fd); setTimeout(() => nodes.forEach(n => { try { n.stop(); } catch (e) { } n.disconnect && n.disconnect(); }), fd * 1000 + 100); },
      vol: (v, k = 0.1) => out.gain.setTargetAtTime(v, this.ctx.currentTime, k),
      pos: (p) => { const P = out._panner; if (P && P.positionX) { P.positionX.value = p.x; P.positionY.value = p.y; P.positionZ.value = p.z; } }
    }, h);
  }
  lsrc(buf, nodes, rate = 1) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, R() * 2); nodes.push(s); return s; }
  losc(type, f, nodes) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); nodes.push(o); return o; }
  // 도시 혼란 앰비언스 (먼 곳의 비명·총성·사이렌·폭발·경적…)
  update(dt, phase) {
    if (!this.ctx) return;
    this.evT -= dt * this.chaos; if (this.evT > 0) return;
    this.evT = 1.5 + R() * 5;
    const a = R() * Math.PI * 2, d = 120 + R() * 500, pos = new THREE.Vector3(this.lp.x + Math.cos(a) * d, this.lp.y + R() * 20, this.lp.z + Math.sin(a) * d);
    const r = R(), o = { pos, vol: 1.6, ref: 20, rev: 0.7, sos: true };
    if (r < 0.28) this.play('scream', { ...o, female: R() < 0.5, vol: 1.2 });
    else if (r < 0.42) { const n = 1 + (R() * 5 | 0), rifle = R() < 0.6; for (let i = 0; i < n; i++) this.play('gunshot', { ...o, kind: rifle ? 'rifle' : 'pistol', delay: i * (0.09 + R() * 0.25), vol: 2.5 }); }
    else if (r < 0.52) this.play('horn', o);
    else if (r < 0.6) this.play('explosion', { ...o, vol: 3 });
    else if (r < 0.7) this.play('dog', o);
    else if (r < 0.76) this.play('crow', { ...o, pos: pos.setY(this.lp.y + 15) });
    else if (r < 0.84) this.play('glass', o);
    else if (r < 0.92) this.play('sirenPass', o);
    else this.play('groan', { ...o, vol: 1.2 });
  }
}

// ---------- 원샷 사운드 ----------
const S = {
  alert(t, o) { // 긴급재난문자 수신음(이중톤 + 스마트폰 스피커 대역)
    const out = this.out({ ...o, vol: o.vol ?? 0.55, rev: 0.15 });
    for (let k = 0; k < 9; k++) {
      const t0 = t + k * 0.62;
      for (const f of [853, 960]) { const s = this.osc('square', f, t0, 0.5), e = this.env(t0, 0.005, 0.25, 0.04, 0.45); this.chain(s, this.flt('bandpass', 1400, 0.7), e, out); }
    }
    for (let k = 0; k < 6; k++) S.vibrate.call(this, t + k * 0.95, o);
  },
  vibrate(t, o) { const out = this.out({ ...o, vol: (o.vol ?? 0.5) * 0.7, rev: 0.05 }), s = this.osc('square', 170, t, 0.5), e = this.env(t, 0.01, 0.4, 0.05, 0.4); this.chain(s, this.flt('lowpass', 400), e, out); },
  scream(t, o) {
    const fem = o.female, dur = o.long ? 2.2 : 0.9 + R() * 0.9, f0 = fem ? 520 + R() * 200 : 300 + R() * 120;
    this.voice(t, dur, [[0, f0 * 0.8], [0.15, f0 * 1.15], [dur * 0.6, f0 * (1 + R() * 0.2)], [dur, f0 * 0.6]], fem ? [[900, 6, 1], [1400, 8, 0.7], [3000, 10, 0.4]] : [[750, 6, 1], [1200, 8, 0.6], [2600, 10, 0.3]], { ...o, peak: (o.vol ?? 1) * 0.5, noise: 0.15, jit: 0.04, dist: 2, rev: 0.6 });
  },
  groan(t, o) {
    const dur = 1.2 + R() * 1.6, f0 = (70 + R() * 45) * (o.pitch || 1);
    this.voice(t, dur, [[0, f0], [dur * 0.3, f0 * (1.2 + R() * 0.3)], [dur * 0.7, f0 * 0.9], [dur, f0 * 0.7]], [[450 + R() * 150, 4, 1], [1000 + R() * 200, 6, 0.5], [2400, 8, 0.2]], { ...o, peak: (o.vol ?? 1) * 0.7, noise: 0.25, nf: 900, jit: 0.12, dist: 6, a: 0.15, ref: 2 });
  },
  zgrowl(t, o) {
    const dur = 0.6 + R() * 0.7, f0 = (95 + R() * 50) * (o.pitch || 1);
    this.voice(t, dur, [[0, f0 * 1.4], [0.1, f0 * 1.7], [dur, f0]], [[600, 4, 1], [1300, 6, 0.6], [2800, 8, 0.3]], { ...o, peak: (o.vol ?? 1) * 0.9, noise: 0.4, nf: 1500, jit: 0.2, dist: 12, a: 0.03, ref: 2.5 });
  },
  zscream(t, o) {
    const dur = 0.9 + R() * 0.6, f0 = (330 + R() * 150) * (o.pitch || 1);
    this.voice(t, dur, [[0, f0 * 0.7], [0.12, f0 * 1.3], [dur * 0.7, f0 * 1.1], [dur, f0 * 0.5]], [[1000, 5, 1], [1800, 7, 0.7], [3400, 9, 0.4]], { ...o, peak: (o.vol ?? 1) * 0.9, noise: 0.5, nf: 2500, jit: 0.15, dist: 15, a: 0.02, ref: 3, rev: 0.5 });
  },
  zattack(t, o) { S.zgrowl.call(this, t, { ...o, vol: 1.2 }); this.hit(t + 0.35, this.white, 1200, 'bandpass', 2, 0.5, 0.15, o); },
  zpain(t, o) { const f = (140 + R() * 60) * (o.pitch || 1); this.voice(t, 0.35, [[0, f * 1.4], [0.35, f]], [[700, 4, 1], [1500, 6, 0.5]], { ...o, peak: 0.6, noise: 0.3, dist: 8, a: 0.01 }); },
  zstep(t, o) { this.hit(t, this.brown, 300, 'lowpass', 1, (o.vol ?? 0.4) * 1.5, 0.12, o); if (o.drag) this.hit(t + 0.05, this.pink, 1800, 'bandpass', 1, (o.vol ?? 0.3) * 0.25, 0.35, o); },
  step(t, o) {
    const s = o.surf || 'concrete', v = o.vol ?? 0.5, oo = { ...o, rev: 0.15 };
    if (s === 'wood') { this.hit(t, this.brown, 260, 'lowpass', 2, v * 1.6, 0.09, oo); this.hit(t, this.white, 2400, 'bandpass', 3, v * 0.08, 0.04, oo); }
    else if (s === 'grass') { this.hit(t, this.pink, 3500, 'bandpass', 0.7, v * 0.5, 0.18, oo); }
    else if (s === 'tile') { this.hit(t, this.white, 3200, 'bandpass', 2, v * 0.35, 0.035, oo); this.hit(t, this.brown, 300, 'lowpass', 1, v, 0.06, oo); }
    else if (s === 'water') { this.hit(t, this.white, 1200, 'bandpass', 1, v * 0.6, 0.25, oo); }
    else { this.hit(t, this.white, 1700, 'bandpass', 1.5, v * 0.3, 0.05, oo); this.hit(t, this.brown, 200, 'lowpass', 1, v * 1.2, 0.08, oo); }
  },
  gunshot(t, o) {
    const rifle = o.kind === 'rifle', v = o.vol ?? 1, oo = { ...o, rev: 1.2, ref: 6 };
    this.hit(t, this.white, 2500, 'highpass', 0.7, v * 1.0, rifle ? 0.07 : 0.05, oo);
    this.hit(t, this.pink, rifle ? 1800 : 2600, 'lowpass', 0.7, v * 1.1, rifle ? 0.25 : 0.16, oo);
    const s = this.osc('sine', rifle ? 160 : 130, t, 0.3); s.frequency.exponentialRampToValueAtTime(35, t + 0.18); const e = this.env(t, 0.001, v * 1.3, 0.2); this.chain(s, e, this.out(oo));
    if (!o.pos) { this.hit(t + 0.03, this.white, 6000, 'highpass', 1, 0.08, 0.3, { rev: 0.2 }); } // 귀 울림 성분
  },
  dryfire(t, o) { this.hit(t, this.white, 4000, 'bandpass', 4, 0.4, 0.02, o); },
  reload(t, o) { [0, 0.35, 0.9, 1.15].forEach((d, i) => this.hit(t + d, this.white, 2500 + i * 600, 'bandpass', 5, 0.35, 0.03, o)); },
  swing(t, o) { const n = this.src(this.pink, t, 0.4), b = this.flt('bandpass', 600, 1.5), e = this.env(t, 0.08, 0.5, 0.18); b.frequency.linearRampToValueAtTime(2200, t + 0.2); this.chain(n, b, e, this.out(o)); },
  meleeFlesh(t, o) { this.hit(t, this.brown, 180, 'lowpass', 2, 1.4, 0.15, o); this.hit(t, this.white, 700, 'bandpass', 2, 0.5, 0.12, o); this.hit(t + 0.02, this.white, 1800, 'bandpass', 4, 0.2, 0.06, o); },
  bulletFlesh(t, o) { this.hit(t, this.white, 900, 'bandpass', 2, 0.6, 0.08, o); this.hit(t, this.brown, 160, 'lowpass', 1, 0.8, 0.1, o); },
  bodyfall(t, o) { this.hit(t, this.brown, 140, 'lowpass', 1, 1.6, 0.25, o); this.hit(t + 0.08, this.brown, 220, 'lowpass', 1, 0.7, 0.18, o); },
  doorBang(t, o) { this.hit(t, this.brown, 120, 'lowpass', 2, 2.2, 0.3, { ...o, rev: 0.6 }); this.hit(t, this.white, 900, 'bandpass', 3, 0.5, 0.2, o); this.hit(t + 0.01, this.white, 3000, 'bandpass', 8, 0.15, 0.25, o); },
  doorOpen(t, o) { const s = this.osc('sawtooth', 90, t, 0.9), b = this.flt('bandpass', 1300, 12), e = this.env(t, 0.1, 0.25, 0.5, 0.2); s.frequency.linearRampToValueAtTime(140, t + 0.8); this.chain(s, b, e, this.out(o)); this.hit(t + 0.85, this.brown, 200, 'lowpass', 1, 0.8, 0.1, o); },
  lock(t, o) { this.hit(t, this.white, 3000, 'bandpass', 6, 0.6, 0.03, o); this.hit(t + 0.12, this.white, 2200, 'bandpass', 6, 0.5, 0.04, o); },
  drag(t, o) { const n = this.src(this.pink, t, 2.6), b = this.flt('bandpass', 400, 1.2), e = this.env(t, 0.1, 0.9, 0.4, 2); const l = this.osc('sine', 9, t, 2.6), lg = this.ctx.createGain(); lg.gain.value = 250; l.connect(lg).connect(b.frequency); this.chain(n, b, e, this.out(o)); },
  glass(t, o) { this.hit(t, this.white, 5000, 'highpass', 1, 0.7, 0.3, o); for (let i = 0; i < 14; i++) { const s = this.osc('sine', 2500 + R() * 5000, t + R() * 0.5, 0.15), e = this.env(t + R() * 0.5, 0.001, 0.08, 0.1); this.chain(s, e, this.out(o)); } },
  curtain(t, o) { const n = this.src(this.pink, t, 0.8), b = this.flt('bandpass', 2500, 0.8), e = this.env(t, 0.1, 0.35, 0.4, 0.2); this.chain(n, b, e, this.out(o)); this.hit(t, this.white, 5000, 'bandpass', 3, 0.05, 0.6, o); },
  click(t, o) { this.hit(t, this.white, 2800, 'bandpass', 5, 0.4, 0.02, o); },
  ui(t, o) { const s = this.osc('sine', 880, t, 0.1), e = this.env(t, 0.003, 0.12, 0.08); this.chain(s, e, this.out({ ...o, rev: 0 })); },
  pickup(t, o) { this.hit(t, this.pink, 2000, 'bandpass', 1, 0.4, 0.15, o); this.hit(t + 0.1, this.white, 3000, 'bandpass', 3, 0.15, 0.05, o); },
  rummage(t, o) { for (let i = 0; i < 6; i++) this.hit(t + i * 0.18 + R() * 0.1, this.pink, 1200 + R() * 2000, 'bandpass', 1, 0.35, 0.12, o); },
  eat(t, o) { for (let i = 0; i < 5; i++) this.hit(t + i * 0.32, this.white, 1800 + R() * 800, 'bandpass', 2, 0.35, 0.08, o); },
  drink(t, o) { for (let i = 0; i < 4; i++) { const s = this.osc('sine', 300, t + i * 0.45, 0.2), e = this.env(t + i * 0.45, 0.02, 0.35, 0.15); s.frequency.exponentialRampToValueAtTime(140, t + i * 0.45 + 0.15); this.chain(s, this.flt('lowpass', 600), e, this.out(o)); } },
  heartbeat(t, o) { const v = o.vol ?? 0.6; for (const [d, k] of [[0, 1], [0.16, 0.7]]) { const s = this.osc('sine', 55, t + d, 0.25), e = this.env(t + d, 0.01, v * k, 0.14); s.frequency.exponentialRampToValueAtTime(32, t + d + 0.15); this.chain(s, e, this.out({ rev: 0 })); } },
  breath(t, o) { const v = o.vol ?? 0.2, inh = this.src(this.pink, t, 0.6), b = this.flt('bandpass', o.ex ? 900 : 1500, 0.9), e = this.env(t, 0.15, v, 0.3, 0.1); this.chain(inh, b, e, this.out({ rev: 0.05 })); },
  hurt(t, o) { const f = 160 + R() * 40; this.voice(t, 0.4, [[0, f * 1.3], [0.4, f * 0.9]], [[650, 5, 1], [1100, 6, 0.6], [2500, 8, 0.2]], { peak: 0.5, noise: 0.25, dist: 3, a: 0.01, rev: 0.1 }); },
  crash(t, o) { this.hit(t, this.brown, 200, 'lowpass', 1, 2.5 * (o.vol ?? 1), 0.5, o); this.hit(t, this.white, 2500, 'bandpass', 1, 0.8 * (o.vol ?? 1), 0.4, o); S.glass.call(this, t + 0.05, o); },
  carHit(t, o) { this.hit(t, this.brown, 160, 'lowpass', 1, 2, 0.3, o); S.meleeFlesh.call(this, t, o); },
  explosion(t, o) { const v = o.vol ?? 1; this.hit(t, this.brown, 120, 'lowpass', 0.7, v * 2, 2.5, { ...o, rev: 1.5 }); this.hit(t, this.pink, 800, 'lowpass', 0.7, v * 0.8, 1.2, o); },
  horn(t, o) { const d = 0.4 + R() * 1.2; for (const f of [420, 520]) { const s = this.osc('square', f, t, d), e = this.env(t, 0.01, 0.15, 0.05, d); this.chain(s, this.flt('lowpass', 1800), e, this.out(o)); } },
  dog(t, o) { for (let i = 0; i < 2 + R() * 4; i++) { const tt = t + i * (0.35 + R() * 0.2); this.voice(tt, 0.18, [[0, 500], [0.05, 700], [0.18, 350]], [[900, 3, 1], [1800, 5, 0.5]], { ...o, peak: 0.6, noise: 0.3, dist: 5, a: 0.005 }); } },
  crow(t, o) { for (let i = 0; i < 1 + R() * 3; i++) { const tt = t + i * 0.55; this.voice(tt, 0.35, [[0, 520], [0.1, 620], [0.35, 450]], [[1200, 3, 1], [2400, 5, 0.6]], { ...o, peak: 0.5, noise: 0.5, nf: 2500, dist: 10, a: 0.01 }); } },
  sirenPass(t, o) { const d = 5, s = this.osc('sawtooth', 700, t, d); for (let k = 0; k <= 10; k++) s.frequency.linearRampToValueAtTime(k % 2 ? 1450 : 700, t + k * 0.5); const e = this.env(t, 1, 0.25, 1.5, 2.5); this.chain(s, this.flt('lowpass', 2500), e, this.out(o)); },
  tvOn(t, o) { this.hit(t, this.white, 3000, 'bandpass', 4, 0.4, 0.03, o); const s = this.osc('sine', 60, t, 0.3), e = this.env(t, 0.01, 0.2, 0.25); this.chain(s, e, this.out(o)); },
  jingle(t, o) { [659, 784, 988, 1319].forEach((f, i) => { const s = this.osc('triangle', f, t + i * 0.16, 0.5), e = this.env(t + i * 0.16, 0.01, 0.18, 0.4); this.chain(s, this.flt('bandpass', 1500, 0.6), e, this.out(o)); }); },
  splash(t, o) { this.hit(t, this.white, 1500, 'bandpass', 0.8, 0.8, 0.5, o); },
  heliPass(t, o) { const n = this.src(this.brown, t, 8), e = this.env(t, 3, 0.9, 4, 1), l = this.osc('square', 11, t, 8), lg = this.ctx.createGain(); lg.gain.value = 0.6; const am = this.ctx.createGain(); am.gain.value = 0.5; l.connect(lg).connect(am.gain); this.chain(n, this.flt('lowpass', 350), am, e, this.out(o)); }
};

// ---------- 루프 사운드 ----------
const L = {
  water(out, N) { const a = this.lsrc(this.white, N), b = this.flt('bandpass', 1100, 0.6), c = this.lsrc(this.pink, N), d = this.flt('bandpass', 400, 1); const l = this.losc('sine', 7, N), lg = this.ctx.createGain(); lg.gain.value = 300; l.connect(lg).connect(b.frequency); a.connect(b).connect(out); c.connect(d).connect(out); },
  wind(out, N) { const a = this.lsrc(this.brown, N, 0.6), b = this.flt('lowpass', 500, 0.5), l = this.losc('sine', 0.07, N), lg = this.ctx.createGain(); lg.gain.value = 250; l.connect(lg).connect(b.frequency); const g = this.ctx.createGain(); g.gain.value = 0.6; this.chain(a, b, g, out); },
  rain(out, N) { const a = this.lsrc(this.white, N), b = this.flt('highpass', 1200, 0.5), c = this.flt('lowpass', 7000, 0.5); const g = this.ctx.createGain(); g.gain.value = 0.35; this.chain(a, b, c, g, out); const k = this.lsrc(this.crackle, N, 2); const g2 = this.ctx.createGain(); g2.gain.value = 0.6; this.chain(k, this.flt('bandpass', 3000, 1), g2, out); },
  fire(out, N) { const a = this.lsrc(this.crackle, N, 1), b = this.flt('bandpass', 1800, 0.8); const c = this.lsrc(this.brown, N), d = this.flt('lowpass', 250); const g = this.ctx.createGain(); g.gain.value = 1.5; this.chain(a, b, g, out); c.connect(d).connect(out); },
  tv(out, N) { const a = this.lsrc(this.white, N), b = this.flt('bandpass', 2500, 0.4); const g = this.ctx.createGain(); g.gain.value = 0.15; this.chain(a, b, g, out); },
  radio(out, N) { const a = this.lsrc(this.white, N), b = this.flt('bandpass', 1800, 1.5); const g = this.ctx.createGain(); g.gain.value = 0.12; const l = this.losc('sine', 0.3, N), lg = this.ctx.createGain(); lg.gain.value = 0.08; l.connect(lg).connect(g.gain); this.chain(a, b, g, out); },
  birds(out, N) { // 간헐적 새소리(스케줄러)
    let alive = true; const tick = () => { if (!alive) return; const t = this.ctx.currentTime; for (let i = 0; i < 2 + R() * 4; i++) { const tt = t + i * 0.12, s = this.osc('sine', 3000 + R() * 1500, tt, 0.1), e = this.env(tt, 0.005, 0.05, 0.06); s.frequency.linearRampToValueAtTime(4200 + R() * 1500, tt + 0.08); this.chain(s, e, out); } setTimeout(tick, 1200 + R() * 4000); }; tick();
    return { stopBirds: () => alive = false };
  },
  crickets(out, N) { const s = this.losc('sine', 4600, N), am = this.ctx.createGain(); am.gain.value = 0; const l = this.losc('square', 28, N), lg = this.ctx.createGain(); lg.gain.value = 0.03; l.connect(lg).connect(am.gain); const l2 = this.losc('sine', 0.6, N), g2 = this.ctx.createGain(); g2.gain.value = 0.5; this.chain(s, am, g2, out); },
  siren(out, N, o) { const s = this.losc('sawtooth', 900, N), l = this.losc(o.hilo ? 'square' : 'sine', o.hilo ? 0.9 : 0.22, N), lg = this.ctx.createGain(); lg.gain.value = o.hilo ? 110 : 420; l.connect(lg).connect(s.frequency); const g = this.ctx.createGain(); g.gain.value = 0.25; this.chain(s, this.flt('lowpass', 2600), g, out); },
  alarm(out, N) { const s = this.losc('square', 780, N), l = this.losc('square', 2.2, N), lg = this.ctx.createGain(); lg.gain.value = 300; l.connect(lg).connect(s.frequency); const g = this.ctx.createGain(); g.gain.value = 0.15; this.chain(s, this.flt('lowpass', 2200), g, out); },
  engine(out, N) { const s = this.losc('sawtooth', 40, N), s2 = this.losc('square', 80, N), b = this.flt('lowpass', 500, 2), g = this.ctx.createGain(); g.gain.value = 0.4; s.connect(b); s2.connect(b); this.chain(b, g, out); const n = this.lsrc(this.brown, N), ng = this.ctx.createGain(); ng.gain.value = 0.3; n.connect(ng).connect(out); return { rpm: (r) => { s.frequency.setTargetAtTime(30 + r * 120, this.ctx.currentTime, 0.1); s2.frequency.setTargetAtTime(60 + r * 240, this.ctx.currentTime, 0.1); b.frequency.setTargetAtTime(400 + r * 1600, this.ctx.currentTime, 0.1); } }; },
  heli(out, N) { const n = this.lsrc(this.brown, N), l = this.losc('square', 12, N), am = this.ctx.createGain(); am.gain.value = 0.5; const lg = this.ctx.createGain(); lg.gain.value = 0.5; l.connect(lg).connect(am.gain); this.chain(n, this.flt('lowpass', 400), am, out); const w = this.losc('sawtooth', 1900, N), wg = this.ctx.createGain(); wg.gain.value = 0.02; this.chain(w, this.flt('bandpass', 2000, 4), wg, out); },
  hum(out, N) { const s = this.losc('sine', 60, N), g = this.ctx.createGain(); g.gain.value = 0.05; s.connect(g).connect(out); }
};
