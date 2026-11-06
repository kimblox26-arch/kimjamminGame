// 사운드: 실제 녹음 효과음(Kenney · Freesound CC0, sounds/CREDITS.md) + 마이크 소리 감지
const NAMES = ['step_wood_0', 'step_wood_1', 'step_wood_2', 'step_wood_3', 'step_wood_4', 'step_carpet_0', 'step_carpet_1', 'step_carpet_2', 'step_carpet_3', 'step_carpet_4',
  'step_stone_0', 'step_stone_1', 'step_stone_2', 'step_stone_3', 'step_stone_4', 'door_open_1', 'door_open_2', 'door_open_real', 'door_close_1', 'door_close_2', 'door_close_3',
  'creak_1', 'creak_2', 'creak_3', 'book_flip_1', 'book_flip_2', 'book_open', 'book_close', 'cloth_1', 'cloth_2', 'cloth_3', 'body_drop', 'keys', 'metal_click', 'latch', 'belt', 'leather',
  'punch_0', 'punch_1', 'punch_2', 'wood_light_0', 'wood_light_1', 'wood_heavy_0', 'wood_heavy_1', 'soft_heavy_0', 'soft_heavy_1', 'bell', 'glass_hit', 'metal_light',
  'drip_1', 'drip_2', 'drip_3', 'stone_drag_1', 'stone_drag_2', 'woosh_1', 'woosh_2', 'switch_1', 'switch_2', 'click',
  'thunder_1', 'thunder_2', 'knock', 'glass_break', 'owl', 'rain', 'wind', 'crickets', 'clock', 'heartbeat', 'flush', 'sink'];
const pick = (n, k) => n + '_' + (Math.random() * k | 0);
const pick1 = (n, k) => n + '_' + (1 + (Math.random() * k | 0));

export class Audio {
  constructor() { this.ctx = null; this.vol = 0.9; this.mic = null; this.micDb = -100; this.floor = -60; this.level = 0; this.sens = 1; this.raw = {}; this.buf = {}; this.loops = {}; }
  // 로딩 화면에서 미리 받아 둔다
  async preload(base = 'sounds/') {
    await Promise.all(NAMES.map(async n => { try { const r = await fetch(base + n + '.mp3'); if (r.ok) this.raw[n] = await r.arrayBuffer(); } catch (e) { } }));
  }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0; this.amb.connect(this.master);
    this.tense = ctx.createGain(); this.tense.gain.value = 0; this.tense.connect(this.master);
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    this.brown = b;
    this.mPan = this.panAt({ x: 0, y: 1.6, z: 0 }, 1.8);
    for (const [k, ab] of Object.entries(this.raw)) ctx.decodeAudioData(ab.slice(0), bb => this.buf[k] = bb, () => { });
    this.startBeds();
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  get t() { return this.ctx.currentTime; }
  panAt(p, ref = 1.5, roll = 1.2) {
    const P = this.ctx.createPanner(); Object.assign(P, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: roll, maxDistance: 60 });
    if (P.positionX) { P.positionX.value = p.x; P.positionY.value = p.y ?? 1.2; P.positionZ.value = p.z; } else P.setPosition(p.x, p.y ?? 1.2, p.z);
    P.connect(this.sfx); return P;
  }
  listener(cam, fwd) {
    if (!this.ctx) return; const L = this.ctx.listener;
    if (L.positionX) { L.positionX.value = cam.x; L.positionY.value = cam.y; L.positionZ.value = cam.z; L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }
  monsterAt(p) { if (!this.ctx) return; const P = this.mPan; if (P.positionX) { P.positionX.value = p.x; P.positionY.value = 1.4; P.positionZ.value = p.z; } else P.setPosition(p.x, 1.4, p.z); }
  // 녹음된 소리 재생
  play(name, o = {}) {
    const c = this.ctx; if (!c) return null; const b = this.buf[name]; if (!b) return null;
    const s = c.createBufferSource(); s.buffer = b; s.loop = !!o.loop;
    s.playbackRate.value = (o.rate || 1) * (1 + (Math.random() - 0.5) * (o.vary ?? 0.08));
    let node = s;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
    if (o.hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; node.connect(f); node = f; }
    if (o.drive) { const ws = c.createWaveShaper(), cur = new Float32Array(256); for (let i = 0; i < 256; i++) cur[i] = Math.tanh((i / 128 - 1) * o.drive); ws.curve = cur; node.connect(ws); node = ws; }
    const g = c.createGain(); g.gain.value = o.vol ?? 1; node.connect(g);
    g.connect(o.dest || (o.pos ? this.panAt(o.pos, o.ref || 1.5, o.roll || 1.2) : this.sfx));
    s.start(c.currentTime + (o.delay || 0), o.offset || 0);
    if (o.dur) s.stop(c.currentTime + (o.delay || 0) + o.dur);
    return { s, g };
  }
  loopAt(key, name, o) { if (!this.ctx || this.loops[key]) return; const h = this.play(name, { ...o, loop: true, vary: 0 }); if (h) this.loops[key] = h; else setTimeout(() => this.loopAt(key, name, o), 500); }
  stopLoop(key, fade = 0.5) { const h = this.loops[key]; if (!h) return; h.g.gain.setTargetAtTime(0, this.t, fade / 3); h.s.stop(this.t + fade + 0.1); delete this.loops[key]; }

  // 배경: 낮은 웅웅거림 + 빗소리 + 바람
  startBeds() {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.brown; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160; const g = c.createGain(); g.gain.value = 0.25;
    s.connect(f); f.connect(g); g.connect(this.amb); s.start();
    // 추격 때 커지는 낮은 진동
    const r = c.createBufferSource(); r.buffer = this.brown; r.loop = true;
    const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 90; r.connect(rf); rf.connect(this.tense); r.start();
    this.ambT = 4; this.bedsOn = false;
  }
  ambience(on, dt) {
    if (!this.ctx) return;
    this.amb.gain.setTargetAtTime(on ? 1 : 0, this.t, 0.8);
    if (on && !this.bedsOn && this.buf.rain) { this.bedsOn = true; this.loopAt('rain', 'rain', { vol: 0.32, lp: 1400, dest: this.amb }); this.loopAt('wind', 'wind', { vol: 0.14, dest: this.amb }); }
    if (!on) return;
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 6 + Math.random() * 9;
      const L = this.lastCam || { x: 0, z: 0 }, a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 10;
      const pos = { x: L.x + Math.cos(a) * r, y: 2, z: L.z + Math.sin(a) * r }, k = Math.random();
      if (k < 0.45) this.play(pick1('creak', 3), { pos, vol: 0.7, rate: 0.7 + Math.random() * 0.4 });
      else if (k < 0.6) this.play('knock', { pos, vol: 0.5, lp: 900 });
      else if (k < 0.72) this.play(pick('wood_heavy', 2), { pos, vol: 0.6, lp: 700 });
      else if (k < 0.82) this.play('glass_hit', { pos, vol: 0.35, lp: 2000 });
      else if (k < 0.9) this.play('owl', { vol: 0.12, lp: 900 });
      else this.play(pick1('door_close', 3), { pos, vol: 0.5, lp: 1200, rate: 0.85 });
    }
  }
  chase(level, dt) {
    if (!this.ctx) return;
    this.tense.gain.setTargetAtTime(level * 1.6, this.t, level > 0.5 ? 0.2 : 1.5);
  }
  heartbeat(rate, vol) {
    if (!this.ctx || vol <= 0.01) return;
    const t = this.t; this.hbT = this.hbT ?? 0;
    if (t < this.hbT) return; this.hbT = t + 60 / rate;
    this.play('heartbeat', { vol: vol * 1.4, vary: 0.02 });
  }
  step(surface, run) {
    const n = surface === 'rug' ? 'step_carpet' : surface === 'wood' ? 'step_wood' : 'step_stone';
    this.play(pick(n, 5), { vol: run ? 0.5 : 0.28, rate: run ? 1.05 : 0.95 });
  }
  monsterStep(p, run) {
    if (!this.ctx) return; this.monsterAt(p);
    this.play(pick('step_wood', 5), { dest: this.mPan, vol: run ? 1.3 : 1.0, rate: 0.6, lp: 2500 });
    this.play(pick('soft_heavy', 2), { dest: this.mPan, vol: run ? 0.7 : 0.45, rate: 0.7 });
    if (Math.random() < 0.15) this.play(pick1('creak', 3), { dest: this.mPan, vol: 0.5, rate: 0.8 });
  }
  door(p, monster) { this.play(monster ? 'door_open_real' : pick1('door_open', 2), { pos: p, vol: monster ? 1.2 : 0.8, ref: 2 }); }
  doorClose(p) { this.play(pick1('door_close', 3), { pos: p, vol: 0.8, ref: 2 }); }
  drawer() { this.play(pick1('creak', 3), { vol: 0.45, rate: 1.5, dur: 0.6 }); this.play(pick('wood_light', 2), { vol: 0.5, delay: 0.3 }); }
  pickup() { this.play('keys', { vol: 0.7 }); this.play('metal_click', { vol: 0.4, delay: 0.15 }); }
  paper() { this.play(Math.random() < 0.5 ? 'book_flip_1' : 'book_flip_2', { vol: 0.6 }); }
  book() { this.play('book_open', { vol: 0.7 }); }
  unlock() { this.play('metal_click', { vol: 0.7 }); this.play('latch', { vol: 0.8, delay: 0.18 }); }
  locked() { this.play('latch', { vol: 0.6, rate: 0.8 }); this.play('belt', { vol: 0.5, rate: 1.3, delay: 0.1 }); this.play('metal_light', { vol: 0.3, delay: 0.2 }); }
  beep(ok = true) { this.play(ok ? 'click' : 'switch_2', { vol: ok ? 0.6 : 0.8, rate: ok ? 1 : 0.6 }); }
  alarm() { for (let i = 0; i < 4; i++) this.play('bell', { vol: 0.9, delay: i * 0.35, rate: 0.9 + (i % 2) * 0.15 }); }
  hide(type, enter = true) {
    if (type === 'bed') { this.play(pick1('cloth', 3), { vol: 0.6 }); this.play('body_drop', { vol: 0.5, delay: 0.25 }); }
    else { this.play('door_open_2', { vol: 0.5, rate: 1.25 }); this.play(pick1('cloth', 3), { vol: 0.5, delay: 0.3 }); this.play('door_close_3', { vol: 0.45, rate: 1.3, delay: enter ? 1.0 : 0.7 }); }
  }
  stinger() { this.play('woosh_1', { vol: 0.9, rate: 0.7 }); this.play(pick('punch', 3), { vol: 0.7, rate: 0.6 }); this.play('creak_1', { vol: 0.8, rate: 2.2 }); this.play('metal_light', { vol: 0.5, rate: 0.5 }); }
  scream(p) {
    if (!this.ctx) return; this.monsterAt(p);
    this.play('creak_2', { dest: this.mPan, vol: 1.2, rate: 2.3, drive: 4 }); this.play('creak_1', { dest: this.mPan, vol: 1.0, rate: 1.7, drive: 3, delay: 0.05 });
    this.play('woosh_2', { dest: this.mPan, vol: 0.9, rate: 0.8 });
  }
  jumpscare() {
    this.play('woosh_1', { vol: 1.2, rate: 0.6 }); this.play('glass_break', { vol: 1.0 }); this.play(pick('punch', 3), { vol: 1.2, rate: 0.5 });
    this.play('creak_3', { vol: 1.4, rate: 2.6, drive: 5 }); this.play('creak_2', { vol: 1.2, rate: 1.9, drive: 5, delay: 0.1 }); this.play('soft_heavy_0', { vol: 1.2, rate: 0.5 });
  }
  hit() { this.play(pick('punch', 3), { vol: 1.1 }); this.play('soft_heavy_1', { vol: 0.8, rate: 0.7 }); }
  fall() { this.play('body_drop', { vol: 1.0, rate: 0.8 }); this.play('soft_heavy_0', { vol: 0.8, delay: 0.1 }); }
  drag() { for (let i = 0; i < 4; i++) { this.play(pick1('stone_drag', 2), { vol: 0.6, rate: 0.7, lp: 700, delay: i * 0.8 }); this.play(pick1('cloth', 3), { vol: 0.4, delay: i * 0.8 + 0.3 }); } }
  slam() { this.play('door_close_3', { vol: 1.2, rate: 0.75 }); this.play('wood_heavy_0', { vol: 1.0, rate: 0.8 }); }
  ding() { if (!this.ctx) return; const c = this.ctx, t = this.t; for (const [f, d] of [[1568, 0], [2093, 0.1]]) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.12, t + d); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.4); o.connect(g); g.connect(this.sfx); o.start(t + d); o.stop(t + d + 0.45); } }
  glitch() { if (!this.ctx) return; const c = this.ctx, t = this.t; for (let i = 0; i < 10; i++) { const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = 200 + Math.random() * 3000; g.gain.setValueAtTime(0.05, t + i * 0.04); g.gain.linearRampToValueAtTime(0, t + i * 0.04 + 0.04); o.connect(g); g.connect(this.sfx); o.start(t + i * 0.04); o.stop(t + i * 0.04 + 0.05); } }
  thunder(delay = 0.6) { this.play(Math.random() < 0.5 ? 'thunder_1' : 'thunder_2', { vol: 0.8, delay, lp: 3000 }); }
  piano() { this.play('bell', { vol: 0.6, rate: 0.42, lp: 1800 }); this.play('bell', { vol: 0.4, rate: 0.5, lp: 1800, delay: 0.02 }); this.play('wood_heavy_1', { vol: 0.4 }); }
  light() { this.play('switch_1', { vol: 0.5 }); }
  wind(on) { if (on) { this.play('wind', { vol: 0.8, hp: 300, dur: 6 }); } }
  statue(p) { this.play(Math.random() < 0.5 ? 'stone_drag_1' : 'stone_drag_2', { pos: p, vol: 0.9, rate: 0.85, ref: 2.5 }); }
  drip(p) { this.play(pick1('drip', 3), { pos: p, vol: 0.5 }); }
  street(on) { if (on) this.loopAt('crickets', 'crickets', { vol: 0.35 }); else this.stopLoop('crickets', 1); }
  groan(p) { if (!this.ctx) return; this.monsterAt(p); this.play('creak_3', { dest: this.mPan, vol: 1.1, rate: 0.36, lp: 800 }); }

  // 괴물 목소리: 낮은 신음(녹음 소리를 늦게) + 자막. 음성 합성은 설정에서 켤 때만
  monsterVoice(text, p) {
    this.onSubtitle && this.onSubtitle(text);
    if (p) this.groan(p);
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
