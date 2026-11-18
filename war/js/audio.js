// 효과음 / 배경음악 (WebAudio 합성)
(function () {
  const A = (window.SFX = { vol: 0.7, music: true });
  let ac = null, master = null, musicGain = null, musicTimer = null;
  const ensure = () => {
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C();
      master = ac.createGain(); master.connect(ac.destination);
      musicGain = ac.createGain(); musicGain.gain.value = 0.18; musicGain.connect(master);
    }
    if (ac.state === 'suspended') ac.resume();
    master.gain.value = A.vol;
    return ac;
  };
  A.unlock = ensure;
  const noise = (dur) => {
    const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(); s.buffer = b; return s;
  };
  const env = (node, t, a, peak, dec, dest = master) => {
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    node.connect(g); g.connect(dest);
    return g;
  };
  const tone = (f, t, dur, type = 'sine', peak = 0.3, dest) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    env(o, t, 0.01, peak, dur, dest); o.start(t); o.stop(t + dur + 0.05); return o;
  };
  const nz = (t, dur, freq, q, peak, type = 'bandpass') => {
    const s = noise(dur + 0.05), f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); env(f, t, 0.005, peak, dur); s.start(t);
  };
  A.play = (name) => {
    if (!ensure() || A.vol <= 0) return;
    const t = ac.currentTime;
    switch (name) {
      case 'click': nz(t, 0.05, 2400, 1.5, 0.35); break;
      case 'page': nz(t, 0.25, 1600, 0.6, 0.25); nz(t + 0.08, 0.2, 3000, 0.8, 0.15); break;
      case 'coin': tone(1320, t, 0.08, 'square', 0.08); tone(1760, t + 0.06, 0.18, 'square', 0.08); break;
      case 'buy': tone(520, t, 0.08, 'triangle', 0.25); tone(780, t + 0.07, 0.12, 'triangle', 0.25); break;
      case 'deny': tone(200, t, 0.15, 'sawtooth', 0.12); tone(150, t + 0.12, 0.2, 'sawtooth', 0.12); break;
      case 'shot': nz(t, 0.08, 1200, 0.7, 0.45, 'highpass'); break;
      case 'boom': nz(t, 0.7, 180, 0.5, 0.9, 'lowpass'); tone(60, t, 0.5, 'sine', 0.5); break;
      case 'drum': for (let i = 0; i < 3; i++) { tone(110, t + i * 0.16, 0.18, 'sine', 0.5); nz(t + i * 0.16, 0.1, 900, 1, 0.2); } break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.12, 0.35, 'triangle', 0.25)); break;
      case 'lose': [392, 349, 311, 262].forEach((f, i) => tone(f, t + i * 0.22, 0.4, 'triangle', 0.22)); break;
      case 'alarm': for (let i = 0; i < 3; i++) { tone(880, t + i * 0.3, 0.12, 'square', 0.1); tone(660, t + i * 0.3 + 0.14, 0.12, 'square', 0.1); } break;
      case 'cheer': [523, 659, 784, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.1, 0.25, 'triangle', 0.2)); break;
    }
  };

  // 아주 단순한 행진곡 루프
  const SONGS = {
    menu: { bpm: 84, notes: [57, 0, 60, 64, 62, 0, 60, 57, 55, 0, 57, 60, 59, 0, 0, 0], bass: [45, 45, 41, 41, 43, 43, 40, 40] },
    game: { bpm: 104, notes: [62, 0, 62, 65, 69, 0, 67, 65, 64, 0, 60, 64, 62, 0, 0, 0], bass: [38, 38, 34, 34, 36, 36, 33, 33] },
    sad: { bpm: 60, notes: [57, 0, 55, 53, 52, 0, 0, 0, 53, 0, 52, 50, 49, 0, 0, 0], bass: [38, 38, 34, 34, 33, 33, 33, 33] },
    happy: { bpm: 120, notes: [60, 64, 67, 72, 71, 67, 69, 72, 74, 72, 71, 67, 72, 0, 72, 0], bass: [36, 36, 41, 41, 43, 43, 36, 36] },
  };
  let cur = null;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  A.song = (name) => {
    if (cur === name && musicTimer) return;
    A.stopSong(); cur = name;
    if (!A.music || !ensure()) return;
    const S = SONGS[name]; if (!S) return;
    const step = 60 / S.bpm / 2;
    let i = 0, next = ac.currentTime + 0.1;
    musicTimer = setInterval(() => {
      while (next < ac.currentTime + 0.4) {
        const n = S.notes[i % S.notes.length];
        if (n) tone(mtof(n), next, step * 1.6, 'triangle', 0.22, musicGain);
        if (i % 2 === 0) tone(mtof(S.bass[(i / 2) % S.bass.length]), next, step * 1.8, 'sine', 0.3, musicGain);
        if (i % 4 === 2) { const s = noise(0.08), f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000; s.connect(f); env(f, next, 0.004, 0.08, 0.06, musicGain); s.start(next); }
        next += step; i++;
      }
    }, 100);
  };
  A.stopSong = () => { if (musicTimer) clearInterval(musicTimer); musicTimer = null; };
  A.setMusic = (on) => { A.music = on; if (!on) A.stopSong(); else if (cur) { const c = cur; cur = null; A.song(c); } };
})();
