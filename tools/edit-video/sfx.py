# 효과음 합성 + 음악과 믹스 -> mix.wav   사용법: python3 sfx.py <SRC> music.wav mix.wav
import sys, wave
import numpy as np
sys.argv = [sys.argv[0]] + sys.argv[1:]
import edit as E                               # 타임라인/이벤트 공유
from dsp import svf, onepole_lp, reverb, SR

src_music, out = sys.argv[2], sys.argv[3]
with wave.open(src_music) as w:
    mus = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2)[:, 0].astype(np.float32) / 32767
N = int((E.END + 0.5) * SR)
mus = np.pad(mus, (0, max(0, N - len(mus))))[:N]
fx = np.zeros(N)
rng = np.random.default_rng(11)

def place(sig, t, g=1.0):
    i = int(t * SR)
    if i < 0: sig = sig[-i:]; i = 0
    j = min(N, i + len(sig))
    if j > i: fx[i:j] += sig[: j - i] * g

def tt(n): return np.arange(n) / SR

def whoosh(t_peak, dur=0.45, g=0.5):
    n = int(dur * SR); t = tt(n)
    pk = 0.7 * dur
    env = np.where(t < pk, (t / pk) ** 2.5, np.exp(-(t - pk) / 0.06))
    fc = 500 + 3500 * env
    x = svf(rng.standard_normal(n), fc, 1.4, 'bp') * env
    place(x, t_peak - pk, g)

def click(t, g=0.25, f=2400, d=0.006):
    n = int(0.03 * SR); s = tt(n)
    x = (np.sin(2 * np.pi * f * s) * 0.6 + rng.standard_normal(n) * 0.5) * np.exp(-s / d)
    place(x, t, g)

def hitmarker(t):
    n = int(0.05 * SR); s = tt(n)
    x = (np.sin(2 * np.pi * 1850 * s) + 0.6 * np.sin(2 * np.pi * 3900 * s)) * np.exp(-s / 0.012)
    place(x, t, 0.32)

def explosion(t, size=1.0, g=0.9):
    n = int((1.6 + size) * SR); s = tt(n)
    boom = np.sin(2 * np.pi * np.cumsum(28 + 90 * np.exp(-s * 9)) / SR) * np.exp(-s / (0.35 * size + 0.2))
    nz = onepole_lp(rng.standard_normal(n), 900 + 1500 * np.exp(-s * 4)) * np.exp(-s / (0.45 * size + 0.15))
    crack = rng.standard_normal(n) * np.exp(-s / 0.02) * 0.8
    deb = np.zeros(n)
    for _ in range(int(25 * size)):
        i = rng.integers(int(0.05 * SR), n - 2000)
        deb[i:i + 600] += rng.standard_normal(600) * np.exp(-np.arange(600) / 120) * 0.25
    x = np.tanh((boom * 1.5 + nz * 1.2 + crack + deb) * 1.4)
    place(x, t, g)

def sonic_boom(t):
    n = int(2.2 * SR); s = tt(n)
    x = np.zeros(n)
    for d in (0.0, 0.11):
        i = int(d * SR)
        nw = np.zeros(n); nw[i:i + 400] = np.linspace(1, -1, 400)
        x += onepole_lp(nw, 3000) * 3
    x += onepole_lp(rng.standard_normal(n), 220) * np.exp(-s / 0.7) * 2.2
    place(np.tanh(x * 1.3), t, 0.85)

def cannon(t0, t1, g=0.55):
    n = int((t1 - t0) * SR); s = tt(n)
    rate = 65
    pulses = np.zeros(n)
    for k in range(int((t1 - t0) * rate)):
        i = int(k / rate * SR)
        pulses[i:i + 300] += rng.standard_normal(min(300, n - i)) * np.exp(-np.arange(min(300, n - i)) / 90)
    body = onepole_lp(pulses, 1600) * 2.2 + np.sin(2 * np.pi * rate * s) * 0.25
    tail = min(n, int(0.08 * SR))
    env = np.ones(n); env[-tail:] = np.linspace(1, 0, tail)
    place(np.tanh(body * 1.5) * env, t0, g)
    place(onepole_lp(rng.standard_normal(int(1.0 * SR)), 300) * np.exp(-tt(int(1.0 * SR)) / 0.3) * 0.6, t1, g)

def jet(t0, t1, t_pass, g=0.5, slow=False):
    n = int((t1 - t0) * SR); s = tt(n) + t0
    d = (s - t_pass)
    amp = 1 / (1 + (d / 0.55) ** 2)
    fc = np.where(d < 0, 2500 + 1500 * amp, 400 + 2000 * amp)
    if slow:
        fc = np.where(np.abs(d) < 0.6, fc * 0.35, fc)
    x = svf(rng.standard_normal(n), fc, 0.8, 'lp') * amp
    rumble = onepole_lp(rng.standard_normal(n), 120) * amp * 2
    place(np.tanh((x + rumble) * 1.2), t0, g)

def sub_drop(t, g=0.9):
    n = int(1.4 * SR); s = tt(n)
    x = np.sin(2 * np.pi * np.cumsum(90 * np.exp(-s * 2.2) + 28) / SR) * np.exp(-s / 0.6)
    place(np.tanh(x * 1.6), t, g)

def glitch(t, dur=0.18, g=0.35):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    x = np.round(x * 3) / 3
    x = np.repeat(x[::40], 40)[:n]
    place(x * np.exp(-tt(n) / (dur * 0.6)), t, g)

T, B = E.T, E.B
# 인트로 타자기
for k in range(len('kimjammin presents')):
    click(0.35 + k / 20, 0.22, 2600 + rng.integers(-300, 300))
for li, ln in enumerate(['Day 1 - 17:00:00', 'Sgt. kimjammin', 'FREE FREELY Air Base, Pacific']):
    for k in range(len(ln)):
        if ln[k] != ' ': click(T(1, 2) + li * 0.55 + k / 30, 0.12, 3000)
# 컷 휘시
for sg in E.SEG[1:]:
    if sg['shot'] not in ('montage1', 'montage2') and sg['style'] not in ('killcam',):
        whoosh(sg['a'], 0.4, 0.28)
# 이륙 애프터버너
jet(T(4), T(5, 3), T(4) + 1.9, 0.55, slow=True)
# 기총
cannon(T(5, 3) + 6 / 30, 11.4)
cannon(11.4, T(8) - B - 0.02, 0.6)
# 무음 1박: 타이틀 글리치 + 서브드롭
glitch(T(8) - B, 0.12, 0.4)
sub_drop(T(8) - B, 0.6)
# 드롭 1 폭발
explosion(T(8), 2.2, 1.0)
explosion(T(8) + 0.35, 1.0, 0.6)
# 플라이바이 + 소닉붐
jet(T(8, 3), T(10, 1), T(9, 2), 0.7, slow=True)
sonic_boom(T(9, 2) - 0.02)
# 배럴롤 휘시
whoosh(T(10, 2), 0.7, 0.35)
# AC-130 포격
for b in (1, 2, 3, 4, 6):
    t = T(11) + b * B
    place(np.sin(2 * np.pi * 70 * tt(int(0.2 * SR))) * np.exp(-tt(int(0.2 * SR)) / 0.05), t - 0.05, 0.4)
    explosion(t, 0.8 if b < 6 else 2.0, 0.55 if b < 6 else 0.85)
# 플레어: 연속 '퐁' 발사음
for k in range(11):
    t = T(13) + 0.1 + k * 5 / 30 * 1.0
    n = int(0.2 * SR)
    place(svf(rng.standard_normal(n), 1200, 2, 'bp') * np.exp(-tt(n) / 0.05), t, 0.3)
# 몽타주 글리치
for k in range(len(E.MONTAGE1)):
    glitch(26.0 + k * 4 / 30, 0.05, 0.12)
for k in range(len(E.MONTAGE2)):
    glitch(T(21, 1.5) + k * 3 / 30, 0.04, 0.12)
# 킬캠 비프
for k in range(3):
    click(T(17, 2.25) + k * 0.25, 0.2, 1000, 0.04)
# 추락
jet(T(17, 2.25), T(18), T(18) + 0.2, 0.45, slow=True)
explosion(T(18), 3.0, 1.0)
# 로켓
n = int((T(20, 1.5) - T(19)) * SR)
place(np.tanh(onepole_lp(rng.standard_normal(n), 350) * 3) * np.minimum(1, tt(n) / 0.2), T(19), 0.45)
# 콕핏 롤 기총
cannon(T(20, 1.5) + 41 / 30, T(21, 1.5), 0.45)
# 엔딩
sub_drop(T(22), 0.7)
# 힛마커
for t in E.HITM: hitmarker(t)

fx = reverb(fx, 1.2, 0.18)
mix = mus * 0.9 + fx * 0.75
mix = np.tanh(mix * 1.15)
mix /= np.max(np.abs(mix)) * 1.06
fade = int(0.8 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)
st = np.stack([mix, mix], 1)
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
print('mix ok', len(mix) / SR)
