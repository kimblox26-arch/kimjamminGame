// GPU 비선형 천수방정식(Nonlinear Shallow Water Equations) 풀이기
//
//   ∂η/∂t + ∂M/∂x + ∂N/∂y = 0                                   (질량 보존)
//   ∂M/∂t + ∂(M²/D)/∂x + ∂(MN/D)/∂y + gD ∂η/∂x = fN − τx/ρ     (x 운동량 보존)
//   ∂N/∂t + ∂(MN/D)/∂x + ∂(N²/D)/∂y + gD ∂η/∂y = −fM − τy/ρ    (y 운동량 보존)
//
//   η: 수면 높이, B: 지반 높이(바다는 음수), D = η − B: 전체 수심, M·N: 단위폭 유량(m²/s)
//   f = 2Ω sinφ: 코리올리 계수, τ/ρ = g n² M √(M²+N²) / D^{7/3}: 매닝 바닥 마찰
//
// 실제 쓰나미 모델(TUNAMI-N2, COMCOT 등)과 같은 엇갈림 격자 + 도약(leap-frog) 시간 적분이며,
// 격자는 지도와 같은 웹 메르카토르 정사각형 셀(한 변 = R·cosφ·Δλ)이라 지구 곡률이 그대로 반영된다.
// 마른 땅/젖은 땅 경계는 면 수심 = max(η) − max(B) 로 처리해, 물이 지형과 건물을 넘거나 돌아 흐른다.

export const G = 9.81;
const R_EARTH = 6371000;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uS;      // 상태: η, B, 최대값(바다=최고 수면, 육지=최대 침수심), 도달시각(-1=미도달)
uniform sampler2D uF;      // 유량: M(동쪽 면), N(북쪽 면)
uniform ivec2 uSize;
uniform float uY0, uDL, uDt, uTime, uManning, uCoriolis, uWrap, uArrive;
uniform int uSponge;
uniform vec4 uForce;       // 가장자리 입사파: 방향(0 없음, 1 서, 2 동, 3 남, 4 북), 높이, 주기, 0
out vec4 o;
const float G = 9.81, R = 6371000., OMEGA = 7.2921e-5, EPS = 1e-3;
float lat(float y) { return 2. * atan(exp(uY0 + y * uDL)) - 1.5707963267948966; }
float cellSize(float y) { return R * cos(lat(y)) * uDL; }   // y: 행 번호(셀 중심은 j + 0.5)
ivec2 wrapC(ivec2 c) {
  c.x = uWrap > .5 ? (c.x + uSize.x) % uSize.x : clamp(c.x, 0, uSize.x - 1);
  c.y = clamp(c.y, 0, uSize.y - 1);
  return c;
}
vec4 S(ivec2 c) { return texelFetch(uS, wrapC(c), 0); }
vec4 F(ivec2 c) { return texelFetch(uF, wrapC(c), 0); }
float forceEta() {
  if (uForce.x < .5 || uTime > uForce.z) return 0.;
  float s = sin(3.14159265 * uTime / uForce.z);
  return uForce.y * s * s;
}
bool inForceBand(ivec2 c) {
  int side = int(uForce.x + .5);
  return side == 1 ? c.x < 3 : side == 2 ? c.x >= uSize.x - 3 : side == 3 ? c.y < 3 : side == 4 ? c.y >= uSize.y - 3 : false;
}
float sponge(ivec2 c) {   // 열린 경계: 가장자리로 갈수록 파를 흡수해 반사를 막는다
  int side = int(uForce.x + .5);
  int d = 100000;
  if (uWrap < .5) {
    if (side != 1) d = min(d, c.x);
    if (side != 2) d = min(d, uSize.x - 1 - c.x);
  }
  if (side != 3) d = min(d, c.y);
  if (side != 4) d = min(d, uSize.y - 1 - c.y);
  float w = clamp(1. - float(d) / float(uSponge), 0., 1.);
  return w * w;
}
`;

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;

// ── 1단계: 질량 보존 → 새 수면 높이
const CONTINUITY = HEAD + `
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = S(c);
  float eta = s.x, bed = s.y, j = float(c.y);
  float sj = cellSize(j + .5), sn = cellSize(j + 1.), ss = cellSize(j);
  vec4 f = F(c);
  float Mw = (c.x == 0 && uWrap < .5) ? f.x : F(c - ivec2(1, 0)).x;
  float Ns = c.y == 0 ? f.y : F(c - ivec2(0, 1)).y;
  float e = eta - uDt / (sj * sj) * (sj * (f.x - Mw) + sn * f.y - ss * Ns);
  e = max(e, bed);
  if (bed < 0.) e *= 1. - .08 * sponge(c);
  if (bed < 0. && inForceBand(c)) e = forceEta();
  float depth = e - bed;
  float val = bed < 0. ? e : depth;                  // 바다: 수면 높이, 육지: 침수 깊이
  float thr = bed < 0. ? uArrive : .1;
  float arr = (s.w < 0. && val > thr) ? uTime : s.w;
  o = vec4(e, bed, max(s.z, val), arr);
}`;

// ── 2단계: 운동량 보존 → 새 유량 (압력경사 + 이류 + 코리올리 + 마찰)
const MOMENTUM = HEAD + `
float faceDx(ivec2 c) { vec4 a = S(c), b = S(c + ivec2(1, 0)); return max(a.x, b.x) - max(a.y, b.y); }
float faceDy(ivec2 c) { vec4 a = S(c), b = S(c + ivec2(0, 1)); return max(a.x, b.x) - max(a.y, b.y); }
float vlim(float D) { return min(80., max(8., 2. * sqrt(G * D))) * D; }   // 수치 안정용 최대 유속
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = S(c), sE = S(c + ivec2(1, 0)), sN = S(c + ivec2(0, 1));
  vec4 f = F(c);
  float j = float(c.y);
  float sx = cellSize(j + .5), sy = cellSize(j + 1.), sDown = cellSize(j);
  float dC = s.x - s.y;

  // x 방향 (동쪽 면)
  float M = f.x, Mo = 0.;
  float D = max(s.x, sE.x) - max(s.y, sE.y);
  if (c.x == uSize.x - 1 && uWrap < .5) Mo = F(c - ivec2(1, 0)).x;
  else if (D > EPS) {
    float Nb = .25 * (f.y + F(c + ivec2(1, 0)).y + F(c - ivec2(0, 1)).y + F(c + ivec2(1, -1)).y);
    float adv = 0.;
    if (D > .1) {
      float Mw = F(c - ivec2(1, 0)).x, Me = F(c + ivec2(1, 0)).x;
      float Dw = faceDx(c - ivec2(1, 0)), De = faceDx(c + ivec2(1, 0));
      adv = M >= 0. ? (M * M / D - (Dw > .1 ? Mw * Mw / Dw : 0.)) / sx
                    : ((De > .1 ? Me * Me / De : 0.) - M * M / D) / sx;
      float v = Nb / D;
      adv += v >= 0. ? v * (M - F(c - ivec2(0, 1)).x) / sDown : v * (F(c + ivec2(0, 1)).x - M) / sy;
    }
    float fc = uCoriolis * 2. * OMEGA * sin(lat(j + .5));
    float fr = G * uManning * uManning * sqrt(M * M + Nb * Nb) / pow(max(D, .05), 7. / 3.);
    Mo = (M - uDt * (G * D * (sE.x - s.x) / sx + adv - fc * Nb)) / (1. + uDt * fr);
    Mo = clamp(Mo, -vlim(D), vlim(D));
    // 한 스텝에 칸에 있는 물보다 많이 빠져나가지 않도록 (네 면 공평 분배)
    Mo = Mo > 0. ? min(Mo, dC * sx / (4. * uDt)) : max(Mo, -(sE.x - sE.y) * sx / (4. * uDt));
  }
  if (uForce.x > .5 && uForce.x < 2.5 && inForceBand(c) && s.y < 0.)
    Mo = (uForce.x < 1.5 ? 1. : -1.) * forceEta() * sqrt(G * -s.y);

  // y 방향 (북쪽 면)
  float N = f.y, No = 0.;
  float Dy = max(s.x, sN.x) - max(s.y, sN.y);
  if (c.y == uSize.y - 1) No = F(c - ivec2(0, 1)).y;
  else if (Dy > EPS) {
    float Mb = .25 * (f.x + F(c + ivec2(0, 1)).x + F(c - ivec2(1, 0)).x + F(c + ivec2(-1, 1)).x);
    float adv = 0.;
    if (Dy > .1) {
      float Ns = F(c - ivec2(0, 1)).y, Nn = F(c + ivec2(0, 1)).y;
      float Ds = faceDy(c - ivec2(0, 1)), Dn = faceDy(c + ivec2(0, 1));
      adv = N >= 0. ? (N * N / Dy - (Ds > .1 ? Ns * Ns / Ds : 0.)) / sy
                    : ((Dn > .1 ? Nn * Nn / Dn : 0.) - N * N / Dy) / sy;
      float u = Mb / Dy;
      adv += u >= 0. ? u * (N - F(c - ivec2(1, 0)).y) / sy : u * (F(c + ivec2(1, 0)).y - N) / sy;
    }
    float fc = uCoriolis * 2. * OMEGA * sin(lat(j + 1.));
    float fr = G * uManning * uManning * sqrt(N * N + Mb * Mb) / pow(max(Dy, .05), 7. / 3.);
    No = (N - uDt * (G * Dy * (sN.x - s.x) / sy + adv + fc * Mb)) / (1. + uDt * fr);
    No = clamp(No, -vlim(Dy), vlim(Dy));
    float sn = cellSize(j + 1.);
    No = No > 0. ? min(No, dC * sx * sx / (4. * uDt * sn)) : max(No, -(sN.x - sN.y) * sy * sy / (4. * uDt * sn));
  }
  if (uForce.x > 2.5 && inForceBand(c) && s.y < 0.)
    No = (uForce.x < 3.5 ? 1. : -1.) * forceEta() * sqrt(G * -s.y);
  o = vec4(Mo, No, 0., 0.);
}`;

// ── 화면용 (영상 스타일): 바다는 파마루만 하얗게, 잠긴 땅은 바다색 반투명 + 밀려드는 물마루 거품 / 또는 최대값 지도
const RENDER = HEAD + `
uniform int uMode;
uniform float uRef, uFoam;
vec3 heat(float k) { return mix(mix(vec3(1., .95, .3), vec3(1., .45, .1), smoothstep(0., .5, k)), vec3(.75, 0., .15), smoothstep(.5, 1., k)); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 s = S(c);
  float bed = s.y;
  vec4 col = vec4(0.);
  float ln = log(1. + uRef / .02);
  if (uMode == 0) {
    if (bed < 0. && s.x - bed > .01) {
      float a = s.x, k = clamp(log(1. + max(a, 0.) / .02) / ln, 0., 1.);
      col = vec4(vec3(.93, .97, 1.), k * .6);
    } else {
      float d = s.x - bed, since = uTime - s.w;
      if (d > .03 && s.w >= 0.) {
        vec3 water = vec3(.29, .494, .796);
        col = vec4(water, (.74 + .16 * smoothstep(0., 80., d)) * smoothstep(0., uFoam * .5, since));
        col = mix(col, vec4(.86, .94, 1., .9), (1. - smoothstep(0., uFoam, since)) * .6);
      }
    }
  } else {
    float v = s.z, k = clamp(log(1. + max(v, 0.) / .02) / ln, 0., 1.);
    if ((bed < 0. && v > .02) || (bed >= 0. && v > .03)) col = vec4(heat(k), .35 + .55 * k);
  }
  o = vec4(col.rgb * col.a, col.a);
}`;

// ── 지점 샘플링(뉴스·도시 판정)과 통계(침수 면적·처오름)를 GPU 에서 줄여서 읽어온다
const PROBE = HEAD + `
uniform sampler2D uP;
void main() { o = S(ivec2(texelFetch(uP, ivec2(gl_FragCoord.x, 0), 0).xy)); }`;
const STATS = HEAD + `
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 8;
  float aMax = 0., aNow = 0., run = 0., mx = 0.;
  for (int dy = 0; dy < 8; dy++) for (int dx = 0; dx < 8; dx++) {
    ivec2 c = base + ivec2(dx, dy);
    if (c.x >= uSize.x || c.y >= uSize.y) continue;
    vec4 s = texelFetch(uS, c, 0);
    if (s.y >= 0.) {
      float area = pow(cellSize(float(c.y) + .5), 2.) / 1e6;
      if (s.z > .1) { aMax += area; run = max(run, s.y); }
      if (s.x - s.y > .1) aNow += area;
    } else mx = max(mx, s.z);
  }
  o = vec4(aMax, aNow, run, mx);
}`;

export class ShallowWater {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('이 브라우저는 WebGL2 를 지원하지 않습니다.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('이 기기의 GPU 는 실수 텍스처 렌더링(EXT_color_buffer_float)을 지원하지 않습니다.');
    this.gl = gl;
    this.progs = {};
    for (const [k, src] of Object.entries({ continuity: CONTINUITY, momentum: MOMENTUM, render: RENDER, probe: PROBE, stats: STATS }))
      this.progs[k] = this.#program(src);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.manning = 0.025;
    this.coriolis = true;
    this.force = [0, 0, 1, 0];
  }

  #program(fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }

  #target(w, h, data, internal = this.gl.RGBA32F, format = this.gl.RGBA) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.FLOAT, data);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  // 격자: W×H, 남쪽 가장자리의 메르카토르 y(라디안) y0, 셀 경도폭 dl(라디안). bed: 지반고(행 0 = 남쪽)
  // wet: 처음부터 바닷물이 있는 셀, source: { i, j, amp, sigma(셀) } 원형 융기
  setup({ W, H, y0, dl, wrap, bed, wet, source }) {
    const gl = this.gl;
    Object.assign(this, { W, H, y0, dl, wrap });
    this.canvas.width = W; this.canvas.height = H;
    const st = new Float32Array(W * H * 4);
    let maxDepth = 0;
    for (let k = 0; k < W * H; k++) {
      const b = bed[k];
      st[4 * k] = wet[k] ? 0 : b;
      st[4 * k + 1] = b;
      st[4 * k + 3] = -1;
      if (wet[k]) maxDepth = Math.max(maxDepth, -b);
    }
    this.amp = source ? source.amp : this.force[1];
    if (source) {
      const r = Math.ceil(source.sigma * 4);
      for (let j = Math.max(0, source.j - r); j < Math.min(H, source.j + r + 1); j++)
        for (let di = -r; di <= r; di++) {
          let i = source.i + di;
          if (wrap) i = (i + W) % W; else if (i < 0 || i >= W) continue;
          const k = j * W + i;
          if (!wet[k]) continue;
          st[4 * k] += source.amp * Math.exp(-(di * di + (j - source.j) ** 2) / (2 * source.sigma ** 2));
        }
    }
    for (const t of [this.s0, this.s1, this.f0, this.f1, this.probeT, this.probeOut, this.statsT]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    this.s0 = this.#target(W, H, st);
    this.s1 = this.#target(W, H, null);
    this.f0 = this.#target(W, H, new Float32Array(W * H * 4));
    this.f1 = this.#target(W, H, new Float32Array(W * H * 4));
    this.statsT = this.#target(Math.ceil(W / 8), Math.ceil(H / 8), null);
    this.probeT = this.probeOut = this.probePts = null;
    this.t = 0;
    // CFL 조건: dt ≤ 셀크기 / (√(g·수심) + 유속)
    let minCell = Infinity;
    for (let j = 0; j < H; j++) minCell = Math.min(minCell, this.cellSize(j + 0.5));
    this.minCell = minCell;
    this.maxDepth = maxDepth;
    this.dt = 0.4 * minCell / (Math.sqrt(G * (maxDepth + this.amp + 1)) + 15);
  }

  cellSize(y) {
    const lat = 2 * Math.atan(Math.exp(this.y0 + y * this.dl)) - Math.PI / 2;
    return R_EARTH * Math.cos(lat) * this.dl;
  }

  #uniforms(prog) {
    const gl = this.gl, u = prog.u;
    gl.useProgram(prog.p);
    gl.uniform1i(u.uS, 0); gl.uniform1i(u.uF, 1);
    gl.uniform2i(u.uSize, this.W, this.H);
    gl.uniform1f(u.uY0, this.y0); gl.uniform1f(u.uDL, this.dl);
    gl.uniform1f(u.uDt, this.dt); gl.uniform1f(u.uTime, this.t);
    gl.uniform1f(u.uManning, this.manning); gl.uniform1f(u.uCoriolis, this.coriolis ? 1 : 0);
    gl.uniform1f(u.uWrap, this.wrap ? 1 : 0);
    gl.uniform1f(u.uArrive, Math.max(0.01, Math.min(0.1, this.amp * 0.05)));
    if (u.uSponge) gl.uniform1i(u.uSponge, Math.max(8, Math.round(Math.min(this.W, this.H) / 40)));
    gl.uniform4f(u.uForce, ...this.force);
  }
  #bind(s, f) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, f.tex);
  }

  step(n) {
    const gl = this.gl;
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.BLEND);
    for (let k = 0; k < n; k++) {
      this.t += this.dt;
      this.#uniforms(this.progs.continuity);
      this.#bind(this.s0, this.f0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.s1.fb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.#uniforms(this.progs.momentum);
      this.#bind(this.s1, this.f0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.f1.fb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [this.s0, this.s1] = [this.s1, this.s0];
      [this.f0, this.f1] = [this.f1, this.f0];
    }
  }

  // foam: 물이 막 들이닥친 곳을 하얗게 보여줄 시간(초, 계산 시간 기준)
  render(mode, ref, foam = 30) {
    const gl = this.gl;
    this.#uniforms(this.progs.render);
    gl.uniform1i(this.progs.render.u.uMode, mode);
    gl.uniform1f(this.progs.render.u.uRef, ref);
    gl.uniform1f(this.progs.render.u.uFoam, foam);
    this.#bind(this.s0, this.f0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // points: [[i, j], ...] → 각 지점의 [η, B, 최대값, 도달시각]
  probe(points) {
    const gl = this.gl, n = points.length;
    if (!n) return new Float32Array(0);
    if (this.probePts !== points) {
      this.probePts = points;
      const xy = new Float32Array(n * 4);
      points.forEach(([i, j], k) => { xy[4 * k] = i; xy[4 * k + 1] = j; });
      for (const t of [this.probeT, this.probeOut]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      this.probeT = this.#target(n, 1, xy);
      this.probeOut = this.#target(n, 1, null);
    }
    this.#uniforms(this.progs.probe);
    gl.uniform1i(this.progs.probe.u.uP, 2);
    this.#bind(this.s0, this.f0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.probeT.tex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeOut.fb);
    gl.viewport(0, 0, n, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Float32Array(n * 4);
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, out);
    return out;
  }

  stats() {
    const gl = this.gl, t = this.statsT;
    this.#uniforms(this.progs.stats);
    this.#bind(this.s0, this.f0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, t.w, t.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px);
    let floodMax = 0, floodNow = 0, runup = 0, maxEta = 0;
    for (let k = 0; k < px.length; k += 4) {
      floodMax += px[k]; floodNow += px[k + 1];
      runup = Math.max(runup, px[k + 2]); maxEta = Math.max(maxEta, px[k + 3]);
    }
    return { floodMax, floodNow, runup, maxEta };
  }
}
