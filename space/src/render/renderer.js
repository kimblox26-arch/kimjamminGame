// ORBITER — 비행 장면 렌더러
// 배경 → 천체 → 지형 → 잔해 → 기체 → 파티클 → 효과 순으로 합성한다.

import {
  TAU,
  clamp,
  clamp01,
  lerp,
  withAlpha,
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
import { Starfield, drawSky, drawVignette } from './starfield.js';
import { ParticleSystem, drawPlume, ShockwaveManager } from './particles.js';
import { CHUTE_STATE } from '../physics/aero.js';

export class FlightRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.starfield = new Starfield();
    this.particles = new ParticleSystem({ max: opts.maxParticles ?? 2400 });
    this.shockwaves = new ShockwaveManager();
    this.debris = [];
    this.quality = opts.quality ?? 2;
    this.showTrajectory = true;
    this.time = 0;
    this._sp = { x: 0, y: 0 };
  }

  setQuality(level) {
    this.quality = level;
    this.particles.quality = [0.35, 0.6, 1, 1.4][clamp(level, 0, 3)];
    this.particles.max = [700, 1200, 2400, 3600][clamp(level, 0, 3)];
    this.starfield.enabled = level > 0;
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
      // 중력
      const r2 = d.pos.x * d.pos.x + d.pos.y * d.pos.y;
      const r = Math.sqrt(r2);
      if (r > 1) {
        const f = -body.mu / (r2 * r);
        d.vel.x += d.pos.x * f * dt;
        d.vel.y += d.pos.y * f * dt;
      }
      // 항력
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

      // 지면 충돌
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

  /* ── 메인 렌더 ────────────────────────────────────────── */

  /**
   * @param {object} ctxObj { camera, system, vessel, time, settings }
   */
  render(o) {
    const ctx = this.ctx;
    const camera = o.camera;
    const vessel = o.vessel;
    const system = o.system;
    const t = o.time;
    this.time = t;

    const w = camera.width;
    const h = camera.height;

    const body = vessel?.body ?? system.home;
    const bodyWorld = body.absolutePositionAt(t);
    const altitude = vessel ? vessel.altitude : body.radius;

    // 항성 방향
    const starPos = system.star.absolutePositionAt(t);
    const vesselAbs = vessel
      ? new Vec2(bodyWorld.x + vessel.pos.x, bodyWorld.y + vessel.pos.y)
      : bodyWorld;
    const sunDir = vNorm(
      new Vec2(starPos.x - vesselAbs.x, starPos.y - vesselAbs.y)
    );
    const sunAngle = Math.atan2(sunDir.y, sunDir.x);

    /* 1. 하늘 / 우주 */
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const skyFactor = drawSky(ctx, camera, body, altitude, sunAngle - Math.atan2(vessel?.pos.y ?? 0, vessel?.pos.x ?? 1));
    this.starfield.render(ctx, camera, t * 0.05, skyFactor);

    /* 2. 다른 천체들 (원반) */
    this.renderOtherBodies(ctx, camera, system, body, t, sunDir);

    /* 3. 현재 천체 */
    const bodyScreenRadius = body.radius * camera.zoom;
    const nearSurface = altitude < body.radius * 0.35 && bodyScreenRadius > camera.width;
    if (nearSurface) {
      drawTerrain(ctx, camera, body, bodyWorld, { time: t, sunAngle });
      if (body.surfaceProps) {
        drawSurfaceProps(ctx, camera, body, bodyWorld, body.surfaceProps.props, t);
        drawFlags(ctx, camera, body, bodyWorld, body.surfaceProps.flags, t);
      }
    } else {
      drawBodyDisc(ctx, camera, body, bodyWorld, { sunDir, time: t });
    }

    /* 4. 궤도 경로 */
    if (this.showTrajectory && vessel && !nearSurface && vessel.orbit) {
      drawOrbitPath(ctx, camera, vessel.orbit, bodyWorld, {
        color: '#6fd8ff',
        alpha: 0.35,
        samples: 160,
        maxRadius: body.soi,
      });
    }

    /* 5. 잔해 */
    this.renderDebris(ctx, camera, bodyWorld);

    /* 6. 기체 */
    if (vessel && !vessel.destroyed) {
      this.renderVessel(ctx, camera, vessel, bodyWorld, sunDir);
    }

    /* 7. 파티클 */
    this.particles.render(ctx, camera);
    this.shockwaves.render(ctx, camera);

    /* 8. 화면 효과 */
    if (vessel) this.renderScreenEffects(ctx, camera, vessel, skyFactor);

    if (o.settings?.graphics?.reduceMotion !== true) {
      drawVignette(ctx, camera, 0.3);
    }
  }

  renderOtherBodies(ctx, camera, system, current, t, sunDir) {
    const currentWorld = current.absolutePositionAt(t);
    for (const other of system.list) {
      if (other === current) continue;
      const p = other.absolutePositionAt(t);
      const dx = p.x - currentWorld.x;
      const dy = p.y - currentWorld.y;
      const dist = Math.hypot(dx, dy);
      const angular = (other.radius / Math.max(dist, 1)) * camera.zoom * dist;
      // 화면상 반지름이 0.5px 이상이거나 항성이면 그린다
      const screenR = other.radius * camera.zoom;
      if (screenR < 0.4 && other.type !== 'star') {
        // 밝은 점으로
        const sp = camera.worldToScreen(p.x, p.y, this._sp);
        if (
          sp.x < -10 ||
          sp.y < -10 ||
          sp.x > camera.width + 10 ||
          sp.y > camera.height + 10
        )
          continue;
        ctx.fillStyle = withAlpha(other.palette.map ?? '#ffffff', 0.85);
        ctx.fillRect(sp.x - 1, sp.y - 1, 2.4, 2.4);
        continue;
      }
      if (!camera.isVisible(p.x, p.y, other.radius * 3)) continue;
      const localSun = vNorm(new Vec2(-dx, -dy));
      drawBodyDisc(ctx, camera, other, p, {
        sunDir: other.type === 'star' ? sunDir : localSun,
        time: t,
      });
    }
  }

  renderDebris(ctx, camera, bodyWorld) {
    for (const d of this.debris) {
      const wx = bodyWorld.x + d.pos.x;
      const wy = bodyWorld.y + d.pos.y;
      if (!camera.isVisible(wx, wy, 20)) continue;
      const sp = camera.worldToScreen(wx, wy, this._sp);
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(-(d.angle - Math.PI / 2) + camera.rotation);
      ctx.scale(camera.zoom, -camera.zoom);
      drawPart(ctx, d.def, null);
      ctx.restore();
    }
  }

  /* ── 기체 ─────────────────────────────────────────────── */

  renderVessel(ctx, camera, vessel, bodyWorld, sunDir) {
    const wx = bodyWorld.x + vessel.pos.x;
    const wy = bodyWorld.y + vessel.pos.y;
    const sp = camera.worldToScreen(wx, wy, this._sp);
    const zoom = camera.zoom;

    // 너무 작으면 아이콘으로
    const size = (vessel.bounds?.length ?? 10) * zoom;
    if (size < 3) {
      ctx.fillStyle = '#ffd27a';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = withAlpha('#ffd27a', 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 7, 0, TAU);
      ctx.stroke();
      return;
    }

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(-(vessel.angle - Math.PI / 2) + camera.rotation);
    ctx.scale(zoom, -zoom);
    ctx.translate(-vessel.com.x, -vessel.com.y);

    // 열 글로우 (뒤쪽 레이어)
    if (vessel.hottestFraction > 0.25) {
      for (const part of vessel.parts) {
        if (part.destroyed) continue;
        const frac = clamp01(
          (part.temperature - 300) / Math.max(part.maxTemp - 300, 1)
        );
        if (frac < 0.25) continue;
        ctx.save();
        ctx.translate(part.localX, part.localY);
        drawHeatGlow(ctx, part.def, frac);
        ctx.restore();
      }
    }

    // 부품 — 측면 부품을 먼저(뒤에) 그린다
    const ordered = [...vessel.parts].sort((a, b) => {
      const ra = a.def.radialOnly ? 0 : 1;
      const rb = b.def.radialOnly ? 0 : 1;
      return ra - rb;
    });

    for (const part of ordered) {
      if (part.destroyed) continue;
      ctx.save();
      ctx.translate(part.localX, part.localY);
      if (part.mirrored) ctx.scale(-1, 1);
      if (part.rot) ctx.rotate(part.rot);

      const state = {
        fuelFraction: this._partFuelFraction(part),
        heat: clamp01((part.temperature - 600) / 1400),
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
        ablator: part.shield
          ? part.shield.ablator / Math.max(part.shield.maxAblator, 1)
          : 1,
      };
      drawPart(ctx, part.def, state);
      ctx.restore();
    }

    ctx.restore();

    // 엔진 화염 (월드 좌표로 별도 그리기)
    this.renderEngines(ctx, camera, vessel, bodyWorld);
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

  renderEngines(ctx, camera, vessel, bodyWorld) {
    const atmoDensity = vessel.body.atmo.exists
      ? clamp01(vessel.body.atmo.densityAt(vessel.altitude) / 1.225)
      : 0;

    for (const part of vessel.parts) {
      if (part.destroyed || !part.isEngine || !part.running) continue;
      const power = part.throttleActual;
      if (power < 0.02 || part.flameout) continue;

      const e = part.def.engine;
      // 노즐 위치 (부품 하단)
      const localX = part.localX - vessel.com.x;
      const localY = part.localY - vessel.com.y - part.def.size.h / 2;
      const c = Math.cos(vessel.angle - Math.PI / 2);
      const s = Math.sin(vessel.angle - Math.PI / 2);
      const rx = localX * c - localY * s;
      const ry = localX * s + localY * c;
      const wx = bodyWorld.x + vessel.pos.x + rx;
      const wy = bodyWorld.y + vessel.pos.y + ry;

      // 분사 방향 (기체 후방 + 짐벌)
      const ga = part.gimbalAngle;
      const dirX = -Math.cos(vessel.angle + ga);
      const dirY = -Math.sin(vessel.angle + ga);

      drawPlume(ctx, camera, {
        x: wx,
        y: wy,
        dirX,
        dirY,
        power,
        length: (e.plumeLength ?? 2.5) * (1 + (1 - atmoDensity) * 0.8),
        width: part.def.size.w * 0.75,
        color: e.plumeColor ?? '#ffd07a',
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

  /* ── 화면 효과 ────────────────────────────────────────── */

  renderScreenEffects(ctx, camera, vessel, skyFactor) {
    const w = camera.width;
    const h = camera.height;

    // 재진입 플라즈마
    if (vessel.heatFlux > 30000) {
      const t = clamp01((vessel.heatFlux - 30000) / 400000);
      const g = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.2,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.7
      );
      g.addColorStop(0, withAlpha('#ff6a28', 0));
      g.addColorStop(1, withAlpha('#ff5a1e', 0.35 * t));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // 고G 블랙아웃
    if (vessel.gForce > 8) {
      const t = clamp01((vessel.gForce - 8) / 10);
      const g = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * (0.45 - t * 0.3),
        w / 2,
        h / 2,
        Math.max(w, h) * 0.6
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${0.85 * t})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // 대기 산란 헤이즈
    if (skyFactor > 0.02 && vessel.altitude > 0) {
      ctx.fillStyle = withAlpha(
        vessel.body.atmo.hazeColor,
        0.06 * skyFactor
      );
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

    // 재진입 플라즈마 파티클
    if (vessel && vessel.heatFlux > 40000 && !vessel.destroyed) {
      const bodyWorld = vessel.body.absolutePositionAt(this.time);
      const sv = vessel.surfaceVelocity();
      const vhat = vNorm(sv);
      const nose = vessel.bounds?.minY ?? 0;
      const c = Math.cos(vessel.angle - Math.PI / 2);
      const s = Math.sin(vessel.angle - Math.PI / 2);
      const lx = 0;
      const ly = nose - vessel.com.y;
      const rx = lx * c - ly * s;
      const ry = lx * s + ly * c;
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

  /** 폭발 연출 */
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
