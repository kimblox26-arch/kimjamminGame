// 소리: 모두 WebAudio 로 실시간 합성
// tock  = 나무 기물을 판에 내려놓는 소리 (나무 공진 모드 + 접촉음 + 짧은 방 울림)
// slide = 기물을 들어 옮길 때 펠트가 스치는 소리
// whoosh = 잡은 기물을 던질 때 바람 소리
const Sound = (() => {
  let ctx = null, out = null, verb = null, noise = null;

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
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(comp);

    // 작은 방 울림
    const len = Math.floor(ctx.sampleRate * 0.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    }
    verb = ctx.createConvolver();
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    verb.connect(wet).connect(comp);

    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
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
  function noiseSrc(t, dur) {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur);
    return n;
  }

  // 나무 기물이 판에 닿는 소리
  function tock(ms, { gain = 1, pitch = 1, muffle = false } = {}) {
    if (!ready()) return;
    const t = at(ms);
    const mix = ctx.createGain();
    mix.gain.value = gain * 0.8;
    if (muffle) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      mix.connect(lp);
      send(lp, 0.6);
    } else {
      send(mix, 0.3);
    }
    const j = pitch * (1 + (Math.random() - 0.5) * 0.06);
    // [주파수, 세기, 감쇠 시간상수]
    const modes = [[92, 0.38, 0.05], [212, 0.75, 0.036], [618, 0.42, 0.02], [1340, 0.26, 0.012], [2580, 0.14, 0.007], [4250, 0.06, 0.004]];
    for (const [f, a, d] of modes) {
      const o = ctx.createOscillator();
      o.frequency.value = f * j;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.0012);
      g.gain.setTargetAtTime(0, t + 0.0012, d);
      o.connect(g).connect(mix);
      o.start(t);
      o.stop(t + d * 9 + 0.02);
    }
    const n = noiseSrc(t, 0.04);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000 * j;
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.setTargetAtTime(0, t, 0.0035);
    n.connect(bp).connect(ng).connect(mix);
  }

  // 펠트 바닥이 스치며 움직이는 소리
  function slide(ms, durMs, gain = 0.1) {
    if (!ready()) return;
    const t = at(ms), d = durMs / 1000;
    const n = noiseSrc(t, d + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(450, t);
    bp.frequency.linearRampToValueAtTime(1100, t + d * 0.5);
    bp.frequency.linearRampToValueAtTime(600, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + d * 0.3);
    g.gain.linearRampToValueAtTime(gain * 0.6, t + d * 0.7);
    g.gain.linearRampToValueAtTime(0, t + d);
    n.connect(bp).connect(g);
    send(g, 0.15);
  }

  // 던질 때 바람 소리
  function whoosh(ms, durMs, gain = 0.32) {
    if (!ready()) return;
    const t = at(ms), d = durMs / 1000;
    const n = noiseSrc(t, d + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + d * 0.35);
    bp.frequency.exponentialRampToValueAtTime(700, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + d * 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    n.connect(bp).connect(g);
    send(g, 0.25);
  }

  return { init, tock, slide, whoosh };
})();
