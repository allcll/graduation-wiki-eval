import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'grad-package-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

try {
  const packed = JSON.parse(run('npm', ['pack', '--silent', '--json', '--pack-destination', temporary], root));
  assert.equal(packed.length, 1);
  const packageInfo = packed[0];
  assert.ok(packageInfo.files.some(file => file.path === 'dist/index.d.ts'));
  assert.ok(packageInfo.files.some(file => file.path === 'sample/cases.jsonl'));
  assert.ok(packageInfo.files.every(file => !/\.(?:py|whl)$/.test(file.path)), 'Old Python artifacts must not ship');
  const installed = join(temporary, 'installed');
  await mkdir(installed);
  // Dependencies were fetched by npm ci; an install smoke test needs no new network calls.
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--prefix', installed, join(temporary, packageInfo.filename)], temporary);
  const binary = join(installed, 'node_modules/.bin/grad-eval');
  assert.equal(run(binary, ['--version'], installed).trim(), '0.2.0');
  run(binary, ['demo', '--out', 'demo'], installed);
  run(binary, ['report', '--cases', 'demo/cases.jsonl', '--runs', 'demo/experiment/runs.jsonl',
    '--plan', 'demo/experiment/plan.json', '--out', 'demo/rechecked.json'], installed);
  run(join(installed, 'node_modules/.bin/grad-eval-claude'), ['--help'], installed);
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { evaluate, parseCases, readRecords, makePlan } from 'graduation-wiki-eval';
    const cases = parseCases(await readRecords('demo/cases.jsonl'));
    const report = evaluate(cases, [], [], makePlan(cases));
    assert.equal(report.overall_counts.missing, 9);
    assert.equal(report.gates.C.gate, 'INCONCLUSIVE');
  `], installed);
  console.log('Installed CLI, Claude entry point, library exports, and bundled demo passed.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
