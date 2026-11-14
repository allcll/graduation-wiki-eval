import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishEvaluationComment, COMMENT_MARKER, type PublishArgs } from '../scripts/comment-evaluation.mjs';

const sha = 'a'.repeat(40);
const owner = 'allcll', repo = 'graduation-wiki-eval';
const repository = `${owner}/${repo}`;
const summary = () => ({
  schema: 'graduation-wiki-eval/public-summary-v1', mode: 'sample', execution: 'completed',
  conditions: [{ condition: 'A', expected: 3, missing: 0, errors: 0, objectivePassed: 3,
    objectiveFailed: 0, reviewPending: 3, reviewedSuccess: 0, requiredFail: 0, advisoryRuns: 0,
    criterionFailures: { blocker: 0, major: 0, minor: 0 }, gate: 'INCONCLUSIVE' }],
});
const workflowRun = () => ({
  id: 9123, run_attempt: 1, name: 'evaluation-preview', status: 'completed', event: 'pull_request', conclusion: 'success', head_sha: sha,
  head_repository: { full_name: repository }, pull_requests: [{ number: 10 }],
});
const pullRequest = () => ({
  number: 10, state: 'open', base: { repo: { full_name: repository } },
  head: { sha, repo: { full_name: repository } },
});
type PullRequest = ReturnType<typeof pullRequest>;
interface Comment { id: number; body: string; user: { login: string; type: string } }
interface CommentWrite { owner: string; repo: string; body: string; issue_number?: number; comment_id?: number }

function fakeApi(options: { pages?: Comment[][]; pullRequests?: PullRequest[] } = {}) {
  const writes: CommentWrite[] = [];
  const pages: number[] = [];
  let getCount = 0;
  const comments = options.pages ?? [[]];
  const github = { rest: {
    pulls: { get: async ({ pull_number }: { owner: string; repo: string; pull_number: number }) => {
      assert.equal(pull_number, 10);
      const values = options.pullRequests ?? [pullRequest()];
      return { data: values[Math.min(getCount++, values.length - 1)] };
    } },
    issues: {
      listComments: async ({ page, per_page }: { owner: string; repo: string; issue_number: number; page: number; per_page: number }) => {
        pages.push(page); assert.equal(per_page, 100);
        return { data: comments[page - 1] ?? [] };
      },
      updateComment: async (value: CommentWrite) => { writes.push(value); return { data: { id: value.comment_id } }; },
      createComment: async (value: CommentWrite) => { writes.push(value); return { data: { id: 99 } }; },
    },
  } };
  const publish = (changes: Partial<PublishArgs> = {}) => publishEvaluationComment({
    github, owner, repo, workflowRun: workflowRun(), summary: summary(), ...changes,
  });
  return { publish, writes, pages, gets: () => getCount };
}

test('preview comment contains the numeric aggregate and a trusted run link', async () => {
  const api = fakeApi();
  const result = await api.publish();
  assert.equal(result.status, 'created');
  assert.equal(api.gets(), 2);
  assert.equal(api.writes.length, 1);
  const body = api.writes[0]?.body;
  assert.ok(body);
  assert.ok(body.startsWith(COMMENT_MARKER + '\n'));
  assert.match(body, /INCONCLUSIVE/);
  assert.match(body, /합성/);
  assert.match(body, /실제 모델이나 ALLCLL WIKI의 성능 결과가 아닙니다/);
  assert.ok(body.includes(`검증한 PR head: \`${sha}\` · 실행: \`9123\` · 시도: \`1\``));
  assert.ok(body.includes(`https://github.com/${repository}/actions/runs/9123/attempts/1`));
});

test('artifact fields that could contain questions or answers are rejected without writing', async () => {
  for (const value of [
    { ...summary(), question: 'PRIVATE QUESTION' },
    { ...summary(), conditions: [{ ...summary().conditions[0], rationale: 'PRIVATE ANSWER' }] },
    { ...summary(), conditions: [{ ...summary().conditions[0], expected: 'PRIVATE VALUE' }] },
  ]) {
    const api = fakeApi();
    await assert.rejects(api.publish({ summary: value }));
    assert.deepEqual(api.writes, []);
    assert.equal(api.gets(), 0);
  }
});

test('sample quality cannot be relabeled as PASS by an artifact', async () => {
  const api = fakeApi();
  await assert.rejects(api.publish({ summary: {
    ...summary(), conditions: [{ ...summary().conditions[0], gate: 'PASS' }],
  } }));
  assert.deepEqual(api.writes, []);
});

test('fork runs, non-PR events and incomplete runs do not access the comment API', async () => {
  for (const run of [
    { ...workflowRun(), head_repository: { full_name: 'someone/fork' } },
    { ...workflowRun(), event: 'pull_request_target' },
    { ...workflowRun(), event: 'workflow_dispatch' },
    { ...workflowRun(), status: 'in_progress' },
    { ...workflowRun(), name: 'some-other-workflow' },
  ]) {
    const api = fakeApi();
    assert.equal((await api.publish({ workflowRun: run })).status, 'skipped');
    assert.deepEqual(api.writes, []);
    assert.equal(api.gets(), 0);
  }
});

test('unassociated, ambiguous or malformed run identities are skipped', async () => {
  for (const run of [
    { ...workflowRun(), pull_requests: [] },
    { ...workflowRun(), pull_requests: [{ number: 10 }, { number: 11 }] },
    { ...workflowRun(), pull_requests: [{ number: '10' }] },
    { ...workflowRun(), id: '9123/../../evil' },
    { ...workflowRun(), id: Number.MAX_SAFE_INTEGER + 1 },
    { ...workflowRun(), run_attempt: 0 },
    { ...workflowRun(), run_attempt: '1' },
    { ...workflowRun(), run_attempt: Number.MAX_SAFE_INTEGER + 1 },
    { ...workflowRun(), head_sha: 'branch-name' },
  ]) {
    const api = fakeApi();
    assert.equal((await api.publish({ workflowRun: run })).status, 'skipped');
    assert.equal(api.gets(), 0);
  }
});

test('a closed PR, changed head or fork PR cannot receive a comment', async () => {
  const normal = pullRequest();
  for (const pr of [
    { ...normal, state: 'closed' },
    { ...normal, head: { ...normal.head, sha: 'b'.repeat(40) } },
    { ...normal, head: { ...normal.head, repo: { full_name: 'someone/fork' } } },
    { ...normal, base: { repo: { full_name: 'other/repo' } } },
  ]) {
    const api = fakeApi({ pullRequests: [pr] });
    assert.equal((await api.publish()).status, 'skipped');
    assert.deepEqual(api.writes, []);
    assert.deepEqual(api.pages, []);
  }
});

test('pagination finds the bot marker beyond the first page and updates it', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1, body: 'ordinary comment', user: { login: 'reviewer', type: 'User' },
  }));
  const api = fakeApi({ pages: [firstPage, [{
    id: 400, body: COMMENT_MARKER + '\nold preview', user: { login: 'github-actions[bot]', type: 'Bot' },
  }]] });
  assert.equal((await api.publish()).status, 'updated');
  assert.deepEqual(api.pages, [1, 2]);
  assert.equal(api.writes[0]?.comment_id, 400);
  assert.equal(api.writes.length, 1);
});

test('a user or different bot cannot impersonate the sticky comment marker', async () => {
  const api = fakeApi({ pages: [[
    { id: 1, body: COMMENT_MARKER + '\nspoofed', user: { login: 'reviewer', type: 'User' } },
    { id: 2, body: COMMENT_MARKER + '\nspoofed', user: { login: 'another-app[bot]', type: 'Bot' } },
  ]] });
  assert.equal((await api.publish()).status, 'created');
  assert.equal(api.writes[0]?.issue_number, 10);
});

test('a head change during comment pagination prevents stale publication', async () => {
  const changed = pullRequest(); changed.head.sha = 'b'.repeat(40);
  const api = fakeApi({ pullRequests: [pullRequest(), changed] });
  const result = await api.publish();
  assert.equal(result.reason, 'head_changed_during_review');
  assert.equal(api.gets(), 2);
  assert.deepEqual(api.writes, []);
});

test('publishing the same run twice is idempotent', async () => {
  const first = fakeApi();
  await first.publish();
  const body = first.writes[0]?.body;
  assert.ok(body);
  const second = fakeApi({ pages: [[{ id: 99, body, user: { login: 'github-actions[bot]', type: 'Bot' } }]] });
  assert.equal((await second.publish()).status, 'unchanged');
  assert.deepEqual(second.writes, []);
});

async function commentForRun(run: ReturnType<typeof workflowRun>): Promise<Comment> {
  const pr = pullRequest(); pr.head.sha = run.head_sha;
  const api = fakeApi({ pullRequests: [pr] });
  await api.publish({ workflowRun: run });
  const body = api.writes[0]?.body;
  assert.ok(body);
  return { id: 99, body, user: { login: 'github-actions[bot]', type: 'Bot' } };
}

test('an older run or older attempt cannot replace a newer result for the same head', async () => {
  for (const previous of [
    { ...workflowRun(), id: 9124 },
    { ...workflowRun(), run_attempt: 2 },
  ]) {
    const api = fakeApi({ pages: [[await commentForRun(previous)]] });
    assert.equal((await api.publish()).reason, 'older_run_attempt');
    assert.deepEqual(api.writes, []);
    assert.equal(api.gets(), 2);
  }
});

test('a newer run or newer attempt updates the existing result', async () => {
  for (const run of [
    { ...workflowRun(), id: 9124 },
    { ...workflowRun(), run_attempt: 2 },
  ]) {
    const api = fakeApi({ pages: [[await commentForRun(workflowRun())]] });
    assert.equal((await api.publish({ workflowRun: run })).status, 'updated');
    assert.equal(api.writes.length, 1);
    assert.equal(api.writes[0]?.comment_id, 99);
  }
});

test('duplicate delivery cannot change the result of an already published attempt', async () => {
  const api = fakeApi({ pages: [[await commentForRun(workflowRun())]] });
  assert.equal((await api.publish({ summary: {
    schema: 'graduation-wiki-eval/public-summary-v1', mode: 'sample', execution: 'failed', conditions: [],
  } })).reason, 'already_published_attempt');
  assert.deepEqual(api.writes, []);
});

test('a newer failed attempt replaces an earlier success with a fixed failure summary', async () => {
  const api = fakeApi({ pages: [[await commentForRun(workflowRun())]] });
  const result = await api.publish({
    workflowRun: { ...workflowRun(), run_attempt: 2, conclusion: 'failure' },
    summary: { schema: 'graduation-wiki-eval/public-summary-v1', mode: 'sample', execution: 'failed', conditions: [] },
  });
  assert.equal(result.status, 'updated');
  assert.match(api.writes[0]?.body ?? '', /실행: 실패 또는 누락 있음/);
  assert.match(api.writes[0]?.body ?? '', /시도: `2`/);
});

test('a current head replaces an old head comment regardless of its run ordering', async () => {
  const previous = { ...workflowRun(), id: 9999, head_sha: 'b'.repeat(40) };
  const api = fakeApi({ pages: [[await commentForRun(previous)]] });
  assert.equal((await api.publish()).status, 'updated');
  assert.ok(api.writes[0]?.body.includes(`검증한 PR head: \`${sha}\``));
});

test('invalid bot run metadata is not used to decide execution ordering', async () => {
  const comment = await commentForRun(workflowRun());
  comment.body = comment.body.replace(` ${sha} 9123 1 -->`, ` ${sha} 999999999999999999999999 1 -->`);
  const api = fakeApi({ pages: [[comment]] });
  assert.equal((await api.publish()).reason, 'invalid_comment_identity');
  assert.deepEqual(api.writes, []);
});

test('real-model summaries cannot become PR preview comments', async () => {
  const api = fakeApi();
  assert.equal((await api.publish({ summary: { ...summary(), mode: 'claude' } })).reason, 'not_sample_preview');
  assert.equal(api.gets(), 0);
  assert.deepEqual(api.writes, []);
});

test('failed or cancelled runs replace earlier success even if the artifact claims completion', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const api = fakeApi({ pages: [[await commentForRun(workflowRun())]] });
    const result = await api.publish({ workflowRun: { ...workflowRun(), run_attempt: 2, conclusion } });
    assert.equal(result.status, 'updated');
    const body = api.writes[0]?.body;
    assert.ok(body);
    assert.match(body, /실행: 실패 또는 누락 있음/);
    assert.ok(!body.includes('| A |'));
    assert.ok(!body.includes('실행: 완료'));
    assert.match(body, /시도: `2`/);
  }
});

test('repository coordinates cannot inject a comment link', async () => {
  const api = fakeApi();
  await assert.rejects(api.publish({ owner: 'allcll)[click](https://example.com' }));
  assert.deepEqual(api.writes, []);
});
