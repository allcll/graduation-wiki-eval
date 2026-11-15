import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skillContractSchema, validateSkillContext } from '../src/skill-context.js';

const entry = 'context/skills/repo/.claude/skills/query/SKILL.md';
const body = 'context/skills/repo/docs/skills/query/SKILL.md';
const source = 'context/sources/handbook.txt';
const contract = { entrypoints: [entry], required_files: [source] };
const wrapper = '---\nname: query\n---\n# query\n공통 본문을 따른다.\n@../../../docs/skills/query/SKILL.md\n';
const files = (...pairs: [string, string][]) => new Map(pairs.map(([file, text]) => [file, Buffer.from(text)]));

test('a discoverable wrapper must resolve to an allowlisted, nonempty body', () => {
  const bundle = files([entry, wrapper], [source, 'Original source.']);
  assert.throws(() => validateSkillContext(bundle, [entry], contract, 'real'), /not allowlisted.*docs\/skills\/query\/SKILL/);
  bundle.set(body, Buffer.from('---\nname: query\n---\n# Query\n'));
  assert.throws(() => validateSkillContext(bundle, [entry, body], contract, 'real'), /body is empty/);
  bundle.set(body, Buffer.from('# Query\nRead the handbook and cite the applicable paragraph.'));
  assert.doesNotThrow(() => validateSkillContext(bundle, [entry, body], contract, 'real'));
});

test('declared prose dependencies are required even without an @ import', () => {
  const bundle = files([entry, 'Read the handbook before answering.']);
  assert.throws(() => validateSkillContext(bundle, [entry], contract, 'real'), /Required Skill reference is not allowlisted/);
  bundle.set(source, Buffer.alloc(0));
  assert.throws(() => validateSkillContext(bundle, [entry], contract, 'real'), /reference is empty/);
  assert.throws(() => validateSkillContext(bundle, [entry], undefined, 'real'), /requires skill_contract/);
});

test('imports cannot escape the prepared context or fetch remote/host paths', () => {
  for (const target of ['../../../../../../secret.md', '/tmp/secret.md', '~/secret.md', 'https://example.com/skill.md', 'C:\\secret.md', 'missing/*.md']) {
    const bundle = files([entry, `@${target}`], [source, 'Handbook.']);
    assert.throws(() => validateSkillContext(bundle, [entry], contract, 'real'), /escapes|Unsupported/);
  }
  assert.equal(skillContractSchema.safeParse({ ...contract, required_files: ['context/wiki/../secret.md'] }).success, false);
  assert.equal(skillContractSchema.safeParse({ ...contract, entrypoints: [source] }).success, false);
});

test('cycles are rejected, shared references are allowed, examples are not imported', () => {
  const bundle = files([entry, wrapper], [body, '@../../../.claude/skills/query/SKILL.md'], [source, 'Source.']);
  assert.throws(() => validateSkillContext(bundle, [entry, body], contract, 'real'), /Cyclic/);
  bundle.set(body, Buffer.from('# Instructions\nUse the provided source.\n```md\n@missing-example.md\n```\n'));
  assert.doesNotThrow(() => validateSkillContext(bundle, [entry, body], { ...contract, entrypoints: [entry, body] }, 'real'));
});

test('supporting Markdown imports are checked, including CLAUDE.md wrappers', () => {
  const support = 'context/skills/repo/CLAUDE.md';
  const bundle = files([entry, 'Read the project rules.'], [source, 'Source.'], [support, '@docs/PROJECT.md']);
  assert.throws(() => validateSkillContext(bundle, [entry, support], contract, 'real'), /not allowlisted.*PROJECT/);
});
