import { describe, it, expect } from "vitest"
import { BOARD_TO_COLUMN, BOARD_VARIANTS } from "../catalog.js"
import type { EntityKind } from "../types.js"

const ENTITIES: EntityKind[] = ["character", "object", "location"]
describe("BOARD_TO_COLUMN", () => {
  it("maps character boards to DB columns", () => {
    expect(BOARD_TO_COLUMN.character.headAngles).toBe("angles")
    expect(BOARD_TO_COLUMN.character.bodyAngles).toBe("body_angles")
    expect(BOARD_TO_COLUMN.character.detail).toBe("detail_closeups")
    expect(BOARD_TO_COLUMN.character.wardrobe).toBe("outfit_variations")
  })
  it("maps location camelCase boards to snake_case columns", () => {
    expect(BOARD_TO_COLUMN.location.timeOfDay).toBe("time_of_day")
    expect(BOARD_TO_COLUMN.location.detail).toBe("detail_closeups")
  })
  it("every board in BOARD_VARIANTS has a column (no orphan)", () => {
    for (const e of ENTITIES) for (const b of Object.keys(BOARD_VARIANTS[e])) expect(BOARD_TO_COLUMN[e][b], `${e}/${b}`).toBeDefined()
  })
})
