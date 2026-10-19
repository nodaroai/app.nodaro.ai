import { describe, it, expect, vi } from "vitest"

const db = vi.hoisted(() => ({ from: vi.fn() }))
const avail = vi.hoisted(() => ({ loaded: true, calls: 0 }))
vi.mock("@/lib/config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/config.js")>()), hasCredits: () => true }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: db.from } }))
vi.mock("@/lib/availability-override.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/availability-override.js")>()),
  loadAvailabilityOverridesForScript: async () => {
    avail.calls++
    return avail.loaded
  },
}))

import { appMaxColumns, parseRangeArgs, planRangeWrite, runRangeBackfill, templateMaxColumns } from "../backfill-listing-range.js"

/**
 * The "up to" backfill (migration 517): each published app / component version
 * and template gets the columns a republish would store, from its own
 * snapshot — written only where they differ (a second run writes nothing).
 */
const ceiling = { preview: 300, final: 30, previewPerMinute: 6, finalPerMinute: 1, previewPerItem: 9, finalPerItem: 2 }

describe("backfill-listing-range — pure parts", () => {
  it("an app's columns are its ceiling priced with its own fee", () => {
    const cols = appMaxColumns({ monetization_enabled: true, monetization_flat_fee: 5, monetization_percent: 20 }, ceiling)
    expect(cols.base_max_estimated_credits).toBe(300)
    expect(cols.max_estimated_credits).toBeGreaterThan(330)
    expect(cols.max_per_item_credits).toBeGreaterThan(9)
  })

  it("a template's are the ceiling's two parts, unmarked", () => {
    expect(templateMaxColumns(ceiling)).toEqual({ max_estimated_credits: 330, max_estimated_per_minute_credits: 7 })
  })

  it("writes only what differs", () => {
    const next = { max_estimated_credits: 330, max_estimated_per_minute_credits: 7 }
    expect(planRangeWrite({ max_estimated_credits: null, max_estimated_per_minute_credits: null }, next)).toEqual(next)
    expect(planRangeWrite({ ...next }, next)).toBeNull()
  })

  it("is a dry run unless --apply", () => {
    expect(parseRangeArgs([]).apply).toBe(false)
    expect(parseRangeArgs(["--apply", "--include-templates"])).toMatchObject({ apply: true, includeTemplates: true })
  })
})

describe("backfill-listing-range — prices as a general user's run", () => {
  it("refuses when the deployment's availability cannot be read, before any listing is read: a cold cache reads a hidden Speaker Map as released", async () => {
    avail.loaded = false
    avail.calls = 0
    db.from.mockClear()
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(await runRangeBackfill({ apply: false, includeTemplates: false } as never)).toEqual({ ok: false, written: 0, rows: 0 })
    expect(avail.calls).toBe(1)
    expect(db.from).not.toHaveBeenCalled()
    expect(error.mock.calls.flat().join(" ")).toContain("Admin → Availability")
    error.mockRestore()
    avail.loaded = true
  })
})
