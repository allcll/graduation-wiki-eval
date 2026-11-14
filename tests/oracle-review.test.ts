import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, parseJson } from '../src/json.js';
import { datasetHash, makePlan } from '../src/evaluate.js';
import { parseCases, type Case } from '../src/schema.js';
import {
  createOracleWorkspace, validateOracleWorkspace, updateOracleEntry, exportOracleCases,
  type OracleWorkspace, type OracleEntry,
} from '../src/oracle-review.js';

function fixtures(): Case[] {
  return parseCases([0, 1].map(index => ({
    id: `oracle-test-${index}`, family: `family-${index}`, split: 'dev', origin: 'synthetic',
    review_status: 'draft', oracle_reviewer: null, independent_reference: true,
    question: '소프트웨어 테스트용 가상 질문', inputs: { earned: index },
    expected: { action: 'answer', facts: { remaining: 3 - index } },
    rubric: { version: 'fixture-v1', criteria: [
      { id: 'credits', dimension: 'answer', severity: 'major', description: '가상 학점 계산을 확인합니다.' },
      { id: 'citation', dimension: 'evidence', severity: 'major', description: '가상 원문 근거를 확인합니다.' },
    ] },
    sources: [{ id: 'fictional', version: 'fixture-v1', locator: '가상 규정 1항', excerpt: '이 자료는 테스트 예제입니다.', authoritative: false }],
  })));
}

function entry(workspace: OracleWorkspace, index = 0): OracleEntry {
  const result = workspace.entries[index];
  assert.ok(result);
  return result;
}

async function approve(workspace: OracleWorkspace, index = 0): Promise<OracleWorkspace> {
  return updateOracleEntry(workspace, entry(workspace, index).source.id,
    { reviewer: 'software-test-only', note: '가상 자료를 사용한 저장 기능 테스트입니다.', status: 'approved' });
}

test('workspace hashes match CLI hashes and a fresh review does not inherit verified status', async () => {
  const source = fixtures();
  const first = source[0]; assert.ok(first);
  first.review_status = 'verified'; first.oracle_reviewer = 'old-test-reviewer';
  const before = structuredClone(source);
  const workspace = await createOracleWorkspace(source, '가상 자료 검토');
  assert.equal(workspace.dataset_sha256, datasetHash(source));
  assert.equal(entry(workspace).source_sha256, digest(first));
  assert.equal(entry(workspace).source.review_status, 'verified');
  assert.equal(entry(workspace).draft.review_status, 'draft');
  assert.equal(entry(workspace).draft.oracle_reviewer, null);
  assert.equal(entry(workspace).status, 'pending');
  assert.deepEqual(source, before);
  await assert.rejects(exportOracleCases(workspace), /확인 완료한 문항이 없습니다/);
  const reordered = await createOracleWorkspace([...source].reverse());
  assert.equal(reordered.dataset_sha256, workspace.dataset_sha256);
});

test('save/reload retains partial work and source binding without approving unfinished cases', async () => {
  const source = fixtures();
  let workspace = await createOracleWorkspace(source);
  workspace = await updateOracleEntry(workspace, entry(workspace).source.id,
    { reviewer: 'software-test-only', note: '원문을 다시 확인해야 합니다.', status: 'on_hold' });
  workspace = await approve(workspace, 1);
  const reloaded = await validateOracleWorkspace(parseJson(JSON.stringify(workspace)), source);
  assert.deepEqual(reloaded, workspace);
  assert.equal(reloaded.selected_case_id, entry(workspace, 1).source.id);
  assert.equal(entry(reloaded).status, 'on_hold');
  await assert.rejects(exportOracleCases(reloaded), /아직 확인하지 않은 문항이 1개/);
  const selected = await exportOracleCases(reloaded, { approvedOnly: true });
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.id, entry(workspace, 1).source.id);
  assert.equal(selected[0]?.review_status, 'verified');
  assert.equal(selected[0]?.oracle_reviewer, 'software-test-only');
  assert.equal(selected[0]?.origin, 'synthetic');
  assert.equal(selected[0]?.sources[0]?.authoritative, false);
  assert.equal(selected[0]?.split, 'dev');
  assert.equal(entry(reloaded, 1).draft.review_status, 'draft');
});

test('approval requires a reviewer, records real action time and exports into existing planning schema', async () => {
  const source = fixtures();
  let workspace = await createOracleWorkspace(source);
  await assert.rejects(updateOracleEntry(workspace, entry(workspace).source.id, { status: 'approved' }), /검토자 이름/);
  const before = Date.now();
  workspace = await approve(workspace);
  const approved = entry(workspace);
  assert.ok(approved.reviewed_at);
  assert.ok(Date.parse(approved.reviewed_at) >= before && Date.parse(approved.reviewed_at) <= Date.now());
  assert.equal(approved.approved_sha256, digest({ draft: approved.draft, reviewer: approved.reviewer, note: approved.note }));
  const noChange = await updateOracleEntry(workspace, approved.source.id, { status: 'approved' });
  assert.equal(entry(noChange).reviewed_at, approved.reviewed_at);
  workspace = await approve(workspace, 1);
  const exported = await exportOracleCases(workspace);
  assert.equal(exported.length, 2);
  assert.equal(makePlan(exported).cases.length, 2);
  assert.notEqual(datasetHash(exported), workspace.dataset_sha256);
});

test('editing an approved draft, reviewer or note requires a separate confirmation', async () => {
  const original = await approve(await createOracleWorkspace(fixtures()));
  const first = entry(original);
  for (const patch of [
    { draft: { ...first.draft, expected: { action: 'answer' as const, facts: { remaining: 7 } } } },
    { reviewer: 'another-test-reviewer' },
    { note: '새로운 검토 의견' },
  ]) {
    const edited = await updateOracleEntry(original, first.source.id, { ...patch, status: 'approved' });
    assert.equal(entry(edited).status, 'pending');
    assert.equal(entry(edited).reviewed_at, null);
    assert.equal(entry(edited).approved_sha256, null);
    await assert.rejects(exportOracleCases(edited, { approvedOnly: true }), /확인 완료한 문항이 없습니다/);
    const confirmed = await updateOracleEntry(edited, first.source.id, { status: 'approved' });
    assert.equal(entry(confirmed).status, 'approved');
  }
  assert.equal(entry(original).status, 'approved');
  assert.equal(entry(original).draft.expected.facts['remaining'], 3);
});

test('import refuses stale approvals, changed source snapshots and another dataset', async () => {
  const source = fixtures();
  const workspace = await approve(await createOracleWorkspace(source));
  for (const change of [
    (record: OracleEntry): void => { record.draft.expected.facts['remaining'] = 99; },
    (record: OracleEntry): void => { record.reviewer = 'changed-reviewer'; },
    (record: OracleEntry): void => { record.note = 'Changed without review'; },
  ]) {
    const modified = structuredClone(workspace); change(entry(modified));
    await assert.rejects(validateOracleWorkspace(modified), /확인 후 내용이 바뀐/);
  }
  const changedSource = structuredClone(workspace);
  entry(changedSource).source.question = '다른 원본 질문';
  await assert.rejects(validateOracleWorkspace(changedSource), /원본 평가셋 해시/);
  const wrongCaseHash = structuredClone(workspace);
  entry(wrongCaseHash).source_sha256 = 'sha256:' + '0'.repeat(64);
  await assert.rejects(validateOracleWorkspace(wrongCaseHash), /원본 문항 해시/);
  const other = fixtures(); const first = other[0]; assert.ok(first);
  first.question = '새 버전의 질문';
  await assert.rejects(validateOracleWorkspace(workspace, other), /다른 평가셋/);
  await assert.rejects(validateOracleWorkspace(workspace, source.slice(1)), /다른 평가셋/);
});

test('review cannot change provenance, split, family or verification metadata', async () => {
  const workspace = await createOracleWorkspace(fixtures());
  const first = entry(workspace);
  for (const draft of [
    { ...first.draft, id: 'changed-id' },
    { ...first.draft, family: 'changed-family' },
    { ...first.draft, split: 'holdout' as const },
    { ...first.draft, origin: 'real' as const },
    { ...first.draft, independent_reference: false },
    { ...first.draft, review_status: 'verified' as const, oracle_reviewer: 'not-confirmed' },
  ]) await assert.rejects(updateOracleEntry(workspace, first.source.id, { draft }), /변경할 수 없습니다|내보내기에서만/);
  await assert.rejects(updateOracleEntry(workspace, 'unknown', { note: '없는 문항' }), /찾을 수 없습니다/);
});

test('import rejects duplicate or missing cases, invalid cursor and inconsistent approval states', async () => {
  const workspace = await createOracleWorkspace(fixtures());
  const duplicate = structuredClone(workspace); duplicate.entries.push(structuredClone(entry(duplicate)));
  await assert.rejects(validateOracleWorkspace(duplicate), /Duplicate case id/);
  const missing = structuredClone(workspace); missing.entries.pop();
  await assert.rejects(validateOracleWorkspace(missing), /원본 평가셋 해시/);
  await assert.rejects(validateOracleWorkspace({ ...workspace, selected_case_id: 'unknown' }), /검토 위치/);
  const forged = structuredClone(workspace); entry(forged).status = 'approved'; entry(forged).reviewer = 'test';
  await assert.rejects(validateOracleWorkspace(forged), /확인 완료 기록이 빠져/);
  const stale = await approve(workspace); entry(stale).status = 'pending';
  await assert.rejects(validateOracleWorkspace(stale), /미완료 문항에 승인 해시/);
  const invalidDate = await approve(workspace); entry(invalidDate).reviewed_at = 'not-a-date';
  await assert.rejects(validateOracleWorkspace(invalidDate), /datetime/);
  await assert.rejects(validateOracleWorkspace({ ...workspace, unknown: true }));
  assert.throws(() => parseJson('{"reviewer":"a","reviewer":"b"}'), /Duplicate JSON key/);
});

test('source family leakage and malformed edited cases cannot enter the workspace', async () => {
  const cases = fixtures();
  const first = cases[0], second = cases[1]; assert.ok(first && second);
  second.family = first.family; second.split = 'holdout';
  await assert.rejects(createOracleWorkspace(cases), /Family leakage/);
  const workspace = await createOracleWorkspace(fixtures());
  const draft = structuredClone(entry(workspace).draft);
  draft.rubric.criteria.pop();
  await assert.rejects(updateOracleEntry(workspace, entry(workspace).source.id, { draft }));
  await assert.rejects(createOracleWorkspace([]));
});
