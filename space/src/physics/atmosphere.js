// ORBITER — 대기 모델
// 지수 대기(등온 근사)를 층별로 이어 붙인 모델.
// 압력·밀도·온도·음속·동압을 제공하고, 공력 가열과 낙하산 안전 조건을 판단한다.

import { clamp, lerp, smoothstep } from '../core/math.js';
import { RHO_SEA_LEVEL, R_GAS, M_AIR } from './constants.js';

/**
 * 대기 프로파일. 천체 정의(body.atmo)를 감싸 계산을 캐싱한다.
 */
export class Atmosphere {
  /**
   * @param {object} def
   * @param {number} def.height       대기 상단 고도 (m)
   * @param {number} def.seaPressure  해면 기압 (atm, 1 = 지구)
   * @param {number} def.scaleHeight  척도고도 (m)
   * @param {number} def.seaTemp      해면 온도 (K)
   * @param {number} def.lapseRate    대류권 기온감률 (K/m)
   * @param {boolean} def.hasOxygen   제트엔진 사용 가능 여부
   * @param {number} def.molarMass    평균 몰질량 (kg/mol)
   */
  constructor(def = {}) {
    this.height = def.height ?? 0;
    this.seaPressure = def.seaPressure ?? 0;
    this.scaleHeight = def.scaleHeight ?? 7500;
    this.seaTemp = def.seaTemp ?? 288;
    this.lapseRate = def.lapseRate ?? 0.0065;
    this.tropopause = def.tropopause ?? this.height * 0.15;
    this.minTemp = def.minTemp ?? 180;
    this.hasOxygen = def.hasOxygen ?? false;
    this.molarMass = def.molarMass ?? M_AIR;
    this.gamma = def.gamma ?? 1.4;
    this.color = def.color ?? '#5aa9e6';
    this.hazeColor = def.hazeColor ?? '#9ccdf0';

    // 해면 밀도 (기압 1atm 기준 스케일)
    this.seaDensity = RHO_SEA_LEVEL * this.seaPressure;
    this.exists = this.height > 0 && this.seaPressure > 0;
  }

  /** 고도 h(m)에서의 온도 (K) */
  temperatureAt(h) {
    if (!this.exists) return 4;
    if (h <= 0) return this.seaTemp;
    if (h >= this.height) return this.minTemp * 0.6;
    if (h < this.tropopause) {
      return Math.max(this.minTemp, this.seaTemp - this.lapseRate * h);
    }
    // 성층권: 완만한 상승 후 열권 급상승
    const t = (h - this.tropopause) / Math.max(1, this.height - this.tropopause);
    const base = Math.max(this.minTemp, this.seaTemp - this.lapseRate * this.tropopause);
    return lerp(base, base * 1.25, smoothstep(t));
  }

  /** 고도 h 에서의 기압 (atm 단위) */
  pressureAt(h) {
    if (!this.exists || h >= this.height) return 0;
    if (h <= 0) return this.seaPressure;
    // 상단에서 0 으로 부드럽게 수렴하도록 보정항을 곱한다
    const p = this.seaPressure * Math.exp(-h / this.scaleHeight);
    const fade = smoothstep(clamp(1 - (h / this.height - 0.85) / 0.15, 0, 1));
    return p * fade;
  }

  /** 고도 h 에서의 밀도 (kg/m³) */
  densityAt(h) {
    if (!this.exists || h >= this.height) return 0;
    if (h <= 0) return this.seaDensity;
    const p = this.pressureAt(h);
    if (p <= 0) return 0;
    const T = this.temperatureAt(h);
    // ρ = pM/(RT), p 를 Pa 로 환산 (1 atm = 101325 Pa)
    return (p * 101325 * this.molarMass) / (R_GAS * Math.max(T, 1));
  }

  /** 고도 h 에서의 음속 (m/s) */
  speedOfSoundAt(h) {
    if (!this.exists) return 1;
    const T = this.temperatureAt(h);
    return Math.sqrt((this.gamma * R_GAS * Math.max(T, 1)) / this.molarMass);
  }

  /** 마하수 */
  machAt(h, speed) {
    const a = this.speedOfSoundAt(h);
    return a > 1e-6 ? speed / a : 0;
  }

  /** 동압 q = ½ρv² (Pa) */
  dynamicPressure(h, speed) {
    return 0.5 * this.densityAt(h) * speed * speed;
  }

  /** 대기권 내부인가 */
  contains(h) {
    return this.exists && h < this.height;
  }

  /** 대기 밀도 비율 (0..1) — 시각 효과용 */
  densityFraction(h) {
    if (!this.exists) return 0;
    return clamp(this.densityAt(h) / Math.max(this.seaDensity, 1e-9), 0, 1);
  }

  /**
   * 재진입 가열률 근사 (Sutton-Graves 유사식, W/m²).
   * q̇ = k·√(ρ/Rn)·v³
   */
  heatFluxAt(h, speed, noseRadius = 1.0) {
    const rho = this.densityAt(h);
    if (rho <= 0 || speed <= 0) return 0;
    const k = 1.7415e-4;
    return k * Math.sqrt(rho / Math.max(noseRadius, 0.05)) * Math.pow(speed, 3);
  }

  /** 정체점 온도 근사 (K) */
  stagnationTemperature(h, speed) {
    const T = this.temperatureAt(h);
    const M = this.machAt(h, speed);
    return T * (1 + ((this.gamma - 1) / 2) * M * M);
  }

  /** 낙하산을 안전하게 펼 수 있는가 */
  canDeployChute(h, speed, maxQ = 30000) {
    if (!this.exists) return false;
    if (h > this.height * 0.6) return false;
    return this.dynamicPressure(h, speed) < maxQ;
  }

  /** 낙하산 완전 전개 고도 판정 */
  chuteFullDeployAltitude() {
    return Math.min(this.height * 0.08, 1500);
  }

  /** 대기권 상단까지 남은 고도 */
  remaining(h) {
    return Math.max(0, this.height - h);
  }

  /** 하늘 색 보간용 계수 (0=우주, 1=지표) */
  skyFactor(h) {
    if (!this.exists) return 0;
    return clamp(1 - h / (this.height * 0.55), 0, 1);
  }

  toJSON() {
    return {
      height: this.height,
      seaPressure: this.seaPressure,
      scaleHeight: this.scaleHeight,
      seaTemp: this.seaTemp,
      lapseRate: this.lapseRate,
      hasOxygen: this.hasOxygen,
    };
  }
}

/** 대기 없음 (진공 천체) */
export const VACUUM = new Atmosphere({ height: 0, seaPressure: 0 });

/**
 * 바람 모델 — 고도별 제트기류와 돌풍.
 * 발사 초기 궤도 흐트러짐과 착륙 난이도를 만든다.
 */
export class WindModel {
  constructor(opts = {}) {
    this.enabled = opts.enabled ?? true;
    this.baseSpeed = opts.baseSpeed ?? 4;
    this.jetAltitude = opts.jetAltitude ?? 11000;
    this.jetSpeed = opts.jetSpeed ?? 35;
    this.gustAmplitude = opts.gustAmplitude ?? 6;
    this.seed = opts.seed ?? 1234;
    this.time = 0;
    this.phase = [
      Math.random() * 100,
      Math.random() * 100,
      Math.random() * 100,
    ];
  }

  update(dt) {
    this.time += dt;
  }

  /**
   * 고도 h 에서의 수평 바람 속도 (m/s, +x 방향).
   */
  speedAt(h) {
    if (!this.enabled) return 0;
    const jet =
      this.jetSpeed *
      Math.exp(-Math.pow((h - this.jetAltitude) / (this.jetAltitude * 0.45), 2));
    const gust =
      this.gustAmplitude *
      (Math.sin(this.time * 0.31 + this.phase[0]) * 0.5 +
        Math.sin(this.time * 0.77 + this.phase[1]) * 0.3 +
        Math.sin(this.time * 1.93 + this.phase[2]) * 0.2);
    const ground = this.baseSpeed * clamp(1 - h / 3000, 0, 1);
    const fade = clamp(1 - h / 45000, 0, 1);
    return (ground + jet + gust * fade) * fade;
  }
}

/**
 * 표준 대기 프리셋 — 천체 정의에서 재사용한다.
 */
export const ATMO_PRESETS = {
  earthlike: {
    height: 70000,
    seaPressure: 1.0,
    scaleHeight: 7200,
    seaTemp: 288,
    lapseRate: 0.0065,
    hasOxygen: true,
    color: '#5aa9e6',
    hazeColor: '#a8d4f2',
  },
  thin: {
    height: 42000,
    seaPressure: 0.0063,
    scaleHeight: 11000,
    seaTemp: 210,
    lapseRate: 0.0025,
    hasOxygen: false,
    color: '#c98a63',
    hazeColor: '#e0b494',
  },
  thick: {
    height: 145000,
    seaPressure: 15.0,
    scaleHeight: 15900,
    seaTemp: 480,
    lapseRate: 0.008,
    hasOxygen: false,
    color: '#d8b45a',
    hazeColor: '#f0dca0',
  },
  toxic: {
    height: 90000,
    seaPressure: 5.0,
    scaleHeight: 9000,
    seaTemp: 350,
    lapseRate: 0.007,
    hasOxygen: false,
    color: '#7fb56a',
    hazeColor: '#b8dc9e',
  },
  gasgiant: {
    height: 600000,
    seaPressure: 45.0,
    scaleHeight: 27000,
    seaTemp: 165,
    lapseRate: 0.002,
    hasOxygen: false,
    color: '#c8a678',
    hazeColor: '#e8d0aa',
  },
  methane: {
    height: 55000,
    seaPressure: 1.45,
    scaleHeight: 21000,
    seaTemp: 94,
    lapseRate: 0.001,
    hasOxygen: false,
    color: '#d6a544',
    hazeColor: '#f2d78c',
  },
};
