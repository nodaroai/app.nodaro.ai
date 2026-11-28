import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * An ADMIN-ROUTED run (lib/alternate-route.ts `runRouted`, docs/design/alternate-routes.md
 * "Routing per model"): a job carrying the server's signed decision runs on the
 * route or fails, refunded — never on the default route:
 *  - `accepts` is never asked again; `start` gets the prepared request with service and kind;
 *  - a start refused before anything existed is retried ONCE (the attempt recorded first);
 *  - a second refusal, an unanswered start, or a task that failed fails the job (deterministic);
 *  - a job without the server's decision keeps the legacy behaviour, and a lane
 *    an older plugin never knew does not reach its `accepts` at all.
 */

/** Job rows in memory: every read and write goes through the filters it was given. */
const mocks = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>> = {}
  /** When set and it answers true for a write's patch, that write fails as a database error. */
  const failWrite: { when?: (patch: Record<string, unknown>) => boolean } = {}
  const builder = (patch?: Record<string, unknown>) => {
    const filters: Array<(j: Record<string, unknown>) => boolean> = []
    const hits = () => Object.values(rows).filter((r) => filters.every((f) => f(r)))
    const chain = {
      // A JSON path (`a->b->>c`) is read through the row's nested objects; SQL: NULL <> x is not true.
      neq: (col: string, val: unknown) => (filters.push((j) => {
        const v = col.split(/->>?/).reduce<unknown>((o, k) => (o as Record<string, unknown> | null | undefined)?.[k], j)
        return v !== null && v !== undefined && v !== val
      }), chain),
      eq: (col: string, val: unknown) => (filters.push((j) => j[col] !== null && j[col] !== undefined && j[col] === val), chain),
      is: (col: string, val: unknown) => (filters.push((j) => (j[col] ?? null) === val), chain),
      in: (col: string, vals: unknown[]) => (filters.push((j) => vals.includes(j[col])), chain),
      maybeSingle: async () => {
        if (mocks.failRead) return { data: null, error: { message: "connection reset" } }
        const hit = hits()[0]
        return { data: hit ? structuredClone(hit) : null, error: null }
      },
      select: async () => {
        if (patch && failWrite.when?.(patch)) return { data: null, error: { message: "connection reset" } }
        const matched = hits()
        for (const r of matched) Object.assign(r, structuredClone(patch))
        return { data: matched.map((r) => ({ id: r.id })), error: null }
      },
    }
    return chain
  }
  return {
    failRead: false,
    rows,
    failWrite,
    from: vi.fn(() => ({ select: () => builder(), update: (patch: Record<string, unknown>) => builder(patch) })),
  }
})

vi.mock("../supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../job-cost-columns.js", () => ({
  jobCostColumns: async (cost: number) => ({ provider_cost: cost }),
}))

const settingsState = vi.hoisted(() => ({ failed: false, policy: { models: {} } as unknown }))
vi.mock("../app-settings.js", () => ({
  getAppSettings: async () => ({ video_route_policy: settingsState.failed ? undefined : settingsState.policy }),
  settingsReadFailed: () => settingsState.failed,
}))
vi.mock("../config.js", async (orig) => ({ ...(await orig<typeof import("../config.js")>()), hasCredits: () => true }))
vi.mock("../video-route-failures.js", () => ({ noteRouteFailure: vi.fn(async () => {}) }))
// The running parent job (a plugin's segments are sent inside it), and its segment quote.
vi.mock("../ref-video-probe.js", () => ({ probeRefVideoDurations: async ({ referenceVideoUrls }: { referenceVideoUrls: string[] }) => referenceVideoUrls.map(() => 2) }))
vi.mock("../video-send-start.js", () => ({ beginPlannedVideoSegment: vi.fn(async () => {}) }))
const ambient = vi.hoisted(() => ({ jobId: "parent-1" as string | undefined, quoteFails: false }))
vi.mock("../job-cancellation.js", async (orig) => ({ ...(await orig<typeof import("../job-cancellation.js")>()), getJobId: () => ambient.jobId, throwIfJobCancelled: async () => {} }))
vi.mock("../../ee/billing/video-route-runs.js", () => ({
  quoteRowlessSegment: vi.fn(async () => {
    if (ambient.quoteFails) throw new Error("price_not_configured")
    return { priceId: "seedance-2-5:8s:720p", quotedUsd: 0.5, chargedCredits: 50 }
  }),
  rowlessSegmentCharge: vi.fn((seg: { billedUsd: number | null }) => ({ credits: seg.billedUsd === null ? 50 : 42, capped: false, reported: seg.billedUsd !== null })),
}))
// The route ledger in memory (lib/video-route-ledger.ts): starts before each start, billed tasks.
const ledger = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
vi.mock("../video-route-ledger.js", async (orig) => ({
  ...(await orig<typeof import("../video-route-ledger.js")>()),
  recordRouteStart: vi.fn(async (jobId: string, send: number, key = "", quote?: Record<string, unknown>) => {
    if (ledger.rows.some((r) => r.job_id === jobId && r.kind === "start" && r.send === send && r.key === key)) return "exists"
    ledger.rows.push({ job_id: jobId, kind: "start", send, key, ...(quote ?? {}) })
    return "recorded"
  }),
  recordRouteStartRef: vi.fn(async () => {}),
  recordRouteTask: vi.fn(async (jobId: string, send: number, ref: string | null, billedUsd: number | null, key = "") => {
    ledger.rows.push({ job_id: jobId, kind: "task", send, key, ref, billedUsd })
    return true
  }),
  readRouteLedger: vi.fn(async (jobId: string) => {
    const mine = ledger.rows.filter((r) => r.job_id === jobId)
    return {
      starts: mine.filter((r) => r.kind === "start" && r.key === "").map((r) => r.send),
      tasks: mine.filter((r) => r.kind === "task" && r.key === "").map((r) => ({ send: r.send, ref: r.ref, billedUsd: r.billedUsd })),
      segments: mine.filter((r) => r.kind === "task" && r.key !== "").map((r) => ({ key: r.key, ref: r.ref, billedUsd: r.billedUsd, priceId: null, quotedUsd: null, quotedCredits: null })),
      addonsBase: undefined,
      settle: undefined,
    }
  }),
}))

import { setPluginServices, _resetPluginServicesForTests } from "../private-plugins/services-registry.js"
import type { PluginAlternateRoutesService } from "../private-plugins/types.js"
import { ROUTED_FAILURE_MESSAGE, finalizeRoutedDraft, takeAlternateRoute } from "../alternate-route.js"
import { ALTERNATE_ROUTE_KEY } from "../alternate-route-request.js"
import { VIDEO_ROUTE_STAMP_KEY, videoRouteRequestKey, videoRouteStamp } from "../video-route-decision.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"

const BODY = Object.freeze({
  prompt: "A cat walks",
  aspect_ratio: "16:9",
  duration: 8,
  resolution: "720p",
  generate_audio: true,
  web_search: false,
  first_frame_url: "https://media.example/jobs/j-1/start.jpg",
})
const run = (jobType: "image-to-video" | "lip-sync" = "image-to-video") => ({
  provider: "seedance-2-5",
  taskModel: "vendor/seedance",
  body: BODY,
  reconcileOpts: { routeJob: { jobId: "j-1", jobType } },
})
const stamp = (jobId = "j-1") => videoRouteStamp(jobId, { route: "alternate", routeId: "route-1", service: "image-to-video" }, { model: "seedance-2-5", priceId: "seedance-2-5:8s:720p", requestKey: videoRouteRequestKey({ provider: "seedance-2-5" }), quotedUsd: 0.5, quotedSec: 8, factor: 1, factorKey: "k" })
const job = () => mocks.rows["j-1"]!
const record = () => (job().input_data as Record<string, unknown>)[ALTERNATE_ROUTE_KEY] as Record<string, unknown> | undefined

function service(over: Partial<PluginAlternateRoutesService> = {}) {
  const s = {
    accepts: vi.fn(() => ({ routeId: "route-1" })),
    start: vi.fn(async () => ({ taskRef: "task-9" })),
    poll: vi.fn(async () => ({ state: "done" as const, resultUrl: "https://out.example/v.mp4", providerCostUsd: 0.42 })),
    prices: () => [],
    ...over,
  }
  setPluginServices({ alternateRoutes: s as PluginAlternateRoutesService })
  return s as typeof s & { start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn>; accepts: ReturnType<typeof vi.fn> }
}
const refused = (code?: string) => Object.assign(new Error("no"), { created: "none", ...(code ? { code } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  _resetPluginServicesForTests()
  ledger.rows.length = 0
  for (const k of Object.keys(mocks.rows)) delete mocks.rows[k]
  mocks.rows["j-1"] = {
    id: "j-1", status: "processing", parent_job_id: null,
    provider_kind: "pre-task", provider_task_id: null, provider_call_started_at: null,
    input_data: { provider: "seedance-2-5", [VIDEO_ROUTE_STAMP_KEY]: stamp() },
  }
  mocks.failWrite.when = undefined
  settingsState.failed = false
  settingsState.policy = { models: {} }
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  _resetPluginServicesForTests()
})

async function failure(p: Promise<unknown>): Promise<Error> {
  const err = await p.then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(Error)
  return err as Error
}

describe("an admin-routed run", () => {
  it("starts on the route with service and kind, never asking accepts, and returns its result", async () => {
    const s = service()
    const result = await takeAlternateRoute(run())
    expect(result).toMatchObject({ url: "https://out.example/v.mp4", cost: 0.42, routedVia: "route-1" })
    expect(s.accepts).not.toHaveBeenCalled()
    expect(s.start.mock.calls[0]![1]).toMatchObject({ service: "image-to-video", kind: "generate", outputSec: 8, firstFrameUrl: BODY.first_frame_url })
    expect(record()).toMatchObject({ state: "running", routed: true })
  })

  it("retries a start refused before anything existed ONCE, recording the attempt first", async () => {
    const s = service({ start: vi.fn().mockRejectedValueOnce(refused()).mockResolvedValueOnce({ taskRef: "task-9" }) })
    expect(await takeAlternateRoute(run())).toMatchObject({ url: "https://out.example/v.mp4" })
    expect(s.start).toHaveBeenCalledTimes(2)
  })

  it("fails (refunded, deterministic) after a second refusal — never the default route", async () => {
    const s = service({ start: vi.fn().mockRejectedValue(refused("insufficient_balance")) })
    const err = await failure(takeAlternateRoute(run()))
    expect(err.message).toBe(ROUTED_FAILURE_MESSAGE)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(s.start).toHaveBeenCalledTimes(2)
    expect(String((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).join("\n"))).toMatch(/insufficient balance/)
  })

  it("never resends an unanswered start: fails at once", async () => {
    const s = service({ start: vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { created: "unknown" })) })
    const err = await failure(takeAlternateRoute(run()))
    expect(isDeterministicJobError(err)).toBe(true)
    expect(s.start).toHaveBeenCalledTimes(1)
  })

  it("fails when the task failed after it existed (no fallback, no second start)", async () => {
    const s = service({ poll: vi.fn(async () => ({ state: "failed" as const, message: "upstream error" })) })
    const err = await failure(takeAlternateRoute(run()))
    expect(isDeterministicJobError(err)).toBe(true)
    expect(s.start).toHaveBeenCalledTimes(1)
  })

  it("reads a task it already holds, never starting another", async () => {
    const s = service()
    Object.assign(job(), { provider_kind: "alternate-route", provider_task_id: "alt:task-7" })
    ;(job().input_data as Record<string, unknown>)[ALTERNATE_ROUTE_KEY] = { state: "running", at: 1, routeId: "route-1", taskRef: "task-7", routed: true, fallback: { taskModel: "m", modelKey: "seedance-2-5", body: {} } }
    expect(await takeAlternateRoute(run())).toMatchObject({ url: "https://out.example/v.mp4" })
    expect(s.start).not.toHaveBeenCalled()
    expect(s.poll).toHaveBeenCalledWith("route-1", "task-7")
  })

  it("saves NO default request on a routed record: an older host reading the same database has nothing to resend", async () => {
    service()
    const seen: Array<Record<string, unknown>> = []
    mocks.failWrite.when = (patch) => {
      const rec = (patch.input_data as Record<string, unknown> | undefined)?.[ALTERNATE_ROUTE_KEY]
      if (rec) seen.push(rec as Record<string, unknown>)
      return false
    }
    await takeAlternateRoute(run())
    // The claim and the running record both, every one routed and without a fallback.
    expect(seen.length).toBeGreaterThanOrEqual(2)
    for (const rec of seen) {
      expect(rec).toMatchObject({ routed: true })
      expect(rec).not.toHaveProperty("fallback")
    }
    expect(record()).not.toHaveProperty("fallback")
  })

  it.each([["with no saved default request (as saved now)", false], ["with one saved by an earlier build", true]])("a re-pick reads the task a routed job holds %s, never starting another", async (_what, withFallback) => {
    const s = service()
    Object.assign(job(), { provider_kind: "alternate-route", provider_task_id: "alt:task-7" })
    ;(job().input_data as Record<string, unknown>)[ALTERNATE_ROUTE_KEY] = { state: "running", at: 1, routeId: "route-1", taskRef: "task-7", routed: true, ...(withFallback ? { fallback: { taskModel: "m", modelKey: "seedance-2-5", body: {} } } : {}) }
    expect(await takeAlternateRoute(run())).toMatchObject({ url: "https://out.example/v.mp4" })
    expect(s.start).not.toHaveBeenCalled()
    expect(s.poll).toHaveBeenCalledWith("route-1", "task-7")
  })

  it("fails a routed job in a process with no route service, instead of running it on the default route", async () => {
    setPluginServices({})
    const err = await failure(takeAlternateRoute(run()))
    expect(isDeterministicJobError(err)).toBe(true)
  })
})

describe("a job without the server's decision", () => {
  it("an unverifiable stored decision refuses the send", async () => {
    const s = service()
    ;(job().input_data as Record<string, unknown>)[VIDEO_ROUTE_STAMP_KEY] = { ...stamp(), sig: "forged" }
    await expect(takeAlternateRoute(run("lip-sync"))).rejects.toThrow("could not be verified")
    expect(s.accepts).not.toHaveBeenCalled()
    expect(s.start).not.toHaveBeenCalled()
  })

  it("a decision signed for another job refuses the send", async () => {
    const s = service()
    ;(job().input_data as Record<string, unknown>)[VIDEO_ROUTE_STAMP_KEY] = stamp("j-2")
    await expect(takeAlternateRoute(run("lip-sync"))).rejects.toThrow("could not be verified")
    expect(s.start).not.toHaveBeenCalled()
  })

  it("a foreign job is left to its environment before the local policy is first saved", async () => {
    const s = service()
    settingsState.policy = undefined
    ;(job().input_data as Record<string, unknown>)[VIDEO_ROUTE_STAMP_KEY] = { ...stamp(), env: "another-environment" }
    await expect(takeAlternateRoute(run())).rejects.toMatchObject({ name: "AlternateRoutePendingError" })
    expect(s.start).not.toHaveBeenCalled()
    expect(s.accepts).not.toHaveBeenCalled()
  })

  it("a saved default choice bypasses the legacy consult for the original lanes", async () => {
    const s = service({ accepts: vi.fn(() => null) })
    delete (job().input_data as Record<string, unknown>)[VIDEO_ROUTE_STAMP_KEY]
    expect(await takeAlternateRoute(run("image-to-video"))).toBeNull()
    expect(s.accepts).not.toHaveBeenCalled()
  })
})

describe("a draft finalize on the route that made the draft", () => {
  it("starts kind draft-finalize with the signed reference and length, and returns the 1080p clip", async () => {
    const s = service()
    ;(job().input_data as Record<string, unknown>)[VIDEO_ROUTE_STAMP_KEY] = videoRouteStamp("j-1", { route: "alternate", routeId: "route-1", service: "video-upscale" }, { model: "seedance-2-5", priceId: "seedance-2-5:8s:720p", requestKey: videoRouteRequestKey({ provider: "seedance-2-5" }), quotedUsd: 0.5, quotedSec: 9, factor: 1, factorKey: "k", outputSec: 9, draftRouteTaskRef: "draft-ref-1" })
    expect(await finalizeRoutedDraft("j-1")).toMatchObject({ url: "https://out.example/v.mp4" })
    expect(s.start.mock.calls[0]![1]).toMatchObject({ kind: "draft-finalize", draftRouteTaskRef: "draft-ref-1", outputSec: 9, jobType: "video-upscale" })
    expect(s.accepts).not.toHaveBeenCalled()
    // Route-id parity for this lane: the send derives no route of its own. It starts on the id the
    // admission decided and signed, with the request admission quoted (not a draft, 1080p).
    expect(s.start.mock.calls[0]![0]).toBe("route-1")
    expect(s.start.mock.calls[0]![1]).toMatchObject({ model: "seedance-2-5", draft: false, resolution: "1080p", service: "video-upscale" })
  })

  it("fails (deterministic) without the server's signed decision", async () => {
    service()
    ;(job().input_data as Record<string, unknown>)[VIDEO_ROUTE_STAMP_KEY] = { ...stamp(), draftRouteTaskRef: "x", sig: "forged" }
    expect(isDeterministicJobError(await failure(finalizeRoutedDraft("j-1")))).toBe(true)
  })
})

describe("a failed read is never read as 'not routed'", () => {
  it("a settings read that failed still reads the job, and its decision runs it on the route", async () => {
    const s = service()
    settingsState.failed = true
    expect(await takeAlternateRoute(run())).toMatchObject({ routedVia: "route-1" })
    expect(s.start).toHaveBeenCalledTimes(1)
  })

  it("the signed decision alone decides: a stamped job runs on its route with every model reverted since (the setting's row is kept)", async () => {
    const s = service()
    settingsState.policy = { models: {} }
    expect(await takeAlternateRoute(run())).toMatchObject({ routedVia: "route-1" })
    expect(s.accepts).not.toHaveBeenCalled()
  })

  it("a job read that fails leaves the run for a re-pick, never the default route", async () => {
    service()
    mocks.failRead = true
    const err = await takeAlternateRoute(run()).then(() => null, (e: unknown) => e)
    expect((err as Error).name).toBe("AlternateRoutePendingError")
    mocks.failRead = false
  })
})

describe("a later send of a routed job (a rewrite, a plain clip after a failed voice chain)", () => {
  it("runs on the same route, freshly quoted, once the earlier send failed", async () => {
    const quote = vi.fn(() => ({ billedSeconds: 8, usd: 0.7 }))
    const s = service({
      quote,
      start: vi.fn().mockRejectedValueOnce(refused()).mockRejectedValueOnce(refused()).mockResolvedValue({ taskRef: "task-2" }),
    })
    // The first send is refused twice: the job's send 1 fails.
    expect(isDeterministicJobError(await failure(takeAlternateRoute(run())))).toBe(true)
    expect(record()).toMatchObject({ state: "failed", send: 1 })
    // Its second send: a fresh quote, a new task on the same route.
    const second = { ...run(), reconcileOpts: { routeJob: { jobId: "j-1", jobType: "image-to-video" as const, send: 2 } } }
    expect(await takeAlternateRoute(second)).toMatchObject({ routedVia: "route-1" })
    expect(quote).toHaveBeenCalledTimes(1)
    expect(s.start).toHaveBeenCalledTimes(3)
    expect(((job().input_data as Record<string, { quotedUsd?: number }>)[VIDEO_ROUTE_STAMP_KEY]!).quotedUsd).toBe(0.7)
  })

  const sendTwo = () => ({ ...run(), reconcileOpts: { routeJob: { jobId: "j-1", jobType: "image-to-video" as const, send: 2 } } })

  it("an unanswered start is final: no later send is ever started beside it (a voiced run's plain clip included)", async () => {
    const s = service({ quote: vi.fn(() => ({ billedSeconds: 8, usd: 0.7 })), start: vi.fn().mockRejectedValueOnce(Object.assign(new Error("timeout"), { created: "unknown" })).mockResolvedValue({ taskRef: "task-2" }) })
    expect(isDeterministicJobError(await failure(takeAlternateRoute(run())))).toBe(true)
    expect(record()).toMatchObject({ state: "failed", send: 1, reason: "start-unanswered" })
    expect(isDeterministicJobError(await failure(takeAlternateRoute(sendTwo())))).toBe(true)
    expect(s.start).toHaveBeenCalledTimes(1)
  })

  it("a send whose task DELIVERED (its lane could not finish the clip) is followed by a distinct new task, never a resume of it; both are billed", async () => {
    const s = service({
      quote: vi.fn(() => ({ billedSeconds: 8, usd: 0.7 })),
      start: vi.fn().mockResolvedValueOnce({ taskRef: "task-1" }).mockResolvedValueOnce({ taskRef: "task-2" }),
      poll: vi.fn().mockResolvedValueOnce({ state: "done", resultUrl: "https://out.example/lip.mp4", providerCostUsd: 0.4 }).mockResolvedValueOnce({ state: "done", resultUrl: "https://out.example/plain.mp4", providerCostUsd: 0.3 }),
    })
    expect(await takeAlternateRoute(run())).toMatchObject({ url: "https://out.example/lip.mp4" })
    expect(await takeAlternateRoute(sendTwo())).toMatchObject({ url: "https://out.example/plain.mp4" })
    expect(s.start).toHaveBeenCalledTimes(2)
    expect(ledger.rows.filter((r) => r.kind === "task")).toEqual([
      expect.objectContaining({ send: 1, ref: "task-1", billedUsd: 0.4 }),
      expect.objectContaining({ send: 2, ref: "task-2", billedUsd: 0.3 }),
    ])
  })

  it("a routed run's provider cost is only what the route REPORTED (never its planned figure)", async () => {
    service({ start: vi.fn(async () => ({ taskRef: "task-9", plannedCostUsd: 0.9 })), poll: vi.fn(async () => ({ state: "done" as const, resultUrl: "https://out.example/v.mp4" })) })
    expect(await takeAlternateRoute(run())).toMatchObject({ cost: null })
    expect(ledger.rows.find((r) => r.kind === "task")).toMatchObject({ billedUsd: null })
  })

  it("the same send number again never starts another task", async () => {
    const s = service({ start: vi.fn().mockRejectedValue(refused()) })
    await failure(takeAlternateRoute(run()))
    await failure(takeAlternateRoute(run()))
    expect(s.start).toHaveBeenCalledTimes(2)
  })
})

describe("a plugin's segment sent inside its parent with its run's bound token (rowless)", () => {
  const segment = (token: string | undefined, opts: { onTaskCreated?: (id: string) => Promise<void>; key?: string } = {}) => ({
    provider: "seedance-2-5",
    taskModel: "vendor/seedance",
    body: BODY,
    reconcileOpts: {
      routeRowless: true as const,
      ...(token !== undefined ? { routeToken: token } : {}),
      ...(opts.key !== undefined ? { routeSegmentKey: opts.key } : { routeSegmentKey: "seg-1" }),
      onTaskCreated: opts.onTaskCreated ?? vi.fn(async (_id: string) => {}),
    },
  })
  const bound = async (parentJobId = "parent-1", now?: Date) => {
    const { bindRowlessRouteToken, rowlessRouteToken } = await import("../video-route-decision.js")
    const quote = rowlessRouteToken({ routeId: "route-1", model: "seedance-2-5", service: "generate-video-pro", feeChargedCredits: 10, reserveChargedCredits: 110, feeId: "generate-video-pro" })
    return bindRowlessRouteToken(quote, { parentJobId, userId: "u-1", ...(now ? { now } : {}) })!
  }
  beforeEach(() => {
    ambient.jobId = "parent-1"
    ambient.quoteFails = false
  })

  it("runs on the route: start recorded first on the parent's ledger with its quote, the segment key in the checkpoint, the billed cost recorded", async () => {
    const { rowlessRouteTaskOf } = await import("../video-route-decision.js")
    const s = service()
    const onTaskCreated = vi.fn(async (_id: string) => {})
    const result = await takeAlternateRoute(segment(await bound(), { onTaskCreated }))
    expect(result).toMatchObject({ url: "https://out.example/v.mp4", cost: 0.42, routedVia: "route-1", routedCredits: 42 })
    expect(s.start.mock.calls[0]![1]).toMatchObject({ service: "generate-video-pro", kind: "generate" })
    expect(rowlessRouteTaskOf(onTaskCreated.mock.calls[0]![0])).toEqual({ routeId: "route-1", taskRef: "task-9", segmentKey: "seg-1" })
    expect(ledger.rows).toEqual([
      expect.objectContaining({ job_id: "parent-1", kind: "start", key: "seg-1", priceId: "seedance-2-5:8s:720p", chargedCredits: 50 }),
      expect.objectContaining({ job_id: "parent-1", kind: "task", key: "seg-1", ref: "task-9", billedUsd: 0.42 }),
    ])
    // No job row is claimed for a segment.
    expect(record()).toBeUndefined()
  })

  it("checkpoints the paid task in the plugin even when the ledger cannot store its reference", async () => {
    const { recordRouteStartRef } = await import("../video-route-ledger.js")
    vi.mocked(recordRouteStartRef).mockRejectedValueOnce(new Error("ledger unavailable"))
    const onTaskCreated = vi.fn(async (_id: string) => {})
    const routed = service()
    await expect(takeAlternateRoute(segment(await bound(), { onTaskCreated }))).rejects.toThrow()
    expect(onTaskCreated).toHaveBeenCalledTimes(1)
    expect(routed.start).toHaveBeenCalledTimes(1)
    expect(routed.poll).not.toHaveBeenCalled()
  })

  it("a segment resolves the prepared request's rate key for the original supplier", async () => {
    const routed = service({
      accepts: (req) => req.referenceVideoUrls.length > 0 ? { routeId: "with-source" } : { routeId: "without-source" },
    })
    const value = segment(await bound())
    const reference = { ...value, body: { prompt: "Continue", resolution: "720p", duration: 8, aspect_ratio: "16:9", reference_video_urls: ["https://media.example/source.mp4"] } }
    await takeAlternateRoute(reference)
    expect(routed.start).toHaveBeenCalledWith("with-source", expect.objectContaining({ referenceVideoUrls: ["https://media.example/source.mp4"] }), expect.anything())
    expect(routed.poll).toHaveBeenCalledWith("with-source", "task-9")
  })

  it("an unbound quote, another job's token, an expired one, another model, or no segment key never reaches the route", async () => {
    const { rowlessRouteToken } = await import("../video-route-decision.js")
    const s = service()
    const quote = rowlessRouteToken({ routeId: "route-1", model: "seedance-2-5", service: "generate-video-pro", feeChargedCredits: 10, reserveChargedCredits: 110, feeId: "generate-video-pro" })
    for (const token of ["forged.sig", quote, await bound("other-job"), await bound("parent-1", new Date(Date.now() - 49 * 3_600_000))]) {
      expect(isDeterministicJobError(await failure(takeAlternateRoute(segment(token))))).toBe(true)
    }
    expect(isDeterministicJobError(await failure(takeAlternateRoute({ ...segment(await bound()), provider: "seedance-2" })))).toBe(true)
    const noKey = segment(await bound())
    delete (noKey.reconcileOpts as Record<string, unknown>).routeSegmentKey
    expect(isDeterministicJobError(await failure(takeAlternateRoute(noKey)))).toBe(true)
    expect(s.start).not.toHaveBeenCalled()
  })

  it("a segment whose task FAILED never becomes a billed task on the ledger (never charged)", async () => {
    service({ poll: vi.fn(async () => ({ state: "failed" as const, message: "x" })) })
    expect(isDeterministicJobError(await failure(takeAlternateRoute(segment(await bound()))))).toBe(true)
    expect(ledger.rows.filter((r) => r.kind === "task")).toEqual([])
  })

  it("a segment the route gives no quote is never sent (never priced at 0)", async () => {
    const s = service()
    ambient.quoteFails = true
    expect(isDeterministicJobError(await failure(takeAlternateRoute(segment(await bound()))))).toBe(true)
    expect(s.start).not.toHaveBeenCalled()
  })

  it("a segment whose start is recorded already (a crash before its checkpoint) is never started again", async () => {
    const s = service()
    ledger.rows.push({ job_id: "parent-1", kind: "start", send: 1, key: "seg-1" })
    expect(isDeterministicJobError(await failure(takeAlternateRoute(segment(await bound()))))).toBe(true)
    expect(s.start).not.toHaveBeenCalled()
  })

  it("without a token a segment is untouched (the default route)", async () => {
    const s = service()
    expect(await takeAlternateRoute(segment(undefined))).toBeNull()
    expect(s.start).not.toHaveBeenCalled()
  })
})
