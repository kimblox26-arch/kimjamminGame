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
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#111';
  // 눈: 세로로 긴 타원
  for (const x of [196, 316]) {
    g.beginPath();
    g.ellipse(x, 92, 15, 31, 0, 0, Math.PI * 2);
    g.fill();
  }
  // 입: 넓은 미소 곡선
  g.strokeStyle = '#111';
  g.lineWidth = 15;
  g.lineCap = 'round';
  g.beginPath();
  g.ellipse(256, 128, 96, 62, 0, Math.PI * 0.2, Math.PI * 0.8);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Avatar {
  setEnv(envMap) { this.material.envMap = envMap; this.material.needsUpdate = true; }
  constructor() {
    // 로블록스 플라스틱: 살짝 매끈한 흰색
    // 클리어코트: 플라스틱 위에 얇은 광택층 → 하늘·태양이 몸에 비침
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xe6e7ea, roughness: 0.42, metalness: 0.0,
      clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 0.9,
      emissive: 0x000000, emissiveIntensity: 1.0,
    });
    const m = this.material;

    this.root = new THREE.Group();
    this.root.name = 'avatar';
    this.body = new THREE.Group();
    this.body.position.y = RIG.pivotY;
    this.root.add(this.body);

    const mesh = (geo, parent, y = 0, x = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, 0);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };

    // 몸통 0.8 x 0.8 x 0.4 (중심 body 기준 +0.2)
    this.torso = mesh(roundedBox(0.8, 0.8, 0.4, 0.035), this.body, 0.2);

    // 목 + 머리
    this.neck = new THREE.Group();
    this.neck.position.set(0, RIG.neckY, 0);
    this.neck.rotation.order = 'YXZ';
    this.body.add(this.neck);
    mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.06, 20), this.neck, 0.02);
    this.head = mesh(headGeometry(0.245, 0.47, 0.1), this.neck, 0.27);
    // 로블록스 기본 얼굴 (Smile): 머리 앞면을 감싸는 얇은 원통 조각에 데칼
    const face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2465, 0.2465, 0.3, 24, 1, true, -0.95, 1.9),
      new THREE.MeshStandardMaterial({
        map: faceTexture(), transparent: true, roughness: 0.5, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1,
      }),
    );
    face.position.y = 0.285;
    face.renderOrder = 2;
    this.neck.add(face);
    this.face = face;

    const limbGeo = roundedBox(0.4, 0.8, 0.4, 0.035);
    const makeLimb = (x, y, len) => {
      const j = new THREE.Group();
      j.position.set(x, y, 0);
      j.rotation.order = 'XZY';
      this.body.add(j);
      mesh(limbGeo, j, -len / 2 + (len === RIG.armLen ? 0.2 : 0));
      const tip = new THREE.Object3D();
      tip.position.set(0, -len + 0.06 + (len === RIG.armLen ? 0.2 : 0), 0);
      j.add(tip);
      return { joint: j, tip };
    };
    // 팔: 관절은 팔 윗면에서 0.2 아래 (로블록스 R6 어깨 위치)
    const ar = makeLimb(-0.6, RIG.shoulderY, RIG.armLen);
    const al = makeLimb(0.6, RIG.shoulderY, RIG.armLen);
    // 다리: 관절은 다리 윗면
    const lr = makeLimb(-0.2, RIG.hipY, RIG.legLen);
    const ll = makeLimb(0.2, RIG.hipY, RIG.legLen);
    this.shoulderR = ar.joint; this.shoulderL = al.joint;
    this.hipR = lr.joint; this.hipL = ll.joint;
    this.limbs = { handR: ar.tip, handL: al.tip, footR: lr.tip, footL: ll.tip };

    // 보간 대상 (고정 120Hz 시뮬레이션 ↔ 렌더 프레임)
    this.joints = [this.neck, this.shoulderR, this.shoulderL, this.hipR, this.hipL];
  }
}
