import { hasCredits } from "../config.js"
import { getPluginSupports, pluginSupportsLoaded } from "./supports-registry.js"
import type { PluginSupports } from "./types.js"

/**
 * Does the loaded plugin charge Edit Plan PER STARTED MINUTE? (decided
 * 2026-10-07) — `supports().editPlanPerMinute`. When it does, the app reserves
 * `edit-plan:<mode>:<tier>:<N>m` (N = started minutes) for a workflow run and
 * quotes the same N in every estimate; otherwise it keeps the
 * 15/30/60/90/120/180-minute steps. Either side can ship first: the same node
 * then costs the same from the Run button (the plugin's route) and from
 * Execute-All / an app run (this app's reserve).
 *
 *   - No credits (a self-host): `false`. Nothing is charged here; a connected
 *     self-host's Edit Plan is charged on nodaro.ai.
 *   - A process that loaded the plugin (the API server, the video worker): its
 *     declaration, read directly.
 *   - The standalone orchestrator loads no plugin. At boot it registers a
 *     source (`setEditPlanPerMinuteSource`) that asks this container's own API
 *     (`GET /v1/edit-plan/capabilities`, which reads the same declaration). The
 *     answer is reused for `EDIT_PLAN_PER_MINUTE_TTL_MS`; when the API can't be
 *     asked the answer FAILS CLOSED to the steps (the higher reserve, never an
 *     under-reserve) for the shorter `EDIT_PLAN_PER_MINUTE_FAILURE_TTL_MS`.
 *     With no source registered: steps.
 */

export const EDIT_PLAN_PER_MINUTE_TTL_MS = 60_000
export const EDIT_PLAN_PER_MINUTE_FAILURE_TTL_MS = 4_000

export interface EditPlanPerMinuteDeps {
  hasCredits: () => boolean
  supportsLoaded: () => boolean
  getPluginSupports: () => PluginSupports
  now: () => number
}

const defaultDeps: EditPlanPerMinuteDeps = {
  hasCredits,
  supportsLoaded: pluginSupportsLoaded,
  getPluginSupports,
  now: () => Date.now(),
}

let source: (() => Promise<boolean>) | null = null
let cached: { value: boolean; until: number } | null = null
let inflight: Promise<boolean> | null = null

/** The orchestrator's way to learn the answer (registered once at boot). */
export function setEditPlanPerMinuteSource(fn: (() => Promise<boolean>) | null): void {
  source = fn
  cached = null
  inflight = null
}

/** The declaration as read in a process that loaded the plugin. */
export function editPlanPerMinuteDeclared(supports: PluginSupports): boolean {
  return supports.editPlanPerMinute === true
}

export async function editPlanPerMinuteActive(deps: EditPlanPerMinuteDeps = defaultDeps): Promise<boolean> {
  if (!deps.hasCredits()) return false
  if (deps.supportsLoaded()) return editPlanPerMinuteDeclared(deps.getPluginSupports())
  const ask = source
  if (!ask) return false
  if (cached && deps.now() < cached.until) return cached.value
  if (!inflight) {
    inflight = ask()
      .then((value) => {
        cached = { value: value === true, until: deps.now() + EDIT_PLAN_PER_MINUTE_TTL_MS }
        return value === true
      })
      .catch(() => {
        cached = { value: false, until: deps.now() + EDIT_PLAN_PER_MINUTE_FAILURE_TTL_MS }
        return false
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** Test seam — the cache and the source are process-global. */
export function _resetEditPlanPerMinuteForTests(): void {
  source = null
  cached = null
  inflight = null
}
