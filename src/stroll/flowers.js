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

/** 꽃잎 한 장 — 밑동에서 +Z 로 뻗고, 가운데가 오목하게 팬다 */
function petalGeo(len, wid, cup = 0.1, droop = 0.12, segs = 2) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = wid * Math.sin(Math.PI * clamp01(0.12 + t * 0.92)) ** 0.8;
    const z = t * len;
    const y = Math.sin(t * Math.PI) * cup - t * t * droop;
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
  const n = 8 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const p = petalGeo(0.05, 0.014, 0.008, 0.012, 2);
    place(p, { rotX: -0.06, rotY: (i / n) * TAU, y: h, z: 0 });
    parts.push(tint(p, C(petalColor), 0.2, rng));
  }
  const disc = new THREE.CircleGeometry(0.017, 8);
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, h + 0.004, 0);
  parts.push(tint(disc, C(0xe8c23c), 0.25, rng));
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
  const n = 10 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const p = petalGeo(0.03, 0.008, 0.01, 0.01, 2);
    const ring = i / n;
    place(p, { rotX: -0.5 - (i % 3) * 0.35, rotY: ring * TAU * 3.7, y: h });
    parts.push(tint(p, C(0xf0c22a), 0.28, rng));
  }
  const core = new THREE.IcosahedronGeometry(0.013, 0);
  core.scale(1, 0.7, 1);
  core.translate(0, h, 0);
  parts.push(tint(core, C(0xdda81e)));
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
  const n = 4 + (rng() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const p = petalGeo(0.075, 0.05, 0.035, -0.02, 3);
    place(p, { rotX: -0.95, rotY: (i / n) * TAU + rng() * 0.2, y: h });
    parts.push(tint(p, C(0xd63a2a), 0.22, rng));
  }
  const center = new THREE.IcosahedronGeometry(0.014, 0);
  center.scale(1, 0.8, 1);
  center.translate(0, h + 0.008, 0);
  parts.push(tint(center, C(0x2a2320)));
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
  const n = 8;
  for (let i = 0; i < n; i++) {
    const p = petalGeo(0.062, 0.028, 0.012, 0.02, 2);
    place(p, { rotX: -0.35, rotY: (i / n) * TAU + rng() * 0.12, y: h });
    parts.push(tint(p, C(petalColor), 0.18, rng));
  }
  const disc = new THREE.CircleGeometry(0.014, 7);
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, h + 0.003, 0);
  parts.push(tint(disc, C(0xf0cf4a), 0.2, rng));
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
  for (let i = 0; i < 5; i++) {
    const p = petalGeo(0.026, 0.02, 0.014, -0.01, 2);
    place(p, { rotX: -0.8, rotY: (i / 5) * TAU, y: h });
    parts.push(tint(p, C(0xf5d02a), 0.18, rng));
  }
  const c = new THREE.IcosahedronGeometry(0.006, 0);
  c.translate(0, h + 0.004, 0);
  parts.push(tint(c, C(0xdfae1c)));
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
      const a = (k / per) * TAU + i * 1.1;
      const f = petalGeo(0.016, 0.009, 0.006, 0.004, 2);
      place(f, { rotX: -1.15, rotY: a, x: Math.cos(a) * rad, y, z: Math.sin(a) * rad });
      parts.push(tint(f, C(color), 0.26, rng));
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
    for (let k = 0; k < 5; k++) {
      const p = petalGeo(0.011, 0.008, 0.004, 0.002, 2);
      place(p, { rotX: -1.35, rotY: (k / 5) * TAU, x: hx, y: hy, z: hz });
      parts.push(tint(p, C(0x86b6e8), 0.2, rng));
    }
    const c = new THREE.CircleGeometry(0.004, 5);
    c.rotateX(-Math.PI / 2);
    c.translate(hx, hy + 0.003, hz);
    parts.push(tint(c, C(0xf4e68a)));
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
      const n = 7 - ring;
      for (let i = 0; i < n; i++) {
        const p = petalGeo(0.07 - ring * 0.012, 0.022, 0.016, 0.01, 2);
        place(p, {
          rotX: -0.5 - ring * 0.3,
          rotY: (i / n) * TAU + ring * 0.4,
          y: 0.02 + ring * 0.012,
        });
        parts.push(tint(p, C(ring === 2 ? 0xf6e6b4 : 0xf2dce6), 0.16, rng));
      }
    }
    const c = new THREE.IcosahedronGeometry(0.018, 0);
    c.scale(1, 0.6, 1);
    c.translate(0, 0.05, 0);
    parts.push(tint(c, C(0xe8c84a)));
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
    if (i > 0) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * spread;
      const sc = 0.72 + rng() * 0.5;
      g.scale(sc, sc, sc);
      g.rotateY(rng() * TAU);
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
  high: { perBlock: 12, blocks: 34, cell: 8, radius: 28, clumpK: 0.9, tier: 2 },
  ultra: { perBlock: 14, blocks: 40, cell: 8, radius: 34, clumpK: 1.1, tier: 2 },
};

/** 들꽃 레이어 전체를 만든다 */
export function buildFlowers(scene, quality = 'high') {
  const rng = makeRng(20260915);
  const q = QUALITY[quality] || QUALITY.high;
  const mat = windify(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide,
  }), 1.15, { translucency: 0.7 });

  const layers = [];
  for (const sp of SPECIES) {
    if (sp.tier > q.tier) continue;                 // 낮은 품질에서는 흔한 종만 핀다
    const perBlock = Math.max(2, Math.round(q.perBlock * sp.density));
    const [c0, c1] = sp.clump;
    const n = Math.max(1, Math.round(lerp(c0, c1, rng()) * q.clumpK));
    const geo = clump(sp.build, rng, n, sp.spread);
    const [s0, s1] = sp.scale;
    layers.push(new ScatterLayer(scene, {
      geometry: geo,
      material: mat,
      perBlock, blocks: q.blocks, cell: q.cell, radius: q.radius, name: 'flower',
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
        const sc = lerp(s0, s1, r()) * lerp(0.85, 1.15, patch);
        const m = self.compose(x, h - 0.01, z, r() * TAU, sc,
          (r() - 0.5) * 0.14, (r() - 0.5) * 0.14);
        // 같은 종이라도 포기마다 밝기가 조금씩 다르다
        const v = 0.88 + r() * 0.24;
        return { matrix: m, color: self._c.setRGB(v, v * (0.97 + r() * 0.06), v * (0.95 + r() * 0.08)) };
      },
    }));
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
