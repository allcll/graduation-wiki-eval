#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { digest, parseJson } from '../json.js';
import { runProcess, type ProcessResult } from '../process.js';
import { answerSchema, validateRequest, type AdapterRequest } from './request.js';
import { summarizeClaudeStream } from './claude-trace.js';
export { validateRequest } from './request.js';

const minimumVersion = [2, 1, 322] as const;
const efforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const movingAliases = new Set(['sonnet', 'opus', 'haiku', 'fable', 'default', 'opusplan']);

const resultSchema = z.looseObject({
  type: z.literal('result'),
  subtype: z.literal('success'),
  is_error: z.literal(false),
  structured_output: answerSchema,
});

const optionsSchema = z.strictObject({
  auth: z.enum(['api-key', 'subscription']).default('api-key'),
  usageCreditsDisabled: z.boolean().default(false),
  model: z.string().trim().min(1).refine(
    (model) => !model.startsWith('-') && !movingAliases.has(model.toLowerCase().split('[')[0] ?? ''),
    'Use an explicit model ID, not a moving alias',
  ),
  budgetUsd: z.number().finite().positive().optional(),
  maxTurns: z.number().int().positive().default(12),
  effort: z.enum(efforts).default('medium'),
  timeoutSeconds: z.number().finite().positive().default(120),
  traceTools: z.boolean().default(false),
  requireSkillReads: z.boolean().default(false),
  executable: z.string().trim().min(1).default('claude'),
}).superRefine((options, context) => {
  if (options.auth === 'api-key' && options.budgetUsd === undefined) {
    context.addIssue({ code: 'custom', message: 'API-key mode requires a budget' });
  }
  if (options.auth === 'subscription' && !options.usageCreditsDisabled) {
    context.addIssue({ code: 'custom', message: 'Confirm usage credits are disabled in the Claude account settings' });
  }
  if (options.requireSkillReads && !options.traceTools) {
    context.addIssue({ code: 'custom', message: 'Required Skill reads need --trace-tools' });
  }
});

const subscriptionSettings = JSON.stringify({ forceLoginMethod: 'claudeai', fastMode: false, disableAllHooks: true, fallbackModel: [] });
const subscriptionFlags = ['--safe-mode', '--restricted', '--setting-sources', '', '--settings', subscriptionSettings];
const subscriptionStatusSchema = z.looseObject({
  loggedIn: z.literal(true), authMethod: z.literal('claude.ai'), apiProvider: z.literal('firstParty'),
  subscriptionType: z.enum(['pro', 'max', 'ultra']),
});
const conflictingSubscriptionEnv = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_SIMPLE',
];

export type ClaudeRequest = AdapterRequest;
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

export function buildCommand(value: ClaudeOptions): string[] {
  const parsed = optionsSchema.safeParse(value);
  if (!parsed.success) throw new ClaudeAdapterError('An explicit model ID and positive finite limits are required');
  const options = parsed.data;
  const authFlags = options.auth === 'subscription' ? subscriptionFlags : ['--bare', '--restricted', '--setting-sources', ''];
  return [options.executable, ...authFlags, '-p', '--disable-slash-commands',
    '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob', '--disallowedTools', 'mcp__*',
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--no-chrome',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
    '--output-format', options.traceTools ? 'stream-json' : 'json', ...(options.traceTools ? ['--verbose'] : []),
    '--json-schema', JSON.stringify(outputJsonSchema), '--model', options.model,
    '--effort', options.effort, ...(options.budgetUsd === undefined ? [] : ['--max-budget-usd', String(options.budgetUsd)]),
    '--max-turns', String(options.maxTurns),
    '--append-system-prompt', instructions + (options.requireSkillReads ? '\nEvery file listed under context.skills is required for this evaluation. Use Read to read each listed Skill file completely before answering, including wrappers, procedure bodies, and shared rules. Search results alone do not satisfy this requirement. If a read is truncated, read the remaining lines. No native Skill activation is implied.' : '')];
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
  if (options.auth === 'api-key' && !env['ANTHROPIC_API_KEY']?.trim()) {
    throw new ClaudeAdapterError('ANTHROPIC_API_KEY is required; bare mode does not use subscription login');
  }
  if (options.auth === 'subscription' && conflictingSubscriptionEnv.some((key) => env[key]?.trim())) {
    throw new ClaudeAdapterError('Subscription mode requires removing API credentials, provider overrides and bare-mode environment variables');
  }
  const version = await run([options.executable, '--version'], { cwd, input: '', timeoutMs: 10_000, env, forwardSignals: true });
  requireSuccess(version, 'Claude version check');
  requireVersion(version.stdout);
  if (options.auth === 'subscription') {
    const status = await run([options.executable, ...subscriptionFlags, 'auth', 'status', '--json'],
      { cwd, input: '', timeoutMs: 10_000, env, forwardSignals: true });
    requireSuccess(status, 'Claude subscription login check');
    // Auth status includes account identifiers. Never forward it to the model or logs.
    let parsed: unknown;
    try { parsed = parseJson(status.stdout); } catch { throw new ClaudeAdapterError('Could not verify Claude subscription login'); }
    if (!subscriptionStatusSchema.safeParse(parsed).success) {
      throw new ClaudeAdapterError('Sign in to Claude Code with a Pro, Max or Ultra subscription; API authentication is not accepted');
    }
  }
  // Subscription login is scoped to the existing config directory/keychain.
  const configDir = options.auth === 'api-key' ? await mkdtemp(path.join(tmpdir(), 'gradwiki-claude-')) : undefined;
  let traceFile: Awaited<ReturnType<typeof open>> | undefined;
  let captured: ProcessResult | undefined;
  let output: ClaudeAnswer | undefined;
  try {
    if (options.traceTools) {
      try { traceFile = await open(path.join(cwd, 'claude-tools.json'), 'wx', 0o600); }
      catch { throw new ClaudeAdapterError('Cannot create a fresh claude-tools.json; refusing a model call without its trace'); }
    }
    const result = await run(command, {
      cwd,
      input: JSON.stringify({ question: request.question, inputs: request.inputs, context: request.context,
        instructions: request.instructions, output_contract: request.output_contract }),
      timeoutMs: options.timeoutSeconds * 1_000,
      forwardSignals: true,
      env: { ...env, ...(configDir === undefined ? {} : { CLAUDE_CONFIG_DIR: configDir }), CLAUDE_CODE_EFFORT_LEVEL: options.effort,
        ...(options.auth === 'subscription' ? { CLAUDE_CODE_DISABLE_FAST_MODE: '1' } : {}),
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
        MAX_STRUCTURED_OUTPUT_RETRIES: '1' },
    });
    captured = result;
    requireSuccess(result, 'Claude Code');
    if (options.traceTools) {
      const parsed = summarizeClaudeStream(result.stdout, request, cwd);
      if (!parsed.trace.complete) throw new ClaudeAdapterError('Claude tool stream is incomplete or inconsistent; inspect claude-tools.json');
      if (options.requireSkillReads && request.context.skills.some(file => !parsed.trace.fully_read_files.includes(file))) {
        throw new ClaudeAdapterError('Required Skill files were not fully read; inspect claude-tools.json');
      }
      output = parseResponse(JSON.stringify(parsed.result));
    } else output = parseResponse(result.stdout);
    return output;
  } finally {
    try {
      if (traceFile) {
        try {
          const { trace } = summarizeClaudeStream(captured?.stdout ?? '', request, cwd);
          const processComplete = captured !== undefined && !captured.timedOut && !captured.outputLimitExceeded && captured.exitCode === 0;
          await traceFile.writeFile(JSON.stringify({ ...trace, complete: trace.complete && processComplete,
            required_skill_files: options.requireSkillReads ? request.context.skills : [],
            unread_skill_files: options.requireSkillReads ? request.context.skills.filter(file => !trace.fully_read_files.includes(file)) : [],
            outcome: output ? 'answer' : 'error', output_sha256: output ? digest(output) : null,
            process: captured ? { exit_code: captured.exitCode, timed_out: captured.timedOut, output_limit_exceeded: captured.outputLimitExceeded } : null,
          }, null, 2) + '\n');
        } finally { await traceFile.close(); }
      }
    } finally { if (configDir !== undefined) await rm(configDir, { recursive: true, force: true }); }
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

const usage = `Usage: grad-eval-claude --model MODEL_ID [--max-turns 12] [--effort medium] [--timeout 120]
  API key (default): --auth api-key --max-budget-usd AMOUNT
  Subscription: --auth subscription --usage-credits-disabled
  Optional: --trace-tools records tool requests/results in a new claude-tools.json in the job directory.
  Optional: --require-skill-reads requires --trace-tools and full Read coverage of every listed Skill file.
  --usage-credits-disabled confirms you disabled extra usage in Claude account settings.
  It does not change or verify account billing settings. Subscription mode has no API-key fallback.
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: {
      help: { type: 'boolean', short: 'h' }, model: { type: 'string' },
      auth: { type: 'string' }, 'usage-credits-disabled': { type: 'boolean' },
      'max-budget-usd': { type: 'string' }, 'max-turns': { type: 'string' },
      effort: { type: 'string' }, timeout: { type: 'string' },
      'trace-tools': { type: 'boolean' },
      'require-skill-reads': { type: 'boolean' },
    }, strict: true, allowPositionals: false });
    if (values.help) { process.stdout.write(usage); return 0; }
    const options = optionsSchema.safeParse({ model: values.model, auth: values.auth ?? 'api-key',
      usageCreditsDisabled: values['usage-credits-disabled'] ?? false,
      traceTools: values['trace-tools'] ?? false,
      requireSkillReads: values['require-skill-reads'] ?? false,
      budgetUsd: values['max-budget-usd'] === undefined ? undefined : Number(values['max-budget-usd']),
      maxTurns: values['max-turns'] === undefined ? 12 : Number(values['max-turns']),
      effort: values.effort ?? 'medium', timeoutSeconds: values.timeout === undefined ? 120 : Number(values.timeout) });
    if (!options.success) throw new ClaudeAdapterError('Specify a model ID, valid limits and the authentication prerequisites. Use --help for syntax.');
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
