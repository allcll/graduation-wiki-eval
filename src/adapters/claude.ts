#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { parseJson } from '../json.js';
import { runProcess, type ProcessResult } from '../process.js';
import { jsonValueSchema } from '../schema.js';

const groups = ['sources', 'wiki', 'skills'] as const;
const minimumVersion = [2, 1, 322] as const;
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const movingAliases = new Set(['sonnet', 'opus', 'haiku', 'fable', 'default', 'opusplan']);

const requestSchema = z.strictObject({
  job_id: z.string().trim().min(1),
  case_id: z.string().trim().min(1),
  condition: z.enum(['A', 'B', 'C']),
  question: z.string().refine((text) => text.trim().length > 0),
  inputs: z.record(z.string(), jsonValueSchema),
  context: z.strictObject({
    sources: z.array(z.string()).min(1),
    wiki: z.array(z.string()),
    skills: z.array(z.string()),
  }),
  instructions: z.string(),
  output_contract: z.record(z.string(), jsonValueSchema),
});

const answerSchema = z.strictObject({
  action: z.enum(['answer', 'clarify', 'escalate']),
  facts: z.record(z.string(), jsonValueSchema),
  answer_text: z.string().refine((text) => text.trim().length > 0),
  citations: z.array(z.string()),
});

const resultSchema = z.looseObject({
  type: z.literal('result'),
  subtype: z.literal('success'),
  is_error: z.literal(false),
  structured_output: answerSchema,
});

const optionsSchema = z.strictObject({
  model: z.string().trim().min(1).refine(
    (model) => !model.startsWith('-') && !movingAliases.has(model.toLowerCase().split('[')[0] ?? ''),
    'Use an explicit model ID, not a moving alias',
  ),
  budgetUsd: z.number().finite().positive(),
  maxTurns: z.number().int().positive().default(12),
  effort: z.enum(efforts).default('medium'),
  timeoutSeconds: z.number().finite().positive().default(120),
  executable: z.string().trim().min(1).default('claude'),
});

export type ClaudeRequest = z.infer<typeof requestSchema>;
export type ClaudeAnswer = z.infer<typeof answerSchema>;
export type ClaudeOptions = z.input<typeof optionsSchema>;
export interface ClaudeDependencies {
  run?: typeof runProcess;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class ClaudeAdapterError extends Error {
  override name = 'ClaudeAdapterError';
}

const outputJsonSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['answer', 'clarify', 'escalate'] },
    facts: { type: 'object' },
    answer_text: { type: 'string', minLength: 1 },
    citations: { type: 'array', items: { type: 'string' } },
  },
  required: ['action', 'facts', 'answer_text', 'citations'],
  additionalProperties: false,
};

const instructions = `Answer the task using only the supplied input and listed context files.
Read the relevant original sources and check the policy's target and exceptions.
If procedural documents are listed under skills, choose which are relevant and read
them as documents. Native Claude Code skills are disabled in this evaluation.
Do not read unlisted files, run commands, modify files, or contact external tools.
If required information is missing, ask for it; if authoritative sources conflict
without a resolution, explain the conflict and request human confirmation.
Return the complete user-facing answer in answer_text and source locations in
citations. Use the facts field names specified by the task; do not invent a
confidence score or a self-grading verdict. Return the required structured output.`;

export async function validateRequest(value: unknown, cwd: string): Promise<ClaudeRequest> {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new ClaudeAdapterError('Invalid runner request');
  const request = parsed.data;
  if (request.condition === 'A' && (request.context.wiki.length > 0 || request.context.skills.length > 0)) {
    throw new ClaudeAdapterError('A cannot include WIKI or Skill files');
  }
  if (request.condition === 'B' && request.context.skills.length > 0) {
    throw new ClaudeAdapterError('B cannot include Skill files');
  }
  if (request.condition !== 'A' && request.context.wiki.length === 0) {
    throw new ClaudeAdapterError('B/C require WIKI files');
  }
  if (request.condition === 'C' && request.context.skills.length === 0) {
    throw new ClaudeAdapterError('C requires Skill files');
  }
  const root = await realpath(cwd);
  for (const group of groups) {
    const paths = request.context[group];
    if (new Set(paths).size !== paths.length) throw new ClaudeAdapterError('Duplicate context paths');
    for (const file of paths) {
      const parts = file.split('/');
      if (path.posix.isAbsolute(file) || file.includes('\\') || parts.some((part) => ['', '.', '..'].includes(part)) ||
          parts[0] !== 'context' || parts[1] !== group) {
        throw new ClaudeAdapterError('Invalid context path');
      }
      const resolved = await realpath(path.join(root, file));
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) {
        throw new ClaudeAdapterError('Context file escapes the job directory');
      }
    }
  }
  return request;
}

export function buildCommand(value: ClaudeOptions): string[] {
  const parsed = optionsSchema.safeParse(value);
  if (!parsed.success) throw new ClaudeAdapterError('An explicit model ID and positive finite limits are required');
  const options = parsed.data;
  return [options.executable, '--bare', '--restricted', '-p', '--disable-slash-commands',
    '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob', '--disallowedTools', 'mcp__*',
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--no-chrome', '--setting-sources', '',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
    '--output-format', 'json', '--json-schema', JSON.stringify(outputJsonSchema), '--model', options.model,
    '--effort', options.effort, '--max-budget-usd', String(options.budgetUsd), '--max-turns', String(options.maxTurns),
    '--append-system-prompt', instructions];
}

function requireSuccess(result: ProcessResult, phase: string): void {
  if (result.timedOut) throw new ClaudeAdapterError(`${phase} timed out`);
  if (result.outputLimitExceeded) throw new ClaudeAdapterError(`${phase} exceeded the output limit`);
  if (result.exitCode !== 0) throw new ClaudeAdapterError(`${phase} exited unsuccessfully`);
}

function requireVersion(stdout: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)\b/u.exec(stdout.trim());
  const version = z.tuple([z.number().int(), z.number().int(), z.number().int()]).safeParse(match?.slice(1).map(Number));
  if (!version.success) throw new ClaudeAdapterError('Could not determine Claude Code version');
  const [major, minor, patch] = version.data;
  const [expectedMajor, expectedMinor, expectedPatch] = minimumVersion;
  if (major < expectedMajor || (major === expectedMajor && minor < expectedMinor) ||
      (major === expectedMajor && minor === expectedMinor && patch < expectedPatch)) {
    throw new ClaudeAdapterError('Claude Code 2.1.322 or newer is required');
  }
}

export function parseResponse(stdout: string): ClaudeAnswer {
  let value: unknown;
  try {
    value = parseJson(stdout);
  } catch {
    throw new ClaudeAdapterError('Claude did not return valid JSON');
  }
  const result = resultSchema.safeParse(value);
  if (!result.success) throw new ClaudeAdapterError('Claude did not return successful structured output');
  return result.data.structured_output;
}

export async function invokeClaude(value: unknown, rawOptions: ClaudeOptions, dependencies: ClaudeDependencies = {}): Promise<ClaudeAnswer> {
  const options = optionsSchema.parse(rawOptions);
  const cwd = dependencies.cwd ?? process.cwd();
  const env = dependencies.env ?? process.env;
  const run = dependencies.run ?? runProcess;
  const request = await validateRequest(value, cwd);
  const command = buildCommand(options);
  if (!env['ANTHROPIC_API_KEY']?.trim()) {
    throw new ClaudeAdapterError('ANTHROPIC_API_KEY is required; bare mode does not use subscription login');
  }
  const version = await run([options.executable, '--version'], { cwd, input: '', timeoutMs: 10_000, env, forwardSignals: true });
  requireSuccess(version, 'Claude version check');
  requireVersion(version.stdout);
  const configDir = await mkdtemp(path.join(tmpdir(), 'gradwiki-claude-'));
  try {
    const result = await run(command, {
      cwd,
      input: JSON.stringify({ question: request.question, inputs: request.inputs, context: request.context,
        instructions: request.instructions, output_contract: request.output_contract }),
      timeoutMs: options.timeoutSeconds * 1_000,
      forwardSignals: true,
      env: { ...env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_EFFORT_LEVEL: options.effort,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
        MAX_STRUCTURED_OUTPUT_RETRIES: '1' },
    });
    requireSuccess(result, 'Claude Code');
    return parseResponse(result.stdout);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const input: AsyncIterable<unknown> = process.stdin;
  for await (const chunk of input) {
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) throw new ClaudeAdapterError('Invalid stdin data');
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    bytes += buffer.length;
    if (bytes > 1024 * 1024) throw new ClaudeAdapterError('Request exceeds 1 MiB');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const usage = 'Usage: grad-eval-claude --model MODEL_ID --max-budget-usd AMOUNT [--max-turns 12] [--effort medium] [--timeout 120]\n';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: {
      help: { type: 'boolean', short: 'h' }, model: { type: 'string' },
      'max-budget-usd': { type: 'string' }, 'max-turns': { type: 'string' },
      effort: { type: 'string' }, timeout: { type: 'string' },
    }, strict: true, allowPositionals: false });
    if (values.help) { process.stdout.write(usage); return 0; }
    const options = optionsSchema.safeParse({ model: values.model, budgetUsd: Number(values['max-budget-usd']),
      maxTurns: values['max-turns'] === undefined ? 12 : Number(values['max-turns']),
      effort: values.effort ?? 'medium', timeoutSeconds: values.timeout === undefined ? 120 : Number(values.timeout) });
    if (!options.success) throw new ClaudeAdapterError('Specify a model ID and positive finite limits. Use --help for syntax.');
    const output = await invokeClaude(parseJson(await readStdin()), options.data);
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  } catch (error: unknown) {
    // Upstream stderr and parser diagnostics can contain prompts or credentials.
    const message = error instanceof ClaudeAdapterError ? error.message : 'Request or process validation failed';
    process.stderr.write(`Claude adapter failed: ${message}\n`);
    return 2;
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try { return fileURLToPath(import.meta.url) === realpathSync(entry); } catch { return false; }
}

if (isEntryPoint()) process.exitCode = await main();
