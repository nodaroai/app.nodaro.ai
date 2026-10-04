/**
 * THE BLENDED CUT (2026-10-04 test round). On `seamless-match` and `jump-match`, Duration `short` turns the
 * hard cut into a blended cut: the anti-blend sentence inside the first pick's parentheses is REPLACED by
 * "instead of a hard cut, the two shots blend into each other over about 1 second" ("about 1 second" is the
 * `short` row's own term). Everything else about the clause is the hard cut's: the position clause (`full`
 * dropped), no duration clause, no intensity clause.
 *
 * Everything else renders exactly as before: the two rows at Auto / Instant / Medium / Long, the other six
 * cuts at every duration, every non-cut, every mixed pick, a blendable cut beside a cut that is not, and the
 * direction fold (`renderTransitionBases`, which has no duration).
 *
 * The approved strings are pinned byte for byte from `fixtures/blended-cut-approved.json`, generated from
 * the approval evidence. A wording change there comes back for approval; never edit the fixture by hand.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  INSTANT_CUT_CLAUSE,
  TRANSITIONS,
  TRANSITION_DURATIONS,
  TRANSITION_INTENSITIES,
  TRANSITION_POSITIONS,
  blendedCutClause,
  composeTransitionHintFromConnections,
  getTransitionTerm,
  isBlendableTransition,
  isInstantTransition,
  renderTransitionBases,
  type TransitionHintScope,
  type TransitionTiming,
  type TransitionTimingOption,
} from "../transitions.js"
import { renderDirectionHints } from "../direction-registry.js"

type Case = {
  readonly key: string
  readonly ids: string | string[]
  readonly timing: TransitionTiming
  readonly scopes: TransitionHintScope[]
  readonly text: string
}
const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/blended-cut-approved.json", import.meta.url), "utf8"),
) as { blendSentence: string; approved: Case[]; ruleDerived: Case[]; hardCut: Case[] }

/** The approved sentence, typed once here so the test file itself shows it. */
const BLEND = "instead of a hard cut, the two shots blend into each other over about 1 second"
const BLENDABLE = ["seamless-match", "jump-match"] as const
const CUTS = TRANSITIONS.filter((t) => t.instant).map((t) => t.id)
const OTHER_CUTS = CUTS.filter((id) => !(BLENDABLE as readonly string[]).includes(id))
const NON_CUTS = TRANSITIONS.filter((t) => !t.instant && t.id !== "auto").map((t) => t.id)
const ALL_IDS = TRANSITIONS.map((t) => t.id)

const POSITIONS = [undefined, ...TRANSITION_POSITIONS.map((o) => o.id)]
const DURATIONS = [undefined, ...TRANSITION_DURATIONS.map((o) => o.id)]
const INTENSITIES = [undefined, ...TRANSITION_INTENSITIES.map((o) => o.id)]
const SCOPES: TransitionHintScope[] = ["clip", "shot"]

const compose = (
  ids: string | readonly string[],
  timing: TransitionTiming | undefined,
  scope: TransitionHintScope = "clip",
  mode: "full" | "compact" = "full",
) => composeTransitionHintFromConnections(ids as string | string[], [], [], timing, mode, { scope })

/** Levers with every unset field left out, so `undefined` and an absent field are the same case. */
function levers(position?: string, duration?: string, intensity?: string): TransitionTiming {
  const t: Record<string, string> = {}
  if (position !== undefined) t.position = position
  if (duration !== undefined) t.duration = duration
  if (intensity !== undefined) t.intensity = intensity
  return t as TransitionTiming
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe("blended cut — the catalog", () => {
  it("marks exactly seamless-match and jump-match blendable, and both are cuts", () => {
    expect(TRANSITIONS.filter((t) => t.blendable).map((t) => t.id)).toEqual([...BLENDABLE])
    for (const id of BLENDABLE) expect(isInstantTransition(id), id).toBe(true)
  })

  it("marks exactly the `short` duration as the step that blends a cut, with a term to blend over", () => {
    const rows = (TRANSITION_DURATIONS as ReadonlyArray<TransitionTimingOption>).filter((d) => d.blendsCut)
    expect(rows.map((d) => d.id)).toEqual(["short"])
    expect(rows[0]!.term).toBe("about 1 second")
  })

  it("the fixture carries the same sentence", () => {
    expect(FIXTURE.blendSentence).toBe(BLEND)
  })
})

describe("isBlendableTransition", () => {
  it("is true for each blendable row and for the two together, in either order", () => {
    for (const id of BLENDABLE) expect(isBlendableTransition(id), id).toBe(true)
    expect(isBlendableTransition(["seamless-match", "jump-match"])).toBe(true)
    expect(isBlendableTransition(["jump-match", "seamless-match"])).toBe(true)
  })

  it("is false for the other six cuts, every non-cut, mixed picks and empty values", () => {
    expect(OTHER_CUTS).toEqual(["none", "snap-to-black", "match-cut", "smash-cut", "jump-cut", "action-relay"])
    for (const id of [...OTHER_CUTS, ...NON_CUTS]) expect(isBlendableTransition(id), id).toBe(false)
    expect(isBlendableTransition(["seamless-match", "match-cut"])).toBe(false)
    expect(isBlendableTransition(["jump-match", "cross-dissolve"])).toBe(false)
    expect(isBlendableTransition("auto")).toBe(false)
    expect(isBlendableTransition("nonexistent")).toBe(false)
    expect(isBlendableTransition("")).toBe(false)
    expect(isBlendableTransition([])).toBe(false)
    expect(isBlendableTransition(undefined)).toBe(false)
    expect(isBlendableTransition(null)).toBe(false)
  })
})

describe("blendedCutClause", () => {
  it("`short` gives the approved sentence", () => {
    expect(blendedCutClause("short")).toBe(BLEND)
  })

  it("every other value gives nothing", () => {
    for (const d of ["auto", "instant", "medium", "long", "nonexistent", "", undefined]) {
      expect(blendedCutClause(d), String(d)).toBe("")
    }
  })
})

describe("blended cut — the approved strings, byte for byte", () => {
  it("the tile default of each row at Short (also inline, so the approved text reads here)", () => {
    expect(compose("seamless-match", { duration: "short" })).toBe(
      "invisible cut (the camera motion, color palette, and on-screen motion at the end of the first shot " +
        "continue exactly across the cut into the second shot, so the boundary is invisible and the two shots " +
        "feel like one unbroken take; instead of a hard cut, the two shots blend into each other over about 1 second)",
    )
    expect(compose("jump-match", { duration: "short" })).toBe(
      "match cut on a jump (the subject launches into a jump, and at the height of the leap the picture cuts to " +
        "a new place. The camera follows the arc of the jump at the same speed on both sides of the cut, and the " +
        "subject stays at the same place in the frame. In the second shot the same jump carries on without a " +
        "break, and the subject comes down and lands in the new place. The shot ends on the subject landed in the " +
        "second shot, fully resolved; instead of a hard cut, the two shots blend into each other over about 1 second)",
    )
  })

  it("covers 12 approved cases: both rows on a tile, mid-clip, mid-shot and in the END slot, and the ignored levers", () => {
    expect(FIXTURE.approved.map((c) => c.key)).toEqual(
      BLENDABLE.flatMap((id) =>
        ["short|tile", "short|mid-clip", "short|mid-shot", "short|end-slot", "short+natural|tile", "short+full|clip"].map(
          (seat) => `${id}|${seat}`,
        ),
      ),
    )
  })

  it.each(FIXTURE.approved)("$key", ({ ids, timing, scopes, text }) => {
    expect(count(text, BLEND)).toBe(1)
    expect(text).not.toContain(INSTANT_CUT_CLAUSE)
    for (const scope of scopes) {
      expect(compose(ids, timing, scope), scope).toBe(text)
      expect(compose(ids, timing, scope, "compact"), `${scope} compact`).toBe(text)
    }
  })
})

describe("blended cut — the multi-pick rule (both picks blendable, Short: the sentence once, in the first parentheses)", () => {
  it("covers both orders of the two rows", () => {
    expect(FIXTURE.ruleDerived).toHaveLength(8)
  })

  it.each(FIXTURE.ruleDerived)("$key", ({ ids, timing, scopes, text }) => {
    expect(count(text, BLEND)).toBe(1)
    expect(text).not.toContain(INSTANT_CUT_CLAUSE)
    // The sentence rides the first pick; the second keeps its plain wording.
    const [first] = renderTransitionBases(ids as string[])
    expect(text.startsWith(first!.replace(INSTANT_CUT_CLAUSE, BLEND))).toBe(true)
    for (const scope of scopes) expect(compose(ids, timing, scope), scope).toBe(text)
  })

  it("a blendable cut beside a cut that is not stays a hard cut", () => {
    for (const pair of [["seamless-match", "match-cut"], ["none", "jump-match"], ["jump-match", "action-relay"]]) {
      const out = compose(pair, { position: "middle", duration: "short", intensity: "natural" })
      expect(out, pair.join("+")).toBe(compose(pair, { position: "middle" }))
      expect(count(out, INSTANT_CUT_CLAUSE)).toBe(1)
      expect(out).not.toContain(BLEND)
    }
  })

  it("a cut beside a non-cut is unchanged: no cut sentence, and the duration and intensity clauses stay", () => {
    for (const pair of [["seamless-match", "cross-dissolve"], ["whip-pan", "jump-match"]]) {
      const out = compose(pair, { position: "end", duration: "short", intensity: "natural" })
      expect(out).toBe(
        renderTransitionBases(pair).join(", and ") +
          ", the transition occurs at the end of the clip, lasting approximately 1 second, with natural timing",
      )
      expect(out).not.toContain(INSTANT_CUT_CLAUSE)
      expect(out).not.toContain(BLEND)
    }
  })

  it("a no-op `auto` beside a blendable cut does not stop the blend", () => {
    for (const id of BLENDABLE) {
      for (const pick of [["auto", id], [id, "auto"]]) {
        expect(compose(pick, { position: "middle", duration: "short" }), pick.join("+")).toBe(
          compose(id, { position: "middle", duration: "short" }),
        )
      }
    }
  })
})

describe("blended cut — what stays a hard cut", () => {
  it.each(FIXTURE.hardCut)("today's text: $key", ({ ids, timing, scopes, text }) => {
    expect(text).not.toContain(BLEND)
    for (const scope of scopes) expect(compose(ids, timing, scope), scope).toBe(text)
  })

  it("the two rows at Auto, Instant, Medium and Long render the hard cut, at every position and intensity", () => {
    for (const id of BLENDABLE) {
      for (const duration of [undefined, "auto", "instant", "medium", "long"]) {
        for (const position of POSITIONS) for (const intensity of INTENSITIES) for (const scope of SCOPES) {
          const out = compose(id, levers(position, duration, intensity), scope)
          expect(out, `${id} ${position} ${duration} ${intensity} ${scope}`).toBe(compose(id, levers(position), scope))
          expect(count(out, INSTANT_CUT_CLAUSE)).toBe(1)
          expect(out).not.toContain(BLEND)
        }
      }
    }
  })

  it("the other six cuts render the hard cut at every duration, Short included", () => {
    for (const id of OTHER_CUTS) {
      for (const duration of DURATIONS) {
        for (const position of POSITIONS) for (const intensity of INTENSITIES) for (const scope of SCOPES) {
          const out = compose(id, levers(position, duration, intensity), scope)
          expect(out, `${id} ${position} ${duration} ${intensity} ${scope}`).toBe(compose(id, levers(position), scope))
          expect(count(out, INSTANT_CUT_CLAUSE)).toBe(1)
          expect(out).not.toContain(BLEND)
        }
      }
    }
  })

  it("a non-cut never carries the blend sentence, and keeps its Short duration clause", () => {
    for (const id of NON_CUTS) {
      const out = compose(id, { duration: "short" })
      expect(out, id).toContain("lasting approximately 1 second")
      expect(out, id).not.toContain(BLEND)
    }
  })

  it("a blended cut carries no span, duration or intensity clause", () => {
    for (const pick of [...BLENDABLE.map((id) => [id]), ["seamless-match", "jump-match"], ["jump-match", "seamless-match"]]) {
      for (const position of POSITIONS) for (const intensity of INTENSITIES) for (const scope of SCOPES) {
        const out = compose(pick, levers(position, "short", intensity), scope)
        expect(count(out, BLEND), `${pick} ${position} ${intensity} ${scope}`).toBe(1)
        for (const word of ["spans", "lasting", "timing", "energy", "flourish"]) expect(out).not.toContain(word)
      }
    }
  })
})

describe("blended cut — the direction fold never blends", () => {
  it("renderTransitionBases keeps the hard cut for every single and ordered pair", () => {
    const picks: string[][] = ALL_IDS.map((id) => [id])
    for (const a of ALL_IDS) for (const b of ALL_IDS) if (a !== b) picks.push([a, b])
    for (const pick of picks) {
      const bases = renderTransitionBases(pick)
      expect(bases.join(" ")).not.toContain(BLEND)
      expect(bases.join(", and ")).toBe(compose(pick, undefined))
    }
  })

  it("the server fold of `direction.transition` keeps the hard cut", () => {
    for (const id of BLENDABLE) {
      const [fold] = renderDirectionHints({ transition: id }, { surface: "video" })
      expect(fold).toBe(compose(id, undefined))
      expect(fold).toContain(INSTANT_CUT_CLAUSE)
      expect(fold).not.toContain(BLEND)
    }
  })
})

describe("blended cut — the rule holds for every row and lever (self-consistency sweep)", () => {
  /** A pick blends iff every contributing id is a blendable cut and the duration is `short`. */
  const blends = (pick: readonly string[], duration: string | undefined) =>
    duration === "short" &&
    pick.filter((id) => getTransitionTerm(id).length > 0).every((id) => (BLENDABLE as readonly string[]).includes(id)) &&
    pick.some((id) => getTransitionTerm(id).length > 0)

  function check(pick: readonly string[], timing: TransitionTiming, scope: TransitionHintScope) {
    const out = compose(pick, timing, scope)
    const label = `${pick.join("+")} ${JSON.stringify(timing)} ${scope}`
    const allCuts = isInstantTransition(pick.filter((id) => getTransitionTerm(id).length > 0))
    const { duration, ...rest } = timing
    if (blends(pick, duration)) {
      // Exactly the hard cut with its anti-blend sentence swapped, once.
      const hard = compose(pick, rest, scope)
      expect(count(hard, INSTANT_CUT_CLAUSE), label).toBe(1)
      expect(out, label).toBe(hard.replace(INSTANT_CUT_CLAUSE, BLEND))
    } else {
      expect(out, label).not.toContain(BLEND)
      // On an all-cut pick a duration never changes anything else.
      if (allCuts) expect(out, label).toBe(compose(pick, rest, scope))
    }
  }

  it("every row alone, at every position, duration and intensity, in both scopes", () => {
    for (const id of ALL_IDS) {
      for (const position of POSITIONS) for (const duration of DURATIONS) for (const intensity of INTENSITIES) {
        for (const scope of SCOPES) check([id], levers(position, duration, intensity), scope)
      }
    }
  })

  it("every ordered pair, at the levers that decide a blend", () => {
    for (const a of ALL_IDS) for (const b of ALL_IDS) {
      if (a === b) continue
      for (const duration of [undefined, "short", "medium"]) for (const position of [undefined, "middle", "full"]) {
        check([a, b], levers(position, duration, "natural"), "clip")
      }
    }
  })
})
