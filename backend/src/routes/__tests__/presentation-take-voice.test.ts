import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `GET /v1/present/:token` — a finished take's VOICE RECORD never reaches a
 * presentation link's reader (studio ruling T42): the plan a clip was recast
 * with — the OWNER's voice ids — and the Voice control's mode, on the canvas
 * node's `data.generatedResults` rows. The token is the only credential, so the
 * reader may be anyone, signed in or not; only the owner gets the rows whole.
 *
 * `workflow-view-take-voice.test.ts` pins the same rule on the by-id doors.
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

const PLAN = { orderedVoices: [{ voiceId: "voice-owner-abi", voiceName: "Abi" }] }

/** A clip node whose two takes carry the owner's voice record. */
const voicedNodes = () => [
  { id: "generate-video-s1", type: "generate-video", position: { x: 0, y: 0 },
    data: { prompt: "Abi speaks", provider: "seedance-2", activeResultIndex: 0, generatedResults: [
      { url: "https://r2/a.mp4", prompt: "Abi speaks", revoiceTo: PLAN, voiceMode: "character" },
      { url: "https://r2/b.mp4", prompt: "Abi whispers", voiceMode: "off" },
    ] } },
]

/** `.from("workflows")…single()` → the shared workflow, owned by OWNER_ID. */
function mockSharedWorkflow() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: WORKFLOW_ID, name: "Class film", user_id: OWNER_ID, workspace_id: null,
      nodes: voicedNodes(), edges: [], settings: {}, is_presentation_enabled: true,
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

describe("GET /v1/present/:token — a take's voice record is the owner's (T42)", () => {
  it.each([
    ["an anonymous reader", {}],
    ["a signed-in reader who is not the owner", { "x-user-id": VIEWER_ID }],
  ])("%s gets the takes without their records", async (_reader, headers) => {
    mockSharedWorkflow()
    const res = await app.inject({ method: "GET", url: `/v1/present/${TOKEN}`, headers })
    expect(res.statusCode).toBe(200)
    expect(res.json().isOwner).toBe(false)
    expect(res.body).not.toContain("voice-owner-abi")
    expect(res.body).not.toContain("revoiceTo")
    expect(res.body).not.toContain("voiceMode")
    // The takes themselves are still there, every other field intact.
    expect(resultRows(res.json().nodes)).toEqual([
      { url: "https://r2/a.mp4", prompt: "Abi speaks" },
      { url: "https://r2/b.mp4", prompt: "Abi whispers" },
    ])
  })

  it("the owner gets every record", async () => {
    mockSharedWorkflow()
    const res = await app.inject({ method: "GET", url: `/v1/present/${TOKEN}`, headers: { "x-user-id": OWNER_ID } })
    expect(res.statusCode).toBe(200)
    expect(res.json().isOwner).toBe(true)
    expect(res.json().nodes).toEqual(voicedNodes())
  })
})
