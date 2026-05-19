import { describe, expect, it } from "vitest"
import {
  CHARACTER_FX,
  CHARACTER_FX_IDS,
  CHARACTER_FX_CATEGORY_ORDER,
  CHARACTER_FX_CATEGORY_LABELS,
  composeCharacterFxHintFromConnections,
  getCharacterFx,
  getCharacterFxLabel,
  getCharacterFxPromptHint,
} from "../character-fx"

describe("character-fx catalog", () => {
  it("ships 57 unique entries", () => {
    expect(CHARACTER_FX).toHaveLength(57)
    expect(new Set(CHARACTER_FX_IDS).size).toBe(57)
  })

  it("every entry has a non-empty id, label, and description", () => {
    for (const c of CHARACTER_FX) {
      expect(c.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(0)
    }
  })

  it("category counts match spec §3.3", () => {
    const counts: Record<string, number> = {}
    for (const c of CHARACTER_FX) counts[c.category] = (counts[c.category] ?? 0) + 1
    expect(counts).toEqual({
      "transformation": 14, "power": 12, "body-mod": 9, "face-expression": 8, "aura-ambient": 14,
    })
  })

  it("category order covers every category and matches labels", () => {
    expect(new Set(CHARACTER_FX_CATEGORY_ORDER)).toEqual(
      new Set(Object.keys(CHARACTER_FX_CATEGORY_LABELS)),
    )
  })

  it("auto + none have empty promptHint by design", () => {
    expect(getCharacterFxPromptHint("auto")).toBe("")
    expect(getCharacterFxPromptHint("none")).toBe("")
  })

  it("every non-empty promptHint contains 'the subject' (regex substitution depends on it)", () => {
    const empty = ["auto", "none"]
    for (const c of CHARACTER_FX) {
      if (empty.includes(c.id)) {
        expect(c.promptHint).toBe("")
      } else {
        expect(c.promptHint, `${c.id} promptHint missing 'the subject'`)
          .toMatch(/\bthe subject\b/)
      }
    }
  })
})

describe("getCharacterFx / getCharacterFxLabel / getCharacterFxPromptHint", () => {
  it("returns the entry for a known id", () => {
    expect(getCharacterFx("werewolf")?.label).toBe("Werewolf")
  })

  it("returns undefined for nullish + unknown ids", () => {
    expect(getCharacterFx(undefined)).toBeUndefined()
    expect(getCharacterFx(null)).toBeUndefined()
    expect(getCharacterFx("nonexistent")).toBeUndefined()
  })

  it("getCharacterFxLabel falls back to title-cased id", () => {
    expect(getCharacterFxLabel("nonexistent-id")).toBe("Nonexistent Id")
  })

  it("getCharacterFxLabel returns empty for null/undefined", () => {
    expect(getCharacterFxLabel(null)).toBe("")
    expect(getCharacterFxLabel(undefined)).toBe("")
  })
})

describe("composeCharacterFxHintFromConnections — single-pick", () => {
  it("returns bare hint when no target + no timing", () => {
    const r = composeCharacterFxHintFromConnections("werewolf", [])
    expect(r).toBe(getCharacterFxPromptHint("werewolf"))
  })

  it("returns empty for undefined / unknown / 'auto'", () => {
    expect(composeCharacterFxHintFromConnections(undefined, ["Aria"])).toBe("")
    expect(composeCharacterFxHintFromConnections("unknown-id", ["Aria"])).toBe("")
    expect(composeCharacterFxHintFromConnections("auto", ["Aria"])).toBe("")
  })

  it("treats null like undefined (falsy guard)", () => {
    expect(composeCharacterFxHintFromConnections(null as unknown as undefined, ["Aria"])).toBe("")
  })

  it("substitutes 'the subject' globally with the target name", () => {
    const r = composeCharacterFxHintFromConnections("werewolf", ["Aria"])
    expect(r).not.toContain("the subject")
    expect(r).toContain("Aria")
  })

  it("joins multiple target names with ' and '", () => {
    const r = composeCharacterFxHintFromConnections("werewolf", ["Aria", "Sam"])
    expect(r).toContain("Aria and Sam")
  })

  it("preserves apostrophe-s constructions: 'the subject's body' → 'Aria's body'", () => {
    // Pick an entry that uses "the subject's" — e.g., werewolf or glow-trace
    const r = composeCharacterFxHintFromConnections("glow-trace", ["Aria"])
    expect(r).toContain("Aria")
    // Confirm no leftover "the subject"s anywhere:
    expect(r).not.toMatch(/\bthe subject\b/)
  })
})

describe("composeCharacterFxHintFromConnections — timing clauses", () => {
  it("appends position clause when non-auto", () => {
    const r = composeCharacterFxHintFromConnections("werewolf", [], { position: "middle" })
    expect(r).toContain("the effect occurs in the middle of the clip")
  })

  it("appends duration clause when non-auto", () => {
    const r = composeCharacterFxHintFromConnections("werewolf", [], { duration: "long" })
    expect(r).toContain("manifesting over approximately 3 seconds")
  })

  it("appends intensity clause when non-auto", () => {
    const r = composeCharacterFxHintFromConnections("werewolf", [], { intensity: "dynamic" })
    expect(r).toContain("with dynamic energy and assertive flourish")
  })

  it("appends all three timing clauses in position/duration/intensity order", () => {
    const r = composeCharacterFxHintFromConnections(
      "werewolf",
      [],
      { position: "middle", duration: "long", intensity: "dynamic" },
    )
    const idxPos = r.indexOf("the effect occurs")
    const idxDur = r.indexOf("manifesting over")
    const idxInt = r.indexOf("with dynamic energy")
    expect(idxPos).toBeGreaterThan(-1)
    expect(idxDur).toBeGreaterThan(idxPos)
    expect(idxInt).toBeGreaterThan(idxDur)
  })

  it("composes target + timing in spec §4.2 worked-example order", () => {
    const r = composeCharacterFxHintFromConnections(
      "werewolf",
      ["Aria Voss"],
      { position: "middle", duration: "long", intensity: "dynamic" },
    )
    expect(r).toContain("Aria Voss")
    expect(r).not.toContain("the subject")
    expect(r).toContain("the effect occurs in the middle of the clip")
    expect(r).toContain("manifesting over approximately 3 seconds")
    expect(r).toContain("with dynamic energy and assertive flourish")
  })
})

describe("composeCharacterFxHintFromConnections — multi-pick", () => {
  it("scalar form is identical to single-element array", () => {
    const a = composeCharacterFxHintFromConnections("werewolf", ["Aria"])
    const b = composeCharacterFxHintFromConnections(["werewolf"], ["Aria"])
    expect(a).toBe(b)
  })

  it("joins two base hints with ', and ', substituting target per id", () => {
    const r = composeCharacterFxHintFromConnections(["werewolf", "fire-breathe"], ["Aria"])
    // Both entries should mention Aria; "the subject" should NOT appear anywhere
    expect(r).toContain("Aria")
    expect(r).not.toMatch(/\bthe subject\b/)
    expect(r).toContain(", and ")
  })

  it("dedupes duplicate ids", () => {
    const r1 = composeCharacterFxHintFromConnections(["werewolf", "werewolf"], [])
    const r2 = composeCharacterFxHintFromConnections("werewolf", [])
    expect(r1).toBe(r2)
  })

  it("caps at 2 — extras dropped", () => {
    const r = composeCharacterFxHintFromConnections(
      ["werewolf", "fire-breathe", "levitation", "wings-grow"],
      [],
    )
    expect(r).toContain(getCharacterFxPromptHint("werewolf"))
    expect(r).toContain(getCharacterFxPromptHint("fire-breathe"))
    expect(r).not.toContain(getCharacterFxPromptHint("levitation"))
  })

  it("returns '' on empty array", () => {
    expect(composeCharacterFxHintFromConnections([], ["Aria"])).toBe("")
  })

  it("filters out 'auto' (empty hint) entries silently", () => {
    const justWerewolf = composeCharacterFxHintFromConnections("werewolf", ["Aria"])
    const withAuto = composeCharacterFxHintFromConnections(["auto", "werewolf"], ["Aria"])
    expect(withAuto).toBe(justWerewolf)
  })

  it("applies timing clauses once at outer layer (not per id)", () => {
    const r = composeCharacterFxHintFromConnections(
      ["werewolf", "fire-breathe"],
      ["Aria"],
      { intensity: "dynamic" },
    )
    expect((r.match(/with dynamic energy/g) ?? []).length).toBe(1)
  })
})
