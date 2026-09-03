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
  withdrawHeldJob: vi.fn(async () => ({ ok: true }) as { ok: boolean; reason?: string }),
}))
vi.mock("../supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../queue.js", () => ({ tryRemoveFromQueue: mocks.tryRemoveFromQueue }))
vi.mock("../../ee/billing/credits.js", () => ({ CreditsService: { refundCredits: mocks.refundCredits } }))
// The held-job resolver. Reached through a DYNAMIC import so this module's
// static graph (supabase + queue) is unchanged — job-policy-gate pulls storage
// and the credit lifecycle behind it.
vi.mock("../job-policy-gate.js", () => ({ withdrawHeldJob: mocks.withdrawHeldJob }))

import { cancelOwnedJob } from "../cancel-job.js"

const USER = "00000000-0000-4000-8000-000000000001"
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

/**
 * jobs: select().eq().single() for the lookup; update().eq().eq().in().select()
 * for the CAS. `reread` is what the SECOND single() answers — the status
 * re-read that tells a lost race apart from a row that got parked while we were
 * scanning the BullMQ queue.
 */
function jobsTable(
  lookup: Record<string, unknown> | null,
  flipped: Array<{ id: string }> = [{ id: JOB }],
  reread?: Record<string, unknown> | null,
) {
  const answer = (row: Record<string, unknown> | null | undefined) =>
    row ? { data: row, error: null } : { data: null, error: { message: "not found" } }
  let reads = 0
  const single = vi.fn().mockImplementation(async () => {
    reads += 1
    return answer(reads === 1 || reread === undefined ? lookup : reread)
  })
  const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single }) })
  const updateSelect = vi.fn().mockResolvedValue({ data: flipped, error: null })
  const inFn = vi.fn().mockReturnValue({ select: updateSelect })
  const eq2 = vi.fn().mockReturnValue({ in: inFn })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const update = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, update, _update: update, _in: inFn }
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.withdrawHeldJob.mockResolvedValue({ ok: true })
})

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

// ---------------------------------------------------------------------------
// D17 — user cancel WINS over a held job.
//
// Two things stood in the way and both had to go. `CANCELLABLE_STATUSES`
// omitted `pending_review`, so the API answered 400 "cannot be cancelled" —
// while `node-executor.ts`'s DAG cancel flipped the same row anyway, which is
// the two halves of one product disagreeing. And even with the status added,
// a held job normally HAS a `provider_task_id` (the provider delivered; it is
// the PLATFORM holding the result), so the `provider_task_id && !inRecovery →
// in_flight` branch would have refused it forever.
//
// A reservation must not be strandable behind a reviewer's SLA.
// ---------------------------------------------------------------------------
describe("cancelOwnedJob — a job under review", () => {
  const held = (extra: Record<string, unknown> = {}) =>
    live({ status: "pending_review", provider_task_id: "task-out-at-the-provider", ...extra })

  it("cancels a held row instead of answering invalid_status", async () => {
    tables(jobsTable(held()))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.withdrawHeldJob).toHaveBeenCalledWith(JOB)
  })

  it("never routes a held row through in_flight, even with a provider task out", async () => {
    tables(jobsTable(held({ reconcile_attempts: 0 })))
    expect(await cancelOwnedJob(JOB, USER)).not.toEqual({ kind: "in_flight" })
  })

  it("skips the queue removal: the BullMQ entry is long gone by the time a job is held", async () => {
    tables(jobsTable(held()))
    await cancelOwnedJob(JOB, USER)
    expect(mocks.tryRemoveFromQueue).not.toHaveBeenCalled()
  })

  it("does not use the generic refund path — the withdrawal owns the refund, the object deletion and the audit row", async () => {
    tables(jobsTable(held()), usageLogsTable([{ id: "log-1" }]))
    await cancelOwnedJob(JOB, USER)
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("a lost race (a reviewer resolved it first) reports lost_race, not a false success", async () => {
    mocks.withdrawHeldJob.mockResolvedValue({ ok: false, reason: "lost_race" })
    tables(jobsTable(held()))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
  })

  it("still reports the analysis child so the caller can take it along", async () => {
    const child = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    tables(jobsTable(held({ input_data: { analysisJobId: child } })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: child })
  })

  it("ownership is still checked first — another user's held job is forbidden, not withdrawn", async () => {
    tables(jobsTable(held({ user_id: "someone-else" })))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "forbidden" })
    expect(mocks.withdrawHeldJob).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The generic CAS and the eligibility check are NOT the same status set.
//
// `CANCELLABLE_STATUSES` is deliberately wide (D17: a parked row IS cancellable,
// through the withdrawal). The CAS is a different question — "which statuses may
// this UPDATE flip straight to `cancelled`?" — and `pending_review` is not one of
// them: the queue scan between the SELECT and the UPDATE is real work (two
// BullMQ getJobs sweeps plus a dynamic import), long enough for the result gate
// to park the row underneath us. Flipping it there loses everything the
// withdrawal exists to do: the withheld R2 objects are never deleted, the
// `held_*` columns stay populated on a cancelled row, and no `withdrawn`
// decision is ever recorded.
// ---------------------------------------------------------------------------
describe("cancelOwnedJob — a job parked between the read and the flip", () => {
  it("never lets the generic CAS flip a parked row", async () => {
    const jobs = jobsTable(live({ status: "processing" }))
    tables(jobs)
    await cancelOwnedJob(JOB, USER)
    expect(jobs._in).toHaveBeenCalledTimes(1)
    const statuses = jobs._in.mock.calls[0]![1] as string[]
    expect(statuses).not.toContain("pending_review")
    expect(statuses).toEqual(expect.arrayContaining(["pending", "queued", "processing"]))
  })

  it("routes a now-parked row through the withdrawal instead of answering lost_race", async () => {
    tables(jobsTable(live({ status: "processing" }), [], { status: "pending_review" }), usageLogsTable([{ id: "log-1" }]))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "cancelled", analysisJobId: null })
    expect(mocks.withdrawHeldJob).toHaveBeenCalledWith(JOB)
    // The withdrawal owns the refund (plus the object deletion and the audit row).
    expect(mocks.refundCredits).not.toHaveBeenCalled()
  })

  it("a withdrawal that itself loses the race is reported, not swallowed", async () => {
    mocks.withdrawHeldJob.mockResolvedValue({ ok: false, reason: "lost_race" })
    tables(jobsTable(live({ status: "processing" }), [], { status: "pending_review" }))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
  })

  it("a genuine terminal race is still lost_race — no withdrawal attempted", async () => {
    tables(jobsTable(live({ status: "processing" }), [], { status: "failed" }))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
    expect(mocks.withdrawHeldJob).not.toHaveBeenCalled()
  })

  it("a row that vanished between the read and the flip is lost_race, not a crash", async () => {
    tables(jobsTable(live({ status: "processing" }), [], null))
    expect(await cancelOwnedJob(JOB, USER)).toEqual({ kind: "lost_race" })
    expect(mocks.withdrawHeldJob).not.toHaveBeenCalled()
  })
})
