import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * A LINKED (keyframe / sequence) studio production's sequence planning state
 * never reaches a reader who is not its owner (studio ruling T87), on the by-id
 * doors and on the public share read:
 *
 * - a take's endpoint pins (`sequenceEndpoints` on the clip node's
 *   `data.generatedResults` rows);
 * - the director's `settings.studio.sequenceRecommendations`;
 * - each sequence take unit's `continuationAcceptance`.
 *
 * What the studio codec's reader requires to read a production with takes —
 * `sequenceGenerationPolicies`, a take's `policy` and `compilation`, the unit
 * video nodes' `sequenceUnitResults` — still goes out: a strip of the stored row
 * cannot drop it without breaking that reader. `edit` and `own` keep all of
 * it: an editor saves the whole graph back (T21 / T77).
 */

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => true,
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: vi.fn(() => ({})),
  loadPrivatePlugins: vi.fn(),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/workflow-delete.js", () => ({
  deleteWorkflowWithPrivateMedia: vi.fn(),
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn().mockResolvedValue({ id: "orch-1" }) },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn(), getJob: vi.fn(), remove: vi.fn() },
  renderQueue: { add: vi.fn() },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))

vi.mock("@/lib/sse.js", () => ({
  createSSEStream: vi.fn().mockReturnValue({
    sendEvent: vi.fn(), sendComment: vi.fn(), close: vi.fn(), isClosed: false,
  }),
}))

vi.mock("@/lib/execution-events.js", () => ({
  executionEvents: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { refundCredits: vi.fn() },
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
}))

vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))

vi.mock("@/lib/storage.js", () => ({
  copyToTemplatePreview: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({ requireAdmin: vi.fn() }))

// ---------------------------------------------------------------------------

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"

const CREATOR = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"
const WS = "00000000-0000-4000-8000-000000000030"
const NOW = "2026-09-08T12:00:00.000Z"

const PIN = (keyframeId: string, key: string) => ({ keyframeId, planRevision: 1, resultKey: key, jobId: key,
  assetId: key, contentHash: "a".repeat(64), width: 10, height: 10 })
const PINS = { sequenceId: "zoom", sequenceRevision: 1, start: PIN("A", "frame-private-a"), end: PIN("B", "frame-private-b") }
const POLICY = { conditioning: "video-continue", clipLength: "max", boundaryPolicy: "outer-frames",
  lockedBoundaryKeyframeIds: [], provider: "wan-3", resolution: "480p", aspectRatio: "16:9", referenceAssetIds: [] }
const COMPILATION = { compilerVersion: "c1", capabilityFingerprint: "exact", renderPlanHash: "plan-1", ready: true, issues: [],
  units: [{ id: "zoom:u0", coverage: [{ shotId: "AB", fromSec: 0, toSec: 4 }], outputDurationSec: 4, generationDurationSec: 4,
    conditioning: "start-end", startKeyframeId: "A", endKeyframeId: "B", guidanceOnlyKeyframeIds: [], reused: false, prerequisites: [] }] }
const REVIEW = { resultKey: "result0", acceptedBy: "owner-actor-private", acceptedAt: NOW,
  review: { composition: true, motion: true, subjects: true, continuity: true } }
const RECOMMENDATION = { id: "rec-1", createdAt: NOW, sequenceId: "zoom", authoringHash: "h1", capabilityFingerprint: "exact",
  priorityHash: "p1", recommendation: { policy: POLICY, reasons: ["a private director reason"], assumptions: [] },
  provenance: { source: "director", jobId: "job-private", analysisRevision: "rev-1", llmModel: "model-x" } }
const PRIVATE = ["frame-private-a", "a private director reason", "job-private", "owner-actor-private"]

/** A linked scene's clip (its take carries the pins) and one unit video node of a take. */
const linkedNodes = () => [
  { id: "clip-AB", type: "generate-video", position: { x: 0, y: 0 }, data: { prompt: "Approach",
    generatedResults: [{ url: "https://r2/clip.mp4", jobId: "clip-1", sequenceEndpoints: PINS }] } },
  { id: "owner0", type: "generate-video", position: { x: 680, y: 0 }, data: { sequenceUnitId: "zoom:u0",
    sequenceUnitResults: [{ url: "https://r2/unit0.mp4", requestHash: "request-0",
      pin: { unitId: "zoom:u0", resultKey: "result0", jobId: "result0", assetId: "asset-0", contentHash: "hash-0", durationSec: 4 } }],
    generatedVideoUrl: "https://r2/unit0.mp4", generatedResults: [{ videoUrl: "https://r2/unit0.mp4", jobId: "result0" }] } },
]

/** The take as the codec writes it — and, without `continuationAcceptance`, as a reader gets it. */
const take = (reviewed: boolean) => ({ id: "take1", sequenceId: "zoom", authoringHash: "h1", revision: 2, createdAt: NOW,
  policy: POLICY, compilation: COMPILATION, units: [{ unitId: "zoom:u0", videoNodeId: "owner0", selectedResultKey: "result0",
    ...(reviewed ? { continuationAcceptance: REVIEW } : {}) }] })

/** A shared, linked production with a take, its director recommendations and a reviewed continuation. */
const PRODUCTION = {
  id: WF, project_id: "00000000-0000-4000-8000-000000000010", user_id: CREATOR, workspace_id: WS,
  visibility: "workspace", folder_id: null, name: "Zoom film", description: null, is_template: false,
  version: 1, thumbnail_url: null, source_prompt: null, parent_workflow_id: null, app_slug: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  nodes: linkedNodes(),
  edges: [],
  settings: { studio: {
    version: 3, shared: true,
    shots: [{ id: "AB", sequenceBinding: { sequenceId: "zoom", startKeyframeId: "A", endKeyframeId: "B", continuity: "continuous" } }],
    requiredCapabilities: ["studio-dependent-frames-v1", "studio-sequence-takes-v1"],
    keyframes: [{ imageNodeId: "frame-A", plan: { id: "A", label: "A", revision: 1, frame: { prompt: "A" }, requirements: [] } }],
    sequences: [{ id: "zoom", name: "Zoom", revision: 1, construction: "nested-zoom", shotIds: ["AB"] }],
    sequenceGenerationPolicies: { zoom: POLICY },
    sequenceTakes: [take(true)],
    sequenceUnitVideos: [{ videoNodeId: "owner0", unitId: "zoom:u0" }],
    selectedSequenceTakeIds: { zoom: "take1" },
    sequenceRecommendations: [RECOMMENDATION],
  } },
}

/** Install an orgs plugin that answers `access` for every workflow. */
function plugin(access: string) {
  // The seam engages only when the plugin answers every access question.
  const orgs = {
    workflowAccess: vi.fn().mockResolvedValue(access),
    workflowAccessFromRow: vi.fn().mockResolvedValue(access),
    canDeleteWorkflow: vi.fn().mockResolvedValue(false),
    canRunWorkflow: vi.fn().mockResolvedValue(false),
    canChangeWorkflowVisibility: vi.fn().mockResolvedValue(false),
    canShareWorkflow: vi.fn().mockResolvedValue(false),
  }
  vi.mocked(getPluginServices).mockReturnValue({ orgs } as never)
}

/** `.from("workflows").select(…).eq("id", …)` → `row` (by-id doors: `maybeSingle`, the share read: `single`); any other table → no rows. */
function tables(row: unknown = PRODUCTION) {
  const read = vi.fn().mockResolvedValue({ data: structuredClone(row), error: null })
  const workflows = { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: read, single: read })) })) }
  const entities: Record<string, unknown> = {
    select: vi.fn(() => entities), in: vi.fn(() => entities), eq: vi.fn(() => entities),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => (table === "workflows" ? workflows : entities)) as never)
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(getPluginServices).mockReturnValue({} as never)
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    req.orgs = async () => ({ organizations: [], workspaces: [] })
  })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (i) => { await workflowRoutes(i) })
  await app.ready()
})

type Graph = { nodes: Array<{ id: string; data?: Record<string, unknown> }>; settings: { studio: Record<string, unknown> } }
const DOORS = [
  ["GET /v1/workflows/:id", `/v1/workflows/${WF}`, (body: any): Graph => body.data],
  ["GET /v1/workflows/:id/export?assets=true", `/v1/workflows/${WF}/export?assets=true`, (body: any): Graph => body],
] as const

const resultRows = (graph: Graph) =>
  graph.nodes.flatMap((node) => (node.data?.generatedResults as unknown[] | undefined) ?? []) as Array<Record<string, unknown>>

describe.each(DOORS)("%s — a linked production's sequence planning is the owner's (T87)", (_door, url, graphOf) => {
  it("a `view` reader gets the production without the pins, the recommendations or the reviews", async () => {
    plugin("view")
    tables()
    const res = await app.inject({ method: "GET", url, headers: { "x-user-id": OTHER } })
    expect(res.statusCode).toBe(200)
    for (const secret of PRIVATE) expect(res.body).not.toContain(secret)
    expect(res.body).not.toContain("sequenceEndpoints")
    expect(res.body).not.toContain("continuationAcceptance")
    const graph = graphOf(res.json())
    expect(resultRows(graph)[0]).toEqual({ url: "https://r2/clip.mp4", jobId: "clip-1" })
    expect(graph.settings.studio.sequenceRecommendations).toBeUndefined()
    // What the codec's reader needs to read the production still goes out.
    expect(graph.settings.studio.sequenceTakes).toEqual([take(false)])
    expect(graph.settings.studio.sequenceGenerationPolicies).toEqual({ zoom: POLICY })
    expect(graph.nodes.find((node) => node.id === "owner0")!.data!.sequenceUnitResults).toHaveLength(1)
  })

  it.each(["edit", "own"])("`%s` keeps all of it — that reader saves the graph back", async (access) => {
    plugin(access)
    tables()
    const res = await app.inject({ method: "GET", url,
      headers: { "x-user-id": access === "own" ? CREATOR : OTHER } })
    expect(res.statusCode).toBe(200)
    const graph = graphOf(res.json())
    expect(resultRows(graph)[0]).toMatchObject({ sequenceEndpoints: PINS })
    expect(graph.settings.studio.sequenceRecommendations).toEqual([RECOMMENDATION])
    expect(graph.settings.studio.sequenceTakes).toEqual([take(true)])
  })
})

describe("GET /v1/workflows/:id/export (template) — the result rows are gone already; the settings are not", () => {
  it.each([["view", "drops"], ["edit", "keeps"], ["own", "keeps"]] as const)(
    "`%s` %s the recommendations and the reviews", async (access, verb) => {
      const kept = verb === "keeps"
      plugin(access)
      tables()
      const res = await app.inject({ method: "GET", url: `/v1/workflows/${WF}/export`,
        headers: { "x-user-id": access === "own" ? CREATOR : OTHER } })
      expect(res.statusCode).toBe(200)
      const studio = res.json().settings.studio
      expect(studio.sequenceRecommendations).toEqual(kept ? [RECOMMENDATION] : undefined)
      expect(studio.sequenceTakes).toEqual([take(kept)])
    },
  )
})

describe("GET /v1/public/workflows/:id — the share read never carries a production's sequence planning (T87)", () => {
  it("an ordinary production's stray sequence state comes off its nodes and its settings", async () => {
    // Nothing on it reads as a linked production (no keyframes, sequences or
    // declared capability), so the share read projects it here, not through
    // the codec. Stray state from an older or foreign writer still stays home.
    const stray = { ...PRODUCTION, settings: { studio: { version: 3, shared: true, shots: [{ id: "AB" }],
      sequenceTakes: [take(true)], sequenceRecommendations: [RECOMMENDATION] } } }
    tables(stray)
    const res = await app.inject({ method: "GET", url: `/v1/public/workflows/${WF}` })
    expect(res.statusCode).toBe(200)
    for (const secret of PRIVATE) expect(res.body).not.toContain(secret)
    const graph = res.json().data as Graph
    expect(resultRows(graph)[0]).toEqual({ url: "https://r2/clip.mp4", jobId: "clip-1" })
    expect(graph.settings.studio).toEqual({ version: 3, shared: true, shots: [{ id: "AB" }], sequenceTakes: [take(false)] })
  })

  it("a linked production goes out only through the codec's public projection — never raw", async () => {
    tables()
    const res = await app.inject({ method: "GET", url: `/v1/public/workflows/${WF}` })
    expect(res.statusCode).toBe(404)
    for (const secret of PRIVATE) expect(res.body).not.toContain(secret)
  })
})
