// @test-watches backend/src/ee/billing/__tests__/fixtures/stored-credit-messages-mainline.json
// @test-units-by-name prices one model id ("flux") from a stubbed price row, and an empty run set; reads no node unit's own price
/**
 * The failure sentences that name a credit figure and are SAVED with a run
 * (`jobs.error_message`, a node's `error` in `node_states`, the execution's
 * `error_message`): what a balance check refuses with, what a reservation the
 * database refused throws, and what a charged failure says it was charged —
 * and the refusals saved the same way that advise a purchase where self-serve
 * is on (the storage limit, a model the plan may not run, a video beyond the
 * free-credit limits). The MCP lane hands them on as saved, and so do the
 * editor and the REST reads.
 *
 * With nothing configured (no unit, no external wallet, self-serve on) every
 * one is recorded here byte for byte, from the code that writes it, and must
 * stay exactly so. Rewrite the recording only with a change meant to move what
 * such a deployment stores:
 *   cd backend && UPDATE_STORED_CREDIT_MESSAGES=1 npx vitest run src/ee/billing/__tests__/stored-credit-messages.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const h = vi.hoisted(() => {
  for (const key of ["NODARO_SURFACE_PROFILE", "DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER"]) process.env[key] = ""
  return {
    tables: new Map<string, { data: unknown; error: unknown }>(),
    rpcError: null as null | { message: string },
  }
})

vi.mock("@/lib/supabase.js", () => {
  const chainFor = (table: string) => {
    const answer = () => h.tables.get(table) ?? { data: null, error: { code: "PGRST116" } }
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "neq", "is", "in", "order", "limit", "range", "gt", "gte", "lt", "lte", "or", "not", "filter", "insert", "update", "upsert", "delete"]) chain[m] = () => chain
    chain.single = async () => answer()
    chain.maybeSingle = async () => answer()
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(answer()).then(resolve)
    return chain
  }
  return {
    supabase: {
      from: (table: string) => chainFor(table),
      auth: { getUser: vi.fn() },
      rpc: async () => (h.rpcError ? { data: null, error: h.rpcError } : { data: null, error: null }),
    },
  }
})
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
}))

import { CreditsService, checkRunSetCredits, invalidateModelPricingCache, type CreditProfile } from "../credits.js"
import { freeVideoLockMessage, type FreeVideoLock } from "../free-video-limits.js"
import { classifyFailure } from "../../../lib/mcp/tools/diagnose.js"
import { isRetryableFailure } from "../../../lib/mcp/tools/_job-error.js"
import { chargedFailureMessage as llmRouteChargedMessage } from "../../../lib/llm-metered-route.js"
import { chargedFailureMessage as meterSyncChargedMessage } from "../../../lib/meter-sync-llm.js"
import { emptyPickerReadChargedMessage } from "../../../routes/describe-to-picker.js"
import { fromFailedCover } from "../../../lib/use-case/continue-credits.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"

const here = dirname(fileURLToPath(import.meta.url))
const MAINLINE_FIXTURE = resolve(here, "fixtures/stored-credit-messages-mainline.json")

const USER = "c0000000-0000-4000-8000-00000000000c"
const TODAY = new Date().toISOString()
const PAID: CreditProfile = { lifetime_topup_credits: 0, tier: "pro", subscription_credits: 1031, topup_credits: 503, daily_spent_credits: 0, last_daily_reset: TODAY }
const FREE_APP: CreditProfile = { lifetime_topup_credits: 0, tier: "free", subscription_credits: 37, topup_credits: 0, daily_spent_credits: 0, last_daily_reset: TODAY, app_credits_allowance: 7 }
const WEB_FREE: CreditProfile = { lifetime_topup_credits: 900, tier: "free", subscription_credits: 23, topup_credits: 900, daily_spent_credits: 0, last_daily_reset: TODAY }

/** The raw refusals the reservation RPCs raise with figures (the live definitions in supabase/migrations). */
const RAW_RESERVE_REFUSALS = {
  insufficient: "Insufficient credits: need 2087, have 1534",
  daily: "Daily credit limit reached: limit 4421, spent today 4400, need 53",
  appCredits: "Insufficient app credits: need 29, have 7. Earn app credits by running flows.",
  subscriptionRequired: "SUBSCRIPTION_REQUIRED: web spending draws only free-pool credits: need 211, free pool has 23",
  notPositive: "Credits must be positive, got -3",
} as const

function price(credits: number) {
  invalidateModelPricingCache()
  h.tables.set("model_pricing", { data: { credit_cost: credits, is_enabled: true, tier_restriction: null }, error: null })
}

async function thrown(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    return (err as Error).message
  }
  throw new Error("expected a refusal")
}

/** Every saved sentence that names a figure, from the code that writes it, keyed by case. */
async function storedMessages(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}

  price(2087)
  out.check_insufficient = (await CreditsService.checkCreditsWithProfile(USER, PAID, "flux")).error ?? "(allowed)"
  price(29)
  out.check_app_credits = (await CreditsService.checkCreditsWithProfile(USER, FREE_APP, "flux", true)).error ?? "(allowed)"
  price(211)
  out.check_web_free = (await CreditsService.checkCreditsWithProfile(USER, WEB_FREE, "flux", false, undefined, { webFreeMode: true })).error ?? "(allowed)"
  price(53)
  h.tables.set("tier_config", { data: { daily_credit_limit: 4421, monthly_credits: 0, features: {} }, error: null })
  out.check_daily = (await CreditsService.checkCreditsWithProfile(USER, { ...PAID, daily_spent_credits: 4400 }, "flux")).error ?? "(allowed)"
  h.tables.delete("tier_config")

  h.tables.set("profiles", { data: { tier: "basic", subscription_tier: "basic", lifetime_topup_credits: 0, subscription_credits: 401, topup_credits: 109 }, error: null })
  out.run_set_insufficient = (await checkRunSetCredits(USER, 2087, {})).message ?? "(sufficient)"
  h.tables.set("profiles", { data: { tier: "free", subscription_tier: null, lifetime_topup_credits: 500, subscription_credits: 23, topup_credits: 500 }, error: null })
  out.run_set_web_free = (await checkRunSetCredits(USER, 211, { webFreeMode: true })).message ?? "(sufficient)"
  h.tables.delete("profiles")

  price(53)
  for (const [key, message] of Object.entries(RAW_RESERVE_REFUSALS)) {
    h.rpcError = { message }
    out[`reserve_${key}`] = await thrown(CreditsService.reserveCredits(USER, "job-1", "flux", 0, 0, { watermarkOverride: false }))
  }
  h.rpcError = null

  invalidateModelPricingCache()
  h.tables.set("model_pricing", { data: [], error: null })
  const covers = vi.spyOn(CreditsService, "checkBalanceCovers").mockResolvedValue({ ok: false, balance: 509 } as never)
  const cover = await fromFailedCover({ userId: USER, graph: { nodes: [], edges: [] } as never, nodeIds: [], overrides: undefined, feeCredits: 113, webFreeMode: false })
  out.continue_estimate = cover && !cover.ok ? cover.message : "(covered)"
  covers.mockRestore()

  out.llm_route_charged_1 =llmRouteChargedMessage("The model refused.", { outcome: "charged", charged: 1 } as never)
  out.llm_route_charged_n = llmRouteChargedMessage("The model refused.", { outcome: "charged", charged: 67 } as never)
  out.meter_sync_charged_1 = meterSyncChargedMessage("The answer was cut off.", { outcome: "charged", charged: 1 } as never)
  out.meter_sync_charged_n = meterSyncChargedMessage("The answer was cut off.", { outcome: "charged", charged: 41 } as never)
  out.picker_charged_unsettled = emptyPickerReadChargedMessage(undefined)
  out.picker_charged_1 = emptyPickerReadChargedMessage(1)
  out.picker_charged_n = emptyPickerReadChargedMessage(17)
  return out
}

const FREE: CreditProfile = { lifetime_topup_credits: 0, tier: "free", subscription_tier: null, subscription_credits: 37, topup_credits: 0, daily_spent_credits: 0, last_daily_reset: TODAY }

/** Every lock the free-credit video limits refuse a run with, one per kind. */
const FREE_VIDEO_LOCKS: readonly FreeVideoLock[] = [
  { kind: "model", label: "Kling 3.0" },
  { kind: "upscale", label: "Topaz Video Upscale" },
  { kind: "extend", label: "Seedance 2.0" },
  { kind: "shortest", label: "Veo 3.1", max: 6, shortest: 8 },
  { kind: "auto", label: "Seedance 2.0", max: 6 },
  { kind: "duration", label: "Seedance 2.0", max: 6 },
  { kind: "resolution", label: "Seedance 2.0", lowest: "480p" },
  { kind: "size", label: "Wan 2.6" },
]

/**
 * The refusals a run is saved with that advise a purchase where self-serve is
 * on: the storage limit (a route's 413, saved by the sync-HTTP and use-case
 * lanes), a model above the plan's tier or on the free tier's blocklist, and a
 * video beyond the free-credit limits (the engine's preflight saves each).
 */
async function storedRefusals(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const GB = 1024 * 1024 * 1024
  out.storage_limit = CreditsService.checkStorageLimitWithProfile({ tier: "free", subscription_tier: null, lifetime_topup_credits: 0, storage_used_bytes: Math.round(2.4 * GB), storage_limit_bytes: 2 * GB } as never).error ?? "(allowed)"

  invalidateModelPricingCache()
  h.tables.set("model_pricing", { data: { credit_cost: 5, is_enabled: true, tier_restriction: "pro" }, error: null })
  out.model_tier = (await CreditsService.checkCreditsWithProfile(USER, FREE, "flux")).error ?? "(allowed)"
  invalidateModelPricingCache()
  h.tables.set("model_pricing", { data: { credit_cost: 5, is_enabled: true, tier_restriction: null }, error: null })
  out.model_blocked = (await CreditsService.checkCreditsWithProfile(USER, FREE, "veo3.1")).error ?? "(allowed)"

  out.check_free_video = (await CreditsService.checkCreditsWithProfile(USER, FREE, "kling-3.0", false, undefined, { video: { provider: "kling-3.0", duration: 5, resolution: "720p" } })).error ?? "(allowed)"
  for (const lock of FREE_VIDEO_LOCKS) out[`free_video_${lock.kind}`] = freeVideoLockMessage(lock)
  h.tables.delete("model_pricing")
  return out
}

beforeEach(() => {
  h.tables.clear()
  h.rpcError = null
  invalidateModelPricingCache()
})

describe("nothing configured: every saved credit sentence exactly as before", () => {
  it("answers the recorded bytes", async () => {
    const actual = { ...(await storedMessages()), ...(await storedRefusals()) }
    if (process.env.UPDATE_STORED_CREDIT_MESSAGES === "1") {
      mkdirSync(dirname(MAINLINE_FIXTURE), { recursive: true })
      writeFileSync(MAINLINE_FIXTURE, `${JSON.stringify(actual, null, 2)}\n`)
    }
    const recorded = JSON.parse(readFileSync(MAINLINE_FIXTURE, "utf8")) as Record<string, string>
    expect(actual).toEqual(recorded)
    // The recording is of real refusals: every case refused, with its figures.
    expect(Object.values(actual).some((s) => s.startsWith("("))).toBe(false)
    expect(actual.check_insufficient).toContain("2087")
    expect(actual.reserve_insufficient).toContain("2087")
  })
})

// ── a deployment payer, nothing else configured ────────────────────────────

describe("a deployment payer with no unit, no external wallet and self-serve on: the operator's pool is never saved for the requester", () => {
  const PAYER_ID = "70000000-0000-4000-8000-000000000007"
  const dep = { payer: "deployment", userId: USER, payerId: PAYER_ID, entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "pro" } } as never

  it("the balance check's refusal (what the engine saves as a node's failure) names what the run needs, never the pool", async () => {
    price(2087)
    const check = await CreditsService.checkCreditsWithProfile(USER, PAID, "flux", false, undefined, { billingContext: dep })
    expect(check.allowed).toBe(false)
    expect(check.error).toBe("Insufficient credits. Required: 2087")
    expect(check.error).not.toContain("1534")
  })

  it("a reservation the database refused names what it needed, never what the pool had", async () => {
    price(53)
    h.rpcError = { message: RAW_RESERVE_REFUSALS.insufficient }
    const said = await thrown(CreditsService.reserveCredits(USER, "job-1", "flux", 0, 0, { watermarkOverride: false, billingContext: dep }))
    expect(said).toBe("Credit reservation failed: Insufficient credits: need 2087")
    // The payer's own run reads its own pool, as before.
    const own = await thrown(CreditsService.reserveCredits(PAYER_ID, "job-1", "flux", 0, 0, { watermarkOverride: false, billingContext: { ...(dep as object), userId: PAYER_ID } as never }))
    expect(own).toBe("Credit reservation failed: Insufficient credits: need 2087, have 1534")
  })
})

// ── on a deployment in its own terms ───────────────────────────────────────

function setProfile(billing: Record<string, unknown> | null) {
  process.env.NODARO_SURFACE_PROFILE = billing ? JSON.stringify({ billing }) : ""
  __resetSurfaceProfileCacheForTests()
}

/** The raw figures the cases above are filled with (the small ones aside): none may be saved on such a deployment. */
const RAW = [2087, 1534, 4421, 4400, 510, 509, 113, 211, 67, 41, 29, 53, 17]
const rawIn = (text: string) => RAW.filter((n) => new RegExp(`(?<![\\d.])${n}(?![\\d])`).test(text))

describe("a deployment with its own unit: every saved credit sentence states its figures in the unit", () => {
  afterEach(() => setProfile(null))

  it("no raw figure, the unit's word, and the words the failure readers classify by", async () => {
    setProfile({ unitLabel: "points", unitRate: 0.25, unitDecimals: 2 })
    const said = await storedMessages()
    for (const [key, text] of Object.entries(said)) {
      expect(rawIn(text), `${key}: ${text}`).toEqual([])
      expect(text, key).not.toMatch(/\d\s*credits?\b/)
    }
    expect(said).toMatchObject({
      check_insufficient: "Insufficient balance. Required: 521.75 points, Available: 383.5 points",
      check_app_credits: "Insufficient app balance. You have 1.75 points of app balance but need 7.25 points. Earn more by running flows in the editor.",
      check_web_free: "Your free balance can't cover this run (need 52.75 points, free pool has 5.75 points).",
      check_daily: "Daily limit reached. Limit: 1105.25 points, Spent: 1100 points",
      reserve_insufficient: "Credit reservation failed: Insufficient balance: need 521.75 points, have 383.5 points",
      reserve_notPositive: "Credit reservation failed: the amount to reserve must be positive",
      continue_estimate: "Continuing this episode is estimated at about 28.25 points; your balance is 127.25 points.",
      llm_route_charged_n: "The model refused. Charged 16.75 points: the model did billed work before it failed.",
      meter_sync_charged_n: "The answer was cut off. The AI provider had already processed the request, so it was charged 10.25 points for the usage it billed.",
      picker_charged_n: "We couldn't read anything in this photo — try a clearer photo of one person. You were charged 4.25 points for the model's attempt.",
      picker_charged_unsettled: "We couldn't read anything in this photo — try a clearer photo of one person. You were charged for the model's attempt.",
    })
    // The readers that decide by the words reach the same verdict: diagnose_run's balance class, the metered-hold catch.
    for (const key of ["check_insufficient", "check_app_credits", "reserve_insufficient", "reserve_appCredits"]) {
      expect(said[key], key).toMatch(/insufficient.*(balance|credit)/i)
    }
    expect(said.reserve_subscriptionRequired).toContain("SUBSCRIPTION_REQUIRED:")
  })

  it("a deployment payer's pool is never stated to the requester: what the run needs, not what the operator holds", async () => {
    setProfile({ unitLabel: "points", unitRate: 0.25, unitDecimals: 2, selfServe: false })
    price(2087)
    const check = await CreditsService.checkCreditsWithProfile(USER, PAID, "flux", false, undefined, {
      billingContext: { payer: "deployment", userId: USER, payerId: "70000000-0000-4000-8000-000000000007", entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "pro" } } as never,
    })
    expect(check.error).toBe("Insufficient balance. Required: 521.75 points.")
  })

  it("without self-serve billing, no sentence advises an upgrade or a purchase", async () => {
    setProfile({ selfServe: false })
    const said = { ...(await storedMessages()), ...(await storedRefusals()) }
    for (const [key, text] of Object.entries(said)) expect(text, key).not.toMatch(/upgrade|top up|top-up|\bbuy\b|purchase/i)
    // No unit: the figures are the deployment's own credits, stated as such.
    expect(said.check_insufficient).toBe("Insufficient balance. Required: 2087 credits, Available: 1534 credits")
  })
})

// ── the refusals that advise a purchase where self-serve is on ─────────────

/** Advice to buy or upgrade (the words the purchase guard counts, `stated-credit-messages-totality.test.ts`). */
const PURCHASE_ADVICE = /\btop[ -]ups?\b|\btopped up\b|\bupgrade[ds]?\b|\bbuy\b|\bbought\b|\bpurchase[ds]?\b|\badd(?:ed)? (?:more )?credits/i

/** The verdicts the failure readers reach from a saved sentence: diagnose_run's class, get_job's retryable. */
const verdictOf = (text: string) => ({ class: classifyFailure(text).class, retryable: isRetryableFailure(text) })

describe("the refusals that advise a purchase keep it only where self-serve is on", () => {
  afterEach(() => setProfile(null))
  const recorded = () => JSON.parse(readFileSync(MAINLINE_FIXTURE, "utf8")) as Record<string, string>

  it.each([
    ["a unit, self-serve on", { unitLabel: "points", unitRate: 0.25, unitDecimals: 2 }],
    ["self-serve on, said so", { selfServe: true }],
    ["a unit, self-serve on, said so", { unitLabel: "points", unitRate: 0.25, unitDecimals: 2, selfServe: true }],
  ])("%s: every one exactly as an install with nothing configured writes it", async (_case, billing) => {
    setProfile(billing)
    const said = await storedRefusals()
    const want = recorded()
    for (const [key, text] of Object.entries(said)) expect(text, key).toBe(want[key])
  })

  it.each([
    ["self-serve off", { selfServe: false }],
    ["a unit, self-serve off", { unitLabel: "points", unitRate: 0.25, unitDecimals: 2, selfServe: false }],
  ])("%s: no advice to buy or upgrade, a true next step, and every failure reader's verdict unchanged", async (_case, billing) => {
    setProfile(billing)
    const said = await storedRefusals()
    const want = recorded()
    expect(Object.keys(said).sort()).toEqual(Object.keys(said).filter((k) => k in want).sort())
    for (const [key, text] of Object.entries(said)) {
      expect(text, key).not.toMatch(PURCHASE_ADVICE)
      expect(text, key).not.toBe(want[key])
      expect(verdictOf(text), `${key}: ${text}`).toEqual(verdictOf(want[key]!))
    }
    expect(said).toEqual({
      storage_limit: "Storage limit reached (2.4 GB of 2.0 GB used). Delete files to free up space.",
      model_tier: "This model requires pro tier or higher. It is not available on this account.",
      model_blocked: "This model is not available on this account.",
      check_free_video: "Kling 3.0 is not available on free credits.",
      free_video_model: "Kling 3.0 is not available on free credits.",
      free_video_upscale: "Upscaling video is not available on free credits.",
      free_video_extend: "Extending video is not available on free credits.",
      free_video_shortest: "On free credits videos are at most 6 seconds, and Veo 3.1's shortest is 8.",
      free_video_auto: "On free credits pick a length of up to 6 seconds (not Auto).",
      free_video_duration: "On free credits videos are at most 6 seconds.",
      free_video_resolution: "On free credits Seedance 2.0 runs at 480p only.",
      free_video_size: "On free credits Wan 2.6 runs at the standard size only.",
    })
  })

  it("with nothing configured each one advises the purchase it always did", () => {
    const want = recorded()
    for (const key of Object.keys(want).filter((k) => k === "storage_limit" || k.startsWith("model_") || k.includes("free_video"))) {
      expect(want[key], key).toMatch(PURCHASE_ADVICE)
    }
  })
})
