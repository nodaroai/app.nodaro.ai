/**
 * The outbound-webhook dispatcher: a background pool in the API process
 * (started from server.ts, like the schedule cron) that sends what migration
 * 521's trigger on `jobs` recorded.
 *
 * Up to CAPACITY deliveries are in flight at once. Whenever there is room —
 * at least MIN_CLAIM free places, or none in flight — the pool claims more:
 *   1. `claim_webhook_deliveries` — this environment's due deliveries, as many
 *      as there is room for, leased for LEASE_SECONDS (FOR UPDATE SKIP LOCKED
 *      inside; several replicas never send one delivery at once, and one that
 *      dies mid-send leaves a row that comes back after its lease —
 *      at-least-once). The claim is fair: at most PER_ENDPOINT of one
 *      endpoint and PER_ACCOUNT of one account in flight, across replicas, so
 *      a receiver that never answers holds its own places and nobody else's.
 *      It also closes, and reports, the rows that must not be sent.
 *   2. Per delivery, on its own: build the body (event.ts), open the
 *      endpoint's secret (secret.ts), sign (signature.ts), POST (send.ts).
 *   3. `record_webhook_delivery_attempt` — delivered, retried on the schedule
 *      (retry.ts), failed for good, or skipped (its job is gone). The place is
 *      free again, and the pool looks for more at once.
 * A claim that found anything is followed by another straight away (a backlog
 * drains at the speed the receivers answer); one that found nothing waits
 * TICK_MS, or less if a send ends first. Hourly, the log is pruned to
 * KEEP_DAYS.
 *
 * Never logs an address, a secret, a body or a receiver's answer: those live
 * on the delivery row, for its owner. A failure of the loop itself is
 * reported at most once per REPORT_EVERY_MS. While the database does not
 * have the functions yet (staging runs before migrations reach the shared
 * database), the pool idles.
 */
import { supabase } from "../supabase.js"
import { getRuntimeEnv } from "../runtime-env.js"
import { isMissingFunctionError } from "../postgrest-errors.js"
import { eventBodyFor, type BuiltEvent, type ClaimedDelivery } from "./event.js"
import { openSigningSecret } from "./secret.js"
import { webhookHeaders } from "./signature.js"
import { postWebhook, type SendResult } from "./send.js"
import { describeDbError } from "./db-error.js"
import {
  CIRCUIT_AFTER_NO_ANSWER,
  DISABLE_AFTER_FAILED_DELIVERIES,
  MAX_ATTEMPTS,
  PLATFORM_RETRY_MS,
  nextRetryDelayMs,
} from "./retry.js"
import { insertAppReport, type AppReportInput } from "../app-reports.js"
import type { WebhookEventType } from "./event-types.js"

export const TICK_MS = 5_000
export const IDLE_WHEN_UNAVAILABLE_MS = 60_000
/** Deliveries this process sends at once. */
export const CAPACITY = 25
/** Free places worth a claim while sends are in flight: claims come in batches, not one per finished send. */
export const MIN_CLAIM = 5
export const PER_ENDPOINT = 5
export const PER_ACCOUNT = 10
/** Longer than a send can take (10 s), with room for building and recording. */
export const LEASE_SECONDS = 60
export const KEEP_DAYS = 30
export const PRUNE_EVERY_MS = 60 * 60_000
export const PRUNE_FIRST_AFTER_MS = 60_000
export const PRUNE_BATCH = 5_000
/** One prune round's time limit: it removes batches until one comes back short, or this runs out. */
export const PRUNE_BUDGET_MS = 30_000
const REPORT_EVERY_MS = 5 * 60_000

export interface DispatchDeps {
  now: () => number
  random: () => number
  /** The process log (server.ts passes app.log.warn). */
  report: (message: string) => void
  /** The admin's report list (/admin/app-reports). Best-effort; never throws. */
  fileReport: (input: AppReportInput) => Promise<unknown>
}

/** `deferred`: not attempted, for a reason on Nodaro's side — the attempt is given back. */
export type Outcome = "delivered" | "retry" | "failed" | "skipped" | "deferred"

interface ClaimRow {
  delivery_id: string
  webhook_id: string
  user_id: string
  job_id: string | null
  event: WebhookEventType
  payload: unknown
  attempts: number
  created_at: string
  url: string | null
  secret_ciphertext: string | null
  previous_secret_ciphertext?: string | null
  runtime_env: string | null
  /** Set when the claim closed the row instead of leasing it. */
  closed_reason?: string | null
}

function toDelivery(row: ClaimRow): ClaimedDelivery {
  return {
    deliveryId: row.delivery_id,
    webhookId: row.webhook_id,
    userId: row.user_id,
    jobId: row.job_id,
    event: row.event,
    payload: row.payload,
    attempts: row.attempts,
    createdAt: row.created_at,
    url: row.url ?? "",
    secretCiphertext: row.secret_ciphertext ?? "",
    previousSecretCiphertext: row.previous_secret_ciphertext ?? null,
    runtimeEnv: row.runtime_env ?? "",
  }
}

/** What one claim handed out. */
export interface ClaimBatch {
  /** Leased to this process: send them. */
  deliveries: ClaimedDelivery[]
  /** Rows it closed instead (endpoint switched off, app revoked, attempts spent). */
  closed: number
  /** The database has no webhook functions yet. */
  unavailable?: true
}

/** One claim of up to `want` deliveries. Throws only on a database error. */
export async function claimDeliveries(want: number): Promise<ClaimBatch> {
  const { data, error } = await supabase.rpc("claim_webhook_deliveries", {
    p_runtime_env: getRuntimeEnv(),
    p_limit: want,
    p_per_endpoint: PER_ENDPOINT,
    p_per_account: PER_ACCOUNT,
    p_lease_seconds: LEASE_SECONDS,
    // A delivery whose last attempt's sender died is closed, not tried a ninth time.
    p_max_attempts: MAX_ATTEMPTS,
  })
  if (error) {
    if (isMissingFunctionError(error)) return { deliveries: [], closed: 0, unavailable: true }
    throw new Error(`webhook delivery claim failed (${describeDbError(error)})`)
  }
  const rows = (data ?? []) as ClaimRow[]
  const leased = rows.filter((row) => !row.closed_reason)
  return { deliveries: leased.map(toDelivery), closed: rows.length - leased.length }
}

interface AttemptRecord {
  outcome: Outcome
  nextRetryAt: string | null
  payload: string | null
  send: Pick<SendResult, "status" | "body" | "durationMs"> | null
  error: string | null
}

/** After a failed attempt: the next one on the schedule, or the end. */
function afterFailure(d: ClaimedDelivery, deps: DispatchDeps): { outcome: Outcome; nextRetryAt: string | null } {
  const delay = nextRetryDelayMs(d.event, d.attempts, deps.random)
  return delay === null
    ? { outcome: "failed", nextRetryAt: null }
    : { outcome: "retry", nextRetryAt: new Date(deps.now() + delay).toISOString() }
}

async function record(d: ClaimedDelivery, r: AttemptRecord, deps: DispatchDeps): Promise<void> {
  const args = {
    p_delivery_id: d.deliveryId,
    p_attempt: d.attempts,
    p_outcome: r.outcome,
    p_next_retry_at: r.nextRetryAt,
    p_payload: r.payload,
    p_response_status: r.send?.status ?? null,
    p_response_body: r.send?.body ?? null,
    p_duration_ms: r.send?.durationMs ?? null,
    p_error: r.error,
    p_disable_after: DISABLE_AFTER_FAILED_DELIVERIES,
    p_circuit_after: CIRCUIT_AFTER_NO_ANSWER,
  }
  let { error } = await supabase.rpc("record_webhook_delivery_attempt", args)
  if (error && args.p_response_body !== null) {
    // The outcome matters more than the receiver's answer: if the answer is
    // what the database refused, the outcome still goes in without it.
    ;({ error } = await supabase.rpc("record_webhook_delivery_attempt", { ...args, p_response_body: null }))
  }
  // The lease brings the delivery back; this attempt stays spent.
  if (error) throttledReport(deps, "record", `[webhooks] could not record delivery ${d.deliveryId}: ${describeDbError(error)}`)
}

/**
 * An attempt Nodaro could not make (the job could not be read, the secret
 * could not be opened) is not the receiver's failure: it is deferred — the
 * attempt given back, nothing counted against the endpoint — and the admin
 * hears of it, once per REPORT_EVERY_MS per reason.
 */
async function deferForPlatform(
  d: ClaimedDelivery,
  reason: "job_unreadable" | "signing_unavailable",
  title: string,
  deps: DispatchDeps,
): Promise<Outcome> {
  const nextRetryAt = new Date(deps.now() + PLATFORM_RETRY_MS).toISOString()
  await record(d, { outcome: "deferred", nextRetryAt, payload: null, send: null, error: reason }, deps)
  reportFailure(deps, reason, title, { reason })
  return "deferred"
}

/** One delivery, start to end. Never throws. */
export async function processDelivery(d: ClaimedDelivery, deps: DispatchDeps): Promise<Outcome> {
  let built: BuiltEvent
  try {
    built = await eventBodyFor(d)
  } catch {
    return deferForPlatform(d, "job_unreadable", "webhook deliveries are waiting: a job could not be read", deps)
  }
  if (built.kind === "missing") {
    await record(d, { outcome: "skipped", nextRetryAt: null, payload: null, send: null, error: "job_deleted" }, deps)
    return "skipped"
  }
  const keep = built.fresh ? built.body : null

  const binding = { endpointId: d.webhookId, userId: d.userId, runtimeEnv: d.runtimeEnv }
  let secret: string
  try {
    secret = openSigningSecret(d.secretCiphertext, binding)
  } catch {
    // Nothing was sent, so nothing is kept: the next attempt builds afresh.
    return deferForPlatform(
      d,
      "signing_unavailable",
      "webhook deliveries are waiting: a signing secret could not be opened (is NODARO_ENCRYPTION_KEY set, and the one the secrets were sealed with?)",
      deps,
    )
  }
  // During a rotation's grace the replaced secret signs too; if it cannot be
  // opened, the new one alone does.
  let previousSecret: string | null = null
  if (d.previousSecretCiphertext) {
    try {
      previousSecret = openSigningSecret(d.previousSecretCiphertext, binding)
    } catch {
      previousSecret = null
    }
  }

  const headers = webhookHeaders({
    secret,
    previousSecret,
    unixSeconds: Math.floor(deps.now() / 1000),
    body: built.body,
    event: d.event,
    deliveryId: d.deliveryId,
    webhookId: d.webhookId,
    attempt: d.attempts,
  })
  const sent = await postWebhook(d.url, built.body, headers)
  if (sent.ok) {
    await record(d, { outcome: "delivered", nextRetryAt: null, payload: keep, send: sent, error: null }, deps)
    return "delivered"
  }
  const next = afterFailure(d, deps)
  await record(d, { ...next, payload: keep, send: sent, error: sent.error }, deps)
  return next.outcome
}

const DEFAULT_DEPS: DispatchDeps = {
  now: () => Date.now(),
  random: Math.random,
  report: () => {},
  fileReport: insertAppReport,
}

const lastReportAt = new Map<string, number>()

function throttledReport(deps: DispatchDeps, kind: string, message: string): void {
  const now = deps.now()
  const last = lastReportAt.get(kind)
  if (last !== undefined && now - last < REPORT_EVERY_MS) return
  lastReportAt.set(kind, now)
  deps.report(message)
}

/**
 * A failure on Nodaro's side: the process log and the admin's report list,
 * at most once per REPORT_EVERY_MS per kind. Fixed words only — never an
 * address, a secret, a body or a receiver's answer.
 */
function reportFailure(deps: DispatchDeps, kind: string, title: string, payload: Record<string, unknown> = {}): void {
  const now = deps.now()
  const key = `failure:${kind}`
  const last = lastReportAt.get(key)
  if (last !== undefined && now - last < REPORT_EVERY_MS) return
  lastReportAt.set(key, now)
  deps.report(`[webhooks] ${title}`)
  void Promise.resolve()
    .then(() => deps.fileReport({ node: "webhook-dispatcher", kind: "webhook-delivery-stalled", severity: "error", title, payload }))
    .catch(() => {})
}

/** Test hook: forget when each kind was last reported. */
export function __resetDispatcherReports(): void {
  lastReportAt.clear()
}

/* ------------------------------------------------------------------ pool */

export interface PoolDeps {
  capacity: number
  minClaim: number
  /** The wait after a claim that found nothing. */
  idleMs: number
  /** The wait while the database has no webhook functions. */
  unavailableMs: number
  claim: (want: number) => Promise<ClaimBatch>
  send: (d: ClaimedDelivery) => Promise<unknown>
  onError: (err: unknown) => void
}

export interface DeliveryPool {
  /** Deliveries being sent right now. */
  readonly inFlight: number
  /** Stop claiming, and wait for the claim and the sends in flight. */
  stop: () => Promise<void>
}

/**
 * The scheduler: never more than `capacity` sends at once, one claim at a
 * time, sized to the room there is, and another as soon as a claim found
 * something or a send ends.
 */
export function startDeliveryPool(deps: PoolDeps): DeliveryPool {
  let stopped = false
  let inFlight = 0
  let claiming: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const sends = new Set<Promise<void>>()

  const wakeIn = (ms: number) => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(pump, ms)
    timer.unref?.()
  }

  function startSend(d: ClaimedDelivery): void {
    inFlight++
    const send: Promise<void> = (async () => {
      try {
        await deps.send(d)
      } catch (err) {
        deps.onError(err)
      }
    })().finally(() => {
      inFlight--
      sends.delete(send)
      pump()
    })
    sends.add(send)
  }

  function pump(): void {
    if (stopped || claiming) return
    const room = deps.capacity - inFlight
    // A send in flight will call again when it ends.
    if (room <= 0 || (room < deps.minClaim && inFlight > 0)) return
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    claiming = (async () => {
      let wait = deps.idleMs
      try {
        const batch = await deps.claim(room)
        if (batch.unavailable) {
          wait = deps.unavailableMs
        } else {
          for (const d of batch.deliveries) startSend(d)
          if (batch.deliveries.length > 0 || batch.closed > 0) wait = 0
        }
      } catch (err) {
        deps.onError(err)
      }
      claiming = null
      wakeIn(wait)
    })()
  }

  pump()
  return {
    get inFlight() {
      return inFlight
    },
    stop: async () => {
      stopped = true
      if (timer) clearTimeout(timer)
      await claiming
      await Promise.allSettled([...sends])
    },
  }
}

/* ----------------------------------------------------------------- prune */

/** Drop delivery-log rows older than KEEP_DAYS: batch after batch, until one comes back short or PRUNE_BUDGET_MS runs out. */
export async function pruneDeliveries(now: () => number = Date.now): Promise<number> {
  const started = now()
  let total = 0
  for (;;) {
    const { data, error } = await supabase.rpc("prune_webhook_deliveries", { p_keep_days: KEEP_DAYS, p_limit: PRUNE_BATCH })
    if (error) {
      if (isMissingFunctionError(error)) return total
      throw new Error(`webhook delivery prune failed (${describeDbError(error)})`)
    }
    const removed = typeof data === "number" ? data : 0
    total += removed
    if (removed < PRUNE_BATCH || now() - started >= PRUNE_BUDGET_MS) return total
  }
}

/* ------------------------------------------------------------------ start */

/** Start the pool and the hourly prune; the returned function stops both and waits for what is in flight. */
export function startWebhookDispatcher(report: (message: string) => void): () => Promise<void> {
  const deps: DispatchDeps = { ...DEFAULT_DEPS, report }
  const pool = startDeliveryPool({
    capacity: CAPACITY,
    minClaim: MIN_CLAIM,
    idleMs: TICK_MS,
    unavailableMs: IDLE_WHEN_UNAVAILABLE_MS,
    claim: claimDeliveries,
    send: (d) => processDelivery(d, deps),
    onError: (err) => reportFailure(deps, "loop", `webhook delivery loop: ${(err as Error).message}`),
  })

  let pruning: Promise<void> | null = null
  const prune = () => {
    if (pruning) return
    pruning = pruneDeliveries()
      .then(
        () => undefined,
        (err: unknown) => reportFailure(deps, "prune", `webhook delivery log prune: ${(err as Error).message}`),
      )
      .finally(() => {
        pruning = null
      })
  }
  const first = setTimeout(prune, PRUNE_FIRST_AFTER_MS)
  first.unref?.()
  const hourly = setInterval(prune, PRUNE_EVERY_MS)
  hourly.unref?.()

  return async () => {
    clearTimeout(first)
    clearInterval(hourly)
    await pool.stop()
    await pruning
  }
}
