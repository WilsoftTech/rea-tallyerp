'use client';
import { useEffect, useState } from 'react';
import { App } from '@erp/workspace/ui';
import type { Host } from '@erp/workspace/host';
import { BrowserRuntime } from './core/runtime.js';

export function BrowserApp() {
  const [runtime,setRuntime]=useState<BrowserRuntime|null>(null);
  const [host,setHost]=useState<Host|null>(null);
  const [storage,setStorage]=useState('Checking browser storage…');
  const [worker,setWorker]=useState('Offline shell has not been installed yet.');
  const [notice,setNotice]=useState('');
  const [unsupported,setUnsupported]=useState('');
  useEffect(()=>{
    if(!globalThis.isSecureContext||!globalThis.crypto?.subtle||!globalThis.indexedDB){setUnsupported('This workspace requires a secure context with IndexedDB and Web Crypto. Open the supported browser application on HTTPS or localhost, or use the Windows application.');return;}
    const core=new BrowserRuntime(location.origin);
    const update=()=>{if(core.db.stale)setNotice('Storage was upgraded in another tab. Close all workspace tabs and reopen; records were preserved.');else if(core.db.blocked)setNotice('Another tab is blocking a storage upgrade. Close other workspace tabs, then reload.');};
    const unsubscribe=core.subscribeInfo(update);
    setRuntime(core);setHost({platform:'browser',createClient:core.client,serviceOrigin:location.origin,subscribe:core.subscribe,contextVersion:core.contextVersion});
    let active=true;
    void Promise.all([navigator.storage?.persisted(),navigator.storage?.estimate()]).then(([persisted,estimate])=>{
      if(active)setStorage((persisted?'Persistent storage granted.':'Storage can be evicted by the browser.')+(estimate?.quota?' Estimated usage '+Math.ceil((estimate.usage??0)/1024/1024)+' MiB of '+Math.floor(estimate.quota/1024/1024)+' MiB.':'')+' Keep an encrypted backup outside this browser.');
    }).catch(()=>{if(active)setStorage('Storage estimates are unavailable. Keep an encrypted external backup.');});
    if('serviceWorker' in navigator){
      void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(registration=>{
        const status=()=>{if(!active)return;setWorker(registration.waiting?'An application update is waiting. Finish work, then close every workspace tab and reopen. Saved records and pending commands are retained.':registration.active?'Offline shell installed. Reopen this same address to work offline.':'Installing the public offline shell…');};
        status();registration.addEventListener('updatefound',()=>{status();registration.installing?.addEventListener('statechange',status);});
        void navigator.serviceWorker.ready.then(status);
      }).catch(()=>{if(active)setWorker('Offline shell unavailable. Keep this tab open; offline reopening is not verified. Use the production web build on localhost or HTTPS.');});
    }else setWorker('Service workers are unavailable. Offline reopening is unsupported in this browser.');
    return()=>{active=false;unsubscribe();core.close();};
  },[]);
  async function persist(){
    try{const allowed=await navigator.storage?.persist();setStorage(allowed?'Persistent storage granted. Clearing site data still deletes records. Keep encrypted external backups.':'Persistent storage was not granted. Browser eviction remains possible. Keep encrypted external backups.');}
    catch{setStorage('Persistent storage is unavailable or denied. Keep encrypted external backups.');}
  }
  return <><aside className="browser-status" aria-label="Browser storage and offline status">
    <p role="status">{storage}</p><button type="button" onClick={()=>{void persist();}}>Request persistent storage</button>
    <p role="status">{worker}</p>{notice&&<p role="alert" className="error">{notice}</p>}
  </aside>{unsupported?<main><p role="alert" className="error">{unsupported}</p></main>:host&&runtime?<App host={host}/>:<main><p role="status">Opening the local accounting workspace…</p></main>}</>;
}
