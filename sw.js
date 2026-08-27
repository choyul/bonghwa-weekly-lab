/* 군민용 — 매주 자동 갱신되므로 항상 최신을 우선한다.
   네트워크 먼저 받고, 안 될 때만(오프라인) 캐시로 보여준다. */
'use strict';
const CACHE='bhlab-public-v1';   /* 테스트본 전용 캐시 */
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(
  /* Cache Storage 는 origin(choyul.github.io) 단위라 운영본과 공유된다.
     bhlab- 로 시작하는 것만 지운다 — 전부 지우면 운영본 캐시(bonghwa-public-*)를 지워 버린다. */
  caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('bhlab-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin||e.request.method!=='GET')return;
  e.respondWith(
    fetch(e.request).then(res=>{
      const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return res;
    }).catch(()=>caches.match(e.request))
  );
});
