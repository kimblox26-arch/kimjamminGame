// 소리: 모두 WebAudio 로 실시간 합성
// knock  = 나무 기물로 나무 판을 치는 소리 (짧은 충격 → 나무 공진 필터 뱅크 + 판 울림)
// scrape = 나무가 나무를 긁는 소리 (끊기고 미끄러지는 마찰 알갱이 → 공진 필터)
const Sound = (() => {
  let ctx = null, out = null, verb = null;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      ctx = null;
      return;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    out = ctx.createGain();
    out.connect(comp);

    // 작은 방 울림
    const len = Math.floor(ctx.sampleRate * 0.35);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);
    }
    verb = ctx.createConvolver();
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.2;
    verb.connect(wet).connect(comp);
    if (ctx.state === 'suspended') ctx.resume();
  }

  const ready = () => !!ctx && ctx.state !== 'closed';
  const at = (ms) => ctx.currentTime + 0.01 + ms / 1000;
  function send(node, wetAmt) {
    node.connect(out);
    const s = ctx.createGain();
    s.gain.value = wetAmt;
    node.connect(s).connect(verb);
  }
  function filter(type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }
  function gainNode(v) {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  }
  function bufferSource(t, data) {
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.getChannelData(0).set(data);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.start(t);
    return s;
  }
  function burst(ms) {
    const len = Math.max(2, Math.floor((ctx.sampleRate * ms) / 1000));
    const d = new Float32Array(len);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    return d;
  }

  // 나무 치는 소리
  function knock(ms, { gain = 1, pitch = 1, muffle = false } = {}) {
    if (!ready()) return;
    const t = at(ms);
    const j = pitch * (1 + (Math.random() - 0.5) * 0.05);
    const mix = gainNode(gain);
    if (muffle) {
      const lp = filter('lowpass', 1300);
      mix.connect(lp);
      send(lp, 0.5);
    } else {
      send(mix, 0.25);
    }

    // 나무 공진: [주파수, Q, 세기]
    const ex = bufferSource(t, burst(2.5));
    for (const [f, q, a] of [[410, 16, 90], [1060, 20, 60], [1870, 24, 36], [2930, 28, 22], [4350, 30, 10]]) {
      ex.connect(filter('bandpass', f * j, q)).connect(gainNode(a)).connect(mix);
    }
    // 맞닿는 순간의 딱 소리
    bufferSource(t, burst(1.2)).connect(filter("highpass", 2500)).connect(gainNode(0.5)).connect(mix);
    // 판 전체가 울리는 낮은 소리
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150 * j, t);
    o.frequency.exponentialRampToValueAtTime(105 * j, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.3, t + 0.001);
    og.gain.setTargetAtTime(0, t + 0.001, 0.022);
    o.connect(og).connect(mix);
    o.start(t);
    o.stop(t + 0.2);
  }

  // 나무 긁는 소리
  function scrape(ms, durMs, gain = 0.55) {
    if (!ready()) return;
    const t = at(ms);
    const sr = ctx.sampleRate, len = Math.floor((sr * durMs) / 1000);
    const x = new Float32Array(len);
    let soft = 0;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      const speed = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 0.7);
      let grain = 0;
      if (Math.random() < (90 + 520 * speed) / sr) grain = (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1);
      soft += ((Math.random() * 2 - 1) - soft) * 0.3;
      x[i] = speed * (grain + soft * 0.22);
    }
    const src = bufferSource(t, x);
    const hp = filter('highpass', 280);
    const mix = gainNode(gain);
    src.connect(hp);
    for (const [f, q, a] of [[820, 3, 1.6], [1650, 4, 1.3], [2900, 5, 0.8]]) {
      hp.connect(filter('bandpass', f, q)).connect(gainNode(a)).connect(mix);
    }
    hp.connect(filter('lowpass', 5000)).connect(gainNode(0.25)).connect(mix);
    send(mix, 0.15);
  }

  return { init, knock, scrape };
})();
