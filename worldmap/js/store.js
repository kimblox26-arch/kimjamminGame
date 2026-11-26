// 저장 슬롯 (IndexedDB) + 백업 파일
const DB = 'worldmap-editor', ST = 'saves';
let dbp = null;
const db = () => dbp || (dbp = new Promise((ok, no) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' });
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
}));
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((ok, no) => {
    const t = d.transaction(ST, mode), s = t.objectStore(ST), r = fn(s);
    t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error);
  });
};
export const put = (rec) => tx('readwrite', (s) => s.put(rec));
export const get = (id) => tx('readonly', (s) => s.get(id));
export const del = (id) => tx('readwrite', (s) => s.delete(id));
export const list = async () => ((await tx('readonly', (s) => s.getAll())) || []).sort((a, b) => b.time - a.time);

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
export const toFile = ({ meta, rle }) => JSON.stringify({ app: 'worldmap-editor', v: 1, meta, rle: b64(new Uint8Array(rle.buffer, rle.byteOffset, rle.byteLength)) });
export function fromFile(text) {
  const j = JSON.parse(text);
  if (j.app !== 'worldmap-editor') throw new Error('지원하지 않는 파일입니다');
  return { meta: j.meta, rle: new Uint16Array(unb64(j.rle).buffer) };
}
export function download(name, data, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
