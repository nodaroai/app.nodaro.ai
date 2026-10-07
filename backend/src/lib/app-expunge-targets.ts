import { supabase } from "./supabase.js"
import { executionBelongsToRun } from "./app-run-ownership.js"
import {
  appReportContentRedaction,
  appRunContentRedaction,
  executionContentRedaction,
  jobContentRedaction,
} from "./app-run-content.js"
import { ACTIVE_EXECUTION_STATUSES } from "./request-helpers.js"
import { IN_FLIGHT_JOB_STATUSES } from "./job-status.js"
import { noteInputOverridesColumnError } from "./execution-input-overrides.js"
import { appRenderFinalStampOf, finalExecutionIdOf, selectWithFinalExecution } from "./app-run-final-column.js"
import { APP_RENDER_FINAL_STAMP_PATH, APP_RUN_STAMP_PATH, appRunStampOf } from "./app-run-stamp.js"
import { STALE_EXECUTION_THRESHOLD_MS, staleExecutionThresholdMs } from "./job-budget.js"
import { executionBudgetExcessMs } from "./execution-budget.js"

/**
 * The rows an admin app expunge erases (decided 2026-10-06), grouped by the
 * app run they belong to.
 *
 * A run's executions are found three ways, each through a pointer:
 * - the run's own (`app_runs.execution_id`) and its Render final
 *   (`final_execution_id`, through its column guard);
 * - every execution stamped with the run (`lib/app-run-stamp.ts`): earlier
 *   executions of a re-run run, whose pointer has moved on, and every Render
 *   final of the run, the earlier finals of a chain included;
 * - the inner runs of its component nodes: a component's wrapper job names
 *   its inner execution (`_executionId`), recursively to the component depth
 *   limit.
 * Then each of those executions' jobs, and each inner run's own `app_runs`
 * row on the component's app (decided 2026-10-07).
 *
 * Executions from before runs were tagged carry no stamp, so a run re-run
 * back then has earlier executions nothing here can find. There is no
 * fallback (decided 2026-10-07): a guess by workflow and owner would also take
 * the runner's own editor runs of a shared workflow. `runsBeforeRunTag`
 * counts the runs this may concern, for the admin.
 *
 * Every read uses the service-role client, which bypasses RLS, and what is
 * read here is overwritten, so a pointer naming someone else's row counts as
 * missing:
 * - a run's own execution (pointed at or stamped) is taken only when
 *   `executionBelongsToRun` says so: its owner is the runner and, when the
 *   app's workflow is known, it is a run of that workflow;
 * - an inner execution only when its owner is its wrapper job's owner, and
 *   its own app run only when that run's runner owns it and
 *   `executionBelongsToRun` agrees against the component app's workflow;
 * - a job only when it is its execution's owner's: each jobs read filters
 *   `user_id` to that owner.
 * Every read is paged or chunked, so the PostgREST row cap never cuts one
 * short without a word.
 *
 * A run with anything still in flight is SKIPPED, not erased: one of its
 * executions is pending/running/stopping, or one of its jobs is in flight
 * (`IN_FLIGHT_JOB_STATUSES`, a held `pending_review` job included). A running
 * execution's `node_states` is the orchestrator's live state and a held job's
 * output waits on a reviewer; erasing under either is undone by the next
 * write. An execution stuck past the stale-execution threshold the reconcile
 * sweeps use (`STALE_EXECUTION_THRESHOLD_MS` plus its budget excess, counted
 * from `started_at`, or from `created_at` when it never started) counts as
 * finished. The admin expunges again later for the runs skipped.
 */
export interface AppExpungeTargets {
  /** The runs erased now: nothing of theirs is in flight. */
  runIds: string[]
  /** The runs left as they are this time: something of theirs is still in flight. */
  skippedRunIds: string[]
  /**
   * The finished runs' executions and jobs, by component depth: `[0]` the runs'
   * own, `[1]` their components' inner runs, and so on. Erased deepest first:
   * a wrapper job holds its inner run's id, so it is cleared only after the
   * inner run is.
   *
   * `appRunIds` are the inner runs' own `app_runs` rows (decided 2026-10-07):
   * `executeAppRun({ isComponentExecution })` records each inner run as a run
   * of the COMPONENT's app, with the runner's inputs in it. Always empty at
   * `[0]` — the app's own runs are erased by the route, by app id.
   */
  levels: AppExpungeLevel[]
  /**
   * The finished runs' executions that no run pointer names (earlier
   * executions of a re-run, Render finals found by stamp, component inner
   * runs), with their owner. The R2 harvest reads these as well.
   */
  unpointedExecutions: Array<{ id: string; owner: string }>
  /**
   * How many of the erased runs started before runs were tagged
   * (`lib/app-run-stamp.ts`): their own execution carries no tag. An earlier
   * execution of such a run — one it had before a re-run moved its pointer on —
   * is not found, and keeps its content: there is no fallback (decided
   * 2026-10-07), since any guess by workflow and owner could take another
   * user's or an editor run. A lower bound: a run from before tagging that was
   * re-run after it has a tagged execution now, and is not counted.
   */
  runsBeforeRunTag: number
}

export interface AppExpungeLevel {
  executionIds: string[]
  jobIds: string[]
  appRunIds: string[]
}

const RUN_PAGE = 500
const ROW_PAGE = 500
const ID_CHUNK = 100
/** Same limit as component nesting (`executeComponentNode`: depth ≥ 5 refused). */
const MAX_COMPONENT_DEPTH = 5

const ACTIVE_EXECUTION = new Set<string>(ACTIVE_EXECUTION_STATUSES)
const IN_FLIGHT_JOB = new Set<string>(IN_FLIGHT_JOB_STATUSES)

/** The execution columns read (spelled out at each select, so the node-states guard sees none is read). */
interface ExecutionRow {
  id: string
  user_id: unknown
  workflow_id: unknown
  status: unknown
  started_at: unknown
  created_at: unknown
  trigger_data: unknown
}

interface ReadResult {
  data: unknown
  error: { message?: string } | null
}

/** The part of a PostgREST select builder the paged reads use. */
interface PagedQuery extends PromiseLike<ReadResult> {
  order(column: string, options: { ascending: boolean }): PagedQuery
  gt(column: string, value: string): PagedQuery
  limit(count: number): PagedQuery
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += ID_CHUNK) out.push(items.slice(i, i + ID_CHUNK))
  return out
}

function fail(at: string, error: { message?: string }): never {
  throw new Error(`collectAppExpungeTargets failed at ${at}: ${error.message ?? "unknown error"}`)
}

/**
 * Every row a query matches, in pages keyed on `id`: a read with no limit
 * stops at the PostgREST row cap (1000) without an error, and the rows past
 * it would be neither erased nor checked for being in flight.
 */
async function readAll<T extends { id: unknown }>(at: string, build: () => PagedQuery): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  while (true) {
    let q = build().order("id", { ascending: true }).limit(ROW_PAGE)
    if (cursor) q = q.gt("id", cursor)
    const { data, error } = await q
    if (error) fail(at, error)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < ROW_PAGE) return out
    const last = rows[rows.length - 1]!.id
    if (typeof last !== "string") return out
    cursor = last
  }
}

async function readExecutionsById(ids: readonly string[]): Promise<ExecutionRow[]> {
  const out: ExecutionRow[] = []
  for (const chunk of chunks(ids)) {
    const { data, error } = await supabase.from("workflow_executions").select("id, user_id, workflow_id, status, started_at, created_at, trigger_data").in("id", chunk)
    if (error) fail("workflow_executions", error)
    for (const row of (data ?? []) as ExecutionRow[]) if (typeof row.id === "string") out.push(row)
  }
  return out
}

/** Still in progress, and not stuck past the stale-execution threshold. */
async function executionInFlight(row: ExecutionRow, now: number): Promise<boolean> {
  if (typeof row.status !== "string" || !ACTIVE_EXECUTION.has(row.status)) return false
  const clock = typeof row.started_at === "string" ? row.started_at : typeof row.created_at === "string" ? row.created_at : null
  const since = clock ? Date.parse(clock) : NaN
  if (!Number.isFinite(since)) return true
  const age = now - since
  // The budget excess is read only once the base threshold has passed, as the
  // reconcile sweeps do: a run with nothing budgeted costs no extra query.
  if (age <= STALE_EXECUTION_THRESHOLD_MS) return true
  return age <= staleExecutionThresholdMs(await executionBudgetExcessMs(row.id, row.user_id as string))
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key) ?? new Set<V>()
  set.add(value)
  map.set(key, set)
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function innerExecutionIdsOf(job: { input_data?: unknown; output_data?: unknown }): string[] {
  const ids = new Set<string>()
  for (const data of [job.input_data, job.output_data]) {
    if (typeof data !== "object" || data === null) continue
    const id = (data as Record<string, unknown>)._executionId
    if (typeof id === "string" && id.length > 0) ids.add(id)
  }
  return [...ids]
}

export async function collectAppExpungeTargets(
  appId: string,
  appWorkflowId: string | null,
  now: number = Date.now(),
): Promise<AppExpungeTargets> {
  const targets: AppExpungeTargets = { runIds: [], skippedRunIds: [], levels: [], unpointedExecutions: [], runsBeforeRunTag: 0 }

  let cursor: string | null = null
  while (true) {
    const page = (columns: string) => {
      let q = supabase.from("app_runs").select(columns).eq("app_id", appId).order("id", { ascending: true }).limit(RUN_PAGE)
      if (cursor) q = q.gt("id", cursor)
      return q as unknown as PromiseLike<{
        data: Array<Record<string, unknown>> | null
        error: { code?: string | null; message?: string } | null
      }>
    }
    const { data, error } = await selectWithFinalExecution("id, runner_id, execution_id", page)
    if (error) fail("app_runs", error)
    const rows = (data ?? []) as Array<Record<string, unknown>>
    await collectRunsPage(rows, appWorkflowId, now, targets)
    if (rows.length < RUN_PAGE) break
    const lastId = rows[rows.length - 1]!.id
    if (typeof lastId !== "string") break
    cursor = lastId
  }

  return targets
}

async function collectRunsPage(
  rows: ReadonlyArray<Record<string, unknown>>,
  appWorkflowId: string | null,
  now: number,
  targets: AppExpungeTargets,
): Promise<void> {
  // Every run of the page, with its runner (null once the runner is gone: the
  // run's own columns are still erased, but no execution is its own).
  const runnerOf = new Map<string, string | null>()
  const pointedBy = new Map<string, Set<string>>()
  // run id → its own (current) execution, the one that says whether it is tagged.
  const currentOf = new Map<string, string>()
  for (const row of rows) {
    if (typeof row.id !== "string") continue
    const runner = typeof row.runner_id === "string" && row.runner_id.length > 0 ? row.runner_id : null
    runnerOf.set(row.id, runner)
    if (!runner) continue
    if (typeof row.execution_id === "string" && row.execution_id.length > 0) currentOf.set(row.id, row.execution_id)
    for (const id of [row.execution_id, finalExecutionIdOf(row)]) {
      if (typeof id === "string" && id.length > 0) addTo(pointedBy, id, row.id)
    }
  }

  // execution id → the runs it belongs to, its owner, its component depth, its row.
  const runsOf = new Map<string, Set<string>>()
  const ownerOf = new Map<string, string>()
  const depthOf = new Map<string, number>()
  const rowOf = new Map<string, ExecutionRow>()
  const take = (row: ExecutionRow, runId: string, depth: number) => {
    addTo(runsOf, row.id, runId)
    ownerOf.set(row.id, row.user_id as string)
    depthOf.set(row.id, Math.max(depth, depthOf.get(row.id) ?? 0))
    rowOf.set(row.id, row)
  }
  const isRunsOwn = (row: ExecutionRow, runId: string) =>
    executionBelongsToRun(row, { runnerId: runnerOf.get(runId), workflowId: appWorkflowId })

  // The runs' pointers.
  for (const row of await readExecutionsById([...pointedBy.keys()])) {
    for (const runId of pointedBy.get(row.id) ?? []) if (isRunsOwn(row, runId)) take(row, runId, 0)
  }

  // The runs' stamped executions: every re-run's, every Render final's.
  const withRunner = [...runnerOf.entries()].filter((entry): entry is [string, string] => entry[1] !== null)
  for (const chunk of chunks(withRunner)) {
    const runIds = chunk.map(([id]) => id)
    const runners = [...new Set(chunk.map(([, runner]) => runner))]
    for (const path of [APP_RUN_STAMP_PATH, APP_RENDER_FINAL_STAMP_PATH]) {
      const stamped = await readAll<ExecutionRow>("stamped workflow_executions", () => {
        let q = supabase.from("workflow_executions").select("id, user_id, workflow_id, status, started_at, created_at, trigger_data").in("user_id", runners).in(path, runIds)
        if (appWorkflowId) q = q.eq("workflow_id", appWorkflowId)
        return q as unknown as PagedQuery
      })
      for (const row of stamped) {
        if (typeof row.id !== "string") continue
        const runId = appRunStampOf(row.trigger_data) ?? appRenderFinalStampOf(row.trigger_data)?.appRunId ?? null
        if (runId && runnerOf.has(runId) && isRunsOwn(row, runId)) take(row, runId, 0)
      }
    }
  }

  // Each level's jobs, then the inner runs its component wrappers name.
  const jobsOf = new Map<string, Array<{ id: string; status: unknown }>>()
  let frontier = [...runsOf.keys()]
  for (let depth = 0; frontier.length > 0; depth++) {
    const byOwner = new Map<string, string[]>()
    for (const id of frontier) pushTo(byOwner, ownerOf.get(id)!, id)

    const wrappersByOwner = new Map<string, Array<{ id: string; execution: string }>>()
    for (const [owner, ids] of byOwner) {
      for (const chunk of chunks(ids)) {
        const jobs = await readAll<{ id: unknown; workflow_execution_id: unknown; status: unknown; provider: unknown }>(
          "jobs",
          () =>
            supabase
              .from("jobs")
              .select("id, workflow_execution_id, status, provider")
              .eq("user_id", owner)
              .in("workflow_execution_id", chunk) as unknown as PagedQuery,
        )
        for (const job of jobs) {
          if (typeof job.id !== "string" || typeof job.workflow_execution_id !== "string") continue
          if (!runsOf.has(job.workflow_execution_id)) continue
          pushTo(jobsOf, job.workflow_execution_id, { id: job.id, status: job.status })
          if (job.provider === "component") pushTo(wrappersByOwner, owner, { id: job.id, execution: job.workflow_execution_id })
        }
      }
    }
    if (depth >= MAX_COMPONENT_DEPTH) break

    // inner execution id → its wrapper's owner and the execution that wrapper ran in.
    const innerFrom = new Map<string, { owner: string; parent: string }>()
    for (const [owner, wrappers] of wrappersByOwner) {
      const parentOf = new Map(wrappers.map((w) => [w.id, w.execution]))
      for (const chunk of chunks(wrappers.map((w) => w.id))) {
        const { data, error } = await supabase.from("jobs").select("id, input_data, output_data").eq("user_id", owner).in("id", chunk)
        if (error) fail("component wrapper jobs", error)
        for (const w of (data ?? []) as Array<{ id: unknown; input_data?: unknown; output_data?: unknown }>) {
          const parent = typeof w.id === "string" ? parentOf.get(w.id) : undefined
          if (!parent) continue
          for (const inner of innerExecutionIdsOf(w)) {
            if (!runsOf.has(inner) && !innerFrom.has(inner)) innerFrom.set(inner, { owner, parent })
          }
        }
      }
    }
    const next: string[] = []
    for (const row of await readExecutionsById([...innerFrom.keys()])) {
      const from = innerFrom.get(row.id)
      if (!from || row.user_id !== from.owner || runsOf.has(row.id)) continue
      for (const runId of runsOf.get(from.parent) ?? []) take(row, runId, depth + 1)
      next.push(row.id)
    }
    frontier = next
  }

  // A run with anything in flight is skipped.
  const inFlightRuns = new Set<string>()
  for (const [id, row] of rowOf) {
    const runs = [...(runsOf.get(id) ?? [])]
    if (runs.every((r) => inFlightRuns.has(r))) continue
    const jobInFlight = (jobsOf.get(id) ?? []).some((job) => typeof job.status === "string" && IN_FLIGHT_JOB.has(job.status))
    if (jobInFlight || (await executionInFlight(row, now))) for (const r of runs) inFlightRuns.add(r)
  }

  for (const runId of runnerOf.keys()) {
    if (inFlightRuns.has(runId)) {
      targets.skippedRunIds.push(runId)
      continue
    }
    targets.runIds.push(runId)
    const current = currentOf.get(runId)
    const row = current ? rowOf.get(current) : undefined
    if (row && runsOf.get(row.id)?.has(runId) && appRunStampOf(row.trigger_data) === null) targets.runsBeforeRunTag++
  }

  const levelAt = (depth: number): AppExpungeLevel => {
    while (targets.levels.length <= depth) targets.levels.push({ executionIds: [], jobIds: [], appRunIds: [] })
    return targets.levels[depth]!
  }
  const inner: ExecutionRow[] = []
  for (const [id, runs] of runsOf) {
    if ([...runs].some((r) => inFlightRuns.has(r))) continue
    const depth = depthOf.get(id) ?? 0
    const level = levelAt(depth)
    level.executionIds.push(id)
    for (const job of jobsOf.get(id) ?? []) level.jobIds.push(job.id)
    if (!pointedBy.has(id)) targets.unpointedExecutions.push({ id, owner: ownerOf.get(id)! })
    if (depth > 0) inner.push(rowOf.get(id)!)
  }

  for (const { appRunId, execution } of await innerAppRunsOf(inner)) levelAt(depthOf.get(execution) ?? 0).appRunIds.push(appRunId)
}

/**
 * The inner runs' own `app_runs` rows (decided 2026-10-07): a component's
 * inner run is also an app run of the component's app
 * (`executeAppRun({ isComponentExecution })`), and its `input_values` hold the
 * runner's inputs. Found through `app_runs.execution_id` (server-written,
 * migration 469) and checked like the app's own runs: the row's runner must
 * own the inner execution — the jobs-style filter puts `runner_id` in the read
 * — and `executionBelongsToRun` must agree, against the component app's
 * workflow when that app still exists. Another user's row naming the
 * execution is left alone.
 */
async function innerAppRunsOf(executions: readonly ExecutionRow[]): Promise<Array<{ appRunId: string; execution: string }>> {
  const byOwner = new Map<string, string[]>()
  const rowOf = new Map<string, ExecutionRow>()
  for (const row of executions) {
    if (typeof row.user_id !== "string") continue
    pushTo(byOwner, row.user_id, row.id)
    rowOf.set(row.id, row)
  }

  const found: Array<{ id: string; app_id: unknown; runner_id: string; execution_id: string }> = []
  for (const [owner, ids] of byOwner) {
    for (const chunk of chunks(ids)) {
      const runs = await readAll<{ id: unknown; app_id: unknown; runner_id: unknown; execution_id: unknown }>(
        "inner app_runs",
        () =>
          supabase
            .from("app_runs")
            .select("id, app_id, runner_id, execution_id")
            .eq("runner_id", owner)
            .in("execution_id", chunk) as unknown as PagedQuery,
      )
      for (const r of runs) {
        if (typeof r.id !== "string" || typeof r.execution_id !== "string" || r.runner_id !== owner) continue
        found.push({ id: r.id, app_id: r.app_id, runner_id: owner, execution_id: r.execution_id })
      }
    }
  }
  if (found.length === 0) return []

  // Each component app's workflow; an app that is gone leaves the runner check alone.
  const workflowOf = new Map<string, string | null>()
  const appIds = [...new Set(found.map((r) => r.app_id).filter((id): id is string => typeof id === "string"))]
  for (const chunk of chunks(appIds)) {
    const { data, error } = await supabase.from("published_apps").select("id, workflow_id").in("id", chunk)
    if (error) fail("published_apps", error)
    for (const app of (data ?? []) as Array<{ id: unknown; workflow_id: unknown }>) {
      if (typeof app.id === "string") workflowOf.set(app.id, typeof app.workflow_id === "string" ? app.workflow_id : null)
    }
  }

  const out: Array<{ appRunId: string; execution: string }> = []
  const seen = new Set<string>()
  for (const r of found) {
    const execution = rowOf.get(r.execution_id)
    if (!execution || seen.has(r.id)) continue
    const workflowId = typeof r.app_id === "string" ? (workflowOf.get(r.app_id) ?? null) : null
    if (!executionBelongsToRun(execution, { runnerId: r.runner_id, workflowId })) continue
    seen.add(r.id)
    out.push({ appRunId: r.id, execution: r.execution_id })
  }
  return out
}

/**
 * Clear the runner's content from the finished runs' executions and jobs:
 * `executionContentRedaction` on each execution, `jobContentRedaction` on each
 * job, and `appRunContentRedaction` on each inner run's own app run (decided
 * 2026-10-07), by id, in chunks, deepest component level first — a wrapper
 * job holds its inner run's id, so it is cleared only once the inner run (and
 * its app run, found through it) is, and a retry after a failure still finds
 * the inner run through it.
 *
 * Then, still within the level, `appReportContentRedaction` on the
 * `app_reports` rows filed for its executions and jobs (decided 2026-10-07):
 * the failure sweeps copy their error lines and prompt excerpts into a
 * report's title and payload. The rows stay. They are found by the level's
 * own ids (`execution_id`, `job_id`), which are already ownership-checked; no
 * owner filter is added, since the job-policy reporters file rows with no
 * user. After the level's jobs, so a report a sweep files from a job not yet
 * erased is not left behind; before the level above, so a retry still
 * reaches them through the wrapper. A row naming both a target execution and
 * a target job is counted once. A sweep that read a row before this cleared
 * it and files its report after the clear below has run is not counted here:
 * the sweep clears that report itself, once it has filed it
 * (`clearReportsOfErasedSources` in `lib/app-report-sweep.ts`).
 *
 * Throws on the first failed write, naming the table; rows already cleared
 * stay cleared. A retry finds the same rows again through the runs, their
 * stamps and the wrappers not yet cleared, but not the storage keys that only
 * the already-cleared columns named: those objects are no longer harvested,
 * and stay in R2. An execution write refused only because the pin column
 * (466) is missing is retried once without it.
 */
export async function redactAppExpungeTargets(targets: {
  levels: ReadonlyArray<Pick<AppExpungeLevel, "executionIds" | "jobIds"> & { appRunIds?: string[] }>
}): Promise<{ executions: number; jobs: number; innerRuns: number; reports: number }> {
  let executions = 0
  let jobs = 0
  let innerRuns = 0
  const reports = new Set<string>()
  for (let depth = targets.levels.length - 1; depth >= 0; depth--) {
    const level = targets.levels[depth]!
    for (const chunk of chunks(level.executionIds)) {
      const write = () => supabase.from("workflow_executions").update(executionContentRedaction()).in("id", chunk)
      let { error } = await write()
      // The pin column (466) is not in the database yet: the patch drops it now.
      if (error && noteInputOverridesColumnError(error)) ({ error } = await write())
      if (error) throw new Error(`redactAppExpungeTargets failed at workflow_executions: ${error.message}`)
    }
    for (const chunk of chunks(level.jobIds)) {
      const { error } = await supabase.from("jobs").update(jobContentRedaction()).in("id", chunk)
      if (error) throw new Error(`redactAppExpungeTargets failed at jobs: ${error.message}`)
    }
    const appRunIds = level.appRunIds ?? []
    for (const chunk of chunks(appRunIds)) {
      const { error } = await supabase.from("app_runs").update(appRunContentRedaction()).in("id", chunk)
      if (error) throw new Error(`redactAppExpungeTargets failed at app_runs: ${error.message}`)
    }
    for (const [column, ids] of [
      ["execution_id", level.executionIds],
      ["job_id", level.jobIds],
    ] as const) {
      for (const chunk of chunks(ids)) {
        const { data, error } = await supabase
          .from("app_reports")
          .update(appReportContentRedaction())
          .in(column, chunk)
          .select("id")
        if (error) throw new Error(`redactAppExpungeTargets failed at app_reports: ${error.message}`)
        for (const row of (data ?? []) as Array<{ id: unknown }>) if (typeof row.id === "string") reports.add(row.id)
      }
    }
    executions += level.executionIds.length
    jobs += level.jobIds.length
    innerRuns += appRunIds.length
  }
  return { executions, jobs, innerRuns, reports: reports.size }
}

/** Every execution id the targets erase, all levels. */
export function targetExecutionIds(targets: { levels: ReadonlyArray<{ executionIds: string[] }> }): string[] {
  return targets.levels.flatMap((level) => level.executionIds)
}

/** Every job id the targets erase, all levels. */
export function targetJobIds(targets: { levels: ReadonlyArray<{ jobIds: string[] }> }): string[] {
  return targets.levels.flatMap((level) => level.jobIds)
}
