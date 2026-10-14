// @vitest-environment node
/**
 * The editor's read of a stored face-track file (P3.9): bounded by the
 * descriptor's size, checked by its hash before it is parsed, cached per hash
 * (a file never changes under its hash), and a failed read is retried.
 */
import { createHash } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({ getJobStatus: vi.fn() }))

import { SPEAKER_TRACKS_MAX_BYTES } from "@nodaro/shared/edl"
import { readSpeakerTrackBody, speakerTrackBodyFailureOf, SpeakerTrackBodyError } from "../speaker-track-body"

const BODY = { version: 1, sampleFps: 2, detector: { id: "yunet" }, sources: [] }
// The body cache is keyed by hash: every test reads its own file (trailing spaces still parse).
let n = 0
const freshBody = () => JSON.stringify(BODY) + " ".repeat(++n)
const bytesOf = (text: string) => new TextEncoder().encode(text)
const descriptorFor = (text: string, over: Record<string, unknown> = {}) => {
  const b = bytesOf(text)
  return { url: `https://cdn/speaker-tracks/${Math.random()}.json`, sha256: createHash("sha256").update(b).digest("hex"), bytes: b.length, ...over }
}
const serve = (text: string, init: ResponseInit = { status: 200 }) => vi.fn(async () => new Response(bytesOf(text), init))

afterEach(() => vi.unstubAllGlobals())

describe("readSpeakerTrackBody", () => {
  it("returns the checked body, and reads one file once per hash", async () => {
    const text = freshBody()
    const fetchMock = serve(text)
    vi.stubGlobal("fetch", fetchMock)
    const d = descriptorFor(text)
    expect(await readSpeakerTrackBody(d)).toMatchObject({ version: 1, sampleFps: 2 })
    await readSpeakerTrackBody(d)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("refuses a descriptor with no usable size, before any download", async () => {
    const fetchMock = serve("{}")
    vi.stubGlobal("fetch", fetchMock)
    for (const bytes of [0, SPEAKER_TRACKS_MAX_BYTES + 1]) {
      const err = await readSpeakerTrackBody(descriptorFor("{}", { bytes, sha256: String(bytes).padStart(64, "0") })).catch((e: unknown) => e)
      expect(speakerTrackBodyFailureOf(err)).toBe("mismatch")
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a file that says it is larger than its descriptor", async () => {
    const text = freshBody()
    vi.stubGlobal("fetch", serve(text, { status: 200, headers: { "content-length": String(text.length + 10) } }))
    const err = await readSpeakerTrackBody(descriptorFor(text)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SpeakerTrackBodyError)
    expect(speakerTrackBodyFailureOf(err)).toBe("mismatch")
  })

  it("refuses a file whose hash is not the descriptor's", async () => {
    const text = freshBody()
    vi.stubGlobal("fetch", serve(text))
    const err = await readSpeakerTrackBody(descriptorFor(text, { sha256: "0".repeat(64) })).catch((e: unknown) => e)
    expect(speakerTrackBodyFailureOf(err)).toBe("mismatch")
  })

  it("names a download failure, and a file that is not a track set", async () => {
    vi.stubGlobal("fetch", serve("", { status: 404 }))
    expect(speakerTrackBodyFailureOf(await readSpeakerTrackBody(descriptorFor("{}")).catch((e: unknown) => e))).toBe("fetch")
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    expect(speakerTrackBodyFailureOf(await readSpeakerTrackBody(descriptorFor("{}")).catch((e: unknown) => e))).toBe("fetch")
    vi.stubGlobal("fetch", serve("{oops"))
    expect(speakerTrackBodyFailureOf(await readSpeakerTrackBody(descriptorFor("{oops")).catch((e: unknown) => e))).toBe("unreadable")
  })

  it("forgets a failed read, so the next one downloads again", async () => {
    const text = freshBody()
    const d = descriptorFor(text)
    vi.stubGlobal("fetch", serve("", { status: 503 }))
    await expect(readSpeakerTrackBody(d)).rejects.toBeInstanceOf(SpeakerTrackBodyError)
    const retry = serve(text)
    vi.stubGlobal("fetch", retry)
    expect(await readSpeakerTrackBody(d)).toMatchObject({ version: 1 })
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
