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
// Gemini Omni Video — aspect_ratio is MANDATORY on the wire
//
// KIE 422s with "Aspect ratio only supports [16:9, 9:16]" when aspect_ratio is
// absent — unlike every other KIE video model, which defaults it server-side.
// The config panel only *displays* 16:9 as a placeholder and never writes it to
// node data, so an untouched node reached the provider with nothing and EVERY
// run failed (prod job e6dd780e, 2026-07-28). These pin that the provider now
// always emits a value KIE accepts, whatever the caller supplies.
// ---------------------------------------------------------------------------

describe("KieVideoProvider — gemini-omni-video aspect_ratio", () => {
  const aspectOf = () =>
    (mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>).aspect_ratio

  it("I2V: defaults to 16:9 when the caller supplies no aspect ratio", async () => {
    await provider.imageToVideo(
      "https://x/start.png", "a prompt", "gemini-omni-video", 10, undefined, {},
    )
    expect(aspectOf()).toBe("16:9")
  })

  it("T2V: defaults to 16:9 when the caller supplies no aspect ratio", async () => {
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, undefined, {})
    expect(aspectOf()).toBe("16:9")
  })

  it("preserves an explicitly supported ratio", async () => {
    await provider.imageToVideo(
      "https://x/start.png", "a prompt", "gemini-omni-video", 8, undefined,
      { aspectRatio: "9:16" },
    )
    expect(aspectOf()).toBe("9:16")
  })

  it.each([
    ["1:1", "16:9"],
    ["4:3", "16:9"],
    ["21:9", "16:9"],
    ["4:5", "9:16"],
    ["3:4", "9:16"],
    ["9:21", "9:16"],
  ])("snaps unsupported %s to the nearest supported %s", async (requested, expected) => {
    await provider.imageToVideo(
      "https://x/start.png", "a prompt", "gemini-omni-video", 8, undefined,
      { aspectRatio: requested },
    )
    expect(aspectOf()).toBe(expected)
  })

  it.each(["Auto", "adaptive"])("falls back to 16:9 for the non-ratio token %s", async (token) => {
    await provider.textToVideo("a prompt", "gemini-omni-video", 8, token, {})
    expect(aspectOf()).toBe("16:9")
  })

  it("V2V: still sends an aspect ratio alongside video_list", async () => {
    await provider.imageToVideo(
      "https://x/start.png", "a prompt", "gemini-omni-video", 8, undefined,
      { referenceVideoUrls: ["https://x/v.mp4"] },
    )
    expect(aspectOf()).toBe("16:9")
  })
})

// ---------------------------------------------------------------------------
// Gemini Omni Video — imageToVideo
// ---------------------------------------------------------------------------

describe("KieVideoProvider — gemini-omni-video imageToVideo", () => {
  it("I2V: image_urls has start + ref, and the prompt BINDS the roles — frame vs identity", async () => {
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

    expect(capturedInput.image_urls).toEqual(["https://x/start.png", "https://x/r.png"])
    expect(capturedInput.duration).toBe("8")
    expect(capturedInput.resolution).toBe("1080p")
    // The binding is what makes the list mean something to a multimodal model:
    // without it the refs are loose context and the cast drifts (2026-08-14).
    expect(capturedInput.prompt).toBe(
      "a prompt\n\nUse @image_1 as the opening (first) frame of the video. " +
        "@image_2 is an identity reference for this shot's subjects — match its subject's exact appearance; it is not a frame.",
    )
  })

  it("I2V without references stays byte-identical: single image, prompt untouched", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      { resolution: "1080p" },
    )
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(capturedInput.image_urls).toEqual(["https://x/start.png"])
    expect(capturedInput.prompt).toBe("a prompt")
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

  it("Quota: a video eats two slots — trailing refs drop to fit, start frame and video kept", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      {
        resolution: "1080p",
        // start (1) + 5 refs = 6 images + 1 video (2 units) = 8 > 7 → one ref drops
        referenceImageUrls: [
          "https://x/r1.png",
          "https://x/r2.png",
          "https://x/r3.png",
          "https://x/r4.png",
          "https://x/r5.png",
        ],
        referenceVideoUrls: ["https://x/v.mp4"],
      },
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(capturedInput.image_urls).toEqual([
      "https://x/start.png",
      "https://x/r1.png",
      "https://x/r2.png",
      "https://x/r3.png",
      "https://x/r4.png",
    ])
    expect(capturedInput.video_list).toBeDefined()
  })

  it("Quota: image-only overflow drops TRAILING refs to fit 7 — the render is never rejected for our own merge", async () => {
    await provider.imageToVideo(
      "https://x/start.png",
      "a prompt",
      "gemini-omni-video",
      8,
      undefined,
      {
        resolution: "1080p",
        // start (1) + 7 refs = 8 images total → the last ref drops
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
    )

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect((capturedInput.image_urls as string[]).length).toBe(7)
    expect((capturedInput.image_urls as string[])[0]).toBe("https://x/start.png")
    // The binding names exactly the kept span, not the asked-for one.
    expect(capturedInput.prompt).toContain("@image_2 through @image_7")
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

// Gemini Omni Video — per-tier provider cost (the under-charge fix: the provider must
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

// ---------------------------------------------------------------------------
// Gemini Omni Flash 1.1 — the sibling SKU served by the SAME runGeminiOmni.
// Every assertion above keeps exercising the pro model; these pin the four
// things that must differ per SKU (KIE id, resolution list, tier cost, the
// required `duration`) and the two family behaviours flash must inherit.
// ---------------------------------------------------------------------------

describe("KieVideoProvider — gemini-omni-flash", () => {
  it("dispatches to the PREFIXED KIE id (the pro sibling's is the bare id)", async () => {
    await provider.textToVideo("a prompt", "gemini-omni-flash", 8, "16:9", { resolution: "720p" })

    expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
    expect(mocks.mockRunKieTask.mock.calls[0][0]).toBe("google/gemini-omni-flash-1-1")
  })

  it("T2V/I2V body carries the mandatory aspect_ratio and a string duration", async () => {
    await provider.imageToVideo("https://x/start.png", "a prompt", "gemini-omni-flash", 8, undefined, {})

    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(capturedInput.duration).toBe("8")
    expect(capturedInput.aspect_ratio).toBe("16:9") // never omitted — 422 otherwise
    expect(capturedInput.resolution).toBe("720p")
  })

  it("V2V still carries `duration` (flash's schema lists it as REQUIRED)", async () => {
    await provider.imageToVideo("https://x/start.png", "a prompt", "gemini-omni-flash", 8, undefined, {
      referenceVideoUrls: ["https://x/v.mp4"],
    })

    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(capturedInput.video_list).toBeDefined()
    expect(capturedInput.duration).toBe("8")
  })

  it("360p is NOT exposed on flash — an off-catalog tier collapses to 720p", async () => {
    // The KIE schema lists 360p, but it shares the 720p/1080p credit band, so
    // the catalog deliberately stops at 720p and the runtime allowlist (which is
    // derived from that catalog) must agree.
    await provider.textToVideo("a prompt", "gemini-omni-flash", 8, "16:9", { resolution: "360p" })

    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(capturedInput.resolution).toBe("720p")
  })

  it("4k survives on flash (a tier the catalog DOES declare)", async () => {
    await provider.textToVideo("a prompt", "gemini-omni-flash", 8, "16:9", { resolution: "4k" })

    const capturedInput = mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
    expect(capturedInput.resolution).toBe("4k")
  })

  it("reports the FLASH tier cost, never the pro model's", async () => {
    const r4 = await provider.textToVideo("p", "gemini-omni-flash", 4, "16:9", { resolution: "720p" })
    expect(r4.cost).toBeCloseTo(0.315, 6) // pro is 0.45 at the same tier
    const r10 = await provider.imageToVideo("https://x/s.png", "p", "gemini-omni-flash", 10, undefined, { resolution: "4k" })
    expect(r10.cost).toBeCloseTo(1.05, 6) // pro is 1.5
    const vref = await provider.imageToVideo("https://x/s.png", "p", "gemini-omni-flash", 8, undefined, {
      resolution: "1080p",
      referenceVideoUrls: ["https://x/v.mp4"],
    })
    expect(vref.cost).toBeCloseTo(0.84, 6) // pro is 1.2
    const vref4k = await provider.imageToVideo("https://x/s.png", "p", "gemini-omni-flash", 8, undefined, {
      resolution: "4k",
      referenceVideoUrls: ["https://x/v.mp4"],
    })
    expect(vref4k.cost).toBeCloseTo(1.26, 6) // pro is 1.8
  })

  it("inherits the family rejects: >1 source video and the 7-unit input quota", async () => {
    await expect(
      provider.textToVideo("p", "gemini-omni-flash", 8, "16:9", {
        referenceVideoUrls: ["https://x/v1.mp4", "https://x/v2.mp4"],
      }),
    ).rejects.toThrow(/only one source video/)

    await expect(
      provider.textToVideo("p", "gemini-omni-flash", 8, "16:9", {
        referenceImageUrls: Array.from({ length: 8 }, (_, i) => `https://x/r${i}.png`),
      }),
    ).rejects.toThrow(/too many inputs/)
  })
})
