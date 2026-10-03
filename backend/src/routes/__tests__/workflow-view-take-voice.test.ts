import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * A finished take's VOICE RECORD never reaches a `view` reader (studio ruling
 * T42): the plan a clip was recast with — the OWNER's voice ids — and the Voice
 * control's mode, on the canvas node's `data.generatedResults` rows. Nor does
 * the owner's bin hand one over: a deleted empty slot (T11), a deleted take's
 * record, a deleted scene's records and slots.
 *
 * `workflow-visibility.test.ts` pins the settings half of the same rule (the
 * live scene's slots and runs, T11 / T22); this file pins the NODES half and
 * the bin, door by door. `edit` and `own` keep all of it: an editor saves the
 * whole graph back.
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

const PLAN = { orderedVoices: [{ voiceId: "voice-owner-abi", voiceName: "Abi" }] }

/** A clip node whose two takes carry the owner's voice record. */
const voicedNodes = () => [
  { id: "generate-video-s1", type: "generate-video", position: { x: 0, y: 0 },
    data: { prompt: "Abi speaks", provider: "seedance-2", activeResultIndex: 0, generatedResults: [
      { url: "https://r2/a.mp4", prompt: "Abi speaks", revoiceTo: PLAN, voiceMode: "character" },
      { url: "https://r2/b.mp4", prompt: "Abi whispers", voiceMode: "off" },
    ] } },
]

/** A studio production: voiced takes on the graph, and a bin holding a
 *  deleted empty slot, a deleted voiced take and a deleted voiced scene. */
const PRODUCTION = {
  id: WF, project_id: "00000000-0000-4000-8000-000000000010", user_id: CREATOR, workspace_id: WS,
  visibility: "workspace", folder_id: null, name: "Class film", description: null, is_template: false,
  version: 1, thumbnail_url: null, source_prompt: null, parent_workflow_id: null, app_slug: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  nodes: voicedNodes(),
  edges: [],
  settings: { studio: { version: 3, shots: [{ id: "s1", clipNodeId: "generate-video-s1" }], trash: [
    { kind: "slot", id: "t-slot", shotId: "s1", index: 0, deletedAt: "2026-10-01T10:00:00.000Z",
      stage: "clip", slot: { id: "slot-1", inputs: { prompt: "an unsent move" } } },
    { kind: "clip", id: "t-clip", shotId: "s1", index: 2, deletedAt: "2026-10-01T10:00:00.000Z",
      clipBase: { nodeId: "generate-video-s1" },
      result: { url: "https://r2/c.mp4", revoiceTo: PLAN, voiceMode: "character" } },
    { kind: "shot", id: "t-shot", shotId: "s2", index: 1, deletedAt: "2026-10-01T10:00:00.000Z",
      graph: { nodes: voicedNodes(), edges: [], settings: { studio: { version: 3, shots: [
        { id: "s2", stillSlots: [{ id: "slot-2", inputs: { prompt: "an unsent idea" } }] },
      ] } } } },
  ] } },
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

/** `.from("workflows").select(…).eq("id", …).maybeSingle()` → the production; any other table → no rows. */
function tables() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: structuredClone(PRODUCTION), error: null })
  const workflows = { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) }
  const entities: Record<string, unknown> = {
    select: vi.fn(() => entities), in: vi.fn(() => entities), eq: vi.fn(() => entities),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => (table === "workflows" ? workflows : entities)) as never)
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
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

const DOORS = [
  ["GET /v1/workflows/:id", `/v1/workflows/${WF}`, (body: any) => body.data],
  ["GET /v1/workflows/:id/export?assets=true", `/v1/workflows/${WF}/export?assets=true`, (body: any) => body],
] as const

const resultRows = (nodes: Array<{ data?: { generatedResults?: unknown[] } }>) =>
  nodes.flatMap((node) => node.data?.generatedResults ?? []) as Array<Record<string, unknown>>
const binOf = (graph: { settings: { studio: { trash: Array<Record<string, unknown>> } } }) => graph.settings.studio.trash

describe.each(DOORS)("%s — a take's voice record is the owner's (T42)", (_door, url, graphOf) => {
  it("a `view` reader gets the takes without their records, and the bin without the owner's drafts", async () => {
    plugin("view")
    tables()
    const res = await app.inject({ method: "GET", url, headers: { "x-user-id": OTHER } })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain("voice-owner-abi")
    expect(res.body).not.toContain("voiceMode")
    expect(res.body).not.toContain("an unsent")
    const graph = graphOf(res.json())
    // The takes themselves are still there.
    expect(resultRows(graph.nodes).map((row) => row.url)).toEqual(["https://r2/a.mp4", "https://r2/b.mp4"])
    // The bin keeps the deleted take and scene, and drops the deleted empty slot.
    expect(binOf(graph).map((entry) => entry.id)).toEqual(["t-clip", "t-shot"])
    expect(binOf(graph)[0]!.result).toEqual({ url: "https://r2/c.mp4" })
  })

  it.each(["edit", "own"])("`%s` keeps every record, and the bin whole — that reader saves the graph back", async (access) => {
    plugin(access)
    tables()
    const res = await app.inject({ method: "GET", url,
      headers: { "x-user-id": access === "own" ? CREATOR : OTHER } })
    expect(res.statusCode).toBe(200)
    const graph = graphOf(res.json())
    expect(resultRows(graph.nodes)[0]).toMatchObject({ revoiceTo: PLAN, voiceMode: "character" })
    expect(resultRows(graph.nodes)[1]).toMatchObject({ voiceMode: "off" })
    expect(binOf(graph).map((entry) => entry.id)).toEqual(["t-slot", "t-clip", "t-shot"])
    expect(res.body).toContain("an unsent move")
  })
})

describe("GET /v1/workflows/:id/export (template) — a `view` reader's take records are already gone with the results", () => {
  it("the template shape drops the result rows outright, so the bin is the only place left to strip", async () => {
    plugin("view")
    tables()
    const res = await app.inject({ method: "GET", url: `/v1/workflows/${WF}/export`, headers: { "x-user-id": OTHER } })
    expect(res.statusCode).toBe(200)
    expect(res.json().nodes[0].data.generatedResults).toBeUndefined()
    expect(res.body).not.toContain("voice-owner-abi")
    expect(res.body).not.toContain("an unsent")
  })
})
