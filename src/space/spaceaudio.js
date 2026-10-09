// FREE FREELY 우주 탐사 - 실시간 합성 사운드 (src/core/audio.js 엔진 위에 구성)
// 엔진·RCS·워프 저음 굉음·재진입 플라스마·바람·조종석 내부음. 진공에서는 조종석 내부음만 들린다.
import { Audio } from '../core/audio.js';

export class SpaceAudio {
  constructor() {
    this.on = false;
    this.engine = null;
    this.rcs = null;
    this.nodes = [];
  }

  start() {
    if (!Audio.ready || this.on) return;
    this.on = true;
    const ctx = Audio.ctx;
    this.engine = Audio.createEngineVoice('rocket');
    this.rcs = Audio.createEngineVoice('ion');
    // 워프 드론: 디튠 톱니파 + 저역 노이즈 + 스윕 공명
    const warpBus = ctx.createGain(); warpBus.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 6;
    warpBus.connect(lp).connect(Audio.fxBus);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 41;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 41.7;
    const o3 = ctx.createOscillator(); o3.type = 'sine'; o3.frequency.value = 27;
    for (const o of [o1, o2, o3]) { const g = ctx.createGain(); g.gain.value = o === o3 ? 0.6 : 0.25; o.connect(g).connect(warpBus); o.start(); this.nodes.push(o); }
    const n = ctx.createBufferSource(); n.buffer = Audio.noise.brown; n.loop = true;
    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 180; nb.Q.value = 1.2;
    const ng = ctx.createGain(); ng.gain.value = 0.7;
    n.connect(nb).connect(ng).connect(warpBus); n.start();
    this.nodes.push(n);
    this.warp = { bus: warpBus, lp, o1, o2, o3, nb };
    // 플라스마 굉음 (재진입)
    const p = ctx.createBufferSource(); p.buffer = Audio.noise.pink; p.loop = true;
    const pf = ctx.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 600; pf.Q.value = 0.6;
    const pg = ctx.createGain(); pg.gain.value = 0;
    p.connect(pf).connect(pg).connect(Audio.windBus); p.start();
    this.nodes.push(p);
    this.plasma = { pf, pg };
    // 조종석 내부음 (환기 + 전자 험)
    const h = ctx.createOscillator(); h.type = 'sine'; h.frequency.value = 118;
    const hg = ctx.createGain(); hg.gain.value = 0.012;
    h.connect(hg).connect(Audio.fxBus); h.start();
    const v = ctx.createBufferSource(); v.buffer = Audio.noise.pink; v.loop = true;
    const vf = ctx.createBiquadFilter(); vf.type = 'lowpass'; vf.frequency.value = 420;
    const vg = ctx.createGain(); vg.gain.value = 0.035;
    v.connect(vf).connect(vg).connect(Audio.fxBus); v.start();
    this.nodes.push(h, v);
    this.cabin = { hg, vg };
  }

  /**
   * @param s { throttle, thrust(0..1), rcs(0..1), warp(0..1), airspeed, density(kg/m³), heat(0..1), cockpit(bool), tierChange }
   */
  update(s) {
    if (!this.on) return;
    const t = Audio.ctx.currentTime;
    const air = Math.min(1, s.density / 0.05);    // 공기 전달 정도
    const inside = s.cockpit || air < 0.02;
    // 진공에서는 외부 소리가 선체 진동으로만 전달 (저역 통과 + 감쇠)
    Audio.setCabin(inside, true);
    if (this.engine) this.engine.update({ throttle: Math.min(1, s.thrust * (0.35 + 0.65 * Math.max(air, inside ? 0.5 : 0))), airspeed: s.airspeed }, 0.016);
    if (this.rcs) this.rcs.update({ throttle: s.rcs, rpm: s.rcs * 0.8 }, 0.016);
    const w = this.warp;
    w.bus.gain.setTargetAtTime(s.warp * 0.55, t, 0.3);
    w.lp.frequency.setTargetAtTime(160 + s.warp * 520, t, 0.4);
    w.o1.frequency.setTargetAtTime(38 + s.warp * 22, t, 0.5);
    w.o2.frequency.setTargetAtTime(38.8 + s.warp * 23.5, t, 0.5);
    w.nb.frequency.setTargetAtTime(120 + s.warp * 400, t, 0.4);
    this.plasma.pg.gain.setTargetAtTime(Math.min(0.9, s.heat * 0.9) * (0.3 + air * 0.7), t, 0.2);
    this.plasma.pf.frequency.setTargetAtTime(380 + s.heat * 900, t, 0.3);
    Audio.updateAtmos({ airspeed: s.airspeed * Math.sqrt(air), density: Math.min(1.3, s.density / 1.225 + air * 0.2), stall: 0, turbulence: s.heat * 0.6 });
    this.cabin.hg.gain.setTargetAtTime(s.cockpit ? 0.014 : 0.005, t, 0.4);
    this.cabin.vg.gain.setTargetAtTime(s.cockpit ? 0.04 : 0.012, t, 0.4);
  }

  /** 워프 진입/이탈 섬광음: 충격 저음 + 상승/하강 스윕 */
  warpBurst(enter) {
    if (!Audio.ready) return;
    const out = Audio._fxNode(null, 0.9, 0.7);
    Audio._tone(out, { type: 'sine', f0: enter ? 70 : 140, f1: enter ? 24 : 40, dur: 1.6, peak: 0.9, attack: 0.01 });
    Audio._burst(out, { noise: 'brown', filter: 'lowpass', f0: enter ? 300 : 1800, f1: enter ? 2400 : 180, dur: 1.4, peak: 0.6 });
    Audio._tone(out, { type: 'sawtooth', f0: enter ? 220 : 880, f1: enter ? 1300 : 160, dur: 0.9, peak: 0.12, delay: 0.05 });
  }

  tierClick(up) {
    if (!Audio.ready) return;
    const out = Audio._fxNode(null, 0.5, 0.2);
    Audio._tone(out, { type: 'triangle', f0: up ? 520 : 780, f1: up ? 980 : 420, dur: 0.22, peak: 0.18 });
    Audio._burst(out, { noise: 'brown', filter: 'lowpass', f0: 400, f1: 90, dur: 0.6, peak: 0.25 });
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    for (const n of this.nodes) { try { n.stop(); } catch (e) { /* noop */ } }
    this.nodes = [];
    if (this.engine) Audio.removeVoice(this.engine);
    if (this.rcs) Audio.removeVoice(this.rcs);
    this.engine = this.rcs = null;
    try { this.warp.bus.disconnect(); } catch (e) { /* noop */ }
    Audio.setCabin(false);
    Audio.updateAtmos({ airspeed: 0, density: 0 });
    Audio.clearWarnings();
  }
}
