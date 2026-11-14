export interface CiOptions {
  mode: 'sample' | 'claude'; out: string; dataRoot: string; cases?: string; config?: string;
  model?: string; cliVersion?: string; budgetUsd?: number; maxTurns?: number; effort?: string; timeoutSeconds?: number;
}
export function parseOptions(argv: string[]): CiOptions;
export function relativeInput(value: unknown): string;
export function containedPath(root: string, relative: string): Promise<string>;
export function modelConfig(config: Record<string, unknown>, options: CiOptions): Record<string, unknown>;
export function buildCommands(options: CiOptions, directory?: string): string[][];
export function main(argv?: string[]): Promise<number>;
