# TikTok 에딧용 오리지널 트랙: slowed 점프스타일 느낌 (120BPM, 하드 킥 + 오프비트 베이스 + 리버브 리드)
# + 컷/폭발 효과음.  사용법: python3 tiktok_music.py out.wav
import sys, wave
import numpy as np
from dsp import svf, onepole_lp, reverb, saw, sine, SR

BPM = 120.0
B = 60 / BPM
DUR = 18.0
N = int(DUR * SR)
rng = np.random.default_rng(5)

def buf(): return np.zeros(N)
def tt(n): return np.arange(n) / SR
def place(dst, sig, t, g=1.0):
    i = int(t * SR)
    if i < 0: sig = sig[-i:]; i = 0
    j = min(N, i + len(sig))
    if j > i: dst[i:j] += sig[: j - i] * g

def hard_kick(root, tail=0.42):
    n = int((0.06 + tail) * SR); s = tt(n)
    f = root + 260 * np.exp(-s * 38)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR)
    env = np.exp(-s / (tail * 0.55))
    x = np.tanh(body * env * 6.0) * np.minimum(1, (n - np.arange(n)) / (0.02 * SR))
    click = svf(rng.standard_normal(n), 3500, 1.0, 'bp') * np.exp(-s / 0.004) * 0.6
    return onepole_lp(x, 5000) + click

def muffled_kick(root):
    return onepole_lp(hard_kick(root, 0.3), 600) * 1.4

def jump_bass(root):
    n = int(0.2 * SR); s = tt(n)
    x = saw(root * 2, n) + saw(root * 2.01, n) * 0.7 + saw(root, n) * 0.5
    x = svf(x, 700 + 1600 * np.exp(-s * 25), 1.6, 'lp')
    return np.tanh(x * 2.2) * np.exp(-s / 0.07) * 0.6

def clap():
    n = int(0.3 * SR); s = tt(n)
    x = np.zeros(n)
    for d in (0, 0.009, 0.019):
        i = int(d * SR)
        x[i:] += svf(rng.standard_normal(n - i), 1500, 1.1, 'bp') * np.exp(-np.arange(n - i) / SR / 0.05)
    return x * 0.7

def supersaw(f, secs, cut=3200, amp=0.3):
    n = int(secs * SR); s = tt(n)
    x = np.zeros(n)
    for d in (-0.018, -0.008, 0, 0.007, 0.017):
        x += saw(f * (1 + d), n, rng.random())
    x /= 5
    x = onepole_lp(onepole_lp(x, cut), cut)
    a = np.minimum(1, s / 0.012) * np.exp(-s / (secs * 1.4)) * np.clip((secs - s) / 0.03, 0, 1)
    return x * a * amp

def pad(chord, secs, cut=1100):
    n = int(secs * SR); s = tt(n)
    x = np.zeros(n)
    for f in chord:
        for d in (-0.01, 0.0, 0.009):
            x += saw(f * (1 + d), n, rng.random())
    x = onepole_lp(onepole_lp(x / (len(chord) * 3), cut), cut)
    return x * np.clip(np.minimum(s / 0.5, (secs - s) / 0.5), 0, 1)

def riser(secs):
    n = int(secs * SR); s = tt(n)
    x = svf(rng.standard_normal(n), 400 * (20 ** (s / secs)), 2.5, 'bp') * (s / secs) ** 2
    return x * 1.2

# 화성 (A 단조): Am F C G — 마디 = 2초
ROOT = {'Am': 55.0, 'F': 43.65, 'C': 65.41, 'G': 49.0}
CH = {'Am': [220.0, 261.6, 329.6], 'F': [174.6, 220.0, 261.6], 'C': [196.0, 261.6, 329.6], 'G': [196.0, 246.9, 293.7]}
PROG = ['Am', 'F', 'C', 'G']
# 오리지널 모티프 (8분음표, None = 쉼)
MEL = {
    'Am': [440.0, None, 523.3, 659.3, None, 587.3, 523.3, 493.9],
    'F':  [440.0, None, 523.3, 698.5, None, 659.3, 587.3, 523.3],
    'C':  [392.0, None, 523.3, 659.3, None, 784.0, 659.3, 587.3],
    'G':  [493.9, None, 587.3, 784.0, None, 659.3, 587.3, 493.9],
}

drums, bass, lead, pads, fx = buf(), buf(), buf(), buf(), buf()
def T(bar, beat=0.0): return bar * 4 * B + beat * B

# 인트로 (0-4초): 먹먹한 패드 + 로우패스 리드 + 먹먹한 킥
for bar, c in enumerate(['Am', 'F']):
    place(pads, pad(CH[c], 2.4, 800), T(bar), 0.9)
    for k, f in enumerate(MEL[c]):
        if f: place(lead, supersaw(f, 0.42, 1300, 0.22), T(bar, k * 0.5))
    if bar == 1:
        for k in (0, 1, 2):
            place(drums, muffled_kick(ROOT[c]), T(bar, k), 0.6)
place(fx, riser(1.75), T(1, 0.5), 0.5)

# 드롭 (4-12초)
for b in range(4):
    bar = 2 + b; c = PROG[b]
    place(pads, pad(CH[c], 2.3, 1500), T(bar), 0.45)
    for k in range(4):
        place(drums, hard_kick(ROOT[c]), T(bar, k), 1.0)
        place(bass, jump_bass(ROOT[c]), T(bar, k + 0.5), 0.9)
        if k in (1, 3): place(drums, clap(), T(bar, k), 0.45)
    for k, f in enumerate(MEL[c]):
        if f: place(lead, supersaw(f, 0.45, 3400, 0.3), T(bar, k * 0.5))
        if f: place(lead, supersaw(f * 2, 0.3, 4200, 0.07), T(bar, k * 0.5))

# 아웃트로 (12-16.5초)
for bar, c in enumerate(['Am', 'F'], start=6):
    place(pads, pad(CH[c], 2.5, 900 - (bar - 6) * 250), T(bar), 0.85)
    for k, f in enumerate(MEL[c][:6]):
        if f: place(lead, supersaw(f, 0.5, 1200, 0.18 * (1 - (bar - 6) * 0.4)), T(bar, k * 0.5))
place(drums, hard_kick(55.0, 0.9), T(6), 1.0)

# ---------------- 효과음 (컷/폭발/제트) ----------------
def whoosh(t_peak, dur=0.45, g=0.35):
    n = int(dur * SR); s = tt(n); pk = 0.7 * dur
    env = np.where(s < pk, (s / pk) ** 2.5, np.exp(-(s - pk) / 0.06))
    place(fx, svf(rng.standard_normal(n), 500 + 3500 * env, 1.4, 'bp') * env, t_peak - pk, g)

def boom(t, g=0.8, size=1.0):
    n = int(2.2 * SR); s = tt(n)
    b = np.sin(2 * np.pi * np.cumsum(30 + 80 * np.exp(-s * 8)) / SR) * np.exp(-s / (0.35 * size + 0.2))
    nz = onepole_lp(rng.standard_normal(n), 1200) * np.exp(-s / 0.4)
    place(fx, np.tanh((b * 1.5 + nz) * 1.3), t, g)

def jet(t0, t1, tp, g=0.5):
    n = int((t1 - t0) * SR); s = tt(n) + t0; d = s - tp
    amp = 1 / (1 + (d / 0.45) ** 2)
    x = svf(rng.standard_normal(n), np.where(d < 0, 2600 + 1400 * amp, 500 + 1800 * amp), 0.8, 'lp') * amp
    place(fx, np.tanh((x + onepole_lp(rng.standard_normal(n), 120) * amp * 2) * 1.2), t0, g)

for t in (2.0, 5.0, 6.0, 7.0, 8.0, 8.5, 10.0, 10.5, 12.0, 14.0):
    whoosh(t, 0.4, 0.22)
jet(2.0, 5.0, 4.0, 0.45)
boom(6.0, 0.7)
jet(7.0, 8.0, 7.5, 0.4)
boom(11.0, 0.9, 1.6)

# 사이드체인
duck = np.ones(N)
for b in range(16):
    i = int((4 + b * B) * SR); n = int(0.3 * SR)
    duck[i:i + n] = np.minimum(duck[i:i + n], 0.3 + 0.7 * np.linspace(0, 1, n) ** 0.7)

# 빌드업 직전 반박 공백
gate = np.ones(N)
i0, i1 = int(3.75 * SR), int(4.0 * SR)
gate[i0:i1] = 0.12

mix = (drums * 0.8 + bass * 0.7 * duck + reverb(lead, 2.8, 0.45) * 0.9 * duck
       + reverb(pads, 3.0, 0.4) * 0.55 * duck + reverb(fx, 1.5, 0.2) * 0.8) * gate
# 바이닐 크랙클 (slowed 감성)
cr = np.zeros(N); idx = rng.integers(0, N, 900); cr[idx] = rng.standard_normal(900) * 0.35
mix += svf(cr, 2500, 0.7, 'bp')
mix = onepole_lp(mix, 9000)
mix = np.tanh(mix * 1.2)
mix /= np.max(np.abs(mix)) * 1.08
fo = int(1.2 * SR); e = int(16.6 * SR)
mix[e - fo:e] *= np.linspace(1, 0, fo); mix[e:] = 0
mix = mix[: int(16.6 * SR)]
st = np.stack([mix, mix], 1)
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'tiktok.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
print('ok', len(mix) / SR)
