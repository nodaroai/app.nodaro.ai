/**
 * Replicate lip-sync provider tests.
 *
 * `replicateLipSync` is the dispatch hub for the four Replicate-direct
 * lip-sync models (LatentSync, Wav2Lip, Video-Retalking, SadTalker). Each
 * has a different version hash, different face/audio param names, and
 * different optional knobs. Misrouting any one of these silently sends
 * the request to the wrong Replicate model and the prediction either
 * fails or — worse — succeeds against the wrong model and bills for it.
 *
 * Tests cover:
 *   - Unknown provider rejection
 *   - Per-provider version + face/audio param routing (4 models)
 *   - Per-provider optional params (LatentSync / Wav2Lip / SadTalker)
 *   - camelCase → snake_case param name conversion
 *   - Cross-provider param isolation (e.g. wav2lip params don't leak when
 *     calling latentsync)
 *   - Output extraction: string / array / object via extractUrl
 *   - Cost passthrough via extractCost
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockCreate = vi.fn()
  const mockWait = vi.fn()
  const mockExtractUrl = vi.fn((v: unknown) => String(v))
  const mockExtractCost = vi.fn().mockReturnValue(0.0125)
  return { mockCreate, mockWait, mockExtractUrl, mockExtractCost }
})

vi.mock("../client.js", () => ({
  replicate: {
    predictions: { create: mocks.mockCreate },
    wait: mocks.mockWait,
  },
  extractUrl: mocks.mockExtractUrl,
  extractCost: mocks.mockExtractCost,
}))

import { replicateLipSync } from "../lip-sync.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockCreate.mockResolvedValue({ id: "pred-1" })
  mocks.mockWait.mockResolvedValue({
    output: "https://replicate.example/lipsync.mp4",
    metrics: { predict_time: 12 },
  })
  mocks.mockExtractUrl.mockImplementation((v: unknown) => String(v))
  mocks.mockExtractCost.mockReturnValue(0.0125)
})

const FACE = "https://example.com/face.mp4"
const AUDIO = "https://example.com/audio.mp3"

// ===========================================================================
// 1) Unknown provider
// ===========================================================================

describe("replicateLipSync — unknown provider", () => {
  it("throws when provider is not in LIP_SYNC_MODEL_CONFIGS", async () => {
    await expect(replicateLipSync("not-a-real-model", FACE, AUDIO)).rejects.toThrow(
      /Unsupported Replicate lip-sync provider: not-a-real-model/,
    )
    expect(mocks.mockCreate).not.toHaveBeenCalled()
  })

  it("throws on empty string provider", async () => {
    await expect(replicateLipSync("", FACE, AUDIO)).rejects.toThrow(
      /Unsupported Replicate lip-sync provider/,
    )
  })
})

// ===========================================================================
// 2) Per-provider version + face/audio param routing
// ===========================================================================

describe("replicateLipSync — version + face/audio param routing", () => {
  it("latentsync: uses video/audio params + correct version", async () => {
    await replicateLipSync("latentsync", FACE, AUDIO)

    expect(mocks.mockCreate).toHaveBeenCalledWith({
      version: "637ce1919f807ca20da3a448ddc2743535d2853649574cd52a933120e9b9e293",
      input: {
        video: FACE,
        audio: AUDIO,
      },
    })
  })

  it("wav2lip: uses face/audio params + correct version", async () => {
    await replicateLipSync("wav2lip", FACE, AUDIO)

    expect(mocks.mockCreate).toHaveBeenCalledWith({
      version: "8d65e3f4f4298520e079198b493c25adfc43c058ffec924f2aefc8010ed25eef",
      input: {
        face: FACE,
        audio: AUDIO,
      },
    })
  })

  it("video-retalking: uses face/input_audio params + correct version", async () => {
    await replicateLipSync("video-retalking", FACE, AUDIO)

    expect(mocks.mockCreate).toHaveBeenCalledWith({
      version: "db5a650c807b007dc5f9e5abe27c53e1b62880d1f94d218d27ce7fa802711d67",
      input: {
        face: FACE,
        input_audio: AUDIO,
      },
    })
  })

  it("sadtalker: uses source_image/driven_audio params + correct version", async () => {
    await replicateLipSync("sadtalker", FACE, AUDIO)

    expect(mocks.mockCreate).toHaveBeenCalledWith({
      version: "a519cc0cfebaaeade068b23899165a11ec76aaa1d2b313d40d214f204ec957a3",
      input: {
        source_image: FACE,
        driven_audio: AUDIO,
      },
    })
  })

  it("each provider uses a distinct version hash (no overlap)", async () => {
    const providers = ["latentsync", "wav2lip", "video-retalking", "sadtalker"]
    const versions = new Set<string>()
    for (const p of providers) {
      mocks.mockCreate.mockClear()
      await replicateLipSync(p, FACE, AUDIO)
      const callArg = mocks.mockCreate.mock.calls[0][0] as { version: string }
      versions.add(callArg.version)
    }
    expect(versions.size).toBe(4)
  })
})

// ===========================================================================
// 3) Per-provider optional parameters
// ===========================================================================

describe("replicateLipSync — LatentSync params", () => {
  it("forwards guidanceScale → guidance_scale (snake_case)", async () => {
    await replicateLipSync("latentsync", FACE, AUDIO, { guidanceScale: 1.5 })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ guidance_scale: 1.5 }),
    }))
  })

  it("forwards inferenceSteps → inference_steps", async () => {
    await replicateLipSync("latentsync", FACE, AUDIO, { inferenceSteps: 25 })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ inference_steps: 25 }),
    }))
  })

  it("forwards seed", async () => {
    await replicateLipSync("latentsync", FACE, AUDIO, { seed: 42 })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ seed: 42 }),
    }))
  })

  it("forwards seed=0 (preserved, not coalesced)", async () => {
    // 0 is a meaningful seed value; the impl uses `!== undefined` so it
    // shouldn't be skipped.
    await replicateLipSync("latentsync", FACE, AUDIO, { seed: 0 })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ seed: 0 }),
    }))
  })

  it("omits unset latentsync params", async () => {
    await replicateLipSync("latentsync", FACE, AUDIO, { guidanceScale: 1 })

    const input = (mocks.mockCreate.mock.calls[0][0] as { input: Record<string, unknown> }).input
    expect(input.inference_steps).toBeUndefined()
    expect(input.seed).toBeUndefined()
  })
})

describe("replicateLipSync — Wav2Lip params", () => {
  it("forwards pads", async () => {
    await replicateLipSync("wav2lip", FACE, AUDIO, { pads: "0 10 0 0" })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ pads: "0 10 0 0" }),
    }))
  })

  it("forwards smooth", async () => {
    await replicateLipSync("wav2lip", FACE, AUDIO, { smooth: true })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ smooth: true }),
    }))
  })

  it("forwards smooth=false (preserved)", async () => {
    await replicateLipSync("wav2lip", FACE, AUDIO, { smooth: false })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ smooth: false }),
    }))
  })

  it("forwards fps", async () => {
    await replicateLipSync("wav2lip", FACE, AUDIO, { fps: 30 })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ fps: 30 }),
    }))
  })

  it("forwards resizeFactor → resize_factor (snake_case)", async () => {
    await replicateLipSync("wav2lip", FACE, AUDIO, { resizeFactor: 2 })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ resize_factor: 2 }),
    }))
  })
})

describe("replicateLipSync — SadTalker params", () => {
  it("forwards enhancer", async () => {
    await replicateLipSync("sadtalker", FACE, AUDIO, { enhancer: "gfpgan" })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ enhancer: "gfpgan" }),
    }))
  })

  it("forwards preprocess", async () => {
    await replicateLipSync("sadtalker", FACE, AUDIO, { preprocess: "full" })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ preprocess: "full" }),
    }))
  })

  it("forwards still", async () => {
    await replicateLipSync("sadtalker", FACE, AUDIO, { still: true })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ still: true }),
    }))
  })

  it("forwards poseStyle → pose_style (snake_case)", async () => {
    await replicateLipSync("sadtalker", FACE, AUDIO, { poseStyle: 5 })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ pose_style: 5 }),
    }))
  })

  it("forwards expressionScale → expression_scale (snake_case)", async () => {
    await replicateLipSync("sadtalker", FACE, AUDIO, { expressionScale: 1.2 })

    expect(mocks.mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ expression_scale: 1.2 }),
    }))
  })
})

// ===========================================================================
// 4) Cross-provider param isolation
// ===========================================================================

describe("replicateLipSync — param isolation between providers", () => {
  it("wav2lip params are NOT forwarded when calling latentsync", async () => {
    await replicateLipSync("latentsync", FACE, AUDIO, {
      guidanceScale: 1, // valid for latentsync
      pads: "ignored", // wav2lip-only
      smooth: true, // wav2lip-only
      enhancer: "ignored", // sadtalker-only
    })

    const input = (mocks.mockCreate.mock.calls[0][0] as { input: Record<string, unknown> }).input
    expect(input.guidance_scale).toBe(1)
    expect(input.pads).toBeUndefined()
    expect(input.smooth).toBeUndefined()
    expect(input.enhancer).toBeUndefined()
  })

  it("latentsync params are NOT forwarded when calling wav2lip", async () => {
    await replicateLipSync("wav2lip", FACE, AUDIO, {
      pads: "0 0 0 0", // valid for wav2lip
      guidanceScale: 99, // latentsync-only
      inferenceSteps: 99, // latentsync-only
      poseStyle: 99, // sadtalker-only
    })

    const input = (mocks.mockCreate.mock.calls[0][0] as { input: Record<string, unknown> }).input
    expect(input.pads).toBe("0 0 0 0")
    expect(input.guidance_scale).toBeUndefined()
    expect(input.inference_steps).toBeUndefined()
    expect(input.pose_style).toBeUndefined()
  })

  it("sadtalker params are NOT forwarded when calling video-retalking", async () => {
    await replicateLipSync("video-retalking", FACE, AUDIO, {
      enhancer: "ignored",
      poseStyle: 99,
      expressionScale: 99,
      pads: "ignored",
    })

    const input = (mocks.mockCreate.mock.calls[0][0] as { input: Record<string, unknown> }).input
    // video-retalking has no optional params in the impl — only face/audio.
    expect(input.enhancer).toBeUndefined()
    expect(input.pose_style).toBeUndefined()
    expect(input.expression_scale).toBeUndefined()
    expect(input.pads).toBeUndefined()
    // But the required ones are still set:
    expect(input.face).toBe(FACE)
    expect(input.input_audio).toBe(AUDIO)
  })
})

// ===========================================================================
// 5) Output extraction
// ===========================================================================

describe("replicateLipSync — output extraction", () => {
  it("extracts videoUrl from string output", async () => {
    mocks.mockWait.mockResolvedValueOnce({
      output: "https://replicate.example/string-out.mp4",
      metrics: {},
    })

    const result = await replicateLipSync("latentsync", FACE, AUDIO)

    expect(mocks.mockExtractUrl).toHaveBeenCalledWith("https://replicate.example/string-out.mp4")
    expect(result.videoUrl).toBe("https://replicate.example/string-out.mp4")
  })

  it("extracts videoUrl from array output (uses first element)", async () => {
    mocks.mockWait.mockResolvedValueOnce({
      output: ["https://first.mp4", "https://second.mp4"],
      metrics: {},
    })

    await replicateLipSync("latentsync", FACE, AUDIO)

    expect(mocks.mockExtractUrl).toHaveBeenCalledWith("https://first.mp4")
  })

  it("extracts videoUrl from object output (passes whole object to extractUrl)", async () => {
    const fileOutput = { url: "https://file-output.mp4" }
    mocks.mockWait.mockResolvedValueOnce({ output: fileOutput, metrics: {} })

    await replicateLipSync("latentsync", FACE, AUDIO)

    expect(mocks.mockExtractUrl).toHaveBeenCalledWith(fileOutput)
  })

  it("handles empty array output by passing empty array to extractUrl", async () => {
    mocks.mockWait.mockResolvedValueOnce({ output: [], metrics: {} })

    await replicateLipSync("latentsync", FACE, AUDIO)

    // The impl: `Array.isArray(output) && output.length > 0 ? output[0] : output`
    // Empty array → falls through to passing the empty array itself.
    expect(mocks.mockExtractUrl).toHaveBeenCalledWith([])
  })
})

// ===========================================================================
// 6) Cost passthrough
// ===========================================================================

describe("replicateLipSync — cost passthrough", () => {
  it("returns cost from extractCost", async () => {
    mocks.mockExtractCost.mockReturnValueOnce(0.045)

    const result = await replicateLipSync("latentsync", FACE, AUDIO)

    expect(result.cost).toBe(0.045)
  })

  it("returns null cost when extractCost returns null", async () => {
    mocks.mockExtractCost.mockReturnValueOnce(null)

    const result = await replicateLipSync("latentsync", FACE, AUDIO)

    expect(result.cost).toBeNull()
  })

  it("calls extractCost with prediction.metrics", async () => {
    mocks.mockWait.mockResolvedValueOnce({
      output: "u",
      metrics: { predict_time: 30 },
    })

    await replicateLipSync("latentsync", FACE, AUDIO)

    expect(mocks.mockExtractCost).toHaveBeenCalledWith({ predict_time: 30 }, "latentsync")
  })

  it("handles undefined metrics", async () => {
    mocks.mockWait.mockResolvedValueOnce({ output: "u", metrics: undefined })

    await replicateLipSync("latentsync", FACE, AUDIO)

    expect(mocks.mockExtractCost).toHaveBeenCalledWith(undefined, "latentsync")
  })
})

// ===========================================================================
// 7) End-to-end shape
// ===========================================================================

describe("replicateLipSync — return shape", () => {
  it("returns { videoUrl, cost } object", async () => {
    const result = await replicateLipSync("wav2lip", FACE, AUDIO)

    expect(result).toEqual({
      videoUrl: expect.any(String),
      cost: expect.any(Number),
    })
  })

  it("propagates errors from replicate.predictions.create", async () => {
    mocks.mockCreate.mockRejectedValueOnce(new Error("Replicate 503"))

    await expect(replicateLipSync("latentsync", FACE, AUDIO)).rejects.toThrow(
      /Replicate 503/,
    )
  })

  it("propagates errors from replicate.wait", async () => {
    mocks.mockWait.mockRejectedValueOnce(new Error("Prediction timed out"))

    await expect(replicateLipSync("latentsync", FACE, AUDIO)).rejects.toThrow(
      /timed out/,
    )
  })
})
