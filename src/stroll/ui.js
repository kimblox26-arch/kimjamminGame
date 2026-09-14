// 고요(GOYO) — HUD / 메뉴
import { clamp01, lerp } from '../core/utils.js';

const DIRS = [
  [0, '북'], [45, '북동'], [90, '동'], [135, '남동'],
  [180, '남'], [225, '남서'], [270, '서'], [315, '북서'],
];

export class HUD {
  constructor() {
    this.root = document.getElementById('hud');
    this.compass = document.getElementById('compass-strip');
    this.clockTime = document.getElementById('clock-time');
    this.clockPhase = document.getElementById('clock-phase');
    this.calmFill = document.getElementById('calm-fill');
    this.calmLabel = document.getElementById('calm-label');
    this.staminaWrap = document.getElementById('stamina');
    this.staminaFill = document.getElementById('stamina-fill');
    this.hint = document.getElementById('hint');
    this.toasts = document.getElementById('toasts');
    this.subtitle = document.getElementById('subtitle');
    this.visible = true;
    this._hintTimer = 0;
    this._buildCompass();
  }

  _buildCompass() {
    // 360°를 두 번 이어 붙여 끊김 없이 흐르게 한다
    let html = '';
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < 360; a += 15) {
        const label = DIRS.find((d) => d[0] === a);
        html += `<span class="tick ${label ? 'major' : ''}" style="left:${(pass * 360 + a) * 4}px">${label ? label[1] : ''}</span>`;
      }
    }
    this.compass.innerHTML = html;
  }

  setVisible(v) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
  }

  toast(text, sub = '') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<b>${text}</b>${sub ? `<i>${sub}</i>` : ''}`;
    this.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 900);
    }, 4200);
  }

  showHint(text, seconds = 4) {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    this._hintTimer = seconds;
  }

  say(text, seconds = 5) {
    this.subtitle.textContent = text;
    this.subtitle.classList.add('show');
    clearTimeout(this._sayTimer);
    this._sayTimer = setTimeout(() => this.subtitle.classList.remove('show'), seconds * 1000);
  }

  update(dt, s) {
    if (!this.visible) return;
    // 나침반
    const deg = ((-s.yaw * 180 / Math.PI) % 360 + 360) % 360;
    this.compass.style.transform = `translateX(${-deg * 4}px)`;

    this.clockTime.textContent = s.clock;
    this.clockPhase.textContent = s.phase;

    this.calmFill.style.width = `${(s.calm * 100).toFixed(1)}%`;
    if (this.calmLabel) this.calmLabel.textContent = `고요 ${Math.round(s.calm * 100)}`;

    const showStamina = s.stamina < 0.995 || s.sprinting;
    this.staminaWrap.classList.toggle('show', showStamina);
    this.staminaFill.style.width = `${(s.stamina * 100).toFixed(1)}%`;
    this.staminaWrap.classList.toggle('low', s.stamina < 0.25);

    if (this._hintTimer > 0) {
      this._hintTimer -= dt;
      if (this._hintTimer <= 0) this.hint.classList.remove('show');
    }
  }
}

/** 설정 · 일시정지 메뉴 */
export class Menu {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('pause');
    this.open = false;
    this._bind();
  }

  _bind() {
    const g = this.game;
    const bindRange = (id, get, set) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = get();
      const label = document.getElementById(id + '-val');
      const show = () => { if (label) label.textContent = el.dataset.suffix ? `${el.value}${el.dataset.suffix}` : el.value; };
      show();
      el.addEventListener('input', () => { set(parseFloat(el.value)); show(); });
    };
    const bindToggle = (id, get, set) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.checked = get();
      el.addEventListener('change', () => set(el.checked));
    };

    bindRange('opt-master', () => g.settings.master, (v) => { g.settings.master = v; g.audio.setVolume('master', v); });
    bindRange('opt-ambient', () => g.settings.ambient, (v) => { g.settings.ambient = v; g.audio.setVolume('ambient', v); });
    bindRange('opt-sfx', () => g.settings.sfx, (v) => { g.settings.sfx = v; g.audio.setVolume('sfx', v); });
    bindRange('opt-music', () => g.settings.musicVol, (v) => { g.settings.musicVol = v; g.audio.setVolume('music', v); });
    bindRange('opt-sens', () => g.settings.sensitivity, (v) => { g.settings.sensitivity = v; g.player.sensitivity = v; });
    bindRange('opt-fov', () => g.settings.fov, (v) => {
      g.settings.fov = v; g.player.fovBase = v; g.camera.fov = v; g.camera.updateProjectionMatrix();
    });
    bindRange('opt-daylen', () => g.settings.dayLength, (v) => { g.settings.dayLength = v; g.sky.dayLength = v; });
    bindToggle('opt-musicon', () => g.settings.music, (v) => { g.settings.music = v; });
    bindToggle('opt-invert', () => g.settings.invertY, (v) => { g.settings.invertY = v; g.player.invertY = v; });

    document.getElementById('btn-resume')?.addEventListener('click', () => g.resume());
    document.getElementById('btn-daynow')?.addEventListener('click', () => { g.sky.time = 0.26; g.hud.say('동이 트기 시작한다'); });
    document.getElementById('btn-nightnow')?.addEventListener('click', () => { g.sky.time = 0.86; g.hud.say('별이 돋는다'); });
    document.getElementById('btn-pausetime')?.addEventListener('click', (e) => {
      g.sky.paused = !g.sky.paused;
      e.target.textContent = g.sky.paused ? '시간 멈춤 ✓' : '시간 멈춤';
    });
  }

  show() { this.open = true; this.el.classList.add('show'); }
  hide() { this.open = false; this.el.classList.remove('show'); }
}
