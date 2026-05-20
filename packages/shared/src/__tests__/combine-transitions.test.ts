import { describe, it, expect } from "vitest"
import {
  COMBINE_TRANSITIONS,
  COMBINE_TRANSITION_IDS,
  COMBINE_TRANSITION_GROUP_ORDER,
  COMBINE_TRANSITION_GROUP_LABELS,
  getCombineTransition,
  resolveXfadeName,
} from "../combine-transitions.js"

describe("COMBINE_TRANSITIONS catalog", () => {
  it("has unique transition ids", () => {
    const ids = COMBINE_TRANSITIONS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("preserves the 5 legacy ids for workflow back-compat", () => {
    const legacy = ["cut", "fade", "dissolve", "dip-to-black", "dip-to-white"]
    for (const id of legacy) {
      expect(COMBINE_TRANSITION_IDS).toContain(id)
    }
  })

  it("flags the right set as `common` (the Common tab)", () => {
    const commonIds = COMBINE_TRANSITIONS.filter((t) => t.common).map((t) => t.id)
    expect(commonIds).toEqual(
      expect.arrayContaining([
        "cut",
        "fade",
        "dissolve",
        "dip-to-black",
        "dip-to-white",
        "wipe-left",
        "wipe-right",
        "slide-left",
        "slide-right",
        "circle-open",
      ]),
    )
  })

  it("assigns every entry to a known group", () => {
    for (const t of COMBINE_TRANSITIONS) {
      expect(COMBINE_TRANSITION_GROUP_ORDER).toContain(t.group)
      expect(COMBINE_TRANSITION_GROUP_LABELS[t.group]).toBeTruthy()
    }
  })

  it("gives every entry a non-empty label and description", () => {
    for (const t of COMBINE_TRANSITIONS) {
      expect(t.label).toBeTruthy()
      expect(t.description.length).toBeGreaterThan(10)
    }
  })

  it("resolveXfadeName returns null for `cut` and the catalog's xfade name otherwise", () => {
    expect(resolveXfadeName("cut")).toBeNull()
    expect(resolveXfadeName("fade")).toBe("fade")
    expect(resolveXfadeName("dissolve")).toBe("dissolve") // not aliased to "fade" anymore
    expect(resolveXfadeName("dip-to-black")).toBe("fadeblack")
    expect(resolveXfadeName("dip-to-white")).toBe("fadewhite")
    expect(resolveXfadeName("wipe-left")).toBe("wipeleft")
    expect(resolveXfadeName("circle-open")).toBe("circleopen")
    expect(resolveXfadeName("squeeze-h")).toBe("squeezeh")
    expect(resolveXfadeName("zoom-in")).toBe("zoomin")
  })

  it("resolveXfadeName throws for unknown ids", () => {
    expect(() => resolveXfadeName("totally-not-a-transition")).toThrow()
  })

  it("getCombineTransition returns undefined for unknown ids", () => {
    expect(getCombineTransition("nope")).toBeUndefined()
    expect(getCombineTransition("fade")?.label).toBe("Fade")
  })
})
