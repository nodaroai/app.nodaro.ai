import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockNodes: Array<{ id: string; type: string; data: Record<string, unknown> }> = []
const mockUpdateNodeData = vi.fn((id: string, patch: Record<string, unknown>) => {
  const node = mockNodes.find((n) => n.id === id)
  if (node) node.data = { ...node.data, ...patch }
})
const mockGetJobStatusLean = vi.fn()
const toastInfo = vi.fn()
const toastSuccess = vi.fn()
const toastWarning = vi.fn()
const toastError = vi.fn()

vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => toastInfo(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ updateNodeData: mockUpdateNodeData, nodes: mockNodes, edges: [] }),
  },
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    getJobStatusLean: (...args: unknown[]) => mockGetJobStatusLean(...args),
  }
})

import { runScene3DJob } from "../scene3d-execution"
import { makePlan, REV_A, REV_B } from "@/lib/scene3d/__tests__/fixture"
import type { ExecutionContext } from "../types"

const ctx = {
  userId: "u1",
  projectId: undefined,
  trackInterval: (i: ReturnType<typeof setInterval>) => i,
  untrackInterval: (i: ReturnType<typeof setInterval>) => clearInterval(i),
  save: async () => {},
  setIsRunning: () => {},
  isWorkflowStale: () => false,
  isStorageError: () => false,
  setShowStorageExceeded: () => {},
  setStorageExceededData: () => {},
  setShowInsufficientCredits: () => {},
  setInsufficientCreditsData: () => {},
} as unknown as ExecutionContext

function seed(data: Record<string, unknown>) {
  mockNodes.length = 0
  mockNodes.push({ id: "n1", type: "edit-3d-scene", data })
}

/**
 * Drive the 2s poll interval until the promise settles. Handlers are attached
 * SYNCHRONOUSLY (before any timer advances) so a rejection that happens inside
 * `advanceTimersByTimeAsync` is never briefly unhandled.
 */
function drain<T>(promise: Promise<T>): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown } | undefined
  promise.then(
    (value) => { outcome = { ok: true, value } },
    (error) => { outcome = { ok: false, error } },
  )
  return (async () => {
    for (let i = 0; i < 5 && outcome === undefined; i++) {
      await vi.advanceTimersByTimeAsync(2000)
    }
    if (outcome === undefined) throw new Error("job never settled")
    if (!outcome.ok) throw outcome.error
    return outcome.value
  })()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("runScene3DJob", () => {
  it("keeps the current scene on screen while the job runs", async () => {
    seed({ scenePlan: makePlan() })
    mockGetJobStatusLean.mockResolvedValue({ id: "j1", status: "processing", progress: 40 })
    const promise = runScene3DJob({
      nodeId: "n1",
      source: "edit",
      label: "Scene edit",
      ctx: { ...ctx, isWorkflowStale: () => false } as ExecutionContext,
      start: async () => ({ jobId: "j1" }),
    })
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(2000)
    // The run-start patch must NOT have cleared the plan.
    const startPatch = mockUpdateNodeData.mock.calls[0][1]
    expect("scenePlan" in startPatch).toBe(false)
    expect(startPatch.sceneJobBaseRevisionId).toBe(REV_A)
    expect(mockNodes[0].data.scenePlan).toBeTruthy()
  })

  it("adopts the produced revision when nothing changed underneath it", async () => {
    seed({ scenePlan: makePlan() })
    const incoming = makePlan({ revisionId: REV_B, parentRevisionId: REV_A })
    mockGetJobStatusLean.mockResolvedValue({
      id: "j1",
      status: "completed",
      output_data: { scenePlan: incoming, changeSummary: "raised the camera" },
    })
    const result = await drain(
      runScene3DJob({ nodeId: "n1", source: "edit", label: "Scene edit", ctx, start: async () => ({ jobId: "j1" }) }),
    )
    expect(result).toBe("plan-ready")
    expect(mockNodes[0].data.scenePlan).toEqual(incoming)
    expect(mockNodes[0].data.expectedRevisionId).toBe(REV_B)
    expect(mockNodes[0].data.changeSummary).toBe("raised the camera")
    expect(mockNodes[0].data.sceneJobBaseRevisionId).toBeUndefined()
    expect(toastSuccess).toHaveBeenCalled()
  })

  it("PARKS the produced revision when the user edited the scene mid-flight", async () => {
    seed({ scenePlan: makePlan() })
    const manual = makePlan({ revisionId: "33333333-3333-4333-8333-333333333333" })
    const incoming = makePlan({ revisionId: REV_B })
    let ticks = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      ticks += 1
      if (ticks === 1) {
        // The user nudges an object while the job is still running.
        mockUpdateNodeData("n1", { scenePlan: manual })
        return { id: "j1", status: "processing", progress: 10 }
      }
      return { id: "j1", status: "completed", output_data: { scenePlan: incoming } }
    })
    await drain(
      runScene3DJob({ nodeId: "n1", source: "edit", label: "Scene edit", ctx, start: async () => ({ jobId: "j1" }) }),
    )
    expect(mockNodes[0].data.scenePlan).toEqual(manual)
    expect(mockNodes[0].data.scenePendingPlan).toEqual(incoming)
    // The paid-for revision is still in history.
    const history = mockNodes[0].data.sceneHistory as Array<{ revisionId: string }>
    expect(history.map((h) => h.revisionId)).toContain(REV_B)
    expect(toastWarning).toHaveBeenCalled()
  })

  it("fails the node when a completed job carries no scene", async () => {
    seed({ scenePlan: undefined })
    mockGetJobStatusLean.mockResolvedValue({ id: "j1", status: "completed", output_data: {} })
    await expect(
      drain(
        runScene3DJob({ nodeId: "n1", source: "generate", label: "Scene generation", ctx, start: async () => ({ jobId: "j1" }) }),
      ),
    ).rejects.toThrow(/no scene/i)
    expect(mockNodes[0].data.executionStatus).toBe("failed")
  })

  it("surfaces a failed job's message and clears the in-flight bookkeeping", async () => {
    seed({ scenePlan: makePlan() })
    mockGetJobStatusLean.mockResolvedValue({ id: "j1", status: "failed", error_message: "model refused" })
    await expect(
      drain(
        runScene3DJob({ nodeId: "n1", source: "edit", label: "Scene edit", ctx, start: async () => ({ jobId: "j1" }) }),
      ),
    ).rejects.toThrow("model refused")
    expect(mockNodes[0].data.errorMessage).toBe("model refused")
    expect(mockNodes[0].data.sceneJobBaseRevisionId).toBeUndefined()
    // The scene the user was working on is still there.
    expect(mockNodes[0].data.scenePlan).toBeTruthy()
  })

  it("fails the node when the route call itself is rejected", async () => {
    seed({ scenePlan: undefined })
    await expect(
      runScene3DJob({
        nodeId: "n1",
        source: "generate",
        label: "Scene generation",
        ctx,
        start: async () => {
          throw new Error("insufficient credits")
        },
      }),
    ).rejects.toThrow("insufficient credits")
    expect(mockNodes[0].data.executionStatus).toBe("failed")
    expect(mockNodes[0].data.errorMessage).toBe("insufficient credits")
  })
})

describe("runScene3DJob — terminal states and concurrent runs", () => {
  const REV_C = "55555555-5555-4555-8555-555555555555"

  it("treats CANCELLED as terminal: stops polling and leaves the node idle", async () => {
    // Without this branch the loop polled a dead job for the life of the tab,
    // and the node sat on a spinner that could never resolve.
    seed({ scenePlan: makePlan() })
    mockGetJobStatusLean.mockResolvedValue({ id: "j1", status: "cancelled" })
    const result = await drain(
      runScene3DJob({ nodeId: "n1", source: "edit", label: "Scene edit", ctx, start: async () => ({ jobId: "j1" }) }),
    )
    expect(result).toBe("")
    expect(mockNodes[0].data.executionStatus).toBe("idle")
    expect(mockNodes[0].data.currentJobId).toBeUndefined()
    expect(mockNodes[0].data.sceneJobBaseRevisionId).toBeUndefined()
    // The scene itself survives a cancellation.
    expect(mockNodes[0].data.scenePlan).toBeTruthy()
    const callsAfter = mockGetJobStatusLean.mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    expect(mockGetJobStatusLean.mock.calls.length).toBe(callsAfter)
  })

  it("uses the CAPTURED base, not the node field a second run overwrote", async () => {
    // Job A launches on REV_A. Job B launches (and rewrites
    // `sceneJobBaseRevisionId` to its own base) while A is in flight. When A
    // lands, reading the node field would say "base === current" and adopt —
    // silently replacing the newer run's scene. The captured constant says
    // otherwise.
    seed({ scenePlan: makePlan() })
    const incoming = makePlan({ revisionId: REV_C })
    let ticks = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      ticks += 1
      if (ticks === 1) return { id: "j1", status: "processing" }
      // Job B's start patch landed between the ticks.
      mockNodes[0].data.scenePlan = makePlan({ revisionId: REV_B })
      mockNodes[0].data.sceneJobBaseRevisionId = REV_B
      return { id: "j1", status: "completed", output_data: { scenePlan: incoming } }
    })
    await drain(
      runScene3DJob({ nodeId: "n1", source: "edit", label: "Scene edit", ctx, start: async () => ({ jobId: "j1" }) }),
    )
    expect(mockNodes[0].data.scenePendingPlan).toEqual(incoming)
    expect((mockNodes[0].data.scenePlan as Record<string, unknown>).revisionId).toBe(REV_B)
    expect(toastWarning).toHaveBeenCalled()
  })

  it("keeps an older run's paid result in HISTORY without touching the newer run's state", async () => {
    seed({ scenePlan: makePlan() })
    const incoming = makePlan({ revisionId: REV_C })
    let ticks = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      ticks += 1
      if (ticks === 1) return { id: "j1", status: "processing" }
      // The node has moved on to run j2 — `shouldAbandonNode` is true for j1.
      mockNodes[0].data.currentJobId = "j2"
      mockNodes[0].data.executionStatus = "running"
      mockNodes[0].data.sceneJobBaseRevisionId = REV_B
      return { id: "j1", status: "completed", output_data: { scenePlan: incoming } }
    })
    const result = await drain(
      runScene3DJob({ nodeId: "n1", source: "generate", label: "Scene generation", ctx, start: async () => ({ jobId: "j1" }) }),
    )
    expect(result).toBe("")
    // Kept — it was billed.
    const history = mockNodes[0].data.sceneHistory as Array<{ revisionId: string }>
    expect(history.map((e) => e.revisionId)).toEqual([REV_C])
    // …and NONE of the live run's bookkeeping was disturbed.
    expect(mockNodes[0].data.currentJobId).toBe("j2")
    expect(mockNodes[0].data.executionStatus).toBe("running")
    expect(mockNodes[0].data.sceneJobBaseRevisionId).toBe(REV_B)
    expect(mockNodes[0].data.scenePendingPlan).toBeUndefined()
    expect((mockNodes[0].data.scenePlan as Record<string, unknown>).revisionId).toBe(REV_A)
  })

  it("does not fail the node when an OLDER run fails after a newer one started", async () => {
    seed({ scenePlan: makePlan() })
    let ticks = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      ticks += 1
      if (ticks === 1) return { id: "j1", status: "processing" }
      mockNodes[0].data.currentJobId = "j2"
      mockNodes[0].data.executionStatus = "running"
      return { id: "j1", status: "failed", error_message: "upstream 500" }
    })
    const result = await drain(
      runScene3DJob({ nodeId: "n1", source: "edit", label: "Scene edit", ctx, start: async () => ({ jobId: "j1" }) }),
    )
    expect(result).toBe("")
    expect(mockNodes[0].data.executionStatus).toBe("running")
    expect(mockNodes[0].data.errorMessage).toBeUndefined()
  })

  it("stores the run's authoring context on the revision it produced", async () => {
    seed({ scenePlan: makePlan() })
    const incoming = makePlan({ revisionId: REV_B, parentRevisionId: REV_A })
    mockGetJobStatusLean.mockResolvedValue({
      id: "j1",
      status: "completed",
      output_data: { scenePlan: incoming },
    })
    await drain(
      runScene3DJob({
        nodeId: "n1",
        source: "edit",
        label: "Scene edit",
        ctx,
        start: async () => ({ jobId: "j1" }),
        context: { prompt: "move the camera lower", llmModel: "gpt-5", baseRevisionId: REV_A },
      }),
    )
    const history = mockNodes[0].data.sceneHistory as Array<{ revisionId: string; context?: Record<string, unknown> }>
    expect(history[history.length - 1].context).toEqual({
      prompt: "move the camera lower",
      llmModel: "gpt-5",
      baseRevisionId: REV_A,
    })
  })

  it("PARKS a result for a job that started on an EMPTY node after a scene arrived", async () => {
    seed({})
    const incoming = makePlan({ revisionId: REV_C })
    let ticks = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      ticks += 1
      if (ticks === 1) return { id: "j1", status: "processing" }
      // A restore (or the upstream edit node) put a scene on the node.
      mockNodes[0].data.scenePlan = makePlan({ revisionId: REV_B })
      return { id: "j1", status: "completed", output_data: { scenePlan: incoming } }
    })
    await drain(
      runScene3DJob({ nodeId: "n1", source: "generate", label: "Scene generation", ctx, start: async () => ({ jobId: "j1" }) }),
    )
    expect((mockNodes[0].data.scenePlan as Record<string, unknown>).revisionId).toBe(REV_B)
    expect(mockNodes[0].data.scenePendingPlan).toEqual(incoming)
  })
})

// ---------------------------------------------------------------------------
// extraCompletionPatch — the second half of a 3D Render Pro settlement
// ---------------------------------------------------------------------------

/**
 * 3D Render Pro settles a scene AND an MP4 through this same runner. The video
 * half rides `extraCompletionPatch`, and it is bound by the SAME rule as the
 * plan: adopt writes it, park does not. A parked revision's video belongs to
 * the older scene — putting it on the live node would leave the card showing a
 * video that does not match its composition, and would feed that stale MP4
 * downstream from the `video` handle.
 */
describe("runScene3DJob — extraCompletionPatch", () => {
  const LIVE_MP4 = "https://r2.example/renders/live.mp4"
  const NEW_MP4 = "https://r2.example/renders/new.mp4"

  it("applies the extra patch on ADOPT, with the settling job id and the LIVE node", async () => {
    seed({ scenePlan: makePlan(), generatedResults: [{ url: LIVE_MP4, timestamp: "t0", jobId: "j0" }] })
    const incoming = makePlan({ revisionId: REV_B, parentRevisionId: REV_A })
    const seen: Array<{ output: Record<string, unknown>; jobId: string; liveNode: Record<string, unknown> }> = []
    mockGetJobStatusLean.mockResolvedValue({
      id: "j1",
      status: "completed",
      output_data: { scenePlan: incoming, videoUrl: NEW_MP4 },
    })

    await drain(
      runScene3DJob({
        nodeId: "n1",
        source: "generate",
        label: "3D Render Pro",
        ctx,
        start: async () => ({ jobId: "j1" }),
        extraCompletionPatch: (output, completion) => {
          seen.push({ output, jobId: completion.jobId, liveNode: completion.liveNode })
          return { generatedVideoUrl: output.videoUrl }
        },
      }),
    )

    expect(seen).toHaveLength(1)
    // The job's own id is NOT in output_data — the runner is the only thing
    // that has it, which is why it is handed over explicitly.
    expect(seen[0].jobId).toBe("j1")
    expect(seen[0].output.videoUrl).toBe(NEW_MP4)
    expect(mockNodes[0].data.scenePlan).toEqual(incoming)
    expect(mockNodes[0].data.generatedVideoUrl).toBe(NEW_MP4)
  })

  it("hands the callback the node as of COMPLETION, not the snapshot taken at run start", async () => {
    seed({ scenePlan: makePlan(), generatedResults: [{ url: LIVE_MP4, timestamp: "t0", jobId: "j0" }] })
    const incoming = makePlan({ revisionId: REV_B, parentRevisionId: REV_A })
    let ticks = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      ticks += 1
      if (ticks === 1) {
        // Another run on this node settles while this one is still polling.
        mockUpdateNodeData("n1", {
          generatedResults: [
            { url: LIVE_MP4, timestamp: "t0", jobId: "j0" },
            { url: "https://r2.example/renders/other.mp4", timestamp: "t1", jobId: "j-other" },
          ],
        })
        return { id: "j1", status: "processing", progress: 10 }
      }
      return { id: "j1", status: "completed", output_data: { scenePlan: incoming, videoUrl: NEW_MP4 } }
    })

    await drain(
      runScene3DJob({
        nodeId: "n1",
        source: "generate",
        label: "3D Render Pro",
        ctx,
        start: async () => ({ jobId: "j1" }),
        extraCompletionPatch: (output, completion) => {
          const previous = (completion.liveNode.generatedResults ?? []) as Array<{ url: string }>
          return {
            generatedVideoUrl: output.videoUrl,
            generatedResults: [...previous, { url: output.videoUrl, timestamp: "t2", jobId: completion.jobId }],
            activeResultIndex: previous.length,
          }
        },
      }),
    )

    const results = mockNodes[0].data.generatedResults as Array<{ url: string; jobId: string }>
    // The concurrent result survived — a run-start snapshot would have dropped it.
    expect(results.map((r) => r.url)).toEqual([
      LIVE_MP4,
      "https://r2.example/renders/other.mp4",
      NEW_MP4,
    ])
    expect(results[2].jobId).toBe("j1")
    expect(mockNodes[0].data.activeResultIndex).toBe(2)
  })

  it("does NOT apply it on PARK — the live MP4 and its result history survive", async () => {
    seed({
      scenePlan: makePlan(),
      generatedVideoUrl: LIVE_MP4,
      generatedResults: [{ url: LIVE_MP4, timestamp: "t0", jobId: "j0" }],
      activeResultIndex: 0,
    })
    const manual = makePlan({ revisionId: "33333333-3333-4333-8333-333333333333" })
    const incoming = makePlan({ revisionId: REV_B })
    let calls = 0
    let ticks = 0
    mockGetJobStatusLean.mockImplementation(async () => {
      ticks += 1
      if (ticks === 1) {
        mockUpdateNodeData("n1", { scenePlan: manual })
        return { id: "j1", status: "processing", progress: 10 }
      }
      return { id: "j1", status: "completed", output_data: { scenePlan: incoming, videoUrl: NEW_MP4 } }
    })

    await drain(
      runScene3DJob({
        nodeId: "n1",
        source: "generate",
        label: "3D Render Pro",
        ctx,
        start: async () => ({ jobId: "j1" }),
        extraCompletionPatch: (output) => {
          calls += 1
          return { generatedVideoUrl: output.videoUrl, generatedResults: [], activeResultIndex: 0 }
        },
      }),
    )

    expect(calls).toBe(0)
    expect(mockNodes[0].data.generatedVideoUrl).toBe(LIVE_MP4)
    expect(mockNodes[0].data.generatedResults).toEqual([{ url: LIVE_MP4, timestamp: "t0", jobId: "j0" }])
    expect(mockNodes[0].data.activeResultIndex).toBe(0)
    expect(mockNodes[0].data.scenePlan).toEqual(manual)
    // Nothing is discarded: the paid revision is still filed.
    expect(mockNodes[0].data.scenePendingPlan).toEqual(incoming)
    const history = mockNodes[0].data.sceneHistory as Array<{ revisionId: string; jobId?: string }>
    expect(history.map((h) => h.revisionId)).toContain(REV_B)
    expect(history.find((h) => h.revisionId === REV_B)?.jobId).toBe("j1")
  })
})
