# 도로 여유 폭: 도로 중심선에서 양옆으로 건물(또는 나란한 반대편 차로)까지 남은 거리
#  - 6 m 간격 표본마다 왼쪽/오른쪽 여유 (0.25 m 단위, 255 = 45 m 넘게 비어 있음)
#  - 상하행이 따로 그려진 간선(나란한 같은 등급 도로가 옆에 있음)은 폭을 절반쯤으로 줄임
#  - 차도 바로 옆을 나란히 지나는 보도(footway)는 자동으로 그리는 보도와 겹치므로 여유 0 (그리지 않음)
#  roads.bin.gz 뒤에 덧붙임: 'CLR1', 조각별 표본 수 u16[n], 표본 (왼, 오른) u8 쌍
#  사용: python3 clr.py <assets/seoul> <rd.py 가 만든 원본 roads.bin.gz>
import numpy as np, gzip, struct, sys, math
from PIL import Image, ImageDraw

OUT = sys.argv[1]
SRC = sys.argv[2] if len(sys.argv) > 2 else f'{OUT}/roads.bin.gz'
STEP = 6.0           # 표본 간격 (m)
RES = 0.5            # 래스터 칸 (m)
MAXD = 45.0          # 찾는 최대 거리 (m)
TILE = 2000.0

b = gzip.decompress(open(SRC, 'rb').read())
n, npt = struct.unpack_from('<II', b, 0)
RD = np.dtype([('cls', 'u1'), ('fl', 'u1'), ('lv', 'i1'), ('w', 'u1'), ('na', '<u4'), ('nb', '<u4'), ('np', '<u2'), ('nm', '<u2')])
rec = np.frombuffer(b, dtype=RD, count=n, offset=8).copy()
po = 8 + 16 * n
d = np.frombuffer(b, dtype='<i4', count=npt * 2, offset=po).reshape(-1, 2).astype(np.int64)
P = np.cumsum(d, 0) * 0.1
st = np.r_[0, np.cumsum(rec['np'].astype(np.int64))]
print('roads', n, 'points', npt)

# 건물 박스
bb = gzip.decompress(open(f'{OUT}/buildings.bin.gz', 'rb').read())
nb = __import__('json').load(open(f'{OUT}/buildings.json'))['n']
o = 0
def take(dt, sz):
    global o
    a = np.frombuffer(bb, dtype=dt, count=nb, offset=o); o += nb * sz; return a
bx = np.cumsum(take('<i4', 4).astype(np.int64)) * 0.1
bz = np.cumsum(take('<i4', 4).astype(np.int64)) * 0.1
bw = take('<u2', 2) * 0.1; bd = take('<u2', 2) * 0.1; bh = take('<u2', 2) * 0.1; byaw = take('<u2', 2) / 65535 * math.pi
take('u1', 1); take('u1', 1)
bmin = np.frombuffer(bb[o:o + nb * 2], dtype='<u2') * 0.1
print('buildings', nb)
# 땅에서 떠 있는 부분(통로·차양)은 길을 막지 않음
keep = bmin < 3.5
c, s = np.cos(byaw), np.sin(byaw)
corners = []
for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
    corners.append(np.stack([bx + c * bw / 2 * sx - s * bd / 2 * sz, bz + s * bw / 2 * sx + c * bd / 2 * sz], 1))
corners = np.stack(corners, 1)[keep]          # (m, 4, 2)
bcen = np.stack([bx, bz], 1)[keep]
brad = np.hypot(bw, bd)[keep] / 2

# 표본: 조각마다 0, 6, 12, … , 길이
samp_piece, samp_x, samp_z, samp_tx, samp_tz = [], [], [], [], []
counts = np.zeros(n, np.uint16)
for i in range(n):
    p = P[st[i]:st[i + 1]]
    seg = np.hypot(*np.diff(p, axis=0).T)
    cum = np.r_[0, np.cumsum(seg)]
    L = cum[-1]
    m = int(math.ceil(L / STEP)) + 1
    s_ = np.minimum(np.arange(m) * STEP, L)
    k = np.clip(np.searchsorted(cum, s_, side='right') - 1, 0, len(seg) - 1)
    u = (s_ - cum[k]) / np.maximum(seg[k], 1e-9)
    x = p[k, 0] + (p[k + 1, 0] - p[k, 0]) * u
    z = p[k, 1] + (p[k + 1, 1] - p[k, 1]) * u
    tx = (p[k + 1, 0] - p[k, 0]) / np.maximum(seg[k], 1e-9); tz = (p[k + 1, 1] - p[k, 1]) / np.maximum(seg[k], 1e-9)
    counts[i] = m
    samp_piece.append(np.full(m, i, np.int32)); samp_x.append(x); samp_z.append(z); samp_tx.append(tx); samp_tz.append(tz)
SP = np.concatenate(samp_piece); SX = np.concatenate(samp_x); SZ = np.concatenate(samp_z); STX = np.concatenate(samp_tx); STZ = np.concatenate(samp_tz)
NS = len(SP)
print('samples', NS)
AV = np.full((NS, 2), 255, np.uint8)       # 왼쪽(법선 +), 오른쪽
PART = np.zeros((NS, 2), bool)
DUPSW = np.zeros(NS, bool)
cls = rec['cls']
SCLS = cls[SP]
ang_piece = np.zeros(n)                     # 조각 대표 방향 (점 단위로 따로 씀)

x0g, x1g = SX.min() - 1, SX.max() + 1
z0g, z1g = SZ.min() - 1, SZ.max() + 1
NTX = int(math.ceil((x1g - x0g) / TILE)); NTZ = int(math.ceil((z1g - z0g) / TILE))
# 도로 선분 (래스터용): 시작 인덱스
segA = np.concatenate([np.arange(st[i], st[i + 1] - 1) for i in range(n)])
segPiece = np.repeat(np.arange(n), np.maximum(rec['np'].astype(np.int64) - 1, 0))
SA = P[segA]; SB = P[segA + 1]
segAng = np.mod(np.arctan2(SB[:, 1] - SA[:, 1], SB[:, 0] - SA[:, 0]), math.pi)
segMinX = np.minimum(SA[:, 0], SB[:, 0]); segMaxX = np.maximum(SA[:, 0], SB[:, 0])
segMinZ = np.minimum(SA[:, 1], SB[:, 1]); segMaxZ = np.maximum(SA[:, 1], SB[:, 1])
sampAng = np.mod(np.arctan2(STZ, STX), math.pi)

done_t = 0
for tj in range(NTZ):
    for ti in range(NTX):
        tx0 = x0g + ti * TILE; tz0 = z0g + tj * TILE
        sel = np.where((SX >= tx0) & (SX < tx0 + TILE) & (SZ >= tz0) & (SZ < tz0 + TILE))[0]
        if not len(sel): continue
        ox, oz = tx0 - MAXD - 2, tz0 - MAXD - 2
        W = int((TILE + 2 * MAXD + 4) / RES)
        # 건물 래스터
        bsel = np.where((bcen[:, 0] + brad > ox) & (bcen[:, 0] - brad < ox + W * RES) & (bcen[:, 1] + brad > oz) & (bcen[:, 1] - brad < oz + W * RES))[0]
        im = Image.new('1', (W, W), 0); dr = ImageDraw.Draw(im)
        for q in bsel:
            pc = (corners[q] - [ox, oz]) / RES
            dr.polygon([tuple(v) for v in pc], fill=1)
        bld = np.asarray(im, dtype=bool)
        # 차도 래스터 (간선~2차로: 나란한 반대편 차로 찾기) + 방향
        ssel = np.where((segMaxX > ox) & (segMinX < ox + W * RES) & (segMaxZ > oz) & (segMinZ < oz + W * RES) & (cls[segPiece] <= 7))[0]
        imr = Image.new('I', (W, W), 0); dri = ImageDraw.Draw(imr)
        ima = Image.new('L', (W, W), 0); dra = ImageDraw.Draw(ima)
        for q in ssel:
            a = tuple((SA[q] - [ox, oz]) / RES); e = tuple((SB[q] - [ox, oz]) / RES)
            dri.line([a, e], fill=int(segPiece[q]) + 1, width=3)
            dra.line([a, e], fill=int(segAng[q] / math.pi * 250) + 1, width=3)
        rid = np.asarray(imr, dtype=np.int64); rang = np.asarray(ima, dtype=np.int32)
        px, pz = SX[sel], SZ[sel]
        nx, nz = -STZ[sel], STX[sel]          # 왼쪽 법선
        own = SP[sel] + 1
        mya = sampAng[sel]
        scl = SCLS[sel]
        for si, sgn in ((0, 1), (1, -1)):
            av = np.full(len(sel), 255.0); fin = np.zeros(len(sel), bool); part = np.zeros(len(sel), bool)
            for k in range(1, int(MAXD / RES) + 1):
                dd = k * RES
                ix = ((px + nx * sgn * dd - ox) / RES).astype(np.int64); iz = ((pz + nz * sgn * dd - oz) / RES).astype(np.int64)
                ok = (ix >= 0) & (ix < W) & (iz >= 0) & (iz < W) & ~fin
                if not ok.any(): break
                ixs, izs = np.where(ok, ix, 0), np.where(ok, iz, 0)
                hb = ok & bld[izs, ixs]
                av[hb] = dd - 0.3; fin |= hb
                r = rid[izs, ixs]
                ra = (rang[izs, ixs] - 1) / 250 * math.pi
                dang = np.abs(np.mod(ra - mya + math.pi / 2, math.pi) - math.pi / 2)
                par = ok & ~fin & (r > 0) & (r != own) & (dang < math.radians(22)) & (dd > 2.5) & (scl <= 7)
                av[par] = dd / 2; part |= par; fin |= par
                # 보도: 차도(생활도로 이상) 옆 12 m 안을 나란히 → 겹치는 보도
                sw = ok & (scl == 10) & (r > 0) & (r != own) & (dang < math.radians(20)) & (dd < 12)
                DUPSW[sel[sw]] = True
            AV[sel, si] = np.clip(np.round(np.minimum(av, 63.5) * 4), 0, 254).astype(np.uint8)
            AV[sel[av >= 254], si] = 255
            PART[sel, si] = part
        done_t += 1
        if done_t % 25 == 0: print('tile', done_t, '/', NTX * NTZ, flush=True)

# 상하행 분리 간선: 표본 절반 넘게 한쪽에 나란한 차로 → 폭 줄임
wnew = rec['w'].astype(np.float64) * 0.25
nchg = 0
cum = np.r_[0, np.cumsum(counts.astype(np.int64))]
for i in np.where(cls <= 3)[0]:
    pl = PART[cum[i]:cum[i + 1], 0].mean(); pr = PART[cum[i]:cum[i + 1], 1].mean()
    if max(pl, pr) > 0.5:
        w = wnew[i]
        wnew[i] = max(7.0, min(w, w * 0.55 + 1.0)); nchg += 1
print('divided halves', nchg)
rec['w'] = np.clip(np.round(wnew * 4), 1, 255).astype(np.uint8)
# 나란한 차도 옆 보도: 표본의 70% 넘게 겹치면 그 조각은 그리지 않음 (여유 0)
nsw = 0
for i in np.where(cls == 10)[0]:
    if DUPSW[cum[i]:cum[i + 1]].mean() > 0.7:
        AV[cum[i]:cum[i + 1]] = 0; nsw += 1
print('duplicate sidewalks', nsw)

head = struct.pack('<II', n, npt) + rec.tobytes()
blob = head + b[po:po + npt * 8] + b'CLR1' + counts.tobytes() + AV.tobytes()
open(f'{OUT}/roads.bin.gz', 'wb').write(gzip.compress(blob, 9))
print('written', len(blob), 'samples', NS, 'clamped L', (AV[:, 0] < 255).mean(), 'R', (AV[:, 1] < 255).mean())
