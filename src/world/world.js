// FREE FREELY - 월드 통합 (하늘/지형/바다/구름/구조물 + 환경 질의 API)
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/utils.js';
import { Settings } from '../core/settings.js';
import { Sky } from './sky.js';
import { Terrain } from './terrain.js';
import { Ocean } from './ocean.js';
import { Clouds } from './clouds.js';
import { Props } from './props.js';
import { Environment, atmosphere } from '../physics/aero.js';

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.env = new Environment();
    this.time = 0;                 // 누적 시간(초)
    this.timeOfDay = Settings.get('timeOfDay');
    this.weather = Settings.get('weather');
    this.cloudCover = 0.15;
    this.underwater = false;
    this._envTimer = 0;
    this._tmp = new THREE.Vector3();
  }

  async init(onProgress) {
    const p = (v, label) => onProgress && onProgress(v, label);
    p(0.02, '지형 데이터 생성');
    this.terrain = new Terrain(this.scene);
    await this.terrain.generate((f) => p(0.02 + f * 0.55, '지형 고도 계산 ' + Math.round(f * 100) + '%'));
    p(0.6, '대기 산란 모델 구성');
    this.sky = new Sky(this.scene);
    p(0.68, '해양 시뮬레이션 준비');
    this.ocean = new Ocean(this.scene, this.terrain);
    p(0.76, '구름 생성');
    this.clouds = new Clouds(this.scene, { maxPuffs: 4200 });
    this.clouds.onThunder = (pos, dist) => { if (this.onThunder) this.onThunder(pos, dist); };
    p(0.86, '구조물 배치');
    this.props = new Props(this.scene, this.terrain);
    p(0.94, '환경 반사 캡처');

    // 환경 반사 (금속 도장/유리에 하늘이 반영됨)
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(1, 60000, this.cubeRT);
    this.scene.environment = this.cubeRT.texture;

    this.scene.fog = new THREE.FogExp2(0xbdd6ee, 0.00007);
    this.applyWeather(this.weather);
    this.update(0, { position: new THREE.Vector3(0, 60, 0) }, true);
    p(1, '완료');
    return this;
  }

  applyWeather(weather) {
    this.weather = weather;
    const cfg = {
      clear: { cover: 0.12, fog: 0.000028, sea: 0.35, wind: 3.5, turb: 0.3 },
      cloudy: { cover: 0.42, fog: 0.00006, sea: 0.6, wind: 7, turb: 0.55 },
      overcast: { cover: 0.78, fog: 0.00011, sea: 0.85, wind: 11, turb: 0.8 },
      storm: { cover: 0.97, fog: 0.00026, sea: 1.6, wind: 19, turb: 1.7 },
    }[weather] || { cover: 0.12, fog: 0.000045, sea: 0.35, wind: 3.5, turb: 0.3 };
    this.cloudCover = cfg.cover;
    this.baseFog = cfg.fog;
    this.seaState = cfg.sea;
    this.env.configure({ windSpeed: Settings.get('windStrength') * (cfg.wind / 3.5), turbulence: Settings.get('turbulence') * (cfg.turb / 0.3) * 0.3, weather });
    if (this.clouds) this.clouds.rebuild(Settings.get('cloudDensity') * (0.6 + cfg.cover), weather);
  }

  setTimeOfDay(t) { this.timeOfDay = ((t % 24) + 24) % 24; }

  update(dt, camera, force = false) {
    this.time += dt;
    // 밤낮 순환
    if (Settings.get('dayNightRunning')) {
      const dayLen = Math.max(0.5, Settings.get('dayLengthMinutes')) * 60;
      this.timeOfDay = (this.timeOfDay + (dt / dayLen) * 24) % 24;
    }
    const camPos = camera.position;
    this.env.update(dt, camPos);
    this.sky.update(this.timeOfDay, camPos, this.cloudCover, this.time);
    this.terrain.update(camPos, force);
    this.ocean.update(dt, camera, this.sky, this.seaState);
    if (Settings.get('volumetricClouds')) {
      this.clouds.mesh.visible = true;
      this.clouds.update(dt, camera, this.sky, this.env.wind);
    } else {
      this.clouds.mesh.visible = false;
    }
    const night = 1 - clamp(this.sky.dayFactor * 1.6, 0, 1);
    this.props.update(dt, this.time, night, this.ocean, this.env.wind);

    // 고도에 따른 안개 감소 (상공은 맑음) + 구름 통과 시 짙어짐
    const alt = Math.max(0, camPos.y);
    const inCloud = this.clouds ? this.clouds.densityAt(camPos) : 0;
    this.inCloud = inCloud;
    const altFactor = lerp(1, 0.12, smoothstep(clamp(alt / 5200, 0, 1)));
    let density = this.baseFog * altFactor + inCloud * 0.004;
    // 수중
    const waterH = this.waterHeightAt(camPos.x, camPos.z);
    this.underwater = camPos.y < waterH;
    if (this.underwater) density = 0.045;
    this.scene.fog.density = density;
    this.scene.fog.color.copy(this.underwater ? new THREE.Color(0x0a2436) : this.sky.fogColor);
    if (inCloud > 0.01 && !this.underwater) {
      this.scene.fog.color.lerp(new THREE.Color(0xd8e2ee), inCloud * 0.8);
    }
    // 셰이더는 three 의 FogExp2 와 같은 계수를 쓴다 (제곱근을 넘기면 안개가 과도해진다)
    this.ocean.setFog(density * 0.95);
    this.clouds.setFogDensity(density * 0.7);
    this.scene.background = null;

    // 환경 반사 주기적 갱신
    this._envTimer -= dt;
    if ((this._envTimer <= 0 || force) && Settings.get('quality') !== 'low') {
      this._envTimer = 2.5;
      this.updateEnvMap(camPos);
    }
  }

  updateEnvMap(camPos) {
    const r = this.renderer;
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    this.cubeCam.position.set(camPos.x, Math.max(camPos.y, 20), camPos.z);
    const hidden = [];
    this.scene.traverse((o) => {
      if (o.userData && o.userData.noEnvReflect && o.visible) { o.visible = false; hidden.push(o); }
    });
    this.cubeCam.update(r, this.scene);
    for (const o of hidden) o.visible = true;
    r.shadowMap.autoUpdate = prevShadow;
  }

  /* ------------------------------ 질의 API ------------------------------ */
  heightAt(x, z) { return this.terrain.heightAt(x, z); }
  waterHeightAt(x, z) { return this.ocean.heightAt(x, z, this.ocean.time); }
  atmosphereAt(y) { return atmosphere(y); }

  /** 지면/수면/구조물을 종합한 표면 정보 */
  surfaceAt(x, z) {
    const ground = this.terrain.heightAt(x, z);
    const water = this.waterHeightAt(x, z);
    const deck = this.props.deckHeightAt(x, z);
    if (deck !== null && deck > ground) {
      return { height: deck, type: 'deck', material: 'deck', water: false };
    }
    if (ground < water) {
      return { height: water, type: 'water', material: 'water', water: true, groundHeight: ground };
    }
    return { height: ground, type: 'ground', material: this.terrain.materialAt(x, z), water: false };
  }

  /** 구 충돌 검사 (지형/수면/구조물) */
  sampleCollision(pos, radius) {
    const s = this.surfaceAt(pos.x, pos.z);
    const hit = pos.y - radius <= s.height;
    let normal;
    if (s.type === 'water') normal = this.ocean.normalAt(pos.x, pos.z, this.ocean.time, this._tmp.clone());
    else if (s.type === 'deck') normal = new THREE.Vector3(0, 1, 0);
    else normal = this.terrain.normalAt(pos.x, pos.z, this._tmp.clone());
    const propHit = this.props.checkCollision(pos, radius);
    if (propHit && !propHit.deck) {
      return { hit: true, type: propHit.type, normal: propHit.normal, height: pos.y, material: propHit.type, hardness: propHit.hardness, object: true };
    }
    return { hit, type: s.type, normal, height: s.height, material: s.material, penetration: s.height - (pos.y - radius) };
  }

  get sunDirection() { return this.sky.sunDirection; }
  get isNight() { return this.sky.dayFactor < 0.18; }
}
