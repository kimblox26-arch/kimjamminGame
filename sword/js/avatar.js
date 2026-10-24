// 로블록스 R6 스타일 하얀 아바타 리그
// 계층: root(발 기준, 위치만) → body(무게중심 피벗, 자세 회전) → torso / neck→head / 어깨→팔 / 엉덩이→다리
// 캐릭터 전방 = 로컬 +Z, 오른쪽 = -X. 전체 키 약 2.0 m.
import * as THREE from 'three';

export const RIG = {
  pivotY: 1.0,          // 발바닥 → 무게중심(body 피벗) 높이
  legLen: 0.8,
  armLen: 0.8,
  hipY: -0.2,           // body 기준 엉덩이 관절 높이
  shoulderY: 0.4,       // body 기준 어깨 관절 높이
  neckY: 0.6,           // body 기준 목 높이
};

// 모서리가 살짝 둥근 박스. 가장자리에 얇은 띠를 두고 법선을 둥글게 보간해 부드러운 모서리를 만든다.
export function roundedBox(w, h, d, r) {
  const g = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  const p = new THREE.Vector3(), inner = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const c = [p.x, p.y, p.z];
    for (let a = 0; a < 3; a++) {
      // 3분할 격자의 안쪽 줄을 모서리 바로 안쪽(half - r)으로 당긴다
      if (Math.abs(Math.abs(c[a]) - half[a]) > 1e-5) c[a] = Math.sign(c[a]) * (half[a] - r);
    }
    p.set(c[0], c[1], c[2]);
    inner.set(
      THREE.MathUtils.clamp(p.x, -half[0] + r, half[0] - r),
      THREE.MathUtils.clamp(p.y, -half[1] + r, half[1] - r),
      THREE.MathUtils.clamp(p.z, -half[2] + r, half[2] - r),
    );
    n.subVectors(p, inner);
    const len = n.length();
    if (len > 1e-6) {
      n.divideScalar(len);
      p.copy(inner).addScaledVector(n, r);
      // 면 위의 점(한 축만 튀어나온 경우)은 원래 면 법선을 유지
      const axes = (Math.abs(n.x) > 1e-3) + (Math.abs(n.y) > 1e-3) + (Math.abs(n.z) > 1e-3);
      if (axes > 1) nor.setXYZ(i, n.x, n.y, n.z);
    }
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  return g;
}

// 로블록스 기본 머리: 모서리가 둥근 원통
function headGeometry(radius, height, corner) {
  const pts = [];
  const hh = height / 2;
  pts.push(new THREE.Vector2(0, -hh));
  const seg = 6;
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - corner + Math.cos(a) * corner, -hh + corner + Math.sin(a) * corner));
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - corner + Math.cos(a) * corner, hh - corner + Math.sin(a) * corner));
  }
  pts.push(new THREE.Vector2(0, hh));
  const g = new THREE.LatheGeometry(pts, 40);
  g.computeVertexNormals();
  return g;
}

// 클래식 스마일 얼굴 텍스처 (원통 둘레 1.9 rad 에 펼쳐짐 → 가로를 그만큼 넓게)
function faceTexture() {
  // 구면 조각 (가로 1.7 rad, 세로 1.25 rad) 에 펼쳐지는 사람 얼굴: 눈(흰자·갈색 홍채·하이라이트), 눈썹, 코 그늘, 입술
  const c = document.createElement('canvas');
  c.width = 512; c.height = 384;
  const g = c.getContext('2d');
  const cx = 256;
  for (const sx of [-1, 1]) {
    const x = cx + sx * 58, y = 150;
    g.fillStyle = '#f4efe8'; g.beginPath(); g.ellipse(x, y, 26, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2416'; g.beginPath(); g.arc(x + sx * -2, y + 1, 10.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b0807'; g.beginPath(); g.arc(x + sx * -2, y + 1, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + sx * -2 + 3, y - 3, 2.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a120d'; g.lineWidth = 4; g.beginPath(); g.ellipse(x, y + 1, 27, 13, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    g.strokeStyle = '#1c130e'; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - sx * 30, y - 30); g.quadraticCurveTo(x, y - 42, x + sx * 30, y - 34); g.stroke();
  }
  // 코: 콧대 그늘 + 콧볼
  g.strokeStyle = 'rgba(120,70,50,0.35)'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(cx + 8, 165); g.quadraticCurveTo(cx + 14, 215, cx + 4, 236); g.stroke();
  g.fillStyle = 'rgba(110,60,45,0.4)';
  for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * 13, 240, 7, 4, 0, 0, Math.PI * 2); g.fill(); }
  // 입술
  g.fillStyle = '#a65a52'; g.beginPath(); g.moveTo(cx - 34, 286); g.quadraticCurveTo(cx, 276, cx + 34, 286); g.quadraticCurveTo(cx, 302, cx - 34, 286); g.fill();
  g.strokeStyle = '#5a2a26'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 34, 286); g.quadraticCurveTo(cx, 290, cx + 34, 286); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Avatar {
  setEnv(envMap) {
    this.material.envMap = envMap; this.material.needsUpdate = true;
    for (const m of this.gearMats || []) { m.envMap = envMap; m.needsUpdate = true; }
  }
  constructor() {
    // 실제 사람 비율의 영웅: 피부·머리카락·얼굴 + 몸에 맞는 전투복 (짙은 남색), 장갑·부츠
    //  (관절 위치·이름은 그대로 → 애니메이션·검·망토가 같은 리그를 씀)
    this.material = new THREE.MeshPhysicalMaterial({ color: 0x1d2433, roughness: 0.55, metalness: 0.0, sheen: 0.6, sheenRoughness: 0.5, sheenColor: 0x6a7a9a, clearcoat: 0.15, emissive: 0x000000 });
    const m = this.material;
    const skin = new THREE.MeshPhysicalMaterial({ color: 0xd8a98c, roughness: 0.5, sheen: 0.3, sheenColor: 0xffc8b0, emissive: 0x000000 });
    skin.emissive = m.emissive;      // 보우쇼크로 달아오를 때 같이
    const hair = new THREE.MeshStandardMaterial({ color: 0x14100d, roughness: 0.45 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x0f1115, roughness: 0.6, metalness: 0.1 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.4, metalness: 0.6 });
    this.skinMat = skin;

    this.root = new THREE.Group();
    this.root.name = 'avatar';
    this.body = new THREE.Group();
    this.body.position.y = RIG.pivotY;
    this.root.add(this.body);

    const mesh = (geo, parent, y = 0, x = 0, mat = m) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, 0);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    // 회전체 몸통: (높이, 반지름) 윤곽을 너비·두께 비율로 눌러 가슴·허리·골반 형태
    const lathe = (prof, sx, sz, seg = 28) => {
      const g = new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), seg);
      g.scale(sx, 1, sz);
      g.computeVertexNormals();
      return g;
    };
    // 몸통: 골반(-0.22) → 허리(0.0) → 가슴(0.32) → 어깨(0.5) → 목 밑(0.6)
    this.torso = mesh(lathe([[-0.24, 0.0], [-0.235, 0.13], [-0.16, 0.165], [-0.04, 0.15], [0.06, 0.148], [0.2, 0.17], [0.34, 0.182], [0.46, 0.17], [0.53, 0.13], [0.6, 0.065], [0.61, 0.0]], 1.32, 0.72), this.body, 0);
    // 가슴 장식선 (흰 트림)
    const tr = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.008, 6, 40, Math.PI), trim);
    tr.rotation.set(Math.PI / 2, 0, Math.PI); tr.scale.set(1.18, 0.72, 1); tr.position.set(0, 0.47, 0.0); this.body.add(tr);

    // 목 + 머리 (얼굴은 앞쪽 구면 조각에 그린 텍스처)
    this.neck = new THREE.Group();
    this.neck.position.set(0, RIG.neckY, 0);
    this.neck.rotation.order = 'YXZ';
    this.body.add(this.neck);
    mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.13, 16), this.neck, 0.03, 0, skin);
    const hg = new THREE.SphereGeometry(0.112, 32, 24); hg.scale(0.9, 1.14, 1.0);
    this.head = mesh(hg, this.neck, 0.17, 0, skin);
    // 귀
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), skin); e.scale.set(0.5, 1, 0.8); e.position.set(sx * 0.1, 0.165, -0.005); this.neck.add(e); }
    // 머리카락: 뒤·위를 덮는 짧은 머리 (앞머리 살짝)
    const hairG = new THREE.SphereGeometry(0.121, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.58); hairG.scale(0.93, 1.1, 1.04);
    const hairM = mesh(hairG, this.neck, 0.185, 0, hair); hairM.rotation.x = -0.32;
    const fringe = new THREE.SphereGeometry(0.118, 24, 8, Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.18, Math.PI * 0.16); fringe.scale(0.95, 1.1, 1.05);
    mesh(fringe, this.neck, 0.17, 0, hair);
    const face = new THREE.Mesh(
      new THREE.SphereGeometry(0.1135, 32, 16, Math.PI / 2 - 0.85, 1.7, 0.95, 1.25),
      new THREE.MeshStandardMaterial({ map: faceTexture(), transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    face.scale.set(0.9, 1.14, 1.0);
    face.position.y = 0.17;
    face.renderOrder = 2;
    this.neck.add(face);
    this.face = face;

    // 팔·다리: 위·아래 마디가 가늘어지는 캡슐 + 손·신발
    const makeLimb = (x, y, arm) => {
      const j = new THREE.Group();
      j.position.set(x, y, 0);
      j.rotation.order = 'XZY';
      this.body.add(j);
      const len = arm ? 0.7 : RIG.legLen;
      if (arm) {
        const up = new THREE.CapsuleGeometry(0.055, 0.25, 6, 14); up.translate(0, -0.15, 0);
        const lo = new THREE.CapsuleGeometry(0.046, 0.23, 6, 14); lo.translate(0, -0.44, 0);
        mesh(up, j, 0); mesh(lo, j, 0);
        const hand = new THREE.CapsuleGeometry(0.038, 0.06, 4, 10); hand.scale(1, 1, 0.65); hand.translate(0, -0.64, 0.005);
        mesh(hand, j, 0, 0, glove);
      } else {
        const th = new THREE.CapsuleGeometry(0.078, 0.3, 6, 14); th.translate(0, -0.2, 0);
        const ca = new THREE.CapsuleGeometry(0.058, 0.3, 6, 14); ca.translate(0, -0.55, 0);
        mesh(th, j, 0); mesh(ca, j, 0, 0, glove);
        const shoe = roundedBox(0.105, 0.09, 0.27, 0.03); shoe.translate(0, -0.755, 0.045);
        mesh(shoe, j, 0, 0, glove);
      }
      const tip = new THREE.Object3D();
      tip.position.set(0, arm ? -0.62 : -len + 0.06, 0);
      j.add(tip);
      return { joint: j, tip };
    };
    const ar = makeLimb(-0.255, RIG.shoulderY + 0.08, true);
    const al = makeLimb(0.255, RIG.shoulderY + 0.08, true);
    const lr = makeLimb(-0.1, RIG.hipY, false);
    const ll = makeLimb(0.1, RIG.hipY, false);
    this.shoulderR = ar.joint; this.shoulderL = al.joint;
    this.hipR = lr.joint; this.hipL = ll.joint;
    this.limbs = { handR: ar.tip, handL: al.tip, footR: lr.tip, footL: ll.tip };

    // ── 장비: 어깨 갑옷, 허리띠, 가슴 문장, 왼쪽 허리의 칼집 ──
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xc9a052, metalness: 1, roughness: 0.3, clearcoat: 0.6 });
    const steel = new THREE.MeshPhysicalMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.32, clearcoat: 0.4 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.8 });
    this.gearMats = [gold, steel];
    const gear = (geo, mat, parent, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
      o.castShadow = true; parent.add(o);
      return o;
    };
    for (const [sh, s] of [[this.shoulderR, -1], [this.shoulderL, 1]]) {
      gear(roundedBox(0.2, 0.08, 0.2, 0.035), steel, sh, s * 0.02, 0.03, 0, 0, 0, s * 0.3);
      gear(roundedBox(0.21, 0.02, 0.21, 0.01), gold, sh, s * 0.02, -0.005, 0, 0, 0, s * 0.3);
    }
    gear(roundedBox(0.4, 0.07, 0.25, 0.03), leather, this.body, 0, -0.1, 0);
    gear(roundedBox(0.08, 0.07, 0.03, 0.01), gold, this.body, 0, -0.1, 0.125);
    const emb = gear(new THREE.OctahedronGeometry(0.04, 0), new THREE.MeshStandardMaterial({ color: 0x3aa0ff, emissive: 0x2a7cff, emissiveIntensity: 2.5, roughness: 0.2 }), this.body, 0, 0.33, 0.135);
    emb.scale.set(1, 1.3, 0.35);
    this.emblem = emb;
    // 칼집: 왼쪽 허리, 뒤로 비스듬히 (칼날이 들어가는 방향 SDIR)
    const SDIR = new THREE.Vector3(0.12, -0.33, -0.94).normalize();
    const mouth = new THREE.Vector3(0.2, -0.08, 0.12);
    const sc = new THREE.Group();
    sc.position.copy(mouth);
    sc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), SDIR);
    this.body.add(sc);
    gear(new THREE.BoxGeometry(0.11, 1.42, 0.045), new THREE.MeshPhysicalMaterial({ color: 0x14141c, roughness: 0.35, clearcoat: 1 }), sc, 0, 0.73, 0);
    gear(new THREE.BoxGeometry(0.125, 0.06, 0.06), gold, sc, 0, 0.04, 0);
    gear(new THREE.BoxGeometry(0.125, 0.08, 0.06), gold, sc, 0, 1.42, 0);
    this.scabbard = sc;
    // 칼이 칼집에 있을 때의 자리: 손잡이는 입구 앞, 날은 칼집 안 (칼 로컬 +Y = 날)
    this.sheathSocket = new THREE.Object3D();
    this.sheathSocket.position.set(0, -0.2, 0);
    sc.add(this.sheathSocket);

    // 보간 대상 (고정 120Hz 시뮬레이션 ↔ 렌더 프레임)
    this.joints = [this.neck, this.shoulderR, this.shoulderL, this.hipR, this.hipL];
  }
}
