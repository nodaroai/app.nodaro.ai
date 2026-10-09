/**
 * `prefetchAsBase64` returns the bytes the Anthropic lanes need AND — when the
 * original is a format every vision lane reads — the URL those bytes came from.
 *
 * The bytes exist for Anthropic's per-image cap. The URL exists for the lanes
 * that would rather the provider fetch the image itself: KIE refuses a large
 * inline `data:` URL ("Upload the file and pass an HTTP(S) URL instead") and
 * dereferences an https URL on its own. A block that drops the URL leaves those
 * lanes nothing to send but the bytes, which is how a 2 MB PNG failed a
 * Describe to Picker run on Gemini.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import sharp from "sharp"
import { randomBytes } from "node:crypto"

const safeFetch = vi.fn()
vi.mock("../safe-fetch.js", () => ({ safeFetch }))

const { prefetchAsBase64 } = await import("../anthropic-image.js")

const SOURCE = "https://cdn.example/uploads/portrait.png"

function served(bytes: Buffer, contentType: string, status = 200): Response {
  return new Response(new Uint8Array(bytes), { status, headers: { "content-type": contentType } })
}

const solid = (format: "png" | "tiff" | "avif") =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: "#336699" } })[format]().toBuffer()

beforeEach(() => {
  safeFetch.mockReset()
})

describe("prefetchAsBase64 — a readable original is named on both base64 paths", () => {
  it("a small readable image keeps its bytes and encoding verbatim, plus the URL they came from", async () => {
    const png = await solid("png")
    safeFetch.mockResolvedValue(served(png, "image/png"))

    expect(await prefetchAsBase64(SOURCE)).toEqual({
      type: "image_base64",
      mediaType: "image/png",
      data: png.toString("base64"),
      sourceUrl: SOURCE,
    })
  })

  it("an oversized image is re-encoded smaller, names the original, and says the bytes are a downscaled copy", async () => {
    // Noise barely compresses, so this PNG lands past the 3.5 MB raw budget.
    const big = await sharp(randomBytes(1800 * 1800 * 3), { raw: { width: 1800, height: 1800, channels: 3 } })
      .png()
      .toBuffer()
    expect(big.byteLength).toBeGreaterThan(3_500_000)
    safeFetch.mockResolvedValue(served(big, "image/png"))

    expect(await prefetchAsBase64(SOURCE)).toMatchObject({
      type: "image_base64",
      mediaType: "image/jpeg",
      sourceUrl: SOURCE,
      downscaled: true,
    })
  })

})

describe("prefetchAsBase64 — an original converted from another format is not named", () => {
  // Re-encoded for FORMAT, not size: the original's URL would hand a URL-only
  // lane bytes it may not read, so the converted JPEG (downscaled, so small)
  // is the only form the block offers.
  it.each([
    ["TIFF", "tiff", "image/tiff"],
    ["AVIF", "avif", "image/avif"],
  ] as const)("a %s original becomes a JPEG with no sourceUrl", async (_label, format, contentType) => {
    const original = await solid(format)
    safeFetch.mockResolvedValue(served(original, contentType))

    const block = await prefetchAsBase64(`https://cdn.example/uploads/scan.${format}`)

    expect(block).toMatchObject({ type: "image_base64", mediaType: "image/jpeg" })
    expect(block).not.toHaveProperty("sourceUrl")
    expect(block).not.toHaveProperty("downscaled")
  })
})

describe("prefetchAsBase64 — the URL fallback carries no sourceUrl", () => {
  // The fallback IS the URL; a second copy of it would only invite a lane to
  // treat a block it could not prefetch as one it did.
  it("on an HTTP error", async () => {
    safeFetch.mockResolvedValue(served(Buffer.from("missing"), "text/plain", 404))

    expect(await prefetchAsBase64(SOURCE)).toEqual({ type: "image", url: SOURCE })
  })

  it("when the fetch is refused", async () => {
    safeFetch.mockRejectedValue(new Error("blocked: resolves to a private address"))

    expect(await prefetchAsBase64(SOURCE)).toEqual({ type: "image", url: SOURCE })
  })

  it("when the body does not decode as an image", async () => {
    safeFetch.mockResolvedValue(served(Buffer.from("definitely not an image"), "image/avif"))

    expect(await prefetchAsBase64(SOURCE)).toEqual({ type: "image", url: SOURCE })
  })
})
