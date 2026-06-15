import { renderHook, act, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} }, createClient: () => ({ auth: {} }) }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  // The backend echoes the provided existingRunId as the runId — so a run's
  // runtime is keyed by the same id as its slot (what the fan-out matches on).
  runPublishedApp: vi.fn(async (_slug, _ov, existingRunId) => ({ executionId: `exec-${existingRunId}`, runId: existingRunId })),
  getAppExecutionStatus: vi.fn(async () => ({ status: "running", node_states: {}, completed_nodes: 0, total_nodes: 1 })),
}))

import { useRunSlots } from "../use-run-slots"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"

describe("useRunSlots — per-run fan-out (concurrency)", () => {
  beforeEach(() => {
    useAppRunnerStore.getState().reset()
    useAppRunnerStore.setState({ slug: "test-app", app: null })
    usePresentationStore.setState({ inputValues: {}, nodes: [], edges: [] })
  })
  afterEach(() => useAppRunnerStore.getState().reset())

  it("syncs each concurrent run's runtime onto its OWN slot, independently", async () => {
    const { result } = renderHook(() => useRunSlots({ slug: "test-app", user: null, persistRuns: false }))

    // Launch run A.
    act(() => usePresentationStore.setState({ inputValues: { n: { text: "A" } } }))
    await act(async () => { await result.current.launch() })
    const slotA = result.current.slots[0].id
    await waitFor(() => expect(result.current.slots.find((s) => s.id === slotA)?.executionStatus).toBe("running"))

    // Launch run B while A is still in flight — a distinct slot + runtime.
    act(() => usePresentationStore.setState({ inputValues: { n: { text: "B" } } }))
    await act(async () => { await result.current.launch() })
    const slotB = result.current.slots[0].id
    expect(slotB).not.toBe(slotA)
    await waitFor(() => expect(result.current.slots.find((s) => s.id === slotB)?.executionStatus).toBe("running"))

    // Complete A's runtime; B stays running. The fan-out must move ONLY A.
    act(() => {
      const rt = useAppRunnerStore.getState().runtimes
      useAppRunnerStore.setState({
        runtimes: { ...rt, [slotA]: { ...rt[slotA], status: "completed", nodeStates: { out: { status: "completed", output: { imageUrl: "u" } } } } },
      })
    })
    await waitFor(() => {
      expect(result.current.slots.find((s) => s.id === slotA)?.executionStatus).toBe("completed")
      expect(result.current.slots.find((s) => s.id === slotB)?.executionStatus).toBe("running")
    })
    // A's completed output flowed onto its slot.
    expect(result.current.slots.find((s) => s.id === slotA)?.nodeStates.out?.status).toBe("completed")
  })

  it("leaves a slot with no runtime untouched even when OTHER runs are live (per-slot guard)", async () => {
    const { result } = renderHook(() => useRunSlots({ slug: "test-app", user: null, persistRuns: false }))

    act(() => usePresentationStore.setState({ inputValues: { n: { text: "A" } } }))
    await act(async () => { await result.current.launch() })
    const slotA = result.current.slots[0].id
    await waitFor(() => expect(result.current.slots.find((s) => s.id === slotA)?.executionStatus).toBe("running"))
    const before = result.current.slots.find((s) => s.id === slotA)?.executionStatus

    // Replace the runtimes with a NON-EMPTY map that has NO entry for slotA (a
    // different run is live). The fan-out body runs, but slotA's `if (!rt) return
    // slot` branch must leave it as-is — NOT reset it to idle.
    const liveOther = {
      executionId: "x", status: "running" as const, nodeStates: {}, completedNodes: 0, totalNodes: 1,
      errorMessage: null, insufficientCredits: false, progressSegments: {}, combinedProgress: {},
    }
    act(() => useAppRunnerStore.setState({ runtimes: { "other-run": liveOther } }))
    expect(result.current.slots.find((s) => s.id === slotA)?.executionStatus).toBe(before)
  })
})
