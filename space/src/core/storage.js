// ORBITER — 저장소
// localStorage 위에 얹은 버전 관리형 세이브 시스템.
// 설계도, 세이브 슬롯, 설정, 진행도, 통계를 다룬다.

const NS = 'orbiter';
const SCHEMA_VERSION = 3;

function key(...parts) {
  return [NS, ...parts].join(':');
}

/** localStorage 가용성 검사 (프라이빗 모드/차단 대응) */
function probeStorage() {
  try {
    const k = key('__probe');
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

/** 메모리 폴백 저장소 */
class MemoryStore {
  constructor() {
    this.map = new Map();
  }

  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }

  setItem(k, v) {
    this.map.set(k, String(v));
  }

  removeItem(k) {
    this.map.delete(k);
  }

  key(i) {
    return [...this.map.keys()][i] ?? null;
  }

  get length() {
    return this.map.size;
  }
}

export const storageAvailable = probeStorage();
const store = storageAvailable ? localStorage : new MemoryStore();

if (!storageAvailable) {
  console.warn('[storage] localStorage 사용 불가 — 메모리 저장으로 대체합니다.');
}

/* ──────────────────────────────────────────────────────────────
 * 저수준 읽기/쓰기
 * ────────────────────────────────────────────────────────────── */

export function readJSON(k, fallback = null) {
  try {
    const raw = store.getItem(key(k));
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[storage] "${k}" 파싱 실패`, e);
    return fallback;
  }
}

export function writeJSON(k, value) {
  try {
    store.setItem(key(k), JSON.stringify(value));
    return true;
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') {
      console.error('[storage] 저장 공간 부족 — 오래된 자동저장을 정리합니다.');
      pruneAutosaves(2);
      try {
        store.setItem(key(k), JSON.stringify(value));
        return true;
      } catch (e2) {
        /* 포기 */
      }
    }
    console.error(`[storage] "${k}" 저장 실패`, e);
    return false;
  }
}

export function removeKey(k) {
  try {
    store.removeItem(key(k));
    return true;
  } catch (e) {
    return false;
  }
}

/** 네임스페이스 하위의 모든 키 나열 */
export function listKeys(prefix = '') {
  const out = [];
  const full = key(prefix);
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(full)) out.push(k.slice(NS.length + 1));
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────
 * 설정
 * ────────────────────────────────────────────────────────────── */

export const DEFAULT_SETTINGS = {
  version: SCHEMA_VERSION,
  graphics: {
    quality: 'auto', // auto | low | medium | high
    particles: 1.0,
    bloom: true,
    starfield: true,
    showTrajectoryPrediction: true,
    trajectorySamples: 360,
    screenShake: 1.0,
    uiScale: 1.0,
    showFps: false,
    reduceMotion: false,
  },
  audio: {
    master: 0.8,
    sfx: 0.9,
    music: 0.5,
    ui: 0.7,
    muteOnBlur: true,
  },
  gameplay: {
    difficulty: 'normal', // sandbox | easy | normal | hard | realistic
    partFailures: false,
    infiniteFuel: false,
    indestructible: false,
    reentryHeat: true,
    atmosphericDrag: true,
    autoStagePrompt: true,
    showTutorialHints: true,
    unitSystem: 'metric',
    language: 'ko',
  },
  cheats: {
    infiniteFuel: false,
    infinitePower: false,
    noGravity: false,
    noDrag: false,
    unbreakable: false,
    partClipping: false,
    unlockAllParts: false,
    freeBuild: false,
    everUsed: false,
  },
  controls: {
    bindings: null, // null 이면 기본값
    invertPitch: false,
    controlSensitivity: 1.0,
    touchControls: 'auto', // auto | on | off
    gamepadEnabled: true,
  },
  camera: {
    followRotation: false,
    smoothing: 0.85,
    defaultZoom: 1,
    autoZoom: true,
  },
};

export function loadSettings() {
  const saved = readJSON('settings', null);
  const merged = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (saved && typeof saved === 'object') {
    deepAssign(merged, saved);
    merged.version = SCHEMA_VERSION;
  }
  return merged;
}

export function saveSettings(settings) {
  return writeJSON('settings', settings);
}

export function resetSettings() {
  removeKey('settings');
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function deepAssign(target, src) {
  for (const k in src) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      deepAssign(target[k], v);
    } else if (v !== undefined) {
      target[k] = v;
    }
  }
  return target;
}

/* ──────────────────────────────────────────────────────────────
 * 설계도(블루프린트) 라이브러리
 * ────────────────────────────────────────────────────────────── */

const BP_INDEX = 'blueprints:index';

export function listBlueprints() {
  const index = readJSON(BP_INDEX, []);
  return Array.isArray(index) ? index : [];
}

export function saveBlueprint(blueprint) {
  if (!blueprint || !blueprint.name) return null;
  const index = listBlueprints();
  const id = blueprint.id || `bp_${Date.now().toString(36)}`;
  blueprint.id = id;
  blueprint.savedAt = Date.now();
  blueprint.version = SCHEMA_VERSION;

  const ok = writeJSON(`blueprints:${id}`, blueprint);
  if (!ok) return null;

  const meta = {
    id,
    name: blueprint.name,
    savedAt: blueprint.savedAt,
    partCount: blueprint.parts?.length ?? 0,
    mass: blueprint.stats?.mass ?? 0,
    stages: blueprint.stats?.stages ?? 0,
    deltaV: blueprint.stats?.deltaV ?? 0,
    thumb: blueprint.thumb || null,
  };
  const i = index.findIndex((e) => e.id === id);
  if (i >= 0) index[i] = meta;
  else index.push(meta);
  writeJSON(BP_INDEX, index);
  return id;
}

export function loadBlueprint(id) {
  return readJSON(`blueprints:${id}`, null);
}

export function deleteBlueprint(id) {
  removeKey(`blueprints:${id}`);
  const index = listBlueprints().filter((e) => e.id !== id);
  writeJSON(BP_INDEX, index);
  return true;
}

export function renameBlueprint(id, name) {
  const bp = loadBlueprint(id);
  if (!bp) return false;
  bp.name = name;
  saveBlueprint(bp);
  return true;
}

export function duplicateBlueprint(id) {
  const bp = loadBlueprint(id);
  if (!bp) return null;
  const copy = JSON.parse(JSON.stringify(bp));
  copy.id = null;
  copy.name = `${bp.name} 사본`;
  return saveBlueprint(copy);
}

/** 설계도 JSON 파일 내보내기 */
export function exportBlueprintFile(blueprint) {
  const data = JSON.stringify(blueprint, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(blueprint.name || 'craft').replace(/[^\w가-힣-]+/g, '_')}.orbiter.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 설계도 JSON 파일 불러오기 */
export function importBlueprintFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (!obj.parts || !Array.isArray(obj.parts))
          throw new Error('설계도 형식이 아닙니다');
        obj.id = null;
        resolve(obj);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsText(file);
  });
}

/* ──────────────────────────────────────────────────────────────
 * 세이브 슬롯 (비행 상태)
 * ────────────────────────────────────────────────────────────── */

const SAVE_INDEX = 'saves:index';
export const QUICKSAVE_ID = 'quicksave';
export const AUTOSAVE_PREFIX = 'auto_';

export function listSaves() {
  const index = readJSON(SAVE_INDEX, []);
  return Array.isArray(index) ? index.sort((a, b) => b.savedAt - a.savedAt) : [];
}

export function writeSave(id, data, label = null) {
  data.savedAt = Date.now();
  data.version = SCHEMA_VERSION;
  const ok = writeJSON(`saves:${id}`, data);
  if (!ok) return false;
  const index = listSaves();
  const meta = {
    id,
    label: label || data.label || id,
    savedAt: data.savedAt,
    missionTime: data.missionTime ?? 0,
    body: data.bodyName ?? '',
    situation: data.situation ?? '',
    craftName: data.craftName ?? '',
  };
  const i = index.findIndex((e) => e.id === id);
  if (i >= 0) index[i] = meta;
  else index.push(meta);
  writeJSON(SAVE_INDEX, index);
  return true;
}

export function readSave(id) {
  return readJSON(`saves:${id}`, null);
}

export function deleteSave(id) {
  removeKey(`saves:${id}`);
  writeJSON(
    SAVE_INDEX,
    listSaves().filter((e) => e.id !== id)
  );
  return true;
}

/** 자동저장 — 최근 N개만 유지 */
export function autosave(data, keep = 5) {
  const id = `${AUTOSAVE_PREFIX}${Date.now().toString(36)}`;
  writeSave(id, data, '자동 저장');
  pruneAutosaves(keep);
  return id;
}

export function pruneAutosaves(keep = 5) {
  const autos = listSaves().filter((s) => s.id.startsWith(AUTOSAVE_PREFIX));
  if (autos.length <= keep) return 0;
  const remove = autos.slice(keep);
  for (const s of remove) deleteSave(s.id);
  return remove.length;
}

/* ──────────────────────────────────────────────────────────────
 * 진행도 / 업적 / 통계
 * ────────────────────────────────────────────────────────────── */

export const DEFAULT_PROGRESS = {
  version: SCHEMA_VERSION,
  funds: 120000,
  science: 0,
  reputation: 0,
  unlockedParts: [],
  unlockedTech: ['start'],
  completedMissions: [],
  achievements: [],
  visitedBodies: [],
  landedBodies: [],
  orbitedBodies: [],
  records: {
    maxAltitude: 0,
    maxSpeed: 0,
    maxG: 0,
    longestFlight: 0,
    farthestDistance: 0,
    totalFlights: 0,
    totalLaunches: 0,
    totalCrashes: 0,
    totalLandings: 0,
    totalDockings: 0,
    totalFuelBurned: 0,
    totalDistanceTravelled: 0,
    totalTimeWarped: 0,
  },
};

export function loadProgress() {
  const saved = readJSON('progress', null);
  const merged = JSON.parse(JSON.stringify(DEFAULT_PROGRESS));
  if (saved) deepAssign(merged, saved);
  return merged;
}

export function saveProgress(p) {
  return writeJSON('progress', p);
}

export function resetProgress() {
  removeKey('progress');
  return JSON.parse(JSON.stringify(DEFAULT_PROGRESS));
}

/** 기록 갱신 — 더 큰 값일 때만 저장 */
export function updateRecord(progress, name, value) {
  if (!(name in progress.records)) {
    progress.records[name] = value;
    return true;
  }
  if (value > progress.records[name]) {
    progress.records[name] = value;
    return true;
  }
  return false;
}

/** 누적 기록 증가 */
export function addRecord(progress, name, value = 1) {
  progress.records[name] = (progress.records[name] || 0) + value;
}

/* ──────────────────────────────────────────────────────────────
 * 전체 백업 / 복원
 * ────────────────────────────────────────────────────────────── */

export function exportAll() {
  const dump = { version: SCHEMA_VERSION, exportedAt: Date.now(), data: {} };
  for (const k of listKeys('')) dump.data[k] = readJSON(k, null);
  return dump;
}

export function importAll(dump, { overwrite = true } = {}) {
  if (!dump || !dump.data) throw new Error('잘못된 백업 형식');
  let count = 0;
  for (const k in dump.data) {
    if (!overwrite && readJSON(k, null) !== null) continue;
    if (writeJSON(k, dump.data[k])) count++;
  }
  return count;
}

export function wipeAll() {
  for (const k of listKeys('')) removeKey(k);
}

/** 저장소 사용량(대략, 바이트) */
export function storageUsage() {
  let bytes = 0;
  for (const k of listKeys('')) {
    const raw = store.getItem(key(k));
    if (raw) bytes += raw.length * 2;
  }
  return bytes;
}
