import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
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

  /**
   * THE ALLOCATOR (2026-08-18): the uniqueness test above catches a collision
   * only AFTER both PRs merge — it fired twice in one night (324 taken by
   * #727+#728, then again by #729) because two parallel PRs each picked "next
   * free number" against the dev they branched from, and each PR's own CI ran
   * green against its own merge ref. `.sequence` turns that silent race into a
   * MERGE CONFLICT: every migration PR must bump the single-line
   * `supabase/migrations/.sequence` to its new highest number, so two PRs
   * allocating the same number now conflict on the same line and git forces
   * the second one to rebase — and renumber — before it can land.
   */
  it(".sequence equals the highest allocated migration number (bump it in the same PR as your migration)", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
    const max = Math.max(...files.map((f) => Number(/^(\d+)_/.exec(f)![1])))
    const sequence = readFileSync(join(MIGRATIONS_DIR, ".sequence"), "utf8").trim()
    expect(
      Number(sequence),
      `supabase/migrations/.sequence says ${sequence} but the highest migration is ${max} — a new migration must bump .sequence in the same PR (this is the anti-parallel-allocation lock)`,
    ).toBe(max)
  })
})
