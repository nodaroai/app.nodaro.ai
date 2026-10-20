// The pure retry decision (lib/schedule-retry.ts): every clause (a)–(f) pinned
// directly, the chain arithmetic, the deterministic key, and what a row says
// about the trigger it belongs to.
import { describe, it, expect } from "vitest"

import {
  RETRYABLE_EXECUTION_STATUSES,
  SCHEDULE_RETRY_WINDOW_MS,
  fireTriggerIdOf,
  retryIdempotencyKey,
  retryStampOf,
  runTriggerIdOf,
  scheduleRetryDue,
  type RetryCandidateRow,
} from "../schedule-retry.js"

const TRIGGER = "trig-1"
const OTHER_TRIGGER = "trig-2"
const NOW = new Date("2026-10-20T12:00:00.000Z")
const RETRY = { afterMinutes: 30, maxAttempts: 3, cheapLanesOnly: true }

const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString()

/** A scheduled fire that ended `failed` 45 minutes ago — due by every clause. */
function failedFire(over: Partial<RetryCandidateRow> = {}): RetryCandidateRow {
  return {
    id: "exec-0",
    status: "failed",
    trigger_type: "schedule",
    idempotency_key: `schedule:${TRIGGER}:2026-10-20T09:00:00.000Z`,
    trigger_data: { timestamp: minutesAgo(50), last_triggered_at: "2026-10-20T09:00:00.000Z" },
    completed_at: minutesAgo(45),
    ...over,
  }
}

/** The first retry of that fire, itself failed 45 minutes ago. */
function failedRetry(attempt: number, over: Partial<RetryCandidateRow> = {}): RetryCandidateRow {
  return {
    id: `exec-${attempt}`,
    status: "failed",
    trigger_type: "schedule",
    idempotency_key: retryIdempotencyKey("exec-0", attempt),
    trigger_data: {
      timestamp: minutesAgo(50),
      last_triggered_at: "2026-10-20T09:00:00.000Z",
      retry: { triggerId: TRIGGER, chainRoot: "exec-0", retryOf: `exec-${attempt - 1}`, attempt, maxAttempts: 3 },
    },
    completed_at: minutesAgo(45),
    ...over,
  }
}

const decide = (latest: RetryCandidateRow | null, over: { config?: Record<string, unknown>; now?: Date; activeExecution?: boolean } = {}) =>
  scheduleRetryDue({
    trigger: { id: TRIGGER, config: over.config ?? { retry: RETRY } },
    latest,
    now: over.now ?? NOW,
    activeExecution: over.activeExecution ?? false,
  })

describe("scheduleRetryDue — a failed scheduled run is retried after the wait, a bounded number of times", () => {
  it("fires the first retry of a failed scheduled fire: attempt 1, the fire as the chain's root, the deterministic key", () => {
    expect(decide(failedFire())).toEqual({
      fire: {
        stamp: { triggerId: TRIGGER, chainRoot: "exec-0", retryOf: "exec-0", attempt: 1, maxAttempts: 3 },
        idempotencyKey: "retry:exec-0:1",
        policy: RETRY,
      },
    })
  })

  it("a failed retry is retried again: the next attempt, the same root, the failed retry as retryOf", () => {
    expect(decide(failedRetry(1))).toEqual({
      fire: {
        stamp: { triggerId: TRIGGER, chainRoot: "exec-0", retryOf: "exec-1", attempt: 2, maxAttempts: 3 },
        idempotencyKey: "retry:exec-0:2",
        policy: RETRY,
      },
    })
    expect(decide(failedRetry(2))).toMatchObject({ fire: { stamp: { attempt: 3, chainRoot: "exec-0", retryOf: "exec-2" }, idempotencyKey: "retry:exec-0:3" } })
  })

  it("(a) no retry policy on the trigger's CURRENT config: nothing is retried, whatever the row says", () => {
    expect(decide(failedFire(), { config: {} })).toEqual({ skip: "retry_off" })
    expect(decide(failedRetry(1), { config: { retry: null } })).toEqual({ skip: "retry_off" })
    expect(decide(failedFire(), { config: { retry: "yes" } })).toEqual({ skip: "retry_off" })
  })

  it("(a) only a schedule run of THIS trigger — a fire whose key names it, or a retry whose stamp does", () => {
    expect(decide(null)).toEqual({ skip: "no_run" })
    expect(decide(failedFire({ trigger_type: "webhook" }))).toEqual({ skip: "not_a_schedule_run" })
    expect(decide(failedFire({ idempotency_key: `schedule:${OTHER_TRIGGER}:initial` }))).toEqual({ skip: "other_trigger" })
    expect(decide(failedRetry(1, { trigger_data: { retry: { triggerId: OTHER_TRIGGER, chainRoot: "x", retryOf: "x", attempt: 1, maxAttempts: 3 } } }))).toEqual({ skip: "other_trigger" })
    // A manual run of the workflow, or a row made before the lane carried a key, is nobody's fire.
    expect(decide(failedFire({ idempotency_key: null }))).toEqual({ skip: "not_a_fire" })
    expect(decide(failedFire({ idempotency_key: "wf-abc" }))).toEqual({ skip: "not_a_fire" })
  })

  it("(a) a refusal tombstone (trigger-fire-refusal.ts: failed, no key, only a triggerId) is not a run and is never retried", () => {
    const tombstone = failedFire({ idempotency_key: null, trigger_data: { triggerId: TRIGGER } })
    expect(decide(tombstone)).toEqual({ skip: "not_a_fire" })
    expect(runTriggerIdOf(tombstone)).toBeNull()
  })

  it("(b) only a run that ended failed or timed out — never cancelled, discarded, stopping, completed or still running", () => {
    expect(RETRYABLE_EXECUTION_STATUSES).toEqual(["failed", "timed_out"])
    expect(decide(failedFire({ status: "timed_out" }))).toMatchObject({ fire: { stamp: { attempt: 1 } } })
    for (const status of ["cancelled", "discarded", "stopping", "completed", "running", "pending"]) {
      expect(decide(failedFire({ status })), status).toEqual({ skip: "not_failed" })
    }
  })

  it("(c) only once afterMinutes have passed since it ended, and only within the retry window", () => {
    expect(decide(failedFire({ completed_at: minutesAgo(29) }))).toEqual({ skip: "too_soon" })
    expect(decide(failedFire({ completed_at: minutesAgo(30) }))).toMatchObject({ fire: {} })
    expect(decide(failedFire({ completed_at: minutesAgo(29) }), { config: { retry: { ...RETRY, afterMinutes: 5 } } })).toMatchObject({ fire: {} })
    const tooOld = new Date(NOW.getTime() - SCHEDULE_RETRY_WINDOW_MS - 60_000).toISOString()
    expect(decide(failedFire({ completed_at: tooOld }))).toEqual({ skip: "too_old" })
    // No end time at all (never finished writing): nothing to count from.
    expect(decide(failedFire({ completed_at: null }))).toEqual({ skip: "no_end_time" })
    expect(decide(failedFire({ completed_at: null, updated_at: minutesAgo(40) }))).toMatchObject({ fire: {} })
    expect(decide(failedFire({ completed_at: "not a date" }))).toEqual({ skip: "no_end_time" })
  })

  it("(d) the chain gets at most maxAttempts retries — the original run is not an attempt", () => {
    expect(decide(failedRetry(3))).toEqual({ skip: "attempts_exhausted" })
    expect(decide(failedRetry(1), { config: { retry: { ...RETRY, maxAttempts: 1 } } })).toEqual({ skip: "attempts_exhausted" })
    // Raising the cap later lets the chain go on; lowering it stops it.
    expect(decide(failedRetry(3), { config: { retry: { ...RETRY, maxAttempts: 5 } } })).toMatchObject({ fire: { stamp: { attempt: 4, maxAttempts: 5 } } })
  })

  it("(e) the key of the next attempt is deterministic — two sweeps of the same failure build the same claim", () => {
    const a = decide(failedFire())
    const b = decide(failedFire())
    expect("fire" in a && "fire" in b && a.fire.idempotencyKey === b.fire.idempotencyKey).toBe(true)
    expect(retryIdempotencyKey("exec-0", 2)).toBe("retry:exec-0:2")
  })

  it("(f) a run of the workflow still pending or running: wait", () => {
    expect(decide(failedFire(), { activeExecution: true })).toEqual({ skip: "already_running" })
  })
})

describe("what a schedule row says about its trigger", () => {
  it("a fire's key names its trigger; anything else is no fire", () => {
    expect(fireTriggerIdOf("schedule:trig-9:initial")).toBe("trig-9")
    expect(fireTriggerIdOf("schedule:trig-9:2026-10-20T09:00:00.000Z")).toBe("trig-9")
    expect(fireTriggerIdOf("retry:exec-0:1")).toBeNull()
    expect(fireTriggerIdOf("webhook:trig-9:initial")).toBeNull()
    expect(fireTriggerIdOf(null)).toBeNull()
    expect(fireTriggerIdOf(42)).toBeNull()
  })

  it("a retry stamp is read only when whole and well-typed", () => {
    const stamp = { triggerId: TRIGGER, chainRoot: "exec-0", retryOf: "exec-0", attempt: 1, maxAttempts: 3 }
    expect(retryStampOf({ retry: stamp })).toEqual(stamp)
    expect(retryStampOf({ retry: { ...stamp, attempt: 0 } })).toBeNull()
    expect(retryStampOf({ retry: { ...stamp, attempt: "1" } })).toBeNull()
    expect(retryStampOf({ retry: { ...stamp, maxAttempts: undefined } })).toBeNull()
    expect(retryStampOf({ retry: { ...stamp, chainRoot: 7 } })).toBeNull()
    expect(retryStampOf({})).toBeNull()
    expect(retryStampOf(null)).toBeNull()
    expect(retryStampOf("retry")).toBeNull()
  })

  it("runTriggerIdOf: the stamp's trigger wins over the key's", () => {
    expect(runTriggerIdOf(failedFire())).toBe(TRIGGER)
    expect(runTriggerIdOf(failedRetry(1))).toBe(TRIGGER)
    expect(runTriggerIdOf({ idempotency_key: "wf-abc", trigger_data: {} })).toBeNull()
  })
})
