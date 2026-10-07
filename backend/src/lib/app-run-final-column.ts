/**
 * `app_runs.final_execution_id` (migration 473, Render final in the app
 * runner): the execution that rendered an app run's final, a continuation
 * outside the run.
 *
 * Staging runs dev against the SHARED database, and migrations apply only at
 * the dev→main promotion — so for that window the column does not exist, and
 * a read or write that names it fails the WHOLE statement (the app runner's
 * run list among them). Every site that names the column goes through here (a
 * guard test enforces it): on a missing-column error it is remembered as
 * absent for the life of the process (a deploy that applies the migration
 * restarts it), a read retries without it and a write is skipped. Absent
 * means no final is linked: a final still renders, and the runner follows it
 * for as long as the page stays open.
 *
 * The column is server-written: migration 469 limits a runner's own UPDATE
 * to the run PATCH's columns, and a column added later is server-only. The
 * reads still go through the service role, which bypasses RLS, so a reader
 * loads the execution it names only when it is the runner's own run of the
 * app's workflow (`loadAppRunFinals`, the rule of `executionBelongsToRun`).
 */
import { appRunFinalReplacedIds } from "@nodaro/render-rules"
import { supabase } from "./supabase.js"

/** 42703: undefined column (Postgres); PGRST204: unknown column in a write (PostgREST). */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"])

const COLUMN = "final_execution_id"

let absent = false

/** True when `error` says a named column does not exist (and records it). */
export function noteFinalExecutionColumnError(error: { readonly code?: string | null } | null | undefined): boolean {
  if (!error?.code || !MISSING_COLUMN_CODES.has(error.code)) return false
  absent = true
  return true
}

/** Is the column known to be missing in this process? */
export function finalExecutionColumnAbsent(): boolean {
  return absent
}

/** `columns` plus the final's id, unless the column is known to be missing. */
export function withFinalExecutionColumn(columns: string): string {
  return absent ? columns : `${columns}, ${COLUMN}`
}

/** The final a selected run row links: `null` when none (or the column was not read). */
export function finalExecutionIdOf(row: Readonly<Record<string, unknown>> | null | undefined): string | null {
  const id = row?.[COLUMN]
  return typeof id === "string" && id.length > 0 ? id : null
}

/**
 * Select from `app_runs` with the column, retrying once without it on a
 * missing-column error. `build` receives the column list and returns the
 * awaited query.
 */
export async function selectWithFinalExecution<T>(
  columns: string,
  build: (columns: string) => PromiseLike<{ data: T | null; error: { code?: string | null; message?: string } | null }>,
): Promise<{ data: T | null; error: { code?: string | null; message?: string } | null }> {
  const named = !absent
  const first = await build(withFinalExecutionColumn(columns))
  if (named && first.error && noteFinalExecutionColumnError(first.error)) return build(columns)
  return first
}

/**
 * Link a run to its final: the final's id alone. The runner's edits stay
 * until the final COMPLETES (`settleAppRunFinalEdits`) — a final that fails
 * keeps the preview on show, and the runner's edit of it with it. The column
 * missing: nothing is written and the final is not linked. Returns whether
 * the final was linked.
 */
export async function linkAppRunFinal(runId: string, runnerId: string, executionId: string): Promise<boolean> {
  if (absent) return false
  const { error } = await supabase
    .from("app_runs")
    .update({ [COLUMN]: executionId })
    .eq("id", runId)
    .eq("runner_id", runnerId)
  if (!error) return true
  if (noteFinalExecutionColumnError(error)) return false
  throw new Error(`app run final link: ${error.message}`)
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * A final has COMPLETED: drop the runner's edits of the nodes it replaced in
 * the run's view (those it completed itself — `appRunFinalReplacedIds`), on
 * the run that links it. Those were edits of the preview; an edit the runner
 * makes of the final afterwards is kept. Called by the orchestrator at the end
 * of an app run's continuation. A final still running, or one that ended any
 * other way, settles nothing: it is never laid over the run
 * (`appRunLaidFinals`), so the preview stays on show and the edit of it with
 * it (review round 2). Best-effort, never throws: an edit left over shows over
 * the final.
 */
export async function settleAppRunFinalEdits(executionId: string, runnerId: string): Promise<void> {
  if (absent) return
  try {
    const { data: exec, error: execError } = await supabase
      .from("workflow_executions")
      .select("status, node_states")
      .eq("id", executionId)
      .eq("user_id", runnerId)
      .maybeSingle()
    const ended = exec as { status?: unknown; node_states?: unknown } | null
    if (execError || !ended || ended.status !== "completed") return
    const replaced = new Set(appRunFinalReplacedIds(ended.node_states))
    if (replaced.size === 0) return
    const { data: runs, error } = await supabase
      .from("app_runs")
      .select("id, node_states")
      .eq(COLUMN, executionId)
      .eq("runner_id", runnerId)
    if (error) {
      noteFinalExecutionColumnError(error)
      return
    }
    for (const run of (runs ?? []) as Array<{ id: string; node_states: unknown }>) {
      const edits = run.node_states
      if (!isRecord(edits) || !Object.keys(edits).some((id) => replaced.has(id))) continue
      const kept = Object.fromEntries(Object.entries(edits).filter(([id]) => !replaced.has(id)))
      await supabase
        .from("app_runs")
        .update({ node_states: kept })
        .eq("id", run.id)
        .eq("runner_id", runnerId)
        // Still this final's run: a newer Render final linked since settles itself.
        .eq(COLUMN, executionId)
    }
  } catch {
    // Best-effort: the final has already ended either way.
  }
}

/**
 * What a final's execution is stamped with when it is created
 * (`workflow_executions.trigger_data.appRenderFinal`, decided 2026-10-06): the
 * run it finishes, the published version it runs, and the execution it
 * continues — the run's own, or (a chain) the run's newest final. A later
 * final continues from the newest, and a run view walks the stamps back to lay
 * every final of the chain over the run, oldest first. The row is the
 * runner's own and runner-writable, as its `node_states` are: a reader trusts
 * it only for the runner's own runs.
 */
export interface AppRenderFinalStamp {
  readonly appRunId: string
  readonly appVersionId: string
  readonly continuedFrom: string
}

const STAMP_KEY = "appRenderFinal"

/** The `trigger_data` a final's execution is created with. */
export function appRenderFinalStamp(stamp: AppRenderFinalStamp): Record<string, AppRenderFinalStamp> {
  return { [STAMP_KEY]: { appRunId: stamp.appRunId, appVersionId: stamp.appVersionId, continuedFrom: stamp.continuedFrom } }
}

/** The stamp a `trigger_data` value holds, or `null` when it is not a final's. */
export function appRenderFinalStampOf(triggerData: unknown): AppRenderFinalStamp | null {
  const stamp = isRecord(triggerData) ? triggerData[STAMP_KEY] : undefined
  if (!isRecord(stamp)) return null
  const { appRunId, appVersionId, continuedFrom } = stamp
  if (typeof appRunId !== "string" || typeof appVersionId !== "string" || typeof continuedFrom !== "string") return null
  if (!appRunId || !appVersionId || !continuedFrom) return null
  return { appRunId, appVersionId, continuedFrom }
}

/** A final as a run view reads it. */
export interface AppRunFinal {
  readonly id: string
  readonly status: string
  readonly nodeStates: Record<string, unknown> | null
  readonly completedNodes: number | null
  readonly totalNodes: number | null
  readonly errorMessage: string | null
  readonly completedAt: string | null
  readonly creditsUsed: number | null
  /** The execution it continued (its stamp): the run's own, or an earlier final. `null` without a stamp. */
  readonly continuedFrom: string | null
}

/** How far back a chain is walked: far past any graph's renders in series. */
const MAX_CHAIN_STEPS = 32

/** What else a final must be to be the run's: an execution of the app's workflow. */
export interface AppRunFinalsScope {
  readonly workflowId?: string | null
}

/** A read of a run's finals, and whether every read of it succeeded. */
export interface AppRunFinalsRead {
  readonly finals: Map<string, AppRunFinal>
  /**
   * False when a read failed: a final, or an earlier final of its chain, may
   * be missing. A final that is simply not there (not the runner's, or gone)
   * leaves the read complete.
   */
  readonly complete: boolean
}

/**
 * The finals these ids name, keyed by id — only executions `runnerId` started
 * (the service-role read bypasses RLS) — WITH every earlier final of their chains
 * (decided 2026-10-06): each final's stamp names the execution it continued,
 * and an execution is taken for an earlier final only when it carries a stamp
 * of its own. `runExecutionIds` are the runs' own executions, where a walk
 * stops without a read. `workflowId`, when known, is the app's workflow: an
 * execution of any other workflow is not the run's (the rule a run's own
 * execution is read by, `executionBelongsToRun` in lib/app-run-ownership.ts).
 * Never throws: a failed read ends the walk with what was read so far, and
 * says so (`complete: false`).
 */
export async function readAppRunFinals(
  ids: readonly string[],
  runnerId: string,
  runExecutionIds: Iterable<string> = [],
  scope: AppRunFinalsScope = {},
): Promise<AppRunFinalsRead> {
  const out = new Map<string, AppRunFinal>()
  const stop = new Set(runExecutionIds)
  let next = [...new Set(ids.filter(Boolean))]
  let requested = true
  for (let step = 0; next.length > 0 && step < MAX_CHAIN_STEPS; step++) {
    let query = supabase
      .from("workflow_executions")
      .select("id, status, node_states, completed_nodes, total_nodes, error_message, completed_at, total_credits_used, trigger_data")
      .in("id", next)
      .eq("user_id", runnerId)
    if (scope.workflowId) query = query.eq("workflow_id", scope.workflowId)
    const { data, error } = await query
    if (error || !Array.isArray(data)) return { finals: out, complete: false }
    const wanted = new Set(next)
    const following = new Set<string>()
    for (const row of data as Array<Record<string, unknown>>) {
      const id = row.id as string
      if (!wanted.has(id) || out.has(id)) continue
      const stamp = appRenderFinalStampOf(row.trigger_data)
      // An earlier final is one by its own stamp; a linked final is one by the link.
      if (!requested && !stamp) continue
      out.set(id, {
        id,
        status: row.status as string,
        nodeStates: (row.node_states as Record<string, unknown> | null) ?? null,
        completedNodes: (row.completed_nodes as number | null) ?? null,
        totalNodes: (row.total_nodes as number | null) ?? null,
        errorMessage: (row.error_message as string | null) ?? null,
        completedAt: (row.completed_at as string | null) ?? null,
        creditsUsed: (row.total_credits_used as number | null) ?? null,
        continuedFrom: stamp?.continuedFrom ?? null,
      })
      if (stamp && !out.has(stamp.continuedFrom) && !stop.has(stamp.continuedFrom)) following.add(stamp.continuedFrom)
    }
    requested = false
    next = [...following].filter((id) => !out.has(id))
  }
  return { finals: out, complete: true }
}

/**
 * `readAppRunFinals` for a run VIEW: a failed read shows the runs as their
 * previews (or as the part of the chain already read). The Render final route
 * reads with `readAppRunFinals` instead — it must not mistake a failed read
 * for no final.
 */
export async function loadAppRunFinals(
  ids: readonly string[],
  runnerId: string,
  runExecutionIds: Iterable<string> = [],
  scope: AppRunFinalsScope = {},
): Promise<Map<string, AppRunFinal>> {
  return (await readAppRunFinals(ids, runnerId, runExecutionIds, scope)).finals
}

/**
 * A run's chain of finals, OLDEST first, ending at its newest (`newestId`, the
 * one the run links): the order a run view lays them over the run's states.
 * Empty when no final is linked or it was not read. Ends at a stamp that
 * names no loaded final — the run's own execution — or at a cycle.
 */
export function appRunFinalChain(newestId: string | null | undefined, finals: ReadonlyMap<string, AppRunFinal>): AppRunFinal[] {
  const chain: AppRunFinal[] = []
  const seen = new Set<string>()
  let current = newestId ? finals.get(newestId) : undefined
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.push(current)
    current = current.continuedFrom ? finals.get(current.continuedFrom) : undefined
  }
  return chain.reverse()
}

/** For tests. */
export function resetFinalExecutionColumnForTests(): void {
  absent = false
}
