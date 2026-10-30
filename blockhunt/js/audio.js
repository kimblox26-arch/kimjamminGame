// 소리는 전부 WebAudio로 실시간 합성 (총소리, 활, 비명, 신음, 자동차 등)
import * as THREE from 'three';
import { G } from './game.js';
import { rand, pick, clamp } from './util.js';

const _f = new THREE.Vector3(), _u = new THREE.Vector3();

let ctx = null, master, bus, verb, noise;
let voices = 0;
let koVoice = null;
let speakPrio = 0;

function makeNoise() {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function makeVerb() {
  const len = ctx.sampleRate * 1.6, b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const cv = ctx.createConvolver();
  cv.buffer = b;
  return cv;
}

// 3D 위치 출력: pos 가 없으면 내 귀 바로 앞
function out(pos, vol = 1, wet = 0) {
  const g = ctx.createGain();
  g.gain.value = vol;
  if (pos) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 10; p.maxDistance = 600; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    g.connect(p); p.connect(bus);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(verb); }
  } else {
    g.connect(bus);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(verb); }
  }
  return g;
}
function noiseSrc(t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur + 0.05);
  return s;
}
function filt(type, f, q = 1) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function env(g, t, a, peak, dur, curve = 'exp') {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  else g.gain.linearRampToValueAtTime(0, t + dur);
}
// 짧은 잡음 버스트 (총·충격·발소리의 기본 재료)
function burst(pos, { dur = 0.2, f = 1000, q = 1, type = 'bandpass', vol = 1, a = 0.002, wet = 0, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const s = noiseSrc(t, dur), fl = filt(type, f, q), g = ctx.createGain();
  env(g, t, a, vol, dur);
  s.connect(fl); fl.connect(g); g.connect(out(pos, 1, wet));
}
function tone(pos, { f0 = 100, f1 = 40, dur = 0.2, type = 'sine', vol = 1, a = 0.003, delay = 0, wet = 0 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g, t, a, vol, dur);
  o.connect(g); g.connect(out(pos, 1, wet));
  o.start(t); o.stop(t + dur + 0.05);
}

// 모음 포먼트 (사람 목소리처럼 들리게 하는 공명 주파수)
const VOW = { a: [800, 1200, 2600], o: [520, 880, 2400], u: [350, 760, 2300], e: [520, 1800, 2550], eo: [620, 1050, 2500], i: [320, 2200, 2900] };

export const Sound = {
  get ready() { return !!ctx; },
  init() {
    if (ctx) { ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = G.settings.sound;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 6;
    master.connect(comp); comp.connect(ctx.destination);
    bus = ctx.createGain(); bus.connect(master);
    verb = makeVerb(); const vg = ctx.createGain(); vg.gain.value = 0.5; verb.connect(vg); vg.connect(master);
    noise = makeNoise();
    if (window.speechSynthesis) {
      const pickVoice = () => {
        const vs = speechSynthesis.getVoices();
        koVoice = vs.find((v) => /ko(-|_)?KR/i.test(v.lang)) || vs.find((v) => /^ko/i.test(v.lang)) || null;
      };
      pickVoice();
      speechSynthesis.onvoiceschanged = pickVoice;
    }
  },
  setVolume(v) { if (master) master.gain.value = v; },
  listener(cam) {
    if (!ctx) return;
    const L = ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(_f), u = _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) {
      const t = ctx.currentTime;
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  },

  gun(pos) {
    if (!ctx) return;
    burst(pos, { dur: 0.25, f: 1900, q: 0.8, vol: 1.2, wet: 0.35 });
    tone(pos, { f0: 220, f1: 60, dur: 0.14, vol: 0.9 });
    burst(pos, { dur: 0.05, f: 5000, type: 'highpass', vol: 0.6 });
  },
  bow(pos) {
    if (!ctx) return;
    tone(pos, { f0: 260, f1: 110, dur: 0.25, type: 'triangle', vol: 0.9 });
    burst(pos, { dur: 0.3, f: 2500, q: 0.5, vol: 0.35, a: 0.03 });
  },
  draw() { if (ctx) burst(null, { dur: 0.5, f: 600, q: 3, vol: 0.12, a: 0.3 }); },
  thunk(pos) { if (ctx) { burst(pos, { dur: 0.12, f: 300, q: 1, vol: 1, type: 'lowpass' }); tone(pos, { f0: 140, f1: 70, dur: 0.1, vol: 0.6 }); } },
  ping(pos) { if (ctx) { burst(pos, { dur: 0.06, f: 3000, q: 2, vol: 0.4 }); } },
  flesh(pos, big) {
    if (!ctx) return;
    burst(pos, { dur: big ? 0.3 : 0.16, f: big ? 450 : 700, q: 1.2, vol: big ? 1.4 : 0.9, type: 'lowpass' });
    tone(pos, { f0: 90, f1: 50, dur: 0.12, vol: 0.7 });
    if (big) burst(pos, { dur: 0.2, f: 1200, q: 3, vol: 0.5, delay: 0.05 });
  },
  crack(pos) {
    if (!ctx) return;
    for (let i = 0; i < 3; i++) burst(pos, { dur: 0.03, f: 2500 + i * 700, q: 4, vol: 0.7, delay: i * 0.03 });
  },
  punch(pos) { if (ctx) { burst(pos, { dur: 0.12, f: 500, type: 'lowpass', vol: 1.2 }); tone(pos, { f0: 110, f1: 60, dur: 0.1, vol: 0.9 }); } },
  crash(pos, k = 1) {
    if (!ctx) return;
    burst(pos, { dur: 0.5 * k, f: 400, q: 0.7, type: 'lowpass', vol: 1.4 * k, wet: 0.3 });
    burst(pos, { dur: 0.3, f: 3000, q: 1, vol: 0.5 * k, delay: 0.02 });
    tone(pos, { f0: 70, f1: 35, dur: 0.3, vol: k });
  },
  step(vol = 0.25, pos = null) { if (ctx) burst(pos, { dur: 0.07, f: 900 + rand(-200, 200), q: 1, type: 'lowpass', vol }); },
  land(vol = 0.5) { if (ctx) burst(null, { dur: 0.12, f: 500, type: 'lowpass', vol }); },
  ui() { if (ctx) tone(null, { f0: 900, f1: 1200, dur: 0.06, type: 'triangle', vol: 0.25 }); },
  hurt() { if (ctx) { burst(null, { dur: 0.15, f: 300, type: 'lowpass', vol: 0.9 }); Sound.voice('grunt', null, { f0: 120, fmt: 1 }); } },
  splat(pos) { if (ctx) burst(pos, { dur: 0.25, f: 350, q: 1.5, type: 'lowpass', vol: 0.8 }); },

  // 사람 목소리 합성: 비명, 고통, 신음, 흐느낌, 죽는 소리
  voice(kind, pos, vp) {
    if (!ctx || voices > 7) return;
    if (pos && G.camera && pos.distanceTo(G.camera.position) > 220) return;
    if (kind === 'sob') {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) setTimeout(() => Sound.voice('sobpart', pos, vp), i * rand(260, 380));
      return;
    }
    const f0 = vp.f0, fm = vp.fmt || 1;
    let dur, C, vw = 'a', vw2 = null, nz = 0.15, vib = 5, vd = 0.02, peak = 1, dist = false;
    switch (kind) {
      case 'scream': dur = rand(0.9, 1.5); C = [[0, 2.3], [0.08, 3.1], [0.6, 2.9], [1, 2.1]]; nz = 0.3; vib = 6.5; vd = 0.035; dist = true; break;
      case 'pain': dur = rand(0.35, 0.6); vw = pick(['a', 'eo']); C = [[0, 1.6], [0.12, 2.3], [1, 1.3]]; nz = 0.2; vd = 0.025; break;
      case 'grunt': dur = rand(0.14, 0.22); vw = 'u'; C = [[0, 1.25], [1, 0.9]]; nz = 0.35; peak = 0.9; break;
      case 'yell': dur = rand(0.45, 0.65); vw = 'eo'; C = [[0, 1.4], [0.2, 1.75], [1, 1.25]]; nz = 0.2; dist = true; peak = 0.9; break;
      case 'moan': dur = rand(1.2, 2); vw = 'o'; vw2 = 'u'; C = [[0, 0.95], [0.3, 1.15], [0.7, 0.95], [1, 0.75]]; nz = 0.25; vib = 3.5; vd = 0.05; peak = 0.55; break;
      case 'death': dur = rand(0.9, 1.5); vw = 'eo'; vw2 = 'u'; C = [[0, 1.8], [0.1, 2.1], [1, 0.6]]; nz = 0.25; vd = 0.04; peak = 0.9; break;
      case 'sobpart': dur = rand(0.18, 0.3); vw = 'u'; vw2 = 'eo'; C = [[0, 1.9], [0.3, 2.2], [1, 1.3]]; nz = 0.55; vib = 9; vd = 0.06; peak = 0.5; break;
      default: return;
    }
    voices++;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    for (const [k, m] of C) o.frequency.linearRampToValueAtTime(f0 * m * rand(0.97, 1.03), t + k * dur);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = vib; lg.gain.value = f0 * 2 * vd;
    lfo.connect(lg); lg.connect(o.frequency);
    const src = ctx.createGain();
    o.connect(src);
    const ns = noiseSrc(t, dur), nf = filt('bandpass', 1600, 0.6), ng = ctx.createGain();
    ng.gain.value = nz * 1.5;
    ns.connect(nf); nf.connect(ng); ng.connect(src);
    const sum = ctx.createGain();
    sum.gain.value = 3.2;
    const F = VOW[vw], F2 = vw2 ? VOW[vw2] : null;
    [1, 0.65, 0.35].forEach((amp, i) => {
      const b = filt('bandpass', F[i] * fm, 7 + i * 2), g = ctx.createGain();
      g.gain.value = amp;
      if (F2) b.frequency.linearRampToValueAtTime(F2[i] * fm, t + dur);
      src.connect(b); b.connect(g); g.connect(sum);
    });
    let tail = sum;
    if (dist) {
      const ws = ctx.createWaveShaper(), curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); }
      ws.curve = curve; sum.connect(ws); tail = ws;
    }
    const eg = ctx.createGain();
    eg.gain.setValueAtTime(0.0001, t);
    eg.gain.linearRampToValueAtTime(peak, t + 0.03);
    eg.gain.setValueAtTime(peak, t + dur * 0.7);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    tail.connect(eg); eg.connect(out(pos, 0.9, 0.15));
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    o.onended = () => voices--;
  },

  // NPC 대사를 실제 음성으로 읽기 (브라우저 TTS)
  speak(text, vp, pos, prio = 1) {
    if (!window.speechSynthesis) return;
    const d = pos && G.camera ? pos.distanceTo(G.camera.position) : 0;
    if (d > 55) return;
    if (speechSynthesis.speaking) {
      if (prio <= speakPrio) return;
      speechSynthesis.cancel();
    }
    const u = new SpeechSynthesisUtterance(text.replace(/[!?.~…]+/g, (m) => m[0]));
    u.lang = 'ko-KR';
    if (koVoice) u.voice = koVoice;
    u.pitch = clamp(vp.sp, 0.1, 2);
    u.rate = clamp(vp.rate * (prio >= 3 ? 1.25 : 1), 0.5, 2);
    u.volume = clamp(1 - d / 60, 0.15, 1) * G.settings.sound;
    speakPrio = prio;
    u.onend = () => (speakPrio = 0);
    speechSynthesis.speak(u);
  },

  // 자동차 엔진 (탑승 중일 때만)
  engineOn() {
    if (!ctx || this.eng) return;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = filt('lowpass', 500, 2), g = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 12;
    g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bus);
    o1.start(); o2.start();
    this.eng = { o1, o2, lp, g };
  },
  engine(speedFrac, throttle) {
    if (!this.eng) return;
    const t = ctx.currentTime;
    const gear = (speedFrac * 4) % 1;
    const f = 32 + gear * 45 + speedFrac * 30 + Math.abs(throttle) * 10;
    this.eng.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.eng.lp.frequency.setTargetAtTime(300 + Math.abs(throttle) * 600 + speedFrac * 500, t, 0.05);
    this.eng.g.gain.setTargetAtTime(0.13 + Math.abs(throttle) * 0.1, t, 0.1);
  },
  engineOff() {
    if (!this.eng) return;
    const e = this.eng; this.eng = null;
    e.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    setTimeout(() => { e.o1.stop(); e.o2.stop(); }, 500);
  },
};
