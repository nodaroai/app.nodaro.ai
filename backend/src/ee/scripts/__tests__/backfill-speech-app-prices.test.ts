/**
 * The published-app price backfill's pure parts: which rows are candidates,
 * how a base becomes the listed price (the publish route's rule), which rows
 * get a write (only when a stored value differs — a second run writes nothing),
 * and what a dry-run line says about each speech node.
 */
import { describe, it, expect, vi } from "vitest"

const flag = vi.hoisted(() => ({ on: true, credits: true }))
const db = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, speechLengthPricingEnabled: () => flag.on, hasCredits: () => flag.credits }
})
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: db.from } }))
const avail = vi.hoisted(() => ({ loaded: true, calls: 0 }))
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
    return est.split
  },
}))
vi.mock("@/lib/canvas-result-ids.js", () => ({ resolveCanvasResultIds: async (nodes: unknown) => nodes }))

import { tmpdir } from "node:os"
import { join } from "node:path"
import { formatLine, hasPerMinutePart, hasSpeechNode, parseArgs, planWrite, recomputePrice, runBackfill, selectCandidates, speechNodeSummary } from "../backfill-speech-app-prices.js"

const tts = { id: "t", type: "text-to-speech", data: { textSource: "direct", provider: "elevenlabs-v4", directText: "a".repeat(1000) } }
const image = { id: "i", type: "generate-image", data: {} }
const row = (over: Record<string, unknown> = {}) => ({
  id: "app-1", slug: "my-app", publish_type: "app", creator_id: "u1",
  snapshot_nodes: [tts, image], snapshot_edges: [], snapshot_settings: {},
  base_estimated_credits: 50, estimated_credits: 50,
  monetization_enabled: false, monetization_flat_fee: 0, monetization_percent: 0,
  ...over,
})

describe("candidates", () => {
  it("a snapshot with a Text to Speech or Text to Dialogue node is a candidate; one without is not", () => {
    expect(hasSpeechNode([tts, image])).toBe(true)
    expect(hasSpeechNode([{ id: "d", type: "text-to-dialogue", data: {} }])).toBe(true)
    expect(hasSpeechNode([image])).toBe(false)
    expect(hasSpeechNode(null)).toBe(false)
    expect(hasSpeechNode("not nodes")).toBe(false)
    expect(selectCandidates([row(), row({ id: "app-2", snapshot_nodes: [image] })]).map((r) => r.id)).toEqual(["app-1"])
  })
})

describe("recomputePrice — the publish route's rule", () => {
  it("a free app lists its base; a monetized app lists the monetized cost; a zero base is never marked up", () => {
    expect(recomputePrice({ monetization_enabled: false, monetization_flat_fee: 5, monetization_percent: 20 }, { preview: 40, final: 0 })).toEqual({ base: 40, listed: 40 })
    // calculateMonetizedCost: base + flat + base × percent
    expect(recomputePrice({ monetization_enabled: true, monetization_flat_fee: 5, monetization_percent: 20 }, { preview: 40, final: 0 })).toEqual({ base: 40, listed: 40 + 5 + 8 })
    expect(recomputePrice({ monetization_enabled: true, monetization_flat_fee: 5, monetization_percent: 20 }, { preview: 0, final: 0 })).toEqual({ base: 0, listed: 0 })
    expect(recomputePrice({ monetization_enabled: true, monetization_flat_fee: null, monetization_percent: null }, { preview: 40, final: 0 })).toEqual({ base: 40, listed: 40 })
    // The Render final part is listed unmarked: the fee applies to the preview part only.
    expect(recomputePrice({ monetization_enabled: true, monetization_flat_fee: 5, monetization_percent: 20 }, { preview: 40, final: 12 })).toEqual({ base: 40, listed: 40 + 5 + 8 + 12 })
  })
})

describe("planWrite — only a differing row is written", () => {
  it("writes when either stored value differs; nothing when both already match (idempotent)", () => {
    expect(planWrite(row(), { base: 50, listed: 50 })).toBeNull()
    expect(planWrite(row(), { base: 440, listed: 440 })).toEqual({ id: "app-1", slug: "my-app", before: { base: 50, listed: 50 }, after: { base: 440, listed: 440 } })
    expect(planWrite(row({ estimated_credits: 60 }), { base: 50, listed: 50 })).not.toBeNull()
    // A second run over the written values plans nothing.
    const written = row({ base_estimated_credits: 440, estimated_credits: 440 })
    expect(planWrite(written, { base: 440, listed: 440 })).toBeNull()
  })

  it("a null stored value reads as 0", () => {
    expect(planWrite(row({ base_estimated_credits: null, estimated_credits: null }), { base: 0, listed: 0 })).toBeNull()
  })
})

describe("the dry-run line", () => {
  it("names each speech node with how its text is priced — exact or unknown — through the one estimator", () => {
    flag.on = true
    const connected = { id: "c", type: "text-to-speech", data: { textSource: "connected", provider: "elevenlabs-v4" } }
    expect(speechNodeSummary([tts, connected, image], [], {})).toBe("text-to-speech:exact(1000) text-to-speech:unknown(10000)")
    // An exposed input's limit is what the unknown text is priced at.
    expect(speechNodeSummary([connected], [], { "c:directText": 300 })).toBe("text-to-speech:unknown(10000)")
    const direct = { id: "x", type: "text-to-speech", data: { textSource: "direct", provider: "elevenlabs-v4", directText: "hello" } }
    expect(speechNodeSummary([direct], [], { "x:directText": 300 })).toBe("text-to-speech:unknown(300)")
  })

  it("with the flag off (the rollback path) every speech node reads flat", () => {
    flag.on = false
    expect(speechNodeSummary([tts], [], {})).toBe("text-to-speech:flat")
    flag.on = true
  })

  it("formats one line per candidate with the before → after pair", () => {
    const line = formatLine({ kind: "app", id: "a", slug: "my-app", monetized: true, before: { base: 50, listed: 60 }, after: { base: 440, listed: 528 }, changed: true, speech: "text-to-speech:unknown(10000)" })
    expect(line).toBe("my-app · app · base 50 → 440 · listed 60 → 528 · monetized · text-to-speech:unknown(10000)")
    expect(formatLine({ kind: "template", id: "t", slug: "tpl", monetized: false, before: { base: 50, listed: 50 }, after: { base: 50, listed: 50 }, changed: false, speech: "" })).toContain("base 50 = 50")
  })
})

describe("the command line", () => {
  it("dry run by default; --apply, --include-templates, --allow-flag-off and --report are read", () => {
    expect(parseArgs([])).toMatchObject({ apply: false, includeTemplates: false, allowFlagOff: false })
    expect(parseArgs([]).report).toMatch(/^\.\/speech-price-backfill-\d{4}-\d{2}-\d{2}\.json$/)
    expect(parseArgs(["--apply", "--include-templates", "--allow-flag-off", "--report", "./out.json"])).toEqual({ apply: true, includeTemplates: true, allowFlagOff: true, report: "./out.json" })
  })
})

describe("the edition gate", () => {
  const opts = { apply: false, includeTemplates: false, allowFlagOff: false, report: "./unused.json" }

  it("refuses outside the Cloud edition, before any database read: the estimate would price unmarked, without the admin price overrides", async () => {
    flag.on = true
    flag.credits = false
    db.from.mockClear()
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const result = await runBackfill(opts)
    expect(result).toEqual({ ok: false, lines: [] })
    expect(db.from).not.toHaveBeenCalled()
    expect(error.mock.calls.flat().join(" ")).toContain("EDITION=cloud")
    error.mockRestore()
    flag.credits = true
  })

  it("refuses when the deployment's availability cannot be read, before any listing is read: a cold cache reads a hidden Speaker Map as released (multicam listings over-quoted)", async () => {
    flag.on = true
    flag.credits = true
    avail.loaded = false
    avail.calls = 0
    db.from.mockClear()
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(await runBackfill(opts)).toEqual({ ok: false, lines: [] })
    expect(avail.calls).toBe(1)
    expect(db.from).not.toHaveBeenCalled()
    expect(error.mock.calls.flat().join(" ")).toContain("Admin → Availability")
    error.mockRestore()
    avail.loaded = true
  })

  it("the rollback path (--allow-flag-off) does not lift it", async () => {
    flag.credits = false
    db.from.mockClear()
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect((await runBackfill({ ...opts, allowFlagOff: true })).ok).toBe(false)
    expect(db.from).not.toHaveBeenCalled()
    error.mockRestore()
    flag.credits = true
  })
})

// A listing with a per-minute part (decided 2026-10-07) is never backfilled:
// the script writes the fixed pair alone, which would drop the per-minute part.
describe("a per-minute listing is left for its next publish", () => {
  it("has a per-minute part when either part has one", () => {
    expect(hasPerMinutePart({ preview: 10, final: 0 })).toBe(false)
    expect(hasPerMinutePart({ preview: 10, final: 0, previewPerMinute: 0, finalPerMinute: 0 })).toBe(false)
    expect(hasPerMinutePart({ preview: 10, final: 0, previewPerMinute: 4 })).toBe(true)
    expect(hasPerMinutePart({ preview: 10, final: 0, finalPerMinute: 10 })).toBe(true)
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

describe("a candidate with an unpriced metered LLM model (R49)", () => {
  it("is reported and skipped, never written; the candidates after it are priced and written", async () => {
    flag.on = true
    flag.credits = true
    const speech = { id: "t", type: "text-to-speech", data: { textSource: "direct", provider: "elevenlabs-v4", directText: "hello" } }
    const base = { publish_type: "app", creator_id: "u", snapshot_edges: [], snapshot_settings: {}, base_estimated_credits: 1, estimated_credits: 1, monetization_enabled: false, monetization_flat_fee: null, monetization_percent: null }
    const updates = serveRows({
      published_apps: [
        { ...base, id: "a1", slug: "unpriced-app", snapshot_nodes: [speech, { id: "c", type: "llm-chat", data: { llmModel: "unpriced-model" } }] },
        { ...base, id: "a2", slug: "priced-app", snapshot_nodes: [speech] },
      ],
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const result = await runBackfill({ apply: true, includeTemplates: false, allowFlagOff: false, report: join(tmpdir(), `speech-unpriced-${process.pid}.json`) })
    expect(result.ok).toBe(true)
    expect(result.lines.find((l) => l.slug === "unpriced-app")).toMatchObject({ skipped: "llm_model_unpriced: unpriced-model", changed: false, after: { base: 1, listed: 1 } })
    expect(result.lines.find((l) => l.slug === "priced-app")).toMatchObject({ changed: true, after: { base: 40, listed: 40 } })
    expect(updates).toEqual([{ table: "published_apps", payload: { base_estimated_credits: 40, estimated_credits: 40 } }])
    expect(warn.mock.calls.flat().join(" ")).toContain("unpriced-app · app · SKIPPED (llm_model_unpriced: unpriced-model) — left as stored")
    warn.mockRestore()
    log.mockRestore()
  })
})
