import { describe, it, expect } from "vitest"
import {
  VOICE_AGES,
  VOICE_GENDERS,
  VOICE_ACCENTS,
  VOICE_TIMBRES,
  buildVoiceCharacterHints,
  VOICE_CHARACTER_DEFAULT_DATA,
} from "../voice-character.js"

describe("voice-character catalogs", () => {
  it("all four catalogs are non-empty with unique ids", () => {
    for (const list of [VOICE_AGES, VOICE_GENDERS, VOICE_ACCENTS, VOICE_TIMBRES]) {
      expect(list.length).toBeGreaterThan(0)
      const ids = new Set(list.map((x) => x.id))
      expect(ids.size).toBe(list.length)
    }
  })
})

describe("buildVoiceCharacterHints", () => {
  it("returns empty for empty data", () => {
    expect(buildVoiceCharacterHints({})).toBe("")
  })

  it("returns single field hint as bare phrase", () => {
    const t = VOICE_TIMBRES[0]
    expect(buildVoiceCharacterHints({ timbre: t.id })).toContain(t.promptHint)
  })

  it("composes [age] [gender] voice with [timbre] timbre and [accent] accent", () => {
    const age = VOICE_AGES[0]
    const gender = VOICE_GENDERS[0]
    const accent = VOICE_ACCENTS[0]
    const timbre = VOICE_TIMBRES[0]
    const out = buildVoiceCharacterHints({
      age: age.id, gender: gender.id, accent: accent.id, timbre: timbre.id,
    })
    expect(out).toContain(age.promptHint)
    expect(out).toContain(gender.promptHint)
    expect(out).toContain(accent.promptHint)
    expect(out).toContain(timbre.promptHint)
  })

  it("falls back gracefully on unknown ids", () => {
    expect(buildVoiceCharacterHints({ age: "not-real" })).toBe("")
  })
})
