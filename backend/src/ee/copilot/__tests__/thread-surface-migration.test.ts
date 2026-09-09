/**
 * Migration 404 — a second kind of live thread on one workflow.
 *
 * Text-level pins for the properties that make this migration SAFE to apply to
 * a table that is already serving traffic. The order is the whole point: the
 * wider unique index has to EXIST before the narrower one is dropped, or there
 * is a moment in which a workflow accepts two canvas threads and the invariant
 * the code relies on is simply not there.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const MIGRATIONS = join(import.meta.dirname, "../../../../../supabase/migrations")
const RAW = readFileSync(join(MIGRATIONS, "404_copilot_thread_surface.sql"), "utf8")
/** SQL with comments stripped, so no pin can be satisfied by prose. */
const SQL = RAW.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")

const OLD_INDEX = "copilot_threads_active_per_workflow"
const NEW_INDEX = "copilot_threads_active_per_workflow_surface"

describe("404 — the column", () => {
  it("is added tolerantly, defaults to the canvas surface and can never be null", () => {
    expect(SQL).toContain("ALTER TABLE public.copilot_threads")
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'workflow'/)
  })

  it("admits exactly the two surfaces", () => {
    expect(SQL).toMatch(/CHECK \(surface IN \('workflow', 'studio'\)\)/)
  })
})

describe("404 — uniqueness never lapses", () => {
  it("keys the live thread on the surface as well as the user and the workflow", () => {
    expect(SQL).toMatch(
      new RegExp(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${NEW_INDEX}\\s+ON public\\.copilot_threads \\(user_id, workflow_id, surface\\)\\s+WHERE archived_at IS NULL`,
      ),
    )
  })

  it("creates the wider index BEFORE dropping the narrower one", () => {
    const created = SQL.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS ${NEW_INDEX}`)
    const dropped = SQL.indexOf(`DROP INDEX IF EXISTS public.${OLD_INDEX};`)
    expect(created).toBeGreaterThan(-1)
    expect(dropped).toBeGreaterThan(-1)
    expect(created).toBeLessThan(dropped)
  })

  it("drops the narrower index by its own name, not the new one's", () => {
    // `DROP INDEX … copilot_threads_active_per_workflow` is a prefix of the new
    // name; the trailing semicolon is what keeps this pin honest.
    expect(SQL).not.toContain(`DROP INDEX IF EXISTS public.${NEW_INDEX}`)
  })
})

describe("404 — the allocator lock", () => {
  it("bumps .sequence at least to 404 (later migrations move it further)", () => {
    // A floor, not an equality: the shared migration-versions test already
    // enforces ".sequence == the highest migration".
    const sequence = readFileSync(join(MIGRATIONS, ".sequence"), "utf8").trim()
    expect(Number(sequence)).toBeGreaterThanOrEqual(404)
  })
})
