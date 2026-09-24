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

  it("compact match cut reads term + anti-blend clause + position only", () => {
    expect(
      composeTransitionHintFromConnections(
        "match-cut", [], [], { position: "middle", duration: "short", intensity: "natural" }, "compact",
      ),
    ).toBe(`match cut — ${INSTANT_CUT_CLAUSE}, the transition occurs in the middle of the clip`)
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
 * with natural unhurried timing" still rendered as a ~1 s dissolve. An
 * explicit anti-blend instruction after the term made it a true single-frame
 * hard cut, with and without an end frame.
 */
describe("instant transitions — the anti-blend clause", () => {
  for (const mode of ["full", "compact"] as const) {
    const base = mode === "compact" ? getTransitionTerm : getTransitionPromptHint

    it(`${mode}: every instant row carries the clause exactly once, right after its own base`, () => {
      for (const id of INSTANT_IDS) {
        const r = composeTransitionHintFromConnections(id, [], [], undefined, mode)
        expect(r).toBe(`${base(id)} — ${INSTANT_CUT_CLAUSE}`)
      }
    })

    it(`${mode}: an all-instant multi-pick carries it once, after the last base`, () => {
      const r = composeTransitionHintFromConnections(["match-cut", "smash-cut"], [], [], undefined, mode)
      expect(r).toBe(`${base("match-cut")}, and ${base("smash-cut")} — ${INSTANT_CUT_CLAUSE}`)
      expect(r.split(INSTANT_CUT_CLAUSE).length).toBe(2)
    })

    it(`${mode}: a mixed pick is unchanged — no clause, duration and intensity kept`, () => {
      const r = composeTransitionHintFromConnections(
        ["match-cut", "cross-dissolve"], [], [], { position: "end", duration: "short", intensity: "natural" }, mode,
      )
      expect(r).toBe(
        `${base("match-cut")}, and ${base("cross-dissolve")}, the transition occurs at the end of the clip, ` +
        "lasting approximately 1 second, with natural unhurried timing",
      )
    })

    it(`${mode}: a non-instant row never carries the clause`, () => {
      for (const t of TRANSITIONS) {
        if (t.instant) continue
        expect(composeTransitionHintFromConnections(t.id, [], [], undefined, mode)).not.toContain(INSTANT_CUT_CLAUSE)
      }
    })
  }

  it("the direction-registry fold (server path) words a cut identically", () => {
    expect(renderTransitionBases(["match-cut"], "compact")).toEqual([`match cut — ${INSTANT_CUT_CLAUSE}`])
    expect(renderDirectionHints({ transition: "match-cut" }, { surface: "video", mode: VIDEO_HINT_MODE_DEFAULT }))
      .toEqual([`match cut — ${INSTANT_CUT_CLAUSE}`])
    expect(renderDirectionHints({ transition: "snap-to-black" }, { surface: "video", mode: "full" }))
      .toEqual([`${getTransitionPromptHint("snap-to-black")} — ${INSTANT_CUT_CLAUSE}`])
    // Mixed pick: per-id fragments, exactly as before.
    expect(renderDirectionHints({ transition: ["match-cut", "cross-dissolve"] }, { surface: "video", mode: VIDEO_HINT_MODE_DEFAULT }))
      .toEqual(["match cut", getTransitionTerm("cross-dissolve")])
  })
})

describe("instant transitions — on the wire catalog", () => {
  it("the transition picker options carry instant: true on exactly the cut rows", () => {
    const options = getPickerCatalog("transition")?.options ?? []
    expect(options.length).toBe(TRANSITIONS.length)
    expect(options.filter((o) => o.instant === true).map((o) => o.id).sort()).toEqual([...INSTANT_IDS].sort())
    // Absent (not `false`) everywhere else, so a non-transition catalog's shape is unchanged.
    for (const o of options) if (!INSTANT_IDS.includes(o.id)) expect(o).not.toHaveProperty("instant")
  })

  it("no other catalog grows the field", () => {
    const camera = getPickerCatalog("camera-motion")?.options ?? []
    expect(camera.length).toBeGreaterThan(0)
    for (const o of camera) expect(o).not.toHaveProperty("instant")
  })
})
