// 소리: 실제 녹음 효과음(assets/sfx) + 3D 위치 + 손님/사장님 목소리(기기 TTS)
import * as THREE from 'three';

const SFX = ['chime', 'door', 'register', 'bill', 'bag', 'step1', 'step2', 'thud', 'key', 'night', 'engine', 'whoosh'];
export const Native = window.NativeApp || null;

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
  speak(text, { pitch = 1, rate = 1 } = {}, onEnd) {
    const clean = text.replace(/\(.*?\)/g, '').replace(/[~…]/g, ' ').trim();
    const est = Math.max(900, clean.length * 140 / rate);
    if (!this.voiceOn || !clean) { setTimeout(() => onEnd?.(), clean ? est * 0.6 : 600); return est; }
    if (Native?.speak) {
      const id = 'u' + (++this.sid); if (onEnd) this.speakCbs[id] = onEnd;
      Native.speak(clean, pitch, rate, id);
      setTimeout(() => { if (this.speakCbs[id]) { delete this.speakCbs[id]; onEnd?.(); } }, est + 2500);
      return est;
    }
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(clean); u.lang = 'ko-KR'; u.pitch = pitch; u.rate = rate;
      const v = speechSynthesis.getVoices().find(v => v.lang?.startsWith('ko')); if (v) u.voice = v;
      let done = false; const fin = () => { if (!done) { done = true; onEnd?.(); } };
      u.onend = fin; u.onerror = fin; speechSynthesis.speak(u); setTimeout(fin, est + 2500);
    } else setTimeout(() => onEnd?.(), est);
    return est;
  }
  stopSpeak() { Native?.stopSpeak ? Native.stopSpeak() : window.speechSynthesis?.cancel(); }
}
