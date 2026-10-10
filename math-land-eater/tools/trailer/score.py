# 매뜨 땅먹 트레일러 음악 (직접 만든 소리 · 90 BPM · 45박 = 30초)
# 0~4초 어두운 울림 + 째깍 → 4초 BRAAM → 4~9.3초 북 · 아르페지오 + 쾅쾅쾅 → 9.3~12초 올라가는 소리 → 12초 드롭
# → 12~21.3초 몰아치는 비트 + 화음 → 21.3~26초 스네어 롤로 끌어올림 → 26초 마지막 쾅 + 금빛 화음
import numpy as np, wave
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
B = 60 / 90
DUR = 30.0
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(11)

def tt(d): return np.arange(int(d * SR)) / SR
def at(sec): return int(round(sec * SR))
def add(sig, sec, pan=0.0, g=1.0):
    s = at(sec); e = min(N, s + len(sig))
    if s >= N or e <= s: return
    x = sig[: e - s] * g
    L[s:e] += x * np.cos((pan + 1) * np.pi / 4); R[s:e] += x * np.sin((pan + 1) * np.pi / 4)
def bt(b): return b * B
def filt(x, kind, f):
    sos = butter(2, f, btype=kind, fs=SR, output='sos'); return sosfilt(sos, x)
def mtof(n): return 440 * 2 ** ((n - 69) / 12)
def saw(f, t): return 2 * ((f * t) % 1) - 1
def env(t, a, d): return np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / d)

# ---- 소리 ----
def boom(d=2.5):  # 아주 낮은 쿵
    t = tt(d); f = 32 + 60 * np.exp(-t / .08); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(1.6 * np.sin(ph) * np.exp(-t / .9)) + filt(rng.normal(0, 1, len(t)), 'low', 300) * np.exp(-t / .25) * .5
def braam(root, d=3.2):  # 영화 예고편 '브라암'
    t = tt(d); out = np.zeros(len(t))
    for n in (root - 12, root, root + 7, root + 12):
        for det in (-.12, 0, .13): out += saw(mtof(n) * (1 + det / 100), t)
    cut = 300 + 1600 * np.exp(-t / .6)
    seg = []; step = 2048
    for i in range(0, len(t), step):  # 시간에 따라 닫히는 필터
        seg.append(filt(out[i:i + step], 'low', float(cut[i])))
    out = np.concatenate(seg)
    return np.tanh(out * .25) * env(t, .04, 1.4)
def taiko(pitch=1.0, d=.9):
    t = tt(d); f = (80 + 90 * np.exp(-t / .03)) * pitch; ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / .28)
    skin = filt(rng.normal(0, 1, len(t)), 'band', [200, 1800]) * np.exp(-t / .03) * .6
    return np.tanh((body + skin) * 1.4)
def snare(d=.35):
    t = tt(d); n = filt(rng.normal(0, 1, len(t)), 'high', 1500) * np.exp(-t / .09)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / .05)
    return (n * .8 + tone * .5)
def kick(d=.5):
    t = tt(d); f = 45 + 140 * np.exp(-t / .025); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(np.sin(ph) * np.exp(-t / .2) * 1.8)
def tick(d=.06):
    t = tt(d); return filt(rng.normal(0, 1, len(t)), 'high', 6000) * np.exp(-t / .008)
def pluck(n, d=.45):
    t = tt(d); f = mtof(n); x = (saw(f, t) + saw(f * 1.005, t)) * .5
    x = filt(x, 'low', 3500); return x * env(t, .003, .18)
def pad(notes, d):
    t = tt(d); x = np.zeros(len(t))
    for n in notes:
        for det in (-.15, .15): x += saw(mtof(n) * (1 + det / 100), t)
    x = filt(x, 'low', 1400); a = np.minimum(1, t / .6) * np.minimum(1, (d - t) / .8)
    return x * a * .12
def bell(n, d=2.5):
    t = tt(d); f = mtof(n)
    return (np.sin(2 * np.pi * f * t) + .5 * np.sin(2 * np.pi * f * 2.76 * t) + .25 * np.sin(2 * np.pi * f * 5.4 * t)) * env(t, .002, .7) * .3
def riser(d):
    t = tt(d); n = rng.normal(0, 1, len(t)); seg = []; step = 2048
    for i in range(0, len(t), step):
        k = i / len(t); seg.append(filt(n[i:i + step], 'band', [300 + 6000 * k * k, 600 + 9000 * k * k]))
    noise = np.concatenate(seg) * (t / d) ** 2
    f = 110 * 2 ** (3 * (t / d) ** 2); tone = saw(f, t) * .15 * (t / d) ** 2
    return noise * .7 + filt(tone, 'low', 3000)
def whoosh_rev(d=1.2):  # 거꾸로 빨려드는 소리
    t = tt(d); n = filt(rng.normal(0, 1, len(t)), 'band', [400, 4000]) * (t / d) ** 3; return n
def drone(d):
    t = tt(d); x = saw(mtof(33), t) + saw(mtof(33) * 1.003, t) + .5 * saw(mtof(40), t)
    seg = []; step = 2048
    for i in range(0, len(t), step): seg.append(filt(x[i:i + step], 'low', float(220 + 120 * np.sin(2 * np.pi * .15 * t[i]))))
    return np.concatenate(seg) * np.minimum(1, t / 1.5) * .35

# ---- 배치 ----
A = 57  # A3
add(drone(4.3), 0, 0, .9)
for k in range(6): add(tick(), bt(k), .3 if k % 2 else -.3, .25)
add(whoosh_rev(1.4), 4.0 - 1.4, 0, .6)
# 4초: 쾅 + BRAAM
add(boom(3), 4.0, 0, 1.0); add(braam(A - 12, 3.4), 4.0, 0, .55)
# 4~9.3초: 북 패턴 + 아르페지오
ARP = [A, A + 3, A + 7, A + 12, A + 7, A + 3]
for b in range(6, 14):
    s = bt(b)
    add(taiko(1.0), s, -.2, .7); add(taiko(1.35), s + B * .5, .2, .45)
    if b % 2: add(taiko(.8), s + B * .75, 0, .4)
    for k in range(4): add(pluck(ARP[(b * 4 + k) % len(ARP)] + 12, .4), s + k * B / 4, .25 * (1 if k % 2 else -1), .32)
for s in (4.667, 6.0, 7.333):  # 풀고! 뺏고! 지켜라!
    add(boom(1.6), s, 0, .8); add(snare(), s, 0, .7); add(braam(A - 12 + (0 if s < 5 else 3 if s < 7 else 5), 1.2), s, 0, .3)
add(pad([A - 12, A, A + 3, A + 7], 5.4), 4.0, 0, 1.0)
# 9.3~12초: 올라가는 소리
add(riser(2.67), 9.333, 0, .9)
for k in range(8): add(taiko(1.2 + k * .05), 9.333 + k * B / 2, 0, .25 + k * .05)
# 12초: 드롭
add(boom(2.2), 12.0, 0, 1.0); add(braam(A - 12, 2.0), 12.0, 0, .45)
CH = [[A - 12, A, A + 3, A + 7], [A - 16, A - 4, A, A + 3], [A - 9, A + 3, A + 7, A + 10], [A - 14, A - 2, A + 2, A + 5]]  # Am F C G
for b in range(18, 32):
    s = bt(b); add(kick(), s, 0, .8)
    if b % 2: add(snare(), s, 0, .55)
    for k in range(4): add(tick(), s + k * B / 4, .4 * (1 if k % 2 else -1), .18)
    root = CH[((b - 18) // 4) % 4][0]
    for k in range(2): add(pluck(root - 12 + 24, .3) * 0 + filt(saw(mtof(root - 12), tt(.3)) * env(tt(.3), .005, .15), 'low', 600), s + k * B / 2, 0, .45)
    for k in range(4): add(pluck(CH[((b - 18) // 4) % 4][1 + (k % 3)] + 12, .35), s + k * B / 4, .3 * (1 if k % 2 else -1), .22)
for c in range(4): add(pad(CH[c], 4 * B + .3), bt(18 + c * 4) - .1, 0, 1.0)
# 21.3~26초: 스네어 롤 + 올라가는 소리
add(riser(4.67), 21.333, 0, 1.0)
k = 0.0; tcur = 21.333
while tcur < 26.0:
    step = B / (2 if tcur < 23.3 else 4 if tcur < 24.7 else 8)
    add(snare(.2), tcur, 0, .25 + .35 * (tcur - 21.333) / 4.7); tcur += step
for b in range(32, 39): add(kick(), bt(b), 0, .7)
# 26초: 마지막 쾅 + 금빛 화음 + 종
add(boom(3.5), 26.0, 0, 1.1); add(braam(A - 12, 4.0), 26.0, 0, .5); add(snare(.6), 26.0, 0, .8)
add(pad([A - 12, A - 5, A, A + 4, A + 7], 4.0), 26.0, 0, 1.4)  # A 장조로 밝게 끝
for k, n in enumerate([A + 12, A + 16, A + 19, A + 24]): add(bell(n, 3), 26.2 + k * .18, (k - 1.5) * .3, .5)

# ---- 마무리: 리버브 · 음량 ----
def reverb(x, sec=2.2):
    t = tt(sec); ir = rng.normal(0, 1, len(t)) * np.exp(-t / (sec / 5)); ir = filt(ir, 'low', 6000); ir /= np.sqrt(np.sum(ir ** 2))
    return fftconvolve(x, ir)[: len(x)]
L2 = L + reverb(L) * .28; R2 = R + reverb(R) * .28
fade = np.ones(N); fe = at(29.2); fade[fe:] = np.linspace(1, 0, N - fe)
mix = np.stack([L2, R2], 1) * fade[:, None]
mix = np.tanh(mix / np.max(np.abs(mix)) * 1.6) * .92
with wave.open('score.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype('<i2').tobytes())
print('ok', mix.shape)
