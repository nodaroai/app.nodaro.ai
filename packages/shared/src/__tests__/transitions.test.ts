import { describe, expect, it } from "vitest"
import {
  TRANSITIONS,
  TRANSITION_IDS,
  TRANSITION_CATEGORY_ORDER,
  TRANSITION_CATEGORY_LABELS,
  composeTransitionHintFromConnections,
  getTransition,
  getTransitionLabel,
  getTransitionPromptHint,
} from "../transitions"

describe("transitions catalog", () => {
  it("ships 76 unique entries", () => {
    expect(TRANSITIONS).toHaveLength(76)
    expect(new Set(TRANSITION_IDS).size).toBe(76)
  })

  it("every entry has a non-empty id, label, and description", () => {
    for (const t of TRANSITIONS) {
      expect(t.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.description.length).toBeGreaterThan(0)
    }
  })

  it("category counts match the spec §3.3 table", () => {
    const counts: Record<string, number> = {}
    for (const t of TRANSITIONS) {
      counts[t.category] = (counts[t.category] ?? 0) + 1
    }
    expect(counts).toEqual({
      standard: 11, time: 8, element: 14, morph: 9,
      portal: 10, physics: 9, light: 8, glitch: 7,
    })
  })

  it("category order covers every category and matches labels", () => {
    expect(new Set(TRANSITION_CATEGORY_ORDER)).toEqual(
      new Set(Object.keys(TRANSITION_CATEGORY_LABELS)),
    )
  })

  it("auto has empty promptHint by design", () => {
    expect(getTransitionPromptHint("auto")).toBe("")
  })

  it("none has a hard-cut promptHint (not empty)", () => {
    expect(getTransitionPromptHint("none")).toBe(
      "no transition, hard cut, instantaneous switch from first shot to second shot",
    )
  })
})

describe("getTransition / getTransitionLabel / getTransitionPromptHint", () => {
  it("returns the entry for a known id", () => {
    const t = getTransition("cross-dissolve")
    expect(t?.label).toBe("Cross-Dissolve")
  })

  it("returns undefined for nullish + unknown ids", () => {
    expect(getTransition(undefined)).toBeUndefined()
    expect(getTransition(null)).toBeUndefined()
    expect(getTransition("nonexistent")).toBeUndefined()
  })

  it("getTransitionLabel falls back to title-cased id when unknown", () => {
    expect(getTransitionLabel("nonexistent-id")).toBe("Nonexistent Id")
  })

  it("getTransitionPromptHint returns the hint or empty string", () => {
    expect(getTransitionPromptHint("cross-dissolve")).toContain("cross-dissolve")
    expect(getTransitionPromptHint("nonexistent")).toBe("")
  })

  it("getTransitionLabel returns empty string for null/undefined", () => {
    expect(getTransitionLabel(null)).toBe("")
    expect(getTransitionLabel(undefined)).toBe("")
  })
})

describe("composeTransitionHintFromConnections — single-pick", () => {
  it("returns the bare hint when no connections + no timing", () => {
    const r = composeTransitionHintFromConnections("cross-dissolve", [], [])
    expect(r).toBe(getTransitionPromptHint("cross-dissolve"))
  })

  it("returns empty when id is undefined / 'auto' / unknown", () => {
    expect(composeTransitionHintFromConnections(undefined, ["A"], ["B"])).toBe("")
    expect(composeTransitionHintFromConnections("unknown-id", ["A"], ["B"])).toBe("")
    expect(composeTransitionHintFromConnections("auto", ["A"], ["B"])).toBe("")
  })

  it("treats null like undefined (falsy guard)", () => {
    // Persisted workflow JSON can deliver null at runtime even though the signature is undefined-only.
    expect(composeTransitionHintFromConnections(null as unknown as undefined, ["A"], ["B"])).toBe("")
  })

  it("appends start clause", () => {
    const r = composeTransitionHintFromConnections("cross-dissolve", ["morning"], [])
    expect(r).toMatch(/, starting from morning$/)
  })

  it("appends end clause", () => {
    const r = composeTransitionHintFromConnections("cross-dissolve", [], ["night"])
    expect(r).toMatch(/, ending at night$/)
  })

  it("joins multiple start hints with ' and '", () => {
    const r = composeTransitionHintFromConnections(
      "cross-dissolve",
      ["A", "C"],
      ["B"],
    )
    expect(r).toMatch(/, starting from A and C, ending at B$/)
  })
})

describe("composeTransitionHintFromConnections — timing clauses", () => {
  it("appends position clause when non-auto", () => {
    const r = composeTransitionHintFromConnections("cross-dissolve", [], [], { position: "end" })
    expect(r).toContain("the transition occurs at the end of the clip")
  })

  it("appends duration clause when non-auto", () => {
    const r = composeTransitionHintFromConnections("cross-dissolve", [], [], { duration: "medium" })
    expect(r).toContain("lasting approximately 2 seconds")
  })

  it("appends intensity clause when non-auto", () => {
    const r = composeTransitionHintFromConnections("cross-dissolve", [], [], { intensity: "dynamic" })
    expect(r).toContain("with dynamic energy and assertive flourish")
  })

  it("omits clause when value is 'auto'", () => {
    const r = composeTransitionHintFromConnections("cross-dissolve", [], [], { position: "auto" })
    expect(r).not.toContain("the transition occurs")
  })

  it("appends all three timing clauses in position/duration/intensity order", () => {
    const r = composeTransitionHintFromConnections(
      "cross-dissolve",
      [],
      [],
      { position: "end", duration: "medium", intensity: "dynamic" },
    )
    const idxPos = r.indexOf("the transition occurs")
    const idxDur = r.indexOf("lasting approximately")
    const idxInt = r.indexOf("with dynamic energy")
    expect(idxPos).toBeGreaterThan(0)
    expect(idxDur).toBeGreaterThan(idxPos)
    expect(idxInt).toBeGreaterThan(idxDur)
  })

  it("composes timing + start + end together in spec §4.2 order", () => {
    const r = composeTransitionHintFromConnections(
      "fast-forward-day-night",
      ["warm golden morning light"],
      ["deep blue moonlit night"],
      { position: "end", duration: "medium", intensity: "dynamic" },
    )
    expect(r).toContain("the transition occurs at the end of the clip")
    expect(r).toContain("lasting approximately 2 seconds")
    expect(r).toContain("with dynamic energy and assertive flourish")
    expect(r).toContain("starting from warm golden morning light")
    expect(r).toMatch(/, ending at deep blue moonlit night$/)
  })
})

describe("composeTransitionHintFromConnections — multi-pick", () => {
  it("scalar form is identical to single-element array", () => {
    const scalar = composeTransitionHintFromConnections("smash-cut", [], [])
    const array  = composeTransitionHintFromConnections(["smash-cut"], [], [])
    expect(scalar).toBe(array)
  })

  it("joins two base hints with ', and '", () => {
    const r = composeTransitionHintFromConnections(["smash-cut", "white-flash"], [], [])
    const a = getTransitionPromptHint("smash-cut")
    const b = getTransitionPromptHint("white-flash")
    expect(r).toBe(`${a}, and ${b}`)
  })

  it("dedupes duplicate ids", () => {
    const r1 = composeTransitionHintFromConnections(["smash-cut", "smash-cut"], [], [])
    const r2 = composeTransitionHintFromConnections("smash-cut", [], [])
    expect(r1).toBe(r2)
  })

  it("caps at 2 ids — extra ids dropped", () => {
    const a = getTransitionPromptHint("smash-cut")
    const b = getTransitionPromptHint("white-flash")
    const r = composeTransitionHintFromConnections(
      ["smash-cut", "white-flash", "fade-to-black", "wipe"],
      [],
      [],
    )
    expect(r).toBe(`${a}, and ${b}`)
  })

  it("returns '' on empty array", () => {
    expect(composeTransitionHintFromConnections([], [], [])).toBe("")
  })

  it("filters out 'auto' (empty hint) entries silently", () => {
    const onlyFade = composeTransitionHintFromConnections("fade-to-black", [], [])
    const withAuto = composeTransitionHintFromConnections(["auto", "fade-to-black"], [], [])
    expect(withAuto).toBe(onlyFade)
  })

  it("applies timing + start/end clauses once at the outer layer (not per-id)", () => {
    const r = composeTransitionHintFromConnections(
      ["smash-cut", "white-flash"],
      ["morning"],
      ["night"],
      { intensity: "dynamic" },
    )
    expect((r.match(/with dynamic energy/g) ?? []).length).toBe(1)
    expect(r.indexOf("with dynamic energy")).toBeGreaterThan(r.indexOf(", and "))
    expect(r.indexOf("starting from morning")).toBeGreaterThan(r.indexOf("with dynamic energy"))
  })
})
