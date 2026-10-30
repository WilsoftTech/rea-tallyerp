/// <reference lib="webworker" />
declare const __CACHE_NAME__: string;
declare const __PUBLIC_PATHS__: readonly string[];
const worker=self as unknown as ServiceWorkerGlobalScope;
const allowed=new Set(__PUBLIC_PATHS__);
worker.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(__CACHE_NAME__);
    try{for(const path of __PUBLIC_PATHS__){
      const response=await fetch(new Request(path,{cache:'reload',credentials:'omit',redirect:'error'}));
      if(!response.ok)throw Error('Public shell unavailable');
      await cache.put(path,response);
    }}catch(cause){await caches.delete(__CACHE_NAME__);throw cause;}
    // Normal waiting lifecycle: never replace a worker while old clients remain open.
  })());
});
worker.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith('erp-public-shell-')&&key!==__CACHE_NAME__)await caches.delete(key);
    await worker.clients.claim();
  })());
});
worker.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==worker.location.origin||url.search||request.headers.has('RSC'))return;
  if(!allowed.has(url.pathname))return;
  if(url.pathname==='/'&&request.mode!=='navigate')return;
  // No API response, bearer, company record or request body is written to Cache Storage.
  event.respondWith((async()=>{const cached=await(await caches.open(__CACHE_NAME__)).match(url.pathname);return cached??fetch(request);})());
});
