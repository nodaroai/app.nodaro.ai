import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * A published snapshot is read by every runner (an app) or cloned by every
 * user (a template). A UGC node's run state — the publisher's kept creator,
 * the last plan, the clip tickets — is the publisher's, so publishing strips
 * it from both lanes. The values below are placeholders.
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

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))

// The UGC node types are registered by a later task; the availability guard
// only needs to let them through here.
vi.mock("@/lib/surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/surface-deny.js")>()),
  findUnpublishableNodeTypes: () => [],
}))

import { publishedAppsRoutes } from "../published-apps.js"
import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"

const WORKFLOW_NODES = [
  { id: "c", type: "ugc-creator", data: { source: "photo", gender: "man", keepResult: true, result: { v: 1, placeholder: "kept" } } },
  { id: "l", type: "ugc-clips", data: { voiceId: "placeholder", quote: { lines: [] }, __listResults: ["{}"], ugcOutputs: { "plan-out": "{}" } } },
  { id: "t", type: "text-prompt", data: { text: "keep", result: "keep" } },
]

const STRIPPED = [
  { id: "c", type: "ugc-creator", data: { source: "photo", gender: "man", keepResult: false } },
  { id: "l", type: "ugc-clips", data: { voiceId: "placeholder" } },
  { id: "t", type: "text-prompt", data: { text: "keep", result: "keep" } },
]

type Written = { table: string; op: "insert" | "update"; payload: Record<string, unknown> }

/** Every table answers every query chain; inserts and updates are recorded. */
function serve(written: Written[], existingTemplate: Record<string, unknown> | null = null): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const row =
      table === "workflows"
        ? { id: WORKFLOW_ID, user_id: USER, workspace_id: null, visibility: "private", nodes: WORKFLOW_NODES, edges: [], settings: {}, thumbnail_url: null }
        : table === "workflow_templates"
          ? existingTemplate
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
    chain.single = vi.fn(async () => (table === "workflows" ? { data: row, error: null } : echoed()))
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

describe("publishing strips UGC run state from the snapshot", () => {
  it("an app: snapshot_nodes holds the choices, none of the run state, keepResult off", async () => {
    const written: Written[] = []
    serve(written)

    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": USER },
      payload: { workflowId: WORKFLOW_ID, name: "A UGC app" },
    })

    expect(res.statusCode).toBe(200)
    const insert = written.find((w) => w.table === "published_apps" && w.op === "insert")
    expect(insert?.payload.snapshot_nodes).toEqual(STRIPPED)
    // The publisher's own workflow is not touched.
    expect(WORKFLOW_NODES[0]!.data.keepResult).toBe(true)
  })

  it("a template (first publish): snapshot_nodes is stripped", async () => {
    const written: Written[] = []
    serve(written)

    const res = await app.inject({
      method: "POST",
      url: "/v1/templates/publish",
      headers: { "x-user-id": USER },
      payload: { workflowId: WORKFLOW_ID, name: "A UGC template" },
    })

    expect(res.statusCode).toBe(200)
    const insert = written.find((w) => w.table === "workflow_templates" && w.op === "insert")
    expect(insert?.payload.snapshot_nodes).toEqual(STRIPPED)
  })

  it("a template (re-publish): the UPDATE is stripped too", async () => {
    const written: Written[] = []
    serve(written, { id: "tpl-1", slug: "tpl-ab12", name: "A UGC template", listed_in: [] })

    const res = await app.inject({
      method: "POST",
      url: "/v1/templates/publish",
      headers: { "x-user-id": USER },
      payload: { workflowId: WORKFLOW_ID, name: "A UGC template" },
    })

    expect(res.statusCode).toBe(200)
    const update = written.find((w) => w.table === "workflow_templates" && w.op === "update")
    expect(update?.payload.snapshot_nodes).toEqual(STRIPPED)
  })
})
