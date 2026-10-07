import { config } from "../../lib/config.js"
import { loopbackFetch } from "./loopback-fetch.js"

/**
 * The standalone orchestrator's source for "does the plugin charge Edit Plan
 * per started minute?" (decided 2026-10-07). The orchestrator loads no plugin,
 * so it asks this container's own API — which loaded it — over the same
 * loopback the sync-HTTP nodes use, with the internal secret. Registered once
 * at boot (`orchestrator.ts` → `setEditPlanPerMinuteSource`); the cache and the
 * fail-closed answer live in `lib/private-plugins/edit-plan-per-minute.ts`.
 * Throws on anything but a 200 with a boolean `perMinute`, which that module
 * turns into the steps.
 */
const TIMEOUT_MS = 3_000

export async function askApiEditPlanPerMinute(fetchImpl?: typeof fetch): Promise<boolean> {
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const res = await loopbackFetch(
    `http://localhost:${port}/v1/edit-plan/capabilities`,
    {
      method: "GET",
      headers: { "X-Internal-Orchestrator-Secret": config.INTERNAL_ORCHESTRATOR_SECRET },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
    { label: "Edit Plan capabilities", delaysMs: [], ...(fetchImpl ? { fetchImpl } : {}) },
  )
  if (!res.ok) throw new Error(`capabilities answered ${res.status}`)
  const body = (await res.json()) as { perMinute?: unknown }
  if (typeof body?.perMinute !== "boolean") throw new Error("capabilities answer has no perMinute")
  return body.perMinute
}
