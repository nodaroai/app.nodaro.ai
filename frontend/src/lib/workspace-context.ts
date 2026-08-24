import type { MeOrganizations, OrganizationSummary, WorkspaceSummary } from "@nodaro/shared"

export type { OrganizationSummary, WorkspaceSummary }
import { hasOrganizations } from "@/lib/edition"
import { createClient } from "@/lib/supabase"

/**
 * Which workspace the browser is working in — the SEAM.
 *
 * A module-level store rather than context, for the same reason `use-auth`
 * is one: `api.ts` needs the answer synchronously, from outside React, on
 * every request it builds. A provider could not give it that.
 *
 * This module is CORE, deliberately, while every organization surface is
 * enterprise: what lives here is plumbing — an id, where it is remembered,
 * and when to forget it — and core code (`api.ts`) has to read it on every
 * request. The React bindings and the vocabulary that renders an
 * organization's own words live in `@/ee/hooks/use-workspace`, which is
 * where the product is. Same split as the backend: a thin core seam, the
 * deciding done elsewhere.
 *
 * The selection is a PREFERENCE, never a permission. It decides which
 * workspace a list is read from and where a create lands; it can neither
 * widen access nor move a charge, because the server decides both from the
 * object's own workspace. That is why losing it is survivable: a selection
 * the server refuses is simply cleared.
 *
 * Persisted twice on purpose — `localStorage` so a reload keeps the
 * selection instantly, and `profiles.last_workspace_id` so a different
 * device picks it up. The server's copy wins on hydration.
 */

export type WorkspaceStatus = "idle" | "loading" | "ready" | "unavailable"

export interface WorkspaceState {
  status: WorkspaceStatus
  organizations: OrganizationSummary[]
  workspaces: WorkspaceSummary[]
  /** null = the personal space. */
  activeWorkspaceId: string | null
}

export const ACTIVE_WORKSPACE_STORAGE_KEY = "nodaro-active-workspace"

const EMPTY: WorkspaceState = Object.freeze({
  status: "idle",
  organizations: [],
  workspaces: [],
  activeWorkspaceId: null,
})

let state: WorkspaceState = EMPTY
let hydrating: Promise<void> | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): WorkspaceState {
  return state
}

function setState(next: Partial<WorkspaceState>): void {
  state = { ...state, ...next }
  notify()
}

function readStoredWorkspaceId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)
  } catch {
    // A private window, or storage the browser refuses. Not having a
    // remembered selection is a normal state, not an error.
    return null
  }
}

function writeStoredWorkspaceId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id)
    else window.localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY)
  } catch {
    // Best effort; the server's copy is the durable one.
  }
}

/**
 * The active workspace, synchronously, for code outside React — `api.ts`
 * reads this while building headers. Null on any build without the feature,
 * so the header is never sent where it would mean nothing.
 */
/**
 * Resolve once the workspace selection has settled.
 *
 * The React side holds a query behind `ready`; a plain function has no
 * render to hold, so it waits here instead. Same reason, same moment: a
 * remembered workspace is not trusted until the server confirms it, and
 * answering "personal" in the meantime shows private work to someone who is
 * standing in a class.
 *
 * Returns immediately when organizations are off, when the selection is
 * already settled, or when nothing is in flight to wait for — the last case
 * being a caller that runs before hydration was ever started, which is no
 * worse than the behaviour it had before this existed.
 */
export async function awaitWorkspaceScope(): Promise<void> {
  if (!hasOrganizations()) return
  if (state.status === "ready" || state.status === "unavailable") return
  if (hydrating) await hydrating
}

export function getActiveWorkspaceId(): string | null {
  if (!hasOrganizations()) return null
  return state.activeWorkspaceId
}

export function getWorkspaceState(): WorkspaceState {
  return state
}

interface MeResponse {
  data?: MeOrganizations
}

/**
 * Load what the caller belongs to. Call once the session exists; concurrent
 * calls share one request.
 *
 * `/v1/me` reports three distinct things and they are kept distinct here:
 * the fields ABSENT means this instance has no organizations; present and
 * empty means the caller belongs to none; and `organizationsUnavailable`
 * means the lookup failed — in which case the remembered selection is KEPT,
 * because telling someone their school vanished during a cache blip is worse
 * than showing a stale switcher.
 */
export async function hydrateWorkspaces(): Promise<void> {
  if (!hasOrganizations()) return
  if (hydrating) return hydrating

  hydrating = (async () => {
    setState({ status: "loading" })
    try {
      // Imported lazily so this module stays usable from `api.ts` without a
      // cycle (api.ts reads getActiveWorkspaceId).
      const { getAuthHeaders, API_BASE_URL } = await import("@/lib/api")
      const res = await fetch(`${API_BASE_URL}/v1/me`, { headers: await getAuthHeaders() })
      if (!res.ok) throw new Error(`/v1/me responded ${res.status}`)
      const body = (await res.json()) as MeResponse
      const data = body.data ?? {}

      if (data.organizationsUnavailable) {
        setState({ status: "unavailable" })
        return
      }
      const organizations = data.organizations ?? []
      const workspaces = data.workspaces ?? []

      // The server's remembered workspace wins over this browser's, and a
      // workspace the caller no longer belongs to is no selection at all.
      const remembered = data.lastWorkspaceId ?? readStoredWorkspaceId()
      const active = workspaces.some((w) => w.id === remembered) ? (remembered ?? null) : null
      writeStoredWorkspaceId(active)
      setState({ status: "ready", organizations, workspaces, activeWorkspaceId: active })
    } catch {
      // Same reasoning as `organizationsUnavailable`: an unreachable endpoint
      // is not evidence that the caller belongs to nothing.
      setState({ status: "unavailable" })
    } finally {
      hydrating = null
    }
  })()
  return hydrating
}

/**
 * Switch context. Persists to this browser immediately and to the profile in
 * the background — a failed write there costs a cross-device preference, not
 * the switch the person just made.
 */
export function setActiveWorkspace(id: string | null): void {
  if (state.activeWorkspaceId === id) return
  writeStoredWorkspaceId(id)
  setState({ activeWorkspaceId: id })
  void persistLastWorkspace(id)
}

async function persistLastWorkspace(id: string | null): Promise<void> {
  try {
    const supabase = createClient()
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user?.id
    if (!userId) return
    await supabase.from("profiles").update({ last_workspace_id: id }).eq("id", userId)
  } catch {
    // Best effort.
  }
}

/**
 * The server refused the selection — the caller was removed, suspended, or
 * the organization stopped being active. Clearing it is the whole remedy:
 * the next request runs in the personal space and the switcher no longer
 * offers what is gone.
 */
export function clearActiveWorkspaceAfterRefusal(): void {
  if (state.activeWorkspaceId === null) return
  writeStoredWorkspaceId(null)
  // The SELECTION goes and the list stays. The two refusal codes that reach
  // here are not only the context seam's: a route uses `member_suspended`
  // for an object-level refusal too — a suspended member editing a workspace
  // they may still read — and nothing at this choke point can tell the two
  // apart. Dropping the selection is harmless either way, but dropping the
  // workspace from the switcher would hide something the caller is still
  // allowed to open. The next hydration reconciles the list against the
  // server, which is the thing that actually knows.
  setState({ activeWorkspaceId: null })
}

/** Test seam: forget everything this module remembers. */
export function resetWorkspaceState(): void {
  state = EMPTY
  hydrating = null
  writeStoredWorkspaceId(null)
  notify()
}


/** For a React binding to subscribe with `useSyncExternalStore`. */
export const workspaceStore = { subscribe, getSnapshot }
