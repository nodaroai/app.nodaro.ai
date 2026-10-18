import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Vidu Q4 payload guard.
 *
 * ONE Nodaro id over two KIE endpoints, both `additionalProperties: false`:
 * a start frame alone → `vidu-q4/image-to-video`, any reference image or
 * reference audio → `vidu-q4/reference-to-video`. The bespoke `runViduQ4`
 * builds each body from an explicit allow-list (integer duration, lowercase
 * resolution, `audio` boolean, no seed, no aspect ratio on the frame body).
 * A regression that routed Vidu back onto the generic createTask path would
 * spread `extraParams`, stringify `duration` and send `seed` / `aspect_ratio`
 * into a schema that rejects unknown keys — these pins are the guard.
 */

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
  const mockCreateSanitizedError = vi.fn(
    (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
  )
  const mockUploadBufferToR2 = vi.fn()
  const mockSafeFetch = vi.fn()
  const sharpMeta: { format: string; width: number; height: number } = {
    format: "jpeg",
    width: 1024,
    height: 1024,
  }
  return { mockRunKieTask, mockCreateSanitizedError, mockUploadBufferToR2, mockSafeFetch, sharpMeta }
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
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS, VIDU_Q4_REFERENCE_MODEL } from "../models.js"

let provider: KieVideoProvider

const captured = () => mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
const capturedModel = () => mocks.mockRunKieTask.mock.calls[0][0] as string

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

describe("Vidu Q4 — model config", () => {
  it("is an i2v-only key: image-to-video endpoint, no t2v entry, no seed, no end frame", () => {
    const cfg = KIE_VIDEO_MODELS["vidu-q4"]!
    expect(cfg.model).toBe("vidu-q4/image-to-video")
    expect(cfg.omitSeed).toBe(true)
    expect(cfg.supportsEndFrame).toBe(false)
    expect(cfg.allowedDurations).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expect(KIE_TEXT_TO_VIDEO_MODELS["vidu-q4"]).toBeUndefined()
    expect(VIDU_Q4_REFERENCE_MODEL).toBe("vidu-q4/reference-to-video")
  })
})

describe("Vidu Q4 — image-to-video (start frame only)", () => {
  it("sends exactly { image_url, prompt, duration, resolution, audio } to vidu-q4/image-to-video", async () => {
    await provider.imageToVideo("https://x/start.png", "the astronaut waves", "vidu-q4", 8, undefined, {
      resolution: "1080p",
      seed: 42,
      aspectRatio: "9:16",
    })
    expect(capturedModel()).toBe("vidu-q4/image-to-video")
    const input = captured()
    expect(Object.keys(input).sort()).toEqual(["audio", "duration", "image_url", "prompt", "resolution"])
    expect(input.image_url).toBe("https://x/start.png")
    expect(input.prompt).toBe("the astronaut waves")
    // INTEGER, never the generic path's string.
    expect(input.duration).toBe(8)
    expect(typeof input.duration).toBe("number")
    expect(input.resolution).toBe("1080p")
    expect(input.audio).toBe(true)
    // No aspect ratio on the frame body (the output inherits the frame's shape),
    // no seed (absent from the schema).
    expect(input).not.toHaveProperty("aspect_ratio")
    expect(input).not.toHaveProperty("seed")
  })

  it("omits the prompt when none is given — it is optional here, and no platform default is invented", async () => {
    await provider.imageToVideo("https://x/start.png", undefined, "vidu-q4")
    const input = captured()
    expect(input).not.toHaveProperty("prompt")
    expect(Object.keys(input).sort()).toEqual(["audio", "duration", "image_url", "resolution"])
  })

  it("defaults to 5s at 720p when the request names neither", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "vidu-q4")
    expect(captured().duration).toBe(5)
    expect(captured().resolution).toBe("720p")
  })

  it("sends the LOWERCASE wire enum for every spelling, and 720p for anything unknown", async () => {
    for (const [given, sent] of [["2K", "2k"], ["4K", "4k"], ["540P", "540p"], ["480p", "720p"], ["nonsense", "720p"]] as const) {
      vi.clearAllMocks()
      mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
      await provider.imageToVideo("https://x/start.png", "p", "vidu-q4", 5, undefined, { resolution: given })
      expect(captured().resolution, given).toBe(sent)
    }
  })

  it("snaps an off-menu duration into 3-16", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "vidu-q4", 20)
    expect(captured().duration).toBe(16)
  })

  it("maps the audio toggle onto the `audio` boolean", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "vidu-q4", 5, undefined, { sound: false })
    expect(captured().audio).toBe(false)
  })

  it("never forwards an end frame — neither endpoint takes one", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "vidu-q4", 5, "https://x/end.png")
    const input = captured()
    expect(capturedModel()).toBe("vidu-q4/image-to-video")
    expect(JSON.stringify(input)).not.toContain("end.png")
  })

  it("reports the rendered tier's provider cost, scaling with seconds", async () => {
    const a = await provider.imageToVideo("https://x/start.png", "p", "vidu-q4", 4, undefined, { resolution: "720p" })
    vi.clearAllMocks()
    mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
    const b = await provider.imageToVideo("https://x/start.png", "p", "vidu-q4", 8, undefined, { resolution: "720p" })
    expect(b.cost).toBeCloseTo((a.cost ?? Number.NaN) * 2, 6)
  })
})

describe("Vidu Q4 — reference-to-video", () => {
  it("any reference image switches to vidu-q4/reference-to-video with an explicit allow-listed body", async () => {
    await provider.imageToVideo(undefined, "the man from @image_1 waves", "vidu-q4", 6, undefined, {
      referenceImageUrls: ["https://x/r1.png", "https://x/r2.png"],
      referenceAudioUrls: ["https://x/voice.mp3"],
      resolution: "2k",
      aspectRatio: "9:16",
      seed: 7,
    })
    expect(capturedModel()).toBe("vidu-q4/reference-to-video")
    const input = captured()
    expect(Object.keys(input).sort()).toEqual([
      "aspect_ratio", "audio", "duration", "prompt", "reference_audio_urls", "reference_image_urls", "resolution",
    ])
    expect(input.reference_image_urls).toEqual(["https://x/r1.png", "https://x/r2.png"])
    expect(input.reference_audio_urls).toEqual(["https://x/voice.mp3"])
    expect(input.prompt).toBe("the man from @image_1 waves")
    expect(input.aspect_ratio).toBe("9:16")
    expect(input.duration).toBe(6)
    expect(input.resolution).toBe("2k")
    expect(input).not.toHaveProperty("image_url")
    expect(input).not.toHaveProperty("seed")
    expect(input).not.toHaveProperty("reference_video_urls")
  })

  it("demotes a wired start frame into the reference images and binds it in the prompt", async () => {
    await provider.imageToVideo("https://x/start.png", "she turns to the camera", "vidu-q4", 5, undefined, {
      referenceImageUrls: ["https://x/r1.png"],
    })
    expect(capturedModel()).toBe("vidu-q4/reference-to-video")
    const input = captured()
    // After the caller's own reference, so @image_1 still means r1.
    expect(input.reference_image_urls).toEqual(["https://x/r1.png", "https://x/start.png"])
    expect(input).not.toHaveProperty("image_url")
    expect(input.prompt).toMatch(/^she turns to the camera\n\n/)
    expect(input.prompt).toContain("@image_2 as the opening (first) frame")
  })

  it("reference AUDIO alone (with a start frame) is reference mode too — the frame is the one image", async () => {
    await provider.imageToVideo("https://x/start.png", "he speaks", "vidu-q4", 5, undefined, {
      referenceAudioUrls: ["https://x/a.mp3"],
    })
    expect(capturedModel()).toBe("vidu-q4/reference-to-video")
    expect(captured().reference_image_urls).toEqual(["https://x/start.png"])
    expect(captured().reference_audio_urls).toEqual(["https://x/a.mp3"])
  })

  it("defaults the aspect ratio to 16:9 and snaps an off-list ratio onto the enum", async () => {
    await provider.imageToVideo(undefined, "p", "vidu-q4", 5, undefined, { referenceImageUrls: ["https://x/r1.png"] })
    expect(captured().aspect_ratio).toBe("16:9")
    vi.clearAllMocks()
    mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
    await provider.imageToVideo(undefined, "p", "vidu-q4", 5, undefined, { referenceImageUrls: ["https://x/r1.png"], aspectRatio: "21:9" })
    expect(["16:9", "9:16", "1:1", "4:3", "3:4"]).toContain(captured().aspect_ratio)
    expect(captured().aspect_ratio).toBe("16:9")
  })

  it("caps references at 15 images and 3 audio clips", async () => {
    const imgs = Array.from({ length: 18 }, (_, i) => `https://x/r${i}.png`)
    const auds = Array.from({ length: 5 }, (_, i) => `https://x/a${i}.mp3`)
    await provider.imageToVideo(undefined, "p", "vidu-q4", 5, undefined, { referenceImageUrls: imgs, referenceAudioUrls: auds })
    expect((captured().reference_image_urls as string[]).length).toBe(15)
    expect((captured().reference_audio_urls as string[]).length).toBe(3)
  })

  it("refuses an empty prompt in reference mode before any task is created (backstop)", async () => {
    await expect(
      provider.imageToVideo("https://x/start.png", "   ", "vidu-q4", 5, undefined, { referenceImageUrls: ["https://x/r1.png"] }),
    ).rejects.toThrow(/prompt is required/)
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })

  it("refuses reference audio with no image at all", async () => {
    await expect(
      provider.imageToVideo(undefined, "p", "vidu-q4", 5, undefined, { referenceAudioUrls: ["https://x/a.mp3"] }),
    ).rejects.toThrow(/start frame or at least one reference image/)
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })
})
