import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { PREVIEW_RENDER_NESTED } from "@nodaro/shared"

/**
 * A component runs inside its caller's run and hands its outputs to the
 * caller's nodes: a Preview render in it would be consumed with no Render
 * final anywhere (decided 2026-10-04: refused permanently). Publishing one is
 * refused before anything is written. An APP is not refused at publish — its
 * runs refuse until app review ships.
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
vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))
vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "llm-chat", category: "ai-text" },
    { type: "apply-edl", category: "processing-video" },
    { type: "sub-workflow-output", category: "output" },
  ],
}))

import { publishedAppsRoutes } from "../published-apps.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const OWNER = "00000000-0000-4000-8000-0000000000ad"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"

function workflowRow(quality: "proxy" | "final") {
  return {
    id: WORKFLOW_ID,
    user_id: OWNER,
    workspace_id: null,
    visibility: "private",
    nodes: [
      { id: "plan", type: "llm-chat", data: {} },
      { id: "cut", type: "apply-edl", data: { quality } },
      { id: "out", type: "sub-workflow-output", data: {} },
    ],
    edges: [
      { id: "a", source: "plan", target: "cut" },
      { id: "b", source: "cut", target: "out" },
    ],
    settings: {},
  }
}

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
  flag.on = true
  __resetAvailabilityOverridesForTests({ nodes: new Set(["llm-chat", "apply-edl", "sub-workflow-output"]) })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(publishedAppsRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
})

const component = {
  workflowId: WORKFLOW_ID,
  name: "Cut part",
  publishType: "component",
  componentMetadata: {
    inputs: [],
    outputs: [{ id: "out", name: "Out", type: "video", required: true, mediaPreview: true, fieldKey: "videoUrl" }],
    exposedSettings: [],
  },
}

describe("publishing a component that holds a Preview render", () => {
  it("is refused with the nested code, before anything is written", async () => {
    serveWorkflow(workflowRow("proxy"))
    const res = await app.inject({ method: "POST", url: "/v1/apps/publish", headers: { "x-user-id": OWNER }, payload: component })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(PREVIEW_RENDER_NESTED)
    expect(res.json().error.message).toMatch(/Final/)
    const tables = vi.mocked(supabase.from).mock.calls.map(([t]) => t)
    expect(tables.every((t) => t === "workflows")).toBe(true)
  })

  it("a component whose render is Final is not refused for it", async () => {
    serveWorkflow(workflowRow("final"))
    const res = await app.inject({ method: "POST", url: "/v1/apps/publish", headers: { "x-user-id": OWNER }, payload: component })
    expect(res.json().error?.code).not.toBe(PREVIEW_RENDER_NESTED)
  })

  it("an APP holding a Preview render is not refused at publish (its runs refuse)", async () => {
    serveWorkflow(workflowRow("proxy"))
    const res = await app.inject({
      method: "POST",
      url: "/v1/apps/publish",
      headers: { "x-user-id": OWNER },
      payload: { workflowId: WORKFLOW_ID, name: "Cut app" },
    })
    expect(res.json().error?.code).not.toBe(PREVIEW_RENDER_NESTED)
  })
})

describe("PREVIEW_STOP_RULE_ENABLED off (production until Render final): dev before the rule", () => {
  it("publishes a component that holds a Preview render", async () => {
    flag.on = false
    serveWorkflow(workflowRow("proxy"))
    const res = await app.inject({ method: "POST", url: "/v1/apps/publish", headers: { "x-user-id": OWNER }, payload: component })
    expect(res.json().error?.code).not.toBe(PREVIEW_RENDER_NESTED)
    // It reached past the workflow read, as on dev.
    const tables = vi.mocked(supabase.from).mock.calls.map(([t]) => t)
    expect(tables.some((t) => t !== "workflows")).toBe(true)
  })
})
