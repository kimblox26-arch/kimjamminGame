// FREE FREELY - 설계도 → 실제 기체 조립기
// 블루프린트(부품 배치 목록)를 받아 3D 모델, 강체, 공력면, 엔진, 착륙장치,
// 충돌체, 성능 지표를 한 번에 만들어 낸다.
import * as THREE from 'three';
import { clamp, lerp } from '../core/utils.js';
import { RigidBody } from '../physics/rigidbody.js';
import { AeroSurface, BodyDrag, atmosphere } from '../physics/aero.js';
import { PARTS, paint, emissive } from './parts.js';

const mirrorCache = new Map();

/** 지오메트리를 X축 기준으로 반사 (와인딩 순서까지 보정) */
function mirrorGeometry(geo) {
  if (mirrorCache.has(geo.uuid)) return mirrorCache.get(geo.uuid);
  const g = geo.clone();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
  if (g.attributes.normal) {
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setX(i, -n.getX(i));
  }
  if (g.index) {
    const arr = g.index.array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = t;
    }
    g.index.needsUpdate = true;
  }
  pos.needsUpdate = true;
  mirrorCache.set(geo.uuid, g);
  return g;
}

/** 오브젝트 트리를 좌우 반전 복제 (userData 내 참조도 복제본으로 재연결) */
function mirrorObject(obj) {
  const clone = obj.clone(true);
  const src = [], dst = [];
  obj.traverse((o) => src.push(o));
  clone.traverse((o) => dst.push(o));
  const map = new Map();
  for (let i = 0; i < src.length && i < dst.length; i++) map.set(src[i], dst[i]);
  for (let i = 0; i < dst.length; i++) {
    const o = dst[i];
    if (o.isMesh) o.geometry = mirrorGeometry(o.geometry);
    o.position.x = -o.position.x;
    o.rotation.y = -o.rotation.y;
    o.rotation.z = -o.rotation.z;
    // Object3D.clone() 은 userData 를 JSON 복제하므로 메시 참조가 끊긴다 → 재연결
    const su = src[i] ? src[i].userData : null;
    if (su) {
      for (const k in su) {
        if (su[k] && su[k].isObject3D && map.has(su[k])) o.userData[k] = map.get(su[k]);
        else if (su[k] && su[k].isObject3D) delete o.userData[k];
      }
    }
  }
  return clone;
}

/**
 * 부품 형상에 맞는 충돌구(sphere) 목록 생성.
 * 날개처럼 얇고 긴 부품을 하나의 큰 구로 감싸면 지면과 헛충돌이 나므로
 * 스팬/길이 방향으로 작은 구를 나눠 배치한다.
 */
function makeColliderSpheres(def, size, pos, spanSign) {
  const out = [];
  const [l, h, w] = size;
  const isWing = def.cat === 'wing';
  const vertical = !!def.vertical;
  if (isWing && !vertical) {
    const span = w, chord = l;
    const r = Math.max(chord * 0.22, h * 0.6, 0.22);
    for (const t of [0.18, 0.52, 0.86]) {
      out.push({
        pos: new THREE.Vector3(pos.x + span * t * spanSign, pos.y + span * t * 0.05, pos.z + chord * 0.4),
        radius: r,
      });
    }
    return out;
  }
  if (isWing && vertical) {
    const span = h, chord = l;
    const r = Math.max(chord * 0.24, w * 0.6, 0.22);
    for (const t of [0.25, 0.72]) {
      out.push({ pos: new THREE.Vector3(pos.x, pos.y + span * t, pos.z + chord * 0.4), radius: r });
    }
    return out;
  }
  const thick = Math.max(h, w);
  if (l > thick * 1.7) {
    // 길쭉한 동체/엔진: 길이 방향 분할
    const n = l > thick * 3.2 ? 3 : 2;
    const r = thick * 0.5;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      out.push({ pos: new THREE.Vector3(pos.x, pos.y, pos.z - l * 0.5 + r + (l - r * 2) * t), radius: r });
    }
    return out;
  }
  out.push({ pos: pos.clone(), radius: Math.max(l, h, w) * 0.46 });
  return out;
}

function partSize(p, def) {
  const s = p.size || def.size;
  const k = p.scale || 1;
  return [s[0] * k, s[1] * k, s[2] * k];
}

/** 블루프린트 정적 분석 — 설계 화면의 실시간 수치 표시용 */
export function analyzeBlueprint(bp) {
  let mass = 0, fuel = 0, thrust = 0, thrustAB = 0, wingArea = 0, balloonVolume = 0;
  let cgx = 0, cgy = 0, cgz = 0;
  let acWeighted = 0, acArea = 0, macSum = 0;
  let hasCockpit = false, hasGear = false, hasEngine = false, hasVfin = false, hasHstab = false;
  let hasBurner = false, hasRocket = false, hasChute = false, gearCount = 0;
  let spanMax = 0, lengthMin = 0, lengthMax = 0, weapons = 0, power = 0;
  const counts = {};

  for (const p of bp.parts || []) {
    const def = PARTS[p.type];
    if (!def) continue;
    counts[p.type] = (counts[p.type] || 0) + 1;
    const size = partSize(p, def);
    const k = p.scale || 1;
    const instances = def.mirror && Math.abs(p.bz || 0) > 0.05 ? 2 : 1;
    const m = def.mass * Math.pow(k, 2.6) * instances;
    mass += m;
    for (let s = 0; s < instances; s++) {
      const sign = s === 0 ? 1 : -1;
      cgx += (p.bz || 0) * sign * m / instances;
      cgy += (p.by || 0) * m / instances;
      cgz += (p.bx || 0) * m / instances;
    }
    lengthMin = Math.min(lengthMin, (p.bx || 0) - size[0] / 2);
    lengthMax = Math.max(lengthMax, (p.bx || 0) + size[0] / 2);

    if (def.fuel) fuel += def.fuel * Math.pow(k, 3) * instances;
    if (def.structure) fuel += 40 * def.structure * k * instances;
    if (def.power) power += def.power * instances;
    if (def.cockpit) hasCockpit = true;
    if (def.gear) { hasGear = true; gearCount += instances; }
    if (def.chute) hasChute = true;
    if (def.weapon) weapons += instances;
    if (def.engine) {
      const e = def.engine;
      if (e.type !== 'burner' && e.type !== 'rcs') {
        hasEngine = true;
        thrust += e.thrust * Math.pow(k, 2.2) * instances;
        thrustAB += e.thrust * (e.afterburner || 1) * Math.pow(k, 2.2) * instances;
      }
      if (e.type === 'burner') { hasBurner = true; }
      if (e.type === 'rocket') hasRocket = true;
    }
    if (def.balloon) balloonVolume += def.balloon.volume * Math.pow(k, 3) * instances;
    if (def.wing) {
      const vertical = !!def.vertical;
      const span = (vertical ? size[1] : size[2]);
      const chord = size[0];
      const area = span * chord * 0.85 * instances;
      if (!vertical) {
        wingArea += area;
        acArea += area;
        acWeighted += ((p.bx || 0) - chord * 0.25) * area;
        macSum += chord * area;
        spanMax = Math.max(spanMax, (Math.abs(p.bz || 0) + span) * 2);
      }
      if (p.type === 'vfin') hasVfin = true;
      if (p.type === 'hstab' || p.type === 'canard') hasHstab = true;
    }
  }

  const totalMass = mass + fuel * 0.8;
  if (mass > 0) { cgx /= mass; cgy /= mass; cgz /= mass; }
  const ac = acArea > 0 ? acWeighted / acArea : 0;
  const mac = acArea > 0 ? macSum / acArea : 1;
  const atm = atmosphere(0);
  const balloonLift = balloonVolume > 0
    ? (atm.density - atm.density * (atm.temperature / 390)) * balloonVolume * 9.80665
    : 0;
  const weight = totalMass * 9.80665;
  const stallSpeed = wingArea > 0 ? Math.sqrt((2 * weight) / (atm.density * wingArea * 1.45)) : Infinity;
  // 간이 최고속도: 추력 = 항력 가정
  const cd = 0.028 + (wingArea > 0 ? 0.012 : 0.05);
  const frontal = Math.max(1.2, wingArea * 0.06 + 1.5);
  const topSpeed = Math.sqrt((2 * Math.max(thrustAB, thrust)) / (atm.density * cd * frontal + 0.0001));
  // 정적 안정성: 공력중심이 무게중심보다 뒤(bx 작음)에 있어야 안정
  const staticMargin = acArea > 0 ? (cgz - ac) / Math.max(0.4, mac) : 0;

  const warnings = [];
  if (!hasCockpit) warnings.push({ level: 'error', text: '조종석이 없습니다. 탑승할 수 없습니다.' });
  if (!hasEngine && balloonLift <= 0 && !hasBurner) warnings.push({ level: 'error', text: '추진 장치나 부력 장치가 없습니다.' });
  if (wingArea <= 0.5 && balloonVolume <= 0 && !hasRocket) warnings.push({ level: 'error', text: '양력을 낼 날개가 없습니다.' });
  if (wingArea > 0 && !hasHstab) warnings.push({ level: 'warn', text: '수평 미익(또는 카나드)이 없어 피치 제어가 불가능합니다.' });
  if (wingArea > 0 && !hasVfin) warnings.push({ level: 'warn', text: '수직 미익이 없어 방향 안정성이 매우 낮습니다.' });
  if (!hasGear && balloonVolume <= 0) warnings.push({ level: 'warn', text: '착륙장치가 없습니다. 착륙 시 파손됩니다.' });
  if (gearCount === 1) warnings.push({ level: 'warn', text: '착륙장치가 1개뿐입니다. 지상에서 넘어집니다.' });
  if (staticMargin < -0.02 && wingArea > 0) warnings.push({ level: 'warn', text: '무게중심이 공력중심보다 뒤에 있습니다 — 피치 불안정(정적 마진 ' + staticMargin.toFixed(2) + ').' });
  if (staticMargin > 0.45) warnings.push({ level: 'info', text: '정적 마진이 매우 큽니다 — 안정적이지만 기동성이 둔합니다.' });
  if (fuel < 40 && hasEngine) warnings.push({ level: 'warn', text: '연료가 거의 없습니다. 연료 탱크를 추가하세요.' });
  if (!hasChute) warnings.push({ level: 'info', text: '비상 낙하산을 달면 추락 시 생존 확률이 올라갑니다.' });

  return {
    mass: totalMass, dryMass: mass, fuel, thrust, thrustAB, wingArea, balloonVolume, balloonLift,
    cg: { x: cgx, y: cgy, z: cgz }, ac, mac, staticMargin, stallSpeed, topSpeed,
    wingLoading: wingArea > 0 ? totalMass / wingArea : 0,
    twr: weight > 0 ? Math.max(thrust, thrustAB) / weight : 0,
    length: lengthMax - lengthMin, span: spanMax, gearCount, weapons, power,
    hasCockpit, hasEngine, hasGear, hasBurner, hasRocket, hasChute, counts, warnings,
    partCount: (bp.parts || []).length,
  };
}

/* ------------------------------------------------------------------ */
/* 조립                                                               */
/* ------------------------------------------------------------------ */
export function buildCraft(blueprint, scene) {
  const root = new THREE.Group();
  const model = new THREE.Group();      // 질량중심 보정용 내부 그룹
  root.add(model);
  root.name = 'craft:' + (blueprint.name || 'custom');

  const instances = [];
  const pointMasses = [];
  const colliders = [];
  const surfaces = [];
  const engines = [];
  const gears = [];
  const weapons = [];
  const lights = [];
  const buoyancyParts = [];
  let cockpit = null;
  let balloonVolume = 0, heliumVolume = 0, burnerPart = null;
  let fuelCapacity = 0, structureStrength = 0, hasHeatShield = false, chute = null;
  let avionics = 0, flares = 0, power = 0;

  const spawnInstance = (p, def, side, mirrored) => {
    const size = partSize(p, def);
    const k = p.scale || 1;
    const bz = (p.bz || 0) * side;
    const pos = new THREE.Vector3(bz, p.by || 0, -(p.bx || 0));   // 설계도 → 기체 좌표
    const built = def.build({ size, color: p.color || blueprint.color, scale: k, def });
    // 기본 날개 지오메트리는 스팬이 -X 방향으로 뻗는다.
    // 우측(+X) 패널은 반사 복제를 사용해야 형상과 공력 위치가 일치한다.
    const obj = mirrored ? mirrorObject(built) : built;
    const spanSign = mirrored ? 1 : -1;
    obj.position.copy(pos);
    if (p.rot) obj.rotation.x = (p.rot || 0) * Math.PI / 180;
    if (p.yaw) obj.rotation.y = (p.yaw || 0) * Math.PI / 180 * side;
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    model.add(obj);

    const mass = def.mass * Math.pow(k, 2.6);
    const radius = Math.max(size[0], size[1], size[2]) * 0.42;
    const inst = {
      def, type: p.type, obj, pos, size, scale: k, side, spanSign, mass,
      health: 100, burning: false, detached: false, radius,
    };
    instances.push(inst);
    pointMasses.push({ pos: pos.clone(), mass, radius: radius * 0.8 });
    for (const c of makeColliderSpheres(def, size, pos, spanSign)) {
      colliders.push({ pos: c.pos, radius: c.radius, inst, key: p.type });
    }

    /* 조종석 */
    if (def.cockpit && !cockpit) {
      cockpit = {
        pos: pos.clone().add(new THREE.Vector3(def.cockpit.eye[0], def.cockpit.eye[1] * k, def.cockpit.eye[2] * k)),
        closed: def.cockpit.closed,
        inst,
      };
    }

    /* 공력면 */
    if (def.wing) {
      const w = def.wing;
      const vertical = !!def.vertical;
      const span = vertical ? size[1] : size[2];
      const chord = size[0];
      const area = span * chord * 0.85;
      const pairAR = (vertical ? 1 : 2) * span * span / Math.max(0.01, area);
      const centerOffset = vertical
        ? new THREE.Vector3(0, span * 0.45, chord * 0.25)
        : new THREE.Vector3(span * 0.45 * spanSign, span * 0.45 * 0.025, chord * 0.25);
      let control = w.control || 'none';
      let controlSign = w.controlSign ?? 1;
      // 롤 입력(+ = 우선회): 우측 패널은 양력 감소, 좌측 패널은 증가
      if (control === 'roll') controlSign = -spanSign;
      if (control === 'yaw') controlSign = -1;
      // 상반각(dihedral): 스팬 방향으로 위로 꺾인 날개의 양력 법선은 안쪽으로 기운다
      // (스팬축 × 코드축 = (-sinΓ, cosΓ, 0) · 우측 패널 기준).
      // 이 때문에 옆미끄럼(사이드슬립)이 생기면 바람을 맞는 쪽 날개의 받음각이 커져
      // 기체를 원래대로 되돌리는 롤 복원 모멘트가 발생한다.
      const dih = (w.dihedral || 0) * Math.PI / 180;
      const axisUp = vertical
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(-Math.sin(dih) * spanSign, Math.cos(dih), 0);
      const surf = new AeroSurface({
        pos: pos.clone().add(centerOffset),
        axisForward: new THREE.Vector3(0, 0, -1),
        axisUp,
        area, chord, aspect: pairAR,
        camber: w.camber ?? 0.02,
        stallAngle: w.stall ?? 0.3,
        control, controlSign,
        controlEffect: w.controlEffect ?? 0.5,
        flapEffect: w.flapEffect ?? 0,
        efficiency: 0.82 + (w.efficiencyBonus || 0),
        cd0: 0.0085,
        groundEffect: !vertical,
      });
      surf.inst = inst;
      surf.vertical = vertical;
      surf.span = span;
      surf.spanSign = spanSign;
      surfaces.push(surf);
      inst.surface = surf;
      // 조종면 애니메이션용 메시 (날개 뒷부분)
      inst.controlKind = control;
    }

    /* 엔진 */
    if (def.engine) {
      const e = def.engine;
      const eng = {
        def, inst, type: e.type,
        pos: pos.clone(),
        dir: new THREE.Vector3(0, 0, -1),      // 추력 방향 (기체 전방)
        maxThrust: e.thrust * Math.pow(k, 2.2),
        afterburner: e.afterburner || 1,
        fuelRate: e.fuelRate * Math.pow(k, 2.2),
        abFuelRate: (e.abFuelRate || e.fuelRate * 2.5) * Math.pow(k, 2.2),
        spool: e.spool ?? 1,
        rpm: 0, running: false, health: 100, vacuum: !!e.vacuum,
        staticBoost: e.staticBoost || 1,
        heat: e.heat || 0,
        propHub: obj.userData ? obj.userData.propHub : null,
        nozzleMesh: obj.userData ? obj.userData.nozzleMesh : null,
        glow: obj.userData ? obj.userData.glow : null,
        obj,
      };
      if (e.type === 'burner') {
        eng.dir.set(0, 1, 0);
        burnerPart = eng;
      }
      if (e.type === 'rcs') {
        // RCS는 기체 중심에서 벗어난 위치에 따라 토크를 만든다
        eng.rcs = true;
      }
      engines.push(eng);
      inst.engine = eng;
    }

    /* 착륙 장치 */
    if (def.gear) {
      const gd = def.gear;
      // 스키드/플로트처럼 긴 접지면은 앞뒤 두 점으로 나눠 지지한다
      const offsets = gd.points
        ? gd.points.map((o) => new THREE.Vector3(o[0] * k, o[1] * k, o[2] * k * (side === -1 ? 1 : 1)))
        : [new THREE.Vector3(0, 0, 0)];
      const share = 1 / offsets.length;
      offsets.forEach((off, gi) => {
        gears.push({
          inst, pos: pos.clone().add(off), rootPos: pos.clone(),
          restLength: size[1] * 0.5 + gd.radius * k,
          travel: gd.travel * k,
          stiffness: gd.spring / 96000,          // mainGear 기준 상대 강성
          spring: gd.spring * Math.pow(k, 2) * share,
          damper: gd.damper * Math.pow(k, 2) * share,
          radius: gd.radius * k,
          steer: gd.steer, brakeFactor: gd.brake * share,
          skid: !!gd.skid,
          compression: 0, contact: false, slip: 0, spinAngle: 0,
          primary: gi === 0,
          wheel: (gi === 0 && obj.userData && obj.userData.wheel && obj.userData.wheel.isObject3D) ? obj.userData.wheel : null,
          obj,
        });
      });
      if (def.buoyancy) buoyancyParts.push({ pos: pos.clone(), volume: def.buoyancy.volume * Math.pow(k, 3), radius: gd.radius * k * 2 });
    }

    /* 시스템 */
    if (def.fuel) fuelCapacity += def.fuel * Math.pow(k, 3);
    if (def.structure) { structureStrength += def.structure * k; fuelCapacity += 40 * def.structure * k; }
    if (def.balloon) {
      if (def.balloon.helium) heliumVolume += def.balloon.volume * Math.pow(k, 3);
      else balloonVolume += def.balloon.volume * Math.pow(k, 3);
      inst.envelope = { volume: def.balloon.volume * Math.pow(k, 3), pos: pos.clone(), helium: !!def.balloon.helium };
    }
    if (def.heatShield) hasHeatShield = true;
    if (def.chute) chute = { pos: pos.clone(), drag: def.chute.drag, deployTime: def.chute.deployTime, deployed: false, amount: 0 };
    if (def.avionics) avionics += 1;
    if (def.flares) flares += def.flares;
    if (def.power) power += def.power;
    if (def.weapon) {
      weapons.push({
        inst, pos: pos.clone(),
        muzzle: pos.clone().add(new THREE.Vector3(0, 0, -size[0] / 2)),
        rate: def.weapon.rate, damage: def.weapon.damage,
        speed: def.weapon.speed, spread: def.weapon.spread,
        cooldown: 0,
      });
    }
    if (def.light) {
      const spot = new THREE.SpotLight(0xfff4e0, 0, def.light.distance, def.light.angle, 0.45, 1.2);
      spot.position.copy(pos);
      spot.target.position.copy(pos).add(new THREE.Vector3(0, -0.25, -30));
      model.add(spot, spot.target);
      const lensRef = obj.userData && obj.userData.lens && obj.userData.lens.isObject3D ? obj.userData.lens : null;
      lights.push({ spot, lens: lensRef, intensity: def.light.intensity });
    }
    return inst;
  };

  for (const p of blueprint.parts || []) {
    const def = PARTS[p.type];
    if (!def) continue;
    const doMirror = def.mirror && Math.abs(p.bz || 0) > 0.05;
    if (doMirror) {
      spawnInstance(p, def, -1, false);   // 좌측 패널 (스팬 -X)
      spawnInstance(p, def, 1, true);     // 우측 패널 (반사 복제, 스팬 +X)
    } else {
      spawnInstance(p, def, 1, false);
    }
  }

  /* ------------------------- 강체 / 질량 특성 ------------------------- */
  const body = new RigidBody({ mass: 1000 });
  if (pointMasses.length) body.setFromPointMasses(pointMasses);
  const stats = analyzeBlueprint(blueprint);
  // 연료 질량 포함
  const fuelMass = fuelCapacity * 0.8;
  body.setMass(body.mass + fuelMass);
  model.position.copy(body.centerOfMass).multiplyScalar(-1);

  // 착륙장치 강성 자동 보정
  // 무게중심 기준 전/후 지렛대 원리로 각 접지점의 정하중을 구하고,
  // 침하량이 스트로크의 ~40%가 되도록 스프링/댐퍼를 설계한다.
  // 이렇게 하면 사용자가 어떤 배치를 만들어도 지상 자세가 안정적이다.
  if (gears.length) {
    const W = body.mass * 9.80665;
    const cgZ = body.centerOfMass.z;
    const front = [], rear = [];
    for (const g of gears) {
      // -z = 기수 방향이므로 z < cgZ 면 앞쪽 접지점
      (g.pos.z < cgZ ? front : rear).push(g);
    }
    const meanArm = (arr) => (arr.length ? arr.reduce((a, g) => a + Math.abs(g.pos.z - cgZ), 0) / arr.length : 0);
    const aF = meanArm(front), aR = meanArm(rear);
    let loadF = 0, loadR = 0;
    if (front.length && rear.length && aF + aR > 0.05) {
      loadF = W * (aR / (aF + aR));
      loadR = W - loadF;
    } else {
      loadF = front.length ? W * (front.length / gears.length) : 0;
      loadR = W - loadF;
    }
    const assign = (arr, load) => {
      if (!arr.length) return;
      const per = load / arr.length;
      for (const g of arr) {
        const targetSag = Math.max(0.05, g.travel * 0.4);
        g.staticLoad = per;
        g.spring = (per / targetSag) * (g.stiffness || 1) * 1.1;
        g.damper = 2 * 0.75 * Math.sqrt(g.spring * Math.max(60, per / 9.80665));
      }
    };
    assign(front, loadF);
    assign(rear, loadR);
  }

  // 동체 저항 추정 (부품 단면 합)
  let areaX = 0.8, areaY = 0.8, areaZ = 0.6;
  for (const inst of instances) {
    if (inst.def.cat === 'wing') continue;
    areaX += inst.size[0] * inst.size[1] * 0.18;
    areaY += inst.size[0] * inst.size[2] * 0.18;
    areaZ += inst.size[1] * inst.size[2] * 0.3;
  }
  const bodyDrag = new BodyDrag({
    areaX, areaY, areaZ, cd: 0.4,
    pos: body.centerOfMass.clone(),
    spinDamp: 0.55,
  });

  const craft = {
    name: blueprint.name || '무명 기체',
    blueprint,
    root, model, body, instances, colliders, surfaces, engines, gears, weapons, lights,
    bodyDrag, cockpit, stats,
    balloonVolume, heliumVolume, burnerPart,
    fuelCapacity: Math.max(20, fuelCapacity),
    fuel: Math.max(20, fuelCapacity),
    structureStrength: Math.max(1, structureStrength),
    hasHeatShield, chute, avionics, flares, power,
    buoyancyParts,
    integrity: 100,
    kind: classify(blueprint, stats),
  };

  // 기체 전체 반경 (카메라/충돌용)
  let radius = 2;
  for (const c of colliders) radius = Math.max(radius, c.pos.length() + c.radius);
  craft.radius = radius;

  if (scene) scene.add(root);
  void paint; void emissive; void clamp; void lerp;
  return craft;
}

function classify(bp, stats) {
  if (stats.balloonVolume > 300) return 'balloon';
  if (stats.hasRocket && stats.wingArea < 12) return 'spacecraft';
  if (stats.hasRocket) return 'rocketplane';
  if (stats.twr > 0.6 && stats.wingArea > 10) return 'fighter';
  if (stats.mass > 9000) return 'airliner';
  if (stats.thrust < 1) return 'glider';
  return 'plane';
}

/** 기체 제거 */
export function disposeCraft(craft, scene) {
  if (!craft) return;
  if (scene) scene.remove(craft.root);
  craft.root.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.dispose && o.userData.disposable !== false) {
      // 공유 지오메트리는 캐시 재사용하므로 파괴하지 않는다
    }
  });
}
