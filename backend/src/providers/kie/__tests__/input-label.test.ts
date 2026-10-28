import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import sharp from "sharp"

/**
 * A KIE run prepares every input in parallel, so a bare "terminated" or
 * "The operation was aborted due to timeout" said nothing about which input
 * failed. The failure now names the input, its URL (query stripped) and the
 * step, while the error itself is rethrown untouched: the same object, so the
 * worker's retry, refund and user-facing message read exactly what they did.
 */

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn(), runKieTask: vi.fn(), uploadBufferToR2: vi.fn() }))

vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../client.js", async (orig) => ({ ...(await orig<Record<string, unknown>>()), runKieTask: mocks.runKieTask }))
vi.mock("../../../lib/storage.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadBufferToR2: mocks.uploadBufferToR2,
}))

import { atInputStep, labelInputFailure, urlForLog } from "../input-label.js"
import { ensureImageForProvider, KieVideoProvider } from "../video.js"
import { KieError } from "../client.js"
import { providerDetailOf } from "../../../lib/provider-error-detail.js"

const timeoutError = () => new DOMException("The operation was aborted due to timeout", "TimeoutError")
const terminated = () => new TypeError("terminated", { cause: Object.assign(new Error("other side closed"), { name: "SocketError" }) })

/** A response whose headers arrived and whose body read fails, the way undici and the timeout fail. */
const failingBody = (err: unknown) => ({ ok: true, status: 200, arrayBuffer: async () => Promise.reject(err) })

let errors: ReturnType<typeof vi.spyOn>
const logged = () => (errors.mock.calls as unknown[][]).map((c) => c.map(String).join(" ")).join("\n")

beforeEach(() => {
  vi.clearAllMocks()
  errors = vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  mocks.runKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://kie.example/out.mp4"] }, taskId: "t1", providerMs: 1 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("urlForLog", () => {
  it("drops the query and the fragment", () => {
    expect(urlForLog("https://cdn.nodaro.ai/images/a.png?sig=secret&x=1#f")).toBe("https://cdn.nodaro.ai/images/a.png")
    expect(urlForLog("not a url")).toBe("<unparsable url>")
  })
})

describe("atInputStep / labelInputFailure", () => {
  it("rethrows the very same error, logged with the input, URL and step", async () => {
    const err = timeoutError()
    await expect(atInputStep("reference video #1", "https://cdn.nodaro.ai/v.mp4?t=1", "download", () => Promise.reject(err))).rejects.toBe(err)
    expect(logged()).toContain("input reference video #1 failed at download (https://cdn.nodaro.ai/v.mp4): TimeoutError: The operation was aborted due to timeout")
    expect(logged()).not.toContain("t=1")
    expect(err.message).toBe("The operation was aborted due to timeout")
    expect(err.name).toBe("TimeoutError")
  })

  it("puts the label, never the URL, in the operator detail", () => {
    const err = terminated()
    labelInputFailure(err, "reference image #3", "https://cdn.nodaro.ai/images/a.png?sig=s", "download")
    expect(providerDetailOf(err)).toBe(
      "input reference image #3 failed at download: TypeError: terminated (cause: SocketError: other side closed)",
    )
    // Not an own enumerable key: anything that spreads or serializes the error is unchanged.
    expect(Object.keys(err)).toEqual([])
  })

  it("keeps a provider error's own detail and labels an error once", () => {
    const err = new KieError("Generation failed. Please try again.", "HTTP 404 from the CDN", "Video generation")
    labelInputFailure(err, "first frame", "https://cdn.nodaro.ai/a.png", "download")
    labelInputFailure(err, "outer", "https://cdn.nodaro.ai/a.png", "download")
    expect(err.internalDetails).toBe("HTTP 404 from the CDN")
    expect(errors).toHaveBeenCalledTimes(1)
  })
})

describe("ensureImageForProvider labels the input that failed", () => {
  const URL_WITH_QUERY = "https://cdn.nodaro.ai/images/7a045a02.png?cb=2-abc"

  for (const [name, make] of [["a download timeout", timeoutError], ["undici's terminated", terminated]] as const) {
    it(`${name} in the body read: the same error, named "download"`, async () => {
      const err = make()
      mocks.safeFetch.mockResolvedValue(failingBody(err))
      await expect(
        ensureImageForProvider(URL_WITH_QUERY, "kling-4", { context: "Video generation", inputLabel: "reference image #2" }),
      ).rejects.toBe(err)
      expect(logged()).toContain("input reference image #2 failed at download (https://cdn.nodaro.ai/images/7a045a02.png)")
      expect(logged()).not.toContain("cb=2-abc")
    })
  }

  it("an image it cannot decode: the same KieError (user message unchanged), named \"decode\"", async () => {
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => Buffer.from("not an image") })
    const err = await ensureImageForProvider("https://cdn.nodaro.ai/images/x.png", "kling-4", { context: "Video generation" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(KieError)
    expect((err as KieError).message).toBe(
      "The input image could not be read (unsupported or corrupt file). Upload a PNG, JPEG, WebP, HEIC or AVIF image.",
    )
    // The default label when the caller names none.
    expect(logged()).toContain("input image failed at decode (https://cdn.nodaro.ai/images/x.png)")
  })

  it("a failed upload of the converted copy is named \"upload\"", async () => {
    const tiff = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#fff" } }).tiff().toBuffer()
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => tiff })
    const err = new Error("R2 unavailable")
    mocks.uploadBufferToR2.mockRejectedValue(err)
    await expect(ensureImageForProvider("https://cdn.nodaro.ai/images/x.tiff", "kling-4", { context: "Video generation", inputLabel: "start frame" })).rejects.toBe(err)
    expect(logged()).toContain("input start frame failed at upload (https://cdn.nodaro.ai/images/x.tiff)")
  })

  it("downloads the original file of a CDN display rendition, and hands it on", async () => {
    const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#fff" } }).png().toBuffer()
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => png })
    const out = await ensureImageForProvider(
      "https://cdn.nodaro.ai/cdn-cgi/image/width=1600,quality=80,format=auto/community/l-1/p.png",
      "kling-4",
      { context: "Video generation" },
    )
    expect(mocks.safeFetch.mock.calls[0]![0]).toBe("https://cdn.nodaro.ai/community/l-1/p.png")
    expect(out).toBe("https://cdn.nodaro.ai/community/l-1/p.png")
  })
})

describe("Kling 4 names each of its parallel inputs", () => {
  it("the third reference image timing out is named, the error is the same object", async () => {
    const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#fff" } }).png().toBuffer()
    const err = timeoutError()
    mocks.safeFetch.mockImplementation(async (url: string) =>
      url.includes("third") ? failingBody(err) : { ok: true, status: 200, arrayBuffer: async () => png },
    )
    await expect(
      new KieVideoProvider().textToVideo("@image_1 and @image_2 meet @image_3", "kling-4", 5, "16:9", {
        referenceImageUrls: [
          "https://cdn.nodaro.ai/images/first.png",
          "https://cdn.nodaro.ai/images/second.png",
          "https://cdn.nodaro.ai/images/third.png?x=1",
        ],
      }),
    ).rejects.toBe(err)
    expect(logged()).toMatch(/input .*reference image #3 failed at download \(https:\/\/cdn\.nodaro\.ai\/images\/third\.png\): TimeoutError/)
    expect(mocks.runKieTask).not.toHaveBeenCalled()
  })
})
