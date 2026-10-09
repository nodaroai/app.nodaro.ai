/**
 * A Generate Image node with an attached reference runs the SAME request
 * through a workflow as through `POST /v1/generate-image`.
 *
 * With a reference attached, the route sends a text-to-image model's
 * image-to-image sibling (`T2I_TO_I2I_VARIANT`) — the text-to-image endpoints
 * take no image input — and reserves the sibling's credits. `buildPayload` is
 * the workflow engine's own implementation of that request, so this suite feeds
 * both engines the same node (one reference, the same levers) and follows each
 * job through the real generate-image worker and the real KIE adapter:
 *
 *   engine payload → worker → provider adapter (model id, refs, params)
 *                  → KIE adapter → KIE request (endpoint + body)
 *
 * and compares, per engine: the model id the worker hands the adapter, the
 * references and parameters that go with it, the KIE endpoint and request body,
 * the credit identifier reserved, and the provider recorded on the job (the
 * user's choice — the editor's "re-apply settings" writes it back onto the
 * node, and no i2i sibling is a valid Generate Image provider).
 *
 * The sweep reads the shared map, so a new sibling is covered by adding it
 * there and nothing else.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  jobInsert: vi.fn(),
  queueAdd: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  generateImage: vi.fn(),
  runKieTask: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ insert: mocks.jobInsert })) },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: mocks.queueAdd },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

// The worker → provider-adapter boundary: what each engine's job asks for.
vi.mock("@/providers/index.js", () => ({
  generateImage: mocks.generateImage,
  editImage: vi.fn(),
}))

vi.mock("@/lib/job-finalize.js", () => ({
  finalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock("@/workers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../workers/shared.js")>()),
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
}))

// The KIE wire: the endpoint and body the real adapter produces.
vi.mock("@/providers/kie/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/kie/client.js")>()),
  runKieTask: mocks.runKieTask,
}))

vi.mock("@/lib/credit-audit.js", () => ({
  logCreditAudit: vi.fn(),
  extractCreditFields: vi.fn(),
}))

import { T2I_TO_I2I_VARIANT } from "@nodaro/shared"
import { generateImageRoutes } from "../../../routes/generate-image.js"
import { buildPayload } from "../payload-builder.js"
import { imageAIHandlers } from "../../../workers/handlers/image-ai.js"
import { KieImageProvider } from "../../../providers/kie/image.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const REF = "https://cdn.example.com/refs/ref-1.png"
const PROMPT = "a lighthouse at dusk"

interface Levers {
  aspectRatio?: string
  resolution?: string
  quality?: string
}

/** One engine's job, as it leaves the engine. */
interface EngineJob {
  payload: Record<string, unknown>
  creditId: string
  recordedProvider: unknown
}

/** What that job turns into, from the worker down to the KIE wire. */
interface Outcome {
  creditId: string
  recordedProvider: unknown
  adapterModel: string
  adapterRefs: string[]
  adapterParams: Record<string, unknown> | undefined
  /** Every KIE task the adapter created (the grok-2 chain creates two). */
  kie: Array<{ model: string; input: Record<string, unknown> }>
}

let app: FastifyInstance

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {})
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(async (instance) => {
    await generateImageRoutes(instance)
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.jobInsert.mockImplementation(() => ({
    select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }),
  }))
  mocks.queueAdd.mockResolvedValue({ id: "queue-job-1" })
  mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false })
  mocks.generateImage.mockResolvedValue({ url: "https://cdn.example.com/out.png", providerUsed: "kie", cost: 0.01 })
  mocks.runKieTask.mockResolvedValue({ taskId: "kie-task-1", resultJson: { resultUrls: ["https://cdn.example.com/out.png"] } })
})

async function routeJob(provider: string, levers: Levers, refs: string[]): Promise<EngineJob> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/generate-image",
    payload: { prompt: PROMPT, provider, ...levers, ...(refs.length > 0 ? { referenceImageUrls: refs } : {}) },
  })
  expect(res.statusCode, res.body).toBe(200)
  const [, payload] = mocks.queueAdd.mock.calls.at(-1) as [string, Record<string, unknown>]
  const [row] = mocks.jobInsert.mock.calls.at(-1) as [{ input_data: Record<string, unknown> }]
  return {
    payload,
    creditId: mocks.reserveCreditsForJob.mock.calls.at(-1)?.[3] as string,
    recordedProvider: row.input_data.provider,
  }
}

function workflowJob(provider: string, levers: Levers, refs: string[]): EngineJob {
  const node = { id: "gen-1", type: "generate-image", data: { prompt: PROMPT, provider, ...levers } }
  // A wired upstream image reaches the builder as `referenceImageUrls`.
  const built = buildPayload(node, "job-1", refs.length > 0 ? { referenceImageUrls: refs } : {})
  const payload = built.payload as Record<string, unknown>
  // node-executor records the job's `input_data` as this payload.
  return { payload, creditId: built.modelIdentifier, recordedProvider: payload.provider }
}

async function followToKie(job: EngineJob): Promise<Outcome> {
  mocks.generateImage.mockClear()
  await imageAIHandlers["generate-image"](
    { name: "generate-image", data: { ...job.payload, jobId: "job-1" }, id: "bull-1", updateProgress: vi.fn() } as never,
    { jobId: "job-1", jobUserId: USER_ID, usageLogId: "usage-1", shouldWatermark: false } as never,
  )
  expect(mocks.generateImage).toHaveBeenCalledTimes(1)
  const [prompt, adapterModel, adapterRefs, adapterParams] = mocks.generateImage.mock.calls[0] as [
    string,
    string,
    string[] | undefined,
    Record<string, unknown> | undefined,
  ]

  mocks.runKieTask.mockClear()
  await new KieImageProvider().generateImage(prompt, adapterRefs, adapterModel, adapterParams)
  const kie = mocks.runKieTask.mock.calls.map(([model, input]) => {
    // The route takes a pre-assembled prompt while the builder assembles its
    // own, so the prompt text is not part of the comparison.
    const { prompt: _prompt, ...rest } = input as Record<string, unknown>
    return { model: model as string, input: rest }
  })
  return {
    creditId: job.creditId,
    recordedProvider: job.recordedProvider,
    adapterModel,
    adapterRefs: adapterRefs ?? [],
    adapterParams,
    kie,
  }
}

const ENGINES = {
  route: routeJob,
  workflow: async (provider: string, levers: Levers, refs: string[]) => workflowJob(provider, levers, refs),
} as const

describe("Generate Image + one reference: the request that reaches KIE", () => {
  const CASES = [
    {
      provider: "seedream-5-pro",
      model: "seedream-5-pro-i2i",
      endpoint: "seedream/5-pro-image-to-image",
      refField: "image_urls",
      creditId: "seedream-5-pro-i2i",
    },
    {
      provider: "gpt-image-2",
      model: "gpt-image-2-i2i",
      endpoint: "gpt-image-2-image-to-image",
      refField: "input_urls",
      creditId: "gpt-image-2-i2i",
    },
  ] as const

  describe.each(CASES)("$provider", (c) => {
    it.each(Object.keys(ENGINES) as Array<keyof typeof ENGINES>)(
      "%s run: the i2i model, its endpoint with the reference in the body, the i2i credit id",
      async (engine) => {
        const out = await followToKie(await ENGINES[engine](c.provider, {}, [REF]))
        expect(out.adapterModel).toBe(c.model)
        expect(out.adapterRefs).toEqual([REF])
        expect(out.kie).toHaveLength(1)
        expect(out.kie[0]!.model).toBe(c.endpoint)
        expect(out.kie[0]!.input[c.refField]).toEqual([REF])
        expect(out.kie[0]!.input).not.toHaveProperty("image_input")
        expect(out.creditId).toBe(c.creditId)
        // The job records the model the user picked, not the sibling.
        expect(out.recordedProvider).toBe(c.provider)
      },
    )
  })
})

describe("every model with an i2i sibling: a workflow run sends what the route sends", () => {
  const PAIRS = Object.entries(T2I_TO_I2I_VARIANT)
  // Includes values a model does not list (grok's i2i sibling takes no aspect
  // ratio, seedream has no resolution lever), so the catalog snap of the model
  // actually sent is exercised too.
  const LEVER_SETS: Levers[] = [{}, { aspectRatio: "16:9" }, { aspectRatio: "21:9", resolution: "2K", quality: "high" }]

  it("sweeps the whole map", () => {
    expect(PAIRS.length).toBeGreaterThan(10)
  })

  it.each(PAIRS)("%s with a reference → %s on both engines", async (t2i, i2i) => {
    for (const levers of LEVER_SETS) {
      const route = await followToKie(await routeJob(t2i, levers, [REF]))
      const workflow = await followToKie(workflowJob(t2i, levers, [REF]))
      expect(route.adapterModel, "the route sends the i2i sibling").toBe(i2i)
      expect(route.adapterRefs).toEqual([REF])
      expect(workflow, `levers ${JSON.stringify(levers)}`).toEqual(route)
    }
  })

  it.each(PAIRS)("%s without a reference stays text-to-image on both engines", async (t2i) => {
    const route = await followToKie(await routeJob(t2i, {}, []))
    const workflow = await followToKie(workflowJob(t2i, {}, []))
    expect(route.adapterModel).toBe(t2i)
    expect(workflow).toEqual(route)
  })
})
