// @test-watches backend/src/utils/__tests__/fixtures/*.avif backend/src/utils/__tests__/fixtures/*.heic
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import sharp from "sharp"

// The KIE image lanes hand the source image to the provider. Until 2026-09
// they handed it over VERBATIM, so a TIFF/BMP/GIF asset reached topaz and
// recraft unchanged and came back as "image_url file type not supported" /
// "image file type not supported" (app-reports §11.3, P5). These tests pin the
// shared `ensureImageForProvider` chokepoint onto the image lanes.
//
// Real `sharp` on real fixture buffers on purpose — the point of the test is
// that the FORMAT decides, so a stubbed metadata() would prove nothing.

const runKieTask = vi.fn()
vi.mock("../client.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runKieTask,
}))

const safeFetch = vi.fn()
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch }))

// Without this the conversion path calls the real R2 uploader.
const uploadBufferToR2 = vi.fn()
vi.mock("../../../lib/storage.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadBufferToR2,
}))

const solid = (w = 8, h = 8) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#fff" } })
const tiff = () => solid().tiff().toBuffer()
const png = () => solid().png().toBuffer()
/** AVIF is the real rescued class: phones store it as-is and `sharp` reports
 *  it as "heif", which no KIE image SKU accepts. */
const avifWithAlpha = () =>
  sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } })
    .avif()
    .toBuffer()
/** 20x10 tagged EXIF orientation 6 — a quarter turn, so an honest decode is 10x20. */
const rotatedTiff = () => solid(20, 10).withMetadata({ orientation: 6 }).tiff().toBuffer()

const lastUpload = () =>
  uploadBufferToR2.mock.calls.at(-1) as [Buffer, string, string] | undefined

async function serve(buffer: Buffer) {
  safeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer,
  })
}

describe("editImage normalizes the input image format", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    runKieTask.mockResolvedValue({
      resultJson: { resultUrls: ["https://out.png"] },
      providerMs: 1,
      taskId: "t1",
    })
    uploadBufferToR2.mockResolvedValue("https://cdn.test/converted")
    await serve(await tiff())
  })

  it("does not hand topaz a TIFF (it accepts only jpeg/png/webp)", async () => {
    const { KieImageProvider } = await import("../image.js")
    await new KieImageProvider().editImage("https://src.tiff", undefined, "topaz-image-upscale")
    const sent = runKieTask.mock.calls.at(-1)?.[1] as Record<string, string>
    expect(sent.image_url).not.toBe("https://src.tiff")
    expect(sent.image_url).toBe("https://cdn.test/converted")
    expect(uploadBufferToR2).toHaveBeenCalled()
  })

  it("does not hand recraft-upscale a TIFF either", async () => {
    const { KieImageProvider } = await import("../image.js")
    await new KieImageProvider().editImage("https://src.tiff", undefined, "recraft-upscale")
    const sent = runKieTask.mock.calls.at(-1)?.[1] as Record<string, string>
    expect(sent.image).not.toBe("https://src.tiff")
    expect(sent.image).toBe("https://cdn.test/converted")
  })

  it("normalizes the array-shaped image param too (nano-banana-edit)", async () => {
    const { KieImageProvider } = await import("../image.js")
    await new KieImageProvider().editImage("https://src.tiff", "make it blue", "nano-banana-edit")
    const sent = runKieTask.mock.calls.at(-1)?.[1] as Record<string, string[]>
    expect(sent.image_urls).toEqual(["https://cdn.test/converted"])
  })

  it("passes an already-accepted format through untouched (no needless re-upload)", async () => {
    await serve(await png())
    const { KieImageProvider } = await import("../image.js")
    await new KieImageProvider().editImage("https://src.png", undefined, "topaz-image-upscale")
    const sent = runKieTask.mock.calls.at(-1)?.[1] as Record<string, string>
    expect(sent.image_url).toBe("https://src.png")
    expect(uploadBufferToR2).not.toHaveBeenCalled()
  })

  it("leaves the task-chained grok ops alone (they take a task_id, not a URL)", async () => {
    const { KieImageProvider } = await import("../image.js")
    await new KieImageProvider().editImage("kie-task-123", undefined, "grok-upscale")
    const sent = runKieTask.mock.calls.at(-1)?.[1] as Record<string, string>
    expect(sent.task_id).toBe("kie-task-123")
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it("fails the job with a plain message (and no provider call) when the image is unreadable", async () => {
    safeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from("not-an-image"),
    })
    const { KieImageProvider } = await import("../image.js")
    await expect(
      new KieImageProvider().editImage("https://src.bin", undefined, "topaz-image-upscale"),
    ).rejects.toThrow(
      "The input image could not be read (unsupported or corrupt file). Upload a PNG, JPEG, WebP, HEIC or AVIF image.",
    )
    // Pre-provider throw ⇒ the worker's refundJobCredits path refunds.
    expect(runKieTask).not.toHaveBeenCalled()
  })
})

describe("the image lanes keep the fidelity the SKU was hired for", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runKieTask.mockResolvedValue({
      resultJson: { resultUrls: ["https://out.png"] },
      providerMs: 1,
      taskId: "t1",
    })
    uploadBufferToR2.mockResolvedValue("https://cdn.test/converted")
  })

  it("converts losslessly (not to JPEG) and keeps alpha — AVIF with transparency → topaz", async () => {
    await serve(await avifWithAlpha())
    const { KieImageProvider } = await import("../image.js")
    await new KieImageProvider().editImage("https://src.avif", undefined, "topaz-image-upscale")
    const [buffer, key, contentType] = lastUpload()!
    expect(contentType).not.toContain("jpeg")
    expect(contentType).toBe("image/webp")
    expect(key.endsWith(".webp")).toBe(true)
    expect((await sharp(buffer).metadata()).hasAlpha).toBe(true)
  })

  it("honours EXIF orientation so a tagged photo is not delivered sideways", async () => {
    await serve(await rotatedTiff())
    const { KieImageProvider } = await import("../image.js")
    await new KieImageProvider().editImage("https://src.tiff", undefined, "topaz-image-upscale")
    const meta = await sharp(lastUpload()![0]).metadata()
    // Source is tagged 20x10 / orientation 6 (a quarter turn) — an honest
    // decode swaps the dimensions. Without .rotate() this is 20x10.
    expect([meta.width, meta.height]).toEqual([10, 20])
  })

  it("lands converted inputs in the running job's scratch folder, not beside user media", async () => {
    // Decided 2026-10-09: a temporary provider upload is keyed under its job
    // and deleted when the job ends (lib/job-scratch.ts).
    const { KieImageProvider } = await import("../image.js")
    const { runWithJobCancellation } = await import("../../../lib/job-cancellation.js")
    const { jobScratchPrefix } = await import("../../../lib/job-scratch-keys.js")
    const JOB = "00000000-0000-4000-8000-0000000000aa"
    await serve(await tiff())
    await runWithJobCancellation(JOB, undefined, () =>
      new KieImageProvider().editImage("https://src.tiff", undefined, "topaz-image-upscale"),
    )
    const key = lastUpload()![1]
    expect(key.startsWith(jobScratchPrefix(JOB))).toBe(true)
    expect(key).toContain("provider-converted-")
    // ...and counted against no one's quota.
    expect(uploadBufferToR2.mock.calls.at(-1)![3]).toBeUndefined()
  })

  it("outside a job, a converted input keeps the flat temp key it always had", async () => {
    const { KieImageProvider } = await import("../image.js")
    await serve(await tiff())
    await new KieImageProvider().editImage("https://src.tiff", undefined, "topaz-image-upscale")
    const key = lastUpload()![1]
    expect(key).toMatch(/^tmp\/provider-input\/provider-converted-[0-9a-f]{8}\.[a-z]+$/)
  })

  it("leaves the VIDEO lanes on JPEG — preferLossless is an image-lane opt-in", async () => {
    await serve(await avifWithAlpha())
    const { ensureImageForProvider } = await import("../video.js")
    await ensureImageForProvider("https://frame.avif", "kling-3.0", { context: "Video generation" })
    const [, key, contentType] = lastUpload()!
    expect(contentType).toBe("image/jpeg")
    expect(key.endsWith(".jpg")).toBe(true)
  })
})

describe("acceptedImageFormats is the per-SKU source of truth", () => {
  it("declares nothing wider than the jpeg/png/webp default", async () => {
    const { KIE_IMAGE_MODELS } = await import("../models.js")
    const declared = Object.entries(KIE_IMAGE_MODELS).filter(
      ([, c]) => c.acceptedImageFormats !== undefined,
    )
    expect(declared.length).toBeGreaterThan(0)
    for (const [id, config] of declared) {
      expect(
        config.acceptedImageFormats!.every((f) => ["jpeg", "png", "webp"].includes(f)),
        `${id} declares a format outside the default set — widen the default instead`,
      ).toBe(true)
    }
  })
})

// sharp reads the header of a 10-bit AVIF or a HEIC but cannot decode the
// pixels (utils/heif-decode.ts). A production Cast Swap run died of both halves
// on one 10-bit AVIF upload (2026-10-25): its Kling 4 edit failed in this
// chokepoint with the raw libheif text, and its GPT Image 2 reference
// preparation sent the AVIF to KIE untouched ("File type not supported").
const heifFixture = (name: string) =>
  readFileSync(new URL(`../../../utils/__tests__/fixtures/${name}`, import.meta.url))

describe("HEIF inputs sharp cannot decode (10-bit AVIF, HEIC)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runKieTask.mockResolvedValue({
      resultJson: { resultUrls: ["https://out.png"] },
      providerMs: 1,
      taskId: "t1",
    })
    uploadBufferToR2.mockResolvedValue("https://cdn.test/converted")
  })

  it.each(["10bit.avif", "hevc.heic"])("a video lane gets a JPEG of the whole %s picture", async (name) => {
    await serve(heifFixture(name))
    const { ensureImageForProvider } = await import("../video.js")
    const url = await ensureImageForProvider("https://cdn.test/face.heif", "kling-4", { context: "Video generation" })
    expect(url).toBe("https://cdn.test/converted")
    const [buffer, , contentType] = lastUpload()!
    expect(contentType).toBe("image/jpeg")
    const meta = await sharp(buffer).metadata()
    expect([meta.width, meta.height]).toEqual([96, 64])
  })

  it("a HEIF no decoder can read fails with the plain message, never the library text", async () => {
    // The header survives (sharp still says "heif"); the picture is cut off.
    const whole = heifFixture("10bit.avif")
    await serve(whole.subarray(0, whole.length - 200))
    const { ensureImageForProvider } = await import("../video.js")
    const err = await ensureImageForProvider("https://cdn.test/cut.avif", "kling-4", { context: "Video generation" })
      .then(() => undefined, (e: unknown) => e as Error)
    expect(err?.message).toBe(
      "The input image could not be read (unsupported or corrupt file). Upload a PNG, JPEG, WebP, HEIC or AVIF image.",
    )
    expect(String(err?.message)).not.toMatch(/bad seek|Bitstream|libheif/i)
  })

  it("generateImage converts an AVIF reference before KIE sees it (gpt-image-2-i2i)", async () => {
    await serve(heifFixture("10bit.avif"))
    const { KieImageProvider } = await import("../image.js")
    await new KieImageProvider().generateImage("same person", ["https://cdn.test/face.avif"], "gpt-image-2-i2i")
    const sent = runKieTask.mock.calls.at(-1)?.[1] as Record<string, string[]>
    expect(sent.input_urls).toEqual(["https://cdn.test/converted"])
  })

  it("generateImage passes an accepted reference through untouched", async () => {
    await serve(await png())
    const { KieImageProvider } = await import("../image.js")
    await new KieImageProvider().generateImage("same person", ["https://cdn.test/face.png"], "gpt-image-2-i2i")
    const sent = runKieTask.mock.calls.at(-1)?.[1] as Record<string, string[]>
    expect(sent.input_urls).toEqual(["https://cdn.test/face.png"])
    expect(uploadBufferToR2).not.toHaveBeenCalled()
  })
})
