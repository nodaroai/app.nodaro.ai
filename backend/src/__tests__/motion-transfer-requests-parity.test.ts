/**
 * Motion Transfer's requests, against a fixture recorded BEFORE Wan Animate
 * Move and Replace had model-catalog entries (decided 2026-11-12: the entries
 * make them models a deployment's `models.allow` can name, and a Wan Animate
 * request for a size it does not have runs, and is charged, as 720p).
 *
 * The fixture (fixtures/motion-transfer-requests.ts) holds every provider ×
 * every size the route's schema accepts (and none), on both lanes: the
 * `/v1/motion-transfer` route, and a Motion Transfer node in a server-run
 * workflow. Each case is followed through the real worker handler into the real
 * KIE provider, whose transport alone is mocked. Held: the body KIE receives,
 * the credit id the run is checked and charged under, and the job.
 *
 * What may differ is pinned field by field below: a Wan Animate request at
 * 1080p (a size neither model has) is sent and charged as 720p, and the route's
 * answer says so. Everything else, Kling's sizes included, is byte for byte.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import sharp from "sharp"

const h = vi.hoisted(() => ({
  kie: [] as Array<{ model: string; input: Record<string, unknown> }>,
  guards: [] as Array<{ resolver: (req: unknown) => unknown; opts: Record<string, unknown> | undefined }>,
  png: Buffer.alloc(0) as Buffer,
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
  // The guard the route builds, kept so a case can ask what it checks and judges.
  creditGuard: (resolver: (req: unknown) => unknown, opts?: Record<string, unknown>) => {
    h.guards.push({ resolver, opts })
    return async () => {}
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
// The worker side: the handler's router call goes straight to the KIE video
// provider (the router picks it for every Motion Transfer option).
vi.mock("@/providers/index.js", async () => {
  const { KieVideoProvider } = await import("../providers/kie/video.js")
  const kie = new KieVideoProvider()
  return {
    motionTransfer: async (imageUrl: string, videoUrl: string, _model: string, prompt: string | undefined, options: Record<string, unknown>) => ({
      ...(await kie.motionTransfer(imageUrl, videoUrl, prompt, options as never)),
      providerUsed: "kie",
    }),
  }
})
vi.mock("@/providers/kie/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/kie/client.js")>()),
  runKieTask: vi.fn(async (model: string, input: Record<string, unknown>) => {
    h.kie.push({ model, input: JSON.parse(JSON.stringify(input)) as Record<string, unknown> })
    return { resultJson: { resultUrls: ["https://out.test/motion.mp4"] }, providerMs: 5 }
  }),
}))
// The character image: a 512×512 PNG every model takes as it is (no conversion, no upload).
vi.mock("@/lib/fetch-own-media.js", () => ({
  fetchOwnMedia: vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => h.png })),
}))
// The motion video: an 8-second clip, under the 30-second trim (no ffmpeg).
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers/video/ffmpeg-utils.js")>()),
  createWorkDir: vi.fn(async () => "/tmp/motion-parity"),
  cleanupWorkDir: vi.fn(async () => undefined),
  downloadFile: vi.fn(async () => undefined),
  getVideoDuration: vi.fn(async () => 8),
}))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock("@/lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: () => undefined }))
vi.mock("@/workers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workers/shared.js")>()),
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, run: () => Promise<unknown>) => run()),
  uploadVideoMaybeWatermark: vi.fn(async () => "https://r2.test/videos/job-1.mp4"),
  generateAndUploadThumbnail: vi.fn(async () => undefined),
}))

import { motionTransferRoutes } from "../routes/motion-transfer.js"
import { videoQueue } from "../lib/queue.js"
import { supabase } from "../lib/supabase.js"
import { reserveCreditsForJob } from "../middleware/credit-guard.js"
import { buildPayload } from "../services/workflow-engine/payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../services/workflow-engine/types.js"
import { videoAIHandlers } from "../workers/handlers/video-ai.js"
import { useProviderSafetySettings } from "../lib/provider-safety.js"
import { MOTION_TRANSFER_REQUESTS_BEFORE_CATALOG_ENTRIES } from "./fixtures/motion-transfer-requests.js"

const USER = "00000000-0000-4000-8000-000000000001"
const IMAGE = "https://cdn.example.com/character.png"
const VIDEO = "https://cdn.example.com/dance.mp4"

type Json = Record<string, unknown>

const PROVIDERS = ["kling", "kling-3.0", "wan-animate-move", "wan-animate-replace"] as const
/** Every size the route's schema accepts, and none. */
const SIZES = ["480p", "580p", "720p", "1080p", undefined] as const
const WAN = new Set<string>(["wan-animate-move", "wan-animate-replace"])

const caseName = (provider: string, size: string | undefined) => `${provider} @ ${size ?? "(no size)"}`
const CASES = PROVIDERS.flatMap((provider) => SIZES.map((size) => ({ name: caseName(provider, size), provider, size })))

let app: FastifyInstance

beforeAll(async () => {
  h.png = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 90, g: 120, b: 160 } } }).png().toBuffer()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Json | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => motionTransferRoutes(instance))
  await app.ready()
})

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  vi.mocked(videoQueue.add).mockClear()
  vi.mocked(reserveCreditsForJob).mockClear()
  vi.mocked(supabase.from).mockClear()
  useProviderSafetySettings()
  h.kie.length = 0
})

/** What KIE receives when the worker runs this queued job. */
async function kieRequestOf(payload: Json): Promise<{ model: string; input: Json }> {
  h.kie.length = 0
  const handler = videoAIHandlers["motion-transfer"]!
  const ctx = { jobId: "job-1", jobUserId: USER, usageLogId: "usage-1", shouldWatermark: false }
  await handler({ name: "motion-transfer", data: { ...payload, jobId: "job-1" }, id: "bull-1", updateProgress: vi.fn() } as never, ctx as never)
  expect(h.kie).toHaveLength(1)
  return h.kie[0]!
}

async function routeCase(c: (typeof CASES)[number]) {
  const body: Json = { imageUrl: IMAGE, videoUrl: VIDEO, prompt: "a person dancing", provider: c.provider, ...(c.size ? { resolution: c.size } : {}) }
  const res = await app.inject({ method: "POST", url: "/v1/motion-transfer", payload: { userId: USER, ...body } })
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1)?.[1] as Json
  const inserted = vi.mocked(supabase.from).mock.results
    .map((r) => (r.value as { insert?: ReturnType<typeof vi.fn> } | undefined)?.insert?.mock.calls[0]?.[0] as Json | undefined)
    .filter((row) => row !== undefined)
    .at(-1)
  const inputData = inserted?.input_data as Json | undefined
  const debit = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3] as string | undefined
  const guard = h.guards.at(-1)!
  const req = { body } as FastifyRequest
  const check = guard.resolver(req)
  const runModel = typeof guard.opts?.runModel === "function" ? (guard.opts.runModel as (r: FastifyRequest) => unknown)(req) : undefined
  const sent = await kieRequestOf(queued)
  return { status: res.statusCode, response: res.json() as Json, queued: { ...queued, jobId: undefined }, inputData, debit, check, runModel, kie: sent }
}

async function workflowCase(c: (typeof CASES)[number]) {
  const data: Json = { label: "Motion", provider: c.provider, prompt: "a person dancing", ...(c.size ? { resolution: c.size } : {}) }
  const node = { id: "motion-transfer-1", type: "motion-transfer", data } as SimpleNode
  const built = buildPayload(node, "job-1", { imageUrl: IMAGE, videoUrl: VIDEO } as ResolvedInputs, "usage-1", {
    nodes: [node],
    edges: [],
    nodeStates: {},
  } as never)
  const sent = await kieRequestOf(built.payload as Json)
  return { jobName: built.jobName, modelIdentifier: built.modelIdentifier, payload: built.payload, kie: sent }
}

type Recorded = { route: Record<string, Json>; workflow: Record<string, Json> }

async function record(): Promise<Recorded> {
  const route: Record<string, Json> = {}
  for (const c of CASES) route[c.name] = JSON.parse(JSON.stringify(await routeCase(c))) as Json
  const workflow: Record<string, Json> = {}
  for (const c of CASES) workflow[c.name] = JSON.parse(JSON.stringify(await workflowCase(c))) as Json
  return { route, workflow }
}

/** The cases whose request changed (decided 2026-11-12): Wan Animate at a size it does not have. */
const isWanAt1080 = (name: string) => [...WAN].some((p) => name === caseName(p, "1080p"))

let before: Recorded
let now: Recorded

describe("Motion Transfer's requests are what they were before the Wan Animate catalog entries", () => {
  beforeAll(async () => {
    before = JSON.parse(JSON.stringify(MOTION_TRANSFER_REQUESTS_BEFORE_CATALOG_ENTRIES)) as Recorded
    now = await record()
  }, 120_000)

  it("recorded every case (the fixture and this file name the same runs)", () => {
    expect(Object.keys(now.route).sort()).toEqual(Object.keys(before.route).sort())
    expect(Object.keys(now.workflow).sort()).toEqual(Object.keys(before.workflow).sort())
    expect(Object.keys(now.route)).toHaveLength(CASES.length)
  })

  it("every case but Wan Animate at 1080p is byte for byte what it was, on both lanes", () => {
    for (const lane of ["route", "workflow"] as const) {
      for (const [name, run] of Object.entries(now[lane])) {
        if (isWanAt1080(name)) continue
        expect(run, `${lane}: ${name}`).toEqual(before[lane][name])
      }
    }
  })

  it("Kling's sizes, 1080p among them, are sent and charged exactly as before", () => {
    for (const lane of ["route", "workflow"] as const) {
      for (const provider of ["kling", "kling-3.0"]) {
        for (const size of SIZES) {
          const name = caseName(provider, size)
          expect(now[lane][name], `${lane}: ${name}`).toEqual(before[lane][name])
        }
      }
    }
  })

  it("Wan Animate at 480p, 580p and 720p sends the size it names and charges that size's row, as before", () => {
    for (const provider of WAN) {
      for (const [size, row] of [["480p", provider], ["580p", `${provider}:580p`], ["720p", `${provider}:720p`]] as const) {
        const name = caseName(provider, size)
        expect((now.route[name]!.kie as { input: Json }).input.resolution, name).toBe(size)
        expect([now.route[name]!.check, now.route[name]!.debit], name).toEqual([row, row])
        expect((now.workflow[name]!.kie as { input: Json }).input.resolution, name).toBe(size)
        expect(now.workflow[name]!.modelIdentifier, name).toBe(row)
      }
    }
  })

  it("Wan Animate at 1080p now sends 720p and is checked and charged under the 720p row", () => {
    for (const provider of WAN) {
      const name = caseName(provider, "1080p")
      const was = { route: before.route[name]!, workflow: before.workflow[name]! }
      const run = { route: now.route[name]!, workflow: now.workflow[name]! }
      // Before: 1080p went to the provider as it was, and was charged the 480p row.
      expect((was.route.kie as { input: Json }).input.resolution).toBe("1080p")
      expect([was.route.check, was.route.debit]).toEqual([provider, provider])
      expect(was.workflow.modelIdentifier).toBe(provider)
      // Now: 720p, on the 720p row, on both lanes.
      expect((run.route.kie as { input: Json }).input.resolution, name).toBe("720p")
      expect([run.route.check, run.route.debit], name).toEqual([`${provider}:720p`, `${provider}:720p`])
      expect((run.route.queued as Json).resolution, name).toBe("720p")
      expect((run.route.inputData as Json).resolution, name).toBe("720p")
      expect((run.workflow.kie as { input: Json }).input.resolution, name).toBe("720p")
      expect(run.workflow.modelIdentifier, name).toBe(`${provider}:720p`)
      expect((run.workflow.payload as Json).resolution, name).toBe("720p")
      // Nothing else in what is sent, queued or recorded moved.
      const withoutSize = (v: unknown) => ({ ...(v as Json), resolution: undefined })
      expect(withoutSize((run.route.kie as { input: Json }).input)).toEqual(withoutSize((was.route.kie as { input: Json }).input))
      expect(withoutSize(run.route.queued)).toEqual(withoutSize(was.route.queued))
      expect(withoutSize(run.route.inputData)).toEqual(withoutSize(was.route.inputData))
      expect(withoutSize(run.workflow.payload)).toEqual(withoutSize(was.workflow.payload))
      expect(run.route.runModel).toEqual(was.route.runModel)
    }
  })

  it("the route's answer says the size moved, and nothing else in it changed", () => {
    for (const provider of WAN) {
      const name = caseName(provider, "1080p")
      const response = now.route[name]!.response as { adjustments?: Array<{ field: string; from: unknown; to: unknown }> }
      expect((response.adjustments ?? []).map(({ field, from, to }) => ({ field, from, to })), name).toEqual([
        { field: "resolution", from: "1080p", to: "720p" },
      ])
      expect({ ...response, adjustments: undefined }, name).toEqual({ ...(before.route[name]!.response as Json), adjustments: undefined })
    }
  })
})
