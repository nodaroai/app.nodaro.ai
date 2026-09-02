import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Wan 3.0 family (wan-3 / wan-3-prime) payload guard.
 *
 * Wan is the first KIE video model that needs an INTEGER duration and an
 * UPPERCASE resolution, and whose native-audio lever is `audio`. It is served by
 * the bespoke `runWan3` builder for exactly that reason — the generic createTask
 * path would send `duration: "5"` and a lowercase resolution, which the schema
 * rejects on EVERY run. Nothing else in the suite would catch a regression that
 * routed wan back onto the generic path, so these payload pins are that guard.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() calls
// ---------------------------------------------------------------------------

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

// Spread the real module: ensureImageForProvider now keys converted inputs
// with tmpObjectKey (the sweepable tmp/ prefix), which a replace-everything
// mock would leave undefined.
vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

// video.ts downloads input images through safeFetch (SSRF gate), not global
// fetch — mock it or the fake hostnames below hit a real DNS lookup.
vi.mock("../../../lib/safe-fetch.js", () => ({
  safeFetch: mocks.mockSafeFetch,
}))

vi.mock("sharp", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.metadata = () => Promise.resolve({ ...mocks.sharpMeta })
    // .rotate() honours EXIF orientation before the re-encode drops it.
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

let provider: KieVideoProvider

/** The `input` object handed to runKieTask by the call under test. */
const captured = () => mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
/** The KIE model id handed to runKieTask. */
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

// ---------------------------------------------------------------------------
// KIE model id
// ---------------------------------------------------------------------------

describe("Wan 3 — KIE model id", () => {
  it("wan-3 dispatches to wan/3-0-video (i2v and t2v)", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "wan-3", 5)
    expect(capturedModel()).toBe("wan/3-0-video")
    vi.clearAllMocks()
    mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
    await provider.textToVideo("p", "wan-3", 5, "16:9")
    expect(capturedModel()).toBe("wan/3-0-video")
  })

  it("wan-3-prime dispatches to wan/3-0-video-prime", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "wan-3-prime", 5)
    expect(capturedModel()).toBe("wan/3-0-video-prime")
  })
})

// ---------------------------------------------------------------------------
// duration — INTEGER, snapped into the 2..30 ladder
// ---------------------------------------------------------------------------

describe("Wan 3 — duration", () => {
  it("sends a NUMBER, not a string (the generic-path regression)", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "wan-3", 8)
    expect(typeof captured().duration).toBe("number")
    expect(captured().duration).toBe(8)
  })

  it("defaults to 5s when the request omits a duration", async () => {
    await provider.textToVideo("p", "wan-3", undefined, "16:9")
    expect(captured().duration).toBe(5)
  })

  it("a 0 / negative request takes the 5s default (never the bottom of the ladder)", async () => {
    await provider.textToVideo("p", "wan-3", 0, "16:9")
    expect(captured().duration).toBe(5)
    vi.clearAllMocks()
    mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
    await provider.textToVideo("p", "wan-3", -1, "16:9")
    expect(captured().duration).toBe(5)
  })

  it("accepts the ends of the 2..30 ladder and snaps an out-of-range request", async () => {
    await provider.textToVideo("p", "wan-3", 30, "16:9")
    expect(captured().duration).toBe(30)
    vi.clearAllMocks()
    mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
    await provider.textToVideo("p", "wan-3", 45, "16:9")
    expect(captured().duration).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// resolution — UPPERCASE wire enum, 720P default (render == billed)
// ---------------------------------------------------------------------------

describe("Wan 3 — resolution", () => {
  it("uppercases the lowercase Nodaro vocabulary", async () => {
    for (const [req, wire] of [["480p", "480P"], ["720p", "720P"], ["1080p", "1080P"]] as const) {
      vi.clearAllMocks()
      mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
      await provider.textToVideo("p", "wan-3", 5, "16:9", { resolution: req })
      expect(captured().resolution).toBe(wire)
    }
  })

  it("pins 720P when the request omits a resolution (NOT KIE's own 1080P default)", async () => {
    await provider.textToVideo("p", "wan-3", 5, "16:9")
    expect(captured().resolution).toBe("720P")
  })

  it("an unsupported tier ('4k') collapses to 720P — the render can never exceed the billed tier", async () => {
    await provider.textToVideo("p", "wan-3", 5, "16:9", { resolution: "4k" })
    expect(captured().resolution).toBe("720P")
  })
})

// ---------------------------------------------------------------------------
// aspect ratio — "adaptive" is special-cased before any snapping
// ---------------------------------------------------------------------------

describe("Wan 3 — aspect_ratio", () => {
  it("undefined / Auto / adaptive all resolve to 'adaptive'", async () => {
    for (const req of [undefined, "Auto", "auto", "adaptive"]) {
      vi.clearAllMocks()
      mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
      await provider.imageToVideo("https://x/start.png", "p", "wan-3", 5, undefined, { aspectRatio: req })
      expect(captured().aspect_ratio, `aspectRatio: ${String(req)}`).toBe("adaptive")
    }
  })

  it("a declared ratio passes through untouched", async () => {
    for (const req of ["16:9", "4:3", "1:1", "3:4", "9:16"]) {
      vi.clearAllMocks()
      mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
      await provider.textToVideo("p", "wan-3", 5, req)
      expect(captured().aspect_ratio, req).toBe(req)
    }
  })

  it("an off-enum ratio snaps to the nearest DECLARED ratio (never to a non-ratio token)", async () => {
    await provider.textToVideo("p", "wan-3", 5, "21:9")
    expect(captured().aspect_ratio).toBe("16:9")
  })
})

// ---------------------------------------------------------------------------
// audio — Wan's own `audio` boolean, via the shared capability dispatch
// ---------------------------------------------------------------------------

describe("Wan 3 — audio lever", () => {
  it("defaults on and is always sent explicitly", async () => {
    await provider.textToVideo("p", "wan-3", 5, "16:9")
    expect(captured().audio).toBe(true)
    expect(captured().sound).toBeUndefined()
    expect(captured().generate_audio).toBeUndefined()
  })

  it("the neutral sound intent turns it off", async () => {
    await provider.textToVideo("p", "wan-3", 5, "16:9", { sound: false })
    expect(captured().audio).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// frames vs references — mutually exclusive on the Wan wire
// ---------------------------------------------------------------------------

describe("Wan 3 — frames and references are mutually exclusive", () => {
  it("frames only → first/last_frame_url set, NO reference_* keys", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "wan-3", 5, "https://x/end.png")
    const input = captured()
    expect(input.first_frame_url).toBe("https://x/start.png")
    expect(input.last_frame_url).toBe("https://x/end.png")
    expect(input.reference_image_urls).toBeUndefined()
    expect(input.reference_video_urls).toBeUndefined()
    expect(input.reference_audio_urls).toBeUndefined()
  })

  it("a reference demotes the frame into reference_image_urls and binds it in prose", async () => {
    await provider.imageToVideo("https://x/start.png", "a prompt", "wan-3", 5, undefined, {
      referenceImageUrls: ["https://x/ref1.png"],
    })
    const input = captured()
    expect(input.first_frame_url).toBeUndefined()
    // The user's own images keep their ordinals; the frame is appended after them.
    expect(input.reference_image_urls).toEqual(["https://x/ref1.png", "https://x/start.png"])
    expect(String(input.prompt)).toContain("a prompt")
    expect(String(input.prompt).length).toBeGreaterThan("a prompt".length)
  })

  it("reference videos / audio ride the reference mode on the t2v path", async () => {
    await provider.textToVideo("p", "wan-3", 5, "16:9", {
      referenceVideoUrls: ["https://x/v1.mp4"],
      referenceAudioUrls: ["https://x/a1.mp3"],
    })
    const input = captured()
    expect(input.reference_video_urls).toEqual(["https://x/v1.mp4"])
    expect(input.reference_audio_urls).toEqual(["https://x/a1.mp3"])
    expect(input.first_frame_url).toBeUndefined()
  })

  it("a pure t2v run carries no frame and no reference keys at all", async () => {
    await provider.textToVideo("p", "wan-3", 5, "16:9")
    const input = captured()
    expect(input.first_frame_url).toBeUndefined()
    expect(input.reference_image_urls).toBeUndefined()
    expect(input.reference_video_urls).toBeUndefined()
    expect(input.reference_audio_urls).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// reference caps — 10 images / 5 videos / 5 audio (docs.kie.ai wan/3-0-video)
// ---------------------------------------------------------------------------

describe("Wan 3 — reference caps", () => {
  it("caps at 10 images / 5 videos / 5 audio clips", async () => {
    await provider.textToVideo("p", "wan-3", 5, "16:9", {
      referenceImageUrls: Array.from({ length: 14 }, (_, i) => `https://x/i${i}.png`),
      referenceVideoUrls: Array.from({ length: 8 }, (_, i) => `https://x/v${i}.mp4`),
      referenceAudioUrls: Array.from({ length: 8 }, (_, i) => `https://x/a${i}.mp3`),
    })
    const input = captured()
    expect((input.reference_image_urls as string[]).length).toBe(10)
    expect((input.reference_video_urls as string[]).length).toBe(5)
    expect((input.reference_audio_urls as string[]).length).toBe(5)
  })

  it("a start frame spends one of the 10 image slots (frames ride the same array)", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "wan-3", 5, undefined, {
      referenceImageUrls: Array.from({ length: 14 }, (_, i) => `https://x/i${i}.png`),
    })
    const refs = captured().reference_image_urls as string[]
    expect(refs.length).toBe(10)
    expect(refs[9]).toBe("https://x/start.png")
  })
})

// ---------------------------------------------------------------------------
// out-of-scope wire fields
// ---------------------------------------------------------------------------

describe("Wan 3 — deliberately unsent fields", () => {
  it("never emits nsfw_checker / reference_file_urls / reference_link_urls", async () => {
    await provider.imageToVideo("https://x/start.png", "p", "wan-3", 5, undefined, { nsfwChecker: true })
    const input = captured()
    expect(input.nsfw_checker).toBeUndefined()
    expect(input.reference_file_urls).toBeUndefined()
    expect(input.reference_link_urls).toBeUndefined()
  })

  it("forwards a real seed and omits the -1 random sentinel", async () => {
    await provider.textToVideo("p", "wan-3", 5, "16:9", { seed: 12345 })
    expect(captured().seed).toBe(12345)
    vi.clearAllMocks()
    mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1" })
    await provider.textToVideo("p", "wan-3", 5, "16:9", { seed: -1 })
    expect(captured().seed).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// reported provider cost — per (SKU × resolution) rate × duration
// ---------------------------------------------------------------------------

describe("Wan 3 — reported provider cost", () => {
  const cases: Array<[string, string, number, number]> = [
    ["wan-3", "480p", 5, 0.2],
    ["wan-3", "720p", 5, 0.4],
    ["wan-3", "1080p", 5, 0.8],
    ["wan-3-prime", "480p", 5, 0.305],
    ["wan-3-prime", "720p", 5, 0.63],
    ["wan-3-prime", "1080p", 5, 1.26],
  ]
  it.each(cases)("%s @%s × %ds", async (model, resolution, duration, expected) => {
    const r = await provider.textToVideo("p", model, duration, "16:9", { resolution })
    expect(r.cost).toBeCloseTo(expected, 6)
  })

  it("scales linearly with the snapped duration", async () => {
    const r = await provider.textToVideo("p", "wan-3", 30, "16:9", { resolution: "1080p" })
    expect(r.cost).toBeCloseTo(0.16 * 30, 6)
  })
})
