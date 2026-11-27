// 시작 지점: 서울 도심의 6층 빌라(1층 필로티), 3층 우리 집 내부 + 계단실 + 내비 그래프 + 대피소(학교)
import * as THREE from 'three';
import { T, dynTex } from './textures.js';
import { MB, clamp, lerp } from './util.js';
import { siteHeight, terrainH } from './korea.js';

export const BX = 30, BZ = 50, FH = 3;
const PF = 2; // 플레이어 층(3층)

export class Door {
  constructor(game, box, pivot, center) { this.game = game; this.box = box; box.door = this; this.pivot = pivot; this.closed = true; this.locked = false; this.barricade = false; this.hp = 100; this.center = center; this.broken = false; this.ang = 0; }
  damage(d) { if (!this.closed) return; this.hp -= d * (this.barricade ? 0.25 : this.locked ? 0.6 : 1.6); this.game.player.shake(0.12); if (this.hp <= 0) this.breakOpen(); }
  breakOpen() { this.broken = true; this.closed = false; this.locked = false; this.box.on = false; this.target = -1.5; this.game.audio.play('crash', { pos: this.center, vol: 0.8 }); this.game.emit('doorBroken'); }
  toggle() { if (this.broken || this.locked || this.barricade) return; this.closed = !this.closed; this.box.on = this.closed; this.target = this.closed ? 0 : -1.45; this.game.audio.play('doorOpen', { pos: this.center, inside: true }); this.game.zombies.noise(this.center, 8); }
  update(dt) { if (this.target !== undefined) { this.ang += (this.target - this.ang) * Math.min(1, dt * 5); this.pivot.rotation.y = this.ang; } }
}

export class Home {
  constructor(game) {
    this.game = game; this.Y0 = siteHeight() + 0.15;
    const Y0 = this.Y0;
    this.group = new THREE.Group(); this.group.position.set(BX, Y0, BZ); game.scene.add(this.group);
    this.mb = {}; this.B = k => this.mb[k] ||= new MB();
    const S = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85 }, o));
    this.mats = {
      brick: S({ map: T.facadeVilla.map, vertexColors: true }), plaster: S({ map: T.concrete.map, normalMap: T.concrete.normalMap, vertexColors: true, roughness: 0.95 }),
      wall: S({ map: T.wallpaper.map, normalMap: T.wallpaper.normalMap, vertexColors: true }), wood: S({ map: T.wood.map, normalMap: T.wood.normalMap, roughness: 0.55 }),
      tile: S({ map: T.tile.map, normalMap: T.tile.normalMap, roughness: 0.2, vertexColors: true }), fabric: S({ vertexColors: true, normalMap: T.clothNormal, roughness: 0.95 }),
      plastic: S({ vertexColors: true, roughness: 0.35 }), steel: S({ vertexColors: true, metalness: 0.8, roughness: 0.3 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fb4c0, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false }),
      stair: S({ map: T.concrete.map, vertexColors: true, roughness: 0.7 })
    };
    for (const k in this.mats) this.mats[k].envMapIntensity = 0.3;
    this.inter = [];
    this.build();
    for (const k in this.mb) { if (this.mb[k].empty) continue; const m = this.mb[k].mesh(this.mats[k], k !== 'glass'); if (k === 'glass') m.renderOrder = 3; this.group.add(m); }
    this.props();
    this.nav = this.makeNav();
    game.world.special.set('0,0,0,0', (c, r) => this.yard(c, r));
  }
  w(x, y, z) { return new THREE.Vector3(BX + x, this.Y0 + y, BZ + z); }
  cb(x0, y0, z0, x1, y1, z1, extra) { return this.game.col.box(BX + x0, this.Y0 + y0, BZ + z0, BX + x1, this.Y0 + y1, BZ + z1, 'home', extra); }
  solid(k, x0, y0, z0, x1, y1, z1, o = {}, col = true) { this.B(k).box(x0, y0, z0, x1, y1, z1, o); if (col) return this.cb(x0, y0, z0, x1, y1, z1, o.extra); }
  // 구멍 뚫린 벽: axis 'x' = x 방향으로 뻗은 벽(z 두께), holes: [a0,a1,y0,y1]
  wall(axis, a0, a1, t0, t1, y0, y1, holes, k, o = {}) {
    const seg = (b0, b1, c0, c1) => { if (b1 - b0 < 0.01 || c1 - c0 < 0.01) return; if (axis === 'x') this.solid(k, b0, c0, t0, b1, c1, t1, o); else this.solid(k, t0, c0, b0, t1, c1, b1, o); };
    let p = a0;
    for (const [h0, h1, hy0, hy1] of holes.sort((a, b) => a[0] - b[0])) { seg(p, h0, y0, y1); seg(h0, h1, y0, hy0); seg(h0, h1, hy1, y1); p = h1; }
    seg(p, a1, y0, y1);
  }
  build() {
    const B = this.B, brickC = [0.95, 0.9, 0.88];
    // 1층 필로티 기둥
    for (const x of [0.2, 5.25, 10.3, 13.7, 18.75, 23.8]) for (const z of [0.2, 6, 11.8]) this.solid('plaster', x - 0.2, 0, z - 0.2, x + 0.2, 2.75, z + 0.2, { su: 3, col: [0.8, 0.8, 0.78] });
    // 세대(솔리드) + 우리 집(빈 공간)
    for (let f = 1; f <= 5; f++) {
      const y = f * FH;
      for (const [x0, x1] of [[0, 10.3], [13.7, 24]]) {
        if (f === PF && x0 === 0) continue;
        this.B('brick').box(x0, y - 0.25, 0, x1, y + 2.75, 12, { faces: 1 | 2 | 16 | 32, su: 12, sv: 6, col: brickC, uo: f });
        this.B('plaster').box(x0, y - 0.25, 0, x1, y - 0.24, 12, { faces: 8, su: 3, col: [0.85, 0.85, 0.83] });
        this.cb(x0, y - 0.25, 0, x1, y + 2.75, 12);
      }
      // 슬래브 경계 띠
      this.B('plaster').box(-0.05, y - 0.3, -0.05, 24.05, y - 0.05, 12.05, { faces: 1 | 2 | 16 | 32, su: 3, col: [0.9, 0.88, 0.84] });
    }
    // 옥상
    for (const [a, b] of [[0, 10.5], [13.5, 24]]) this.solid('plaster', a, 17.75, 0, b, 18, 12, { su: 3, topCol: [0.42, 0.6, 0.48], col: [0.85, 0.85, 0.83] });
    for (const [x0, z0, x1, z1] of [[0, 0, 24, 0.2], [0, 11.8, 24, 12], [0, 0, 0.2, 12], [23.8, 0, 24, 12]]) this.solid('plaster', x0, 18, z0, x1, 19.1, z1, { su: 3, col: [0.85, 0.85, 0.83] });
    // 계단실 코어(엘리베이터 없는 빌라: 뒤쪽은 막힌 샤프트)
    this.solid('plaster', 10.3, 0, 0, 13.7, 20.6, 5.6, { su: 3, col: [0.82, 0.82, 0.8] });
    for (let f = 0; f <= 6; f++) {
      const y = f * FH, sc = [0.62, 0.66, 0.6];
      if (f > 0) this.solid('stair', 10.5, y - 0.25, 10, 13.5, y, 12, { su: 2, col: sc, topCol: [0.55, 0.55, 0.53] });
      if (f < 6) {
        for (let k = 1; k <= 9; k++) {
          const t1 = y + k * 1.5 / 9; this.solid('stair', 10.5, t1 - 0.25, 10 - k * 0.2778, 12, t1, 10 - (k - 1) * 0.2778, { su: 2, col: sc, topCol: [0.5, 0.5, 0.48] });
          const t2 = y + 1.5 + k * 1.5 / 9; this.solid('stair', 12, t2 - 0.25, 7.5 + (k - 1) * 0.2778, 13.5, t2, 7.5 + k * 0.2778, { su: 2, col: sc, topCol: [0.5, 0.5, 0.48] });
        }
        this.solid('stair', 10.5, y + 1.25, 5.98, 13.5, y + 1.5, 7.5, { su: 2, col: sc, topCol: [0.55, 0.55, 0.53] });
        this.solid('plaster', 11.95, y, 7.5, 12.05, y + FH, 10, { su: 3, col: [0.7, 0.74, 0.68] });
      }
      // 계단실 벽 (서: 우리 집 현관문 / 동)
      const top = f === 6 ? 20.6 - y : FH;
      if (f === 6) this.wall('z', 5.6, 12, 10.3, 10.5, y, y + 2.6, [[9.5, 11.6, y, y + 2.3]], 'plaster', { su: 3, col: [0.7, 0.74, 0.68] });
      else this.wall('z', 5.6, 12, 10.3, 10.5, y, y + top, f === PF ? [[10.4, 11.4, y, y + 2.1]] : [], 'plaster', { su: 3, col: [0.7, 0.74, 0.68] });
      this.solid('plaster', 13.5, y, 5.6, 13.7, y + (f === 6 ? 2.6 : top), 12, { su: 3, col: [0.7, 0.74, 0.68] });
      this.solid('plaster', 10.3, y, 5.4, 13.7, y + (f === 6 ? 2.6 : top), 5.6, { su: 3, col: [0.7, 0.74, 0.68] });
      // 정면 벽(1층 출입구, 층마다 작은 창)
      this.wall('x', 10.3, 13.7, 12, 12.2, y, y + (f === 6 ? 2.6 : top), f === 0 ? [[11, 13, y, y + 2.4]] : [[11.3, 12.7, y + 1.9, y + 2.6]], 'plaster', { su: 3, col: [0.85, 0.85, 0.82] });
      if (f > 0) this.B('glass').box(11.3, y + 1.9, 12.08, 12.7, y + 2.6, 12.12, { faces: 16 | 32 });
      // 다른 세대 현관문(장식)
      if (f > 0 && f < 6) { if (f !== PF) this.B('steel').box(10.28, y, 10.4, 10.3, y + 2.1, 11.4, { col: [0.35, 0.3, 0.27] }); this.B('steel').box(13.7, y, 10.4, 13.72, y + 2.1, 11.4, { col: [0.35, 0.3, 0.27] }); }
    }
    this.solid('plaster', 10.3, 20.6, 5.4, 13.7, 20.9, 12.2, { su: 3, col: [0.8, 0.8, 0.78] });
    this.B('steel').box(11.6, 2.45, 12.2, 12.4, 2.6, 12.9, { col: [0.6, 0.6, 0.6] }); // 출입구 캐노피
    // ----- 우리 집 (3층 서쪽 세대) -----
    const y = PF * FH, H = 2.75, wc = [0.97, 0.96, 0.93];
    this.solid('wood', 0, y - 0.25, 0, 10.3, y, 12, { faces: 4, tu: 2.4 }, false);
    this.cb(0, y - 0.25, 0, 10.5, y, 12);
    this.B('tile').box(0.2, y + 0.005, 0.2, 3.94, y + 0.01, 3.44, { faces: 4, tu: 1.6, col: [1, 1, 1] });
    this.B('wall').box(0, y + H - 0.01, 0, 10.5, y + H, 12, { faces: 8, su: 2, col: [1, 1, 1] }); // 천장
    // 외벽 (바깥: 벽돌톤 미장, 안: 벽지)
    const ext = (axis, a0, a1, t0, t1, holes) => { this.wall(axis, a0, a1, t0, t1, y - 0.25, y + H + 0.25, holes.map(h => [h[0], h[1], y + h[2], y + h[3]]), 'plaster', { su: 3, col: [0.62, 0.4, 0.32] }); };
    const inn = (axis, a0, a1, t0, t1, holes) => { this.wall(axis, a0, a1, t0, t1, y, y + H, holes.map(h => [h[0], h[1], y + h[2], y + h[3]]), 'wall', { su: 2, col: wc }); };
    ext('x', 0, 10.5, 0, 0.1, [[6, 7.6, 1, 2.1]]); inn('x', 0.1, 10.3, 0.1, 0.2, [[6, 7.6, 1, 2.1]]);
    ext('x', 0, 10.5, 11.9, 12, [[1, 3.4, 0.9, 2.2], [5, 8.2, 0.3, 2.3]]); inn('x', 0.1, 10.3, 11.8, 11.9, [[1, 3.4, 0.9, 2.2], [5, 8.2, 0.3, 2.3]]);
    ext('z', 0, 12, 0, 0.1, []); inn('z', 0.1, 11.9, 0.1, 0.2, []);
    inn('z', 0.2, 11.8, 10.2, 10.3, [[10.4, 11.4, 0, 2.1]]);
    for (const [x0, x1, z0, z1] of [[6, 7.6, 0.08, 0.12], [1, 3.4, 11.88, 11.92], [5, 8.2, 11.88, 11.92]]) { this.B('glass').box(x0, y + 0.3, z0, x1, y + 2.3, z1, { faces: 16 | 32 }); this.cb(x0, y, z0 - 0.05, x1, y + 2.4, z1 + 0.05, { glass: true }); }
    // 창틀
    for (const [x0, x1, z, y0, y1] of [[1, 3.4, 11.9, 0.9, 2.2], [5, 8.2, 11.9, 0.3, 2.3], [6, 7.6, 0.1, 1, 2.1]]) { this.B('plastic').box(x0, y + y0 - 0.05, z - 0.08, x1, y + y0, z + 0.08, { col: [0.95, 0.95, 0.95] }); this.B('plastic').box((x0 + x1) / 2 - 0.03, y + y0, z - 0.04, (x0 + x1) / 2 + 0.03, y + y1, z + 0.04, { col: [0.95, 0.95, 0.95] }); }
    // 내벽
    inn('z', 0.2, 11.8, 3.94, 4.06, [[2.4, 3.2, 0, 2.1], [4.6, 5.4, 0, 2.1], [7.2, 8.1, 0, 2.1]]);
    inn('x', 0.2, 3.94, 3.44, 3.56, []); inn('x', 0.2, 3.94, 6.44, 6.56, []);
    this.B('tile').box(0.2, y, 0.2, 0.21, y + H, 3.44, { faces: 1, su: 1.6, col: [1, 1, 1] }); this.B('tile').box(0.2, y, 0.2, 3.93, y + H, 0.21, { faces: 16, su: 1.6, col: [1, 1, 1] });
    // 가구
    const F = (k, x0, y0, z0, x1, y1, z1, col, collide = true, o = {}) => this.solid(k, x0, y + y0, z0, x1, y + y1, z1, { col, su: 1, ...o }, collide);
    F('wood', 0.25, 0, 9.2, 2.35, 0.32, 10.9, [0.6, 0.45, 0.32]);
    F('fabric', 0.3, 0.32, 9.25, 2.3, 0.5, 10.85, [0.93, 0.93, 0.92], false);
    this.blanket = new MB().box(0.85, y + 0.5, 9.2, 2.38, y + 0.58, 10.92, { col: [0.45, 0.55, 0.68] });
    F('fabric', 0.35, 0.5, 9.4, 0.8, 0.62, 10.7, [0.97, 0.97, 0.97], false);
    F('wood', 0.25, 0, 10.95, 0.75, 0.5, 11.55, [0.55, 0.4, 0.28]);
    F('wood', 0.25, 0, 6.7, 0.85, 2.1, 8.7, [0.85, 0.8, 0.72]);
    F('fabric', 5.3, 0, 9.6, 8.5, 0.45, 10.5, [0.42, 0.38, 0.34]); F('fabric', 5.3, 0.45, 10.25, 8.5, 0.85, 10.55, [0.4, 0.36, 0.32]); F('fabric', 5.2, 0, 9.6, 5.4, 0.62, 10.55, [0.4, 0.36, 0.32]); F('fabric', 8.4, 0, 9.6, 8.6, 0.62, 10.55, [0.4, 0.36, 0.32]);
    F('wood', 6.2, 0, 7.6, 7.6, 0.42, 8.4, [0.5, 0.36, 0.25]);
    F('wood', 5.9, 0, 4.7, 8.1, 0.5, 5.15, [0.3, 0.25, 0.2]);
    F('plastic', 6.3, 0.55, 4.95, 7.7, 1.38, 5.05, [0.04, 0.04, 0.045]);
    // 주방
    F('wood', 4.3, 0, 0.2, 9.2, 0.88, 0.8, [0.9, 0.9, 0.88]); F('plastic', 4.3, 0.88, 0.2, 9.2, 0.92, 0.82, [0.95, 0.95, 0.95]);
    F('steel', 6.4, 0.9, 0.3, 7.2, 0.925, 0.7, [0.3, 0.3, 0.32], false);
    F('steel', 6.75, 0.92, 0.25, 6.85, 1.2, 0.32, [0.75, 0.75, 0.78], false);
    F('wood', 4.3, 1.5, 0.2, 9.2, 2.2, 0.55, [0.9, 0.9, 0.88]);
    F('steel', 9.4, 0, 0.25, 10.25, 1.85, 1.0, [0.78, 0.79, 0.8]);
    F('wood', 6.0, 0.72, 2.2, 7.6, 0.76, 3.2, [0.6, 0.45, 0.3]); for (const [a, b] of [[6.05, 2.25], [7.5, 2.25], [6.05, 3.1], [7.5, 3.1]]) F('wood', a, 0, b, a + 0.05, 0.72, b + 0.05, [0.5, 0.38, 0.26], false);
    this.cb(6.0, y, 2.2, 7.6, y + 0.76, 3.2);
    // 욕실
    F('plastic', 0.25, 0, 0.25, 2.05, 0.55, 1.05, [0.97, 0.97, 0.97]); F('plastic', 3.2, 0, 0.3, 3.7, 0.42, 0.85, [0.97, 0.97, 0.97]); F('plastic', 0.3, 0.75, 2.0, 0.75, 0.9, 2.6, [0.97, 0.97, 0.97]);
    F('steel', 0.95, 0.55, 0.26, 1.05, 0.75, 0.35, [0.8, 0.8, 0.82], false);
    // 다용도실
    F('steel', 0.25, 0, 3.8, 0.75, 1.8, 6.2, [0.5, 0.5, 0.52]); for (const h of [0.4, 0.8, 1.2, 1.6]) F('steel', 0.25, h, 3.8, 0.75, h + 0.03, 6.2, [0.6, 0.6, 0.62], false);
    F('plastic', 2.6, 0, 3.7, 3.4, 0.85, 4.4, [0.92, 0.92, 0.93]);
    // 현관 신발장(바리케이드용, 별도 메시)
    this.cabinetBox = this.cb(9.75, y, 8.6, 10.25, y + 1.1, 10.2);
    this.cabinet = new MB().box(0, 0, 0, 0.5, 1.1, 1.6, { col: [0.8, 0.74, 0.62] }).mesh(this.mats.wood); this.cabinet.position.set(9.75, y, 8.6); this.group.add(this.cabinet);
    this.add_blanket = this.blanket.mesh(this.mats.fabric); this.group.add(this.add_blanket);
  }
  props() {
    const g = this.game, y = PF * FH, G = this.group;
    // 현관문 (밖으로 열림)
    const pivot = new THREE.Group(); pivot.position.set(10.4, y, 11.4); G.add(pivot);
    const dm = new MB().box(-0.05, 0, -1.0, 0.05, 2.08, 0, { col: [0.38, 0.33, 0.3] }).box(0.05, 1.0, -0.85, 0.1, 1.05, -0.75, { col: [0.8, 0.8, 0.8] }).mesh(this.mats.steel); pivot.add(dm);
    const box = this.cb(10.3, y, 10.4, 10.5, y + 2.1, 11.4);
    this.door = new Door(g, box, pivot, this.w(10.4, y + 1, 10.9));
    // TV
    this.tv = dynTex(512, 288); this.tvState = 'off';
    const tvm = new THREE.MeshStandardMaterial({ map: this.tv.t, emissiveMap: this.tv.t, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.76), tvm); scr.position.set(7.0, y + 0.965, 5.052); G.add(scr); this.tvMat = tvm;
    this.drawTV(0);
    // 폰 (침대 옆 협탁)
    this.phoneTex = dynTex(360, 740); this.drawPhone();
    const ph = new THREE.Group();
    ph.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.155, 0.009), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.6 })));
    const pscr = new THREE.Mesh(new THREE.PlaneGeometry(0.069, 0.148), new THREE.MeshBasicMaterial({ map: this.phoneTex.t, toneMapped: false })); pscr.position.z = 0.0051; ph.add(pscr);
    ph.position.set(0.5, y + 0.506, 11.25); ph.rotation.x = -Math.PI / 2; G.add(ph); this.phone = ph; this.phoneRest = { p: ph.position.clone(), r: ph.rotation.clone() };
    // 커튼
    const mkC = (x0, x1, y0, y1, z) => {
      const halves = [];
      for (const s of [0, 1]) {
        const w = (x1 - x0) / 2 + 0.15, geo = new THREE.PlaneGeometry(w, y1 - y0 + 0.3, 24, 1), p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 22) * 0.04);
        geo.computeVertexNormals(); geo.translate(s ? -w / 2 : w / 2, 0, 0);
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: T.curtain.map, normalMap: T.curtain.normalMap, color: 0xd8cbb0, roughness: 0.95, side: THREE.DoubleSide }));
        m.position.set(s ? x1 + 0.15 : x0 - 0.15, y + (y0 + y1) / 2 + 0.1, z); m.castShadow = true; G.add(m); halves.push(m);
      }
      return { halves, open: false, k: 0, target: 0 };
    };
    this.curtBed = mkC(1, 3.4, 0.9, 2.2, 11.72); this.curtLiv = mkC(5, 8.2, 0.3, 2.3, 11.72);
    // 욕조 물
    this.tubWater = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.66), new THREE.MeshStandardMaterial({ color: 0x9cc6d0, roughness: 0.05, transparent: true, opacity: 0.55 }));
    this.tubWater.rotation.x = -Math.PI / 2; this.tubWater.position.set(1.15, y + 0.06, 0.65); this.tubWater.visible = false; G.add(this.tubWater); this.tubFill = 0;
    // 실내 보조광(창문 반사광 근사 / 고정 개수)
    this.fill1 = new THREE.PointLight(0xfff1dd, 0, 9, 1.6); this.fill1.position.set(BX + 6.5, this.Y0 + y + 2.3, BZ + 8); g.scene.add(this.fill1);
    this.fill2 = new THREE.PointLight(0xfff1dd, 0, 7, 1.6); this.fill2.position.set(BX + 2, this.Y0 + y + 2.3, BZ + 6); g.scene.add(this.fill2);
    this.items();
  }
  items() {
    const g = this.game, y = PF * FH, I = (o) => { o.owner = 'home'; const r = g.inter.add(o); this.inter.push(r); return r; };
    const ev = (n) => g.emit('task', n);
    this.iPhone = I({ pos: this.w(0.5, y + 0.6, 11.25), label: '휴대폰 보기', cond: () => false });
    let tubSnd = null;
    I({ pos: this.w(1.0, y + 0.7, 0.5), r: 1.9, label: () => this.tubFill >= 1 ? '욕조 (물 가득)' : '욕조에 물 받기', hold: 4, cond: () => this.tubFill < 1,
      onHold: (k) => { if (!tubSnd) tubSnd = g.audio.loop('water', { pos: this.w(1.0, y + 0.7, 0.4), vol: 0.9 }); this.tubWater.visible = true; this.tubFill = Math.max(this.tubFill, k); this.tubWater.position.y = y + 0.06 + k * 0.4; },
      onRelease: () => { if (tubSnd) { tubSnd.stop(); tubSnd = null; } },
      act: () => { this.tubFill = 1; if (tubSnd) { tubSnd.stop(); tubSnd = null; } ev('water_tub'); g.player.hopeAdd(5); g.ui.notify('욕조에 물을 받아 두었다 (비상용수)'); } });
    let sinkSnd = null, bottles = false;
    I({ pos: this.w(6.8, y + 1.0, 0.5), label: '페트병에 물 담기', hold: 3, cond: () => !bottles,
      onHold: () => { if (!sinkSnd) sinkSnd = g.audio.loop('water', { pos: this.w(6.8, y + 1, 0.4), vol: 0.6 }); }, onRelease: () => { if (sinkSnd) { sinkSnd.stop(); sinkSnd = null; } },
      act: () => { bottles = true; if (sinkSnd) { sinkSnd.stop(); sinkSnd = null; } g.player.give('water', 3); ev('water_bottles'); } });
    let fr = false, cu = false;
    I({ pos: this.w(9.8, y + 1.2, 1.1), label: '냉장고 뒤지기', hold: 1.5, cond: () => !fr, act: () => { fr = true; g.audio.play('rummage'); g.player.give('water', 1); g.player.give('kimbap', 1); g.player.give('juice', 1); ev('food_fridge'); } });
    I({ pos: this.w(5.2, y + 0.6, 0.9), label: '찬장 뒤지기', hold: 1.5, cond: () => !cu, act: () => { cu = true; g.audio.play('rummage'); g.player.give('ramen', 3); g.player.give('can', 2); g.player.give('rice', 1); ev('food_cupboard'); } });
    this.knife = this.prop(new THREE.BoxGeometry(0.03, 0.01, 0.3), 0xcccccc, 8.5, y + 0.93, 0.5, 0.8);
    I({ pos: this.w(8.5, y + 1.0, 0.5), label: '식칼 챙기기', cond: () => this.knife.visible, act: () => { this.knife.visible = false; g.player.give('knife'); g.audio.play('pickup'); } });
    // 현관
    I({ pos: this.w(10.1, y + 1.1, 10.9), r: 1.8, label: () => this.door.broken ? '부서진 문' : this.door.barricade ? '(신발장으로 막혀 있음)' : this.door.locked ? '잠금 해제' : this.door.closed ? '문 잠그기 / 길게: 열기' : '문 닫기',
      hold: 0, cond: () => !this.door.broken,
      act: (long) => { const d = this.door; if (d.barricade) return; if (!d.closed) { d.toggle(); return; } if (d.locked) { d.locked = false; g.audio.play('lock', { pos: d.center }); return; } if (long) d.toggle(); else { d.locked = true; g.audio.play('lock', { pos: d.center }); ev('door_lock'); } } });
    I({ pos: this.w(10.0, y + 0.8, 9.4), label: () => this.door.barricade ? '바리케이드 치우기' : '신발장으로 현관 막기', hold: 3,
      cond: () => !this.door.broken && (this.door.closed || this.door.barricade),
      onHold: () => { if (!this._drag) { this._drag = true; g.audio.play('drag', { pos: this.door.center }); } }, onRelease: () => this._drag = false,
      act: () => { this._drag = false; const d = this.door; d.barricade = !d.barricade; this.cabMove = d.barricade ? 1 : 0; ev(d.barricade ? 'barricade' : 'unbarricade'); g.zombies.noise(d.center, 12); } });
    // TV/커튼
    I({ pos: this.w(7.0, y + 1.0, 5.3), r: 2.4, label: () => this.tvState === 'off' ? 'TV 켜기' : 'TV 끄기', act: () => { this.setTV(this.tvState === 'off' ? 'news' : 'off'); if (this.tvState === 'off') ev('tv_off'); } });
    const curtI = (c, x, name) => I({ pos: this.w(x, y + 1.4, 11.55), r: 1.8, label: () => c.open ? '커튼 치기' : '커튼 걷기', act: () => { this.setCurtain(c, !c.open); if (!c.open) ev(name); } });
    curtI(this.curtLiv, 6.6, 'curtain_living'); curtI(this.curtBed, 2.2, 'curtain_bed');
    // 다용도실
    this.fl = this.prop(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 10).rotateZ(Math.PI / 2), 0x222222, 0.5, y + 1.23, 4.3);
    this.mk = this.prop(new THREE.BoxGeometry(0.3, 0.14, 0.2), 0xd03030, 0.5, y + 1.27, 5.1);
    this.rd = this.prop(new THREE.BoxGeometry(0.24, 0.14, 0.08), 0x333333, 0.5, y + 0.9, 5.8);
    this.bat = this.prop(new THREE.CylinderGeometry(0.035, 0.018, 0.85, 10), 0x9a6a3a, 3.55, y + 0.43, 3.75); this.bat.rotation.z = 0.15;
    I({ pos: this.w(0.5, y + 1.25, 4.3), label: '손전등 챙기기', cond: () => this.fl.visible, act: () => { this.fl.visible = false; g.player.give('flashlight'); g.audio.play('pickup'); ev('pick_flashlight'); } });
    I({ pos: this.w(0.5, y + 1.25, 5.1), label: '구급상자 챙기기', cond: () => this.mk.visible, act: () => { this.mk.visible = false; g.player.give('medkit'); g.player.give('bandage', 2); g.player.give('pills', 1); g.audio.play('pickup'); ev('pick_medkit'); } });
    I({ pos: this.w(0.5, y + 0.95, 5.8), label: '라디오 켜기', hold: 1, cond: () => this.rd.visible, act: () => { this.rd.visible = false; g.player.give('radio'); g.audio.play('click'); ev('radio'); } });
    I({ pos: this.w(3.5, y + 0.6, 3.8), label: '야구방망이 챙기기', cond: () => this.bat.visible, act: () => { this.bat.visible = false; g.player.give('bat'); g.audio.play('pickup'); ev('pick_bat'); } });
  }
  prop(geo, col, x, y, z, rot = 0) { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.2 })); m.position.set(x, y, z); m.rotation.y = rot; m.castShadow = true; this.group.add(m); return m; }
  setCurtain(c, open, silent) { c.open = open; c.target = open ? 1 : 0; if (!silent) this.game.audio.play('curtain', { pos: c.halves[0].getWorldPosition(new THREE.Vector3()), inside: true }); }
  setTV(s) {
    const was = this.tvState; this.tvState = s;
    if (s !== 'off' && was === 'off') this.game.audio.play('tvOn', { pos: this.w(7, PF * FH + 1, 5.2), inside: true });
    if (s === 'off') { this.drawTV(0); if (this.tvSnd) { this.tvSnd.stop(); this.tvSnd = null; } }
    else if (!this.tvSnd) this.tvSnd = this.game.audio.loop('tv', { pos: this.w(7, PF * FH + 1, 5.2), vol: s === 'static' ? 0.8 : 0.12, inside: true });
    if (this.tvSnd) this.tvSnd.vol(s === 'static' ? 0.8 : 0.1);
  }
  drawTV(t) {
    const { ctx: x, t: tex } = this.tv, W = 512, H = 288, s = this.tvState;
    this.tvMat.emissiveIntensity = s === 'off' ? 0 : 1.1;
    if (s === 'off') { x.fillStyle = '#050607'; x.fillRect(0, 0, W, H); tex.needsUpdate = true; return; }
    if (s === 'static') { const img = x.createImageData(W / 4, H / 4); for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } x.putImageData(img, 0, 0); x.drawImage(x.canvas, 0, 0, W / 4, H / 4, 0, 0, W, H); tex.needsUpdate = true; return; }
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0c2348'); g.addColorStop(1, '#04101f'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    // 현장 화면
    x.fillStyle = '#222'; x.fillRect(250, 34, 240, 150);
    for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(${150 + Math.random() * 100},${60 + Math.random() * 40},30,${Math.random() * 0.5})`; x.fillRect(250 + Math.random() * 240, 34 + 90 + Math.random() * 60, 6 + Math.random() * 20, 4 + Math.random() * 14); }
    x.fillStyle = 'rgba(40,40,45,.9)'; for (let i = 0; i < 6; i++) x.fillRect(260 + i * 38, 70 + (i % 3) * 10, 28, 120);
    for (let i = 0; i < 9; i++) { const px = 250 + ((i * 53 + t * 40 * (i % 2 ? 1 : -0.7)) % 240 + 240) % 240; x.fillStyle = '#111'; x.fillRect(px, 150, 5, 16); x.beginPath(); x.arc(px + 2.5, 147, 3, 0, 7); x.fill(); }
    if ((t * 2 | 0) % 2) { x.fillStyle = 'rgba(255,0,0,.25)'; x.fillRect(250, 34, 240, 150); }
    x.fillStyle = '#fff'; x.font = 'bold 12px sans-serif'; x.fillText('LIVE  서울 종로구 현장', 258, 50);
    // 앵커
    x.fillStyle = '#1b2433'; x.beginPath(); x.moveTo(40, 240); x.quadraticCurveTo(120, 150, 200, 240); x.fill();
    x.fillStyle = '#e8c9b0'; x.beginPath(); x.ellipse(120, 128, 30, 37, 0, 0, 7); x.fill();
    x.fillStyle = '#1a1210'; x.beginPath(); x.ellipse(120, 112, 33, 30, 0, Math.PI, 0); x.fill(); x.fillRect(87, 110, 12, 48); x.fillRect(141, 110, 12, 48);
    x.fillStyle = '#fff'; x.fillRect(112, 166, 16, 12);
    const m = Math.abs(Math.sin(t * 11)) * 4; x.fillStyle = '#8a4a44'; x.fillRect(113, 143, 14, 2 + m);
    // 자막 바
    x.fillStyle = '#c4161c'; x.fillRect(0, 196, 92, 36); x.fillStyle = '#fff'; x.font = 'bold 22px sans-serif'; x.fillText('속보', 22, 222);
    x.fillStyle = '#f4f4f4'; x.fillRect(92, 196, W - 92, 36); x.fillStyle = '#111'; x.font = 'bold 19px sans-serif'; x.fillText('서울 전역 원인불명 감염 확산… "외출 자제"', 104, 221);
    x.fillStyle = '#0b1830'; x.fillRect(0, 232, W, 26);
    x.fillStyle = '#ffd23f'; x.font = '14px sans-serif'; const tk = '■ 정부, 서울 전역 위기경보 "심각" 격상  ■ 지하철 전 노선 운행 중단  ■ 한강 교량 통제  ■ 감염자는 물어뜯는 공격성 보여  ■ 시민 여러분은 문을 잠그고 창문에서 멀리 떨어지십시오  ';
    const off = (t * 70) % 900; x.fillText(tk + tk, 10 - off, 250);
    x.fillStyle = '#fff'; x.font = 'bold 16px sans-serif'; x.fillText('뉴스24', 14, 26); x.font = '12px sans-serif'; x.fillText(this.game.clock.short(), 440, 26);
    tex.needsUpdate = true;
  }
  drawPhone(lit = true) {
    const { ctx: x, t } = this.phoneTex, W = 360, H = 740;
    x.fillStyle = lit ? '#101418' : '#000'; x.fillRect(0, 0, W, H); if (!lit) { t.needsUpdate = true; return; }
    x.fillStyle = '#fff'; x.font = '600 20px sans-serif'; x.fillText('08:00', 24, 38); x.fillText('▮▮▮ 5G  71%', 220, 38);
    x.fillStyle = '#2a2f36'; this.rr(x, 16, 80, W - 32, 470, 22); x.fill();
    x.fillStyle = '#e03131'; this.rr(x, 16, 80, W - 32, 64, 22); x.fill(); x.fillRect(16, 120, W - 32, 24);
    x.fillStyle = '#fff'; x.font = 'bold 26px sans-serif'; x.fillText('⚠ 긴급재난문자', 34, 122);
    x.font = '17px sans-serif'; x.fillStyle = '#c9d1d9'; x.fillText('위급재난문자 · 오전 7:58', 34, 176);
    x.fillStyle = '#fff'; x.font = '21px sans-serif';
    const lines = ['[재난안전대책본부] 오늘 07:42', '서울 전역에서 원인 불명의', '공격성 감염 확산. 감염자에게', '물리면 감염됨. 시민께서는', '외출을 삼가고 문을 잠근 채', '실내에 머물러 주시기', '바랍니다. 창문에서 멀리', '떨어지고 소리를 내지 마십시오.', '추가 안내는 TV·라디오 참고.'];
    lines.forEach((l, i) => x.fillText(l, 34, 220 + i * 33));
    x.fillStyle = '#3b82f6'; this.rr(x, 34, 600, W - 68, 56, 28); x.fill(); x.fillStyle = '#fff'; x.font = 'bold 22px sans-serif'; x.fillText('확인', W / 2 - 22, 636);
    t.needsUpdate = true;
  }
  rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  // 앞마당 (블록 특수 처리: 일반 건물 대신)
  yard(c, r) {
    for (let x = r.x0 + 2; x < r.x1; x += 9) c.tree('ginkgo', x, r.top, r.z1 - 1, 0.85, x);
    c.B('concrete').box(BX - 2, r.top, BZ + 12, BX + 26, r.top + 0.02, r.z1 - 2, { faces: 4, su: 3, col: [0.55, 0.55, 0.55] });
    for (const x of [31.6, 33.6, 37.1, 46.0, 51.2]) if (c.R() < 0.75) this.game.world.addCar(c, x, BZ + 3, c.R() < 0.5 ? 0 : Math.PI, c.R);
  }
  makeNav() {
    const nodes = [], add = (x, yy, z) => { nodes.push({ p: this.w(x, yy, z), l: [] }); return nodes.length - 1; }, link = (a, b) => { nodes[a].l.push(b); nodes[b].l.push(a); };
    const E0 = add(12, 0, 16), E1 = add(12, 0, 11.3); link(E0, E1);
    const Ls = [], Rs = [];
    for (let f = 0; f <= 6; f++) { Ls[f] = add(11.25, f * FH, 10.9); Rs[f] = add(12.75, f * FH, 10.9); link(Ls[f], Rs[f]); }
    link(E1, Ls[0]); link(E1, Rs[0]);
    for (let f = 0; f < 6; f++) {
      const y = f * FH, A = add(11.25, y + 0.2, 9.7), B = add(11.25, y + 1.5, 7.2), M = add(12, y + 1.5, 6.6), C = add(12.75, y + 1.5, 7.2), D = add(12.75, y + 2.8, 9.8);
      link(Ls[f], A); link(A, B); link(B, M); link(M, C); link(C, D); link(D, Rs[f + 1]);
    }
    const y = PF * FH, DO = add(11.0, y, 10.9), DI = add(9.6, y, 10.9); link(Ls[PF], DO); link(DO, DI);
    const LV = add(7, y, 8.6), KT = add(7, y, 1.8), BRD = add(4, y, 7.65), BR = add(2, y, 8.2), UTD = add(4, y, 5), UT = add(2, y, 5), BTD = add(4, y, 2.8), BT = add(2, y, 2);
    link(DI, LV); link(LV, KT); link(LV, BRD); link(BRD, BR); link(LV, UTD); link(UTD, UT); link(KT, BTD); link(BTD, BT);
    const RF = add(6, 18, 6); link(Ls[6], RF);
    const Y0 = this.Y0;
    return {
      nodes,
      inside: (p) => { const lx = p.x - BX, lz = p.z - BZ, ly = p.y - Y0; return lx > -0.3 && lx < 24.3 && lz > -0.3 && lz < 12.3 && (ly > 0.8 || (lx > 10.3 && lx < 13.7 && lz > 5.5)); },
      near: (p, inside) => { if (!inside) return E0; let b = 0, bd = 1e9; nodes.forEach((n, i) => { const dy = Math.abs(n.p.y - p.y); if (dy > 1.4) return; const d = Math.hypot(n.p.x - p.x, n.p.z - p.z) + dy * 2; if (d < bd) { bd = d; b = i; } }); return b; },
      path(from, to) {
        const a = this.near(from, this.inside(from)), b = this.near(to, this.inside(to));
        const prev = new Map([[a, -1]]), q = [a];
        while (q.length) { const n = q.shift(); if (n === b) break; for (const m of nodes[n].l) if (!prev.has(m)) { prev.set(m, n); q.push(m); } }
        if (!prev.has(b)) return [to.clone()];
        const out = []; for (let n = b; n !== -1; n = prev.get(n)) out.unshift(nodes[n].p.clone());
        out.push(to.clone()); return out;
      }
    };
  }
  update(dt, t) {
    this.door.update(dt);
    for (const c of [this.curtBed, this.curtLiv]) {
      c.k += (c.target - c.k) * Math.min(1, dt * 3);
      const [L, R] = c.halves; L.scale.x = R.scale.x = 1 - c.k * 0.78;
    }
    if (this.cabMove !== undefined) { const tz = this.cabMove ? 10.35 : 8.6; this.cabinet.position.z += (tz - this.cabinet.position.z) * Math.min(1, dt * 1.5); const z = this.cabinet.position.z; const b = this.cabinetBox; b.z0 = BZ + z; b.z1 = BZ + z + 1.6; }
    if (this.tvState !== 'off') { this._tvT = (this._tvT || 0) + dt; if (this._tvT > 0.08) { this._tvT = 0; this.drawTV(t); } }
    const day = this.game.sky.dayF, open = Math.max(this.curtLiv.k, this.curtBed.k * 0.6);
    const near = this.game.player.pos.distanceTo(this.fill1.position) < 30;
    this.fill1.intensity = near ? (day * (0.4 + open * 1.6) + (this.tvState !== 'off' ? 0.6 : 0)) : 0;
    this.fill2.intensity = near ? day * (0.25 + this.curtBed.k * 1.0) : 0;
    const P = this.game.player.pos;
    if (!this.inUnit(P) && this.inBuilding(P)) { this.fill1.position.set(P.x, P.y + 2.2, P.z); this.fill1.intensity = 0.35 + day * 0.9; }
    else this.fill1.position.set(BX + 6.5, this.Y0 + PF * FH + 2.3, BZ + 8);
    this.group.visible = this.game.player.pos.distanceTo(this.fill1.position) < 2500;
  }
  // 플레이어가 집(우리 세대) 안?
  inUnit(p) { const lx = p.x - BX, lz = p.z - BZ, ly = p.y - this.Y0 - PF * FH; return lx > 0 && lx < 10.3 && lz > 0 && lz < 12 && ly > -0.5 && ly < 2.8; }
  inBuilding(p) { return this.nav.inside(p); }
}

// 대피소: 새빛초등학교 (청크 1,2 블록 1,1)
export function registerShelter(game) {
  const key = '1,2,1,1';
  game.world.special.set(key, (c, r) => {
    const B = c.B, W = game.world, R = c.R, ox = c.ox, oz = c.oz, top = r.top;
    // 운동장(흙)
    B('concrete').box(r.x0, top, r.z0, r.x1, top + 0.03, r.z1, { faces: 4, su: 4, topCol: [0.62, 0.5, 0.38] });
    // 교사(4층)
    W.facade(c, 'apt', r.x0 + 2, top, r.z0 + 2, r.x1 - 2, top + 13, r.z0 + 14, 16, 12, R);
    B('concrete').quad([r.x0 + 20, top + 10.5, r.z0 + 14.02], [r.x1 - 20, top + 10.5, r.z0 + 14.02], [r.x1 - 20, top + 12.3, r.z0 + 14.02], [r.x0 + 20, top + 12.3, r.z0 + 14.02], [0, 0, 1], undefined, [0.2, 0.3, 0.5]);
    // 군 천막 + 모래주머니 + 철조망
    const tents = [[r.x0 + 10, r.z0 + 30], [r.x0 + 24, r.z0 + 30], [r.x0 + 38, r.z0 + 30], [r.x0 + 17, r.z0 + 44]];
    for (const [x, z] of tents) {
      B('concrete').box(x - 4, top, z - 3, x + 4, top + 2, z + 3, { su: 4, col: [0.26, 0.3, 0.2] });
      B('concrete').quad([x - 4.2, top + 2, z + 3.1], [x + 4.2, top + 2, z + 3.1], [x + 4.2, top + 3.2, z], [x - 4.2, top + 3.2, z], [0, 0.9, 0.4], undefined, [0.24, 0.28, 0.18]);
      B('concrete').quad([x + 4.2, top + 2, z - 3.1], [x - 4.2, top + 2, z - 3.1], [x - 4.2, top + 3.2, z], [x + 4.2, top + 3.2, z], [0, 0.9, -0.4], undefined, [0.24, 0.28, 0.18]);
      game.col.box(ox + x - 4, top, oz + z - 3, ox + x + 4, top + 2.2, oz + z + 3, c.owner);
    }
    for (let x = r.x0; x < r.x1; x += 1.2) { B('concrete').box(x, top, r.z1 - 1.2, x + 1.1, top + 0.9, r.z1 - 0.4, { su: 1, col: [0.55, 0.5, 0.38] }); }
    game.col.box(ox + r.x0, top, oz + r.z1 - 1.2, ox + (r.x0 + r.x1) / 2 - 3, top + 0.9, oz + r.z1 - 0.4, c.owner);
    game.col.box(ox + (r.x0 + r.x1) / 2 + 3, top, oz + r.z1 - 1.2, ox + r.x1, top + 0.9, oz + r.z1 - 0.4, c.owner);
    for (let k = 0; k < 6; k++) { c.corpses.push([lerp(r.x0 + 5, r.x1 - 5, R()), lerp(r.z0 + 22, r.z1 - 6, R()), R() * 6]); }
    W.addCar(c, r.x1 - 8, r.z0 + 24, 0.3, R);
    c.items.push({ id: 'shelter_rifle', type: 'rifle', x: ox + r.x0 + 24, y: top + 0.05, z: oz + r.z0 + 35 });
    for (let k = 0; k < 4; k++) { const bx = r.x0 + 12 + k * 7, bz = r.z0 + 36; B('concrete').box(bx - 0.5, top, bz - 0.35, bx + 0.5, top + 0.55, bz + 0.35, { su: 1, col: [0.26, 0.3, 0.2] }); game.col.box(ox + bx - 0.5, top, oz + bz - 0.35, ox + bx + 0.5, top + 0.55, oz + bz + 0.35, c.owner); game.loot.add({ id: 'shelter_crate' + k, table: 'military', name: '대피소 보급 상자', pos: new THREE.Vector3(ox + bx, top + 0.8, oz + bz), owner: c.owner }); }
    game.fx.addFire(new THREE.Vector3(ox + r.x0 + 38, top, oz + r.z0 + 30), c.owner, true);
    game.shelterPos = new THREE.Vector3(ox + (r.x0 + r.x1) / 2, top, oz + r.z0 + 36);
  });
  game.shelterPos = new THREE.Vector3(240 + 120, 0, 480 + 120);
}
