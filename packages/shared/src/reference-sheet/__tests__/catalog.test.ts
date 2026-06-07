import { describe, it, expect } from "vitest"
import {
  ENTITY_SECTIONS, BOARD_VARIANTS, SECTION_BOARD, DEFAULT_SECTIONS, DETAIL_VARIANTS, WARDROBE_VARIANTS,
} from "../catalog.js"
import { SECTION_KINDS, SHEET_TYPES, type EntityKind } from "../types.js"
import { CHARACTER_ASSET_VARIANTS, OBJECT_ASSET_VARIANTS, LOCATION_ASSET_VARIANTS } from "../../entity-prompts.js"

const ENTITIES: EntityKind[] = ["character", "object", "location"]

describe("catalog invariants", () => {
  it("every entity's available sections are valid SectionKinds", () => {
    for (const e of ENTITIES) for (const s of ENTITY_SECTIONS[e]) expect(SECTION_KINDS).toContain(s)
  })
  it("character board variants come from the canonical CHARACTER_ASSET_VARIANTS", () => {
    expect(BOARD_VARIANTS.character.headAngles).toEqual(CHARACTER_ASSET_VARIANTS.headAngles)
    expect(BOARD_VARIANTS.character.bodyAngles).toEqual(CHARACTER_ASSET_VARIANTS.bodyAngles)
    expect(BOARD_VARIANTS.character.expressions).toEqual(CHARACTER_ASSET_VARIANTS.expressions)
    expect(BOARD_VARIANTS.character.poses).toEqual(CHARACTER_ASSET_VARIANTS.poses)
  })
  it("object & location board variants come from the hoisted lists", () => {
    expect(BOARD_VARIANTS.object.angles).toEqual(OBJECT_ASSET_VARIANTS.angles)
    expect(BOARD_VARIANTS.object.materials).toEqual(OBJECT_ASSET_VARIANTS.materials)
    expect(BOARD_VARIANTS.location.timeOfDay).toEqual(LOCATION_ASSET_VARIANTS.timeOfDay)
    expect(BOARD_VARIANTS.location.angles).toEqual(LOCATION_ASSET_VARIANTS.angles)
  })
  it("new buckets (detail/wardrobe) have starter presets", () => {
    expect(DETAIL_VARIANTS.character.length).toBeGreaterThan(0)
    expect(WARDROBE_VARIANTS.length).toBeGreaterThan(0)
  })
  it("DEFAULT_SECTIONS exists for every (entity, type) and only references available sections", () => {
    for (const e of ENTITIES) for (const t of SHEET_TYPES) {
      const secs = DEFAULT_SECTIONS[e][t]
      expect(Array.isArray(secs)).toBe(true)
      for (const s of secs) expect(ENTITY_SECTIONS[e]).toContain(s.kind)
    }
  })
  it("every board-typed section a default uses resolves to a real board with variants", () => {
    for (const e of ENTITIES) for (const t of SHEET_TYPES) for (const s of DEFAULT_SECTIONS[e][t]) {
      const board = s.board ?? SECTION_BOARD[s.kind]
      if (board === null) continue // structural section (header/palette/notes/scale)
      expect(BOARD_VARIANTS[e][board!], `${e}/${t}/${s.kind} -> ${board}`).toBeDefined()
    }
  })
})
