// 영상식 쓰나미 표시: sim-worker.js 가 계산한 셀별 [해발, 도달시각, 수위, 바다여부] 를 받아
// 바다에는 파면을 따라 퍼지는 흰 고리 행렬(처음 만든 실험실과 같은 모양), 잠긴 땅에는 바다색 반투명 물과 거품을 그린다.
// 물리 계산기(swe.js)와 같은 캔버스·WebGL 컨텍스트를 같이 쓴다.

const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uD;          // 수위(바다는 파고), 도달시각, 바다여부, 해발
uniform float uT, uPeriod, uWaveH;
out vec4 o;
void main() {
  vec4 s = texelFetch(uD, ivec2(gl_FragCoord.xy), 0);
  float dt = uT - s.y;
  vec4 col = vec4(0.);
  if (s.z > .5) {
    if (dt > 0.) {
      // 처음 만든 한반도 실험실과 같은 파도 열: 파면이 지나가면 주기마다 하얀 고리가 뒤따르며 점점 옅어진다
      float x = dt / uPeriod, a = clamp(s.x / uWaveH, .35, 1.);
      float ring = pow(max(0., cos(6.2832 * x)), 4.) * exp(-x * .45);
      col = vec4(.02, .1, .3, clamp(x * .5, 0., .5) * a * .3);          // 파도가 지나간 바다는 살짝 짙게
      col = mix(col, vec4(.93, .97, 1., 1.), ring * .75 * a);
    }
  } else if (s.x > s.w && dt > 0.) {
    float depth = s.x - s.w;
    col = vec4(.29, .494, .796, (.74 + .16 * smoothstep(0., 80., depth)) * smoothstep(0., uPeriod * .6, dt));
    col = mix(col, vec4(1.), (1. - smoothstep(0., uPeriod * .35, dt)) * .75);   // 밀려드는 물마루 거품
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
    this.u = Object.fromEntries(['uD', 'uT', 'uPeriod', 'uWaveH'].map((n) => [n, gl.getUniformLocation(p, n)]));
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

  // t: 경과 시각(초), period: 고리 사이 간격(초), waveH: 시작 파고(고리 밝기 기준)
  render({ t, period, waveH }) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.uD, 0);
    gl.uniform1f(this.u.uT, t); gl.uniform1f(this.u.uPeriod, period); gl.uniform1f(this.u.uWaveH, waveH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
