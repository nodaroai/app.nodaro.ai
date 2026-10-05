/**
 * Schedule cron — checks workflow triggers every 60 seconds.
 * For schedule-type triggers, evaluates cron expressions and fires matching workflows.
 *
 * Runs in the server process (not a separate worker).
 */

import {
  SCHEDULE_TRIGGER_NODE_TYPE,
  localMinuteKey,
  localTimeIn,
  matchesCronField,
  normalizeScheduleRules,
  scheduleMatchesAt,
} from "@nodaro/shared"
import { scheduleTriggersEnabled } from "./config.js"
import { supabase } from "./supabase.js"
import { orchestrationQueue } from "./orchestration-queue.js"
import { canRunWorkflow } from "./workflow-access.js"
import { resolveBillingContext, shouldRefuseDegradedRunFor } from "./billing-context.js"
import { billingPairColumns } from "./insert-job.js"
import { recordTriggerFireRefusal } from "./trigger-fire-refusal.js"
import { refusePreviewFire } from "./preview-fire-refusal.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"

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
 */
async function tick(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const nowMs = Date.now()
    const thisMinute = Math.floor(nowMs / 60_000)
    const firstMinute = lastCheckedMinute === null ? thisMinute : Math.max(lastCheckedMinute + 1, thisMinute - MAX_CATCH_UP_MINUTES)
    for (let minute = firstMinute; minute <= thisMinute; minute += 1) {
      try {
        await checkScheduledTriggers(minute === thisMinute ? new Date(nowMs) : new Date(minute * 60_000))
      } catch (err) {
        console.error("[schedule-cron] Check failed:", err)
      }
      lastCheckedMinute = minute
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

/** True only when the graph was read and carries no schedule-trigger node with this id. */
async function scheduleNodeGone(workflowId: string, nodeId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("workflows").select("nodes").eq("id", workflowId).maybeSingle()
    if (error || !data || !Array.isArray(data.nodes)) return false
    const nodes = data.nodes as Array<{ id?: unknown; type?: unknown }>
    return !nodes.some((n) => n.id === nodeId && n.type === SCHEDULE_TRIGGER_NODE_TYPE)
  } catch {
    return false
  }
}

let provenanceWarned = false
/** Once per process: the flag read failing every minute is one fact, not sixty log lines an hour. */
function warnProvenanceUnreadableOnce(reason: string): void {
  if (provenanceWarned) return
  provenanceWarned = true
  console.warn(`[schedule-cron] workflow_triggers.owner_initiated unreadable (${reason}) — schedules run as not owner-initiated until migration 436 is on this database`)
}

/** Evaluate every active schedule at `now` (a tick passes the minute it is catching up on). */
export async function checkScheduledTriggers(now: Date = new Date()): Promise<void> {
  // Fetch active schedule triggers
  const { data: triggers, error } = await supabase
    .from("workflow_triggers")
    .select("id, workflow_id, user_id, config, last_triggered_at")
    .eq("type", "schedule")
    .eq("is_active", true)

  if (error || !triggers) return

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
        console.warn(`[schedule-cron] dropped orphan schedule ${trigger.id}: node ${nodeId} is no longer on workflow ${trigger.workflow_id}`)
        continue
      }

      // Check max executions
      const maxExec = config.maxExecutions as number | undefined
      const execCount = (config.executionCount as number) ?? 0
      if (maxExec !== undefined && maxExec > 0 && execCount >= maxExec) {
        continue
      }

      // Does the trigger's owner STILL have the right to run this workflow?
      //
      // The same question the webhook fire path asks, for the same reason: a
      // trigger outlives the session that created it, and a collaborator who
      // created one can later lose the grant, be suspended, or watch the
      // workspace be archived. Without this the schedule keeps firing on its
      // interval forever, running the current graph and writing outputs its
      // owner can still read. Skipped, not deactivated — `canRunWorkflow`
      // returns false for a transient outage too, and a cron that turned a
      // Redis blip into a permanently dead schedule would be worse than one
      // that quietly skips a tick and tries again next interval.
      if (!(await canRunWorkflow(trigger.user_id, trigger.workflow_id))) {
        // P14/W6: leave the owner ONE visible failed row (deduped) instead of
        // a schedule that silently stops producing history.
        await recordTriggerFireRefusal({
          workflowId: trigger.workflow_id,
          userId: trigger.user_id,
          triggerType: "schedule",
          triggerId: trigger.id,
        })
        continue
      }

      // The branch this tick runs stops at a Preview render nobody is there
      // to review: skip the tick, leaving the owner one deduped failed row.
      if (
        await refusePreviewFire({
          workflowId: trigger.workflow_id,
          userId: trigger.user_id,
          triggerType: "schedule",
          triggerId: trigger.id,
          triggerNodeId: nodeId,
        })
      ) {
        continue
      }

      // Check for an execution THIS OWNER already has running. Scoped to them
      // like the webhook path and the run route: before workflows were shared,
      // "an active execution of this workflow" and "an active execution of
      // mine" were the same set, and leaving it workflow-wide would let one
      // member's manual run suppress another member's scheduled one.
      const { data: activeExec } = await supabase
        .from("workflow_executions")
        .select("id")
        .eq("workflow_id", trigger.workflow_id)
        .eq("user_id", trigger.user_id)
        .in("status", ["pending", "running"])
        .limit(1)

      if (activeExec && activeExec.length > 0) continue

      // Snapshot the previous fire time before the claim overwrites it — this
      // is what `{{trigger.last_triggered_at}}` filters compare against (e.g.
      // "fetch items newer than the previous run").
      const previousLastTriggeredAt = trigger.last_triggered_at as string | null

      // P14: payer resolved at FIRE TIME (same rule as the webhook fire);
      // the row carries the pair (W7), the payload carries the context.
      const billingContext = await resolveBillingContext({
        userId: trigger.user_id,
        workflowId: trigger.workflow_id,
      })
      // P14: a DEGRADED resolve on WORKSPACE-HOMED (or unreadable-home)
      // work skips the tick (the next interval retries) rather than billing
      // the owner's pocket — the ONE fail-closed probe.
      if (await shouldRefuseDegradedRunFor(billingContext, trigger.workflow_id)) {
        console.error(`[schedule-cron] degraded billing resolve on workspace workflow ${trigger.workflow_id} — tick skipped`)
        continue
      }

      // Claim the tick: move `last_triggered_at` from the value this tick READ
      // to now, atomically. Every process that reads the row (two replicas,
      // or two installs sharing one database) races here, and only one update
      // can match — zero rows back means someone else fired, so skip. Made
      // after every skip check above, so a skipped tick never consumes it.
      const claimedAt = now.toISOString()
      const claimed = await claimTick(trigger.id, previousLastTriggeredAt, claimedAt)
      if (!claimed) continue

      // Create execution. The idempotency key stays as a second line behind
      // the claim: the unique (user_id, idempotency_key) index rejects a
      // duplicate for the same previous fire whatever wrote it.
      const idempotencyKey = `schedule:${trigger.id}:${previousLastTriggeredAt ?? "initial"}`
      const { data: execution, error: execError } = await supabase
        .from("workflow_executions")
        .insert({
          workflow_id: trigger.workflow_id,
          user_id: trigger.user_id,
          status: "pending",
          trigger_type: "schedule",
          ...billingPairColumns(billingContext),
          trigger_data: {
            timestamp: now.toISOString(),
            cron: config.cron,
            rules: config.rules,
            last_triggered_at: previousLastTriggeredAt,
          },
          idempotency_key: idempotencyKey,
        })
        .select("id")
        .single()

      if (execError || !execution) {
        // A duplicate key means this previous fire already has its run: keep
        // the claim, so the schedule moves on instead of colliding with that
        // key every minute. Any other failure leaves the schedule as it was
        // (the run never existed), so the next tick may retry — released only
        // while the row still carries THIS claim.
        if (execError?.code !== UNIQUE_VIOLATION) {
          await releaseTick(trigger.id, claimedAt, previousLastTriggeredAt)
        }
        continue
      }

      // Count the run. The claim already wrote `last_triggered_at`.
      await supabase
        .from("workflow_triggers")
        .update({ config: { ...config, executionCount: execCount + 1 } })
        .eq("id", trigger.id)

      // Whether this schedule's runs count as the workflow OWNER'S OWN — the
      // only lane a PLAIN stored credential may travel on (plan D3) — is a
      // stored fact about the trigger, writable only by the backend
      // (migration 436): stamped when the owner's own browser session created
      // the row — the editor's sync after a save that ADDED the node
      // (POST /v1/workflows/:id/sync-triggers), or POST /v1/workflow-triggers.
      // A token's or an app's graph write, and every other lane, leaves the
      // default. Never re-derived here: uuid equality would say "owner" for a
      // token-created schedule too. Read best-effort: on a database the column
      // has not reached yet this fails closed and the schedule still fires.
      let ownerInitiated = false
      try {
        const { data: provenance, error: provenanceError } = await supabase
          .from("workflow_triggers")
          .select("owner_initiated")
          .eq("id", trigger.id)
          .maybeSingle()
        if (provenanceError) warnProvenanceUnreadableOnce(provenanceError.message)
        ownerInitiated = provenance?.owner_initiated === true
      } catch (err) {
        warnProvenanceUnreadableOnce(err instanceof Error ? err.message : String(err))
      }

      // Enqueue orchestration (payer resolved above, before the row).
      const jobData: WorkflowExecutionJob = {
        executionId: execution.id,
        workflowId: trigger.workflow_id,
        userId: trigger.user_id,
        triggerType: "schedule",
        ownerInitiated,
        // The node this row was projected from: the worker runs the branch
        // behind it (`triggerRunScope`). A hand-made row names none.
        ...(nodeId ? { triggerNodeId: nodeId } : {}),
        triggerData: {
          timestamp: now.toISOString(),
          last_triggered_at: previousLastTriggeredAt,
        },
        billingContext,
        // Nobody watches a scheduled run: it cannot review a Preview render.
        reviewerPresent: false,
      }

      await orchestrationQueue.add("workflow-execution", jobData, {
        jobId: execution.id,
      })

      console.log(
        `[schedule-cron] Fired trigger ${trigger.id} for workflow ${trigger.workflow_id}`,
      )
    } catch (err) {
      console.error(`[schedule-cron] Error processing trigger ${trigger.id}:`, err)
    }
  }
}

const UNIQUE_VIOLATION = "23505"

/**
 * The atomic tick claim: `last_triggered_at` moves from `previous` to
 * `claimedAt` only if it still holds `previous`. True when this call won.
 * A failed write claims nothing (the tick is skipped, the next one retries).
 */
async function claimTick(triggerId: string, previous: string | null, claimedAt: string): Promise<boolean> {
  const update = supabase.from("workflow_triggers").update({ last_triggered_at: claimedAt }).eq("id", triggerId)
  const conditional = previous === null ? update.is("last_triggered_at", null) : update.eq("last_triggered_at", previous)
  const { data, error } = await conditional.select("id")
  if (error) {
    console.error(`[schedule-cron] could not claim trigger ${triggerId}: ${error.message}`)
    return false
  }
  return Array.isArray(data) && data.length > 0
}

/** Give a claim back — only while the row still carries it, so a later fire is never undone. */
async function releaseTick(triggerId: string, claimedAt: string, previous: string | null): Promise<void> {
  const { error } = await supabase
    .from("workflow_triggers")
    .update({ last_triggered_at: previous })
    .eq("id", triggerId)
    .eq("last_triggered_at", claimedAt)
  if (error) console.error(`[schedule-cron] could not release the claim on trigger ${triggerId}: ${error.message}`)
}

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
