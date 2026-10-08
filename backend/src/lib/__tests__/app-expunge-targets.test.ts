/**
 * Which `workflow_executions` and `jobs` rows the admin expunge erases, run by
 * run (decided 2026-10-06): every execution of the app's own runs — the run's
 * own, its Render finals, earlier executions of a re-run run (by their stamp),
 * its components' inner runs — and those executions' owner's jobs. A run with
 * anything still in flight is skipped, not erased.
 *
 * The reads go through pointers: a run names its execution, a stamp names its
 * run, a wrapper job names its inner run, a job names its execution. The
 * service-role client bypasses RLS, so a pointer that names someone else's row
 * must be treated as if it were missing — the rule `executionBelongsToRun`
 * (#1930) applies on every run-to-execution read. What these reads return is
 * overwritten, so a planted pointer would erase another user's run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/execution-budget.js", () => ({ executionBudgetExcessMs: vi.fn().mockResolvedValue(0) }))

import { supabase } from "../supabase.js"
import { collectAppExpungeTargets, redactAppExpungeTargets, targetExecutionIds, targetJobIds } from "../app-expunge-targets.js"
import { executionBudgetExcessMs } from "../execution-budget.js"
import { appRunStamp } from "../app-run-stamp.js"
import { appRenderFinalStamp } from "../app-run-final-column.js"
import { migrationColumnsOf } from "../../test/migration-columns.js"
import { resetInputOverridesColumnForTests } from "../execution-input-overrides.js"
import { resetVideoLinkFilesColumnForTests } from "../execution-video-link-files.js"

const APP_ID = "00000000-0000-4000-8000-000000000099"
const WORKFLOW = "00000000-0000-4000-8000-0000000000f1"
const OTHER_WORKFLOW = "00000000-0000-4000-8000-0000000000f2"
const RUNNER = "00000000-0000-4000-8000-0000000000a1"
const OTHER_USER = "00000000-0000-4000-8000-0000000000b2"

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

// ---------------------------------------------------------------------------
// An in-memory supabase that applies the filters it is given and records
// every column named, so a column no migration creates fails the test.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
type Touch = { table: string; column: string; via: string }
type Update = { table: string; patch: Row; ids: string[] }

function fakeSupabase(opts: {
  tables: Record<string, Row[]>
  touched?: Touch[]
  updates?: Update[]
  inCalls?: Array<{ table: string; column: string; size: number }>
  failRead?: string
  failUpdate?: string
  /** PostgREST's row cap: a read returns at most this many rows, without an error (default 1000). */
  maxRows?: number
  /** A column the database does not have yet: a write naming it fails whole, as PostgREST does. */
  missingColumn?: { table: string; column: string } | Array<{ table: string; column: string }>
  rejected?: Update[]
}) {
  const touched = opts.touched ?? []
  const maxRows = opts.maxRows ?? 1000
  // `trigger_data->appRun->>appRunId`: the column, then the JSON path into it.
  const valueAt = (r: Row, col: string): unknown => {
    const [base, ...path] = col.split(/->>?/)
    let v: unknown = r[base!]
    for (const key of path) v = v && typeof v === "object" ? (v as Row)[key] : undefined
    return v
  }
  return (table: string) => {
    const note = (column: string, via: string) => touched.push({ table, column: column.trim().split(/->>?/)[0]!, via })
    const filters: Array<(r: Row) => boolean> = []
    let limit = Infinity
    let order: string | null = null
    let patch: Row | null = null
    // `.update(…).select("id")`: the write returns the rows it changed.
    let returning = false
    const run = () => {
      if (patch) {
        if (opts.failUpdate === table) return { data: null, error: { message: `update ${table} failed` } }
        // One column per error, the first the patch names — as PostgREST reports it.
        const missing = [opts.missingColumn ?? []].flat().find((m) => m.table === table && m.column in patch!)
        if (missing) {
          opts.rejected?.push({ table, patch, ids: [] })
          return { data: null, error: { code: "PGRST204", message: `column ${missing.column} not found` } }
        }
        const hit = (opts.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
        opts.updates?.push({ table, patch, ids: hit.map((r) => r.id as string) })
        return { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null }
      }
      if (opts.failRead === table) return { data: null, error: { message: `read ${table} failed` } }
      let rows = (opts.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
      if (order) rows = [...rows].sort((a, b) => String(a[order!]).localeCompare(String(b[order!])))
      return { data: rows.slice(0, Math.min(limit, maxRows)), error: null }
    }
    const query = {
      select(cols: string) {
        for (const c of cols.split(",")) note(c, "select")
        if (patch) returning = true
        return query
      },
      update(p: Row) {
        for (const c of Object.keys(p)) note(c, "update")
        patch = p
        return query
      },
      eq(col: string, value: unknown) {
        note(col, "eq")
        filters.push((r) => valueAt(r, col) === value)
        return query
      },
      in(col: string, values: unknown[]) {
        note(col, "in")
        opts.inCalls?.push({ table, column: col, size: values.length })
        filters.push((r) => values.includes(valueAt(r, col)))
        return query
      },
      gt(col: string, value: unknown) {
        note(col, "gt")
        filters.push((r) => String(r[col]) > String(value))
        return query
      },
      order(col: string) {
        note(col, "order")
        order = col
        return query
      },
      limit(n: number) {
        limit = n
        return query
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return query as never
  }
}

function unknownColumns(touched: Touch[]) {
  return touched
    .filter(({ table, column }) => !migrationColumnsOf(table).has(column))
    .map(({ table, column, via }) => `${table}.${column} (${via})`)
}

const NOW = Date.parse("2026-10-07T12:00:00Z")
const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const run = (n: number, execution: string | null, runner: string | null = RUNNER, extra: Row = {}) => ({
  id: uuid(0x100 + n),
  app_id: APP_ID,
  runner_id: runner,
  execution_id: execution,
  final_execution_id: null,
  ...extra,
})
const execution = (id: string, user: string, workflow = WORKFLOW, status = "completed", extra: Row = {}) => ({
  id,
  user_id: user,
  workflow_id: workflow,
  status,
  started_at: ago(HOUR),
  created_at: ago(HOUR),
  trigger_data: {},
  ...extra,
})
const job = (id: string, exec: string, user: string, status = "completed", extra: Row = {}) => ({
  id,
  user_id: user,
  workflow_execution_id: exec,
  status,
  provider: "kie",
  ...extra,
})
const wrapper = (id: string, exec: string, user: string, inner: string, status = "completed") =>
  job(id, exec, user, status, { provider: "component", input_data: { _executionId: inner }, output_data: { _executionId: inner } })

const sorted = (ids: readonly string[]) => [...ids].sort()

beforeEach(() => {
  vi.mocked(supabase.from).mockReset()
  vi.mocked(executionBudgetExcessMs).mockReset().mockResolvedValue(0)
})

describe("collectAppExpungeTargets — ownership", () => {
  const OWN_EXEC = uuid(0x201)
  const FOREIGN_EXEC = uuid(0x202)
  const WRONG_WORKFLOW_EXEC = uuid(0x203)
  const OWN_JOB = uuid(0x301)
  const PLANTED_JOB = uuid(0x302)
  const FOREIGN_JOB = uuid(0x303)
  const WRONG_WORKFLOW_JOB = uuid(0x304)

  const tables = () => ({
    app_runs: [
      run(1, OWN_EXEC),
      // A run row naming another user's execution.
      run(2, FOREIGN_EXEC),
      // The runner's own execution, but of another app's workflow.
      run(3, WRONG_WORKFLOW_EXEC),
      // A draft: no execution yet.
      run(4, null),
      // Another app's run: not this app's to erase.
      { ...run(5, uuid(0x205)), app_id: uuid(0x999) },
    ],
    workflow_executions: [
      execution(OWN_EXEC, RUNNER),
      execution(FOREIGN_EXEC, OTHER_USER),
      execution(WRONG_WORKFLOW_EXEC, RUNNER, OTHER_WORKFLOW),
      execution(uuid(0x205), RUNNER),
    ],
    jobs: [
      job(OWN_JOB, OWN_EXEC, RUNNER),
      // Another user's job pointing at the runner's execution.
      job(PLANTED_JOB, OWN_EXEC, OTHER_USER),
      job(FOREIGN_JOB, FOREIGN_EXEC, OTHER_USER),
      job(WRONG_WORKFLOW_JOB, WRONG_WORKFLOW_EXEC, RUNNER),
      job(uuid(0x305), uuid(0x205), RUNNER),
    ],
  })

  it("takes only the runs' own executions and those executions' owner's jobs", async () => {
    const touched: Touch[] = []
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(), touched }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(sorted(targets.runIds)).toEqual(sorted([1, 2, 3, 4].map((n) => uuid(0x100 + n))))
    expect(targets.skippedRunIds).toEqual([])
    expect(targetExecutionIds(targets)).toEqual([OWN_EXEC])
    expect(targetJobIds(targets)).toEqual([OWN_JOB])
    expect(targets.unpointedExecutions).toEqual([])
    expect(unknownColumns(touched)).toEqual([])
  })

  it("checks only the runner when the app's workflow is gone", async () => {
    // published_apps.workflow_id can be NULL once the workflow is deleted;
    // executionBelongsToRun then compares the owner alone.
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables() }))

    const targets = await collectAppExpungeTargets(APP_ID, null, NOW)

    expect(sorted(targetExecutionIds(targets))).toEqual(sorted([OWN_EXEC, WRONG_WORKFLOW_EXEC]))
    expect(sorted(targetJobIds(targets))).toEqual(sorted([OWN_JOB, WRONG_WORKFLOW_JOB]))
  })

  it("asks the jobs read for the execution owner's jobs (the database filters user_id)", async () => {
    const touched: Touch[] = []
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(), touched }))

    await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(touched).toContainEqual({ table: "jobs", column: "user_id", via: "eq" })
  })
})

// A re-run (Retry in the app runner) gives the run a new execution and moves
// `app_runs.execution_id` to it: the earlier one is found by its stamp. A
// Render final is found by its pointer and by its own stamp (decided 2026-10-06).
describe("collectAppExpungeTargets — every execution of a run", () => {
  const FIRST = uuid(0x401)
  const RERUN = uuid(0x402)
  const FINAL = uuid(0x403)
  const EARLIER_FINAL = uuid(0x404)
  const FOREIGN_STAMPED = uuid(0x405)
  const OTHER_WORKFLOW_STAMPED = uuid(0x406)
  const RUN = uuid(0x101)

  const tables = () => ({
    app_runs: [run(1, RERUN, RUNNER, { final_execution_id: FINAL })],
    workflow_executions: [
      execution(FIRST, RUNNER, WORKFLOW, "completed", { trigger_data: appRunStamp(RUN) }),
      execution(RERUN, RUNNER, WORKFLOW, "completed", { trigger_data: appRunStamp(RUN) }),
      execution(FINAL, RUNNER, WORKFLOW, "completed", {
        trigger_data: appRenderFinalStamp({ appRunId: RUN, appVersionId: APP_ID, continuedFrom: EARLIER_FINAL }),
      }),
      execution(EARLIER_FINAL, RUNNER, WORKFLOW, "completed", {
        trigger_data: appRenderFinalStamp({ appRunId: RUN, appVersionId: APP_ID, continuedFrom: RERUN }),
      }),
      // A stamp is a pointer: another user's execution stamped with this run,
      // or the runner's run of another workflow, is not the run's.
      execution(FOREIGN_STAMPED, OTHER_USER, WORKFLOW, "completed", { trigger_data: appRunStamp(RUN) }),
      execution(OTHER_WORKFLOW_STAMPED, RUNNER, OTHER_WORKFLOW, "completed", { trigger_data: appRunStamp(RUN) }),
    ],
    jobs: [
      job(uuid(0x501), FIRST, RUNNER),
      job(uuid(0x502), RERUN, RUNNER),
      job(uuid(0x503), FINAL, RUNNER),
      job(uuid(0x504), EARLIER_FINAL, RUNNER),
      job(uuid(0x505), FOREIGN_STAMPED, OTHER_USER),
      job(uuid(0x506), OTHER_WORKFLOW_STAMPED, RUNNER),
    ],
  })

  it("takes the re-run's earlier execution, the final and the earlier final, with their jobs", async () => {
    const touched: Touch[] = []
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(), touched }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(sorted(targetExecutionIds(targets))).toEqual(sorted([FIRST, RERUN, FINAL, EARLIER_FINAL]))
    expect(sorted(targetJobIds(targets))).toEqual(sorted([uuid(0x501), uuid(0x502), uuid(0x503), uuid(0x504)]))
    // What no pointer names goes to the R2 harvest as well, with its owner.
    expect(sorted(targets.unpointedExecutions.map((e) => e.id))).toEqual(sorted([FIRST, EARLIER_FINAL]))
    expect(targets.unpointedExecutions.every((e) => e.owner === RUNNER)).toBe(true)
    expect(unknownColumns(touched)).toEqual([])
  })

  it("skips the run while its earlier execution is still running", async () => {
    const t = tables()
    t.workflow_executions[0] = execution(FIRST, RUNNER, WORKFLOW, "running", { trigger_data: appRunStamp(RUN) })
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: t }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.skippedRunIds).toEqual([RUN])
    expect(targets.runIds).toEqual([])
    expect(targetExecutionIds(targets)).toEqual([])
  })
})

// No fallback for executions from before the run tag (decided 2026-10-07):
// a run whose own execution carries no tag started before tagging, so an
// earlier execution of it, if it was re-run then, is not found. Those runs are
// counted for the admin; nothing else is guessed at.
describe("collectAppExpungeTargets — runs from before the run tag", () => {
  const TAGGED = uuid(0x211)
  const UNTAGGED = uuid(0x212)
  const BUSY_UNTAGGED = uuid(0x213)
  const FINAL_ONLY = uuid(0x214)
  const UNTAGGED_EARLIER = uuid(0x215)

  const tables = () => ({
    app_runs: [
      run(1, TAGGED),
      run(2, UNTAGGED),
      run(3, BUSY_UNTAGGED),
      // A Render final carries its own stamp, never the run tag: only the
      // run's own execution says when the run started.
      run(4, TAGGED, RUNNER, { final_execution_id: FINAL_ONLY }),
      run(5, null),
    ],
    workflow_executions: [
      execution(TAGGED, RUNNER, WORKFLOW, "completed", { trigger_data: appRunStamp(uuid(0x101)) }),
      execution(UNTAGGED, RUNNER),
      execution(BUSY_UNTAGGED, RUNNER, WORKFLOW, "running"),
      execution(FINAL_ONLY, RUNNER, WORKFLOW, "completed", {
        trigger_data: appRenderFinalStamp({ appRunId: uuid(0x104), appVersionId: APP_ID, continuedFrom: TAGGED }),
      }),
      // An earlier execution of run 2 from before tagging: no pointer, no tag.
      execution(UNTAGGED_EARLIER, RUNNER),
    ],
    jobs: [],
  })

  it("counts the erased runs whose own execution carries no tag, and does not look for their earlier executions", async () => {
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables() }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.runsBeforeRunTag).toBe(1)
    expect(targets.skippedRunIds).toEqual([uuid(0x103)])
    expect(targetExecutionIds(targets)).not.toContain(UNTAGGED_EARLIER)
  })

  it("adds up across pages of runs", async () => {
    const runs = Array.from({ length: 501 }, (_, i) => run(1000 + i, uuid(0x10000 + i)))
    const execs = runs.map((r) => execution(r.execution_id as string, RUNNER))
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: { app_runs: runs, workflow_executions: execs, jobs: [] } }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.runsBeforeRunTag).toBe(501)
  })
})

// A component node runs its graph as an inner execution; the wrapper job
// names it (`_executionId`). Its jobs carry the runner's prompts too.
describe("collectAppExpungeTargets — component inner runs", () => {
  const RUN = uuid(0x101)
  const TOP = uuid(0x601)
  const INNER = uuid(0x602)
  const INNER2 = uuid(0x603)
  const FOREIGN_INNER = uuid(0x604)
  const WRAPPER = uuid(0x701)
  const WRAPPER2 = uuid(0x702)
  const FOREIGN_WRAPPER = uuid(0x703)
  const COMPONENT_WORKFLOW = uuid(0xc0)
  const COMPONENT_APP = uuid(0xca)
  // Each inner run is an app run of the component's app too
  // (`executeAppRun({ isComponentExecution })`), holding the runner's inputs.
  const INNER_RUN = uuid(0x901)
  const INNER2_RUN = uuid(0x902)
  const FOREIGN_INNER_RUN = uuid(0x903)
  const PLANTED_INNER_RUN = uuid(0x904)
  const OTHER_APP_INNER_RUN = uuid(0x905)
  const OTHER_APP = uuid(0xcb)

  const tables = () => ({
    app_runs: [
      run(1, TOP),
      { ...run(0, INNER), id: INNER_RUN, app_id: COMPONENT_APP },
      { ...run(0, INNER2), id: INNER2_RUN, app_id: COMPONENT_APP },
      // The foreign inner execution's own run: not the run's (its wrapper names someone else's execution).
      { ...run(0, FOREIGN_INNER, OTHER_USER), id: FOREIGN_INNER_RUN, app_id: COMPONENT_APP },
      // Another user's run naming the runner's inner execution.
      { ...run(0, INNER, OTHER_USER), id: PLANTED_INNER_RUN, app_id: COMPONENT_APP },
      // The runner's run of an app whose workflow is not the inner execution's.
      { ...run(0, INNER2), id: OTHER_APP_INNER_RUN, app_id: OTHER_APP },
    ],
    published_apps: [
      { id: COMPONENT_APP, workflow_id: COMPONENT_WORKFLOW },
      { id: OTHER_APP, workflow_id: OTHER_WORKFLOW },
    ],
    workflow_executions: [
      execution(TOP, RUNNER),
      execution(INNER, RUNNER, COMPONENT_WORKFLOW),
      execution(INNER2, RUNNER, COMPONENT_WORKFLOW),
      // A wrapper naming another user's execution: not the run's.
      execution(FOREIGN_INNER, OTHER_USER, COMPONENT_WORKFLOW),
    ],
    jobs: [
      wrapper(WRAPPER, TOP, RUNNER, INNER),
      wrapper(FOREIGN_WRAPPER, TOP, RUNNER, FOREIGN_INNER),
      job(uuid(0x801), INNER, RUNNER),
      wrapper(WRAPPER2, INNER, RUNNER, INNER2),
      job(uuid(0x802), INNER2, RUNNER),
      job(uuid(0x803), FOREIGN_INNER, OTHER_USER),
    ],
  })

  it("takes the inner runs and their jobs, level by level, and not another user's", async () => {
    const touched: Touch[] = []
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(), touched }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.levels.map((l) => l.executionIds)).toEqual([[TOP], [INNER], [INNER2]])
    expect(targets.levels.map((l) => sorted(l.jobIds))).toEqual([
      sorted([WRAPPER, FOREIGN_WRAPPER]),
      sorted([uuid(0x801), WRAPPER2]),
      [uuid(0x802)],
    ])
    expect(sorted(targets.unpointedExecutions.map((e) => e.id))).toEqual(sorted([INNER, INNER2]))
    expect(unknownColumns(touched)).toEqual([])
  })

  // Decided 2026-10-07: an inner run's own app_runs row (on the component's
  // app) loses its content too, with the same checks as the app's own runs.
  it("takes each inner run's own app run, level by level, and only the runner's run of that execution", async () => {
    const touched: Touch[] = []
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(), touched }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    // The app's own runs are erased by the route, by app id: level 0 has none here.
    expect(targets.levels.map((l) => l.appRunIds)).toEqual([[], [INNER_RUN], [INNER2_RUN]])
    expect(targets.runIds).toEqual([RUN])
    expect(touched).toContainEqual({ table: "app_runs", column: "runner_id", via: "eq" })
    expect(unknownColumns(touched)).toEqual([])
  })

  it("checks only the runner when the component's app is gone", async () => {
    const t = tables()
    t.published_apps = t.published_apps.filter((a) => a.id !== COMPONENT_APP)
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: t }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.levels.map((l) => l.appRunIds)).toEqual([[], [INNER_RUN], [INNER2_RUN]])
  })

  it("leaves the inner runs' app runs of a skipped run alone", async () => {
    const t = tables()
    t.jobs[4] = job(uuid(0x802), INNER2, RUNNER, "processing")
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: t }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.skippedRunIds).toEqual([RUN])
    expect(targets.levels.flatMap((l) => l.appRunIds)).toEqual([])
  })

  it("fails the read when the inner app runs cannot be read", async () => {
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(), failRead: "published_apps" }))

    await expect(collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)).rejects.toThrow("published_apps")
  })

  it("skips the run while an inner run's job is held for review", async () => {
    const t = tables()
    t.jobs[4] = job(uuid(0x802), INNER2, RUNNER, "pending_review")
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: t }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.skippedRunIds).toEqual([RUN])
    expect(targets.levels.flatMap((l) => l.executionIds)).toEqual([])
  })
})

describe("collectAppExpungeTargets — runs in flight are skipped", () => {
  const BUSY_EXEC = uuid(0x201)
  const DONE_EXEC = uuid(0x202)
  const BUSY_RUN = uuid(0x101)
  const DONE_RUN = uuid(0x102)

  const tables = (busy: Row, busyJob: Row = job(uuid(0x301), BUSY_EXEC, RUNNER)) => ({
    app_runs: [run(1, BUSY_EXEC), run(2, DONE_EXEC)],
    workflow_executions: [busy, execution(DONE_EXEC, RUNNER)],
    jobs: [busyJob, job(uuid(0x302), DONE_EXEC, RUNNER)],
  })

  it.each([
    ["a running execution", execution(BUSY_EXEC, RUNNER, WORKFLOW, "running"), undefined],
    ["a pending execution", execution(BUSY_EXEC, RUNNER, WORKFLOW, "pending", { started_at: null }), undefined],
    ["a stopping execution", execution(BUSY_EXEC, RUNNER, WORKFLOW, "stopping"), undefined],
    ["a job still processing", execution(BUSY_EXEC, RUNNER), job(uuid(0x301), BUSY_EXEC, RUNNER, "processing")],
    ["a job held for review", execution(BUSY_EXEC, RUNNER), job(uuid(0x301), BUSY_EXEC, RUNNER, "pending_review")],
  ])("skips the run with %s and erases the finished one", async (_label, busy, busyJob) => {
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(busy, busyJob) }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.skippedRunIds).toEqual([BUSY_RUN])
    expect(targets.runIds).toEqual([DONE_RUN])
    expect(targetExecutionIds(targets)).toEqual([DONE_EXEC])
    expect(targetJobIds(targets)).toEqual([uuid(0x302)])
  })

  it("does not skip for another user's in-flight job planted on the run", async () => {
    const t = tables(execution(BUSY_EXEC, RUNNER))
    t.jobs.push(job(uuid(0x303), BUSY_EXEC, OTHER_USER, "processing"))
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: t }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.skippedRunIds).toEqual([])
    expect(targetJobIds(targets)).not.toContain(uuid(0x303))
  })

  // Stuck past the stale-execution threshold the reconcile sweeps use (4 h,
  // plus the run's budget excess): written off, so it counts as finished.
  it("counts an execution stuck past the stale threshold as finished", async () => {
    const stuck = execution(BUSY_EXEC, RUNNER, WORKFLOW, "running", { started_at: ago(5 * HOUR) })
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(stuck) }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.skippedRunIds).toEqual([])
    expect(sorted(targetExecutionIds(targets))).toEqual(sorted([BUSY_EXEC, DONE_EXEC]))
  })

  it("counts a pending execution never picked up as stuck from its creation", async () => {
    const stuck = execution(BUSY_EXEC, RUNNER, WORKFLOW, "pending", { started_at: null, created_at: ago(5 * HOUR) })
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(stuck) }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.skippedRunIds).toEqual([])
  })

  it("gives a run with a long render its budget excess before it counts as stuck", async () => {
    vi.mocked(executionBudgetExcessMs).mockResolvedValue(2 * HOUR)
    const long = execution(BUSY_EXEC, RUNNER, WORKFLOW, "running", { started_at: ago(5 * HOUR) })
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(long) }))

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.skippedRunIds).toEqual([BUSY_RUN])
    expect(executionBudgetExcessMs).toHaveBeenCalledWith(BUSY_EXEC, RUNNER)
  })
})

describe("collectAppExpungeTargets — paging", () => {
  it("pages runs and chunks every id list", async () => {
    // 1,201 runs, each with its own execution and job: three pages of runs,
    // and no `.in()` longer than 100 ids.
    const runs: Row[] = []
    const execs: Row[] = []
    const jobs: Row[] = []
    for (let i = 0; i < 1201; i++) {
      const e = uuid(0x10000 + i)
      runs.push(run(i, e))
      execs.push(execution(e, RUNNER))
      jobs.push(job(uuid(0x20000 + i), e, RUNNER))
    }
    const inCalls: Array<{ table: string; column: string; size: number }> = []
    vi.mocked(supabase.from).mockImplementation(
      fakeSupabase({ tables: { app_runs: runs, workflow_executions: execs, jobs }, inCalls }),
    )

    const targets = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)

    expect(targets.runIds).toHaveLength(1201)
    expect(targetExecutionIds(targets)).toHaveLength(1201)
    expect(targetJobIds(targets)).toHaveLength(1201)
    expect(inCalls.length).toBeGreaterThan(0)
    expect(Math.max(...inCalls.map((c) => c.size))).toBeLessThanOrEqual(100)
  })

  // PostgREST stops a read at its row cap (1000) without an error. An app
  // whose graph makes many jobs per run passes it in one read of 100
  // executions; every job past the cut must still be read.
  it("reads every page of a run's jobs, so a held job past the row cap still skips the run", async () => {
    const EXEC = uuid(0x201)
    const jobs: Row[] = []
    for (let i = 0; i < 1200; i++) jobs.push(job(uuid(0x30000 + i), EXEC, RUNNER))
    jobs.push(job(uuid(0x3ffff), EXEC, RUNNER, "pending_review"))
    const tables = { app_runs: [run(1, EXEC)], workflow_executions: [execution(EXEC, RUNNER)], jobs }
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables }))

    const held = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)
    expect(held.skippedRunIds).toEqual([uuid(0x101)])

    jobs[jobs.length - 1] = job(uuid(0x3ffff), EXEC, RUNNER, "completed")
    const done = await collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)
    expect(targetJobIds(done)).toHaveLength(1201)
  })

  it.each(["app_runs", "workflow_executions", "jobs"])("throws when the %s read fails", async (table) => {
    const tables = {
      app_runs: [run(1, uuid(0x201))],
      workflow_executions: [execution(uuid(0x201), RUNNER)],
      jobs: [job(uuid(0x301), uuid(0x201), RUNNER)],
    }
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables, failRead: table }))

    await expect(collectAppExpungeTargets(APP_ID, WORKFLOW, NOW)).rejects.toThrow(table)
  })
})

const JOB_PATCH = {
  input_data: {},
  output_data: null,
  held_output_data: null,
  error_message: null,
  error_detail: null,
  input_fingerprint: null,
  reconcile_last_error: null,
}

describe("redactAppExpungeTargets", () => {
  const execIds = Array.from({ length: 150 }, (_, i) => uuid(0x30000 + i))
  const jobIds = Array.from({ length: 3 }, (_, i) => uuid(0x40000 + i))
  const tables = () => ({
    workflow_executions: [
      ...execIds.map((id) => ({ id, node_states: { n: { url: "x" } }, input_overrides: { n: { prompt: "p" } } })),
      // Not a target: must not be touched.
      { id: uuid(0x3ffff), node_states: { keep: true }, input_overrides: null },
    ],
    jobs: [
      ...jobIds.map((id) => ({ id, input_data: { prompt: "p" }, output_data: { url: "x" } })),
      { id: uuid(0x4ffff), input_data: { keep: true }, output_data: null },
    ],
  })
  const one = { levels: [{ executionIds: execIds, jobIds }] }

  it("writes the redaction patch to exactly the target rows, in chunks", async () => {
    const touched: Touch[] = []
    const updates: Update[] = []
    const inCalls: Array<{ table: string; column: string; size: number }> = []
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(), touched, updates, inCalls }))

    const result = await redactAppExpungeTargets(one)

    expect(result).toEqual({ executions: 150, jobs: 3, innerRuns: 0, reports: 0 })
    const execUpdates = updates.filter((u) => u.table === "workflow_executions")
    const jobUpdates = updates.filter((u) => u.table === "jobs")
    for (const u of execUpdates) expect(u.patch).toEqual({ node_states: {}, input_overrides: null, video_link_files: null, error_message: null })
    for (const u of jobUpdates) expect(u.patch).toEqual(JOB_PATCH)
    expect(execUpdates.flatMap((u) => u.ids).sort()).toEqual([...execIds].sort())
    expect(jobUpdates.flatMap((u) => u.ids).sort()).toEqual([...jobIds].sort())
    expect(Math.max(...inCalls.map((c) => c.size))).toBeLessThanOrEqual(100)
    expect(inCalls.filter((c) => c.table !== "app_reports").every((c) => c.column === "id")).toBe(true)
    expect(unknownColumns(touched)).toEqual([])
  })

  // A wrapper job names its inner run: cleared first, a failure part-way
  // would leave the inner run unreachable for the retry.
  it("erases the deepest component level first, the runs' own last", async () => {
    const TOP = uuid(0x601)
    const INNER = uuid(0x602)
    const WRAPPER = uuid(0x701)
    const INNER_JOB = uuid(0x702)
    const t = {
      workflow_executions: [{ id: TOP }, { id: INNER }],
      jobs: [{ id: WRAPPER }, { id: INNER_JOB }],
    }
    const updates: Update[] = []
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: t, updates }))

    await redactAppExpungeTargets({
      levels: [
        { executionIds: [TOP], jobIds: [WRAPPER] },
        { executionIds: [INNER], jobIds: [INNER_JOB] },
      ],
    })

    expect(updates.filter((u) => u.table !== "app_reports").map((u) => u.ids[0])).toEqual([INNER, INNER_JOB, TOP, WRAPPER])
  })

  // Decided 2026-10-07: an inner run's own app run is erased with its level,
  // before the wrapper that names the inner execution it is found through.
  it("erases each level's inner app runs with it, innermost first", async () => {
    const TOP = uuid(0x601)
    const INNER = uuid(0x602)
    const WRAPPER = uuid(0x701)
    const INNER_JOB = uuid(0x702)
    const INNER_RUN = uuid(0x901)
    const INNER2_RUN = uuid(0x902)
    const t = {
      workflow_executions: [{ id: TOP }, { id: INNER }],
      jobs: [{ id: WRAPPER }, { id: INNER_JOB }],
      app_runs: [{ id: INNER_RUN }, { id: INNER2_RUN }, { id: uuid(0x9ff) }],
    }
    const touched: Touch[] = []
    const updates: Update[] = []
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: t, updates, touched }))

    const result = await redactAppExpungeTargets({
      levels: [
        { executionIds: [TOP], jobIds: [WRAPPER], appRunIds: [] },
        { executionIds: [INNER], jobIds: [INNER_JOB], appRunIds: [INNER_RUN] },
        { executionIds: [], jobIds: [], appRunIds: [INNER2_RUN] },
      ],
    })

    expect(result).toEqual({ executions: 2, jobs: 2, innerRuns: 2, reports: 0 })
    expect(updates.filter((u) => u.table !== "app_reports").map((u) => `${u.table}:${u.ids.join(",")}`)).toEqual([
      `app_runs:${INNER2_RUN}`,
      `workflow_executions:${INNER}`,
      `jobs:${INNER_JOB}`,
      `app_runs:${INNER_RUN}`,
      `workflow_executions:${TOP}`,
      `jobs:${WRAPPER}`,
    ])
    for (const u of updates.filter((u) => u.table === "app_runs")) {
      expect(u.patch).toEqual({ input_values: null, node_states: null, name: null })
    }
    expect(unknownColumns(touched)).toEqual([])
  })

  it("throws, naming app_runs, when an inner app run's update fails, and leaves the wrapper", async () => {
    const updates: Update[] = []
    vi.mocked(supabase.from).mockImplementation(
      fakeSupabase({
        tables: { workflow_executions: [{ id: uuid(0x602) }], jobs: [{ id: uuid(0x701) }], app_runs: [{ id: uuid(0x901) }] },
        updates,
        failUpdate: "app_runs",
      }),
    )

    await expect(
      redactAppExpungeTargets({
        levels: [
          { executionIds: [], jobIds: [uuid(0x701)], appRunIds: [] },
          { executionIds: [uuid(0x602)], jobIds: [], appRunIds: [uuid(0x901)] },
        ],
      }),
    ).rejects.toThrow("app_runs")
    expect(updates.filter((u) => u.table === "jobs")).toEqual([])
  })

  it("leaves the wrapper (and the inner run's pointer) in place when an inner write fails", async () => {
    const updates: Update[] = []
    vi.mocked(supabase.from).mockImplementation(
      fakeSupabase({ tables: { workflow_executions: [{ id: uuid(0x602) }], jobs: [{ id: uuid(0x701) }] }, updates, failUpdate: "workflow_executions" }),
    )

    await expect(
      redactAppExpungeTargets({
        levels: [
          { executionIds: [], jobIds: [uuid(0x701)] },
          { executionIds: [uuid(0x602)], jobIds: [] },
        ],
      }),
    ).rejects.toThrow("workflow_executions")
    expect(updates.filter((u) => u.table === "jobs")).toEqual([])
  })

  // `input_overrides` is migration 466. Staging runs dev against the shared
  // database before the migration applies there, and a write naming a missing
  // column fails whole — so the expunge would fail at linked_redact_failed.
  // The pin is cleared through its guard module, which drops it once missing.
  it("clears the rest when the pin column is not in the database yet, and stops naming it", async () => {
    resetInputOverridesColumnForTests()
    const updates: Update[] = []
    const rejected: Update[] = []
    vi.mocked(supabase.from).mockImplementation(
      fakeSupabase({
        tables: tables(),
        updates,
        rejected,
        missingColumn: { table: "workflow_executions", column: "input_overrides" },
      }),
    )

    const result = await redactAppExpungeTargets(one)

    expect(result).toEqual({ executions: 150, jobs: 3, innerRuns: 0, reports: 0 })
    const execUpdates = updates.filter((u) => u.table === "workflow_executions")
    for (const u of execUpdates) expect(u.patch).toEqual({ node_states: {}, video_link_files: null, error_message: null })
    expect(execUpdates.flatMap((u) => u.ids).sort()).toEqual([...execIds].sort())
    // Learned once: the second chunk is written without the column straight away.
    expect(rejected).toHaveLength(1)
    resetInputOverridesColumnForTests()
  })

  // `video_link_files` is migration 487 (the files a run fetched from a Video URL
  // link, a runner's content). The same window, the same rule: a write naming it
  // before the migration reaches the shared database fails whole, and that must
  // neither fail the expunge nor make the pin column look missing.
  it("clears the rest when the fetched-files column is not in the database yet — and the pin is still cleared", async () => {
    resetInputOverridesColumnForTests()
    resetVideoLinkFilesColumnForTests()
    const updates: Update[] = []
    const rejected: Update[] = []
    vi.mocked(supabase.from).mockImplementation(
      fakeSupabase({ tables: tables(), updates, rejected, missingColumn: { table: "workflow_executions", column: "video_link_files" } }),
    )

    const result = await redactAppExpungeTargets(one)

    expect(result).toEqual({ executions: 150, jobs: 3, innerRuns: 0, reports: 0 })
    const execUpdates = updates.filter((u) => u.table === "workflow_executions")
    for (const u of execUpdates) expect(u.patch).toEqual({ node_states: {}, input_overrides: null, error_message: null })
    expect(execUpdates.flatMap((u) => u.ids).sort()).toEqual([...execIds].sort())
    expect(rejected).toHaveLength(1)
    resetInputOverridesColumnForTests()
    resetVideoLinkFilesColumnForTests()
  })

  it("clears the rest when BOTH columns are missing: one retry per missing column, then the plain patch", async () => {
    resetInputOverridesColumnForTests()
    resetVideoLinkFilesColumnForTests()
    const updates: Update[] = []
    const rejected: Update[] = []
    vi.mocked(supabase.from).mockImplementation(
      fakeSupabase({
        tables: tables(),
        updates,
        rejected,
        missingColumn: [
          { table: "workflow_executions", column: "input_overrides" },
          { table: "workflow_executions", column: "video_link_files" },
        ],
      }),
    )

    const result = await redactAppExpungeTargets(one)

    expect(result).toEqual({ executions: 150, jobs: 3, innerRuns: 0, reports: 0 })
    const execUpdates = updates.filter((u) => u.table === "workflow_executions")
    for (const u of execUpdates) expect(u.patch).toEqual({ node_states: {}, error_message: null })
    expect(execUpdates.flatMap((u) => u.ids).sort()).toEqual([...execIds].sort())
    expect(rejected).toHaveLength(2)
    resetInputOverridesColumnForTests()
    resetVideoLinkFilesColumnForTests()
  })

  it("writes nothing for no targets", async () => {
    const updates: Update[] = []
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(), updates }))

    expect(await redactAppExpungeTargets({ levels: [] })).toEqual({ executions: 0, jobs: 0, innerRuns: 0, reports: 0 })
    expect(updates).toEqual([])
  })

  // Decided 2026-10-07: the reports the sweeps filed for the erased jobs and
  // executions lose their title and payload — the error line, the raw provider
  // error and the prompt excerpt copied into them. The rows stay, for ops
  // counts, kinds and timestamps. Found by the target ids alone, with no
  // owner filter: the ids are already ownership-checked, and the job-policy
  // reporters file rows with no user (`recordLostRace`, `correctRefundClaim`).
  describe("the reports filed for the erased jobs and executions", () => {
    const TOP = uuid(0x601)
    const INNER = uuid(0x602)
    const WRAPPER = uuid(0x701)
    const INNER_JOB = uuid(0x702)
    const OTHER_JOB = uuid(0x7ff)
    const OTHER_EXEC = uuid(0x6ff)
    const REPORT = {
      wrapperFailure: uuid(0xa01),
      innerExecFailure: uuid(0xa02),
      innerJobLostRace: uuid(0xa03),
      topExecAndJob: uuid(0xa04),
      otherJob: uuid(0xa05),
      otherExec: uuid(0xa06),
      noPointer: uuid(0xa07),
    }
    const reportTables = () => ({
      workflow_executions: [{ id: TOP }, { id: INNER }, { id: OTHER_EXEC }],
      jobs: [{ id: WRAPPER }, { id: INNER_JOB }, { id: OTHER_JOB }],
      app_reports: [
        { id: REPORT.wrapperFailure, kind: "job-failure", title: "component failed: a prompt", payload: { prompt: "p" }, user_id: RUNNER, job_id: WRAPPER, execution_id: null },
        { id: REPORT.innerExecFailure, kind: "execution-failure", title: "failed: x", payload: { error: "x" }, user_id: RUNNER, job_id: null, execution_id: INNER },
        { id: REPORT.innerJobLostRace, kind: "policy-decision-lost-race", title: "job …", payload: {}, user_id: null, job_id: INNER_JOB, execution_id: null },
        { id: REPORT.topExecAndJob, kind: "issue", title: "both", payload: { a: 1 }, user_id: RUNNER, job_id: WRAPPER, execution_id: TOP },
        // Not the expunge's: another job's and another execution's reports, and one with no pointer.
        { id: REPORT.otherJob, kind: "job-failure", title: "keep", payload: { keep: true }, user_id: OTHER_USER, job_id: OTHER_JOB, execution_id: null },
        { id: REPORT.otherExec, kind: "execution-failure", title: "keep", payload: { keep: true }, user_id: OTHER_USER, job_id: null, execution_id: OTHER_EXEC },
        { id: REPORT.noPointer, kind: "copilot-turn-failure", title: "keep", payload: { keep: true }, user_id: RUNNER, job_id: null, execution_id: null },
      ],
    })
    const levels = {
      levels: [
        { executionIds: [TOP], jobIds: [WRAPPER], appRunIds: [] },
        { executionIds: [INNER], jobIds: [INNER_JOB], appRunIds: [] },
      ],
    }

    it("clears each report's title and payload, and only those of the target jobs and executions", async () => {
      const touched: Touch[] = []
      const updates: Update[] = []
      vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: reportTables(), touched, updates }))

      const result = await redactAppExpungeTargets(levels)

      // REPORT.topExecAndJob names both a target job and a target execution: counted once.
      expect(result).toEqual({ executions: 2, jobs: 2, innerRuns: 0, reports: 4 })
      const reportUpdates = updates.filter((u) => u.table === "app_reports")
      for (const u of reportUpdates) expect(u.patch).toEqual({ title: "", payload: {} })
      expect([...new Set(reportUpdates.flatMap((u) => u.ids))].sort()).toEqual(
        [REPORT.wrapperFailure, REPORT.innerExecFailure, REPORT.innerJobLostRace, REPORT.topExecAndJob].sort(),
      )
      expect(unknownColumns(touched)).toEqual([])
    })

    // A level's reports are found through its execution and job ids, which a
    // retry finds again only while the wrapper above still names the inner
    // run: they are cleared with their level, before the level above it. And
    // after the level's own jobs, so a report filed from a job not yet erased
    // is not left behind. This order is half of why a failure sweep that
    // overlaps the expunge leaves nothing behind; the sweep's re-read after
    // its insert is the other half (`app-report-sweep-expunge-race.test.ts`).
    it("clears a level's reports after its jobs and before the level above", async () => {
      const updates: Update[] = []
      vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: reportTables(), updates }))

      await redactAppExpungeTargets(levels)

      expect(updates.map((u) => u.table)).toEqual([
        "workflow_executions",
        "jobs",
        "app_reports",
        "app_reports",
        "workflow_executions",
        "jobs",
        "app_reports",
        "app_reports",
      ])
      expect(updates[2]!.ids).toEqual([REPORT.innerExecFailure])
      expect(updates[3]!.ids).toEqual([REPORT.innerJobLostRace])
    })

    it("throws, naming app_reports, when a report's update fails, and leaves the level above", async () => {
      const updates: Update[] = []
      vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: reportTables(), updates, failUpdate: "app_reports" }))

      await expect(redactAppExpungeTargets(levels)).rejects.toThrow("app_reports")
      expect(updates.map((u) => `${u.table}:${u.ids.join(",")}`)).toEqual([`workflow_executions:${INNER}`, `jobs:${INNER_JOB}`])
    })

    it("chunks the report writes at 100 ids", async () => {
      const execIds = Array.from({ length: 150 }, (_, i) => uuid(0x30000 + i))
      const inCalls: Array<{ table: string; column: string; size: number }> = []
      vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: { workflow_executions: [], jobs: [], app_reports: [] }, inCalls }))

      await redactAppExpungeTargets({ levels: [{ executionIds: execIds, jobIds: [] }] })

      const reportIns = inCalls.filter((c) => c.table === "app_reports")
      expect(reportIns.map((c) => `${c.column}:${c.size}`)).toEqual(["execution_id:100", "execution_id:50"])
    })
  })

  it.each(["workflow_executions", "jobs"])("throws, naming %s, when its update fails", async (table) => {
    vi.mocked(supabase.from).mockImplementation(fakeSupabase({ tables: tables(), failUpdate: table }))

    await expect(redactAppExpungeTargets(one)).rejects.toThrow(table)
  })
})
