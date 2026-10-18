/**
 * Round 3 (decided 2026-10-06): a continuation re-applies the input overrides
 * PINNED on the earlier execution (`workflow_executions.input_overrides`,
 * migration 466) — what that run applied, written when it started — never
 * `app_runs.input_values`, which can drift from it (R2-1):
 *   - a draft run with no inputs leaves the draft's values in the row;
 *   - a PATCH of the row rewrites them after the run.
 * An execution made before the migration has no pin (NULL): it falls back to
 * the round-2 reading (an app run's `app_runs.input_values`; a live run's
 * none). Until the migration reaches the shared database the column does not
 * exist, and the read retries without it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  execution: null as Record<string, unknown> | null,
  appRun: null as Record<string, unknown> | null,
  /** The database has no `input_overrides` column yet (staging before promotion). */
  columnMissing: false,
  executionSelects: [] as string[],
  /** The filters the app_runs lookup applied, as [column, value]. */
  appRunFilters: [] as Array<[string, unknown]>,
  /** The run row an `app_runs` lookup BY ID finds (the execution's app-run stamp). */
  appRunById: null as Record<string, unknown> | null,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === "workflow_executions") db.executionSelects.push(columns)
        let byId = false
        const self = {
          eq: (column: string, value: unknown) => {
            if (table === "app_runs") db.appRunFilters.push([column, value])
            if (column === "id" && table === "app_runs") byId = true
            return self
          },
          maybeSingle: async () => {
            if (table === "workflow_executions") {
              if (db.columnMissing && columns.includes("input_overrides")) {
                return { data: null, error: { code: "42703", message: "column workflow_executions.input_overrides does not exist" } }
              }
              if (!db.execution) return { data: null, error: null }
              const { input_overrides, ...rest } = db.execution
              return { data: columns.includes("input_overrides") ? { ...rest, input_overrides } : rest, error: null }
            }
            if (table === "app_runs") return { data: byId ? db.appRunById : db.appRun, error: null }
            return { data: null, error: null }
          },
        }
        return self
      },
    }),
  },
}))
vi.mock("@/lib/canvas-result-ids.js", () => ({
  resolveRunStateStamps: async (states: unknown) => states,
}))

import { CONTINUATION_VERSION_MISMATCH } from "@nodaro/shared/nodes"
import { STAMPED_APP_RUN_UNKNOWN_VERSION, continuationRefusal, loadContinuationSource } from "../run-continuation.js"
import { resetInputOverridesColumnForTests } from "../../../lib/execution-input-overrides.js"

const load = () => loadContinuationSource("exec-0", { withStates: true, isRenderNode: () => false })

beforeEach(() => {
  resetInputOverridesColumnForTests()
  db.columnMissing = false
  db.executionSelects.length = 0
  db.appRunFilters.length = 0
  db.execution = { id: "exec-0", user_id: "u1", workflow_id: "wf-1", status: "completed", trigger_type: "manual", node_states: {}, input_overrides: null }
  db.appRun = null
  db.appRunById = null
})

describe("the overrides a continuation re-applies: the earlier execution's pin", () => {
  it("R2-1 (PATCH): the app run's row was rewritten after the run; the pin is what that run applied", async () => {
    db.execution!.input_overrides = { cap: { fontSize: 72 } }
    db.appRun = { app_id: "app-1", input_values: { cap: { fontSize: 12 }, cut: { quality: "proxy" } } }
    const source = await load()
    expect(source!.appVersionId).toBe("app-1")
    expect(source!.inputOverrides).toEqual({ cap: { fontSize: 72 } })
  })

  it("R2-1 (draft): a run with no inputs pinned {}; the draft's values left in the row are not re-applied", async () => {
    db.execution!.input_overrides = {}
    db.appRun = { app_id: "app-1", input_values: { cap: { fontSize: 12 } } }
    const source = await load()
    expect(source!.inputOverrides ?? null).toBeNull()
  })

  it("a run of the live workflow re-applies its pin too (it was sent overrides; no app row holds them)", async () => {
    db.execution!.input_overrides = { cap: { fontSize: 60 } }
    const source = await load()
    expect(source!.appVersionId).toBeNull()
    expect(source!.inputOverrides).toEqual({ cap: { fontSize: 60 } })
  })

  it("an execution made before the pin existed (NULL) falls back: an app run's row", async () => {
    db.appRun = { app_id: "app-1", input_values: { cap: { fontSize: 12 } } }
    expect((await load())!.inputOverrides).toEqual({ cap: { fontSize: 12 } })
  })

  it("an execution made before the pin existed, of the live workflow: none", async () => {
    expect((await load())!.inputOverrides ?? null).toBeNull()
  })

  it("before the column reaches the database: the read retries without it, falls back, and stops naming it", async () => {
    db.columnMissing = true
    db.appRun = { app_id: "app-1", input_values: { cap: { fontSize: 12 } } }
    const source = await load()
    expect(source!.status).toBe("completed")
    expect(source!.inputOverrides).toEqual({ cap: { fontSize: 12 } })
    db.executionSelects.length = 0
    await load()
    expect(db.executionSelects.some((c) => c.includes("input_overrides"))).toBe(false)
  })

  it("a route's check reads no overrides, so never names the column", async () => {
    await loadContinuationSource("exec-0", { withStates: false })
    expect(db.executionSelects.some((c) => c.includes("input_overrides"))).toBe(false)
  })

  // R3-1: the run route's pre-checks judge the map the orchestrator applies,
  // so it reads the pin too — without the node states.
  describe("a route's check that asks for the pin (`withPin`)", () => {
    const loadPin = () => loadContinuationSource("exec-0", { withStates: false, withPin: true })

    it("reads the pin and no node states", async () => {
      db.execution!.input_overrides = { cut: { quality: "final" } }
      const source = await loadPin()
      expect(source!.inputOverrides).toEqual({ cut: { quality: "final" } })
      expect(source!.nodeStates).toBeUndefined()
      expect(db.executionSelects.some((c) => c.includes("node_states"))).toBe(false)
    })

    it("falls back exactly as the seeding read does: an execution from before the pin, of an app run", async () => {
      db.appRun = { app_id: "app-1", input_values: { cap: { fontSize: 12 } } }
      expect((await loadPin())!.inputOverrides).toEqual({ cap: { fontSize: 12 } })
    })

    it("before the column reaches the database: retries without it and reads none for a live run", async () => {
      db.columnMissing = true
      const source = await loadPin()
      expect(db.executionSelects.some((c) => c.includes("input_overrides"))).toBe(true)
      expect(source!.status).toBe("completed")
      expect(source!.inputOverrides ?? null).toBeNull()
    })
  })
})

// A chain of Render finals in the app runner (decided 2026-10-06): a later
// final continues from the run's NEWEST final, an execution no app_runs row
// names by `execution_id`. Its stamp (`trigger_data.appRenderFinal`, written
// when it was created) names the published version it ran, so the version
// check holds — at the route, and at the worker after the run's link has
// already moved on to the new final.
describe("a Render final's execution as the source: the version its stamp names", () => {
  const stamped = (over: Record<string, unknown> = {}) => ({
    ...db.execution!,
    trigger_type: "app_run",
    trigger_data: { appRenderFinal: { appRunId: "run-1", appVersionId: "app-1", continuedFrom: "exec-run" } },
    ...over,
  })

  it("no app_runs row names it: the stamp's version is the source's", async () => {
    db.execution = stamped({ input_overrides: { cut: { quality: "final" } } })
    const source = await load()
    expect(source!.appVersionId).toBe("app-1")
    expect(source!.inputOverrides).toEqual({ cut: { quality: "final" } })
    expect(db.executionSelects.every((c) => c.includes("trigger_data"))).toBe(true)
  })

  it("the route's check reads it too", async () => {
    db.execution = stamped()
    expect((await loadContinuationSource("exec-0", { withStates: false }))!.appVersionId).toBe("app-1")
  })

  it("an execution with no stamp and no app run is the live workflow's", async () => {
    db.execution = { ...db.execution!, trigger_data: { triggerId: "t-1" } }
    expect((await load())!.appVersionId).toBeNull()
  })

  it("an app run's own row wins over a stamp", async () => {
    db.execution = stamped()
    db.appRun = { app_id: "app-2" }
    expect((await load())!.appVersionId).toBe("app-2")
  })
})

describe("the app run behind an execution is the execution owner's (decided 2026-10-06)", () => {
  it("the app_runs lookup filters the execution's owner as the runner", async () => {
    db.appRun = { app_id: "app-1", input_values: null }
    await load()
    expect(db.appRunFilters).toContainEqual(["execution_id", "exec-0"])
    expect(db.appRunFilters).toContainEqual(["runner_id", "u1"])
  })
})

// Continue-from-failed of a saved workflow's run (decided 2026-10-17): the
// route reads when the source started and its lineage stamp
// (lib/continue-from-failed-lineage.ts) to continue only the newest generation.
describe("the source's start and its continue-from-failed lineage", () => {
  it("reads started_at and the stamp, on both reads", async () => {
    db.execution = {
      ...db.execution!,
      started_at: "2026-10-17T10:00:00.000Z",
      trigger_data: { continueFromFailed: { from: "exec-b", root: "exec-a", all: true } },
    }
    for (const source of [await load(), await loadContinuationSource("exec-0", { withStates: false })]) {
      expect(source!.startedAt).toBe("2026-10-17T10:00:00.000Z")
      expect(source!.continueFromFailed).toEqual({ from: "exec-b", root: "exec-a", all: true })
    }
    expect(db.executionSelects.every((c) => c.includes("started_at"))).toBe(true)
  })

  it("a run that never started and carries no stamp reads as such", async () => {
    db.execution = { ...db.execution!, started_at: null, trigger_data: null }
    const source = await load()
    expect(source!.startedAt).toBeNull()
    expect(source!.continueFromFailed).toBeNull()
  })
})

// A Retry moves `app_runs.execution_id` to a new execution; the earlier one
// keeps its app-run stamp (lib/app-run-stamp.ts) and is still an app
// version's execution, never the live workflow's.
describe("an app run's earlier execution, found by its stamp", () => {
  it("no run points at it any more: the stamped run's version is the source's", async () => {
    db.execution = { ...db.execution!, trigger_data: { appRun: { appRunId: "run-1" } } }
    db.appRun = null
    db.appRunById = { app_id: "app-1", input_values: null }
    const source = await load()
    expect(source!.appVersionId).toBe("app-1")
    // Looked up by the stamp, the execution owner's run only.
    expect(db.appRunFilters).toContainEqual(["id", "run-1"])
    expect(db.appRunFilters).toContainEqual(["runner_id", "u1"])
  })

  it("its run is gone: it still reads as a published version's, one no run matches", async () => {
    db.execution = { ...db.execution!, trigger_data: { appRun: { appRunId: "run-gone" } } }
    db.appRun = null
    db.appRunById = null
    expect((await load())!.appVersionId).toBe(STAMPED_APP_RUN_UNKNOWN_VERSION)
  })

  it("a /run continue-from-failed of it is refused as another version", async () => {
    db.execution = { ...db.execution!, status: "failed", trigger_data: { appRun: { appRunId: "run-1" } } }
    db.appRun = null
    db.appRunById = { app_id: "app-1" }
    const source = await load()
    expect(continuationRefusal(source, { userId: "u1", workflowId: source!.workflowId, nodeIds: ["x"], mode: "from-failed" })).toBe(
      CONTINUATION_VERSION_MISMATCH,
    )
  })
})

// A stamp is the platform's only on a run a stamp-writing lane started
// (lib/server-started-runs.ts): a webhook's row holds the body its caller posted.
describe("a webhook execution whose body posted the platform's stamps", () => {
  const forged = {
    message: "hi",
    continueFromFailed: { from: "exec-b", root: "exec-a", seededFrom: "exec-b", all: true },
    appRun: { appRunId: "run-1" },
    appRenderFinal: { appRunId: "run-1", appVersionId: "app-1", continuedFrom: "exec-run" },
  }

  it("reads as carrying none: no lineage, the live workflow's — so its continue-from-failed is not refused as another version", async () => {
    db.execution = { ...db.execution!, status: "failed", trigger_type: "webhook", trigger_data: forged }
    db.appRunById = { app_id: "app-1", input_values: null }
    for (const source of [await load(), await loadContinuationSource("exec-0", { withStates: false })]) {
      expect(source!.continueFromFailed).toBeNull()
      expect(source!.appVersionId).toBeNull()
      expect(continuationRefusal(source, { userId: "u1", workflowId: source!.workflowId, nodeIds: ["x"], mode: "from-failed" })).toBeNull()
    }
    // The stamped run is never looked up.
    expect(db.appRunFilters).not.toContainEqual(["id", "run-1"])
    expect(db.executionSelects.every((c) => c.includes("trigger_type"))).toBe(true)
  })

  it("the same stamps on the platform's own row still read", async () => {
    db.execution = { ...db.execution!, trigger_type: "mcp", trigger_data: { continueFromFailed: forged.continueFromFailed } }
    expect((await load())!.continueFromFailed).toEqual(forged.continueFromFailed)
    db.execution = { ...db.execution!, trigger_type: "app_run", trigger_data: { appRun: forged.appRun } }
    db.appRunById = { app_id: "app-1", input_values: null }
    expect((await load())!.appVersionId).toBe("app-1")
  })
})
