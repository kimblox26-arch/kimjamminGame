// ORBITER — 이벤트 버스
// 게임 전역에서 쓰이는 발행/구독 시스템. 씬 간 결합도를 낮춘다.

export class EventBus {
  constructor(name = 'bus') {
    this.name = name;
    this.listeners = new Map();
    this.onceListeners = new Map();
    this.queue = [];
    this.paused = false;
    this.debug = false;
    this.history = [];
    this.historyLimit = 200;
  }

  /** 구독. 해제 함수를 반환한다. */
  on(type, fn, context = null) {
    if (typeof fn !== 'function') throw new TypeError('handler must be function');
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    const entry = { fn, context, priority: 0 };
    this.listeners.get(type).push(entry);
    return () => this.off(type, fn);
  }

  /** 우선순위 구독 — 높은 값이 먼저 호출된다. */
  onPriority(type, fn, priority = 0, context = null) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    const list = this.listeners.get(type);
    list.push({ fn, context, priority });
    list.sort((a, b) => b.priority - a.priority);
    return () => this.off(type, fn);
  }

  /** 한 번만 실행되는 구독 */
  once(type, fn, context = null) {
    if (!this.onceListeners.has(type)) this.onceListeners.set(type, []);
    this.onceListeners.get(type).push({ fn, context });
    return () => {
      const list = this.onceListeners.get(type);
      if (!list) return;
      const i = list.findIndex((e) => e.fn === fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /** Promise 로 이벤트 대기 */
  waitFor(type, timeoutMs = 0) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const off = this.once(type, (payload) => {
        if (timer) clearTimeout(timer);
        resolve(payload);
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          off();
          reject(new Error(`event timeout: ${type}`));
        }, timeoutMs);
      }
    });
  }

  off(type, fn) {
    const list = this.listeners.get(type);
    if (list) {
      const i = list.findIndex((e) => e.fn === fn);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) this.listeners.delete(type);
    }
    const olist = this.onceListeners.get(type);
    if (olist) {
      const i = olist.findIndex((e) => e.fn === fn);
      if (i >= 0) olist.splice(i, 1);
      if (!olist.length) this.onceListeners.delete(type);
    }
  }

  offAll(type) {
    if (type) {
      this.listeners.delete(type);
      this.onceListeners.delete(type);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  /** 즉시 발행 */
  emit(type, payload) {
    if (this.debug) this.record(type, payload);
    if (this.paused) {
      this.queue.push({ type, payload });
      return;
    }
    this.dispatch(type, payload);
  }

  /** 다음 flush 까지 지연 발행 */
  emitLater(type, payload) {
    this.queue.push({ type, payload });
  }

  dispatch(type, payload) {
    const list = this.listeners.get(type);
    if (list) {
      // 콜백 중 구독 해제가 일어날 수 있어 복사본 순회
      const copy = list.slice();
      for (const e of copy) {
        try {
          e.fn.call(e.context, payload, type);
        } catch (err) {
          console.error(`[${this.name}] listener error on "${type}"`, err);
        }
      }
    }
    const olist = this.onceListeners.get(type);
    if (olist && olist.length) {
      this.onceListeners.delete(type);
      for (const e of olist) {
        try {
          e.fn.call(e.context, payload, type);
        } catch (err) {
          console.error(`[${this.name}] once listener error on "${type}"`, err);
        }
      }
    }
    // 와일드카드 구독자
    const wild = this.listeners.get('*');
    if (wild) {
      for (const e of wild.slice()) {
        try {
          e.fn.call(e.context, payload, type);
        } catch (err) {
          console.error(`[${this.name}] wildcard listener error`, err);
        }
      }
    }
  }

  /** 큐에 쌓인 이벤트 일괄 발행 */
  flush() {
    if (!this.queue.length) return 0;
    const pending = this.queue;
    this.queue = [];
    for (const { type, payload } of pending) this.dispatch(type, payload);
    return pending.length;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.flush();
  }

  record(type, payload) {
    this.history.push({ type, payload, t: performance.now() });
    if (this.history.length > this.historyLimit) this.history.shift();
  }

  countListeners(type) {
    return (
      (this.listeners.get(type)?.length ?? 0) +
      (this.onceListeners.get(type)?.length ?? 0)
    );
  }
}

/** 게임 전역 버스 */
export const bus = new EventBus('orbiter');

/** 자주 쓰는 이벤트 이름 상수 — 오타 방지 */
export const EVT = {
  // 씬 전환
  SCENE_CHANGE: 'scene:change',
  SCENE_READY: 'scene:ready',

  // 비행
  LAUNCH: 'flight:launch',
  STAGE: 'flight:stage',
  STAGE_EMPTY: 'flight:stageEmpty',
  SOI_CHANGE: 'flight:soiChange',
  APOAPSIS: 'flight:apoapsis',
  PERIAPSIS: 'flight:periapsis',
  ORBIT_ACHIEVED: 'flight:orbitAchieved',
  LANDED: 'flight:landed',
  SPLASHDOWN: 'flight:splashdown',
  CRASH: 'flight:crash',
  DESTROYED: 'flight:destroyed',
  DOCKED: 'flight:docked',
  UNDOCKED: 'flight:undocked',
  PART_DETACHED: 'flight:partDetached',
  PART_DESTROYED: 'flight:partDestroyed',
  CHUTE_DEPLOY: 'flight:chuteDeploy',
  CHUTE_CUT: 'flight:chuteCut',
  ENGINE_IGNITE: 'flight:engineIgnite',
  ENGINE_FLAMEOUT: 'flight:engineFlameout',
  FUEL_LOW: 'flight:fuelLow',
  OVERHEAT: 'flight:overheat',
  REENTRY: 'flight:reentry',
  MAXQ: 'flight:maxQ',

  // 시간
  TIMEWARP_CHANGE: 'time:warpChange',
  TIMEWARP_BLOCKED: 'time:warpBlocked',

  // 제작
  BUILD_PLACE: 'build:place',
  BUILD_REMOVE: 'build:remove',
  BUILD_CHANGE: 'build:change',
  BUILD_SAVE: 'build:save',
  BUILD_LOAD: 'build:load',

  // 미션/진행
  MISSION_START: 'mission:start',
  MISSION_STEP: 'mission:step',
  MISSION_COMPLETE: 'mission:complete',
  MISSION_FAIL: 'mission:fail',
  ACHIEVEMENT: 'progress:achievement',
  FUNDS_CHANGE: 'progress:funds',
  UNLOCK: 'progress:unlock',

  // UI
  TOAST: 'ui:toast',

  // 치트 / 도킹 / 기체 전환
  CHEAT_CHANGED: 'cheat:changed',
  DOCKED: 'flight:docked',
  UNDOCKED: 'flight:undocked',
  VESSEL_SWITCH: 'flight:vesselSwitch',
  RESOURCE_TRANSFER: 'flight:transfer',
  ALERT: 'ui:alert',
  CONFIRM: 'ui:confirm',
  LOG: 'ui:log',
  SCREENSHAKE: 'ui:shake',

  // 오디오
  SFX: 'audio:sfx',
  MUSIC: 'audio:music',
};

/** 간단한 상태 머신 — 씬 전환/미션 단계에 사용 */
export class StateMachine {
  constructor(initial = null) {
    this.states = new Map();
    this.current = null;
    this.previous = null;
    this.timeInState = 0;
    this.pendingInitial = initial;
  }

  add(name, handlers = {}) {
    this.states.set(name, {
      name,
      enter: handlers.enter || null,
      update: handlers.update || null,
      exit: handlers.exit || null,
      draw: handlers.draw || null,
    });
    return this;
  }

  start() {
    if (this.pendingInitial) this.change(this.pendingInitial);
    return this;
  }

  has(name) {
    return this.states.has(name);
  }

  change(name, payload = null) {
    if (!this.states.has(name)) {
      console.warn(`[StateMachine] unknown state "${name}"`);
      return false;
    }
    if (this.current && this.current.name === name) return false;
    if (this.current?.exit) this.current.exit(name);
    this.previous = this.current;
    this.current = this.states.get(name);
    this.timeInState = 0;
    if (this.current.enter) this.current.enter(payload, this.previous?.name);
    return true;
  }

  back() {
    if (this.previous) this.change(this.previous.name);
  }

  update(dt) {
    this.timeInState += dt;
    if (this.current?.update) this.current.update(dt, this.timeInState);
  }

  draw(ctx, alpha) {
    if (this.current?.draw) this.current.draw(ctx, alpha);
  }

  get name() {
    return this.current?.name ?? null;
  }
}
