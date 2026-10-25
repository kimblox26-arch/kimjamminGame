// 영상식 쓰나미 표시: sim-worker.js 가 계산한 셀별 [해발, 도달시각, 수위, 바다여부] 를 받아
// 바다에는 파면을 따라 퍼지는 두 겹 흰 고리, 잠긴 땅에는 바다색 반투명 물과 밀려드는 물마루 거품을 그린다.
// 물리 계산기(swe.js)와 같은 캔버스·WebGL 컨텍스트를 같이 쓴다.

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uD;          // 수위(바다는 파고), 도달시각, 바다여부, 해발
uniform float uT, uRing, uFade, uFill, uFoam;
uniform float uY0, uDL, uWest, uSpeed;   // 격자: 남쪽 메르카토르 y, 셀 각도폭, 서쪽 경도(라디안) / 바다 속도(m/s)
uniform vec2 uEpi;                       // 진원 위도·경도(라디안)
out vec4 o;
void main() {
  vec4 s = texelFetch(uD, ivec2(gl_FragCoord.xy), 0);
  float dt = uT - s.y;
  vec4 col = vec4(0.);
  if (s.z > .5) {
    // 탁 트인 바다에서는 진원에서 정확한 원(대권 거리 / 속도), 섬 뒤처럼 돌아가야 하는 곳은 계산된 도달 시각을 따른다
    vec2 g = gl_FragCoord.xy;
    float lat = 2. * atan(exp(uY0 + g.y * uDL)) - 1.5707963, lon = uWest + g.x * uDL;
    float h = pow(sin((lat - uEpi.x) * .5), 2.) + cos(lat) * cos(uEpi.x) * pow(sin((lon - uEpi.y) * .5), 2.);
    float circle = 2. * 6371000. * asin(min(1., sqrt(h))) / uSpeed;
    float tau = s.y > circle * 1.2 + 2. * uRing ? s.y : circle;
    // 파면에 맞춰 앞쪽 고리 하나, 조금 뒤에 옅은 고리 하나
    float x = (uT - tau) / uRing;
    float ring = exp(-x * x) + .6 * exp(-(x - 4.) * (x - 4.));
    col = vec4(1., 1., 1., ring * .5 * exp(-tau / uFade));
  } else if (s.x > s.w && dt > 0.) {
    float depth = s.x - s.w;
    col = vec4(.29, .494, .796, (.74 + .16 * smoothstep(0., 80., depth)) * smoothstep(0., uFill, dt));
    col = mix(col, vec4(.86, .94, 1., .9), (1. - smoothstep(0., uFoam, dt)) * .6);
  }
  o = vec4(col.rgb * col.a, col.a);
}`;

export class KinematicView {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('이 브라우저는 WebGL2 를 지원하지 않습니다.');
    this.gl = gl;
    this.canvas = canvas;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    this.prog = p;
    this.u = Object.fromEntries(['uD', 'uT', 'uRing', 'uFade', 'uFill', 'uFoam', 'uY0', 'uDL', 'uWest', 'uSpeed', 'uEpi'].map((n) => [n, gl.getUniformLocation(p, n)]));
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.tex = null;
  }

  // data: 워커 결과 (셀마다 해발, 도달시각, 수위, 바다여부), 행 0 = 남쪽
  upload(W, H, data) {
    const gl = this.gl, n = W * H, px = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      px[4 * i] = Math.max(-1e6, data[4 * i + 2]);
      px[4 * i + 1] = Math.min(1e9, data[4 * i + 1]);
      px[4 * i + 2] = data[4 * i + 3];
      px[4 * i + 3] = data[4 * i];
    }
    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, px);
    this.W = W; this.H = H;
    this.canvas.width = W; this.canvas.height = H;
  }

  // t: 경과 시각(초), ring: 고리 두께(초), fade: 멀어질수록 고리가 옅어지는 시간 척도, fill·foam: 물이 차오르는·거품이 남는 시간(초)
  // grid: { y0, dl, west(라디안) }, epi: [위도, 경도](라디안), speed: 바다 속도(m/s)
  render({ t, ring, fade, fill, foam, grid, epi, speed }) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uD, 0);
    gl.uniform1f(this.u.uT, t); gl.uniform1f(this.u.uRing, ring); gl.uniform1f(this.u.uFade, fade);
    gl.uniform1f(this.u.uFill, fill); gl.uniform1f(this.u.uFoam, foam);
    gl.uniform1f(this.u.uY0, grid.y0); gl.uniform1f(this.u.uDL, grid.dl); gl.uniform1f(this.u.uWest, grid.west);
    gl.uniform1f(this.u.uSpeed, speed); gl.uniform2f(this.u.uEpi, epi[0], epi[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
