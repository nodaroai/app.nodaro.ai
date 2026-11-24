/**
 * `deferSettlement` on /v1/video-upscale (the "delivered" rule,
 * lib/deferred-child-request.ts): honoured only for providers "topaz" and
 * "topaz-rhea" AND only when `deferSettlementHonoured` says the request is a
 * trusted plugin child of the caller's own plugin job (tested for its own sake
 * beside /v1/generate-video). The job then records the server-only
 * `__deferSettlement` and `__deferSettlementRule: "delivered"`, and the answer
 * says `settlementDeferred: true`. Every other request has the field ignored:
 * the job and the queue are byte-identical to the request without it — the
 * standalone upscale is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/url-validator.js", async () => ({ safeUrlSchema: (await import("zod")).z.string().url() }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn(async () => false) }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: "job-1" }, error: null })) }))
vi.mock("@/lib/kie-task-ownership.js", () => ({ kieTaskOwnedByAnother: vi.fn(async () => false) }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (_resolve: unknown, opts?: { beforePricing?: (req: unknown, reply: unknown) => Promise<unknown> }) =>
    async (req: unknown, reply: { sent: boolean }) => { await opts?.beforePricing?.(req, reply) },
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "usage-1", creditsReserved: 1, watermark: false })),
}))
const STORED = "https://cdn.example/tmp/provider-input/copy.mp4"
vi.mock("@/lib/outside-input-copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/outside-input-copy.js")>()
  const run = async (opts: { inspect: (p: string, s: AbortSignal) => Promise<unknown> }) => { await opts.inspect("/tmp/outside-input/input", new AbortController().signal) }
  return {
    ...actual,
    copyOutsideInput: vi.fn(async (_url: string, opts: { inspect: (p: string, s: AbortSignal) => Promise<unknown> }) => { await run(opts); return { url: STORED, bytes: 1, copied: true } }),
    inspectOutsideInput: vi.fn(async (_url: string, opts: { inspect: (p: string, s: AbortSignal) => Promise<unknown> }) => { await run(opts); return { bytes: 1 } }),
  }
})
vi.mock("@/lib/credit-base-cost.js", () => ({ unitRateBaseCredits: vi.fn(async () => 10) }))
vi.mock("@/providers/fal/enabled.js", () => ({ falEnabled: () => true }))
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/video/ffmpeg-utils.js")>()),
  probeVideoSource: vi.fn(async () => ({ width: 480, height: 854, durationSeconds: 4, videoDurationSeconds: 4, fps: 24 })),
}))
vi.mock("@/lib/topaz-video-plan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/topaz-video-plan.js")>()),
  planTopazVideoUpscale: vi.fn(async () => ({ resolution: "1080p", fps: 24, holdUnits: 12 })),
}))
const trust = vi.hoisted(() => ({ honoured: true }))
vi.mock("@/lib/deferred-child-request.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/deferred-child-request.js")>()),
  deferSettlementHonoured: vi.fn(async () => trust.honoured),
}))

import { videoUpscaleRoutes } from "../video-upscale.js"
import { insertJob } from "../../lib/insert-job.js"
import { videoQueue } from "../../lib/queue.js"
import { deferSettlementHonoured } from "../../lib/deferred-child-request.js"

const USER = "00000000-0000-4000-8000-000000000001"
const CLIP = "https://cdn.example/take.mp4"
let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  trust.honoured = true
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    req.authKind = "internal"
  })
  await app.register(async (instance) => {
    await videoUpscaleRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app?.close()
})

async function post(payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload })
  expect(res.statusCode, res.body).toBe(200)
  const inputData = vi.mocked(insertJob).mock.calls[0]![1].input_data as Record<string, unknown>
  const [, queued] = vi.mocked(videoQueue.add).mock.calls[0]! as [string, Record<string, unknown>]
  return { body: res.json() as Record<string, unknown>, inputData, queued }
}

const TOPAZ = { provider: "topaz", videoUrl: CLIP, targetResolution: "1080p", targetFps: 24, forcePrivate: true }
const RHEA = { provider: "topaz-rhea", videoUrl: CLIP, targetResolution: "1080p", forcePrivate: true }

describe("POST /v1/video-upscale — deferSettlement", () => {
  it.each([["topaz", TOPAZ], ["topaz-rhea", RHEA]] as const)("%s from a trusted plugin child: held under the delivered rule, and answered", async (_p, body) => {
    const { body: answer, inputData, queued } = await post({ ...body, deferSettlement: true })
    expect(inputData).toMatchObject({ __deferSettlement: true, __deferSettlementRule: "delivered" })
    expect(inputData).not.toHaveProperty("deferSettlement")
    expect(queued).not.toHaveProperty("deferSettlement")
    expect(queued).not.toHaveProperty("__deferSettlement")
    expect(answer).toMatchObject({ jobId: "job-1", settlementDeferred: true })
  })

  it.each([["topaz", TOPAZ], ["topaz-rhea", RHEA]] as const)("%s not trusted (a public caller, another user's parent…): byte-identical to the request without the field", async (_p, body) => {
    trust.honoured = false
    const asked = await post({ ...body, deferSettlement: true })
    vi.clearAllMocks()
    const plain = await post(body)
    expect(asked.inputData).not.toHaveProperty("__deferSettlement")
    expect(asked.inputData).not.toHaveProperty("__deferSettlementRule")
    expect(asked.body).not.toHaveProperty("settlementDeferred")
    expect(JSON.stringify(asked.inputData)).toBe(JSON.stringify(plain.inputData))
    expect(JSON.stringify(asked.queued)).toBe(JSON.stringify(plain.queued))
  })

  it("a provider outside the delivered rule (VEO) is never held, and the trust check is not even asked", async () => {
    const { inputData, body } = await post({ provider: "veo-1080p", taskId: "task-1", deferSettlement: true })
    expect(inputData).not.toHaveProperty("__deferSettlement")
    expect(body).not.toHaveProperty("settlementDeferred")
    expect(deferSettlementHonoured).not.toHaveBeenCalled()
  })

  it("the standalone upscale (no field) is unchanged: no server-only keys, no answer field, no trust read", async () => {
    const { inputData, body } = await post(TOPAZ)
    expect(Object.keys(inputData).filter((k) => k.startsWith("__"))).toEqual([])
    expect(body).toEqual({ jobId: "job-1" })
    expect(deferSettlementHonoured).not.toHaveBeenCalled()
  })

  it("a caller cannot plant the server-only keys itself", async () => {
    trust.honoured = false
    const { inputData } = await post({ ...TOPAZ, __deferSettlement: true, __deferSettlementRule: "delivered" })
    expect(inputData).not.toHaveProperty("__deferSettlement")
    expect(inputData).not.toHaveProperty("__deferSettlementRule")
  })

  it("false is the same as absent; a non-boolean is refused", async () => {
    const { inputData, body } = await post({ ...TOPAZ, deferSettlement: false })
    expect(inputData).not.toHaveProperty("__deferSettlement")
    expect(body).not.toHaveProperty("settlementDeferred")
    const refused = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { ...TOPAZ, deferSettlement: "yes" } })
    expect(refused.statusCode).toBe(400)
  })
})
