import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useLocationDataSubscription } from "../use-location-data-subscription"
import { useWorkflowStore } from "../use-workflow-store"
import { getLocationById, type DbLocation } from "@/lib/api"
import type { LocationNodeData } from "@/types/nodes"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/api", () => ({
  getLocationById: vi.fn(),
}))

vi.mock("../use-workflow-store", () => {
  const state = {
    locationStudioNodeId: null as string | null,
    updateNodeData: vi.fn(),
  }
  const store = ((selector: (s: typeof state) => unknown) =>
    selector(state)) as unknown as typeof useWorkflowStore
  ;(store as unknown as { __setStudioOpen: (id: string | null) => void }).__setStudioOpen = (id) => {
    state.locationStudioNodeId = id
  }
  ;(store as unknown as { __reset: () => void }).__reset = () => {
    state.locationStudioNodeId = null
    state.updateNodeData.mockReset()
  }
  ;(store as unknown as { __updateNodeData: ReturnType<typeof vi.fn> }).__updateNodeData =
    state.updateNodeData
  return { useWorkflowStore: store }
})

const __store = useWorkflowStore as unknown as {
  __setStudioOpen: (id: string | null) => void
  __reset: () => void
  __updateNodeData: ReturnType<typeof vi.fn>
}

const mockGetLocation = vi.mocked(getLocationById)

beforeEach(() => {
  __store.__reset()
  mockGetLocation.mockReset()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DB_LOC: DbLocation = {
  id: "loc-1",
  userId: "u-1",
  nodeId: "n-1",
  projectId: null,
  name: "Forest",
  description: null,
  category: "outdoor",
  style: "realistic",
  sourceImageUrl: "https://r2/main.png",
  timeOfDay: [{ name: "noon", url: "https://r2/tod-noon.png" }],
  weather: [],
  angles: [],
  lighting: [],
  seasons: [],
  atmosphereMotions: [{ name: "drift", url: "https://r2/motion-drift.mp4" }],
  referencePhotos: [],
  canonicalDescription: "A dense forest",
  styleLock: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  pendingJobs: [],
}

const NODE_DATA = {
  locationDbId: "loc-1",
  locationName: "Forest",
  generatedResults: [],
  // status fields are all undefined / idle by default
} as unknown as LocationNodeData

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLocationDataSubscription", () => {
  it("polls and patches node.data when anyAssetRunning + locationDbId + studio closed", async () => {
    mockGetLocation.mockResolvedValue(DB_LOC)

    renderHook(() =>
      useLocationDataSubscription({
        nodeId: "n-1",
        locationDbId: "loc-1",
        anyAssetRunning: true,
        currentNodeData: { ...NODE_DATA, atmosphereStatus: "running" },
      }),
    )

    // First tick fires immediately on mount.
    await waitFor(() => expect(mockGetLocation).toHaveBeenCalledWith("loc-1"))
    await waitFor(() =>
      expect(__store.__updateNodeData).toHaveBeenCalledWith(
        "n-1",
        expect.objectContaining({
          timeOfDay: DB_LOC.timeOfDay,
          atmosphereMotions: DB_LOC.atmosphereMotions,
        }),
      ),
    )
  })

  it("does NOT poll when locationDbId is undefined", async () => {
    renderHook(() =>
      useLocationDataSubscription({
        nodeId: "n-1",
        locationDbId: undefined,
        anyAssetRunning: true,
        currentNodeData: NODE_DATA,
      }),
    )

    await new Promise((r) => setTimeout(r, 50))
    expect(mockGetLocation).not.toHaveBeenCalled()
  })

  it("does NOT poll when anyAssetRunning is false", async () => {
    renderHook(() =>
      useLocationDataSubscription({
        nodeId: "n-1",
        locationDbId: "loc-1",
        anyAssetRunning: false,
        currentNodeData: NODE_DATA,
      }),
    )

    await new Promise((r) => setTimeout(r, 50))
    expect(mockGetLocation).not.toHaveBeenCalled()
  })

  it("does NOT poll when the studio is open for this node (avoid double-poll with useLocationStudioJobs)", async () => {
    __store.__setStudioOpen("n-1")
    renderHook(() =>
      useLocationDataSubscription({
        nodeId: "n-1",
        locationDbId: "loc-1",
        anyAssetRunning: true,
        currentNodeData: { ...NODE_DATA, atmosphereStatus: "running" },
      }),
    )

    await new Promise((r) => setTimeout(r, 50))
    expect(mockGetLocation).not.toHaveBeenCalled()
  })

  it("clears `*Status` to 'idle' when no matching pendingJobs remain for that bucket", async () => {
    mockGetLocation.mockResolvedValue({
      ...DB_LOC,
      pendingJobs: [
        // weather still in flight, atmosphere drained
        { jobId: "j-2", assetType: "weather", name: "rain", status: "pending" },
      ],
    })

    renderHook(() =>
      useLocationDataSubscription({
        nodeId: "n-1",
        locationDbId: "loc-1",
        anyAssetRunning: true,
        currentNodeData: {
          ...NODE_DATA,
          atmosphereStatus: "running", // should clear (no pending jobs)
          weatherStatus: "running",    // should NOT clear (pending job exists)
        },
      }),
    )

    await waitFor(() => {
      expect(__store.__updateNodeData).toHaveBeenCalled()
    })
    const lastCall = __store.__updateNodeData.mock.calls.at(-1)!
    const patch = lastCall[1] as Partial<LocationNodeData>
    expect(patch.atmosphereStatus).toBe("idle")
    // weatherStatus should NOT be set in the patch (preserved because still pending)
    expect(patch.weatherStatus).toBeUndefined()
  })

  it("treats both 'atmosphere_motions' and 'motion' assetType strings as the atmosphere bucket", async () => {
    mockGetLocation.mockResolvedValue({
      ...DB_LOC,
      pendingJobs: [
        { jobId: "j-1", assetType: "motion", name: "drift", status: "pending" },
      ],
    })

    renderHook(() =>
      useLocationDataSubscription({
        nodeId: "n-1",
        locationDbId: "loc-1",
        anyAssetRunning: true,
        currentNodeData: { ...NODE_DATA, atmosphereStatus: "running" },
      }),
    )

    await waitFor(() => expect(__store.__updateNodeData).toHaveBeenCalled())
    const patch = __store.__updateNodeData.mock.calls.at(-1)![1] as Partial<LocationNodeData>
    // atmosphere job still pending under the "motion" alias → don't clear
    expect(patch.atmosphereStatus).toBeUndefined()
  })

  it("swallows transient fetch errors", async () => {
    mockGetLocation.mockRejectedValue(new Error("network down"))

    const { unmount } = renderHook(() =>
      useLocationDataSubscription({
        nodeId: "n-1",
        locationDbId: "loc-1",
        anyAssetRunning: true,
        currentNodeData: { ...NODE_DATA, atmosphereStatus: "running" },
      }),
    )

    // The initial tick fires immediately; let it reject + resolve.
    await new Promise((r) => setTimeout(r, 50))
    expect(__store.__updateNodeData).not.toHaveBeenCalled()
    unmount()
  })
})
