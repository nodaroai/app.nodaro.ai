import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Grok Imagine Video 1.5 dispatch guard.
 *
 * The bespoke `runGrokVideo15` builds the body from an explicit allow-list
 * (grok-video-15.ts) out of the RAW frame URLs, then normalizes each distinct
 * image once. A regression that routed the model back onto the generic
 * createTask path would spread `extraParams`, stringify `duration`, leak a seed
 * and send the start frame as `image_urls` — these pins are the guard.
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
  extractCreditFields: () => ({ credits: 19.2 }),
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

const ID = "grok-imagine-video-1.5"
const START = "https://x/start.png"
const END = "https://x/end.png"
let provider: KieVideoProvider

const captured = () => mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
const capturedModel = () => mocks.mockRunKieTask.mock.calls[0][0] as string
const fetchedUrls = () => mocks.mockSafeFetch.mock.calls.map((c) => String(c[0]))

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

describe("Grok Imagine Video 1.5 — model config", () => {
  it("an i2v key with an end frame, no seed, 1-15s, and no t2v entry", () => {
    const cfg = KIE_VIDEO_MODELS[ID]!
    expect(cfg.model).toBe("grok-imagine-video-1-5-preview")
    expect(cfg.omitSeed).toBe(true)
    expect(cfg.supportsEndFrame).toBe(true)
    expect(cfg.allowedDurations).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    // No extraParams / imageParam: nothing is spread onto the wire.
    expect(cfg.extraParams).toBeUndefined()
    expect(cfg.imageParam).toBeUndefined()
    expect(KIE_TEXT_TO_VIDEO_MODELS[ID]).toBeUndefined()
  })
})

describe("Grok Imagine Video 1.5 — dispatch", () => {
  it("a start frame alone: the exact first frame, integer duration, no seed, no image_urls", async () => {
    await provider.imageToVideo(START, "she turns", ID, 8, undefined, {
      resolution: "720p",
      seed: 42,
      cfgScale: 0.5,
      aspectRatio: "9:16",
      negativePrompt: "blur",
    })
    expect(capturedModel()).toBe("grok-imagine-video-1-5-preview")
    const input = captured()
    expect(Object.keys(input).sort()).toEqual(["aspect_ratio", "duration", "first_frame_url", "nsfw_checker", "prompt", "resolution"])
    expect(input.first_frame_url).toBe(START)
    expect(input.duration).toBe(8)
    expect(input.resolution).toBe("720p")
    expect(input.aspect_ratio).toBe("9:16")
    expect(input.nsfw_checker).toBe(false)
    // The negative still reaches the model, folded into the prompt.
    expect(String(input.prompt)).toContain("she turns")
    expect(String(input.prompt)).toContain("blur")
  })

  it("defaults to 8s at 480p and the platform prompt when the request names none", async () => {
    await provider.imageToVideo(START, undefined, ID)
    expect(captured().duration).toBe(8)
    expect(captured().resolution).toBe("480p")
    expect(captured().prompt).toBe("smooth cinematic motion")
  })

  it("start + end frame: first_frame_url and last_frame_url", async () => {
    await provider.imageToVideo(START, "p", ID, 5, END)
    expect(captured().first_frame_url).toBe(START)
    expect(captured().last_frame_url).toBe(END)
    expect(captured()).not.toHaveProperty("loop_url")
  })

  it("the same image as start and end: loop_url alone, the image fetched once", async () => {
    await provider.imageToVideo(START, "p", ID, 5, START)
    const input = captured()
    expect(input.loop_url).toBe(START)
    expect(input).not.toHaveProperty("first_frame_url")
    expect(input).not.toHaveProperty("last_frame_url")
    expect(fetchedUrls().filter((u) => u === START)).toHaveLength(1)
  })

  it("in-between frames ride keyframes at whole seconds; extras are dropped, never refused", async () => {
    const mids = ["https://x/m1.png", "https://x/m2.png", "https://x/m3.png"]
    await provider.imageToVideo(START, "p", ID, 3, undefined, { referenceImageUrls: mids })
    expect(captured().keyframes).toEqual([
      { url: mids[0], timestamp_s: 1 },
      { url: mids[1], timestamp_s: 2 },
    ])
    expect(captured()).not.toHaveProperty("image_urls")
  })

  it("1080p is sent and priced at its own rate", async () => {
    const r = await provider.imageToVideo(START, "p", ID, 8, undefined, { resolution: "1080P" })
    expect(captured().resolution).toBe("1080p")
    expect(r.cost).toBeCloseTo(0.32, 6)
  })

  it("reports each tier's provider cost, per second, with no per-image part", async () => {
    const at = async (resolution: string, seconds: number, refs?: string[]) => {
      vi.clearAllMocks()
      mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
      mocks.mockSafeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) })
      return (await provider.imageToVideo(START, "p", ID, seconds, undefined, { resolution, referenceImageUrls: refs })).cost
    }
    expect(await at("480p", 8)).toBeCloseTo(0.096, 6)
    expect(await at("720p", 8)).toBeCloseTo(0.18, 6)
    expect(await at("1080p", 15)).toBeCloseTo(0.6, 6)
    // In-between frames cost nothing extra.
    expect(await at("480p", 8, ["https://x/m1.png", "https://x/m2.png"])).toBeCloseTo(0.096, 6)
  })

  it("refuses a run with no start image before calling KIE", async () => {
    await expect(provider.imageToVideo(undefined, "p", ID, 5, END)).rejects.toThrow(/start frame is required/)
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })
})
