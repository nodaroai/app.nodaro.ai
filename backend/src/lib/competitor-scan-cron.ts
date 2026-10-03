import type { FastifyInstance } from "fastify"
import { config, hasCredits } from "./config.js"

/**
 * Minute tick for scheduled competitor scans — sibling of
 * `recast-driver-cron.ts`, same in-server lifecycle.
 *
 * KNOWS NOTHING ABOUT COMPETITORS. One URL. Which brands are due, how a due
 * one is claimed so two instances never start the same scan, and the scan
 * itself (started as its owner through the paid route, so the price, the
 * availability switch and every refusal apply as for a click) all live in
 * the plugin that serves `/v1/competitors*`.
 *
 * OFF by default: a scheduled scan spends the owner's credits, so the tick is
 * enabled deliberately per environment (COMPETITOR_SCAN_CRON_ENABLED=true).
 */

const TICK_MS = 60_000

let intervalId: ReturnType<typeof setInterval> | null = null
let inFlight = false
/** Set when the route answers 404 — the plugin is not loaded; retrying that forever is noise. */
let unavailable = false

function enabled(): boolean {
  return hasCredits() && process.env.COMPETITOR_SCAN_CRON_ENABLED === "true"
}

export async function competitorScanTick(app: FastifyInstance): Promise<"ran" | "skipped" | "disabled"> {
  if (!enabled() || unavailable) return "disabled"
  if (inFlight) return "skipped"
  inFlight = true
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/competitors/internal/tick",
      headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
      payload: {},
    })
    if (res.statusCode === 404) {
      unavailable = true
      console.log("[competitor-scans] route not found — competitors plugin not loaded; cron disabled")
    } else if (res.statusCode < 200 || res.statusCode >= 300) {
      console.error(`[competitor-scans] tick failed: ${res.statusCode}`)
    }
    return "ran"
  } catch (err) {
    console.error("[competitor-scans] tick threw:", err)
    return "ran"
  } finally {
    inFlight = false
  }
}

export function startCompetitorScanCron(app: FastifyInstance): void {
  if (intervalId) return
  if (!enabled()) {
    console.log("[competitor-scans] disabled (set COMPETITOR_SCAN_CRON_ENABLED=true on Cloud to enable)")
    return
  }
  console.log(`[competitor-scans] started, ticking every ${TICK_MS / 1000}s`)
  intervalId = setInterval(() => {
    void competitorScanTick(app)
  }, TICK_MS)
}

export function stopCompetitorScanCron(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/** Test hook — clears the module-level latches. */
export function resetCompetitorScanCronForTests(): void {
  stopCompetitorScanCron()
  inFlight = false
  unavailable = false
}
