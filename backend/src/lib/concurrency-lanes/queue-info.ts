// backend/src/lib/concurrency-lanes/queue-info.ts — the `queue` field of the
// job, execution and pipeline reads: where a row that waits for a slot stands
// in its line, so a client can say why it waits.
//
// A read asks only about the rows it already judged waiting (waitingRowsOf):
// a job or a pipeline `queued`, an execution `pending` — each only once a
// lane stamped it (`lane_queued_at`, written by the park before it marks the
// row waiting). Any other row — a `queued` one written by anything but the
// park, or one read without the stamp — costs the read nothing: no gate, no
// Redis. The rows it asks about are answered by ONE gate
// call (describeWaits), whatever their number.
//
// Never fails a read, and never holds it past QUEUE_READ_TIMEOUT_MS in all:
// a gate that is down, slow or erroring leaves `queue` out; a payer tier that
// cannot be read in what is left of that time leaves only `upgradeHint` null. Each logs at most once a minute. The
// field carries counts only — never the payer, the user, or another user's
// jobs.
import { hasCredits } from "../config.js"
import { PARALLELISM_TIERS } from "./defaults.js"
import { withinTimeout } from "./within-timeout.js"
import type { ConcurrencyLane, PayerKey, WaitInfo, WaitReason } from "./types.js"
import type { UPGRADE_HINTS } from "./vocabulary.js"

/** What a waiting row tells its reader. */
export interface QueueInfo {
  lane: ConcurrencyLane
  /** 1-based place in its line. */
  position: number
  /** How many of its line's lane run at once (0 for a server-share wait). */
  limit: number
  /** How many of them run now. */
  running: number
  reason: WaitReason
  waitedSeconds: number
  /**
   * What would shorten the wait, set only when the payer's own line is full
   * (`user_lane`): a bigger plan, or the workspace's plan. Null for a wait on
   * a provider or on the server (busy across the platform), and when the
   * payer's plan is business or above, or cannot be read.
   */
  upgradeHint: (typeof UPGRADE_HINTS)[number] | null
}

/** How long a status read waits, in all, for the gate and then a payer's tier, before it answers without them. */
export const QUEUE_READ_TIMEOUT_MS = 1_000

/**
 * The tiers below business, whose lines a bigger plan raises: the parallelism
 * tiers before `business`, in their order. Business, enterprise and a tier not
 * on the list get no hint.
 */
const BELOW_BUSINESS: ReadonlySet<string> = new Set(PARALLELISM_TIERS.slice(0, PARALLELISM_TIERS.indexOf("business")))

/** A row a read judged waiting: its id, and the lane stamp it carries (null when the read has none). */
export interface WaitingRow {
  id: string
  /** `lane_queued_at`: when the row first parked, the clock its queue timeout runs from. */
  queuedAt: string | null
}

const stampOf = (row: { lane_queued_at?: unknown }): string | null =>
  typeof row.lane_queued_at === "string" && row.lane_queued_at.length > 0 ? row.lane_queued_at : null

/**
 * Is this row waiting for a slot? Decided from the row alone, so a row that
 * does not wait costs no gate call: its waiting status AND the lane stamp,
 * for every kind. A read that does not select the stamp (or a database
 * without the column) therefore sees no row waiting.
 */
export function isWaitingRow(kind: "job" | "execution" | "pipeline", rowObject: object): boolean {
  const row = rowObject as { status?: unknown; lane_queued_at?: unknown }
  const waitingStatus = kind === "execution" ? "pending" : "queued"
  return row.status === waitingStatus && stampOf(row) !== null
}

/** The rows of `rows` that wait for a slot, as queueInfoFor takes them. */
export function waitingRowsOf(kind: "job" | "execution" | "pipeline", rows: readonly object[]): WaitingRow[] {
  const out: WaitingRow[] = []
  for (const r of rows) {
    const row = r as { id?: unknown; lane_queued_at?: unknown }
    if (typeof row.id === "string" && isWaitingRow(kind, r)) out.push({ id: row.id, queuedAt: stampOf(row) })
  }
  return out
}

async function upgradeHintOf(payer: PayerKey): Promise<QueueInfo["upgradeHint"]> {
  if (payer.startsWith("workspace:")) return "workspace"
  if (!hasCredits()) return null
  const { payerTier } = await import("./sizes.js")
  const tier = await payerTier(payer)
  return tier !== null && BELOW_BUSINESS.has(tier) ? "plan" : null
}

/** The hint of a payer's own full line; null on a slow or failed read of its tier. */
async function boundedUpgradeHint(payer: PayerKey, deadline: number): Promise<QueueInfo["upgradeHint"]> {
  const left = Math.max(0, deadline - Date.now())
  try {
    return await withinTimeout(upgradeHintOf(payer), left, () => new Error(`the payer's plan was not read within the ${left} ms left of the read`))
  } catch (err) {
    warn("could not read the payer's plan, answering without an upgrade hint", err)
    return null
  }
}

/** Whole seconds since `queuedAt` when it is a readable stamp, else the gate's figure. */
function waitedSecondsOf(wait: WaitInfo, queuedAt: string | null, now: number): number {
  const at = queuedAt === null ? Number.NaN : Date.parse(queuedAt)
  const ms = Number.isFinite(at) ? now - at : wait.waitedMs
  return Math.max(0, Math.floor(ms / 1000))
}

function toQueueInfo(wait: WaitInfo, waitedSeconds: number, upgradeHint: QueueInfo["upgradeHint"]): QueueInfo {
  return {
    lane: wait.lane,
    position: wait.position,
    limit: wait.limit,
    running: wait.running,
    reason: wait.reason,
    waitedSeconds,
    upgradeHint,
  }
}

const WARN_EVERY_MS = 60_000
let lastWarnAt = -Infinity

function warn(what: string, err: unknown): void {
  const now = Date.now()
  if (now - lastWarnAt < WARN_EVERY_MS) return
  lastWarnAt = now
  console.warn(`[concurrency-lanes] a status read ${what}: ${(err as Error)?.message ?? String(err)}`)
}

/** For tests: forget when the last warning was logged. */
export function resetQueueInfoWarningForTests(): void {
  lastWarnAt = -Infinity
}

async function readWaits(ids: readonly string[]) {
  // Imported here, only once a row waits: the instance opens the queue's Redis connection.
  const { concurrencyGate } = await import("./instance.js")
  return concurrencyGate().describeWaits(ids)
}

/**
 * The queue of each row that waits for a slot, keyed by id; pass the rows
 * waitingRowsOf judged waiting. No rows: no gate call. Never throws.
 */
export async function queueInfoFor(rows: readonly WaitingRow[]): Promise<Map<string, QueueInfo>> {
  const out = new Map<string, QueueInfo>()
  if (rows.length === 0) return out
  // One deadline for the whole read: the tier reads get what the gate left.
  const deadline = Date.now() + QUEUE_READ_TIMEOUT_MS
  let waits: Awaited<ReturnType<typeof readWaits>>
  try {
    waits = await withinTimeout(readWaits(rows.map((r) => r.id)), QUEUE_READ_TIMEOUT_MS, () => new Error(`no answer within ${QUEUE_READ_TIMEOUT_MS} ms`))
  } catch (err) {
    warn("could not read the queue, answering without it", err)
    return out
  }
  const now = Date.now()
  // A hint only for a payer's own full line; one tier read per payer.
  const hints = new Map<PayerKey, Promise<QueueInfo["upgradeHint"]>>()
  for (const { wait, payer } of waits.values()) {
    if (wait.reason === "user_lane" && payer && !hints.has(payer)) hints.set(payer, boundedUpgradeHint(payer, deadline))
  }
  for (const row of rows) {
    const w = waits.get(row.id)
    if (!w) continue
    const hint = w.wait.reason === "user_lane" && w.payer ? await hints.get(w.payer)! : null
    out.set(row.id, toQueueInfo(w.wait, waitedSecondsOf(w.wait, row.queuedAt, now), hint))
  }
  return out
}

/** `row` without its `lane_queued_at`: the stamp is read for the clock, never sent to the client. */
export function withoutLaneStamp<T extends object>(row: T): T {
  const { lane_queued_at: _stamp, ...rest } = row as T & { lane_queued_at?: unknown }
  return rest as T
}

/** `{ queue }` for one row when it waits, else `{}` — spread into a read's answer. */
export function queueField(id: string, queues: ReadonlyMap<string, QueueInfo>): { queue?: QueueInfo } {
  const q = queues.get(id)
  return q ? { queue: q } : {}
}
