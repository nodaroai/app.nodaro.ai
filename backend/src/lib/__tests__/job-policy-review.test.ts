/**
 * Approve / reject of a held job (spec §5.5's review rows, §9.1, D9).
 *
 * Approve is a SINGLE UPDATE, not a flip-then-compensate: `markJobCompleted`'s
 * CAS is deliberately NOT widened to admit `pending_review` (D9) — widening it
 * would let any stray worker complete a held row and re-enter the result gate.
 * Approve therefore does its own CAS, commits, and calls the SAME tail finalize
 * runs, so the two cannot drift.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => {
  const heldRow = {
    value: {
      id: "job-1",
      user_id: "u1",
      status: "pending_review",
      workflow_execution_id: null,
      input_data: { attachToCharacterId: null },
      held_output_data: { videoUrl: "https://cdn.example.com/videos/job-1.mp4" },
      held_completion_fields: {
        provider: "kie",
        provider_cost: 0.4,
        display_cost: 12,
        metered: true,
        extraNonProviderCredits: 3,
        meteredCost: 0.4,
      },
      held_objects: [{ key: "videos/job-1.mp4", kind: "video", index: 0 }],
    } as Record<string, unknown> | null,
  }
  const casRows = { value: [{ id: "job-1" }] as unknown[] }
  const casError = { value: null as unknown }
  const updateArgs: Record<string, unknown>[] = []
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: heldRow.value, error: null }) }) }),
    update: (arg: Record<string, unknown>) => {
      updateArgs.push(arg)
      return {
        eq: () => ({
          eq: () => ({ select: () => Promise.resolve({ data: casRows.value, error: casError.value }) }),
          in: () => ({ select: () => Promise.resolve({ data: casRows.value, error: casError.value }) }),
        }),
      }
    },
  }))
  return { from, heldRow, casRows, casError, updateArgs }
})

vi.mock("../supabase.js", () => ({ supabase: { from: db.from } }))

const finalize = vi.hoisted(() => ({
  runCompletionTail: vi.fn(async (_job: Record<string, unknown>, _videoUrl?: string) => undefined),
  loadUsageLogId: vi.fn(async () => "log-1"),
}))
vi.mock("../job-finalize.js", () => finalize)

const shared = vi.hoisted(() => ({
  commitJobCredits: vi.fn(
    async (
      _logId: string | null,
      _jobId: string,
      _cost?: number | null,
      _extra?: number,
      _metered?: boolean,
    ) => undefined,
  ),
  refundLoopTrimAddon: vi.fn(
    async (_jobId: string, _usageLogId: string | null | undefined, _addon: number) => undefined,
  ),
}))
vi.mock("../../workers/shared.js", () => shared)

const gate = vi.hoisted(() => ({
  rejectHeldJobRow: vi.fn(
    async (_jobId: string, _input: Record<string, unknown>) => ({ ok: true }) as { ok: boolean; reason?: string },
  ),
}))
vi.mock("../job-policy-gate.js", () => gate)

const audit = vi.hoisted(() => ({
  recordJobPolicyDecision: vi.fn(async (_input: Record<string, unknown>) => "d-1"),
}))
vi.mock("../job-policy-audit.js", () => audit)

import { approveHeldJob, rejectHeldJob, resolveHeldJob } from "../job-policy-review.js"

const REVIEWER = { userId: "admin-1", email: "admin@example.com" }

beforeEach(() => {
  vi.clearAllMocks()
  db.updateArgs.length = 0
  db.casRows.value = [{ id: "job-1" }]
  db.casError.value = null
  db.heldRow.value = {
    id: "job-1",
    user_id: "u1",
    status: "pending_review",
    workflow_execution_id: null,
    input_data: {},
    held_output_data: { videoUrl: "https://cdn.example.com/videos/job-1.mp4" },
    held_completion_fields: {
      provider: "kie", provider_cost: 0.4, display_cost: 12,
      metered: true, extraNonProviderCredits: 3, meteredCost: 0.4,
    },
    held_objects: [{ key: "videos/job-1.mp4", kind: "video", index: 0 }],
  }
  gate.rejectHeldJobRow.mockResolvedValue({ ok: true })
})

describe("approveHeldJob", () => {
  it("settles a failed-loop-trim job at (reserved minus the add-on), not the full reservation", async () => {
    db.heldRow.value!.held_completion_fields = {
      provider: "kie", provider_cost: 0.4, display_cost: 12,
      metered: false, extraNonProviderCredits: 0, meteredCost: 0.4,
      loopTrimAddonRefundCredits: 3,
    }
    expect(await approveHeldJob("job-1", REVIEWER)).toEqual({ ok: true })
    expect(shared.refundLoopTrimAddon).toHaveBeenCalledWith("job-1", "log-1", 3)
    expect(shared.commitJobCredits).not.toHaveBeenCalled()
  })

  it("leaves the metered true-up path alone when no add-on was deferred", async () => {
    expect(await approveHeldJob("job-1", REVIEWER)).toEqual({ ok: true })
    expect(shared.refundLoopTrimAddon).not.toHaveBeenCalled()
    expect(shared.commitJobCredits).toHaveBeenCalledWith("log-1", "job-1", 0.4, 3, true)
  })

  it("publishes the withheld output and replays the caller's own columns verbatim", async () => {
    expect(await approveHeldJob("job-1", REVIEWER)).toEqual({ ok: true })
    const cas = db.updateArgs[0]!
    expect(cas.status).toBe("completed")
    expect(cas.progress).toBe(100)
    expect(typeof cas.completed_at).toBe("string")
    expect(cas.output_data).toEqual({ videoUrl: "https://cdn.example.com/videos/job-1.mp4" })
    expect(cas.provider).toBe("kie")
    expect(cas.provider_cost).toBe(0.4)
    expect(cas.display_cost).toBe(12)
    // The held columns are cleared in the SAME statement — a second approve
    // must not find a payload to publish again.
    expect(cas.held_output_data).toBeNull()
    expect(cas.held_completion_fields).toBeNull()
    expect(cas.held_objects).toBeNull()
  })

  it("replays a relayed job's relay_job_id / relay_credits onto the row (hold -> approve)", async () => {
    // finalize puts the two migration-383 columns in the completion `fields`;
    // a hold parks them in `held_completion_fields`, and THIS is where they
    // come back. Without the replay a held relayed job is approved with both
    // columns NULL — the self-host bills it as free and WS5's delete rule stops
    // protecting the far end's object for that row.
    db.heldRow.value!.held_completion_fields = {
      provider: "nodaro-cloud", metered: false,
      relay_job_id: "cloud-9", relay_credits: 24,
    }
    expect(await approveHeldJob("job-1", REVIEWER)).toEqual({ ok: true })
    const cas = db.updateArgs[0]!
    expect(cas.relay_job_id).toBe("cloud-9")
    expect(cas.relay_credits).toBe(24)
  })

  it("does NOT write the non-column settlement keys onto the row (they would 400)", async () => {
    await approveHeldJob("job-1", REVIEWER)
    const cas = db.updateArgs[0]!
    expect(cas).not.toHaveProperty("metered")
    expect(cas).not.toHaveProperty("meteredCost")
    expect(cas).not.toHaveProperty("extraNonProviderCredits")
  })

  it("commits the METERED true-up, not the reserved ceiling (Q2)", async () => {
    await approveHeldJob("job-1", REVIEWER)
    expect(shared.commitJobCredits).toHaveBeenCalledWith("log-1", "job-1", 0.4, 3, true)
  })

  it("replays the SAME completion tail finalize runs — once", async () => {
    await approveHeldJob("job-1", REVIEWER)
    expect(finalize.runCompletionTail).toHaveBeenCalledTimes(1)
    expect(finalize.runCompletionTail.mock.calls[0]![1]).toBe("https://cdn.example.com/videos/job-1.mp4")
  })

  it("records the review decision with the resolver", async () => {
    await approveHeldJob("job-1", REVIEWER)
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({
      jobId: "job-1", hookPoint: "review", verdict: "approve", policyId: "review",
      resolverUserId: "admin-1", resolverEmail: "admin@example.com",
    })
  })

  it("is single-shot: a second approve loses the CAS and answers already_resolved", async () => {
    db.casRows.value = []
    expect(await approveHeldJob("job-1", REVIEWER)).toEqual({ ok: false, reason: "already_resolved" })
    expect(shared.commitJobCredits).not.toHaveBeenCalled()
    expect(finalize.runCompletionTail).not.toHaveBeenCalled()
  })

  it("a job that is no longer held is already_resolved, not not_found", async () => {
    db.heldRow.value = { ...(db.heldRow.value as Record<string, unknown>), status: "completed" }
    expect(await approveHeldJob("job-1", REVIEWER)).toEqual({
      ok: false, reason: "already_resolved", status: "completed",
    })
  })

  it("a missing job is not_found", async () => {
    db.heldRow.value = null
    expect(await approveHeldJob("nope", REVIEWER)).toEqual({ ok: false, reason: "not_found" })
  })

  it("a DB error on the CAS leaves the job held and says finalize_failed", async () => {
    db.casError.value = { message: "deadlock" }
    db.casRows.value = []
    expect(await approveHeldJob("job-1", REVIEWER)).toEqual({ ok: false, reason: "finalize_failed" })
    expect(shared.commitJobCredits).not.toHaveBeenCalled()
  })
})

describe("rejectHeldJob", () => {
  it("delegates to the shared rejection primitive with the reviewer's user-visible reason", async () => {
    expect(await rejectHeldJob("job-1", REVIEWER, "  nudity  ")).toEqual({ ok: true })
    expect(gate.rejectHeldJobRow).toHaveBeenCalledTimes(1)
    const [jobId, input] = gate.rejectHeldJobRow.mock.calls[0]! as [string, Record<string, unknown>]
    expect(jobId).toBe("job-1")
    expect(input.userMessage).toBe("nudity")
    expect(input.policyId).toBe("review")
    expect(input.hookPoint).toBe("review")
    expect(input.verdict).toBe("reject")
    expect(input.resolverUserId).toBe("admin-1")
  })

  it("maps a lost race to already_resolved and a missing row to not_found", async () => {
    gate.rejectHeldJobRow.mockResolvedValueOnce({ ok: false, reason: "lost_race" })
    expect(await rejectHeldJob("job-1", REVIEWER, "x")).toMatchObject({ ok: false, reason: "already_resolved" })
    gate.rejectHeldJobRow.mockResolvedValueOnce({ ok: false, reason: "not_found" })
    expect(await rejectHeldJob("job-1", REVIEWER, "x")).toMatchObject({ ok: false, reason: "not_found" })
    gate.rejectHeldJobRow.mockResolvedValueOnce({ ok: false, reason: "not_held" })
    expect(await rejectHeldJob("job-1", REVIEWER, "x")).toMatchObject({ ok: false, reason: "already_resolved" })
  })
})

describe("resolveHeldJob — the one entry point the review routes call", () => {
  it("dispatches approve", async () => {
    expect(await resolveHeldJob("job-1", { action: "approve", resolver: REVIEWER })).toEqual({ ok: true })
    expect(db.updateArgs[0]!.status).toBe("completed")
  })

  it("dispatches reject and requires a reason", async () => {
    expect(await resolveHeldJob("job-1", { action: "reject", resolver: REVIEWER, reason: "nudity" })).toEqual({ ok: true })
    expect(gate.rejectHeldJobRow).toHaveBeenCalledTimes(1)
  })
})
