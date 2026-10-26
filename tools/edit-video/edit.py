# CoD4 프랙무비 스타일 합성기: 샷 프레임 + 이펙트 + 자막 -> raw RGB 를 stdout 으로 (ffmpeg 파이프)
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = sys.argv[1]                     # 샷 프레임 루트 (final/ 또는 prev/)
OUTW, OUTH, FPS = 1280, 720, 30
B = 60 / 140
BAR = 4 * B
def T(bar, beat=0.0): return bar * BAR + beat * B
END = 44.2
LB = 86                               # 레터박스 높이

FONT_TITLE = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'
FONT_MONO = '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf'
FONT_KO = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
_fc = {}
def font(path, size):
    k = (path, size)
    if k not in _fc: _fc[k] = ImageFont.truetype(path, size)
    return _fc[k]

# ------------------------------------------------------------- 소스 로딩
def meta(shot):
    p = os.path.join(SRC, shot, 'meta.json')
    return json.load(open(p)) if os.path.exists(p) else {}

_frames = {}
def frame_list(shot):
    if shot not in _frames:
        d = os.path.join(SRC, shot)
        fs = sorted(f for f in os.listdir(d) if f.endswith('.jpg'))
        _frames[shot] = [(int(f[:4]), os.path.join(d, f)) for f in fs]
    return _frames[shot]

_cache = {}
def load(shot, idx):
    fl = frame_list(shot)
    idx = max(0, min(idx, fl[-1][0]))
    # 가장 가까운 저장 프레임 (프리뷰는 3프레임 간격)
    best = min(fl, key=lambda x: abs(x[0] - idx))
    key = best[1]
    if key not in _cache:
        if len(_cache) > 40: _cache.clear()
        im = Image.open(key).convert('RGB')
        if im.size != (OUTW, OUTH): im = im.resize((OUTW, OUTH), Image.BICUBIC)
        _cache[key] = np.asarray(im, dtype=np.float32) / 255.0
    return _cache[key]

# ------------------------------------------------------------- 타임라인
M = {s: meta(s) for s in ['strafe_kill', 'flyby', 'crash']}
BOOM = M['strafe_kill'].get('boom', 69)
PASS = M['flyby'].get('pass', 40)
HIT = M['crash'].get('hit', 50)

# (시작, 끝, 샷, 소스 시작 프레임, 스타일)
SEG = []
def seg(a, b, shot, src0=0, style='cod', rate=1.0):
    SEG.append(dict(a=a, b=b, shot=shot, src0=src0, style=style, rate=rate))

seg(0.0, T(1, 1.5), None)                                     # 블랙 + 타자기
seg(T(1, 1.5), T(2, 3), 'runway', 0)                          # 2.357 - 4.857
seg(T(2, 3), T(4), 'climb', 0)                                # - 6.857
seg(T(4), T(5, 3), 'takeoff', 0)                              # - 9.857
seg(T(5, 3), 11.4, 'strafe_cockpit', 0)
pre = round((T(8) - B - 11.4) * FPS)
seg(11.4, T(8) - B, 'strafe_kill', max(0, BOOM - pre))        # 폭발 직전까지
seg(T(8) - B, T(8), None, style='title')                      # 무음 1박: 타이틀 슬램
seg(T(8), T(8, 3), 'strafe_kill', BOOM)                       # 드롭 = 폭발
seg(T(8, 3), T(10, 1), 'flyby', max(0, PASS - round((T(9, 2) - T(8, 3)) * FPS)))
seg(T(10, 1), T(11), 'roll', 2)
seg(T(11), T(13), 'ac130', 0, style='thermal')
seg(T(13), 26.0, 'flares', 0)
MONTAGE1 = [('takeoff', 62), ('flyby', PASS - 2), ('cockpit_roll', 20), ('strafe_kill', BOOM + 3), ('roll', 30),
            ('space', 20), ('strafe_cockpit', 30), ('flares', 40), ('takeoff', 80), ('flyby', PASS + 4), ('roll', 44)]
seg(26.0, T(16), 'montage1', 0)
seg(T(16), T(17, 2.25), 'outro', 0, style='break')
KC = round((T(18) - T(17, 2.25)) * FPS)
seg(T(17, 2.25), T(18), 'crash', max(0, HIT - KC), style='killcam')
seg(T(18), T(19), 'crash', HIT)
seg(T(19), T(20, 1.5), 'space', 0)
seg(T(20, 1.5), T(21, 1.5), 'cockpit_roll', 0)
MONTAGE2 = [('strafe_kill', BOOM + 1), ('takeoff', 70), ('flyby', PASS), ('ac130', 78), ('cockpit_roll', 45),
            ('crash', HIT + 2), ('flares', 70), ('space', 45), ('roll', 20), ('strafe_kill', BOOM + 12)]
seg(T(21, 1.5), T(22), 'montage2', 0)
seg(T(22), END, 'outro', 0, style='end')

# ------------------------------------------------------------- 이벤트
FLASH, SHAKE, PUNCH, RGB, HITM = [], [], [], [], []
def flash(t, a=1.0, d=0.25): FLASH.append((t, a, d))
def shake(t, a=10, d=0.5): SHAKE.append((t, a, d))
def punch(t, a=0.05, d=0.22): PUNCH.append((t, a, d))
def rgb(t, a=8, d=0.25): RGB.append((t, a, d))
def hitm(t): HITM.append(t)

flash(T(1, 1.5), 0.5, 0.6)
for s in SEG[1:]:
    if s['style'] not in ('title',): flash(s['a'], 0.35, 0.18)
# 빌드업: 8분음 힛마커 (기총 사격 중)
for k in range(int((T(8) - B - T(5, 3)) / (B / 2))):
    t = T(5, 3) + k * B / 2
    if t > 10.3: hitm(t)
# 드롭 1
flash(T(8), 1.0, 0.22); shake(T(8), 26, 0.9); rgb(T(8), 18, 0.5); hitm(T(8))
flash(T(8) + 7 / 110 * 30 / 30 * 2.5, 0.4, 0.2)
for bar in range(8, 16):
    for bt in (0, 1.5, 2):
        if T(bar, bt) > T(8): punch(T(bar, bt), 0.045 if bt != 2 else 0.06)
    shake(T(bar, 2), 5, 0.25)
t_pass = T(9, 2)
flash(t_pass, 0.8, 0.3); shake(t_pass, 22, 0.8); rgb(t_pass, 14, 0.4)
for b in (1, 2, 3, 4, 6):
    t = T(11) + b * B
    flash(t, 0.6 if b < 6 else 1.0, 0.25); shake(t, 8 if b < 6 else 18, 0.4); hitm(t)
for k in range(len(MONTAGE1)):
    t = 26.0 + k * 4 / FPS
    rgb(t, 10, 0.1); punch(t, 0.03, 0.1)
# 드롭 2
flash(T(18), 1.0, 0.25); shake(T(18), 30, 1.1); rgb(T(18), 22, 0.6); hitm(T(18))
for bar in range(18, 22):
    for bt in (0, 1.5, 2):
        if T(bar, bt) > T(18): punch(T(bar, bt), 0.05 if bt != 2 else 0.07)
    shake(T(bar, 2), 6, 0.25)
for k in range(len(MONTAGE2)):
    t = T(21, 1.5) + k * 3 / FPS
    rgb(t, 12, 0.08); flash(t, 0.25, 0.06)
flash(T(22), 1.0, 1.2); shake(T(22), 20, 1.0)

def env_sum(ev, t, shape='exp'):
    v = 0.0
    for (t0, a, d) in ev:
        if t0 <= t < t0 + d * 4:
            v += a * math.exp(-(t - t0) / d)
    return v

# 킬피드 (시작, 텍스트)
KILLFEED = [(T(8), 'kimjammin', 'GAU-8', 'SAM SITE'),
            (T(9, 2), 'kimjammin', 'MACH 1.2', 'SOUND BARRIER'),
            (T(11) + 6 * B, 'kimjammin', '105mm', 'FALCON-X'),
            (T(18), 'kimjammin', 'GRAVITY', 'kimjammin')]

# ------------------------------------------------------------- 이미지 처리
yy, xx = np.mgrid[0:OUTH, 0:OUTW].astype(np.float32)
_r = np.sqrt(((xx - OUTW / 2) / (OUTW / 2)) ** 2 + ((yy - OUTH / 2) / (OUTH / 2)) ** 2)
VIG = np.clip(1 - 0.42 * np.clip(_r - 0.45, 0, 1) ** 1.6, 0, 1)[..., None]
GRAD = (np.clip(1 - yy / (OUTH * 0.6), 0, 1) ** 1.4)[..., None]
RNG = np.random.default_rng(3)
GRAIN = [RNG.standard_normal((OUTH // 2, OUTW // 2, 1)).astype(np.float32) for _ in range(8)]

def luma(x): return x[..., 0:1] * 0.299 + x[..., 1:2] * 0.587 + x[..., 2:3] * 0.114

def glow(x, thr=0.72, amt=0.7):
    hi = np.clip(x - thr, 0, 1) / (1 - thr)
    im = Image.fromarray((hi * 255).astype(np.uint8)).resize((OUTW // 4, OUTH // 4), Image.BILINEAR)
    im = im.filter(ImageFilter.GaussianBlur(6)).resize((OUTW, OUTH), Image.BILINEAR)
    return x + np.asarray(im, dtype=np.float32) / 255.0 * amt

def grade(x, style):
    if style == 'thermal':
        l = luma(x)
        l = np.clip((l - 0.42) * 1.9, 0, 1) ** 1.35 * 0.92 + 0.04
        im = Image.fromarray((l[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1))
        l = np.asarray(im, dtype=np.float32)[..., None] / 255.0
        return np.repeat(l, 3, axis=2) * np.array([0.92, 0.96, 0.94], np.float32)
    # 하늘(밝고 무채색) 눌러서 청록 하늘로
    l0 = luma(x)
    sat0 = x.max(axis=2, keepdims=True) - x.min(axis=2, keepdims=True)
    m = np.clip((l0 - 0.78) / 0.18, 0, 1) * np.clip(1 - sat0 * 5, 0, 1)
    x = x * (1 - 0.33 * m) + m * np.array([-0.03, 0.02, 0.07], np.float32)
    x = glow(x, 0.82, 0.45)
    x = np.clip(x, 0, 1.3)
    sat = {'cod': 1.18, 'break': 0.3, 'killcam': 0.5, 'end': 0.7}.get(style, 1.18)
    # 중간톤 낮추기 + 대비
    x = x ** 1.45
    x = 0.42 + (x - 0.42) * 1.38
    x = np.clip((x - 0.03) / 0.97, 0, 1.2)
    l = luma(x)
    x = l + (x - l) * sat
    l = np.clip(luma(x), 0, 1)
    sh = (1 - l) ** 2
    hl = l ** 2
    if style == 'break':
        x = x + sh * np.array([-0.02, 0.0, 0.04], np.float32) + hl * np.array([0.0, 0.02, 0.05], np.float32)
    else:
        x = x + sh * np.array([-0.03, 0.015, 0.05], np.float32) + hl * np.array([0.085, 0.03, -0.06], np.float32)
    # 그라데이션 필터 (하늘을 눌러 깊이감)
    x = x * (1 - 0.38 * GRAD) + GRAD * np.array([0.05, 0.03, 0.0], np.float32) * (style == 'cod')
    x = x * VIG
    return np.clip(x, 0, 1)

def transform(x, zoom=1.0, dx=0.0, dy=0.0, rot=0.0):
    if abs(zoom - 1) < 1e-4 and abs(dx) < 0.05 and abs(dy) < 0.05 and abs(rot) < 1e-5:
        return x
    im = Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8))
    cx, cy = OUTW / 2, OUTH / 2
    c, s = math.cos(rot) / zoom, math.sin(rot) / zoom
    # 출력 좌표 -> 입력 좌표
    a, b_, d, e = c, s, -s, c
    cxo = cx - a * (cx + dx) - b_ * (cy + dy)
    cyo = cy - d * (cx + dx) - e * (cy + dy)
    im = im.transform((OUTW, OUTH), Image.AFFINE, (a, b_, cxo, d, e, cyo), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0

def rgb_split(x, k):
    k = int(round(k))
    if k <= 0: return x
    y = x.copy()
    y[..., 0] = np.roll(x[..., 0], k, axis=1)
    y[..., 2] = np.roll(x[..., 2], -k, axis=1)
    return y

# ------------------------------------------------------------- 텍스트/HUD 오버레이
def text_layer():
    return Image.new('RGBA', (OUTW, OUTH), (0, 0, 0, 0))

def draw_text(layer, xy, s, fnt, fill=(255, 255, 255, 255), anchor='la', glow_r=0, spacing=0):
    d = ImageDraw.Draw(layer)
    if spacing:
        # 자간
        x, y = xy
        widths = [fnt.getlength(ch) + spacing for ch in s]
        total = sum(widths) - spacing
        if anchor[0] == 'm': x -= total / 2
        elif anchor[0] == 'r': x -= total
        for ch, w in zip(s, widths):
            d.text((x, y), ch, font=fnt, fill=fill, anchor='l' + anchor[1])
            x += w
    else:
        d.text(xy, s, font=fnt, fill=fill, anchor=anchor)

def typed(s, t, t0, cps=22):
    n = int(max(0, (t - t0) * cps))
    return s[:n], n < len(s)

def overlay_text(t, style):
    L = text_layer()
    d = ImageDraw.Draw(L)
    any_ = False
    # 인트로 타자기
    if t < T(1, 1.5):
        a = int(255 * min(1, (T(1, 1.5) - t) / 0.3))
        s, cur = typed('kimjammin presents', t, 0.35, 20)
        blink = int(t * 4) % 2 == 0
        draw_text(L, (OUTW / 2, OUTH / 2), s + ('_' if blink else ' '), font(FONT_MONO, 30), (235, 235, 235, a), 'mm')
        any_ = True
    # CoD4 미션 인트로 풍 텍스트 (runway)
    if T(1, 2) < t < T(2, 3) + 0.4:
        lines = ['Day 1 - 17:00:00', 'Sgt. kimjammin', 'FREE FREELY Air Base, Pacific']
        a = int(255 * min(1, (T(2, 3) + 0.4 - t) / 0.4))
        for k, ln in enumerate(lines):
            s, _ = typed(ln, t, T(1, 2) + k * 0.55, 30)
            if s:
                draw_text(L, (OUTW - 60, OUTH - LB - 110 + k * 34), s, font(FONT_MONO, 24), (230, 240, 225, a), 'ra')
        any_ = True
    # 타이틀 슬램 (무음 1박)
    if T(8) - B <= t < T(8):
        k = (t - (T(8) - B)) / B
        sz = int(118 - 14 * k)
        draw_text(L, (OUTW / 2, OUTH / 2), 'FREE FREELY', font(FONT_TITLE, sz), (255, 255, 255, 255), 'mm', spacing=10)
        draw_text(L, (OUTW / 2, OUTH / 2 + 78), 'a  k i m j a m m i n  e d i t', font(FONT_MONO, 20), (210, 210, 210, 230), 'mm')
        any_ = True
    # 브레이크 자막
    if T(16) + 0.2 < t < T(17, 2.25):
        a = int(255 * min(1, (t - T(16) - 0.2) / 0.4, (T(17, 2.25) - t) / 0.3))
        draw_text(L, (OUTW / 2, OUTH - LB - 60), 'kimjammin', font(FONT_TITLE, 46), (255, 255, 255, a), 'mm', spacing=14)
        draw_text(L, (OUTW / 2, OUTH - LB - 22), '하늘은 끝까지 자유롭다', font(FONT_KO, 22), (225, 225, 225, a), 'mm')
        any_ = True
    # FINAL KILLCAM 배너
    if T(17, 2.25) <= t < T(18):
        d.rectangle([0, LB + 18, OUTW, LB + 74], fill=(0, 0, 0, 150))
        blink = 255 if int(t * 6) % 2 == 0 else 200
        draw_text(L, (OUTW / 2, LB + 46), 'FINAL KILLCAM', font(FONT_TITLE, 34), (255, 210, 60, blink), 'mm', spacing=8)
        any_ = True
    # 엔딩 카드
    if t >= T(22):
        k = t - T(22)
        a = int(255 * min(1, k / 0.25) * min(1, max(0, (END - 0.6 - t) / 0.8)))
        sz = int(130 + 10 * math.exp(-k * 6))
        draw_text(L, (OUTW / 2, OUTH / 2 - 20), 'FREE FREELY', font(FONT_TITLE, sz), (255, 255, 255, a), 'mm', spacing=12)
        if k > 0.9:
            a2 = int(a * min(1, (k - 0.9) / 0.5))
            draw_text(L, (OUTW / 2, OUTH / 2 + 70), 'kimjammin  x  claude', font(FONT_MONO, 24), (220, 220, 220, a2), 'mm')
        if k > 1.6:
            a3 = int(a * min(1, (k - 1.6) / 0.5))
            draw_text(L, (OUTW / 2, OUTH / 2 + 108), 'github.com/kimblox26-arch/kimjamminGame', font(FONT_MONO, 16), (170, 170, 170, a3), 'mm')
        any_ = True
    # 킬피드 (우상단)
    rows = [(t0, a, w, v) for (t0, a, w, v) in KILLFEED if t0 <= t < t0 + 3.2]
    for k, (t0, a_, w, v) in enumerate(reversed(rows)):
        al = int(255 * min(1, (t - t0) / 0.08, (t0 + 3.2 - t) / 0.4))
        y = LB + 24 + k * 30
        f = font(FONT_MONO, 18)
        s3 = v
        x = OUTW - 30
        w3 = f.getlength(s3); w2 = f.getlength('[' + w + ']'); w1 = f.getlength(a_)
        d.rectangle([x - w1 - w2 - w3 - 40, y - 4, x + 8, y + 22], fill=(0, 0, 0, int(al * 0.45)))
        d.text((x - w3, y), s3, font=f, fill=(255, 90, 80, al))
        d.text((x - w3 - 14 - w2, y), '[' + w + ']', font=f, fill=(230, 230, 230, al))
        d.text((x - w3 - 28 - w2 - w1, y), a_, font=f, fill=(120, 200, 255, al))
        any_ = True
    # 힛마커
    for th in HITM:
        if th <= t < th + 0.22:
            al = int(255 * (1 - (t - th) / 0.22))
            cx, cy = OUTW / 2, OUTH / 2
            for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
                d.line([cx + sx * 9, cy + sy * 9, cx + sx * 22, cy + sy * 22], fill=(0, 0, 0, al // 2), width=6)
                d.line([cx + sx * 9, cy + sy * 9, cx + sx * 22, cy + sy * 22], fill=(255, 255, 255, al), width=3)
            any_ = True
    # AC-130 열화상 HUD
    if style == 'thermal':
        g = (235, 235, 235, 220)
        cx, cy = OUTW / 2, OUTH / 2
        d.line([cx - 90, cy, cx - 22, cy], fill=g, width=2); d.line([cx + 22, cy, cx + 90, cy], fill=g, width=2)
        d.line([cx, cy - 90, cx, cy - 22], fill=g, width=2); d.line([cx, cy + 22, cx, cy + 90], fill=g, width=2)
        for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            x0, y0 = cx + sx * 150, cy + sy * 110
            d.line([x0, y0, x0 - sx * 40, y0], fill=g, width=3); d.line([x0, y0, x0, y0 - sy * 40], fill=g, width=3)
        f = font(FONT_MONO, 20)
        d.text((40, LB + 20), 'WHOT', font=f, fill=g)
        d.text((40, LB + 48), 'ZOOM 8.5x', font=f, fill=g)
        d.text((OUTW - 40, LB + 20), '105 mm', font=f, fill=g, anchor='ra')
        d.text((OUTW - 40, OUTH - LB - 40), '%02d:%02d:%02d' % (17, 3, int(t * 10) % 60), font=f, fill=g, anchor='ra')
        any_ = True
    return L if any_ else None

# ------------------------------------------------------------- 몽타주 소스
def montage_src(lst, local_frame, per):
    k = min(len(lst) - 1, local_frame // per)
    shot, f0 = lst[k]
    return shot, f0 + local_frame % per

# ------------------------------------------------------------- 메인 루프
def render(t):
    s = next((s for s in SEG if s['a'] <= t < s['b']), SEG[-1])
    style = s['style']
    lf = int(round((t - s['a']) * FPS))
    if s['shot'] is None:
        x = np.zeros((OUTH, OUTW, 3), np.float32)
    else:
        if s['shot'] == 'montage1': shot, fi = montage_src(MONTAGE1, lf, 4)
        elif s['shot'] == 'montage2': shot, fi = montage_src(MONTAGE2, lf, 3)
        elif style == 'end': shot, fi = s['shot'], s['src0'] + lf // 3
        else: shot, fi = s['shot'], s['src0'] + int(lf * s['rate'])
        x = load(shot, fi)
        x = grade(x, style if shot != 'ac130' else 'thermal')
        if style == 'end':
            im = Image.fromarray((x * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4 + min(10, (t - s['a']) * 8)))
            x = np.asarray(im, dtype=np.float32) / 255.0 * max(0.16, 0.42 - (t - s['a']) * 0.3)
    # 페이드 인 (runway)
    if s['shot'] == 'runway':
        x = x * min(1, (t - s['a']) / 0.6)
    # 무음 1박 직전 빌드: 푸시 인 + 탈색
    zoom = 1.0 + env_sum(PUNCH, t)
    if s['shot'] == 'strafe_kill' and t < T(8) - B and t > T(8) - 3 * B:
        k = (t - (T(8) - 3 * B)) / (2 * B)
        zoom += 0.12 * k * k
    if style == 'killcam':
        zoom += 0.04 * (t - s['a'])
    pivot = None
    if s['shot'] == 'strafe_kill' and t >= T(8):
        # 드롭 순간 폭발 지점으로 스냅 줌
        zoom += 0.38 * (1 - math.exp(-(t - T(8)) * 9))
        pivot = (0.555 * OUTW, 0.43 * OUTH)
    sh = env_sum(SHAKE, t)
    dx = sh * (math.sin(t * 91.3) + 0.5 * math.sin(t * 217.1))
    dy = sh * (math.cos(t * 77.9) + 0.5 * math.sin(t * 181.7))
    rot = sh * 0.0009 * math.sin(t * 63.1)
    if pivot:
        dx -= (pivot[0] - OUTW / 2) * (zoom - 1)
        dy -= (pivot[1] - OUTH / 2) * (zoom - 1)
    x = transform(x, zoom, dx, dy, rot)
    x = rgb_split(x, env_sum(RGB, t))
    # 그레인
    g = GRAIN[int(t * FPS) % len(GRAIN)]
    g = np.repeat(np.repeat(g, 2, 0), 2, 1)
    x = x + g * (0.05 if style == 'thermal' else 0.02)
    # 플래시
    f = min(1.0, env_sum(FLASH, t))
    x = x + (1 - x) * f
    # 레터박스
    x[:LB] = 0; x[-LB:] = 0
    x = np.clip(x, 0, 1)
    img = Image.fromarray((x * 255).astype(np.uint8))
    L = overlay_text(t, style)
    if L is not None:
        sh_ = L.filter(ImageFilter.GaussianBlur(3))
        img.paste((0, 0, 0), (0, 0), sh_.getchannel('A').point(lambda v: v * 0.6))
        img.paste(L, (0, 0), L)
    # 최종 페이드 아웃
    if t > END - 0.6:
        a = max(0, (END - t) / 0.6)
        img = Image.blend(Image.new('RGB', img.size), img, a)
    return img

if __name__ == '__main__':
    only = os.environ.get('ONLY')            # "t0,t1" 구간만
    t0, t1 = (0, END)
    if only: t0, t1 = map(float, only.split(','))
    step = int(os.environ.get('STEP', '1'))
    n0, n1 = int(t0 * FPS), int(t1 * FPS)
    out = sys.stdout.buffer
    snap = os.environ.get('SNAP')
    for n in range(n0, n1, step):
        img = render(n / FPS)
        if snap:
            img.save(os.path.join(snap, '%05d.jpg' % n), quality=88)
        else:
            out.write(img.tobytes())
    if not snap: out.flush()
    print(json.dumps({'BOOM': BOOM, 'PASS': PASS, 'HIT': HIT, 'segments': len(SEG)}), file=sys.stderr)
