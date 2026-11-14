import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { assertJson } from './json-data.js';
import { createOracleWorkspace, validateOracleWorkspace } from './oracle-review.js';
import { oracleStyles } from './oracle-style.js';
import { parseCases, type Case } from './schema.js';

export interface OracleHtmlOptions {
  out: string;
  workspace?: unknown;
  title?: string;
  sourceLinks?: unknown;
  sourceLinksBase?: string;
  relativeSourceLinks?: boolean;
}

function text(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function inlineJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

function cspHash(content: string): string {
  return 'sha256-' + createHash('sha256').update(content, 'utf8').digest('base64');
}

function sourceLink(value: string, base: string): string {
  const href = value.trim();
  if (!href) throw new Error('원문 링크는 비워 둘 수 없습니다.');
  let url: URL;
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
    url = new URL(href);
  } else {
    const fragmentAt = href.indexOf('#');
    const path = fragmentAt < 0 ? href : href.slice(0, fragmentAt);
    url = pathToFileURL(resolve(base, path));
    if (fragmentAt >= 0) url.hash = href.slice(fragmentAt);
  }
  if (url.username || url.password) throw new Error('인증 정보가 포함된 원문 링크는 사용할 수 없습니다.');
  if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  if (url.protocol !== 'file:') throw new Error('원문 링크는 http, https 또는 로컬 PDF만 사용할 수 있습니다.');
  if (url.hostname && url.hostname !== 'localhost') throw new Error('다른 호스트의 파일 링크는 사용할 수 없습니다.');
  if (url.search || !fileURLToPath(url).toLowerCase().endsWith('.pdf')) throw new Error('로컬 원문 링크는 PDF 파일이어야 합니다.');
  if (url.hash && !/^#page=[1-9]\d*$/.test(url.hash)) throw new Error('PDF 페이지는 #page=1처럼 양의 정수로 지정해 주세요.');
  return url.href;
}

/** Generate a standalone local review page. Input data is never executable HTML. */
export async function writeOracleHtml(casesInput: unknown, options: OracleHtmlOptions): Promise<{ path: string; cases: number; approved: number }> {
  if (!options.out.endsWith('.html')) throw new Error('검토 화면은 .html 파일로 저장해 주세요.');
  const cases = parseCases(casesInput);
  let workspace = options.workspace === undefined
    ? await createOracleWorkspace(cases, options.title)
    : await validateOracleWorkspace(options.workspace, cases);
  if (options.title !== undefined) workspace = await validateOracleWorkspace({ ...workspace, title: options.title }, cases);

  const rawLinks = options.sourceLinks ?? {};
  assertJson(rawLinks);
  const links = z.record(z.string(), z.string()).parse(rawLinks);
  // Bind links to the evidence shown when this HTML is generated, including saved edits.
  const sourceLinkTargets: Record<string, Case['sources']> = Object.fromEntries(
    workspace.entries.map(entry => [entry.draft.id, entry.draft.sources]),
  );
  const knownSources = new Set(workspace.entries.flatMap(entry => entry.draft.sources.map(source => source.id)));
  const sourceLinks = Object.fromEntries(Object.entries(links).map(([id, href]) => {
    if (!knownSources.has(id)) throw new Error(`평가셋에 없는 출처의 링크입니다: ${id}`);
    const url = new URL(sourceLink(href, options.sourceLinksBase ?? process.cwd()));
    if (options.relativeSourceLinks && url.protocol === 'file:') {
      const local = relative(dirname(resolve(options.out)), fileURLToPath(url));
      return [id, local.split(/[\\/]/).map(encodeURIComponent).join('/') + url.hash];
    }
    return [id, url.href];
  }));
  const bundle = await readFile(new URL('../dist/oracle-ui.bundle.js', import.meta.url), 'utf8');
  // These are trusted build assets, but embedded closing tags would still end an HTML element.
  if (/<\/script\s*[>/]/i.test(bundle) || /<\/style\s*[>/]/i.test(oracleStyles)) {
    throw new Error('검토 화면 빌드에 닫는 HTML 태그가 포함되어 있습니다. 번들을 다시 확인해 주세요.');
  }
  const policy = `default-src 'none'; script-src '${cspHash(bundle)}'; style-src '${cspHash(oracleStyles)}'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src 'none'`;
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="referrer" content="no-referrer">
<title>${text(workspace.title)}</title>
<style>${oracleStyles}</style>
</head>
<body>
<main id="oracle-app"></main>
<noscript>검토 화면을 사용하려면 브라우저의 JavaScript를 켜 주세요.</noscript>
<script type="application/json" id="oracle-data">${inlineJson({ workspace, sourceLinks, sourceLinkTargets })}</script>
<script>${bundle}</script>
</body>
</html>
`;
  const path = resolve(options.out);
  await mkdir(dirname(path), { recursive: true });
  // Refuse overwriting either a previous review page or any other existing input.
  await writeFile(path, html, { encoding: 'utf8', flag: 'wx' });
  return { path, cases: workspace.entries.length, approved: workspace.entries.filter(entry => entry.status === 'approved').length };
}
