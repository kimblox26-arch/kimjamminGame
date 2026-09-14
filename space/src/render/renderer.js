// ORBITER — 비행 장면 렌더러
//
// 합성 순서: 하늘 → 별 → 다른 천체 → 태양 → 현재 천체(원반 또는 지형)
//          → 궤도선 → 잔해 → 기체 → 화염/파티클 → 화면 효과 → 후처리
//
// 모든 셰이딩은 실제 태양 방향을 따라간다. 그래서 같은 로켓도 발사대에서는
// 옆에서, 궤도에서는 정면에서 빛을 받는다.

import {
  TAU,
  clamp,
  clamp01,
  lerp,
  withAlpha,
  mixHex,
  Vec2,
  vLen,
  vNorm,
} from '../core/math.js';
import { drawPart, drawHeatGlow } from './partsdraw.js';
import {
  drawBodyDisc,
  drawTerrain,
  drawSurfaceProps,
  drawFlags,
  drawOrbitPath,
} from './planetdraw.js';
import { Starfield, drawSky, drawCloudDeck } from './starfield.js';
import { ParticleSystem, drawPlume, ShockwaveManager } from './particles.js';
import { PostFX, drawSunDisc } from './postfx.js';

/** ctx.filter 지원 여부 */
let _filterOk = null;
function filterSupported() {
  if (_filterOk !== null) return _filterOk;
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.filter = 'brightness(0.5)';
    _filterOk = c.filter === 'brightness(0.5)';
  } catch (e) {
    _filterOk = false;
  }
  return _filterOk;
}

export class FlightRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.starfield = new Starfield();
    this.particles = new ParticleSystem({ max: opts.maxParticles ?? 2400 });
    this.shockwaves = new ShockwaveManager();
    this.postfx = new PostFX();
    this.debris = [];
    this.quality = 2;
    this.showTrajectory = true;
    this.time = 0;
    this._sp = { x: 0, y: 0 };
    this.setQuality(2);
  }

  setQuality(level) {
    this.quality = level;
    this.particles.quality = [0.35, 0.6, 1, 1.4][clamp(level, 0, 3)];
    this.particles.max = [700, 1200, 2400, 3600][clamp(level, 0, 3)];
    this.starfield.enabled = level > 0;
    this.postfx.setQuality(level);
    this.postfx.enabled = level > 0;
  }

  /* ── 잔해 ─────────────────────────────────────────────── */

  addDebris(list) {
    for (const d of list) this.debris.push(d);
    if (this.debris.length > 60) this.debris.splice(0, this.debris.length - 60);
  }

  updateDebris(dt, body) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.debris.splice(i, 1);
        continue;
      }
      const r2 = d.pos.x * d.pos.x + d.pos.y * d.pos.y;
      const r = Math.sqrt(r2);
      if (r > 1) {
        const f = -body.mu / (r2 * r);
        d.vel.x += d.pos.x * f * dt;
        d.vel.y += d.pos.y * f * dt;
      }
      if (body.atmo.exists) {
        const alt = r - body.radius;
        if (alt < body.atmo.height) {
          const rho = body.atmo.densityAt(alt);
          const sv = new Vec2(
            d.vel.x + d.pos.y * body.rotationRate,
            d.vel.y - d.pos.x * body.rotationRate
          );
          const s = vLen(sv);
          if (s > 1) {
            const area = d.def.size.w * d.def.size.h * 0.5;
            const drag = 0.5 * rho * s * s * area * 0.8;
            const a = drag / Math.max(d.mass, 1);
            d.vel.x -= (sv.x / s) * a * dt;
            d.vel.y -= (sv.y / s) * a * dt;
          }
        }
      }
      d.pos.x += d.vel.x * dt;
      d.pos.y += d.vel.y * dt;
      d.angle += d.angularVelocity * dt;

      const theta = Math.atan2(d.pos.y, d.pos.x);
      const surfaceR = body.terrain.radiusAt(theta);
      if (r < surfaceR) {
        this.particles.explosion(d.pos.x, d.pos.y, 0.6);
        this.debris.splice(i, 1);
      }
    }
  }

  clearDebris() {
    this.debris.length = 0;
  }

  /* ── 조명 계산 ────────────────────────────────────────── */

  /**
   * 태양 방향과 그로부터 나오는 모든 조명 파라미터를 한 번에 구한다.
   */
  computeLighting(system, body, vessel, t, camera) {
    const bodyWorld = body.absolutePositionAt(t);
    const starPos = system.star.absolutePositionAt(t);
    const vesselLocal = vessel ? vessel.pos : new Vec2(0, body.radius);
    const absX = bodyWorld.x + vesselLocal.x;
    const absY = bodyWorld.y + vesselLocal.y;

    const sunDir = vNorm(new Vec2(starPos.x - absX, starPos.y - absY));
    const up = vNorm(vesselLocal);
    // 지평선 위 태양 고도각
    const sunElevation = Math.asin(clamp(sunDir.x * up.x + sunDir.y * up.y, -1, 1));

    // 태양의 화면 위치 — 너무 멀면 방향만 써서 화면 밖에 배치
    const sp = camera.worldToScreen(starPos.x, starPos.y);
    const maxOff = Math.max(camera.width, camera.height) * 3;
    let sunScreenX = sp.x;
    let sunScreenY = sp.y;
    let sunOnScreen = true;
    if (
      !Number.isFinite(sp.x) ||
      !Number.isFinite(sp.y) ||
      Math.abs(sp.x - camera.width / 2) > maxOff ||
      Math.abs(sp.y - camera.height / 2) > maxOff
    ) {
      const c = Math.cos(-camera.rotation);
      const s = Math.sin(-camera.rotation);
      const dx = sunDir.x * c - sunDir.y * s;
      const dy = sunDir.x * s + sunDir.y * c;
      const d = Math.max(camera.width, camera.height) * 1.1;
      sunScreenX = camera.width / 2 + dx * d;
      sunScreenY = camera.height / 2 - dy * d;
      sunOnScreen = false;
    }

    const altitude = vessel ? vessel.altitude : body.radius;
    const atmoDensity =
      body.atmo.exists && altitude < body.atmo.height
        ? clamp01(body.atmo.densityAt(altitude) / 1.225)
        : 0;

    // 그림자(일식·야간)
    const sunFactor = vessel ? clamp01(vessel.sunFactor ?? 1) : 1;

    // 주변광: 대기 산란 + 지면 반사(행성광)
    const planetshine = clamp01(1 - altitude / Math.max(body.radius * 0.6, 1)) * 0.14;
    const ambient = clamp(0.1 + atmoDensity * 0.34 + planetshine, 0.08, 0.55);

    // 태양의 겉보기 크기는 각지름으로 정해야 한다.
    // 직교 투영에서 반지름 × 줌 을 쓰면 13 Gm 떨어진 항성이 화면을 덮어버린다.
    const sunDist = Math.max(
      Math.hypot(starPos.x - absX, starPos.y - absY),
      system.star.radius * 1.01
    );
    const halfAngle = Math.asin(clamp(system.star.radius / sunDist, 0, 1));
    const ASSUMED_FOV = 1.05; // 수직 화각 약 60°
    const sunRadius = clamp(
      (halfAngle / ASSUMED_FOV) * camera.height,
      2,
      camera.height * 0.22
    );

    return {
      sunDir,
      sunAngle: Math.atan2(sunDir.y, sunDir.x),
      sunElevation,
      sunScreenX,
      sunScreenY,
      sunOnScreen,
      sunRadius,
      atmoDensity,
      ambient,
      sunFactor,
      altitude,
      bodyWorld,
      starPos,
    };
  }

  /* ── 메인 렌더 ────────────────────────────────────────── */

  render(o) {
    const ctx = this.ctx;
    const camera = o.camera;
    const vessel = o.vessel;
    const system = o.system;
    const t = o.time;
    this.time = t;

    const body = vessel?.body ?? system.home;
    const lit = this.computeLighting(system, body, vessel, t, camera);
    const bodyWorld = lit.bodyWorld;
    const altitude = lit.altitude;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    // dpr 보정된 변환을 되살린다
    const dpr = camera.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* 1. 하늘 */
    const skyOpacity = drawSky(ctx, camera, body, altitude, {
      sunElevation: lit.sunElevation,
      sunScreenX: lit.sunScreenX,
      sunScreenY: lit.sunScreenY,
    });
    this.starfield.render(ctx, camera, t * 0.05, skyOpacity, {
      atmosphere: lit.atmoDensity,
    });

    /* 2. 태양 */
    if (
      lit.sunScreenX > -camera.width &&
      lit.sunScreenX < camera.width * 2 &&
      lit.sunScreenY > -camera.height &&
      lit.sunScreenY < camera.height * 2
    ) {
      drawSunDisc(ctx, {
        x: lit.sunScreenX,
        y: lit.sunScreenY,
        radius: lit.sunRadius,
        atmosphere: lit.atmoDensity,
      });
    }

    /* 3. 다른 천체 */
    this.renderOtherBodies(ctx, camera, system, body, t, lit);

    /* 4. 현재 천체 */
    const bodyScreenRadius = body.radius * camera.zoom;
    const nearSurface =
      altitude < body.radius * 0.35 && bodyScreenRadius > camera.width;
    if (nearSurface) {
      drawTerrain(ctx, camera, body, bodyWorld, {
        time: t,
        sunAngle: lit.sunAngle,
        skyColor: body.atmo.exists ? body.atmo.hazeColor : null,
        // 공기원근은 아주 옅어야 한다. 세게 넣으면 지면이 하얗게 날아간다.
        hazeStrength: lit.atmoDensity * 0.3,
        lowDetail: this.quality < 2,
      });
      if (body.surfaceProps) {
        drawSurfaceProps(
          ctx,
          camera,
          body,
          bodyWorld,
          body.surfaceProps.props,
          t,
          lit.sunAngle
        );
        drawFlags(ctx, camera, body, bodyWorld, body.surfaceProps.flags, t);
      }
      if (body.atmo.exists && this.quality >= 2) {
        drawCloudDeck(ctx, camera, body, altitude, t);
      }
    } else {
      drawBodyDisc(ctx, camera, body, bodyWorld, {
        sunDir: lit.sunDir,
        time: t,
      });
    }

    /* 5. 궤도 경로 */
    if (this.showTrajectory && vessel && !nearSurface && vessel.orbit) {
      drawOrbitPath(ctx, camera, vessel.orbit, bodyWorld, {
        color: '#6fd8ff',
        alpha: 0.3,
        samples: 160,
        maxRadius: body.soi,
        glow: this.quality >= 2,
      });
    }

    /* 6. 잔해 */
    this.renderDebris(ctx, camera, bodyWorld, lit);

    /* 7. 기체 */
    if (vessel && !vessel.destroyed) {
      this.renderVessel(ctx, camera, vessel, bodyWorld, lit);
    }

    /* 7b. 엔진 불빛 — 어두울 때 화염이 주변을 밝힌다 */
    if (vessel && this.quality >= 1) {
      this._renderEngineLight(ctx, camera, vessel, bodyWorld, lit);
    }

    /* 8. 파티클 */
    this.particles.setLight(
      Math.cos(lit.sunAngle - camera.rotation),
      -Math.sin(lit.sunAngle - camera.rotation)
    );
    this.particles.render(ctx, camera);
    this.shockwaves.render(ctx, camera);

    /* 9. 화면 효과 */
    if (vessel) this.renderScreenEffects(ctx, camera, vessel, skyOpacity, lit);

    /* 10. 후처리 */
    if (this.postfx.enabled) {
      const sunVisible =
        lit.sunFactor *
        clamp01(
          1 -
            Math.max(
              Math.abs(lit.sunScreenX - camera.width / 2) / camera.width,
              Math.abs(lit.sunScreenY - camera.height / 2) / camera.height
            )
        );
      this.postfx.apply(ctx, this.canvas, {
        dpr,
        sun:
          sunVisible > 0.02
            ? {
                x: lit.sunScreenX,
                y: lit.sunScreenY,
                visible: sunVisible,
                size: clamp(lit.sunRadius, 3, 60),
              }
            : null,
      });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  renderOtherBodies(ctx, camera, system, current, t, lit) {
    const currentWorld = lit.bodyWorld;
    for (const other of system.list) {
      if (other === current) continue;
      if (other.type === 'star') continue; // 태양은 따로 그렸다
      const p = other.absolutePositionAt(t);
      const screenR = other.radius * camera.zoom;

      if (screenR < 0.5) {
        const sp = camera.worldToScreen(p.x, p.y, this._sp);
        if (
          sp.x < -10 ||
          sp.y < -10 ||
          sp.x > camera.width + 10 ||
          sp.y > camera.height + 10
        )
          continue;
        // 행성은 별보다 밝고 반짝이지 않는다
        ctx.fillStyle = withAlpha(other.palette.map ?? '#ffffff', 0.9);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 1.6, 0, TAU);
        ctx.fill();
        continue;
      }
      if (!camera.isVisible(p.x, p.y, other.radius * 3)) continue;

      // 각 천체는 태양에서 오는 빛을 받는다
      const sunDir = vNorm(
        new Vec2(lit.starPos.x - p.x, lit.starPos.y - p.y)
      );
      drawBodyDisc(ctx, camera, other, p, { sunDir, time: t });
    }
  }

  renderDebris(ctx, camera, bodyWorld, lit) {
    for (const d of this.debris) {
      const wx = bodyWorld.x + d.pos.x;
      const wy = bodyWorld.y + d.pos.y;
      if (!camera.isVisible(wx, wy, 20)) continue;
      const sp = camera.worldToScreen(wx, wy, this._sp);
      const ang = -(d.angle - Math.PI / 2);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(ang + camera.rotation);
      ctx.scale(camera.zoom, -camera.zoom);
      drawPart(ctx, d.def, {
        light: {
          x: lit.sunDir.x * c - lit.sunDir.y * s,
          y: lit.sunDir.x * s + lit.sunDir.y * c,
          ambient: lit.ambient,
        },
        detail: clamp01((d.def.size.h * camera.zoom) / 40),
        soot: 0.4,
      });
      ctx.restore();
    }
  }

  /* ── 기체 ─────────────────────────────────────────────── */

  /**
   * 지면 그림자 — 태양 방향 반대쪽으로 기체 실루엣을 눕혀 깐다.
   * 착륙/발사 때 기체가 지면에 "붙어 있다" 는 느낌을 준다.
   */
  _drawGroundShadow(ctx, camera, vessel, sp, lit) {
    const alt = vessel.terrainAltitude ?? vessel.altitude ?? 1e9;
    const body = vessel.body;
    if (!body || alt > 400) return;
    const len = vessel.bounds?.length ?? 10;
    const wid = vessel.bounds?.width ?? 3;
    const zoom = camera.zoom;
    if (len * zoom < 6) return;

    // 고도가 높을수록 흐리고 멀어진다
    const near = clamp01(1 - alt / 400);
    const alpha = 0.42 * near * near * clamp01(lit.sunFactor) *
      clamp01(Math.sin(lit.sunElevation ?? 1) * 2);
    if (alpha < 0.015) return;

    // 태양의 화면상 방향 (그림자는 반대쪽으로 눕는다)
    const sunElev = clamp(lit.sunElevation ?? 1, 0.08, Math.PI / 2);
    const stretch = clamp(1 / Math.tan(sunElev), 0.4, 6);
    const dir = lit.sunScreenX > camera.width / 2 ? -1 : 1;

    // 지면 y — 기체 바로 아래
    const groundY = sp.y + (alt + len * 0.5) * zoom;
    const shW = wid * zoom * 0.55;
    const shL = len * zoom * stretch * 0.5;

    ctx.save();
    ctx.translate(sp.x + dir * shL * 0.45, groundY);
    ctx.scale(1, 0.26);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(shL, shW));
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.5})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(shL, shW * 1.6), shW * 1.8, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  renderVessel(ctx, camera, vessel, bodyWorld, lit) {
    const wx = bodyWorld.x + vessel.pos.x;
    const wy = bodyWorld.y + vessel.pos.y;
    const sp = camera.worldToScreen(wx, wy, this._sp);
    const zoom = camera.zoom;

    const size = (vessel.bounds?.length ?? 10) * zoom;
    if (size < 3) {
      // 너무 작으면 아이콘
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffd27a', 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 8, 0, TAU);
      ctx.stroke();
      return;
    }

    // 지면에 드리우는 그림자 — 지표 가까이 있을 때만
    this._drawGroundShadow(ctx, camera, vessel, sp, lit);

    // 기체 로컬 좌표계에서의 광원 방향
    const ang = -(vessel.angle - Math.PI / 2);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const lx = lit.sunDir.x * c - lit.sunDir.y * s;
    const ly = lit.sunDir.x * s + lit.sunDir.y * c;

    // 그림자 속이면 전체를 어둡게
    const shadow = lit.sunFactor;
    const useFilter = filterSupported() && shadow < 0.96;

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(ang + camera.rotation);
    ctx.scale(zoom, -zoom);
    ctx.translate(-vessel.com.x, -vessel.com.y);

    // 열 글로우 (부품 뒤 레이어)
    if (vessel.hottestFraction > 0.22) {
      for (const part of vessel.parts) {
        if (part.destroyed) continue;
        const frac = clamp01(
          (part.temperature - 300) / Math.max(part.maxTemp - 300, 1)
        );
        if (frac < 0.22) continue;
        ctx.save();
        ctx.translate(part.localX, part.localY);
        drawHeatGlow(ctx, part.def, frac);
        ctx.restore();
      }
    }

    if (useFilter) {
      ctx.filter = `brightness(${lerp(0.3, 1, shadow).toFixed(3)})`;
    }

    // 측면 부품을 먼저(뒤에) 그린다
    const ordered = [...vessel.parts].sort((a, b) => {
      const ra = a.def.radialOnly ? 0 : 1;
      const rb = b.def.radialOnly ? 0 : 1;
      return ra - rb;
    });

    const sootLevel = clamp01(vessel.fuelBurned / 4000);

    for (const part of ordered) {
      if (part.destroyed) continue;
      ctx.save();
      ctx.translate(part.localX, part.localY);
      if (part.mirrored) ctx.scale(-1, 1);
      if (part.rot) ctx.rotate(part.rot);

      const partPx = Math.max(part.def.size.w, part.def.size.h) * zoom;
      const heat = clamp01((part.temperature - 500) / 1500);

      drawPart(ctx, part.def, {
        light: {
          x: part.mirrored ? -lx : lx,
          y: ly,
          ambient: lit.ambient,
        },
        uid: part.uid,
        scaleW: part.scaleW ?? 1,
        scaleH: part.scaleH ?? 1,
        tint: part.tint ?? null,
        detail: clamp01(partPx / 45),
        fuelFraction: this._partFuelFraction(part),
        heat,
        soot: part.localY < vessel.com.y ? sootLevel : sootLevel * 0.3,
        enginePower: part.running ? part.throttleActual : 0,
        chuteState: part.chuteState,
        chuteProgress: part.chuteProgress,
        legExtended: part.legExtended,
        legCompression: part.legCompression,
        finDeflection: part.finDeflection,
        airbrakeOpen: part.airbrakeOpen,
        deployed: part.deployed,
        lightOn: part.lightOn,
        docked: vessel.docked,
        active: part.active,
        sunFactor: lit.sunFactor,
        ablator: part.shield
          ? part.shield.ablator / Math.max(part.shield.maxAblator, 1)
          : 1,
      });
      ctx.restore();
    }

    ctx.filter = 'none';
    ctx.restore();

    // 엔진 화염 (월드 좌표)
    this.renderEngines(ctx, camera, vessel, bodyWorld, lit);
  }

  _partFuelFraction(part) {
    const def = part.def.fuel;
    if (!def) return 1;
    let cur = 0;
    let max = 0;
    for (const k in def) {
      if (k === 'ec') continue;
      cur += part.resources[k] ?? 0;
      max += def[k];
    }
    return max > 0 ? cur / max : 1;
  }

  renderEngines(ctx, camera, vessel, bodyWorld, lit) {
    const atmoDensity = lit.atmoDensity;
    const vacuum = 1 - clamp01(atmoDensity * 2.2);

    for (const part of vessel.parts) {
      if (part.destroyed || !part.isEngine || !part.running) continue;
      const power = part.throttleActual;
      if (power < 0.02 || part.flameout) continue;

      const e = part.def.engine;
      const localX = part.localX - vessel.com.x;
      const localY = part.localY - vessel.com.y - part.def.size.h / 2;
      const c = Math.cos(vessel.angle - Math.PI / 2);
      const s = Math.sin(vessel.angle - Math.PI / 2);
      const rx = localX * c - localY * s;
      const ry = localX * s + localY * c;
      const wx = bodyWorld.x + vessel.pos.x + rx;
      const wy = bodyWorld.y + vessel.pos.y + ry;

      const ga = part.gimbalAngle;
      const dirX = -Math.cos(vessel.angle + ga);
      const dirY = -Math.sin(vessel.angle + ga);

      // 지면 충돌 — 화염이 지표에 부딪히면 옆으로 퍼지는 연기 기둥이 생긴다.
      // 발사 순간의 화염 편향(flame trench) 이 로켓의 상징적인 그림이다.
      // 노즐 자체의 지표 고도를 직접 잰다. vessel.altitude 는 기준 반지름
      // 기준이고 terrainAltitude 도 기체 원점 기준이라, 맨 아래 달린
      // 노즐의 실제 지면까지 거리와는 한 단 높이만큼 어긋난다.
      // 실제 발사에서는 화염이 닿지 않는 높이까지도 연기 구름이 따라 올라온다
      const plumeReach = Math.max((e.plumeLength ?? 2.5) * 3.5 * power, 26 * power);
      if (atmoDensity > 0.02 && vessel.body?.terrain) {
        const bdx = wx - bodyWorld.x;
        const bdy = wy - bodyWorld.y;
        const theta =
          Math.atan2(bdy, bdx) - vessel.body.rotationAt(vessel.universeTime ?? 0);
        const nozzleAlt =
          Math.hypot(bdx, bdy) - vessel.body.terrain.radiusAt(theta);
        if (nozzleAlt >= -3 && nozzleAlt < plumeReach) {
          const drop = Math.max(nozzleAlt, 0);
          const gx = wx + dirX * drop;
          const gy = wy + dirY * drop;
          const up = vessel.up;
          const strength = power * clamp01(1 - drop / Math.max(plumeReach, 0.1));
          this.particles.groundDust(
            gx,
            gy,
            up.x,
            up.y,
            strength * 2.4,
            part.def.size.w * (part.scaleW ?? 1) * 1.6
          );
        }
      }

      drawPlume(ctx, camera, {
        x: wx,
        y: wy,
        dirX,
        dirY,
        power,
        length: (e.plumeLength ?? 2.5) * (1 + vacuum * 0.9),
        width: part.def.size.w * 0.7,
        color: e.plumeColor ?? '#ffd07a',
        vacuum,
      });

      this.particles.engineExhaust({
        x: wx,
        y: wy,
        dirX,
        dirY,
        power,
        scale: part.def.size.w * 0.7,
        color: e.plumeColor ?? '#ffd07a',
        atmoDensity,
        dt: 0.016,
        vx: vessel.vel.x * 0.15,
        vy: vessel.vel.y * 0.15,
      });
    }
  }

  /**
   * 엔진 불빛 — 화염 근처를 따뜻한 빛으로 물들인다.
   * 밤이나 우주에서 로켓이 자기 빛을 받는 느낌을 만든다.
   */
  _renderEngineLight(ctx, camera, vessel, bodyWorld, lit) {
    let power = 0;
    let cx = 0;
    let cy = 0;
    let total = 0;
    for (const part of vessel.parts) {
      if (part.destroyed || !part.isEngine || !part.running || part.flameout) continue;
      const p = part.throttleActual * (part.scaleW ?? 1);
      if (p < 0.02) continue;
      power += p;
      cx += part.localX * p;
      cy += part.localY * p;
      total += p;
    }
    if (total < 0.02) return;
    cx /= total;
    cy /= total;

    // 밝은 대낮에는 거의 보이지 않는다
    const ambientDark = 1 - clamp01(lit.sunFactor * 0.55 + lit.atmoDensity * 0.5);
    const strength = clamp01(power * 0.5) * ambientDark;
    if (strength < 0.03) return;

    const lx = cx - vessel.com.x;
    const ly = cy - vessel.com.y;
    const a = vessel.angle - Math.PI / 2;
    const rx = lx * Math.cos(a) - ly * Math.sin(a);
    const ry = lx * Math.sin(a) + ly * Math.cos(a);
    const sp = camera.worldToScreen(
      bodyWorld.x + vessel.pos.x + rx,
      bodyWorld.y + vessel.pos.y + ry
    );
    const r = clamp((vessel.bounds?.length ?? 10) * camera.zoom * 1.6, 30, 900);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
    g.addColorStop(0, withAlpha('#ffb45a', 0.3 * strength));
    g.addColorStop(0.35, withAlpha('#ff8a3a', 0.12 * strength));
    g.addColorStop(1, withAlpha('#ff6a2a', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ── 화면 효과 ────────────────────────────────────────── */

  renderScreenEffects(ctx, camera, vessel, skyOpacity, lit) {
    const w = camera.width;
    const h = camera.height;

    // 재진입 플라즈마
    if (vessel.heatFlux > 30000) {
      const t = clamp01((vessel.heatFlux - 30000) / 400000);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.18,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.72
      );
      g.addColorStop(0, withAlpha('#ff8a3a', 0.05 * t));
      g.addColorStop(0.6, withAlpha('#ff5a1e', 0.2 * t));
      g.addColorStop(1, withAlpha('#ff3a10', 0.4 * t));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 고G 블랙아웃
    if (vessel.gForce > 7) {
      const t = clamp01((vessel.gForce - 7) / 11);
      const g = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * (0.46 - t * 0.32),
        w / 2,
        h / 2,
        Math.max(w, h) * 0.62
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${0.88 * t})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // 대기 산란 헤이즈 — 낮은 고도에서 화면 전체가 살짝 뿌옇다
    if (skyOpacity > 0.02) {
      ctx.fillStyle = withAlpha(vessel.body.atmo.hazeColor, 0.05 * skyOpacity);
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* ── 갱신 ─────────────────────────────────────────────── */

  update(dt, vessel) {
    const gravity = vessel
      ? vNorm(new Vec2(-vessel.pos.x, -vessel.pos.y))
      : new Vec2(0, -1);
    const g = vessel ? vessel.body.gravityMagnitudeAt(vLen(vessel.pos)) : 9.8;
    gravity.x *= g;
    gravity.y *= g;
    this.particles.update(dt, gravity);
    this.shockwaves.update(dt);
    if (vessel) this.updateDebris(dt, vessel.body);

    if (vessel && vessel.heatFlux > 40000 && !vessel.destroyed) {
      const bodyWorld = vessel.body.absolutePositionAt(this.time);
      const sv = vessel.surfaceVelocity();
      const vhat = vNorm(sv);
      const nose = vessel.bounds?.minY ?? 0;
      const c = Math.cos(vessel.angle - Math.PI / 2);
      const s = Math.sin(vessel.angle - Math.PI / 2);
      const ly = nose - vessel.com.y;
      const rx = -ly * s;
      const ry = ly * c;
      this.particles.reentryPlasma(
        bodyWorld.x + vessel.pos.x + rx,
        bodyWorld.y + vessel.pos.y + ry,
        -vhat.x,
        -vhat.y,
        clamp01(vessel.heatFlux / 500000),
        vessel.bounds?.width ?? 2
      );
    }
  }

  explodeAt(worldX, worldY, scale, velocity) {
    this.particles.explosion(worldX, worldY, scale, {
      vx: velocity?.x ?? 0,
      vy: velocity?.y ?? 0,
    });
    this.shockwaves.add(worldX, worldY, scale * 40, 0.7, '#ffd8a0');
  }

  clear() {
    this.particles.clear();
    this.shockwaves.clear();
    this.clearDebris();
  }
}
