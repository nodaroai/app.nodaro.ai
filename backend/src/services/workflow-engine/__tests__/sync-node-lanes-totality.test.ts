/**
 * EVERY WORKFLOW SYNC NODE IS ACCOUNTED FOR BY THE LANES.
 *
 * A workflow's sync-HTTP node calls a route over HTTP. Where that route takes
 * a slot in the request (its laneGuard), the orchestrator takes the same slot
 * first, under the run's hold and the queue timeout, and names it to the
 * route (sync-node-slot.ts) — so a workflow never waits under the live-wait
 * limit and never fails `lane_busy`. That only works if the orchestrator
 * process, which registers no route, knows each route's lane: it reads the
 * static rule table (lib/concurrency-lanes/sync-route-lanes.ts), and this
 * test holds the routes the app REALLY registers (`buildApp`) to that table —
 * the same lane, and a guard built from the table's rule, never a second
 * hand-kept list.
 *
 * Every SYNC_HTTP_NODES entry is exactly one of:
 *   - pre-acquired (it has a ROUTE_LANES entry);
 *   - answers with a job id (its work runs in a worker job, which waits for
 *     its own slot at pickup), with that job type;
 *   - does no lane work in the request, with the reason;
 *   - served by the Cloud plugin (its routes are not registered here).
 * A new entry fails until it is placed, and a stale placement fails too.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { FastifyInstance } from "fastify"

vi.mock("@/lib/overlay/load.js", () => ({ loadOverlay: async () => ({ loaded: null }) }))
vi.mock("@/lib/supabase.js", () => {
  const chain = (): unknown => {
    const answer = { data: null, error: null }
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(answer).then(ok, ko)
        if (prop === "single" || prop === "maybeSingle") return async () => answer
        return () => proxy
      },
    })
    return proxy
  }
  return { supabase: { from: () => chain(), rpc: () => chain(), auth: { getUser: async () => ({ data: { user: null }, error: null }) } } }
})

const { SYNC_HTTP_NODES, SYNC_HTTP_ROUTES, ROUTE_LANES, buildSyncHttpBody } = await import("../node-executor.js")
const { PLUGIN_SERVED_SYNC_TYPES } = await import("../ugc-sync-nodes.js")
const { SYNC_ROUTE_LANE_RULES, syncRouteLaneDecision } = await import("../../../lib/concurrency-lanes/sync-route-lanes.js")
const { laneOfRoute, laneRuleOfRoute } = await import("../../../lib/concurrency-lanes/request-scope.js")
const { wantsJobIdFirst } = await import("../../../lib/request-helpers.js")
const { SCENE3D_EDIT_JOB_TYPE, SCENE3D_GENERATE_JOB_TYPE } = await import("../../../routes/3d-scene.js")
const { PRO3D_RENDER_JOB_TYPE } = await import("../../../routes/pro-3d-render.js")
const { SITE_CAPTURE_JOB_TYPE } = await import("../../../lib/background-scrape/site-capture.js")
const { INSTAGRAM_SCRAPE_JOB_TYPE } = await import("../../../lib/background-scrape/instagram.js")
type OrchestratorContext = import("../types.js").OrchestratorContext

/** Nodes whose route answers with a job id: the worker job that does the work, and waits for its slot at pickup. */
const ANSWERS_WITH_JOB_ID: ReadonlyMap<string, string> = new Map([
  ["site-capture", SITE_CAPTURE_JOB_TYPE],
  ["instagram-scrape", INSTAGRAM_SCRAPE_JOB_TYPE],
  ["generate-3d-scene", SCENE3D_GENERATE_JOB_TYPE],
  ["edit-3d-scene", SCENE3D_EDIT_JOB_TYPE],
  ["pro-3d-render", PRO3D_RENDER_JOB_TYPE],
])

/** Nodes whose route does no provider or LLM work in the request, and why. */
const NO_LANE_WORK: ReadonlyMap<string, string> = new Map([
  ...["instagram-post", "tiktok-post", "youtube-upload", "linkedin-post", "x-post", "facebook-post", "telegram-post", "publish-social"]
    .map((t): [string, string] => [t, "publishes to the user's own connected account: no AI provider is called"]),
  ["telegram-channel-feed", "reads a public channel page: no AI provider is called"],
  ["save-to-storage", "copies a file into storage"],
  ["collection-write", "writes a collection record"],
  ["collection-read", "reads collection records"],
  ["inspiration-read", "reads saved posts"],
  ["competitor-read", "reads saved competitor posts"],
])

let app: FastifyInstance

beforeAll(async () => {
  const { buildApp } = await import("@/app.js")
  app = await buildApp()
  await app.ready()
}, 60_000)

afterAll(async () => {
  await app?.close()
})

describe("workflow sync nodes and their lanes", () => {
  it("every SYNC_HTTP_NODES entry is placed exactly once", () => {
    const placements = (type: string): string[] => [
      ...(ROUTE_LANES.has(type) ? ["pre-acquired"] : []),
      ...(ANSWERS_WITH_JOB_ID.has(type) ? ["answers-with-job-id"] : []),
      ...(NO_LANE_WORK.has(type) ? ["no-lane-work"] : []),
      ...(PLUGIN_SERVED_SYNC_TYPES.has(type) ? ["plugin-served"] : []),
    ]
    const wrong = [...SYNC_HTTP_NODES].map((t) => [t, placements(t)] as const).filter(([, p]) => p.length !== 1)
    expect(
      wrong.map(([t, p]) => `  • ${t}: ${p.length === 0 ? "not placed" : p.join(" + ")}`),
      `Place each workflow sync node exactly once: a route that does provider or LLM work in the request gets a rule in ` +
        `lib/concurrency-lanes/sync-route-lanes.ts (and its laneGuard is built from it); otherwise list it here with its job type or reason.`,
    ).toEqual([])
    // Anti-vacuity: the pre-acquired ones are the routes the lanes guard today.
    expect([...ROUTE_LANES.keys()].sort()).toEqual([
      "3d-title", "after-effects", "ai-writer", "describe-to-picker", "image-critic", "image-to-text", "llm-chat",
      "lottie-overlay", "meta-ads-scrape", "motion-graphics", "qa-check", "reduce", "suno-style-boost", "video-composer", "web-scrape",
    ])
  })

  it("has no stale placement", () => {
    const stale = [...ANSWERS_WITH_JOB_ID.keys(), ...NO_LANE_WORK.keys()].filter((t) => !SYNC_HTTP_NODES.has(t))
    expect(stale).toEqual([])
    const urls = new Set(Object.values(SYNC_HTTP_ROUTES))
    expect(Object.keys(SYNC_ROUTE_LANE_RULES).filter((u) => !urls.has(u)), "a rule for a route no sync node calls").toEqual([])
  })

  it("the routes the app registers agree with the rule table: same lane, guard built from the rule", () => {
    const disagree: string[] = []
    for (const [type, url] of Object.entries(SYNC_HTTP_ROUTES)) {
      if (PLUGIN_SERVED_SYNC_TYPES.has(type)) continue
      const rule = SYNC_ROUTE_LANE_RULES[url]
      const registered = laneOfRoute(url)
      if (registered !== (rule?.lane ?? null)) disagree.push(`  • ${type} (${url}): the route takes ${registered ?? "no lane"}, the table says ${rule?.lane ?? "none"}`)
      if (rule && laneRuleOfRoute(url) !== url) disagree.push(`  • ${type} (${url}): its laneGuard is not built from the table's rule (laneGuard(...syncRouteLane("${url}")))`)
    }
    expect(disagree).toEqual([])
    // Anti-vacuity: the app really registered the guards.
    expect(laneOfRoute("/v1/llm-chat/generate")).toBe("llm")
    expect(laneOfRoute("/v1/web-scrape")).toBe("provider")
  })

  it("each answers-with-job-id node names its worker job type", () => {
    for (const [type, jobType] of ANSWERS_WITH_JOB_ID) expect(jobType, type).toMatch(/^[a-z0-9-]+$/)
    // The 3D nodes' jobs are named by the routes that enqueue them.
    expect(ANSWERS_WITH_JOB_ID.get("pro-3d-render")).toBe("pro-3d-render")
    expect(ANSWERS_WITH_JOB_ID.get("generate-3d-scene")).toBe("generate-3d-scene")
  })

  it("an answers-with-job-id route takes no lane in the request", () => {
    for (const type of ANSWERS_WITH_JOB_ID.keys()) expect(laneOfRoute(SYNC_HTTP_ROUTES[type]!), type).toBeNull()
  })

  it("node-executor never sends the job-id-first flag: the scrapers are called synchronously and pre-acquired", () => {
    const ctx = { userId: "U", executionId: "exec-1", billingContext: { payer: "user", userId: "U" } } as unknown as OrchestratorContext
    for (const node of [
      { id: "w", type: "web-scrape", data: { actor: "google-search", query: "cats" } },
      { id: "w2", type: "web-scrape", data: { actor: "content-crawler", url: "https://example.com", respondAsync: true } },
      { id: "m", type: "meta-ads-scrape", data: { source: "search", keyword: "shoes", respondAsync: true } },
    ]) {
      const body = buildSyncHttpBody(node, {}, ctx)
      expect(wantsJobIdFirst(body), node.id).toBe(false)
      expect(syncRouteLaneDecision(SYNC_HTTP_ROUTES[node.type]!, body), node.id).toEqual({ lane: "provider", provider: "apify" })
    }
  })
})
