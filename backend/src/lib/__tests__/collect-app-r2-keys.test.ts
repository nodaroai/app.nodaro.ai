/**
 * `collectAppR2Keys` feeds the admin expunge, which DELETES every key it
 * returns. So it harvests only rows that are the run's own (decided
 * 2026-10-06; migration 474): an execution the run's runner owns — the run's
 * `execution_id`, its Render final's `final_execution_id`, and a chain's
 * earlier finals found by their runner-writable stamps — and that owner's
 * jobs. A row another user planted — a job naming the execution, or a run
 * pointing at someone else's execution — must not turn its URLs into
 * deletions of files that are not this app's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, unknown>
const tables = vi.hoisted(() => ({ current: {} as Record<string, Row[]> }))

vi.mock("../supabase.js", () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    let single = false
    let limit = Infinity
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), builder),
      in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), builder),
      gt: (col: string, val: string) => (filters.push((r) => String(r[col]) > val), builder),
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      single: () => ((single = true), builder),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        // PostgREST's row cap: at most 1000 rows a read, without an error.
        const rows = (tables.current[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, Math.min(limit, 1000))
        return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(resolve, reject)
      },
    }
    return builder
  }
  return { supabase: { from } }
})

vi.mock("../../ee/billing/cleanup-service.js", () => ({
  r2KeyFromUrl: (url: string) => (url.startsWith("https://r2.test/") ? url.slice("https://r2.test/".length) : null),
}))

import { collectAppR2Keys } from "../collect-app-r2-keys.js"
import { resetFinalExecutionColumnForTests } from "../app-run-final-column.js"

const url = (key: string) => `https://r2.test/${key}`

beforeEach(() => {
  resetFinalExecutionColumnForTests()
  tables.current = {
    published_apps: [{ id: "app", icon_url: url("icon"), preview_media_url: null, snapshot_nodes: [] }],
    app_runs: [
      { id: "r1", app_id: "app", runner_id: "alice", input_values: null, node_states: null, execution_id: "e-alice", final_execution_id: "f-alice" },
      // Mallory points her run (and its final) at Bob's executions.
      { id: "r2", app_id: "app", runner_id: "mallory", input_values: null, node_states: null, execution_id: "e-bob", final_execution_id: "f-bob" },
      { id: "r3", app_id: "app", runner_id: "mallory", input_values: null, node_states: null, execution_id: null, final_execution_id: "f-mallory" },
    ],
    workflow_executions: [
      { id: "e-alice", user_id: "alice", node_states: { a: { output: { url: url("alice-run") } } } },
      {
        id: "f-alice",
        user_id: "alice",
        node_states: { a: { output: { url: url("alice-final") } } },
        trigger_data: { appRenderFinal: { appRunId: "r1", appVersionId: "app", continuedFrom: "f0-alice" } },
      },
      // Alice's first final of a chain (decided 2026-10-06): the run links only the newest.
      {
        id: "f0-alice",
        user_id: "alice",
        node_states: { a: { output: { url: url("alice-first-final") } } },
        trigger_data: { appRenderFinal: { appRunId: "r1", appVersionId: "app", continuedFrom: "e-alice" } },
      },
      { id: "e-bob", user_id: "bob", node_states: { b: { output: { url: url("bob-run") } } } },
      { id: "f-bob", user_id: "bob", node_states: { b: { output: { url: url("bob-final") } } } },
      // Mallory's own final, its stamp forged to name Bob's execution as an earlier final.
      {
        id: "f-mallory",
        user_id: "mallory",
        node_states: {},
        trigger_data: { appRenderFinal: { appRunId: "r3", appVersionId: "app", continuedFrom: "e-bob" } },
      },
    ],
    // Each job's key is its own key family (`<jobId>`), as a worker writes it.
    jobs: [
      { id: "alice-final-job", user_id: "alice", workflow_execution_id: "f-alice", output_data: { url: url("alice-final-job") } },
      { id: "alice-first-final-job", user_id: "alice", workflow_execution_id: "f0-alice", output_data: { url: url("alice-first-final-job") } },
      { id: "bob-run-job", user_id: "bob", workflow_execution_id: "e-bob", output_data: { url: url("bob-run-job") } },
      { id: "bob-final-job", user_id: "bob", workflow_execution_id: "f-bob", output_data: { url: url("bob-final-job") } },
    ],
  }
})

describe("collectAppR2Keys", () => {
  it("harvests a run's own execution and its final, with their jobs", async () => {
    const keys = await collectAppR2Keys("app")
    expect(keys).toEqual(expect.arrayContaining(["icon", "alice-run", "alice-final", "alice-final-job"]))
  })

  it("harvests the earlier finals of a chain too, by their stamps", async () => {
    const keys = await collectAppR2Keys("app")
    expect(keys).toEqual(expect.arrayContaining(["alice-first-final", "alice-first-final-job"]))
  })

  it("never harvests an execution (or its jobs) that is not the run's runner's own", async () => {
    const keys = await collectAppR2Keys("app")
    expect(keys.filter((k) => k.startsWith("bob"))).toEqual([])
  })
})

// The expunge skips a run with anything still in flight (decided 2026-10-06):
// its files stay, and so does the app's own media while the app row is kept.
describe("collectAppR2Keys — skipped runs", () => {
  it("harvests nothing of a skipped run, nor the app's own media", async () => {
    const keys = await collectAppR2Keys("app", { skipRunIds: new Set(["r1"]) })
    expect(keys.filter((k) => k.startsWith("alice") || k === "icon")).toEqual([])
  })

  it("still harvests the finished runs", async () => {
    tables.current.app_runs!.push({
      id: "r4", app_id: "app", runner_id: "carol", input_values: { a: url("carol-input") }, node_states: null, execution_id: "e-carol", final_execution_id: null,
    })
    tables.current.workflow_executions!.push({ id: "e-carol", user_id: "carol", node_states: { c: { output: { url: url("carol-run") } } } })
    const keys = await collectAppR2Keys("app", { skipRunIds: new Set(["r1"]) })
    expect(keys).toEqual(expect.arrayContaining(["carol-input", "carol-run"]))
  })
})

// Executions no run pointer names — an earlier execution of a re-run run, a
// component's inner run — come from the expunge's own walk, with their owner.
describe("collectAppR2Keys — executions beyond the runs' pointers", () => {
  beforeEach(() => {
    tables.current.workflow_executions!.push(
      { id: "e-alice-first", user_id: "alice", node_states: { a: { output: { url: url("alice-first-run") } } } },
      { id: "e-bob-other", user_id: "bob", node_states: { b: { output: { url: url("bob-other") } } } },
    )
    tables.current.jobs!.push(
      { id: "j1", user_id: "alice", workflow_execution_id: "e-alice-first", output_data: { url: url("j1") } },
      // Someone else's job naming Alice's execution (its key is its own family,
      // so only the owner check keeps it out).
      { id: "j2", user_id: "bob", workflow_execution_id: "e-alice-first", output_data: { url: url("j2") } },
    )
  })

  it("harvests their node states and their owner's jobs", async () => {
    const keys = await collectAppR2Keys("app", { extraExecutions: [{ id: "e-alice-first", owner: "alice" }] })
    expect(keys).toEqual(expect.arrayContaining(["alice-first-run", "j1"]))
    expect(keys).not.toContain("j2")
  })

  it("leaves an execution whose owner is not the one named", async () => {
    const keys = await collectAppR2Keys("app", { extraExecutions: [{ id: "e-bob-other", owner: "alice" }] })
    expect(keys).not.toContain("bob-other")
  })
})

describe("collectAppR2Keys — paging", () => {
  // An execution with more jobs than one read returns: the jobs past the
  // PostgREST row cap carry files too.
  it("reads every page of a run's jobs", async () => {
    const id = (i: number) => `job-${String(i).padStart(5, "0")}`
    for (let i = 0; i < 1200; i++) {
      tables.current.jobs!.push({ id: id(i), user_id: "alice", workflow_execution_id: "e-alice", output_data: { url: url(id(i)) } })
    }
    const keys = await collectAppR2Keys("app")
    expect(keys).toContain(id(1199))
  })
})

describe("collectAppR2Keys — only the run's own rows", () => {
  beforeEach(() => {
    tables.current = {
      published_apps: [{ id: "app-1", icon_url: null, preview_media_url: null, snapshot_nodes: null }],
      app_runs: [{ id: "run-1", app_id: "app-1", runner_id: "runner-1", input_values: null, node_states: null, execution_id: "exec-1" }],
      workflow_executions: [{ id: "exec-1", user_id: "runner-1", node_states: { n: { output: { imageUrl: url("runner/own-node.png") } } } }],
      jobs: [
        {
          id: "job-1", user_id: "runner-1", workflow_execution_id: "exec-1",
          output_data: { imageUrl: url("images/job-1.png"), thumbnailUrl: url("thumbnails/job-1-v2.png") },
        },
      ],
    }
  })

  it("collects the run's execution and its owner's jobs", async () => {
    expect((await collectAppR2Keys("app-1")).sort()).toEqual(["images/job-1.png", "runner/own-node.png", "thumbnails/job-1-v2.png"])
  })

  it("attacker: the run owner's own job, with another user's URL planted in its output, adds only its own key family", async () => {
    // Before 474 a client could insert its own job as 'completed' with any
    // output_data. Owner checks pass for such a row, so the key itself must
    // be the job's: `<prefix>/<jobId>` or `<prefix>/<jobId>-<suffix>`.
    tables.current.jobs!.push({
      id: "job-2", user_id: "runner-1", workflow_execution_id: "exec-1",
      output_data: { imageUrl: url("images/victim-job.png"), videoUrl: url("videos/job-2.mp4"), extra: [url("videos/job-1.mp4")] },
    })
    const keys = await collectAppR2Keys("app-1")
    expect(keys).toContain("videos/job-2.mp4")
    expect(keys).not.toContain("images/victim-job.png")
    // Not even a sibling job's key: each job vouches only for its own family.
    expect(keys).not.toContain("videos/job-1.mp4")
  })

  it("attacker: a job another user pointed at the run's execution adds no key to delete", async () => {
    tables.current.jobs!.push({ id: "job-a", user_id: "attacker", workflow_execution_id: "exec-1", output_data: { imageUrl: url("victim/job-a.png") } })
    expect(await collectAppR2Keys("app-1")).not.toContain("victim/job-a.png")
  })

  it("attacker: a job another user pointed at a run's Render final adds no key to delete", async () => {
    tables.current.app_runs = [{ ...tables.current.app_runs![0]!, final_execution_id: "final-1" }]
    tables.current.workflow_executions!.push({ id: "final-1", user_id: "runner-1", node_states: {} })
    tables.current.jobs!.push(
      { id: "job-f", user_id: "runner-1", workflow_execution_id: "final-1", output_data: { url: url("videos/job-f.mp4") } },
      { id: "job-p", user_id: "attacker", workflow_execution_id: "final-1", output_data: { url: url("videos/job-p.mp4") } },
    )
    const keys = await collectAppR2Keys("app-1")
    expect(keys).toContain("videos/job-f.mp4")
    expect(keys).not.toContain("videos/job-p.mp4")
  })

  it("a run pointing at another user's execution adds neither that execution's keys nor its jobs'", async () => {
    tables.current.workflow_executions = [{ id: "exec-1", user_id: "victim", node_states: { n: { output: { imageUrl: url("victim/node.png") } } } }]
    tables.current.jobs = [{ id: "job-v", user_id: "victim", workflow_execution_id: "exec-1", output_data: { imageUrl: url("images/job-v.png") } }]
    expect(await collectAppR2Keys("app-1")).toEqual([])
  })
})
