import { describe, it, expect } from "vitest"
import {
  composeMusicStyle,
  hasMusicPicks,
  DEFAULT_MUSIC_SELECTIONS,
  type MusicSelections,
} from "../music-options"

/**
 * The picker → Suno mapping is app-owned (Suno has no catalogs), so pin how
 * selections compose into the prompt tags. The vocals toggle + gender are handled
 * as typed flags in `useMusic`, NOT as tags here (except the descriptors that help
 * text-to-music).
 */
describe("composeMusicStyle", () => {
  it("instrumental folds genre/mood/instruments + an 'instrumental' tag", () => {
    const tags = composeMusicStyle({
      vocals: "instrumental",
      vocalGender: "any",
      genre: "cinematic",
      mood: "epic",
      instruments: ["strings", "piano"],
    })
    expect(tags).toContain("instrumental")
    expect(tags).toContain("cinematic")
    expect(tags).toContain("epic")
    expect(tags).toContain("strings")
    expect(tags).toContain("piano")
    // Mood leads genre (order matters for the prompt read).
    expect(tags.indexOf("epic")).toBeLessThan(tags.indexOf("cinematic"))
  })

  it("with vocals folds singing style + language and NOT 'instrumental'", () => {
    const tags = composeMusicStyle({
      vocals: "vocals",
      vocalGender: "female",
      singingStyle: "powerful",
      language: "hebrew",
      instruments: [],
    })
    expect(tags).not.toContain("instrumental")
    expect(tags).toContain("powerful vocals")
    expect(tags).toContain("Hebrew lyrics")
  })

  it("default selections compose to just 'instrumental'", () => {
    expect(composeMusicStyle(DEFAULT_MUSIC_SELECTIONS)).toEqual(["instrumental"])
  })

  it("unknown / unset ids are dropped", () => {
    const tags = composeMusicStyle({
      vocals: "instrumental",
      vocalGender: "any",
      genre: "not-a-genre",
      mood: undefined,
      instruments: ["bogus"],
    })
    expect(tags).toEqual(["instrumental"])
  })
})

/**
 * `hasMusicPicks` decides whether a picker set carries a DECISION (R64/A2's
 * touched rule, and the merge that rides on it). It names the seven fields by
 * hand, so the fixture below is `Required<MusicSelections>`: a new picker
 * breaks COMPILATION here, and the loop then fails until the predicate reads
 * it — the alternative being a picker that silently never counts as touched
 * and is quietly overwritten by the next imported plan.
 */
const EVERY_PICK: Required<MusicSelections> = {
  vocals: "vocals",
  vocalGender: "female",
  genre: "synthwave",
  mood: "epic",
  instruments: ["synth"],
  singingStyle: "powerful",
  language: "hebrew",
}

describe("hasMusicPicks", () => {
  it("is false for nothing and for the untouched defaults", () => {
    expect(hasMusicPicks(undefined)).toBe(false)
    expect(hasMusicPicks(DEFAULT_MUSIC_SELECTIONS)).toBe(false)
  })

  it("is true for EVERY field on its own", () => {
    for (const key of Object.keys(EVERY_PICK) as Array<keyof MusicSelections>) {
      const sel = { ...DEFAULT_MUSIC_SELECTIONS, [key]: EVERY_PICK[key] }
      expect(hasMusicPicks(sel), `${key} does not count as a pick`).toBe(true)
    }
  })

  it("reads VALUES, not keys — a picker cleared back to Any is not a pick", () => {
    expect(hasMusicPicks({ ...DEFAULT_MUSIC_SELECTIONS, genre: undefined })).toBe(
      false,
    )
  })
})
