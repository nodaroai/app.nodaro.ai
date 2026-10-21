// @test-units-by-name names the metered LLM node types it checks the candidate filter with (llm-chat, reduce, meta-ads-scrape, edit-3d-scene) and fixed ones (generate-image)
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({ from: vi.fn(), updates: [] as Array<{ table: string; values: Record<string, unknown>; id: unknown }> }))
const avail = vi.hoisted(() => ({ loaded: true }))
const gate = vi.hoisted(() => ({ ready: true, rollback: false, probes: 0 }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  const config = new Proxy(actual.config, {
    get: (target, key) => (key === "LLM_TIER_PRICING_ROLLBACK" ? gate.rollback : Reflect.get(target, key)),
  })
  return { ...actual, config, hasCredits: () => true, llmMeteredPricing: () => gate.ready && !gate.rollback }
})
vi.mock("@/lib/llm-metered-schema-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm-metered-schema-gate.js")>()),
  probeLlmMeteredSchemaNow: async () => {
    gate.probes++
    return gate.ready
  },
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: db.from } }))
vi.mock("@/lib/availability-override.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/availability-override.js")>()),
  loadAvailabilityOverridesForScript: async () => avail.loaded,
}))
vi.mock("@/lib/canvas-result-ids.js", () => ({ resolveCanvasResultIds: async (nodes: unknown) => nodes }))
// The listing the publish path stores: here a fixed figure per graph, so the columns are the arithmetic under test.
const listing = vi.hoisted(() => ({ value: { preview: 120, final: 0, previewPerMinute: 0, finalPerMinute: 0 } as Record<string, number>, unpricedSlugs: new Set<string>() }))
vi.mock("@/ee/billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/billing/credits.js")>()),
  estimateWorkflowListingCredits: vi.fn(async (nodes: Array<{ data?: { slug?: string } }>) => {
    if (nodes.some((n) => n.data?.slug && listing.unpricedSlugs.has(n.data.slug))) {
      throw Object.assign(new Error("unpriced"), { name: "LlmUnpricedModelError", code: "llm_model_unpriced", modelId: "claude-opus-5.5" })
    }
    return { ...listing.value, ceiling: { ...listing.value, preview: listing.value.preview + 10 } }
  }),
}))

import {
  appListingColumns,
  hasMeteredLlmNode,
  pricingStateRefusal,
  parseLlmListingArgs,
  planListingWrite,
  runLlmListingBackfill,
  templateListingColumns,
} from "../backfill-llm-listing-prices.js"

/**
 * The stored-listing backfill for metered LLM pricing (Task 12): every
 * published app, component and template whose graph makes a metered LLM call
 * gets the listing a republish would store NOW — the "from" and the "up to"
 * columns, fixed, per minute and per item — written only where they differ.
 * Run after each release with metered pricing live (rewrites stale tier
 * figures), or with `--allow-rollback` under the rollback (restores them).
 */
const LLM_APP = {
  id: "app-1",
  slug: "writer",
  publish_type: "app",
  creator_id: "u1",
  snapshot_nodes: [{ id: "c", type: "llm-chat", data: { llmModel: "claude-opus-5.5" } }],
  snapshot_edges: [],
  snapshot_settings: {},
  monetization_enabled: false,
  monetization_flat_fee: 0,
  monetization_percent: 0,
  // A stale tier listing.
  base_estimated_credits: 7,
  estimated_credits: 7,
}
const FIXED_APP = { ...LLM_APP, id: "app-2", slug: "image", snapshot_nodes: [{ id: "g", type: "generate-image", data: { provider: "nano-banana" } }] }

function tableReads(rows: Record<string, unknown[]>) {
  db.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    // The server's own accounts (system-account.ts): their templates are the seeder's.
    chain.like = async () => ({ data: rows.profiles ?? [], error: null })
    chain.order = () => chain
    chain.is = () => chain
    // A PostgREST builder: still filterable after `.range()`, and awaitable.
    chain.range = (from: number) => {
      const result = { data: from === 0 ? rows[table] ?? [] : [], error: null }
      const page: Record<string, unknown> = { is: () => page, then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko) }
      return page
    }
    chain.update = (values: Record<string, unknown>) => ({
      eq: async (_col: string, id: unknown) => {
        db.updates.push({ table, values, id })
        return { error: null }
      },
    })
    return chain
  })
}

beforeEach(() => {
  db.updates = []
  avail.loaded = true
  gate.ready = true
  gate.rollback = false
  gate.probes = 0
  listing.value = { preview: 120, final: 0, previewPerMinute: 0, finalPerMinute: 0 }
  listing.unpricedSlugs.clear()
})

describe("backfill-llm-listing-prices — pure parts", () => {
  it("a candidate is a graph whose run makes a metered LLM call, whatever the switch says", () => {
    expect(hasMeteredLlmNode([{ type: "llm-chat" }])).toBe(true)
    expect(hasMeteredLlmNode([{ type: "reduce", data: { strategyId: "pick-best-llm" } }])).toBe(true)
    expect(hasMeteredLlmNode([{ type: "meta-ads-scrape", data: { analyze: true } }])).toBe(true)
    expect(hasMeteredLlmNode([{ type: "reduce", data: { strategyId: "concat" } }])).toBe(false)
    expect(hasMeteredLlmNode([{ type: "edit-3d-scene", data: { operations: [] } }])).toBe(false)
    expect(hasMeteredLlmNode([{ type: "generate-image" }])).toBe(false)
    expect(hasMeteredLlmNode("not a graph")).toBe(false)
  })

  it("I2a: a UGC video whose clip or creator part holds a reading is a candidate", () => {
    const nodes = [
      { id: "s", type: "ugc-script", data: {} },
      { id: "c", type: "ugc-creator", data: {} },
      { id: "k", type: "ugc-clip", data: {} },
    ]
    const edges = [
      { id: "e1", source: "s", target: "k", sourceHandle: "script", targetHandle: "script" },
      { id: "e2", source: "c", target: "k", sourceHandle: "creator", targetHandle: "creator" },
    ]
    expect(hasMeteredLlmNode(nodes, edges)).toBe(true)
    expect(hasMeteredLlmNode([{ id: "g", type: "generate-image", data: {} }], [])).toBe(false)
  })

  it("I4: --allow-rollback runs only under the rollback switch; an unconfirmed schema is refused either way", () => {
    expect(pricingStateRefusal({ metered: true, rollbackSet: false, allowRollback: false })).toBeNull()
    expect(pricingStateRefusal({ metered: false, rollbackSet: true, allowRollback: false })).toMatch(/--allow-rollback/)
    expect(pricingStateRefusal({ metered: false, rollbackSet: true, allowRollback: true })).toBeNull()
    expect(pricingStateRefusal({ metered: false, rollbackSet: false, allowRollback: true })).toMatch(/only while LLM_TIER_PRICING_ROLLBACK is set/)
  })

  it("an app's columns are its listing priced as the publish path prices it (the fee on the preview part)", () => {
    const cols = appListingColumns(
      { monetization_enabled: true, monetization_flat_fee: 5, monetization_percent: 20 },
      { preview: 100, final: 30, previewPerMinute: 2, finalPerMinute: 1, ceiling: { preview: 150, final: 30 } },
    )
    expect(cols.base_estimated_credits).toBe(100)
    expect(cols.estimated_credits).toBeGreaterThan(130)
    expect(cols.base_per_minute_credits).toBe(2)
    expect(cols.base_max_estimated_credits).toBe(150)
  })

  it("a template's are both parts, unmarked, and its ceiling's", () => {
    expect(templateListingColumns({ preview: 100, final: 30, previewPerMinute: 2, finalPerMinute: 1, estimate: true, ceiling: { preview: 150, final: 30 } })).toEqual({
      estimated_credits_is_estimate: true,
      estimated_credits: 130,
      estimated_per_minute_credits: 3,
      max_estimated_credits: 180,
      max_estimated_per_minute_credits: 0,
    })
  })

  it("writes only what differs", () => {
    const next = { estimated_credits: 130, max_estimated_credits: 180 }
    expect(planListingWrite({ estimated_credits: 120, max_estimated_credits: 180 }, next)).toEqual({ estimated_credits: 130 })
    expect(planListingWrite({ ...next }, next)).toBeNull()
  })

  it("dry run is the default; --apply, --include-templates and --allow-rollback are opt-in", () => {
    expect(parseLlmListingArgs([])).toMatchObject({ apply: false, includeTemplates: false, allowRollback: false })
    expect(parseLlmListingArgs(["--apply", "--include-templates", "--allow-rollback", "--report", "r.json"])).toEqual({
      apply: true,
      includeTemplates: true,
      allowRollback: true,
      report: "r.json",
    })
  })
})

describe("backfill-llm-listing-prices — the run", () => {
  const report = "/dev/null"

  it("published listing price includes the LLM estimate; backfill rewrites stale tier figures (apps with an LLM node only)", async () => {
    tableReads({ published_apps: [LLM_APP, FIXED_APP] })
    const r = await runLlmListingBackfill({ apply: true, includeTemplates: false, allowRollback: false, report })
    expect(r.ok).toBe(true)
    expect(gate.probes).toBe(1)
    expect(db.updates).toEqual([
      {
        table: "published_apps",
        id: "app-1",
        values: expect.objectContaining({ base_estimated_credits: 120, estimated_credits: 120, max_estimated_credits: 130 }),
      },
    ])
  })

  it("a dry run writes nothing", async () => {
    tableReads({ published_apps: [LLM_APP] })
    const r = await runLlmListingBackfill({ apply: false, includeTemplates: false, allowRollback: false, report })
    expect(r.ok).toBe(true)
    expect(r.changed).toBe(1)
    expect(db.updates).toEqual([])
  })

  it("templates join with --include-templates", async () => {
    tableReads({ published_apps: [], workflow_templates: [{ ...LLM_APP, id: "t-1", estimated_credits: 7 }] })
    await runLlmListingBackfill({ apply: true, includeTemplates: true, allowRollback: false, report })
    expect(db.updates).toEqual([{ table: "workflow_templates", id: "t-1", values: expect.objectContaining({ estimated_credits: 120, max_estimated_credits: 130 }) }])
  })

  it("refuses while metered pricing is not live (the schema gate not ready) — it would rewrite listings to tier figures", async () => {
    gate.ready = false
    tableReads({ published_apps: [LLM_APP] })
    const r = await runLlmListingBackfill({ apply: true, includeTemplates: false, allowRollback: false, report })
    expect(r.ok).toBe(false)
    expect(db.updates).toEqual([])
  })

  it("rollback: refuses under the rollback switch unless --allow-rollback, which restores the tier figures", async () => {
    gate.rollback = true
    tableReads({ published_apps: [LLM_APP] })
    expect((await runLlmListingBackfill({ apply: true, includeTemplates: false, allowRollback: false, report })).ok).toBe(false)
    expect(db.updates).toEqual([])
    listing.value = { preview: 7, final: 0, previewPerMinute: 0, finalPerMinute: 0 }
    const r = await runLlmListingBackfill({ apply: true, includeTemplates: false, allowRollback: true, report })
    expect(r.ok).toBe(true)
    // The "from" columns already hold the tier figure: only the "up to" ones are written.
    expect(db.updates).toEqual([{ table: "published_apps", id: "app-1", values: expect.not.objectContaining({ estimated_credits: expect.anything() }) }])
  })

  it("I4: with --allow-rollback but the switch NOT set (the schema merely unconfirmed), it refuses", async () => {
    gate.ready = false
    tableReads({ published_apps: [LLM_APP] })
    expect((await runLlmListingBackfill({ apply: true, includeTemplates: false, allowRollback: true, report })).ok).toBe(false)
    expect(db.updates).toEqual([])
  })

  it("R48: a template the server's own account owns (the seeder's) is never written", async () => {
    tableReads({
      published_apps: [],
      profiles: [{ id: "system-1" }],
      workflow_templates: [{ ...LLM_APP, id: "t-sys", creator_id: "system-1" }, { ...LLM_APP, id: "t-user" }],
    })
    await runLlmListingBackfill({ apply: true, includeTemplates: true, allowRollback: false, report })
    expect(db.updates.map((u) => u.id)).toEqual(["t-user"])
  })

  it("R49: a listing whose model has no price is reported skipped and left as it is; the rest are written", async () => {
    listing.unpricedSlugs.add("bad")
    const BAD = { ...LLM_APP, id: "app-bad", slug: "bad", snapshot_nodes: [{ id: "c", type: "llm-chat", data: { llmModel: "claude-opus-5.5", slug: "bad" } }] }
    tableReads({ published_apps: [BAD, LLM_APP] })
    const r = await runLlmListingBackfill({ apply: true, includeTemplates: false, allowRollback: false, report })
    expect(r).toMatchObject({ ok: true, skipped: 1 })
    expect(db.updates.map((u) => u.id)).toEqual(["app-1"])
  })

  it("refuses without the deployment's availability", async () => {
    avail.loaded = false
    tableReads({ published_apps: [LLM_APP] })
    expect((await runLlmListingBackfill({ apply: true, includeTemplates: false, allowRollback: false, report })).ok).toBe(false)
  })
})
