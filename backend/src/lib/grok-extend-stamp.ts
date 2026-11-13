/**
 * Grok Extend on a workflow run (node-executor): the run's twin of the
 * `/v1/extend-video` preHandler. The source the upstream node's task names is
 * checked by the same rule (`resolveGrokExtendSource`) before input_data is
 * written and before anything is reserved, so a source Grok cannot extend
 * fails the node with the route's code and message and leaves no jobs row.
 *
 * What the run sends and holds comes from the SOURCE, never the node: the task
 * id the check matched, the source's picture length (where the extension
 * starts) and its resolution — the row the run is held on
 * (`grok-extend:<6|10>s:<480p|720p>`), which the payload builder could only
 * guess (it names the dearer row until this stamp answers).
 */
import { isGrokExtendProvider } from "@nodaro/shared/models"
import { grokExtendCreditId } from "@nodaro/shared/credits"
import { resolveGrokExtendSource } from "./grok-extend-source.js"

/** How long a workflow run waits to measure a Grok source before it falls back to the length its run asked for. */
const GROK_SOURCE_PROBE_TIMEOUT_MS = 20_000

/** True when a built job is a Grok Extend run. */
function isGrokExtendPayload(jobName: string, payload: Readonly<Record<string, unknown>>): boolean {
  return jobName === "extend-video" && isGrokExtendProvider(payload.provider)
}

/** What {@link stampGrokExtendSource} returns: the fields to merge into the payload, or the route's refusal. */
export type GrokExtendStamp =
  | { readonly ok: true; readonly patch: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly refusal: { readonly code: string; readonly message: string } }

/**
 * Check a Grok Extend payload's source (its `kieTaskId`, the upstream node's
 * task) for the run's user, and return what the run must send and hold as a
 * PATCH for the caller to merge (never mutated here): the matched `kieTaskId`,
 * the source's `resolution` and `sourceSec`, and the `reservedCreditId`. The
 * caller merges it BEFORE writing input_data. Returns the route's refusal; an
 * empty patch for every other job.
 */
export async function stampGrokExtendSource(
  jobName: string,
  payload: Readonly<Record<string, unknown>>,
  userId: string,
): Promise<GrokExtendStamp> {
  if (!isGrokExtendPayload(jobName, payload)) return { ok: true, patch: {} }
  const source = await resolveGrokExtendSource({
    taskId: typeof payload.kieTaskId === "string" ? payload.kieTaskId : "",
    userId,
    probeTimeoutMs: GROK_SOURCE_PROBE_TIMEOUT_MS,
  })
  if (!source.ok) return { ok: false, refusal: { code: source.code, message: source.message } }
  return {
    ok: true,
    patch: {
      kieTaskId: source.taskId,
      resolution: source.resolution,
      sourceSec: source.sourceSec,
      reservedCreditId: grokExtendCreditId(payload.duration, source.resolution),
    },
  }
}

/** The id a stamped Grok Extend payload reserves (its source's row); undefined for any other job. */
export function grokExtendReserveId(jobName: string, payload: Readonly<Record<string, unknown>>): string | undefined {
  return isGrokExtendPayload(jobName, payload) && typeof payload.reservedCreditId === "string" ? payload.reservedCreditId : undefined
}
