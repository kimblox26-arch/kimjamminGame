// SKY BLADE — 지하철역 (실제 역 위치: Overture 지하철역 점 + 실제 지하철 선로 방향)
//  - 출입구: 역 위 큰길 양쪽 보도에 4곳 (번호 출구), 유리 지붕 + 표지판, 지하 1층까지 계단
//  - 지하 1층 대합실: 개찰구, 역 이름판, 노선 색 띠, 형광등, 기둥, 승강장으로 내려가는 계단 2곳
//  - 지하 2층 승강장: 섬식 승강장, 스크린도어, 양쪽 선로, 열차가 들어와 서고 떠남
//  - 모든 계단·통로·대합실·승강장을 걸어 다닐 수 있음 (바닥 높이·벽·천장 물리)
//  카메라 400 m 안의 역만 만들고 멀어지면 버림
import * as THREE from 'three';
import { origin } from './frame.js';
import { attr, merge, box, railCarGeo, vehicleMat } from './models.js';

const D_CON = 7.6, D_PLAT = 15.2;           // 지표 → 대합실 / 승강장 바닥 깊이
const CON_L = 64, CON_W = 22, CON_H = 3.8;   // 대합실 크기
const PL_L = 150, PL_W = 9, TR_W = 5.4, PL_H = 4.6;
const STAIR_W = 3.2;
const LINE_COL = { 1: 0x0052a4, 2: 0x00a84d, 3: 0xef7c1c, 4: 0x00a5de, 5: 0x996cac, 6: 0xcd7c2f, 7: 0x747f00, 8: 0xe6186c, 9: 0xbdb092 };

function lineInfo(name) {
  name = name || '';
  const m = name.match(/(\d)\s*호선/);
  if (m) return { num: m[1], col: LINE_COL[+m[1]] };
  if (/신분당/.test(name)) return { num: 'S', col: 0xd4003b };
  if (/경의|중앙/.test(name)) return { num: '경', col: 0x77c4a3 };
  if (/공항/.test(name)) return { num: 'A', col: 0x0090d2 };
  if (/분당|수인/.test(name)) return { num: '수', col: 0xfabe00 };
  return { num: '', col: 0x00a84d };
}
function signTex(draw, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const FONT = 'system-ui, "Noto Sans KR", sans-serif';
function nameBoard(name, L) {
  return signTex((g, w, h) => {
    g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#' + L.col.toString(16).padStart(6, '0'); g.fillRect(0, h - 22, w, 22);
    g.beginPath(); g.arc(70, h / 2 - 8, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = `800 56px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(L.num, 70, h / 2 - 6);
    g.fillStyle = '#111'; g.font = `800 92px ${FONT}`; g.textAlign = 'left'; g.fillText(name, 140, h / 2 - 6);
  }, 1024, 200);
}
function exitSign(name, L, n) {
  return signTex((g, w, h) => {
    g.fillStyle = '#1b2430'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#' + L.col.toString(16).padStart(6, '0');
    g.beginPath(); g.arc(60, h / 2, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = `800 46px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(L.num, 60, h / 2 + 2);
    g.textAlign = 'left'; g.font = `800 60px ${FONT}`; g.fillText(name, 118, h / 2 + 2);
    g.fillStyle = '#f5b400'; g.fillRect(w - 120, 20, 100, h - 40);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.font = `900 76px ${FONT}`; g.fillText(String(n), w - 70, h / 2 + 4);
  }, 768, 140);
}

// 회전 상자 → 정점 (y 축 회전 a, 가운데 x,y,z)
function rbox(w, h, d, x, y, z, a, col, em = 0) {
  return attr(box(w, h, d, 0, 0, 0).rotateY(a).translate(x, y, z), col, 0, em, 0);
}

export class Stations {
  constructor(scene, game) {
    this.scene = scene; this.game = game;      // game: { roads, heightAt, roofAt }
    this.group = new THREE.Group(); this.group.name = 'stations';
    scene.add(this.group);
    this.mat = vehicleMat(0.05, 0.55);
    this.mat.side = THREE.DoubleSide;
    this.glass = new THREE.MeshStandardMaterial({ color: 0x9fc6d8, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    this.light = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.6, 2.45) });
    this.carMat = vehicleMat(0.7, 0.3);
    this.carGeo = { cab: railCarGeo(true), mid: railCarGeo(false) };
    this.built = new Map();     // 점 번호 → 역
    this.vols = [];             // 걸을 수 있는 공간 (모든 역)
    const R = game.roads, P = R.points;
    this.list = [];
    if (P) for (let j = 0; j < P.n; j++) if (P.kind[j] === 6) this.list.push(j);
    this.inside = false;
  }

  // 역 하나 만들기
  _build(j) {
    const R = this.game.roads, P = R.points, H = this.game.heightAt;
    const sx = P.x[j], sz = P.z[j], g0 = H(sx, sz);
    const name = (P.names[P.nameIx[j]] || '').replace(/역$/, '');
    // 가장 가까운 지하철 선로 → 승강장 방향, 노선
    let ux = 1, uz = 0, best = 220, lname = '';
    const RL = R.rails;
    if (RL) {
      const ti = Math.floor(sx / 300), tj = Math.floor(sz / 300);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const E = R.index.get((ti + di) * 100000 + (tj + dj));
        if (!E) continue;
        for (let q = 0; q < E.rsegs.length; q += 2) {
          const i = E.rsegs[q], k = E.rsegs[q + 1];
          const ax = RL.pts[k * 2], az = RL.pts[k * 2 + 1], bx = RL.pts[k * 2 + 2], bz = RL.pts[k * 2 + 3];
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sz - az) * dz) / l2));
          const d = Math.hypot(ax + dx * t - sx, az + dz * t - sz) + (RL.cls[i] === 0 ? 0 : 60);
          if (d < best) { best = d; const l = Math.sqrt(l2); ux = dx / l; uz = dz / l; lname = RL.names[RL.nameIx[i]] || ''; }
        }
      }
    }
    const L = lineInfo(lname);
    const vx = -uz, vz = ux;                      // 가로 방향
    const ang = Math.atan2(ux, uz);               // 지역 +z = 선로 방향
    const yC = g0 - D_CON, yP = g0 - D_PLAT;
    const st = { j, sx, sz, g0, ang, ux, uz, name, L, group: new THREE.Group(), inner: new THREE.Group(), vols: [], cuts: [], trains: [] };
    const inner = st.inner;           // 역 지역 좌표 (+z 선로 방향, 원점 = 역 가운데, y 는 절대 높이)
    const loc = (a, b) => [sx + vx * a + ux * b, sz + vz * a + uz * b];   // 지역 (x 가로, z 길이) → 절대
    const parts = [];
    const A = (w, h, d, x, y, z, col, em = 0) => parts.push(attr(box(w, h, d, x, y, z), col, 0, em, 0));
    // ── 대합실 (지역 좌표, y 는 절대 높이) ──
    const hx = CON_W / 2, hz = CON_L / 2;
    // 바닥 (계단 구멍 피해서 띠로 나눔)
    for (const [z0, z1] of [[-hz, -18], [-6, 6], [18, hz]]) A(CON_W, 0.3, z1 - z0, 0, yC - 0.15, (z0 + z1) / 2, 0xcfccc4);
    for (const s of [-1, 1]) { const z0 = s > 0 ? 6 : -18, z1 = s > 0 ? 18 : -6; A(hx - STAIR_W / 2 - 0.2, 0.3, z1 - z0, -(hx + STAIR_W / 2 + 0.2) / 2, yC - 0.15, (z0 + z1) / 2, 0xcfccc4); A(hx - STAIR_W / 2 - 0.2, 0.3, z1 - z0, (hx + STAIR_W / 2 + 0.2) / 2, yC - 0.15, (z0 + z1) / 2, 0xcfccc4); }
    A(CON_W, 0.3, CON_L, 0, yC + CON_H + 0.15, 0, 0xe9e9e6);                                 // 천장
    for (const s of [-1, 1]) {
      A(0.3, CON_H, CON_L, s * (hx + 0.15), yC + CON_H / 2, 0, 0xe6e6e2);                    // 옆벽
      A(0.05, 0.35, CON_L - 1, s * hx, yC + 2.6, 0, L.col, 0.25);                             // 노선 색 띠
      A(CON_W, CON_H, 0.3, 0, yC + CON_H / 2, s * (hz + 0.15), 0xe6e6e2);                    // 끝벽
    }
    // 형광등 줄, 기둥
    for (let z = -hz + 4; z <= hz - 4; z += 6) for (const x of [-6, 0, 6]) parts.push(attr(box(0.3, 0.06, 2.4, x, yC + CON_H - 0.03, z), 0xffffff, 0, 3.0, 0));
    for (let z = -hz + 8; z <= hz - 8; z += 12) for (const x of [-5.5, 5.5]) A(0.7, CON_H, 0.7, x, yC + CON_H / 2, z, 0xd8d6d0);
    // 개찰구 (가운데를 가로지르는 줄), 승차권 발매기
    for (let x = -hx + 2; x <= hx - 2; x += 1.3) { A(0.25, 1.0, 1.4, x, yC + 0.5, 0, 0x8a9096); A(0.2, 0.05, 1.3, x, yC + 1.02, 0, 0x30d060, 1.2); }
    for (const x of [-hx + 0.6, hx - 0.6]) for (const z of [-10, -12, 10, 12]) A(0.7, 1.8, 0.9, x, yC + 0.9, z, 0x4a5a6a);
    // 승강장으로 내려가는 계단 (난간 포함)
    const stair = (x, z0, z1, y0, y1, w, list) => {
      const n = Math.max(2, Math.round(Math.abs(y0 - y1) / 0.17)), dz = (z1 - z0) / n, dy = (y1 - y0) / n;
      for (let k = 0; k < n; k++) list.push(attr(box(w, Math.abs(dy) + 0.02, Math.abs(dz) + 0.02, x, y0 + dy * (k + 0.5) - Math.abs(dy) / 2, z0 + dz * (k + 0.5)), 0xbdbab3, 0, 0, 0));
    };
    for (const s of [-1, 1]) {
      const z0 = s > 0 ? 6 : -6, z1 = s > 0 ? 18.8 : -18.8;
      stair(0, z0, z1, yC, yP, STAIR_W, parts);
      for (const x of [-1, 1]) A(0.08, 1.0, Math.abs(z1 - z0), x * (STAIR_W / 2 + 0.1), (yC + yP) / 2 + 0.5, (z0 + z1) / 2, 0x777777);
      st.vols.push(this._vol(loc(0, (z0 + z1) / 2), ux * s, uz * s, Math.abs(z1 - z0) / 2 + 0.2, STAIR_W / 2, yC, yP, 3.0));
    }
    // ── 승강장 (섬식) + 선로 + 터널 ──
    const ph = PL_L / 2, tw = PL_W / 2 + TR_W;
    A(PL_W, 1.1, PL_L, 0, yP - 0.55, 0, 0xcac7c0);                                           // 승강장 바닥
    for (const s of [-1, 1]) {
      A(0.35, 0.02, PL_L, s * (PL_W / 2 - 0.6), yP + 0.01, 0, 0xf2c200, 0.2);                // 노란 점자 블록
      // 스크린도어: 유리 칸 + 틀 (문은 열차가 서면 열림 → 따로)
      for (let z = -ph + 1; z < ph - 1; z += 2.2) A(0.08, 2.3, 0.12, s * PL_W / 2, yP + 1.15, z, 0x7c838a);
      A(0.1, 0.4, PL_L, s * PL_W / 2, yP + 2.5, 0, 0x2b3138);
      A(0.1, 0.15, PL_L, s * PL_W / 2, yP + 2.38, 0, L.col, 0.6);
      A(TR_W, 0.3, PL_L + 20, s * (PL_W / 2 + TR_W / 2), yP - 1.25, 0, 0x3a3631);               // 선로 바닥
      for (const r of [-0.72, 0.72]) A(0.08, 0.16, PL_L + 20, s * (PL_W / 2 + TR_W / 2) + r, yP - 1.02, 0, 0x8a8a8a);
      A(0.3, PL_H + 1.4, PL_L + 20, s * (tw + 0.15), yP - 1.4 + (PL_H + 1.4) / 2, 0, 0xd8d8d2);  // 바깥 벽
      A(0.05, 0.6, PL_L, s * tw, yP + 1.6, 0, L.col, 0.25);
    }
    A(tw * 2, 0.3, PL_L + 20, 0, yP + PL_H + 0.15, 0, 0xe0e0dc);                              // 천장
    for (const s of [-1, 1]) { A(PL_W, PL_H, 0.3, 0, yP + PL_H / 2, s * (ph + 0.15), 0xe0e0dc); A(tw * 2, PL_H + 1.4, 0.3, 0, yP - 1.4 + (PL_H + 1.4) / 2, s * (ph + 10.2), 0x101010); }
    for (let z = -ph + 3; z <= ph - 3; z += 5) parts.push(attr(box(0.3, 0.06, 2.6, 0, yP + PL_H - 0.03, z), 0xffffff, 0, 3.0, 0));
    for (let z = -ph + 10; z <= ph - 10; z += 20) A(0.6, PL_H, 0.6, 0, yP + PL_H / 2, z, 0xd2d0ca);
    st.vols.push(this._vol(loc(0, 0), ux, uz, ph - 0.3, PL_W / 2 - 0.35, yP, yP, PL_H));
    st.vols.push(this._vol(loc(0, 0), ux, uz, hz - 0.3, hx - 0.35, yC, yC, CON_H));
    // 이름판 (대합실 양 끝벽, 승강장 벽)
    const nb = nameBoard(name || '역', L);
    const nbMat = new THREE.MeshBasicMaterial({ map: nb });
    for (const [x, y, z, ry, s] of [[0, yC + 2.6, hz - 0.05, Math.PI, 1], [0, yC + 2.6, -hz + 0.05, 0, 1], [tw - 0.06, yP + 2.6, 30, -Math.PI / 2, 1.3], [-tw + 0.06, yP + 2.6, -30, Math.PI / 2, 1.3], [tw - 0.06, yP + 2.6, -30, -Math.PI / 2, 1.3], [-tw + 0.06, yP + 2.6, 30, Math.PI / 2, 1.3]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6 * s, 1.1 * s), nbMat);
      m.position.set(x, y, z); m.rotation.y = ry;
      inner.add(m);
    }
    // ── 출입구: 큰길 양쪽 보도 (없으면 선로 방향 양옆) ──
    const exits = this._exits(sx, sz, ux, uz);
    exits.forEach((e, n) => this._entrance(st, e, n + 1, yC, L, name, loc, ux, uz, vx, vz));
    // 메시 (지역 좌표 → 회전·이동)
    const geo = merge(parts);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    inner.add(mesh);
    inner.rotation.y = ang;
    st.group.add(inner);
    // 열차 두 편성 (양쪽 선로), 8칸
    for (const s of [-1, 1]) {
      const cab = new THREE.InstancedMesh(this.carGeo.cab, this.carMat, 2), mid = new THREE.InstancedMesh(this.carGeo.mid, this.carMat, 6);
      for (let k = 0; k < 2; k++) cab.setColorAt(k, new THREE.Color(L.col));
      for (let k = 0; k < 6; k++) mid.setColorAt(k, new THREE.Color(L.col));
      cab.frustumCulled = mid.frustumCulled = false;
      inner.add(cab, mid);
      st.trains.push({ s, cab, mid, ph: Math.random() * 100, x: s * (PL_W / 2 + TR_W / 2), dir: -s });
    }
    this.group.add(st.group);
    // 지형 파내기 (출입구 계단 구멍)
    if (this.game.roads.addCut) for (const c of st.cuts) this.game.roads.addCut(c);
    return st;
  }

  // 걸을 수 있는 회전 상자: 가운데 (x,z), 길이 방향 (ax,az), 반길이 hl, 반폭 hw, 바닥 높이 (-hl 쪽 y0 → +hl 쪽 y1), 천장 높이 h
  _vol([cx, cz], ax, az, hl, hw, y0, y1, h) { return { cx, cz, ax, az, hl, hw, y0, y1, h }; }

  // 출입구 자리: 역에서 가장 가까운 차도 (40 m 안) 양쪽 보도, 역 앞뒤 ±32 m
  _exits(sx, sz, ux, uz) {
    const R = this.game.roads, out = [];
    const nr = R.nearestRoad(sx, sz, 45, true);
    if (nr) {
      const [p, k, , dx, dz] = nr;
      const L = R.roads;
      let s0 = 0; for (let q = L.start[p] + 1; q <= k; q++) s0 += Math.hypot(L.pts[q * 2] - L.pts[q * 2 - 2], L.pts[q * 2 + 1] - L.pts[q * 2 - 1]);
      const ax = L.pts[k * 2], az = L.pts[k * 2 + 1];
      const t0 = (sx - ax) * dx + (sz - az) * dz;
      for (const along of [-32, 32]) for (const side of [1, -1]) {
        const s = s0 + t0 + along;
        const [rw, sw] = R.edges(p, Math.max(0, Math.min(L.len[p], s)), side > 0 ? 0 : 1);
        const off = rw + Math.max(1.9, Math.min(sw, 4) * 0.5);
        const cx = ax + dx * (t0 + along) - dz * off * side, cz = az + dz * (t0 + along) + dx * off * side;
        // 계단은 역 쪽(가운데)으로 내려감
        const dir = along > 0 ? -1 : 1;
        out.push({ x: cx, z: cz, dx: dx * dir, dz: dz * dir });
      }
    } else {
      for (const along of [-30, 30]) for (const side of [1, -1]) {
        const cx = sx + ux * along - uz * 14 * side, cz = sz + uz * along + ux * 14 * side;
        out.push({ x: cx, z: cz, dx: -ux * Math.sign(along), dz: -uz * Math.sign(along) });
      }
    }
    return out;
  }

  // 출입구 하나: 유리 지붕 + 표지판 + 지하 1층까지 계단 + 대합실까지 통로
  _entrance(st, e, n, yC, L, name, loc, ux, uz, vx, vz) {
    const H = this.game.heightAt;
    const yE = H(e.x, e.z) + 0.15;
    const run = Math.max(6, (yE - yC) / Math.tan(30 * Math.PI / 180));
    const a = Math.atan2(e.dx, e.dz);
    const parts = [];
    const nSt = Math.max(2, Math.round((yE - yC) / 0.17)), dzS = run / nSt, dyS = (yE - yC) / nSt;
    const W = STAIR_W;
    // 계단 (지역: +z = 내려가는 방향)
    for (let k = 0; k < nSt; k++) parts.push(attr(box(W, dyS + 0.03, dzS + 0.02, 0, yE - dyS * (k + 1) + dyS / 2, dzS * (k + 0.5)), 0xbdbab3, 0, 0, 0));
    for (const x of [-1, 1]) {
      // 옆벽 (지표에서 계단 아래 통로 천장 높이까지, 계단 경사를 따라), 손잡이
      const wall = new THREE.BufferGeometry();
      const xw = x * (W / 2 + 0.12);
      wall.setAttribute('position', new THREE.Float32BufferAttribute([xw, yE + 0.1, 0, xw, yE - 3.2, 0, xw, yC + 3.2, run, xw, yE - 3.2, 0, xw, yC - 0.1, run, xw, yC + 3.2, run], 3));
      wall.computeVertexNormals();
      parts.push(attr(wall, 0xe2e0da, 0, 0.15, 0));
      const hr = new THREE.BoxGeometry(0.06, 0.06, Math.hypot(run, yE - yC));
      hr.rotateX(Math.atan2(yE - yC, run)).translate(x * (W / 2 - 0.05), (yE + yC) / 2 + 0.95, run / 2);
      parts.push(attr(hr, 0x8a8f94, 0, 0, 0));
    }
    // 유리 지붕 틀 (계단 구멍 전체를 덮음): 기둥, 지붕 테두리
    const cl = run, ch = 2.9;
    for (const x of [-1, 1]) for (const z of [0.2, cl]) parts.push(attr(box(0.12, ch, 0.12, x * (W / 2 + 0.25), yE + ch / 2, z), 0x3a3f45, 0, 0, 0));
    parts.push(attr(box(W + 0.8, 0.14, cl + 0.4, 0, yE + ch + 0.07, cl / 2), 0x3a3f45, 0, 0, 0));
    parts.push(attr(box(W + 0.6, 0.5, 0.1, 0, yE + ch - 0.25, 0.1), 0x1b2430, 0, 0, 0));
    // 지면 쪽 낮은 벽 (계단 구멍 둘레 난간)
    for (const x of [-1, 1]) parts.push(attr(box(0.15, 1.0, cl, x * (W / 2 + 0.2), yE + 0.5, cl / 2 + 0.2), 0xc8c6c0, 0, 0, 0));
    parts.push(attr(box(W + 0.5, 1.0, 0.15, 0, yE + 0.5, cl + 0.3), 0xc8c6c0, 0, 0, 0));
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(merge(parts), this.mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    // 유리 (지붕·옆·뒤)
    const gl = [new THREE.BoxGeometry(W + 0.6, 0.04, cl + 0.3).translate(0, yE + ch + 0.17, cl / 2)];
    for (const x of [-1, 1]) gl.push(new THREE.BoxGeometry(0.03, ch - 1.0, cl).translate(x * (W / 2 + 0.25), yE + 1.0 + (ch - 1.0) / 2, cl / 2 + 0.2));
    gl.push(new THREE.BoxGeometry(W + 0.5, ch - 1.0, 0.03).translate(0, yE + 1.0 + (ch - 1.0) / 2, cl + 0.3));
    for (const q of gl) { const m = new THREE.Mesh(q, this.glass); m.renderOrder = 2; g.add(m); }
    // 표지판 (입구 위 앞면)
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.5, (W + 0.5) * 140 / 768), new THREE.MeshBasicMaterial({ map: exitSign(name, L, n) }));
    sg.position.set(0, yE + ch - 0.25, 0.04); sg.rotation.y = Math.PI;
    g.add(sg);
    g.position.set(e.x, 0, e.z); g.rotation.y = a;
    st.group.add(g);
    // 공간: 계단 (위 → 아래)
    const bx = e.x + e.dx * run, bz = e.z + e.dz * run;
    st.vols.push(this._vol([(e.x + bx) / 2, (e.z + bz) / 2], e.dx, e.dz, run / 2 + 0.15, W / 2 - 0.1, yE - 0.15, yC, 3.0));
    // 지형 파내기: 계단 구멍 (지붕 아래로 열림)
    st.cuts.push({ cx: (e.x + bx) / 2, cz: (e.z + bz) / 2, ax: e.dx, az: e.dz, hl: run / 2, hw: W / 2 + 0.1, y0: yE - 0.3, y1: yC, top: 30000 });
    // 통로: 계단 아래에서 대합실 가장자리까지
    const rx = bx - st.sx, rz = bz - st.sz;
    const lv = rx * vx + rz * vz, lu = rx * ux + rz * uz;          // 대합실 지역 좌표
    const cx = Math.max(-CON_W / 2 + 1.5, Math.min(CON_W / 2 - 1.5, lv)), cu = Math.max(-CON_L / 2 + 1.5, Math.min(CON_L / 2 - 1.5, lu));
    const tx = st.sx + vx * cx + ux * cu, tz = st.sz + vz * cx + uz * cu;
    const dl = Math.hypot(tx - bx, tz - bz);
    if (dl > 0.5) {
      const ax = (tx - bx) / dl, az = (tz - bz) / dl, ca = Math.atan2(ax, az);
      const cp = [];
      cp.push(attr(box(W + 0.4, 0.3, dl + 2, 0, yC - 0.15, 0), 0xcfccc4, 0, 0, 0), attr(box(W + 0.4, 0.3, dl + 2, 0, yC + 3.15, 0), 0xe9e9e6, 0, 0, 0));
      for (const x of [-1, 1]) cp.push(attr(box(0.3, 3.0, dl + 2, x * (W / 2 + 0.35), yC + 1.5, 0), 0xe6e6e2, 0, 0.12, 0), attr(box(0.05, 0.3, dl + 1.6, x * (W / 2 + 0.19), yC + 2.3, 0), L.col, 0, 0.3, 0));
      for (let z = -dl / 2; z <= dl / 2; z += 4) cp.push(attr(box(0.3, 0.06, 1.8, 0, yC + 2.97, z), 0xffffff, 0, 3.0, 0));
      const cm = new THREE.Mesh(merge(cp), this.mat);
      cm.position.set((bx + tx) / 2, 0, (bz + tz) / 2); cm.rotation.y = ca;
      st.group.add(cm);
      st.vols.push(this._vol([(bx + tx) / 2, (bz + tz) / 2], ax, az, dl / 2 + 1, W / 2 + 0.15, yC, yC, 3.0));
    }
  }

  _drop(st) {
    this.group.remove(st.group);
    st.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map) { o.material.map.dispose(); o.material.dispose(); } });
    if (this.game.roads.removeCut) for (const c of st.cuts) this.game.roads.removeCut(c);
  }

  update(dt, camAbs, show) {
    this.group.visible = show;
    // 가까운 역 만들기 (한 프레임에 하나), 먼 역 버리기
    if (show) {
      let todo = -1, bd = 400;
      for (const j of this.list) {
        const P = this.game.roads.points, d = Math.hypot(P.x[j] - camAbs.x, P.z[j] - camAbs.z);
        if (d < bd && !this.built.has(j)) { bd = d; todo = j; }
      }
      if (todo >= 0) this.built.set(todo, this._build(todo));
    }
    for (const [j, st] of this.built) {
      if (Math.hypot(st.sx - camAbs.x, st.sz - camAbs.z) > 650) { this._drop(st); this.built.delete(j); }
    }
    this.vols.length = 0;
    for (const st of this.built.values()) {
      for (const v of st.vols) this.vols.push(v);
      st.group.position.set(-origin.x, -origin.y, -origin.z);
      st.inner.position.set(st.sx, 0, st.sz);
      // 열차: 들어와서 30 초 서 있다가 떠남 (100 초 주기)
      for (const T of st.trains) {
        const t0 = T.ph;
        T.ph = (T.ph + dt) % 100;
        const t = T.ph;
        // 소리: 도착 알림, 문 열림·닫힘
        const A = this.game.audio && this.game.audio.city, cam = this.game.camera;
        if (A && cam) {
          // 지역 (x, z) → 절대: 지역 +x = (uz, −ux), +z = (ux, uz)
          const ax = st.sx + st.uz * T.x, az = st.sz - st.ux * T.x, ay = st.g0 - D_PLAT + 2;
          if (t0 < 4 && t >= 4) A.event('chime', ax, ay, az, cam, 1.2);
          if ((t0 < 19 && t >= 19) || (t0 < 45 && t >= 45)) A.event('door', ax, ay, az, cam, 1);
        }
        let z;
        if (t < 18) z = 400 * Math.pow(1 - t / 18, 2);                 // 감속하며 도착
        else if (t < 48) z = 0;                                           // 정차
        else if (t < 66) z = -400 * Math.pow((t - 48) / 18, 2);           // 가속하며 출발
        else z = 1e4;
        z *= T.dir;
        const vis = Math.abs(z) < 300;
        T.cab.visible = T.mid.visible = vis;
        if (!vis) continue;
        const M = _m, Y = st.g0 - D_PLAT - 1.05;
        for (let k = 0; k < 8; k++) {
          const cz = z + (k - 3.5) * 20.2;
          _q.setFromAxisAngle(_Y, k === 0 ? Math.PI : 0);
          _p.set(T.x, Y, cz);
          if (k === 0) T.cab.setMatrixAt(0, M.compose(_p, _q, _s));
          else if (k === 7) { _q.setFromAxisAngle(_Y, 0); T.cab.setMatrixAt(1, M.compose(_p, _q, _s)); }
          else T.mid.setMatrixAt(k - 1, M.compose(_p, _q, _s));
        }
        T.cab.instanceMatrix.needsUpdate = T.mid.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** 소리용: 역 열차 위치·속도 [거리, {x, z, v, tx, tz, dir, accel}, y] */
  trainSources(cam) {
    const out = [];
    for (const st of this.built.values()) for (const T of st.trains) {
      if (!T.cab.visible) continue;
      const t = T.ph;
      const z = t < 18 ? 400 * Math.pow(1 - t / 18, 2) * T.dir : t < 48 ? 0 : -400 * Math.pow((t - 48) / 18, 2) * T.dir;
      const v = t < 18 ? 800 / 18 * (1 - t / 18) : t < 48 ? 0 : 800 / 18 * (t - 48) / 18;
      const lx = T.x, x = st.sx + st.uz * lx + st.ux * z, zz = st.sz - st.ux * lx + st.uz * z;
      const y = st.g0 - D_PLAT;
      const src = T.src || (T.src = {});
      Object.assign(src, { x, z: zz, v, tx: st.ux, tz: st.uz, dir: -T.dir, accel: t >= 48 ? 1 : 0 });
      out.push([Math.hypot(x - cam.x, y - cam.y, zz - cam.z), src, y]);
    }
    return out;
  }

  /** 절대 (x,z) 에서 발 높이 y 근처 역 바닥: { y, top, v } 또는 null */
  floorAt(x, z, y) {
    let best = null, by = -1e9;
    for (const v of this.vols) {
      const dx = x - v.cx, dz = z - v.cz;
      const a = dx * v.ax + dz * v.az, b = dx * -v.az + dz * v.ax;
      if (Math.abs(a) > v.hl || Math.abs(b) > v.hw) continue;
      const f = v.y0 + (v.y1 - v.y0) * (a / v.hl * 0.5 + 0.5);
      if (y < f - 1.6 || y > f + v.h) continue;
      if (f > by) { by = f; best = v; }
    }
    if (!best) return null;
    const o = this._fo || (this._fo = {});
    o.y = by; o.top = by + best.h; o.v = best;
    return o;
  }

  /** 역 안(지표 아래)에 있으면 걸을 수 있는 공간 밖으로 못 나감 */
  constrain(P, ground) {
    const ax = P.pos.x + origin.x, ay = P.pos.y + origin.y - 1, az = P.pos.z + origin.z;
    this.inside = false;
    if (!this.vols.length || ay > ground - 0.8) return false;
    // 지금 들어 있는 공간이 있으면 그대로
    let near = null, nd = 1e9, np = null;
    for (const v of this.vols) {
      const dx = ax - v.cx, dz = az - v.cz;
      const a = dx * v.ax + dz * v.az, b = dx * -v.az + dz * v.ax;
      const f = v.y0 + (v.y1 - v.y0) * (Math.max(-1, Math.min(1, a / v.hl)) * 0.5 + 0.5);
      if (ay < f - 2 || ay > f + v.h + 1) continue;
      const ca = Math.max(-v.hl, Math.min(v.hl, a)), cb = Math.max(-(v.hw - 0.3), Math.min(v.hw - 0.3, b));
      const d = Math.hypot(a - ca, b - cb);
      if (d < nd) { nd = d; near = v; np = [ca, cb, f]; }
      if (d === 0) break;
    }
    if (!near) return false;
    this.inside = true;
    if (nd > 0) {
      const [ca, cb] = np;
      P.pos.x = near.cx + near.ax * ca - near.az * cb - origin.x;
      P.pos.z = near.cz + near.az * ca + near.ax * cb - origin.z;
      P.vel.x *= 0.3; P.vel.z *= 0.3;
    }
    const ceil = np[2] + near.h - origin.y - 0.4;
    if (P.pos.y > ceil) { P.pos.y = ceil; if (P.vel.y > 0) P.vel.y = 0; }
    return true;
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0);
