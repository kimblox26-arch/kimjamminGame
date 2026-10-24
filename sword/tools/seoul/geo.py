# 게임 평면 좌표 (x 동, z 남, m) ↔ 위경도 — frame.js flatToPlanet + geo.js 와 같은 식
import numpy as np
RE = 6371000.0
LAT0, LON0 = np.radians(37.5665), np.radians(126.978)
GE = np.array([-np.sin(LON0), np.cos(LON0), 0])
GU = np.array([np.cos(LAT0)*np.cos(LON0), np.cos(LAT0)*np.sin(LON0), np.sin(LAT0)])
GN = np.array([-np.sin(LAT0)*np.cos(LON0), -np.sin(LAT0)*np.sin(LON0), np.cos(LAT0)])
def flat_to_ll(x, z):
    a, b = np.asarray(x) / RE, np.asarray(z) / RE
    nx, ny, nz = np.sin(a)*np.cos(b), np.cos(a)*np.cos(b), np.sin(b)
    ex = nx*GE[0] + ny*GU[0] - nz*GN[0]; ey = nx*GE[1] + ny*GU[1] - nz*GN[1]; ez = nx*GE[2] + ny*GU[2] - nz*GN[2]
    return np.degrees(np.arcsin(np.clip(ez, -1, 1))), np.degrees(np.arctan2(ey, ex))
def ll_to_flat(lat, lon):
    lat, lon = np.radians(np.asarray(lat, float)), np.radians(np.asarray(lon, float))
    ex, ey, ez = np.cos(lat)*np.cos(lon), np.cos(lat)*np.sin(lon), np.sin(lat)
    nx = ex*GE[0] + ey*GE[1] + ez*GE[2]; ny = ex*GU[0] + ey*GU[1] + ez*GU[2]; nz = -(ex*GN[0] + ey*GN[1] + ez*GN[2])
    return np.arctan2(nx, ny) * RE, np.arcsin(np.clip(nz, -1, 1)) * RE
