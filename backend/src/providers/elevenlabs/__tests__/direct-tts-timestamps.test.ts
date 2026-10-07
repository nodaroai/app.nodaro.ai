/**
 * The text-to-speech funnel and timings. `directElevenLabsTTS` is pinned
 * byte for byte (URL, Accept, bytes back) BEFORE the funnel learns
 * `/with-timestamps`; the sibling export that asks for timings posts the
 * timed endpoint when the model's sheet says it returns them (every speech
 * model since the 2026-10-06 measurement). A call that does NOT ask keeps the
 * plain wire on every model — the first describe.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { directElevenLabsTTS, directElevenLabsTTSWithTimestamps } from "../direct-tts.js"

vi.mock("../../../lib/config.js", () => ({ config: { ELEVENLABS_API_KEY: "test-key" }, isBusiness: () => false, isCloud: () => false }))

const TEXT = "Ship faster."
export const FIXTURE = (() => {
  const characters = [...TEXT]
  return {
    audio_base64: Buffer.from([9, 9, 9]).toString("base64"),
    alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * 0.1), character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.1) },
    normalized_alignment: { characters, character_start_times_seconds: [], character_end_times_seconds: [] },
  }
})()

let voiceCounter = 0
/** A fresh voice id per call — the stored-settings lookup is cached per voice for 5 minutes. */
const freshVoice = () => `TsTestVoice${String(++voiceCounter).padStart(8, "0")}`

interface Captured { url: string; accept: string | undefined; body: Record<string, unknown> }
/** Stub `fetch`: the settings lookup is unavailable, the plain endpoint answers bytes, `/with-timestamps` the JSON fixture. */
function stubFetch() {
  const calls: Captured[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/settings")) return new Response("unavailable", { status: 500 })
    calls.push({ url: String(url), accept: new Headers(init?.headers).get("accept") ?? undefined, body: JSON.parse(String(init?.body)) })
    return String(url).endsWith("/with-timestamps")
      ? new Response(JSON.stringify(FIXTURE), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(new ArrayBuffer(3), { status: 200 })
  }))
  return calls
}
afterEach(() => vi.unstubAllGlobals())

describe("directElevenLabsTTS — unchanged without withTimestamps (characterization)", () => {
  it.each(["elevenlabs-v4", "elevenlabs-v3", "elevenlabs-turbo", "elevenlabs-multilingual", undefined])("provider %s posts the plain endpoint with Accept: audio/mpeg and returns bytes", async (provider) => {
    const calls = stubFetch()
    const out = await directElevenLabsTTS(TEXT, freshVoice(), provider, { stability: 0.4, languageCode: "en" })
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toMatch(/\/v1\/text-to-speech\/[^/]+$/)
    expect(calls[0]!.accept).toBe("audio/mpeg")
  })
})

describe("directElevenLabsTTSWithTimestamps", () => {
  it("v4 posts /with-timestamps with Accept: application/json, the SAME body, and returns audio + a words-only transcript", async () => {
    const calls = stubFetch()
    await directElevenLabsTTS(TEXT, "Rachel", "elevenlabs-v4", { stability: 0.4, languageCode: "en" })
    const out = await directElevenLabsTTSWithTimestamps(TEXT, "Rachel", "elevenlabs-v4", { stability: 0.4, languageCode: "en" })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.url).toMatch(/\/v1\/text-to-speech\/[^/]+\/with-timestamps$/)
    expect(calls[1]!.accept).toBe("application/json")
    expect(calls[1]!.body).toEqual(calls[0]!.body)
    expect([...out.audio]).toEqual([9, 9, 9])
    expect(out.transcript?.language).toBe("en")
    expect(out.transcript?.words.map((w) => w.text)).toEqual(["Ship", "faster."])
    expect(out.transcript?.segments).toBeUndefined()
  })

  it("every speech model (v3, turbo, multilingual, an unknown id running as turbo) posts /with-timestamps and returns a words-only transcript", async () => {
    for (const provider of ["elevenlabs-v3", "elevenlabs-turbo", "elevenlabs-multilingual", "not-a-model"]) {
      const calls = stubFetch()
      const out = await directElevenLabsTTSWithTimestamps(TEXT, freshVoice(), provider)
      expect(calls[0]!.url, provider).toMatch(/\/v1\/text-to-speech\/[^/]+\/with-timestamps$/)
      expect(calls[0]!.accept, provider).toBe("application/json")
      expect([...out.audio], provider).toEqual([9, 9, 9])
      expect(out.transcript?.words.map((w) => w.text), provider).toEqual(["Ship", "faster."])
      vi.unstubAllGlobals()
    }
  })

  it("the with-timestamps body is the plain body, key for key, on v3 and turbo too", async () => {
    for (const provider of ["elevenlabs-v3", "elevenlabs-turbo"]) {
      const calls = stubFetch()
      const voice = freshVoice()
      await directElevenLabsTTS(TEXT, voice, provider, { stability: 0.4, languageCode: "en" })
      await directElevenLabsTTSWithTimestamps(TEXT, voice, provider, { stability: 0.4, languageCode: "en" })
      expect(calls[1]!.body, provider).toEqual(calls[0]!.body)
      vi.unstubAllGlobals()
    }
  })

  it("no audio_base64 → throws before returning", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).endsWith("/settings") ? new Response("x", { status: 500 }) : new Response(JSON.stringify({ alignment: FIXTURE.alignment }), { status: 200 })))
    await expect(directElevenLabsTTSWithTimestamps(TEXT, freshVoice(), "elevenlabs-v4")).rejects.toThrow(/no audio/i)
  })

  it("an audio_base64 that decodes to nothing → throws before returning (no empty file is uploaded)", async () => {
    for (const bad of ["!!", "  ", "="]) {
      vi.stubGlobal("fetch", vi.fn(async (url: string) =>
        String(url).endsWith("/settings") ? new Response("x", { status: 500 }) : new Response(JSON.stringify({ audio_base64: bad, alignment: FIXTURE.alignment }), { status: 200 })))
      await expect(directElevenLabsTTSWithTimestamps(TEXT, freshVoice(), "elevenlabs-v4"), bad).rejects.toThrow(/no audio/i)
    }
  })

  it("a malformed alignment → the audio is delivered, the transcript is absent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).endsWith("/settings") ? new Response("x", { status: 500 }) : new Response(JSON.stringify({ audio_base64: FIXTURE.audio_base64, alignment: { characters: ["a"] } }), { status: 200 })))
    const out = await directElevenLabsTTSWithTimestamps(TEXT, freshVoice(), "elevenlabs-v4")
    expect([...out.audio]).toEqual([9, 9, 9])
    expect(out.transcript).toBeUndefined()
  })
})
