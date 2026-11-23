import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * LTX 2.5 dispatch guard.
 *
 * The bespoke `runLtx25` builds the body from an explicit allow-list
 * (ltx-2-5.ts) on both lanes. A regression that routed the model onto the
 * generic createTask path would spread `extraParams`, stringify `duration`,
 * forward an end frame, a negative prompt or an audio switch, or send an
 * `aspect_ratio` to the image endpoint — these pins are the guard. The frame
 * rate reaches the body, and the length is capped at 1440p / 48-50 fps.
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
  extractCreditFields: () => ({ credits: 156 }),
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

import { KieVideoProvider, LTX_2_5_RATE_USD_PER_SEC, ltx25CostUsd } from "../video.js"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../models.js"

const START = "https://x/start.png"
const END = "https://x/end.png"
let provider: KieVideoProvider

const captured = () => mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>
const capturedModel = () => mocks.mockRunKieTask.mock.calls[0][0] as string
// runKieTask(model, input, maxPolls, onProgress, reconcileOpts)
const capturedReconcile = () => mocks.mockRunKieTask.mock.calls[0][4] as { modelKey?: string; dimensions?: Record<string, unknown> }

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

describe("LTX 2.5 — model configs", () => {
  it("each tier is one id in both maps, each on its own KIE endpoint, with no end frame and no content-filter lever", () => {
    expect(KIE_VIDEO_MODELS["ltx-2.5-fast"]!.model).toBe("ltx/2-5-fast-image-to-video")
    expect(KIE_TEXT_TO_VIDEO_MODELS["ltx-2.5-fast"]!.model).toBe("ltx/2-5-fast-text-to-video")
    expect(KIE_VIDEO_MODELS["ltx-2.5-pro"]!.model).toBe("ltx/2-5-pro-image-to-video")
    expect(KIE_TEXT_TO_VIDEO_MODELS["ltx-2.5-pro"]!.model).toBe("ltx/2-5-pro-text-to-video")
    for (const id of ["ltx-2.5-fast", "ltx-2.5-pro"]) {
      for (const cfg of [KIE_VIDEO_MODELS[id]!, KIE_TEXT_TO_VIDEO_MODELS[id]!]) {
        expect(cfg.omitSeed).toBeUndefined()
        expect(cfg.extraParams).toBeUndefined()
        expect(cfg.safetyLevers).toBeUndefined()
      }
      expect(KIE_VIDEO_MODELS[id]!.supportsEndFrame).toBe(false)
    }
    expect(KIE_VIDEO_MODELS["ltx-2.5-fast"]!.allowedDurations).toEqual([6, 8, 10, 12, 14, 16, 18, 20])
    expect(KIE_VIDEO_MODELS["ltx-2.5-pro"]!.allowedDurations).toEqual([6, 8, 10])
  })

  it("LTX 2.3 keeps its Replicate wiring: neither 2.3 id is a KIE config", () => {
    for (const id of ["ltx-2.3-pro", "ltx-2.3-fast"]) {
      expect(KIE_VIDEO_MODELS[id]).toBeUndefined()
      expect(KIE_TEXT_TO_VIDEO_MODELS[id]).toBeUndefined()
    }
  })
})

describe("LTX 2.5 — image to video", () => {
  it("a start frame takes the image endpoint: image_url, integer duration, resolution, fps, seed — no aspect ratio, no end frame, no negative prompt, no audio switch", async () => {
    await provider.imageToVideo(START, "the baker turns", "ltx-2.5-fast", 8, END, {
      resolution: "720p",
      fps: 25,
      seed: 42,
      aspectRatio: "9:16",
      negativePrompt: "blur",
      generateAudio: false,
      sound: false,
      cfgScale: 0.5,
    })
    expect(capturedModel()).toBe("ltx/2-5-fast-image-to-video")
    const input = captured()
    expect(Object.keys(input).sort()).toEqual(["duration", "fps", "image_url", "prompt", "resolution", "seed"])
    expect(input.duration).toBe(8)
    expect(typeof input.duration).toBe("number")
    expect(input.resolution).toBe("720p")
    expect(input.fps).toBe(25)
    expect(input.seed).toBe(42)
    // The negative prompt is dropped, never folded into the prompt.
    expect(input.prompt).toBe("the baker turns")
    expect(capturedReconcile().modelKey).toBe("ltx-2.5-fast")
  })

  it("Pro takes its own image endpoint", async () => {
    await provider.imageToVideo(START, "p", "ltx-2.5-pro", 10, undefined, { resolution: "1080p" })
    expect(capturedModel()).toBe("ltx/2-5-pro-image-to-video")
    expect(captured().resolution).toBe("1080p")
  })

  it("no frame on the image lane falls to the text-to-video endpoint with the default ratio", async () => {
    await provider.imageToVideo(undefined, "p", "ltx-2.5-pro", 6, undefined, {})
    expect(capturedModel()).toBe("ltx/2-5-pro-text-to-video")
    expect(captured().aspect_ratio).toBe("16:9")
    expect(captured().image_url).toBeUndefined()
  })
})

describe("LTX 2.5 — text to video", () => {
  it("the text endpoint: aspect ratio, resolution, fps and an integer duration", async () => {
    await provider.textToVideo("a street vendor says \"Fresh noodles!\"", "ltx-2.5-fast", 20, "2:3", { resolution: "1080p", fps: 24 })
    expect(capturedModel()).toBe("ltx/2-5-fast-text-to-video")
    const input = captured()
    expect(Object.keys(input).sort()).toEqual(["aspect_ratio", "duration", "fps", "prompt", "resolution"])
    expect(input).toMatchObject({ aspect_ratio: "2:3", resolution: "1080p", fps: 24, duration: 20 })
  })

  it("Fast at 1440p or at 48 / 50 fps sends at most 10 s", async () => {
    await provider.textToVideo("p", "ltx-2.5-fast", 16, "16:9", { resolution: "1440p" })
    expect(captured()).toMatchObject({ resolution: "1440p", duration: 10, fps: 24 })
    mocks.mockRunKieTask.mockClear()
    await provider.textToVideo("p", "ltx-2.5-fast", 20, "16:9", { resolution: "720p", fps: 50 })
    expect(captured()).toMatchObject({ resolution: "720p", duration: 10, fps: 50 })
    mocks.mockRunKieTask.mockClear()
    await provider.textToVideo("p", "ltx-2.5-fast", 20, "16:9", { resolution: "720p", fps: 25 })
    expect(captured()).toMatchObject({ duration: 20, fps: 25 })
  })

  it("Pro has no length cap at 48 / 50 fps (its lengths are 6-10 s at every frame rate)", async () => {
    await provider.textToVideo("p", "ltx-2.5-pro", 10, "1:1", { resolution: "720p", fps: 48 })
    expect(captured()).toMatchObject({ duration: 10, fps: 48, aspect_ratio: "1:1" })
  })

  it("defaults: 1080p, 10 s, 24 fps; an off-list resolution and frame rate fall to them; seed -1 is left out", async () => {
    await provider.textToVideo("p", "ltx-2.5-pro", undefined, undefined, { resolution: "1440p", fps: 30, seed: -1 })
    const input = captured()
    expect(input).toMatchObject({ resolution: "1080p", duration: 10, fps: 24, aspect_ratio: "16:9" })
    expect(input.seed).toBeUndefined()
  })
})

describe("LTX 2.5 — provider cost", () => {
  it("the tier's rate at the wire resolution × the seconds sent", async () => {
    const result = await provider.textToVideo("p", "ltx-2.5-fast", 16, "16:9", { resolution: "1440p" })
    expect(result.cost).toBeCloseTo(LTX_2_5_RATE_USD_PER_SEC["ltx-2.5-fast"]["1440p"]! * 10, 6)
    expect(ltx25CostUsd("ltx-2.5-pro", "720p", 6)).toBeCloseTo(0.072 * 6, 6)
  })
})

describe("LTX 2.5 Fast — audio to video (decided 2026-11-23)", () => {
  const AUDIO = "https://x/voice.mp3"

  it("a run marked audio-to-video takes the audio endpoint with the measured length as sent, on either lane", async () => {
    await provider.textToVideo("she sings the chorus", "ltx-2.5-fast", 7.2, "9:16", {
      audioToVideo: true,
      referenceAudioUrls: [AUDIO],
      resolution: "720p",
      fps: 25,
      seed: 7,
      aspectRatio: "9:16",
    })
    expect(capturedModel()).toBe("ltx/2-5-fast-audio-to-video")
    const input = captured()
    expect(Object.keys(input).sort()).toEqual(["audio_url", "duration", "fps", "prompt", "resolution", "seed"])
    expect(input).toMatchObject({ audio_url: AUDIO, duration: 7.2, resolution: "720p", fps: 25, seed: 7 })
    expect(input.aspect_ratio).toBeUndefined()
  })

  it("with a start frame it sends the frame too; the recorded cost is the rate on the seconds sent", async () => {
    const res = await provider.imageToVideo(START, "he speaks", "ltx-2.5-fast", 5.5, undefined, {
      audioToVideo: true,
      referenceAudioUrls: [AUDIO],
      resolution: "1080p",
    })
    expect(capturedModel()).toBe("ltx/2-5-fast-audio-to-video")
    expect(captured()).toMatchObject({ audio_url: AUDIO, duration: 5.5, resolution: "1080p", fps: 24 })
    expect(typeof captured().image_url).toBe("string")
    expect(res.cost).toBeCloseTo(ltx25CostUsd("ltx-2.5-fast", "1080p", 5.5), 10)
  })

  it("on the image lane without a start frame (Generate Video with only a clip wired) it reaches the audio endpoint", async () => {
    await provider.imageToVideo(undefined, "a song", "ltx-2.5-fast", 4.4, undefined, {
      audioToVideo: true,
      referenceAudioUrls: [AUDIO],
      resolution: "720p",
    })
    expect(capturedModel()).toBe("ltx/2-5-fast-audio-to-video")
    expect(Object.keys(captured()).sort()).toEqual(["audio_url", "duration", "fps", "prompt", "resolution"])
    expect(captured().duration).toBe(4.4)
  })

  it("an audio clip on a run not marked audio-to-video is not sent (the text endpoint, as before)", async () => {
    await provider.textToVideo("a quiet street", "ltx-2.5-fast", 8, "16:9", { referenceAudioUrls: [AUDIO], resolution: "720p" })
    expect(capturedModel()).toBe("ltx/2-5-fast-text-to-video")
    expect(captured().audio_url).toBeUndefined()
  })

  it("a run marked audio-to-video on Pro, or without its clip, fails before any task is created", async () => {
    await expect(provider.textToVideo("x", "ltx-2.5-pro", 6, "16:9", { audioToVideo: true, referenceAudioUrls: [AUDIO] })).rejects.toThrow()
    await expect(provider.textToVideo("x", "ltx-2.5-fast", 6, "16:9", { audioToVideo: true })).rejects.toThrow()
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
  })
})
