/**
 * The loader reads a node scope — a run's `nodeSelection`, or the `scope` on a
 * continue-from-failed stamp — only from a run a stamp-writing lane started
 * (`trigger_type` `manual` / `mcp` / `app_run`, lib/server-started-runs.ts
 * `serverTriggerData`). A webhook's `trigger_data` is the body its public URL
 * was sent, a schedule's its trigger's payload: a scope forged there would
 * narrow a later continue-from-failed of the run, or end it as "done" while
 * the node that failed never ran.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({ execution: null as Record<string, unknown> | null }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const self = {
          eq: () => self,
          maybeSingle: async () => ({ data: table === "workflow_executions" ? db.execution : null, error: null }),
        }
        return self
      },
    }),
  },
}))
vi.mock("@/lib/canvas-result-ids.js", () => ({
  resolveRunStateStamps: async (states: unknown) => states,
}))

import { loadContinuationSource } from "../run-continuation.js"

const STAMP = { from: "exec-r", root: "exec-r", seededFrom: "exec-r", all: false, scope: ["cheap"] }
const executionRow = (triggerType: string, triggerData: unknown) => ({
  id: "exec-0",
  user_id: "u1",
  workflow_id: "wf-1",
  status: "failed",
  started_at: "2026-10-18T10:00:00.000Z",
  trigger_type: triggerType,
  trigger_data: triggerData,
  node_states: {},
  input_overrides: null,
})
const load = () => loadContinuationSource("exec-0", { withStates: true, isRenderNode: () => false })

beforeEach(() => {
  db.execution = null
})

describe("a node scope is read only from a run a stamp-writing lane started", () => {
  it("a webhook row carrying a forged nodeSelection reads as none", async () => {
    db.execution = executionRow("webhook", { nodeSelection: ["cheap"], order: 42 })
    expect((await load())!.nodeSelection).toBeNull()
  })

  it("a schedule row: the same", async () => {
    db.execution = executionRow("schedule", { nodeSelection: ["cheap"] })
    expect((await load())!.nodeSelection).toBeNull()
  })

  it("a webhook row carrying a stamp with a scope: the whole stamp reads as absent", async () => {
    db.execution = executionRow("webhook", { continueFromFailed: STAMP })
    const source = await load()
    expect(source!.continueFromFailed).toBeNull()
    expect(source!.nodeSelection).toBeNull()
  })

  it("a run the /run route started (manual, mcp) reads its selection and its stamp's scope", async () => {
    for (const lane of ["manual", "mcp"]) {
      db.execution = executionRow(lane, { nodeSelection: ["a", "b"] })
      expect((await load())!.nodeSelection).toEqual(["a", "b"])
      db.execution = executionRow(lane, { continueFromFailed: STAMP })
      expect((await load())!.continueFromFailed).toEqual(STAMP)
    }
  })
})

describe("a use-case inner run's link rides the continuation source, read on a use_case row alone", () => {
  // routes/use-case-continue.ts gives a continuation started from outside a run this link, so a
  // continued inner run is judged by the same outer run (lib/use-case-outer-run.ts).
  it("a use_case row carrying the link gives it", async () => {
    db.execution = { ...executionRow("use_case", { outerRun: { executionId: "exec-outer" } }), workflow_id: null }
    expect((await load())!.outerRun).toBe("exec-outer")
  })

  it("a row of another lane carrying the same key gives none", async () => {
    for (const lane of ["manual", "mcp", "app_run", "webhook"]) {
      db.execution = executionRow(lane, { outerRun: { executionId: "exec-outer" } })
      expect((await load())!.outerRun).toBeNull()
    }
  })

  it("a use_case row with no link (a standalone run, or one from before the link) gives none", async () => {
    db.execution = { ...executionRow("use_case", null), workflow_id: null }
    expect((await load())!.outerRun).toBeNull()
  })
})
