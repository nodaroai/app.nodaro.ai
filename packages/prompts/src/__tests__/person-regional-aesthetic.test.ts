import { describe, it, expect } from "vitest"
import {
  PEOPLE,
  buildPersonHints,
  getPerson,
  PERSON_DIMENSION_LABELS,
  PERSON_FIELD_BY_DIMENSION,
  PERSON_DIMENSION_ORDER,
} from "../person.js"

const REGIONAL_ENTRIES = PEOPLE.filter((p) => p.dimension === "regional-aesthetic")

describe("regional-aesthetic dimension — wiring", () => {
  it("registers the dimension in the order array", () => {
    expect(PERSON_DIMENSION_ORDER).toContain("regional-aesthetic")
  })

  it("has a human-readable display label", () => {
    expect(PERSON_DIMENSION_LABELS["regional-aesthetic"]).toBe("Regional Aesthetic")
  })

  it("maps the dimension to the regionalAesthetic field on PersonValue", () => {
    expect(PERSON_FIELD_BY_DIMENSION["regional-aesthetic"]).toBe("regionalAesthetic")
  })
})

describe("regional-aesthetic catalog — coverage and structure", () => {
  it("ships the expected total entry count", () => {
    expect(REGIONAL_ENTRIES.length).toBe(86)
  })

  it.each([
    ["USA — Mainstream", 20],
    ["USA — African-American", 6],
    ["Europe", 16],
    ["Asia", 12],
    ["Latin America", 7],
    ["Middle East", 7],
    ["North Africa", 3],
    ["Sub-Saharan Africa", 11],
    ["Oceania", 4],
  ])("has exactly %i entries in the %s group", (group, expectedCount) => {
    const count = REGIONAL_ENTRIES.filter((p) => p.group === group).length
    expect(count).toBe(expectedCount)
  })

  it("gives every entry a unique id", () => {
    const ids = REGIONAL_ENTRIES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("gives every entry a non-empty label, description, promptHint, and group", () => {
    for (const e of REGIONAL_ENTRIES) {
      expect(e.label.trim()).not.toBe("")
      expect(e.description.trim()).not.toBe("")
      expect(e.promptHint.trim()).not.toBe("")
      expect(e.group?.trim() ?? "").not.toBe("")
    }
  })
})

describe("regional-aesthetic catalog — vibe-only invariant", () => {
  // The dimension MUST NOT hard-code visuals owned by other dimensions
  // (skin tone, hair color, hair style, wardrobe). Otherwise a user picking
  // RegionalAesthetic + SkinTone + HairColor sees conflicting prompt
  // fragments. This test scans every promptHint for forbidden tokens.
  const FORBIDDEN_TOKENS = [
    // Skin tone — Skin Tone dimension owns these
    /\b(?:fair|pale|olive|tan|tanned|bronzed|dark|deep|ebony|porcelain|alabaster)\s+skin\b/i,
    // Hair color — Hair Color dimension owns these
    /\b(?:blonde|brunette|black|brown|red|auburn|gray|silver|white)\s+hair\b/i,
    // Hair style — Styling.hair-cut dimension owns these.
    // `afro` is excluded ONLY when it's a standalone hairstyle word —
    // the hyphenated "Afro-glam" / "Afro-fashion" are aesthetic-name
    // labels for fashion movements, not the hairstyle.
    /\bafro\b(?!-)/i,
    /\b(?:braided|braids|dreadlocks|buzz-cut|bob|ponytail|bun|topknot)\b/i,
    // Wardrobe — Styling dimension owns these (specific garments only —
    // generic wardrobe-mood words like "tailored" or "boho" are fine because
    // they describe a vibe, not a specific item)
    /\b(?:wearing|dressed in|outfit|kente cloth|kimono)\b/i,
  ]

  it.each(REGIONAL_ENTRIES.map((e) => [e.id, e.promptHint]))(
    "%s promptHint avoids forbidden visual-overlap tokens",
    (_id, promptHint) => {
      for (const pattern of FORBIDDEN_TOKENS) {
        expect(promptHint).not.toMatch(pattern)
      }
    },
  )
})

describe("regional-aesthetic — promptHint emission", () => {
  it("emits a single hint when one id is picked", () => {
    const hints = buildPersonHints({ regionalAesthetic: "cali-beach" })
    expect(hints).toContain(getPerson("cali-beach")!.promptHint)
  })

  it("emits two independent hints when two ids are picked (multi-pick)", () => {
    const hints = buildPersonHints({
      regionalAesthetic: ["nyc-fashion", "parisienne"],
    })
    expect(hints).toContain(getPerson("nyc-fashion")!.promptHint)
    expect(hints).toContain(getPerson("parisienne")!.promptHint)
  })

  it("ignores unknown ids without throwing", () => {
    const hints = buildPersonHints({ regionalAesthetic: "no-such-id" })
    expect(hints.every((h) => !h.includes("no-such-id"))).toBe(true)
  })

  it("emits nothing when the field is empty", () => {
    expect(buildPersonHints({ regionalAesthetic: undefined })).toEqual([])
    expect(buildPersonHints({ regionalAesthetic: "" })).toEqual([])
    expect(buildPersonHints({ regionalAesthetic: [] })).toEqual([])
  })

  it("composes cleanly with ethnicity (no hint conflict)", () => {
    // The whole point of the dimension: a Tokyo Harajuku vibe should be
    // independent of ethnicity. Ethnicity can be Senegalese without
    // contradicting the Harajuku styling cue.
    const hints = buildPersonHints({
      ethnicity: "senegalese",
      regionalAesthetic: "tokyo-harajuku",
    })
    // Both hints should be present (Senegalese fallthrough — even unknown
    // IDs are fine; we're testing that the regional hint ships alongside)
    expect(hints.some((h) => h.includes("Tokyo Harajuku"))).toBe(true)
  })
})

describe("regional-aesthetic — Sub-Saharan Africa colonial-overlay tagging", () => {
  // Anglophone / Francophone / Lusophone tagging is part of the dimension's
  // design. Catch regressions where a tag is dropped from an entry's
  // description.
  const SSA = REGIONAL_ENTRIES.filter((p) => p.group === "Sub-Saharan Africa")

  it.each([
    ["lagos-afro-glam", "🇬🇧"],
    ["accra-afro-fashion", "🇬🇧"],
    ["dakar-francophone", "🇫🇷"],
    ["abidjan-cosmopolitan", "🇫🇷"],
    ["kinshasa-sape", "🇫🇷"],
    ["nairobi-cosmopolitan", "🇬🇧"],
    ["swahili-coast", "🇬🇧"],
    ["johannesburg-urban", "🇬🇧"],
    ["cape-town-cosmopolitan", "🇬🇧"],
    ["luanda-lusophone", "🇵🇹"],
  ])("%s carries the %s overlay flag in its description", (id, flag) => {
    const entry = SSA.find((p) => p.id === id)
    expect(entry).toBeDefined()
    expect(entry!.description).toContain(flag)
  })

  it("addis-habesha is intentionally untagged (Ethiopia was never colonized)", () => {
    const entry = SSA.find((p) => p.id === "addis-habesha")
    expect(entry).toBeDefined()
    expect(entry!.description).not.toMatch(/🇬🇧|🇫🇷|🇵🇹/)
  })
})
