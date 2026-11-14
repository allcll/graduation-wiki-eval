#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseCases, parseRuns, parseReviews, conditionSchema, splitSchema } from './schema.js';
import type { Condition, EvaluationPlan, Report, Run } from './schema.js';
import { digest, readJson, readRecords, writeRecords } from './json.js';
import { evaluate, makePlan, parsePlan } from './evaluate.js';
import { compareReports } from './compare.js';
import { prepare, runPlan, runnerPlanSchema } from './runner.js';
import { writeJson, isMain, errorMessage } from './io.js';
import { writeReport } from './reporting.js';
import type { SavedReport } from './reporting.js';
import { writeReviewBundle } from './review-guide.js';
import { createOracleWorkspace, validateOracleWorkspace, exportOracleCases } from './oracle-review.js';

const commands = ['validate', 'oracle-init', 'oracle-export', 'plan', 'prepare', 'run', 'review-template', 'report', 'compare', 'demo'] as const;
const commandSchema = z.enum(commands);
const flags = {
  cases: { type: 'string' }, runs: { type: 'string' }, reviews: { type: 'string' },
  plan: { type: 'string' }, config: { type: 'string' }, out: { type: 'string' },
  baseline: { type: 'string' }, candidate: { type: 'string' },
  conditions: { type: 'string' }, repeats: { type: 'string' },
  condition: { type: 'string' }, split: { type: 'string' }, check: { type: 'boolean' },
  workspace: { type: 'string' }, title: { type: 'string' }, 'approved-only': { type: 'boolean' },
} as const;
const allowed: Record<z.infer<typeof commandSchema>, readonly (keyof typeof flags)[]> = {
  validate: ['cases'], plan: ['cases', 'conditions', 'repeats', 'out'], prepare: ['cases', 'config', 'out'],
  run: ['plan'], 'review-template': ['cases', 'runs', 'plan', 'out'], report: ['cases', 'runs', 'reviews', 'plan', 'out', 'check', 'condition'],
  compare: ['baseline', 'candidate', 'condition', 'split', 'out'], demo: ['out'],
  'oracle-init': ['cases', 'out', 'title'], 'oracle-export': ['cases', 'workspace', 'out', 'approved-only'],
};
const HELP = `grad-eval <command> [options]

  validate        --cases FILE
  oracle-init     --cases FILE --out NEW_FILE.json [--title TEXT]
  oracle-export   --cases FILE --workspace FILE --out NEW_FILE.jsonl [--approved-only]
  plan            --cases FILE --out FILE [--conditions A,B,C] [--repeats 1]
  prepare         --cases FILE --config FILE --out NEW_DIRECTORY
  run             --plan FILE -- COMMAND [ARGUMENTS...]
  review-template --cases FILE --runs FILE --plan FILE --out NEW_FILE.jsonl
  report          --cases FILE --runs FILE --plan FILE --out FILE [--reviews FILE] [--check [--condition C]]
  compare         --baseline FILE --candidate FILE --out FILE [--condition C] [--split holdout]
  demo            [--out NEW_DIRECTORY]

demo does not call a model. run executes the specified adapter and may incur API costs.
report --check requires all planned conditions to pass unless --condition selects one gate.
The saved report always contains every planned condition.
`;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function loadPlan(path: string, runs: Run[]): Promise<EvaluationPlan> {
  const value = await readJson(path);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Plan must be a JSON object');
  if (!Object.hasOwn(value, 'evaluation_plan')) return parsePlan(value);
  const plan = runnerPlanSchema.parse(value);
  const { plan_sha256: checksum, ...unsigned } = plan;
  if (checksum !== digest(unsigned)) throw new Error('Runner plan checksum mismatch');
  for (const run of runs) {
    if (run.plan_sha256 !== checksum) throw new Error(`Run does not belong to the supplied runner plan: ${run.run_id}`);
  }
  return parsePlan(plan.evaluation_plan);
}

export async function demo(out: string): Promise<Report> {
  const sample = fileURLToPath(new URL('../sample/', import.meta.url));
  const cases = parseCases(await readRecords(resolve(sample, 'cases.jsonl')));
  // mkdir without recursive refuses existing output, including previous failures.
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out);
  const plan = await prepare(cases, {
    context_root: resolve(sample, 'context'), sources: ['original.md'], wiki: ['wiki.md'], skills: ['SKILL.md'],
    conditions: ['A', 'B', 'C'], repeats: 1, timeout: 10, execution: 'synthetic',
    model: 'fixture-no-model', model_config: 'none', prompt: 'sample-output-v1', code: 'none', data: 'fictional-v1',
    tools: 'fixture-stdio', runtime: `node-${process.versions.node}`,
    instructions: '답변 가능하면 facts는 remaining_credits 정수만 담는다. 추가 질문이면 required_fields 배열, 근거 충돌이면 reason: source_conflict만 담는다. 모든 질문과 조건에 동일한 형식이다.',
  }, resolve(out, 'experiment'));
  const fixture = fileURLToPath(new URL('../dist/fixture-agent.js', import.meta.url));
  const runs = await runPlan(resolve(out, 'experiment/plan.json'), [process.execPath, fixture]);
  const result = evaluate(cases, runs, [], plan.evaluation_plan);
  await writeRecords(resolve(out, 'cases.jsonl'), cases);
  await writeReport(resolve(out, 'report.json'), result);
  return result;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (!argv.length || argv[0] === '--help' || argv[1] === '--help') { process.stdout.write(HELP); return 0; }
  if (argv[0] === '--version') { process.stdout.write('0.4.0\n'); return 0; }
  let reportPath: string | undefined;
  let protectedPaths: string[] = [];
  try {
    const command = commandSchema.parse(argv[0]);
    const tail = argv.slice(1);
    const delimiter = tail.indexOf('--');
    const adapter = delimiter < 0 ? [] : tail.slice(delimiter + 1);
    if (delimiter >= 0 && command !== 'run') throw new Error('-- COMMAND is only supported by run');
    const values = parseArgs({ args: delimiter < 0 ? tail : tail.slice(0, delimiter), options: flags, strict: true, allowPositionals: false }).values;
    for (const key of Object.keys(values)) if (!allowed[command].some(flag => flag === key)) throw new Error(`Unsupported option for ${command}: --${key}`);
    let checkCondition: Condition | undefined;
    if (command === 'report' && values.condition !== undefined) {
      if (!values.check) throw new Error('report --condition requires --check');
      checkCondition = conditionSchema.parse(values.condition);
    }
    protectedPaths = [values.cases, values.runs, values.reviews, values.plan, values.baseline, values.candidate]
      .filter((path): path is string => typeof path === 'string').map(path => resolve(path));
    if (command === 'report' || command === 'compare') {
      const out = required(values.out, 'out');
      if (!out.endsWith('.json')) throw new Error('Report output must use a .json extension');
      if ([resolve(out), resolve(out.slice(0, -5) + '.md')].some(path => protectedPaths.includes(path))) throw new Error('Report output must not overwrite an input file');
      reportPath = out;
    }
    let result: unknown;
    switch (command) {
      case 'validate': {
        const cases = parseCases(await readRecords(required(values.cases, 'cases')));
        result = { valid: true, cases: cases.length, dataset_sha256: makePlan(cases).dataset_sha256 };
        break;
      }
      case 'oracle-init': {
        const out = required(values.out, 'out');
        if (!out.endsWith('.json')) throw new Error('Oracle workspace must use a .json extension');
        const workspace = await createOracleWorkspace(await readRecords(required(values.cases, 'cases')), values.title);
        await writeJson(out, workspace, true);
        result = { workspace: resolve(out), cases: workspace.entries.length, status: 'requires human review' };
        break;
      }
      case 'oracle-export': {
        const out = required(values.out, 'out');
        if (!out.endsWith('.jsonl')) throw new Error('Oracle cases must use a .jsonl extension');
        const workspace = await validateOracleWorkspace(await readJson(required(values.workspace, 'workspace')),
          await readRecords(required(values.cases, 'cases')));
        const cases = await exportOracleCases(workspace, { approvedOnly: values['approved-only'] ?? false });
        await mkdir(dirname(resolve(out)), { recursive: true });
        await writeFile(out, cases.map(item => JSON.stringify(item)).join('\n') + '\n', { encoding: 'utf8', flag: 'wx' });
        result = { cases: cases.length, omitted: workspace.entries.length - cases.length, path: resolve(out), next: 'prepare a new evaluation plan' };
        break;
      }
      case 'plan': {
        const conditions = z.array(conditionSchema).parse((values.conditions ?? 'A,B,C').split(','));
        result = makePlan(parseCases(await readRecords(required(values.cases, 'cases'))), conditions, Number(values.repeats ?? '1'));
        await writeJson(required(values.out, 'out'), result, true);
        break;
      }
      case 'prepare': {
        const configPath = required(values.config, 'config');
        const config = await readJson(configPath);
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Run config must be a JSON object');
        const root = z.string().min(1).parse(config['context_root']);
        const resolvedRoot = isAbsolute(root) ? root : resolve(dirname(configPath), root);
        const out = required(values.out, 'out');
        const plan = await prepare(parseCases(await readRecords(required(values.cases, 'cases'))), { ...config, context_root: resolvedRoot }, out);
        result = { plan: resolve(out, 'plan.json'), evaluation_plan: plan.evaluation_plan };
        break;
      }
      case 'run': {
        if (!adapter.length) throw new Error('An adapter command is required after --');
        const path = required(values.plan, 'plan');
        const runs = await runPlan(path, adapter);
        const errors = runs.filter(run => run.status === 'error').length;
        console.log(JSON.stringify({ runs: runs.length, errors, path: resolve(dirname(path), 'runs.jsonl') }, null, 2));
        return errors ? 1 : 0;
      }
      case 'review-template': {
        const casesPath = required(values.cases, 'cases');
        const planPath = required(values.plan, 'plan');
        const out = required(values.out, 'out');
        if (!out.endsWith('.jsonl')) throw new Error('Review output must use a .jsonl extension');
        if ([resolve(out), resolve(out.slice(0, -6) + '.md')].some(path => protectedPaths.includes(path))) throw new Error('Review output must not overwrite an input file');
        const cases = parseCases(await readRecords(casesPath));
        const runs = parseRuns(await readRecords(required(values.runs, 'runs')));
        result = await writeReviewBundle(cases, runs, await loadPlan(planPath, runs), out);
        break;
      }
      case 'report': {
        const runs = parseRuns(await readRecords(required(values.runs, 'runs')));
        const report = evaluate(parseCases(await readRecords(required(values.cases, 'cases'))), runs,
          values.reviews ? parseReviews(await readRecords(values.reviews)) : [], await loadPlan(required(values.plan, 'plan'), runs));
        if (checkCondition !== undefined && !report.plan.conditions.includes(checkCondition)) throw new Error(`Condition ${checkCondition} is not in the evaluation plan`);
        const checkedConditions = checkCondition === undefined ? report.plan.conditions : [checkCondition];
        await writeReport(required(values.out, 'out'), report);
        console.log(JSON.stringify(summary(report, values.out, values.check ? checkedConditions : undefined), null, 2));
        return values.check && checkedConditions.some(condition => report.gates[condition]?.gate !== 'PASS') ? 1 : 0;
      }
      case 'compare': {
        const report = compareReports(await readJson(required(values.baseline, 'baseline')), await readJson(required(values.candidate, 'candidate')),
          conditionSchema.parse(values.condition ?? 'C'), splitSchema.parse(values.split ?? 'holdout'));
        await writeReport(required(values.out, 'out'), report);
        result = report;
        break;
      }
      case 'demo': {
        const out = values.out ?? 'artifacts/demo';
        result = summary(await demo(out), resolve(out, 'report.json'));
        break;
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error: unknown) {
    const failure: SavedReport = { gate: 'INCONCLUSIVE', input_error: errorMessage(error) };
    if (reportPath) {
      try { await writeReport(reportPath, failure); }
      catch { /* stderr still reports the failure if the target is unwritable. */ }
    }
    console.error(JSON.stringify(failure));
    return 2;
  }
}

function summary(report: Report, path: string | undefined, checkedConditions?: Condition[]): unknown {
  return { report: path, label: report.label, counts: report.overall_counts,
    gates: Object.fromEntries(Object.entries(report.gates).map(([condition, gate]) => [condition, gate.gate])),
    ...(checkedConditions ? { checked_conditions: checkedConditions } : {}) };
}

if (isMain(import.meta.url)) process.exitCode = await main();
