import { describe, it, expect, vi, beforeEach } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import {
  IMAGE_TO_VIDEO_PROVIDERS,
  VIDEO_PROVIDERS_WITHOUT_DISPATCH,
  videoProviderAppendsFrames,
  videoProviderReferenceSyntax,
} from "@nodaro/shared/models"

/**
 * The frames-after-references convention AT THE WIRE, walked over the catalog.
 *
 * For every dispatchable KIE video model that `videoProviderAppendsFrames`,
 * a run with a start frame and two reference images must send ONE image list
 * with the references first (in order) and the frame after them, and the
 * prompt must bind that frame's seat as the opening frame in the provider's
 * own syntax. A new reference-capable model is covered the moment it joins
 * the catalog — it cannot ship frame-first by accident.
 */

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
  const mockRunVeoTask = vi.fn()
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
  return { mockRunKieTask, mockRunVeoTask, mockCreateSanitizedError, mockUploadBufferToR2, mockSafeFetch, sharpMeta }
})

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  runVeoTask: mocks.mockRunVeoTask,
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

import { KieVideoProvider } from "../video.js"
import { KIE_VIDEO_MODELS } from "../models.js"

const FRAME = "https://x/start.png"
const REFS = ["https://x/r1.png", "https://x/r2.png"]

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(mocks.sharpMeta, { format: "jpeg", width: 1024, height: 1024 })
  mocks.mockUploadBufferToR2.mockResolvedValue("https://cdn.nodaro.ai/images/converted.jpg")
  mocks.mockSafeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) })
  mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1", providerMs: 1 })
  mocks.mockRunVeoTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1", providerMs: 1 })
})

/** The image list and prompt the provider was actually sent. */
function sent(): { images: string[]; prompt: string } {
  if (mocks.mockRunVeoTask.mock.calls.length > 0) {
    const [, prompt, imageUrls] = mocks.mockRunVeoTask.mock.calls[0]!
    return { images: imageUrls as string[], prompt: prompt as string }
  }
  const input = mocks.mockRunKieTask.mock.calls[0]![1] as Record<string, unknown>
  const images = Object.values(input).find((v) => Array.isArray(v) && (v as unknown[]).includes(FRAME)) as string[] | undefined
  return { images: images ?? [], prompt: String(input.prompt ?? "") }
}

const ordinalIn = (syntax: string, n: number) =>
  syntax === "@image(n)" ? `@image(${n})` : syntax === "[Image N]" ? `[Image ${n}]` : `@image_${n}`

const appending = (IMAGE_TO_VIDEO_PROVIDERS as readonly string[]).filter(
  (p) => videoProviderAppendsFrames(p) && !VIDEO_PROVIDERS_WITHOUT_DISPATCH.has(p) && p in KIE_VIDEO_MODELS,
)

describe("frames after references, at the wire", () => {
  it("covers the appending models", () => {
    expect(appending).toEqual(expect.arrayContaining(["seedance-2", "minimax-h3", "wan-3", "vidu-q4"]))
  })

  for (const provider of appending) {
    it(`${provider}: references first, frame after them, frame seat bound as the opening frame`, async () => {
      const provider_ = new KieVideoProvider()
      await provider_.imageToVideo(FRAME, "the woman walks", provider, 5, undefined, { referenceImageUrls: REFS })
      const { images, prompt } = sent()
      expect(images.slice(0, 2), `${provider} refs`).toEqual(REFS)
      const seat = images.indexOf(FRAME) + 1
      expect(seat, `${provider} frame seat`).toBe(3)
      const ordinal = ordinalIn(videoProviderReferenceSyntax(provider), seat)
      expect(prompt, `${provider} binding`).toContain(`${ordinal} as the opening (first) frame`)
      expect(MODEL_CATALOG[provider]?.features, provider).toContain("reference-image")
    })
  }
})
