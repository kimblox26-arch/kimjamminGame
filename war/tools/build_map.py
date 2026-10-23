"""Natural Earth 10m 국가 경계(GeoJSON)를 픽셀 격자로 래스터화한다.

사용법: python3 tools/build_map.py ne_10m_admin_0_countries.geojson
출력:   data/map.bin.gz (Uint16 LE 소유자 격자, 65535 = 바다), data/countries.json
"""
import colorsys
import gzip
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw

W = 2400
LAT_MAX, LAT_MIN = 84.0, -78.0
SEA = 65535
NEUTRAL = 0
# '무주지'(중립 땅)로 둘 지역: 남극과 분쟁/미확정 소지역
KEEP_INDETERMINATE = {'EH', 'PS'}


def miller(lat):
    return 1.25 * np.log(np.tan(np.pi / 4 + 0.4 * np.radians(lat)))


Y0, Y1 = float(miller(LAT_MAX)), float(miller(LAT_MIN))
H = round(W * (Y0 - Y1) / (2 * math.pi))


def project(coords):
    a = np.asarray(coords, dtype=np.float64)
    lat = np.clip(a[:, 1], LAT_MIN, LAT_MAX)
    x = (a[:, 0] + 180.0) / 360.0 * W
    y = (Y0 - miller(lat)) / (Y0 - Y1) * H
    return x, y


def ring_area(x, y):
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def polygons(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    return geom['coordinates']


def main(path):
    feats = json.load(open(path, encoding='utf-8'))['features']
    countries = [{'id': 0, 'name': '무주지', 'en': 'No man\'s land', 'iso': '', 'pop': 0, 'gdp': 0,
                  'cont': '', 'lx': 0, 'ly': 0}]
    jobs = []  # (area, owner, polygons)
    for f in feats:
        p = f['properties']
        iso = p['ISO_A2_EH'] if p['ISO_A2_EH'] not in ('-99', None) else p['ISO_A2']
        neutral = p['TYPE'] == 'Indeterminate' and iso not in KEEP_INDETERMINATE
        polys = []
        area = 0.0
        for poly in polygons(f['geometry']):
            rings = [project(r) for r in poly]
            area += ring_area(*rings[0])
            polys.append(rings)
        if neutral:
            owner = NEUTRAL
        else:
            owner = len(countries)
            lx, ly = project([[p['LABEL_X'], p['LABEL_Y']]])
            countries.append({
                'id': owner, 'name': p['NAME_KO'] or p['NAME'], 'en': p['NAME'],
                'iso': iso if iso and iso != '-99' else '', 'pop': int(p['POP_EST'] or 0),
                'gdp': int(p['GDP_MD'] or 0), 'cont': p['CONTINENT'],
                'lx': float(lx[0]), 'ly': float(ly[0]),
            })
        jobs.append((area, owner, polys))

    img = Image.new('I', (W, H), SEA)
    draw = ImageDraw.Draw(img)
    # 큰 나라부터 그려야 작은 나라(바티칸, 레소토 등 고립 영토)가 위에 남는다
    for _, owner, polys in sorted(jobs, key=lambda j: -j[0]):
        for rings in polys:
            for k, (x, y) in enumerate(rings):
                pts = list(zip(x.tolist(), y.tolist()))
                if len(pts) >= 3:
                    draw.polygon(pts, fill=owner if k == 0 else SEA)
    grid = np.array(img, dtype=np.int64).astype(np.uint16)

    # 어떤 섬도 빠지지 않도록: 래스터에서 사라진 작은 섬은 중심 픽셀 1칸으로 살린다
    rescued = 0
    for _, owner, polys in jobs:
        for rings in polys:
            x, y = rings[0]
            cx, cy = int(np.clip(x.mean(), 0, W - 1)), int(np.clip(y.mean(), 0, H - 1))
            x0, x1 = int(max(x.min() - 1, 0)), int(min(x.max() + 2, W))
            y0, y1 = int(max(y.min() - 1, 0)), int(min(y.max() + 2, H))
            if not (grid[y0:y1, x0:x1] == owner).any() and grid[cy, cx] == SEA:
                grid[cy, cx] = owner
                rescued += 1

    flat = grid.ravel()
    counts = np.bincount(flat[flat != SEA], minlength=len(countries))
    # 사라진 나라가 있으면 라벨 위치에 강제로 한 칸
    for c in countries[1:]:
        if counts[c['id']] == 0:
            x, y = int(c['lx']), int(c['ly'])
            grid[y, x] = c['id']
            counts[c['id']] += 1
            rescued += 1

    # 라벨(수도) 위치는 반드시 자기 땅 위에
    order = np.argsort(flat, kind='stable')
    sorted_owner = flat[order]
    for c in countries[1:]:
        idx = order[np.searchsorted(sorted_owner, c['id']):np.searchsorted(sorted_owner, c['id'], 'right')]
        ys, xs = idx // W, idx % W
        d = (xs - c['lx']) ** 2 + (ys - c['ly']) ** 2
        k = int(np.argmin(d))
        c['lx'], c['ly'] = int(xs[k]), int(ys[k])
        c['px'] = int(len(idx))

    # 육상 인접국
    nb = [set() for _ in countries]
    for a, b in ((grid[:, :-1], grid[:, 1:]), (grid[:-1, :], grid[1:, :])):
        m = (a != b) & (a != SEA) & (b != SEA)
        for u, v in set(zip(a[m].tolist(), b[m].tolist())):
            nb[u].add(v)
            nb[v].add(u)
    for c in countries:
        c['nb'] = sorted(nb[c['id']])

    # 인접국끼리 색이 겹치지 않게 탐욕적 색 배정
    hues = {}
    for c in sorted(countries[1:], key=lambda c: -c['px']):
        best, score = 0, -1
        for k in range(48):
            h = (k * 0.618034 + c['id'] * 0.013) % 1.0
            dmin = min([min(abs(h - hues[n]), 1 - abs(h - hues[n])) for n in nb[c['id']] if n in hues] or [1])
            if dmin > score:
                best, score = h, dmin
        hues[c['id']] = best
        sat = 0.45 + (c['id'] % 3) * 0.1
        lig = 0.52 + (c['id'] % 4) * 0.04
        r, g, b = colorsys.hls_to_rgb(best, lig, sat)
        c['color'] = [round(r * 255), round(g * 255), round(b * 255)]
    countries[0]['color'] = [214, 214, 206]

    with gzip.open('data/map.bin.gz', 'wb', compresslevel=9) as fp:
        fp.write(grid.astype('<u2').tobytes())
    json.dump({'w': W, 'h': H, 'countries': countries}, open('data/countries.json', 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    land = int((flat != SEA).sum())
    print(f'grid {W}x{H}, land {land}, countries {len(countries) - 1}, rescued islands {rescued}')


if __name__ == '__main__':
    main(sys.argv[1])
