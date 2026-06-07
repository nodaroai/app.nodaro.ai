import { describe, it, expect } from "vitest"
import { BOARD_VARIANTS, DEFAULT_SECTIONS, SECTION_BOARD } from "../catalog.js"
import { planSheetPanels } from "../panel-plan.js"
import { SHEET_TYPES, SECTION_KINDS, type EntityKind, type SheetFlavour } from "../types.js"

const ENTITIES: EntityKind[] = ["character", "object", "location"]
const fl: SheetFlavour = { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey" }

describe("no-drift: planned preset panels are real board variants", () => {
  it("every default full-reference plans without throwing and only uses known variants", () => {
    for (const e of ENTITIES) for (const t of SHEET_TYPES) {
      const panels = planSheetPanels(e, DEFAULT_SECTIONS[e][t], fl)
      for (const p of panels) {
        if (p.custom) continue
        expect(BOARD_VARIANTS[e][p.board], `${e}/${t} ${p.board}`).toContain(p.variant)
      }
    }
  })
  it("SECTION_BOARD has an entry for every SectionKind (no kind missing)", () => {
    // Guards `resolveBoard`: adding a SectionKind without a SECTION_BOARD entry
    // would make `SECTION_BOARD[kind]` undefined and silently mis-resolve. Iterate
    // the full SECTION_KINDS list — not just the ones used in defaults — so a new
    // kind can't slip in unmapped.
    for (const k of SECTION_KINDS) {
      expect(SECTION_BOARD, k).toHaveProperty(k)
    }
  })
})
