#!/usr/bin/env python3
"""계곡 게임 소리 합성기 — 녹음 없이 수식으로 만든 소리를 valley/sound/*.ogg 로 저장한다.

python3 tools/valley_sounds.py   (numpy, ffmpeg 필요)
"""
import os, subprocess, wave, tempfile
import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'valley', 'sound')
rng = np.random.default_rng(20261113)


# ───────── 기본 도구 ─────────
def t_(sec): return np.arange(int(sec * SR)) / SR
def white(n): return rng.standard_normal(n)

def spectral(n, slope=0.0, lo=20, hi=20000):
    """1/f^slope 모양의 잡음을 [lo, hi] 대역으로 (FFT 로 한 번에)"""
    X = np.fft.rfft(white(n)); f = np.fft.rfftfreq(n, 1 / SR); f[0] = 1
    g = f ** (-slope / 2)
    g *= 1 / (1 + (lo / f) ** 4) / (1 + (f / hi) ** 4)
    y = np.fft.irfft(X * g, n)
    return y / (np.abs(y).max() + 1e-9)

def band(x, lo, hi, order=4):
    n = len(x); X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1 / SR); f[0] = 1e-3
    g = 1 / (1 + (lo / f) ** order) / (1 + (f / hi) ** order)
    return np.fft.irfft(X * g, n)

def smooth_noise(n, rate, seed_scale=1.0):
    """느리게 변하는 0~1 값 (돌풍·물살 세기 변화)"""
    k = max(4, int(n / SR * rate) + 4)
    pts = rng.random(k); xs = np.linspace(0, k - 1, n)
    i = np.floor(xs).astype(int); u = xs - i; u = u * u * (3 - 2 * u)
    i2 = np.minimum(i + 1, k - 1)
    return pts[i] * (1 - u) + pts[i2] * u

def env(n, a, d, curve=4.0):
    """a 초 동안 올라가고 d 초 동안 지수로 줄어드는 모양"""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), np.exp(-(t - a) * curve / max(d, 1e-4)))
    return e

def add(dst, src, at):
    i = int(at * SR)
    if i >= len(dst): return
    m = min(len(src), len(dst) - i)
    dst[i:i + m] += src[:m]

def loopify(x, xf=1.5):
    """끝을 앞에 겹쳐 이음매 없는 반복 소리로"""
    n = int(xf * SR); L = len(x) - n
    y = x[:L].copy(); w = np.linspace(0, 1, n)
    y[:n] = x[:n] * np.sqrt(w) + x[L:L + n] * np.sqrt(1 - w)
    return y

def bubble(f0, dur, rise=1.6):
    """물방울·거품 소리 (민나에르트 공명: 감쇠하며 음이 살짝 올라감)"""
    t = t_(dur); f = f0 * (1 + rise * t / dur * 0.3)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 6 / dur) * np.minimum(1, t * 2000)

def modal(freqs, amps, decays, dur):
    t = t_(dur); y = np.zeros_like(t)
    for f, a, d in zip(freqs, amps, decays):
        y += a * np.sin(2 * np.pi * f * t + rng.random() * 6.28) * np.exp(-t / d)
    return y

def reverb(x, sec=2.2, wet=0.25, stereo=True, pre=0.012):
    n = int(sec * SR); t = np.arange(n) / SR
    outs = []
    for ch in range(2 if stereo else 1):
        ir = white(n) * np.exp(-t * 6.9 / sec)
        ir = band(ir, 200, 7000 - 2500 * (t[-1] > 0))
        ir[: int(pre * SR)] = 0; ir /= np.sqrt((ir ** 2).sum())
        N = 1 << int(np.ceil(np.log2(len(x) + n)))
        y = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[: len(x)]
        outs.append(x * (1 - wet) + y * wet * 2.2)
    return np.stack(outs, 1) if stereo else outs[0]

def norm(x, peak=0.89):
    return x * (peak / (np.abs(x).max() + 1e-9))

def save(name, x, q=5, rate=SR):
    os.makedirs(OUT, exist_ok=True)
    x = np.clip(x, -1, 1)
    ch = 1 if x.ndim == 1 else x.shape[1]
    pcm = (x * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f: tmp = f.name
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(ch); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm.tobytes())
    out = os.path.join(OUT, name + '.ogg')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-c:a', 'libvorbis', '-q:a', str(q), out], check=True)
    os.unlink(tmp)
    print(f'{name:16s} {len(x) / rate:6.1f}s  {os.path.getsize(out) / 1024:7.0f} KB')


# ───────── 환경음 (모노 반복 소리: 게임에서 두 번 겹쳐 좌우로 넓힌다) ─────────
def river(sec=22):
    """계곡물: 쏴아 하는 넓은 잡음 + 빠르게 출렁이는 재잘거림 + 낮은 꼬르륵 (맑은 '띵' 음은 넣지 않음)"""
    n = int((sec + 1.5) * SR)
    base = spectral(n, 1.2, 150, 5000) * (0.6 + 0.4 * smooth_noise(n, 0.7))
    babble = 0
    for lo, hi, rate in ((300, 900, 14), (800, 2200, 22), (2000, 6000, 35)):  # 대역마다 다르게 출렁여 물이 재잘거리는 느낌
        babble = babble + band(white(n), lo, hi) * smooth_noise(n, rate) ** 2.5
    y = base + babble * 0.9
    fz = np.zeros(n)  # 아주 짧은 거품 터짐 (음이 아니라 '치직' 하는 질감)
    idx = rng.integers(0, n, int(sec * 220)); fz[idx] = rng.uniform(-1, 1, len(idx))
    y += band(fz, 1200, 7000) * 0.6
    for _ in range(int(sec * 5)):  # 낮은 꼬르륵
        add(y, bubble(rng.uniform(90, 320), rng.uniform(0.04, 0.09), 2.5) * rng.uniform(0.15, 0.4), rng.uniform(0, sec + 1.4))
    return norm(loopify(y))

def fall(sec=20):
    n = int((sec + 1.5) * SR)
    roar = spectral(n, 0.9, 120, 9000) * (0.8 + 0.2 * smooth_noise(n, 2))
    rumble = spectral(n, 2.0, 30, 220) * 0.9
    y = roar + rumble
    fz = np.zeros(n); idx = rng.integers(0, n, int(sec * 600)); fz[idx] = rng.uniform(-1, 1, len(idx))
    y += band(fz, 800, 8000) * 0.5
    return norm(loopify(y))

def waves(sec=39):
    n = int((sec + 2) * SR); y = spectral(n, 2.0, 30, 500) * 0.25  # 먼바다 웅웅
    t = 0.3
    while t < sec + 1:
        a = rng.uniform(0.45, 1.0) * (1.0 if int(t / 6.5) % 4 != 3 else 1.35)  # 네 번째 파도가 큰 '세트'
        sw = int(2.2 * SR)  # 밀려오는 너울
        add(y, spectral(sw, 1.8, 60, 600) * np.sin(np.linspace(0, np.pi, sw)) ** 2 * 0.5 * a, t)
        cr = int(1.6 * SR)  # 부서지는 소리
        add(y, band(white(cr), 250, 6000) * env(cr, 0.06, 1.2, 3.5) * 0.9 * a, t + 1.6)
        wa = int(4.0 * SR)  # 모래 위로 쓸려 올라갔다 내려가는 거품
        fizz = band(white(wa), 1500, 9000) * (0.4 + 0.6 * smooth_noise(wa, 25)) * env(wa, 0.4, 3.4, 3.0)
        add(y, fizz * 0.55 * a, t + 1.75)
        for _ in range(int(60 * a)):  # 자갈 구르는 소리
            add(y, modal([rng.uniform(2500, 6000)], [1], [0.004], 0.02) * rng.uniform(0.02, 0.1) * a, t + rng.uniform(3.5, 6))
        t += rng.uniform(5.6, 7.4)
    return norm(loopify(y, 2.0))

def wind(sec=30):
    n = int((sec + 1.5) * SR); g = smooth_noise(n, 0.25) ** 1.5
    low = spectral(n, 1.2, 150, 900) * (0.3 + 0.7 * g)
    leaves = band(white(n), 2500, 9000) * (smooth_noise(n, 14) ** 3) * g * 0.6
    return norm(loopify(low + leaves))

def rain(sec=24):
    n = int((sec + 1.5) * SR); y = band(white(n), 3000, 12000) * 0.25
    drops = np.zeros(n); idx = rng.integers(0, n, int(sec * 420)); drops[idx] = rng.uniform(-1, 1, len(idx)) * rng.random(len(idx)) ** 2
    y += band(drops, 1800, 9000) * 2.2 + band(drops * (rng.random(n) < 0.15), 300, 1500) * 1.5
    return norm(loopify(y))

def night(sec=20):
    n = int((sec + 1.5) * SR); y = spectral(n, 1.5, 100, 1200) * 0.05
    for c in range(5):  # 풀벌레 다섯 마리
        f = rng.uniform(3800, 5200); per = rng.uniform(0.45, 0.9); pul = rng.integers(2, 5); amp = rng.uniform(0.25, 0.6)
        t = rng.uniform(0, per)
        while t < sec + 1.4:
            for p in range(pul):
                d = 0.022; tt = t_(d)
                add(y, np.sin(2 * np.pi * f * tt) * np.sin(np.pi * tt / d) ** 2 * amp, t + p * 0.034)
            t += per * rng.uniform(0.92, 1.08)
    for _ in range(int(sec / 3)):  # 멀리 개구리
        t0 = rng.uniform(0, sec); f = rng.uniform(220, 380)
        for p in range(rng.integers(3, 7)):
            d = 0.07; tt = t_(d)
            add(y, np.sign(np.sin(2 * np.pi * f * tt)) * np.sin(np.pi * tt / d) * 0.06, t0 + p * 0.11)
    return norm(loopify(y))

def bird(kind):
    y = np.zeros(int(1.6 * SR))
    if kind == 0:  # 올라가는 휘파람 두 번
        for k in range(2):
            d = 0.28; tt = t_(d); f = 2600 + 1400 * tt / d
            add(y, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * tt / d), k * 0.36)
    elif kind == 1:  # 떨림 소리 (트릴)
        d = 0.9; tt = t_(d); f = 4200 - 600 * tt / d
        add(y, np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.5 + 0.5 * np.sin(2 * np.pi * 26 * tt)) * np.sin(np.pi * tt / d), 0.05)
    elif kind == 2:  # 짹짹 여러 번
        for k in range(rng.integers(4, 7)):
            d = 0.06; tt = t_(d); f = rng.uniform(3500, 5500) - 2000 * tt / d
            add(y, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * tt / d), k * 0.13)
    elif kind == 3:  # 내려가는 긴 울음
        d = 0.7; tt = t_(d); f = 3600 - 1500 * (tt / d) ** 0.7 + 120 * np.sin(2 * np.pi * 9 * tt)
        add(y, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * tt / d) ** 0.5, 0.05)
    elif kind == 4:  # 두 음 (높게-낮게) 반복
        for k in range(3):
            for j, (f0, d) in enumerate([(3100, 0.16), (2500, 0.22)]):
                tt = t_(d); add(y, np.sin(2 * np.pi * f0 * tt + 2 * np.sin(2 * np.pi * 40 * tt)) * np.sin(np.pi * tt / d), k * 0.5 + j * 0.18)
    else:  # 지저귐 (무작위 주파수 변조)
        d = 1.2; tt = t_(d); f = 3800 + 900 * np.sin(2 * np.pi * 7 * tt + 3 * smooth_noise(len(tt), 12))
        add(y, np.sin(2 * np.pi * np.cumsum(f) / SR) * (smooth_noise(len(tt), 18) > 0.4) * np.sin(np.pi * tt / d), 0.05)
    y = band(y, 1500, 9000)
    return norm(y * np.minimum(1, np.arange(len(y)) / 200), 0.7)

def hum(sec=4):  # 발전기 웅웅 (60 Hz 계통 → 120 Hz 자기 진동)
    t = t_(sec); y = sum(a * np.sin(2 * np.pi * f * t) for f, a in [(120, 1), (240, 0.45), (360, 0.25), (480, 0.12), (600, 0.06)])
    y *= 1 + 0.05 * np.sin(2 * np.pi * 0.5 * t)
    return norm(y + band(white(len(t)), 300, 2000) * 0.05)

def motor(sec=3):  # 권양기 모터 · 기어
    t = t_(sec); f = 330
    y = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 9)) * 0.6
    gear = np.zeros(len(t)); gear[::int(SR / 55)] = 1
    y += band(gear, 800, 4000) * 3 + band(white(len(t)), 200, 3000) * 0.1
    return norm(y)


# ───────── 효과음 ─────────
def hit(v):
    """돌끼리 부딪힘: 울리지 않는 짧은 '딱' (돌은 금속처럼 오래 울리지 않는다)"""
    n = int(0.25 * SR)
    y = band(white(n), 700, 7000) * env(n, 0.0004, 0.012, 7) * 1.4
    f0 = rng.uniform(600, 1500)
    y += modal([f0 * k * rng.uniform(0.9, 1.1) for k in (1, 1.9, 3.1)], [0.35, 0.2, 0.1], [0.006, 0.004, 0.003], 0.25)
    y += band(white(n), 120, 900) * env(n, 0.001, 0.03, 5) * 0.8
    if v >= 4:  # 큰 바위: 쿵
        y += modal([rng.uniform(60, 110)], [1.6], [0.06], 0.25) + band(white(n), 50, 400) * env(n, 0.002, 0.12) * 1.2
    return norm(y, 0.85)

def splash(v):
    y = np.zeros(int(1.2 * SR)); s = 0.6 + 0.2 * v
    add(y, band(white(int(0.25 * SR)), 400, 6000) * env(int(0.25 * SR), 0.003, 0.15, 5) * s, 0)
    for _ in range(int(10 * s)):  # 낮은 거품 '꿀럭'
        add(y, bubble(rng.uniform(150, 600), rng.uniform(0.03, 0.07), 2.5) * rng.uniform(0.1, 0.35), rng.uniform(0.02, 0.3))
    drops = np.zeros(len(y)); idx = rng.integers(int(0.2 * SR), int(0.9 * SR), int(40 * s)); drops[idx] = rng.uniform(-1, 1, len(idx))
    y += band(drops, 1000, 6000) * 0.5  # 다시 떨어지는 물방울 (짧게 톡톡)
    return norm(y, 0.85)

def grains(dur, rate, lo, hi, glen=(0.002, 0.008)):
    y = np.zeros(int(dur * SR))
    for _ in range(int(dur * rate)):
        g = int(rng.uniform(*glen) * SR); add(y, white(g) * np.hanning(g) * rng.uniform(0.2, 1), rng.uniform(0, dur))
    return band(y, lo, hi)

def dig(v):
    y = grains(0.3, 900, 200, 3500) * env(int(0.3 * SR), 0.02, 0.25, 3)
    return norm(y + band(white(len(y)), 80, 400) * env(len(y), 0.005, 0.12) * 0.6, 0.8)

def pour(kind, v):
    if kind == 'gravel':  # 자갈 쏟는 달그락 소리
        y = np.zeros(int(0.7 * SR))
        for _ in range(140):
            add(y, modal([rng.uniform(1800, 5500)], [1], [0.006], 0.03) * rng.uniform(0.1, 0.6), rng.uniform(0, 0.55) ** 1.3)
        return norm(y + band(white(len(y)), 400, 3000) * env(len(y), 0.05, 0.5) * 0.25, 0.8)
    thick = 1.0 if kind == 'mud' else 1.6  # 시멘트는 더 걸쭉하게
    n = int(0.6 * SR); y = band(white(n), 100, 1400 / thick) * env(n, 0.03, 0.45, 3)
    for _ in range(6):  # 철퍽
        add(y, bubble(rng.uniform(120, 300) / thick, rng.uniform(0.05, 0.1), 3) * 0.8, rng.uniform(0.02, 0.35))
    return norm(y, 0.8)

def chip(v):
    y = modal([rng.uniform(2500, 4200), rng.uniform(5000, 7000)], [1, 0.5], [0.025, 0.01], 0.2)
    y += band(white(len(y)), 3000, 10000) * env(len(y), 0.0003, 0.006) * 2
    for _ in range(6): add(y, modal([rng.uniform(3000, 7000)], [0.3], [0.004], 0.02), rng.uniform(0.04, 0.15))
    return norm(y, 0.85)

def crack(v):
    n = int(1.4 * SR); y = band(white(n), 1500, 12000) * env(n, 0.0005, 0.03, 6) * 1.2
    y += spectral(n, 1.8, 30, 400) * env(n, 0.005, 0.9, 3) * 1.5
    for _ in range(40): add(y, modal([rng.uniform(1500, 6000)], [rng.uniform(0.1, 0.4)], [0.006], 0.03), rng.uniform(0.08, 0.9))
    return norm(y, 0.9)

def snap(v):  # 블록 '딸깍'
    y = np.zeros(int(0.25 * SR))
    for k, d in enumerate([0, 0.018]):
        add(y, modal([rng.uniform(3500, 4500), 6800], [1, 0.4], [0.008, 0.004], 0.05) * (1 - 0.3 * k), d)
    add(y, modal([180], [0.8], [0.04], 0.15), 0.004)
    return norm(y, 0.8)

def chime():
    y = np.zeros(int(2.6 * SR))
    for i, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
        add(y, modal([f, f * 2.76, f * 5.4], [1, 0.35, 0.12], [0.9, 0.3, 0.12], 2.0), i * 0.12)
    return norm(reverb(y, 1.6, 0.3, False), 0.7)

def whoosh():
    n = int(0.5 * SR); x = white(n); out = np.zeros(n)
    for k, (lo, hi) in enumerate([(300, 900), (600, 1800), (1200, 3600), (2400, 7000)]):
        out += band(x, lo, hi) * np.exp(-((np.arange(n) / n - (0.2 + 0.18 * k)) ** 2) / 0.02)
    return norm(out, 0.7)

def brush():  # 페인트 붓질
    n = int(0.35 * SR); y = band(white(n), 1200, 7000) * np.sin(np.linspace(0, np.pi, n)) ** 1.5 * (0.6 + 0.4 * smooth_noise(n, 40))
    return norm(y, 0.6)

def step(kind):
    n = int(0.22 * SR)
    if kind == 'wet':
        y = band(white(n), 500, 5000) * env(n, 0.005, 0.15, 4)
        for _ in range(3): add(y, bubble(rng.uniform(150, 450), 0.04, 2.5) * 0.25, rng.uniform(0, 0.08))
    else:
        y = grains(0.18, 1400, 1500, 8000, (0.001, 0.004)) * env(int(0.18 * SR), 0.01, 0.15, 3)
        y = np.concatenate([y, np.zeros(n - len(y))]) + band(white(n), 60, 300) * env(n, 0.003, 0.06) * 0.5
    return norm(y, 0.6)


# ───────── 배경음악: 가야금 같은 뜯는 소리 + 대금 같은 피리 + 잔잔한 패드 (오음 음계) ─────────
def pluck(f, dur, bend=0.0):
    t = t_(dur); y = np.zeros_like(t)
    fb = f * (1 + bend * np.clip((t - 0.25) / 0.4, 0, 1) * (0.5 + 0.5 * np.sin(2 * np.pi * 5.5 * t)))  # 농현(떨기)
    ph = 2 * np.pi * np.cumsum(fb) / SR
    for k in range(1, 11):
        y += np.sin(k * ph * (1 + 0.0008 * k * k)) / k ** 1.25 * np.exp(-t * (1.1 + 0.9 * k))
    y += band(white(len(t)), 1000, 6000) * env(len(t), 0.001, 0.015) * 0.3
    return y * np.minimum(1, t * 600)

def flute(f, dur):
    t = t_(dur); vib = 1 + 0.012 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.3) / 0.8, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    a = np.minimum(1, t / 0.18) * np.minimum(1, (dur - t) / 0.35).clip(0)
    y = (np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)) * a
    breath = band(white(len(t)), f * 0.8, f * 3) * a * 0.12
    return y + breath

def pad(freqs, dur):
    t = t_(dur); y = np.zeros_like(t)
    for f in freqs:
        for d in (-0.15, 0.15): y += np.sin(2 * np.pi * (f + d) * t + rng.random() * 6) * (1 + 0.3 * np.sin(2 * np.pi * 0.11 * t))
    a = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.8
    return y * a / len(freqs)

def music(mood, sec=150, seed=1):
    r = np.random.default_rng(seed)
    root = {'day': 293.66, 'night': 220.0, 'sea': 261.63}[mood]
    scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]  # 오음 음계 두 옥타브
    bpm = {'day': 66, 'night': 54, 'sea': 60}[mood]; beat = 60 / bpm
    n = int((sec + 4) * SR); L = np.zeros(n); Rr = np.zeros(n)
    prog = [[0, 7, 16], [9, 16, 21], [5 - 12, 9, 12], [7, 14, 19]]  # 패드 화음
    bar = 4 * beat; nb = int(sec / bar)
    for b in range(nb):
        ch = prog[b % 4]; p = pad([root / 2 * 2 ** (c / 12) for c in ch], bar * 1.15) * 0.18
        add(L, p, b * bar); add(Rr, p, b * bar + 0.01)
    pos = 4; tt = bar  # 첫 마디는 패드만
    while tt < sec - bar:
        phrase = r.integers(5, 9)
        for k in range(phrase):
            pos = int(np.clip(pos + r.choice([-2, -1, -1, 0, 1, 1, 2, 3]), 0, len(scale) - 1))
            f = root * 2 ** (scale[pos] / 12)
            d = beat * r.choice([0.5, 1, 1, 1.5, 2]) * (2 if k == phrase - 1 else 1)
            if mood == 'night' and r.random() < 0.6: y = flute(f, d * 1.3) * 0.22
            else: y = pluck(f, max(1.8, d * 2), bend=0.006 if (d >= beat * 1.5 and r.random() < 0.6) else 0) * 0.3
            pan = 0.5 + 0.35 * np.sin(pos)
            add(L, y * (1 - pan) * 1.4, tt); add(Rr, y * pan * 1.4, tt)
            tt += d
        tt += beat * r.choice([1, 2, 2, 3])
        if mood == 'sea' and r.random() < 0.5:  # 바다: 긴 피리 소리
            f = root * 2 ** (scale[r.integers(3, 8)] / 12); y = flute(f, beat * 4) * 0.16
            add(L, y, tt - beat * 2); add(Rr, y, tt - beat * 2)
    x = np.stack([L, Rr], 1)
    x = np.stack([reverb(x[:, c], 3.2, 0.35, False) for c in range(2)], 1)
    fade = int(3 * SR); x[-fade:] *= np.linspace(1, 0, fade)[:, None]; x[:int(0.5 * SR)] *= np.linspace(0, 1, int(0.5 * SR))[:, None]
    return norm(x[: int(sec * SR)], 0.8)


if __name__ == '__main__':
    for name, fn in [('river', river), ('fall', fall), ('waves', waves), ('wind', wind), ('rain', rain), ('night', night), ('hum', hum), ('motor', motor)]:
        save(name, fn(), q=4)
    for i in range(6): save(f'bird{i}', bird(i), q=4)
    for i in range(6): save(f'hit{i}', hit(i))
    for i in range(4): save(f'splash{i}', splash(i))
    for i in range(4): save(f'dig{i}', dig(i))
    for k in ('mud', 'gravel', 'cement'):
        for i in range(2): save(f'pour_{k}{i}', pour(k, i))
    for i in range(3): save(f'chip{i}', chip(i))
    for i in range(2): save(f'crack{i}', crack(i))
    for i in range(2): save(f'snap{i}', snap(i))
    save('chime', chime()); save('whoosh', whoosh()); save('brush', brush())
    for i in range(3): save(f'step_dry{i}', step('dry')); save(f'step_wet{i}', step('wet'))
    for mood, seed in (('day', 3), ('night', 7), ('sea', 11)):
        save(f'music_{mood}', music(mood, 150, seed), q=4)
