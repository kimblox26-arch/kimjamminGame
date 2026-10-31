// 웹캠 + MediaPipe 손 랜드마크 (+ 팔꿈치 위치용 몸 랜드마크)
// 기본은 Web Worker 에서 인식(화면 렌더링이 끊기지 않음). 워커가 안 되는 브라우저는 메인 스레드에서 인식.
// 라이브러리·모델은 CDN 에서 받는다. (?mp=…&models=… 로 로컬 경로, ?worker=0 으로 워커 끄기)
const MP_VERSION = '0.10.21';
const q = new URLSearchParams(location.search);
const MP_BASE = new URL(q.get('mp') || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`, location.href).href.replace(/\/$/, '');
const MODELS = q.get('models');
const HAND_URL = MODELS ? new URL(`${MODELS}/hand_landmarker.task`, location.href).href
  : 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const DELEGATES = q.get('delegate') === 'cpu' ? ['CPU'] : ['GPU', 'CPU'];
const POSE_URL = MODELS ? new URL(`${MODELS}/pose_landmarker_lite.task`, location.href).href
  : 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const POSE_OPTS = {
  runningMode: 'VIDEO', numPoses: 1,
  minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
};
export const IS_MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);

const HAND_OPTS = {
  runningMode: 'VIDEO', numHands: 2,
  minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4, // 빠르게 움직여도 덜 놓치게
};

export class Tracker {
  constructor(video) {
    this.video = video;
    this.hands = null;      // 메인 스레드 모드
    this.worker = null;     // 워커 모드
    this.workerReady = false;
    this.handResult = null;
    this.pose = null;        // 몸 인식 (팔꿈치) — 메인 스레드 모드
    this.poseLoaded = false; // 워커 모드에서 몸 인식 준비됨
    this.poseResult = null;  // { landmarks, worldLandmarks, t }
    this.sent = 0;
    this.lastTime = -1;
    this.frame = 0;
    this.rate = 0;
    this._cnt = 0;
    this._t0 = 0;
    this.delegate = '';
    this.interval = 33; // 평균 추적 간격(ms)
    this._lastNow = 0;
    this.busy = false;
    this.pending = null;
  }

  get ready() { return (!!this.hands || this.workerReady) && this.video.readyState >= 2 && this.video.videoWidth > 0; }
  get mode() { return this.workerReady ? '워커' : '메인'; }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error('이 브라우저는 카메라 API를 지원하지 않습니다'); e.name = 'NotSupportedError'; throw e;
    }
    // 폰은 해상도·프레임을 낮춰 인식을 가볍게
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: IS_MOBILE
        ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }
        : { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 60, max: 60 } },
    });
    this.video.srcObject = stream;
    await this.video.play();
    if (!this.video.videoWidth) await new Promise(r => this.video.addEventListener('loadedmetadata', r, { once: true }));
  }

  // ── 워커
  async startWorker() {
    const w = new Worker(new URL('./track-worker.js' + new URL(import.meta.url).search, import.meta.url), { type: 'module' });
    this.worker = w;
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('워커 응답 없음')), 30000);
      w.onmessage = ({ data }) => {
        if (data.type === 'ready') { clearTimeout(timer); this.delegate = data.delegate; resolve(); }
        else if (data.type === 'error') { clearTimeout(timer); reject(new Error(data.message)); }
      };
      w.onerror = e => { clearTimeout(timer); reject(new Error(e.message || '워커 오류')); };
    });
    w.postMessage({ type: 'init', base: MP_BASE, handUrl: HAND_URL, delegates: DELEGATES });
    await ready;
    w.onmessage = ({ data }) => {
      if (data.type === 'result') { this.pending = data; this.busy = false; }
      else if (data.type === 'poseReady') { this.poseLoaded = true; }
      else if (data.type === 'error') { if (data.where !== 'pose') this.busy = false; console.warn('[HandVR] 인식 오류', data.message); }
    };
    this.workerReady = true;
  }

  vision() {
    this._vision ??= (async () => {
      const mod = await import(`${MP_BASE}/vision_bundle.mjs`);
      const fileset = await mod.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      return { mod, fileset };
    })();
    return this._vision;
  }

  async loadHands() {
    if (q.get('worker') !== '0' && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
      try { await this.startWorker(); return; } catch (e) {
        console.warn('[HandVR] 워커 인식 실패 → 메인 스레드로', e);
        this.worker?.terminate(); this.worker = null; this.workerReady = false;
      }
    }
    const { mod, fileset } = await this.vision();
    this.hands = await create(mod.HandLandmarker, fileset, { ...HAND_OPTS, baseOptions: { modelAssetPath: HAND_URL } }, d => { this.delegate = d; });
  }

  // 팔꿈치 위치용 몸 인식 (손 인식이 준비된 뒤 뒤에서 불러옴, 실패해도 손은 그대로 동작)
  async loadPose() {
    if (this.workerReady) { this.worker.postMessage({ type: 'pose', poseUrl: POSE_URL, delegates: DELEGATES }); return; }
    const { mod, fileset } = await this.vision();
    this.pose = await create(mod.PoseLandmarker, fileset, { ...POSE_OPTS, baseOptions: { modelAssetPath: POSE_URL } }, () => {});
  }

  stat(now) {
    this.frame++;
    if (this._lastNow) this.interval += (Math.min(1000, now - this._lastNow) - this.interval) * 0.25;
    this._lastNow = now;
    this._cnt++;
    if (now - this._t0 > 1000) { this.rate = Math.round(this._cnt * 1000 / (now - this._t0)); this._cnt = 0; this._t0 = now; }
  }

  // 새 인식 결과가 생기면 true
  update(now) {
    const v = this.video;
    if (!this.ready) return false;
    if (this.workerReady) {
      let fresh = false;
      if (this.pending) {
        this.handResult = this.pending.hand;
        if (this.pending.pose) this.poseResult = { ...this.pending.pose, t: now };
        this.pending = null;
        this.stat(now);
        fresh = true;
      }
      // 워커가 쉬고 있고 새 카메라 프레임이 있으면 보낸다 (밀리지 않게 한 장씩)
      if (!this.busy && v.currentTime !== this.lastTime) {
        this.lastTime = v.currentTime;
        this.busy = true;
        const w = Math.min(640, v.videoWidth), h = Math.round(w * v.videoHeight / v.videoWidth);
        const pose = this.poseLoaded && this.sent++ % 2 === 0; // 몸 인식은 격 프레임
        const send = bmp => this.worker.postMessage({ type: 'frame', bitmap: bmp, t: performance.now(), pose }, [bmp]);
        createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
          .catch(() => createImageBitmap(v))
          .then(send)
          .catch(() => { this.busy = false; });
      }
      return fresh;
    }
    if (v.currentTime === this.lastTime) return false;
    this.lastTime = v.currentTime;
    this.handResult = this.hands.detectForVideo(v, now);
    if (this.pose && this.frame % 2 === 0) {
      const p = this.pose.detectForVideo(v, now);
      this.poseResult = { landmarks: p.landmarks, worldLandmarks: p.worldLandmarks, t: now };
    }
    this.stat(now);
    return true;
  }
}

async function create(Cls, fileset, opts, onDelegate) {
  for (const delegate of DELEGATES) {
    try {
      const task = await Cls.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate } });
      onDelegate(delegate);
      return task;
    } catch (e) {
      if (delegate === DELEGATES[DELEGATES.length - 1]) throw e;
      console.warn('[HandVR] GPU 추론 실패 → CPU 로 전환', e);
    }
  }
}
