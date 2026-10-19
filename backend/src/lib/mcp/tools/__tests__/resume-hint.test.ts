/**
 * The resume hint on a failed saved-workflow run points where a
 * continue-from-failed would go — the run route's own lineage rule
 * (`continuationPointOf`): this run (built on a later continuation that
 * completed part of what it left, or not), a later continuation that failed,
 * or — when a later continuation completed all this run left — the run holding
 * its results, never a continuation that would run and bill that work again;
 * and when the later continuation stopped at a Preview review, its Render final.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  /** The row the lineage read answers: the lineage's newest generation. */
  row: null as unknown,
  error: null as { message: string } | null,
  reads: 0,
}))

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: () => {
      db.reads += 1
      const q: Record<string, unknown> = {}
      const lanes: unknown[][] = []
      for (const m of ["select", "eq", "in", "not", "order", "limit"])
        q[m] = (...a: unknown[]) => {
          if (m === "in" && a[0] === "trigger_type") lanes.push(a[1] as unknown[])
          return q
        }
      // The lane filter is honoured, as the database would: a row of another lane is not found.
      const laneOk = () => lanes.every((vals) => vals.includes((db.row as { trigger_type?: unknown } | null)?.trigger_type))
      q.maybeSingle = async () => ({ data: db.error || !laneOk() ? null : db.row, error: db.error })
      return q
    },
  },
}))
const access = vi.hoisted(() => ({ ok: true, graph: { nodes: [] as unknown[], edges: [] as unknown[] } }))
vi.mock("../_workflow-access.js", () => ({ loadMcpWorkflow: vi.fn(async () => ({ ok: access.ok, row: { id: "wf-1", ...access.graph } })) }))
const held = vi.hoisted(() => ({ next: null as unknown, calls: [] as unknown[] }))
vi.mock("../../../continuation-held-final.js", () => ({
  heldFinalRun: vi.fn(async (input: unknown) => (held.calls.push(input), held.next)),
}))

import { previewPendingHint, resumeFailedRunHint } from "../_resume-hint.js"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"

const session = newSession({ userId: "u1", scopes: ["assets:read"] as Scope[], clientName: "Claude" })
const RUN = "exec-a"
const LATER = "exec-c"
const failedRun = (over: Record<string, unknown> = {}) => ({
  id: RUN,
  status: "failed",
  workflow_id: "wf-1",
  trigger_type: "mcp",
  started_at: "2026-10-17T10:00:00Z",
  ...over,
})

beforeEach(() => {
  db.row = null
  db.error = null
  db.reads = 0
  access.ok = true
  access.graph = { nodes: [], edges: [] }
  held.next = null
  held.calls.length = 0
})

describe("resumeFailedRunHint and the run's lineage", () => {
  it("no later continuation: continue this run", async () => {
    const hint = await resumeFailedRunHint(failedRun(), session)
    expect(hint).toContain(`run_workflow({ workflow_id: "wf-1", continue_from_execution_id: "${RUN}", from_failed: true })`)
  })

  it("a later continuation COMPLETED all this run left: no resume — the work is done, its results named", async () => {
    db.row = { id: LATER, status: "completed", trigger_type: "mcp", trigger_data: { continueFromFailed: { from: RUN, root: RUN, all: true } } }
    const hint = await resumeFailedRunHint(failedRun(), session)
    expect(hint).not.toContain("run_workflow")
    expect(hint).not.toContain("from_failed")
    expect(hint).toContain(`get_app_run({ execution_id: "${LATER}" })`)
    expect(hint).toMatch(/already done/)
  })

  it("a later continuation failed: continue that one, not this run", async () => {
    db.row = { id: LATER, status: "failed", trigger_type: "mcp", trigger_data: { continueFromFailed: { from: RUN, root: RUN, all: true } } }
    const hint = await resumeFailedRunHint(failedRun(), session)
    expect(hint).toContain(`continue_from_execution_id: "${LATER}", from_failed: true`)
    expect(hint).not.toContain(`continue_from_execution_id: "${RUN}"`)
  })

  it("this run is the lineage's newest failure: continue it", async () => {
    db.row = { id: RUN, status: "failed", trigger_type: "mcp", trigger_data: { continueFromFailed: { from: "exec-0", root: "exec-0", all: true } } }
    expect(await resumeFailedRunHint(failedRun(), session)).toContain(`continue_from_execution_id: "${RUN}"`)
  })

  it("a later continuation completed only PART of what this run left: this run is still named (the route builds on that one)", async () => {
    db.row = { id: LATER, status: "completed", trigger_type: "mcp", trigger_data: { continueFromFailed: { from: RUN, root: RUN, all: false } } }
    const hint = await resumeFailedRunHint(failedRun(), session)
    expect(hint).toContain(`continue_from_execution_id: "${RUN}", from_failed: true`)
    expect(hint).not.toContain(LATER)
  })

  it("a later continuation stopped at a Preview review: its Render final, never a continuation that stops again", async () => {
    db.row = { id: LATER, status: "completed", trigger_type: "mcp", trigger_data: { continueFromFailed: { from: RUN, root: RUN, all: false, previewRenders: ["cut"] } } }
    const hint = await resumeFailedRunHint(failedRun(), session)
    expect(hint).toContain(`render_final({ workflow_id: "wf-1", render_node_id: "cut", execution_id: "${LATER}" })`)
    expect(hint).not.toContain("from_failed")
    expect(hint).not.toContain("run_workflow")
  })

  it("two held renders: both named, and the one run the route works out (render_final takes one)", async () => {
    db.row = { id: LATER, status: "completed", trigger_type: "mcp", trigger_data: { continueFromFailed: { from: RUN, root: RUN, all: false, previewRenders: ["cut1", "cut2"] } } }
    access.graph = { nodes: [{ id: "cut1", type: "apply-edl" }], edges: [] }
    const next = { continueFromExecutionId: LATER, nodeIds: ["cut1", "cut2", "mix"], inputOverrides: { cut1: { quality: "final" }, cut2: { quality: "final" } } }
    held.next = next
    const hint = await resumeFailedRunHint(failedRun(), session)
    expect(held.calls[0]).toMatchObject({ at: LATER, renderNodeIds: ["cut1", "cut2"], reviewNodeIds: [], nodes: access.graph.nodes, userId: "u1" })
    expect(hint).toContain('the renders "cut1", "cut2"')
    expect(hint).toContain(
      `run_workflow({ workflow_id: "wf-1", continue_from_execution_id: "${LATER}", node_ids: ${JSON.stringify(next.nodeIds)}, ` +
        `inputs: ${JSON.stringify(next.inputOverrides)} })`,
    )
    expect(hint).not.toContain("POST /v1/workflows/")
    expect(hint).not.toContain("render_final({")
    expect(hint).not.toContain("from_failed")
  })

  it("a held Tighten Episode review: the node named, and the run continuing its Preview's run", async () => {
    db.row = { id: LATER, status: "completed", trigger_type: "mcp", trigger_data: { continueFromFailed: { from: RUN, root: RUN, all: false, reviewHolds: ["t"] } } }
    held.next = { continueFromExecutionId: LATER, nodeIds: ["t", "cap"], inputOverrides: { t: { useCaseContinue: { mode: "render-final", jobId: "w" } } } }
    const hint = await resumeFailedRunHint(failedRun(), session)
    expect(hint).toContain('the review of "t"')
    expect(hint).toContain('"useCaseContinue"')
    expect(hint).toContain("continue_use_case on its own first")
    expect(hint).not.toContain("render_final({")
  })

  it("a held review names every held use-case node, and never says what kind of result it renders (any review-on type holds)", () => {
    const next = { continueFromExecutionId: LATER, nodeIds: ["n1", "n2", "cap"], inputOverrides: {} }
    for (const renders of [[], ["cut"]])
      for (const run of [null, next]) {
        const hint = previewPendingHint("wf-1", LATER, renders, ["n1", "n2"], run)
        expect(hint).toContain('the review of "n1", "n2"')
        expect(hint).toContain('For "n1", "n2" that run calls its continue route')
        expect(hint).toContain("renders its final result")
        expect(hint).not.toMatch(/episode/i)
      }
  })

  it("a held review whose run cannot be named: still no continuation, and why", async () => {
    db.row = { id: LATER, status: "completed", trigger_type: "mcp", trigger_data: { continueFromFailed: { from: RUN, root: RUN, all: false, reviewHolds: ["t"] } } }
    const hint = await resumeFailedRunHint(failedRun(), session)
    expect(hint).toContain(`one run continuing ${LATER}`)
    expect(hint).not.toContain("from_failed")
  })

  it("a continuation that never started: the run it continued", async () => {
    const hint = await resumeFailedRunHint(
      failedRun({ id: "exec-b", started_at: null, trigger_data: { continueFromFailed: { from: RUN, root: RUN, all: true } } }),
      session,
    )
    expect(hint).toContain(`continue_from_execution_id: "${RUN}", from_failed: true`)
    expect(hint).toMatch(/^This run never started, so it holds nothing/)
    expect(hint).not.toMatch(/later run/i)
  })

  it("a webhook run whose body posted a lineage or app-run stamp: hinted as the run it is, never as done or as an app run", async () => {
    const forged = { continueFromFailed: { from: "exec-0", root: "exec-0", all: true }, appRun: { appRunId: "run-x" } }
    // A forged "later continuation that completed all" of that lineage, stored by a webhook too.
    db.row = { id: LATER, status: "completed", trigger_type: "webhook", trigger_data: { continueFromFailed: { from: RUN, root: RUN, all: true } } }
    const hint = await resumeFailedRunHint(failedRun({ trigger_type: "webhook", trigger_data: forged }), session)
    expect(hint).toContain(`run_workflow({ workflow_id: "wf-1", continue_from_execution_id: "${RUN}", from_failed: true })`)
    expect(hint).not.toMatch(/already done/i)
  })

  it("a lineage read error: no hint (the read it rides on never fails for it)", async () => {
    db.error = { message: "down" }
    expect(await resumeFailedRunHint(failedRun(), session)).toBeNull()
  })

  it("a workflow run_workflow does not reach: no hint, and no lineage read", async () => {
    access.ok = false
    expect(await resumeFailedRunHint(failedRun(), session)).toBeNull()
    expect(db.reads).toBe(0)
  })
})
