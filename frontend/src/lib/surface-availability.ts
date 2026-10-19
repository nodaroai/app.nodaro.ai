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
 *
 * PER VIEWER. The backend answers for whoever asked: the admin switch hides a
 * node from users, not from admins, so an admin's `denied` omits what the switch
 * withholds and `hiddenFromUsers` names it. The picker needs no admin logic of
 * its own — it shows what is not denied — and `isNodeHiddenFromUsers` only drives
 * the mark that tells an admin "your users cannot see this one". A non-admin
 * always receives an empty list.
 */

let fetched: {
  nodes: ReadonlySet<string>
  models: ReadonlySet<string>
  hiddenFromUsers: ReadonlySet<string>
  /** Web Scrape SOURCES that follow a withheld node (the Instagram source follows
   *  the Instagram node). The backend sends the result, never the mapping. */
  webScrapeSources: { denied: ReadonlySet<string>; hiddenFromUsers: ReadonlySet<string> }
} | null = null
let inflight: Promise<void> | null = null
/** Whose answer `fetched` is. The answer is per viewer, so it is only ever shown
 *  to the viewer it was fetched for (see `loadSurfaceAvailability`). */
let fetchedFor: string | null = null
/** Bumped whenever the viewer changes — a response that started under an older
 *  value belongs to somebody else and is dropped. */
let viewerSeq = 0

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

/** Drop whatever was fetched — the sign-out path. The static-profile fallback
 *  takes over until the next viewer's answer lands. */
export function resetSurfaceAvailability(): void {
  viewerSeq += 1
  inflight = null
  fetchedFor = null
  if (fetched) {
    fetched = null
    emit()
  }
}

/**
 * Fetch the availability answer for `viewerKey` (the signed-in user's id).
 *
 * The answer is PER VIEWER — an admin's carries nodes their users must not be
 * offered — so a change of account drops the previous viewer's sets BEFORE the
 * new request goes out. Waiting for the response instead would leave an admin's
 * picker (hidden nodes offered, `ADMIN` marks painted) on a user's screen for
 * the round trip, and for the whole session if that request failed. A response
 * that started under a previous viewer is dropped when it lands.
 */
export async function loadSurfaceAvailability(
  getAuthHeaders: () => Promise<Record<string, string>>,
  viewerKey: string,
): Promise<void> {
  if (viewerKey !== fetchedFor) {
    resetSurfaceAvailability()
    fetchedFor = viewerKey
  }
  if (inflight) return inflight
  const request = fetchAnswer(getAuthHeaders, viewerSeq)
  inflight = request
  // Released only by the request that still owns it: a change of viewer has
  // already cleared `inflight`, and may have started a newer request since.
  void request.finally(() => {
    if (inflight === request) inflight = null
  })
  return request
}

/** One fetch of the answer. Never rejects; lands nothing when the viewer it was
 *  started for (`seq`) is no longer the viewer. */
async function fetchAnswer(getAuthHeaders: () => Promise<Record<string, string>>, seq: number): Promise<void> {
  try {
    const headers = await getAuthHeaders()
    const res = await fetch("/v1/surface/availability", { headers })
    if (!res.ok || seq !== viewerSeq) return
    const json = (await res.json()) as {
      nodes?: { denied?: unknown; hiddenFromUsers?: unknown }
      models?: { denied?: unknown }
      webScrapeSources?: { denied?: unknown; hiddenFromUsers?: unknown }
    }
    if (seq !== viewerSeq) return
    const toSet = (v: unknown): ReadonlySet<string> =>
      new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
    fetched = {
      nodes: toSet(json.nodes?.denied),
      models: toSet(json.models?.denied),
      hiddenFromUsers: toSet(json.nodes?.hiddenFromUsers),
      webScrapeSources: {
        denied: toSet(json.webScrapeSources?.denied),
        hiddenFromUsers: toSet(json.webScrapeSources?.hiddenFromUsers),
      },
    }
    emit()
  } catch {
    // Offline / pre-auth — the static-profile fallback stands; the backend
    // is the authority either way.
  }
}

/** Test hook. */
export function __resetSurfaceAvailabilityForTests(
  next?: {
    nodes: string[]
    models: string[]
    hiddenFromUsers?: string[]
    webScrapeSources?: { denied?: string[]; hiddenFromUsers?: string[] }
  } | null,
): void {
  fetched = next
    ? {
        nodes: new Set(next.nodes),
        models: new Set(next.models),
        hiddenFromUsers: new Set(next.hiddenFromUsers ?? []),
        webScrapeSources: {
          denied: new Set(next.webScrapeSources?.denied ?? []),
          hiddenFromUsers: new Set(next.webScrapeSources?.hiddenFromUsers ?? []),
        },
      }
    : null
  if (!next) {
    fetchedFor = null
    inflight = null
    viewerSeq += 1
  }
  emit()
}

/** True once the viewer's availability answer has landed (false before it,
 *  after sign-out, and for the whole session when the fetch failed). */
export function surfaceAvailabilityLoaded(): boolean {
  return fetched !== null
}

/** True when this deployment does not offer this node type in the picker. */
export function isNodeUnavailable(type: string): boolean {
  if (fetched) return fetched.nodes.has(type)
  return runtimeSurfaceProfile().nodes.deny.includes(type)
}

/**
 * True when the viewer is an admin looking at a node the admin switch hides from
 * users. Never true before the fetch lands, and never true for a non-admin —
 * the backend sends them an empty list.
 */
export function isNodeHiddenFromUsers(type: string): boolean {
  return fetched?.hiddenFromUsers.has(type) ?? false
}

/** True when this Web Scrape source is withdrawn from the viewer (it follows a
 *  node that is withheld). Never true before the fetch lands. */
export function isWebScrapeSourceUnavailable(source: string): boolean {
  return fetched?.webScrapeSources.denied.has(source) ?? false
}

/** True when the viewer is an admin looking at a source their users cannot pick. */
export function isWebScrapeSourceHiddenFromUsers(source: string): boolean {
  return fetched?.webScrapeSources.hiddenFromUsers.has(source) ?? false
}

/** True when this deployment does not offer this model id in dropdowns. */
export function isModelUnavailable(id: string): boolean {
  if (fetched) return fetched.models.has(id)
  return runtimeSurfaceProfile().models.deny.includes(id)
}
