# TikTok 세로 에딧 합성기 (720x1280, 120BPM)  사용법: python3 tiktok.py <SRC> | ffmpeg ...
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = sys.argv[1]
W, H, FPS = 720, 1280, 30
B = 0.5
END = 16.6

FONT_TITLE = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'
FONT_MONO = '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf'
FONT_KO = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
_fc = {}
def font(p, s):
    if (p, s) not in _fc: _fc[(p, s)] = ImageFont.truetype(p, s)
    return _fc[(p, s)]

def meta(shot):
    p = os.path.join(SRC, shot, 'meta.json')
    return json.load(open(p)) if os.path.exists(p) else {}

_fl = {}
def frames(shot):
    if shot not in _fl:
        d = os.path.join(SRC, shot)
        _fl[shot] = sorted(int(f[:4]) for f in os.listdir(d) if f.endswith('.jpg'))
    return _fl[shot]

_cache = {}
def load(shot, idx):
    fl = frames(shot)
    idx = min(fl, key=lambda v: abs(v - idx))
    key = (shot, idx)
    if key not in _cache:
        if len(_cache) > 60: _cache.clear()
        im = Image.open(os.path.join(SRC, shot, '%04d.jpg' % idx)).convert('RGB')
        if im.size != (W, H): im = im.resize((W, H), Image.BICUBIC)
        _cache[key] = np.asarray(im, dtype=np.float32) / 255.0
    return _cache[key]

P_TO = meta('takeoff').get('pass', 62)
BOOM = meta('strafe_kill').get('boom', 75)
PASS = meta('flyby').get('pass', 62)
HIT = meta('crash').get('hit', 68)
LAST_TO = frames('takeoff')[-1]

# (시작, 끝, 샷, 소스 시작, 소스 끝, 벨로시티)
SEG = [
    (0.0, 2.0, 'runway', 8, 68, False),
    (2.0, 4.0, 'takeoff', max(0, P_TO - 60), P_TO, False),
    (4.0, 5.0, 'takeoff', P_TO, min(P_TO + 30, LAST_TO), False),
    (5.0, 6.0, 'strafe_kill', BOOM - 60, BOOM, True),
    (6.0, 7.0, 'strafe_kill', BOOM, BOOM + 30, False),
    (7.0, 8.0, 'flyby', PASS - 15, PASS + 15, False),
    (8.0, 8.5, 'cockpit_roll', 10, 40, True),
    (8.5, 10.0, 'flares', 6, 51, False),
    (10.0, 10.5, 'roll', 4, 34, True),
    (10.5, 11.0, 'crash', HIT - 15, HIT, False),
    (11.0, 12.0, 'crash', HIT, HIT + 30, False),
    (12.0, 14.0, 'outro', 0, 60, False),
    (14.0, END, 'climb', 0, 60 * (END - 14.0) / 2.0, False),
]

def src_pos(seg, t):
    a, b, shot, s0, s1, vel = seg
    u = (t - a) / (b - a)
    if vel:
        nb = max(1, round((b - a) / B))
        k = min(nb - 1, int(u * nb)); v = u * nb - k
        u = (k + (1 - (1 - v) ** 2.2)) / nb
    return s0 + (s1 - s0) * u

# ------------------------------------------------------------- 이벤트
def ev_sum(ev, t):
    return sum(a * math.exp(-(t - t0) / d) for (t0, a, d) in ev if t0 <= t < t0 + d * 5)

FLASH = [(4.0, 0.9, 0.18), (6.0, 1.0, 0.16), (11.0, 1.0, 0.2), (12.0, 0.5, 0.3)]
FLASH += [(s[0], 0.25, 0.08) for s in SEG[1:] if s[0] not in (4.0, 6.0, 11.0, 12.0)]
SHAKE = [(4.0, 16, 0.4), (6.0, 20, 0.5), (11.0, 24, 0.6)]
PUNCH, RGB = [], [(4.0, 10, 0.25), (6.0, 14, 0.3), (11.0, 16, 0.35)]
for k in range(16):
    t = 4.0 + k * B
    down = k % 4 == 0
    PUNCH.append((t, 0.075 if down else 0.04, 0.13))
    RGB.append((t, 4 if down else 2, 0.1))
    if down: SHAKE.append((t, 6, 0.2))
ZBLUR = [4.0, 6.0, 8.0, 11.0, 12.0]

# ------------------------------------------------------------- 이미지 처리
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
_r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
VIG = np.clip(1 - 0.5 * np.clip(_r - 0.5, 0, 1) ** 1.5, 0, 1)[..., None]
GRAD = (np.clip(1 - yy / (H * 0.55), 0, 1) ** 1.4)[..., None]
RNG = np.random.default_rng(9)
GRAIN = [RNG.standard_normal((H // 2, W // 2, 1)).astype(np.float32) for _ in range(8)]

def luma(x): return x[..., 0:1] * 0.299 + x[..., 1:2] * 0.587 + x[..., 2:3] * 0.114

def glow(x, thr, amt):
    hi = np.clip(x - thr, 0, 1) / (1 - thr)
    im = Image.fromarray((hi * 255).astype(np.uint8)).resize((W // 4, H // 4), Image.BILINEAR)
    im = im.filter(ImageFilter.GaussianBlur(7)).resize((W, H), Image.BILINEAR)
    return x + np.asarray(im, dtype=np.float32) / 255.0 * amt

def grade(x, t):
    l0 = luma(x)
    sat0 = x.max(axis=2, keepdims=True) - x.min(axis=2, keepdims=True)
    m = np.clip((l0 - 0.78) / 0.18, 0, 1) * np.clip(1 - sat0 * 5, 0, 1)
    # 디밴딩: 매끈한 하늘 영역만 블러 (태양 주변 8비트 링 제거, 가장자리는 보존)
    im = Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8)).resize((W // 4, H // 4), Image.BILINEAR)
    bl = np.asarray(im.filter(ImageFilter.GaussianBlur(7)).resize((W, H), Image.BILINEAR), dtype=np.float32) / 255.0
    edge = np.abs(luma(x) - luma(bl))
    m2 = np.clip((l0 - 0.5) / 0.2, 0, 1) * np.clip(1 - sat0 * 4, 0, 1) * np.clip(1 - edge * 30, 0, 1)
    x = x * (1 - m2) + bl * m2
    x = x * (1 - 0.36 * m) + m * np.array([-0.03, 0.02, 0.08], np.float32)
    x = glow(x, 0.78, 0.6)
    x = np.clip(x, 0, 1.3) ** 1.4
    x = 0.42 + (x - 0.42) * 1.32
    x = np.clip(x, 0, 1.2)
    intro_outro = t < 4.0 or t >= 12.0
    sat = 0.8 if intro_outro else 1.15
    l = luma(x); x = l + (x - l) * sat
    l = np.clip(luma(x), 0, 1)
    x = x + (1 - l) ** 2 * np.array([-0.03, 0.02, 0.06], np.float32) + l ** 2 * np.array([0.09, 0.03, -0.05], np.float32)
    x = x * (1 - 0.3 * GRAD)
    x = x * VIG
    x = 0.035 + x * 0.965                      # 살짝 들린 블랙 (필름 톤)
    return np.clip(x, 0, 1)

def transform(x, zoom, dx, dy, rot, pivot=None):
    if pivot:
        dx -= (pivot[0] - W / 2) * (zoom - 1); dy -= (pivot[1] - H / 2) * (zoom - 1)
    if abs(zoom - 1) < 1e-4 and abs(dx) < 0.05 and abs(dy) < 0.05 and abs(rot) < 1e-5:
        return x
    im = Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8))
    cx, cy = W / 2, H / 2
    c, s = math.cos(rot) / zoom, math.sin(rot) / zoom
    a, b_, d, e = c, s, -s, c
    im = im.transform((W, H), Image.AFFINE, (a, b_, cx - a * (cx + dx) - b_ * (cy + dy), d, e, cy - d * (cx + dx) - e * (cy + dy)), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0

def zoom_blur(x, amt):
    if amt < 0.01: return x
    acc = x.copy(); n = 5
    for k in range(1, n):
        acc += transform(x, 1 + amt * 0.08 * k, 0, 0, 0)
    return acc / n

def rgb_split(x, k):
    k = int(round(k))
    if k <= 0: return x
    y = x.copy()
    y[..., 0] = np.roll(x[..., 0], k, axis=1); y[..., 2] = np.roll(x[..., 2], -k, axis=1)
    return y

def draw_spaced(d, xy, s, f, fill, spacing):
    widths = [f.getlength(ch) + spacing for ch in s]
    x = xy[0] - (sum(widths) - spacing) / 2
    for ch, w in zip(s, widths):
        d.text((x, xy[1]), ch, font=f, fill=fill, anchor='lm'); x += w

def texts(t):
    L = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(L); any_ = False
    def fade(t0, t1, fi=0.35, fo=0.35):
        return max(0.0, min(1.0, (t - t0) / fi, (t1 - t) / fo))
    a = fade(0.3, 1.95)
    if a > 0:
        draw_spaced(d, (W / 2, H * 0.40), 'free freely', font(FONT_TITLE, 64), (255, 255, 255, int(255 * a)), 6)
        d.text((W / 2, H * 0.40 + 62), 'kimjammin', font=font(FONT_MONO, 22), fill=(220, 220, 220, int(200 * a)), anchor='mm')
        any_ = True
    a = fade(12.3, 13.9)
    if a > 0:
        d.text((W / 2, H * 0.40), '끝까지 자유롭게', font=font(FONT_KO, 40), fill=(255, 255, 255, int(255 * a)), anchor='mm')
        any_ = True
    a = fade(14.2, END - 0.3, 0.25, 0.5)
    if a > 0:
        k = t - 14.2
        sz = int(76 + 8 * math.exp(-k * 7))
        draw_spaced(d, (W / 2, H * 0.40), 'FREE FREELY', font(FONT_TITLE, sz), (255, 255, 255, int(255 * a)), 6)
        d.text((W / 2, H * 0.40 + 70), '@kimjammin', font=font(FONT_MONO, 24), fill=(225, 225, 225, int(220 * a)), anchor='mm')
        any_ = True
    return L if any_ else None

prev_src = {}
def render(n):
    t = n / FPS
    seg = next((s for s in SEG if s[0] <= t < s[1]), SEG[-1])
    shot = seg[2]
    sp = src_pos(seg, t)
    # 모션 블러: 직전 출력 프레임 이후 지나간 소스 프레임들을 평균
    p0 = prev_src.get('v') if prev_src.get('seg') == seg else None
    prev_src['seg'], prev_src['v'] = seg, sp
    idxs = [round(sp)]
    if p0 is not None and sp - p0 > 1.5:
        k = min(4, int(sp - p0))
        idxs = [round(p0 + (sp - p0) * (j + 1) / k) for j in range(k)]
    x = sum(load(shot, i) for i in idxs) / len(idxs)
    x = grade(x, t)
    zoom = 1.0 + ev_sum(PUNCH, t)
    pivot = None
    if seg[2] == 'strafe_kill' and seg[0] == 6.0:
        zoom += 0.35 * (1 - math.exp(-(t - 6.0) * 9)); pivot = (W * 0.55, H * 0.46)
    if t < 4.0 and t >= 3.0:
        zoom += 0.06 * ((t - 3.0) / 1.0) ** 2           # 드롭 직전 서서히 푸시 인
    if t >= 12.0:
        zoom += 0.03 * (t - 12.0) / 4.6
    sh = ev_sum(SHAKE, t)
    dx = sh * (math.sin(t * 91.3) + 0.5 * math.sin(t * 217.1))
    dy = sh * (math.cos(t * 77.9) + 0.5 * math.sin(t * 181.7))
    x = transform(x, zoom, dx, dy, sh * 0.001 * math.sin(t * 63.1), pivot)
    zb = max([max(0.0, 1 - abs(t - c) / 0.12) for c in ZBLUR] + [0.0])
    x = zoom_blur(x, zb)
    x = rgb_split(x, ev_sum(RGB, t))
    g = GRAIN[n % len(GRAIN)]
    x = x + np.repeat(np.repeat(g, 2, 0), 2, 1) * 0.026
    f = min(1.0, ev_sum(FLASH, t))
    x = x + (1 - x) * f
    if t < 0.45: x = x * (t / 0.45)                       # 페이드 인
    if t > END - 0.7: x = x * max(0.0, (END - t) / 0.7)   # 페이드 아웃
    img = Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8))
    L = texts(t)
    if L is not None:
        gl = L.filter(ImageFilter.GaussianBlur(6))
        img.paste((255, 255, 255), (0, 0), gl.getchannel('A').point(lambda v: v * 0.35))
        sh_ = L.filter(ImageFilter.GaussianBlur(2))
        img.paste((0, 0, 0), (0, 0), sh_.getchannel('A').point(lambda v: v * 0.5))
        img.paste(L, (0, 0), L)
    return img

if __name__ == '__main__':
    only = os.environ.get('ONLY'); snap = os.environ.get('SNAP')
    n0, n1 = (0, int(END * FPS))
    if only: n0, n1 = (int(float(v) * FPS) for v in only.split(','))
    out = sys.stdout.buffer
    for n in range(n0, n1):
        img = render(n)
        if snap: img.save(os.path.join(snap, '%05d.jpg' % n), quality=88)
        else: out.write(img.tobytes())
    print(json.dumps({'P_TO': P_TO, 'BOOM': BOOM, 'PASS': PASS, 'HIT': HIT}), file=sys.stderr)
