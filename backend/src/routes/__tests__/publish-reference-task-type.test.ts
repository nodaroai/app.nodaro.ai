import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * A stored Seedance reference task type on the writes that store a COPY of a
 * workflow graph (decided 2026-11-13): an app's or a template's published
 * snapshot, and the workflow a template clone creates. Each stores the graph
 * with a `referenceTaskType` no model the node runs lists removed — that one
 * key, nothing else (`withListedReferenceTaskTypes`). An app can expose the
 * model to its runners, and a clone is a workflow anyone can switch to
 * Seedance 2.5, so a hidden value must not ship. The whole stored graph is
 * asserted.
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
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))
vi.mock("@/lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/storage.js")>()),
  copyToTemplatePreview: vi.fn(async (source: string) => `durable:${source}`),
}))

import { publishedAppsRoutes } from "../published-apps.js"
import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const PROJECT_ID = "00000000-0000-4000-8000-000000000040"
const at = { x: 0, y: 0 }

const GRAPH = [
  { id: "kling", type: "generate-video", position: at, data: { provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9", duration: 5, referenceTaskType: "edit" } },
  { id: "sd25", type: "generate-video", position: at, data: { provider: "seedance-2-5", prompt: "a cat", referenceTaskType: "edit" } },
  { id: "img", type: "generate-image", position: at, data: { provider: "gpt-image", aspectRatio: "16:9", resolution: "2K" } },
  { id: "p", type: "text-prompt", position: at, data: { text: "hi" } },
]
const STORED = [
  { id: "kling", type: "generate-video", position: at, data: { provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9", duration: 5 } },
  GRAPH[1],
  GRAPH[2],
  GRAPH[3],
]
const CLEAN = [GRAPH[1], GRAPH[2], GRAPH[3]]
const EDGES = [{ id: "e1", source: "p", sourceHandle: "text", target: "kling", targetHandle: "prompt" }]

type Written = { table: string; op: "insert" | "update"; payload: Record<string, unknown> }

/** Every table answers; the workflow (or the template) serves `nodes`; inserts and updates are recorded. */
function serve(written: Written[], nodes: unknown[]): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const row =
      table === "workflows"
        ? { id: WORKFLOW_ID, user_id: USER, workspace_id: null, visibility: "private", nodes, edges: EDGES, settings: {}, thumbnail_url: null, template_id: null }
        : table === "workflow_templates"
          ? { id: "tpl-1", slug: "tpl-ab12", name: "A template", creator_id: USER, is_active: true, listed_in: [], snapshot_nodes: nodes, snapshot_edges: EDGES, snapshot_settings: {}, clone_count: 0 }
          : table === "projects"
            ? { id: PROJECT_ID, user_id: USER }
            : null
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "in", "order", "limit", "upsert", "delete"]) chain[m] = vi.fn(() => chain)
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      written.push({ table, op: "insert", payload })
      return chain
    })
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      written.push({ table, op: "update", payload })
      return chain
    })
    const echoed = () => ({ data: { id: "row-1", slug: "s", ...(written.at(-1)?.payload ?? {}) }, error: null })
    chain.single = vi.fn(async () => (table === "workflows" || table === "projects" ? { data: row, error: null } : echoed()))
    chain.maybeSingle = vi.fn(async () => ({ data: row, error: null }))
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return chain
  }) as never)
}

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
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
})

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, headers: { "x-user-id": USER }, payload })

/** Each copy-storing write: its request, and the stored node list it writes. */
const COPIES: ReadonlyArray<readonly [string, () => Promise<{ statusCode: number; body: string }>, (written: Written[]) => unknown]> = [
  ["an app's published snapshot", () => post("/v1/apps/publish", { workflowId: WORKFLOW_ID, name: "An app" }),
    (w) => w.find((x) => x.table === "published_apps" && x.op === "insert")?.payload.snapshot_nodes],
  ["a template's published snapshot", () => post("/v1/templates/publish", { workflowId: WORKFLOW_ID, name: "A template" }),
    (w) => w.find((x) => x.table === "workflow_templates" && (x.op === "insert" || x.op === "update") && "snapshot_nodes" in x.payload)?.payload.snapshot_nodes],
  ["a template clone's workflow", () => post("/v1/templates/tpl-ab12/clone", { projectId: PROJECT_ID }),
    (w) => w.find((x) => x.table === "workflows" && x.op === "insert")?.payload.nodes],
]

describe("a stored reference task type on the writes that store a copy of a graph", () => {
  it.each(COPIES)("%s: the Kling node loses only that key; everything else is stored as written", async (_what, write, stored) => {
    const written: Written[] = []
    serve(written, GRAPH)
    const res = await write()
    expect(res.statusCode, res.body).toBeLessThan(300)
    expect(stored(written)).toStrictEqual(STORED)
  })

  it.each(COPIES)("%s: a graph without the field is stored byte for byte", async (_what, write, stored) => {
    const written: Written[] = []
    serve(written, CLEAN)
    const res = await write()
    expect(res.statusCode, res.body).toBeLessThan(300)
    expect(JSON.stringify(stored(written))).toBe(JSON.stringify(CLEAN))
  })
})
