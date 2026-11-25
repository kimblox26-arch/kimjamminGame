// 소리: 실제 녹음 효과음(assets/sfx) + 3D 위치 + 손님/사장님 목소리(기기 TTS)
import * as THREE from 'three';

const SFX = ['chime', 'door', 'register', 'bill', 'bag', 'step1', 'step2', 'thud', 'key', 'night', 'engine', 'whoosh', 'gun', 'punch', 'hit', 'horn', 'scream_f1', 'scream_f2', 'scream_m1', 'scream_m2', 'hurt_m1', 'hurt_m2', 'hurt_m3', 'hurt_m4', 'hurt_f1', 'hurt_f2', 'hurt_f3', 'die_m1', 'die_m2', 'die_m3', 'die_f1', 'die_f2', 'die_f3', 'breath_f', 'breath_m', 'pistol_shot', 'rifle_shot1', 'rifle_shot2', 'rifle_in', 'brass1', 'brass2', 'dryfire', 'reload_rifle', 'reload_pistol', 'rain', 'rain_in', 'thunder', 'thunder_far'];
export const Native = window.NativeApp || null;
// 목소리 이름으로 성별 추정 (구글 TTS: ism/jeb/kob 여, jmh/kod 남 · 삼성 TTS: SMTf 여, SMTm 남 · 브라우저 음성 이름)
export function voiceGender(n) {
  if (/SMTm|male|남자|InJoon|Hyunsu|Bong|Gook|jmh|kod|-c-|Standard-C|Standard-D|Wavenet-C|Wavenet-D/i.test(n) && !/female/i.test(n)) return 'm';
  if (/SMTf|female|여자|SunHi|JiMin|SeoHyeon|Yu ?Jin|Heami|ism|kob|jeb|Google 한국|Yuna|Sora|-a-|-b-|Standard-A|Standard-B/i.test(n)) return 'f';
  return '?';
}

export class Audio {
  constructor() {
    this.ctx = null; this.buf = {}; this.vol = 1; this.voiceOn = true;
    this.listenerPos = new THREE.Vector3(); this.speakCbs = {}; this.sid = 0;
    window.__nativeTts = (ev, id) => { const cb = this.speakCbs[id]; if (cb && ev === 'done') { delete this.speakCbs[id]; cb(); } };
  }
  async init(onProgress) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    let n = 0;
    await Promise.all(SFX.map(async k => {
      try {
        const r = await fetch(`assets/sfx/${k}.ogg`);
        this.buf[k] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) { console.warn('sfx', k, e); }
      onProgress?.(++n / SFX.length);
    }));
  }
  resume() { if (this.ctx?.state !== 'running') this.ctx?.resume(); }
  setListener(pos, quat) {
    const L = this.ctx?.listener; if (!L) return;
    this.listenerPos.copy(pos);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(quat), u = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }
  // 효과음 하나: pos 가 있으면 3D, rate=재생속도(음높이), offset/dur=부분 재생
  play(name, { pos = null, vol = 1, rate = 1, offset = 0, dur, loop = false, delay = 0 } = {}) {
    const b = this.buf[name]; if (!b || !this.ctx) return null;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; s.loop = loop;
    const g = this.ctx.createGain(); g.gain.value = vol;
    let out = g;
    if (pos) {
      const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.2; p.rolloffFactor = 1.3;
      p.positionX ? (p.positionX.value = pos.x, p.positionY.value = pos.y, p.positionZ.value = pos.z) : p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); out = p; s.panner = p;
    }
    s.connect(g); out.connect(this.master);
    const t = this.ctx.currentTime + delay;
    dur ? s.start(t, offset, dur) : s.start(t, offset);
    s.gain = g; return s;
  }
  movePanner(s, pos) { const p = s?.panner; if (!p) return; if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z); }
  // 바코드 스캐너 삑 (실제 스캐너도 단일 주파수 부저음)
  beep(pos, ok = true) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = 'square'; o.frequency.value = ok ? 3100 : 820;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = ok ? 3100 : 820; f.Q.value = 3;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.005); g.gain.setValueAtTime(0.12, t + (ok ? 0.09 : 0.35)); g.gain.linearRampToValueAtTime(0, t + (ok ? 0.1 : 0.37));
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
  }
  // 비닐봉투 바스락: 짧은 고음 잡음 조각을 불규칙하게 (실제 비닐 구김 소리 구조)
  rustle(pos, dur = 0.6, vol = 0.5) {
    const c = this.ctx; if (!c) return;
    if (!this.noiseBuf) { const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = b; }
    const out = c.createGain(); out.gain.value = vol; let node = out;
    if (pos) { const p = c.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 1; p.positionX ? (p.positionX.value = pos.x, p.positionY.value = pos.y, p.positionZ.value = pos.z) : p.setPosition(pos.x, pos.y, pos.z); out.connect(p); node = p; }
    node.connect(this.master);
    const t0 = c.currentTime, n = Math.round(dur * 70);
    for (let i = 0; i < n; i++) {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500 + Math.random() * 6000; f.Q.value = 0.8 + Math.random() * 2;
      const g = c.createGain(), t = t0 + Math.random() * dur, len = 0.004 + Math.random() * 0.03, a = (0.2 + Math.random()) * Math.sin(Math.PI * (t - t0) / dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.002); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.9, len + 0.01);
    }
  }
  // 경찰 사이렌 (오르내리는 두 음) — stop() 으로 끔
  siren(getPos) {
    const c = this.ctx; if (!c) return { stop() { } };
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), p = c.createPanner(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = 900; o2.frequency.value = 905; lfo.frequency.value = 0.22; lg.gain.value = 380;
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    g.gain.value = 0.12; o.connect(f); o2.connect(f); f.connect(g); p.panningModel = 'HRTF'; p.refDistance = 4; p.rolloffFactor = 0.9; g.connect(p); p.connect(this.master);
    o.start(); o2.start(); lfo.start();
    const iv = setInterval(() => { const q = getPos?.(); if (q) this.movePanner({ panner: p }, q); }, 100);
    return { stop: () => { clearInterval(iv); try { o.stop(); o2.stop(); lfo.stop(); } catch (e) { } } };
  }
  // 문 열림 차임 "딩~동" (실제 종소리 녹음을 두 음으로)
  chime(pos) { this.play('chime', { pos, vol: 0.55, rate: 1.26, dur: 0.9 }); this.play('chime', { pos, vol: 0.55, rate: 1.0, delay: 0.42 }); }
  coins(pos) { for (let i = 0; i < 3; i++) this.play('register', { pos, vol: 0.35, rate: 1.4 + Math.random() * 0.3, offset: 1.2 + Math.random() * 0.6, dur: 0.18, delay: i * 0.07 }); }
  // 냉장고·형광등 웅웅거림 + 바깥 밤거리 소리
  startAmbience(outsidePos) {
    const c = this.ctx; if (!c || this.amb) return;
    const hum = c.createGain(); hum.gain.value = 0.035; hum.connect(this.master);
    [60, 120, 180].forEach((f, i) => { const o = c.createOscillator(); o.frequency.value = f + Math.random(); const g = c.createGain(); g.gain.value = [1, 0.5, 0.18][i]; o.connect(g); g.connect(hum); o.start(); });
    const n = c.createBufferSource(), nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = nb; n.loop = true; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const ng = c.createGain(); ng.gain.value = 0.05; n.connect(lp); lp.connect(ng); ng.connect(this.master); n.start();
    this.outside = this.play('night', { pos: outsidePos, vol: 0.9, loop: true });
    this.amb = { hum, ng };
  }
  setDoorOpen(open) { const s = this.outside; if (s) s.gain.gain.setTargetAtTime(open ? 2.2 : 0.7, this.ctx.currentTime, 0.25); }
  // ── 목소리 (TTS) ──
  // 남자/여자 목소리를 따로 골라 쓴다 (음높이를 억지로 바꾸지 않아야 자연스럽다)
  loadVoices(settings = {}) {
    let list = [];
    try {
      if (Native?.voices) list = JSON.parse(Native.voices() || '[]');
      else if (window.speechSynthesis) list = speechSynthesis.getVoices().filter(v => /^ko/i.test(v.lang)).map(v => ({ name: v.name, quality: /natural|online|neural|wavenet/i.test(v.name) ? 500 : 300, network: !v.localService }));
    } catch (e) { list = []; }
    this.voices = list.filter(v => !v.notInstalled);
    const order = (a, b) => (b.quality - a.quality) || (a.network - b.network) || a.name.localeCompare(b.name);
    const pickList = (g, pref) => { const l = this.voices.filter(v => voiceGender(v.name) === g).sort(order).map(v => v.name); if (pref && this.voices.some(v => v.name === pref)) { l.splice(l.indexOf(pref), 1); l.unshift(pref); } return l; };
    this.vm = pickList('m', settings.voiceM); this.vf = pickList('f', settings.voiceF);
    return this.voices;
  }
  voiceFor(gender, idx = 0) { const l = gender === 'f' ? this.vf : this.vm; return l?.length ? l[idx % l.length] : ''; }
  speak(text, { pitch = 1, rate = 1, gender = 'm', idx = 0 } = {}, onEnd) {
    const clean = text.replace(/\(.*?\)/g, '').replace(/…/g, ', ').replace(/~/g, '').replace(/\s+/g, ' ').trim();
    const voice = this.voiceFor(gender, idx);
    if (voice) pitch = 1 + (pitch - 1) * 0.35;              // 진짜 남/여 목소리가 있으면 음높이는 살짝만
    rate = 1 + (rate - 1) * 0.6;
    const est = Math.max(900, clean.length * 150 / rate);
    if (!this.voiceOn || !clean) { setTimeout(() => onEnd?.(), clean ? est * 0.6 : 600); return est; }
    if (Native?.speak) {
      const id = 'u' + (++this.sid); if (onEnd) this.speakCbs[id] = onEnd;
      Native.speak(clean, pitch, rate, id, voice);
      setTimeout(() => { if (this.speakCbs[id]) { delete this.speakCbs[id]; onEnd?.(); } }, est + 3000);
      return est;
    }
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(clean); u.lang = 'ko-KR'; u.pitch = pitch; u.rate = rate;
      const vs = speechSynthesis.getVoices(), v = vs.find(x => x.name === voice) || vs.find(x => /^ko/i.test(x.lang)); if (v) u.voice = v;
      let done = false; const fin = () => { if (!done) { done = true; onEnd?.(); } };
      u.onend = fin; u.onerror = fin; speechSynthesis.speak(u); setTimeout(fin, est + 3000);
    } else setTimeout(() => onEnd?.(), est);
    return est;
  }
  stopSpeak() { Native?.stopSpeak ? Native.stopSpeak() : window.speechSynthesis?.cancel(); }
}
