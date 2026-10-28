// 웹캠 + MediaPipe(손/몸 랜드마크) 래퍼
// 라이브러리·모델은 CDN 에서 받는다. (?mp=…&models=… 로 로컬 경로 지정 가능)
const MP_VERSION = '0.10.21';
const q = new URLSearchParams(location.search);
const MP_BASE = q.get('mp') || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODELS = q.get('models');
const HAND_URL = MODELS ? `${MODELS}/hand_landmarker.task`
  : 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_URL = MODELS ? `${MODELS}/pose_landmarker_lite.task`
  : 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export class Tracker {
  constructor(video) {
    this.video = video;
    this.hands = null;
    this.pose = null;
    this.poseOn = false;
    this.handResult = null;
    this.poseResult = null;
    this.lastTime = -1;
    this.frame = 0;
    this.rate = 0;
    this._cnt = 0;
    this._t0 = 0;
    this.delegate = '';
    this.interval = 33; // 평균 추적 간격(ms)
    this._lastNow = 0;
  }

  get ready() { return !!this.hands && this.video.readyState >= 2 && this.video.videoWidth > 0; }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error('이 브라우저는 카메라 API를 지원하지 않습니다'); e.name = 'NotSupportedError'; throw e;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 60, max: 60 } },
    });
    this.video.srcObject = stream;
    await this.video.play();
    if (!this.video.videoWidth) await new Promise(r => this.video.addEventListener('loadedmetadata', r, { once: true }));
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
    const { mod, fileset } = await this.vision();
    this.hands = await create(mod.HandLandmarker, fileset, {
      baseOptions: { modelAssetPath: HAND_URL },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }, d => { this.delegate = d; });
  }

  async loadPose() {
    if (this.pose) return;
    const { mod, fileset } = await this.vision();
    this.pose = await create(mod.PoseLandmarker, fileset, {
      baseOptions: { modelAssetPath: POSE_URL },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }, () => {});
  }

  // 새 카메라 프레임이 있을 때만 추론. 새 결과가 생기면 true
  update(now) {
    const v = this.video;
    if (!this.ready || v.currentTime === this.lastTime) return false;
    this.lastTime = v.currentTime;
    this.handResult = this.hands.detectForVideo(v, now);
    // 몸 추적은 격 프레임으로 (부하 절반)
    if (this.poseOn && this.pose && (this.frame & 1) === 0) this.poseResult = this.pose.detectForVideo(v, now);
    this.frame++;
    if (this._lastNow) this.interval += (Math.min(1000, now - this._lastNow) - this.interval) * 0.25;
    this._lastNow = now;
    this._cnt++;
    if (now - this._t0 > 1000) { this.rate = Math.round(this._cnt * 1000 / (now - this._t0)); this._cnt = 0; this._t0 = now; }
    return true;
  }
}

async function create(Cls, fileset, opts, onDelegate) {
  const list = q.get('delegate') === 'cpu' ? ['CPU'] : ['GPU', 'CPU'];
  for (const delegate of list) {
    try {
      const task = await Cls.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate } });
      onDelegate(delegate);
      return task;
    } catch (e) {
      if (delegate === 'CPU') throw e;
      console.warn('[HandVR] GPU 추론 실패 → CPU 로 전환', e);
    }
  }
}
