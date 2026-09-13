// SpaceSim — 항성 / 우주론 / 단위 도구 패널

import { fmt, SI, AU_PER_PC, KM_PER_AU, DAY_PER_YEAR } from '../core/constants.js';
import {
  evolveMainSequence, msLifetime, spectralClass, absoluteMagnitude, habitableZone,
  snowLine, stellarFate, wienPeak, blackbodyRGB, blackbodyHex, mainSequenceTrack,
  STAR_CATALOG, schwarzschildRadius, planck,
} from '../astro/stars.js';
import { Cosmology, PLANCK18, WMAP9, EDS, OPEN, EPOCHS, zToVelocity } from '../astro/cosmology.js';
import { drawHR, drawScaleFactor, drawDistances } from '../render/overlay.js';

const $ = (id) => document.getElementById(id);

function kv(el, rows) {
  el.innerHTML = rows.map((r) => {
    if (r.sep) return `<div class="sep">${r.sep}</div>`;
    const cls = r.cls ? ` ${r.cls}` : '';
    return `<div class="k">${r.k}</div><div class="v${cls}">${r.v}</div>`;
  }).join('');
}

// ───────────────────── 항성 패널 ─────────────────────

export class StarPanel {
  constructor() {
    this.track = mainSequenceTrack(140);
    this.mass = 1;
    this.age = 4.6;
    $('in-smass').addEventListener('input', () => this.update());
    $('in-sage').addEventListener('input', () => this.update());
    this.update();
  }

  update() {
    this.mass = Math.pow(10, parseFloat($('in-smass').value));
    this.age = parseFloat($('in-sage').value);
    $('v-smass').textContent = `${fmt(this.mass, 3)} M☉`;
    $('v-sage').textContent = `${this.age.toFixed(2)} Gyr`;

    const M = this.mass;
    const ev = evolveMainSequence(M, this.age);
    const hz = habitableZone(ev.L);
    const fate = stellarFate(M);
    const cls = spectralClass(ev.T, ev.evolved ? 'III' : 'V');
    const rgb = blackbodyRGB(ev.T).map((c) => Math.round(c * 255));

    kv($('star-kv'), [
      { sep: '구조' },
      { k: '분광형', v: cls, cls: 'good' },
      { k: '유효온도 T_eff', v: `${fmt(ev.T, 4)} K` },
      { k: '광도 L', v: `${fmt(ev.L, 4)} L☉` },
      { k: '반지름 R', v: `${fmt(ev.R, 4)} R☉ (${fmt(ev.R * SI.Rsun / 1e3, 4)} km)` },
      { k: '표면중력 log g', v: fmt(Math.log10(27542 * M / (ev.R * ev.R)), 4) },
      { k: '평균밀도', v: `${fmt(1.41 * M / (ev.R ** 3), 3)} g/cm³` },
      { k: '절대등급 M_bol', v: fmt(absoluteMagnitude(ev.L), 4) },
      { k: '복사 피크 λ_max', v: `${fmt(wienPeak(ev.T), 4)} nm` },
      { k: '측광 색', v: `rgb(${rgb.join(',')})` },
      { sep: '진화' },
      { k: '주계열 수명', v: `${fmt(msLifetime(M), 3)} Gyr` },
      { k: '경과 비율', v: `${(ev.fraction * 100).toFixed(1)} %`, cls: ev.fraction > 0.95 ? 'bad' : ev.fraction > 0.7 ? 'warn' : 'good' },
      { k: '상태', v: ev.evolved ? '주계열 이탈 (거성 단계)' : '주계열', cls: ev.evolved ? 'warn' : '' },
      { k: '최종 운명', v: fate.end },
      { k: '잔해', v: `${fate.remnant} — ${fate.note}` },
      { sep: '행성계' },
      { k: '거주가능영역', v: `${fmt(hz.inner, 3)} – ${fmt(hz.outer, 3)} AU` },
      { k: 'HZ 공전주기', v: `${fmt(Math.sqrt(((hz.inner + hz.outer) / 2) ** 3 / M) * 365.25, 4)} 일` },
      { k: '서리선', v: `${fmt(snowLine(ev.L), 3)} AU` },
      { k: '조석고정 한계', v: `${fmt(0.06 * Math.cbrt(M), 3)} AU` },
      { sep: '상대론' },
      { k: '슈바르츠실트 반지름', v: `${fmt(schwarzschildRadius(M) * KM_PER_AU, 4)} km` },
      { k: '표면 탈출속도', v: `${fmt(617.5 * Math.sqrt(M / ev.R), 4)} km/s` },
      { k: '중력 적색편이 z', v: fmt(schwarzschildRadius(M) / (ev.R * SI.Rsun / SI.AU) / 2, 3) },
    ]);

    drawHR($('chart-hr'), this.track, STAR_CATALOG, { T: ev.T, L: ev.L });
    this.drawSpectrum($('chart-bb'), ev.T);
  }

  drawSpectrum(cv, T) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 300, h = cv.clientHeight || 150;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 30, r: 8, t: 10, b: 20 };

    // 가시광 밴드 배경
    for (let x = pad.l; x < w - pad.r; x++) {
      const lam = 100 + ((x - pad.l) / (w - pad.l - pad.r)) * 2400;
      if (lam < 380 || lam > 740) continue;
      ctx.fillStyle = visibleColor(lam);
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x, pad.t, 1, h - pad.t - pad.b);
    }
    ctx.globalAlpha = 1;

    let peak = 0;
    const N = 220;
    const vals = [];
    for (let i = 0; i <= N; i++) {
      const lam = 100 + (i / N) * 2400;
      const v = planck(lam, T);
      vals.push(v);
      if (v > peak) peak = v;
    }
    ctx.strokeStyle = '#' + blackbodyHex(T).toString(16).padStart(6, '0');
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = pad.l + (i / N) * (w - pad.l - pad.r);
      const y = pad.t + (1 - v / peak) * (h - pad.t - pad.b);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();

    ctx.strokeStyle = 'rgba(125,200,240,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
    ctx.fillStyle = 'rgba(190,220,240,0.6)';
    ctx.font = '600 10px Rajdhani, system-ui, sans-serif';
    ctx.fillText('λ [nm]', (w - 30) / 2, h - 4);
    for (const l of [500, 1000, 1500, 2000]) {
      const x = pad.l + ((l - 100) / 2400) * (w - pad.l - pad.r);
      ctx.fillText(String(l), x - 10, h - 4);
    }
    ctx.fillStyle = '#ffd76b';
    ctx.fillText(`λ_max ${wienPeak(T).toFixed(0)} nm`, pad.l + 6, pad.t + 12);
  }
}

function visibleColor(lam) {
  let r = 0, g = 0, b = 0;
  if (lam < 440) { r = -(lam - 440) / 60; b = 1; }
  else if (lam < 490) { g = (lam - 440) / 50; b = 1; }
  else if (lam < 510) { g = 1; b = -(lam - 510) / 20; }
  else if (lam < 580) { r = (lam - 510) / 70; g = 1; }
  else if (lam < 645) { r = 1; g = -(lam - 645) / 65; }
  else { r = 1; }
  return `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
}

// ───────────────────── 우주론 패널 ─────────────────────

const PRESETS = { planck: PLANCK18, wmap: WMAP9, eds: EDS, open: OPEN };

export class CosmoPanel {
  constructor() {
    this.cosmo = new Cosmology(PLANCK18);
    this.applyPreset('planck');
    $('in-cosmo').addEventListener('change', (e) => this.applyPreset(e.target.value));
    for (const id of ['in-h0', 'in-om', 'in-ol', 'in-z']) {
      $(id).addEventListener('input', () => this.update());
    }
    $('epoch-list').innerHTML = EPOCHS.map((e) => {
      const t = this.cosmo.age(e.z);
      return `<div><span class="t">z = ${e.z >= 1000 ? e.z.toExponential(1) : e.z}</span> · ${e.name} — 우주 나이 ${
        t < 0.001 ? (t * 1e6).toFixed(1) + ' kyr' : t < 1 ? (t * 1e3).toFixed(1) + ' Myr' : t.toFixed(2) + ' Gyr'
      }${e.note ? ` · ${e.note}` : ''}</div>`;
    }).reverse().join('');
  }

  applyPreset(key) {
    const p = PRESETS[key] ?? PLANCK18;
    $('in-h0').value = p.H0;
    $('in-om').value = p.Om;
    $('in-ol').value = p.Ol;
    if (!$('in-z').value || $('in-z').value === '0') $('in-z').value = 0;
    this.update();
  }

  update() {
    const H0 = parseFloat($('in-h0').value);
    const Om = parseFloat($('in-om').value);
    const Ol = parseFloat($('in-ol').value);
    const z = Math.pow(10, parseFloat($('in-z').value));
    this.cosmo.set({ H0, Om, Ol, Or: 9.182e-5, name: 'custom' });

    $('v-h0').textContent = H0.toFixed(2);
    $('v-om').textContent = Om.toFixed(3);
    $('v-ol').textContent = Ol.toFixed(3);
    $('v-z').textContent = z < 0.01 ? z.toExponential(2) : fmt(z, 4);

    const r = this.cosmo.report(z);
    const Ok = r.Ok;
    const geom = Math.abs(Ok) < 0.005 ? '평탄 (k = 0)' : Ok > 0 ? '열린 (k < 0)' : '닫힌 (k > 0)';
    const ageAtZ = r.ageAtZ;

    kv($('cosmo-kv'), [
      { sep: '우주 구성' },
      { k: '곡률 Ω_k', v: fmt(Ok, 4), cls: Math.abs(Ok) < 0.005 ? 'good' : 'warn' },
      { k: '기하', v: geom },
      { k: '임계밀도 ρ_c', v: `${fmt(r.rhoCrit, 3)} kg/m³` },
      { k: '허블 시간 1/H₀', v: `${this.cosmo.hubbleTime.toFixed(3)} Gyr` },
      { k: '허블 거리 c/H₀', v: `${this.cosmo.hubbleDistance.toFixed(1)} Mpc` },
      { k: '우주 나이 (현재)', v: `${r.ageNow.toFixed(4)} Gyr`, cls: 'good' },
      { sep: `적색편이 z = ${fmt(z, 4)}` },
      { k: 'E(z) = H/H₀', v: fmt(r.E, 5) },
      { k: 'H(z)', v: `${fmt(r.H, 5)} km/s/Mpc` },
      { k: '후퇴시간', v: `${fmt(r.lookback, 4)} Gyr` },
      { k: '그때의 우주 나이', v: `${ageAtZ < 0.001 ? (ageAtZ * 1e6).toFixed(2) + ' kyr' : ageAtZ < 1 ? (ageAtZ * 1e3).toFixed(2) + ' Myr' : ageAtZ.toFixed(4) + ' Gyr'}` },
      { k: '척도인자 a', v: fmt(1 / (1 + z), 5) },
      { k: '광행거리', v: `${fmt(r.lightTravelGly, 4)} Gly` },
      { sep: '거리 척도' },
      { k: '공변거리 D_C', v: `${fmt(r.comoving, 5)} Mpc` },
      { k: '횡단공변 D_M', v: `${fmt(r.transverse, 5)} Mpc` },
      { k: '각지름거리 D_A', v: `${fmt(r.angular, 5)} Mpc` },
      { k: '광도거리 D_L', v: `${fmt(r.luminosity, 5)} Mpc` },
      { k: '거리지수 μ', v: fmt(r.modulus, 5) },
      { k: '1″ 에 대응하는 크기', v: `${fmt(r.angular * 1e3 / 206.264806, 4)} pc` },
      { k: '상대론적 후퇴속도', v: `${fmt(zToVelocity(z), 5)} km/s` },
      { sep: '지평선' },
      { k: '입자 지평선', v: `${fmt(r.horizon, 5)} Mpc` },
      { k: '관측가능 우주 반지름', v: `${fmt(r.horizon * 1e6 * AU_PER_PC / 63241.1 / 1e9, 4)} Gly` },
      { k: '사건 지평선', v: isFinite(r.eventHorizon) ? `${fmt(r.eventHorizon, 5)} Mpc` : '무한 (Λ = 0)' },
    ]);

    this.redrawCharts();
  }

  redrawCharts() {
    const models = [
      { name: '현재 모형', color: '#7de2ff', pts: this.cosmo.scaleFactorHistory({ steps: 1400 }) },
      { name: 'Ω_m=1 (EdS)', color: '#ff9a5c', pts: new Cosmology(EDS).scaleFactorHistory({ steps: 1400 }) },
      { name: 'Λ=0 열린 우주', color: '#7dffb0', pts: new Cosmology(OPEN).scaleFactorHistory({ steps: 1400 }) },
    ];
    drawScaleFactor($('chart-af'), models);
    drawDistances($('chart-dz'), this.cosmo);
  }
}

// ───────────────────── 단위 변환표 ─────────────────────

export function renderUnitTable(sim) {
  kv($('unit-kv'), [
    { sep: '길이' },
    { k: '1 AU', v: `${KM_PER_AU.toLocaleString()} km = ${(1 / AU_PER_PC).toExponential(4)} pc` },
    { k: '1 pc', v: `${AU_PER_PC.toFixed(1)} AU = 3.2616 ly` },
    { k: '1 광년', v: `63 241 AU = 0.3066 pc` },
    { k: '1 R☉', v: `${(SI.Rsun / 1e3).toLocaleString()} km = 0.004650 AU` },
    { sep: '시간 · 질량' },
    { k: '1 율리우스년', v: `${DAY_PER_YEAR} 일 = ${SI.jyr.toExponential(5)} s` },
    { k: '1 M☉', v: `${SI.Msun.toExponential(5)} kg = 333 000 M⊕` },
    { k: '1 M⊕', v: `${SI.Mearth.toExponential(5)} kg` },
    { sep: '중력상수' },
    { k: 'G (SI)', v: `${SI.G.toExponential(5)} m³/kg·s²` },
    { k: 'G (AU·일·M☉)', v: `2.959122e-4` },
    { k: '현재 계의 G', v: fmt(sim.G, 6) },
    { k: 'c', v: `${(SI.c / 1e3).toLocaleString()} km/s = 173.14 AU/일` },
    { sep: '유용한 관계' },
    { k: '지구 공전속도', v: '29.78 km/s = 0.01720 AU/일' },
    { k: '태양 표면 탈출속도', v: '617.5 km/s' },
    { k: '케플러 3법칙', v: 'a³ = M · P²  (AU, M☉, 년)' },
    { k: '주계열 수명', v: 't ≈ 10 (M/L) Gyr' },
  ]);
}
