// Advisory lookup only. Sends published crate names/versions, never source or accounting data.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { stdout: tree } = await promisify(execFile)(process.execPath, ['tools/native.mjs', 'tree'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
const windows = new Set([...tree.matchAll(/^([^\s]+) v([^\s]+)/gm)].map((m) => m[1] + '@' + m[2]));
if (windows.size < 10) throw new Error('Windows dependency graph was not verified');
const lock = await readFile(new URL('../apps/desktop/src-tauri/Cargo.lock', import.meta.url), 'utf8');
const crates = lock.split('[[package]]').slice(1).filter((p) => /source = "registry\+https:\/\/github.com\/rust-lang\/crates.io-index"/.test(p)).map((p) => ({
  name: p.match(/^name = "([^"]+)"/m)[1], version: p.match(/^version = "([^"]+)"/m)[1],
}));
const findings = [];
async function batch(queries) {
  const response = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error('OSV HTTP ' + response.status);
  const result = await response.json();
  if (result.results?.length !== queries.length) throw new Error('Incomplete advisory response');
  return result.results;
}
for (let offset = 0; offset < crates.length; offset += 100) {
  const group = crates.slice(offset, offset + 100);
  let pending = group.map((p) => ({ package: { name: p.name, ecosystem: 'crates.io' }, version: p.version }));
  while (pending.length) {
    const results = await batch(pending);
    const next = [];
    for (let i = 0; i < results.length; i++) {
      for (const v of results[i].vulns ?? []) findings.push({ name: pending[i].package.name, version: pending[i].version, id: v.id,
        windows: windows.has(pending[i].package.name + '@' + pending[i].version) });
      if (results[i].next_page_token) next.push({ ...pending[i], page_token: results[i].next_page_token });
    }
    pending = next;
  }
}
const details = [];
for (const id of new Set(findings.map((f) => f.id))) {
  const response = await fetch('https://api.osv.dev/v1/vulns/' + encodeURIComponent(id), { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Advisory detail unavailable: ' + id);
  const detail = await response.json();
  details.push({ id, summary: detail.summary, withdrawn: detail.withdrawn ?? null, affected: detail.affected });
}
const report = { checkedAt: new Date().toISOString(), source: 'https://api.osv.dev/v1/querybatch',
  packages: crates.length, windowsPackages: windows.size,
  scope: 'All locked crates queried; Windows relevance determined by locked offline cargo tree including normal/build dependencies',
  findings, details, limitations: 'Known advisory coverage only; not proof of absence of vulnerabilities or an independent security audit' };
await mkdir('.cache', { recursive: true });
await writeFile('.cache/native-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ packages: crates.length, windowsPackages: windows.size, windowsFindings: findings.filter((f) => f.windows).length,
  findings, details: details.map(({ id, summary, withdrawn }) => ({ id, summary, withdrawn })) }, null, 2));
if (findings.some((f) => f.windows)) process.exitCode = 1;
