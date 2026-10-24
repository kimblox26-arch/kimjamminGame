import urllib.parse
import os, ssl, urllib.request, re, json, sys, io, threading
from concurrent.futures import ThreadPoolExecutor
import pyarrow.parquet as pq
REL = 'release/2026-10-21.0'
BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/'
CTX = ssl.create_default_context(cafile='/root/.ccr/ca-bundle.crt')
def get(url, rng=None, tries=4):
    for t in range(tries):
        try:
            req = urllib.request.Request(url)
            if rng: req.add_header('Range', 'bytes=%d-%d' % rng)
            with urllib.request.urlopen(req, context=CTX, timeout=120) as r: return r.read()
        except Exception as e:
            if t == tries - 1: raise
class RangeFile(io.RawIOBase):
    def __init__(self, key, size):
        self.url = BASE + key; self.size = size; self.pos = 0; self.cache = {}
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, wh=0):
        self.pos = off if wh == 0 else self.pos + off if wh == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0: return b''
        d = get(self.url, (self.pos, self.pos + n - 1)); self.pos += len(d); return d
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)
def listing(prefix):
    out, tok = [], None
    while True:
        u = BASE + '?list-type=2&prefix=' + prefix + ('&continuation-token=' + urllib.parse.quote(tok) if tok else '')
        x = get(u).decode()
        out += [(k, int(s)) for k, s in re.findall(r'<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>', x)]
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', x)
        if not m: return out
        tok = m.group(1)
def rowgroups(theme, typ, box):
    files = listing(f'{REL}/theme={theme}/type={typ}/')
    hits = []
    def one(f):
        key, size = f
        pf = pq.ParquetFile(RangeFile(key, size))
        md = pf.metadata
        names = [md.schema.column(i).path for i in range(md.num_columns)]
        ix = {n: names.index(n) for n in ['bbox.xmin', 'bbox.xmax', 'bbox.ymin', 'bbox.ymax']}
        r = []
        for g in range(md.num_row_groups):
            rg = md.row_group(g)
            s = {k: rg.column(i).statistics for k, i in ix.items()}
            if s['bbox.xmin'].min > box[2] or s['bbox.xmax'].max < box[0] or s['bbox.ymin'].min > box[3] or s['bbox.ymax'].max < box[1]: continue
            r.append((key, size, g, rg.num_rows, rg.total_byte_size))
        return r
    with ThreadPoolExecutor(16) as ex:
        for r in ex.map(one, files): hits += r
    return hits
if __name__ == '__main__':
    import urllib.parse
    theme, typ = sys.argv[1], sys.argv[2]
    box = [float(v) for v in sys.argv[3].split(',')]
    h = rowgroups(theme, typ, box)
    json.dump(h, open(f'rg_{typ}.json', 'w'))
    print(len(h), 'rowgroups', sum(x[3] for x in h), 'rows', sum(x[4] for x in h) / 1e6, 'MB')
