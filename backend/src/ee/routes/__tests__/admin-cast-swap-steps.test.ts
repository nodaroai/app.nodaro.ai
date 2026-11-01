import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const USER_UUID = "00000000-0000-4000-8000-000000000001"
const JOB_ID = "00000000-0000-4000-8000-0000000000c1"

const mockFrom = vi.fn()

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (code: number) => { send: (body: unknown) => void } },
  ) => {
    if (req.userId !== ADMIN_UUID) {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))

import { adminCastSwapStepsRoutes } from "../admin-cast-swap-steps.js"

/** A `from("jobs").select().eq().maybeSingle()` chain answering `result`; its spies exposed. */
function jobChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminCastSwapStepsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const get = (jobId = JOB_ID, userId = ADMIN_UUID) =>
  app.inject({ method: "GET", url: `/v1/admin/jobs/${jobId}/cast-swap-steps`, headers: { "x-user-id": userId } })

const STEP_OUTPUTS = {
  v: 1,
  roles: [
    {
      role: 0,
      kind: "person",
      labels: [
        { index: 0, subject: "person", framing: "head", angle: "front", quality: "ok" },
        { index: 1, subject: "person", framing: "body", angle: "side", quality: "low" },
      ],
      condition: "head-body",
      layout: "collage",
      sheetUrl: "https://cdn.test/sheets/a.png",
      kept: true,
    },
  ],
  enginePrompt: { mode: "llm", text: "test prompt body" },
  scene: { mode: "template" },
}

function castSwapRow(output: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    job_type: "cast-swap",
    input_data: { type: "cast-swap" },
    output_data: output,
    ...over,
  }
}

describe("GET /v1/admin/jobs/:jobId/cast-swap-steps", () => {
  it("the endpoint returns the server-only record to an admin, 403 otherwise", async () => {
    const chain = jobChain({
      data: castSwapRow({
        videoUrl: "https://cdn.test/v.mp4",
        __castSwapStepOutputs: STEP_OUTPUTS,
        __castSwapSceneText: "test scene text",
        skippedSteps: [{ step: "reference-sheet", reason: "failed", role: 1 }],
      }),
      error: null,
    })
    mockFrom.mockReturnValue(chain)

    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      data: {
        stepOutputs: STEP_OUTPUTS,
        sceneText: "test scene text",
        skippedSteps: [{ step: "reference-sheet", reason: "failed", role: 1 }],
      },
    })
    // Read raw from the jobs table (the server-only keys are stripped on every normal read).
    expect(mockFrom).toHaveBeenCalledWith("jobs")
    expect(chain.eq).toHaveBeenCalledWith("id", JOB_ID)

    mockFrom.mockClear()
    const denied = await get(JOB_ID, USER_UUID)
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error.code).toBe("forbidden")
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("a Full Quality version (its own job_type) is a Cast Swap job too", async () => {
    mockFrom.mockReturnValue(
      jobChain({
        data: castSwapRow({}, { job_type: "cast-swap-full-quality", input_data: { type: "cast-swap", fullQualityOf: USER_UUID } }),
        error: null,
      }),
    )
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { stepOutputs: null, sceneText: null, skippedSteps: [] } })
  })

  it("404s for a job that is not a Cast Swap job, or none at all", async () => {
    mockFrom.mockReturnValue(
      jobChain({ data: { id: JOB_ID, job_type: "video", input_data: { type: "generate-video" }, output_data: {} }, error: null }),
    )
    const other = await get()
    expect(other.statusCode).toBe(404)
    expect(other.json().error.code).toBe("not_found")

    mockFrom.mockReturnValue(jobChain({ data: null, error: null }))
    const missing = await get()
    expect(missing.statusCode).toBe(404)
  })

  it("400s for a job id that is not a uuid, before any read", async () => {
    const res = await get("not-a-uuid")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("500s when the read fails", async () => {
    mockFrom.mockReturnValue(jobChain({ data: null, error: { message: "boom" } }))
    const res = await get()
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("malformed data is read tolerantly", async () => {
    mockFrom.mockReturnValue(
      jobChain({
        data: castSwapRow({
          __castSwapStepOutputs: {
            v: 1,
            roles: [
              "not a role",
              { role: -1, kind: "person" },
              { role: 0, kind: "dragon" },
              {
                role: 2,
                kind: "pet",
                labels: [
                  { index: 0, subject: "animal", framing: "head", angle: "front", quality: "ok", extra: "dropped" },
                  { index: 1, subject: "animal", framing: "tail", angle: "front", quality: "ok" },
                  "bad",
                ],
                condition: "sideways",
                layout: "turnaround", // a product's layout, not a pet's
                sheetUrl: 42,
                kept: "yes",
              },
            ],
            enginePrompt: { mode: "llm", text: 7 },
            scene: { mode: "other" },
          },
          __castSwapSceneText: { text: "not a string" },
          skippedSteps: [
            { step: "photo-labels", reason: "timed_out", role: 0 },
            { step: "head-crop", reason: "no_face", role: -1 },
            { step: "engine-prompt", reason: "too_long", role: 1.5 },
            { step: "made-up", reason: "failed" },
            { step: "reference-sheet", reason: "free text" },
            null,
          ],
        }),
        error: null,
      }),
    )
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({
      stepOutputs: {
        v: 1,
        roles: [{ role: 2, kind: "pet", labels: [{ index: 0, subject: "animal", framing: "head", angle: "front", quality: "ok" }] }],
        enginePrompt: { mode: "llm" },
      },
      sceneText: null,
      skippedSteps: [
        { step: "photo-labels", reason: "timed_out", role: 0 },
        { step: "head-crop", reason: "no_face" },
        { step: "engine-prompt", reason: "too_long" },
      ],
    })
  })

  it("reads the scene step's shot list and its cut times, dropping cuts that are not a list of seconds", async () => {
    const read = async (scene: unknown) => {
      mockFrom.mockReturnValue(jobChain({ data: castSwapRow({ __castSwapStepOutputs: { v: 1, roles: [], scene } }), error: null }))
      return (await get()).json().data.stepOutputs.scene
    }
    expect(await read({ mode: "llm", shotList: true, cuts: [1.2, 2.5, 4] })).toEqual({ mode: "llm", shotList: true, cuts: [1.2, 2.5, 4] })
    expect(await read({ mode: "llm", shotList: true, cuts: [] })).toEqual({ mode: "llm", shotList: true, cuts: [] })
    expect(await read({ mode: "llm", shotList: "yes", cuts: [1, -2] })).toEqual({ mode: "llm" })
    expect(await read({ mode: "llm", cuts: [1, "2"] })).toEqual({ mode: "llm" })
    expect(await read({ mode: "template", cuts: "1,2" })).toEqual({ mode: "template" })
  })

  it("reads a role's Body from the clip record and its skip (no usable frame)", async () => {
    const clipBody = { frameUrl: "https://cdn.test/frame.jpg", frameSec: 1.5, sheetUrl: "https://cdn.test/redrawn.png", prompt: "test image prompt" }
    mockFrom.mockReturnValue(
      jobChain({
        data: castSwapRow({
          __castSwapStepOutputs: {
            v: 1,
            roles: [
              { role: 0, kind: "person", clipBody },
              { role: 1, kind: "person", clipBody: { frameUrl: 3, frameSec: -1, sheetUrl: " ", prompt: 9, extra: "dropped" } },
              { role: 2, kind: "person", clipBody: "nope" },
            ],
          },
          skippedSteps: [
            { step: "clip-body", reason: "no_frame", role: 1 },
            { step: "clip-body", reason: "failed", role: 2 },
          ],
        }),
        error: null,
      }),
    )
    const res = await get()
    expect(res.json().data).toEqual({
      stepOutputs: { v: 1, roles: [{ role: 0, kind: "person", clipBody }, { role: 1, kind: "person" }, { role: 2, kind: "person" }] },
      sceneText: null,
      skippedSteps: [
        { step: "clip-body", reason: "no_frame", role: 1 },
        { step: "clip-body", reason: "failed", role: 2 },
      ],
    })
  })

  it("a record of another version, or without roles, is no record", async () => {
    for (const record of [{ v: 2, roles: [] }, { v: 1 }, { v: 1, roles: "x" }, "x", null]) {
      mockFrom.mockReturnValue(jobChain({ data: castSwapRow({ __castSwapStepOutputs: record, skippedSteps: "nope" }), error: null }))
      const res = await get()
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toEqual({ stepOutputs: null, sceneText: null, skippedSteps: [] })
    }
  })
})
