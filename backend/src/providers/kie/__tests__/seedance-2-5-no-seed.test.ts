import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Seedance 2.5 takes no `seed`.
//
// KIE's bytedance/seedance-2-5 input schema has no seed property
// (docs.kie.ai/market/bytedance/seedance-2-5), and createTask refuses one with
// a 422: "seed is not supported by Seedance 2.5". Forwarding a caller's seed
// therefore failed every seeded run before it generated anything. The model
// config sets `omitSeed`, and this file pins that the KIE input never carries
// the key — in every input mode the shared Seedance resolver can pick.
//
// The control case (a seed-capable model still receives its seed) keeps the
// "no seed" assertions honest: they cannot pass just because the seed never
// reached the request builder.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  mockRunKieTask: vi.fn(),
  mockRunVeoTask: vi.fn(),
  mockCreateSanitizedError: vi.fn((msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`)),
  mockKling3Generate: vi.fn(),
  mockUploadBufferToR2: vi.fn(),
  mockSafeFetch: vi.fn(),
}))

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

vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

vi.mock("../../../lib/safe-fetch.js", () => ({
  safeFetch: mocks.mockSafeFetch,
}))

// Small JPEG metadata: the frame/reference normalizer passes it through
// untouched, so no conversion or upload is involved.
vi.mock("sharp", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.metadata = () => Promise.resolve({ format: "jpeg", width: 1024, height: 576 })
    chain.rotate = () => chain
    chain.resize = () => chain
    chain.jpeg = () => chain
    chain.webp = () => chain
    chain.png = () => chain
    chain.toBuffer = () => Promise.resolve(Buffer.from("jpeg"))
    return chain
  }
  const mockSharp = () => makeChain()
  mockSharp.default = mockSharp
  return { default: mockSharp }
})

import { KieVideoProvider } from "../video.js"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../models.js"

const SEED = 42
let provider: KieVideoProvider

const sentInput = (): Record<string, unknown> => {
  expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
  return mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
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

describe("Seedance 2.5 — a caller's seed never reaches KIE", () => {
  it("first-frame mode", async () => {
    await provider.imageToVideo("https://x/start.jpg", "a prompt", "seedance-2-5", 8, undefined, {
      resolution: "720p",
      seed: SEED,
    })
    const input = sentInput()
    expect(input.first_frame_url).toBeDefined()
    expect(input).not.toHaveProperty("seed")
  })

  it("first + last frame mode", async () => {
    await provider.imageToVideo(
      "https://x/start.jpg",
      "a prompt",
      "seedance-2-5",
      8,
      "https://x/end.jpg",
      { resolution: "720p", seed: SEED },
    )
    const input = sentInput()
    expect(input.last_frame_url).toBeDefined()
    expect(input).not.toHaveProperty("seed")
  })

  it("reference mode (start frame + reference image)", async () => {
    await provider.imageToVideo("https://x/start.jpg", "a prompt", "seedance-2-5", 8, undefined, {
      resolution: "720p",
      referenceImageUrls: ["https://x/ref.jpg"],
      seed: SEED,
    })
    const input = sentInput()
    expect(input.reference_image_urls).toBeDefined()
    expect(input).not.toHaveProperty("seed")
  })

  it("reference-only run on the image-to-video lane (no start frame)", async () => {
    await provider.imageToVideo(undefined as unknown as string, "a prompt", "seedance-2-5", 8, undefined, {
      resolution: "720p",
      referenceVideoUrls: ["https://x/ref.mp4"],
      seed: SEED,
    })
    const input = sentInput()
    expect(input.reference_video_urls).toBeDefined()
    expect(input).not.toHaveProperty("seed")
  })

  it("text-to-video lane, with and without references", async () => {
    await provider.textToVideo("a prompt", "seedance-2-5", 8, "16:9", { resolution: "720p", seed: SEED })
    expect(sentInput()).not.toHaveProperty("seed")

    mocks.mockRunKieTask.mockClear()
    await provider.textToVideo("a prompt", "seedance-2-5", 8, "16:9", {
      resolution: "720p",
      referenceImageUrls: ["https://x/ref.jpg"],
      seed: SEED,
    })
    expect(sentInput()).not.toHaveProperty("seed")
  })

  it("control: a seed-capable model on the same lane still receives its seed", async () => {
    await provider.imageToVideo("https://x/start.jpg", "a prompt", "bytedance-lite", 5, undefined, {
      seed: SEED,
    })
    expect(sentInput().seed).toBe(SEED)
  })

  it("both Seedance 2.5 registry entries declare omitSeed", () => {
    expect(KIE_VIDEO_MODELS["seedance-2-5"]?.omitSeed).toBe(true)
    expect(KIE_TEXT_TO_VIDEO_MODELS["seedance-2-5"]?.omitSeed).toBe(true)
  })
})
