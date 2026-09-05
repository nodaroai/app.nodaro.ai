import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Totality guard for `videoProviderFoldsLoneEndFrame`.
 *
 * The helper's docstring makes a promise about the WHOLE provider space: the
 * Seedance 2.x / MiniMax Hailuo 3 / Wan 3 families fold a lone closing frame
 * into `reference_image_urls` through the shared `resolveSeedance2Inputs`, and
 * "NOTHING else does". `/v1/generate-video`'s image-required gate is keyed to
 * that promise — an end-frame-only body is admitted exactly when the helper
 * says yes — so the promise has to be an invariant, not a comment.
 *
 * This file guards its POSITIVE half at the provider layer: every
 * VIDEO_GEN_PROVIDERS member the helper names really does fold. The negative
 * half ("NOTHING else does") is guarded at the gate itself, in
 * `routes/__tests__/generate-video.test.ts` — every non-folding member that
 * carries image references is still refused there.
 */

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() calls
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockRunKieTask = vi.fn()
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
  return { mockRunKieTask, mockCreateSanitizedError, mockUploadBufferToR2, mockSafeFetch, sharpMeta }
})

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  runVeoTask: vi.fn(),
  createSanitizedError: mocks.mockCreateSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO: 120,
}))

// Spread the real module: ensureImageForProvider keys converted inputs with
// tmpObjectKey (the sweepable tmp/ prefix), which a replace-everything mock
// would leave undefined.
vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

// video.ts downloads input frames through safeFetch (SSRF gate), not global
// fetch — mock it or the fake hostname below hits a real DNS lookup.
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

import { VIDEO_GEN_PROVIDERS, videoProviderFoldsLoneEndFrame } from "@nodaro/shared"
import { REF_BINDING } from "@nodaro/prompts"
import { KieVideoProvider } from "../video.js"

let provider: KieVideoProvider

const END = "https://cdn.example/closing.png"

/** The `input` object handed to runKieTask by the call under test. */
const captured = () => mocks.mockRunKieTask.mock.calls[0][1] as Record<string, unknown>

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

describe("videoProviderFoldsLoneEndFrame — every provider it names really folds", () => {
  const folding = VIDEO_GEN_PROVIDERS.filter((p) => videoProviderFoldsLoneEndFrame(p))

  it("names at least one provider (a silently empty predicate would guard nothing)", () => {
    expect(folding.length).toBeGreaterThan(0)
  })

  for (const p of folding) {
    it(`${p}: a lone closing frame becomes the sole reference image, not a half-formed frame pair`, async () => {
      await provider.imageToVideo(undefined, "the camera settles on the final beat", p, 5, END)
      const input = captured()
      // Reference mode: the frame IS the reference the model receives...
      expect(input.reference_image_urls).toEqual([END])
      // ...and no orphan last frame rides along beside it.
      expect(input.last_frame_url).toBeUndefined()
      expect(input.first_frame_url).toBeUndefined()
      // The closing-frame hint is what tells the model which end it is.
      expect(input.prompt).toContain(REF_BINDING.frame(1, "closing"))
    })
  }
})
