import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

// Hoisted mocks — must precede the SUT import.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    saveObject: vi.fn(),
    getObjectById: vi.fn(),
    approveObjectMainImage: vi.fn(),
  }
})

vi.mock("@/hooks/use-auth", () => ({
  getCachedUserId: () => "user-1",
}))

vi.mock("@/hooks/queries/use-invalidate-object", () => ({
  useInvalidateObject: () => vi.fn(),
}))

// Stub the supabase client so the realtime subscription mounted by
// `useObjectStudio` doesn't try to read VITE_SUPABASE_URL at runtime
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
  id: "obj-1",
  type: "object",
  data: {
    label: "Object",
    objectDbId: "",
    objectName: "Vintage Lamp",
    description: "Brass Edison lamp",
    category: "other",
    style: "realistic",
    sourceImageUrl: "",
    projectId: "proj-1",
    angles: [],
    materials: [],
    variations: [],
    motionClips: [],
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

import {
  mergeAssetBucket,
  mergeRealtimeObjectRow,
  useObjectStudio,
} from "../use-object-studio"
import {
  approveObjectMainImage,
  ConcurrentModificationError,
  getObjectById,
  saveObject,
} from "@/lib/api"
import type { ObjectAssetItem, ObjectNodeData, ObjectRealtimeRow } from "@/types/nodes"

describe("useObjectStudio", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNode.data = {
      label: "Object",
      objectDbId: "",
      objectName: "Vintage Lamp",
      description: "Brass Edison lamp",
      category: "other",
      style: "realistic",
      sourceImageUrl: "",
      projectId: "proj-1",
      angles: [],
      materials: [],
      variations: [],
      motionClips: [],
      referencePhotos: [],
      canonicalDescription: "",
      styleLock: false,
    }
  })

  it("seeds stagedData from the canvas node (deep copy)", async () => {
    const { result } = renderHook(() => useObjectStudio("obj-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())
    expect(result.current.stagedData?.objectName).toBe("Vintage Lamp")
    // Mutating the original node data must NOT bleed into staged (deep copy).
    mockNode.data.objectName = "Should not appear"
    expect(result.current.stagedData?.objectName).toBe("Vintage Lamp")
  })

  it("isDirty becomes true after patch and false again after save", async () => {
    vi.mocked(saveObject).mockResolvedValueOnce({ id: "uuid-1", updatedAt: "2026-05-21T10:00:00Z" })
    const { result } = renderHook(() => useObjectStudio("obj-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    expect(result.current.isDirty).toBe(false)
    act(() => {
      result.current.patch({ description: "Worn brass finish" })
    })
    expect(result.current.isDirty).toBe(true)

    await act(async () => {
      await result.current.saveStaged()
    })
    // After save, canvas was synced via updateNodeData so dirty flips back.
    expect(result.current.isDirty).toBe(false)
    expect(updateNodeData).toHaveBeenCalledWith(
      "obj-1",
      expect.objectContaining({ description: "Worn brass finish", objectDbId: "uuid-1" }),
    )
  })

  it("saveStaged calls saveObject with INSERT params when no objectDbId", async () => {
    vi.mocked(saveObject).mockResolvedValueOnce({ id: "new-id", updatedAt: "2026-05-21T11:00:00Z" })
    const { result } = renderHook(() => useObjectStudio("obj-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    await act(async () => {
      await result.current.saveStaged()
    })
    expect(saveObject).toHaveBeenCalledWith(
      expect.objectContaining({
        id: undefined, // empty objectDbId → undefined → INSERT path
        nodeId: "obj-1",
        name: "Vintage Lamp",
      }),
    )
  })

  it("saveStaged is a dumb pass-through — sends all asset bucket columns (motionClips/referencePhotos included)", async () => {
    vi.mocked(saveObject).mockResolvedValueOnce({ id: "uuid-1", updatedAt: "2026-05-21T10:00:00Z" })
    const { result } = renderHook(() => useObjectStudio("obj-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    await act(async () => {
      await result.current.saveStaged()
    })
    const callArgs = vi.mocked(saveObject).mock.calls[0][0]
    // Per Pass 13 F-100 — backend route owns INSERT/UPDATE exclusion;
    // frontend dumb pass-through must include all bucket fields including
    // worker-owned ones.
    expect(callArgs).toHaveProperty("angles")
    expect(callArgs).toHaveProperty("materials")
    expect(callArgs).toHaveProperty("variations")
    expect(callArgs).toHaveProperty("motionClips")
    expect(callArgs).toHaveProperty("referencePhotos")
    expect(callArgs).toHaveProperty("canonicalDescription")
    expect(callArgs).toHaveProperty("styleLock")
  })

  it("ensureSavedBeforeGen auto-saves when objectDbId is empty and returns the new id", async () => {
    vi.mocked(saveObject).mockResolvedValueOnce({ id: "fresh-uuid", updatedAt: "2026-05-21T12:00:00Z" })
    const { result } = renderHook(() => useObjectStudio("obj-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    let returned: string | undefined
    await act(async () => {
      returned = await result.current.ensureSavedBeforeGen()
    })
    expect(returned).toBe("fresh-uuid")
    expect(saveObject).toHaveBeenCalledTimes(1)
  })

  it("ensureSavedBeforeGen short-circuits when objectDbId is already set", async () => {
    mockNode.data.objectDbId = "existing-uuid"
    const { result } = renderHook(() => useObjectStudio("obj-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    let returned: string | undefined
    await act(async () => {
      returned = await result.current.ensureSavedBeforeGen()
    })
    expect(returned).toBe("existing-uuid")
    expect(saveObject).not.toHaveBeenCalled()
  })

  it("on 409 ConcurrentModificationError, re-fetches via getObjectById and re-stages", async () => {
    mockNode.data.objectDbId = "existing-uuid"
    vi.mocked(saveObject).mockRejectedValueOnce(
      new ConcurrentModificationError("Modified concurrently", "2026-05-21T13:00:00Z"),
    )
    vi.mocked(getObjectById).mockResolvedValueOnce({
      id: "existing-uuid",
      userId: "user-1",
      nodeId: "obj-1",
      projectId: "proj-1",
      name: "Vintage Lamp (server-updated)",
      description: "Server-side description",
      category: "other",
      style: "realistic",
      sourceImageUrl: "https://example.com/lamp.png",
      angles: [],
      materials: [],
      variations: [],
      motionClips: [],
      referencePhotos: [],
      canonicalDescription: "Auto-generated description",
      styleLock: false,
      createdAt: "2026-05-21T10:00:00Z",
      updatedAt: "2026-05-21T13:00:00Z",
    })

    const { result } = renderHook(() => useObjectStudio("obj-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    await act(async () => {
      try {
        await result.current.saveStaged()
      } catch {
        /* re-thrown ConcurrentModificationError is expected */
      }
    })

    expect(getObjectById).toHaveBeenCalledWith("existing-uuid")
    expect(result.current.stagedData?.objectName).toBe("Vintage Lamp (server-updated)")
    expect(result.current.stagedData?.canonicalDescription).toBe("Auto-generated description")
  })

  // --------------------------------------------------------------------
  // Pass 11 F-92 — approveMainImage + concurrent-modification recovery
  // --------------------------------------------------------------------

  it("approveMainImage passes expectedUpdatedAt to the API on approve", async () => {
    // Seed the canvas node with an existing DbId + updatedAt so the studio
    // has a non-empty optimistic-concurrency token.
    mockNode.data.objectDbId = "existing-uuid"
    mockNode.data.updatedAt = "2026-05-21T10:00:00Z"
    vi.mocked(approveObjectMainImage).mockResolvedValueOnce({
      sourceImageUrl: "https://example.com/approved.png",
      canonicalDescription: "Auto-generated caption text.",
    })

    const { result } = renderHook(() => useObjectStudio("obj-1"))
    await waitFor(() => expect(result.current.stagedData).not.toBeNull())

    await act(async () => {
      await result.current.approveMainImage("candidate-uuid")
    })

    expect(approveObjectMainImage).toHaveBeenCalledWith(
      "existing-uuid",
      "candidate-uuid",
      "2026-05-21T10:00:00Z",
    )
    // On success the staged data must reflect the new sourceImageUrl +
    // canonicalDescription without a refetch.
    expect(result.current.stagedData?.sourceImageUrl).toBe("https://example.com/approved.png")
    expect(result.current.stagedData?.canonicalDescription).toBe("Auto-generated caption text.")
  })

  it("approveMainImage on 409 refetches via getObjectById and re-stages (mirror of saveStaged 409)", async () => {
    mockNode.data.objectDbId = "existing-uuid"
    mockNode.data.updatedAt = "2026-05-21T09:00:00Z" // stale token
    vi.mocked(approveObjectMainImage).mockRejectedValueOnce(
      new ConcurrentModificationError("Modified concurrently", "2026-05-21T13:00:00Z"),
    )
    vi.mocked(getObjectById).mockResolvedValueOnce({
      id: "existing-uuid",
      userId: "user-1",
      nodeId: "obj-1",
      projectId: "proj-1",
      name: "Vintage Lamp (winner)",
      description: "Server-side description",
      category: "other",
      style: "realistic",
      sourceImageUrl: "https://example.com/the-winner.png",
      angles: [],
      materials: [],
      variations: [],
      motionClips: [],
      referencePhotos: [],
      canonicalDescription: "Description from the winning approver.",
      styleLock: false,
      createdAt: "2026-05-21T10:00:00Z",
      updatedAt: "2026-05-21T13:00:00Z",
    })

    const { result } = renderHook(() => useObjectStudio("obj-1"))
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
    expect(getObjectById).toHaveBeenCalledWith("existing-uuid")
    expect(result.current.stagedData?.sourceImageUrl).toBe("https://example.com/the-winner.png")
    expect(result.current.stagedData?.canonicalDescription).toBe(
      "Description from the winning approver.",
    )
    expect(result.current.stagedData?.updatedAt).toBe("2026-05-21T13:00:00Z")
  })

  it("approveMainImage re-throws ConcurrentModificationError so the caller can react", async () => {
    mockNode.data.objectDbId = "existing-uuid"
    mockNode.data.updatedAt = "2026-05-21T09:00:00Z"
    vi.mocked(approveObjectMainImage).mockRejectedValueOnce(
      new ConcurrentModificationError("Modified concurrently", "2026-05-21T13:00:00Z"),
    )
    // The refetch is a no-op for this test — only the re-throw matters.
    vi.mocked(getObjectById).mockResolvedValueOnce(null)

    const { result } = renderHook(() => useObjectStudio("obj-1"))
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

// ---------------------------------------------------------------------------
// Pure helper tests — mergeAssetBucket + mergeRealtimeObjectRow
// ---------------------------------------------------------------------------

describe("mergeAssetBucket", () => {
  it("returns 'unchanged' when incoming is not an array", () => {
    const staged: ObjectAssetItem[] = [{ name: "a", url: "https://a.com" }]
    expect(mergeAssetBucket(staged, null)).toBe("unchanged")
    expect(mergeAssetBucket(staged, undefined)).toBe("unchanged")
    expect(mergeAssetBucket(staged, "not-an-array")).toBe("unchanged")
    expect(mergeAssetBucket(staged, 42)).toBe("unchanged")
  })

  it("returns 'unchanged' when all incoming URLs are already in staged (dedup)", () => {
    const staged: ObjectAssetItem[] = [
      { name: "a", url: "https://a.com" },
      { name: "b", url: "https://b.com" },
    ]
    const result = mergeAssetBucket(staged, [
      { name: "a-renamed", url: "https://a.com" }, // same url; should be ignored
      { name: "b-renamed", url: "https://b.com" }, // same url; should be ignored
    ])
    expect(result).toBe("unchanged")
  })

  it("appends new entries with URLs not in staged", () => {
    const staged: ObjectAssetItem[] = [{ name: "a", url: "https://a.com" }]
    const result = mergeAssetBucket(staged, [
      { name: "a-renamed", url: "https://a.com" }, // dedupe
      { name: "c", url: "https://c.com" }, // new
    ])
    expect(result).toEqual([
      { name: "a", url: "https://a.com" }, // existing preserved (NOT renamed)
      { name: "c", url: "https://c.com" }, // new appended
    ])
  })

  it("handles undefined staged (treats as empty)", () => {
    const result = mergeAssetBucket(undefined, [{ name: "x", url: "https://x.com" }])
    expect(result).toEqual([{ name: "x", url: "https://x.com" }])
  })

  it("skips non-asset-like entries (no url field, or url not a string)", () => {
    const staged: ObjectAssetItem[] = []
    const result = mergeAssetBucket(staged, [
      { name: "missing-url" },
      { name: "bad-url", url: 42 },
      null,
      "string",
      { name: "good", url: "https://good.com" },
    ])
    expect(result).toEqual([{ name: "good", url: "https://good.com" }])
  })
})

describe("mergeRealtimeObjectRow", () => {
  const baseStaged: ObjectNodeData = {
    label: "Object",
    objectDbId: "obj-1",
    objectName: "Vintage Lamp",
    description: "Brass Edison lamp",
    category: "other",
    style: "realistic",
    sourceImageUrl: "",
    projectId: "proj-1",
    createdAt: "2026-05-21T10:00:00Z",
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    angles: [],
    materials: [],
    variations: [],
    anglesStatus: "idle",
    materialsStatus: "idle",
    variationsStatus: "idle",
    customVariations: [],
    motionClips: [],
    motionStatus: "idle",
    referencePhotos: [],
    canonicalDescription: "",
    styleLock: false,
    updatedAt: "2026-05-21T10:00:00Z",
  }

  const baseRow: ObjectRealtimeRow = {
    id: "obj-1",
    user_id: "user-1",
    project_id: "proj-1",
    node_id: "obj-1",
    name: null,
    description: null,
    category: null,
    style: null,
    source_image_url: null,
    canonical_description: null,
    style_lock: null,
    angles: null,
    materials: null,
    variations: null,
    motion_clips: null,
    reference_photos: null,
    updated_at: null,
  }

  it("returns the same staged reference when nothing changes", () => {
    const result = mergeRealtimeObjectRow(baseStaged, baseRow, false)
    expect(result).toBe(baseStaged)
  })

  it("appends to asset buckets unconditionally (dirty=true still merges buckets)", () => {
    const row: ObjectRealtimeRow = {
      ...baseRow,
      angles: [{ name: "front", url: "https://angles/front.png" }],
      materials: [{ name: "wood", url: "https://materials/wood.png" }],
      variations: [{ name: "v1", url: "https://variations/v1.png" }],
      motion_clips: [{ name: "spin", url: "https://motion/spin.mp4" }],
      reference_photos: [{ kind: "front", url: "https://ref/front.jpg" }],
    }
    const result = mergeRealtimeObjectRow(baseStaged, row, /* dirty */ true)
    expect(result).not.toBe(baseStaged)
    expect(result.angles).toHaveLength(1)
    expect(result.materials).toHaveLength(1)
    expect(result.variations).toHaveLength(1)
    expect(result.motionClips).toHaveLength(1)
    expect(result.referencePhotos).toHaveLength(1)
  })

  it("adopts identity fields ONLY when !dirty", () => {
    const row: ObjectRealtimeRow = {
      ...baseRow,
      name: "Vintage Lamp (server-edited)",
      description: "Server-edited description",
      canonical_description: "Server canonical desc",
      source_image_url: "https://server/img.png",
      category: "electronics",
      style: "anime",
      style_lock: true,
    }
    // dirty=true → identity fields NOT adopted (user has unsaved edits)
    const dirtyResult = mergeRealtimeObjectRow(baseStaged, row, true)
    expect(dirtyResult.objectName).toBe("Vintage Lamp") // preserved local
    expect(dirtyResult.description).toBe("Brass Edison lamp") // preserved local
    expect(dirtyResult.category).toBe("other") // preserved local

    // dirty=false → identity fields ARE adopted
    const cleanResult = mergeRealtimeObjectRow(baseStaged, row, false)
    expect(cleanResult.objectName).toBe("Vintage Lamp (server-edited)")
    expect(cleanResult.description).toBe("Server-edited description")
    expect(cleanResult.canonicalDescription).toBe("Server canonical desc")
    expect(cleanResult.sourceImageUrl).toBe("https://server/img.png")
    expect(cleanResult.category).toBe("electronics")
    expect(cleanResult.style).toBe("anime")
    expect(cleanResult.styleLock).toBe(true)
  })

  it("ALWAYS adopts updatedAt (token freshness), regardless of dirty flag", () => {
    const row: ObjectRealtimeRow = { ...baseRow, updated_at: "2026-05-21T13:00:00Z" }
    const dirtyResult = mergeRealtimeObjectRow(baseStaged, row, true)
    expect(dirtyResult.updatedAt).toBe("2026-05-21T13:00:00Z")
    const cleanResult = mergeRealtimeObjectRow(baseStaged, row, false)
    expect(cleanResult.updatedAt).toBe("2026-05-21T13:00:00Z")
  })

  it("preserves existing asset entries by URL when bucket has new + old", () => {
    const stagedWithAssets: ObjectNodeData = {
      ...baseStaged,
      angles: [{ name: "existing", url: "https://angles/existing.png" }],
    }
    const row: ObjectRealtimeRow = {
      ...baseRow,
      angles: [
        { name: "existing-renamed-by-server", url: "https://angles/existing.png" }, // dedupe
        { name: "new", url: "https://angles/new.png" }, // append
      ],
    }
    const result = mergeRealtimeObjectRow(stagedWithAssets, row, false)
    expect(result.angles).toEqual([
      { name: "existing", url: "https://angles/existing.png" }, // preserved local name
      { name: "new", url: "https://angles/new.png" },
    ])
  })

  it("snake-case row column → camelCase staged field mapping (motion_clips → motionClips, reference_photos → referencePhotos)", () => {
    // Regression: easy mistake to merge row.motionClips (which doesn't exist) instead of row.motion_clips
    const row: ObjectRealtimeRow = {
      ...baseRow,
      motion_clips: [{ name: "spin", url: "https://motion/spin.mp4" }],
      reference_photos: [{ kind: "side", url: "https://ref/side.jpg" }],
    }
    const result = mergeRealtimeObjectRow(baseStaged, row, false)
    expect(result.motionClips).toEqual([{ name: "spin", url: "https://motion/spin.mp4" }])
    expect(result.referencePhotos).toEqual([{ kind: "side", url: "https://ref/side.jpg" }])
  })
})
