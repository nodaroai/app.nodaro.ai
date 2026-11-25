/**
 * One rule decides which plans may keep outputs private, asked in two places:
 * the settings route before it switches private mode on, and every plan change
 * (`tierColumns`), which returns the setting to public on a drop from a plan
 * with it to one without. This drives both with the same plans and requires
 * them to agree: a plan the route refuses private mode on is exactly a plan a
 * drop to which (from Pro) resets the setting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/config/prompt-templates.js", () => ({
  SYSTEM_PROMPT_TEMPLATES: {},
  applyTemplate: vi.fn(),
}))

import { userSettingsRoutes } from "../../../routes/user-settings.js"
import { supabase } from "../../../lib/supabase.js"
import { tierColumns } from "../tier-columns.js"

const USER = "00000000-0000-4000-8000-0000000000aa"
/** Every stored tier a profile can hold, plus values a stale or odd row could carry. */
const TIERS = ["free", "basic", "standard", "pro", "business", "enterprise", "payg", "unknown-plan"]

let app: FastifyInstance

function profile(tier: string, extra: Record<string, unknown> = {}) {
  vi.mocked(supabase.from).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { tier, public_outputs: true, ...extra }, error: null }),
      }),
    }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  } as never)
  vi.mocked(supabase.rpc).mockResolvedValue({ data: 0, error: null } as never)
}

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (instance) => {
    await userSettingsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("the settings route and the plan-change reset ask the same rule", () => {
  it.each(TIERS)("%s: refused private mode exactly when a drop to it (from Pro) resets the setting", async (tier) => {
    profile(tier)
    const res = await app.inject({ method: "PATCH", url: "/v1/user/settings", payload: { publicOutputs: false } })

    const routeAllows = res.statusCode === 200
    expect([200, 403]).toContain(res.statusCode)
    const resets = "public_outputs" in tierColumns(tier, "pro")
    expect(resets).toBe(!routeAllows)
    // ...and a move FROM it to Free resets exactly when the route would have let it be private.
    expect("public_outputs" in tierColumns("free", tier)).toBe(routeAllows)
  })

  it.each(TIERS)("%s: GET /v1/user/settings reports privateOutputsAllowed by the same rule", async (tier) => {
    profile(tier)
    const res = await app.inject({ method: "GET", url: "/v1/user/settings" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.privateOutputsAllowed).toBe(!("public_outputs" in tierColumns(tier, "pro")))
  })

  it("covers both answers (the table is not all one side)", () => {
    const resets = TIERS.filter((tier) => "public_outputs" in tierColumns(tier, "pro"))
    expect(resets).toEqual(expect.arrayContaining(["free", "basic"]))
    expect(TIERS.filter((tier) => !resets.includes(tier))).toEqual(["standard", "pro", "business"])
  })
})

describe("GET /v1/user/settings: privateOutputsEndedByPlanAt, for the Settings card", () => {
  const SINCE = "2026-11-25T08:00:00.000Z"
  const get = async () => (await app.inject({ method: "GET", url: "/v1/user/settings" })).json().data.privateOutputsEndedByPlanAt

  it("the day a plan drop returned the outputs to public, while still on a plan without private outputs", async () => {
    profile("basic", { outputs_public_since: SINCE, outputs_public_reason: "plan" })
    expect(await get()).toBe(SINCE)
  })

  it.each([
    ["the person's own switch back", "basic", { outputs_public_since: SINCE, outputs_public_reason: "owner" }],
    ["back on a plan that allows it", "pro", { outputs_public_since: SINCE, outputs_public_reason: "plan" }],
    ["private again", "basic", { outputs_public_since: SINCE, outputs_public_reason: "plan", public_outputs: false }],
    ["never reset", "free", {}],
  ])("null after %s", async (_label, tier, extra) => {
    profile(tier as string, extra as Record<string, unknown>)
    expect(await get()).toBeNull()
  })
})
