// SKYBREAKER — 격납고 · 기체 제작 (스튜디오 3D 프리뷰 + 설계 패널)
import * as THREE from 'three';
import { JetModel, BODIES, WINGS, TAILS, GUNS, FLAMES, PATTERNS, FINISHES, CANOPIES, PRESETS, normalizeDesign, computeStats } from './jet.js';
import { statBarsHTML } from './ui.js';
import { Audio } from '../../src/core/audio.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SAVE_KEY = 'skybreaker.designs.v1';

export function loadSaved() {
  try { return (JSON.parse(localStorage.getItem(SAVE_KEY)) || []).map(normalizeDesign); } catch (e) { return []; }
}
function storeSaved(list) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(list)); } catch (e) { /* noop */ } }

const SWATCHES = ['#7b8794', '#59626e', '#4f565e', '#2c2f35', '#a7b1ba', '#d8dde2', '#6f7f8f', '#3c4a5c', '#5d6745', '#7a6a4f', '#b52a2a', '#d94b3a', '#f2b33d', '#e8c547', '#3a6ea8', '#2d9cdb', '#7c3aed', '#16a34a', '#111317', '#f4f4f4'];

export class Hangar {
  constructor(game) {
    this.game = game;
    this.renderer = game.renderer;
    this.design = normalizeDesign(game.design);
    this.tab = 'body';
    this.yaw = -0.7; this.pitch = 0.22; this.dist = 34;
    this.autoSpin = true;
    this.abTest = false;
    this._t = 0;
    this._buildScene();
    this._bindView();
    this._renderPanel();
  }

  _buildScene() {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x070b12);
    s.fog = new THREE.Fog(0x070b12, 90, 220);
    this.scene = s;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.3, 600);
    // 스튜디오 환경맵 (소프트박스 반사)
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x0c121c, side: THREE.BackSide })));
    const box = (w, h, x, y, z, c) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    };
    box(40, 10, 0, 40, 0, 0xffffff);
    box(20, 30, 40, 10, 10, 0xbfd8ff);
    box(20, 30, -40, 8, -20, 0xffe0c0);
    box(60, 4, 0, 5, -45, 0x6aa8ff);
    this.envTex = pm.fromScene(env, 0.02).texture;
    s.environment = this.envTex;
    pm.dispose();

    s.add(new THREE.HemisphereLight(0x9cc0ff, 0x1a1410, 0.5));
    const key = new THREE.DirectionalLight(0xfff1de, 2.6);
    key.position.set(18, 30, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 90;
    key.shadow.bias = -0.0004;
    s.add(key);
    const rim = new THREE.DirectionalLight(0x6aa8ff, 1.6);
    rim.position.set(-20, 8, -24);
    s.add(rim);

    // 바닥: 반사 느낌의 원형 패드 + 그리드 + 라이트 링
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(256, 256, 0, 256, 256, 256);
    g.addColorStop(0, '#1b2433'); g.addColorStop(0.6, '#0e141e'); g.addColorStop(1, '#070b12');
    x.fillStyle = g; x.fillRect(0, 0, 512, 512);
    x.strokeStyle = 'rgba(120,200,255,0.10)'; x.lineWidth = 1;
    for (let i = 0; i <= 512; i += 24) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke(); }
    const floorTex = new THREE.CanvasTexture(c);
    floorTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(15.6, 16, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.9, 2.2), toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    s.add(ring);
    this.floorY = 0;
  }

  _bindView() {
    const cv = this.renderer.domElement;
    let id = null, lx = 0, ly = 0, pinch = null;
    const pts = new Map();
    cv.addEventListener('pointerdown', (e) => {
      if (this.game.state !== 'hangar') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      id = e.pointerId; lx = e.clientX; ly = e.clientY;
      this.autoSpin = false;
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.game.state !== 'hangar' || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.dist = clamp(this.dist * pinch / d, 16, 70);
        pinch = d;
        return;
      }
      if (e.pointerId !== id) return;
      this.yaw -= (e.clientX - lx) * 0.008;
      this.pitch = clamp(this.pitch + (e.clientY - ly) * 0.006, -0.1, 1.3);
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (e.pointerId === id) id = null; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => { if (this.game.state === 'hangar') this.dist = clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.08), 16, 70); }, { passive: true });
  }

  open(design) {
    this.design = normalizeDesign(design || this.game.design);
    this._rebuild();
    this._renderPanel();
    this.autoSpin = true;
  }

  close() {
    if (this.jet) { this.jet.dispose(); this.jet = null; }
  }

  _rebuild() {
    if (this.jet) this.jet.dispose();
    this.jet = new JetModel(this.design);
    this.jet.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // 바닥에 착지 (랜딩기어 대신 받침 높이)
    this.jet.root.position.set(0, 3.2, 0);
    this.jet.setMissilesVisible(this.design.missiles * 2);
    this.scene.add(this.jet.root);
    this._updateStats();
  }

  _updateStats() {
    const el = $('#hg-stats');
    if (!el) return;
    const st = computeStats(this.design);
    el.innerHTML = statBarsHTML(this.design) + `
      <div class="hg-nums">
        <div><span>전장</span><b>${st.L.toFixed(1)} m</b></div>
        <div><span>중량</span><b>${Math.round(st.mass).toLocaleString()} kg</b></div>
        <div><span>실속 속도</span><b>${Math.round(st.stall * 3.6)} km/h</b></div>
        <div><span>최대 G</span><b>${st.maxG.toFixed(1)} G</b></div>
      </div>`;
  }

  _set(path, value) {
    const d = this.design;
    if (path.startsWith('paint.')) d.paint[path.slice(6)] = value;
    else d[path] = value;
    this.design = normalizeDesign(d);
    clearTimeout(this._rt);
    this._rt = setTimeout(() => this._rebuild(), 40);
    if (Audio.ready) Audio.ui('place');
  }

  _renderPanel() {
    const d = this.design;
    $('#hg-name').value = d.name;
    for (const b of document.querySelectorAll('#hg-tabs button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const body = $('#hg-body');
    const seg = (path, opts, cur) => `<div class="seg" data-path="${path}">${Object.entries(opts).map(([k, v]) => `<button data-v="${k}" class="${String(k) === String(cur) ? 'on' : ''}">${v}</button>`).join('')}</div>`;
    const slider = (path, label, mn, mx, stp, cur, fmt) => `<div class="hg-row"><label>${label}<em>${fmt(cur)}</em></label><input type="range" data-path="${path}" min="${mn}" max="${mx}" step="${stp}" value="${cur}" data-fmt="${fmt === pct ? 'pct' : 'deg'}"></div>`;
    const pct = (v) => Math.round(v * 100) + '%';
    const deg = (v) => (v > 0 ? '+' : '') + Math.round(v) + '°';
    const color = (path, label, cur) => `<div class="hg-row"><label>${label}</label><div class="sw" data-path="${path}">${SWATCHES.map((c) => `<button data-v="${c}" style="background:${c}" class="${c === cur ? 'on' : ''}"></button>`).join('')}<input type="color" value="${cur}"></div></div>`;
    const map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : v.name]));
    let h = '';
    if (this.tab === 'body') {
      h += `<div class="hg-row"><label>기체 형식</label>${seg('body', map(BODIES), d.body)}<p class="hint">${BODIES[d.body].desc}</p></div>`;
      h += slider('length', '기체 크기', 0.85, 1.2, 0.01, d.length, pct);
      h += `<div class="hg-row"><label>공기 흡입구</label>${seg('intake', { side: '측면형', chin: '턱밑형' }, d.intake)}</div>`;
    } else if (this.tab === 'wing') {
      h += `<div class="hg-row"><label>주익 형식</label>${seg('wing', map(WINGS), d.wing)}</div>`;
      h += slider('span', '날개 폭', 0.8, 1.25, 0.01, d.span, pct);
      h += slider('sweep', '후퇴각 조정', -10, 10, 1, d.sweep, deg);
      h += `<div class="hg-row"><label>카나드 (전방 날개)</label>${seg('canard', { false: '없음', true: '장착' }, d.canard)}</div>`;
    } else if (this.tab === 'engine') {
      h += `<div class="hg-row"><label>엔진 수</label>${seg('engines', { 1: '단발', 2: '쌍발', 3: '3발' }, d.engines)}</div>`;
      h += `<div class="hg-row"><label>꼬리 날개</label>${seg('tail', map(TAILS), d.tail)}</div>`;
      h += `<div class="hg-row"><label>애프터버너 화염</label>${seg('flame', map(FLAMES), d.flame)}</div>`;
      h += `<button class="btn ghost" id="hg-ab">${this.abTest ? '🔥 애프터버너 끄기' : '🔥 애프터버너 시험 점화'}</button>`;
    } else if (this.tab === 'paint') {
      h += `<div class="hg-row"><label>도장 패턴</label>${seg('paint.pattern', PATTERNS, d.paint.pattern)}</div>`;
      h += color('paint.base', '기본색', d.paint.base);
      h += color('paint.second', '보조색', d.paint.second);
      h += color('paint.accent', '강조색 (마킹)', d.paint.accent);
      h += `<div class="hg-row"><label>표면 마감</label>${seg('paint.finish', FINISHES, d.paint.finish)}</div>`;
      h += `<div class="hg-row"><label>캐노피</label>${seg('paint.canopy', CANOPIES, d.paint.canopy)}</div>`;
      h += `<div class="hg-row"><label>기체 번호</label><input class="txt" id="hg-number" maxlength="3" value="${d.number}"></div>`;
    } else if (this.tab === 'arms') {
      h += `<div class="hg-row"><label>기관포</label>${seg('gun', map(GUNS), d.gun)}</div>`;
      const G = GUNS[d.gun];
      h += `<p class="hint">연사 ${G.rof * 60}발/분 · 탄당 피해 ${G.dmg} · 탄약 ${G.ammo}</p>`;
      h += `<div class="hg-row"><label>미사일 탑재</label>${seg('missiles', { 2: '2발', 4: '4발', 6: '6발', 8: '8발' }, d.missiles)}</div>`;
      h += `<p class="hint">미사일이 많을수록 화력↑ 대신 무게·항력↑ (스텔스 기체는 내부 무장창 — 항력 없음)</p>`;
    }
    body.innerHTML = h;
    // 이벤트
    for (const s of body.querySelectorAll('.seg')) {
      s.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        let v = b.dataset.v;
        if (v === 'true') v = true; else if (v === 'false') v = false; else if (/^\d+$/.test(v)) v = +v;
        this._set(s.dataset.path, v);
        this._renderPanel();
      });
    }
    for (const r of body.querySelectorAll('input[type=range]')) {
      r.addEventListener('input', () => {
        const fmt = r.dataset.fmt === 'pct' ? pct : deg;
        r.previousElementSibling.querySelector('em').textContent = fmt(+r.value);
        this._set(r.dataset.path, +r.value);
      });
    }
    for (const s of body.querySelectorAll('.sw')) {
      s.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        this._set(s.dataset.path, b.dataset.v);
        this._renderPanel();
      });
      s.querySelector('input').addEventListener('change', (e) => { this._set(s.dataset.path, e.target.value); this._renderPanel(); });
    }
    const num = $('#hg-number');
    if (num) num.addEventListener('change', () => this._set('number', num.value.toUpperCase()));
    const ab = $('#hg-ab');
    if (ab) ab.addEventListener('click', () => { this.abTest = !this.abTest; this._renderPanel(); });
    this._renderList();
    this._updateStats();
  }

  _renderList() {
    const saved = loadSaved();
    const card = (d, i, mine) => `<button class="pcard" data-i="${i}" data-mine="${mine ? 1 : 0}">
      <i style="background:linear-gradient(135deg, ${d.paint.base}, ${d.paint.second})"></i>
      <b>${d.name}</b><span>${BODIES[d.body].name}</span>${mine ? `<em class="del" data-del="${i}">✕</em>` : ''}</button>`;
    $('#hg-list').innerHTML = `<h4>기본 기체</h4><div class="plist">${PRESETS.map((d, i) => card(d, i, false)).join('')}</div>
      <h4>내 설계 (${saved.length})</h4><div class="plist">${saved.length ? saved.map((d, i) => card(d, i, true)).join('') : '<p class="hint">저장한 기체가 없습니다. 위에서 「저장」을 누르세요.</p>'}</div>`;
    for (const b of document.querySelectorAll('#hg-list .pcard')) {
      b.addEventListener('click', (e) => {
        const del = e.target.closest('[data-del]');
        if (del) {
          e.stopPropagation();
          const list = loadSaved();
          list.splice(+del.dataset.del, 1);
          storeSaved(list);
          this._renderList();
          if (Audio.ready) Audio.ui('back');
          return;
        }
        const src = b.dataset.mine === '1' ? loadSaved()[+b.dataset.i] : PRESETS[+b.dataset.i];
        this.design = normalizeDesign(src);
        this._rebuild();
        this._renderPanel();
        if (Audio.ready) Audio.ui('confirm');
      });
    }
  }

  bindTopBar() {
    $('#hg-name').addEventListener('change', (e) => { this.design.name = e.target.value.toUpperCase().slice(0, 16) || 'MY FIGHTER'; this._rebuild(); });
    for (const b of document.querySelectorAll('#hg-tabs button')) b.addEventListener('click', () => { this.tab = b.dataset.tab; this._renderPanel(); if (Audio.ready) Audio.ui('click'); });
    $('#hg-save').addEventListener('click', () => {
      const list = loadSaved();
      const d = normalizeDesign({ ...this.design, id: 'u' + Date.now() });
      const i = list.findIndex((x) => x.name === d.name);
      if (i >= 0) list[i] = d; else list.unshift(d);
      storeSaved(list.slice(0, 30));
      this._renderList();
      this.game.ui.popup('「' + d.name + '」 저장 완료', 'info');
      if (Audio.ready) Audio.ui('confirm');
    });
    $('#hg-random').addEventListener('click', () => {
      const pick = (o) => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
      const sw = () => SWATCHES[Math.floor(Math.random() * SWATCHES.length)];
      this.design = normalizeDesign({
        ...this.design, body: pick(BODIES), wing: pick(WINGS), tail: pick(TAILS), engines: 1 + Math.floor(Math.random() * 3),
        canard: Math.random() < 0.35, span: 0.85 + Math.random() * 0.35, sweep: Math.round(Math.random() * 16 - 8), length: 0.9 + Math.random() * 0.25,
        gun: pick(GUNS), missiles: 2 + 2 * Math.floor(Math.random() * 4), flame: pick(FLAMES), intake: Math.random() < 0.5 ? 'side' : 'chin',
        number: String(Math.floor(Math.random() * 99)).padStart(2, '0'),
        paint: { base: sw(), second: sw(), accent: sw(), pattern: pick(PATTERNS), finish: pick(FINISHES), canopy: pick(CANOPIES) },
      });
      this._rebuild();
      this._renderPanel();
      if (Audio.ready) Audio.ui('confirm');
    });
    $('#hg-fly').addEventListener('click', () => { this.game.setDesign(this.design); this.game.startFlight('free'); });
    $('#hg-back').addEventListener('click', () => { this.game.setDesign(this.design); this.game.toMenu(); });
  }

  update(dt) {
    this._t += dt;
    if (this.autoSpin) this.yaw += dt * 0.18;
    const cam = this.camera;
    const w = window.innerWidth, h = window.innerHeight;
    cam.aspect = w / h;
    // 패널에 가리지 않도록 화면 중앙에서 살짝 비켜 바라봄
    const wide = w > 900;
    cam.setViewOffset(w, h, wide ? -w * 0.04 : 0, wide ? 0 : h * 0.12, w, h);
    cam.updateProjectionMatrix();
    const d = this.dist * (this.jet ? this.jet.L / 17.5 : 1);
    cam.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * d, 3.2 + Math.sin(this.pitch) * d, Math.cos(this.yaw) * Math.cos(this.pitch) * d);
    cam.lookAt(0, 3.0, 0);
    if (this.jet) {
      this.jet.root.position.y = 3.2 + Math.sin(this._t * 1.2) * 0.12;
      this.jet.root.rotation.z = Math.sin(this._t * 0.7) * 0.03;
      const wig = Math.sin(this._t * 1.7);
      this.jet.animate(dt, { throttle: this.abTest ? 1 : 0.35, ab: this.abTest, pitch: wig * 0.4, roll: Math.sin(this._t * 1.1) * 0.5, yaw: Math.sin(this._t * 0.9) * 0.5 });
    }
  }

  render() {
    const r = this.renderer;
    const prevExp = r.toneMappingExposure;
    r.toneMappingExposure = 1.15;
    r.render(this.scene, this.camera);
    r.toneMappingExposure = prevExp;
  }
}
