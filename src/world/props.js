// FREE FREELY - 월드 구조물 (공항, 도시, 숲, 항공모함, 체크포인트, 풍력발전)
import * as THREE from 'three';
import { clamp, lerp, rand, randInt, makeRng, TAU } from '../core/utils.js';
import { RUNWAY } from './terrain.js';
import { makeGlowTexture } from './sky.js';

function makeRunwayTexture(w = 2048, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // 아스팔트 바탕 + 노이즈
  ctx.fillStyle = '#2b2d30';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 24000; i++) {
    const g = 30 + Math.random() * 40;
    ctx.fillStyle = `rgba(${g},${g},${g + 3},${Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  // 이음새
  ctx.strokeStyle = 'rgba(20,20,22,0.55)';
  ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  // 가장자리선
  ctx.fillStyle = '#e8e8e4';
  ctx.fillRect(0, 12, w, 6);
  ctx.fillRect(0, h - 18, w, 6);
  // 중앙 파선
  for (let x = 40; x < w - 40; x += 96) ctx.fillRect(x, h / 2 - 4, 56, 8);
  // 접지구역 표시
  for (const bx of [110, w - 250]) {
    for (let i = 0; i < 6; i++) {
      const y = 34 + i * 32;
      if (i === 2 || i === 3) continue;
      ctx.fillRect(bx, y, 90, 14);
    }
  }
  // 임계선(문턱)
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(24, 30 + i * 26, 56, 16);
    ctx.fillRect(w - 80, 30 + i * 26, 56, 16);
  }
  // 활주로 번호
  ctx.save();
  ctx.fillStyle = '#f2f2ee';
  ctx.font = 'bold 92px monospace';
  ctx.textAlign = 'center';
  ctx.translate(220, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('09', 0, 32);
  ctx.restore();
  ctx.save();
  ctx.translate(w - 220, h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#f2f2ee';
  ctx.font = 'bold 92px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('27', 0, 32);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeWindowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3c4149';
  ctx.fillRect(0, 0, size, size);
  const cols = 8, rows = 10;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = Math.random() < 0.45;
      ctx.fillStyle = lit ? `rgba(255,${200 + Math.random() * 55},${150 + Math.random() * 60},0.95)` : 'rgba(20,24,30,0.9)';
      ctx.fillRect(4 + x * (size / cols), 6 + y * (size / rows), size / cols - 6, size / rows - 7);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Props {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'props';
    scene.add(this.group);
    this.colliders = [];       // {pos:Vector3, radius, type, hardness}
    this.animated = [];
    this.rng = makeRng(4242);
    this.lights = [];          // 야간 점등 대상
    this.rings = [];
    this.carrier = null;
    this._build();
  }

  _addCollider(pos, radius, type = 'building', hardness = 1) {
    this.colliders.push({ pos: pos.clone(), radius, type, hardness });
  }

  _build() {
    this._buildAirport();
    this._buildCity();
    this._buildForest();
    this._buildTurbines();
    this._buildCarrier();
    this._buildRings();
    this._buildBalloonFestival();
    this._buildSpacePad();
  }

  /* ------------------------------- 공항 ------------------------------- */
  _buildAirport() {
    const t = this.terrain;
    const y = RUNWAY.height;
    const len = RUNWAY.x1 - RUNWAY.x0;
    const wid = RUNWAY.z1 - RUNWAY.z0;

    const runway = new THREE.Mesh(
      new THREE.PlaneGeometry(len, wid),
      new THREE.MeshStandardMaterial({ map: makeRunwayTexture(), roughness: 0.92, metalness: 0.02 })
    );
    runway.rotation.x = -Math.PI / 2;
    runway.position.set((RUNWAY.x0 + RUNWAY.x1) / 2, y + 0.06, (RUNWAY.z0 + RUNWAY.z1) / 2);
    runway.receiveShadow = true;
    this.group.add(runway);

    // 유도로 + 계류장
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 240),
      new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.95 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(-360, y + 0.04, 170);
    apron.receiveShadow = true;
    this.group.add(apron);

    // 관제탑
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.6, metalness: 0.15 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 46, 16), towerMat);
    tower.position.set(-520, y + 23, 210);
    tower.castShadow = tower.receiveShadow = true;
    this.group.add(tower);
    const cab = new THREE.Mesh(
      new THREE.CylinderGeometry(13, 11, 12, 16),
      new THREE.MeshPhysicalMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.72, envMapIntensity: 1.4 })
    );
    cab.position.set(-520, y + 50, 210);
    cab.castShadow = true;
    this.group.add(cab);
    this._addCollider(new THREE.Vector3(-520, y + 30, 210), 16, 'tower', 1.2);

    // 격납고 3동
    for (let i = 0; i < 3; i++) {
      const hx = -180 + i * 170;
      const hangar = new THREE.Group();
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(34, 34, 90, 18, 1, false, 0, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.7, metalness: 0.45, side: THREE.DoubleSide })
      );
      shell.rotation.z = Math.PI / 2;
      shell.rotation.y = Math.PI / 2;
      shell.position.y = 0;
      shell.castShadow = shell.receiveShadow = true;
      hangar.add(shell);
      const back = new THREE.Mesh(
        new THREE.CircleGeometry(34, 18, 0, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0x6f767e, roughness: 0.8, side: THREE.DoubleSide })
      );
      back.position.z = -45;
      hangar.add(back);
      hangar.position.set(hx, y, 240);
      this.group.add(hangar);
      this._addCollider(new THREE.Vector3(hx, y + 14, 240), 36, 'hangar', 1.1);
    }

    // 활주로 등화 (야간 점등)
    const lightGeo = new THREE.SphereGeometry(0.9, 6, 5);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    const thrMat = new THREE.MeshBasicMaterial({ color: 0x44ff77 });
    const endMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
    const lightGroup = new THREE.Group();
    for (let x = RUNWAY.x0; x <= RUNWAY.x1; x += 60) {
      for (const z of [RUNWAY.z0 - 3, RUNWAY.z1 + 3]) {
        const m = new THREE.Mesh(lightGeo, edgeMat);
        m.position.set(x, y + 0.9, z);
        lightGroup.add(m);
      }
    }
    for (let z = RUNWAY.z0; z <= RUNWAY.z1; z += 7) {
      const a = new THREE.Mesh(lightGeo, thrMat); a.position.set(RUNWAY.x0 + 2, y + 0.9, z); lightGroup.add(a);
      const b = new THREE.Mesh(lightGeo, endMat); b.position.set(RUNWAY.x1 - 2, y + 0.9, z); lightGroup.add(b);
    }
    // 진입 등화 (PAPI)
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: i < 2 ? 0xff4433 : 0xffffff }));
      p.position.set(RUNWAY.x0 - 40, y + 1.4, RUNWAY.z0 - 20 - i * 8);
      p.scale.setScalar(1.6);
      lightGroup.add(p);
    }
    this.group.add(lightGroup);
    this.runwayLights = lightGroup;

    // 회전 공항 비콘
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0x66ff99 }));
    beacon.position.set(-520, y + 58, 210);
    this.group.add(beacon);
    const beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: 0x66ffaa, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    beaconGlow.scale.setScalar(46);
    beacon.add(beaconGlow);
    this.animated.push({ kind: 'beacon', obj: beacon, glow: beaconGlow });

    // 풍향계
    const sock = new THREE.Mesh(
      new THREE.ConeGeometry(2.2, 9, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xff7722, roughness: 0.9, side: THREE.DoubleSide })
    );
    sock.rotation.z = Math.PI / 2;
    sock.position.set(-620, y + 12, 60);
    this.group.add(sock);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0xcccccc }));
    pole.position.set(-620, y + 6, 60);
    this.group.add(pole);
    this.windsock = sock;
    void t;
  }

  /* ------------------------------- 도시 ------------------------------- */
  _buildCity() {
    const rng = this.rng;
    const cx = 2600, cz = -1800;
    const winTex = makeWindowTexture();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb9bec6, roughness: 0.72, metalness: 0.18, map: winTex, emissive: 0xffcc88, emissiveIntensity: 0,
      emissiveMap: winTex,
    });
    const count = 120;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = true;
    inst.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let placed = 0;
    for (let i = 0; i < count * 3 && placed < count; i++) {
      const x = cx + (rng() - 0.5) * 1900;
      const z = cz + (rng() - 0.5) * 1900;
      const h = this.terrain.heightAt(x, z);
      if (h < 12 || this.terrain.slopeAt(x, z) > 0.3) continue;
      const height = lerp(24, 190, Math.pow(rng(), 2.3));
      const w = lerp(18, 46, rng());
      const d = lerp(18, 46, rng());
      p.set(x, h + height / 2 - 1, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 0.6);
      s.set(w, height, d);
      m.compose(p, q, s);
      inst.setMatrixAt(placed, m);
      this._addCollider(new THREE.Vector3(x, h + height / 2, z), Math.max(w, d) * 0.6 + height * 0.12, 'building', 1.3);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
    this.cityMesh = inst;
    this.cityMaterial = mat;
  }

  /* -------------------------------- 숲 -------------------------------- */
  _buildForest() {
    const rng = this.rng;
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.85, 7, 5);
    const leafGeo = new THREE.ConeGeometry(3.6, 12, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4432, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.9 });
    const max = 5200;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, max);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, max);
    leaves.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    let n = 0;
    for (let i = 0; i < max * 6 && n < max; i++) {
      const ang = rng() * TAU;
      const dist = Math.pow(rng(), 0.5) * 7000;
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      const h = this.terrain.heightAt(x, z);
      if (h < 9 || h > 900) continue;
      if (this.terrain.slopeAt(x, z) > 0.42) continue;
      if (this.terrain.isRunway(x, z)) continue;
      if (Math.abs(x) < 1100 && Math.abs(z) < 320) continue;   // 공항 주변 제외
      const sc = lerp(0.7, 1.9, rng());
      q.setFromAxisAngle(up, rng() * TAU);
      m.compose(new THREE.Vector3(x, h + 3.5 * sc, z), q, new THREE.Vector3(sc, sc, sc));
      trunks.setMatrixAt(n, m);
      m.compose(new THREE.Vector3(x, h + 11 * sc, z), q, new THREE.Vector3(sc, sc * lerp(0.8, 1.4, rng()), sc));
      leaves.setMatrixAt(n, m);
      col.setHSL(0.28 + rng() * 0.06, 0.42 + rng() * 0.2, 0.16 + rng() * 0.12);
      leaves.setColorAt(n, col);
      if (n % 7 === 0) this._addCollider(new THREE.Vector3(x, h + 8 * sc, z), 5 * sc, 'tree', 0.35);
      n++;
    }
    trunks.count = leaves.count = n;
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    this.group.add(trunks, leaves);
  }

  /* ---------------------------- 풍력 발전기 ---------------------------- */
  _buildTurbines() {
    const rng = this.rng;
    const mat = new THREE.MeshStandardMaterial({ color: 0xf0f2f4, roughness: 0.45, metalness: 0.1 });
    for (let i = 0; i < 14; i++) {
      const ang = rng() * TAU;
      const dist = lerp(1800, 5200, rng());
      const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
      const h = this.terrain.heightAt(x, z);
      if (h < 20 || h > 700 || this.terrain.slopeAt(x, z) > 0.25) continue;
      const g = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 78, 12), mat);
      mast.position.y = 39;
      mast.castShadow = true;
      g.add(mast);
      const nacelle = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 6, 4, 8), mat);
      nacelle.rotation.z = Math.PI / 2;
      nacelle.position.set(0, 78, 0);
      g.add(nacelle);
      const rotor = new THREE.Group();
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.1, 36, 0.35), mat);
        blade.position.y = 18;
        blade.castShadow = true;
        const holder = new THREE.Group();
        holder.rotation.z = (b / 3) * TAU;
        holder.add(blade);
        rotor.add(holder);
      }
      rotor.position.set(0, 78, 4.5);
      g.add(rotor);
      g.position.set(x, h, z);
      g.rotation.y = rng() * TAU;
      this.group.add(g);
      this.animated.push({ kind: 'turbine', rotor, speed: rand(0.7, 1.5) });
      this._addCollider(new THREE.Vector3(x, h + 40, z), 8, 'turbine', 1.1);
      this._addCollider(new THREE.Vector3(x, h + 78, z), 20, 'turbine', 0.9);
    }
  }

  /* ---------------------------- 항공모함 ---------------------------- */
  _buildCarrier() {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.68, metalness: 0.5 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x2e3237, roughness: 0.95 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(300, 26, 62), hullMat);
    hull.position.y = -4;
    hull.castShadow = hull.receiveShadow = true;
    g.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(310, 3, 74), deckMat);
    deck.position.y = 10;
    deck.receiveShadow = true;
    g.add(deck);
    // 각도 갑판 표시
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 3),
      new THREE.MeshBasicMaterial({ color: 0xf0f0e8 })
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.rotation.z = 0.16;
    stripe.position.set(-10, 11.7, -6);
    g.add(stripe);
    // 아일랜드(함교)
    const island = new THREE.Mesh(new THREE.BoxGeometry(44, 34, 18), hullMat);
    island.position.set(40, 28, 26);
    island.castShadow = true;
    g.add(island);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 26, 8), hullMat);
    mast.position.set(40, 58, 26);
    g.add(mast);
    // 착함 유도등
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 5), new THREE.MeshBasicMaterial({ color: i === 2 ? 0xffaa33 : 0x33ff66 }));
      l.position.set(-120, 12, -30 + i * 4);
      g.add(l);
    }
    g.position.set(-5200, 0, 4200);
    g.rotation.y = 0.22;
    this.group.add(g);
    this.carrier = {
      group: g,
      deckY: 11.5,
      halfLen: 155, halfWid: 37,
      pos: g.position.clone(),
      rotY: g.rotation.y,
    };
    this._addCollider(new THREE.Vector3(g.position.x + 40, 30, g.position.z + 26), 26, 'ship', 1.4);
  }

  /* --------------------------- 체크포인트 링 --------------------------- */
  _buildRings() {
    const course = [
      [900, 120, 0], [2200, 260, -600], [3400, 420, -1800], [3000, 700, -3400],
      [1200, 520, -4200], [-600, 380, -3200], [-1800, 300, -1600], [-1200, 180, 200],
    ];
    const mat = new THREE.MeshStandardMaterial({
      color: 0x22e0ff, emissive: 0x1199cc, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0.4,
    });
    course.forEach((c, i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(38, 2.4, 10, 40), mat.clone());
      const groundH = this.terrain.heightAt(c[0], c[2]);
      ring.position.set(c[0], Math.max(c[1], groundH + 60), c[2]);
      ring.rotation.y = Math.atan2(
        (course[(i + 1) % course.length][0] - c[0]),
        (course[(i + 1) % course.length][2] - c[2])
      ) + Math.PI / 2;
      ring.userData.index = i;
      this.group.add(ring);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(), color: 0x33ddff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5,
      }));
      glow.scale.setScalar(170);
      ring.add(glow);
      this.rings.push({ mesh: ring, index: i, radius: 38, passed: false, glow });
    });
  }

  /* ------------------------- 열기구 축제 (장식) ------------------------- */
  _buildBalloonFestival() {
    const rng = this.rng;
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const colA = new THREE.Color().setHSL(rng(), 0.85, 0.55);
      const colB = new THREE.Color().setHSL((rng() + 0.4) % 1, 0.85, 0.5);
      const env = new THREE.Mesh(
        new THREE.SphereGeometry(11, 20, 16, 0, TAU, 0, Math.PI * 0.72),
        new THREE.MeshStandardMaterial({ color: colA, roughness: 0.85, side: THREE.DoubleSide })
      );
      env.scale.y = 1.25;
      env.castShadow = true;
      g.add(env);
      const band = new THREE.Mesh(
        new THREE.SphereGeometry(11.05, 20, 6, 0, TAU, Math.PI * 0.28, Math.PI * 0.16),
        new THREE.MeshStandardMaterial({ color: colB, roughness: 0.85, side: THREE.DoubleSide })
      );
      band.scale.y = 1.25;
      g.add(band);
      const basket = new THREE.Mesh(
        new THREE.BoxGeometry(3, 2.4, 3),
        new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 1 })
      );
      basket.position.y = -17;
      g.add(basket);
      const x = rand(-2600, -1200), z = rand(900, 2600);
      g.position.set(x, this.terrain.heightAt(x, z) + rand(80, 460), z);
      this.group.add(g);
      this.animated.push({ kind: 'balloon', obj: g, phase: rng() * TAU, baseY: g.position.y, drift: rand(0.4, 1.2) });
      this._addCollider(new THREE.Vector3(x, g.position.y, z), 13, 'balloon', 0.3);
    }
  }

  /* --------------------------- 우주 발사대 --------------------------- */
  _buildSpacePad() {
    const x = -5200, z = -6100;
    const h = this.terrain.heightAt(x, z);
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(70, 76, 4, 32),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.85 })
    );
    pad.position.set(x, h + 2, z);
    pad.receiveShadow = true;
    this.group.add(pad);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.5, metalness: 0.55 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      const t = new THREE.Mesh(new THREE.BoxGeometry(5, 96, 5), mat);
      t.position.set(x + Math.cos(a) * 52, h + 48, z + Math.sin(a) * 52);
      t.castShadow = true;
      this.group.add(t);
      this._addCollider(new THREE.Vector3(t.position.x, h + 48, t.position.z), 7, 'tower', 1.2);
    }
    this.spacePad = { x, y: h + 4.2, z };
  }

  /* ------------------------------- 갱신 ------------------------------- */
  update(dt, time, night, ocean, windVec) {
    for (const a of this.animated) {
      if (a.kind === 'turbine') {
        a.rotor.rotation.z += dt * a.speed * (0.4 + (windVec ? windVec.length() : 3) * 0.12);
      } else if (a.kind === 'beacon') {
        a.obj.rotation.y += dt * 2.2;
        const blink = (Math.sin(time * 2.2) * 0.5 + 0.5);
        a.glow.material.opacity = night * (0.2 + blink * 0.8);
      } else if (a.kind === 'balloon') {
        a.obj.position.y = a.baseY + Math.sin(time * 0.23 + a.phase) * 12;
        a.obj.position.x += (windVec ? windVec.x : 1) * dt * 0.06 * a.drift;
        a.obj.position.z += (windVec ? windVec.z : 1) * dt * 0.06 * a.drift;
        a.obj.rotation.y += dt * 0.05;
      }
    }
    // 야간 조명 상태
    if (this.cityMaterial) this.cityMaterial.emissiveIntensity = night * 1.25;
    if (this.runwayLights) this.runwayLights.visible = night > 0.12;
    // 링 펄스
    for (const r of this.rings) {
      const m = r.mesh.material;
      m.emissiveIntensity = r.passed ? 0.25 : 1.6 + Math.sin(time * 3 + r.index) * 0.7;
      m.color.setHex(r.passed ? 0x225544 : 0x22e0ff);
      r.glow.material.opacity = r.passed ? 0.08 : 0.35 + Math.sin(time * 3 + r.index) * 0.15;
    }
    // 항공모함 파도에 따른 흔들림
    if (this.carrier && ocean) {
      const c = this.carrier;
      const wave = ocean.heightAt(c.pos.x, c.pos.z, ocean.time);
      const waveF = ocean.heightAt(c.pos.x + 120, c.pos.z, ocean.time);
      const waveS = ocean.heightAt(c.pos.x, c.pos.z + 40, ocean.time);
      c.group.position.y = wave * 0.65;
      c.group.rotation.x = clamp((waveS - wave) / 40, -0.05, 0.05);
      c.group.rotation.z = clamp((waveF - wave) / 120, -0.04, 0.04) + 0;
      c.deckYWorld = 11.5 + c.group.position.y;
    }
    // 풍향계 회전
    if (this.windsock && windVec) {
      this.windsock.rotation.y = Math.atan2(windVec.x, windVec.z) + Math.PI / 2;
      const s = clamp(windVec.length() / 14, 0.15, 1);
      this.windsock.scale.set(1, lerp(0.5, 1.2, s), 1);
    }
  }

  /** 구조물 충돌 검사 — 반환: 충돌 정보 또는 null */
  checkCollision(pos, radius) {
    for (const c of this.colliders) {
      const r = c.radius + radius;
      if (pos.distanceToSquared(c.pos) < r * r) {
        const n = pos.clone().sub(c.pos).normalize();
        return { collider: c, normal: n, type: c.type, hardness: c.hardness };
      }
    }
    // 항공모함 갑판
    if (this.carrier) {
      const c = this.carrier;
      const dx = pos.x - c.pos.x, dz = pos.z - c.pos.z;
      const cos = Math.cos(-c.rotY), sin = Math.sin(-c.rotY);
      const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
      if (Math.abs(lx) < c.halfLen && Math.abs(lz) < c.halfWid) {
        const deck = (c.deckYWorld || 11.5);
        if (pos.y - radius < deck && pos.y > deck - 26) {
          return { deck: true, height: deck, normal: new THREE.Vector3(0, 1, 0), type: 'deck', hardness: 1.1 };
        }
      }
    }
    return null;
  }

  /** 항공모함 갑판 높이 (해당 위치가 갑판 위일 때) */
  deckHeightAt(x, z) {
    if (!this.carrier) return null;
    const c = this.carrier;
    const dx = x - c.pos.x, dz = z - c.pos.z;
    const cos = Math.cos(-c.rotY), sin = Math.sin(-c.rotY);
    const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    if (Math.abs(lx) < c.halfLen && Math.abs(lz) < c.halfWid) return c.deckYWorld || 11.5;
    return null;
  }
}

void randInt;
