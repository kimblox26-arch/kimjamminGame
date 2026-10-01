# 얼굴/목 피부 텍스처 베이크 (UV 공간 래스터화 → 3D 위치 기반 절차적 피부)
# 사용: python3 bake_skin.py <out dir> [해상도=1024]
# 출력: <key>_d.jpg (인물별 알베도, sRGB), skin_n.jpg (공용 노멀: 모공·주름)
import sys, os
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skinlook import LOOK

OUT = sys.argv[1]
RES = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
C = np.array([0, 1.667, 0.012])
Z = np.load(os.path.dirname(os.path.abspath(__file__)) + '/.cache/bake.npz')
IDX, fr, UVS = Z['IDX'], Z['fr'], Z['UVS']
T = IDX[fr == 0]

# ── 노이즈 (벡터화 값 노이즈) ──
def _h(x, y, z):
    h = (x * 374761393 + y * 668265263 + z * 1274126177) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return ((h ^ (h >> 16)) & 0xffffffff) / 4294967295.0
def n3(p, s):
    q = p * s; i = np.floor(q).astype(np.int64); f = q - i; u = f * f * (3 - 2 * f)
    x, y, z = i[:, 0], i[:, 1], i[:, 2]
    L = lambda a, b, t: a + (b - a) * t
    c = lambda dx, dy, dz: _h(x + dx, y + dy, z + dz)
    return L(L(L(c(0, 0, 0), c(1, 0, 0), u[:, 0]), L(c(0, 1, 0), c(1, 1, 0), u[:, 0]), u[:, 1]),
             L(L(c(0, 0, 1), c(1, 0, 1), u[:, 0]), L(c(0, 1, 1), c(1, 1, 1), u[:, 0]), u[:, 1]), u[:, 2])
def fbm(p, s, o=4):
    a, t, w = 0.5, 0, 0
    for k in range(o): t += a * n3(p + k * 17.3, s * 2 ** k); w += a; a *= 0.5
    return t / w
sm = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))
g2 = lambda dx, dy, sx, sy: np.exp(-((dx / sx) ** 2 + (dy / sy) ** 2))

def raster(Y):
    """UV 공간 래스터: 텍셀별 3D 위치/법선/곡률"""
    P = np.full((RES, RES, 3), np.nan); N = np.zeros((RES, RES, 3)); K = np.zeros((RES, RES))
    # 정점 법선/오목도 (머리 메시)
    n = len(Y)
    VN = np.zeros_like(Y); a, b, c = Y[T[:, 0]], Y[T[:, 1]], Y[T[:, 2]]; fn = np.cross(b - a, c - a)
    for k in range(3): np.add.at(VN, T[:, k], fn)
    VN /= np.maximum(np.linalg.norm(VN, axis=1, keepdims=True), 1e-12)
    S = np.zeros_like(Y); cnt = np.zeros(n)
    for i0, i1 in ((0, 1), (1, 2), (2, 0), (1, 0), (2, 1), (0, 2)):
        np.add.at(S, T[:, i0], Y[T[:, i1]]); np.add.at(cnt, T[:, i0], 1)
    lap = S / np.maximum(cnt, 1)[:, None] - Y
    cav = np.einsum('ij,ij->i', lap, VN) / 0.004   # + 오목, - 볼록
    for _ in range(2):   # 매끄럽게
        S2 = np.zeros(n); np.add.at(S2, T[:, 0], cav[T[:, 1]] + cav[T[:, 2]]); np.add.at(S2, T[:, 1], cav[T[:, 0]] + cav[T[:, 2]]); np.add.at(S2, T[:, 2], cav[T[:, 0]] + cav[T[:, 1]])
        c2 = np.zeros(n); np.add.at(c2, T.ravel(), 2); cav = 0.5 * cav + 0.5 * S2 / np.maximum(c2, 1)
    uv = UVS * RES
    for t in T:
        p = uv[t]; x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, RES - 1), min(y1, RES - 1)
        if x1 < x0 or y1 < y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
        if abs(d) < 1e-12: continue
        l0 = ((p[1, 1] - p[2, 1]) * (xs - p[2, 0]) + (p[2, 0] - p[1, 0]) * (ys - p[2, 1])) / d
        l1 = ((p[2, 1] - p[0, 1]) * (xs - p[2, 0]) + (p[0, 0] - p[2, 0]) * (ys - p[2, 1])) / d
        l2 = 1 - l0 - l1
        m = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
        if not m.any(): continue
        yy, xx = (ys[m] - 0.5).astype(int), (xs[m] - 0.5).astype(int)
        L = np.stack([l0[m], l1[m], l2[m]], 1)
        P[yy, xx] = L @ Y[t]; N[yy, xx] = L @ VN[t]; K[yy, xx] = L @ cav[t]
    return P, N, K

def dilate(img, mask, it=12):
    img = img.copy(); m = mask.copy()
    for _ in range(it):
        acc = np.zeros_like(img); c = np.zeros(m.shape)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            sh = np.roll(np.roll(m, dy, 0), dx, 1); acc += np.roll(np.roll(img, dy, 0), dx, 1) * sh[..., None]; c += sh
        new = (~m) & (c > 0)
        img[new] = acc[new] / c[new][:, None]; m = m | new
    img[~m] = img[m].mean(0)
    return img

def skin_color(p, n, cav, look):
    lx, ly, lz = (p - C).T
    ax = np.abs(lx)
    base = np.array(look['skin'], float)
    col = np.tile(base, (len(p), 1))
    # 저주파 얼룩 + 색상 미세 변화 (노란 이마, 붉은 볼/코/귀/턱 끝)
    mot = fbm(p, 18) - 0.5
    col *= (1 + mot[:, None] * np.array([0.10, 0.11, 0.12]))
    red = (0.9 * g2(ax - 0.042, ly + 0.022, 0.024, 0.022) * (lz > 0.04)          # 볼
           + 1.1 * g2(lx, ly + 0.03, 0.013, 0.02) * (lz > 0.1)                  # 코끝
           + 0.6 * g2(ax - 0.074, ly + 0.0, 0.016, 0.03)                        # 귀
           + 0.35 * g2(lx, ly + 0.098, 0.02, 0.012) * (lz > 0.07)               # 턱 끝
           + 0.25 * g2(lx, ly - 0.06, 0.05, 0.03) * (lz > 0.06))                # 이마
    red *= look.get('flush', 1.0)
    col += red[:, None] * np.array([0.035, -0.008, -0.01])
    yel = g2(lx, ly - 0.07, 0.05, 0.03) * (lz > 0.03)
    col += yel[:, None] * np.array([0.012, 0.01, -0.012])
    # 눈 주변: 아래 다크서클(보라빛), 위 눈꺼풀 주름 그늘
    eye = g2(ax - 0.03, ly + 0.012, 0.016, 0.008) * (lz > 0.06)
    col -= eye[:, None] * np.array([0.05, 0.06, 0.035]) * look.get('tired', 1.0)
    lid = g2(ax - 0.03, ly - 0.012, 0.016, 0.005) * (lz > 0.06)
    col -= lid[:, None] * np.array([0.04, 0.05, 0.04])
    # 입술 (붉은 입술 경계 + 아랫입술이 약간 진함)
    # 큐피드 활: 윗입술 경계가 중앙에서 살짝 올라감
    bow = -0.0525 + 0.0018 * np.exp(-((ax - 0.006) / 0.005) ** 2) - 0.004 * sm(0.01, 0.026, ax)
    lipU = sm(0.027, 0.02, ax) * sm(bow + 0.0012, bow - 0.0012, ly) * sm(-0.0712, -0.0695, ly)
    lipL = sm(0.025, 0.017, ax) * sm(-0.0698, -0.0712, ly) * sm(-0.0835, -0.079, ly + 0.25 * ax * ax / 0.025)
    lip = np.clip((lipU + lipL * 1.1) * (lz > 0.088), 0, 1)
    mline = g2(0, ly + 0.0705, 1, 0.0009) * sm(0.026, 0.018, ax) * (lz > 0.09)
    lipc = base * np.array(look.get('lip', [0.92, 0.72, 0.74]))
    col = col * (1 - lip[:, None] * 0.85) + lipc * lip[:, None] * 0.85
    col *= (1 - mline[:, None] * 0.45)
    # 오목부 그늘 (곡률 기반 AO): 콧방울, 눈구석, 귀 주름, 입꼬리
    ao = np.clip(cav * 0.9, 0, 1)
    col *= (1 - ao[:, None] * np.array([0.42, 0.5, 0.48]))
    col *= (1 + np.clip(-cav, 0, 1)[:, None] * 0.05)
    # 턱 아래/목 그늘 (위에서 빛)
    col *= (1 - (0.12 * sm(-0.1, -0.135, ly) * (lz < 0.06)))[:, None]
    # 수염 자국 / 수염 그림자
    top = -0.05 + np.maximum(ax - 0.028, 0) * 0.95
    beard = sm(top + 0.006, top - 0.006, ly) * sm(0.08, 0.068, ax) * sm(-0.16, -0.135, ly) * sm(-0.04, -0.01, lz)
    upper = sm(0.03, 0.022, ax) * sm(-0.0435, -0.047, ly) * (lz > 0.095)
    bz = np.clip(beard + upper, 0, 1) * (1 - lip)
    st = look.get('stubble', 0)
    dots = (n3(p, 2400) > 0.62).astype(float) * (0.5 + 0.5 * n3(p, 700))
    shade = bz * st
    hc = np.array(look.get('hair', [0.08, 0.06, 0.05]))
    col = col * (1 - shade[:, None] * 0.28) + np.array([0.05, 0.06, 0.07]) * shade[:, None] * 0.12
    col = col * (1 - (shade * dots)[:, None] * 0.55) + hc * (shade * dots)[:, None] * 0.55
    # 눈썹: 호를 따라 바깥으로 누운 털 결
    f = look.get('browScale', 1.0)
    bx = ax / f
    t = np.clip((bx - 0.01) / 0.045, 0, 1)
    arc = 0.0215 + np.sin(t * np.pi * 0.85) * 0.006 - t * 0.004
    thick = (0.0055 - t * 0.0028) * look.get('browThick', 1.0)
    bm = sm(0.006, 0.012, bx) * sm(0.058, 0.05, bx) * sm(thick, thick * 0.4, np.abs(ly - arc)) * (lz > 0.065)
    ang = 0.9 - t * 0.9
    hu = (bx * np.cos(ang) + (ly - arc) * np.sin(ang)); hv = (-bx * np.sin(ang) + (ly - arc) * np.cos(ang))
    strand = n3(np.stack([hu * 120, hv * 1300, lz * 300], 1), 1.0)
    brow = np.clip(bm * (0.35 + 0.9 * strand) * look.get('browDark', 1.0), 0, 1)
    bc = np.array(look.get('brow', look.get('hair', [0.08, 0.06, 0.05])))
    col = col * (1 - brow[:, None] * 0.9) + bc * brow[:, None] * 0.9
    # 두피(머리카락 아래): 이마 헤어라인 위, 귀 위/뒤
    hair = look.get('scalp', 0)
    if hair > 0:
        fem = look.get('browScale', 1.0) < 1
        front = 0.07 + 0.01 * sm(0.022, 0.05, ax) * (0.2 if fem else 1)
        side = np.where((ax > 0.06) & (lz > -0.03), np.where(lz < 0.03, -0.004, 0.04), 0.03)
        wb, wf = sm(0.0, -0.05, lz), sm(0.0, 0.05, lz)
        hl = (front * wf + side * (1 - wf)) * (1 - wb) - 0.07 * wb
        ear = (ax > 0.062) & (ly < 0.035) & (ly > -0.035) & (lz > -0.035) & (lz < 0.012)
        sc = sm(hl - 0.004, hl + 0.006, ly) * (1 - ear)
        hd = (n3(p, 3000) > 0.45) * 0.6 + 0.4
        k = np.clip(sc * hair * hd, 0, 1)
        col = col * (1 - k[:, None]) + hc * k[:, None]
    # 잡티/점/주근깨
    fr_ = np.clip((n3(p, 600) - 0.78) * 6, 0, 1) * look.get('freckle', 0.3)
    col *= (1 - fr_[:, None] * np.array([0.12, 0.16, 0.16]))
    mole = np.clip((n3(p + 3.1, 260) - 0.93) * 30, 0, 1)
    col *= (1 - mole[:, None] * np.array([0.35, 0.42, 0.42]))
    # 미세 결
    col *= (1 + (n3(p, 1500) - 0.5)[:, None] * 0.05)
    return np.clip(col, 0, 1)

def skin_height(p, n, cav):
    lx, ly, lz = (p - C).T
    ax = np.abs(lx)
    pores = (n3(p, 3800) - 0.5) * 0.5 + (n3(p, 7600) - 0.5) * 0.25
    pores *= 1 + 0.8 * g2(lx, ly + 0.025, 0.03, 0.035) * (lz > 0.06)   # 코/볼은 모공 큼
    fore = np.sin(ly * 700 + n3(p, 40) * 4) * g2(lx, ly - 0.055, 0.04, 0.016) * (lz > 0.05) * 0.18
    crow = np.sin(np.arctan2(ly - 0.003, ax - 0.045) * 12) * g2(ax - 0.06, ly - 0.0, 0.008, 0.01) * 0.12
    lipl = np.sin(lx * 1800 + n3(p, 300) * 2) * sm(0.024, 0.016, ax) * sm(-0.054, -0.058, ly) * sm(-0.082, -0.076, ly) * (lz > 0.09) * 0.15
    return pores + fore + crow + lipl

def normal_from_height(h, mask, strength):
    h = np.where(mask, h, 0)
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny = -dx * strength, dy * strength   # 이미지 행은 v 반대 방향
    nz = np.ones_like(nx)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / L, ny / L, nz / L], -1)

def save(img, path, q=90):
    im = Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1])  # 행0 = v=1
    im.save(path, quality=q, optimize=True)

first = True
for key, look in LOOK.items():
    Y = Z['Y_' + key]
    P, N, K = raster(Y)
    mask = ~np.isnan(P[..., 0])
    p = P[mask]; n = N[mask]; k = K[mask]
    col = np.zeros((RES, RES, 3)); col[mask] = skin_color(p, n, k, look)
    save(dilate(col, mask), f'{OUT}/{key}_d.jpg', 88)
    if first:
        h = np.zeros((RES, RES)); h[mask] = skin_height(p, n, k)
        nm = normal_from_height(h, mask, 1.6 * RES / 1024)
        nm[~mask] = [0, 0, 1]
        save(dilate(nm * 0.5 + 0.5, mask), f'{OUT}/skin_n.jpg', 92)
        first = False
    print(key, 'texels', int(mask.sum()))
