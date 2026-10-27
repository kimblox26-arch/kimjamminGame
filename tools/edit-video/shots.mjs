// 샷 정의: setup()/update(i, n)는 페이지 안에서 실행된다 (window.RT 사용). update 는 다음 프레임의 시뮬레이션 dt 를 반환.
export const SHOTS = {
  runway: {
    frames: 75,
    setup() {
      RT.start('fighter', { tod: 17.0 });
      RT.ctl.throttle = 0.4; RT.ctl.instantThrottle = true; RT.ctl.brake = true;
      RT.sim(1.2);
    },
    update(i, n) {
      const { V } = RT; const p = RT.pos(); const a = i / n;
      const th = (25 + 55 * a) * Math.PI / 180;
      RT.cam = { pos: V(p.x + Math.cos(th) * 15, p.y - 0.9, p.z + Math.sin(th) * 15), look: V(p.x + 2, p.y + 0.4, p.z), fov: 38 };
      return 1 / 60;
    },
  },

  takeoff: {
    frames: 95,
    setup() {
      RT.start('fighter', { tod: 17.0 });
      Object.assign(RT.ctl, { throttle: 1, ab: true, instantThrottle: true });
      for (let k = 0; k < 150 && (RT.g.controller.telemetry.tas || 0) < 58; k++) RT.sim(0.1);
      const p = RT.pos();
      RT.camAnchor = RT.V(p.x + 110, 24.9, 13);
    },
    update(i) {
      const { V, g } = RT; const p = RT.pos(); const t = g.controller.telemetry;
      if (t.tas > 72) { RT.ctl.hold = true; RT.ctl.tp = 0.26; RT.ctl.tr = 0; }
      if (!t.onGround && g.controller.gearTarget > 0.5 && p.y > 40) g.controller.toggleGear();
      if (RT.meta.pass === undefined && p.x > RT.camAnchor.x) RT.meta.pass = i;
      RT.cam = { pos: RT.camAnchor, look: V(p.x + 4, p.y + 1.5, p.z), fov: 42 };
      const d = Math.abs(p.x - RT.camAnchor.x);
      return d < 25 ? 1 / 70 : d < 60 ? 1 / 50 : 1 / 30;
    },
  },

  climb: {
    frames: 60,
    setup() {
      RT.start('fighter', { tod: 17.0, airborne: true });
      RT.place([1500, 700, 300], 270, true, 230, 32);
      Object.assign(RT.ctl, { throttle: 1, ab: true, instantThrottle: true, hold: true, tp: 0.56, tr: 0 });
      RT.sim(0.5);
    },
    update(i, n) {
      const { V } = RT; const p = RT.pos(); const f = RT.fwd();
      const a = i / n;
      RT.cam = { pos: p.clone().addScaledVector(f, -21 + a * 5).add(V(0, -5, 7 - a * 12)), look: p.clone().addScaledVector(f, 16), fov: 42 };
      return 1 / 45;
    },
  },

  strafe_cockpit: {
    frames: 60,
    setup() {
      RT.start('fighter', { tod: 17.0, airborne: true });
      RT.place([-2100, 300, 0], 90, true, 210, -9);
      Object.assign(RT.ctl, { throttle: 0.8, instantThrottle: true, hold: true, tp: -0.16, tr: 0 });
      RT.sim(0.4);
    },
    update(i) {
      const { V, THREE, g } = RT; const b = RT.body();
      RT.ctl.fire = i > 6;
      const cp = g.craft.cockpit ? g.craft.cockpit.pos : V(0, 1, -3);
      const pos = b.localToWorld(cp.clone().add(V(0, 0.15, 0.25)), V());
      const look = pos.clone().addScaledVector(b.forward, 50);
      RT.cam = { pos, look, up: b.localToWorldDir(V(0, 1, 0), V()), fov: 74 };
      return 1 / 30;
    },
  },

  strafe_kill: {
    frames: 135,
    setup() {
      RT.start('fighter', { tod: 17.0, airborne: true });
      const T = RT.V(-330, RT.ground(-330, 0), 0);
      RT.T = T;
      RT.place([T.x - 620, T.y + 114, 0], 90, true, 172, -10.4);
      Object.assign(RT.ctl, { throttle: 0.9, instantThrottle: true, hold: true, tp: -0.182, tr: 0, fire: true });
      RT.boom = -1;
      RT.sim(0.1);
    },
    update(i) {
      const { V, g } = RT; const p = RT.pos(); const T = RT.T; const b = RT.body();
      const dist = T.x - p.x;
      if (RT.boom < 0 && dist < 235) {
        RT.boom = i; RT.meta.boom = i;
        g.fx.explosion(T.clone().add(V(0, 1.5, 0)), 1.7);
        g.fx.explosion(T.clone().add(V(9, 1, -6)), 0.9);
      }
      if (RT.boom >= 0 && i === RT.boom + 5) g.fx.explosion(T.clone().add(V(-8, 1, 7)), 1.1);
      if (RT.boom >= 0) { RT.ctl.fire = i - RT.boom < 6; RT.ctl.tp = 0.42; RT.ctl.ab = true; RT.ctl.throttle = 1; }
      const f = b.forward.clone(); f.y *= 0.6; f.normalize();
      const want = p.clone().addScaledVector(f, -24).add(V(0, 4.5, 3.5));
      if (!RT.cs) RT.cs = want.clone();
      RT.cs.lerp(want, RT.boom >= 0 ? 0.12 : 0.6);
      const look = p.clone().addScaledVector(f, 70).add(V(0, -4, 0));
      if (!RT.lookS) RT.lookS = look.clone();
      RT.lookS.lerp(look, 0.35);
      RT.cam = { pos: RT.cs.clone(), look: RT.lookS.clone(), fov: 50 };
      if (RT.boom >= 0 && i - RT.boom < 30) return 1 / 100;
      return 1 / 30;
    },
  },

  flyby: {
    frames: 125,
    setup() {
      RT.start('fighter', { tod: 17.0, airborne: true });
      RT.place([-1500, 46, 0], 90, true, 170, 0);
      Object.assign(RT.ctl, { throttle: 1, ab: true, instantThrottle: true, hold: true, tp: -0.03, tr: 0 });
      RT.sim(0.8);
      const p = RT.pos(), v = RT.body().velocity.clone();
      const a = p.clone().addScaledVector(v, 1.25);
      a.z += 26; a.y = RT.ground(a.x, a.z) + 3.2;
      RT.camAnchor = a;
      RT.sw = false;
    },
    update(i) {
      const { V, g } = RT; const p = RT.pos();
      const d = p.x - RT.camAnchor.x;
      if (!RT.sw && d > -10) { RT.sw = true; RT.meta.pass = i; RT.keepBlast = true; g.fx.shockwave(p.clone(), 1.4); RT.keepBlast = false; }
      RT.cam = { pos: RT.camAnchor, look: V(p.x + 8, p.y + 1, p.z), fov: 36 };
      return Math.abs(d) < 35 ? 1 / 120 : Math.abs(d) < 100 ? 1 / 60 : 1 / 30;
    },
  },

  flares: {
    frames: 112,
    setup() {
      RT.start('fighter', { tod: 17.0, airborne: true });
      RT.place([-1500, 700, 900], 90, true, 165, 4);
      Object.assign(RT.ctl, { throttle: 1, ab: true, instantThrottle: true, hold: true, tp: 0.1, tr: 0 });
      RT.sim(0.4);
    },
    update(i) {
      const { V } = RT; const p = RT.pos(); const b = RT.body();
      if (i > 6) { RT.ctl.tr = -0.95; RT.ctl.pull = 0.45; }
      if (i >= 4 && i < 64 && i % 5 === 0) RT.launchFlares(4);
      const vel = b.velocity.clone().normalize();
      const right = vel.clone().cross(V(0, 1, 0)).normalize();
      const pos = p.clone().addScaledVector(right, 30).addScaledVector(vel, -16).add(V(0, -6, 0));
      if (!RT.cs) RT.cs = pos.clone();
      RT.cs.lerp(pos, 0.5);
      RT.cam = { pos: RT.cs.clone(), look: p.clone().addScaledVector(vel, -10), fov: 50 };
      return 1 / 80;
    },
  },

  roll: {
    frames: 55,
    setup() {
      RT.start('fighter', { tod: 17.0, airborne: true });
      RT.place([-300, 650, 1200], 0, true, 240, 3);
      Object.assign(RT.ctl, { throttle: 1, ab: true, instantThrottle: true, hold: false, roll: 0, pitch: 0.06 });
      RT.sim(0.3);
    },
    update(i) {
      const { V } = RT; const p = RT.pos(); const b = RT.body();
      RT.ctl.roll = i > 4 ? 1 : 0;
      const vel = b.velocity.clone().normalize();
      const right = vel.clone().cross(V(0, 1, 0)).normalize();
      RT.cam = { pos: p.clone().addScaledVector(right, 26).addScaledVector(vel, 8).add(V(0, 2.5, 0)), look: p.clone().addScaledVector(vel, 3), fov: 44 };
      return 1 / 30;
    },
  },

  ac130: {
    frames: 105,
    setup() {
      RT.start('fighter', { tod: 13.0 });
      RT.ctl.throttle = 0.2; RT.ctl.brake = true;
      RT.sim(0.5);
      RT.C = RT.pos();
      RT.maxBoom = 3.5;
      RT.hits = [13, 26, 39, 51, 77];
    },
    update(i, n) {
      const { V, g } = RT; const C = RT.C;
      const a = 0.9 + i * 0.004;
      const pos = V(C.x + Math.cos(a) * 760, C.y + 1050, C.z + Math.sin(a) * 760);
      RT.cam = { pos, look: C.clone().add(V(12 - i * 0.15, 0, -6)), fov: 8.5 };
      const k = RT.hits.indexOf(i);
      if (k >= 0) {
        if (k === RT.hits.length - 1) {
          g.controller.destroy('ac130', C.clone(), 'explosion');
          g.fx.explosion(C.clone().add(V(0, 2, 0)), 3.5);
        } else {
          const off = [V(-40, 0, 26), V(30, 0, -34), V(-16, 0, -40), V(46, 0, 18)][k];
          const q = C.clone().add(off); q.y = RT.ground(q.x, q.z) + 1;
          g.fx.explosion(q, 2.2);
        }
      }
      return 1 / 30;
    },
  },

  crash: {
    frames: 115,
    setup() {
      RT.start('fighter', { tod: 17.0, airborne: true });
      RT.place([-420, 24 + 200, -12], 90, true, 150, -38);
      Object.assign(RT.ctl, { throttle: 1, ab: true, instantThrottle: true, hold: true, tp: -0.66, tr: 0.25 });
      RT.impact = 24;
      RT.hit = -1;
      RT.sim(0.1);
    },
    update(i) {
      const { V, g } = RT; const p = RT.pos();
      const aim = V(-420 + 200 / Math.tan(0.66), 24, -12);
      const camPos = V(aim.x + 38, 26.5, aim.z + 58);
      if (RT.hit < 0 && g.controller.destroyed) { RT.hit = i; RT.meta.hit = i; }
      const look = g.controller.destroyed ? aim.clone().add(V(0, 9, 0)) : p.clone().lerp(aim, 0.08);
      if (!RT.lookS) RT.lookS = look.clone();
      RT.lookS.lerp(look, 0.25);
      RT.cam = { pos: camPos, look: RT.lookS.clone(), fov: 40 };
      const agl = p.y - 24;
      if (RT.hit >= 0) return i - RT.hit < 45 ? 1 / 140 : 1 / 50;
      return agl < 14 ? 1 / 140 : 1 / 30;
    },
  },

  outro: {
    frames: 80,
    setup() {
      RT.start('fighter', { tod: 17.45, airborne: true });
      RT.place([2500, 1200, -2000], 250, true, 210, 2);
      Object.assign(RT.ctl, { throttle: 0.9, ab: true, instantThrottle: true, hold: true, tp: 0.05, tr: 0 });
      RT.sim(0.4);
    },
    update(i, n) {
      const { V } = RT; const p = RT.pos(); const b = RT.body();
      const a = i / n;
      const vel = b.velocity.clone().normalize();
      const right = vel.clone().cross(V(0, 1, 0)).normalize();
      const th = (-20 + 80 * a) * Math.PI / 180;
      const off = vel.clone().multiplyScalar(Math.cos(th) * 30).addScaledVector(right, Math.sin(th) * 30).add(V(0, 3 - a * 4, 0));
      RT.cam = { pos: p.clone().add(off), look: p.clone().addScaledVector(vel, -4), fov: 40 };
      return 1 / 60;
    },
  },
  space: {
    frames: 72,
    setup() {
      RT.start('spaceship', { tod: 17.0 });
      const { V, g } = RT;
      const pad = g.world.props.spacePad;
      const y = RT.ground(pad.x, pad.z) + Math.max(6, g.craft.radius * 0.75);
      g.controller.reset(V(pad.x, y, pad.z), 0, true, 0, 84);
      Object.assign(RT.ctl, { throttle: 1, instantThrottle: true, burner: true });
      RT.pad = V(pad.x, y, pad.z);
      RT.sim(0.7);
    },
    update(i, n) {
      const { V } = RT; const p = RT.pos(); const P = RT.pad;
      const camPos = V(P.x + 48, RT.ground(P.x + 48, P.z + 40) + 2.0, P.z + 40);
      RT.cam = { pos: camPos, look: p.clone().add(V(0, -10, 0)), fov: 36 - i * 0.12 };
      return 1 / 30;
    },
  },

  cockpit_roll: {
    frames: 60,
    setup() {
      RT.start('fighter', { tod: 17.0, airborne: true });
      RT.place([-2600, 200, 30], 90, true, 230, 2);
      Object.assign(RT.ctl, { throttle: 1, ab: true, instantThrottle: true, hold: false, roll: 0, pitch: 0.04 });
      RT.sim(0.3);
    },
    update(i) {
      const { V, g } = RT; const b = RT.body();
      RT.ctl.roll = i > 8 && i < 44 ? -1 : 0;
      RT.ctl.fire = i > 40;
      const cp = g.craft.cockpit ? g.craft.cockpit.pos : V(0, 1, -3);
      const pos = b.localToWorld(cp.clone().add(V(0, 0.15, 0.25)), V());
      RT.cam = { pos, look: pos.clone().addScaledVector(b.forward, 50), up: b.localToWorldDir(V(0, 1, 0), V()), fov: 76 };
      return 1 / 30;
    },
  },
};
