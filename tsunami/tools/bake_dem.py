#!/usr/bin/env python3
"""한반도 주변 지형·수심(DEM)을 내려받아 시뮬레이터용 격자로 굽는다.

원본: AWS Terrain Tiles (Terrarium 인코딩, SRTM/GMTED/ETOPO1 등 공개 데이터)
출력: data/korea_dem.bin.gz — 위경도 등간격 격자, 북→남 행 순서의 int16(리틀엔디언) 해발(m), gzip 압축
      data/korea_meta.json — 격자 범위 + 도시 좌표/해발
사용: python3 tools/bake_dem.py [lab|video]   (tsunami/ 폴더에서 실행, 기본 lab)
  lab   — 인터랙티브 실험실(lab.html)용 넓은 범위 저해상도 → data/korea_dem.bin.gz, korea_meta.json
  video — 영상 재현(index.html)용 남한 화면 범위 고해상도 → data/korea_video.bin.gz, korea_video.json
"""
import gzip, io, json, math, os, sys, urllib.request
import numpy as np
from PIL import Image

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
PRESETS = {
    "lab": dict(bbox=(124.0, 132.0, 32.8, 38.9), width=1200, zoom=9, out="korea_dem", cities=True),
    "video": dict(bbox=(125.6, 130.2, 32.5, 39.1), width=1440, zoom=10, out="korea_video", cities=False),
}
CITY_ZOOM = 13

CITIES = [
    ("서울", 37.5665, 126.9780), ("인천", 37.4563, 126.7052), ("수원", 37.2636, 127.0286),
    ("평택", 36.9921, 127.1129), ("춘천", 37.8813, 127.7298), ("원주", 37.3422, 127.9202),
    ("강릉", 37.7519, 128.8761), ("속초", 38.2070, 128.5918), ("제천", 37.1326, 128.1910),
    ("천안", 36.8151, 127.1139), ("청주", 36.6424, 127.4890), ("대전", 36.3504, 127.3845),
    ("안동", 36.5684, 128.7294), ("군산", 35.9676, 126.7369), ("전주", 35.8242, 127.1480),
    ("포항", 36.0190, 129.3435), ("대구", 35.8714, 128.6014), ("울산", 35.5384, 129.3114),
    ("창원", 35.2280, 128.6811), ("부산", 35.1796, 129.0756), ("광주", 35.1595, 126.8526),
    ("목포", 34.8118, 126.3922), ("여수", 34.7604, 127.6622), ("제주", 33.4996, 126.5312),
    ("서귀포", 33.2541, 126.5600), ("울릉도", 37.4845, 130.9057), ("독도", 37.2417, 131.8650),
]

_cache = {}
def tile(z, x, y):
    key = (z, x, y)
    if key not in _cache:
        with urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=60) as r:
            a = np.asarray(Image.open(io.BytesIO(r.read())).convert("RGB"), dtype=np.float64)
        _cache[key] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return _cache[key]

def merc(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def bilinear(img, px, py):
    h, w = img.shape
    px = np.clip(px, 0, w - 1.001); py = np.clip(py, 0, h - 1.001)
    x0 = px.astype(int); y0 = py.astype(int); fx = px - x0; fy = py - y0
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)

def main(preset):
    cfg = PRESETS[preset]
    LON0, LON1, LAT0, LAT1 = cfg["bbox"]
    W, ZOOM = cfg["width"], cfg["zoom"]
    os.makedirs("data", exist_ok=True)
    dlon = (LON1 - LON0) / W
    dlat = dlon * math.cos(math.radians((LAT0 + LAT1) / 2))
    H = round((LAT1 - LAT0) / dlat)
    dlat = (LAT1 - LAT0) / H

    tx0, ty0 = (int(v) for v in merc(LAT1, LON0, ZOOM))
    tx1, ty1 = (int(v) for v in merc(LAT0, LON1, ZOOM))
    rows = []
    for ty in range(ty0, ty1 + 1):
        rows.append(np.hstack([tile(ZOOM, tx, ty) for tx in range(tx0, tx1 + 1)]))
        print(f"  tile row {ty - ty0 + 1}/{ty1 - ty0 + 1}")
    mosaic = np.vstack(rows)

    lons = LON0 + (np.arange(W) + 0.5) * dlon
    lats = LAT1 - (np.arange(H) + 0.5) * dlat
    px = ((lons + 180) / 360 * 2 ** ZOOM - tx0) * 256
    py = np.array([merc(la, 0, ZOOM)[1] for la in lats])
    py = (py - ty0) * 256
    PX, PY = np.meshgrid(px, py)
    elev = np.rint(bilinear(mosaic, PX, PY)).clip(-12000, 12000).astype("<i2")
    with gzip.open(f"data/{cfg['out']}.bin.gz", "wb", compresslevel=9) as f:
        f.write(elev.tobytes())

    cities = []
    for name, lat, lon in (CITIES if cfg["cities"] else []):
        x, y = merc(lat, lon, CITY_ZOOM)
        t = tile(CITY_ZOOM, int(x), int(y))
        # 한 점이 언덕에 걸리지 않도록 반경 약 0.5 km 안의 중앙값을 도시 해발로 쓴다
        cx, cy = int((x - int(x)) * 256), int((y - int(y)) * 256)
        win = t[max(0, cy - 32):cy + 33, max(0, cx - 32):cx + 33]
        e = float(np.median(win[win > 0])) if (win > 0).any() else 1.0
        cities.append({"name": name, "lat": lat, "lon": lon, "elev": max(1, round(e))})
        print(f"  {name}: {cities[-1]['elev']} m")

    meta = {"width": W, "height": H, "lon0": LON0, "lon1": LON1, "lat0": LAT0, "lat1": LAT1,
            "source": "AWS Terrain Tiles (Terrarium) — SRTM, GMTED2010, ETOPO1 등",
            **({"cities": cities} if cfg["cities"] else {})}
    meta_name = "korea_meta" if preset == "lab" else cfg["out"]
    with open(f"data/{meta_name}.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(f"done: {W}x{H}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "lab")
