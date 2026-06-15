import { renderHook, act, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase", () => ({ supabase: { auth: {} }, createClient: () => ({ auth: {} }) }))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  createAppRun: vi.fn(async () => ({ id: "db-run-1", createdAt: new Date(0).toISOString() })),
  runPublishedApp: vi.fn(async () => ({ executionId: "exec-1", runId: "run-1" })),
}))

import { useRunSlots } from "../use-run-slots"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { runPublishedApp } from "@/lib/api"

describe("useRunSlots.launch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppRunnerStore.setState({ slug: "test-app", app: null, executionStatus: "idle", nodeStates: {} })
    usePresentationStore.setState({ inputValues: {}, nodes: [], edges: [] })
  })

  it("snapshots the draft into a new run slot and preserves the draft", async () => {
    const { result } = renderHook(() => useRunSlots({ slug: "test-app", user: null, persistRuns: false }))

    act(() => {
      usePresentationStore.setState({ inputValues: { n1: { text: "draft text" } } })
    })

    await act(async () => {
      await result.current.launch()
    })

    // A new run slot was created from the snapshot…
    await waitFor(() => expect(result.current.slots.length).toBe(1))
    const slot = result.current.slots[0]
    expect((slot.inputValues.n1 as { text: string }).text).toBe("draft text")
    expect(result.current.activeSlotId).toBe(slot.id)

    // …the run was launched against that new slot id…
    expect(runPublishedApp).toHaveBeenCalledTimes(1)
    expect((runPublishedApp as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(slot.id)

    // …and the composer draft is preserved (not cleared) for the next launch.
    expect((usePresentationStore.getState().inputValues.n1 as { text: string }).text).toBe("draft text")
  })
})
