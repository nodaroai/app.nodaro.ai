import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `deferSettlement` on /v1/generate-video (lib/deferred-child-settlement.ts):
 * honoured ONLY for the plugin toolkit's own child request whose parent is a
 * job of the caller's own that a loaded private plugin handles. The job then
 * records the server-only `input_data.__deferSettlement` and the answer says
 * `settlementDeferred: true`. Anyone else — a public caller, an internal hop
 * that is not the toolkit's, a parent of another user or of a type no plugin
 * handles — has the field ignored: the job is byte-identical to one without it.
 */

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => true,
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))

vi.mock("@/ee/billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getModelCreditBaseCost: vi.fn().mockResolvedValue({ creditCost: 4 }),
}))

// The reference clip's probe (route prechecks).
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  probeMediaDuration: vi.fn(async () => 8),
}))

vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { generateVideoRoutes } from "../generate-video.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"
import { notePluginJobTypes } from "../../lib/concurrency-lanes/registry.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PARENT = "00000000-0000-4000-8000-0000000000b2"
const VIDEO = "https://cdn.nodaro.ai/videos/clip.mp4"
const IMAGE = "https://cdn.nodaro.ai/images/face.jpg"
const BODY = {
  prompt: "edit {video:1} as follows:\nUse {image:1:person} as the singer.",
  provider: "seedance-2-5",
  aspectRatio: "adaptive",
  duration: -1,
  resolution: "720p",
  referenceVideoUrls: [VIDEO],
  referenceImageUrls: [IMAGE],
  forcePrivate: true,
  userId: USER,
}

notePluginJobTypes(["cast-swap"])

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
    if (req.headers["x-test-auth-kind"] === "internal") req.authKind = "internal"
    // Test-only stand-in for the credit guard's idempotency-key pickup.
    const key = req.headers["x-test-idempotency-key"]
    if (typeof key === "string") req.idempotencyKey = key
  })
  await app.register(async (instance) => {
    await generateVideoRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

/** The jobs table: the insert, and the parent read (`.eq("id").eq("user_id").maybeSingle()`). */
function mockJobs(parentRow: Record<string, unknown> | null) {
  const mockInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-child" }, error: null }) }),
  })
  const parentRead = vi.fn()
  const select = vi.fn(() => {
    const filters: Array<[string, unknown]> = []
    const chain = {
      eq: (col: string, val: unknown) => { filters.push([col, val]); return chain },
      maybeSingle: async () => {
        parentRead(filters)
        const hit = parentRow && filters.every(([c, v]) => parentRow[c] === v)
        return { data: hit ? parentRow : null, error: null }
      },
    }
    return chain
  })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert, select } as never)
  return { mockInsert, parentRead }
}

const OWN_PLUGIN_PARENT = { id: PARENT, user_id: USER, job_type: "cast-swap", input_data: { type: "cast-swap" } }

async function run(payload: Record<string, unknown>, opts: { internal?: boolean; parent?: boolean; parentRow?: Record<string, unknown> | null } = {}) {
  const { mockInsert } = mockJobs(opts.parentRow === undefined ? OWN_PLUGIN_PARENT : opts.parentRow)
  const inject = () => app.inject({
    method: "POST",
    url: "/v1/generate-video",
    payload,
    ...(opts.internal ? { headers: { "x-test-auth-kind": "internal" } } : {}),
  })
  const res = opts.parent
    ? await withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/generate-video", parentJobId: PARENT, trustedPluginCaller: true }, inject)
    : await inject()
  expect(res.statusCode, res.body).toBe(200)
  const row = mockInsert.mock.calls[0]![0] as Record<string, unknown>
  const [, queued] = vi.mocked(videoQueue.add).mock.calls[0]! as [string, Record<string, unknown>]
  return { body: res.json() as Record<string, unknown>, inputData: row.input_data as Record<string, unknown>, queued }
}

describe("POST /v1/generate-video — deferSettlement", () => {
  it("a trusted plugin child of the caller's own plugin job: recorded server-only, and answered", async () => {
    const { body, inputData, queued } = await run({ ...BODY, deferSettlement: true }, { internal: true, parent: true })
    expect(inputData.__deferSettlement).toBe(true)
    expect(inputData).not.toHaveProperty("deferSettlement")
    expect(queued).not.toHaveProperty("deferSettlement")
    expect(queued).not.toHaveProperty("__deferSettlement")
    expect(body.settlementDeferred).toBe(true)
  })

  it.each([
    ["a public caller", {}, undefined],
    ["an internal hop with no parent", { internal: true }, undefined],
    ["a parent scope without internal auth", { parent: true }, undefined],
    ["a parent of another user", { internal: true, parent: true }, { ...OWN_PLUGIN_PARENT, user_id: "00000000-0000-4000-8000-000000000009" }],
    ["a parent of a type no plugin handles", { internal: true, parent: true }, { ...OWN_PLUGIN_PARENT, job_type: "image-to-video", input_data: {} }],
    ["a parent that cannot be read", { internal: true, parent: true }, null],
  ] as const)("ignored for %s: byte-identical to the request without the field", async (_label, opts, parentRow) => {
    const asked = await run({ ...BODY, deferSettlement: true }, { ...opts, parentRow })
    vi.clearAllMocks()
    const plain = await run(BODY, { ...opts, parentRow })
    expect(asked.inputData).not.toHaveProperty("__deferSettlement")
    expect(asked.body).not.toHaveProperty("settlementDeferred")
    expect(JSON.stringify(asked.inputData)).toBe(JSON.stringify(plain.inputData))
    expect(JSON.stringify(asked.queued)).toBe(JSON.stringify(plain.queued))
  })

  it("a public caller cannot plant the server-only key itself", async () => {
    const { inputData } = await run({ ...BODY, __deferSettlement: true })
    expect(inputData).not.toHaveProperty("__deferSettlement")
  })

  it("false is the same as absent", async () => {
    const { inputData, body } = await run({ ...BODY, deferSettlement: false }, { internal: true, parent: true })
    expect(inputData).not.toHaveProperty("__deferSettlement")
    expect(body).not.toHaveProperty("settlementDeferred")
  })

  it("a non-boolean is refused", async () => {
    mockJobs(OWN_PLUGIN_PARENT)
    const res = await app.inject({ method: "POST", url: "/v1/generate-video", payload: { ...BODY, deferSettlement: "yes" } })
    expect(res.statusCode).toBe(400)
  })
})

/** A request's idempotency key in a test, not a credential. */
const REPLAY_KEY = "same-click-key-for-replay" // gitleaks:allow

describe("POST /v1/generate-video — a replay of the same idempotency key answers the STORED job", () => {
  async function replay(stored: Record<string, unknown>, payload: Record<string, unknown>) {
    const existing = vi.fn().mockResolvedValue({ data: { id: "job-stored", input_data: stored }, error: null })
    const chain = { eq: () => chain, single: existing, maybeSingle: async () => ({ data: OWN_PLUGIN_PARENT, error: null }) }
    vi.mocked(supabase.from).mockReturnValue({
      upsert: () => ({ select: async () => ({ data: [], error: null }) }),
      select: () => chain,
    } as never)
    const headers = { "x-test-auth-kind": "internal", "x-test-idempotency-key": REPLAY_KEY }
    const inject = () => app.inject({ method: "POST", url: "/v1/generate-video", payload, headers })
    const res = await withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/generate-video", parentJobId: PARENT, trustedPluginCaller: true }, inject)
    return res.json() as Record<string, unknown>
  }

  it("a stored deferred child: settlementDeferred, even if this replay did not ask", async () => {
    const body = await replay({ __deferSettlement: true }, BODY)
    expect(body).toMatchObject({ jobId: "job-stored", deduped: true, settlementDeferred: true })
  })

  it("a stored child that was not deferred: no settlementDeferred, even if this replay asks", async () => {
    const body = await replay({}, { ...BODY, deferSettlement: true })
    expect(body).toMatchObject({ jobId: "job-stored", deduped: true })
    expect(body).not.toHaveProperty("settlementDeferred")
  })
})
