import { describe, it, expect } from "vitest"
import { resolveMotionPanels } from "../resolve-motion-panels.js"
import { buildMotionBackgroundSections } from "../build-sections.js"
import { sheetSlots } from "../compositor.js"
import { MOTION_COLUMN } from "@nodaro/shared"
import type { SheetFlavour } from "@nodaro/shared"

const fl: SheetFlavour = {
  outputFormat: "motion",
  withText: true,
  showLabels: true,
  aspect: "landscape",
  background: "grey",
}

describe("MOTION_COLUMN", () => {
  it("maps each entity to its flat motion column", () => {
    expect(MOTION_COLUMN.character).toBe("motions")
    expect(MOTION_COLUMN.object).toBe("motion_clips")
    expect(MOTION_COLUMN.location).toBe("atmosphere_motions")
  })
})

describe("resolveMotionPanels", () => {
  it("matches motion clips in the flat motion bucket by name===variant", () => {
    const r = resolveMotionPanels(
      "character",
      [
        {
          kind: "expression-board",
          entries: [
            { kind: "preset", variant: "smile" },
            { kind: "preset", variant: "angry" },
          ],
        },
      ],
      fl,
      [{ name: "smile", url: "v/smile.mp4" }],
    )
    expect(r.present.map((p) => p.url)).toEqual(["v/smile.mp4"])
    expect(r.missing).toHaveLength(1)
  })
})

describe("motion background slot alignment (the Nth clip → Nth slot invariant)", () => {
  const sections = [
    { kind: "header" as const, title: "KAIA" },
    {
      kind: "expression-board" as const,
      entries: [
        { kind: "preset" as const, variant: "a" },
        { kind: "preset" as const, variant: "b" },
        { kind: "preset" as const, variant: "c" },
        { kind: "preset" as const, variant: "d" },
      ],
    },
  ]
  // Only b and d have motion clips (a sparse, GAPPED motion set) — c0/c3 of the plan.
  const motionBucket = [
    { name: "b", url: "v/b.mp4" },
    { name: "d", url: "v/d.mp4" },
  ]

  it("emits exactly one slot per PRESENT motion clip, in clip order — independent of plan gaps", () => {
    const { present } = resolveMotionPanels("character", sections, fl, motionBucket)
    const clipUrls = present.map((p) => p.url)
    expect(clipUrls).toEqual(["v/b.mp4", "v/d.mp4"])

    const bgSections = buildMotionBackgroundSections(sections, fl, "character", {
      palette: [],
      motionBucket,
    })
    const slots = sheetSlots({
      skin: "studio",
      aspect: "landscape",
      sections: bgSections,
      slotsMode: "background",
    })
    // Slot count MUST equal the present-clip count (2), NOT the planned count (4),
    // so composeMotionSheet's positional pairing lands clip N in slot N.
    expect(slots).toHaveLength(clipUrls.length)
    expect(slots[1].x).toBeGreaterThan(slots[0].x)
  })
})
