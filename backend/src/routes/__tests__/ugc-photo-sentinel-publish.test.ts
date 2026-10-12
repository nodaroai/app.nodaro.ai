/**
 * The photo influence set's guard (lib/__tests__/ugc-photo-sentinel-cases.ts) on every publish: an
 * app, a component, an app's next version, a template and a template's re-publish. For every case,
 * (a) no `KILL` reaches what is written (the snapshot, its settings, the component's metadata, an
 * automatic preview) nor the graph the listing is priced on; a preview the author chose (the client
 * sends the picked node's render) ships exactly as chosen, whatever it shows; (c) every `KEEP` of
 * the workflow ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

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
vi.mock("@/lib/surface-deny.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/surface-deny.js")>()),
  findUnpublishableNodeTypes: () => [],
}))

import { publishedAppsRoutes } from "../published-apps.js"
import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"
import { estimateWorkflowListingCredits } from "../../ee/billing/credits.js"
import { CONTROL_CASES, KEEP, KILL, SENTINEL_CASES, marked, type SentinelCase } from "../../lib/__tests__/ugc-photo-sentinel-cases.js"

const AUTHOR = "00000000-0000-4000-8000-0000000000a1"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"

type Written = { table: string; op: "insert" | "update"; payload: Record<string, unknown> }

/** The author's workflow (the case's graph), their other workflows by id, and on request an earlier version or template. */
function serve(c: SentinelCase, written: Written[], earlier: { app?: boolean; template?: boolean } = {}): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    let id: unknown
    const own = { id: WORKFLOW_ID, user_id: AUTHOR, workspace_id: null, visibility: "private", nodes: c.graph.nodes, edges: c.graph.edges, settings: c.settings, thumbnail_url: null }
    const rowOf = () => {
      if (table === "workflows") return typeof id === "string" && Object.hasOwn(c.workflows, id) ? c.workflows[id] : own
      if (table === "workflow_templates") return earlier.template ? { id: "tpl-1", slug: "tpl-ab12", name: "Earlier", listed_in: [] } : null
      return null
    }
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "is", "in", "order", "limit", "upsert", "delete"]) chain[m] = vi.fn(() => chain)
    chain.eq = vi.fn((column: string, value: unknown) => {
      if (column === "id") id = value
      return chain
    })
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      written.push({ table, op: "insert", payload })
      return chain
    })
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      written.push({ table, op: "update", payload })
      return chain
    })
    const echoed = () => ({ data: { id: "row-1", slug: "s", ...(written.at(-1)?.payload ?? {}) }, error: null })
    chain.single = vi.fn(async () => (table === "workflows" ? { data: rowOf(), error: null } : echoed()))
    chain.maybeSingle = vi.fn(async () => ({ data: rowOf(), error: null }))
    // A list read: the app's earlier version when there is one.
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === "published_apps" && earlier.app ? [{ id: "app-v1", version: 1, slug: "earlier", is_listed: false }] : [], error: null })
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

/** What the client sends: the thumbnail the author picked, and its render on the canvas as the preview — the author's own. */
function clientPreview(c: SentinelCase): Record<string, unknown> {
  if (!c.thumbnailNodeId) return {}
  const picked = c.graph.nodes.find((n) => n.id === c.thumbnailNodeId)
  return { thumbnailNodeId: c.thumbnailNodeId, previewMediaUrl: picked?.data.generatedImageUrl, previewMediaType: "image" }
}

/** A component's interface: its input handles, a render outside the video as its output, its exposed settings. */
function componentMetadata(c: SentinelCase) {
  return {
    inputs: (c.componentInputs ?? []).map((id) => ({ id, name: id, type: "image", required: true, fieldKey: "url" })),
    outputs: [{ id: "lone", name: "Image", type: "image", required: true, mediaPreview: true, fieldKey: "imageUrl" }],
    exposedSettings: (c.exposed ?? []).map((s) => ({ ...s, label: s.field })),
  }
}

const SURFACES = [
  { surface: "an app", url: "/v1/apps/publish", table: "published_apps", op: "insert", earlier: {}, body: (c: SentinelCase) => clientPreview(c) },
  {
    surface: "a component",
    url: "/v1/apps/publish",
    table: "published_apps",
    op: "insert",
    earlier: {},
    body: (c: SentinelCase) => ({ publishType: "component", componentMetadata: componentMetadata(c) }),
  },
  { surface: "an app's next version", url: "/v1/apps/publish", table: "published_apps", op: "insert", earlier: { app: true }, body: (c: SentinelCase) => clientPreview(c) },
  { surface: "a template", url: "/v1/templates/publish", table: "workflow_templates", op: "insert", earlier: {}, body: (c: SentinelCase) => clientPreview(c) },
  { surface: "a template's re-publish", url: "/v1/templates/publish", table: "workflow_templates", op: "update", earlier: { template: true }, body: (c: SentinelCase) => clientPreview(c) },
] as const

const CASES = [...SENTINEL_CASES, ...CONTROL_CASES]

describe.each(SURFACES.map((s) => [s.surface, s] as const))("%s", (_surface, s) => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s: (a) no KILL is written or priced; (c) every KEEP ships", async (_name, c) => {
    const written: Written[] = []
    serve(c, written, s.earlier)
    const res = await app.inject({ method: "POST", url: s.url, headers: { "x-user-id": AUTHOR }, payload: { workflowId: WORKFLOW_ID, name: c.name.slice(0, 90), ...s.body(c) } })
    expect(res.statusCode, res.body).toBe(200)
    const row = written.find((w) => w.table === s.table && w.op === s.op)
    expect(row, "the snapshot was written").toBeDefined()
    // A preview the author chose ships as they chose it — their photo, or a value on its path,
    // included. Nothing else carries a KILL: not the snapshot, not an automatic preview.
    const pick = (s.body(c) as { previewMediaUrl?: string }).previewMediaUrl
    const { preview_media_url: preview, ...rest } = row!.payload
    if (pick) expect(preview).toBe(s.table === "workflow_templates" ? `durable:${pick}` : pick)
    else expect(JSON.stringify(preview ?? null)).not.toContain(KILL)
    expect(JSON.stringify(rest)).not.toContain(KILL)
    expect(pick ? res.body.split(pick).join("") : res.body).not.toContain(KILL)
    const priced = vi.mocked(estimateWorkflowListingCredits).mock.calls.at(-1)?.[0]
    expect(JSON.stringify(priced ?? [])).not.toContain(KILL)
    const snapshot = JSON.stringify(row!.payload.snapshot_nodes)
    for (const keep of marked(c, KEEP)) expect(snapshot, keep).toContain(keep)
  })
})
