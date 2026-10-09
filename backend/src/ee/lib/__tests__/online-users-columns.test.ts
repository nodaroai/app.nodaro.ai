/**
 * Every column "Signed in now" reads must exist on its table.
 *
 * The lookup is best-effort: when the names cannot be read, the list still
 * answers, with bare user ids in their place. So one column a table does not
 * have (a PostgREST 400) silently turns every name into an id, while every
 * test that mocks supabase stays green. That shipped once: `profiles` has no
 * `display_name`, and production listed ids instead of emails.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { migrationColumnsOf } from "../../../test/migration-columns.js"

const selects: Array<{ table: string; columns: string }> = []

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        selects.push({ table, columns })
        return { in: async () => ({ data: [], error: null }) }
      },
    }),
  },
}))

import { databaseLookup } from "../online-users.js"

afterEach(() => {
  selects.length = 0
})

describe("Signed in now reads only columns that exist", () => {
  it("the migration scan itself works", () => {
    // A scan that silently found nothing would pass every case below.
    const profiles = migrationColumnsOf("profiles")
    expect(profiles.has("email")).toBe(true)
    expect(profiles.has("full_name")).toBe(true)
    expect(profiles.has("display_name")).toBe(false)
    expect(migrationColumnsOf("developer_apps").has("kind")).toBe(true)
  })

  it("the people and app lookups select existing columns only", async () => {
    await databaseLookup.profiles(["u1"])
    await databaseLookup.apps(["a1"])
    expect(selects.map((s) => s.table)).toEqual(["profiles", "developer_apps"])
    for (const { table, columns } of selects) {
      const existing = migrationColumnsOf(table)
      for (const column of columns.split(",").map((c) => c.trim())) {
        expect(existing.has(column), `${table}.${column}`).toBe(true)
      }
    }
  })
})
