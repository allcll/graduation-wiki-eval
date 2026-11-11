import type { Run, Case, Condition } from '../src/schema.js';

// These assertions are compiled by npm run typecheck; the function is not run.
function statusContract(run: Run): string {
  if (run.status === 'ok') {
    // @ts-expect-error Successful runs have no error branch field.
    run.error;
    return run.output.answer_text;
  }
  // @ts-expect-error Failed runs cannot expose an unvalidated response.
  run.output;
  return run.error;
}
function inputContract(item: Case): Condition {
  // @ts-expect-error Condition values are restricted at compile time.
  const invalid: Condition = 'D';
  // @ts-expect-error A boolean is not a policy fact object.
  item.expected.facts = true;
  return invalid;
}
void statusContract;
void inputContract;
