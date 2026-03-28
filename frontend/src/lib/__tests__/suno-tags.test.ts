import { describe, it, expect } from "vitest"
import {
  SUNO_TAGS,
  SUNO_SUGGESTION_ITEMS,
  SUNO_LYRICS_SUGGESTION_ITEMS,
  SUNO_STYLE_SUGGESTION_ITEMS,
} from "@/lib/suno-tags"

describe("SUNO_TAGS", () => {
  it("has more than 100 entries", () => {
    expect(SUNO_TAGS.length).toBeGreaterThan(100)
  })

  it("all tags are in [bracket] format", () => {
    for (const entry of SUNO_TAGS) {
      expect(entry.tag).toMatch(/^\[.+\]$/)
    }
  })

  it("each tag has a non-empty label and category", () => {
    for (const entry of SUNO_TAGS) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.category.length).toBeGreaterThan(0)
    }
  })

  it("has no duplicate tags", () => {
    const tags = SUNO_TAGS.map((t) => t.tag)
    const unique = new Set(tags)
    expect(unique.size).toBe(tags.length)
  })

  it("contains all 10 expected categories", () => {
    const categories = new Set(SUNO_TAGS.map((t) => t.category))
    const expected = [
      "Structure",
      "Genre",
      "Vocal Style",
      "Vocal Gender",
      "Vocal Effects",
      "Vocal Emotion",
      "Sound Effects",
      "Instruments",
      "Mood",
      "Production",
    ]
    for (const cat of expected) {
      expect(categories.has(cat)).toBe(true)
    }
    expect(categories.size).toBe(10)
  })

  it("includes well-known genre tags", () => {
    const tags = SUNO_TAGS.map((t) => t.tag)
    expect(tags).toContain("[Rock]")
    expect(tags).toContain("[Pop]")
  })

  it("includes well-known structure tags", () => {
    const tags = SUNO_TAGS.map((t) => t.tag)
    expect(tags).toContain("[Verse]")
    expect(tags).toContain("[Chorus]")
    expect(tags).toContain("[Bridge]")
  })
})

describe("SUNO_SUGGESTION_ITEMS", () => {
  it("has the same length as SUNO_TAGS", () => {
    expect(SUNO_SUGGESTION_ITEMS.length).toBe(SUNO_TAGS.length)
  })
})

describe("SUNO_LYRICS_SUGGESTION_ITEMS", () => {
  it("excludes Mood and Production categories", () => {
    for (const item of SUNO_LYRICS_SUGGESTION_ITEMS) {
      expect(item.category).not.toBe("Mood")
      expect(item.category).not.toBe("Production")
    }
  })

  it("has fewer items than SUNO_TAGS", () => {
    expect(SUNO_LYRICS_SUGGESTION_ITEMS.length).toBeLessThan(SUNO_TAGS.length)
  })
})

describe("SUNO_STYLE_SUGGESTION_ITEMS", () => {
  const ALLOWED_CATEGORIES = new Set([
    "Genre",
    "Mood",
    "Instruments",
    "Production",
    "Vocal Style",
    "Vocal Gender",
  ])

  it("only contains allowed style categories", () => {
    for (const item of SUNO_STYLE_SUGGESTION_ITEMS) {
      expect(ALLOWED_CATEGORIES.has(item.category)).toBe(true)
    }
  })

  it("tags have no brackets", () => {
    for (const item of SUNO_STYLE_SUGGESTION_ITEMS) {
      expect(item.tag).not.toMatch(/[\[\]]/)
    }
  })

  it('strips "Mood: " prefix', () => {
    const euphoric = SUNO_STYLE_SUGGESTION_ITEMS.find(
      (i) => i.category === "Mood" && i.tag === "Euphoric",
    )
    expect(euphoric).toBeDefined()
    expect(euphoric!.label).toBe("Euphoric")
  })

  it('strips "Effect: " prefix', () => {
    const lofi = SUNO_STYLE_SUGGESTION_ITEMS.find(
      (i) => i.category === "Production" && i.tag === "Lo-fi",
    )
    expect(lofi).toBeDefined()
    expect(lofi!.label).toBe("Lo-fi")
  })

  it('strips "Tempo: " prefix', () => {
    const bpm120 = SUNO_STYLE_SUGGESTION_ITEMS.find(
      (i) => i.category === "Production" && i.tag === "120 BPM",
    )
    expect(bpm120).toBeDefined()
    expect(bpm120!.label).toBe("120 BPM")
  })
})
