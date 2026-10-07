import { useSyncExternalStore } from "react"

/**
 * Which Edit Plan modes can this server plan?
 *
 * A mode newer than the server's plugin (Trailer, on a plugin built before it)
 * is refused by the server when it runs. The browser asks
 * `GET /v1/edit-plan/capabilities`, which reads the SAME declaration that
 * refusal reads, and the config panel greys out a mode the server does not
 * list, with the reason (decided 2026-10-06).
 *
 * DEFAULTS TO "NOT YET" for anything beyond the three Phase-1 modes, and that
 * direction is the point: before the answer arrives, after a failed fetch, and
 * on a backend without the route, Trailer stays greyed out. A self-hosted
 * install (Community, Business) answers what nodaro.ai plans when it is
 * connected, and the three Phase-1 modes when it is not (round 6, decided
 * 2026-10-06 — the server resolves that; this module only reads the answer).
 * The Phase-1 modes are planned by every server, so they are never greyed out,
 * whatever the answer says.
 *
 * Reactivity is load-bearing for the same reason as in
 * `scene3d-pro-availability.ts`: the panel reads this during render, and the
 * answer lands after the first render.
 *
 * The answer can change while a session is open: a connected self-host follows
 * nodaro.ai's, which changes when nodaro.ai ships a mode or can't be reached.
 * So the editor asks again — at most once per `EDIT_PLAN_MODES_MAX_AGE_MS`,
 * the same minute the server reuses its own answer for — when an Edit Plan
 * panel opens and when the window regains focus (`watchEditPlanModes`). A
 * failed attempt counts too, so an outage is not hammered.
 *
 * Round 7 (decided 2026-10-06): the answer also says who answered (`source`),
 * so a greyed-out mode says why (`editPlanModeUnavailableReason`): nodaro.ai
 * itself keeps "needs a plugin update"; a self-host connected to nodaro.ai says
 * "Available once nodaro.ai supports it", or "Couldn't reach nodaro.ai — try
 * again later" when its server could not ask. What is greyed out is unchanged.
 *
 * This never rewrites a saved node. A node already in trailer mode keeps it and
 * the panel says why a run would be refused.
 */

/** Planned by every server, declared or not (the backend's Phase-1 set). */
const PHASE1_EDIT_PLAN_MODES: readonly string[] = ["tighten", "clips", "chapters"]

/** How long an answer (or a failed attempt) is reused before asking again. */
export const EDIT_PLAN_MODES_MAX_AGE_MS = 60_000

type AuthHeaders = () => Promise<Record<string, string>>

/** Who answered (`GET /v1/edit-plan/capabilities` → `source`). */
export type EditPlanModesSource = "server" | "nodaro.ai" | "nodaro.ai-unreachable"
const SOURCES: readonly EditPlanModesSource[] = ["server", "nodaro.ai", "nodaro.ai-unreachable"]

/** Why a mode is greyed out. */
export type EditPlanModeUnavailableReason = "plugin-update" | "nodaro-unsupported" | "nodaro-unreachable"

let reported: ReadonlySet<string> | null = null
let reportedSource: EditPlanModesSource | null = null
let inflight: Promise<void> | null = null
/** Set by the session's first load; a refresh before it is a no-op (pre-auth). */
let sessionHeaders: AuthHeaders | null = null
let lastAttemptAt = Number.NEGATIVE_INFINITY

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

/** Subscribe a component to the answer arriving. */
export function useEditPlanModes(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Can this server plan `mode`? False for a newer mode until the server says so. */
export function isEditPlanModeSupported(mode: string): boolean {
  return PHASE1_EDIT_PLAN_MODES.includes(mode) || (reported?.has(mode) ?? false)
}

/**
 * Why `mode` is greyed out, or `null` when it is offered. Anything but a
 * self-host's report of nodaro.ai's answer — no answer yet, an older backend
 * without `source`, nodaro.ai itself, an unconnected self-host — reads as
 * "needs a plugin update".
 */
export function editPlanModeUnavailableReason(mode: string): EditPlanModeUnavailableReason | null {
  if (isEditPlanModeSupported(mode)) return null
  if (reportedSource === "nodaro.ai") return "nodaro-unsupported"
  if (reportedSource === "nodaro.ai-unreachable") return "nodaro-unreachable"
  return "plugin-update"
}

export async function loadEditPlanModes(getAuthHeaders: AuthHeaders): Promise<void> {
  sessionHeaders = getAuthHeaders
  if (inflight) return inflight
  lastAttemptAt = Date.now()
  inflight = (async () => {
    try {
      const res = await fetch("/v1/edit-plan/capabilities", { headers: await getAuthHeaders() })
      if (!res.ok) return
      const json = (await res.json()) as { modes?: unknown; source?: unknown }
      if (!Array.isArray(json.modes)) return
      reported = new Set(json.modes.filter((m): m is string => typeof m === "string"))
      reportedSource = SOURCES.find((s) => s === json.source) ?? null
      emit()
    } catch {
      // Offline / pre-auth / an older backend — newer modes stay greyed out,
      // which is the safe direction. The server refuses the run either way.
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** Ask again when the last attempt is older than the max age. */
export function refreshEditPlanModesIfStale(): Promise<void> {
  if (!sessionHeaders) return Promise.resolve()
  if (Date.now() - lastAttemptAt < EDIT_PLAN_MODES_MAX_AGE_MS) return Promise.resolve()
  return loadEditPlanModes(sessionHeaders)
}

/**
 * For the signed-in session: load the answer now, and refresh a stale one when
 * the window regains focus or the tab becomes visible. Returns the disposer.
 */
export function watchEditPlanModes(getAuthHeaders: AuthHeaders): () => void {
  void loadEditPlanModes(getAuthHeaders)
  const onFocus = () => void refreshEditPlanModesIfStale()
  const onVisible = () => {
    if (document.visibilityState === "visible") void refreshEditPlanModesIfStale()
  }
  window.addEventListener("focus", onFocus)
  document.addEventListener("visibilitychange", onVisible)
  return () => {
    window.removeEventListener("focus", onFocus)
    document.removeEventListener("visibilitychange", onVisible)
  }
}

/** Test seam: `null` restores "no answer yet" (and no session to refresh for). */
export function __setEditPlanModesForTests(
  modes: readonly string[] | null,
  source: EditPlanModesSource | null = null,
): void {
  reported = modes ? new Set(modes) : null
  reportedSource = modes ? source : null
  if (!modes) {
    sessionHeaders = null
    lastAttemptAt = Number.NEGATIVE_INFINITY
  }
  emit()
}
