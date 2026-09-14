// ORBITER — 기체(Craft) 모델
//
// 설계실에서 다루는 정적 구조. 부품 배치, 결합, 스테이징, 질량 특성,
// 그리고 단별 Δv 해석을 담당한다. 비행 중 상태는 flight/vessel.js 가 맡는다.
//
// 좌표: 기체 로컬 미터, 원점은 루트 부품 중심, +y 가 위(로켓 진행 방향).

import {
  Vec2,
  clamp,
  sum,
  TAU,
} from '../core/math.js';
import { G0, RESOURCES, LF_OX_RATIO } from '../physics/constants.js';
import {
  PART_BY_ID,
  resourceMass,
  partTotalCost,
  sizesCompatible,
} from './partdefs.js';
import { buildStages } from '../flight/staging.js';

let _uid = 1;
export const nextUid = () => `p${(_uid++).toString(36)}`;

/**
 * 배치된 부품 하나.
 */
export class CraftPart {
  constructor(defId, x = 0, y = 0, opts = {}) {
    const def = PART_BY_ID.get(defId);
    if (!def) throw new Error(`알 수 없는 부품: ${defId}`);
    this.uid = opts.uid || nextUid();
    this.defId = defId;
    this.def = def;
    this.x = x;
    this.y = y;
    /** 측면 부착 시 좌/우 반전 */
    this.mirrored = opts.mirrored ?? false;
    /** 회전 (rad) — 측면 부품이 바깥쪽을 향하도록 */
    this.rot = opts.rot ?? 0;
    /** 스테이지 인덱스 (0 = 가장 먼저 점화/분리) */
    this.stage = opts.stage ?? 0;
    /** 부모 부품 uid (결합 트리) */
    this.parentUid = opts.parentUid ?? null;
    /** 어느 노드로 붙었는지 */
    this.attachNode = opts.attachNode ?? null;
    /** 자원 현재량 — 정의값에서 복사 */
    this.resources = {};
    if (def.fuel) {
      for (const k in def.fuel) this.resources[k] = def.fuel[k];
    }
    /** 탱크 비우기(핵열 엔진용 산화제 제거 등) */
    this.disabledResources = new Set(opts.disabledResources ?? []);
    /** 사용자 지정 이름 */
    this.label = opts.label ?? null;
    /** 심볼 대칭 그룹 */
    this.symmetryGroup = opts.symmetryGroup ?? null;
    /** 크기 조절 — 1 이 기본. 탱크·구조물은 자유롭게 늘릴 수 있다 */
    this.scaleW = opts.scaleW ?? 1;
    this.scaleH = opts.scaleH ?? 1;
    /** 사용자 도색 (hex) */
    this.tint = opts.tint ?? null;
  }

  get width() {
    return this.def.size.w * this.scaleW;
  }

  get height() {
    return this.def.size.h * this.scaleH;
  }

  /**
   * 부피 배율. 2D 로 그리지만 실제로는 원통이므로 지름의 제곱에 비례한다.
   * 질량·연료용량·비용이 전부 이 값을 따른다.
   */
  get sizeFactor() {
    return this.scaleW * this.scaleW * this.scaleH;
  }

  /** 추력·항력 배율 — 노즐/단면적은 지름의 제곱 */
  get areaFactor() {
    return this.scaleW * this.scaleW;
  }

  /** 건조질량 */
  get dryMass() {
    return this.def.mass * this.sizeFactor;
  }

  /** 현재 자원 질량 */
  get resourceMass() {
    let m = 0;
    for (const k in this.resources) {
      if (this.disabledResources.has(k)) continue;
      const r = RESOURCES[k];
      if (r) m += this.resources[k] * r.density;
    }
    return m;
  }

  get mass() {
    return this.dryMass + this.resourceMass;
  }

  /** 최대 자원량 */
  maxResource(key) {
    return (this.def.fuel?.[key] ?? 0) * this.sizeFactor;
  }

  /** 자원 비율 */
  resourceFraction(key) {
    const max = this.maxResource(key);
    return max > 0 ? (this.resources[key] ?? 0) / max : 0;
  }

  /** 자원 채우기 */
  fill(fraction = 1) {
    if (!this.def.fuel) return;
    for (const k in this.def.fuel) {
      this.resources[k] = this.disabledResources.has(k)
        ? 0
        : this.maxResource(k) * fraction;
    }
  }

  /**
   * 크기를 바꾼다. 자원은 비율을 유지한 채 새 용량에 맞춰 다시 채워진다.
   */
  setScale(sw, sh) {
    const fracs = {};
    for (const k in this.resources) fracs[k] = this.resourceFraction(k);
    this.scaleW = clamp(sw, 0.25, 6);
    this.scaleH = clamp(sh, 0.25, 8);
    for (const k in this.resources) {
      this.resources[k] = this.maxResource(k) * (fracs[k] ?? 0);
    }
  }

  /** 노드의 기체 좌표 위치 — 크기 조절을 반영한다 */
  nodeWorldPos(node) {
    const nx = node.x * this.scaleW;
    const ny = node.y * this.scaleH;
    const mx = this.mirrored ? -nx : nx;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    return new Vec2(
      this.x + mx * c - ny * s,
      this.y + mx * s + ny * c
    );
  }

  /** 크기 조절된 결합 노드 목록 */
  scaledNodes() {
    return (this.def.nodes ?? []).map((n) => ({
      ...n,
      x: n.x * this.scaleW,
      y: n.y * this.scaleH,
      size: n.size,
    }));
  }

  /** 바운딩 박스 */
  bounds() {
    const hw = this.width / 2;
    const hh = this.height / 2;
    const c = Math.abs(Math.cos(this.rot));
    const s = Math.abs(Math.sin(this.rot));
    const ew = hw * c + hh * s;
    const eh = hw * s + hh * c;
    return {
      minX: this.x - ew,
      maxX: this.x + ew,
      minY: this.y - eh,
      maxY: this.y + eh,
    };
  }

  /** 해면/진공 추력 */
  thrustAt(pressureAtm) {
    const e = this.def.engine;
    if (!e) return 0;
    const t = clamp(pressureAtm, 0, 1.6);
    return (e.thrust + (e.thrustSL - e.thrust) * Math.min(t, 1)) * this.areaFactor;
  }

  /** 해면/진공 비추력 */
  ispAt(pressureAtm) {
    const e = this.def.engine;
    if (!e) return 0;
    const t = clamp(pressureAtm, 0, 1.6);
    return e.isp + (e.ispSL - e.isp) * Math.min(t, 1);
  }

  clone(opts = {}) {
    const p = new CraftPart(this.defId, this.x, this.y, {
      mirrored: this.mirrored,
      rot: this.rot,
      stage: this.stage,
      parentUid: this.parentUid,
      attachNode: this.attachNode,
      disabledResources: [...this.disabledResources],
      label: this.label,
      scaleW: this.scaleW,
      scaleH: this.scaleH,
      tint: this.tint,
      ...opts,
    });
    for (const k in this.resources) p.resources[k] = this.resources[k];
    return p;
  }

  toJSON() {
    return {
      uid: this.uid,
      defId: this.defId,
      x: +this.x.toFixed(4),
      y: +this.y.toFixed(4),
      rot: +this.rot.toFixed(4),
      mirrored: this.mirrored,
      stage: this.stage,
      parentUid: this.parentUid,
      attachNode: this.attachNode,
      disabled: [...this.disabledResources],
      label: this.label,
      symmetryGroup: this.symmetryGroup,
      sw: this.scaleW === 1 ? undefined : +this.scaleW.toFixed(3),
      sh: this.scaleH === 1 ? undefined : +this.scaleH.toFixed(3),
      tint: this.tint ?? undefined,
    };
  }

  static fromJSON(o) {
    const p = new CraftPart(o.defId, o.x, o.y, {
      uid: o.uid,
      rot: o.rot,
      mirrored: o.mirrored,
      stage: o.stage,
      parentUid: o.parentUid,
      attachNode: o.attachNode,
      disabledResources: o.disabled,
      label: o.label,
      symmetryGroup: o.symmetryGroup,
      scaleW: o.sw ?? 1,
      scaleH: o.sh ?? 1,
      tint: o.tint ?? null,
    });
    return p;
  }
}

/**
 * 기체 전체.
 */
export class Craft {
  constructor(name = '새 기체') {
    this.name = name;
    /** @type {CraftPart[]} */
    this.parts = [];
    this.rootUid = null;
    this.description = '';
    this.id = null;
    this._statsCache = null;
  }

  /* ── 부품 조작 ──────────────────────────────────────── */

  add(part) {
    this.parts.push(part);
    if (!this.rootUid) this.rootUid = part.uid;
    this._statsCache = null;
    return part;
  }

  addDef(defId, x, y, opts) {
    return this.add(new CraftPart(defId, x, y, opts));
  }

  remove(uid) {
    const idx = this.parts.findIndex((p) => p.uid === uid);
    if (idx < 0) return false;
    // 자식들도 함께 제거
    const toRemove = new Set([uid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of this.parts) {
        if (p.parentUid && toRemove.has(p.parentUid) && !toRemove.has(p.uid)) {
          toRemove.add(p.uid);
          changed = true;
        }
      }
    }
    this.parts = this.parts.filter((p) => !toRemove.has(p.uid));
    if (toRemove.has(this.rootUid)) {
      this.rootUid = this.parts.length ? this.parts[0].uid : null;
    }
    this._statsCache = null;
    return toRemove.size;
  }

  get(uid) {
    return this.parts.find((p) => p.uid === uid) ?? null;
  }

  get root() {
    return this.get(this.rootUid);
  }

  get isEmpty() {
    return this.parts.length === 0;
  }

  clear() {
    this.parts.length = 0;
    this.rootUid = null;
    this._statsCache = null;
  }

  /** 자식 부품 목록 */
  childrenOf(uid) {
    return this.parts.filter((p) => p.parentUid === uid);
  }

  /** 특정 부품 이하의 서브트리 */
  subtree(uid) {
    const out = [];
    const walk = (id) => {
      const p = this.get(id);
      if (!p) return;
      out.push(p);
      for (const c of this.childrenOf(id)) walk(c.uid);
    };
    walk(uid);
    return out;
  }

  /** 부품 이동 (서브트리 포함) */
  /**
   * 부품 크기가 바뀐 뒤, 그 위에 쌓인 부품들을 함께 올려 틈이 생기지 않게 한다.
   * @param {CraftPart} part  크기가 바뀐 부품
   * @param {number} dTop     윗면이 이동한 거리
   */
  reflowAfterResize(part, dTop) {
    if (!dTop || Math.abs(dTop) < 1e-6) return;
    for (const c of this.subtree(part.uid)) {
      if (c.uid === part.uid) continue;
      // 위쪽에 붙은 것만 따라 올린다 (측면 부스터는 제자리)
      if (c.y > part.y) c.y += dTop;
    }
    this._statsCache = null;
  }

  movePart(uid, dx, dy) {
    for (const p of this.subtree(uid)) {
      p.x += dx;
      p.y += dy;
    }
    this._statsCache = null;
  }

  /* ── 결합점 탐색 ────────────────────────────────────── */

  /**
   * 주어진 좌표에 부품을 놓으려 할 때 가장 가까운 결합점을 찾는다.
   * @returns {{part:CraftPart, node:object, pos:Vec2, myNode:object, distance:number}|null}
   */
  findSnap(defId, x, y, maxDistance = 0.6) {
    const def = PART_BY_ID.get(defId);
    if (!def) return null;
    let best = null;
    let bestD = maxDistance;

    const myNodes = def.nodes ?? [];
    for (const target of this.parts) {
      const tNodes = target.def.nodes ?? [];
      for (const tn of tNodes) {
        const tp = target.nodeWorldPos(tn);
        // 이미 점유된 노드인가
        if (this._nodeOccupied(target, tn)) continue;
        for (const mn of myNodes) {
          if (!this._nodesCompatible(tn, mn)) continue;
          // 내 노드가 대상 노드에 닿도록 배치했을 때 부품 중심
          const cx = tp.x - mn.x;
          const cy = tp.y - mn.y;
          const d = Math.hypot(cx - x, cy - y);
          if (d < bestD) {
            bestD = d;
            best = {
              part: target,
              node: tn,
              myNode: mn,
              pos: new Vec2(cx, cy),
              distance: d,
            };
          }
        }
      }

      // 측면 부착 (radialAttach)
      if (target.def.radialAttach && (def.radialOnly || def.radialAttach)) {
        const hw = target.width / 2;
        const sideX = [target.x - hw, target.x + hw];
        for (const sx of sideX) {
          const clampedY = clamp(
            y,
            target.y - target.height / 2 + def.size.h / 2,
            target.y + target.height / 2 - def.size.h / 2
          );
          const isLeft = sx < target.x;
          const offset = def.size.w / 2;
          const cx = sx + (isLeft ? -offset : offset);
          const d = Math.hypot(cx - x, clampedY - y);
          if (d < bestD) {
            bestD = d;
            best = {
              part: target,
              node: { x: isLeft ? -hw : hw, y: clampedY - target.y, dir: 'side', size: 'micro' },
              myNode: { x: isLeft ? offset : -offset, y: 0, dir: 'side' },
              pos: new Vec2(cx, clampedY),
              distance: d,
              radial: true,
              mirrored: !isLeft,
            };
          }
        }
      }
    }
    return best;
  }

  _nodesCompatible(a, b) {
    if (a.dir === 'top' && b.dir !== 'bottom') return false;
    if (a.dir === 'bottom' && b.dir !== 'top') return false;
    if (a.dir === 'side' && b.dir !== 'side') return false;
    return sizesCompatible(a.size ?? 'small', b.size ?? 'small');
  }

  _nodeOccupied(part, node) {
    const np = part.nodeWorldPos(node);
    for (const other of this.parts) {
      if (other === part) continue;
      if (other.parentUid !== part.uid && part.parentUid !== other.uid) continue;
      for (const on of other.def.nodes ?? []) {
        const op = other.nodeWorldPos(on);
        if (Math.hypot(op.x - np.x, op.y - np.y) < 0.05) return true;
      }
    }
    return false;
  }

  /** 부품끼리 겹치는가 (배치 검증) */
  overlaps(defId, x, y, ignoreUid = null) {
    const def = PART_BY_ID.get(defId);
    if (!def) return false;
    const hw = def.size.w / 2;
    const hh = def.size.h / 2;
    const pad = 0.02;
    for (const p of this.parts) {
      if (p.uid === ignoreUid) continue;
      if (p.def.radialOnly || def.radialOnly) continue; // 측면 부품은 겹침 허용
      const b = p.bounds();
      if (
        x + hw - pad > b.minX &&
        x - hw + pad < b.maxX &&
        y + hh - pad > b.minY &&
        y - hh + pad < b.maxY
      ) {
        return true;
      }
    }
    return false;
  }

  /* ── 대칭 배치 ──────────────────────────────────────── */

  /**
   * 좌우 대칭으로 부품을 복제한다.
   * @returns 생성된 부품
   */
  mirrorPart(uid) {
    const src = this.get(uid);
    if (!src) return null;
    const parent = src.parentUid ? this.get(src.parentUid) : null;
    const axis = parent ? parent.x : 0;
    const nx = axis - (src.x - axis);
    const copy = src.clone({
      uid: nextUid(),
      mirrored: !src.mirrored,
      symmetryGroup: src.symmetryGroup || src.uid,
    });
    copy.x = nx;
    copy.rot = -src.rot;
    src.symmetryGroup = copy.symmetryGroup;
    this.add(copy);
    return copy;
  }

  /** 대칭 그룹 전체 제거 */
  removeSymmetryGroup(uid) {
    const src = this.get(uid);
    if (!src) return 0;
    const group = src.symmetryGroup;
    if (!group) return this.remove(uid);
    let n = 0;
    for (const p of [...this.parts]) {
      if (p.symmetryGroup === group) n += this.remove(p.uid) || 0;
    }
    return n;
  }

  /* ── 질량 특성 ──────────────────────────────────────── */

  /** 총질량 (kg) */
  get totalMass() {
    return sum(this.parts, (p) => p.mass);
  }

  /** 건조질량 */
  get dryMass() {
    return sum(this.parts, (p) => p.dryMass);
  }

  /** 추진제 질량 */
  get propellantMass() {
    return sum(this.parts, (p) => p.resourceMass);
  }

  /** 무게중심 (기체 좌표) */
  centerOfMass() {
    let mx = 0;
    let my = 0;
    let m = 0;
    for (const p of this.parts) {
      const pm = p.mass;
      mx += p.x * pm;
      my += p.y * pm;
      m += pm;
    }
    return m > 0 ? new Vec2(mx / m, my / m) : new Vec2(0, 0);
  }

  /** 건조 상태 무게중심 (연료 소진 후) */
  dryCenterOfMass() {
    let mx = 0;
    let my = 0;
    let m = 0;
    for (const p of this.parts) {
      const pm = p.dryMass;
      mx += p.x * pm;
      my += p.y * pm;
      m += pm;
    }
    return m > 0 ? new Vec2(mx / m, my / m) : new Vec2(0, 0);
  }

  /** 공력 중심 (항력 면적 가중 평균) */
  centerOfPressure() {
    let ax = 0;
    let ay = 0;
    let a = 0;
    for (const p of this.parts) {
      const d = p.def.drag;
      let area = d ? Math.abs(d.area) * Math.max(d.cd, 0.02) : 0.05;
      if (p.def.fin) area += p.def.fin.area * 2.2;
      ax += p.x * area;
      ay += p.y * area;
      a += area;
    }
    return a > 0 ? new Vec2(ax / a, ay / a) : new Vec2(0, 0);
  }

  /** 무게중심 기준 관성모멘트 (kg·m²) */
  momentOfInertia() {
    const com = this.centerOfMass();
    let I = 0;
    for (const p of this.parts) {
      const m = p.mass;
      const w = p.width;
      const h = p.height;
      // 직사각형 판의 무게중심 관성모멘트 + 평행축 정리
      const own = (m * (w * w + h * h)) / 12;
      const dx = p.x - com.x;
      const dy = p.y - com.y;
      I += own + m * (dx * dx + dy * dy);
    }
    return I;
  }

  /** 전체 바운딩 박스 */
  bounds() {
    if (!this.parts.length) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.parts) {
      const b = p.bounds();
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }

  /** 항력 특성 요약 */
  aeroProperties() {
    const b = this.bounds();
    let cdArea = 0;
    let finArea = 0;
    let noseRadius = 0.5;
    for (const p of this.parts) {
      const d = p.def.drag;
      if (d) cdArea += d.cd * Math.abs(d.area);
      if (p.def.fin) finArea += p.def.fin.area;
      if (p.def.noseRadius) noseRadius = Math.max(noseRadius, p.def.noseRadius);
    }
    const frontalArea = Math.max(b.width * 0.6, 0.5);
    const cd = frontalArea > 0 ? clamp(cdArea / frontalArea, 0.06, 1.6) : 0.3;
    const com = this.centerOfMass();
    const cop = this.centerOfPressure();
    return {
      area: frontalArea,
      cd,
      length: Math.max(b.height, 1),
      finArea,
      finArm: Math.max(Math.abs(cop.y - com.y), b.height * 0.25),
      cpOffset: cop.y - com.y,
      noseRadius,
      bodyLift: 0.22,
      rotationalDamping: 0.6,
    };
  }

  /** 정적 안정 마진 (양수 = 안정) */
  staticMargin() {
    const com = this.centerOfMass();
    const cop = this.centerOfPressure();
    const b = this.bounds();
    const len = Math.max(b.height, 1);
    return (com.y - cop.y) / len;
  }

  /* ── 스테이징 ───────────────────────────────────────── */

  /** 스테이지 수 */
  get stageCount() {
    if (!this.parts.length) return 0;
    return Math.max(...this.parts.map((p) => p.stage)) + 1;
  }

  /** 스테이지별 부품 */
  stageGroups() {
    const n = this.stageCount;
    const groups = Array.from({ length: n }, () => []);
    for (const p of this.parts) {
      const s = clamp(p.stage, 0, n - 1);
      groups[s].push(p);
    }
    return groups;
  }

  /** 스테이지 순서 정규화 (빈 스테이지 제거) */
  normalizeStages() {
    const used = [...new Set(this.parts.map((p) => p.stage))].sort(
      (a, b) => a - b
    );
    const map = new Map(used.map((s, i) => [s, i]));
    for (const p of this.parts) p.stage = map.get(p.stage) ?? 0;
    this._statsCache = null;
  }

  /**
   * 자동 스테이징 — 아래에서 위로 훑으며 분리기를 만날 때마다 단을 나눈다.
   *
   * 분리기는 "자기보다 아래의 모든 것" 을 떨궈내므로 반드시 자기만의
   * 스테이지를 가져야 한다. 그래서 분리기를 만나면 단을 두 번 올린다.
   */
  autoStage() {
    const sorted = [...this.parts].sort((a, b) => a.y - b.y);
    let stage = 0;
    const assigned = new Set();

    for (const p of sorted) {
      if (assigned.has(p.uid)) continue;
      const isDecoupler = p.def.decoupler && !p.def.decoupler.optional && !p.def.clamp;
      if (isDecoupler) {
        stage++;
        p.stage = stage;
        assigned.add(p.uid);
        stage++;
        continue;
      }
      p.stage = stage;
      assigned.add(p.uid);
      // 측면에 붙은 부품은 부모와 같은 스테이지
      for (const c of this.parts) {
        if (c.parentUid === p.uid && c.def.radialOnly && !assigned.has(c.uid)) {
          if (c.def.decoupler && !c.def.decoupler.optional) continue;
          c.stage = stage;
          assigned.add(c.uid);
        }
      }
    }

    // 발사 클램프는 항상 첫 스테이지
    for (const p of this.parts) {
      if (p.def.clamp) p.stage = 0;
    }
    // 낙하산은 마지막 스테이지
    const last = this.stageCount;
    for (const p of this.parts) {
      if (p.def.chute) p.stage = last;
    }
    this.normalizeStages();
    return this.stageCount;
  }

  /* ── Δv 해석 ───────────────────────────────────────── */

  /**
   * 단별 성능 분석.
   * 각 스테이지에서 점화되는 엔진과, 그 스테이지에서 함께 버려지는
   * 탱크의 연료를 묶어 Δv 를 계산한다.
   *
   * @param {number} pressureAtm 기준 기압 (0 = 진공, 1 = 지구 해면)
   * @param {number} gravity 기준 중력 (TWR 계산용)
   */
  analyzeStages(pressureAtm = 0, gravity = 9.80665) {
    const groups = this.stageGroups();
    const n = groups.length;
    const results = [];

    // 각 부품이 "몇 번째 단에서 떨어져 나가는가"(fuelGroup)를 먼저 계산한다.
    // 비행 중에 쓰는 것과 똑같은 규칙이라 설계실 Δv 가 실제와 일치한다.
    buildStages(this.parts);

    for (let i = 0; i < n; i++) {
      // 이 단 시작 시점에 아직 붙어 있는 부품의 총질량
      let startMass = 0;
      for (const p of this.parts) {
        if ((p.fuelGroup ?? Infinity) >= i) startMass += p.mass;
      }

      const engines = groups[i].filter((p) => p.def.engine);
      // 이전 스테이지에서 점화되어 계속 타는 엔진(예: 중심 코어)도 포함
      const activeEngines = engines.slice();

      if (!activeEngines.length) {
        results.push({
          index: i,
          engines: 0,
          thrust: 0,
          isp: 0,
          deltaV: 0,
          burnTime: 0,
          twr: 0,
          startMass,
          endMass: startMass,
          propellant: 0,
        });
        continue;
      }

      // 이 단이 쓸 수 있는 연료: 엔진과 같은 분리 그룹의 탱크
      const prop0 = activeEngines[0].def.engine.propellant;
      const group = activeEngines[0].fuelGroup ?? Infinity;
      const pool =
        prop0 === 'sf'
          ? activeEngines
          : this.parts.filter((p) => (p.fuelGroup ?? Infinity) === group);

      let lf = 0;
      let ox = 0;
      let sf = 0;
      let mono = 0;
      let xe = 0;
      for (const p of pool) {
        lf += p.resources.lf ?? 0;
        ox += p.resources.ox ?? 0;
        sf += p.resources.sf ?? 0;
        mono += p.resources.mono ?? 0;
        xe += p.resources.xe ?? 0;
      }

      let thrust = 0;
      let massFlow = 0;
      for (const e of activeEngines) {
        const t = e.thrustAt(pressureAtm);
        const isp = e.ispAt(pressureAtm);
        thrust += t;
        if (isp > 0) massFlow += t / (isp * G0);
      }
      const effIsp = massFlow > 0 ? thrust / (massFlow * G0) : 0;

      // 사용 가능한 추진제 질량
      const prop = prop0;
      let usableMass = 0;
      if (prop === 'sf') {
        usableMass = sf * RESOURCES.sf.density;
      } else if (prop === 'lf') {
        usableMass = lf * RESOURCES.lf.density;
      } else if (prop === 'xe') {
        usableMass = xe * RESOURCES.xe.density;
      } else if (prop === 'mono') {
        usableMass = mono * RESOURCES.mono.density;
      } else {
        // lfox — 혼합비에 맞춰 제한
        const lfLimited = lf / LF_OX_RATIO.lf;
        const oxLimited = ox / LF_OX_RATIO.ox;
        const units = Math.min(lfLimited, oxLimited);
        usableMass =
          units * LF_OX_RATIO.lf * RESOURCES.lf.density +
          units * LF_OX_RATIO.ox * RESOURCES.ox.density;
      }

      const endMass = Math.max(startMass - usableMass, 1);
      const deltaV =
        effIsp > 0 && startMass > endMass
          ? effIsp * G0 * Math.log(startMass / endMass)
          : 0;
      const burnTime = massFlow > 0 ? usableMass / massFlow : 0;

      results.push({
        index: i,
        engines: activeEngines.length,
        thrust,
        isp: effIsp,
        deltaV,
        burnTime,
        twr: startMass > 0 ? thrust / (startMass * gravity) : 0,
        twrEnd: endMass > 0 ? thrust / (endMass * gravity) : 0,
        startMass,
        endMass,
        propellant: usableMass,
        parts: groups[i].length,
      });
    }

    return results;
  }

  /** 요약 통계 */
  stats(pressureAtm = 1, gravity = 9.80665) {
    if (this._statsCache && this._statsCache.pressure === pressureAtm) {
      return this._statsCache;
    }
    const stages = this.analyzeStages(pressureAtm, gravity);
    const vacStages = this.analyzeStages(0, gravity);
    const b = this.bounds();
    const com = this.centerOfMass();
    const cop = this.centerOfPressure();

    const out = {
      pressure: pressureAtm,
      partCount: this.parts.length,
      mass: this.totalMass,
      dryMass: this.dryMass,
      propellantMass: this.propellantMass,
      cost: sum(this.parts, (p) => partTotalCost(p.def)),
      height: b.height,
      width: b.width,
      stages: stages.length,
      deltaV: sum(vacStages, (s) => s.deltaV),
      deltaVSeaLevel: sum(stages, (s) => s.deltaV),
      liftoffTwr: stages[0]?.twr ?? 0,
      totalBurnTime: sum(stages, (s) => s.burnTime),
      stageList: stages,
      vacuumStageList: vacStages,
      com,
      cop,
      staticMargin: this.staticMargin(),
      inertia: this.momentOfInertia(),
      crew: sum(this.parts, (p) => p.def.crew ?? 0),
      torque: sum(this.parts, (p) => p.def.torque ?? 0),
      hasChute: this.parts.some((p) => p.def.chute),
      hasLegs: this.parts.some((p) => p.def.leg),
      hasControl: this.parts.some((p) => p.def.crew > 0 || p.def.probe),
      electricity: sum(this.parts, (p) => p.resources.ec ?? 0),
      solarOutput: sum(this.parts, (p) => p.def.solar?.output ?? 0),
    };
    this._statsCache = out;
    return out;
  }

  /* ── 검증 ──────────────────────────────────────────── */

  /**
   * 발사 가능 여부 점검.
   * @returns {{ok:boolean, errors:string[], warnings:string[]}}
   */
  /**
   * 발사 가능 여부 점검.
   * @param {CelestialBody|null} body 발사할 천체
   * @param {object} opts { orbital } — 궤도에서 시작하는 기체는 추중비 제약을 받지 않는다
   */
  validate(body = null, opts = {}) {
    const errors = [];
    const warnings = [];
    if (!this.parts.length) {
      errors.push('부품이 하나도 없습니다.');
      return { ok: false, errors, warnings };
    }
    const s = this.stats(body?.atmo?.seaPressure ?? 1, body?.surfaceGravity ?? 9.81);

    if (!s.hasControl) {
      errors.push('조종부(사령선 또는 탐사 코어)가 없습니다.');
    }
    if (s.stageList.every((st) => st.thrust <= 0)) {
      errors.push('엔진이 하나도 없습니다.');
    }
    if (s.liftoffTwr > 0 && s.liftoffTwr < 1.0) {
      const msg = `이륙 추중비가 ${s.liftoffTwr.toFixed(2)} 입니다. 지표에서 떠오르려면 1.0 을 넘어야 합니다.`;
      if (opts.orbital) warnings.push(`${msg} (궤도 전용 기체)`);
      else errors.push(msg);
    }
    if (s.liftoffTwr > 4.5) {
      warnings.push(
        `이륙 추중비 ${s.liftoffTwr.toFixed(2)} — 너무 높으면 대기 항력으로 연료를 낭비합니다.`
      );
    }
    if (s.staticMargin < 0) {
      warnings.push(
        '공력 중심이 무게중심보다 앞에 있습니다. 상승 중 뒤집힐 수 있으니 하단에 핀을 다세요.'
      );
    }
    if (!s.hasChute && s.crew > 0) {
      warnings.push('낙하산이 없습니다. 승무원 귀환이 불가능합니다.');
    }
    if (s.deltaV < 3400 && body?.home) {
      warnings.push(
        `총 Δv 가 ${Math.round(s.deltaV)} m/s 입니다. 저궤도 진입에는 약 3,400 m/s 가 필요합니다.`
      );
    }
    if (s.electricity <= 0 && this.parts.some((p) => p.def.probe)) {
      warnings.push('전기가 없습니다. 탐사 코어가 곧 꺼집니다.');
    }
    // 고아 부품 — 결합은 방향이 없으므로 부모/자식 양쪽으로 따라간다
    const byUid = new Map(this.parts.map((p) => [p.uid, p]));
    const children = new Map();
    for (const p of this.parts) {
      if (!p.parentUid) continue;
      if (!children.has(p.parentUid)) children.set(p.parentUid, []);
      children.get(p.parentUid).push(p.uid);
    }
    const connected = new Set();
    const stack = [this.rootUid];
    while (stack.length) {
      const uid = stack.pop();
      if (!uid || connected.has(uid) || !byUid.has(uid)) continue;
      connected.add(uid);
      const parent = byUid.get(uid).parentUid;
      if (parent) stack.push(parent);
      for (const c of children.get(uid) ?? []) stack.push(c);
    }
    const orphans = this.parts.filter((p) => !connected.has(p.uid));
    if (orphans.length) {
      warnings.push(`연결되지 않은 부품이 ${orphans.length}개 있습니다.`);
    }

    return { ok: errors.length === 0, errors, warnings, stats: s };
  }

  /* ── 직렬화 ─────────────────────────────────────────── */

  toBlueprint() {
    const stats = this.stats(1, 9.81);
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      rootUid: this.rootUid,
      parts: this.parts.map((p) => p.toJSON()),
      stats: {
        mass: Math.round(stats.mass),
        stages: stats.stages,
        deltaV: Math.round(stats.deltaV),
        cost: stats.cost,
        partCount: stats.partCount,
        height: +stats.height.toFixed(1),
      },
    };
  }

  static fromBlueprint(bp) {
    const craft = new Craft(bp.name ?? '불러온 기체');
    craft.id = bp.id ?? null;
    craft.description = bp.description ?? '';
    for (const po of bp.parts ?? []) {
      try {
        craft.parts.push(CraftPart.fromJSON(po));
      } catch (e) {
        console.warn('[craft] 부품 복원 실패', po.defId, e.message);
      }
    }
    craft.rootUid = bp.rootUid ?? craft.parts[0]?.uid ?? null;
    // uid 충돌 방지
    for (const p of craft.parts) {
      const n = parseInt(p.uid.slice(1), 36);
      if (Number.isFinite(n) && n >= _uid) _uid = n + 1;
    }
    craft.normalizeStages();
    return craft;
  }

  clone() {
    return Craft.fromBlueprint(this.toBlueprint());
  }

  /** 모든 탱크를 가득 채운다 */
  fillAll(fraction = 1) {
    for (const p of this.parts) p.fill(fraction);
    this._statsCache = null;
  }

  /** 기체를 원점 기준으로 정렬 (바닥이 y=0) */
  alignToGround() {
    const b = this.bounds();
    const dy = -b.minY;
    for (const p of this.parts) p.y += dy;
    this._statsCache = null;
    return dy;
  }
}

/**
 * Δv 예산을 사람이 읽을 수 있는 문장으로.
 */
export function describeDeltaV(dv) {
  if (dv < 1000) return '준궤도 비행 정도';
  if (dv < 3400) return '고고도 도달 — 궤도 진입은 어려움';
  if (dv < 4500) return '저궤도 진입 가능';
  if (dv < 5500) return '궤도 + 약간의 기동 여유';
  if (dv < 6500) return '달 자유귀환 궤도 가능';
  if (dv < 8000) return '달 착륙·귀환 가능';
  if (dv < 11000) return '내행성 왕복 가능';
  if (dv < 16000) return '외행성 도달 가능';
  return '항성계 어디든 갈 수 있음';
}

/** 추중비 평가 */
export function describeTwr(twr) {
  if (twr < 1.0) return '이륙 불가';
  if (twr < 1.2) return '너무 느린 상승 — 중력 손실 큼';
  if (twr < 1.8) return '적절';
  if (twr < 2.5) return '경쾌한 상승';
  if (twr < 4) return '과도한 추력 — 항력 손실';
  return '극단적 — 구조 한계 주의';
}
