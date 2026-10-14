/**
 * `executeInlineGraph`: the hidden execution under a use-case node — a
 * `workflow_executions` row with no workflow, the built graph as its
 * snapshot, the wrapper job it reports to — enqueued exactly once, and
 * refused (nothing inserted) while the database lacks the snapshot columns.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph, toStoredInlineGraph } from "@nodaro/render-rules"

const m = vi.hoisted(() => ({
  insert: vi.fn(),
  add: vi.fn(),
  absent: false,
  writes: [] as Array<[string, Record<string, unknown>]>,
}))
vi.mock("../../lib/execution-writes.js", () => ({
  updateExecutionWithRetry: async (id: string, updates: Record<string, unknown>) => {
    m.writes.push([id, updates])
    return { cancelledRace: false }
  },
}))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../lib/idempotent-insert.js", () => ({ insertWithIdempotencyKey: m.insert }))
vi.mock("../../lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: m.add } }))
vi.mock("../../lib/execution-inline-graph.js", async (orig) => ({
  ...(await orig<typeof import("../../lib/execution-inline-graph.js")>()),
  inlineGraphColumnAbsent: () => m.absent,
}))

import { executeInlineGraph, InlineGraphUnavailableError } from "../use-case-execution.js"
import { resetInlineGraphColumnForTests, withInlineGraphColumns } from "../../lib/execution-inline-graph.js"

/** The guard's own memory (its `inlineGraphColumnAbsent` is stubbed above): absent ⇔ it stops naming the columns. */
const guardRemembersAbsent = () => withInlineGraphColumns("id") === "id"

const graph = toStoredInlineGraph(
  buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video" } }),
  TIGHTEN_EPISODE_DEFAULTS,
)

beforeEach(() => {
  m.insert.mockReset().mockResolvedValue({ row: { id: "exec-1" }, created: true })
  m.add.mockReset().mockResolvedValue(undefined)
  m.absent = false
  m.writes.length = 0
  resetInlineGraphColumnForTests()
})

describe("executeInlineGraph", () => {
  it("inserts an inline execution (no workflow, the snapshot, the wrapper, the use_case lane) and enqueues it", async () => {
    const out = await executeInlineGraph({ userId: "u1", graph, wrapperJobId: "job-1", reviewerPresent: false, webFreeMode: false, appRun: false, idempotencyKey: "uc-job-1" })
    expect(out).toEqual({ executionId: "exec-1", deduped: false })
    const [table, row, key] = m.insert.mock.calls[0]!
    expect(table).toBe("workflow_executions")
    expect(row).toMatchObject({ workflow_id: null, user_id: "u1", status: "pending", trigger_type: "use_case", inline_graph: graph, wrapper_job_id: "job-1" })
    expect(row).not.toHaveProperty("is_component_execution")
    expect(key).toBe("uc-job-1")
    const [name, data, opts] = m.add.mock.calls[0]!
    expect(name).toBe("workflow-execution")
    expect(data).toMatchObject({
      executionId: "exec-1",
      workflowId: null,
      userId: "u1",
      triggerType: "use_case",
      inlineGraph: true,
      wrapperJobId: "job-1",
      reviewerPresent: false,
      webFreeMode: false,
      componentDepth: 0,
      billingContext: { payer: "user", userId: "u1" },
    })
    expect(data).not.toHaveProperty("isComponentExecution")
    expect(data).not.toHaveProperty("appVersionId")
    expect(opts).toEqual({ jobId: "exec-1" })
  })

  it("carries the run's spend surface and app-run flag, so its steps reserve under the rules the fee did", async () => {
    await executeInlineGraph({ userId: "u1", graph, wrapperJobId: "job-1", reviewerPresent: false, webFreeMode: true, appRun: true })
    expect(m.add.mock.calls[0]![1]).toMatchObject({ webFreeMode: true, appRun: true })
    expect(m.add.mock.calls[0]![1]).not.toHaveProperty("appVersionId")
    m.add.mockClear()
    await executeInlineGraph({ userId: "u1", graph, wrapperJobId: "job-1", reviewerPresent: false, webFreeMode: false, appRun: false })
    expect(m.add.mock.calls[0]![1]).toMatchObject({ webFreeMode: false })
    expect(m.add.mock.calls[0]![1]).not.toHaveProperty("appRun")
  })

  it("a workspace payer's pair rides the row", async () => {
    await executeInlineGraph({
      userId: "u1",
      graph,
      wrapperJobId: "job-1",
      reviewerPresent: false, webFreeMode: false, appRun: false,
      billingContext: { payer: "workspace", userId: "u1", workspaceId: "ws-1", orgId: "org-1" } as never,
    })
    expect(m.insert.mock.calls[0]![1]).toMatchObject({ workspace_id: "ws-1", org_id: "org-1" })
  })

  it("a duplicate (same idempotency key) enqueues nothing", async () => {
    m.insert.mockResolvedValue({ row: { id: "exec-0" }, created: false })
    expect(
      await executeInlineGraph({ userId: "u1", graph, wrapperJobId: "job-1", reviewerPresent: false, webFreeMode: false, appRun: false, idempotencyKey: "k-123456" }),
    ).toEqual({ executionId: "exec-0", deduped: true })
    expect(m.add).not.toHaveBeenCalled()
  })

  it("refuses while the snapshot columns are known to be missing, inserting nothing", async () => {
    m.absent = true
    await expect(executeInlineGraph({ userId: "u1", graph, wrapperJobId: "job-1", reviewerPresent: false, webFreeMode: false, appRun: false })).rejects.toBeInstanceOf(
      InlineGraphUnavailableError,
    )
    expect(m.insert).not.toHaveBeenCalled()
  })

  it("a missing-column insert error (as the idempotent insert throws it) becomes the same refusal, and is remembered", async () => {
    // The real helper wraps the PostgREST error: message prefixed, the error itself as `cause`.
    m.insert.mockRejectedValue(
      new Error("idempotent insert failed (workflow_executions): Could not find the 'inline_graph' column of 'workflow_executions' in the schema cache", {
        cause: { code: "PGRST204", message: "Could not find the 'inline_graph' column of 'workflow_executions' in the schema cache" },
      }),
    )
    await expect(executeInlineGraph({ userId: "u1", graph, wrapperJobId: "job-1", reviewerPresent: false, webFreeMode: false, appRun: false })).rejects.toBeInstanceOf(
      InlineGraphUnavailableError,
    )
    expect(guardRemembersAbsent()).toBe(true)
    expect(m.add).not.toHaveBeenCalled()
  })

  it("any other insert error is rethrown as it is", async () => {
    const boom = new Error("idempotent insert failed (workflow_executions): boom", { cause: { code: "23514", message: "boom" } })
    m.insert.mockRejectedValue(boom)
    await expect(executeInlineGraph({ userId: "u1", graph, wrapperJobId: "job-1", reviewerPresent: false, webFreeMode: false, appRun: false })).rejects.toBe(boom)
    expect(guardRemembersAbsent()).toBe(false)
  })

  it("carries a continuation: source, subset, mode and overrides", async () => {
    await executeInlineGraph({
      userId: "u1",
      graph,
      wrapperJobId: "job-2",
      reviewerPresent: false, webFreeMode: false, appRun: false,
      continueFromExecutionId: "exec-0",
      continueMode: "from-failed",
      nodeIds: ["uc-render"],
      inputOverrides: { "uc-render": { quality: "final" } },
    })
    expect(m.add.mock.calls[0]![1]).toMatchObject({
      continueFromExecutionId: "exec-0",
      continueMode: "from-failed",
      nodeIds: ["uc-render"],
      inputOverrides: { "uc-render": { quality: "final" } },
    })
  })

  it("an enqueue that fails leaves no pending run behind: the execution is failed, the error rethrown", async () => {
    m.add.mockRejectedValue(new Error("redis down"))
    await expect(executeInlineGraph({ userId: "u1", graph, wrapperJobId: "job-1", reviewerPresent: false, webFreeMode: false, appRun: false })).rejects.toThrow("redis down")
    expect(m.writes).toEqual([["exec-1", expect.objectContaining({ status: "failed", completed_at: expect.any(String) })]])
  })

  it("a run that was enqueued is never written to", async () => {
    await executeInlineGraph({ userId: "u1", graph, wrapperJobId: "job-1", reviewerPresent: false, webFreeMode: false, appRun: false })
    expect(m.writes).toEqual([])
  })
})
