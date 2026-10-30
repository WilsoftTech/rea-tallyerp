import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const mode=process.argv[2];
const environment={...process.env,NEXT_TELEMETRY_DISABLED:'1',PLAYWRIGHT_BROWSERS_PATH:resolve(root,'.cache/playwright')};
let script,args,cwd;
if(mode==='browsers'){script=resolve(root,'node_modules/playwright/cli.js');args=['install','firefox'];cwd=root;}
else if(['dev','build','start'].includes(mode)){script=resolve(root,'node_modules/next/dist/bin/next');args=[mode,...(mode==='build'?['--webpack']:['--hostname','127.0.0.1','--port',process.env.ERP_WEB_PORT??'3000'])];cwd=resolve(root,'apps/web');}
else throw Error('Use web.mjs dev|build|start|browsers');
const child=spawn(process.execPath,[script,...args],{cwd,env:environment,windowsHide:true,stdio:'inherit'});
child.on('error',()=>{console.error('Web tool could not start.');process.exitCode=1;});
child.on('exit',async code=>{if(code===0&&mode==='build'){const worker=spawn(process.execPath,[resolve(root,'tools/web-worker.mjs')],{cwd:root,env:environment,windowsHide:true,stdio:'inherit'});worker.on('exit',result=>{process.exitCode=result??1;});}else process.exitCode=code??1;});
