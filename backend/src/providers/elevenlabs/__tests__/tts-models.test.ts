import { describe, it, expect } from "vitest"
import { MODEL_CATALOG, TTS_PROVIDERS, TTS_PROVIDER_ALIASES } from "@nodaro/shared"
import { ttsWireModel, ttsModelKey, TTS_WIRE_MODELS } from "../tts-models.js"

describe("tts-models — our provider id → ElevenLabs model id", () => {
  it("every non-alias text-to-speech provider has its own wire-model row, so none silently runs as turbo", () => {
    for (const id of TTS_PROVIDERS) {
      if (id in TTS_PROVIDER_ALIASES) continue
      expect(Object.hasOwn(TTS_WIRE_MODELS, id), `${id} has no row in TTS_WIRE_MODELS (tts-models.ts)`).toBe(true)
    }
  })

  it("every legacy alias resolves to a model that has a row", () => {
    for (const [alias, target] of Object.entries(TTS_PROVIDER_ALIASES)) {
      expect(Object.hasOwn(TTS_WIRE_MODELS, target), `${alias} → ${target} has no row`).toBe(true)
    }
  })

  it("every row is for a live provider — a row left behind by a retired model would still reach its ElevenLabs model", () => {
    for (const id of Object.keys(TTS_WIRE_MODELS)) {
      expect(TTS_PROVIDERS as readonly string[], `${id} has a wire row but is not a TTS_PROVIDERS member`).toContain(id)
      expect(id in TTS_PROVIDER_ALIASES, `${id} is a legacy alias and must not have a row of its own`).toBe(false)
      expect(MODEL_CATALOG[id]?.modes, `${id} is not a text-to-speech model in the catalog`).toContain("tts")
      expect(MODEL_CATALOG[id]?.tts, `${id} has no capability sheet`).toBeDefined()
    }
  })

  it("the egress / credit key of every non-alias provider is the provider itself", () => {
    for (const id of TTS_PROVIDERS) {
      if (id in TTS_PROVIDER_ALIASES) continue
      expect(ttsModelKey(id), `${id} would be keyed as another model`).toBe(id)
    }
  })

  it("every non-alias provider maps to its own ElevenLabs model (no two share one)", () => {
    const ids = TTS_PROVIDERS.filter((id) => !(id in TTS_PROVIDER_ALIASES))
    const wire = ids.map((id) => ttsWireModel(id))
    expect(new Set(wire).size).toBe(ids.length)
    for (const w of wire) expect(w).toMatch(/^eleven_/)
  })

  it("the legacy alias, a missing id and an unknown id run as turbo", () => {
    for (const p of ["elevenlabs", undefined, "", "not-a-model", "constructor", "__proto__"]) {
      expect(ttsWireModel(p), String(p)).toBe("eleven_turbo_v2_5")
      expect(ttsModelKey(p), String(p)).toBe("elevenlabs-turbo")
    }
  })

  it("a non-string id runs as turbo — an array is not coerced into the model it spells", () => {
    for (const p of [["elevenlabs-v3"], ["elevenlabs-multilingual"], 3, {}, null] as unknown as string[]) {
      expect(ttsWireModel(p), JSON.stringify(p)).toBe("eleven_turbo_v2_5")
      expect(ttsModelKey(p), JSON.stringify(p)).toBe("elevenlabs-turbo")
    }
  })

  it("the existing models keep the ids they have always sent", () => {
    expect(ttsWireModel("elevenlabs-v3")).toBe("eleven_v3")
    expect(ttsWireModel("elevenlabs-multilingual")).toBe("eleven_multilingual_v2")
    expect(ttsWireModel("elevenlabs-turbo")).toBe("eleven_turbo_v2_5")
  })

  it("v4 runs as eleven_v4 and is keyed as itself — never as turbo", () => {
    expect(ttsWireModel("elevenlabs-v4")).toBe("eleven_v4")
    expect(ttsModelKey("elevenlabs-v4")).toBe("elevenlabs-v4")
  })

  it("v4 Turbo runs as eleven_v4_turbo and is keyed as itself — never as v4, never as turbo v2.5", () => {
    expect(ttsWireModel("elevenlabs-v4-turbo")).toBe("eleven_v4_turbo")
    expect(ttsModelKey("elevenlabs-v4-turbo")).toBe("elevenlabs-v4-turbo")
    expect(ttsWireModel("elevenlabs-v4")).toBe("eleven_v4")
    expect(ttsWireModel("elevenlabs-turbo")).toBe("eleven_turbo_v2_5")
  })
})
