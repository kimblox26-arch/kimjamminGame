// 고요(GOYO) — 들꽃
// 종마다 줄기·잎·꽃잎을 따로 만들어 붙인다. 같은 종은 무리를 지어 피고
// (실제 들판처럼 군락을 이룬다), 볕·그늘·물가에 따라 사는 곳이 다르다.
import * as THREE from 'three';
import { clamp01, lerp, makeRng, smoothstep, TAU } from '../core/utils.js';
import {
  heightAt, normalAt, sampleGround, fertilityAt, surfaceAt, fbm2,
  SURFACE, WATER_LEVEL, LAKE,
} from './terrain.js';
import { mergeGeos, tint, windify, ScatterLayer } from './flora.js';

/* ------------------------------------------------------------------ */
/* 부품                                                                */
/* ------------------------------------------------------------------ */

/** 살짝 휜 줄기 */
function stemGeo(h, r0 = 0.006, r1 = 0.004, bend = 0.03, segs = 2) {
  const geo = new THREE.CylinderGeometry(r1, r0, h, 4, segs, true);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + h / 2) / h;
    p.setX(i, p.getX(i) + t * t * bend);
    p.setZ(i, p.getZ(i) + t * t * bend * 0.4);
  }
  geo.translate(0, h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 꽃잎 한 장 — 밑동에서 +Z 로 뻗는다.
 * 가운데가 오목하게 팬 채 주맥을 따라 접히고(fold), 끝이 둥글거나 뾰족하며,
 * 좌우가 미세하게 어긋나고 길이를 따라 비틀린다.
 */
function petalGeo(len, wid, o = {}) {
  const {
    cup = 0.1, droop = 0.12, segs = 2, round = 0.8,
    fold = 0, asym = 0, twist = 0, waist = 0,
  } = o;
  const pos = [], idx = [];
  const sides = fold > 0 ? [-1, 0, 1] : [-1, 1];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // 폭 — 밑동은 좁고, round 가 작을수록 끝이 둥글다
    let w = wid * Math.sin(Math.PI * clamp01(0.12 + t * 0.92)) ** round;
    if (waist) w *= 1 - waist * Math.sin(t * Math.PI * 2) * 0.5;   // 허리가 잘록한 꽃잎
    const z = t * len;
    const y = Math.sin(t * Math.PI) * cup - t * t * droop;
    const tw = twist * t;
    const ct = Math.cos(tw), st = Math.sin(tw);
    for (const s of sides) {
      const ww = w * s * (s < 0 ? 1 - asym : 1 + asym);
      const dy = s === 0 ? -fold * w : 0;      // 주맥이 내려앉아 단면이 V자
      pos.push(ww * ct, y + dy + ww * st * 0.5, z);
    }
  }
  const stride = sides.length;
  for (let i = 0; i < segs; i++) {
    const a = i * stride;
    if (stride === 2) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else {
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      idx.push(a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 꽃부리 한 벌.
 * 꽃잎이 자로 잰 듯 돌지 않는다 — 각도·길이·폭·기울기가 저마다 다르고
 * 빛깔도 장마다 조금씩 어긋나 실제 꽃처럼 보인다.
 */
function corolla(parts, rng, n, color, o) {
  const jit = o.jitter ?? 0.45;
  for (let i = 0; i < n; i++) {
    const k = 1 + (rng() - 0.5) * (o.vary ?? 0.32);
    const p = petalGeo(o.len * k, o.wid * (1 + (rng() - 0.5) * 0.3), {
      cup: (o.cup ?? 0.1) * (0.7 + rng() * 0.6),
      droop: (o.droop ?? 0.1) * (0.6 + rng() * 0.8),
      segs: o.segs ?? 2,
      round: o.round ?? 0.8,
      fold: o.fold ?? 0,
      waist: o.waist ?? 0,
      asym: (rng() - 0.5) * 0.34,
      twist: (rng() - 0.5) * (o.twist ?? 0.6),
    });
    place(p, {
      rotX: (o.rotX ?? -0.5) + (rng() - 0.5) * (o.tilt ?? 0.3),
      rotZ: (rng() - 0.5) * 0.22,
      rotY: (i / n) * TAU + (rng() - 0.5) * (TAU / n) * jit + (o.rotY0 ?? 0),
      x: o.x ?? 0, y: o.y + (rng() - 0.5) * (o.yJit ?? 0), z: o.z ?? 0,
    });
    const c = _c.copy(color);
    c.offsetHSL((rng() - 0.5) * 0.03, (rng() - 0.5) * 0.14, (rng() - 0.5) * 0.12);
    parts.push(tint(p, c, 0.1, rng));
  }
}

/**
 * 꽃 한가운데 — 납작한 원이 아니라 도톰하게 솟은 꽃판.
 * 테두리를 흔들어 도려낸 원처럼 보이지 않게 한다.
 */
function discGeo(r, y, rng, o = {}) {
  const g = new THREE.CircleGeometry(r, o.seg ?? 9);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (i === 0) { p.setY(i, (o.dome ?? 0.4) * r); continue; }
    const jr = 1 + (rng() - 0.5) * 0.2;
    p.setXYZ(i, p.getX(i) * jr, (rng() - 0.25) * r * 0.12, p.getZ(i) * jr);
  }
  g.computeVertexNormals();
  g.translate(0, y, 0);
  return g;
}

/** 수술 몇 대 — 꽃 가운데가 살아 있게 보인다 */
function stamens(parts, rng, n, r, y, color) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.399963 + rng() * 0.5;
    const rr = r * Math.sqrt(rng()) * 0.8;
    const st = new THREE.CylinderGeometry(r * 0.09, r * 0.06, r * (0.7 + rng() * 0.6), 3, 1, true);
    st.translate(0, r * 0.35, 0);
    st.rotateZ((rng() - 0.5) * 0.7);
    st.rotateY(a);
    st.translate(Math.cos(a) * rr, y, Math.sin(a) * rr);
    parts.push(tint(st, color, 0.3, rng));
  }
}

/** 길쭉한 잎 */
function leafGeo(len, wid, curl = 0.2, segs = 2, jag = 0) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let w = wid * Math.sin(Math.PI * clamp01(0.1 + t * 0.9)) ** 0.7;
    if (jag) w *= 1 + Math.sin(t * Math.PI * 5) * jag;
    const z = t * len;
    const y = -t * t * curl;
    pos.push(-w, y, z, w, y, z);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 지오메트리를 한 번에 회전·이동 */
function place(geo, { rotX = 0, rotY = 0, rotZ = 0, x = 0, y = 0, z = 0 }) {
  if (rotX) geo.rotateX(rotX);
  if (rotZ) geo.rotateZ(rotZ);
  if (rotY) geo.rotateY(rotY);
  geo.translate(x, y, z);
  return geo;
}

const C = (hex) => new THREE.Color(hex);
const _c = new THREE.Color();
const _sv = new THREE.Vector3();
const GREEN = C(0x6f8b46);
const GREEN_DARK = C(0x5b7639);

/* ------------------------------------------------------------------ */
/* 종별 모양                                                           */
/* ------------------------------------------------------------------ */

/** 데이지 — 흰 혀꽃 + 노란 통꽃 */
function daisy(rng, petalColor = 0xf6f4ec) {
  const parts = [];
  const h = 0.2 + rng() * 0.12;
  parts.push(tint(stemGeo(h, 0.006, 0.0045, 0.02), GREEN, 0.3, rng));
  // 혀꽃은 길이도 각도도 제각각이고, 몇 장은 아래로 처진다
  corolla(parts, rng, 9 + Math.floor(rng() * 5), C(petalColor), {
    len: 0.05, wid: 0.013, y: h, rotX: -0.08, cup: 0.01, droop: 0.016,
    round: 0.5, fold: 0.1, vary: 0.42, tilt: 0.42, twist: 0.6, yJit: 0.005,
  });
  parts.push(tint(discGeo(0.015 + rng() * 0.004, h + 0.003, rng, { dome: 0.55 }),
    C(0xe8c23c), 0.25, rng));
  // 밑둥 잎
  for (let i = 0; i < 2; i++) {
    const l = leafGeo(0.07, 0.016, 0.3, 2);
    place(l, { rotX: -0.5, rotY: rng() * TAU, y: 0.012 });
    parts.push(tint(l, GREEN_DARK, 0.3, rng));
  }
  return mergeGeos(parts);
}

/** 민들레 — 노란 솜방망이 + 톱니 잎 */
function dandelion(rng) {
  const parts = [];
  const h = 0.15 + rng() * 0.1;
  parts.push(tint(stemGeo(h, 0.007, 0.006, 0.015), GREEN, 0.25, rng));
  // 혀꽃이 여러 겹으로 겹쳐 앉는다
  for (let ring = 0; ring < 3; ring++) {
    corolla(parts, rng, 5 + Math.floor(rng() * 3), C(0xf0c22a), {
      len: 0.03 - ring * 0.005, wid: 0.008, y: h - ring * 0.002,
      rotX: -0.35 - ring * 0.42, cup: 0.008, droop: 0.008, round: 0.45,
      vary: 0.34, tilt: 0.3, twist: 0.5, rotY0: ring * 0.7,
    });
  }
  parts.push(tint(discGeo(0.012, h + 0.002, rng, { dome: 0.5, seg: 7 }), C(0xdda81e), 0.2, rng));
  for (let i = 0; i < 3; i++) {
    const l = leafGeo(0.1, 0.02, 0.45, 2, 0.22);
    place(l, { rotX: -0.75, rotY: (i / 4) * TAU + rng(), y: 0.01 });
    parts.push(tint(l, GREEN_DARK, 0.28, rng));
  }
  return mergeGeos(parts);
}

/** 민들레 홀씨 — 가는 갓털이 공을 이룬다 */
function dandelionPuff(rng) {
  const parts = [];
  const h = 0.2 + rng() * 0.12;
  parts.push(tint(stemGeo(h, 0.007, 0.006, 0.02), GREEN, 0.25, rng));
  const n = 14;
  for (let i = 0; i < n; i++) {
    // 구면에 고르게 (황금각)
    const y = 1 - (i / (n - 1)) * 1.6;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963;
    const dir = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
    const spoke = new THREE.CylinderGeometry(0.0018, 0.0022, 0.034, 3, 1, true);
    spoke.translate(0, 0.016, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    spoke.applyQuaternion(q);
    spoke.translate(0, h, 0);
    parts.push(tint(spoke, C(0xf4f2e8), 0.15, rng));
  }
  return mergeGeos(parts);
}

/** 개양귀비 — 넓고 오목한 네 장 */
function poppy(rng) {
  const parts = [];
  const h = 0.32 + rng() * 0.2;
  parts.push(tint(stemGeo(h, 0.007, 0.005, 0.06), GREEN_DARK, 0.3, rng));
  // 넓고 얇은 꽃잎 넉 장 — 가장자리가 물결치고 서로 겹친다
  corolla(parts, rng, 4 + (rng() < 0.4 ? 1 : 0), C(0xd63a2a), {
    len: 0.075, wid: 0.05, y: h, rotX: -0.95, cup: 0.035, droop: -0.02, segs: 3,
    round: 0.55, fold: 0.16, waist: 0.2, vary: 0.3, tilt: 0.34, twist: 0.7, jitter: 0.6,
  });
  parts.push(tint(discGeo(0.013, h + 0.008, rng, { dome: 0.8, seg: 7 }), C(0x3a3028), 0.2, rng));
  stamens(parts, rng, 7, 0.016, h + 0.008, C(0x2a2320));
  for (let i = 0; i < 3; i++) {
    const l = leafGeo(0.09, 0.016, 0.35, 2, 0.3);
    place(l, { rotX: -0.6, rotY: rng() * TAU, y: h * (0.2 + rng() * 0.3) });
    parts.push(tint(l, GREEN_DARK, 0.3, rng));
  }
  return mergeGeos(parts);
}

/** 코스모스 — 여덟 장의 넓은 꽃잎, 가는 깃털잎 */
function cosmos(rng, petalColor = 0xe98fb0) {
  const parts = [];
  const h = 0.45 + rng() * 0.3;
  parts.push(tint(stemGeo(h, 0.006, 0.004, 0.08), GREEN, 0.3, rng));
  // 끝이 톱니처럼 잘린 넓은 꽃잎 여덟 장
  corolla(parts, rng, 7 + Math.floor(rng() * 3), C(petalColor), {
    len: 0.062, wid: 0.028, y: h, rotX: -0.35, cup: 0.014, droop: 0.022,
    round: 0.42, fold: 0.12, vary: 0.3, tilt: 0.32, twist: 0.55, jitter: 0.55,
  });
  parts.push(tint(discGeo(0.013, h + 0.003, rng, { dome: 0.45, seg: 7 }), C(0xf0cf4a), 0.2, rng));
  for (let i = 0; i < 4; i++) {
    const l = leafGeo(0.06, 0.004, 0.2, 2);
    place(l, { rotX: -0.4 - rng() * 0.5, rotY: rng() * TAU, y: h * (0.25 + rng() * 0.5) });
    parts.push(tint(l, GREEN, 0.3, rng));
  }
  return mergeGeos(parts);
}

/** 초롱꽃 — 줄기에 매달린 종 몇 개 */
function bellflower(rng) {
  const parts = [];
  const h = 0.3 + rng() * 0.18;
  parts.push(tint(stemGeo(h, 0.006, 0.004, 0.1), GREEN_DARK, 0.3, rng));
  const bells = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < bells; i++) {
    const t = 0.45 + (i / bells) * 0.5;
    const y = h * t;
    const a = rng() * TAU;
    const bell = new THREE.CylinderGeometry(0.019, 0.006, 0.032, 5, 1, true);
    bell.translate(0, -0.016, 0);
    bell.rotateX(0.5);
    bell.translate(Math.cos(a) * 0.022, y, Math.sin(a) * 0.022);
    parts.push(tint(bell, C(0x7c6fd0), 0.22, rng));
    const stalk = new THREE.CylinderGeometry(0.002, 0.002, 0.024, 3, 1, true);
    stalk.rotateZ(Math.PI / 2 - 0.4);
    stalk.translate(Math.cos(a) * 0.011, y + 0.004, Math.sin(a) * 0.011);
    parts.push(tint(stalk, GREEN_DARK));
  }
  for (let i = 0; i < 3; i++) {
    const l = leafGeo(0.055, 0.01, 0.3, 2);
    place(l, { rotX: -0.6, rotY: rng() * TAU, y: h * rng() * 0.4 + 0.01 });
    parts.push(tint(l, GREEN_DARK, 0.3, rng));
  }
  return mergeGeos(parts);
}

/** 미나리아재비 — 반질반질한 노란 다섯 장 */
function buttercup(rng) {
  const parts = [];
  const h = 0.16 + rng() * 0.12;
  parts.push(tint(stemGeo(h, 0.005, 0.004, 0.03), GREEN, 0.3, rng));
  // 둥근 꽃잎 다섯 장이 오목한 잔을 이룬다
  corolla(parts, rng, 5, C(0xf5d02a), {
    len: 0.026, wid: 0.02, y: h, rotX: -0.8, cup: 0.014, droop: -0.012,
    round: 0.4, fold: 0.14, vary: 0.26, tilt: 0.3, twist: 0.4,
  });
  parts.push(tint(discGeo(0.007, h + 0.004, rng, { dome: 0.9, seg: 6 }), C(0xdfae1c), 0.2, rng));
  stamens(parts, rng, 5, 0.008, h + 0.005, C(0xe8be2c));
  for (let i = 0; i < 3; i++) {
    const l = leafGeo(0.045, 0.014, 0.25, 2, 0.35);
    place(l, { rotX: -0.7, rotY: rng() * TAU, y: 0.01 + rng() * h * 0.4 });
    parts.push(tint(l, GREEN_DARK, 0.3, rng));
  }
  return mergeGeos(parts);
}

/** 루피너스 — 작은 꽃이 층층이 달린 이삭 */
function lupine(rng, color = 0x6f6fd8) {
  const parts = [];
  const h = 0.42 + rng() * 0.25;
  parts.push(tint(stemGeo(h, 0.008, 0.005, 0.04), GREEN, 0.25, rng));
  const rows = 6 + Math.floor(rng() * 3);
  for (let i = 0; i < rows; i++) {
    const t = i / rows;
    const y = h * (0.5 + t * 0.5);
    const rad = 0.022 * (1 - t * 0.7);
    const per = 3;
    for (let k = 0; k < per; k++) {
      const a = (k / per) * TAU + i * 1.1 + (rng() - 0.5) * 0.5;
      const f = petalGeo(0.016 * (0.8 + rng() * 0.45), 0.009, {
        cup: 0.006, droop: 0.004, segs: 2, round: 0.5, asym: (rng() - 0.5) * 0.3,
      });
      place(f, {
        rotX: -1.15 + (rng() - 0.5) * 0.4, rotY: a,
        x: Math.cos(a) * rad, y: y + (rng() - 0.5) * 0.006, z: Math.sin(a) * rad,
      });
      const cc = _c.copy(C(color));
      cc.offsetHSL((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.16, (rng() - 0.5) * 0.14);
      parts.push(tint(f, cc, 0.18, rng));
    }
  }
  // 손바닥 모양 잎
  for (let i = 0; i < 3; i++) {
    const l = leafGeo(0.05, 0.012, 0.2, 2);
    place(l, { rotX: -0.5, rotY: (i / 5) * TAU + rng() * 0.3, y: h * 0.12 });
    parts.push(tint(l, GREEN_DARK, 0.28, rng));
  }
  return mergeGeos(parts);
}

/** 물망초 — 아주 작은 하늘색 꽃송이 */
function forgetMeNot(rng) {
  const parts = [];
  const h = 0.11 + rng() * 0.07;
  parts.push(tint(stemGeo(h, 0.004, 0.003, 0.02), GREEN, 0.3, rng));
  const heads = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < heads; i++) {
    const a = rng() * TAU, rad = 0.012 + rng() * 0.016;
    const hx = Math.cos(a) * rad, hz = Math.sin(a) * rad, hy = h + (rng() - 0.5) * 0.02;
    // 둥근 꽃잎 다섯 장에 노란 눈 — 송이마다 크기가 다르다
    const k0 = 0.8 + rng() * 0.5;
    corolla(parts, rng, 5, C(0x86b6e8), {
      len: 0.011 * k0, wid: 0.008 * k0, x: hx, y: hy, z: hz,
      rotX: -1.35 + (rng() - 0.5) * 0.5, cup: 0.004, droop: 0.002,
      round: 0.35, vary: 0.24, tilt: 0.24, twist: 0.3,
    });
    parts.push(tint(discGeo(0.0035 * k0, hy + 0.0025, rng, { dome: 0.6, seg: 5 }),
      C(0xf4e68a), 0.2, rng));
  }
  for (let i = 0; i < 3; i++) {
    const l = leafGeo(0.035, 0.008, 0.2, 2);
    place(l, { rotX: -0.6, rotY: rng() * TAU, y: 0.008 });
    parts.push(tint(l, GREEN_DARK, 0.3, rng));
  }
  return mergeGeos(parts);
}

/** 토끼풀 — 세 잎과 흰 꽃방울 (바닥을 덮는다) */
function clover(rng) {
  const parts = [];
  for (let i = 0; i < 2; i++) {
    const a = (i / 2) * TAU + rng() * 0.4;
    const stalk = new THREE.CylinderGeometry(0.0025, 0.003, 0.05, 3, 1, true);
    stalk.translate(0, 0.025, 0);
    stalk.rotateZ(0.25);
    stalk.rotateY(a);
    parts.push(tint(stalk, GREEN, 0.25, rng));
    for (let k = 0; k < 3; k++) {
      const leaf = new THREE.CircleGeometry(0.015, 4, 0, Math.PI * 1.55);
      leaf.rotateX(-Math.PI / 2 + 0.25);
      leaf.translate(0, 0.05, 0.012);
      leaf.rotateY((k / 3) * TAU);
      leaf.rotateZ(0.25);
      leaf.rotateY(a);
      parts.push(tint(leaf, k % 2 ? GREEN : GREEN_DARK, 0.3, rng));
    }
  }
  if (rng() < 0.55) {
    const st = new THREE.CylinderGeometry(0.0025, 0.003, 0.075, 3, 1, true);
    st.translate(0, 0.038, 0);
    parts.push(tint(st, GREEN, 0.2, rng));
    const head = new THREE.IcosahedronGeometry(0.016, 0);
    head.scale(1, 0.85, 1);
    head.translate(0, 0.082, 0);
    parts.push(tint(head, C(0xf0eee0), 0.18, rng));
  }
  return mergeGeos(parts);
}

/** 수련 — 잎사귀와 꽃 (호수에 뜬다) */
function waterLily(rng, withFlower) {
  const parts = [];
  const pad = new THREE.CircleGeometry(0.34 + rng() * 0.2, 14, 0.25, TAU - 0.5);
  pad.rotateX(-Math.PI / 2);
  parts.push(tint(pad, C(0x4a7040), 0.28, rng));
  if (withFlower) {
    for (let ring = 0; ring < 3; ring++) {
      corolla(parts, rng, 7 - ring, C(ring === 2 ? 0xf6e6b4 : 0xf2dce6), {
        len: 0.07 - ring * 0.012, wid: 0.022, y: 0.02 + ring * 0.012,
        rotX: -0.5 - ring * 0.3, cup: 0.016, droop: 0.01, round: 0.5, fold: 0.15,
        vary: 0.28, tilt: 0.3, twist: 0.5, rotY0: ring * 0.4 + rng(),
      });
    }
    parts.push(tint(discGeo(0.017, 0.048, rng, { dome: 0.7, seg: 8 }), C(0xe8c84a), 0.2, rng));
    stamens(parts, rng, 6, 0.016, 0.05, C(0xf0d868));
  }
  return mergeGeos(parts);
}

/* ------------------------------------------------------------------ */
/* 배치                                                                */
/* ------------------------------------------------------------------ */

/** 숲 그늘 정도 (나무 배치에 쓰는 것과 같은 노이즈) */
function shadeAt(x, z) {
  return clamp01(fbm2(x * 0.0045 + 5.5, z * 0.0045 - 2.2, 3) * 0.5 + 0.5);
}

/** 종마다 다른 군락 무늬 (fbm2 의 좁은 폭을 0~1 로 펴 준다) */
function patchAt(x, z, seed, scale = 0.035) {
  return clamp01(fbm2(x * scale + seed, z * scale - seed * 0.7, 2) * 1.75 + 0.5);
}

/** 한 자리에 여러 송이가 모여 핀 다발을 만든다 */
function clump(build, rng, n, spread) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const g = build(rng);
    // 송이마다 크기와 기울기가 다르다 — 한 다발 안에서도 줄을 맞추지 않는다
    const sc = i === 0 ? 0.9 + rng() * 0.26 : 0.68 + rng() * 0.6;
    g.scale(sc, sc * (0.85 + rng() * 0.32), sc);
    g.rotateX((rng() - 0.5) * 0.34);
    g.rotateZ((rng() - 0.5) * 0.34);
    g.rotateY(rng() * TAU);
    if (i > 0) {
      const a = rng() * TAU, r = Math.pow(rng(), 0.7) * spread;
      g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    parts.push(g);
  }
  return mergeGeos(parts);
}

/**
 * 종 정의
 *  patch   : 군락 노이즈 배율/문턱 — 값이 클수록 잘게 흩어진다
 *  want()  : 그 자리를 얼마나 좋아하는가 (0~1)
 */
const SPECIES = [
  {
    name: '데이지', seed: 11, build: (r) => daisy(r), density: 1.2, scale: [0.85, 1.5],
    patchScale: 0.028, patchMin: 0.34, clump: [3, 6], spread: 0.26, tier: 0,
    want: (ctx) => (1 - ctx.shade * 0.5) * ctx.fert * 1.3,
  },
  {
    name: '민들레', seed: 27, build: (r) => dandelion(r), density: 1.0, scale: [0.9, 1.6],
    patchScale: 0.033, patchMin: 0.32, clump: [2, 5], spread: 0.3, tier: 0,
    want: (ctx) => (1 - ctx.shade * 0.35) * ctx.fert * 1.25,
  },
  {
    name: '민들레 홀씨', seed: 31, build: (r) => dandelionPuff(r), density: 0.4, scale: [0.9, 1.4],
    patchScale: 0.05, patchMin: 0.45, clump: [1, 3], spread: 0.22, tier: 2,
    want: (ctx) => (1 - ctx.shade * 0.4) * ctx.fert,
  },
  {
    name: '개양귀비', seed: 43, build: (r) => poppy(r), density: 0.7, scale: [0.9, 1.35],
    patchScale: 0.022, patchMin: 0.44, clump: [2, 4], spread: 0.3, tier: 1,
    want: (ctx) => (1 - ctx.shade) * ctx.fert * (0.5 + ctx.dry * 0.9),
  },
  {
    name: '코스모스', seed: 57, build: (r) => cosmos(r, 0xe98fb0), density: 0.6, scale: [0.9, 1.3],
    patchScale: 0.02, patchMin: 0.46, clump: [2, 4], spread: 0.28, tier: 1,
    want: (ctx) => (1 - ctx.shade * 0.75) * ctx.fert * 1.1,
  },
  {
    name: '흰 코스모스', seed: 61, build: (r) => cosmos(r, 0xf2ece4), density: 0.4, scale: [0.9, 1.3],
    patchScale: 0.021, patchMin: 0.5, clump: [2, 3], spread: 0.28, tier: 2,
    want: (ctx) => (1 - ctx.shade * 0.75) * ctx.fert * 1.1,
  },
  {
    name: '초롱꽃', seed: 73, build: (r) => bellflower(r), density: 0.6, scale: [0.9, 1.4],
    patchScale: 0.03, patchMin: 0.38, clump: [2, 4], spread: 0.26, tier: 1,
    want: (ctx) => (0.3 + ctx.shade * 1.1) * ctx.fert,
  },
  {
    name: '미나리아재비', seed: 89, build: (r) => buttercup(r), density: 1.0, scale: [0.95, 1.6],
    patchScale: 0.036, patchMin: 0.3, clump: [3, 7], spread: 0.24, tier: 0,
    want: (ctx) => (0.55 + ctx.moist * 0.9) * ctx.fert * 1.2,
  },
  {
    name: '루피너스', seed: 97, build: (r) => lupine(r, 0x6f6fd8), density: 0.5, scale: [0.9, 1.35],
    patchScale: 0.018, patchMin: 0.5, clump: [1, 3], spread: 0.3, tier: 1,
    want: (ctx) => (1 - ctx.shade * 0.55) * ctx.fert,
  },
  {
    name: '분홍 루피너스', seed: 101, build: (r) => lupine(r, 0xd07ab4), density: 0.35, scale: [0.9, 1.3],
    patchScale: 0.019, patchMin: 0.54, clump: [1, 3], spread: 0.3, tier: 2,
    want: (ctx) => (1 - ctx.shade * 0.55) * ctx.fert,
  },
  {
    name: '물망초', seed: 113, build: (r) => forgetMeNot(r), density: 0.8, scale: [0.95, 1.7],
    patchScale: 0.04, patchMin: 0.34, clump: [4, 8], spread: 0.2, tier: 1,
    want: (ctx) => (0.15 + ctx.moist * 1.5) * ctx.fert,
  },
  {
    name: '토끼풀', seed: 127, build: (r) => clover(r), density: 1.5, scale: [0.85, 1.6],
    patchScale: 0.045, patchMin: 0.24, clump: [4, 8], spread: 0.22, tier: 0,
    want: (ctx) => (0.75 + ctx.shade * 0.35) * ctx.fert * 1.3,
  },
];

const QUALITY = {
  //            한 셀당 다발 / 블록 / 셀 크기 / 반경 / 다발 크기 배수 / 등급
  low: { perBlock: 7, blocks: 22, cell: 8, radius: 18, clumpK: 0.55, tier: 0 },
  medium: { perBlock: 9, blocks: 26, cell: 8, radius: 22, clumpK: 0.75, tier: 1 },
  high: { perBlock: 10, blocks: 34, cell: 8, radius: 28, clumpK: 0.9, tier: 2 },
  ultra: { perBlock: 12, blocks: 40, cell: 8, radius: 34, clumpK: 1.1, tier: 2 },
};

/** 들꽃 레이어 전체를 만든다 */
export function buildFlowers(scene, quality = 'high') {
  const rng = makeRng(20260915);
  const q = QUALITY[quality] || QUALITY.high;
  const mat = windify(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide,
  }), 1.15, { translucency: 0.7 });

  const layers = [];
  const VAR = q.tier >= 1 ? 2 : 1;                  // 같은 종이라도 다발 모양이 여러 벌
  for (const sp of SPECIES) {
    if (sp.tier > q.tier) continue;                 // 낮은 품질에서는 흔한 종만 핀다
    const perBlock = Math.max(2, Math.round(q.perBlock * sp.density / VAR));
    const [c0, c1] = sp.clump;
    const [s0, s1] = sp.scale;
    for (let vi = 0; vi < VAR; vi++) {
      const n = Math.max(1, Math.round(lerp(c0, c1, rng()) * q.clumpK));
      const geo = clump(sp.build, rng, n, sp.spread);
      layers.push(new ScatterLayer(scene, {
        geometry: geo,
        material: mat,
        perBlock, blocks: q.blocks, cell: q.cell, radius: q.radius, name: 'flower',
        salt: sp.seed * 131 + vi * 7717,
        place(x, z, r, self) {
          const { h, slope } = sampleGround(x, z);
          if (h < WATER_LEVEL + 0.1 || slope > 0.36) return null;
          const surf = surfaceAt(x, z, h, slope);
          if (surf === SURFACE.ROCK || surf === SURFACE.WATER) return null;
          const patch = patchAt(x, z, sp.seed, sp.patchScale);
          if (patch < sp.patchMin) return null;
          const fert = fertilityAt(x, z, h, slope);
          if (fert < 0.15) return null;
          const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r;
          const ctx = {
            fert,
            shade: shadeAt(x, z),
            moist: clamp01(1 - lakeD / 26) * 0.8 + clamp01(1 - (h - WATER_LEVEL) / 4) * 0.4,
            dry: clamp01(fbm2(x * 0.028 + 71.2, z * 0.028 - 3.3, 3) * 0.5 + 0.5),
          };
          const want = clamp01(sp.want(ctx)) * smoothstep(clamp01((patch - sp.patchMin) / 0.25));
          if (r() > want * (surf === SURFACE.GRASS ? 1 : 0.35)) return null;
          // 크기도 방향도 포기마다 다르고, 반듯이 서 있지도 않다
          const sc = lerp(s0, s1, r()) * lerp(0.85, 1.15, patch);
          _sv.set(sc * (0.88 + r() * 0.24), sc * (0.82 + r() * 0.36), sc * (0.88 + r() * 0.24));
          const m = self.compose(x, h - 0.01, z, r() * TAU, _sv,
            (r() - 0.5) * 0.3, (r() - 0.5) * 0.3);
          // 같은 종이라도 포기마다 밝기가 조금씩 다르다
          const v = 0.88 + r() * 0.24;
          return { matrix: m, color: self._c.setRGB(v, v * (0.97 + r() * 0.06), v * (0.95 + r() * 0.08)) };
        },
      }));
    }
  }
  return { layers, material: mat, species: SPECIES.map((s) => s.name) };
}

/** 호수에 뜬 수련 — 물은 움직이지 않으니 한 번만 배치한다 */
export function buildLilies(scene, quality = 'high') {
  const rng = makeRng(5150);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide,
  });
  const count = quality === 'low' ? 26 : quality === 'medium' ? 48 : 90;
  const group = new THREE.Group();
  group.name = 'lilies';

  const variants = [waterLily(rng, false), waterLily(rng, false), waterLily(rng, true)];
  const lists = [[], [], []];
  for (let i = 0; i < count * 3; i++) {
    const a = rng() * TAU;
    const r = LAKE.r * (0.25 + Math.sqrt(rng()) * 0.7);
    const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
    const depth = WATER_LEVEL - heightAt(x, z);
    if (depth < 0.45 || depth > 4.5) continue;          // 너무 얕거나 깊은 곳은 비운다
    // 무리 지어 뜬다
    if (fbm2(x * 0.06 + 3.1, z * 0.06 - 1.7, 2) * 0.5 + 0.5 < 0.45) continue;
    const v = rng() < 0.22 ? 2 : (rng() < 0.5 ? 0 : 1);
    lists[v].push([x, z, rng() * TAU, 0.75 + rng() * 0.6]);
    if (lists[0].length + lists[1].length + lists[2].length >= count) break;
  }

  const m = new THREE.Matrix4(), p = new THREE.Vector3(),
    qt = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  variants.forEach((geo, vi) => {
    const list = lists[vi];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.receiveShadow = true;
    im.name = 'lily';
    for (let i = 0; i < list.length; i++) {
      const [x, z, ry, sc] = list[i];
      qt.setFromEuler(e.set(0, ry, 0));
      m.compose(p.set(x, WATER_LEVEL + 0.03, z), qt, s.set(sc, sc, sc));
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  scene.add(group);
  return group;
}
