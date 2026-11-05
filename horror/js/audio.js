// 사운드: 전부 WebAudio 로 합성 + 마이크 소리 감지
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.9; this.mic = null; this.micDb = -100; this.floor = -60; this.level = 0; this.sens = 1; }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.0; this.music.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0; this.amb.connect(this.master);
    // 노이즈 버퍼
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = i % 2 ? w : last * 3.5; }
    this.noiseBuf = b;
    const wb = ctx.createBuffer(1, n, ctx.sampleRate), wd = wb.getChannelData(0); for (let i = 0; i < n; i++) wd[i] = Math.random() * 2 - 1; this.white = wb;
    // 괴물 위치 소리
    this.mPan = ctx.createPanner(); Object.assign(this.mPan, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, rolloffFactor: 1.3, maxDistance: 40 });
    this.mPan.connect(this.sfx);
    this.startAmbience(); this.startChase();
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  get t() { return this.ctx.currentTime; }
  listener(cam, fwd) {
    if (!this.ctx) return; const L = this.ctx.listener;
    if (L.positionX) { L.positionX.value = cam.x; L.positionY.value = cam.y; L.positionZ.value = cam.z; L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }
  monsterAt(p) { if (!this.ctx) return; const P = this.mPan; if (P.positionX) { P.positionX.value = p.x; P.positionY.value = 1.6; P.positionZ.value = p.z; } else P.setPosition(p.x, 1.6, p.z); }
  pan(p) { const P = this.ctx.createPanner(); Object.assign(P, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, rolloffFactor: 1.2 }); if (P.positionX) { P.positionX.value = p.x; P.positionY.value = p.y ?? 1; P.positionZ.value = p.z; } else P.setPosition(p.x, p.y ?? 1, p.z); P.connect(this.sfx); return P; }

  // 기본 소리 조각
  noise(dest, t, dur, f, q, gain, type = 'bandpass', white = false) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = white ? this.white : this.noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.01, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    return fl;
  }
  tone(dest, t, dur, f, gain, type = 'sine', f2) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05); return o;
  }

  startAmbience() {
    const c = this.ctx, t = this.t;
    // 낮은 웅웅거림
    for (const [f, gv] of [[43.6, 0.18], [44.1, 0.16], [87.3, 0.04], [130.8, 0.015]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = c.createGain(); g.gain.value = gv; o.connect(g); g.connect(this.amb); o.start();
    }
    // 바람
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 300; fl.Q.value = 0.8;
    const g = c.createGain(); g.gain.value = 0.06; s.connect(fl); fl.connect(g); g.connect(this.amb); s.start();
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07; const lg = c.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(fl.frequency); lfo.start();
    this.ambT = 3;
  }
  ambience(on, dt) {
    if (!this.ctx) return;
    this.amb.gain.setTargetAtTime(on ? 0.9 : 0, this.t, 0.8);
    if (!on) return;
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 5 + Math.random() * 10;
      const r = Math.random(), p = this.pan({ x: (Math.random() - 0.5) * 30 + 14, y: 2, z: (Math.random() - 0.5) * 24 + 12 });
      if (r < 0.4) this.creak(p);
      else if (r < 0.6) { for (let i = 0; i < 3; i++) this.noise(p, this.t + i * 0.32, 0.12, 120, 2, 0.5, 'lowpass'); }
      else if (r < 0.8) this.whisper(p);
      else this.tone(p, this.t, 3, 640 + Math.random() * 300, 0.02, 'sine', 600);
    }
  }
  startChase() {
    const c = this.ctx;
    // 불협화음 현악 트레몰로
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1400; fl.connect(this.music);
    const trem = c.createGain(); trem.gain.value = 0.5; trem.connect(fl);
    const lfo = c.createOscillator(); lfo.frequency.value = 11; const lg = c.createGain(); lg.gain.value = 0.45; lfo.connect(lg); lg.connect(trem.gain); lfo.start();
    for (const f of [110, 116.5, 155.6, 220, 233.1]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 20; const g = c.createGain(); g.gain.value = 0.05; o.connect(g); g.connect(trem); o.start(); }
    this.beatT = 0;
  }
  chase(level, dt) { // 0..1
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(level * 0.55, this.t, level > 0.5 ? 0.15 : 1.2);
    if (level > 0.3) { this.beatT -= dt; if (this.beatT <= 0) { this.beatT = 0.42; this.tone(this.sfx, this.t, 0.25, 70, 0.5 * level, 'sine', 40); this.noise(this.sfx, this.t, 0.08, 2000, 1, 0.1 * level, 'highpass'); } }
  }
  heartbeat(rate, vol) {
    if (!this.ctx || vol <= 0.01) return;
    const t = this.t; this.hbT = this.hbT ?? 0;
    if (t < this.hbT) return; this.hbT = t + 60 / rate;
    this.tone(this.sfx, t, 0.18, 62, vol, 'sine', 40); this.tone(this.sfx, t + 0.22, 0.2, 55, vol * 0.75, 'sine', 38);
  }
  step(surface, run) {
    if (!this.ctx) return; const t = this.t, v = run ? 0.35 : 0.16;
    const f = surface === 'tile' || surface === 'marble' ? 1800 : surface === 'rug' ? 500 : 900;
    this.noise(this.sfx, t, run ? 0.09 : 0.07, f * (0.9 + Math.random() * 0.2), 1.4, v, 'bandpass');
    this.tone(this.sfx, t, 0.08, 90 + Math.random() * 20, v * 0.6, 'sine', 50);
    if (surface === 'wood' && Math.random() < 0.12) this.creak(this.sfx, 0.25);
  }
  monsterStep(p, run) {
    if (!this.ctx) return; this.monsterAt(p); const t = this.t;
    this.noise(this.mPan, t, 0.14, 300, 1.2, run ? 1.4 : 1.0, 'lowpass');
    this.tone(this.mPan, t, 0.22, 55, run ? 1.0 : 0.7, 'sine', 30);
    if (Math.random() < 0.25) this.creak(this.mPan, 0.5);
  }
  creak(dest, v = 0.4) {
    const t = this.t, c = this.ctx, o = c.createOscillator(); o.type = 'sawtooth';
    const base = 120 + Math.random() * 200; o.frequency.setValueAtTime(base, t);
    for (let i = 1; i < 8; i++) o.frequency.linearRampToValueAtTime(base * (0.8 + Math.random() * 0.6), t + i * 0.08);
    const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 900; fl.Q.value = 6;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v * 0.25, t + 0.05); g.gain.linearRampToValueAtTime(0, t + 0.65);
    o.connect(fl); fl.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.7);
  }
  whisper(dest) { const t = this.t; for (let i = 0; i < 6; i++) this.noise(dest, t + i * 0.18 + Math.random() * 0.1, 0.15, 2500 + Math.random() * 2500, 8, 0.12, 'bandpass', true); }
  door(p, monster) { if (!this.ctx) return; const d = this.pan(p); this.creak(d, monster ? 1.2 : 0.8); this.noise(d, this.t + 0.5, 0.15, 200, 1, 0.5, 'lowpass'); }
  drawer() { if (!this.ctx) return; const t = this.t; this.noise(this.sfx, t, 0.35, 700, 2, 0.25, 'bandpass'); this.tone(this.sfx, t + 0.3, 0.1, 140, 0.2); }
  pickup() { if (!this.ctx) return; const t = this.t; for (const [f, d] of [[1320, 0], [1760, 0.08], [2640, 0.16]]) this.tone(this.sfx, t + d, 0.5, f, 0.12, 'triangle'); this.noise(this.sfx, t, 0.08, 6000, 3, 0.1, 'bandpass', true); }
  paper() { if (!this.ctx) return; const t = this.t; for (let i = 0; i < 4; i++) this.noise(this.sfx, t + i * 0.06, 0.08, 3500, 1, 0.12, 'highpass', true); }
  unlock() { if (!this.ctx) return; const t = this.t; this.noise(this.sfx, t, 0.06, 3000, 4, 0.4, 'bandpass', true); this.noise(this.sfx, t + 0.15, 0.1, 1200, 3, 0.6, 'bandpass', true); this.tone(this.sfx, t + 0.15, 0.2, 180, 0.3, 'square', 120); }
  locked() { if (!this.ctx) return; const t = this.t; for (let i = 0; i < 3; i++) this.noise(this.sfx, t + i * 0.09, 0.07, 900, 3, 0.4, 'bandpass'); }
  beep(ok = true) { if (!this.ctx) return; this.tone(this.sfx, this.t, 0.09, ok ? 1200 : 220, 0.15, ok ? 'square' : 'sawtooth'); }
  alarm() { if (!this.ctx) return; const t = this.t; for (let i = 0; i < 4; i++) this.tone(this.sfx, t + i * 0.25, 0.2, i % 2 ? 660 : 880, 0.25, 'square'); }
  hide(type) { if (!this.ctx) return; const t = this.t; if (type === 'bed') { this.noise(this.sfx, t, 0.6, 400, 1, 0.25, 'lowpass'); } else { this.creak(this.sfx, 0.7); this.noise(this.sfx, t + 0.3, 0.3, 1500, 1, 0.1, 'bandpass'); } }
  stinger() {
    if (!this.ctx) return; const t = this.t;
    for (const f of [92.5, 98, 138.6, 196, 207.7, 293.7, 311.1]) this.tone(this.sfx, t, 2.2, f, 0.09, 'sawtooth', f * 0.97);
    this.noise(this.sfx, t, 1.2, 3000, 0.5, 0.35, 'highpass', true); this.tone(this.sfx, t, 1.5, 50, 0.8, 'sine', 30);
  }
  scream(p) {
    if (!this.ctx) return; this.monsterAt(p); const t = this.t;
    const c = this.ctx, ws = c.createWaveShaper(); const cur = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cur[i] = Math.tanh(x * 6); } ws.curve = cur;
    const g = c.createGain(); g.gain.value = 0.6; ws.connect(g); g.connect(this.mPan);
    for (const f of [380, 420, 560, 760]) { const o = this.tone(ws, t, 0.9, f, 0.3, 'sawtooth', f * 0.45); }
    this.noise(this.mPan, t, 0.8, 1800, 1, 1.0, 'bandpass', true);
  }
  jumpscare() {
    if (!this.ctx) return; const t = this.t;
    for (const f of [300, 317, 450, 600, 905]) this.tone(this.sfx, t, 1.6, f, 0.22, 'sawtooth', f * 0.4);
    this.noise(this.sfx, t, 1.6, 2000, 0.4, 1.4, 'bandpass', true); this.tone(this.sfx, t, 1.2, 60, 1, 'square', 30);
  }
  hit() { if (!this.ctx) return; const t = this.t; this.noise(this.sfx, t, 0.25, 400, 1, 1.2, 'lowpass'); this.tone(this.sfx, t, 0.3, 120, 0.8, 'square', 40); }
  drag() { if (!this.ctx) return; const t = this.t; for (let i = 0; i < 8; i++) this.noise(this.sfx, t + i * 0.55, 0.5, 250, 0.8, 0.35, 'lowpass'); }
  slam() { if (!this.ctx) return; const t = this.t; this.noise(this.sfx, t, 0.5, 150, 1, 1.4, 'lowpass'); this.tone(this.sfx, t, 0.5, 60, 1, 'sine', 30); }
  ding() { if (!this.ctx) return; const t = this.t; this.tone(this.sfx, t, 0.3, 1568, 0.15, 'sine'); this.tone(this.sfx, t + 0.1, 0.4, 2093, 0.12, 'sine'); }
  glitch() { if (!this.ctx) return; const t = this.t; for (let i = 0; i < 10; i++) this.tone(this.sfx, t + i * 0.04, 0.04, 200 + Math.random() * 3000, 0.08, 'square'); }
  thunder(delay = 0.6) { if (!this.ctx) return; const t = this.t + delay; this.noise(this.sfx, t, 3.5, 90, 0.7, 1.0, 'lowpass'); this.noise(this.sfx, t, 0.4, 1200, 0.5, 0.25, 'lowpass'); }
  tick() { if (!this.ctx) return; this.noise(this.sfx, this.t, 0.03, 3500, 6, 0.25, 'bandpass', true); }
  piano() { if (!this.ctx) return; const t = this.t; for (const [f, d] of [[233, 0], [277, 0.02], [329.6, 0.04]]) this.tone(this.sfx, t + d, 2.5, f, 0.18, 'triangle'); }
  light() { if (!this.ctx) return; this.tone(this.sfx, this.t, 0.04, 2500, 0.12, 'square'); }
  wind(on) { if (!this.ctx) return; if (on) { this.noise(this.sfx, this.t, 4, 600, 0.4, 0.4, 'bandpass', true); this.tone(this.sfx, this.t, 4, 523, 0.06, 'sine'); this.tone(this.sfx, this.t + 0.5, 3.5, 784, 0.05, 'sine'); } }

  // 괴물 목소리 (음성 합성, 낮고 느리게)
  monsterVoice(text, p) {
    this.onSubtitle && this.onSubtitle(text);
    if (!('speechSynthesis' in window) || this.noVoice) return;
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.pitch = 0.1; u.rate = 0.72;
      const d = p && this.lastCam ? Math.hypot(p.x - this.lastCam.x, p.z - this.lastCam.z) : 3;
      u.volume = Math.max(0.15, Math.min(1, 1.6 / Math.max(1, d / 2.5))) * this.vol;
      u.onstart = () => this.speaking = true; u.onend = u.onerror = () => setTimeout(() => this.speaking = false, 250);
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { }
  }

  /* ── 마이크 ── */
  async startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('이 브라우저는 마이크를 지원하지 않아요');
    this.init();
    const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    const src = this.ctx.createMediaStreamSource(st);
    const an = this.ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    this.mic = { st, an, buf: new Float32Array(an.fftSize) };
    this.floor = -55; this.calib = 1.5;
  }
  stopMic() { if (this.mic) { this.mic.st.getTracks().forEach(t => t.stop()); this.mic = null; } this.level = 0; }
  // 0..1 소리 크기 (주변 소음 기준)
  readMic(dt) {
    if (!this.mic) { this.level = 0; return 0; }
    const { an, buf } = this.mic; an.getFloatTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const db = 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-8); this.micDb = db;
    // 주변 소음 바닥값: 내려갈 땐 빨리, 올라갈 땐 천천히
    if (this.calib > 0) { this.calib -= dt; this.floor = this.floor * 0.9 + db * 0.1; }
    else if (db < this.floor) this.floor += (db - this.floor) * Math.min(1, dt * 4);
    else this.floor += Math.min(db - this.floor, 1.2 * dt);
    this.floor = Math.max(-75, Math.min(this.floor, -25));
    const loud = db - this.floor;
    const lv = this.speaking ? 0 : Math.max(0, Math.min(1, (loud - 5) / 32 * this.sens));
    this.level = Math.max(lv, this.level - dt * 1.5);
    return this.level;
  }
}
