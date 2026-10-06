// 부품 형상 생성: 모서리 모따기 + 세분화(찌그러짐 표현) + 미터 단위 UV
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 모따기된 직육면체. grain: UV u 방향으로 쓸 로컬 축(나뭇결/압연 방향), seg: 세분 간격(m)
export function blockGeo(sx, sy, sz, { bevel = 0.0015, seg = 0, grain = -1, ox = 0, oy = 0, oz = 0 } = {}) {
  const h = [sx / 2, sy / 2, sz / 2];
  const r = Math.min(bevel, h[0] * 0.3, h[1] * 0.3, h[2] * 0.3);
  const n = h.map((v) => (seg > 0 ? Math.max(1, Math.min(48, Math.round((v * 2) / seg))) : 1));
  const pos = [], uv = [], idx = [];
  const off = [ox, oy, oz];
  const add = (p, u, v) => { pos.push(p[0] + off[0], p[1] + off[1], p[2] + off[2]); uv.push(u, v); return pos.length / 3 - 1; };
  const tri = (a, b, c, nx, ny, nz) => {
    const A = a * 3, B = b * 3, C = c * 3;
    const e1 = [pos[B] - pos[A], pos[B + 1] - pos[A + 1], pos[B + 2] - pos[A + 2]], e2 = [pos[C] - pos[A], pos[C + 1] - pos[A + 1], pos[C + 2] - pos[A + 2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * nx + cy * ny + cz * nz < 0) idx.push(a, c, b); else idx.push(a, b, c);
  };
  const faces = {};
  for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
    let b = (a + 1) % 3, c = (a + 2) % 3;
    // u 축 선택: 결 방향 우선, 아니면 긴 축
    if (grain === c || (grain !== b && h[c] > h[b])) [b, c] = [c, b];
    const nb = n[b], nc = n[c], grid = [];
    for (let j = 0; j <= nc; j++) for (let i = 0; i <= nb; i++) {
      const p = [0, 0, 0];
      p[a] = s * h[a]; p[b] = -h[b] + r + ((2 * h[b] - 2 * r) * i) / nb; p[c] = -h[c] + r + ((2 * h[c] - 2 * r) * j) / nc;
      grid.push(add(p, p[b], p[c]));
    }
    const nrm = [0, 0, 0]; nrm[a] = s;
    for (let j = 0; j < nc; j++) for (let i = 0; i < nb; i++) {
      const k = j * (nb + 1) + i;
      tri(grid[k], grid[k + 1], grid[k + nb + 1], ...nrm); tri(grid[k + 1], grid[k + nb + 2], grid[k + nb + 1], ...nrm);
    }
    faces[a + (s > 0 ? 'p' : 'n')] = true;
  }
  if (r > 0) {
    // 모서리 띠: 축 e 를 따라 면 (a,sa) 와 (b,sb) 사이
    for (let e = 0; e < 3; e++) {
      const a = (e + 1) % 3, b = (e + 2) % 3;
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const ne = n[e], row = [];
        for (let k = 0; k <= ne; k++) {
          const t = -h[e] + r + ((2 * h[e] - 2 * r) * k) / ne;
          const p1 = [0, 0, 0], p2 = [0, 0, 0];
          p1[e] = t; p1[a] = sa * h[a]; p1[b] = sb * (h[b] - r);
          p2[e] = t; p2[a] = sa * (h[a] - r); p2[b] = sb * h[b];
          row.push([add(p1, t, p1[b]), add(p2, t, p2[a] + 0.003)]);
        }
        const nrm = [0, 0, 0]; nrm[a] = sa; nrm[b] = sb;
        for (let k = 0; k < ne; k++) { tri(row[k][0], row[k + 1][0], row[k][1], ...nrm); tri(row[k + 1][0], row[k + 1][1], row[k][1], ...nrm); }
      }
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const s = [sx, sy, sz], v = [];
      for (let a = 0; a < 3; a++) { const p = s.map((si, i) => si * (h[i] - (i === a ? 0 : r))); v.push(add(p, p[(a + 1) % 3], p[(a + 2) % 3])); }
      tri(v[0], v[1], v[2], sx, sy, sz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 원통(축 X), 미터 UV. open: 뚜껑 없음, inner: 안쪽 면
function cylX(r, len, seg, { open = false, inner = false, ox = 0 } = {}) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, open);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * len);
  if (inner) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i)); }
  g.rotateZ(-Math.PI / 2); g.translate(ox, 0, 0);
  return g;
}
function ringX(rIn, rOut, seg, x, flip) {
  const g = new THREE.RingGeometry(rIn, rOut, seg, 1);
  g.rotateY(flip ? -Math.PI / 2 : Math.PI / 2); g.translate(x, 0, 0); return g;
}

// 형상별 시각 지오메트리 + 충돌 형상(로컬). dims = [x,y,z] (m)
export function shapeFor(def, dims, dentable) {
  const [X, Y, Z] = dims, seg = dentable ? 0.035 : 0;
  const t = def.wall || 0.003;
  switch (def.shape) {
    case 'box': {
      const grain = def.grain ?? (X >= Z ? 0 : 2);
      return { geo: blockGeo(X, Y, Z, { seg, grain, bevel: def.bevel ?? Math.min(0.002, Math.min(X, Y, Z) * 0.2) }), cols: [{ t: 'box', h: [X / 2, Y / 2, Z / 2], p: [0, 0, 0] }] };
    }
    case 'sqtube': {
      const parts = [
        blockGeo(X, t, Z, { oy: Y / 2 - t / 2, grain: 0 }), blockGeo(X, t, Z, { oy: -Y / 2 + t / 2, grain: 0 }),
        blockGeo(X, Y - 2 * t, t, { oz: Z / 2 - t / 2, grain: 0 }), blockGeo(X, Y - 2 * t, t, { oz: -Z / 2 + t / 2, grain: 0 }),
      ];
      return { geo: mergeGeometries(parts), cols: [{ t: 'box', h: [X / 2, Y / 2, Z / 2], p: [0, 0, 0] }] };
    }
    case 'hbeam': {
      const tf = def.tf, tw = def.tw, bev = 0.002;
      const g = mergeGeometries([
        blockGeo(X, tf, Z, { oy: Y / 2 - tf / 2, grain: 0, bevel: bev }), blockGeo(X, tf, Z, { oy: -Y / 2 + tf / 2, grain: 0, bevel: bev }),
        blockGeo(X, Y - 2 * tf + 0.002, tw, { grain: 0, bevel: 0.001 }),
      ]);
      return { geo: g, cols: [
        { t: 'box', h: [X / 2, tf / 2, Z / 2], p: [0, Y / 2 - tf / 2, 0] }, { t: 'box', h: [X / 2, tf / 2, Z / 2], p: [0, -Y / 2 + tf / 2, 0] },
        { t: 'box', h: [X / 2, Y / 2 - tf, tw / 2], p: [0, 0, 0] }] };
    }
    case 'angle': {
      const g = mergeGeometries([
        blockGeo(X, t, Z, { oy: -Y / 2 + t / 2, grain: 0, bevel: 0.001 }), blockGeo(X, Y - t + 0.001, t, { oy: t / 2, oz: -Z / 2 + t / 2, grain: 0, bevel: 0.001 }),
      ]);
      return { geo: g, cols: [{ t: 'box', h: [X / 2, t / 2, Z / 2], p: [0, -Y / 2 + t / 2, 0] }, { t: 'box', h: [X / 2, (Y - t) / 2, t / 2], p: [0, t / 2, -Z / 2 + t / 2] }] };
    }
    case 'pipe': {
      const r = Y / 2, ri = r - t;
      const g = mergeGeometries([cylX(r, X, 28, { open: true }), cylX(ri, X, 28, { open: true, inner: true }), ringX(ri, r, 28, X / 2, false), ringX(ri, r, 28, -X / 2, true)].map((q) => q.index ? q : q));
      return { geo: g, cols: [{ t: 'cylX', r, hl: X / 2, p: [0, 0, 0] }] };
    }
  }
  return null;
}

// ─── 기계 부품 (여러 재질로 구성: [{geo, skin, paint?, emissive?}]) ───
export function wheelParts(R, W, rimSkin = 'alu') {
  const rIn = R * 0.62, x0 = (R + rIn) / 2, hx = (R - rIn) / 2, hy = W / 2, N = 20, e = 0.32;
  // 타이어 단면 (lathe: x=반경, y=축방향) — 초타원으로 각진 숄더
  const pts = [new THREE.Vector2(rIn, -W * 0.42)];
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / N, c = Math.cos(a), sn = Math.sin(a);
    pts.push(new THREE.Vector2(x0 + hx * Math.pow(Math.max(c, 0), e), hy * Math.sign(sn) * Math.pow(Math.abs(sn), e)));
  }
  pts.push(new THREE.Vector2(rIn, W * 0.42));
  const tire = new THREE.LatheGeometry(pts, 48);
  const uv = tire.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * R, uv.getY(i) * W * 1.6);
  tire.rotateZ(Math.PI / 2);
  // 휠(림): 접시형 + 스포크 + 허브 + 너트
  const rimProf = [[rIn - 0.004, -W * 0.42], [rIn, -W * 0.36], [rIn * 0.96, -W * 0.3], [rIn * 0.95, W * 0.25], [rIn, W * 0.36], [rIn - 0.004, W * 0.42], [rIn * 0.9, W * 0.38], [rIn * 0.88, -W * 0.25]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const rim = new THREE.LatheGeometry(rimProf, 40); rim.rotateZ(Math.PI / 2);
  const parts = [rim];
  for (let i = 0; i < 6; i++) {
    const s = blockGeo(0.02 + R * 0.04, rIn * 0.75, R * 0.1, { bevel: 0.004 }); s.translate(W * 0.18, rIn * 0.5, 0); s.rotateX((i / 6) * Math.PI * 2); parts.push(s);
  }
  const hub = cylX(R * 0.17, W * 0.3, 20, { ox: W * 0.2 }); parts.push(hub);
  const nuts = [];
  for (let i = 0; i < 5; i++) { const nt = cylX(R * 0.022, 0.03, 6, { ox: W * 0.36 }); nt.translate(0, Math.cos((i / 5) * Math.PI * 2) * R * 0.11, Math.sin((i / 5) * Math.PI * 2) * R * 0.11); nuts.push(nt); }
  const cap = cylX(R * 0.07, W * 0.06, 16, { ox: W * 0.37 });
  return [{ geo: tire, skin: 'tire', spin: true }, { geo: mergeGeometries(parts.map(toNonIdx)), skin: rimSkin, spin: true }, { geo: mergeGeometries([...nuts, cap].map(toNonIdx)), skin: 'brushed', spin: true }];
}
const toNonIdx = (g) => { const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); return q; };
const mg = (arr) => mergeGeometries(arr.map(toNonIdx));
const box = (x, y, z, px, py, pz, bev = 0.006) => { const g = blockGeo(x, y, z, { bevel: bev }); g.translate(px, py, pz); return g; };
const cyl = (r, l, px, py, pz, axis = 'y', seg = 16) => { const g = new THREE.CylinderGeometry(r, r, l, seg); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); g.translate(px, py, pz); return g; };

export function engineParts(kind) {
  if (kind === 'v8') { // 크기 ~0.75×0.65×0.8, 로컬 -Z가 전방(크랭크 축 = Z)
    const block = [box(0.42, 0.34, 0.66, 0, -0.1, 0, 0.02), box(0.34, 0.12, 0.6, 0, -0.32, 0, 0.02)];
    const heads = [], covers = [], red = [];
    for (const s of [-1, 1]) {
      const hd = box(0.2, 0.12, 0.62, 0, 0, 0, 0.012); hd.rotateZ(s * 0.78); hd.translate(s * 0.25, 0.12, 0); heads.push(hd);
      const vc = box(0.17, 0.07, 0.58, 0, 0, 0, 0.02); vc.rotateZ(s * 0.78); vc.translate(s * 0.31, 0.19, 0); covers.push(vc);
      for (let i = 0; i < 4; i++) { const ex = cyl(0.022, 0.18, s * 0.38, 0.0, -0.22 + i * 0.15, 'x', 10); heads.push(ex); }
    }
    red.push(...covers);
    const intake = [box(0.22, 0.1, 0.5, 0, 0.2, 0, 0.02), cyl(0.15, 0.06, 0, 0.32, 0, 'y', 28)];
    const pul = [cyl(0.09, 0.03, 0, -0.05, -0.36, 'z', 24), cyl(0.06, 0.03, 0.12, 0.08, -0.36, 'z', 20), cyl(0.06, 0.03, -0.14, 0.06, -0.36, 'z', 20)];
    return [{ geo: mg([...block, ...heads]), skin: 'cast' }, { geo: mg(red), skin: 'paint', paint: 0xb3121a }, { geo: mg(intake), skin: 'alu' }, { geo: mg(pul), skin: 'brushed' }, { geo: cyl(0.135, 0.02, 0, 0.36, 0, 'y', 28), skin: 'paint', paint: 0x151515 }];
  }
  if (kind === 'motor') { // 전기 모터
    const body = cylX(0.16, 0.36, 32); const fins = []; for (let i = 0; i < 12; i++) { const f = box(0.34, 0.012, 0.03, 0, 0, 0, 0.002); f.translate(0, 0.165, 0); f.rotateX((i / 12) * Math.PI * 2); fins.push(f); }
    return [{ geo: mg([body, ...fins]), skin: 'paint', paint: 0x1d4f91 }, { geo: mg([cylX(0.04, 0.12, 16, { ox: 0.22 }), box(0.14, 0.08, 0.18, 0, 0.17, 0, 0.01)]), skin: 'brushed' }];
  }
  // 소형 단기통 엔진 (고카트)
  return [
    { geo: mg([box(0.22, 0.2, 0.26, 0, -0.04, 0, 0.015), box(0.14, 0.16, 0.14, 0.03, 0.12, 0, 0.015)]), skin: 'cast' },
    { geo: mg((() => { const a = []; for (let i = 0; i < 7; i++) a.push(box(0.18, 0.008, 0.18, 0.03, 0.08 + i * 0.022, 0, 0.002)); return a; })()), skin: 'alu' },
    { geo: mg([box(0.16, 0.12, 0.08, -0.04, 0.1, 0.17, 0.02), cyl(0.06, 0.06, -0.14, 0.02, 0, 'x', 20)]), skin: 'paint', paint: 0xd8441c },
    { geo: mg([cyl(0.02, 0.2, 0.18, -0.02, 0.05, 'x', 10)]), skin: 'brushed' },
  ];
}

export function seatParts() { // 로컬 -Z = 전방, 바닥 y=-0.25
  const base = box(0.46, 0.1, 0.46, 0, -0.15, 0.02, 0.04), back = box(0.46, 0.6, 0.1, 0, 0.15, 0.24, 0.04);
  back.rotateX(-0.18); back.translate(0, 0, -0.03);
  const bols = [box(0.07, 0.14, 0.42, 0.22, -0.08, 0.02, 0.03), box(0.07, 0.14, 0.42, -0.22, -0.08, 0.02, 0.03)];
  const frame = [box(0.5, 0.04, 0.04, 0, -0.23, 0.2, 0.005), box(0.5, 0.04, 0.04, 0, -0.23, -0.18, 0.005), box(0.04, 0.04, 0.42, 0.23, -0.23, 0, 0.005), box(0.04, 0.04, 0.42, -0.23, -0.23, 0, 0.005)];
  const col = cyl(0.02, 0.62, 0, 0.0, -0.42, 'z', 12); col.rotateX(0.0); const colT = new THREE.Matrix4().makeRotationX(-0.55); col.applyMatrix4(colT); col.translate(0, 0.05, -0.18);
  const wheel = new THREE.TorusGeometry(0.17, 0.018, 10, 36); wheel.rotateX(-0.55 + Math.PI / 2 - Math.PI / 2); wheel.translate(0, 0.2, -0.5);
  const spokes = [box(0.3, 0.02, 0.01, 0, 0.2, -0.5, 0.003), box(0.02, 0.15, 0.01, 0, 0.13, -0.5, 0.003)];
  spokes.forEach((s) => { s.translate(0, -0.2, 0.5); s.applyMatrix4(new THREE.Matrix4().makeRotationX(-0.55)); s.translate(0, 0.2, -0.5); });
  wheel.translate(0, -0.2, 0.5); wheel.applyMatrix4(new THREE.Matrix4().makeRotationX(-0.55)); wheel.translate(0, 0.2, -0.5);
  return [{ geo: mg([base, back, ...bols]), skin: 'fabric' }, { geo: mg(frame), skin: 'paint', paint: 0x202020 }, { geo: mg([col]), skin: 'brushed' }, { geo: mg([wheel, ...spokes]), skin: 'fabric' }];
}

export function lightParts() { // +Z = 빛 방향
  return [
    { geo: mg([cyl(0.09, 0.12, 0, 0, -0.01, 'z', 24), box(0.08, 0.06, 0.06, 0, -0.1, -0.03, 0.01)]), skin: 'paint', paint: 0x1a1a1a },
    { geo: cyl(0.08, 0.02, 0, 0, 0.055, 'z', 24), skin: 'brushed', emissive: 0xfff4dd },
  ];
}
export function thrusterParts() { // +Z = 분사 방향
  const prof = [[0.05, -0.3], [0.13, -0.28], [0.14, -0.05], [0.07, 0.02], [0.08, 0.06], [0.17, 0.3], [0.16, 0.3], [0.07, 0.07]].map(([x, y]) => new THREE.Vector2(x, y));
  const noz = new THREE.LatheGeometry(prof, 32); noz.rotateX(Math.PI / 2);
  return [{ geo: noz, skin: 'cast' }, { geo: mg([cyl(0.15, 0.04, 0, 0, -0.18, 'z', 28), box(0.1, 0.1, 0.12, 0, 0.15, -0.18, 0.01)]), skin: 'paint', paint: 0xe0a020 }];
}

// ─── 체결 부품 시각물 ───
export const FAST = {
  bead: (() => { const g = new THREE.SphereGeometry(1, 10, 6); g.scale(0.0075, 0.0042, 0.0075); return g; })(),
  mortar: (() => { const g = new THREE.SphereGeometry(1, 8, 5); g.scale(0.022, 0.012, 0.022); return g; })(),
  nailShaft: (() => { const g = new THREE.CylinderGeometry(0.0016, 0.0016, 0.075, 6); g.translate(0, -0.0375, 0); return g; })(),
  nailHead: (() => { const g = new THREE.CylinderGeometry(0.0042, 0.0042, 0.0012, 12); return g; })(),
  boltHead: (() => mg([new THREE.CylinderGeometry(0.0095, 0.0095, 0.008, 6).translate(0, 0.0055, 0), new THREE.CylinderGeometry(0.013, 0.013, 0.0025, 20).translate(0, 0.00125, 0)]))(),
  clamp: (() => mg([box(0.02, 0.16, 0.03, 0, 0, 0, 0.004), box(0.11, 0.02, 0.03, 0.045, 0.07, 0, 0.004), box(0.11, 0.02, 0.03, 0.045, -0.07, 0, 0.004)]))(),
  clampScrew: (() => mg([cyl(0.006, 0.09, 0.09, -0.07, 0, 'y', 8), cyl(0.016, 0.006, 0.09, 0.0, 0, 'y', 16), cyl(0.004, 0.06, 0.09, -0.12, 0, 'x', 6)]))(),
};
