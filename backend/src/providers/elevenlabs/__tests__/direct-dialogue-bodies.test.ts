/**
 * The request `directElevenLabsDialogue` puts on the wire.
 *
 * The "v3 dialogue, byte for byte" describe was written BEFORE the dialogue funnel moved onto the
 * capability sheet (`MODEL_CATALOG[id].tts`, read through `dialogue-capabilities.ts`), and passes on both:
 * it is the proof that the move changed nothing about the BODY for v3 dialogue. Key order is pinned because
 * the body is serialised with JSON.stringify — the order IS the bytes. Since the 2026-10-06 measurement every
 * dialogue model posts to the /with-timestamps URL; only the URL and Accept header differ from the old wire.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { directElevenLabsDialogue } from "../direct-dialogue.js"

vi.mock("../../../lib/config.js", () => ({
  config: { ELEVENLABS_API_KEY: "test-key" },
  isBusiness: () => false,
  isCloud: () => false,
}))

const LINES = [{ text: "Hi there.", voice: "Rachel" }, { text: "[laughs] Hello!", voice: "George" }]

/** A with-timestamps answer for LINES: 100 ms per character, one voice segment per line. */
export const TIMESTAMPS_FIXTURE = (() => {
  const text = "Hi there.[laughs] Hello!"
  const characters = [...text]
  return {
    audio_base64: Buffer.from([1, 2, 3, 4]).toString("base64"),
    alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => i * 0.1),
      character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.1),
    },
    normalized_alignment: { characters, character_start_times_seconds: [], character_end_times_seconds: [] },
    voice_segments: [
      { voice_id: "not-the-id-sent", start_time_seconds: 0, end_time_seconds: 0.9, character_start_index: 0, character_end_index: 9, dialogue_input_index: 0 },
      { voice_id: "not-the-id-sent-either", start_time_seconds: 0.9, end_time_seconds: 2.4, character_start_index: 9, character_end_index: 24, dialogue_input_index: 1 },
    ],
  }
})()

interface Captured { url: string; accept: string | undefined; body: Record<string, unknown> }

/** Record every request (URL, Accept, parsed body); answer audio bytes on the plain URL and the JSON fixture on `/with-timestamps`. */
function stubFetch(answer?: () => Response) {
  const calls: Captured[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(url), accept: headers.get("accept") ?? undefined, body: JSON.parse(String(init?.body)) })
    if (answer) return answer()
    return String(url).endsWith("/with-timestamps")
      ? new Response(JSON.stringify(TIMESTAMPS_FIXTURE), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(new ArrayBuffer(4), { status: 200 })
  }))
  return calls
}

type Options = Parameters<typeof directElevenLabsDialogue>[1]

async function callFor(options: Options, answer?: () => Response) {
  const calls = stubFetch(answer)
  const result = await directElevenLabsDialogue(LINES, options)
  expect(calls).toHaveLength(1)
  return { ...calls[0]!, result }
}

async function bodyFor(options: Options) {
  return (await callFor(options)).body
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFetchFailing(status: number, text: string) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { status })))
}

describe("directElevenLabsDialogue — a refused request", () => {
  it("a 429 is the retryable 'temporarily busy' message the sound-effects funnel answers with, never the vendor's words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    stubFetchFailing(429, '{"detail":{"status":"too_many_concurrent_requests","message":"ElevenLabs: concurrency limit"}}')
    const err = await directElevenLabsDialogue(LINES, { provider: "elevenlabs-dialogue-v4" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe("Service is temporarily busy. Please try again in a moment.")
    expect((err as Error).message).not.toMatch(/ElevenLabs|concurren/)
    // Retryable: the queue re-sends it; the operator still sees the raw status + body.
    expect((err as { deterministic?: unknown }).deterministic).not.toBe(true)
    expect((err as { internalDetails?: unknown }).internalDetails).toMatch(/429/)
    expect((err as { internalDetails?: unknown }).internalDetails).toMatch(/too_many_concurrent_requests/)
  })

  it("any other failure keeps the message it has always had", async () => {
    stubFetchFailing(500, "boom")
    await expect(directElevenLabsDialogue(LINES, undefined)).rejects.toThrow("ElevenLabs dialogue failed (500): boom")
  })
})

describe("directElevenLabsDialogue — v3 dialogue, byte for byte (characterization)", () => {
  it("runs on eleven_v3 and keeps the lines, their order and their tags", async () => {
    const body = await bodyFor(undefined)
    expect(body.model_id).toBe("eleven_v3")
    expect((body.inputs as Array<{ text: string }>).map((l) => l.text)).toEqual(["Hi there.", "[laughs] Hello!"])
    expect(Object.keys(body)).toEqual(["inputs", "model_id"])
  })

  it("orders the keys: inputs, model_id, settings, language_code, seed, apply_text_normalization", async () => {
    const body = await bodyFor({ stability: 0.5, languageCode: "heb", seed: 7, applyTextNormalization: "on" })
    expect(Object.keys(body)).toEqual(["inputs", "model_id", "settings", "language_code", "seed", "apply_text_normalization"])
    expect(body.settings).toEqual({ stability: 0.5 })
    expect(body.language_code).toBe("he")
    expect(body.seed).toBe(7)
    expect(body.apply_text_normalization).toBe("on")
  })

  it.each([0, 0.5, 1])("sends stability %s as settings.stability, alone", async (stability) => {
    expect((await bodyFor({ stability })).settings).toEqual({ stability })
  })

  it("sends no settings when no stability is set", async () => {
    expect((await bodyFor({ languageCode: "en" })).settings).toBeUndefined()
  })

  it("a stability off the three steps that reaches the funnel (the orchestrator path skips the route) is forwarded as it is", async () => {
    expect((await bodyFor({ stability: 0.3 })).settings).toEqual({ stability: 0.3 })
  })

  it("omits language_code for auto / empty", async () => {
    expect((await bodyFor({ languageCode: "auto" })).language_code).toBeUndefined()
    expect((await bodyFor({ languageCode: "" })).language_code).toBeUndefined()
  })

  it("resolves each line's voice name to its id (premade names, library and clone ids pass through)", async () => {
    const body = await bodyFor(undefined)
    const ids = (body.inputs as Array<{ voice_id: string }>).map((l) => l.voice_id)
    expect(ids.every((id) => /^[A-Za-z0-9]{20}$/.test(id))).toBe(true)
  })
})

describe("directElevenLabsDialogue — the wire, for every dialogue model (characterization)", () => {
  // Measured 2026-10-06: both dialogue models answer /with-timestamps at the same character cost, so BOTH sheets say
  // `timestamps: true` and no dialogue model posts the plain endpoint any more. Switching v3 dialogue onto the
  // with-timestamps URL is the owner's "always on" decision (Q3.1); the BODY is unchanged, so the key order below is
  // the same one the plain-endpoint characterization pinned before.
  it.each([[undefined], ["elevenlabs-dialogue"], ["elevenlabs-dialogue-v4"], ["not-a-model"]])(
    "provider %s posts /with-timestamps with Accept: application/json and the long-standing body",
    async (provider) => {
      const { url, accept, body } = await callFor({ provider, stability: 0.5, languageCode: "en", seed: 3 })
      expect(url.endsWith("/v1/text-to-dialogue/with-timestamps")).toBe(true)
      expect(accept).toBe("application/json")
      expect(Object.keys(body)).toEqual(["inputs", "model_id", "settings", "language_code", "seed"])
    },
  )
})

describe("directElevenLabsDialogue — the timings", () => {
  it("v3 and v4 dialogue send the SAME body shape, differing only in the model", async () => {
    const v3 = await callFor({ provider: "elevenlabs-dialogue", stability: 0.5, languageCode: "en", seed: 3 })
    const v4 = await callFor({ provider: "elevenlabs-dialogue-v4", stability: 0.5, languageCode: "en", seed: 3 })
    expect(v3.url).toBe(v4.url)
    expect(Object.keys(v4.body)).toEqual(Object.keys(v3.body))
    expect(v3.body.model_id).toBe("eleven_v3")
    expect(v4.body.model_id).toBe("eleven_v4")
  })

  it("decodes the audio and builds the transcript: segments by dialogue_input_index with the voice sent as speaker, tag never a word", async () => {
    const { result } = await callFor({ provider: "elevenlabs-dialogue-v4", languageCode: "en" })
    expect([...result.audio]).toEqual([1, 2, 3, 4])
    expect(result.transcript?.language).toBe("en")
    expect(result.transcript?.segments).toEqual([
      { startMs: 0, endMs: 900, text: "Hi there.", speaker: "Rachel" },
      { startMs: 900, endMs: 2400, text: "[laughs] Hello!", speaker: "George" },
    ])
    expect(result.transcript?.words.map((w) => w.text)).toEqual(["Hi", "there.", "Hello!"])
    expect(result.transcript?.words.map((w) => w.speaker)).toEqual(["Rachel", "Rachel", "George"])
  })

  it("v3 dialogue returns the audio bytes and the same transcript shape", async () => {
    const { result } = await callFor({ provider: "elevenlabs-dialogue", languageCode: "en" })
    expect([...result.audio]).toEqual([1, 2, 3, 4])
    expect(result.transcript?.segments?.map((seg) => seg.speaker)).toEqual(["Rachel", "George"])
  })

  it("no audio_base64 → throws before returning (nothing usable was delivered)", async () => {
    await expect(
      callFor({ provider: "elevenlabs-dialogue-v4" }, () => new Response(JSON.stringify({ alignment: TIMESTAMPS_FIXTURE.alignment }), { status: 200 })),
    ).rejects.toThrow(/no audio/i)
  })

  it("an audio_base64 that decodes to nothing → throws before returning (no empty file is uploaded)", async () => {
    for (const bad of ["!!", "  ", "="]) {
      await expect(
        callFor({ provider: "elevenlabs-dialogue-v4" }, () => new Response(JSON.stringify({ audio_base64: bad, alignment: TIMESTAMPS_FIXTURE.alignment }), { status: 200 })),
        bad,
      ).rejects.toThrow(/no audio/i)
    }
  })

  it("a malformed alignment → the audio is delivered, the transcript is absent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { result } = await callFor({ provider: "elevenlabs-dialogue-v4" }, () =>
      new Response(JSON.stringify({ audio_base64: TIMESTAMPS_FIXTURE.audio_base64, alignment: { characters: ["a"] } }), { status: 200 }))
    expect([...result.audio]).toEqual([1, 2, 3, 4])
    expect(result.transcript).toBeUndefined()
  })
})

describe("directElevenLabsDialogue — the model it runs on", () => {
  it.each([
    [undefined],
    ["elevenlabs-dialogue"],
    ["not-a-model"],
    ["constructor"],
    ["elevenlabs-v4"], // a text-to-speech id is not a dialogue model
    ["elevenlabs-v3"],
  ])("provider %s runs on eleven_v3", async (provider) => {
    expect((await bodyFor({ provider })).model_id).toBe("eleven_v3")
  })

  it("a non-string provider (node data written straight into workflow JSON) runs on eleven_v3", async () => {
    expect((await bodyFor({ provider: ["elevenlabs-dialogue-v4"] as unknown as string })).model_id).toBe("eleven_v3")
  })

  it("v3 dialogue never sends similarity, whatever the caller set", async () => {
    expect((await bodyFor({ stability: 0.5, similarityBoost: 0.9 })).settings).toEqual({ stability: 0.5 })
    expect((await bodyFor({ similarityBoost: 0.9 })).settings).toBeUndefined()
  })

  it("a numeric-string stability is read as its number; garbage is absent (declared change: the orchestrator path used to forward it raw)", async () => {
    expect((await bodyFor({ stability: "0.5" as unknown as number })).settings).toEqual({ stability: 0.5 })
    expect((await bodyFor({ stability: "loud" as unknown as number })).settings).toBeUndefined()
    expect((await bodyFor({ stability: 2 })).settings).toEqual({ stability: 1 }) // clamped, never a paid 400
  })
})

describe("directElevenLabsDialogue — elevenlabs-dialogue-v4", () => {
  it("runs on eleven_v4", async () => {
    expect((await bodyFor({ provider: "elevenlabs-dialogue-v4" })).model_id).toBe("eleven_v4")
  })

  it("sends stability and similarity (as settings.similarity), in that order", async () => {
    const body = await bodyFor({ provider: "elevenlabs-dialogue-v4", stability: 0.3, similarityBoost: 0.8 })
    expect(body.settings).toEqual({ stability: 0.3, similarity: 0.8 })
    expect(Object.keys(body.settings as object)).toEqual(["stability", "similarity"])
  })

  it("sends similarity alone when no stability is set, and nothing when neither is", async () => {
    expect((await bodyFor({ provider: "elevenlabs-dialogue-v4", similarityBoost: 0.6 })).settings).toEqual({ similarity: 0.6 })
    expect((await bodyFor({ provider: "elevenlabs-dialogue-v4" })).settings).toBeUndefined()
  })

  it("keeps [audio tags] and forwards a normalized language code", async () => {
    const body = await bodyFor({ provider: "elevenlabs-dialogue-v4", languageCode: "heb" })
    expect((body.inputs as Array<{ text: string }>)[1]!.text).toBe("[laughs] Hello!")
    expect(body.language_code).toBe("he")
  })
})
