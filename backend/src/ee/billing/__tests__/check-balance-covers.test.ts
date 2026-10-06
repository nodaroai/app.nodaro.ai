/**
 * `CreditsService.checkBalanceCovers` — the app's pre-run balance check reads
 * the figure a reservation would read: the payer's spendable pools (the top-up
 * pool left out for a pay-as-you-go account on a web surface), the deployment
 * payer's row under a deployment payer, and nothing at all for a workspace
 * payer (its headroom is the reserve RPC's job).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  profiles: new Map<string, Record<string, unknown>>(),
  read: [] as string[],
  edition: { hasCredits: true },
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`)
      let id = ""
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => {
          id = v
          h.read.push(v)
          return q
        },
        single: async () => (h.profiles.has(id) ? { data: h.profiles.get(id), error: null } : { data: null, error: { code: "PGRST116" } }),
      }
      return q
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }) }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => h.edition.hasCredits }
})

import { CreditsService } from "../credits.js"
import type { BillingContext } from "../../../lib/billing-context.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PAYER = "00000000-0000-4000-8000-0000000009e1"

const profile = (over: Record<string, unknown> = {}) => ({
  tier: "pro",
  subscription_tier: "pro",
  lifetime_topup_credits: 0,
  subscription_credits: 3000,
  topup_credits: 1000,
  ...over,
})

beforeEach(() => {
  h.profiles.clear()
  h.read.length = 0
  h.edition.hasCredits = true
  h.profiles.set(USER, profile())
})

describe("CreditsService.checkBalanceCovers", () => {
  it("covers when the subscription and top-up pools together reach the amount, including exactly", async () => {
    expect(await CreditsService.checkBalanceCovers(USER, 4000)).toEqual({ ok: true })
    expect(await CreditsService.checkBalanceCovers(USER, 1)).toEqual({ ok: true })
  })

  it("refuses with the balance when the pools fall short", async () => {
    expect(await CreditsService.checkBalanceCovers(USER, 4001)).toEqual({ ok: false, balance: 4000 })
  })

  it("a null pool reads as 0", async () => {
    h.profiles.set(USER, profile({ subscription_credits: null, topup_credits: 50 }))
    expect(await CreditsService.checkBalanceCovers(USER, 51)).toEqual({ ok: false, balance: 50 })
  })

  it("a pay-as-you-go account on a web surface spends its free pool only, as its reservation does", async () => {
    h.profiles.set(USER, profile({ tier: "free", subscription_tier: null, lifetime_topup_credits: 500, subscription_credits: 300, topup_credits: 5000 }))
    expect(await CreditsService.checkBalanceCovers(USER, 1000, undefined, true)).toEqual({ ok: false, balance: 300 })
    // The same account off the web surface spends both pools.
    expect(await CreditsService.checkBalanceCovers(USER, 1000, undefined, false)).toEqual({ ok: true })
  })

  it("a subscriber is never web-free", async () => {
    expect(await CreditsService.checkBalanceCovers(USER, 4000, undefined, true)).toEqual({ ok: true })
  })

  it("reads the deployment payer's profile, not the requester's", async () => {
    h.profiles.set(PAYER, profile({ subscription_credits: 10, topup_credits: 0 }))
    const ctx = {
      payer: "deployment",
      userId: USER,
      payerId: PAYER,
      entitlements: { watermark: false, dailyCapCredits: null, parallelism: 1, tierForGates: "pro" },
    } as BillingContext
    expect(await CreditsService.checkBalanceCovers(USER, 100, ctx)).toEqual({ ok: false, balance: 10 })
    expect(h.read).toEqual([PAYER])
  })

  it("a workspace payer is not refused on a personal balance", async () => {
    h.profiles.set(USER, profile({ subscription_credits: 0, topup_credits: 0 }))
    const ctx = {
      payer: "workspace",
      userId: USER,
      workspaceId: "ws-1",
      memberCap: null,
      entitlements: { tierForGates: "pro", webFreeMode: false, freeTierBlocklist: false, appCreditsAllowance: false, watermark: false, dailyCapCredits: null },
    } as unknown as BillingContext
    expect(await CreditsService.checkBalanceCovers(USER, 99999, ctx)).toEqual({ ok: true })
  })

  it("an unreadable profile passes (the per-node reservation refuses)", async () => {
    h.profiles.clear()
    expect(await CreditsService.checkBalanceCovers(USER, 99999)).toEqual({ ok: true })
  })

  it("with credits disabled it passes without reading anything", async () => {
    h.edition.hasCredits = false
    expect(await CreditsService.checkBalanceCovers(USER, 99999)).toEqual({ ok: true })
    expect(h.read).toEqual([])
  })
})
