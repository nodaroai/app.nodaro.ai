import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * Nothing that carries a node hidden from users may be PUBLISHED to them.
 *
 * The admin switch (Admin → Availability) hides a node from users; an admin can
 * still build with it. But an app, a component or a template is run by its
 * users — an app run executes as its runner — so publishing one would hand users
 * something that fails part-way (after its upstream nodes already billed them)
 * and would put the hidden node on the PUBLIC app manifest while discovery still
 * hides it. Both publish lanes therefore ask as the USERS' view, even when the
 * publisher is an admin who can run the node themselves — which is the case
 * these tests use, because it is the only publisher who can own such a workflow.
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

// The publisher IS an admin: the availability answer must not depend on it.
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-prompt", category: "input" },
    { type: "generate-image", category: "ai-image" },
    { type: "instagram-scrape", category: "input" },
    { type: "meta-ads-scrape", category: "input" },
    { type: "web-scrape", category: "input" },
  ],
}))

import { publishedAppsRoutes } from "../published-apps.js"
import { workflowTemplatesRoutes } from "../workflow-templates.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"

function workflowRow(nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>) {
  return { id: WORKFLOW_ID, user_id: ADMIN, workspace_id: null, visibility: "private", nodes, edges: [], settings: {} }
}

/** `from("workflows").select(...).eq("id", _).single() | maybeSingle()` → `row`. Any
 *  other table is a bare chain: the refusal must come BEFORE anything is written. */
function serveWorkflow(row: Record<string, unknown>): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const result = { data: table === "workflows" ? row : null, error: null }
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "in", "order", "limit", "insert", "update", "upsert", "delete"]) {
      chain[m] = vi.fn(() => chain)
    }
    chain.single = vi.fn().mockResolvedValue(result)
    chain.maybeSingle = vi.fn().mockResolvedValue(result)
    return chain
  }) as never)
}

let app: FastifyInstance

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  vi.clearAllMocks()
  // The stored override: everything on except the two scrapers.
  __resetAvailabilityOverridesForTests({ nodes: new Set(["text-prompt", "generate-image", "web-scrape"]) })

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

const LANES = [
  ["app", "/v1/apps/publish", { workflowId: WORKFLOW_ID, name: "Scraper app" }],
  ["component", "/v1/apps/publish", {
    workflowId: WORKFLOW_ID, name: "Scraper part", publishType: "component",
    componentMetadata: {
      inputs: [],
      outputs: [{ id: "n1", name: "Out", type: "image", required: true, mediaPreview: true, fieldKey: "imageUrl" }],
      exposedSettings: [],
    },
  }],
  ["template", "/v1/templates/publish", { workflowId: WORKFLOW_ID, name: "Scraper template" }],
] as const

describe("publishing a workflow that carries a node hidden from users", () => {
  it.each(LANES)("%s: refused with the coded error, naming the node — even for an admin publisher", async (_lane, url, payload) => {
    serveWorkflow(workflowRow([{ id: "n1", type: "generate-image" }, { id: "n2", type: "instagram-scrape" }]))

    const res = await app.inject({ method: "POST", url, headers: { "x-user-id": ADMIN }, payload })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("node_not_available")
    expect(res.json().error.message).toContain("instagram-scrape")
    expect(res.json().error.message).not.toContain("generate-image")

    // Refused BEFORE anything is written: only the workflow was read.
    const tables = vi.mocked(supabase.from).mock.calls.map(([t]) => t)
    expect(tables.every((t) => t === "workflows")).toBe(true)
  })

  it.each(LANES)("%s: a Web Scrape node pointed at the withdrawn Instagram source is refused too", async (_lane, url, payload) => {
    serveWorkflow(
      workflowRow([
        { id: "n1", type: "generate-image" },
        { id: "n2", type: "web-scrape", data: { actor: "instagram", target: "nasa" } },
      ]),
    )

    const res = await app.inject({ method: "POST", url, headers: { "x-user-id": ADMIN }, payload })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("node_not_available")
    expect(res.json().error.message).toContain("web-scrape:instagram")
  })

  it.each(LANES)("%s: a Web Scrape node on any other source publishes", async (_lane, url, payload) => {
    serveWorkflow(workflowRow([{ id: "n1", type: "web-scrape", data: { actor: "google-search", query: "nasa" } }]))
    const res = await app.inject({ method: "POST", url, headers: { "x-user-id": ADMIN }, payload })
    expect(JSON.stringify(res.json())).not.toContain("node_not_available")
  })

  it.each(LANES)("%s: a workflow of released nodes is not refused for availability", async (_lane, url, payload) => {
    serveWorkflow(workflowRow([{ id: "n1", type: "generate-image" }, { id: "n2", type: "text-prompt" }]))

    const res = await app.inject({ method: "POST", url, headers: { "x-user-id": ADMIN }, payload })

    // The bare stub fails the publish further down — irrelevant here. What
    // matters is that the availability guard did not refuse it.
    expect(JSON.stringify(res.json())).not.toContain("node_not_available")
  })
})
