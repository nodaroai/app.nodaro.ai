// Types for tools/units/scaffold.mjs (`gen:units -- --new`), for TypeScript callers.
import type { Unit, ValidationContext } from "./manifest.mjs"

export interface ScaffoldOptions {
  type: string
  category: string
  kind: "worker" | "sync" | "inline" | "source" | "use-case"
  label: string
  description: string
  after: string | null
  family: string | null
  pickerAfter: string | null
  price: number | null
  /** The characterization operation it follows (null = first); undefined = none. */
  characterizeAfter?: string | null
  /** worker: the concurrency lane its job counts in (its `lane:*` capability). */
  lane?: "provider" | "llm" | "local"
  /** use-case: its graph builder's key in USE_CASE_SPECS (packages/render-rules/src/use-case-specs.ts). */
  builder?: string
}
export const USAGE: string
export function parseScaffoldArgs(argv: string[]): { opts: Record<string, string | true>; errors: string[] }
export function scaffoldOptions(raw: Record<string, string | true>): { o: ScaffoldOptions; errors: string[] }
export function scaffoldFiles(o: ScaffoldOptions): Map<string, string>
export function unitFromFiles(o: ScaffoldOptions, files: Map<string, string>): Unit
export function planScaffold(raw: Record<string, string | true>, opts: { root: string; ctx?: ValidationContext }): { errors: string[]; files: Map<string, string>; o: ScaffoldOptions }
export function nextSteps(o: ScaffoldOptions): string[]
export function scaffoldMain(
  argv: string[],
  opts: { root: string; out: { write(s: string): unknown }; err: { write(s: string): unknown }; generateAndWrite: (root: string) => Promise<number>; ctx?: ValidationContext },
): Promise<number>
