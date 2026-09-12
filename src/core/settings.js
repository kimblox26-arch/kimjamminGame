// FREE FREELY - 설정 저장/불러오기
import { clamp } from './utils.js';

const KEY = 'freefreely.settings.v1';

export const DEFAULTS = {
  // 그래픽
  quality: 'high',            // low | medium | high | ultra
  renderScale: 1.0,
  shadows: true,
  bloom: true,
  volumetricClouds: true,
  cloudDensity: 1.0,
  motionBlurAmount: 0.35,
  fov: 72,
  antialias: true,
  // 사운드
  masterVolume: 0.85,
  engineVolume: 0.9,
  windVolume: 0.8,
  effectVolume: 1.0,
  musicVolume: 0.5,
  // 조작
  invertPitch: false,
  mouseFlight: false,
  sensitivity: 1.0,
  assistLevel: 'normal',      // off | normal | high
  units: 'metric',            // metric | imperial
  onScreenControls: 'auto',   // auto | on | off — 화면 조이스틱/스로틀 표시
  // 월드
  timeOfDay: 8.5,             // 0..24
  dayLengthMinutes: 12,
  dayNightRunning: true,
  weather: 'clear',           // clear | cloudy | overcast | storm
  windStrength: 3.5,
  turbulence: 0.4,
  seaState: 0.5,
};

export const QUALITY_PRESETS = {
  low: { renderScale: 0.72, shadows: false, bloom: false, volumetricClouds: false, cloudDensity: 0.4, antialias: false },
  medium: { renderScale: 0.9, shadows: true, bloom: true, volumetricClouds: true, cloudDensity: 0.7, antialias: false },
  high: { renderScale: 1.0, shadows: true, bloom: true, volumetricClouds: true, cloudDensity: 1.0, antialias: true },
  ultra: { renderScale: 1.25, shadows: true, bloom: true, volumetricClouds: true, cloudDensity: 1.4, antialias: true },
};

class SettingsStore {
  constructor() {
    this.data = { ...DEFAULTS };
    this.listeners = [];
    this.load();
  }
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* localStorage 사용 불가 환경 — 기본값 유지 */ }
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* 무시 */ }
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    this.data[k] = v;
    if (k === 'quality') this.applyQuality(v);
    this.save();
    for (const fn of this.listeners) fn(k, v, this.data);
  }
  applyQuality(name) {
    const p = QUALITY_PRESETS[name];
    if (!p) return;
    Object.assign(this.data, p);
    this.save();
    for (const fn of this.listeners) fn('*', name, this.data);
  }
  onChange(fn) { this.listeners.push(fn); return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); }; }
  reset() {
    this.data = { ...DEFAULTS };
    this.save();
    for (const fn of this.listeners) fn('*', null, this.data);
  }
  get volumeOf() {
    const m = clamp(this.data.masterVolume, 0, 1);
    return {
      master: m,
      engine: m * this.data.engineVolume,
      wind: m * this.data.windVolume,
      fx: m * this.data.effectVolume,
      music: m * this.data.musicVolume,
    };
  }
}

export const Settings = new SettingsStore();
