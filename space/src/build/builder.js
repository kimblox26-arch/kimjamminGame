// ORBITER — 설계실 (VAB)
// 캔버스 위에서 부품을 집어 배치하고, 결합점에 스냅하고, 스테이지를 배정한다.
// 무게중심·공력중심·단별 Δv 가 실시간으로 갱신된다.

import {
  clamp,
  clamp01,
  lerp,
  damp,
  Vec2,
  withAlpha,
  formatMass,
  formatDistance,
  TAU,
} from '../core/math.js';
import { Craft, CraftPart, nextUid, describeDeltaV, describeTwr } from './craft.js';
import {
  PART_DEFS,
  PART_BY_ID,
  partTotalCost,
  searchParts,
  partResizeLimits,
} from './partdefs.js';
import { CATEGORIES } from '../physics/constants.js';
import { drawPart, drawPartIcon } from '../render/partsdraw.js';
import { bus, EVT } from '../core/events.js';
import { audio } from '../audio/audio.js';

const GRID_STEP = 0.25;

export class Builder {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {InputManager} input
   */
  constructor(canvas, input, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = input;
    this.craft = new Craft('새 기체');
    this.unlocked = opts.unlocked ?? null; // null = 전부 해금

    // 뷰
    this.pan = new Vec2(0, 6);
    this.targetPan = new Vec2(0, 6);
    this.zoom = 26; // 픽셀 per 미터
    this.targetZoom = 26;
    this.width = canvas.width;
    this.height = canvas.height;
    this.dpr = 1;

    // 편집 상태
    this.category = 'pod';
    this.search = '';
    this.selectedDefId = null;
    this.heldPart = null; // 새로 놓는 부품(정의) 또는 집어든 기존 부품
    this.heldFromCraft = null;
    this.hoverPart = null;
    this.selectedPart = null;
    this.snap = null;
    this.symmetry = true;
    /** 크기 조절 중인 핸들 ('w' | 'h' | 'wh' | null) */
    this.resizeHandle = null;
    this.resizeStart = null;
    /** 부품 클리핑 허용 (치트) */
    this.allowClipping = false;
    /** 최근 사용 도색 */
    this.paintColor = null;
    this.snapToGrid = false;
    this.showCoM = true;
    this.showCoP = true;
    this.stageEditing = false;
    this.mirrorPreview = null;

    // 실행취소
    this.history = [];
    this.future = [];
    this.maxHistory = 40;

    this.stats = null;
    this.onChange = opts.onChange ?? null;
    this.mouseWorld = new Vec2();
    this.dirty = true;
  }

  resize(w, h, dpr = 1) {
    this.width = w;
    this.height = h;
    this.dpr = dpr;
  }

  /* ── 좌표 변환 ─────────────────────────────────────────── */

  worldToScreen(wx, wy, out = { x: 0, y: 0 }) {
    out.x = this.width / 2 + (wx - this.pan.x) * this.zoom;
    out.y = this.height / 2 - (wy - this.pan.y) * this.zoom;
    return out;
  }

  screenToWorld(sx, sy, out = new Vec2()) {
    out.x = (sx - this.width / 2) / this.zoom + this.pan.x;
    out.y = -(sy - this.height / 2) / this.zoom + this.pan.y;
    return out;
  }

  /* ── 편집 명령 ─────────────────────────────────────────── */

  pushHistory() {
    this.history.push(JSON.stringify(this.craft.toBlueprint()));
    if (this.history.length > this.maxHistory) this.history.shift();
    this.future.length = 0;
  }

  undo() {
    if (!this.history.length) return false;
    this.future.push(JSON.stringify(this.craft.toBlueprint()));
    const bp = JSON.parse(this.history.pop());
    this.craft = Craft.fromBlueprint(bp);
    this.selectedPart = null;
    this.markChanged(false);
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.history.push(JSON.stringify(this.craft.toBlueprint()));
    const bp = JSON.parse(this.future.pop());
    this.craft = Craft.fromBlueprint(bp);
    this.selectedPart = null;
    this.markChanged(false);
    return true;
  }

  markChanged(pushHistory = true) {
    if (pushHistory) this.pushHistory();
    this.craft._statsCache = null;
    this.stats = this.craft.stats(1, 9.81);
    this.dirty = true;
    if (this.onChange) this.onChange(this.craft, this.stats);
    bus.emit(EVT.BUILD_CHANGE, { craft: this.craft, stats: this.stats });
  }

  newCraft() {
    this.pushHistory();
    this.craft = new Craft('새 기체');
    this.selectedPart = null;
    this.heldPart = null;
    this.markChanged(false);
  }

  loadCraft(craft) {
    this.craft = craft;
    this.selectedPart = null;
    this.heldPart = null;
    this.history.length = 0;
    this.future.length = 0;
    this.fitView();
    this.markChanged(false);
  }

  fitView() {
    const b = this.craft.bounds();
    if (!this.craft.parts.length) {
      this.targetPan.set(0, 6);
      this.targetZoom = 26;
      return;
    }
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.targetPan.set(cx, cy);
    const scale = Math.min(
      (this.width * 0.55) / Math.max(b.width, 2),
      (this.height * 0.78) / Math.max(b.height, 2)
    );
    this.targetZoom = clamp(scale, 3, 120);
  }

  /** 팔레트에서 부품 선택 */
  selectDef(defId) {
    this.selectedDefId = defId;
    this.heldPart = PART_BY_ID.get(defId) ?? null;
    this.heldFromCraft = null;
  }

  cancelHeld() {
    if (this.heldFromCraft) {
      // 원래 자리로 되돌린다
      this.craft.add(this.heldFromCraft);
      this.heldFromCraft = null;
    }
    this.heldPart = null;
    this.selectedDefId = null;
    this.snap = null;
  }

  /* ── 입력 처리 ─────────────────────────────────────────── */

  update(dt) {
    const input = this.input;
    const m = input.mouse;
    // 입력 좌표는 뷰포트 기준이므로 설계실 캔버스 기준으로 옮긴다
    const rect = this.canvas.getBoundingClientRect();
    const mx = m.x - rect.left;
    const my = m.y - rect.top;
    const inside =
      mx >= 0 && my >= 0 && mx <= rect.width && my <= rect.height;

    // 뷰 조작
    if (m.wheel !== 0 && inside) {
      const before = this.screenToWorld(mx, my);
      this.targetZoom = clamp(this.targetZoom * Math.pow(0.9, m.wheel / 100), 3, 160);
      this.zoom = this.targetZoom;
      const after = this.screenToWorld(mx, my);
      this.pan.x += before.x - after.x;
      this.pan.y += before.y - after.y;
      this.targetPan.copy(this.pan);
    }
    if (m.right && m.dragging && !m.overUI) {
      this.pan.x -= m.dx / this.zoom;
      this.pan.y += m.dy / this.zoom;
      this.targetPan.copy(this.pan);
    }
    if (input.pinch.active && Math.abs(input.pinch.delta) > 0.5) {
      this.targetZoom = clamp(
        this.targetZoom * (1 + input.pinch.delta * 0.006),
        3,
        160
      );
    }

    this.pan.x = damp(this.pan.x, this.targetPan.x, 0.0005, dt);
    this.pan.y = damp(this.pan.y, this.targetPan.y, 0.0005, dt);
    this.zoom = lerp(this.zoom, this.targetZoom, 1 - Math.pow(0.0008, dt));

    this.screenToWorld(mx, my, this.mouseWorld);

    // 배치 미리보기 스냅
    if (this.heldPart) {
      let x = this.mouseWorld.x;
      let y = this.mouseWorld.y;
      if (this.snapToGrid) {
        x = Math.round(x / GRID_STEP) * GRID_STEP;
        y = Math.round(y / GRID_STEP) * GRID_STEP;
      }
      this.snap = this.craft.findSnap(this.heldPart.id, x, y, 1.2);
      this.previewPos = this.snap ? this.snap.pos : new Vec2(x, y);
    } else {
      this.snap = null;
      this.hoverPart = this.pickPart(this.mouseWorld.x, this.mouseWorld.y);
    }

    // 크기 조절 드래그 진행
    if (this.resizeHandle && m.left) {
      this._dragResize();
    } else if (this.resizeHandle && !m.left) {
      this.resizeHandle = null;
      this.resizeStart = null;
      this.markChanged();
    }

    // 좌클릭 — UI 버튼을 누른 경우는 무시한다
    if (m.leftPressed && inside && !m.overUI && !this.resizeHandle) {
      // 선택된 부품의 크기 조절 핸들을 먼저 검사한다
      const hit = this._hitResizeHandle(mx, my);
      if (hit) {
        const p = this.selectedPart;
        this.pushHistory();
        this.resizeHandle = hit;
        this.resizeStart = {
          sw: p.scaleW,
          sh: p.scaleH,
          mouse: new Vec2(this.mouseWorld.x, this.mouseWorld.y),
          x: p.x,
          y: p.y,
        };
      } else if (this.heldPart) {
        this.placeHeld();
      } else {
        const p = this.pickPart(this.mouseWorld.x, this.mouseWorld.y);
        if (p) {
          const changed = this.selectedPart !== p;
          this.selectedPart = p;
          if (changed) this.onChange?.();
          // 드래그로 집어들기
          this.grabCandidate = p;
          this.grabStart = new Vec2(m.x, m.y);
        } else {
          const had = !!this.selectedPart;
          this.selectedPart = null;
          if (had) this.onChange?.();
        }
      }
    }

    if (
      this.grabCandidate &&
      m.left &&
      m.dragging &&
      Math.hypot(m.x - this.grabStart.x, m.y - this.grabStart.y) > 6
    ) {
      this.grabPart(this.grabCandidate);
      this.grabCandidate = null;
    }
    if (!m.left) this.grabCandidate = null;

    // 우클릭으로 삭제
    if (m.rightPressed && !m.dragging && inside && !m.overUI) {
      const p = this.pickPart(this.mouseWorld.x, this.mouseWorld.y);
      if (p) this.removePart(p);
    }

    // 단축키
    if (input.wasPressed('Delete') || input.wasPressed('Backspace')) {
      if (this.selectedPart) this.removePart(this.selectedPart);
    }
    if (input.wasPressed('KeyX') && this.selectedPart) {
      this.craft.mirrorPart(this.selectedPart.uid);
      this.markChanged();
    }
    // 크기 조절 단축키 — 미세 조정
    if (this.selectedPart && partResizeLimits(this.selectedPart.def)) {
      const p = this.selectedPart;
      const step = input.isDown('ShiftLeft') ? 0.01 : 0.05;
      let sw = p.scaleW;
      let sh = p.scaleH;
      if (input.wasPressed('BracketRight')) sh += step;
      if (input.wasPressed('BracketLeft')) sh -= step;
      if (input.wasPressed('Equal')) sw += step;
      if (input.wasPressed('Minus')) sw -= step;
      if (sw !== p.scaleW || sh !== p.scaleH) {
        this._applyScale(p, sw, sh);
        this.markChanged();
      }
    }
    if (input.wasPressed('Escape')) this.cancelHeld();
    if (input.isDown('ControlLeft') && input.wasPressed('KeyZ')) this.undo();
    if (input.isDown('ControlLeft') && input.wasPressed('KeyY')) this.redo();
    if (input.wasPressed('KeyF')) this.fitView();
  }

  /* ── 크기 조절 ────────────────────────────────────────── */

  /** 선택된 부품의 핸들 위치 (화면 좌표) */
  _resizeHandles() {
    const p = this.selectedPart;
    if (!p) return null;
    const lim = partResizeLimits(p.def);
    if (!lim) return null;
    const hw = p.width / 2;
    const hh = p.height / 2;
    const c = this.worldToScreen(p.x, p.y);
    const right = this.worldToScreen(p.x + hw, p.y);
    const top = this.worldToScreen(p.x, p.y + hh);
    const corner = this.worldToScreen(p.x + hw, p.y + hh);
    return {
      uniform: lim.uniform,
      w: { x: right.x, y: c.y },
      h: { x: c.x, y: top.y },
      wh: { x: corner.x, y: corner.y },
    };
  }

  _hitResizeHandle(mx, my) {
    const h = this._resizeHandles();
    if (!h) return null;
    const R = 13;
    const near = (p) => Math.hypot(mx - p.x, my - p.y) < R;
    if (near(h.wh)) return 'wh';
    if (!h.uniform) {
      if (near(h.w)) return 'w';
      if (near(h.h)) return 'h';
    }
    return null;
  }

  /** 크기와 함께 위치도 옮겨 붙은 부모에서 떨어지지 않게 한다 */
  _applyScale(part, sw, sh) {
    const lim = partResizeLimits(part.def);
    if (!lim) return;
    const snap = (v) => Math.round(v / 0.05) * 0.05;
    let nw = clamp(snap(sw), lim.w[0], lim.w[1]);
    let nh = clamp(snap(sh), lim.h[0], lim.h[1]);
    if (lim.uniform) nh = nw;
    const oldH = part.height;
    part.setScale(nw, nh);
    // 아래쪽 면을 고정 — 아래에 붙은 부품과 어긋나지 않는다
    const grow = part.height - oldH;
    part.y += grow / 2;
    // 위에 쌓인 부품들은 늘어난 만큼 통째로 올린다
    this.craft.reflowAfterResize(part, grow);
  }

  _dragResize() {
    const p = this.selectedPart;
    const st = this.resizeStart;
    if (!p || !st) return;
    const dx = this.mouseWorld.x - st.mouse.x;
    const dy = this.mouseWorld.y - st.mouse.y;
    const baseW = p.def.size.w;
    const baseH = p.def.size.h;
    let sw = st.sw;
    let sh = st.sh;
    if (this.resizeHandle === 'w' || this.resizeHandle === 'wh') {
      sw = st.sw + (dx * 2) / baseW;
    }
    if (this.resizeHandle === 'h' || this.resizeHandle === 'wh') {
      sh = st.sh + (dy * 2) / baseH;
    }
    if (this.resizeHandle === 'wh' && partResizeLimits(p.def).uniform) {
      sw = st.sw + (dx * 2) / baseW;
      sh = sw;
    }
    p.x = st.x;
    this._applyScale(p, sw, sh);
    this.craft._statsCache = null;
  }

  /** 선택된 부품에 도색 */
  paintSelected(color) {
    const p = this.selectedPart;
    if (!p) return;
    this.pushHistory();
    p.tint = color;
    this.paintColor = color;
    // 대칭 짝도 함께
    if (p.symmetryGroup) {
      for (const q of this.craft.parts) {
        if (q.symmetryGroup === p.symmetryGroup) q.tint = color;
      }
    }
    this.markChanged();
  }

  /** 기체 전체 도색 */
  paintAll(color) {
    this.pushHistory();
    for (const p of this.craft.parts) p.tint = color;
    this.paintColor = color;
    this.markChanged();
  }

  placeHeld() {
    const def = this.heldPart;
    if (!def) return;
    const pos = this.previewPos;
    if (
      !this.allowClipping &&
      this.craft.overlaps(def.id, pos.x, pos.y, this.heldFromCraft?.uid)
    ) {
      bus.emit(EVT.TOAST, { text: '다른 부품과 겹칩니다', kind: 'warn' });
      return;
    }

    const stage = this.snap?.part?.stage ?? 0;
    let part;
    if (this.heldFromCraft) {
      part = this.heldFromCraft;
      part.x = pos.x;
      part.y = pos.y;
      part.parentUid = this.snap?.part?.uid ?? null;
      part.mirrored = this.snap?.mirrored ?? part.mirrored;
      this.craft.add(part);
      this.heldFromCraft = null;
    } else {
      part = new CraftPart(def.id, pos.x, pos.y, {
        stage,
        parentUid: this.snap?.part?.uid ?? null,
        mirrored: this.snap?.mirrored ?? false,
      });
      this.craft.add(part);
    }

    // 대칭 배치
    if (this.symmetry && this.snap?.radial && def.radialOnly !== false) {
      const mirror = this.craft.mirrorPart(part.uid);
      if (mirror) mirror.stage = part.stage;
    }

    this.selectedPart = part;
    this.heldPart = null;
    this.selectedDefId = null;
    this.craft.autoStage();
    this.markChanged();
    audio.play('place');
    bus.emit(EVT.BUILD_PLACE, { part });
  }

  grabPart(part) {
    this.pushHistory();
    // 루트는 옮길 수 없다
    if (part.uid === this.craft.rootUid && this.craft.parts.length > 1) {
      bus.emit(EVT.TOAST, { text: '루트 부품은 옮길 수 없습니다', kind: 'warn' });
      return;
    }
    const sub = this.craft.subtree(part.uid);
    if (sub.length > 1) {
      // 자식이 있으면 서브트리 전체를 옮긴다 — 여기서는 단순화해 부품만 분리
      for (const c of sub) {
        if (c !== part) c.parentUid = part.parentUid;
      }
    }
    this.craft.parts = this.craft.parts.filter((p) => p.uid !== part.uid);
    this.heldFromCraft = part;
    this.heldPart = part.def;
    this.selectedPart = null;
  }

  removePart(part) {
    if (this.craft.parts.length === 1) {
      this.craft.clear();
      this.markChanged();
      return;
    }
    this.pushHistory();
    if (part.symmetryGroup) this.craft.removeSymmetryGroup(part.uid);
    else this.craft.remove(part.uid);
    if (this.selectedPart === part) this.selectedPart = null;
    this.markChanged(false);
    bus.emit(EVT.BUILD_REMOVE, { part });
  }

  pickPart(wx, wy) {
    // 위에 있는 것(나중에 추가된 것)부터 검사
    for (let i = this.craft.parts.length - 1; i >= 0; i--) {
      const p = this.craft.parts[i];
      const hw = p.width / 2;
      const hh = p.height / 2;
      if (wx >= p.x - hw && wx <= p.x + hw && wy >= p.y - hh && wy <= p.y + hh) {
        return p;
      }
    }
    return null;
  }

  /** 선택 부품의 스테이지 변경 */
  setPartStage(part, stage) {
    if (!part) return;
    this.pushHistory();
    part.stage = Math.max(0, stage);
    this.craft.normalizeStages();
    this.markChanged(false);
  }

  /** 자원 토글 (핵열 엔진용 산화제 제거 등) */
  toggleResource(part, key) {
    if (!part || !part.def.fuel?.[key]) return;
    this.pushHistory();
    if (part.disabledResources.has(key)) {
      part.disabledResources.delete(key);
      part.resources[key] = part.def.fuel[key];
    } else {
      part.disabledResources.add(key);
      part.resources[key] = 0;
    }
    this.markChanged(false);
  }

  /* ── 렌더 ─────────────────────────────────────────────── */

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 배경 (청사진)
    ctx.fillStyle = '#0a141f';
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawGrid(ctx);

    // 기체
    const ordered = [...this.craft.parts].sort((a, b) => {
      const ra = a.def.radialOnly ? 0 : 1;
      const rb = b.def.radialOnly ? 0 : 1;
      return ra - rb;
    });
    for (const part of ordered) {
      this.drawCraftPart(ctx, part);
    }

    // 결합점 표시
    if (this.heldPart) this.drawAttachNodes(ctx);

    // 배치 미리보기
    if (this.heldPart && this.previewPos) {
      this.drawPreview(ctx);
    }

    // 선택/호버 하이라이트
    if (this.hoverPart && !this.heldPart) {
      this.outlinePart(ctx, this.hoverPart, 'rgba(120,200,255,0.5)');
    }
    if (this.selectedPart) {
      this.outlinePart(ctx, this.selectedPart, '#ffd24a');
      this.drawResizeHandles(ctx);
      this.drawPartInfo(ctx, this.selectedPart);
    }

    // 무게중심 / 공력중심
    if (this.craft.parts.length) {
      if (this.showCoM) {
        const com = this.craft.centerOfMass();
        this.drawMarker(ctx, com, '#ffd24a', 'CoM');
        const dry = this.craft.dryCenterOfMass();
        this.drawMarker(ctx, dry, withAlpha('#ffd24a', 0.4), '', 7);
      }
      if (this.showCoP) {
        const cop = this.craft.centerOfPressure();
        this.drawMarker(ctx, cop, '#63b8ff', 'CoP');
      }
    }

    // 스테이지 표시
    if (this.stageEditing) this.drawStageOverlay(ctx);

    // 지면선
    this.drawGroundLine(ctx);
  }

  drawGrid(ctx) {
    const step = GRID_STEP * this.zoom;
    if (step < 4) return;
    const major = step * 4;
    const sp = this.worldToScreen(0, 0);

    ctx.strokeStyle = 'rgba(90,150,200,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = sp.x % step; x < this.width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
    }
    for (let y = sp.y % step; y < this.height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(90,150,200,0.14)';
    ctx.beginPath();
    for (let x = sp.x % major; x < this.width; x += major) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
    }
    for (let y = sp.y % major; y < this.height; y += major) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    }
    ctx.stroke();

    // 중심 축
    ctx.strokeStyle = 'rgba(120,190,240,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sp.x, 0);
    ctx.lineTo(sp.x, this.height);
    ctx.stroke();
  }

  drawGroundLine(ctx) {
    const sp = this.worldToScreen(0, 0);
    if (sp.y < 0 || sp.y > this.height) return;
    ctx.strokeStyle = 'rgba(160,200,240,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(0, sp.y);
    ctx.lineTo(this.width, sp.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(160,200,240,0.6)';
    ctx.textAlign = 'left';
    ctx.fillText('발사대 기준면', 10, sp.y - 6);
  }

  drawCraftPart(ctx, part) {
    const sp = this.worldToScreen(part.x, part.y);
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.scale(this.zoom, -this.zoom);
    if (part.mirrored) ctx.scale(-1, 1);
    if (part.rot) ctx.rotate(part.rot);
    drawPart(ctx, part.def, {
      fuelFraction: 1,
      deployed: true,
      legExtended: part.def.leg ? true : false,
      chuteState: 'stowed',
      uid: part.uid,
      scaleW: part.scaleW,
      scaleH: part.scaleH,
      tint: part.tint,
    });
    ctx.restore();
  }

  drawPreview(ctx) {
    const def = this.heldPart;
    const pos = this.previewPos;
    const valid = !this.craft.overlaps(def.id, pos.x, pos.y, this.heldFromCraft?.uid);
    const sp = this.worldToScreen(pos.x, pos.y);

    ctx.save();
    ctx.globalAlpha = valid ? 0.72 : 0.4;
    ctx.translate(sp.x, sp.y);
    ctx.scale(this.zoom, -this.zoom);
    if (this.snap?.mirrored) ctx.scale(-1, 1);
    drawPart(ctx, def, { deployed: true, legExtended: true });
    ctx.restore();

    // 테두리
    ctx.strokeStyle = valid ? '#5ae09a' : '#ff5a4a';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    const hw = (def.size.w / 2) * this.zoom;
    const hh = (def.size.h / 2) * this.zoom;
    ctx.strokeRect(sp.x - hw, sp.y - hh, hw * 2, hh * 2);
    ctx.setLineDash([]);

    // 대칭 미리보기
    if (this.symmetry && this.snap?.radial) {
      const axis = this.snap.part.x;
      const mx = axis - (pos.x - axis);
      const msp = this.worldToScreen(mx, pos.y);
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.translate(msp.x, msp.y);
      ctx.scale(this.zoom, -this.zoom);
      if (!this.snap.mirrored) ctx.scale(-1, 1);
      drawPart(ctx, def, { deployed: true, legExtended: true });
      ctx.restore();
    }
  }

  drawAttachNodes(ctx) {
    const def = this.heldPart;
    for (const part of this.craft.parts) {
      for (const node of part.def.nodes ?? []) {
        const wp = part.nodeWorldPos(node);
        const sp = this.worldToScreen(wp.x, wp.y);
        const isSnap =
          this.snap &&
          this.snap.part === part &&
          this.snap.node === node;
        ctx.fillStyle = isSnap ? '#5ae09a' : 'rgba(120,200,255,0.45)';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, isSnap ? 7 : 4, 0, TAU);
        ctx.fill();
      }
      if (part.def.radialAttach && def.radialOnly) {
        const hw = part.width / 2;
        for (const sx of [-hw, hw]) {
          const sp = this.worldToScreen(part.x + sx, part.y);
          ctx.strokeStyle = 'rgba(120,200,255,0.25)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y - (part.height / 2) * this.zoom);
          ctx.lineTo(sp.x, sp.y + (part.height / 2) * this.zoom);
          ctx.stroke();
        }
      }
    }
  }

  /** 크기 조절 핸들 — 오른쪽(폭) · 위(길이) · 모서리(둘 다) */
  drawResizeHandles(ctx) {
    const h = this._resizeHandles();
    if (!h) return;
    const p = this.selectedPart;
    const draw = (pt, active, label) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, active ? 8 : 6, 0, TAU);
      ctx.fillStyle = active ? '#ffd24a' : 'rgba(20,26,34,0.9)';
      ctx.fill();
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (label) {
        ctx.fillStyle = '#ffd24a';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, pt.x, pt.y - 12);
      }
    };
    if (!h.uniform) {
      draw(h.w, this.resizeHandle === 'w', '↔');
      draw(h.h, this.resizeHandle === 'h', '↕');
    }
    draw(h.wh, this.resizeHandle === 'wh', h.uniform ? '⤢' : '');

    // 배율 표시
    if (p.scaleW !== 1 || p.scaleH !== 1) {
      const sp = this.worldToScreen(p.x, p.y);
      ctx.fillStyle = 'rgba(10,14,20,0.8)';
      const txt = `${p.scaleW.toFixed(2)}× ${p.scaleH.toFixed(2)}`;
      ctx.font = '11px ui-monospace, monospace';
      const tw = ctx.measureText(txt).width + 10;
      ctx.fillRect(sp.x - tw / 2, sp.y - 8, tw, 16);
      ctx.fillStyle = '#ffd24a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, sp.x, sp.y);
      ctx.textBaseline = 'alphabetic';
    }
  }

  outlinePart(ctx, part, color) {
    const sp = this.worldToScreen(part.x, part.y);
    const hw = (part.width / 2) * this.zoom;
    const hh = (part.height / 2) * this.zoom;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(sp.x - hw - 2, sp.y - hh - 2, hw * 2 + 4, hh * 2 + 4);
  }

  drawMarker(ctx, pos, color, label, size = 10) {
    const sp = this.worldToScreen(pos.x, pos.y);
    ctx.save();
    ctx.translate(sp.x, sp.y);
    // 사분원이 교차된 표준 CoM 기호
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, size, 0, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, size, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, TAU);
    ctx.stroke();
    if (label) {
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(label, size + 4, 4);
    }
    ctx.restore();
  }

  drawStageOverlay(ctx) {
    const groups = this.craft.stageGroups();
    const colors = [
      '#ff6a4a',
      '#ffb04a',
      '#ffd24a',
      '#5ae09a',
      '#5ad1ff',
      '#8a9aff',
      '#c48cff',
      '#ff8ad1',
    ];
    groups.forEach((group, i) => {
      const color = colors[i % colors.length];
      for (const part of group) {
        const sp = this.worldToScreen(part.x, part.y);
        const hw = (part.width / 2) * this.zoom;
        const hh = (part.height / 2) * this.zoom;
        ctx.fillStyle = withAlpha(color, 0.16);
        ctx.fillRect(sp.x - hw, sp.y - hh, hw * 2, hh * 2);
        ctx.strokeStyle = withAlpha(color, 0.7);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sp.x - hw, sp.y - hh, hw * 2, hh * 2);
      }
      // 스테이지 번호
      if (group.length) {
        const avgY = group.reduce((a, p) => a + p.y, 0) / group.length;
        const sp = this.worldToScreen(
          this.craft.bounds().minX - 1.2,
          avgY
        );
        ctx.fillStyle = color;
        ctx.font = 'bold 14px ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`#${i + 1}`, sp.x, sp.y + 5);
      }
    });
  }

  drawPartInfo(ctx, part) {
    const def = part.def;
    const lines = [
      def.name,
      `질량 ${formatMass(part.mass)}`,
      `비용 ${partTotalCost(def).toLocaleString('ko-KR')}`,
      `스테이지 ${part.stage + 1}`,
    ];
    if (def.engine) {
      lines.push(
        `진공 추력 ${(def.engine.thrust / 1000).toFixed(0)} kN`,
        `Isp ${def.engine.isp}s (진공) / ${def.engine.ispSL}s (해면)`
      );
    }
    if (def.fuel) {
      const parts = [];
      for (const k in def.fuel) {
        if (k === 'ec') continue;
        parts.push(`${k.toUpperCase()} ${def.fuel[k]}`);
      }
      if (parts.length) lines.push(parts.join(' / '));
    }

    const w = 260;
    const h = 18 + lines.length * 17;
    const x = this.width - w - 16;
    const y = 16;

    ctx.fillStyle = 'rgba(8,16,26,0.85)';
    ctx.strokeStyle = 'rgba(120,180,230,0.3)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.textAlign = 'left';
    lines.forEach((line, i) => {
      ctx.font = i === 0 ? 'bold 13px ui-monospace, monospace' : '11px ui-monospace, monospace';
      ctx.fillStyle = i === 0 ? '#ffd24a' : '#b8ccdd';
      ctx.fillText(line, x + 10, y + 20 + i * 17);
    });
  }

  /* ── 팔레트 DOM ────────────────────────────────────────── */

  /**
   * 부품 팔레트를 DOM 요소에 렌더링한다.
   * @param {HTMLElement} container
   */
  renderPalette(container) {
    container.innerHTML = '';
    let list = this.search
      ? searchParts(this.search)
      : PART_DEFS.filter((p) => p.category === this.category);

    if (this.unlocked) {
      list = list.filter((p) => this.unlocked.has(p.tier));
    }
    list = list.slice().sort((a, b) => a.order - b.order);

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = '해당하는 부품이 없습니다.';
      container.appendChild(empty);
      return;
    }

    for (const def of list) {
      // <button> 은 내부 박스가 콘텐츠 크기로 줄어드는 브라우저가 있어
      // 그리드 레이아웃이 뭉개진다. div + role 로 만든다.
      const item = document.createElement('div');
      item.className = 'part-item';
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.dataset.partId = def.id;
      if (def.id === this.selectedDefId) item.classList.add('selected');

      const icon = document.createElement('canvas');
      icon.width = 48;
      icon.height = 48;
      icon.className = 'part-icon';
      const ictx = icon.getContext('2d');
      try {
        drawPartIcon(ictx, def, 48, { deployed: true, legExtended: true });
      } catch (e) {
        /* 아이콘 실패는 무시 */
      }

      const info = document.createElement('div');
      info.className = 'part-info';
      const name = document.createElement('div');
      name.className = 'part-name';
      name.textContent = def.name;
      const meta = document.createElement('div');
      meta.className = 'part-meta';
      const bits = [formatMass(def.mass)];
      if (def.engine) bits.push(`${(def.engine.thrust / 1000).toFixed(0)} kN`);
      if (def.fuel?.lf) bits.push(`LF ${def.fuel.lf}`);
      if (def.fuel?.sf) bits.push(`SF ${def.fuel.sf}`);
      meta.textContent = bits.join(' · ');
      info.append(name, meta);

      const cost = document.createElement('div');
      cost.className = 'part-cost';
      cost.textContent = partTotalCost(def).toLocaleString('ko-KR');

      item.append(icon, info, cost);
      item.title = def.description ?? def.name;
      const select = () => {
        this.selectDef(def.id);
        for (const el of container.querySelectorAll('.part-item'))
          el.classList.remove('selected');
        item.classList.add('selected');
        audio.play('click');
      };
      item.addEventListener('click', select);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      });
      container.appendChild(item);
    }
  }

  /** 카테고리 탭 렌더링 */
  renderCategories(container) {
    container.innerHTML = '';
    for (const cat of CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-btn';
      if (cat.id === this.category) btn.classList.add('active');
      btn.innerHTML = `<span class="cat-icon">${cat.icon}</span><span>${cat.name}</span>`;
      btn.addEventListener('click', () => {
        this.category = cat.id;
        this.search = '';
        for (const el of container.querySelectorAll('.cat-btn'))
          el.classList.remove('active');
        btn.classList.add('active');
        if (this.paletteEl) this.renderPalette(this.paletteEl);
        audio.play('click');
      });
      container.appendChild(btn);
    }
  }

  /** 통계 패널 렌더링 */
  renderStats(container) {
    const s = this.stats ?? this.craft.stats(1, 9.81);
    const v = this.craft.validate();
    container.innerHTML = '';

    const rows = [
      ['총질량', formatMass(s.mass)],
      ['건조질량', formatMass(s.dryMass)],
      ['추진제', formatMass(s.propellantMass)],
      ['높이', `${s.height.toFixed(1)} m`],
      ['부품 수', `${s.partCount}개`],
      ['스테이지', `${s.stages}단`],
      ['총 Δv (진공)', `${Math.round(s.deltaV)} m/s`],
      ['이륙 추중비', s.liftoffTwr.toFixed(2)],
      ['정적 안정', s.staticMargin.toFixed(3)],
      ['승무원', `${s.crew}명`],
      ['비용', s.cost.toLocaleString('ko-KR')],
    ];

    for (const [k, val] of rows) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `<span>${k}</span><b>${val}</b>`;
      container.appendChild(row);
    }

    const note = document.createElement('div');
    note.className = 'stat-note';
    note.textContent = `${describeDeltaV(s.deltaV)} · ${describeTwr(s.liftoffTwr)}`;
    container.appendChild(note);

    // 단별 표
    if (s.stageList?.length) {
      const table = document.createElement('div');
      table.className = 'stage-table';
      s.vacuumStageList.forEach((st, i) => {
        const row = document.createElement('div');
        row.className = 'stage-row';
        row.innerHTML = `
          <span class="stage-idx">#${i + 1}</span>
          <span>${Math.round(st.deltaV)} m/s</span>
          <span>TWR ${st.twr.toFixed(2)}</span>
          <span>${Math.round(st.burnTime)}s</span>`;
        table.appendChild(row);
      });
      container.appendChild(table);
    }

    // 경고
    for (const err of v.errors) {
      const el = document.createElement('div');
      el.className = 'stat-error';
      el.textContent = `✕ ${err}`;
      container.appendChild(el);
    }
    for (const warn of v.warnings) {
      const el = document.createElement('div');
      el.className = 'stat-warn';
      el.textContent = `⚠ ${warn}`;
      container.appendChild(el);
    }
  }
}
