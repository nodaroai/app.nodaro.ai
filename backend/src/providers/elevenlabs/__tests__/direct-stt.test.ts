/**
 * ElevenLabs direct Scribe STT — the provider that replaces the KIE-wrapped
 * `elevenlabs-stt` path.
 *
 * The bug these pin: KIE wraps this same Scribe model behind a job queue that
 * stalls ("[500] The upstream API service timed out") and has hung ~15 min on a
 * stuck task, which broke speaker detection. voice-changer-pro's diarizer already
 * moved to direct Scribe after that incident; this brings `/v1/transcribe` in line.
 *
 * Verified here: the request shape Scribe requires (multipart, `source_url`,
 * `diarize`, `scribe_v2`), the `speaker_id` → `speaker` normalization detection
 * depends on, the `spacing`-entry filtering, and — the whole point — that a
 * stalled request ABORTS instead of hanging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("../client.js", () => ({
  ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
  getElevenLabsHeaders: () => ({ "xi-api-key": "test-key" }),
}))

import { directSpeechToText } from "../direct-stt.js"

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

describe("directSpeechToText", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("posts multipart Scribe args: scribe_v2 + source_url + diarize", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse({ text: "hi", language_code: "en", words: [] }))

    await directSpeechToText("https://cdn.example/a.wav", { diarize: true })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text")
    expect(init.method).toBe("POST")
    // xi-api-key only — no Content-Type, so fetch sets the multipart boundary.
    expect(init.headers).toEqual({ "xi-api-key": "test-key" })
    const form = init.body as FormData
    expect(form.get("model_id")).toBe("scribe_v2")
    expect(form.get("source_url")).toBe("https://cdn.example/a.wav")
    expect(form.get("diarize")).toBe("true")
  })

  it("normalizes speaker_id → speaker and drops non-word (spacing) entries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okResponse({
        text: "hey there",
        language_code: "en",
        words: [
          { type: "word", text: "hey", start: 0, end: 0.4, speaker_id: "speaker_0" },
          { type: "spacing", text: " ", start: 0.4, end: 0.45 },
          { type: "word", text: "there", start: 0.5, end: 0.9, speaker_id: "speaker_1" },
          { type: "word", text: "no-timing" }, // unusable → dropped
        ],
      }),
    )

    const result = await directSpeechToText("https://cdn.example/a.wav", { diarize: true })

    expect(result.text).toBe("hey there")
    expect(result.language).toBe("en")
    expect(result.words).toEqual([
      { text: "hey", start: 0, end: 0.4, speaker: "speaker_0" },
      { text: "there", start: 0.5, end: 0.9, speaker: "speaker_1" },
    ])
  })

  it("aborts a stalled request rather than hanging the worker", async () => {
    // The exact failure mode KIE exhibited. A never-settling fetch must be cut off
    // by the timeout, not left to hang.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          ;(init as RequestInit).signal?.addEventListener("abort", () => {
            const err = new Error("aborted")
            err.name = "AbortError"
            reject(err)
          })
        }),
    )

    await expect(
      directSpeechToText("https://cdn.example/a.wav", { timeoutMs: 10 }),
    ).rejects.toThrow(/timed out after 10ms/)
  })

  it("surfaces an upstream failure with its status and body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "upstream exploded",
    } as unknown as Response)

    await expect(directSpeechToText("https://cdn.example/a.wav")).rejects.toThrow(
      /Scribe STT failed \(500\): upstream exploded/,
    )
  })
})
