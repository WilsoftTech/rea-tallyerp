import { randomBytes,generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import { createApi } from '../src/http.js';
import { assertRuntime,database } from '../src/db.js';
import { encode } from '@erp/contracts/codec';
/** Real PostgreSQL/API fixture; cleanup is restricted to this generated database. */
export async function cloudLab(){
  const local=JSON.parse(await readFile('.cache/cloud/development.json','utf8')) as {port:number;admin:string;runtime:string};
  const config={host:'127.0.0.1',port:local.port,user:'erp_admin',password:local.admin,connectionTimeoutMillis:5000};
  const name='erp_verify_'+randomBytes(8).toString('hex');const admin=new Client({...config,database:'postgres'});await admin.connect();
  await admin.query('CREATE DATABASE '+name+' OWNER erp_admin');const migration=new Client({...config,database:name});await migration.connect();
  try{for(const file of ['001_foundation','002_security_audit','003_resolution_links','004_enrollment_cancellation'])await migration.query(await readFile(resolve('apps/api/prisma/migrations',file,'migration.sql'),'utf8'));
    await migration.query('GRANT CONNECT ON DATABASE '+name+' TO erp_runtime; GRANT USAGE ON SCHEMA public TO erp_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO erp_runtime');
  }finally{await migration.end();}
  const db=database('postgresql://erp_runtime:'+local.runtime+'@127.0.0.1:'+local.port+'/'+name);await assertRuntime(db);
  const key=generateKeyPairSync('ed25519').privateKey;const bootstrap=randomBytes(32).toString('hex');const password='Synthetic cloud password 2026';
  const server=createApi({db,signingKey:key.export({type:'pkcs8',format:'pem'}).toString(),bootstrapToken:bootstrap});
  await new Promise<void>(ready=>server.listen(0,'127.0.0.1',ready));const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const request=async(path:string,method='GET',value?:unknown,token='')=>{const response=await fetch(origin+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(value===undefined?{}:{body:encode(value)})});return {status:response.status,body:await response.json() as Record<string,unknown>};};
  const first=await request('/v1/auth/bootstrap','POST',{token:bootstrap,username:'synthetic.owner',password,tenantName:'Synthetic Browser Cloud Lab'});
  if(first.status!==201)throw Error('Synthetic bootstrap failed.');const login=await request('/v1/auth/login','POST',{username:'synthetic.owner',password});if(login.status!==200)throw Error('Synthetic login failed.');
  return {origin,password,token:login.body['token'] as string,tenant:first.body['tenantId'] as string,user:first.body['userId'] as string,request,db,
    async sql(sql:string,values:unknown[]=[]){if(!/^erp_verify_[a-f0-9]{16}$/.test(name))throw Error('Synthetic database required.');const client=new Client({...config,database:name});await client.connect();try{return await client.query(sql,values);}finally{await client.end();}},
    async close(){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await db.$disconnect();if(/^erp_verify_[a-f0-9]{16}$/.test(name))await admin.query('DROP DATABASE '+name+' WITH (FORCE)');await admin.end();},
  };
}
