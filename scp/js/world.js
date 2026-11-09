// 시설 생성: 절차적 텍스처, 벽/바닥/천장, 문, 조명, 소품, 키카드, 먼지
import * as THREE from 'three';
import { MAP, W, H, CELL, WALL_H, at, center, find, doors } from './map.js';

// ── 캔버스 텍스처 유틸 ──
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rnd = (a, b) => a + Math.random() * (b - a);
function noise(ctx, w, h, amp = 0.5, op = 'overlay', scales = [4, 8, 16, 32, 64, 128, 256]) {
  ctx.save(); ctx.globalCompositeOperation = op; ctx.imageSmoothingEnabled = true;
  for (const s of scales) {
    const n = cv(s, s), nx = n.getContext('2d'), d = nx.createImageData(s, s);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    nx.putImageData(d, 0, 0);
    ctx.globalAlpha = amp * (0.35 + 0.65 * Math.min(1, s / 64)) / 2.2;
    ctx.drawImage(n, 0, 0, w, h);
  }
  ctx.restore();
}
export function normalFrom(c, strength = 2) {
  const w = c.width, h = c.height, src = c.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cv(w, h), ox = out.getContext('2d'), d = ox.createImageData(w, h);
  const L = (x, y) => { x = (x + w) % w; y = (y + h) % h; const i = (y * w + x) * 4; return (src[i] + src[i + 1] + src[i + 2]) / 765; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (L(x + 1, y) - L(x - 1, y)) * strength, dy = (L(x, y + 1) - L(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d.data[i] = (-dx / l * 0.5 + 0.5) * 255; d.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; d.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; d.data[i + 3] = 255;
  }
  ox.putImageData(d, 0, 0); return out;
}
function tex(c, rep = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function stains(ctx, w, h, n, color, len) {
  for (let i = 0; i < n; i++) {
    const x = rnd(0, w), y = rnd(-20, h * 0.3), ww = rnd(4, 26), l = rnd(len * 0.4, len);
    const g = ctx.createLinearGradient(0, y, 0, y + l);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.globalAlpha = rnd(0.15, 0.45); ctx.fillRect(x, y, ww, l);
  }
  ctx.globalAlpha = 1;
}
export function textTexture(lines, w, h, bg, fg, font = 'bold 64px Arial', extra) {
  const c = cv(w, h), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  if (extra) extra(x, w, h);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = font;
  lines.forEach((l, i) => x.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * parseInt(font.match(/(\d+)px/)[1]) * 1.15));
  noise(x, w, h, 0.25, 'multiply', [32, 64, 128]);
  return tex(c);
}

function wallMaps() {
  const w = 512, h = 1024, c = cv(w, h), x = c.getContext('2d');
  x.fillStyle = '#8e8d88'; x.fillRect(0, 0, w, h);
  noise(x, w, h, 0.28, 'overlay', [16, 64, 256, 512]);
  // 시멘트 블록 줄눈 (0.4m × 0.8m)
  const rowH = h * 0.4 / WALL_H;
  for (let r = 0, y = h; y > 0; r++, y -= rowH) {
    x.fillStyle = 'rgba(40,40,38,0.55)'; x.fillRect(0, y - 3, w, 4);
    x.fillStyle = 'rgba(255,255,250,0.18)'; x.fillRect(0, y + 1, w, 2);
    for (let k = (r % 2) * 0.5; k < 2.6; k += 1) { const xx = k * w / 2.5 * 1.25; x.fillStyle = 'rgba(40,40,38,0.55)'; x.fillRect(xx - 2, y - rowH, 4, rowH); }
  }
  stains(x, w, h, 26, 'rgba(60,52,40,1)', h * 0.6);
  // 하단 페인트 띠 + 노란 경고선
  const band = h * 0.95 / WALL_H;
  x.fillStyle = 'rgba(52,58,66,0.93)'; x.fillRect(0, h - band, w, band);
  noise(x, w, band, 0.3);
  x.fillStyle = '#c9a227'; x.fillRect(0, h - band - 14, w, 14);
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, h - band, w, 3);
  stains(x, w, h, 10, 'rgba(30,25,20,1)', 120);
  const n = normalFrom(c, 3);
  return { map: tex(c), normalMap: tex(n, 1, false) };
}
function floorMaps() {
  const s = 512, c = cv(s, s), x = c.getContext('2d');
  for (let i = 0; i < 4; i++) { const v = 78 + rnd(-8, 8); x.fillStyle = `rgb(${v},${v + 2},${v + 5})`; x.fillRect((i % 2) * s / 2, (i >> 1) * s / 2, s / 2, s / 2); }
  noise(x, s, s, 0.3, 'overlay', [16, 64, 256, 512]);
  x.fillStyle = 'rgba(15,15,15,0.8)';
  for (const p of [0, s / 2]) { x.fillRect(p - 2, 0, 5, s); x.fillRect(0, p - 2, s, 5); }
  for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(${rnd(0, 30)},${rnd(0, 25)},20,${rnd(0.05, 0.2)})`; x.lineWidth = rnd(1, 5); x.beginPath(); const a = rnd(0, s), b = rnd(0, s); x.moveTo(a, b); x.lineTo(a + rnd(-80, 80), b + rnd(-80, 80)); x.stroke(); }
  const n = normalFrom(c, 2.2);
  return { map: tex(c), normalMap: tex(n, 1, false) };
}
function ceilMaps() {
  const s = 256, c = cv(s, s), x = c.getContext('2d');
  x.fillStyle = '#b9b8b2'; x.fillRect(0, 0, s, s); noise(x, s, s, 0.4);
  x.fillStyle = '#555'; for (const p of [0, s / 2]) { x.fillRect(p - 2, 0, 4, s); x.fillRect(0, p - 2, s, 4); }
  stains(x, s, s, 6, 'rgba(120,95,50,1)', 60);
  return { map: tex(c) };
}
function doorMaps(gate) {
  const w = 512, h = 768, c = cv(w, h), x = c.getContext('2d');
  x.fillStyle = gate ? '#7a6f5c' : '#6b7279'; x.fillRect(0, 0, w, h); noise(x, w, h, 0.22, 'overlay', [32, 128, 512]);
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 6; x.strokeRect(20, 20, w - 40, h - 40);
  // 경고 사선 띠
  x.save(); x.beginPath(); x.rect(0, h - 120, w, 120); x.clip();
  for (let i = -10; i < 20; i++) { x.fillStyle = i % 2 ? '#d9b220' : '#1a1a1a'; x.beginPath(); x.moveTo(i * 50, h); x.lineTo(i * 50 + 50, h); x.lineTo(i * 50 + 170, h - 120); x.lineTo(i * 50 + 120, h - 120); x.fill(); }
  x.restore();
  if (!gate) { x.fillStyle = '#1b2228'; x.fillRect(w / 2 - 70, 140, 140, 160); x.fillStyle = 'rgba(160,200,220,0.25)'; x.fillRect(w / 2 - 66, 144, 40, 152); }
  x.fillStyle = '#ddd'; x.font = 'bold 54px Arial'; x.textAlign = 'center';
  x.fillText(gate ? 'GATE A' : 'LEVEL 2', w / 2, gate ? 260 : 400);
  if (gate) { x.font = 'bold 30px Arial'; x.fillStyle = '#e33'; x.fillText('LEVEL 3 KEYCARD', w / 2, 330); }
  x.fillStyle = '#999'; for (let i = 0; i < 10; i++) for (const yy of [36, h - 140]) { x.beginPath(); x.arc(40 + i * (w - 80) / 9, yy, 5, 0, 7); x.fill(); }
  stains(x, w, h, 12, 'rgba(70,40,20,1)', 200);
  return { map: tex(c), normalMap: tex(normalFrom(c, 2), 1, false) };
}
function crateMaps() {
  const s = 256, c = cv(s, s), x = c.getContext('2d');
  x.fillStyle = '#7d6440'; x.fillRect(0, 0, s, s); noise(x, s, s, 0.6, 'overlay', [8, 32, 64, 256]);
  for (let i = 0; i < 6; i++) { x.fillStyle = 'rgba(30,20,8,0.7)'; x.fillRect(0, i * s / 6, s, 3); }
  x.strokeStyle = '#3a2a14'; x.lineWidth = 14; x.strokeRect(7, 7, s - 14, s - 14);
  x.beginPath(); x.moveTo(10, 10); x.lineTo(s - 10, s - 10); x.stroke();
  x.fillStyle = 'rgba(20,20,20,0.75)'; x.font = 'bold 34px Arial'; x.textAlign = 'center'; x.fillText('SITE-19', s / 2, s / 2 + 40);
  return { map: tex(c), normalMap: tex(normalFrom(c, 2.5), 1, false) };
}

// ── 문 ──
class Door {
  constructor(x, y, gate, mats, scene) {
    this.x = x; this.y = y; this.gate = gate; this.locked = gate; this.open = 0; this.broken = false;
    this.alongX = at(x - 1, y) === '#' && at(x + 1, y) === '#';
    this.cx = center(x); this.cz = center(y);
    const g = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.05, 3.0, 0.16), gate ? mats.gate : mats.door);
    slab.position.y = 1.5; slab.castShadow = slab.receiveShadow = true; g.add(slab);
    g.position.set(this.cx, 0, this.cz); if (!this.alongX) g.rotation.y = Math.PI / 2;
    scene.add(g); this.g = g; this.slab = slab; this.scene = scene;
    // 문틀 상단(인방) + 기둥
    const lin = new THREE.Mesh(new THREE.BoxGeometry(CELL, WALL_H - 3.0, CELL), mats.wallBox);
    lin.position.set(this.cx, 3.0 + (WALL_H - 3.0) / 2, this.cz); lin.receiveShadow = true; scene.add(lin);
    const frameM = mats.frame;
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.05, 0.34), frameM); p.position.set(s * (CELL / 2 - 0.06), 1.52, 0); g.add(p); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(CELL, 0.12, 0.34), frameM); top.position.y = 3.02; g.add(top);
    // 상태 표시등
    this.lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, CELL + 0.04), new THREE.MeshBasicMaterial({ color: gate ? 0xff2200 : 0x22ff66 }));
    this.lamp.position.set(0, 3.25, 0); g.add(this.lamp);
    this.vel = new THREE.Vector3(); this.spin = new THREE.Vector3();
  }
  passable() { return this.broken || this.open > 0.85; }
  burst(dir, audio) {
    if (this.broken) return;
    this.broken = true; this.locked = false;
    const w = new THREE.Vector3(); this.slab.getWorldPosition(w);
    this.g.remove(this.slab); this.scene.add(this.slab);
    this.slab.position.copy(w); this.slab.rotation.order = 'YXZ'; this.slab.rotation.y = this.g.rotation.y;
    this.vel.set(dir.x * 9, 3.5, dir.z * 9); this.spin.set(rnd(-4, 4), rnd(-3, 3), rnd(-6, 6));
    this.lamp.material.color.set(0x330000);
    audio?.doorBurst(w);
  }
  update(dt, want, audio) {
    if (this.broken) {
      const s = this.slab;
      if (this.vel.lengthSq() > 0.01 || s.position.y > 0.1) {
        this.vel.y -= 22 * dt; s.position.addScaledVector(this.vel, dt);
        s.rotation.x += this.spin.x * dt; s.rotation.z += this.spin.z * dt;
        if (s.position.y < 0.09) { // 바닥에 떨어짐: 눕힌다
          s.position.y = 0.09; this.vel.multiplyScalar(0.35); this.vel.y = Math.abs(this.vel.y) * 0.2; this.spin.multiplyScalar(0.3);
          const flat = Math.round((s.rotation.x + Math.PI / 2) / Math.PI) * Math.PI - Math.PI / 2;
          s.rotation.x += (flat - s.rotation.x) * 0.5; s.rotation.z *= 0.5;
          if (this.vel.length() < 0.6) { this.vel.set(0, 0, 0); s.rotation.x = flat; s.rotation.z = 0; }
        }
      }
      return;
    }
    const tgt = want && !this.locked ? 1 : 0, prev = this.open;
    this.open += Math.sign(tgt - this.open) * Math.min(Math.abs(tgt - this.open), dt * 2.6);
    if ((prev === 0 && this.open > 0) || (prev === 1 && this.open < 1)) audio?.door(this.g.position, this.gate);
    this.slab.position.x = this.open * (CELL - 0.15);
    this.lamp.material.color.set(this.locked ? 0xff2200 : this.open > 0 ? 0xffaa00 : 0x22ff66);
  }
}

export function buildWorld(scene, audio) {
  const wm = wallMaps(), fm = floorMaps(), dm = doorMaps(false), gm = doorMaps(true), cm = crateMaps();
  const mats = {
    wall: new THREE.MeshStandardMaterial({ ...wm, roughness: 0.9, normalScale: new THREE.Vector2(0.9, 0.9) }),
    floor: new THREE.MeshStandardMaterial({ ...fm, roughness: 0.62, metalness: 0.05, normalScale: new THREE.Vector2(0.7, 0.7) }),
    ceil: new THREE.MeshStandardMaterial({ ...ceilMaps(), roughness: 0.95 }),
    door: new THREE.MeshStandardMaterial({ ...dm, roughness: 0.45, metalness: 0.6 }),
    gate: new THREE.MeshStandardMaterial({ ...gm, roughness: 0.5, metalness: 0.55 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.5, metalness: 0.7 }),
    crate: new THREE.MeshStandardMaterial({ ...cm, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x5b6067, roughness: 0.4, metalness: 0.8 }),
  };
  mats.wallBox = new THREE.MeshStandardMaterial({ color: 0x86857f, roughness: 0.9, normalMap: wm.normalMap });
  fm.map.repeat.set(1, 1);
  const G = new THREE.Group(); scene.add(G);

  // 바닥 / 천장 (월드 좌표 UV: 1칸=텍스처 1장)
  const floorGeo = new THREE.PlaneGeometry(W * CELL, H * CELL); floorGeo.rotateX(-Math.PI / 2); floorGeo.translate(W, 0, H);
  for (const [m, rep] of [[mats.floor.map, 1], [mats.floor.normalMap, 1]]) m.repeat.set(W, H);
  const floor = new THREE.Mesh(floorGeo, mats.floor); floor.receiveShadow = true; G.add(floor);
  mats.ceil.map.repeat.set(W, H);
  const ceil = new THREE.Mesh(floorGeo.clone().rotateX(Math.PI).translate(0, WALL_H, 2 * H), mats.ceil); G.add(ceil);

  // 벽: 노출된 면만 생성
  const pos = [], nor = [], uv = [], idx = [];
  const quad = (a, b, c, d, n, u0, u1) => {
    const i = pos.length / 3; pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) nor.push(...n);
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0) idx.push(i, i + 1, i + 2, i, i + 2, i + 3); else idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  };
  const solid = c => c === '#';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!solid(at(x, y))) continue;
    const x0 = x * CELL, x1 = x0 + CELL, z0 = y * CELL, z1 = z0 + CELL;
    if (!solid(at(x + 1, y))) quad([x1, 0, z0], [x1, 0, z1], [x1, WALL_H, z1], [x1, WALL_H, z0], [1, 0, 0], z0 / CELL, z1 / CELL);
    if (!solid(at(x - 1, y))) quad([x0, 0, z1], [x0, 0, z0], [x0, WALL_H, z0], [x0, WALL_H, z1], [-1, 0, 0], z1 / CELL, z0 / CELL);
    if (!solid(at(x, y + 1))) quad([x1, 0, z1], [x0, 0, z1], [x0, WALL_H, z1], [x1, WALL_H, z1], [0, 0, 1], x1 / CELL, x0 / CELL);
    if (!solid(at(x, y - 1))) quad([x0, 0, z0], [x1, 0, z0], [x1, WALL_H, z0], [x0, WALL_H, z0], [0, 0, -1], x0 / CELL, x1 / CELL);
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  wg.setIndex(idx); wg.computeTangents?.();
  const walls = new THREE.Mesh(wg, mats.wall); walls.receiveShadow = true; walls.castShadow = true; G.add(walls);

  // 유리창 칸
  const glassM = new THREE.MeshPhysicalMaterial({ color: 0xa8c8d8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false });
  for (const c of find('g')) {
    const cx = center(c.x), cz = center(c.y);
    for (const [y0, y1] of [[0, 0.95], [2.55, WALL_H]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(CELL, y1 - y0, CELL * 0.5), mats.wallBox); b.position.set(cx, (y0 + y1) / 2, cz); b.rotation.y = Math.PI / 2; b.castShadow = b.receiveShadow = true; G.add(b); }
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.6, CELL), glassM); p.position.set(cx, 1.75, cz); G.add(p);
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, CELL), mats.frame); f.position.set(cx, 0.99, cz); G.add(f);
    const f2 = f.clone(); f2.position.y = 2.51; G.add(f2);
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.06), mats.frame); v.position.set(cx, 1.75, cz - CELL / 2); G.add(v);
  }

  // 문
  const doorList = [];
  for (const ch of ['D', 'X']) for (const c of find(ch)) { const d = new Door(c.x, c.y, ch === 'X', mats, G); doors.set(c.x + ',' + c.y, d); doorList.push(d); }
  // 096 이 뜯어낸 격리실 문 (O)
  for (const c of find('O')) {
    const lin = new THREE.Mesh(new THREE.BoxGeometry(CELL, WALL_H - 3, CELL), mats.wallBox); lin.position.set(center(c.x), 3 + (WALL_H - 3) / 2, center(c.y)); G.add(lin);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.05, 3.0, 0.16), mats.door);
    slab.position.set(center(c.x) + 2.3, 0.1, center(c.y) - 3.2); slab.rotation.order = 'YXZ'; slab.rotation.set(-Math.PI / 2 + 0.05, 0.7, 0.04); slab.castShadow = slab.receiveShadow = true; G.add(slab);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshStandardMaterial({ map: textTexture(['SCP-096', 'KETER'], 512, 256, '#d8d4c8', '#111', 'bold 86px Arial', (x, w, h) => { x.fillStyle = '#b01010'; x.fillRect(0, h - 40, w, 40); }), roughness: 0.6 }));
    sign.position.set(center(c.x) - 2, 2.2, c.y * CELL - 0.01); sign.rotation.y = Math.PI; G.add(sign);
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.55), new THREE.MeshStandardMaterial({ map: textTexture(['얼굴을 보지 마시오', 'DO NOT LOOK AT ITS FACE'], 640, 220, '#c9a227', '#111', 'bold 52px Arial'), roughness: 0.6 }));
    warn.position.set(center(c.x) + 2, 2.1, c.y * CELL - 0.01); warn.rotation.y = Math.PI; G.add(warn);
  }

  // 상자 / 책상 (점프로 올라설 수 있는 AABB)
  const boxes = [];
  const addBox = (cx, cz, sx, sz, top) => boxes.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, top });
  for (const c of find('c')) {
    const s = rnd(1.3, 1.6), h = rnd(0.95, 1.15), cx = center(c.x) + rnd(-0.15, 0.15), cz = center(c.y) + rnd(-0.15, 0.15);
    const b = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), mats.crate); b.position.set(cx, h / 2, cz); b.castShadow = b.receiveShadow = true; G.add(b);
    addBox(cx, cz, s, s, h);
    if (Math.random() < 0.5) { const s2 = s * 0.6, h2 = h * 0.65; const b2 = new THREE.Mesh(new THREE.BoxGeometry(s2, h2, s2), mats.crate); b2.position.set(cx + rnd(-0.2, 0.2), h + h2 / 2, cz + rnd(-0.2, 0.2)); b2.rotation.y = rnd(-0.3, 0.3); b2.castShadow = b2.receiveShadow = true; G.add(b2); addBox(b2.position.x, b2.position.z, s2 * 0.85, s2 * 0.85, h + h2); }
  }
  const deskTop = new THREE.MeshStandardMaterial({ color: 0x8b8f94, roughness: 0.35, metalness: 0.3 });
  const screenTex = textTexture(['> SCP-096 STATUS', '> CONTAINMENT: FAILED', '> PERSONNEL: EVACUATE', '> _'], 512, 320, '#04140a', '#3dff7a', 'bold 34px Courier New');
  for (const c of find('t')) {
    const cx = center(c.x), cz = center(c.y), g = new THREE.Group(); g.position.set(cx, 0, cz); G.add(g);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.85), deskTop); top.position.y = 0.76; top.castShadow = top.receiveShadow = true; g.add(top);
    for (const [a, b] of [[-0.8, -0.38], [0.8, -0.38], [-0.8, 0.38], [0.8, 0.38]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.74, 0.05), mats.metal); l.position.set(a, 0.37, b); g.add(l); }
    const mon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.06), mats.frame); mon.position.set(0, 1.02, -0.2); mon.castShadow = true; g.add(mon);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.34), new THREE.MeshBasicMaterial({ map: screenTex })); scr.position.set(0, 1.02, -0.165); g.add(scr);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), mats.frame); stand.position.set(0, 0.86, -0.22); g.add(stand);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.9 })); paper.rotation.set(-Math.PI / 2, 0, rnd(-0.5, 0.5)); paper.position.set(rnd(-0.6, 0.6), 0.79, 0.15); g.add(paper);
    addBox(cx, cz, 1.7, 0.85, 0.78);
  }
  const boxGrid = new Map();
  for (const b of boxes) for (let y = Math.floor(b.minZ / CELL); y <= Math.floor(b.maxZ / CELL); y++) for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++) { const k = x + ',' + y; (boxGrid.get(k) || boxGrid.set(k, []).get(k)).push(b); }

  // 천장 배관
  const pipeM = new THREE.MeshStandardMaterial({ color: 0x4a4f46, roughness: 0.5, metalness: 0.6 });
  for (const [z, r] of [[14.35, 0.09], [14.65, 0.06], [19.6, 0.12]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 76, 10), pipeM); p.rotation.z = Math.PI / 2; p.position.set(40, WALL_H - 0.25 - r, z); p.castShadow = true; G.add(p); }

  // 조명
  const lights = [], housing = new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.5, metalness: 0.5 });
  for (const c of find('*')) {
    const cx = center(c.x), cz = center(c.y), alongX = at(c.x - 1, c.y) !== '#' && at(c.x + 1, c.y) !== '#';
    const hm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.4), housing); hm.position.set(cx, WALL_H - 0.05, cz); hm.rotation.y = alongX ? 0 : Math.PI / 2; G.add(hm);
    const pm = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.28), pm); panel.rotation.x = Math.PI / 2; panel.position.y = -0.051; hm.add(panel);
    const L = new THREE.PointLight(0xffe9cc, 14, 15, 1.6); L.position.set(cx, WALL_H - 0.35, cz); G.add(L);
    const flicker = Math.random() < 0.3;
    lights.push({ L, pm, base: 14, flicker, ft: rnd(0, 10), on: 1 });
  }
  // 격리실 위 그림자 스포트라이트
  const s096 = find('S')[0];
  const spot = new THREE.SpotLight(0xd8e4ff, 40, 16, 0.75, 0.7, 1.4);
  spot.position.set(center(s096.x) - 1, WALL_H - 0.1, center(s096.y) - 4); spot.target.position.set(center(s096.x), 0, center(s096.y));
  spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.camera.near = 0.3;
  G.add(spot, spot.target);
  lights.push({ L: spot, base: 40, flicker: true, ft: 0, on: 1 });
  // 출구 빛
  const ex = find('E');
  const exitL = new THREE.PointLight(0xcfffe0, 30, 18, 1.5); exitL.position.set(center(38) - 0.5, 2.5, center(ex[1].y)); G.add(exitL);
  const exitPanel = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.2), new THREE.MeshBasicMaterial({ color: 0xe8fff0 })); exitPanel.position.set(39 * CELL - 0.02, 1.6, center(ex[1].y)); exitPanel.rotation.y = -Math.PI / 2; G.add(exitPanel);
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.45), new THREE.MeshBasicMaterial({ map: textTexture(['EXIT  ▶'], 512, 160, '#0a7a2a', '#eaffee', 'bold 92px Arial') }));
  exitSign.position.set(39 * CELL - 0.03, 3.25, center(ex[1].y)); exitSign.rotation.y = -Math.PI / 2; G.add(exitSign);
  const gate = find('X')[0];
  const gs = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), new THREE.MeshBasicMaterial({ map: textTexture(['GATE A  ▲'], 512, 140, '#0a7a2a', '#eaffee', 'bold 80px Arial') }));
  gs.position.set(center(gate.x) + 2.4, 2.6, (gate.y + 1) * CELL + 0.01); G.add(gs);
  // 방 표지판
  const plate = (txt, cx, z, rotY) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.4), new THREE.MeshStandardMaterial({ map: textTexture([txt], 512, 136, '#1d2a38', '#e8eef5', 'bold 56px Arial'), roughness: 0.5 })); m.position.set(cx, 2.5, z); m.rotation.y = rotY; G.add(m); };
  plate('D계급 대기실', center(3) + 1.8, 7 * CELL + 0.01, 0);
  plate('보관 창고', center(11) + 1.8, 7 * CELL + 0.01, 0);
  plate('연구 사무실', center(21) + 1.8, 7 * CELL + 0.01, 0);
  plate('관측실', center(5) + 1.8, 10 * CELL - 0.01, Math.PI);
  plate('연구실', center(21) + 1.8, 10 * CELL - 0.01, Math.PI);
  plate('정비 구역', center(32) + 1.8, 10 * CELL - 0.01, Math.PI);

  // 바닥 얼룩/긁힌 자국 데칼
  const decal = (cx, cz, s, col, rot) => {
    const c = cv(256, 256), x = c.getContext('2d');
    for (let i = 0; i < 18; i++) { x.fillStyle = col; x.globalAlpha = rnd(0.1, 0.35); x.beginPath(); x.ellipse(128 + rnd(-60, 60), 128 + rnd(-60, 60), rnd(10, 70), rnd(8, 40), rnd(0, 3), 0, 7); x.fill(); }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshStandardMaterial({ map: tex(c), transparent: true, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.set(-Math.PI / 2, 0, rot); m.position.set(cx, 0.01, cz); m.receiveShadow = true; G.add(m);
  };
  const o = find('O')[0];
  decal(center(o.x), center(o.y) - 2.5, 2.6, '#3b0606', 0.4);
  decal(center(o.x) - 3, center(o.y) - 4, 1.6, '#2a0505', 1.2);
  decal(center(s096.x) + 1, center(s096.y) - 1, 2, '#2b2318', 0);
  for (let i = 0; i < 10; i++) decal(rnd(4, 76), rnd(15, 19), rnd(1, 2.5), '#1e1a14', rnd(0, 6));
  // 격리실 벽의 할퀸 자국
  const scr = cv(256, 256), sx = scr.getContext('2d'); sx.strokeStyle = 'rgba(25,10,8,0.8)'; sx.lineCap = 'round';
  for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) { sx.lineWidth = rnd(2, 5); sx.beginPath(); const bx = 40 + k * 70 + i * 12; sx.moveTo(bx, rnd(20, 50)); sx.bezierCurveTo(bx + 5, 100, bx - 5, 160, bx + rnd(-10, 10), rnd(200, 240)); sx.stroke(); }
  const scratch = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshStandardMaterial({ map: tex(scr), transparent: true, depthWrite: false }));
  scratch.position.set(center(s096.x), 1.6, (s096.y + 1) * CELL - 0.02); scratch.rotation.y = Math.PI; G.add(scratch);

  // 키카드
  const k = find('K')[0];
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.95, 16), mats.metal); ped.position.set(center(k.x), 0.475, center(k.y)); ped.castShadow = ped.receiveShadow = true; G.add(ped);
  const cardTex = textTexture(['LEVEL 3', 'SITE-19'], 256, 160, '#f4f4f0', '#222', 'bold 40px Arial', (x, w, h) => { x.fillStyle = '#c21d1d'; x.fillRect(0, 0, w, 34); x.fillStyle = '#222'; x.beginPath(); x.arc(30, 110, 16, 0, 7); x.fill(); });
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.165, 0.01), new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.3, emissive: 0x332222, emissiveIntensity: 0.4 }));
  card.position.set(center(k.x), 1.25, center(k.y)); card.castShadow = true; G.add(card);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial(), color: 0xff6644, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(0.9, 0.9, 1); card.add(glow);

  // 떠다니는 먼지
  const N = 900, dp = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { dp[i * 3] = rnd(2, 78); dp[i * 3 + 1] = rnd(0.2, WALL_H - 0.2); dp[i * 3 + 2] = rnd(2, 34); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.035, map: radial(), color: 0xc8c0b0, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  G.add(dust);

  let alarm = 0;
  return {
    doors: doorList, lights, card, boxes,
    setAlarm(on) { alarm = on ? 1 : 0; },
    // 원(반지름 r)과 상자 충돌: 위에 있으면 바닥 높이 반환, 옆이면 밀어냄
    collideBoxes(p, r, y) {
      let ground = 0; const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL), seen = new Set();
      for (let yy = cz - 1; yy <= cz + 1; yy++) for (let xx = cx - 1; xx <= cx + 1; xx++) for (const b of boxGrid.get(xx + ',' + yy) || []) {
        if (seen.has(b)) continue; seen.add(b);
        const nx = Math.max(b.minX, Math.min(p.x, b.maxX)), nz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
        const dx = p.x - nx, dz = p.z - nz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (y >= b.top - 0.12) { ground = Math.max(ground, b.top); continue; }
        if (d > 1e-5) { p.x += dx / d * (r - d); p.z += dz / d * (r - d); }
        else { const o = [[p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0], [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1]].sort((a, c) => a[0] - c[0])[0]; p.x += o[1] * (o[0] + r); p.z += o[2] * (o[0] + r); }
      }
      return ground;
    },
    update(dt, t, player, a096) {
      for (const d of doorList) {
        const near = (q, r) => Math.hypot(q.x - d.cx, q.z - d.cz) < r;
        if (d.locked && player.hasCard && near(player.pos, 3.2)) { d.locked = false; audio?.unlock(); }
        d.update(dt, near(player.pos, 3.4), audio);
      }
      for (const l of lights) {
        let f = 1;
        if (l.flicker) { l.ft -= dt; if (l.ft < 0) { l.on = Math.random() < 0.7 ? 1 : 0.05; l.ft = l.on < 1 ? rnd(0.03, 0.12) : rnd(0.5, 6); } f = l.on; }
        if (alarm) { const pulse = 0.25 + 0.75 * Math.pow(Math.abs(Math.sin(t * 2.6)), 2); l.L.color.setRGB(1, 0.12, 0.06); f *= pulse; }
        else l.L.color.set(l.L.isSpotLight ? 0xd8e4ff : 0xffe9cc);
        l.L.intensity = l.base * f;
        if (l.pm) l.pm.color.setRGB(f * (alarm ? 1 : 1), f * (alarm ? 0.15 : 0.95), f * (alarm ? 0.1 : 0.85));
      }
      if (card.visible) { card.rotation.y = t * 1.6; card.position.y = 1.25 + Math.sin(t * 2) * 0.05; }
      const arr = dg.attributes.position.array;
      for (let i = 0; i < N; i++) { arr[i * 3] += Math.sin(t * 0.3 + i) * 0.002; arr[i * 3 + 1] += Math.sin(t * 0.2 + i * 1.7) * 0.0012; }
      dg.attributes.position.needsUpdate = true;
    },
  };
}

let _rad;
function radial() {
  if (_rad) return _rad;
  const c = cv(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return (_rad = new THREE.CanvasTexture(c));
}
