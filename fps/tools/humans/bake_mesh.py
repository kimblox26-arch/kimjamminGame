# MakeHuman(CC0) 베이스 메시 → 게임 뼈대(SKEL)에 맞춘 인물 메시 베이크
# 사용: python3 bake_mesh.py <makehuman data dir> <out dir>
# 출력: base.bin (공유 토폴로지: 인덱스/UV/스킨), <key>.bin (인물별 정점), humans.json (메타)
import sys, json, struct
import numpy as np
from mh import MH
from variants import VARIANTS

mh = MH(sys.argv[1])
OUT = sys.argv[2]

# ── 게임 뼈대 (human.js skeletonSpec 와 동일) ──
SK = {}
def add(n, p, parent): SK[n] = (np.array(p, float), parent)
add('root', [0, 0, 0], None); add('hips', [0, 0.97, 0], 'root'); add('spine', [0, 1.08, 0], 'hips'); add('chest', [0, 1.26, 0], 'spine')
add('neck', [0, 1.465, 0.005], 'chest'); add('head', [0, 1.575, 0.01], 'neck')
A = 0.7071
for s, k in [(1, 'L'), (-1, 'R')]:
    sh = [s * 0.175, 1.415, -0.005]; el = [sh[0] + s * A * 0.295, sh[1] - A * 0.295, sh[2]]; wr = [el[0] + s * A * 0.255, el[1] - A * 0.255, el[2]]
    add('clav' + k, [s * 0.025, 1.43, 0.02], 'chest'); add('uarm' + k, sh, 'clav' + k); add('farm' + k, el, 'uarm' + k); add('hand' + k, wr, 'farm' + k)
    add('thigh' + k, [s * 0.093, 0.93, 0], 'hips'); add('shin' + k, [s * 0.1, 0.5, 0.012], 'thigh' + k)
    add('foot' + k, [s * 0.104, 0.085, -0.012], 'shin' + k); add('toe' + k, [s * 0.108, 0.02, 0.115], 'foot' + k)
SKN = list(SK.keys())
SKI = {n: i for i, n in enumerate(SKN)}
P = lambda n: SK[n][0]

# 머리 기준틀 (human.js buildHead 의 C 와 SDF 두개골)
HEAD_EYE = np.array([0, 1.670, 0.0915])

FACE = ('head', 'jaw', 'special', 'oris', 'levator', 'orbicularis', 'temporalis', 'risorius', 'eye', 'oculi', 'tongue')
def mh_to_sk(b):
    side = 'L' if b.endswith('.L') else 'R' if b.endswith('.R') else ''
    if b in ('root', 'spine05') or b.startswith('pelvis'): return [('hips', 1)]
    if b in ('spine04', 'spine03'): return [('spine', 1)]
    if b in ('spine02', 'spine01') or b.startswith('breast'): return [('chest', 1)]
    if b in ('neck01', 'neck02', 'neck03'): return [('neck', 1)]
    if b.startswith(FACE): return [('head', 1)]
    if b.startswith('clavicle'): return [('clav' + side, 1)]
    if b.startswith('shoulder01'): return [('clav' + side, 0.5), ('uarm' + side, 0.5)]
    if b.startswith('upperarm'): return [('uarm' + side, 1)]
    if b.startswith('lowerarm'): return [('farm' + side, 1)]
    if b.startswith(('wrist', 'finger', 'metacarpal')): return [('hand' + side, 1)]
    if b.startswith('upperleg'): return [('thigh' + side, 1)]
    if b.startswith('lowerleg'): return [('shin' + side, 1)]
    if b.startswith('foot'): return [('foot' + side, 1)]
    if b.startswith('toe'): return [('toe' + side, 1)]
    raise KeyError(b)

def sk_weights(nv):
    W = np.zeros((nv, len(SKN)))
    for b, lst in mh.weights.items():
        for tgt, k in mh_to_sk(b):
            j = SKI[tgt]
            for i, w in lst: W[i, j] += w * k
    s = W.sum(1, keepdims=True); s[s == 0] = 1
    return W / s

def seg_xf(a, b, A_, B_, sec=np.array([0, 0, 1.0])):
    """MH 선분 a→b 를 게임 뼈 A→B 로: 축 방향 길이 비율 스케일 + 두 축 정렬 회전"""
    d1 = (b - a); l1 = np.linalg.norm(d1); d1 /= l1
    d2 = (B_ - A_); l2 = np.linalg.norm(d2); d2 /= l2
    def frame(d):
        s2 = sec - d * (sec @ d); s2 /= np.linalg.norm(s2); return np.stack([d, s2, np.cross(d, s2)], 1)
    R = frame(d2) @ frame(d1).T
    S = np.eye(3) + (l2 / l1 - 1) * np.outer(d1, d1)
    M = R @ S
    return M, A_ - M @ a

def fit(X, W, J):
    xf = {}
    hipm = (J['hipL'] + J['hipR']) / 2; shm = (J['shL'] + J['shR']) / 2
    t_h = (P('thighL') + P('thighR')) / 2 - hipm
    t_c = (P('uarmL') + P('uarmR')) / 2 - shm
    I = np.eye(3)
    xf['root'] = xf['hips'] = (I, t_h)
    xf['spine'] = (I, (t_h + t_c) / 2)
    xf['chest'] = (I, t_c)
    # 머리: 눈 중심을 기준틀 눈 위치로, 깊이만 살짝 늘려 두개골 뒤쪽을 헤어/헬멧 껍질에 맞춤
    eyem = (J['eyeL'] + J['eyeR']) / 2
    Mh = np.diag([1.0, 1.0, 1.06])
    xf['head'] = (Mh, HEAD_EYE - Mh @ eyem)
    xf['neck'] = (I, (t_c + (HEAD_EYE - eyem)) / 2)
    for k in 'LR':
        xf['clav' + k] = seg_xf(J['clav' + k], J['sh' + k], P('clav' + k), P('uarm' + k))
        xf['uarm' + k] = seg_xf(J['sh' + k], J['el' + k], P('uarm' + k), P('farm' + k))
        xf['farm' + k] = seg_xf(J['el' + k], J['wr' + k], P('farm' + k), P('hand' + k))
        hd = P('hand' + k) + (P('hand' + k) - P('farm' + k)) / 0.255 * 0.09
        xf['hand' + k] = seg_xf(J['wr' + k], J['mid' + k], P('hand' + k), hd)
        xf['thigh' + k] = seg_xf(J['hip' + k], J['kn' + k], P('thigh' + k), P('shin' + k))
        xf['shin' + k] = seg_xf(J['kn' + k], J['an' + k], P('shin' + k), P('foot' + k))
        xf['foot' + k] = seg_xf(J['an' + k], J['toe' + k], P('foot' + k), P('toe' + k))
        xf['toe' + k] = xf['foot' + k]
    Y = np.zeros_like(X)
    for n, j in SKI.items():
        M, t = xf[n]
        w = W[:, j:j + 1]
        if w.max() > 0: Y += w * (X @ M.T + t)
    return Y, xf

def joints_of(X):
    E = mh.bone_ends(X)
    J = {}
    for k, s in (('L', '.L'), ('R', '.R')):
        J['hip' + k] = E['upperleg01' + s][0]; J['kn' + k] = E['lowerleg01' + s][0]; J['an' + k] = E['foot' + s][0]
        J['toe' + k] = (E['toe2-1' + s][0] + E['toe4-1' + s][0]) / 2
        J['sh' + k] = E['upperarm01' + s][0]; J['el' + k] = E['lowerarm01' + s][0]; J['wr' + k] = E['wrist' + s][0]
        J['mid' + k] = E['finger3-1' + s][0]; J['clav' + k] = E['clavicle' + s][0]; J['eye' + k] = E['eye' + s][0]
    return J

# ── 토폴로지 ──
V0, VT, F, FT, G = mh.obj
body_f = [i for i, g in enumerate(G) if g == 'body']
lash_f = [i for i, g in enumerate(G) if g.startswith('helper-') and 'eyelashes' in g]
NV = len(V0)
W = sk_weights(NV)
top4 = np.argsort(-W, 1)[:, :4]
w4 = np.take_along_axis(W, top4, 1); w4 /= w4.sum(1, keepdims=True)

def tris(fl):
    out = []
    for fi in fl:
        f, ft = F[fi], FT[fi]
        for k in range(1, len(f) - 1): out.append(((f[0], f[k], f[k + 1]), (ft[0], ft[k], ft[k + 1])))
    return out

def vnormals(X, T):
    N = np.zeros_like(X)
    a, b, c = X[T[:, 0]], X[T[:, 1]], X[T[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3): np.add.at(N, T[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)

def neighbors(T, n):
    nb = [set() for _ in range(n)]
    for a, b, c in T: nb[a] |= {b, c}; nb[b] |= {a, c}; nb[c] |= {a, b}
    return nb

def region_of(Y, Wv):
    """정점 영역: 0 피부(머리/목) 1 상의 2 하의 3 손(제거) 4 발(제거)"""
    hn = Wv[:, SKI['head']] + Wv[:, SKI['neck']]
    hand = Wv[:, SKI['handL']] + Wv[:, SKI['handR']]
    reg = np.full(len(Y), 1)
    # 칼라선: 앞은 낮고 뒤는 높게
    collar = 1.468 + np.clip(-Y[:, 2] / 0.08, 0, 1) * 0.03
    reg[(hn > 0.35) & (Y[:, 1] > collar)] = 0
    legs = sum(Wv[:, SKI[n + k]] for n in ('thigh', 'shin', 'foot', 'toe') for k in 'LR')
    reg[((Y[:, 1] < 0.985) & (hn < 0.1)) | (legs > 0.5)] = 2
    reg[hand > 0.5] = 3
    reg[Y[:, 1] < 0.115] = 4
    return reg

def taubin(Y, nb, mask, it=10, lam=0.5, mu=-0.53):
    Y = Y.copy()
    idx = np.where(mask)[0]
    for _ in range(it):
        for f in (lam, mu):
            D = np.zeros((len(idx), 3))
            for r, i in enumerate(idx):
                n = list(nb[i]); D[r] = Y[n].mean(0) - Y[i]
            Y[idx] += f * D
    return Y

def build_variant(key, v, base=None):
    X = mh.build(v['targets']) * 0.1
    X[:, 1] -= X[sorted({i for fi in body_f for i in F[fi]}), 1].min()
    J = joints_of(X)
    Y, xf = fit(X, W, J)
    eyes = {}
    for k in 'LR':
        M, t = xf['head']; eyes[k] = (M @ J['eye' + k] + t).tolist()
    return X, Y, eyes

def write_bin(path, parts):
    with open(path, 'wb') as fp:
        for a in parts: fp.write(a.tobytes())

# ── 기준 인물로 영역/토폴로지 확정 ──
ref = VARIANTS['jin']
_, Yref, _ = build_variant('jin', ref)
T_all = tris(body_f)
TV = np.array([t[0] for t in T_all]); TT = np.array([t[1] for t in T_all])
reg = region_of(Yref, W)
fr = np.array([np.bincount(reg[t], minlength=5).argmax() for t in TV])
keep = (fr != 3) & (fr != 4)
# 손/발 정점이 섞인 면도 제거 (장갑/부츠 안)
keep &= ~np.isin(reg[TV], [3, 4]).all(1)
TV, TT, fr = TV[keep], TT[keep], fr[keep]
fr[fr > 2] = 1

# 칼라 경계: 피부↔상의 경계 정점을 복제해 옷깃 두께 띠를 만듦
skin_v = set(TV[fr == 0].ravel()); cloth_v = set(TV[fr != 0].ravel())
border = sorted(skin_v & cloth_v)
# 정점은 (원본 MH 정점, uv) 쌍으로 펼침 (UV 이음새 분리)
def unify(TV, TT, fr):
    key2new, src, uvs = {}, [], []
    out = np.zeros_like(TV)
    for f in range(len(TV)):
        for k in range(3):
            vi, ti = TV[f, k], TT[f, k]
            dup = 1 if (fr[f] != 0 and vi in border_set) else 0
            kk = (vi, ti, dup)
            if kk not in key2new: key2new[kk] = len(src); src.append((vi, dup)); uvs.append(VT[ti])
            out[f, k] = key2new[kk]
    return out, src, np.array(uvs), key2new
border_set = set(border)
IDX, SRC, UV, K2N = unify(TV, TT, fr)
SRCV = np.array([s[0] for s in SRC]); DUP = np.array([s[1] for s in SRC])
# 옷깃 띠: 상의 쪽 경계 모서리마다 (복제 정점 → 원본 피부 정점) 사각형
band = []
eset = {}
for f in range(len(IDX)):
    if fr[f] == 0: continue
    for k in range(3):
        a, b = IDX[f, k], IDX[f, (k + 1) % 3]
        if DUP[a] and DUP[b]:
            eset[(a, b)] = True
for (a, b) in eset:
    if (b, a) in eset: continue
    # 원본(피부) 정점 찾기: 같은 MH 정점, dup=0 인 것
    sa = [i for (vi, ti, d), i in K2N.items() if vi == SRCV[a] and d == 0]
    sb = [i for (vi, ti, d), i in K2N.items() if vi == SRCV[b] and d == 0]
    if sa and sb: band.append((b, a, sa[0])); band.append((b, sa[0], sb[0]))
band = np.array(band, dtype=np.int64).reshape(-1, 3)

# 머리/목 UV 섬을 0..1 에 다시 채워 넣음 (얼굴 텍스처 해상도 극대화)
def pack_islands(UV, tris):
    par = {}
    def find(a):
        while par.setdefault(a, a) != a: par[a] = par[par[a]]; a = par[a]
        return a
    for t in tris: par[find(t[1])] = find(t[0]); par[find(t[2])] = find(t[0])
    isl = {}
    for v in np.unique(tris): isl.setdefault(find(v), []).append(v)
    isl = [np.array(v) for v in isl.values() if len(v) > 2]
    boxes = [(UV[v].min(0), UV[v].max(0), v) for v in isl]
    def place(scale, gap=0.012):
        # 가장 큰 섬(머리)을 왼쪽에, 나머지는 오른쪽 기둥에 선반식으로
        boxes_s = sorted(boxes, key=lambda b: -np.prod(b[1] - b[0]))
        lo, hi, v = boxes_s[0]
        w0, h0 = (hi - lo) * scale
        out = [(lo, v, gap, gap)]
        x0 = gap + w0 + gap; x = x0; y = gap; rowh = 0
        for lo, hi, v in sorted(boxes_s[1:], key=lambda b: -(b[1][1] - b[0][1])):
            w, h = (hi - lo) * scale
            if x + w + gap > 1: x = x0; y += rowh + gap; rowh = 0
            if x + w + gap > 1: return out, 9
            out.append((lo, v, x, y)); x += w + gap; rowh = max(rowh, h)
        return out, max(h0 + 2 * gap, y + rowh + gap) if w0 + 2 * gap <= 1 else 9
    lo_s, hi_s = 0.1, 20
    for _ in range(40):
        mid = (lo_s + hi_s) / 2
        if place(mid)[1] <= 1: lo_s = mid
        else: hi_s = mid
    out, _ = place(lo_s)
    R = np.zeros_like(UV)
    for lo, v, x, y in out: R[v] = (UV[v] - lo) * lo_s + [x, y]
    return R
UVS = pack_islands(UV, IDX[fr == 0])

# 재질별 정렬: 0 피부 1 상의(+옷깃 띠) 2 하의
groups, order = [], []
for m in (0, 1, 2):
    tri_m = IDX[fr == m]
    if m == 1 and len(band): tri_m = np.concatenate([tri_m, band])
    groups.append([len(order) * 3 if False else sum(len(o) for o in order) * 3, len(tri_m) * 3]); order.append(tri_m)
INDEX = np.concatenate(order).astype(np.uint16 if len(SRC) < 65535 else np.uint32)
groups = [[sum(len(o) for o in order[:m]) * 3, len(order[m]) * 3] for m in range(3)]

SI = top4[SRCV].astype(np.uint8)
SWf = w4[SRCV]
SW = np.round(SWf * 255).astype(np.int32); SW[:, 0] += 255 - SW.sum(1); SW = SW.astype(np.uint8)

# 정점별 의상 영역/오프셋 (인물별 위치 계산에 사용)
vreg = np.zeros(len(SRC), np.int8)
for m in (0, 1, 2): vreg[np.unique(IDX[fr == m])] = m
vreg[DUP == 1] = 1

# ── 눈썹(속눈썹) 헬퍼: 별도 작은 메시 ──
LT = tris(lash_f)
LV = sorted({i for t in LT for i in t[0]})
lmap = {v: i for i, v in enumerate(LV)}
LIDX = np.array([[lmap[i] for i in t[0]] for t in LT], dtype=np.uint16)

nb_cache = {}
def clothe(Y, src_pos_idx):
    """옷: 근육 굴곡 제거(Taubin) 후 법선 방향으로 부풀림"""
    Ys = Y[SRCV].copy()
    Tm = np.concatenate([IDX[fr != 0]])
    if 'nb' not in nb_cache: nb_cache['nb'] = neighbors(Tm, len(Ys))
    nb = nb_cache['nb']
    cmask = (vreg != 0)
    # 경계(복제) 정점은 고정
    move = cmask & (DUP == 0)
    Ys2 = taubin(Ys, nb, move, it=6)
    N = vnormals(Ys2, np.concatenate([IDX, band]) if len(band) else IDX)
    off = np.where(vreg == 2, 0.013, 0.013)
    # 소매는 여유 있게, 등/가슴은 플레이트캐리어가 덮음
    Wv = W[SRCV]
    arm = sum(Wv[:, SKI[n + k]] for n in ('uarm', 'farm') for k in 'LR')
    off = off + arm * 0.006
    # 팔꿈치 안쪽/겨드랑이/사타구니 등 오목부는 덜 부풀림 → 겹침 방지는 스무딩이 담당
    off = off * cmask
    Ys2 = Ys2 + N * off[:, None]
    # 옷깃 복제 정점: 피부 위로 살짝 띄움
    Ys2[DUP == 1] = Ys[DUP == 1] + N[DUP == 1] * 0.008
    out = np.where(cmask[:, None], Ys2, Ys)
    return out

HEADPOS = {}
meta = {'bones': SKN, 'groups': groups, 'count': len(SRC), 'lashCount': len(LV), 'variants': {}}
uvq = np.round(UVS * 65535).astype(np.uint16)
# 법선 용접 id: UV 이음새로 갈라진 정점들이 같은 법선을 갖도록
WELD = (SRCV * 2 + DUP).astype(np.uint16)
write_bin(f'{OUT}/base.bin', [INDEX, uvq, SI, SW, LIDX, WELD])
meta['layout'] = {'index': INDEX.size, 'lashIndex': LIDX.size}
for key, v in VARIANTS.items():
    X, Y, eyes = build_variant(key, v)
    Yc = clothe(Y, SRCV)
    # 속눈썹: 머리 변환 적용
    M, t = None, None
    Xl = X[LV]
    # 피팅의 머리 변환을 동일하게 (가중치 대신 머리 뼈 강체)
    J = joints_of(X)
    eyem = (J['eyeL'] + J['eyeR']) / 2
    Mh = np.diag([1.0, 1.0, 1.06]); th = HEAD_EYE - Mh @ eyem
    Yl = Xl @ Mh.T + th
    HEADPOS[key] = Yc
    q = np.round(np.concatenate([Yc, Yl]) / 2.0 * 32767).astype(np.int16)
    write_bin(f'{OUT}/{key}.bin', [q])
    # 두개골 타원체 적합 (헤어 카드/모자/헬멧을 인물 머리에 맞추기 위함)
    Cc = np.array([0, 1.667, 0.012])
    hv = np.unique(IDX[fr == 0]); Ph = Yc[hv] - Cc
    sel = (Ph[:, 1] > -0.005) & ~((Ph[:, 2] > 0.045) & (Ph[:, 1] < 0.075)) & ~((np.abs(Ph[:, 0]) > 0.062) & (Ph[:, 1] < 0.03))
    q_ = Ph[sel]
    A_ = np.stack([q_[:, 0] ** 2, q_[:, 1] ** 2, q_[:, 2] ** 2, q_[:, 1], q_[:, 2]], 1)
    co = np.linalg.lstsq(A_, np.ones(len(q_)), rcond=None)[0]
    cy, cz = -co[3] / (2 * co[1]), -co[4] / (2 * co[2])
    G_ = 1 + co[1] * cy * cy + co[2] * cz * cz
    R_ = np.sqrt(G_ / co[:3])
    top = float(Ph[:, 1].max()); back = float(Ph[Ph[:, 1] > 0.02][:, 2].min())
    meta['variants'][key] = {'eyes': eyes, 'eyeR': 0.0118, 'skull': {'c': [0, float(cy), float(cz)], 'r': R_.tolist(), 'top': top, 'back': back}}
    print(key, 'verts', len(Yc), 'ok')
json.dump(meta, open(f'{OUT}/humans.json', 'w'))
import os
os.makedirs(os.path.dirname(os.path.abspath(__file__)) + '/.cache', exist_ok=True)
np.savez(os.path.dirname(os.path.abspath(__file__)) + '/.cache/bake.npz', IDX=IDX, fr=fr, SRCV=SRCV, UVS=UVS, vreg=vreg, **{'Y_' + k: v for k, v in HEADPOS.items()})
print('groups', groups, 'index', len(INDEX), 'verts', len(SRC), 'band', len(band))
