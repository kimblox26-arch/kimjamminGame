// ORBITER — 게임 루프
// 고정 시간 간격(fixed timestep) 물리 + 가변 렌더링.
// 타임워프 배속에 따라 한 프레임에 여러 물리 스텝을 밟는다.

import { clamp } from './math.js';

export class GameLoop {
  constructor(opts = {}) {
    /** 물리 한 스텝의 기준 시간(초) */
    this.fixedDt = opts.fixedDt ?? 1 / 120;
    /** 한 프레임에 허용하는 최대 물리 스텝 수 (스파이럴 방지) */
    this.maxSteps = opts.maxSteps ?? 8;
    /** 한 프레임 누적 시간 상한 */
    this.maxFrameTime = opts.maxFrameTime ?? 0.25;

    this.onFixedUpdate = opts.onFixedUpdate || (() => {});
    this.onUpdate = opts.onUpdate || (() => {});
    this.onRender = opts.onRender || (() => {});
    this.onStats = opts.onStats || null;

    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.rafId = 0;
    this.frame = 0;

    /** 게임 내 경과 시간(초) — 타임워프 반영 */
    this.gameTime = 0;
    /** 실시간 경과(초) */
    this.realTime = 0;
    /** 타임워프 배율 */
    this.timeScale = 1;
    /** 일시정지 여부 */
    this.paused = false;

    // 통계
    this.fps = 60;
    this.frameMs = 0;
    this.physicsMs = 0;
    this.renderMs = 0;
    this.stepsLastFrame = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._statTimer = 0;
    this.slowFrames = 0;

    this._tick = this._tick.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    document.addEventListener('visibilitychange', this._onVisibility);
    this.rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    document.removeEventListener('visibilitychange', this._onVisibility);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
    return this.paused;
  }

  setTimeScale(s) {
    this.timeScale = Math.max(0, s);
  }

  _onVisibility() {
    if (document.hidden) {
      this._wasPaused = this.paused;
      this.paused = true;
    } else {
      this.lastTime = performance.now();
      this.accumulator = 0;
      if (!this._wasPaused) this.paused = false;
    }
  }

  _tick(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._tick);

    const frameStart = now;
    let realDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!Number.isFinite(realDelta) || realDelta < 0) realDelta = 0;
    if (realDelta > this.maxFrameTime) {
      realDelta = this.maxFrameTime;
      this.slowFrames++;
    }
    this.realTime += realDelta;
    this.frame++;

    if (!this.paused) {
      const scaled = realDelta * this.timeScale;
      this.accumulator += scaled;

      // 배속이 매우 높으면 스텝 크기를 늘려 스텝 수를 제한한다.
      let dt = this.fixedDt;
      const wanted = this.accumulator / dt;
      if (wanted > this.maxSteps) {
        dt = this.accumulator / this.maxSteps;
      }

      const pStart = performance.now();
      let steps = 0;
      while (this.accumulator >= dt && steps < this.maxSteps) {
        this.onFixedUpdate(dt, this.gameTime);
        this.gameTime += dt;
        this.accumulator -= dt;
        steps++;
      }
      if (steps >= this.maxSteps) this.accumulator = 0;
      this.stepsLastFrame = steps;
      this.physicsMs = performance.now() - pStart;

      this.onUpdate(realDelta, scaled);
    } else {
      this.onUpdate(realDelta, 0);
    }

    const alpha = clamp(this.accumulator / this.fixedDt, 0, 1);
    const rStart = performance.now();
    this.onRender(alpha, realDelta);
    this.renderMs = performance.now() - rStart;

    this.frameMs = performance.now() - frameStart;
    this._fpsAccum += realDelta;
    this._fpsFrames++;
    this._statTimer += realDelta;
    if (this._statTimer >= 0.5) {
      this.fps = this._fpsFrames / Math.max(this._fpsAccum, 1e-6);
      this._fpsAccum = 0;
      this._fpsFrames = 0;
      this._statTimer = 0;
      if (this.onStats) {
        this.onStats({
          fps: this.fps,
          frameMs: this.frameMs,
          physicsMs: this.physicsMs,
          renderMs: this.renderMs,
          steps: this.stepsLastFrame,
        });
      }
    }
  }
}

/** 시간 누적 기반 반복 타이머 — 일정 주기마다 콜백 */
export class Ticker {
  constructor(interval, fn) {
    this.interval = interval;
    this.fn = fn;
    this.acc = 0;
    this.enabled = true;
  }

  update(dt) {
    if (!this.enabled) return;
    this.acc += dt;
    let guard = 0;
    while (this.acc >= this.interval && guard++ < 64) {
      this.acc -= this.interval;
      this.fn(this.interval);
    }
  }

  reset() {
    this.acc = 0;
  }
}

/** 일회성 지연 실행 모음 — 게임시간 기준 */
export class Scheduler {
  constructor() {
    this.tasks = [];
    this.time = 0;
    this.nextId = 1;
  }

  after(delay, fn, tag = null) {
    const id = this.nextId++;
    this.tasks.push({ id, at: this.time + delay, fn, tag, repeat: 0 });
    return id;
  }

  every(interval, fn, tag = null) {
    const id = this.nextId++;
    this.tasks.push({
      id,
      at: this.time + interval,
      fn,
      tag,
      repeat: interval,
    });
    return id;
  }

  cancel(id) {
    const i = this.tasks.findIndex((t) => t.id === id);
    if (i >= 0) this.tasks.splice(i, 1);
  }

  cancelTag(tag) {
    this.tasks = this.tasks.filter((t) => t.tag !== tag);
  }

  clear() {
    this.tasks.length = 0;
  }

  update(dt) {
    this.time += dt;
    if (!this.tasks.length) return;
    const due = [];
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const t = this.tasks[i];
      if (t.at <= this.time) {
        due.push(t);
        if (t.repeat > 0) t.at = this.time + t.repeat;
        else this.tasks.splice(i, 1);
      }
    }
    for (const t of due) {
      try {
        t.fn();
      } catch (e) {
        console.error('[Scheduler] task error', e);
      }
    }
  }
}

/** 프레임 시간을 관찰해 품질 레벨을 자동 조정 */
export class AdaptiveQuality {
  constructor(opts = {}) {
    this.target = opts.targetFps ?? 55;
    this.floor = opts.floorFps ?? 40;
    this.level = opts.initial ?? 2; // 0=최저 … 3=최고
    this.minLevel = 0;
    this.maxLevel = 3;
    this.cooldown = 0;
    this.samples = [];
    this.enabled = opts.enabled ?? true;
    this.onChange = opts.onChange || null;
  }

  update(dt, fps) {
    if (!this.enabled) return this.level;
    this.cooldown -= dt;
    this.samples.push(fps);
    if (this.samples.length > 60) this.samples.shift();
    if (this.cooldown > 0 || this.samples.length < 30) return this.level;

    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    let next = this.level;
    if (avg < this.floor && this.level > this.minLevel) next = this.level - 1;
    else if (avg > this.target + 8 && this.level < this.maxLevel)
      next = this.level + 1;

    if (next !== this.level) {
      this.level = next;
      this.cooldown = 4;
      this.samples.length = 0;
      if (this.onChange) this.onChange(this.level);
    }
    return this.level;
  }
}
