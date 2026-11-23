// @test-units-by-name quotes only the node type it names (edit-video-pro)
/**
 * POST /v1/quote on a ROUTE-PRICED type (Edit Video Pro): its run route is
 * registered by a module this repo does not hold, so the quote reads the
 * pricing chain off the route as the app registered it
 * (lib/route-pricing-registry.ts). A stand-in route, shaped as such a module
 * registers it — a pre-check that judges the body and keeps what it measured
 * keyed by the body object, then the credit guard whose `computeCredits` reads
 * that — proves: the quote equals what the run reserves; a refusal the
 * pre-check gives (a span too short, a span past the source) is the quote's
 * too, word for word; the quote says the hold settles to what was generated;
 * a client's `origin` and `sessionId` in the body do not refuse it; and where
 * the route is not registered the type cannot be quoted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import { z } from "zod"

vi.mock("../../../lib/config.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/config.js")>("../../../lib/config.js")
  return { ...actual, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, isCloud: () => true, hasAdmin: () => true }
})
vi.mock("../../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn() }))
vi.mock("../../../lib/app-settings.js", () => ({
  // A real markup, so the quote has to mark up exactly as the reservation does.
  getAppSettings: vi.fn(() => Promise.resolve({ cost_markup_percent: 10 })),
}))

const fakeProfile = {
  role: "user", tier: "standard", subscription_tier: "standard",
  subscription_credits: 100000, topup_credits: 0,
  daily_spent_credits: 0, last_daily_reset: null,
  storage_used_bytes: 0, storage_limit_bytes: 1e10,
}
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: fakeProfile, error: null }) }) }) }
      }
      if (table === "jobs") {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }
      }
      if (table === "model_pricing") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { credit_cost: 100, is_enabled: true, tier_restriction: null }, error: null }) }) }) }
      }
      return {}
    }),
  },
}))

const reserveSpy = vi.fn((..._args: unknown[]) => Promise.resolve({ usageLogId: "log-1", creditsReserved: 1, watermark: false }))
vi.mock("../../billing/credits.js", async () => {
  const actual = await vi.importActual<typeof import("../../billing/credits.js")>("../../billing/credits.js")
  return {
    ...actual,
    CreditsService: {
      checkStorageLimitWithProfile: () => ({ allowed: true, usedBytes: 0, limitBytes: 1e10 }),
      checkCreditsWithProfile: vi.fn(() => Promise.resolve({ allowed: true, watermark: false })),
      reserveCredits: reserveSpy,
    },
  }
})

import { creditGuard, reserveCreditsForJob } from "../../../middleware/credit-guard.js"
import { createRoutePricingRegistry, quotableRoutePricing } from "../../../lib/route-pricing-registry.js"

/** The source's length the stand-in route "probes". */
const SOURCE_SEC = 30
/** BASE credits per second of span, plus a flat fee: enough to tell spans apart. */
const baseCreditsOf = (spanSec: number): number => 100 + 7 * spanSec

/** A run route as a deployment's module registers it. */
function moduleRoute(app: FastifyInstance): void {
  const measured = new WeakMap<object, { spanSec: number }>()
  const precheck = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = req.body as { spanStart?: unknown; spanEnd?: unknown } | null
    if (!body || typeof body.spanStart !== "number" || typeof body.spanEnd !== "number") return
    const spanSec = body.spanEnd - body.spanStart
    if (spanSec < 4) {
      return void reply.status(400).send({ error: { code: "validation_error", message: "Replace span must be at least 4 seconds" } })
    }
    if (body.spanEnd > SOURCE_SEC) {
      return void reply.status(400).send({ error: { code: "span_exceeds_source", message: `The span end (${body.spanEnd}s) is beyond the end of the video (${SOURCE_SEC}.0s)` } })
    }
    // Keyed by the body OBJECT, as such a route does: the guard below reads it back.
    measured.set(body, { spanSec })
  }
  app.post(
    "/v1/edit-video-pro",
    {
      // The route's own word that its pre-checks may run for a quote.
      config: { quotable: true },
      preHandler: [
        precheck,
        creditGuard(() => "edit-video-pro", {
          computeCredits: (raw) => {
            const kept = raw !== null && typeof raw === "object" ? measured.get(raw) : undefined
            if (!kept) throw new Error("the guard priced a body the pre-check never measured")
            return baseCreditsOf(kept.spanSec)
          },
        }),
      ],
    },
    async (req, reply) => {
      const reservation = await reserveCreditsForJob(req, reply, "job-1", "edit-video-pro")
      if (reply.sent) return
      return reply.send({ jobId: "job-1", usageLogId: reservation?.usageLogId })
    },
  )
}

async function buildApp(opts: { withRoute: boolean }): Promise<FastifyInstance> {
  const app = Fastify()
  // As app.ts does, before any route.
  const registry = createRoutePricingRegistry()
  app.addHook("onRoute", registry.note)
  app.decorate("routePricingOf", registry.pricingOf)
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = "00000000-0000-4000-8000-000000000001"
  })
  const { registerNodeQuote } = await import("../node-quote.js")
  // The quote route first, in a context of its own: a module's route registers after it, as in the app.
  await app.register(async (instance) => registerNodeQuote(instance))
  if (opts.withRoute) await app.register(async (instance) => moduleRoute(instance))
  return app
}

const BODY = { videoUrl: "https://cdn.example.com/clip.mp4", spanStart: 5, spanEnd: 13, prompt: "the dog jumps into the pool" }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /v1/quote on a route-priced type", () => {
  it("prices with the chain the route registered: the quote is what the run reserves", async () => {
    const app = await buildApp({ withRoute: true })
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "edit-video-pro", params: BODY } })
    expect(q.statusCode, q.body).toBe(200)
    const quote = q.json().data as { identifier: string; reserve: number; warnings: { code: string }[] }
    expect(reserveSpy).not.toHaveBeenCalled()
    const run = await app.inject({ method: "POST", url: "/v1/edit-video-pro", payload: BODY })
    expect(run.statusCode, run.body).toBe(200)
    const [, , identifier, , , options] = reserveSpy.mock.calls[0]! as [string, string, string, number, number, { creditOverride?: number }]
    expect(quote.identifier).toBe(identifier)
    // 8 seconds: (100 + 56) base, marked up 10%.
    expect(options.creditOverride).toBe(Math.ceil(baseCreditsOf(8) * 1.1))
    expect(quote.reserve).toBe(options.creditOverride)
    expect(quote.warnings.map((w) => w.code)).toEqual(["settles_to_actual"])
    await app.close()
  })

  it("a longer span quotes more, and what a client app sends beside the params does not refuse it", async () => {
    const app = await buildApp({ withRoute: true })
    const quoteOf = async (params: Record<string, unknown>) =>
      (await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "edit-video-pro", params } })).json().data.reserve as number
    const short = await quoteOf(BODY)
    const long = await quoteOf({ ...BODY, spanEnd: 25, origin: "video-player", sessionId: "00000000-0000-4000-8000-0000000000aa", provider: "seedance-2-fast", referenceImageUrls: [] })
    expect(long).toBeGreaterThan(short)
    await app.close()
  })

  it.each([
    ["a span under 4 seconds", { ...BODY, spanEnd: 7 }, "validation_error"],
    ["a span past the end of the video", { ...BODY, spanStart: 20, spanEnd: 40 }, "span_exceeds_source"],
  ] as const)("%s: the quote gives the run's own refusal, nothing priced", async (_name, params, code) => {
    const app = await buildApp({ withRoute: true })
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "edit-video-pro", params } })
    const run = await app.inject({ method: "POST", url: "/v1/edit-video-pro", payload: params })
    expect(q.statusCode).toBe(400)
    expect(q.json().error.code).toBe(code)
    expect(q.json()).toEqual(run.json())
    expect(reserveSpy).not.toHaveBeenCalled()
    await app.close()
  })

  it("a body with no source or no span is refused here, before the route's chain prices it", async () => {
    const app = await buildApp({ withRoute: true })
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "edit-video-pro", params: { prompt: "x" } } })
    expect(q.statusCode).toBe(400)
    expect(q.json().error.code).toBe("validation_error")
    await app.close()
  })

  it("where the route is not registered the type cannot be quoted, and is not listed", async () => {
    const app = await buildApp({ withRoute: false })
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "edit-video-pro", params: BODY } })
    expect(q.statusCode).toBe(400)
    expect(q.json().error.code).toBe("quote_unsupported")
    expect(q.json().error.supported).not.toContain("edit-video-pro")
    expect(q.json().error.supported).toContain("switchx")
    await app.close()
  })

  it("lists the type once its route is registered", async () => {
    const app = await buildApp({ withRoute: true })
    const q = await app.inject({ method: "POST", url: "/v1/quote", payload: { type: "no-such-node", params: {} } })
    expect(q.json().error.supported).toContain("edit-video-pro")
    await app.close()
  })
})

describe("the registry keeps a route only by its own word, and fails closed", () => {
  const guard = creditGuard(() => "x")
  const other = async () => undefined
  const quotable = { config: { quotable: true } }

  it("kept: a POST route that says it is quotable, its credit guard last", () => {
    expect(quotableRoutePricing({ method: ["POST", "HEAD"], url: "/e", preHandler: guard, ...quotable })?.prechecks).toEqual([])
    expect(quotableRoutePricing({ method: "POST", url: "/f", preHandler: [other, guard], ...quotable })?.prechecks).toEqual([other])
  })

  it.each([
    ["it does not say it is quotable", { method: "POST", url: "/a", preHandler: [guard] }],
    ["a preHandler runs after its guard", { method: "POST", url: "/a", preHandler: [guard, other], ...quotable }],
    ["it has no credit guard", { method: "POST", url: "/a", preHandler: [other], ...quotable }],
    ["it has no preHandler", { method: "POST", url: "/a", ...quotable }],
    ["another method", { method: "GET", url: "/a", preHandler: [guard], ...quotable }],
    ["a door of its own before parsing", { method: "POST", url: "/a", preHandler: [guard], onRequest: other, ...quotable }],
    ["a door of its own before validation", { method: "POST", url: "/a", preHandler: [guard], preValidation: [other], ...quotable }],
    ["a body schema of its own", { method: "POST", url: "/a", preHandler: [guard], schema: { body: {} }, ...quotable }],
  ] as const)("not kept: %s", (_why, route) => {
    expect(quotableRoutePricing(route)).toBeUndefined()
  })

  it("the first registration of an address is the one kept, and two registries never share routes", () => {
    const one = createRoutePricingRegistry()
    const two = createRoutePricingRegistry()
    one.note({ method: "POST", url: "/a", preHandler: [other, guard], ...quotable })
    one.note({ method: "POST", url: "/a", preHandler: [guard], ...quotable })
    expect(one.pricingOf("/a")?.prechecks).toEqual([other])
    expect(two.pricingOf("/a")).toBeUndefined()
  })
})
