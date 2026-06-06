import { describe, it, expect } from "vitest"
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Guard: every Supabase migration must have a UNIQUE numeric version prefix.
 *
 * `supabase db push` records each migration by its `version` (the numeric prefix) as the primary
 * key of `supabase_migrations.schema_migrations`. Two files sharing a prefix (e.g. two `192_*.sql`)
 * make the second push fail with `duplicate key value violates unique constraint
 * "schema_migrations_pkey"`, which silently breaks production migrations on every deploy. This test
 * fails fast at PR time instead — so a version collision is caught before it reaches main.
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations")

describe("supabase migrations", () => {
  it("have unique version prefixes (no two files share a number)", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
    const byVersion = new Map<string, string[]>()
    for (const f of files) {
      const m = /^(\d+)_/.exec(f)
      expect(m, `migration "${f}" must start with a numeric version prefix (NNN_...)`).toBeTruthy()
      const version = m![1]
      const arr = byVersion.get(version) ?? []
      arr.push(f)
      byVersion.set(version, arr)
    }
    const dupes = [...byVersion.entries()].filter(([, fs]) => fs.length > 1)
    expect(
      dupes,
      `duplicate migration version prefixes: ${dupes.map(([v, fs]) => `${v} → ${fs.join(", ")}`).join("; ")}`,
    ).toEqual([])
  })
})
