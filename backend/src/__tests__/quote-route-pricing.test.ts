// @test-watches backend/src/routes/** backend/src/ee/routes/** backend/src/nodes/*/route*.ts backend/src/nodes/*/quote.ts
/**
 * QUOTE = CHARGE, by construction: `POST /v1/quote` prices a node type with
 * the pricing chain its RUN ROUTE registers — the same pre-check functions,
 * the same resolver and the same guard options (computeCredits, beforePricing,
 * runModel) — never a copy. This boots the whole app (Cloud edition,
 * `buildApp()`), finds the route each quotable type runs on
 * (`nodeRunRoute(type)`), and holds its preHandlers to the quote's entry: the
 * functions before the credit guard ARE `pricing.prechecks`, the guard is the
 * last preHandler (nothing the quote skips runs after it), and the guard was
 * built from `pricing.modelResolver` and `pricing.opts` themselves. It covers
 * the hand-written rows and every node unit's quote.ts alike.
 *
 * And ONE NODE DOOR: for every credit-guarded route the app registers, the
 * guard answers a request its node door refuses with exactly the refusal
 * `runNodeRefusal` gives — the function the quote asks — on a deployment that
 * offers a single node.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

const h = vi.hoisted(() => {
  const routes: Array<{ method: string; url: string; preHandlers: unknown[] }> = []
  function chain(): unknown {
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => ({ data: null, error: null })
        return () => proxy
      },
    })
    return proxy
  }
  return {
    routes,
    supabase: { from: () => chain(), rpc: () => chain(), auth: { getUser: async () => ({ data: { user: null }, error: null }) } },
  }
})

vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: async () => ({ loaded: null }) }))
vi.mock("@/lib/supabase.js", () => ({ supabase: h.supabase }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn(async () => false) }))
vi.mock("fastify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fastify")>()
  const make = ((...args: unknown[]) => {
    const app = (actual.default as unknown as (...a: unknown[]) => FastifyInstance)(...args)
    app.addHook("onRoute", (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method]
      const pre: unknown[] = r.preHandler ? (Array.isArray(r.preHandler) ? r.preHandler : [r.preHandler]) : []
      for (const method of methods) if (method !== "HEAD") h.routes.push({ method, url: r.url, preHandlers: pre })
    })
    return app
  }) as unknown as typeof actual.default
  return { ...actual, default: make }
})

import { nodeRunRoute } from "@nodaro/shared/nodes"
import { creditGuardModelOf, isCreditGuard, runNodeRefusal } from "../middleware/credit-guard.js"
import { quotableNodeOf, quotableNodeTypes } from "../ee/routes/node-quote.js"
import { __availabilityUniverseReadyForTests } from "../lib/availability-override.js"
import { __resetSurfaceProfileCacheForTests } from "../lib/surface-profile.js"

const USER = "00000000-0000-4000-8000-000000000001"
let app: FastifyInstance

beforeAll(async () => {
  const { buildApp } = await import("@/app.js")
  app = await buildApp()
  await app.ready()
  await __availabilityUniverseReadyForTests()
}, 120_000)

afterAll(async () => {
  await app?.close()
})

/** The registered POST route at `url`, and where its credit guard sits among its preHandlers. */
function routeAt(url: string): { preHandlers: unknown[]; guardAt: number } | undefined {
  const r = h.routes.find((x) => x.method === "POST" && x.url === url)
  return r ? { preHandlers: r.preHandlers, guardAt: r.preHandlers.findIndex((f) => isCreditGuard(f)) } : undefined
}

describe("every quotable type is priced with the chain its run route registers", () => {
  it("found the quotable types, the hand-written rows and the node units among them", () => {
    expect(quotableNodeTypes()).toEqual(expect.arrayContaining(["text-to-video", "edit-image", "split-into-layers"]))
  })

  it.each(quotableNodeTypes())("%s", (type) => {
    const entry = quotableNodeOf(type)!
    const url = nodeRunRoute(type)
    expect(url, `${type} has no run route of its own`).not.toBeNull()
    const route = routeAt(url!)
    expect(route, `the app registers no POST ${url}`).toBeDefined()
    expect(route!.guardAt, `POST ${url} attaches no credit guard`).toBeGreaterThanOrEqual(0)
    // The guard is the LAST preHandler: a refusal registered after it would
    // run on the run and never on the quote, so it is not allowed there.
    expect(route!.guardAt, `POST ${url}: a preHandler runs after its credit guard, where the quote never runs it`).toBe(route!.preHandlers.length - 1)
    const model = creditGuardModelOf(route!.preHandlers[route!.guardAt])!
    // The same objects, not equal copies: one resolver, one set of options.
    expect(model.modelResolver).toBe(entry.pricing.modelResolver)
    expect(model.opts).toBe(entry.pricing.opts)
    const before = route!.preHandlers.slice(0, route!.guardAt)
    expect(before.length, `POST ${url}: the preHandlers before its guard are not the quote's prechecks`).toBe(entry.pricing.prechecks.length)
    before.forEach((fn, i) => expect(fn, `POST ${url}: preHandler ${i} is not the quote's precheck ${i}`).toBe(entry.pricing.prechecks[i]))
  })
})

/** A reply that records what the guard answers. */
function recordingReply(): FastifyReply & { answered?: { status: number; body: unknown } } {
  let status = 200
  const reply = {
    sent: false,
    code(s: number) { status = s; return reply },
    status(s: number) { status = s; return reply },
    header() { return reply },
    send(body: unknown) { reply.sent = true; reply.answered = { status, body }; return reply },
  } as unknown as FastifyReply & { answered?: { status: number; body: unknown }; sent: boolean }
  return reply
}

describe("the guard's node door IS runNodeRefusal, on every credit-guarded route", () => {
  it("a deployment that offers one node: each guard refuses exactly as runNodeRefusal does", async () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ nodes: { allow: ["text-to-speech"] } })
    __resetSurfaceProfileCacheForTests()
    try {
      const guarded = h.routes.filter((r) => r.method === "POST" && r.preHandlers.some((f) => isCreditGuard(f)))
      expect(guarded.length).toBeGreaterThan(100)
      let refused = 0
      const mismatches: string[] = []
      for (const r of guarded) {
        const expected = await runNodeRefusal(r.url, {}, USER)
        if (!expected) continue
        refused++
        const guard = r.preHandlers.find((f) => isCreditGuard(f)) as (req: FastifyRequest, reply: FastifyReply) => Promise<void>
        const req = { body: {}, routeOptions: { url: r.url }, url: r.url, method: "POST", userId: USER, authKind: "jwt", headers: {} } as unknown as FastifyRequest
        const reply = recordingReply()
        await guard(req, reply)
        const got = reply.answered
        if (got?.status !== 403 || JSON.stringify((got.body as { error?: unknown }).error) !== JSON.stringify(expected)) {
          mismatches.push(`POST ${r.url}: expected 403 ${JSON.stringify(expected)}, got ${got ? `${got.status} ${JSON.stringify(got.body)}` : "no answer"}`)
        }
      }
      // Nearly every guarded route runs a node this deployment does not offer.
      expect(refused).toBeGreaterThan(100)
      expect(mismatches).toEqual([])
    } finally {
      delete process.env.NODARO_SURFACE_PROFILE
      __resetSurfaceProfileCacheForTests()
    }
  })
})
