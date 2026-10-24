import numpy as np, io, math, os, ssl, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
from scipy.ndimage import map_coordinates
import geo
CTX = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
os.makedirs('tiles', exist_ok=True)
def tile(z, x, y):
    fn = f'tiles/{z}_{x}_{y}.png'
    if not os.path.exists(fn):
        for t in range(4):
            try:
                d = urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', context=CTX, timeout=60).read(); break
            except Exception as e:
                if t == 3: raise
        open(fn, 'wb').write(d)
    a = np.asarray(Image.open(fn).convert('RGB')).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
def merc(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / math.pi) / 2 * n
    return x, y
def grid(N, step, z):
    c = (np.arange(N) - (N - 1) / 2) * step
    X, Z = np.meshgrid(c, c)
    lat, lon = geo.flat_to_ll(X, Z)
    tx, ty = merc(lat, lon, z)
    x0, x1 = int(np.floor(tx.min())) - 1, int(np.floor(tx.max())) + 1
    y0, y1 = int(np.floor(ty.min())) - 1, int(np.floor(ty.max())) + 1
    jobs = [(z, x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    print('tiles', len(jobs))
    with ThreadPoolExecutor(16) as ex: ts = list(ex.map(lambda j: tile(*j), jobs))
    W = (x1 - x0 + 1) * 256; H = (y1 - y0 + 1) * 256
    M = np.zeros((H, W))
    k = 0
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            M[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = ts[k]; k += 1
    px = (tx - x0) * 256 - 0.5; py = (ty - y0) * 256 - 0.5
    return map_coordinates(M, [py, px], order=3, mode='nearest'), X, Z
if __name__ == '__main__':
    core, X, Z = grid(2560, 15.0, 13)
    np.save('dem_core.npy', core.astype(np.float32))
    outer, _, _ = grid(1024, 100.0, 10)
    np.save('dem_outer.npy', outer.astype(np.float32))
    print(core.min(), core.max(), outer.min(), outer.max())
    i = np.unravel_index(core.argmax(), core.shape); print('peak at', X[i], Z[i])
