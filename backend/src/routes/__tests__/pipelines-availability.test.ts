/**
 * The film pipeline is a gateable feature (`film-pipeline`,
 * lib/availability-override.ts): a deployment lists it in `nodes.allow` /
 * `nodes.deny` or Admin → Availability like a node. These hold the REAL
 * pipeline routes (`pipelinesRoutes`, and the scene helpers of
 * `sceneHelpersRoutes`) to it: every POST that starts or
 * continues a pipeline's work answers the credit guard's 403
 * `node_not_available` where the feature is withheld, before its handler (so
 * before anything is reserved), and `/cancel`, the reads and the switch to
 * manual stay open. The route list is read from the registered routes, so a
 * POST added later is held to the same door without an edit here.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("../../lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: vi.fn(() => true),
  hasAdmin: vi.fn(() => true),
  isCommunity: vi.fn(() => false),
  isBusiness: vi.fn(() => false),
  isCloud: vi.fn(() => true),
}))

// Every pipeline service is a mock: a request that passes the door must not
// reach a queue, a reservation or the database.
const services = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock("../../ee/pipelines/queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => {
    services.calls.push("enqueue")
  }),
  pipelineOrchestrationQueue: { getJobs: vi.fn(async () => []) },
}))
vi.mock("../../ee/pipelines/create-pipeline.js", () => ({
  createPipeline: vi.fn(async () => {
    services.calls.push("createPipeline")
    return { ok: true, pipelineId: "p-new" }
  }),
}))
vi.mock("../../ee/pipelines/credits.js", () => ({
  estimateUpfrontCredits: vi.fn(() => 30),
  resolveMaxCostCredits: vi.fn(() => 2000),
  reservePipelineCredits: vi.fn(async () => {
    services.calls.push("reserve")
    return { ok: true, usageLogId: "ul-1" }
  }),
  refundPipelineCredits: vi.fn(async () => undefined),
}))
vi.mock("../../ee/pipelines/engine.js", () => ({
  approveScriptStage: vi.fn(async () => ({ ok: true })),
  rejectScriptStage: vi.fn(async () => ({ ok: true })),
}))
vi.mock("../../ee/pipelines/entity-approval.js", () => ({
  approveEntity: vi.fn(async () => ({ ok: true })),
  rejectEntity: vi.fn(async () => ({ ok: true })),
}))
vi.mock("../../ee/pipelines/events.js", () => ({
  pipelineEvents: { publish: vi.fn(), subscribe: vi.fn(() => () => undefined) },
}))
vi.mock("../../lib/admin-check.js", () => ({ checkIsAdmin: async () => false }))
// A few rows keep the universe fill instant (the real registry drags the credits graph in).
vi.mock("../../lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "generate-image", category: "ai-image" },
    { type: "generative-pipeline", category: "composition" },
  ],
}))
// Every read finds nothing: a request that passes the door ends at "not found".
vi.mock("../../lib/supabase.js", () => {
  function chain(): unknown {
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null, count: 0 }).then(ok, ko)
        }
        if (prop === "single" || prop === "maybeSingle") return async () => ({ data: null, error: null })
        return () => proxy
      },
    })
    return proxy
  }
  return { supabase: { from: () => chain(), rpc: () => chain() } }
})

import { pipelinesRoutes } from "../pipelines.js"
import { sceneHelpersRoutes } from "../scene-helpers.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import {
  __availabilityUniverseReadyForTests,
  __resetAvailabilityOverridesForTests,
  storedNodesEnabled,
} from "../../lib/availability-override.js"

const USER = "00000000-0000-4000-8000-000000000001"
const ID = "00000000-0000-4000-8000-0000000000aa"

const routes: Array<{ method: string; url: string }> = []

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("onRoute", (r) => {
    for (const method of Array.isArray(r.method) ? r.method : [r.method]) {
      if (method !== "HEAD" && r.url.startsWith("/v1/pipelines")) routes.push({ method, url: r.url })
    }
  })
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = USER
  })
  await app.register(pipelinesRoutes)
  await app.register(sceneHelpersRoutes)
  // A route outside both plugins: their hook must stay inside them (registered
  // with a plain `app.register`, as app.ts does — never fastify-plugin).
  app.post("/v1/outside", async () => ({ ok: true }))
  await app.ready()
  return app
}

function setProfile(profile: object | null): void {
  if (profile === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  __resetSurfaceProfileCacheForTests()
}

/** A concrete URL for a route pattern (every parameter a valid id or stage). */
function concrete(url: string): string {
  return url
    .replace(":stage_name", "script")
    .replace(":gate", "audio")
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ID)
}

const call = (method: string, url: string) =>
  app.inject({ method: method as "POST", url: concrete(url), payload: method === "GET" ? undefined : {} })

let app: FastifyInstance
beforeAll(async () => {
  await __availabilityUniverseReadyForTests()
  app = await buildApp()
})
afterEach(() => {
  setProfile(null)
  __resetAvailabilityOverridesForTests()
  services.calls = []
})

const posts = () => routes.filter((r) => r.method === "POST")
const starters = () => posts().filter((r) => !r.url.endsWith("/cancel"))

describe("the pipeline routes the door covers", () => {
  it("found every POST the plugin registers (creation, branch, fork, approvals, edits, regenerations, chat)", () => {
    const urls = starters().map((r) => r.url)
    expect(urls.length).toBeGreaterThanOrEqual(20)
    expect(urls).toEqual(
      expect.arrayContaining([
        "/v1/pipelines",
        "/v1/pipelines/:id/branch",
        "/v1/pipelines/:id/fork",
        "/v1/pipelines/:id/stages/:stage_name/approve",
        "/v1/pipelines/:id/stages/:stage_name/edit",
        "/v1/pipelines/:id/stages/:stage_name/reject",
        "/v1/pipelines/:id/stages/script/regenerate-scene",
        "/v1/pipelines/:id/stages/:stage_name/chat",
        "/v1/pipelines/:id/stages/:stage_name/chat/turns/:turnId/apply",
        "/v1/pipelines/:id/scenes/:scene_id/shots/:shot_id/regenerate-keyframe",
        "/v1/pipelines/:id/entities/:entity_id/retry-image-generation",
        "/v1/pipelines/:id/sub-gates/:gate/approve",
        "/v1/pipelines/:id/entities/:sceneId/helpers/accept_match_cut_break",
      ]),
    )
    // The scene helpers (one route per helper, plus accepting a match-cut break).
    expect(urls.filter((u) => u.includes("/helpers/")).length).toBeGreaterThanOrEqual(7)
    expect(posts().map((r) => r.url)).toContain("/v1/pipelines/:id/cancel")
  })
})

describe("under nodes.allow without film-pipeline", () => {
  it("every POST that starts or continues work answers 403 node_not_available, before its handler", async () => {
    setProfile({ nodes: { allow: ["generate-image", "generative-pipeline"] } })
    const wrong: string[] = []
    for (const r of starters()) {
      const res = await call(r.method, r.url)
      const code = (res.json() as { error?: { code?: string; message?: string } }).error
      if (res.statusCode !== 403 || code?.code !== "node_not_available" || !code.message?.includes("film-pipeline")) {
        wrong.push(`${r.method} ${r.url} → ${res.statusCode} ${res.body.slice(0, 120)}`)
      }
    }
    expect(wrong).toEqual([])
    // Nothing was created, enqueued or reserved.
    expect(services.calls).toEqual([])
  })

  it("the hook stays inside the pipeline plugins: a POST outside them is not refused", async () => {
    setProfile({ nodes: { allow: ["generate-image"] } })
    const res = await app.inject({ method: "POST", url: "/v1/outside", payload: {} })
    expect(res.statusCode).toBe(200)
  })

  it("cancel, the reads and the switch to manual are not refused", async () => {
    setProfile({ nodes: { allow: ["generate-image"] } })
    const open = [
      ...routes.filter((r) => r.method === "GET" && r.url !== "/v1/pipelines/:id/events"),
      ...routes.filter((r) => r.method === "PATCH"),
      ...posts().filter((r) => r.url.endsWith("/cancel")),
    ]
    expect(open.length).toBeGreaterThan(3)
    for (const r of open) {
      const res = await call(r.method, r.url)
      expect(res.body, `${r.method} ${r.url}`).not.toContain("node_not_available")
    }
  })
})

describe("where the film pipeline is offered, the door lets the request through to the route", () => {
  // POST /v1/pipelines with an empty body passes the door and stops at the
  // route's own body check: proof the door answered "available".
  const create = async () => {
    const res = await app.inject({ method: "POST", url: "/v1/pipelines", payload: {} })
    return res
  }

  it("with no node lists and no override (Nodaro Cloud today)", async () => {
    const res = await create()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("with film-pipeline in nodes.allow", async () => {
    setProfile({ nodes: { allow: ["generate-image", "film-pipeline"] } })
    expect((await create()).statusCode).toBe(400)
  })

  it("under an override stored before film-pipeline was gateable (it never decided it)", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image", "cast-swap"], 1)) })
    expect((await create()).statusCode).toBe(400)
  })

  it("but not under an override saved by this code with it left off", async () => {
    __resetAvailabilityOverridesForTests({ nodes: new Set(storedNodesEnabled(["generate-image"])) })
    const res = await create()
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("node_not_available")
  })
})
