// FORGE 철공소 — 메인: 초기화 · 게임 루프 · 상태 관리
import * as THREE from 'three';
import { Input } from './core/input.js';
import { Sfx } from './core/audio.js';
import { Physics } from './physics.js';
import { Renderer } from './gfx/render.js';
import { generateSkins } from './gfx/textures.js';
import { MaterialLib } from './gfx/materials.js';
import { FX } from './gfx/fx.js';
import { World } from './world/world.js';
import { StructureManager } from './build/structures.js';
import { VehicleSystem } from './build/vehicle.js';
import { Presets } from './build/presets.js';
import { CAT_BY_ID } from './build/catalog.js';
import { serialize, deserialize, Store } from './build/save.js';
import { Player } from './player.js';
import { ToolSystem } from './tools/tools.js';
import { UI } from './ui.js';
import { clamp, damp, toV, rand } from './core/util.js';

const DEF_SET = { quality: 'high', sens: 1, fov: 75, vol: 0.8, helmet: true, fps: false };

class Game {
  constructor() {
    let s = {}; try { s = JSON.parse(localStorage.getItem('forge.settings') || '{}'); } catch (e) {}
    this.settings = { ...DEF_SET, ...s };
    if (!s.quality && (matchMedia('(pointer: coarse)').matches || innerWidth < 900)) this.settings.quality = 'medium';
    const qp = new URLSearchParams(location.search).get('q'); if (qp && ['low', 'medium', 'high', 'ultra'].includes(qp)) this.settings.quality = qp;
    this.sfx = new Sfx(); this.sfx.vol = this.settings.vol;
    this.driving = false; this.camMode = 'chase'; this.paused = true; this.t = 0;
    this.contactQ = []; this.timers = { static: 0, clean: 0, auto: 0 };
  }
  async boot() {
    const ui = (this.ui = new UI(this));
    ui.state('loading'); ui.loading(0.02, '렌더러 준비');
    const canvas = document.getElementById('gl');
    this.input = new Input(canvas);
    this.input.onUnlock = () => { if (this.ui.st === 'play' || this.ui.st === 'drive') this.pause(); };
    this.renderer = new Renderer(canvas, this.settings.quality);
    const scene = (this.scene = new THREE.Scene());
    const camera = (this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.02, 5000));
    scene.add(camera);
    ui.loading(0.06, '물리 엔진 (Rapier) 초기화');
    this.ph = new Physics(); await this.ph.init();
    const skins = await generateSkins((f, k) => ui.loading(0.08 + f * 0.6, '재질 텍스처 생성 · ' + k));
    this.mats = new MaterialLib(skins);
    ui.loading(0.7, '작업장 · 지형 구축');
    await new Promise((r) => setTimeout(r, 0));
    this.world = new World({ scene, renderer: this.renderer.r, physics: this.ph, mats: this.mats, quality: this.renderer.q });
    this.world.build();
    this.fx = new FX(scene, camera, this.renderer.r); this.fx.surfaceY = (x, z, y) => this.world.surfaceY(x, z, y);
    this.mgr = new StructureManager({ scene, physics: this.ph, mats: this.mats, sfx: this.sfx, fx: this.fx });
    this.vehicles = new VehicleSystem({ ph: this.ph, mgr: this.mgr, sfx: this.sfx, fx: this.fx, scene });
    this.player = new Player({ ph: this.ph, camera, sfx: this.sfx });
    this.presets = new Presets(this);
    this.tools = new ToolSystem(this); this.tools.setVisible(false);
    this.ph.onContactForce = (e) => this.contactQ.push([e.collider1(), e.collider2(), e.totalForceMagnitude()]);
    ui.loading(0.8, '후처리 · 셰이더 컴파일');
    this.renderer.setup(scene, camera);
    this.applySettings(false);
    await new Promise((r) => setTimeout(r, 0));
    this.ui.makeThumbs(this.mgr);
    this.seed();
    this.renderer.r.compile(scene, camera);
    ui.loading(1, '완료');
    this.ui.menuInfo(); ui.state('menu');
    addEventListener('beforeunload', () => this.autosave());
    addEventListener('keydown', (e) => this.key(e));
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }
  // 초기 작업장: 자재 더미 + 예제
  seed() {
    const m = this.mgr, sp = (id, dims, x, y, z, ry = 0, rz = 0) => {
      const d = CAT_BY_ID[id], p = m.createPart(d, dims || d.dims);
      m.spawn(p, new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)));
      return p;
    };
    // 용접 정반 위
    sp('plate5', [0.5, 0.005, 0.5], -7.55, 0.9055, -13);
    sp('plate5', [0.5, 0.005, 0.5], -7.049, 0.9055, -13);
    sp('sqtube', [1.0, 0.05, 0.05], -6.9, 0.928, -12.55);
    // 목재 더미 (작업대 옆)
    for (let i = 0; i < 6; i++) sp('2x4', null, 2.2, 0.019 + Math.floor(i / 3) * 0.038, -21.5 + (i % 3) * 0.1, 0, 0);
    for (let i = 0; i < 3; i++) sp('plywood', null, 9, 0.009 + i * 0.018, -19.5);
    // 야외 자재 야적장 (문 오른쪽)
    for (let i = 0; i < 3; i++) sp('hbeam', null, 12, 0.075, 4 + i * 0.4, Math.PI / 2);
    for (let i = 0; i < 4; i++) sp('plate5', null, 15.5, 0.0025 + i * 0.005, 5);
    for (let i = 0; i < 4; i++) sp('rtube', [3, 0.1, 0.05], 18.5, 0.05, 3.5 + i * 0.12, Math.PI / 2);
    for (let i = 0; i < 4; i++) sp('pipe', [3, 0.0605, 0.0605], 21, 0.03025, 3.5 + i * 0.07, Math.PI / 2);
    for (let k = 0; k < 2; k++) for (let i = 0; i < 4; i++) sp('block', null, 12 + i * 0.4, 0.095 + k * 0.19, 9);
    for (let i = 0; i < 2; i++) sp('glass', [1.2, 0.006, 0.8], 16, 0.003 + i * 0.006, 9);
    // 예제: 고카트, 벽돌 벽
    this.presets.spawn('kart', new THREE.Vector3(-4, 0, 7), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    this.presets.spawn('wall', new THREE.Vector3(40, 0, 34.5), new THREE.Quaternion());
    this.mgr.time = 0; // 주의: 첫 스텝 전 sleep() 하면 Rapier 접촉이 계산되지 않아 관통함
  }
  applySettings(qualityChanged) {
    const s = this.settings;
    try { localStorage.setItem('forge.settings', JSON.stringify(s)); } catch (e) {}
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
    this.player.sens = 0.0022 * s.sens; this.sfx.setVolume(s.vol);
    if (qualityChanged) { this.renderer.setQuality(s.quality); this.world.sun.shadow.mapSize.setScalar(this.renderer.q.shadow); this.world.sun.shadow.map?.dispose(); this.world.sun.shadow.map = null; }
  }
  // ── 상태 전환 ──
  start(cont) {
    this.sfx.init();
    if (!cont && this.played) { this.mgr.clearAll(); this.vehicles.seat = null; this.tools.undo = []; this.seed(); }
    this.played = true;
    if (!this.amb) this.amb = this.sfx.loop('ambient');
    this.amb?.set(0.25);
    if (cont) this.load('auto', true);
    this.player.teleport(new THREE.Vector3(0, 1.0, 9)); this.player.yaw = 0; this.player.pitch = -0.15;
    this.resume();
    if (!cont) this.ui.toast('Tab 으로 자재를 고르고, 좌클릭으로 배치하세요');
  }
  resume() {
    this.ui.state(this.driving ? 'drive' : 'play'); this.paused = false; this.input.enabled = true; this.input.lock();
    this.tools.setVisible(!this.driving); this.ui.setTool(this.tools.idx);
  }
  pause() { if (this.ui.st === 'pause') return; this.ui.state('pause'); this.paused = true; this.ui.renderSlots(); this.tools.setVisible(false); this.input.unlock(); }
  toMenu() { this.autosave(); if (this.driving) this.exitVehicle(); this.ui.state('menu'); this.ui.menuInfo(); this.paused = true; this.input.enabled = false; this.amb?.set(0); }
  openCatalog() { this.ui.state('catalog'); this.paused = true; this.tools.setVisible(false); this.input.unlock(); this.ui.openCatalog(); }
  key(e) {
    const st = this.ui.st;
    if (e.code === 'Tab' && (st === 'play' || st === 'catalog')) { e.preventDefault(); if (st === 'play') this.openCatalog(); else this.resume(); }
    if (e.code === 'Escape' && st === 'catalog') this.resume();
    if (e.code === 'Escape' && (st === 'help' || st === 'settings')) this.ui.act('back');
    if (e.code === 'Escape' && (st === 'play' || st === 'drive') && !this.input.locked) this.pause();
  }
  save(slot) { const ok = Store.save(slot, serialize(this.mgr)); this.ui.toast(ok ? `슬롯 ${slot} 에 저장했습니다` : '저장 실패 (저장 공간 부족)'); }
  load(slot, silent) {
    const d = Store.load(slot); if (!d) return;
    if (this.driving) this.exitVehicle();
    deserialize(this.mgr, d); this.tools.undo = [];
    if (!silent) { this.ui.toast(`슬롯 ${slot} 불러오기 완료`); this.resume(); }
  }
  autosave() { if (this.mgr && this.ui.st !== 'menu' && this.ui.st !== 'loading') Store.save('auto', serialize(this.mgr)); }
  // ── 차량 ──
  enterVehicle(seat) {
    this.driving = true; this.player.setEnabled(false); this.vehicles.enter(seat);
    this.tools.setVisible(false); this.ui.driving(true); this.ui.state('drive'); this.camYaw = 0; this.camPitch = -0.12;
    const r = seat.s.rig;
    this.ui.toast(r?.ctrl ? (r.engines.length ? `${seat.s.parts.size}개 부품 · ${Math.round(seat.s.mass + 75)} kg · 출력 ${Math.round(r.power / 1000)} kW` : '엔진이 없습니다 — 조향·제동만 가능') : r?.thrusters.length ? '바퀴 없음 — Shift 로 추진기 점화' : '바퀴가 없습니다');
    this.chase = null;
  }
  exitVehicle() {
    const seat = this.vehicles.seat; this.vehicles.exit(); this.driving = false;
    if (seat?.s) {
      const r = seat.s.rig, right = r ? r.axle.clone().negate().applyQuaternion(seat.s.group.quaternion) : new THREE.Vector3(1, 0, 0);
      const p = seat.worldPos().addScaledVector(right, 1.1); p.y += 0.6;
      const hit = this.ph.raycast(p.clone().add(new THREE.Vector3(0, 2, 0)), new THREE.Vector3(0, -1, 0), 5);
      if (hit) p.y = hit.point.y + 0.9;
      this.player.teleport(p);
    }
    this.player.setEnabled(true); this.ui.driving(false); this.ui.state('play'); this.tools.setVisible(true);
  }
  driveCam(dt, input) {
    const seat = this.vehicles.seat, r = seat?.s?.rig;
    if (!seat || !seat.s) { this.exitVehicle(); return; }
    const q = seat.s.group.quaternion, F = (r ? r.F : new THREE.Vector3(0, 0, -1)).clone().applyQuaternion(q), U = (r ? r.U : new THREE.Vector3(0, 1, 0)).clone().applyQuaternion(q);
    this.camYaw -= input.mx * this.player.sens; this.camPitch = clamp(this.camPitch - input.my * this.player.sens, -1.2, 0.9);
    if (!input.mx && !input.my) { this.camYaw = damp(this.camYaw, 0, 0.8, dt); }
    const cam = this.camera;
    if (this.camMode === 'fp') {
      const eye = seat.toWorld(new THREE.Vector3(0, 0.58, 0.12));
      cam.position.copy(eye);
      const look = F.clone().applyAxisAngle(U, this.camYaw); const right = new THREE.Vector3().crossVectors(look, U).normalize(); look.applyAxisAngle(right, this.camPitch + 0.1);
      cam.up.copy(U); cam.lookAt(eye.clone().add(look)); cam.up.set(0, 1, 0);
    } else {
      const tgt = seat.worldPos().addScaledVector(U, 0.6);
      const ff = new THREE.Vector3(F.x, 0, F.z); if (ff.lengthSq() < 1e-3) ff.set(0, 0, -1); ff.normalize();
      if (!this.chase) this.chase = ff.clone();
      this.chase.lerp(ff, 1 - Math.exp(-3 * dt)).normalize();
      const dir = this.chase.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.camYaw);
      const size = Math.cbrt(seat.s.mass) * 0.42 + 2.2;
      const want = tgt.clone().addScaledVector(dir, -size * Math.cos(this.camPitch * 0.8 - 0.25)).add(new THREE.Vector3(0, size * Math.sin(-this.camPitch * 0.8 + 0.3) + 0.4, 0));
      const d = want.clone().sub(tgt), len = d.length(); d.normalize();
      const hit = this.ph.raycast(tgt, d, len, undefined, seat.s.body);
      if (hit) want.copy(tgt).addScaledVector(d, Math.max(0.5, hit.dist - 0.2));
      cam.position.lerp(want, this.chaseInit ? 1 - Math.exp(-12 * dt) : 1); this.chaseInit = true;
      cam.lookAt(tgt);
    }
    if (input.pressed('KeyV')) { this.camMode = this.camMode === 'fp' ? 'chase' : 'fp'; this.chaseInit = false; }
    if (input.pressed('KeyE')) this.exitVehicle();
  }
  // ── 충돌 처리: 소리 · 찌그러짐 · 유리 파손 · 접합 파손 ──
  processContacts() {
    const q = this.contactQ; if (!q.length) return;
    const w = this.ph.world, mgr = this.mgr;
    let dents = 0, breaks = 0;
    const shatter = [], crumble = [];
    for (const [h1, h2, F] of q) {
      const p1 = mgr.colMap.get(h1), p2 = mgr.colMap.get(h2);
      for (const [p, o] of [[p1, p2 || this.ph.statics.get(h2)], [p2, p1 || this.ph.statics.get(h1)]]) {
        if (!p || !p.s) continue;
        const S = p.s, base = (S.anchored ? 0 : S.mass * 9.81 * 1.6) + 600, ex = F - base;
        if (ex <= 0) continue;
        const pos = p.worldPos();
        if (this.sfx.limit('c' + S.id, 110)) this.sfx.impact(p.mat.sound, ex, pos);
        if (ex > 1500 && Math.random() < 0.5) this.fx.dust(pos, 2, [0.5, 0.48, 0.45], 0.12);
        if (p.mat.brittle && ex > 2500 * (Math.min(...p.dims) / 0.006)) { shatter.push(p); continue; }
        if (p.mat.masonry && ex > 26000 && crumble.length < 2) crumble.push(p);
        for (let k = 0; k < 3 && breaks < 14 && p.joints.size && ex * 0.45 > p.strength(mgr.time); k++) { mgr.breakWeakest(p); breaks++; }
        if (p.dentable && ex > 9000 * (Math.min(...p.dims) / 0.003) ** 1.5 && dents < 3) {
          const c1 = w.getCollider(h1), c2 = w.getCollider(h2);
          if (c1 && c2) w.contactPair(c1, c2, (m) => {
            if (dents >= 3 || m.numSolverContacts() < 1) return;
            const cp = toV(m.solverContactPoint(0)), n = toV(m.normal());
            const lp = p.toLocal(cp), ln = n.applyQuaternion(p.worldQuat().invert());
            if (mgr.dent(p, lp, ln, clamp(0.06 + ex / 400000, 0.06, 0.25), clamp(ex / 2.5e6, 0.002, 0.03))) { dents++; this.sfx.play('clang', { pos: cp, vol: 0.8, size: 2, ring: 0.4 }); }
          });
        }
      }
    }
    q.length = 0;
    for (const p of new Set(shatter)) if (p.s) this.tools.shatter(p, toV(p.s.body.linvel()));
    for (const p of crumble) if (p.s) this.tools.breakMasonry(p);
  }
  // ── 루프 ──
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt)); this.frameNo = (this.frameNo || 0) + 1;
    const dt = Math.min(0.1, (t - this.last) / 1000); this.last = t; this.t += dt;
    const input = this.input, st = this.ui.st;
    if (st === 'play' || st === 'drive') {
      if (input.isTouch && input.pressed('Escape')) this.pause();
      if (input.isTouch && input.pressed('Tab') && !this.driving) this.openCatalog();
      if (this.driving) this.vehicles.update(dt, input);
      else { this.player.look(input, dt); this.player.input(input); this.tools.update(dt, input); this.vehicles.update(dt, input); }
      this.ph.step(dt, (h) => {
        this.mgr.beforePhysics();
        if (!this.driving) this.player.step(h);
        this.tools.physicsStep(h); this.vehicles.step(h);
      }, (h) => { this.mgr.afterPhysics(); this.mgr.physicsStep(h); this.processContacts(); });
      this.mgr.flushDirty();
      this.mgr.sync(this.ph.alpha); this.mgr.update(dt);
      if (this.driving) this.driveCam(dt, input); else this.player.updateCamera(this.ph.alpha, dt, this.fx.shake);
      this.timers.static += dt; this.timers.clean += dt; this.timers.auto += dt;
      if (this.timers.static > 0.5) { this.timers.static = 0; this.mgr.staticCheck(); }
      if (this.timers.clean > 5) { this.timers.clean = 0; this.mgr.cleanup(); }
      if (this.timers.auto > 60) { this.timers.auto = 0; this.autosave(); }
      this.ui.hud(dt);
    } else if (st === 'menu' || st === 'loading') {
      const a = this.t * 0.06, cam = this.camera;
      cam.position.set(Math.sin(a) * 15, 3.2 + Math.sin(this.t * 0.2) * 0.4, 6 + Math.cos(a) * 9); cam.lookAt(0, 1.4, -6);
      this.mgr?.sync(1);
    }
    if (this.world) { this.world.followSun(this.camera.position); this.fx.update(st === 'play' || st === 'drive' ? dt : 0); this.sfx.setListener(this.camera); }
    if (this.renderer.composer) this.renderer.render();
    input.endFrame();
    this.fpsAcc = (this.fpsAcc || 0) + 1; this.fpsT = (this.fpsT || 0) + dt;
    if (this.fpsT > 0.5) { this.ui.fps(Math.round(this.fpsAcc / this.fpsT)); this.fpsAcc = 0; this.fpsT = 0; }
  }
}

const game = new Game();
window.forge = game;
game.boot().catch((e) => { console.error(e); document.getElementById('load-label').textContent = '오류: ' + e.message; });
