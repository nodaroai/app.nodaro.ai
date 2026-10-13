/**
 * The photo influence set's guard (lib/__tests__/ugc-photo-sentinel-cases.ts) on every read of a
 * workflow by anyone but its author: a share link's view (signed out, or a signed-in viewer), a
 * shared workflow's public read, and the source of an editable copy. For every case, (a) no `KILL`
 * reaches what is read; (c) every `KEEP` does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import type { SentinelCase } from "../../lib/__tests__/ugc-photo-sentinel-cases.js"

const h = vi.hoisted(() => ({ current: null as SentinelCase | null }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
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
vi.mock("@/lib/workflow-delete.js", () => ({ deleteWorkflowWithPrivateMedia: vi.fn() }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn() } }))
vi.mock("@/ee/billing/credits.js", () => ({ estimateWorkflowCredits: vi.fn().mockResolvedValue(0) }))
// The copier stands nowhere on the author's work: it is read for a copy only.
vi.mock("@/lib/workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workflow-access.js")>()),
  workflowAccessFromRow: vi.fn(async () => "none"),
}))

import { presentationRoutes } from "../presentation.js"
import { workflowRoutes } from "../workflows.js"
import { loadStudioEditableCopySource } from "../../lib/workflow-route-access.js"
import { supabase } from "../../lib/supabase.js"
import { CONTROL_CASES, KEEP, KILL, SENTINEL_CASES, marked } from "../../lib/__tests__/ugc-photo-sentinel-cases.js"

const AUTHOR = "00000000-0000-4000-8000-0000000000a1"
const READER = "00000000-0000-4000-8000-0000000000b2"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"

/** The case's workflow, shared every way it can be; the author's other workflows by id. */
function serve(): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const c = h.current!
    let id: unknown
    const row = () => {
      if (table !== "workflows") return { id: "row-1" }
      if (typeof id === "string" && Object.hasOwn(c.workflows, id)) return c.workflows[id]
      return {
        id: WORKFLOW_ID, name: "Shared", user_id: AUTHOR, workspace_id: null, visibility: "private", project_id: null, folder_id: null,
        is_presentation_enabled: true, nodes: c.graph.nodes, edges: c.graph.edges,
        settings: { ...c.settings, studio: { shared: true, allowEditableCopy: true, version: 3 } },
      }
    }
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: row(), error: null })
        if (prop === "single" || prop === "maybeSingle") return async () => ({ data: row(), error: null })
        if (prop === "eq") {
          return (column: string, value: unknown) => {
            if (column === "id") id = value
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

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await presentationRoutes(instance)
  })
  await app.register(workflowRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const reply = () => {
  const r = { status: vi.fn(() => r), send: vi.fn(() => r) }
  return r
}

const SURFACES = [
  { surface: "a share link's view, signed out", read: async () => (await app.inject({ method: "GET", url: "/v1/present/share-token-abc" })).body },
  {
    surface: "a share link's view, by a signed-in viewer",
    read: async () => (await app.inject({ method: "GET", url: "/v1/present/share-token-abc", headers: { "x-user-id": READER } })).body,
  },
  {
    surface: "a shared workflow's public read",
    read: async () => (await app.inject({ method: "GET", url: `/v1/public/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": READER } })).body,
  },
  {
    surface: "an editable copy's source",
    read: async () => {
      const loaded = await loadStudioEditableCopySource({} as never, reply() as never, READER, WORKFLOW_ID, "view", "id, user_id, workspace_id, visibility, settings, nodes, edges", "Failed", { resolveResultIds: false })
      if (!loaded.ok) throw new Error("the copy source was not read")
      return JSON.stringify(loaded.row)
    },
  },
] as const

describe.each(SURFACES.map((s) => [s.surface, s] as const))("%s", (_surface, s) => {
  it.each([...SENTINEL_CASES, ...CONTROL_CASES].map((c) => [c.name, c] as const))("%s: (a) no KILL is read; (c) every KEEP is", async (_name, c) => {
    h.current = c
    serve()
    const body = await s.read()
    expect(body).not.toContain(KILL)
    for (const keep of marked(c, KEEP)) expect(body, keep).toContain(keep)
  })
})
