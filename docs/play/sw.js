/* 매뜨 땅먹 — 앱(PWA)용 서비스 워커
 * 한 번 받은 게임 파일과 지도를 폰에 저장해 두어서, 다음부터는 빨리 열리고 인터넷이 끊겨도 열린다.
 * 게임 파일은 인터넷이 되면 늘 새것을 받고(안 되면 저장해 둔 것), 지도는 주소에 판 번호(?v=)가 붙어 있어 저장해 둔 것을 바로 쓴다. */
const VERSION = '187d80640b', MAPS = ["map.json?v=zj1s-187d80640b","map.bin?v=zj1s-187d80640b"]; // tools/build-static.js 가 만들 때마다 판 번호와 지도 주소를 넣는다
const CACHE = 'mle-' + VERSION;
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/intro.js', 'js/shared.js', 'js/problems.js', 'js/firebase-config.js', 'js/backend.js', 'js/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.concat(MAPS))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => { // 예전 판 저장분 지우기
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mle-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // 글꼴 같은 바깥 파일은 그냥 둔다
  if (/\/map\.(json|bin)/.test(url.pathname)) { // 지도: 저장해 둔 것 먼저
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then(res => { // 나머지: 새것 먼저, 안 되면 저장해 둔 것
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
