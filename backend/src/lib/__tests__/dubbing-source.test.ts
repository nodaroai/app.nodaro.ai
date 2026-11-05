import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

// A dub's link is handed to the dubbing service, which fetches it: an import
// of someone else's link unless it is a file of this install's own storage
// (strictly: under R2_PUBLIC_URL/, no character two URL parsers read
// differently, not a transform of the content network). A run's dub of a link
// is read by the gate before its job is created.

const gate = vi.hoisted(() => ({
  requireImportAllowed: vi.fn(async (): Promise<void> => undefined),
}))

vi.mock("../import-gate.js", () => ({
  isImportRefusal: (e: unknown) => e instanceof Error && "code" in e,
  requireImportAllowed: gate.requireImportAllowed,
}))

import { isOwnStoredFileUrl } from "../own-storage-url.js"
import { dubbingRunImportRequest, dubbingSourceIsImport, dubbingSourceRefusal } from "../dubbing-source.js"
import { UNUSABLE_LINK_MESSAGE } from "../unusable-link.js"
import { PROJECT_DUBBING_NEEDS_UPLOAD } from "../dubbing-model.js"

const OWN = "https://cdn.nodaro.test/assets"
const USER = "00000000-0000-4000-8000-000000000001"
const CONFIRMATION = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"
// Built from code points, never written as escapes in the source.
const TAB = String.fromCharCode(9)
const BACKSLASH = String.fromCharCode(0x5c)
const ORIGINAL_PUBLIC_URL = process.env.R2_PUBLIC_URL

beforeEach(() => {
  vi.clearAllMocks()
  gate.requireImportAllowed.mockImplementation(async () => undefined)
  process.env.R2_PUBLIC_URL = OWN
})

afterAll(() => {
  if (ORIGINAL_PUBLIC_URL === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = ORIGINAL_PUBLIC_URL
})

describe("isOwnStoredFileUrl", () => {
  it("a file under the install's own storage is ours", () => {
    expect(isOwnStoredFileUrl(`${OWN}/videos/v.mp4`)).toBe(true)
    expect(isOwnStoredFileUrl(`${OWN}/uploads/clip?download=1`)).toBe(true)
  })

  it("a link two URL parsers read differently is never ours, even when one parser reads it under our storage", () => {
    expect(isOwnStoredFileUrl(`${OWN}/videos/v.mp4${BACKSLASH}@evil.example/x`)).toBe(false)
    expect(isOwnStoredFileUrl(`${OWN}/videos/v${TAB}.mp4`)).toBe(false)
    // In the query too, where this parser keeps it as it is.
    expect(isOwnStoredFileUrl(`${OWN}/videos/v.mp4?a=${BACKSLASH}b`)).toBe(false)
  })

  it("a transform of the content network on our own host can name a remote source: not ours", () => {
    process.env.R2_PUBLIC_URL = "https://cdn.nodaro.test"
    expect(isOwnStoredFileUrl("https://cdn.nodaro.test/videos/v.mp4")).toBe(true)
    expect(isOwnStoredFileUrl("https://cdn.nodaro.test/cdn-cgi/media/mode=video/https://example.com/talk")).toBe(false)
    expect(isOwnStoredFileUrl("https://cdn.nodaro.test/CDN-CGI/image/width=100/https://example.com/a.png")).toBe(false)
  })

  it("a link not written in its one normal form is not ours: an escape another reader decodes, a dot segment, a case", () => {
    process.env.R2_PUBLIC_URL = "https://cdn.nodaro.test"
    // Another HTTP client, or the content network's own URL normalisation, reads %2D as "-": a transform.
    expect(isOwnStoredFileUrl("https://cdn.nodaro.test/cdn%2Dcgi/media/mode=video/https://example.com/talk.mp4")).toBe(false)
    expect(isOwnStoredFileUrl("https://cdn.nodaro.test/videos/My%20Video.mp4")).toBe(false)
    expect(isOwnStoredFileUrl("https://cdn.nodaro.test/videos/../videos/v.mp4")).toBe(false)
    expect(isOwnStoredFileUrl("https://CDN.nodaro.test/videos/v.mp4")).toBe(false)
    expect(isOwnStoredFileUrl("https://cdn.nodaro.test:443/videos/v.mp4")).toBe(false)
    // A query is not the path: a signed or sized link of ours stays ours.
    expect(isOwnStoredFileUrl("https://cdn.nodaro.test/videos/v.mp4?download=My%20Video.mp4")).toBe(true)
  })

  it("outside the configured subtree, on another host, or with no storage configured: not ours", () => {
    expect(isOwnStoredFileUrl("https://cdn.nodaro.test/other/v.mp4")).toBe(false)
    expect(isOwnStoredFileUrl(`${OWN}-evil/v.mp4`)).toBe(false)
    expect(isOwnStoredFileUrl("https://evil.example/assets/v.mp4")).toBe(false)
    delete process.env.R2_PUBLIC_URL
    expect(isOwnStoredFileUrl(`${OWN}/videos/v.mp4`)).toBe(false)
  })

  it("not a link at all: not ours", () => {
    expect(isOwnStoredFileUrl("not a link")).toBe(false)
    expect(isOwnStoredFileUrl("")).toBe(false)
  })
})

describe("dubbingRunImportRequest — the request a run's dub of a link spends under", () => {
  it("is the run and the node for a dub of its own link, so every iteration of a repeated node spends the run's one confirmation", () => {
    expect(dubbingRunImportRequest("dubbing", { sourceUrl: "https://example.com/talk" }, "exec-1", "n1")).toBe("exec-1:n1")
  })

  it("none for a dub with no link of its own, or for another job", () => {
    expect(dubbingRunImportRequest("dubbing", { videoUrl: "https://cdn.nodaro.ai/v.mp4" }, "exec-1", "n1")).toBeNull()
    expect(dubbingRunImportRequest("dubbing", { sourceUrl: "" }, "exec-1", "n1")).toBeNull()
    expect(dubbingRunImportRequest("transcribe", { sourceUrl: "https://example.com/talk" }, "exec-1", "n1")).toBeNull()
  })
})

describe("dubbingSourceIsImport", () => {
  it("every link but a file of ours is an import: a page, a direct file, a platform's page that ends like a file", () => {
    const links = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://example.com/talks/keynote",
      "https://files.example.com/talk.mp4",
      "https://files.example.com/talk.mp3",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ.mp4",
    ]
    for (const url of links) expect(dubbingSourceIsImport(url)).toBe(true)
  })

  it("a file of ours is not", () => {
    expect(dubbingSourceIsImport(`${OWN}/videos/v.mp4`)).toBe(false)
  })
})

describe("dubbingSourceRefusal — a run's dub of a link, read before its job", () => {
  const account = { userId: USER, via: "api" as const }

  it("another job, or a dub with no link, asks nothing", async () => {
    expect(await dubbingSourceRefusal("text-to-speech", { sourceUrl: "https://example.com/x" }, account)).toBeNull()
    expect(await dubbingSourceRefusal("dubbing", { videoUrl: "https://x.example/c.mp4" }, account)).toBeNull()
    expect(await dubbingSourceRefusal("dubbing", { sourceUrl: 42 }, account)).toBeNull()
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
  })

  it("a link is read by the gate with the run's account, the node's confirmation, the run's lane and its way in", async () => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    expect(await dubbingSourceRefusal("dubbing", { sourceUrl: url, confirmationId: CONFIRMATION }, account)).toBeNull()
    expect(gate.requireImportAllowed).toHaveBeenCalledWith(url, { userId: USER, confirmationId: CONFIRMATION, lane: "run", via: "api" })
  })

  it("a confirmation that is not text is no confirmation", async () => {
    await dubbingSourceRefusal("dubbing", { sourceUrl: "https://example.com/x", confirmationId: 7 }, { userId: USER, via: null })
    expect(gate.requireImportAllowed).toHaveBeenCalledWith("https://example.com/x", expect.objectContaining({ confirmationId: null, via: null }))
  })

  it("a refusal by the gate is the refusal: its code and its words", async () => {
    const words = "Confirm that you hold the rights to this content before it is imported."
    gate.requireImportAllowed.mockRejectedValueOnce(Object.assign(new Error(words), { code: "rights_confirmation_required" }))
    expect(await dubbingSourceRefusal("dubbing", { sourceUrl: "https://example.com/x" }, account)).toEqual({ code: "rights_confirmation_required", message: words })
  })

  it("any other failure is not a refusal: it is thrown", async () => {
    gate.requireImportAllowed.mockRejectedValueOnce(new Error("database down"))
    await expect(dubbingSourceRefusal("dubbing", { sourceUrl: "https://example.com/x" }, account)).rejects.toThrow("database down")
  })

  it("a link two URL parsers read differently is refused before the gate", async () => {
    const refusal = await dubbingSourceRefusal("dubbing", { sourceUrl: `https://www.youtube.com${BACKSLASH}@10.0.0.1/watch?v=abc` }, account)
    expect(refusal).toEqual({ code: "validation_error", message: UNUSABLE_LINK_MESSAGE })
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
  })

  it("a file of ours asks nothing", async () => {
    expect(await dubbingSourceRefusal("dubbing", { sourceUrl: `${OWN}/videos/v.mp4` }, account)).toBeNull()
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
  })

  it("a dub into Hebrew of a link is refused before the gate: no confirmation is read for a dub that cannot start", async () => {
    const refusal = await dubbingSourceRefusal("dubbing", { sourceUrl: "https://www.youtube.com/watch?v=abc", targetLanguage: "he", confirmationId: CONFIRMATION }, account)
    expect(refusal).toEqual({ code: "unsupported_dubbing_settings", message: PROJECT_DUBBING_NEEDS_UPLOAD })
    expect(gate.requireImportAllowed).not.toHaveBeenCalled()
  })
})
