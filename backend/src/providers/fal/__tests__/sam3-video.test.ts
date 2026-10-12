import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const runFalRequest = vi.fn()
vi.mock("../client.js", () => ({ runFalRequest: (opts: unknown) => runFalRequest(opts) }))

import { parseSam3VideoOutput, runSam3Video, SAM3_VIDEO_MODELS } from "../sam3-video.js"
import { decodeMaskRle } from "../../video/video-mask.js"

const fixture = JSON.parse(readFileSync(resolve(__dirname, "fixtures/sam3-video-rle.json"), "utf8")) as {
  width: number
  height: number
  response: { rle: string[] }
}

beforeEach(() => runFalRequest.mockReset())

describe("SAM 3 video (fal)", () => {
  it("reads the endpoint's recorded answer as one RLE per frame, decodable on the clip's geometry", () => {
    const rle = parseSam3VideoOutput(fixture.response)
    expect(rle).toHaveLength(3)
    const frame = new Uint8Array(fixture.width * fixture.height)
    // The recorded frame 0 covers ~43 % of the frame (the trees); the blank frame nothing.
    expect(decodeMaskRle(rle[0]!, frame) / frame.length).toBeGreaterThan(0.4)
    expect(decodeMaskRle(rle[1]!, frame)).toBe(0)
    expect(decodeMaskRle(rle[2]!, frame) / frame.length).toBeGreaterThan(0.4)
  })

  it("refuses any other shape loudly (the published schema's { video } included)", () => {
    expect(() => parseSam3VideoOutput({ video: { url: "https://x/y.mp4" } })).toThrow(/unexpected shape/)
    expect(() => parseSam3VideoOutput({ rle: [1, 2] })).toThrow(/unexpected shape/)
    expect(() => parseSam3VideoOutput(null)).toThrow(/unexpected shape/)
    expect(() => parseSam3VideoOutput({ rle: [] })).toThrow(/no frames/)
    // Deterministic: the same request answers the same shape, and a retry would pay again.
    expect(() => parseSam3VideoOutput({ video: {} })).toThrow(expect.objectContaining({ deterministic: true }))
  })

  it.each([
    ["sam-3.1", "fal-ai/sam-3-1/video-rle", 0.01],
    ["sam-3", "fal-ai/sam-3/video-rle", 0.005],
  ] as const)("%s: its own endpoint, apply_mask: true (the only setting that tracks every object on every frame), priced per 16 frames", async (model, endpoint, rate) => {
    runFalRequest.mockResolvedValue({ output: fixture.response, requestId: "req-1" })
    const out = await runSam3Video({ model, videoUrl: "https://x/clip.mp4", prompt: "tree", threshold: 0.4, frameCount: 90 })
    expect(SAM3_VIDEO_MODELS[model].endpoint).toBe(endpoint)
    expect(runFalRequest).toHaveBeenCalledWith(expect.objectContaining({
      endpoint,
      input: { video_url: "https://x/clip.mp4", prompt: "tree", apply_mask: true, detection_threshold: 0.4 },
    }))
    // No reconcile registration: its RLE is rendered locally, which the generic fal finalize cannot do.
    expect(runFalRequest.mock.calls[0]![0]).not.toHaveProperty("reconcileOpts")
    expect(out.requestId).toBe("req-1")
    expect(out.cost).toBeCloseTo(Math.ceil(90 / 16) * rate, 10)
  })

})
