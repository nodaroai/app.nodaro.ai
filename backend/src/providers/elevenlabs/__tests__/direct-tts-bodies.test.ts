/**
 * Characterization of the request `directElevenLabsTTS` puts on the wire, per
 * provider id: the ElevenLabs model, the `voice_settings` it builds, and the
 * `language_code` it forwards.
 *
 * Written BEFORE the provider funnel was moved onto the per-model capability
 * sheets (`MODEL_CATALOG[id].tts`), and kept as the proof that the move changed
 * nothing for the models that already existed: every row below passes on the
 * pre-refactor code and on the sheet-driven code.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { directElevenLabsTTS } from "../direct-tts.js"

vi.mock("../../../lib/config.js", () => ({
  config: { ELEVENLABS_API_KEY: "test-key" },
  isBusiness: () => false,
  isCloud: () => false,
}))

const STORED = { stability: 0.3, similarity_boost: 0.9, style: 0.2, use_speaker_boost: false, speed: 1.05 }

let voiceCounter = 0
/** A fresh voice id per call — the stored-settings lookup is cached per voice for 5 minutes. */
const freshVoice = () => `CharTestVoice${String(++voiceCounter).padStart(6, "0")}`

/** Stub `fetch`: the voice-settings lookup answers `stored`, the TTS call answers audio and records its body. */
function stubFetch(stored: object | null) {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/settings")) {
        return stored ? new Response(JSON.stringify(stored), { status: 200 }) : new Response("unavailable", { status: 500 })
      }
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(new ArrayBuffer(4), { status: 200 })
    }),
  )
  return bodies
}

type Options = Parameters<typeof directElevenLabsTTS>[3]

async function bodyFor(provider: string | undefined, options: Options, stored: object | null = STORED) {
  const bodies = stubFetch(stored)
  await directElevenLabsTTS("hello", freshVoice(), provider, options)
  expect(bodies).toHaveLength(1)
  return bodies[0]!
}

describe("directElevenLabsTTS — the request body per model (existing models)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ["elevenlabs-v3", "eleven_v3"],
    ["elevenlabs-multilingual", "eleven_multilingual_v2"],
    ["elevenlabs-turbo", "eleven_turbo_v2_5"],
    ["elevenlabs", "eleven_turbo_v2_5"], // legacy alias → turbo
    [undefined, "eleven_turbo_v2_5"], // no provider → turbo
    ["not-a-model", "eleven_turbo_v2_5"], // unknown → turbo
    ["elevenlabs-dialogue", "eleven_turbo_v2_5"], // another lane's model, not a text-to-speech one → turbo
    ["constructor", "eleven_turbo_v2_5"], // an inherited object member name is just an unknown id
  ])("%s runs on %s", async (provider, wireModel) => {
    const body = await bodyFor(provider, undefined)
    expect(body.model_id).toBe(wireModel)
  })

  it("a non-string provider (node data can be written straight into workflow JSON) runs as turbo, never as the model it spells", async () => {
    for (const provider of [["elevenlabs-v3"], ["elevenlabs-multilingual"]] as unknown as string[]) {
      const body = await bodyFor(provider, { stability: 0.4, similarityBoost: 0.8, style: 0.5, speed: 1.1 })
      expect(body.model_id, JSON.stringify(provider)).toBe("eleven_turbo_v2_5")
      expect(Object.keys(body.voice_settings as object), JSON.stringify(provider)).toEqual(["stability", "similarity_boost", "style", "use_speaker_boost", "speed"])
    }
  })

  it("keeps the order of the keys on the wire (the characterization is byte-level, not only deep-equal)", async () => {
    // toEqual ignores key order; the request is serialised with JSON.stringify, so the order IS the bytes.
    const full = { stability: 0.4, similarityBoost: 0.8, style: 0.5, speed: 1.1, languageCode: "es" }
    const turbo = await bodyFor("elevenlabs-turbo", full)
    expect(Object.keys(turbo)).toEqual(["text", "model_id", "language_code", "voice_settings"])
    expect(Object.keys(turbo.voice_settings as object)).toEqual(["stability", "similarity_boost", "style", "use_speaker_boost", "speed"])
    // multilingual rejects language_code: the key is absent, and nothing else moves
    expect(Object.keys(await bodyFor("elevenlabs-multilingual", full))).toEqual(["text", "model_id", "voice_settings"])
    const v3 = await bodyFor("elevenlabs-v3", full)
    expect(Object.keys(v3)).toEqual(["text", "model_id", "language_code", "voice_settings"])
    expect(Object.keys(v3.voice_settings as object)).toEqual(["stability"])
    // no explicit lever: voice_settings is absent altogether
    expect(Object.keys(await bodyFor("elevenlabs-turbo", { languageCode: "es" }))).toEqual(["text", "model_id", "language_code"])
  })

  it("sends no voice_settings when the caller sets no lever (the voice's stored settings apply)", async () => {
    for (const provider of ["elevenlabs-v3", "elevenlabs-turbo", "elevenlabs-multilingual"]) {
      expect((await bodyFor(provider, undefined)).voice_settings, provider).toBeUndefined()
    }
  })

  it("v3 sends stability only — similarity, style, speed and speaker boost never leave", async () => {
    const body = await bodyFor("elevenlabs-v3", { stability: 0.4, similarityBoost: 0.8, style: 0.5, speed: 1.1 })
    expect(body.voice_settings).toEqual({ stability: 0.4 })
  })

  it("v3 with only a lever it does not honour still builds its stability (stored over default)", async () => {
    const body = await bodyFor("elevenlabs-v3", { speed: 1.1 })
    expect(body.voice_settings).toEqual({ stability: 0.3 })
  })

  it.each(["elevenlabs-turbo", "elevenlabs-multilingual"])("%s sends every lever the caller set, merged over the stored ones", async (provider) => {
    const body = await bodyFor(provider, { stability: 0.4, similarityBoost: 0.8, style: 0.5, speed: 1.1 })
    expect(body.voice_settings).toEqual({
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.5,
      use_speaker_boost: false, // from the voice's stored settings
      speed: 1.1,
    })
  })

  it("a v2 model with one lever set keeps the stored value of every other", async () => {
    const body = await bodyFor("elevenlabs-multilingual", { speed: 1.1 })
    expect(body.voice_settings).toEqual({
      stability: 0.3,
      similarity_boost: 0.9,
      style: 0.2,
      use_speaker_boost: false,
      speed: 1.1,
    })
  })

  it("a v2 model with no stored settings available falls back to the API defaults (no speed unless set)", async () => {
    const body = await bodyFor("elevenlabs-turbo", { stability: 0.6 }, null)
    expect(body.voice_settings).toEqual({ stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: true })
  })

  it("the legacy alias, an omitted provider and an id that is not a text-to-speech model build the same settings as turbo", async () => {
    const turbo = await bodyFor("elevenlabs-turbo", { stability: 0.6, speed: 1.2 }, null)
    for (const provider of ["elevenlabs", undefined, "elevenlabs-dialogue", "constructor"]) {
      expect((await bodyFor(provider, { stability: 0.6, speed: 1.2 }, null)).voice_settings, String(provider)).toEqual(turbo.voice_settings)
    }
  })

  describe("language_code", () => {
    it("forwards a normalized code on v3 and turbo", async () => {
      expect((await bodyFor("elevenlabs-v3", { languageCode: "heb" })).language_code).toBe("he")
      expect((await bodyFor("elevenlabs-turbo", { languageCode: "es" })).language_code).toBe("es")
      expect((await bodyFor(undefined, { languageCode: "fr" })).language_code).toBe("fr")
    })

    it("omits it on multilingual (eleven_multilingual_v2 rejects the field)", async () => {
      expect((await bodyFor("elevenlabs-multilingual", { languageCode: "he" })).language_code).toBeUndefined()
    })

    it("omits it for auto / empty", async () => {
      expect((await bodyFor("elevenlabs-v3", { languageCode: "auto" })).language_code).toBeUndefined()
      expect((await bodyFor("elevenlabs-v3", { languageCode: "" })).language_code).toBeUndefined()
    })
  })
})
