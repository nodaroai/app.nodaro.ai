/**
 * A trained character's runs are what they were before the trained-character
 * model became a model a deployment's restriction can name (decided
 * 2026-11-12).
 *
 * The fixture (fixtures/trained-character-requests.ts) was recorded from the
 * code before that change, for both ways a run reaches the trained model: the
 * `/v1/generate-image` route with the editor's `_internalLora` hint, and a
 * Generate Image node wired to a character with a succeeded trained model in a
 * server-run workflow (the build swaps to the trained model). Each case is
 * followed through the real worker handler into the real Replicate provider,
 * whose transport alone is mocked. On a deployment that restricts nothing, and
 * on one whose allow list names the trained model, every case is byte for byte
 * what it was: the credit ids checked and charged, the job, and what Replicate
 * receives.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const h = vi.hoisted(() => ({
  replicate: [] as Array<{ model?: string; input: Record<string, unknown> }>,
  inserts: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/supabase.js", () => {
  // The trained character the `_internalLora` hint names, owned by the caller.
  const charRow = { lora_replicate_version: "owner/char-kira:abc123", lora_trigger_word: "TOK_kira", lora_training_status: "succeeded" }
  const charSingle = async () => ({ data: charRow, error: null })
  const charChain = { eq: () => charChain, is: () => charChain, single: charSingle }
  const eq = () => ({ eq, then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) })
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "characters") return { select: () => charChain }
        return {
          insert: (row: Record<string, unknown>) => {
            h.inserts.push(row)
            return { select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }
          },
          update: () => ({ eq }),
          select: () => ({ eq, single: async () => ({ data: null, error: null }) }),
        }
      }),
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
  probeImageDisplaySize: vi.fn(async () => undefined),
}))
// The worker side: the handler's router call goes straight to the Replicate
// provider (the router picks it for the trained model), whose transport is mocked.
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
  runReplicatePrediction: vi.fn(async (opts: { model?: string; version?: string; input: Record<string, unknown> }) => {
    h.replicate.push({ model: opts.model ?? opts.version, input: JSON.parse(JSON.stringify(opts.input)) as Record<string, unknown> })
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

import { generateImageRoutes, resolveImageCreditIdentifier } from "../routes/generate-image.js"
import { resolveImageRunModel } from "../routes/generate-image-credit-id.js"
import { videoQueue } from "../lib/queue.js"
import { reserveCreditsForJob } from "../middleware/credit-guard.js"
import { buildPayload } from "../services/workflow-engine/payload-builder.js"
import type { ResolvedInputs, SimpleEdge, SimpleNode } from "../services/workflow-engine/types.js"
import { imageAIHandlers } from "../workers/handlers/image-ai.js"
import { useProviderSafetySettings } from "../lib/provider-safety.js"
import { __resetSurfaceProfileCacheForTests } from "../lib/surface-profile.js"
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"
import { TRAINED_CHARACTER_REQUESTS_BEFORE_CATALOG_ENTRY } from "./fixtures/trained-character-requests.js"

const USER = "00000000-0000-4000-8000-000000000001"
const CHARACTER_ID = "00000000-0000-4000-8000-0000000000bb"

type Json = Record<string, unknown>

/** The route cases: the editor's single-node Run of a node whose one wired character is trained. */
const ROUTE_CASES: ReadonlyArray<{ name: string; body: Json }> = [
  { name: "no ratio", body: { prompt: "TOK_kira walking on a beach" } },
  { name: "a square ratio", body: { prompt: "TOK_kira in a cafe", aspectRatio: "1:1" } },
  { name: "a wide ratio and a size", body: { prompt: "TOK_kira on a rooftop", aspectRatio: "16:9", resolution: "2K" } },
  { name: "auto", body: { prompt: "TOK_kira reading", aspectRatio: "auto" } },
  { name: "a seed and a negative prompt", body: { prompt: "TOK_kira dancing", aspectRatio: "3:4", seed: 7, negativePrompt: "blur" } },
]

const character: SimpleNode = {
  id: "c1",
  type: "character",
  data: {
    label: "Kira",
    characterName: "Kira",
    sourceImageUrl: "https://cdn.example.com/kira.png",
    loraReplicateVersion: "owner/char-kira:abc123",
    loraTriggerWord: "TOK_kira",
    loraTrainingStatus: "succeeded",
  },
}
const edges: SimpleEdge[] = [{ id: "e1", source: "c1", target: "g1", sourceHandle: "character" }]

/** The workflow cases: a Generate Image node wired to the trained character, by the model the node names. */
const WORKFLOW_CASES: ReadonlyArray<{ name: string; data: Json }> = [
  { name: "GPT Image 2, no ratio", data: { provider: "gpt-image-2", prompt: "Kira walking on a beach" } },
  { name: "GPT Image 2, auto", data: { provider: "gpt-image-2", prompt: "Kira walking on a beach", aspectRatio: "auto" } },
  { name: "Seedream 5 Pro, 16:9 and a quality", data: { provider: "seedream-5-pro", prompt: "Kira on a rooftop", aspectRatio: "16:9", quality: "high" } },
  { name: "Nano Banana 2, 1:1", data: { provider: "nano-banana-2", prompt: "Kira in a cafe", aspectRatio: "1:1" } },
  { name: "the default model", data: { prompt: "Kira reading" } },
]

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Json | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => generateImageRoutes(instance))
  await app.ready()
})

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  vi.mocked(videoQueue.add).mockClear()
  vi.mocked(reserveCreditsForJob).mockClear()
  useProviderSafetySettings()
  h.replicate.length = 0
  h.inserts.length = 0
})

/** What Replicate receives when the worker runs this queued job. */
async function replicateInputOf(payload: Json): Promise<{ model?: string; input: Json }> {
  h.replicate.length = 0
  const handler = imageAIHandlers["generate-image"]!
  const ctx = { jobId: "job-1", jobUserId: USER, usageLogId: "usage-1", shouldWatermark: false }
  await handler({ name: "generate-image", data: { ...payload, jobId: "job-1" }, id: "bull-1", updateProgress: vi.fn() } as never, ctx as never)
  expect(h.replicate).toHaveLength(1)
  return h.replicate[0]!
}

async function routeCase(c: (typeof ROUTE_CASES)[number]) {
  const body: Json = { ...c.body, provider: FLUX_LORA_CHARACTER_MODEL_ID, _internalLora: { characterId: CHARACTER_ID } }
  h.inserts.length = 0
  const res = await app.inject({ method: "POST", url: "/v1/generate-image", payload: { userId: USER, ...body } })
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Json
  const inputData = h.inserts.at(-1)?.input_data as Json | undefined
  const debit = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3] as string | undefined
  const req = { body } as FastifyRequest
  const check = resolveImageCreditIdentifier(req)
  const runModel = resolveImageRunModel(req)
  const sent = await replicateInputOf(queued)
  return { status: res.statusCode, response: res.json() as Json, queued: { ...queued, jobId: undefined }, inputData, debit, check, runModel, replicate: sent }
}

async function workflowCase(c: (typeof WORKFLOW_CASES)[number]) {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  const node: SimpleNode = { id: "g1", type: "generate-image", data: { label: "Portrait", ...c.data } }
  const built = buildPayload(node, "job-1", {} as ResolvedInputs, "usage-1", { nodes: [character, node], edges, nodeStates: {} })
  const sent = await replicateInputOf(built.payload as Json)
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

function setProfile(json: unknown): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(json)
  __resetSurfaceProfileCacheForTests()
}

afterEach(() => setProfile(null))

const before = (): Recorded => JSON.parse(JSON.stringify(TRAINED_CHARACTER_REQUESTS_BEFORE_CATALOG_ENTRY)) as Recorded

describe("a trained character's runs are what they were before the trained model was nameable", () => {
  it("on a deployment that restricts nothing: every case, on both lanes, byte for byte", async () => {
    const now = await record()
    const was = before()
    expect(Object.keys(now.route).sort()).toEqual(Object.keys(was.route).sort())
    expect(Object.keys(now.workflow).sort()).toEqual(Object.keys(was.workflow).sort())
    expect(now).toEqual(was)
    // The runs it pins are trained-model runs.
    for (const run of Object.values(now.route)) expect([run.status, run.debit], JSON.stringify(run.response)).toEqual([200, FLUX_LORA_CHARACTER_MODEL_ID])
    for (const run of Object.values(now.workflow)) expect(run.modelIdentifier).toBe(FLUX_LORA_CHARACTER_MODEL_ID)
  }, 60_000)

  it("on a deployment whose allow list names the trained model: the same", async () => {
    setProfile({ models: { allow: ["gpt-image-2", "gpt-image-2-i2i", "seedream-5-pro", "seedream-5-pro-i2i", "nano-banana-2", "gpt-image-2-6-flare", "gpt-image-2-6-flare-i2i", FLUX_LORA_CHARACTER_MODEL_ID] } })
    expect(await record()).toEqual(before())
  }, 60_000)
})
