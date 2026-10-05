/**
 * `transition-levers.ts` reads WHICH levers a transition pick takes off the catalog's own flags
 * (`instant`, `blendable`, `blendsCut`), over the ids the composer reads, and what a change of the pick writes.
 * `@nodaro/prompts` is real.
 */
import { describe, it, expect } from "vitest"
import { TRANSITIONS, TRANSITION_DURATIONS, TRANSITION_INTENSITIES, TRANSITION_POSITIONS } from "@nodaro/prompts"
import { transitionLeverValue, transitionLevers, transitionPickKind, transitionPickPatch } from "../transition-levers"
// GENERATED, not hand-written: Studio's own `pickTransition` over every case below; see the cross-check at the end.
import STUDIO_PICK_TRANSITION from "./fixtures/studio-pick-transition.json"

const ids = (rows: ReadonlyArray<{ id: string }>) => rows.map((o) => o.id)

describe("transitionPickKind", () => {
  it("every catalog row alone: the cuts by their flags, everything else timed", () => {
    for (const t of TRANSITIONS) {
      const expected = t.id === "auto" || !t.instant ? "timed" : t.blendable ? "blendable-cut" : "cut"
      expect(transitionPickKind(t.id), t.id).toBe(expected)
    }
    expect(TRANSITIONS.filter((t) => transitionPickKind(t.id) === "blendable-cut").map((t) => t.id)).toEqual([
      "seamless-match",
      "jump-match",
    ])
  })

  it("a pick blends only when every contributing id does; a cut with a non-cut is timed", () => {
    expect(transitionPickKind(["seamless-match", "jump-match"])).toBe("blendable-cut")
    expect(transitionPickKind(["auto", "jump-match"])).toBe("blendable-cut")
    expect(transitionPickKind(["seamless-match", "match-cut"])).toBe("cut")
    expect(transitionPickKind(["match-cut", "smash-cut"])).toBe("cut")
    expect(transitionPickKind(["jump-match", "cross-dissolve"])).toBe("timed")
  })

  it("nothing picked, or nothing usable, is timed (today's panel)", () => {
    for (const value of [undefined, "", "auto", [], ["auto"], "nonexistent", 42]) {
      expect(transitionPickKind(value), JSON.stringify(value)).toBe("timed")
    }
  })
})

describe("transitionLevers", () => {
  it("timed: the three catalogs, every row", () => {
    expect(transitionLevers("timed").map((l) => [l.field, l.variant, ids(l.options)])).toEqual([
      ["position", "timing", ids(TRANSITION_POSITIONS)],
      ["duration", "timing", ids(TRANSITION_DURATIONS)],
      ["intensity", "timing", ids(TRANSITION_INTENSITIES)],
    ])
  })

  it("cut: Position without Full, nothing else", () => {
    expect(transitionLevers("cut").map((l) => [l.field, l.variant, ids(l.options)])).toEqual([
      ["position", "timing", ["auto", "start", "middle", "end"]],
    ])
  })

  it("blendable cut: Position without Full, and Blend = auto (hard cut) + the steps that blend a cut", () => {
    expect(transitionLevers("blendable-cut").map((l) => [l.field, l.variant, ids(l.options)])).toEqual([
      ["position", "timing", ["auto", "start", "middle", "end"]],
      ["duration", "blend", ["auto", "short"]],
    ])
  })
})

describe("transitionLeverValue", () => {
  const [position, blend] = transitionLevers("blendable-cut")
  const [timedPosition] = transitionLevers("timed")

  it("on a cut, a value the lever does not offer shows as auto", () => {
    expect(transitionLeverValue("blendable-cut", position!, "full")).toBe("auto")
    expect(transitionLeverValue("blendable-cut", position!, "middle")).toBe("middle")
    expect(transitionLeverValue("blendable-cut", blend!, "short")).toBe("short")
    for (const d of ["medium", "long", "instant", "auto", undefined]) {
      expect(transitionLeverValue("blendable-cut", blend!, d), String(d)).toBe("auto")
    }
    expect(transitionLeverValue("cut", position!, "full")).toBe("auto")
  })

  it("on a timed pick, the stored value shows as stored", () => {
    expect(transitionLeverValue("timed", timedPosition!, "full")).toBe("full")
    expect(transitionLeverValue("timed", timedPosition!, undefined)).toBe("auto")
  })
})

describe("transitionPickPatch: what a change of the pick writes (Studio's tile click)", () => {
  const DROP = { duration: undefined, intensity: undefined }
  const label = (previous: unknown, next: unknown, duration: unknown) =>
    `${JSON.stringify(previous)} -> ${JSON.stringify(next)}, stored duration ${JSON.stringify(duration)}`
  // Picks that blend at Short: one blendable row, both, or one beside the no-op `auto`.
  const BLENDABLE: ReadonlyArray<string | string[]> = [
    "seamless-match",
    "jump-match",
    ["seamless-match"],
    ["jump-match", "seamless-match"],
    ["auto", "seamless-match"],
    ["jump-match", "auto"],
  ]
  // All-cut picks that never blend: a cut that does not blend, two of them, or a blendable cut picked with one.
  const NOT_BLENDING: ReadonlyArray<string | string[]> = [
    "match-cut",
    "none",
    "jump-cut",
    ["match-cut", "smash-cut"],
    ["seamless-match", "match-cut"],
    ["auto", "action-relay"],
  ]
  const DURATIONS: ReadonlyArray<unknown> = [undefined, "auto", "instant", "short", "medium", "long", "not-a-step", 1]

  it("from a non-cut, a cut with a non-cut, or nothing, into a cut: clears Duration and Intensity, whatever is stored", () => {
    for (const previous of ["cross-dissolve", ["match-cut", "cross-dissolve"], ["cross-dissolve", "seamless-match"], undefined, "", [], "auto", ["auto"], "not-a-row"]) {
      for (const next of [...BLENDABLE, ...NOT_BLENDING]) {
        for (const duration of DURATIONS) {
          expect(transitionPickPatch(previous, next, duration), label(previous, next, duration)).toEqual({ transition: next, ...DROP })
        }
      }
    }
  })

  describe("cut to cut: the Intensity is never touched; the Duration stays only as a Short between two picks that blend", () => {
    it("blendable to blendable with Short (the same pick again included): writes only the pick", () => {
      for (const previous of BLENDABLE) {
        for (const next of BLENDABLE) {
          const patch = transitionPickPatch(previous, next, "short")
          expect(patch, label(previous, next, "short")).toEqual({ transition: next })
          expect(Object.keys(patch)).toEqual(["transition"])
        }
      }
    })

    it("blendable to blendable with any other Duration, or none: clears the Duration, not the Intensity", () => {
      for (const previous of BLENDABLE) {
        for (const next of BLENDABLE) {
          for (const duration of DURATIONS.filter((d) => d !== "short")) {
            const patch = transitionPickPatch(previous, next, duration)
            expect(patch, label(previous, next, duration)).toEqual({ transition: next, duration: undefined })
            expect(Object.keys(patch).sort()).toEqual(["duration", "transition"])
          }
        }
      }
    })

    it("from or into a pick that never blends: clears the Duration, Short included, not the Intensity", () => {
      const pairs = [
        ...NOT_BLENDING.flatMap((previous) => BLENDABLE.map((next) => [previous, next] as const)),
        ...BLENDABLE.flatMap((previous) => NOT_BLENDING.map((next) => [previous, next] as const)),
        ...NOT_BLENDING.flatMap((previous) => NOT_BLENDING.map((next) => [previous, next] as const)),
      ]
      for (const [previous, next] of pairs) {
        for (const duration of DURATIONS) {
          const patch = transitionPickPatch(previous, next, duration)
          expect(patch, label(previous, next, duration)).toEqual({ transition: next, duration: undefined })
          expect(Object.keys(patch).sort()).toEqual(["duration", "transition"])
        }
      }
    })

    it("the owner's case: Match Cut + Short (a hard cut) switched to Seamless Match stays a hard cut", () => {
      expect(transitionPickPatch("match-cut", "seamless-match", "short")).toEqual({ transition: "seamless-match", duration: undefined })
      expect(transitionPickPatch("seamless-match", "jump-match", "short")).toEqual({ transition: "jump-match" })
    })

    it("an unknown id beside a row reads as the row alone (the composer drops it too)", () => {
      expect(transitionPickKind(["not-a-row", "seamless-match"])).toBe("blendable-cut")
      expect(transitionPickPatch(["not-a-row", "seamless-match"], "jump-match", "short")).toEqual({ transition: "jump-match" })
      expect(transitionPickPatch(["not-a-row", "match-cut"], "jump-match", "short")).toEqual({ transition: "jump-match", duration: undefined })
      expect(transitionPickPatch("seamless-match", ["jump-match", "not-a-row"], "short")).toEqual({ transition: ["jump-match", "not-a-row"] })
    })
  })

  it("into a pick that is not all cuts, or clearing the pick: writes only the pick, whatever is stored", () => {
    const cases: Array<[unknown, string | string[] | undefined]> = [
      ["seamless-match", "cross-dissolve"],
      ["seamless-match", ["seamless-match", "cross-dissolve"]],
      ["match-cut", "whip-pan"],
      [["seamless-match", "jump-match"], "auto"],
      ["cross-dissolve", "whip-pan"],
      [undefined, "whip-pan"],
      ["not-a-row", "cross-dissolve"],
      ["seamless-match", "not-a-row"],
      ["cross-dissolve", undefined],
      ["seamless-match", undefined],
      ["match-cut", []],
      [undefined, undefined],
    ]
    for (const [previous, next] of cases) {
      for (const duration of DURATIONS) {
        const patch = transitionPickPatch(previous, next, duration)
        expect(patch, label(previous, next, duration)).toEqual({ transition: next })
        expect(Object.keys(patch)).toEqual(["transition"])
      }
    }
  })
})

/**
 * THE CROSS-CHECK AGAINST STUDIO (owner ruling Q-10: the canvas aligns with Studio's tile click).
 *
 * `fixtures/studio-pick-transition.json` is GENERATED, not hand-written: every result in it is the return value of
 * Studio's own `pickTransition` (the studio codec, `packages/studio-production/src/transition.ts`; the commit and the
 * file's blob are in its `source`), computed by a script kept with the test-round evidence outside this repo. It
 * covers every single-id switch among the eight cuts, between each cut and three non-cuts (`auto` among them), and
 * from nothing, under every stored duration (unset, `auto`, `instant`, `short`, `medium`, `long`) and intensity
 * (unset, `natural`). The canvas must keep or clear the Duration and the Intensity in exactly the same cases.
 * Studio picks one id and the canvas up to two, so the table runs three times: each id alone, as a one-element
 * array, and beside the no-op `auto`. (Studio also drops a stored Position `full` on a switch into a cut; the canvas
 * does not, so the table leaves Position out.) Regenerate the table, never edit it.
 */
describe("transitionPickPatch keeps or clears Duration and Intensity exactly where Studio's pickTransition does", () => {
  type Row = readonly [string | null, string, ReadonlyArray<string>]
  const rows = STUDIO_PICK_TRANSITION.rows as unknown as ReadonlyArray<Row>
  const combos = STUDIO_PICK_TRANSITION.combos.map((c) => c.split("/").map((v) => (v === "-" ? undefined : v)))
  const result = (previous: string | null, next: string, combo: string) =>
    rows.find((r) => r[0] === previous && r[1] === next)![2][STUDIO_PICK_TRANSITION.combos.indexOf(combo)]

  it("the table is Studio's pickTransition, over the cases above, with both outcomes in it", () => {
    expect(STUDIO_PICK_TRANSITION.source.function).toBe("pickTransition")
    expect(STUDIO_PICK_TRANSITION.combos).toEqual(["-/-", "-/natural", "auto/-", "auto/natural", "instant/-", "instant/natural", "short/-", "short/natural", "medium/-", "medium/natural", "long/-", "long/natural"])
    const cuts = TRANSITIONS.filter((t) => t.instant === true).map((t) => t.id)
    expect(cuts).toHaveLength(8)
    for (const previous of [null, "auto", "cross-dissolve", "whip-pan", ...cuts]) {
      for (const next of ["auto", "cross-dissolve", "whip-pan", ...cuts]) {
        expect(rows.filter((r) => r[0] === previous && r[1] === next), `${previous} -> ${next}`).toHaveLength(1)
      }
    }
    expect(rows).toHaveLength(12 * 11)
    for (const r of rows) expect(r[2], `${r[0]} -> ${r[1]}`).toHaveLength(12)
    // Not a degenerate table (a catalog without the blend flags would clear every Short): both outcomes are in it.
    expect(result("seamless-match", "jump-match", "short/natural")).toBe("short/natural")
    expect(result("match-cut", "seamless-match", "short/natural")).toBe("-/natural")
    expect(result("cross-dissolve", "seamless-match", "short/natural")).toBe("-/-")
    expect(result("jump-match", "cross-dissolve", "medium/natural")).toBe("medium/natural")
  })

  const SHAPES: ReadonlyArray<readonly [string, (id: string | null) => string | string[] | undefined]> = [
    ["each id alone", (id) => id ?? undefined],
    ["each id as a one-element array", (id) => (id === null ? undefined : [id])],
    ["each id beside the no-op auto", (id) => (id === null ? undefined : id === "auto" ? id : ["auto", id])],
  ]

  it.each(SHAPES)("%s: the same Duration and Intensity in every case", (_, shape) => {
    const mismatches: string[] = []
    for (const [previous, next, results] of rows) {
      combos.forEach(([duration, intensity], k) => {
        const before: Record<string, unknown> = {
          transition: shape(previous),
          ...(duration === undefined ? {} : { duration }),
          ...(intensity === undefined ? {} : { intensity }),
        }
        const after = { ...before, ...transitionPickPatch(before.transition, shape(next), before.duration) }
        const canvas = `${(after.duration as string | undefined) ?? "-"}/${(after.intensity as string | undefined) ?? "-"}`
        if (canvas !== results[k]) {
          mismatches.push(`${previous} -> ${next}, stored ${STUDIO_PICK_TRANSITION.combos[k]}: Studio ${results[k]}, canvas ${canvas}`)
        }
      })
    }
    expect(mismatches, `${mismatches.length} cases differ from Studio; the first:\n${mismatches.slice(0, 10).join("\n")}`).toEqual([])
  })
})
