import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The two fields a server-side CHILD job sends `/v1/generate-video` (Nodaro
 * Motion's engine children moved here from `/v1/text-to-video`):
 *
 * - `outputFormat: "mov"` — Seedance 2.5's mov container, honoured ONLY for a
 *   child job (internal auth plus a server-only parent job id) on seedance-2-5,
 *   exactly as on t2v (`seedance25OutputFormatFor`). Anything else is treated
 *   as mp4 and the field dropped.
 * - `contentPolicyRewrite` — accepted as a no-op: this route never rewords.
 *
 * Neither is a public field: both are absent from the OpenAPI document.
 */

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
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
import { generateOpenApiDoc } from "../../lib/openapi-registry.js"

const USER = "00000000-0000-4000-8000-000000000001"
const PARENT = "00000000-0000-4000-8000-0000000000b2"
const VIDEO = "https://cdn.nodaro.ai/videos/clip.mp4"
const IMAGE = "https://cdn.nodaro.ai/images/face.jpg"
/** A Seedance 2.5 edit child, the way Nodaro Motion sends it (no start frame). */
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

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
    // Test-only stand-in for the auth middleware's internal-auth verdict.
    if (req.headers["x-test-auth-kind"] === "internal") req.authKind = "internal"
  })
  await app.register(async (instance) => {
    await generateVideoRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function mockJobInsert() {
  const mockInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "job-child" }, error: null }) }),
  })
  vi.mocked(supabase.from).mockReturnValue({ insert: mockInsert } as never)
  return mockInsert
}

async function run(payload: Record<string, unknown>, opts: { internal?: boolean; parent?: boolean } = {}) {
  const mockInsert = mockJobInsert()
  const inject = () => app.inject({
    method: "POST",
    url: "/v1/generate-video",
    payload,
    ...(opts.internal ? { headers: { "x-test-auth-kind": "internal" } } : {}),
  })
  const res = opts.parent
    ? await withJobSubmissionContext({ userId: USER, method: "POST", url: "/v1/generate-video", parentJobId: PARENT }, inject)
    : await inject()
  expect(res.statusCode, res.body).toBe(200)
  const row = mockInsert.mock.calls[0]![0] as Record<string, unknown>
  const [jobName, queued] = vi.mocked(videoQueue.add).mock.calls[0]! as [string, Record<string, unknown>]
  return { row, inputData: row.input_data as Record<string, unknown>, jobName, queued }
}

describe("POST /v1/generate-video — outputFormat (child jobs only)", () => {
  it("a seedance-2-5 child asking for mov: queued and recorded as mov", async () => {
    const { inputData, queued, jobName } = await run({ ...BODY, outputFormat: "mov" }, { internal: true, parent: true })
    expect(jobName).toBe("image-to-video")
    expect(queued.outputFormat).toBe("mov")
    expect(inputData.outputFormat).toBe("mov")
  })

  it("absent: the queued payload and input_data carry no outputFormat key", async () => {
    const { inputData, queued } = await run(BODY, { internal: true, parent: true })
    expect(queued).not.toHaveProperty("outputFormat")
    expect(inputData).not.toHaveProperty("outputFormat")
  })

  it.each([
    ["a public caller", { ...BODY, outputFormat: "mov" }, {}],
    ["a non-child internal caller (no parent)", { ...BODY, outputFormat: "mov" }, { internal: true }],
    ["a parent scope without internal auth", { ...BODY, outputFormat: "mov" }, { parent: true }],
    ["another provider's child", { ...BODY, provider: "kling-4", duration: 8, aspectRatio: "auto", outputFormat: "mov" }, { internal: true, parent: true }],
    ["an explicit mp4", { ...BODY, outputFormat: "mp4" }, { internal: true, parent: true }],
  ] as const)("ignored for %s: byte-identical to the request without the field", async (_label, payload, opts) => {
    const asked = await run(payload, opts)
    vi.clearAllMocks()
    const { outputFormat: _dropped, ...without } = payload as Record<string, unknown>
    const plain = await run(without, opts)
    expect(asked.queued).not.toHaveProperty("outputFormat")
    expect(asked.inputData).not.toHaveProperty("outputFormat")
    expect(JSON.stringify(asked.queued)).toBe(JSON.stringify(plain.queued))
    expect(JSON.stringify(asked.inputData)).toBe(JSON.stringify(plain.inputData))
  })
})

describe("POST /v1/generate-video — contentPolicyRewrite (accepted, a no-op)", () => {
  it.each([false, true])("contentPolicyRewrite: %s is accepted and changes nothing", async (value) => {
    const asked = await run({ ...BODY, contentPolicyRewrite: value }, { internal: true, parent: true })
    vi.clearAllMocks()
    const plain = await run(BODY, { internal: true, parent: true })
    expect(asked.queued).not.toHaveProperty("contentPolicyRewrite")
    expect(asked.inputData).not.toHaveProperty("contentPolicyRewrite")
    expect(JSON.stringify(asked.queued)).toBe(JSON.stringify(plain.queued))
    expect(JSON.stringify(asked.inputData)).toBe(JSON.stringify(plain.inputData))
  })

  it("a non-boolean is still refused", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/generate-video", payload: { ...BODY, contentPolicyRewrite: "no" } })
    expect(res.statusCode).toBe(400)
  })
})

describe("POST /v1/generate-video — a reference-video child with no start frame", () => {
  it.each([
    ["seedance-2-5", { provider: "seedance-2-5", aspectRatio: "adaptive", duration: -1 }],
    ["kling-4", { provider: "kling-4", aspectRatio: "auto", duration: 8 }],
  ] as const)("%s passes the image gate on its reference video alone", async (_label, shape) => {
    const { referenceImageUrls: _none, ...videoOnly } = BODY
    const { queued, row } = await run({ ...videoOnly, ...shape }, { internal: true, parent: true })
    expect(queued.imageUrl).toBeUndefined()
    expect(queued.referenceVideoUrls).toEqual([VIDEO])
    expect(row.job_type).toBe("image-to-video")
  })
})

describe("POST /v1/generate-video — a child job", () => {
  it("is private and tied to its parent", async () => {
    const { row } = await run(BODY, { internal: true, parent: true })
    expect(row.force_private).toBe(true)
    expect(row.parent_job_id).toBe(PARENT)
  })
})

describe("the OpenAPI document", () => {
  it("does not list the child-only fields on /v1/generate-video", () => {
    const doc = generateOpenApiDoc() as unknown as {
      paths: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> } } }>
    }
    const props = doc.paths["/v1/generate-video"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties ?? {}
    // The public body is still documented…
    expect(props).toHaveProperty("prompt")
    expect(props).toHaveProperty("referenceVideoUrls")
    // …without the server-only fields.
    expect(props).not.toHaveProperty("outputFormat")
    expect(props).not.toHaveProperty("contentPolicyRewrite")
  })
})
