// 큰 댐 = 실제 소수력 발전소: 중력식 콘크리트 댐 · 여수로 수직 리프트 수문(전동 권양기) ·
// 취수구(스크린) · 수압관 · 발전소(프랜시스 수차 + 동기 발전기 2기) · 방수로 · 변압기 · 송전선
import * as THREE from 'three';
import { CELL, NXV, X0, Z0, SX0, SX1, NZ, groundAt, centerX, floorHalf } from './terrain.js';
import * as W from './water.js';

const G = 9.81;
export let plant = null;
let group, MAT, sheetMat;
export function init(g, concrete, flowMat) { group = g; MAT = concrete; sheetMat = flowMat; }

// ── 기계 사양 (소수력 발전소 수준) ──
export const SPEC = {
  Qr: 0.28,     // 수차 정격 유량 m³/s
  Hr: 3.0,      // 정격 낙차 m
  Hmin: 0.8,    // 최소 운전 낙차 m
  sync: 600,    // 동기 속도 rpm (60 Hz, 12극)
  etaG: 0.96,   // 발전기 효율
  gateRate: 0.025, // 여수로 수문 모터 속도 (개도/초 = 2.5 %/s)
  wicketRate: 0.1, // 수차 가이드베인 서보 속도 (10 %/s)
  hoistKW: 2.2,    // 수문 권양 모터 소비 전력
  servoKW: 0.3,
  bayW: 1.8, sillDrop: 1.3, // 여수로 한 칸 폭, 마루에서 문턱까지 깊이
};
// 프랜시스 수차 효율: 개도 82% 근처에서 최고 93%
export const etaT = g => Math.max(0, 0.93 - 1.15 * (g - 0.82) ** 2 - (g < 0.25 ? (0.25 - g) * 1.6 : 0));

const steel = new THREE.MeshStandardMaterial({ color: 0x55636c, roughness: 0.42, metalness: 0.85 });
const paintY = new THREE.MeshStandardMaterial({ color: 0xe2b33a, roughness: 0.45, metalness: 0.4 });
const paintB = new THREE.MeshStandardMaterial({ color: 0x2f5f8a, roughness: 0.4, metalness: 0.5 });
const dark = new THREE.MeshStandardMaterial({ color: 0x262b30, roughness: 0.6, metalness: 0.5 });
const wall = new THREE.MeshStandardMaterial({ color: 0xc9c2b4, roughness: 0.85 });
const roofM = new THREE.MeshStandardMaterial({ color: 0x3d4a52, roughness: 0.55, metalness: 0.4 });
const glass = new THREE.MeshStandardMaterial({ color: 0x9cc8dc, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false });
const hallLight = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2d0, emissiveIntensity: 0 });
const mesh = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; (parent || group).add(m); return m; };

// 댐 단면(중력식): 상류면 수직, 마루 두께 1.2 m, 하류면 경사 0.75:1
function profileGeo(H, w, top = 0) {
  const sh = new THREE.Shape();
  const toe = 1.2 + 0.75 * (H - top);
  sh.moveTo(0, 0); sh.lineTo(0, H); sh.lineTo(1.2, H); sh.lineTo(toe, top > 0 ? 0 : 0); sh.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
  return g;
}

// 댐 단면 한 층(높이 ya~yb)의 사다리꼴 조각: 레고 블록처럼 위에서 떨어져 끼워진다
function sliceGeo(Hs, ya, yb, w) {
  const toe = 1.2 + 0.75 * Hs, xr = y => toe - (toe - 1.2) * (y / Hs);
  const sh = new THREE.Shape();
  sh.moveTo(0, ya); sh.lineTo(0, yb); sh.lineTo(xr(yb), yb); sh.lineTo(xr(ya), ya); sh.lineTo(0, ya);
  return new THREE.ExtrudeGeometry(sh, { depth: w - 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 });
}
const DROP = 5, FALL = 0.38, LAYER = 0.75;
export function build(zc, instant = false) {
  const cx = centerX(zc), bed = groundAt(cx, zc), crest = bed + 3.4, zU = zc - 0.6;
  const p = plant = { zc, cx, crest, zU, segs: [], gates: [], units: [], ready: false, t: 0, level: bed, tail: bed, head: 0, spillQ: 0, P: 0, load: 0, msg: '', queue: [] };
  // 1) 댐 몸체: 폭 2 m 칸을 가운데부터 양쪽 벽까지
  const w = 2.0, list = [];
  for (const side of [1, -1]) for (let n = side > 0 ? 0 : 1; n < 14; n++) {
    const x = cx + side * n * w;
    let g = 1e9; for (const dz of [0, 1.2, 2.5, 3.5]) for (const dx of [-w / 2, 0, w / 2]) g = Math.min(g, groundAt(x + dx, zc + dz - 0.6));
    list.push({ x, g });
    if (g > crest - 0.2) break; // 계곡 벽에 박히면 끝
  }
  list.sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx));
  let maxL = 0;
  for (const o of list) {
    const y0 = Math.min(o.g - 0.7, crest - 0.6), H = crest - y0; // 벽에 박히는 끝 칸도 높이는 최소 0.6 m
    const spill = Math.abs(o.x - cx) < 0.5 || Math.abs(o.x - (cx - w)) < 0.5; // 가운데 두 칸 = 여수로
    const Hs = H - (spill ? SPEC.sillDrop : 0);
    const seg = { x: o.x, w, y0, H, top: crest - (spill ? SPEC.sillDrop : 0), spill, layers: [], builtH: instant ? Hs : 0, toe: zU + 1.2 + 0.75 * Hs, ready: instant };
    const n = Math.max(1, Math.round(Hs / LAYER));
    for (let L = 0; L < n; L++) {
      const ya = Hs * L / n, yb = Hs * (L + 1) / n;
      const m = new THREE.Mesh(sliceGeo(Hs, ya, yb, w), MAT); m.castShadow = m.receiveShadow = true; m.layers.enable(1);
      m.rotation.y = -Math.PI / 2; m.position.set(o.x + w / 2 - 0.01, y0, zU);
      group.add(m);
      seg.layers.push({ mesh: m, yb });
    }
    maxL = Math.max(maxL, n);
    p.segs.push(seg);
  }
  if (instant) { commission(true); return p; }
  // 조립 순서: 아래층부터, 같은 층은 가운데 칸부터 바깥으로
  let t = 0;
  for (let L = 0; L < maxL; L++) for (const seg of p.segs) {
    const ly = seg.layers[L]; if (!ly) continue;
    queue(ly.mesh, t, () => { seg.builtH = ly.yb; p.changed = true; if (L === seg.layers.length - 1) seg.ready = true; });
    t += 0.11;
  }
  p.bodyEnd = t + FALL;
  return p;
}
// 대기열에 넣기: 위에서 떨어져(중력처럼 빨라지며) 제자리에 '딸깍' 끼워지고 살짝 튄다
function queue(obj, t0, onLand) {
  const ty = obj.position.y;
  obj.position.y = ty + DROP; obj.visible = false;
  plant.queue.push({ obj, ty, t0, onLand, landed: false });
}
// 2) 부속 설비: 완공 직후 설치
function commission(instant) {
  const p = plant, { cx, crest, zU } = p, sill = crest - SPEC.sillDrop, zD = zU + 1.2;
  const n0 = group.children.length;
  const sp = p.segs.filter(s => s.spill).sort((a, b) => a.x - b.x);
  // 교각 + 권양기 데크 + 수직 리프트 수문 + 전동 권양기
  const deckY = crest + 1.4;
  const xs = [sp[0].x - 1, sp[0].x + 1, sp[1].x + 1];
  for (const x of xs) mesh(new THREE.BoxGeometry(0.35, deckY - sill + 0.2, 1.4), MAT, x, (deckY + sill) / 2, zU + 0.7);
  mesh(new THREE.BoxGeometry(xs[2] - xs[0] + 0.4, 0.25, 1.6), MAT, (xs[0] + xs[2]) / 2, deckY + 0.12, zU + 0.7);
  for (const s of sp) {
    const gate = mesh(new THREE.BoxGeometry(SPEC.bayW, SPEC.sillDrop + 0.1, 0.14), paintB, s.x, sill + SPEC.sillDrop / 2, zU + 0.35);
    const ribs = new THREE.Group(); gate.add(ribs);
    for (let k = -1; k <= 1; k++) mesh(new THREE.BoxGeometry(SPEC.bayW, 0.06, 0.08), steel, 0, k * 0.4, 0.1, ribs);
    const motor = new THREE.Group(); motor.position.set(s.x, deckY + 0.25, zU + 0.7); group.add(motor);
    mesh(new THREE.BoxGeometry(0.9, 0.5, 0.7), paintY, 0, 0.25, 0, motor);
    mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 14).rotateZ(Math.PI / 2), dark, 0.62, 0.25, 0, motor);
    const drum = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 12).rotateZ(Math.PI / 2), steel, -0.1, 0.62, 0, motor);
    const lamp = mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0x331a0a, emissive: 0xff8a2a, emissiveIntensity: 0 }), 0.35, 0.56, 0.3, motor);
    const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x222222 }));
    group.add(cable);
    // 여수로 방류: 문턱 아래 칸 → 댐 아래 칸
    const g = { x: s.x, target: 0, open: 0, moving: false, gate, drum, lamp, cable, Q: 0 };
    g.pipe = { a: cellsAt(s.x, zU - 0.7, 1), b: cellsAt(s.x, s.toe + 1.0, 1), area: 0, Q: 0, head: 0, P: 0,
      qfn: (la) => { const a = g.open * SPEC.sillDrop, hc = la - (sill + a / 2); return a > 0.01 && hc > 0 ? 0.62 * SPEC.bayW * a * Math.sqrt(2 * G * hc) : 0; } };
    W.pipes.push(g.pipe);
    // 방류 물살(급류면)
    const len = Math.hypot(s.toe - zD, sill - s.y0);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SPEC.bayW, len, 1, 8), sheetMat);
    sheet.position.set(s.x, (sill + s.y0) / 2 + 0.06, (zD + s.toe) / 2); sheet.rotation.x = -Math.PI / 2 + Math.atan2(sill - s.y0, s.toe - zD);
    sheet.visible = false; group.add(sheet); g.sheet = sheet;
    p.gates.push(g);
  }
  // 마루 보도 난간
  const segs = [...p.segs].sort((a, b) => a.x - b.x), x0 = segs[0].x - 1, x1 = segs[segs.length - 1].x + 1;
  for (const zz of [zU + 0.05, zU + 1.15]) {
    mesh(new THREE.BoxGeometry(x1 - x0, 0.05, 0.05), steel, (x0 + x1) / 2, crest + 0.95, zz);
    for (let x = x0; x <= x1; x += 1.5) mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6), steel, x, crest + 0.48, zz);
  }
  // 발전소: 오른쪽 기슭, 댐 아래
  const px = cx + Math.min(4.6, floorHalf(zD + 3) * 0.7 + 1.4), pz = zD + 3.0, gy = Math.min(groundAt(px, pz), groundAt(px - 2, pz), groundAt(px + 2, pz)) - 0.2;
  const hall = new THREE.Group(); hall.position.set(px, gy, pz); group.add(hall);
  mesh(new THREE.BoxGeometry(5.2, 0.5, 3.6), MAT, 0, 0.25, 0, hall);
  mesh(new THREE.BoxGeometry(5.2, 3.0, 0.2), wall, 0, 2.0, -1.7, hall);
  mesh(new THREE.BoxGeometry(0.2, 3.0, 3.6), wall, -2.5, 2.0, 0, hall);
  mesh(new THREE.BoxGeometry(0.2, 3.0, 3.6), wall, 2.5, 2.0, 0, hall);
  const gl = mesh(new THREE.BoxGeometry(4.8, 2.6, 0.05), glass, 0, 1.85, 1.75, hall); gl.castShadow = false;
  mesh(new THREE.BoxGeometry(5.6, 0.25, 4.0), roofM, 0, 3.6, 0, hall);
  mesh(new THREE.BoxGeometry(4.6, 0.05, 0.25), hallLight, 0, 3.45, 0, hall);
  const sign = document.createElement('canvas'); sign.width = 256; sign.height = 48;
  { const c = sign.getContext('2d'); c.fillStyle = '#1d2a33'; c.fillRect(0, 0, 256, 48); c.fillStyle = '#ffd98a'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center'; c.fillText('계곡 수력발전소', 128, 33); }
  const st = new THREE.CanvasTexture(sign); st.colorSpace = THREE.SRGBColorSpace;
  mesh(new THREE.PlaneGeometry(2.2, 0.42), new THREE.MeshStandardMaterial({ map: st, roughness: 0.6 }), 0, 3.1, 1.8, hall);
  // 발전기 2기 (발전소 안): 고정자(노란 하우징) · 회전자 여자기(돌아가는 상부) · 운전 표시등
  for (const [k, ux] of [[0, -1.2], [1, 1.2]]) {
    const u = { k, x: px + ux, gate: 0, target: 0, rpm: 0, Q: 0, P: 0, eta: 0, state: '정지', sync: false };
    mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.9, 24), paintY, ux, 0.95, -0.3, hall);
    mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.15, 24), steel, ux, 1.47, -0.3, hall);
    const rotor = new THREE.Group(); rotor.position.set(ux, 1.6, -0.3); hall.add(rotor);
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 18), dark, 0, 0, 0, rotor);
    for (let n = 0; n < 6; n++) { const sp2 = mesh(new THREE.BoxGeometry(0.58, 0.05, 0.07), paintY, 0, 0.13, 0, rotor); sp2.rotation.y = n / 6 * Math.PI; }
    mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.45, 20), steel, ux, 0.55, 0.7, hall); // 나선형 케이싱(수차)
    u.rotor = rotor;
    u.lamp = mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3b2f, emissiveIntensity: 1.5 }), ux + 0.6, 1.25, 0.25, hall);
    // 취수구 스크린(상류면) + 수압관(댐 하류면 → 발전소)
    const ix = cx + 1.75 + k * 1.15, ib = groundAt(ix, zU - 0.6); // 취수구는 여수로 바로 옆 (물이 일찍 닿게)
    const rack = new THREE.Group(); rack.position.set(ix, Math.max(ib, crest - 3.0) + 0.6, zU - 0.04); group.add(rack);
    for (let b = -4; b <= 4; b++) mesh(new THREE.BoxGeometry(0.03, 1.1, 0.05), steel, b * 0.12, 0, 0, rack);
    const a = new THREE.Vector3(ix, crest - 1.6, zD + 0.6), bpt = new THREE.Vector3(px + ux, gy + 0.55, pz - 1.8);
    const pen = mesh(new THREE.CylinderGeometry(0.22, 0.22, a.distanceTo(bpt), 16), steel, (a.x + bpt.x) / 2, (a.y + bpt.y) / 2, (a.z + bpt.z) / 2);
    pen.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bpt.clone().sub(a).normalize());
    u.pipe = { a: cellsAt(ix, zU - 0.7, 1), b: cellsAt(cx + 1.6, pz + 2.6, 1), area: 0, Q: 0, head: 0, P: 0, qfn: (la, lb) => qUnit(u, la - lb) };
    W.pipes.push(u.pipe);
    p.units.push(u);
  }
  p.hall = hall; p.tailOut = [cx + 1.6, pz + 2.6];
  // 변압기 + 송전선 (발전소 → 하류 쪽 마을)
  const tr = new THREE.Group(); tr.position.set(px + 3.3, gy + 0.3, pz); group.add(tr);
  mesh(new THREE.BoxGeometry(0.9, 1.0, 0.7), paintB, 0, 0.5, 0, tr);
  for (let n = -3; n <= 3; n++) mesh(new THREE.BoxGeometry(0.04, 0.8, 0.8), steel, n * 0.12, 0.5, 0, tr);
  for (const d of [-0.25, 0, 0.25]) mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.35, 8), new THREE.MeshStandardMaterial({ color: 0x9a5a3a, roughness: 0.5 }), d, 1.15, 0, tr);
  const poles = [[px + 3.3, pz], [px + 4.2, pz + 6], [px + 4.6, pz + 13], [px + 4.2, pz + 20]];
  let prev = null;
  for (const [x, z] of poles) {
    const y = groundAt(x, z);
    mesh(new THREE.CylinderGeometry(0.07, 0.1, 5, 8), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 }), x, y + 2.5, z);
    mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), steel, x, y + 4.8, z);
    if (prev) for (const off of [-0.5, 0, 0.5]) {
      const A = new THREE.Vector3(prev[0] + off, prev[1] + 4.85, prev[2]), B = new THREE.Vector3(x + off, y + 4.85, z), mid = A.clone().lerp(B, 0.5); mid.y -= 0.35;
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(A, mid, B).getPoints(12)), new THREE.LineBasicMaterial({ color: 0x1a1a1a })));
    }
    prev = [x, y, z];
  }
  if (instant) { p.ready = true; return; }
  // 새로 생긴 부품들을 순서대로 떨어뜨려 조립 (방류 물살·케이블은 마지막에 보이게)
  let t = (p.bodyEnd ?? 0) + 0.4;
  for (const o of group.children.slice(n0)) {
    if (o === undefined || o.isLine || p.gates.some(g => g.sheet === o)) { if (o?.isLine) { o.visible = false; p.lines = (p.lines || []).concat(o); } continue; }
    queue(o, t, null); t += 0.07;
  }
  p.assembleEnd = t + FALL + 0.3;
}
const cellsAt = (x, z, r) => {
  const ci = Math.round((x - X0) / CELL), cj = Math.round((z - Z0) / CELL), out = [];
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) if (i >= SX0 && i < SX1 && j >= 0 && j <= NZ) out.push(j * NXV + i);
  return out;
};
// 수차 유량: 가이드베인 개도 × 정격유량 × √(H/Hr) — 정지·낙차 부족이면 0
function qUnit(u, H) { u.H = H; if (H < SPEC.Hmin || u.gate < 0.01) return 0; return u.gate * SPEC.Qr * Math.sqrt(Math.min(H, 6) / SPEC.Hr); }

// 물막이: 댐 단면(상류면 ~ 하류 끝)을 높이에 맞춰 막는다 (수문이 닫혀 있으면 여수로도 마루까지 막힘)
export function rasterize() {
  if (!plant) return;
  for (const s of plant.segs) {
    if (s.builtH <= 0) continue;
    const i0 = Math.max(SX0, Math.ceil((s.x - s.w / 2 - X0) / CELL)), i1 = Math.min(SX1 - 1, Math.floor((s.x + s.w / 2 - X0) / CELL));
    const j0 = Math.max(0, Math.ceil((plant.zU - Z0) / CELL)), j1 = Math.min(NZ, Math.floor((s.toe - Z0) / CELL));
    for (let j = j0; j <= j1; j++) {
      const z = Z0 + j * CELL, lz = z - plant.zU;
      const top = Math.min(s.y0 + s.builtH, lz <= 1.2 ? plant.crest : plant.crest - (lz - 1.2) / 0.75 - (s.spill ? SPEC.sillDrop : 0));
      for (let i = i0; i <= i1; i++) {
        const k = j * NXV + i;
        if (top > W.solid[k]) W.solid[k] = top;
        W.dam[k] = 1; if (s.y0 < W.sBot[k]) W.sBot[k] = s.y0;
      }
    }
  }
}

// 매 프레임: 건설 애니메이션 · 모터 · 발전기 · 표시
export function update(dt, energyOK, fx, dirt, snap) {
  const p = plant; if (!p) return { load: 0 };
  if (!p.ready) {
    p.t += dt;
    let left = 0;
    for (const q of p.queue) {
      if (q.done) continue; left++;
      if (p.t < q.t0) continue;
      q.obj.visible = true;
      const k = (p.t - q.t0) / FALL;
      if (k < 1) q.obj.position.y = q.ty + DROP * (1 - k * k); // 점점 빨라지며 떨어짐
      else {
        if (!q.landed) { q.landed = true; q.onLand?.(); if (snap) snap(q.obj.getWorldPosition(new THREE.Vector3()), !!q.onLand); }
        const b = (p.t - q.t0 - FALL) / 0.18; // 딸깍 튕김
        q.obj.position.y = q.ty + (b < 1 ? Math.sin(b * Math.PI) * 0.06 * (1 - b) : 0);
        if (b >= 1) { q.obj.position.y = q.ty; q.done = true; }
      }
    }
    if (!left && p.assembleEnd !== undefined) { p.ready = true; p.queue = []; for (const l of p.lines || []) l.visible = true; p.justDone = true; p.changed = true; }
    else if (!left && p.bodyEnd !== undefined && p.assembleEnd === undefined) { commission(false); }
    return { load: 0 };
  }
  let load = 0;
  // 수위: 댐 바로 위(저수위) / 방수로(하류 수위)
  const up = W.sample(p.cx, p.zU - 1.2), dn = W.sample(p.tailOut[0], p.tailOut[1]);
  p.level = up ? up.surf : p.level; p.tail = dn ? dn.surf : p.tail; p.head = Math.max(0, p.level - p.tail);
  // 여수로 수문: 전동 권양기로 천천히 오르내림 (전기가 없으면 멈춤)
  p.spillQ = 0;
  for (const g of p.gates) {
    const diff = g.target - g.open;
    g.moving = Math.abs(diff) > 0.003 && energyOK;
    if (g.moving) { g.open += Math.sign(diff) * Math.min(Math.abs(diff), SPEC.gateRate * dt); load += SPEC.hoistKW; g.drum.rotation.x += dt * 6 * Math.sign(diff); }
    g.stalled = Math.abs(diff) > 0.003 && !energyOK;
    const sill = p.crest - SPEC.sillDrop;
    g.gate.position.y = sill + SPEC.sillDrop / 2 + g.open * (SPEC.sillDrop + 0.2);
    g.cable.geometry.setFromPoints([new THREE.Vector3(g.x - 0.1, p.crest + 2.0, p.zU + 0.5), new THREE.Vector3(g.x, g.gate.position.y + SPEC.sillDrop / 2, p.zU + 0.38)]);
    g.lamp.material.emissiveIntensity = g.moving ? (Math.sin(performance.now() / 120) > 0 ? 3 : 0.3) : g.stalled ? 1.5 : 0;
    g.Q = g.pipe.Q; p.spillQ += g.Q;
    g.sheet.visible = g.Q > 0.01; g.sheet.material.uniforms && (g.sheet.material.uniforms.uOp.value = Math.min(1, g.Q * 2));
    if (fx && g.Q > 0.02 && Math.random() < 0.5) fx(g.x, groundAt(g.x, g.pipe.bz ?? p.zU + 6) + 0.2, p.segs.find(s => s.x === g.x).toe + 0.6, Math.min(1, g.Q * 1.5));
  }
  // 발전기: 가이드베인 서보 → 수차 유량 → 회전수 상승 → 동기 투입 후 발전
  p.P = 0;
  for (const u of p.units) {
    const diff = u.target - u.gate;
    if (Math.abs(diff) > 0.002 && energyOK) { u.gate += Math.sign(diff) * Math.min(Math.abs(diff), SPEC.wicketRate * dt); load += SPEC.servoKW; }
    u.Q = u.pipe.Q;
    const H = u.H ?? 0, drive = u.Q > 0.01 ? Math.min(1.08, u.Q / (0.12 * SPEC.Qr)) : 0;
    const tgt = SPEC.sync * Math.min(1, drive);
    u.rpm += (tgt - u.rpm) * Math.min(1, dt / (tgt > u.rpm ? 3.5 : 6)); // 관성: 기동 3.5초, 정지 6초
    u.sync = u.rpm > SPEC.sync * 0.97 && u.Q > 0.01;
    u.eta = u.sync ? etaT(u.gate) * SPEC.etaG : 0;
    u.P = u.sync ? 1000 * G * u.Q * H * u.eta : 0;
    p.P += u.P;
    u.state = H < SPEC.Hmin && u.target > 0 ? '낙차 부족' : u.sync ? '발전 중' : u.rpm > 20 ? (drive > 0 ? '기동 중' : '정지 중') : '정지';
    u.rotor.rotation.y += dt * u.rpm / 60 * Math.PI * 2 * 0.08; // 실제 600 rpm 은 너무 빨라 보이므로 화면 회전은 줄여 표시
    u.lamp.material.emissive.setHex(u.sync ? 0x2bff6a : u.rpm > 20 ? 0xffc02b : 0xff3b2f);
    if (fx && u.Q > 0.02 && Math.random() < 0.4) fx(p.tailOut[0], groundAt(p.tailOut[0], p.tailOut[1]) + 0.2, p.tailOut[1], Math.min(1, u.Q * 2));
  }
  hallLight.emissiveIntensity = p.P > 50 ? 2.2 : 0.4;
  p.load = load;
  return { load };
}
export const power = () => (plant && plant.ready ? plant.P : 0);
export const building = () => !!plant && !plant.ready;
export function serialize() {
  return plant && plant.ready ? { zc: plant.zc, g: plant.gates.map(g => [g.target, g.open]), u: plant.units.map(u => [u.target, u.gate]) } : null;
}
export function restore(o) {
  if (!o) return;
  build(o.zc, true);
  plant.gates.forEach((g, i) => { [g.target, g.open] = o.g[i] || [0, 0]; });
  plant.units.forEach((u, i) => { [u.target, u.gate] = o.u[i] || [0, 0]; });
}
