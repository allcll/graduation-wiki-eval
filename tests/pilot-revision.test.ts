import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest, readJson, readRecords } from '../src/json.js';
import { parseCases } from '../src/schema.js';

test('CS-001 input revision preserves the source oracle and does not inherit human approval', async () => {
  const dir = new URL('../datasets/graduation-2026-2/', import.meta.url);
  const parent = parseCases(await readRecords(new URL('v1/cases.jsonl', dir).pathname)).find(item => item.id === 'CS-2026-2-001');
  const [revision] = parseCases(await readRecords(new URL('pilots/cs-001-v2/cases.jsonl', dir).pathname));
  assert(parent?.inputs && revision?.inputs);
  const provenance = await readJson(new URL('pilots/cs-001-v2/provenance.json', dir).pathname) as Record<string, unknown>;
  assert.equal(provenance.parent_case_sha256, digest(parent));
  assert.equal(provenance.revision_case_sha256, digest(revision));
  assert.equal(provenance.unchanged_expected_sha256, digest(parent.expected));
  assert.equal(revision.review_status, 'draft');
  assert.equal(revision.oracle_reviewer, null);
  const output = revision.inputs['requested_output'] as { facts: Record<string, string> };
  const parentOutput = parent.inputs['requested_output'] as { facts: Record<string, string> };
  for (const key of ['recognized_credits', 'required_credits']) {
    assert.notEqual(output.facts[key], parentOutput.facts[key]);
    assert(!/\d/.test(output.facts[key] ?? ''), 'Output descriptions must not contain answer numbers');
    output.facts[key] = parentOutput.facts[key]!;
  }
  revision.review_status = parent.review_status;
  revision.oracle_reviewer = parent.oracle_reviewer!;
  assert.deepEqual(revision, parent, 'No other question, oracle, source, or rubric changes');
});
