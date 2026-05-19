import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

// Hoisted mocks — must precede the SUT import.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    saveLocation: vi.fn(),
    getLocationById: vi.fn(),
    approveLocationMainImage: vi.fn(),
  }
})

vi.mock("@/hooks/use-auth", () => ({
  getCachedUserId: () => "user-1",
}))

vi.mock("@/hooks/queries/use-invalidate-location", () => ({
  useInvalidateLocation: () => vi.fn(),
}))

// Stub the supabase client so the realtime subscription mounted by
// `useLocationStudio` doesn't try to read VITE_SUPABASE_URL at runtime
// (the CI test env doesn't set it). Subscription side effects aren't
// what these tests exercise — only the open/save/dirty/409 flows are.
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  }),
}))

// Lightweight store stub — the real Zustand store is overkill for hook tests.
const mockNode: { id: string; type: string; data: Record<string, unknown> } = {
  id: "loc-1",
  type: "location",
  data: {
    label: "Location",
    locationDbId: "",
    locationName: "Cafe Roma",
    description: "Cozy interior",
    category: "indoor",
    style: "realistic",
    sourceImageUrl: "",
    projectId: "proj-1",
    timeOfDay: [],
    weather: [],
    angles: [],
    lighting: [],
    seasons: [],
    atmosphereMotions: [],
    referencePhotos: [],
    canonicalDescription: "",
    styleLock: false,
  },
}
const updateNodeData = vi.fn((nodeId: string, data: Record<string, unknown>) => {
  mockNode.data = { ...mockNode.data, ...data }
})
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({
      nodes: [mockNode],
      updateNodeData,
      projectId: "proj-1",
    }),
}))

import { useLocationStudio } from "../use-location-studio"
import {
  approveLocationMainImage,
  ConcurrentModificationError,
  getLocationById,
  saveLocation,
} from "@/lib/api"

describe("useLocationStudio", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNode.data = {
      label: "Location",
      locationDbId: "",
      locationName: "Cafe Roma",
      description: "Cozy interior",
      category: "indoor",
      style: "realistic",
      sourceImageUrl: "",
      projectId: "proj-1",
      timeOfDay: [],
      weather: [],
      angles: [],
      lighting: [],
      seasons: [],
      atmosphereMotions: [],
      referencePhotos: [],
      canonicalDescription: "",
      styleLock: false,
    }
  })

  it("seeds stagedData from the canvas node (deep copy)", async () => {
    const { result } = renderHook(() => useLocationStudio("loc-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())
    expect(result.current.stagedData?.locationName).toBe("Cafe Roma")
    // Mutating the original node data must NOT bleed into staged (deep copy).
    mockNode.data.locationName = "Should not appear"
    expect(result.current.stagedData?.locationName).toBe("Cafe Roma")
  })

  it("isDirty becomes true after patch and false again after save", async () => {
    vi.mocked(saveLocation).mockResolvedValueOnce({ id: "uuid-1", updatedAt: "2026-05-18T10:00:00Z" })
    const { result } = renderHook(() => useLocationStudio("loc-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    expect(result.current.isDirty).toBe(false)
    act(() => {
      result.current.patch({ description: "Rainy night vibe" })
    })
    expect(result.current.isDirty).toBe(true)

    await act(async () => {
      await result.current.saveStaged()
    })
    // After save, canvas was synced via updateNodeData so dirty flips back.
    expect(result.current.isDirty).toBe(false)
    expect(updateNodeData).toHaveBeenCalledWith(
      "loc-1",
      expect.objectContaining({ description: "Rainy night vibe", locationDbId: "uuid-1" }),
    )
  })

  it("saveStaged calls saveLocation with INSERT params when no locationDbId", async () => {
    vi.mocked(saveLocation).mockResolvedValueOnce({ id: "new-id", updatedAt: "2026-05-18T11:00:00Z" })
    const { result } = renderHook(() => useLocationStudio("loc-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    await act(async () => {
      await result.current.saveStaged()
    })
    expect(saveLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: undefined, // empty locationDbId → undefined → INSERT path
        nodeId: "loc-1",
        name: "Cafe Roma",
      }),
    )
  })

  it("ensureSavedBeforeGen auto-saves when locationDbId is empty and returns the new id", async () => {
    vi.mocked(saveLocation).mockResolvedValueOnce({ id: "fresh-uuid", updatedAt: "2026-05-18T12:00:00Z" })
    const { result } = renderHook(() => useLocationStudio("loc-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    let returned: string | undefined
    await act(async () => {
      returned = await result.current.ensureSavedBeforeGen()
    })
    expect(returned).toBe("fresh-uuid")
    expect(saveLocation).toHaveBeenCalledTimes(1)
  })

  it("ensureSavedBeforeGen short-circuits when locationDbId is already set", async () => {
    mockNode.data.locationDbId = "existing-uuid"
    const { result } = renderHook(() => useLocationStudio("loc-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    let returned: string | undefined
    await act(async () => {
      returned = await result.current.ensureSavedBeforeGen()
    })
    expect(returned).toBe("existing-uuid")
    expect(saveLocation).not.toHaveBeenCalled()
  })

  it("on 409 ConcurrentModificationError, re-fetches via getLocationById and re-stages", async () => {
    mockNode.data.locationDbId = "existing-uuid"
    vi.mocked(saveLocation).mockRejectedValueOnce(
      new ConcurrentModificationError("Modified concurrently", "2026-05-18T13:00:00Z"),
    )
    vi.mocked(getLocationById).mockResolvedValueOnce({
      id: "existing-uuid",
      userId: "user-1",
      nodeId: "loc-1",
      projectId: "proj-1",
      name: "Cafe Roma (server-updated)",
      description: "Server-side description",
      category: "indoor",
      style: "realistic",
      sourceImageUrl: "https://example.com/cafe.png",
      timeOfDay: [],
      weather: [],
      angles: [],
      lighting: [],
      seasons: [],
      atmosphereMotions: [],
      referencePhotos: [],
      canonicalDescription: "Auto-generated description",
      styleLock: false,
      createdAt: "2026-05-18T10:00:00Z",
      updatedAt: "2026-05-18T13:00:00Z",
    })

    const { result } = renderHook(() => useLocationStudio("loc-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    await act(async () => {
      try {
        await result.current.saveStaged()
      } catch {
        /* re-thrown ConcurrentModificationError is expected */
      }
    })

    expect(getLocationById).toHaveBeenCalledWith("existing-uuid")
    expect(result.current.stagedData?.locationName).toBe("Cafe Roma (server-updated)")
    expect(result.current.stagedData?.canonicalDescription).toBe("Auto-generated description")
  })

  // --------------------------------------------------------------------
  // Phase 2 #9 — approveMainImage + concurrent-modification recovery
  // --------------------------------------------------------------------

  it("approveMainImage passes expectedUpdatedAt to the API on approve", async () => {
    // Seed the canvas node with an existing DbId + updatedAt so the studio
    // has a non-empty optimistic-concurrency token.
    mockNode.data.locationDbId = "existing-uuid"
    mockNode.data.updatedAt = "2026-05-18T10:00:00Z"
    vi.mocked(approveLocationMainImage).mockResolvedValueOnce({
      sourceImageUrl: "https://example.com/approved.png",
      canonicalDescription: "Auto-generated caption text.",
    })

    const { result } = renderHook(() => useLocationStudio("loc-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    await act(async () => {
      await result.current.approveMainImage("candidate-uuid")
    })

    expect(approveLocationMainImage).toHaveBeenCalledWith(
      "existing-uuid",
      "candidate-uuid",
      "2026-05-18T10:00:00Z",
    )
    // On success the staged data must reflect the new sourceImageUrl +
    // canonicalDescription without a refetch.
    expect(result.current.stagedData?.sourceImageUrl).toBe("https://example.com/approved.png")
    expect(result.current.stagedData?.canonicalDescription).toBe("Auto-generated caption text.")
  })

  it("approveMainImage on 409 refetches via getLocationById and re-stages (mirror of saveStaged 409)", async () => {
    mockNode.data.locationDbId = "existing-uuid"
    mockNode.data.updatedAt = "2026-05-18T09:00:00Z" // stale token
    vi.mocked(approveLocationMainImage).mockRejectedValueOnce(
      new ConcurrentModificationError("Modified concurrently", "2026-05-18T13:00:00Z"),
    )
    vi.mocked(getLocationById).mockResolvedValueOnce({
      id: "existing-uuid",
      userId: "user-1",
      nodeId: "loc-1",
      projectId: "proj-1",
      name: "Cafe Roma (winner)",
      description: "Server-side description",
      category: "indoor",
      style: "realistic",
      sourceImageUrl: "https://example.com/the-winner.png",
      timeOfDay: [],
      weather: [],
      angles: [],
      lighting: [],
      seasons: [],
      atmosphereMotions: [],
      referencePhotos: [],
      canonicalDescription: "Description from the winning approver.",
      styleLock: false,
      createdAt: "2026-05-18T10:00:00Z",
      updatedAt: "2026-05-18T13:00:00Z",
    })

    const { result } = renderHook(() => useLocationStudio("loc-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    await act(async () => {
      try {
        await result.current.approveMainImage("candidate-uuid")
      } catch {
        /* re-thrown ConcurrentModificationError is expected */
      }
    })

    // 409 must trigger a refetch + re-stage — the staged data should now
    // hold the canonical row's sourceImageUrl + canonicalDescription, NOT
    // the values the caller tried to write.
    expect(getLocationById).toHaveBeenCalledWith("existing-uuid")
    expect(result.current.stagedData?.sourceImageUrl).toBe("https://example.com/the-winner.png")
    expect(result.current.stagedData?.canonicalDescription).toBe(
      "Description from the winning approver.",
    )
    expect(result.current.stagedData?.updatedAt).toBe("2026-05-18T13:00:00Z")
  })

  it("approveMainImage re-throws ConcurrentModificationError so the caller can react", async () => {
    mockNode.data.locationDbId = "existing-uuid"
    mockNode.data.updatedAt = "2026-05-18T09:00:00Z"
    vi.mocked(approveLocationMainImage).mockRejectedValueOnce(
      new ConcurrentModificationError("Modified concurrently", "2026-05-18T13:00:00Z"),
    )
    // The refetch is a no-op for this test — only the re-throw matters.
    vi.mocked(getLocationById).mockResolvedValueOnce(null)

    const { result } = renderHook(() => useLocationStudio("loc-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    let captured: unknown
    await act(async () => {
      try {
        await result.current.approveMainImage("candidate-uuid")
      } catch (e) {
        captured = e
      }
    })
    expect(captured).toBeInstanceOf(ConcurrentModificationError)
  })
})
