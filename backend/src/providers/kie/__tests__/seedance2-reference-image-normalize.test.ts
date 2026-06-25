import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Seedance 2 reference-image normalization (reference mode).
//
// In Seedance 2 reference mode the user's `referenceImageUrls` are forwarded to
// KIE. Like the i2v start/end frames, they must first pass through
// `ensureImageForProvider` (the longest-side 2048px cap + JPEG re-encode helper
// in video.ts) — otherwise an oversize/RGBA user reference image reaches the
// MiniMax/Hailuo-family backend unprocessed and errors. Reference-mode-default
// routes more traffic here, so this is now a common path.
//
// `ensureImageForProvider` is module-private; we assert it ran per ref URL by
// observing its observable effects: it downloads each URL once via `safeFetch`
// and (when the image needs conversion) uploads a converted JPEG to R2, whose
// URL must then be the one that lands in `input.reference_image_urls`.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
  const mockRunVeoTask = vi.fn()
  const mockCreateSanitizedError = vi.fn(
    (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
  )
  const mockKling3Generate = vi.fn()
  const mockUploadBufferToR2 = vi.fn()
  const mockSafeFetch = vi.fn()
  // Oversize source so ensureImageForProvider MUST resize → upload → return a
  // new (converted) R2 URL. This makes "did the ref go through the helper?"
  // observable: the converted URL — not the raw input URL — reaches KIE.
  const sharpMeta: { format: string; width: number; height: number } = {
    format: "png",
    width: 4096,
    height: 4096,
  }
  return {
    mockRunKieTask,
    mockRunVeoTask,
    mockCreateSanitizedError,
    mockKling3Generate,
    mockUploadBufferToR2,
    mockSafeFetch,
    sharpMeta,
  }
})

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  runVeoTask: mocks.mockRunVeoTask,
  createSanitizedError: mocks.mockCreateSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO: 120,
  MAX_POLL_ATTEMPTS_LIP_SYNC_LONG: 120,
}))

vi.mock("../kling3-client.js", () => ({
  kling3Generate: mocks.mockKling3Generate,
}))

vi.mock("../models.js", async () => {
  const actual = await vi.importActual<typeof import("../models.js")>("../models.js")
  return actual
})

vi.mock("../../../lib/storage.js", () => ({
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

vi.mock("../../../lib/safe-fetch.js", () => ({
  safeFetch: mocks.mockSafeFetch,
}))

vi.mock("sharp", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.metadata = () => Promise.resolve({ ...mocks.sharpMeta })
    chain.resize = () => chain
    chain.jpeg = () => chain
    chain.toBuffer = () => Promise.resolve(Buffer.from("converted-jpeg-data"))
    return chain
  }
  const mockSharp = () => makeChain()
  mockSharp.default = mockSharp
  return { default: mockSharp }
})

import { KieVideoProvider } from "../video.js"

let provider: KieVideoProvider
let convertedCounter = 0

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocks.sharpMeta, { format: "png", width: 4096, height: 4096 })
  convertedCounter = 0
  // Distinct converted URL per call so we can prove each raw ref was replaced by
  // its OWN processed URL (not just that some conversion happened).
  mocks.mockUploadBufferToR2.mockImplementation(() =>
    Promise.resolve(`https://cdn.nodaro.ai/images/converted-${++convertedCounter}.jpg`),
  )
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

describe("KieVideoProvider — Seedance 2 reference-image normalization", () => {
  it("textToVideo: each reference image is normalized (safeFetch per ref) and the converted URLs reach reference_image_urls", async () => {
    const refs = ["https://x/ref-a.png", "https://x/ref-b.png"]
    await provider.textToVideo("a prompt", "seedance-2", 8, "16:9", {
      resolution: "720p",
      referenceImageUrls: refs,
    })

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    // ensureImageForProvider downloads each ref exactly once (t2v has no frame,
    // so the only safeFetch calls are the two references).
    expect(mocks.mockSafeFetch).toHaveBeenCalledTimes(refs.length)
    for (const r of refs) {
      expect(mocks.mockSafeFetch).toHaveBeenCalledWith(r, expect.anything())
    }

    // The CONVERTED URLs — not the raw inputs — must be what KIE receives.
    const sent = input.reference_image_urls as string[]
    expect(sent).toHaveLength(refs.length)
    for (const r of refs) expect(sent).not.toContain(r)
    for (const u of sent) expect(u).toMatch(/converted-\d+\.jpg$/)
  })

  it("imageToVideo: reference images are normalized in addition to the start frame", async () => {
    const refs = ["https://x/ref-1.png"]
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "seedance-2",
      8,
      undefined,
      { resolution: "720p", referenceImageUrls: refs },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const input = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    // Start frame (1) + each reference (1) → all downloaded through the helper.
    expect(mocks.mockSafeFetch).toHaveBeenCalledTimes(1 + refs.length)
    expect(mocks.mockSafeFetch).toHaveBeenCalledWith("https://x/ref-1.png", expect.anything())

    // Reference mode moves the (already-processed) start frame into the pool and
    // keeps the (now-processed) user ref — every entry is a converted URL, none
    // is a raw input URL.
    const sent = input.reference_image_urls as string[]
    expect(sent).not.toContain("https://x/ref-1.png")
    expect(sent).not.toContain("https://x/start.png")
    for (const u of sent) expect(u).toMatch(/converted-\d+\.jpg$/)
  })

  it("does NOT double-process: a start frame moved into the reference pool is fetched only once", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "seedance-2",
      8,
      undefined,
      // A single reference image forces reference mode; the start frame is then
      // moved into reference_image_urls. It must be normalized exactly once (as a
      // frame), not re-normalized after the resolver moves it.
      { resolution: "720p", referenceImageUrls: ["https://x/ref-1.png"] },
    )

    // start frame fetched once + ref fetched once == 2. If the moved frame were
    // re-processed, the start URL would be fetched twice (3 total).
    const startCalls = mocks.mockSafeFetch.mock.calls.filter(
      (c) => c[0] === "https://x/start.png",
    )
    expect(startCalls).toHaveLength(1)
  })
})
