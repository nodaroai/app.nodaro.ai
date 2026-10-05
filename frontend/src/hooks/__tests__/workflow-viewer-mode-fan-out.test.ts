import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * A `view` answer that reaches a canvas in the middle of a per-node Run over a
 * list (T97, the controller ruling of 2026-10-04: a downgrade must not drop the
 * results of runs already paid for).
 *
 * Its own file because it drives the real thing end to end: the real store,
 * the real `applyWorkflowAccess`, the real fan-out (`executeNodeForList`) and
 * the real poll and abandon guard (`pollJobWithNodeUpdate`). Only the network
 * is mocked, and `executeNode` is reduced to the `pollJobWithNodeUpdate` call
 * that an image generation ends in.
 *
 * The iterations of a fan-out share their node's one `currentJobId` slot: each
 * writes its own job into it, and each completion clears it while the others
 * are still polling. A freeze that waited on `currentJobId` alone landed right
 * after the first result, and the rest of the batch, its own terminal write
 * included, went into an `updateNodeData` that does nothing on a read-only
 * canvas.
 */

const jobs: Record<string, { status: string; output_data?: Record<string, unknown> }> = {}

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getWorkflowAccess: vi.fn(),
  getJobStatusLean: vi.fn(async (jobId: string) => ({ id: jobId, ...jobs[jobId] })),
  getExecutionEstimate: vi.fn(async () => ({ estimatedMs: 0 })),
  cancelJob: vi.fn(async () => ({})),
}))

/** The ids of the jobs the run created, in order: each one is paid for. */
const created: string[] = []

vi.mock("@/components/editor/workflow-editor/execute-node", async () => {
  const { pollJobWithNodeUpdate } = await import("@/components/editor/workflow-editor/poll-job")
  return {
    executeNode: vi.fn((node: { id: string }, ctx: unknown, _prompt?: string, _mediaUrl?: string, i?: number) =>
      pollJobWithNodeUpdate(
        node.id,
        async () => {
          const jobId = `job-${i}`
          created.push(jobId)
          return { jobId }
        },
        "generatedImageUrl",
        "Image generation",
        ctx as never,
      ),
    ),
  }
})

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyWorkflowAccess } from "@/hooks/workflow-access-mode"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { getWorkflowAccess } from "@/lib/api"
import type { WorkflowAccessInfo } from "@/lib/api"
import { executeNodeForList } from "@/components/editor/workflow-editor/list-execution"
import type { ExecutionContext } from "@/components/editor/workflow-editor/types"
import type { WorkflowNode } from "@/types/nodes"

const WF = "wf-1"
const POLL_MS = 2000

const NODE = {
  id: "n1",
  type: "generate-image",
  position: { x: 0, y: 0 },
  data: { label: "n1", generatedResults: [{ url: "https://cdn/old.png", timestamp: "t", jobId: "old" }] },
} as unknown as WorkflowNode

function viewAnswer(): WorkflowAccessInfo {
  return {
    access: "view",
    workspaceId: null,
    visibility: "private",
    canChangeVisibility: false,
    canShare: false,
    canRun: false,
  }
}

function ctx(): ExecutionContext {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (interval) => interval,
    untrackInterval: (interval) => clearInterval(interval),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    setInsufficientCreditsData: vi.fn(),
  }
}

const data = () => useWorkflowStore.getState().nodes.find((n) => n.id === NODE.id)!.data as Record<string, unknown>
const urls = (results: unknown) => (results as Array<{ url: string }>).map((r) => r.url)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  created.length = 0
  for (const id of Object.keys(jobs)) delete jobs[id]
  useWorkflowStore.getState().loadWorkflow(WF, "W", [NODE], [])
  useWorkflowStore.setState({ loadedAccess: { workflowId: WF, access: "edit" } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("a downgrade in the middle of a Run over a list (T97)", () => {
  it("stops the saves at once, lands every iteration's result, and only then turns the canvas read-only", async () => {
    jobs["job-0"] = { status: "processing" }
    jobs["job-1"] = { status: "processing" }
    const run = executeNodeForList(NODE, ["a", "b"], ctx())
    await vi.advanceTimersByTimeAsync(0)
    // Both iterations' jobs exist: both are paid for.
    expect(created).toEqual(["job-0", "job-1"])
    expect(data().__listRunning).toBe(true)

    vi.mocked(getWorkflowAccess).mockResolvedValue({ data: viewAnswer() })
    await applyWorkflowAccess(WF)
    expect(useWorkflowStore.getState().loadedAccess).toEqual({ workflowId: WF, access: "view" })
    expect(isSaveRefused(useWorkflowStore.getState())).toBe(true)
    expect(useWorkflowStore.getState().isReadOnly).toBe(false)

    // The first result empties the shared slot while the second job still polls.
    jobs["job-0"] = { status: "completed", output_data: { imageUrl: "https://cdn/0.png" } }
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(urls(data().generatedResults)).toEqual(["https://cdn/0.png"])
    expect(data().currentJobId).toBeUndefined()
    expect(useWorkflowStore.getState().isReadOnly).toBe(false)

    jobs["job-1"] = { status: "completed", output_data: { imageUrl: "https://cdn/1.png" } }
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await run

    // The batch's terminal write landed, and the history from before the run
    // came back with it.
    const final = data()
    expect(final.__listResults).toEqual(["https://cdn/0.png", "https://cdn/1.png"])
    expect(urls(final.generatedResults)).toEqual(["https://cdn/0.png", "https://cdn/1.png", "https://cdn/old.png"])
    expect(final.__listRunning).toBe(false)
    expect(final.executionStatus).toBe("completed")
    const s = useWorkflowStore.getState()
    expect(s.isReadOnly).toBe(true)
    expect(s.readOnlyReason).toBe("This workflow is read-only for you.")
  })
})
