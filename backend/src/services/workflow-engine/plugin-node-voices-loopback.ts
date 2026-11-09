import { config } from "../../lib/config.js"
import { checkedVoices } from "../../lib/private-plugins/plugin-node-voices.js"
import { loopbackFetch } from "./loopback-fetch.js"

/**
 * The standalone orchestrator's source for "which voices will this
 * plugin-served node speak in?" under the voice lock. The orchestrator loads no
 * plugin, so it asks this container's own API — which loaded it and runs the
 * reader the plugin declares — over the same loopback the sync-HTTP nodes use,
 * with the internal secret. Registered once at boot (`orchestrator.ts` →
 * `setPluginNodeVoicesSource`); asked only under a lock, per plugin speech node
 * run (`lib/private-plugins/plugin-node-voices.ts`).
 *
 * Answers the voices, or `null` when no reader is declared for the type.
 * THROWS on anything else — an error status, an answer that is not a list of
 * voice ids or null, an API that cannot be reached — and the node then fails
 * before its job exists: never an allow.
 */
const TIMEOUT_MS = 5_000

export async function askApiPluginNodeVoices(
  type: string,
  data: Readonly<Record<string, unknown>>,
  inputs: Readonly<Record<string, unknown>>,
  fetchImpl?: typeof fetch,
): Promise<string[] | null> {
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const res = await loopbackFetch(
    `http://localhost:${port}/v1/voices/internal/node-voices`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Orchestrator-Secret": config.INTERNAL_ORCHESTRATOR_SECRET,
      },
      body: JSON.stringify({ type, data, inputs }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
    { label: "Plugin node voices", ...(fetchImpl ? { fetchImpl } : {}) },
  )
  if (!res.ok) throw new Error(`Plugin node voices: the API answered ${res.status} for a ${type} node`)
  const body = (await res.json()) as { voices?: unknown } | null
  if (body?.voices === null) return null
  return checkedVoices(type, body?.voices)
}
