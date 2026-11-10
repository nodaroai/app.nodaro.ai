import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

/**
 * `CreditGuardOpts.runModel` — the model a request RUNS on, judged by the
 * deployment's model restriction before anything is created or reserved.
 *
 * A route whose request may name no model runs on a default the route fills
 * in AFTER the guard; a route priced on a composite or feature id never shows
 * the guard the model at all. Without `runModel` the deny reads only the raw
 * `provider` / `models`, so leaving the model out (or naming it outside
 * `provider`) ran a model the deployment withholds, at its expense.
 *
 * The branch is asked ONLY when a model restriction is configured: profile
 * `models.allow` / `models.deny`, or an admin's stored models override. A
 * deployment with none — Nodaro's own — never calls the resolver, so nothing
 * it answers changes; the admin's per-row model switch stays with the credit
 * check, exactly as before.
 *
 * Business edition (no credits): the surface profile applies and the cloud
 * impl never loads, so the deny is the only thing that can refuse.
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business" },
  isBusiness: () => true,
  isCloud: () => false,
  isCommunity: () => false,
  hasCredits: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: async () => false, warmAdminCache: vi.fn() }))

import { creditGuard, creditGuardModelOf } from "../credit-guard.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __resetAvailabilityOverridesForTests, GATEABLE_MODEL_IDS } from "../../lib/availability-override.js"
import { __resetModelSwitchForTests } from "../../lib/model-switch.js"
import { modelRestrictionConfigured } from "../../lib/surface-deny.js"

const USER = "00000000-0000-4000-8000-000000000001"
const RUNS_ON = "gpt-image-2"
const OTHER = "nano-banana-pro"

function setProfile(json: string | null): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = json
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance
let handled: number
const runModel = vi.fn((req: FastifyRequest): string | readonly string[] | undefined => {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (Array.isArray(body.runsOn)) return body.runsOn as string[]
  if (body.runsOn === null) return undefined
  return typeof body.provider === "string" ? body.provider : RUNS_ON
})

beforeEach(async () => {
  runModel.mockClear()
  handled = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = USER
  })
  // A pricing id that is no model at all — what the run-model resolver exists for.
  app.post("/v1/generate-image", { preHandler: creditGuard(() => "composite:medium:1K", { runModel }) }, async () => {
    handled += 1
    return { ok: true }
  })
  app.post("/v1/image-to-image", { preHandler: creditGuard(() => "composite:medium:1K") }, async () => {
    handled += 1
    return { ok: true }
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  __resetModelSwitchForTests()
})

const post = (payload: Record<string, unknown> = {}, url = "/v1/generate-image") =>
  app.inject({ method: "POST", url, payload: { prompt: "a quiet harbour", ...payload } })

describe("modelRestrictionConfigured — when the run-model check is asked at all", () => {
  it("false on the stock configuration (no profile, no override, no switch)", () => {
    setProfile(null)
    expect(modelRestrictionConfigured()).toBe(false)
  })

  it("false when only NODES are restricted", () => {
    setProfile(JSON.stringify({ nodes: { allow: ["generate-image"], deny: ["generate-video"] } }))
    expect(modelRestrictionConfigured()).toBe(false)
  })

  it("false when the admin has only switched a model's row off (that lever stays with the credit check)", () => {
    __resetModelSwitchForTests([RUNS_ON])
    expect(modelRestrictionConfigured()).toBe(false)
  })

  it("true with profile models.allow, profile models.deny, or a stored models override that leaves a model off", () => {
    setProfile(JSON.stringify({ models: { allow: [OTHER] } }))
    expect(modelRestrictionConfigured()).toBe(true)
    setProfile(JSON.stringify({ models: { deny: [OTHER] } }))
    expect(modelRestrictionConfigured()).toBe(true)
    setProfile(null)
    __resetAvailabilityOverridesForTests({ models: new Set([OTHER]) })
    expect(modelRestrictionConfigured()).toBe(true)
  })

  it("false for a stored models override that ticks every model — it withholds nothing", () => {
    __resetAvailabilityOverridesForTests({ models: new Set(GATEABLE_MODEL_IDS) })
    expect(modelRestrictionConfigured()).toBe(false)
    const withoutOne = new Set(GATEABLE_MODEL_IDS)
    withoutOne.delete(RUNS_ON)
    __resetAvailabilityOverridesForTests({ models: withoutOne })
    expect(modelRestrictionConfigured()).toBe(true)
  })
})

describe("runModel — inert without a model restriction (Nodaro unchanged)", () => {
  it("never calls the resolver on the stock configuration, and the request runs", async () => {
    setProfile(null)
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(handled).toBe(1)
    expect(runModel).not.toHaveBeenCalled()
  })

  it("never calls it when only a model's row is switched off — the answer is the credit check's, as before", async () => {
    __resetModelSwitchForTests([RUNS_ON])
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(runModel).not.toHaveBeenCalled()
  })

  it("never calls it under a nodes-only profile", async () => {
    setProfile(JSON.stringify({ nodes: { deny: ["generate-video"] } }))
    expect((await post()).statusCode).toBe(200)
    expect(runModel).not.toHaveBeenCalled()
  })

  it("never calls it under a stored models override that ticks every model, even with a row switched off", async () => {
    __resetAvailabilityOverridesForTests({ models: new Set(GATEABLE_MODEL_IDS) })
    __resetModelSwitchForTests([RUNS_ON])
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(runModel).not.toHaveBeenCalled()
  })

  it("a guard without the option answers exactly as before under a model restriction", async () => {
    setProfile(JSON.stringify({ models: { allow: [OTHER] } }))
    const res = await post({}, "/v1/image-to-image")
    expect(res.statusCode).toBe(200)
    expect(handled).toBe(1)
  })
})

describe("runModel — a withheld run model is refused before the handler", () => {
  it("403 model_not_available when models.allow does not hold the model the request runs on (none named)", async () => {
    setProfile(JSON.stringify({ models: { allow: [OTHER] } }))
    const res = await post()
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({
      error: {
        code: "model_not_available",
        message: `This workflow uses a model that is not available on this deployment: ${RUNS_ON}. Switch to an available model to run this workflow.`,
      },
    })
    expect(handled).toBe(0)
    expect(runModel).toHaveBeenCalledTimes(1)
  })

  it("403 when models.deny names it", async () => {
    setProfile(JSON.stringify({ models: { deny: [RUNS_ON] } }))
    expect((await post()).statusCode).toBe(403)
    expect(handled).toBe(0)
  })

  it("403 when an admin's stored models override leaves it off", async () => {
    __resetAvailabilityOverridesForTests({ models: new Set([OTHER]) })
    const res = await post()
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("model_not_available")
  })

  it("under a restriction, a switched-off run model is refused like an explicit one", async () => {
    setProfile(JSON.stringify({ models: { deny: [OTHER] } }))
    __resetModelSwitchForTests([RUNS_ON])
    expect((await post()).statusCode).toBe(403)
  })

  it("runs when the restriction holds the model", async () => {
    setProfile(JSON.stringify({ models: { allow: [RUNS_ON] } }))
    expect((await post()).statusCode).toBe(200)
    expect(handled).toBe(1)
  })

  it("judges every id of a list, and names each refused one", async () => {
    setProfile(JSON.stringify({ models: { allow: [RUNS_ON] } }))
    const res = await post({ runsOn: [RUNS_ON, OTHER, "seedream-5-pro"] })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.message).toContain(`${OTHER}, seedream-5-pro`)
    expect(res.json().error.message).not.toContain(`${RUNS_ON},`)
  })

  it("an undefined run model judges nothing", async () => {
    setProfile(JSON.stringify({ models: { allow: [OTHER] } }))
    expect((await post({ runsOn: null })).statusCode).toBe(200)
  })

  it("an explicit model the raw check already passed is not judged twice", async () => {
    setProfile(JSON.stringify({ models: { allow: [OTHER] } }))
    expect((await post({ provider: OTHER })).statusCode).toBe(200)
  })

  it("an id outside the gateable universe is never denied by omission — only by an explicit deny", async () => {
    setProfile(JSON.stringify({ models: { allow: [OTHER] } }))
    expect((await post({ runsOn: ["not-a-catalog-model"] })).statusCode).toBe(200)
    setProfile(JSON.stringify({ models: { deny: ["not-a-catalog-model"] } }))
    expect((await post({ runsOn: ["not-a-catalog-model"] })).statusCode).toBe(403)
  })
})

describe("the guard carries what it judges, for the route census", () => {
  it("exposes the resolver and the run model on the preHandler", () => {
    const resolver = () => "x"
    const guard = creditGuard(resolver, { runModel })
    expect(creditGuardModelOf(guard)).toEqual({ modelResolver: resolver, runModel, denyResolvedModel: false })
    expect(creditGuardModelOf(creditGuard(resolver, { denyResolvedModel: true }))).toEqual({
      modelResolver: resolver,
      runModel: undefined,
      denyResolvedModel: true,
    })
    expect(creditGuardModelOf(() => undefined)).toBeUndefined()
  })
})
