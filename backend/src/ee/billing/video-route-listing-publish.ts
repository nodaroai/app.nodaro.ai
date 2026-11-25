/**
 * Publishes what this environment's route lists (`video_route_listing`, one
 * entry per environment), so a process that loads no plugin — the standalone
 * orchestrator — lists and gates on exactly the prices the API lists
 * (lib/alternate-route-prices.ts `routeListingSource`). Called once after the
 * plugins load in the API process. Best effort: never throws; a copy that did
 * not change is not written again.
 */
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { VIDEO_ROUTE_LISTING_KEY, routeListingSnapshotFor, routeListingSnapshotOf } from "../../lib/alternate-route-prices.js"
import { updateSettingsRow } from "../../lib/video-route-policy-store.js"
import { modelOfPriceId } from "./video-route-listing.js"

export async function publishRouteListing(): Promise<void> {
  try {
    const snap = routeListingSnapshotOf(modelOfPriceId)
    if (!snap) return
    const env = getRuntimeEnv()
    await updateSettingsRow(VIDEO_ROUTE_LISTING_KEY, (raw) => {
      const before = routeListingSnapshotFor(raw, env)
      const same = before !== null && before.v2 === snap.v2 &&
        JSON.stringify([...before.capable].sort()) === JSON.stringify([...snap.capable].sort()) &&
        JSON.stringify(Object.entries(before.pricesUsd).sort()) === JSON.stringify(Object.entries(snap.pricesUsd).sort())
      if (same) return undefined
      const all = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
      return { ...all, [env]: snap }
    })
  } catch (err) {
    console.warn(`[video-route] publishing the route's listing failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
