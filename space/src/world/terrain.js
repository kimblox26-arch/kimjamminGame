// ORBITER — 절차적 지형
// 2D 원형 천체의 표면을 각도(theta) 함수로 생성한다.
// r(θ) = R + 고도(θ). 여러 주파수의 노이즈를 합쳐 대륙·산맥·충돌구를 만든다.

import {
  TAU,
  clamp,
  clamp01,
  lerp,
  smoothstep,
  wrapTau,
  makeRng,
  fbm1,
  ridged1,
  mixHex,
} from '../core/math.js';

/**
 * 충돌구 정의 — 중심 각도, 각반경, 깊이, 테두리 높이
 */
class Crater {
  constructor(center, angularRadius, depth, rimHeight) {
    this.center = center;
    this.angularRadius = angularRadius;
    this.depth = depth;
    this.rimHeight = rimHeight;
  }

  /** 각도 theta 에서의 고도 기여분 */
  contribution(theta) {
    let d = Math.abs(wrapTau(theta - this.center + Math.PI) - Math.PI);
    if (d > this.angularRadius * 1.45) return 0;
    const t = d / this.angularRadius;
    if (t <= 0.82) {
      // 바닥 — 완만한 그릇 모양
      const bowl = 1 - Math.pow(t / 0.82, 2);
      return -this.depth * bowl;
    }
    if (t <= 1.15) {
      // 테두리
      const u = (t - 0.82) / 0.33;
      return this.rimHeight * Math.sin(u * Math.PI);
    }
    // 분출물 담요
    const u = (t - 1.15) / 0.3;
    return this.rimHeight * 0.25 * (1 - u) * Math.cos(u * 6);
  }
}

/**
 * 지형 생성기 — 천체 하나당 하나.
 */
export class TerrainGenerator {
  constructor(body) {
    this.body = body;
    const p = body.def.terrain ?? {};
    this.params = {
      amplitude: p.amplitude ?? 3000,
      roughness: p.roughness ?? 0.5,
      craters: p.craters ?? 0,
      craterScale: p.craterScale ?? 1,
      ridges: p.ridges ?? 0.4,
      continents: p.continents ?? 0,
      canyons: p.canyons ?? 0,
      volcanic: p.volcanic ?? 0,
      dunes: p.dunes ?? 0,
      cracks: p.cracks ?? 0,
      maria: p.maria ?? 0,
      polarCaps: p.polarCaps ?? 0,
      irregular: p.irregular ?? 0,
      smooth: p.smooth ?? 0,
      bands: p.bands ?? 0,
      seed: p.seed ?? 1234,
    };
    this.rng = makeRng(this.params.seed);
    this.craters = [];
    this.features = [];
    this._cache = new Map();
    // 격자 해상도. 두 격자점 사이는 선형 보간하므로 지형이 계단지지 않는다.
    this._cacheResolution = 262144;
    this.gasGiant = !!body.def.gasGiant;
    this.oceanLevel = body.def.ocean ? body.def.ocean.level ?? 0 : null;
    /** 발사장처럼 인위적으로 평탄화된 구역 */
    this.flatZones = [];

    if (!this.gasGiant) {
      this._generateCraters();
      this._generateFeatures();
    }
  }

  _generateCraters() {
    const density = this.params.craters;
    if (density <= 0) return;
    const count = Math.round(density * 46);
    for (let i = 0; i < count; i++) {
      const center = this.rng() * TAU;
      const sizeRoll = this.rng();
      // 작은 충돌구가 훨씬 많도록 멱법칙 분포
      const scale = Math.pow(sizeRoll, 2.4);
      const angularRadius =
        lerp(0.004, 0.16, scale) * this.params.craterScale;
      const depth = this.params.amplitude * lerp(0.06, 0.5, scale);
      const rim = depth * lerp(0.25, 0.55, this.rng());
      this.craters.push(new Crater(center, angularRadius, depth, rim));
    }
    // 큰 것부터 그려야 작은 게 위에 덮이므로 정렬
    this.craters.sort((a, b) => b.angularRadius - a.angularRadius);
  }

  _generateFeatures() {
    const p = this.params;
    // 화산
    if (p.volcanic > 0) {
      const n = Math.round(p.volcanic * 8);
      for (let i = 0; i < n; i++) {
        this.features.push({
          type: 'volcano',
          center: this.rng() * TAU,
          width: lerp(0.01, 0.05, this.rng()),
          height: p.amplitude * lerp(0.5, 1.5, this.rng()),
          active: this.rng() < 0.4,
        });
      }
    }
    // 대협곡
    if (p.canyons > 0) {
      const n = Math.round(p.canyons * 4);
      for (let i = 0; i < n; i++) {
        this.features.push({
          type: 'canyon',
          center: this.rng() * TAU,
          width: lerp(0.05, 0.22, this.rng()),
          depth: p.amplitude * lerp(0.5, 1.2, this.rng()),
        });
      }
    }
    // 얼음 균열
    if (p.cracks > 0) {
      const n = Math.round(p.cracks * 26);
      for (let i = 0; i < n; i++) {
        this.features.push({
          type: 'crack',
          center: this.rng() * TAU,
          width: lerp(0.002, 0.012, this.rng()),
          depth: p.amplitude * lerp(0.15, 0.45, this.rng()),
        });
      }
    }
    // 마리아(어두운 용암 평원)
    if (p.maria > 0) {
      const n = Math.round(p.maria * 5);
      for (let i = 0; i < n; i++) {
        this.features.push({
          type: 'mare',
          center: this.rng() * TAU,
          width: lerp(0.15, 0.42, this.rng()),
          depth: p.amplitude * 0.18,
        });
      }
    }
  }

  /** 기본 고도 노이즈 (m) */
  baseElevation(theta) {
    const p = this.params;
    const t = wrapTau(theta);
    const x = (t / TAU) * 24;

    let h = 0;

    // 대륙 규모 기복
    if (p.continents > 0) {
      const c = fbm1(x * 0.35, 3, 2, 0.5, p.seed) * 2 - 1;
      h += c * p.amplitude * p.continents * 1.4;
    }

    // 일반 기복
    h += (fbm1(x, 5, 2.1, 0.5, p.seed + 7) * 2 - 1) * p.amplitude * 0.55;

    // 산맥(능선 노이즈)
    if (p.ridges > 0) {
      const r = ridged1(x * 1.6, 4, p.seed + 19);
      h += r * p.amplitude * p.ridges;
    }

    // 잔주름
    h +=
      (fbm1(x * 9, 3, 2, 0.5, p.seed + 33) * 2 - 1) *
      p.amplitude *
      0.18 *
      p.roughness;

    // 모래 언덕
    if (p.dunes > 0) {
      h += Math.sin(x * 55 + p.seed) * p.amplitude * 0.03 * p.dunes;
    }

    // 불규칙 소천체 (감자 모양)
    if (p.irregular > 0) {
      h +=
        (Math.sin(t * 2 + 1.1) * 0.6 + Math.sin(t * 3 + 0.4) * 0.35) *
        this.body.radius *
        0.14 *
        p.irregular;
    }

    // 극지 평탄화 / 전체 평탄화
    if (p.smooth > 0) h *= 1 - p.smooth * 0.7;

    return h;
  }

  /** 지형 특징 기여분 */
  featureElevation(theta) {
    let h = 0;
    for (const f of this.features) {
      let d = Math.abs(wrapTau(theta - f.center + Math.PI) - Math.PI);
      if (d > f.width * 2) continue;
      const t = clamp01(d / f.width);
      switch (f.type) {
        case 'volcano': {
          const cone = Math.exp(-t * t * 5);
          const caldera = t < 0.16 ? -f.height * 0.28 * (1 - t / 0.16) : 0;
          h += f.height * cone + caldera;
          break;
        }
        case 'canyon': {
          const profile = Math.exp(-t * t * 3.2);
          h -= f.depth * profile;
          break;
        }
        case 'crack': {
          if (t < 1) h -= f.depth * (1 - t) * (1 - t);
          break;
        }
        case 'mare': {
          const profile = smoothstep(1 - t);
          h -= f.depth * profile;
          break;
        }
        default:
          break;
      }
    }
    return h;
  }

  /** 충돌구 기여분 */
  craterElevation(theta) {
    let h = 0;
    for (const c of this.craters) h += c.contribution(theta);
    return h;
  }

  /**
   * 각도 theta(천체 고정 좌표계) 에서의 지형 고도 (m, 기준 반지름 대비).
   */
  elevationAt(theta) {
    if (this.gasGiant) return 0;
    const t = wrapTau(theta);
    const u = (t / TAU) * this._cacheResolution;
    const i0 = Math.floor(u);
    const f = u - i0;
    const a = this._gridSample(i0);
    const b = this._gridSample(i0 + 1);
    // 선형 보간 — 격자 해상도 때문에 지형이 블록처럼 계단지는 것을 막는다
    return a + (b - a) * f;
  }

  /** 격자점 하나의 고도 (캐시됨) */
  _gridSample(index) {
    const res = this._cacheResolution;
    const key = ((index % res) + res) % res;
    const cached = this._cache.get(key);
    if (cached !== undefined) return cached;

    const t = (key / res) * TAU;
    let h =
      this.baseElevation(t) + this.featureElevation(t) + this.craterElevation(t);

    // 바다가 있으면 해수면 아래는 완만하게
    if (this.oceanLevel !== null && h < this.oceanLevel) {
      h = this.oceanLevel - (this.oceanLevel - h) * 0.55;
    }

    // 평탄화 구역 — 중심은 지정 고도로, 바깥은 자연 지형으로 부드럽게 잇는다
    for (const zone of this.flatZones) {
      const d = Math.abs(wrapTau(t - zone.center + Math.PI) - Math.PI);
      if (d > zone.outer) continue;
      const blend =
        d <= zone.inner
          ? 1
          : 1 - smoothstep((d - zone.inner) / (zone.outer - zone.inner));
      h = lerp(h, zone.elevation, blend);
    }

    if (this._cache.size > 160000) this._cache.clear();
    this._cache.set(key, h);
    return h;
  }

  /**
   * 평탄화 구역 등록 — 발사장/착륙장처럼 지형을 고르게 만든다.
   * @param {number} center 천체 고정 좌표계 각도
   * @param {number} inner  완전 평탄한 반경(rad)
   * @param {number} outer  자연 지형으로 이어지는 반경(rad)
   * @param {number} elevation 목표 고도(m)
   */
  addFlatZone(center, inner, outer, elevation = 60) {
    this.flatZones.push({ center, inner, outer, elevation });
    this._cache.clear();
    return this;
  }

  /** 표면 반지름 */
  radiusAt(theta) {
    return this.body.radius + this.elevationAt(theta);
  }

  /** 지형 경사 (rad) — 착륙 안전 판정에 사용 */
  slopeAt(theta, span = 0.0008) {
    const r1 = this.radiusAt(theta - span);
    const r2 = this.radiusAt(theta + span);
    const arc = this.body.radius * span * 2;
    return Math.atan2(r2 - r1, arc);
  }

  /** 착륙 가능 여부 (경사 15도 이내) */
  isLandable(theta, maxSlopeDeg = 15) {
    return Math.abs(this.slopeAt(theta)) < (maxSlopeDeg * Math.PI) / 180;
  }

  /** 바다인가 */
  isOcean(theta) {
    if (this.oceanLevel === null) return false;
    return this.elevationAt(theta) < this.oceanLevel;
  }

  /** 해수면 반지름 */
  get oceanRadius() {
    return this.oceanLevel === null
      ? null
      : this.body.radius + this.oceanLevel;
  }

  /**
   * 표면 색상 — 고도·바다·극지에 따라 달라진다.
   */
  colorAt(theta) {
    const pal = this.body.palette;
    if (this.gasGiant) return pal.surface;
    const h = this.elevationAt(theta);
    const amp = Math.max(this.params.amplitude, 1);
    const n = clamp(h / amp, -1.5, 1.5);

    if (this.oceanLevel !== null && h < this.oceanLevel) {
      const depth = clamp01((this.oceanLevel - h) / (amp * 0.8));
      const ocean = this.body.def.ocean;
      return mixHex(ocean.color, ocean.deepColor ?? ocean.color, depth);
    }

    let color;
    if (n < -0.3) color = pal.deep;
    else if (n < 0.15) color = pal.surface;
    else if (n < 0.7) color = mixHex(pal.surface, pal.highlight, (n - 0.15) / 0.55);
    else color = pal.ice ?? pal.highlight;

    // 사막/암석 혼합
    if (pal.sand && n > -0.1 && n < 0.25) {
      const dry = clamp01(Math.sin(theta * 7.3 + this.params.seed) * 0.5 + 0.5);
      if (dry > 0.72) color = mixHex(color, pal.sand, (dry - 0.72) / 0.28);
    }
    if (pal.rock && n > 0.35) {
      color = mixHex(color, pal.rock, clamp01((n - 0.35) / 0.5) * 0.5);
    }
    return color;
  }

  /**
   * 표면 폴리라인 생성 — 렌더러가 사용할 점 목록.
   * @param {number} thetaStart 시작 각도
   * @param {number} thetaEnd   끝 각도
   * @param {number} segments   분할 수
   * @returns {{theta:number, r:number, color:string}[]}
   */
  profile(thetaStart, thetaEnd, segments = 256) {
    const out = [];
    const step = (thetaEnd - thetaStart) / segments;
    for (let i = 0; i <= segments; i++) {
      const th = thetaStart + step * i;
      out.push({
        theta: th,
        r: this.radiusAt(th),
        color: this.colorAt(th),
      });
    }
    return out;
  }

  /**
   * 지정 각도 주변에서 가장 평탄한 착륙 지점을 찾는다.
   */
  findFlatSpot(theta, searchSpan = 0.02, samples = 48) {
    let best = theta;
    let bestSlope = Infinity;
    for (let i = 0; i < samples; i++) {
      const th = theta + (i / (samples - 1) - 0.5) * searchSpan;
      if (this.isOcean(th)) continue;
      const s = Math.abs(this.slopeAt(th));
      if (s < bestSlope) {
        bestSlope = s;
        best = th;
      }
    }
    return { theta: best, slope: bestSlope, radius: this.radiusAt(best) };
  }

  /** 최고점 / 최저점 탐색 (도전 과제용) */
  extremes(samples = 2048) {
    let maxH = -Infinity;
    let minH = Infinity;
    let maxT = 0;
    let minT = 0;
    for (let i = 0; i < samples; i++) {
      const th = (i / samples) * TAU;
      const h = this.elevationAt(th);
      if (h > maxH) {
        maxH = h;
        maxT = th;
      }
      if (h < minH) {
        minH = h;
        minT = th;
      }
    }
    return { maxH, maxT, minH, minT };
  }

  /** 캐시 비우기 (메모리 회수) */
  clearCache() {
    this._cache.clear();
  }
}

/**
 * 지표면 위 구조물 배치 (발사대, 관제탑, 깃발 등).
 */
export class SurfaceProps {
  constructor(body) {
    this.body = body;
    this.props = [];
    this.flags = [];
  }

  /**
   * 발사장 구조물 생성.
   * 위치는 미터 단위 오프셋으로 지정하고 각도로 환산한다 —
   * 라디안으로 직접 적으면 천체 크기에 따라 수 km 씩 벌어진다.
   */
  addLaunchSite(site) {
    const base = site.angle;
    const A = (meters) => base + meters / this.body.radius;
    this.props.push(
      { type: 'pad', angle: A(0), width: 34, height: 5 },
      { type: 'tower', angle: A(-15), height: 48 },
      { type: 'tank', angle: A(58), height: 14 },
      { type: 'building', angle: A(46), height: 17, width: 24 },
      { type: 'building', angle: A(-52), height: 12, width: 19 },
      { type: 'dish', angle: A(-78), height: 15 }
    );
    return this;
  }

  /** 착륙 깃발 꽂기 */
  plantFlag(angle, label, missionTime) {
    this.flags.push({ angle, label, time: missionTime });
    return this.flags[this.flags.length - 1];
  }

  /** 표시 범위 안의 구조물 */
  visible(thetaMin, thetaMax) {
    return this.props.filter((p) => p.angle >= thetaMin && p.angle <= thetaMax);
  }

  toJSON() {
    return { flags: this.flags };
  }

  fromJSON(data) {
    if (data?.flags) this.flags = data.flags;
  }
}
