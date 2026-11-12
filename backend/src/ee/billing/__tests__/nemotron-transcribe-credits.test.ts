// @test-units-by-name prices only the node types it names (transcribe, upload-audio) and the Nemotron / engine rows by id
/**
 * Nemotron 3.5 Transcribe is priced per started minute of the file (decided
 * 2026-11-12): a run reserves `nemotron-3-5-transcribe:<N>m`, which every
 * lookup prices as the four-minute rate row × N ÷ 4, rounded up once — the
 * single lookup (Run button, reservations), the price table (listings,
 * estimates) and the static fallback alike. 0.75 base credits a minute fits no
 * whole-credit row, hence the four-minute row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { db, settings, edition } = vi.hoisted(() => ({
  db: {
    rows: [] as Array<{ model_identifier: string; credit_cost: number }>,
    /** PostgREST's max_rows: the most rows one response can carry. */
    cap: 1000,
    /** How many whole-table reads fail before one succeeds. */
    failReads: 0,
    rangeCalls: 0,
  },
  settings: {
    value: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> },
  },
  edition: { hasCredits: true },
}))

function modelPricingQuery() {
  let identifier: string | undefined
  const query = {
    select: () => query,
    order: () => query,
    eq: (_column: string, value: string) => {
      identifier = value
      return query
    },
    single: async () => {
      const row = db.rows.find((r) => r.model_identifier === identifier)
      return row
        ? { data: { credit_cost: row.credit_cost, is_enabled: true, tier_restriction: null }, error: null }
        : { data: null, error: { code: "PGRST116" } }
    },
    range: async (from: number, to: number) => {
      db.rangeCalls++
      if (db.failReads > 0) {
        db.failReads--
        return { data: null, error: { message: "connection reset" } }
      }
      const sorted = [...db.rows].sort((a, b) => a.model_identifier.localeCompare(b.model_identifier))
      return { data: sorted.slice(from, Math.min(to + 1, from + db.cap)), error: null }
    },
  }
  return query
}

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      return modelPricingQuery()
    },
  },
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => settings.value,
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => edition.hasCredits }
})

import {
  CreditsService,
  STATIC_CREDIT_COSTS,
  chargedCredits,
  getChargedPriceTable,
  getModelCreditBaseCost,
  getModelCreditCostFromDB,
  invalidateModelPricingCache,
} from "../credits.js"


beforeEach(() => {
  db.rows = []
  settings.value = { cost_markup_percent: 0, service_margin_percent: {} }
  edition.hasCredits = true
  invalidateModelPricingCache()
})

describe("nemotron-3-5-transcribe per-minute ids", () => {
  it("has a 3-credit four-minute rate row, the 60-minute bound on the bare id, and no stored minutes rows", () => {
    expect(STATIC_CREDIT_COSTS["nemotron-3-5-transcribe:per-4m"]).toBe(3)
    expect(STATIC_CREDIT_COSTS["nemotron-3-5-transcribe"]).toBe(45)
    expect(Object.keys(STATIC_CREDIT_COSTS).filter((id) => /^nemotron-3-5-transcribe:\d+m$/.test(id))).toEqual([])
  })

  it("prices the minutes ids from the static rate row when the database has none (0.75 a minute, rounded up once)", async () => {
    const table = await getChargedPriceTable()
    expect(table.base("nemotron-3-5-transcribe:1m")).toBe(1)
    expect(table.base("nemotron-3-5-transcribe:2m")).toBe(2)
    expect(table.base("nemotron-3-5-transcribe:4m")).toBe(3)
    expect(table.base("nemotron-3-5-transcribe:10m")).toBe(8)
    expect(table.base("nemotron-3-5-transcribe:60m")).toBe(45)
    expect((await getModelCreditBaseCost("nemotron-3-5-transcribe:10m")).creditCost).toBe(8)
    // The 60-minute id is the bare engine id's bound.
    expect(table.base("nemotron-3-5-transcribe:60m")).toBe(STATIC_CREDIT_COSTS["nemotron-3-5-transcribe"])
  })

  it("marks the whole run up once (the plan's 10 → 9 and 60 → 50; one minute is 2)", async () => {
    settings.value = { cost_markup_percent: 10, service_margin_percent: {} }
    const table = await getChargedPriceTable()
    expect(chargedCredits(table, "nemotron-3-5-transcribe:1m")).toBe(2)
    expect(chargedCredits(table, "nemotron-3-5-transcribe:10m")).toBe(9)
    expect(chargedCredits(table, "nemotron-3-5-transcribe:60m")).toBe(50)
    for (const id of ["nemotron-3-5-transcribe:1m", "nemotron-3-5-transcribe:7m", "nemotron-3-5-transcribe:60m"]) {
      expect(chargedCredits(table, id), id).toBe((await getModelCreditCostFromDB(id)).creditCost)
    }
  })

  it("follows a retuned rate row, in the single lookup and the table alike", async () => {
    db.rows = [{ model_identifier: "nemotron-3-5-transcribe:per-4m", credit_cost: 4 }]
    const table = await getChargedPriceTable()
    expect(table.base("nemotron-3-5-transcribe:3m")).toBe(3)
    expect((await getModelCreditBaseCost("nemotron-3-5-transcribe:3m")).creditCost).toBe(3)
  })

  it("does not price an out-of-range minutes id", async () => {
    const table = await getChargedPriceTable()
    expect(table.base("nemotron-3-5-transcribe:61m")).toBeUndefined()
    expect(table.base("nemotron-3-5-transcribe:0m")).toBeUndefined()
  })
})

describe("nemotron-3-5-transcribe in a workflow estimate", () => {
  const node = { id: "t", type: "transcribe", data: { provider: "nemotron-3-5-transcribe" } }

  it("quotes 60 minutes — the most a run that measures the file can be charged — when the file's length is not known", async () => {
    expect(await CreditsService.estimateWorkflowCredits([node])).toBe(45)
  })

  it("quotes an uploaded audio at the started minutes of the length its upload recorded (3:10 → 4 minutes)", async () => {
    const audio = { id: "a", type: "upload-audio", data: { url: "https://m.test/a.mp3", metadata: { durationSeconds: 190 } } }
    expect(await CreditsService.estimateWorkflowCredits([audio, node], [{ source: "a", target: "t", targetHandle: "audio" }])).toBe(3)
  })

  it("leaves the other engines on their own per-request rows", async () => {
    expect(await CreditsService.estimateWorkflowCredits([{ id: "t", type: "transcribe", data: { provider: "elevenlabs-stt" } }])).toBe(STATIC_CREDIT_COSTS["elevenlabs-stt"])
    expect(await CreditsService.estimateWorkflowCredits([{ id: "t", type: "transcribe", data: {} }])).toBe(STATIC_CREDIT_COSTS["elevenlabs-stt"])
  })
})
