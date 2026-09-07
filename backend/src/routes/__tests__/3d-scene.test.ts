/**
 * POST /v1/3d-scene/generate and /edit.
 *
 * The order money moves is what these assert: every refusal that must happen
 * BEFORE a row exists (a stale revision, an operation list that cannot apply,
 * a keyless install, a second video reference), then the row + reservation,
 * then the analysis child created through the analysis route with the caller's
 * auth forwarded, then the enqueue payload the worker reads.
 *
 * The deterministic lane's two promises get their own cases: it reserves the
 * ZERO-cost identifier (never an LLM tier) and it rehearses the operations in
 * the route, so a caller learns about a locked object from a 403 rather than
 * from a failed job minutes later.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  shouldProxyLlmToCloud: vi.fn(),
  insertJob: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  queueAdd: vi.fn(),
  jobUpdate: vi.fn(),
  jobDelete: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
  cancelOwnedJob: vi.fn(),
  creditIds: [] as string[],
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "", GEMINI_API_KEY: "", INTERNAL_ORCHESTRATOR_SECRET: "s".repeat(64), SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ shouldProxyLlmToCloud: mocks.shouldProxyLlmToCloud }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // Record what the guard WOULD have reserved so the zero-cost lane is
  // observable — a resolver that quietly returned an LLM tier here is exactly
  // the regression "deterministic edits are free" is protecting against.
  creditGuard: (resolver: (req: unknown) => string) => async (req: unknown) => {
    mocks.creditIds.push(resolver(req))
  },
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refundReservedCreditsForJob }))
vi.mock("@/lib/cancel-job.js", () => ({ cancelOwnedJob: mocks.cancelOwnedJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mocks.queueAdd }, tryRemoveFromQueue: vi.fn(), redis: {} }))
vi.mock("@/lib/supabase.js", () => {
  const terminal = vi.fn().mockResolvedValue({ data: null, error: null })
  const eq1 = vi.fn(() => ({ eq: terminal }))
  return {
    supabase: {
      from: vi.fn(() => ({
        update: (row: Record<string, unknown>) => { mocks.jobUpdate(row); return { eq: eq1 } },
        delete: () => { mocks.jobDelete(); return { eq: eq1 } },
      })),
    },
  }
})

import { SCENE3D_PLAN_TYPE, SCENE3D_SCHEMA_VERSION, type Scene3DPlan } from "@nodaro/shared"
import { scene3DRoutes, scene3DEditCreditId, scene3DRenderFrame } from "../3d-scene.js"
import { setPluginEngines } from "../../lib/private-plugins/engine-registry.js"
import { config } from "../../lib/config.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const REV = "11111111-2222-4333-8444-555555555555"
const IMAGE = "https://r2.example/uploads/ref.png"
const VIDEO = "https://r2.example/uploads/clip.mp4"

const PLAN: Scene3DPlan = {
  planType: SCENE3D_PLAN_TYPE,
  schemaVersion: SCENE3D_SCHEMA_VERSION,
  revisionId: REV,
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 96,
  backgroundColor: "#101014",
  camera: { position: [0, 2, 6], target: [0, 0, 0], focalLengthMm: 35, sensorWidthMm: 36 },
  objects: [
    { id: "ground", name: "Ground", primitive: "plane", dimensions: [10, 0.01, 10], position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#333333" },
    { id: "hero", name: "Hero", primitive: "capsule", dimensions: [0.5, 1.7, 0.5], position: [0, 0.85, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#cc8844" },
  ],
  lighting: { ambientIntensity: 0.4, keyIntensity: 1.2, keyPosition: [4, 6, 4] },
}

let app: FastifyInstance
let analysisAnswer: { status: number; body: unknown }
let analysisSeen: { headers: Record<string, unknown>; body: unknown } | null

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({
    method: "POST",
    url,
    headers: { authorization: "Bearer caller-token", "x-nodaro-workspace": "ws-1" },
    payload,
  })

const generate = (over: Record<string, unknown> = {}) =>
  post("/v1/3d-scene/generate", { prompt: "A lone figure in an empty warehouse", userId: USER_ID, ...over })

const edit = (over: Record<string, unknown> = {}) =>
  post("/v1/3d-scene/edit", { scenePlan: PLAN, expectedRevisionId: REV, userId: USER_ID, ...over })

const enqueued = () => mocks.queueAdd.mock.calls.at(-1)?.[1] as Record<string, unknown>

beforeEach(async () => {
  vi.clearAllMocks()
  setPluginEngines({})
  config.SCENE3D_ADVANCED_ENABLED = false
  config.SCENE3D_LOCAL_ENABLED = false
  mocks.creditIds = []
  mocks.shouldProxyLlmToCloud.mockResolvedValue(false)
  mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
  mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 30, watermark: false })
  mocks.queueAdd.mockResolvedValue({ id: "bull-1" })
  mocks.refundReservedCreditsForJob.mockResolvedValue(1)
  mocks.cancelOwnedJob.mockResolvedValue({ kind: "cancelled", analysisJobId: null })
  analysisAnswer = { status: 200, body: { jobId: "analysis-1" } }
  analysisSeen = null

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  app.post("/v1/video-analysis", async (req, reply) => {
    analysisSeen = { headers: req.headers, body: req.body }
    return reply.status(analysisAnswer.status).send(analysisAnswer.body)
  })
  await app.register(async (instance) => { await scene3DRoutes(instance) })
  await app.ready()
})
afterEach(async () => { await app.close() })

describe("scene3DRenderFrame", () => {
  it("defaults to 4s at 24fps in 16:9", () => {
    expect(scene3DRenderFrame({})).toEqual({ fps: 24, durationInFrames: 96, width: 1920, height: 1080 })
  })
  it("honours the caller's duration, fps and aspect ratio", () => {
    expect(scene3DRenderFrame({ durationSeconds: 2.5, fps: 30, aspectRatio: "9:16" })).toEqual({
      fps: 30, durationInFrames: 75, width: 1080, height: 1920,
    })
  })
})

describe("optional advanced engine admission", () => {
  it("refuses unavailable or unknown engines before Basic credit checks", async () => {
    const advanced = await generate({ engine: "blender-cloud" })
    expect(advanced.statusCode).toBe(503)
    expect(advanced.json().error.code).toBe("SCENE_CAPABILITY_UNAVAILABLE")
    expect((await generate({ engine: "misspelled" })).statusCode).toBe(400)
    expect(mocks.creditIds).toEqual([])
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("delegates the authenticated request intact and skips the Basic reservation", async () => {
    config.SCENE3D_ADVANCED_ENABLED = true
    const advanced = {
      capabilities: vi.fn().mockResolvedValue({ version: "1", engines: ["blender-cloud"], sceneSchemaVersions: [2], maxRepairPasses: 2 }),
      generate: vi.fn().mockResolvedValue({ jobId: "advanced-job" }), edit: vi.fn(),
    }
    setPluginEngines({ scene3d: advanced })
    const references = [{ id: "ref", kind: "image", url: IMAGE }]
    const result = await generate({ engine: "blender-cloud", references, acceptedSceneSchemaVersions: [2] })
    expect(result.json()).toEqual({ jobId: "advanced-job" })
    const req = advanced.generate.mock.calls[0][0]
    expect(req.userId).toBe(USER_ID)
    expect(req.headers["x-nodaro-workspace"]).toBe("ws-1")
    expect(req.body.references).toEqual(references)
    expect(mocks.creditIds).toEqual([])
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("keeps local execution disabled independently of cloud authoring", async () => {
    config.SCENE3D_ADVANCED_ENABLED = true
    const engine = { capabilities: vi.fn(), generate: vi.fn(), edit: vi.fn() }
    setPluginEngines({ scene3d: engine })
    expect((await generate({ engine: "blender-local" })).statusCode).toBe(503)
    expect(engine.generate).not.toHaveBeenCalled()
    expect(mocks.creditIds).toEqual([])
  })

  it("reports Basic capabilities when no advanced engine is installed", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/3d-scene/capabilities" })).json())
      .toEqual({ basic: { available: true, sceneSchemaVersions: [1] }, advanced: null })
  })
})

describe("generic SDK node-slug routes", () => {
  it("starts the same guarded generation through the node slug", async () => {
    const res = await post("/v1/generate-3d-scene", { prompt: "A dolly around a chair", userId: USER_ID })
    expect(res.statusCode).toBe(200)
    expect(mocks.creditIds).toHaveLength(1)
    expect(mocks.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(enqueued()).toMatchObject({ kind: "generate", prompt: "A dolly around a chair" })
  })
  it("retains free deterministic edits and revision conflicts through the node slug", async () => {
    const payload = { scenePlan: PLAN, expectedRevisionId: REV, userId: USER_ID,
      operations: [{ op: "set-background", color: "#112233" }] }
    const res = await post("/v1/edit-3d-scene", payload)
    expect(res.statusCode).toBe(200)
    expect(mocks.creditIds).toEqual(["3d-scene-ops"])
    const conflict = await post("/v1/edit-3d-scene", { ...payload, expectedRevisionId: USER_ID })
    expect(conflict.statusCode).toBe(409)
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1)
  })
  it("does not bypass authentication or schema admission", async () => {
    expect((await post("/v1/generate-3d-scene", { prompt: "A chair" })).statusCode).toBe(401)
    expect((await post("/v1/edit-3d-scene", { userId: USER_ID })).statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })
})

describe("POST /v1/3d-scene/generate", () => {
  it("creates the row, reserves, and enqueues a payload the worker can run", async () => {
    const res = await generate({ durationSeconds: 3, fps: 30, aspectRatio: "1:1" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })

    const [, payload, opts] = mocks.queueAdd.mock.calls[0]
    expect(mocks.queueAdd.mock.calls[0][0]).toBe("generate-3d-scene")
    expect(payload).toMatchObject({
      kind: "generate",
      jobId: "job-1",
      prompt: "A lone figure in an empty warehouse",
      fps: 30,
      durationInFrames: 90,
      width: 1080,
      height: 1080,
      usageLogId: "usage-1",
    })
    expect(payload.revisionId).toMatch(/^[0-9a-f-]{36}$/)
    // The LLM call is the paid step; a BullMQ re-run would bill it twice.
    expect(opts).toMatchObject({ attempts: 1 })
  })

  it("stores the frame and the references on the row, not just on the payload", async () => {
    await generate({ references: [{ id: "r1", url: IMAGE, kind: "image", role: "appearance" }] })
    const row = mocks.insertJob.mock.calls[0][1] as { input_data: Record<string, unknown> }
    expect(row.input_data).toMatchObject({ fps: 24, durationInFrames: 96, width: 1920, height: 1080 })
    expect(row.input_data.references).toEqual([{ id: "r1", url: IMAGE, kind: "image", role: "appearance" }])
  })

  it("reserves the LLM tier the model implies", async () => {
    await generate({ llmModel: "claude-opus-4.7" })
    expect(mocks.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "3d-scene:premium")
  })

  it("refuses an unknown model before any row", async () => {
    const res = await generate({ llmModel: "gpt-9-imaginary" })
    expect(res.statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("refuses a proxying install with 503 and no row", async () => {
    mocks.shouldProxyLlmToCloud.mockResolvedValue(true)
    const res = await generate()
    expect(res.statusCode).toBe(503)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("refuses an unauthenticated caller", async () => {
    const res = await post("/v1/3d-scene/generate", { prompt: "x" })
    expect(res.statusCode).toBe(401)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("rejects a non-http reference URL", async () => {
    const res = await generate({ references: [{ id: "r1", url: "file:///etc/passwd", kind: "image", role: "layout" }] })
    expect(res.statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("rejects a reference id the CONTRACT would reject, before any provider call", async () => {
    // The server stamps these onto the plan, so a body schema looser than the
    // contract buys a scene the contract refuses — and the model cannot fix a
    // field it never wrote, so the revision loop would burn every attempt on
    // the provider before failing.
    const res = await generate({ references: [{ id: "ref 1", url: IMAGE, kind: "image", role: "appearance" }] })
    expect(res.statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("rejects duplicate reference ids", async () => {
    const res = await generate({
      references: [
        { id: "r1", url: IMAGE, kind: "image", role: "appearance" },
        { id: "r1", url: `${IMAGE}?2`, kind: "image", role: "layout" },
      ],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("duplicate reference id")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("ACCEPTS objectId on a generate — the brief names the object it wants built", async () => {
    // The route used to refuse this because "a new scene has no objects yet".
    // But the reference IS the instruction: the authoring prompt requires an
    // object with that id in the answer, and `scene3DPlanSchema` refuses the
    // finished scene if the model did not make one — so the rule is enforced
    // once, on the plan, where it can actually be checked.
    const res = await generate({
      references: [{ id: "r1", url: IMAGE, kind: "image", role: "appearance", objectId: "hero" }],
    })
    expect(res.statusCode).toBe(200)
    expect((enqueued().references as { objectId?: string }[])[0].objectId).toBe("hero")
  })

  it("rejects a video reference asking for a time window, before any row", async () => {
    // Accepted-and-ignored is the failure mode this replaces: the field was
    // stored on the plan and the whole clip was analysed anyway.
    const res = await generate({
      references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion", startSeconds: 2, endSeconds: 5 }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("trim the video first")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("accepts a full-clip video reference (no window, or startSeconds 0)", async () => {
    const res = await generate({
      references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion", startSeconds: 0 }],
    })
    expect(res.statusCode).toBe(200)
  })

  it("refuses a duration under the contract floor", async () => {
    const res = await generate({ durationSeconds: 0.5 })
    expect(res.statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("rejects a time window on an image reference", async () => {
    const res = await generate({
      references: [{ id: "r1", url: IMAGE, kind: "image", role: "appearance", startSeconds: 1, endSeconds: 2 }],
    })
    expect(res.statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("rejects an unknown reference field rather than dropping it", async () => {
    const res = await generate({
      references: [{ id: "r1", url: IMAGE, kind: "image", role: "appearance", weight: 3 }],
    })
    expect(res.statusCode).toBe(400)
  })

  it("caps video references at one", async () => {
    const res = await generate({
      references: [
        { id: "r1", url: VIDEO, kind: "video", role: "motion" },
        { id: "r2", url: `${VIDEO}?2`, kind: "video", role: "motion" },
      ],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("At most 1 video reference")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("creates the analysis child through the analysis route, as the caller, AFTER reserving", async () => {
    const res = await generate({ references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion" }] })
    expect(res.statusCode).toBe(200)
    expect(analysisSeen?.body).toMatchObject({ videoUrl: VIDEO, userId: USER_ID })
    expect(analysisSeen?.headers.authorization).toBe("Bearer caller-token")
    expect(analysisSeen?.headers["x-nodaro-workspace"]).toBe("ws-1")
    // A bearer caller's own token is what authorises the child — its scopes
    // and any spend cap come with it, so we do NOT re-assert the server secret.
    expect(analysisSeen?.headers["x-internal-orchestrator-secret"]).toBeUndefined()
    expect(mocks.reserveCreditsForJob).toHaveBeenCalled()
    expect(enqueued()).toMatchObject({ analysisJobId: "analysis-1", analyzedReferenceId: "r1" })
  })

  it("authenticates the child on the MCP / orchestrator path, which has NO bearer token", async () => {
    // MCP tools and the workflow orchestrator authenticate with the internal
    // secret and name the user in the body (lib/mcp/internal-request.ts). The
    // child used to inherit "no headers at all" there and 401 — after the
    // parent row and its reservation already existed.
    const res = await app.inject({
      method: "POST",
      url: "/v1/3d-scene/generate",
      headers: {
        "x-internal-orchestrator-secret": "s".repeat(64),
        "x-nodaro-workspace": "ws-1",
        "x-app-run": "true",
      },
      payload: {
        prompt: "A lone figure in an empty warehouse",
        userId: USER_ID,
        references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion" }],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(analysisSeen?.headers["x-internal-orchestrator-secret"]).toBe("s".repeat(64))
    expect(analysisSeen?.headers["x-internal-user-id"]).toBe(USER_ID)
    // Attribution still travels: payer, surface flag and the named user.
    expect(analysisSeen?.headers["x-nodaro-workspace"]).toBe("ws-1")
    expect(analysisSeen?.headers["x-app-run"]).toBe("true")
    expect(analysisSeen?.body).toMatchObject({ videoUrl: VIDEO, userId: USER_ID })
  })

  it("forwards forcePrivate so a private parent does not spawn a public analysis", async () => {
    await generate({ forcePrivate: true, references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion" }] })
    expect(analysisSeen?.body).toMatchObject({ forcePrivate: true })
  })

  it("refunds, deletes and cancels the child when the ENQUEUE is rejected", async () => {
    // Nothing else would ever settle this row: no BullMQ entry exists, so no
    // worker fails it and no refund runs, and the reconcile sweep does not
    // cover a job that never reached a provider.
    mocks.queueAdd.mockRejectedValueOnce(new Error("redis is down"))
    const res = await generate({ references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion" }] })
    expect(res.statusCode).toBe(500)
    expect(mocks.cancelOwnedJob).toHaveBeenCalledWith("analysis-1", USER_ID)
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.jobDelete).toHaveBeenCalled()
  })

  it("refunds and deletes when STAMPING the child throws", async () => {
    mocks.jobUpdate.mockImplementationOnce(() => {
      throw new Error("supabase unreachable")
    })
    const res = await generate({ references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion" }] })
    expect(res.statusCode).toBe(500)
    expect(mocks.cancelOwnedJob).toHaveBeenCalledWith("analysis-1", USER_ID)
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("propagates the analysis route's refusal verbatim and undoes the parent", async () => {
    analysisAnswer = { status: 402, body: { error: { code: "insufficient_credits", message: "Not enough credits" } } }
    const res = await generate({ references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion" }] })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("insufficient_credits")
    // Refund THEN delete — no `reserved` hold orphaned behind a deleted row.
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.jobDelete).toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("does not create an analysis child for an image-only request", async () => {
    await generate({ references: [{ id: "r1", url: IMAGE, kind: "image", role: "appearance" }] })
    expect(analysisSeen).toBeNull()
    expect(enqueued().analysisJobId).toBeUndefined()
  })
})

describe("POST /v1/3d-scene/edit — the credit identifier", () => {
  it("bills the zero-cost identifier for the deterministic lane", () => {
    expect(scene3DEditCreditId({ operations: [] })).toBe("3d-scene-ops")
  })
  it("bills the LLM tier for the instruction lane", () => {
    expect(scene3DEditCreditId({ prompt: "move it left" })).toBe("3d-scene")
    expect(scene3DEditCreditId({ prompt: "x", llmModel: "claude-opus-4.7" })).toBe("3d-scene:premium")
  })
})

describe("POST /v1/3d-scene/edit — refusals before a row", () => {
  it("409s a stale revision", async () => {
    const res = await edit({ prompt: "move the hero left", expectedRevisionId: "99999999-2222-4333-8444-555555555555" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("stale_revision")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("400s a scenePlan that is not a valid plan", async () => {
    const res = await edit({ prompt: "x", scenePlan: { ...PLAN, objects: [] } })
    expect(res.statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("400s when neither prompt nor operations is given", async () => {
    const res = await edit({})
    expect(res.statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("400s when BOTH prompt and operations are given", async () => {
    const res = await edit({ prompt: "x", operations: [{ op: "set-background", color: "#000000" }] })
    expect(res.statusCode).toBe(400)
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("403s a deterministic edit that touches a locked object — in the route, not in the worker", async () => {
    const res = await edit({
      operations: [{ op: "set-object", objectId: "hero", changes: { color: "#ff0000" } }],
      lockedObjectIds: ["hero"],
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("locked_object")
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("400s a deterministic edit that would orphan a child, naming the operation", async () => {
    const parented: Scene3DPlan = {
      ...PLAN,
      objects: [PLAN.objects[0], { ...PLAN.objects[1], parentId: "ground" }],
    }
    const res = await edit({ scenePlan: parented, operations: [{ op: "remove-object", objectId: "ground" }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_plan")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("400s an operation naming an object that is not there, with its index", async () => {
    const res = await edit({
      operations: [
        { op: "set-background", color: "#000000" },
        { op: "remove-object", objectId: "ghost" },
      ],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: "unknown_object", operationIndex: 1 })
  })

  it("does NOT require an LLM key for the deterministic lane", async () => {
    mocks.shouldProxyLlmToCloud.mockResolvedValue(true)
    const res = await edit({ operations: [{ op: "set-background", color: "#000000" }] })
    expect(res.statusCode).toBe(200)
  })
})

describe("POST /v1/3d-scene/edit — what reaches the worker", () => {
  it("carries the plan, the locks, the selection and ONE minted revision id", async () => {
    const res = await edit({
      prompt: "put the hero on the left",
      lockedObjectIds: ["ground"],
      selectedObjectIds: ["hero"],
    })
    expect(res.statusCode).toBe(200)
    expect(mocks.queueAdd.mock.calls[0][0]).toBe("edit-3d-scene")
    const payload = enqueued()
    expect(payload).toMatchObject({
      kind: "edit",
      jobId: "job-1",
      expectedRevisionId: REV,
      instruction: "put the hero on the left",
      lockedObjectIds: ["ground"],
      selectedObjectIds: ["hero"],
    })
    expect((payload.plan as Scene3DPlan).revisionId).toBe(REV)
    // The revision the edit will produce is minted once, in the route, so the
    // rehearsal and the worker's apply cannot disagree.
    expect(payload.revisionId).not.toBe(REV)
    const row = mocks.insertJob.mock.calls[0][1] as { input_data: Record<string, unknown> }
    expect(row.input_data).toMatchObject({ sourceRevisionId: REV, revisionId: payload.revisionId, mode: "prompt" })
  })

  it("carries the operations and reserves nothing but the zero-cost lane", async () => {
    const operations = [{ op: "set-object", objectId: "hero", changes: { position: [1, 0.85, 0] } }]
    const res = await edit({ operations })
    expect(res.statusCode).toBe(200)
    expect(mocks.creditIds).toEqual(["3d-scene-ops"])
    expect(mocks.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "3d-scene-ops")
    expect(enqueued()).toMatchObject({ kind: "edit", operations, revisionId: expect.any(String) })
    const row = mocks.insertJob.mock.calls[0][1] as { input_data: Record<string, unknown> }
    expect(row.input_data).toMatchObject({ mode: "operations" })
  })

  it("never creates an analysis child on the deterministic lane", async () => {
    await edit({
      operations: [{ op: "set-background", color: "#000000" }],
      references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion" }],
    })
    expect(analysisSeen).toBeNull()
  })

  it("accepts an objectId on an edit — the scene has objects to scope to", async () => {
    const res = await edit({
      prompt: "make the hero look like this",
      references: [{ id: "r1", url: IMAGE, kind: "image", role: "appearance", objectId: "hero" }],
    })
    expect(res.statusCode).toBe(200)
    expect((enqueued().references as unknown[])[0]).toMatchObject({ objectId: "hero" })
  })

  it("creates one on the instruction lane", async () => {
    await edit({ prompt: "match this camera move", references: [{ id: "r1", url: VIDEO, kind: "video", role: "motion" }] })
    expect(analysisSeen?.body).toMatchObject({ videoUrl: VIDEO, userId: USER_ID })
    expect(enqueued()).toMatchObject({ analysisJobId: "analysis-1", analyzedReferenceId: "r1" })
  })

  it("persists the SOURCE scene on the row, not just its revision id", async () => {
    // The plan rides the BullMQ payload — until BullMQ prunes it. The row is
    // the durable half: without the scene, a re-run has nothing to re-apply
    // the instruction to and the row cannot say what was edited.
    await edit({ prompt: "x" })
    const row = mocks.insertJob.mock.calls[0][1] as { input_data: Record<string, unknown> }
    expect(row.input_data.scenePlan).toEqual(PLAN)
    expect(row.input_data.sourceRevisionId).toBe(REV)
  })

  it("refuses an edit whose MERGED reference list breaks the contract", async () => {
    // Legal on its own, illegal once merged with the plan's own video: the
    // merged set is what the produced revision carries, so that is the list
    // that has to be checked — before the charge, not after.
    const withVideo: Scene3DPlan = {
      ...PLAN,
      references: [{ id: "existing", url: VIDEO, kind: "video", role: "motion" }],
    }
    const res = await edit({
      scenePlan: withVideo,
      prompt: "match this too",
      references: [{ id: "second", url: `${VIDEO}?2`, kind: "video", role: "motion" }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("At most 1 video reference")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("replaces an inherited video before validating and queues that intent durably", async () => {
    const res = await edit({
      scenePlan: { ...PLAN, references: [{ id: "old", url: VIDEO, kind: "video", role: "motion" }] },
      prompt: "match this camera move", replaceReferences: true,
      references: [{ id: "new", url: `${VIDEO}?new`, kind: "video", role: "motion" }],
    })
    expect(res.statusCode).toBe(200)
    expect(enqueued()).toMatchObject({ replaceReferences: true, references: [{ id: "new" }] })
    expect(mocks.insertJob.mock.calls[0][1].input_data.replaceReferences).toBe(true)
  })

  it("clears obsolete bindings before the deterministic edit dry run", async () => {
    const res = await edit({
      scenePlan: { ...PLAN, references: [{ id: "old", url: IMAGE, kind: "image", role: "appearance", objectId: "hero" }] },
      operations: [{ op: "remove-object", objectId: "hero" }], references: [], replaceReferences: true,
    })
    expect(res.statusCode).toBe(200)
    expect(enqueued()).toMatchObject({ replaceReferences: true, references: [] })
  })

  it("400s a deterministic edit whose reference points at an object it removes", async () => {
    const withRef: Scene3DPlan = {
      ...PLAN,
      references: [{ id: "r1", url: IMAGE, kind: "image", role: "appearance", objectId: "hero" }],
    }
    const res = await edit({ scenePlan: withRef, operations: [{ op: "remove-object", objectId: "hero" }] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("invalid_plan")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("ACCEPTS a deterministic edit whose new reference is bound to an object the SAME list adds", async () => {
    // References are stripped before the operations run and stamped back
    // afterwards, so a reference and the object it names may arrive together.
    const res = await edit({
      operations: [
        {
          op: "add-object",
          object: {
            id: "car", name: "Car", primitive: "box", dimensions: [4.5, 1.4, 1.8],
            position: [3, 0.7, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#224466",
          },
        },
      ],
      references: [{ id: "r1", url: IMAGE, kind: "image", role: "appearance", objectId: "car" }],
    })
    expect(res.statusCode).toBe(200)
  })
})
