export const COMMENT_MARKER: string;
export const PREVIEW_WORKFLOW_NAME: 'evaluation-preview';
interface Repository { owner: string; repo: string }
interface CommentWrite extends Repository { body: string }
export interface CommentApi {
  rest: {
    pulls: { get(args: Repository & { pull_number: number }): Promise<{ data: unknown }> };
    issues: {
      listComments(args: Repository & { issue_number: number; per_page: number; page: number }): Promise<{ data: unknown }>;
      updateComment(args: CommentWrite & { comment_id: number }): Promise<unknown>;
      createComment(args: CommentWrite & { issue_number: number }): Promise<{ data: unknown }>;
    };
  };
}
export interface PublishArgs extends Repository {
  github: CommentApi;
  workflowRun: unknown;
  summary: unknown;
}
export interface CommentResult {
  status: 'created' | 'updated' | 'unchanged' | 'skipped';
  reason?: string;
  commentId?: number;
}
export function publishEvaluationComment(args: PublishArgs): Promise<CommentResult>;
