import { describe, it, expect, afterEach, vi } from "vitest"

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    getPublishedApp: vi.fn(),
    runPublishedApp: vi.fn(),
    getAppRuns: vi.fn(),
    getAppExecutionStatus: vi.fn(),
    deleteAppRun: vi.fn(),
    cancelWorkflowExecution: vi.fn(),
  }
})

import { useAppRunnerStore, type RunRuntime } from "../use-app-runner-store"
import {
  getPublishedApp,
  runPublishedApp,
  getAppRuns,
  getAppExecutionStatus,
  deleteAppRun,
  cancelWorkflowExecution,
} from "@/lib/api"

const runtimeFixture = (over: Partial<RunRuntime> = {}): RunRuntime => ({
  executionId: null, status: "idle", nodeStates: {}, completedNodes: 0, totalNodes: 0,
  errorMessage: null, insufficientCredits: false, progressSegments: {}, combinedProgress: {}, ...over,
})

afterEach(() => {
  useAppRunnerStore.getState().reset()
  vi.clearAllMocks()
})

describe("useAppRunnerStore", () => {
  describe("initial state", () => {
    it("has correct defaults", () => {
      const state = useAppRunnerStore.getState()
      expect(state.app).toBeNull()
      expect(state.slug).toBeNull()
      expect(state.loading).toBe(false)
      expect(state.runs).toEqual([])
      expect(state.runsLoading).toBe(false)
      expect(state.activeRunId).toBeNull()
      expect(state.executionId).toBeNull()
      expect(state.executionStatus).toBe("idle")
      expect(state.nodeStates).toEqual({})
      expect(state.inputValues).toEqual({})
      expect(state.completedNodes).toBe(0)
      expect(state.totalNodes).toBe(0)
      expect(state.errorMessage).toBeNull()
    })
  })

  describe("loadApp", () => {
    it("sets loading then app on success", async () => {
      const mockApp = { id: "app_1", slug: "my-app", name: "My App" }
      vi.mocked(getPublishedApp).mockResolvedValue(mockApp as never)

      const promise = useAppRunnerStore.getState().loadApp("my-app")

      // slug is set immediately
      expect(useAppRunnerStore.getState().slug).toBe("my-app")

      await promise

      const state = useAppRunnerStore.getState()
      expect(state.app).toEqual(mockApp)
      expect(state.loading).toBe(false)
      expect(state.errorMessage).toBeNull()
      expect(getPublishedApp).toHaveBeenCalledWith("my-app")
    })

    it("sets errorMessage on failure", async () => {
      vi.mocked(getPublishedApp).mockRejectedValue(new Error("Not found"))

      await useAppRunnerStore.getState().loadApp("bad-slug")

      const state = useAppRunnerStore.getState()
      expect(state.loading).toBe(false)
      expect(state.errorMessage).toBe("Not found")
      expect(state.app).toBeNull()
    })

    it("sets generic error message for non-Error throws", async () => {
      vi.mocked(getPublishedApp).mockRejectedValue("string error")

      await useAppRunnerStore.getState().loadApp("bad-slug")

      expect(useAppRunnerStore.getState().errorMessage).toBe("Failed to load app")
    })

    it("prevents concurrent loads", async () => {
      vi.mocked(getPublishedApp).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: "app_1" } as never), 100)),
      )

      const p1 = useAppRunnerStore.getState().loadApp("slug-1")
      const p2 = useAppRunnerStore.getState().loadApp("slug-2")

      await Promise.all([p1, p2])

      // Only one call should have been made
      expect(getPublishedApp).toHaveBeenCalledTimes(1)
      expect(getPublishedApp).toHaveBeenCalledWith("slug-1")
    })

    it("migrates legacy loop nodes in snapshotNodes to list on load", async () => {
      // A multi-column loop ("Table") + a single-column loop in the snapshot.
      const twoColLoop = {
        id: "loop_multi",
        type: "loop",
        position: { x: 0, y: 0 },
        data: {
          label: "Cast",
          columns: [
            { id: "c1", name: "Name", handleId: "col_c1", type: "text" },
            { id: "c2", name: "Face", handleId: "col_c2", type: "image-url" },
          ],
          rows: [["Ana", "u1"], ["Bo", "u2"]],
        },
      }
      const oneColLoop = {
        id: "loop_single",
        type: "loop",
        position: { x: 0, y: 0 },
        data: { label: "Shots", columns: [{ id: "c3", name: "Shot", handleId: "col_c3", type: "text" }], rows: [["a"]] },
      }
      const mockApp = {
        id: "app_1",
        slug: "my-app",
        name: "My App",
        snapshotNodes: [twoColLoop, oneColLoop, { id: "tp", type: "text-prompt", position: { x: 0, y: 0 }, data: {} }],
        snapshotEdges: [{ id: "e1", source: "loop_multi", target: "tp" }],
      }
      vi.mocked(getPublishedApp).mockResolvedValue(mockApp as never)

      await useAppRunnerStore.getState().loadApp("my-app")

      const nodes = useAppRunnerStore.getState().app!.snapshotNodes as Array<{ id: string; type?: string; data: Record<string, unknown> }>
      // Both loop nodes are now `list`
      expect(nodes.find((n) => n.id === "loop_multi")!.type).toBe("list")
      expect(nodes.find((n) => n.id === "loop_single")!.type).toBe("list")
      // Multi-column structure (columns 2+) is preserved by the migration
      expect((nodes.find((n) => n.id === "loop_multi")!.data.columns as unknown[]).length).toBe(2)
      expect(nodes.find((n) => n.id === "loop_multi")!.data.rows).toEqual([["Ana", "u1"], ["Bo", "u2"]])
      // Edges untouched
      expect(useAppRunnerStore.getState().app!.snapshotEdges).toEqual([{ id: "e1", source: "loop_multi", target: "tp" }])
    })

    it("returns app untouched when snapshotNodes is absent (defensive null-safety)", async () => {
      const mockApp = { id: "app_1", slug: "my-app", name: "My App" }
      vi.mocked(getPublishedApp).mockResolvedValue(mockApp as never)
      await useAppRunnerStore.getState().loadApp("my-app")
      expect(useAppRunnerStore.getState().app).toEqual(mockApp)
    })
  })

  describe("loadRuns", () => {
    it("populates runs array", async () => {
      const mockRuns = [
        { id: "run_1", executionId: "exec_1" },
        { id: "run_2", executionId: "exec_2" },
      ]
      vi.mocked(getAppRuns).mockResolvedValue({ data: mockRuns } as never)

      useAppRunnerStore.setState({ slug: "my-app" })
      await useAppRunnerStore.getState().loadRuns()

      const state = useAppRunnerStore.getState()
      expect(state.runs).toEqual(mockRuns)
      expect(state.runsLoading).toBe(false)
      expect(getAppRuns).toHaveBeenCalledWith("my-app")
    })

    it("is a no-op if no slug is set", async () => {
      await useAppRunnerStore.getState().loadRuns()

      expect(getAppRuns).not.toHaveBeenCalled()
      expect(useAppRunnerStore.getState().runsLoading).toBe(false)
    })
  })

  describe("run", () => {
    it("sets executionStatus to running and calls runPublishedApp", async () => {
      vi.mocked(runPublishedApp).mockResolvedValue({
        executionId: "exec_1",
        runId: "run_1",
      } as never)

      useAppRunnerStore.setState({ slug: "my-app" })
      await useAppRunnerStore.getState().run()

      const state = useAppRunnerStore.getState()
      expect(state.executionId).toBe("exec_1")
      expect(state.activeRunId).toBe("run_1")
      expect(runPublishedApp).toHaveBeenCalledWith("my-app", undefined, undefined, undefined)
    })

    it("sends inputValues when present", async () => {
      vi.mocked(runPublishedApp).mockResolvedValue({
        executionId: "exec_1",
        runId: "run_1",
      } as never)

      useAppRunnerStore.setState({
        slug: "my-app",
        inputValues: { node_1: { prompt: "hello" } },
      })
      await useAppRunnerStore.getState().run()

      expect(runPublishedApp).toHaveBeenCalledWith("my-app", {
        node_1: { prompt: "hello" },
      }, undefined, undefined)
    })

    it("sets executionStatus to failed and errorMessage on error", async () => {
      vi.mocked(runPublishedApp).mockRejectedValue(new Error("Server error"))

      useAppRunnerStore.setState({ slug: "my-app" })
      await useAppRunnerStore.getState().run()

      const state = useAppRunnerStore.getState()
      expect(state.executionStatus).toBe("failed")
      expect(state.errorMessage).toBe("Server error")
    })

    it("is a no-op if no slug is set", async () => {
      await useAppRunnerStore.getState().run()
      expect(runPublishedApp).not.toHaveBeenCalled()
    })
  })

  describe("selectRun", () => {
    it("sets activeRunId, executionId, and nodeStates from run execution", () => {
      const runs = [
        {
          id: "run_1",
          executionId: "exec_1",
          execution: {
            status: "completed",
            nodeStates: { node_1: { status: "completed", output: { image: "url" } } },
            completedNodes: 3,
            totalNodes: 3,
            errorMessage: null,
          },
        },
      ]

      useAppRunnerStore.setState({ runs: runs as never })
      useAppRunnerStore.getState().selectRun("run_1")

      const state = useAppRunnerStore.getState()
      expect(state.activeRunId).toBe("run_1")
      expect(state.executionId).toBe("exec_1")
      expect(state.nodeStates).toEqual({
        node_1: { status: "completed", output: { image: "url" } },
      })
      expect(state.completedNodes).toBe(3)
      expect(state.totalNodes).toBe(3)
    })

    it("sets executionStatus to completed for completed runs", () => {
      const runs = [
        {
          id: "run_1",
          executionId: "exec_1",
          execution: {
            status: "completed",
            nodeStates: {},
            completedNodes: 1,
            totalNodes: 1,
            errorMessage: null,
          },
        },
      ]

      useAppRunnerStore.setState({ runs: runs as never })
      useAppRunnerStore.getState().selectRun("run_1")

      expect(useAppRunnerStore.getState().executionStatus).toBe("completed")
    })

    it("sets executionStatus to failed for failed runs", () => {
      const runs = [
        {
          id: "run_1",
          executionId: "exec_1",
          execution: {
            status: "failed",
            nodeStates: {},
            completedNodes: 0,
            totalNodes: 1,
            errorMessage: "Node failed",
          },
        },
      ]

      useAppRunnerStore.setState({ runs: runs as never })
      useAppRunnerStore.getState().selectRun("run_1")

      const state = useAppRunnerStore.getState()
      expect(state.executionStatus).toBe("failed")
      expect(state.errorMessage).toBe("Node failed")
    })

    it("sets executionStatus to failed for cancelled runs", () => {
      const runs = [
        {
          id: "run_1",
          executionId: "exec_1",
          execution: {
            status: "cancelled",
            nodeStates: {},
            completedNodes: 0,
            totalNodes: 1,
            errorMessage: null,
          },
        },
      ]

      useAppRunnerStore.setState({ runs: runs as never })
      useAppRunnerStore.getState().selectRun("run_1")

      expect(useAppRunnerStore.getState().executionStatus).toBe("failed")
    })

    it("does nothing if run has no execution", () => {
      const runs = [{ id: "run_1", executionId: "exec_1", execution: null }]

      useAppRunnerStore.setState({ runs: runs as never })
      useAppRunnerStore.getState().selectRun("run_1")

      expect(useAppRunnerStore.getState().activeRunId).toBeNull()
    })

    it("does nothing if run is not found", () => {
      useAppRunnerStore.setState({ runs: [] })
      useAppRunnerStore.getState().selectRun("nonexistent")

      expect(useAppRunnerStore.getState().activeRunId).toBeNull()
    })
  })

  describe("newRun", () => {
    it("resets execution state but keeps app and slug", () => {
      useAppRunnerStore.setState({
        app: { id: "app_1" } as never,
        slug: "my-app",
        activeRunId: "run_1",
        executionId: "exec_1",
        executionStatus: "completed",
        nodeStates: { node_1: { status: "completed" } },
        completedNodes: 5,
        totalNodes: 5,
        errorMessage: "old error",
        inputValues: { node_1: { prompt: "hello" } },
        runs: [{ id: "run_1" }] as never,
      })

      useAppRunnerStore.getState().newRun()

      const state = useAppRunnerStore.getState()
      // Execution state is reset
      expect(state.activeRunId).toBeNull()
      expect(state.executionId).toBeNull()
      expect(state.executionStatus).toBe("idle")
      expect(state.nodeStates).toEqual({})
      expect(state.completedNodes).toBe(0)
      expect(state.totalNodes).toBe(0)
      expect(state.errorMessage).toBeNull()

      // App state is preserved (except inputValues which are cleared for fresh run)
      expect(state.app).toEqual({ id: "app_1" })
      expect(state.slug).toBe("my-app")
      expect(state.inputValues).toEqual({})
      expect(state.runs).toHaveLength(1)
    })
  })

  describe("deleteRun", () => {
    it("removes run from list", async () => {
      vi.mocked(deleteAppRun).mockResolvedValue(undefined as never)

      useAppRunnerStore.setState({
        slug: "my-app",
        runs: [
          { id: "run_1", executionId: "exec_1" },
          { id: "run_2", executionId: "exec_2" },
        ] as never,
        activeRunId: "run_2",
      })

      await useAppRunnerStore.getState().deleteRun("run_1")

      const state = useAppRunnerStore.getState()
      expect(state.runs).toHaveLength(1)
      expect(state.runs[0].id).toBe("run_2")
      expect(deleteAppRun).toHaveBeenCalledWith("my-app", "run_1")
      // Active run not affected
      expect(state.activeRunId).toBe("run_2")
    })

    it("calls newRun if deleted run was active", async () => {
      vi.mocked(deleteAppRun).mockResolvedValue(undefined as never)

      useAppRunnerStore.setState({
        slug: "my-app",
        runs: [{ id: "run_1", executionId: "exec_1" }] as never,
        activeRunId: "run_1",
        executionId: "exec_1",
        executionStatus: "completed",
      })

      await useAppRunnerStore.getState().deleteRun("run_1")

      const state = useAppRunnerStore.getState()
      expect(state.runs).toHaveLength(0)
      expect(state.activeRunId).toBeNull()
      expect(state.executionId).toBeNull()
      expect(state.executionStatus).toBe("idle")
    })

    it("is a no-op if no slug is set", async () => {
      await useAppRunnerStore.getState().deleteRun("run_1")
      expect(deleteAppRun).not.toHaveBeenCalled()
    })
  })

  describe("updateInputValue", () => {
    it("updates nested inputValues correctly", () => {
      useAppRunnerStore.getState().updateInputValue("node_1", "prompt", "hello")

      const state = useAppRunnerStore.getState()
      expect(state.inputValues).toEqual({
        node_1: { prompt: "hello" },
      })
    })

    it("preserves existing keys in the same node", () => {
      useAppRunnerStore.getState().updateInputValue("node_1", "prompt", "hello")
      useAppRunnerStore.getState().updateInputValue("node_1", "style", "cinematic")

      const state = useAppRunnerStore.getState()
      expect(state.inputValues.node_1).toEqual({
        prompt: "hello",
        style: "cinematic",
      })
    })

    it("preserves other nodes when updating one", () => {
      useAppRunnerStore.getState().updateInputValue("node_1", "prompt", "hello")
      useAppRunnerStore.getState().updateInputValue("node_2", "text", "world")

      const state = useAppRunnerStore.getState()
      expect(state.inputValues.node_1).toEqual({ prompt: "hello" })
      expect(state.inputValues.node_2).toEqual({ text: "world" })
    })
  })

  describe("concurrent runs", () => {
    it("keeps two in-flight runs isolated — launching B does not stop A", async () => {
      vi.mocked(runPublishedApp)
        .mockResolvedValueOnce({ executionId: "exA", runId: "rA" } as never)
        .mockResolvedValueOnce({ executionId: "exB", runId: "rB" } as never)
      vi.mocked(getAppExecutionStatus).mockResolvedValue(
        { status: "running", node_states: {}, completed_nodes: 0, total_nodes: 2 } as never,
      )
      useAppRunnerStore.setState({ slug: "my-app" })

      await useAppRunnerStore.getState().run("rA")
      await useAppRunnerStore.getState().run("rB")

      const s = useAppRunnerStore.getState()
      // Both runs are still live, each bound to its own execution.
      expect(s.getRunState("rA").status).toBe("running")
      expect(s.getRunState("rB").status).toBe("running")
      expect(s.getRunState("rA").executionId).toBe("exA")
      expect(s.getRunState("rB").executionId).toBe("exB")
      // The flat mirror reflects the most-recently-launched (active) run.
      expect(s.activeRunId).toBe("rB")
      expect(s.executionId).toBe("exB")
    })

    it("per-run combinedProgress does not collide on a shared output-node id", () => {
      useAppRunnerStore.setState({
        activeRunId: "rB",
        runtimes: {
          rA: runtimeFixture({ status: "running", combinedProgress: { out1: 25 } }),
          rB: runtimeFixture({ status: "running", combinedProgress: { out1: 80 } }),
        },
      })
      // Same output-node id, independent values — the whole reason for per-run maps.
      expect(useAppRunnerStore.getState().getRunState("rA").combinedProgress.out1).toBe(25)
      expect(useAppRunnerStore.getState().getRunState("rB").combinedProgress.out1).toBe(80)
    })

    it("getRunState returns an empty runtime for an unknown run", () => {
      expect(useAppRunnerStore.getState().getRunState("nope").status).toBe("idle")
    })
  })

  describe("cancel", () => {
    it("cancels ONLY the targeted run, leaving a concurrent run untouched", async () => {
      vi.mocked(cancelWorkflowExecution).mockResolvedValue(undefined as never)
      useAppRunnerStore.setState({
        activeRunId: "rB",
        runtimes: {
          rA: runtimeFixture({ status: "running", executionId: "exA" }),
          rB: runtimeFixture({ status: "running", executionId: "exB" }),
        },
      })

      await useAppRunnerStore.getState().cancel("rA")

      const s = useAppRunnerStore.getState()
      expect(s.getRunState("rA").status).toBe("failed")
      expect(s.getRunState("rA").errorMessage).toBe("Cancelled")
      expect(s.getRunState("rB").status).toBe("running") // untouched
      expect(cancelWorkflowExecution).toHaveBeenCalledWith("exA")
      expect(cancelWorkflowExecution).toHaveBeenCalledTimes(1)
    })

    it("falls back to the active run when handed a bare onClick event (regression)", async () => {
      vi.mocked(cancelWorkflowExecution).mockResolvedValue(undefined as never)
      useAppRunnerStore.setState({
        activeRunId: "rB",
        runtimes: { rB: runtimeFixture({ status: "running", executionId: "exB" }) },
      })

      // React passes the SyntheticEvent as the first arg of onClick={cancel}.
      await useAppRunnerStore.getState().cancel({ type: "click" } as never)

      expect(cancelWorkflowExecution).toHaveBeenCalledWith("exB")
      expect(useAppRunnerStore.getState().getRunState("rB").status).toBe("failed")
    })
  })

  describe("polling lifecycle", () => {
    afterEach(() => vi.useRealTimers())

    it("clears a run's poller when it completes — no leaked timer", async () => {
      vi.useFakeTimers()
      vi.mocked(runPublishedApp).mockResolvedValue({ executionId: "ex1", runId: "r1" } as never)
      vi.mocked(getAppRuns).mockResolvedValue({ data: [] } as never)
      vi.mocked(getAppExecutionStatus).mockResolvedValue(
        { status: "completed", node_states: {}, completed_nodes: 1, total_nodes: 1 } as never,
      )
      useAppRunnerStore.setState({ slug: "my-app" })

      await useAppRunnerStore.getState().run("r1")
      await vi.advanceTimersByTimeAsync(1100) // first poll → completed → clearPoller
      expect(useAppRunnerStore.getState().getRunState("r1").status).toBe("completed")

      const callsAfterComplete = vi.mocked(getAppExecutionStatus).mock.calls.length
      await vi.advanceTimersByTimeAsync(5000) // no further polls should fire
      expect(vi.mocked(getAppExecutionStatus).mock.calls.length).toBe(callsAfterComplete)
    })

    it("discards a stale poll after the run is re-fired with a new execution", async () => {
      vi.useFakeTimers()
      vi.mocked(getAppRuns).mockResolvedValue({ data: [] } as never)
      // First poll for ex1 is slow; resolve it AFTER the run is re-fired to ex2.
      let resolveSlow: (v: unknown) => void = () => {}
      vi.mocked(getAppExecutionStatus).mockImplementationOnce(
        () => new Promise((r) => { resolveSlow = r }) as never,
      )
      vi.mocked(runPublishedApp).mockResolvedValue({ executionId: "ex1", runId: "r1" } as never)
      useAppRunnerStore.setState({ slug: "my-app" })

      await useAppRunnerStore.getState().run("r1")
      await vi.advanceTimersByTimeAsync(1100) // fires the slow poll for ex1 (pending)

      // Re-fire r1 with a new execution before the slow poll resolves.
      useAppRunnerStore.setState((s) => ({
        runtimes: { ...s.runtimes, r1: { ...s.runtimes.r1, executionId: "ex2" } },
      }) as never)

      // The slow ex1 poll now resolves with bogus progress — must be DISCARDED.
      resolveSlow({ status: "running", node_states: {}, completed_nodes: 99, total_nodes: 99 })
      await Promise.resolve()
      expect(useAppRunnerStore.getState().getRunState("r1").completedNodes).not.toBe(99)
    })
  })

  describe("reset", () => {
    it("resets all state to defaults", () => {
      useAppRunnerStore.setState({
        app: { id: "app_1" } as never,
        slug: "my-app",
        loading: false,
        runs: [{ id: "run_1" }] as never,
        runsLoading: false,
        activeRunId: "run_1",
        executionId: "exec_1",
        executionStatus: "completed",
        nodeStates: { node_1: { status: "completed" } },
        inputValues: { node_1: { prompt: "hello" } },
        completedNodes: 5,
        totalNodes: 5,
        errorMessage: "some error",
      })

      useAppRunnerStore.getState().reset()

      const state = useAppRunnerStore.getState()
      expect(state.app).toBeNull()
      expect(state.slug).toBeNull()
      expect(state.loading).toBe(false)
      expect(state.runs).toEqual([])
      expect(state.runsLoading).toBe(false)
      expect(state.activeRunId).toBeNull()
      expect(state.executionId).toBeNull()
      expect(state.executionStatus).toBe("idle")
      expect(state.nodeStates).toEqual({})
      expect(state.inputValues).toEqual({})
      expect(state.completedNodes).toBe(0)
      expect(state.totalNodes).toBe(0)
      expect(state.errorMessage).toBeNull()
    })
  })
})
