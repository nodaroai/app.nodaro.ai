/**
 * Schedule cron — checks workflow triggers every 60 seconds.
 * For schedule-type triggers, evaluates cron expressions and fires matching workflows.
 *
 * Runs in the server process (not a separate worker).
 */

import { supabase } from "./supabase.js"
import { orchestrationQueue } from "./orchestration-queue.js"
import type { WorkflowExecutionJob } from "../services/workflow-engine/types.js"

let intervalId: ReturnType<typeof setInterval> | null = null

/**
 * Start the schedule cron. Called once after server starts listening.
 */
export function startScheduleCron(): void {
  if (intervalId) return

  console.log("[schedule-cron] Started, checking every 60 seconds")

  // Run once immediately, then every 60 seconds
  checkScheduledTriggers().catch((err) =>
    console.error("[schedule-cron] Initial check failed:", err),
  )

  intervalId = setInterval(async () => {
    try {
      await checkScheduledTriggers()
    } catch (err) {
      console.error("[schedule-cron] Check failed:", err)
    }
  }, 60_000)
}

/**
 * Stop the schedule cron.
 */
export function stopScheduleCron(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

// ---------------------------------------------------------------------------
// Core cron check
// ---------------------------------------------------------------------------

async function checkScheduledTriggers(): Promise<void> {
  // Fetch active schedule triggers
  const { data: triggers, error } = await supabase
    .from("workflow_triggers")
    .select("id, workflow_id, user_id, config, last_triggered_at")
    .eq("type", "schedule")
    .eq("is_active", true)

  if (error || !triggers) return

  const now = new Date()

  for (const trigger of triggers) {
    try {
      const config = trigger.config as Record<string, unknown>
      const shouldFire = await shouldTriggerFire(trigger, config, now)

      if (!shouldFire) continue

      // Check max executions
      const maxExec = config.maxExecutions as number | undefined
      const execCount = (config.executionCount as number) ?? 0
      if (maxExec !== undefined && maxExec > 0 && execCount >= maxExec) {
        continue
      }

      // Check for already-running execution
      const { data: activeExec } = await supabase
        .from("workflow_executions")
        .select("id")
        .eq("workflow_id", trigger.workflow_id)
        .in("status", ["pending", "running"])
        .limit(1)

      if (activeExec && activeExec.length > 0) continue

      // Snapshot the previous fire time before we overwrite it below — this is
      // what `{{trigger.last_triggered_at}}` filters compare against (e.g.
      // "fetch items newer than the previous run").
      const previousLastTriggeredAt = trigger.last_triggered_at as string | null

      // Create execution
      const { data: execution, error: execError } = await supabase
        .from("workflow_executions")
        .insert({
          workflow_id: trigger.workflow_id,
          user_id: trigger.user_id,
          status: "pending",
          trigger_type: "schedule",
          trigger_data: {
            timestamp: now.toISOString(),
            cron: config.cron,
            last_triggered_at: previousLastTriggeredAt,
          },
        })
        .select("id")
        .single()

      if (execError || !execution) continue

      // Update trigger
      await supabase
        .from("workflow_triggers")
        .update({
          last_triggered_at: now.toISOString(),
          config: { ...config, executionCount: execCount + 1 },
        })
        .eq("id", trigger.id)

      // Enqueue orchestration
      const jobData: WorkflowExecutionJob = {
        executionId: execution.id,
        workflowId: trigger.workflow_id,
        userId: trigger.user_id,
        triggerType: "schedule",
        triggerData: {
          timestamp: now.toISOString(),
          last_triggered_at: previousLastTriggeredAt,
        },
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

// ---------------------------------------------------------------------------
// Cron matching
// ---------------------------------------------------------------------------

/**
 * Determine if a trigger should fire now.
 * Supports both cron expressions and simple interval strings.
 */
async function shouldTriggerFire(
  trigger: Record<string, unknown>,
  config: Record<string, unknown>,
  now: Date,
): Promise<boolean> {
  const lastTriggered = trigger.last_triggered_at as string | null

  // Simple interval support (e.g., "5m", "1h", "1d")
  const interval = config.interval as string | undefined
  if (interval) {
    return shouldFireByInterval(interval, lastTriggered, now)
  }

  // Cron expression support
  const cron = config.cron as string | undefined
  if (cron) {
    return matchesCronMinute(cron, now, config.timezone as string | undefined)
  }

  return false
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

export function matchesCronField(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true

  // Handle comma-separated values: "1,15,30"
  if (field.includes(",")) {
    return field.split(",").some((part) => matchesCronField(part.trim(), value, min, max))
  }

  // IMPORTANT: handle step values BEFORE ranges. Otherwise a field like
  // "1-10/2" enters the range branch (which contains "-"), splits on "-"
  // into ["1", "10/2"], and Number("10/2") is NaN — the range never matches
  // and the trigger silently never fires. Standard cron syntax allows ranges
  // with steps, so this branch must run first.
  if (field.includes("/")) {
    const [range, step] = field.split("/")
    const stepNum = parseInt(step, 10)
    if (Number.isNaN(stepNum) || stepNum <= 0) return false
    if (range === "*") {
      return value % stepNum === 0
    }
    if (range.includes("-")) {
      const [start, end] = parseRange(range)
      if (start == null || end == null) return false
      return value >= start && value <= end && (value - start) % stepNum === 0
    }
    // "5/15" form (start with no end) — match start, start+step, start+2step, ...
    // up to the field's max. Standard cron treats this as start-max/step.
    const start = parseInt(range, 10)
    if (Number.isNaN(start)) return false
    return value >= start && value <= max && (value - start) % stepNum === 0
  }

  // Handle ranges: "1-5"
  if (field.includes("-")) {
    const [start, end] = parseRange(field)
    if (start == null || end == null) return false
    return value >= start && value <= end
  }

  // Simple number
  const num = parseInt(field, 10)
  if (Number.isNaN(num)) return false
  return num === value
}

// parseInt (not Number) so empty strings — "" from "-5".split("-") or
// "1-".split("-") — produce NaN instead of silently coercing to 0.
function parseRange(range: string): [number | null, number | null] {
  const parts = range.split("-")
  if (parts.length !== 2) return [null, null]
  const start = parseInt(parts[0], 10)
  const end = parseInt(parts[1], 10)
  return [Number.isNaN(start) ? null : start, Number.isNaN(end) ? null : end]
}
