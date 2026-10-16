/**
 * Migration 509's two `workflow_executions` columns — `inline_graph` (the
 * graph a use-case node's hidden run executes) and `wrapper_job_id` (the job
 * that wraps it) — are named ONLY here.
 *
 * Staging runs dev code against the production database before `main`
 * applies migrations, so until 509 lands the columns are missing. The first
 * read or write that says so (42703 / PGRST204 naming a column) marks them
 * absent; readers then drop them from their select and writers skip them —
 * the migration-466 pattern (`lib/execution-input-overrides.ts`). A use-case
 * run itself cannot degrade: its route refuses with 503 while the columns are
 * absent.
 *
 * The readers a use-case run depends on (its graph, its wrapper's finaliser,
 * the reconcile sweep) ignore that memo: an inline run or a wrapper existing
 * proves the columns exist, and a worker that saw them missing before the
 * migration reached the database must not fail every later run until it
 * restarts. Each asks for the columns by name and clears the memo when the
 * read succeeds (decided 2026-10-13).
 *
 * `lib/__tests__/execution-inline-graph.test.ts` fails the build when any
 * other backend source file names either column.
 */
import { isStoredInlineGraph, usecaseDescriptor, usecaseResultKind, type StoredInlineGraph } from "@nodaro/render-rules"
import { supabase } from "./supabase.js"

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

/** The two columns an inline execution is inserted with. A fresh object per call. */
export function inlineExecutionColumns(graph: StoredInlineGraph, wrapperJobId: string): Readonly<Record<string, unknown>> {
  return { [GRAPH]: graph, [WRAPPER]: wrapperJobId }
}

/**
 * The snapshot a row holds; null for anything that is not one (an expunged
 * row's `{}` included). Its result kind must be its own type's: a snapshot
 * whose output map promises another type's result (a Tighten run read as
 * chapters, say) is no snapshot of that run. A P1 snapshot names no kind — an
 * episode, Tighten Episode's own.
 */
export function inlineGraphOf(row: Readonly<Record<string, unknown>> | null | undefined): StoredInlineGraph | null {
  const value = row?.[GRAPH]
  if (!isStoredInlineGraph(value)) return null
  return usecaseResultKind(value.outputMap) === usecaseDescriptor(value.nodeType).resultKind ? value : null
}

/** The wrapper job a row reports to; null when it names none. */
export function wrapperJobIdOf(row: Readonly<Record<string, unknown>> | null | undefined): string | null {
  const value = row?.[WRAPPER]
  return typeof value === "string" && value.length > 0 ? value : null
}

/** The graph an inline execution runs; null when absent, unreadable, or the column is missing. Asks whatever the memo says. */
export async function loadInlineGraph(executionId: string): Promise<StoredInlineGraph | null> {
  const { data, error } = await supabase.from("workflow_executions").select(GRAPH).eq("id", executionId).maybeSingle()
  if (error) {
    if (!noteInlineGraphColumnError(error)) {
      console.warn(`[execution-inline-graph] read failed for ${executionId}: ${error.message}`)
    }
    return null
  }
  absent = false
  return inlineGraphOf(data as Record<string, unknown> | null)
}

/** An execution as its use-case wrapper's finaliser reads it. */
export interface InlineExecutionRow {
  readonly id: string
  readonly userId: string
  readonly status: string
  readonly nodeStates: Readonly<Record<string, unknown>>
  readonly totalCreditsUsed: number
  readonly errorMessage: string | null
  readonly wrapperJobId: string | null
  readonly inlineGraph: StoredInlineGraph | null
}

/**
 * A failed read of a reader the wrapper lifecycle depends on: null when it
 * says the columns are missing (remembered), otherwise it throws — a
 * transient error must never read as "no run", which the sweep would answer
 * by failing a live wrapper and refunding its fee.
 */
function wrapperReadFailed(error: { readonly code?: string | null; readonly message?: string | null }, what: string): null {
  if (noteInlineGraphColumnError(error)) return null
  throw new Error(`[execution-inline-graph] ${what}: ${error.message ?? "read failed"}`)
}

/**
 * The newest execution of the wrapper's owner reporting to it (the sweep's
 * fallback for an unstamped wrapper). Another user's row naming the wrapper
 * is not its run. Throws on a read error.
 */
export async function findExecutionIdForWrapper(wrapperJobId: string, ownerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("workflow_executions")
    .select("id")
    .eq(WRAPPER, wrapperJobId)
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return wrapperReadFailed(error, `run lookup failed for wrapper ${wrapperJobId}`)
  absent = false
  const id = (data as { id?: unknown } | null)?.id
  return typeof id === "string" ? id : null
}

/** An execution as its use-case wrapper's finaliser reads it; null when there is none or the columns are missing. Throws on a read error. */
export async function loadExecutionForWrapper(executionId: string): Promise<InlineExecutionRow | null> {
  const { data, error } = await supabase
    .from("workflow_executions")
    .select(`id, user_id, status, node_states, total_credits_used, error_message, ${GRAPH}, ${WRAPPER}`)
    .eq("id", executionId)
    .maybeSingle()
  if (error) return wrapperReadFailed(error, `wrapper read failed for ${executionId}`)
  absent = false
  if (!data) return null
  const row = data as unknown as Record<string, unknown>
  return {
    id: String(row.id),
    userId: String(row.user_id),
    status: String(row.status),
    nodeStates: (row.node_states ?? {}) as Record<string, unknown>,
    totalCreditsUsed: typeof row.total_credits_used === "number" ? row.total_credits_used : 0,
    errorMessage: typeof row.error_message === "string" ? row.error_message : null,
    wrapperJobId: wrapperJobIdOf(row),
    inlineGraph: inlineGraphOf(row),
  }
}

/** How long a probe that found the columns missing is believed before asking again. */
export const INLINE_GRAPH_PROBE_RETRY_MS = 60_000

/** Set once a probe saw the columns (a column never goes away). */
let probedPresent = false
/** When a probe last found them missing; null when none did. */
let probedAbsentAt: number | null = null

/**
 * Asked BEFORE a use-case route writes anything (its wrapper, its fee hold):
 * do the columns exist? The memo above learns only from a failed write, which
 * would come after the wrapper and the hold. A zero-row select of both
 * columns answers it up front. Present is remembered for the process and
 * clears the memo (else the run start would still refuse, after the hold).
 * Missing is believed for `INLINE_GRAPH_PROBE_RETRY_MS`, then asked again, so
 * a process that started before the migration reached the database notices it
 * without a restart. Any other error is no answer: nothing is cached and the
 * route goes on — its run start is the second line of defence.
 */
export async function ensureInlineGraphColumns(now: () => number = Date.now): Promise<boolean> {
  if (probedPresent) return true
  if (probedAbsentAt !== null && now() - probedAbsentAt < INLINE_GRAPH_PROBE_RETRY_MS) return false
  const { error } = await supabase.from("workflow_executions").select(`${GRAPH}, ${WRAPPER}`).limit(0).maybeSingle()
  if (!error) {
    probedPresent = true
    probedAbsentAt = null
    absent = false
    return true
  }
  if (noteInlineGraphColumnError(error)) {
    probedAbsentAt = now()
    return false
  }
  console.warn(`[execution-inline-graph] column probe failed: ${error.message ?? "read failed"}`)
  return true
}

export function resetInlineGraphColumnForTests(): void {
  absent = false
  probedPresent = false
  probedAbsentAt = null
}
