import { describe, it, expect } from "vitest"
import {
  MUSIC_GENRES,
  MUSIC_ERAS,
  getMusicGenre,
  getMusicGenreLabel,
  getMusicSubgenre,
  getMusicEra,
  buildMusicGenreHints,
  MUSIC_GENRE_DEFAULT_DATA,
} from "../music-genre.js"

describe("MUSIC_GENRES catalog", () => {
  it("is non-empty and has unique ids", () => {
    expect(MUSIC_GENRES.length).toBeGreaterThan(0)
    const ids = new Set(MUSIC_GENRES.map((g) => g.id))
    expect(ids.size).toBe(MUSIC_GENRES.length)
  })

  it("every genre has a non-empty promptHint", () => {
    for (const g of MUSIC_GENRES) expect(g.promptHint.length).toBeGreaterThan(0)
  })

  it("every subgenre has a non-empty promptHint", () => {
    for (const g of MUSIC_GENRES) {
      for (const s of g.subgenres) expect(s.promptHint.length).toBeGreaterThan(0)
    }
  })
})

describe("MUSIC_ERAS catalog", () => {
  it("is non-empty and has unique ids", () => {
    expect(MUSIC_ERAS.length).toBeGreaterThan(0)
    const ids = new Set(MUSIC_ERAS.map((e) => e.id))
    expect(ids.size).toBe(MUSIC_ERAS.length)
  })
})

describe("lookup helpers", () => {
  it("getMusicGenre resolves a known id", () => {
    expect(getMusicGenre(MUSIC_GENRES[0].id)).toBe(MUSIC_GENRES[0])
  })

  it("getMusicGenre returns undefined for unknown / empty", () => {
    expect(getMusicGenre(undefined)).toBeUndefined()
    expect(getMusicGenre("")).toBeUndefined()
    expect(getMusicGenre("not-a-real-genre")).toBeUndefined()
  })

  it("getMusicGenreLabel falls back to id when not found", () => {
    expect(getMusicGenreLabel("not-a-real-genre")).toBe("not-a-real-genre")
    expect(getMusicGenreLabel(undefined)).toBe("")
  })

  it("getMusicSubgenre resolves a nested subgenre", () => {
    const g = MUSIC_GENRES.find((x) => x.subgenres.length > 0)!
    const s = g.subgenres[0]
    expect(getMusicSubgenre(g.id, s.id)?.id).toBe(s.id)
  })

  it("getMusicEra resolves a known era", () => {
    expect(getMusicEra(MUSIC_ERAS[0].id)?.id).toBe(MUSIC_ERAS[0].id)
  })
})

describe("buildMusicGenreHints", () => {
  it("returns empty string for empty data", () => {
    expect(buildMusicGenreHints({})).toBe("")
  })

  it("returns just the genre hint when only genre is set", () => {
    const g = MUSIC_GENRES[0]
    expect(buildMusicGenreHints({ genre: g.id })).toBe(g.promptHint)
  })

  it("composes era + subgenre + genre in that order", () => {
    const g = MUSIC_GENRES.find((x) => x.subgenres.length > 0)!
    const s = g.subgenres[0]
    const e = MUSIC_ERAS[0]
    const out = buildMusicGenreHints({ genre: g.id, subgenre: s.id, era: e.id })
    expect(out).toContain(e.promptHint)
    expect(out).toContain(s.promptHint)
    expect(out.indexOf(e.promptHint)).toBeLessThan(out.indexOf(s.promptHint))
  })

  it("uses base genre hint when subgenre is unset", () => {
    const g = MUSIC_GENRES[0]
    const e = MUSIC_ERAS[0]
    const out = buildMusicGenreHints({ genre: g.id, era: e.id })
    expect(out).toContain(e.promptHint)
    expect(out).toContain(g.promptHint)
  })

  it("falls back gracefully on unknown ids", () => {
    expect(buildMusicGenreHints({ genre: "not-real" })).toBe("")
  })
})

describe("MUSIC_GENRE_DEFAULT_DATA", () => {
  it("is empty (forces user to pick)", () => {
    expect(MUSIC_GENRE_DEFAULT_DATA).toEqual({})
  })
})
