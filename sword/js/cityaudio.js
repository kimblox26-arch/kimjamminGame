// SKY BLADE — 도시 소리 (녹음 없이 물리로 만든 소리)
//  - 자동차: 엔진 점화 주파수 (4기통: rpm/30 Hz, 변속 단마다 rpm 이 오르내림) + 배기 배음 + 타이어 노면 소음 (속도^1.5)
//    거리 감쇠 (1/d), 공기 흡수 (멀수록 고음이 줄어듦), 좌우 위치, 도플러 (다가오면 높게, 멀어지면 낮게)
//  - 버스: 디젤 6기통 (낮은 rpm), 정차할 때 공기 브레이크 '칙'
//  - 전동차: 바퀴 구름 소리, 레일 이음매 '덜컹' (차축마다), 가속 중 인버터(VVVF) 윙 소리가 속도 따라 계단식으로 오름
//  - 멀리서 들리는 도시 소음 (주변 차 수에 비례하는 낮은 웅웅거림), 사람 웅성거림 (가까운 사람 수)
//  - 경적 (두 음), 비명, 충돌 (금속 찌그러짐 + 유리 깨짐), 폭발
//  - 터널·지하철역 안에서는 울림 (긴 잔향)
//  - 직접 운전: 내 차 엔진·변속·타이어 끌림 소리
import * as THREE from 'three';
import { origin } from './frame.js';

const C = 343;                 // 음속 (m/s)
const NV = 5;                  // 동시에 낼 차 소리 수 (가까운 순)
const NT = 2;                  // 전동차 소리 수
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const _r = new THREE.Vector3(), _f = new THREE.Vector3();

// 변속: 속도 구간 [하한, 상한] 안에서 rpm 이 idle → red 로
function rpmOf(v, gears, idle, red) {
  v = Math.abs(v);
  let lo = 0;
  for (const hi of gears) { if (v < hi) return idle + (red - idle) * (v - lo) / (hi - lo); lo = hi; }
  return red;
}
const CAR_GEARS = [7, 13, 20, 27, 36, 70], BUS_GEARS = [4, 8, 13, 19, 40];

export class CityAudio {
  constructor(audio) {
    this.A = audio;
    const c = this.ctx = audio.ctx, B = audio._B;
    this.out = c.createGain(); this.out.gain.value = 1; this.out.connect(audio.amb);
    // 울림 (터널·역): 긴 잔향 임펄스
    this.wet = c.createGain(); this.wet.gain.value = 0;
    const conv = c.createConvolver(); conv.buffer = this._ir(3.2);
    this.out.connect(this.wet); this.wet.connect(conv); conv.connect(audio.amb);
    this.loop = (buf, rate = 1) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * buf.duration); return s; };
    // 멀리서 들리는 도시 소음: 갈색 소음 저역 + 분홍 소음 중역
    this.hum = c.createGain(); this.hum.gain.value = 0;
    const h1 = this.loop(B.brown, 0.8), hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 260;
    const h2 = this.loop(B.pink, 1), hf2 = c.createBiquadFilter(); hf2.type = 'bandpass'; hf2.frequency.value = 700; hf2.Q.value = 0.5;
    const h2g = c.createGain(); h2g.gain.value = 0.25;
    h1.connect(hf); hf.connect(this.hum); h2.connect(hf2); hf2.connect(h2g); h2g.connect(this.hum); this.hum.connect(this.out);
    // 사람 웅성거림: 세 포먼트 대역 + 음절처럼 출렁이는 세기
    this.crowd = c.createGain(); this.crowd.gain.value = 0;
    for (const [f, q, lf] of [[520, 3, 3.1], [1350, 4, 4.3], [2600, 5, 5.7]]) {
      const s = this.loop(B.pink, 1), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const am = c.createGain(); am.gain.value = 0.5;
      const lfo = c.createOscillator(); lfo.frequency.value = lf; const lg = c.createGain(); lg.gain.value = 0.45; lfo.connect(lg); lg.connect(am.gain); lfo.start();
      const lfo2 = c.createOscillator(); lfo2.frequency.value = lf * 0.37; const lg2 = c.createGain(); lg2.gain.value = 0.3; lfo2.connect(lg2); lg2.connect(am.gain); lfo2.start();
      s.connect(bp); bp.connect(am); am.connect(this.crowd);
    }
    this.crowd.connect(this.out);
    // 차 소리 목소리들
    this.cars = [];
    for (let i = 0; i < NV + 1; i++) this.cars.push(this._carVoice());
    this.mine = this.cars.pop();                  // 내가 모는 차
    // 전동차
    this.trains = [];
    for (let i = 0; i < NT; i++) this.trains.push(this._trainVoice());
    this.time = 0;
    this.prev = new Map();     // 대상별 이전 위치 (속도·도플러)
    this.hornT = 0;
  }

  // 잔향 임펄스: 지수 감쇠 소음 + 초기 반사
  _ir(sec) {
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * sec), b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * sec * 0.22)) * 0.5;
      for (let k = 1; k < 12; k++) { const at = Math.floor(sr * (0.011 * k + Math.random() * 0.004)); if (at < n) d[at] += (ch ? -1 : 1) * 0.6 / k; }
    }
    return b;
  }

  _carVoice() {
    const c = this.ctx, B = this.A._B;
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'square';
    const o3 = c.createOscillator(); o3.type = 'triangle';
    const mix = c.createGain(); mix.gain.value = 0;
    const g2 = c.createGain(), g3 = c.createGain();
    g2.gain.value = 0.6; g3.gain.value = 0.35;
    const sh = c.createWaveShaper(); sh.curve = this._soft(); sh.oversample = '2x';
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 1.2;
    o1.connect(sh); o2.connect(g2); g2.connect(sh); o3.connect(g3); g3.connect(sh); sh.connect(lp); lp.connect(mix);
    // 타이어 노면 소음
    const tn = this.loop(B.white, 1), tb = c.createBiquadFilter(); tb.type = 'bandpass'; tb.frequency.value = 1100; tb.Q.value = 0.7;
    const tg = c.createGain(); tg.gain.value = 0;
    tn.connect(tb); tb.connect(tg);
    // 공기 흡수 → 좌우 → 거리
    const air = c.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 12000;
    const pan = c.createStereoPanner();
    const vol = c.createGain(); vol.gain.value = 0;
    mix.connect(air); tg.connect(air); air.connect(pan); pan.connect(vol); vol.connect(this.out);
    for (const o of [o1, o2, o3]) { o.frequency.value = 30; o.start(); }
    return { o1, o2, o3, mix, lp, tg, tn, tb, air, pan, vol, id: null };
  }

  _trainVoice() {
    const c = this.ctx, B = this.A._B;
    const rn = this.loop(B.brown, 1), rl = c.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 380;
    const rg = c.createGain(); rg.gain.value = 0;
    rn.connect(rl); rl.connect(rg);
    // 바퀴 끽 (곡선) 대신 높은 구름 소리
    const hn = this.loop(B.pink, 1.5), hb = c.createBiquadFilter(); hb.type = 'bandpass'; hb.frequency.value = 1800; hb.Q.value = 1.5;
    const hg = c.createGain(); hg.gain.value = 0;
    hn.connect(hb); hb.connect(hg);
    // VVVF 인버터: 사각파 → 좁은 대역
    const inv = c.createOscillator(); inv.type = 'square'; inv.frequency.value = 400; inv.start();
    const ib = c.createBiquadFilter(); ib.type = 'bandpass'; ib.frequency.value = 800; ib.Q.value = 6;
    const ig = c.createGain(); ig.gain.value = 0;
    inv.connect(ib); ib.connect(ig);
    const air = c.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 9000;
    const pan = c.createStereoPanner(), vol = c.createGain(); vol.gain.value = 0;
    rg.connect(air); hg.connect(air); ig.connect(air); air.connect(pan); pan.connect(vol); vol.connect(this.out);
    return { rg, rl, hg, inv, ib, ig, air, pan, vol, id: null, clackD: 0 };
  }

  _soft() {
    if (this._sc) return this._sc;
    const n = 1024, a = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; a[i] = Math.tanh(x * 2.2); }
    return (this._sc = a);
  }

  // 듣는 사람(카메라) 기준: 거리, 좌우, 다가오는 속도
  _rel(camera, x, y, z, vx, vz) {
    _r.set(x - origin.x - camera.position.x, y - origin.y - camera.position.y, z - origin.z - camera.position.z);
    const d = Math.max(0.5, _r.length());
    _f.setFromMatrixColumn(camera.matrixWorld, 0);       // 오른쪽
    const pan = clamp(_r.dot(_f) / d, -1, 1) * 0.85;
    const vr = (vx * _r.x + vz * _r.z) / d;                // 양수 = 멀어짐
    return { d, pan, dop: C / (C + clamp(vr - this.lvr(_r, d), -150, 150)) };
  }
  lvr(r, d) { const v = this.listenerV; return v ? (v.x * r.x + v.z * r.z) / d * -1 : 0; }

  _setCar(V, o, rel, now, kind, load) {
    const T = 0.06;
    const v = Math.abs(o.v || 0);
    const bus = kind === 'bus';
    const rpm = bus ? rpmOf(v, BUS_GEARS, 620, 2100) : rpmOf(v, CAR_GEARS, 820, 4200);
    const f = rpm / 60 * (bus ? 3 : 2) * rel.dop;            // 점화 주파수 (6기통 디젤 / 4기통)
    V.o1.frequency.setTargetAtTime(f, now, T);
    V.o2.frequency.setTargetAtTime(f * 0.5, now, T);
    V.o3.frequency.setTargetAtTime(f * 2.01, now, T);
    V.lp.frequency.setTargetAtTime(bus ? 220 + rpm * 0.18 : 280 + rpm * 0.22, now, T);
    const eng = (bus ? 0.22 : 0.12) * (0.35 + 0.65 * load) * (0.6 + rpm / 6000);
    V.mix.gain.setTargetAtTime(eng, now, T);
    V.tg.gain.setTargetAtTime(Math.pow(v / 20, 1.5) * (bus ? 0.12 : 0.08), now, T);
    V.tn.playbackRate.setTargetAtTime(rel.dop, now, T);
    V.air.frequency.setTargetAtTime(400 + 15000 * Math.exp(-rel.d / 220), now, T);
    V.pan.pan.setTargetAtTime(rel.pan, now, T);
    V.vol.gain.setTargetAtTime(Math.min(1, 6 / rel.d), now, T);
  }

  /** 매 프레임: camera, town, player, drive, 환경 { under: 땅속(터널·역) } */
  update(dt, camera, town, player, drive, env) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    this.time += dt;
    const now = c.currentTime;
    this.listenerV = player ? player.vel : null;
    const T = 0.1;
    // 울림
    this.wet.gain.setTargetAtTime(env && env.under ? 0.55 : 0.04, now, 0.3);
    if (!town || !env || !env.show) {
      this.hum.gain.setTargetAtTime(0, now, 0.3); this.crowd.gain.setTargetAtTime(0, now, 0.3);
      for (const V of this.cars) V.vol.gain.setTargetAtTime(0, now, 0.1);
      for (const V of this.trains) V.vol.gain.setTargetAtTime(0, now, 0.1);
      this.mine.vol.gain.setTargetAtTime(0, now, 0.1);
      return;
    }
    const cx = camera.position.x + origin.x, cy = camera.position.y + origin.y, cz = camera.position.z + origin.z;
    // 주변 차 (가까운 순), 먼 차들의 합 → 도시 소음
    const list = [];
    let far = 0;
    for (const o of town.cars) {
      if (!o.alive || o.hidden || o.st === 'player') continue;
      const d = Math.hypot(o.x - cx, o.y - cy, o.z - cz);
      if (d < 120) list.push([d, o]);
      far += Math.min(1, 40 / (d + 10)) * (0.3 + Math.abs(o.v || 0) / 15);
    }
    list.sort((a, b) => a[0] - b[0]);
    const alt = Math.max(0, cy - (env.ground || 0));
    const altK = Math.exp(-alt / 250);
    this.hum.gain.setTargetAtTime(clamp(0.015 + Math.log1p(far) * 0.03, 0, 0.18) * (0.3 + 0.7 * altK) * (env.under ? 0.25 : 1), now, 0.4);
    // 사람
    let np = 0;
    for (const o of town.people) if (o.alive && !o.dead && Math.hypot(o.x - cx, o.z - cz) < 35) np++;
    this.crowd.gain.setTargetAtTime(clamp(Math.sqrt(np) * 0.012, 0, 0.09) * altK * (env.under ? 0.3 : 1), now, 0.5);
    // 차 목소리 배정 (같은 차는 같은 목소리 유지)
    const want = list.slice(0, NV).map((e) => e[1]);
    const free = this.cars.filter((V) => !want.includes(V.id));
    for (const o of want) {
      let V = this.cars.find((q) => q.id === o);
      if (!V) { V = free.shift(); if (!V) continue; V.id = o; }
    }
    for (const V of this.cars) {
      const o = V.id;
      if (!o || !want.includes(o)) { V.id = null; V.vol.gain.setTargetAtTime(0, now, 0.15); continue; }
      const pv = this.prev.get(o) || [o.x, o.z, o.v || 0];
      const vx = (o.x - pv[0]) / Math.max(dt, 1e-3), vz = (o.z - pv[1]) / Math.max(dt, 1e-3);
      const acc = ((o.v || 0) - pv[2]) / Math.max(dt, 1e-3);
      this.prev.set(o, [o.x, o.z, o.v || 0]);
      const rel = this._rel(camera, o.x, o.y + 0.5, o.z, clamp(vx, -60, 60), clamp(vz, -60, 60));
      this._setCar(V, o, rel, now, o.kind, clamp(0.3 + acc * 0.4, 0, 1));
      if (o.broken) V.vol.gain.setTargetAtTime(0, now, 0.2);
    }
    if (this.prev.size > 400) this.prev.clear();
    // 내 차
    const D = drive && drive.v;
    if (D && D.kind === 'car') {
      const o = D.o, v = Math.abs(D.sp), bus = o.kind === 'bus';
      const rpm = bus ? rpmOf(v, BUS_GEARS, 620, 2100) : rpmOf(v, CAR_GEARS, 820, 6200);
      const V = this.mine;
      V.o1.frequency.setTargetAtTime(rpm / 60 * (bus ? 3 : 2), now, 0.04);
      V.o2.frequency.setTargetAtTime(rpm / 120 * (bus ? 3 : 2), now, 0.04);
      V.o3.frequency.setTargetAtTime(rpm / 30 * (bus ? 3 : 2) * 1.005, now, 0.04);
      V.lp.frequency.setTargetAtTime(300 + rpm * 0.35, now, 0.04);
      V.mix.gain.setTargetAtTime(0.16 + 0.14 * (drive.thr || 0), now, 0.05);
      V.tg.gain.setTargetAtTime(Math.pow(v / 20, 1.5) * 0.07 + (drive.skid || 0) * 0.25, now, 0.05);
      V.tb.frequency.setTargetAtTime(1100 + (drive.skid || 0) * 900, now, 0.05);
      V.air.frequency.setTargetAtTime(14000, now, 0.1); V.pan.pan.setTargetAtTime(0, now, 0.1);
      V.vol.gain.setTargetAtTime(0.9, now, 0.1);
    } else this.mine.vol.gain.setTargetAtTime(0, now, 0.15);
    // 전동차 (지상·역): 가까운 열차의 칸들 중 가장 가까운 칸
    const tl = [];
    for (const Tr of town.trains) {
      if (!Tr.alive || Tr.derailed) continue;
      const H = Tr.hist, last = H.length ? H[H.length - 1] : null;
      if (!last || last[4]) continue;
      const d = Math.hypot(Tr.x - cx, last[1] - cy, Tr.z - cz);
      if (d < 400) tl.push([d, Tr, last[1]]);
    }
    if (env.extraTrains) for (const e of env.extraTrains) tl.push(e);
    tl.sort((a, b) => a[0] - b[0]);
    this.trains.forEach((V, i) => {
      const e = tl[i];
      if (!e) { V.vol.gain.setTargetAtTime(0, now, 0.3); V.id = null; return; }
      const [d, Tr, y] = e;
      const v = Math.abs(Tr.v || 0);
      const pv = this.prev.get(Tr) || [Tr.x, Tr.z, v];
      const acc = (v - pv[2]) / Math.max(dt, 1e-3);
      this.prev.set(Tr, [Tr.x, Tr.z, v]);
      const rel = this._rel(camera, Tr.x, y + 1.5, Tr.z, (Tr.tx || 0) * (Tr.dir || 1) * v, (Tr.tz || 0) * (Tr.dir || 1) * v);
      V.rg.gain.setTargetAtTime(clamp(v / 20, 0, 1.4) * 0.35, now, T);
      V.rl.frequency.setTargetAtTime(200 + v * 12, now, T);
      V.hg.gain.setTargetAtTime(clamp((v - 8) / 30, 0, 1) * 0.06, now, T);
      // 인버터: 가속할 때 속도에 따라 계단식으로 오름 (0~10 m/s: 비동기, 그 위 동기 구간)
      const step = v < 6 ? 380 + v * 90 : v < 14 ? 520 + (v - 6) * 70 : 700 + (v - 14) * 25;
      V.inv.frequency.setTargetAtTime(step * rel.dop, now, 0.05);
      V.ib.frequency.setTargetAtTime(step * 2 * rel.dop, now, 0.05);
      V.ig.gain.setTargetAtTime((acc > 0.05 || (Tr.accel || 0) > 0.05 ? 0.05 : acc < -0.05 ? 0.025 : 0.004) * clamp(v / 4, 0.2, 1), now, 0.1);
      V.air.frequency.setTargetAtTime(500 + 12000 * Math.exp(-rel.d / 250), now, T);
      V.pan.pan.setTargetAtTime(rel.pan, now, T);
      V.vol.gain.setTargetAtTime(Math.min(1.2, 12 / rel.d), now, T);
      // 레일 이음매: 25 m 마다 차축 두 쌍이 지나감 ('덜컹-덜컹')
      V.clackD += v * dt;
      if (V.clackD > 12.5 && v > 2) {
        V.clackD = 0;
        const g = Math.min(1, 10 / rel.d) * clamp(v / 15, 0.2, 1);
        const gap = 2.1 / Math.max(v, 1);
        this._clack(now, g, rel.pan); this._clack(now + gap, g * 0.8, rel.pan);
      }
    });
  }

  // 짧은 금속 타격 (레일 이음매)
  _clack(t, g, pan) {
    const c = this.ctx, B = this.A._B;
    const s = c.createBufferSource(); s.buffer = B.white; s.playbackRate.value = 0.6;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 2;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    const gn = c.createGain(), go = c.createGain(), p = c.createStereoPanner(); p.pan.value = pan;
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.25 * g, t + 0.002); gn.gain.exponentialRampToValueAtTime(1e-4, t + 0.05);
    go.gain.setValueAtTime(0, t); go.gain.linearRampToValueAtTime(0.4 * g, t + 0.003); go.gain.exponentialRampToValueAtTime(1e-4, t + 0.1);
    s.connect(bp); bp.connect(gn); gn.connect(p); o.connect(go); go.connect(p); p.connect(this.out);
    s.start(t, Math.random()); s.stop(t + 0.08); o.start(t); o.stop(t + 0.12);
  }

  /** 사건 소리: horn 경적, scream 비명, crash 충돌, boom 폭발, chime 역 안내음, brake 공기 브레이크, door 문 */
  event(type, x, y, z, camera, k = 1) {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !camera) return;
    const now = c.currentTime;
    const rel = this._rel(camera, x, y, z, 0, 0);
    const g = Math.min(1, 8 / rel.d) * k;
    if (g < 0.01) return;
    const p = c.createStereoPanner(); p.pan.value = rel.pan;
    const air = c.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 400 + 15000 * Math.exp(-rel.d / 200);
    air.connect(p); p.connect(this.out);
    const B = this.A._B;
    const env = (gn, t0, a, peak, d) => { gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(peak, t0 + a); gn.gain.exponentialRampToValueAtTime(1e-4, t0 + a + d); };
    if (type === 'horn') {
      // 자동차 경적: 두 음 (약 415 Hz, 500 Hz) 사각파 + 공명
      const dur = 0.25 + Math.random() * 0.35, n = Math.random() < 0.4 ? 2 : 1;
      for (let r = 0; r < n; r++) for (const f of [415, 498]) {
        const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 1.5;
        const gn = c.createGain(); const t0 = now + r * (dur + 0.12);
        gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(0.12 * g, t0 + 0.01); gn.gain.setValueAtTime(0.12 * g, t0 + dur); gn.gain.linearRampToValueAtTime(0, t0 + dur + 0.03);
        o.connect(bp); bp.connect(gn); gn.connect(air); o.start(t0); o.stop(t0 + dur + 0.05);
      }
    } else if (type === 'scream') {
      // 비명: 떨리는 높은 톱니파 + 성대 포먼트
      const f0 = 600 + Math.random() * 500, dur = 0.6 + Math.random() * 0.6;
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 0.8, now); o.frequency.linearRampToValueAtTime(f0 * 1.15, now + 0.12); o.frequency.linearRampToValueAtTime(f0 * 0.75, now + dur);
      const vib = c.createOscillator(); vib.frequency.value = 7 + Math.random() * 3; const vg = c.createGain(); vg.gain.value = f0 * 0.04; vib.connect(vg); vg.connect(o.frequency);
      const gn = c.createGain(); env(gn, now, 0.04, 0.09 * g, dur);
      for (const [f, q] of [[900, 4], [2400, 6]]) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; o.connect(bp); bp.connect(gn); }
      gn.connect(air); o.start(now); vib.start(now); o.stop(now + dur + 0.1); vib.stop(now + dur + 0.1);
    } else if (type === 'crash') {
      // 금속 찌그러짐 (공명하는 잡음) + 유리 조각 (높은 짧은 음들)
      const s = c.createBufferSource(); s.buffer = B.crackle || B.white;
      const gn = c.createGain(); env(gn, now, 0.004, 0.5 * g, 0.5);
      for (const f of [310, 740, 1530, 2900]) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * (0.9 + Math.random() * 0.2); bp.Q.value = 8; s.connect(bp); bp.connect(gn); }
      const th = c.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(90, now); th.frequency.exponentialRampToValueAtTime(40, now + 0.2);
      const tg = c.createGain(); env(tg, now, 0.003, 0.6 * g, 0.25); th.connect(tg); tg.connect(air);
      gn.connect(air); s.start(now); s.stop(now + 0.8); th.start(now); th.stop(now + 0.4);
      for (let i = 0; i < 14; i++) {
        const t = now + 0.02 + Math.random() * 0.4, o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 3000 + Math.random() * 5000;
        const pg = c.createGain(); env(pg, t, 0.001, 0.05 * g, 0.05 + Math.random() * 0.1); o.connect(pg); pg.connect(air); o.start(t); o.stop(t + 0.2);
      }
    } else if (type === 'boom') {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, now); o.frequency.exponentialRampToValueAtTime(25, now + 0.8);
      const og = c.createGain(); env(og, now, 0.005, 0.9 * g, 1.2); o.connect(og); og.connect(air); o.start(now); o.stop(now + 1.4);
      const s = c.createBufferSource(); s.buffer = B.brown; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const sg = c.createGain(); env(sg, now, 0.003, 0.8 * g, 1.6); s.connect(lp); lp.connect(sg); sg.connect(air); s.start(now); s.stop(now + 2);
    } else if (type === 'brake') {
      // 버스 공기 브레이크: 높은 '칙' 소음
      const s = c.createBufferSource(); s.buffer = B.white; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const gn = c.createGain(); env(gn, now, 0.01, 0.12 * g, 0.5); s.connect(hp); hp.connect(gn); gn.connect(air); s.start(now, Math.random()); s.stop(now + 0.7);
    } else if (type === 'chime') {
      // 역 도착 알림: 맑은 네 음 (종소리 배음)
      [659, 784, 988, 1319].forEach((f, i) => {
        const t = now + i * 0.32;
        for (const [m, a] of [[1, 1], [2.76, 0.3], [5.4, 0.12]]) {
          const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
          const gn = c.createGain(); env(gn, t, 0.005, 0.07 * a * g, 1.4); o.connect(gn); gn.connect(air); o.start(t); o.stop(t + 1.6);
        }
      });
    } else if (type === 'door') {
      // 스크린도어·출입문 여닫힘: 짧은 두 음 + 공기 소리
      [880, 660].forEach((f, i) => { const t = now + i * 0.25, o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; const gn = c.createGain(); env(gn, t, 0.005, 0.06 * g, 0.2); o.connect(gn); gn.connect(air); o.start(t); o.stop(t + 0.3); });
      const s = c.createBufferSource(); s.buffer = B.pink; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600;
      const sg = c.createGain(); env(sg, now + 0.4, 0.2, 0.05 * g, 0.9); s.connect(bp); bp.connect(sg); sg.connect(air); s.start(now + 0.4); s.stop(now + 1.6);
    }
  }
}
