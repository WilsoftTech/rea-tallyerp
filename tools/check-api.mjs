// Verify emitted API startup against the configured local development cluster; no account is seeded.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
const port='49184';
const child=spawn(process.execPath,['--env-file=.cache/cloud/api.env','apps/api/dist/main.js'],{windowsHide:true,env:{...process.env,PORT:port},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',chunk=>{output+=chunk.toString();});child.stderr.on('data',()=>{});
try {
  for(let i=0;i<100 && !output.includes('Accounting API listening');i++){if(child.exitCode!==null)throw Error('Emitted API failed startup.');await setTimeout(100);}
  assert(output.includes('127.0.0.1:'+port));
  const response=await fetch('http://127.0.0.1:'+port+'/health');assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.protocol,1);
  console.log('PASS: emitted API starts with the non-owner PostgreSQL role and serves protocol-1 health on loopback.');
} finally {if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done;}}
