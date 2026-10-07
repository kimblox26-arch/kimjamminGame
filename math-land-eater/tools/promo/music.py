# 홍보 영상 배경 음악 + 효과음 (직접 만든 소리 · 128 BPM · 48박 = 22.5초)
import numpy as np, wave, sys
SR = 44100
BPM = 128
B = 60 / BPM  # 한 박 (초)
BEATS = 48
N = int(SR * B * BEATS)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(3)

def at(beat): return int(round(beat * B * SR))
def add(sig, beat, pan=0.0, gain=1.0):
    s = at(beat); e = min(N, s + len(sig))
    if s >= N: return
    sig = sig[: e - s] * gain
    L[s:e] += sig * np.sqrt(0.5 * (1 - pan)) * 1.414 / 1.414
    R[s:e] += sig * np.sqrt(0.5 * (1 + pan)) * 1.414 / 1.414
def tt(dur): return np.arange(int(dur * SR)) / SR
def env(dur, a=0.005, d=0.2):
    t = tt(dur); return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / d)
def lp(x, cut):  # 한 극 저역 통과
    a = np.exp(-2 * np.pi * cut / SR); y = np.zeros_like(x); acc = 0.0
    for i in range(len(x)): acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y
def hp(x, cut): return x - lp(x, cut)
def note(n): return 440.0 * 2 ** ((n - 69) / 12)  # MIDI → Hz
def saw(f, t): return 2 * ((f * t) % 1) - 1
def sq(f, t, w=0.5): return np.where((f * t) % 1 < w, 1.0, -1.0)

# 소리들
def kick():
    t = tt(0.4); f = 45 + 110 * np.exp(-t / 0.03); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.18) * 1.0 + rng.normal(0, 1, len(t)) * np.exp(-t / 0.004) * 0.15
def clap():
    t = tt(0.25); n = rng.normal(0, 1, len(t)); n = hp(lp(n, 3500), 900)
    e = np.zeros(len(t))
    for o in (0, 0.012, 0.024): e += np.where(t >= o, np.exp(-(t - o) / 0.03), 0) * (0.6 if o < 0.02 else 1)
    return n * e * 0.55
def hat(open_=False):
    t = tt(0.25 if open_ else 0.06); n = hp(rng.normal(0, 1, len(t)), 7000)
    return n * np.exp(-t / (0.08 if open_ else 0.018)) * 0.28
def bass(n, dur):
    t = tt(dur); f = note(n)
    x = 0.6 * saw(f, t) + 0.4 * sq(f / 2, t)
    return lp(x, 900) * np.minimum(1, t / 0.005) * np.exp(-t / (dur * 0.9)) * 0.45
def stab(notes, dur=0.22):
    t = tt(dur); x = sum(saw(note(n) * d, t) for n in notes for d in (0.995, 1.005)) / (2 * len(notes))
    return lp(x, 2600) * env(dur, 0.003, 0.09) * 0.55
def pluck(n, dur=0.3, bright=4000):
    t = tt(dur); f = note(n); x = 0.7 * sq(f, t, 0.3) + 0.3 * np.sin(2 * np.pi * 2 * f * t)
    return lp(x, bright) * env(dur, 0.002, 0.12) * 0.42
def bell(n, dur=1.2):
    t = tt(dur); f = note(n)
    return (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2.01 * f * t) + 0.25 * np.sin(2 * np.pi * 3.02 * f * t)) * env(dur, 0.002, 0.35) * 0.35
def tick(n=96):
    t = tt(0.08); return np.sin(2 * np.pi * note(n) * t) * np.exp(-t / 0.02) * 0.5
def coin():
    a = tt(0.07); b = tt(0.35)
    return np.concatenate([sq(note(83), a, 0.5) * 0.18, sq(note(88), b, 0.5) * np.exp(-b / 0.12) * 0.18])
def whoosh(dur=0.45, up=False):
    t = tt(dur); n = rng.normal(0, 1, len(t)); out = np.zeros(len(t)); seg = 512
    for i in range(0, len(t), seg):
        k = i / len(t); cut = 300 + (k if up else 1 - k) * 5000
        out[i:i + seg] = lp(n[i:i + seg], cut)
    e = np.sin(np.pi * np.minimum(1, t / dur)) ** 2
    return out * e * 0.9
def boom():
    t = tt(1.2); f = 30 + 70 * np.exp(-t / 0.08)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.5) + lp(rng.normal(0, 1, len(t)), 600) * np.exp(-t / 0.15) * 0.5) * 0.9
def riser(dur):
    t = tt(dur); f = 200 * 2 ** (t / dur * 3); n = rng.normal(0, 1, len(t))
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25 + hp(n, 2000) * 0.2) * (t / dur) ** 2

# 화음: Am - F - C - G (한 마디씩)
CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOT = [45, 41, 48, 43]
MEL = [  # 2마디 짜리 멜로디 (박, 음, 길이)
    (0, 76, .5), (.5, 74, .5), (1, 72, .5), (1.5, 74, .5), (2, 76, 1), (3, 79, .5), (3.5, 76, .5),
    (4, 74, .5), (4.5, 72, .5), (5, 69, .5), (5.5, 72, .5), (6, 74, 1), (7, 72, .5), (7.5, 74, .5)]

# 0~8박: 시작 (3·2·1 초읽기) — 배경은 잔잔한 화음 + 째깍
for b in range(0, 8):
    add(stab([n + 12 for n in CH[0 if b < 4 else 1]], 0.4), b, 0, 0.35)
    add(tick(100 if b % 2 else 108), b + 0.5, 0.3, 0.35)
for k, b in enumerate((0, 2, 4)):  # 3 · 2 · 1
    add(tick(84 + k * 3) * 2, b, 0, 1.0); add(bell(72 + k * 2, 0.6), b, 0, 0.5)
add(riser(B * 2), 4.0, 0, 0.6)
for n, d in ((72, 0), (76, .12), (79, .24), (84, .36)): add(bell(n, 1.4), 6 + d / B, 0, 0.7)  # 정답 딩! (d 는 초)
add(coin(), 6.25, -0.3, 1.0); add(coin(), 6.6, 0.3, 0.8)
add(whoosh(0.9, up=True), 6.1, 0, 0.6)

# 8~40박: 신나는 본 곡
for b in range(8, 40):
    bar = (b - 8) // 4; ch = (b - 8) // 4 % 4
    build = 36 <= b < 40
    if not build or b < 38: add(kick(), b, 0, 0.95)
    if b % 2 == 1: add(clap(), b, 0, 0.9)
    add(hat(), b + 0.5, 0.25, 0.9); add(hat(), b + 0.25, -0.25, 0.35); add(hat(), b + 0.75, -0.25, 0.35)
    add(bass(ROOT[ch], B * 0.45), b, 0, 1); add(bass(ROOT[ch] + 12, B * 0.4), b + 0.5, 0, 0.8)
    add(stab(CH[ch], 0.18), b + 0.5, -0.35, 0.8)
    if not (20 <= b < 24) and not build:  # 멜로디 (티어 바뀌는 곳은 쉰다)
        for (mb, mn, ml) in MEL:
            if int(mb) == (b - 8) % 8: add(pluck(mn, ml * B), b + (mb - int(mb)), 0.15, 0.85)
# 20~24박: 티어가 하나씩 올라가는 소리 (반 박마다)
for k in range(8):
    add(bell(72 + [0, 2, 4, 7, 9, 12, 14, 16][k], 0.5), 20 + k * 0.5, (k % 2) * 0.4 - 0.2, 0.75)
add(boom(), 23.5, 0, 0.8)
# 36~40박: 쌓아 올리기 (스네어 연타 + 라이저)
for k in range(16): add(clap(), 36 + k * 0.25, 0, 0.35 + k * 0.03)
add(riser(B * 4), 36, 0, 0.8)
# 장면이 바뀔 때 휙
for b in (8, 12, 16, 24, 28, 32, 36): add(whoosh(0.4), b - 0.35, 0, 0.55)
add(boom(), 16, 0, 0.9)  # VS 쾅
add(coin(), 18.5, 0.2, 0.7)
# 40~48박: 마무리 (가장 크게) → 마지막 두 박은 처음처럼 째깍 (다시 보기 자연스럽게)
add(boom(), 40, 0, 1.0)
for b in range(40, 46):
    ch = (b - 40) // 2 % 4
    add(kick(), b, 0, 1); add(hat(True), b + 0.5, 0.2, 0.6)
    if b % 2 == 1: add(clap(), b, 0, 0.9)
    add(bass(ROOT[ch], B * 0.45), b, 0, 1); add(bass(ROOT[ch] + 12, B * 0.4), b + 0.5, 0, 0.8)
    add(stab([n + 12 for n in CH[ch]], 0.25), b, -0.3, 0.7); add(stab(CH[ch], 0.18), b + 0.5, 0.3, 0.7)
    for (mb, mn, ml) in MEL:
        if int(mb) == (b - 40) % 8: add(pluck(mn + 12, ml * B, 6000), b + (mb - int(mb)), 0.1, 0.7)
add(bell(84, 1.5), 44, 0, 0.5)
for b in (46, 47): add(stab([n + 12 for n in CH[0]], 0.4), b, 0, 0.35); add(tick(108), b + 0.5, 0.3, 0.35)
add(tick(84) * 2, 46, 0, 0.8)

# 마무리: 부드럽게 눌러 크기 맞추기
x = np.stack([L, R], 1)
x = np.tanh(x * 1.3) / np.tanh(1.3)
x = x / np.max(np.abs(x)) * 0.89
fade = int(0.01 * SR); x[:fade] *= np.linspace(0, 1, fade)[:, None]; x[-fade:] *= np.linspace(1, 0, fade)[:, None]
out = (x * 32767).astype(np.int16)
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes())
print('seconds', N / SR)
