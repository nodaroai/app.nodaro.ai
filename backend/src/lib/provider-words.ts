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
 * Whatever the setting, the words go only to a reader who may read them: a
 * job's to its owner — and a run's job (`workflow_execution_id` set) only when
 * its owner can also open the run's workflow — a run's node states to a reader
 * who can open the run's workflow (the words can quote its creator's prompt —
 * so a person running someone else's share link or published app never
 * receives them), and a share page's saved node data to the workflow's
 * creator. Admins read them on every read that treats them as admins.
 *
 * "Admin" is the reader as each surface already decides it: a public job or
 * run read takes its route's own test (`req.userRole` is admin or super_admin,
 * the `ADMIN_ROLES` the admin-only reads check); an MCP session, a webhook
 * delivery and a published app's runner are never an admin reader. Whether the
 * reader may read the words (`canRead`) is the caller's to establish — the
 * job's `user_id`, or the access lookups in lib/provider-words-readers.ts —
 * and every shape asks the one decision with it.
 *
 * Every non-admin serving of the words goes through `providerWordsShownTo`, by
 * one of the shapes below or through `maskTrendRunError` (lib/public-job-data.ts),
 * which every job read already applies. `provider-words-totality.test.ts`
 * fails a new place that serves them outside it.
 */

/** Who reads: an admin reader, and whether the words are theirs to read. */
export interface ProviderWordsReader {
  readonly isAdmin: boolean
  /** The job is the reader's, or the reader can open the run's workflow, or created the shared one. */
  readonly canRead: boolean
}

/**
 * THE decision: does this reader see a failed job's provider words? An admin
 * does; any other reader only when the words are theirs to read and the
 * deployment lets owners read them. Reads the setting only for such a reader.
 */
export function providerWordsShownTo(reader: ProviderWordsReader): boolean {
  return reader.isAdmin || (reader.canRead && surfaceJobErrorDetailReaders() === "owner")
}

/**
 * The decision for a reader of their own jobs: every job read that pins its
 * rows to the reader (or reads any job only as an admin).
 */
export function providerWordsShown(isAdmin: boolean): boolean {
  return providerWordsShownTo({ isAdmin, canRead: true })
}

/**
 * A job row as `isAdmin`'s reader may read it, when the read returns only the
 * reader's own jobs (or reads another's only as an admin): `error_detail` null
 * when the words are withheld, every other key as it came. A row without words
 * (or without the column) is returned as it came, the same object, before the
 * setting is read. Never mutates.
 */
export function jobRowProviderWords<T extends object>(row: T, isAdmin: boolean): T {
  const rec = row as unknown as Record<string, unknown>
  if (rec.error_detail == null || providerWordsShown(isAdmin)) return row
  return { ...rec, error_detail: null } as unknown as T
}

/**
 * A job row from a read that can return another user's job (a public
 * listing, a public asset): its words only when the row is the reader's own —
 * judged by the row's `user_id`, so a row read without that column never
 * carries them — or the reader is an admin. Same shape as `jobRowProviderWords`.
 */
export function jobRowProviderWordsFor<T extends object>(row: T, reader: { readonly isAdmin: boolean; readonly userId: string }): T {
  const rec = row as unknown as Record<string, unknown>
  if (rec.error_detail == null) return row
  if (providerWordsShownTo({ isAdmin: reader.isAdmin, canRead: rec.user_id === reader.userId })) return row
  return { ...rec, error_detail: null } as unknown as T
}

/**
 * A job row as this reader may read it: `error_detail` null when the words are
 * withheld from them, every other key as it came. The same object when the
 * row carries no words or the reader sees them. Never mutates.
 */
export function jobRowProviderWordsTo<T extends object>(row: T, reader: ProviderWordsReader): T {
  const rec = row as unknown as Record<string, unknown>
  if (rec.error_detail == null || providerWordsShownTo(reader)) return row
  return { ...rec, error_detail: null } as unknown as T
}

/**
 * Whether serving this job row depends on its reader's relation to the RUN it
 * belongs to: true only when the row carries words, belongs to a run (its
 * `workflow_execution_id`), the reader is not an admin, and the deployment
 * lets a reader who may read them do so. When false, no lookup is needed —
 * the answer is the same either way (a job with no run is its owner's).
 */
export function jobRowNeedsRunRelation(row: object, isAdmin: boolean): boolean {
  const rec = row as Record<string, unknown>
  return !isAdmin && rec.error_detail != null && runIdOf(rec) !== null && providerWordsShown(false)
}

/** The run a job row belongs to (its `workflow_execution_id`), or null for a job with no run. */
export function runIdOf(row: object): string | null {
  const id = (row as Record<string, unknown>).workflow_execution_id
  return typeof id === "string" && id !== "" ? id : null
}

/**
 * A run's node states (`workflow_executions.node_states`, or an execution
 * event's `nodeStates`) as this reader may read them: each state's
 * `errorDetail` dropped when the words are withheld — the orchestrator writes
 * the key only for a failure that had words, so a state without it is exactly
 * a failure the provider said nothing about. The states as they came (the
 * same object) when the reader sees the words.
 */
export function runStatesProviderWords<T>(states: T, reader: ProviderWordsReader): T {
  if (providerWordsShownTo(reader)) return states
  return withoutNodeStateProviderWords(states)
}

/**
 * Whether serving these states to a reader depends on who the reader is —
 * true only when a state carries the words, the reader is not an admin, and
 * the deployment lets a reader who may read them do so. When false, no lookup
 * of the reader's relation to the run is needed: the answer is the same
 * either way.
 */
export function runStatesNeedReaderRelation(states: unknown, isAdmin: boolean): boolean {
  return !isAdmin && nodeStatesCarryProviderWords(states) && providerWordsShown(false)
}

/** Does any state in this map carry a failure's provider words? */
export function nodeStatesCarryProviderWords(states: unknown): boolean {
  return isRecord(states) && Object.values(states).some((state) => isRecord(state) && "errorDetail" in state)
}

/**
 * A workflow's saved nodes (`workflows.nodes`, as a share page serves them) as
 * this reader may read them: each node's `data.errorDetail` — the words its
 * creator's editor saved with a failed result — dropped when the words are
 * withheld. The nodes as they came (the same array) when the reader sees them,
 * or when no node carries them.
 */
export function savedNodesProviderWords<T>(nodes: T, reader: ProviderWordsReader): T {
  if (!Array.isArray(nodes)) return nodes
  if (!nodes.some((node) => isRecord(node) && isRecord(node.data) && "errorDetail" in node.data)) return nodes
  if (providerWordsShownTo(reader)) return nodes
  return nodes.map((node: unknown) => {
    if (!isRecord(node) || !isRecord(node.data) || !("errorDetail" in node.data)) return node
    const { errorDetail: _words, ...data } = node.data
    return { ...node, data }
  }) as unknown as T
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
 * otherwise carry them after the deployment withheld them, or after its job
 * was found to belong to a run of a workflow its owner cannot open
 * (`canRead` false, from lib/provider-words-readers.ts; true for a job with no
 * run, whose words are its owner's). The same text, byte for byte, whenever
 * there is nothing to withhold (the words shown, no job, no words, or a body
 * that is not an event).
 */
export function webhookBodyProviderWords(body: string, canRead = true): string {
  if (providerWordsShownTo({ isAdmin: false, canRead })) return body
  const event = jobEventCarryingWords(body)
  if (!event) return body
  const job = jobRowProviderWordsTo(event.data.job, { isAdmin: false, canRead })
  return JSON.stringify({ ...event, data: { ...event.data, job } })
}

/**
 * Whether serving a recorded webhook body depends on whether its job belongs
 * to a run its owner cannot open: true only when the body's job carries words
 * and the deployment lets an owner read them. When false, no lookup is needed.
 */
export function webhookBodyNeedsRunRelation(body: unknown): boolean {
  return typeof body === "string" && providerWordsShown(false) && jobEventCarryingWords(body) !== null
}

/** A recorded job event whose job carries provider words, parsed; null for any other body. */
function jobEventCarryingWords(body: string): { data: { job: Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown> | null {
  let event: unknown
  try {
    event = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(event) || !isRecord(event.data) || !isRecord(event.data.job) || event.data.job.error_detail == null) return null
  return event as { data: { job: Record<string, unknown> } & Record<string, unknown> } & Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
