/**
 * The five UGC nodes on the orchestrator's sync-HTTP lane, end to end through
 * `executeNode`: the real body, the lane's own headers, the `node_id` stamp and
 * the poll of the job a route starts, the output read from the finished job, a
 * kept result that makes no call, and a deployment without the UGC routes.
 *
 * Every external dependency is stubbed (config, supabase, credits, BullMQ, the
 * loopback fetch); the payload builder and the output extractor are the real
 * ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SimpleNode } from "../types.js"

const { mockJobInsert, mockQueueAdd, mockReserveCredits, fetchMock, rows, rowsById, updates, selects } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockReserveCredits: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1 }),
  fetchMock: vi.fn(),
  /** What each `select(...).eq(...).single()` read answers, in order (the node_id stamp read, then the poll). */
  rows: [] as Array<Record<string, unknown>>,
  /** A job's row by its id, read by every `eq("id", …)` select ahead of the queue (jobs polled side by side). */
  rowsById: new Map<string, Record<string, unknown>>(),
  /** Every `update(...)` payload, in order (the job stamp). */
  updates: [] as Array<Record<string, unknown>>,
  /** Every `select(...)` column list, in order. */
  selects: [] as string[],
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000, INTERNAL_ORCHESTRATOR_SECRET: "test-orchestrator-secret" },
  hasCredits: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockJobInsert }) }),
        update: vi.fn((patch: Record<string, unknown>) => { updates.push(patch); return { eq: eqFn } }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        select: vi.fn((columns: string) => {
          selects.push(columns)
          return {
            eq: vi.fn((column: string, value: unknown) => ({
              single: vi.fn(async () => {
                const byId = column === "id" && typeof value === "string" ? rowsById.get(value) : undefined
                return { data: byId ?? rows.shift() ?? null, error: null }
              }),
            })),
          }
        }),
      }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../loopback-fetch.js", () => ({ loopbackFetch: fetchMock }))

import { executeNode } from "../node-executor.js"
import { syncHttpIdempotencyKey } from "../idempotency-key.js"

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })
const ctx = (isAppRun = false, extra: Record<string, unknown> = {}) => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  billingContext: { payer: "user", userId: "user-1" },
  cancelled: false,
  isAppRun,
  onJobCreated: vi.fn(),
  ...extra,
}) as never
const run = (node: SimpleNode, inputs: Record<string, unknown>, c = ctx(), iterationIndex?: number) => executeNode(node, inputs as never, [], [node], {}, c, iterationIndex)
/** The lane's read of a job a UGC route just started: not yet stamped by any run, not finished. */
const STAMP_ROW = { input_data: {}, workflow_execution_id: null, status: "pending" }
const bodyOf = (call: number) => JSON.parse((fetchMock.mock.calls[call]![1] as { body: string }).body) as Record<string, unknown>

beforeEach(() => {
  rowsById.clear()
})

describe("the UGC nodes on the sync-HTTP lane", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    rows.length = 0
    updates.length = 0
    selects.length = 0
  })

  it("ugc-script posts with the orchestrator's headers, stamps node_id, polls, and outputs the plan wire", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-s" }))
    rows.push(STAMP_ROW, { status: "completed", output_data: { plan: { hook: "h" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 }, credits_actual: 20 })
    const r = await run({ id: "script", type: "ugc-script", data: { label: "s", targetDurationSec: 15 } }, { ugc: { site: "Acme" } }, ctx(true))
    const [url, init] = fetchMock.mock.calls[0]! as [string, { headers: Record<string, string>; body: string }]
    expect(url).toMatch(/\/v1\/ugc\/script$/)
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).toContain("x-app-run")
    expect(JSON.parse(init.body)).toMatchObject({ site: "Acme", userId: "user-1" })
    expect(JSON.parse(r.output.ugcOutputs!.plan!)).toEqual({ v: 1, hook: "h" })
    expect(r.output.ugcResult).toEqual({ plan: { hook: "h" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 })
    expect(r.creditsUsed).toBe(20)
  })

  it("a kept script makes no call at all", async () => {
    const r = await run({ id: "script", type: "ugc-script", data: { label: "s", keepResult: true, result: { plan: { hook: "kept" }, productCategory: "saas" } } }, {})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.parse(r.output.ugcOutputs!.plan!)).toEqual({ v: 1, hook: "kept" })
  })

  it("this run's single ticket wins over the node's saved two-ticket list", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { errors: [], tickets: [{ v: 1, index: 0, durationSec: 12 }], sizedPlan: {}, transcript: "a", hasCards: false }))
    const node = { id: "clips", type: "ugc-clips", data: { label: "c", __listResults: ["old-0", "old-1"] } }
    const r = await run(node, { ugc: { plan: JSON.stringify({ v: 1 }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"] }) } })
    expect(r.output.listResults).toHaveLength(1)
  })

  it.each(["ugc-creator", "ugc-script", "ugc-clips", "ugc-clip", "ugc-cards"])("%s: a router 404 fails with the Cloud sentence and reserves nothing", async (type) => {
    fetchMock.mockResolvedValue(reply(404, { message: "Route not found" }))
    const inputs = { ugc: { site: "Acme", plan: JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"] }), clip: JSON.stringify({ v: 1, index: 0, durationSec: 12 }), category: "saas", video: "https://cdn.example/v.mp4", transcript: "a" } }
    await expect(run({ id: "n", type, data: { label: "n", source: "sampled", gender: "woman", rerender: {} } }, inputs)).rejects.toThrow("UGC videos are a Nodaro Cloud feature and are not served on this deployment.")
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockJobInsert).not.toHaveBeenCalled()
  })

  it("a 422 minor_age_refused reads as the app's adult-only sentence", async () => {
    fetchMock.mockResolvedValueOnce(reply(422, { error: { code: "minor_age_refused", message: "Creator age must be an adult age (20 or older)." } }))
    await expect(run({ id: "creator", type: "ugc-creator", data: { label: "c", source: "sampled", gender: "woman" } }, { ugc: { category: "saas" } }))
      .rejects.toThrow("That age can't be used: UGC creators are adults only.")
  })

  it("a fanned-out ugc-clip iteration posts { ticket, nonce, userId } and outputs its video, length and warnings", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-c" }))
    rows.push(STAMP_ROW, { status: "completed", output_data: { videoUrl: "https://cdn.example/c.mp4", durationSec: 13, clipWarnings: ["clip_lengthened:13"], frameCheck: { passed: true, rerendered: false } } })
    const r = await run({ id: "clip", type: "ugc-clip", data: { label: "c", rerender: {} } }, { ugc: { clip: JSON.stringify({ v: 1, index: 0, durationSec: 12 }) } })
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ ticket: { v: 1, index: 0, durationSec: 12 }, nonce: 0, userId: "user-1" })
    expect(r.output).toMatchObject({ videoUrl: "https://cdn.example/c.mp4", durationSec: 13, clipWarnings: ["clip_lengthened:13"] })
  })
})

describe("the UGC nodes on the sync-HTTP lane: the remaining rules", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    rows.length = 0
    updates.length = 0
    selects.length = 0
  })

  it("a kept creator makes no call and hands on its record and image", async () => {
    const record = { v: 1, kind: "sampled", gender: "woman", identityImages: ["https://cdn.example/kept.png"] }
    const r = await run({ id: "creator", type: "ugc-creator", data: { label: "c", source: "sampled", gender: "woman", keepResult: true, result: record } }, {})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.output).toEqual({ ugcOutputs: { creator: JSON.stringify(record), image: "https://cdn.example/kept.png" }, imageUrl: "https://cdn.example/kept.png" })
    expect(r.creditsUsed).toBeUndefined()
  })

  it("a kept creator whose options wait for a pick is not kept: the node goes to its route", async () => {
    fetchMock.mockResolvedValue(reply(404, {}))
    const record = { v: 1, gender: "woman", identityImages: ["https://cdn.example/kept.png"] }
    const data = { label: "c", source: "sampled", gender: "woman", keepResult: true, result: record, candidates: [{ imageUrl: "https://cdn.example/a.png", record }] }
    await expect(run({ id: "creator", type: "ugc-creator", data }, { ugc: { category: "saas" } })).rejects.toThrow("UGC videos are a Nodaro Cloud feature")
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/v1\/ugc\/creator$/)
  })

  it("the lane's headers ride every UGC call: the orchestrator secret and the user", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { errors: [], tickets: [{ v: 1, index: 0, durationSec: 12 }], sizedPlan: {}, transcript: "a" }))
    await run({ id: "clips", type: "ugc-clips", data: { label: "c" } }, { ugc: { plan: JSON.stringify({ v: 1 }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"] }) } })
    const headers = (fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    expect(lower["x-internal-orchestrator-secret"]).toBe("test-orchestrator-secret")
    expect(lower["x-internal-user-id"]).toBe("user-1")
    expect(lower["x-app-run"]).toBeUndefined()
  })

  it("UGC Clips' answer is its output: the clips, plan-out and transcript, and this run's tickets", async () => {
    const tickets = [{ v: 1, index: 0, durationSec: 12 }, { v: 1, index: 1, durationSec: 9 }]
    fetchMock.mockResolvedValueOnce(reply(200, { errors: [], tickets, sizedPlan: { hook: "h" }, transcript: "a b", hasCards: true }))
    const r = await run({ id: "clips", type: "ugc-clips", data: { label: "c" } }, { ugc: { plan: JSON.stringify({ v: 1 }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"] }) } })
    expect(r.output).toEqual({
      ugcOutputs: { clips: JSON.stringify(tickets[0]), "plan-out": JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {} }), transcript: "a b" },
      listResults: tickets.map((t) => JSON.stringify(t)),
    })
    expect(r.creditsUsed).toBeUndefined()
    expect(rows).toEqual([])
  })

  it("UGC Clips' answer asking for script changes fails the node with them", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { errors: [{ message: "Too long.", fix: "Trim it." }], warnings: [] }))
    await expect(run({ id: "clips", type: "ugc-clips", data: { label: "c" } }, { ugc: { plan: JSON.stringify({ v: 1 }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"] }) } }))
      .rejects.toThrow("The script needs changes: Too long. Trim it.")
  })

  it("a missing input fails the node before any call", async () => {
    await expect(run({ id: "script", type: "ugc-script", data: { label: "s" } }, {})).rejects.toThrow("Add the product name or website.")
    await expect(run({ id: "clip", type: "ugc-clip", data: { label: "c", rerender: {} } }, {})).rejects.toThrow("Connect the Clips output of UGC Clips.")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("an app run's clip names the run, so each app run renders its own clip", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-c" }))
    rows.push(STAMP_ROW, { status: "completed", output_data: { videoUrl: "https://cdn.example/c.mp4", durationSec: 12, clipWarnings: [] } })
    await run({ id: "clip", type: "ugc-clip", data: { label: "c", rerender: { "2": 1 } } }, { ugc: { clip: JSON.stringify({ v: 1, index: 1, durationSec: 12 }) } }, ctx(true))
    expect(bodyOf(0)).toEqual({ ticket: { v: 1, index: 1, durationSec: 12 }, nonce: 1, runKey: "exec-1", userId: "user-1" })
  })

  it("a clip job that finished without a video fails the node instead of handing on nothing", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-c" }))
    rows.push(STAMP_ROW, { status: "completed", output_data: { durationSec: 12, clipWarnings: [] } })
    await expect(run({ id: "clip", type: "ugc-clip", data: { label: "c", rerender: {} } }, { ugc: { clip: JSON.stringify({ v: 1, index: 0, durationSec: 12 }) } }))
      .rejects.toThrow(/completed but produced no output/)
  })

  it("a script job that finished without a plan fails the node instead of handing on nothing", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-s" }))
    rows.push(STAMP_ROW, { status: "completed", output_data: { productCategory: "saas" }, credits_actual: 20 })
    await expect(run({ id: "script", type: "ugc-script", data: { label: "s" } }, { ugc: { site: "Acme" } })).rejects.toThrow(/completed but produced no output/)
  })

  it("a route's own failure keeps its message; a server error never shows its internals", async () => {
    fetchMock.mockResolvedValueOnce(reply(402, { error: { code: "insufficient_credits", message: "Not enough credits." } }))
    await expect(run({ id: "script", type: "ugc-script", data: { label: "s" } }, { ugc: { site: "Acme" } })).rejects.toThrow("Not enough credits.")
    fetchMock.mockResolvedValueOnce(reply(500, { error: { message: "stack trace here" } }))
    await expect(run({ id: "script", type: "ugc-script", data: { label: "s" } }, { ugc: { site: "Acme" } })).rejects.toThrow("UGC step failed (500)")
  })

  it("another sync-HTTP node's router 404 reads as the generic not-available sentence", async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { message: "Route POST:/v1/qa-check not found", error: "Not Found", statusCode: 404 }))
    await expect(run({ id: "q", type: "qa-check", data: { label: "q", content: "x" } }, {})).rejects.toThrow(
      /^This step is not available on this deployment \(404\)\.$/,
    )
  })

  it("another sync-HTTP node's 502 shows the route's sentence, never its raw JSON body", async () => {
    const body = { error: { code: "llm_error", message: "The model could not answer right now." }, debug: { upstream: "secret-upstream-value" } }
    fetchMock.mockResolvedValueOnce(reply(502, body))
    const err = await run({ id: "q", type: "qa-check", data: { label: "q", content: "x" } }, {}).catch((e: unknown) => e) as Error & { internalDetails?: string; status?: number }
    expect(err.message).toBe("The model could not answer right now.")
    expect(err.message).not.toContain("{")
    expect(err.message).not.toContain("secret-upstream-value")
    expect(err.status).toBe(502)
    expect(err.internalDetails).toContain("secret-upstream-value")
  })

  it("another sync-HTTP node's 502 whose message is itself raw JSON falls back to the generic sentence", async () => {
    fetchMock.mockResolvedValueOnce(reply(502, { error: 'Provider failed: {"code":500,"msg":"upstream exploded","taskId":"t-1"}' }))
    const err = await run({ id: "q", type: "qa-check", data: { label: "q", content: "x" } }, {}).catch((e: unknown) => e) as Error
    expect(err.message).toBe("This step failed on the server (502). Try again in a moment.")
    expect(err.message).not.toContain("upstream exploded")
  })
})

describe("the UGC jobs a run owns: resume, cancel, progress, and the charge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    rows.length = 0
    updates.length = 0
    selects.length = 0
  })
  const SCRIPT = { id: "script", type: "ugc-script", data: { label: "s", targetDurationSec: 15 } }
  const SCRIPT_INPUTS = { ugc: { site: "Acme" } }
  const SCRIPT_ROW = { status: "completed", output_data: { plan: { hook: "h" }, productCategory: "saas" }, credits_actual: 20 }
  const CLIP = { id: "clip", type: "ugc-clip", data: { label: "c", rerender: {} } }
  const CLIP_INPUTS = { ugc: { clip: JSON.stringify({ v: 1, index: 0, durationSec: 12 }) } }
  const CLIP_ROW = { status: "completed", output_data: { videoUrl: "https://cdn.example/c.mp4", durationSec: 12, clipWarnings: [] }, credits_actual: 412 }
  const idempotencyKeyOf = (call: number) => {
    const headers = (fetchMock.mock.calls[call]![1] as { headers: Record<string, string> }).headers
    return Object.entries(headers).find(([k]) => k.toLowerCase() === "idempotency-key")?.[1]
  }

  it("a started job is stamped with this run and its node, and registered with the run before it is polled", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-s" }))
    rows.push(STAMP_ROW, { ...SCRIPT_ROW, progress: 100 })
    const c = ctx(false, { onJobProgress: vi.fn() }) as unknown as { onJobCreated: ReturnType<typeof vi.fn>; onJobProgress: ReturnType<typeof vi.fn> }
    const r = await run(SCRIPT, SCRIPT_INPUTS, c as never)
    // What a run's cancel and a resume select the execution's jobs by.
    expect(updates).toEqual([{ input_data: { node_id: "script" }, workflow_execution_id: "exec-1" }])
    expect(selects[0]).toBe("input_data, workflow_execution_id, status")
    // The run maps the job to the node: its job link, and the progress the poll reports.
    expect(c.onJobCreated).toHaveBeenCalledWith("script", "job-s")
    expect(c.onJobProgress).toHaveBeenCalledWith("job-s", 100, false)
    expect(c.onJobCreated.mock.invocationCallOrder[0]!).toBeLessThan(c.onJobProgress.mock.invocationCallOrder[0]!)
    expect(r.creditsUsed).toBe(20)
  })

  it("a fan-out iteration's job also names its iteration, so a resume reuses a finished one", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-c" }))
    rows.push(STAMP_ROW, CLIP_ROW)
    await run(CLIP, CLIP_INPUTS, ctx(), 2)
    expect(updates).toEqual([{ input_data: { node_id: "clip", iterationIndex: 2 }, workflow_execution_id: "exec-1" }])
  })

  it("every UGC call carries the run's own key for the node and its iteration", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-s" }))
    rows.push(STAMP_ROW, SCRIPT_ROW)
    await run(SCRIPT, SCRIPT_INPUTS)
    expect(idempotencyKeyOf(0)).toBe(syncHttpIdempotencyKey("exec-1", "script"))
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-c" }))
    rows.push(STAMP_ROW, CLIP_ROW)
    await run(CLIP, CLIP_INPUTS, ctx(), 2)
    expect(idempotencyKeyOf(1)).toBe(syncHttpIdempotencyKey("exec-1", "clip", 2))
    fetchMock.mockResolvedValueOnce(reply(200, { errors: [], tickets: [{ v: 1, index: 0, durationSec: 12 }], sizedPlan: {}, transcript: "a" }))
    await run({ id: "clips", type: "ugc-clips", data: { label: "c" } }, { ugc: { plan: JSON.stringify({ v: 1 }), creator: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"] }) } })
    expect(idempotencyKeyOf(2)).toBe(syncHttpIdempotencyKey("exec-1", "clips"))
  })

  it("a resumed run adopts the job its earlier attempt started: no second call, the same job polled", async () => {
    const adoptableJobs = new Map([["script", { jobId: "job-old", usageLogId: "u-9", creditsReserved: 20 }]])
    rows.push(SCRIPT_ROW)
    const c = ctx(false, { adoptableJobs }) as unknown as { onJobCreated: ReturnType<typeof vi.fn> }
    const r = await run(SCRIPT, SCRIPT_INPUTS, c as never)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(c.onJobCreated).toHaveBeenCalledWith("script", "job-old")
    expect(adoptableJobs.has("script")).toBe(false)
    expect(JSON.parse(r.output.ugcOutputs!.plan!)).toEqual({ v: 1, hook: "h" })
    expect(r.creditsUsed).toBe(20)
  })

  it("an adopted clip reports the charge its row settled, never its reservation (the route's ceiling)", async () => {
    const adoptableJobs = new Map([["clip", { jobId: "job-old", usageLogId: "u-9", creditsReserved: 1200, clocks: { dispatchedAtMs: Date.now() - 60_000, processingStartedAtMs: Date.now() - 50_000 } }]])
    rows.push(CLIP_ROW)
    const r = await run(CLIP, CLIP_INPUTS, ctx(false, { adoptableJobs }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.output.videoUrl).toBe("https://cdn.example/c.mp4")
    expect(r.creditsUsed).toBe(412)
  })

  it("a fan-out iteration is never adopted: it posts its ticket", async () => {
    const adoptableJobs = new Map([["clip", { jobId: "job-old" }]])
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-c" }))
    rows.push(STAMP_ROW, CLIP_ROW)
    await run(CLIP, CLIP_INPUTS, ctx(false, { adoptableJobs }), 0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(adoptableJobs.has("clip")).toBe(true)
  })

  it("an editor run that gets back a clip another run already finished hands it on, counts no charge and re-stamps nothing", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-prev" }))
    rows.push({ input_data: { clip: 1 }, workflow_execution_id: null, status: "completed" }, CLIP_ROW)
    const c = ctx() as unknown as { onJobCreated: ReturnType<typeof vi.fn> }
    const r = await run(CLIP, CLIP_INPUTS, c as never)
    expect(r.output.videoUrl).toBe("https://cdn.example/c.mp4")
    expect(r.creditsUsed).toBeUndefined()
    expect(updates).toEqual([])
    expect(c.onJobCreated).toHaveBeenCalledWith("clip", "job-prev")
  })

  it("a clip another run is still rendering is that run's: not re-stamped, not counted here", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-other" }))
    rows.push({ input_data: { node_id: "clip" }, workflow_execution_id: "exec-0", status: "processing" }, CLIP_ROW)
    const r = await run(CLIP, CLIP_INPUTS)
    expect(r.creditsUsed).toBeUndefined()
    expect(updates).toEqual([])
  })

  it("a job this run stamped on an earlier attempt is still this run's", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { jobId: "job-c" }))
    rows.push({ input_data: { node_id: "clip" }, workflow_execution_id: "exec-1", status: "completed" }, CLIP_ROW)
    const r = await run(CLIP, CLIP_INPUTS)
    expect(r.creditsUsed).toBe(412)
    expect(updates).toEqual([{ input_data: { node_id: "clip" }, workflow_execution_id: "exec-1" }])
  })
})

describe("UGC Creator and UGC Cards on the lane: their own calls, end to end", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    rows.length = 0
    updates.length = 0
    selects.length = 0
  })
  type Init = { method: string; headers: Record<string, string>; body?: string }
  const callAt = (i: number) => fetchMock.mock.calls[i]! as [string, Init]
  const pathOf = (i: number) => String(callAt(i)[0]).replace(/^.*?(\/v1\/)/, "$1")
  const lowered = (init: Init) => Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]))
  const keyAt = (i: number) => lowered(callAt(i)[1])["idempotency-key"]

  it("ugc-cards: the categories preflight names the user in x-internal-user-id, and a 200 leads on to both timing jobs", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { categories: [] }))     // GET /v1/ugc/categories
      .mockResolvedValueOnce(reply(200, { jobId: "al-1" }))      // POST /v1/forced-alignment
      .mockResolvedValueOnce(reply(200, { jobId: "tr-1" }))      // POST /v1/transcribe
      .mockResolvedValueOnce(reply(200, { layerPlan: [], captionTiming: null, report: { lines: ["No issues."] } }))
    rowsById.set("al-1", { status: "completed", output_data: { alignment: [], text: "a" }, credits_actual: 30 })
    rowsById.set("tr-1", { status: "completed", output_data: { json: { words: [] } }, credits_actual: 22 })
    const inputs = { ugc: { plan: JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} }), video: "https://cdn.example/v.mp4", transcript: "a" }, clipNotes: [] }
    const r = await run({ id: "cards", type: "ugc-cards", data: { label: "c" } }, inputs)
    const [url0, init0] = callAt(0)
    expect(url0).toMatch(/\/v1\/ugc\/categories$/)
    expect(init0.method).toBe("GET")
    expect(init0.body).toBeUndefined()
    const lower = lowered(init0)
    expect(lower["x-internal-user-id"]).toBe("user-1")
    expect(lower["x-internal-orchestrator-secret"]).toBeDefined()
    expect(lower["content-type"]).toBeUndefined()
    // One user header, never two spellings of it (fetch would join them into "user-1, user-1").
    expect(Object.keys(init0.headers).filter((k) => k.toLowerCase() === "x-internal-user-id")).toHaveLength(1)
    const paths = [1, 2].map(pathOf).sort()
    expect(paths).toEqual(["/v1/forced-alignment", "/v1/transcribe"])
    expect(String(callAt(3)[0])).toMatch(/\/v1\/ugc\/cards$/)
    expect(r.creditsUsed).toBe(52)
    expect(Object.keys(r.output.ugcOutputs ?? {}).sort()).toEqual(["captionPlan", "layerPlan", "report"])
  })

  it("ugc-cards: each timing job has a key of its own; the cards call keeps the node's key", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { categories: [] }))
      .mockResolvedValueOnce(reply(200, { jobId: "al-1" }))
      .mockResolvedValueOnce(reply(200, { jobId: "tr-1" }))
      .mockResolvedValueOnce(reply(200, { layerPlan: [], captionTiming: null, report: { lines: [] } }))
    rowsById.set("al-1", { status: "completed", output_data: { alignment: [] }, credits_actual: 30 })
    rowsById.set("tr-1", { status: "completed", output_data: { json: { words: [] } }, credits_actual: 22 })
    const inputs = { ugc: { plan: JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} }), video: "https://cdn.example/v.mp4", transcript: "a" }, clipNotes: [] }
    await run({ id: "cards", type: "ugc-cards", data: { label: "c" } }, inputs)
    expect(keyAt(0)).toBeUndefined()
    const timing = [1, 2].map(keyAt)
    expect(new Set(timing).size).toBe(2)
    for (const key of timing) expect(key!.startsWith(`${syncHttpIdempotencyKey("exec-1", "cards")}:`)).toBe(true)
    expect(keyAt(3)).toBe(syncHttpIdempotencyKey("exec-1", "cards"))
  })

  const IMAGE = (m: string) => ({ tool: "generate_image", args: { prompt: "p", model: m, aspect_ratio: "3:4" } })
  const CHECK = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
  const TWO = {
    kind: "sampled", seed: 7, gender: "woman", traits: { t: 1 }, identityImages: [], promptsVersion: "1.0.0", productCategory: "saas",
    image: { ...IMAGE("image-model-a"), fallback: IMAGE("image-model-c") },
    candidates: [{ model: "image-model-a", ...IMAGE("image-model-a") }, { model: "image-model-b", ...IMAGE("image-model-b") }],
    fallback: IMAGE("image-model-c"), pick: { how: "user" }, realismPass: null, secondFrame: null, photoCheck: null, genderCheck: CHECK,
  }
  const CREATOR = { id: "creator", type: "ugc-creator", data: { label: "c", source: "sampled", gender: "woman", keepResult: false } }
  /** The lane's answers in call order, by path. */
  function answer(byPath: Record<string, unknown[]>) {
    const left = Object.fromEntries(Object.entries(byPath).map(([k, v]) => [k, [...v]]))
    fetchMock.mockImplementation(async (url: string) => {
      const path = String(url).replace(/^.*?(\/v1\/)/, "$1")
      const next = left[path]?.shift()
      if (next === undefined) throw new Error(`unexpected ${path}`)
      return reply(200, next)
    })
  }

  it("ugc-creator, a run nobody picks in: the builder, then the primary's image and its reading, each charged", async () => {
    answer({
      "/v1/ugc/creator": [TWO],
      "/v1/generate-image": [{ jobId: "img-a" }],
      "/v1/image-to-text/describe": [{ jobId: "read-a", generatedText: "PASS" }],
    })
    rowsById.set("img-a", { status: "completed", output_data: { imageUrl: "https://cdn.example/a.png" }, credits_actual: 45 })
    // The reading commits its reservation without mirroring credits_actual: the charge is its committed `credits`.
    rowsById.set("read-a", { credits_actual: null, credits: 3 })
    const c = ctx() as unknown as { onJobCreated: ReturnType<typeof vi.fn> }
    const r = await run(CREATOR, { ugc: { category: "saas" } }, c as never)
    expect([0, 1, 2].map(pathOf)).toEqual(["/v1/ugc/creator", "/v1/generate-image", "/v1/image-to-text/describe"])
    expect(r.output.ugcOutputs?.image).toBe("https://cdn.example/a.png")
    expect(r.output.imageUrl).toBe("https://cdn.example/a.png")
    expect(r.creditsUsed).toBe(45 + 3)
    expect(c.onJobCreated.mock.calls).toEqual([["creator", "img-a"], ["creator", "read-a"]])
    // A child job is never stamped with the run: a resume finds it again by its own key.
    expect(updates).toEqual([])
  })

  it("ugc-creator, the editor's own run: both options are drawn and checked, and wait for the pick", async () => {
    answer({
      "/v1/ugc/creator": [TWO],
      "/v1/generate-image": [{ jobId: "img-a" }, { jobId: "img-b" }],
      "/v1/image-to-text/describe": [{ jobId: "read-a", generatedText: "PASS" }, { jobId: "read-b", generatedText: "PASS" }],
    })
    rowsById.set("img-a", { status: "completed", output_data: { imageUrl: "https://cdn.example/a.png" }, credits_actual: 45 })
    rowsById.set("img-b", { status: "completed", output_data: { imageUrl: "https://cdn.example/b.png" }, credits_actual: 40 })
    rowsById.set("read-a", { credits_actual: null, credits: 3 })
    rowsById.set("read-b", { credits_actual: null, credits: 3 })
    const r = await run(CREATOR, { ugc: { category: "saas" } }, ctx(false, { reviewerPresent: true }))
    expect(r.output.ugcCandidates?.map((o) => o.imageUrl)).toEqual(["https://cdn.example/a.png", "https://cdn.example/b.png"])
    expect(r.output.ugcOutputs).toBeUndefined()
    expect(r.creditsUsed).toBe(45 + 40 + 3 + 3)
  })

  it("ugc-creator in a fan-out iteration, or on an app run, draws the primary alone even with a reviewer", async () => {
    for (const [c, i] of [[ctx(false, { reviewerPresent: true }), 0], [ctx(true, { reviewerPresent: true }), undefined]] as const) {
      fetchMock.mockReset()
      answer({ "/v1/ugc/creator": [TWO], "/v1/generate-image": [{ jobId: "img-a" }], "/v1/image-to-text/describe": [{ jobId: "read-a", generatedText: "PASS" }] })
      rowsById.set("img-a", { status: "completed", output_data: { imageUrl: "https://cdn.example/a.png" }, credits_actual: 45 })
      rowsById.set("read-a", { credits_actual: null, credits: 3 })
      const r = await run(CREATOR, { ugc: { category: "saas" } }, c, i)
      expect(r.output.ugcCandidates).toBeUndefined()
      expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/v1/generate-image"))).toHaveLength(1)
    }
  })

  it("ugc-creator: every child job has a key of its own, the same on a re-pick of the run; another request gets another key", async () => {
    const once = async (seedAnswer: Record<string, unknown>) => {
      fetchMock.mockReset()
      answer({ "/v1/ugc/creator": [seedAnswer], "/v1/generate-image": [{ jobId: "img-a" }], "/v1/image-to-text/describe": [{ jobId: "read-a", generatedText: "PASS" }] })
      rowsById.set("img-a", { status: "completed", output_data: { imageUrl: "https://cdn.example/a.png" }, credits_actual: 45 })
      rowsById.set("read-a", { credits_actual: null, credits: 3 })
      await run(CREATOR, { ugc: { category: "saas" } })
      return [0, 1, 2].map(keyAt)
    }
    const first = await once(TWO)
    const again = await once(TWO)
    expect(again).toEqual(first)
    expect(first[0]).toBe(syncHttpIdempotencyKey("exec-1", "creator"))
    expect(new Set(first).size).toBe(3)
    for (const key of first.slice(1)) expect(key!.startsWith(`${syncHttpIdempotencyKey("exec-1", "creator")}:`)).toBe(true)
    // A different answer (an unpinned creator drawn again on a resume) is a different request: its jobs are its own.
    const other = await once({ ...TWO, candidates: [{ model: "image-model-a", ...IMAGE("image-model-a"), args: { ...IMAGE("image-model-a").args, prompt: "q" } }, TWO.candidates[1]] })
    expect(other[1]).not.toBe(first[1])
  })

  it("ugc-creator: a 402 that stops the round fails the node with the route's code and keeps the option that passed", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = String(url).replace(/^.*?(\/v1\/)/, "$1")
      if (path === "/v1/ugc/creator") return reply(200, TWO)
      if (path === "/v1/image-to-text/describe") return reply(200, { jobId: "read-a", generatedText: "PASS" })
      const n = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/v1/generate-image")).length
      return n === 1 ? reply(200, { jobId: "img-a" }) : reply(402, { error: { code: "insufficient_credits", message: "Insufficient credits" }, required: 18, balance: 5 })
    })
    rowsById.set("img-a", { status: "completed", output_data: { imageUrl: "https://cdn.example/a.png" }, credits_actual: 45 })
    rowsById.set("read-a", { credits_actual: null, credits: 3 })
    const err = (await run(CREATOR, { ugc: { category: "saas" } }, ctx(false, { reviewerPresent: true })).catch((e: unknown) => e)) as Error & { errorCode?: string; output?: Record<string, unknown> }
    expect(err.message).toBe("Insufficient credits")
    expect(err.errorCode).toBe("insufficient_credits")
    expect(err.output).toEqual({ ugcCandidates: [expect.objectContaining({ imageUrl: "https://cdn.example/a.png" })], ugcShortfall: { required: 18, balance: 5 } })
  })

  it("a cancelled run starts no new UGC call", async () => {
    await expect(run(CREATOR, { ugc: { category: "saas" } }, ctx(false, { cancelled: true }))).rejects.toThrow("Execution cancelled")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("a resumed run never buys an unpinned creator's options twice", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    rows.length = 0
    updates.length = 0
    selects.length = 0
  })
  const CHECK = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
  /** The builder's answer for a seed: its options' requests depend on it, as the plugin's do. */
  const answerFor = (seed: number) => ({
    kind: "sampled", seed, gender: "woman", traits: { seed }, identityImages: [], promptsVersion: "1.0.0", productCategory: "saas",
    image: { tool: "generate_image", args: { prompt: `p-${seed}-a`, model: "image-model-a" } },
    candidates: [
      { model: "image-model-a", tool: "generate_image", args: { prompt: `p-${seed}-a`, model: "image-model-a" } },
      { model: "image-model-b", tool: "generate_image", args: { prompt: `p-${seed}-b`, model: "image-model-b" } },
    ],
    fallback: null, pick: { how: "user" }, realismPass: null, secondFrame: null, photoCheck: null, genderCheck: CHECK,
  })
  /**
   * The platform: the builder draws a random seed when it is sent none; a child route hands back the
   * job its key already started (the credit guard's dedup) and starts a new one otherwise.
   */
  function platform() {
    const jobsByKey = new Map<string, string>()
    const seeds: number[] = []
    let next = 0
    fetchMock.mockImplementation(async (url: string, init: { headers: Record<string, string>; body?: string }) => {
      const path = String(url).replace(/^.*?(\/v1\/)/, "$1")
      const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>
      if (path === "/v1/ugc/creator") {
        const seed = typeof body.seed === "number" ? body.seed : Math.floor(Math.random() * 2 ** 31)
        seeds.push(seed)
        return reply(200, answerFor(seed))
      }
      const key = Object.entries(init.headers).find(([k]) => k.toLowerCase() === "idempotency-key")?.[1] ?? `none-${next}`
      const seen = jobsByKey.get(key)
      if (seen) return reply(200, { jobId: seen, deduped: true })
      const jobId = `${path === "/v1/generate-image" ? "img" : "read"}-${++next}`
      jobsByKey.set(key, jobId)
      if (path === "/v1/generate-image") rowsById.set(jobId, { status: "completed", output_data: { imageUrl: `https://cdn.example/${jobId}.png` }, credits_actual: 45 })
      else rowsById.set(jobId, { status: "completed", output_data: { generatedText: "PASS" }, credits_actual: null, credits: 3 })
      return path === "/v1/generate-image" ? reply(200, { jobId }) : reply(200, { jobId, generatedText: "PASS" })
    })
    return { jobs: () => [...jobsByKey.values()], seeds }
  }
  const CREATOR = { id: "creator", type: "ugc-creator", data: { label: "c", source: "sampled", gender: "woman", keepResult: false } }
  const editorRun = (executionId: string) => ctx(false, { executionId, reviewerPresent: true })

  it("a re-pick of the run redraws the same creator: every child job is handed back, none is bought again", async () => {
    const p = platform()
    const first = await run(CREATOR, { ugc: { category: "saas" } }, editorRun("exec-1"))
    const bought = p.jobs()
    expect(bought).toHaveLength(4)
    // The orchestrator died after the draw; the resume runs the creator again under the same run.
    const again = await run(CREATOR, { ugc: { category: "saas" } }, editorRun("exec-1"))
    expect(p.jobs()).toEqual(bought)
    expect(p.seeds[1]).toBe(p.seeds[0])
    expect(again.output.ugcCandidates).toEqual(first.output.ugcCandidates)
  })

  it("a new run draws a new creator", async () => {
    const p = platform()
    await run(CREATOR, { ugc: { category: "saas" } }, editorRun("exec-1"))
    await run(CREATOR, { ugc: { category: "saas" } }, editorRun("exec-2"))
    expect(p.seeds[1]).not.toBe(p.seeds[0])
    expect(p.jobs()).toHaveLength(8)
  })

  it("a pinned creator draws its own seed on every run", async () => {
    const p = platform()
    const pinned = { ...CREATOR, data: { ...CREATOR.data, seed: 42 } }
    await run(pinned, { ugc: { category: "saas" } }, editorRun("exec-1"))
    await run(pinned, { ugc: { category: "saas" } }, editorRun("exec-2"))
    expect(p.seeds).toEqual([42, 42])
  })
})
