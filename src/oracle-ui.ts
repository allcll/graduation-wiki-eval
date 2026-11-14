import { z } from 'zod';
import { parseJson } from './json-data.js';
import { caseSchema, type Case, type JsonValue, type JsonObject } from './schema.js';
import { validateOracleWorkspace, updateOracleEntry, exportOracleCases, type OracleWorkspace, type OracleEntry, type OracleStatus } from './oracle-review.js';

export interface OracleReviewPayload {
  workspace: OracleWorkspace;
  sourceLinks: Record<string, string>;
  sourceLinkTargets: Record<string, Case['sources']>;
}

const statuses: Record<OracleStatus, string> = { pending: '확인 대기', needs_changes: '수정 필요', on_hold: '보류', approved: '확인 완료' };
const actions: Record<Case['expected']['action'], string> = { answer: '답변 가능', clarify: '추가 정보 요청', escalate: '담당자 확인 필요' };
const keyLabels: Record<string, string> = {
  institution: '학교', policy_edition: '적용 편람', admission_year: '입학 연도', department: '학과·전공', major_type: '전공 유형',
  completed_courses: '이수 과목', combined_credits: '이수 학점 합계', displayed_credits: '화면에 표시된 학점',
  recognized_area_count: '인정되는 영역 수', recognized_credits: '인정 학점', required_area_count: '필요한 영역 수',
  required_credits: '필요한 학점', balance_requirement_met: '균형교양 조건 충족', excluded_area: '제외 영역',
  displayed_excluded_area: '화면에 표시된 제외 영역', remaining_credits: '남은 학점', completed_credits: '이수 학점',
  requested_output: '응답 형식', output_rules: '출력 규칙', action_policy: '행동 판단 기준',
};
const instructionKeys = new Set(['requested_output', 'output_rules', 'action_policy']);
const editorSchema = z.strictObject({
  case_id: z.string(), question: z.string(), inputs: z.string(), facts: z.string(), action: z.enum(['answer', 'clarify', 'escalate']),
  sources: z.string(), rubric: z.string(), tags: z.string(), reviewer: z.string(), note: z.string(),
});
type EditorSnapshot = z.infer<typeof editorSchema>;
const cacheSchema = z.strictObject({ schema: z.literal('oracle-browser-cache-v1'), saved_at: z.string().datetime(), workspace: z.unknown(), editor: editorSchema.nullable() });
type ElementName = keyof HTMLElementTagNameMap;

function el<K extends ElementName>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, action: () => void, className = '', id?: string): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  if (id) node.id = id;
  node.addEventListener('click', action);
  return node;
}

function details(title: string, content: HTMLElement, className = ''): HTMLDetailsElement {
  const node = el('details', `inline-details ${className}`);
  node.append(el('summary', '', title), content);
  return node;
}

function valueView(value: JsonValue): HTMLElement {
  if (value === null) return el('span', 'empty-value', '미지정 (null)');
  if (typeof value === 'boolean') return el('span', value ? 'value-true' : 'value-false', value ? '예 (true)' : '아니요 (false)');
  if (typeof value === 'number') return el('span', '', String(value));
  if (typeof value === 'string') return el('span', 'flow-text', value || '빈 문자열');
  if (Array.isArray(value)) {
    if (!value.length) return el('span', 'empty-value', '항목 없음');
    const list = el('ul', 'value-list');
    for (const item of value) { const row = el('li'); row.append(valueView(item)); list.append(row); }
    return list;
  }
  return valueTable(value, {}, undefined, true);
}

function valueTable(value: JsonObject, descriptions: JsonObject = {}, before?: JsonObject, nested = false): HTMLElement {
  if (!Object.keys(value).length && !Object.keys(before ?? {}).length) return el('p', 'empty-value tiny', '등록된 항목이 없습니다.');
  const table = el('table', `data-table${nested ? ' nested-table' : ''}`);
  const body = el('tbody');
  for (const [key, item] of Object.entries(value)) {
    const row = el('tr');
    const heading = el('th'); heading.scope = 'row';
    const description = descriptions[key];
    const label = typeof description === 'string' ? description : (Object.hasOwn(keyLabels, key) ? keyLabels[key] : key);
    heading.append(el('span', '', label));
    if (label !== key) heading.append(el('span', 'raw-key', key));
    const cell = el('td');
    if (before && (!Object.hasOwn(before, key) || JSON.stringify(before[key]) !== JSON.stringify(item))) {
      cell.classList.add('changed-value');
      const old = el('span', 'old-value');
      old.append(Object.hasOwn(before, key) ? valueView(before[key]!) : el('span', '', '새 항목'));
      cell.append(old);
    }
    cell.append(valueView(item)); row.append(heading, cell); body.append(row);
  }
  if (before) for (const [key, item] of Object.entries(before)) if (!Object.hasOwn(value, key)) {
    const row = el('tr'); const heading = el('th', '', key); heading.scope = 'row';
    const cell = el('td', 'changed-value'); const old = el('span', 'old-value'); old.append(valueView(item));
    cell.append(old, el('span', '', '삭제됨')); row.append(heading, cell); body.append(row);
  }
  table.append(body); return table;
}

function messageOf(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '입력'}: ${issue.message}`).join(' / ');
  return error instanceof Error ? error.message : '처리하지 못했습니다. 입력 내용과 저장 파일을 확인해 주세요.';
}

function download(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = el('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function filename(prefix: string, extension: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 19).replaceAll(':', '')}.${extension}`;
}

function safeSourceLink(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.href);
    if (!['https:', 'http:', 'file:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Runs entirely in the generated page. All case and review validation is shared with the CLI. */
export async function mountOracleReview(payload: OracleReviewPayload): Promise<void> {
  const app = document.getElementById('oracle-app');
  if (!app) throw new Error('검토 화면을 표시할 위치가 없습니다.');
  let workspace = await validateOracleWorkspace(payload.workspace);
  const originals = workspace.entries.map(entry => entry.source);
  const storageKey = `graduation-wiki-eval:oracle:${workspace.dataset_sha256}`;
  let query = '', statusFilter = 'all', originFilter = 'all', lastReviewer = '';
  let busy = false, changedSinceDownload = false, cachePaused = false, cacheFailure = '';
  let pendingStorageConflict = false;
  let recovery: { workspace: OracleWorkspace; editor: EditorSnapshot | null; saved_at: string } | null = null;
  let editor: EditorSnapshot | null = null, baseline: EditorSnapshot | null = null;
  let fields: Record<Exclude<keyof EditorSnapshot, 'case_id' | 'action'>, HTMLTextAreaElement | HTMLInputElement> | null = null;
  let actionField: HTMLSelectElement | null = null;
  let editDetails: HTMLDetailsElement | null = null;
  let saveHint: HTMLElement | null = null, dirtyHint: HTMLElement | null = null, counts: HTMLElement | null = null;
  let messageNode: HTMLElement | null = null, messageText = '', messageKind = 'info';

  const currentEntry = (): OracleEntry => {
    const found = workspace.entries.find(entry => entry.source.id === workspace.selected_case_id);
    if (!found) throw new Error('선택한 문항이 없습니다.');
    return found;
  };
  const dirty = (): boolean => editor !== null && baseline !== null && JSON.stringify(editor) !== JSON.stringify(baseline);
  const snapshot = (): EditorSnapshot | null => {
    if (!fields || !actionField) return editor;
    editor = { case_id: workspace.selected_case_id, question: fields.question.value, inputs: fields.inputs.value,
      facts: fields.facts.value, action: actionField.value as EditorSnapshot['action'], sources: fields.sources.value,
      rubric: fields.rubric.value, tags: fields.tags.value, reviewer: fields.reviewer.value, note: fields.note.value };
    return editor;
  };
  function notify(text: string, kind = 'info'): void {
    messageText = text; messageKind = kind;
    if (messageNode) { messageNode.textContent = text; messageNode.className = `live-message ${kind}`; }
  }
  function updateCounts(): void {
    if (!counts) return;
    counts.replaceChildren();
    const tally: Record<OracleStatus, number> = { pending: 0, approved: 0, needs_changes: 0, on_hold: 0 };
    for (const entry of workspace.entries) {
      const state = entry.source.id === workspace.selected_case_id && dirty() && entry.status === 'approved' ? 'pending' : entry.status;
      tally[state]++;
    }
    const total = el('span', 'summary-total', '전체'); total.append(el('strong', '', `${workspace.entries.length}건`)); counts.append(total);
    for (const [state, className] of [['approved', 'complete'], ['pending', ''], ['needs_changes', 'changes'], ['on_hold', '']] as const) {
      const label = el('span', className, statuses[state]); label.append(el('strong', '', String(tally[state]))); counts.append(label);
    }
    const progress = el('progress'); progress.max = workspace.entries.length; progress.value = tally.approved;
    progress.setAttribute('aria-label', `전체 ${workspace.entries.length}건 중 ${tally.approved}건 확인 완료`); counts.append(progress);
    saveHint = el('span', `save-hint${changedSinceDownload ? ' unsaved' : ''}`, cacheFailure || (changedSinceDownload ? '파일 저장 전 변경 내용이 있습니다.' : '검토 파일로 저장해 두면 다른 브라우저에서도 이어갈 수 있습니다.'));
    counts.append(saveHint);
    const exportButton = document.getElementById('oracle-export');
    if (exportButton instanceof HTMLButtonElement) { exportButton.textContent = `확인한 정답 내보내기 (${tally.approved})`; exportButton.disabled = tally.approved === 0; }
    const current = currentEntry();
    for (const badge of app!.querySelectorAll('.case-heading .status, .case-item[aria-current=true] .status')) {
      badge.className = `status ${dirty() ? 'editing' : current.status}`;
      badge.textContent = dirty() ? '수정 중' : statuses[current.status];
    }
    const timestamp = app!.querySelector<HTMLElement>('.review-timestamp');
    if (timestamp) timestamp.hidden = dirty();
  }
  function cache(): void {
    if (cachePaused || recovery) { updateCounts(); return; }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ schema: 'oracle-browser-cache-v1', saved_at: new Date().toISOString(), workspace, editor: snapshot() }));
      cacheFailure = '';
    } catch { cacheFailure = '브라우저 임시 저장을 사용할 수 없습니다. 검토 파일을 저장해 주세요.'; }
    updateCounts();
  }
  function onEdit(): void {
    snapshot(); changedSinceDownload = true;
    if (dirtyHint) dirtyHint.textContent = dirty() ? '수정 중입니다. 이동하거나 파일을 저장하면 적용됩니다. 확인한 내용을 수정하면 다시 확인해야 합니다.' : '';
    cache();
  }
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true; app!.setAttribute('aria-busy', 'true');
    const controls = [...app!.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('input,button,select,textarea')];
    const previous = controls.map(node => node.disabled);
    controls.forEach(node => { node.disabled = true; });
    try { await action(); }
    catch (error) { const pendingEditor = snapshot(); render(pendingEditor); notify(messageOf(error), 'error'); if (dirty() && editDetails) editDetails.open = true; }
    finally {
      busy = false; app!.removeAttribute('aria-busy');
      controls.forEach((node, index) => { if (node.isConnected) node.disabled = previous[index] ?? false; });
      if (pendingStorageConflict) { pendingStorageConflict = false; showStorageConflict(); }
    }
  }
  function readDraft(): Case {
    const input = snapshot(); if (!input) throw new Error('문항 입력을 읽지 못했습니다.');
    const draft: Record<string, unknown> = { ...currentEntry().draft, question: input.question,
      expected: { action: input.action, facts: parseJson(input.facts) }, sources: parseJson(input.sources), rubric: parseJson(input.rubric) };
    if (input.inputs.trim()) draft['inputs'] = parseJson(input.inputs); else delete draft['inputs'];
    if (input.tags.trim()) draft['tags'] = parseJson(input.tags); else delete draft['tags'];
    return caseSchema.parse(draft);
  }
  async function commit(status?: OracleStatus): Promise<void> {
    const input = snapshot(); if (!input) return;
    const previousEntries = JSON.stringify(workspace.entries);
    workspace = await updateOracleEntry(workspace, workspace.selected_case_id, { draft: readDraft(), reviewer: input.reviewer, note: input.note, ...(status ? { status } : {}) });
    if (previousEntries !== JSON.stringify(workspace.entries)) changedSinceDownload = true;
    if (input.reviewer.trim()) lastReviewer = input.reviewer;
  }
  function filtered(): OracleEntry[] {
    const needle = query.trim().toLocaleLowerCase();
    return workspace.entries.filter(entry => (statusFilter === 'all' || entry.status === statusFilter)
      && (originFilter === 'all' || entry.source.origin === originFilter)
      && (!needle || `${entry.source.id} ${entry.draft.question} ${entry.source.family} ${(entry.draft.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(needle)));
  }
  async function choose(id: string): Promise<void> {
    await commit(); workspace.selected_case_id = id; render(); cache();
  }
  function makeSnapshot(entry: OracleEntry): EditorSnapshot {
    const json = (value: unknown): string => value === undefined ? '' : JSON.stringify(value, null, 2);
    return { case_id: entry.source.id, question: entry.draft.question, inputs: json(entry.draft.inputs), facts: json(entry.draft.expected.facts),
      action: entry.draft.expected.action, sources: json(entry.draft.sources), rubric: json(entry.draft.rubric), tags: json(entry.draft.tags),
      reviewer: entry.reviewer || lastReviewer, note: entry.note };
  }
  async function saveFile(): Promise<void> {
    await commit(); workspace = await validateOracleWorkspace(workspace, originals);
    download(filename('oracle-review', 'json'), JSON.stringify(workspace, null, 2) + '\n', 'application/json');
    changedSinceDownload = false; render(); cache();
    notify('검토 파일 다운로드를 요청했습니다. 저장한 JSON 파일을 다음에 불러와 이어서 검토할 수 있습니다.', 'success');
  }
  async function importFile(file: File): Promise<void> {
    if (file.size > 20 * 1024 * 1024) throw new Error('검토 파일은 20MB 이하만 불러올 수 있습니다.');
    const incoming = await validateOracleWorkspace(parseJson(await file.text()), originals);
    if (dirty() || changedSinceDownload) {
      // Validate edits before allowing a replacement; malformed form text must not disappear.
      readDraft();
      if (!window.confirm('현재 검토 내용을 불러온 파일로 바꿉니다. 아직 파일로 저장하지 않았다면 취소 후 먼저 저장해 주세요.')) return;
    }
    workspace = incoming; editor = null; baseline = null; fields = null; actionField = null;
    recovery = null; cachePaused = false; cacheFailure = ''; changedSinceDownload = false; query = ''; statusFilter = 'all'; originFilter = 'all';
    render(); cache(); notify(`${file.name}에서 검토 내용을 불러왔습니다.`, 'success');
  }
  async function exportCases(): Promise<void> {
    await commit();
    const cases = await exportOracleCases(workspace, { approvedOnly: true });
    download(filename('cases-reviewed', 'jsonl'), cases.map(item => JSON.stringify(item)).join('\n') + '\n', 'application/x-ndjson');
    render(); cache(); notify(`확인 완료한 ${cases.length}건을 내보냈습니다. 수정 필요·보류·대기 문항은 포함하지 않았습니다. 검토 기록은 별도로 저장해 주세요.`, 'success');
  }
  function renderHeader(): HTMLElement {
    const header = el('header', 'oracle-header'); const top = el('div', 'header-top');
    const copy = el('div', 'header-copy'); copy.append(el('h1', '', workspace.title), el('p', '', '질문과 정답 초안을 편람 원문과 대조해 주세요. 여기서 확인하는 것은 모델 답변이 아닌, 평가에 사용할 정답입니다.'));
    const toolbar = el('div', 'toolbar');
    const file = el('input', 'load-input'); file.type = 'file'; file.accept = '.json,application/json'; file.id = 'oracle-import-file'; file.tabIndex = -1;
    file.setAttribute('aria-label', '저장한 검토 파일');
    file.addEventListener('change', () => { const selected = file.files?.[0]; if (selected) void run(() => importFile(selected)); file.value = ''; });
    const approved = workspace.entries.filter(entry => entry.status === 'approved').length;
    const exportButton = button(`확인한 정답 내보내기 (${approved})`, () => { void run(exportCases); }, '', 'oracle-export'); exportButton.disabled = approved === 0;
    toolbar.append(button('검토 파일 불러오기', () => file.click(), '', 'oracle-import'), button('검토 파일 저장', () => { void run(saveFile); }, 'primary', 'oracle-save'), exportButton, file);
    top.append(copy, toolbar); counts = el('div', 'summary-strip'); header.append(top, counts); return header;
  }
  function renderNotices(): HTMLElement {
    const area = el('div', 'notice-area');
    if (recovery) {
      const saved = recovery; const notice = el('div', 'notice info'); const content = el('div', 'notice-content');
      content.append(el('strong', '', '이 브라우저에 이전 검토가 남아 있습니다.'), el('p', 'tiny', `${new Date(saved.saved_at).toLocaleString('ko-KR')} 임시 저장. 다른 기기에서는 다운로드한 검토 파일을 불러와 주세요.`));
      const controls = el('div', 'actions');
      controls.append(button('이전 검토 이어서 보기', () => { void run(async () => {
        workspace = await validateOracleWorkspace(saved.workspace, originals); editor = saved.editor; recovery = null; changedSinceDownload = true;
        render(editor); cache(); notify('브라우저에 저장된 검토 내용을 복구했습니다. 검토 파일로도 저장해 주세요.', 'success');
      }); }, 'primary', 'oracle-restore'), button('현재 파일로 시작', () => { recovery = null; render(); cache(); notify('현재 HTML에 담긴 문항으로 시작했습니다.'); }, '', 'oracle-start-current'));
      notice.append(content, controls); area.append(notice);
    }
    if (cachePaused && !cacheFailure) {
      const notice = el('div', 'notice warning'); const content = el('div', 'notice-content', '다른 창에서 같은 평가셋을 저장했습니다. 이 창의 임시 저장을 멈췄습니다. 검토 파일을 먼저 저장한 뒤 사용할 기록을 선택해 주세요.');
      notice.append(content, button('이 창의 임시 저장 재개', () => { if (window.confirm('다른 창의 임시 저장본을 이 창의 내용으로 바꿀까요? 필요한 검토 파일을 먼저 저장해 주세요.')) { cachePaused = false; render(); cache(); } })); area.append(notice);
    }
    if (cacheFailure) area.append(el('div', 'notice warning', cacheFailure));
    return area;
  }
  function renderSidebar(): HTMLElement {
    const sidebar = el('aside', 'case-sidebar'); sidebar.setAttribute('aria-label', '검토 문항 목록');
    const heading = el('div', 'sidebar-heading'); const visible = filtered();
    heading.append(el('h2', '', '검토 문항'), el('span', 'tiny muted', `${visible.length} / ${workspace.entries.length}`));
    const search = el('input'); search.type = 'search'; search.id = 'oracle-search'; search.placeholder = '질문·문항 번호 검색'; search.value = query; search.setAttribute('aria-label', '질문 또는 문항 번호 검색');
    search.addEventListener('change', () => { void run(async () => { const value = search.value; await commit(); query = value; render(); cache(); document.getElementById('oracle-search')?.focus(); }); });
    const filterGrid = el('div', 'filter-grid');
    for (const [id, title, options, selected, apply] of [
      ['oracle-status-filter', '검토 상태', [['all', '모든 상태'], ...Object.entries(statuses)], statusFilter, (value: string) => { statusFilter = value; }],
      ['oracle-origin-filter', '사례 출처', [['all', '모든 출처'], ['real', '실제 기록 기반'], ['synthetic', '가상 사례']], originFilter, (value: string) => { originFilter = value; }],
    ] as const) {
      const label = el('label'); label.append(el('span', 'filter-label', title)); const select = el('select'); select.id = id;
      for (const [value, text] of options) { const option = el('option', '', text); option.value = value; select.append(option); }
      select.value = selected; select.addEventListener('change', () => { void run(async () => { const value = select.value; await commit(); apply(value); render(); cache(); }); });
      label.append(select); filterGrid.append(label);
    }
    const list = el('ul', 'case-list'); list.id = 'oracle-case-list';
    for (const entry of visible) {
      const item = el('li'); const select = button('', () => { void run(() => choose(entry.source.id)); }, 'case-item');
      select.dataset['caseId'] = entry.source.id; select.setAttribute('aria-current', String(entry.source.id === workspace.selected_case_id));
      const line = el('span', 'case-line'); line.append(el('span', 'case-id', entry.source.id), el('span', `status ${entry.status}`, statuses[entry.status]));
      select.append(line, el('span', 'case-question', entry.draft.question), el('span', 'case-origin', entry.source.origin === 'real' ? '실제 기록 기반' : '가상 사례'));
      item.append(select); list.append(item);
    }
    if (!visible.length) list.append(el('li', 'empty-list', '조건에 맞는 문항이 없습니다. 검색어나 필터를 바꿔 주세요.'));
    sidebar.append(heading, search, filterGrid, list); return sidebar;
  }
  function renderNavigation(): HTMLElement {
    const visible = filtered(); const index = visible.findIndex(entry => entry.source.id === workspace.selected_case_id);
    const nav = el('nav', 'case-navigation'); nav.setAttribute('aria-label', '문항 이동');
    nav.append(el('span', 'position', index >= 0 ? `선택한 목록에서 ${index + 1} / ${visible.length}` : '현재 문항은 선택한 필터에 포함되지 않습니다.'));
    const buttons = el('div', 'nav-buttons');
    buttons.append(button('검토 기록', () => { document.getElementById('oracle-review-controls')?.scrollIntoView({ block: 'center' }); document.getElementById('oracle-reviewer')?.focus({ preventScroll: true }); }, 'quiet', 'oracle-jump-review'));
    const prev = visible[index - 1], next = visible[index + 1];
    const previousButton = button('이전 문항', () => { if (prev) void run(() => choose(prev.source.id)); }, '', 'oracle-previous'); previousButton.disabled = !prev;
    const nextButton = button('다음 문항', () => { if (next) void run(() => choose(next.source.id)); }, '', 'oracle-next'); nextButton.disabled = !next;
    buttons.append(previousButton, nextButton); nav.append(buttons); return nav;
  }
  function renderCaseHeading(entry: OracleEntry): HTMLElement {
    const header = el('div', 'case-heading'); const meta = el('div', 'case-meta');
    meta.append(el('span', '', entry.source.id), el('span', `status ${entry.status}`, statuses[entry.status]),
      el('span', '', entry.source.origin === 'real' ? '실제 기록 기반' : '가상 사례'), el('span', '', entry.source.split === 'dev' ? '개발·회귀 검증용' : '독립 평가용'));
    header.append(meta, el('h2', 'question', entry.draft.question));
    if (entry.source.question !== entry.draft.question) { const before = el('div', 'details-body'); before.append(el('p', 'tiny flow-text', entry.source.question)); header.append(details('처음 질문과 비교', before)); }
    if (entry.draft.tags?.length) { const tags = el('div', 'case-tags'); for (const tag of entry.draft.tags) tags.append(el('span', 'tag', tag)); header.append(tags); }
    return header;
  }
  function section(title: string, hint = ''): HTMLElement {
    const node = el('section', 'reading-section'); const heading = el('div', 'section-title'); heading.append(el('h2', '', title)); if (hint) heading.append(el('span', 'muted', hint)); node.append(heading); return node;
  }
  function renderAnswer(entry: OracleEntry): HTMLElement {
    const column = el('div', 'answer-column'); const inputs = entry.draft.inputs ?? {};
    const inputSection = section('질문의 조건');
    inputSection.append(valueTable(Object.fromEntries(Object.entries(inputs).filter(([key]) => !instructionKeys.has(key)))));
    const rules = Object.fromEntries(Object.entries(inputs).filter(([key]) => instructionKeys.has(key)));
    if (Object.keys(rules).length) { const body = el('div', 'details-body'); body.append(valueTable(rules)); inputSection.append(details('응답 형식·공통 지침', body)); }
    const expected = section('기대하는 정답', '원문과 대조할 초안'); const action = el('div', 'answer-action');
    action.append(el('span', 'action-label', '기대 행동'));
    if (entry.source.expected.action !== entry.draft.expected.action) action.append(el('del', 'muted', actions[entry.source.expected.action]));
    action.append(el('strong', '', actions[entry.draft.expected.action])); expected.append(action);
    const requested = inputs['requested_output'];
    const factsDescription = requested && typeof requested === 'object' && !Array.isArray(requested) ? requested['facts'] : undefined;
    expected.append(valueTable(entry.draft.expected.facts, factsDescription && typeof factsDescription === 'object' && !Array.isArray(factsDescription) ? factsDescription : {}, entry.source.expected.facts));
    if (JSON.stringify(entry.draft.expected) !== JSON.stringify(entry.source.expected)) expected.append(el('p', 'change-note', '노란색은 처음 정답지에서 수정한 항목입니다.'));
    const rubric = section('판단할 때 확인할 점'); const list = el('ul', 'rule-list');
    for (const criterion of entry.draft.rubric.criteria) {
      const item = el('li'); const meta = el('div', 'rule-meta');
      meta.append(el('span', `severity ${criterion.severity}`, criterion.severity === 'blocker' ? '치명 오류' : criterion.severity === 'major' ? '필수 확인' : '개선 권고'), el('span', '', criterion.dimension === 'evidence' ? '근거' : '답변'));
      item.append(meta, el('p', '', criterion.description)); list.append(item);
    }
    rubric.append(list); column.append(expected, inputSection, rubric, renderEditor()); return column;
  }
  function renderEvidence(entry: OracleEntry): HTMLElement {
    const column = el('aside', 'evidence-column'); column.setAttribute('aria-label', '정답의 근거 자료');
    const heading = el('div', 'section-title'); heading.append(el('h2', '', '편람·원문 근거'), el('span', 'muted', `${entry.draft.sources.length}개 자료`));
    column.append(heading, el('p', 'source-help', '발췌문과 원문에서 적용 학번·학과·예외 조건을 함께 확인해 주세요. 근거가 등록되어 있어도 사람의 확인이 끝난 것은 아닙니다.'));
    for (const source of entry.draft.sources) {
      const article = el('section', 'source-block');
      article.append(el('h3', 'source-heading', source.locator), el('blockquote', 'source-excerpt', source.excerpt));
      const footer = el('div', 'source-footer'); footer.append(el('span', 'source-state', source.authoritative ? '정답 원출처로 지정됨' : '보조 자료'));
      const target = payload.sourceLinkTargets[entry.source.id]?.find(item => item.id === source.id);
      const unchanged = target && target.locator === source.locator && target.version === source.version
        && target.excerpt === source.excerpt && target.authoritative === source.authoritative;
      const url = unchanged ? safeSourceLink(payload.sourceLinks[source.id]) : undefined;
      if (url) { const link = el('a', '', '원문 페이지 열기'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; footer.append(link); }
      else footer.append(el('span', 'source-link-missing', unchanged ? '원문 링크 미등록' : '수정한 근거의 링크를 다시 연결해 주세요.'));
      article.append(footer);
      const version = source.version.split(';')[0] ?? source.version;
      article.append(el('p', 'source-version', `자료 버전: ${version}`));
      const body = el('div', 'details-body'); body.append(el('p', 'tiny muted flow-text', `자료 ID: ${source.id}\n전체 버전: ${source.version}`));
      article.append(details('자료 식별 정보', body)); column.append(article);
    }
    return column;
  }
  function renderEditor(): HTMLElement {
    if (!editor) throw new Error('편집 상태가 없습니다.');
    const body = el('div', 'details-body');
    body.append(el('p', 'editor-hint', '수정한 내용은 이 검토 파일에만 반영됩니다. 정답의 숫자·문자열·참/거짓 타입을 유지해 주세요.'));
    const ownFields: Partial<Record<Exclude<keyof EditorSnapshot, 'case_id' | 'action'>, HTMLTextAreaElement | HTMLInputElement>> = {};
    function textField(key: Exclude<keyof EditorSnapshot, 'case_id' | 'action' | 'reviewer' | 'note'>, title: string, rows: number, target: HTMLElement, json = true): void {
      const label = el('label', 'editor-field'); label.append(el('span', '', title));
      const input = el('textarea', json ? 'json-editor' : ''); input.id = `oracle-edit-${key}`; input.rows = rows; input.value = editor![key];
      input.spellcheck = false; input.addEventListener('input', onEdit); ownFields[key] = input; label.append(input); target.append(label);
    }
    textField('question', '질문', 4, body, false);
    const actionLabel = el('label', 'editor-field'); actionLabel.append(el('span', '', '기대 행동'));
    actionField = el('select'); actionField.id = 'oracle-edit-action';
    for (const [value, label] of Object.entries(actions)) { const option = el('option', '', `${label} (${value})`); option.value = value; actionField.append(option); }
    actionField.value = editor.action; actionField.addEventListener('change', onEdit); actionLabel.append(actionField); body.append(actionLabel);
    textField('facts', '정답 값 (JSON)', 7, body);
    const advanced = el('div', 'details-body');
    textField('inputs', '입력 조건 (JSON, 비워두면 항목 제거)', 8, advanced);
    textField('sources', '편람 근거 (JSON)', 10, advanced);
    textField('rubric', '채점 기준 (JSON)', 10, advanced);
    textField('tags', '분류 태그 (JSON, 비워두면 항목 제거)', 3, advanced);
    body.append(details('조건·근거·기준 수정', advanced));
    const controls = el('div', 'editor-actions'); const buttons = el('div', 'buttons');
    buttons.append(button('수정 내용 적용', () => { void run(async () => { const wasApproved = currentEntry().status === 'approved'; await commit(); changedSinceDownload = true; render(); cache(); notify(wasApproved && currentEntry().status !== 'approved' ? '수정 내용을 적용했습니다. 변경한 정답을 다시 확인해 주세요.' : '수정 내용을 적용했습니다.', 'success'); }); }, '', 'oracle-apply-edit'),
      button('입력 되돌리기', () => { if (!dirty() || window.confirm('아직 적용하지 않은 입력을 마지막 검토 상태로 되돌릴까요?')) { editor = null; render(); cache(); notify('아직 적용하지 않은 입력을 되돌렸습니다.'); } }, 'quiet', 'oracle-reset-edit'));
    controls.append(buttons); body.append(controls);
    // Review controls attach the final two inputs after this editor is rendered.
    fields = ownFields as Record<Exclude<keyof EditorSnapshot, 'case_id' | 'action'>, HTMLTextAreaElement | HTMLInputElement>;
    editDetails = details('질문·정답 수정', body, 'edit-panel'); editDetails.id = 'oracle-editor'; return editDetails;
  }
  function renderReview(entry: OracleEntry): HTMLElement {
    if (!editor || !fields) throw new Error('검토 입력을 준비하지 못했습니다.');
    const controls = el('section', 'review-controls'); controls.id = 'oracle-review-controls'; controls.append(el('h2', '', '검토 기록'));
    const form = el('div', 'review-form');
    const reviewer = el('label', 'reviewer-field'); reviewer.append(el('span', '', '검토자'));
    const reviewerInput = el('input'); reviewerInput.id = 'oracle-reviewer'; reviewerInput.type = 'text'; reviewerInput.autocomplete = 'name'; reviewerInput.placeholder = '이름 또는 팀 내 ID'; reviewerInput.value = editor.reviewer; reviewerInput.addEventListener('input', onEdit); fields.reviewer = reviewerInput; reviewer.append(reviewerInput);
    const note = el('label', 'note-field'); note.append(el('span', '', '검토 의견'));
    const noteInput = el('textarea'); noteInput.id = 'oracle-note'; noteInput.rows = 2; noteInput.placeholder = '확인한 내용, 바꿔야 할 부분, 추가로 확인할 근거를 남겨 주세요.'; noteInput.value = editor.note; noteInput.addEventListener('input', onEdit); fields.note = noteInput; note.append(noteInput); form.append(reviewer, note);
    const row = el('div', 'review-actions');
    const decide = (status: OracleStatus): void => { void run(async () => {
      await commit(status); changedSinceDownload = true; render(); cache();
      const current = currentEntry();
      notify(status === 'approved' && current.status !== 'approved' ? '수정 내용을 저장하고 확인 대기로 바꿨습니다. 변경한 정답을 다시 읽은 뒤 확인 완료를 눌러 주세요.' : `${statuses[current.status]}로 기록했습니다.`, current.status === 'approved' ? 'success' : 'info');
    }); };
    row.append(button('확인 완료', () => decide('approved'), 'approve', 'oracle-approve'), button('수정 필요', () => decide('needs_changes'), '', 'oracle-needs-changes'), button('보류', () => decide('on_hold'), '', 'oracle-hold'));
    if (entry.status !== 'pending') row.append(button('확인 대기로 변경', () => decide('pending'), 'quiet', 'oracle-pending'));
    row.append(el('span', 'approval-hint', '확인 완료한 문항만 평가셋으로 내보냅니다.'));
    dirtyHint = el('p', 'review-dirty'); dirtyHint.setAttribute('aria-live', 'polite');
    controls.append(form, row, dirtyHint);
    if (entry.reviewed_at) controls.append(el('p', 'review-timestamp', `${entry.reviewer}님이 ${new Date(entry.reviewed_at).toLocaleString('ko-KR')}에 확인했습니다.`));
    return controls;
  }
  function render(restored?: EditorSnapshot | null): void {
    const entry = currentEntry(); editor = makeSnapshot(entry); baseline = structuredClone(editor);
    if (restored?.case_id === entry.source.id) editor = restored;
    fields = null; actionField = null;
    app!.replaceChildren(); app!.append(renderHeader(), renderNotices());
    messageNode = el('div', `live-message ${messageKind}`, messageText); messageNode.id = 'oracle-message'; messageNode.setAttribute('role', 'status'); messageNode.setAttribute('aria-live', 'polite'); app!.append(messageNode);
    const layout = el('div', 'review-layout'); const main = el('article', 'review-main');
    main.append(renderNavigation(), renderCaseHeading(entry)); const columns = el('div', 'reading-columns'); columns.append(renderAnswer(entry), renderEvidence(entry));
    main.append(columns, renderReview(entry)); layout.append(renderSidebar(), main); app!.append(layout);
    const footer = el('footer', 'footer-help'); footer.append(el('p', '', '검토 파일에는 정답과 검토 의견이 포함됩니다. 모델 입력 자료와 분리해 보관해 주세요.'), el('p', '', '브라우저 임시 저장은 같은 브라우저에서 복구할 때 사용합니다. 다운로드한 검토 파일이 있어야 다른 기기에서도 이어서 검토할 수 있습니다. 원본 사례 파일은 바뀌지 않습니다.')); app!.append(footer);
    updateCounts();
    if (dirty()) { if (editDetails) editDetails.open = true; if (dirtyHint) dirtyHint.textContent = '이전에 작성하던 입력을 복구했습니다. 내용을 확인하고 적용해 주세요.'; }
    if (recovery) {
      // Resolve recovery before editing, so the previous browser copy cannot be overwritten accidentally.
      for (const node of layout.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input,select,textarea,button')) node.disabled = true;
      for (const id of ['oracle-save', 'oracle-export']) { const node = document.getElementById(id); if (node instanceof HTMLButtonElement) node.disabled = true; }
    }
  }

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const candidate = cacheSchema.parse(parseJson(saved));
      const restored = await validateOracleWorkspace(candidate.workspace, originals);
      if (candidate.editor && candidate.editor.case_id !== restored.selected_case_id) throw new Error('임시 저장의 편집 문항이 일치하지 않습니다.');
      recovery = { workspace: restored, editor: candidate.editor, saved_at: candidate.saved_at };
    }
  } catch (error) { cacheFailure = `이전 임시 저장을 복구하지 못했습니다. 다운로드한 검토 파일을 불러와 주세요. ${messageOf(error)}`; cachePaused = true; }
  render();
  window.addEventListener('beforeunload', event => {
    if (changedSinceDownload || dirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  function showStorageConflict(): void {
    const pendingEditor = snapshot(); cachePaused = true; cacheFailure = ''; render(pendingEditor);
    notify('다른 창에서 검토 기록을 저장했습니다. 이 창의 내용은 파일로 저장해 보관할 수 있습니다.');
  }
  window.addEventListener('storage', event => {
    if (event.key === storageKey && event.newValue !== null) {
      cachePaused = true;
      // Keep the disabled form intact until the in-flight validation/save finishes.
      if (busy) pendingStorageConflict = true;
      else showStorageConflict();
    }
  });
}
