/**
 * Same-site voice previews (lib/voice-preview-proxy.ts): the signed address
 * the voice lists hand out, and the capped, cached fetch of the provider's
 * file behind it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const safeFetch = vi.hoisted(() => vi.fn())
vi.mock("../safe-fetch.js", async (orig) => ({ ...(await orig<typeof import("../safe-fetch.js")>()), safeFetch }))

import {
  MAX_PREVIEW_BYTES,
  PreviewUnavailableError,
  __resetVoicePreviewProxyForTests,
  loadPreview,
  requestedRange,
  sameSitePreviewPath,
  verifiedPreviewSource,
  withSameSitePreviews,
} from "../voice-preview-proxy.js"

const UPSTREAM = "https://storage.googleapis.com/eleven-public-prod/premade/voices/abc/1.mp3"

/** The `src` and `sig` of a same-site preview address. */
function partsOf(path: string): { voiceId: string; src: string; sig: string } {
  const url = new URL(path, "https://site.invalid")
  const voiceId = /^\/v1\/voices\/([^/]+)\/preview$/.exec(url.pathname)?.[1] ?? ""
  return { voiceId, src: url.searchParams.get("src") ?? "", sig: url.searchParams.get("sig") ?? "" }
}

/** A provider answer whose body arrives in `chunks`, with the given headers. */
function answer(chunks: Uint8Array[], headers: Record<string, string>, status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(body, { status, headers })
}

beforeEach(() => {
  safeFetch.mockReset()
  __resetVoicePreviewProxyForTests()
})

describe("the signed same-site address", () => {
  it("names the provider's file, for that voice, behind a signature", () => {
    const path = sameSitePreviewPath("Rachel", UPSTREAM)!
    expect(path).toMatch(/^\/v1\/voices\/Rachel\/preview\?src=[A-Za-z0-9_-]+&sig=[A-Za-z0-9_-]+$/)
    const { voiceId, src, sig } = partsOf(path)
    expect(verifiedPreviewSource(voiceId, src, sig)).toBe(UPSTREAM)
  })

  it("refuses a changed file address, a changed signature, and another voice's id", () => {
    const { src, sig } = partsOf(sameSitePreviewPath("Rachel", UPSTREAM)!)
    const otherSrc = Buffer.from("https://evil.example/x.mp3").toString("base64url")
    expect(verifiedPreviewSource("Rachel", otherSrc, sig)).toBeNull()
    expect(verifiedPreviewSource("Rachel", src, sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A"))).toBeNull()
    expect(verifiedPreviewSource("Rachel", src, "")).toBeNull()
    // A signature taken from one voice does not open another voice's file.
    expect(verifiedPreviewSource("Adam", src, sig)).toBeNull()
  })

  it("refuses what is not a string, too long, or not an https address", () => {
    const { src, sig } = partsOf(sameSitePreviewPath("Rachel", UPSTREAM)!)
    expect(verifiedPreviewSource("Rachel", undefined, sig)).toBeNull()
    expect(verifiedPreviewSource("Rachel", src, ["x"])).toBeNull()
    expect(verifiedPreviewSource("Rachel", "a".repeat(5000), sig)).toBeNull()
    expect(verifiedPreviewSource("../x", src, sig)).toBeNull()
    expect(sameSitePreviewPath("Rachel", "http://storage.googleapis.com/x.mp3")).toBeNull()
    expect(sameSitePreviewPath("Rachel", "https://user:pass@host/x.mp3")).toBeNull()
    expect(sameSitePreviewPath("not an id", UPSTREAM)).toBeNull()
  })
})

describe("withSameSitePreviews", () => {
  it("gives each preview its same-site address, as a copy of the list", () => {
    const voices = [
      { voice_id: "Rachel", name: "Rachel", preview_url: UPSTREAM },
      { voice_id: "Aria", name: "Aria", preview_url: "" },
      { voice_id: "Odd", name: "Odd", preview_url: "http://insecure.example/x.mp3" },
    ]
    const before = JSON.stringify(voices)

    const out = withSameSitePreviews(voices)

    expect(out[0]!.preview_url).toMatch(/^\/v1\/voices\/Rachel\/preview\?/)
    // No preview stays none; one the proxy cannot serve is not left pointing off the site.
    expect(out[1]!.preview_url).toBe("")
    expect(out[2]!.preview_url).toBe("")
    expect(out[0]).toMatchObject({ voice_id: "Rachel", name: "Rachel" })
    expect(JSON.stringify(voices)).toBe(before)
  })
})

describe("loadPreview", () => {
  it("serves the provider's audio, and asks the provider once per file", async () => {
    safeFetch.mockImplementation(async () => answer([new Uint8Array([1, 2, 3])], { "content-type": "audio/mpeg; charset=binary" }))

    const [a, b] = await Promise.all([loadPreview(UPSTREAM), loadPreview(UPSTREAM)])
    const c = await loadPreview(UPSTREAM)

    expect([...a.body]).toEqual([1, 2, 3])
    expect(a.contentType).toBe("audio/mpeg")
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(safeFetch).toHaveBeenCalledTimes(1)
    expect(safeFetch).toHaveBeenCalledWith(UPSTREAM, expect.objectContaining({ timeoutMs: expect.any(Number) }))
  })

  it("holds the size cap while reading, whatever the provider says the length is", async () => {
    const half = new Uint8Array(MAX_PREVIEW_BYTES / 2 + 1)
    // No length at all, then a length that lies.
    safeFetch.mockResolvedValueOnce(answer([half, half], { "content-type": "audio/mpeg" }))
    await expect(loadPreview(UPSTREAM)).rejects.toMatchObject({ name: "PreviewUnavailableError", reason: "too_large" })

    safeFetch.mockResolvedValueOnce(answer([half, half], { "content-type": "audio/mpeg", "content-length": "10" }))
    await expect(loadPreview(UPSTREAM)).rejects.toMatchObject({ reason: "too_large" })
  })

  it("refuses a declared length over the cap without reading it", async () => {
    safeFetch.mockResolvedValueOnce(answer([new Uint8Array(1)], { "content-type": "audio/mpeg", "content-length": String(MAX_PREVIEW_BYTES + 1) }))
    await expect(loadPreview(UPSTREAM)).rejects.toMatchObject({ reason: "too_large" })
  })

  it("serves only audio", async () => {
    safeFetch.mockResolvedValueOnce(answer([new TextEncoder().encode("<html>")], { "content-type": "text/html" }))
    await expect(loadPreview(UPSTREAM)).rejects.toMatchObject({ reason: "not_audio" })
  })

  it("a provider failure, or a fetch safeFetch refused, is the provider's", async () => {
    safeFetch.mockResolvedValueOnce(answer([], { "content-type": "audio/mpeg" }, 404))
    await expect(loadPreview(UPSTREAM)).rejects.toMatchObject({ reason: "upstream" })

    safeFetch.mockRejectedValueOnce(new Error("safeFetch: blocked — 10.0.0.1 is a private/reserved IP"))
    await expect(loadPreview(UPSTREAM)).rejects.toBeInstanceOf(PreviewUnavailableError)
  })

  it("keeps nothing it refused: the next play asks again", async () => {
    safeFetch.mockResolvedValueOnce(answer([], { "content-type": "audio/mpeg" }, 500))
    await expect(loadPreview(UPSTREAM)).rejects.toBeInstanceOf(PreviewUnavailableError)
    safeFetch.mockResolvedValueOnce(answer([new Uint8Array([9])], { "content-type": "audio/mpeg" }))
    expect([...(await loadPreview(UPSTREAM)).body]).toEqual([9])
    expect(safeFetch).toHaveBeenCalledTimes(2)
  })
})

describe("requestedRange", () => {
  it("reads the one byte range a media player asks for", () => {
    expect(requestedRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 })
    expect(requestedRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 })
    expect(requestedRange("bytes=10-200", 100)).toEqual({ start: 10, end: 99 })
    expect(requestedRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 })
    expect(requestedRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 })
  })

  it("is unsatisfiable past the end, or backwards", () => {
    expect(requestedRange("bytes=100-", 100)).toBe("unsatisfiable")
    expect(requestedRange("bytes=50-10", 100)).toBe("unsatisfiable")
    expect(requestedRange("bytes=-0", 100)).toBe("unsatisfiable")
  })

  it("serves the whole file for no range, another form, or several ranges", () => {
    expect(requestedRange(undefined, 100)).toBeNull()
    expect(requestedRange("bytes=-", 100)).toBeNull()
    expect(requestedRange("items=0-1", 100)).toBeNull()
    expect(requestedRange("bytes=0-1,5-6", 100)).toBeNull()
  })
})
