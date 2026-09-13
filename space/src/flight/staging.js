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
export function buildStages(parts) {
  if (!parts.length) return [];
  const maxStage = Math.max(...parts.map((p) => p.stage));
  const stages = [];

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
        action.decouple.push(p.uid);
        action.icons.push({ type: 'decoupler', name: def.name });
      } else if (def.engine) {
        action.ignite.push(p.uid);
        action.icons.push({ type: 'engine', name: def.name });
      }
    }

    // 분리기가 있으면 그보다 아래(같은 스테이지) 부품도 함께 떨어진다
    if (action.decouple.length) {
      for (const p of inStage) {
        if (action.decouple.includes(p.uid)) continue;
        if (p.def.clamp || p.def.chute) continue;
        // 같은 스테이지의 엔진/탱크는 분리기와 함께 버려진다
        if (!action.ignite.includes(p.uid)) {
          action.decouple.push(p.uid);
        }
      }
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

    // 이 스테이지에서 함께 버려지는 부품의 연료
    const stageParts = parts.filter((p) => p.stage === i && !p.destroyed);
    let propMass = 0;
    if (engines.length) {
      const prop = engines[0].def.engine.propellant;
      if (prop === 'lfox') {
        let lf = 0;
        let ox = 0;
        for (const p of stageParts) {
          lf += p.resources.lf ?? 0;
          ox += p.resources.ox ?? 0;
        }
        const units = Math.min(lf / LF_OX_RATIO.lf, ox / LF_OX_RATIO.ox);
        propMass =
          units *
          (LF_OX_RATIO.lf * RESOURCES.lf.density +
            LF_OX_RATIO.ox * RESOURCES.ox.density);
      } else if (RESOURCES[prop]) {
        for (const p of stageParts) {
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
