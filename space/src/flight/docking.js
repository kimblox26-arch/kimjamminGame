// ORBITER — 도킹 · 기체 전환 · 자원 이송
//
// Spaceflight Simulator 의 핵심 후반 기능 세 가지를 담당한다.
//   1) 도킹 : 두 기체의 포트가 가까워지고 상대속도가 느리면 하나로 합쳐진다
//   2) 분리 : 도킹 포트를 풀면 다시 두 기체로 갈라진다
//   3) 이송 : 붙어 있는 기체 사이로 연료를 옮긴다
//
// 도킹은 "합체" 로 구현한다. 두 강체를 구속조건으로 묶는 대신
// 부품 목록을 한 기체로 합치면 물리·스테이징·자원망이 그대로 따라온다.

import { Vec2, clamp, clamp01, TAU } from '../core/math.js';
import { RESOURCES } from '../physics/constants.js';
import { bus, EVT } from '../core/events.js';

/** 도킹 포트 크기가 맞는가 */
function portsCompatible(a, b) {
  return a.def.dock.size === b.def.dock.size;
}

/**
 * 기체 로컬 좌표 → 천체 기준 절대 좌표.
 */
function partWorldPos(vessel, part, out = new Vec2()) {
  const lx = part.localX - vessel.com.x;
  const ly = part.localY - vessel.com.y;
  const a = vessel.angle - Math.PI / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  out.set(vessel.pos.x + lx * c - ly * s, vessel.pos.y + lx * s + ly * c);
  return out;
}

/** 포트가 바라보는 방향 (기체 로컬 +y 가 기본) */
function portFacing(vessel, part) {
  const a = vessel.angle - Math.PI / 2 + (part.rot ?? 0);
  return new Vec2(-Math.sin(a), Math.cos(a));
}

/**
 * 비어 있는 (아직 도킹하지 않은) 도킹 포트 목록.
 */
export function freePorts(vessel) {
  const out = [];
  for (const p of vessel.parts) {
    if (p.destroyed || !p.def.dock) continue;
    if (p.dockedTo) continue;
    out.push(p);
  }
  return out;
}

/**
 * 두 기체 사이에서 도킹 가능한 포트 쌍을 찾는다.
 * @returns {{a,b,distance,closingSpeed}|null}
 */
export function findDockingPair(vA, vB) {
  if (vA === vB) return null;
  if (vA.body !== vB.body) return null;
  const pa = freePorts(vA);
  const pb = freePorts(vB);
  if (!pa.length || !pb.length) return null;

  // 상대 속도 — 너무 빠르면 부딪혀서 튕긴다
  const rvx = vB.vel.x - vA.vel.x;
  const rvy = vB.vel.y - vA.vel.y;
  const closing = Math.hypot(rvx, rvy);

  const wa = new Vec2();
  const wb = new Vec2();
  let best = null;
  for (const a of pa) {
    partWorldPos(vA, a, wa);
    for (const b of pb) {
      if (!portsCompatible(a, b)) continue;
      partWorldPos(vB, b, wb);
      const d = Math.hypot(wb.x - wa.x, wb.y - wa.y);
      const range = Math.max(a.def.dock.captureRange, b.def.dock.captureRange);
      if (d > range) continue;
      const maxSpeed = Math.min(a.def.dock.captureSpeed, b.def.dock.captureSpeed);
      if (closing > maxSpeed) continue;
      // 포트가 서로 마주보고 있어야 한다
      const fa = portFacing(vA, a);
      const fb = portFacing(vB, b);
      const facing = -(fa.x * fb.x + fa.y * fb.y);
      if (facing < 0.25) continue;
      if (!best || d < best.distance) {
        best = { a, b, distance: d, closingSpeed: closing, facing };
      }
    }
  }
  return best;
}

/**
 * 두 기체를 하나로 합친다. vA 가 남고 vB 의 부품이 옮겨온다.
 * @returns {Vessel} 합쳐진 기체 (= vA)
 */
export function dock(vA, vB, pair) {
  const { a, b } = pair;

  // 합체 후의 운동량 보존 — 완전 비탄성 충돌
  const mA = vA.mass;
  const mB = vB.mass;
  const total = mA + mB;
  const vx = (vA.vel.x * mA + vB.vel.x * mB) / total;
  const vy = (vA.vel.y * mA + vB.vel.y * mB) / total;
  const omega =
    (vA.angularVelocity * vA.inertia + vB.angularVelocity * vB.inertia) /
    Math.max(vA.inertia + vB.inertia, 1);

  // vB 의 부품을 vA 의 로컬 좌표로 옮긴다.
  // 포트 a 의 바로 위(바깥쪽)에 포트 b 가 오도록 정렬한다.
  const angDiff = vA.angle - vB.angle + Math.PI;
  const c = Math.cos(angDiff);
  const s = Math.sin(angDiff);

  // a 포트의 vA 로컬 위치와 바깥 방향
  const aOut = a.rot ?? 0;
  const ax = a.localX;
  const ay = a.localY + (a.def.size.h * (a.scaleH ?? 1)) / 2;

  const moved = [];
  for (const p of vB.parts) {
    if (p.destroyed) continue;
    // b 포트를 원점으로 하는 좌표
    const rx = p.localX - b.localX;
    const ry = p.localY - b.localY;
    // 180° 돌려서 붙인다
    p.localX = ax + (rx * c - ry * s);
    p.localY = ay + (rx * s + ry * c);
    p.rot = (p.rot ?? 0) + angDiff;
    // 스테이지는 전부 "이미 지나간" 단으로 — 합체 후 실수로 분리되지 않게
    p.stage = -1;
    moved.push(p);
  }

  a.dockedTo = b.uid;
  b.dockedTo = a.uid;
  a.dockPeerVesselName = vB.name;
  b.dockPeerVesselName = vA.name;
  // 분리할 때 어디서 잘라야 하는지 기록
  a.dockJoint = { partnerUid: b.uid, movedUids: moved.map((p) => p.uid) };
  b.dockJoint = { partnerUid: a.uid, movedUids: [] };

  vA.parts.push(...moved);
  vB.parts = [];
  vB.merged = true;

  vA.vel.set(vx, vy);
  vA.angularVelocity = omega * 0.4;
  vA.docked = true;
  vA.rebuildAfterStructureChange();

  bus.emit(EVT.TOAST, { text: `도킹 완료 — ${vB.name}`, kind: 'good' });
  bus.emit(EVT.LOG, { text: `도킹: ${vA.name} ↔ ${vB.name}` });
  return vA;
}

/**
 * 도킹 포트를 푼다. 포트 위쪽(도킹으로 붙어온 쪽) 부품들이 새 기체가 된다.
 * @returns {Vessel|null} 떨어져 나간 기체
 */
export function undock(vessel, port, makeVessel) {
  if (!port?.dockedTo || !port.dockJoint) return null;
  const uids = new Set(port.dockJoint.movedUids);
  if (!uids.size) {
    // 이 쪽이 "붙어온 쪽" 이면 상대 포트가 관절을 들고 있다
    const other = vessel.parts.find((p) => p.uid === port.dockedTo);
    if (other?.dockJoint?.movedUids?.length) {
      return undock(vessel, other, makeVessel);
    }
    return null;
  }

  const leaving = vessel.parts.filter((p) => uids.has(p.uid));
  if (!leaving.length || leaving.length === vessel.parts.length) return null;

  vessel.parts = vessel.parts.filter((p) => !uids.has(p.uid));

  const partner = leaving.find((p) => p.uid === port.dockedTo);
  port.dockedTo = null;
  port.dockJoint = null;
  if (partner) {
    partner.dockedTo = null;
    partner.dockJoint = null;
  }

  const child = makeVessel(leaving, vessel);
  if (!child) return null;

  // 살짝 밀어낸다 (스프링 분리)
  const a = vessel.angle - Math.PI / 2;
  const push = 0.6;
  child.vel.set(
    vessel.vel.x - Math.sin(a) * -push,
    vessel.vel.y + Math.cos(a) * push
  );
  vessel.vel.x += Math.sin(a) * -push * 0.2;
  vessel.vel.y -= Math.cos(a) * push * 0.2;

  vessel.docked = vessel.parts.some((p) => p.dockedTo);
  vessel.rebuildAfterStructureChange();

  bus.emit(EVT.TOAST, { text: '도킹 해제', kind: 'info' });
  return child;
}

/**
 * 자원 이송 — 같은 기체(도킹 포함) 안에서 한 탱크에서 다른 탱크로 옮긴다.
 * @param {VesselPart[]} from
 * @param {VesselPart[]} to
 * @param {string} key
 * @param {number} amount  옮길 양 (음수면 전부)
 * @returns {number} 실제로 옮긴 양
 */
export function transferBetweenParts(from, to, key, amount = -1) {
  const res = RESOURCES[key];
  if (!res) return 0;

  let available = 0;
  for (const p of from) {
    if (p.destroyed) continue;
    available += p.resources[key] ?? 0;
  }
  let space = 0;
  for (const p of to) {
    if (p.destroyed) continue;
    const max = (p.def.fuel?.[key] ?? 0) * (p.sizeFactor ?? 1);
    if (max <= 0) continue;
    space += max - (p.resources[key] ?? 0);
  }
  let move = Math.min(available, space);
  if (amount >= 0) move = Math.min(move, amount);
  if (move <= 1e-6) return 0;

  // 균등하게 빼고 균등하게 채운다
  let left = move;
  for (const p of from) {
    if (left <= 1e-9) break;
    const have = p.resources[key] ?? 0;
    const take = Math.min(have, (move * have) / Math.max(available, 1e-9));
    p.resources[key] = have - take;
    left -= take;
  }
  let put = move;
  for (const p of to) {
    if (put <= 1e-9) break;
    const max = (p.def.fuel?.[key] ?? 0) * (p.sizeFactor ?? 1);
    if (max <= 0) continue;
    const room = max - (p.resources[key] ?? 0);
    const give = Math.min(room, (move * room) / Math.max(space, 1e-9));
    p.resources[key] = (p.resources[key] ?? 0) + give;
    put -= give;
  }
  return move;
}

/**
 * 매 물리 스텝마다 근처 기체와의 도킹을 검사한다.
 * @param {Vessel} active
 * @param {Vessel[]} others
 * @returns {Vessel|null} 흡수된 기체
 */
export function updateDocking(active, others) {
  if (!active || active.destroyed) return null;
  if (!active.parts.some((p) => p.def.dock && !p.dockedTo)) return null;
  for (const other of others) {
    if (other === active || other.destroyed || other.merged) continue;
    // 너무 멀면 건너뛴다 (제곱거리 비교)
    const dx = other.pos.x - active.pos.x;
    const dy = other.pos.y - active.pos.y;
    if (dx * dx + dy * dy > 2500) continue;
    const pair = findDockingPair(active, other);
    if (pair) {
      dock(active, other, pair);
      return other;
    }
  }
  return null;
}

/**
 * 가장 가까운 도킹 대상까지의 정보 — HUD 표시용.
 */
export function dockingInfo(active, others) {
  let best = null;
  for (const other of others) {
    if (other === active || other.destroyed || other.merged) continue;
    const dx = other.pos.x - active.pos.x;
    const dy = other.pos.y - active.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 2000) continue;
    const rv = Math.hypot(other.vel.x - active.vel.x, other.vel.y - active.vel.y);
    if (!best || d < best.distance) {
      best = { target: other, distance: d, relSpeed: rv, dx, dy };
    }
  }
  return best;
}
