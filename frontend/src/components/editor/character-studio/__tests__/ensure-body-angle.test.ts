import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the api module BEFORE importing the unit under test so the hoisted
// vi.mock body wins. We mock the workspace package `@/lib/api` via vitest's
// auto-mock + manual override below.
vi.mock("@/lib/api", () => ({
  generateCharacterAsset: vi.fn(),
}))

import { ensureBodyAngleForMotion } from "../ensure-body-angle"
import { generateCharacterAsset } from "@/lib/api"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import type { CharacterNodeData } from "@/types/nodes"

// ─────────────────────────────────────────────────────────────────────────
// Fixtures: minimal but type-faithful CharacterStudioState + CharacterStudioJobs
// shims. We only exercise the surface that ensureBodyAngleForMotion reads.
// ─────────────────────────────────────────────────────────────────────────

function makeStaged(overrides: Partial<CharacterNodeData> = {}): CharacterNodeData {
  return {
    label: "Character",
    characterDbId: "char-uuid",
    characterName: "Kira",
    description: "tall woman",
    sourceImageUrl: "https://example.com/portrait.png",
    gender: "female",
    style: "realistic",
    baseOutfit: "blue jacket",
    characterSheet: null,
    projectId: "proj-uuid",
    createdAt: new Date().toISOString(),
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    expressionSheet: "",
    poseSheet: "",
    lightingSheet: "",
    anglesSheet: "",
    expressions: [],
    poses: [],
    lightingVariations: [],
    angles: [],
    bodyAngles: [],
    expressionStatus: "idle",
    poseStatus: "idle",
    lightingStatus: "idle",
    anglesStatus: "idle",
    bodyAnglesStatus: "idle",
    customVariations: [],
    motions: [],
    motionStatus: "idle",
    voice: null,
    personality: null,
    ...overrides,
  } as CharacterNodeData
}

function makeState(stagedOverrides: Partial<CharacterNodeData> = {}): CharacterStudioState {
  return {
    nodeId: "node-1",
    staged: makeStaged(stagedOverrides),
    saveStatus: "idle",
    initialPendingJobs: null,
    initialPortraitCandidates: [],
    initialPreviousCandidates: [],
    patch: vi.fn(),
    ensureSaved: vi.fn().mockResolvedValue("char-uuid"),
  }
}

function makeJobs(overrides: Partial<CharacterStudioJobs> = {}): CharacterStudioJobs {
  return {
    pending: new Map(),
    track: vi.fn(),
    trackAndWait: vi.fn().mockResolvedValue("https://example.com/body-front.png"),
    cancel: vi.fn(),
    runningTypes: vi.fn().mockReturnValue(new Set()),
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe("ensureBodyAngleForMotion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns null and skips generation when the character already has a body angle (any name)", async () => {
    const state = makeState({
      bodyAngles: [{ name: "back", url: "https://example.com/body-back.png" }],
    })
    const jobs = makeJobs()

    const result = await ensureBodyAngleForMotion({
      state,
      jobs,
      characterId: "char-uuid",
      provider: "nano-banana-pro",
    })

    expect(result).toBeNull()
    expect(generateCharacterAsset).not.toHaveBeenCalled()
    expect(jobs.trackAndWait).not.toHaveBeenCalled()
  })

  it("returns null when bodyAngles already has a 'front' entry (no duplicate gen)", async () => {
    const state = makeState({
      bodyAngles: [
        { name: "front", url: "https://example.com/body-front.png" },
        { name: "back", url: "https://example.com/body-back.png" },
      ],
    })
    const jobs = makeJobs()

    const result = await ensureBodyAngleForMotion({
      state,
      jobs,
      characterId: "char-uuid",
      provider: "nano-banana-pro",
    })

    expect(result).toBeNull()
    expect(generateCharacterAsset).not.toHaveBeenCalled()
  })

  it("generates a front body angle and returns its URL when bodyAngles is empty", async () => {
    const state = makeState({ bodyAngles: [] })
    const jobs = makeJobs()
    vi.mocked(generateCharacterAsset).mockResolvedValueOnce({ jobId: "body-job-1" })
    vi.mocked(jobs.trackAndWait).mockResolvedValueOnce("https://example.com/body-front.png")

    const result = await ensureBodyAngleForMotion({
      state,
      jobs,
      characterId: "char-uuid",
      provider: "nano-banana-pro",
    })

    expect(result).toBe("https://example.com/body-front.png")
    expect(generateCharacterAsset).toHaveBeenCalledTimes(1)
    // Verify the request shape — must target body_angles column with the canonical "front" variant.
    expect(generateCharacterAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        assetType: "bodyAngles",
        variant: "front",
        attachToColumn: "body_angles",
        attachName: "front",
        attachToCharacterId: "char-uuid",
        provider: "nano-banana-pro",
        sourceImageUrl: "https://example.com/portrait.png",
        name: "Kira",
      }),
    )
    expect(jobs.trackAndWait).toHaveBeenCalledWith("body-job-1", "bodyAngles", "front")
  })

  it("forwards characterNodeAspectRatio so the generated body angle matches the canvas ratio", async () => {
    const state = makeState({
      bodyAngles: [],
      defaultAssetAspectRatio: "16:9" as const,
    })
    const jobs = makeJobs()
    vi.mocked(generateCharacterAsset).mockResolvedValueOnce({ jobId: "body-job-2" })

    await ensureBodyAngleForMotion({
      state,
      jobs,
      characterId: "char-uuid",
      provider: "nano-banana-pro",
    })

    expect(generateCharacterAsset).toHaveBeenCalledWith(
      expect.objectContaining({ characterNodeAspectRatio: "16:9" }),
    )
  })

  it("rethrows when generateCharacterAsset fails (motion gen must not proceed)", async () => {
    const state = makeState({ bodyAngles: [] })
    const jobs = makeJobs()
    vi.mocked(generateCharacterAsset).mockRejectedValueOnce(new Error("API down"))

    await expect(
      ensureBodyAngleForMotion({
        state,
        jobs,
        characterId: "char-uuid",
        provider: "nano-banana-pro",
      }),
    ).rejects.toThrow("API down")
    expect(jobs.trackAndWait).not.toHaveBeenCalled()
  })

  it("rethrows when trackAndWait rejects (job failed / cancelled / studio closed)", async () => {
    const state = makeState({ bodyAngles: [] })
    const jobs = makeJobs()
    vi.mocked(generateCharacterAsset).mockResolvedValueOnce({ jobId: "body-job-3" })
    vi.mocked(jobs.trackAndWait).mockRejectedValueOnce(new Error("Job failed: provider error"))

    await expect(
      ensureBodyAngleForMotion({
        state,
        jobs,
        characterId: "char-uuid",
        provider: "nano-banana-pro",
      }),
    ).rejects.toThrow("Job failed: provider error")
  })

  it("omits sourceImageUrl when the staged portrait is empty (avoids sending an empty string)", async () => {
    const state = makeState({ bodyAngles: [], sourceImageUrl: "" })
    const jobs = makeJobs()
    vi.mocked(generateCharacterAsset).mockResolvedValueOnce({ jobId: "body-job-4" })

    await ensureBodyAngleForMotion({
      state,
      jobs,
      characterId: "char-uuid",
      provider: "nano-banana-pro",
    })

    const call = vi.mocked(generateCharacterAsset).mock.calls[0][0]
    expect(call.sourceImageUrl).toBeUndefined()
  })
})
