// @test-reads-none reads back only the report file the backfill writes to a temp dir in this test
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

// R49 rows: the estimate refuses a graph naming "unpriced-model" (the real estimator is unit-tested in
// workflow-estimate-metered.test.ts); every other row is priced at a fixed split.
const est = vi.hoisted(() => ({ split: { preview: 40, final: 0, previewPerMinute: 0, finalPerMinute: 0 } }))
vi.mock("@/ee/billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/billing/credits.js")>()),
  estimateWorkflowListingCredits: async (nodes: Array<{ data?: { llmModel?: unknown } }>) => {
    if (nodes.some((n) => n.data?.llmModel === "unpriced-model")) {
      throw Object.assign(new Error("unpriced"), { name: "LlmUnpricedModelError", code: "llm_model_unpriced", modelId: "unpriced-model" })
    }
    // A UGC video whose estimate failed for a choice: the listing refuses it (UgcListingUnpricedError).
    // …or failed before any estimate was asked (the video reading): the saved settings, no detail.
    if (nodes.some((n) => (n.data as { ugcReadingFails?: unknown } | undefined)?.ugcReadingFails === true)) {
      throw Object.assign(new Error("Couldn't price this workflow's UGC video at its saved settings. Try publishing again."), {
        name: "UgcListingUnpricedError", code: "ugc_listing_unpriced", choice: "its saved settings",
      })
    }
    if (nodes.some((n) => (n.data as { ugcFails?: unknown } | undefined)?.ugcFails === true)) {
      throw Object.assign(new Error("Couldn't price this workflow's UGC video for a choice its users can make (Hebrew, 60 s). Try publishing again."), {
        name: "UgcListingUnpricedError", code: "ugc_listing_unpriced", choice: "a choice its users can make (Hebrew, 60 s)",
      })
    }
    return est.split
  },
}))
vi.mock("@/lib/canvas-result-ids.js", () => ({ resolveCanvasResultIds: async (nodes: unknown) => nodes }))

import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

/** Each table's rows (one page), and every update written. */
function serveRows(tables: Record<string, Array<Record<string, unknown>>>): Array<{ table: string; payload: unknown }> {
  const updates: Array<{ table: string; payload: unknown }> = []
  db.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "order", "range", "is", "eq"]) chain[m] = () => chain
    chain.update = (payload: unknown) => {
      updates.push({ table, payload })
      return { eq: async () => ({ error: null }) }
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null })
    return chain
  })
  return updates
}

describe("backfill-listing-range — a row with an unpriced metered LLM model (R49)", () => {
  it("is reported and skipped, never written; the rows after it are priced and written", async () => {
    const report = join(tmpdir(), `range-unpriced-${process.pid}.json`)
    const updates = serveRows({
      published_apps: [
        { id: "a1", slug: "unpriced-app", creator_id: "u", publish_type: "app", snapshot_nodes: [{ id: "c", type: "llm-chat", data: { llmModel: "unpriced-model" } }], snapshot_edges: [], snapshot_settings: {} },
        { id: "a2", slug: "priced-app", creator_id: "u", publish_type: "app", snapshot_nodes: [{ id: "g", type: "generate-image", data: {} }], snapshot_edges: [], snapshot_settings: {} },
      ],
      workflow_templates: [
        { id: "t1", slug: "unpriced-tpl", creator_id: "u", snapshot_nodes: [{ id: "c", type: "llm-chat", data: { llmModel: "unpriced-model" } }], snapshot_edges: [], snapshot_settings: {} },
      ],
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const result = await runRangeBackfill({ apply: true, includeTemplates: true, report })
    expect(result).toMatchObject({ ok: true, written: 1 })
    expect(updates.map((u) => u.table)).toEqual(["published_apps"])
    const rows = (JSON.parse(readFileSync(report, "utf8")) as { rows: Array<{ slug: string; skipped?: string; changed: boolean }> }).rows
    expect(rows.find((r) => r.slug === "unpriced-app")).toMatchObject({ skipped: "llm_model_unpriced: unpriced-model", changed: false })
    expect(rows.find((r) => r.slug === "unpriced-tpl")).toMatchObject({ skipped: "llm_model_unpriced: unpriced-model", changed: false })
    expect(rows.find((r) => r.slug === "priced-app")).toMatchObject({ changed: true })
    expect(rows.find((r) => r.slug === "priced-app")).not.toHaveProperty("skipped")
    expect(warn.mock.calls.flat().join(" ")).toContain("unpriced-app · app · SKIPPED (llm_model_unpriced: unpriced-model)")
    warn.mockRestore()
    log.mockRestore()
  })
})

describe("backfill-listing-range — a row whose UGC video could not be priced", () => {
  it("is reported and skipped, never written; the rows after it are priced and written", async () => {
    const report = join(tmpdir(), `range-ugc-unpriced-${process.pid}.json`)
    const updates = serveRows({
      published_apps: [
        { id: "a1", slug: "ugc-app", creator_id: "u", publish_type: "app", snapshot_nodes: [{ id: "s", type: "ugc-script", data: { ugcFails: true } }], snapshot_edges: [], snapshot_settings: {} },
        { id: "a0", slug: "ugc-reading-app", creator_id: "u", publish_type: "app", snapshot_nodes: [{ id: "s", type: "ugc-script", data: { ugcReadingFails: true } }], snapshot_edges: [], snapshot_settings: {} },
        { id: "a2", slug: "priced-app", creator_id: "u", publish_type: "app", snapshot_nodes: [{ id: "g", type: "generate-image", data: {} }], snapshot_edges: [], snapshot_settings: {} },
      ],
      workflow_templates: [],
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const result = await runRangeBackfill({ apply: true, includeTemplates: true, report })
    expect(result).toMatchObject({ ok: true, written: 1 })
    expect(updates.map((u) => u.table)).toEqual(["published_apps"])
    const rows = (JSON.parse(readFileSync(report, "utf8")) as { rows: Array<{ slug: string; skipped?: string; changed: boolean }> }).rows
    expect(rows.find((r) => r.slug === "ugc-app")).toMatchObject({ skipped: "ugc_listing_unpriced: a choice its users can make (Hebrew, 60 s)", changed: false })
    expect(rows.find((r) => r.slug === "ugc-reading-app")).toMatchObject({ skipped: "ugc_listing_unpriced: its saved settings", changed: false })
    expect(warn.mock.calls.flat().join(" ")).toContain("ugc-app · app · SKIPPED (ugc_listing_unpriced")
    warn.mockRestore()
    log.mockRestore()
  })
})
