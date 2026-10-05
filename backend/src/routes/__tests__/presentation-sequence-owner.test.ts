import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `GET /v1/present/:token` — the owner's state on a linked production's NODES
 * never reaches a presentation link's reader (studio ruling T87): a clip's
 * endpoint pins (`sequenceEndpoints` on the canvas node's
 * `data.generatedResults` rows), a unit result's frozen request
 * (`requestManifest` on `data.sequenceUnitResults`) and a keyframe's runs in
 * flight (`data.keyframePendingImages`). The link returns the graph's nodes
 * and edges only, never `settings`, so of the keys T87 withholds these three
 * are the ones it could carry. Only the owner gets the nodes whole.
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

const PROVENANCE = { planRevision: 1, attemptId: "attempt-1", resolvedRequestHash: "b".repeat(64), referencePins: [], descriptionPins: [] }
/** An image run in flight on keyframe A. */
const FRAME_RUN = { jobId: "frame-run-private", startedAt: 5, frame: { prompt: "a private pending frame" }, provenance: PROVENANCE }
/** A unit result's frozen request, as the host writes it when the result lands. */
const MANIFEST = { version: 1, coverage: [{ shotId: "AB", prompt: "a private compiled prompt" }],
  media: ["https://r2/reference-private.png"], sourceSnapshots: [{ id: "AB", clipSlots: [{ prompt: "a private unsent slot" }] }] }
const PRIVATE = ["frame-private-a", "frame-run-private", "a private pending frame", "a private compiled prompt",
  "reference-private", "a private unsent slot"]

/**
 * A linked scene's clip node whose two takes carry the owner's endpoint pins,
 * keyframe A's image node with a run in flight, and a unit video node whose
 * result carries its frozen request — with the owner's state, or as any other
 * reader gets them.
 */
const nodes = (owner: boolean) => [
  { id: "clip-AB", type: "generate-video", position: { x: 0, y: 0 },
    data: { prompt: "Approach", provider: "wan-3", activeResultIndex: 0, generatedResults: [
      { url: "https://r2/a.mp4", prompt: "Approach", ...(owner ? { sequenceEndpoints: PINS } : {}) },
      { url: "https://r2/b.mp4", prompt: "Closer", ...(owner ? { sequenceEndpoints: PINS } : {}) },
    ] } },
  { id: "frame-A", type: "generate-image", position: { x: -340, y: 0 },
    data: { keyframeId: "A", generatedResults: [{ url: "https://r2/a1.png", jobId: "kf-a-1", pin: PIN("A", "kf-a-1"), provenance: PROVENANCE }],
      ...(owner ? { keyframePendingImages: [FRAME_RUN] } : {}) } },
  { id: "owner0", type: "generate-video", position: { x: 680, y: 0 },
    data: { sequenceUnitId: "zoom:u0", sequenceUnitResults: [{ url: "https://r2/unit0.mp4", requestHash: "request-0",
      pin: { unitId: "zoom:u0", resultKey: "result0", jobId: "result0", assetId: "asset-0", contentHash: "hash-0", durationSec: 4 },
      ...(owner ? { requestManifest: MANIFEST } : {}) }] } },
]

/** `.from("workflows")…single()` → the shared workflow, owned by OWNER_ID. */
function mockSharedWorkflow() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: WORKFLOW_ID, name: "Zoom film", user_id: OWNER_ID, workspace_id: null,
      nodes: nodes(true), edges: [], settings: {}, is_presentation_enabled: true,
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

describe("GET /v1/present/:token — the owner's state on a linked production's nodes is the owner's (T87)", () => {
  it.each([
    ["an anonymous reader", {}],
    ["a signed-in reader who is not the owner", { "x-user-id": VIEWER_ID }],
  ])("%s gets the takes, the frame and the unit results without the owner's state", async (_reader, headers) => {
    mockSharedWorkflow()
    const res = await app.inject({ method: "GET", url: `/v1/present/${TOKEN}`, headers })
    expect(res.statusCode).toBe(200)
    expect(res.json().isOwner).toBe(false)
    for (const key of ["sequenceEndpoints", "keyframePendingImages", "requestManifest"]) expect(res.body).not.toContain(key)
    for (const secret of PRIVATE) expect(res.body).not.toContain(secret)
    // The takes, the frame's results and the unit results are still there, every other field intact.
    expect(res.json().nodes).toEqual(nodes(false))
  })

  it("the owner gets all of it", async () => {
    mockSharedWorkflow()
    const res = await app.inject({ method: "GET", url: `/v1/present/${TOKEN}`, headers: { "x-user-id": OWNER_ID } })
    expect(res.statusCode).toBe(200)
    expect(res.json().isOwner).toBe(true)
    expect(res.json().nodes).toEqual(nodes(true))
  })
})
