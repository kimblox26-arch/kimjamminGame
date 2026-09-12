// FREE FREELY - 기본 제공 기체 설계도 (격납고)
// bx: 기수 방향(+), by: 위(+), bz: 우측(+) — 좌우 대칭 부품은 bz 값만 주면 자동 미러링.

export const PRESETS = [
  {
    id: 'lightplane',
    name: 'CIRRUS-1 경비행기',
    kind: 'plane',
    desc: '가장 다루기 쉬운 단발 프로펠러기. 저속 안정성이 좋아 첫 비행에 적합하다.',
    color: 0xf2f4f7,
    tags: ['입문', '프로펠러', '착륙 쉬움'],
    parts: [
      { type: 'fuselage', bx: 0, by: 0, bz: 0 },
      { type: 'fuselage', bx: -3.4, by: 0, bz: 0, scale: 0.92 },
      { type: 'noseCone', bx: 3.2, by: 0, bz: 0 },
      { type: 'pistonProp', bx: 4.4, by: 0, bz: 0 },
      { type: 'cockpitBubble', bx: 0.9, by: 0.85, bz: 0 },
      { type: 'wingStraight', bx: 0.6, by: 0.75, bz: 0.8, scale: 1.2, rot: 2 },
      { type: 'tailBoom', bx: -6.2, by: 0.1, bz: 0, scale: 0.9 },
      { type: 'hstab', bx: -8.0, by: 0.3, bz: 0.45 },
      { type: 'vfin', bx: -8.1, by: 0.9, bz: 0 },
      { type: 'noseGear', bx: 3.0, by: -1.62, bz: 0 },
      { type: 'mainGear', bx: -1.5, by: -1.3, bz: 1.15 },
      { type: 'fuelTank', bx: 0.4, by: 0.35, bz: 0, scale: 0.9 },
      { type: 'avionics', bx: 1.8, by: 0.1, bz: 0 },
      { type: 'landingLight', bx: 1.0, by: 0.55, bz: 1.6 },
      { type: 'parachute', bx: -1.6, by: 0.5, bz: 0 },
    ],
  },
  {
    id: 'fighter',
    name: 'FALCON-X 전투기',
    kind: 'fighter',
    desc: '애프터버너 장착 초음속 전투기. 델타익과 카나드로 극한 기동이 가능하다.',
    color: 0x8f99a6,
    tags: ['초음속', '애프터버너', '기관포'],
    parts: [
      { type: 'fuselage', bx: 1.2, by: 0, bz: 0, scale: 1.15 },
      { type: 'fuselage', bx: -3.4, by: 0, bz: 0, scale: 1.2 },
      { type: 'noseCone', bx: 4.6, by: 0, bz: 0, scale: 1.15 },
      { type: 'cockpitBubble', bx: 2.6, by: 0.85, bz: 0, scale: 1.05 },
      { type: 'canard', bx: 2.4, by: 0.35, bz: 1.0, rot: 1 },
      { type: 'wingDelta', bx: -2.2, by: -0.25, bz: 0.95, rot: 1 },
      { type: 'hstab', bx: -6.4, by: 0.1, bz: 0.8 },
      { type: 'vfin', bx: -6.0, by: 1.1, bz: 0, scale: 1.15 },
      { type: 'turbojet', bx: -6.6, by: 0, bz: 0 },
      { type: 'noseGear', bx: 3.4, by: -1.52, bz: 0 },
      { type: 'mainGear', bx: -4.3, by: -1.2, bz: 1.3 },
      { type: 'fuelTank', bx: 0.2, by: 0.3, bz: 0, scale: 1.1 },
      { type: 'fuelTank', bx: -1.9, by: 0.3, bz: 0, scale: 1.1 },
      { type: 'cannon', bx: 3.2, by: -0.45, bz: 0.55 },
      { type: 'flarePod', bx: -4.6, by: -0.7, bz: 0.9 },
      { type: 'avionics', bx: 1.4, by: 0.2, bz: 0 },
      { type: 'parachute', bx: 0.6, by: 0.7, bz: 0 },
      { type: 'landingLight', bx: 3.0, by: -0.9, bz: 0.35 },
    ],
  },
  {
    id: 'airliner',
    name: 'SKYLINER 320 여객기',
    kind: 'airliner',
    desc: '쌍발 터보팬 중형 여객기. 관성이 크므로 미리 감속하고 넉넉하게 선회해야 한다.',
    color: 0xf7f9fb,
    tags: ['대형', '터보팬', '장거리'],
    parts: [
      { type: 'cockpitClosed', bx: 12.6, by: 0.3, bz: 0, scale: 1.15 },
      { type: 'fuselageLong', bx: 8.0, by: 0, bz: 0 },
      { type: 'fuselageLong', bx: 0, by: 0, bz: 0 },
      { type: 'fuselageLong', bx: -8.0, by: 0, bz: 0 },
      { type: 'tailBoom', bx: -14.2, by: 0.5, bz: 0, scale: 1.7 },
      { type: 'wingSwept', bx: -0.5, by: -0.9, bz: 1.3, scale: 1.75, rot: 2 },
      { type: 'turbofan', bx: 1.6, by: -2.1, bz: 6.2, scale: 1.1 },
      { type: 'hstab', bx: -17.6, by: 1.0, bz: 0.7, scale: 1.9 },
      { type: 'vfin', bx: -17.2, by: 1.6, bz: 0, scale: 2.1 },
      { type: 'noseGear', bx: 10.4, by: -3.12, bz: 0, scale: 1.5 },
      { type: 'mainGear', bx: -3.6, by: -2.1, bz: 3.0, scale: 1.9 },
      { type: 'fuelTank', bx: -0.5, by: -0.6, bz: 3.0, scale: 1.6 },
      { type: 'fuelTank', bx: 3.2, by: -0.4, bz: 0, scale: 1.5 },
      { type: 'cargoBay', bx: -5.0, by: -0.9, bz: 0, scale: 0.9 },
      { type: 'avionics', bx: 10.0, by: 0.4, bz: 0 },
      { type: 'landingLight', bx: 9.0, by: -1.4, bz: 1.2 },
    ],
  },
  {
    id: 'balloon',
    name: 'SUNRISE-7 열기구',
    kind: 'balloon',
    desc: '버너로 공기를 데워 떠오른다. 바람을 읽어야 하며, 조작은 상승·하강뿐이다.',
    color: 0xff5544,
    tags: ['부력', '느긋함', '풍경'],
    parts: [
      { type: 'envelopeLarge', bx: 0, by: 17.5, bz: 0 },
      { type: 'basket', bx: 0, by: 0, bz: 0 },
      { type: 'burner', bx: 0, by: 1.5, bz: 0 },
      { type: 'fuelTank', bx: 0.45, by: 0.2, bz: 0, scale: 0.55 },
      { type: 'fuelTank', bx: -0.45, by: 0.2, bz: 0, scale: 0.55 },
      { type: 'ballast', bx: 0, by: -0.5, bz: 0, scale: 0.5 },
      { type: 'avionics', bx: 0, by: 0.6, bz: 0.5, scale: 0.6 },
    ],
  },
  {
    id: 'spaceship',
    name: 'ORBITER-1 우주선',
    kind: 'spacecraft',
    desc: '로켓으로 대기권을 돌파하고 이온 추진기로 순항한다. 우주에서는 RCS로 자세를 잡는다.',
    color: 0xdfe5ec,
    tags: ['로켓', 'RCS', '우주'],
    parts: [
      { type: 'spaceCapsule', bx: 5.4, by: 0, bz: 0 },
      { type: 'fuselage', bx: 1.6, by: 0, bz: 0, scale: 1.5 },
      { type: 'fuselage', bx: -3.2, by: 0, bz: 0, scale: 1.5 },
      { type: 'wingDelta', bx: -3.0, by: -0.4, bz: 1.1, scale: 0.85 },
      { type: 'vfin', bx: -6.0, by: 1.2, bz: 0, scale: 1.2 },
      { type: 'hstab', bx: -5.4, by: 0.3, bz: 0.8, scale: 1.1 },
      { type: 'rocket', bx: -7.2, by: 0, bz: 0 },
      { type: 'ionThruster', bx: -6.4, by: 0.2, bz: 1.5 },
      { type: 'rcs', bx: 4.0, by: 0.9, bz: 1.0 },
      { type: 'rcs', bx: -5.0, by: 0.9, bz: 1.0 },
      { type: 'solarPanel', bx: -1.0, by: 1.2, bz: 2.2 },
      { type: 'battery', bx: 0.4, by: -0.6, bz: 0 },
      { type: 'fuelTank', bx: -1.4, by: 0.2, bz: 0, scale: 1.6 },
      { type: 'fuelTank', bx: -4.6, by: 0.2, bz: 0, scale: 1.4 },
      { type: 'heatShield', bx: 7.0, by: 0, bz: 0, scale: 0.9 },
      { type: 'skid', bx: -4.6, by: -1.92, bz: 1.4 },
      { type: 'noseGear', bx: 3.4, by: -0.96, bz: 0, scale: 1.2 },
      { type: 'parachute', bx: 3.0, by: 0.9, bz: 0 },
      { type: 'avionics', bx: 2.2, by: 0.5, bz: 0 },
    ],
  },
  {
    id: 'glider',
    name: 'ZEPHYR 글라이더',
    kind: 'glider',
    desc: '엔진이 없다. 상승 기류(열상승풍)를 타고 고도를 벌어야 한다. 활공비가 매우 높다.',
    color: 0xeef2f6,
    tags: ['무동력', '열상승풍', '고효율'],
    parts: [
      { type: 'fuselage', bx: 0, by: 0, bz: 0, scale: 0.8 },
      { type: 'noseCone', bx: 2.4, by: 0, bz: 0, scale: 0.85 },
      { type: 'openCockpit', bx: 1.0, by: 0.6, bz: 0 },
      { type: 'wingStraight', bx: 0.2, by: 0.6, bz: 0.55, scale: 1.55, rot: 2.5 },
      { type: 'winglet', bx: -0.4, by: 1.0, bz: 9.8, scale: 0.9 },
      { type: 'tailBoom', bx: -4.6, by: 0.1, bz: 0, scale: 1.1 },
      { type: 'hstab', bx: -7.2, by: 0.4, bz: 0.4, scale: 0.95 },
      { type: 'vfin', bx: -7.3, by: 0.8, bz: 0, scale: 0.95 },
      { type: 'skid', bx: -1.1, by: -1.35, bz: 1.5, scale: 0.9 },
      { type: 'parachute', bx: -1.2, by: 0.3, bz: 0 },
    ],
  },
  {
    id: 'biplane',
    name: 'DUSTER 복엽기',
    kind: 'plane',
    desc: '고전적인 복엽기. 저속에서 놀랄 만큼 잘 돌고 곡예비행에 강하다.',
    color: 0xd94f2a,
    tags: ['복엽', '곡예', '개방 조종석'],
    parts: [
      { type: 'fuselage', bx: 0, by: 0, bz: 0, scale: 0.9 },
      { type: 'noseCone', bx: 2.8, by: 0, bz: 0, scale: 0.95 },
      { type: 'pistonProp', bx: 3.9, by: 0, bz: 0, scale: 0.95 },
      { type: 'openCockpit', bx: 0.2, by: 0.75, bz: 0 },
      { type: 'wingStraight', bx: 1.0, by: 1.5, bz: 0.5, scale: 0.95, rot: 1.5 },
      { type: 'wingStraight', bx: 0.6, by: -0.55, bz: 0.6, scale: 0.85, rot: 1.5 },
      { type: 'tailBoom', bx: -4.2, by: 0.1, bz: 0, scale: 0.85 },
      { type: 'hstab', bx: -6.2, by: 0.2, bz: 0.4, scale: 0.95 },
      { type: 'vfin', bx: -6.3, by: 0.7, bz: 0, scale: 0.9 },
      { type: 'mainGear', bx: 1.5, by: -1.35, bz: 1.0, scale: 0.95 },
      { type: 'skid', bx: -5.6, by: -1.15, bz: 0, scale: 0.5 },
      { type: 'fuelTank', bx: 0.2, by: 0.25, bz: 0, scale: 0.7 },
      { type: 'machineGun', bx: 2.2, by: 0.45, bz: 0.35 },
    ],
  },
  {
    id: 'floatplane',
    name: 'LAGOON 수상기',
    kind: 'plane',
    desc: '플로트를 달아 바다에 내릴 수 있다. 착수 시 물보라와 파도를 실감할 수 있다.',
    color: 0x2f6fb5,
    tags: ['수상 착륙', '탐험', '플로트'],
    parts: [
      { type: 'fuselage', bx: 0, by: 0.3, bz: 0 },
      { type: 'fuselage', bx: -3.4, by: 0.3, bz: 0, scale: 0.92 },
      { type: 'noseCone', bx: 3.2, by: 0.3, bz: 0 },
      { type: 'turboprop', bx: 4.6, by: 0.3, bz: 0, scale: 0.8 },
      { type: 'cockpitBubble', bx: 0.9, by: 1.15, bz: 0 },
      { type: 'wingStraight', bx: 0.5, by: 1.1, bz: 0.8, scale: 1.15, rot: 2 },
      { type: 'tailBoom', bx: -6.2, by: 0.4, bz: 0, scale: 0.9 },
      { type: 'hstab', bx: -8.0, by: 0.6, bz: 0.45, scale: 1.05 },
      { type: 'vfin', bx: -8.1, by: 1.2, bz: 0, scale: 1.05 },
      { type: 'float', bx: 0.4, by: -1.9, bz: 1.6 },
      { type: 'fuelTank', bx: 0.4, by: 0.6, bz: 0 },
      { type: 'landingLight', bx: 1.0, by: 0.9, bz: 1.6 },
      { type: 'avionics', bx: 1.8, by: 0.4, bz: 0 },
      { type: 'parachute', bx: -1.6, by: 0.8, bz: 0 },
    ],
  },
];

/** 새 설계를 시작할 때의 기본 골격 */
export function starterBlueprint() {
  return {
    name: '내 기체',
    color: 0xdde3ea,
    custom: true,
    parts: [
      { type: 'fuselage', bx: 0, by: 0, bz: 0 },
      { type: 'cockpitBubble', bx: 0.9, by: 0.85, bz: 0 },
      { type: 'noseCone', bx: 3.2, by: 0, bz: 0 },
    ],
  };
}

export function cloneBlueprint(bp) {
  return JSON.parse(JSON.stringify(bp));
}

/** 사용자 설계 저장소 (localStorage) */
const KEY = 'freefreely.designs.v1';

export function loadDesigns() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

export function saveDesign(bp) {
  const list = loadDesigns();
  const i = list.findIndex((d) => d.name === bp.name);
  const copy = cloneBlueprint(bp);
  copy.savedAt = Date.now();
  if (i >= 0) list[i] = copy; else list.push(copy);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* 저장 불가 */ }
  return list;
}

export function deleteDesign(name) {
  const list = loadDesigns().filter((d) => d.name !== name);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* 무시 */ }
  return list;
}
