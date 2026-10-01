# MakeHuman 데이터 로더 (베이스 메시, 모프 타깃, 기본 리그/가중치)
import os, json, functools
import numpy as np

class MH:
    def __init__(self, data):
        self.D = data
        self.obj = self._load_obj()
        s = json.load(open(data + '/rigs/default.mhskel'))
        self.joints = s['joints']; self.bones = s['bones']
        self.weights = json.load(open(data + '/rigs/default_weights.mhw'))['weights']

    def _load_obj(self):
        V, VT, F, FT, G, g = [], [], [], [], [], None
        for ln in open(self.D + '/3dobjs/base.obj'):
            if ln.startswith('v '): V.append([float(x) for x in ln.split()[1:4]])
            elif ln.startswith('vt '): VT.append([float(x) for x in ln.split()[1:3]])
            elif ln.startswith('g '): g = ln.split()[1]
            elif ln.startswith('f '):
                ps = [p.split('/') for p in ln.split()[1:]]
                F.append([int(p[0]) - 1 for p in ps]); FT.append([int(p[1]) - 1 for p in ps]); G.append(g)
        return np.array(V), np.array(VT), F, FT, G

    @functools.lru_cache(None)
    def target(self, path):
        idx, d = [], []
        for ln in open(os.path.join(self.D, 'targets', path)):
            if ln[0] == '#' or not ln.strip(): continue
            a = ln.split(); idx.append(int(a[0])); d.append([float(a[1]), float(a[2]), float(a[3])])
        return np.array(idx, dtype=np.int64), np.array(d).reshape(-1, 3)

    def build(self, weights):
        X = self.obj[0].copy()
        for p, w in weights.items():
            if abs(w) < 1e-5: continue
            i, d = self.target(p)
            if len(i): X[i] += w * d
        return X

    def bone_ends(self, X):
        J = {k: X[v].mean(0) for k, v in self.joints.items()}
        return {b: (J[d['head']], J[d['tail']], d['parent']) for b, d in self.bones.items()}
