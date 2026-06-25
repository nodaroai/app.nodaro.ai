/**
 * Beeble SwitchX relight endpoints (start generation + poll status).
 */

import { beebleFetch } from "./client.js"
import type { CreateSwitchXRequest, SwitchXStatus } from "./types.js"

/** Starts a SwitchX generation. Returns the vendor job id. */
export async function startSwitchXGeneration(req: CreateSwitchXRequest): Promise<{ id: string }> {
  return beebleFetch<{ id: string }>("/v1/switchx/generations", {
    method: "POST",
    body: JSON.stringify(req),
  })
}

/** Fetches the current status of a SwitchX generation. */
export async function getSwitchXStatus(id: string): Promise<SwitchXStatus> {
  return beebleFetch<SwitchXStatus>(
    `/v1/switchx/generations/${encodeURIComponent(id)}`,
    { method: "GET" },
  )
}
