import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The price stored at publish is never the run estimate (decided 2026-10-05).
 *
 * With the preview stop rule on, a run stops at an Apply EDL render set to
 * Proxy and its estimate leaves out the tail. An app's, component's or
 * template's listed price comes from ONE listing estimator (decided
 * 2026-10-06): its preview part (the whole graph at Preview) WITH the
 * creator's fee, plus its final part (each Render final) WITHOUT it. A
 * component's final part is 0 (it never stops at a Preview), a template has
 * no fee. The monetization recalculation reads the stored figures back. Here
 * the estimators answer different numbers, so a publish that reached for the
 * wrong one would store the wrong price.
 */

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => flag.on }))

vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

/** What a run of the workflow is quoted (the tail left out) vs its whole graph. */
const RUN_ESTIMATE = 40
const WHOLE_GRAPH = 130
/** The listing's two parts: the whole graph at Preview, and the Render final (the render at Final, then the tail). */
const PREVIEW = WHOLE_GRAPH
const FINAL = 150
const estimates = vi.hoisted(() => ({
  run: vi.fn(),
  listing: vi.fn(),
}))
vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: estimates.run,
  estimateWorkflowListingCredits: estimates.listing,
}))

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "llm-chat", category: "ai-text" },
    { type: "apply-edl", category: "processing-video" },
    { type: "generate-image", category: "ai-image" },
  ],
}))

import { publishedAppsRoutes } from "../published-apps.js"
import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const OWNER = "00000000-0000-4000-8000-0000000000ad"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const APP_ID = "00000000-0000-4000-8000-000000000030"

const NODES = [
  { id: "plan", type: "llm-chat", data: {} },
  { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
  { id: "tail", type: "generate-image", data: { provider: "nano-banana" } },
]
const EDGES = [
  { id: "a", source: "plan", target: "cut" },
  { id: "b", source: "cut", target: "tail" },
]
const WORKFLOW = {
  id: WORKFLOW_ID,
  user_id: OWNER,
  workspace_id: null,
  visibility: "private",
  nodes: NODES,
  edges: EDGES,
  settings: {},
}

/** Every insert/update payload, by table. */
let writes: Array<{ table: string; op: "insert" | "update"; payload: Record<string, unknown> }>

function serve(rows: Record<string, unknown>): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const result = { data: rows[table] ?? null, error: null }
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "in", "order", "limit", "upsert", "delete", "neq", "or"]) {
      chain[m] = vi.fn(() => chain)
    }
    for (const op of ["insert", "update"] as const) {
      chain[op] = vi.fn((payload: Record<string, unknown>) => {
        writes.push({ table, op, payload })
        return chain
      })
    }
    chain.single = vi.fn().mockResolvedValue(result)
    chain.maybeSingle = vi.fn().mockResolvedValue(result)
    // A list read (`await from(t).select()…`) answers the table's row as a list.
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows[table] ? [rows[table]] : null, error: null })
    return chain
  }) as never)
}

let app: FastifyInstance
beforeAll(() => __availabilityUniverseReadyForTests())
beforeEach(async () => {
  vi.clearAllMocks()
  writes = []
  flag.on = true
  estimates.run.mockResolvedValue(RUN_ESTIMATE)
  estimates.listing.mockImplementation(async (_n: unknown, _e: unknown, options: { publishType: string }) =>
    ({ preview: PREVIEW, final: options.publishType === "component" ? 0 : FINAL }),
  )
  __resetAvailabilityOverridesForTests({ nodes: new Set(["llm-chat", "apply-edl", "generate-image"]) })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(publishedAppsRoutes)
  await app.register(workflowTemplatesRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
})

function insertInto(table: string): Record<string, unknown> {
  const write = writes.find((w) => w.table === table && w.op === "insert")
  expect(write, `no insert into ${table}`).toBeDefined()
  return write!.payload
}

describe.each([true, false])("PREVIEW_STOP_RULE_ENABLED=%s: the price stored at publish", (on) => {
  it("an app: the preview run is the fee's base; the listed price adds the final", async () => {
    flag.on = on
    serve({ workflows: WORKFLOW })
    await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": OWNER },
      payload: { workflowId: WORKFLOW_ID, name: "Cut app" },
    })
    const row = insertInto("published_apps")
    expect(row.base_estimated_credits).toBe(PREVIEW)
    expect(row.estimated_credits).toBe(PREVIEW + FINAL)
    // The listing carries the app's exposed text inputs (speechTextCaps); this
    // fixture exposes none, so the map is empty.
    expect(estimates.listing).toHaveBeenCalledWith(NODES, EDGES, { publishType: "app", speechTextCaps: {} })
    expect(estimates.run).not.toHaveBeenCalled()
  })

  // With the flag on a component holding a Preview render is refused at
  // publish; with it off it publishes, and must still list no final part.
  it.runIf(!on)("a component: the listing asks for the component's split, whose final part is 0", async () => {
    flag.on = on
    serve({ workflows: WORKFLOW })
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": OWNER },
      payload: {
        workflowId: WORKFLOW_ID,
        name: "Cut component",
        publishType: "component",
        componentMetadata: {
          inputs: [],
          outputs: [{ id: "tail", name: "Out", type: "image", required: true, mediaPreview: true, fieldKey: "imageUrl" }],
          exposedSettings: [],
        },
      },
    })
    expect(res.statusCode).not.toBe(400)
    const row = insertInto("published_apps")
    expect(estimates.listing).toHaveBeenCalledWith(NODES, EDGES, { publishType: "component", speechTextCaps: {} })
    expect(row.base_estimated_credits).toBe(PREVIEW)
    expect(row.estimated_credits).toBe(PREVIEW)
  })

  it("republishing (a new version over an earlier one, monetized): the fee marks up the preview alone", async () => {
    flag.on = on
    serve({
      workflows: WORKFLOW,
      published_apps: {
        id: APP_ID,
        version: 1,
        slug: "cut-app-abc123",
        is_listed: false,
        monetization_enabled: true,
        monetization_flat_fee: 10,
        monetization_percent: 50,
      },
    })
    await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": OWNER },
      payload: { workflowId: WORKFLOW_ID, name: "Cut app" },
    })
    const row = insertInto("published_apps")
    expect(row.base_estimated_credits).toBe(PREVIEW)
    // 130 + 10 + ceil(130 × 50%) = 205 for the preview part; the final's 150 unmarked.
    expect(row.estimated_credits).toBe(205 + FINAL)
    expect(estimates.run).not.toHaveBeenCalled()
  })

  it("publishing a template stores the app listing's figure: the preview part plus the final (no fee)", async () => {
    flag.on = on
    serve({ workflows: WORKFLOW })
    await app.inject({
      method: "POST",
      url: "/v1/templates/publish",
      headers: { "x-user-id": OWNER },
      payload: { workflowId: WORKFLOW_ID, name: "Cut template" },
    })
    expect(insertInto("workflow_templates").estimated_credits).toBe(PREVIEW + FINAL)
    expect(estimates.listing).toHaveBeenCalledWith(NODES, EDGES, { publishType: "template", speechTextCaps: {} })
    expect(estimates.run).not.toHaveBeenCalled()
  })

  it("the monetization recalculation reads the stored parts back, never re-estimating", async () => {
    flag.on = on
    serve({
      published_apps: {
        id: APP_ID,
        creator_id: OWNER,
        base_estimated_credits: PREVIEW,
        estimated_credits: PREVIEW + FINAL,
        monetization_enabled: false,
        monetization_flat_fee: 0,
        monetization_percent: 0,
        slug: "cut-app-abc123",
        workflow_id: WORKFLOW_ID,
      },
    })
    await app.inject({
      method: "PATCH",
      url: `/v1/apps/${APP_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { monetizationEnabled: true, monetizationFlatFee: 10 },
    })
    const update = writes.find((w) => w.table === "published_apps" && w.op === "update")
    expect(update?.payload.estimated_credits).toBe(PREVIEW + 10 + FINAL)
    expect(estimates.run).not.toHaveBeenCalled()
    expect(estimates.listing).not.toHaveBeenCalled()
  })

  it("a listing stored before the split has no final part: the fee marks up its base, as before, until its next publish", async () => {
    flag.on = on
    serve({
      published_apps: {
        id: APP_ID,
        creator_id: OWNER,
        base_estimated_credits: WHOLE_GRAPH,
        estimated_credits: WHOLE_GRAPH,
        monetization_enabled: false,
        monetization_flat_fee: 0,
        monetization_percent: 0,
        slug: "cut-app-abc123",
        workflow_id: WORKFLOW_ID,
      },
    })
    await app.inject({
      method: "PATCH",
      url: `/v1/apps/${APP_ID}`,
      headers: { "x-user-id": OWNER },
      payload: { monetizationEnabled: true, monetizationFlatFee: 10 },
    })
    const update = writes.find((w) => w.table === "published_apps" && w.op === "update")
    expect(update?.payload.estimated_credits).toBe(WHOLE_GRAPH + 10)
  })
})
