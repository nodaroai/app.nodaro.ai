/**
 * One request at a time per batch.
 *
 * A keyed batch (`Idempotency-Key: K`, jobs keyed `K:0..n-1`) is created by
 * whichever request inserts each job first. Two requests with the same key
 * working at once could each charge a job the other also charges, or undo a
 * job the other just paid for. So a keyed batch is worked on under a claim: a
 * Redis lease named after the caller and the key.
 *
 *  - The holder RENEWS the claim before every step that charges, queues or
 *    removes (`renew()`), and a heartbeat renews it in between. A renewal that
 *    fails — the lease lapsed and someone else may hold it now, or Redis does
 *    not answer — means the holder stops at once, touching nothing more.
 *  - A second request with the same key waits for the claim, then finds every
 *    job the first one made.
 *
 * The lease is `redis-lease.ts`'s (SET NX PX, compare-and-extend renewal,
 * compare-and-delete release), on a connection of its own that FAILS while
 * Redis is down instead of queueing commands (the BullMQ connection retries
 * forever, which would hang the request): a claim Redis cannot answer is a
 * 500 before anything is created. If this process dies the claim frees itself
 * after its TTL.
 */
import { createHash } from "node:crypto"
import { redis } from "./queue.js"
import { acquireLease, releaseLease, renewLease, type LeaseClient } from "./redis-lease.js"

/** Longer than a batch takes to insert, reserve and queue (at most 8 jobs). */
export const BATCH_CLAIM_TTL_MS = 60_000
/** How long a second request waits for the claim before answering 409. */
export const BATCH_CLAIM_WAIT_MS = 15_000
/** The heartbeat: well inside the TTL, so a live holder never lapses. */
export const BATCH_CLAIM_HEARTBEAT_MS = 10_000
/** A command the claim's connection does not answer in this long fails. */
export const BATCH_CLAIM_COMMAND_TIMEOUT_MS = 2_000
const BATCH_CLAIM_POLL_MS = 250

/** The claim's name: the caller and the key, hashed (a key is the caller's own text). */
export function batchClaimKey(userId: string, idempotencyKey: string): string {
  const digest = createHash("sha256").update(`job-batch\u0000${userId}\u0000${idempotencyKey}`).digest("hex")
  return `job-batch:${digest}`
}

export interface BatchClaim {
  /**
   * Extend the claim. True only while this request still holds it; false once
   * it lapsed or Redis could not confirm it — then the holder must stop.
   */
  renew(): Promise<boolean>
  /** Give the claim back. Best effort: an unreleased claim expires on its own. */
  release(): Promise<void>
}

export interface ClaimBatchOptions {
  readonly waitMs?: number
  readonly pollMs?: number
  readonly heartbeatMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  /** The connection the lease is taken on (tests); default: this module's own. */
  readonly client?: LeaseClient
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let ownClient: Promise<LeaseClient> | undefined

/** The claim's connection: a duplicate of the BullMQ one that fails fast while Redis is down. */
function claimClient(): Promise<LeaseClient> {
  ownClient ??= (async () => {
    const client = redis.duplicate({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: BATCH_CLAIM_COMMAND_TIMEOUT_MS,
    })
    // A connection error is the claim's business (a failed command), not an unhandled event.
    client.on("error", () => undefined)
    await readyOrTimedOut(client)
    return client
  })()
  return ownClient
}

/**
 * Resolves when the client is ready, or after the command timeout: a client
 * with no offline queue refuses every command while it is still connecting,
 * so the first batch after boot would otherwise answer a false 500.
 */
function readyOrTimedOut(client: ReturnType<typeof redis.duplicate>): Promise<void> {
  if (client.status === "ready") return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      client.off("ready", done)
      resolve()
    }
    const timer = setTimeout(done, BATCH_CLAIM_COMMAND_TIMEOUT_MS)
    timer.unref?.()
    client.once("ready", done)
  })
}

/**
 * Take the batch's claim, waiting while another request holds it. Null when
 * it is still held after `waitMs`. Throws when Redis cannot answer — the
 * caller answers before creating anything.
 */
export async function claimBatch(claimKey: string, opts: ClaimBatchOptions = {}): Promise<BatchClaim | null> {
  const waitMs = opts.waitMs ?? BATCH_CLAIM_WAIT_MS
  const pollMs = opts.pollMs ?? BATCH_CLAIM_POLL_MS
  const sleep = opts.sleep ?? defaultSleep
  const client = opts.client ?? (await claimClient())
  let waited = 0
  for (;;) {
    const token = await acquireLease(claimKey, BATCH_CLAIM_TTL_MS, client)
    if (token) return heldClaim(claimKey, token, client, opts.heartbeatMs ?? BATCH_CLAIM_HEARTBEAT_MS)
    if (waited >= waitMs) return null
    await sleep(pollMs)
    waited += pollMs
  }
}

function heldClaim(claimKey: string, token: string, client: LeaseClient, heartbeatMs: number): BatchClaim {
  let lost = false
  let released = false
  const renew = async (): Promise<boolean> => {
    if (lost || released) return false
    try {
      if (await renewLease(claimKey, token, BATCH_CLAIM_TTL_MS, client)) return true
    } catch {
      // Unconfirmed is not held: someone else may have it by now.
    }
    lost = true
    return false
  }
  const heartbeat = setInterval(() => { void renew() }, heartbeatMs)
  heartbeat.unref?.()
  return {
    renew,
    release: async () => {
      released = true
      clearInterval(heartbeat)
      if (lost) return
      await releaseLease(claimKey, token, client).catch(() => undefined)
    },
  }
}
