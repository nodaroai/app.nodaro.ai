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
 *
 * Wav2Lip, VideoReTalking and SadTalker were retired from Lip Sync afterwards
 * (decided 2026-11-12): their cases are now refused before anything is checked,
 * reserved or queued, with one sentence, on both lanes.
 *
 * The models priced by a length bucket (Kling AI Avatar (Pro), OmniHuman 1.5,
 * HeyGen, Lipsync 2 Pro, Sync v3, Volcengine) were then priced on the length
 * the server measures (decided 2026-11-13), never the `audioDurationSec` a
 * request or a node carries: their cases change in exactly that way
 * (`measuredNow`) — the route checks and charges the measured length's bucket
 * and records that length and the held seconds, the worker sends every lane
 * our prepared copy of the audio, and a workflow build no longer prices a
 * length at all (the run measures before it holds). Every other case is held
 * byte for byte.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  kinds: [] as string[],
  guards: [] as Array<{ check: unknown; runModel: unknown }>,
  inserts: [] as Array<Record<string, unknown>>,
  /** How long the audio really plays: what the price check decodes, whatever length a request names. */
  measuredSec: 20.04,
  /** Our copy of the audio the worker prepared, and the held seconds it was prepared under. */
  prepared: [] as Array<{ provider: string; held: number | undefined }>,
}))

// The price check's download and decode: the audio plays `h.measuredSec`.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/video/ffmpeg-utils.js")>()),
  downloadFile: async (_url: string, path: string) => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, "")
  },
}))
vi.mock("@/providers/video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/video/decoded-audio-length.js")>()),
  measureDecodedAudio: async () => ({ overCap: false, samples: Math.round(h.measuredSec * 44_100), seconds: h.measuredSec }),
}))
// Nodaro Cloud: its storage is a public CDN, so the worker sends providers our copy.
vi.mock("@/lib/own-media-reachability.js", () => ({ providersCanFetchOwnMedia: () => true }))
// The worker's preparation of a bucketed model's audio (its own tests run it): our copy's URL.
vi.mock("@/providers/kie/lip-sync-audio.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/kie/lip-sync-audio.js")>()),
  prepareLipSyncAudio: async (_url: string, pricing: { provider?: string }, _label: string, held: number | undefined) => {
    h.prepared.push({ provider: String(pricing.provider), held })
    return { url: "https://cdn.test/scratch/lip-sync-prepared.mp3", measuredSec: h.measuredSec, billedSeconds: held, padded: false, trimmed: false }
  },
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
  // Its `beforePricing` step (Lip Sync's audio measurement) runs first, as the real guard runs it.
  creditGuard: (
    resolver: (req: unknown) => unknown,
    opts?: { runModel?: (req: unknown) => unknown; beforePricing?: (req: unknown, reply: unknown) => Promise<unknown> },
  ) => async (req: unknown, reply: { sent: boolean }) => {
    await opts?.beforePricing?.(req, reply)
    if (reply.sent) return
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
import { retiredLipSyncProviderMessage } from "@nodaro/shared/models"

const USER = "00000000-0000-4000-8000-000000000001"
const IMAGE = "https://cdn.example.com/face.png"
const VIDEO = "https://cdn.example.com/face.mp4"
const AUDIO = "https://cdn.example.com/line.mp3"
const PREPARED_AUDIO = "https://cdn.test/scratch/lip-sync-prepared.mp3"

type Json = Record<string, unknown>

/** Every option the route accepted when the fixture was recorded (`LIP_SYNC_PROVIDERS` then). */
const PROVIDERS = [
  "kling-avatar", "kling-avatar-pro", "infinitalk", "omnihuman-1-5",
  "latentsync", "wav2lip", "video-retalking", "sadtalker",
  "heygen-lipsync-precision", "lipsync-2-pro", "sync-lipsync-v3", "volcengine-lipsync",
  "seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5", "minimax-h3",
] as const
/** The options retired from Lip Sync since the fixture was recorded (decided 2026-11-12). */
const RETIRED = new Set<string>(["wav2lip", "video-retalking", "sadtalker"])
const isRetiredCase = (name: string) => [...RETIRED].some((p) => name === p || name.startsWith(`${p} `))
/** The options priced by the audio's length, in buckets. */
const PER_SECOND = ["kling-avatar", "kling-avatar-pro", "omnihuman-1-5", "heygen-lipsync-precision", "lipsync-2-pro", "sync-lipsync-v3", "volcengine-lipsync"]
/** A case on a bucketed option ("(no provider)" runs Kling AI Avatar): priced on the measured length since 2026-11-13. */
const measuredProviderOf = (c: { name: string; provider: string | undefined }) => {
  const provider = c.provider ?? "kling-avatar"
  return PER_SECOND.includes(provider) ? provider : undefined
}
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
  let built: ReturnType<typeof buildPayload>
  try {
    built = buildPayload(node, "job-1", { imageUrl: IMAGE, videoUrl: VIDEO, audioUrl: AUDIO } as ResolvedInputs, "usage-1", {
      nodes: [node],
      edges: [],
      nodeStates: {},
    } as never)
  } catch (err) {
    return { refused: (err as Error).message }
  }
  const worker = await sentBy(built.payload as Json)
  return { jobName: built.jobName, modelIdentifier: built.modelIdentifier, payload: built.payload, ...worker }
}

type Recorded = { route: Record<string, Json>; workflow: Record<string, Json> }

/** Every string in `value` with the caller's audio URL replaced by our prepared copy's. */
function withPreparedAudio(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value).split(AUDIO).join(PREPARED_AUDIO))
}

/**
 * A bucketed model's recorded case as it runs since 2026-11-13: what the
 * fixture holds, with the length the price check measured in place of the one
 * the request named (`h.measuredSec`, the 30 s bucket). The route checks and
 * charges that bucket, records that length and the held seconds, and the
 * worker sends our copy of the audio on every lane (the KIE lanes told it is
 * prepared). A workflow BUILD prices no length any more (the run measures
 * before it holds), and runs unstamped, so its worker runs as before.
 */
function measuredNow(lane: "route" | "workflow", run: Json, provider: string): Json {
  const bucket = 30
  if (lane === "workflow") return { ...run, modelIdentifier: provider }
  const sent = withPreparedAudio(run.sent) as Json
  const args = sent.args as unknown[] | undefined
  if (sent.via === "lipSync" && args) {
    args[5] = h.measuredSec
    args[6] = { ...(args[6] as Json), billedSeconds: bucket, audioPrepared: true }
  }
  if (sent.via === "lipSyncVideo" && args) {
    args[3] = { ...(args[3] as Json), audioPrepared: true }
    args[4] = h.measuredSec
  }
  if (sent.via === "falLipSync" && args) args[3] = { ...(args[3] as Json), audioDurationSec: h.measuredSec }
  const lengths = { audioDurationSec: h.measuredSec, lipSyncBilledSeconds: bucket }
  return {
    ...run,
    check: `${provider}:${bucket}s`,
    debit: `${provider}:${bucket}s`,
    queued: { ...(run.queued as Json), ...lengths },
    inputData: { ...(run.inputData as Json), ...lengths },
    sent,
  }
}

async function record(): Promise<Recorded> {
  const route: Record<string, Json> = {}
  for (const c of CASES) route[c.name] = JSON.parse(JSON.stringify(await routeCase(c))) as Json
  const workflow: Record<string, Json> = {}
  for (const c of CASES) workflow[c.name] = JSON.parse(JSON.stringify(await workflowCase(c))) as Json
  return { route, workflow }
}

let before: Recorded
let now: Recorded

describe("Lip Sync's requests are what they were before the LatentSync, HeyGen and Lipsync 2 Pro catalog entries, but for the retired models", () => {
  beforeAll(async () => {
    before = JSON.parse(JSON.stringify(LIP_SYNC_REQUESTS_BEFORE_CATALOG_ENTRIES)) as Recorded
    now = await record()
  }, 120_000)

  it("recorded every case (the fixture and this file name the same runs)", () => {
    expect(Object.keys(now.route).sort()).toEqual(Object.keys(before.route).sort())
    expect(Object.keys(now.workflow).sort()).toEqual(Object.keys(before.workflow).sort())
    expect(Object.keys(now.route)).toHaveLength(CASES.length)
  })

  it("every case but the retired models' is byte for byte what it was, on both lanes — a bucketed model's but for its measured length", () => {
    let held = 0
    let measured = 0
    for (const lane of ["route", "workflow"] as const) {
      for (const c of CASES) {
        if (isRetiredCase(c.name)) continue
        const provider = measuredProviderOf(c)
        if (provider) {
          expect(now[lane][c.name], `${lane}: ${c.name}`).toEqual(measuredNow(lane, before[lane][c.name]!, provider))
          measured += 1
        } else {
          expect(now[lane][c.name], `${lane}: ${c.name}`).toEqual(before[lane][c.name])
        }
        held += 1
      }
    }
    expect(held).toBe(2 * (CASES.length - 6))
    // Every bucketed option's cases: plain, every lever, three named lengths — and "(no provider)".
    expect(measured).toBe(2 * (PER_SECOND.length * 5 + 1))
  })

  it("a bucketed model is charged its measured length's bucket whatever length the request names, and every lane is sent our copy of the audio", () => {
    // The audio plays 20.04 s: the 30 s bucket, for a request naming 7 s (under), 42 s or 400 s (over), or none.
    for (const provider of PER_SECOND) {
      for (const name of [provider, `${provider} @ 7s`, `${provider} @ 42s`, `${provider} @ 400s`, `${provider} + every lever`]) {
        const run = now.route[name]!
        expect([run.check, run.debit], name).toEqual([`${provider}:30s`, `${provider}:30s`])
        expect((run.queued as Json).audioDurationSec, name).toBe(20.04)
        expect((run.inputData as Json).lipSyncBilledSeconds, name).toBe(30)
        expect(JSON.stringify(run.sent), name).not.toContain(AUDIO)
        expect(JSON.stringify(run.sent), name).toContain(PREPARED_AUDIO)
      }
    }
    expect(before.route["kling-avatar @ 7s"]!.check).toBe("kling-avatar:15s")
  })

  it("a retired model ran before, and is now refused with its sentence before anything is checked, reserved or queued", () => {
    const retiredCases = CASES.filter((c) => isRetiredCase(c.name))
    expect(retiredCases.map((c) => c.name).sort()).toEqual([
      "sadtalker", "sadtalker + every lever", "video-retalking", "video-retalking + every lever", "wav2lip", "wav2lip + every lever",
    ])
    for (const c of retiredCases) {
      const message = retiredLipSyncProviderMessage(c.provider)!
      // Before: it ran on Replicate, checked and charged under its own row.
      expect(before.route[c.name]!.status, c.name).toBe(200)
      expect((before.route[c.name]!.sent as Json).via, c.name).toBe("replicate")
      expect(before.workflow[c.name]!.modelIdentifier, c.name).toBe(c.provider)
      // Now: refused on the route before the credit guard, the job row and the queue…
      expect(now.route[c.name], c.name).toEqual({
        status: 400,
        response: { error: { code: "validation_error", message } },
      })
      // …and in a workflow before the job is built.
      expect(now.workflow[c.name], c.name).toEqual({ refused: message })
    }
    expect(retiredLipSyncProviderMessage("wav2lip")).toBe("Wav2Lip is no longer available for Lip Sync. Pick another Lip Sync model.")
  })

  it("the three newly listed models are sent, checked and charged as before (and the fixture saw them run)", () => {
    for (const provider of ["latentsync", "heygen-lipsync-precision", "lipsync-2-pro"]) {
      for (const name of [provider, `${provider} + every lever`]) {
        const route = before.route[name]!
        expect(route.status, name).toBe(200)
        expect((route.sent as Json).via, name).toBe("replicate")
        expect(route.runModel, name).toBe(provider)
        // HeyGen and Lipsync 2 Pro are priced by a length bucket: their measured length since 2026-11-13.
        const measured = measuredProviderOf({ name, provider })
        expect(now.route[name], name).toEqual(measured ? measuredNow("route", route, measured) : route)
        expect(now.workflow[name], name).toEqual(measured ? measuredNow("workflow", before.workflow[name]!, measured) : before.workflow[name])
      }
    }
    expect([before.route["latentsync"]!.check, before.route["latentsync"]!.debit]).toEqual(["latentsync", "latentsync"])
    expect(before.route["heygen-lipsync-precision"]!.check).toBe("heygen-lipsync-precision:300s")
    expect(before.route["lipsync-2-pro @ 42s"]!.check).toBe("lipsync-2-pro:60s")
  })
})
