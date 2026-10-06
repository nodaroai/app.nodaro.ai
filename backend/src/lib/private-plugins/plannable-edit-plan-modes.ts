import { hasCredits } from "../config.js"
import { editPlanModesOf, type EditPlanModesAnswer } from "./edit-plan-mode-gate.js"
import { getPluginSupports } from "./supports-registry.js"
import type { PluginSupports } from "./types.js"

/**
 * THE answer to "which Edit Plan modes does this server plan?" (round 6,
 * decided 2026-10-06). Every path reads it: `GET /v1/edit-plan/capabilities`
 * (the editor greys out what is missing), the `POST /v1/edit-plan` mode guard,
 * MCP `plan_edit`, and the video worker's mode gate around the plugin's and the
 * relay's `edit-plan` handlers.
 *
 *   - nodaro.ai (`hasCredits()`): the loaded plugin's declaration,
 *     `editPlanModesOf(getPluginSupports())`. No call out, no cache.
 *   - A self-hosted install CONNECTED to nodaro.ai: Edit Plan runs on nodaro.ai
 *     and bills the connected account, so the install plans what nodaro.ai
 *     plans. It asks nodaro.ai's own `GET /v1/edit-plan/capabilities` with the
 *     credential the relay uses (`nodaroCloudFetch`), and a self-host gets
 *     Trailer as soon as nodaro.ai does. The list goes through
 *     `editPlanModesOf`, so a mode this install does not know is still refused.
 *     The answer is cached for `PLANNABLE_MODES_TTL_MS`. When nodaro.ai can't
 *     be reached (error, timeout, a non-2xx other than 404, a malformed body)
 *     the list FAILS CLOSED to the three original modes, for display, and the
 *     answer says so (`source: "nodaro.ai-unreachable"`, round 7, decided
 *     2026-10-06): the worker retries a job in another mode instead of
 *     refusing it. That answer is cached for the shorter
 *     `PLANNABLE_MODES_FAILURE_TTL_MS`, under the queue's first retry delay,
 *     so a retried job asks nodaro.ai again. A 404 is an answer: an older
 *     nodaro.ai without the route plans the three original modes.
 *   - A self-hosted install that is NOT connected: unchanged. Edit Plan is
 *     cloud-exclusive there; the three original modes are listed, Trailer is
 *     refused, and the relay asks for a connection before anything else.
 *
 * Connection state is read on every call (it is one settings read, the same
 * the relay's routes make per request), so a disconnect takes effect at once.
 */

/** How long nodaro.ai's answer is reused. */
export const PLANNABLE_MODES_TTL_MS = 60_000
/** How long the fail-closed answer is reused after nodaro.ai could not be
 *  reached. Under the video queue's first retry delay (`lib/queue.ts`), so a
 *  job retried after an outage asks nodaro.ai again (guarded by a test). */
export const PLANNABLE_MODES_FAILURE_TTL_MS = 4_000
/** How long to wait for nodaro.ai before failing closed. */
const CLOUD_TIMEOUT_MS = 3_000

const CAPABILITIES_PATH = "/v1/edit-plan/capabilities"

export interface PlannableEditPlanModesDeps {
  hasCredits: () => boolean
  getPluginSupports: () => PluginSupports
  isNodaroConnected: () => Promise<boolean>
  cloudFetch: (path: string, init?: RequestInit) => Promise<Response>
  now: () => number
}

// nodaro-connect pulls in the Supabase client, so it is loaded only when a
// self-host actually asks (nodaro.ai never reaches it).
const defaultDeps: PlannableEditPlanModesDeps = {
  hasCredits,
  getPluginSupports,
  isNodaroConnected: async () => (await import("../nodaro-connect.js")).isNodaroConnected(),
  cloudFetch: async (path, init) => (await import("../nodaro-connect.js")).nodaroCloudFetch(path, init),
  now: () => Date.now(),
}

let cached: { answer: EditPlanModesAnswer; until: number } | null = null
let inflight: Promise<EditPlanModesAnswer> | null = null

async function askNodaroAi(deps: PlannableEditPlanModesDeps): Promise<EditPlanModesAnswer> {
  try {
    const res = await deps.cloudFetch(CAPABILITIES_PATH, {
      method: "GET",
      signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
    })
    // nodaro.ai answered, from before it had this route: it plans the original three.
    const listed: unknown = res.status === 404 ? [] : await readModes(res)
    const answer: EditPlanModesAnswer = {
      modes: editPlanModesOf({ editPlanModes: listed as string[] }),
      source: "nodaro.ai",
    }
    cached = { answer, until: deps.now() + PLANNABLE_MODES_TTL_MS }
    return answer
  } catch {
    const answer: EditPlanModesAnswer = { modes: editPlanModesOf({}), source: "nodaro.ai-unreachable" }
    cached = { answer, until: deps.now() + PLANNABLE_MODES_FAILURE_TTL_MS }
    return answer
  }
}

async function readModes(res: Response): Promise<unknown[]> {
  if (!res.ok) throw new Error(`nodaro.ai answered ${res.status}`)
  const body = (await res.json()) as { modes?: unknown }
  if (!Array.isArray(body?.modes)) throw new Error("nodaro.ai's answer has no modes list")
  return body.modes
}

export async function plannableEditPlanModes(
  deps: PlannableEditPlanModesDeps = defaultDeps,
): Promise<EditPlanModesAnswer> {
  if (deps.hasCredits()) return { modes: editPlanModesOf(deps.getPluginSupports()), source: "server" }
  const connected = await deps.isNodaroConnected().catch(() => false)
  if (!connected) return { modes: editPlanModesOf(deps.getPluginSupports()), source: "server" }
  if (cached && deps.now() < cached.until) return cached.answer
  if (!inflight) {
    inflight = askNodaroAi(deps).finally(() => {
      inflight = null
    })
  }
  return inflight
}

/** Test seam — the cache is process-global. */
export function _resetPlannableEditPlanModesForTests(): void {
  cached = null
  inflight = null
}
