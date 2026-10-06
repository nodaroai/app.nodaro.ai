/**
 * The request `directElevenLabsDialogue` puts on the wire.
 *
 * The first describe was written BEFORE the dialogue funnel moved onto the
 * capability sheet (`MODEL_CATALOG[id].tts`, read through
 * `dialogue-capabilities.ts`), and passes on both: it is the proof that the move
 * changed nothing for v3 dialogue. Key order is pinned because the body is
 * serialised with JSON.stringify — the order IS the bytes.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { directElevenLabsDialogue } from "../direct-dialogue.js"

vi.mock("../../../lib/config.js", () => ({
  config: { ELEVENLABS_API_KEY: "test-key" },
  isBusiness: () => false,
  isCloud: () => false,
}))

const LINES = [{ text: "Hi there.", voice: "Rachel" }, { text: "[laughs] Hello!", voice: "George" }]

function stubFetch() {
  const bodies: Array<Record<string, unknown>> = []
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(new ArrayBuffer(4), { status: 200 })
  }))
  return bodies
}

type Options = Parameters<typeof directElevenLabsDialogue>[1]

async function bodyFor(options: Options) {
  const bodies = stubFetch()
  await directElevenLabsDialogue(LINES, options)
  expect(bodies).toHaveLength(1)
  return bodies[0]!
}

afterEach(() => vi.unstubAllGlobals())

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
