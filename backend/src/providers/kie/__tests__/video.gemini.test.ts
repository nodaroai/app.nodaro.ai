import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() calls
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
  const sharpMeta: { format: string; width: number; height: number } = {
    format: "jpeg",
    width: 1024,
    height: 1024,
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

// video.ts downloads the image via safeFetch (SSRF gate, PR #2897) — NOT global
// fetch. Without mocking it the provider does a real DNS lookup of the test's
// fake hostname and fails with EAI_AGAIN. Mock it to the same shape the global
// fetch stub uses.
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

// ---------------------------------------------------------------------------
// Import class under test
// ---------------------------------------------------------------------------

import { KieVideoProvider } from "../video.js"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let provider: KieVideoProvider

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocks.sharpMeta, { format: "jpeg", width: 1024, height: 1024 })
  mocks.mockUploadBufferToR2.mockResolvedValue(
    "https://cdn.nodaro.ai/images/provider-converted-test.jpg",
  )
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
  }))
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
// Gemini Omni Video — textToVideo
// ---------------------------------------------------------------------------

describe("KieVideoProvider — gemini-omni-video textToVideo", () => {
  it("T2V: sends string duration, no video_list, passes resolution and aspect_ratio", async () => {
    await provider.textToVideo(
      "a prompt",
      "gemini-omni-video",
      8,
      "16:9",
      { resolution: "720p" },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect(capturedInput.duration).toBe("8")
    expect(capturedInput.video_list).toBeUndefined()
    expect(capturedInput.resolution).toBe("720p")
    expect(capturedInput.aspect_ratio).toBe("16:9")
  })
})

// ---------------------------------------------------------------------------
// Gemini Omni Video — imageToVideo
// ---------------------------------------------------------------------------

describe("KieVideoProvider — gemini-omni-video imageToVideo", () => {
  it("I2V: image_urls has start + ref, sends string duration, passes resolution", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      { resolution: "1080p", referenceImageUrls: ["https://x/r.png"] },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect(Array.isArray(capturedInput.image_urls)).toBe(true)
    expect((capturedInput.image_urls as string[]).length).toBe(2)
    expect(capturedInput.duration).toBe("8")
    expect(capturedInput.resolution).toBe("1080p")
  })

  it("V2V: sends video_list and omits duration when referenceVideoUrls present", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      {
        resolution: "1080p",
        referenceVideoUrls: ["https://x/v.mp4"],
        videoTrimStart: 2,
        videoTrimEnd: 9,
      },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect(capturedInput.video_list).toEqual([
      { url: "https://x/v.mp4", start: 2, ends: 9 },
    ])
    expect(capturedInput.duration).toBeUndefined()
  })

  it("Quota: throws and does NOT call runKieTask when images + 2*videos > 7", async () => {
    await expect(
      provider.imageToVideo(
        "https://x/start.png",
        "a prompt",
        "gemini-omni-video",
        8,
        undefined,
        {
          resolution: "1080p",
          // start image (1) + 5 refs = 6 images, 1 video = 2 units → total 8 > 7
          referenceImageUrls: [
            "https://x/r1.png",
            "https://x/r2.png",
            "https://x/r3.png",
            "https://x/r4.png",
            "https://x/r5.png",
          ],
          referenceVideoUrls: ["https://x/v.mp4"],
        },
      ),
    ).rejects.toThrow()

    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })

  it("Quota: throws and does NOT call runKieTask on image-only overflow (8 images, no video)", async () => {
    await expect(
      provider.imageToVideo(
        "https://x/start.png",
        "a prompt",
        "gemini-omni-video",
        8,
        undefined,
        {
          resolution: "1080p",
          // start image (1) + 7 refs = 8 images total → 8 > 7 with no video
          referenceImageUrls: [
            "https://x/r1.png",
            "https://x/r2.png",
            "https://x/r3.png",
            "https://x/r4.png",
            "https://x/r5.png",
            "https://x/r6.png",
            "https://x/r7.png",
          ],
        },
      ),
    ).rejects.toThrow()

    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Duration snap
  // ---------------------------------------------------------------------------

  it("Duration snap: duration=12 → snaps to 10 (nearest of [4,6,8,10])", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      12,
      undefined,
      { resolution: "720p" },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect(capturedInput.duration).toBe("10")
  })

  it("Duration snap: duration=5 → snaps to 4 (nearest of [4,6,8,10])", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      5,
      undefined,
      { resolution: "720p" },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    // 5 is equidistant between 4 and 6; snapToAllowedDuration takes the first
    // best, which is 4 (the reduce starts at 4 and keeps 4 when tied).
    expect(capturedInput.duration).toBe("4")
  })

  // ---------------------------------------------------------------------------
  // Seed sentinel omitted
  // ---------------------------------------------------------------------------

  it("Seed: seed=-1 (sentinel) → input.seed is undefined", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      { resolution: "720p", seed: -1 },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect(capturedInput.seed).toBeUndefined()
  })

  it("Seed: seed=42 → input.seed === 42", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      { resolution: "720p", seed: 42 },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect(capturedInput.seed).toBe(42)
  })

  // ---------------------------------------------------------------------------
  // Trim window clamp (V2V)
  // ---------------------------------------------------------------------------

  it("Trim clamp: start=0, end=100 → video_list[0].ends === 10 (clamped to start+10)", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      {
        resolution: "720p",
        referenceVideoUrls: ["https://x/v.mp4"],
        videoTrimStart: 0,
        videoTrimEnd: 100,
      },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect((capturedInput.video_list as Array<Record<string, unknown>>)[0].ends).toBe(10)
  })

  it("Trim clamp: start=2, end=50 → video_list[0].ends === 12 (clamped to start+10)", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      {
        resolution: "720p",
        referenceVideoUrls: ["https://x/v.mp4"],
        videoTrimStart: 2,
        videoTrimEnd: 50,
      },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect((capturedInput.video_list as Array<Record<string, unknown>>)[0].ends).toBe(12)
  })

  // ---------------------------------------------------------------------------
  // >1 source video rejected
  // ---------------------------------------------------------------------------

  it(">1 source video: throws and does NOT call runKieTask when referenceVideoUrls.length === 2", async () => {
    await expect(
      provider.imageToVideo(
        "https://x/start.png",
        "a prompt",
        "gemini-omni-video",
        8,
        undefined,
        {
          resolution: "720p",
          referenceVideoUrls: ["https://x/v1.mp4", "https://x/v2.mp4"],
        },
      ),
    ).rejects.toThrow()

    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Off-list resolution defaults to 720p
  // ---------------------------------------------------------------------------

  it("Resolution: off-list value '2k' → captured input.resolution === '720p'", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      { resolution: "2k" },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect(capturedInput.resolution).toBe("720p")
  })

  it("Resolution: '1080p' → stays '1080p'", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      { resolution: "1080p" },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect(capturedInput.resolution).toBe("1080p")
  })

  it("Resolution: '4k' → stays '4k'", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      { resolution: "4k" },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

    expect(capturedInput.resolution).toBe("4k")
  })
})

// Gemini Omni Video — per-tier wholesale cost (the under-charge fix: the provider must
// report the ACTUAL tier cost so the credit-commit charges that tier, not the flat cheapest).
describe("KieVideoProvider — gemini-omni-video per-tier cost", () => {
  it("T2V 720p/1080p reports per-duration cost (not the flat cheapest)", async () => {
    const r8 = await provider.textToVideo("p", "gemini-omni-video", 8, "16:9", { resolution: "720p" })
    expect(r8.cost).toBe(0.75) // 8s 720p
    const r10 = await provider.textToVideo("p", "gemini-omni-video", 10, "16:9", { resolution: "1080p" })
    expect(r10.cost).toBe(0.9) // 10s 1080p band
  })

  it("4K reports the higher per-duration cost", async () => {
    const r = await provider.imageToVideo("https://x/s.png", "p", "gemini-omni-video", 4, undefined, { resolution: "4k" })
    expect(r.cost).toBe(1.05) // 4s 4K
    const r10 = await provider.imageToVideo("https://x/s.png", "p", "gemini-omni-video", 10, undefined, { resolution: "4k" })
    expect(r10.cost).toBe(1.5) // 10s 4K
  })

  it("V2V reports the flat per-generation cost by resolution band", async () => {
    const sd = await provider.imageToVideo("https://x/s.png", "p", "gemini-omni-video", 8, undefined, { resolution: "1080p", referenceVideoUrls: ["https://x/v.mp4"] })
    expect(sd.cost).toBe(1.2) // V2V 720p/1080p flat
    const uhd = await provider.imageToVideo("https://x/s.png", "p", "gemini-omni-video", 8, undefined, { resolution: "4k", referenceVideoUrls: ["https://x/v.mp4"] })
    expect(uhd.cost).toBe(1.8) // V2V 4K flat
  })

  it("off-tier duration snaps before cost lookup (5 → 4s band)", async () => {
    const r = await provider.imageToVideo("https://x/s.png", "p", "gemini-omni-video", 5, undefined, { resolution: "720p" })
    expect(r.cost).toBe(0.45) // snapped to 4s
  })
})
