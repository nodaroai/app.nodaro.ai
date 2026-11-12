import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * PixVerse V6 Max dispatch guard.
 *
 * The bespoke `runPixverseV6Max` builds the body from an explicit allow-list
 * (pixverse-v6-max.ts) on both lanes. A regression that routed the model back
 * onto the generic createTask path would spread `extraParams`, stringify
 * `duration`, send `resolution` instead of `quality`, or an `aspect_ratio` to
 * the image endpoint — these pins are the guard.
 */

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
  const mockCreateSanitizedError = vi.fn(
    (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
  )
  const mockUploadBufferToR2 = vi.fn()
  const mockSafeFetch = vi.fn()
  const mockLogCreditAudit = vi.fn()
  const sharpMeta: { format: string; width: number; height: number } = {
    format: "jpeg",
    width: 1024,
    height: 1024,
  }
  return { mockRunKieTask, mockCreateSanitizedError, mockUploadBufferToR2, mockSafeFetch, mockLogCreditAudit, sharpMeta }
})

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  runVeoTask: vi.fn(),
  createSanitizedError: mocks.mockCreateSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO: 120,
}))

vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

vi.mock("../../../lib/safe-fetch.js", () => ({
  safeFetch: mocks.mockSafeFetch,
}))

vi.mock("../../../lib/credit-audit.js", () => ({
  logCreditAudit: mocks.mockLogCreditAudit,
  extractCreditFields: () => ({ credits: 60 }),
}))

// The mocked download is not a real file, so the metadata walker would rightly
// refuse to vouch for it and strip it; these tests are about where URLs go.
vi.mock("../../../lib/image-metadata.js", () => ({ imageHasMetadata: () => false }))
vi.mock("sharp", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.metadata = () => Promise.resolve({ ...mocks.sharpMeta })
    chain.rotate = () => chain
    chain.resize = () => chain
    chain.jpeg = () => chain
    chain.webp = () => chain
    chain.png = () => chain
    chain.toBuffer = () => Promise.resolve(Buffer.from("converted-jpeg-data"))
    return chain
  }
  const mockSharp = () => makeChain()
  mockSharp.default = mockSharp
  return { default: mockSharp }
})

import { KieVideoProvider } from "../video.js"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../models.js"

const ID = "pixverse-v6-max"
const START = "https://x/start.png"
const END = "https://x/end.png"
let provider: KieVideoProvider

const captured = () => mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
const capturedModel = () => mocks.mockRunKieTask.mock.calls[0][0] as string
// runKieTask(model, input, maxPolls, onProgress, reconcileOpts)
const capturedDimensions = () => (mocks.mockRunKieTask.mock.calls[0][4] as { dimensions?: Record<string, unknown> }).dimensions

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocks.sharpMeta, { format: "jpeg", width: 1024, height: 1024 })
  mocks.mockUploadBufferToR2.mockResolvedValue("https://cdn.nodaro.ai/images/converted.jpg")
  mocks.mockSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
  })
  mocks.mockRunKieTask.mockResolvedValue({
    resultJson: { resultUrls: ["https://x/out.mp4"] },
    taskId: "t1",
    providerMs: 1,
  })
  provider = new KieVideoProvider()
})

describe("PixVerse V6 Max — model configs", () => {
  it("one id in both maps, each on its own KIE endpoint, 1-15s, a seed, no end frame", () => {
    const i2v = KIE_VIDEO_MODELS[ID]!
    const t2v = KIE_TEXT_TO_VIDEO_MODELS[ID]!
    expect(i2v.model).toBe("pixverse-v6-max/image-to-video")
    expect(t2v.model).toBe("pixverse-v6-max/text-to-video")
    for (const cfg of [i2v, t2v]) {
      expect(cfg.allowedDurations).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
      expect(cfg.omitSeed).toBeUndefined()
      // Declarative only: the builder sends the switch itself.
      expect(cfg.extraParams).toEqual({ generate_audio_switch: true })
      // The schemas have no content-filter field.
      expect(cfg.safetyLevers).toBeUndefined()
    }
    expect(i2v.supportsEndFrame).toBe(false)
  })
})

describe("PixVerse V6 Max — image to video", () => {
  it("a start frame: one image_urls entry, integer duration, quality, audio on, seed — and no aspect ratio", async () => {
    await provider.imageToVideo(START, "she turns", ID, 8, undefined, {
      resolution: "1080p",
      seed: 42,
      cfgScale: 0.5,
      aspectRatio: "9:16",
      negativePrompt: "blur",
      generateAudio: false,
    })
    expect(capturedModel()).toBe("pixverse-v6-max/image-to-video")
    const input = captured()
    expect(Object.keys(input).sort()).toEqual(["duration", "generate_audio_switch", "image_urls", "prompt", "quality", "seed"])
    expect(input.image_urls).toEqual([START])
    expect(input.duration).toBe(8)
    expect(input.quality).toBe("1080p")
    expect(input.seed).toBe(42)
    // `generateAudio` turns the switch when `sound` is not sent (the pro engine's field).
    expect(input.generate_audio_switch).toBe(false)
    // The negative still reaches the model, folded into the prompt.
    expect(String(input.prompt)).toContain("she turns")
    expect(String(input.prompt)).toContain("blur")
  })

  it("defaults to 5s at 720p with audio and the platform prompt when the request names none", async () => {
    await provider.imageToVideo(START, undefined, ID)
    expect(captured().duration).toBe(5)
    expect(captured().quality).toBe("720p")
    expect(captured().generate_audio_switch).toBe(true)
    expect(captured().prompt).toBe("smooth cinematic motion")
    expect(captured()).not.toHaveProperty("seed")
  })

  it("sound: false turns the switch off, and a -1 seed is left out", async () => {
    await provider.imageToVideo(START, "p", ID, 5, undefined, { sound: false, seed: -1 })
    expect(captured().generate_audio_switch).toBe(false)
    expect(captured()).not.toHaveProperty("seed")
  })

  it("sound wins over generateAudio, as the price reads them", async () => {
    await provider.imageToVideo(START, "p", ID, 5, undefined, { sound: true, generateAudio: false })
    expect(captured().generate_audio_switch).toBe(true)
  })

  it("an end frame or references are not forwarded (neither endpoint takes one)", async () => {
    await provider.imageToVideo(START, "p", ID, 5, END, {
      referenceImageUrls: ["https://x/r1.png"],
      referenceVideoUrls: ["https://x/v.mp4"],
      referenceAudioUrls: ["https://x/a.mp3"],
    })
    const input = captured()
    expect(Object.keys(input).sort()).toEqual(["duration", "generate_audio_switch", "image_urls", "prompt", "quality"])
    expect(input.image_urls).toEqual([START])
  })

  it("snaps an off-list duration to the nearest whole second it renders", async () => {
    await provider.imageToVideo(START, "p", ID, 30)
    expect(captured().duration).toBe(15)
  })

  it("names the resolution and audio dimensions for the egress seam", async () => {
    await provider.imageToVideo(START, "p", ID, 5, undefined, { resolution: "540p", sound: false })
    expect(capturedDimensions()).toMatchObject({ resolution: "540p", audio: false, duration: 5 })
  })

  it("with no start frame, takes the text-to-video endpoint", async () => {
    await provider.imageToVideo(undefined, "p", ID, 5, undefined, { aspectRatio: "3:2" })
    expect(capturedModel()).toBe("pixverse-v6-max/text-to-video")
    expect(captured().aspect_ratio).toBe("3:2")
    expect(captured()).not.toHaveProperty("image_urls")
  })
})

describe("PixVerse V6 Max — text to video", () => {
  it("the aspect ratio is sent, never an image", async () => {
    await provider.textToVideo("a neon city", ID, 6, "21:9", { resolution: "360p", seed: 9 })
    expect(capturedModel()).toBe("pixverse-v6-max/text-to-video")
    const input = captured()
    expect(Object.keys(input).sort()).toEqual(["aspect_ratio", "duration", "generate_audio_switch", "prompt", "quality", "seed"])
    expect(input.aspect_ratio).toBe("21:9")
    expect(input.duration).toBe(6)
    expect(input.quality).toBe("360p")
    expect(input.generate_audio_switch).toBe(true)
  })

  it("an omitted or off-list aspect ratio is sent as 16:9 or the nearest declared one", async () => {
    await provider.textToVideo("p", ID, 5)
    expect(captured().aspect_ratio).toBe("16:9")
    vi.clearAllMocks()
    mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
    await provider.textToVideo("p", ID, 5, "9:21")
    expect(captured().aspect_ratio).toBe("9:16")
  })
})

describe("PixVerse V6 Max — provider cost", () => {
  it("reports each tier's cost, per second, at its quality and audio rate (both endpoints)", async () => {
    const at = async (resolution: string, seconds: number, sound: boolean | undefined, image: boolean) => {
      vi.clearAllMocks()
      mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
      mocks.mockSafeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) })
      const r = image
        ? await provider.imageToVideo(START, "p", ID, seconds, undefined, { resolution, sound })
        : await provider.textToVideo("p", ID, seconds, "16:9", { resolution, sound })
      return r.cost
    }
    // KIE credits a second × $0.005 × seconds.
    expect(await at("360p", 5, false, true)).toBeCloseTo(4.8 * 0.005 * 5, 6)
    expect(await at("360p", 5, true, false)).toBeCloseTo(7.2 * 0.005 * 5, 6)
    expect(await at("540p", 5, false, false)).toBeCloseTo(7.2 * 0.005 * 5, 6)
    expect(await at("540p", 5, undefined, true)).toBeCloseTo(8.8 * 0.005 * 5, 6)
    expect(await at("720p", 10, false, true)).toBeCloseTo(8.8 * 0.005 * 10, 6)
    expect(await at("720p", 10, true, false)).toBeCloseTo(12 * 0.005 * 10, 6)
    expect(await at("1080p", 15, false, false)).toBeCloseTo(17.6 * 0.005 * 15, 6)
    expect(await at("1080p", 15, true, true)).toBeCloseTo(22.4 * 0.005 * 15, 6)
  })
})
