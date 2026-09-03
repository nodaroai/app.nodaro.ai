/**
 * The RESULT-gate applier (spec §5.4-§5.6, D19-D24).
 *
 * The registry decides; this module ACTS — and every one of these cases is a
 * way acting can go wrong:
 *  - re-applying a reused verdict files a spurious lost-race report on every
 *    BullMQ stall re-pick of a blocked job (D24);
 *  - writing the audit row AFTER the action loses the record on a crash in
 *    between, and the retry then re-asks (and re-pays for) the same check;
 *  - a 0-row CAS means a cancel won: money must not move and nothing may be
 *    deleted;
 *  - deleting "every URL in output_data" destroys the user's own inputs, which
 *    output_data routinely echoes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const db = vi.hoisted(() => {
  const jobRow = {
    value: {
      id: "job-1",
      job_type: "generate-image",
      user_id: "u1",
      workflow_execution_id: null,
      pipeline_id: null,
      parent_job_id: null,
      provider: "kie",
      started_at: new Date(Date.now() - 5_000).toISOString(),
      status: "processing",
      output_data: null,
    } as Record<string, unknown> | null,
  }
  // A PostgREST failure resolves as `{data:null, error}` — it does not throw
  // (the client is built without `throwOnError`). `once` models the blip that
  // the retry clears.
  const jobRowError = { value: null as { code?: string; message: string } | null, once: false }
  const jobRowReads = { count: 0 }
  const heldUpdateRows = { value: [{ id: "job-1" }] as unknown[] }
  const heldUpdateError = { value: null as { message: string } | null }
  const updateArgs: Record<string, unknown>[] = []
  const inArgs: unknown[][] = []
  // `credits_used` is the real column (001:180); `credits` is the JOB's field.
  const reservedLogs = { value: [{ id: "log-1", credits_used: 12 }] as unknown[] }

  const from = vi.fn((table: string) => {
    if (table === "usage_logs") {
      return {
        select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: reservedLogs.value, error: null }) }) }),
      }
    }
    // jobs
    const updateResult = () =>
      Promise.resolve(
        heldUpdateError.value ? { data: null, error: heldUpdateError.value } : { data: heldUpdateRows.value, error: null },
      )
    return {
      select: () => ({
        eq: () => ({
          single: () => {
            jobRowReads.count += 1
            const error = jobRowError.value
            if (error && jobRowError.once) jobRowError.value = null
            return Promise.resolve(error ? { data: null, error } : { data: jobRow.value, error: null })
          },
        }),
      }),
      update: (arg: Record<string, unknown>) => {
        updateArgs.push(arg)
        return {
          eq: () => ({
            in: (_c: string, statuses: unknown[]) => {
              inArgs.push(statuses)
              return { select: updateResult }
            },
            eq: () => ({ select: updateResult }),
          }),
        }
      },
    }
  })
  return { from, jobRow, jobRowError, jobRowReads, heldUpdateRows, heldUpdateError, updateArgs, inArgs, reservedLogs }
})

vi.mock("../supabase.js", () => ({ supabase: { from: db.from } }))
vi.mock("../config.js", () => ({
  config: { R2_PUBLIC_URL: "https://cdn.example.com" },
  hasAdmin: () => true,
}))

const storage = vi.hoisted(() => ({
  r2KeyFromOurUrl: (url: string) =>
    url.startsWith("https://cdn.example.com/") ? url.slice("https://cdn.example.com/".length) : null,
  batchDeleteFromR2: vi.fn(async (keys: string[]) => ({ deleted: keys.length, errors: 0 })),
  deleteFromR2: vi.fn(async () => undefined),
}))
vi.mock("../storage.js", () => storage)

const failure = vi.hoisted(() => ({
  markJobFailed: vi.fn(async (_jobId: string, _input: Record<string, unknown>) => true),
  markJobFailedDetailed: vi.fn(
    async (_jobId: string, _input: Record<string, unknown>) => "flipped" as "flipped" | "missed" | "error",
  ),
}))
vi.mock("../job-failure.js", () => failure)

const credits = vi.hoisted(() => ({
  refundReservedCreditsForJob: vi.fn(async () => 1),
  commitReservedCreditsForJob: vi.fn(async () => undefined),
}))
vi.mock("../credits-job-lifecycle.js", () => credits)

const audit = vi.hoisted(() => ({
  recordJobPolicyDecision: vi.fn(async (_input: Record<string, unknown>) => "decision-1"),
  setDecisionApplied: vi.fn(async (_id: string | null, _applied: boolean) => undefined),
  findReusableDecision: vi.fn(async () => null as unknown),
  hashGateSubject: vi.fn(() => "hash-1"),
  REUSABLE_VERDICTS: ["allow", "flag", "block", "hold"] as const,
}))
vi.mock("../job-policy-audit.js", () => audit)

const reports = vi.hoisted(() => ({ insertAppReport: vi.fn(async (_r: Record<string, unknown>) => true) }))
vi.mock("../app-reports.js", () => reports)

import { applyResultGate, rejectHeldJobRow, withdrawHeldJob } from "../job-policy-gate.js"
import { registerJobPolicy, clearJobPolicies, type JobResultContext } from "../job-policy.js"
import { extractJobOutputs, ownedHeldObjects, isOwnedObjectKey, mediaKindOf, MAX_HELD_OBJECTS } from "../job-policy-outputs.js"

const OUT = { imageUrl: "https://cdn.example.com/images/job-1.png" }

const LIVE_ROW = {
  id: "job-1",
  job_type: "generate-image",
  user_id: "u1",
  workflow_execution_id: null,
  pipeline_id: null,
  parent_job_id: null,
  provider: "kie",
  started_at: new Date(Date.now() - 5_000).toISOString(),
  status: "processing",
  output_data: null,
} as Record<string, unknown>

beforeEach(() => {
  clearJobPolicies()
  vi.clearAllMocks()
  db.updateArgs.length = 0
  db.inArgs.length = 0
  db.jobRow.value = { ...LIVE_ROW }
  db.jobRowError.value = null
  db.jobRowError.once = false
  db.jobRowReads.count = 0
  db.heldUpdateRows.value = [{ id: "job-1" }]
  db.heldUpdateError.value = null
  audit.findReusableDecision.mockResolvedValue(null)
  failure.markJobFailed.mockResolvedValue(true)
  failure.markJobFailedDetailed.mockResolvedValue("flipped")
})
afterEach(() => clearJobPolicies())

describe("the fast path", () => {
  it("with no result policy registered it allows without reading the row", async () => {
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("allow")
    expect(db.from).not.toHaveBeenCalled()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })
})

describe("verdict → action", () => {
  it("allow proceeds to the caller's own CAS and records the decision", async () => {
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("allow")
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledTimes(1)
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({
      jobId: "job-1", hookPoint: "result", verdict: "allow", policyId: "*",
    })
    expect(failure.markJobFailedDetailed).not.toHaveBeenCalled()
  })

  it("flag publishes and is invisible on the row (D30)", async () => {
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "flag", reason: "nsfw=0.4", labels: ["suggestive"] }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("allow")
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({ verdict: "flag", labels: ["suggestive"] })
    expect(db.updateArgs).toEqual([])
  })

  it("block fails the job, refunds by job id, deletes the owned object, and keeps the cost columns", async () => {
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "block", reason: "explicit", userMessage: "Blocked" }) })
    const outcome = await applyResultGate(
      "job-1",
      { output_data: OUT, provider: "kie", provider_cost: 0.4, display_cost: 12 },
      "finalize",
    )
    expect(outcome).toBe("blocked")
    const arg = failure.markJobFailedDetailed.mock.calls[0]![1] as Record<string, any>
    expect(arg.error_message).toBe("Blocked")
    expect(arg.error_hint).toEqual({ kind: "policy-block", policyId: "p", reason: "Blocked", hookPoint: "result" })
    expect(arg.extra).toMatchObject({ provider: "kie", provider_cost: 0.4, display_cost: 12 })
    // NULLED, not merely omitted: markJobFailed writes only the keys it is
    // handed, so a stripped key leaves whatever the row already had (F4/D19).
    expect(arg.extra).toHaveProperty("output_data", null)
    expect(credits.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(storage.batchDeleteFromR2).toHaveBeenCalledWith(["images/job-1.png"])
  })

  it("block that flipped no row moves no money, deletes nothing, and files exactly one report", async () => {
    failure.markJobFailedDetailed.mockResolvedValue("missed")
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "block", reason: "explicit" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("blocked")
    expect(credits.refundReservedCreditsForJob).not.toHaveBeenCalled()
    expect(storage.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(audit.setDecisionApplied).toHaveBeenCalledWith("decision-1", false)
    expect(reports.insertAppReport).toHaveBeenCalledTimes(1)
    expect(reports.insertAppReport.mock.calls[0]![0]).toMatchObject({ kind: "policy-decision-lost-race" })
  })

  it("block whose UPDATE ERRORED is not filed as a lost race — nothing won, the row is still live", async () => {
    // The mirror of the hold arm below. A statement timeout is not a cancel:
    // reporting one as "a terminal writer won" sends an operator chasing a race
    // that never happened, and records `applied=false` for a verdict that has
    // simply not run yet.
    failure.markJobFailedDetailed.mockResolvedValue("error")
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "block", reason: "explicit" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("blocked")
    // Money and objects stay behind the CAS, exactly as on the lost-race arm.
    expect(credits.refundReservedCreditsForJob).not.toHaveBeenCalled()
    expect(storage.batchDeleteFromR2).not.toHaveBeenCalled()
    // The row is still live, so the next completion attempt re-applies this
    // same stored verdict — which only works while `applied` stays unset.
    expect(audit.setDecisionApplied).not.toHaveBeenCalled()
    expect(reports.insertAppReport).not.toHaveBeenCalled()
  })

  it("hold parks the row: output withheld, credits untouched, object kept", async () => {
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "hold", reason: "needs eyes" }) })
    const outcome = await applyResultGate(
      "job-1",
      { output_data: OUT, provider: "kie", provider_cost: 0.4 },
      "finalize",
      { metered: true, extraNonProviderCredits: 3 },
    )
    expect(outcome).toBe("held")
    const held = db.updateArgs[0]!
    expect(held.status).toBe("pending_review")
    expect(held.progress).toBe(100)
    expect(held).toHaveProperty("output_data", null)
    expect(held).not.toHaveProperty("completed_at")
    expect(held.held_output_data).toEqual(OUT)
    expect(held.held_objects).toEqual([{ key: "images/job-1.png", kind: "image", index: 0 }])
    expect(typeof held.held_at).toBe("string")
    // Q2: the metered replay rides INSIDE the jsonb — neither is a jobs column.
    expect(held.held_completion_fields).toMatchObject({
      provider: "kie", provider_cost: 0.4, metered: true, extraNonProviderCredits: 3,
    })
    expect(held).not.toHaveProperty("metered")
    expect(db.inArgs[0]).toEqual(["pending", "queued", "processing"])
    expect(credits.refundReservedCreditsForJob).not.toHaveBeenCalled()
    expect(credits.commitReservedCreditsForJob).not.toHaveBeenCalled()
    expect(storage.batchDeleteFromR2).not.toHaveBeenCalled()
  })

  it("hold announces itself once on the surface an operator already watches (Q16)", async () => {
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "hold", reason: "needs eyes" }) })
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    expect(reports.insertAppReport.mock.calls.map((c) => (c[0] as { kind: string }).kind)).toContain(
      "policy-hold-pending",
    )
  })
})

describe("holdEligible is the platform's call, not the policy's (D8)", () => {
  const seen: JobResultContext[] = []
  beforeEach(() => {
    seen.length = 0
    registerJobPolicy({ id: "p", checkResult: (i) => { seen.push(i); return { verdict: "allow" } } })
  })

  it("true for a finalize-funnel standalone job", async () => {
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    expect(seen[0]!.holdEligible).toBe(true)
    expect(seen[0]!.funnel).toBe("finalize")
    expect(seen[0]!.mediaKind).toBe("image")
    expect(seen[0]!.creditsReserved).toBe(12)
  })

  it("false for a DIRECT caller — its post-ok tail is not replayable", async () => {
    await applyResultGate("job-1", { output_data: OUT }, "direct")
    expect(seen[0]!.holdEligible).toBe(false)
  })

  for (const [label, patch] of [
    ["an orchestrated child", { workflow_execution_id: "we-1" }],
    ["a pipeline child", { pipeline_id: "p-1" }],
    ["a variant/director child", { parent_job_id: "parent-1" }],
    ["the director's own job", { job_type: "video-director" }],
  ] as const) {
    it(`false for ${label}`, async () => {
      db.jobRow.value = { ...(db.jobRow.value as Record<string, unknown>), ...patch }
      await applyResultGate("job-1", { output_data: OUT }, "finalize")
      db.jobRow.value = {
        id: "job-1", job_type: "generate-image", user_id: "u1", workflow_execution_id: null,
        pipeline_id: null, parent_job_id: null, provider: "kie",
        started_at: new Date().toISOString(), status: "processing",
      }
      expect(seen[0]!.holdEligible).toBe(false)
    })
  }
})

/**
 * D24 says the POLICY is asked once per `(job_id, hook_point, payload_hash)` —
 * it does NOT say the verdict is applied at most once.
 *
 * Returning a stored `block`/`hold` blindly was the branch's sharpest defect
 * (F1/F2/F3): the audit row is written BEFORE the CAS, so a crash in that
 * window — or a CAS that errored — leaves a row still `processing` with its
 * credits reserved and a decision nobody ever applied. Every later completion
 * attempt (BullMQ stall re-pick, inline reconcile, the reconcile cron, all of
 * which re-derive the SAME output_data) then found the stored verdict and did
 * nothing, forever: never failed, never parked, never refunded, invisible to
 * the review queue and to the TTL sweep.
 *
 * So the rule is now: a reused verdict is re-APPLIED (never re-ASKED) when the
 * row says it never landed, and returned untouched otherwise.
 */
describe("idempotency (D24) — the policy is asked once, the verdict is applied until it lands", () => {
  // `reason` is MACHINE text and `userMessage` is the sentence the first
  // application actually put on the user's canvas. They are DIFFERENT strings on
  // purpose: every assertion below that reads `error_message` is therefore also
  // an assertion that the re-apply did not reach for the machine column.
  const REUSED_BLOCK = {
    id: "decision-9", verdict: "block", reason: "nsfw_score=0.98 label=explicit",
    userMessage: "This image could not be published", policyId: "p", applied: true, holdDowngraded: false,
  }
  const REUSED_HOLD = { id: "decision-9", verdict: "hold", reason: "needs eyes", userMessage: null, policyId: "p", applied: null, holdDowngraded: false }

  it("a stored verdict never re-asks the policy — no second paid moderation call, no second audit row", async () => {
    audit.findReusableDecision.mockResolvedValue(REUSED_BLOCK)
    const check = vi.fn(() => ({ verdict: "allow" }) as const)
    registerJobPolicy({ id: "p", checkResult: check })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("blocked")
    expect(check).not.toHaveBeenCalled()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("a stored block on a TERMINAL row is returned exactly as before — no CAS, no money, no lost-race noise", async () => {
    db.jobRow.value = { ...LIVE_ROW, status: "failed" }
    audit.findReusableDecision.mockResolvedValue(REUSED_BLOCK)
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("blocked")
    expect(failure.markJobFailedDetailed).not.toHaveBeenCalled()
    expect(credits.refundReservedCreditsForJob).not.toHaveBeenCalled()
    expect(storage.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(reports.insertAppReport).not.toHaveBeenCalled()
  })

  it("a stored block on a STILL-LIVE row is re-applied through the same idempotent path", async () => {
    audit.findReusableDecision.mockResolvedValue(REUSED_BLOCK)
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("blocked")
    expect(failure.markJobFailedDetailed).toHaveBeenCalledTimes(1)
    const arg = failure.markJobFailedDetailed.mock.calls[0]![1] as Record<string, any>
    expect(arg.error_message).toBe("This image could not be published")
    expect(arg.extra).toHaveProperty("output_data", null)
    expect(credits.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(storage.batchDeleteFromR2).toHaveBeenCalledWith(["images/job-1.png"])
    // The record already exists; only its `applied` flag was a lie.
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
    expect(audit.setDecisionApplied).toHaveBeenCalledWith("decision-9", true)
  })

  it("a stored hold on a STILL-LIVE row parks the row and announces itself", async () => {
    audit.findReusableDecision.mockResolvedValue(REUSED_HOLD)
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize", { metered: true })).toBe("held")
    const held = db.updateArgs[0]!
    expect(held.status).toBe("pending_review")
    expect(held.held_output_data).toEqual(OUT)
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
    expect(audit.setDecisionApplied).toHaveBeenCalledWith("decision-9", true)
    expect(reports.insertAppReport.mock.calls.map((c) => (c[0] as { kind: string }).kind)).toContain(
      "policy-hold-pending",
    )
  })

  it("a stored hold on an ALREADY-PARKED row is returned untouched — no second park", async () => {
    db.jobRow.value = { ...LIVE_ROW, status: "pending_review" }
    audit.findReusableDecision.mockResolvedValue(REUSED_HOLD)
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("held")
    expect(db.updateArgs).toEqual([])
    expect(reports.insertAppReport).not.toHaveBeenCalled()
    expect(audit.setDecisionApplied).not.toHaveBeenCalled()
  })

  it("a re-applied PLATFORM block speaks the platform's sentence, never the machine reason (D13)", async () => {
    audit.findReusableDecision.mockResolvedValue({
      id: "decision-9", verdict: "block", reason: "policy-unavailable", policyId: "platform", applied: null, holdDowngraded: false,
    })
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    const arg = failure.markJobFailedDetailed.mock.calls[0]![1] as Record<string, any>
    expect(arg.error_message).toBe("Generation could not be verified")
    expect(arg.error_hint.reason).toBe("Generation could not be verified")
  })

  it("a re-applied DOWNGRADED hold speaks the platform's sentence too — its reason is machine text", async () => {
    audit.findReusableDecision.mockResolvedValue({
      id: "decision-9", verdict: "block", reason: "nsfw_score=0.98 label=explicit", policyId: "p", applied: null, holdDowngraded: true,
    })
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    const arg = failure.markJobFailedDetailed.mock.calls[0]![1] as Record<string, any>
    expect(arg.error_message).toBe("This result was blocked by content policy")
  })

  it("a re-applied block speaks the STORED user-safe sentence, never the machine reason (D13)", async () => {
    audit.findReusableDecision.mockResolvedValue({
      id: "decision-9", verdict: "block", reason: "nsfw_score=0.98 label=explicit",
      userMessage: "This image could not be published", policyId: "p", applied: null, holdDowngraded: false,
    })
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    const arg = failure.markJobFailedDetailed.mock.calls[0]![1] as Record<string, any>
    expect(arg.error_message).toBe("This image could not be published")
    expect(arg.error_hint.reason).toBe("This image could not be published")
    // Both columns reach the owner's canvas verbatim (error_message and
    // error_hint are on PUBLIC_JOB_KEYS), so the scores must be in NEITHER.
    expect(arg.error_message).not.toContain("nsfw_score")
    expect(arg.error_hint.reason).not.toContain("nsfw_score")
  })

  it("a re-applied block from a row written BEFORE user_message speaks the PLATFORM's sentence, not the machine reason", async () => {
    // Migration 380 added the column; a decision recorded before it carries a
    // machine `reason` and nothing else. The fallback must be platform-owned —
    // falling back to `reason` is precisely the leak D13 forbids.
    audit.findReusableDecision.mockResolvedValue({
      id: "decision-9", verdict: "block", reason: "nsfw_score=0.98 label=explicit",
      userMessage: null, policyId: "p", applied: null, holdDowngraded: false,
    })
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    const arg = failure.markJobFailedDetailed.mock.calls[0]![1] as Record<string, any>
    expect(arg.error_message).toBe("This result was blocked by content policy")
    expect(arg.error_hint.reason).toBe("This result was blocked by content policy")
    expect(arg.error_message).not.toContain("nsfw_score")
    expect(arg.error_hint.reason).not.toContain("nsfw_score")
  })

  it("a FRESH block records the very sentence it showed, so the re-apply can reproduce it", async () => {
    // The other half: without this write, the re-apply above has nothing to
    // prefer and every stored block degrades to the generic platform sentence.
    registerJobPolicy({
      id: "p",
      checkResult: () => ({ verdict: "block", reason: "nsfw_score=0.98 label=explicit", userMessage: "This image could not be published" }),
    })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("blocked")
    const recorded = audit.recordJobPolicyDecision.mock.calls[0]![0] as Record<string, any>
    const shown = failure.markJobFailedDetailed.mock.calls[0]![1] as Record<string, any>
    expect(recorded.reason).toBe("nsfw_score=0.98 label=explicit")
    expect(recorded.userMessage).toBe("This image could not be published")
    expect(recorded.userMessage).toBe(shown.error_message)
  })

  it("a FRESH hold records NO user message — a park shows the owner nothing to reproduce", async () => {
    // `applyJobResultPolicies` fills a hold's `userMessage` from its machine
    // `reason` (job-policy.ts:316). Writing that into `user_message` would seed
    // the very column this fix exists to keep user-safe.
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "hold", reason: "nsfw_score=0.71 label=suggestive" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("held")
    const recorded = audit.recordJobPolicyDecision.mock.calls[0]![0] as Record<string, any>
    expect(recorded.verdict).toBe("hold")
    expect(recorded.reason).toBe("nsfw_score=0.71 label=suggestive")
    expect(recorded.userMessage ?? null).toBeNull()
  })

  it("an UNREADABLE row on the reuse path returns the stored verdict and writes nothing", async () => {
    db.jobRowError.value = { code: "500", message: "statement timeout" }
    audit.findReusableDecision.mockResolvedValue(REUSED_BLOCK)
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("blocked")
    expect(failure.markJobFailedDetailed).not.toHaveBeenCalled()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("a re-applied hold whose UPDATE errored keeps the verdict unapplied — it re-applies next tick", async () => {
    db.heldUpdateError.value = { message: "canceling statement due to statement timeout" }
    audit.findReusableDecision.mockResolvedValue(REUSED_HOLD)
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("held")
    expect(audit.setDecisionApplied).not.toHaveBeenCalled()
    expect(reports.insertAppReport).not.toHaveBeenCalled()
  })

  it("a re-applied block that loses the CAS marks the EXISTING decision, not a fresh one", async () => {
    failure.markJobFailedDetailed.mockResolvedValue("missed")
    audit.findReusableDecision.mockResolvedValue(REUSED_BLOCK)
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("blocked")
    expect(audit.setDecisionApplied).toHaveBeenCalledWith("decision-9", false)
    expect(credits.refundReservedCreditsForJob).not.toHaveBeenCalled()
    expect(storage.batchDeleteFromR2).not.toHaveBeenCalled()
  })

  it("a stored allow falls through to the caller's CAS without reading the row", async () => {
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    audit.findReusableDecision.mockResolvedValueOnce({
      id: "decision-2", verdict: "allow", reason: null, policyId: "*", applied: null, holdDowngraded: false,
    })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("allow")
    expect(db.jobRowReads.count).toBe(0)
  })
})

describe("the audit row is written BEFORE the action", () => {
  it("so a crash between the verdict and the CAS still leaves the record", async () => {
    const order: string[] = []
    audit.recordJobPolicyDecision.mockImplementation(async () => { order.push("audit"); return "decision-1" })
    failure.markJobFailedDetailed.mockImplementation(async () => { order.push("act"); return "flipped" as const })
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "block", reason: "explicit" }) })
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    expect(order).toEqual(["audit", "act"])
  })
})

/**
 * `applied` is the flag the admin decisions tab and every future consumer read
 * as "this verdict actually took effect". Writing `true` at INSERT time — i.e.
 * BEFORE the CAS — makes it a claim about the future: a crash in that window
 * leaves a row asserting a hold that never happened. It is written only once
 * the CAS has returned a row.
 */
describe("`applied` records what happened, not what was about to", () => {
  it("the pre-action audit row leaves `applied` unset and flips it only after the CAS lands", async () => {
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "block", reason: "explicit" }) })
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({ verdict: "block", applied: null })
    expect(audit.setDecisionApplied).toHaveBeenCalledWith("decision-1", true)
  })

  it("a hold that parked flips it too", async () => {
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "hold", reason: "needs eyes" }) })
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({ verdict: "hold", applied: null })
    expect(audit.setDecisionApplied).toHaveBeenCalledWith("decision-1", true)
  })

  it("a hold whose UPDATE ERRORED is not filed as a lost race — nothing won, the write never ran", async () => {
    db.heldUpdateError.value = { message: "canceling statement due to statement timeout" }
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "hold", reason: "needs eyes" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("held")
    expect(audit.setDecisionApplied).not.toHaveBeenCalled()
    expect(reports.insertAppReport).not.toHaveBeenCalled()
  })
})

/**
 * D20 on the one input the gate cannot do without.
 *
 * `.single()` answers `{data:null, error}` for BOTH "no such row" (PGRST116)
 * and "the read failed" (a 500 from a statement timeout, a 502 from a
 * restarting PostgREST, a 401 on a bad key). Collapsing the two into "not
 * found → allow" fails OPEN: the caller's completion CAS is a SEPARATE request
 * that succeeds against the still-`processing` row, so a single failed GET
 * publishes unmoderated output on the one deployment that must not.
 */
describe("an unreadable row fails CLOSED (D20)", () => {
  it("a CONFIRMED missing row (PGRST116) still answers allow — the caller's own CAS reports the truth", async () => {
    db.jobRowError.value = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }
    const check = vi.fn(() => ({ verdict: "block", reason: "explicit" }) as const)
    registerJobPolicy({ id: "p", checkResult: check })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("allow")
    expect(check).not.toHaveBeenCalled()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
    expect(failure.markJobFailedDetailed).not.toHaveBeenCalled()
  })

  it("a null row with no error is the same confirmed miss", async () => {
    db.jobRow.value = null
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "block", reason: "explicit" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("allow")
  })

  it("a READ FAILURE blocks in the platform's name and wording, refunds and deletes", async () => {
    db.jobRowError.value = { code: "500", message: "canceling statement due to statement timeout" }
    const check = vi.fn(() => ({ verdict: "allow" }) as const)
    registerJobPolicy({ id: "p", checkResult: check })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("blocked")
    // No row means no `holdEligible` (four of D8's six conditions are columns),
    // and unknown eligibility is NOT eligible — so the fail-closed verdict is
    // `block`, never a hold that would park a workflow child forever.
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledTimes(1)
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({
      jobId: "job-1", hookPoint: "result", policyId: "platform", verdict: "block", reason: "policy-unavailable",
    })
    const arg = failure.markJobFailedDetailed.mock.calls[0]![1] as Record<string, any>
    expect(arg.error_message).toBe("Generation could not be verified")
    expect(arg.error_hint).toEqual({
      kind: "policy-block", policyId: "platform", reason: "Generation could not be verified", hookPoint: "result",
    })
    expect(arg.extra).toHaveProperty("output_data", null)
    expect(credits.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(storage.batchDeleteFromR2).toHaveBeenCalledWith(["images/job-1.png"])
    // The policy was never asked: there is no context to ask it with.
    expect(check).not.toHaveBeenCalled()
  })

  it("retries the read once before failing closed — a 502 blip must not cost a user their generation", async () => {
    db.jobRowError.value = { code: "502", message: "bad gateway" }
    db.jobRowError.once = true
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "allow" }) })
    expect(await applyResultGate("job-1", { output_data: OUT }, "finalize")).toBe("allow")
    expect(db.jobRowReads.count).toBe(2)
    expect(failure.markJobFailedDetailed).not.toHaveBeenCalled()
  })
})

/**
 * D19's security boundary is a NULL `output_data`, and the branch relied on the
 * column being UNWRITTEN at completion time. It is not: `tk.jobs.updateJobCheckpoint`
 * read-merges into `jobs.output_data` mid-run, and generate-video-pro persists
 * `pro.segments[].r2Url` and a rolling `pro.currentFinal.url` there. Stripping
 * the key from the failure UPDATE leaves every one of those on the failed row,
 * where GET /v1/jobs/:id hands them straight back to the owner.
 */
describe("a blocked row keeps no output residue (F4/D19)", () => {
  const RESIDUE = { pro: { segments: [{ r2Url: "https://cdn.example.com/videos/job-1-seg1.mp4" }] } }

  it("block NULLS output_data and MOVES the pre-written checkpoint into held_output_data", async () => {
    db.jobRow.value = { ...LIVE_ROW, output_data: RESIDUE }
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "block", reason: "explicit" }) })
    await applyResultGate("job-1", { output_data: OUT, provider: "kie" }, "finalize")
    const extra = (failure.markJobFailedDetailed.mock.calls[0]![1] as Record<string, any>).extra as Record<string, unknown>
    expect(extra.output_data).toBeNull()
    // `held_*` is on neither key list, in none of the five selects and outside
    // 347's grant — forensics without owner visibility.
    expect(extra.held_output_data).toEqual(RESIDUE)
    expect(extra.provider).toBe("kie")
  })

  it("hold nulls it too — approve republishes from held_output_data, so nothing is lost", async () => {
    db.jobRow.value = { ...LIVE_ROW, output_data: RESIDUE }
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "hold", reason: "needs eyes" }) })
    await applyResultGate("job-1", { output_data: OUT }, "finalize")
    expect(db.updateArgs[0]!).toHaveProperty("output_data", null)
    expect(db.updateArgs[0]!.held_output_data).toEqual(OUT)
  })
})

describe("a block deletes the WHOLE owned family (F4)", () => {
  it("deletes every owned object, past the withholding cap, and the row's own residue too", async () => {
    const segments: Record<string, unknown> = {}
    for (let i = 1; i <= 25; i++) segments[`seg${i}`] = `https://cdn.example.com/videos/job-1-seg${i}.mp4`
    // What a mid-run `updateJobCheckpoint` already wrote onto the ROW — the
    // completion fields need not repeat it, and it is exactly the residue D19
    // moves off the owner-readable column.
    db.jobRow.value = { ...LIVE_ROW, output_data: { pro: { currentFinal: { url: "https://cdn.example.com/videos/job-1-seg1r.mp4" } } } }
    registerJobPolicy({ id: "p", checkResult: () => ({ verdict: "block", reason: "explicit" }) })
    expect(await applyResultGate("job-1", { output_data: segments }, "finalize")).toBe("blocked")
    const keys = storage.batchDeleteFromR2.mock.calls[0]![0] as string[]
    expect(keys).toHaveLength(26)
    expect(keys).toContain("videos/job-1-seg25.mp4")
    expect(keys).toContain("videos/job-1-seg1r.mp4")
  })
})

describe("extractJobOutputs — two extractions, and why they differ (§5.4)", () => {
  const echoed = {
    imageUrl: "https://cdn.example.com/images/job-1.png",
    maskUrl: "https://cdn.example.com/images/job-1-v1.png",
    sourceUrl: "https://someone-else.example.com/photo.jpg",
    panelUrls: ["https://cdn.example.com/images/other-job.png"],
    nested: { thumbnailUrl: "https://cdn.example.com/thumbnails/job-1.png" },
    notAUrl: "just text",
  }

  it("the POLICY sees every http(s) URL, ours or not — an empty list would fail open", () => {
    const outs = extractJobOutputs(echoed)
    expect(outs.map((o) => o.url)).toEqual([
      "https://cdn.example.com/images/job-1.png",
      "https://cdn.example.com/images/job-1-v1.png",
      "https://someone-else.example.com/photo.jpg",
      "https://cdn.example.com/images/other-job.png",
      "https://cdn.example.com/thumbnails/job-1.png",
    ])
    expect(outs.find((o) => o.url.includes("someone-else"))!.key).toBeNull()
    expect(outs.find((o) => o.role === "thumbnail")).toBeTruthy()
    expect(outs.find((o) => o.role === "mask")).toBeTruthy()
  })

  it("DELETION sees only this job's own key family — another job's asset is refused", () => {
    const held = ownedHeldObjects("job-1", extractJobOutputs(echoed))
    expect(held.map((h) => h.key)).toEqual([
      "images/job-1.png",
      "images/job-1-v1.png",
      "thumbnails/job-1.png",
    ])
    expect(held.map((h) => h.index)).toEqual([0, 1, 2])
  })

  it("ownership is by key stem, so a new deliverable prefix inherits the rule", () => {
    expect(isOwnedObjectKey("job-1", "reference-sheets/job-1.png")).toBe(true)
    expect(isOwnedObjectKey("job-1", "lottie/job-1.json")).toBe(true)
    expect(isOwnedObjectKey("job-1", "videos/job-1-v3.mp4")).toBe(true)
    expect(isOwnedObjectKey("job-1", "images/job-2.png")).toBe(false)
    expect(isOwnedObjectKey("job-1", "images/job-10.png")).toBe(false)
  })

  it("the family is the `<jobId>-` STEM PREFIX — a plugin's segment keys are ours too (F4)", () => {
    // generate-video-pro checkpoints `videos/<jobId>-seg1.mp4` and a rolling
    // stitched final mid-run, and every engine stem is built off the CURRENT
    // job's id (`${ctx.jobId}-seg${i}`, `-lastframe`, `-anchor-start`,
    // `-lipsync-ref-v3`, `-video-audio`). A family that admitted only `<jobId>`
    // and `<jobId>-v<i>` neither withheld nor deleted any of them.
    expect(isOwnedObjectKey("job-1", "videos/job-1-seg1.mp4")).toBe(true)
    expect(isOwnedObjectKey("job-1", "videos/job-1-seg10-lastframe.png")).toBe(true)
    expect(isOwnedObjectKey("job-1", "audios/job-1-video-audio.mp3")).toBe(true)
    expect(isOwnedObjectKey("job-1", "videos/job-1-v3.mp4")).toBe(true)
    // A CONTINUATION's parent-owned objects stay excluded: every stem is built
    // from the running job's own id, so `<parentJobId>-segN` is the parent's
    // deliverable and a child's block must not delete it.
    expect(isOwnedObjectKey("child-1", "videos/parent-1-seg2.mp4")).toBe(false)
    // The digit pin the prefix must not swallow.
    expect(isOwnedObjectKey("job-1", "images/job-10.png")).toBe(false)
    expect(isOwnedObjectKey("job-1", "images/job-1extra.png")).toBe(false)
  })

  it("WITHHOLDING is capped for the review UI; DELETION is not (nothing is silently skipped)", () => {
    // A 10-segment checkpoint carries far more owned refs than the preview cap:
    // `held_objects` is what a human pages through (and what the review route
    // indexes into from client input), so it stays bounded — but a block that
    // deleted only the first 17 would leave the tail live at guessable public
    // keys forever.
    const many: Record<string, unknown> = {}
    for (let i = 1; i <= 40; i++) many[`seg${i}`] = `https://cdn.example.com/videos/job-1-seg${i}.mp4`
    const outs = extractJobOutputs(many)
    expect(ownedHeldObjects("job-1", outs)).toHaveLength(MAX_HELD_OBJECTS)
    expect(ownedHeldObjects("job-1", outs, Number.POSITIVE_INFINITY)).toHaveLength(40)
  })

  it("mediaKind travels with the outputs so a policy can fail closed on an empty list", () => {
    expect(mediaKindOf({ videoUrl: "x" })).toBe("video")
    expect(mediaKindOf({ audioUrl: "x" })).toBe("audio")
    expect(mediaKindOf({ imageUrl: "x" })).toBe("image")
    expect(mediaKindOf({ text: "x" })).toBe("other")
  })
})

/**
 * The shared "this held job will not be published" primitives.
 *
 * Reject, the TTL expiry and the owner's own cancel are the same three writes
 * with different words, so they are ONE code path — and these are its only
 * direct tests: `job-policy-review.test.ts` and `hold-expiry.test.ts` both mock
 * this module away.
 *
 * The first assertion is the one that matters. `held_completion_fields` mixes
 * real jobs columns with the NON-column settlement inputs (`metered`,
 * `meteredCost`, `extraNonProviderCredits`). Spreading it whole onto the failure
 * UPDATE makes PostgREST refuse the write, `markJobFailed` return false, and the
 * reject answer "lost_race" — leaving the job parked forever with its credits
 * reserved, on every single reject.
 */
describe("rejectHeldJobRow", () => {
  const HELD = {
    id: "job-1",
    status: "pending_review",
    user_id: "u1",
    held_completion_fields: {
      provider: "kie", provider_cost: 0.4, display_cost: 12,
      metered: true, meteredCost: 0.4, extraNonProviderCredits: 3,
    },
    held_objects: [{ key: "videos/job-1.mp4", kind: "video", index: 0 }],
  }
  const INPUT = {
    userMessage: "Rejected by a reviewer",
    machineReason: "reviewer: nudity",
    policyId: "review",
    hookPoint: "review" as const,
    verdict: "reject" as const,
    resolverUserId: "admin-1",
    resolverEmail: "admin@example.com",
  }

  beforeEach(() => { db.jobRow.value = { ...HELD } })

  it("replays only the REAL columns — never the settlement keys, which are not columns", async () => {
    expect(await rejectHeldJobRow("job-1", INPUT)).toEqual({ ok: true, refunded: 1 })
    const extra = (failure.markJobFailed.mock.calls[0]![1] as Record<string, any>).extra as Record<string, unknown>
    expect(extra).toMatchObject({ provider: "kie", provider_cost: 0.4, display_cost: 12 })
    for (const k of ["metered", "meteredCost", "extraNonProviderCredits"]) {
      expect(extra).not.toHaveProperty(k)
    }
    expect(extra).toMatchObject({
      // Symmetry with the block path: a rejected row publishes nothing either.
      output_data: null,
      held_output_data: null,
      held_completion_fields: null,
      held_objects: null,
    })
  })

  it("is the ONLY writer allowed to fail a parked row, and says so explicitly", async () => {
    await rejectHeldJobRow("job-1", INPUT)
    const arg = failure.markJobFailed.mock.calls[0]![1] as Record<string, any>
    expect(arg.from).toEqual(["pending_review"])
    expect(arg.error_message).toBe("Rejected by a reviewer")
    // PolicyBlockHint admits only request|result: a reviewer's rejection is a
    // decision about a RESULT.
    expect(arg.error_hint).toEqual({
      kind: "policy-block", policyId: "review", reason: "Rejected by a reviewer", hookPoint: "result",
    })
  })

  it("refunds, deletes the owned object and records the resolver — only after the CAS won", async () => {
    await rejectHeldJobRow("job-1", INPUT)
    expect(credits.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(storage.batchDeleteFromR2).toHaveBeenCalledWith(["videos/job-1.mp4"])
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({
      jobId: "job-1", hookPoint: "review", verdict: "reject", policyId: "review",
      reason: "reviewer: nudity", resolverUserId: "admin-1", resolverEmail: "admin@example.com",
    })
  })

  it("a lost CAS moves no money and deletes nothing", async () => {
    failure.markJobFailed.mockResolvedValueOnce(false)
    expect(await rejectHeldJobRow("job-1", INPUT)).toEqual({ ok: false, reason: "lost_race" })
    expect(credits.refundReservedCreditsForJob).not.toHaveBeenCalled()
    expect(storage.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("refuses a row that is not parked, and a row that is gone", async () => {
    db.jobRow.value = { ...HELD, status: "completed" }
    expect(await rejectHeldJobRow("job-1", INPUT)).toEqual({ ok: false, reason: "not_held" })
    db.jobRow.value = null
    expect(await rejectHeldJobRow("job-1", INPUT)).toEqual({ ok: false, reason: "not_found" })
    expect(failure.markJobFailed).not.toHaveBeenCalled()
  })
})

describe("withdrawHeldJob — the owner's own cancel wins (D17)", () => {
  const HELD = {
    id: "job-1",
    status: "pending_review",
    user_id: "u1",
    held_objects: [{ key: "videos/job-1.mp4", kind: "video", index: 0 }],
  }
  beforeEach(() => { db.jobRow.value = { ...HELD } })

  it("cancels (not fails) the row, refunds, deletes and records `withdrawn`", async () => {
    expect(await withdrawHeldJob("job-1")).toEqual({ ok: true, refunded: 1 })
    const cas = db.updateArgs[0]!
    expect(cas.status).toBe("cancelled")
    expect(cas.held_output_data).toBeNull()
    expect(cas.held_objects).toBeNull()
    expect(db.inArgs[0]).toEqual(["pending_review"])
    expect(credits.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(storage.batchDeleteFromR2).toHaveBeenCalledWith(["videos/job-1.mp4"])
    expect(audit.recordJobPolicyDecision.mock.calls[0]![0]).toMatchObject({
      hookPoint: "review", verdict: "withdrawn", policyId: "review",
    })
    // A cancel is not a failure: markJobFailed must not be involved at all.
    expect(failure.markJobFailed).not.toHaveBeenCalled()
  })

  it("a lost CAS moves no money and deletes nothing", async () => {
    db.heldUpdateRows.value = []
    expect(await withdrawHeldJob("job-1")).toEqual({ ok: false, reason: "lost_race" })
    expect(credits.refundReservedCreditsForJob).not.toHaveBeenCalled()
    expect(storage.batchDeleteFromR2).not.toHaveBeenCalled()
  })

  it("refuses a row that is not parked", async () => {
    db.jobRow.value = { ...HELD, status: "completed" }
    expect(await withdrawHeldJob("job-1")).toEqual({ ok: false, reason: "not_held" })
    expect(db.updateArgs).toEqual([])
  })
})
