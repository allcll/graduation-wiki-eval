#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { createPublicSummary, failedPublicSummary, renderPublicSummary } from './ci-summary.mjs';

const execute = promisify(execFile);
const engineRoot = fileURLToPath(new URL('../', import.meta.url));
const modes = ['sample', 'claude'];
const phases = ['prepare', 'run', 'review-template', 'report'];
const maxJobs = 50;

export function relativeInput(value) {
  if (typeof value !== 'string' || !value || /[\r\n\0\\]/u.test(value) || path.posix.isAbsolute(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Use a repository-relative input path');
  return value;
}

function positive(value, max, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max || (integer && !Number.isSafeInteger(number))) throw new Error('Invalid evaluation limit');
  return number;
}

export function parseOptions(argv) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
    mode: { type: 'string', default: 'sample' }, out: { type: 'string' },
    'data-root': { type: 'string' }, cases: { type: 'string' }, config: { type: 'string' },
    model: { type: 'string' }, 'max-budget-usd': { type: 'string' }, 'claude-version': { type: 'string' },
    'max-turns': { type: 'string', default: '12' }, effort: { type: 'string', default: 'medium' },
    timeout: { type: 'string', default: '120' },
  } });
  if (!modes.includes(values.mode) || !values.out) throw new Error('Specify a mode and a fresh output directory');
  const common = { mode: values.mode, out: path.resolve(values.out), dataRoot: path.resolve(values['data-root'] ?? process.cwd()) };
  if (values.mode === 'sample') {
    if (['cases', 'config', 'model', 'max-budget-usd', 'claude-version'].some(key => values[key] !== undefined)) {
      throw new Error('Sample mode always uses the public fixture');
    }
    return common;
  }
  const model = values.model;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$/u.test(model) ||
      !/\d/u.test(model) || /latest/iu.test(model) || ['sonnet', 'opus', 'haiku', 'default', 'opusplan'].includes(model.toLowerCase())) {
    throw new Error('Use an explicit model ID');
  }
  const cliVersion = values['claude-version'];
  if (typeof cliVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(cliVersion)) throw new Error('Pin a numeric Claude Code version');
  const version = cliVersion.split('.').map(Number);
  if (version[0] < 2 || (version[0] === 2 && (version[1] < 1 || (version[1] === 1 && version[2] < 322)))) {
    throw new Error('Claude Code 2.1.322 or newer is required');
  }
  const effort = values.effort;
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error('Invalid effort');
  return { ...common, cases: relativeInput(values.cases), config: relativeInput(values.config), model, cliVersion,
    budgetUsd: positive(values['max-budget-usd'], 100), maxTurns: positive(values['max-turns'], 100, true),
    effort, timeoutSeconds: positive(values.timeout, 600) };
}

function isWithin(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function containedPath(root, relative) {
  relativeInput(relative);
  const base = await realpath(root);
  const file = await realpath(path.resolve(base, relative));
  if (!isWithin(base, file)) throw new Error('Input path escapes the data checkout');
  return file;
}

export function modelConfig(config, options) {
  // Metadata describes the actual invocation, not labels supplied by a caller.
  return { ...config, model: options.model, execution: 'real',
    model_config: JSON.stringify({ budget_usd: options.budgetUsd, max_turns: options.maxTurns,
      effort: options.effort, timeout_seconds: options.timeoutSeconds }),
    tools: 'Read,Grep,Glob; native-skills-disabled',
    runtime: `node-${process.versions.node};claude-code-${options.cliVersion}`,
    timeout: options.timeoutSeconds + 30 };
}

export function buildCommands(options, directory = options.out) {
  const raw = path.resolve(directory, 'raw');
  const cli = path.join(engineRoot, 'dist/cli.js');
  const cases = path.join(raw, 'cases.jsonl');
  const config = path.join(raw, 'runner-config.json');
  const experiment = path.join(raw, 'experiment');
  const plan = path.join(experiment, 'plan.json');
  const runs = path.join(experiment, 'runs.jsonl');
  const adapter = options.mode === 'sample'
    ? [process.execPath, path.join(engineRoot, 'dist/fixture-agent.js')]
    : [process.execPath, path.join(engineRoot, 'dist/adapters/claude.js'), '--model', options.model,
      '--max-budget-usd', String(options.budgetUsd), '--max-turns', String(options.maxTurns),
      '--effort', options.effort, '--timeout', String(options.timeoutSeconds)];
  return [
    [cli, 'prepare', '--cases', cases, '--config', config, '--out', experiment],
    [cli, 'run', '--plan', plan, '--', ...adapter],
    [cli, 'review-template', '--cases', cases, '--runs', runs, '--plan', plan, '--out', path.join(raw, 'reviews.jsonl')],
    [cli, 'report', '--cases', cases, '--runs', runs, '--plan', plan, '--out', path.join(raw, 'report.json')],
  ];
}

async function prepareInputs(options) {
  const { parseCases } = await import('../dist/schema.js');
  const { parseJson, readRecords } = await import('../dist/json.js');
  let cases, config;
  if (options.mode === 'sample') {
    cases = parseCases(await readRecords(path.join(engineRoot, 'sample/cases.jsonl')));
    config = { context_root: path.join(engineRoot, 'sample/context'),
      sources: ['original.md'], wiki: ['wiki.md'], skills: ['SKILL.md'],
      conditions: ['A', 'B', 'C'], repeats: 1, execution: 'synthetic', timeout: 30,
      model: 'fixture-no-model', model_config: 'none', prompt: 'sample-output-v1',
      code: 'none', data: 'fictional-v1', tools: 'fixture-stdio', runtime: `node-${process.versions.node}`,
      instructions: '답변 가능하면 facts는 remaining_credits 정수만 담는다. 추가 질문이면 required_fields 배열, 근거 충돌이면 reason: source_conflict만 담는다. 모든 조건에 동일한 형식이다.' };
  } else {
    if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error('A model API key is required');
    const casesPath = await containedPath(options.dataRoot, options.cases);
    const configPath = await containedPath(options.dataRoot, options.config);
    cases = parseCases(await readRecords(casesPath));
    const supplied = parseJson(await readFile(configPath, 'utf8'));
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || typeof supplied.context_root !== 'string') throw new Error('Invalid run configuration');
    const contextRoot = await realpath(path.resolve(path.dirname(configPath), supplied.context_root));
    if (!isWithin(await realpath(options.dataRoot), contextRoot)) throw new Error('Context root escapes the data checkout');
    config = modelConfig({ ...supplied, context_root: contextRoot }, options);
    const version = await execute('claude', ['--version'], { timeout: 10_000, maxBuffer: 4096 });
    if (!new RegExp(`^${options.cliVersion.replaceAll('.', '\\.')}\\b`, 'u').test(version.stdout.trim())) throw new Error('Installed Claude Code version differs from its pin');
  }
  const planned = cases.length * (config.conditions?.length ?? 3) * (config.repeats ?? 1);
  if (!Number.isSafeInteger(planned) || planned < 1 || planned > maxJobs) throw new Error('This CI entry supports at most 50 planned jobs');
  return { cases, config };
}

async function runPhase(args, phase, raw) {
  try {
    const result = await execute(process.execPath, args, { cwd: engineRoot, maxBuffer: 8 * 1024 * 1024 });
    await writeFile(path.join(raw, `${phase}.stdout.txt`), result.stdout);
    await writeFile(path.join(raw, `${phase}.stderr.txt`), result.stderr);
    return 0;
  } catch (error) {
    await writeFile(path.join(raw, `${phase}.stdout.txt`), typeof error.stdout === 'string' ? error.stdout : '');
    await writeFile(path.join(raw, `${phase}.stderr.txt`), typeof error.stderr === 'string' ? error.stderr : '');
    return 1;
  }
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseOptions(argv); } catch { console.error('Invalid evaluation invocation. See docs/actions.md.'); return 2; }
  const raw = path.join(options.out, 'raw'), publicDir = path.join(options.out, 'public');
  // Refuse reuse: raw records and reviewer files must not be silently replaced.
  try {
    await mkdir(path.dirname(options.out), { recursive: true });
    await mkdir(options.out);
    await mkdir(raw);
    await mkdir(publicDir);
  } catch { console.error('A fresh writable output directory is required.'); return 2; }
  let summary = failedPublicSummary(options.mode);
  let exitCode = 1;
  try {
    const { cases, config } = await prepareInputs(options);
    await writeFile(path.join(raw, 'cases.jsonl'), cases.map(item => JSON.stringify(item)).join('\n') + '\n');
    await writeFile(path.join(raw, 'runner-config.json'), JSON.stringify(config, null, 2) + '\n');
    const commands = buildCommands(options);
    let executionFailed = false;
    for (const [index, args] of commands.entries()) {
      const code = await runPhase(args, phases[index], raw);
      if (code !== 0) {
        executionFailed = true;
        if (phases[index] !== 'run') throw new Error('Evaluation phase failed');
      }
    }
    const report = JSON.parse(await readFile(path.join(raw, 'report.json'), 'utf8'));
    summary = await createPublicSummary(report, options.mode, executionFailed ? 'failed' : 'completed');
    exitCode = executionFailed ? 1 : 0;
  } catch {
    // Errors and model responses can contain private data. Detailed CLI logs stay local.
    console.error('Evaluation did not complete. Inspect the local raw output; no private details were published.');
  }
  await writeFile(path.join(publicDir, 'public-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const markdown = renderPublicSummary(summary);
  await writeFile(path.join(publicDir, 'public-summary.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(JSON.stringify(summary));
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
