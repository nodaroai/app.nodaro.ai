// @test-watches backend/src/ee/billing/docs-price-settings.json
/**
 * Suno's requests, against a fixture recorded BEFORE Suno V4_5PLUS, V4_5ALL
 * and V4_5 had model-catalog entries and price rows of their own (decided
 * 2026-11-12: each version gets its own row, `suno-v4_5plus`, `suno-v4_5all`
 * and `suno-v4_5`, for the version-priced operations, as V5 and V6 have, at
 * the price those runs are charged today).
 *
 * The fixture (fixtures/suno-requests.ts) holds every Suno version the routes
 * accept (and none) on each of the seven Suno operations that run a version,
 * on both lanes: the `/v1/suno/*` route, and the node in a server-run
 * workflow. Each route case and each workflow case is followed into the
 * worker, up to the Suno client call (its request and the credit id it
 * egresses under). Held: the job, the credit id the run is checked and
 * charged under and the price charged for it (the server's own price rule at
 * the hosted deployment's settings), and what the Suno client is asked to send.
 *
 * What may differ is pinned below: on generate, cover and extend, a V4_5PLUS,
 * V4_5ALL or V4_5 run is checked, charged and egressed under its version's
 * row instead of the operation's, at the same price; on every operation a job
 * on one of them records the catalog id it runs (`input_data.resolvedModel`).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  client: [] as Array<Record<string, unknown>>,
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
  // What each route's guard checks and judges, recorded per request.
  creditGuard: (resolver: (req: unknown) => unknown, opts?: { runModel?: (req: unknown) => unknown }) => async (req: unknown) => {
    h.guards.push({ check: resolver(req), runModel: opts?.runModel?.(req) })
  },
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 1, watermark: false }),
}))
// The worker side: the Suno client call is recorded, then the run stops (what
// follows it — the result's download and the job's completion — reads no version).
vi.mock("@/providers/kie/suno-client.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../providers/kie/suno-client.js")>()
  const call = (fn: string) => async (params: Record<string, unknown>, opts?: { modelKey?: string }) => {
    h.client.push({ fn, params: JSON.parse(JSON.stringify(params)), egressId: opts?.modelKey })
    throw new Error("suno-parity: stop after the client call")
  }
  return {
    ...orig,
    sunoGenerate: call("sunoGenerate"),
    sunoCover: call("sunoCover"),
    sunoExtend: call("sunoExtend"),
    sunoMashup: call("sunoMashup"),
    sunoAddInstrumental: call("sunoAddInstrumental"),
    sunoAddVocals: call("sunoAddVocals"),
    sunoUploadExtend: call("sunoUploadExtend"),
  }
})
vi.mock("@/workers/handlers/suno-cloud.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workers/handlers/suno-cloud.js")>()),
  shouldRunSunoOnCloud: vi.fn(async () => false),
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: () => undefined }))
vi.mock("@/workers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workers/shared.js")>()),
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, run: () => Promise<unknown>) => run()),
}))

import { sunoRoutes } from "../routes/suno.js"
import { videoQueue } from "../lib/queue.js"
import { reserveCreditsForJob } from "../middleware/credit-guard.js"
import { buildPayload } from "../services/workflow-engine/payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../services/workflow-engine/types.js"
import { sunoHandlers } from "../workers/handlers/suno.js"
import { statedPrices } from "../ee/billing/stated-prices.js"
import { SUNO_REQUESTS_BEFORE_VERSION_ROWS } from "./fixtures/suno-requests.js"

const USER = "00000000-0000-4000-8000-000000000001"
const AUDIO = "https://cdn.example.com/track.mp3"
const AUDIO_2 = "https://cdn.example.com/track-2.mp3"

type Json = Record<string, unknown>

/** Every Suno version the routes accepted when the fixture was recorded (`SUNO_MODELS` then), and none. */
const VERSIONS = [undefined, "V6", "V6_WILD", "V6_MINI", "V5_5", "V5", "V4_5PLUS", "V4_5ALL", "V4_5", "V4"] as const
/** The versions that get their own row (decided 2026-11-12), with it. */
const NEW_ROWS: Readonly<Record<string, string>> = { V4_5PLUS: "suno-v4_5plus", V4_5ALL: "suno-v4_5all", V4_5: "suno-v4_5" }
const VERSION_PRICED = ["suno-generate", "suno-cover", "suno-extend"]

/** Each operation: its route body and its node's data (and the inputs wired to it). */
const SUNO_CASE_INPUTS: Readonly<Record<string, { route: Json; node: Json; inputs?: Json }>> = {
  "suno-generate": { route: { prompt: "an upbeat song about the sea" }, node: { prompt: "an upbeat song about the sea" } },
  "suno-cover": { route: { prompt: "a slow acoustic cover", uploadUrl: AUDIO }, node: { prompt: "a slow acoustic cover", uploadUrl: AUDIO } },
  "suno-extend": { route: { audioId: "track-1", prompt: "keep going", continueAt: 30 }, node: { audioId: "track-1", prompt: "keep going", continueAt: 30 } },
  "suno-mashup": { route: { uploadUrlList: [AUDIO, AUDIO_2] }, node: {}, inputs: { audioUrl: AUDIO, audioUrl2: AUDIO_2 } },
  "suno-upload-extend": { route: { uploadUrl: AUDIO, continueAt: 30 }, node: { uploadUrl: AUDIO, continueAt: 30 } },
  "suno-add-instrumental": { route: { taskId: "task-1", audioId: "track-1" }, node: { taskId: "task-1", audioId: "track-1" } },
  "suno-add-vocals": { route: { taskId: "task-1", audioId: "track-1" }, node: { taskId: "task-1", audioId: "track-1" } },
}

const caseName = (op: string, version: string | undefined) => `${op} @ ${version ?? "(no version)"}`
const CASES = Object.keys(SUNO_CASE_INPUTS).flatMap((op) => VERSIONS.map((version) => ({ name: caseName(op, version), op, version })))

/** The price a run is charged for an id: the server's own price rule at the hosted deployment's settings. */
const charged = (id: unknown) => (typeof id === "string" ? statedPrices().credits(id) : undefined)

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Json | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => sunoRoutes(instance))
  await app.ready()
})

afterAll(async () => {
  await app?.close()
})

beforeEach(() => {
  h.client.length = 0
  h.guards.length = 0
  h.inserts.length = 0
})

/** What the Suno client is asked for when the worker runs this job. */
async function clientCallOf(jobName: string, payload: Json): Promise<Json> {
  h.client.length = 0
  const ctx = { jobId: "job-1", jobUserId: USER, usageLogId: "usage-1", shouldWatermark: false }
  await expect(
    sunoHandlers[jobName]!({ name: jobName, data: { ...payload, jobId: "job-1" }, id: "bull-1", updateProgress: vi.fn() } as never, ctx as never),
  ).rejects.toThrow("suno-parity: stop after the client call")
  expect(h.client).toHaveLength(1)
  return h.client[0]!
}

async function routeCase(c: (typeof CASES)[number]) {
  h.guards.length = 0
  h.inserts.length = 0
  vi.mocked(videoQueue.add).mockClear()
  vi.mocked(reserveCreditsForJob).mockClear()
  const body: Json = { ...SUNO_CASE_INPUTS[c.op]!.route, ...(c.version ? { model: c.version } : {}) }
  const res = await app.inject({ method: "POST", url: `/v1/suno/${c.op.slice("suno-".length)}`, payload: { userId: USER, ...body } })
  const queued = vi.mocked(videoQueue.add).mock.calls.at(-1) as [string, Json] | undefined
  const debit = vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3] as string | undefined
  const guard = h.guards.at(-1)
  return {
    status: res.statusCode,
    response: res.json() as Json,
    check: guard?.check,
    checkCharged: charged(guard?.check),
    runModel: guard?.runModel,
    debit,
    debitCharged: charged(debit),
    queued: queued ? { name: queued[0], data: { ...queued[1], jobId: undefined } } : undefined,
    inputData: h.inserts.at(-1)?.input_data as Json | undefined,
    client: queued ? await clientCallOf(queued[0], queued[1]) : undefined,
  }
}

async function workflowCase(c: (typeof CASES)[number]) {
  const spec = SUNO_CASE_INPUTS[c.op]!
  const node = { id: `${c.op}-1`, type: c.op, data: { label: "Suno", ...spec.node, ...(c.version ? { model: c.version } : {}) } } as SimpleNode
  const built = buildPayload(node, "job-1", (spec.inputs ?? {}) as ResolvedInputs, "usage-1", { nodes: [node], edges: [], nodeStates: {} } as never)
  return {
    jobName: built.jobName,
    modelIdentifier: built.modelIdentifier,
    charged: charged(built.modelIdentifier),
    payload: built.payload,
    client: await clientCallOf(built.jobName, built.payload as Json),
  }
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

describe("Suno's requests are what they were before V4_5PLUS, V4_5ALL and V4_5 had rows of their own", () => {
  beforeAll(async () => {
    before = JSON.parse(JSON.stringify(SUNO_REQUESTS_BEFORE_VERSION_ROWS)) as Recorded
    now = await record()
  }, 120_000)

  it("recorded every case (the fixture and this file name the same runs)", () => {
    expect(Object.keys(now.route).sort()).toEqual(Object.keys(before.route).sort())
    expect(Object.keys(now.workflow).sort()).toEqual(Object.keys(before.workflow).sort())
    expect(Object.keys(now.route)).toHaveLength(CASES.length)
  })

  it("every case on a version that keeps its row is byte for byte what it was, on both lanes", () => {
    for (const c of CASES) {
      if (c.version && Object.hasOwn(NEW_ROWS, c.version)) continue
      expect(now.route[c.name], `route: ${c.name}`).toEqual(before.route[c.name])
      expect(now.workflow[c.name], `workflow: ${c.name}`).toEqual(before.workflow[c.name])
    }
  })

  it("every run is charged what it was: 33 credits, for every version on every operation", () => {
    for (const c of CASES) {
      const was = { route: before.route[c.name]!, workflow: before.workflow[c.name]! }
      const run = { route: now.route[c.name]!, workflow: now.workflow[c.name]! }
      expect([run.route.checkCharged, run.route.debitCharged, run.workflow.charged], c.name)
        .toEqual([was.route.checkCharged, was.route.debitCharged, was.workflow.charged])
      expect(run.route.checkCharged, c.name).toBe(33)
      expect(run.workflow.charged, c.name).toBe(33)
      if (run.route.status === 200) expect(run.route.debitCharged, c.name).toBe(33)
    }
  })

  it("V4_5PLUS, V4_5ALL and V4_5 on generate, cover and extend are checked, charged and egressed under their own row", () => {
    for (const [version, row] of Object.entries(NEW_ROWS)) {
      for (const op of VERSION_PRICED) {
        const name = caseName(op, version)
        const was = { route: before.route[name]!, workflow: before.workflow[name]! }
        const run = { route: now.route[name]!, workflow: now.workflow[name]! }
        // Before: the operation's row.
        expect([was.route.check, was.route.debit, was.workflow.modelIdentifier], name).toEqual([op, op, op])
        expect([(was.route.client as Json).egressId, (was.workflow.client as Json).egressId], name).toEqual([op, op])
        // Now: the version's row, everywhere the id is read.
        expect([run.route.check, run.route.debit, run.workflow.modelIdentifier], name).toEqual([row, row, row])
        expect([(run.route.client as Json).egressId, (run.workflow.client as Json).egressId], name).toEqual([row, row])
      }
    }
  })

  it("a job on one of them records the catalog id it runs; nothing else in any request moved", () => {
    const withoutIds = (r: Json) => ({
      ...r,
      check: undefined,
      debit: undefined,
      modelIdentifier: undefined,
      runModel: undefined,
      inputData: r.inputData === undefined ? undefined : { ...(r.inputData as Json), resolvedModel: undefined },
      client: r.client === undefined ? undefined : { ...(r.client as Json), egressId: undefined },
    })
    for (const [version, catalogId] of Object.entries(NEW_ROWS)) {
      for (const op of Object.keys(SUNO_CASE_INPUTS)) {
        const name = caseName(op, version)
        const was = { route: before.route[name]!, workflow: before.workflow[name]! }
        const run = { route: now.route[name]!, workflow: now.workflow[name]! }
        expect(withoutIds(run.route), `route: ${name}`).toEqual(withoutIds(was.route))
        expect(withoutIds(run.workflow), `workflow: ${name}`).toEqual(withoutIds(was.workflow))
        // The model the route judges, and the one its job records, is the version's catalog entry.
        expect(was.route.runModel, name).toBe(version)
        expect(run.route.runModel, name).toBe(catalogId)
        if (was.route.status === 200) {
          expect((was.route.inputData as Json).resolvedModel, name).toBe(version)
          expect((run.route.inputData as Json).resolvedModel, name).toBe(catalogId)
        }
        // The flat-key operations keep their row whatever the version.
        if (!VERSION_PRICED.includes(op)) {
          expect([run.route.check, run.workflow.modelIdentifier], name).toEqual([op, op])
          expect([run.route.check, run.workflow.modelIdentifier], name).toEqual([was.route.check, was.workflow.modelIdentifier])
        }
      }
    }
  })
})
