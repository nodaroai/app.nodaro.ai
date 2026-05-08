/**
 * L4#1 — KIE image-generation request body snapshots.
 *
 * Per the test-strategy spec: snapshot the outgoing request body for each
 * provider call site. Snapshot diffs flag "we silently changed what we
 * send upstream" — a class of bug that's invisible in unit tests focused
 * on success-case behavior.
 *
 * This file covers the KIE image-generation entry points. Other call
 * sites (KIE video, ElevenLabs, Replicate) get their own snapshot files
 * as Phase 2 progresses; the spec budgets ~50 sites total. This file
 * locks in 6 representative image providers — one per param-shape family
 * (image_size base, aspect_ratio Pro, named-size Ideogram, named-size
 * Qwen, native-negative-prompt Imagen, no-aspect Grok).
 *
 * Bug class: provider drift. We change a default, drop a field, or
 * re-route the param name; integration tests with real upstream fail
 * eventually but only after deploying. This contract test catches it at
 * PR time.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock runKieTask + runFluxKontextTask. We capture the body at the call
// boundary; the upstream returns a placeholder that satisfies the
// generateImage success path enough to exit cleanly. vi.hoisted is needed
// because vi.mock is hoisted above all imports.
const { runKieTaskSpy, runFluxKontextTaskSpy } = vi.hoisted(() => ({
  runKieTaskSpy: vi.fn(),
  runFluxKontextTaskSpy: vi.fn(),
}))

vi.mock("../kie/client.js", () => ({
  runKieTask: runKieTaskSpy,
  createSanitizedError: (msg: string) => new Error(msg),
}))
vi.mock("../kie/kontext-client.js", () => ({
  runFluxKontextTask: runFluxKontextTaskSpy,
}))

// generateImage downloads the result image and uploads to R2 via storage.ts;
// stub both transitively to avoid network + supabase.
vi.mock("../../lib/storage.js", () => ({
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2.test/output.png"),
}))
vi.mock("../../lib/credit-audit.js", () => ({
  logCreditAudit: vi.fn(),
  extractCreditFields: vi.fn().mockReturnValue({ kieCredits: 4 }),
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

// Mock global fetch for downloadAndMeasure. Returns a 1×1 PNG so sharp
// reports valid metadata.
const ONE_PIXEL_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000164d40c510000000049454e44ae426082",
  "hex",
)
vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => ONE_PIXEL_PNG,
  })),
)

import { KieImageProvider } from "../kie/image.js"

const provider = new KieImageProvider()

beforeEach(() => {
  runKieTaskSpy.mockReset()
  runFluxKontextTaskSpy.mockReset()
  // Default success result — generateImage exits cleanly after extracting
  // the URL. The body contents are what we care about.
  runKieTaskSpy.mockResolvedValue({
    resultJson: { resultUrls: ["https://kie.test/result.png"] },
    providerMs: 1000,
  })
  runFluxKontextTaskSpy.mockResolvedValue({
    resultJson: { resultUrls: ["https://kie.test/result.png"] },
    providerMs: 1000,
  })
})

/**
 * Helper: invoke generateImage and return what the underlying client
 * received: the model id (first arg) + body (second arg).
 */
async function captureBody(
  args: Parameters<typeof provider.generateImage>,
  spy: typeof runKieTaskSpy = runKieTaskSpy,
): Promise<{ model: string; body: Record<string, unknown> }> {
  await provider.generateImage(...args)
  expect(spy, "underlying client should have been called").toHaveBeenCalledTimes(1)
  const [model, body] = spy.mock.calls[0] as [string, Record<string, unknown>]
  return { model, body }
}

// ---------------------------------------------------------------------------
// Snapshots — one per representative provider. Diff is the source of truth
// for "what we send upstream"; reviewing a snapshot diff in PR review is the
// gate that catches accidental shape changes.
// ---------------------------------------------------------------------------

describe("KIE image generation — request body snapshots", () => {
  it("nano-banana (base) sends to nano-banana-pro endpoint with aspect_ratio + output_format=png", async () => {
    const captured = await captureBody(["a cat", undefined, "nano-banana"])
    expect(captured).toMatchInlineSnapshot(`
      {
        "body": {
          "aspect_ratio": "16:9",
          "output_format": "png",
          "prompt": "a cat",
        },
        "model": "nano-banana-pro",
      }
    `)
  })

  it("nano-banana-pro sends aspect_ratio + resolution + output_format=png", async () => {
    const captured = await captureBody(["a dog", undefined, "nano-banana-pro"])
    expect(captured).toMatchInlineSnapshot(`
      {
        "body": {
          "aspect_ratio": "16:9",
          "output_format": "png",
          "prompt": "a dog",
          "resolution": "1K",
        },
        "model": "nano-banana-pro",
      }
    `)
  })

  it("flux sends aspect_ratio + resolution to flux-2/pro-text-to-image", async () => {
    const captured = await captureBody(["a tree", undefined, "flux"])
    expect(captured).toMatchInlineSnapshot(`
      {
        "body": {
          "aspect_ratio": "16:9",
          "prompt": "a tree",
          "resolution": "1K",
        },
        "model": "flux-2/pro-text-to-image",
      }
    `)
  })

  it("grok sends only aspect_ratio (no resolution)", async () => {
    const captured = await captureBody(["a robot", undefined, "grok"])
    expect(captured).toMatchInlineSnapshot(`
      {
        "body": {
          "aspect_ratio": "16:9",
          "prompt": "a robot",
        },
        "model": "grok-imagine/text-to-image",
      }
    `)
  })

  it("ideogram-v3 converts aspect_ratio (16:9) → image_size (landscape_16_9), defaults rendering_speed=BALANCED + style_type=AUTO", async () => {
    const captured = await captureBody(
      ["a logo", undefined, "ideogram-v3", { aspect_ratio: "16:9" }],
    )
    expect(captured).toMatchInlineSnapshot(`
      {
        "body": {
          "image_size": "landscape_16_9",
          "prompt": "a logo",
          "rendering_speed": "BALANCED",
          "style_type": "AUTO",
        },
        "model": "ideogram/v3-text-to-image",
      }
    `)
  })

  it("qwen converts aspect_ratio (1:1) → image_size (square_hd), preserves output_format from extraParams", async () => {
    const captured = await captureBody(
      ["a portrait", undefined, "qwen", { aspect_ratio: "1:1" }],
    )
    expect(captured).toMatchInlineSnapshot(`
      {
        "body": {
          "image_size": "square_hd",
          "output_format": "png",
          "prompt": "a portrait",
        },
        "model": "qwen/text-to-image",
      }
    `)
  })

  it("imagen4 keeps native negative_prompt + strips resolution", async () => {
    const captured = await captureBody(
      ["a sunset", undefined, "imagen4", { negative_prompt: "blurry" }],
    )
    expect(captured).toMatchInlineSnapshot(`
      {
        "body": {
          "aspect_ratio": "16:9",
          "negative_prompt": "blurry",
          "prompt": "a sunset",
        },
        "model": "google/imagen4",
      }
    `)
  })

  it("non-imagen provider strips negative_prompt (frontend appends to prompt instead)", async () => {
    const captured = await captureBody(
      ["a flower", undefined, "flux", { negative_prompt: "wilted" }],
    )
    // negative_prompt MUST be absent — flux doesn't support it natively
    expect(Object.keys(captured.body)).not.toContain("negative_prompt")
  })
})
