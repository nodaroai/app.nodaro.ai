import { useSyncExternalStore } from "react"
import { runtimeSurfaceProfile } from "./surface-profile"

/**
 * Browser mirror of the backend's three-layer node/model availability funnel
 * (lib/surface-deny.ts): edition/code → surface-profile factory (allow/deny)
 * → admin runtime override. The static profile in /config.js cannot carry the
 * runtime override, so the dashboard fetches GET /v1/surface/availability once
 * (post-auth) and the picker / model-dropdown filters read the fetched
 * EFFECTIVE denied sets through the two helpers below.
 *
 * REACTIVITY IS LOAD-BEARING, not a nicety. These sets arrive AFTER the first
 * render (one authenticated fetch), and the two consumers — the Add Node
 * picker and the model dropdowns — read them through plain functions during
 * render. Without a subscription nothing re-renders when the data lands, so a
 * deployment with a whitelist showed its users the FULL picker and model
 * lists for the rest of the session: the narrowing silently did nothing in the
 * UI. Components that filter must call `useSurfaceAvailability()`.
 *
 * Before the fetch lands, the helpers fall back to the static profile's
 * explicit `deny` lists only — deliberately NOT the `allow` whitelist
 * inversion, whose gateable-universe scoping (utility nodes exempt) lives
 * backend-side; a brief over-show costs nothing because the backend refuses a
 * denied node/model at write and run regardless. Stock deployments (no allow,
 * no override) render byte-identically with or without the fetch.
 */

let fetched: { nodes: ReadonlySet<string>; models: ReadonlySet<string> } | null = null
let inflight: Promise<void> | null = null

// A version counter rather than the set itself: useSyncExternalStore compares
// snapshots by identity, and a number is stable between changes where a freshly
// built Set would not be (an infinite re-render).
let version = 0
const listeners = new Set<() => void>()
function emit(): void {
  version += 1
  for (const l of listeners) l()
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const snapshot = (): number => version

/**
 * Subscribe a filtering component to availability arriving. Returns the
 * version, which callers ignore — the point is the re-render.
 */
export function useSurfaceAvailability(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export async function loadSurfaceAvailability(getAuthHeaders: () => Promise<Record<string, string>>): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch("/v1/surface/availability", { headers })
      if (!res.ok) return
      const json = (await res.json()) as {
        nodes?: { denied?: unknown }
        models?: { denied?: unknown }
      }
      const toSet = (v: unknown): ReadonlySet<string> =>
        new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
      fetched = { nodes: toSet(json.nodes?.denied), models: toSet(json.models?.denied) }
      emit()
    } catch {
      // Offline / pre-auth — the static-profile fallback stands; the backend
      // is the authority either way.
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Test hook. */
export function __resetSurfaceAvailabilityForTests(next?: { nodes: string[]; models: string[] } | null): void {
  fetched = next ? { nodes: new Set(next.nodes), models: new Set(next.models) } : null
  emit()
}

/** True when this deployment does not offer this node type in the picker. */
export function isNodeUnavailable(type: string): boolean {
  if (fetched) return fetched.nodes.has(type)
  return runtimeSurfaceProfile().nodes.deny.includes(type)
}

/** True when this deployment does not offer this model id in dropdowns. */
export function isModelUnavailable(id: string): boolean {
  if (fetched) return fetched.models.has(id)
  return runtimeSurfaceProfile().models.deny.includes(id)
}
