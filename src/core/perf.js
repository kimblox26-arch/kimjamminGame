// FREE FREELY - 최적화 (성능 모드 · 자동 해상도)
//
// 성능 모드: 품질 프리셋을 '낮음'으로 바꾸고, 고해상도 화면의 픽셀 배율을 1로 묶는다.
//            끄면 켜기 직전의 프리셋으로 되돌린다.
// 자동 해상도: 1초마다 실제 프레임 수를 재서 느리면 렌더 해상도를 낮추고, 여유가 생기면 천천히 되돌린다.
import { Settings } from './settings.js';

const MIN_DYN = 0.6;

export const Perf = {
  /** 자동 해상도 배율 (MIN_DYN..1) */
  dyn: 1,
  _t: 0,
  _frames: 0,
  _good: 0,
  _slow: 0,
  _cool: 0,
  _hinted: false,
  onChange: null,   // (dyn) => void  — 해상도 배율이 바뀌었을 때
  onSlow: null,     // () => void     — 성능 모드가 꺼진 채로 계속 느릴 때 (세션당 한 번)

  get enabled() { return !!Settings.get('perfMode'); },

  /** 기기 픽셀 배율 상한: 성능 모드에서는 1 (레티나·4K 화면에서 픽셀 수 1/4) */
  deviceRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(this.enabled ? 1 : 2, dpr);
  },

  /** 최종 렌더 픽셀 배율 = 기기 배율 × 품질 배율 × 자동 해상도 */
  pixelRatio(scale) {
    return Math.max(0.5, this.deviceRatio() * scale * this.dyn);
  },

  toggle() {
    const on = !this.enabled;
    if (on) {
      const q = Settings.get('quality');
      Settings.set('perfPrevQuality', q === 'low' ? (Settings.get('perfPrevQuality') || 'medium') : q);
      Settings.set('perfMode', true);
      Settings.set('quality', 'low');
    } else {
      Settings.set('perfMode', false);
      Settings.set('quality', Settings.get('perfPrevQuality') || 'medium');
    }
    this.reset();
    return on;
  },

  /** 화면 전환 등으로 측정을 새로 시작 (배율은 유지) */
  reset() {
    this._t = 0; this._frames = 0; this._good = 0; this._slow = 0; this._cool = 1;
  },

  /** 매 프레임 호출. dt 는 실제 경과 시간(초, 상한 전). */
  update(dt) {
    if (document.hidden || dt > 0.5) { this.reset(); return; }
    this._t += dt;
    this._frames++;
    if (this._t < 1) return;
    const fps = this._frames / this._t;
    this._t = 0; this._frames = 0;
    if (this._cool > 0) { this._cool--; return; }   // 배율 변경 직후 1초는 판단 보류

    // 성능 모드가 꺼진 채로 5초 연속 30fps 미만이면 한 번 안내
    this._slow = fps < 30 ? this._slow + 1 : 0;
    if (this._slow >= 5 && !this.enabled && !this._hinted) {
      this._hinted = true;
      if (this.onSlow) this.onSlow(fps);
    }

    if (!Settings.get('autoResolution')) {
      if (this.dyn !== 1) this._set(1);
      return;
    }
    if (fps < 45 && this.dyn > MIN_DYN) {
      this._good = 0;
      this._set(Math.max(MIN_DYN, this.dyn - (fps < 25 ? 0.2 : 0.1)));
    } else if (fps > 57) {
      if (++this._good >= 3 && this.dyn < 1) { this._good = 0; this._set(Math.min(1, this.dyn + 0.05)); }
    } else {
      this._good = 0;
    }
  },

  _set(v) {
    v = Math.round(v * 100) / 100;
    if (v === this.dyn) return;
    this.dyn = v;
    this._cool = 1;
    if (this.onChange) this.onChange(v);
  },
};
