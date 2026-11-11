import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * GET /v1/public/workflows/:id on a deployment that does not allow public
 * outputs (`outputs.allowPublic: false`).
 *
 * The read takes no sign-in and returns the whole workflow, results included,
 * once its owner set `settings.studio.shared === true`. Such a deployment has
 * no work shared by link: every caller but the signed-in owner gets exactly the
 * answer a workflow that is not shared gets (the same 404, no existence
 * signal, no lookup past the row), while the owner keeps today's answer. With
 * the switch on — no profile at all, as every install without one runs — the
 * answer is what it always was.
 */

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

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"

const ROW = {
  id: WF,
  project_id: "00000000-0000-4000-8000-000000000010",
  user_id: OWNER,
  workspace_id: null,
  visibility: "private",
  folder_id: null,
  name: "My Workflow",
  description: "Test workflow",
  is_template: false,
  thumbnail_url: null,
  version: 1,
  source_prompt: null,
  nodes: [{ id: "n1", type: "generate-image" }],
  edges: [{ source: "n1", target: "n2" }],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}
const SHARED = { ...ROW, settings: { studio: { shared: true, version: 3 } } }
const UNSHARED = { ...ROW, settings: { studio: { shared: false, version: 3 } } }

/** The whole answer a shared workflow's read gives today. */
const SHARED_ANSWER = {
  data: {
    id: WF,
    name: "My Workflow",
    thumbnailUrl: null,
    nodes: [{ id: "n1", type: "generate-image" }],
    edges: [{ source: "n1", target: "n2" }],
    settings: { studio: { shared: true, version: 3 } },
  },
}

const tables: string[] = []

function serveRow(row: unknown) {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    tables.push(table)
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    const eq = vi.fn().mockReturnValue({ single })
    return { select: vi.fn().mockReturnValue({ eq }) }
  }) as never)
}

function setProfile(profile: Record<string, unknown> | null) {
  if (profile) process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  tables.length = 0
  setProfile({ outputs: { allowPublic: false } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") req.userId = h
  })
  await app.register(async (i) => { await workflowRoutes(i) })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setProfile(null)
})

const read = (userId?: string) =>
  app.inject({ method: "GET", url: `/v1/public/workflows/${WF}`, headers: userId ? { "x-user-id": userId } : {} })

describe("GET /v1/public/workflows/:id with outputs.allowPublic false", () => {
  it.each([
    ["a signed-out caller", undefined],
    ["a signed-in caller who is not the owner", OTHER],
  ])("%s gets exactly the answer of a workflow that is not shared, and nothing past the row is read", async (_who, userId) => {
    serveRow(UNSHARED)
    const notShared = await read(userId)
    serveRow(SHARED)
    tables.length = 0
    const shared = await read(userId)

    expect(shared.statusCode).toBe(404)
    expect(shared.statusCode).toBe(notShared.statusCode)
    expect(shared.body).toBe(notShared.body)
    expect(shared.json()).toEqual({ error: { code: "not_found", message: "Workflow not found" } })
    expect(shared.body).not.toContain("My Workflow")
    expect(tables).toEqual(["workflows"])
  })

  it("the signed-in owner still reads their own shared workflow, exactly as before", async () => {
    serveRow(SHARED)
    const res = await read(OWNER)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(SHARED_ANSWER)
  })

  it("the owner's unshared workflow is still not served here (the flag is still asked)", async () => {
    serveRow(UNSHARED)
    const res = await read(OWNER)
    expect(res.statusCode).toBe(404)
  })
})

describe("GET /v1/public/workflows/:id with public outputs allowed", () => {
  it.each([
    ["no profile (the default)", null],
    ["a profile that allows public outputs", { outputs: { allowPublic: true } }],
  ])("%s: anyone holding the id reads the shared workflow as before", async (_label, profile) => {
    setProfile(profile)
    serveRow(SHARED)
    const signedOut = await read()
    expect(signedOut.statusCode).toBe(200)
    expect(signedOut.json()).toEqual(SHARED_ANSWER)

    serveRow(SHARED)
    const other = await read(OTHER)
    expect(other.statusCode).toBe(200)
    expect(other.json()).toEqual(SHARED_ANSWER)
  })

  it("an unshared workflow is still a 404", async () => {
    setProfile(null)
    serveRow(UNSHARED)
    const res = await read()
    expect(res.statusCode).toBe(404)
  })
})
