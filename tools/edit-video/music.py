# 140BPM 덥스텝 트랙 합성 (CoD4 프랙무비 시절 감성) -> music.wav
import numpy as np, wave, sys

SR = 44100
BPM = 140.0
B = 60.0 / BPM
BAR = 4 * B
TOTAL_BARS = 25
DUR = TOTAL_BARS * BAR + 3.0
N = int(DUR * SR)
rng = np.random.default_rng(7)

def T(bars, beats=0.0):
    return bars * BAR + beats * B

def buf():
    return np.zeros(N)

def place(dst, sig, t, gain=1.0):
    i = int(t * SR)
    if i >= N: return
    j = min(N, i + len(sig))
    dst[i:j] += sig[: j - i] * gain

def env_exp(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))

def onepole_lp(x, fc):
    # 계수 배열(시간가변) 허용 1차 LPF
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s); y[i] = s
    return y

def svf(x, fc, q=0.7, mode='lp'):
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    f = 2 * np.sin(np.pi * np.clip(fc, 10, SR / 6) / SR)
    damp = 1.0 / q
    low = band = 0.0
    out = np.empty_like(x)
    for i in range(len(x)):
        high = x[i] - low - damp * band
        band += f[i] * high
        low += f[i] * band
        out[i] = low if mode == 'lp' else band if mode == 'bp' else high
    return out

def saw(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    ph = (np.cumsum(f) / SR + phase) % 1.0
    return 2 * ph - 1

def sine(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return np.sin(2 * np.pi * (np.cumsum(f) / SR + phase))

def reverb(x, secs=2.2, mix=0.3, seed=1):
    n = int(secs * SR)
    r = np.random.default_rng(seed)
    ir = r.standard_normal(n) * np.exp(-np.arange(n) / (secs * SR / 6.5))
    ir = onepole_lp(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    L = len(x) + n
    nfft = 1 << (L - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[: len(x)]
    return x * (1 - mix) + y * mix * 1.4

# ---------------------------------------------------------------- 드럼
def kick(big=False):
    n = int((0.6 if big else 0.42) * SR)
    t = np.arange(n) / SR
    f = 44 + 140 * np.exp(-t * 32)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (4.5 if big else 7.5))
    click = rng.standard_normal(n) * np.exp(-t * 400) * 0.35
    return np.tanh((s + click) * 1.6)

def snare():
    n = int(0.38 * SR)
    t = np.arange(n) / SR
    nz = svf(rng.standard_normal(n), 3200, 0.8, 'bp') * np.exp(-t * 13) * 1.6
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28) * 0.8
    clap = np.zeros(n)
    for k, d in enumerate([0, 0.011, 0.022]):
        i = int(d * SR)
        clap[i:] += svf(rng.standard_normal(n - i), 1400, 1.2, 'bp') * np.exp(-np.arange(n - i) / SR * 38) * 0.9
    return np.tanh((nz + body + clap) * 1.2)

def hat(open_=False):
    n = int((0.22 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    x = svf(rng.standard_normal(n), 9000, 0.9, 'hp')
    return x * np.exp(-t * (14 if open_ else 90)) * 0.5

KICK, KICKB, SNARE, HAT, OHAT = kick(), kick(True), snare(), hat(), hat(True)

def impact():
    n = int(3.2 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(30 + 70 * np.exp(-t * 6)) / SR) * np.exp(-t * 1.4)
    nz = onepole_lp(rng.standard_normal(n), 1800) * np.exp(-t * 3.5) * 0.9
    return np.tanh((boom * 1.4 + nz) * 1.3)

def riser(secs, f0=300, f1=7000):
    n = int(secs * SR)
    t = np.arange(n) / SR
    fc = f0 * (f1 / f0) ** (t / secs)
    x = svf(rng.standard_normal(n), fc, 3.0, 'bp')
    x *= (t / secs) ** 1.6
    tone = saw(110 * 2 ** (3 * t / secs), n) * 0.12 * (t / secs) ** 2
    return x * 1.2 + tone

def rev_cymbal(secs=1.7):
    n = int(secs * SR)
    t = np.arange(n) / SR
    x = svf(rng.standard_normal(n), 7000, 0.8, 'hp')
    return x * (t / secs) ** 3 * 0.7

# ---------------------------------------------------------------- 신스
F = {'F1': 43.65, 'Db1': 34.65, 'Eb1': 38.89, 'C1': 32.70, 'Ab1': 51.91}

def wobble(note_hz, secs, rates, drive=2.4, base=90, top=2600):
    # rates: 박자당 LFO 주기 수 리스트(박 단위로 순환)
    n = int(secs * SR)
    t = np.arange(n) / SR
    beat_idx = np.minimum((t / B).astype(int), len(rates) - 1)
    r = np.array(rates)[beat_idx] / B
    ph = np.cumsum(r) / SR
    lfo = 0.5 - 0.5 * np.cos(2 * np.pi * ph)
    lfo = np.where(np.array(rates)[beat_idx] == 0, 0.08, lfo)
    fc = base * (top / base) ** lfo
    osc = saw(note_hz * 2, n) + saw(note_hz * 2 * 1.006, n) * 0.8 + np.sign(sine(note_hz, n)) * 0.6
    y = svf(osc, fc, 4.5, 'lp')
    y = np.tanh(y * drive) * 0.55
    sub = sine(note_hz, n) * 0.5
    edge = np.minimum(1, np.minimum(t / 0.004, (secs - t) / 0.01))
    return (y + sub) * np.clip(edge, 0, 1)

def pad(chord, secs, cutoff=900):
    n = int(secs * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for f in chord:
        for d in (-0.012, 0, 0.011):
            x += saw(f * (1 + d), n, rng.random())
    x /= len(chord) * 3
    fc = np.full(n, float(cutoff)) if np.isscalar(cutoff) else np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(cutoff)), cutoff)
    y = onepole_lp(onepole_lp(x, fc), fc)
    a = np.minimum(1, t / 0.8) * np.minimum(1, (secs - t) / 0.8)
    return y * np.clip(a, 0, 1)

def pluck(f, secs=0.35):
    n = int(secs * SR)
    t = np.arange(n) / SR
    x = saw(f, n) + saw(f * 1.005, n) * 0.6
    return onepole_lp(x, 400 + 5000 * np.exp(-t * 18)) * np.exp(-t * 7) * 0.35

drums, bass, pads, fx, lead = buf(), buf(), buf(), buf(), buf()

# 인트로 (0-4마디): 패드 + 아르페지오 + 크랙클
FM = [87.31, 103.83, 130.81, 174.61]
DB = [69.30, 87.31, 103.83, 138.59]
EB = [77.78, 98.00, 116.54, 155.56]
C_ = [65.41, 82.41, 98.00, 130.81]
prog = [FM, DB, EB, C_]
for bar in range(4):
    n = int(BAR * SR)
    cut = np.linspace(400 + bar * 300, 700 + bar * 450, n)
    place(pads, pad(prog[bar], BAR + 0.6, cut), T(bar), 0.9)
arp_notes = [349.2, 415.3, 523.3, 698.5, 523.3, 415.3, 349.2, 311.1]
for bar in range(2, 8):
    ch = prog[bar % 4]
    for k in range(8):
        f = ch[k % 4] * 4 if k % 2 == 0 else ch[(k + 1) % 4] * 4
        place(lead, pluck(f), T(bar, k * 0.5), 0.45 if bar < 4 else 0.6)
place(fx, rev_cymbal(1.7), T(4) - 1.7, 0.8)

# 빌드업 (4-8마디)
for bar in range(4, 8):
    place(pads, pad(prog[bar % 4], BAR + 0.6, 1200 + (bar - 4) * 500), T(bar), 0.7)
    for k in range(4):
        place(drums, KICK, T(bar, k), 0.9)
    # 스네어 롤: 4분 -> 8분 -> 16분 -> 32분
    div = [1, 2, 4, 8][bar - 4]
    for k in range(4 * div):
        v = 0.35 + 0.65 * ((bar - 4) * 4 * div + k) / (16 * div)
        place(drums, SNARE, T(bar, k / div), v * 0.7)
place(fx, riser(4 * BAR - B), T(4), 0.55)
# 드롭 직전 1박 공백 (아무것도 없음) — T(8)-B ~ T(8)

# 드롭 패턴
def drop(bar0, bars, heavy=False):
    notes = ['F1', 'F1', 'Db1', 'C1', 'F1', 'F1', 'Eb1', 'C1']
    pats = [
        [1, 2, 4, 0], [3, 3, 6, 1], [2, 4, 8, 4], [1.5, 1.5, 3, 12],
    ]
    for b in range(bars):
        bar = bar0 + b
        # 하프타임: 킥 1박, 스네어 3박
        place(drums, KICKB, T(bar, 0), 1.0)
        place(drums, KICK, T(bar, 1.5), 0.75)
        if b % 2 == 1: place(drums, KICK, T(bar, 2.75), 0.6)
        place(drums, SNARE, T(bar, 2), 1.0)
        for k in range(16):
            place(drums, HAT if k % 4 != 2 else OHAT, T(bar, k / 4), 0.5 if k % 2 == 0 else 0.3)
        nh = F[notes[b % len(notes)]]
        rates = pats[(b + (1 if heavy else 0)) % len(pats)]
        place(bass, wobble(nh, BAR, rates, drive=3.2 if heavy else 2.4), T(bar), 1.0)
        place(pads, pad([x * 2 for x in prog[b % 4]], BAR + 0.4, 1600), T(bar), 0.35)
    place(fx, impact(), T(bar0), 1.0)

drop(8, 8)
# 브레이크 (16-18): 심장박동 킥 + 패드 + 역 리버스
for bar in range(16, 18):
    place(pads, pad(prog[bar % 4], BAR + 0.6, 700), T(bar), 1.0)
    place(drums, KICK, T(bar, 0), 0.8); place(drums, KICK, T(bar, 0.5), 0.5)
place(fx, riser(2 * BAR - B * 0.5, 500, 9000), T(16), 0.5)
place(fx, rev_cymbal(1.7), T(18) - 1.7, 0.9)
drop(18, 4, heavy=True)
# 아웃트로 (22-25)
place(fx, impact(), T(22), 1.2)
place(drums, KICKB, T(22), 1.0)
for bar in range(22, 25):
    place(pads, pad(prog[(bar - 22) % 4], BAR + 0.8, 800 - (bar - 22) * 200), T(bar), 0.9 * (1 - (bar - 22) / 3.5))

# 바이닐 크랙클 (인트로/브레이크)
cr = np.zeros(N)
idx = rng.integers(0, N, 2600)
cr[idx] = rng.standard_normal(2600) * 0.5
cr = svf(cr, 3000, 0.7, 'bp')
crack_env = np.zeros(N)
for a, b in [(0, T(8)), (T(16), T(18)), (T(22), DUR)]:
    crack_env[int(a * SR):int(b * SR)] = 1
cr *= crack_env * 0.6

# 사이드체인 (킥에 덕킹)
duck = np.ones(N)
for bar in list(range(8, 16)) + list(range(18, 22)):
    for bt in (0, 2):
        i = int(T(bar, bt) * SR); n = int(0.25 * SR)
        duck[i:i + n] = np.minimum(duck[i:i + n], 0.35 + 0.65 * np.linspace(0, 1, n) ** 0.6)

mix = drums * 0.85 + bass * 0.95 * duck + reverb(pads, 2.5, 0.35) * 0.6 * duck + reverb(lead, 1.6, 0.4) * 0.5 + reverb(fx, 2.8, 0.3) * 0.8 + cr
# 드롭 직전 1박 공백
i0, i1 = int((T(8) - B) * SR), int(T(8) * SR)
mix[i0:i1] *= np.linspace(1, 0, i1 - i0) ** 4
i0, i1 = int((T(18) - B * 0.5) * SR), int(T(18) * SR)
mix[i0:i1] *= 0.15
mix = np.tanh(mix * 1.1) * 0.9
mix /= np.max(np.abs(mix)) * 1.05
st = np.stack([mix, mix], 1)
out = sys.argv[1] if len(sys.argv) > 1 else 'music.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
print('ok', DUR)
