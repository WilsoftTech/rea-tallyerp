import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const root=resolve(import.meta.dirname,'..'),web=resolve(root,'apps/web');
async function walk(path){const entries=await readdir(path,{withFileTypes:true});return(await Promise.all(entries.map(e=>e.isDirectory()?walk(resolve(path,e.name)):resolve(path,e.name)))).flat();}
const paths=['/','/icon.svg','/manifest.webmanifest',...(await walk(resolve(web,'.next/static'))).filter(p=>/\.(?:js|css|woff2?)$/.test(p)).map(p=>'/_next/static/'+relative(resolve(web,'.next/static'),p).split(sep).join('/'))].sort();
const version=createHash('sha256').update(await readFile(resolve(web,'.next/BUILD_ID'))).update(JSON.stringify(paths)).digest('hex').slice(0,24);
const source=await readFile(resolve(web,'src/worker.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,removeComments:false}}).outputText;
await writeFile(resolve(web,'public/sw.js'),'const __CACHE_NAME__='+JSON.stringify('erp-public-shell-'+version)+';\nconst __PUBLIC_PATHS__='+JSON.stringify(paths)+';\n'+compiled);
console.log('Generated public-only offline shell:',paths.length,'paths; version',version);
