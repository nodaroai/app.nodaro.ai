import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `GET /v1/present/:token` — a linked studio clip's endpoint pins
 * (`sequenceEndpoints` on the canvas node's `data.generatedResults` rows) never
 * reach a presentation link's reader (studio ruling T87). The link returns the
 * graph's nodes and edges only, never `settings`, so the pins are the one part
 * of a production's sequence planning it could carry. Only the owner gets the
 * rows whole.
 *
 * `workflow-view-sequence-owner.test.ts` pins the same rule on the by-id doors.
 */

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
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
  hasOrganizations: () => false,
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn() },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockResolvedValue(0),
}))

import { presentationRoutes } from "../presentation.js"
import { supabase } from "../../lib/supabase.js"

const OWNER_ID = "00000000-0000-4000-8000-000000000001"
const VIEWER_ID = "00000000-0000-4000-8000-000000000002"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const TOKEN = "share-token-abc"

const PIN = (keyframeId: string, key: string) => ({ keyframeId, planRevision: 1, resultKey: key, jobId: key,
  assetId: key, contentHash: "a".repeat(64), width: 10, height: 10 })
const PINS = { sequenceId: "zoom", sequenceRevision: 1, start: PIN("A", "frame-private-a"), end: PIN("B", "frame-private-b") }

/** A linked scene's clip node whose two takes carry the owner's endpoint pins. */
const linkedNodes = () => [
  { id: "clip-AB", type: "generate-video", position: { x: 0, y: 0 },
    data: { prompt: "Approach", provider: "wan-3", activeResultIndex: 0, generatedResults: [
      { url: "https://r2/a.mp4", prompt: "Approach", sequenceEndpoints: PINS },
      { url: "https://r2/b.mp4", prompt: "Closer", sequenceEndpoints: PINS },
    ] } },
]

/** `.from("workflows")…single()` → the shared workflow, owned by OWNER_ID. */
function mockSharedWorkflow() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: WORKFLOW_ID, name: "Zoom film", user_id: OWNER_ID, workspace_id: null,
      nodes: linkedNodes(), edges: [], settings: {}, is_presentation_enabled: true,
    },
    error: null,
  })
  const chain: Record<string, unknown> = { select: vi.fn(() => chain), eq: vi.fn(() => chain), single }
  vi.mocked(supabase.from).mockReturnValue(chain as never)
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
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const resultRows = (nodes: Array<{ data?: { generatedResults?: unknown[] } }>) =>
  nodes.flatMap((node) => node.data?.generatedResults ?? []) as Array<Record<string, unknown>>

describe("GET /v1/present/:token — a linked clip's endpoint pins are the owner's (T87)", () => {
  it.each([
    ["an anonymous reader", {}],
    ["a signed-in reader who is not the owner", { "x-user-id": VIEWER_ID }],
  ])("%s gets the takes without their pins", async (_reader, headers) => {
    mockSharedWorkflow()
    const res = await app.inject({ method: "GET", url: `/v1/present/${TOKEN}`, headers })
    expect(res.statusCode).toBe(200)
    expect(res.json().isOwner).toBe(false)
    expect(res.body).not.toContain("sequenceEndpoints")
    expect(res.body).not.toContain("frame-private-a")
    // The takes themselves are still there, every other field intact.
    expect(resultRows(res.json().nodes)).toEqual([
      { url: "https://r2/a.mp4", prompt: "Approach" },
      { url: "https://r2/b.mp4", prompt: "Closer" },
    ])
  })

  it("the owner gets every pin", async () => {
    mockSharedWorkflow()
    const res = await app.inject({ method: "GET", url: `/v1/present/${TOKEN}`, headers: { "x-user-id": OWNER_ID } })
    expect(res.statusCode).toBe(200)
    expect(res.json().isOwner).toBe(true)
    expect(res.json().nodes).toEqual(linkedNodes())
  })
})
