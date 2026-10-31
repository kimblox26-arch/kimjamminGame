// 열차 3D 모델: 단면을 길이 방향으로 이어 붙여(로프트) 차체를 만들고, 앞부분은 노즈 모양으로 줄인다
import * as THREE from 'three';
import { canvasTex } from './builders.js';

const NOSE = {
  tgv: { len: 9.5, tipH: 0.18, tipW: 0.12, pw: 0.55, ph: 0.75, glass: [0.32, 0.62] },
  sancheon: { len: 8.6, tipH: 0.22, tipW: 0.14, pw: 0.5, ph: 0.7, glass: [0.3, 0.6] },
  cheongryong: { len: 9.2, tipH: 0.16, tipW: 0.1, pw: 0.6, ph: 0.85, glass: [0.3, 0.62] },
  eum: { len: 6.8, tipH: 0.3, tipW: 0.2, pw: 0.5, ph: 0.6, glass: [0.25, 0.58] },
  itx: { len: 3.4, tipH: 0.55, tipW: 0.55, pw: 0.45, ph: 0.5, glass: [0.12, 0.55] },
  metro: { len: 0.7, tipH: 0.86, tipW: 0.9, pw: 0.5, ph: 0.5, glass: [0.02, 0.6] },
  loco: { len: 1.4, tipH: 0.8, tipW: 0.86, pw: 0.6, ph: 0.6, glass: [0.05, 0.6] },
  diesel: { len: 2.2, tipH: 0.72, tipW: 0.8, pw: 0.6, ph: 0.4, glass: [0.08, 0.55] },
};

// 단면(오른쪽 절반 → 전체 둘레), y 는 레일면 기준
function section(w, h, y0) {
  const r = [[0, y0], [w * 0.36, y0], [w * 0.47, y0 + 0.18], [w * 0.5, y0 + 0.6], [w * 0.5, y0 + (h - y0) * 0.62], [w * 0.47, h - 0.62], [w * 0.4, h - 0.22], [w * 0.22, h - 0.04], [0, h]];
  const full = r.map(p => [p[0], p[1]]);
  for (let i = r.length - 2; i > 0; i--) full.push([-r[i][0], r[i][1]]);
  return full; // 닫힌 둘레 (마지막→처음 연결)
}

function loftCar(len, w, h, y0, noseF, noseB, uvLen) {
  const sec = section(w, h, y0), ns = sec.length;
  const xs = [], st = 14;
  const nose = (N, dir) => { for (let k = 0; k <= st; k++) { const t = k / st; xs.push([dir * (len / 2 - N.len * t), N.tipW + (1 - N.tipW) * Math.pow(t, N.pw), N.tipH + (1 - N.tipH) * Math.pow(t, N.ph)]); } };
  if (noseB) nose(noseB, -1); else xs.push([-len / 2, 1, 1]);
  if (noseF) nose(noseF, 1); else xs.push([len / 2, 1, 1]);
  xs.sort((a, b) => a[0] - b[0]);
  const pos = [], uv = [], idx = [];
  for (const [x, sw, sh] of xs) for (const [px, py] of sec) {
    pos.push(x, y0 + (py - y0) * sh, px * sw);
    uv.push((x + len / 2) / uvLen, (py - y0) / (h - y0));
  }
  const rings = xs.length;
  for (let r = 0; r < rings - 1; r++) for (let k = 0; k < ns; k++) {
    const a = r * ns + k, b = r * ns + (k + 1) % ns, c = a + ns, d = b + ns; idx.push(a, c, b, b, c, d);
  }
  // 끝 마개
  for (const r of [0, rings - 1]) {
    const cx = xs[r][0], ci = pos.length / 3; let cy = 0; for (const [, py] of sec) cy += py; cy /= ns;
    pos.push(cx, y0 + (cy - y0) * xs[r][2], 0); uv.push(r ? 1 : 0, 0.5);
    for (let k = 0; k < ns; k++) { const a = r * ns + k, b = r * ns + (k + 1) % ns; r ? idx.push(ci, b, a) : idx.push(ci, a, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 도장(외관) 텍스처
function livery(spec, car, len, noseF, noseB, stripe, stripe2, emissive) {
  const W = 2048, H = 256, ppm = W / len;
  return canvasTex(W, H, (g) => {
    const Y = v => H - v * H; // v: 0 아래 ~ 1 위
    const dark = emissive;
    g.fillStyle = dark ? '#000' : (car.loco ? spec.loco : spec.body); g.fillRect(0, 0, W, H);
    const metro = spec.kind === 'metro', hsr = spec.kind === 'hsr';
    const winLo = metro ? 0.42 : 0.47, winHi = metro ? 0.78 : 0.7;
    if (!dark) {
      // 띠
      g.fillStyle = stripe; g.fillRect(0, Y(winLo - 0.04), W, (metro ? 0.07 : 0.09) * H);
      g.fillStyle = stripe2; g.fillRect(0, Y(hsr ? 0.24 : 0.2), W, 0.05 * H);
      if (hsr) { g.fillStyle = stripe; g.fillRect(0, Y(0.95), W, 0.04 * H); }
      if (metro) { g.fillStyle = stripe; g.fillRect(0, Y(0.9), W, 0.04 * H); }
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, Y(0.04), W, 0.04 * H);
      // 지붕
      g.fillStyle = metro ? '#9a9ea2' : '#c9ccd0'; g.fillRect(0, 0, W, Y(0.985));
    }
    const noseLenF = noseF ? noseF.len : 0, noseLenB = noseB ? noseB.len : 0;
    const x0 = noseLenB * ppm + (noseB ? 1.2 * ppm : 0.8 * ppm), x1 = W - noseLenF * ppm - (noseF ? 2.6 * ppm : 0.8 * ppm);
    const win = (x, w) => {
      if (dark) { g.fillStyle = '#ffe2b0'; g.fillRect(x, Y(winHi), w, (winHi - winLo) * H); }
      else {
        const gr = g.createLinearGradient(0, Y(winHi), 0, Y(winLo)); gr.addColorStop(0, '#2a3440'); gr.addColorStop(0.5, '#141a20'); gr.addColorStop(1, '#0c1014');
        g.fillStyle = gr; g.beginPath(); g.roundRect(x, Y(winHi), w, (winHi - winLo) * H, 0.12 * ppm); g.fill();
      }
    };
    const door = x => { if (dark) return; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 3; g.strokeRect(x, Y(0.86), 1.3 * ppm, 0.8 * H); g.fillStyle = '#1a2026'; g.fillRect(x + 0.2 * ppm, Y(0.78), 0.9 * ppm, 0.28 * H); };
    if (car.loco) {
      if (!dark) { g.fillStyle = '#e8e8e8'; g.fillRect(0, Y(0.62), W, 0.06 * H); g.fillStyle = '#f2b400'; g.fillRect(0, Y(0.18), W, 0.05 * H); }
      win(x1 - 2.2 * ppm, 1.4 * ppm);
    } else if (metro) {
      const nd = spec.doors || 4, pitch = (len - 2) / nd;
      for (let d = 0; d < nd; d++) {
        const dx = (1 + pitch * (d + 0.5) - 0.65) * ppm; door(dx);
        if (d < nd - 1) win(dx + 1.6 * ppm, (pitch - 1.9) * ppm);
      }
    } else {
      const dw = 1.0 * ppm; door(x0 - 0.2 * ppm); door(x1 - 1.1 * ppm);
      for (let x = x0 + 1.8 * ppm; x < x1 - 1.8 * ppm - dw; x += (hsr ? 1.45 : 1.9) * ppm) win(x, hsr ? 0.95 * ppm : 1.5 * ppm);
      if (car.deck) for (let x = x0 + 1.8 * ppm; x < x1 - 1.8 * ppm - dw; x += 1.9 * ppm) { if (dark) { g.fillStyle = '#ffe2b0'; g.fillRect(x, Y(0.4), 1.5 * ppm, 0.12 * H); } else { g.fillStyle = '#141a20'; g.fillRect(x, Y(0.4), 1.5 * ppm, 0.12 * H); } }
    }
    // 운전실 앞유리
    for (const [N, at] of [[noseF, 'f'], [noseB, 'b']]) {
      if (!N) continue;
      const a = N.glass, gx = at === 'f' ? W - N.len * ppm * (1 - a[0]) : 0, gw = N.len * ppm * (a[1] - a[0]) + 1.2 * ppm;
      const xx = at === 'f' ? gx - gw : N.len * ppm * a[0];
      if (dark) continue;
      g.fillStyle = '#0d1218'; g.fillRect(xx, Y(metro ? 0.86 : 0.86), gw, (metro ? 0.46 : 0.3) * H);
      g.fillStyle = 'rgba(120,150,180,0.25)'; g.fillRect(xx, Y(0.86), gw, 0.05 * H);
      // 전조등
      g.fillStyle = '#f5f5ee'; const hx = at === 'f' ? W - 0.5 * ppm : 0.1 * ppm; g.fillRect(hx, Y(0.3), 0.4 * ppm, 0.07 * H);
    }
    if (!dark && hsr && spec.name && !car.loco) { g.fillStyle = stripe; g.font = `800 ${0.16 * H}px sans-serif`; g.fillText(spec.short || spec.name, x0 + 3 * ppm, Y(0.28)); }
  });
}

const matCache = new Map();
export class TrainModel {
  constructor(spec, lineColor) {
    this.spec = spec;
    this.group = new THREE.Group();
    const metro = spec.kind === 'metro';
    const nCars = spec.cars || 6, W = metro ? 3.12 : spec.kind === 'hsr' ? 2.95 : 3.1, Hh = metro ? 3.72 : spec.kind === 'hsr' ? 3.55 : 3.85, y0 = metro ? 1.05 : 0.95;
    const stripe = spec.stripe === 'line' ? lineColor : spec.stripe, stripe2 = spec.stripe2 === 'line' ? lineColor : spec.stripe2;
    const N = NOSE[spec.nose] || NOSE.metro;
    this.cars = []; this.wheels = []; this.pantos = []; this.lights = [];
    const bogieM = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.7, metalness: 0.4 });
    const wheelM = new THREE.MeshStandardMaterial({ color: 0x5a5a58, roughness: 0.4, metalness: 0.8 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.8 });
    const gangM = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.body).multiplyScalar(0.55), roughness: 0.9 });
    const pantM = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.4, metalness: 0.8 });
    const headM = new THREE.MeshBasicMaterial({ color: 0xffffff }), tailM = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    const wheelG = new THREE.CylinderGeometry(0.43, 0.43, 0.14, 16).rotateX(Math.PI / 2);
    let off = 0;
    for (let i = 0; i < nCars; i++) {
      const lead = i === 0, tail = i === nCars - 1, isLoco = spec.kind === 'diesel' && i === 0;
      const pc = spec.powerCars === 'all' ? false : (spec.powerCars || []).includes(i);
      const len = (lead || tail || pc) ? spec.leadLen : spec.carLen;
      const nf = lead ? (isLoco ? NOSE.diesel : N) : null, nb = tail && !isLoco && spec.kind !== 'diesel' ? N : null;
      const car = { len, loco: isLoco, deck: spec.deck && spec.deck.includes(i) };
      const key = [spec.id, spec.body, stripe, stripe2, len, !!nf, !!nb, isLoco, car.deck, spec.nose].join('|');
      let mats = matCache.get(key);
      if (!mats) {
        const map = livery(spec, car, len, nf, nb, stripe, stripe2, false), em = livery(spec, car, len, nf, nb, stripe, stripe2, true);
        mats = new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0, roughness: metro ? 0.35 : 0.28, metalness: metro ? 0.55 : 0.25 });
        matCache.set(key, mats);
      }
      this.bodyMats = this.bodyMats || new Set(); this.bodyMats.add(mats);
      const hh = car.deck ? Hh + 0.55 : isLoco ? Hh - 0.2 : Hh;
      const body = new THREE.Mesh(loftCar(len, W, hh, y0, nf, nb, len), mats);
      body.castShadow = true;
      const g = new THREE.Group(); g.add(body); g.rotation.order = 'YZX';
      // 대차와 바퀴
      const bz = len / 2 - (lead && nf && nf.len > 3 ? Math.min(nf.len * 0.55, 5) + 1.5 : 2.6);
      for (const sx of [bz, -(len / 2 - (tail && nb && nb.len > 3 ? Math.min(nb.len * 0.55, 5) + 1.5 : 2.6))]) {
        const bg = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.42, 2.25), bogieM); bg.position.set(sx, 0.62, 0); g.add(bg);
        for (const wx of [-1.25, 1.25]) for (const wz of [-0.72, 0.72]) { const w = new THREE.Mesh(wheelG, wheelM); w.position.set(sx + wx, 0.43, wz); g.add(w); this.wheels.push(w); }
      }
      const under = new THREE.Mesh(new THREE.BoxGeometry(Math.max(2, len - (nf ? nf.len : 0) - (nb ? nb.len : 0) - 8), 0.55, W * 0.8), darkM);
      under.position.set(((nb ? nb.len : 0) - (nf ? nf.len : 0)) / 2, y0 + 0.02, 0); g.add(under);
      if (!lead) { const gw = new THREE.Mesh(new THREE.BoxGeometry(0.9, Hh - y0 - 0.7, W * 0.82), gangM); gw.position.set(len / 2 + 0.25, y0 + (Hh - y0 - 0.7) / 2, 0); g.add(gw); }
      // 팬터그래프
      if ((spec.panto || []).includes(i)) {
        const p = new THREE.Group(); p.position.set(nf ? -2 : nb ? 2 : 3, hh, 0);
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.9), pantM); base.position.y = 0.07; p.add(base);
        const lo = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.07).translate(0.95, 0, 0), pantM), up = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.06).translate(0.95, 0, 0), pantM);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 1.9), pantM);
        lo.position.set(-0.9, 0.25, 0); p.add(lo, up, head); g.add(p);
        this.pantos.push({ lo, up, head, h: 0 });
      }
      // 전조등·후미등
      if (lead || tail) {
        const tipH = (lead ? nf : nb)?.tipH || 0.8, tx = (lead ? 1 : -1) * (len / 2 - 0.02);
        for (const z of [-0.85, 0.85]) {
          const fh = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), headM), th = new THREE.Mesh(new THREE.CircleGeometry(0.11, 12), tailM);
          const y = y0 + (Hh - y0) * Math.max(0.18, tipH * 0.45);
          const zz = z * Math.max(0.3, (lead ? nf : nb)?.tipW || 0.9);
          fh.position.set(tx, y, zz); th.position.set(tx, y - 0.25, zz); fh.rotation.y = th.rotation.y = lead ? Math.PI / 2 : -Math.PI / 2;
          g.add(fh, th); this.lights.push({ head: fh, tail: th, front: lead });
        }
      }
      this.group.add(g);
      this.cars.push({ g, len, off, nose: nf });
      off += len + 0.6;
    }
    this.length = off - 0.6;
    // 운전석: 앞코가 눈높이보다 충분히 높아지는 지점 바로 뒤
    const nf = this.cars[0].nose, eye = metro ? 2.75 : 2.5;
    let t = 1;
    if (nf) for (let k = 0; k <= 100; k++) { const tt = k / 100; if (y0 + (Hh - y0) * (nf.tipH + (1 - nf.tipH) * Math.pow(tt, nf.ph)) >= eye + 0.45) { t = tt; break; } }
    this.cab = { x: this.cars[0].len / 2 - (nf ? Math.max(1.3, nf.len * t + 0.35) : 1.3), y: eye, z: metro ? -0.55 : -0.25 };
    // 전조등 빛
    this.spot = new THREE.SpotLight(0xfff2dc, 0, 420, 0.32, 0.5, 1.2);
    this.spot.position.set(this.cars[0].len / 2, 1.6, 0); this.spot.target.position.set(this.cars[0].len / 2 + 50, 0.5, 0);
    this.cars[0].g.add(this.spot, this.spot.target);
    this.setDirLights(true);
  }
  setDirLights(on) { for (const l of this.lights) { l.head.visible = on && l.front; l.tail.visible = !l.front; } }
  setHeadlight(v) { this.spot.intensity = v; }
  setInterior(v) { for (const m of this.bodyMats) m.emissiveIntensity = v; }
  // 선로 위에 배치. sFront: 맨 앞 위치, dir: 진행방향(+1/-1), lat: 선로 중심에서의 측면 오프셋
  place(line, sFront, dir, lat, origin, wheelRot) {
    const A = {}, Bq = {};
    for (const c of this.cars) {
      const s0 = sFront - dir * c.off, sc = s0 - dir * c.len / 2, hb = c.len / 2 - 2.6;
      line.at(sc + dir * hb, A); line.at(sc - dir * hb, Bq);
      const ax = A.x - Math.sin(A.hd) * lat, az = A.z + Math.cos(A.hd) * lat, bx = Bq.x - Math.sin(Bq.hd) * lat, bz = Bq.z + Math.cos(Bq.hd) * lat;
      const dx = ax - bx, dz = az - bz, dy = A.y - Bq.y, hl = Math.hypot(dx, dz) || 1;
      c.g.position.set((ax + bx) / 2 - origin.x, (A.y + Bq.y) / 2, (az + bz) / 2 - origin.y);
      c.g.rotation.y = -Math.atan2(dz, dx); c.g.rotation.z = Math.atan2(dy, hl);
    }
    for (const w of this.wheels) w.rotation.z = -wheelRot;
  }
  setPanto(t) {
    for (const p of this.pantos) {
      const a = 0.12 + t * 0.62; p.lo.rotation.z = a; p.up.position.set(-0.9 + Math.cos(a) * 1.9, 0.25 + Math.sin(a) * 1.9, 0); p.up.rotation.z = Math.PI - a * 1.05;
      p.head.position.set(p.up.position.x + Math.cos(Math.PI - a * 1.05) * 1.9, p.up.position.y + Math.sin(Math.PI - a * 1.05) * 1.9 + 0.05, 0);
    }
  }
  dispose() { this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.group.removeFromParent(); }
}
