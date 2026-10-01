# 인물별 피부/털 색 (sRGB). human.js VARIANTS 와 키를 맞춘다.
def hx(h): return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
LOOK = {
    'jin':   dict(skin=[0.78, 0.61, 0.47], hair=hx(0x15110e), stubble=0.75, scalp=0.75, flush=0.8),
    'mason': dict(skin=[0.83, 0.64, 0.53], hair=hx(0x3a2a1c), brow=hx(0x2e2016), stubble=1.0, scalp=0.6, flush=1.2, freckle=0.5, tired=1.2),
    'sofia': dict(skin=[0.81, 0.62, 0.50], hair=hx(0x2b1b10), brow=hx(0x241710), stubble=0.0, scalp=0.55, flush=1.0, browThick=0.72, browScale=0.95, lip=[0.94, 0.66, 0.68], freckle=0.4),
    'dae':   dict(skin=[0.74, 0.55, 0.42], hair=hx(0x0f0c0a), stubble=0.65, scalp=0.75, flush=0.7, tired=1.3),
    'op1':   dict(skin=[0.80, 0.62, 0.50], hair=hx(0x14110e), stubble=0.95, scalp=0.85, flush=1.0),
    'op2':   dict(skin=[0.62, 0.44, 0.33], hair=hx(0x100d0b), stubble=1.0, scalp=0.7, flush=0.6, tired=1.2),
    'op3':   dict(skin=[0.85, 0.67, 0.57], hair=hx(0x2a1d12), brow=hx(0x22170e), stubble=0.45, scalp=0.7, flush=1.3, freckle=0.7),
    'op4':   dict(skin=[0.42, 0.29, 0.21], hair=hx(0x0c0a08), stubble=0.7, scalp=0.85, flush=0.3, lip=[0.82, 0.70, 0.72]),
}
