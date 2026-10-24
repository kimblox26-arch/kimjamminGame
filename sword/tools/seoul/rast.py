import numpy as np, pyarrow.parquet as pq, shapely, gzip, json, sys
from shapely import wkb
from PIL import Image, ImageDraw
from scipy import ndimage
import geo
# 분류: 0 자연 풀밭, 1 도시(포장), 2 숲, 3 공원·잔디, 4 농경지, 5 바위·나지, 6 물, 7 도로, 8 습지, 9 모래
LC = {'forest': 2, 'shrub': 2, 'crop': 4, 'barren': 5, 'urban': 1, 'wetland': 8, 'grass': 3, 'mangrove': 8, 'moss': 3, 'snow': 0}
LAND = {'forest': 2, 'shrub': 2, 'rock': 5, 'sand': 9, 'grass': 3, 'wetland': 8}
URB = {'residential', 'developed', 'education', 'medical', 'religious', 'military', 'transportation', 'construction', 'pedestrian', 'landfill', 'entertainment', 'civic', 'public'}
PARK = {'park', 'recreation', 'managed', 'golf', 'cemetery', 'campground', 'winter_sports'}
FARM = {'agriculture'}
ROADW = {'motorway': 24, 'trunk': 20, 'primary': 18, 'secondary': 14, 'tertiary': 10, 'residential': 6, 'living_street': 5, 'unclassified': 6, 'service': 4, 'pedestrian': 8}
WATERW = {'river': 40, 'stream': 4, 'canal': 10, 'ditch': 3, 'drain': 3}

def load(name):
    t = pq.read_table(name + '.parquet')
    return t.to_pylist()

def to_px(coords, N, step):
    lat, lon = coords[:, 1], coords[:, 0]
    x, z = geo.ll_to_flat(lat, lon)
    return np.stack([x / step + N / 2, z / step + N / 2], 1)

def polys(g):
    if g.geom_type == 'Polygon': return [g]
    if g.geom_type == 'MultiPolygon': return list(g.geoms)
    return []
def lines(g):
    if g.geom_type == 'LineString': return [g]
    if g.geom_type == 'MultiLineString': return list(g.geoms)
    return []

def draw_poly(dr, g, N, step, val):
    for p in polys(g):
        ext = to_px(np.asarray(p.exterior.coords), N, step)
        dr.polygon([tuple(v) for v in ext], fill=val)
        for h in p.interiors:
            pass   # 구멍은 무시 (작음)

def build(N, step, dem):
    C = Image.new('L', (N, N), 0)
    dr = ImageDraw.Draw(C)
    def feats(name, fn):
        out = []
        for r in load(name):
            g = wkb.loads(r['geometry'])
            v = fn(r)
            if v is None: continue
            out.append((g.area, g, v))
        out.sort(key=lambda a: -a[0])
        return out
    for _, g, v in feats('land_cover', lambda r: LC.get(r['subtype'])): draw_poly(dr, g, N, step, v)
    cur = np.asarray(C)
    for _, g, v in feats('land', lambda r: LAND.get(r['subtype'])): draw_poly(dr, g, N, step, v)
    # 토지 이용: 숲·바위 위는 덮지 않음
    lu = Image.new('L', (N, N), 0); dl = ImageDraw.Draw(lu)
    def luv(r):
        s = r['subtype']
        if s in FARM or r['class'] in ('allotments', 'orchard', 'farmland', 'meadow'): return 4
        if s in PARK or r['class'] in ('garden', 'flowerbed', 'village_green', 'grass'): return 3
        if s in URB: return 1
        return None
    for _, g, v in feats('land_use', luv): draw_poly(dl, g, N, step, v)
    c = np.asarray(C).copy(); l = np.asarray(lu)
    m = (l > 0) & (c != 2) & (c != 5)
    c[m] = l[m]
    # 도로 (나무가 서지 않게)
    C = Image.fromarray(c); dr = ImageDraw.Draw(C)
    for r in load('segment'):
        if r['subtype'] != 'road' or r['class'] not in ROADW: continue
        w = max(1, int(round(ROADW[r['class']] / step)))
        for ln in lines(wkb.loads(r['geometry'])):
            pts = to_px(np.asarray(ln.coords), N, step)
            dr.line([tuple(v) for v in pts], fill=7, width=w)
    # 물
    W = Image.new('L', (N, N), 0); dw = ImageDraw.Draw(W)
    for r in load('water'):
        g = wkb.loads(r['geometry'])
        if r['class'] in ('swimming_pool', 'fountain') or r['subtype'] in ('human_made',): continue
        if g.geom_type in ('Polygon', 'MultiPolygon'): draw_poly(dw, g, N, step, 1)
        else:
            w = WATERW.get(r['subtype'], WATERW.get(r['class'], 0))
            if not w: continue
            for ln in lines(g):
                pts = to_px(np.asarray(ln.coords), N, step)
                dw.line([tuple(v) for v in pts], fill=1, width=max(1, int(round(w / step))))
    c = np.asarray(C).copy(); wm = np.asarray(W) > 0
    # SRTM 은 지표면 모델(건물·나무 포함) → 도시에서는 건물 높이만큼 볼록 → 열림 연산(최솟값→최댓값)으로 걷어냄
    urb = ndimage.gaussian_filter(((c == 1) | (c == 7)).astype(float), 3)
    k = max(3, int(round(150 / step)) | 1)
    op = ndimage.grey_opening(dem, size=(k, k))
    op = ndimage.gaussian_filter(op, max(1.0, 40 / step))
    dem = dem * (1 - urb) + np.minimum(dem, op) * urb
    # 바다: 바깥 격자에서 해발 0 아래 + 물 표시 없는 넓은 곳
    sea = (dem < -0.5)
    sea = ndimage.binary_opening(sea, iterations=2)
    wm = wm | sea
    c[wm] = 6
    # 수위: 물 칸의 지역 최솟값을 매끈하게 (강은 거의 평평), 바다는 0
    big = np.where(wm, dem, 1e4)
    lv = ndimage.minimum_filter(big, size=7)
    lv = np.where(wm, lv, np.nan)
    # 물 칸 안에서만 가우시안 평활
    num = ndimage.gaussian_filter(np.nan_to_num(lv), 6); den = ndimage.gaussian_filter(wm.astype(float), 6)
    lv = np.where(wm, num / np.maximum(den, 1e-6), np.nan)
    lv[sea] = 0.0
    lv = np.where(wm, np.maximum(lv, -0.5), np.nan)
    # 좁은 물길 (청계천 같은 하천·수로): 길보다 낮게 흐르도록 수면을 2.5 m 내림
    dcell = ndimage.distance_transform_edt(wm)
    narrow = wm & (ndimage.grey_dilation(dcell, size=(7, 7)) <= 2.5) & ~sea
    lv = np.where(narrow, lv - 2.5, lv)
    # 강바닥: 기슭에서 멀수록 깊게 (최대 8 m)
    dist = dcell * step
    bed = lv - np.clip(dist * 0.12, 0.6, 8.0)
    h = dem.copy()
    h[wm] = np.minimum(dem[wm], bed[wm])
    # 물가 땅이 수면보다 낮으면 살짝 올림 (물 없는 구덩이 방지)
    near = ndimage.binary_dilation(wm, iterations=2) & ~wm
    lvn = ndimage.grey_dilation(np.nan_to_num(np.where(wm, lv, -1e4), nan=-1e4), size=5)
    h[near] = np.maximum(h[near], lvn[near] + 0.4)
    return h, lv, c

def peaks_fix(dem, N, step):
    # 이름 있는 산 정상의 실제 높이로 국지 보정 (반경 ~4 칸 가우시안)
    rows = [r for r in load('land') if r['class'] == 'peak' and r['elevation']]
    out = []
    for r in rows:
        g = wkb.loads(r['geometry'])
        x, z = geo.ll_to_flat(g.y, g.x)
        i, j = x / step + N / 2 - 0.5, z / step + N / 2 - 0.5
        if not (4 <= i < N - 4 and 4 <= j < N - 4): continue
        ii, jj = int(round(i)), int(round(j))
        loc = dem[jj - 3:jj + 4, ii - 3:ii + 4]
        cur = loc.max()
        d = r['elevation'] - cur
        if abs(d) > 120: continue
        yy, xx = np.mgrid[-6:7, -6:7]
        k = np.exp(-(xx ** 2 + yy ** 2) / (2 * 2.2 ** 2))
        dem[jj - 6:jj + 7, ii - 6:ii + 7] += d * k
        nm = (r['names'] or {}).get('primary')
        if nm: out.append([nm, round(float(x), 1), round(float(z), 1), r['elevation']])
    return out

def enc16(a):
    a = np.round(a).astype(np.int32)
    d = np.diff(a, axis=1, prepend=0).astype(np.int16)   # 행 차분
    return gzip.compress(d.tobytes(), 9)

if __name__ == '__main__':
    out = sys.argv[1]
    meta = {}
    for name, N, step in [('core', 2560, 15.0), ('outer', 1024, 100.0)]:
        dem = np.load(f'dem_{name}.npy').astype(np.float64)
        dem = np.maximum(dem, -60)
        pk = peaks_fix(dem, N, step)
        h, lv, c = build(N, step, dem)
        h = np.clip(h, -3000, 3000)
        open(f'{out}/{name}_h.bin.gz', 'wb').write(enc16(h * 10))
        # 분류(하위 4비트) + 수심(상위 12비트, 0.05 m 단위): 수위 = 바닥 + 수심
        hq = np.round(h * 10) / 10
        dep = np.where(np.isnan(lv), 0, np.clip(np.round((lv - hq) * 20), 1, 4095)).astype(np.uint16)
        cw = (c.astype(np.uint16) & 15) | (dep << 4)
        open(f'{out}/{name}_cw.bin.gz', 'wb').write(gzip.compress(cw.astype('<u2').tobytes(), 9))
        meta[name] = {'n': N, 'step': step}
        if name == 'core': meta['peaks'] = pk
        print(name, 'class hist', np.bincount(c.ravel(), minlength=10), 'water lv range', np.nanmin(lv), np.nanmax(lv))
        Image.fromarray((np.array([[90,140,60],[150,150,150],[20,70,20],[120,200,90],[200,180,90],[130,120,110],[40,80,200],[60,60,60],[90,130,120],[220,210,150]], np.uint8))[c]).save(f'cls_{name}.png')
    json.dump(meta, open(f'{out}/meta.json', 'w'), ensure_ascii=False)
