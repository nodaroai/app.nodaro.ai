/**
 * `transition-levers.ts` reads WHICH levers a transition pick takes off the catalog's own flags
 * (`instant`, `blendable`, `blendsCut`), over the ids the composer reads. `@nodaro/prompts` is real.
 */
import { describe, it, expect } from "vitest"
import { TRANSITIONS, TRANSITION_DURATIONS, TRANSITION_INTENSITIES, TRANSITION_POSITIONS } from "@nodaro/prompts"
import { transitionLeverValue, transitionLevers, transitionPickKind } from "../transition-levers"

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
