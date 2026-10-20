/**
 * Schedule cron — checks workflow triggers every 60 seconds.
 * For schedule-type triggers, evaluates cron expressions and fires matching workflows.
 *
 * Runs in the server process (not a separate worker).
 */

import {
  localMinuteKey,
  localTimeIn,
  matchesCronField,
  normalizeScheduleRules,
  scheduleMatchesAt,
} from "@nodaro/shared/workflow"
import { scheduleTriggersEnabled } from "./config.js"
import { supabase } from "./supabase.js"
import {
  admitScheduleTrigger,
  claimTick,
  createScheduleExecution,
  hasActiveExecution,
  releaseTick,
  resolveScheduleBilling,
  scheduleNodeGone,
  type ScheduleTriggerRow,
} from "./schedule-fire.js"
import { sweepScheduleRetries } from "./schedule-retry-sweep.js"

export { matchesCronField }

let timer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
/** The last calendar minute a check evaluated (epoch minutes); null until the first. */
let lastCheckedMinute: number | null = null

/** Ticks land this long after each minute boundary. */
const TICK_MARGIN_MS = 250

/**
 * How many minutes a late tick may evaluate after the fact — a check that
 * overran a boundary, or an event loop stalled through a deploy. A longer
 * gap (a restart) starts fresh: replaying an hour of schedules at once would
 * be worse than the miss.
 */
const MAX_CATCH_UP_MINUTES = 5

/** Until the next tick: just past the next minute boundary. */
export function msUntilNextTick(nowMs = Date.now()): number {
  return 60_000 - (nowMs % 60_000) + TICK_MARGIN_MS
}

/**
 * One tick: every calendar minute since the last one evaluated, this minute
 * included — so a check that ran long does not leave the minute after it
 * unevaluated (with every rule a per-minute question, that is a missed run).
 * A tick landing while the previous one is still running is skipped; the
 * next tick catches its minutes up.
 *
 * Then the retry sweep, once per tick (not per caught-up minute: "has the
 * wait passed" is a question about now, not about a minute). Same process,
 * same gate (`scheduleTriggersEnabled`), same claim-before-enqueue path.
 */
async function tick(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const nowMs = Date.now()
    const thisMinute = Math.floor(nowMs / 60_000)
    const firstMinute = lastCheckedMinute === null ? thisMinute : Math.max(lastCheckedMinute + 1, thisMinute - MAX_CATCH_UP_MINUTES)
    // The active schedules the last check listed: the sweep reads the same
    // rows, so it takes that list instead of asking the database again.
    let triggers: readonly ScheduleTriggerRow[] = []
    for (let minute = firstMinute; minute <= thisMinute; minute += 1) {
      try {
        triggers = await checkScheduledTriggers(minute === thisMinute ? new Date(nowMs) : new Date(minute * 60_000))
      } catch (err) {
        console.error("[schedule-cron] Check failed:", err)
      }
      lastCheckedMinute = minute
    }
    try {
      await sweepScheduleRetries(new Date(), triggers)
    } catch (err) {
      console.error("[schedule-retry] Sweep failed:", err)
    }
  } finally {
    inFlight = false
  }
}

function armNextTick(): void {
  timer = setTimeout(() => {
    if (timer === null) return
    // Re-armed BEFORE the check runs, so the chain stays on the minute
    // boundaries however long a check takes.
    armNextTick()
    void tick()
  }, msUntilNextTick())
}

/**
 * Start the schedule cron. Called once after server starts listening.
 *
 * Every rule is a "does this wall-clock minute match" question, so the check
 * has to see every minute exactly once. A fixed 60 s interval drifts with the
 * event loop, and once its phase wraps past a minute boundary it skips a
 * minute — a run silently missed. Each tick is therefore armed for just after
 * the NEXT minute boundary, and a tick evaluates every minute since the last
 * one (bounded). The first check runs at once so a restart does not miss the
 * minute it started in; `scheduleDue` never fires a schedule twice in one
 * wall-clock minute, so that cannot double a fire the replaced process
 * already made.
 */
export function startScheduleCron(): void {
  if (timer) return

  // Staging and production share one database: a cron in both would read the
  // same rows and fire production users' schedules on staging's build. Only
  // the environment that owns them fires (`scheduleTriggersEnabled`, set by
  // SCHEDULE_TRIGGERS_ENABLED, default: off Railway, or Railway's production).
  if (!scheduleTriggersEnabled()) {
    console.log("[schedule-cron] Disabled in this environment (SCHEDULE_TRIGGERS_ENABLED) — scheduled workflows are not fired here")
    return
  }

  console.log("[schedule-cron] Started, checking once a minute")

  armNextTick()
  void tick()
}

/**
 * Stop the schedule cron.
 */
export function stopScheduleCron(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  lastCheckedMinute = null
}

// ---------------------------------------------------------------------------
// Core cron check
// ---------------------------------------------------------------------------

/**
 * Evaluate every active schedule at `now` (a tick passes the minute it is
 * catching up on). Returns the active schedules it listed and did NOT drop as
 * orphans, for the retry sweep that follows on the tick.
 */
export async function checkScheduledTriggers(now: Date = new Date()): Promise<readonly ScheduleTriggerRow[]> {
  // Fetch active schedule triggers
  const { data: triggers, error } = await supabase
    .from("workflow_triggers")
    .select("id, workflow_id, user_id, config, last_triggered_at")
    .eq("type", "schedule")
    .eq("is_active", true)

  if (error || !triggers) return []

  const dropped = new Set<string>()
  for (const trigger of triggers) {
    try {
      const config = trigger.config as Record<string, unknown>
      if (!scheduleDue(config, (trigger.last_triggered_at as string | null) ?? null, now)) continue

      // The graph is the single source of truth for a node-managed schedule:
      // a row whose Schedule Trigger node is gone from the stored graph is an
      // orphan (a save lane that did not project the removal), and an orphan
      // that keeps firing runs the whole workflow forever with no surface to
      // stop it. Deleted only when the graph was READ and the node is absent;
      // an unreadable graph changes nothing this tick.
      const nodeId = typeof config.nodeId === "string" ? config.nodeId : null
      if (nodeId && (await scheduleNodeGone(trigger.workflow_id, nodeId))) {
        await supabase.from("workflow_triggers").delete().eq("id", trigger.id)
        dropped.add(trigger.id as string)
        console.warn(`[schedule-cron] dropped orphan schedule ${trigger.id}: node ${nodeId} is no longer on workflow ${trigger.workflow_id}`)
        continue
      }

      // Check max executions
      const maxExec = config.maxExecutions as number | undefined
      const execCount = (config.executionCount as number) ?? 0
      if (maxExec !== undefined && maxExec > 0 && execCount >= maxExec) {
        continue
      }

      // Every skip check comes BEFORE the claim, so a skipped tick never
      // consumes it (schedule-fire.ts, shared with the retry sweep): the owner
      // may still run the workflow, no Preview stops the branch, no run of
      // theirs is active, the payer resolves.
      // Snapshot the previous fire time before the claim overwrites it — this
      // is what `{{trigger.last_triggered_at}}` filters compare against (e.g.
      // "fetch items newer than the previous run").
      const previousLastTriggeredAt = (trigger.last_triggered_at as string | null) ?? null
      const row: ScheduleTriggerRow = {
        id: trigger.id, workflow_id: trigger.workflow_id, user_id: trigger.user_id, config, last_triggered_at: previousLastTriggeredAt,
      }
      if (!(await admitScheduleTrigger(row, nodeId))) continue
      if (await hasActiveExecution(row)) continue

      const billingContext = await resolveScheduleBilling(row, "[schedule-cron]")
      if (!billingContext) continue

      // Claim the tick: move `last_triggered_at` from the value this tick READ
      // to now, atomically (schedule-fire.ts — the retry sweep takes the SAME
      // claim, so a fire and a retry of one trigger serialize on one row).
      // Every process that reads the row (two replicas, or two installs
      // sharing one database) races here, and only one update can match —
      // zero rows back means someone else fired, so skip.
      const claimedAt = now.toISOString()
      const claimed = await claimTick(trigger.id, previousLastTriggeredAt, claimedAt)
      if (!claimed) continue

      // A sibling run (a retry the sweep just made, a manual run) may have
      // started between the check above and the claim: asked again under the
      // claim, and the claim given back when so.
      if (await hasActiveExecution(row)) {
        await releaseTick(trigger.id, claimedAt, previousLastTriggeredAt)
        continue
      }

      // Create the execution and enqueue it. The idempotency key stays as a
      // second line behind the claim: the unique (user_id, idempotency_key)
      // index rejects a duplicate for the same previous fire whatever wrote it.
      const created = await createScheduleExecution({
        trigger: row,
        nodeId,
        now,
        previousLastTriggeredAt,
        billingContext,
        idempotencyKey: `schedule:${trigger.id}:${previousLastTriggeredAt ?? "initial"}`,
      })

      if (!created.ok) {
        // A duplicate key means this previous fire already has its run: keep
        // the claim, so the schedule moves on instead of colliding with that
        // key every minute. Any other failure leaves the schedule as it was
        // (the run never existed), so the next tick may retry — released only
        // while the row still carries THIS claim.
        if (!created.duplicate) {
          await releaseTick(trigger.id, claimedAt, previousLastTriggeredAt)
        }
        continue
      }

      // Count the run. The claim already wrote `last_triggered_at`.
      await supabase
        .from("workflow_triggers")
        .update({ config: { ...config, executionCount: execCount + 1 } })
        .eq("id", trigger.id)

      console.log(
        `[schedule-cron] Fired trigger ${trigger.id} for workflow ${trigger.workflow_id}`,
      )
    } catch (err) {
      console.error(`[schedule-cron] Error processing trigger ${trigger.id}:`, err)
    }
  }
  return triggers
    .filter((t) => !dropped.has(t.id as string))
    .map((t) => ({
      id: t.id as string,
      workflow_id: t.workflow_id as string,
      user_id: t.user_id as string,
      config: (t.config ?? {}) as Record<string, unknown>,
      // The value this check READ; a fire this check made has moved the row on,
      // so the sweep's claim on such a trigger fails — as it should: that
      // trigger's run is the fire that just started.
      last_triggered_at: (t.last_triggered_at as string | null) ?? null,
    }))
}

// `claimTick` / `releaseTick` (the per-trigger claim, shared with the retry
// sweep) and `scheduleNodeGone` live in ./schedule-fire.ts.

// ---------------------------------------------------------------------------
// Cron matching
// ---------------------------------------------------------------------------

/**
 * Is this schedule due at `now`? Pure — the row's config, its previous fire,
 * the clock — so it can be pinned directly. Lanes, the first one present wins:
 *
 * 1. `rules` — the Schedule Trigger node's model, shared with the editor
 *    (`@nodaro/shared` `schedule-rules`), read in the config's timezone.
 * 2. `interval` — a legacy "5m" / "1h" / "1d": due once that much time has
 *    passed since the previous fire.
 * 3. `cron` — a legacy 5-field expression.
 *
 * Rows the graph projection writes always carry `rules` (legacy node data is
 * converted on the way through); 2 and 3 serve rows created by hand through
 * `POST /v1/workflow-triggers` and rows not re-projected since the model
 * changed. The minute-matching lanes (1 and 3) never fire twice in one
 * wall-clock minute: a restart's immediate check, a second replica a moment
 * behind, or the clocks falling back would otherwise double a fire under a
 * fresh idempotency key.
 */
export function scheduleDue(
  config: Record<string, unknown>,
  lastTriggeredAt: string | null,
  now: Date,
): boolean {
  const timezone = typeof config.timezone === "string" && config.timezone.trim() ? config.timezone.trim() : undefined

  if (Array.isArray(config.rules)) {
    if (firedThisMinute(lastTriggeredAt, now, timezone)) return false
    return scheduleMatchesAt({ rules: normalizeScheduleRules(config.rules), timezone }, now)
  }

  const interval = config.interval
  if (typeof interval === "string" && interval) {
    return shouldFireByInterval(interval, lastTriggeredAt, now)
  }

  const cron = config.cron
  if (typeof cron === "string" && cron) {
    if (firedThisMinute(lastTriggeredAt, now, timezone)) return false
    return matchesCronMinute(cron, now, timezone)
  }

  return false
}

/** The previous fire was in this same wall-clock minute (in the schedule's timezone). */
function firedThisMinute(lastTriggeredAt: string | null, now: Date, timezone: string | undefined): boolean {
  if (!lastTriggeredAt) return false
  const last = new Date(lastTriggeredAt)
  if (Number.isNaN(last.getTime())) return false
  return localMinuteKey(localTimeIn(last, timezone)) === localMinuteKey(localTimeIn(now, timezone))
}

/**
 * Check if enough time has passed since last trigger based on interval string.
 */
function shouldFireByInterval(
  interval: string,
  lastTriggered: string | null,
  now: Date,
): boolean {
  const ms = parseIntervalToMs(interval)
  if (ms <= 0) return false

  if (!lastTriggered) return true

  const lastTime = new Date(lastTriggered).getTime()
  return now.getTime() - lastTime >= ms
}

export function parseIntervalToMs(interval: string): number {
  const match = interval.match(/^(\d+)([smhd])$/)
  if (!match) return 0

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case "s": return value * 1000
    case "m": return value * 60 * 1000
    case "h": return value * 60 * 60 * 1000
    case "d": return value * 24 * 60 * 60 * 1000
    default: return 0
  }
}

/**
 * Simple cron expression matching (minute-level granularity).
 * Supports standard 5-field cron: minute hour day month weekday
 */
export function matchesCronMinute(
  cronExpr: string,
  now: Date,
  timezone?: string,
): boolean {
  try {
    // Get time in the specified timezone
    let minute: number, hour: number, day: number, month: number, weekday: number

    if (timezone) {
      const formatted = now.toLocaleString("en-US", {
        timeZone: timezone,
        hour12: false,
      })
      const parts = new Date(formatted)
      minute = parts.getMinutes()
      hour = parts.getHours()
      day = parts.getDate()
      month = parts.getMonth() + 1
      weekday = parts.getDay()
    } else {
      minute = now.getUTCMinutes()
      hour = now.getUTCHours()
      day = now.getUTCDate()
      month = now.getUTCMonth() + 1
      weekday = now.getUTCDay()
    }

    const fields = cronExpr.trim().split(/\s+/)
    if (fields.length !== 5) return false

    return (
      matchesCronField(fields[0], minute, 0, 59) &&
      matchesCronField(fields[1], hour, 0, 23) &&
      matchesCronField(fields[2], day, 1, 31) &&
      matchesCronField(fields[3], month, 1, 12) &&
      matchesCronField(fields[4], weekday, 0, 6)
    )
  } catch {
    return false
  }
}

// `matchesCronField` (the per-field matcher: `*`, `N`, `a-b`, `a,b`, `*/N`,
// `a-b/N`, `a/N`) lives in `@nodaro/shared` `schedule-rules` — the `cron`
// rule kind needs it on the editor side too — and is re-exported above.
