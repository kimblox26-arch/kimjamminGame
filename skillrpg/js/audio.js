// ───────── 8비트 사운드 (WebAudio 실시간 합성) ─────────
const SFX = (() => {
  let ac = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('srpg_mute') === '1'; } catch (e) {}

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, init, { passive: true }));

  function tone(f, dur, type = 'square', vol = 0.2, to = null, delay = 0) {
    if (!ac || muted) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.3, freq = 2000, type = 'lowpass', to = null, delay = 0, q = 1) {
    if (!ac || muted) return;
    const t = ac.currentTime + delay;
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  const notes = (arr, step, type = 'square', vol = 0.15, len = 0.12, delay = 0) =>
    arr.forEach((f, i) => tone(f, len, type, vol, null, delay + i * step));

  const api = {
    init, tone, noise,
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('srpg_mute', muted ? '1' : '0'); } catch (e) {}
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    click() { tone(880, 0.05, 'square', 0.12); tone(1320, 0.05, 'square', 0.08, null, 0.03); },
    tab() { tone(660, 0.06, 'square', 0.1, 990); },
    error() { tone(200, 0.12, 'square', 0.15); tone(150, 0.18, 'square', 0.15, null, 0.1); },
    equip() { notes([523, 784, 1047], 0.05, 'square', 0.1, 0.08); },
    coin() { tone(988, 0.07, 'square', 0.12); tone(1319, 0.2, 'square', 0.12, null, 0.07); },
    hit(crit) {
      noise(0.08, 0.25, 1800, 'lowpass');
      tone(crit ? 300 : 180, 0.1, 'square', 0.12, 60);
      if (crit) { tone(1200, 0.12, 'square', 0.08, 2400); noise(0.15, 0.2, 5000, 'highpass'); }
    },
    squish() { tone(220, 0.12, 'sine', 0.2, 90); },
    slimeDie() { tone(400, 0.4, 'square', 0.15, 50); noise(0.3, 0.2, 800, 'lowpass', 100); notes([784, 988, 1175, 1568], 0.06, 'square', 0.08, 0.1, 0.25); },
    whoosh(d = 0.25, f = 600) { noise(d, 0.25, f, 'bandpass', f * 4, 0, 2); },
    fire() { noise(0.3, 0.25, 1200, 'lowpass', 300); tone(160, 0.2, 'sawtooth', 0.08, 80); },
    boom(size = 1) {
      noise(0.4 + size * 0.4, 0.35 + size * 0.15, 1200 + size * 600, 'lowpass', 60);
      tone(120, 0.3 + size * 0.3, 'sine', 0.35, 30);
      if (size > 1) tone(60, 0.8, 'triangle', 0.3, 25);
    },
    ice() { [2093, 2637, 3136].forEach((f, i) => tone(f, 0.15, 'triangle', 0.1, f * 0.9, i * 0.03)); noise(0.1, 0.15, 6000, 'highpass'); },
    shatter() { for (let i = 0; i < 6; i++) tone(1800 + Math.random() * 2000, 0.08, 'square', 0.05, null, i * 0.02); noise(0.25, 0.25, 4000, 'highpass'); },
    zap() { noise(0.35, 0.35, 3000, 'bandpass', 800, 0, 3); tone(1600, 0.25, 'sawtooth', 0.1, 100); },
    thunder() { noise(1.2, 0.5, 2500, 'lowpass', 80); tone(90, 0.9, 'sawtooth', 0.15, 30); },
    shing() { tone(2400, 0.12, 'triangle', 0.1, 3200); noise(0.08, 0.15, 6000, 'highpass'); },
    slash() { noise(0.15, 0.3, 2500, 'bandpass', 6000, 0, 2); tone(900, 0.08, 'square', 0.06, 2400); },
    bubble() { for (let i = 0; i < 5; i++) tone(300 + Math.random() * 300, 0.06, 'sine', 0.12, 900, i * 0.07); },
    glass() { [3000, 4200, 3600].forEach((f, i) => tone(f, 0.1, 'triangle', 0.08, null, i * 0.025)); noise(0.2, 0.2, 7000, 'highpass'); },
    rumble(d = 1.5) { noise(d, 0.35, 300, 'lowpass', 60); tone(55, d, 'sawtooth', 0.12, 35); },
    charge(d = 1) { tone(200, d, 'sawtooth', 0.1, 1600); tone(203, d, 'square', 0.06, 1610); noise(d, 0.12, 400, 'bandpass', 4000, 0, 4); },
    beam(d = 1.5) { noise(d, 0.45, 1500, 'lowpass', 400); tone(110, d, 'sawtooth', 0.18, 90); tone(220, d, 'square', 0.08, 180); },
    chord(base = 523, d = 1.2) { [1, 1.26, 1.5, 2].forEach(m => tone(base * m, d, 'triangle', 0.08)); },
    clang() { [1200, 1800, 2700].forEach(f => tone(f, 0.6, 'triangle', 0.1, f * 0.98)); noise(0.2, 0.3, 3000, 'highpass'); },
    screech() { tone(1800, 0.5, 'sawtooth', 0.1, 600); tone(2400, 0.4, 'square', 0.05, 900, 0.05); },
    tick() { tone(1500, 0.03, 'square', 0.12); },
    bell() { [880, 1320, 1760].forEach(f => tone(f, 1.5, 'sine', 0.12)); },
    cast(r) { tone(300 + r * 120, 0.15, 'triangle', 0.1, 900 + r * 300); },

    // ── 뽑기 사운드 ──
    chestDrop() { tone(90, 0.2, 'square', 0.25, 40); noise(0.15, 0.3, 500, 'lowpass'); },
    shakeTick(p) { tone(400 + p * 600, 0.04, 'square', 0.08); noise(0.04, 0.1, 1500); },
    upgrade(r) { notes([523 * Math.pow(1.122, r * 2), 659 * Math.pow(1.122, r * 2)], 0.06, 'square', 0.12, 0.1); },
    open(r) {
      noise(0.5, 0.35, 3000, 'lowpass', 300);
      tone(200, 0.3, 'square', 0.15, 900);
      const fan = [
        [523, 659],
        [523, 659, 784],
        [523, 659, 784, 1047],
        [392, 523, 659, 784, 1047],
        [392, 523, 659, 784, 1047, 1319, 1568],
        [262, 392, 523, 659, 784, 1047, 1319, 1568, 2093],
      ][r];
      notes(fan, 0.08 - r * 0.005, 'square', 0.12, 0.18, 0.15);
      const end = 0.15 + fan.length * (0.08 - r * 0.005);
      if (r >= 2) [1, 1.26, 1.5].forEach(m => tone(fan[fan.length - 1] * m / 2, 0.5 + r * 0.25, 'triangle', 0.08, null, end));
      if (r >= 4) { for (let i = 0; i < 12; i++) tone(2000 + Math.random() * 3000, 0.1, 'sine', 0.05, null, end + i * 0.05); }
      if (r >= 5) { tone(65, 2, 'sawtooth', 0.12, 130, 0.1); [1, 1.5, 2, 2.52].forEach(m => tone(262 * m, 2.2, 'square', 0.04, null, end + 0.1)); }
    },
    flip(r) { tone(600 + r * 200, 0.08, 'square', 0.1, 1200 + r * 300); },
  };
  return api;
})();
