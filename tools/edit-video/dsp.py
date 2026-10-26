import numpy as np
SR = 44100

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

