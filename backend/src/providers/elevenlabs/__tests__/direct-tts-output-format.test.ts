/**
 * The audio file a speech request asks the vendor for (`outputFormat`). Pinned
 * byte for byte: WITHOUT the option the URL carries no query at all and the
 * Accept header is the MP3 one — on the plain endpoint and on `/with-timestamps`
 * — exactly as before the option existed; WITH it, the format rides as
 * `?output_format=` on both endpoints and the Accept header follows the format.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { TTS_OUTPUT_FORMATS, TTS_OUTPUT_FORMAT_FILES } from "@nodaro/shared/models"
import { directElevenLabsTTS, directElevenLabsTTSWithTimestamps } from "../direct-tts.js"

vi.mock("../../../lib/config.js", () => ({ config: { ELEVENLABS_API_KEY: "test-key" }, isBusiness: () => false, isCloud: () => false }))

const TEXT = "Ship faster."
const FIXTURE = (() => {
  const characters = [...TEXT]
  return {
    audio_base64: Buffer.from([9, 9, 9]).toString("base64"),
    alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * 0.1), character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.1) },
    normalized_alignment: { characters, character_start_times_seconds: [], character_end_times_seconds: [] },
  }
})()

let voiceCounter = 0
/** A fresh voice id per call — the stored-settings lookup is cached per voice for 5 minutes. */
const freshVoice = () => `FmtTestVoice${String(++voiceCounter).padStart(8, "0")}`

interface Captured { url: string; accept: string | undefined }
/** Stub `fetch`: the settings lookup is unavailable, the plain endpoint answers bytes, `/with-timestamps` the JSON fixture. */
function stubFetch() {
  const calls: Captured[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/settings")) return new Response("unavailable", { status: 500 })
    calls.push({ url: String(url), accept: new Headers(init?.headers).get("accept") ?? undefined })
    return String(url).includes("/with-timestamps")
      ? new Response(JSON.stringify(FIXTURE), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(new ArrayBuffer(3), { status: 200 })
  }))
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe("directElevenLabsTTS — without outputFormat (characterization)", () => {
  it.each(["elevenlabs-v4", "elevenlabs-v3", "elevenlabs-turbo", undefined])("provider %s posts a URL with no query and Accept: audio/mpeg", async (provider) => {
    const calls = stubFetch()
    await directElevenLabsTTS(TEXT, freshVoice(), provider, { stability: 0.4 })
    expect(calls).toHaveLength(1)
    // Exact: the voice id ends the URL — no `?output_format=`, no other query.
    expect(calls[0]!.url).toMatch(/\/v1\/text-to-speech\/FmtTestVoice\d{8}$/)
    expect(calls[0]!.url).not.toContain("?")
    expect(calls[0]!.accept).toBe("audio/mpeg")
  })

  it("the timed endpoint carries no query either", async () => {
    const calls = stubFetch()
    await directElevenLabsTTSWithTimestamps(TEXT, freshVoice(), "elevenlabs-v4", { stability: 0.4 })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toMatch(/\/v1\/text-to-speech\/FmtTestVoice\d{8}\/with-timestamps$/)
    expect(calls[0]!.accept).toBe("application/json")
  })
})

describe("directElevenLabsTTS — with outputFormat", () => {
  it.each(TTS_OUTPUT_FORMATS)("%s rides as ?output_format= on the plain endpoint, with the format's Accept", async (outputFormat) => {
    const calls = stubFetch()
    await directElevenLabsTTS(TEXT, freshVoice(), "elevenlabs-v4", { outputFormat })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toMatch(new RegExp(`/v1/text-to-speech/FmtTestVoice\\d{8}\\?output_format=${outputFormat}$`))
    expect(calls[0]!.accept).toBe(TTS_OUTPUT_FORMAT_FILES[outputFormat].mime)
  })

  it("rides on the timed endpoint too, after the path, and the JSON Accept stays", async () => {
    const calls = stubFetch()
    await directElevenLabsTTSWithTimestamps(TEXT, freshVoice(), "elevenlabs-v4", { outputFormat: "wav_24000" })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toMatch(/\/v1\/text-to-speech\/FmtTestVoice\d{8}\/with-timestamps\?output_format=wav_24000$/)
    expect(calls[0]!.accept).toBe("application/json")
  })

  it("the voice_not_found retry keeps the format", async () => {
    const calls: Captured[] = []
    let attempts = 0
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/settings")) return new Response("unavailable", { status: 500 })
      calls.push({ url: String(url), accept: new Headers(init?.headers).get("accept") ?? undefined })
      attempts += 1
      if (attempts === 1) return new Response(JSON.stringify({ detail: { status: "voice_not_found" } }), { status: 404 })
      return new Response(new ArrayBuffer(3), { status: 200 })
    }))
    // A UUID-shaped id the premade table does not know, on an LLM-originated request: the funnel retries with the default voice.
    await directElevenLabsTTS(TEXT, "0123456789abcdefABCD", "elevenlabs-v4", { outputFormat: "mp3_44100_192", allowDefaultVoiceFallback: true })
    expect(calls).toHaveLength(2)
    for (const call of calls) expect(call.url).toMatch(/\?output_format=mp3_44100_192$/)
  })
})
