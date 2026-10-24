import json, sys, ov, pyarrow as pa, pyarrow.parquet as pq, pyarrow.compute as pc
from concurrent.futures import ThreadPoolExecutor
typ, cols, box = sys.argv[1], sys.argv[2].split(','), [float(v) for v in sys.argv[3].split(',')]
h = json.load(open(f'rg_{typ}.json'))
def one(x):
    k, s, g, n, b = x
    pf = pq.ParquetFile(ov.RangeFile(k, s))
    t = pf.read_row_group(g, columns=cols + ['bbox'])
    bb = t.column('bbox')
    xmin = pc.struct_field(bb, 'xmin'); xmax = pc.struct_field(bb, 'xmax'); ymin = pc.struct_field(bb, 'ymin'); ymax = pc.struct_field(bb, 'ymax')
    m = pc.and_(pc.and_(pc.less_equal(xmin, box[2]), pc.greater_equal(xmax, box[0])), pc.and_(pc.less_equal(ymin, box[3]), pc.greater_equal(ymax, box[1])))
    return t.filter(m)
with ThreadPoolExecutor(8) as ex: ts = list(ex.map(one, h))
t = pa.concat_tables(ts)
pq.write_table(t, f'{typ}.parquet')
print(typ, t.num_rows)
