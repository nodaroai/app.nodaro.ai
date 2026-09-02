/**
 * cancelOwnedJob — the single-job cancel body as a helper. The route tests
 * (routes/__tests__/cancel-jobs.test.ts) cover the HTTP envelope; this file
 * covers the decision table and the one new fact: a cancelled row reports its
 * analysis child so the caller can cancel that too.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  tryRemoveFromQueue: vi.fn(async () => {}),
  refundCredits: vi.fn(async () => {}),
}))
vi.mock("../supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../queue.js", () => ({ tryRemoveFromQueue: mocks.tryRemoveFromQueue }))
vi.mock("../../ee/billing/credits.js", () => ({ CreditsService: { refundCredits: mocks.refundCredits } }))

import { cancelOwnedJob } from "../cancel-job.js"

const USER = "00000000-0000-4000-8000-000000000001"
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

/** jobs: select().eq().single() for the lookup; update().eq().eq().in().select() for the CAS. */
function jobsTable(lookup: Record<string, unknown> | null, flipped: Array<{ id: string }> = [{ id: JOB }]) {
  const single = vi.fn().mockResolvedValue(lookup ? { data: lookup, error: null } : { data: null, error: { message: "not found" } })
  const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single }) })
  const updateSelect = vi.fn().mockResolvedValue({ data: flipped, error: null })
  const inFn = vi.fn().mockReturnValue({ select: updateSelect })
  const eq2 = vi.fn().mockReturnValue({ in: inFn })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const update = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, update, _update: update }
}
/** usage_logs: select().in().eq() → reserved rows. */
function usageLogsTable(rows: Array<{ id: string }>) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null })
  return { select: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue({ eq }) }) }
}
function tables(jobs: ReturnType<typeof jobsTable>, logs = usageLogsTable([])) {
  mocks.from.mockImplementation((table: string) => {
    if (table === "jobs") return jobs
    if (table === "usage_logs") return logs
    throw new Error(`unexpected table ${table}`)
  })
}
const live = (extra: Record<string, unknown> = {}) => ({
  id: JOB, status: "pending", user_id: USER, input_data: {}, provider_task_id: null, reconcile_attempts: 0, ...extra,
})

beforeEach(() => vi.clearAllMocks())

describe("cancelOwnedJob", () => {
  it("not_found when the row is missing", async () => {
    tables(jobsTable(null))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "not_found" })
  })
  it("forbidden when another user owns it — nothing touched", async () => {
    const jobs = jobsTable(live({ user_id: "someone-else" }))
    tables(jobs)
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "forbidden" })
    expect(jobs._update).not.toHaveBeenCalled()
    expect(mocks.tryRemoveFromQueue).not.toHaveBeenCalled()
  })
  it("invalid_status for a terminal row", async () => {
    tables(jobsTable(live({ status: "completed" })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "invalid_status", status: "completed" })
  })
  it("in_flight when the provider task is out and the row is not in recovery", async () => {
    tables(jobsTable(live({ status: "processing", provider_task_id: "task-1" })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "in_flight" })
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })
  it("cancels an in-recovery row despite provider_task_id (audit D2)", async () => {
    tables(jobsTable(live({ status: "processing", provider_task_id: "task-1", reconcile_attempts: 2 })), usageLogsTable([{ id: "log-1" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.refundCredits).toHaveBeenCalledWith("log-1")
  })
  it("removes from the queue, CAS-flips, refunds every reserved log, and reports the analysis child", async () => {
    const child = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    tables(jobsTable(live({ input_data: { type: "llm-structured", analysisJobId: child } })), usageLogsTable([{ id: "log-1" }, { id: "log-2" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: child })
    expect(mocks.tryRemoveFromQueue).toHaveBeenCalledWith(JOB)
    expect(mocks.refundCredits).toHaveBeenCalledTimes(2)
  })
  it("lost_race when the CAS flips no row — no refund (the terminal writer owns the credits)", async () => {
    tables(jobsTable(live(), []), usageLogsTable([{ id: "log-1" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })
})
