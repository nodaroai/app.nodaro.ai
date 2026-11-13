/**
 * Lip Sync's requests, against a fixture recorded BEFORE LatentSync, HeyGen
 * Lipsync Precision and Lipsync 2 Pro had model-catalog entries (decided
 * 2026-11-12: the entries make them models a deployment's `models.allow` can
 * name; what they are sent and charged does not change).
 *
 * The fixture (fixtures/lip-sync-requests.ts) holds every Lip Sync option the
 * route accepted when it was recorded (and none), on both lanes: the
 * `/v1/lip-sync` route, and a Lip Sync node in a server-run workflow. Each
 * option runs plain and with every lever the route takes; the per-second
 * options at audio lengths in three duration buckets, and the options priced
 * by size at three sizes. Each case is followed through the real worker
 * handler: into the real Replicate lip-sync provider, whose transport alone is
 * mocked, and to the router call of the KIE, fal and multimodal options. Held:
 * what the provider receives, the credit id the run is checked and charged
 * under, the model it is judged on, and the job.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  kinds: [] as string[],
  guards: [] as Array<{ check: unknown; runModel: unknown }>,
  inserts: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/supabase.js", () => {
  const eq = () => ({ eq, then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok) })
  return {
    supabase: {
      from: vi.fn(() => ({
        insert: (row: Record<string, unknown>) => {
          h.inserts.push(row)
          return { select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }
        },
        update: () => ({ eq }),
        select: () => ({ eq, single: async () => ({ data: null, error: null }) }),
      })),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middleware/credit-guard.js")>()),
  // What the route's guard checks and judges, recorded per request.
  creditGuard: (resolver: (req: unknown) => unknown, opts?: { runModel?: (req: unknown) => unknown }) => async (req: unknown) => {
    h.guards.push({ check: resolver(req), runModel: opts?.runModel?.(req) })
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
// The Replicate options: the real provider module, its transport alone mocked.
vi.mock("@/providers/replicate/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/replicate/client.js")>()),
  runReplicatePrediction: vi.fn(async (args: Record<string, unknown>) => {
    const { reconcileOpts: _r, ...request } = args
    h.sent.push({ via: "replicate", ...JSON.parse(JSON.stringify(request)) })
    return { output: "https://out.test/lip-sync.mp4", cost: 0.01 }
  }),
}))
vi.mock("@/providers/replicate/output-cost.js", () => ({ replicateOutputCost: vi.fn(async () => 0.02) }))
// The KIE and multimodal options: the router call the handler makes.
vi.mock("@/providers/index.js", () => {
  const result = { url: "https://out.test/lip-sync.mp4", cost: 0.01, displayCost: 0.01, providerUsed: "kie" }
  const record = (via: string, args: unknown[]) => {
    h.sent.push({ via, args: JSON.parse(JSON.stringify(args.map((a) => (typeof a === "function" ? "(fn)" : a)))) })
    return result
  }
  return {
    lipSync: vi.fn(async (...args: unknown[]) => record("lipSync", args.slice(0, 6).concat(args.slice(7)))),
    lipSyncVideo: vi.fn(async (...args: unknown[]) => record("lipSyncVideo", args.slice(0, 5))),
    imageToVideo: vi.fn(async (...args: unknown[]) => record("imageToVideo", args.slice(0, 6))),
  }
})
vi.mock("@/providers/fal/lip-sync.js", () => ({
  falLipSync: vi.fn(async (...args: unknown[]) => {
    h.sent.push({ via: "falLipSync", args: JSON.parse(JSON.stringify(args.slice(0, 4))) })
    return { videoUrl: "https://out.test/lip-sync.mp4", cost: 0.01 }
  }),
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({
  makeOnTaskCreated: (_jobId: string, kind: string) => {
    h.kinds.push(kind)
    return undefined
  },
}))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock("@/workers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workers/shared.js")>()),
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  startProgressRamp: vi.fn(() => ({ stop: () => undefined })),
  uploadVideoMaybeWatermark: vi.fn(async () => "https://r2.test/videos/job-1.mp4"),
  generateAndUploadThumbnail: vi.fn(async () => undefined),
}))

import { lipSyncRoutes } from "../routes/lip-sync.js"
import { videoQueue } from "../lib/queue.js"
import { reserveCreditsForJob } from "../middleware/credit-guard.js"
import { buildPayload } from "../services/workflow-engine/payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../services/workflow-engine/types.js"
import { videoAIHandlers } from "../workers/handlers/video-ai.js"
import { LIP_SYNC_REQUESTS_BEFORE_CATALOG_ENTRIES } from "./fixtures/lip-sync-requests.js"

const USER = "00000000-0000-4000-8000-000000000001"
const IMAGE = "https://cdn.example.com/face.png"
const VIDEO = "https://cdn.example.com/face.mp4"
const AUDIO = "https://cdn.example.com/line.mp3"

type Json = Record<string, unknown>

/** Every option the route accepted when the fixture was recorded (`LIP_SYNC_PROVIDERS` then). */
const PROVIDERS = [
  "kling-avatar", "kling-avatar-pro", "infinitalk", "omnihuman-1-5",
  "latentsync", "wav2lip", "video-retalking", "sadtalker",
  "heygen-lipsync-precision", "lipsync-2-pro", "sync-lipsync-v3", "volcengine-lipsync",
  "seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5", "minimax-h3",
] as const
/** The options priced by the audio's length, in buckets. */
const PER_SECOND = ["kling-avatar", "kling-avatar-pro", "omnihuman-1-5", "heygen-lipsync-precision", "lipsync-2-pro", "sync-lipsync-v3", "volcengine-lipsync"]
/** The options priced by size. */
const BY_SIZE = ["infinitalk", "seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5", "minimax-h3"]

/** Every lever the route takes, each set. */
const EVERY_LEVER: Json = {
  resolution: "1080p", audioDurationSec: 42,
  guidanceScale: 2, inferenceSteps: 30, seed: 7, fastMode: true,
  pads: "0 10 0 0", smooth: true, fps: 25, resizeFactor: 2,
  enhancer: "gfpgan", preprocess: "full", still: true, poseStyle: 3, expressionScale: 1.5,
  enableDynamicDuration: true, disableMusicTrack: true, enableSpeechEnhancement: true,
  syncMode: "bounce", temperature: 0.4, activeSpeaker: true,
  mode: "basic", separateVocal: true, openScenedet: true, alignAudio: true, alignAudioReverse: false, templStartSeconds: 3,
}

interface Case {
  name: string
  provider: string | undefined
  levers: Json
}

const CASES: Case[] = [
  { name: "(no provider)", provider: undefined, levers: {} },
  ...PROVIDERS.flatMap((provider): Case[] => [
    { name: provider, provider, levers: {} },
    { name: `${provider} + every lever`, provider, levers: EVERY_LEVER },
    ...(PER_SECOND.includes(provider) ? [7, 42, 400].map((s) => ({ name: `${provider} @ ${s}s`, provider, levers: { audioDurationSec: s } })) : []),
    ...(BY_SIZE.includes(provider) ? ["480p", "1080p", "4k"].map((r) => ({ name: `${provider} @ ${r}`, provider, levers: { resolution: r } })) : []),
  ]),
]

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Json | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => lipSyncRoutes(instance))
  await app.ready()
})

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  vi.mocked(videoQueue.add).mockClear()
  vi.mocked(reserveCreditsForJob).mockClear()
  h.sent.length = 0
  h.kinds.length = 0
  h.guards.length = 0
  h.inserts.length = 0
})

/** What the provider receives when the worker runs this queued job, and the reconcile kind it tags. */
async function sentBy(payload: Json): Promise<{ sent: Json; kind: string }> {
  h.sent.length = 0
  h.kinds.length = 0
  const handler = videoAIHandlers["lip-sync"]!
  const ctx = { jobId: "job-1", jobUserId: USER, usageLogId: "usage-1", shouldWatermark: false }
  await handler({ name: "lip-sync", data: { ...payload, jobId: "job-1" }, id: "bull-1", updateProgress: vi.fn() } as never, ctx as never)
  expect(h.sent).toHaveLength(1)
  expect(h.kinds).toHaveLength(1)
  return { sent: h.sent[0]!, kind: h.kinds[0]! }
}

async function routeCase(c: Case) {
  h.guards.length = 0
  h.inserts.length = 0
  vi.mocked(videoQueue.add).mockClear()
  vi.mocked(reserveCreditsForJob).mockClear()
  const body: Json = { imageUrl: IMAGE, videoUrl: VIDEO, audioUrl: AUDIO, prompt: "make them talk", ...(c.provider ? { provider: c.provider } : {}), ...c.levers }
  const res = await app.inject({ method: "POST", url: "/v1/lip-sync", payload: { userId: USER, ...body } })
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Json | undefined
  const debit = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3] as string | undefined
  const guard = h.guards.at(-1)
  const inputData = h.inserts.at(-1)?.input_data as Json | undefined
  const worker = queued ? await sentBy(queued) : undefined
  return {
    status: res.statusCode,
    response: res.json() as Json,
    check: guard?.check,
    runModel: guard?.runModel,
    debit,
    queued: queued ? { ...queued, jobId: undefined } : undefined,
    inputData,
    ...worker,
  }
}

async function workflowCase(c: Case) {
  const data: Json = { label: "Lip Sync", prompt: "make them talk", ...(c.provider ? { provider: c.provider } : {}), ...c.levers }
  const node = { id: "lip-sync-1", type: "lip-sync", data } as SimpleNode
  const built = buildPayload(node, "job-1", { imageUrl: IMAGE, videoUrl: VIDEO, audioUrl: AUDIO } as ResolvedInputs, "usage-1", {
    nodes: [node],
    edges: [],
    nodeStates: {},
  } as never)
  const worker = await sentBy(built.payload as Json)
  return { jobName: built.jobName, modelIdentifier: built.modelIdentifier, payload: built.payload, ...worker }
}

type Recorded = { route: Record<string, Json>; workflow: Record<string, Json> }

async function record(): Promise<Recorded> {
  const route: Record<string, Json> = {}
  for (const c of CASES) route[c.name] = JSON.parse(JSON.stringify(await routeCase(c))) as Json
  const workflow: Record<string, Json> = {}
  for (const c of CASES) workflow[c.name] = JSON.parse(JSON.stringify(await workflowCase(c))) as Json
  return { route, workflow }
}

let before: Recorded
let now: Recorded

describe("Lip Sync's requests are what they were before the LatentSync, HeyGen and Lipsync 2 Pro catalog entries", () => {
  beforeAll(async () => {
    before = JSON.parse(JSON.stringify(LIP_SYNC_REQUESTS_BEFORE_CATALOG_ENTRIES)) as Recorded
    now = await record()
  }, 120_000)

  it("recorded every case (the fixture and this file name the same runs)", () => {
    expect(Object.keys(now.route).sort()).toEqual(Object.keys(before.route).sort())
    expect(Object.keys(now.workflow).sort()).toEqual(Object.keys(before.workflow).sort())
    expect(Object.keys(now.route)).toHaveLength(CASES.length)
  })

  it("every case is byte for byte what it was, on both lanes", () => {
    for (const lane of ["route", "workflow"] as const) {
      for (const [name, run] of Object.entries(now[lane])) {
        expect(run, `${lane}: ${name}`).toEqual(before[lane][name])
      }
    }
  })

  it("the three newly listed models are sent, checked and charged as before (and the fixture saw them run)", () => {
    for (const provider of ["latentsync", "heygen-lipsync-precision", "lipsync-2-pro"]) {
      for (const name of [provider, `${provider} + every lever`]) {
        const route = before.route[name]!
        expect(route.status, name).toBe(200)
        expect((route.sent as Json).via, name).toBe("replicate")
        expect(route.runModel, name).toBe(provider)
        expect(now.route[name], name).toEqual(route)
        expect(now.workflow[name], name).toEqual(before.workflow[name])
      }
    }
    expect([before.route["latentsync"]!.check, before.route["latentsync"]!.debit]).toEqual(["latentsync", "latentsync"])
    expect(before.route["heygen-lipsync-precision"]!.check).toBe("heygen-lipsync-precision:300s")
    expect(before.route["lipsync-2-pro @ 42s"]!.check).toBe("lipsync-2-pro:60s")
  })
})
