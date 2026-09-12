// FREE FREELY - 기체 조종 시스템 (추진, 착륙장치, 손상, 화재, 착수, 자동조종, 무장)
import * as THREE from 'three';
import { clamp, clamp01, lerp, smoothstep, damp, rand, approach, DEG } from '../core/utils.js';
import { Settings } from '../core/settings.js';
import { atmosphere, balloonBuoyancy, waterForces, WATER_DENSITY } from '../physics/aero.js';
import { RUNWAY } from '../world/terrain.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _wp = new THREE.Vector3();
const _dir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CraftController {
  constructor(craft, world, fx, audio) {
    this.craft = craft;
    this.world = world;
    this.fx = fx;
    this.audio = audio;

    this.ctrl = { pitch: 0, roll: 0, yaw: 0, flap: 0, trim: 0 };
    this.throttle = 0;
    this.targetThrottle = 0;
    this.afterburner = false;
    this.brake = 0;
    this.airbrake = false;
    this.gearDown = 1;        // 1 = 내림, 0 = 올림
    this.gearTarget = 1;
    this.burnerOn = false;
    this.ventOpen = false;
    this.lightsOn = false;
    this.engineOn = true;
    this.autopilot = 'off';   // off | level | alt | heading
    this.apTargetAlt = 500;
    this.apTargetHeading = 0;
    this.rcsEnabled = true;

    this.integrity = 100;
    this.fire = 0;
    this.crashed = false;
    this.destroyed = false;
    this.sinking = 0;
    this.waterFill = 0;
    this.onGround = false;
    this.inWater = false;
    this.reentryHeat = 0;
    this.flares = craft.flares;
    this.chuteAmount = 0;
    this.chuteDeployed = false;
    this.gForceFiltered = 1;
    this.gMax = 1;
    this.gMin = 1;
    this.stall = 0;
    this.envelopeTemp = atmosphere(0).temperature;
    this.telemetry = {};
    this.warnings = [];
    this.events = [];
    this.score = { landings: 0, crashes: 0, distance: 0, maxAlt: 0, maxSpeed: 0, flightTime: 0 };
    this._impactCooldown = 0;
    this._squeal = 0;
    this._hitLog = {};
    this._lastPos = craft.body.position.clone();
    this._touchdownVs = 0;
    this._airborneTime = 0;
    this._sonicDone = false;

    // 엔진 사운드 보이스
    this.voices = [];
    for (const e of craft.engines) {
      const kind = e.type === 'prop' ? 'prop' : e.type === 'jet' ? 'jet' : e.type === 'rocket' ? 'rocket'
        : e.type === 'ion' ? 'ion' : e.type === 'burner' ? 'burner' : null;
      if (!kind) { this.voices.push(null); continue; }
      const v = audio && audio.ready ? audio.createEngineVoice(kind, { blades: 3 }) : null;
      this.voices.push(v);
    }
  }

  dispose() {
    for (const v of this.voices) if (v) this.audio.removeVoice(v);
    this.voices.length = 0;
    if (this.audio) { this.audio.fire(false); this.audio.bubbles(null, false); this.audio.clearWarnings(); }
  }

  /* ------------------------------ 입력 처리 ------------------------------ */
  readInput(input, dt) {
    if (this.destroyed) { this.targetThrottle = 0; return; }
    const c = this.craft;
    this.ctrl.pitch = input.axes.pitch;
    this.ctrl.roll = input.axes.roll;
    this.ctrl.yaw = input.axes.yaw;
    this.targetThrottle = input.axes.throttle;

    if (input.wasPressed('gear')) this.toggleGear();
    if (input.wasPressed('flapsDown')) this.setFlaps(this.ctrl.flap + 0.34);
    if (input.wasPressed('flapsUp')) this.setFlaps(this.ctrl.flap - 0.34);
    if (input.wasPressed('lights')) { this.lightsOn = !this.lightsOn; this.event(this.lightsOn ? '조명 ON' : '조명 OFF'); }
    if (input.wasPressed('engineToggle')) { this.engineOn = !this.engineOn; this.event(this.engineOn ? '엔진 시동' : '엔진 정지'); }
    if (input.wasPressed('autopilot')) this.cycleAutopilot();
    if (input.wasPressed('chute')) this.deployChute();
    if (input.wasPressed('flare')) this.dropFlare();

    this.brake = input.isDown('brake') ? 1 : 0;
    this.airbrake = input.isDown('airbrake');
    this.afterburner = input.isDown('afterburner') && this.throttle > 0.55;
    this.burnerOn = input.isDown('burner');
    this.ventOpen = input.isDown('vent');
    if (input.isDown('rcsUp')) this.ctrl.trim = clamp(this.ctrl.trim + dt * 0.25, -0.5, 0.5);
    if (input.isDown('rcsDown')) this.ctrl.trim = clamp(this.ctrl.trim - dt * 0.25, -0.5, 0.5);
    if (input.isDown('fire')) this.firing = true; else this.firing = false;
    void c;
  }

  event(text, kind = 'info') {
    this.events.push({ text, kind, time: performance.now() });
    if (this.events.length > 8) this.events.shift();
  }

  toggleGear() {
    if (!this.craft.gears.length) return;
    this.gearTarget = this.gearTarget > 0.5 ? 0 : 1;
    this.event(this.gearTarget > 0.5 ? '착륙장치 내림' : '착륙장치 올림');
    if (this.audio) this.audio.gearThump(this.craft.body.position, 0.35);
  }

  setFlaps(v) {
    const nv = clamp(Math.round(v * 3) / 3, 0, 1);
    if (nv !== this.ctrl.flap) {
      this.ctrl.flap = nv;
      this.event('플랩 ' + Math.round(nv * 100) + '%');
      if (this.audio) this.audio.ui('place');
    }
  }

  cycleAutopilot() {
    const modes = ['off', 'level', 'alt', 'heading'];
    const i = modes.indexOf(this.autopilot);
    this.autopilot = modes[(i + 1) % modes.length];
    if (this.autopilot === 'alt') this.apTargetAlt = Math.max(120, this.craft.body.position.y);
    if (this.autopilot === 'heading') this.apTargetHeading = this.craft.body.getAttitude().heading;
    this.event('자동조종: ' + { off: '해제', level: '수평 유지', alt: '고도 유지', heading: '방위 유지' }[this.autopilot]);
    if (this.audio) this.audio.ui('confirm');
  }

  deployChute() {
    if (!this.craft.chute || this.chuteDeployed) return;
    this.chuteDeployed = true;
    this.event('비상 낙하산 전개!', 'warn');
    if (this.audio) this.audio.ui('confirm');
  }

  dropFlare() {
    if (this.flares <= 0) return;
    this.flares -= 6;
    const p = this.craft.body.position;
    for (let i = 0; i < 6; i++) {
      this.fx.fire.spawn({
        x: p.x, y: p.y, z: p.z,
        vx: rand(-14, 14) - this.craft.body.velocity.x * 0.1,
        vy: rand(-8, 2), vz: rand(-14, 14) - this.craft.body.velocity.z * 0.1,
        size: rand(4, 9), sizeRate: 6,
        color: { r: 1, g: 0.95, b: 0.8 }, colorTo: { r: 1, g: 0.45, b: 0.1 },
        life: rand(2.5, 5), drag: 0.35, gravity: 3.2, fade: 0.8,
      });
    }
    this.event('플레어 발사');
    if (this.audio) this.audio.gunShot(p);
  }

  /* ------------------------------ 메인 갱신 ------------------------------ */
  update(dt) {
    const c = this.craft;
    const body = c.body;
    const pos = body.position;
    const atm = atmosphere(pos.y);
    const surface = this.world.surfaceAt(pos.x, pos.z);
    const agl = pos.y - surface.height;
    const speed = body.velocity.length();
    const wind = this.world.env.wind;
    const relWind = _v1.copy(body.velocity).sub(wind);
    const airspeed = relWind.length();
    const mach = airspeed / atm.speedOfSound;
    const q = 0.5 * atm.density * airspeed * airspeed;

    this.throttle = approach(this.throttle, this.destroyed ? 0 : this.targetThrottle, 0.85, dt);
    if (this.autopilot !== 'off' && !this.destroyed) this.applyAutopilot(dt, agl);

    const env = {
      density: atm.density,
      wind,
      mach,
      groundHeight: agl,
      speedOfSound: atm.speedOfSound,
    };

    /* --- 비행 안정 보조 (조종 보조 설정) --- */
    this.applyStabilityAugmentation(dt, atm, airspeed);

    /* --- 공력 --- */
    let stallMax = 0;
    for (const s of c.surfaces) {
      if (!s.enabled) continue;
      s.apply(body, this.ctrl, env);
      stallMax = Math.max(stallMax, s.lastStall);
      // 날개 끝 와류 (고하중)
      if (!s.vertical && Math.abs(s.lastCL) > 1.15 && atm.density > 0.35 && Math.random() < 0.35) {
        body.localToWorld(_v2.copy(s.pos).add(_v3.set(s.span * 0.45 * (s.spanSign || 1), 0, 0)), _wp);
        this.fx.vortex(_wp, body.forward.multiplyScalar(-1), clamp(Math.abs(s.lastCL) - 1.1, 0, 1));
      }
    }
    this.stall = stallMax;
    const extraDrag = (this.gearDown > 0.1 ? 0.12 * this.gearDown : 0) + (this.airbrake ? 0.5 : 0) + this.ctrl.flap * 0.1;
    c.bodyDrag.apply(body, env, extraDrag);

    /* --- 추진 --- */
    this.updateEngines(dt, atm, airspeed, mach);

    /* --- 열기구 부력 --- */
    if (c.balloonVolume > 0 || c.heliumVolume > 0) this.updateBalloon(dt, atm);

    /* --- 물 --- */
    this.updateWater(dt, surface, speed);

    /* --- 착륙장치 --- */
    this.gearDown = approach(this.gearDown, this.gearTarget, 0.35, dt);
    if (this.gearDown > 0.85 && !this.destroyed) this.updateGear(dt, surface);
    else { this.onGround = false; for (const g of c.gears) { g.contact = false; g.compression = damp(g.compression, 0, 0.001, dt); } }

    /* --- 낙하산 --- */
    if (this.chuteDeployed && c.chute) {
      this.chuteAmount = approach(this.chuteAmount, 1, 1 / c.chute.deployTime, dt);
      const drag = 0.5 * atm.density * airspeed * airspeed * c.chute.drag * this.chuteAmount;
      _v2.copy(relWind).normalize().multiplyScalar(-Math.min(drag, body.mass * 28));
      body.localToWorld(c.chute.pos, _wp);
      body.addForceAtPoint(_v2, _wp);
    }

    /* --- 충돌 --- */
    this._impactCooldown = Math.max(0, this._impactCooldown - dt);
    if (!this.destroyed) this.checkCollisions(dt, speed);

    /* --- 손상/화재 --- */
    this.updateDamage(dt, atm, airspeed, mach);

    /* --- 무장 --- */
    this.updateWeapons(dt);

    /* --- 물리 적분 --- */
    body.integrate(dt);

    /* --- 시각 갱신 --- */
    c.root.position.copy(body.position);
    c.root.quaternion.copy(body.quaternion);
    this.updateVisuals(dt, atm, airspeed);

    /* --- 사운드 --- */
    this.updateAudio(dt, atm, airspeed, mach, agl);

    /* --- 계기 / 기록 --- */
    this.updateTelemetry(dt, atm, airspeed, mach, agl, surface);
  }

  /**
   * 플라이바이와이어식 안정 보조.
   * 실제 물리를 유지하면서, 조종 입력이 없을 때 회전 감쇠와 수평 복원 토크만
   * 추가해 나선 강하(spiral dive)를 방지한다. 설정에서 끌 수 있다.
   */
  applyStabilityAugmentation(dt, atm, airspeed) {
    const level = Settings.get('assistLevel');
    if (level === 'off' || this.destroyed) return;
    const body = this.craft.body;
    // 동압 기반 권한 (공기가 없으면 조종면도 안정 보조도 작동하지 않는다)
    const qf = clamp((0.5 * atm.density * airspeed * airspeed) / 1400, 0, 1);
    if (qf < 0.03) return;
    const strong = level === 'high';
    const omega = body.worldToLocalDir(body.angularVelocity, _v1);   // 본체 좌표 각속도
    const I = body.inertia;
    const rate = (strong ? 2.4 : 1.5) * qf;      // 각속도 감쇠 이득 (1/s)
    const lim = (strong ? 2.2 : 1.4);            // 최대 각가속도 (rad/s²)

    const active = (v) => Math.abs(v) > 0.08;
    let tx = -omega.x * I.x * rate * (active(this.ctrl.pitch) ? 0.25 : 1);
    const ty = -omega.y * I.y * rate * (active(this.ctrl.yaw) ? 0.25 : 1);
    let tz = -omega.z * I.z * rate * (active(this.ctrl.roll) ? 0.2 : 1);

    // 롤 수평 복원 (조종 입력이 없고 공중일 때만)
    if (!active(this.ctrl.roll) && !this.onGround) {
      const att = body.getAttitude();
      const levelGain = (strong ? 1.5 : 0.8) * qf;
      // +Z 토크 = 좌측 롤 이므로 우측 뱅크(att.roll > 0)를 되돌리려면 +부호
      tz += clamp(att.roll, -1.4, 1.4) * I.z * levelGain;
    }
    // 요 댐퍼 (사이드슬립 억제)
    let tyy = ty;
    if (!active(this.ctrl.yaw) && airspeed > 8) {
      const rel = _v2.copy(body.velocity).sub(this.world.env.wind);
      const slip = body.worldToLocalDir(rel, _v3).x / Math.max(1, airspeed);
      tyy += -clamp(slip, -0.5, 0.5) * I.y * (strong ? 2.0 : 1.2) * qf;
    }
    // 받음각 보호: 실속각을 넘어서면 기수를 눌러 departure 를 막는다 (조종 보조 ON 일 때)
    const alpha = (this.telemetry.aoa || 0) * DEG;
    const alphaLimit = (strong ? 0.26 : 0.32);
    if (alpha > alphaLimit && !this.onGround) {
      tx -= (alpha - alphaLimit) * I.x * (strong ? 6.5 : 4.0) * qf;
    } else if (alpha < -alphaLimit * 0.9 && !this.onGround) {
      tx += (-alpha - alphaLimit * 0.9) * I.x * (strong ? 6.5 : 4.0) * qf;
    }

    body.addLocalTorque(_v2.set(
      clamp(tx, -I.x * lim, I.x * lim),
      clamp(tyy, -I.y * lim, I.y * lim),
      clamp(tz, -I.z * lim, I.z * lim)
    ));
    void dt;
  }

  /* ------------------------------ 추진 계통 ------------------------------ */
  updateEngines(dt, atm, airspeed, mach) {
    const c = this.craft;
    const body = c.body;
    const densityRatio = clamp(atm.density / 1.225, 0, 1.2);
    const fuelOk = c.fuel > 0.05;
    let totalThrust = 0;
    let propWash = 0;

    for (let i = 0; i < c.engines.length; i++) {
      const e = c.engines[i];
      const healthFactor = clamp(e.health / 100, 0, 1);
      let demand = this.engineOn && fuelOk && !this.destroyed ? this.throttle : 0;
      if (e.type === 'burner') demand = this.burnerOn && fuelOk ? 1 : 0;
      if (e.type === 'rcs') demand = 0;
      if (e.type === 'ion') demand = this.engineOn && fuelOk ? this.throttle : 0;
      if (e.type !== 'rocket' && e.type !== 'ion' && e.type !== 'rcs' && atm.density < 0.02) demand *= 0.02;  // 산소 부족
      e.rpm = approach(e.rpm, demand * healthFactor, e.spool, dt);

      if (e.type === 'burner' || e.type === 'rcs') continue;

      let thrust = 0;
      if (e.type === 'prop') {
        const vFactor = clamp(e.staticBoost - airspeed / 135, 0.18, e.staticBoost);
        thrust = e.maxThrust * e.rpm * vFactor * Math.pow(densityRatio, 0.85);
        propWash = Math.max(propWash, e.rpm);
      } else if (e.type === 'jet') {
        const ram = 1 + clamp(mach, 0, 2.2) * 0.22 - (mach > 1.8 ? (mach - 1.8) * 0.35 : 0);
        const ab = this.afterburner ? e.afterburner : 1;
        thrust = e.maxThrust * e.rpm * ram * Math.pow(densityRatio, 0.72) * ab;
      } else if (e.type === 'rocket') {
        thrust = e.maxThrust * e.rpm * (1 + (1 - densityRatio) * 0.12);
      } else if (e.type === 'ion') {
        thrust = e.maxThrust * e.rpm * (0.35 + 0.65 * (1 - densityRatio));
      }
      totalThrust += thrust;

      // 연료 소모
      const abFactor = (e.type === 'jet' && this.afterburner) ? (e.abFuelRate / Math.max(1e-6, e.fuelRate)) : 1;
      const burn = e.fuelRate * (e.maxThrust / 1000) * e.rpm * abFactor * dt;
      c.fuel = Math.max(0, c.fuel - burn);

      // 추력 편향(짐벌): 로켓/이온 엔진은 노즐을 기울여 자세를 제어한다
      if ((e.type === 'rocket' || e.type === 'ion') && e.rpm > 0.05) {
        const gx = clamp(this.ctrl.pitch, -1, 1) * 0.1;
        const gy = clamp(this.ctrl.yaw, -1, 1) * 0.1;
        e.dir.set(Math.sin(gy), -Math.sin(gx), -1).normalize();
      }
      // 추력 적용 (엔진 위치에서 → 비대칭 추력 토크 발생)
      body.localToWorldDir(e.dir, _dir);
      _v2.copy(_dir).multiplyScalar(thrust);
      body.localToWorld(e.pos, _wp);
      body.addForceAtPoint(_v2, _wp);

      // 배기 이펙트
      if (e.rpm > 0.05) {
        const back = _v3.copy(_dir).multiplyScalar(-1);
        const nozzle = body.localToWorld(_v1.copy(e.pos).add(new THREE.Vector3(0, 0, e.type === 'prop' ? -1.2 : 2.0)), new THREE.Vector3());
        const type = e.type === 'rocket' ? 'rocket' : (e.type === 'jet' && (this.afterburner || e.rpm > 0.75)) ? 'jet' : 'prop';
        this.fx.exhaust(nozzle, back, e.rpm * (this.afterburner && e.type === 'jet' ? 1.8 : 1), type, dt, airspeed);
      }
      // 손상 엔진 연기
      if (e.health < 70 && e.rpm > 0.1 && Math.random() < dt * 18) {
        body.localToWorld(e.pos, _wp);
        this.fx.smoke.spawn({
          x: _wp.x, y: _wp.y, z: _wp.z,
          vx: rand(-2, 2), vy: rand(0, 3), vz: rand(-2, 2),
          size: rand(2, 5), sizeRate: 22,
          color: { r: 0.2, g: 0.19, b: 0.18 }, colorTo: { r: 0.5, g: 0.5, b: 0.52 },
          life: rand(1.5, 4), drag: 0.5, opacity: 0.55,
        });
      }
    }

    // RCS: 저밀도/저속에서 자세 제어
    if (this.rcsEnabled) {
      const rcsList = c.engines.filter((e) => e.type === 'rcs');
      if (rcsList.length) {
        const authority = clamp(1 - atm.density / 0.4, 0, 1) * 0.85 + 0.15;
        const torque = _v2.set(
          -this.ctrl.pitch * 1.0,
          -this.ctrl.yaw * 0.8,
          -this.ctrl.roll * 1.0
        ).multiplyScalar(authority);
        for (const e of rcsList) {
          const arm = e.pos.length() + 1;
          const mag = e.maxThrust * arm * 0.12;
          body.addLocalTorque(_v3.copy(torque).multiplyScalar(mag / rcsList.length));
          if (torque.length() > 0.05 && Math.random() < dt * 20) {
            body.localToWorld(e.pos, _wp);
            this.fx.smoke.spawn({
              x: _wp.x, y: _wp.y, z: _wp.z, vx: rand(-3, 3), vy: rand(-3, 3), vz: rand(-3, 3),
              size: rand(0.8, 2), sizeRate: 5, color: { r: 0.9, g: 0.95, b: 1 }, colorTo: { r: 0.8, g: 0.85, b: 0.95 },
              life: 0.35, drag: 0.6, opacity: 0.5,
            });
          }
          const burn = e.fuelRate * (e.maxThrust / 1000) * torque.length() * dt;
          c.fuel = Math.max(0, c.fuel - burn);
        }
      }
    }

    this.totalThrust = totalThrust;
    this.propWash = propWash;
  }

  /* ------------------------------ 열기구 ------------------------------ */
  updateBalloon(dt, atm) {
    const c = this.craft;
    const body = c.body;
    // 봉투 내부 공기 온도 모델
    const burner = c.burnerPart;
    const heating = (this.burnerOn && c.fuel > 0.02 && burner) ? burner.heat || 780 : 0;
    const ambient = atm.temperature;
    const coolRate = 0.055 + (this.ventOpen ? 0.55 : 0) + clamp(body.velocity.length() / 60, 0, 0.25);
    this.envelopeTemp += (heating * dt) - (this.envelopeTemp - ambient) * coolRate * dt;
    this.envelopeTemp = clamp(this.envelopeTemp, ambient, ambient + 260);
    if (heating > 0) {
      c.fuel = Math.max(0, c.fuel - 0.02 * dt * 8);
      // 버너 화염
      for (const inst of c.instances) {
        if (inst.type !== 'burner') continue;
        body.localToWorld(_v1.copy(inst.pos).add(_v2.set(0, 0.7, 0)), _wp);
        this.fx.exhaust(_wp, UP, 0.55, 'rocket', dt * 0.5);
      }
    }
    let lift = 0;
    for (const inst of c.instances) {
      if (!inst.envelope) continue;
      const env = inst.envelope;
      if (env.helium) {
        // 헬륨: 온도 무관, 항상 일정 부력
        const rhoHe = 0.1786 * (atm.density / 1.225);
        const f = (atm.density - rhoHe) * env.volume * 9.80665;
        body.localToWorld(env.pos, _wp);
        body.addForceAtPoint(_v2.set(0, f, 0), _wp);
        lift += f;
      } else {
        lift += balloonBuoyancy(body, { volume: env.volume, pos: env.pos, temperature: this.envelopeTemp }, { wind: this.world.env.wind });
      }
    }
    this.balloonLift = lift;
    // 열기구는 봉투가 위에 있어 항상 수직으로 복원된다
    if (c.balloonVolume > 0) {
      const up = body.up;
      const axis = _v1.crossVectors(up, UP);
      body.addTorque(axis.multiplyScalar(body.mass * 0.22));
      body.angularVelocity.multiplyScalar(Math.pow(0.35, dt));
    }
  }

  /* -------------------------------- 물 -------------------------------- */
  updateWater(dt, surface, speed) {
    const c = this.craft;
    const body = c.body;
    const out = { volume: 0, depth: 0 };
    const list = c.buoyancyParts.length ? c.buoyancyParts : c.colliders;
    waterForces(body, list.map((p) => ({ pos: p.pos, radius: p.radius || 1 })),
      (x, z) => this.world.waterHeightAt(x, z), this.world.ocean.time, out);
    const wasIn = this.inWater;
    this.inWater = out.volume > 0.05;

    if (this.inWater) {
      // 침수: 손상되었거나 플로트가 없으면 물이 찬다
      const floats = c.buoyancyParts.length > 0;
      const fillRate = (floats ? 0.0 : 0.06) + (1 - this.integrity / 100) * 0.12;
      this.waterFill = clamp01(this.waterFill + fillRate * dt);
      if (this.waterFill > 0.01) {
        body.addForce(_v1.set(0, -this.waterFill * body.mass * 3.4, 0));
      }
      // 수면 활주 물보라
      const horizontal = Math.hypot(body.velocity.x, body.velocity.z);
      if (horizontal > 3) {
        body.localToWorld(c.colliders[0] ? c.colliders[0].pos : new THREE.Vector3(), _wp);
        _wp.y = this.world.waterHeightAt(_wp.x, _wp.z);
        this.fx.waterSpray(_wp, body.velocity, clamp(horizontal / 45, 0.1, 1.4), dt);
      }
      if (!wasIn && speed > 6) {
        // 착수 임팩트
        const impactPos = _wp.set(body.position.x, this.world.waterHeightAt(body.position.x, body.position.z), body.position.z);
        this.fx.waterImpact(impactPos.clone(), speed, clamp(c.radius / 6, 0.6, 3));
        if (this.audio) this.audio.splash(impactPos, clamp(speed / 25, 0.4, 2.4));
        const vertical = Math.abs(body.velocity.y);
        if (vertical > 14 || speed > 55) {
          this.damage(vertical * 1.7 + speed * 0.4, '착수 충격', impactPos.clone(), 'water');
        } else {
          this.event('착수 성공! 수상 활주 중', 'good');
        }
      }
      // 침몰
      if (this.waterFill > 0.55) {
        this.sinking += dt;
        if (this.audio) this.audio.bubbles(body.position, true);
        this.fx.bubbles(body.position, 1.4, dt);
        if (body.position.y < surface.height - 22 && !this.destroyed) {
          this.destroy('수몰', body.position.clone(), 'water');
        }
      }
    } else if (wasIn) {
      if (this.audio) this.audio.bubbles(null, false);
    }
  }

  /* ---------------------------- 착륙장치 물리 ---------------------------- */
  updateGear(dt, surface) {
    const c = this.craft;
    const body = c.body;
    let anyContact = false;
    let squeal = 0;
    const steerAngle = this.ctrl.yaw * 0.5;

    for (const g of c.gears) {
      body.localToWorld(g.pos, _wp);
      const s = this.world.surfaceAt(_wp.x, _wp.z);
      const groundY = s.height;
      const wheelBottom = _wp.y - g.restLength;
      const pen = groundY - wheelBottom;
      if (s.type === 'water' && !c.buoyancyParts.length) { g.contact = false; continue; }
      if (pen > -0.02 && pen < g.travel + 1.2) {
        anyContact = true;
        g.contact = true;
        g.compression = clamp(pen, 0, g.travel + 0.3);
        body.pointVelocity(_wp, _v1);
        const normal = s.type === 'ground' ? this.world.terrain.normalAt(_wp.x, _wp.z, _v2.clone()) : UP.clone();
        const vN = _v1.dot(normal);
        const sag = Math.min(pen, g.travel);
        let force = g.spring * sag - g.damper * vN;
        // 범프 스톱: 스트로크를 넘어서면 급격히 단단해진다
        if (pen > g.travel) force += (pen - g.travel) * g.spring * 7;
        force = clamp(force, 0, body.mass * 90);
        _v3.copy(normal).multiplyScalar(force);
        body.addForceAtPoint(_v3, _wp);

        // 타이어 마찰
        const fwd = body.localToWorldDir(_v1.set(Math.sin(steerAngle * g.steer), 0, -Math.cos(steerAngle * g.steer)), new THREE.Vector3());
        fwd.projectOnPlane(normal).normalize();
        const side = new THREE.Vector3().crossVectors(normal, fwd).normalize();
        body.pointVelocity(_wp, _v1);
        const vFwd = _v1.dot(fwd);
        const vSide = _v1.dot(side);
        const load = force;
        const mu = s.material === 'asphalt' ? 0.85 : s.material === 'grass' ? 0.6 : s.material === 'sand' ? 0.45 : s.material === 'snow' ? 0.28 : 0.7;
        // 측면 마찰 (스핀 방지)
        const sideForce = clamp(-vSide * body.mass * 1.6, -load * mu * 1.8, load * mu * 1.8);
        // 구름 저항 + 제동
        const rollMu = g.skid ? 0.22 : 0.02;
        const brakeForce = this.brake * g.brakeFactor * load * mu * 1.1;
        const fwdForce = clamp(-Math.sign(vFwd) * (rollMu * load + brakeForce), -load * mu * 2, load * mu * 2);
        _v3.copy(side).multiplyScalar(sideForce).addScaledVector(fwd, fwdForce);
        body.addForceAtPoint(_v3, _wp);

        g.slip = clamp(Math.abs(vSide) / 12 + (this.brake > 0.4 && Math.abs(vFwd) > 6 ? 0.4 : 0), 0, 1);
        squeal = Math.max(squeal, g.slip * clamp(Math.abs(vFwd) / 20, 0, 1));
        g.spinAngle += (vFwd / Math.max(0.2, g.radius)) * dt;

        // 먼지/흙 튐
        if (s.material !== 'asphalt' && Math.abs(vFwd) > 4 && Math.random() < dt * 18) {
          const col = s.material === 'sand' ? { r: 0.72, g: 0.64, b: 0.48 } : s.material === 'snow' ? { r: 0.92, g: 0.95, b: 1 } : { r: 0.42, g: 0.4, b: 0.3 };
          this.fx.dust(_wp, clamp(Math.abs(vFwd) / 30, 0.1, 0.8), col);
        }
        // 착지 순간
        if (!g.wasContact) {
          const vs = Math.abs(Math.min(0, vN));
          this._touchdownVs = Math.max(this._touchdownVs, vs);
          if (this.audio) this.audio.gearThump(_wp, clamp(vs / 4, 0.15, 1.6));
          if (vs > 7.5) {
            this.damage(vs * 2.6, '거친 착지', _wp.clone(), 'ground');
          } else if (this._airborneTime > 4) {
            const quality = vs < 1.6 ? '완벽한' : vs < 3.2 ? '부드러운' : '무난한';
            this.event(quality + ' 착지 (수직속도 ' + vs.toFixed(1) + ' m/s)', 'good');
            this.score.landings++;
            this._airborneTime = 0;
          }
        }
      } else {
        g.contact = false;
        g.compression = damp(g.compression, 0, 0.001, dt);
      }
      g.wasContact = g.contact;
    }
    this.onGround = anyContact;
    if (anyContact) this._airborneTime = 0;
    this._squeal = damp(this._squeal, squeal, 0.001, dt);
    if (this.audio) this.audio.tireSqueal(body.position, this._squeal);
    void surface;
  }

  /* ------------------------------ 충돌 판정 ------------------------------ */
  checkCollisions(dt, speed) {
    const c = this.craft;
    const body = c.body;
    const gearContact = this.onGround;
    for (const col of c.colliders) {
      body.localToWorld(col.pos, _wp);
      const info = this.world.sampleCollision(_wp, col.radius);
      if (!info.hit) continue;
      // 착륙장치가 접지 중이면 바퀴 근처의 경미한 접촉은 무시
      if (gearContact && info.type !== 'object' && col.inst.def.gear) continue;

      body.pointVelocity(_wp, _v1);
      const n = info.normal;
      const vN = _v1.dot(n);
      const isWater = info.type === 'water';

      if (isWater) continue;   // 물은 부력/항력으로 처리

      // 위치 보정
      const pen = info.penetration !== undefined ? info.penetration : 0.2;
      if (pen > 0.02) body.position.addScaledVector(n, Math.min(pen, 0.8) * (gearContact ? 0.15 : 0.45));

      if (vN < -0.6) {
        // 반발 임펄스
        const restitution = info.type === 'tree' ? 0.05 : 0.18;
        const j = -(1 + restitution) * vN * body.mass * 0.8;
        _v2.copy(n).multiplyScalar(j);
        body.applyImpulseAtPoint(_v2, _wp);
        // 접선 마찰 (긁힘)
        _v3.copy(_v1).addScaledVector(n, -vN).multiplyScalar(-body.mass * 0.25);
        body.applyImpulseAtPoint(_v3, _wp);

        const energy = Math.abs(vN) * (info.hardness || 1);
        if (this._impactCooldown <= 0) {
          this._impactCooldown = 0.09;
          const mat = info.type === 'tree' ? 'wood' : info.material === 'asphalt' || info.material === 'rock' ? 'ground' : 'metal';
          if (this.audio) this.audio.impact(_wp, clamp(energy / 9, 0.1, 2.6), mat);
          this.fx.sparks(_wp, n, Math.round(clamp(energy, 2, 26)), clamp(energy / 8, 0.3, 2));
          if (info.type === 'ground' || info.type === 'deck') {
            const col2 = info.material === 'sand' ? { r: 0.72, g: 0.64, b: 0.48 }
              : info.material === 'snow' ? { r: 0.95, g: 0.97, b: 1 } : { r: 0.4, g: 0.38, b: 0.3 };
            this.fx.dust(_wp, clamp(energy / 8, 0.2, 2), col2);
          }
        }
        // 손상: 2.2 m/s 이하의 가벼운 접촉은 흠집만 남고 손상은 없다
        const vImpact = Math.max(0, Math.abs(vN) - 2.2);
        const dmg = Math.min(65, Math.pow(vImpact, 1.35) * 0.62 * (info.hardness || 1));
        this._hitLog[col.key] = (this._hitLog[col.key] || 0) + 1;
        if (dmg > 0.8) {
          const partName = col.inst && col.inst.def ? col.inst.def.name : '기체';
          const what = info.type === 'tree' ? '나무 충돌' : info.type === 'building' ? '건물 충돌'
            : info.type === 'water' ? '수면 충격' : '지면 충돌';
          this.damage(dmg, partName + ' ' + what, _wp.clone(), info.type);
          col.inst.health = Math.max(0, col.inst.health - dmg * 1.4);
          if (col.inst.health <= 0 && !col.inst.detached) this.detachPart(col.inst);
        }
      }
    }
    void speed; void dt;
  }

  detachPart(inst) {
    inst.detached = true;
    inst.obj.visible = false;
    if (inst.surface) inst.surface.enabled = false;
    if (inst.engine) { inst.engine.health = 0; inst.engine.rpm = 0; }
    const wp = this.craft.body.localToWorld(inst.pos, new THREE.Vector3());
    this.fx.spawnDebris(wp, 5, clamp(inst.radius, 0.5, 2.5));
    this.fx.sparks(wp, UP, 18, 1.4);
    this.event(inst.def.name + ' 파손 탈락!', 'bad');
    if (this.audio) this.audio.impact(wp, 1.4, 'metal');
  }

  damage(amount, reason, pos, type) {
    if (this.destroyed) return;
    const resist = 1 / (1 + this.craft.structureStrength * 0.12);
    const dmg = amount * resist;
    this.integrity = clamp(this.integrity - dmg, 0, 100);
    this.craft.integrity = this.integrity;
    if (dmg > 6) this.event(reason + ' — 기체 손상 ' + Math.round(dmg) + '%', 'bad');
    // 화재 발생 확률
    if (dmg > 10 && Math.random() < 0.35 + dmg / 90 && type !== 'water') {
      this.fire = Math.max(this.fire, 0.35);
      this.event('화재 발생! 낙하산 또는 즉시 착륙 필요', 'bad');
    }
    // 엔진 손상
    if (dmg > 8) {
      for (const e of this.craft.engines) {
        if (Math.random() < 0.4) e.health = Math.max(0, e.health - dmg * rand(0.4, 1.4));
      }
    }
    if (this.integrity <= 0) this.destroy(reason, pos, type);
    else if (dmg > 18) this.fx.explosion(pos || this.craft.body.position, clamp(dmg / 30, 0.35, 1.1), { debris: true });
  }

  destroy(reason, pos, type) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.crashed = true;
    this.score.crashes++;
    const p = (pos || this.craft.body.position).clone();
    const size = clamp(this.craft.body.mass / 4200 + (this.craft.fuel / 500), 0.9, 3.4);
    if (type === 'water') {
      this.fx.waterImpact(p, 40, size * 1.4);
      if (this.audio) { this.audio.splash(p, 2.4); this.audio.bubbles(p, true); }
    } else {
      this.fx.explosion(p, size);
      this.fx.spawnDebris(p, 18, size);
      if (this.audio) this.audio.explosion(p, size);
      this.fire = 1;
    }
    // 부품 흩어짐
    for (const inst of this.craft.instances) {
      if (Math.random() < 0.55) { inst.obj.visible = false; inst.detached = true; }
    }
    for (const s of this.craft.surfaces) s.enabled = false;
    for (const e of this.craft.engines) { e.rpm = 0; e.health = 0; }
    for (const v of this.voices) if (v) v.update({ rpm: 0, throttle: 0 }, 0);
    this.event('기체 파괴: ' + reason, 'bad');
    if (this.onDestroyed) this.onDestroyed(reason);
  }

  updateDamage(dt, atm, airspeed, mach) {
    const c = this.craft;
    const body = c.body;
    // 화재 확산
    if (this.fire > 0) {
      const oxygen = clamp(atm.density / 1.225, 0, 1);
      this.fire = clamp(this.fire + dt * (0.035 * oxygen - (this.inWater ? 0.9 : 0)) - (this.airbrake ? 0 : 0), 0, 1.6);
      this.integrity = clamp(this.integrity - this.fire * dt * 3.4, 0, 100);
      // 화염 위치: 손상된 엔진 또는 기체 중앙
      const src = c.engines.find((e) => e.health < 50) || null;
      const localPos = src ? src.pos : new THREE.Vector3(0, 0, 0);
      body.localToWorld(localPos, _wp);
      const back = body.forward.multiplyScalar(-1);
      this.fx.fireJet(_wp, back, clamp(this.fire, 0.1, 1.4), dt);
      if (this.audio) this.audio.fire(true, _wp);
      if (this.integrity <= 0) this.destroy('화재 확산', _wp.clone(), 'fire');
    } else if (this.audio) this.audio.fire(false);

    // 과속으로 인한 구조 손상
    const q = 0.5 * atm.density * airspeed * airspeed;
    const vne = 42000 * (1 + c.structureStrength * 0.35);
    if (q > vne) {
      const over = (q - vne) / vne;
      this.damage(over * 26 * dt, '과속 구조 손상', body.position.clone(), 'air');
    }
    // 과G
    const g = Math.abs(body.gForce);
    this.gForceFiltered = damp(this.gForceFiltered, body.gForce, 0.001, dt);
    this.gMax = Math.max(this.gMax, this.gForceFiltered);
    this.gMin = Math.min(this.gMin, this.gForceFiltered);
    const gLimit = 8 + c.structureStrength * 1.6;
    if (g > gLimit) this.damage((g - gLimit) * 5 * dt, '과도한 G하중', body.position.clone(), 'air');

    // 재진입 가열
    const heatQ = 0.5 * atm.density * Math.pow(airspeed, 3) * 1e-6;
    this.reentryHeat = damp(this.reentryHeat, clamp(heatQ / 90, 0, 1.4), 0.002, dt);
    if (this.reentryHeat > 0.25) {
      const shield = c.hasHeatShield ? 0.25 : 1;
      if (mach > 2.5) {
        body.localToWorld(new THREE.Vector3(0, 0, -c.radius * 0.7), _wp);
        this.fx.fireJet(_wp, body.forward.multiplyScalar(-1), this.reentryHeat * 0.9, dt);
        this.integrity = clamp(this.integrity - this.reentryHeat * shield * dt * 6, 0, 100);
        if (this.integrity <= 0) this.destroy('재진입 과열', _wp.clone(), 'fire');
      }
    }
    // 소닉붐
    if (mach > 1 && !this._sonicDone) {
      this._sonicDone = true;
      if (this.audio) this.audio.sonicBoom(body.position);
      this.event('음속 돌파! Mach ' + mach.toFixed(2), 'good');
      this.fx.shockwave(body.position.clone(), 1.6);
    } else if (mach < 0.95) this._sonicDone = false;
  }

  /* ------------------------------- 무장 ------------------------------- */
  updateWeapons(dt) {
    const c = this.craft;
    for (const w of c.weapons) {
      w.cooldown -= dt;
      if (!this.firing || this.destroyed || w.inst.detached) continue;
      if (w.cooldown > 0) continue;
      w.cooldown = 1 / w.rate;
      const body = c.body;
      body.localToWorld(w.muzzle, _wp);
      body.localToWorldDir(_v1.set(rand(-1, 1) * w.spread, rand(-1, 1) * w.spread, -1).normalize(), _v2);
      _v2.multiplyScalar(w.speed).add(body.velocity);
      this.fx.addTracer(_wp, _v2, 2.6);
      this.fx.flash(_wp, 120, 0.05);
      if (this.audio) this.audio.gunShot(_wp);
      // 반동
      body.addForceAtPoint(_v3.copy(_v2).normalize().multiplyScalar(-w.damage * 260), _wp);
    }
  }

  /* ----------------------------- 자동 조종 ----------------------------- */
  applyAutopilot(dt, agl) {
    const body = this.craft.body;
    const att = body.getAttitude();
    const om = body.worldToLocalDir(body.angularVelocity, _v1);
    const rollRate = -om.z;         // + : 우측 롤
    const pitchRate = om.x;         // + : 기수 상승
    const powered = (this.craft.stats.thrust || 0) > 1;
    let targetRoll = 0;
    let targetPitch = 0;

    if (this.autopilot === 'alt') {
      if (!powered) {
        targetPitch = -0.05;        // 무동력기는 최적 활공 자세 유지
      } else {
        // 지형 충돌 방지(EGPWS 유사): 최대 30초 앞까지 지형을 미리 살펴 목표 고도를 끌어올린다
        let worstGround = -Infinity;
        for (const t of [8, 16, 24, 32]) {
          const ahead = _v2.copy(body.position).addScaledVector(body.velocity, t);
          worstGround = Math.max(worstGround, this.world.heightAt(ahead.x, ahead.z));
        }
        const clearance = Math.min(agl, body.position.y - worstGround);
        if (clearance < 260) {
          this.apTargetAlt = Math.max(this.apTargetAlt, body.position.y + (260 - clearance));
        }
        const altErr = this.apTargetAlt - body.position.y;
        const targetVs = clamp(altErr * 0.05, -14, 14);
        const vsErr = targetVs - body.velocity.y;
        targetPitch = clamp(vsErr * 0.03, -0.22, 0.26);
        this.targetThrottle = clamp(this.targetThrottle + (altErr > 60 ? dt * 0.25 : altErr < -60 ? -dt * 0.25 : 0), 0.15, 1);
      }
    } else if (this.autopilot === 'heading') {
      let hErr = this.apTargetHeading - att.heading;
      while (hErr > Math.PI) hErr -= Math.PI * 2;
      while (hErr < -Math.PI) hErr += Math.PI * 2;
      targetRoll = clamp(hErr * 1.1, -0.45, 0.45);
      targetPitch = 0.02;
      this.ctrl.yaw = clamp(hErr * 0.25, -0.35, 0.35);
    }

    // 자세 → 각속도 → 조종면 (2단 제어라 기체 크기·관성에 관계없이 안정적)
    const rollCmd = clamp((targetRoll - att.roll) * 0.9, -0.45, 0.45);
    this.ctrl.roll = clamp((rollCmd - rollRate) * 1.5, -0.85, 0.85);
    const pitchCmd = clamp((targetPitch - att.pitch) * 0.8, -0.22, 0.22);
    this.ctrl.pitch = clamp((pitchCmd - pitchRate) * 2.0, -0.7, 0.7);
  }

  /* ----------------------------- 시각 갱신 ----------------------------- */
  updateVisuals(dt, atm, airspeed) {
    const c = this.craft;
    // 프로펠러/팬 회전
    for (const e of c.engines) {
      if (e.propHub) {
        const spin = e.type === 'prop' ? 120 : 260;
        e.propHub.rotation.z += e.rpm * spin * dt;
        if (e.propHub.userData.disk) {
          e.propHub.userData.disk.material.opacity = clamp(e.rpm * 0.5, 0, 0.42);
        }
      }
      if (e.nozzleMesh) {
        const ab = this.afterburner && e.type === 'jet' ? 1.25 : 1;
        e.nozzleMesh.scale.setScalar(lerp(e.nozzleMesh.scale.x, ab, dt * 6));
        if (e.nozzleMesh.material.emissive) {
          e.nozzleMesh.material.emissive.setRGB(e.rpm * 0.35 * (ab > 1 ? 2 : 1), e.rpm * 0.09, 0);
        }
      }
      if (e.glow && e.glow.material.emissiveIntensity !== undefined) {
        e.glow.material.emissiveIntensity = 0.4 + e.rpm * 3.2;
      }
    }
    // 조종면 편향 (전동 미익)
    for (const inst of c.instances) {
      if (!inst.surface || inst.detached) continue;
      const kind = inst.controlKind;
      if (kind === 'pitch') inst.obj.rotation.x = -this.ctrl.pitch * 0.28 * inst.surface.controlSign;
      else if (kind === 'yaw') inst.obj.rotation.y = -this.ctrl.yaw * 0.3;
      else if (kind === 'roll') inst.obj.rotation.z = this.ctrl.roll * 0.07 * -(inst.spanSign || 1);
    }
    // 착륙장치 접개 (다중 접지점 부품은 대표 접지점만 시각 갱신)
    for (const g of c.gears) {
      if (g.primary === false) continue;
      const base = g.rootPos || g.pos;
      const t = this.gearDown;
      g.obj.rotation.z = (1 - t) * -1.45 * (base.x >= 0 ? 1 : -1);
      g.obj.visible = t > 0.02;
      g.obj.position.y = base.y + (1 - t) * 0.35 + (g.contact ? g.compression * 0.8 : 0);
      if (g.wheel) g.wheel.rotation.x = g.spinAngle;
    }
    // 착륙등
    for (const l of c.lights) {
      const on = this.lightsOn;
      l.spot.intensity = damp(l.spot.intensity, on ? l.intensity : 0, 0.001, dt);
      if (l.lens && l.lens.material.emissiveIntensity !== undefined) {
        l.lens.material.emissiveIntensity = on ? 3.2 : 0.15;
      }
    }
    // 고고도 비행운
    if (c.body.position.y > 6500 && atm.density < 0.6 && airspeed > 120) {
      for (const e of c.engines) {
        if (e.rpm < 0.2) continue;
        c.body.localToWorld(_v1.copy(e.pos).add(_v2.set(0, 0, 2.4)), _wp);
        this.fx.contrail(_wp, c.body.forward.multiplyScalar(-1), clamp(e.rpm, 0, 1), dt);
      }
    }
  }

  /* ------------------------------- 사운드 ------------------------------- */
  updateAudio(dt, atm, airspeed, mach, agl) {
    if (!this.audio || !this.audio.ready) return;
    const c = this.craft;
    for (let i = 0; i < c.engines.length; i++) {
      const v = this.voices[i];
      if (!v) continue;
      const e = c.engines[i];
      c.body.localToWorld(e.pos, _wp);
      v.setPosition(_wp);
      v.update({
        rpm: e.rpm, throttle: this.throttle, airspeed,
        afterburner: this.afterburner && e.type === 'jet',
        burner: this.burnerOn && e.type === 'burner',
        health: e.health / 100,
      }, dt);
    }
    this.audio.updateAtmos({
      airspeed,
      density: atm.density / 1.225,
      gear: this.gearDown > 0.5,
      flap: this.ctrl.flap,
      airbrake: this.airbrake,
      stall: this.stall,
      turbulence: clamp(this.world.env.gust.length() / 12, 0, 1),
    });

    // 경고음
    const stallWarn = this.stall > 0.35 && !this.onGround;
    const overspeed = 0.5 * atm.density * airspeed * airspeed > 34000 * (1 + c.structureStrength * 0.3);
    const sink = c.body.velocity.y < -18 && agl < 240 && !this.onGround;
    this.audio.warning('stall', stallWarn);
    this.audio.warning('overspeed', overspeed);
    this.audio.warning('pullup', sink);
    this.audio.warning('fire', this.fire > 0.05);
    this.audio.warning('gear', !this.onGround && agl < 90 && this.gearDown < 0.5 && c.gears.length > 0 && c.body.velocity.y < 0);
    this.warnings = [];
    if (stallWarn) this.warnings.push({ code: 'STALL', text: '실속 경고' });
    if (overspeed) this.warnings.push({ code: 'OVERSPEED', text: '과속 위험' });
    if (sink) this.warnings.push({ code: 'PULL UP', text: '지면 접근' });
    if (this.fire > 0.05) this.warnings.push({ code: 'FIRE', text: '화재' });
    if (c.fuel / c.fuelCapacity < 0.1) this.warnings.push({ code: 'FUEL', text: '연료 부족' });
    if (this.integrity < 35) this.warnings.push({ code: 'DAMAGE', text: '기체 손상 심각' });
    if (this.waterFill > 0.2) this.warnings.push({ code: 'FLOOD', text: '침수' });
    void mach;
  }

  /* ------------------------------- 계기 ------------------------------- */
  updateTelemetry(dt, atm, airspeed, mach, agl, surface) {
    const body = this.craft.body;
    const att = body.getAttitude();
    const ias = airspeed * Math.sqrt(clamp(atm.density / 1.225, 0.02, 1.2));
    this.score.flightTime += dt;
    this.score.distance += body.velocity.length() * dt;
    this.score.maxAlt = Math.max(this.score.maxAlt, body.position.y);
    this.score.maxSpeed = Math.max(this.score.maxSpeed, airspeed);
    if (!this.onGround) this._airborneTime += dt;

    let aoa = 0;
    const fw = body.forward;
    if (airspeed > 2) {
      const rel = _v1.copy(body.velocity).sub(this.world.env.wind).normalize();
      const up = body.up;
      aoa = Math.asin(clamp(-rel.dot(up), -1, 1));
    }
    let sideslip = 0;
    if (airspeed > 2) {
      const rel = _v1.copy(body.velocity).sub(this.world.env.wind).normalize();
      sideslip = Math.asin(clamp(rel.dot(body.right), -1, 1));
    }

    this.telemetry = {
      tas: airspeed, ias, mach, speedKmh: airspeed * 3.6,
      alt: body.position.y, agl, vs: body.velocity.y,
      heading: att.heading / DEG, pitch: att.pitch / DEG, roll: att.roll / DEG,
      aoa: aoa / DEG, sideslip: sideslip / DEG,
      g: this.gForceFiltered, gMax: this.gMax, gMin: this.gMin,
      throttle: this.throttle, rpm: this.craft.engines.length ? this.craft.engines[0].rpm : 0,
      fuel: this.craft.fuel, fuelPct: this.craft.fuel / this.craft.fuelCapacity,
      integrity: this.integrity, fire: this.fire,
      gear: this.gearDown, flap: this.ctrl.flap, brake: this.brake, airbrake: this.airbrake,
      afterburner: this.afterburner, stall: this.stall, onGround: this.onGround,
      inWater: this.inWater, waterFill: this.waterFill,
      thrust: this.totalThrust || 0, density: atm.density,
      autopilot: this.autopilot, lights: this.lightsOn, engineOn: this.engineOn,
      trim: this.ctrl.trim, flares: this.flares,
      envelopeTemp: this.envelopeTemp, balloonLift: this.balloonLift || 0,
      surfaceType: surface.type, surfaceMaterial: surface.material,
      position: body.position, velocity: body.velocity,
      warnings: this.warnings, destroyed: this.destroyed,
      reentry: this.reentryHeat, chute: this.chuteAmount,
      onRunway: this.world.terrain.isRunway(body.position.x, body.position.z),
      score: this.score, fwd: fw,
    };
    void WATER_DENSITY; void smoothstep; void RUNWAY;
  }

  /** 기체를 지정 위치로 재배치 (스폰/리스폰) */
  reset(pos, headingDeg = 90, airborne = false, speed = 0, pitchDeg = 0) {
    const body = this.craft.body;
    body.position.copy(pos);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    // heading = -θ (Y축 회전) 이므로 θ = -heading
    body.quaternion.setFromAxisAngle(UP, -headingDeg * DEG);
    if (pitchDeg) {
      const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchDeg * DEG);
      body.quaternion.multiply(qp);
    }
    if (speed > 0) body.velocity.copy(body.forward.multiplyScalar(speed));
    this.integrity = 100;
    this.craft.integrity = 100;
    this.craft.fuel = this.craft.fuelCapacity;
    this.fire = 0;
    this.destroyed = false;
    this.crashed = false;
    this.waterFill = 0;
    this.sinking = 0;
    this.chuteDeployed = false;
    this.chuteAmount = 0;
    this.throttle = 0;
    this.targetThrottle = 0;
    this.gearDown = airborne ? 0 : 1;
    this.gearTarget = this.gearDown;
    this.envelopeTemp = atmosphere(pos.y).temperature + (this.craft.balloonVolume > 0 ? 90 : 0);
    this.gMax = 1; this.gMin = 1;
    this.reentryHeat = 0;
    for (const e of this.craft.engines) { e.health = 100; e.rpm = 0; }
    for (const s of this.craft.surfaces) s.enabled = true;
    for (const inst of this.craft.instances) { inst.detached = false; inst.health = 100; inst.obj.visible = true; }
    for (const v of this.voices) if (v) v.update({ rpm: 0, throttle: 0 }, 0);
    if (this.audio) { this.audio.fire(false); this.audio.bubbles(null, false); this.audio.clearWarnings(); }
    this.craft.root.position.copy(pos);
    this.craft.root.quaternion.copy(body.quaternion);
    this.event('기체 준비 완료');
  }
}
