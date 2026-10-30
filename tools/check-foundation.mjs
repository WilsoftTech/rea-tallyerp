import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repository/documentation and phase-gate validation; not a test/build substitute.
const root = fileURLToPath(new URL('../', import.meta.url));
const required = [
  'AGENTS.md', 'CLAUDE.md', 'ROADMAP.md', 'docs/README.md',
  'docs/architecture/overview.md', 'docs/architecture/decisions.md',
  'docs/architecture/database.md', 'docs/architecture/offline-sync.md',
  'docs/architecture/security.md', 'docs/accounting/accounting-engine.md',
  'docs/research/tally-workflows.md', 'docs/progress/phase-status.md',
  'docs/testing/test-strategy.md',
  'docs/research/evidence/tally-executable.json',
  'docs/research/evidence/rea-capabilities.json',
  'package.json', '.gitignore', '.gitattributes', '.editorconfig',
];
const errors = [];
const contents = new Map();
for (const name of required) {
  try {
    const text = await readFile(resolve(root, name), 'utf8');
    contents.set(name, text);
    if (!text.trim()) errors.push(`${name}: empty required file`);
  } catch (error) {
    errors.push(`${name}: ${error.code ?? error.message}`);
  }
}

async function filesWithin(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // Local research runtime/data and backups are ignored, potentially binary,
    // and outside source validation. Never read their contents as UTF-8 here.
    if (['.git', 'node_modules', '.next', 'dist', 'target', 'gen', 'generated', 'coverage', 'playwright-report', 'test-results'].includes(entry.name) || entry.name.endsWith('.tsbuildinfo') ||
        (directory === resolve(root,'apps/web/public') && entry.name === 'sw.js') || entry.name === 'next-env.d.ts' ||
        (directory === root && ['local-data', 'backups', '.cache'].includes(entry.name))) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      errors.push(`${relative(root, path)}: symlinks outside foundation scope`);
    } else if (entry.isDirectory()) {
      files.push(...await filesWithin(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const files = await filesWithin(root);
for (const path of files) {
  if (['.png', '.ico'].includes(extname(path))) {
    if ((await stat(path)).size === 0) errors.push(`${relative(root, path)}: empty native icon`);
    continue;
  }
  const text = await readFile(path, 'utf8');
  if (text.startsWith('\uFEFF')) errors.push(`${relative(root, path)}: unexpected UTF-8 BOM`);
  if (!text.endsWith('\n')) errors.push(`${relative(root, path)}: missing final newline`);
  if (/[\t ]+$/m.test(text.replaceAll('\r\n', '\n'))) {
    errors.push(`${relative(root, path)}: trailing whitespace`);
  }
}
let linkCount = 0;
for (const path of files.filter((p) => extname(p) === '.md')) {
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    const local = target.split('#')[0];
    if (!local) continue;
    const resolved = resolve(dirname(path), decodeURIComponent(local));
    const rel = relative(root, resolved);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      errors.push(`${relative(root, path)}: local link leaves workspace: ${target}`);
      continue;
    }
    try {
      if (!(await stat(resolved)).isFile()) throw new Error('not a file');
      linkCount++;
    } catch {
      errors.push(`${relative(root, path)}: unresolved local link: ${target}`);
    }
  }
}

function json(name) {
  try {
    return JSON.parse(contents.get(name) ?? '');
  } catch (error) {
    errors.push(`${name}: invalid JSON: ${error.message}`);
    return {};
  }
}

const pkg = json('package.json');
if (pkg.private !== true) errors.push('Root package must remain private');
if (Object.keys(pkg.dependencies ?? {}).length) errors.push('Root must not add runtime dependencies');
if (pkg.scripts?.['check:foundation'] !== 'node tools/check-foundation.mjs') {
  errors.push('Foundation validation command missing or changed');
}
for (const name of ['test', 'build', 'lint', 'typecheck']) {
  if (!pkg.scripts?.[name] || /echo|exit 0/.test(pkg.scripts[name])) errors.push(`Real Phase 2 ${name} command required`);
}
for (const name of ['domain', 'application']) {
  const manifest = JSON.parse(await readFile(resolve(root, `packages/${name}/package.json`), 'utf8'));
  const external = Object.keys(manifest.dependencies ?? {}).filter((key) => key !== '@erp/domain');
  if (external.length) errors.push(`${name}: external runtime dependencies not admitted`);
}
if (files.some((p) => /^apps[\\/](?!(desktop|api|web)[\\/])/.test(relative(root, p)))) {
  errors.push('Only desktop, API and web apps are authorized in Phase 5');
}

const evidence = json('docs/research/evidence/tally-executable.json');
const artifact = evidence.normalized_result?.artifact;
if (evidence.operation !== 'inspect_pe_certificates' || evidence.confidence !== 'observed') {
  errors.push('Expected observed executable identity Evidence');
}
if (!/^ev_[a-f0-9]{64}$/.test(evidence.evidence_id ?? '') ||
    !/^[a-f0-9]{64}$/.test(artifact?.sha256 ?? '') || !Number.isSafeInteger(artifact?.bytes)) {
  errors.push('Executable Evidence identity incomplete');
}
if (artifact?.sha256 !== evidence.subject?.digest?.sha256 ||
    evidence.normalized_result?.format !== 'pe32-plus' ||
    evidence.subject?.architecture !== 'x86_64' || !evidence.limitations?.length) {
  errors.push('Executable Evidence scope/limitations inconsistent');
}
const capabilities = json('docs/research/evidence/rea-capabilities.json');
if (!capabilities.groups?.some((g) => g.names.includes('observe_native_ui') &&
    g.available === false && g.reason === 'unsupported_host')) {
  errors.push('Windows native UI limitation must remain recorded');
}

const roadmap = contents.get('ROADMAP.md') ?? '';
const gates = [...roadmap.matchAll(/^\| P1-(\d{2}) \|[^\n]+\| (PASS|OPEN)\b[^\n]*\|$/gm)];
if (gates.length !== 10 || new Set(gates.map((g) => g[1])).size !== 10) {
  errors.push('Phase 1 must have ten unique measurable criteria');
}
const passed = gates.filter((g) => g[2] === 'PASS').length;
const percentage = gates.length ? Math.floor(100 * passed / gates.length) : 0;
if (!roadmap.includes(`| 1 — Architecture and Foundation | ${percentage}% (${passed}/10)`)) {
  errors.push('Roadmap percentage does not match mandatory criteria');
}
const status = contents.get('docs/progress/phase-status.md') ?? '';
if (!status.includes(`**Phase 1 progress: ${percentage}% (${passed}/10 mandatory criteria).**`)) {
  errors.push('Progress record does not match roadmap');
}
for (let phase = 6; phase <= 10; phase++) {
  const line = roadmap.split('\n').find((l) => l.startsWith(`| ${phase} —`));
  if (!line?.includes('| 0% | Not started | Not run | Blocked by Phase')) {
    errors.push(`Phase ${phase} must remain unstarted and blocked`);
  }
}
const phase2 = [...roadmap.matchAll(/^\| P2-(\d{2}) \|[^\n]+\| (PASS|OPEN)\b[^\n]*\|$/gm)];
const phase2Passed = phase2.filter((gate) => gate[2] === 'PASS').length;
const phase2Percentage = Math.floor(100 * phase2Passed / 6);
if (phase2.length !== 6 || new Set(phase2.map((gate) => gate[1])).size !== 6 ||
    !roadmap.includes(`| 2 — Accounting Engine | ${phase2Percentage}% (${phase2Passed}/6)`) ||
    !status.includes(`**Phase 2 progress: ${phase2Percentage}% (${phase2Passed}/6 mandatory criteria).**`)) {
  errors.push('Phase 2 acceptance criteria/progress records disagree');
}
const phase3 = [...roadmap.matchAll(/^\| P3-(\d{2}) \|[^\n]+\| (PASS|OPEN)\b[^\n]*\|$/gm)];
const phase3Passed = phase3.filter((gate) => gate[2] === 'PASS').length;
const phase3Percentage = Math.floor(100 * phase3Passed / 6);
if (phase3.length !== 6 || new Set(phase3.map((gate) => gate[1])).size !== 6 ||
    !roadmap.includes(`| 3 — Offline Desktop Application | ${phase3Percentage}% (${phase3Passed}/6)`) ||
    !status.includes(`**Phase 3 progress: ${phase3Percentage}% (${phase3Passed}/6 mandatory criteria).**`)) {
  errors.push('Phase 3 acceptance criteria/progress records disagree');
}
const phase4 = [...roadmap.matchAll(/^\| P4-(\d{2}) \|[^\n]+\| (PASS|OPEN)\b[^\n]*\|$/gm)];
const phase4Passed = phase4.filter((gate) => gate[2] === 'PASS').length;
const phase4Percentage = Math.floor(100 * phase4Passed / 6);
if (phase4.length !== 6 || new Set(phase4.map((gate) => gate[1])).size !== 6 ||
    !roadmap.includes(`| 4 — Cloud Backend and Synchronization | ${phase4Percentage}% (${phase4Passed}/6)`) ||
    !status.includes(`**Phase 4 progress: ${phase4Percentage}% (${phase4Passed}/6 mandatory criteria).**`)) {
  errors.push('Phase 4 acceptance criteria/progress records disagree');
}
const phase5=[...roadmap.matchAll(/^\| P5-(\d{2}) \|[^\n]+\| (PASS|OPEN)\b[^\n]*\|$/gm)];
const phase5Passed=phase5.filter(g=>g[2]==='PASS').length;
const phase5Percentage=Math.floor(100*phase5Passed/6);
if(phase5.length!==6 || new Set(phase5.map(g=>g[1])).size!==6 || !roadmap.includes(`| 5 — Offline Web Application | ${phase5Percentage}% (${phase5Passed}/6)`) || !status.includes(`**Phase 5 progress: ${phase5Percentage}% (${phase5Passed}/6 mandatory criteria).**`)) errors.push('Phase 5 acceptance criteria/progress records disagree');
if (!roadmap.includes('**Phase 5 only**') || !roadmap.includes('APPROVED AND CLOSED — 2026-10-26') ||
    !status.includes('Phase 4 closure approval: **granted**') || !status.includes('Phase 5 closure approval: **not granted**')) {
  errors.push('Explicit prior approval/current phase boundary required');
}

if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exitCode = 1;
} else {
  const textCount = files.filter((p) => !['.png', '.ico'].includes(extname(p))).length;
  console.log(`PASS: ${required.length} required foundation files, ${linkCount} local Markdown targets, package/evidence checks; ${textCount} text files checked for whitespace and ${files.length - textCount} binary icons checked for size.`);
  console.log(`PASS: Phases 1–4 approved/closed; Phase 5 ${phase5Percentage}% (${phase5Passed}/6); Phases 6–10 blocked.`);
  console.log('Scope: repository validation only; tests/type/lint/build are separate commands.');
}
