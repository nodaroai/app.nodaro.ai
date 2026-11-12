/**
 * FLUX Fill Pro's requests are what they were before it had a model-catalog
 * entry (decided 2026-11-12: the entry makes it a model a deployment's
 * `models.allow` can name).
 *
 * A catalog entry is not inert: `normalizeModelInput` snaps a request to the
 * entry's capability sheet on the route (`resolveNormalizedImageGen`) and in
 * the workflow build. The fixture (fixtures/flux-fill-requests.ts) was recorded from the code
 * BEFORE the entry existed, for every way a run reaches the model: the
 * `/v1/image-to-image` route with and without a mask (the Expand case is the
 * larger canvas with a mask and a ratio and size that fit it), and the Modify
 * Image and Image to Image nodes in a server-run workflow (the Image Overlay's
 * "AI finish" node among them). Each case is followed through the real worker
 * handler into the real Replicate provider, whose transport alone is mocked.
 *
 * Held byte for byte: the input Replicate receives and the credit id the run
 * is checked and charged under. FLUX Fill Pro takes no aspect ratio, size or
 * quality (its output follows the image it is given), so the entry lists none:
 * a value a request carries for one is dropped from the job, with an
 * adjustment saying so, exactly as for Ideogram Edit. That is the only
 * difference, and it is pinned below field by field.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const h = vi.hoisted(() => ({
  replicate: [] as Array<{ model?: string; input: Record<string, unknown> }>,
  probe: { width: 0, height: 0 } as { width: number; height: number } | undefined,
}))

vi.mock("@/lib/supabase.js", () => {
  const single = async () => ({ data: { id: "job-1" }, error: null })
  const eq = () => ({ eq, then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) })
  return {
    supabase: {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({ select: () => ({ single }) })),
        update: () => ({ eq }),
        select: () => ({ eq, single }),
      })),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middleware/credit-guard.js")>()),
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
vi.mock("@/lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("@/lib/image-source-size.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/image-source-size.js")>()),
  probeImageDisplaySize: vi.fn(async () => h.probe),
}))
// The worker side: the handler's router call goes straight to the Replicate
// provider (the router would pick it for this id), whose transport is mocked.
vi.mock("@/providers/index.js", async () => {
  const { ReplicateImageProvider } = await import("../providers/replicate/image.js")
  const replicate = new ReplicateImageProvider()
  return {
    generateImage: async (prompt: string, model: string, refs?: string[], extra?: Record<string, unknown>) => ({
      ...(await replicate.generateImage(prompt, refs, model, extra)),
      providerUsed: "replicate",
    }),
    editImage: vi.fn(),
  }
})
vi.mock("@/providers/replicate/client.js", () => ({
  extractUrl: (x: unknown) => String(x),
  runReplicatePrediction: vi.fn(async (opts: { model?: string; input: Record<string, unknown> }) => {
    h.replicate.push({ model: opts.model, input: opts.input })
    return { output: "https://out.test/result.png", cost: 0.01, predictionId: "p1" }
  }),
}))
vi.mock("@/lib/translate.js", () => ({ translateToEnglish: async (p: string) => p }))
vi.mock("@/lib/app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/app-settings.js")>()),
  getAppSettings: async () => ({ provider_safety_overrides: {} }),
}))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock("@/lib/character-auto-attach.js", () => ({ attachAssetToCharacter: vi.fn(), resolveAssetColumn: () => null }))
vi.mock("@/workers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workers/shared.js")>()),
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  startProgressRamp: vi.fn().mockReturnValue({ stop: vi.fn() }),
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: () => undefined }))

import { imageToImageRoutes, readImageSourceSize, resolveImageToImageCreditIdentifier } from "../routes/image-to-image.js"
import { probeImageDisplaySize } from "../lib/image-source-size.js"
import { videoQueue } from "../lib/queue.js"
import { supabase } from "../lib/supabase.js"
import { reserveCreditsForJob } from "../middleware/credit-guard.js"
import { buildPayload } from "../services/workflow-engine/payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../services/workflow-engine/types.js"
import { imageAIHandlers } from "../workers/handlers/image-ai.js"
import { useProviderSafetySettings } from "../lib/provider-safety.js"
import { FLUX_FILL_REQUESTS_BEFORE_CATALOG_ENTRY } from "./fixtures/flux-fill-requests.js"

/** The opening of the prompt the Image Overlay's "AI finish" writes (frontend use-image-overlay-ai-finish.ts). */
const AI_FINISH_PROMPT = "Blend the newly placed elements into the scene so they look photographed in place."

const USER = "00000000-0000-4000-8000-000000000001"
const SRC = "https://cdn.example.com/src.png"
const CANVAS = "https://cdn.example.com/expanded-canvas.png"
const MASK = "https://cdn.example.com/mask.png"
const REF = "https://cdn.example.com/ref.png"

type Json = Record<string, unknown>

/** The route cases: every body is sent as is, with `provider: "flux-fill"`. */
const ROUTE_CASES: ReadonlyArray<{ name: string; body: Json; photo?: { width: number; height: number } }> = [
  { name: "masked edit, nothing else", body: { imageUrl: SRC, prompt: "a red scarf", maskUrl: MASK } },
  { name: "masked edit, a named ratio", body: { imageUrl: SRC, prompt: "a red scarf", maskUrl: MASK, aspectRatio: "16:9" } },
  { name: "masked edit, auto", body: { imageUrl: SRC, prompt: "a red scarf", maskUrl: MASK, aspectRatio: "auto" }, photo: { width: 768, height: 1024 } },
  { name: "masked edit, a size and a quality", body: { imageUrl: SRC, prompt: "a red scarf", maskUrl: MASK, resolution: "2K", quality: "high" } },
  { name: "masked edit, seed and negative prompt", body: { imageUrl: SRC, prompt: "a red scarf", maskUrl: MASK, seed: 7, negativePrompt: "blur" } },
  { name: "masked edit with a reference image", body: { imageUrl: SRC, prompt: "a red scarf", maskUrl: MASK, referenceImageUrls: [REF] } },
  {
    name: "Expand: a larger canvas with a mask, a ratio and a size",
    body: { imageUrl: CANVAS, prompt: "continue the beach to the left and right", maskUrl: MASK, aspectRatio: "21:9", resolution: "4K" },
    photo: { width: 3072, height: 1316 },
  },
  { name: "no mask, a named ratio", body: { imageUrl: SRC, prompt: "a red scarf", aspectRatio: "1:1" } },
]

/** The workflow cases: one node with `provider: "flux-fill"`, built as a server-run workflow builds it. */
const WORKFLOW_CASES: ReadonlyArray<{ name: string; type: string; data: Json; inputs: Json; sourceImage?: { width: number; height: number } }> = [
  { name: "Modify Image, mask wired, ratio unset", type: "modify-image", data: { prompt: "a red scarf" }, inputs: { imageUrl: SRC, maskUrl: MASK } },
  { name: "Modify Image, a ratio and a size", type: "modify-image", data: { prompt: "a red scarf", aspectRatio: "16:9", resolution: "2K", quality: "high" }, inputs: { imageUrl: SRC, maskUrl: MASK } },
  {
    name: "Modify Image, Expand: a larger canvas with a mask",
    type: "modify-image",
    data: { prompt: "continue the beach", aspectRatio: "21:9", resolution: "4K" },
    inputs: { imageUrl: CANVAS, maskUrl: MASK },
    sourceImage: { width: 3072, height: 1316 },
  },
  { name: "Modify Image as the Image Overlay's AI finish adds it", type: "modify-image", data: { prompt: AI_FINISH_PROMPT }, inputs: { imageUrl: SRC, maskUrl: MASK } },
  { name: "Image to Image, mask on the node", type: "image-to-image", data: { prompt: "a red scarf", maskUrl: MASK, aspectRatio: "4:3", seed: 11 }, inputs: { imageUrl: SRC } },
]

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Json | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => imageToImageRoutes(instance))
  await app.ready()
})

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  useProviderSafetySettings()
  h.replicate.length = 0
  h.probe = undefined
})

/** What Replicate receives when the worker runs this queued job. */
async function replicateInputOf(jobName: string, payload: Json): Promise<{ model?: string; input: Json }> {
  h.replicate.length = 0
  const handler = imageAIHandlers[jobName]!
  const ctx = { jobId: "job-1", jobUserId: USER, usageLogId: "usage-1", shouldWatermark: false }
  await handler({ name: jobName, data: { ...payload, jobId: "job-1" }, id: "bull-1", updateProgress: vi.fn() } as never, ctx as never)
  expect(h.replicate).toHaveLength(1)
  return h.replicate[0]!
}

async function routeCase(c: (typeof ROUTE_CASES)[number]) {
  h.probe = c.photo
  const body = { ...c.body, provider: "flux-fill" }
  const res = await app.inject({ method: "POST", url: "/v1/image-to-image", payload: { userId: USER, ...body } })
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Json
  const insert = vi.mocked(supabase.from).mock.results.find((r) => r.type === "return")?.value as unknown as { insert: ReturnType<typeof vi.fn> }
  const inputData = (insert.insert.mock.calls[0]?.[0] as Json | undefined)?.input_data as Json | undefined
  const debit = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3] as string | undefined
  const req = { body } as FastifyRequest
  await readImageSourceSize(req)
  const check = resolveImageToImageCreditIdentifier(req)
  const sent = await replicateInputOf("image-to-image", queued)
  return { status: res.statusCode, response: res.json() as Json, queued: { ...queued, jobId: undefined }, inputData, debit, check, replicate: sent }
}

async function workflowCase(c: (typeof WORKFLOW_CASES)[number]) {
  const node = { id: `${c.type}-1`, type: c.type, data: { label: "Edit", provider: "flux-fill", ...c.data } } as SimpleNode
  const built = buildPayload(node, "job-1", { ...c.inputs } as ResolvedInputs, "usage-1", {
    nodes: [node],
    edges: [],
    nodeStates: {},
    ...(c.sourceImage ? { sourceImage: c.sourceImage } : {}),
  } as never)
  const sent = await replicateInputOf(built.jobName, built.payload as Json)
  return { jobName: built.jobName, modelIdentifier: built.modelIdentifier, payload: built.payload, replicate: sent }
}

type Recorded = { route: Record<string, Json>; workflow: Record<string, Json> }

async function record(): Promise<Recorded> {
  const route: Record<string, Json> = {}
  for (const c of ROUTE_CASES) route[c.name] = JSON.parse(JSON.stringify(await routeCase(c))) as Json
  const workflow: Record<string, Json> = {}
  for (const c of WORKFLOW_CASES) workflow[c.name] = JSON.parse(JSON.stringify(await workflowCase(c))) as Json
  return { route, workflow }
}

/** The levers FLUX Fill Pro has none of, in the order `normalizeModelInput` reports them. */
const LEVERS = ["aspectRatio", "resolution", "quality"] as const

function withoutLevers(value: unknown): Json {
  const out = { ...(value as Json) }
  for (const l of LEVERS) delete out[l]
  return out
}

/** The adjustments a run reports for the levers `carried` held: each one dropped. */
function droppedFrom(carried: unknown): Array<{ field: string; from: unknown }> {
  const c = carried as Json
  return LEVERS.filter((l) => c[l] !== undefined).map((field) => ({ field, from: c[field] }))
}

let before: Recorded
let now: Recorded
/** How many times a run read a photo's size while `record()` ran. */
let photoSizeReads = -1

describe("FLUX Fill Pro's requests are what they were before its catalog entry", () => {
  beforeAll(async () => {
    before = JSON.parse(JSON.stringify(FLUX_FILL_REQUESTS_BEFORE_CATALOG_ENTRY)) as Recorded
    vi.mocked(probeImageDisplaySize).mockClear()
    now = await record()
    photoSizeReads = vi.mocked(probeImageDisplaySize).mock.calls.length
  }, 60_000)

  it("recorded every case (the fixture and this file name the same runs)", () => {
    expect(Object.keys(now.route).sort()).toEqual(Object.keys(before.route).sort())
    expect(Object.keys(now.workflow).sort()).toEqual(Object.keys(before.workflow).sort())
    expect(Object.keys(now.route).length).toBe(ROUTE_CASES.length)
    expect(Object.keys(now.workflow).length).toBe(WORKFLOW_CASES.length)
  })

  it("Replicate receives exactly what it received before, on every lane", () => {
    for (const lane of ["route", "workflow"] as const) {
      for (const [name, run] of Object.entries(now[lane])) expect(run.replicate, `${lane}: ${name}`).toEqual(before[lane][name]!.replicate)
    }
  })

  it("every run is checked and charged under the same credit id", () => {
    for (const [name, run] of Object.entries(now.route)) {
      const was = before.route[name]!
      expect([run.status, run.check, run.debit], name).toEqual([was.status, was.check, was.debit])
      expect(run.debit, name).toBe("flux-fill")
    }
    for (const [name, run] of Object.entries(now.workflow)) {
      const was = before.workflow[name]!
      expect([run.jobName, run.modelIdentifier], name).toEqual([was.jobName, was.modelIdentifier])
    }
  })

  it("the job carries what it carried, less the aspect ratio, size and quality FLUX Fill Pro never read", () => {
    for (const [name, run] of Object.entries(now.route)) {
      const was = before.route[name]!
      expect(withoutLevers(run.queued), name).toEqual(withoutLevers(was.queued))
      expect(withoutLevers(run.inputData), name).toEqual(withoutLevers(was.inputData))
      for (const l of LEVERS) expect((run.queued as Json)[l], `${name}: ${l}`).toBeUndefined()
    }
    for (const [name, run] of Object.entries(now.workflow)) {
      const was = before.workflow[name]!
      expect(withoutLevers(run.payload), name).toEqual(withoutLevers(was.payload))
      for (const l of LEVERS) expect((run.payload as Json)[l], `${name}: ${l}`).toBeUndefined()
    }
  })

  it("no run reads the photo's size: FLUX Fill Pro has no ratio or size for it to choose (as before the entry)", () => {
    expect(photoSizeReads).toBe(0)
  })

  it("the route's answer says which values it dropped, and nothing else in it changed", () => {
    for (const [name, run] of Object.entries(now.route)) {
      const was = before.route[name]!
      const response = run.response as { adjustments?: Array<{ field: string; from: unknown; to?: unknown }> }
      const expected = droppedFrom(was.queued)
      expect((response.adjustments ?? []).map(({ field, from, to }) => ({ field, from, to })), name).toEqual(
        expected.map((a) => ({ ...a, to: undefined })),
      )
      expect({ ...response, adjustments: undefined }, name).toEqual({ ...(was.response as Json), adjustments: undefined })
    }
  })
})
