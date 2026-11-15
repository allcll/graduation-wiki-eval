import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { parseJson } from '../json.js';

export const normalizeQuote = (text: string) => text.normalize('NFC').replace(/\s/gu, '');
const position = z.number().int().nonnegative();
const extent = z.number().int().positive();
const edges = z.array(z.number().finite()).min(2).max(501).refine(values => values.every((v, i) => i === 0 || v > values[i - 1]!));
const cellSchema = z.strictObject({
  id: z.string().min(1), row: position, column: position, row_span: extent, column_span: extent,
  text: z.string().max(4000), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
const tableSchema = z.strictObject({
  id: z.string().min(1), pdf_page: extent, header_rows: extent,
  row_edges: edges, column_edges: edges,
  layout: z.strictObject({ group_column: position, item_column: position, value_column: position, qualifier_column: position }),
  cells: z.array(cellSchema).min(1).max(10_000),
}).superRefine((table, ctx) => {
  const height = table.row_edges.length - 1, width = table.column_edges.length - 1;
  const roles = Object.values(table.layout);
  if (table.header_rows >= height || new Set(roles).size !== roles.length || roles.some(col => col >= width)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid table column roles or header' }); return;
  }
  const occupied = new Set<string>(), ids = new Set<string>();
  for (const cell of table.cells) {
    if (ids.has(cell.id) || cell.row + cell.row_span > height || cell.column + cell.column_span > width) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate cell ID or span outside grid' }); continue;
    }
    ids.add(cell.id);
    const box = [table.column_edges[cell.column], table.row_edges[cell.row], table.column_edges[cell.column + cell.column_span], table.row_edges[cell.row + cell.row_span]];
    if (box.some((value, i) => value === undefined || Math.abs(value - cell.bbox[i]!) > 0.01)) {
      ctx.addIssue({ code: 'custom', message: 'Cell bounds disagree with its row/column spans' });
    }
    for (let r = cell.row; r < cell.row + cell.row_span; r++) for (let c = cell.column; c < cell.column + cell.column_span; c++) {
      const key = `${r}:${c}`;
      if (occupied.has(key)) ctx.addIssue({ code: 'custom', message: 'Overlapping table cells' });
      occupied.add(key);
    }
  }
  if (occupied.size !== height * width) ctx.addIssue({ code: 'custom', message: 'Missing grid cells; do not fill down unknown cells' });
});
export const tableIndexSchema = z.strictObject({
  schema: z.literal('graduation-wiki-eval/table-index-v1'),
  source_id: z.string().min(1), edition: z.string().min(1), pdf_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  provenance: z.strictObject({ extractor: z.string().min(1), method: z.string().min(1),
    preparation: z.literal('ai_extracted_and_visually_checked'), human_review: z.literal('pending') }),
  tables: z.array(tableSchema).min(1).max(100),
}).refine(index => new Set(index.tables.map(table => table.id)).size === index.tables.length, 'Duplicate table ID');
export type TableIndex = z.infer<typeof tableIndexSchema>;
export interface LoadedTableIndex { index: TableIndex; sha256: string }

/** The source-derived index is a scoring asset, never an answer oracle or a
 * model transcript. Its PDF binding does not replace checking its extraction. */
export async function loadTableIndex(file: string, source: { source_id: string; edition: string; pdf: { sha256: string } }, pages: readonly string[]): Promise<LoadedTableIndex> {
  const bytes = await readFile(file);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('Table index exceeds 4 MiB');
  const index = tableIndexSchema.parse(parseJson(bytes.toString('utf8')));
  if (index.source_id !== source.source_id || index.edition !== source.edition || index.pdf_sha256 !== source.pdf.sha256) {
    throw new Error('Table index does not belong to the pinned source');
  }
  for (const table of index.tables) {
    const page = pages[table.pdf_page - 1];
    if (page === undefined) throw new Error('Table page is outside source');
    // Merged cells can be interleaved by text extraction. Check their individual
    // lines, while the grid (not proximity in the text) establishes relationships.
    for (const cell of table.cells) for (const line of cell.text.split(/\r?\n/)) {
      if (!normalizeQuote(page).includes(normalizeQuote(line))) throw new Error('Table cell text is missing from its source page');
    }
  }
  return { index, sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') };
}

type Cell = z.infer<typeof cellSchema>;
const covers = (cell: Cell, row: number, column: number) => row >= cell.row && row < cell.row + cell.row_span
  && column >= cell.column && column < cell.column + cell.column_span;
export interface TableMatch { table_id: string; rows: number[]; cell_ids: string[] }

/** Supported table quotation: group + (item, value)+ + optional shared
 * qualifier. All characters must be consumed. Never use a bag of page words. */
export function matchTableCitation(quote: string, page: number, index: TableIndex) {
  const text = normalizeQuote(quote);
  const matches: TableMatch[] = [];
  let applicable = false;
  let budgetExceeded = false;
  for (const table of index.tables.filter(table => table.pdf_page === page)) {
    const { group_column, item_column, value_column, qualifier_column } = table.layout;
    const items = table.cells.filter(cell => cell.row >= table.header_rows && cell.column === item_column
      && cell.column_span === 1 && cell.row_span === 1 && normalizeQuote(cell.text));
    const groups = table.cells.filter(cell => cell.row >= table.header_rows && cell.column === group_column
      && cell.column_span === 1 && normalizeQuote(cell.text));
    for (const group of groups) {
      const label = normalizeQuote(group.text);
      if (!text.startsWith(label)) continue;
      const rest = text.slice(label.length);
      // A group heading alone or a prose quote is not a claim joining table cells.
      if (!items.some(item => rest.startsWith(normalizeQuote(item.text)))) continue;
      applicable = true;
      let steps = 0;
      const walk = (remaining: string, rows: number[], ids: string[]) => {
        if (++steps > 2048) { budgetExceeded = true; return; }
        if (rows.length) {
          if (!remaining) matches.push({ table_id: table.id, rows, cell_ids: [group.id, ...ids] });
          else for (const qualifier of table.cells.filter(cell => cell.column === qualifier_column && cell.column_span === 1)) {
            if (normalizeQuote(qualifier.text) === remaining && rows.every(row => covers(qualifier, row, qualifier_column))) {
              matches.push({ table_id: table.id, rows, cell_ids: [group.id, ...ids, qualifier.id] });
            }
          }
        }
        for (const item of items) {
          if (!covers(group, item.row, group_column) || rows.includes(item.row)) continue;
          const value = table.cells.find(cell => covers(cell, item.row, value_column) && cell.column_span === 1);
          if (!value || !normalizeQuote(value.text)) continue;
          const pair = normalizeQuote(item.text) + normalizeQuote(value.text);
          if (remaining.startsWith(pair)) walk(remaining.slice(pair.length), [...rows, item.row], [...ids, item.id, value.id]);
        }
      };
      walk(rest, [], []);
    }
  }
  const unique = [...new Map(matches.map(match => [JSON.stringify(match), match])).values()];
  return { status: budgetExceeded || unique.length > 1 ? 'ambiguous' as const : unique.length === 1 ? 'matched' as const
    : applicable ? 'conflict' as const : 'not_applicable' as const, matches: unique };
}
