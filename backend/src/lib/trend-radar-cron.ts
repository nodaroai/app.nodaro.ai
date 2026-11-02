/**
 * Minute tick for the Trend Radar's daily run — a sibling of
 * `competitor-scan-cron.ts`, same in-server lifecycle.
 *
 * KNOWS NOTHING ABOUT TRENDS. One URL: whether the run is due (the run hour,
 * once a day) and the run itself live in the ee route that serves
 * `/v1/trend-radar*`; this only asks.
 *
 * OFF by default: the run reads other sites and spends the runner's searches,
 * so the tick is enabled deliberately per environment
 * (`TREND_RADAR_ENABLED=true`) — on exactly one environment of a shared
 * database, as the founder notifications are.
 */
import type { FastifyInstance } from "fastify"
import { config, hasAdmin, hasCredits } from "./config.js"

const TICK_MS = 60_000

let intervalId: ReturnType<typeof setInterval> | null = null
let inFlight = false
/** Set when the route answers 404 — not registered on this edition; asking forever is noise. */
let unavailable = false

function enabled(): boolean {
  return hasAdmin() && hasCredits() && process.env.TREND_RADAR_ENABLED === "true"
}

export async function trendRadarTick(app: FastifyInstance): Promise<"ran" | "skipped" | "disabled"> {
  if (!enabled() || unavailable) return "disabled"
  if (inFlight) return "skipped"
  inFlight = true
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/trend-radar/internal/tick",
      headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
      payload: {},
    })
    if (res.statusCode === 404) {
      unavailable = true
      console.log("[trend-radar] route not found — not registered on this edition; cron disabled")
    } else if (res.statusCode < 200 || res.statusCode >= 300) {
      console.error(`[trend-radar] tick failed: ${res.statusCode}`)
    }
    return "ran"
  } catch (err) {
    console.error("[trend-radar] tick threw:", err)
    return "ran"
  } finally {
    inFlight = false
  }
}

export function startTrendRadarCron(app: FastifyInstance): void {
  if (intervalId) return
  if (!enabled()) {
    console.log("[trend-radar] disabled (set TREND_RADAR_ENABLED=true on Cloud to enable)")
    return
  }
  console.log(`[trend-radar] started, ticking every ${TICK_MS / 1000}s`)
  intervalId = setInterval(() => {
    void trendRadarTick(app)
  }, TICK_MS)
}

export function stopTrendRadarCron(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/** Test hook — clears the module-level latches. */
export function resetTrendRadarCronForTests(): void {
  stopTrendRadarCron()
  inFlight = false
  unavailable = false
}
