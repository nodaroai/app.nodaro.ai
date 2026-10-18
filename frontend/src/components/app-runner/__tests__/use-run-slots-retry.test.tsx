import { renderHook, act, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Retry of a failed app run (decided 2026-10-18): it is always confirmed first — the server's plan
 * names the steps that run again and their price — then CONTINUES the run (`resumeAppRun`), never
 * starting it over. Start over, beside it, resets the run to start it again from nothing.
 */
vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} }, createClient: () => ({ auth: {} }) }))

const PLAN = {
  runId: "run-1", continuesExecutionId: "exec-1", appVersion: 1, nodeIds: ["vid", "join"],
  steps: [{ nodeId: "vid", type: "image-to-video", label: "Animate" }], estimatedCredits: 40, reusedClips: 2, sufficient: true, available: 900,
}

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getAppRuns: vi.fn(async () => []),
  createAppRun: vi.fn(async () => ({ id: "run-1", createdAt: new Date(0).toISOString() })),
  updateAppRunInputs: vi.fn(async () => undefined),
  runPublishedApp: vi.fn(async (_slug: string, _ov: unknown, runId: string) => ({ executionId: "exec-1", runId })),
  getAppExecutionStatus: vi.fn(async () => ({ status: "running", node_states: {}, completed_nodes: 0, total_nodes: 1 })),
  planAppRunResume: vi.fn(async () => PLAN),
  resumeAppRun: vi.fn(async () => ({ executionId: "exec-2", runId: "run-1", status: "pending" })),
}))

import { useRunSlots } from "../use-run-slots"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { planAppRunResume, resumeAppRun, runPublishedApp } from "@/lib/api"

const USER = { id: "user-1" }

/** A run that launched and failed: its slot is the active one. */
async function failedRun(persistRuns = true) {
  const hook = renderHook(() => useRunSlots({ slug: "test-app", user: persistRuns ? USER : null, persistRuns }))
  act(() => usePresentationStore.setState({ inputValues: { n: { text: "A" } } }))
  await act(async () => { await hook.result.current.launch() })
  const slotId = hook.result.current.activeSlotId!
  act(() => {
    const rt = useAppRunnerStore.getState().runtimes
    useAppRunnerStore.setState({ runtimes: { ...rt, [slotId]: { ...rt[slotId]!, status: "failed", nodeStates: { img: { status: "completed", output: { imageUrl: "u" } } } } } })
  })
  await waitFor(() => expect(hook.result.current.activeSlot?.executionStatus).toBe("failed"))
  expect(hook.result.current.newRunAction).toBe("retry")
  return { ...hook, slotId }
}

describe("useRunSlots — Retry continues a failed run", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppRunnerStore.getState().reset()
    useAppRunnerStore.setState({ slug: "test-app", app: null })
    usePresentationStore.setState({ inputValues: {}, nodes: [], edges: [] })
  })
  afterEach(() => useAppRunnerStore.getState().reset())

  it("asks first, with the server's plan of what runs again; confirming continues the run", async () => {
    const { result, slotId } = await failedRun()
    act(() => result.current.handleHeaderAction())
    // The confirmation opens at once, then holds the plan.
    expect(result.current.resumeDialog).toMatchObject({ slotId, plan: null })
    await waitFor(() => expect(result.current.resumeDialog?.plan).toEqual(PLAN))
    expect(planAppRunResume).toHaveBeenCalledWith("test-app", slotId, undefined)
    expect(resumeAppRun).not.toHaveBeenCalled()

    await act(async () => { await result.current.confirmResume() })
    expect(result.current.resumeDialog).toBeNull()
    expect(resumeAppRun).toHaveBeenCalledWith("test-app", slotId, undefined)
    // Never a fresh run of the slot.
    expect(runPublishedApp).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.activeSlot?.executionStatus).toBe("running"))
    expect(useAppRunnerStore.getState().runtimes[slotId]?.executionId).toBe("exec-2")
    // What the run finished stays on show while the rest runs.
    expect(useAppRunnerStore.getState().runtimes[slotId]?.nodeStates.img?.status).toBe("completed")
  })

  it("asks for the version the runner is on: a run of another one is refused, never continued on an old snapshot", async () => {
    const { result, slotId } = await failedRun()
    act(() => useAppRunnerStore.setState({ app: { versions: [{ version: 1 }, { version: 2 }] } as never }))
    act(() => result.current.handleHeaderAction())
    await waitFor(() => expect(planAppRunResume).toHaveBeenCalledWith("test-app", slotId, 2))
    await waitFor(() => expect(result.current.resumeDialog?.plan).toEqual(PLAN))
    await act(async () => { await result.current.confirmResume() })
    expect(resumeAppRun).toHaveBeenCalledWith("test-app", slotId, 2)
  })

  it("Start over is fresh: the slot goes back to idle with its inputs, nothing continued", async () => {
    const { result } = await failedRun()
    act(() => result.current.handleHeaderAction())
    await waitFor(() => expect(result.current.resumeDialog?.plan).toEqual(PLAN))
    act(() => result.current.handleStartOver())
    expect(result.current.resumeDialog).toBeNull()
    expect(result.current.activeSlot?.executionStatus).toBe("idle")
    expect((result.current.activeSlot?.inputValues.n as { text: string }).text).toBe("A")
    expect(resumeAppRun).not.toHaveBeenCalled()
  })

  it("a run that cannot be continued says why, and offers only Start over", async () => {
    vi.mocked(planAppRunResume).mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "app_run_version_unavailable" }))
    const { result } = await failedRun()
    act(() => result.current.handleHeaderAction())
    await waitFor(() => expect(result.current.resumeDialog?.error).toEqual({ code: "app_run_version_unavailable", message: "gone" }))
    await act(async () => { await result.current.confirmResume() })
    expect(resumeAppRun).not.toHaveBeenCalled()
  })

  it("a run that is not saved (no session) has nothing to continue: Retry starts over", async () => {
    const { result } = await failedRun(false)
    act(() => result.current.handleHeaderAction())
    expect(result.current.resumeDialog).toBeNull()
    expect(planAppRunResume).not.toHaveBeenCalled()
    expect(result.current.activeSlot?.executionStatus).toBe("idle")
  })
})
