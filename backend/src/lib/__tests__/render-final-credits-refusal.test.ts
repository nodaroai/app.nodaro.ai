/**
 * `renderFinalCredits` refused: the figures a use-case Render final's refusal
 * carries beside its error (routes/use-case-continue.ts) are the ones its
 * message states — the check is asked about `holdCredits` and names the
 * balance it read as `available`, and its sentence is worded from those two.
 * A pay-as-you-go account on a web surface, short of its free pool, is said
 * so (`subscriptionRequired`): its balance is the free pool only, the case the
 * credit guard answers with the subscription ask rather than a balance.
 * The real balance check, on an in-memory profile; the price is fixed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  price: { credits: 600, hold: 600 },
}))

vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => true }))
vi.mock("@/ee/billing/credits.js", async (orig) => ({
  ...(await orig<typeof import("@/ee/billing/credits.js")>()),
  estimateRunSetFigures: async () => db.price,
  runHoldsMeteredLlmEstimate: () => false,
}))
vi.mock("@/lib/supabase.js", () => {
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({ data: db.profile, error: null }),
  }
  return { supabase: { from: () => query } }
})

import { renderFinalCredits } from "../render-final-run.js"

const USER = "00000000-0000-4000-8000-000000000001"
const quote = (webFreeMode = false) =>
  renderFinalCredits({ userId: USER, nodes: [], edges: [], runNodeIds: [], overrides: undefined, surface: { webFreeMode } })

beforeEach(() => {
  db.profile = { tier: "free", subscription_tier: null, lifetime_topup_credits: 0, subscription_credits: 100, topup_credits: 0 }
  db.price = { credits: 600, hold: 600 }
})

describe("a refused Render final: its figures are the ones its message states", () => {
  it("a personal payer: `holdCredits` and `available` are the figures its sentence names, and no free-pool mark", async () => {
    const credits = await quote()
    expect(credits).toMatchObject({ sufficient: false, holdCredits: 600, available: 100, message: "Insufficient credits. Required: 600, Available: 100" })
    expect(credits).not.toHaveProperty("subscriptionRequired")
  })

  it("a pay-as-you-go account on a web surface short of its free pool is marked so", async () => {
    db.profile = { tier: "free", subscription_tier: null, lifetime_topup_credits: 500, subscription_credits: 100, topup_credits: 5000 }
    const credits = await quote(true)
    expect(credits).toMatchObject({ sufficient: false, subscriptionRequired: true, available: 100 })
    // The same account off a web surface spends its top-up pool too: covered.
    expect(await quote(false)).toMatchObject({ sufficient: true })
  })

  it("a run it covers carries no mark", async () => {
    db.profile = { ...db.profile, subscription_credits: 600 }
    const credits = await quote()
    expect(credits).toMatchObject({ sufficient: true })
    expect(credits).not.toHaveProperty("subscriptionRequired")
  })
})
