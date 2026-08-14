/**
 * KIE credit snapshots — fractional-balance regression guards.
 *
 * Incident 2026-08-14: KIE started returning fractional account balances
 * (e.g. 2485.98). `kie_credit_snapshots.credits` was INTEGER (migration 074),
 * so every hourly `recordKieCreditSnapshot()` insert failed with
 * `invalid input syntax for type integer: "2485.98"` and the
 * /admin/kie-credits history silently flatlined.
 *
 * Two guards:
 *   1. A migration must (re)declare the column as numeric — catches the fix
 *      being reverted or the migration file being renamed away.
 *   2. The snapshot writer must pass the balance through UNROUNDED — the
 *      tempting "fix" of rounding on insert would silently degrade the data
 *      instead of storing what KIE actually reports.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn()

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({ insert: insertMock })),
  },
}))

vi.mock("../../../lib/config.js", () => ({
  config: { KIE_API_KEY: "test-key" },
}))

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "..", "supabase/migrations")

describe("kie_credit_snapshots.credits column type", () => {
  it("a migration converts the column to numeric (KIE balances are fractional)", () => {
    const sql = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
      .join("\n")
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+kie_credit_snapshots\s+ALTER\s+COLUMN\s+credits\s+TYPE\s+numeric/i,
    )
  })
})

describe("recordKieCreditSnapshot", () => {
  beforeEach(() => {
    insertMock.mockReset()
    insertMock.mockResolvedValue({ error: null })
  })

  it("inserts the fractional balance exactly as KIE reports it (no rounding)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 200, msg: "success", data: 2485.98 }),
      }),
    )

    const { recordKieCreditSnapshot } = await import("../admin-kie-credits.js")
    const result = await recordKieCreditSnapshot()

    expect(result).toEqual({ credits: 2485.98 })
    expect(insertMock).toHaveBeenCalledWith({ credits: 2485.98 })

    vi.unstubAllGlobals()
  })
})
