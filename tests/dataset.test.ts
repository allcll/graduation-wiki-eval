import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDataset, writeDatasetReview } from '../src/dataset.js';
import { createOracleWorkspace, updateOracleEntry, exportOracleCases } from '../src/oracle-review.js';
import { readRecords } from '../src/json.js';

async function fixture(root: string) {
  await mkdir(root, { recursive: true });
  const drafts = await readRecords('sample/cases.jsonl');
  let workspace = await createOracleWorkspace(drafts);
  for (const entry of workspace.entries) workspace = await updateOracleEntry(workspace, entry.source.id,
    { status: 'approved', reviewer: 'fixture reviewer', note: 'Synthetic software fixture only' });
  const cases = await exportOracleCases(workspace);
  const links = Object.fromEntries(cases.flatMap(item => item.sources.map(source => [source.id, { asset: 'book.pdf', page: 1 }])));
  const contents = {
    'cases.jsonl': cases.map(item => JSON.stringify(item)).join('\n'),
    'drafts.jsonl': drafts.map(item => JSON.stringify(item)).join('\n'),
    'workspace.json': JSON.stringify(workspace), 'links.json': JSON.stringify(links),
    'book.pdf': '%PDF-1.4\nfixture only', 'provenance.json': '{"author":"test fixture"}',
  };
  for (const [name, value] of Object.entries(contents)) await writeFile(join(root, name), value);
  const file = (name: keyof typeof contents) => ({ path: name, sha256: `sha256:${createHash('sha256').update(contents[name]).digest('hex')}` });
  const manifest = { schema: 'graduation-wiki-eval/dataset-v1', id: 'fictional', version: '1.0.0',
    cases: file('cases.jsonl'), drafts: file('drafts.jsonl'), workspace: file('workspace.json'), source_links: file('links.json'),
    assets: [file('book.pdf')], provenance: [file('provenance.json')], pilot_ids: [cases[0]!.id] };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}

test('shared dataset remains verifiable after moving; review folder links survive another move', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'dataset-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await fixture(join(temporary, 'original'));
  const before = await loadDataset(join(temporary, 'original'), 'manifest.json');
  await rename(join(temporary, 'original'), join(temporary, '팀원 checkout'));
  const root = join(temporary, '팀원 checkout');
  assert.equal((await loadDataset(root, 'manifest.json')).dataset_sha256, before.dataset_sha256);
  await writeDatasetReview(root, 'manifest.json', join(temporary, 'review'));
  await assert.rejects(writeDatasetReview(root, 'manifest.json', join(temporary, 'review')), /EEXIST/);
  await rename(join(temporary, 'review'), join(temporary, '옮긴 검토'));
  const htmlPath = join(temporary, '옮긴 검토', 'review.html');
  const html = await readFile(htmlPath, 'utf8');
  assert.ok(!html.includes(temporary));
  assert.ok(!html.includes('file:///'));
  const links = JSON.parse(await readFile(join(temporary, '옮긴 검토', 'source-links.json'), 'utf8')) as Record<string, string>;
  for (const link of Object.values(links)) {
    const url = new URL(link, pathToFileURL(htmlPath));
    assert.equal(url.hash, '#page=1');
    assert.match(await readFile(fileURLToPath(url), 'utf8'), /%PDF/);
    assert.ok(html.includes(link));
  }
  assert.equal((await readRecords(join(temporary, '옮긴 검토', 'pilot.cases.jsonl'))).length, 1);
});

test('changed bytes, stale exports, broken links and escaping symlinks are rejected', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dataset-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let manifest = await fixture(root);
  await writeFile(join(root, 'book.pdf'), 'changed');
  await assert.rejects(loadDataset(root, 'manifest.json'), /checksum mismatch/);
  manifest = await fixture(root);
  const cases = JSON.parse((await readFile(join(root, 'cases.jsonl'), 'utf8')).split('\n')[0]!);
  cases.expected.facts = { changed: true };
  const changed = [JSON.stringify(cases), ...(await readFile(join(root, 'cases.jsonl'), 'utf8')).split('\n').slice(1)].join('\n');
  await writeFile(join(root, 'cases.jsonl'), changed);
  manifest.cases.sha256 = `sha256:${createHash('sha256').update(changed).digest('hex')}`;
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(loadDataset(root, 'manifest.json'), /workspace export/);
  await fixture(root);
  await rm(join(root, 'book.pdf'));
  await assert.rejects(loadDataset(root, 'manifest.json'), /ENOENT/);
  await symlink(fileURLToPath(new URL('../sample/context/original.md', import.meta.url)), join(root, 'book.pdf'));
  await assert.rejects(loadDataset(root, 'manifest.json'), /inside the repository/);
  await assert.rejects(loadDataset(root, '../manifest.json'), /relative/);
});

test('metadata-only is explicit; it never creates a review without the pinned source', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dataset-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await fixture(root);
  await rm(join(root, 'book.pdf'));
  const metadata = await loadDataset(root, 'manifest.json', { metadataOnly: true });
  assert.equal(metadata.source_assets_verified, false);
  await assert.rejects(loadDataset(root, 'manifest.json'), /ENOENT/);
  await assert.rejects(writeDatasetReview(root, 'manifest.json', join(root, 'review')), /ENOENT/);
  await assert.rejects(readFile(join(root, 'review/review.html')), /ENOENT/);
  await writeFile(join(root, 'cases.jsonl'), 'changed');
  await assert.rejects(loadDataset(root, 'manifest.json', { metadataOnly: true }), /checksum mismatch/);
});

test('published 112-case release keeps review bindings, counts and all 82 source links', async () => {
  const dataset = await loadDataset('.', 'datasets/graduation-2026-2/v1/manifest.json', { metadataOnly: true });
  assert.equal(dataset.cases.length, 112);
  assert.equal(dataset.dataset_sha256, 'sha256:8141cfaaad4e275949eb4ba95205b72192f7cbbbc9fb7f49430aef37555861fe');
  assert.equal(dataset.cases.filter(item => item.id.startsWith('CS-')).length, 20);
  assert.equal(dataset.cases.filter(item => item.id.startsWith('OPS-')).length, 5);
  assert.equal(dataset.cases.filter(item => item.origin === 'synthetic').length, 87);
  assert.ok(dataset.cases.every(item => item.split === 'dev'));
  assert.equal(Object.keys(dataset.links).length, 82);
  const { manifest } = dataset;
  for (const file of [manifest.cases, manifest.drafts, manifest.workspace, manifest.source_links, ...manifest.provenance]) {
    const content = await readFile(file.path, 'utf8');
    // Regression guards for known publication exclusions, not a general anonymization proof.
    assert.doesNotMatch(content, /(?:file:\/\/\/|\/Users\/|\/home\/|\/var\/folders\/)/);
    assert.doesNotMatch(content, /github\.com\/allcll\/allcll-graduation-wiki/);
    assert.doesNotMatch(content, /reports\/(?:qa|audits)|cases\.csv#L\d+|triage\.md#L\d+/);
    assert.doesNotMatch(content, /[\w.+-]+@[\w.-]+\.[a-zA-Z]+/);
    assert.doesNotMatch(content, /"(?:student_id|student_number|user_id|email|phone|access_token|api_key)"\s*:/i);
  }
});
