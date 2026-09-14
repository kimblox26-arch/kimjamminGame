// ORBITER — 치트 / 샌드박스 설정
//
// Spaceflight Simulator 의 치트 메뉴와 같은 역할.
// 물리 자체를 끄는 것이 아니라 "이 항이 있는가" 를 토글해서
// 실험(무한 연료로 궤도 설계, 무중력으로 도킹 연습)을 쉽게 만든다.

import { bus, EVT } from '../core/events.js';

export const CHEAT_DEFS = [
  {
    key: 'infiniteFuel',
    name: '무한 연료',
    desc: '탱크가 비지 않는다. 엔진 연소시간 제한이 사라진다.',
  },
  {
    key: 'infinitePower',
    name: '무한 전력',
    desc: '배터리가 방전되지 않는다.',
  },
  {
    key: 'noGravity',
    name: '무중력',
    desc: '중력을 끈다. 도킹·자세제어 연습용.',
  },
  {
    key: 'noDrag',
    name: '공기저항 없음',
    desc: '대기 항력과 가열을 끈다.',
  },
  {
    key: 'unbreakable',
    name: '파괴 불가',
    desc: '충돌·과열로 부품이 부서지지 않는다.',
  },
  {
    key: 'partClipping',
    name: '부품 겹치기 허용',
    desc: '설계실에서 부품이 서로 겹쳐도 배치할 수 있다.',
  },
  {
    key: 'unlockAllParts',
    name: '모든 부품 해금',
    desc: '연구 단계와 상관없이 모든 부품을 쓴다.',
  },
  {
    key: 'freeBuild',
    name: '무료 제작',
    desc: '발사 비용이 들지 않는다.',
  },
];

const DEFAULTS = Object.fromEntries(CHEAT_DEFS.map((c) => [c.key, false]));

export class Cheats {
  constructor(initial = {}) {
    // 알려진 키만 받는다 — 저장본에 섞인 everUsed 같은 값이 들어오면 안 된다
    this.state = { ...DEFAULTS };
    for (const k in DEFAULTS) {
      if (k in initial) this.state[k] = !!initial[k];
    }
    /** 치트를 한 번이라도 켰는가 — 업적/기록에 표시한다 */
    this.everUsed = Object.values(this.state).some(Boolean);
  }

  get(key) {
    return !!this.state[key];
  }

  set(key, value) {
    if (!(key in this.state)) return;
    this.state[key] = !!value;
    if (value) this.everUsed = true;
    bus.emit(EVT.CHEAT_CHANGED, { key, value: this.state[key], cheats: this });
  }

  toggle(key) {
    this.set(key, !this.state[key]);
    return this.state[key];
  }

  get any() {
    return Object.values(this.state).some(Boolean);
  }

  /** 켜져 있는 치트 이름 목록 */
  activeNames() {
    return CHEAT_DEFS.filter((c) => this.state[c.key]).map((c) => c.name);
  }

  reset() {
    for (const k in this.state) this.state[k] = false;
    bus.emit(EVT.CHEAT_CHANGED, { key: null, value: false, cheats: this });
  }

  toJSON() {
    return { ...this.state, everUsed: this.everUsed };
  }

  static fromJSON(o = {}) {
    const c = new Cheats(o);
    c.everUsed = !!o.everUsed || c.any;
    return c;
  }
}

/**
 * 비행 중 매 스텝 적용되는 치트 효과.
 * 물리 코드가 조건문으로 뒤덮이지 않도록 여기서 한 번에 처리한다.
 */
export function applyFlightCheats(vessel, cheats) {
  if (!vessel || !cheats?.any) return;

  if (cheats.get('infiniteFuel')) {
    for (const p of vessel.parts) {
      if (p.destroyed || !p.def.fuel) continue;
      for (const k in p.def.fuel) {
        if (k === 'ec') continue;
        if (p.disabledResources.has(k)) continue;
        p.resources[k] = (p.def.fuel[k] ?? 0) * (p.sizeFactor ?? 1);
      }
    }
  }

  if (cheats.get('infinitePower')) {
    for (const p of vessel.parts) {
      if (p.destroyed || !p.def.fuel?.ec) continue;
      p.resources.ec = p.def.fuel.ec * (p.sizeFactor ?? 1);
    }
  }

  if (cheats.get('unbreakable')) {
    for (const p of vessel.parts) {
      if (p.destroyed) continue;
      if (p.temperature > p.maxTemp * 0.92) p.temperature = p.maxTemp * 0.92;
      if (p.shield) p.shield.ablator = p.shield.maxAblator;
    }
    vessel.destroyed = false;
    vessel.destroyReason = null;
  }
}
