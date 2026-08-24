/**
 * Beeble SwitchX relight endpoints (start generation + poll status).
 */

import { beebleFetch } from "./client.js"
import type { CreateSwitchXRequest, SwitchXStatus } from "./types.js"

/** Starts a SwitchX generation. Returns the vendor job id. */
export async function startSwitchXGeneration(req: CreateSwitchXRequest): Promise<{ id: string }> {
  return beebleFetch<{ id: string }>(
    "/v1/switchx/generations",
    {
      method: "POST",
      body: JSON.stringify(req),
    },
    {
      // OUR Nodaro key for the egress seam (single-model endpoint, never a
      // vendor id); the reserve id is `beeble-switchx:<frames>f:<res>p`, so the
      // base key + the max-resolution dimension identify the billed model.
      modelKey: "beeble-switchx",
      ...(req.max_resolution !== undefined
        ? { dimensions: { maxResolution: req.max_resolution } }
        : {}),
    },
  )
}

/** Fetches the current status of a SwitchX generation. */
export async function getSwitchXStatus(id: string): Promise<SwitchXStatus> {
  return beebleFetch<SwitchXStatus>(
    `/v1/switchx/generations/${encodeURIComponent(id)}`,
    { method: "GET" },
  )
}
