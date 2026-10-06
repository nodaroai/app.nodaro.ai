import { describe, it, expect, vi, afterEach } from "vitest"
import { directElevenLabsDialogue } from "../direct-dialogue.js"

vi.mock("../../../lib/config.js", () => ({
  config: { ELEVENLABS_API_KEY: "test-key" },
}))

/** A minimal with-timestamps answer: audio bytes plus the one-character alignment the builder needs. */
function withTimestampsAnswer(): Response {
  return new Response(
    JSON.stringify({
      audio_base64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      alignment: { characters: ["h"], character_start_times_seconds: [0], character_end_times_seconds: [0.1] },
      voice_segments: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

describe("directElevenLabsDialogue", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // v3 dialogue posts /with-timestamps (decided 2026-10-06) and the model comes from
  // the sheet — the request-body pin for the P6 language funnel (mirrors
  // direct-tts.test.ts's harness). The answer is the with-timestamps JSON.
  it("normalizes a 639-3 languageCode to 639-1 before it reaches the wire", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => withTimestampsAnswer())
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
    const fetchMock = vi.fn().mockImplementation(async () => withTimestampsAnswer())
    vi.stubGlobal("fetch", fetchMock)

    await directElevenLabsDialogue(
      [{ text: "hello", voice: "Rachel" }],
      { languageCode: "en" },
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.language_code).toBe("en")
  })
})
