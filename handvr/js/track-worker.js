// 손·몸 인식(MediaPipe)을 메인 스레드 밖에서 돌린다 → 인식하는 동안에도 화면이 끊기지 않는다.
// 메인에서 카메라 프레임(ImageBitmap)을 받아 결과(관절 좌표)만 돌려준다.

// MediaPipe 는 워커에서 importScripts 로 wasm 로더를 읽는데, 모듈 워커에는 importScripts 가 없어서 대신 만들어 준다.
self.importScripts = (...urls) => {
  for (const url of urls) {
    const x = new XMLHttpRequest();
    x.open('GET', url, false);
    x.send();
    if (x.status >= 400) throw new Error(`불러오기 실패 ${x.status}: ${url}`);
    (0, eval)(x.responseText); // 전역 범위에서 실행 (var ModuleFactory 가 전역이 되도록)
  }
};

let vision = null, fileset = null, hands = null, pose = null;

async function create(Cls, opts, delegates) {
  let last;
  for (const delegate of delegates) {
    try {
      const task = await Cls.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate } });
      return { task, delegate };
    } catch (e) { last = e; }
  }
  throw last;
}

const plain = list => (list || []).map(arr => arr.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility })));

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      vision = await import(`${m.base}/vision_bundle.mjs`);
      fileset = await vision.FilesetResolver.forVisionTasks(`${m.base}/wasm`);
      const r = await create(vision.HandLandmarker, {
        baseOptions: { modelAssetPath: m.handUrl },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      }, m.delegates);
      hands = r.task;
      self.postMessage({ type: 'ready', delegate: r.delegate });
    } else if (m.type === 'pose') {
      if (!pose) {
        pose = (await create(vision.PoseLandmarker, {
          baseOptions: { modelAssetPath: m.poseUrl },
          runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        }, m.delegates)).task;
      }
      self.postMessage({ type: 'poseReady' });
    } else if (m.type === 'frame') {
      const r = hands.detectForVideo(m.bitmap, m.t);
      const p = m.pose && pose ? pose.detectForVideo(m.bitmap, m.t) : null;
      m.bitmap.close();
      const hd = r.handedness || r.handednesses || [];
      self.postMessage({
        type: 'result',
        hand: {
          landmarks: plain(r.landmarks),
          worldLandmarks: plain(r.worldLandmarks),
          handedness: hd.map(c => c.map(x => ({ categoryName: x.categoryName, score: x.score }))),
        },
        pose: p ? { landmarks: plain(p.landmarks) } : null,
      });
    }
  } catch (e) {
    m.bitmap?.close?.();
    self.postMessage({ type: 'error', where: m.type, message: String(e?.message || e) });
  }
};
