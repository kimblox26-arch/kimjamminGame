// ORBITER — 항성계 런타임
// 천체 정의를 실제 객체로 만들고, 계층(SOI) 트리·위치 전파·좌표 변환을 담당한다.

import {
  TAU,
  Vec2,
  wrapTau,
  clamp,
  vLen,
} from '../core/math.js';
import { Orbit, soiRadius, synchronousRadius } from '../physics/orbit.js';
import { Atmosphere, VACUUM } from '../physics/atmosphere.js';
import { G } from '../physics/constants.js';
import { BODY_DEFS, BODY_BY_ID, STAR_ID, HOME_BODY_ID } from './bodies.js';
import { TerrainGenerator } from './terrain.js';

/**
 * 런타임 천체.
 */
export class CelestialBody {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.type = def.type;
    this.radius = def.radius;
    this.mu = def.mu;
    this.mass = def.mu / G;
    this.rotPeriod = def.rotPeriod;
    this.rotationRate = TAU / def.rotPeriod; // rad/s (음수면 역자전)
    this.initialRotation = def.initialRotation ?? 0;
    this.palette = def.palette;
    this.biomes = def.biomes ?? ['표면'];
    this.science = def.science ?? 1;
    this.gasGiant = !!def.gasGiant;
    this.rings = def.rings ?? null;
    this.tidallyLocked = !!def.tidallyLocked;
    this.home = !!def.home;
    this.launchSites = def.launchSites ?? null;

    this.atmo = def.atmo ? new Atmosphere(def.atmo) : VACUUM;
    this.ocean = def.ocean ?? null;

    this.parent = null;
    this.children = [];
    this.orbit = null;
    this.soi = Infinity;
    this.depth = 0;

    this.terrain = new TerrainGenerator(this);

    this.surfaceGravity = this.mu / (this.radius * this.radius);
    this.escapeSpeed = Math.sqrt((2 * this.mu) / this.radius);
    this.synchronousRadius = synchronousRadius(this.mu, Math.abs(this.rotPeriod));

    // 위치 캐시
    this._posCache = { t: NaN, pos: new Vec2(), vel: new Vec2() };
    this._absCache = { t: NaN, pos: new Vec2() };
  }

  /** 자전각 (시각 t) */
  rotationAt(t) {
    return wrapTau(this.initialRotation + this.rotationRate * t);
  }

  /** 지표면 접선 속도 (자전에 의한) */
  surfaceSpeedAt(altitude = 0) {
    return Math.abs(this.rotationRate) * (this.radius + altitude);
  }

  /** 부모 기준 상태 */
  stateAt(t) {
    if (!this.orbit) return { pos: new Vec2(0, 0), vel: new Vec2(0, 0) };
    if (this._posCache.t === t) {
      return {
        pos: this._posCache.pos.clone(),
        vel: this._posCache.vel.clone(),
      };
    }
    const s = this.orbit.stateAt(t);
    this._posCache.t = t;
    this._posCache.pos.copy(s.pos);
    this._posCache.vel.copy(s.vel);
    return s;
  }

  /** 항성 기준 절대 위치 */
  absolutePositionAt(t) {
    if (this._absCache.t === t) return this._absCache.pos.clone();
    let p = new Vec2(0, 0);
    let node = this;
    while (node.parent) {
      const s = node.stateAt(t);
      p.x += s.pos.x;
      p.y += s.pos.y;
      node = node.parent;
    }
    this._absCache.t = t;
    this._absCache.pos.copy(p);
    return p;
  }

  /** 항성 기준 절대 속도 */
  absoluteVelocityAt(t) {
    const v = new Vec2(0, 0);
    let node = this;
    while (node.parent) {
      const s = node.stateAt(t);
      v.x += s.vel.x;
      v.y += s.vel.y;
      node = node.parent;
    }
    return v;
  }

  /** 대기 상단 반지름 */
  get atmosphereRadius() {
    return this.radius + this.atmo.height;
  }

  /** 지형 최고점 고도 (한 번만 계산해 캐시) */
  get maxTerrainElevation() {
    if (this._maxElev === undefined) {
      this._maxElev = this.terrain.extremes(1024).maxH;
      if (!Number.isFinite(this._maxElev)) this._maxElev = 0;
    }
    return this._maxElev;
  }

  /** 어느 각도에서도 지형에 닿지 않는 최소 안전 궤도 반지름 */
  safeOrbitRadius(margin = 2000) {
    return this.radius + Math.max(this.maxTerrainElevation + margin, margin);
  }

  /** 고도 → 반지름 */
  radiusAtAltitude(alt) {
    return this.radius + alt;
  }

  /** 위치 벡터 → 고도 (지형 고려하지 않음) */
  altitudeOf(pos) {
    return vLen(pos) - this.radius;
  }

  /** 위치 벡터 → 지형 표면 기준 고도 */
  terrainAltitudeOf(pos, t = 0) {
    const r = vLen(pos);
    const theta = Math.atan2(pos.y, pos.x);
    const surfaceR = this.terrain.radiusAt(theta - this.rotationAt(t));
    return r - surfaceR;
  }

  /** 중력 가속도 벡터 (천체 중심 기준 위치에서) */
  gravityAt(pos, out = new Vec2()) {
    const r2 = pos.x * pos.x + pos.y * pos.y;
    const r = Math.sqrt(r2);
    if (r < 1) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    const f = -this.mu / (r2 * r);
    out.x = pos.x * f;
    out.y = pos.y * f;
    return out;
  }

  /** 중력 가속도 크기 */
  gravityMagnitudeAt(r) {
    return this.mu / Math.max(r * r, 1);
  }

  /** 해당 위치가 SOI 안인가 */
  containsPoint(localPos) {
    return vLen(localPos) < this.soi;
  }

  /** 위도(2D에서는 각도) 표기 */
  angleToLabel(theta) {
    const deg = ((theta * 180) / Math.PI + 360) % 360;
    return `${deg.toFixed(1)}°`;
  }

  /** 각도로 바이옴 결정 */
  biomeAt(theta) {
    if (!this.biomes.length) return '표면';
    const n = this.biomes.length;
    const idx = Math.floor((wrapTau(theta) / TAU) * n) % n;
    return this.biomes[idx];
  }

  /** 표시용 요약 */
  describe() {
    return {
      name: this.name,
      gravity: `${this.surfaceGravity.toFixed(2)} m/s²`,
      escape: `${(this.escapeSpeed / 1000).toFixed(2)} km/s`,
      atmosphere: this.atmo.exists
        ? `${(this.atmo.height / 1000).toFixed(0)} km / ${this.atmo.seaPressure} atm`
        : '없음',
      day: `${(Math.abs(this.rotPeriod) / 3600).toFixed(1)} 시간`,
      soi: Number.isFinite(this.soi)
        ? `${(this.soi / 1000).toFixed(0)} km`
        : '무한',
    };
  }
}

/**
 * 항성계 전체.
 */
export class SolarSystem {
  constructor(defs = BODY_DEFS) {
    /** @type {Map<string, CelestialBody>} */
    this.bodies = new Map();
    /** @type {CelestialBody[]} */
    this.list = [];
    this.star = null;
    this.home = null;
    this.time = 0;

    for (const def of defs) {
      const body = new CelestialBody(def);
      this.bodies.set(body.id, body);
      this.list.push(body);
    }

    // 계층 연결
    for (const body of this.list) {
      const parentId = body.def.parent;
      if (parentId) {
        const parent = this.bodies.get(parentId);
        if (!parent) {
          console.warn(`[system] "${body.id}" 의 부모 "${parentId}" 를 찾을 수 없음`);
          continue;
        }
        body.parent = parent;
        parent.children.push(body);
        const o = body.def.orbit;
        body.orbit = new Orbit({
          mu: parent.mu,
          a: o.a,
          e: o.e ?? 0,
          argPe: o.argPe ?? 0,
          M0: o.M0 ?? 0,
          epoch: 0,
          dir: o.dir ?? 1,
        });
      } else {
        this.star = body;
      }
      if (body.home) this.home = body;
    }

    // 깊이 및 SOI 계산
    for (const body of this.list) {
      let d = 0;
      let n = body;
      while (n.parent) {
        d++;
        n = n.parent;
      }
      body.depth = d;
    }

    for (const body of this.list) {
      if (!body.parent) {
        body.soi = Infinity;
      } else {
        body.soi = soiRadius(body.orbit.a, body.mass, body.parent.mass);
        // 위성끼리 SOI 가 겹치지 않도록 안전 상한
        body.soi = Math.min(body.soi, body.orbit.a * 0.9);
        body.soi = Math.max(body.soi, body.radius * 1.5);
      }
    }

    this.star = this.star || this.bodies.get(STAR_ID);
    this.home = this.home || this.bodies.get(HOME_BODY_ID);
  }

  get(id) {
    return this.bodies.get(id) ?? null;
  }

  /** 시각 설정 — 캐시 무효화 */
  setTime(t) {
    this.time = t;
  }

  advance(dt) {
    this.time += dt;
  }

  /** 천체 A 기준에서 본 천체 B 의 상대 위치 */
  relativePosition(from, to, t) {
    const a = from.absolutePositionAt(t);
    const b = to.absolutePositionAt(t);
    return new Vec2(b.x - a.x, b.y - a.y);
  }

  /** 천체 A 기준에서 본 천체 B 의 상대 속도 */
  relativeVelocity(from, to, t) {
    const a = from.absoluteVelocityAt(t);
    const b = to.absoluteVelocityAt(t);
    return new Vec2(b.x - a.x, b.y - a.y);
  }

  /**
   * 로컬 좌표(body 기준) → 절대 좌표(항성 기준)
   */
  toAbsolute(body, localPos, t) {
    const base = body.absolutePositionAt(t);
    return new Vec2(base.x + localPos.x, base.y + localPos.y);
  }

  /**
   * 절대 좌표 → 특정 천체 기준 로컬 좌표
   */
  toLocal(body, absPos, t) {
    const base = body.absolutePositionAt(t);
    return new Vec2(absPos.x - base.x, absPos.y - base.y);
  }

  /**
   * 좌표계 변환: fromBody 기준 상태 → toBody 기준 상태
   */
  transferFrame(fromBody, toBody, pos, vel, t) {
    const fromP = fromBody.absolutePositionAt(t);
    const fromV = fromBody.absoluteVelocityAt(t);
    const toP = toBody.absolutePositionAt(t);
    const toV = toBody.absoluteVelocityAt(t);
    return {
      pos: new Vec2(fromP.x + pos.x - toP.x, fromP.y + pos.y - toP.y),
      vel: new Vec2(fromV.x + vel.x - toV.x, fromV.y + vel.y - toV.y),
    };
  }

  /**
   * 주어진 천체 기준 위치에서, 실제로 지배적인 SOI 천체를 찾는다.
   * 자식 SOI 진입 → 자식 반환, 부모 SOI 이탈 → 부모 반환.
   * @returns {CelestialBody|null} 바뀌었으면 새 천체, 아니면 null
   */
  checkSOITransition(currentBody, localPos, t) {
    // 자식 SOI 진입 검사
    for (const child of currentBody.children) {
      const cp = child.stateAt(t).pos;
      const dx = localPos.x - cp.x;
      const dy = localPos.y - cp.y;
      if (dx * dx + dy * dy < child.soi * child.soi) {
        return child;
      }
    }
    // 부모 SOI 이탈 검사
    if (currentBody.parent && Number.isFinite(currentBody.soi)) {
      const r2 = localPos.x * localPos.x + localPos.y * localPos.y;
      if (r2 > currentBody.soi * currentBody.soi) {
        return currentBody.parent;
      }
    }
    return null;
  }

  /**
   * 절대 위치에서 가장 지배적인 천체를 찾는다 (초기 배치용).
   */
  dominantBodyAt(absPos, t) {
    let best = this.star;
    let bestDepth = -1;
    for (const body of this.list) {
      if (!body.parent) continue;
      const bp = body.absolutePositionAt(t);
      const dx = absPos.x - bp.x;
      const dy = absPos.y - bp.y;
      if (dx * dx + dy * dy < body.soi * body.soi && body.depth > bestDepth) {
        best = body;
        bestDepth = body.depth;
      }
    }
    return best;
  }

  /** 계층 트리를 배열로 (깊이 우선) */
  hierarchy() {
    const out = [];
    const walk = (b, depth) => {
      out.push({ body: b, depth });
      const kids = [...b.children].sort(
        (x, y) => (x.orbit?.a ?? 0) - (y.orbit?.a ?? 0)
      );
      for (const c of kids) walk(c, depth + 1);
    };
    if (this.star) walk(this.star, 0);
    return out;
  }

  /** 두 천체 사이의 공통 조상 */
  commonAncestor(a, b) {
    const chain = new Set();
    let n = a;
    while (n) {
      chain.add(n.id);
      n = n.parent;
    }
    n = b;
    while (n) {
      if (chain.has(n.id)) return n;
      n = n.parent;
    }
    return this.star;
  }

  /** a 에서 b 까지의 경로 (SOI 이동 순서) */
  pathBetween(a, b) {
    const anc = this.commonAncestor(a, b);
    const up = [];
    let n = a;
    while (n && n !== anc) {
      up.push(n);
      n = n.parent;
    }
    const down = [];
    n = b;
    while (n && n !== anc) {
      down.push(n);
      n = n.parent;
    }
    down.reverse();
    return [...up, anc, ...down];
  }

  /** 모든 천체의 절대 위치를 한 번에 계산 (렌더 캐시용) */
  snapshot(t) {
    const out = new Map();
    for (const body of this.list) {
      out.set(body.id, {
        pos: body.absolutePositionAt(t),
        rotation: body.rotationAt(t),
        soi: body.soi,
      });
    }
    return out;
  }

  /**
   * 특정 천체 기준으로 화면에 그릴 가치가 있는 천체 목록.
   * 거리/크기 기준으로 컬링한다.
   */
  visibleFrom(body, t, maxDistance) {
    const origin = body.absolutePositionAt(t);
    const out = [];
    for (const other of this.list) {
      if (other === body) continue;
      const p = other.absolutePositionAt(t);
      const d = Math.hypot(p.x - origin.x, p.y - origin.y);
      if (d < maxDistance || other.type === 'star') {
        out.push({ body: other, distance: d, pos: p });
      }
    }
    out.sort((a, b2) => b2.distance - a.distance);
    return out;
  }

  /** 총 천체 수 */
  get count() {
    return this.list.length;
  }
}

/**
 * 발사대 정보 — 지표면 위 고정 위치.
 */
export class LaunchSite {
  constructor(body, def) {
    this.body = body;
    this.id = def.id;
    this.name = def.name;
    /** 천체 고정 좌표계에서의 각도 (rad) */
    this.angle = def.latitude ?? 0;
    this.altitude = def.altitude ?? 0;
    this.pads = def.pads ?? ['패드 A'];
  }

  /**
   * 시각 t 에서의 관성 좌표 위치.
   * 지형 생성기에 평탄화 구역이 등록되어 있으면 그 고도가 곧 발사대 높이다.
   */
  positionAt(t) {
    const theta = this.angle + this.body.rotationAt(t);
    const r = this.body.terrain.radiusAt(this.angle);
    return new Vec2(r * Math.cos(theta), r * Math.sin(theta));
  }

  /** 자전에 의한 관성 속도 */
  velocityAt(t) {
    const p = this.positionAt(t);
    const w = this.body.rotationRate;
    return new Vec2(-p.y * w, p.x * w);
  }

  /** 지표 법선 (위쪽 방향) */
  upAt(t) {
    const theta = this.angle + this.body.rotationAt(t);
    return new Vec2(Math.cos(theta), Math.sin(theta));
  }
}

/** 기본 항성계 인스턴스 생성 */
export function createSolarSystem() {
  return new SolarSystem(BODY_DEFS);
}

/** 천체의 발사장 목록 */
export function launchSitesOf(body) {
  if (!body.launchSites) return [];
  return body.launchSites.map((d) => new LaunchSite(body, d));
}

/**
 * 두 천체 사이 전이에 필요한 Δv 근사 (호만).
 * 공통 부모를 기준으로 계산한다.
 */
export function transferBudget(system, from, to, t = 0) {
  const anc = system.commonAncestor(from, to);
  if (anc === from || anc === to) {
    return { dv: 0, note: '같은 계층' };
  }
  let a = from;
  while (a.parent !== anc) a = a.parent;
  let b = to;
  while (b.parent !== anc) b = b.parent;
  const r1 = a.orbit.a;
  const r2 = b.orbit.a;
  const mu = anc.mu;
  const aT = (r1 + r2) / 2;
  const v1 = Math.sqrt(mu / r1);
  const vT1 = Math.sqrt(mu * (2 / r1 - 1 / aT));
  const v2 = Math.sqrt(mu / r2);
  const vT2 = Math.sqrt(mu * (2 / r2 - 1 / aT));
  return {
    dv: Math.abs(vT1 - v1) + Math.abs(v2 - vT2),
    departure: Math.abs(vT1 - v1),
    arrival: Math.abs(v2 - vT2),
    transferTime: Math.PI * Math.sqrt((aT * aT * aT) / mu),
    via: anc.name,
  };
}
