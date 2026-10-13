/**
 * The photo influence set's guard (lib/__tests__/ugc-photo-sentinel-cases.ts), (b): a run by
 * anyone but the author of a graph with a UGC Creator on My photo needs the runner's own photo.
 * For every case, at every run of something published — an app's runner, a component's caller,
 * a share link's viewer — and at the one check they all call (`ugcRunMissesPhoto`):
 * - with nothing of the runner's own, the run is refused (`ugc_photo_required`) before anything is
 *   written or queued — whatever the author's graph holds;
 * - with a value of the runner's own given to a node that feeds no creator's photo, still refused;
 * - with the runner's own photo (`runnerGives`), it runs. A control with no My photo creator runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { SentinelCase } from "../../lib/__tests__/ugc-photo-sentinel-cases.js"

const h = vi.hoisted(() => ({
  current: null as SentinelCase | null,
  queueAdd: vi.fn().mockResolvedValue({ id: "orch-job-1" }),
  executeAppRun: vi.fn(),
  insertJob: vi.fn(),
  writes: [] as string[],
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true, hasOrganizations: () => false }
})
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: h.queueAdd } }))
vi.mock("@/services/app-execution.js", () => ({ executeAppRun: h.executeAppRun }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: h.insertJob, insertJobIdempotent: vi.fn(), billingPairColumns: () => ({}) }))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/routes/_collect-component-outputs.js", () => ({ collectComponentOutputs: vi.fn().mockResolvedValue({ output: {} }) }))

import { presentationRoutes } from "../presentation.js"
import { componentExecuteRoutes } from "../component-execute.js"
import { appRunnerRoutes, invalidateAppCache } from "../app-runner.js"
import { supabase } from "../../lib/supabase.js"
import { CreditsService } from "../../ee/billing/credits.js"
import { ugcRunMissesPhoto } from "../../lib/ugc-app-run.js"
import { CONTROL_CASES, SENTINEL_CASES, RUNNERS_PHOTO } from "../../lib/__tests__/ugc-photo-sentinel-cases.js"

const AUTHOR = "00000000-0000-4000-8000-0000000000a1"
const RUNNER = "00000000-0000-4000-8000-0000000000c3"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const SLUG = "sentinel-app"

/** The case published (an app's or a component's snapshot) and shared (a share link), the author's other workflows by id. */
function serve(): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const c = h.current!
    let id: unknown
    const appRow = {
      id: "app-1", workflow_id: WORKFLOW_ID, creator_id: AUTHOR, name: "Sentinel", version: 1, max_runs_per_user_per_day: null,
      snapshot_nodes: c.graph.nodes, snapshot_edges: c.graph.edges, snapshot_settings: c.settings, publish_type: "app",
      component_metadata: { inputs: [], outputs: [], exposedSettings: [] }, estimated_credits: 0,
    }
    let slug: unknown
    const component = () => (typeof slug === "string" && c.components && Object.hasOwn(c.components, slug) ? c.components[slug] : undefined)
    const componentRow = () => {
      const found = component()
      return found ? { snapshot_nodes: found.graph.nodes, snapshot_edges: found.graph.edges, creator_id: found.creatorId } : undefined
    }
    const one = () => {
      if (table === "published_apps") return componentRow() ?? appRow
      if (table === "workflows") {
        if (typeof id === "string" && Object.hasOwn(c.workflows, id)) return c.workflows[id]
        // A workflow the author does not have (a deleted sub-workflow's): no row.
        if (typeof id === "string" && id !== WORKFLOW_ID) return null
        return { id: WORKFLOW_ID, name: "Shared", user_id: AUTHOR, workspace_id: null, settings: c.settings, nodes: c.graph.nodes, edges: c.graph.edges, is_presentation_enabled: true }
      }
      // A row written, or the inner run a component's wrapper waits on: over, so the wait ends.
      if (table === "workflow_executions" || table === "app_runs") return { id: "row-1", status: "failed", node_states: {} }
      return null
    }
    // A list read: a component's snapshot by its slug, or the app's version; nothing running already.
    const many = () => (table === "published_apps" ? [componentRow() ?? appRow] : [])
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: many(), error: null, count: 0 })
        if (prop === "single" || prop === "maybeSingle") return async () => ({ data: one(), error: null })
        if (prop === "insert" || prop === "update" || prop === "upsert") {
          return () => {
            h.writes.push(table)
            return new Proxy({}, handler)
          }
        }
        if (prop === "eq") {
          return (column: string, value: unknown) => {
            if (column === "id") id = value
            // The component a node runs, looked up by its slug (the route's own app is served by any other slug).
            if (column === "slug" && c.components && Object.hasOwn(c.components, value as string)) slug = value
            return new Proxy({}, handler)
          }
        }
        return () => new Proxy({}, handler)
      },
    }
    return new Proxy({}, handler) as never
  }) as never)
}

let app: FastifyInstance
let eligibility: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.clearAllMocks()
  h.writes.length = 0
  invalidateAppCache(SLUG)
  h.executeAppRun.mockResolvedValue({ executionId: "exec-1", appRunId: "run-1", deduped: false })
  h.insertJob.mockResolvedValue({ data: { id: "wrapper-1" }, error: null })
  eligibility = vi.spyOn(CreditsService, "checkAppRunEligibility").mockResolvedValue({ allowed: true } as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = RUNNER
    req.authKind = "jwt"
  })
  await app.register(async (instance) => {
    await presentationRoutes(instance)
    await appRunnerRoutes(instance)
  })
  await app.register(componentExecuteRoutes)
  await app.ready()
})

/** A run that goes ahead keeps writing after its answer (a component's wrapper job follows the run): let it finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

afterEach(async () => {
  await settle()
  eligibility.mockRestore()
  await app.close()
})

const ROUTES = [
  { route: "a share link's viewer", run: (inputOverrides: unknown) => app.inject({ method: "POST", url: "/v1/present/share-token-abc/run", payload: { inputOverrides } }) },
  { route: "an app's runner", run: (inputOverrides: unknown) => app.inject({ method: "POST", url: `/v1/app/${SLUG}/run`, payload: { inputOverrides } }) },
  { route: "a component's caller", run: (inputOverrides: unknown) => app.inject({ method: "POST", url: "/v1/component/execute", payload: { appSlug: SLUG, inputOverrides } }) },
] as const

/** A value of the runner's own given to a node that feeds no creator's photo. */
const ELSEWHERE = { site: { text: "the runner's own site" }, shot: { url: RUNNERS_PHOTO } }

describe.each(ROUTES.map((r) => [r.route, r] as const))("%s", (_route, r) => {
  it.each(SENTINEL_CASES.map((c) => [c.name, c] as const))("%s: refused with nothing of the runner's, or only elsewhere; runs with the runner's own photo", async (_name, c) => {
    h.current = c
    serve()
    for (const overrides of [{}, ELSEWHERE]) {
      const refused = await r.run(overrides)
      expect(refused.statusCode, refused.body).toBe(400)
      expect(refused.json().error.code).toBe("ugc_photo_required")
    }
    expect(h.writes, "nothing written before the refusal").toEqual([])
    expect(h.queueAdd).not.toHaveBeenCalled()
    expect(h.executeAppRun).not.toHaveBeenCalled()
    expect(h.insertJob).not.toHaveBeenCalled()
    invalidateAppCache(SLUG)
    const runs = await r.run(c.runnerGives)
    expect(runs.statusCode, runs.body).toBe(202)
  })

  it.each(CONTROL_CASES.map((c) => [c.name, c] as const))("%s: runs", async (_name, c) => {
    h.current = c
    serve()
    const runs = await r.run(c.runnerGives ?? {})
    expect(runs.statusCode, runs.body).toBe(202)
  })
})

describe("a value the runner gives counts only as an image that can reach the photo", () => {
  const at = { x: 0, y: 0 }
  const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: at, data: { label: id, ...data } })
  const wire = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null) => ({ id: `${source}>${target}`, source, target, sourceHandle, targetHandle })
  const asCase = (name: string, nodes: ReturnType<typeof node>[], edges: ReturnType<typeof wire>[]): SentinelCase => ({ name, graph: { nodes, edges }, workflows: {}, settings: {} })
  /** An emptied upload into a step a Text node prompts, into the creator's photo. */
  const promptedStep = asCase(
    "a step a Text node prompts",
    [node("up", "upload-image"), node("brief", "text-prompt"), node("step", "modify-image", { prompt: "warmer" }), node("c", "ugc-creator", { source: "photo" })],
    [wire("up", "step", "image"), wire("brief", "step", "prompt"), wire("step", "c", "photo")],
  )
  /** A component's snapshot: an image port and a text port of its input node, the image port into the creator's photo. */
  const ports = asCase(
    "a component's ports",
    [node("in", "sub-workflow-input", { ports: [{ id: "face", mediaType: "image" }, { id: "brand", mediaType: "text" }] }), node("c", "ugc-creator", { source: "photo" })],
    [wire("in", "c", "photo", "face")],
  )

  it.each(ROUTES.map((r) => [r.route, r] as const))("%s: the runner's text for the step is refused; the runner's upload runs", async (_route, r) => {
    h.current = promptedStep
    serve()
    const refused = await r.run({ brief: { text: "me, smiling" } })
    expect(refused.statusCode, refused.body).toBe(400)
    expect(refused.json().error.code).toBe("ugc_photo_required")
    invalidateAppCache(SLUG)
    expect((await r.run({ up: { url: RUNNERS_PHOTO } })).statusCode).toBe(202)
  })

  it("a component's caller who fills only a text port is refused; the image port runs", async () => {
    h.current = ports
    serve()
    const run = ROUTES.find((r) => r.route === "a component's caller")!.run
    const refused = await run({ in: { __injectedPortValues: { brand: "Acme" } } })
    expect(refused.statusCode, refused.body).toBe(400)
    expect(refused.json().error.code).toBe("ugc_photo_required")
    expect((await run({ in: { __injectedPortValues: { face: RUNNERS_PHOTO } } })).statusCode).toBe(202)
  })
})

describe("the one check every run calls (ugcRunMissesPhoto)", () => {
  it.each(SENTINEL_CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    h.current = c
    serve()
    expect(await ugcRunMissesPhoto(c.graph.nodes, c.graph.edges, undefined, undefined, AUTHOR)).toBe(true)
    expect(await ugcRunMissesPhoto(c.graph.nodes, c.graph.edges, ELSEWHERE, undefined, AUTHOR)).toBe(true)
    expect(await ugcRunMissesPhoto(c.graph.nodes, c.graph.edges, c.runnerGives, undefined, AUTHOR)).toBe(false)
  })
})
