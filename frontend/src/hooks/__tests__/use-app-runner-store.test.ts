import { describe, it, expect, afterEach, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  getPublishedApp: vi.fn(),
  runPublishedApp: vi.fn(),
  getAppRuns: vi.fn(),
  getAppExecutionStatus: vi.fn(),
  deleteAppRun: vi.fn(),
}))

import { useAppRunnerStore } from "../use-app-runner-store"
import {
  getPublishedApp,
  runPublishedApp,
  getAppRuns,
  deleteAppRun,
} from "@/lib/api"

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
      expect(runPublishedApp).toHaveBeenCalledWith("my-app", undefined)
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
      })
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
