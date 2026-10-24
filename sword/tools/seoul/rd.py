import numpy as np, pyarrow.parquet as pq, gzip, json, sys, math
from shapely import wkb
import geo
OUT = sys.argv[1]
CLS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'living_street', 'unclassified', 'service',
       'pedestrian', 'footway', 'path', 'steps', 'cycleway', 'track']
RCLS = ['subway', 'standard_gauge', 'light_rail', 'monorail', 'tram', 'unknown', 'funicular', 'narrow_gauge']
WIDTH = {'motorway': 25, 'trunk': 22, 'primary': 20, 'secondary': 15, 'tertiary': 11, 'residential': 7, 'living_street': 5.5, 'unclassified': 6,
         'service': 4.5, 'pedestrian': 7, 'footway': 2.5, 'path': 1.6, 'steps': 2.5, 'cycleway': 2.5, 'track': 3}
t = pq.read_table('segment.parquet').to_pylist()
nodes = {}
def node(key):
    if key not in nodes: nodes[key] = len(nodes)
    return nodes[key]
def frac_points(xy):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
    return d / max(d[-1], 1e-9), d[-1]
def cut(xy, f, a, b):
    # 0..1 비율 구간 [a,b] 의 부분 선
    idx = [i for i in range(len(f)) if a < f[i] < b]
    def at(u):
        i = min(max(np.searchsorted(f, u) - 1, 0), len(f) - 2)
        k = (u - f[i]) / max(f[i + 1] - f[i], 1e-12)
        return xy[i] + (xy[i + 1] - xy[i]) * k
    return np.vstack([at(a)] + [xy[i] for i in idx] + [at(b)])
roads, rails = [], []
for r in t:
    sub, cls = r['subtype'], r['class']
    if sub == 'road' and cls not in CLS: continue
    if sub == 'rail' and cls not in RCLS: continue
    if sub not in ('road', 'rail'): continue
    g = wkb.loads(r['geometry'])
    if g.geom_type != 'LineString': continue
    c = np.asarray(g.coords)
    x, z = geo.ll_to_flat(c[:, 1], c[:, 0])
    xy = np.stack([x, z], 1)
    f, L = frac_points(xy)
    if L < 0.5: continue
    # 경계: 커넥터 + 플래그/층 구간
    cuts = {0.0: None, 1.0: None}
    for cn in (r['connectors'] or []): cuts[round(cn['at'], 9)] = cn['connector_id']
    flags = r['road_flags'] if sub == 'road' else r['rail_flags']
    spans = []
    for fl in flags or []:
        a, b = fl['between'] or [0.0, 1.0]
        spans.append((a, b, set(fl['values']))); cuts.setdefault(round(a, 9), None); cuts.setdefault(round(b, 9), None)
    lv = []
    for lr in r['level_rules'] or []:
        a, b = lr['between'] or [0.0, 1.0]
        lv.append((a, b, lr['value'])); cuts.setdefault(round(a, 9), None); cuts.setdefault(round(b, 9), None)
    w = WIDTH.get(cls, 3)
    for wr in r['width_rules'] or []:
        if wr['between'] is None and wr['value']: w = float(wr['value'])
    keys = sorted(cuts)
    for i in range(len(keys) - 1):
        a, b = keys[i], keys[i + 1]
        if b - a < 1e-7: continue
        m = (a + b) / 2
        fset = set().union(*[s for (p, q, s) in spans if p <= m <= q]) if spans else set()
        level = next((v for (p, q, v) in lv if p <= m <= q), 0)
        part = cut(xy, f, a, b)
        if len(part) > 2:
            from shapely.geometry import LineString
            part = np.asarray(LineString(part).simplify(0.35, preserve_topology=False).coords)
        na = node(cuts[a] or (r['id'], a)); nb = node(cuts[b] or (r['id'], b))
        fl = (1 if 'is_bridge' in fset else 0) | (2 if 'is_tunnel' in fset else 0) | (4 if 'is_link' in fset else 0) | (8 if 'is_under_construction' in fset else 0)
        nm = (r['names'] or {}).get('primary') or '' if (sub == 'rail' or CLS.index(cls) <= 4) else ''
        rec = (part, na, nb, fl, level, w, nm)
        if sub == 'road': roads.append((CLS.index(cls),) + rec)
        else: rails.append((RCLS.index(cls),) + rec)
def pack(items, name):
    # 헤더: 개수, 각 항목 [cls u8, flags u8, level i8, width u8(×0.25 m), na u32, nb u32, npts u16, name idx u16] + 점 (dm 차분 i32)
    names = ['']; nix = {'': 0}
    head = []; pts = []
    for (ci, part, na, nb, fl, level, w, nm) in items:
        if nm not in nix: nix[nm] = len(names); names.append(nm)
        p = np.round(part * 10).astype(np.int64)
        head.append((ci, fl, max(-8, min(8, level)) & 0xff, min(255, int(round(w * 4))), na, nb, len(p), min(nix[nm], 65535)))
        pts.append(p)
    H = np.array(head, dtype=[('c', 'u1'), ('f', 'u1'), ('l', 'u1'), ('w', 'u1'), ('a', '<u4'), ('b', '<u4'), ('n', '<u2'), ('m', '<u2')])
    P = np.vstack(pts)
    D = np.diff(P, axis=0, prepend=[[0, 0]]).astype('<i4')
    blob = np.array([len(H), len(P)], '<u4').tobytes() + H.tobytes() + D.tobytes()
    open(f'{OUT}/{name}.bin.gz', 'wb').write(gzip.compress(blob, 9))
    json.dump(names, open(f'{OUT}/{name}_names.json', 'w'), ensure_ascii=False)
    print(name, len(H), 'pieces', len(P), 'points', len(blob), 'bytes', len(names), 'names')
pack(roads, 'roads'); pack(rails, 'rails')
# 점 시설: 가로등, 신호등, 횡단보도, 버스정류장, 벤치, 송전탑, 지하철역/기차역 (이름), 가로수
KIND = {('transportation', 'street_lamp'): 0, ('transportation', 'traffic_signals'): 1, ('transportation', 'crossing'): 2, ('transit', 'bus_stop'): 3,
        ('pedestrian', 'bench'): 4, ('power', 'power_tower'): 5, ('transit', 'subway_station'): 6, ('transit', 'railway_station'): 7}
pts, names = [], ['']
for r in pq.read_table('infrastructure.parquet').to_pylist():
    k = KIND.get((r['subtype'], r['class']))
    if k is None: continue
    g = wkb.loads(r['geometry'])
    if g.geom_type != 'Point': g = g.centroid
    x, z = geo.ll_to_flat(g.y, g.x)
    if abs(x) > 26000 or abs(z) > 22000: continue
    ni = 0
    if k in (6, 7):
        nm = (r['names'] or {}).get('primary') or ''
        ni = len(names); names.append(nm)
    pts.append((k, x, z, ni))
for r in pq.read_table('land.parquet').to_pylist():
    if r['subtype'] != 'tree': continue
    g = wkb.loads(r['geometry'])
    if g.geom_type == 'Point':
        x, z = geo.ll_to_flat(g.y, g.x); pts.append((8, x, z, 0))
    elif g.geom_type == 'LineString':   # 가로수 줄: 8 m 간격
        c = np.asarray(g.coords); x, z = geo.ll_to_flat(c[:, 1], c[:, 0]); xy = np.stack([x, z], 1)
        f, L = frac_points(xy)
        for u in np.arange(0, L, 8.0) / max(L, 1e-9): p = cut(xy, f, u, u)[0]; pts.append((8, p[0], p[1], 0))
A = np.array([(k, int(round(x * 10)), int(round(z * 10)), n) for (k, x, z, n) in pts], dtype=[('k', 'u1'), ('x', '<i4'), ('z', '<i4'), ('n', '<u2')])
open(f'{OUT}/points.bin.gz', 'wb').write(gzip.compress(np.array([len(A)], '<u4').tobytes() + A.tobytes(), 9))
json.dump(names, open(f'{OUT}/points_names.json', 'w'), ensure_ascii=False)
print('points', len(A), np.bincount(A['k']))
