import numpy as np, pyarrow.parquet as pq, shapely, gzip, json, sys, math, hashlib
from shapely import wkb, affinity
from shapely.geometry import Polygon, box as sbox
import geo
OUT = sys.argv[1]
t = pq.read_table('building.parquet').to_pylist()
parts = {}
for p in pq.read_table('building_part.parquet').to_pylist():
    if p['is_underground']: continue
    parts.setdefault(p['building_id'], []).append(p)
ext = []
for r in t:
    if r['has_parts'] and r['id'] in parts:
        ph = r['height'] or ((r['num_floors'] or 0) * 3.3 + 1 if r['num_floors'] else None)
        for p in parts[r['id']]:
            h = p['height'] or ((p['num_floors'] or 0) * 3.4 + 1 if p['num_floors'] else ph)
            ext.append(dict(id=p['id'], is_underground=False, geometry=p['geometry'], class_=p.get('class') or r['class'], subtype=r['subtype'], height=h,
                            num_floors=p['num_floors'], min_height=p['min_height'] or ((p['min_floor'] or 0) * 3.4 if p['min_floor'] else 0)))
        r['skip'] = True
for e in ext: e['class'] = e.pop('class_')
t = [r for r in t if not r.get('skip')] + ext
print('with parts', len(t))
LOW1 = {'house', 'detached', 'garage', 'garages', 'shed', 'roof', 'greenhouse', 'hut', 'kiosk', 'carport', 'cabin', 'outbuilding', 'barn', 'farm_auxiliary', 'toilets', 'service', 'bunker'}
def hsh(s, k=0):
    return (int(hashlib.md5((s + str(k)).encode()).hexdigest()[:8], 16) % 100000) / 100000.0
def obb(p):
    r = p.minimum_rotated_rectangle
    if r.geom_type != 'Polygon': return None
    c = np.asarray(r.exterior.coords)[:4]
    e1, e2 = c[1] - c[0], c[2] - c[1]
    l1, l2 = np.hypot(*e1), np.hypot(*e2)
    if l1 < 0.5 or l2 < 0.5: return None
    ang = math.atan2(e1[1], e1[0])
    cen = c.mean(0)
    return cen[0], cen[1], l1, l2, ang, r.area
def split(p, depth=0):
    # 채움 비율이 낮으면 (ㄱ·ㄷ자) 긴 축으로 반 갈라 다시 맞춤
    o = obb(p)
    if o is None: return []
    if depth >= 2 or p.area / max(o[5], 1e-6) > 0.72 or p.area < 150: return [o]
    cx, cz, l1, l2, ang, _ = o
    ax = np.array([math.cos(ang), math.sin(ang)]) if l1 >= l2 else np.array([-math.sin(ang), math.cos(ang)])
    L = max(l1, l2)
    out = []
    for s in (-1, 1):
        # 반쪽 영역
        cxh, czh = cx + ax[0] * s * L / 4, cz + ax[1] * s * L / 4
        half = affinity.rotate(sbox(-L / 4, -L, L / 4, L), math.degrees(math.atan2(ax[1], ax[0])), origin=(0, 0))
        half = affinity.translate(half, cxh, czh)
        q = p.intersection(half)
        for g in (q.geoms if hasattr(q, 'geoms') else [q]):
            if g.geom_type == 'Polygon' and g.area > 8: out += split(g, depth + 1)
    return out or [o]
recs = []
skip = 0
for r in t:
    if r['is_underground']: continue
    g = wkb.loads(r['geometry'])
    ps = list(g.geoms) if g.geom_type == 'MultiPolygon' else [g] if g.geom_type == 'Polygon' else []
    for p in ps:
        c = np.asarray(p.exterior.coords)
        x, z = geo.ll_to_flat(c[:, 1], c[:, 0])
        P = Polygon(np.stack([x, z], 1)).buffer(0)
        if P.is_empty or P.area < 6: continue
        if P.geom_type != 'Polygon': P = max(P.geoms, key=lambda a: a.area)
        cls, sub, area = r['class'], r['subtype'], P.area
        ob = obb(P)
        if ob is None: continue
        aspect = max(ob[2], ob[3]) / max(1, min(ob[2], ob[3])); width = min(ob[2], ob[3])
        hv = hsh(r['id'])
        H = r['height']
        if not H and r['num_floors']:
            H = r['num_floors'] * (3.9 if sub == 'commercial' or cls in ('office', 'commercial', 'retail') else 3.0) + 1.0
        kind = 2
        if not H:
            if cls in LOW1: H = 3.5 + 3.2 * (hv > 0.6)
            elif cls == 'apartments' or (area > 450 and aspect > 2.1 and 9 < width < 22 and cls in (None, 'residential')):
                H = (12 + int(hv * 14)) * 2.8 + 1.5; kind = 0
            elif cls in ('commercial', 'office', 'retail') or sub == 'commercial':
                H = (3 + int(hv * (4 if area < 400 else 9))) * 3.9 + 1
            elif cls in ('school', 'university', 'college', 'kindergarten') or sub == 'education': H = (3 + int(hv * 3)) * 3.8
            elif cls in ('industrial', 'warehouse') or sub == 'industrial': H = 6 + hv * 8
            elif cls in ('church', 'temple', 'religious') or sub == 'religious': H = 8 + hv * 10
            else:
                if area < 90: fl = 1 + int(hv * 2.4)
                elif area < 260: fl = 3 + int(hv * 2.6)
                elif area < 900: fl = 4 + int(hv * 3)
                else: fl = 3 + int(hv * 5)
                H = fl * 3.0 + 0.8
        H = float(min(max(H, 3.0), 600.0))
        if kind == 2:
            if cls == 'apartments' or (sub == 'residential' and H > 28): kind = 0
            elif (cls in ('commercial', 'office', 'retail') or sub in ('commercial',)) and H > 22: kind = 1
            elif H > 45: kind = 1
        for (cx, cz, l1, l2, ang, _) in split(P):
            recs.append((cx, cz, l1, l2, ang % math.pi, H, kind, int(hv * 255), min(r.get('min_height') or 0, H - 2)))
R = np.array(recs, dtype=np.float64)
print('boxes', len(R), 'kinds', np.bincount(R[:, 6].astype(int)))
# 타일(500 m) 순서로 정렬 → 지역성 + 압축
T = 500.0
key = np.floor(R[:, 1] / T) * 100000 + np.floor(R[:, 0] / T)
R = R[np.argsort(key, kind='stable')]
x = np.round(R[:, 0] * 10).astype(np.int32); z = np.round(R[:, 1] * 10).astype(np.int32)
cols = [np.diff(x, prepend=0).astype(np.int32), np.diff(z, prepend=0).astype(np.int32),
        np.clip(np.round(R[:, 2] * 10), 1, 65535).astype(np.uint16), np.clip(np.round(R[:, 3] * 10), 1, 65535).astype(np.uint16),
        np.clip(np.round(R[:, 5] * 10), 1, 65535).astype(np.uint16), np.round(R[:, 4] / math.pi * 65535).astype(np.uint16),
        R[:, 6].astype(np.uint8), R[:, 7].astype(np.uint8), np.clip(np.round(R[:, 8] * 10), 0, 65535).astype(np.uint16)]
blob = b''.join(c.tobytes() for c in cols)
open(f'{OUT}/buildings.bin.gz', 'wb').write(gzip.compress(blob, 9))
json.dump({'n': int(len(R))}, open(f'{OUT}/buildings.json', 'w'))
print('bytes', len(blob), 'gz', len(gzip.compress(blob, 9)))
