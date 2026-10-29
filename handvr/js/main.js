// HAND VR — 제자리에 서서 내 손을 그대로 움직여 보는 화면 (이동·물체 없음)
import * as THREE from 'three';
import { createWorld } from './world.js';
import { Tracker, IS_MOBILE } from './tracking.js';
import { HandState, HandAssigner, BONES, WEBCAM_HFOV, recalibrateDepth } from './hands.js';
import { loadHandRigs, SKIN_TONES, setSkinTone, setSkinFromCamera, setSleeve } from './hand-rig.js';
import { HandScanner } from './scan.js';
import { FINGER_NAME, STATE_NAME } from './finger-pose.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = s => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;

// ───────── 설정 ─────────
const settings = { swap: false, preview: true, tone: 'auto', quality: 'auto' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('handvr') || '{}')); } catch { /* 저장소 없음 */ }
// 예전 기본값 '고품질'로 저장된 화질은 한 번 '자동'으로 바꿔 준다 (폰에서 너무 무거웠음)
if (!settings.v2) { if (settings.quality === 'high') settings.quality = 'auto'; settings.v2 = true; }
const save = () => { try { localStorage.setItem('handvr', JSON.stringify(settings)); } catch { /* 무시 */ } };

// ───────── 렌더러 / 장면 ─────────
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 3000);
// 제자리: 눈높이 1.55m, 지평선과 해가 보이게 살짝만 아래를 본다
const STAND = new THREE.Vector3(0, 0, 0);
camera.position.set(0, 1.55, 0);
camera.rotation.set(-0.08, 0, 0);
scene.add(camera);
const world = createWorld(scene, renderer);
world.update(0, STAND);

const hands = { L: new HandState('L'), R: new HandState('R') };
// 리깅된 3D 손 모델 (불러오기 끝나면 카메라에 붙임)
let meshes = null;
let lastSkinKey = '';
const rigsReady = loadHandRigs().then(r => {
  meshes = r;
  camera.add(r.L.group, r.R.group);
  setSkinTone(settings.tone === 'auto' ? 'medium' : settings.tone);
  lastSkinKey = '';
  return r;
});
rigsReady.catch(e => { console.error(e); msg('손 3D 모델을 불러오지 못했어요: ' + (e.message || e), true); });
const scanner = new HandScanner(WEBCAM_HFOV);
const assigner = new HandAssigner();
const tracker = new Tracker($('#cam'));
let playing = false;

// ───────── 화질: 자동(기기 성능에 맞춰 단계 조절) / 고품질 / 보통 ─────────
// 단계: 해상도 배율, 후처리(MSAA+블룸), 그림자 해상도·범위
const LEVELS = [
  { pr: 0.7, post: false, shadow: [1024, 5] },
  { pr: 0.85, post: false, shadow: [2048, 6] },
  { pr: 1.0, post: false, shadow: [2048, 5] },
  { pr: 1.25, post: true, shadow: [4096, 4.5] },
  { pr: 1.5, post: true, shadow: [4096, 4.5] },
];
const QUALITY_NAME = { auto: '자동', high: '고품질', normal: '보통(빠름)' };
let qLevel = IS_MOBILE ? 1 : 3;
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.55, 3.0));
composer.addPass(new OutputPass());
function applyQuality() {
  if (settings.quality === 'high') qLevel = 4;
  else if (settings.quality === 'normal') qLevel = 2;
  const L = LEVELS[qLevel], pr = Math.min(devicePixelRatio, L.pr);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  if (L.post) { composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight); }
  world.setShadowQuality(...L.shadow);
}
applyQuality();
// 자동: 1.5초마다 평균 프레임을 보고 느리면 한 단계 내리고, 오래 여유 있으면 한 단계 올린다
const auto = { t: 0, frames: 0, last: 0, downAt: -1e9 };
function autoQuality(now) {
  if (settings.quality !== 'auto') return;
  auto.frames++;
  if (!auto.t) auto.t = now;
  if (now - auto.t < 1500) return;
  const fps = auto.frames * 1000 / (now - auto.t);
  auto.t = now; auto.frames = 0;
  if (fps < 45 && qLevel > 0) { qLevel--; auto.downAt = now; auto.last = now; applyQuality(); }
  else if (fps > 58 && qLevel < LEVELS.length - 1 && now - auto.last > 5000 && now - auto.downAt > 15000) { qLevel++; auto.last = now; applyQuality(); }
}

// ───────── 키 ─────────
addEventListener('keydown', e => {
  if (!playing || e.repeat) return;
  switch (e.code) {
    case 'KeyK': recalibrateDepth(); for (const h of Object.values(hands)) h.profile.clear(); scanToasted = {}; toast('손 거리·손 스캔을 다시 합니다 — 손을 펴서 보여주세요', 3000); break;
    case 'KeyQ': settings.quality = { auto: 'high', high: 'normal', normal: 'auto' }[settings.quality] ?? 'auto'; save(); applyQuality(); toast(`화질: ${QUALITY_NAME[settings.quality]}`); break;
    case 'KeyX': settings.swap = !settings.swap; toast('왼손 ↔ 오른손 바꿈'); save(); break;
    case 'KeyV': settings.preview = !settings.preview; save(); break;
    case 'KeyH': $('#help').classList.toggle('hidden'); break;
  }
});
$('#help-btn').addEventListener('click', () => $('#help').classList.toggle('hidden'));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyQuality();
});

// ───────── 시작 화면 ─────────
for (const [name, hex] of [['auto', null], ...Object.entries(SKIN_TONES)]) {
  const b = document.createElement('button');
  if (hex === null) { b.className = 'auto'; b.textContent = '📷 자동'; b.title = '카메라로 내 피부색 그대로'; }
  else { b.style.background = '#' + hex.toString(16).padStart(6, '0'); b.title = name; }
  b.classList.toggle('on', name === settings.tone);
  b.onclick = () => {
    settings.tone = name; save();
    lastSkinKey = '';
    if (name !== 'auto') setSkinTone(name);
    document.querySelectorAll('#tones button').forEach(x => x.classList.toggle('on', x === b));
  };
  $('#tones').append(b);
}

const msg = (text, err = false) => { const m = $('#load-msg'); m.textContent = text; m.classList.toggle('err', err); };

$('#btn-start').onclick = async () => {
  const btn = $('#btn-start');
  btn.disabled = true;
  try {
    msg('카메라 권한을 요청하는 중… (브라우저 창에서 "허용"을 눌러주세요)');
    try { await tracker.startCamera(); } catch (e) { throw new Error(cameraError(e)); }
    msg('손 인식 AI 모델을 불러오는 중… (처음 한 번, 약 10MB)');
    try { await tracker.loadHands(); } catch (e) {
      console.error(e);
      throw new Error('AI 모델을 불러오지 못했어요. 인터넷 연결을 확인해 주세요. (' + (e.message || e) + ')');
    }
    tracker.loadPose().catch(e => console.warn('[HandVR] 몸 인식(팔꿈치) 없이 진행', e)); // 뒤에서 불러옴
    msg('손 3D 모델 준비 중…');
    try { await rigsReady; } catch (e) { throw new Error('손 3D 모델을 불러오지 못했어요: ' + (e.message || e)); }
    playing = true;
    $('#start').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    toast('손을 카메라 앞에 보여주세요 🖐', 3500);
  } catch (e) {
    msg(e.message, true);
  } finally {
    btn.disabled = false;
  }
};

function cameraError(e) {
  if (!window.isSecureContext) return '카메라는 https 또는 http://localhost 주소에서만 쓸 수 있어요. (README의 실행 방법 참고)';
  if (e.name === 'NotAllowedError') return '카메라 권한이 거부되었어요. 주소창의 카메라 아이콘에서 허용해 주세요.';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return '사용할 수 있는 카메라가 없어요.';
  if (e.name === 'NotReadableError') return '다른 프로그램이 카메라를 쓰고 있어요. 그 프로그램을 닫고 다시 시도해 주세요.';
  return '카메라를 켜지 못했어요: ' + e.message;
}

let toastTimer = 0;
function toast(text, ms = 1800) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ───────── 추적 결과 처리 ─────────
const view = { tanV: 1, tanH: 1 };
const lostMs = () => clamp(tracker.interval * 2.5, 200, 600);
function onTracking(now) {
  const v = tracker.video, res = tracker.handResult;
  view.tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  view.tanH = view.tanV * camera.aspect;
  const slot = assigner.assign(res, settings.swap, hands, now, lostMs());
  const fr = { W: v.videoWidth, H: v.videoHeight, view, now, lostMs: lostMs(), scanner, video: v, stamp: tracker.frame };
  for (const s of ['L', 'R']) {
    const i = slot[s];
    if (i >= 0) hands[s].ingest(res.landmarks[i], res.worldLandmarks[i], fr);
  }
  updateElbows(now);
  drawPreview();
}

// 팔꿈치: 몸 인식의 손목 중 이 손의 손목(카메라 영상 위치)과 가장 가까운 쪽 팔을 골라
// 손목→팔꿈치 3D 방향(미터)을 손과 같은 축으로 바꿔 쓴다. 팔꿈치가 화면 밖이면 없음(null)
function updateElbows(now) {
  const pr = tracker.poseResult, lm = pr?.landmarks?.[0], wl = pr?.worldLandmarks?.[0];
  for (const s of ['L', 'R']) {
    const h = hands[s];
    if (h.elbow && now - h.elbow.t > 500) h.elbow = null;
    if (!h.visible || !lm || !wl || now - pr.t > 400) continue;
    let best = null, bd = 0.12;
    for (const [w, e] of [[15, 13], [16, 14]]) {
      const d = Math.hypot(lm[w].x - h.img[0].x, lm[w].y - h.img[0].y);
      if (d < bd && (lm[e].visibility ?? 1) > 0.5) { bd = d; best = [w, e]; }
    }
    if (!best) continue;
    const [w, e] = best;
    const dir = new THREE.Vector3(-(wl[e].x - wl[w].x), -(wl[e].y - wl[w].y), wl[e].z - wl[w].z);
    const len = dir.length();
    if (len > 0.12) h.elbow = { dir: dir.divideScalar(len), len, t: now };
  }
}

// ───────── 카메라 미리보기 (거울 화면 + 인식된 뼈대) ─────────
const pv = $('#preview'), pctx = pv.getContext('2d');
function drawPreview() {
  $('#preview-box').classList.toggle('hidden', !settings.preview);
  if (!settings.preview) return;
  const v = tracker.video;
  const W = 320, H = Math.round(320 * v.videoHeight / v.videoWidth) || 180;
  if (pv.height !== H) pv.height = H;
  pctx.save();
  pctx.translate(W, 0); pctx.scale(-1, 1);
  pctx.drawImage(v, 0, 0, W, H);
  pctx.restore();
  pctx.lineWidth = 2.5;
  for (const s of ['L', 'R']) {
    const h = hands[s];
    if (!h.visible) continue;
    pctx.strokeStyle = s === 'L' ? '#2f8cff' : '#ff8a3d';
    pctx.fillStyle = '#fff';
    const P = i => [(1 - h.img[i].x) * W, h.img[i].y * H];
    pctx.beginPath();
    for (const [a, b] of BONES) { pctx.moveTo(...P(a)); pctx.lineTo(...P(b)); }
    pctx.stroke();
    for (let i = 0; i < 21; i++) { const [x, y] = P(i); pctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
    const [x, y] = P(0);
    pctx.font = 'bold 12px sans-serif'; pctx.fillStyle = pctx.strokeStyle;
    pctx.fillText(s === 'L' ? '왼손' : '오른손', x - 14, Math.min(H - 4, y + 16));
  }
}

// ───────── 스캔 결과 → 피부색·소매 ─────────
let scanToasted = {};
function applyProfiles() {
  const profs = [hands.R.profile, hands.L.profile];
  const withSkin = profs.filter(p => p.skin).sort((a, b) => (b.done ? 1 : 0) - (a.done ? 1 : 0));
  if (settings.tone === 'auto' && withSkin.length) {
    const c = withSkin[0].skin, key = c.map(v => Math.round(v / 4)).join(',');
    if (key !== lastSkinKey) { lastSkinKey = key; setSkinFromCamera(c); }
  }
  const sl = profs.find(p => p.sleeve && !p.sleeve.bare)?.sleeve ?? null;
  setSleeve(sl);
}

// ───────── HUD ─────────
let hudT = 0, fpsN = 0, fps = 0, fpsT = 0;
function updateHud(now) {
  fpsN++;
  if (now - fpsT > 1000) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; }
  if (now - hudT < 120) return;
  hudT = now;
  const n = (hands.L.visible ? 1 : 0) + (hands.R.visible ? 1 : 0);
  $('#status').textContent = [
    `손 ${n}개 인식`, `추적 ${tracker.rate}fps(${tracker.mode})`, `화면 ${fps}fps`,
    `화질 ${QUALITY_NAME[settings.quality] ?? '자동'}${settings.quality === 'auto' ? ` ${qLevel + 1}/5` : ''}`,
  ].join(' · ');
  for (const s of ['L', 'R']) {
    const h = hands[s], chip = $('#chip-' + s);
    // 손가락마다 판단한 상태 (펴짐 / 반쯤 / 접힘)
    const st = h.visible && h.pose ? [h.pose.thumb.state, ...h.pose.fingers.slice(1).map(f => f.state)] : null;
    const group = k => FINGER_NAME.filter((_, i) => st[i] === k).join('·');
    chip.querySelector('.g').textContent = !st ? '안 보임'
      : ['ext', 'half', 'fold'].filter(k => st.includes(k)).map(k => `${STATE_NAME[k]} ${group(k)}`).join('  ');
    chip.querySelector('.a').textContent = h.visible && !h.profile.done
      ? `🔍 손 스캔 ${Math.round(h.profile.progress * 100)}% — 손가락을 벌리고 손바닥을 카메라로` : (h.elbow ? '팔꿈치 인식됨' : '');
    chip.style.opacity = h.visible ? 1 : 0.55;
    if (h.profile.done && !scanToasted[s]) {
      scanToasted[s] = true;
      if (Object.keys(h.profile.samples).length) toast(`${s === 'L' ? '왼손' : '오른손'} 스캔 완료! 굵기·손톱·피부색을 내 손에 맞췄어요 ✋`, 2500);
    }
  }
  applyProfiles();
}

// ───────── 메인 루프 ─────────
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (playing && tracker.update(now)) onTracking(now);
  for (const s of ['L', 'R']) {
    const h = hands[s];
    h.updateDisplay(dt, now, lostMs());
    meshes?.[s].update(h.joints, h.local, h.pose, h.elbow, dt, h.profile, h.visible);
  }
  world.update(dt, STAND);
  if (playing) updateHud(now);
  autoQuality(now);
  if (LEVELS[qLevel].post) composer.render(); else renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// 디버그용
window.__handvr = { hands, get meshes() { return meshes; }, tracker, settings, scanner, scene, renderer };
