// Types for tools/units/gen.mjs, for TypeScript callers (the backend has no allowJs).
import type { ValidationContext } from "./manifest.mjs"

export interface GenerateResult {
  errors: string[]
  outputs: Map<string, string>
  orphans: string[]
  /** gen:skills tables with the units' rows removed (tools/units/handle-prune.mjs). */
  prunes: Map<string, string>
}
export const REPO_ROOT: string
export const GEN_UNITS_OUTPUTS: string[]
export function generate(opts?: { root?: string; ctx?: ValidationContext; readPrice?: (repoPath: string) => Record<string, number> }): Promise<GenerateResult>
export function staleFiles(root: string, result: GenerateResult): string[]
export function writeOutputs(root: string, result: GenerateResult): void
export function main(
  argv?: string[],
  root?: string,
  out?: { write(s: string): unknown },
  err?: { write(s: string): unknown },
  opts?: { ctx?: ValidationContext; readPrice?: (repoPath: string) => Record<string, number> },
): Promise<number>
