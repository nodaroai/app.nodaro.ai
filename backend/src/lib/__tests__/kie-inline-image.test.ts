/**
 * Images for KIE's OpenAI-shaped lanes always travel inline. Each one is read
 * from its bytes (never trusted by its declared type), fitted to a per-image
 * allowance — the per-image cap, shrunk when a request carries many images so
 * the whole request stays within its budget — and produced by a small pool,
 * never all at once. Image URLs are fetched (or `data:` URLs decoded) once per
 * block; nothing here ever yields a URL.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import sharp from "sharp"
import { randomBytes } from "node:crypto"

const safeFetchBytes = vi.fn()
vi.mock("../safe-fetch-bytes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../safe-fetch-bytes.js")>()),
  safeFetchBytes,
}))

const {
  KIE_INLINE_DATA_URL_MAX_CHARS,
  KIE_INLINE_REQUEST_BUDGET_CHARS,
  KIE_INLINE_CONCURRENCY,
  KIE_IMAGE_FETCH_FAILED_MESSAGE,
  KIE_IMAGE_UNREADABLE_MESSAGE,
  KIE_IMAGES_OVER_BUDGET_MESSAGE,
  KIE_IMAGE_TOO_LARGE_MESSAGE,
  fitImageForKieInline,
  fetchImageForKieInline,
  inlineImagesForKie,
} = await import("../kie-inline-image.js")
const { LlmLaneError } = await import("../llm-errors.js")
const { PublicDownloadTooLargeError } = await import("../safe-fetch-bytes.js")
const { userFacingMessage } = await import("../user-facing-error.js")

type Block = { type: "image_base64"; mediaType: string; data: string }

const dataUrlLength = (b: { mediaType: string; data: string }) => `data:${b.mediaType};base64,${b.data}`.length
const block = (bytes: Buffer, mediaType = "image/png"): Block => ({ type: "image_base64", mediaType, data: bytes.toString("base64") })

const solid = (format: "png" | "tiff" | "avif", size = 64) =>
  sharp({ create: { width: size, height: size, channels: 3, background: "#336699" } })[format]().toBuffer()

/** Noise does not compress: a PNG whose data URL is roughly 4 characters per pixel. */
const noisePng = (side: number) =>
  sharp(randomBytes(side * side * 3), { raw: { width: side, height: side, channels: 3 } }).png().toBuffer()

const request = (content: Array<Record<string, unknown>>) =>
  ({ modelId: "gemini-3.8-flash", system: "", messages: [{ role: "user" as const, content }] }) as never

const imagesOf = (req: { messages: Array<{ content: unknown }> }) =>
  (req.messages[0]?.content as Array<Record<string, unknown>>).filter((b) => b.type === "image_base64") as Block[]

beforeEach(() => {
  safeFetchBytes.mockReset()
})

describe("the limits", () => {
  it("keep a whole request well under a 20 MB inline request", () => {
    expect(KIE_INLINE_REQUEST_BUDGET_CHARS).toBeLessThanOrEqual(12_000_000)
    expect(KIE_INLINE_DATA_URL_MAX_CHARS).toBeLessThan(2_676_538)
    expect(KIE_INLINE_CONCURRENCY).toBe(3)
  })
})

describe("the sentences a person reads", () => {
  // The image library this server ships reads a HEIC's header but cannot
  // decode it, so advice to upload a HEIC here would be wrong.
  it("never suggest a format this path cannot decode", () => {
    expect(KIE_IMAGE_UNREADABLE_MESSAGE).not.toMatch(/HEIC/i)
  })

  it("name no vendor and no internal step", () => {
    for (const sentence of [KIE_IMAGE_FETCH_FAILED_MESSAGE, KIE_IMAGE_UNREADABLE_MESSAGE, KIE_IMAGES_OVER_BUDGET_MESSAGE, KIE_IMAGE_TOO_LARGE_MESSAGE]) {
      expect(sentence).not.toMatch(/KIE|Gemini|Anthropic|OpenAI|inline/i)
    }
  })
})

describe("fitImageForKieInline", () => {
  it("returns a JPEG/PNG/GIF/WebP that fits as the same object", async () => {
    const b = block(await solid("png"))

    expect(await fitImageForKieInline(b)).toBe(b)
  })

  it("reads the format from the bytes: PNG bytes declared as a generic type keep their bytes under the right type", async () => {
    const png = await solid("png")

    expect(await fitImageForKieInline(block(png, "application/octet-stream"))).toEqual(block(png, "image/png"))
  })

  it("re-encodes bytes in a format a lane may not read to JPEG, whatever they were declared as", async () => {
    const fitted = await fitImageForKieInline(block(await solid("avif"), "image/png"))

    expect(fitted.mediaType).toBe("image/jpeg")
    expect((await sharp(Buffer.from(fitted.data, "base64")).metadata()).format).toBe("jpeg")
  })

  it("re-encodes a 2 MB PNG to a JPEG within the per-image cap", async () => {
    const b = block(await noisePng(820))
    expect(dataUrlLength(b)).toBeGreaterThan(KIE_INLINE_DATA_URL_MAX_CHARS)

    const fitted = await fitImageForKieInline(b)

    expect(fitted.mediaType).toBe("image/jpeg")
    expect(dataUrlLength(fitted)).toBeLessThanOrEqual(KIE_INLINE_DATA_URL_MAX_CHARS)
  })

  it("honours EXIF orientation when it re-encodes", async () => {
    // Stored 400x200, displayed rotated a quarter turn (orientation 6) → 200x400.
    const jpeg = await sharp(randomBytes(400 * 200 * 3), { raw: { width: 400, height: 200, channels: 3 } })
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const b = block(jpeg, "image/jpeg")

    const fitted = await fitImageForKieInline(b, dataUrlLength(b) - 1)

    const meta = await sharp(Buffer.from(fitted.data, "base64")).metadata()
    expect([meta.width, meta.height]).toEqual([200, 400])
  })

  it("flattens transparency onto white when it re-encodes", async () => {
    const w = 300
    const rgba = randomBytes(w * w * 4)
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = x < w / 2 ? 0 : 255
    const b = block(await sharp(rgba, { raw: { width: w, height: w, channels: 4 } }).png().toBuffer())

    const fitted = await fitImageForKieInline(b, dataUrlLength(b) - 1)

    const { data, info } = await sharp(Buffer.from(fitted.data, "base64")).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3))
    for (const channel of at(20, 150)) expect(channel).toBeGreaterThan(245)
  })

  it("throws a KIE lane error the person can read when even the smallest re-encode cannot fit", async () => {
    const err = (await fitImageForKieInline(block(await solid("png")), 40).catch((e: unknown) => e)) as InstanceType<typeof LlmLaneError>

    expect(err).toBeInstanceOf(LlmLaneError)
    expect(err.lane).toBe("kie")
    expect(userFacingMessage(err, "fallback")).toBe(KIE_IMAGES_OVER_BUDGET_MESSAGE)
  })

  it("throws a KIE lane error the person can read for bytes that are not an image", async () => {
    const err = await fitImageForKieInline(block(Buffer.from("not an image at all"))).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmLaneError)
    expect(userFacingMessage(err, "fallback")).toBe(KIE_IMAGE_UNREADABLE_MESSAGE)
  })
})

describe("fetchImageForKieInline", () => {
  const URL_ = "https://cdn.example/images/portrait.png?sig=secret"

  it("keeps a small JPEG/PNG/GIF/WebP verbatim, typed from its bytes", async () => {
    const png = await solid("png")
    safeFetchBytes.mockResolvedValue(png)

    expect(await fetchImageForKieInline(URL_)).toEqual(block(png))
    expect(safeFetchBytes.mock.calls[0]?.[0]).toBe(URL_)
  })

  it.each([
    ["TIFF", "tiff"],
    ["AVIF", "avif"],
  ] as const)("re-encodes a small %s to JPEG", async (_label, format) => {
    safeFetchBytes.mockResolvedValue(await solid(format))

    expect((await fetchImageForKieInline(URL_)).mediaType).toBe("image/jpeg")
  })

  it("turns a refused fetch into a KIE lane error that names the host, not the signed URL, and reads plainly", async () => {
    safeFetchBytes.mockRejectedValue(new Error("Image download failed"))

    const err = (await fetchImageForKieInline(URL_).catch((e: unknown) => e)) as InstanceType<typeof LlmLaneError>

    expect(err).toBeInstanceOf(LlmLaneError)
    expect(err.lane).toBe("kie")
    expect(err.message).toContain("cdn.example")
    expect(err.message).not.toContain("sig=secret")
    expect(userFacingMessage(err, "fallback")).toBe(KIE_IMAGE_FETCH_FAILED_MESSAGE)
  })

  it("tells a download past the byte cap that it is too large, not that its link is broken", async () => {
    safeFetchBytes.mockRejectedValue(new PublicDownloadTooLargeError("Image download exceeds the size limit"))

    const err = await fetchImageForKieInline(URL_).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmLaneError)
    expect(userFacingMessage(err, "fallback")).toBe(KIE_IMAGE_TOO_LARGE_MESSAGE)
  })

  it("passes the caller's abort signal to the download", async () => {
    safeFetchBytes.mockResolvedValue(await solid("png"))
    const controller = new AbortController()

    await fetchImageForKieInline(URL_, KIE_INLINE_DATA_URL_MAX_CHARS, controller.signal)

    expect(safeFetchBytes.mock.calls[0]?.[2]).toBe(controller.signal)
  })

  describe("a data: URL", () => {
    it("is decoded locally — never fetched", async () => {
      const png = await solid("png")

      expect(await fetchImageForKieInline(`data:image/png;base64,${png.toString("base64")}`)).toEqual(block(png))
      expect(safeFetchBytes).not.toHaveBeenCalled()
    })

    it("is read from its bytes, not its declared type", async () => {
      const png = await solid("png")

      expect(await fetchImageForKieInline(`data:image/webp;base64,${png.toString("base64")}`)).toEqual(block(png))
    })

    it("past the byte cap is too large — never decoded, never fetched", async () => {
      const err = await fetchImageForKieInline(`data:image/png;base64,${"A".repeat(34 * 1024 * 1024)}`).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(LlmLaneError)
      expect(userFacingMessage(err, "fallback")).toBe(KIE_IMAGE_TOO_LARGE_MESSAGE)
      expect(safeFetchBytes).not.toHaveBeenCalled()
    })

    it.each([
      ["a non-image type", `data:text/plain;base64,${Buffer.from("hello").toString("base64")}`],
      ["no base64 marker", "data:image/png,not-base64"],
      ["bytes that are not an image", `data:image/png;base64,${Buffer.from("not an image").toString("base64")}`],
    ])("with %s is a KIE lane error, never a fetch", async (_label, url) => {
      const err = await fetchImageForKieInline(url).catch((e: unknown) => e)

      expect(err).toBeInstanceOf(LlmLaneError)
      expect(userFacingMessage(err, "fallback")).toBe(KIE_IMAGE_UNREADABLE_MESSAGE)
      expect(safeFetchBytes).not.toHaveBeenCalled()
    })
  })
})

describe("inlineImagesForKie", () => {
  it("returns a request with no image as the same object", async () => {
    const req = request([{ type: "text", text: "hi" }])

    expect(await inlineImagesForKie(req)).toBe(req)
  })

  it("inlines image URLs, fits image blocks, and leaves text and video alone — without mutating the caller's request", async () => {
    const fetched = await solid("png")
    safeFetchBytes.mockResolvedValue(fetched)
    const small = block(await solid("png"))
    const req = request([
      { type: "text", text: "compare" },
      { type: "image", url: "https://cdn.example/a.png" },
      small,
      { type: "video", url: "https://cdn.example/clip.mp4" },
    ])

    const out = await inlineImagesForKie(req)

    const content = out.messages[0]?.content as Array<Record<string, unknown>>
    expect(content[0]).toEqual({ type: "text", text: "compare" })
    expect(content[1]).toEqual(block(fetched))
    expect(content[2]).toBe(small)
    expect(content[3]).toEqual({ type: "video", url: "https://cdn.example/clip.mp4" })
    expect(((req as { messages: Array<{ content: Array<{ type: string }> }> }).messages[0]?.content[1])?.type).toBe("image")
  })

  it("never works on more than the pool's worth of images at once", async () => {
    const png = await solid("png")
    let inFlight = 0
    let peak = 0
    safeFetchBytes.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return png
    })
    const urls = Array.from({ length: 12 }, (_, i) => ({ type: "image", url: `https://cdn.example/${i}.png` }))

    const out = await inlineImagesForKie(request(urls))

    expect(safeFetchBytes).toHaveBeenCalledTimes(12)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(KIE_INLINE_CONCURRENCY)
    expect(imagesOf(out)).toHaveLength(12)
  })

  it("shrinks each image to its share of the request budget, so the whole request fits", async () => {
    // Six images whose data URLs are each well past 50k characters, against a
    // 300k budget: each gets 50k, and every one is re-encoded to fit it.
    const images = await Promise.all(Array.from({ length: 6 }, () => noisePng(220)))
    for (const png of images) expect(dataUrlLength(block(png))).toBeGreaterThan(50_000)

    const out = await inlineImagesForKie(request(images.map((png) => block(png))), { budgetChars: 300_000 })

    const sent = imagesOf(out)
    expect(sent).toHaveLength(6)
    for (const b of sent) expect(dataUrlLength(b)).toBeLessThanOrEqual(50_000)
    expect(sent.reduce((sum, b) => sum + dataUrlLength(b), 0)).toBeLessThanOrEqual(300_000)
  })

  it("refuses a request whose images cannot all fit the budget even at the smallest re-encode — a lane error, not a huge body", async () => {
    const images = await Promise.all(Array.from({ length: 5 }, () => noisePng(300)))

    const err = await inlineImagesForKie(request(images.map((png) => block(png))), { budgetChars: 20_000 }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(LlmLaneError)
    expect(userFacingMessage(err, "fallback")).toBe(KIE_IMAGES_OVER_BUDGET_MESSAGE)
  })

  it("does the work once per block: asked again for the same blocks, it neither re-fetches nor re-encodes", async () => {
    safeFetchBytes.mockResolvedValue(await solid("png"))
    const big = block(await noisePng(820))
    const req = request([{ type: "image", url: "https://cdn.example/a.png" }, big])

    const first = await inlineImagesForKie(req)
    const second = await inlineImagesForKie(req)

    expect(safeFetchBytes).toHaveBeenCalledTimes(1)
    expect(imagesOf(second)[1]).toBe(imagesOf(first)[1])
  })

  it("retries a failed block on the next call instead of reusing the failure", async () => {
    const png = await solid("png")
    safeFetchBytes.mockRejectedValueOnce(new Error("Image download failed")).mockResolvedValueOnce(png)
    const req = request([{ type: "image", url: "https://cdn.example/flaky.png" }])

    await expect(inlineImagesForKie(req)).rejects.toBeInstanceOf(LlmLaneError)
    const second = await inlineImagesForKie(req)

    expect(safeFetchBytes).toHaveBeenCalledTimes(2)
    expect(imagesOf(second)[0]).toEqual(block(png))
  })

  it("stops before starting work once the caller's signal is aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      inlineImagesForKie(request([{ type: "image", url: "https://cdn.example/a.png" }]), { signal: controller.signal }),
    ).rejects.toThrow()
    expect(safeFetchBytes).not.toHaveBeenCalled()
  })
})
