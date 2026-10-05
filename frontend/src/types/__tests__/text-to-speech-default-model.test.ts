import { describe, it, expect } from "vitest"
import { DEFAULT_TTS_PROVIDER, TTS_PROVIDERS } from "@nodaro/shared"
import { NODE_DEFINITIONS } from "../nodes"

// A new Text to Speech node must start on the model the backend runs and bills when
// none is chosen: the shared DEFAULT_TTS_PROVIDER (ElevenLabs v4 since the default
// flip, decided 2026-10-05). NODE_DEFINITIONS keeps a literal because the gen:skills
// parser reads it statically; this test is the link. Existing nodes keep the
// provider they stored.
const def = NODE_DEFINITIONS.find((d) => d.type === "text-to-speech")

describe("Text to Speech default model", () => {
  it("is ElevenLabs v4, and an offered model", () => {
    expect(DEFAULT_TTS_PROVIDER).toBe("elevenlabs-v4")
    expect(TTS_PROVIDERS).toContain(DEFAULT_TTS_PROVIDER)
  })

  it("a freshly added node carries it", () => {
    expect(def?.defaultData).toMatchObject({ provider: DEFAULT_TTS_PROVIDER })
  })

  it("the published-app Model card marks it, and only it, as recommended, and lists it first", () => {
    const field = def?.exposableFields?.find((f) => f.key === "provider")
    const options = (field as { options?: { value: string; label: string }[] } | undefined)?.options ?? []
    expect(options[0]?.value).toBe(DEFAULT_TTS_PROVIDER)
    const recommended = options.filter((o) => /recommended/i.test(o.label)).map((o) => o.value)
    expect(recommended).toEqual([DEFAULT_TTS_PROVIDER])
    // v3 is still offered.
    expect(options.map((o) => o.value)).toContain("elevenlabs-v3")
  })
})
