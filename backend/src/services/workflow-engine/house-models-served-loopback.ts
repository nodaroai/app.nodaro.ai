import { config } from "../../lib/config.js"
import { loopbackFetch } from "./loopback-fetch.js"

/**
 * The standalone orchestrator's source for "which house models does this
 * deployment serve?" (docs/design/house-models.md). The orchestrator loads no
 * plugin, so it asks this container's own API — which loaded it — over the same
 * loopback the sync-HTTP nodes use, with the internal secret. Registered once at
 * boot (`orchestrator.ts` → `setHouseModelsServedSource`); the cache and the
 * fail-closed answer live in `lib/house-models-served.ts`. Throws on anything
 * but a 200 with a list of ids, which that module turns into "none served".
 */
const TIMEOUT_MS = 3_000

export async function askApiHouseModelsServed(fetchImpl?: typeof fetch): Promise<string[]> {
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const res = await loopbackFetch(
    `http://localhost:${port}/v1/house-models/internal/served`,
    {
      method: "GET",
      headers: { "X-Internal-Orchestrator-Secret": config.INTERNAL_ORCHESTRATOR_SECRET },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
    { label: "House models served", delaysMs: [], ...(fetchImpl ? { fetchImpl } : {}) },
  )
  if (!res.ok) throw new Error(`house models served: the API answered ${res.status}`)
  const body = (await res.json()) as { ids?: unknown } | null
  if (!Array.isArray(body?.ids) || !body.ids.every((id) => typeof id === "string")) {
    throw new Error("house models served: the answer is not a list of ids")
  }
  return body.ids as string[]
}
