// 열차 운전 물리와 운행 규칙 (견인·저항·제동, ATC/ATS, 출입문, 정차 판정, 안내방송)
import { clamp, smooth } from './geo.js';
import { ST } from './network.js';

const G = 9.81;

export class Sim {
  constructor(line, spec, a, b, loopDir = 1) {
    this.line = line; this.spec = spec;
    const S = line.stations;
    this.dir = line.loop ? loopDir : (b > a ? 1 : -1);
    this.route = [];
    for (let k = a, guard = 0; guard <= S.length; guard++) {
      this.route.push(S[k]); if (k === b) break;
      k = line.loop ? (k + this.dir + S.length) % S.length : k + this.dir;
    }
    this.half = line.platLen / 2;
    this.stopOf = st => st.s + this.dir * (this.half - 8);
    this.lat = (line.drive === 'L' ? -1 : 1) * this.dir * line.cfg.gap / 2;
    this.doorSide = line.drive === 'L' ? '왼쪽' : '오른쪽';
    this.m = spec.mass * 1000; this.me = this.m * 1.08;
    this.Fmax = this.m * spec.accel / 3.6; this.P = spec.powerKw * 1000;
    this.vmax = spec.maxKmh / 3.6;
    this.Cd = 0.6 + 0.36 * (spec.cars || 6);
    this.two = spec.control === 'two';
    this.NP = spec.notches; this.NB = spec.brakes;
    this.s = this.stopOf(this.route[0]); this.v = 0; this.odo = 0; this.t = 0;
    this.power = 0; this.brake = this.NB; this.handle = -this.NB; // 원핸들: -NB-1(비상) ~ +NP
    this.reverser = 0; this.te = 0; this.regen = 0; this.bc = 400; this.mr = 860; this.comp = false;
    this.pantoUp = spec.kind !== 'diesel'; this.panto = this.pantoUp ? 1 : 0; this.vcb = this.pantoUp; this.vcbT = 0;
    this.engine = spec.kind === 'diesel'; this.rpm = this.engine ? 400 : 0;
    this.doors = 'open'; this.doorT = 1; this.dwell = 0; this.lastStopSt = this.route[0];
    this.next = 1; this.atStation = 0; this.finished = false;
    this.atc = 0; this.atcBrake = false; this.atcWarn = false; this.atcCount = 0;
    this.headlight = true; this.horn = false; this.eb = false;
    this.events = []; this.stops = []; this.announced = {};
    this.jointAcc = 0;
    this.sys = line.type === 'hsr' ? 'ATC' : line.type === 'rail' ? 'ATS' : 'ATC';
  }
  emit(type, data) { this.events.push({ type, data }); }
  dist(sTarget) {
    const L = this.line.length; let d = (sTarget - this.s) * this.dir;
    if (this.line.loop) { d = ((d % L) + L) % L; if (d > L / 2) d -= L; }
    return d;
  }
  get kmh() { return this.v * 3.6; }
  get nextSt() { return this.route[this.next]; }

  // ── 조작 ──
  powerUp() { if (this.two) { if (this.brake > 0 && this.brake <= this.NB) return this.emit('msg', '제동 핸들을 먼저 푸세요'); this.power = Math.min(this.NP, this.power + 1); } else this.setHandle(this.handle + 1); this.emit('click'); }
  powerDown() { if (this.two) this.power = Math.max(0, this.power - 1); else this.setHandle(this.handle - 1); this.emit('click'); }
  brakeUp() { if (this.two) { this.power = 0; this.brake = Math.min(this.NB + 1, this.brake + 1); } else this.setHandle(this.handle - 1); this.emit('click'); }
  brakeDown() { if (this.two) this.brake = Math.max(0, this.brake - 1); else this.setHandle(Math.min(0, this.handle + 1)); this.emit('click'); }
  emergency() { if (this.two) { this.power = 0; this.brake = this.NB + 1; } else this.setHandle(-this.NB - 1); this.emit('click'); }
  neutral() { if (this.two) this.power = 0; else this.setHandle(0); this.emit('click'); }
  setHandle(h) {
    this.handle = clamp(Math.round(h), -this.NB - 1, this.NP);
    this.power = Math.max(0, this.handle); this.brake = Math.max(0, -this.handle);
  }
  setPower(p) { if (this.two) this.power = clamp(Math.round(p), 0, this.NP); }
  setBrake(b) { if (this.two) { this.brake = clamp(Math.round(b), 0, this.NB + 1); if (this.brake) this.power = 0; } }
  revFwd() { if (Math.abs(this.v) > 0.1) return this.emit('msg', '정차 중에만 역전기를 바꿀 수 있습니다'); this.reverser = Math.min(1, this.reverser + 1); this.emit('clunk'); }
  revBack() { if (Math.abs(this.v) > 0.1) return this.emit('msg', '정차 중에만 역전기를 바꿀 수 있습니다'); this.reverser = Math.max(-1, this.reverser - 1); this.emit('clunk'); }
  togglePanto() {
    if (this.spec.kind === 'diesel') { this.engine = !this.engine; this.emit(this.engine ? 'engineStart' : 'engineStop'); return; }
    this.pantoUp = !this.pantoUp; if (!this.pantoUp) this.vcb = false; else this.vcbT = 0; this.emit('panto', this.pantoUp);
  }
  openDoors() {
    if (this.doors !== 'closed') return;
    if (Math.abs(this.v) > 0.02) return this.emit('msg', '정차한 뒤에 출입문을 열 수 있습니다');
    const st = this.nearStation();
    if (!st) return this.emit('msg', '승강장이 아닌 곳에서는 출입문을 열 수 없습니다');
    this.doors = 'opening'; this.doorT = 0; this.mr -= 8; this.emit('doorOpen');
    if (st.st !== this.lastStopSt) this.arrive(st);
  }
  closeDoors() {
    if (this.doors !== 'open' && this.doors !== 'opening') return;
    if (this.dwell < 4) return this.emit('msg', '승객이 타고 내리는 중입니다');
    this.doors = 'closing'; this.doorT = 0; this.mr -= 8; this.emit('doorClose');
  }
  nearStation() {
    for (let k = Math.max(0, this.next - 1); k < Math.min(this.route.length, this.next + 1); k++) {
      const st = this.route[k], d = this.dist(this.stopOf(st));
      if (d > -14 && d < this.half * 2 - 24) return { st, d, k };
    }
    return null;
  }
  arrive({ st, d, k }) {
    this.lastStopSt = st; this.dwell = 0;
    const err = Math.abs(d), grade = err <= 1 ? '정확' : err <= 3 ? '양호' : err <= 8 ? '보통' : '미흡';
    this.stops.push({ name: st.name, err: d, grade });
    this.emit('arrive', { name: st.name, err: d, grade });
    if (k === this.route.length - 1) { this.finished = true; this.emit('finish'); }
    this.next = Math.min(this.route.length - 1, k + 1);
    this.announced = {};
  }

  // ── 매 프레임 ──
  update(dt) {
    if (dt <= 0) return;
    this.t += dt;
    const L = this.line, sp = this.spec;
    // 팬터그래프 / 주차단기 / 엔진
    this.panto = clamp(this.panto + (this.pantoUp ? dt / 4 : -dt / 2.5), 0, 1);
    if (this.pantoUp && this.panto >= 1 && !this.vcb) { this.vcbT += dt; if (this.vcbT > 1.5) { this.vcb = true; this.emit('vcb'); } }
    const powered = sp.kind === 'diesel' ? this.engine : this.vcb;
    // 출입문
    if (this.doors === 'opening') { this.doorT += dt / 2.6; if (this.doorT >= 1) { this.doors = 'open'; this.doorT = 1; } }
    else if (this.doors === 'closing') { this.doorT += dt / 3.2; if (this.doorT >= 1) { this.doors = 'closed'; this.doorT = 1; this.emit('doorsClosed'); } }
    if (this.doors === 'open' || this.doors === 'opening') this.dwell += dt;
    // ATC/ATS 제한속도
    const len = this.trainLen || 200;
    let lim = Math.min(L.limitAt(this.s), L.limitAt(this.s - this.dir * len * 0.5), L.limitAt(this.s - this.dir * len), sp.maxKmh);
    if (!L.loop) {
      const end = this.dir > 0 ? L.length - 6 : 6, dEnd = (end - this.s) * this.dir;
      lim = Math.min(lim, Math.max(0, Math.sqrt(Math.max(0, 2 * 0.75 * (dEnd - 2))) * 3.6));
    }
    this.atc = lim;
    const kmh = Math.abs(this.kmh);
    this.atcWarn = kmh > lim + 2;
    if (kmh > lim + 5 && !this.atcBrake) { this.atcBrake = true; this.atcCount++; this.emit('atc'); }
    if (this.atcBrake && kmh < Math.max(0, lim - 3)) this.atcBrake = false;
    // 견인
    this.eb = this.brake > this.NB;
    const canPower = powered && this.reverser !== 0 && this.doors === 'closed' && !this.atcBrake && !this.eb && (!this.two || this.brake === 0);
    let target = canPower ? this.power / this.NP : 0;
    if (sp.kind === 'diesel') { const tr = 400 + (this.engine ? this.power / this.NP * 650 : -400); this.rpm += (tr - this.rpm) * Math.min(1, dt * 0.6); target *= clamp((this.rpm - 420) / 600, 0, 1); }
    this.te += clamp(target - this.te, -dt * 1.2, dt * 0.8);
    const va = Math.abs(this.v);
    let Ft = this.te * Math.min(this.Fmax, this.P / Math.max(va, 0.5)) * (1 - smooth(this.vmax - 1.5, this.vmax + 0.5, va));
    Ft *= this.reverser;
    // 제동
    let bt = this.eb ? 1.18 : this.brake / this.NB;
    if (this.atcBrake) bt = Math.max(bt, 0.86);
    if (!powered && sp.kind !== 'diesel') bt = Math.max(bt, 0);
    const bcT = bt * 440, prev = this.bc;
    this.bc += (bcT - this.bc) * Math.min(1, dt / (sp.kind === 'hsr' ? 1.1 : 0.8));
    if (this.bc < prev - 0.5) this.mr -= (prev - this.bc) * 0.05;
    if (Math.floor(prev / 60) !== Math.floor(this.bc / 60) && this.bc < prev) this.emit('airRelease');
    this.mr += this.comp ? dt * 7 : 0;
    if (this.mr < 780 && !this.comp) { this.comp = true; this.emit('compOn'); } if (this.mr > 880 && this.comp) { this.comp = false; this.emit('compOff'); }
    const decMax = (this.eb ? sp.eb : sp.decel) / 3.6;
    const Fb = this.m * decMax * (this.bc / 440) / (this.eb ? 1.18 : 1);
    this.regen = sp.kind !== 'diesel' && va > 2 ? clamp(this.bc / 440, 0, 1) * smooth(1.5, 6, va) : 0;
    // 저항과 기울기
    const P = L.at(this.s);
    const grade = P.grade * this.dir;
    const Fr = this.m * (0.011 + 0.00016 * va) + this.Cd * va * va * (P.st === ST.TUNNEL || P.st === ST.SUBWAY ? 1.35 : 1);
    const Fg = -this.m * G * grade;
    let F = Ft + Fg;
    const sgn = Math.sign(this.v);
    if (va > 0.01) F -= sgn * (Fr + Fb);
    else {
      const hold = Fr + Fb + (this.doors !== 'closed' ? 1e9 : 0);
      if (Math.abs(F) <= hold) F = 0; else F -= Math.sign(F) * hold;
    }
    const v0 = this.v;
    this.v += F / this.me * dt;
    if (va > 0.01 && Math.sign(this.v) !== sgn && Math.abs(Ft + Fg) < Fr + Fb) this.v = 0;
    this.acc = (this.v - v0) / dt;
    const ds = this.v * dt;
    this.s += this.dir * ds; this.odo += Math.abs(ds);
    if (L.loop) this.s = ((this.s % L.length) + L.length) % L.length;
    else if (this.s < 1 || this.s > L.length - 1) { this.s = clamp(this.s, 1, L.length - 1); this.v = 0; }
    this.jointAcc += Math.abs(ds);
    this.inTunnel = P.st === ST.TUNNEL || P.st === ST.SUBWAY;
    // 앞뒤로 출구가 멀면 '깊은 지하' (바깥 풍경을 그리지 않아도 됨)
    this.deepUnder = false;
    if (this.inTunnel) {
      this.deepUnder = true;
      for (let d = -60; d <= 320 && this.deepUnder; d += L.ds) { const st = L.st[L.idx(this.s + this.dir * d)[0]]; if (st !== ST.TUNNEL && st !== ST.SUBWAY) this.deepUnder = false; }
    }
    this.onBridge = P.st === ST.BRIDGE;
    this.curv = Math.abs(L.cv[P.i]);
    this.stationLogic(dt);
  }

  stationLogic() {
    if (this.finished) return;
    const st = this.nextSt; if (!st) return;
    const d = this.dist(this.stopOf(st)), kmh = Math.abs(this.kmh), metro = this.spec.kind === 'metro' || this.line.type === 'metro' || this.line.type === 'light';
    const last = this.next === this.route.length - 1;
    // 안내방송
    if (this.doors === 'closed' && kmh > 12 && !this.announced.dep && d > 300) {
      this.announced.dep = true;
      if (metro) this.emit('announce', last ? `이번 역은 이 열차의 종착역인 ${st.name}, ${st.name}역입니다. 내리실 문은 ${this.doorSide}입니다.` : `이번 역은 ${st.name}, ${st.name}역입니다. 내리실 문은 ${this.doorSide}입니다.`);
      else this.emit('announce', `이 열차는 ${this.route[this.route.length - 1].name}까지 가는 ${this.spec.name} 열차입니다. 다음 정차역은 ${st.name}역입니다.`);
    }
    const near = metro ? 450 : this.line.type === 'hsr' ? 3500 : 2200;
    if (!this.announced.arr && d < near && d > 0) {
      this.announced.arr = true;
      this.emit('announce', metro ? `${st.name}, ${st.name}역입니다.` : `잠시 후 우리 열차는 ${st.name}역에 도착합니다. 내리실 손님께서는 잊으신 물건이 없는지 확인하시기 바랍니다.${last ? ' 이 열차의 종착역입니다.' : ''}`);
    }
    // 그냥 지나침
    if (d < -this.half * 2 && !last) {
      this.emit('msg', `${st.name}역을 정차하지 않고 지나쳤습니다`); this.stops.push({ name: st.name, err: null, grade: '통과' });
      this.next++; this.announced = {};
    }
    if (d < -12 && d > -this.half * 2 && Math.abs(this.v) < 0.05 && this.doors === 'closed' && !this.overrunMsg) {
      this.overrunMsg = true; this.emit('msg', '정차 위치를 지났습니다. 역전기를 후진(R)에 놓고 천천히 후진하세요');
    }
    if (d > 0) this.overrunMsg = false;
  }

  // 안내 문구 (화면 가운데)
  hint() {
    if (this.finished) return '운행 완료';
    const pw = this.spec.kind === 'diesel' ? this.engine : this.vcb;
    if (!pw) return this.spec.kind === 'diesel' ? '엔진 시동: P 키' : this.pantoUp ? '주차단기 투입 중...' : '팬터그래프를 올리세요: P 키';
    if (this.doors !== 'closed') return this.dwell < 4 ? '승객 승하차 중' : '출입문 닫기: C 키';
    if (this.reverser === 0) return '역전기를 전진에 놓으세요: F 키';
    if (Math.abs(this.v) < 0.05 && (this.two ? this.brake > 0 : this.handle < 0)) return this.two ? '제동을 풀고(D) 역행(W)하세요' : '핸들을 역행 쪽으로(W) 올리세요';
    return '';
  }
}
