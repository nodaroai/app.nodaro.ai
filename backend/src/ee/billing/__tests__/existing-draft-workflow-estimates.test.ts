// @test-units-by-name prices the node types it names (generate-video, video-upscale, text-prompt, generate-image)
/**
 * A whole-workflow estimate made for the user who would run it prices a
 * Seedance 2.5 HD finalize of a draft that ALREADY EXISTS exactly, as the
 * finalize's own gate prices that draft for that user (decided 2026-11-13) —
 * the figure the editor shows (the node's Run button, `POST
 * /v1/credits/seedance-hd-estimate` for the draft's task), never the
 * provider's 8 s row. Every route that quotes a workflow for its runner:
 *
 *   - `POST /v1/credits/estimate-workflow` (the API's and MCP's estimate);
 *   - `GET /v1/api/schema` (an API token's workflow description);
 *   - `GET /v1/present/:token` (a shared workflow's page);
 *   - `POST /v1/component/estimate-credits` (a Component node's price).
 *
 * The real estimator and the real finalize gate run; the database serves the
 * draft's job row and the workflow (or component snapshot) only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { SEEDANCE_DRAFT_FINALIZE_PROVIDER, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"

const db = vi.hoisted(() => ({
  draft: null as Record<string, unknown> | null,
  workflow: null as Record<string, unknown> | null,
  component: null as Record<string, unknown> | null,
  /** The task ids the finalize's gate looked a draft up by. */
  draftLookups: [] as unknown[],
}))
vi.mock("@/lib/supabase.js", () => {
  /** Any other read: no rows (the price table falls back to the static rows). */
  const empty = () => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "neq", "order", "range", "limit", "in", "is", "not", "gt", "gte", "lt", "lte", "update", "insert", "upsert", "delete"]) chain[m] = () => chain
    chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
    chain.maybeSingle = async () => ({ data: null, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return chain
  }
  /** One row for every `.single()` / `.maybeSingle()` read of the table. */
  const one = (row: () => Record<string, unknown> | null) => {
    const chain = empty()
    chain.single = async () => (row() ? { data: row(), error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } })
    chain.maybeSingle = async () => ({ data: row(), error: null })
    return chain
  }
  /** The draft's job row, matched on the columns the finalize's gate filters by. */
  const jobs = () => {
    const filters: Array<[string, unknown]> = []
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (col: string, val: unknown) => { filters.push([col, val]); return q }
    q.limit = async () => {
      db.draftLookups.push(filters.find(([c]) => c === "provider_task_id")?.[1])
      return { data: db.draft && filters.every(([c, v]) => db.draft![c] === v) ? [db.draft] : [], error: null }
    }
    return q
  }
  const from = (table: string) =>
    table === "jobs" ? jobs()
      : table === "workflows" ? one(() => db.workflow)
        : table === "published_apps" ? one(() => db.component)
          : empty()
  return {
    supabase: {
      from,
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    },
  }
})
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 40, service_margin_percent: {} }) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn() } }))
// Not under test: no use-case node here, and the availability lookups read tables this file does not serve.
vi.mock("@/lib/use-case/inner-availability.js", () => ({ usecaseViewerEstimateFor: async () => ({}) }))
vi.mock("@/lib/canvas-result-ids.js", () => ({ resolveCanvasResultIds: async (nodes: unknown) => nodes }))
vi.mock("@/lib/ugc-composed-graph.js", () => ({ ugcPublishedGraph: async (nodes: unknown) => ({ nodes }) }))
vi.mock("@/lib/private-plugins/load.js", () => ({ getPluginServices: () => ({}) }))
vi.mock("@/lib/private-plugins/services-registry.js", async () => ({ getPluginServices: (await import("@/lib/private-plugins/load.js")).getPluginServices }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/deployment-payer.js", () => ({
  deploymentPayerActive: vi.fn(() => false),
  deploymentPayerId: vi.fn(() => null),
  allowanceEnforcementActive: vi.fn(() => false),
}))
vi.mock("@/ee/billing/deployment-allowance-service.js", () => ({ allowanceFor: vi.fn() }))
const token = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock("@/lib/api-token-resolver.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-token-resolver.js")>()),
  resolveApiToken: token.resolve,
}))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/access-blocks.js")>()),
  isUserBlocked: async () => false,
}))
vi.mock("@/services/app-execution.js", () => ({ executeAppRun: vi.fn() }))

import { creditsRoutes } from "../../routes/credits.js"
import { registerSeedanceHdEstimate } from "../../routes/seedance-hd-estimate.js"
import { apiTokenRoutes } from "../../../routes/api-tokens.js"
import { presentationRoutes } from "../../../routes/presentation.js"
import { componentExecuteRoutes } from "../../../routes/component-execute.js"
import { estimateWorkflowCreditsDetailed, STATIC_CREDIT_COSTS } from "../credits.js"
import { EXISTING_DRAFTS_PRICED_PER_ESTIMATE, existingDraftsFor } from "../existing-drafts-option.js"
import { seedanceDraftFinalizeChargedCredits } from "../seedance-draft-finalize-credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { resolveSeedanceDraftFinalize } from "../../../lib/seedance-draft-finalize.js"

const USER = "00000000-0000-4000-8000-0000000000a1"
const OTHER = "00000000-0000-4000-8000-0000000000b2"
const WF = "00000000-0000-4000-8000-0000000000c3"
const TASK = "task-existing-draft"
const DRAFT_JOB = "11111111-2222-4333-8444-555555555555"
const SETTINGS = { cost_markup_percent: 40, service_margin_percent: {} }

/** The draft node: a Seedance 2.5 Auto draft that has made its 30 s take, frozen (it does not run again). */
const DRAFT_NODE = {
  id: "draft",
  type: "generate-video",
  data: {
    provider: "seedance-2-5", prompt: "a cat on a roof", aspectRatio: "16:9", resolution: "480p", draft: true,
    duration: VIDEO_DURATION_AUTO, skipped: true, kieTaskId: TASK,
    generatedResults: [{ url: "https://cdn.example/draft.mp4", duration: 30 }], activeResultIndex: 0,
  },
}
const FINALIZE = { id: "hd", type: "video-upscale", data: { provider: SEEDANCE_DRAFT_FINALIZE_PROVIDER } }
const GRAPH = { nodes: [DRAFT_NODE, FINALIZE], edges: [{ source: "draft", target: "hd", sourceHandle: "video", targetHandle: "video" }] }
/** A graph with no finalize: a prompt into an image. */
const PLAIN = {
  nodes: [
    { id: "p", type: "text-prompt", data: { text: "a cat" } },
    { id: "img", type: "generate-image", data: { provider: "nano-banana-2", resolution: "1K", aspectRatio: "16:9" } },
  ],
  edges: [{ source: "p", target: "img", sourceHandle: "text", targetHandle: "prompt" }],
}

/** The draft's job, as its run records it: the user's, completed, a draft, its 30 s take. */
const draftRow = () => ({
  id: DRAFT_JOB, user_id: USER, status: "completed", provider_task_id: TASK, provider_kind: "kie-standard",
  relay_job_id: null, parent_job_id: null,
  input_data: { provider: "seedance-2-5", draft: true, resolution: "480p", duration: VIDEO_DURATION_AUTO, aspectRatio: "16:9", prompt: "a cat on a roof" },
  output_data: { videoUrl: "https://cdn.example/draft.mp4", draftRenderSec: 30 },
})

/** The finalize's exact price for that draft — what its own gate charges USER. */
async function exactFinalize(): Promise<number> {
  const plan = await resolveSeedanceDraftFinalize({ userId: USER, taskId: TASK })
  if (!plan.ok) throw new Error(`the gate refused the draft: ${plan.code}`)
  return seedanceDraftFinalizeChargedCredits(plan)
}
/** The provider's bare 8 s row, marked up: what the finalize was quoted at before. */
const bareRow = () => applyServiceMarkup(STATIC_CREDIT_COSTS[SEEDANCE_DRAFT_FINALIZE_PROVIDER]!, SETTINGS as never, SEEDANCE_DRAFT_FINALIZE_PROVIDER)

/**
 * The whole run's figure with the finalize at `finalize`: the estimator's
 * figure for the graph with no options (every node as before — the finalize at
 * the 8 s row), its finalize line replaced.
 */
async function wholeRunWithFinalizeAt(finalize: number): Promise<number> {
  const before = await estimateWorkflowCreditsDetailed(GRAPH.nodes, GRAPH.edges)
  expect(before.perNode.hd).toStrictEqual({ credits: bareRow(), estimate: false })
  return before.credits - before.perNode.hd!.credits + finalize
}

let app: FastifyInstance
beforeEach(async () => {
  db.draft = draftRow()
  db.draftLookups = []
  db.workflow = { id: WF, name: "Finalize", nodes: GRAPH.nodes, edges: GRAPH.edges, settings: {}, user_id: USER, workspace_id: null, is_presentation_enabled: true }
  db.component = { snapshot_nodes: GRAPH.nodes, snapshot_edges: GRAPH.edges, component_metadata: { inputs: [], outputs: [], exposedSettings: [] }, creator_id: USER }
  token.resolve.mockResolvedValue({ id: "tok", userId: USER, workflowIds: [], rateLimit: 60, tokenHash: "th", workspaceId: null })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-test-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await creditsRoutes(instance)
    await apiTokenRoutes(instance)
    await presentationRoutes(instance)
    await componentExecuteRoutes(instance)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

/** Each route's total for the graph the database serves, asked as `userId` (undefined: anonymous). */
const ROUTES: ReadonlyArray<readonly [string, (userId: string | undefined, graph: typeof GRAPH) => Promise<number>]> = [
  ["POST /v1/credits/estimate-workflow", async (userId, graph) => {
    const res = await app.inject({ method: "POST", url: "/v1/credits/estimate-workflow", headers: userId ? { "x-test-user-id": userId } : {}, payload: graph })
    expect(res.statusCode, res.body).toBe(200)
    return res.json().data.totalCredits
  }],
  ["GET /v1/api/schema", async (userId) => {
    if (userId) token.resolve.mockResolvedValue({ id: "tok", userId, workflowIds: [], rateLimit: 60, tokenHash: "th", workspaceId: null })
    const res = await app.inject({ method: "GET", url: `/v1/api/schema?workflowId=${WF}`, headers: { authorization: "Bearer ndr_test_token" } })
    expect(res.statusCode, res.body).toBe(200)
    return res.json().estimatedCredits
  }],
  ["GET /v1/present/:token", async (userId) => {
    const res = await app.inject({ method: "GET", url: "/v1/present/share-token", headers: userId ? { "x-test-user-id": userId } : {} })
    expect(res.statusCode, res.body).toBe(200)
    return res.json().estimatedCost
  }],
  ["POST /v1/component/estimate-credits", async (userId) => {
    const res = await app.inject({ method: "POST", url: "/v1/component/estimate-credits", headers: userId ? { "x-test-user-id": userId } : {}, payload: { appSlug: "finalize", exposedSettings: {} } })
    expect(res.statusCode, res.body).toBe(200)
    return res.json().estimatedCredits
  }],
]

describe("the graph: a Seedance 2.5 draft with an existing 30 s take, wired into a Seedance 2.5 HD finalize", () => {
  it("the editor's figure for that finalize is its exact price — the 30 s finalize, not the 8 s row", async () => {
    const exact = await exactFinalize()
    expect(exact).toBe(applyServiceMarkup(STATIC_CREDIT_COSTS["seedance-2-5-hd:30s"]!, SETTINGS as never, "seedance-2-5-hd:30s"))
    expect(exact).not.toBe(bareRow())
    // The node's own price (its Run button): the estimate route's answer for the draft's task.
    const hd = Fastify({ logger: false })
    hd.addHook("preHandler", async (req) => { req.userId = USER })
    registerSeedanceHdEstimate(hd)
    await hd.ready()
    try {
      const res = await hd.inject({ method: "POST", url: "/v1/credits/seedance-hd-estimate", payload: { taskId: TASK } })
      expect(res.json()).toStrictEqual({ data: { credits: exact, minimum: false } })
    } finally {
      await hd.close()
    }
    // With no options the estimator quotes the finalize at the 8 s row.
    expect((await estimateWorkflowCreditsDetailed(GRAPH.nodes, GRAPH.edges)).perNode.hd).toStrictEqual({ credits: bareRow(), estimate: false })
  })

  it.each(ROUTES)("%s quotes the finalize at the editor's exact figure for its runner, every other node as before", async (_route, ask) => {
    const exact = await exactFinalize()
    expect(await ask(USER, GRAPH)).toBe(await wholeRunWithFinalizeAt(exact))
  })

  it.each(ROUTES)("%s: a runner whose draft it is not is quoted as before (the finalize's gate refuses it, as the run does)", async (_route, ask) => {
    const asBefore = await wholeRunWithFinalizeAt(bareRow())
    if (_route === "GET /v1/api/schema") {
      // A token reads its own user's workflows only: the draft is another user's.
      db.draft = { ...draftRow(), user_id: OTHER }
      expect(await ask(USER, GRAPH)).toBe(asBefore)
      return
    }
    if (_route === "POST /v1/component/estimate-credits") db.component = { ...db.component!, creator_id: OTHER }
    expect(await ask(OTHER, GRAPH)).toBe(asBefore)
  })

  it("a shared page an anonymous viewer reads is quoted as before: no runner, no draft of theirs", async () => {
    const [, present] = ROUTES.find(([route]) => route === "GET /v1/present/:token")!
    expect(await present(undefined, GRAPH)).toBe(await wholeRunWithFinalizeAt(bareRow()))
  })
})

describe("a graph without a finalize: every route answers exactly as before", () => {
  beforeEach(() => {
    db.workflow = { ...db.workflow!, nodes: PLAIN.nodes, edges: PLAIN.edges }
    db.component = { ...db.component!, snapshot_nodes: PLAIN.nodes, snapshot_edges: PLAIN.edges }
  })

  it.each(ROUTES)("%s: the estimator's figure with no options", async (_route, ask) => {
    const before = (await estimateWorkflowCreditsDetailed(PLAIN.nodes, PLAIN.edges)).credits
    expect(before).toBeGreaterThan(0)
    expect(await ask(USER, PLAIN as typeof GRAPH)).toBe(before)
  })

  it("the estimate route's body is byte-identical", async () => {
    const before = (await estimateWorkflowCreditsDetailed(PLAIN.nodes, PLAIN.edges)).credits
    const res = await app.inject({ method: "POST", url: "/v1/credits/estimate-workflow", headers: { "x-test-user-id": USER }, payload: PLAIN })
    expect(res.body).toBe(JSON.stringify({ data: { totalCredits: before, nodeCount: 2, payer: "user" } }))
  })
})

/**
 * The other shape of a finalize of a draft that already exists: the finalize
 * names its draft itself (`kieTaskId` on the Video Upscale node), with no
 * generation wired. Every route quotes it at the editor's exact figure too.
 */
describe("a finalize that names its own draft (kieTaskId on the finalize)", () => {
  const NAMED = { nodes: [{ ...FINALIZE, data: { ...FINALIZE.data, kieTaskId: TASK } }], edges: [] as typeof GRAPH.edges }

  beforeEach(() => {
    db.workflow = { ...db.workflow!, nodes: NAMED.nodes, edges: NAMED.edges }
    db.component = { ...db.component!, snapshot_nodes: NAMED.nodes, snapshot_edges: NAMED.edges }
  })

  it.each(ROUTES)("%s quotes it at the editor's exact figure for its runner", async (_route, ask) => {
    const before = await estimateWorkflowCreditsDetailed(NAMED.nodes, NAMED.edges)
    expect(before.perNode.hd).toStrictEqual({ credits: bareRow(), estimate: false })
    expect(await ask(USER, NAMED as unknown as typeof GRAPH)).toBe(before.credits - bareRow() + await exactFinalize())
  })
})

/**
 * One estimate prices at most EXISTING_DRAFTS_PRICED_PER_ESTIMATE distinct
 * drafts exactly — one lookup each — and the rest as before, at the row: these
 * routes take a caller's graph, which could name thousands.
 */
describe("the drafts one estimate prices exactly are capped", () => {
  /** `count` finalizes each naming its own draft; `TASK` (the user's real draft) is the `at`-th. */
  function finalizes(count: number, at: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `hd-${i}`,
      type: "video-upscale",
      data: { provider: SEEDANCE_DRAFT_FINALIZE_PROVIDER, kieTaskId: i === at ? TASK : `task-other-${i}` },
    }))
  }

  it(`at most ${EXISTING_DRAFTS_PRICED_PER_ESTIMATE} lookups, in the graph's order; a draft past the cap is priced at the row`, async () => {
    expect(EXISTING_DRAFTS_PRICED_PER_ESTIMATE).toBe(20)
    const exact = await exactFinalize()
    db.draftLookups = []
    // The real draft within the cap: priced exactly.
    const inside = finalizes(30, 5)
    const priced = await estimateWorkflowCreditsDetailed(inside, [], existingDraftsFor(USER))
    expect(db.draftLookups).toHaveLength(EXISTING_DRAFTS_PRICED_PER_ESTIMATE)
    expect(db.draftLookups).toStrictEqual(inside.slice(0, EXISTING_DRAFTS_PRICED_PER_ESTIMATE).map((n) => n.data.kieTaskId))
    expect(priced.perNode["hd-5"]!.credits).toBe(exact)
    // The same draft past the cap: priced as before.
    db.draftLookups = []
    const past = finalizes(30, 25)
    const capped = await estimateWorkflowCreditsDetailed(past, [], existingDraftsFor(USER))
    expect(db.draftLookups).toHaveLength(EXISTING_DRAFTS_PRICED_PER_ESTIMATE)
    expect(capped.perNode["hd-25"]!.credits).toBe(bareRow())
    // Every other finalize is the row either way (no such draft of the user's).
    expect(capped.perNode["hd-0"]!.credits).toBe(bareRow())
  })

  it("the cap is per estimate: a new option prices the first drafts again", async () => {
    const graph = finalizes(25, 0)
    await estimateWorkflowCreditsDetailed(graph, [], existingDraftsFor(USER))
    db.draftLookups = []
    const again = await estimateWorkflowCreditsDetailed(graph, [], existingDraftsFor(USER))
    expect(db.draftLookups).toHaveLength(EXISTING_DRAFTS_PRICED_PER_ESTIMATE)
    expect(again.perNode["hd-0"]!.credits).toBe(await exactFinalize())
  })
})
