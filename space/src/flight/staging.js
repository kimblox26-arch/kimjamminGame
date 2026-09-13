// ORBITER — 스테이징
// 부품의 stage 번호를 읽어 "스페이스바를 누를 때마다 무슨 일이 일어나는가" 를
// 미리 계산해 둔다. UI 의 스테이지 목록도 여기서 만든다.

import { G0, RESOURCES, LF_OX_RATIO } from '../physics/constants.js';

/**
 * @typedef {object} StageAction
 * @property {number} index
 * @property {string[]} ignite   점화할 엔진 uid
 * @property {string[]} decouple 분리할 부품 uid
 * @property {string[]} chutes   전개할 낙하산 uid
 * @property {string[]} clamps   해제할 발사 클램프 uid
 * @property {string[]} fairings 분리할 페어링 uid
 */

/**
 * 런타임 파트 목록에서 스테이지 실행 계획을 만든다.
 * @param {import('./vessel.js').VesselPart[]} parts
 * @returns {StageAction[]}
 */
/** 설계실(CraftPart: x/y)과 비행(VesselPart: localX/localY) 양쪽에서 쓰기 위한 접근자 */
const px = (p) => (p.localX !== undefined ? p.localX : p.x);
const py = (p) => (p.localY !== undefined ? p.localY : p.y);

export function buildStages(parts) {
  if (!parts.length) return [];
  const maxStage = Math.max(...parts.map((p) => p.stage));
  const stages = [];

  // 어떤 부품이 이미 어느 분리기에 "예약" 되었는지 추적한다.
  const claimed = new Set();

  /**
   * 스택 분리기: 자기보다 아래(y 가 작은) 부품 전부를 떨궈낸다.
   * 방사형 분리기: 같은 쪽에 붙어 있는 측면 부스터만 떨궈낸다.
   */
  const jettisonSetFor = (dec) => {
    const out = [dec.uid];
    claimed.add(dec.uid);
    const radial = dec.def.decoupler?.radial;
    const fairing = dec.def.decoupler?.fairing;
    if (fairing) return out; // 페어링은 자기 자신만 열린다

    for (const p of parts) {
      if (claimed.has(p.uid) || p === dec) continue;
      if (p.def.clamp || p.def.chute) continue;
      if (radial) {
        // 같은 방향(좌/우)에 있고 중심축에서 떨어진 부품
        if (Math.abs(px(p)) < 0.4) continue;
        if (Math.sign(px(p)) !== Math.sign(px(dec))) continue;
        if (Math.abs(px(p) - px(dec)) > Math.max(2.5, p.def.size.w)) continue;
        out.push(p.uid);
        claimed.add(p.uid);
      } else {
        // 스택 분리기: 자기보다 낮은 위치의 부품
        if (py(p) < py(dec) - 0.01) {
          out.push(p.uid);
          claimed.add(p.uid);
        }
      }
    }
    return out;
  };

  // 분리기를 낮은 스테이지 → 낮은 높이 순으로 처리해야
  // 아래쪽 단이 먼저 예약된다.
  const decouplers = parts
    .filter((p) => p.def.decoupler && !p.def.decoupler.optional && !p.def.clamp)
    .sort((a, b) => a.stage - b.stage || py(a) - py(b));

  const jettisonMap = new Map();
  for (const dec of decouplers) {
    jettisonMap.set(dec.uid, jettisonSetFor(dec));
  }

  // 부품별 "연료 그룹" — 같은 분리기에 함께 떨어져 나가는 부품끼리 묶는다.
  // 엔진은 자기 그룹의 탱크에서만 연료를 뽑는다 (분리기를 넘는 크로스피드 없음).
  const fuelGroups = new Map();
  for (const dec of decouplers) {
    const gid = dec.stage;
    for (const uid of jettisonMap.get(dec.uid) ?? []) {
      if (!fuelGroups.has(uid)) fuelGroups.set(uid, gid);
    }
  }
  for (const p of parts) {
    if (!fuelGroups.has(p.uid)) fuelGroups.set(p.uid, Infinity);
  }
  for (const p of parts) p.fuelGroup = fuelGroups.get(p.uid);

  for (let i = 0; i <= maxStage; i++) {
    const inStage = parts.filter((p) => p.stage === i);
    const action = {
      index: i,
      ignite: [],
      decouple: [],
      chutes: [],
      clamps: [],
      fairings: [],
      icons: [],
    };

    for (const p of inStage) {
      const def = p.def;
      if (def.clamp) {
        action.clamps.push(p.uid);
        action.icons.push({ type: 'clamp', name: def.name });
      } else if (def.chute) {
        action.chutes.push(p.uid);
        action.icons.push({ type: 'chute', name: def.name });
      } else if (def.decoupler?.fairing) {
        action.fairings.push(p.uid);
        action.decouple.push(p.uid);
        action.icons.push({ type: 'fairing', name: def.name });
      } else if (def.decoupler && !def.decoupler.optional) {
        for (const uid of jettisonMap.get(p.uid) ?? [p.uid]) {
          if (!action.decouple.includes(uid)) action.decouple.push(uid);
        }
        action.icons.push({ type: 'decoupler', name: def.name });
      } else if (def.engine) {
        action.ignite.push(p.uid);
        action.icons.push({ type: 'engine', name: def.name });
      }
    }

    // 같은 스테이지에서 점화하는 엔진은 그 스테이지에 버려지지 않는다
    if (action.ignite.length && action.decouple.length) {
      action.decouple = action.decouple.filter(
        (uid) => !action.ignite.includes(uid)
      );
    }

    stages.push(action);
  }

  return stages;
}

/**
 * 스테이지 목록을 UI 용 정보로 변환한다.
 * @param {import('./vessel.js').Vessel} vessel
 * @param {number} pressureAtm
 */
export function stageSummaries(vessel, pressureAtm = 0) {
  const out = [];
  const parts = vessel.parts;

  for (let i = 0; i < vessel.stages.length; i++) {
    const st = vessel.stages[i];
    const done = i < vessel.stageIndex;
    const engines = st.ignite
      .map((uid) => parts.find((p) => p.uid === uid))
      .filter((p) => p && !p.destroyed);

    let thrust = 0;
    let flow = 0;
    for (const e of engines) {
      const t = e.thrustAt(pressureAtm);
      thrust += t;
      flow += t / (e.ispAt(pressureAtm) * G0);
    }

    // 이 단의 엔진이 실제로 뽑아 쓸 수 있는 연료 (같은 분리 그룹)
    let propMass = 0;
    if (engines.length) {
      const prop = engines[0].def.engine.propellant;
      const group = engines[0].fuelGroup;
      const pool =
        prop === 'sf'
          ? engines
          : parts.filter((p) => !p.destroyed && p.fuelGroup === group);
      if (prop === 'lfox') {
        let lf = 0;
        let ox = 0;
        for (const p of pool) {
          lf += p.resources.lf ?? 0;
          ox += p.resources.ox ?? 0;
        }
        const units = Math.min(lf / LF_OX_RATIO.lf, ox / LF_OX_RATIO.ox);
        propMass =
          units *
          (LF_OX_RATIO.lf * RESOURCES.lf.density +
            LF_OX_RATIO.ox * RESOURCES.ox.density);
      } else if (RESOURCES[prop]) {
        for (const p of pool) {
          propMass += (p.resources[prop] ?? 0) * RESOURCES[prop].density;
        }
      }
    }

    let startMass = 0;
    for (const p of parts) {
      if (p.destroyed || p.stage < i) continue;
      startMass += p.mass;
    }
    const endMass = Math.max(startMass - propMass, 1);
    const isp = flow > 0 ? thrust / (flow * G0) : 0;
    const deltaV =
      isp > 0 && startMass > endMass ? isp * G0 * Math.log(startMass / endMass) : 0;

    out.push({
      index: i,
      done,
      current: i === vessel.stageIndex,
      thrust,
      isp,
      deltaV,
      burnTime: flow > 0 ? propMass / flow : 0,
      engines: engines.length,
      icons: st.icons,
      decouples: st.decouple.length,
      chutes: st.chutes.length,
      clamps: st.clamps.length,
      startMass,
      endMass,
      twr:
        vessel.body && startMass > 0
          ? thrust / (startMass * vessel.body.surfaceGravity)
          : 0,
    });
  }
  return out;
}

/**
 * 다음 스테이지에서 무슨 일이 일어날지 한 줄 설명.
 */
export function describeNextStage(vessel) {
  const st = vessel.stages[vessel.stageIndex];
  if (!st) return '남은 스테이지 없음';
  const bits = [];
  if (st.clamps.length) bits.push('발사 클램프 해제');
  if (st.ignite.length) bits.push(`엔진 ${st.ignite.length}기 점화`);
  if (st.decouple.length) bits.push(`부품 ${st.decouple.length}개 분리`);
  if (st.chutes.length) bits.push(`낙하산 ${st.chutes.length}개 전개`);
  if (st.fairings.length) bits.push('페어링 개방');
  return bits.length ? bits.join(' · ') : '동작 없음';
}

/**
 * 자동 스테이징 판단 — 현재 스테이지 엔진이 모두 연소 종료되었는가.
 */
export function shouldAutoStage(vessel) {
  if (vessel.stageIndex >= vessel.stages.length) return false;
  const running = vessel.parts.filter(
    (p) => !p.destroyed && p.isEngine && p.running
  );
  if (!running.length) return false;
  // 모든 가동 엔진이 연료 고갈 상태
  return running.every((p) => p.flameout);
}

/**
 * 스테이지 재배치 — 설계실에서 드래그로 순서를 바꿀 때 사용.
 */
export function moveStage(parts, from, to) {
  if (from === to) return;
  const dir = from < to ? -1 : 1;
  for (const p of parts) {
    if (p.stage === from) {
      p.stage = to;
    } else if (dir < 0 && p.stage > from && p.stage <= to) {
      p.stage += dir;
    } else if (dir > 0 && p.stage >= to && p.stage < from) {
      p.stage += dir;
    }
  }
}

/**
 * 전체 Δv 예산 계산 — 설계실 표시용.
 */
export function totalDeltaV(summaries) {
  return summaries.reduce((a, s) => a + s.deltaV, 0);
}

/**
 * 연소 시간으로부터 목표 Δv 달성에 필요한 시간 추정.
 */
export function burnTimeForDeltaV(deltaV, thrust, mass, isp) {
  if (thrust <= 0 || isp <= 0) return Infinity;
  const ve = isp * G0;
  const flow = thrust / ve;
  const finalMass = mass * Math.exp(-deltaV / ve);
  return (mass - finalMass) / flow;
}

/**
 * 분사 시작 시각 계산 — 기동 노드 중심에 연소 중간이 오도록.
 */
export function burnStartOffset(burnTime) {
  return -burnTime / 2;
}
