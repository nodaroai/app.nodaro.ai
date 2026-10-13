/**
 * Migration 509's two `workflow_executions` columns — `inline_graph` (the
 * graph a use-case node's hidden run executes) and `wrapper_job_id` (the job
 * that wraps it) — are named ONLY here.
 *
 * Staging runs dev code against the production database before `main`
 * applies migrations, so until 509 lands the columns are missing. The first
 * read or write that says so (42703 / PGRST204 naming a column) marks them
 * absent for the life of the process; readers then drop them from their
 * select and writers skip them — the migration-466 pattern
 * (`lib/execution-input-overrides.ts`). A use-case run itself cannot degrade:
 * its route refuses with 503 while the columns are absent.
 *
 * `lib/__tests__/execution-inline-graph.test.ts` fails the build when any
 * other backend source file names either column.
 */

/** 42703: undefined column (Postgres); PGRST204: unknown column in a write (PostgREST). */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"])
const GRAPH = "inline_graph"
const WRAPPER = "wrapper_job_id"

let absent = false

/** True (and remembered) when `error` says one of the two columns does not exist. */
export function noteInlineGraphColumnError(
  error: { readonly code?: string | null; readonly message?: string | null } | null | undefined,
): boolean {
  if (!error?.code || !MISSING_COLUMN_CODES.has(error.code)) return false
  if (error.message && !error.message.includes(GRAPH) && !error.message.includes(WRAPPER)) return false
  absent = true
  return true
}

/** Has this process seen the columns missing? */
export function inlineGraphColumnAbsent(): boolean {
  return absent
}

/** `columns` plus the two columns, unless they are known to be missing. */
export function withInlineGraphColumns(columns: string): string {
  return absent ? columns : `${columns}, ${GRAPH}, ${WRAPPER}`
}

/**
 * What app expunge writes over the snapshot: the empty object (it holds the
 * runner's source URLs and instructions — content, like `node_states`). Not
 * NULL: an inline row has no workflow, and the graph-source CHECK requires one
 * of the two. Nothing while the column is missing. A fresh object per call.
 */
export function inlineGraphCleared(): { readonly inline_graph?: Record<string, never> } {
  return absent ? {} : { [GRAPH]: {} }
}

export function resetInlineGraphColumnForTests(): void {
  absent = false
}
