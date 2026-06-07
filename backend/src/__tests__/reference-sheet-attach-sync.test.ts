import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { CHARACTER_ATTACH_COLUMNS, OBJECT_ATTACH_COLUMNS, LOCATION_ATTACH_COLUMNS } from "@nodaro/shared"

const here = dirname(fileURLToPath(import.meta.url))
const migration = readFileSync(
  resolve(here, "../../../supabase/migrations/202_reference_sheet_columns_and_pricing.sql"),
  "utf8",
)

describe("reference-sheet attach columns are whitelisted in the append RPCs (migration 202)", () => {
  it("every new character attach column appears in the migration", () => {
    for (const c of ["sheets", "detail_closeups", "outfit_variations"]) {
      expect(CHARACTER_ATTACH_COLUMNS).toContain(c)
      expect(migration).toContain(`'${c}'`)
    }
  })
  it("object + location new columns appear in the migration", () => {
    for (const c of ["sheets", "detail_closeups"]) {
      expect(OBJECT_ATTACH_COLUMNS).toContain(c)
      expect(LOCATION_ATTACH_COLUMNS).toContain(c)
      expect(migration).toContain(`'${c}'`)
    }
  })
})
