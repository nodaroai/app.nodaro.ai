import { describe, it, expect } from "vitest"
import { SHEET_PRESETS, PRESET_LABELS, ALA_CARTE_BOARDS, presetEntries } from "../presets.js"
import { planSheetPanels } from "../panel-plan.js"
import { BOARD_VARIANTS } from "../catalog.js"
import type { SheetFlavour } from "../types.js"

const fl: SheetFlavour = { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey" }
const byId = (id: string) => SHEET_PRESETS.find((p) => p.id === id)!

describe("presetEntries", () => {
  it("maps a variant list to ordered preset entries", () => {
    expect(presetEntries(["front", "back"])).toEqual([
      { kind: "preset", variant: "front" },
      { kind: "preset", variant: "back" },
    ])
  })
})

describe("SHEET_PRESETS", () => {
  it("studio-main = 7 curated head+body panels in order", () => {
    const panels = planSheetPanels("character", byId("studio-main").baseSections, fl)
    expect(panels.map((p) => p.variant)).toEqual([
      "front", "left profile", "right profile", "back", // head
      "front", "left profile", "back",                  // body
    ])
  })
  it("studio-extended = 15 panels", () => {
    expect(planSheetPanels("character", byId("studio-extended").baseSections, fl)).toHaveLength(15)
  })
  it("every preset variant exists in its board catalog", () => {
    for (const p of SHEET_PRESETS) {
      for (const s of p.baseSections) {
        const board = s.kind === "head-turnaround" ? "headAngles" : "bodyAngles"
        for (const e of s.entries ?? []) {
          if (e.kind === "preset") expect(BOARD_VARIANTS.character[board]).toContain(e.variant)
        }
      }
    }
  })
  it("each preset has a carrier type + a label", () => {
    expect(byId("studio-main").type).toBe("turnaround")
    expect(byId("studio-extended").type).toBe("full-reference")
    expect(PRESET_LABELS["studio-main"]).toBe("Studio · Main")
    expect(PRESET_LABELS["studio-extended"]).toBe("Studio · Extended")
  })
})

describe("ALA_CARTE_BOARDS", () => {
  it("are appendable sections in the expected order", () => {
    expect(ALA_CARTE_BOARDS.map((b) => b.id)).toEqual(["expressions", "poses", "wardrobe", "detail", "palette"])
    expect(ALA_CARTE_BOARDS[0].section.kind).toBe("expression-board")
    expect(ALA_CARTE_BOARDS.find((b) => b.id === "palette")!.panelCount).toBe(0)
  })
})
