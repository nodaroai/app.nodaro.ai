import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

/**
 * Kling 4.0 Flash through the KIE video provider: both lanes reach the bespoke
 * Kling 4.0 runner, which picks Flash's endpoint from what is wired, sends
 * 720p, drops an end frame, and reports Flash's own provider rate (17 KIE cr/s;
 * 11.3 with a reference video, at the 2 × output floor) — never Kling 4.0's.
 */

const mocks = vi.hoisted(() => ({
  runKieTask: vi.fn(),
  ensureVideoFitsSize: vi.fn(),
  safeFetch: vi.fn(),
  uploadBufferToR2: vi.fn(),
}))

vi.mock("../client.js", () => ({
  runKieTask: mocks.runKieTask,
  runVeoTask: vi.fn(),
  createSanitizedError: (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
  MAX_POLL_ATTEMPTS_VIDEO: 120,
}))
vi.mock("../reference-video-size.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../reference-video-size.js")>()),
  ensureVideoFitsSize: mocks.ensureVideoFitsSize,
}))
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../../../lib/storage.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadBufferToR2: mocks.uploadBufferToR2,
}))

const { KieVideoProvider } = await import("../video.js")

const FRAME = "https://elsewhere.example/frame.png"
const END = "https://elsewhere.example/end.png"
const REF_VIDEO = "https://cdn.example/ref.mp4"

beforeEach(async () => {
  vi.clearAllMocks()
  const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#3a6" } }).png().toBuffer()
  mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, body: { cancel: async () => {} }, arrayBuffer: async () => png })
  mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
  mocks.ensureVideoFitsSize.mockImplementation(async (u: string) => u)
  mocks.runKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1", providerMs: 1 })
})

const sent = () => mocks.runKieTask.mock.calls[0] as [string, Record<string, unknown>, ...unknown[]]

describe("Kling 4.0 Flash on the KIE video provider", () => {
  it("a prompt alone runs the reference endpoint at 720p (1080p asked) and costs 17 KIE cr/s", async () => {
    const result = await new KieVideoProvider().textToVideo("a cat on a roof", "kling-4-flash", 5, "16:9", { resolution: "1080p" })
    const [model, input] = sent()
    expect(model).toBe("kling-4.0/flash-reference-to-video")
    expect(input).toEqual({ prompt: "a cat on a roof", duration: 5, resolution: "720p", aspect_ratio: "16:9" })
    expect(result.cost).toBeCloseTo(0.085 * 5, 10)
  })

  it("a reference video costs the with-video rate at the 2 × output floor", async () => {
    const result = await new KieVideoProvider().textToVideo("move like @video_1", "kling-4-flash", 8, "auto", { referenceVideoUrls: [REF_VIDEO] })
    const [model, input] = sent()
    expect(model).toBe("kling-4.0/flash-reference-to-video")
    expect(input.video_urls).toEqual([REF_VIDEO])
    expect(result.cost).toBeCloseTo(0.0565 * 8 * 2, 10)
  })

  it("a duration past 20s snaps to Flash's top second", async () => {
    await new KieVideoProvider().textToVideo("a long take", "kling-4-flash", 30, "16:9")
    expect(sent()[1].duration).toBe(20)
  })

  it("a start frame alone runs the keyframe endpoint; an end frame is dropped", async () => {
    const result = await new KieVideoProvider().imageToVideo(FRAME, "the door opens", "kling-4-flash", 6, END, { aspectRatio: "9:16" })
    const [model, input] = sent()
    expect(model).toBe("kling-4.0/flash-keyframe-to-video")
    expect(Object.keys(input).sort()).toEqual(["duration", "first_frame_url", "prompt", "resolution"])
    expect(input.resolution).toBe("720p")
    expect(JSON.stringify(input)).not.toContain("end.png")
    expect(result.cost).toBeCloseTo(0.085 * 6, 10)
  })

  it("a start frame beside a reference video runs the reference endpoint, the frame among the images", async () => {
    await new KieVideoProvider().imageToVideo(FRAME, "the door opens", "kling-4-flash", 5, undefined, { referenceVideoUrls: [REF_VIDEO] })
    const [model, input] = sent()
    expect(model).toBe("kling-4.0/flash-reference-to-video")
    expect((input.image_urls as string[]).length).toBe(1)
    expect(input.video_urls).toEqual([REF_VIDEO])
  })
})
