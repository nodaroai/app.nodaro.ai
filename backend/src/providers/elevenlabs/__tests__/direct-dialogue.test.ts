import { describe, it, expect, vi, afterEach } from "vitest"
import { directElevenLabsDialogue } from "../direct-dialogue.js"

vi.mock("../../../lib/config.js", () => ({
  config: { ELEVENLABS_API_KEY: "test-key" },
}))

describe("directElevenLabsDialogue", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // This funnel hardcodes model_id "eleven_v3" — the request-body pin for the
  // P6 language funnel (mirrors direct-tts.test.ts's harness).
  it("normalizes a 639-3 languageCode to 639-1 before it reaches the wire", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })
    vi.stubGlobal("fetch", fetchMock)

    await directElevenLabsDialogue(
      [{ text: "shalom", voice: "Rachel" }],
      { languageCode: "heb" },
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.model_id).toBe("eleven_v3")
    expect(body.language_code).toBe("he")
  })

  // Byte-identity pin: a plain ISO 639-1 code must reach the wire unchanged.
  it("passes a two-letter languageCode through unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })
    vi.stubGlobal("fetch", fetchMock)

    await directElevenLabsDialogue(
      [{ text: "hello", voice: "Rachel" }],
      { languageCode: "en" },
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.language_code).toBe("en")
  })
})
