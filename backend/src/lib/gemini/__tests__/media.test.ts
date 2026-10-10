/**
 * Media resolution for the direct Gemini lane.
 *
 * This is the piece the KIE lane was hiding: KIE dereferenced our R2 URLs
 * server-side, so nothing in this codebase ever had to. Google will not, so a
 * regression here shows up as a model that silently "can't see" the video —
 * not as an error. Hence the coverage.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { GoogleGenAI } from "@google/genai"

const safeFetch = vi.fn()
vi.mock("../../safe-fetch.js", () => ({ safeFetch }))

const { blockToGeminiPart, blocksToGeminiParts, __resetGeminiFileCache } = await import("../media.js")

/** Minimal GoogleGenAI stand-in — only the surfaces media.ts actually touches. */
function fakeAi(overrides: { uploadName?: string; states?: string[] } = {}) {
  const upload = vi.fn().mockResolvedValue({
    name: overrides.uploadName ?? "files/abc123",
    uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
  })
  const states = overrides.states ?? ["ACTIVE"]
  let i = 0
  const get = vi.fn().mockImplementation(async () => ({ state: states[Math.min(i++, states.length - 1)] }))
  return { files: { upload, get } } as unknown as GoogleGenAI & {
    files: { upload: typeof upload; get: typeof get }
  }
}

function bodyResponse(bytes: Buffer, headers: Record<string, string>) {
  return new Response(new Uint8Array(bytes), { status: 200, headers })
}

beforeEach(() => {
  safeFetch.mockReset()
  __resetGeminiFileCache()
})

describe("pure blocks need no network at all", () => {
  it("maps text straight through", async () => {
    const part = await blockToGeminiPart(fakeAi(), { type: "text", text: "hello" })
    expect(part).toEqual({ text: "hello" })
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it("maps image_base64 to inlineData without re-encoding", async () => {
    const part = await blockToGeminiPart(fakeAi(), {
      type: "image_base64",
      mediaType: "image/png",
      data: "QUJD",
    })
    expect(part).toEqual({ inlineData: { mimeType: "image/png", data: "QUJD" } })
    expect(safeFetch).not.toHaveBeenCalled()
  })
})

describe("small assets inline", () => {
  it("base64-inlines a small image and keeps the served MIME type", async () => {
    const bytes = Buffer.from("tiny-image-bytes")
    safeFetch.mockResolvedValue(
      bodyResponse(bytes, { "content-type": "image/webp", "content-length": String(bytes.length) }),
    )

    const part = await blockToGeminiPart(fakeAi(), { type: "image", url: "https://r2.example/pic.webp" })

    expect(part).toEqual({ inlineData: { mimeType: "image/webp", data: bytes.toString("base64") } })
  })

  it("prefers the caller-declared mimeType over the served header", async () => {
    const bytes = Buffer.from("clip")
    safeFetch.mockResolvedValue(
      bodyResponse(bytes, { "content-type": "application/octet-stream", "content-length": String(bytes.length) }),
    )

    const part = await blockToGeminiPart(fakeAi(), {
      type: "video",
      url: "https://r2.example/a.bin",
      mimeType: "video/mp4",
    })

    expect(part).toMatchObject({ inlineData: { mimeType: "video/mp4" } })
  })

  it("falls back to the URL extension when the server says octet-stream", async () => {
    const bytes = Buffer.from("audio")
    safeFetch.mockResolvedValue(
      bodyResponse(bytes, { "content-type": "application/octet-stream", "content-length": String(bytes.length) }),
    )

    const part = await blockToGeminiPart(fakeAi(), { type: "audio", url: "https://r2.example/voice.mp3" })

    // A wrong MIME fails the whole generate call, so octet-stream must never
    // be forwarded verbatim.
    expect(part).toMatchObject({ inlineData: { mimeType: "audio/mpeg" } })
  })
})

describe("large assets upload via the Files API", () => {
  const big = 20 * 1024 * 1024

  it("uploads, waits for ACTIVE, and returns a fileData part", async () => {
    safeFetch.mockResolvedValue(
      bodyResponse(Buffer.from("x".repeat(1024)), {
        "content-type": "video/mp4",
        "content-length": String(big),
      }),
    )
    const ai = fakeAi({ states: ["PROCESSING", "PROCESSING", "ACTIVE"] })

    const part = await blockToGeminiPart(ai, { type: "video", url: "https://r2.example/big.mp4" })

    expect(part).toEqual({
      fileData: {
        fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
        mimeType: "video/mp4",
      },
    })
    expect(ai.files.upload).toHaveBeenCalledOnce()
    // Referencing a still-PROCESSING file fails the generate call, so the
    // poll is load-bearing, not defensive decoration.
    expect(ai.files.get).toHaveBeenCalledTimes(3)
  })

  it("throws when the upload lands in FAILED", async () => {
    safeFetch.mockResolvedValue(
      bodyResponse(Buffer.from("x"), { "content-type": "video/mp4", "content-length": String(big) }),
    )
    const ai = fakeAi({ states: ["FAILED"] })

    await expect(
      blockToGeminiPart(ai, { type: "video", url: "https://r2.example/bad.mp4" }),
    ).rejects.toThrow(/processing failed/)
  })

  it("uploads when the server declares no content-length", async () => {
    safeFetch.mockResolvedValue(bodyResponse(Buffer.from("stream"), { "content-type": "video/mp4" }))
    const ai = fakeAi()

    const part = await blockToGeminiPart(ai, { type: "video", url: "https://r2.example/unknown-size.mp4" })

    // Unknown size must take the safe path, not gamble on inlining.
    expect(part).toHaveProperty("fileData")
    expect(ai.files.upload).toHaveBeenCalledOnce()
  })

  it("reuses the cached handle for a repeated URL instead of re-uploading", async () => {
    safeFetch.mockResolvedValue(
      bodyResponse(Buffer.from("x"), { "content-type": "video/mp4", "content-length": String(big) }),
    )
    const ai = fakeAi()
    const block = { type: "video" as const, url: "https://r2.example/same.mp4" }

    const first = await blockToGeminiPart(ai, block)
    const second = await blockToGeminiPart(ai, block)

    expect(second).toEqual(first)
    expect(ai.files.upload).toHaveBeenCalledOnce()
    expect(safeFetch).toHaveBeenCalledOnce()
  })
})

describe("YouTube is a native input", () => {
  it.each([
    "https://www.youtube.com/watch?v=abc",
    "https://youtu.be/abc",
  ])("passes %s through without downloading it", async (url) => {
    const ai = fakeAi()
    const part = await blockToGeminiPart(ai, { type: "video", url })

    expect(part).toEqual({ fileData: { fileUri: url } })
    expect(safeFetch).not.toHaveBeenCalled()
    expect(ai.files.upload).not.toHaveBeenCalled()
  })
})

describe("failures surface rather than degrade", () => {
  it("throws on a non-OK fetch instead of dropping the reference", async () => {
    safeFetch.mockResolvedValue(new Response("nope", { status: 404 }))

    // Silently dropping the media would leave the model answering about a
    // video it never saw — worse than a hard failure.
    await expect(
      blockToGeminiPart(fakeAi(), { type: "video", url: "https://r2.example/gone.mp4" }),
    ).rejects.toThrow(/fetch failed \(404\)/)
  })
})

describe("blocksToGeminiParts", () => {
  it("wraps a plain string message as a single text part", async () => {
    expect(await blocksToGeminiParts(fakeAi(), "just text")).toEqual([{ text: "just text" }])
  })

  it("preserves block order", async () => {
    const bytes = Buffer.from("i")
    safeFetch.mockResolvedValue(
      bodyResponse(bytes, { "content-type": "image/png", "content-length": String(bytes.length) }),
    )

    const parts = await blocksToGeminiParts(fakeAi(), [
      { type: "image", url: "https://r2.example/a.png" },
      { type: "text", text: "describe it" },
    ])

    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveProperty("inlineData")
    expect(parts[1]).toEqual({ text: "describe it" })
  })
})

describe("video sampling rate (videoMetadata.fps)", () => {
  const big = 20 * 1024 * 1024
  const smallVideo = () =>
    safeFetch.mockResolvedValue(
      bodyResponse(Buffer.from("v"), { "content-type": "video/mp4", "content-length": "1" }),
    )
  const bigVideo = () =>
    safeFetch.mockResolvedValue(
      bodyResponse(Buffer.from("v"), { "content-type": "video/mp4", "content-length": String(big) }),
    )

  // fps must survive EVERY way a video part can be produced. The builder has
  // four such paths and attaches metadata at one choke point precisely so a
  // fifth path added later cannot silently drop it.
  it("attaches fps on the inline path", async () => {
    smallVideo()
    const part = await blockToGeminiPart(fakeAi(), { type: "video", url: "https://r2.example/s.mp4", fps: 3 })
    expect(part).toMatchObject({ inlineData: { mimeType: "video/mp4" }, videoMetadata: { fps: 3 } })
  })

  it("attaches fps on the Files API upload path", async () => {
    bigVideo()
    const part = await blockToGeminiPart(fakeAi(), { type: "video", url: "https://r2.example/b.mp4", fps: 6 })
    expect(part).toMatchObject({ fileData: { mimeType: "video/mp4" }, videoMetadata: { fps: 6 } })
  })

  it("attaches fps on the cached-handle path", async () => {
    bigVideo()
    const ai = fakeAi()
    await blockToGeminiPart(ai, { type: "video", url: "https://r2.example/c.mp4", fps: 2 })
    const second = await blockToGeminiPart(ai, { type: "video", url: "https://r2.example/c.mp4", fps: 4 })

    expect(ai.files.upload).toHaveBeenCalledOnce()
    // The handle is cached; the sampling rate is per-request and must not be.
    expect(second).toMatchObject({ videoMetadata: { fps: 4 } })
  })

  it("attaches fps on the YouTube passthrough path", async () => {
    const part = await blockToGeminiPart(fakeAi(), {
      type: "video",
      url: "https://youtu.be/abc",
      fps: 3,
    })
    expect(part).toEqual({ fileData: { fileUri: "https://youtu.be/abc" }, videoMetadata: { fps: 3 } })
  })

  it("emits no videoMetadata key at all when fps is unset", async () => {
    smallVideo()
    const part = await blockToGeminiPart(fakeAi(), { type: "video", url: "https://r2.example/s.mp4" })
    expect(part).not.toHaveProperty("videoMetadata")
  })

  // google-gemini/cookbook#787 in one assertion: the field belongs on the Part,
  // and nesting it inside the media object is silently wrong on the wire.
  it("never nests videoMetadata inside inlineData or fileData", async () => {
    smallVideo()
    const inline = await blockToGeminiPart(fakeAi(), { type: "video", url: "https://r2.example/s.mp4", fps: 3 })
    expect(inline.inlineData).not.toHaveProperty("videoMetadata")

    bigVideo()
    const uploaded = await blockToGeminiPart(fakeAi(), { type: "video", url: "https://r2.example/b.mp4", fps: 3 })
    expect(uploaded.fileData).not.toHaveProperty("videoMetadata")
  })

  // Out of range is a 400 from Google AFTER the whole clip has been uploaded.
  it.each([0, -1, 24.5, 30, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects fps=%s before the upload round-trip",
    async (fps) => {
      smallVideo()
      const ai = fakeAi()
      await expect(
        blockToGeminiPart(ai, { type: "video", url: "https://r2.example/s.mp4", fps }),
      ).rejects.toThrow(/fps must be in \(0, 24\]/)
    },
  )

  it.each([24, 0.5])("accepts fps=%s (the documented boundary, and sub-1 rates)", async (fps) => {
    smallVideo()
    const part = await blockToGeminiPart(fakeAi(), { type: "video", url: `https://r2.example/${fps}.mp4`, fps })
    expect(part).toMatchObject({ videoMetadata: { fps } })
  })
})

/**
 * Inline video bytes (`video_base64`).
 *
 * The whole point of this block is that the caller already holds the exact,
 * immutable payload it wants analysed — so the two properties worth pinning are
 * that we NEVER go to the network for it, and that we never pass along bytes we
 * have not proved are an MP4 of an acceptable size. Everything here runs while
 * the request is still being built, upstream of `generateContent`: a rejected
 * payload costs a throw, not a billed prompt.
 */
describe("inline video bytes need no network and are validated first", () => {
  /** A minimal but real ISO-BMFF header: 24-byte `ftyp` box + padding. */
  function mp4(payloadBytes = 32): Buffer {
    const ftyp = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from("ftypisom", "latin1"),
      Buffer.from("isomiso2mp41", "latin1"),
    ])
    return Buffer.concat([ftyp, Buffer.alloc(payloadBytes, 0x21)])
  }

  const validData = mp4().toString("base64")

  it("maps validated bytes to inlineData verbatim, with no fetch and no upload", async () => {
    const ai = fakeAi()
    const part = await blockToGeminiPart(ai, {
      type: "video_base64",
      mediaType: "video/mp4",
      data: validData,
    })

    // Verbatim: re-encoding would change the very bytes the caller pinned.
    expect(part).toEqual({ inlineData: { mimeType: "video/mp4", data: validData } })
    expect(safeFetch).not.toHaveBeenCalled()
    expect(ai.files.upload).not.toHaveBeenCalled()
  })

  it("carries fps as videoMetadata beside inlineData (never nested inside it)", async () => {
    const part = await blockToGeminiPart(fakeAi(), {
      type: "video_base64",
      mediaType: "video/mp4",
      data: validData,
      fps: 3,
    })

    expect(part).toEqual({
      inlineData: { mimeType: "video/mp4", data: validData },
      videoMetadata: { fps: 3 },
    })
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it.each([0, -1, 24.5, 30, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects fps=%s on inline bytes too",
    async (fps) => {
      await expect(
        blockToGeminiPart(fakeAi(), { type: "video_base64", mediaType: "video/mp4", data: validData, fps }),
      ).rejects.toThrow(/fps must be in \(0, 24\]/)
    },
  )

  it("accepts fps at the documented 24 boundary", async () => {
    const part = await blockToGeminiPart(fakeAi(), {
      type: "video_base64", mediaType: "video/mp4", data: validData, fps: 24,
    })
    expect(part).toMatchObject({ videoMetadata: { fps: 24 } })
  })

  // Node's base64 decoder is lenient — it skips whitespace and tolerates junk —
  // so "Buffer.from didn't throw" is not evidence. Round-tripping the encode is.
  it.each([
    ["whitespace/newlines", `${validData.slice(0, 8)}\n${validData.slice(8)}`],
    ["a data: URI prefix", `data:video/mp4;base64,${validData}`],
    ["the URL-safe alphabet", "-_-_-_-_"],
    ["non-base64 characters", "not base64 at all!!"],
  ])("rejects %s as non-canonical base64", async (_label, data) => {
    await expect(
      blockToGeminiPart(fakeAi(), { type: "video_base64", mediaType: "video/mp4", data }),
    ).rejects.toThrow(/canonical base64/)
  })

  it("rejects an empty payload", async () => {
    await expect(
      blockToGeminiPart(fakeAi(), { type: "video_base64", mediaType: "video/mp4", data: "" }),
    ).rejects.toThrow(/data is empty/)
  })

  // Exact, not a family: Gemini keys its decoder off the declared type.
  it.each(["video/quicktime", "video/mp4; codecs=avc1", "video/*", "image/png", "VIDEO/MP4"])(
    "rejects mediaType %s — only exactly video/mp4 is accepted",
    async (mediaType) => {
      await expect(
        blockToGeminiPart(fakeAi(), {
          type: "video_base64",
          mediaType: mediaType as "video/mp4",
          data: validData,
        }),
      ).rejects.toThrow(/mediaType must be exactly "video\/mp4"/)
    },
  )

  it("rejects bytes that are not an MP4 (no ftyp box)", async () => {
    const notMp4 = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(64, 0x41)]).toString("base64")
    await expect(
      blockToGeminiPart(fakeAi(), { type: "video_base64", mediaType: "video/mp4", data: notMp4 }),
    ).rejects.toThrow(/not an MP4/)
  })

  it("rejects a payload too short to hold an ftyp box", async () => {
    await expect(
      blockToGeminiPart(fakeAi(), { type: "video_base64", mediaType: "video/mp4", data: Buffer.from("ftyp").toString("base64") }),
    ).rejects.toThrow(/not an MP4/)
  })

  it("rejects over-6-MiB payloads before allocating a decode buffer", async () => {
    // Length alone puts this past the raw ceiling — the guard must not need to
    // decode it to know that, so the message is the base64-length one.
    const oversize = "A".repeat(Math.ceil((6 * 1024 * 1024) / 3) * 4 + 8)
    await expect(
      blockToGeminiPart(fakeAi(), { type: "video_base64", mediaType: "video/mp4", data: oversize }),
    ).rejects.toThrow(/base64 payload is \d+ chars, past the/)
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it("rejects a payload whose DECODED size clears the 6 MiB ceiling", async () => {
    // One byte past the limit: inside the pre-decode allocation guard's slack,
    // so it is the RAW-byte check that has to catch it. That is the point —
    // the ceiling is on real bytes, not on the length of the encoded string.
    const big = Buffer.concat([mp4(0), Buffer.alloc(6 * 1024 * 1024 - 24 + 1, 0x21)])
    expect(big.length).toBe(6 * 1024 * 1024 + 1)
    await expect(
      blockToGeminiPart(fakeAi(), { type: "video_base64", mediaType: "video/mp4", data: big.toString("base64") }),
    ).rejects.toThrow(/exceeds the 6291456-byte inline limit/)
  })

  it("accepts a payload sitting exactly at the 6 MiB ceiling", async () => {
    const exact = Buffer.concat([mp4(0), Buffer.alloc(6 * 1024 * 1024 - 24, 0x21)])
    expect(exact.length).toBe(6 * 1024 * 1024)
    const part = await blockToGeminiPart(fakeAi(), {
      type: "video_base64", mediaType: "video/mp4", data: exact.toString("base64"),
    })
    expect(part).toMatchObject({ inlineData: { mimeType: "video/mp4" } })
  })

  it("resolves inside a whole message alongside text", async () => {
    const parts = await blocksToGeminiParts(fakeAi(), [
      { type: "video_base64", mediaType: "video/mp4", data: validData, fps: 2 },
      { type: "text", text: "describe this clip" },
    ])
    expect(parts).toEqual([
      { inlineData: { mimeType: "video/mp4", data: validData }, videoMetadata: { fps: 2 } },
      { text: "describe this clip" },
    ])
    expect(safeFetch).not.toHaveBeenCalled()
  })
})
