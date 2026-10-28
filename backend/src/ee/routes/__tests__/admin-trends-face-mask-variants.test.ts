/**
 * The per-person face mask variant routes (ee/routes/admin-trends-face-mask-variants.ts,
 * decided 2026-10-27).
 *
 * What must hold:
 *  - making them writes one job per set a run can leave empty and asks the
 *    core mask erase as THAT job's child (internal, the parent in the
 *    server-only scope) on the approved raw mask, with the erase boxes of the
 *    people left empty and the keep boxes of the others; nothing is asked for
 *    a trend over the cap, with examples, or without an approved raw mask;
 *  - advancing fills a finished erase through the engine's face-mask make
 *    (`fromMask` = the erased mask, no marks), stores a finished fill in the
 *    trend's storage as an approved variant, records "nothing left" when the
 *    erase left nothing, and a failure as failed; a repeated advance asks for
 *    no paid step twice (idempotency keys of the variant's job).
 *
 * The store, the job rows and the trend media copy are in-memory stand-ins;
 * the mask erase and the engine's face-mask make are stub routes that record
 * what they receive.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import type { z } from "zod"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"
import type { FaceMaskMark } from "@nodaro/render-rules"
import type { TrendFaceMask, TrendRow, TrendVersionData } from "../../lib/trends/types.js"

const mem = vi.hoisted(() => ({
  data: null as unknown as TrendVersionData,
  revision: 1,
  jobs: new Map<string, Record<string, unknown>>(),
  inserted: [] as Array<Record<string, unknown>>,
  completed: [] as Array<{ jobId: string; fields: Record<string, unknown> }>,
  failed: [] as Array<{ jobId: string; message: string }>,
  copies: [] as string[],
  /** Called before a save lands (a concurrent write); return true to make the save lose. */
  onSave: null as null | (() => boolean),
  /** The insert of this anchor (1-based) fails. */
  insertFailsAt: 0,
  /** This many saves lose to a concurrent write. */
  failSaves: 0,
  /** Every job whose idle clock an advance touched. */
  touched: [] as string[],
}))

vi.mock("../../../lib/supabase.js", () => {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    for (const m of ["select", "insert", "is", "in", "order", "limit", "filter"]) builder[m] = () => builder
    builder.update = (patch: Record<string, unknown>) => ((filters.__update = patch), builder)
    builder.eq = (col: string, v: unknown) => ((filters[col] = v), builder)
    const answer = () => {
      if (table !== "jobs") return { data: null, error: null }
      const row = mem.jobs.get(filters.id as string)
      return { data: row && (filters.user_id === undefined || row.user_id === filters.user_id) ? row : null, error: null }
    }
    builder.maybeSingle = async () => answer()
    builder.single = async () => answer()
    builder.then = (res: (v: unknown) => unknown) => {
      // An update (the anchor's idle clock): recorded, applied to a still-processing row.
      if (filters.__update && table === "jobs") {
        mem.touched.push(filters.id as string)
        const row = mem.jobs.get(filters.id as string)
        if (row && row.status === filters.status) mem.jobs.set(row.id as string, { ...row, ...(filters.__update as object) })
      }
      return Promise.resolve({ data: null, error: null }).then(res)
    }
    return builder
  }
  return { supabase: { from } }
})

vi.mock("../../lib/trends/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/store.js")>()
  const trend = { id: "00000000-0000-4000-8000-0000000000a1", slug: "dance" } as unknown as TrendRow
  return {
    ...actual,
    getDraftState: async () => ({ trend, data: structuredClone(mem.data), revision: `rev-${mem.revision}` }),
    saveDraft: async (id: string, data: TrendVersionData, opts: { expectedRevision?: string } = {}) => {
      const hook = mem.onSave
      mem.onSave = null
      if (hook?.()) throw new actual.DraftConflictError(id)
      if (mem.failSaves > 0) {
        mem.failSaves -= 1
        throw new actual.DraftConflictError(id)
      }
      if (opts.expectedRevision !== undefined && opts.expectedRevision !== `rev-${mem.revision}`) throw new actual.DraftConflictError(id)
      mem.data = structuredClone(data)
      mem.revision += 1
      return { version: 1, revision: `rev-${mem.revision}` }
    },
  }
})

vi.mock("../../../lib/admin-check.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/admin-check.js")>()
  return { ...actual, checkIsAdmin: async (userId: string) => userId === ADMIN || userId === ADMIN2 }
})

vi.mock("../../../lib/insert-job.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/insert-job.js")>()
  return {
    ...actual,
    insertSyncJob: async (_req: unknown, row: Record<string, unknown>) => {
      if (mem.insertFailsAt === mem.inserted.length + 1) throw new Error("insert failed")
      mem.inserted.push(row)
      const id = `00000000-0000-4000-8000-${String(900 + mem.inserted.length).padStart(12, "0")}`
      mem.jobs.set(id, { id, user_id: row.user_id, status: row.status, input_data: row.input_data })
      return { data: { id }, error: null }
    },
  }
})

vi.mock("../../../workers/shared.js", () => ({
  markJobCompleted: async (jobId: string, fields: Record<string, unknown>) => {
    mem.completed.push({ jobId, fields })
    const row = mem.jobs.get(jobId)
    if (row) mem.jobs.set(jobId, { ...row, status: "completed", ...fields })
    return true
  },
}))

vi.mock("../../../lib/job-failure.js", () => ({
  markJobFailed: async (jobId: string, input: { error_message: string }) => {
    mem.failed.push({ jobId, message: input.error_message })
    const row = mem.jobs.get(jobId)
    if (row && row.status === "processing") mem.jobs.set(jobId, { ...row, status: "failed", error_message: input.error_message })
    return true
  },
}))

vi.mock("../../lib/trends/media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/trends/media.js")>()
  return {
    ...actual,
    copyToTrendStorage: async (_trendId: string, url: string) => {
      mem.copies.push(url)
      return { url: `https://cdn.test/trends/00000000-0000-4000-8000-0000000000a1/variant-${mem.copies.length}.mp4` }
    },
  }
})

import { registerTrendFaceMaskVariantRoutes, FACE_MASK_VARIANT_JOB_TYPE } from "../admin-trends-face-mask-variants.js"
import { withMarksForSource } from "../admin-trends-face-mask.js"
import { createsChildJob, jobSubmissionParentJobId } from "../../../lib/job-submission-context.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import { getDraftState, saveDraft } from "../../lib/trends/store.js"
import { trendVersionDataSchema } from "../../lib/trends/schemas.js"
import { faceMaskBaseKey, faceMaskSettingsKey } from "../../lib/trends/face-mask.js"
import { faceMaskVariantKey } from "../../lib/trends/face-mask-variants.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const ADMIN2 = "00000000-0000-4000-8000-0000000000ae"
const SECRET = "0".repeat(64) // src/test/setup.ts
const T1 = "00000000-0000-4000-8000-0000000000a1"
const SRC = `https://cdn.test/trends/${T1}/src.mp4`
const RAW = `https://cdn.test/trends/${T1}/raw.mp4`
const MASKING = { mode: "always" as const, threshold: 0.4 }
const box = (leftPct: number) => ({ fromFrame: 0, toFrame: 359, leftPct, topPct: 10, rightPct: leftPct + 20, bottomPct: 60 })
const slotMark = (slot: string, leftPct: number): FaceMaskMark => ({ label: { slot }, ...box(leftPct) })
const BASE_STATS = { shots: 2, heldFrames: 0, coverage: 0.05, droppedRegions: 0 }
const SUPPORTS = {
  roleKinds: ["person"],
  fixedReferences: true,
  fullQuality: true,
  resolutions: ["480p", "720p", "1080p"],
  trendRun: true,
  faceMasking: true,
  storedFaceMask: true,
  storedFaceMaskRequired: true,
  faceMaskErase: true,
  faceMaskRecipe: "1",
}

function draft(marks: FaceMaskMark[], over: Partial<TrendVersionData> = {}): TrendVersionData {
  const d: TrendVersionData = {
    name: { en: "Dance" },
    source: { videoUrl: SRC, durationSec: 12 },
    previewStart: 0,
    slots: [
      { key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the lead" },
      { key: "amy", kind: "person", label: { en: "Amy" }, required: false, roleName: "amy" },
      { key: "ben", kind: "person", label: { en: "Ben" }, required: false, roleName: "ben" },
    ],
    references: [],
    examples: [],
    faceMasking: { ...MASKING, marks },
    ...over,
  }
  const faceMask: TrendFaceMask = {
    url: `https://cdn.test/trends/${T1}/mask.mp4`,
    frames: 360,
    recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" },
    settingsKey: faceMaskSettingsKey(d)!,
    jobId: "fm-1",
    stats: { ...BASE_STATS, coverage: 0.04 },
    approvedAt: "2026-10-27T10:00:00.000Z",
    approvedBy: ADMIN,
    rawMaskUrl: RAW,
    baseKey: faceMaskBaseKey(d)!,
    baseStats: BASE_STATS,
  }
  return { ...d, faceMask: "faceMask" in over ? over.faceMask : faceMask }
}

const calls = { erase: [] as Array<Record<string, unknown>>, make: [] as Array<Record<string, unknown>> }
let app: FastifyInstance

beforeEach(async () => {
  mem.revision = 1
  mem.jobs = new Map()
  mem.inserted = []
  mem.completed = []
  mem.failed = []
  mem.copies = []
  mem.onSave = null
  mem.insertFailsAt = 0
  mem.failSaves = 0
  mem.touched = []
  calls.erase = []
  calls.make = []
  mem.data = draft([slotMark("amy", 10), slotMark("ben", 50)])
  _resetPluginSupportsForTests()
  setPluginSupports({ castSwap: structuredClone(SUPPORTS) as never })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-internal-orchestrator-secret"] === SECRET) {
      req.authKind = "internal"
      req.userId = req.headers["x-internal-user-id"] as string
      return
    }
    if (typeof req.headers["x-user-id"] === "string") req.userId = req.headers["x-user-id"]
  })
  // The core mask erase, as its door sees the request: only a child of a server-only parent passes.
  app.post("/v1/mask-erase", async (req, reply) => {
    if (!createsChildJob(req)) return reply.status(403).send({ error: { code: "forbidden", message: "internal child only" } })
    // As the credit guard dedups by the caller's Idempotency-Key.
    const seen = calls.erase.find((c) => c.key === req.headers["idempotency-key"])
    if (seen) return reply.status(200).send({ jobId: seen.id, deduped: true })
    const id = `00000000-0000-4000-8000-${String(500 + calls.erase.length).padStart(12, "0")}`
    calls.erase.push({ body: req.body, parentJobId: jobSubmissionParentJobId(req), key: req.headers["idempotency-key"], id })
    mem.jobs.set(id, { id, user_id: req.userId, status: "processing" })
    return reply.status(202).send({ jobId: id })
  })
  app.post("/v1/cast-swap/face-mask", async (req, reply) => {
    if (req.authKind !== "internal") return reply.status(403).send({ error: { code: "forbidden", message: "internal only" } })
    const key = req.headers["idempotency-key"]
    const seen = calls.make.find((c) => c.key === key)
    if (seen) return reply.status(202).send({ jobId: seen.id })
    const id = `00000000-0000-4000-8000-${String(700 + calls.make.length).padStart(12, "0")}`
    calls.make.push({ body: req.body, key, id })
    mem.jobs.set(id, { id, user_id: req.userId, status: "processing" })
    return reply.status(202).send({ data: { jobId: id } })
  })
  await app.register(async (i) => {
    registerTrendFaceMaskVariantRoutes(i, {
      loadDraft: async (_req: FastifyRequest, _reply: FastifyReply) => {
        const s = (await getDraftState(T1))!
        return { trend: s.trend, draft: s.data, revision: s.revision }
      },
      saveValidDraft: async (_reply, id, data, expected) => saveDraft(id, trendVersionDataSchema.parse(data), { expectedRevision: expected }),
      draftConflict: (reply: FastifyReply) => reply.status(409).send({ error: { code: "draft_conflict" } }),
      badRequest: (reply: FastifyReply, e: z.ZodError) => reply.status(400).send({ error: { code: "validation_error", issues: e.issues } }),
    })
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  _resetPluginSupportsForTests()
})

const post = (path: string, userId = ADMIN) =>
  app.inject({ method: "POST", url: `/v1/admin/trends/${T1}/face-mask/${path}`, headers: { "x-user-id": userId }, payload: { revision: `rev-${mem.revision}` } })
const setJob = (id: string, row: Record<string, unknown>) => mem.jobs.set(id, { ...mem.jobs.get(id)!, ...row })

describe("POST /face-mask/variants", () => {
  it("writes one job per set and asks the core erase as its child, with the erase and keep boxes", async () => {
    const res = await post("variants")
    expect(res.statusCode).toBe(202)
    expect(res.json().data).toMatchObject({ started: 3, recorded: true })
    expect(mem.inserted.map((r) => (r.input_data as { type: string }).type)).toEqual([FACE_MASK_VARIANT_JOB_TYPE, FACE_MASK_VARIANT_JOB_TYPE, FACE_MASK_VARIANT_JOB_TYPE])
    expect(mem.inserted.every((r) => r.user_id === ADMIN && r.force_private === true && r.status === "processing")).toBe(true)
    // Each erase is a child of its variant's own job.
    const anchors = [...mem.jobs.keys()].filter((id) => mem.inserted.some((r) => mem.jobs.get(id)!.input_data === r.input_data))
    expect(calls.erase.map((c) => c.parentJobId)).toEqual(anchors)
    expect(calls.erase.map((c) => c.body)).toEqual([
      { maskUrl: RAW, erase: [box(10)], keep: [box(50)], forcePrivate: true },
      { maskUrl: RAW, erase: [box(50)], keep: [box(10)], forcePrivate: true },
      { maskUrl: RAW, erase: [box(10), box(50)], forcePrivate: true },
    ])
    const jobs = mem.data.faceMask!.variantJobs!
    expect(jobs.map((j) => j.emptySlots)).toEqual([["amy"], ["ben"], ["amy", "ben"]])
    expect(jobs[0]!.key).toBe(faceMaskVariantKey(mem.data, ["amy"]))
    expect(res.json().data.faceMaskState.variants.variants.map((v: { status: string }) => v.status)).toEqual(["making", "making", "making"])
  })

  it("asks for nothing over the cap, with examples that fill every marked person, with no marked person, without an approved raw mask, or on an engine without erase", async () => {
    const cases: Array<[TrendVersionData, string, (() => void)?]> = [
      [draft([slotMark("amy", 10)], { faceMask: undefined }), "face_mask_not_approved"],
      [draft([slotMark("amy", 10)], { examples: [{ videoUrl: SRC, width: 1, height: 1, durationSec: 12, sourceJobId: "j", slots: { amy: [SRC] } }] }), "person_masks_not_needed"],
      [draft([]), "no_person_marks"],
      [{ ...draft([slotMark("amy", 10)]), faceMask: { ...draft([slotMark("amy", 10)]).faceMask!, rawMaskUrl: undefined } }, "no_raw_mask"],
      [draft([slotMark("amy", 10)]), "engine_unsupported", () => setPluginSupports({ castSwap: { ...SUPPORTS, faceMaskErase: false } as never })],
    ]
    for (const [d, code, before] of cases) {
      mem.data = d
      before?.()
      const res = await post("variants")
      expect(res.json().error?.code, code).toBe(code)
      setPluginSupports({ castSwap: structuredClone(SUPPORTS) as never })
    }
    // Four marked people (the cap is 3).
    const slots = [...draft([]).slots, { key: "cat", kind: "person" as const, label: { en: "Cat" }, required: false, roleName: "cat" }, { key: "dan", kind: "person" as const, label: { en: "Dan" }, required: false, roleName: "dan" }]
    mem.data = draft([slotMark("amy", 0), slotMark("ben", 20), slotMark("cat", 40), slotMark("dan", 60)], { slots })
    expect((await post("variants")).json().error.code).toBe("face_mask_people_over_cap")
    expect(calls.erase).toEqual([])
    expect(mem.inserted).toEqual([])
  })

  it("starts only what is not made yet", async () => {
    await post("variants")
    const again = await post("variants")
    expect(again.json().data.started).toBe(0)
    expect(calls.erase).toHaveLength(3)
  })
})

describe("POST /face-mask/variants/advance", () => {
  it("fills a finished erase from the erased mask, then stores and approves the variant; a repeat pays for nothing twice", async () => {
    mem.data = draft([slotMark("amy", 10)])
    await post("variants")
    const job = mem.data.faceMask!.variantJobs![0]!
    // Still erasing: nothing happens.
    expect((await post("variants/advance")).json().data.changed).toBe(false)
    setJob(job.eraseJobId!, { status: "completed", output_data: { videoUrl: "https://out.test/erased.mp4", frames: 360, coverage: 0.03, droppedRegions: 4, kept: true } })
    await post("variants/advance")
    expect(calls.make).toHaveLength(1)
    expect(calls.make[0]!.body).toEqual({
      videoUrl: SRC,
      faceMasking: { ...MASKING, zone: { leftPct: 10, rightPct: 10, topPct: 0, bottomPct: 0 } },
      fromMask: { maskUrl: "https://out.test/erased.mp4", recipe: VIDEO_MASK_RECIPE, stats: BASE_STATS },
    })
    expect(calls.make[0]!.key).toBe(`${FACE_MASK_VARIANT_JOB_TYPE}:${job.jobId}:make`)
    const makeJobId = mem.data.faceMask!.variantJobs![0]!.makeJobId!
    expect(makeJobId).toBe(calls.make[0]!.id)
    // A repeat while the fill runs asks for nothing.
    await post("variants/advance")
    expect(calls.make).toHaveLength(1)
    setJob(makeJobId, { status: "completed", output_data: { maskedUrl: "https://out.test/variant.mp4", frames: 360 } })
    const done = await post("variants/advance")
    expect(done.json().data.changed).toBe(true)
    expect(mem.copies).toEqual(["https://out.test/variant.mp4"])
    expect(mem.data.faceMask!.variantJobs).toBeUndefined()
    expect(mem.data.faceMask!.variants).toEqual([
      expect.objectContaining({ emptySlots: ["amy"], url: `https://cdn.test/trends/${T1}/variant-1.mp4`, frames: 360, jobId: job.jobId, stats: { coverage: 0.03, erasedRegions: 4 }, key: job.key }),
    ])
    expect(mem.completed).toEqual([{ jobId: job.jobId, fields: { output_data: expect.objectContaining({ maskedUrl: `https://cdn.test/trends/${T1}/variant-1.mp4` }) } }])
    expect(done.json().data.faceMaskState.variants.variants[0].status).toBe("approved")
  })

  it("records a variant that left nothing to cover without a fill, and a failed step as failed", async () => {
    await post("variants")
    const [amy, ben] = mem.data.faceMask!.variantJobs!
    setJob(amy!.eraseJobId!, { status: "completed", output_data: { videoUrl: "https://out.test/e.mp4", frames: 360, coverage: 0, droppedRegions: 2, kept: false, keptRegions: 1 } })
    setJob(ben!.eraseJobId!, { status: "failed", error_message: "boom" })
    await post("variants/advance")
    expect(calls.make).toEqual([])
    const amyVariant = mem.data.faceMask!.variants!.find((v) => v.emptySlots.join() === "amy")!
    expect(amyVariant).not.toHaveProperty("url")
    expect(amyVariant.stats).toEqual({ coverage: 0, erasedRegions: 2 })
    const benJob = mem.data.faceMask!.variantJobs!.find((j) => j.emptySlots.join() === "ben")!
    expect(benJob.error?.message).toMatch(/boom/)
    expect(mem.failed.map((f) => f.jobId)).toEqual([ben!.jobId])
  })

  it("drops a job made for marks since edited (its result would be out of date)", async () => {
    mem.data = draft([slotMark("amy", 10)])
    await post("variants")
    const stale = mem.data.faceMask!.variantJobs![0]!
    mem.data = { ...mem.data, faceMasking: { ...MASKING, marks: [slotMark("amy", 12)] } }
    await post("variants/advance")
    expect(mem.data.faceMask!.variantJobs).toBeUndefined()
    expect(calls.make).toEqual([])
    // Its own job is closed, never left processing.
    expect(mem.failed.map((f) => f.jobId)).toEqual([stale.jobId])
  })

  it("a new start for a set whose record was made for older marks closes that record's job", async () => {
    mem.data = draft([slotMark("amy", 10)])
    await post("variants")
    const old = mem.data.faceMask!.variantJobs![0]!
    mem.data = { ...mem.data, faceMasking: { ...MASKING, marks: [slotMark("amy", 12)] } }
    const res = await post("variants")
    expect(res.json().data.started).toBe(1)
    expect(mem.failed.map((f) => f.jobId)).toEqual([old.jobId])
    expect(mem.data.faceMask!.variantJobs!.map((j) => j.jobId)).not.toContain(old.jobId)
  })
})

describe("review fixes", () => {
  const ERASED: FaceMaskMark = { label: "erased", ...box(80) }
  const cat = { key: "cat", kind: "person" as const, label: { en: "Cat" }, required: false, roleName: "cat" }
  const dan = { key: "dan", kind: "person" as const, label: { en: "Dan" }, required: false, roleName: "dan" }

  it("a change of people never grows the stored sets past 7: old sets are dropped, the start records and pays for the new ones", async () => {
    const slots = [...draft([]).slots, cat, dan]
    const before = draft([slotMark("amy", 10), slotMark("ben", 40)], { slots })
    const made = ["amy", "ben", "amy+ben"].map((k, i) => ({
      emptySlots: k.split("+"), key: faceMaskVariantKey(before, k.split("+"))!, url: `https://cdn.test/v${i}.mp4`, frames: 360, jobId: `v${i}`,
      stats: { coverage: 0.01, erasedRegions: 1 }, approvedAt: "t",
    }))
    mem.data = { ...before, faceMask: { ...before.faceMask!, variants: made }, faceMasking: { ...MASKING, marks: [slotMark("amy", 10), slotMark("cat", 50), slotMark("dan", 70)] } }
    const res = await post("variants")
    expect(res.statusCode).toBe(202)
    expect(res.json().data.started).toBe(7)
    expect(calls.erase).toHaveLength(7)
    // Ben's sets are gone; Amy's old variant stays, out of date, beside the 7 records.
    expect(mem.data.faceMask!.variants!.map((v) => v.emptySlots)).toEqual([["amy"]])
    expect(mem.data.faceMask!.variantJobs).toHaveLength(7)
    expect(mem.data.faceMask!.variantJobs!.every((j) => j.eraseJobId)).toBe(true)
  })

  it("records before paying: a start another start beat (the set already in the making) asks for nothing and closes its own job", async () => {
    mem.data = draft([slotMark("amy", 10)])
    const key = faceMaskVariantKey(mem.data, ["amy"])!
    mem.onSave = () => {
      // Meanwhile another start recorded the same set.
      mem.data = { ...mem.data, faceMask: { ...mem.data.faceMask!, variantJobs: [{ emptySlots: ["amy"], key, jobId: "other", startedAt: "t" }] } }
      mem.revision += 1
      return true
    }
    const res = await post("variants")
    expect(res.statusCode).toBe(202)
    expect(res.json().data.started).toBe(0)
    expect(calls.erase).toEqual([])
    const mine = [...mem.jobs.keys()].find((id) => mem.inserted.some((r) => mem.jobs.get(id)!.input_data === r.input_data))!
    expect(mem.failed.map((f) => f.jobId)).toEqual([mine])
    expect(mem.data.faceMask!.variantJobs!.map((j) => j.jobId)).toEqual(["other"])
  })

  it("pays nothing and closes every job when the face mask changed before the records landed, or a write fails partway", async () => {
    mem.data = draft([slotMark("amy", 10), slotMark("ben", 40)])
    mem.onSave = () => {
      mem.data = { ...mem.data, faceMask: { ...mem.data.faceMask!, jobId: "fm-2" } }
      mem.revision += 1
      return true
    }
    const changed = await post("variants")
    expect(changed.statusCode).toBe(409)
    expect(calls.erase).toEqual([])
    expect(mem.failed).toHaveLength(3)

    mem.data = draft([slotMark("amy", 10), slotMark("ben", 40)])
    mem.failed = []
    mem.inserted = []
    mem.insertFailsAt = 2
    const broken = await post("variants")
    expect(broken.statusCode).toBe(500)
    expect(calls.erase).toEqual([])
    expect(mem.failed).toHaveLength(1)
  })

  it("an erased (Everyone) mark is always erased in a variant: sent as eraseAlways, never under keep", async () => {
    mem.data = draft([ERASED, slotMark("amy", 10), slotMark("ben", 40)])
    await post("variants")
    expect(calls.erase[0]!.body).toEqual({ maskUrl: RAW, erase: [box(10)], keep: [box(40)], eraseAlways: [box(80)], forcePrivate: true })
  })

  it("fails a variant whose erase ran on a worker that ignores keep (no keptRegions), never approving it", async () => {
    await post("variants")
    const amy = mem.data.faceMask!.variantJobs!.find((j) => j.emptySlots.join() === "amy")!
    setJob(amy.eraseJobId!, { status: "completed", output_data: { videoUrl: "https://out.test/e.mp4", frames: 360, coverage: 0.03, droppedRegions: 4, kept: true } })
    await post("variants/advance")
    expect(calls.make).toEqual([])
    expect(mem.data.faceMask!.variantJobs!.find((j) => j.jobId === amy.jobId)!.error?.message).toMatch(/does not keep faces/)
  })

  it("another admin's poll reads the steps as their owner: it never fails them and never pays the owner's fill; it may record a finished one", async () => {
    mem.data = draft([slotMark("amy", 10)])
    await post("variants")
    const job = mem.data.faceMask!.variantJobs![0]!
    setJob(job.eraseJobId!, { status: "completed", output_data: { videoUrl: "https://out.test/erased.mp4", frames: 360, coverage: 0.03, droppedRegions: 4, kept: true } })
    await post("variants/advance", ADMIN2)
    expect(calls.make).toEqual([])
    expect(mem.failed).toEqual([])
    expect(mem.data.faceMask!.variantJobs![0]!.error).toBeUndefined()
    // The owner asks the fill; once it is done, the other admin may record it (nothing to pay).
    await post("variants/advance")
    setJob(calls.make[0]!.id as string, { status: "completed", output_data: { maskedUrl: "https://out.test/v.mp4", frames: 360 } })
    await post("variants/advance", ADMIN2)
    expect(mem.data.faceMask!.variants).toHaveLength(1)
  })

  it("a variant finished by an advance whose save did not land is recorded from its job, not copied again", async () => {
    mem.data = draft([slotMark("amy", 10)])
    await post("variants")
    const job = mem.data.faceMask!.variantJobs![0]!
    setJob(job.eraseJobId!, { status: "completed", output_data: { videoUrl: "https://out.test/e.mp4", frames: 360, coverage: 0, droppedRegions: 2, kept: false } })
    mem.failSaves = 6 // every try of this advance's save loses
    expect((await post("variants/advance")).statusCode).toBe(409)
    expect(mem.completed).toHaveLength(1)
    expect(mem.data.faceMask!.variants).toBeUndefined()
    await post("variants/advance")
    expect(mem.data.faceMask!.variants).toEqual([expect.objectContaining({ emptySlots: ["amy"], jobId: job.jobId })])
    expect(mem.completed).toHaveLength(1)
    expect(mem.copies).toEqual([])
  })

  it("a draft save that changes the marks drops the variants no run can use and hands back the jobs to close", () => {
    const d = draft([slotMark("amy", 10), slotMark("ben", 40)])
    const record = { emptySlots: ["ben"], key: faceMaskVariantKey(d, ["ben"])!, jobId: "j-ben", eraseJobId: "e", startedAt: "t" }
    const stored = { ...d, faceMask: { ...d.faceMask!, variantJobs: [record] } }
    const edited = { ...stored, faceMasking: { ...MASKING, marks: [slotMark("amy", 10)] } }
    const { data, cleared, abandoned } = withMarksForSource(edited, stored)
    expect(cleared).toBe(false)
    expect(abandoned.map((j) => j.jobId)).toEqual(["j-ben"])
    expect(data.faceMask!.variantJobs).toBeUndefined()
  })
})

describe("second review fixes", () => {
  it("every advance restarts a followed person mask's idle clock (reconcile closes only one idle for a day)", async () => {
    mem.data = draft([slotMark("amy", 10)])
    await post("variants")
    const job = mem.data.faceMask!.variantJobs![0]!
    await post("variants/advance")
    await post("variants/advance", ADMIN2)
    expect(mem.touched).toEqual([job.jobId, job.jobId])
    expect(mem.jobs.get(job.jobId)!.started_at).toEqual(expect.any(String))
  })

  it("a draft save while the person masks briefly do not apply (an example, a 4th person, masking off) keeps the approved ones", () => {
    const d = draft([slotMark("amy", 10)])
    const variant = { emptySlots: ["amy"], key: faceMaskVariantKey(d, ["amy"])!, url: "https://cdn.test/v.mp4", frames: 360, jobId: "v", stats: { coverage: 0.01, erasedRegions: 1 }, approvedAt: "t" }
    const record = { emptySlots: ["amy"], key: "pv1:old", jobId: "j-old", eraseJobId: "e", startedAt: "t" }
    const stored = { ...d, faceMask: { ...d.faceMask!, variants: [variant], variantJobs: [record] } }
    const example = { videoUrl: SRC, width: 1, height: 1, durationSec: 12, sourceJobId: "j", slots: {} }
    const cat = { key: "cat", kind: "person" as const, label: { en: "Cat" }, required: false, roleName: "cat" }
    const dan = { key: "dan", kind: "person" as const, label: { en: "Dan" }, required: false, roleName: "dan" }
    const passing: TrendVersionData[] = [
      { ...stored, examples: [example] },
      { ...stored, slots: [...stored.slots, cat, dan], faceMasking: { ...MASKING, marks: [slotMark("amy", 10), slotMark("ben", 30), slotMark("cat", 50), slotMark("dan", 70)] } },
      { ...stored, faceMasking: { mode: "off", marks: [slotMark("amy", 10)] } },
    ]
    for (const edited of passing) {
      const { data, abandoned } = withMarksForSource(edited, stored)
      expect(data.faceMask!.variants).toEqual([variant])
      // Only the record for older marks goes (its job closed by the caller).
      expect(data.faceMask!.variantJobs).toBeUndefined()
      expect(abandoned.map((j) => j.jobId)).toEqual(["j-old"])
    }
    // Back as it was: the kept variant matches again.
    expect(faceMaskVariantKey(stored, ["amy"])).toBe(variant.key)
  })
})
