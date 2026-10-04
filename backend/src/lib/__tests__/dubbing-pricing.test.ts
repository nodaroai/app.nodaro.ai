import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ probe: vi.fn(), rate: vi.fn(), postProbe: vi.fn(), credits: { on: true } }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mocks.probe }))
vi.mock("../../providers/elevenlabs/dubbing-project.js", () => ({ validateProjectDubbing: vi.fn() }))
vi.mock("../app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 10 }) }))
vi.mock("../../ee/billing/credits.js", () => ({ getModelCreditBaseCost: mocks.rate }))
vi.mock("../config.js", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), hasCredits: () => mocks.credits.on }))
vi.mock("../../services/workflow-engine/video-analysis-post-probe.js", () => ({ probeSocialPostDurationSec: mocks.postProbe }))
import { projectDubbingCreditOverride, stampDubbingDuration } from "../dubbing-pricing.js"

beforeEach(() => {
  mocks.probe.mockReset()
  mocks.postProbe.mockReset()
  mocks.rate.mockReset()
  mocks.credits.on = true
})

describe("Hebrew (the project lane)", () => {
  it("reserves every started minute using the project rate and trusted duration", async () => {
    mocks.probe.mockResolvedValue(61)
    mocks.rate.mockResolvedValue({ creditCost: 1100 })
    const payload = { targetLanguage: "he", videoUrl: "https://r2.example/video.mp4", probedDurationSec: 1 }
    expect(await projectDubbingCreditOverride("dubbing", payload)).toBe(2420)
    expect(payload.probedDurationSec).toBe(61)
    expect(mocks.rate).toHaveBeenCalledWith("elevenlabs-dubbing-v2")
  })
  it.each([0, NaN, 1801])("rejects an unpriceable span before reserving: %s", async (duration) => {
    mocks.probe.mockResolvedValue(duration)
    await expect(projectDubbingCreditOverride("dubbing", { targetLanguage: "he", videoUrl: "https://r2.example/video.mp4" })).rejects.toThrow("30 minutes")
  })
  it("is never stamped by the every-language step (its own override probes)", async () => {
    const payload: Record<string, unknown> = { targetLanguage: "he", videoUrl: "https://r2.example/video.mp4" }
    expect(await stampDubbingDuration("dubbing", payload)).toBeUndefined()
    expect(mocks.probe).not.toHaveBeenCalled()
    expect(payload.reservedCeiling).toBeUndefined()
  })
})

// Every other language: the workflow run used to reserve the bare one-minute
// row whatever the length. It now prices the span the route would — the
// measured span, or the 30-minute ceiling held and settled at delivery.
describe("every other language", () => {
  beforeEach(() => mocks.rate.mockResolvedValue({ creditCost: 40 }))

  it("an upload of 7 minutes is stamped and reserved at 7 minutes", async () => {
    mocks.probe.mockResolvedValue(6 * 60 + 41)
    const payload: Record<string, unknown> = { targetLanguage: "fr", videoUrl: "https://r2.example/v.mp4" }
    expect(await stampDubbingDuration("dubbing", payload)).toBeUndefined()
    expect(payload).toMatchObject({ probedDurationSec: 401 })
    expect(payload.reservedCeiling).toBeUndefined()
    // 40 × 7 minutes = 280 base, marked up once.
    expect(await projectDubbingCreditOverride("dubbing", payload)).toBe(308)
    expect(mocks.rate).toHaveBeenCalledWith("elevenlabs-dubbing")
  })

  it("a post link is measured through the social-post probe", async () => {
    mocks.postProbe.mockResolvedValue(95)
    const payload: Record<string, unknown> = { targetLanguage: "es", sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
    expect(await stampDubbingDuration("dubbing", payload)).toBeUndefined()
    expect(mocks.postProbe).toHaveBeenCalledOnce()
    expect(payload.probedDurationSec).toBe(95)
    expect(await projectDubbingCreditOverride("dubbing", payload)).toBe(88)
  })

  it("a start/end window prices the window", async () => {
    mocks.probe.mockResolvedValue(45 * 60)
    const payload: Record<string, unknown> = { targetLanguage: "fr", audioUrl: "https://r2.example/a.mp3", startTime: 0, endTime: 150 }
    expect(await stampDubbingDuration("dubbing", payload)).toBeUndefined()
    expect(payload.probedDurationSec).toBe(150)
    expect(await projectDubbingCreditOverride("dubbing", payload)).toBe(132)
  })

  it("an unreadable source holds the 30-minute ceiling, marked for delivery to settle", async () => {
    mocks.probe.mockRejectedValue(new Error("ffprobe failed"))
    const payload: Record<string, unknown> = { targetLanguage: "fr", sourceUrl: "https://example.com/page" }
    expect(await stampDubbingDuration("dubbing", payload)).toBeUndefined()
    expect(payload.reservedCeiling).toBe(true)
    expect(payload.probedDurationSec).toBeUndefined()
    // 40 × 30 minutes = 1,200 base → 1,320.
    expect(await projectDubbingCreditOverride("dubbing", payload)).toBe(1320)
  })

  it("a span past 30 minutes is refused before anything is reserved", async () => {
    mocks.probe.mockResolvedValue(31 * 60)
    const payload: Record<string, unknown> = { targetLanguage: "fr", videoUrl: "https://r2.example/v.mp4" }
    expect(await stampDubbingDuration("dubbing", payload)).toMatchObject({ code: "media_duration_exceeds_limit" })
    expect(payload.probedDurationSec).toBeUndefined()
  })

  it("nothing is measured where credits are not charged", async () => {
    mocks.credits.on = false
    const payload: Record<string, unknown> = { targetLanguage: "fr", videoUrl: "https://r2.example/v.mp4" }
    expect(await stampDubbingDuration("dubbing", payload)).toBeUndefined()
    expect(mocks.probe).not.toHaveBeenCalled()
  })
})

it("does not touch another operation", async () => {
  const payload: Record<string, unknown> = { targetLanguage: "he", videoUrl: "https://r2.example/v.mp4" }
  expect(await projectDubbingCreditOverride("voice-changer", payload)).toBeUndefined()
  expect(await stampDubbingDuration("voice-changer", payload)).toBeUndefined()
  expect(mocks.probe).not.toHaveBeenCalled()
})
