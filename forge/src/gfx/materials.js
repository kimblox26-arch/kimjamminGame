// 재질: 물리 특성(실제 값) + 렌더링 재질
import * as THREE from 'three';

// density kg/m³, strength 등은 실제 값을 근거로 게임에 맞게 조정
export const MATS = {
  steel:    { name: '강철 SS400', density: 7850, friction: 0.55, rest: 0.08, metal: true, weld: true, sound: 'metal', cut: 0.32, dent: true, color: 0x9aa0a8 },
  alu:      { name: '알루미늄 6061', density: 2700, friction: 0.5, rest: 0.1, metal: true, weld: true, sound: 'metal', cut: 0.12, dent: true, color: 0xc8ccd2 },
  wood:     { name: '구조용 소나무', density: 510, friction: 0.62, rest: 0.12, wood: true, nail: true, sound: 'wood', cut: 0.012, burn: true, color: 0xc9a46c },
  plywood:  { name: '구조용 합판', density: 600, friction: 0.6, rest: 0.1, wood: true, nail: true, sound: 'wood', cut: 0.02, burn: true, color: 0xd2b080 },
  brick:    { name: '점토 벽돌', density: 1900, friction: 0.75, rest: 0.05, masonry: true, sound: 'stone', cut: 0.03, color: 0x8a4030 },
  concrete: { name: '콘크리트', density: 2300, friction: 0.75, rest: 0.05, masonry: true, sound: 'stone', cut: 0.035, color: 0x8c8c88 },
  glass:    { name: '판유리', density: 2500, friction: 0.4, rest: 0.1, brittle: true, sound: 'glass', cut: 0.05, color: 0xbfd8e0 },
  rubber:   { name: '고무', density: 1150, friction: 1.0, rest: 0.4, sound: 'wood', cut: 0.02, color: 0x222222 },
  machine:  { name: '기계 부품', density: 3000, friction: 0.5, rest: 0.1, metal: true, weld: true, sound: 'metal', cut: 0.5, color: 0x666666 },
};

// 접합 강도 (N) — 실제 값 기반 근사
export const JOINT = {
  clamp: 2600,  // 마그네틱/C-클램프 임시 고정
  bead: 2600,   // 용접 비드 한 점(약 1 cm)
  nail: 750,    // 못 1개 전단
  bolt: 16000,  // M12 볼트 1개
  mortar: 1700, // 모르타르 한 덩이 (양생 후)
};

export class MaterialLib {
  constructor(skins, envMap) {
    this.skins = skins; this.envMap = envMap; this.cache = new Map();
  }
  // 스킨 기반 PBR 재질 (도장 색상 선택)
  get(skin, paint = null) {
    const key = skin + '|' + (paint ?? '');
    let m = this.cache.get(key);
    if (m) return m;
    const s = this.skins[paint != null ? 'paint' : skin] || this.skins.paint;
    const p = {
      map: s.map, normalMap: s.normalMap, roughnessMap: s.rmMap, metalnessMap: s.rmMap,
      roughness: 1, metalness: 1, envMapIntensity: 1,
    };
    if (skin === 'glass') {
      m = new THREE.MeshPhysicalMaterial({ color: 0xd8eef2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, ior: 1.52, specularIntensity: 1, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false });
    } else if (paint != null) {
      // 도장면: 클리어코트 느낌
      m = new THREE.MeshPhysicalMaterial({ ...p, color: new THREE.Color(paint), metalness: 0.3, roughness: 0.95, clearcoat: 0.6, clearcoatRoughness: 0.18 });
    } else {
      m = new THREE.MeshStandardMaterial(p);
      if (skin === 'tire' || skin === 'fabric') m.metalness = 0;
    }
    // 환경광(하늘 반사) 세기: 금속은 반사 위주, 비금속은 약하게
    m.envMapIntensity = /brushed|alu|galv|checker|millscale|cast/.test(skin) && paint == null ? 0.9 : skin === 'glass' ? 1.4 : 0.55;
    m.userData.uvScale = s.scale;
    this.cache.set(key, m);
    return m;
  }
  // 단순 재질
  plain(key, opts) {
    let m = this.cache.get('#' + key);
    if (!m) { m = new THREE.MeshStandardMaterial(opts); this.cache.set('#' + key, m); }
    return m;
  }
}
