// 완성 예제(키트): 부품 배치 + 접촉면 자동 접합(용접/못/볼트/모르타르)
import * as THREE from 'three';
import { CAT_BY_ID } from './catalog.js';

const R90 = Math.PI / 2;
const P = (id, p, r = [0, 0, 0], dims = null, paint = null, pin = false) => ({ id, p, r, dims, paint, pin });

function kart() {
  const red = 0xd8441c, L = [];
  for (const s of [-1, 1]) L.push(P('sqtube', [s * 0.36, 0.16, 0], [0, R90, 0], [1.7, 0.05, 0.05], red));
  for (const z of [-0.75, 0, 0.75]) L.push(P('sqtube', [0, 0.16, z], [0, 0, 0], [0.67, 0.05, 0.05], red));
  L.push(P('plate3', [0, 0.1865, 0.1], [0, 0, 0], [0.77, 0.003, 1.3]));
  L.push(P('pipe', [0, 0.16, -0.88], [0, 0, 0], [0.86, 0.0605, 0.0605], 0x161616));
  L.push(P('seat', [0, 0.438, 0.12]));
  L.push(P('engS', [0.2, 0.338, 0.62]));
  for (const s of [-1, 1]) for (const z of [-0.68, 0.68]) L.push(P('wheelS', [s * 0.455, 0.16, z], [0, s > 0 ? 0 : Math.PI, 0]));
  return L;
}
function buggy() {
  const org = 0xff6a13, blk = 0x161616, L = [];
  for (const s of [-1, 1]) L.push(P('rtube', [s * 0.6, 0.55, 0], [0, R90, 0], [3.0, 0.1, 0.05], org));
  for (const z of [-1.4, -0.5, 0.5, 1.4]) L.push(P('rtube', [0, 0.55, z], [0, 0, 0], [1.15, 0.1, 0.05], org));
  L.push(P('checker', [0, 0.60225, 0.2], [0, 0, 0], [1.25, 0.0045, 2.0]));
  const y0 = 0.6045;
  for (const s of [-1, 1]) for (const z of [-0.35, 0.85]) L.push(P('pipe', [s * 0.55, y0 + 0.55, z], [0, 0, R90], [1.1, 0.0605, 0.0605], blk));
  for (const z of [-0.35, 0.85]) L.push(P('pipe', [0, y0 + 1.1 + 0.03, z], [0, 0, 0], [1.16, 0.0605, 0.0605], blk));
  for (const s of [-1, 1]) L.push(P('pipe', [s * 0.55, y0 + 1.1 + 0.03, 0.25], [0, R90, 0], [1.14, 0.0605, 0.0605], blk));
  L.push(P('seat', [0, y0 + 0.25, 0.15]));
  L.push(P('engV8', [0, y0 + 0.35, 1.12]));
  for (const s of [-1, 1]) L.push(P('light', [s * 0.4, 0.55, -1.495], [0, Math.PI, 0]));
  for (const s of [-1, 1]) for (const z of [-1.2, 1.2]) L.push(P('wheelL', [s * 0.785, 0.55, z], [0, s > 0 ? 0 : Math.PI, 0]));
  return L;
}
function shed() {
  const L = [], W = 2.4, D = 1.8, t = 0.038, w = 0.089, H = 2.1;
  for (const s of [-1, 1]) L.push(P('2x4', [0, t / 2, s * (D / 2 - w / 2)], [0, 0, 0], [W, t, w], null, true));
  for (const s of [-1, 1]) L.push(P('2x4', [s * (W / 2 - w / 2), t / 2, 0], [0, R90, 0], [D - 2 * w, t, w], null, true));
  const yS = t + H / 2;
  for (const s of [-1, 1]) for (const x of [-W / 2 + t / 2, -0.6, 0, 0.6, W / 2 - t / 2]) L.push(P('2x4', [x, yS, s * (D / 2 - w / 2)], [0, 0, R90], [H, t, w]));
  for (const s of [-1, 1]) for (const z of [-0.3, 0.3]) L.push(P('2x4', [s * (W / 2 - w / 2), yS, z], [0, R90, R90], [H, t, w]));
  const yT = t + H + t / 2;
  for (const s of [-1, 1]) L.push(P('2x4', [0, yT, s * (D / 2 - w / 2)], [0, 0, 0], [W, t, w]));
  for (const s of [-1, 1]) L.push(P('2x4', [s * (W / 2 - w / 2), yT, 0], [0, R90, 0], [D - 2 * w, t, w]));
  L.push(P('plywood', [0, yT + t / 2 + 0.009, -0.29], [0, 0, 0], [2.44, 0.018, 1.22]));
  L.push(P('plywood', [0, yT + t / 2 + 0.009, 0.61], [0, 0, 0], [2.44, 0.018, 0.6]));
  return L;
}
function wall() {
  const L = [], bx = 0.19, by = 0.057, n = 12, rows = 10;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bx / 2 : 0;
    for (let i = 0; i < n - (r % 2); i++) L.push(P('brick', [-((n - 1) * bx) / 2 + i * bx + off, by / 2 + r * by, 0]));
  }
  return L;
}
function tower() {
  const L = [], h = 4.0, a = 0.5, by = 0.012;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    L.push(P('plate12', [sx * a, by / 2, sz * a], [0, 0, 0], [0.25, by, 0.25], null, true));
    L.push(P('sqtube', [sx * a, by + h / 2, sz * a], [0, 0, R90], [h, 0.05, 0.05], 0x2b5ea8));
  }
  for (const y of [1, 2, 3, h - 0.025 + by]) {
    for (const s of [-1, 1]) {
      L.push(P('sqtube', [0, y, s * a], [0, 0, 0], [2 * a - 0.05, 0.05, 0.05], 0xe8a812));
      L.push(P('sqtube', [s * a, y, 0], [0, R90, 0], [2 * a - 0.05, 0.05, 0.05], 0xe8a812));
    }
  }
  L.push(P('checker', [0, by + h + 0.00225, 0], [0, 0, 0], [1.2, 0.0045, 1.2]));
  return L;
}
const KITS = { kart, buggy, shed, wall, tower };
const SIZES = { kart: [1.05, 0.9, 1.9], buggy: [1.9, 1.8, 3.2], shed: [2.5, 2.3, 1.9], wall: [2.3, 0.6, 0.12], tower: [1.3, 4.1, 1.3] };

// OBB 최근접점
function closest(p, c, q, h, out) {
  const l = p.clone().sub(c).applyQuaternion(q.clone().invert());
  l.set(Math.max(-h.x, Math.min(h.x, l.x)), Math.max(-h.y, Math.min(h.y, l.y)), Math.max(-h.z, Math.min(h.z, l.z)));
  return out.copy(l.applyQuaternion(q).add(c));
}

export class Presets {
  constructor(g) { this.g = g; }
  size(kit) { return SIZES[kit] || [1, 1, 1]; }
  spawn(kit, pos, quat) {
    const g = this.g, mgr = g.mgr, list = KITS[kit]();
    const S = mgr.newStructure(pos.clone().add(new THREE.Vector3(0, 0.005, 0)), quat, false);
    const parts = list.map((e) => {
      const def = CAT_BY_ID[e.id], p = mgr.createPart(def, e.dims || def.dims, e.paint);
      p.lp.fromArray(e.p); p.lq.setFromEuler(new THREE.Euler(...e.r)); mgr.attach(p, S, null, null);
      p.pinned = e.pin; return p;
    });
    this.autoJoin(parts);
    for (const p of parts) if (p.pinned) mgr.addFastener(null, p, 'anchor', new THREE.Vector3(0, p.dims[1] / 2, 0), new THREE.Vector3(0, 1, 0));
    if (parts.some((p) => p.pinned)) S.body.setBodyType(g.ph.R.RigidBodyType.Fixed, true);
    mgr.dirty.add(S); mgr.flushDirty(); mgr.rebuildRig(S);
    g.ui.toast(`${CAT_BY_ID['kit-' + kit]?.name || kit} 설치 완료`);
    return S;
  }
  // 맞닿은 부품 쌍을 찾아 재질에 맞는 방식으로 접합
  autoJoin(parts) {
    const mgr = this.g.mgr, ob = parts.map((p) => ({ p, c: p.lp, q: p.lq, h: new THREE.Vector3(...p.dims).multiplyScalar(0.5) }));
    const a1 = new THREE.Vector3(), b1 = new THREE.Vector3();
    for (let i = 0; i < ob.length; i++) for (let j = i + 1; j < ob.length; j++) {
      const A = ob[i], B = ob[j];
      if (A.c.distanceTo(B.c) > A.h.length() + B.h.length() + 0.01) continue;
      closest(B.c, A.c, A.q, A.h, a1);
      for (let k = 0; k < 4; k++) { closest(a1, B.c, B.q, B.h, b1); closest(b1, A.c, A.q, A.h, a1); }
      if (a1.distanceTo(b1) > 0.004) continue;
      const pa = A.p, pb = B.p, mid = a1.clone().add(b1).multiplyScalar(0.5);
      let kind, host = pa, other = pb, n = 2;
      if (pa.def.mech || pb.def.mech) { kind = 'bolt'; n = 2; if (pb.def.mech) { host = pb; other = pa; } }
      else if (pa.mat.metal && pb.mat.metal) { kind = 'bead'; n = 9; }
      else if (pa.mat.wood || pb.mat.wood) { kind = 'nail'; n = 3; if (!pa.mat.wood) { host = pb; other = pa; } }
      else if (pa.mat.masonry || pb.mat.masonry) { kind = 'mortar'; n = 2; }
      else { kind = 'bolt'; n = 1; }
      const jt = mgr.connect(host, other);
      // host 로컬에서 접합선 배치
      const hq = host.lq.clone().invert(), lm = mid.clone().sub(host.lp).applyQuaternion(hq);
      const od = other.lp.clone().sub(host.lp).applyQuaternion(hq);
      const hh = host.dims.map((d) => d / 2);
      const ax = [0, 1, 2].sort((x, y) => Math.abs(od.getComponent(y)) / (hh[y] + 1e-3) - Math.abs(od.getComponent(x)) / (hh[x] + 1e-3))[0];
      const nrm = new THREE.Vector3().setComponent(ax, Math.sign(od.getComponent(ax)) || 1);
      const tan = [0, 1, 2].filter((x) => x !== ax).sort((x, y) => hh[y] - hh[x])[0];
      for (let k = 0; k < n; k++) {
        const lp = lm.clone(); lp.setComponent(ax, nrm.getComponent(ax) * hh[ax]);
        const sp = kind === 'bead' ? 0.011 : kind === 'nail' ? 0.03 : 0.05;
        lp.setComponent(tan, Math.max(-hh[tan], Math.min(hh[tan], lm.getComponent(tan) + (k - (n - 1) / 2) * sp)));
        if (kind === 'bead') { const o = [0, 1, 2].find((x) => x !== ax && x !== tan); lp.setComponent(o, lm.getComponent(o)); }
        const outN = kind === 'nail' || kind === 'bolt' ? nrm.clone().negate() : nrm.clone();
        if (kind === 'nail' || kind === 'bolt') lp.setComponent(ax, -nrm.getComponent(ax) * hh[ax]);
        const f = mgr.addFastener(jt, host, kind, lp, outN, { stage: 3, t0: mgr.time - 60 });
        if (kind === 'nail') mgr.setNailStage(f);
      }
    }
  }
}
