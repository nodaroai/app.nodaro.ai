import { describe, it, expect } from "vitest"
import {
  VOICE_PACES,
  VOICE_EMOTIONS,
  VOICE_ARCHETYPES,
  buildVoiceDeliveryHints,
  VOICE_DELIVERY_DEFAULT_DATA,
} from "../voice-delivery.js"

describe("voice-delivery catalogs", () => {
  it("all three catalogs are non-empty with unique ids", () => {
    for (const list of [VOICE_PACES, VOICE_EMOTIONS, VOICE_ARCHETYPES]) {
      expect(list.length).toBeGreaterThan(0)
      const ids = new Set(list.map((x) => x.id))
      expect(ids.size).toBe(list.length)
    }
  })
})

describe("buildVoiceDeliveryHints", () => {
  it("returns empty for empty data", () => {
    expect(buildVoiceDeliveryHints({})).toBe("")
  })

  it("composes [pace] [archetype]-style delivery, [emotion] tone", () => {
    const pace = VOICE_PACES[0]
    const emotion = VOICE_EMOTIONS[0]
    const archetype = VOICE_ARCHETYPES[0]
    const out = buildVoiceDeliveryHints({
      pace: pace.id, emotion: emotion.id, archetype: archetype.id,
    })
    expect(out).toContain(pace.promptHint)
    expect(out).toContain(emotion.promptHint)
    expect(out).toContain(archetype.promptHint)
  })

  it("handles partial fields gracefully", () => {
    const e = VOICE_EMOTIONS[0]
    expect(buildVoiceDeliveryHints({ emotion: e.id })).toContain(e.promptHint)
  })
})
