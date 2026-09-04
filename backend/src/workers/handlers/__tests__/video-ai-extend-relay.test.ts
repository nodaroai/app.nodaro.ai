/**
 * Relay provenance on the LAST rebuilt finalize literal (spec §8.2 lane 1,
 * migration 383): `extend-video` / `seedance-2-extend`.
 *
 * This branch generates its continuation through the CAPABILITY ROUTER
 * (`providers/index.ts` imageToVideo) with `seedance-2` / `seedance-2-5` — both
 * of them keys of `KIE_VIDEO_MODELS`, which `providers/nodaro/index.ts` declares
 * as the cloud provider's "image-to-video" models. So on a keyless install with
 * a live nodaro.ai connection the chain is `[nodaro]`, the far end runs the
 * generation and reserves credits for it, and `walkChainAndExecute` copies
 * `relayJobId`/`relayCredits` onto the RouteResult.
 *
 * The handler then REBUILDS the finalize input as a literal (the stitched
 * deliverable is not the router's url), which is exactly where the pair used to
 * fall on the floor — `relayFieldsFrom` keys on PRESENCE, so the completion
 * UPDATE left `jobs.relay_job_id` and `jobs.relay_credits` NULL and a self-host
 * settling its users on `relay_credits` billed the generation at zero. Its two
 * sibling literals (lip-sync :868, video-upscale :1060) carry it by hand and are
 * pinned in video-ai.test.ts; this file pins the third.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  mockImageToVideo: vi.fn(),
  mockFinalize: vi.fn(),
  mockUploadFileToR2: vi.fn(),
  mockUploadToR2: vi.fn(),
  mockCombineVideos: vi.fn(),
  mockWatermarkLocal: vi.fn(),
  mockThumb: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
    })),
  },
}))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: vi.fn(),
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  lipSyncVideo: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
  speechToVideo: vi.fn(),
}))

vi.mock("@/lib/storage.js", () => ({
  uploadToR2: mocks.mockUploadToR2,
  uploadFileToR2: mocks.mockUploadFileToR2,
  uploadBufferToR2: vi.fn(),
  mediaObjectKey: vi.fn(() => "key"),
}))

vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createWorkDir: vi.fn(async () => "/tmp/workdir"),
    cleanupWorkDir: vi.fn(async () => {}),
    downloadFile: vi.fn(async () => {}),
    stripAudio: vi.fn(),
    probeVideoSource: vi.fn(async () => ({ durationSeconds: 10, width: 720, height: 1280, fps: 24 })),
  }
})

vi.mock("@/providers/video/extract-tail.js", () => ({
  extractTailToFile: vi.fn(async () => "/tmp/workdir/tail.mp4"),
}))
vi.mock("@/providers/video/extract-frame.js", () => ({
  extractFrame: vi.fn(async () => ({ imagePath: "/tmp/frames/last.png" })),
}))
vi.mock("@/providers/video/source-matched-aspect.js", () => ({
  resolveSourceMatchedAspect: vi.fn(async () => "adaptive"),
}))
vi.mock("@/lib/seedance-extend-mov-chain.js", () => ({
  findChainedMovReference: vi.fn(async () => undefined),
  isMovUrl: vi.fn(() => false),
}))
vi.mock("@/providers/video/combine-videos.js", () => ({
  combineVideos: mocks.mockCombineVideos,
}))
vi.mock("@/lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.mockFinalize,
}))

vi.mock("@/workers/shared.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    commitJobCredits: vi.fn(async () => {}),
    shouldSaveJobResult: vi.fn(async () => true),
    markJobCompleted: vi.fn(async () => true),
    uploadVideoMaybeWatermark: vi.fn(async () => "https://r2.example.com/wm.mp4"),
    watermarkLocalVideoAndUpload: mocks.mockWatermarkLocal,
    generateAndUploadThumbnail: mocks.mockThumb,
    setJobProgress: vi.fn(async () => {}),
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(
      async (_j: unknown, _i: unknown, _o: unknown, fn: () => Promise<unknown>) => fn(),
    ),
  }
})

import { videoAIHandlers } from "@/workers/handlers/video-ai.js"

/** What `NodaroCloudVideoProvider.imageToVideo` → `extractVideoResult` →
 *  `relayResultFields(job)` puts on the ProviderResult, and what
 *  `walkChainAndExecute` copies onto the RouteResult. */
const RELAYED_ROUTE_RESULT = {
  url: "https://cloud.nodaro.ai/ext.mp4",
  cost: null,
  displayCost: null,
  providerUsed: "nodaro",
  relayJobId: "cloud-9",
  relayCredits: 24,
}

/** The vendor-direct (KIE) shape: `walkChainAndExecute` copies the pair only
 *  when it is present, so there is no key at all. */
const VENDOR_ROUTE_RESULT = {
  url: "https://kie.example.com/ext.mp4",
  cost: 0.42,
  displayCost: null,
  providerUsed: "seedance-2",
}

function runExtend() {
  return videoAIHandlers["extend-video"]!(
    {
      name: "extend-video",
      data: {
        jobId: "job-1",
        provider: "seedance-2-extend",
        video: "https://src/v.mp4",
        prompt: "keep going",
      },
      id: "b1",
      updateProgress: vi.fn(),
    } as never,
    { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false } as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockFinalize.mockResolvedValue({ ok: true })
  mocks.mockCombineVideos.mockResolvedValue({ outputPath: "/tmp/stitch/out.mp4", smartCuts: null })
  mocks.mockWatermarkLocal.mockResolvedValue("https://r2.example.com/stitched.mp4")
  mocks.mockThumb.mockResolvedValue("https://r2.example.com/thumb.png")
  mocks.mockUploadFileToR2.mockResolvedValue("https://r2.example.com/tail.mp4")
  mocks.mockUploadToR2.mockResolvedValue("https://r2.example.com/raw.mov")
  mocks.mockImageToVideo.mockResolvedValue(VENDOR_ROUTE_RESULT)
})

describe("extend-video / seedance-2-extend — relay provenance on the rebuilt literal", () => {
  it("routes the continuation through the capability router (so a relay lane exists at all)", async () => {
    await runExtend()
    expect(mocks.mockImageToVideo).toHaveBeenCalledTimes(1)
    expect(mocks.mockImageToVideo.mock.calls[0][1]).toBe("seedance-2")
  })

  it("carries relayJobId/relayCredits into finalizeJobWithMedia", async () => {
    mocks.mockImageToVideo.mockResolvedValue(RELAYED_ROUTE_RESULT)

    await runExtend()

    expect(mocks.mockFinalize).toHaveBeenCalledTimes(1)
    expect(mocks.mockFinalize.mock.calls[0][0].result).toMatchObject({
      relayJobId: "cloud-9",
      relayCredits: 24,
    })
  })

  it("a vendor-direct result carries NO relay key at all", async () => {
    await runExtend()

    const { result } = mocks.mockFinalize.mock.calls[0][0]
    expect(result).not.toHaveProperty("relayJobId")
    expect(result).not.toHaveProperty("relayCredits")
  })
})
