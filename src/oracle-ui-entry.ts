import { mountOracleReview } from './oracle-ui.js';
import { parseJson } from './json-data.js';
import { validateOracleWorkspace } from './oracle-review.js';
import { caseSchema } from './schema.js';
import { z } from 'zod';

async function start(): Promise<void> {
  const payload = z.strictObject({ workspace: z.unknown(), sourceLinks: z.record(z.string(), z.string()),
    sourceLinkTargets: z.record(z.string(), caseSchema.shape.sources) })
    .parse(parseJson(document.getElementById('oracle-data')?.textContent ?? ''));
  await mountOracleReview({ workspace: await validateOracleWorkspace(payload.workspace), sourceLinks: payload.sourceLinks, sourceLinkTargets: payload.sourceLinkTargets });
}

start().catch((error: unknown) => {
  const host = document.getElementById('oracle-app');
  if (!host) return;
  const heading = document.createElement('h1'); heading.textContent = '검토 화면을 열 수 없습니다';
  const message = document.createElement('p'); message.setAttribute('role', 'alert');
  message.textContent = error instanceof Error ? error.message : '파일을 다시 생성한 뒤 최신 브라우저에서 열어 주세요.';
  host.replaceChildren(heading, message);
});
