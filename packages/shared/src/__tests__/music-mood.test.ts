import { describe, it, expect } from "vitest"
import {
  MUSIC_ENERGIES,
  MUSIC_EMOTIONS,
  MUSIC_VIBES,
  getMusicEnergy,
  getMusicEmotion,
  getMusicVibe,
  buildMusicMoodHints,
  MUSIC_MOOD_DEFAULT_DATA,
} from "../music-mood.js"

describe("MUSIC_ENERGIES / EMOTIONS / VIBES catalogs", () => {
  it("each is non-empty with unique ids", () => {
    for (const list of [MUSIC_ENERGIES, MUSIC_EMOTIONS, MUSIC_VIBES]) {
      expect(list.length).toBeGreaterThan(0)
      const ids = new Set(list.map((x) => x.id))
      expect(ids.size).toBe(list.length)
    }
  })

  it("every entry has a non-empty promptHint", () => {
    for (const list of [MUSIC_ENERGIES, MUSIC_EMOTIONS, MUSIC_VIBES]) {
      for (const x of list) expect(x.promptHint.length).toBeGreaterThan(0)
    }
  })

  it("MUSIC_VIBES includes the four dark-thriller entries", () => {
    const ids = new Set(MUSIC_VIBES.map((x) => x.id))
    for (const id of ["suspenseful", "espionage", "cold", "clandestine"]) {
      expect(ids.has(id), `MUSIC_VIBES missing "${id}"`).toBe(true)
    }
  })
})

describe("buildMusicMoodHints", () => {
  it("returns empty for empty data", () => {
    expect(buildMusicMoodHints({})).toBe("")
  })

  it("returns single field hint when one is set", () => {
    const e = MUSIC_ENERGIES[0]
    expect(buildMusicMoodHints({ energy: e.id })).toBe(e.promptHint)
  })

  it("composes [energy] [emotion] [vibe] in order", () => {
    const energy = MUSIC_ENERGIES[0]
    const emotion = MUSIC_EMOTIONS[0]
    const vibe = MUSIC_VIBES[0]
    const out = buildMusicMoodHints({
      energy: energy.id, emotion: emotion.id, vibe: vibe.id,
    })
    expect(out.indexOf(energy.promptHint)).toBeLessThan(out.indexOf(emotion.promptHint))
    expect(out.indexOf(emotion.promptHint)).toBeLessThan(out.indexOf(vibe.promptHint))
  })

  it("falls back gracefully on unknown ids", () => {
    expect(buildMusicMoodHints({ energy: "not-real" })).toBe("")
  })

  it("accepts emotion as a string array and joins hints", () => {
    const [e1, e2, e3] = MUSIC_EMOTIONS
    const out = buildMusicMoodHints({ emotion: [e1.id, e2.id, e3.id] })
    expect(out).toContain(e1.promptHint)
    expect(out).toContain(e2.promptHint)
    expect(out).toContain(e3.promptHint)
  })

  it("accepts vibe as a string array and joins hints", () => {
    const [v1, v2] = MUSIC_VIBES
    const out = buildMusicMoodHints({ vibe: [v1.id, v2.id] })
    expect(out).toContain(v1.promptHint)
    expect(out).toContain(v2.promptHint)
  })

  it("preserves existing single-string emotion/vibe (back-compat)", () => {
    const emotion = MUSIC_EMOTIONS[0]
    const vibe = MUSIC_VIBES[0]
    const out = buildMusicMoodHints({ emotion: emotion.id, vibe: vibe.id })
    expect(out).toContain(emotion.promptHint)
    expect(out).toContain(vibe.promptHint)
  })
})

describe("MUSIC_MOOD_DEFAULT_DATA", () => {
  it("is empty", () => { expect(MUSIC_MOOD_DEFAULT_DATA).toEqual({}) })
})
