/**
 * THE regression this file exists for (production, 2026-09-03 + 2026-09-07).
 *
 * A worker dies after the provider task is created. The reconcile cron polls
 * the task, KIE hands back the FINISHED image — and the reconciler threw it
 * away, bumped `reconcile_attempts`, and ~90 minutes later force-failed the job
 * and refunded the user. We had already paid the provider and the asset never
 * reached the studio. Nine rows in two bursts, all `generate-object-asset` /
 * `generate-character`, all `reconcile_attempts: 18`,
 * `reconcile_last_error: "exhausted"`.
 *
 * Every case below drives the REAL `reconcileKieJob` → `recoverEntityJob` →
 * `finalizeEntityJob` path with only the leaves stubbed, so the assertion
 * "completes with the asset, commits the credits, refunds nothing" is about the
 * shipped code and not a re-implementation of it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  pollKieTaskMock: vi.fn(),
  bumpMock: vi.fn().mockResolvedValue(undefined),
  refundMock: vi.fn().mockResolvedValue(undefined),
  markJobFailedMock: vi.fn().mockResolvedValue(true),

  claimMock: vi.fn().mockResolvedValue({ won: true, ts: "2026-09-15T00:00:00Z" }),
  releaseClaimMock: vi.fn().mockResolvedValue(undefined),
  loadUsageLogIdMock: vi.fn().mockResolvedValue("ul-1"),

  uploadImageMock: vi.fn().mockResolvedValue("https://r2/images/j-1.png"),
  uploadVideoMock: vi.fn().mockResolvedValue("https://r2/videos/j-1.mp4"),
  shouldSaveMock: vi.fn().mockResolvedValue(true),
  markJobCompletedMock: vi.fn().mockResolvedValue(true),
  commitCreditsMock: vi.fn().mockResolvedValue(undefined),

  setCharacterPortraitMock: vi.fn().mockResolvedValue(undefined),
  attachAssetToCharacterMock: vi.fn().mockResolvedValue(undefined),
  autoAttachLocationAssetMock: vi.fn().mockResolvedValue(undefined),
  autoAttachObjectAssetMock: vi.fn().mockResolvedValue(undefined),
  setObjectMainImageMock: vi.fn().mockResolvedValue(undefined),
  autoAttachCreatureAssetMock: vi.fn().mockResolvedValue(undefined),
  setCreatureMainImageMock: vi.fn().mockResolvedValue(undefined),

  jobRow: { data: null as Record<string, unknown> | null },
}))

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: mocks.jobRow.data, error: null })) })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
    })),
  },
}))
vi.mock("../../config.js", () => ({ hasCredits: () => true, config: {} }))
vi.mock("../../job-failure.js", () => ({ markJobFailed: mocks.markJobFailedMock }))
vi.mock("../../storage.js", () => ({ uploadToR2: vi.fn() }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundMock }))
vi.mock("../bump-attempts.js", () => ({ bumpAttemptsOrExhaust: mocks.bumpMock }))

// job-finalize: keep the REAL denylist/type guards (the lane under test is
// "entity types are handled BEFORE that denylist"), stub only the claim + the
// usage-log lookup, which are DB round-trips.
vi.mock("../../job-finalize.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../job-finalize.js")>()
  return {
    ...actual,
    claimJobFinalize: mocks.claimMock,
    releaseJobFinalizeClaim: mocks.releaseClaimMock,
    loadUsageLogId: mocks.loadUsageLogIdMock,
    finalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }),
  }
})

vi.mock("../../../workers/shared.js", () => ({
  uploadImageMaybeWatermark: mocks.uploadImageMock,
  uploadVideoMaybeWatermark: mocks.uploadVideoMock,
  shouldSaveJobResult: mocks.shouldSaveMock,
  markJobCompleted: mocks.markJobCompletedMock,
  commitJobCredits: mocks.commitCreditsMock,
}))

vi.mock("../../character-auto-attach.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../character-auto-attach.js")>()
  return {
    ...actual,
    setCharacterPortrait: mocks.setCharacterPortraitMock,
    attachAssetToCharacter: mocks.attachAssetToCharacterMock,
  }
})
vi.mock("../../location-auto-attach.js", () => ({
  autoAttachLocationAsset: mocks.autoAttachLocationAssetMock,
}))
vi.mock("../../object-auto-attach.js", () => ({
  autoAttachObjectAsset: mocks.autoAttachObjectAssetMock,
  setObjectMainImage: mocks.setObjectMainImageMock,
}))
vi.mock("../../creature-auto-attach.js", () => ({
  autoAttachCreatureAsset: mocks.autoAttachCreatureAssetMock,
  setCreatureMainImage: mocks.setCreatureMainImageMock,
}))

// Provider poll clients — only kie-standard is exercised; the rest exist so
// kie.ts's import graph resolves without touching config/network.
vi.mock("../../../providers/kie/client.js", () => ({
  pollKieTask: mocks.pollKieTaskMock,
  pollVeoTask: vi.fn(),
  runVeo1080pTask: vi.fn(),
  isUpstreamKieFailure: (e: unknown) => (e as { isUpstreamFailure?: boolean })?.isUpstreamFailure === true,
}))
vi.mock("../../../providers/kie/kling3-client.js", () => ({ pollKling3Task: vi.fn() }))
vi.mock("../../../providers/kie/kontext-client.js", () => ({ pollKontextTask: vi.fn() }))
vi.mock("../../../providers/kie/luma-client.js", () => ({ pollLumaTask: vi.fn() }))
vi.mock("../../../providers/kie/runway-client.js", () => ({ pollRunwayTask: vi.fn(), pollAlephTask: vi.fn() }))
vi.mock("../../../providers/kie/suno-client.js", () => ({ pollSunoTask: vi.fn() }))

import { reconcileKieJob, type KieJobRow } from "../kie.js"

const CHARACTER_ID = "11111111-1111-4111-8111-111111111111"
const OBJECT_ID = "22222222-2222-4222-8222-222222222222"

/** A stuck row exactly as the cron reads it: the provider task exists (the
 *  worker got that far), nothing was ever written back. */
const row = (over: Partial<KieJobRow> = {}): KieJobRow => ({
  id: "j-1",
  provider_kind: "kie-standard",
  provider_task_id: "task-abc",
  reconcile_attempts: 3,
  job_type: "generate-character",
  ...over,
})

/** The persisted request body — the ONLY thing that survives the worker's
 *  death, and therefore the only source of the attach spec. */
const jobRowWith = (inputData: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  user_id: "u-1",
  should_watermark: false,
  status: "processing",
  input_data: inputData,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.claimMock.mockResolvedValue({ won: true, ts: "2026-09-15T00:00:00Z" })
  mocks.loadUsageLogIdMock.mockResolvedValue("ul-1")
  mocks.shouldSaveMock.mockResolvedValue(true)
  mocks.markJobCompletedMock.mockResolvedValue(true)
  mocks.uploadImageMock.mockResolvedValue("https://r2/images/j-1.png")
  mocks.uploadVideoMock.mockResolvedValue("https://r2/videos/j-1.mp4")
  mocks.pollKieTaskMock.mockResolvedValue({
    resultJson: { resultUrls: ["https://kie/result.png"] },
    providerMs: 4200,
  })
})

describe("reconcile recovers a FINISHED entity generation instead of refunding it", () => {
  it("completes a generate-character job and attaches the portrait — no bump, no refund", async () => {
    mocks.jobRow.data = jobRowWith({
      type: "generate-character",
      attachToCharacterId: CHARACTER_ID,
      provider: "nano-banana",
    })

    await reconcileKieJob(row())

    // The provider's image is ingested and the job completes with it.
    expect(mocks.uploadImageMock).toHaveBeenCalledWith(
      "https://kie/result.png", "j-1", "u-1", false,
    )
    expect(mocks.markJobCompletedMock).toHaveBeenCalledWith("j-1", {
      output_data: { imageUrl: "https://r2/images/j-1.png" },
    })
    // Credits settle at the reservation (post-reconcile cost is unknown).
    expect(mocks.commitCreditsMock).toHaveBeenCalledWith("ul-1", "j-1", null)
    // The studio row gets the result — the write generic finalize never makes.
    expect(mocks.setCharacterPortraitMock).toHaveBeenCalledWith({
      characterId: CHARACTER_ID, userId: "u-1", url: "https://r2/images/j-1.png",
    })
    // THE regression: neither of these may fire on a recovered success.
    expect(mocks.bumpMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
    expect(mocks.markJobFailedMock).not.toHaveBeenCalled()
  })

  it("completes a generate-object-asset job, carrying assetType into output_data", async () => {
    mocks.jobRow.data = jobRowWith({
      type: "generate-object-asset",
      attachToObjectId: OBJECT_ID,
      attachToColumn: "angles",
      attachName: "three-quarter",
      assetType: "angles",
    })

    await reconcileKieJob(row({ job_type: "generate-object-asset" }))

    expect(mocks.markJobCompletedMock).toHaveBeenCalledWith("j-1", {
      output_data: { imageUrl: "https://r2/images/j-1.png", assetType: "angles" },
    })
    expect(mocks.autoAttachObjectAssetMock).toHaveBeenCalledWith({
      objectId: OBJECT_ID,
      column: "angles",
      name: "three-quarter",
      userId: "u-1",
      url: "https://r2/images/j-1.png",
    })
    expect(mocks.setObjectMainImageMock).not.toHaveBeenCalled()
    expect(mocks.bumpMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("recovers a motion clip to the column the ROUTE never persisted", async () => {
    // `attachToColumn` for the motion lanes is the job type's own constant, so
    // input_data carries none — and the recovered clip still lands in
    // characters.motions. Before the shared table, this was unreachable.
    mocks.jobRow.data = jobRowWith({
      type: "generate-character-motion",
      attachToCharacterId: CHARACTER_ID,
      attachName: "walk cycle",
      motionDescription: "steady walk",
    })

    await reconcileKieJob(row({ job_type: "generate-character-motion" }))

    expect(mocks.uploadVideoMock).toHaveBeenCalledWith(
      "https://kie/result.png", "j-1", "u-1", false,
    )
    expect(mocks.markJobCompletedMock).toHaveBeenCalledWith("j-1", {
      output_data: { videoUrl: "https://r2/videos/j-1.mp4" },
    })
    expect(mocks.attachAssetToCharacterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: CHARACTER_ID,
        column: "motions",
        item: expect.objectContaining({ name: "walk cycle", url: "https://r2/videos/j-1.mp4" }),
      }),
    )
    expect(mocks.bumpMock).not.toHaveBeenCalled()
  })

  it("honors skipPortraitAttach — the linkage survives, the identity anchor is not overwritten", async () => {
    mocks.jobRow.data = jobRowWith({
      type: "generate-character",
      attachToCharacterId: CHARACTER_ID,
      skipPortraitAttach: true,
    })

    await reconcileKieJob(row())

    expect(mocks.markJobCompletedMock).toHaveBeenCalled()
    expect(mocks.setCharacterPortraitMock).not.toHaveBeenCalled()
  })

  it("honors attachPortrait: false read off input_data — a recovered candidate completes, the portrait stays the user's pick", async () => {
    // The worker died, so the persisted row is the ONLY carrier of the flag: a
    // take recovered here must not overwrite the portrait the approve route set.
    mocks.jobRow.data = jobRowWith({
      type: "generate-character",
      attachToCharacterId: CHARACTER_ID,
      attachPortrait: false,
    })

    await reconcileKieJob(row())

    expect(mocks.markJobCompletedMock).toHaveBeenCalledWith("j-1", {
      output_data: { imageUrl: "https://r2/images/j-1.png" },
    })
    expect(mocks.commitCreditsMock).toHaveBeenCalledWith("ul-1", "j-1", null)
    expect(mocks.setCharacterPortraitMock).not.toHaveBeenCalled()
    expect(mocks.refundMock).not.toHaveBeenCalled()
  })

  it("does not watermark when the row says not to, and does when it does", async () => {
    mocks.jobRow.data = jobRowWith({ type: "generate-character" }, { should_watermark: true })
    await reconcileKieJob(row())
    expect(mocks.uploadImageMock).toHaveBeenCalledWith(expect.any(String), "j-1", "u-1", true)
  })
})

describe("recovery guards", () => {
  it("skips a row that already went terminal — never trample a cancel", async () => {
    mocks.jobRow.data = jobRowWith({ type: "generate-character" }, { status: "cancelled" })

    await reconcileKieJob(row())

    expect(mocks.claimMock).not.toHaveBeenCalled()
    expect(mocks.uploadImageMock).not.toHaveBeenCalled()
    expect(mocks.markJobCompletedMock).not.toHaveBeenCalled()
  })

  it("exits before any media work when another finalizer holds the claim", async () => {
    mocks.jobRow.data = jobRowWith({ type: "generate-character" })
    mocks.claimMock.mockResolvedValue({ won: false, ts: null })

    await reconcileKieJob(row())

    expect(mocks.uploadImageMock).not.toHaveBeenCalled()
    expect(mocks.markJobCompletedMock).not.toHaveBeenCalled()
  })

  it("writes nothing after a lost completion CAS (a concurrent cancel won)", async () => {
    mocks.jobRow.data = jobRowWith({ type: "generate-character", attachToCharacterId: CHARACTER_ID })
    mocks.markJobCompletedMock.mockResolvedValue(false)

    await reconcileKieJob(row())

    expect(mocks.commitCreditsMock).not.toHaveBeenCalled()
    expect(mocks.setCharacterPortraitMock).not.toHaveBeenCalled()
  })

  it("releases the claim and bumps when the media step fails", async () => {
    mocks.jobRow.data = jobRowWith({ type: "generate-character" })
    mocks.uploadImageMock.mockRejectedValue(new Error("upload-size-exceeded: 42MB"))

    await reconcileKieJob(row())

    expect(mocks.releaseClaimMock).toHaveBeenCalledWith("j-1", "2026-09-15T00:00:00Z")
    expect(mocks.bumpMock).toHaveBeenCalledTimes(1)
    expect(String(mocks.bumpMock.mock.calls[0]?.[1])).toContain("upload-size-exceeded")
    expect(mocks.markJobCompletedMock).not.toHaveBeenCalled()
  })

  it("still fails+refunds a genuinely FAILED upstream entity task", async () => {
    mocks.jobRow.data = jobRowWith({ type: "generate-character" })
    mocks.pollKieTaskMock.mockRejectedValue(
      Object.assign(new Error("Generation failed."), { isUpstreamFailure: true }),
    )

    await reconcileKieJob(row())

    expect(mocks.markJobFailedMock).toHaveBeenCalled()
    expect(mocks.refundMock).toHaveBeenCalledWith("j-1")
    expect(mocks.markJobCompletedMock).not.toHaveBeenCalled()
  })
})
