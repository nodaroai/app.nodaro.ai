import { surfaceJobErrorDetailReaders } from "./surface-profile.js"

/**
 * A failed job's PROVIDER WORDS — what the provider itself said about the
 * failure, kept redacted in `jobs.error_detail` (links cut to their host,
 * secrets removed) and copied onto a run's node state as `errorDetail` — as
 * each reader may see them. The one place that applies the deployment's
 * `jobs.errorDetail` setting (lib/surface-profile.ts):
 *
 *  - `"owner"` (absent, or no profile — today's behaviour): the job's owner
 *    and admins read them on every surface. Every function below returns what
 *    it was given, the same object.
 *  - `"admin"`: an admin reader still does; every other reader sees the job as
 *    one the provider said nothing about — the same keys, the same null or
 *    absent value a failure with no provider text carries — so no client or
 *    SDK type changes.
 *
 * "Admin" is the reader as each surface already decides it: a public job or
 * run read takes its route's own test (`req.userRole` is admin or super_admin,
 * the `ADMIN_ROLES` the admin-only reads check); an MCP session, a webhook
 * delivery and a published app's runner are never an admin reader.
 *
 * Every non-admin serving of the words goes through `providerWordsShown`, by
 * one of the shapes below or through `maskTrendRunError` (lib/public-job-data.ts),
 * which every job read already applies. `provider-words-totality.test.ts`
 * fails a new place that serves them outside it.
 */

/**
 * THE decision: does this reader see a failed job's provider words? Reads the
 * setting only when the reader is not an admin.
 */
export function providerWordsShown(isAdmin: boolean): boolean {
  return isAdmin || surfaceJobErrorDetailReaders() === "owner"
}

/**
 * A job row as `isAdmin`'s reader may read it: `error_detail` null when the
 * words are withheld, every other key as it came. A row without words (or
 * without the column) is returned as it came, the same object, before the
 * setting is read. Never mutates.
 */
export function jobRowProviderWords<T extends object>(row: T, isAdmin: boolean): T {
  const rec = row as unknown as Record<string, unknown>
  if (rec.error_detail == null || providerWordsShown(isAdmin)) return row
  return { ...rec, error_detail: null } as unknown as T
}

/**
 * A run's node states (`workflow_executions.node_states`, or an execution
 * event's `nodeStates`) as `isAdmin`'s reader may read them: each state's
 * `errorDetail` dropped when the words are withheld — the orchestrator writes
 * the key only for a failure that had words, so a state without it is exactly
 * a failure the provider said nothing about.
 */
export function nodeStatesProviderWords<T>(states: T, isAdmin: boolean): T {
  if (providerWordsShown(isAdmin)) return states
  return withoutNodeStateProviderWords(states)
}

/**
 * Every state's `errorDetail` dropped, whatever the setting: the view of a
 * reader who never receives the words (a published app's runner — the words
 * can quote the creator's prompt, `appRunViewStates`). Every other field of
 * every state stays as it was; states with nothing to drop are returned as
 * they came (the same object), and a value that is not a states map is
 * returned as it is (null stays null).
 */
export function withoutNodeStateProviderWords<T>(states: T): T {
  if (!isRecord(states)) return states
  const carrying = Object.entries(states).filter(([, state]) => isRecord(state) && "errorDetail" in state)
  if (carrying.length === 0) return states
  const out: Record<string, unknown> = { ...states }
  for (const [nodeId, state] of carrying) {
    const { errorDetail: _words, ...rest } = state as Record<string, unknown>
    out[nodeId] = rest
  }
  return out as T
}

/**
 * A webhook event body already recorded (`webhook_deliveries.payload`) — what a
 * retry sends again and what the endpoint's delivery log shows — as a delivery
 * reader (never an admin one) may read it: its job's `error_detail` null when
 * the words are withheld. A body recorded while the words were shown would
 * otherwise carry them after the deployment withheld them. The same text,
 * byte for byte, whenever there is nothing to withhold (the words shown, no
 * job, no words, or a body that is not an event).
 */
export function webhookBodyProviderWords(body: string): string {
  if (providerWordsShown(false)) return body
  let event: unknown
  try {
    event = JSON.parse(body)
  } catch {
    return body
  }
  if (!isRecord(event) || !isRecord(event.data) || !isRecord(event.data.job) || event.data.job.error_detail == null) return body
  const job = jobRowProviderWords(event.data.job, false)
  return JSON.stringify({ ...event, data: { ...event.data, job } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
