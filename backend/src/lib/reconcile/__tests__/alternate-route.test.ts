import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The recovery of a job an alternate route holds (lib/reconcile/alternate-route.ts):
 * it reads the task through the plugin and never starts one on the route; a
 * failed task is sent to the default upstream as it was prepared; a process
 * that cannot read the task leaves the row alone — attempts not bumped — until
 * the age bound fails and refunds it.
 */

const mocks = vi.hoisted(() => {
  const state: { job: Record<string, unknown> } = { job: {} }
  const builder = (patch?: Record<string, unknown>) => {
    const filters: Array<(j: Record<string, unknown>) => boolean> = []
    const matches = () => filters.every((f) => f(state.job))
    const chain = {
      // A JSON path (`a->b->>c`) is read through the row's nested objects; SQL: NULL <> x is not true.
      neq: (col: string, val: unknown) => (filters.push((j) => {
        const v = col.split(/->>?/).reduce<unknown>((o, k) => (o as Record<string, unknown> | null | undefined)?.[k], j)
        return v !== null && v !== undefined && v !== val
      }), chain),
      eq: (col: string, val: unknown) => (filters.push((j) => j[col] !== null && j[col] !== undefined && j[col] === val), chain),
      is: (col: string, val: unknown) => (filters.push((j) => (j[col] ?? null) === val), chain),
      in: (col: string, vals: unknown[]) => (filters.push((j) => vals.includes(j[col])), chain),
      maybeSingle: async () => ({ data: matches() ? structuredClone(state.job) : null, error: null }),
      select: async () => {
        if (!matches()) return { data: [], error: null }
        Object.assign(state.job, structuredClone(patch))
        return { data: [{ id: state.job.id }], error: null }
      },
    }
    return chain
  }
  return {
    state,
    from: vi.fn(() => ({ select: () => builder(), update: (patch: Record<string, unknown>) => builder(patch) })),
    createKieTask: vi.fn(),
    markJobFailed: vi.fn(async () => true),
    refund: vi.fn(async () => 0),
    bump: vi.fn(async () => {}),
    finalizeRecoveredMedia: vi.fn(async () => {}),
    reconcileKieJob: vi.fn(async () => {}),
  }
})

vi.mock("../../supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../../job-failure.js", () => ({ FAILABLE_STATUSES: ["pending", "processing"], markJobFailed: mocks.markJobFailed }))
vi.mock("../../credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: mocks.refund }))
vi.mock("../bump-attempts.js", () => ({ bumpAttemptsOrExhaust: mocks.bump }))
vi.mock("../kie.js", () => ({ finalizeRecoveredMedia: mocks.finalizeRecoveredMedia, reconcileKieJob: mocks.reconcileKieJob }))
vi.mock("../../job-cost-columns.js", () => ({ jobCostColumns: async (cost: number | null) => ({ provider_cost: cost }) }))
vi.mock("../../../providers/kie/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/kie/client.js")>()),
  createKieTask: mocks.createKieTask,
}))

import { setPluginServices, _resetPluginServicesForTests } from "../../private-plugins/services-registry.js"
import type { PluginAlternateRoutesService } from "../../private-plugins/types.js"
import {
  ALTERNATE_ROUTE_CLAIM_GRACE_MS,
  ALTERNATE_ROUTE_RESEND_LIVE_MS,
  ALTERNATE_ROUTE_UNREAD_LIMIT_MS,
  reconcileAlternateRouteJob,
} from "../alternate-route.js"
import { ALTERNATE_ROUTE_CLAIM_REF, ALTERNATE_ROUTE_KEY } from "../../alternate-route-request.js"
import { createUpstreamFailureError } from "../../../providers/kie/client.js"
import { STALE_THRESHOLD_MS } from "../types.js"

const BODY = { prompt: "Change the jacket in @video_1", resolution: "720p", reference_video_urls: ["https://media.example/clip.mp4"] }
const FALLBACK = { taskModel: "vendor/model-a", modelKey: "model-a", body: BODY }
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const job = () => mocks.state.job
const record = () => (job().input_data as Record<string, unknown>)[ALTERNATE_ROUTE_KEY] as Record<string, unknown>
const rowArg = () => ({
  id: "j-1",
  provider_task_id: job().provider_task_id as string,
  reconcile_attempts: 2,
  job_type: "text-to-video",
  input_data: job().input_data as Record<string, unknown>,
})

function service(poll: PluginAlternateRoutesService["poll"]): { start: ReturnType<typeof vi.fn>; poll: ReturnType<typeof vi.fn> } {
  const s = { accepts: vi.fn(() => ({ routeId: "route-1" })), start: vi.fn(), poll: vi.fn(poll) }
  setPluginServices({ alternateRoutes: s as unknown as PluginAlternateRoutesService })
  return s
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  _resetPluginServicesForTests()
  mocks.state.job = {
    id: "j-1",
    status: "processing",
    provider_kind: "alternate-route",
    provider_task_id: "alt:task-9",
    provider_call_started_at: ago(40 * 60_000),
    reconcile_attempts: 2,
    reconcile_last_error: null,
    input_data: { provider: "model-a", [ALTERNATE_ROUTE_KEY]: { state: "running", at: Date.now() - 40 * 60_000, routeId: "route-1", taskRef: "task-9", fallback: FALLBACK } },
  }
  mocks.createKieTask.mockResolvedValue({ taskId: "default-1" })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => _resetPluginServicesForTests())

describe("a Kling 4.0 resend at 4K or in HDR keeps the long kind", () => {
  it.each([
    [{ prompt: "p", resolution: "4k" }, "kie-long-video"],
    [{ prompt: "p", resolution: "1080p", dynamic_range: "hdr" }, "kie-long-video"],
    [{ prompt: "p", resolution: "1080p" }, "kie-standard"],
  ] as const)("%o → %s", async (body, kind) => {
    const fallback = { taskModel: "kling-4.0/reference-to-video", modelKey: "kling-4", body }
    job().input_data = { provider: "kling-4", [ALTERNATE_ROUTE_KEY]: { state: "running", at: Date.now() - 40 * 60_000, routeId: "route-1", taskRef: "task-9", fallback } }
    service(async () => ({ state: "failed", message: "refused" }))
    await reconcileAlternateRouteJob(rowArg())
    expect(job()).toMatchObject({ provider_kind: kind, provider_task_id: "default-1" })
  })
})

describe("a process that cannot read the task leaves the row alone", () => {
  it("no service registered: untouched, attempts not bumped", async () => {
    const before = structuredClone(job())
    await reconcileAlternateRouteJob(rowArg())
    expect(job()).toEqual(before)
    expect(mocks.bump).not.toHaveBeenCalled()
    expect(mocks.markJobFailed).not.toHaveBeenCalled()
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it("the service says it cannot read that task: untouched, attempts not bumped", async () => {
    service(async () => ({ state: "unreadable" }))
    const before = structuredClone(job())
    await reconcileAlternateRouteJob(rowArg())
    expect(job()).toEqual(before)
    expect(mocks.bump).not.toHaveBeenCalled()
    expect(mocks.markJobFailed).not.toHaveBeenCalled()
  })

  it("past the age bound: failed through the failure funnel and refunded", async () => {
    job().provider_call_started_at = ago(ALTERNATE_ROUTE_UNREAD_LIMIT_MS + 60_000)
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.markJobFailed).toHaveBeenCalledWith("j-1", expect.objectContaining({ reconcile_last_error: "alternate_route_unread" }))
    expect(mocks.refund).toHaveBeenCalledWith("j-1")
    expect(mocks.bump).not.toHaveBeenCalled()
  })

  it("a row that moved on is not touched", async () => {
    service(async () => ({ state: "failed", message: "x" }))
    job().provider_task_id = "default-3"
    job().provider_kind = "kie-standard"
    await reconcileAlternateRouteJob({ ...rowArg(), provider_task_id: "alt:task-9" })
    expect(mocks.createKieTask).not.toHaveBeenCalled()
    expect(mocks.finalizeRecoveredMedia).not.toHaveBeenCalled()
  })
})

describe("a task this process can read", () => {
  it("done: delivered through the shared recovery tail with the route's figure, never a default-upstream task id", async () => {
    const s = service(async () => ({ state: "done", resultUrl: "https://out.example/v.mp4", providerCostUsd: 0.42, providerMs: 900 }))
    await reconcileAlternateRouteJob(rowArg(), { claimant: "worker" })
    expect(s.start).not.toHaveBeenCalled()
    expect(mocks.finalizeRecoveredMedia).toHaveBeenCalledTimes(1)
    const [row, jobType, delivered, opts] = mocks.finalizeRecoveredMedia.mock.calls[0] as unknown as [Record<string, unknown>, string, Record<string, unknown>, Record<string, unknown>]
    expect(row.id).toBe("j-1")
    expect(jobType).toBe("text-to-video")
    expect(delivered).toEqual({ url: "https://out.example/v.mp4", cost: 0.42, providerUsed: "alternate", providerMs: 900 })
    expect(delivered).not.toHaveProperty("kieTaskId")
    expect(opts).toEqual({ claimant: "worker" })
  })

  it("running (the cron's one read): attempts bumped, nothing sent", async () => {
    service(async () => ({ state: "running" }))
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.bump).toHaveBeenCalledTimes(1)
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it.each(["failed", "expired"] as const)("%s: the saved default request is sent once, and the row moves to the default upstream's kind", async (state) => {
    service(async () => ({ state, message: "refused" }))
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.createKieTask).toHaveBeenCalledTimes(1)
    expect(mocks.createKieTask.mock.calls[0]![0]).toBe("vendor/model-a")
    expect(mocks.createKieTask.mock.calls[0]![1]).toEqual(BODY)
    expect(mocks.createKieTask.mock.calls[0]![2]).toMatchObject({ modelKey: "model-a" })
    expect(job()).toMatchObject({ provider_kind: "kie-standard", provider_task_id: "default-1", reconcile_attempts: 0 })
    expect(record()).toMatchObject({ state: "fell-back", reason: state, taskRef: "task-9" })
    expect(mocks.markJobFailed).not.toHaveBeenCalled()

    // A second reconciler reaching the same (now moved) row sends nothing.
    await reconcileAlternateRouteJob({ ...rowArg(), provider_task_id: "alt:task-9" })
    expect(mocks.createKieTask).toHaveBeenCalledTimes(1)
  })

  it("a resend another reconciler is making: left alone; one that died: failed and refunded, never sent twice", async () => {
    service(async () => ({ state: "failed", message: "refused" }))
    job().provider_task_id = "alt:resending:00000000-0000-4000-8000-000000000003"
    ;(job().input_data as Record<string, unknown>)[ALTERNATE_ROUTE_KEY] = { ...record(), state: "resubmitting", at: Date.now(), message: "refused" }
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.createKieTask).not.toHaveBeenCalled()
    expect(mocks.markJobFailed).not.toHaveBeenCalled()

    ;(job().input_data as Record<string, unknown>)[ALTERNATE_ROUTE_KEY] = { ...record(), at: Date.now() - ALTERNATE_ROUTE_RESEND_LIVE_MS - 1_000 }
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.createKieTask).not.toHaveBeenCalled()
    expect(mocks.markJobFailed).toHaveBeenCalledTimes(1)
    expect(mocks.refund).toHaveBeenCalledWith("j-1")
    expect(errorSpy).toHaveBeenCalled()
  })

  it("the resend's claim replaces the held task id with a fresh token, so a write keyed on the old value misses — and no value another writer can restore unlocks it", async () => {
    service(async () => ({ state: "failed", message: "refused" }))
    let duringSend: Record<string, unknown> | undefined
    mocks.createKieTask.mockImplementationOnce(async () => {
      duringSend = structuredClone(job())
      // Another reconciler rewriting reconcile_last_error (as the attempt
      // ladder does, with no compare) changes nothing the resend keys on.
      job().reconcile_last_error = null
      return { taskId: "default-1" }
    })
    await reconcileAlternateRouteJob(rowArg())
    expect(duringSend?.provider_task_id).toMatch(/^alt:resending:[0-9a-f-]{36}$/)
    expect(job()).toMatchObject({ provider_task_id: "default-1", provider_kind: "kie-standard" })

    // A second resend of the same row (the cron after an inline re-pick) finds nothing to do.
    await reconcileAlternateRouteJob({ ...rowArg(), provider_task_id: "alt:task-9" })
    expect(mocks.createKieTask).toHaveBeenCalledTimes(1)
  })

  it("a failed resend send keeps the default upstream's refusal classification on the hint", async () => {
    service(async () => ({ state: "failed", message: "refused" }))
    ;(job().input_data as Record<string, unknown>).referenceVideoUrls = ["https://media.example/clip.mp4"]
    mocks.createKieTask.mockRejectedValueOnce(createUpstreamFailureError("The input video was rejected", "Video generation", { inputVideoRefused: true }))
    await reconcileAlternateRouteJob(rowArg())
    const fields = (mocks.markJobFailed.mock.calls[0] as unknown as [string, Record<string, unknown>])[1]
    expect(fields.error_hint).toBeTruthy()
    expect(mocks.refund).toHaveBeenCalledWith("j-1")
  })

  it("inline (a re-pick): the new default task is read to its end right after the resend", async () => {
    service(async () => ({ state: "failed", message: "refused" }))
    await reconcileAlternateRouteJob(rowArg(), { claimant: "worker", pollToEnd: true })
    expect(mocks.reconcileKieJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "j-1", provider_kind: "kie-standard", provider_task_id: "default-1" }),
      expect.objectContaining({ claimant: "worker", pollAttempts: expect.any(Number) }),
    )
  })

  it("the cron: the new default row is stamped past its kind's threshold, so the next tick reads it", async () => {
    service(async () => ({ state: "failed", message: "refused" }))
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.reconcileKieJob).not.toHaveBeenCalled()
    const stampedAgo = Date.now() - Date.parse(job().provider_call_started_at as string)
    expect(stampedAgo).toBeGreaterThan(STALE_THRESHOLD_MS["kie-standard"])
  })

  it("done without a result file (charged): never resent, no bump, one alert per job; the age bound fails and refunds it", async () => {
    service(async () => ({ state: "done", resultUrl: "" }))
    await reconcileAlternateRouteJob(rowArg())
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.createKieTask).not.toHaveBeenCalled()
    expect(mocks.bump).not.toHaveBeenCalled()
    expect(mocks.finalizeRecoveredMedia).not.toHaveBeenCalled()
    expect(typeof record().doneWithoutResultAt).toBe("number")
    expect(errorSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("without a result file"))).toHaveLength(1)

    job().provider_call_started_at = ago(ALTERNATE_ROUTE_UNREAD_LIMIT_MS + 60_000)
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.markJobFailed).toHaveBeenCalledTimes(1)
    expect(mocks.refund).toHaveBeenCalledWith("j-1")
    expect(mocks.createKieTask).not.toHaveBeenCalled()
  })

  it("failed with no saved default request: failed with the upstream's words and refunded", async () => {
    service(async () => ({ state: "failed", message: "The input video was refused" }))
    ;(job().input_data as Record<string, unknown>)[ALTERNATE_ROUTE_KEY] = { state: "running", at: 1, routeId: "route-1", taskRef: "task-9" }
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.createKieTask).not.toHaveBeenCalled()
    expect(mocks.markJobFailed).toHaveBeenCalledWith("j-1", expect.objectContaining({ reconcile_last_error: "upstream_failed" }))
    expect(mocks.refund).toHaveBeenCalledWith("j-1")
  })

  it("the default request cannot be sent: failed and refunded", async () => {
    service(async () => ({ state: "failed", message: "refused" }))
    mocks.createKieTask.mockRejectedValueOnce(new Error("upstream down"))
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.markJobFailed).toHaveBeenCalledTimes(1)
    expect(mocks.refund).toHaveBeenCalledWith("j-1")
  })
})

describe("claimed with no reference saved", () => {
  beforeEach(() => {
    job().provider_task_id = ALTERNATE_ROUTE_CLAIM_REF
    ;(job().input_data as Record<string, unknown>)[ALTERNATE_ROUTE_KEY] = { state: "claimed", at: 1, routeId: "route-1", fallback: FALLBACK }
  })

  it("no service in this process, past the grace: untouched (never resent, never bumped)", async () => {
    const before = structuredClone(job())
    await reconcileAlternateRouteJob(rowArg())
    expect(job()).toEqual(before)
    expect(mocks.createKieTask).not.toHaveBeenCalled()
    expect(mocks.bump).not.toHaveBeenCalled()
    expect(mocks.markJobFailed).not.toHaveBeenCalled()
  })

  it("inside the grace (a start may be in flight): left alone", async () => {
    service(async () => ({ state: "running" }))
    job().provider_call_started_at = ago(ALTERNATE_ROUTE_CLAIM_GRACE_MS - 60_000)
    await reconcileAlternateRouteJob(rowArg())
    expect(mocks.createKieTask).not.toHaveBeenCalled()
    expect(mocks.bump).not.toHaveBeenCalled()
  })

  it("past the grace: an alert, and the default request sent once", async () => {
    const s = service(async () => ({ state: "running" }))
    await reconcileAlternateRouteJob(rowArg())
    expect(s.poll).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n")).toMatch(/\[ALERT\] job j-1/)
    expect(mocks.createKieTask).toHaveBeenCalledTimes(1)
    expect(job()).toMatchObject({ provider_kind: "kie-standard", provider_task_id: "default-1" })
  })
})
