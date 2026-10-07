import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

// Render final in the app runner (decided 2026-10-04): the store follows an app
// run's final — a second execution, outside the run — and shows its results
// over the run's own once it has them. The runner's edits of a run's results
// are one column the server's PATCH replaces whole, so every write sends the
// merged whole.

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    renderAppRunFinal: vi.fn(),
    getAppExecutionStatus: vi.fn(),
    getAppRuns: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
    updateAppRunInputs: vi.fn().mockResolvedValue({}),
  }
})

import { mergeRunEdits, useAppRunnerStore } from "../use-app-runner-store"
import { getAppExecutionStatus, renderAppRunFinal, updateAppRunInputs, WorkflowAlreadyRunningError } from "@/lib/api"

const preview = { status: "completed" as const, output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" } }

const app = {
  snapshotNodes: [
    { id: "plan", type: "edit-plan", data: {} },
    { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
    { id: "cap", type: "add-captions", data: {} },
  ],
  snapshotEdges: [
    { id: "e1", source: "plan", target: "cut", targetHandle: "edl" },
    { id: "e2", source: "cut", target: "cap" },
  ],
}

beforeEach(() => {
  vi.useFakeTimers()
  useAppRunnerStore.setState({
    slug: "my-app",
    app: app as never,
    activeRunId: "run-1",
    executionId: "exec-run",
    executionStatus: "completed",
    nodeStates: { cut: preview, cap: { status: "skipped" } },
  })
})

afterEach(() => {
  vi.useRealTimers()
  useAppRunnerStore.getState().reset()
  vi.clearAllMocks()
})

describe("renderFinal — the app run's final", () => {
  it("starts the final, follows it, and shows its results over the preview once it completes", async () => {
    vi.mocked(renderAppRunFinal).mockResolvedValue({ executionId: "exec-final", runId: "run-1", status: "pending" })
    await useAppRunnerStore.getState().renderFinal("run-1", "cut")
    expect(renderAppRunFinal).toHaveBeenCalledWith("my-app", "run-1", "cut", expect.any(String))
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.final).toMatchObject({ executionId: "exec-final", status: "running", renderNodeId: "cut" })

    // Still rendering: the preview stays on show.
    vi.mocked(getAppExecutionStatus).mockResolvedValueOnce({
      status: "running",
      node_states: { cut: { status: "running", startedAt: "t" } },
      completed_nodes: 0,
      total_nodes: 2,
      failed_nodes: 0,
      error_message: null,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(useAppRunnerStore.getState().nodeStates.cut).toEqual(preview)
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.final).toMatchObject({ totalNodes: 2, status: "running" })

    vi.mocked(getAppExecutionStatus).mockResolvedValueOnce({
      status: "completed",
      node_states: {
        plan: { status: "completed", output: {}, seededFromExecution: "exec-run" },
        cut: { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" }, startedAt: "t" },
        cap: { status: "completed", output: { videoUrl: "https://r2/cap.mp4" }, startedAt: "t" },
      },
      completed_nodes: 2,
      total_nodes: 2,
      failed_nodes: 0,
      error_message: null,
    })
    await vi.advanceTimersByTimeAsync(2000)
    const state = useAppRunnerStore.getState()
    expect(state.runtimes["run-1"]!.final!.status).toBe("completed")
    expect((state.nodeStates.cut as { output: Record<string, unknown> }).output.quality).toBe("final")
    expect((state.nodeStates.cap as { output: Record<string, unknown> }).output.videoUrl).toBe("https://r2/cap.mp4")
    // A seed of the final never replaces the run's own state.
    expect(state.nodeStates.plan).toBeUndefined()
  })

  it("a chain: the second render's final shows over the first final's results, which stay under it (decided 2026-10-06)", async () => {
    // After the first final: cut is Final, cut2 (further on) a Preview the first final made.
    const first = {
      cut: { status: "completed" as const, output: { videoUrl: "https://r2/final.mp4", quality: "final" }, fromRenderFinal: true },
      cut2: { status: "completed" as const, output: { videoUrl: "https://r2/preview2.mp4", quality: "proxy" }, fromRenderFinal: true },
      cap: { status: "skipped" as const },
    }
    useAppRunnerStore.setState({ nodeStates: first as never })
    vi.mocked(renderAppRunFinal).mockResolvedValue({ executionId: "exec-final-2", runId: "run-1", status: "pending" })
    await useAppRunnerStore.getState().renderFinal("run-1", "cut2")
    expect(renderAppRunFinal).toHaveBeenCalledWith("my-app", "run-1", "cut2", expect.any(String))

    // The second final seeds cut from the first, and renders cut2 and what follows.
    vi.mocked(getAppExecutionStatus).mockResolvedValueOnce({
      status: "completed",
      node_states: {
        cut: { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" }, seededFromExecution: "exec-final-1" },
        cut2: { status: "completed", output: { videoUrl: "https://r2/final2.mp4", quality: "final" }, startedAt: "t" },
        cap: { status: "completed", output: { videoUrl: "https://r2/cap.mp4" }, startedAt: "t" },
      },
      completed_nodes: 2,
      total_nodes: 2,
      failed_nodes: 0,
      error_message: null,
    })
    await vi.advanceTimersByTimeAsync(1000)
    const shown = useAppRunnerStore.getState().nodeStates as Record<string, { output?: Record<string, unknown> }>
    expect(shown.cut!.output!.videoUrl).toBe("https://r2/final.mp4")
    expect(shown.cut2!.output!.videoUrl).toBe("https://r2/final2.mp4")
    expect(shown.cap!.output!.videoUrl).toBe("https://r2/cap.mp4")
  })

  it("a final already rendering is followed, not started twice", async () => {
    vi.mocked(renderAppRunFinal).mockRejectedValue(new WorkflowAlreadyRunningError("exec-final"))
    await useAppRunnerStore.getState().renderFinal("run-1", "cut")
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.final).toMatchObject({ executionId: "exec-final", status: "running" })
  })

  it("a refusal shows on the bar; the preview stays", async () => {
    vi.mocked(renderAppRunFinal).mockRejectedValue(new Error("You need app credits"))
    await useAppRunnerStore.getState().renderFinal("run-1", "cut")
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.final).toMatchObject({ status: "failed", errorMessage: "You need app credits" })
    expect(useAppRunnerStore.getState().nodeStates.cut).toEqual(preview)
  })

  // The runner's edits of what the final replaces go when it COMPLETES, not
  // when it is asked for: a final that fails keeps the preview, and the edit of
  // it (decided 2026-10-06 — the server settles them at the same point).
  const edits = { cut: { output: { videoUrl: "edited" } }, plan: { editedEdl: { v: 1 } } }
  const ended = (status: string, nodeStates: Record<string, unknown>) => ({
    status,
    node_states: nodeStates,
    completed_nodes: 1,
    total_nodes: 2,
    failed_nodes: status === "failed" ? 1 : 0,
    error_message: status === "failed" ? "boom" : null,
  })

  it("keeps the overlay's edits while the final renders", async () => {
    useAppRunnerStore.getState().seedRunEdits("run-1", edits)
    vi.mocked(renderAppRunFinal).mockResolvedValue({ executionId: "exec-final", runId: "run-1", status: "pending" })
    await useAppRunnerStore.getState().renderFinal("run-1", "cut")
    expect(useAppRunnerStore.getState().runEdits["run-1"]).toEqual(edits)
  })

  it("a final whose render failed keeps every edit", async () => {
    useAppRunnerStore.getState().seedRunEdits("run-1", edits)
    vi.mocked(renderAppRunFinal).mockResolvedValue({ executionId: "exec-final", runId: "run-1", status: "pending" })
    await useAppRunnerStore.getState().renderFinal("run-1", "cut")
    vi.mocked(getAppExecutionStatus).mockResolvedValueOnce(ended("failed", { cut: { status: "failed" } }) as never)
    await vi.advanceTimersByTimeAsync(1000)
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.final!.status).toBe("failed")
    expect(useAppRunnerStore.getState().runEdits["run-1"]).toEqual(edits)
  })

  // Review round 2: a final that completed the render and then failed further
  // on is not laid over the run — the server's run views show the preview, and
  // keep the edit of it. Live, the store agrees: the results it laid while the
  // final rendered go, and the edits stay.
  it("a final that failed after completing the render: back to the preview, every edit kept", async () => {
    useAppRunnerStore.getState().seedRunEdits("run-1", edits)
    vi.mocked(renderAppRunFinal).mockResolvedValue({ executionId: "exec-final", runId: "run-1", status: "pending" })
    await useAppRunnerStore.getState().renderFinal("run-1", "cut")
    const finalCut = { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" } }
    vi.mocked(getAppExecutionStatus)
      .mockResolvedValueOnce({ ...ended("running", { cut: finalCut }), failed_nodes: 0, error_message: null } as never)
      .mockResolvedValueOnce(ended("failed", { cut: finalCut, cap: { status: "failed" } }) as never)
    await vi.advanceTimersByTimeAsync(1000)
    // While it renders, what it completed shows.
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.nodeStates.cut).toMatchObject({ output: { videoUrl: "https://r2/final.mp4" } })
    await vi.advanceTimersByTimeAsync(2000)
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.final!.status).toBe("failed")
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.nodeStates.cut).toEqual(preview)
    expect(useAppRunnerStore.getState().runEdits["run-1"]).toEqual(edits)
  })

  it("once the final completes, drops the edits of the nodes it completed itself (never a seed's)", async () => {
    useAppRunnerStore.getState().seedRunEdits("run-1", edits)
    vi.mocked(renderAppRunFinal).mockResolvedValue({ executionId: "exec-final", runId: "run-1", status: "pending" })
    await useAppRunnerStore.getState().renderFinal("run-1", "cut")
    vi.mocked(getAppExecutionStatus).mockResolvedValueOnce(
      ended("completed", {
        plan: { status: "completed", output: {}, seededFromExecution: "exec-run" },
        cut: { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" } },
      }) as never,
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(useAppRunnerStore.getState().runEdits["run-1"]).toEqual({ plan: { editedEdl: { v: 1 } } })
  })
})

describe("followFinal — a final asked for before a reload", () => {
  it("follows a final still rendering; ignores one that ended", () => {
    const store = useAppRunnerStore.getState()
    store.followFinal("run-1", { id: "exec-done", status: "completed" }, {})
    expect(useAppRunnerStore.getState().runtimes["run-1"]?.final).toBeUndefined()
    store.followFinal("run-1", { id: "exec-final", status: "running", completedNodes: 1, totalNodes: 3 }, { cut: preview })
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.final).toMatchObject({ executionId: "exec-final", status: "running", completedNodes: 1 })
    // The run's own states stay on show while it renders.
    expect(useAppRunnerStore.getState().runtimes["run-1"]!.nodeStates.cut).toEqual(preview)
  })
})

describe("the runner's edits — the PATCH replaces the column, so the store writes the merged whole", () => {
  it("two edits on different nodes both survive", async () => {
    const store = useAppRunnerStore.getState()
    await store.saveRunEdits("run-1", { a: { status: "completed", output: { url: "a-edit" } } })
    await store.saveRunEdits("run-1", { b: { status: "completed", output: { url: "b-edit" } } })
    const last = vi.mocked(updateAppRunInputs).mock.calls.at(-1)!
    expect(last[0]).toBe("my-app")
    expect(last[1]).toBe("run-1")
    expect(last[5]).toEqual({
      a: { status: "completed", output: { url: "a-edit" } },
      b: { status: "completed", output: { url: "b-edit" } },
    })
  })

  it("an edit merges over what the server already held for the run", async () => {
    useAppRunnerStore.getState().seedRunEdits("run-1", { a: { output: { url: "a-old", text: "keep" } } })
    await useAppRunnerStore.getState().saveRunEdits("run-1", { a: { output: { url: "a-new" } } })
    expect(vi.mocked(updateAppRunInputs).mock.calls.at(-1)![5]).toEqual({ a: { output: { url: "a-new", text: "keep" } } })
  })

  it("mergeRunEdits never mutates", () => {
    const known = { a: { output: { url: "x" } } }
    const merged = mergeRunEdits(known, { a: { output: { text: "y" } } })
    expect(known).toEqual({ a: { output: { url: "x" } } })
    expect(merged).toEqual({ a: { output: { url: "x", text: "y" } } })
  })
})
