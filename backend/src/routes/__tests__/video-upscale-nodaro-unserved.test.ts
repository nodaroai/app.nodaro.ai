import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * /v1/video-upscale on an install that serves no house model (no plugin
 * loaded): every spelling of the request's model that RESOLVES to Nodaro Video
 * Upscale — the provider values the catalog maps to it
 * (`videoUpscaleModelOf`, the rule the credit guard's `providerIsItsModel`
 * and the workflow build read) — is refused before anything is copied, held
 * or queued, through the real credit guard and the real house-model rule
 * (decided 2026-11-12): with a usable link by the route's own pre-check, without
 * one by the guard, both with 403 `model_not_available`. The workflow build
 * refuses the same node before its stamp runs.
 *
 * Today that spelling is the id itself; a new alias that resolves to it is a
 * new door, and the first test makes it a decision.
 */

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "business", PORT: 8000 },
  isBusiness: () => true,
  isCloud: () => false,
  isCommunity: () => false,
  hasCredits: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/admin-check.js", () => ({ checkIsAdmin: async () => false, warmAdminCache: vi.fn() }))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
const spies = vi.hoisted(() => ({ plan: vi.fn(), copy: vi.fn(), inspect: vi.fn(), insert: vi.fn(), queue: vi.fn() }))
vi.mock("@/lib/nodaro-video-upscale-plan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nodaro-video-upscale-plan.js")>()),
  planNodaroVideoUpscale: spies.plan,
}))
vi.mock("@/lib/outside-input-copy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/outside-input-copy.js")>()),
  copyOutsideInput: spies.copy,
  inspectOutsideInput: spies.inspect,
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: spies.insert }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: spies.queue }, redis: {} }))
vi.mock("@/lib/request-helpers.js", () => ({
  extractWorkflowId: () => null,
  extractNodeId: () => null,
  extractForcePrivate: () => false,
}))

import { videoUpscaleRoutes } from "../video-upscale.js"
import { VIDEO_UPSCALE_PROVIDERS, NODARO_VIDEO_UPSCALE_PROVIDER } from "@nodaro/shared/models"
import { videoUpscaleModelOf } from "@nodaro/shared/model-catalog"
import { providerModelOf } from "@nodaro/render-rules"
import { serveNoHouseModel } from "@/test/house-models.js"
import { houseModelServed } from "@/lib/house-models-served.js"
import { buildPayload } from "@/services/workflow-engine/payload-builder.js"

const USER = "00000000-0000-4000-8000-000000000001"
const CLIP = "https://cdn.example.com/clip.mp4"

/** Every Video Upscale provider value that runs Nodaro Video Upscale, by the catalog's own mapping. */
const SPELLINGS = VIDEO_UPSCALE_PROVIDERS.filter((p) => videoUpscaleModelOf(p) === NODARO_VIDEO_UPSCALE_PROVIDER)

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  serveNoHouseModel()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
  })
  await app.register(async (i) => { await videoUpscaleRoutes(i) })
  await app.ready()
})
afterEach(async () => {
  await app.close()
  serveNoHouseModel()
})

describe("the spellings that resolve to Nodaro Video Upscale", () => {
  it("are its own id only — an alias that resolves to it must be added here, and is then held to the refusals below", () => {
    expect(SPELLINGS).toEqual([NODARO_VIDEO_UPSCALE_PROVIDER])
    // The guard's and the build's reading (render-rules' provider → model table) agrees.
    for (const p of VIDEO_UPSCALE_PROVIDERS) {
      expect(providerModelOf("video-upscale", p) === NODARO_VIDEO_UPSCALE_PROVIDER, p).toBe(SPELLINGS.includes(p))
    }
  })
})

describe("an install that serves no house model refuses every one, before any copy, hold or job", () => {
  it("serves none here", () => {
    expect(houseModelServed(NODARO_VIDEO_UPSCALE_PROVIDER)).toBe(false)
  })

  for (const provider of SPELLINGS) {
    it.each([
      ["with a usable link (the route's pre-check)", { videoUrl: CLIP, targetResolution: "2k" }],
      ["with no link (the credit guard)", {}],
      ["with a link that is not one (the credit guard)", { videoUrl: "not a link" }],
    ])(`${provider} %s: 403 model_not_available`, async (_name, rest) => {
      const res = await app.inject({ method: "POST", url: "/v1/video-upscale", payload: { provider, ...rest } })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("model_not_available")
      expect(spies.plan).not.toHaveBeenCalled()
      expect(spies.copy).not.toHaveBeenCalled()
      expect(spies.inspect).not.toHaveBeenCalled()
      expect(spies.insert).not.toHaveBeenCalled()
      expect(spies.queue).not.toHaveBeenCalled()
    })

    it(`${provider} in a workflow: the build refuses the node before its stamp could fetch anything`, () => {
      const node = { id: "up", type: "video-upscale", data: { provider, targetResolution: "2k" } }
      let thrown: unknown
      try {
        buildPayload(node as never, "job-1", { videoUrl: CLIP } as never, undefined, { nodes: [node], edges: [], nodeStates: {} } as never)
      } catch (err) {
        thrown = err
      }
      expect((thrown as { code?: string } | undefined)?.code).toBe("model_not_available")
    })
  }
})
