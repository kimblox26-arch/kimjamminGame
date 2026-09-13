// ORBITER — 자원 흐름
// 비행 중 연료·산화제·모노프로펠런트·전기의 소비와 공급을 관리한다.
//
// 실제 로켓처럼 "아래 탱크부터" 빼서 무게중심이 위로 몰리지 않게 한다.
// (크로스피드가 켜진 부스터는 별도 우선순위 그룹으로 처리)

import { clamp01 } from '../core/math.js';
import { RESOURCES, LF_OX_RATIO } from '../physics/constants.js';

/**
 * 하나의 자원 저장소 뷰 — 파트의 resources 객체를 참조한다.
 */
export class ResourceNetwork {
  /**
   * @param {object[]} parts 런타임 파트 배열 (각자 resources, def, localY 를 가진다)
   */
  constructor(parts) {
    this.parts = parts;
    /** 자원별 파트 목록 캐시 */
    this.byResource = new Map();
    this.rebuild();
  }

  rebuild() {
    this.byResource.clear();
    for (const key in RESOURCES) this.byResource.set(key, []);
    for (const part of this.parts) {
      if (part.destroyed) continue;
      for (const key in part.resources) {
        if (part.resources[key] === undefined) continue;
        const list = this.byResource.get(key);
        if (list) list.push(part);
      }
    }
    // 아래쪽(작은 y)부터 소비하도록 정렬
    for (const [, list] of this.byResource) {
      list.sort((a, b) => a.localY - b.localY);
    }
  }

  /**
   * draw() 와 똑같은 필터를 적용한 실제 가용량.
   * 이걸 쓰지 않으면 "탱크에는 있는데 내 그룹에는 없는" 상황을
   * 가용한 것으로 오판해 엔진이 연소 종료되지 않는다.
   */
  available(key, opts = {}) {
    let list = opts.fromParts ?? this.byResource.get(key);
    if (!list) return 0;
    if (opts.stage !== undefined) {
      const filtered = list.filter((p) => p.stage >= opts.stage);
      if (filtered.length) list = filtered;
    }
    if (opts.group !== undefined) {
      list = list.filter((p) => p.fuelGroup === opts.group);
    }
    let t = 0;
    for (const p of list) {
      if (p.destroyed) continue;
      t += p.resources[key] ?? 0;
    }
    return t;
  }

  /** 자원 총량 */
  total(key) {
    const list = this.byResource.get(key);
    if (!list) return 0;
    let t = 0;
    for (const p of list) {
      if (p.destroyed) continue;
      t += p.resources[key] ?? 0;
    }
    return t;
  }

  /** 자원 최대 총량 */
  capacity(key) {
    const list = this.byResource.get(key);
    if (!list) return 0;
    let t = 0;
    for (const p of list) {
      if (p.destroyed) continue;
      t += p.def.fuel?.[key] ?? 0;
    }
    return t;
  }

  /** 잔량 비율 */
  fraction(key) {
    const cap = this.capacity(key);
    return cap > 0 ? clamp01(this.total(key) / cap) : 0;
  }

  /**
   * 자원 인출. 가능한 만큼만 빼고 실제 인출량을 반환한다.
   * @param {string} key
   * @param {number} amount
   * @param {object} opts { stage, fromParts }
   */
  draw(key, amount, opts = {}) {
    if (amount <= 0) return 0;
    let list = opts.fromParts ?? this.byResource.get(key);
    if (!list || !list.length) return 0;
    if (opts.stage !== undefined) {
      const filtered = list.filter((p) => p.stage >= opts.stage);
      if (filtered.length) list = filtered;
    }
    // 연료 그룹 제한 — 분리기를 넘어선 크로스피드를 막는다.
    // 폴백 없이 엄격하게 거른다(빈 그룹이면 그대로 연소 종료).
    if (opts.group !== undefined) {
      list = list.filter((p) => p.fuelGroup === opts.group);
      if (!list.length) return 0;
    }

    let remaining = amount;
    for (const part of list) {
      if (remaining <= 1e-12) break;
      if (part.destroyed) continue;
      const have = part.resources[key] ?? 0;
      if (have <= 0) continue;
      const take = Math.min(have, remaining);
      part.resources[key] = have - take;
      remaining -= take;
    }
    return amount - remaining;
  }

  /**
   * 자원 주입 (ISRU, 도킹 이송, 태양전지 충전).
   * @returns 실제 주입량
   */
  fill(key, amount, opts = {}) {
    if (amount <= 0) return 0;
    const list = opts.toParts ?? this.byResource.get(key);
    if (!list || !list.length) return 0;
    let remaining = amount;
    for (const part of list) {
      if (remaining <= 1e-12) break;
      if (part.destroyed) continue;
      const cap = part.def.fuel?.[key] ?? 0;
      if (cap <= 0) continue;
      const have = part.resources[key] ?? 0;
      const space = cap - have;
      if (space <= 0) continue;
      const give = Math.min(space, remaining);
      part.resources[key] = have + give;
      remaining -= give;
    }
    return amount - remaining;
  }

  /**
   * 액체연료+산화제를 혼합비에 맞춰 인출한다.
   * @param {number} massFlow kg/s
   * @param {number} dt
   * @returns {{consumed:number, starved:boolean}} 실제 소비 질량
   */
  drawBipropellant(massFlow, dt, opts = {}) {
    const wanted = massFlow * dt;
    if (wanted <= 0) return { consumed: 0, starved: false };

    // 혼합 1 단위당 질량
    const unitMass =
      LF_OX_RATIO.lf * RESOURCES.lf.density +
      LF_OX_RATIO.ox * RESOURCES.ox.density;
    const wantedUnits = wanted / unitMass;

    const lfWant = wantedUnits * LF_OX_RATIO.lf;
    const oxWant = wantedUnits * LF_OX_RATIO.ox;

    const lfAvail = this.available('lf', opts);
    const oxAvail = this.available('ox', opts);
    const ratio = Math.min(
      1,
      lfWant > 0 ? lfAvail / lfWant : 1,
      oxWant > 0 ? oxAvail / oxWant : 1
    );

    const lfGot = this.draw('lf', lfWant * ratio, opts);
    const oxGot = this.draw('ox', oxWant * ratio, opts);
    const consumed =
      lfGot * RESOURCES.lf.density + oxGot * RESOURCES.ox.density;
    return { consumed, starved: consumed < wanted * 0.999 };
  }

  /** 단일 추진제 인출 (고체·핵열·이온·모노) */
  drawMonopropellant(key, massFlow, dt, opts = {}) {
    const wanted = (massFlow * dt) / RESOURCES[key].density;
    if (wanted <= 0) return { consumed: 0, starved: false };
    const got = this.draw(key, wanted, opts);
    return {
      consumed: got * RESOURCES[key].density,
      starved: got < wanted * 0.999,
    };
  }

  /** 전기 소비 */
  drawElectric(amount) {
    const got = this.draw('ec', amount);
    return { drawn: got, brownout: got < amount * 0.999 };
  }

  /** 전기 충전 */
  chargeElectric(amount) {
    return this.fill('ec', amount);
  }

  /** 모든 자원 요약 (HUD 용) */
  summary() {
    const out = [];
    for (const key in RESOURCES) {
      const cap = this.capacity(key);
      if (cap <= 0) continue;
      out.push({
        id: key,
        name: RESOURCES[key].name,
        short: RESOURCES[key].short,
        color: RESOURCES[key].color,
        amount: this.total(key),
        capacity: cap,
        fraction: this.fraction(key),
      });
    }
    return out;
  }

  /** 자원 질량 총합 */
  totalMass() {
    let m = 0;
    for (const part of this.parts) {
      if (part.destroyed) continue;
      for (const key in part.resources) {
        const r = RESOURCES[key];
        if (r) m += part.resources[key] * r.density;
      }
    }
    return m;
  }

  /**
   * 특정 연료 그룹이 쓸 수 있는 추진제 질량.
   * 엔진이 실제로 뽑아 쓸 수 있는 양과 정확히 일치한다.
   */
  groupPropellantMass(group, propellant) {
    const sumOf = (key) => {
      let n = 0;
      for (const p of this.byResource.get(key) ?? []) {
        if (p.destroyed || p.fuelGroup !== group) continue;
        n += p.resources[key] ?? 0;
      }
      return n;
    };
    if (propellant === 'lfox') {
      const units = Math.min(
        sumOf('lf') / LF_OX_RATIO.lf,
        sumOf('ox') / LF_OX_RATIO.ox
      );
      return (
        units *
        (LF_OX_RATIO.lf * RESOURCES.lf.density +
          LF_OX_RATIO.ox * RESOURCES.ox.density)
      );
    }
    if (!RESOURCES[propellant]) return 0;
    return sumOf(propellant) * RESOURCES[propellant].density;
  }

  /** 특정 스테이지가 쓸 수 있는 추진제 질량 */
  stagePropellantMass(stage, propellant) {
    let mass = 0;
    const consider = (key, weight = 1) => {
      const list = this.byResource.get(key) ?? [];
      for (const p of list) {
        if (p.destroyed || p.stage < stage) continue;
        mass += (p.resources[key] ?? 0) * RESOURCES[key].density * weight;
      }
    };
    if (propellant === 'lfox') {
      // 혼합비 제한을 고려해 짝이 맞는 만큼만
      let lf = 0;
      let ox = 0;
      for (const p of this.byResource.get('lf') ?? []) {
        if (p.destroyed || p.stage < stage) continue;
        lf += p.resources.lf ?? 0;
      }
      for (const p of this.byResource.get('ox') ?? []) {
        if (p.destroyed || p.stage < stage) continue;
        ox += p.resources.ox ?? 0;
      }
      const units = Math.min(lf / LF_OX_RATIO.lf, ox / LF_OX_RATIO.ox);
      mass =
        units *
        (LF_OX_RATIO.lf * RESOURCES.lf.density +
          LF_OX_RATIO.ox * RESOURCES.ox.density);
    } else {
      consider(propellant);
    }
    return mass;
  }
}

/**
 * 두 기체(도킹 상태) 사이 자원 이송.
 */
export function transferResource(fromNet, toNet, key, amount) {
  const taken = fromNet.draw(key, amount);
  const given = toNet.fill(key, taken);
  // 넣지 못한 만큼 되돌린다
  if (given < taken) fromNet.fill(key, taken - given);
  return given;
}

/**
 * 전력 수지 계산 — 생산과 소비를 모아 순 변화량을 낸다.
 * @returns {{production:number, consumption:number, net:number}}
 */
export function powerBudget(parts, sunFactor = 1) {
  let production = 0;
  let consumption = 0;
  for (const part of parts) {
    if (part.destroyed) continue;
    const def = part.def;
    if (def.solar) {
      if (def.solar.alwaysOn) production += def.solar.output;
      else if (part.deployed) production += def.solar.output * sunFactor;
    }
    if (def.ecPerSecond && part.active !== false) {
      consumption += def.ecPerSecond;
    }
  }
  return { production, consumption, net: production - consumption };
}

/**
 * 햇빛 세기 — 항성 방향과 천체 그림자를 고려한 0..1 계수.
 */
export function sunlightFactor(vesselAbsPos, starPos, occluder, occluderPos) {
  const dx = starPos.x - vesselAbsPos.x;
  const dy = starPos.y - vesselAbsPos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return 1;
  const sx = dx / dist;
  const sy = dy / dist;

  if (occluder && occluderPos) {
    const ox = occluderPos.x - vesselAbsPos.x;
    const oy = occluderPos.y - vesselAbsPos.y;
    const along = ox * sx + oy * sy;
    if (along > 0) {
      // 천체가 항성 쪽에 있다 — 수직 거리로 그림자 판정
      const perp = Math.abs(ox * -sy + oy * sx);
      if (perp < occluder.radius) {
        const penumbra = clamp01(
          (perp - occluder.radius * 0.85) / (occluder.radius * 0.15)
        );
        return penumbra;
      }
    }
  }
  return 1;
}

/**
 * ISRU 변환 처리.
 */
export function runConverter(part, net, dt) {
  const conv = part.def.converter;
  if (!conv || !part.active) return null;
  const ecNeed = conv.ecPerSecond * dt;
  const { drawn } = net.drawElectric(ecNeed);
  const efficiency = ecNeed > 0 ? drawn / ecNeed : 0;
  if (efficiency < 0.05) return { ore: 0, lf: 0, ox: 0, efficiency };

  const oreWant = conv.oreRate * dt * efficiency;
  const ore = net.draw('ore', oreWant);
  const scale = oreWant > 0 ? ore / oreWant : 0;
  const lf = net.fill('lf', conv.lfRate * dt * efficiency * scale);
  const ox = net.fill('ox', conv.oxRate * dt * efficiency * scale);
  return { ore, lf, ox, efficiency };
}

/**
 * 채굴 드릴 처리.
 */
export function runDrill(part, net, dt, oreAbundance = 1) {
  const drill = part.def.drill;
  if (!drill || !part.active) return 0;
  const ecNeed = drill.ecPerSecond * dt;
  const { drawn } = net.drawElectric(ecNeed);
  const efficiency = ecNeed > 0 ? drawn / ecNeed : 0;
  const amount = drill.rate * dt * efficiency * oreAbundance;
  return net.fill('ore', amount);
}
