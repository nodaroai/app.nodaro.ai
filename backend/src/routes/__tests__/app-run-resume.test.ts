/**
 * POST /v1/app/:slug/runs/:runId/resume — an app run's Retry continues its failed execution
 * (decided 2026-10-18): only what the run did not complete runs, on the version it ran, with the
 * inputs it applied. Every refusal comes before anything is written or billed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  credits: false,
  queueAdd: vi.fn().mockResolvedValue({}),
  sources: new Map<string, Record<string, unknown>>(),
  inserts: [] as Array<{ row: Record<string, unknown>; key: string | null | undefined }>,
  created: true,
  runUpdates: [] as Array<{ row: Record<string, unknown>; filters: Record<string, unknown> }>,
  moved: true,
  execUpdates: [] as Array<Record<string, unknown>>,
  /** The app_runs table: one run, and the runner it belongs to. */
  run: null as Record<string, unknown> | null,
  versions: new Map<string, Record<string, unknown>>(),
  slugWorkflow: "wf-1" as string | null,
  eligibility: vi.fn(),
  price: vi.fn(),
  checkRunSet: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => mocks.credits,
}))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mocks.queueAdd } }))
vi.mock("@/lib/access-blocks.js", () => ({ isUserBlocked: vi.fn().mockResolvedValue(false) }))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkAppRunEligibility: mocks.eligibility },
  checkRunSetCredits: mocks.checkRunSet,
  estimateRunSetCredits: vi.fn().mockResolvedValue(0),
}))
vi.mock("@/ee/lib/app-run-resume-price.js", () => ({ appRunResumeCredits: mocks.price }))
vi.mock("@/lib/idempotent-insert.js", () => ({
  insertWithIdempotencyKey: vi.fn(async (_table: string, row: Record<string, unknown>, key: string | null | undefined) => {
    mocks.inserts.push({ row, key })
    return { row: { id: RETRY_EXEC }, created: mocks.created }
  }),
}))
vi.mock("@/services/workflow-engine/run-continuation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/workflow-engine/run-continuation.js")>()
  return { ...actual, loadContinuationSource: vi.fn(async (id: string) => mocks.sources.get(id) ?? null) }
})

import { appRunResumeRoutes } from "../app-run-resume.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const RUN = "00000000-0000-4000-8000-000000000040"
const RUN_EXEC = "00000000-0000-4000-8000-000000000030"
const EARLIER_EXEC = "00000000-0000-4000-8000-000000000029"
const RETRY_EXEC = "00000000-0000-4000-8000-000000000031"
const V1 = "00000000-0000-4000-8000-000000000010"
const V2 = "00000000-0000-4000-8000-000000000011"

const snapshot = {
  snapshot_nodes: [
    { id: "prompt", type: "text-prompt", data: { text: "a cat" } },
    { id: "img", type: "generate-image", data: { label: "Picture" } },
    { id: "vid", type: "image-to-video", data: {} },
    { id: "join", type: "combine-videos", data: {} },
  ],
  snapshot_edges: [
    { source: "prompt", target: "img", targetHandle: "prompt" },
    { source: "img", target: "vid", targetHandle: "image" },
    { source: "vid", target: "join", targetHandle: "videos" },
  ],
  snapshot_settings: {},
}
const version = (id: string, n: number, over: Record<string, unknown> = {}) => ({
  id, workflow_id: "wf-1", creator_id: "creator-1", publish_type: "app", version: n,
  monetization_enabled: true, monetization_flat_fee: 5, monetization_percent: 20, ...snapshot, ...over,
})

/** The run's execution: the picture made, the video failed, the join never ran. */
const failedStates = {
  prompt: { status: "completed", output: { text: "a cat" }, fromSavedData: true },
  img: { status: "completed", output: { imageUrl: "https://r2/img.png" }, startedAt: "t" },
  vid: { status: "failed", error: "provider down", startedAt: "t" },
  join: { status: "skipped" },
}
const source = (over: Record<string, unknown> = {}) => ({
  id: RUN_EXEC, userId: USER, workflowId: "wf-1", status: "failed", appVersionId: V1, startedAt: "t",
  inputOverrides: { prompt: { text: "a cat" } }, nodeStates: failedStates, runRoot: null, continueFromFailed: null, resumedFrom: null, ...over,
})

function chain(table: string) {
  const filters: Record<string, unknown> = {}
  let update: Record<string, unknown> | null = null
  const resolve = () => {
    if (table === "app_runs") {
      if (update) {
        mocks.runUpdates.push({ row: update, filters: { ...filters } })
        return { data: mocks.moved ? { id: RUN } : null, error: null }
      }
      const run = mocks.run
      return { data: run && run.id === filters.id && run.runner_id === filters.runner_id ? run : null, error: null }
    }
    if (table === "published_apps") {
      if (filters.slug !== undefined) return { data: mocks.slugWorkflow ? { workflow_id: mocks.slugWorkflow } : null, error: null }
      if (filters.id !== undefined) return { data: mocks.versions.get(filters.id as string) ?? null, error: null }
      // The app's latest version: the highest of its versions.
      const latest = [...mocks.versions.values()].filter((v) => v.workflow_id === filters.workflow_id).sort((a, b) => (b.version as number) - (a.version as number))[0]
      return { data: latest ? { version: latest.version } : null, error: null }
    }
    if (table === "workflow_executions" && update) {
      mocks.execUpdates.push(update)
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }
  const self: Record<string, unknown> = {}
  for (const m of ["select", "is", "in", "limit", "order"]) self[m] = () => self
  self.eq = (c: string, v: unknown) => ((filters[c] = v), self)
  self.update = (row: Record<string, unknown>) => ((update = row), self)
  self.maybeSingle = async () => resolve()
  self.single = async () => resolve()
  self.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ko)
  return self
}

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.credits = false
  mocks.created = true
  mocks.moved = true
  mocks.inserts.length = 0
  mocks.runUpdates.length = 0
  mocks.execUpdates.length = 0
  mocks.sources.clear()
  mocks.sources.set(RUN_EXEC, source())
  mocks.run = { id: RUN, app_id: V1, execution_id: RUN_EXEC, runner_id: USER }
  mocks.versions.clear()
  mocks.versions.set(V1, version(V1, 1))
  mocks.slugWorkflow = "wf-1"
  mocks.eligibility.mockResolvedValue({ allowed: true })
  vi.mocked(supabase.from).mockImplementation(((table: string) => chain(table)) as never)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const id = req.headers["x-user-id"]
    if (typeof id === "string") {
      req.userId = id
      ;(req as unknown as { authKind: string }).authKind = "jwt"
    }
  })
  await app.register(appRunResumeRoutes)
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

const post = (payload: Record<string, unknown> = { reviewer: "app" }, user: string | null = USER) =>
  app.inject({ method: "POST", url: `/v1/app/my-app/runs/${RUN}/resume`, payload, headers: user ? { "x-user-id": user } : {} })

const nothingWritten = () => {
  expect(mocks.inserts).toHaveLength(0)
  expect(mocks.runUpdates).toHaveLength(0)
  expect(mocks.queueAdd).not.toHaveBeenCalled()
}

describe("POST /v1/app/:slug/runs/:runId/resume", () => {
  it("401 without a user", async () => {
    expect((await post({}, null)).statusCode).toBe(401)
    nothingWritten()
  })

  it("continues the failed run: only what it did not complete runs, on its version, with its own inputs", async () => {
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ executionId: RETRY_EXEC, runId: RUN, nodeIds: ["vid", "join"] })
    // One Retry per execution the run points at; stamped with the run and what it continues.
    expect(mocks.inserts).toHaveLength(1)
    expect(mocks.inserts[0]!.key).toBe(`app-run-resume:${RUN_EXEC}`)
    expect(mocks.inserts[0]!.row).toMatchObject({ user_id: USER, status: "pending", trigger_type: "app_run", trigger_data: { appRun: { appRunId: RUN, resumedFrom: RUN_EXEC } } })
    // The run's pointer moves to it, only if it still points at the failed execution.
    expect(mocks.runUpdates).toEqual([{ row: { execution_id: RETRY_EXEC, status: "running" }, filters: expect.objectContaining({ id: RUN, runner_id: USER, execution_id: RUN_EXEC }) }])
    const [, jobData] = mocks.queueAdd.mock.calls[0]!
    expect(jobData).toMatchObject({
      executionId: RETRY_EXEC, userId: USER, triggerType: "app_run", appVersionId: V1, nodeIds: ["vid", "join"],
      continueFromExecutionId: RUN_EXEC, continueMode: "from-failed", appRunResume: true, reviewerPresent: true,
    })
    // The inputs are the run's own pin, re-applied by the worker: none are sent.
    expect(jobData).not.toHaveProperty("inputOverrides")
  })

  it("dryRun: the steps it would run and nothing created", async () => {
    const res = await post({ dryRun: true, reviewer: "app" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({
      runId: RUN, continuesExecutionId: RUN_EXEC, appVersion: 1, nodeIds: ["vid", "join"],
      steps: [{ nodeId: "vid", type: "image-to-video", label: null }, { nodeId: "join", type: "combine-videos", label: null }],
      estimatedCredits: null,
    })
    nothingWritten()
  })

  it("another user's run cannot be resumed: it reads as missing", async () => {
    expect((await post({ reviewer: "app" }, OTHER)).statusCode).toBe(404)
    nothingWritten()
    // Even a run row the caller holds whose execution is someone else's: missing too.
    mocks.sources.set(RUN_EXEC, source({ userId: OTHER }))
    const res = await post()
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("continuation_not_found")
    nothingWritten()
  })

  it("the app version the run ran is gone: refused with its code, nothing created (start over)", async () => {
    mocks.versions.delete(V1)
    mocks.versions.set(V2, version(V2, 2))
    const res = await post()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("app_run_version_unavailable")
    nothingWritten()
  })

  it("the app changed since the run (a newer version, or the runner's pick of another): refused, nothing created (start over)", async () => {
    mocks.versions.set(V2, version(V2, 2, { snapshot_nodes: [{ id: "other", type: "generate-image", data: {} }] }))
    const res = await post()
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: { code: "app_run_version_changed" }, runVersion: 1, appVersion: 2 })
    nothingWritten()
    // The runner's pick names another version: the same refusal.
    mocks.versions.delete(V2)
    const picked = await post({ reviewer: "app", version: 3 })
    expect(picked.statusCode).toBe(409)
    expect(picked.json().error.code).toBe("app_run_version_changed")
    nothingWritten()
  })

  it("naming the run's own version continues it there, newer versions or not", async () => {
    mocks.versions.set(V2, version(V2, 2))
    const res = await post({ reviewer: "app", version: 1 })
    expect(res.statusCode).toBe(202)
    expect(mocks.queueAdd.mock.calls[0]![1]).toMatchObject({ appVersionId: V1, nodeIds: ["vid", "join"] })
  })

  it("a run that did not fail (cancelled, completed) or is still running is not continued", async () => {
    for (const status of ["cancelled", "completed"]) {
      mocks.sources.set(RUN_EXEC, source({ status }))
      const res = await post()
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("continuation_not_failed")
    }
    mocks.sources.set(RUN_EXEC, source({ status: "running" }))
    const running = await post()
    expect(running.statusCode).toBe(409)
    expect(running.json().error.code).toBe("already_running")
    nothingWritten()
  })

  it("a double press is one Retry: the second answers the same execution and enqueues nothing", async () => {
    mocks.created = false
    const res = await post()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ executionId: RETRY_EXEC, deduped: true })
    expect(mocks.queueAdd).not.toHaveBeenCalled()
    expect(mocks.runUpdates).toHaveLength(0)
  })

  it("the run moved on meanwhile: the Retry's execution is cancelled, nothing enqueued", async () => {
    mocks.moved = false
    const res = await post()
    expect(res.statusCode).toBe(409)
    expect(mocks.execUpdates).toEqual([expect.objectContaining({ status: "cancelled" })])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("a Retry refused before it started holds nothing: the next continues what it continued", async () => {
    mocks.sources.set(RUN_EXEC, source({ startedAt: null, nodeStates: {}, resumedFrom: EARLIER_EXEC }))
    mocks.sources.set(EARLIER_EXEC, source({ id: EARLIER_EXEC }))
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(mocks.queueAdd.mock.calls[0]![1]).toMatchObject({ continueFromExecutionId: EARLIER_EXEC, nodeIds: ["vid", "join"] })
    // Keyed by what the run points at now, so it is not the refused Retry's key.
    expect(mocks.inserts[0]!.key).toBe(`app-run-resume:${RUN_EXEC}`)
  })

  it("nothing left to run: 409, nothing created", async () => {
    mocks.sources.set(RUN_EXEC, source({ nodeStates: { ...failedStates, vid: { status: "completed", output: {} }, join: { status: "completed", output: {} } } }))
    const res = await post()
    expect(res.statusCode).toBe(409)
    nothingWritten()
  })

  describe("priced (Nodaro Cloud)", () => {
    beforeEach(() => {
      mocks.credits = true
      mocks.price.mockResolvedValue({ credits: 100, hold: 160, reusedClips: 2 })
      mocks.checkRunSet.mockResolvedValue({ sufficient: true, required: 185, available: 900 })
    })

    it("the price is what it runs plus the creator's markup; the balance is checked against its hold", async () => {
      const res = await post({ dryRun: true, reviewer: "app" })
      // 100 + (5 + ceil(100 * 20%)) = 125
      expect(res.json().data).toMatchObject({ estimatedCredits: 125, reusedClips: 2, sufficient: true, available: 900 })
      expect(mocks.checkRunSet).toHaveBeenCalledWith(USER, 185, expect.anything())
      // Priced on the run set, keyed by the run's chain root (its first execution here).
      expect(mocks.price.mock.calls[0]![0]).toMatchObject({ runKey: RUN_EXEC })
      expect([...(mocks.price.mock.calls[0]![0] as { runNodeIds: Set<string> }).runNodeIds]).toEqual(["vid", "join"])
    })

    it("the creator's own run carries no markup", async () => {
      mocks.versions.set(V1, version(V1, 1, { creator_id: USER }))
      const res = await post({ dryRun: true, reviewer: "app" })
      expect(res.json().data.estimatedCredits).toBe(100)
    })

    it("dryRun: app credits the real call would refuse make the quote not sufficient, and say so; nothing created", async () => {
      mocks.eligibility.mockResolvedValue({ allowed: false, error: "You need app credits to run this app.", appCreditsAllowance: 0 })
      const res = await post({ dryRun: true, reviewer: "app" })
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toMatchObject({ estimatedCredits: 125, sufficient: false, available: 900, appCreditsAllowance: 0 })
      expect(mocks.eligibility).toHaveBeenCalledWith(USER)
      nothingWritten()
    })

    it("dryRun: app credits that allow it add nothing to the quote", async () => {
      mocks.eligibility.mockResolvedValue({ allowed: true, appCreditsAllowance: 40 })
      const res = await post({ dryRun: true, reviewer: "app" })
      expect(res.json().data.sufficient).toBe(true)
      expect(res.json().data).not.toHaveProperty("appCreditsAllowance")
    })

    it("a balance below the hold: 402 before anything is created", async () => {
      mocks.checkRunSet.mockResolvedValue({ sufficient: false, required: 185, available: 50 })
      const res = await post()
      expect(res.statusCode).toBe(402)
      nothingWritten()
    })
  })
})
