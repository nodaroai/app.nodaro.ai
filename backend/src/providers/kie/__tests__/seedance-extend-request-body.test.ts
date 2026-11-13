import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// The whole request an Extend Video run sends KIE, per Seedance provider.
//
// The extend worker (workers/handlers/video-ai.ts, pinned by
// extend-seedance25.test.ts) hands the provider exactly the arguments below;
// this file pins the body those arguments become — every key, deep-equal.
//
// - Seedance 2.5 (decided 2026-11-12, the provider guide's recipe): the
//   source's last seconds as @video_1, `omni_reference_task_type: "extend"`,
//   `aspect_ratio: "adaptive"`, the seconds added, the guide's prompt; NO start
//   image (no `first_frame_url`, no opening-frame image or prompt line).
// - Seedance 2.0 (unchanged since the 2026-07-12 spike): the source's last
//   frame as the opening image, moved into `reference_image_urls` beside the
//   2 s tail, bound by the prompt's opening-frame line, undeclared.
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

vi.mock("../kling3-client.js", () => ({ kling3Generate: mocks.mockKling3Generate }))

// The reference-video re-encode is tested on its own (both lanes run it);
// here every clip passes through as sent.
vi.mock("../reference-video-reencode.js", () => ({
  reencodeReferenceVideos: async (urls: string[]) => urls,
}))

vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.mockSafeFetch }))

// A small JPEG: the frame/reference normalizer passes it through untouched.
vi.mock("sharp", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.metadata = () => Promise.resolve({ format: "jpeg", width: 1280, height: 720 })
    chain.rotate = () => chain
    chain.resize = () => chain
    chain.jpeg = () => chain
    chain.webp = () => chain
    chain.png = () => chain
    chain.toBuffer = () => Promise.resolve(Buffer.from("png"))
    return chain
  }
  const mockSharp = () => makeChain()
  mockSharp.default = mockSharp
  return { default: mockSharp }
})

import { KieVideoProvider } from "../video.js"

const TAIL_URL = "https://r2.example.com/tmp/provider-input/job-1/extend-tail-aaaaaaaa.mp4"
const LAST_FRAME_URL = "https://r2.example.com/tmp/provider-input/job-1/extend-last-frame-bbbbbbbb.jpg"
const REF_A = "https://cdn.example.com/a.jpg"
/** What the shared image normalizer stores an image as before it is sent (tested on its own). */
const CONVERTED = "https://cdn.nodaro.ai/images/converted.png"

let provider: KieVideoProvider

const sent = (): { model: unknown; input: Record<string, unknown> } => {
  expect(mocks.mockRunKieTask).toHaveBeenCalledOnce()
  const [model, input] = mocks.mockRunKieTask.mock.calls[0]!
  return { model, input: input as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("KIE_SEEDANCE_25_OUTPUT_FORMAT", undefined as unknown as string)
  mocks.mockUploadBufferToR2.mockResolvedValue(CONVERTED)
  mocks.mockSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "image/jpeg" }),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
  })
  mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://kie.example.com/out.mp4"] }, taskId: "t1", providerMs: 1 })
  provider = new KieVideoProvider()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("Seedance 2.5 Extend — the provider guide's recipe, the whole body", () => {
  // What the worker passes: textToVideo(prompt, "seedance-2-5", 8, "adaptive", options).
  const OPTIONS = {
    resolution: "720p",
    generateAudio: true,
    referenceVideoUrls: [TAIL_URL],
    aspectRatio: "adaptive",
    referenceTaskType: "extend" as const,
  }

  it("the tail as @video_1, declared as an extension at adaptive, no start image", async () => {
    await provider.textToVideo("Extend @video_1 forward by 8 seconds: she opens the door", "seedance-2-5", 8, "adaptive", OPTIONS)
    const { model, input } = sent()
    expect(model).toBe("bytedance/seedance-2-5")
    expect(input).toEqual({
      prompt: "Extend @video_1 forward by 8 seconds: she opens the door",
      duration: 8,
      aspect_ratio: "adaptive",
      generate_audio: true,
      web_search: false,
      nsfw_checker: false,
      resolution: "720p",
      reference_video_urls: [TAIL_URL],
      omni_reference_task_type: "extend",
    })
    expect(input).not.toHaveProperty("first_frame_url")
    expect(input).not.toHaveProperty("reference_image_urls")
  })

  it("user references ride as reference images, with no opening-frame line", async () => {
    await provider.textToVideo("Extend @video_1 forward by 12 seconds: @image_1 walks in", "seedance-2-5", 12, "adaptive", {
      ...OPTIONS,
      referenceImageUrls: [REF_A],
    })
    const { input } = sent()
    expect(input).toEqual({
      prompt: "Extend @video_1 forward by 12 seconds: @image_1 walks in",
      duration: 12,
      aspect_ratio: "adaptive",
      generate_audio: true,
      web_search: false,
      nsfw_checker: false,
      resolution: "720p",
      reference_image_urls: [CONVERTED],
      reference_video_urls: [TAIL_URL],
      omni_reference_task_type: "extend",
    })
  })

  it("asks for mov when the worker passes it", async () => {
    await provider.textToVideo("Extend @video_1 forward by 8 seconds: x", "seedance-2-5", 8, "adaptive", { ...OPTIONS, outputFormat: "mov" })
    expect(sent().input).toMatchObject({ output_format: "mov", omni_reference_task_type: "extend" })
  })
})

describe("Seedance 2.0 Extend — unchanged, the whole body", () => {
  // What the worker passes: imageToVideo(lastFrame, prompt, "seedance-2", 8, undefined, options).
  const OPTIONS = {
    resolution: "720p",
    generateAudio: true,
    referenceVideoUrls: [TAIL_URL],
    aspectRatio: "adaptive",
  }

  it("the last frame as the opening image beside the 2 s tail, undeclared", async () => {
    await provider.imageToVideo(LAST_FRAME_URL, "extend @video_1 as follows:\nshe opens the door", "seedance-2", 8, undefined, OPTIONS)
    const { model, input } = sent()
    expect(model).toBe("bytedance/seedance-2")
    expect(input).toEqual({
      prompt: "extend @video_1 as follows:\nshe opens the door\n\nUse @image_1 as the opening (first) frame of the video.",
      duration: 8,
      aspect_ratio: "adaptive",
      generate_audio: true,
      web_search: false,
      nsfw_checker: false,
      resolution: "720p",
      reference_image_urls: [CONVERTED],
      reference_video_urls: [TAIL_URL],
    })
    expect(input).not.toHaveProperty("omni_reference_task_type")
  })
})
