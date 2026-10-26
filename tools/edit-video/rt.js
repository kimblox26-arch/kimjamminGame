// 페이지 내부 런타임: 기체 스크립팅 + 시네마틱 카메라
(async () => {
  const THREE = await import('three');
  const { PRESETS } = await import('/src/craft/presets.js');
  const g = window.__FREEFREELY__;
  const V = (a, b, c) => new THREE.Vector3(a, b, c);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const RT = (window.RT = { THREE, PRESETS, g, V, clamp, cam: null, ctl: {}, t: 0 });

  RT.start = (presetId, opt = {}) => {
    const bp = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
    g.startFlight(bp, { id: 'free', name: 'edit', airborne: !!opt.airborne, altitude: opt.alt });
    g.hud.visible = false;
    g.bloom.strength = 0.1; g.bloom.radius = 0.3; g.bloom.threshold = 0.97;
    g.renderer.toneMappingExposure = 0.85;
    if (opt.weather) g.world.applyWeather(opt.weather);
    if (opt.tod !== undefined) g.world.setTimeOfDay(opt.tod);
    RT.ctl = { throttle: 0, pitch: 0, roll: 0, yaw: 0, ab: false, fire: false, hold: false, tr: 0, tp: 0 };
    RT.cam = null;
    RT.t = 0;
    RT.meta = {};
    RT.maxBoom = 0;
    const ctrl = g.controller;
    ctrl.readInput = function (input, dt) {
      if (this.destroyed) { this.targetThrottle = 0; return; }
      const c = RT.ctl;
      this.targetThrottle = c.throttle;
      if (c.instantThrottle) this.throttle = c.throttle;
      this.ctrl.yaw = c.yaw || 0;
      if (c.hold) {
        const body = this.craft.body;
        const att = body.getAttitude();
        const om = body.worldToLocalDir(body.angularVelocity, new THREE.Vector3());
        const rollRate = -om.z, pitchRate = om.x;
        const rollCmd = clamp((c.tr - att.roll) * 2.2, -(c.rr || 1.6), c.rr || 1.6);
        this.ctrl.roll = clamp((rollCmd - rollRate) * 1.6, -1, 1);
        if (c.pull !== undefined) this.ctrl.pitch = c.pull;
        else {
          const pitchCmd = clamp((c.tp - att.pitch) * 1.4, -0.5, 0.5);
          this.ctrl.pitch = clamp((pitchCmd - pitchRate) * 2.4, -1, 1);
        }
      } else {
        this.ctrl.pitch = c.pitch; this.ctrl.roll = c.roll;
      }
      this.afterburner = !!c.ab && this.throttle > 0.55;
      this.firing = !!c.fire;
      this.burnerOn = !!c.burner;
      this.brake = c.brake ? 1 : 0;
    };
  };

  RT.place = (p, heading, airborne, speed = 0, pitch = 0) => {
    g.controller.reset(V(p[0], p[1], p[2]), heading, airborne, speed, pitch);
    g.rig.pos.copy(V(p[0], p[1] + 10, p[2] + 40));
    if (airborne) for (const e of g.craft.engines) e.rpm = 1;
  };
  RT.ground = (x, z) => g.world.surfaceAt(x, z).height;
  RT.body = () => g.craft.body;
  RT.pos = () => g.craft.body.position.clone();
  RT.fwd = () => g.craft.body.forward.clone();
  RT.local = (x, y, z) => g.craft.body.localToWorld(V(x, y, z), V());

  // 렌더 없이 물리/이펙트만 진행
  RT.sim = (seconds, perStep) => {
    const dt = 1 / 60;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      if (perStep) perStep(RT.t);
      g._updateFlight(dt);
      RT.t += dt;
    }
  };

  // 카메라: {pos:V3, look:V3, fov, roll(rad), up}
  window.__camHook = () => {
    const c = RT.cam;
    if (!c || g.state !== 'flight') return;
    const cam = g.camera;
    cam.position.copy(c.pos);
    const m = new THREE.Matrix4();
    const up = c.up ? c.up.clone() : V(0, 1, 0);
    m.lookAt(c.pos, c.look, up);
    cam.quaternion.setFromRotationMatrix(m);
    if (c.roll) cam.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), c.roll));
    if (c.fov && cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  };
  RT.ready = true;
})();

// 프레임별 훅 + 커스텀 플레어(연기 꼬리)
(function waitRT() {
  if (!window.RT || !window.RT.ready) return setTimeout(waitRT, 50);
  const RT = window.RT, g = RT.g, THREE = RT.THREE;
  RT.onStep = null;
  RT.flareList = [];
  const orig = g._updateFlight.bind(g);
  g._updateFlight = (dt) => {
    if (RT.onStep) RT.onStep(dt);
    RT.updateFlares(dt);
    orig(dt);
  };
  RT.launchFlares = (n = 4) => {
    const b = g.craft.body;
    const p = b.localToWorld(new THREE.Vector3(0, -0.6, 2.5), new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const side = (i % 2 ? 1 : -1) * (26 + Math.random() * 18);
      const v = b.localToWorldDir(new THREE.Vector3(side, -14 - Math.random() * 10, 14 + Math.random() * 12), new THREE.Vector3());
      v.addScaledVector(b.velocity, 0.82);
      RT.flareList.push({ p: p.clone(), v, life: 3.5 + Math.random() * 1.5 });
    }
  };
  RT.updateFlares = (dt) => {
    for (let i = RT.flareList.length - 1; i >= 0; i--) {
      const f = RT.flareList[i];
      f.life -= dt;
      if (f.life <= 0) { RT.flareList.splice(i, 1); continue; }
      f.v.y -= 9.81 * 0.55 * dt;
      f.v.multiplyScalar(Math.exp(-0.9 * dt));
      f.p.addScaledVector(f.v, dt);
      g.fx.fire.spawn({ x: f.p.x, y: f.p.y, z: f.p.z, vx: 0, vy: 0, vz: 0, size: 7 + Math.random() * 3, sizeRate: -6,
        color: { r: 1, g: 0.97, b: 0.85 }, colorTo: { r: 1, g: 0.5, b: 0.15 }, life: 0.28, drag: 0, gravity: 0, fade: 1 });
      if (Math.random() < 0.3) g.fx.smoke.spawn({ x: f.p.x, y: f.p.y, z: f.p.z, vx: 0, vy: 0.4, vz: 0, size: 1.4, sizeRate: 1.3,
        color: { r: 0.85, g: 0.85, b: 0.86 }, colorTo: { r: 0.7, g: 0.7, b: 0.72 }, life: 3.0, drag: 0.5, gravity: -0.15, fade: 1.2, opacity: 0.3 });
    }
  };
})();

// 충격파(빌보드 블래스트)가 화면을 덮지 않도록 축소
(function patchSW() {
  if (!window.RT || !window.RT.ready || !window.RT.g.fx) return setTimeout(patchSW, 50);
  const fx = window.RT.g.fx;
  const ex = fx.explosion.bind(fx);
  fx.explosion = (pos, size = 1, opts) => ex(pos, Math.min(size, window.RT.maxBoom || 1.7), opts);
  // 고하중 날개끝 증기를 얇게 (화면을 뒤덮지 않도록)
  fx.vortex = (pos, dir, amount) => {
    if (Math.random() > amount * 0.3) return;
    fx.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * 2, vy: dir.y * 2, vz: dir.z * 2,
      size: 0.7 + Math.random() * 0.8, sizeRate: 2 + Math.random() * 3,
      color: { r: 1, g: 1, b: 1 }, colorTo: { r: 0.95, g: 0.97, b: 1 },
      life: 0.3 + Math.random() * 0.5, drag: 0.4, opacity: 0.22, fade: 1.5 });
  };
  const sw = fx.shockwave.bind(fx);
  fx.shockwave = (pos, size) => {
    sw(pos, size);
    const r = fx.rings[fx.rings.length - 1];
    if (r && r.kind === 'blast') {
      if (window.RT.keepBlast) { r.grow *= 0.2; r.life *= 0.5; r.maxLife *= 0.5; r.mesh.material.opacity = 0.5; }
      else { r.life = 1e-4; r.mesh.material.opacity = 0; }
    }
  };
})();
