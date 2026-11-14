export const oracleStyles = `
:root {
  color-scheme: light;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Apple SD Gothic Neo",
    "Malgun Gothic",
    sans-serif;
  color: #27313d;
  background: #f6f7f8;
  font-synthesis: none;
  line-height: 1.65;
  font-size: 14px;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
}
button,
input,
select,
textarea {
  font: inherit;
}
button,
a,
input,
select,
textarea,
summary {
  outline-offset: 3px;
}
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 3px solid #7095c1;
}
button {
  cursor: pointer;
  color: #27313d;
  background: white;
  border: 1px solid #cbd1d8;
  border-radius: 5px;
  padding: 7px 12px;
  line-height: 1.45;
}
button:hover {
  background: #f0f3f6;
}
button:disabled {
  cursor: not-allowed;
  opacity: .5;
}
button.primary {
  background: #315c92;
  color: white;
  border-color: #315c92;
}
button.primary:hover {
  background: #284d7a;
}
button.approve {
  background: #23754d;
  color: white;
  border-color: #23754d;
}
button.approve:hover {
  background: #1c603f;
}
button.quiet {
  border-color: transparent;
  background: transparent;
  padding: 4px 6px;
  color: #315c92;
}
button.quiet:hover {
  background: #eaf0f7;
}
input,
select,
textarea {
  max-width: 100%;
  color: #27313d;
  background: white;
  border: 1px solid #cbd1d8;
  border-radius: 4px;
  padding: 8px 9px;
}
textarea {
  width: 100%;
  resize: vertical;
  line-height: 1.6;
}
input[type=search] {
  width: 100%;
}
label {
  display: block;
}
a {
  color: #315c92;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
h1,
h2,
h3,
p {
  margin: 0;
}
h1 {
  font-size: 23px;
  line-height: 1.35;
  letter-spacing: -.6px;
}
h2 {
  font-size: 18px;
  line-height: 1.55;
  letter-spacing: -.25px;
}
h3 {
  font-size: 14px;
  font-weight: 650;
}
p,
li,
td,
dd {
  overflow-wrap: anywhere;
}
small {
  font-size: 12px;
}
.muted {
  color: #657181;
}
.tiny {
  font-size: 12px;
}
.mono {
  font-family:
    ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  font-size: 12px;
}
.flow-text {
  white-space: pre-wrap;
}
.hidden,
[hidden] {
  display: none !important;
}
.oracle-header {
  background: #fff;
  border-bottom: 1px solid #dbe0e5;
  padding: 25px 28px 17px;
}
.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}
.header-copy {
  max-width: 740px;
}
.header-copy p {
  margin-top: 7px;
  color: #657181;
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.toolbar button {
  white-space: nowrap;
}
.summary-strip {
  margin-top: 19px;
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 13px;
}
.summary-strip strong {
  font-size: 15px;
  margin-left: 5px;
}
.summary-strip .summary-total {
  border-right: 1px solid #dbe0e5;
  padding-right: 18px;
}
.summary-strip .complete {
  color: #23754d;
}
.summary-strip .changes {
  color: #946015;
}
.summary-strip progress {
  width: 125px;
  height: 6px;
  border: 0;
  border-radius: 4px;
  overflow: hidden;
  accent-color: #23754d;
  background: #e7ebef;
}
.summary-strip progress::-webkit-progress-bar {
  background: #e7ebef;
}
.summary-strip progress::-webkit-progress-value {
  background: #23754d;
}
.save-hint {
  margin-left: auto;
  font-size: 12px;
  color: #657181;
}
.save-hint.unsaved {
  color: #946015;
}
.notice-area {
  padding: 0 28px;
  background: #fff;
}
.notice {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 11px 0;
  border-top: 1px solid #e3e7ec;
  font-size: 13px;
}
.notice-content {
  flex: 1;
}
.notice .actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.notice.error {
  color: #9d312c;
}
.notice.warning {
  color: #805613;
}
.notice.success {
  color: #23754d;
}
.notice.info {
  color: #315c92;
}
.live-message:empty {
  display: none;
}
.live-message {
  padding: 10px 28px;
  border-bottom: 1px solid #dbe0e5;
  background: #edf3f9;
  color: #315c92;
  font-size: 13px;
}
.live-message.error {
  background: #fff1ef;
  color: #9d312c;
}
.live-message.success {
  background: #edf6f0;
  color: #23754d;
}
.review-layout {
  display: grid;
  grid-template-columns: 265px minmax(0, 1fr);
  min-height: calc(100vh - 155px);
}
.case-sidebar {
  border-right: 1px solid #dbe0e5;
  background: #f6f7f8;
  padding: 20px 15px;
  min-width: 0;
}
.sidebar-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 11px;
  padding: 0 3px;
}
.sidebar-heading h2 {
  font-size: 15px;
}
.filter-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  margin-top: 8px;
}
.filter-grid select {
  width: 100%;
  font-size: 12px;
  padding: 6px 5px;
}
.filter-label {
  font-size: 12px;
  color: #657181;
  margin-bottom: 4px;
}
.case-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
  max-height: calc(100vh - 340px);
  overflow-y: auto;
  scrollbar-width: thin;
}
.case-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  background: transparent;
  border-radius: 4px;
  padding: 11px 9px;
}
.case-item:hover {
  background: #edf0f3;
}
.case-item[aria-current=true] {
  background: #fff;
  border-color: #d4dce6;
  border-left: 3px solid #315c92;
}
.case-item .case-line {
  display: flex;
  justify-content: space-between;
  gap: 5px;
  align-items: center;
}
.case-item .case-id {
  font-size: 11px;
  color: #657181;
  overflow-wrap: anywhere;
}
.case-item .case-question {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.6;
  margin-top: 5px;
}
.case-item .case-origin {
  font-size: 11px;
  color: #657181;
  margin-top: 5px;
}
.status {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.8;
  font-weight: 600;
}
.status.pending {
  color: #596674;
  background: #eef1f4;
}
.status.approved {
  color: #23754d;
  background: #e8f3ec;
}
.status.needs_changes {
  color: #946015;
  background: #fff1d9;
}
.status.on_hold {
  color: #76558d;
  background: #f0eaf5;
}
.status.editing {
  color: #946015;
  background: #fff1d9;
}
.empty-list {
  padding: 20px 7px;
  color: #657181;
  font-size: 13px;
}
.review-main {
  min-width: 0;
  background: white;
}
.case-navigation {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e0e5eb;
  padding: 12px 25px;
  gap: 12px;
}
.case-navigation .nav-buttons {
  display: flex;
  gap: 6px;
}
.case-navigation button {
  font-size: 12px;
  padding: 5px 10px;
}
.case-navigation .position {
  font-size: 12px;
  color: #657181;
}
.case-heading {
  padding: 22px 26px 18px;
  border-bottom: 1px solid #e3e7ec;
}
.case-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 11px;
  font-size: 12px;
  color: #657181;
}
.case-heading .question {
  font-size: 19px;
  font-weight: 600;
  line-height: 1.75;
  letter-spacing: -.25px;
  max-width: 78ch;
}
.case-tags {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.tag {
  font-size: 11px;
  padding: 1px 7px;
  background: #f0f3f6;
  color: #596674;
  border-radius: 3px;
}
.reading-columns {
  display: grid;
  grid-template-columns: minmax(340px, 1.1fr) minmax(300px, 1fr);
  align-items: start;
}
.answer-column {
  padding: 22px 26px 28px;
  min-width: 0;
}
.evidence-column {
  padding: 22px 25px 28px;
  background: #fbfcfd;
  border-left: 1px solid #e3e7ec;
  min-width: 0;
  align-self: stretch;
}
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.section-title h2 {
  font-size: 15px;
}
.section-title .muted {
  font-size: 11px;
}
.reading-section + .reading-section {
  margin-top: 25px;
}
.data-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
  table-layout: fixed;
}
.data-table th,
.data-table td {
  padding: 8px 10px;
  vertical-align: top;
  text-align: left;
  border-bottom: 1px solid #e4e8ed;
  line-height: 1.65;
}
.data-table th {
  font-weight: 500;
  color: #596674;
  width: 40%;
  background: #f6f8fa;
}
.data-table td {
  background: #fff;
}
.data-table tr:first-child th,
.data-table tr:first-child td {
  border-top: 1px solid #dbe1e8;
}
.data-table .raw-key {
  display: block;
  font-size: 10px;
  font-weight: 400;
  color: #798492;
  overflow-wrap: anywhere;
  line-height: 1.4;
  margin-top: 2px;
}
.data-table .nested-table {
  font-size: 12px;
  margin: 0;
}
.nested-table th,
.nested-table td {
  padding: 4px 6px;
}
.value-list {
  margin: 0;
  padding-left: 18px;
}
.value-list li + li {
  margin-top: 3px;
}
.value-true {
  color: #23754d;
  font-weight: 600;
}
.value-false {
  color: #9d312c;
  font-weight: 600;
}
.answer-action {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  font-size: 13px;
}
.answer-action strong {
  font-size: 14px;
}
.action-label {
  color: #657181;
}
.empty-value {
  color: #7b8591;
}
.changed-value {
  background: #fff5df !important;
}
.old-value {
  display: block;
  text-decoration: line-through;
  color: #8a6b40;
  font-size: 12px;
  margin-bottom: 3px;
}
.change-note {
  font-size: 12px;
  color: #946015;
  margin-top: 8px;
}
.inline-details {
  margin-top: 12px;
  border: 1px solid #dfe5eb;
  border-radius: 4px;
  background: #fff;
}
.inline-details summary {
  cursor: pointer;
  padding: 9px 11px;
  color: #435569;
  font-size: 12px;
  font-weight: 600;
}
.inline-details[open] summary {
  border-bottom: 1px solid #e3e7ec;
}
.details-body {
  padding: 12px;
}
.details-body pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  font-size: 12px;
  line-height: 1.65;
}
.rule-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.rule-list li {
  padding: 11px 0;
  border-top: 1px solid #e2e7ed;
}
.rule-list li:first-child {
  padding-top: 0;
  border-top: 0;
}
.rule-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  font-size: 11px;
  color: #657181;
}
.severity {
  font-size: 11px;
  color: #946015;
  background: #fff1d9;
  padding: 0 6px;
  border-radius: 3px;
}
.severity.minor {
  color: #657181;
  background: #eef1f4;
}
.rule-list p {
  font-size: 13px;
  line-height: 1.75;
}
.source-block {
  border-top: 2px solid #d5dfeb;
  padding: 13px 0 15px;
}
.source-block + .source-block {
  margin-top: 12px;
}
.source-heading {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.7;
}
.source-excerpt {
  margin: 11px 0;
  padding: 10px 13px;
  background: #eef3f8;
  border-left: 3px solid #8fa7c6;
  font-size: 14px;
  line-height: 1.85;
  white-space: pre-wrap;
}
.source-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.source-version {
  margin-top: 9px;
  font-size: 11px;
  color: #657181;
  overflow-wrap: anywhere;
}
.source-state {
  font-size: 11px;
  color: #657181;
}
.source-help {
  font-size: 12px;
  color: #657181;
  margin-bottom: 15px;
}
.source-link-missing {
  font-size: 12px;
  color: #946015;
}
.edit-panel {
  margin-top: 19px;
  border-color: #cad8e8;
}
.edit-panel > summary {
  color: #315c92;
}
.editor-field {
  margin-bottom: 13px;
}
.editor-field > span,
.reviewer-field > span,
.note-field > span {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #435569;
  margin-bottom: 5px;
}
.editor-field textarea {
  font-size: 12px;
  min-height: 72px;
}
.editor-field textarea.json-editor {
  font-family:
    ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  tab-size: 2;
}
.editor-field select {
  width: 100%;
}
.editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 13px;
}
.editor-actions .buttons {
  display: flex;
  gap: 6px;
}
.editor-hint {
  font-size: 12px;
  color: #657181;
}
.review-controls {
  border-top: 1px solid #dbe1e8;
  padding: 20px 26px 25px;
  background: #fafcfd;
}
.review-controls h2 {
  font-size: 15px;
  margin-bottom: 12px;
}
.review-form {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 15px;
}
.reviewer-field input {
  width: 100%;
}
.note-field textarea {
  min-height: 76px;
  font-size: 13px;
}
.review-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 13px;
}
.review-actions .approval-hint {
  font-size: 12px;
  color: #657181;
  margin-left: auto;
}
.review-timestamp {
  font-size: 12px;
  color: #23754d;
  margin-top: 11px;
}
.review-dirty {
  font-size: 12px;
  color: #946015;
  margin-top: 9px;
}
.footer-help {
  padding: 15px 28px;
  border-top: 1px solid #dbe1e8;
  font-size: 12px;
  color: #657181;
  background: #fff;
}
.footer-help p + p {
  margin-top: 5px;
}
.load-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}
@media (min-width: 1500px) {
  .answer-column {
    padding-right: 34px;
  }
  .evidence-column {
    padding-left: 30px;
  }
  .review-layout {
    grid-template-columns: 280px minmax(0, 1fr);
  }
}
@media (max-width: 1120px) {
  .reading-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .evidence-column {
    border-left: 0;
    border-top: 1px solid #e3e7ec;
  }
  .review-layout {
    grid-template-columns: 235px minmax(0, 1fr);
  }
  .header-top {
    flex-direction: column;
    gap: 14px;
  }
  .toolbar {
    justify-content: flex-start;
  }
  .case-list {
    max-height: calc(100vh - 380px);
  }
  .save-hint {
    margin-left: 0;
  }
  .review-form {
    grid-template-columns: 170px minmax(0, 1fr);
  }
}
@media (max-width: 700px) {
  .oracle-header {
    padding: 19px 17px 14px;
  }
  h1 {
    font-size: 21px;
  }
  .header-copy p {
    font-size: 12px;
  }
  .toolbar {
    gap: 5px;
  }
  .toolbar button {
    font-size: 12px;
    padding: 7px 9px;
  }
  .summary-strip {
    gap: 9px 13px;
  }
  .summary-strip .summary-total {
    padding-right: 12px;
  }
  .summary-strip progress {
    display: none;
  }
  .save-hint {
    width: 100%;
  }
  .notice-area {
    padding: 0 17px;
  }
  .notice {
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
  }
  .notice .actions {
    flex-wrap: wrap;
  }
  .live-message {
    padding: 10px 17px;
  }
  .review-layout {
    display: block;
  }
  .case-sidebar {
    border-right: 0;
    border-bottom: 1px solid #dbe0e5;
    padding: 14px 17px;
  }
  .case-list {
    max-height: 190px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .case-item {
    padding: 8px;
  }
  .case-item .case-line {
    flex-wrap: wrap;
    gap: 3px;
  }
  .case-item .case-question {
    font-size: 12px;
  }
  .case-item .case-origin {
    display: none;
  }
  .filter-grid {
    grid-template-columns: 1fr 1fr;
  }
  .case-heading {
    padding: 18px 17px;
  }
  .case-heading .question {
    font-size: 17px;
  }
  .case-navigation {
    padding: 10px 17px;
  }
  .answer-column,
  .evidence-column {
    padding: 19px 17px;
  }
  .reading-columns {
    display: block;
  }
  .data-table th {
    width: 42%;
  }
  .data-table th,
  .data-table td {
    padding: 7px 8px;
  }
  .review-controls {
    padding: 19px 17px;
  }
  .review-form {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .reviewer-field input {
    max-width: 260px;
  }
  .review-actions .approval-hint {
    width: 100%;
    margin-left: 0;
  }
  .footer-help {
    padding: 14px 17px;
  }
}
@media (prefers-reduced-motion: reduce) {
  * {
    scroll-behavior: auto !important;
  }
}
@media print {
  .toolbar,
  .case-sidebar,
  .case-navigation,
  .notice-area,
  .edit-panel,
  .review-actions,
  .footer-help {
    display: none !important;
  }
  .review-layout {
    display: block;
  }
  .reading-columns {
    grid-template-columns: 1fr 1fr;
  }
  .oracle-header,
  .answer-column,
  .evidence-column,
  .review-controls {
    padding: 15px;
  }
  .review-controls {
    break-inside: avoid;
  }
  .case-heading .question {
    font-size: 16px;
  }
}
`;
