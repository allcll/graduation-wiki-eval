import path from 'node:path';
import { z } from 'zod';

const contextPath = z.string().refine(value => /^context\/(sources|wiki|skills)\/.+/.test(value)
  && !/[\\*?\[\]]/.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
  'Expected an explicit path below context/sources, context/wiki, or context/skills');
const paths = z.array(contextPath).refine(values => new Set(values).size === values.length, 'Duplicate Skill contract paths');
export const skillContractSchema = z.object({
  entrypoints: paths.min(1).refine(values => values.every(value => value.startsWith('context/skills/')), 'Skill entrypoints must belong to context/skills'),
  required_files: paths.default([]),
}).strict();
export type SkillContract = z.infer<typeof skillContractSchema>;

/** Only standalone @file imports are executable references here. Other dependencies
 * must be declared in required_files; we do not guess which prose links are mandatory. */
function documentParts(text: string): { imports: string[]; hasBody: boolean } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const imports: string[] = [];
  let frontmatter = lines[0]?.trim() === '---';
  let fence: string | undefined;
  let hasBody = false;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (frontmatter) {
      if (index > 0 && line === '---') frontmatter = false;
      continue;
    }
    const marker = /^(\x60{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (marker) { fence = marker; continue; }
    if (line.startsWith('@')) {
      if (!/^@\S+$/.test(line)) throw new Error('Unsupported Skill import: use a standalone @relative/path without spaces');
      imports.push(line.slice(1));
    } else if (line && !/^#{1,6}(\s|$)/.test(line) && !/^[-*_]{3,}$/.test(line)) {
      hasBody = true;
    }
  }
  if (frontmatter) throw new Error('Unclosed Skill frontmatter');
  return { imports, hasBody };
}

/** Validate only frozen, allowlisted bytes. Never follow references into the host
 * filesystem or fetch remote documents. This checks presence, not semantic quality. */
export function validateSkillContext(
  files: ReadonlyMap<string, Uint8Array>, skillPaths: readonly string[],
  contract: SkillContract | undefined, execution: 'real' | 'synthetic',
): void {
  if (execution === 'real' && !contract) throw new Error('Real C evaluation requires skill_contract with entrypoints and required_files');
  for (const file of contract?.required_files ?? []) {
    if (!files.has(file)) throw new Error(`Required Skill reference is not allowlisted: ${file}`);
    if (!files.get(file)?.byteLength) throw new Error(`Required Skill reference is empty: ${file}`);
  }
  const complete = new Set<string>();
  const visiting = new Set<string>();
  const visit = (file: string): void => {
    if (complete.has(file)) return;
    if (visiting.has(file)) throw new Error(`Cyclic Skill import: ${file}`);
    const bytes = files.get(file);
    if (!bytes) throw new Error(`Skill body/reference is not allowlisted: ${file}`);
    const doc = documentParts(Buffer.from(bytes).toString('utf8'));
    if (!doc.hasBody && !doc.imports.length) throw new Error(`Skill body is empty: ${file}`);
    visiting.add(file);
    for (const target of doc.imports) {
      if (/^(?:[/~]|[a-z][a-z0-9+.-]*:)/i.test(target) || /[\\*?\[\]#]/.test(target)) {
        throw new Error(`Unsupported Skill import in ${file}: ${target}`);
      }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
      if (!resolved.startsWith('context/')) throw new Error(`Skill import escapes prepared context: ${file} -> ${target}`);
      visit(resolved);
    }
    visiting.delete(file);
    complete.add(file);
  };
  for (const entry of contract?.entrypoints ?? skillPaths.filter(file => /\.md$/i.test(file))) {
    if (!skillPaths.includes(entry)) throw new Error(`Skill entrypoint is not in the Skill allowlist: ${entry}`);
    visit(entry);
  }
  // Supporting Markdown can also contain wrappers, e.g. CLAUDE.md -> PROJECT.md.
  for (const file of skillPaths.filter(file => /\.md$/i.test(file))) {
    const bytes = files.get(file);
    if (!bytes) throw new Error(`Skill file is not allowlisted: ${file}`);
    if (documentParts(Buffer.from(bytes).toString('utf8')).imports.length) visit(file);
  }
}
