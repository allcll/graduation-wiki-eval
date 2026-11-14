import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
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
  assert.ok(packageInfo.files.some(file => file.path === 'dist/oracle-ui.bundle.js'));
  assert.ok(packageInfo.files.some(file => file.path === 'datasets/graduation-2026-2/v1/manifest.json'));
  assert.ok(packageInfo.files.every(file => !file.path.endsWith('.pdf')), 'Downloaded handbooks must not ship');
  assert.ok(packageInfo.files.every(file => !/\.(?:py|whl)$/.test(file.path)), 'Old Python artifacts must not ship');
  const installed = join(temporary, 'installed');
  await mkdir(installed);
  // npm ci caches tarballs but may not cache registry metadata needed for a fresh install.
  run('npm', ['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--prefix', installed, join(temporary, packageInfo.filename)], temporary);
  const binary = join(installed, 'node_modules/.bin/grad-eval');
  const shared = JSON.parse(run(binary, ['dataset-check', '--root', join(installed, 'node_modules/graduation-wiki-eval'),
    '--manifest', 'datasets/graduation-2026-2/v1/manifest.json', '--metadata-only'], installed));
  assert.equal(shared.cases, 112);
  assert.equal(shared.source_assets_verified, false);
  assert.equal(run(binary, ['--version'], installed).trim(), '0.4.0');
  run(binary, ['demo', '--out', 'demo'], installed);
  run(binary, ['oracle-review', '--cases', 'demo/cases.jsonl', '--out', 'oracle/review.html'], installed);
  const oracleHtml = await readFile(join(installed, 'oracle/review.html'), 'utf8');
  assert.match(oracleHtml, /id="oracle-data"/);
  assert.doesNotMatch(oracleHtml, /<script\s+src=/);
  run(binary, ['report', '--cases', 'demo/cases.jsonl', '--runs', 'demo/experiment/runs.jsonl',
    '--plan', 'demo/experiment/plan.json', '--out', 'demo/rechecked.json'], installed);
  run(binary, ['review-template', '--cases', 'demo/cases.jsonl', '--runs', 'demo/experiment/runs.jsonl',
    '--plan', 'demo/experiment/plan.json', '--out', 'reviews/demo.jsonl'], installed);
  const reviews = (await readFile(join(installed, 'reviews/demo.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(reviews.length, 9);
  assert.ok(reviews.every(review => review.criterion_results.length >= 2 &&
    review.criterion_results.every(criterion => criterion.verdict === 'pending')));
  assert.match(await readFile(join(installed, 'reviews/demo.md'), 'utf8'), /평가자용 정답/);
  run(join(installed, 'node_modules/.bin/grad-eval-claude'), ['--help'], installed);
  run(join(installed, 'node_modules/.bin/grad-eval-openai'), ['--help'], installed);
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { evaluate, parseCases, readRecords, makePlan } from 'graduation-wiki-eval';
    const cases = parseCases(await readRecords('demo/cases.jsonl'));
    const report = evaluate(cases, [], [], makePlan(cases));
    assert.equal(report.overall_counts.missing, 9);
    assert.equal(report.gates.C.gate, 'INCONCLUSIVE');
  `], installed);
  console.log('Installed CLI, oracle HTML, review guide, Claude entry point, library exports, and bundled demo passed.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
