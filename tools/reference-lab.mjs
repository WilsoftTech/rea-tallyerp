import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Normal application launch only: no attachment, injection, licence access,
// production configuration changes or proprietary code/asset copying.
const launch = process.argv.slice(2);
if (launch.some((arg) => arg !== '--launch') || launch.length > 1) {
  throw new Error('Usage: node tools/reference-lab.mjs [--launch]');
}
if (process.platform !== 'win32') throw new Error('Reference lab requires Windows.');
const root = fileURLToPath(new URL('../', import.meta.url));
const lab = resolve(root, 'local-data/reference-lab');
const configDirectory = resolve(lab, 'config');
const manifestPath = resolve(lab, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const executable = 'C:\\Tally.ERP9\\tally.exe';
const expectedHash = 'be0ba3120ae514d485a059d5cf07018dd8a67ebcd289dd6e66bd113db6581c54';
for (const path of [lab, configDirectory, resolve(lab, 'data'), resolve(lab, 'exports')]) {
  if ((await realpath(path)).toLowerCase() !== path.toLowerCase()) {
    throw new Error('Lab directory resolves through an unexpected filesystem link.');
  }
}
const iniPath = resolve(configDirectory, 'tally.ini');
if ((await realpath(iniPath)).toLowerCase() !== iniPath.toLowerCase()) {
  throw new Error('Lab INI resolves through an unexpected filesystem link.');
}
const expectedLines = [
  '[TALLY]', `Data = ${resolve(lab, 'data')}`, `Export Path = ${resolve(lab, 'exports')}`,
  'Default Companies = No', 'User TDL = No',
];
const actualLines = (await readFile(iniPath, 'utf8')).split(/\r?\n/)
  .map((line) => line.trim()).filter((line) => line && !line.startsWith(';'));
if (JSON.stringify(actualLines) !== JSON.stringify(expectedLines)) {
  throw new Error('Candidate INI differs from the bounded lab profile; review before launch.');
}
const digest = createHash('sha256').update(await readFile(executable)).digest('hex');
if (digest !== expectedHash) throw new Error('Reference executable identity changed.');
const processes = JSON.parse(execFileSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  'ConvertTo-Json -InputObject @(Get-Process -Name tally -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowHandle) -Compress',
], { encoding: 'utf8', windowsHide: true }).trim());
const plan = {
  status: processes.length ? 'BLOCKED_EXISTING_TALLY_PROCESSES' : 'READY_FOR_CONTROLLED_LAUNCH',
  executable, workingDirectory: configDirectory, configuration: iniPath,
  arguments: ['/NOINILOAD', '/NOINITDL'], existingProcesses: processes,
  runtimeIsolationVerified: false,
  nextObservation: 'Verify the active data/config/export paths before selecting or creating any company.',
};
console.log(JSON.stringify(plan, null, 2));
if (processes.length) {
  process.exitCode = 2;
} else if (launch.length) {
  // Explicit --launch opens the interactive application the operator must observe.
  const child = spawn(executable, plan.arguments, {
    cwd: configDirectory, stdio: 'ignore', detached: false, windowsHide: false,
  });
  const exited = once(child, 'exit');
  await once(child, 'spawn');
  manifest.state = 'LAUNCHED_AWAITING_OPERATOR_PATH_VERIFICATION';
  manifest.runtimeLaunched = true;
  manifest.launchedProcessId = child.pid;
  manifest.runtimeMode = 'reuse-installed-executable';
  manifest.runtimeIsolationVerified = false;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('Launch requested. Keeping the tool session alive until this process exits.');
  console.log('Verify lab paths in the UI; this is not isolation or workflow verification.');
  const [exitCode, signal] = await exited;
  // Manual observations can arrive while the process runs. Preserve them rather
  // than overwriting the manifest with the snapshot read before launch.
  const finalManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  finalManifest.state = finalManifest.operatorPathCheck === 'CONFIRMED_BY_OWNER'
    ? 'PROCESS_EXITED_AFTER_OWNER_PATH_CONFIRMATION'
    : 'PROCESS_EXITED_WITHOUT_RECORDED_PATH_VERIFICATION';
  finalManifest.lastLaunchExitCode = exitCode;
  finalManifest.lastLaunchSignal = signal;
  await writeFile(manifestPath, `${JSON.stringify(finalManifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: finalManifest.state, processId: child.pid, exitCode, signal }));
  if (exitCode !== 0 || signal) process.exitCode = 1;
}
