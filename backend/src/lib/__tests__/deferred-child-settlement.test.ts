import { describe, it, expect, vi, beforeEach } from "vitest"
import { FakeDb } from "./helpers/fake-jobs-db.js"

/**
 * A plugin's engine child held after it completes (lib/deferred-child-settlement.ts):
 * settle commits exactly what finalize would have, release refunds through the
 * atomic refund, each is idempotent, neither undoes the other, a release asked
 * before completion is scheduled, and a plugin can touch only its own children.
 */

const db = vi.hoisted(() => ({ current: null as unknown as { from: (t: string) => unknown } }))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => db.current.from(t) } }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => true,
}))

const money = vi.hoisted(() => ({
  commitJobCredits: vi.fn(),
  refundLoopTrimAddon: vi.fn(),
  refundCredits: vi.fn(),
  refundFails: false,
}))
vi.mock("@/workers/shared.js", () => ({
  commitJobCredits: money.commitJobCredits,
  refundLoopTrimAddon: money.refundLoopTrimAddon,
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { refundCredits: money.refundCredits } }))
vi.mock("@/ee/billing/credit-anomaly.js", () => ({ computeActualCredits: vi.fn(async (usd: number) => Math.ceil(usd * 100)) }))
vi.mock("@/ee/billing/service-margin.js", () => ({ applyServiceMarkup: vi.fn((base: number) => Math.ceil(base * 1.5)) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({})) }))

import {
  assertOwnDeferredChild,
  deferredCompletionFields,
  plannedCommitCredits,
  releaseIfScheduled,
  resolveDeferredChild,
} from "../deferred-child-settlement.js"
import { heldCommitArgs, type HeldCommitReplay } from "../job-policy.js"
import { COVERED_METADATA_KEY } from "../covered-step.js"

const PARENT = "00000000-0000-4000-8000-0000000000a1"
const OTHER_PARENT = "00000000-0000-4000-8000-0000000000a2"
const CHILD = "00000000-0000-4000-8000-0000000000c1"
const LOG = "00000000-0000-4000-8000-0000000000f1"
const USER = "00000000-0000-4000-8000-000000000001"

let fake: FakeDb

function seed(opts: { commit?: HeldCommitReplay; providerCost?: number | null; state?: string; logStatus?: string; deferred?: boolean; status?: string; marker?: boolean } = {}) {
  fake = new FakeDb()
  db.current = fake
  const completed = (opts.status ?? "completed") === "completed"
  fake.tables.jobs!.push({
    id: CHILD,
    status: opts.status ?? "completed",
    input_data: opts.marker === false ? { type: "image-to-video" } : { type: "image-to-video", __deferSettlement: true },
    user_id: USER,
    parent_job_id: PARENT,
    workflow_execution_id: null,
    credits_actual: 40,
    billing_force_refund: false,
    held_completion_fields: opts.deferred === false || !completed ? null : {
      deferredSettlement: {
        version: 1,
        state: opts.state ?? "held",
        open: true,
        commit: opts.commit ?? {},
        providerCost: opts.providerCost ?? 0.5,
        deferredAt: "2026-11-23T10:00:00.000Z",
      },
    },
  })
  fake.tables.usage_logs!.push({ id: LOG, job_id: CHILD, status: opts.logStatus ?? "reserved", credits_used: 40, action: "seedance-2-5", metadata: {} })
}

const child = () => fake.row("jobs", CHILD)!
const record = () => (child().held_completion_fields as Record<string, Record<string, unknown>>).deferredSettlement!
const log = () => fake.row("usage_logs", LOG)!

/** The worker's completion of a held child, as finalize writes it. */
function completeHeld() {
  Object.assign(child(), {
    status: "completed",
    held_completion_fields: { deferredSettlement: { version: 1, state: "held", open: true, commit: {}, providerCost: 0.5, deferredAt: "2026-11-23T10:00:00.000Z" } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  money.refundFails = false
  money.commitJobCredits.mockImplementation(async (usageLogId: string | null) => {
    const l = usageLogId ? fake.row("usage_logs", usageLogId) : undefined
    if (l?.status === "reserved") l.status = "committed"
  })
  money.refundLoopTrimAddon.mockImplementation(async (_jobId: string, usageLogId: string | null) => {
    const l = usageLogId ? fake.row("usage_logs", usageLogId) : undefined
    if (l?.status === "reserved") l.status = "committed"
  })
  money.refundCredits.mockImplementation(async (usageLogId: string) => {
    if (money.refundFails) return
    const l = fake.row("usage_logs", usageLogId)
    if (l?.status === "reserved") l.status = "refunded"
  })
})

describe("settle", () => {
  it("commits with the very arguments finalize would have used, and closes the record", async () => {
    const commit: HeldCommitReplay = { metered: true, meteredCost: 0.7, extraNonProviderCredits: 3 }
    seed({ commit, providerCost: 0.5 })
    expect(await resolveDeferredChild(CHILD, "settled", { by: "plugin" })).toBe("settled")
    expect(money.commitJobCredits).toHaveBeenCalledTimes(1)
    expect(money.commitJobCredits).toHaveBeenCalledWith(LOG, CHILD, ...heldCommitArgs(commit, 0.5))
    expect(log().status).toBe("committed")
    expect(record()).toMatchObject({ state: "settled", open: false, decidedBy: "plugin" })
    expect(money.refundCredits).not.toHaveBeenCalled()
  })

  it("a measured charge (meteredBaseCredits) replays through the same mapping", async () => {
    seed({ commit: { meteredBaseCredits: 22, extraNonProviderCredits: 2 } })
    await resolveDeferredChild(CHILD, "settled", { by: "plugin" })
    expect(money.commitJobCredits).toHaveBeenCalledWith(LOG, CHILD, null, 24, true)
  })

  it("an undelivered loop-trim add-on comes off, as finalize would have taken it", async () => {
    seed({ commit: { loopTrimAddonRefundCredits: 5 } })
    await resolveDeferredChild(CHILD, "settled", { by: "plugin" })
    expect(money.refundLoopTrimAddon).toHaveBeenCalledWith(CHILD, LOG, 5)
    expect(money.commitJobCredits).not.toHaveBeenCalled()
  })

  it("is idempotent: a second settle answers settled and moves no money", async () => {
    seed()
    await resolveDeferredChild(CHILD, "settled", { by: "plugin" })
    expect(await resolveDeferredChild(CHILD, "settled", { by: "plugin" })).toBe("settled")
    expect(money.commitJobCredits).toHaveBeenCalledTimes(1)
  })

  it("after a release: already_decided, nothing charged", async () => {
    seed()
    await resolveDeferredChild(CHILD, "released", { reason: "blurred", by: "plugin" })
    expect(await resolveDeferredChild(CHILD, "settled", { by: "plugin" })).toBe("already_decided")
    expect(money.commitJobCredits).not.toHaveBeenCalled()
    expect(log().status).toBe("refunded")
  })
})

describe("release", () => {
  it("refunds the open hold, records why, sets credits_actual 0 and closes the record", async () => {
    seed()
    expect(await resolveDeferredChild(CHILD, "released", { reason: "a face is still blurred", by: "plugin" })).toBe("released")
    expect(money.refundCredits).toHaveBeenCalledWith(LOG)
    expect(log().status).toBe("refunded")
    expect(record()).toMatchObject({ state: "released", open: false, reason: "a face is still blurred", decidedBy: "plugin" })
    expect(child().credits_actual).toBe(0)
    expect(child().billing_force_refund).toBe(true)
  })

  it("is idempotent", async () => {
    seed()
    await resolveDeferredChild(CHILD, "released", { reason: "x", by: "plugin" })
    expect(await resolveDeferredChild(CHILD, "released", { reason: "x", by: "plugin" })).toBe("released")
    expect(money.refundCredits).toHaveBeenCalledTimes(1)
  })

  it("never refunds a settled child", async () => {
    seed()
    await resolveDeferredChild(CHILD, "settled", { by: "plugin" })
    expect(await resolveDeferredChild(CHILD, "released", { reason: "late", by: "plugin" })).toBe("already_decided")
    expect(money.refundCredits).not.toHaveBeenCalled()
    expect(log().status).toBe("committed")
    expect(record().state).toBe("settled")
  })

  it("a settle decided before a crash (log still open) wins over a later release", async () => {
    seed({ state: "settled" })
    expect(await resolveDeferredChild(CHILD, "released", { reason: "x", by: "plugin" })).toBe("already_decided")
    expect(money.refundCredits).not.toHaveBeenCalled()
    expect(log().status).toBe("reserved")
  })

  it("a refund that did not land answers pending and leaves the charge; the retry finishes it", async () => {
    seed()
    money.refundFails = true
    expect(await resolveDeferredChild(CHILD, "released", { reason: "x", by: "plugin" })).toBe("pending")
    expect(child().credits_actual).toBe(40)
    expect(record()).toMatchObject({ state: "released", open: true })
    money.refundFails = false
    expect(await resolveDeferredChild(CHILD, "released", { by: "sweep" })).toBe("released")
    expect(child().credits_actual).toBe(0)
    expect(record().open).toBe(false)
  })

  it("keeps at most 500 characters of the reason", async () => {
    seed()
    await resolveDeferredChild(CHILD, "released", { reason: "r".repeat(900), by: "plugin" })
    expect((record().reason as string).length).toBe(500)
  })
})

describe("a release asked before the child completed (scheduled)", () => {
  it("is recorded server-only and answers scheduled; nothing moves yet", async () => {
    seed({ status: "processing" })
    expect(await resolveDeferredChild(CHILD, "released", { reason: "the run failed", by: "plugin" })).toBe("scheduled")
    expect((child().input_data as Record<string, Record<string, unknown>>).__deferredRelease).toMatchObject({ reason: "the run failed" })
    expect(money.refundCredits).not.toHaveBeenCalled()
    expect(log().status).toBe("reserved")
  })

  it("scheduled twice: the same answer, one marker", async () => {
    seed({ status: "processing" })
    await resolveDeferredChild(CHILD, "released", { reason: "first", by: "plugin" })
    expect(await resolveDeferredChild(CHILD, "released", { reason: "second", by: "plugin" })).toBe("scheduled")
    expect((child().input_data as Record<string, Record<string, unknown>>).__deferredRelease!.reason).toBe("first")
  })

  it("then the child completes: its completion releases it (never charged)", async () => {
    seed({ status: "processing" })
    await resolveDeferredChild(CHILD, "released", { reason: "the run failed", by: "plugin" })
    completeHeld()
    await releaseIfScheduled(CHILD)
    expect(log().status).toBe("refunded")
    expect(record()).toMatchObject({ state: "released", open: false, reason: "the run failed" })
    expect(child().credits_actual).toBe(0)
    expect(money.refundCredits).toHaveBeenCalledTimes(1)
    expect(money.commitJobCredits).not.toHaveBeenCalled()
  })

  it("then the child fails: its failure path refunds it once, the release adds nothing", async () => {
    seed({ status: "processing" })
    await resolveDeferredChild(CHILD, "released", { reason: "x", by: "plugin" })
    // The failure path's own refund.
    Object.assign(child(), { status: "failed" })
    log().status = "refunded"
    await releaseIfScheduled(CHILD)
    expect(await resolveDeferredChild(CHILD, "released", { reason: "x", by: "plugin" })).toBe("not_deferred")
    expect(money.refundCredits).not.toHaveBeenCalled()
  })

  it("a settle after it: already_decided — before and after completion — and nothing is charged", async () => {
    seed({ status: "processing" })
    await resolveDeferredChild(CHILD, "released", { reason: "x", by: "plugin" })
    expect(await resolveDeferredChild(CHILD, "settled", { by: "plugin" })).toBe("already_decided")
    completeHeld()
    expect(await resolveDeferredChild(CHILD, "settled", { by: "plugin" })).toBe("already_decided")
    expect(money.commitJobCredits).not.toHaveBeenCalled()
    expect(log().status).toBe("refunded")
  })

  it("a settle on a running child with no release asked: not_deferred (settle only a completed child)", async () => {
    seed({ status: "processing" })
    expect(await resolveDeferredChild(CHILD, "settled", { by: "plugin" })).toBe("not_deferred")
  })

  it("a running child that did not ask for the deferral: not_deferred, nothing written", async () => {
    seed({ status: "processing", marker: false })
    expect(await resolveDeferredChild(CHILD, "released", { reason: "x", by: "plugin" })).toBe("not_deferred")
    expect(child().input_data).not.toHaveProperty("__deferredRelease")
  })
})

describe("a child that was not deferred", () => {
  it.each([
    ["no record", { deferred: false }],
    ["failed (its failure path refunded it)", { status: "failed" }],
  ] as const)("%s: settle and release are no-ops", async (_label, opts) => {
    seed(opts)
    expect(await resolveDeferredChild(CHILD, "settled", { by: "plugin" })).toBe("not_deferred")
    expect(await resolveDeferredChild(CHILD, "released", { reason: "x", by: "plugin" })).toBe("not_deferred")
    expect(money.commitJobCredits).not.toHaveBeenCalled()
    expect(money.refundCredits).not.toHaveBeenCalled()
  })
})

describe("only the running job's own children", () => {
  it("the parent's handler may act on its child", async () => {
    seed()
    await expect(assertOwnDeferredChild(PARENT, CHILD, USER)).resolves.toBeUndefined()
  })

  it.each([
    ["another job's handler", OTHER_PARENT, USER],
    ["no running job (outside a handler)", undefined, USER],
    ["another user's context", PARENT, "00000000-0000-4000-8000-000000000002"],
  ] as const)("%s is refused", async (_label, caller, user) => {
    seed()
    await expect(assertOwnDeferredChild(caller, CHILD, user)).rejects.toThrow()
  })

  it("a malformed or unknown id is refused", async () => {
    seed()
    await expect(assertOwnDeferredChild(PARENT, "not-a-uuid", USER)).rejects.toThrow("job id")
    await expect(assertOwnDeferredChild(PARENT, "00000000-0000-4000-8000-0000000000ff", USER)).rejects.toThrow("not a child")
  })
})

describe("what a held child shows it will cost (display only; the settle overwrites it)", () => {
  it.each([
    ["a fixed price: the reservation", {}, 0.5, 40],
    ["a metered USD cost: its actual plus the add-on", { metered: true, extraNonProviderCredits: 3 }, 0.21, 24],
    ["a metered USD cost collected over the hold: its actual, above the hold", { metered: true, collectOverHold: true }, 0.5, 50],
    ["a measured charge: marked up, never above the reservation", { meteredBaseCredits: 20 }, null, 30],
    ["a measured charge above the reservation: the reservation", { meteredBaseCredits: 100 }, null, 40],
    ["an undelivered loop-trim add-on: the reservation less it", { loopTrimAddonRefundCredits: 6 }, null, 34],
  ] as const)("%s", async (_label, commit, cost, expected) => {
    seed()
    expect(await plannedCommitCredits(LOG, commit, cost, null)).toBe(expected)
  })

  it("a covered step (its pack paid): 0", async () => {
    seed()
    log().metadata = { [COVERED_METADATA_KEY]: { by: "podcast-pack", credits: 40 } }
    expect(await plannedCommitCredits(LOG, { metered: true, meteredCost: 0.5 }, 0.5, null)).toBe(0)
  })

  it("a managed (job-once) reservation settles itself: no figure", async () => {
    seed()
    log().metadata = { reservation_mode: "job-once" }
    expect(await plannedCommitCredits(LOG, {}, 0.5, null)).toBeUndefined()
  })

  it("the completion fields carry an open record in held_completion_fields, never in output_data", async () => {
    seed()
    const fields = await deferredCompletionFields({ usageLogId: LOG, commit: { metered: false }, providerCost: 0.5, workflowExecutionId: null })
    expect(Object.keys(fields).sort()).toEqual(["credits_actual", "held_completion_fields"])
    expect((fields.held_completion_fields as Record<string, Record<string, unknown>>).deferredSettlement).toMatchObject({ state: "held", open: true, providerCost: 0.5 })
  })

  it("stores the provider cost exactly as finalize hands it — an alternate route's own figure included (lib/alternate-route.ts)", async () => {
    seed()
    const fields = await deferredCompletionFields({ usageLogId: LOG, commit: { metered: false }, providerCost: 0.4213, workflowExecutionId: null })
    expect((fields.held_completion_fields as Record<string, Record<string, unknown>>).deferredSettlement!.providerCost).toBe(0.4213)
  })
})
