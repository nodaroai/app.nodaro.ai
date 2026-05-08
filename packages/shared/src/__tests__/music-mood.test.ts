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
})

describe("MUSIC_MOOD_DEFAULT_DATA", () => {
  it("is empty", () => { expect(MUSIC_MOOD_DEFAULT_DATA).toEqual({}) })
})
