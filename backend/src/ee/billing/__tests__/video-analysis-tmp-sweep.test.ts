import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — the sweep only touches R2 through two storage helpers; everything
// else pulled in by cleanup-service.ts is stubbed so the module loads in
// isolation (mirrors the mock surface of cleanup-service.test.ts).
// ---------------------------------------------------------------------------

const { mockList, mockDelete } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockDelete: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/storage.js", () => ({
  listObjectsByPrefixWithMeta: mockList,
  deleteFromR2: mockDelete,
  batchDeleteFromR2: vi.fn().mockResolvedValue({ deleted: 0, errors: 0 }),
  uploadBufferToR2: vi.fn().mockResolvedValue("https://cdn.example.com/x"),
  readR2ObjectBuffer: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() }, rpc: vi.fn() },
}))

vi.mock("@/lib/config.js", () => ({
  config: { R2_PUBLIC_URL: "https://cdn.example.com", R2_BUCKET_NAME: "test-bucket" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/utils/file-validation.js", () => ({ updateStorageUsage: vi.fn() }))
vi.mock("@/ee/billing/stripe-config.js", () => ({
  TIER_STORAGE_LIMITS: { free: 1073741824 },
  TIER_CREDITS: { free: 150 },
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: vi.fn() } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered). The prefix constant
// is the REAL one from the worker's state module — the test proves the reaper
// scopes to the exact same `video-analysis-tmp/` the worker writes under.
// ---------------------------------------------------------------------------

import { sweepVideoAnalysisTmp } from "../cleanup-service.js"
import { VIDEO_ANALYSIS_TMP_PREFIX } from "@/workers/handlers/video-analysis-state.js"

const PREFIX = `${VIDEO_ANALYSIS_TMP_PREFIX}/`

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000)
}

beforeEach(() => {
  mockList.mockReset()
  mockDelete.mockReset().mockResolvedValue(undefined)
})

describe("sweepVideoAnalysisTmp", () => {
  it("lists the video-analysis-tmp/ prefix and deletes ONLY objects older than maxAgeHours", async () => {
    mockList.mockResolvedValue([
      { key: `${PREFIX}job-old/source.mp4`, lastModified: hoursAgo(30) },
      { key: `${PREFIX}job-fresh/source.mp4`, lastModified: hoursAgo(1) },
    ])

    const result = await sweepVideoAnalysisTmp(24)

    expect(mockList).toHaveBeenCalledWith(PREFIX)
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockDelete).toHaveBeenCalledWith(`${PREFIX}job-old/source.mp4`)
    expect(mockDelete).not.toHaveBeenCalledWith(`${PREFIX}job-fresh/source.mp4`)
    expect(result).toMatchObject({ deleted: 1, failed: 0 })
  })

  it("does not throw when a delete rejects — the failure is captured and counted", async () => {
    mockList.mockResolvedValue([
      { key: `${PREFIX}job-old/source.mp4`, lastModified: hoursAgo(48) },
    ])
    mockDelete.mockRejectedValueOnce(new Error("R2 500"))

    const result = await sweepVideoAnalysisTmp(24)

    expect(result).toMatchObject({ deleted: 0, failed: 1 })
  })

  it("NEVER deletes a key outside the prefix, even when it is old (structural guard)", async () => {
    // A real-output key mis-appearing in the listing must never reach a delete.
    // The prefix assertion is the last line of defense against touching videos/.
    mockList.mockResolvedValue([
      { key: "videos/real-output.mp4", lastModified: hoursAgo(999) },
      { key: `${PREFIX}job-old/state.json`, lastModified: hoursAgo(30) },
    ])

    const result = await sweepVideoAnalysisTmp(24)

    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockDelete).toHaveBeenCalledWith(`${PREFIX}job-old/state.json`)
    expect(mockDelete).not.toHaveBeenCalledWith("videos/real-output.mp4")
    expect(result).toMatchObject({ deleted: 1, skippedOutOfPrefix: 1 })
  })

  it("leaves objects with no LastModified untouched (cannot prove age → must not reap a live checkpoint)", async () => {
    mockList.mockResolvedValue([
      { key: `${PREFIX}job-x/source.mp4`, lastModified: undefined },
    ])

    const result = await sweepVideoAnalysisTmp(24)

    expect(mockDelete).not.toHaveBeenCalled()
    expect(result).toMatchObject({ deleted: 0, failed: 0 })
  })

  it("swallows a listing failure and reports it as a failure rather than throwing", async () => {
    mockList.mockRejectedValueOnce(new Error("R2 list unavailable"))

    const result = await sweepVideoAnalysisTmp(24)

    expect(mockDelete).not.toHaveBeenCalled()
    expect(result.failed).toBeGreaterThanOrEqual(1)
  })
})
