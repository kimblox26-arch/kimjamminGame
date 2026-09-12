// FREE FREELY - 부품 카탈로그
// 설계도(블루프린트)에서 사용하는 모든 부품의 물리 제원과 3D 형상 생성기.
// 좌표계: 기체 기준 -Z = 기수(전방), +X = 우측, +Y = 위. 설계도에서는
// bx(기수 방향 +), by(위 +), bz(우측 +) 를 사용하고 조립 시 변환한다.
import * as THREE from 'three';
import { lerp, TAU } from '../core/utils.js';

/* ------------------------------ 재질 라이브러리 ------------------------------ */
const matCache = new Map();

export function paint(color, roughness = 0.42, metalness = 0.28) {
  const key = `p${color}${roughness}${metalness}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness, metalness, envMapIntensity: 1.15,
    }));
  }
  return matCache.get(key);
}

export function metal(color = 0xb8bec6, roughness = 0.28) {
  return paint(color, roughness, 0.85);
}

export function glass() {
  if (!matCache.has('glass')) {
    matCache.set('glass', new THREE.MeshPhysicalMaterial({
      color: 0x99c4e0, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.42,
      envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide,
      transmission: 0.55, ior: 1.45,
    }));
  }
  return matCache.get('glass');
}

export function rubber() { return paint(0x1a1c1f, 0.95, 0.02); }
export function fabric(color = 0xdd4422) { return paint(color, 0.92, 0.0); }
export function hotMetal() {
  if (!matCache.has('hot')) {
    matCache.set('hot', new THREE.MeshStandardMaterial({
      color: 0x2a2a2e, roughness: 0.55, metalness: 0.9, emissive: 0x000000, emissiveIntensity: 1,
    }));
  }
  return matCache.get('hot');
}
export function emissive(color, intensity = 2) {
  const key = `e${color}${intensity}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4,
    }));
  }
  return matCache.get(key);
}

function mesh(geo, mat, pos, rot, scale) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* 날개 단면(에어포일) 형상 — 압출로 실제 두께감 있는 날개 생성 */
function airfoilShape(chord, thickness = 0.12) {
  const shape = new THREE.Shape();
  const N = 14;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = t * chord;
    const yt = 5 * thickness * chord * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
    pts.push([x, yt]);
  }
  shape.moveTo(0, 0);
  for (const p of pts) shape.lineTo(p[0], p[1]);
  for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(pts[i][0], -pts[i][1] * 0.72);
  shape.lineTo(0, 0);
  return shape;
}

export function makeWingGeometry(span, chordRoot, chordTip, sweep = 0.12, thickness = 0.11, dihedral = 0.04) {
  // 루트/팁 단면을 로프트하여 후퇴각·테이퍼·상반각 반영
  const shapeR = airfoilShape(chordRoot, thickness);
  const geo = new THREE.ExtrudeGeometry(shapeR, { depth: span, bevelEnabled: false, steps: 4 });
  geo.rotateY(-Math.PI / 2);
  // 정점 단위로 테이퍼/후퇴/상반 적용
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = Math.abs(x) / Math.max(0.001, span);
    const taper = lerp(1, chordTip / chordRoot, t);
    pos.setXYZ(i, x, y * taper + t * span * dihedral, (z) * taper - t * span * sweep);
  }
  geo.computeVertexNormals();
  return geo;
}

/* --------------------------------- 부품 정의 --------------------------------- */
/**
 * 각 부품: { id, name, cat, size[l,h,w], mass, desc, build(p), ... }
 * 설계도 UI는 size 를 기준으로 아이콘/히트박스를 그린다.
 */
export const PARTS = {
  /* ---------- 구조 ---------- */
  noseCone: {
    id: 'noseCone', name: '기수 콘', cat: 'structure', size: [2.6, 1.5, 1.5], mass: 45,
    desc: '공력 저항이 낮은 기수. 레이더·피토관 포함.',
    drag: { z: 0.12 },
    build(p) {
      const g = new THREE.Group();
      const c = mesh(new THREE.ConeGeometry(p.size[1] / 2, p.size[0], 22), paint(p.color || 0xd9dde3), [0, 0, 0], [-Math.PI / 2, 0, 0]);
      g.add(c);
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), metal(0x888888), [0.25, -0.2, -p.size[0] / 2 - 0.3], [Math.PI / 2, 0, 0]));
      return g;
    },
  },
  fuselage: {
    id: 'fuselage', name: '동체 (중)', cat: 'structure', size: [4, 1.6, 1.6], mass: 130,
    desc: '표준 동체 섹션. 연료와 구조 강도를 제공.',
    structure: 1.0,
    build(p) {
      const g = new THREE.Group();
      const r = p.size[1] / 2;
      g.add(mesh(new THREE.CylinderGeometry(r, r * 0.97, p.size[0], 20, 1), paint(p.color || 0xd9dde3), [0, 0, 0], [Math.PI / 2, 0, 0]));
      // 리벳 라인 느낌의 얇은 띠
      g.add(mesh(new THREE.TorusGeometry(r * 1.002, 0.018, 5, 22), metal(0x9aa0a8), [0, 0, p.size[0] * 0.25], [0, 0, 0]));
      g.add(mesh(new THREE.TorusGeometry(r * 1.002, 0.018, 5, 22), metal(0x9aa0a8), [0, 0, -p.size[0] * 0.25], [0, 0, 0]));
      return g;
    },
  },
  fuselageLong: {
    id: 'fuselageLong', name: '동체 (장)', cat: 'structure', size: [8, 2.6, 2.6], mass: 420,
    desc: '여객기·수송기용 대형 동체. 창문 포함.',
    structure: 1.4,
    build(p) {
      const g = new THREE.Group();
      const r = p.size[1] / 2;
      g.add(mesh(new THREE.CylinderGeometry(r, r, p.size[0], 24, 1), paint(p.color || 0xeef1f4), [0, 0, 0], [Math.PI / 2, 0, 0]));
      const win = emissive(0x335577, 0.4);
      for (let i = 0; i < 9; i++) {
        const z = -p.size[0] / 2 + 0.8 + i * (p.size[0] - 1.6) / 8;
        g.add(mesh(new THREE.BoxGeometry(0.06, 0.34, 0.5), win, [r * 0.98, r * 0.28, z]));
        g.add(mesh(new THREE.BoxGeometry(0.06, 0.34, 0.5), win, [-r * 0.98, r * 0.28, z]));
      }
      return g;
    },
  },
  tailBoom: {
    id: 'tailBoom', name: '테일 붐', cat: 'structure', size: [4.5, 1.2, 1.2], mass: 95,
    desc: '가벼운 후방 동체. 미익 장착용.',
    build(p) {
      return mesh(
        new THREE.CylinderGeometry(p.size[1] / 2, p.size[1] / 4.2, p.size[0], 16, 1),
        paint(p.color || 0xd9dde3), [0, 0, 0], [Math.PI / 2, 0, 0]
      );
    },
  },
  cockpitBubble: {
    id: 'cockpitBubble', name: '버블 캐노피', cat: 'structure', size: [2.4, 1.2, 1.4], mass: 90,
    desc: '시야가 넓은 전투기형 조종석. 1인칭 시점 기준점.',
    cockpit: { eye: [0, 0.28, -0.2], closed: true },
    build(p) {
      const g = new THREE.Group();
      const canopy = mesh(new THREE.SphereGeometry(0.72, 20, 14, 0, TAU, 0, Math.PI / 2), glass(), [0, 0.05, 0]);
      canopy.scale.set(1, 1.05, p.size[0] / 1.7);
      g.add(canopy);
      g.add(mesh(new THREE.BoxGeometry(0.62, 0.12, 0.9), paint(0x2b2f36), [0, -0.02, 0.35]));
      // 계기판과 좌석
      g.add(mesh(new THREE.BoxGeometry(0.7, 0.36, 0.12), paint(0x14161a), [0, 0.06, -0.55]));
      g.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.12), paint(0x23262b), [0, 0.0, 0.42]));
      g.add(mesh(new THREE.BoxGeometry(0.46, 0.1, 0.42), paint(0x2a2d33), [0, -0.24, 0.2]));
      return g;
    },
  },
  cockpitClosed: {
    id: 'cockpitClosed', name: '여객 조종실', cat: 'structure', size: [3.2, 2.2, 2.4], mass: 220,
    desc: '대형기용 조종실. 전면 유리창과 계기 패널.',
    cockpit: { eye: [0, 0.55, -0.6], closed: true },
    build(p) {
      const g = new THREE.Group();
      const body = mesh(new THREE.SphereGeometry(1.15, 20, 16), paint(p.color || 0xeef1f4));
      body.scale.set(0.95, 0.9, p.size[0] / 2.4);
      g.add(body);
      const win = mesh(new THREE.SphereGeometry(1.16, 18, 10, -0.9, 1.8, 0.75, 0.5), glass());
      win.scale.set(0.96, 0.92, p.size[0] / 2.4);
      win.rotation.x = -0.12;
      g.add(win);
      g.add(mesh(new THREE.BoxGeometry(1.5, 0.5, 0.2), paint(0x14161a), [0, 0.3, -0.95]));
      return g;
    },
  },
  openCockpit: {
    id: 'openCockpit', name: '개방형 조종석', cat: 'structure', size: [1.8, 1.0, 1.2], mass: 45,
    desc: '복엽기·경비행기용 개방 조종석. 바람소리가 강하게 들린다.',
    cockpit: { eye: [0, 0.35, -0.1], closed: false },
    build() {
      const g = new THREE.Group();
      g.add(mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 16), paint(0x30343a), [0, 0.3, 0], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), paint(0x4a2f1c), [0, 0.1, 0.3]));
      g.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 16, 1, false, 0, Math.PI), glass(), [0, 0.5, -0.45], [1.2, 0, 0]));
      return g;
    },
  },
  cargoBay: {
    id: 'cargoBay', name: '화물창', cat: 'structure', size: [5, 3, 3], mass: 380,
    desc: '대형 화물칸. 무게중심이 낮아 안정적.',
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(p.size[2], p.size[1], p.size[0]), paint(p.color || 0xc6ccd2), [0, 0, 0]));
      g.add(mesh(new THREE.BoxGeometry(p.size[2] * 0.9, 0.1, p.size[0] * 0.5), paint(0x8a9098), [0, -p.size[1] / 2, 0]));
      return g;
    },
  },
  spaceCapsule: {
    id: 'spaceCapsule', name: '우주 캡슐', cat: 'structure', size: [3.4, 3, 3], mass: 520,
    desc: '재진입 가능한 캡슐. 내열 구조.',
    cockpit: { eye: [0, 0.4, -0.8], closed: true },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.7, 1.5, p.size[0], 18), metal(0xcfd6dd, 0.35), [0, 0, 0], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.SphereGeometry(1.5, 18, 8, 0, TAU, 0, Math.PI / 2), paint(0x3a3f45, 0.8, 0.4), [0, 0, p.size[0] / 2], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.CircleGeometry(0.4, 14), glass(), [0, 0.6, -p.size[0] / 2 + 0.1]));
      return g;
    },
  },
  heatShield: {
    id: 'heatShield', name: '내열 실드', cat: 'structure', size: [0.6, 3.2, 3.2], mass: 260,
    desc: '재진입 열을 견딘다. 대기권 돌파 시 손상 감소.',
    heatShield: 1,
    build(p) {
      return mesh(new THREE.SphereGeometry(p.size[1] / 2, 20, 8, 0, TAU, 0, Math.PI / 2.4),
        paint(0x2a2320, 0.95, 0.1), [0, 0, 0], [-Math.PI / 2, 0, 0]);
    },
  },
  basket: {
    id: 'basket', name: '열기구 바스켓', cat: 'structure', size: [1.8, 1.4, 1.8], mass: 110,
    desc: '등나무 바스켓. 열기구 탑승 공간.',
    cockpit: { eye: [0, 0.55, 0], closed: false },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(p.size[2], p.size[1], p.size[0]), paint(0x8a6a3c, 1, 0), [0, 0, 0]));
      g.add(mesh(new THREE.BoxGeometry(p.size[2] * 1.04, 0.12, p.size[0] * 1.04), paint(0x6b5230, 1, 0), [0, p.size[1] / 2, 0]));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 5), paint(0x3a3a3a),
          [Math.cos(a) * 0.7, 1.6, Math.sin(a) * 0.7]));
      }
      return g;
    },
  },

  /* ---------- 날개 / 조종면 ---------- */
  wingStraight: {
    id: 'wingStraight', name: '직선 주익', cat: 'wing', size: [1.9, 0.26, 6.4], mass: 105,
    desc: '양력이 크고 저속 안정성이 뛰어난 고효율 날개.',
    mirror: true,
    wing: { areaPerSpan: 1.7, aspect: 7.5, camber: 0.055, control: 'roll', controlEffect: 0.22, flapEffect: 0.5, stall: 0.33, dihedral: 5.0 },
    build(p) {
      const span = p.size[2], chord = p.size[0];
      const g = new THREE.Group();
      const w = new THREE.Mesh(makeWingGeometry(span, chord, chord * 0.82, 0.06, 0.12, 0.05), paint(p.color || 0xd9dde3));
      w.castShadow = true; w.receiveShadow = true;
      g.add(w);
      // 에일러론 분할선
      g.add(mesh(new THREE.BoxGeometry(span * 0.4, 0.03, 0.04), paint(0x9aa0a8), [-span * 0.72, 0.02, chord * 0.78]));
      return g;
    },
  },
  wingSwept: {
    id: 'wingSwept', name: '후퇴익', cat: 'wing', size: [2.6, 0.3, 8], mass: 260,
    desc: '고속 비행에 유리한 후퇴각 날개. 저속 실속이 빠르다.',
    mirror: true,
    wing: { areaPerSpan: 2.2, aspect: 5.2, camber: 0.03, control: 'roll', controlEffect: 0.2, flapEffect: 0.4, stall: 0.26, dihedral: 5.5 },
    build(p) {
      const g = new THREE.Group();
      const w = new THREE.Mesh(makeWingGeometry(p.size[2], p.size[0], p.size[0] * 0.55, 0.42, 0.09, 0.06), paint(p.color || 0xd0d6dc));
      w.castShadow = true;
      g.add(w);
      return g;
    },
  },
  wingDelta: {
    id: 'wingDelta', name: '델타익', cat: 'wing', size: [5.5, 0.34, 5.5], mass: 320,
    desc: '초음속기용 삼각익. 고속·고AoA 성능.',
    mirror: true,
    wing: { areaPerSpan: 3.4, aspect: 2.4, camber: 0.018, control: 'roll', controlEffect: 0.24, flapEffect: 0.3, stall: 0.40, dihedral: 2.5 },
    build(p) {
      const g = new THREE.Group();
      const w = new THREE.Mesh(makeWingGeometry(p.size[2], p.size[0], p.size[0] * 0.18, 0.86, 0.07, 0.02), paint(p.color || 0xaeb6be));
      w.castShadow = true;
      g.add(w);
      return g;
    },
  },
  canard: {
    id: 'canard', name: '카나드', cat: 'wing', size: [1.2, 0.18, 2.4], mass: 55,
    desc: '기수 앞 작은 날개. 기동성이 크게 올라가지만 안정성은 낮아진다.',
    mirror: true,
    wing: { areaPerSpan: 1.0, aspect: 4.5, camber: 0.02, control: 'pitch', controlSign: 1, controlEffect: 0.21, stall: 0.34, dihedral: 2.0 },
    build(p) {
      const w = new THREE.Mesh(makeWingGeometry(p.size[2], p.size[0], p.size[0] * 0.6, 0.2, 0.1, 0.02), paint(p.color || 0xc8ced4));
      w.castShadow = true;
      return w;
    },
  },
  hstab: {
    id: 'hstab', name: '수평 미익', cat: 'wing', size: [1.35, 0.18, 3.2], mass: 52,
    desc: '피치 안정과 엘리베이터 조종을 담당. 기체 뒤쪽에 반드시 필요.',
    mirror: true,
    wing: { areaPerSpan: 1.1, aspect: 4.2, camber: 0.0, control: 'pitch', controlSign: -1, controlEffect: 0.24, stall: 0.36, dihedral: 3.0 },
    build(p) {
      const w = new THREE.Mesh(makeWingGeometry(p.size[2], p.size[0], p.size[0] * 0.66, 0.24, 0.1, 0.03), paint(p.color || 0xd9dde3));
      w.castShadow = true;
      return w;
    },
  },
  vfin: {
    id: 'vfin', name: '수직 미익', cat: 'wing', size: [1.8, 3, 0.22], mass: 58,
    desc: '방향 안정과 러더. 요(yaw) 제어의 핵심.',
    vertical: true,
    wing: { areaPerSpan: 1.4, aspect: 2.6, camber: 0.0, control: 'yaw', controlSign: 1, controlEffect: 0.30, stall: 0.38 },
    build(p) {
      const w = new THREE.Mesh(makeWingGeometry(p.size[1], p.size[0], p.size[0] * 0.55, 0.5, 0.1, 0), paint(p.color || 0xd9dde3));
      w.castShadow = true;
      w.rotation.z = -Math.PI / 2;   // 스팬을 위쪽(+Y)으로
      return w;
    },
  },
  winglet: {
    id: 'winglet', name: '윙렛', cat: 'wing', size: [1.0, 1.4, 0.18], mass: 22,
    desc: '날개 끝 와류를 줄여 유도항력 감소.',
    mirror: true, vertical: true,
    wing: { areaPerSpan: 0.7, aspect: 3.0, camber: 0, control: 'none', stall: 0.4, efficiencyBonus: 0.06 },
    build(p) {
      const w = new THREE.Mesh(makeWingGeometry(p.size[1], p.size[0], p.size[0] * 0.5, 0.4, 0.09, 0), paint(p.color || 0xc8ced4));
      w.rotation.z = -Math.PI / 2;
      w.castShadow = true;
      return w;
    },
  },

  /* ---------- 추진 ---------- */
  pistonProp: {
    id: 'pistonProp', name: '피스톤 프로펠러', cat: 'engine', size: [1.6, 1.4, 1.4], mass: 190,
    desc: '저속에서 효율 최고. 경비행기·복엽기용.',
    engine: { type: 'prop', thrust: 4600, fuelRate: 0.0024, spool: 3.2, propRadius: 1.0, staticBoost: 1.5 },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.52, 0.6, p.size[0], 18), metal(0x5a6068, 0.4), [0, 0, 0], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.SphereGeometry(0.26, 14, 10), metal(0x8a9098), [0, 0, -p.size[0] / 2 - 0.05]));
      const hub = new THREE.Group();
      hub.position.z = -p.size[0] / 2 - 0.18;
      for (let i = 0; i < 3; i++) {
        const b = mesh(new THREE.BoxGeometry(0.16, 1.9, 0.05), paint(0x23262b, 0.5, 0.4), [0, 0.95, 0]);
        const h = new THREE.Group();
        h.rotation.z = (i / 3) * TAU;
        h.add(b);
        hub.add(h);
      }
      // 회전 디스크(고속 회전 시 블러 표현)
      const disk = mesh(new THREE.CircleGeometry(1.0, 26), new THREE.MeshBasicMaterial({
        color: 0x11131a, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
      }), [0, 0, -0.05]);
      hub.add(disk);
      hub.userData.spinner = true;
      hub.userData.disk = disk;
      g.add(hub);
      g.userData.propHub = hub;
      return g;
    },
  },
  turboprop: {
    id: 'turboprop', name: '터보프롭', cat: 'engine', size: [2.4, 1.5, 1.5], mass: 340,
    desc: '중고속까지 커버하는 터빈 프로펠러.',
    engine: { type: 'prop', thrust: 12500, fuelRate: 0.0044, spool: 2.2, propRadius: 1.6, staticBoost: 1.35 },
    build(p) {
      const g = PARTS.pistonProp.build({ ...p, size: [p.size[0], 1.5, 1.5] });
      g.scale.set(1.15, 1.15, 1);
      return g;
    },
  },
  turbofan: {
    id: 'turbofan', name: '터보팬', cat: 'engine', size: [3.6, 2.0, 2.0], mass: 1250,
    desc: '여객기용 고바이패스 엔진. 연비가 좋고 조용하다.',
    engine: { type: 'jet', thrust: 88000, fuelRate: 0.0165, spool: 1.1, bypass: true },
    build(p) {
      const g = new THREE.Group();
      const r = p.size[1] / 2;
      g.add(mesh(new THREE.CylinderGeometry(r, r * 0.92, p.size[0], 22, 1, true), metal(0xdfe4e9, 0.25), [0, 0, 0], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.CylinderGeometry(r * 0.78, r * 0.5, p.size[0] * 0.5, 20), metal(0x6a7078, 0.45), [0, 0, p.size[0] * 0.3], [Math.PI / 2, 0, 0]));
      const fan = mesh(new THREE.CircleGeometry(r * 0.85, 22), paint(0x14161a, 0.6, 0.7), [0, 0, -p.size[0] / 2 + 0.12]);
      const fanGroup = new THREE.Group();
      for (let i = 0; i < 16; i++) {
        const b = mesh(new THREE.BoxGeometry(0.1, r * 0.78, 0.03), metal(0x9aa2ab, 0.3), [0, r * 0.42, 0]);
        const h = new THREE.Group();
        h.rotation.z = (i / 16) * TAU;
        h.rotation.y = 0.4;
        h.add(b);
        fanGroup.add(h);
      }
      fanGroup.position.z = -p.size[0] / 2 + 0.18;
      fanGroup.userData.spinner = true;
      g.add(fan, fanGroup);
      g.userData.propHub = fanGroup;
      g.userData.nozzle = new THREE.Vector3(0, 0, p.size[0] / 2);
      return g;
    },
  },
  turbojet: {
    id: 'turbojet', name: '터보제트 (AB)', cat: 'engine', size: [4.2, 1.3, 1.3], mass: 1100,
    desc: '애프터버너 장착 전투기 엔진. 초음속 돌파 가능.',
    engine: { type: 'jet', thrust: 64000, afterburner: 1.6, fuelRate: 0.021, abFuelRate: 0.06, spool: 0.85 },
    build(p) {
      const g = new THREE.Group();
      const r = p.size[1] / 2;
      g.add(mesh(new THREE.CylinderGeometry(r * 0.85, r, p.size[0] * 0.8, 18, 1), metal(0x9aa2ab, 0.3), [0, 0, 0], [Math.PI / 2, 0, 0]));
      // 가변 노즐
      const nozzle = mesh(new THREE.CylinderGeometry(r, r * 0.8, p.size[0] * 0.25, 18, 1, true), metal(0x4a4f56, 0.45).clone(),
        [0, 0, p.size[0] * 0.5], [Math.PI / 2, 0, 0]);
      g.add(nozzle);
      g.userData.nozzleMesh = nozzle;
      const fanGroup = new THREE.Group();
      for (let i = 0; i < 12; i++) {
        const b = mesh(new THREE.BoxGeometry(0.08, r * 0.8, 0.03), metal(0xb0b8c0, 0.25), [0, r * 0.45, 0]);
        const h = new THREE.Group();
        h.rotation.z = (i / 12) * TAU;
        h.add(b);
        fanGroup.add(h);
      }
      fanGroup.position.z = -p.size[0] * 0.4 + 0.1;
      g.add(fanGroup);
      g.userData.propHub = fanGroup;
      return g;
    },
  },
  rocket: {
    id: 'rocket', name: '로켓 엔진', cat: 'engine', size: [3, 1.6, 1.6], mass: 900,
    desc: '대기 없이도 작동. 추력이 압도적이지만 연료를 폭식한다.',
    engine: { type: 'rocket', thrust: 380000, fuelRate: 0.2, spool: 0.25, vacuum: true },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, p.size[0] * 0.45, 14), metal(0xc8ced4, 0.35), [0, 0, -p.size[0] * 0.25], [Math.PI / 2, 0, 0]));
      const bell = mesh(new THREE.CylinderGeometry(0.45, p.size[1] / 2, p.size[0] * 0.55, 20, 1, true), hotMetal(),
        [0, 0, p.size[0] * 0.22], [Math.PI / 2, 0, 0]);
      bell.material = hotMetal().clone();
      g.add(bell);
      g.userData.bell = bell;
      // 배관
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        g.add(mesh(new THREE.TorusGeometry(0.5, 0.03, 4, 14, 2), metal(0x8a9098), [0, 0, -0.1], [0, 0, a]));
      }
      return g;
    },
  },
  ionThruster: {
    id: 'ionThruster', name: '이온 추진기', cat: 'engine', size: [1.4, 1.0, 1.0], mass: 180,
    desc: '추력은 작지만 연료 소모가 극히 적다. 우주 순항용.',
    engine: { type: 'ion', thrust: 9000, fuelRate: 0.0008, spool: 0.6, vacuum: true },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.42, 0.5, p.size[0], 16, 1), metal(0x7a828c, 0.4), [0, 0, 0], [Math.PI / 2, 0, 0]));
      const grid = mesh(new THREE.CircleGeometry(0.45, 16), emissive(0x3388ff, 1.6).clone(), [0, 0, p.size[0] / 2 + 0.01]);
      g.add(grid);
      g.userData.glow = grid;
      return g;
    },
  },
  burner: {
    id: 'burner', name: '열기구 버너', cat: 'engine', size: [0.9, 0.9, 0.9], mass: 65,
    desc: '프로판 버너. 봉투 내부 공기를 가열해 부력을 만든다.',
    engine: { type: 'burner', thrust: 0, fuelRate: 0.02, heat: 780 },
    build() {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.6, 12), metal(0xb08a3a, 0.35), [0, 0.2, 0]));
      g.add(mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.14, 12), metal(0x8a6a2a, 0.45), [0, 0.55, 0]));
      g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), paint(0xcc3322, 0.6, 0.3), [0.32, -0.1, 0]));
      return g;
    },
  },
  rcs: {
    id: 'rcs', name: 'RCS 추진기', cat: 'engine', size: [0.5, 0.5, 0.5], mass: 24,
    desc: '자세 제어용 소형 추진기. 무중력·저속에서 기체를 돌린다.',
    mirror: true,
    engine: { type: 'rcs', thrust: 2600, fuelRate: 0.004, spool: 0.05, vacuum: true },
    build() {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.11, 0.22, 8), metal(0xa8b0b8, 0.3), [0, 0.08, 0]));
      g.add(mesh(new THREE.BoxGeometry(0.24, 0.12, 0.24), paint(0x6a7078), [0, -0.05, 0]));
      return g;
    },
  },

  /* ---------- 착륙 장치 ---------- */
  noseGear: {
    id: 'noseGear', name: '앞바퀴', cat: 'gear', size: [0.6, 1.6, 0.6], mass: 55,
    desc: '조향 가능한 전륜. 지상 활주 방향 전환.',
    gear: { spring: 42000, damper: 5200, radius: 0.36, steer: 0.55, brake: 0.25, travel: 0.5 },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, p.size[1] * 0.8, 8), metal(0xb8bec6, 0.3), [0, p.size[1] * 0.15, 0]));
      const wheel = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 16), rubber(), [0, -p.size[1] * 0.32, 0], [0, 0, Math.PI / 2]);
      g.add(wheel);
      g.userData.wheel = wheel;
      return g;
    },
  },
  mainGear: {
    id: 'mainGear', name: '주 착륙장치', cat: 'gear', size: [0.8, 2.0, 0.8], mass: 85,
    desc: '브레이크가 달린 주바퀴. 착륙 하중을 흡수한다.',
    mirror: true,
    gear: { spring: 96000, damper: 12000, radius: 0.45, steer: 0, brake: 1, travel: 0.65 },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, p.size[1] * 0.8, 8), metal(0xb8bec6, 0.3), [0, p.size[1] * 0.12, 0]));
      const wheel = mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.26, 18), rubber(), [0, -p.size[1] * 0.34, 0], [0, 0, Math.PI / 2]);
      g.add(wheel);
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 10), metal(0x8a9098, 0.4), [0, -p.size[1] * 0.34, 0], [0, 0, Math.PI / 2]));
      g.userData.wheel = wheel;
      return g;
    },
  },
  skid: {
    id: 'skid', name: '스키드', cat: 'gear', size: [2.4, 0.5, 0.3], mass: 45,
    desc: '단순한 활주 스키드. 눈·풀밭 착륙에 적합.',
    mirror: true,
    gear: { spring: 60000, damper: 9000, radius: 0.2, steer: 0, brake: 0.5, travel: 0.3, skid: true,
      points: [[0, 0, -0.9], [0, 0, 0.9]] },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(0.14, 0.1, p.size[0]), metal(0x9aa2ab, 0.35), [0, -0.2, 0]));
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), metal(0xb8bec6), [0, 0, -p.size[0] * 0.3]));
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6), metal(0xb8bec6), [0, 0, p.size[0] * 0.3]));
      return g;
    },
  },
  float: {
    id: 'float', name: '플로트 (수상)', cat: 'gear', size: [4.5, 0.9, 1.0], mass: 160,
    desc: '수상 이착륙용 부유체. 물 위에서 활주 가능.',
    mirror: true,
    gear: { spring: 30000, damper: 6000, radius: 0.5, steer: 0.1, brake: 0.1, travel: 0.25,
      points: [[0, 0, -1.5], [0, 0, 0], [0, 0, 1.5]] },
    buoyancy: { volume: 2.4 },
    build(p) {
      const g = new THREE.Group();
      const hull = mesh(new THREE.CapsuleGeometry(0.45, p.size[0] - 0.9, 6, 14), paint(p.color || 0xc8ced4), [0, 0, 0], [Math.PI / 2, 0, 0]);
      g.add(hull);
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), metal(0xb8bec6), [0, 0.5, -p.size[0] * 0.2]));
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), metal(0xb8bec6), [0, 0.5, p.size[0] * 0.2]));
      return g;
    },
  },

  /* ---------- 시스템 ---------- */
  fuelTank: {
    id: 'fuelTank', name: '연료 탱크', cat: 'system', size: [2.4, 1.2, 1.2], mass: 55,
    desc: '항속거리를 늘린다. 피격 시 화재 위험.',
    fuel: 300,
    build(p) {
      return mesh(new THREE.CapsuleGeometry(p.size[1] / 2, p.size[0] - p.size[1], 6, 14), metal(0xdfe4e9, 0.3), [0, 0, 0], [Math.PI / 2, 0, 0]);
    },
  },
  battery: {
    id: 'battery', name: '배터리 팩', cat: 'system', size: [1.2, 0.6, 1.2], mass: 120,
    desc: '전기 추진과 항전 장비 전원.',
    power: 1,
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(p.size[2], p.size[1], p.size[0]), paint(0x2a2f36, 0.6, 0.3)));
      g.add(mesh(new THREE.BoxGeometry(p.size[2] * 0.3, 0.06, p.size[0] * 0.8), emissive(0x33ff88, 0.8), [0, p.size[1] / 2, 0]));
      return g;
    },
  },
  avionics: {
    id: 'avionics', name: '항전 장비', cat: 'system', size: [1.0, 0.5, 1.0], mass: 60,
    desc: '자동조종·계기 정밀도 향상, 레이더 표시.',
    avionics: 1,
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(p.size[2], p.size[1], p.size[0]), metal(0x6a7078, 0.4)));
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.1, 0.2), emissive(0x33ccff, 1.2), [0.2, p.size[1] / 2, 0]));
      return g;
    },
  },
  parachute: {
    id: 'parachute', name: '비상 낙하산', cat: 'system', size: [0.9, 0.7, 0.9], mass: 40,
    desc: '추락 직전 전개하면 강하 속도를 줄여 생존할 수 있다.',
    chute: { drag: 42, deployTime: 1.4 },
    build(p) {
      return mesh(new THREE.BoxGeometry(p.size[2], p.size[1], p.size[0]), paint(0xdd6622, 0.8, 0.1));
    },
  },
  flarePod: {
    id: 'flarePod', name: '플레어 포드', cat: 'system', size: [1.2, 0.5, 0.6], mass: 55,
    desc: '열원 기만용 플레어. 화려한 불꽃을 뿜는다.',
    mirror: true,
    flares: 24,
    build(p) {
      return mesh(new THREE.BoxGeometry(p.size[2], p.size[1], p.size[0]), paint(0x4a4f56, 0.7, 0.4));
    },
  },
  landingLight: {
    id: 'landingLight', name: '착륙등', cat: 'system', size: [0.4, 0.4, 0.4], mass: 8,
    desc: '야간 착륙용 강력 조명. 전방을 비춘다.',
    mirror: true,
    light: { intensity: 70, angle: 0.4, distance: 400 },
    build() {
      const g = new THREE.Group();
      const lens = mesh(new THREE.SphereGeometry(0.16, 12, 8), emissive(0xfff6dd, 0.2).clone());
      g.add(lens);
      g.userData.lens = lens;
      return g;
    },
  },
  solarPanel: {
    id: 'solarPanel', name: '태양 전지판', cat: 'system', size: [2.4, 0.08, 1.4], mass: 55,
    desc: '전기 추진기의 지속 운용을 돕는다.',
    mirror: true, power: 0.6,
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(p.size[2], 0.05, p.size[0]), paint(0x1a2a55, 0.25, 0.6)));
      g.add(mesh(new THREE.BoxGeometry(p.size[2] * 1.04, 0.07, 0.06), metal(0xc8ced4), [0, 0, 0]));
      return g;
    },
  },
  ballast: {
    id: 'ballast', name: '밸러스트', cat: 'system', size: [0.8, 0.8, 0.8], mass: 200,
    desc: '무게중심 조절용 중량물. 안정성 튜닝에 사용.',
    build(p) {
      return mesh(new THREE.BoxGeometry(p.size[2], p.size[1], p.size[0]), metal(0x50555c, 0.55));
    },
  },

  /* ---------- 열기구 ---------- */
  envelopeSmall: {
    id: 'envelopeSmall', name: '봉투 (소)', cat: 'balloon', size: [14, 18, 14], mass: 180,
    desc: '소형 열기구 봉투. 약 1,900 m³.',
    balloon: { volume: 1900 },
    build(p) {
      const g = new THREE.Group();
      const r = p.size[0] / 2;
      const col = p.color || 0xdd3344;
      const env = mesh(new THREE.SphereGeometry(r, 28, 20, 0, TAU, 0, Math.PI * 0.78), fabric(col), [0, 0, 0]);
      env.scale.y = p.size[1] / p.size[0] * 1.05;
      g.add(env);
      for (let i = 0; i < 6; i++) {
        const band = mesh(new THREE.SphereGeometry(r * 1.004, 28, 4, (i / 6) * TAU, TAU / 12, 0, Math.PI * 0.78),
          fabric(i % 2 ? 0xffdd55 : 0x3355cc), [0, 0, 0]);
        band.scale.y = env.scale.y;
        g.add(band);
      }
      // 하단 개구부와 로프
      g.add(mesh(new THREE.TorusGeometry(r * 0.33, 0.08, 6, 18), paint(0x6a5030), [0, -r * 1.02 * env.scale.y, 0], [Math.PI / 2, 0, 0]));
      return g;
    },
  },
  envelopeLarge: {
    id: 'envelopeLarge', name: '봉투 (대)', cat: 'balloon', size: [22, 28, 22], mass: 320,
    desc: '대형 봉투. 약 7,000 m³ — 무거운 바스켓도 띄운다.',
    balloon: { volume: 7000 },
    build(p) {
      const g = PARTS.envelopeSmall.build(p);
      return g;
    },
  },
  gasbag: {
    id: 'gasbag', name: '헬륨 가스백', cat: 'balloon', size: [10, 10, 10], mass: 140,
    desc: '가열 없이 항상 부력을 내는 헬륨 셀. 비행선용.',
    balloon: { volume: 1400, helium: true },
    build(p) {
      const r = p.size[0] / 2;
      const m = mesh(new THREE.SphereGeometry(r, 22, 16), fabric(0xdde3ea), [0, 0, 0]);
      m.scale.z = 1.6;
      return m;
    },
  },

  /* ---------- 무장 ---------- */
  machineGun: {
    id: 'machineGun', name: '기관총', cat: 'weapon', size: [1.6, 0.3, 0.3], mass: 60,
    desc: '전방 고정 기관총. 빠른 연사.',
    mirror: true,
    weapon: { rate: 11, damage: 8, speed: 900, spread: 0.004 },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, p.size[0], 8), metal(0x3a3f45, 0.45), [0, 0, 0], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.16, 0.4), paint(0x2a2d33), [0, 0, p.size[0] * 0.4]));
      g.userData.muzzle = new THREE.Vector3(0, 0, -p.size[0] / 2);
      return g;
    },
  },
  cannon: {
    id: 'cannon', name: '기관포', cat: 'weapon', size: [2.6, 0.5, 0.5], mass: 190,
    desc: '대구경 기관포. 한 발의 파괴력이 크다.',
    mirror: true,
    weapon: { rate: 4, damage: 34, speed: 1100, spread: 0.002 },
    build(p) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.08, 0.09, p.size[0], 10), metal(0x2f343a, 0.4), [0, 0, 0], [Math.PI / 2, 0, 0]));
      g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 10), metal(0x4a4f56), [0, 0, p.size[0] * 0.35], [Math.PI / 2, 0, 0]));
      g.userData.muzzle = new THREE.Vector3(0, 0, -p.size[0] / 2);
      return g;
    },
  },
};

export const CATEGORIES = [
  { id: 'structure', name: '구조', color: '#7fd4ff' },
  { id: 'wing', name: '날개', color: '#8affc1' },
  { id: 'engine', name: '추진', color: '#ffb066' },
  { id: 'gear', name: '착륙장치', color: '#c9a6ff' },
  { id: 'balloon', name: '기구', color: '#ff8fb1' },
  { id: 'system', name: '시스템', color: '#ffe066' },
  { id: 'weapon', name: '무장', color: '#ff7066' },
];

export function partList(cat) {
  return Object.values(PARTS).filter((p) => !cat || p.cat === cat);
}
