/**
 * FLUX 3 Klein on the wire: the exact body each endpoint is sent (an explicit
 * field list, decided 2026-11-11: no `enhance_prompt`, `num_images` or custom
 * `width`/`height`; `output_format` only for a JPEG, decided 2026-11-12), the swap to the edit endpoint when
 * images go with a prompt, the 10-image cap, the size on the wire and what
 * each picture is recorded as costing.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  runKieTask: vi.fn(),
  safeFetch: vi.fn(),
  uploadBufferToR2: vi.fn(),
  logCreditAudit: vi.fn(),
}))

vi.mock("../client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client.js")>()),
  runKieTask: mocks.runKieTask,
}))
vi.mock("../../../lib/credit-audit.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/credit-audit.js")>()),
  logCreditAudit: mocks.logCreditAudit,
}))
// Reference and source images go through the format chokepoint, which reads
// them: serve a small PNG so every one passes through as its own URL.
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.uploadBufferToR2,
}))

import sharp from "sharp"
import { KieImageProvider } from "../image.js"
import { KIE_CREDIT_USD, KIE_IMAGE_MODELS } from "../models.js"
import { NSFW_CHECKER_LEVER } from "../../safety-levers.js"

const T2I = "flux-3-klein"
const I2I = "flux-3-klein-i2i"
const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://cdn.example.com/${i + 1}.png`)
// What a worker may pass along from a node, or from a request, that the schema
// has but this release does not send, or that another model takes.
const LEFT_OUT = {
  enhance_prompt: false,
  num_images: 4,
  width: 1920,
  height: 1080,
  nsfw_checker: true,
}
const OTHER_MODELS = {
  strength: 0.4,
  guidance_scale: 6,
  negative_prompt: "blur",
  quality: "high",
  background: "transparent",
  mask_url: "https://cdn.example.com/mask.png",
  expand_prompt: false,
  size: "2K",
}

let provider: KieImageProvider
let png: Buffer
const lastModel = () => mocks.runKieTask.mock.calls.at(-1)?.[0] as string
const lastInput = () => mocks.runKieTask.mock.calls.at(-1)?.[1] as Record<string, unknown>
const lastOpts = () => mocks.runKieTask.mock.calls.at(-1)?.[4] as Record<string, unknown>

beforeAll(async () => {
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://kie.example.com/result.png"] } })
  mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => png })
  mocks.uploadBufferToR2.mockResolvedValue("https://cdn.example.com/converted.png")
  provider = new KieImageProvider()
})

describe("FLUX 3 Klein's provider configs", () => {
  it("text to image and edit, KIE's ids, an explicit field list each", () => {
    expect(KIE_IMAGE_MODELS[T2I]).toMatchObject({
      model: "flux-3/klein-text-to-image",
      inputFields: ["prompt", "aspect_ratio", "resolution", "seed"],
      seedRange: { min: 0, max: 2147483647 },
      extraParams: { aspect_ratio: "1:1", resolution: "1K" },
    })
    expect(KIE_IMAGE_MODELS[I2I]).toMatchObject({
      model: "flux-3/klein-edit-image",
      inputFields: ["prompt", "aspect_ratio", "resolution", "seed", "image_urls"],
      seedRange: { min: 0, max: 2147483647 },
      inputType: "image-to-image",
      imageParam: "image_urls",
      maxInputImages: 10,
      extraParams: { aspect_ratio: "auto", resolution: "1K" },
    })
    for (const id of [T2I, I2I]) {
      // The schema's content filter, off by default and never sent: declared for the admin page.
      expect(KIE_IMAGE_MODELS[id]!.safetyLevers).toEqual([NSFW_CHECKER_LEVER])
      // PNG sends no format; JPEG adds `output_format`, and nothing else.
      const fields = KIE_IMAGE_MODELS[id]!.inputFields!
      expect(KIE_IMAGE_MODELS[id]!.inputFieldsByFormat).toEqual({ png: fields, jpeg: [...fields, "output_format"] })
      // One picture per request, priced by size: no metered cost.
      expect(KIE_IMAGE_MODELS[id]!.costFromTaskRecord).toBeUndefined()
      expect(KIE_IMAGE_MODELS[id]!.credits).toBe(1.6)
    }
  })
})

describe("FLUX 3 Klein text to image on the wire", () => {
  it("names nothing: the 1:1 default at 1K, and only the prompt beside them", async () => {
    const result = await provider.generateImage("a lighthouse at dusk", undefined, T2I)
    expect(lastModel()).toBe("flux-3/klein-text-to-image")
    expect(lastInput()).toEqual({ prompt: "a lighthouse at dusk", aspect_ratio: "1:1", resolution: "1K" })
    expect(lastOpts()).toMatchObject({ modelKey: T2I, dimensions: { resolution: "1K" } })
    expect(result.cost).toBeCloseTo(1.6 * KIE_CREDIT_USD, 10)
  })

  it.each([
    ["1K", 1.6],
    ["2K", 2.5],
    ["4K", 6.5],
  ] as const)("at %s: sent as asked, recorded at KIE's price for that size", async (resolution, kieCredits) => {
    const result = await provider.generateImage("a poster", undefined, T2I, { aspect_ratio: "9:21", resolution })
    expect(lastInput()).toEqual({ prompt: "a poster", aspect_ratio: "9:21", resolution })
    expect(result.cost).toBeCloseTo(kieCredits * KIE_CREDIT_USD, 10)
    expect(mocks.logCreditAudit.mock.calls.at(-1)?.[0]).toMatchObject({ modelKey: T2I, expectedKieCredits: kieCredits })
  })

  it("never sends enhance_prompt, num_images, width, height, nsfw_checker or another model's lever", async () => {
    await provider.generateImage("a poster", undefined, T2I, { ...LEFT_OUT, ...OTHER_MODELS, aspect_ratio: "16:9", resolution: "2K", seed: 42 })
    expect(lastInput()).toEqual({ prompt: "a poster", aspect_ratio: "16:9", resolution: "2K", seed: 42 })
  })

  it("JPEG sends output_format; PNG and WebP send none, the same price", async () => {
    const jpeg = await provider.generateImage("x", undefined, T2I, { output_format: "jpeg", resolution: "2K" })
    expect(lastInput()).toEqual({ prompt: "x", aspect_ratio: "1:1", resolution: "2K", output_format: "jpeg" })
    expect(jpeg.cost).toBeCloseTo(2.5 * KIE_CREDIT_USD, 10)
    for (const format of ["png", "webp"]) {
      await provider.generateImage("x", undefined, T2I, { output_format: format })
      expect(lastInput(), format).toEqual({ prompt: "x", aspect_ratio: "1:1", resolution: "1K" })
    }
    await provider.generateImage("x", urls(2), T2I, { output_format: "jpeg" })
    expect(lastInput()).toEqual({ prompt: "x", image_urls: urls(2), aspect_ratio: "auto", resolution: "1K", output_format: "jpeg" })
    await provider.editImage("https://cdn.example.com/src.png", "x", I2I, { output_format: "jpeg" })
    expect(lastInput()).toMatchObject({ output_format: "jpeg" })
    await provider.editImage("https://cdn.example.com/src.png", "x", I2I, { output_format: "png" })
    expect(lastInput()).not.toHaveProperty("output_format")
  })

  it("a size in another spelling is sent as the size it was priced at, anything else as 1K", async () => {
    await provider.generateImage("x", undefined, T2I, { resolution: "4k" })
    expect(lastInput().resolution).toBe("4K")
    const odd = await provider.generateImage("x", undefined, T2I, { resolution: "2 MP" })
    expect(lastInput().resolution).toBe("1K")
    expect(odd.cost).toBeCloseTo(1.6 * KIE_CREDIT_USD, 10)
  })

  it.each([
    [-1, undefined],
    [0, 0],
    [2147483647, 2147483647],
    [2147483648, undefined],
    [1.5, undefined],
  ])("a seed of %s is sent as %s: only 0 to 2147483647, the schema's range", async (seed, sentSeed) => {
    await provider.generateImage("x", undefined, T2I, { seed })
    expect(lastInput()).toEqual(sentSeed === undefined
      ? { prompt: "x", aspect_ratio: "1:1", resolution: "1K" }
      : { prompt: "x", aspect_ratio: "1:1", resolution: "1K", seed: sentSeed })
  })
})

describe("FLUX 3 Klein edit on the wire", () => {
  it("text to image sent references runs on the edit endpoint, which reads them, at the same price", async () => {
    const result = await provider.generateImage("the same lighthouse in snow", urls(3), T2I, { ...LEFT_OUT, ...OTHER_MODELS, aspect_ratio: "auto", resolution: "2K", seed: 7 })
    expect(lastModel()).toBe("flux-3/klein-edit-image")
    expect(lastInput()).toEqual({ prompt: "the same lighthouse in snow", image_urls: urls(3), aspect_ratio: "auto", resolution: "2K", seed: 7 })
    expect(lastOpts()).toMatchObject({ modelKey: I2I })
    expect(result.cost).toBeCloseTo(2.5 * KIE_CREDIT_USD, 10)
  })

  it("an edit naming no ratio sends KIE's own auto, the first image's shape", async () => {
    await provider.generateImage("make it night", urls(1), I2I)
    expect(lastInput()).toEqual({ prompt: "make it night", image_urls: urls(1), aspect_ratio: "auto", resolution: "1K" })
  })

  it("sends 1 to 10 images: past 10, the first 10, and the price does not move", async () => {
    for (const n of [1, 10]) {
      const result = await provider.generateImage("x", urls(n), I2I, { resolution: "4K" })
      expect((lastInput().image_urls as string[]).length, String(n)).toBe(n)
      expect(result.cost).toBeCloseTo(6.5 * KIE_CREDIT_USD, 10)
    }
    const eleven = await provider.generateImage("x", urls(11), I2I, { resolution: "4K" })
    expect(lastInput().image_urls).toEqual(urls(10))
    expect(eleven.cost).toBeCloseTo(6.5 * KIE_CREDIT_USD, 10)
    expect(mocks.logCreditAudit.mock.calls.at(-1)?.[0]).toMatchObject({ modelKey: I2I, expectedKieCredits: 6.5 })
  })

  it("the edit drops an out-of-range seed too", async () => {
    await provider.generateImage("x", urls(1), T2I, { seed: 2147483648 })
    expect(lastInput()).not.toHaveProperty("seed")
  })

  it("editImage lane: the prompt is kept, the source sent, and the strays dropped", async () => {
    const result = await provider.editImage("https://cdn.example.com/src.png", "make it winter", I2I, { ...LEFT_OUT, ...OTHER_MODELS, resolution: "2K", seed: 3 })
    expect(lastModel()).toBe("flux-3/klein-edit-image")
    expect(lastInput()).toEqual({ prompt: "make it winter", image_urls: ["https://cdn.example.com/src.png"], aspect_ratio: "auto", resolution: "2K", seed: 3 })
    expect(result.cost).toBeCloseTo(2.5 * KIE_CREDIT_USD, 10)
  })
})
