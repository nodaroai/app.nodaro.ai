import { describe, expect, it } from "vitest"
import {
  INSTANT_CUT_CLAUSE,
  TRANSITIONS,
  TRANSITION_DURATIONS,
  TRANSITION_INTENSITIES,
  composeTransitionHintFromConnections,
  getTransitionPromptHint,
  getTransitionTerm,
  isInstantTransition,
  renderTransitionBases,
} from "../transitions.js"
import { getPickerCatalog } from "../picker-catalogs.js"
import { VIDEO_HINT_MODE_DEFAULT, renderDirectionHints } from "../direction-registry.js"

/**
 * F5 (transition QA, 2026-09-22): a duration clause on a cut ("match cut, …,
 * lasting approximately 1 second") made the video model render a 1.75 s
 * dissolve. Rows whose mechanism IS a cut carry `instant: true`, and the
 * composer drops the duration lever for them.
 */
const INSTANT_IDS = [
  "none",
  "snap-to-black",
  "match-cut",
  "smash-cut",
  "seamless-match",
  "jump-cut",
  "jump-match",
  "action-relay",
]

const DURATION_HINTS = TRANSITION_DURATIONS.map((d) => d.promptHint).filter((h) => h.length > 0)
const INTENSITY_HINTS = TRANSITION_INTENSITIES.map((d) => d.promptHint).filter((h) => h.length > 0)

describe("instant transitions — the catalog marker", () => {
  it("marks exactly the cut rows", () => {
    expect(TRANSITIONS.filter((t) => t.instant).map((t) => t.id).sort()).toEqual([...INSTANT_IDS].sort())
  })

  it("isInstantTransition answers per id, and false for unknown / auto / empty", () => {
    for (const id of INSTANT_IDS) expect(isInstantTransition(id)).toBe(true)
    expect(isInstantTransition("cross-dissolve")).toBe(false)
    expect(isInstantTransition("whip-pan")).toBe(false)
    expect(isInstantTransition("freeze-frame-jump")).toBe(false)
    expect(isInstantTransition("auto")).toBe(false)
    expect(isInstantTransition("nonexistent")).toBe(false)
    expect(isInstantTransition("")).toBe(false)
    expect(isInstantTransition(undefined)).toBe(false)
    expect(isInstantTransition(null)).toBe(false)
    expect(isInstantTransition([])).toBe(false)
  })

  it("a multi-pick is instant only when every id is", () => {
    expect(isInstantTransition(["match-cut", "smash-cut"])).toBe(true)
    expect(isInstantTransition(["match-cut", "cross-dissolve"])).toBe(false)
  })
})

describe("instant transitions — the composer drops the duration lever", () => {
  for (const mode of ["full", "compact"] as const) {
    it(`${mode}: no duration clause on any instant row, for every duration`, () => {
      for (const id of INSTANT_IDS) {
        for (const d of TRANSITION_DURATIONS) {
          const r = composeTransitionHintFromConnections(id, [], [], { duration: d.id }, mode)
          for (const hint of DURATION_HINTS) expect(r).not.toContain(hint)
        }
      }
    })

    it(`${mode}: no intensity clause on any instant row, for every intensity`, () => {
      for (const id of INSTANT_IDS) {
        for (const i of TRANSITION_INTENSITIES) {
          const r = composeTransitionHintFromConnections(id, [], [], { intensity: i.id }, mode)
          for (const hint of INTENSITY_HINTS) expect(r).not.toContain(hint)
        }
      }
    })

    it(`${mode}: position still applies to a cut`, () => {
      const r = composeTransitionHintFromConnections(
        "match-cut", [], [], { position: "middle", duration: "short", intensity: "natural" }, mode,
      )
      expect(r).toContain("the transition occurs in the middle of the clip")
      expect(r).not.toContain("unhurried")
      expect(r).not.toContain("lasting approximately")
    })
  }

  it("compact match cut reads term (hint; anti-blend clause) + position only", () => {
    expect(
      composeTransitionHintFromConnections(
        "match-cut", [], [], { position: "middle", duration: "short", intensity: "natural" }, "compact",
      ),
    ).toBe(
      "match cut (the final composition of the first shot matches the opening composition of the second shot " +
      `in shape, color, and motion, so the cut feels like a visual rhyme; ${INSTANT_CUT_CLAUSE}), ` +
      "the transition occurs in the middle of the clip",
    )
  })

  it("a non-instant row keeps its duration", () => {
    const r = composeTransitionHintFromConnections("cross-dissolve", [], [], { duration: "short" })
    expect(r).toContain("lasting approximately 1 second")
  })

  it("a mixed pick keeps its duration — the non-cut still has a length", () => {
    const r = composeTransitionHintFromConnections(["match-cut", "ink-splash"], [], [], { duration: "short" })
    expect(r).toContain("lasting approximately 1 second")
  })

  it("a no-op 'auto' beside a cut does not make the pick non-instant", () => {
    const r = composeTransitionHintFromConnections(["auto", "smash-cut"], [], [], { duration: "long" })
    expect(r).not.toContain("lasting approximately")
    expect(r).toContain(INSTANT_CUT_CLAUSE)
  })
})

/**
 * Transition QA, 2026-09-24 (seedance-2-5, prod): the bare term "match cut,
 * with natural unhurried timing" still rendered as a ~1 s dissolve. Every
 * transition in a video prompt now reads `<term> (<hint body>)`, and an
 * all-instant pick carries the anti-blend clause inside its parentheses.
 */
describe("transitions in a video prompt — `term (hint)`", () => {
  const LEVERS = { duration: "short", intensity: "natural" } as const

  it("the six A/B strings (compact, short + natural levers)", () => {
    const c = (id: string) => composeTransitionHintFromConnections(id, [], [], LEVERS, "compact")
    expect(c("match-cut")).toBe(
      "match cut (the final composition of the first shot matches the opening composition of the second shot " +
      `in shape, color, and motion, so the cut feels like a visual rhyme; ${INSTANT_CUT_CLAUSE})`,
    )
    expect(c("none")).toBe(
      `hard cut (no transition, instantaneous switch from first shot to second shot; ${INSTANT_CUT_CLAUSE})`,
    )
    expect(c("whip-pan")).toBe(
      "whip pan (the camera whips sideways at high speed, smearing the frame into heavy horizontal motion blur, " +
      "and the second shot enters already travelling in the same direction before it settles into its framing), " +
      "lasting approximately 1 second, with natural unhurried timing",
    )
    expect(c("roll-transition")).toBe(
      `camera roll transition (${getTransitionPromptHint("roll-transition")}), ` +
      "lasting approximately 1 second, with natural unhurried timing",
    )
    expect(c("freeze-frame-jump")).toBe(
      "freeze-frame time jump (motion arrests mid-action, the frame holds frozen for a beat, then snaps to a new " +
      "moment hours or days later in the same scene with subjects in different positions), " +
      "lasting approximately 1 second, with natural unhurried timing",
    )
    expect(c("shatter-glass")).toBe(
      `shatter like glass and reform (${getTransitionPromptHint("shatter-glass")}), ` +
      "lasting approximately 1 second, with natural unhurried timing",
    )
  })

  for (const mode of ["full", "compact"] as const) {
    it(`${mode}: every row reads \`term (…)\` — the hint never restates its own "<label>:" heading`, () => {
      for (const t of TRANSITIONS) {
        const term = getTransitionTerm(t.id)
        const r = composeTransitionHintFromConnections(t.id, [], [], undefined, mode)
        if (!term) { expect(r).toBe(""); continue }
        expect(r.startsWith(`${term} (`), t.id).toBe(true)
        expect(r.endsWith(")"), t.id).toBe(true)
        expect(r.slice(term.length + 2).toLowerCase().startsWith(`${term.toLowerCase()}:`), t.id).toBe(false)
        expect(r).not.toMatch(/\(\s*[^,;()]{1,60}: /)
      }
    })

    it(`${mode}: every instant row carries the clause exactly once, inside its parentheses`, () => {
      for (const id of INSTANT_IDS) {
        const r = composeTransitionHintFromConnections(id, [], [], undefined, mode)
        expect(r.endsWith(`; ${INSTANT_CUT_CLAUSE})`), id).toBe(true)
        expect(r.split(INSTANT_CUT_CLAUSE).length, id).toBe(2)
      }
    })

    it(`${mode}: an all-instant multi-pick carries it once, in the last parentheses`, () => {
      const r = composeTransitionHintFromConnections(["match-cut", "smash-cut"], [], [], undefined, mode)
      const [a, b] = r.split(", and smash cut (")
      expect(a.startsWith("match cut (")).toBe(true)
      expect(a).not.toContain(INSTANT_CUT_CLAUSE)
      expect(b.endsWith(`; ${INSTANT_CUT_CLAUSE})`)).toBe(true)
    })

    it(`${mode}: a mixed pick carries no clause and keeps duration and intensity`, () => {
      const r = composeTransitionHintFromConnections(
        ["match-cut", "cross-dissolve"], [], [], { position: "end", duration: "short", intensity: "natural" }, mode,
      )
      expect(r).not.toContain(INSTANT_CUT_CLAUSE)
      expect(r).toBe(
        renderTransitionBases(["match-cut", "cross-dissolve"]).join(", and ") +
        ", the transition occurs at the end of the clip, lasting approximately 1 second, with natural unhurried timing",
      )
    })

    it(`${mode}: a non-instant row never carries the clause`, () => {
      for (const t of TRANSITIONS) {
        if (t.instant) continue
        expect(composeTransitionHintFromConnections(t.id, [], [], undefined, mode)).not.toContain(INSTANT_CUT_CLAUSE)
      }
    })
  }

  it("`none` does not say 'hard cut' three times", () => {
    const r = composeTransitionHintFromConnections("none", [], [], undefined, "compact")
    expect(r.split("hard cut").length - 1).toBe(2)
  })

  it("the direction-registry fold (server path) words a transition identically", () => {
    for (const mode of [VIDEO_HINT_MODE_DEFAULT, "full", "compact"] as const) {
      expect(renderDirectionHints({ transition: "match-cut" }, { surface: "video", mode }))
        .toEqual([composeTransitionHintFromConnections("match-cut", [], [])])
      expect(renderDirectionHints({ transition: "whip-pan" }, { surface: "video", mode }))
        .toEqual([composeTransitionHintFromConnections("whip-pan", [], [])])
      // Multi-pick: one fragment per id, the clause only in the last of an all-instant pick.
      expect(renderDirectionHints({ transition: ["match-cut", "cross-dissolve"] }, { surface: "video", mode }))
        .toEqual(renderTransitionBases(["match-cut", "cross-dissolve"]))
    }
    // A transition never reaches an image prompt.
    expect(renderDirectionHints({ transition: "match-cut" }, { surface: "image" })).toEqual([])
  })
})
