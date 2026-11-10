/**
 * Every column "Surfaces used" reads must exist on `user_surfaces`: a column
 * the table does not have is a PostgREST 400 that no test with a mocked
 * client would see (online-users-columns.test.ts tells how that shipped once).
 */
import { describe, expect, it } from "vitest"
import { migrationColumnsOf } from "../../../test/migration-columns.js"
import { USER_SURFACE_COLUMNS } from "../user-surfaces-list.js"

describe("Surfaces used reads only columns that exist", () => {
  it("the migration scan itself works", () => {
    // A scan that silently found nothing would pass the case below.
    const columns = migrationColumnsOf("user_surfaces")
    expect(columns.has("touches")).toBe(true)
    expect(columns.has("address")).toBe(false)
  })

  it("every column read exists", () => {
    const existing = migrationColumnsOf("user_surfaces")
    const read = USER_SURFACE_COLUMNS.split(",").map((column) => column.trim())
    expect(read.length).toBeGreaterThan(0)
    for (const column of read) {
      expect(existing.has(column), `user_surfaces.${column}`).toBe(true)
    }
  })
})
