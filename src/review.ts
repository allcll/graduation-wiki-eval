import { digest } from './json.js';
import { rubricSchema, reviewSchema, type Review, type Rubric, type CriterionResult } from './schema.js';

type Verdict = CriterionResult['verdict'];
export interface ReviewSummary { answer: Verdict; evidence: Verdict; pending: boolean }

/** Derive dimension verdicts without hiding unfinished criteria behind a failure. */
export function summarizeReview(rubricInput: Rubric, reviewInput: Review): ReviewSummary {
  const rubric = rubricSchema.parse(rubricInput);
  const review = reviewSchema.parse(reviewInput);
  if (review.rubric_sha256 !== digest(rubric)) throw new Error('Review rubric hash mismatch');
  const results = new Map(review.criterion_results.map(item => [item.criterion_id, item]));
  if (results.size !== rubric.criteria.length || rubric.criteria.some(item => !results.has(item.id))) {
    throw new Error('Review must contain exactly the rubric criterion ids');
  }
  const aggregate = (dimension: 'answer' | 'evidence'): Verdict => {
    const verdicts = rubric.criteria.filter(item => item.dimension === dimension).map(item => results.get(item.id)?.verdict);
    return verdicts.includes('fail') ? 'fail' : verdicts.includes('pending') ? 'pending' : 'pass';
  };
  return { answer: aggregate('answer'), evidence: aggregate('evidence'), pending: review.criterion_results.some(item => item.verdict === 'pending') };
}
