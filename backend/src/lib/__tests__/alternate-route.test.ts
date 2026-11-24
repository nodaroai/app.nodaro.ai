import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The worker side of an alternate route (lib/alternate-route.ts): when it is
 * taken, when it falls back to the default request, and when it must leave the
 * run to the recovery instead — never sending the default request while the
 * route's task may still be running.
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
    rows,
    failWrite,
    from: vi.fn(() => ({ select: () => builder(), update: (patch: Record<string, unknown>) => builder(patch) })),
  }
})

vi.mock("../supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../job-cost-columns.js", () => ({
  jobCostColumns: async (cost: number) => ({ provider_cost: cost }),
}))

import { setPluginServices, _resetPluginServicesForTests } from "../private-plugins/services-registry.js"
import type { PluginAlternateRoutesService } from "../private-plugins/types.js"
import {
  ALTERNATE_ROUTE_BUDGET_MS,
  ALTERNATE_ROUTE_MAX_UNREADABLE_READS,
  AlternateRouteJobEndedError,
  AlternateRoutePendingError,
  takeAlternateRoute,
} from "../alternate-route.js"
import { ALTERNATE_ROUTE_CLAIM_REF, ALTERNATE_ROUTE_KEY } from "../alternate-route-request.js"

const BODY = Object.freeze({
  prompt: "Swap the shirt in @video_1 for the one in @image_1",
  aspect_ratio: "adaptive",
  duration: -1,
  resolution: "720p",
  generate_audio: true,
  web_search: false,
  nsfw_checker: false,
  reference_image_urls: ["https://media.example/jobs/j-1/ref.jpg"],
  reference_video_urls: ["https://media.example/jobs/j-1/clip.mp4"],
  omni_reference_task_type: "edit",
})
const RUN = {
  provider: "model-a",
  taskModel: "vendor/model-a",
  body: BODY,
  reconcileOpts: { routeJob: { jobId: "j-1", jobType: "text-to-video" as const } },
}

const job = () => mocks.rows["j-1"]!
const record = () => (job().input_data as Record<string, unknown>)[ALTERNATE_ROUTE_KEY] as Record<string, unknown> | undefined

function service(over: Partial<PluginAlternateRoutesService> = {}): PluginAlternateRoutesService & {
  accepts: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn>
} {
  const s = {
    accepts: vi.fn(() => ({ routeId: "route-1" })),
    start: vi.fn(async () => ({ taskRef: "task-9", plannedCostUsd: 0.5 })),
    poll: vi.fn(async () => ({ state: "done" as const, resultUrl: "https://out.example/v.mp4", providerCostUsd: 0.42, providerMs: 1234 })),
    ...over,
  }
  setPluginServices({ alternateRoutes: s as PluginAlternateRoutesService })
  return s as never
}

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
const savesReference = (patch: Record<string, unknown>) => typeof patch.provider_task_id === "string" && patch.provider_task_id.startsWith("alt:") && patch.provider_task_id !== ALTERNATE_ROUTE_CLAIM_REF

beforeEach(() => {
  vi.clearAllMocks()
  _resetPluginServicesForTests()
  for (const k of Object.keys(mocks.rows)) delete mocks.rows[k]
  mocks.rows["j-1"] = {
    id: "j-1", status: "processing", parent_job_id: "p-1",
    provider_kind: null, provider_task_id: null, provider_call_started_at: null,
    input_data: { provider: "model-a" },
  }
  mocks.rows["p-1"] = { id: "p-1", status: "processing", job_type: "parent-kind", input_data: {} }
  mocks.failWrite.when = undefined
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  _resetPluginServicesForTests()
})

describe("inert without an opt-in", () => {
  it("no service registered: null, not one database call, not one log line", async () => {
    expect(await takeAlternateRoute(RUN)).toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("no routeJob on the call: null, nothing read, the plugin not asked", async () => {
    const s = service()
    expect(await takeAlternateRoute({ ...RUN, reconcileOpts: {} })).toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(s.accepts).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("a body key the request table does not map: not offered, nothing read", async () => {
    const s = service()
    expect(await takeAlternateRoute({ ...RUN, body: { ...BODY, some_new_lever: 1 } })).toBeNull()
    expect(await takeAlternateRoute({ ...RUN, body: { ...BODY, web_search: true } })).toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(s.accepts).not.toHaveBeenCalled()
  })

  it("the plugin says no: null, and the row is not claimed", async () => {
    service({ accepts: vi.fn(() => null) })
    expect(await takeAlternateRoute(RUN)).toBeNull()
    expect(job().provider_task_id).toBeNull()
    expect(record()).toBeUndefined()
  })
})

describe("taken", () => {
  it("offers the neutral request with the parent, claims, saves the reference, and returns the route's result", async () => {
    const s = service()
    const result = await takeAlternateRoute(RUN)
    expect(s.accepts).toHaveBeenCalledWith({
      jobId: "j-1", jobType: "text-to-video", model: "model-a",
      parent: { jobId: "p-1", jobType: "parent-kind" },
      prompt: BODY.prompt, aspectRatio: "adaptive", durationSec: -1, resolution: "720p", generateAudio: true,
      draft: false, referenceTaskType: "edit",
      referenceImageUrls: BODY.reference_image_urls, referenceVideoUrls: BODY.reference_video_urls, referenceAudioUrls: [],
    })
    expect(s.start).toHaveBeenCalledTimes(1)
    expect(s.start.mock.calls[0]![2]).toEqual({ jobId: "j-1" })
    expect(result).toEqual({ url: "https://out.example/v.mp4", cost: 0.42, providerMs: 1234, routedVia: "route-1" })
    expect(result).not.toHaveProperty("kieTaskId")
    expect(job()).toMatchObject({ provider_kind: "alternate-route", provider_task_id: "alt:task-9", provider_cost: 0.5 })
    expect(record()).toMatchObject({
      state: "running", routeId: "route-1", taskRef: "task-9",
      fallback: { taskModel: "vendor/model-a", modelKey: "model-a", body: BODY },
    })
  })

  it("a plain text run (no references, no task type) is offered with exactly what it carries", async () => {
    const s = service()
    await takeAlternateRoute({ ...RUN, body: { prompt: "A lighthouse at dusk", aspect_ratio: "16:9", duration: "8", resolution: "1080p" } })
    expect(s.accepts).toHaveBeenCalledWith({
      jobId: "j-1", jobType: "text-to-video", model: "model-a", parent: { jobId: "p-1", jobType: "parent-kind" },
      prompt: "A lighthouse at dusk", aspectRatio: "16:9", durationSec: 8, resolution: "1080p",
      draft: false, referenceImageUrls: [], referenceVideoUrls: [], referenceAudioUrls: [],
    })
  })

  it("a reference whose save failed is saved on a later read, and the run delivers", async () => {
    vi.useFakeTimers()
    let failures = 3
    mocks.failWrite.when = (patch) => savesReference(patch) && failures-- > 0
    const poll = vi.fn()
      .mockResolvedValueOnce({ state: "running" })
      .mockResolvedValueOnce({ state: "done", resultUrl: "https://out.example/v.mp4" })
    service({ poll })
    const p = takeAlternateRoute(RUN)
    await vi.advanceTimersByTimeAsync(ALTERNATE_ROUTE_BUDGET_MS)
    expect((await p)?.url).toBe("https://out.example/v.mp4")
    expect(job().provider_task_id).toBe("alt:task-9")
  })

  it("a task that reports no figure records the planned one", async () => {
    service({ poll: vi.fn(async () => ({ state: "done" as const, resultUrl: "https://out.example/v.mp4" })) })
    expect((await takeAlternateRoute(RUN))?.cost).toBe(0.5)
  })

  it("reads on while running, on the cadence the plugin names", async () => {
    vi.useFakeTimers()
    const poll = vi.fn()
      .mockResolvedValueOnce({ state: "running", nextPollMs: 5_000 })
      .mockResolvedValueOnce({ state: "done", resultUrl: "https://out.example/v.mp4" })
    service({ poll })
    const p = takeAlternateRoute(RUN)
    await vi.advanceTimersByTimeAsync(5_000)
    expect((await p)?.url).toBe("https://out.example/v.mp4")
    expect(poll).toHaveBeenCalledTimes(2)
  })
})

describe("falls back to the default request", () => {
  const expectFellBack = (reason: string) => {
    expect(job()).toMatchObject({ provider_kind: "pre-task", provider_task_id: null })
    expect(typeof job().provider_call_started_at).toBe("string")
    expect(record()).toMatchObject({ state: "fell-back", reason, fallback: { body: BODY } })
  }

  it("start refused before a task existed: null, no alert", async () => {
    service({ start: vi.fn(async () => { throw { created: "none", message: "busy", retryAfterMs: 1000 } }) })
    expect(await takeAlternateRoute(RUN)).toBeNull()
    expectFellBack("start-refused")
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("start got no answer: null, and an alert naming the job", async () => {
    service({ start: vi.fn(async () => { throw { created: "unknown", message: "timed out" } }) })
    expect(await takeAlternateRoute(RUN)).toBeNull()
    expectFellBack("start-unanswered")
    expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n")).toMatch(/\[ALERT\] job j-1: .*possible orphan paid task/)
  })

  it("a start rejection without the contract's shape is read as no answer", async () => {
    service({ start: vi.fn(async () => { throw new Error("socket hang up") }) })
    expect(await takeAlternateRoute(RUN)).toBeNull()
    expectFellBack("start-unanswered")
    expect(errorSpy).toHaveBeenCalled()
  })

  it("start resolved without a reference: null, with an alert", async () => {
    service({ start: vi.fn(async () => ({ taskRef: "" })) })
    expect(await takeAlternateRoute(RUN)).toBeNull()
    expectFellBack("start-without-reference")
    expect(errorSpy).toHaveBeenCalled()
  })

  it.each(["failed", "expired"] as const)("the task %s (not charged): null", async (state) => {
    service({ poll: vi.fn(async () => ({ state, message: "refused" })) })
    expect(await takeAlternateRoute(RUN)).toBeNull()
    expectFellBack(state)
    expect(record()).toMatchObject({ taskRef: "task-9" })
  })

  it("a job that already fell back takes the default request at once", async () => {
    const s = service()
    job().input_data = { [ALTERNATE_ROUTE_KEY]: { state: "fell-back", at: 1, reason: "failed" } }
    expect(await takeAlternateRoute(RUN)).toBeNull()
    expect(s.accepts).not.toHaveBeenCalled()
    expect(s.start).not.toHaveBeenCalled()
  })

  it("another kind's task on the row is not this route's: null, nothing started", async () => {
    const s = service()
    Object.assign(job(), { provider_kind: "kie-standard", provider_task_id: "default-1" })
    expect(await takeAlternateRoute(RUN)).toBeNull()
    expect(s.start).not.toHaveBeenCalled()
  })
})

describe("never falls back while the task may still run", () => {
  it("still running when the budget runs out: pending, the reference kept", async () => {
    vi.useFakeTimers()
    service({ poll: vi.fn(async () => ({ state: "running" as const })) })
    const p = takeAlternateRoute(RUN)
    const settled = expect(p).rejects.toBeInstanceOf(AlternateRoutePendingError)
    await vi.advanceTimersByTimeAsync(ALTERNATE_ROUTE_BUDGET_MS + 60_000)
    await settled
    expect(job()).toMatchObject({ provider_kind: "alternate-route", provider_task_id: "alt:task-9" })
    expect(record()?.state).toBe("running")
  })

  it("a status this process cannot read, again and again: pending after a few reads", async () => {
    vi.useFakeTimers()
    const poll = vi.fn(async () => ({ state: "unreadable" as const }))
    service({ poll })
    const p = takeAlternateRoute(RUN)
    const settled = expect(p).rejects.toBeInstanceOf(AlternateRoutePendingError)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await settled
    expect(poll).toHaveBeenCalledTimes(ALTERNATE_ROUTE_MAX_UNREADABLE_READS)
    expect(job().provider_task_id).toBe("alt:task-9")
  })

  it("an unreadable read right after the start that then reads done: delivered", async () => {
    vi.useFakeTimers()
    const poll = vi.fn()
      .mockResolvedValueOnce({ state: "unreadable" })
      .mockResolvedValueOnce({ state: "unreadable" })
      .mockResolvedValueOnce({ state: "done", resultUrl: "https://out.example/v.mp4" })
    service({ poll })
    const p = takeAlternateRoute(RUN)
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await p)?.routedVia).toBe("route-1")
  })

  it("done without a result file (charged): never falls back; one alert; left to the recovery at the budget", async () => {
    vi.useFakeTimers()
    const poll = vi.fn(async () => ({ state: "done" as const, resultUrl: "" }))
    service({ poll })
    const p = takeAlternateRoute(RUN)
    const settled = expect(p).rejects.toBeInstanceOf(AlternateRoutePendingError)
    await vi.advanceTimersByTimeAsync(ALTERNATE_ROUTE_BUDGET_MS + 60_000)
    await settled
    expect(poll.mock.calls.length).toBeGreaterThan(2)
    expect(job()).toMatchObject({ provider_kind: "alternate-route", provider_task_id: "alt:task-9" })
    expect(typeof record()?.doneWithoutResultAt).toBe("number")
    expect(errorSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("without a result file"))).toHaveLength(1)
  })

  it("a recovery's resend claimed the row while the worker read the task: the worker's fallback misses, the default request is not sent twice", async () => {
    service({
      poll: vi.fn(async () => {
        // What the recovery's resend claim writes: a fresh token and the record.
        job().provider_task_id = "alt:resending:00000000-0000-4000-8000-000000000001"
        job().input_data = { ...(job().input_data as Record<string, unknown>), [ALTERNATE_ROUTE_KEY]: { ...record(), state: "resubmitting", at: Date.now() } }
        return { state: "failed" as const, message: "refused" }
      }),
    })
    await expect(takeAlternateRoute(RUN)).rejects.toBeInstanceOf(AlternateRoutePendingError)
    expect(job().provider_task_id).toMatch(/^alt:resending:/)
    expect(record()?.state).toBe("resubmitting")
  })

  it("the fallback write also loses on a record that says a resend is in progress, whatever the task id", async () => {
    service({
      poll: vi.fn(async () => {
        job().input_data = { ...(job().input_data as Record<string, unknown>), [ALTERNATE_ROUTE_KEY]: { ...record(), state: "resubmitting", at: Date.now() } }
        return { state: "failed" as const, message: "refused" }
      }),
    })
    await expect(takeAlternateRoute(RUN)).rejects.toBeInstanceOf(AlternateRoutePendingError)
    expect(job().provider_task_id).toBe("alt:task-9")
  })

  it("an unsaved reference whose row a resend took: the save misses, the task is alerted as an orphan, the route stops", async () => {
    vi.useFakeTimers()
    mocks.failWrite.when = savesReference
    const poll = vi.fn(async () => {
      mocks.failWrite.when = undefined
      job().provider_task_id = "alt:resending:00000000-0000-4000-8000-000000000002"
      return { state: "running" as const }
    })
    service({ poll })
    const p = takeAlternateRoute(RUN)
    const settled = expect(p).rejects.toBeInstanceOf(AlternateRoutePendingError)
    await vi.advanceTimersByTimeAsync(60_000)
    await settled
    expect(poll).toHaveBeenCalledTimes(1)
    expect(job().provider_task_id).toMatch(/^alt:resending:/)
    expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n")).toMatch(/\[ALERT\] job j-1: .*task task-9/)
  })

  it("status reads that keep failing: pending", async () => {
    vi.useFakeTimers()
    service({ poll: vi.fn(async () => { throw new Error("read timeout") }) })
    const p = takeAlternateRoute(RUN)
    const settled = expect(p).rejects.toBeInstanceOf(AlternateRoutePendingError)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    await settled
    expect(job().provider_task_id).toBe("alt:task-9")
  })

  it("a fallback whose write does not land (the row moved): pending, never the default request", async () => {
    service({
      poll: vi.fn(async () => {
        job().provider_task_id = "default-7"
        job().provider_kind = "kie-standard"
        return { state: "failed" as const, message: "refused" }
      }),
    })
    await expect(takeAlternateRoute(RUN)).rejects.toBeInstanceOf(AlternateRoutePendingError)
    expect(job().provider_task_id).toBe("default-7")
  })

  it("this route's reference already on the row: read, never started again", async () => {
    const s = service()
    Object.assign(job(), {
      provider_kind: "alternate-route",
      provider_task_id: "alt:task-3",
      input_data: { [ALTERNATE_ROUTE_KEY]: { state: "running", at: 1, routeId: "route-1", taskRef: "task-3", fallback: { taskModel: "vendor/model-a", modelKey: "model-a", body: BODY } } },
    })
    expect((await takeAlternateRoute(RUN))?.routedVia).toBe("route-1")
    expect(s.start).not.toHaveBeenCalled()
    expect(s.poll).toHaveBeenCalledWith("route-1", "task-3")
  })

  it("this route's claim with no reference: pending, never started, never the default request", async () => {
    const s = service()
    Object.assign(job(), { provider_kind: "alternate-route", provider_task_id: ALTERNATE_ROUTE_CLAIM_REF })
    await expect(takeAlternateRoute(RUN)).rejects.toBeInstanceOf(AlternateRoutePendingError)
    expect(s.start).not.toHaveBeenCalled()
  })

  it("a reference that can never be saved: final (failed and refunded by the worker) instead of left for a recovery that would resend beside it", async () => {
    vi.useFakeTimers()
    mocks.failWrite.when = savesReference
    service({ poll: vi.fn(async () => ({ state: "running" as const })) })
    const p = takeAlternateRoute(RUN)
    const settled = expect(p).rejects.toMatchObject({ deterministic: true })
    await vi.advanceTimersByTimeAsync(ALTERNATE_ROUTE_BUDGET_MS + 60_000)
    await settled
    await expect(p).rejects.not.toBeInstanceOf(AlternateRoutePendingError)
    expect(errorSpy).toHaveBeenCalled()
  })

  it("the job taken (still live) while start ran: left to its holder, never failed from here", async () => {
    service({
      start: vi.fn(async () => {
        Object.assign(job(), { provider_kind: "kie-standard", provider_task_id: "default-2" })
        return { taskRef: "task-9" }
      }),
    })
    await expect(takeAlternateRoute(RUN)).rejects.toBeInstanceOf(AlternateRoutePendingError)
    expect(job().provider_task_id).toBe("default-2")
  })

  it("the job ended while start ran: final, the row left as it is, with an alert", async () => {
    service({
      start: vi.fn(async () => {
        job().status = "failed"
        return { taskRef: "task-9" }
      }),
    })
    await expect(takeAlternateRoute(RUN)).rejects.toBeInstanceOf(AlternateRouteJobEndedError)
    expect(job().provider_task_id).toBe(ALTERNATE_ROUTE_CLAIM_REF)
    expect(errorSpy).toHaveBeenCalled()
  })
})

it("never changes the prepared body", async () => {
  service({ poll: vi.fn(async () => ({ state: "failed" as const, message: "x" })) })
  const body = structuredClone(BODY) as Record<string, unknown>
  const before = JSON.stringify(body)
  await takeAlternateRoute({ ...RUN, body })
  expect(JSON.stringify(body)).toBe(before)
})
