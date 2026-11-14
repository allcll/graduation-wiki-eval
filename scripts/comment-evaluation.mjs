import { failedPublicSummary, parsePublicSummary, renderPublicSummary } from './ci-summary.mjs';

export const COMMENT_MARKER = '<!-- graduation-wiki-eval:sample-preview -->';
export const PREVIEW_WORKFLOW_NAME = 'evaluation-preview';
const botLogin = 'github-actions[bot]';
const shaPattern = /^[0-9a-f]{40}$/i;
const namePattern = /^[A-Za-z0-9_.-]+$/;
const runMarkerPrefix = '<!-- graduation-wiki-eval:run ';
const runMetadataPattern = /^<!-- graduation-wiki-eval:run ([0-9a-f]{40}) ([1-9]\d*) ([1-9]\d*) -->$/;

const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const sameRepository = (value, expected) => typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
const skipped = reason => ({ status: 'skipped', reason });

function previousIdentity(body) {
  const line = body.split('\n', 3)[1] ?? '';
  if (!line.startsWith(runMarkerPrefix)) return { kind: 'legacy' };
  const match = runMetadataPattern.exec(line);
  if (!match) return { kind: 'invalid' };
  const runId = Number(match[2]), attempt = Number(match[3]);
  if (!positiveInteger(runId) || !positiveInteger(attempt)) return { kind: 'invalid' };
  return { kind: 'known', sha: match[1], runId, attempt };
}

function matchingPullRequest(pr, number, repository, sha) {
  return pr?.number === number && pr.state === 'open' &&
    sameRepository(pr.base?.repo?.full_name, repository) &&
    sameRepository(pr.head?.repo?.full_name, repository) && pr.head?.sha === sha;
}

async function findComment(github, owner, repo, number) {
  // A page beyond the first is common on long-lived PRs. Keep the API work bounded.
  for (let page = 1; page <= 100; page += 1) {
    const { data } = await github.rest.issues.listComments({ owner, repo, issue_number: number, per_page: 100, page });
    if (!Array.isArray(data)) throw new Error('Invalid GitHub comment response');
    const comment = data.find(item => positiveInteger(item?.id) && item.user?.type === 'Bot' &&
      item.user.login === botLogin && typeof item.body === 'string' && item.body.startsWith(COMMENT_MARKER + '\n'));
    if (comment) return comment;
    if (data.length < 100) return undefined;
  }
  // Do not create a duplicate when the search was incomplete.
  throw new Error('Comment search exceeded the page limit');
}

/** Called only by the trusted workflow_run job. The artifact is data, never code. */
export async function publishEvaluationComment({ github, owner, repo, workflowRun, summary: untrustedSummary }) {
  if ([owner, repo].some(value => typeof value !== 'string' || !namePattern.test(value) || value === '.' || value === '..')) {
    throw new Error('Invalid repository coordinates');
  }
  const repository = `${owner}/${repo}`;
  if (workflowRun?.name !== PREVIEW_WORKFLOW_NAME) return skipped('not_preview_workflow');
  if (workflowRun?.event !== 'pull_request' || workflowRun.status !== 'completed') return skipped('not_completed_pr_run');
  if (!sameRepository(workflowRun.head_repository?.full_name, repository)) return skipped('fork_run');
  if (!positiveInteger(workflowRun.id) || !positiveInteger(workflowRun.run_attempt) ||
      typeof workflowRun.head_sha !== 'string' || !shaPattern.test(workflowRun.head_sha)) return skipped('invalid_run_identity');
  if (!Array.isArray(workflowRun.pull_requests)) return skipped('no_associated_pr');
  const numbers = [...new Set(workflowRun.pull_requests.map(item => item?.number))];
  if (numbers.length !== 1 || !positiveInteger(numbers[0])) return skipped('ambiguous_or_missing_pr');
  const number = numbers[0];
  let summary = parsePublicSummary(untrustedSummary);
  if (summary.mode !== 'sample') return skipped('not_sample_preview');
  // A valid-looking artifact cannot turn a failed or cancelled run into success.
  if (workflowRun.conclusion !== 'success') summary = failedPublicSummary('sample');

  const { data: first } = await github.rest.pulls.get({ owner, repo, pull_number: number });
  if (!matchingPullRequest(first, number, repository, workflowRun.head_sha)) return skipped('closed_fork_or_stale_head');
  const existing = await findComment(github, owner, repo, number);
  const headSha = workflowRun.head_sha.toLowerCase();
  const runId = workflowRun.id, attempt = workflowRun.run_attempt;
  const metadata = `${runMarkerPrefix}${headSha} ${runId} ${attempt} -->`;
  const identity = `검증한 PR head: \`${headSha}\` · 실행: \`${runId}\` · 시도: \`${attempt}\``;
  const body = `${COMMENT_MARKER}\n${metadata}\n${identity}\n\n${renderPublicSummary(summary)}\n\n[실행 로그](https://github.com/${owner}/${repo}/actions/runs/${runId}/attempts/${attempt})\n`;

  // A push while comments were being fetched must not publish an older head's result.
  const { data: current } = await github.rest.pulls.get({ owner, repo, pull_number: number });
  if (!matchingPullRequest(current, number, repository, workflowRun.head_sha)) return skipped('head_changed_during_review');
  if (existing?.body === body) return { status: 'unchanged', commentId: existing.id };
  if (existing) {
    const previous = previousIdentity(existing.body);
    if (previous.kind === 'invalid') return skipped('invalid_comment_identity');
    if (previous.kind === 'known' && previous.sha === headSha) {
      if (previous.runId > runId || (previous.runId === runId && previous.attempt > attempt)) return skipped('older_run_attempt');
      if (previous.runId === runId && previous.attempt === attempt) return skipped('already_published_attempt');
    }
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    return { status: 'updated', commentId: existing.id };
  }
  const { data: created } = await github.rest.issues.createComment({ owner, repo, issue_number: number, body });
  if (!positiveInteger(created?.id)) throw new Error('Invalid created comment response');
  return { status: 'created', commentId: created.id };
}
