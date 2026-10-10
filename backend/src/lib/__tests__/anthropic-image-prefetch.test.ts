/**
 * `prefetchAsBase64` turns an image URL into the bytes the Anthropic lanes
 * need: verbatim when Anthropic reads the format and the bytes fit its budget,
 * a JPEG re-encode otherwise, and the URL itself when nothing usable arrived.
 * (KIE's OpenAI-shaped lanes may shrink these bytes further on their own way
 * out — see kie-inline-image.ts.)
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

describe("prefetchAsBase64 — the bytes", () => {
  it("a small readable image keeps its bytes and encoding verbatim", async () => {
    const png = await solid("png")
    safeFetch.mockResolvedValue(served(png, "image/png"))

    expect(await prefetchAsBase64(SOURCE)).toEqual({
      type: "image_base64",
      mediaType: "image/png",
      data: png.toString("base64"),
    })
  })

  it("an oversized image is re-encoded to a smaller JPEG", async () => {
    // Noise barely compresses, so this PNG lands past the 3.5 MB raw budget.
    const big = await sharp(randomBytes(1800 * 1800 * 3), { raw: { width: 1800, height: 1800, channels: 3 } })
      .png()
      .toBuffer()
    expect(big.byteLength).toBeGreaterThan(3_500_000)
    safeFetch.mockResolvedValue(served(big, "image/png"))

    const block = await prefetchAsBase64(SOURCE)

    expect(block).toMatchObject({ type: "image_base64", mediaType: "image/jpeg" })
    expect(block.type === "image_base64" && Buffer.from(block.data, "base64").byteLength).toBeLessThanOrEqual(3_500_000)
  })

  it.each([
    ["TIFF", "tiff", "image/tiff"],
    ["AVIF", "avif", "image/avif"],
  ] as const)("a %s original — a format Anthropic cannot read — becomes a JPEG", async (_label, format, contentType) => {
    safeFetch.mockResolvedValue(served(await solid(format), contentType))

    expect(await prefetchAsBase64(`https://cdn.example/uploads/scan.${format}`)).toMatchObject({
      type: "image_base64",
      mediaType: "image/jpeg",
    })
  })
})

describe("prefetchAsBase64 — the URL fallback", () => {
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
