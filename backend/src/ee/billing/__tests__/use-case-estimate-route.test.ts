/**
 * The route-side estimate of a use-case run (`estimateUseCaseCredits`): the
 * built graph priced through the charged price table, plus the fee from its
 * own pricing row. The database is stubbed: with no rows every step prices at
 * its STATIC_CREDIT_COSTS row, unmarked; a row for the fee wins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { db } = vi.hoisted(() => ({ db: { rows: [] as Array<{ model_identifier: string; credit_cost: number }> } }))

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
      const sorted = [...db.rows].sort((a, b) => a.model_identifier.localeCompare(b.model_identifier))
      return { data: sorted.slice(from, to + 1), error: null }
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
  getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }),
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
}))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@/lib/private-plugins/edit-plan-per-minute.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/private-plugins/edit-plan-per-minute.js")>()),
  editPlanPerMinuteActive: async () => false,
}))

import { buildTightenEpisodeGraph, TIGHTEN_EPISODE_DEFAULTS } from "@nodaro/render-rules"
import { invalidateModelPricingCache } from "../credits.js"
import { estimateUseCaseCredits } from "../use-case-estimate.js"

const sixtyMinutes = { media: { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 } }

beforeEach(() => {
  db.rows = []
  invalidateModelPricingCache()
})

describe("estimateUseCaseCredits — a use-case run's quote before it starts", () => {
  it("video 60 min, captions on: its steps, plus the fee", async () => {
    expect(await estimateUseCaseCredits(buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, sixtyMinutes))).toEqual({
      stepsCredits: 922,
      feeCredits: 10,
      totalCredits: 932,
    })
  })
  it("review on: quoted up to the proxy render; captions are the Render final's", async () => {
    const g = buildTightenEpisodeGraph({ ...TIGHTEN_EPISODE_DEFAULTS, reviewBeforeRender: true }, sixtyMinutes)
    expect(await estimateUseCaseCredits(g)).toEqual({ stepsCredits: 332, feeCredits: 10, totalCredits: 342 })
  })
  it("the fee is read from its pricing row, never a fixed figure", async () => {
    db.rows = [{ model_identifier: "use-case-fee:tighten-episode", credit_cost: 15 }]
    const r = await estimateUseCaseCredits(buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, sixtyMinutes))
    expect(r.feeCredits).toBe(15)
    expect(r.totalCredits).toBe(922 + 15)
  })
})
