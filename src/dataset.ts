import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { digest, parseJson, readRecords } from './json.js';
import { parseCases } from './schema.js';
import { makePlan } from './evaluate.js';
import { exportOracleCases, validateOracleWorkspace } from './oracle-review.js';
import { writeOracleHtml } from './oracle-html.js';

const relativePath = z.string().min(1).refine(value => !path.isAbsolute(value) &&
  !/[\\:#?]/.test(value) && !value.split('/').some(part => ['', '.', '..'].includes(part)), 'Use a repository-relative path');
const file = z.strictObject({ path: relativePath, sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/) });
export const datasetManifestSchema = z.strictObject({
  schema: z.literal('graduation-wiki-eval/dataset-v1'),
  id: z.string().min(1), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  cases: file, drafts: file, workspace: file, source_links: file,
  assets: z.array(file).min(1), provenance: z.array(file).min(1),
  pilot_ids: z.array(z.string().min(1)).min(1),
});
const linksSchema = z.record(z.string(), z.strictObject({ asset: relativePath, page: z.number().int().positive() }));

async function resolveFile(root: string, name: string): Promise<string> {
  relativePath.parse(name);
  const resolved = await realpath(path.join(root, name));
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) {
    throw new Error('Dataset file must remain inside the repository');
  }
  return resolved;
}

/** Verify bytes, review bindings and the exported oracle before using a shared release. */
export async function loadDataset(rootPath: string, manifestPath: string, options: { metadataOnly?: boolean } = {}) {
  const root = await realpath(rootPath);
  const manifest = datasetManifestSchema.parse(parseJson(await readFile(await resolveFile(root, manifestPath), 'utf8')));
  const files = [manifest.cases, manifest.drafts, manifest.workspace, manifest.source_links, ...manifest.assets, ...manifest.provenance];
  if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('Duplicate manifest paths');
  for (const file of files) {
    if (options.metadataOnly && manifest.assets.some(asset => asset.path === file.path)) continue;
    const bytes = await readFile(await resolveFile(root, file.path));
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== file.sha256) throw new Error(`Dataset checksum mismatch: ${file.path}`);
  }
  const cases = parseCases(await readRecords(path.join(root, manifest.cases.path)));
  const drafts = parseCases(await readRecords(path.join(root, manifest.drafts.path)));
  const workspace = await validateOracleWorkspace(parseJson(await readFile(path.join(root, manifest.workspace.path), 'utf8')), drafts);
  if (digest(await exportOracleCases(workspace)) !== digest(cases)) throw new Error('Cases differ from the approved workspace export');
  const ids = new Set(cases.map(item => item.id));
  if (new Set(manifest.pilot_ids).size !== manifest.pilot_ids.length || manifest.pilot_ids.some(id => !ids.has(id))) throw new Error('Invalid pilot case IDs');
  const links = linksSchema.parse(parseJson(await readFile(path.join(root, manifest.source_links.path), 'utf8')));
  const sourceIds = new Set(cases.flatMap(item => item.sources.map(source => source.id)));
  for (const [id, link] of Object.entries(links)) {
    if (!sourceIds.has(id) || !manifest.assets.some(file => file.path === link.asset) || !link.asset.toLowerCase().endsWith('.pdf')) {
      throw new Error(`Source link must reference a known source and a pinned PDF: ${id}`);
    }
  }
  if ([...sourceIds].some(id => !Object.hasOwn(links, id))) throw new Error('Source links are missing from the dataset');
  return { root, manifest, cases, drafts, workspace, links, dataset_sha256: makePlan(cases).dataset_sha256, source_assets_verified: !options.metadataOnly };
}

/** A movable review folder; no user-specific paths are written into HTML or JSON. */
export async function writeDatasetReview(root: string, manifestPath: string, out: string) {
  const dataset = await loadDataset(root, manifestPath);
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await mkdir(out);
  await mkdir(path.join(out, 'sources'));
  const assetNames = new Map<string, string>();
  for (const asset of dataset.manifest.assets) {
    const name = `sources/${asset.sha256.slice(7)}${path.extname(asset.path).toLowerCase()}`;
    if (![...assetNames.values()].includes(name)) await copyFile(path.join(dataset.root, asset.path), path.join(out, name));
    assetNames.set(asset.path, name);
  }
  const links = Object.fromEntries(Object.entries(dataset.links).map(([id, link]) => [id, `${assetNames.get(link.asset)}#page=${link.page}`]));
  for (const [name, value] of Object.entries({ 'review.workspace.json': dataset.workspace, 'source-links.json': links,
    'dataset-lock.json': { manifest: dataset.manifest, dataset_sha256: dataset.dataset_sha256 } })) {
    await writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  }
  for (const [name, cases] of [['cases.jsonl', dataset.cases], ['pilot.cases.jsonl', dataset.cases.filter(item => dataset.manifest.pilot_ids.includes(item.id))]] as const) {
    await writeFile(path.join(out, name), cases.map(item => JSON.stringify(item)).join('\n') + '\n', { flag: 'wx' });
  }
  return writeOracleHtml(dataset.drafts, { out: path.join(out, 'review.html'), workspace: dataset.workspace,
    sourceLinks: links, sourceLinksBase: path.resolve(out), relativeSourceLinks: true });
}
