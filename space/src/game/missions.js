// ORBITER — 임무와 도전 과제
// 각 임무는 목표(objective) 목록을 가지며, 매 프레임 상태를 검사해 달성 여부를 갱신한다.

import { clamp01, formatDistance, formatSpeed } from '../core/math.js';
import { SITUATION } from '../physics/constants.js';
import { bus, EVT } from '../core/events.js';

/**
 * 목표 하나.
 * check(ctx) → true 면 달성. 한 번 달성되면 유지된다(기본).
 */
function obj(id, text, check, opts = {}) {
  return {
    id,
    text,
    check,
    optional: opts.optional ?? false,
    sticky: opts.sticky ?? true,
    hint: opts.hint ?? null,
    reward: opts.reward ?? 0,
  };
}

/* ──────────────────────────────────────────────────────────────
 * 임무 정의
 * ────────────────────────────────────────────────────────────── */

export const MISSIONS = [
  {
    id: 'first_flight',
    name: '첫 비행',
    tier: 1,
    body: 'terra',
    reward: 8000,
    science: 4,
    brief:
      '아무 로켓이나 좋습니다. 일단 발사대를 떠나 하늘로 올라가 보세요. 모든 것은 여기서 시작됩니다.',
    objectives: [
      obj('launch', '발사대를 떠날 것', (c) => c.vessel.hasLaunched),
      obj('alt1000', '고도 1,000 m 돌파', (c) => c.vessel.altitude > 1000),
      obj(
        'survive',
        '기체를 파괴하지 않고 착륙 또는 착수',
        (c) =>
          !c.vessel.destroyed &&
          (c.vessel.situation === SITUATION.LANDED ||
            c.vessel.situation === SITUATION.SPLASHED) &&
          c.vessel.missionTime > 20
      ),
    ],
    hint: '스페이스바로 발사, P 로 낙하산.',
  },

  {
    id: 'karman',
    name: '우주의 경계',
    tier: 1,
    body: 'terra',
    reward: 14000,
    science: 8,
    brief:
      '고도 70 km 위는 대기가 사실상 없습니다. 그 선을 넘어 "우주에 다녀왔다" 고 말할 자격을 얻으세요.',
    objectives: [
      obj('alt70k', '고도 70 km 돌파', (c) => c.vessel.altitude > 70000),
      obj(
        'return',
        '승무원(또는 탐사선)을 온전히 귀환시킬 것',
        (c) =>
          !c.vessel.destroyed &&
          (c.vessel.situation === SITUATION.LANDED ||
            c.vessel.situation === SITUATION.SPLASHED) &&
          c.maxAltitude > 70000,
        { hint: '재진입 속도가 빠르면 열차폐가 필요합니다.' }
      ),
    ],
  },

  {
    id: 'orbit',
    name: '궤도에 서다',
    tier: 2,
    body: 'terra',
    reward: 28000,
    science: 18,
    brief:
      '떨어지지 않는 유일한 방법은 옆으로 충분히 빨리 움직이는 것입니다. 근점을 대기권 밖에 두세요.',
    objectives: [
      obj(
        'orbit',
        '테라 궤도 진입 (근점 > 70 km)',
        (c) => c.vessel.situation === SITUATION.ORBITING
      ),
      obj(
        'circular',
        '이심률 0.1 이하의 안정 궤도',
        (c) =>
          c.vessel.situation === SITUATION.ORBITING && c.vessel.orbit.e < 0.1,
        { optional: true, reward: 6000 }
      ),
      obj(
        'orbit_return',
        '궤도에서 안전하게 귀환',
        (c) =>
          c.achieved.has('orbit') &&
          !c.vessel.destroyed &&
          (c.vessel.situation === SITUATION.LANDED ||
            c.vessel.situation === SITUATION.SPLASHED)
      ),
    ],
    hint: '고도 10 km 부터 동쪽으로 기울여 중력 선회를 시작하세요.',
  },

  {
    id: 'luna_flyby',
    name: '루나 접근 비행',
    tier: 3,
    body: 'luna',
    reward: 45000,
    science: 30,
    brief:
      '루나의 영향권(SOI)에 들어가 그 회색 표면을 가까이서 보세요. 착륙까지는 아직입니다.',
    objectives: [
      obj('orbit_first', '테라 궤도 진입', (c) => c.visitedSituations.has('orbiting')),
      obj('luna_soi', '루나 영향권 진입', (c) => c.vessel.body.id === 'luna'),
      obj(
        'close',
        '루나 표면 50 km 이내 접근',
        (c) => c.vessel.body.id === 'luna' && c.vessel.altitude < 50000
      ),
    ],
  },

  {
    id: 'luna_orbit',
    name: '루나 궤도',
    tier: 3,
    body: 'luna',
    reward: 60000,
    science: 45,
    brief:
      '루나 주위를 도는 안정 궤도에 진입하세요. 도착해서 감속하지 않으면 그냥 지나쳐 갑니다.',
    objectives: [
      obj('luna_soi', '루나 영향권 진입', (c) => c.vessel.body.id === 'luna'),
      obj(
        'luna_orbit',
        '루나 궤도 진입 (근점 > 10 km)',
        (c) =>
          c.vessel.body.id === 'luna' &&
          c.vessel.situation === SITUATION.ORBITING &&
          c.vessel.periapsis > 10000
      ),
    ],
  },

  {
    id: 'luna_landing',
    name: '루나 착륙',
    tier: 4,
    body: 'luna',
    reward: 120000,
    science: 90,
    brief:
      '인류의 발자국을 루나에 남기세요. 대기가 없으니 낙하산은 아무 의미가 없습니다. 오직 엔진뿐입니다.',
    objectives: [
      obj(
        'luna_land',
        '루나 표면에 착륙',
        (c) => c.vessel.body.id === 'luna' && c.vessel.situation === SITUATION.LANDED
      ),
      obj(
        'soft',
        '착륙 속도 6 m/s 이하',
        (c) =>
          c.vessel.body.id === 'luna' &&
          c.vessel.landed &&
          (c.vessel.landingSpeed ?? 99) < 6,
        { optional: true, reward: 20000 }
      ),
      obj(
        'return_home',
        '테라로 귀환',
        (c) =>
          c.achieved.has('luna_land') &&
          c.vessel.body.id === 'terra' &&
          (c.vessel.situation === SITUATION.LANDED ||
            c.vessel.situation === SITUATION.SPLASHED),
        { optional: true, reward: 60000 }
      ),
    ],
    hint: '수평 속도를 먼저 없애고, 마지막 500 m 에서 역추진하세요.',
  },

  {
    id: 'nyx_landing',
    name: '닉스의 얼음 평원',
    tier: 4,
    body: 'nyx',
    reward: 90000,
    science: 70,
    brief:
      '표면중력이 0.49 m/s² 인 작은 위성. 착륙은 쉽지만, 너무 빨리 내려오면 튕겨 나갑니다.',
    objectives: [
      obj(
        'nyx_land',
        '닉스 표면 착륙',
        (c) => c.vessel.body.id === 'nyx' && c.vessel.situation === SITUATION.LANDED
      ),
      obj(
        'nyx_stay',
        '착륙 상태로 30초 유지',
        (c) => c.landedTime > 30 && c.vessel.body.id === 'nyx'
      ),
    ],
  },

  {
    id: 'ares_transfer',
    name: '붉은 행성으로',
    tier: 5,
    body: 'ares',
    reward: 180000,
    science: 140,
    brief:
      '테라의 영향권을 벗어나 아레스로 향하는 전이 궤도에 올라타세요. 발사창을 놓치면 Δv 가 두 배로 듭니다.',
    objectives: [
      obj(
        'escape',
        '테라 영향권 탈출',
        (c) => c.vessel.body.id === 'helios'
      ),
      obj('ares_soi', '아레스 영향권 진입', (c) => c.vessel.body.id === 'ares'),
      obj(
        'ares_orbit',
        '아레스 궤도 진입',
        (c) =>
          c.vessel.body.id === 'ares' &&
          c.vessel.situation === SITUATION.ORBITING,
        { optional: true, reward: 60000 }
      ),
    ],
  },

  {
    id: 'ares_landing',
    name: '아레스 착륙',
    tier: 6,
    body: 'ares',
    reward: 300000,
    science: 260,
    brief:
      '0.6 % 기압. 낙하산만으로는 절대 멈추지 못합니다. 열차폐, 드로그, 역추진을 모두 쓰세요.',
    objectives: [
      obj(
        'ares_land',
        '아레스 표면 착륙',
        (c) => c.vessel.body.id === 'ares' && c.vessel.situation === SITUATION.LANDED
      ),
      obj(
        'intact',
        '부품을 절반 이상 유지한 채 착륙',
        (c) =>
          c.vessel.body.id === 'ares' &&
          c.vessel.landed &&
          c.vessel.partCount > c.initialPartCount * 0.5
      ),
    ],
  },

  {
    id: 'rendezvous',
    name: '궤도 랑데부',
    tier: 5,
    body: 'terra',
    reward: 150000,
    science: 120,
    brief:
      '이미 궤도에 있는 다른 기체 100 m 이내로 접근하세요. 상대속도를 0 에 가깝게 맞추는 것이 핵심입니다.',
    requiresTarget: true,
    objectives: [
      obj('orbit', '테라 궤도 진입', (c) => c.vessel.situation === SITUATION.ORBITING),
      obj(
        'approach',
        '목표와 거리 100 m 이내',
        (c) => c.targetDistance !== null && c.targetDistance < 100
      ),
      obj(
        'match',
        '상대속도 2 m/s 이하',
        (c) =>
          c.targetDistance !== null &&
          c.targetDistance < 300 &&
          c.targetRelativeSpeed < 2
      ),
    ],
  },

  {
    id: 'reusable',
    name: '부스터 회수',
    tier: 6,
    body: 'terra',
    reward: 220000,
    science: 150,
    brief:
      '분리한 1단을 그대로 버리지 말고, 역추진으로 되돌려 발사장 근처에 수직 착륙시키세요.',
    objectives: [
      obj('alt40k', '고도 40 km 돌파', (c) => c.maxAltitude > 40000),
      obj(
        'land_back',
        '테라 표면에 수직 착륙',
        (c) =>
          c.vessel.body.id === 'terra' &&
          c.vessel.situation === SITUATION.LANDED &&
          (c.vessel.landingSpeed ?? 99) < 8
      ),
      obj(
        'engines_alive',
        '엔진이 살아 있는 상태로 착륙',
        (c) =>
          c.vessel.landed &&
          c.vessel.parts.some((p) => !p.destroyed && p.isEngine)
      ),
    ],
  },

  {
    id: 'grand_tour',
    name: '대여행',
    tier: 8,
    body: 'hypatia',
    reward: 900000,
    science: 800,
    brief:
      '항성계의 모든 행성 영향권을 한 번씩 방문하세요. 중력 도움을 쓰지 않으면 평생 걸립니다.',
    objectives: [
      obj('visit_3', '천체 3곳 방문', (c) => c.visitedBodies.size >= 3),
      obj('visit_6', '천체 6곳 방문', (c) => c.visitedBodies.size >= 6),
      obj('visit_10', '천체 10곳 방문', (c) => c.visitedBodies.size >= 10),
      obj(
        'hypatia',
        '히파티아 영향권 도달',
        (c) => c.vessel.body.id === 'hypatia'
      ),
    ],
  },
];

/* ──────────────────────────────────────────────────────────────
 * 도전 과제 (업적)
 * ────────────────────────────────────────────────────────────── */

export const ACHIEVEMENTS = [
  {
    id: 'first_launch',
    name: '이륙',
    desc: '처음으로 발사대를 떠났다.',
    check: (c) => c.vessel.hasLaunched,
  },
  {
    id: 'mach1',
    name: '음속 돌파',
    desc: '마하 1 을 넘었다.',
    check: (c) => c.vessel.mach > 1,
  },
  {
    id: 'mach5',
    name: '극초음속',
    desc: '마하 5 를 넘었다.',
    check: (c) => c.vessel.mach > 5,
  },
  {
    id: 'space',
    name: '우주 도달',
    desc: '대기권을 벗어났다.',
    check: (c) => c.vessel.altitude > c.vessel.body.atmo.height,
  },
  {
    id: 'orbiter',
    name: '궤도 비행사',
    desc: '안정 궤도에 진입했다.',
    check: (c) => c.vessel.situation === SITUATION.ORBITING,
  },
  {
    id: 'escape_artist',
    name: '탈출 속도',
    desc: '천체의 중력에서 완전히 벗어났다.',
    check: (c) => c.vessel.situation === SITUATION.ESCAPING,
  },
  {
    id: 'soft_lander',
    name: '깃털 착륙',
    desc: '2 m/s 이하로 착륙했다.',
    check: (c) => c.vessel.landed && (c.vessel.landingSpeed ?? 99) < 2,
  },
  {
    id: 'high_g',
    name: '10 G',
    desc: '10 G 를 견디고 살아남았다.',
    check: (c) => c.vessel.maxG > 10 && !c.vessel.destroyed,
  },
  {
    id: 'hot_reentry',
    name: '불덩이',
    desc: '재진입 가열을 견뎌냈다.',
    check: (c) => c.maxHeatFlux > 300000 && !c.vessel.destroyed,
  },
  {
    id: 'long_haul',
    name: '장거리 비행',
    desc: '한 번의 비행에서 30일 이상 보냈다.',
    check: (c) => c.vessel.missionTime > 86400 * 30,
  },
  {
    id: 'far_out',
    name: '먼 곳',
    desc: '항성으로부터 100 Gm 이상 떨어졌다.',
    check: (c) => c.distanceFromStar > 1e11,
  },
  {
    id: 'splashdown',
    name: '착수',
    desc: '바다에 안전하게 내려앉았다.',
    check: (c) => c.vessel.situation === SITUATION.SPLASHED,
  },
  {
    id: 'twelve_stages',
    name: '다단 로켓',
    desc: '8단 이상의 로켓을 발사했다.',
    check: (c) => c.vessel.stages.length >= 8,
  },
  {
    id: 'no_engine',
    name: '무동력 귀환',
    desc: '엔진이 모두 사라진 상태로 착륙했다.',
    check: (c) =>
      c.vessel.landed && !c.vessel.parts.some((p) => !p.destroyed && p.isEngine),
  },
  {
    id: 'survivor',
    name: '생존자',
    desc: '부품이 절반 이상 파괴된 채로 착륙했다.',
    check: (c) =>
      c.vessel.landed && c.vessel.partCount < c.initialPartCount * 0.5,
  },
];

/* ──────────────────────────────────────────────────────────────
 * 임무 추적기
 * ────────────────────────────────────────────────────────────── */

export class MissionTracker {
  constructor(progress) {
    this.progress = progress;
    this.active = null;
    this.achieved = new Set();
    this.completedObjectives = new Set();
    this.context = null;
    this.reset();
  }

  reset() {
    this.achieved = new Set();
    this.completedObjectives = new Set();
    this.stats = {
      maxAltitude: 0,
      maxSpeed: 0,
      maxHeatFlux: 0,
      landedTime: 0,
      visitedBodies: new Set(),
      visitedSituations: new Set(),
      initialPartCount: 0,
      distanceFromStar: 0,
      targetDistance: null,
      targetRelativeSpeed: Infinity,
    };
    this.newlyUnlocked = [];
  }

  start(missionId, vessel) {
    const mission = MISSIONS.find((m) => m.id === missionId);
    if (!mission) return null;
    this.active = mission;
    this.reset();
    this.stats.initialPartCount = vessel?.partCount ?? 0;
    bus.emit(EVT.MISSION_START, { mission });
    return mission;
  }

  abandon() {
    this.active = null;
  }

  /** 매 프레임 호출 */
  update(dt, ctx) {
    if (!ctx.vessel) return;
    const v = ctx.vessel;
    const s = this.stats;

    // 통계 갱신
    if (v.altitude > s.maxAltitude) s.maxAltitude = v.altitude;
    if (v.surfaceSpeed > s.maxSpeed) s.maxSpeed = v.surfaceSpeed;
    if (v.heatFlux > s.maxHeatFlux) s.maxHeatFlux = v.heatFlux;
    if (v.landed || v.splashed) s.landedTime += dt;
    else s.landedTime = 0;
    s.visitedBodies.add(v.body.id);
    s.visitedSituations.add(v.situation);
    if (!s.initialPartCount) s.initialPartCount = v.partCount;
    if (ctx.system) {
      const abs = ctx.system.toAbsolute(v.body, v.pos, ctx.time);
      s.distanceFromStar = Math.hypot(abs.x, abs.y);
    }
    s.targetDistance = ctx.targetDistance ?? null;
    s.targetRelativeSpeed = ctx.targetRelativeSpeed ?? Infinity;

    const checkCtx = {
      vessel: v,
      system: ctx.system,
      time: ctx.time,
      achieved: this.completedObjectives,
      ...s,
    };

    // 업적
    for (const a of ACHIEVEMENTS) {
      if (this.progress.achievements.includes(a.id)) continue;
      let ok = false;
      try {
        ok = a.check(checkCtx);
      } catch (e) {
        ok = false;
      }
      if (ok) {
        this.progress.achievements.push(a.id);
        bus.emit(EVT.ACHIEVEMENT, { achievement: a });
        bus.emit(EVT.TOAST, {
          text: `업적 달성 — ${a.name}`,
          kind: 'success',
        });
      }
    }

    // 임무 목표
    if (!this.active) return;
    let allDone = true;
    for (const o of this.active.objectives) {
      if (this.completedObjectives.has(o.id)) continue;
      let ok = false;
      try {
        ok = o.check(checkCtx);
      } catch (e) {
        ok = false;
      }
      if (ok) {
        this.completedObjectives.add(o.id);
        bus.emit(EVT.MISSION_STEP, { mission: this.active, objective: o });
        bus.emit(EVT.TOAST, { text: `목표 달성 — ${o.text}`, kind: 'success' });
      } else if (!o.optional) {
        allDone = false;
      }
    }

    if (allDone && !this.completed) {
      this.completed = true;
      this.complete();
    }
  }

  complete() {
    const m = this.active;
    if (!m) return;
    let reward = m.reward;
    let science = m.science;
    for (const o of m.objectives) {
      if (o.optional && this.completedObjectives.has(o.id)) reward += o.reward;
    }
    this.progress.funds += reward;
    this.progress.science += science;
    if (!this.progress.completedMissions.includes(m.id)) {
      this.progress.completedMissions.push(m.id);
    }
    bus.emit(EVT.MISSION_COMPLETE, { mission: m, reward, science });
    bus.emit(EVT.TOAST, {
      text: `임무 완료 — ${m.name} (+${reward.toLocaleString('ko-KR')})`,
      kind: 'success',
    });
  }

  fail(reason) {
    if (!this.active) return;
    bus.emit(EVT.MISSION_FAIL, { mission: this.active, reason });
    bus.emit(EVT.TOAST, { text: `임무 실패 — ${reason}`, kind: 'danger' });
  }

  /** UI 표시용 목표 상태 */
  objectiveStates() {
    if (!this.active) return [];
    return this.active.objectives.map((o) => ({
      id: o.id,
      text: o.text,
      done: this.completedObjectives.has(o.id),
      optional: o.optional,
      hint: o.hint,
    }));
  }

  get progressFraction() {
    if (!this.active) return 0;
    const req = this.active.objectives.filter((o) => !o.optional);
    if (!req.length) return 1;
    const done = req.filter((o) => this.completedObjectives.has(o.id)).length;
    return done / req.length;
  }
}

/** 사용 가능한 임무 목록 (진행도 기준) */
export function availableMissions(progress) {
  const completed = new Set(progress.completedMissions);
  return MISSIONS.map((m) => ({
    ...m,
    completed: completed.has(m.id),
    locked: m.tier > 1 && !hasPrerequisite(m, completed),
  }));
}

function hasPrerequisite(mission, completed) {
  // 한 단계 아래 티어의 임무를 하나라도 완료했으면 해금
  const lower = MISSIONS.filter((m) => m.tier < mission.tier);
  if (!lower.length) return true;
  return lower.some((m) => completed.has(m.id));
}
