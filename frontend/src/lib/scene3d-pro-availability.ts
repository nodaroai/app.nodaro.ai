import { useSyncExternalStore } from "react"
import { PRO3D_RENDER_NODE_TYPE, type Pro3DRenderCapabilities } from "@nodaro/shared"

/**
 * Is 3D Render Pro offerable on this install?
 *
 * The node exists only while the deployment actually has an engine that
 * implements the operation. That is a property of the SERVER, so the browser
 * asks it — `GET /v1/3d-scene/capabilities` reports `pro.available`, derived
 * from the same predicate the route, discovery and the MCP tool list read.
 *
 * DEFAULTS TO HIDDEN, and that direction is the whole point. Before the answer
 * arrives (and on any install that answers "no", including every self-host and
 * every build whose engine predates the operation) the picker simply does not
 * offer the node. The alternative — show it, then withdraw it — puts a node on
 * a canvas that can only 503, which is worse than never having offered it. The
 * cost of being late is that the entry appears a beat after the editor loads.
 *
 * Reactivity is load-bearing for exactly the reason it is in
 * `surface-availability.ts`: the picker filter is a plain function called
 * during render, so without a subscription the "yes" would never repaint and
 * the node would stay hidden for the whole session on an install that has it.
 *
 * This deliberately does NOT gate SAVED nodes. A workflow that already
 * contains one keeps rendering, keeps its stored composition and keeps its
 * stored video — a producer being switched off must never break the readers of
 * what it already produced. The Run button's answer comes from the backend,
 * which refuses honestly.
 */
let available = false
/** The full capability block, so a control menu offers only what this install
 *  can serve rather than everything the contract can express. */
let capabilities: Pro3DRenderCapabilities | null = null
/**
 * The ADVANCED authoring block from the same document.
 *
 * Read from the same fetch rather than a second one: `pro` answers "may I put
 * the Pro node on a canvas", `advanced` answers "which engines may Generate /
 * Edit 3D Scene offer", and both are the same server's answer about the same
 * installed engine. `null` means either "not loaded yet" or "no advanced
 * engine here" — the difference is `advancedLoaded`, because the shared
 * resolver treats UNKNOWN availability (proceed, let the route refuse) and
 * KNOWN-EMPTY (refuse here) differently.
 */
let advanced: Scene3DAdvancedCapabilities | null = null
let advancedLoaded = false
let inflight: Promise<void> | null = null

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

/** Subscribe a filtering component to the answer arriving. */
export function useScene3DProAvailability(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** The picker filter's question. False until the server says otherwise. */
export function isScene3DProAvailable(): boolean {
  return available
}

/** The advanced authoring capabilities this install reports, if any. */
export interface Scene3DAdvancedCapabilities {
  engines: string[]
  sceneSchemaVersions?: number[]
}

/**
 * Advanced engines Generate/Edit 3D Scene may offer.
 *
 * `undefined` while the answer is still outstanding — passed straight through
 * to `resolveScene3DAuthoringEngine`, whose "unknown" branch proceeds and lets
 * the route give the authoritative refusal. Once loaded this is authoritative,
 * including the empty list (no advanced engine installed).
 */
export function scene3DAdvancedEngines(): readonly string[] | undefined {
  return advancedLoaded ? (advanced?.engines ?? []) : undefined
}

/** Subscribed read, for a control that must repaint when the answer lands. */
export function useScene3DAdvancedEngines(): readonly string[] | undefined {
  useScene3DProAvailability()
  return scene3DAdvancedEngines()
}

/** What this install can serve, or `null` before the answer arrives. */
export function scene3DProCapabilities(): Pro3DRenderCapabilities | null {
  return capabilities
}

/** Subscribed read for a control that must re-render when the answer lands. */
export function useScene3DProCapabilities(): Pro3DRenderCapabilities | null {
  useScene3DProAvailability()
  return capabilities
}

/** The node types this readiness answer governs. */
export const ENGINE_GATED_NODE_TYPES: ReadonlySet<string> = new Set([PRO3D_RENDER_NODE_TYPE])

export async function loadScene3DProAvailability(
  getAuthHeaders: () => Promise<Record<string, string>>,
): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      // The capabilities route is authenticated, like every other /v1 read.
      const res = await fetch("/v1/3d-scene/capabilities", { headers: await getAuthHeaders() })
      if (!res.ok) return
      const json = (await res.json()) as {
        pro?: Pro3DRenderCapabilities
        advanced?: Scene3DAdvancedCapabilities | null
      }
      const next = json.pro?.available === true
      capabilities = json.pro && Array.isArray(json.pro.engines) ? json.pro : null
      advanced = json.advanced && Array.isArray(json.advanced.engines) ? json.advanced : null
      advancedLoaded = true
      available = next
      emit()
    } catch {
      // Offline / pre-auth / older backend without the field — stays hidden,
      // which is the safe direction. The backend refuses the route either way.
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Test seam: reset the module between cases. */
export function __setScene3DProAvailableForTests(
  value: boolean,
  next: Pro3DRenderCapabilities | null = null,
): void {
  available = value
  capabilities = next
  emit()
}

/** Test seam for the advanced block. `loaded: false` restores "not known yet". */
export function __setScene3DAdvancedForTests(
  next: Scene3DAdvancedCapabilities | null,
  loaded = true,
): void {
  advanced = next
  advancedLoaded = loaded
  emit()
}
