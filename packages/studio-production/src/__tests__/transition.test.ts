import { describe, it, expect } from "vitest"
import {
  composeTransitionHintFromConnections,
  getPickerCatalog,
  getTransitionTerm,
} from "@nodaro/prompts"

import {
  TRANSITION_DURATION_SECONDS,
  durationFits,
  endTransitionClause,
  transitionBetween,
  transitionClause,
  transitionDimensions,
  transitionKind,
  transitionTitle,
  transitionDimensionsFor,
  transitionLeverId,
  transitionLevers,
  transitionMeta,
  transitionSetLevers,
} from "../transition"

/**
 * The transition node's three levers are the platform's CATALOG DIMENSIONS
 * (position · duration · intensity, @nodaro/prompts ≥ 1.9.0), stored as row
 * ids and composed by the platform's own builder — never an app-owned list,
 * never a clause written here. The handoff's words ("On cut", "0.4s",
 * "Subtle") are gone; a value stored under them reads as unset.
 */
describe("transition levers — the catalog's dimensions", () => {
  it("reads the three published scales, each led by the no-op auto row", () => {
    expect(transitionDimensions().map((d) => d.field)).toEqual(["position", "duration", "intensity"])
    for (const d of transitionDimensions()) expect(d.options[0]?.id).toBe("auto")
  })

  it("accepts a lever only as one of its scale's own ids — the handoff's words read as unset", () => {
    expect(transitionLeverId("position", "start")).toBe("start")
    expect(transitionLeverId("position", "On cut")).toBeUndefined()
    expect(transitionLeverId("duration", "0.4s")).toBeUndefined()
    expect(transitionLeverId("intensity", "Subtle")).toBeUndefined()
    expect(transitionLeverId("intensity", "subtle")).toBe("subtle")
    expect(transitionLeverId("position", "auto")).toBeUndefined()
    expect(transitionLeverId("position", undefined)).toBeUndefined()
  })

  it("knows how long every published duration step runs, and agrees with the catalog's own labels", () => {
    // The platform publishes the steps' wording, not a number; the fits-gate
    // needs one. This table is the ONE app-owned fact about the scale, and
    // this test is what keeps it honest: a new step fails here, and a labelled
    // "~Ns" must match. TODO(nodaro): publish `seconds` on the rows.
    const duration = transitionDimensions().find((d) => d.field === "duration")!
    for (const o of duration.options) {
      if (o.id === "auto") continue
      expect(TRANSITION_DURATION_SECONDS[o.id], `${o.id} has no seconds`).toBeTypeOf("number")
      const labelled = /~(\d+(?:\.\d+)?)s/.exec(o.label)
      if (labelled) expect(TRANSITION_DURATION_SECONDS[o.id]).toBe(Number(labelled[1]))
    }
    expect(Object.keys(TRANSITION_DURATION_SECONDS).sort()).toEqual(
      duration.options.filter((o) => o.id !== "auto").map((o) => o.id).sort(),
    )
  })

  it("a duration fits a shot it does not outlast; auto and unknown never 'fit'", () => {
    expect(durationFits("long", 1)).toBe(false)
    expect(durationFits("long", 3)).toBe(true)
    expect(durationFits("short", 1.2)).toBe(true)
    expect(durationFits("instant", 0.1)).toBe(true)
    expect(durationFits("auto", 5)).toBe(false)
    expect(durationFits("0.4s", 5)).toBe(false)
    expect(durationFits(undefined, 5)).toBe(false)
  })

  it("offers a shot only the durations it can hold — auto always, the rest by seconds", () => {
    const ids = (s: number) =>
      transitionDimensionsFor(s).find((d) => d.field === "duration")!.options.map((o) => o.id)
    expect(ids(1.2)).toEqual(["auto", "instant", "short"])
    expect(ids(4)).toEqual(["auto", "instant", "short", "medium", "long"])
    // The other two scales are untouched by the shot's length.
    expect(transitionDimensionsFor(1).find((d) => d.field === "position")!.options).toHaveLength(5)
  })

  it("the levers in effect: validated ids, minus a duration the shot can't hold", () => {
    const t = { id: "cross-dissolve", position: "start", duration: "long", intensity: "crazy" }
    expect(transitionLevers(t, 1)).toEqual({ position: "start", intensity: "crazy" })
    expect(transitionLevers(t, 4)).toEqual({ position: "start", duration: "long", intensity: "crazy" })
    expect(transitionLevers({ id: "cross-dissolve", position: "On cut" }, 4)).toEqual({})
    expect(transitionLevers(undefined, 4)).toEqual({})
  })

  it("the chip's meta reads the catalog's LABELS for the levers in effect", () => {
    const t = { id: "cross-dissolve", position: "start", duration: "long", intensity: "crazy" }
    expect(transitionSetLevers(t, 1)).toEqual(["Start", "Crazy"])
    expect(transitionMeta(t, 4)).toBe("Start · Long (~3s) · Crazy")
    expect(transitionMeta({ id: "cross-dissolve" }, 4)).toBe("Auto")
    expect(transitionMeta(undefined, 4)).toBe("model picks")
  })

  it("the clause is the platform's composition of the pick and the levers in effect", () => {
    const t = { id: "cross-dissolve", position: "start", duration: "short" }
    expect(transitionClause(t, 4)).toBe(
      composeTransitionHintFromConnections("cross-dissolve", [], [], { position: "start", duration: "short" }, "compact"),
    )
    // …which reads as the term plus the catalog's own clauses, verbatim.
    expect(transitionClause(t, 4)).toBe(
      `${getTransitionTerm("cross-dissolve")}, the transition occurs at the opening of the clip, lasting approximately 1 second`,
    )
    // A stranded duration is left out; an unset node contributes nothing.
    expect(transitionClause(t, 0.5)).toBe(
      `${getTransitionTerm("cross-dissolve")}, the transition occurs at the opening of the clip`,
    )
    expect(transitionClause({ id: "auto", position: "start" }, 4)).toBe("")
    expect(transitionClause(undefined, 4)).toBe("")
  })

  it("the wording is the transition node's own, never the effect node's", () => {
    // Same three field names, different scales and different sentences: an
    // effect manifests and persists, a transition occurs and spans.
    const fx = getPickerCatalog("character-fx")
    const hint = (c: typeof fx, field: string) =>
      c?.dimensions?.find((d) => d.field === field)?.options.find((o) => o.id === "start")?.promptHint
    const transition = transitionDimensions().find((d) => d.field === "position")!.options.find((o) => o.id === "start")!
    expect(transition.promptHint).toContain("transition")
    if (hint(fx, "position")) expect(hint(fx, "position")).not.toBe(transition.promptHint)
  })
})

/**
 * A scene's END transition — how its last frames go out, so the clip ends
 * ready to meet the next scene's own opening. Same node, same levers, one
 * difference: the catalog's `position` says WHERE in the clip a transition
 * happens, and this one happens at the END.
 */
describe("the scene's end transition clause", () => {
  it("defaults the position lever to the catalog's own `end` row", () => {
    // The platform's own composition, not a phrase written here: `end`'s
    // promptHint is "the transition occurs at the end of the clip".
    expect(endTransitionClause({ id: "cross-dissolve" }, 10)).toBe(
      composeTransitionHintFromConnections(
        "cross-dissolve",
        [],
        [],
        { position: "end" },
        "compact",
      ),
    )
  })

  it("DEFAULTS it — a chosen position wins, so the chip never claims what the fold drops", () => {
    expect(endTransitionClause({ id: "cross-dissolve", position: "full" }, 10)).toBe(
      composeTransitionHintFromConnections(
        "cross-dissolve",
        [],
        [],
        { position: "full" },
        "compact",
      ),
    )
  })

  it("obeys the same fits-gate: a duration the clip cannot hold is dropped", () => {
    expect(endTransitionClause({ id: "cross-dissolve", duration: "long" }, 1)).toBe(
      endTransitionClause({ id: "cross-dissolve" }, 1),
    )
  })

  it("contributes NOTHING when nothing is chosen — including the catalog's auto row", () => {
    expect(endTransitionClause(undefined, 10)).toBe("")
    expect(endTransitionClause({ id: "auto" }, 10)).toBe("")
  })
})

/** The connector's three labels for the END slot — the boundary AFTER the last
 *  shot, which is not "Shot N → Shot N+1". */
describe("the END slot's labels", () => {
  it("says END, and says which scene goes out", () => {
    expect(transitionKind(2, 1, "end")).toBe("END")
    expect(transitionTitle(2, 1, "end")).toBe(
      "How this scene goes out — its last frames",
    )
    expect(transitionBetween(2, 1, "end")).toBe("Scene 2 → out")
    expect(transitionBetween(2, 0, "end")).toBe("Scene 1 → out")
  })

  it("leaves the IN slot exactly as it was — every existing caller passes none", () => {
    expect(transitionKind(0, 0)).toBe("OPENING")
    expect(transitionKind(1, 0)).toBe("BETWEEN")
    expect(transitionBetween(1, 0)).toBe("Shot 1 → Shot 2")
  })
})
