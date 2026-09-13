// ORBITER — 기본 제공 기체
// 코드로 조립한 프리셋. 설계실에서 불러와 자유롭게 수정할 수 있다.

import { Craft, CraftPart, nextUid } from './craft.js';
import { PART_BY_ID } from './partdefs.js';

/**
 * 수직 스택 빌더 — 아래에서 위로 쌓아 올린다.
 */
class Stacker {
  constructor(craft) {
    this.craft = craft;
    this.y = 0;
    this.last = null;
    this.stage = 0;
  }

  /** 위로 쌓기 */
  push(defId, opts = {}) {
    const def = PART_BY_ID.get(defId);
    if (!def) throw new Error(`프리셋 오류: 부품 ${defId} 없음`);
    const h = def.size.h;
    const part = new CraftPart(defId, opts.x ?? 0, this.y + h / 2, {
      stage: opts.stage ?? this.stage,
      parentUid: this.last?.uid ?? null,
      label: opts.label,
    });
    this.craft.add(part);
    this.y += h;
    this.last = part;
    return part;
  }

  /** 노즈콘처럼 위에 얹기만 하고 스택 높이를 갱신 */
  top(defId, opts = {}) {
    return this.push(defId, opts);
  }

  /** 측면 부착 — 좌우 대칭 한 쌍 */
  radialPair(defId, yPos, offset, opts = {}) {
    const def = PART_BY_ID.get(defId);
    if (!def) throw new Error(`프리셋 오류: 부품 ${defId} 없음`);
    const group = nextUid();
    const out = [];
    for (const side of [-1, 1]) {
      const part = new CraftPart(defId, side * offset, yPos, {
        stage: opts.stage ?? this.stage,
        parentUid: opts.parentUid ?? this.last?.uid ?? null,
        mirrored: side > 0,
        symmetryGroup: group,
      });
      this.craft.add(part);
      out.push(part);
    }
    return out;
  }

  /** 측면 부스터 스택 한 쌍 */
  boosterPair(defIds, baseY, offset, stage) {
    const group = nextUid();
    const made = [];
    for (const side of [-1, 1]) {
      let y = baseY;
      let parent = null;
      for (const defId of defIds) {
        const def = PART_BY_ID.get(defId);
        const part = new CraftPart(defId, side * offset, y + def.size.h / 2, {
          stage,
          parentUid: parent?.uid ?? null,
          mirrored: side > 0,
          symmetryGroup: group,
        });
        this.craft.add(part);
        y += def.size.h;
        parent = part;
        made.push(part);
      }
    }
    return made;
  }

  nextStage() {
    this.stage++;
    return this.stage;
  }
}

/* ──────────────────────────────────────────────────────────────
 * 프리셋 정의
 * ────────────────────────────────────────────────────────────── */

function makeSounding() {
  const craft = new Craft('사운딩 로켓 I');
  craft.description =
    '가장 단순한 고체 로켓. 고도 기록을 세우고 낙하산으로 돌아온다. 첫 발사에 딱 맞다.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_srb_small');
  s.stage = 1;
  s.push('pod_mk1');
  s.push('chute_small', { stage: 2 });
  craft.rootUid = craft.parts[1].uid;
  craft.normalizeStages();
  return craft;
}

function makeFirstOrbit() {
  const craft = new Craft('오비터 I');
  craft.description =
    '저궤도 진입용 2단 로켓. 스위블 1단 + 테리어 2단. 중력 선회를 연습하기 좋다.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_swivel');
  s.push('tank_t800', { stage: 0 });
  s.radialPair('fin_basic', 1.2, 1.0, { stage: 0 });
  s.stage = 1;
  s.push('decoupler_small', { stage: 1 });
  s.push('engine_terrier', { stage: 2 });
  s.push('tank_t400', { stage: 2 });
  s.stage = 3;
  s.push('pod_mk1', { stage: 3 });
  s.push('chute_small', { stage: 4 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'pod_mk1').uid;
  craft.normalizeStages();
  return craft;
}

function makeMunRocket() {
  const craft = new Craft('루나 익스프레스');
  craft.description =
    '루나 궤도 진입과 귀환이 가능한 3단 로켓. 부스터 두 개로 초기 추력을 보강한다.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_skipper');
  s.push('tank_x200_16', { stage: 0 });
  s.radialPair('fin_control', 2.0, 1.6, { stage: 0 });
  s.boosterPair(['engine_srb_large', 'decoupler_radial'], 0, 1.9, 0);
  s.stage = 1;
  s.push('decoupler_medium', { stage: 1 });
  s.push('engine_poodle', { stage: 2 });
  s.push('tank_x200_8', { stage: 2 });
  s.push('adapter_s_m', { stage: 2 });
  s.stage = 3;
  s.push('decoupler_small', { stage: 3 });
  s.push('engine_terrier', { stage: 4 });
  s.push('tank_t400', { stage: 4 });
  s.push('heatshield_small', { stage: 5 });
  s.push('pod_mk1', { stage: 5 });
  s.push('chute_small', { stage: 6 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'pod_mk1').uid;
  craft.normalizeStages();
  return craft;
}

function makeLander() {
  const craft = new Craft('착륙선 이글');
  craft.description =
    '진공 천체 착륙 전용. 스파크 엔진 4기와 착륙 다리, 그리고 넉넉한 RCS.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_spark');
  s.push('tank_t400', { stage: 0 });
  s.radialPair('leg_small', 0.9, 0.75, { stage: 0 });
  s.radialPair('rcs_block', 2.6, 0.7, { stage: 0 });
  s.push('tank_mono_small', { stage: 0 });
  s.stage = 1;
  s.push('lander_can', { stage: 1 });
  s.radialPair('solar_panel', 4.8, 1.4, { stage: 1 });
  s.push('probe_adv', { stage: 1 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'lander_can').uid;
  craft.normalizeStages();
  return craft;
}

function makeHeavyLifter() {
  const craft = new Craft('타이탄 헤비');
  craft.description =
    '3.75 m 코어에 킥백 부스터 두 개. 대형 페이로드를 저궤도에 올리는 주력 발사체.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_mainsail');
  s.push('tank_s3_7200', { stage: 0 });
  s.radialPair('fin_control', 3.0, 2.3, { stage: 0 });
  s.boosterPair(['engine_srb_kickback', 'decoupler_radial'], 0, 2.8, 0);
  s.stage = 1;
  s.push('adapter_m_l', { stage: 1 });
  s.push('decoupler_medium', { stage: 1 });
  s.push('engine_poodle', { stage: 2 });
  s.push('tank_x200_32', { stage: 2 });
  s.stage = 3;
  s.push('decoupler_medium', { stage: 3 });
  s.push('payload_station', { stage: 4 });
  s.push('fairing', { stage: 3 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'payload_station').uid;
  craft.normalizeStages();
  return craft;
}

function makeSatellite() {
  const craft = new Craft('릴레이 위성 발사체');
  craft.description =
    '통신 위성을 정지궤도에 올리는 소형 발사체. 상단에 이온 추진 모듈을 달았다.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_reliant');
  s.push('tank_t800', { stage: 0 });
  s.radialPair('fin_basic', 1.4, 1.0, { stage: 0 });
  s.stage = 1;
  s.push('decoupler_small', { stage: 1 });
  s.push('engine_terrier', { stage: 2 });
  s.push('tank_t400', { stage: 2 });
  s.stage = 3;
  s.push('decoupler_small', { stage: 3 });
  s.push('engine_ion', { stage: 4 });
  s.push('tank_xenon', { stage: 4 });
  s.push('battery_bank', { stage: 4 });
  s.push('payload_sat', { stage: 4 });
  s.radialPair('solar_panel_large', 11.5, 0.9, { stage: 4 });
  s.push('sci_dish', { stage: 4 });
  s.push('nosecone_small', { stage: 4 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'payload_sat').uid;
  craft.normalizeStages();
  return craft;
}

function makeNuclearShip() {
  const craft = new Craft('네르바 행성간 우주선');
  craft.description =
    '핵열 엔진 2기와 대형 액체연료 탱크. 산화제를 비워 Δv 를 극대화한 행성간 전이선.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_nerv');
  const tank1 = s.push('tank_x200_32', { stage: 0 });
  const tank2 = s.push('tank_x200_16', { stage: 0 });
  // 핵열 엔진은 액체연료만 쓰므로 산화제를 비운다
  for (const t of [tank1, tank2]) {
    t.disabledResources.add('ox');
    t.resources.ox = 0;
  }
  s.radialPair('rcs_block_large', 6.0, 1.4, { stage: 0 });
  s.push('reaction_wheel_large', { stage: 0 });
  s.push('tank_mono_small', { stage: 0 });
  s.stage = 1;
  s.push('adapter_s_m', { stage: 1 });
  s.push('pod_mk2', { stage: 1 });
  s.radialPair('solar_panel_large', 12.0, 1.6, { stage: 1 });
  s.radialPair('rtg', 11.0, 1.3, { stage: 1 });
  s.push('dock_medium', { stage: 1 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'pod_mk2').uid;
  craft.normalizeStages();
  return craft;
}

function makeReusableBooster() {
  const craft = new Craft('회수형 1단 그래스호퍼');
  craft.description =
    '벡터 엔진과 그리드 핀, 착륙 다리를 갖춘 회수형 부스터. 발사하고, 돌아오고, 다시 선다.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_vector');
  s.push('tank_t800', { stage: 0 });
  s.push('tank_t800', { stage: 0 });
  s.radialPair('leg_large', 1.4, 0.85, { stage: 0 });
  s.radialPair('gridfin', 13.0, 0.8, { stage: 0 });
  s.radialPair('rcs_block', 12.0, 0.75, { stage: 0 });
  s.push('tank_mono_small', { stage: 0 });
  s.push('probe_adv', { stage: 0 });
  s.push('nosecone_small', { stage: 0 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'probe_adv').uid;
  craft.normalizeStages();
  return craft;
}

function makeSpacePlane() {
  const craft = new Craft('스카이호크 우주비행기');
  craft.description =
    '래피어 공기흡입 엔진과 델타 날개. 활주로에서 떠올라 궤도까지 올라간다.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_rapier');
  s.push('tank_t800', { stage: 0 });
  s.push('tank_t400', { stage: 0 });
  s.radialPair('wing_small', 4.0, 1.6, { stage: 0 });
  s.radialPair('fin_control', 9.0, 1.0, { stage: 0 });
  s.radialPair('airbrake', 7.0, 0.8, { stage: 0 });
  s.radialPair('leg_small', 1.0, 0.8, { stage: 0 });
  s.push('pod_mk1_cmd', { stage: 0 });
  s.push('chute_drogue', { stage: 1 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'pod_mk1_cmd').uid;
  craft.normalizeStages();
  return craft;
}

function makeRoverMission() {
  const craft = new Craft('아레스 로버 탐사선');
  craft.description =
    '아레스 표면에 로버를 내려놓는 임무 기체. 열차폐, 드로그, 역추진 착륙단을 모두 갖췄다.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_skipper');
  s.push('tank_x200_32', { stage: 0 });
  s.radialPair('fin_control', 2.4, 1.7, { stage: 0 });
  s.stage = 1;
  s.push('decoupler_medium', { stage: 1 });
  s.push('engine_poodle', { stage: 2 });
  s.push('tank_x200_16', { stage: 2 });
  s.stage = 3;
  s.push('decoupler_medium', { stage: 3 });
  s.push('heatshield_medium', { stage: 4 });
  s.push('engine_spark', { stage: 5 });
  s.push('tank_t200', { stage: 5 });
  s.radialPair('leg_small', 0.6, 0.9, { stage: 5 });
  s.push('payload_rover', { stage: 6 });
  s.push('probe_adv', { stage: 6 });
  s.push('chute_drogue', { stage: 4 });
  s.push('fairing', { stage: 3 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'probe_adv').uid;
  craft.normalizeStages();
  return craft;
}

function makeStationCore() {
  const craft = new Craft('궤도 정거장 코어');
  craft.description =
    '도킹 포트 두 개와 대형 태양전지를 갖춘 정거장 모듈. 랑데부·도킹 연습용.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_poodle');
  s.push('tank_x200_16', { stage: 0 });
  s.stage = 1;
  s.push('payload_station', { stage: 1 });
  s.radialPair('solar_panel_large', 6.5, 1.8, { stage: 1 });
  s.radialPair('rcs_block_large', 5.0, 1.5, { stage: 1 });
  s.push('reaction_wheel_large', { stage: 1 });
  s.push('tank_mono_small', { stage: 1 });
  s.push('dock_medium', { stage: 1 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'payload_station').uid;
  craft.normalizeStages();
  return craft;
}

function makeMinimalProbe() {
  const craft = new Craft('초소형 탐사선 핀');
  craft.description =
    '가장 가벼운 탐사선. 작은 부스터 하나로 궤도에 겨우 닿는다. 예산이 없을 때.';
  const s = new Stacker(craft);
  s.stage = 0;
  s.push('engine_srb_small');
  s.stage = 1;
  s.push('decoupler_small', { stage: 1 });
  s.push('engine_spark', { stage: 2 });
  s.push('tank_oscar', { stage: 2 });
  s.push('tank_oscar', { stage: 2 });
  s.push('battery_small', { stage: 2 });
  s.push('probe_small', { stage: 2 });
  s.push('sci_thermometer', { stage: 2 });
  s.push('nosecone_small', { stage: 2 });
  craft.rootUid = craft.parts.find((p) => p.defId === 'probe_small').uid;
  craft.normalizeStages();
  return craft;
}

/* ──────────────────────────────────────────────────────────────
 * 등록
 * ────────────────────────────────────────────────────────────── */

export const PRESET_BUILDERS = [
  {
    id: 'sounding',
    name: '사운딩 로켓 I',
    difficulty: '입문',
    tag: '준궤도',
    build: makeSounding,
    hint: '스페이스바로 점화 → 고도 최고점에서 P 로 낙하산.',
  },
  {
    id: 'orbiter',
    name: '오비터 I',
    difficulty: '입문',
    tag: '저궤도',
    build: makeFirstOrbit,
    hint: '고도 10 km 부근에서 동쪽으로 천천히 기울여 중력 선회를 시작하세요.',
  },
  {
    id: 'probe_min',
    name: '초소형 탐사선 핀',
    difficulty: '입문',
    tag: '저예산',
    build: makeMinimalProbe,
    hint: '가볍지만 Δv 가 빠듯합니다. 상승 프로파일이 곧 성패입니다.',
  },
  {
    id: 'luna',
    name: '루나 익스프레스',
    difficulty: '보통',
    tag: '달 탐사',
    build: makeMunRocket,
    hint: '저궤도 진입 후 루나가 지평선 위 30도쯤일 때 전이 분사를 하세요.',
  },
  {
    id: 'lander',
    name: '착륙선 이글',
    difficulty: '보통',
    tag: '착륙',
    build: makeLander,
    hint: '수평 속도를 먼저 없애고, 마지막 500 m 에서 역추진을 시작하세요.',
  },
  {
    id: 'satellite',
    name: '릴레이 위성 발사체',
    difficulty: '보통',
    tag: '위성',
    build: makeSatellite,
    hint: '이온 엔진은 추력이 약합니다. 태양전지를 펴고 천천히 궤도를 올리세요.',
  },
  {
    id: 'reusable',
    name: '회수형 1단 그래스호퍼',
    difficulty: '어려움',
    tag: '회수',
    build: makeReusableBooster,
    hint: '역추진 분사 → 그리드 핀으로 자세 유지 → 마지막에 착륙 연소.',
  },
  {
    id: 'heavy',
    name: '타이탄 헤비',
    difficulty: '어려움',
    tag: '대형',
    build: makeHeavyLifter,
    hint: '추력이 엄청납니다. 스로틀을 조절해 max Q 를 견디세요.',
  },
  {
    id: 'rover',
    name: '아레스 로버 탐사선',
    difficulty: '어려움',
    tag: '행성간',
    build: makeRoverMission,
    hint: '아레스 대기는 얇습니다. 낙하산만 믿지 말고 역추진을 준비하세요.',
  },
  {
    id: 'station',
    name: '궤도 정거장 코어',
    difficulty: '어려움',
    tag: '도킹',
    build: makeStationCore,
    hint: '먼저 궤도에 올린 뒤, 두 번째 기체로 랑데부·도킹을 시도하세요.',
  },
  {
    id: 'nuclear',
    name: '네르바 행성간 우주선',
    difficulty: '전문가',
    tag: '행성간',
    build: makeNuclearShip,
    hint: '핵열 엔진은 추력이 낮습니다. 긴 분사를 근점에서 나눠 실행하세요.',
  },
  {
    id: 'plane',
    name: '스카이호크 우주비행기',
    difficulty: '전문가',
    tag: '우주비행기',
    build: makeSpacePlane,
    hint: '마하 4까지 공기흡입으로 가속한 뒤 로켓 모드로 전환하세요.',
  },
];

const _cache = new Map();

/** 프리셋 기체 생성 (매번 새 인스턴스) */
export function buildPreset(id) {
  const def = PRESET_BUILDERS.find((p) => p.id === id);
  if (!def) return null;
  try {
    const craft = def.build();
    craft.fillAll(1);
    craft.alignToGround();
    return craft;
  } catch (e) {
    console.error(`[presets] "${id}" 생성 실패`, e);
    return null;
  }
}

/** 프리셋 목록 + 통계 (메뉴 표시용) */
export function presetCatalog() {
  const out = [];
  for (const def of PRESET_BUILDERS) {
    let stats = _cache.get(def.id);
    if (!stats) {
      const craft = buildPreset(def.id);
      if (!craft) continue;
      const s = craft.stats(1, 9.81);
      stats = {
        mass: s.mass,
        deltaV: s.deltaV,
        stages: s.stages,
        cost: s.cost,
        parts: s.partCount,
        height: s.height,
        twr: s.liftoffTwr,
      };
      _cache.set(def.id, stats);
    }
    out.push({ ...def, stats });
  }
  return out;
}
