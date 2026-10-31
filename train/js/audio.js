// 모든 소리를 WebAudio 로 실시간 합성한다 (녹음 파일 없음)
import { clamp, smooth } from './geo.js';

export class Sound {
  constructor() { this.ctx = null; this.vol = { master: 0.8, train: 0.9, voice: 0.9, ui: 0.6 }; this.jointNext = 0; }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.out = C.createDynamicsCompressor(); this.out.threshold.value = -14; this.out.ratio.value = 4; this.out.connect(C.destination);
    this.master = this.gain(this.vol.master, this.out);
    this.trainBus = this.gain(this.vol.train, this.master); this.uiBus = this.gain(this.vol.ui, this.master); this.voiceBus = this.gain(this.vol.voice, this.master);
    // 터널 잔향
    this.verb = C.createConvolver(); const len = C.sampleRate * 1.8, ir = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    this.verb.buffer = ir; this.verbSend = this.gain(0.05, this.verb); this.verb.connect(this.trainBus);
    this.train = this.gain(1, this.trainBus); this.train.connect(this.verbSend);
    const nb = C.createBuffer(1, C.sampleRate * 3, C.sampleRate), d = nb.getChannelData(0); let b = 0;
    this.white = nb; const bb = C.createBuffer(1, C.sampleRate * 3, C.sampleRate), e = bb.getChannelData(0);
    for (let i = 0; i < d.length; i++) { d[i] = Math.random() * 2 - 1; b = (b + 0.02 * d[i]) / 1.02; e[i] = b * 3.5; }
    this.brown = bb;
  }
  setVol(k, v) { this.vol[k] = v; if (!this.ctx) return; ({ master: this.master, train: this.trainBus, voice: this.voiceBus, ui: this.uiBus })[k].gain.value = v; }
  gain(v, to) { const g = this.ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  noise(buf = this.white) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); this.live?.push(s); return s; }
  filt(type, f, q = 1, to) { const n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; if (to) n.connect(to); return n; }
  osc(type, f, to) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; if (to) o.connect(to); o.start(); this.live?.push(o); return o; }
  set(param, v, t = 0.08) { param.setTargetAtTime(v, this.ctx.currentTime, t); }

  // ── 열차 연속음 ──
  startTrain(spec) {
    if (!this.ctx) return; this.stopTrain();
    const N = this.nodes = {}, kind = spec.kind; this.kind = kind; this.live = [];
    // 구름 소리
    N.roll = this.gain(0, this.train); N.rollF = this.filt('lowpass', 200, 0.7, N.roll); N.rollB = this.filt('peaking', 110, 1.2, N.rollF); N.rollB.gain.value = 0;
    this.noise(this.brown).connect(N.rollB);
    N.hiss = this.gain(0, this.train); this.noise().connect(this.filt('bandpass', 2400, 0.6, N.hiss));
    // 바람
    N.wind = this.gain(0, this.train); N.windF = this.filt('bandpass', 700, 0.5, N.wind); this.noise().connect(N.windF);
    // 모터 (VVVF 인버터)
    N.mot = this.gain(0, this.train);
    N.car = this.osc('sawtooth', 800, this.filt('bandpass', 1200, 2.5, this.gain(0.35, N.mot)));
    N.hum = this.osc('square', 60, this.filt('lowpass', 900, 0.8, this.gain(0.3, N.mot)));
    N.hum2 = this.osc('sine', 120, this.gain(0.4, N.mot));
    // 송풍기 (고속·전기기관차)
    N.fan = this.gain(0, this.train); this.noise().connect(this.filt('bandpass', 900, 0.8, N.fan));
    // 디젤 엔진
    if (kind === 'diesel') {
      N.eng = this.gain(0, this.train); N.engO = this.osc('sawtooth', 28, this.filt('lowpass', 260, 1.2, N.eng));
      N.engLfo = this.osc('sine', 7, this.gain(0.25, N.eng.gain));
      N.turbo = this.gain(0, this.train); N.turboO = this.osc('sine', 2200, N.turbo);
    }
    // 플랜지·제동 쇳소리
    N.sq = this.gain(0, this.train); N.sqO = this.osc('sine', 2900, N.sq); N.sqL = this.osc('sine', 9, this.gain(400, N.sqO.frequency));
    N.bs = this.gain(0, this.train); N.bsO = this.osc('triangle', 3700, N.bs);
    // 공기압축기
    N.comp = this.gain(0, this.train); N.compO = this.osc('sawtooth', 19, this.filt('lowpass', 180, 1, N.comp)); this.noise(this.brown).connect(this.filt('lowpass', 300, 1, N.comp));
    // 승강장 웅성거림
    N.crowd = this.gain(0, this.trainBus); this.noise().connect(this.filt('bandpass', 450, 0.8, N.crowd)); N.crowdL = this.osc('sine', 0.7, this.gain(0.02, N.crowd.gain));
    // 기적
    N.horn = this.gain(0, this.trainBus);
    const hf = kind === 'hsr' ? [311, 392, 466] : kind === 'metro' ? [660, 880] : kind === 'diesel' ? [220, 277, 330] : [349, 440];
    const hl = this.filt('lowpass', kind === 'metro' ? 3000 : 1500, 0.7, N.horn);
    for (const f of hf) this.osc(kind === 'metro' ? 'square' : 'sawtooth', f, this.gain(0.22, hl));
    // ATC 경고
    N.bell = this.gain(0, this.uiBus); this.osc('sine', 1560, N.bell); N.bellL = this.osc('square', 4, this.gain(0.0, N.bell.gain));
  }
  stopTrain() {
    if (!this.nodes) return;
    for (const n of this.live) { try { n.stop(); n.disconnect(); } catch (e) { } }
    for (const k in this.nodes) { try { this.nodes[k].disconnect(); } catch (e) { } }
    this.nodes = null; this.live = null;
  }

  update(sim, dt, ext = 0) {
    const N = this.nodes; if (!N || !this.ctx) return;
    const v = Math.abs(sim.v), kmh = v * 3.6, hsr = this.kind === 'hsr', metro = this.kind === 'metro';
    const tun = sim.inTunnel ? 1 : 0, cab = 1 - ext;
    this.set(this.verbSend.gain, tun ? 0.55 : 0.04, 0.4);
    // 구름
    const rg = clamp(Math.pow(v / 30, 0.8), 0, 1.2) * (hsr ? 0.55 : 0.75) * (1 + tun * 0.9) * (0.75 + ext * 0.4);
    this.set(N.roll.gain, rg); this.set(N.rollF.frequency, 120 + kmh * 9);
    this.set(N.rollB.gain, sim.onBridge ? 9 : 0, 0.3);
    this.set(N.hiss.gain, clamp(v / 60, 0, 1) * 0.05 * (1 + tun));
    this.set(N.wind.gain, clamp((v / 75) ** 2, 0, 1.4) * (hsr ? 0.5 : 0.25) * (0.35 + ext * 0.8) * (1 + tun * 0.8)); this.set(N.windF.frequency, 400 + kmh * 4);
    // 모터
    const drive = Math.max(Math.abs(sim.te), sim.regen * 0.8);
    if (this.kind !== 'diesel') {
      const fm = kmh * (hsr ? 2.2 : 3.4) + 4;
      let fc;
      if (kmh < (hsr ? 25 : 16)) fc = hsr ? 1200 : 760;
      else if (kmh < (hsr ? 60 : 32)) fc = fm * 9; else if (kmh < (hsr ? 110 : 52)) fc = fm * 5; else if (kmh < (hsr ? 170 : 72)) fc = fm * 3; else fc = fm * 1.5 + 400;
      N.car.frequency.setTargetAtTime(fc, this.ctx.currentTime, 0.03);
      this.set(N.hum.frequency, Math.max(20, fm)); this.set(N.hum2.frequency, Math.max(40, fm * 2));
      this.set(N.mot.gain, drive * (metro ? 0.32 : hsr ? 0.2 : 0.26) * (0.5 + 0.5 * smooth(0, 4, kmh) + (kmh < 1 && drive > 0.05 ? 0.4 : 0)) * (1 + tun * 0.5));
      this.set(N.fan.gain, (hsr || this.kind === 'emu') && (sim.vcb) ? 0.018 + drive * 0.05 : 0, 0.5);
    } else {
      this.set(N.engO.frequency, sim.rpm / 60 * 4); this.set(N.eng.gain, sim.engine || sim.rpm > 60 ? 0.35 + sim.te * 0.35 : 0, 0.3);
      this.set(N.turboO.frequency, 1200 + sim.rpm * 2.6); this.set(N.turbo.gain, sim.engine ? 0.004 + sim.te * 0.02 : 0, 0.5);
      this.set(N.mot.gain, sim.te * 0.08);
    }
    // 곡선·제동 쇳소리
    const R = 1 / Math.max(sim.curv || 0, 1e-6);
    this.set(N.sq.gain, R < 450 && kmh > 8 ? (1 - R / 450) * 0.035 * smooth(8, 25, kmh) : 0, 0.2);
    this.set(N.bs.gain, sim.bc > 80 && v > 0.15 && v < 4.5 ? 0.025 * (sim.bc / 440) * smooth(0.15, 1.2, v) : 0, 0.1);
    this.set(N.comp.gain, sim.comp ? 0.14 * cab + 0.05 : 0, 0.4);
    this.set(N.crowd.gain, sim.doors !== 'closed' ? 0.045 : 0, 0.8);
    this.set(N.horn.gain, sim.horn ? 0.32 : 0, 0.03);
    this.set(N.bell.gain, sim.atcWarn ? 0.08 * (Math.sin(performance.now() / 120) > 0 ? 1 : 0) : 0, 0.01);
    // 레일 이음매
    const sp = hsr ? 0 : 25;
    if (sp && sim.jointAcc > sp && v > 0.5) {
      sim.jointAcc = 0;
      const t0 = this.ctx.currentTime, a = clamp(v / 25, 0.1, 1) * (1 + tun * 0.5);
      for (const [dx, g] of [[0, 1], [2.5, 0.85], [15, 0.45], [17.5, 0.4]]) this.joint(t0 + dx / v, a * g);
    } else if (!sp) sim.jointAcc = 0;
  }
  joint(t, a) {
    const C = this.ctx, s = C.createBufferSource(); s.buffer = this.white;
    const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25 * a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    s.connect(this.filt('bandpass', 900, 0.9, g)); g.connect(this.train); s.start(t, Math.random() * 2); s.stop(t + 0.12);
    const o = C.createOscillator(), og = C.createGain(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    og.gain.setValueAtTime(0.3 * a, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12); o.connect(og); og.connect(this.train); o.start(t); o.stop(t + 0.14);
  }
  burst(f, q, dur, g, bus = this.train, type = 'bandpass') {
    if (!this.ctx) return; const C = this.ctx, t = C.currentTime, s = C.createBufferSource(); s.buffer = this.white;
    const gg = C.createGain(); gg.gain.setValueAtTime(g, t); gg.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(this.filt(type, f, q, gg)); gg.connect(bus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(f, dur, g, at = 0, bus = this.uiBus, type = 'sine') {
    if (!this.ctx) return; const C = this.ctx, t = C.currentTime + at, o = C.createOscillator(), gg = C.createGain();
    o.type = type; o.frequency.value = f; gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(g, t + 0.01); gg.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gg); gg.connect(bus); o.start(t); o.stop(t + dur + 0.05);
  }
  // ── 효과음 ──
  click() { this.tone(180, 0.06, 0.25, 0, this.uiBus, 'triangle'); this.burst(3000, 1, 0.03, 0.08, this.uiBus); }
  clunk() { this.tone(90, 0.15, 0.4, 0, this.uiBus, 'triangle'); this.burst(1200, 1, 0.08, 0.15, this.uiBus); }
  air() { this.burst(3500, 0.4, 0.7, 0.12, this.train, 'highpass'); }
  doorOpen() { this.burst(2500, 0.5, 0.9, 0.12); this.tone(70, 0.25, 0.4, 2.4, this.train, 'triangle'); }
  doorClose() {
    [[659, 0], [523, 0.45], [659, 0.9], [523, 1.35]].forEach(([f, t]) => this.tone(f, 0.5, 0.14, t, this.train));
    setTimeout(() => { this.burst(600, 0.8, 1.6, 0.06, this.train, 'lowpass'); this.burst(2500, 0.5, 0.6, 0.08); }, 900);
    this.tone(60, 0.3, 0.5, 3.1, this.train, 'triangle');
  }
  chime() { [[784, 0], [659, 0.32], [523, 0.64], [392, 0.96]].forEach(([f, t]) => this.tone(f, 0.9, 0.16, t, this.voiceBus)); }
  atc() { this.tone(1200, 0.25, 0.15); this.tone(900, 0.35, 0.15, 0.25); }
  ui(kind = 'click') {
    if (!this.ctx) return;
    if (kind === 'hover') this.tone(1400, 0.05, 0.03);
    else if (kind === 'whoosh') this.burst(700, 0.6, 0.9, 0.12, this.uiBus, 'bandpass');
    else { this.tone(880, 0.08, 0.08); this.tone(1320, 0.12, 0.06, 0.05); }
  }
  engineStart() { this.burst(300, 1, 1.5, 0.3, this.train, 'lowpass'); }
  // 안내방송 (브라우저 한국어 음성)
  announce(text) {
    this.chime();
    const sy = window.speechSynthesis; if (!sy) return;
    setTimeout(() => {
      sy.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 1.0; u.pitch = 1.05; u.volume = this.vol.voice * this.vol.master;
      const v = sy.getVoices().find(v => v.lang && v.lang.startsWith('ko')); if (v) u.voice = v;
      sy.speak(u);
    }, 1400);
  }
}
