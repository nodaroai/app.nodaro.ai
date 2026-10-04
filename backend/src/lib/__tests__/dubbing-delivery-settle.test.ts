import { beforeEach, describe, expect, it, vi } from "vitest"

// A dub whose length could not be read before it started was held at the
// 30-minute ceiling (`reservedCeiling`). Delivery — the one place both the
// worker and the reconcile lane finish a dub — settles that hold to the span
// actually dubbed: ElevenLabs' reading, else the delivered file's length, else
// the 2-minute last resort; never the 30-minute hold itself. A run whose span
// was measured commits its reservation exactly as before.

const mocks = vi.hoisted(() => ({
  finalize: vi.fn(),
  commit: vi.fn(),
  probe: vi.fn(),
}))

vi.mock("../storage.js", () => ({
  uploadBufferToR2: vi.fn(async () => "https://cdn.example.com/audios/job-1.mp3"),
  mediaObjectKey: vi.fn(() => "audios/job-1.mp3"),
}))
vi.mock("../post-processing-error.js", () => ({ runPostProcessing: (fn: () => unknown) => fn() }))
vi.mock("../job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalize }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn(async () => "/tmp/dub-test"),
  cleanupWorkDir: vi.fn(async () => {}),
  probeMediaDuration: mocks.probe,
}))
vi.mock("../../providers/video/extract-audio-track.js", () => ({
  extractAudioTrack: vi.fn(async () => { throw new Error("no sidecar in this test") }),
}))
vi.mock("../../workers/shared.js", () => ({
  commitJobCredits: mocks.commit,
  markJobCompleted: vi.fn(async () => true),
  shouldSaveJobResult: vi.fn(async () => true),
  generateAndUploadThumbnail: vi.fn(async () => undefined),
  createAssetFromJob: vi.fn(async () => undefined),
  watermarkLocalVideoAndUpload: vi.fn(async () => "https://cdn.example.com/videos/job-1.mp4"),
}))
vi.mock("../credit-base-cost.js", () => ({
  baseCreditCostFor: vi.fn(async (id: string) => (id === "elevenlabs-dubbing" ? 40 : 999)),
}))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, promises: { ...actual.promises, writeFile: vi.fn(async () => {}), readFile: vi.fn(async () => Buffer.from("")) } }
})

import { deliverDubbedMedia } from "../dubbing-delivery.js"

const CEILING = { reservedCeiling: true, targetLanguage: "fr" }
const deliver = (overrides: Partial<Parameters<typeof deliverDubbedMedia>[0]>) =>
  deliverDubbedMedia({ jobId: "job-1", buffer: Buffer.from("x"), videoMode: false, shouldWatermark: false, usageLogId: "u-1", ...overrides })

beforeEach(() => {
  mocks.finalize.mockReset().mockResolvedValue({ ok: true })
  mocks.commit.mockReset().mockResolvedValue(undefined)
  mocks.probe.mockReset()
})

describe("audio dub", () => {
  it("a ceiling-held run settles to ElevenLabs' reading of the span (95 s → 2 minutes → 80)", async () => {
    await deliver({ request: CEILING, mediaDurationSec: 95 })
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ meteredBaseCredits: 80 }))
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it("the window bounds the settled span", async () => {
    await deliver({ request: { ...CEILING, startTime: 10, endTime: 70 }, mediaDurationSec: 20 * 60 })
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ meteredBaseCredits: 40 }))
  })

  it("without ElevenLabs' reading, the delivered file's length settles it", async () => {
    mocks.probe.mockResolvedValue(181)
    await deliver({ request: CEILING })
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ meteredBaseCredits: 160 }))
  })

  it("with no length at all, it settles at the 2-minute last resort — never the 30-minute hold", async () => {
    mocks.probe.mockRejectedValue(new Error("unreadable"))
    await deliver({ request: CEILING })
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ meteredBaseCredits: 80 }))
  })

  it("a measured run commits its reservation as before", async () => {
    await deliver({ request: { targetLanguage: "fr", probedDurationSec: 95 }, mediaDurationSec: 95 })
    expect(mocks.finalize.mock.calls[0]![0]).not.toHaveProperty("meteredBaseCredits")
  })
})

describe("video dub", () => {
  it("a ceiling-held run commits count-based at the span dubbed, USD null", async () => {
    await deliver({ videoMode: true, request: CEILING, mediaDurationSec: 7 * 60 })
    expect(mocks.commit).toHaveBeenCalledWith("u-1", "job-1", null, 280, true)
  })

  it("without ElevenLabs' reading, the delivered video's length settles it", async () => {
    mocks.probe.mockResolvedValue(61)
    await deliver({ videoMode: true, request: CEILING })
    expect(mocks.commit).toHaveBeenCalledWith("u-1", "job-1", null, 80, true)
  })

  it("a measured run commits its reservation as before", async () => {
    await deliver({ videoMode: true, request: { targetLanguage: "fr", probedDurationSec: 61 }, mediaDurationSec: 61 })
    expect(mocks.commit).toHaveBeenCalledWith("u-1", "job-1")
  })
})
